/**
 * PCP ROUTES - Extracted from server.js (Lines 4022-14567)
 * Compras, Estoque, Producao, Apontamentos, Materiais, Ordens de Producao
 * LARGEST module: ~10,500 lines, ~204 routes
 * @module routes/pcp-routes
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { normalizeOpCode, getNextOpCode } = require('../utils/op-numbering');
const { desdobrarProdutosPorLances } = require('../utils/lances');
// A árvore de produto é lida do arquivo VIVO (fora da árvore do projeto) — ver
// utils/arvore-produto-fonte.js: gravar dentro de api/ fazia um deploy apagar os
// preços ajustados em produção.
const arvoreFonte = require('../utils/arvore-produto-fonte');
const { hasConfiguredPcpPageAccess } = require('../middleware/auth-central');

const VENDEDORES_OP_OBRIGATORIOS = ['Lorena Silva'];

// Formata telefone BR: (DD) 9XXXX-XXXX (celular) / (DD) XXXX-XXXX (fixo). Tira DDI +55.
// Sem dígitos suficientes ou formato não reconhecido → devolve o valor original.
function formatarTelefoneBR(v) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    let d = raw.replace(/\D/g, '');
    if (!d) return raw;
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length === 9)  return `${d.slice(0, 5)}-${d.slice(5)}`;
    if (d.length === 8)  return `${d.slice(0, 4)}-${d.slice(4)}`;
    return raw;
}

function normalizarNomeLista(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function completarVendedoresOP(rows, query = '') {
    const lista = Array.isArray(rows) ? rows.slice() : [];
    const termo = normalizarNomeLista(query);
    const nomesExistentes = new Set(lista.map(v => normalizarNomeLista(v.nome || v.nome_completo)));

    for (const nome of VENDEDORES_OP_OBRIGATORIOS) {
        const nomeNormalizado = normalizarNomeLista(nome);
        if (nomesExistentes.has(nomeNormalizado)) continue;
        if (termo && !nomeNormalizado.includes(termo)) continue;
        lista.push({
            id: `fixo-${nomeNormalizado.replace(/\s+/g, '-')}`,
            nome,
            cargo: 'Vendedora',
            departamento: 'Comercial'
        });
        nomesExistentes.add(nomeNormalizado);
    }

    return lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

// Converte "lances" (formato qtd x metragem) em metros totais.
// Aceita: "2x100", "2x100;1x50", "2 x 100 + 1x50", "2X100/1x50".
// Sem separador "x" trata o valor como metros diretos. Retorna Number (0 se vazio).
function lancesParaMetros(v) {
    if (v == null) return 0;
    const s = String(v).trim();
    if (!s) return 0;
    let total = 0, matched = false;
    const re = /(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
        matched = true;
        const qtd = parseFloat(m[1].replace(',', '.')) || 0;
        const met = parseFloat(m[2].replace(',', '.')) || 0;
        total += qtd * met;
    }
    if (matched) return total;
    const n = parseFloat(s.replace(',', '.'));
    return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// VEIAS DE UM CABO
//
// Um cabo multiplexado é produzido veia a veia: um TRIPLEX de 1.000 m exige
// 1.000 m de cada uma das 3 veias. O operador aponta metros de VEIA, então o
// cabo só avança 1/n a cada metro apontado.
//
// Cores conforme a prática de chão de fábrica (3 veias = preta, azul, cinza).
// Cabo sem quantidade de veias reconhecida devolve [] e segue o fluxo antigo.
// ---------------------------------------------------------------------------
const CORES_VEIAS = ['Preta', 'Azul', 'Cinza', 'Branca', 'Vermelha', 'Marrom'];
const SEPARADOR_VEIA = ' | Veia ';

function quantidadeDeVeias(descricao) {
    const d = String(descricao || '').toUpperCase();
    if (/QUADR[UI]PLEX/.test(d)) return 4;
    if (/TRIPLEX/.test(d)) return 3;
    if (/DUPLEX/.test(d)) return 2;
    // Formatos "3x2.5", "4 x 1,5" (nº de condutores × seção)
    const m = /(\d+)\s*[xX×]\s*\d+(?:[.,]\d+)?/.exec(d);
    if (m) {
        const n = Number(m[1]);
        if (n >= 2 && n <= 6) return n;
    }
    return 0;
}

function veiasDoCabo(descricao) {
    const n = quantidadeDeVeias(descricao);
    return n >= 2 ? CORES_VEIAS.slice(0, n) : [];
}

// "CB TRIPLEX 16mm | Veia Preta" -> { base: 'CB TRIPLEX 16mm', veia: 'Preta' }
function separarVeia(produtoDescricao) {
    const s = String(produtoDescricao || '');
    const i = s.indexOf(SEPARADOR_VEIA);
    if (i === -1) return { base: s.trim(), veia: null };
    return { base: s.slice(0, i).trim(), veia: s.slice(i + SEPARADOR_VEIA.length).trim() };
}

// ---------------------------------------------------------------------------
// Previsão de conclusão da OP a partir dos APONTAMENTOS.
//
// Ritmo = (quantidade apontada) / (dias corridos entre o 1º e o último apontamento).
// Previsão = âncora + ceil(restante / ritmo), onde a âncora é o último apontamento
// (ou hoje, se ele já passou — não se projeta conclusão para o passado).
//
// Sem apontamento com quantidade não existe ritmo: devolve origem 'planejada'
// (a data cadastrada na OP, se houver) ou nenhuma data. NÃO se inventa previsão.
// ---------------------------------------------------------------------------
const DIA_MS = 86400000;
// Aceita Date (mysql2 devolve colunas DATE assim) ou string. Duck-typing em vez de
// `instanceof Date` porque o operador falha entre realms (vm/worker).
const soData = v => {
    if (!v) return null;
    if (typeof v.getTime === 'function' && typeof v.toISOString === 'function') {
        return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    return String(v).slice(0, 10);
};
const paraDia = ymd => (ymd ? new Date(`${ymd}T12:00:00Z`) : null);
const hojeYmd = () => new Date().toISOString().slice(0, 10);

function calcularPrevisaoPorApontamentos(op) {
    const planejada = Number(op.quantidade_planejada) || 0;
    const produzido = Number(op.quantidade_produzida) || 0;
    const apontQtd = Number(op.apont_qtd) || 0;
    const apontN = Number(op.apont_n) || 0;
    const primeiro = soData(op.apont_primeiro);
    const ultimo = soData(op.apont_ultimo);
    const restante = Math.max(0, planejada - produzido);

    const previsao = {
        data: null,
        origem: null,           // 'apontamentos' | 'planejada' | null
        ritmo_dia: 0,
        dias_restantes: null,
        dias_apontados: 0,
        quantidade_apontada: apontQtd,
        apontamentos: apontN,
        primeiro_apontamento: primeiro,
        ultimo_apontamento: ultimo,
        restante,
    };

    if (!apontN || apontQtd <= 0 || !primeiro || !ultimo) {
        const planejadaData = soData(op.data_prevista);
        if (planejadaData) { previsao.data = planejadaData; previsao.origem = 'planejada'; }
        return previsao;
    }

    // Janela de produção em dias corridos (o primeiro dia conta como 1).
    const dias = Math.max(1, Math.round((paraDia(ultimo) - paraDia(primeiro)) / DIA_MS) + 1);
    previsao.dias_apontados = dias;
    previsao.ritmo_dia = Number((apontQtd / dias).toFixed(3));

    if (restante <= 0) {
        previsao.data = ultimo;
        previsao.origem = 'apontamentos';
        previsao.dias_restantes = 0;
        return previsao;
    }

    const diasRestantes = Math.ceil(restante / previsao.ritmo_dia);
    const hoje = hojeYmd();
    const ancora = paraDia(ultimo > hoje ? ultimo : hoje);
    previsao.dias_restantes = diasRestantes;
    previsao.data = new Date(ancora.getTime() + diasRestantes * DIA_MS).toISOString().slice(0, 10);
    previsao.origem = 'apontamentos';
    return previsao;
}

module.exports = function createPCPRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, cacheMiddleware, CACHE_CONFIG, jwt, JWT_SECRET, writeGuard } = deps;
    const router = express.Router();

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const SAFE_MIMES = new Set(['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/xml','text/xml']);
    const safeFileFilter = (req, file, cb) => SAFE_MIMES.has(file.mimetype) ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
    fs.mkdirSync(uploadsRoot, { recursive: true });
    const upload = multer({ dest: uploadsRoot, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: safeFileFilter });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

    // LGPD Crypto - descriptografia PII (pode não existir)
    let lgpdCrypto = null;
    try { lgpdCrypto = require('../lgpd-crypto'); } catch (_) {}

    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };

    // Registra baixa de matéria-prima ao concluir OP.
    // AUDIT-FIX: a versão anterior gravava em `estoque_movimentos`/`estoque_saldos`,
    // tabelas que ninguém mais lê — Compras e a própria tela de materiais do PCP usam
    // `materiais.quantidade_estoque`/`estoque.quantidade_atual` (ver AUDIT-FIX em
    // modules/Compras/api/estoque.js). Além disso o JOIN original casava
    // `itens_ordem_producao.codigo_material` contra `produtos.codigo` — que nunca bate
    // pra item de matéria-prima real — então o filtro `produto_id` descartava toda
    // linha e a baixa nunca rodava de fato. Agora usa `itens_ordem_producao.material_id`
    // (ou resolve por `codigo_material` quando ausente) e atualiza as tabelas reais.
    // O log em `movimentacoes_estoque` é best-effort: se o nome de coluna divergir,
    // a baixa em si (a parte que importa) já foi commitada antes dessa tentativa.
    async function registrarBaixaEstoqueOP(pool, opId, usuarioId) {
        const [itens] = await pool.query(
            `SELECT id, material_id, codigo_material, quantidade_utilizada, quantidade_necessaria
             FROM itens_ordem_producao
             WHERE ordem_producao_id = ?`,
            [opId]
        );
        if (!itens.length) return;

        for (const item of itens) {
            const qtd = parseFloat(item.quantidade_utilizada || item.quantidade_necessaria) || 0;
            if (qtd <= 0) continue;

            let materialId = item.material_id;
            if (!materialId && item.codigo_material) {
                const [[mat]] = await pool.query('SELECT id FROM materiais WHERE codigo_material = ?', [item.codigo_material]);
                materialId = mat ? mat.id : null;
            }
            if (!materialId) continue; // sem vínculo com materiais — não há o que baixar

            const conn = await pool.getConnection();
            let quantidadeAnterior = 0, novaQuantidade = 0;
            try {
                await conn.beginTransaction();
                const [[estoqueRow]] = await conn.query('SELECT quantidade_atual FROM estoque WHERE material_id = ? FOR UPDATE', [materialId]);
                if (!estoqueRow) {
                    await conn.query('INSERT INTO estoque (material_id, quantidade_atual) VALUES (?, 0)', [materialId]);
                } else {
                    quantidadeAnterior = parseFloat(estoqueRow.quantidade_atual) || 0;
                }
                novaQuantidade = Math.max(0, quantidadeAnterior - qtd);
                await conn.query('UPDATE estoque SET quantidade_atual = ? WHERE material_id = ?', [novaQuantidade, materialId]);
                await conn.query('UPDATE materiais SET quantidade_estoque = ? WHERE id = ?', [novaQuantidade, materialId]);
                await conn.commit();
            } catch (err) {
                try { await conn.rollback(); } catch (_) {}
                console.error(`[PCP] Erro ao dar baixa em estoque (OP #${opId}, material ${materialId}):`, err.message);
                conn.release();
                continue;
            }
            conn.release();

            try {
                await pool.query(
                    `INSERT INTO movimentacoes_estoque
                     (material_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, created_at)
                     VALUES (?, 'SAIDA', ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [materialId, qtd, quantidadeAnterior, novaQuantidade, `Baixa automática OP #${opId}`, 'PRINCIPAL', String(opId), usuarioId || null]
                );
            } catch (logErr) {
                console.error(`[PCP] Baixa em estoque OK (material ${materialId}, OP #${opId}), mas log em movimentacoes_estoque falhou:`, logErr.message);
            }
        }
    }

    router.use(authenticateToken);
    // PCP module serves Compras, Estoque and Produção
    // Accept users with 'pcp' OR 'compras' area permission (FIX 28/02/2026)
    router.use(async (req, res, next) => {
        if (req.path.startsWith('/api/configuracoes')) {
            return next(); // Configurações são globais, não restritas ao PCP
        }
        if (req.path.startsWith('/api/transportadoras')) {
            return next(); // Transportadoras são usadas por Vendas, Logística e PCP
        }
        // Árvore de produto (GET somente-leitura) é usada pelo módulo Vendas para parâmetros fiscais (DIFAL/ICMS-ST)
        // e, por item, para o preço sugerido/piso na montagem do orçamento.
        if (req.method === 'GET' && (req.path === '/arvore-produto' || req.path.startsWith('/arvore-produto/preco/'))) {
            return next();
        }
        // Helper: tenta autorizar por uma área sem enviar resposta de erro
        const tryAuth = (area) => new Promise((resolve) => {
            const fakeRes = {
                status: () => ({ json: () => resolve(false) })
            };
            authorizeArea(area)(req, fakeRes, () => resolve(true)).catch(() => resolve(false));
        });

        // A carteira de pedidos usa somente estes dois recursos de integração.
        // A exceção é deliberadamente estreita: Vendas não ganha acesso ao restante
        // do PCP nem às rotas gerais de Compras.
        const rotaMaterialDoPedido = /^\/pedidos\/\d+\/(calculo-material|requisicao-material)$/.test(req.path);
        // O repricing por frete/UF/condição é disparado pelo modal de Vendas, que
        // não tem (nem deve ter) acesso ao resto do PCP.
        const rotaRepricarPedido = req.method === 'POST'
            && /^\/arvore-produto\/repricar-pedido\/\d+$/.test(req.path);
        if ((rotaMaterialDoPedido || rotaRepricarPedido) && await tryAuth('vendas')) {
            return next();
        }

        if (await tryAuth('pcp') || await tryAuth('compras')) {
            return next();
        }

        return res.status(403).json({
            message: 'Acesso negado. Você não tem permissão para acessar este módulo (PCP/Compras).'
        });
    });
    // AUDIT-FIX PERM-004: Block mutations for consultoria/restricted roles
    router.use(writeGuard || ((req, res, next) => next()));
    // Permissão fina "apontamentos" (usuarios.permissoes_pcp) — a web já aplica isso nas
    // páginas HTML (requirePageAccess); aqui estende a mesma regra às rotas de API JSON
    // que o app mobile usa. Fail-open: só bloqueia quem tem permissoes_pcp configurado
    // sem incluir 'apontamentos' — quem nunca teve essa coluna preenchida não é afetado.
    router.use('/apontamentos', async (req, res, next) => {
        try {
            const ok = await hasConfiguredPcpPageAccess(pool, req.user?.id, '/pcp/apontamentos');
            if (!ok) {
                return res.status(403).json({
                    message: 'Você não tem permissão para acessar apontamentos do PCP.',
                    code: 'PCP_APONTAMENTOS_DENIED'
                });
            }
            next();
        } catch (err) {
            next(err);
        }
    });
    router.use('/ordens-servico', require('./pcp-os-routes')({ pool, authorizeArea }));
    // ----------------- ROTAS PCP (Compras, Estoque e Produção) UNIFICADAS -----------------

    // Cache de colunas da tabela produtos (evita INFORMATION_SCHEMA a cada request)
    let _produtoColumnsCache = null;
    let _produtoColumnsCacheTime = 0;
    const COLUMNS_CACHE_TTL = 300000; // 5 min

    async function getProdutoColumns(pool) {
        const now = Date.now();
        if (_produtoColumnsCache && (now - _produtoColumnsCacheTime) < COLUMNS_CACHE_TTL) {
            return _produtoColumnsCache;
        }
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'produtos' AND TABLE_SCHEMA = DATABASE()
        `);
        _produtoColumnsCache = columns.map(col => col.COLUMN_NAME);
        _produtoColumnsCacheTime = now;
        return _produtoColumnsCache;
    }

    const getTableColumnsSet = async (tableName) => {
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        `, [tableName]);
        return new Set(columns.map(col => col.COLUMN_NAME));
    };

    function parseOrdemProducaoItems(body) {
        if (Array.isArray(body.produtos)) return body.produtos;
        if (Array.isArray(body.items)) return body.items;
        if (body.items_json) {
            try {
                const parsed = typeof body.items_json === 'string' ? JSON.parse(body.items_json) : body.items_json;
                if (Array.isArray(parsed)) return parsed;
            } catch (_) {}
        }
        if (body.codigo_produto || body.descricao_produto || body.produto_nome) {
            return [{
                codigo: body.codigo_produto || body.codigo || '',
                descricao: body.descricao_produto || body.produto_nome || body.produto || '',
                quantidade: body.quantidade || 0,
                valor_unitario: body.valor_unitario || body.preco_unitario || 0,
                unidade: body.unidade || 'UN'
            }];
        }
        return [];
    }

    function normalizarDadosOrdemProducao(body) {
        const dados = Object.assign({}, body || {});
        const transportadora = dados.transportadora && typeof dados.transportadora === 'object'
            ? dados.transportadora
            : {};

        dados.transportadora_nome = dados.transportadora_nome || transportadora.nome || '';
        dados.transportadora_fone = dados.transportadora_fone || dados.transportadora_telefone || transportadora.fone || '';
        dados.transportadora_cep = dados.transportadora_cep || transportadora.cep || '';
        dados.transportadora_endereco = dados.transportadora_endereco || transportadora.endereco || '';
        dados.transportadora_cpf_cnpj = dados.transportadora_cpf_cnpj || transportadora.cpf_cnpj || '';
        dados.transportadora_email_nfe = dados.transportadora_email_nfe || transportadora.email_nfe || '';
        dados.numero_pedido = dados.numero_pedido || dados.num_pedido || dados.pedido_referencia || '';
        dados.prazo_entrega = dados.prazo_entrega || dados.data_previsao_entrega || null;
        dados.tipo_frete = dados.tipo_frete || dados.frete || '';
        // O frontend usa tanto a forma singular (campo de pedidos) quanto a plural
        // (formulário da OP). Normalize aqui para todos os geradores de planilha.
        dados.observacao_producao = dados.observacao_producao || dados.observacoes_producao || '';
        dados.observacoes_producao = dados.observacoes_producao || dados.observacao_producao || '';
        dados.produtos = parseOrdemProducaoItems(dados).map(item => ({
            ...item,
            quantidade: parseFloat(item.quantidade) || 0,
            valor_unitario: parseFloat(item.valor_unitario || item.preco_unitario || item.preco) || 0,
            unidade: item.unidade || item.unidade_medida || 'UN'
        }));
        return dados;
    }

    async function persistirOrdemProducaoGerada(dados, usuario, arquivoXlsx) {
        const columns = await getTableColumnsSet('ordens_producao');
        const insertColumns = [];
        const values = [];
        const used = new Set();
        const add = (column, value) => {
            if (!columns.has(column) || used.has(column)) return;
            insertColumns.push(`\`${column}\``);
            values.push(value === undefined ? null : value);
            used.add(column);
        };

        const itens = dados.produtos || [];
        const primeiroItem = itens[0] || {};
        const quantidadeTotal = parseFloat(dados.quantidade_total)
            || itens.reduce((sum, item) => sum + (parseFloat(item.quantidade) || 0), 0);
        const valorTotal = parseFloat(dados.valor_total)
            || itens.reduce((sum, item) => {
                const qtd = parseFloat(item.quantidade) || 0;
                const unit = parseFloat(item.valor_unitario || item.preco_unitario || item.preco) || 0;
                return sum + (parseFloat(item.total) || qtd * unit);
            }, 0);
        const numeroInformado = dados.numero_ordem || dados.codigo;
        const numeroOrdem = normalizeOpCode(numeroInformado)
            || await getNextOpCode(pool, new Date().getFullYear(), { lock: false });
        const numeroPedido = dados.numero_pedido || dados.pedido_referencia || dados.num_pedido || null;
        const pedidoId = dados.pedido_id || dados.pedido_vinculado_id || null;
        const produtosJson = JSON.stringify(itens);

        add('codigo', numeroOrdem);
        add('numero_ordem', numeroOrdem);
        add('codigo_produto', primeiroItem.codigo || dados.codigo_produto || dados.codigo || null);
        add('descricao_produto', primeiroItem.descricao || primeiroItem.nome || dados.descricao_produto || dados.produto_nome || null);
        add('produto_nome', primeiroItem.descricao || primeiroItem.nome || dados.produto || dados.produto_nome || dados.cliente || null);
        add('quantidade', quantidadeTotal || 0);
        add('unidade', primeiroItem.unidade || dados.unidade || 'UN');
        add('status', dados.status || 'pendente');
        add('prioridade', dados.prioridade || 'media');
        add('progresso', 0);
        add('quantidade_produzida', 0);
        add('pedido_id', pedidoId);
        add('pedido_vinculado_id', pedidoId);
        add('numero_pedido', numeroPedido);
        add('num_pedido', numeroPedido);
        add('pedido_referencia', dados.pedido_referencia || numeroPedido);
        add('numero_orcamento', dados.numero_orcamento || dados.num_orcamento || dados['num_orçamento'] || null);
        add('revisao', dados.revisao || '00');
        add('data_liberacao', dados.data_liberacao || null);
        add('data_previsao_entrega', dados.data_previsao_entrega || null);
        add('data_prevista', dados.data_previsao_entrega || dados.prazo_entrega || null);
        add('cliente_id', dados.cliente_id || null);
        add('cliente', dados.cliente || dados.cliente_nome || null);
        add('cliente_nome', dados.cliente || dados.cliente_nome || null);
        add('contato', dados.contato || dados.contato_cliente || null);
        add('cliente_contato', dados.contato || dados.contato_cliente || null);
        add('telefone', dados.telefone || dados.fone_cliente || null);
        add('cliente_telefone', dados.telefone || dados.fone_cliente || null);
        add('email', dados.email || dados.email_cliente || null);
        add('cliente_email', dados.email || dados.email_cliente || null);
        add('vendedor', dados.vendedor || dados.vendedor_nome || null);
        add('vendedor_nome', dados.vendedor || dados.vendedor_nome || null);
        add('frete', dados.frete || dados.tipo_frete || null);
        add('tipo_frete', dados.tipo_frete || dados.frete || null);
        add('condicoes_pagamento', dados.condicoes_pagamento || null);
        add('forma_pagamento', dados.forma_pagamento || null);
        add('metodo_pagamento', dados.metodo_pagamento || null);
        add('valor_total', valorTotal || 0);
        add('total_geral', valorTotal || 0);
        add('quantidade_produtos', itens.length);
        add('transportadora_nome', dados.transportadora_nome || null);
        add('transportadora_fone', dados.transportadora_fone || null);
        add('transportadora_telefone', dados.transportadora_fone || dados.transportadora_telefone || null);
        add('transportadora_cep', dados.transportadora_cep || null);
        add('transportadora_endereco', dados.transportadora_endereco || null);
        add('transportadora_cpf_cnpj', dados.transportadora_cpf_cnpj || null);
        add('transportadora_email_nfe', dados.transportadora_email_nfe || null);
        add('observacoes', dados.observacoes || null);
        add('observacoes_pedido', dados.observacoes_pedido || null);
        add('observacao_producao', dados.observacao_producao || dados.observacoes_producao || null);
        add('observacoes_producao', dados.observacoes_producao || dados.observacao_producao || null);
        add('produtos', produtosJson);
        add('produtos_json', produtosJson);
        add('arquivo_xlsx', arquivoXlsx || null);
        add('caminho_arquivo', null);
        add('criado_por', usuario?.id || null);
        add('created_by', usuario?.id || null);
        add('created_by_name', usuario?.nome || usuario?.name || usuario?.email || null);

        if (!insertColumns.length) {
            throw new Error('Schema de ordens_producao sem colunas compatíveis para gravação');
        }

        const placeholders = insertColumns.map(() => '?').join(', ');
        const [result] = await pool.query(
            `INSERT INTO ordens_producao (${insertColumns.join(', ')}) VALUES (${placeholders})`,
            values
        );
        return result.insertId;
    }

    // -------------------------------------------------------------
    // AVISO DE ORDEM DE PRODUÇÃO GERADA
    // Quem gerou a OP recebe no e-mail o resumo dela. O CNPJ não vem
    // do formulário: é buscado no cadastro do cliente.
    // -------------------------------------------------------------
    const { enviarEmail: enviarEmailZyntra, isConfigured: emailConfigurado } = require('../utils/email');
    const { templateOrdemProducao, REMETENTE_NOTIFICACOES } = require('../services/email-templates');

    async function buscarCnpjCliente(clienteId, clienteNome) {
        try {
            if (clienteId) {
                const [[linha]] = await pool.query(
                    'SELECT COALESCE(cnpj, cnpj_cpf, cpf) AS documento FROM clientes WHERE id = ? LIMIT 1',
                    [clienteId]
                );
                if (linha?.documento) return linha.documento;
            }
            if (clienteNome) {
                const [[linha]] = await pool.query(
                    `SELECT COALESCE(cnpj, cnpj_cpf, cpf) AS documento FROM clientes
                     WHERE nome = ? OR razao_social = ? OR nome_fantasia = ? LIMIT 1`,
                    [clienteNome, clienteNome, clienteNome]
                );
                if (linha?.documento) return linha.documento;
            }
        } catch (erro) {
            console.warn('[PCP/OP-EMAIL] Não foi possível resolver o CNPJ do cliente:', erro.message);
        }
        return null;
    }

    /**
     * Manda o aviso de OP gerada. Nunca estoura: a OP já está gravada e
     * uma falha de SMTP não pode derrubar a resposta da rota.
     *
     * @param {object} dados   campos da OP (nomes soltos, como vêm do form)
     * @param {object} usuario req.user
     * @param {Array}  [anexos]
     */
    async function notificarOrdemProducao(dados, usuario, anexos) {
        try {
            const destinatario = String(usuario?.email || '').trim();
            if (!destinatario) return { enviado: false, motivo: 'usuário sem e-mail cadastrado' };
            if (!emailConfigurado()) return { enviado: false, motivo: 'SMTP não configurado' };

            const clienteNome = dados.clienteNome || null;
            const mensagem = templateOrdemProducao({
                numero: dados.numero,
                clienteNome,
                clienteCnpj: dados.clienteCnpj || await buscarCnpjCliente(dados.clienteId, clienteNome),
                produto: dados.produto,
                quantidade: dados.quantidade,
                unidade: dados.unidade,
                numeroPedido: dados.numeroPedido,
                numeroOrcamento: dados.numeroOrcamento,
                dataPrevisao: dados.dataPrevisao,
                vendedor: dados.vendedor,
                prioridade: dados.prioridade,
                valorTotal: dados.valorTotal,
                observacoes: dados.observacoes,
                criadoPor: usuario?.nome || usuario?.email,
                geradaEm: new Date(),
                destinatarioNome: usuario?.nome,
                itens: dados.itens,
                comAnexo: Array.isArray(anexos) && anexos.length > 0
            });

            const resultado = await enviarEmailZyntra({
                rota: 'sistema',
                de: REMETENTE_NOTIFICACOES,
                para: destinatario,
                assunto: mensagem.assunto,
                html: mensagem.html,
                texto: mensagem.texto,
                anexos
            });

            if (resultado.success) {
                console.log(`[PCP/OP-EMAIL] ✅ ${dados.numero} → ${destinatario}`);
            } else {
                console.warn(`[PCP/OP-EMAIL] ⚠️ Falha ao avisar ${destinatario}: ${resultado.error}`);
            }
            return { enviado: resultado.success, destinatario, erro: resultado.error };
        } catch (erro) {
            console.error('[PCP/OP-EMAIL] ❌ Erro ao notificar ordem de produção:', erro.message);
            return { enviado: false, motivo: erro.message };
        }
    }

    // Rota /me para o PCP retornar dados do usuário logado
    router.get('/me', async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Não autenticado' });
            }

            // Buscar dados completos do usuário no banco com JOIN para foto do funcionário
            const [[dbUser]] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin,
                        u.permissoes_pcp as permissoes, u.foto, u.avatar,
                        f.foto_perfil_url as foto_funcionario
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON u.email = f.email
                 WHERE u.id = ?`,
                [req.user.id]
            );

            if (!dbUser) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }

            // Parse permissões
            let permissoes = [];
            if (dbUser.permissoes) {
                try {
                    permissoes = JSON.parse(dbUser.permissoes);
                } catch (e) {
                    console.error('[API/PCP/ME] Erro ao parsear permissoes:', e);
                    permissoes = [];
                }
            }

            // Determinar a foto (prioridade: avatar > foto > foto_funcionario)
            const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";

            // Retornar dados completos do usuário
            res.json({
                user: {
                    id: dbUser.id,
                    nome: dbUser.nome,
                    email: dbUser.email,
                    role: dbUser.role,
                    avatar: fotoUsuario,
                    foto: fotoUsuario,
                    foto_perfil_url: fotoUsuario,
                    is_admin: dbUser.is_admin,
                    permissoes: permissoes
                }
            });
        } catch (error) {
            console.error('[API/PCP/ME] Erro ao buscar usuário:', error);
            res.status(500).json({ message: 'Erro ao buscar dados do usuário' });
        }
    });

    // DASHBOARD / STATS DO PCP
    router.get('/dashboard', async (req, res, next) => {
        try {
            // Total de produtos (ativos ou sem flag de status)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [[produtosResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM produtos WHERE (ativo = 1 OR ativo IS NULL) AND (categoria IS NULL OR categoria != 'GERAL')`
            );

            // AUDIT-2026-07 #3: Ordens ativas — definição única (utils/status-op),
            // mesma query do dashboard geral. Antes a whitelist local divergia da
            // contagem do Dashboard (14 vs 16).
            const { SQL_OP_ATIVA } = require('../utils/status-op');
            const [[ordensResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM ordens_producao WHERE ${SQL_OP_ATIVA}`
            );

            // Produtos COM estoque (estoque_atual > 0, com fallback para quantidade_estoque)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [[produtosComEstoqueResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM produtos
                 WHERE COALESCE(estoque_atual, quantidade_estoque, 0) > 0
                 AND (ativo = 1 OR ativo IS NULL)
                 AND (categoria IS NULL OR categoria != 'GERAL')`
            );

            // Total de Materiais cadastrados
            const [[materiaisResult]] = await pool.query(
                'SELECT COUNT(*) as total FROM materiais'
            );

            // Entregas pendentes (ordens com data de previsão de entrega esta semana)
            const [[entregasResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM ordens_producao
                 WHERE status NOT IN ('concluida', 'cancelada', 'finalizada')
                 AND data_prevista IS NOT NULL
                 AND data_prevista >= CURDATE()
                 AND data_prevista <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
            );

            res.json({
                totalProdutos: produtosResult?.total || 0,
                ordensEmProducao: ordensResult?.total || 0,
                produtosComEstoque: produtosComEstoqueResult?.total || 0,
                totalMateriais: materiaisResult?.total || 0,
                entregasPendentes: entregasResult?.total || 0
            });
        } catch (error) {
            console.error('[PCP/DASHBOARD] Erro:', error);
            // Retornar valores padrão em caso de erro
            res.json({
                totalProdutos: 0,
                ordensEmProducao: 0,
                produtosComEstoque: 0,
                totalMateriais: 0,
                entregasPendentes: 0
            });
        }
    });

    // Detalhes dos quatro indicadores do dashboard. Os filtros abaixo precisam
    // permanecer alinhados com /dashboard para que o total do modal seja o mesmo
    // exibido no respectivo cartão.
    router.get('/dashboard/detalhes/:tipo', async (req, res, next) => {
        try {
            const tipo = String(req.params.tipo || '').toLowerCase();
            const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 2000, 1), 2000);
            const { SQL_OP_ATIVA } = require('../utils/status-op');

            const consultas = {
                produtos: `
                    SELECT id, codigo,
                           COALESCE(NULLIF(nome, ''), NULLIF(descricao, ''), codigo) AS descricao,
                           categoria,
                           COALESCE(estoque_atual, quantidade_estoque, 0) AS estoque,
                           COALESCE(NULLIF(unidade_medida, ''), 'UN') AS unidade
                    FROM produtos
                    WHERE (ativo = 1 OR ativo IS NULL)
                      AND (categoria IS NULL OR categoria != 'GERAL')
                    ORDER BY descricao ASC
                    LIMIT ?`,
                estoque: `
                    SELECT id, codigo,
                           COALESCE(NULLIF(nome, ''), NULLIF(descricao, ''), codigo) AS descricao,
                           categoria,
                           COALESCE(estoque_atual, quantidade_estoque, 0) AS estoque,
                           COALESCE(NULLIF(unidade_medida, ''), 'UN') AS unidade
                    FROM produtos
                    WHERE COALESCE(estoque_atual, quantidade_estoque, 0) > 0
                      AND (ativo = 1 OR ativo IS NULL)
                      AND (categoria IS NULL OR categoria != 'GERAL')
                    ORDER BY estoque DESC, descricao ASC
                    LIMIT ?`,
                ordens: `
                    SELECT id, codigo, produto_nome AS descricao, cliente, numero_pedido,
                           quantidade, COALESCE(quantidade_produzida, 0) AS quantidade_produzida,
                           COALESCE(NULLIF(unidade, ''), 'UN') AS unidade, status,
                           COALESCE(data_prevista, data_previsao_entrega) AS previsao
                    FROM ordens_producao
                    WHERE ${SQL_OP_ATIVA}
                    ORDER BY COALESCE(data_prevista, data_previsao_entrega) ASC, id DESC
                    LIMIT ?`,
                materiais: `
                    SELECT id, codigo_material AS codigo, descricao, fornecedor_padrao AS fornecedor,
                           COALESCE(quantidade_estoque, 0) AS estoque,
                           COALESCE(estoque_minimo, 0) AS estoque_minimo,
                           COALESCE(NULLIF(unidade_medida, ''), 'UN') AS unidade
                    FROM materiais
                    ORDER BY descricao ASC
                    LIMIT ?`
            };

            if (!consultas[tipo]) {
                return res.status(400).json({
                    success: false,
                    message: 'Indicador inválido. Use produtos, ordens, estoque ou materiais.'
                });
            }

            const [itens] = await pool.query(consultas[tipo], [limite]);
            return res.json({ success: true, tipo, total: itens.length, itens });
        } catch (error) {
            console.error('[PCP/DASHBOARD/DETALHES] Erro:', error);
            next(error);
        }
    });

    // Andamento dos cabos em produção — dados reais das OPs ativas.
    router.get('/dashboard/andamento-cabos', async (req, res, next) => {
        try {
            const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 12, 1), 50);

            const SELECT_OPS = (comApontamentos) => `
                SELECT op.id, op.codigo AS numero_op, op.produto_nome AS cabo,
                       op.responsavel AS cliente, op.quantidade AS quantidade_planejada,
                       COALESCE(op.quantidade_produzida, 0) AS quantidade_produzida,
                       COALESCE(op.unidade, 'MT') AS unidade, op.status,
                       op.data_inicio, op.data_prevista, op.updated_at,
                       ${comApontamentos ? `
                       COALESCE(ap.apont_qtd, 0) AS apont_qtd,
                       COALESCE(ap.apont_n, 0) AS apont_n,
                       ap.apont_primeiro, ap.apont_ultimo,` : `
                       0 AS apont_qtd, 0 AS apont_n,
                       NULL AS apont_primeiro, NULL AS apont_ultimo,`}
                       LEAST(100, GREATEST(0,
                           CASE
                               WHEN COALESCE(op.quantidade, 0) > 0
                                   THEN ROUND((COALESCE(op.quantidade_produzida, 0) / op.quantidade) * 100, 1)
                               ELSE COALESCE(op.progresso, 0)
                           END
                       )) AS percentual
                  FROM ordens_producao op
                  ${comApontamentos ? `
                  LEFT JOIN (
                        SELECT ordem_producao_id,
                               SUM(COALESCE(quantidade_produzida, 0)) AS apont_qtd,
                               COUNT(*) AS apont_n,
                               DATE_FORMAT(MIN(COALESCE(data_apontamento, DATE(created_at))), '%Y-%m-%d') AS apont_primeiro,
                               DATE_FORMAT(MAX(COALESCE(data_apontamento, DATE(created_at))), '%Y-%m-%d') AS apont_ultimo
                          FROM apontamentos_producao
                         WHERE ordem_producao_id IS NOT NULL
                           AND COALESCE(quantidade_produzida, 0) > 0
                         GROUP BY ordem_producao_id
                  ) ap ON ap.ordem_producao_id = op.id` : ''}
                 WHERE op.status NOT IN ('concluida','concluído','Concluída','finalizada','Finalizada','cancelada','Cancelada')
                   AND COALESCE(op.produto_nome, '') <> ''
                 ORDER BY
                       CASE WHEN op.status IN ('em_producao','Em Produção','em_andamento') THEN 0 ELSE 1 END,
                       COALESCE(op.data_prevista, '2999-12-31'), op.updated_at DESC
                 LIMIT ?`;

            // O JOIN com apontamentos é opcional: se a tabela/colunas não existirem nesta
            // instância o painel continua funcionando, só sem previsão calculada.
            let ordens;
            try {
                [ordens] = await pool.query(SELECT_OPS(true), [limite]);
            } catch (err) {
                console.warn('[PCP/ANDAMENTO-CABOS] Apontamentos indisponíveis para a previsão:', err.message);
                [ordens] = await pool.query(SELECT_OPS(false), [limite]);
            }

            const cabos = ordens.map(op => {
                const linha = { ...op,
                    quantidade_planejada: Number(op.quantidade_planejada) || 0,
                    quantidade_produzida: Number(op.quantidade_produzida) || 0,
                    percentual: Number(op.percentual) || 0
                };
                linha.previsao = calcularPrevisaoPorApontamentos(linha);
                // Compatibilidade: quem lê data_prevista continua recebendo a melhor data conhecida.
                linha.data_prevista = linha.previsao.data || op.data_prevista || null;
                delete linha.apont_qtd; delete linha.apont_n;
                delete linha.apont_primeiro; delete linha.apont_ultimo;
                return linha;
            });
            // AUDIT-2026-07 #3: o total do resumo é a contagem real de OPs ativas
            // (definição única de utils/status-op), não o tamanho da lista limitada
            // pelo LIMIT — que fazia o painel exibir "12 OPs" enquanto o KPI mostrava 14/16.
            const { SQL_OP_ATIVA } = require('../utils/status-op');
            const [[{ totalAtivas }]] = await pool.query(
                `SELECT COUNT(*) as totalAtivas FROM ordens_producao WHERE ${SQL_OP_ATIVA}`
            );
            res.json({ cabos, resumo: {
                total: Number(totalAtivas) || cabos.length,
                em_producao: cabos.filter(op => ['em_producao','Em Produção','em_andamento'].includes(op.status)).length,
                percentual_medio: cabos.length ? Number((cabos.reduce((s, op) => s + op.percentual, 0) / cabos.length).toFixed(1)) : 0
            }, atualizado_em: new Date().toISOString() });
        } catch (error) {
            console.error('[PCP/ANDAMENTO-CABOS] Erro:', error);
            next(error);
        }
    });

    // Detalhe de uma OP do painel "Andamento dos Cabos" (modal do card):
    // dados da ordem + previsão calculada + apontamentos que a alimentaram.
    router.get('/dashboard/andamento-cabos/:id', async (req, res, next) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ message: 'Id de ordem inválido' });
            }

            const [[op]] = await pool.query('SELECT * FROM ordens_producao WHERE id = ? LIMIT 1', [id]);
            if (!op) return res.status(404).json({ message: 'Ordem de produção não encontrada' });

            // Apontamentos desta OP (todos, inclusive os sem quantidade — paradas/setup
            // contam para o histórico mesmo sem entrar no cálculo do ritmo).
            let apontamentos = [];
            let agregado = { apont_qtd: 0, apont_n: 0, apont_primeiro: null, apont_ultimo: null };
            try {
                const [linhas] = await pool.query(
                    `SELECT id, DATE_FORMAT(COALESCE(data_apontamento, DATE(created_at)), '%Y-%m-%d') AS data,
                            tipo_atividade, nome_atividade, operador, maquina, turno,
                            COALESCE(quantidade_produzida, 0) AS quantidade_produzida,
                            COALESCE(quantidade_refugo, 0) AS quantidade_refugo,
                            COALESCE(duracao_segundos, 0) AS duracao_segundos,
                            tempo_producao, tempo_parada, observacoes, created_at
                       FROM apontamentos_producao
                      WHERE ordem_producao_id = ?
                      ORDER BY COALESCE(data_apontamento, DATE(created_at)) DESC, id DESC
                      LIMIT 100`, [id]);
                apontamentos = linhas.map(a => ({
                    ...a,
                    quantidade_produzida: Number(a.quantidade_produzida) || 0,
                    quantidade_refugo: Number(a.quantidade_refugo) || 0,
                    duracao_segundos: Number(a.duracao_segundos) || 0,
                }));
                const comQtd = apontamentos.filter(a => a.quantidade_produzida > 0);
                if (comQtd.length) {
                    const datas = comQtd.map(a => a.data).filter(Boolean).sort();
                    agregado = {
                        apont_qtd: comQtd.reduce((s, a) => s + a.quantidade_produzida, 0),
                        apont_n: comQtd.length,
                        apont_primeiro: datas[0] || null,
                        apont_ultimo: datas[datas.length - 1] || null,
                    };
                }
            } catch (err) {
                console.warn('[PCP/ANDAMENTO-CABOS/:id] Apontamentos indisponíveis:', err.message);
            }

            const planejada = Number(op.quantidade) || 0;
            const produzida = Number(op.quantidade_produzida) || 0;
            const percentual = planejada > 0
                ? Math.max(0, Math.min(100, Number(((produzida / planejada) * 100).toFixed(1))))
                : Number(op.progresso) || 0;

            const previsao = calcularPrevisaoPorApontamentos({
                quantidade_planejada: planejada,
                quantidade_produzida: produzida,
                data_prevista: op.data_prevista,
                ...agregado,
            });

            // A OP guarda os itens ora em `produtos`, ora em `produtos_json` (texto JSON).
            const listaProdutos = (() => {
                for (const campo of ['produtos', 'produtos_json']) {
                    const bruto = op[campo];
                    if (!bruto) continue;
                    if (Array.isArray(bruto)) return bruto;
                    try {
                        const parsed = JSON.parse(bruto);
                        if (Array.isArray(parsed)) return parsed;
                        if (parsed && Array.isArray(parsed.produtos)) return parsed.produtos;
                    } catch (_) { /* conteúdo não-JSON — ignora */ }
                }
                return [];
            })();

            res.json({
                ordem: {
                    id: op.id,
                    numero_op: op.codigo,
                    produto_nome: op.produto_nome,
                    cliente: op.cliente_nome || op.cliente || null,
                    responsavel: op.responsavel || null,
                    vendedor: op.vendedor_nome || op.vendedor || null,
                    status: op.status,
                    prioridade: op.prioridade,
                    maquina: op.maquina || op.extrusora || null,
                    unidade: op.unidade || 'MT',
                    quantidade_planejada: planejada,
                    quantidade_produzida: produzida,
                    restante: Math.max(0, planejada - produzida),
                    percentual,
                    revisao: op.revisao || null,
                    numero_pedido: op.numero_pedido || op.num_pedido || null,
                    pedido_id: op.pedido_vinculado_id || op.pedido_id || null,
                    tipo_frete: op.tipo_frete || null,
                    data_inicio: soData(op.data_inicio),
                    data_prevista: soData(op.data_prevista),
                    data_conclusao: soData(op.data_conclusao),
                    criada_em: op.created_at,
                    atualizada_em: op.updated_at,
                    observacoes: op.observacoes || null,
                    observacoes_pedido: op.observacoes_pedido || null,
                    observacoes_entrega: op.observacoes_entrega || null,
                },
                previsao,
                produtos: listaProdutos,
                apontamentos,
                apontamentos_total: apontamentos.length,
            });
        } catch (error) {
            console.error('[PCP/ANDAMENTO-CABOS/:id] Erro:', error);
            next(error);
        }
    });

    // ============================================
    // ALERTAS DO SISTEMA PCP
    // ============================================
    router.get('/alertas', async (req, res) => {
        try {
            const alertas = [];

            // 1. Produtos com estoque CRÍTICO (zerado)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            let produtosCriticos = [];
            try {
                [produtosCriticos] = await pool.query(`
                    SELECT codigo, nome,
                        COALESCE(estoque_atual, quantidade_estoque, 0) as estoque_atual,
                        COALESCE(estoque_minimo, 0) as estoque_minimo,
                        COALESCE(unidade_medida, unidade, 'UN') as unidade, categoria
                    FROM produtos
                    WHERE COALESCE(estoque_atual, quantidade_estoque, 0) <= 0
                    AND (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                    AND (categoria IS NULL OR categoria != 'GERAL')
                    ORDER BY nome ASC
                    LIMIT 50
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query produtos críticos falhou:', e.message); }

            if (produtosCriticos && produtosCriticos.length > 0) {
                alertas.push({
                    tipo: 'critico',
                    titulo: 'Produtos sem Estoque',
                    descricao: `${produtosCriticos.length} produto(s) com estoque zerado`,
                    icone: 'fa-exclamation-circle',
                    cor: '#ef4444',
                    detalhes: produtosCriticos.slice(0, 3).map(p => p.nome || p.codigo).join(', '),
                    total: produtosCriticos.length,
                    navegarPara: 'estoque',
                    itens: produtosCriticos.map(p => ({
                        codigo: p.codigo,
                        nome: p.nome || p.codigo,
                        estoque: parseFloat(p.estoque_atual) || 0,
                        minimo: parseFloat(p.estoque_minimo) || 0,
                        unidade: p.unidade || 'UN'
                    }))
                });
            }

            // 2. Produtos com estoque BAIXO (abaixo do mínimo)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            let produtosBaixo = [];
            try {
                [produtosBaixo] = await pool.query(`
                    SELECT codigo, nome,
                        COALESCE(estoque_atual, quantidade_estoque, 0) as estoque_atual,
                        COALESCE(estoque_minimo, 0) as estoque_minimo,
                        COALESCE(unidade_medida, unidade, 'UN') as unidade, categoria
                    FROM produtos
                    WHERE COALESCE(estoque_atual, quantidade_estoque, 0) > 0
                    AND COALESCE(estoque_atual, quantidade_estoque, 0) < COALESCE(estoque_minimo, 10)
                    AND COALESCE(estoque_minimo, 10) > 0
                    AND (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                    AND (categoria IS NULL OR categoria != 'GERAL')
                    ORDER BY estoque_atual ASC
                    LIMIT 50
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query produtos baixo falhou:', e.message); }

            if (produtosBaixo && produtosBaixo.length > 0) {
                alertas.push({
                    tipo: 'warning',
                    titulo: 'Estoque Baixo',
                    descricao: `${produtosBaixo.length} produto(s) abaixo do estoque mínimo`,
                    icone: 'fa-box-open',
                    cor: '#f59e0b',
                    detalhes: produtosBaixo.slice(0, 3).map(p => p.nome || p.codigo).join(', '),
                    total: produtosBaixo.length,
                    navegarPara: 'estoque',
                    itens: produtosBaixo.map(p => ({
                        codigo: p.codigo,
                        nome: p.nome || p.codigo,
                        estoque: parseFloat(p.estoque_atual) || 0,
                        minimo: parseFloat(p.estoque_minimo) || 0,
                        unidade: p.unidade || 'UN'
                    }))
                });
            }

            // 3. Ordens de Produção em atraso
            let ordensAtraso = [];
            try {
                [ordensAtraso] = await pool.query(`
                    SELECT id, codigo, produto_nome, data_previsao_entrega, status, cliente
                    FROM ordens_producao
                    WHERE data_previsao_entrega < CURDATE()
                    AND status NOT IN ('concluida', 'Concluída', 'cancelada', 'Cancelada', 'entregue', 'finalizada')
                    ORDER BY data_previsao_entrega ASC
                    LIMIT 20
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query ordens atraso falhou:', e.message); }

            if (ordensAtraso && ordensAtraso.length > 0) {
                alertas.push({
                    tipo: 'critico',
                    titulo: 'Ordens em Atraso',
                    descricao: `${ordensAtraso.length} ordem(s) com prazo vencido`,
                    icone: 'fa-clock',
                    cor: '#ef4444',
                    detalhes: ordensAtraso.slice(0, 3).map(o => `OP #${o.id}`).join(', '),
                    total: ordensAtraso.length,
                    navegarPara: 'ordens',
                    itens: ordensAtraso.map(o => ({
                        codigo: `OP #${o.id}`,
                        nome: o.produto_nome || o.codigo || `OP #${o.id}`,
                        info: o.cliente || '',
                        data: o.data_previsao_entrega,
                        status: o.status
                    }))
                });
            }

            // 4. Ordens pendentes há mais de 7 dias
            let ordensPendentes = [];
            try {
                [ordensPendentes] = await pool.query(`
                    SELECT id, codigo, produto_nome, created_at, status, cliente
                    FROM ordens_producao
                    WHERE status IN ('pendente', 'a_produzir', 'A Fazer')
                    AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                    ORDER BY created_at ASC
                    LIMIT 20
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query ordens pendentes falhou:', e.message); }

            if (ordensPendentes && ordensPendentes.length > 0) {
                alertas.push({
                    tipo: 'warning',
                    titulo: 'Ordens Pendentes',
                    descricao: `${ordensPendentes.length} ordem(s) aguardando há mais de 7 dias`,
                    icone: 'fa-hourglass-half',
                    cor: '#f59e0b',
                    detalhes: ordensPendentes.slice(0, 3).map(o => `OP #${o.id}`).join(', '),
                    total: ordensPendentes.length,
                    navegarPara: 'ordens',
                    itens: ordensPendentes.map(o => ({
                        codigo: `OP #${o.id}`,
                        nome: o.produto_nome || o.codigo || `OP #${o.id}`,
                        info: o.cliente || '',
                        data: o.created_at,
                        status: o.status
                    }))
                });
            }

            // 5. Materiais com estoque baixo
            try {
                const [materiaisBaixo] = await pool.query(`
                    SELECT codigo, nome, quantidade_estoque, estoque_minimo
                    FROM materiais
                    WHERE quantidade_estoque < COALESCE(estoque_minimo, 10)
                    AND COALESCE(estoque_minimo, 10) > 0
                    ORDER BY quantidade_estoque ASC
                    LIMIT 30
                `);

                if (materiaisBaixo && materiaisBaixo.length > 0) {
                    alertas.push({
                        tipo: 'warning',
                        titulo: 'Matéria-Prima Baixa',
                        descricao: `${materiaisBaixo.length} material(is) abaixo do estoque mínimo`,
                        icone: 'fa-cubes',
                        cor: '#f59e0b',
                        detalhes: materiaisBaixo.slice(0, 3).map(m => m.nome || m.codigo).join(', '),
                        total: materiaisBaixo.length,
                        navegarPara: 'materiais',
                        itens: materiaisBaixo.map(m => ({
                            codigo: m.codigo,
                            nome: m.nome || m.codigo,
                            estoque: parseFloat(m.quantidade_estoque) || 0,
                            minimo: parseFloat(m.estoque_minimo) || 0,
                            unidade: 'UN'
                        }))
                    });
                }
            } catch (e) {
                console.log('[PCP/ALERTAS] Tabela materiais não encontrada:', e.message);
            }

            res.json({
                success: true,
                alertas: alertas,
                total: alertas.length,
                totalCriticos: alertas.filter(a => a.tipo === 'critico').length,
                totalWarnings: alertas.filter(a => a.tipo === 'warning').length
            });
        } catch (error) {
            console.error('[PCP/ALERTAS] Erro:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar alertas',
                error: 'Erro interno no servidor. Tente novamente.',
                alertas: [],
                total: 0
            });
        }
    });

    // ORDENS DE PRODUÇÁO
    router.get('/ordens', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query('SELECT id, codigo, produto_nome, quantidade, status, data_previsao_entrega, numero_pedido, cliente, observacoes, time_producao, created_at, updated_at FROM ordens_producao ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/ordens', [
        body('codigo').trim().notEmpty().withMessage('Código do produto é obrigatório')
            .isLength({ max: 50 }).withMessage('Código muito longo (máx 50 caracteres)'),
        body('produto_nome').trim().notEmpty().withMessage('Nome do produto é obrigatório')
            .isLength({ max: 255 }).withMessage('Nome muito longo (máx 255 caracteres)'),
        body('quantidade').isFloat({ min: 0.01 }).withMessage('Quantidade deve ser um número positivo'),
        body('data_previsao_entrega').optional({ nullable: true, checkFalsy: true }).isDate().withMessage('Data de previsão inválida'),
        body('observacoes').optional().trim().isLength({ max: 1000 }).withMessage('Observações muito longas (máx 1000 caracteres)'),
        validate
    ], async (req, res, next) => {
        try {
            const { codigo, produto_nome, quantidade, observacoes } = req.body;
            const data_previsao_entrega = req.body.data_previsao_entrega || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const sql = 'INSERT INTO ordens_producao (codigo, produto_nome, quantidade, data_previsao_entrega, observacoes, status) VALUES (?, ?, ?, ?, ?, \'pendente\')';
            const [result] = await pool.query(sql, [codigo, produto_nome, quantidade, data_previsao_entrega, observacoes]);
            res.status(201).json({ message: 'Ordem criada com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    router.put('/ordens/:id/status', [
        param('id').isInt({ min: 1 }).withMessage('ID da ordem inválido'),
        body('status').isIn(['ativa', 'em_producao', 'pendente', 'concluida', 'cancelada'])
            .withMessage('Status inválido. Use: ativa, em_producao, pendente, concluida ou cancelada'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const updates = ['status = ?'];
            const values = [status];
            if (status === 'concluida') {
                updates.push('data_conclusao = NOW()');
            }
            updates.push('updated_at = NOW()');
            values.push(id);
            const [result] = await pool.query(
                `UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Ordem não encontrada.' });
            }
            if (status === 'concluida') {
                // Pipeline: OP concluída → pedido para "faturar"
                const pipeConn = await pool.getConnection();
                try {
                    await pipeConn.beginTransaction();
                    const [opData] = await pipeConn.query(
                        'SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]
                    );
                    if (opData.length > 0 && opData[0].pedido_id) {
                        const pedidoId = opData[0].pedido_id;
                        const [pedido] = await pipeConn.query(
                            'SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]
                        );
                        if (pedido.length > 0 && pedido[0].status === 'pedido-aprovado') {
                            await pipeConn.query(
                                'UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?',
                                [pedidoId]
                            );
                            console.log(`[PIPELINE_AUTO] Pedido #${pedidoId} movido para "faturar" (OP #${id} concluída via PUT status)`);
                        }
                    }
                    await pipeConn.commit();
                } catch (pipeErr) {
                    await pipeConn.rollback();
                    console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                } finally {
                    pipeConn.release();
                }
                // K235: registra baixa de materiais em estoque_movimentos
                registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                    console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                );
            }
            res.json({ message: 'Status atualizado com sucesso!' });
        } catch (error) { next(error); }
    });

    // MATERIAIS (com fallback para tabela produtos se materiais não existir)
    router.post('/materiais', [
        body('codigo_material').trim().notEmpty().withMessage('Código do material é obrigatório')
            .isLength({ max: 100 }).withMessage('Código muito longo (máx 100 caracteres)'),
        body('descricao').trim().notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa (máx 500 caracteres)'),
        body('unidade_medida').trim().notEmpty().withMessage('Unidade de medida é obrigatória')
            .isLength({ max: 20 }).withMessage('Unidade de medida muito longa (máx 20 caracteres)'),
        body('quantidade_estoque').isFloat({ min: 0 }).withMessage('Quantidade deve ser um número positivo'),
        body('fornecedor_padrao').optional().trim().isLength({ max: 255 }).withMessage('Fornecedor padrão muito longo'),
        validate
    ], async (req, res, next) => {
        try {
            const { codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao } = req.body;
            const sql = 'INSERT INTO materiais (codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao) VALUES (?, ?, ?, ?, ?)';
            const [result] = await pool.query(sql, [codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao]);
            res.status(201).json({ message: 'Material criado com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    router.put('/materiais/:id', [
        param('id').isInt({ min: 1 }).withMessage('ID do material inválido'),
        body('descricao').trim().notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa (máx 500 caracteres)'),
        body('unidade_medida').trim().notEmpty().withMessage('Unidade de medida é obrigatória')
            .isLength({ max: 20 }).withMessage('Unidade de medida muito longa'),
        body('quantidade_estoque').isFloat({ min: 0 }).withMessage('Quantidade deve ser um número positivo'),
        body('fornecedor_padrao').optional().trim().isLength({ max: 255 }).withMessage('Fornecedor padrão muito longo'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { descricao, unidade_medida, quantidade_estoque, fornecedor_padrao } = req.body;
            const sql = 'UPDATE materiais SET descricao = ?, unidade_medida = ?, quantidade_estoque = ?, fornecedor_padrao = ? WHERE id = ?';
            const [result] = await pool.query(sql, [descricao, unidade_medida, quantidade_estoque, fornecedor_padrao, id]);
            if (result.affectedRows > 0) {
                res.json({ message: 'Material atualizado com sucesso!' });
            } else {
                res.status(404).json({ message: 'Material não encontrado.' });
            }
        } catch (error) { next(error); }
    });

    // MATERIAIS - Deletar material
    router.delete('/materiais/:id', [
        param('id').isInt({ min: 1 }).withMessage('ID do material inválido')
    ], async (req, res, next) => {
        try {
            const { id } = req.params;

            // Verificar se material existe
            const [existing] = await pool.query('SELECT id FROM materiais WHERE id = ?', [id]);
            if (existing.length === 0) {
                return res.status(404).json({ message: 'Material não encontrado.' });
            }

            // Verificar se há dependências (ordens de compra)
            const [dependencies] = await pool.query('SELECT COUNT(*) as count FROM ordens_compra WHERE material_id = ?', [id]);
            if (dependencies[0].count > 0) {
                return res.status(400).json({
                    message: 'Não é possível excluir. Material possui ordens de compra associadas.'
                });
            }

            // Deletar material
            const [result] = await pool.query('DELETE FROM materiais WHERE id = ?', [id]);
            res.json({ message: 'Material excluído com sucesso!' });
        } catch (error) { next(error); }
    });

    // ORDENS DE COMPRA
    router.get('/ordens-compra', async (req, res, next) => {
        try {
            const sql = `SELECT oc.id, m.codigo_material, m.descricao, oc.quantidade, oc.data_pedido, oc.previsao_entrega, oc.status FROM ordens_compra oc JOIN materiais m ON oc.material_id = m.id ORDER BY oc.data_pedido DESC`;
            const [rows] = await pool.query(sql);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/ordens-compra', [
        body('material_id').isInt({ min: 1 }).withMessage('ID do material inválido'),
        body('quantidade').isFloat({ min: 0.01 }).withMessage('Quantidade deve ser um número positivo'),
        body('previsao_entrega').isDate().withMessage('Data de previsão inválida'),
        validate
    ], async (req, res, next) => {
        try {
            const { material_id, quantidade, previsao_entrega } = req.body;
            const sql = 'INSERT INTO ordens_compra (material_id, quantidade, data_pedido, previsao_entrega, status) VALUES (?, ?, CURDATE(), ?, \'Pendente\')';
            const [result] = await pool.query(sql, [material_id, quantidade, previsao_entrega]);
            res.status(201).json({ message: 'Ordem de compra criada com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });

    // ORDENS DE COMPRA - Buscar por ID
    router.get('/ordens-compra/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT oc.*, m.codigo_material, m.descricao AS material_nome
                 FROM ordens_compra oc
                 LEFT JOIN materiais m ON oc.material_id = m.id
                 WHERE oc.id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Ordem de compra não encontrada' });
            }
            res.json(rows[0]);
        } catch (error) { next(error); }
    });

    // ORDENS DE COMPRA - Atualizar
    router.put('/ordens-compra/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { fornecedor, status, previsao_entrega, observacoes, quantidade, material_id, valor_total } = req.body;

            const fields = [];
            const params = [];

            if (fornecedor !== undefined) { fields.push('fornecedor = ?'); params.push(fornecedor); }
            if (status !== undefined) { fields.push('status = ?'); params.push(status); }
            if (previsao_entrega !== undefined) { fields.push('previsao_entrega = ?'); params.push(previsao_entrega); }
            if (observacoes !== undefined) { fields.push('observacoes = ?'); params.push(observacoes); }
            if (quantidade !== undefined) { fields.push('quantidade = ?'); params.push(quantidade); }
            if (material_id !== undefined) { fields.push('material_id = ?'); params.push(material_id); }
            if (valor_total !== undefined) { fields.push('valor_total = ?'); params.push(valor_total); }

            if (fields.length === 0) {
                return res.status(400).json({ message: 'Nenhum campo para atualizar' });
            }

            params.push(id);
            const [result] = await pool.query(
                `UPDATE ordens_compra SET ${fields.join(', ')} WHERE id = ?`,
                params
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Ordem de compra não encontrada' });
            }

            res.json({ success: true, message: 'Ordem de compra atualizada com sucesso' });
        } catch (error) { next(error); }
    });

    // ORDENS DE COMPRA - Deletar
    router.delete('/ordens-compra/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [result] = await pool.query('DELETE FROM ordens_compra WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Ordem de compra não encontrada' });
            }

            res.json({ success: true, message: 'Ordem de compra excluída com sucesso' });
        } catch (error) { next(error); }
    });

    // PRODUTOS
    async function atualizarTributacaoProduto(connection, produtoId, dados = {}) {
        const colunas = await getTableColumnsSet('produtos');
        const camposPermitidos = [
            'aliquota_icms', 'aliquota_ipi', 'calcular_ipi',
            'calcular_icms_st', 'mva_st', 'aliquota_icms_st'
        ];
        const updates = [];
        const valores = [];
        for (const campo of camposPermitidos) {
            if (!colunas.has(campo) || dados[campo] === undefined) continue;
            updates.push(`\`${campo}\` = ?`);
            valores.push(['calcular_ipi', 'calcular_icms_st'].includes(campo)
                ? (dados[campo] === true || dados[campo] === 1 || dados[campo] === '1' ? 1 : 0)
                : (dados[campo] === '' ? null : dados[campo]));
        }
        if (!updates.length) return;
        valores.push(produtoId);
        await connection.query(`UPDATE produtos SET ${updates.join(', ')} WHERE id = ?`, valores);
    }

    // PRODUTOS - Listar produtos (com filtros para catálogo)
    router.get('/produtos', async (req, res, next) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 1000; // Default maior para catálogo
            const offset = (page - 1) * limit;

            // Filtros opcionais
            const categoria = req.query.categoria;
            const estoque = req.query.estoque; // 'todos', 'com-estoque', 'baixo', 'zerado'
            const search = req.query.search || req.query.q; // Aceita ambos os parâmetros
            const apenasAluforce = req.query.aluforce === 'true' || req.query.aluforce === '1';

            // Construir query base
            let whereConditions = ['status = "ativo"'];
            let queryParams = [];

            // Filtro para mostrar apenas produtos ALUFORCE CB
            if (apenasAluforce) {
                whereConditions.push('(UPPER(nome) LIKE "%ALUFORCE CB%" OR categoria = "ALUFORCE CB")');
            }

            // Filtro por categoria
            if (categoria && categoria !== 'todas' && categoria !== 'Todas as Categorias') {
                whereConditions.push('categoria = ?');
                queryParams.push(categoria);
            }

            // Filtro por estoque
            if (estoque === 'com-estoque') {
                whereConditions.push('estoque_atual > 0');
            } else if (estoque === 'baixo') {
                whereConditions.push('estoque_atual > 0 AND estoque_atual < estoque_minimo');
            } else if (estoque === 'zerado' || estoque === 'critico') {
                whereConditions.push('estoque_atual <= 0');
            }

            // Filtro por busca (código, nome, EAN-13, SKU, NCM)
            if (search) {
                const searchPattern = `%${search}%`;
                whereConditions.push('(codigo LIKE ? OR nome LIKE ? OR gtin LIKE ? OR sku LIKE ? OR ncm LIKE ?)');
                queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            }

            const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

            // Query principal com todos os campos necessários
            const query = `
                SELECT
                    id,
                    codigo,
                    nome,
                    descricao,
                    categoria,
                    gtin,
                    sku,
                    ncm,
                    estoque_atual,
                    estoque_cancelado,
                    estoque_minimo,
                    preco_custo,
                    preco_venda,
                    unidade_medida,
                    imagem_url,
                    status,
                    data_criacao
                FROM produtos
                ${whereClause}
                ORDER BY nome ASC
                LIMIT ? OFFSET ?
            `;

            queryParams.push(limit, offset);

            const [rows] = await pool.query(query, queryParams);

            // Query de contagem total
            const countQuery = `SELECT COUNT(*) as total FROM produtos ${whereClause}`;
            const [[{ total }]] = await pool.query(countQuery, queryParams.slice(0, -2)); // Remove limit e offset

            // Estatísticas adicionais para o catálogo (considerando filtro ALUFORCE)
            const statsWhere = apenasAluforce
                ? 'WHERE status = "ativo" AND (UPPER(nome) LIKE "%ALUFORCE CB%" OR categoria = "ALUFORCE CB")'
                : 'WHERE status = "ativo"';

            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total_produtos,
                    SUM(CASE WHEN estoque_atual > 0 THEN 1 ELSE 0 END) as com_estoque,
                    SUM(CASE WHEN estoque_atual > 0 AND estoque_atual < COALESCE(estoque_minimo, 5) THEN 1 ELSE 0 END) as estoque_baixo,
                    SUM(CASE WHEN estoque_atual <= 0 OR estoque_atual IS NULL THEN 1 ELSE 0 END) as critico,
                    SUM(CASE WHEN gtin IS NOT NULL AND gtin != '' THEN 1 ELSE 0 END) as com_ean
                FROM produtos
                ${statsWhere}
            `);

            res.json({
                produtos: rows,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                stats: stats[0]
            });
        } catch (error) {
            console.error('❌ Erro ao buscar produtos:', error);
            next(error);
        }
    });

    // PRODUTOS - Alertas de estoque baixo (DEVE VIR ANTES DA ROTA /:id)
    router.get('/produtos/estoque-baixo', async (req, res, next) => {
        try {
            const [rows] = await pool.query(`
                SELECT id, codigo, descricao, sku, unidade_medida,
                       quantidade_estoque, estoque_minimo
                FROM produtos
                WHERE quantidade_estoque <= estoque_minimo
                AND status = "ativo"
                ORDER BY
                    CASE
                        WHEN quantidade_estoque <= 0 THEN 0
                        WHEN quantidade_estoque <= (estoque_minimo * 0.5) THEN 1
                        ELSE 2
                    END,
                    quantidade_estoque ASC
                LIMIT 50
            `);
            res.json(rows);
        } catch (error) { next(error); }
    });

    // PRODUTOS - Autocomplete por código ou nome (DEVE VIR ANTES DA ROTA /:id)
    router.get('/produtos/search', async (req, res, next) => {
        try {
            const query = req.query.q || '';
            const limit = parseInt(req.query.limit) || 10;

            if (!query) {
                const [rows] = await pool.query('SELECT id, codigo, nome, descricao, sku, gtin, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status FROM produtos WHERE status = "ativo" LIMIT ?', [limit]);
                return res.json(completarVendedoresOP(rows));
            }

            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(`
                SELECT id, codigo, nome, descricao, sku, gtin, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status
                FROM produtos
                WHERE status = "ativo"
                AND (codigo LIKE ? OR nome LIKE ? OR sku LIKE ? OR gtin LIKE ?)
                ORDER BY
                    CASE
                        WHEN codigo = ? THEN 1
                        WHEN codigo LIKE ? THEN 2
                        WHEN nome LIKE ? THEN 3
                        ELSE 4
                    END
                LIMIT ?
            `, [searchPattern, searchPattern, searchPattern, searchPattern, query, `${query}%`, `${query}%`, limit]);
            res.json(completarVendedoresOP(rows, query));
        } catch (error) { next(error); }
    });

    // Alias: /produtos/autocomplete → mesma lógica de /produtos/search (__FIX_AUTOCOMPLETE_ALIAS__)
    router.get('/produtos/autocomplete', async (req, res, next) => {
        try {
            const query = req.query.q || req.query.termo || req.query.search || '';
            const limit = parseInt(req.query.limit) || 15;
            if (!query) {
                const [rows] = await pool.query('SELECT id, codigo, nome, descricao, sku, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status FROM produtos WHERE status = "ativo" LIMIT ?', [limit]);
                return res.json(rows);
            }
            const sp = '%' + query + '%';
            const [rows] = await pool.query(
                'SELECT id, codigo, nome, descricao, sku, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status FROM produtos WHERE status = "ativo" AND (codigo LIKE ? OR nome LIKE ? OR sku LIKE ?) ORDER BY CASE WHEN codigo = ? THEN 1 WHEN codigo LIKE ? THEN 2 WHEN nome LIKE ? THEN 3 ELSE 4 END LIMIT ?',
                [sp, sp, sp, query, query + '%', query + '%', limit]
            );
            res.json(rows);
        } catch (error) { next(error); }
    });

    // PRODUTOS - Buscar produto por ID (regex \\d+ garante que só números são capturados)
    router.get('/produtos/:id(\\d+)', async (req, res, next) => {
        try {
            const { id } = req.params;
            // Usar SELECT * para evitar ER_BAD_FIELD_ERROR em colunas que podem não existir
            const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);

            if (rows.length === 0) {
                return res.status(404).json({ message: 'Produto não encontrado' });
            }

            res.json(rows[0]);
        } catch (error) { next(error); }
    });

    // PRODUTOS - Buscar movimentações por ID do produto (regex \\d+ garante que só números são capturados)
    router.get('/produtos/:id(\\d+)/movimentacoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const limit = parseInt(req.query.limit) || 50;

            const [movimentacoes] = await pool.query(`
                SELECT
                    me.id,
                    me.tipo as tipo_movimentacao,
                    me.tipo as tipo,
                    me.quantidade,
                    me.quantidade_anterior,
                    me.quantidade_atual,
                    me.observacoes as observacao,
                    me.local as modulo_origem,
                    me.documento,
                    COALESCE(me.criado_em, me.data_movimento, me.created_at) as created_at,
                    COALESCE(me.criado_em, me.data_movimento, me.created_at) as data_movimento,
                    u.nome as usuario_nome
                FROM movimentacoes_estoque me
                LEFT JOIN usuarios u ON me.usuario_id = u.id
                WHERE me.produto_id = ?
                ORDER BY COALESCE(me.criado_em, me.data_movimento, me.created_at) DESC
                LIMIT ?
            `, [id, limit]);

            res.json({ movimentacoes: movimentacoes || [] });
        } catch (error) {
            console.error('Erro ao buscar movimentações do produto:', error);
            // Retornar vazio em caso de erro (tabela pode não existir)
            res.json({ movimentacoes: [] });
        }
    });

    // PRODUTOS - Criar novo produto
    router.post('/produtos', [
        body('codigo').notEmpty().withMessage('Código é obrigatório'),
        body('nome').notEmpty().withMessage('Nome é obrigatório')
    ], async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const {
                codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                embalagem, preco, preco_venda, preco_custo, custo_unitario, custo,
                estoque, estoque_minimo, localizacao, peso_bruto, peso_liquido,
                ncm, cest, status, unidade_medida, cor, margem, origem,
                cfop_saida_interna, obs_internas, info_adicional_produto,
                observacoes, tipo_produto, controle_lote, ativo
            } = req.body;

            const precoFinal = preco_venda || preco || 0;
            const custoFinal = custo_unitario || preco_custo || custo || 0;
            const unidadeFinal = unidade_medida || embalagem || 'UN';

            const [result] = await pool.query(`
                INSERT INTO produtos (
                    codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                    unidade_medida, preco_venda, preco_custo, custo_unitario,
                    estoque_atual, quantidade_estoque, estoque_minimo, localizacao,
                    peso_bruto, peso_liquido, ncm, cest, status, cor, margem, origem,
                    cfop_saida_interna, obs_internas, info_adicional_produto,
                    observacoes, tipo_produto, controle_lote, ativo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                codigo, sku || null, gtin || null, nome, descricao || null,
                categoria || 'GERAL', marca || null, variacao || null, unidadeFinal,
                precoFinal, custoFinal, custoFinal,
                estoque || 0, estoque || 0, estoque_minimo || 0, localizacao || null,
                peso_bruto || null, peso_liquido || null, ncm || null, cest || null,
                status || 'ativo', cor || null, margem || 0, origem || '0',
                cfop_saida_interna || '5101', obs_internas || null, info_adicional_produto || null,
                observacoes || null, tipo_produto || 'produto', controle_lote || 0, ativo !== undefined ? ativo : 1
            ]);
            await atualizarTributacaoProduto(pool, result.insertId, req.body);

            // Emitir evento WebSocket para sincronização em tempo real
            const newProduct = {
                id: result.insertId,
                codigo, sku, gtin, nome, descricao, categoria: categoria || 'GERAL',
                marca, variacao, unidade_medida: unidadeFinal,
                preco_venda: precoFinal, custo_unitario: custoFinal,
                estoque_atual: estoque || 0, estoque_minimo: estoque_minimo || 0,
                localizacao, ncm, cest, status: status || 'ativo',
                cor, tipo_produto: tipo_produto || 'produto'
            };

            // Broadcast para todos os clientes conectados
            if (global.io) {
                global.io.emit('product-created', newProduct);
                console.log('🔄 WebSocket: Produto criado emitido para todos os clientes');
            }

            res.json({
                success: true,
                message: 'Produto criado com sucesso',
                id: result.insertId
            });
        } catch (error) { next(error); }
    });

    // PRODUTOS - Atualizar produto
    router.put('/produtos/:id', [
        body('codigo').notEmpty().withMessage('Código é obrigatório'),
        body('nome').notEmpty().withMessage('Nome é obrigatório')
    ], async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { id } = req.params;
            const {
                codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                custo_unitario, preco, preco_custo, preco_venda, estoque, quantidade_estoque,
                estoque_minimo, estoque_maximo, localizacao, ncm, cest, status,
                unidade_medida, unidade, embalagem, peso, peso_bruto, peso_liquido,
                largura, altura, comprimento,
                tensao, secao, material_condutor, isolacao, norma, cor,
                fornecedor_principal, prazo_entrega, qtd_minima_compra,
                obs_internas, obs_fornecedor, obs_venda, observacoes, ativo, tipo_produto,
                margem, origem, cfop_saida_interna, info_adicional_produto, controle_lote
            } = req.body;

            // Usar valores compatíveis - priorizar campos específicos
            const custoFinal = custo_unitario || preco_custo || 0;
            const precoVendaFinal = preco_venda !== undefined ? preco_venda : (preco || 0);
            const estoqueFinal = estoque !== undefined ? estoque : (quantidade_estoque || 0);
            const unidadeFinal = unidade_medida || unidade || 'UN';
            const observacoesFinal = observacoes || null;

            console.log('[SERVER.JS PUT /produtos/:id] Dados recebidos:', { id, estoque, quantidade_estoque, estoqueFinal, preco_venda, preco, precoVendaFinal });

            const [result] = await pool.query(`
                UPDATE produtos SET
                    codigo = ?, sku = ?, gtin = ?, nome = ?, descricao = ?,
                    categoria = ?, marca = ?, variacao = ?, custo_unitario = ?,
                    preco_venda = ?, estoque_atual = ?, quantidade_estoque = ?,
                    estoque_minimo = ?, estoque_maximo = ?, localizacao = ?,
                    ncm = ?, cest = ?, status = ?, unidade_medida = ?, embalagem = ?,
                    peso = ?, peso_bruto = ?, peso_liquido = ?,
                    largura = ?, altura = ?, comprimento = ?,
                    tensao = ?, secao = ?, material_condutor = ?, isolacao = ?,
                    norma = ?, cor = ?, fornecedor_principal = ?,
                    prazo_entrega = ?, qtd_minima_compra = ?,
                    obs_internas = ?, obs_fornecedor = ?, obs_venda = ?,
                    observacoes = ?, ativo = ?, tipo_produto = ?,
                    margem = ?, origem = ?, cfop_saida_interna = ?,
                    info_adicional_produto = ?, controle_lote = ?
                WHERE id = ?
            `, [
                codigo, sku || null, gtin || null, nome, descricao || null,
                categoria || null, marca || null, variacao || null, custoFinal,
                precoVendaFinal, estoqueFinal, estoqueFinal, estoque_minimo || 0,
                estoque_maximo || null, localizacao || null, ncm || null, cest || null,
                status || 'ativo', unidadeFinal, embalagem || null,
                peso || peso_bruto || null, peso_bruto || peso || null, peso_liquido || null,
                largura || null, altura || null, comprimento || null,
                tensao || null, secao || null, material_condutor || null, isolacao || null,
                norma || null, cor || null, fornecedor_principal || null,
                prazo_entrega || 0, qtd_minima_compra || 1,
                obs_internas || null, obs_fornecedor || null, obs_venda || null,
                observacoesFinal, ativo !== undefined ? ativo : 1, tipo_produto || 'produto',
                margem || 0, origem || '0', cfop_saida_interna || '5101',
                info_adicional_produto || null, controle_lote !== undefined ? controle_lote : 0,
                id
            ]);
            await atualizarTributacaoProduto(pool, id, req.body);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Produto não encontrado' });
            }

            console.log('[SERVER.JS PUT /produtos/:id] ✅ Produto atualizado com sucesso:', { id, estoqueFinal, precoVendaFinal });

            // Emitir evento WebSocket para sincronização em tempo real
            const updatedProduct = {
                id, codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                custo_unitario: custoFinal, preco_venda: precoVendaFinal,
                estoque_atual: estoqueFinal, quantidade_estoque: estoqueFinal,
                status: status || 'ativo'
            };

            // Broadcast para todos os clientes conectados
            if (global.io) {
                global.io.emit('product-updated', updatedProduct);
                console.log(`🔄 WebSocket: Produto ${id} atualizado emitido para todos os clientes`);
            }

            res.json({
                success: true,
                message: 'Produto atualizado com sucesso'
            });
        } catch (error) { next(error); }
    });

    // PRODUTOS - Exclusão em massa. A remoção do cadastro-mestre atualiza
    // automaticamente todos os catálogos; FKs preservam históricos com SET NULL.
    router.post('/produtos/excluir-lote', async (req, res, next) => {
        let connection;
        try {
            const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
                .map(Number)
                .filter(id => Number.isInteger(id) && id > 0))];
            if (!ids.length || ids.length > 500) {
                return res.status(400).json({ success: false, message: 'Informe de 1 a 500 produtos válidos.' });
            }

            connection = await pool.getConnection();
            await connection.beginTransaction();
            const placeholders = ids.map(() => '?').join(',');
            const [produtos] = await connection.query(
                `SELECT id, codigo, nome FROM produtos WHERE id IN (${placeholders}) FOR UPDATE`,
                ids
            );
            const idsEncontrados = produtos.map(produto => Number(produto.id));
            if (idsEncontrados.length) {
                const encontradosPlaceholders = idsEncontrados.map(() => '?').join(',');
                await connection.query(
                    `DELETE FROM produtos WHERE id IN (${encontradosPlaceholders})`,
                    idsEncontrados
                );
            }
            await connection.commit();

            if (global.io && idsEncontrados.length) {
                global.io.emit('products-deleted', { ids: idsEncontrados });
                idsEncontrados.forEach(id => global.io.emit('product-deleted', { id }));
            }
            return res.json({
                success: true,
                message: `${idsEncontrados.length} produto(s) excluído(s) do sistema.`,
                excluidos: idsEncontrados,
                nao_encontrados: ids.filter(id => !idsEncontrados.includes(id))
            });
        } catch (error) {
            if (connection) {
                try { await connection.rollback(); } catch (_) { /* noop */ }
            }
            next(error);
        } finally {
            if (connection) connection.release();
        }
    });

    // PRODUTOS - Deletar produto
    router.delete('/produtos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;

            const [result] = await pool.query('DELETE FROM produtos WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Produto não encontrado' });
            }

            // Emitir evento WebSocket para sincronização em tempo real
            if (global.io) {
                global.io.emit('product-deleted', { id });
                console.log(`🔄 WebSocket: Produto ${id} excluído emitido para todos os clientes`);
            }

            res.json({
                success: true,
                message: 'Produto excluído com sucesso'
            });
        } catch (error) { next(error); }
    });

    // =====================================================
    // FATURAMENTOS - ENDPOINTS
    // =====================================================

    // FATURAMENTOS - Listar todos
    router.get('/faturamentos', async (req, res, next) => {
        try {
            // Verificar se tabela existe
            let tableExists = false;
            try {
                await pool.query('SELECT 1 FROM programacao_faturamento LIMIT 1');
                tableExists = true;
            } catch (e) {
                console.log('[API_FATURAMENTOS] Tabela programacao_faturamento não existe');
            }

            if (!tableExists) {
                // Retornar array vazio para compatibilidade com frontend
                return res.json([]);
            }

            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query(`
                SELECT id, numero, cliente_id, cliente_nome, valor, data_programada, data_vencimento,
                       condicoes_pagamento, status, tipo, observacoes, numero_nfe, chave_acesso, created_at
                FROM programacao_faturamento
                ORDER BY data_programada DESC, id DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            // Retornar array direto para compatibilidade com frontend antigo
            res.json(rows || []);
        } catch (error) {
            console.error('❌ Erro ao buscar faturamentos:', error);
            // Em caso de erro, retornar array vazio
            res.json([]);
        }
    });

    // FATURAMENTOS - Buscar por ID
    router.get('/faturamentos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM programacao_faturamento WHERE id = ?', [id]);

            if (rows.length === 0) {
                return res.status(404).json({ message: 'Faturamento não encontrado' });
            }

            res.json(rows[0]);
        } catch (error) { next(error); }
    });

    // FATURAMENTOS - Criar novo
    router.post('/faturamentos', [
        body('cliente_nome').notEmpty().withMessage('Nome do cliente é obrigatório'),
        body('valor').isNumeric().withMessage('Valor deve ser numérico'),
        body('data_programada').notEmpty().withMessage('Data programada é obrigatória')
    ], async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { numero, cliente_id, cliente_nome, valor, status, tipo, data_programada,
                data_vencimento, condicoes_pagamento, observacoes } = req.body;

            const sql = `
                INSERT INTO programacao_faturamento
                (numero, cliente_id, cliente_nome, valor, status, tipo, data_programada,
                 data_vencimento, condicoes_pagamento, observacoes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;

            const [result] = await pool.query(sql, [
                numero || `FAT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
                cliente_id || null,
                cliente_nome,
                valor,
                status || 'pendente',
                tipo || 'nfe',
                data_programada,
                data_vencimento || null,
                condicoes_pagamento || null,
                observacoes || null
            ]);

            res.status(201).json({
                success: true,
                message: 'Faturamento criado com sucesso',
                id: result.insertId
            });
        } catch (error) { next(error); }
    });

    // FATURAMENTOS - Atualizar
    router.put('/faturamentos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { cliente_nome, valor, status, tipo, data_programada, data_vencimento,
                condicoes_pagamento, numero_nfe, chave_acesso, observacoes } = req.body;

            const sql = `
                UPDATE programacao_faturamento
                SET cliente_nome = ?, valor = ?, status = ?, tipo = ?,
                    data_programada = ?, data_vencimento = ?, condicoes_pagamento = ?, numero_nfe = ?,
                    chave_acesso = ?, observacoes = ?, updated_at = NOW()
                WHERE id = ?
            `;

            const [result] = await pool.query(sql, [
                cliente_nome, valor, status, tipo, data_programada,
                data_vencimento, condicoes_pagamento, numero_nfe, chave_acesso, observacoes, id
            ]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Faturamento não encontrado' });
            }

            res.json({
                success: true,
                message: 'Faturamento atualizado com sucesso'
            });
        } catch (error) { next(error); }
    });

    // FATURAMENTOS - Deletar
    router.delete('/faturamentos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [result] = await pool.query('DELETE FROM programacao_faturamento WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Faturamento não encontrado' });
            }

            res.json({
                success: true,
                message: 'Faturamento excluído com sucesso'
            });
        } catch (error) { next(error); }
    });

    // =====================================================
    // ORDENS DE PRODUÇÃO - KANBAN (Gestão Visual)
    // =====================================================

    // GET - Próximo número de OP para o Kanban
    // ================================================================
    // CALCULADORA DE MATERIAL E BOBINA + REQUISIÇÃO DE COMPRA
    //
    // Responde, para um pedido de venda, quanto de cada matéria-prima ele
    // consome e quantas bobinas vai ocupar — tudo pela Árvore de Produto
    // (`kg_m` por insumo, `precos_kg`, `perdas_pct` e a lista de `bobinas`).
    // A conta vive em utils/calculo-material.js; aqui só entram os dados.
    // ================================================================

    const {
        calcularMaterialDoPedido,
        candidatosCodigoArvore,
        normalizarCodigo
    } = require('../utils/calculo-material');

    const CAMPOS_PIGMENTO_COMPOSICAO = [
        ['MB_PVC', 'peso_mb_pvc_kg_m'],
        ['MB_UV_PE', 'peso_mbuvpe_kg_m'],
        ['MB_UV_PT', 'peso_mbuvpt_kg_m'],
        ['MB_UV_CZ', 'peso_mbuvcz_kg_m'],
        ['MB_UV_AZ', 'peso_mbuvaz_kg_m'],
        ['MB_UV_VM', 'peso_mbuvvm_kg_m'],
        ['MB_PE_AM', 'peso_mbpeam_kg_m'],
        ['MB_PE_VD', 'peso_mbpevd_kg_m'],
        ['MB_PE_VM', 'peso_mbpevm_kg_m'],
        ['MB_PE_AZ', 'peso_mbpeaz_kg_m'],
        ['MB_PE_BC', 'peso_mbpebc_kg_m'],
        ['MB_PE_LJ', 'peso_mbpelj_kg_m'],
        ['MB_PE_MR', 'peso_mbpemr_kg_m'],
        ['MB_PVC_CZ', 'peso_mbpvccz_kg_m'],
        ['MB_PVC_PT', 'peso_mbpvcpt_kg_m']
    ];

    async function enriquecerItensComPigmentosComposicao(itens) {
        if (!Array.isArray(itens) || !itens.length) return itens;

        const candidatosPorItem = itens.map(item => candidatosCodigoArvore(item.codigo));
        const codigos = [...new Set(candidatosPorItem.flat().filter(Boolean))];
        if (!codigos.length) return itens;

        try {
            const campos = CAMPOS_PIGMENTO_COMPOSICAO.map(([, campo]) => campo).join(', ');
            const [rows] = await pool.query(
                `SELECT codigo, cores, ${campos}
                   FROM cabos_composicao
                  WHERE ativo = 1 AND codigo IN (?)`,
                [codigos]
            );

            const porCodigo = new Map();
            rows.forEach(row => porCodigo.set(normalizarCodigo(row.codigo), row));

            for (let idx = 0; idx < itens.length; idx++) {
                const row = candidatosPorItem[idx]
                    .map(c => porCodigo.get(normalizarCodigo(c)))
                    .find(Boolean);
                if (!row) continue;

                const pigmentos = {};
                for (const [insumo, campo] of CAMPOS_PIGMENTO_COMPOSICAO) {
                    const kgPorMetro = Number(row[campo]) || 0;
                    if (kgPorMetro > 0) pigmentos[insumo] = kgPorMetro;
                }

                if (Object.keys(pigmentos).length) {
                    itens[idx].pigmentos_kg_m = pigmentos;
                    itens[idx].codigo_composicao = row.codigo;
                    itens[idx].cores = row.cores || null;
                }
            }
        } catch (error) {
            console.warn('[PCP/CALCULO-MATERIAL] Pigmentos da composição indisponíveis:', error.message);
        }

        return itens;
    }

    async function itensDoPedidoParaCalculo(pedidoId) {
        const [[pedido]] = await pool.query(`
            SELECT p.id, p.numero_pedido, p.status,
                   COALESCE(c.razao_social, c.nome_fantasia, c.nome, p.cliente_nome, p.cliente) AS cliente_nome
              FROM pedidos p
              LEFT JOIN clientes c ON c.id = p.cliente_id
             WHERE p.id = ? LIMIT 1
        `, [pedidoId]);
        if (!pedido) return null;

        const [itens] = await pool.query(`
            SELECT codigo, descricao, quantidade, unidade, lances
              FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC
        `, [pedidoId]);

        await enriquecerItensComPigmentosComposicao(itens);

        return { pedido, itens };
    }

    router.get('/pedidos/:id/calculo-material', async (req, res) => {
        try {
            const pedidoId = parseInt(req.params.id, 10);
            if (!Number.isInteger(pedidoId) || pedidoId < 1) {
                return res.status(400).json({ success: false, message: 'Pedido inválido.' });
            }

            const dados = await itensDoPedidoParaCalculo(pedidoId);
            if (!dados) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
            if (!dados.itens.length) {
                return res.status(400).json({ success: false, message: 'Este pedido não tem itens para calcular.' });
            }

            const arvore = arvoreFonte.lerArvore();
            if (!arvore) {
                return res.status(503).json({ success: false, message: 'Árvore de Produto indisponível no servidor.' });
            }

            const calculo = calcularMaterialDoPedido(dados.itens, arvore);
            res.json({
                success: true,
                pedido: {
                    id: dados.pedido.id,
                    numero: dados.pedido.numero_pedido || String(dados.pedido.id),
                    cliente: dados.pedido.cliente_nome,
                    status: dados.pedido.status
                },
                ...calculo
            });
        } catch (error) {
            console.error('[PCP/CALCULO-MATERIAL] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Não foi possível calcular o material.' });
        }
    });

    // Manda para o Compras a necessidade de matéria-prima do pedido. A rota de
    // requisições montada primeiro pelo server.js usa `requisicoes_compras` +
    // `itens_requisicao`; gravar nessa tabela é o que faz a requisição aparecer
    // na tela real do Compras em todas as instâncias.
    // Quantidade pedida é o kg BRUTO: é o que precisa entrar no estoque para
    // sobrar o líquido depois da perda.
    router.post('/pedidos/:id/requisicao-material', async (req, res) => {
        let conexao;
        try {
            const pedidoId = parseInt(req.params.id, 10);
            if (!Number.isInteger(pedidoId) || pedidoId < 1) {
                return res.status(400).json({ success: false, message: 'Pedido inválido.' });
            }

            const dados = await itensDoPedidoParaCalculo(pedidoId);
            if (!dados) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            const arvore = arvoreFonte.lerArvore();
            if (!arvore) {
                return res.status(503).json({ success: false, message: 'Árvore de Produto indisponível no servidor.' });
            }

            const calculo = calcularMaterialDoPedido(dados.itens, arvore);
            const incluirBobinas = req.body?.incluir_bobinas !== false;

            const linhasCalculadas = calculo.insumos.map(i => ({
                descricao: `${i.rotulo} (${i.insumo})`,
                quantidade: i.kg_bruto,
                unidade: 'KG',
                valor_estimado: i.preco_kg,
                subtotal: i.custo,
                observacao: `Comprimento ${Number(i.comprimento_m || 0).toFixed(2)} m | Líquido ${i.kg_liquido} kg + ${i.perda_pct}% de perda`
            }));
            if (incluirBobinas) {
                for (const b of calculo.bobinas) {
                    linhasCalculadas.push({
                        descricao: `Bobina ${b.modelo} (até ${b.capacidade_kg} kg)`,
                        quantidade: b.quantidade,
                        unidade: 'UN',
                        valor_estimado: b.valor_unitario,
                        subtotal: b.custo,
                        observacao: b.insuficiente ? 'Capacidade insuficiente para o lance — conferir' : null
                    });
                }
            }
            // O cadastro de Compras exige preço estimado positivo. Não criar
            // uma linha com preço zero: ela pareceria requisitada, mas não seria
            // utilizável para cotação. O aviso deixa claro o que foi omitido.
            const linhasSemPreco = linhasCalculadas.filter(l => !(Number(l.valor_estimado) > 0));
            const linhas = linhasCalculadas.filter(l => Number(l.quantidade) > 0 && Number(l.valor_estimado) > 0);
            const avisosRequisicao = [...(calculo.avisos || [])];
            linhasSemPreco.forEach(l => avisosRequisicao.push(`${l.descricao}: preço estimado ausente; não foi incluído na requisição.`));
            if (!linhas.length) {
                return res.status(400).json({ success: false, message: 'Nada a requisitar: nenhum item do pedido tem estrutura na Árvore de Produto.' });
            }

            // Uma requisição por pedido: reenviar duplicaria a compra.
            const numeroPedido = dados.pedido.numero_pedido || String(dados.pedido.id);
            const [jaExiste] = await pool.query(
                "SELECT id, numero FROM requisicoes_compras WHERE projeto = ? AND status <> 'cancelada' ORDER BY id DESC LIMIT 1",
                [`Pedido #${numeroPedido}`]
            );
            if (jaExiste.length && req.body?.forcar !== true) {
                return res.status(409).json({
                    success: false, ja_existe: true, requisicao: jaExiste[0],
                    message: `Já existe a requisição ${jaExiste[0].numero} para o pedido #${numeroPedido}.`
                });
            }

            conexao = await pool.getConnection();
            await conexao.beginTransaction();

            const [[ultimo]] = await conexao.query(
                'SELECT numero FROM requisicoes_compras ORDER BY id DESC LIMIT 1 FOR UPDATE'
            );
            const casado = ultimo && String(ultimo.numero || '').match(/(\d+)$/);
            const numero = `REQ-${String(casado ? parseInt(casado[1], 10) + 1 : 1).padStart(4, '0')}`;

            const valorEstimado = linhas.reduce((s, l) => s + Number(l.subtotal || 0), 0);
            const [ins] = await conexao.query(`
                INSERT INTO requisicoes_compras
                    (numero, solicitante, solicitante_id, departamento, data_requisicao,
                     prioridade, projeto, justificativa, observacoes, status, valor_estimado)
                VALUES (?, ?, ?, 'Produção', CURDATE(), 'media', ?, ?, ?, 'pendente', ?)
            `, [
                numero,
                req.user?.nome || req.user?.email || 'PCP',
                req.user?.id || null,
                `Pedido #${numeroPedido}`,
                `Matéria-prima do pedido #${numeroPedido}${dados.pedido.cliente_nome ? ' — ' + dados.pedido.cliente_nome : ''}, calculada pela Árvore de Produto (${calculo.revisao || 'sem revisão'}).`,
                req.body?.observacoes || null,
                valorEstimado
            ]);

            for (const l of linhas) {
                await conexao.query(`
                    INSERT INTO itens_requisicao
                        (requisicao_id, descricao, quantidade, unidade, valor_estimado, observacao)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [ins.insertId, l.descricao, l.quantidade, l.unidade, l.valor_estimado, l.observacao]);
            }

            await conexao.commit();

            if (typeof writeAuditLog === 'function') {
                writeAuditLog({
                    userId: req.user?.id, action: 'CREATE', module: 'pcp-requisicao',
                    description: `Requisição ${numero} enviada ao Compras a partir do pedido #${numeroPedido}`,
                    newData: { pedido_id: pedidoId, numero, itens: linhas.length, valor_estimado: valorEstimado },
                    ip: req.ip, userAgent: req.headers['user-agent']
                });
            }

            console.log(`[PCP/REQUISICAO] ${numero} criada do pedido #${numeroPedido} — ${linhas.length} itens, R$ ${valorEstimado.toFixed(2)}`);
            res.status(201).json({
                success: true, numero, id: ins.insertId,
                itens: linhas.length, valor_estimado: valorEstimado,
                avisos: avisosRequisicao
            });
        } catch (error) {
            if (conexao) await conexao.rollback().catch(() => {});
            console.error('[PCP/REQUISICAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Não foi possível enviar a requisição ao Compras.' });
        } finally {
            if (conexao) conexao.release();
        }
    });

    // Mesma calculadora do ícone 🧮 individual, mas para VÁRIOS pedidos de uma vez (a
    // seleção "N selecionados" da Carteira). Concatena os itens de todos os pedidos numa
    // única chamada a calcularMaterialDoPedido — assim insumos e bobinas saem consolidados
    // entre pedidos (duas notas do mesmo insumo viram uma linha só), igual ao comportamento
    // de um pedido só. Somar os `totais` de N chamadas separadas perderia essa consolidação.
    router.post('/carteira/calculo-material-lote', async (req, res) => {
        try {
            const pedidoIds = Array.isArray(req.body?.pedido_ids)
                ? [...new Set(req.body.pedido_ids.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0))]
                : [];
            if (!pedidoIds.length) {
                return res.status(400).json({ success: false, message: 'Selecione ao menos um pedido.' });
            }
            if (pedidoIds.length > 200) {
                return res.status(400).json({ success: false, message: 'Selecione no máximo 200 pedidos por vez.' });
            }

            const arvore = arvoreFonte.lerArvore();
            if (!arvore) {
                return res.status(503).json({ success: false, message: 'Árvore de Produto indisponível no servidor.' });
            }

            const pedidosEncontrados = [];
            const pedidosSemItens = [];
            const pedidosNaoEncontrados = [];
            const todosItens = [];

            for (const id of pedidoIds) {
                const dados = await itensDoPedidoParaCalculo(id);
                if (!dados) { pedidosNaoEncontrados.push(id); continue; }
                if (!dados.itens.length) { pedidosSemItens.push(dados.pedido.numero_pedido || String(id)); continue; }
                pedidosEncontrados.push({
                    id: dados.pedido.id,
                    numero: dados.pedido.numero_pedido || String(dados.pedido.id),
                    cliente: dados.pedido.cliente_nome
                });
                todosItens.push(...dados.itens);
            }

            if (!todosItens.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Nenhum dos pedidos selecionados tem itens para calcular.'
                });
            }

            const calculo = calcularMaterialDoPedido(todosItens, arvore);
            const avisos = [...calculo.avisos];
            if (pedidosSemItens.length) avisos.push(`Sem itens cadastrados: pedido(s) ${pedidosSemItens.join(', ')}.`);
            if (pedidosNaoEncontrados.length) avisos.push(`Não encontrado(s): pedido(s) #${pedidosNaoEncontrados.join(', #')}.`);

            res.json({
                success: true,
                pedidos: pedidosEncontrados,
                total_pedidos: pedidosEncontrados.length,
                revisao: calculo.revisao,
                revisao_data: calculo.revisao_data,
                insumos: calculo.insumos,
                bobinas: calculo.bobinas,
                totais: calculo.totais,
                avisos
            });
        } catch (error) {
            console.error('[PCP/CALCULO-MATERIAL-LOTE] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Não foi possível calcular o material dos pedidos selecionados.' });
        }
    });

    router.get('/ordens-kanban/proximo-numero', async (req, res) => {
        try {
            const ano = new Date().getFullYear();
            const numero = await getNextOpCode(pool, ano, { lock: false });
            const proximoSeq = parseInt(numero.split('/')[1], 10);
            res.json({ numero, sequencial: proximoSeq, ano });
        } catch (error) {
            console.error('[PCP/PROXIMO-NUMERO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Não foi possível obter a sequência da OP' });
        }
    });

    // GET - Listar ordens para o Kanban
    router.get('/ordens-kanban', async (req, res, next) => {
        try {
            const carregarTodas = String(req.query.all || '').toLowerCase() === '1' || String(req.query.all || '').toLowerCase() === 'true';
            const limiteSolicitado = parseInt(req.query.limit, 10);
            const limite = Number.isFinite(limiteSolicitado) && limiteSolicitado > 0
                ? Math.min(limiteSolicitado, 800)
                : 350;
            const limiteSql = carregarTodas ? '' : 'LIMIT ?';
            const params = carregarTodas ? [] : [limite];

            const [rows] = await pool.query(`
                SELECT
                    op.id,
                    COALESCE(p_id.numero_pedido, p_num.numero_pedido, NULLIF(op.numero_orcamento, ''), NULLIF(op.numero_pedido, ''), NULLIF(op.num_pedido, ''), NULLIF(op.pedido_referencia, ''), op.codigo) as numero,
                    op.codigo as numero_op,
                    COALESCE(p_id.numero_pedido, p_num.numero_pedido, NULLIF(op.numero_orcamento, ''), NULLIF(op.numero_pedido, ''), NULLIF(op.num_pedido, ''), NULLIF(op.pedido_referencia, ''), op.codigo) AS numero_orcamento,
                    COALESCE(NULLIF(c_id.nome, ''), NULLIF(p_id.cliente_nome, ''), NULLIF(p_id.cliente, ''), NULLIF(c_num.nome, ''), NULLIF(p_num.cliente_nome, ''), NULLIF(p_num.cliente, ''), NULLIF(op.cliente_nome, ''), NULLIF(op.cliente, ''), 'Produção interna') AS cliente,
                    COALESCE(NULLIF(p_id.valor, 0), NULLIF(p_num.valor, 0), NULLIF(op.valor_total, 0), NULLIF(op.total_geral, 0), 0) AS valor_pedido,
                    COALESCE(
                        (
                            SELECT GROUP_CONCAT(DISTINCT NULLIF(TRIM(pi.descricao), '') SEPARATOR ', ')
                            FROM pedido_itens pi
                            WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                        ),
                        NULLIF(op.produto_nome, ''),
                        NULLIF(op.descricao_produto, '')
                    ) as produto,
                    (
                        SELECT GROUP_CONCAT(DISTINCT NULLIF(TRIM(pi.codigo), '') SEPARATOR ', ')
                        FROM pedido_itens pi
                        WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                    ) AS produto_codigo,
                    COALESCE(
                        (
                            SELECT GROUP_CONCAT(TRIM(CONCAT_WS(' - ', NULLIF(pi.codigo, ''), NULLIF(pi.descricao, ''))) SEPARATOR ', ')
                            FROM pedido_itens pi
                            WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                        ),
                        NULLIF(op.descricao_produto, ''),
                        op.produto_nome
                    ) as descricao_interna,
                    COALESCE(
                        (
                            SELECT SUM(COALESCE(pi.quantidade, 0))
                            FROM pedido_itens pi
                            WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                        ),
                        op.quantidade
                    ) AS quantidade,
                    (
                        SELECT SUM(COALESCE(pi.quantidade, 0))
                        FROM pedido_itens pi
                        WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                    ) AS quantidade_pedido,
                    op.quantidade AS quantidade_op,
                    op.quantidade_produzida as produzido,
                    COALESCE(
                        (
                            SELECT CASE
                                WHEN COUNT(*) = 0 THEN NULL
                                WHEN COUNT(DISTINCT COALESCE(NULLIF(pi.unidade, ''), 'UN')) = 1 THEN MAX(COALESCE(NULLIF(pi.unidade, ''), 'UN'))
                                ELSE 'itens'
                            END
                            FROM pedido_itens pi
                            WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                        ),
                        op.unidade
                    ) AS unidade,
                    (
                        SELECT CASE
                            WHEN COUNT(*) = 0 THEN NULL
                            WHEN COUNT(DISTINCT COALESCE(NULLIF(pi.unidade, ''), 'UN')) = 1 THEN MAX(COALESCE(NULLIF(pi.unidade, ''), 'UN'))
                            ELSE 'itens'
                        END
                        FROM pedido_itens pi
                        WHERE pi.pedido_id = COALESCE(p_id.id, p_num.id)
                    ) AS unidade_pedido,
                    op.unidade AS unidade_op,
                    op.status,
                    op.prioridade,
                    op.data_inicio,
                    -- A data reprogramada na própria OP (PUT /ordens-producao/:id grava em
                    -- op.data_prevista) manda; só quando a OP não tem data é que vale a
                    -- previsão do pedido de Vendas.
                    COALESCE(op.data_prevista, op.data_previsao_entrega, p_id.data_prevista, p_id.data_previsao, p_num.data_prevista, p_num.data_previsao) as dataConclusao,
                    op.data_conclusao,
                    op.responsavel,
                    op.progresso,
                    COALESCE(op.pedido_vinculado_id, op.pedido_id) AS pedido_id,
                    COALESCE(p_id.numero_pedido, p_num.numero_pedido, op.numero_pedido, op.num_pedido) AS numero_pedido,
                    op.observacoes,
                    op.created_at,
                    op.updated_at
                FROM ordens_producao op
                LEFT JOIN pedidos p_id ON p_id.id = COALESCE(op.pedido_vinculado_id, op.pedido_id)
                LEFT JOIN clientes c_id ON c_id.id = COALESCE(op.cliente_id, p_id.cliente_id)
                LEFT JOIN (
                    SELECT MAX(id) AS id, numero_pedido
                    FROM pedidos
                    WHERE numero_pedido IS NOT NULL
                      AND deleted_at IS NULL
                      AND COALESCE(status, '') NOT IN ('excluido', 'excluído', 'cancelado', 'cancelada')
                    GROUP BY numero_pedido
                ) p_num_ref ON p_num_ref.numero_pedido = COALESCE(
                    CASE WHEN op.numero_orcamento REGEXP '^[0-9]+$' THEN CAST(op.numero_orcamento AS UNSIGNED) ELSE NULL END,
                    CASE WHEN op.numero_pedido REGEXP '^[0-9]+$' THEN CAST(op.numero_pedido AS UNSIGNED) ELSE NULL END,
                    CASE WHEN op.num_pedido REGEXP '^[0-9]+$' THEN CAST(op.num_pedido AS UNSIGNED) ELSE NULL END,
                    CASE WHEN op.pedido_referencia REGEXP '^[0-9]+$' THEN CAST(op.pedido_referencia AS UNSIGNED) ELSE NULL END,
                    CASE
                        WHEN op.codigo REGEXP '/[0-9]+$' THEN CAST(SUBSTRING_INDEX(op.codigo, '/', -1) AS UNSIGNED)
                        WHEN op.codigo REGEXP '^[0-9]+$' THEN CAST(op.codigo AS UNSIGNED)
                        ELSE NULL
                    END
                )
                LEFT JOIN pedidos p_num ON p_num.id = p_num_ref.id
                LEFT JOIN clientes c_num ON c_num.id = p_num.cliente_id
                ORDER BY
                    CASE op.status
                        WHEN 'ativa' THEN 1
                        WHEN 'em_producao' THEN 2
                        WHEN 'pendente' THEN 3
                        WHEN 'qualidade' THEN 3
                        WHEN 'conferido' THEN 4
                        WHEN 'concluida' THEN 5
                        WHEN 'armazenado' THEN 6
                        WHEN 'cancelada' THEN 7
                        ELSE 8
                    END,
                    op.data_prevista ASC,
                    op.id DESC
                ${limiteSql}
            `, params);

            // Mapear status para o formato esperado pelo frontend
            const ordensFormatadas = rows.map(ordem => ({
                ...ordem,
                statusKanban: mapStatusToKanban(ordem.status),
                statusTexto: mapStatusToTexto(ordem.status),
                produzido: ordem.produzido || 0,
                unidade: ordem.unidade || 'M'
            }));

            res.json(ordensFormatadas);
        } catch (error) {
            console.error('❌ Erro ao listar ordens Kanban:', error);
            next(error);
        }
    });

    // POST - Criar nova ordem de produção (via modal)
    router.post('/ordens-kanban', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const {
                cliente, cliente_nome, produto, codigo, quantidade, unidade,
                data_previsao_entrega, vendedor, observacoes, observacoes_pedido, prioridade,
                numero_orcamento, tipo_frete, prazo_entrega,
                numero_pedido, num_pedido,
                pedido_id, // Sprint 2 (P-01): vínculo real pedido→OP
                produtos // Array de produtos do modal
            } = req.body;

            await connection.beginTransaction();

            // Sprint 2 (P-02): Validar status do pedido antes de gerar OP
            let pedidoVinculado = null;
            if (pedido_id) {
                const [pedidoRows] = await connection.query(
                    'SELECT id, numero_pedido, status, cliente_nome, valor FROM pedidos WHERE id = ? FOR UPDATE', [pedido_id]
                );
                if (pedidoRows.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ message: `Pedido #${pedido_id} não encontrado.` });
                }
                pedidoVinculado = pedidoRows[0];
                const statusPermitidos = ['pedido-aprovado', 'faturar', 'aprovado'];
                if (!statusPermitidos.includes(pedidoVinculado.status)) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Pedido #${pedido_id} está no status "${pedidoVinculado.status}". OP só pode ser gerada para pedidos com status: ${statusPermitidos.join(', ')}.`,
                        status_atual: pedidoVinculado.status,
                        status_permitidos: statusPermitidos
                    });
                }
                // Verificar se já existe OP para este pedido
                const [opExistente] = await connection.query(
                    'SELECT id, codigo FROM ordens_producao WHERE pedido_id = ? AND status NOT IN ("cancelada") LIMIT 1', [pedido_id]
                );
                if (opExistente.length > 0) {
                    await connection.rollback();
                    return res.status(409).json({
                        message: `Já existe uma OP ativa (${opExistente[0].codigo}) para o pedido #${pedido_id}.`,
                        op_existente: opExistente[0]
                    });
                }
            }

            // Sequência única: lê os formatos antigos e grava somente AAAA/NNNNN.
            const codigoOrdem = await getNextOpCode(connection);

            // Nome do produto (pode vir do array ou do campo direto)
            const nomeProduto = produto || (produtos && produtos[0]?.descricao) || cliente || 'Produto não especificado';
            const codigoProduto = codigo || (produtos && produtos[0]?.codigo) || '';
            const qtd = quantidade || (produtos && produtos[0]?.quantidade) || 0;
            const und = unidade || (produtos && produtos[0]?.unidade) || 'M';
            const clienteFinal = cliente || cliente_nome || pedidoVinculado?.cliente_nome || null;
            // O número que a OP cita tem de ser o MESMO que o Vendas mostra:
            // `pedidos.numero_pedido` é o número do documento lá (nasce orçamento e vira
            // pedido com o mesmo número). Nem o `id` interno do pedido nem o código da OP
            // servem — usar um deles era o que fazia o Nº Orçamento da OP não bater com o
            // do Vendas. Com pedido vinculado ele manda; só a OP avulsa usa o da tela.
            const numeroOrcamentoFinal = pedidoVinculado?.numero_pedido
                || numero_orcamento || req.body.num_orcamento || req.body['num_orçamento'] || null;
            const numeroPedidoFinal = pedidoVinculado?.numero_pedido || numero_pedido || num_pedido || null;
            const valorProdutos = Array.isArray(produtos)
                ? produtos.reduce((total, item) => total + Number(item.valor_total || item.subtotal || ((Number(item.quantidade) || 0) * (Number(item.valor_unitario) || 0))), 0)
                : 0;
            const valorTotalFinal = Number(pedidoVinculado?.valor || req.body.valor_total || req.body.total_geral || valorProdutos || 0);

            // Observações - aceita ambos os campos
            const obs = observacoes || observacoes_pedido || null;

            const [result] = await connection.query(`
                INSERT INTO ordens_producao (
                    codigo, produto_nome, quantidade, unidade,
                    status, prioridade, data_prevista, responsavel, observacoes,
                    progresso, quantidade_produzida, pedido_id, pedido_vinculado_id,
                    numero_pedido, numero_orcamento, cliente, cliente_nome,
                    codigo_produto, descricao_produto, valor_total, total_geral, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'ativa', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                codigoOrdem,
                `${nomeProduto}${codigoProduto ? ' - ' + codigoProduto : ''}`,
                qtd,
                und,
                prioridade || 'media',
                data_previsao_entrega || null,
                vendedor || null,
                obs,
                pedido_id || null,
                pedido_id || null,
                numeroPedidoFinal,
                numeroOrcamentoFinal,
                clienteFinal,
                clienteFinal,
                codigoProduto || null,
                nomeProduto || null,
                valorTotalFinal || 0,
                valorTotalFinal || 0
            ]);

            // Sprint 2 (P-01): Marcar pedido com produção iniciada
            if (pedido_id) {
                try {
                    await connection.query(
                        'UPDATE pedidos SET producao_iniciada = 1 WHERE id = ?', [pedido_id]
                    );
                } catch (colErr) {
                    // Coluna producao_iniciada pode não existir — ignorar silenciosamente
                    console.warn('⚠️ Não foi possível marcar producao_iniciada no pedido:', colErr.message);
                }
            }

            await connection.commit();

            const novaOrdem = {
                id: result.insertId,
                numero: codigoOrdem,
                numero_op: codigoOrdem,
                numero_orcamento: numeroOrcamentoFinal,
                cliente: clienteFinal,
                cliente_nome: clienteFinal,
                valor_pedido: valorTotalFinal || 0,
                produto: nomeProduto,
                codigo: codigoProduto,
                quantidade: qtd,
                produzido: 0,
                unidade: und,
                status: 'ativa',
                statusKanban: 'a_produzir',
                statusTexto: 'Nova',
                dataConclusao: data_previsao_entrega,
                prioridade: prioridade || 'media',
                pedido_id: pedido_id || null
            };

            console.log('✅ Ordem de produção criada:', codigoOrdem, pedido_id ? `(Pedido #${pedido_id})` : '');

            notificarOrdemProducao({
                numero: codigoOrdem,
                clienteNome: cliente,
                clienteId: req.body.cliente_id,
                produto: nomeProduto,
                quantidade: qtd,
                unidade: und,
                // O e-mail cita os mesmos números gravados na OP — antes mandava o `id`
                // interno do pedido, que não existe para quem lê o aviso.
                numeroPedido: numeroPedidoFinal,
                numeroOrcamento: numeroOrcamentoFinal,
                dataPrevisao: data_previsao_entrega,
                vendedor,
                prioridade: prioridade || 'media',
                observacoes: obs,
                itens: Array.isArray(produtos) ? produtos : []
            }, req.user).catch((erro) => console.error('[PCP/OP-EMAIL] Erro assíncrono:', erro.message));

            res.status(201).json(novaOrdem);
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao criar ordem Kanban:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // PUT - Atualizar ordem de produção (Kanban)
    router.put('/ordens-kanban/:id', async (req, res) => {
        const { id } = req.params;
        const { status, statusKanban, produzido, quantidade_produzida, progresso, observacoes } = req.body;

        console.log(`[API_PCP] Atualizando ordem de produção ${id}...`);

        try {
            // Sprint 4.4: Usar mapKanbanToStatus centralizado (aceita kanban e DB status)
            const rawStatus = status || statusKanban;
            let dbStatus = rawStatus ? mapKanbanToStatus(rawStatus) : null;

            const updates = [];
            const values = [];

            if (dbStatus) {
                updates.push('status = ?');
                values.push(dbStatus);
                // Se concluída, registrar data
                if (dbStatus === 'concluida') {
                    updates.push('data_conclusao = NOW()');
                }
            }

            if (produzido !== undefined || quantidade_produzida !== undefined) {
                updates.push('quantidade_produzida = ?');
                values.push(produzido || quantidade_produzida);
            }

            if (progresso !== undefined) {
                updates.push('progresso = ?');
                values.push(progresso);
            }

            if (observacoes !== undefined) {
                updates.push('observacoes = ?');
                values.push(observacoes);
            }

            updates.push('updated_at = NOW()');
            values.push(id);

            // Se for concluir, verifica ANTES se já estava concluída — evita duplicar a baixa
            // de estoque e o avanço do pedido caso a mesma conclusão seja enviada de novo.
            let jaEstavaConcluida = false;
            if (dbStatus === 'concluida') {
                const [statusAtualRows] = await pool.query('SELECT status FROM ordens_producao WHERE id = ?', [id]);
                jaEstavaConcluida = statusAtualRows.length > 0 && statusAtualRows[0].status === 'concluida';
            }

            if (updates.length > 1) {
                const [result] = await pool.query(
                    `UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = ?`,
                    values
                );

                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'Ordem não encontrada' });
                }

                if (dbStatus === 'concluida' && !jaEstavaConcluida) {
                    // Pipeline: OP concluída → pedido para "faturar"
                    const pipeConn = await pool.getConnection();
                    try {
                        await pipeConn.beginTransaction();
                        const [opData] = await pipeConn.query('SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]);
                        if (opData.length > 0 && opData[0].pedido_id) {
                            const pedidoId = opData[0].pedido_id;
                            const [pedido] = await pipeConn.query('SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]);
                            if (pedido.length > 0 && pedido[0].status === 'pedido-aprovado') {
                                await pipeConn.query('UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?', [pedidoId]);
                                console.log(`[PIPELINE_AUTO] Pedido #${pedidoId} movido para "faturar" (OP #${id} concluída)`);
                            }
                        }
                        await pipeConn.commit();
                    } catch (pipeErr) {
                        await pipeConn.rollback();
                        console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                    } finally {
                        pipeConn.release();
                    }

                    // BLOCO K: registra baixa de materiais em estoque_movimentos (K235/K270)
                    registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                        console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                    );
                }

                console.log(`✅ Ordem ${id} atualizada`);
                res.json({ success: true, message: 'Ordem atualizada com sucesso' });
            } else {
                res.json({ success: true, message: 'Nenhuma alteração necessária' });
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar ordem:', error);
            res.status(500).json({ error: 'Erro ao atualizar ordem de produção' });
        }
    });
    // PATCH - Atualizar ordem (status, quantidade produzida, etc)
    router.patch('/ordens-kanban/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status, produzido, quantidade_produzida, responsavel, observacoes } = req.body;

            const updates = [];
            const params = [];

            if (status) {
                const statusDB = mapKanbanToStatus(status);
                updates.push('status = ?');
                params.push(statusDB);

                // Se concluída, registrar data de conclusão
                if (statusDB === 'concluida') {
                    updates.push('data_conclusao = NOW()');
                    updates.push('data_finalizacao = NOW()');
                }
            }

            if (produzido !== undefined || quantidade_produzida !== undefined) {
                const qtdProduzida = produzido ?? quantidade_produzida;
                updates.push('quantidade_produzida = ?');
                params.push(qtdProduzida);

                // Calcular progresso automaticamente
                const [ordemAtual] = await pool.query('SELECT quantidade FROM ordens_producao WHERE id = ?', [id]);
                if (ordemAtual.length > 0 && ordemAtual[0].quantidade > 0) {
                    const progresso = Math.min(100, (qtdProduzida / ordemAtual[0].quantidade) * 100);
                    updates.push('progresso = ?');
                    params.push(progresso.toFixed(2));
                }
            }

            if (responsavel) {
                updates.push('responsavel = ?');
                params.push(responsavel);
            }

            if (observacoes !== undefined) {
                updates.push('observacoes = ?');
                params.push(observacoes);
            }

            if (updates.length === 0) {
                return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
            }

            updates.push('updated_at = NOW()');
            params.push(id);

            await pool.query(`
                UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = ?
            `, params);

            if (status) {
                const statusDBPatch = mapKanbanToStatus(status);
                if (statusDBPatch === 'concluida') {
                    const pipeConn = await pool.getConnection();
                    try {
                        await pipeConn.beginTransaction();
                        const [opDataPatch] = await pipeConn.query('SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]);
                        if (opDataPatch.length > 0 && opDataPatch[0].pedido_id) {
                            const pedidoIdPatch = opDataPatch[0].pedido_id;
                            const [pedidoPatch] = await pipeConn.query('SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoIdPatch]);
                            if (pedidoPatch.length > 0 && pedidoPatch[0].status === 'pedido-aprovado') {
                                await pipeConn.query('UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?', [pedidoIdPatch]);
                                console.log(`[PIPELINE_AUTO] Pedido #${pedidoIdPatch} movido para "faturar" (OP #${id} concluída via PATCH)`);
                            }
                        }
                        await pipeConn.commit();
                    } catch (pipeErr) {
                        await pipeConn.rollback();
                        console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                    } finally {
                        pipeConn.release();
                    }

                    // BLOCO K: registra baixa de materiais em estoque_movimentos (K235/K270)
                    registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                        console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                    );
                }
            }

            // Buscar ordem atualizada
            const [ordemAtualizada] = await pool.query(`
                SELECT * FROM ordens_producao WHERE id = ?
            `, [id]);

            console.log('✅ Ordem', id, 'atualizada');
            res.json({
                sucesso: true,
                ordem: ordemAtualizada[0]
            });
        } catch (error) {
            console.error('❌ Erro ao atualizar ordem Kanban:', error);
            next(error);
        }
    });

    // DELETE - Excluir ordem de produção
    // AUDIT-FIX DB-003: Added transaction + cascade cleanup for child tables
    router.delete('/ordens-kanban/:id', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            await connection.beginTransaction();

            // Clean up child tables first
            try { await connection.query('DELETE FROM tarefas_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM historico_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM anexos_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM apontamentos_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM itens_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}

            const [result] = await connection.query('DELETE FROM ordens_producao WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ erro: 'Ordem não encontrada' });
            }

            await connection.commit();
            console.log('✅ Ordem', id, 'excluída com cascata');
            res.json({ sucesso: true, mensagem: 'Ordem excluída com sucesso' });
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao excluir ordem Kanban:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // Funções auxiliares para mapeamento de status
    function mapStatusToKanban(status) {
        const map = {
            'ativa': 'a_produzir',
            'em_producao': 'produzindo',
            // 'pendente' é o valor legado (antes de qualidade/conferido terem status próprios)
            // — mantido apontando para "qualidade" para não mudar a coluna de OPs antigas.
            'pendente': 'qualidade',
            'qualidade': 'qualidade',
            'conferido': 'conferido',
            // 'concluida' é o valor legado de concluido/armazenado (antes de terem status
            // próprios) — mantido apontando para "concluido" para não mudar OPs antigas.
            'concluida': 'concluido',
            'armazenado': 'armazenado',
            'cancelada': 'cancelado'
        };
        return map[status] || 'a_produzir';
    }

    function mapStatusToTexto(status) {
        const map = {
            'ativa': 'A Produzir',
            'em_producao': 'Produzindo',
            'pendente': 'Em Qualidade',
            'qualidade': 'Em Qualidade',
            'conferido': 'Conferido',
            'concluida': 'Concluída',
            'armazenado': 'Armazenado',
            'cancelada': 'Cancelada'
        };
        return map[status] || 'Nova';
    }

    function mapKanbanToStatus(statusKanban) {
        const map = {
            // Kanban → DB (cada coluna agora grava seu próprio status distinto, para
            // não perder a posição no kanban ao recarregar — antes "qualidade" e
            // "conferido" gravavam o mesmo valor 'pendente', e "concluido"/"armazenado"
            // gravavam o mesmo valor 'concluida', fazendo o card "voltar" para a
            // coluna errada após um refresh)
            'a_produzir': 'ativa',
            'produzindo': 'em_producao',
            'qualidade': 'qualidade',
            'conferido': 'conferido',
            'concluido': 'concluida',
            'armazenado': 'armazenado',
            'cancelado': 'cancelada',
            // Identity (já é DB status)
            'ativa': 'ativa',
            'em_producao': 'em_producao',
            'pendente': 'pendente',
            'concluida': 'concluida',
            'cancelada': 'cancelada'
        };
        return map[statusKanban] || 'ativa';
    }

    // ORDENS DE PRODUÇÃO - ENDPOINTS LEGADOS
    router.get('/ordens-producao', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 300, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query(`
                SELECT id, codigo_produto, descricao_produto, quantidade, status, data_previsao_entrega,
                       num_pedido, numero_pedido, cliente, observacoes, NULL AS setor, created_at, updated_at
                FROM ordens_producao
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            res.json({
                success: true,
                data: rows
            });
        } catch (error) { next(error); }
    });

    router.post(['/ordens-producao', '/gerar-ordem-excel'], async (req, res, next) => {
        try {
            const dadosOrdem = normalizarDadosOrdemProducao(req.body);

            if (!dadosOrdem.cliente && !dadosOrdem.cliente_nome) {
                return res.status(400).json({ message: 'Cliente é obrigatório para gerar a ordem de produção.' });
            }

            if (!dadosOrdem.produtos.length) {
                return res.status(400).json({ message: 'Informe ao menos um item para gerar a ordem de produção.' });
            }

            if (dadosOrdem.transportadora_email_nfe && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dadosOrdem.transportadora_email_nfe)) {
                return res.status(400).json({ message: 'E-mail NFe da transportadora inválido.' });
            }

            if (dadosOrdem.transportadora_cpf_cnpj) {
                const doc = String(dadosOrdem.transportadora_cpf_cnpj).replace(/\D/g, '');
                if (doc && !(doc.length === 11 || doc.length === 14)) {
                    return res.status(400).json({ message: 'CPF/CNPJ da transportadora inválido.' });
                }
            }

            const ExcelJS = require('exceljs');
            const templatePath = path.join(__dirname, '..', 'modules', 'PCP', 'Ordem de Produção.xlsx');
            const nomeCliente = (dadosOrdem.cliente || dadosOrdem.cliente_nome || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
            const nomeArquivo = `Ordem de Produção - ${nomeCliente || 'Cliente'} - ERP.xlsx`;
            let fileBuffer;
            let contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            let downloadName = nomeArquivo;

            try {
                if (!fs.existsSync(templatePath)) throw new Error(`Template não encontrado: ${templatePath}`);
                fileBuffer = await gerarExcelOrdemProducaoCompleta(dadosOrdem, ExcelJS, templatePath);
            } catch (excelError) {
                console.warn('[PCP/OP] Fallback CSV após falha ao gerar XLSX:', excelError.message);
                fileBuffer = await gerarExcelOrdemProducaoFallback(dadosOrdem);
                contentType = 'text/csv; charset=utf-8';
                downloadName = nomeArquivo.replace(/\.xlsx$/i, '.csv');
            }

            const ordemId = await persistirOrdemProducaoGerada(dadosOrdem, req.user, downloadName);
            res.setHeader('X-Ordem-Producao-Id', String(ordemId));

            // Fila automática PCP → Vendas: assim que a OP é gerada, o pedido de origem
            // avança direto para "Aguardando Faturamento". Antes disso, o PCP tinha que
            // gerar a OP aqui E depois abrir o Vendas só para arrastar o card — esse
            // segundo passo manual deixa de existir. Só move pedidos que ainda estão em
            // etapa anterior (não mexe se já faturado/cancelado/etc.), e uma falha aqui
            // não pode derrubar a geração da OP em si (por isso fica fora da transação
            // e não propaga erro).
            const pedidoOrigemId = dadosOrdem.pedido_id || dadosOrdem.pedido_vinculado_id || null;
            if (pedidoOrigemId) {
                try {
                    const [movResult] = await pool.query(
                        `UPDATE pedidos
                            SET status = 'aguardando-faturamento', updated_at = NOW()
                          WHERE id = ?
                            AND status IN ('orcamento','orçamento','analise','analise-credito','aprovado','pedido-aprovado')`,
                        [pedidoOrigemId]
                    );
                    if (movResult.affectedRows > 0) {
                        console.log(`[PIPELINE_AUTO] Pedido #${pedidoOrigemId} movido para "aguardando-faturamento" após geração da OP ${ordemId}`);
                    }
                } catch (moveErr) {
                    console.error(`[PIPELINE_AUTO] Falha ao mover pedido #${pedidoOrigemId} para "aguardando-faturamento" após OP ${ordemId}:`, moveErr.message);
                }
            }

            // Aviso por e-mail com a planilha anexa. Assíncrono de propósito:
            // a resposta é o download do arquivo e não pode esperar o SMTP.
            const itensOrdem = dadosOrdem.produtos || [];
            const quantidadeTotalOrdem = itensOrdem.reduce((soma, item) => soma + (parseFloat(item.quantidade) || 0), 0);
            notificarOrdemProducao({
                numero: dadosOrdem.numero_ordem || dadosOrdem.codigo || `OP-${ordemId}`,
                clienteNome: dadosOrdem.cliente || dadosOrdem.cliente_nome,
                clienteId: dadosOrdem.cliente_id,
                clienteCnpj: dadosOrdem.cliente_cnpj || dadosOrdem.cnpj,
                produto: itensOrdem[0]?.descricao || itensOrdem[0]?.nome || dadosOrdem.produto_nome,
                quantidade: quantidadeTotalOrdem,
                unidade: itensOrdem[0]?.unidade || dadosOrdem.unidade,
                numeroPedido: dadosOrdem.numero_pedido,
                numeroOrcamento: dadosOrdem.numero_orcamento || dadosOrdem.num_orcamento,
                dataPrevisao: dadosOrdem.data_previsao_entrega || dadosOrdem.prazo_entrega,
                vendedor: dadosOrdem.vendedor || dadosOrdem.vendedor_nome,
                prioridade: dadosOrdem.prioridade,
                valorTotal: dadosOrdem.valor_total,
                observacoes: dadosOrdem.observacao_producao || dadosOrdem.observacoes,
                itens: itensOrdem
            }, req.user, [{ filename: downloadName, content: Buffer.from(fileBuffer), contentType }])
                .catch((erro) => console.error('[PCP/OP-EMAIL] Erro assíncrono:', erro.message));

            const encodedFilename = encodeURIComponent(downloadName).replace(/'/g, '%27');
            const asciiFilename = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
            const buffer = Buffer.from(fileBuffer);

            res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', buffer.length);
            res.send(buffer);
        } catch (error) {
            console.error('[PCP/OP] Erro ao gerar/persistir ordem de produção:', error);
            next(error);
        }
    });

    // ÚLTIMO PEDIDO - Para gerar número sequencial
    router.get('/ultimo-pedido', async (req, res, next) => {
        try {
            // Buscar último número de pedido registrado
            const [rows] = await pool.query(`
                SELECT numero_pedido, num_pedido
                FROM ordens_producao
                WHERE numero_pedido IS NOT NULL OR num_pedido IS NOT NULL
                ORDER BY id DESC
                LIMIT 1
            `);

            let ultimoNumero = null;

            if (rows.length > 0) {
                // Pegar o primeiro campo não-nulo
                ultimoNumero = rows[0].numero_pedido || rows[0].num_pedido;

                // Se for string, tentar converter para número
                if (typeof ultimoNumero === 'string') {
                    ultimoNumero = ultimoNumero.replace(/\D/g, ''); // Remove não-dígitos
                }
            }

            res.json({
                success: true,
                ultimo_numero: ultimoNumero
            });
        } catch (error) {
            console.error('❌ Erro ao buscar último pedido:', error);
            next(error);
        }
    });

    // ENDPOINT DE HEALTH CHECK PARA MONITORAMENTO
    router.get('/health', (req, res) => {
        const healthInfo = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            version: (() => { try { return require('../package.json').version; } catch(e) { return '2.0.0'; } })(),
            environment: process.env.NODE_ENV || 'development',
            database: DB_AVAILABLE ? 'connected' : 'disconnected',
            features: {
                excel_generation: true,
                pdf_generation: false,
                auto_backup: process.env.BACKUP_ENABLED === 'true',
                monitoring: process.env.MONITORING_ENABLED === 'true'
            }
        };

        res.status(200).json(healthInfo);
    });

    // ENDPOINT DE MÉTRICAS PARA MONITORAMENTO AVANÇADO
    // SECURITY: Requer autenticação de administrador para evitar exposição de informações do sistema
    router.get('/metrics', authenticateToken, authorizeAdmin, (req, res) => {
        const metrics = {
            timestamp: new Date().toISOString(),
            process: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                version: process.version,
                platform: process.platform
            },
            application: {
                name: 'Zyntra v2.0',
                version: (() => { try { return require('../package.json').version; } catch(e) { return '2.0.0'; } })(),
                environment: process.env.NODE_ENV || 'development'
            },
            database: {
                status: DB_AVAILABLE ? 'connected' : 'disconnected',
                pool_connections: DB_AVAILABLE ? 'active' : 'inactive'
            }
        };

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(`# Zyntra v2.0 Metrics
    aluforce_uptime_seconds ${metrics.process.uptime}
    aluforce_memory_used_bytes ${metrics.process.memory.heapUsed}
    aluforce_memory_total_bytes ${metrics.process.memory.heapTotal}
    aluforce_database_connected ${DB_AVAILABLE ? 1 : 0}
    aluforce_app_version_info{version="${metrics.application.version}",environment="${metrics.application.environment}"} 1
    `);
    });

    // [REFACTORED] Editor de Templates (CRUD, export/import, customizacao)
    require('./pcp/templates-routes')(router, deps);

    // [REFACTORED] Gestao de Clientes (CRUD, autocomplete, historico)
    require('./pcp/clientes-routes')(router, deps);

    // API para listar usuários (para avatar no login do PCP)
    // SECURITY: Requer autenticação
    router.get('/users-list', authenticateToken, async (req, res) => {
        try {
            // Buscar usuários de funcionários para exibir avatar no login
            const [users] = await pool.query(`
                SELECT id, nome_completo as nome, email, departamento as role, foto_perfil_url, foto_thumb_url
                FROM funcionarios
                WHERE ativo = 1 OR ativo IS NULL
                ORDER BY nome_completo
            `);

            // Mapear avatares por nome
            const avatarMap = {
                'douglas': '/avatars/douglas.webp',
                'andreia': '/avatars/andreia.webp',
                'ti': '/avatars/ti.webp',
                'clemerson': '/avatars/clemerson.webp',
                'thiago': '/avatars/thiago.webp',
                'guilherme': '/avatars/guilherme.webp',
                'junior': '/avatars/junior.webp',
                'hellen': '/avatars/hellen.webp',
                'antonio': '/avatars/antonio.webp',
                'egidio': '/avatars/egidio.webp'
            };

            // Retornar dados sanitizados (sem senhas)
            const sanitizedUsers = users.map(user => {
                const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
                let fotoUrl = user.foto_perfil_url || user.foto_thumb_url || avatarMap[firstName] || '/avatars/default.webp';

                return {
                    id: user.id,
                    nome: user.nome,
                    email: user.email,
                    role: user.role,
                    foto_url: fotoUrl
                };
            });

            res.json({ users: sanitizedUsers });
        } catch (err) {
            console.error('/api/pcp/users-list error:', err && err.message ? err.message : err);
            res.status(500).json({ message: 'Erro ao obter lista de usuários.', users: [] });
        }
    });

    // [REMOVIDA] Rota /dashboard duplicada com queries hardcoded para 'Aluforce'.
    // A rota principal /dashboard (linha ~138) é genérica e funciona para todas as empresas.

    // [REFACTORED] Diario de Producao (registro diario, CRUD)
    require('./pcp/diario-producao-routes')(router, deps);

    // SECURITY: Requer autenticação
    router.get('/materiais', authenticateToken, async (req, res) => {
        try {
            console.log('📦 Buscando materiais...');

            const { termo, q, tipo, limit: queryLimit } = req.query;
            const busca = termo || q || ''; // Aceitar tanto 'termo' quanto 'q'
            // SECURITY: Limitar range de resultados para evitar abuso (1-2000)
            const limit = Math.min(Math.max(parseInt(queryLimit) || 1000, 1), 2000);

            let query = `
                SELECT
                    id,
                    codigo_material,
                    descricao,
                    unidade_medida,
                    custo_unitario,
                    quantidade_estoque,
                    fornecedor_padrao
                FROM materiais
                WHERE 1=1
            `;
            let params = [];

            // Filtro por termo de busca
            if (busca && busca.length >= 2) {
                query += ` AND (codigo_material LIKE ? OR descricao LIKE ?)`;
                const termoLike = `%${busca}%`;
                params.push(termoLike, termoLike);
            }

            // Filtro por tipo (Veias, Cabos, Cordas, Outros)
            if (tipo) {
                const tipoLower = tipo.toLowerCase();
                if (tipoLower === 'veias') {
                    query += ` AND (descricao LIKE '%VEIA%' OR descricao LIKE '%MULTIPLEX%')`;
                } else if (tipoLower === 'cabos') {
                    query += ` AND descricao LIKE '%CABO%'`;
                } else if (tipoLower === 'cordas') {
                    query += ` AND (descricao LIKE '%CORDA%' OR descricao LIKE '%CORDINHA%')`;
                } else if (tipoLower === 'outros') {
                    query += ` AND descricao NOT LIKE '%VEIA%' AND descricao NOT LIKE '%MULTIPLEX%' AND descricao NOT LIKE '%CABO%' AND descricao NOT LIKE '%CORDA%' AND descricao NOT LIKE '%CORDINHA%'`;
                }
            }

            query += ` ORDER BY descricao LIMIT ${limit}`;

            console.log('📦 Query materiais:', query, 'Params:', params);

            const [materiais] = await pool.query(query, params);

            // Formatar resposta
            const materiaisFormatados = materiais.map(material => ({
                id: material.id,
                codigo_material: material.codigo_material || '',
                descricao: material.descricao || '',
                unidade_medida: material.unidade_medida || 'UN',
                preco_unitario: parseFloat(material.custo_unitario) || 0,
                quantidade_estoque: parseFloat(material.quantidade_estoque) || 0,
                fornecedor_padrao: material.fornecedor_padrao || '',
                categoria: 'Material'
            }));

            console.log(`✅ Encontrados ${materiaisFormatados.length} materiais`);
            res.json(materiaisFormatados);

        } catch (error) {
            console.error('❌ Erro ao buscar materiais:', error);
            res.status(500).json({ error: 'Erro ao buscar materiais' });
        }
    });

    // API para buscar produtos com entrada registrada (movimentações de estoque)
    // SECURITY: Requer autenticação
    router.get('/produtos/com-entrada', authenticateToken, async (req, res) => {
        console.log('[API_PRODUTOS_COM_ENTRADA] Requisição recebida');
        try {
            let page = parseInt(req.query.page, 10) || 1;
            let limit = parseInt(req.query.limit, 10) || 1000;
            if (page < 1) page = 1;
            if (limit < 1) limit = 10;
            const offset = (page - 1) * limit;

            let rows = [];
            let total = 0;
            let strategy = 'none';

            // Tentativa 0 (PREFERIDA): produtos com saldo FÍSICO real em estoque_saldos —
            // a fonte de verdade do estoque. produtos.estoque_atual está zerado, então sem
            // isto a tela mostrava 0 / poucos itens. Casa por codigo = codigo_material.
            if (total === 0) {
                try {
                    const sql0 = `
                        SELECT p.*, s.quantidade_fisica AS saldo_fisico,
                               s.quantidade_disponivel AS saldo_disponivel,
                               s.quantidade_reservada AS saldo_reservado
                        FROM produtos p
                        INNER JOIN estoque_saldos s ON s.codigo_material COLLATE utf8mb4_general_ci = p.codigo COLLATE utf8mb4_general_ci
                        WHERE s.quantidade_fisica > 0 AND (p.status = 'ativo' OR p.status IS NULL)
                        ORDER BY COALESCE(p.descricao, p.nome) ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql0, [limit, offset]);
                    const [count0] = await pool.query(`
                        SELECT COUNT(*) AS total
                        FROM produtos p
                        INNER JOIN estoque_saldos s ON s.codigo_material COLLATE utf8mb4_general_ci = p.codigo COLLATE utf8mb4_general_ci
                        WHERE s.quantidade_fisica > 0 AND (p.status = 'ativo' OR p.status IS NULL)
                    `);
                    total = count0[0]?.total || 0;
                    if (total > 0) strategy = 'estoque_saldos';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 0 (estoque_saldos):', total);
                } catch (err0) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] estoque_saldos falhou:', err0.message);
                }
            }

            // Tentativa 1: tabela estoque_movimentacoes (com COLLATE para resolver mix de collations)
            if (total === 0) {
                try {
                    const sql1 = `
                        SELECT DISTINCT p.*
                        FROM produtos p
                        INNER JOIN estoque_movimentacoes em ON (
                            p.codigo COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                            OR CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                        )
                        WHERE em.tipo_movimento = 'entrada'
                        ORDER BY p.descricao ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql1, [limit, offset]);

                    const [countResult] = await pool.query(`
                        SELECT COUNT(DISTINCT p.id) as total
                        FROM produtos p
                        INNER JOIN estoque_movimentacoes em ON (
                            p.codigo COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                            OR CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                        )
                        WHERE em.tipo_movimento = 'entrada'
                    `);
                    total = countResult[0]?.total || 0;
                    if (total > 0) strategy = 'estoque_movimentacoes';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 1 (estoque_movimentacoes):', total);
                } catch (err1) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] estoque_movimentacoes falhou:', err1.message);
                }
            }

            // Tentativa 2: tabela movimentacoes_estoque (nome alternativo)
            if (total === 0) {
                try {
                    const sql2 = `
                        SELECT DISTINCT p.id, p.codigo, p.nome, p.descricao, p.categoria,
                               p.gtin, p.sku, p.estoque_atual, p.estoque_minimo,
                               p.preco_custo, p.unidade_medida, p.status
                        FROM produtos p
                        INNER JOIN movimentacoes_estoque me ON me.produto_id = p.id
                        WHERE (me.tipo = 'entrada' OR me.tipo = 'ENTRADA')
                        AND p.status = 'ativo'
                        ORDER BY p.nome ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql2, [limit, offset]);

                    const [countResult2] = await pool.query(`
                        SELECT COUNT(DISTINCT p.id) as total
                        FROM produtos p
                        INNER JOIN movimentacoes_estoque me ON me.produto_id = p.id
                        WHERE (me.tipo = 'entrada' OR me.tipo = 'ENTRADA')
                        AND p.status = 'ativo'
                    `);
                    total = countResult2[0]?.total || 0;
                    if (total > 0) strategy = 'movimentacoes_estoque';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 2 (movimentacoes_estoque):', total);
                } catch (err2) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] movimentacoes_estoque falhou:', err2.message);
                }
            }

            // Tentativa 3: produtos com estoque > 0 diretamente
            if (total === 0) {
                try {
                    const sql3 = `
                        SELECT id, codigo, nome, descricao, unidade_medida as unidade, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status
                        FROM produtos
                        WHERE (estoque_atual > 0 OR quantidade_estoque > 0)
                        AND (status = 'ativo' OR status IS NULL)
                        ORDER BY COALESCE(descricao, nome) ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql3, [limit, offset]);

                    const [countResult3] = await pool.query(`
                        SELECT COUNT(*) as total FROM produtos
                        WHERE (estoque_atual > 0 OR quantidade_estoque > 0)
                        AND (status = 'ativo' OR status IS NULL)
                    `);
                    total = countResult3[0]?.total || 0;
                    if (total > 0) strategy = 'estoque_direto';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 3 (estoque > 0):', total);
                } catch (err3) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] estoque direto falhou:', err3.message);
                }
            }

            // Tentativa 4: produtos que possuem bobinas/rolos em bobinas_estoque (estoque real)
            if (total === 0) {
                try {
                    console.log('[API_PRODUTOS_COM_ENTRADA] Buscando produtos com bobinas em estoque...');
                    const sql4 = `
                        SELECT p.id, p.codigo, p.nome, p.descricao, p.unidade_medida as unidade,
                               p.estoque_atual, p.quantidade_estoque, p.estoque_minimo, p.categoria, p.status,
                               COUNT(b.id) as total_bobinas,
                               SUM(CASE WHEN b.tipo = 'bobina' THEN 1 ELSE 0 END) as qtd_bobinas,
                               SUM(CASE WHEN b.tipo = 'rolo' THEN 1 ELSE 0 END) as qtd_rolos,
                               COALESCE(SUM(b.quantidade), 0) as quantidade_total
                        FROM produtos p
                        -- BUG-ESTOQUE-001: bobinas_estoque.produto_id nao referencia produtos.id
                        -- (espacos de ID disjuntos); a chave real e codigo_produto <-> p.codigo.
                        INNER JOIN bobinas_estoque b ON b.codigo_produto COLLATE utf8mb4_general_ci = p.codigo COLLATE utf8mb4_general_ci
                        WHERE (p.status = 'ativo' OR p.status IS NULL)
                        GROUP BY p.id
                        ORDER BY COUNT(b.id) DESC, COALESCE(p.descricao, p.nome) ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql4, [limit, offset]);

                    const [countResult4] = await pool.query(`
                        SELECT COUNT(DISTINCT p.id) as total
                        FROM bobinas_estoque b
                        INNER JOIN produtos p ON p.codigo COLLATE utf8mb4_general_ci = b.codigo_produto COLLATE utf8mb4_general_ci
                        WHERE (p.status = 'ativo' OR p.status IS NULL)
                    `);
                    total = countResult4[0]?.total || 0;
                    strategy = 'bobinas_estoque';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 4 (bobinas_estoque):', total);
                } catch (err4) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] bobinas_estoque falhou:', err4.message);
                }
            }

            // FONTE ÚNICA DE SALDO: enriquecer TODAS as linhas com o saldo real de
            // estoque_saldos (produtos.estoque_atual está zerado). Casa por codigo.
            try {
                const codigos = [...new Set(rows.map(r => r.codigo).filter(Boolean).map(String))];
                if (codigos.length) {
                    const ph = codigos.map(() => '?').join(',');
                    const [saldos] = await pool.query(
                        `SELECT codigo_material, quantidade_fisica, quantidade_disponivel, quantidade_reservada
                         FROM estoque_saldos
                         WHERE codigo_material COLLATE utf8mb4_general_ci IN (${ph})`, codigos);
                    const smap = new Map(saldos.map(s => [String(s.codigo_material).trim().toLowerCase(), s]));
                    rows.forEach(r => {
                        const s = smap.get(String(r.codigo || '').trim().toLowerCase());
                        if (s) {
                            r.saldo_fisico = Number(s.quantidade_fisica) || 0;
                            r.saldo_disponivel = Number(s.quantidade_disponivel) || 0;
                            r.saldo_reservado = Number(s.quantidade_reservada) || 0;
                            if (!Number(r.estoque_atual)) r.estoque_atual = r.saldo_fisico;
                        }
                    });
                }
            } catch (eSaldo) {
                console.warn('[API_PRODUTOS_COM_ENTRADA] enriquecimento estoque_saldos falhou:', eSaldo.message);
            }

            // Calcular estatísticas
            let comEstoque = 0, estoqueBaixo = 0, critico = 0;
            rows.forEach(p => {
                const qtd = Number(p.estoque_atual || p.quantidade || p.estoque || 0);
                const min = Number(p.estoque_minimo || 10);
                if (qtd <= min * 0.25) critico++;
                else if (qtd <= min) estoqueBaixo++;
                else comEstoque++;
            });

            console.log('[API_PRODUTOS_COM_ENTRADA] Total:', total, 'Retornados:', rows.length, 'Strategy:', strategy);
            res.json({
                page,
                limit,
                total,
                rows,
                produtos: rows,
                strategy,
                stats: {
                    total_produtos: total,
                    com_estoque: comEstoque,
                    estoque_baixo: estoqueBaixo,
                    critico: critico
                }
            });
        } catch (error) {
            console.error('[API_PRODUTOS_COM_ENTRADA] Erro crítico:', error.message);
            // Em último caso, retornar vazio em vez de 500
            res.json({
                page: 1,
                limit: 1000,
                total: 0,
                rows: [],
                produtos: [],
                stats: { total_produtos: 0, com_estoque: 0, estoque_baixo: 0, critico: 0 }
            });
        }
    });

    // Lista de almoxarifados (locais) existentes — p/ escolher ou ADICIONAR outro no endereçamento.
    router.get('/estoque/almoxarifados', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT DISTINCT localizacao_almoxarifado AS nome FROM produtos
                 WHERE localizacao_almoxarifado IS NOT NULL AND TRIM(localizacao_almoxarifado) <> ''
                 ORDER BY nome`);
            const lista = rows.map(r => r.nome).filter(Boolean);
            if (!lista.some(x => x.toLowerCase() === 'estoque')) lista.unshift('Estoque');
            res.json({ success: true, almoxarifados: lista });
        } catch (e) {
            console.error('[PCP] Erro ao listar almoxarifados:', e.message);
            res.json({ success: true, almoxarifados: ['Estoque'] });
        }
    });

    // Consulta rápida p/ o SCANNER: produto + saldo real + endereço, por código do QR ou id.
    router.get('/estoque/consulta', authenticateToken, async (req, res) => {
        try {
            const { codigo, produto_id } = req.query;
            let where, param;
            if (produto_id) { where = 'p.id = ?'; param = parseInt(produto_id); }
            else if (codigo) { where = 'p.codigo COLLATE utf8mb4_general_ci = ?'; param = String(codigo).trim(); }
            else return res.status(400).json({ success: false, message: 'Informe codigo ou produto_id' });
            const [[p]] = await pool.query(
                `SELECT p.id, p.codigo, COALESCE(p.nome, p.descricao) AS nome,
                        COALESCE(p.unidade_medida, 'UN') AS unidade,
                        COALESCE(s.quantidade_fisica, p.estoque_atual, 0) AS saldo,
                        COALESCE(s.quantidade_disponivel, s.quantidade_fisica, p.estoque_atual, 0) AS disponivel,
                        p.localizacao_almoxarifado, p.localizacao_corredor,
                        p.localizacao_prateleira, p.localizacao_posicao, p.localizacao
                 FROM produtos p
                 LEFT JOIN estoque_saldos s ON s.codigo_material COLLATE utf8mb4_general_ci = p.codigo COLLATE utf8mb4_general_ci
                 WHERE ${where} LIMIT 1`, [param]);
            if (!p) return res.status(404).json({ success: false, message: 'Produto não encontrado' });
            res.json({ success: true, produto: p });
        } catch (e) {
            console.error('[PCP] Erro na consulta de estoque:', e.message);
            res.status(500).json({ success: false, message: 'Erro na consulta' });
        }
    });

    // Salvar ENDEREÇAMENTO (localização física) de um produto — chão de fábrica.
    router.put('/produtos/:id(\\d+)/localizacao', authenticateToken, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const almoxarifado = (req.body.almoxarifado || '').trim() || null;
            const corredor = (req.body.corredor || '').trim() || null;
            const prateleira = (req.body.prateleira || '').trim() || null;
            const posicao = (req.body.posicao || '').trim() || null;
            const resumo = [almoxarifado, corredor && ('Corr ' + corredor), prateleira && ('Prat ' + prateleira), posicao && ('Pos ' + posicao)]
                .filter(Boolean).join(' · ') || null;
            const [r] = await pool.query(
                `UPDATE produtos SET localizacao_almoxarifado = ?, localizacao_corredor = ?,
                        localizacao_prateleira = ?, localizacao_posicao = ?, localizacao = ?
                 WHERE id = ?`,
                [almoxarifado, corredor, prateleira, posicao, resumo, id]);
            if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Produto não encontrado' });
            res.json({ success: true, message: 'Localização salva', localizacao: resumo });
        } catch (e) {
            console.error('[PCP] Erro ao salvar localização:', e.message);
            res.status(500).json({ success: false, message: 'Erro ao salvar localização' });
        }
    });

    // Inativar produto — o botão "Inativar" do modal de produto do PCP
    // (modules/PCP/index.html) chamava PATCH /produtos/:id/inativar, que não
    // existia: a tela dizia "Erro ao inativar produto" para todo mundo.
    //
    // É diferente do DELETE /produtos/:id logo acima: inativar PRESERVA o produto
    // e o histórico de movimentação; só tira ele das listas de seleção.
    // `produtos.ativo` é a coluna que as telas já leem (373 ativos / 3 inativos).
    router.patch('/produtos/:id(\\d+)/inativar', authenticateToken, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            // `reativar: true` no corpo faz o caminho de volta — sem isso não
            // haveria como desfazer um clique errado a não ser no banco.
            const ativo = (req.body && (req.body.reativar === true || req.body.reativar === 'true')) ? 1 : 0;

            const [r] = await pool.query('UPDATE produtos SET ativo = ? WHERE id = ?', [ativo, id]);
            if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Produto não encontrado' });

            // `status` é texto livre e algumas telas filtram por ele — mantido
            // coerente com `ativo` para as duas leituras concordarem.
            try {
                await pool.query('UPDATE produtos SET status = ? WHERE id = ?', [ativo ? 'ativo' : 'inativo', id]);
            } catch (e) { /* base sem a coluna `status` */ }

            console.log(`[PCP] Produto #${id} ${ativo ? 'reativado' : 'inativado'} por usuário ${req.user?.id || '?'}`);
            res.json({
                success: true,
                message: ativo ? 'Produto reativado' : 'Produto inativado',
                ativo
            });
        } catch (e) {
            console.error('[PCP] Erro ao inativar produto:', e.message);
            res.status(500).json({ success: false, message: 'Erro ao inativar produto' });
        }
    });

    // Saldo de um produto POR CÓDIGO — usado pela checagem de disponibilidade
    // antes de aprovar pedido de venda (modules/_shared/integracoes/pcp-vendas.js),
    // que esperava `{ quantidade_disponivel }` e recebia 404. Sem a rota, a
    // verificação passava batido e o pedido era aprovado sem conferir estoque.
    //
    // O saldo vem de `produtos.estoque_atual` — o mesmo razão que a venda baixa
    // (ver services/estoque-ponte.service.js). O que está reservado para outros
    // pedidos é descontado quando a tabela de reservas existe nesta base.
    router.get('/estoque/produto/:codigo', authenticateToken, async (req, res) => {
        try {
            const codigo = String(req.params.codigo || '').trim();
            if (!codigo) return res.status(400).json({ success: false, message: 'Código obrigatório' });

            const [[produto]] = await pool.query(
                `SELECT id, codigo, nome, unidade_medida,
                        COALESCE(estoque_atual, 0)  AS estoque_atual,
                        COALESCE(estoque_minimo, 0) AS estoque_minimo,
                        COALESCE(ativo, 1)          AS ativo
                   FROM produtos
                  WHERE TRIM(codigo) = ? OR TRIM(sku) = ?
                  LIMIT 1`,
                [codigo, codigo]
            );

            if (!produto) {
                // 200 com zero, e não 404: para quem chama, "produto que não existe
                // no PCP" e "produto sem saldo" levam à mesma decisão, e um 404 aqui
                // fazia o `if (estoqueResponse.ok)` pular a checagem inteira.
                return res.json({
                    codigo, encontrado: false,
                    quantidade_disponivel: 0, quantidade_reservada: 0, estoque_atual: 0
                });
            }

            let reservada = 0;
            try {
                const [[r]] = await pool.query(
                    `SELECT COALESCE(SUM(quantidade), 0) AS q
                       FROM estoque_reservas
                      WHERE TRIM(codigo_material) = ? AND status = 'ativa'`,
                    [codigo]
                );
                reservada = parseFloat(r && r.q) || 0;
            } catch (e) {
                // Base sem controle de reservas — o disponível é o saldo cheio.
                if (e.code !== 'ER_NO_SUCH_TABLE') {
                    console.warn('[PCP] Reservas não consultadas:', e.message);
                }
            }

            const atual = parseFloat(produto.estoque_atual) || 0;
            res.json({
                codigo: produto.codigo,
                encontrado: true,
                produto_id: produto.id,
                descricao: produto.nome,
                unidade: produto.unidade_medida || 'UN',
                estoque_atual: atual,
                quantidade_reservada: reservada,
                quantidade_disponivel: Math.max(0, Math.round((atual - reservada) * 1000) / 1000),
                estoque_minimo: parseFloat(produto.estoque_minimo) || 0,
                ativo: !!produto.ativo
            });
        } catch (e) {
            console.error('[PCP] Erro ao consultar saldo do produto:', e.message);
            res.status(500).json({ success: false, message: 'Erro ao consultar saldo do produto' });
        }
    });

    // API para buscar movimentações de estoque de um produto
    // SECURITY: Requer autenticação
    router.get('/estoque/movimentacoes', authenticateToken, async (req, res) => {
        console.log('[API_ESTOQUE_MOVIMENTACOES] Requisição recebida:', req.query);
        try {
            const { produto_id, codigo_material, limit = 20 } = req.query;
            const lim = Math.min(parseInt(limit) || 20, 500);

            // HISTÓRICO UNIFICADO: junta as 3 tabelas de movimento que os módulos gravam
            // (movimentacoes_estoque=PCP, estoque_movimentacoes=Compras/fiscal,
            // estoque_movimentos=Vendas) para que TUDO apareça — antes o front lia só uma
            // tabela e o que era lançado por outra sumia. Aliases compatíveis com o front:
            // tipo/data_movimentacao/quantidade[_anterior/_atual]/produto_nome/documento/motivo.
            let pid = produto_id ? parseInt(produto_id) : null;
            let cod = codigo_material || null;
            if (pid && !cod) { const [[p]] = await pool.query('SELECT codigo FROM produtos WHERE id=?', [pid]); cod = p?.codigo || null; }
            if (cod && !pid) { const [[p]] = await pool.query('SELECT id FROM produtos WHERE codigo=? LIMIT 1', [cod]); pid = p?.id || null; }
            const temFiltro = !!(pid || cod);
            const fME = temFiltro ? 'WHERE me.produto_id = ?' : '';
            const fEM = temFiltro ? 'WHERE em.codigo_material COLLATE utf8mb4_general_ci = ?' : '';
            const fMV = temFiltro ? 'WHERE mv.produto_id = ?' : '';

            const sql = `
                SELECT t.*, u.nome AS usuario_nome,
                       DATE_FORMAT(t.data_movimentacao, '%d/%m/%Y %H:%i') AS data_formatada
                FROM (
                    SELECT COALESCE(me.data_movimentacao, me.created_at) AS data_movimentacao,
                           UPPER(me.tipo) COLLATE utf8mb4_general_ci AS tipo, me.quantidade AS quantidade,
                           me.quantidade_anterior AS quantidade_anterior, me.quantidade_atual AS quantidade_atual,
                           me.produto_id AS produto_id, CAST(p.codigo AS CHAR) COLLATE utf8mb4_general_ci AS codigo,
                           CAST(COALESCE(p.nome, p.descricao) AS CHAR) COLLATE utf8mb4_general_ci AS produto_nome,
                           CAST(me.documento AS CHAR) COLLATE utf8mb4_general_ci AS documento,
                           CAST(COALESCE(me.observacoes, me.motivo) AS CHAR) COLLATE utf8mb4_general_ci AS motivo,
                           CAST('PCP' AS CHAR) COLLATE utf8mb4_general_ci AS origem, me.usuario_id AS usuario_id
                    FROM movimentacoes_estoque me
                    LEFT JOIN produtos p ON p.id = me.produto_id
                    ${fME}
                    UNION ALL
                    SELECT em.data_movimento, UPPER(em.tipo_movimento) COLLATE utf8mb4_general_ci, em.quantidade,
                           em.quantidade_anterior, em.quantidade_atual, p.id, CAST(em.codigo_material AS CHAR) COLLATE utf8mb4_general_ci,
                           CAST(COALESCE(p.nome, p.descricao, em.codigo_material) AS CHAR) COLLATE utf8mb4_general_ci,
                           CAST(em.documento_numero AS CHAR) COLLATE utf8mb4_general_ci,
                           CAST(em.observacao AS CHAR) COLLATE utf8mb4_general_ci, CAST(COALESCE(em.origem, 'Compras') AS CHAR) COLLATE utf8mb4_general_ci, em.usuario_id
                    FROM estoque_movimentacoes em
                    LEFT JOIN produtos p ON p.codigo COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                    ${fEM}
                    UNION ALL
                    SELECT mv.data_movimento, UPPER(mv.tipo_movimento) COLLATE utf8mb4_general_ci, mv.quantidade,
                           NULL, NULL, mv.produto_id, CAST(p.codigo AS CHAR) COLLATE utf8mb4_general_ci,
                           CAST(COALESCE(p.nome, p.descricao) AS CHAR) COLLATE utf8mb4_general_ci, CAST(mv.documento_id AS CHAR) COLLATE utf8mb4_general_ci,
                           CAST(mv.observacoes AS CHAR) COLLATE utf8mb4_general_ci, CAST('Venda' AS CHAR) COLLATE utf8mb4_general_ci, mv.usuario_id
                    FROM estoque_movimentos mv
                    LEFT JOIN produtos p ON p.id = mv.produto_id
                    ${fMV}
                ) t
                LEFT JOIN usuarios u ON u.id = t.usuario_id
                ORDER BY t.data_movimentacao DESC
                LIMIT ?
            `;
            const params = [];
            if (temFiltro) { params.push(pid, cod, pid); }
            params.push(lim);
            const [rows] = await pool.query(sql, params);

            console.log('[API_ESTOQUE_MOVIMENTACOES] Unificado:', rows.length, 'movimentações', temFiltro ? `(produto ${pid||cod})` : '(global)');
            res.json({ success: true, movimentacoes: rows, rows, total: rows.length });

        } catch (error) {
            console.error('[API_ESTOQUE_MOVIMENTACOES] Erro:', error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar movimentações',
                error: 'Erro interno no servidor. Tente novamente.'
            });
        }
    });

    // POST /estoque/movimentacao - Registrar entrada, saída ou ajuste de estoque
    // Suporta produto_id (produtos) e material_id (materiais)
    // SECURITY: Requer autenticação. Isolamento por banco de dados (pool tenant-specific)
    router.post('/estoque/movimentacao', authenticateToken, async (req, res) => {
        const { material_id, produto_id, tipo, quantidade, observacoes, observacao, local, documento } = req.body;
        const itemId = material_id || produto_id;
        if (!itemId) return res.status(400).json({ success: false, message: 'Informe produto_id ou material_id' });
        if (!quantidade || isNaN(parseFloat(quantidade))) return res.status(400).json({ success: false, message: 'Quantidade inválida' });

        const tabela = material_id ? 'materiais' : 'produtos';
        const coluna = material_id ? 'quantidade_estoque' : 'estoque_atual';
        const obs = observacoes || observacao || '';
        const tipoNorm = (tipo || 'ENTRADA').toUpperCase();
        if (!['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipoNorm)) {
            return res.status(400).json({ success: false, message: 'Tipo inválido. Use ENTRADA, SAIDA ou AJUSTE' });
        }

        try {
            const colunaSelect = tabela === 'produtos'
                ? 'COALESCE(estoque_atual, 0) as quantidade, nome, codigo'
                : 'quantidade_estoque as quantidade, descricao as nome, codigo_material as codigo';
            const qtd = parseFloat(quantidade);

            // K-CONC: leitura + escrita do saldo tem que ser atômica. O SELECT roda dentro
            // da transação com FOR UPDATE p/ travar a linha; sem isso, duas SAIDA concorrentes
            // liam o mesmo saldo, gravavam por cima (lost update) e furavam o guard de estoque negativo.
            const conn = await pool.getConnection();
            let quantidadeAnterior, novaQuantidade, item;
            try {
                await conn.beginTransaction();
                const [[row]] = await conn.query(`SELECT ${colunaSelect} FROM ${tabela} WHERE id = ? FOR UPDATE`, [itemId]);
                if (!row) {
                    await conn.rollback();
                    return res.status(404).json({ success: false, message: `${tabela === 'materiais' ? 'Material' : 'Produto'} não encontrado` });
                }
                item = row;

                if (tabela === 'produtos') {
                    // FONTE ÚNICA: o saldo do produto vive em estoque_saldos (por codigo).
                    // Lemos/gravamos lá com FOR UPDATE e espelhamos em produtos.estoque_atual.
                    const codigoProd = item.codigo;
                    const [[saldoRow]] = await conn.query(
                        'SELECT quantidade_fisica, quantidade_reservada FROM estoque_saldos WHERE codigo_material = ? FOR UPDATE',
                        [codigoProd]
                    );
                    quantidadeAnterior = saldoRow ? (parseFloat(saldoRow.quantidade_fisica) || 0) : (parseFloat(item.quantidade) || 0);
                    const reservada = saldoRow ? (parseFloat(saldoRow.quantidade_reservada) || 0) : 0;
                    switch (tipoNorm) {
                        case 'ENTRADA':  novaQuantidade = quantidadeAnterior + qtd; break;
                        case 'SAIDA':    novaQuantidade = quantidadeAnterior - qtd; break;
                        case 'AJUSTE':   novaQuantidade = qtd; break;
                    }
                    if (novaQuantidade < 0) {
                        await conn.rollback();
                        return res.status(400).json({ success: false, message: 'Quantidade insuficiente em estoque' });
                    }
                    // quantidade_disponivel é COLUNA GERADA (fisica - reservada) → não gravar.
                    const campoData = tipoNorm === 'SAIDA' ? 'ultima_saida' : 'ultima_entrada';
                    if (saldoRow) {
                        await conn.query(`UPDATE estoque_saldos SET quantidade_fisica = ?, ${campoData} = NOW() WHERE codigo_material = ?`, [novaQuantidade, codigoProd]);
                    } else {
                        await conn.query(`INSERT INTO estoque_saldos (codigo_material, descricao, quantidade_fisica, quantidade_reservada, ${campoData}) VALUES (?, ?, ?, 0, NOW())`, [codigoProd, item.nome || codigoProd, novaQuantidade]);
                    }
                    await conn.query('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novaQuantidade, itemId]);
                } else {
                    quantidadeAnterior = parseFloat(item.quantidade) || 0;
                    switch (tipoNorm) {
                        case 'ENTRADA':  novaQuantidade = quantidadeAnterior + qtd; break;
                        case 'SAIDA':    novaQuantidade = quantidadeAnterior - qtd; break;
                        case 'AJUSTE':   novaQuantidade = qtd; break;
                    }
                    if (novaQuantidade < 0) {
                        await conn.rollback();
                        return res.status(400).json({ success: false, message: 'Quantidade insuficiente em estoque' });
                    }
                    await conn.query(`UPDATE ${tabela} SET ${coluna} = ? WHERE id = ?`, [novaQuantidade, itemId]);
                }
                await conn.query(`
                    INSERT INTO movimentacoes_estoque
                    (material_id, produto_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `, [material_id || null, produto_id || null, tipoNorm, qtd, quantidadeAnterior, novaQuantidade, obs, local || 'PRINCIPAL', documento || null, req.user?.id || null]);
                await conn.commit();
            } catch (txErr) {
                try { await conn.rollback(); } catch(e) {}
                throw txErr;
            } finally {
                conn.release();
            }

            res.json({
                success: true,
                message: 'Movimentação registrada com sucesso',
                quantidade_anterior: quantidadeAnterior,
                quantidade_atual: novaQuantidade,
                nome_item: item.nome
            });
        } catch (err) {
            console.error('[PCP] Erro ao registrar movimentação de estoque:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao registrar movimentação' });
        }
    });

    // POST /materiais/movimentacao - Registrar movimentação de material
    router.post('/materiais/movimentacao', authenticateToken, async (req, res) => {
        const { material_id, produto_id, tipo, quantidade, observacoes, observacao, local, documento } = req.body;
        const matId = material_id || produto_id;
        if (!matId) return res.status(400).json({ success: false, message: 'Informe material_id' });
        if (!quantidade || isNaN(parseFloat(quantidade))) return res.status(400).json({ success: false, message: 'Quantidade inválida' });

        const obs = observacoes || observacao || '';
        const tipoNorm = (tipo || 'ENTRADA').toUpperCase();
        if (!['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipoNorm)) {
            return res.status(400).json({ success: false, message: 'Tipo inválido' });
        }

        try {
            const [[item]] = await pool.query(
                'SELECT quantidade_estoque as quantidade, descricao as nome FROM materiais WHERE id = ?',
                [matId]
            );
            if (!item) return res.status(404).json({ success: false, message: 'Material não encontrado' });

            const quantidadeAnterior = parseFloat(item.quantidade) || 0;
            let novaQuantidade;
            const qtd = parseFloat(quantidade);
            switch (tipoNorm) {
                case 'ENTRADA':  novaQuantidade = quantidadeAnterior + qtd; break;
                case 'SAIDA':    novaQuantidade = quantidadeAnterior - qtd; break;
                case 'AJUSTE':   novaQuantidade = qtd; break;
            }
            if (novaQuantidade < 0) return res.status(400).json({ success: false, message: 'Quantidade insuficiente em estoque' });

            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                await conn.query('UPDATE materiais SET quantidade_estoque = ? WHERE id = ?', [novaQuantidade, matId]);
                await conn.query(`
                    INSERT INTO movimentacoes_estoque
                    (material_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `, [matId, tipoNorm, qtd, quantidadeAnterior, novaQuantidade, obs, local || 'PRINCIPAL', documento || null, req.user?.id || null]);
                await conn.commit();
            } catch (txErr) {
                try { await conn.rollback(); } catch(e) {}
                throw txErr;
            } finally {
                conn.release();
            }

            res.json({ success: true, message: 'Movimentação registrada com sucesso', quantidade_anterior: quantidadeAnterior, quantidade_atual: novaQuantidade, nome_item: item.nome });
        } catch (err) {
            console.error('[PCP] Erro ao registrar movimentação de material:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao registrar movimentação' });
        }
    });

    // API para buscar todos os produtos (PCP)
    // SECURITY: Requer autenticação
    router.get('/produtos', authenticateToken, async (req, res) => {
        try {
            let page = parseInt(req.query.page, 10) || 1;
            let limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
            if (page < 1) page = 1;
            if (limit < 1) limit = 10;
            const offset = (page - 1) * limit;

            const q = (req.query.q || '').trim();
            const like = `%${q}%`;

            let sql = 'SELECT id, codigo, nome, descricao, sku, gtin, unidade_medida as unidade, COALESCE(preco_venda, preco_custo, 0) as preco, status, familia, categoria, estoque_atual, estoque_minimo FROM produtos';
            let params = [];

            if (q) {
                sql += ' WHERE codigo LIKE ? OR descricao LIKE ? OR nome LIKE ?';
                params.push(like, like, like);
            }

            sql += ' ORDER BY descricao ASC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const [rows] = await pool.query(sql, params);

            // Contar total
            let countSql = 'SELECT COUNT(*) as total FROM produtos';
            let countParams = [];
            if (q) {
                countSql += ' WHERE codigo LIKE ? OR descricao LIKE ? OR nome LIKE ?';
                countParams.push(like, like, like);
            }
            const [countResult] = await pool.query(countSql, countParams);
            const total = countResult[0]?.total || 0;

            console.log('[API_PCP_PRODUTOS] Total:', total, 'Retornados:', rows.length);
            res.json({ page, limit, total, rows });
        } catch (error) {
            console.error('[API_PCP_PRODUTOS] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao buscar produtos.', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // API para buscar transportadoras
    router.get('/api/transportadoras', authenticateToken, async (req, res) => {
        try {
            console.log('🚛 Buscando transportadoras para autocomplete...');
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);

            const { termo } = req.query;
            let query = `
                SELECT
                    id,
                    razao_social,
                    nome_fantasia,
                    contato,
                    cnpj_cpf,
                    inscricao_estadual,
                    telefone,
                    email,
                    bairro,
                    cidade,
                    estado,
                    cep
                FROM transportadoras
                WHERE 1=1
            `;
            let params = [];

            if (termo && termo.length >= 2) {
                // Buscar por nome (não por cnpj_cpf que está criptografado)
                query += ` AND (razao_social LIKE ? OR nome_fantasia LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike];
            }

            query += ' ORDER BY razao_social LIMIT 50';

            const [transportadoras] = await pool.query(query, params);

            // Formatar resposta com descriptografia LGPD
            const transportadorasFormatadas = transportadoras.map(transp => ({
                id: transp.id,
                nome: transp.razao_social || transp.nome_fantasia || '',
                nome_empresa: transp.razao_social || '',
                razao_social: transp.razao_social || '',
                nome_fantasia: transp.nome_fantasia || '',
                contato: transp.contato || '',
                cnpj: _dec(transp.cnpj_cpf || ''),
                inscricao_estadual: _dec(transp.inscricao_estadual || ''),
                telefone: transp.telefone || '',
                fone: transp.telefone || '',
                email: transp.email || '',
                endereco: transp.bairro && transp.cidade ? `${transp.bairro}, ${transp.cidade}/${transp.estado}` : `${transp.cidade || ''}/${transp.estado || ''}`,
                cidade: transp.cidade || '',
                estado: transp.estado || '',
                cep: transp.cep || ''
            }));

            console.log(`✅ Encontradas ${transportadorasFormatadas.length} transportadoras`);
            res.json(transportadorasFormatadas);

        } catch (error) {
            console.error('❌ Erro ao buscar transportadoras:', error);
            res.json([]);
        }
    });

    // =================== ENDPOINTS DE COMPATIBILIDADE ===================
    // Aliases para os endpoints esperados pelo frontend

    // Alias para empresas/buscar -> clientes
    router.get('/api/empresas/buscar', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Redirecionando /api/empresas/buscar para /api/clientes');

            const { termo } = req.query;
            let query = "SELECT id, nome, razao_social, nome_fantasia, contato, cnpj_cpf as cnpj, cnpj_cpf as cpf, telefone, telefone as celular, email, email as email_nfe, endereco, endereco as logradouro, '' as numero, bairro, cidade, estado as uf, estado, cep FROM clientes WHERE ativo = 1";
            let params = [];

            if (termo && termo.length >= 1) { // Funciona com 1 caractere
                query += ` AND (nome LIKE ? OR cnpj_cpf LIKE ? OR contato LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike, termoLike];
            }

            query += ' ORDER BY nome LIMIT 50';

            const [clientes] = await pool.query(query, params);

            // Formatar resposta com mapeamento de campos
            const clientesFormatados = clientes.map(cliente => ({
                id: cliente.id,
                nome: cliente.nome || '',
                razao_social: cliente.nome || '', // Campo alternativo esperado
                nome_fantasia: cliente.nome || '',
                contato: cliente.contato || '',
                nome_contato: cliente.contato || '',
                cnpj: cliente.cnpj || '',
                cpf: cliente.cpf || '',
                telefone: cliente.telefone || '',
                celular: cliente.celular || '',
                fone: cliente.telefone || cliente.celular || '',
                email: cliente.email || '',
                email_nfe: cliente.email_nfe || cliente.email || '',
                endereco: cliente.endereco || '',
                logradouro: cliente.logradouro || '',
                numero: cliente.numero || '',
                bairro: cliente.bairro || '',
                cidade: cliente.cidade || '',
                uf: cliente.uf || cliente.estado || '',
                estado: cliente.estado || cliente.uf || '',
                cep: cliente.cep || ''
            }));

            console.log(`✅ Endpoint /api/empresas/buscar retornou ${clientesFormatados.length} registros`);
            res.json(clientesFormatados);

        } catch (error) {
            console.error('❌ Erro em /api/empresas/buscar:', error);
            res.status(500).json({ error: 'Erro ao buscar empresas' });
        }
    });

    // Backwards-compatible endpoint: /api/empresas (aceita ?limit=... e ?termo=...)
    router.get('/api/empresas', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Alias compatível /api/empresas chamado');
            const { termo } = req.query;
            const limit = req.query.limit ? Math.max(1, Math.min(1000, parseInt(req.query.limit))) : 500;

            let query = "SELECT id, nome, razao_social, nome_fantasia, contato, cnpj_cpf as cnpj, cnpj_cpf as cpf, telefone, telefone as celular, email, email as email_nfe, endereco, endereco as logradouro, '' as numero, bairro, cidade, estado as uf, estado, cep FROM clientes WHERE ativo = 1";
            let params = [];
            if (termo && termo.length >= 1) {
                query += ` AND (nome LIKE ? OR cnpj_cpf LIKE ? OR contato LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike, termoLike];
            }

            query += ' ORDER BY nome LIMIT ' + limit;

            const [clientes] = await pool.query(query, params);

            const clientesFormatados = clientes.map(cliente => ({
                id: cliente.id,
                nome: cliente.nome || '',
                razao_social: cliente.nome || '',
                nome_fantasia: cliente.nome || '',
                contato: cliente.contato || '',
                nome_contato: cliente.contato || '',
                cnpj: cliente.cnpj || '',
                cpf: cliente.cpf || '',
                telefone: cliente.telefone || '',
                celular: cliente.celular || '',
                fone: cliente.telefone || cliente.celular || '',
                email: cliente.email || '',
                email_nfe: cliente.email_nfe || cliente.email || '',
                endereco: cliente.endereco || '',
                logradouro: cliente.logradouro || '',
                numero: cliente.numero || '',
                bairro: cliente.bairro || '',
                cidade: cliente.cidade || '',
                uf: cliente.uf || cliente.estado || '',
                estado: cliente.estado || cliente.uf || '',
                cep: cliente.cep || ''
            }));

            console.log(`✅ Endpoint /api/empresas retornou ${clientesFormatados.length} registros (limit=${limit})`);
            res.json(clientesFormatados);
        } catch (error) {
            console.error('❌ Erro em /api/empresas:', error);
            res.status(500).json({ error: 'Erro ao buscar empresas' });
        }
    });

    // Alias para transportadoras/buscar -> transportadoras
    router.get('/api/transportadoras/buscar', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Buscando transportadoras via /buscar...');
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);

            const { termo } = req.query;
            let query = `
                SELECT
                    id,
                    razao_social,
                    nome_fantasia,
                    contato,
                    cnpj_cpf,
                    inscricao_estadual,
                    telefone,
                    email,
                    endereco,
                    bairro,
                    cidade,
                    estado,
                    cep
                FROM transportadoras
                WHERE 1=1
            `;
            let params = [];

            if (termo && termo.length >= 1) {
                // Buscar apenas por nome (cnpj está criptografado, LIKE não funciona)
                query += ` AND (razao_social LIKE ? OR nome_fantasia LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike];
            }

            query += ' ORDER BY razao_social LIMIT 50';

            const [transportadoras] = await pool.query(query, params);

            // Formatar resposta com descriptografia LGPD
            const transportadorasFormatadas = transportadoras.map(transp => ({
                id: transp.id,
                nome_empresa: transp.razao_social || transp.nome_fantasia || '',
                nome: transp.razao_social || transp.nome_fantasia || '',
                contato: transp.contato || '',
                cnpj: _dec(transp.cnpj_cpf || ''),
                inscricao_estadual: _dec(transp.inscricao_estadual || ''),
                telefone: transp.telefone || '',
                email: transp.email || '',
                endereco: transp.endereco || (transp.bairro && transp.cidade ? `${transp.bairro}, ${transp.cidade}/${transp.estado}` : `${transp.cidade || ''}/${transp.estado || ''}`),
                cep: transp.cep || ''
            }));

            console.log(`✅ /api/transportadoras/buscar retornou ${transportadorasFormatadas.length} registros`);
            res.json(transportadorasFormatadas);

        } catch (error) {
            console.error('❌ Erro em /api/transportadoras/buscar:', error);
            res.json([]);
        }
    });

    // Alias para produtos/buscar -> busca em produtos + materiais
    router.get('/api/produtos/buscar', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Buscando em produtos e materiais...');

            const { termo } = req.query;
            let produtosCombinados = [];

            // 1. Buscar na tabela produtos
            try {
                let queryProdutos = `
                    SELECT
                        id,
                        codigo,
                        nome,
                        variacao,
                        marca,
                        descricao,
                        gtin,
                        sku
                    FROM produtos
                    WHERE 1=1
                `;
                let paramsProdutos = [];

                if (termo && termo.length >= 1) {
                    queryProdutos += ` AND (codigo LIKE ? OR nome LIKE ? OR descricao LIKE ?)`;
                    const termoLike = `%${termo}%`;
                    paramsProdutos = [termoLike, termoLike, termoLike];
                }

                queryProdutos += ' ORDER BY nome LIMIT 50';

                const [produtos] = await pool.query(queryProdutos, paramsProdutos);

                // Formatar produtos
                const produtosFormatados = produtos.map(produto => ({
                    id: `p_${produto.id}`, // Prefixo para distinguir de materiais
                    codigo: produto.codigo || '',
                    codigo_material: produto.codigo || '',
                    descricao: produto.nome || produto.descricao || '',
                    nome: produto.nome || produto.descricao || '',
                    unidade_medida: 'UN',
                    preco: 0,
                    preco_unitario: 0,
                    estoque: 0,
                    quantidade_estoque: 0,
                    fornecedor: produto.marca || '',
                    categoria: produto.marca || 'Produto',
                    tipo: 'produto',
                    variacao: produto.variacao || '',
                    gtin: produto.gtin || '',
                    sku: produto.sku || ''
                }));

                produtosCombinados = [...produtosCombinados, ...produtosFormatados];
                console.log(`✅ Encontrados ${produtosFormatados.length} produtos`);

            } catch (errorProdutos) {
                console.log(`⚠️ Erro ao buscar produtos: ${errorProdutos.message}`);
            }

            // 2. Buscar na tabela materiais
            try {
                let queryMateriais = `
                    SELECT
                        id,
                        codigo_material,
                        descricao,
                        unidade_medida,
                        custo_unitario,
                        quantidade_estoque,
                        fornecedor_padrao
                    FROM materiais
                    WHERE 1=1
                `;
                let paramsMateriais = [];

                if (termo && termo.length >= 1) {
                    queryMateriais += ` AND (codigo_material LIKE ? OR descricao LIKE ?)`;
                    const termoLike = `%${termo}%`;
                    paramsMateriais = [termoLike, termoLike];
                }

                queryMateriais += ' ORDER BY codigo_material LIMIT 25';

                const [materiais] = await pool.query(queryMateriais, paramsMateriais);

                // Formatar materiais
                const materiaisFormatados = materiais.map(material => ({
                    id: `m_${material.id}`, // Prefixo para distinguir de produtos
                    codigo: material.codigo_material || '',
                    codigo_material: material.codigo_material || '',
                    descricao: material.descricao || '',
                    nome: material.descricao || '',
                    unidade_medida: material.unidade_medida || 'UN',
                    preco: parseFloat(material.custo_unitario) || 0,
                    preco_unitario: parseFloat(material.custo_unitario) || 0,
                    estoque: parseFloat(material.quantidade_estoque) || 0,
                    quantidade_estoque: parseFloat(material.quantidade_estoque) || 0,
                    fornecedor: material.fornecedor_padrao || '',
                    categoria: 'Material',
                    tipo: 'material'
                }));

                produtosCombinados = [...produtosCombinados, ...materiaisFormatados];
                console.log(`✅ Encontrados ${materiaisFormatados.length} materiais`);

            } catch (errorMateriais) {
                console.log(`⚠️ Erro ao buscar materiais: ${errorMateriais.message}`);
            }

            // Ordenar por relevância (produtos primeiro, depois materiais)
            produtosCombinados.sort((a, b) => {
                if (a.tipo === 'produto' && b.tipo === 'material') return -1;
                if (a.tipo === 'material' && b.tipo === 'produto') return 1;
                return a.nome.localeCompare(b.nome);
            });

            console.log(`✅ Total de produtos+materiais encontrados: ${produtosCombinados.length}`);
            res.json(produtosCombinados);

        } catch (error) {
            console.error('❌ Erro em /api/produtos/buscar:', error);

            // Fallback com dados de exemplo
            const produtosExemplo = [
                {
                    id: 1,
                    codigo: 'CABO-01',
                    codigo_material: 'CABO-01',
                    descricao: 'Cabo de Aço Galvanizado 6mm',
                    nome: 'Cabo de Aço Galvanizado 6mm',
                    unidade_medida: 'MT',
                    preco: 15.50,
                    preco_unitario: 15.50,
                    estoque: 150,
                    quantidade_estoque: 150,
                    categoria: 'Cabos'
                }
            ];

            res.json(produtosExemplo);
        }
    });

    console.log('✅ Endpoints de compatibilidade criados:');
    console.log('   📍 /api/empresas/buscar -> /api/clientes');
    console.log('   📍 /api/transportadoras/buscar -> /api/transportadoras');
    console.log('   📍 /api/produtos/buscar -> /api/pcp/materiais');

    // =================== API PARA PRODUTOS REAIS DA TABELA PRODUTOS ===================

    // API para buscar produtos da tabela 'produtos' (diferente de materiais)
    // SECURITY: Requer autenticação
    router.get('/api/produtos', authenticateToken, async (req, res) => {
        try {
            console.log('🛍️ Buscando produtos da tabela produtos...');

            const { termo } = req.query;
            // permitir ?limit=NUM (padrão 1000) ou ?limit=0 para sem LIMIT
            const rawLimit = req.query.limit;
            let limitParam = typeof rawLimit !== 'undefined' ? parseInt(rawLimit) : 1000;
            if (isNaN(limitParam) || limitParam < 0) limitParam = 1000;

            let query = `
                SELECT
                    id,
                    codigo,
                    nome,
                    variacao,
                    marca,
                    descricao,
                    gtin,
                    sku,
                    custo_unitario
                FROM produtos
                WHERE 1=1
            `;
            let params = [];

            if (termo && termo.length >= 1) { // Funciona com 1 caractere
                query += ` AND (codigo LIKE ? OR nome LIKE ? OR descricao LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike, termoLike];
            }

            // Se limitParam for 0 => sem LIMIT (retorna todos). Caso contrário, aplica LIMIT.
            if (limitParam === 0) {
                query += ' ORDER BY nome';
            } else {
                query += ' ORDER BY nome LIMIT ?';
                params.push(limitParam);
            }

            const [produtos] = await pool.query(query, params);

            // Formatar resposta compatível com frontend
            const produtosFormatados = produtos.map(produto => {
                // Tentar obter preço da coluna custo_unitario
                const preco = produto.custo_unitario || 0;

                return {
                    id: produto.id,
                    codigo: produto.codigo || '',
                    nome: produto.nome || '',
                    descricao: produto.descricao || produto.nome || '',
                    variacao: produto.variacao || '',
                    marca: produto.marca || '',
                    gtin: produto.gtin || '',
                    sku: produto.sku || '',
                    preco: parseFloat(preco) || 0,
                    preco_unitario: parseFloat(preco) || 0,
                    categoria: produto.marca || 'Produto'
                };
            });

            console.log(`✅ Endpoint /api/produtos retornou ${produtosFormatados.length} registros`);

            // Formato compatível com frontend que espera {rows: [...]}
            res.json({
                rows: produtosFormatados,
                items: produtosFormatados,
                total: produtosFormatados.length
            });

        } catch (error) {
            console.error('❌ Erro ao buscar produtos:', error);

            // Fallback com produtos reais do catálogo
            const produtosFallback = [
                {
                    id: 1,
                    codigo: 'DUN10',
                    nome: 'CABO DUPLEX NEUTRO NU 2x10mm² LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado duplex com neutro nu, condutor de alumínio',
                    variacao: 'Preto / Nu',
                    marca: 'Aluforce',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-DUN10',
                    preco: 28.90,
                    preco_unitario: 28.90,
                    categoria: 'DUPLEX'
                },
                {
                    id: 2,
                    codigo: 'TRI25',
                    nome: 'CABO TRIPLEX 3x25mm² (2#25 + 1#25) LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado triplex, condutor de alumínio',
                    variacao: 'Preto / Preto / Nu',
                    marca: 'Aluforce',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-TRI25',
                    preco: 65.90,
                    preco_unitario: 65.90,
                    categoria: 'TRIPLEX'
                },
                {
                    id: 3,
                    codigo: 'QDN50',
                    nome: 'CABO QUADRUPLEX NEUTRO NU 3x50mm² + 1x50mm² LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado quadruplex com neutro nu, condutor de alumínio',
                    variacao: 'Preto / Preto / Preto / Nu',
                    marca: 'Aluforce',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-QDN50',
                    preco: 125.50,
                    preco_unitario: 125.50,
                    categoria: 'QUADRUPLEX'
                },
                {
                    id: 4,
                    codigo: 'DUN10_LAB',
                    nome: 'CABO DUPLEX NEUTRO NU 2x10mm² LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado duplex com neutro nu - LABOR ENERGY',
                    variacao: 'Preto / Nu',
                    marca: 'Labor Energy',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-DUN10_LAB',
                    preco: 25.70,
                    preco_unitario: 25.70,
                    categoria: 'DUPLEX'
                },
                {
                    id: 5,
                    codigo: 'TRI25_LAB',
                    nome: 'CABO TRIPLEX 3x25mm² (2#25 + 1#25) LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado triplex - LABOR ENERGY',
                    variacao: 'Preto / Preto / Nu',
                    marca: 'Labor Energy',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-TRI25_LAB',
                    preco: 62.70,
                    preco_unitario: 62.70,
                    categoria: 'TRIPLEX'
                }
            ];

            res.json(produtosFallback);
        }
    });

    // ========== ROTAS BOBINAS CAPACIDADE ==========
    // GET /api/pcp/bobinas/categorias - Listar categorias disponíveis
    router.get('/bobinas/categorias', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT DISTINCT categoria, norma FROM bobinas_capacidade ORDER BY categoria');
            res.json(rows);
        } catch (error) {
            console.error('[BOBINAS] Erro ao listar categorias:', error.message);
            res.status(500).json({ error: 'Erro ao listar categorias' });
        }
    });

    // GET /api/pcp/bobinas/secoes/:categoria - Listar seções de uma categoria
    router.get('/bobinas/secoes/:categoria', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT secao, diametro_mm FROM bobinas_capacidade WHERE categoria = ? ORDER BY CAST(secao AS UNSIGNED)',
                [req.params.categoria]
            );
            res.json(rows);
        } catch (error) {
            console.error('[BOBINAS] Erro ao listar seções:', error.message);
            res.status(500).json({ error: 'Erro ao listar seções' });
        }
    });

    // POST /api/pcp/bobinas/calcular - Calcular bobina ideal
    router.post('/bobinas/calcular', authenticateToken, async (req, res) => {
        try {
            const { categoria, secao, metragem } = req.body;

            if (!categoria || !secao || !metragem) {
                return res.status(400).json({ error: 'categoria, secao e metragem são obrigatórios' });
            }

            const metrosDesejados = parseFloat(metragem);
            if (isNaN(metrosDesejados) || metrosDesejados <= 0) {
                return res.status(400).json({ error: 'metragem deve ser um número positivo' });
            }

            const [rows] = await pool.query(
                'SELECT * FROM bobinas_capacidade WHERE categoria = ? AND secao = ?',
                [categoria, secao]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Combinação categoria/seção não encontrada' });
            }

            const dados = rows[0];

            // Definir bobinas disponíveis com seus nomes
            const bobinas = [
                { nome: '65/25', campo: 'bob_65_25', capacidade: parseFloat(dados.bob_65_25) || 0 },
                { nome: '630',   campo: 'bob_630',   capacidade: parseFloat(dados.bob_630) || 0 },
                { nome: '65/45', campo: 'bob_65_45', capacidade: parseFloat(dados.bob_65_45) || 0 },
                { nome: '80/45', campo: 'bob_80_45', capacidade: parseFloat(dados.bob_80_45) || 0 },
                { nome: '100/60', campo: 'bob_100_60', capacidade: parseFloat(dados.bob_100_60) || 0 },
                { nome: '125/70', campo: 'bob_125_70', capacidade: parseFloat(dados.bob_125_70) || 0 },
                { nome: '125/100', campo: 'bob_125_100', capacidade: parseFloat(dados.bob_125_100) || 0 }
            ].filter(b => b.capacidade > 0);

            // Calcular para cada bobina: quantas precisa e qual o aproveitamento
            const resultados = bobinas.map(b => {
                const qtdBobinas = Math.ceil(metrosDesejados / b.capacidade);
                const capacidadeTotal = qtdBobinas * b.capacidade;
                const sobra = capacidadeTotal - metrosDesejados;
                const aproveitamento = ((metrosDesejados / capacidadeTotal) * 100).toFixed(1);
                return {
                    bobina: b.nome,
                    capacidade_unitaria: Math.round(b.capacidade * 100) / 100,
                    qtd_bobinas: qtdBobinas,
                    capacidade_total: Math.round(capacidadeTotal * 100) / 100,
                    sobra_metros: Math.round(sobra * 100) / 100,
                    aproveitamento: parseFloat(aproveitamento)
                };
            });

            // Ordenar por melhor aproveitamento (maior primeiro)
            resultados.sort((a, b) => b.aproveitamento - a.aproveitamento);

            // Melhor opção = maior aproveitamento
            const melhor = resultados[0];

            // Bobina mínima viável = menor bobina que cabe toda a metragem em 1 unidade
            const minimaViavel = bobinas
                .filter(b => b.capacidade >= metrosDesejados)
                .sort((a, b) => a.capacidade - b.capacidade)[0] || null;

            res.json({
                categoria: dados.categoria,
                norma: dados.norma,
                secao: dados.secao + 'mm²',
                diametro: dados.diametro_mm + 'mm',
                metragem_solicitada: metrosDesejados,
                recomendacao: melhor ? {
                    bobina: melhor.bobina,
                    capacidade: melhor.capacidade_unitaria,
                    qtd_bobinas: melhor.qtd_bobinas,
                    aproveitamento: melhor.aproveitamento + '%',
                    sobra: melhor.sobra_metros
                } : null,
                bobina_unica: minimaViavel ? {
                    bobina: minimaViavel.nome,
                    capacidade: minimaViavel.capacidade,
                    sobra: Math.round((minimaViavel.capacidade - metrosDesejados) * 100) / 100
                } : null,
                todas_opcoes: resultados
            });
        } catch (error) {
            console.error('[BOBINAS] Erro no cálculo:', error.message);
            res.status(500).json({ error: 'Erro no cálculo de bobinas' });
        }
    });

    // GET /api/pcp/bobinas/tabela - Retornar tabela completa para visualização
    router.get('/bobinas/tabela', authenticateToken, async (req, res) => {
        try {
            const { categoria } = req.query;
            const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            let countQuery = 'SELECT COUNT(*) as total FROM bobinas_capacidade';
            let query = 'SELECT id, bobina, secao, categoria, capacidade_unitaria, peso_unitario, created_at FROM bobinas_capacidade';
            const params = [];
            const countParams = [];
            if (categoria) {
                query += ' WHERE categoria = ?';
                countQuery += ' WHERE categoria = ?';
                params.push(categoria);
                countParams.push(categoria);
            }
            const [[{ total }]] = await pool.query(countQuery, countParams);
            query += ' ORDER BY categoria, CAST(secao AS UNSIGNED) LIMIT ? OFFSET ?';
            params.push(limit, offset);
            const [rows] = await pool.query(query, params);
            res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('[BOBINAS] Erro ao carregar tabela:', error.message);
            res.status(500).json({ error: 'Erro ao carregar tabela' });
        }
    });
    // ========== FIM ROTAS BOBINAS ==========


    // ========================================
    // API: CRIAR PRODUTO (POST)
    // ========================================
    // SECURITY: Requer autenticação
    router.post('/api/produtos', authenticateToken, async (req, res) => {
        try {
            console.log('➕ Criando novo produto...');
            const dados = req.body;

            // Validar campos obrigatórios
            if (!dados.codigo || !dados.nome) {
                return res.status(400).json({ error: 'Código e Nome são obrigatórios' });
            }

            // Verificar se código já existe
            const [existe] = await pool.query('SELECT id FROM produtos WHERE codigo = ?', [dados.codigo]);
            if (existe.length > 0) {
                return res.status(400).json({ error: 'Código já existe' });
            }

            // Construir INSERT dinamicamente com campos básicos
            const camposParaInserir = {
                codigo: dados.codigo,
                nome: dados.nome,
                descricao: dados.descricao || '',
                gtin: dados.gtin || '',
                sku: dados.sku || '',
                marca: dados.marca || 'Aluforce',
                variacao: dados.variacao || '',
                custo_unitario: parseFloat(dados.preco || 0)
            };

            // Adicionar campos opcionais se fornecidos
            const camposOpcionais = {
                unidade_medida: dados.unidade_medida,
                ncm: dados.ncm,
                categoria: dados.categoria,
                tensao: dados.tensao,
                secao: dados.secao,
                material_condutor: dados.material_condutor,
                isolacao: dados.isolacao,
                norma: dados.norma,
                cor: dados.cor
            };

            Object.keys(camposOpcionais).forEach(campo => {
                if (camposOpcionais[campo] !== undefined) {
                    camposParaInserir[campo] = camposOpcionais[campo];
                }
            });

            const colunas = Object.keys(camposParaInserir);
            const valores = Object.values(camposParaInserir);
            const placeholders = colunas.map(() => '?').join(', ');

            const query = `INSERT INTO produtos (${colunas.join(', ')}) VALUES (${placeholders})`;

            const [result] = await pool.query(query, valores);

            console.log(`✅ Produto criado com ID: ${result.insertId}`);

            res.json({
                success: true,
                id: result.insertId,
                codigo: dados.codigo,
                nome: dados.nome,
                message: 'Produto criado com sucesso'
            });

        } catch (error) {
            console.error('❌ Erro ao criar produto:', error);
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // ========================================
    // API: ATUALIZAR PRODUTO (PUT)
    // ========================================
    // SECURITY: Requer autenticação
    router.put('/api/produtos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const dados = req.body;

            console.log(`🔄 Atualizando produto ID: ${id}`);

            // Verificar se produto existe
            const [produto] = await pool.query('SELECT id FROM produtos WHERE id = ?', [id]);
            if (produto.length === 0) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }

            // Obter colunas existentes na tabela produtos (com cache)
            const colunasExistentes = await getProdutoColumns(pool);
            console.log('📋 Colunas disponíveis na tabela:', colunasExistentes.join(', '));

            // Construir query dinamicamente apenas com campos que existem na tabela
            const camposParaAtualizar = {};

            // Mapeamento de campos do frontend para o banco
            const mapeamentoCampos = {
                codigo: dados.codigo,
                nome: dados.nome,
                descricao: dados.descricao,
                gtin: dados.gtin,
                sku: dados.sku,
                marca: dados.marca,
                variacao: dados.variacao,
                unidade_medida: dados.unidade_medida,
                ncm: dados.ncm,
                categoria: dados.categoria,
                tensao: dados.tensao,
                secao: dados.secao,
                material_condutor: dados.material_condutor,
                isolacao: dados.isolacao,
                norma: dados.norma,
                cor: dados.cor,
                localizacao: dados.localizacao,
                fornecedor: dados.fornecedor,
                fornecedor_principal: dados.fornecedor_principal,
                prazo_entrega: dados.prazo_entrega,
                qtd_minima_compra: dados.qtd_minima_compra,
                estoque_minimo: dados.estoque_minimo,
                estoque_maximo: dados.estoque_maximo,
                estoque_atual: dados.estoque_atual,
                estoque_disponivel: dados.estoque_disponivel,
                estoque_reservado: dados.estoque_reservado,
                estoque_transito: dados.estoque_transito,
                custo_aquisicao: dados.custo_aquisicao,
                custo_adicional: dados.custo_adicional,
                custo_total: dados.custo_total,
                markup: dados.markup,
                margem_lucro: dados.margem_lucro,
                peso: dados.peso,
                largura: dados.largura,
                altura: dados.altura,
                comprimento: dados.comprimento,
                obs_internas: dados.obs_internas,
                obs_fornecedor: dados.obs_fornecedor,
                obs_venda: dados.obs_venda,
                controle_lote: dados.controle_lote,
                familia: dados.familia
            };

            // Adicionar campo de preço (pode ser preco, preco_venda ou custo_unitario)
            if (dados.preco !== undefined) {
                if (colunasExistentes.includes('preco')) {
                    mapeamentoCampos.preco = dados.preco;
                } else if (colunasExistentes.includes('preco_venda')) {
                    mapeamentoCampos.preco_venda = dados.preco;
                } else if (colunasExistentes.includes('custo_unitario')) {
                    mapeamentoCampos.custo_unitario = dados.preco;
                }
            }

            // Filtrar apenas campos que existem na tabela e têm valor
            Object.keys(mapeamentoCampos).forEach(campo => {
                if (colunasExistentes.includes(campo) && mapeamentoCampos[campo] !== undefined) {
                    camposParaAtualizar[campo] = mapeamentoCampos[campo];
                }
            });

            if (Object.keys(camposParaAtualizar).length === 0) {
                return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
            }

            console.log('📝 Campos que serão atualizados:', Object.keys(camposParaAtualizar).join(', '));

            // AUDIT-FIX S1.4: Validar nomes de coluna contra regex seguro (defesa em profundidade)
            const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
            const setClauses = Object.keys(camposParaAtualizar).map(campo => {
                if (!SAFE_IDENTIFIER.test(campo)) {
                    throw new Error(`Campo inválido rejeitado: ${campo}`);
                }
                return `\`${campo}\` = ?`;
            });
            const valores = Object.values(camposParaAtualizar);
            valores.push(id); // WHERE id = ?

            const query = `UPDATE produtos SET ${setClauses.join(', ')} WHERE id = ?`;

            await pool.query(query, valores);

            console.log(`✅ Produto ${id} atualizado com sucesso`);

            res.json({
                success: true,
                id: parseInt(id),
                message: 'Produto atualizado com sucesso'
            });

        } catch (error) {
            console.error('❌ Erro ao atualizar produto:', error);
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // ========================================
    // API: BUSCAR PRODUTO POR ID (GET)
    // ========================================
    router.get('/api/produtos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            const [produtos] = await pool.query('SELECT id, codigo, codigo_produto, nome, descricao, unidade, preco, preco_custo, preco_venda, ncm, cfop, cst, categoria, estoque_atual, estoque_minimo, peso_liquido, peso_bruto, ativo, created_at, updated_at FROM produtos WHERE id = ?', [id]);

            if (produtos.length === 0) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }

            res.json(produtos[0]);

        } catch (error) {
            console.error('❌ Erro ao buscar produto:', error);
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // ========================================
    // API PCP: PRODUTOS (Alias para /api/produtos)
    // ========================================

    // ========================================
    // API VENDAS: Rotas consolidadas em seção dedicada (linhas 11245+)
    // ========================================

    // ========================================
    // API: ALERTAS DE ESTOQUE
    // ========================================
    router.get('/api/alertas-estoque', authenticateToken, async (req, res) => {
        try {
            console.log('⚠️ Buscando alertas de estoque...');

            // AUDIT-FIX R-08: Buscar dados REAIS de estoque do banco de dados
            const query = `
                SELECT
                    id,
                    codigo,
                    nome,
                    descricao,
                    marca,
                    custo_unitario,
                    gtin,
                    sku,
                    COALESCE(estoque_atual, 0) as quantidade_atual,
                    COALESCE(estoque_minimo, 10) as estoque_minimo
                FROM produtos
                WHERE ativo = 1 OR ativo IS NULL
                ORDER BY nome
                LIMIT 200
            `;

            const [produtos] = await pool.query(query);

            // AUDIT-FIX R-08: Classificar produtos por status usando dados REAIS do banco
            const alertasFormatados = produtos.map((produto) => {
                const quantidade_atual = parseInt(produto.quantidade_atual) || 0;
                const estoque_minimo = parseInt(produto.estoque_minimo) || 10;

                let status = 'normal';
                if (quantidade_atual === 0) {
                    status = 'critico';
                } else if (quantidade_atual < estoque_minimo * 0.5) {
                    status = 'baixo';
                } else if (quantidade_atual < estoque_minimo) {
                    status = 'baixo';
                }

                return {
                    id: produto.id,
                    codigo: produto.codigo || `PROD-${produto.id}`,
                    nome: produto.nome || produto.descricao,
                    quantidade_atual: quantidade_atual,
                    estoque_minimo: estoque_minimo,
                    localizacao: produto.marca || 'Não informada',
                    status: status,
                    fornecedor: produto.marca || 'Não informado',
                    custo_unitario: parseFloat(produto.custo_unitario) || 0,
                    preco: parseFloat(produto.custo_unitario) || 0
                };
            });

            // Filtrar apenas produtos com status baixo ou crítico
            const alertasFiltrados = alertasFormatados.filter(a => a.status === 'baixo' || a.status === 'critico');

            console.log(`✅ ${alertasFiltrados.length} alertas de estoque encontrados`);
            res.json({
                total: alertasFiltrados.length,
                alertas: alertasFiltrados
            });

        } catch (error) {
            console.error('❌ Erro ao buscar alertas de estoque:', error);
            res.status(500).json({
                error: 'Erro ao buscar alertas',
                total: 0,
                alertas: []
            });
        }
    });

    // [REFACTORED] Configuracoes do Sistema (empresa, impostos, vendedores, certificados, etc.)
    require('./pcp/configuracoes-routes')(router, deps);

    // ========================================
    // BAIXA AUTOMÁTICA DE ESTOQUE EM TEMPO REAL
    // ========================================
    /**
     * Função para baixar estoque automaticamente quando um pedido é criado/confirmado
     * Suporta divisão de lances (ex: 600m de TRN70, pedido de 300m = fica 300m)
     */
    async function baixarEstoqueAutomatico(connection, pedidoId, itens, usuarioId = null) {
        console.log(`[ESTOQUE_AUTO] Iniciando baixa automática para pedido ${pedidoId}`);

        const movimentacoes = [];

        for (const item of itens) {
            const codigoMaterial = item.codigo || item.codigo_material || item.sku;
            const quantidade = parseFloat(item.quantidade || 0);
            const unidade = item.unidade || 'm';

            if (!codigoMaterial || quantidade <= 0) continue;

            try {
                // Buscar produto no estoque
                const [produtos] = await connection.query(`
                    SELECT id, codigo, descricao, estoque_atual, unidade_medida
                    FROM produtos
                    WHERE codigo = ? OR sku = ? OR LOWER(descricao) LIKE LOWER(?)
                    LIMIT 1
                `, [codigoMaterial, codigoMaterial, `%${codigoMaterial}%`]);

                if (produtos.length === 0) {
                    console.log(`[ESTOQUE_AUTO] Produto não encontrado: ${codigoMaterial}`);
                    continue;
                }

                const produto = produtos[0];
                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                const novoEstoque = Math.max(0, estoqueAnterior - quantidade);

                // Atualizar estoque do produto
                await connection.query(`
                    UPDATE produtos
                    SET estoque_atual = ?,
                        ultima_saida = NOW()
                    WHERE id = ?
                `, [novoEstoque, produto.id]);

                // Registrar movimentação
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                    VALUES (?, 'saida', 'pedido_venda', ?, ?, ?, 'pedido', ?, ?, ?, NOW())
                `, [
                    produto.codigo,
                    quantidade,
                    estoqueAnterior,
                    novoEstoque,
                    pedidoId,
                    usuarioId,
                    `Baixa automática - Pedido #${pedidoId} - ${quantidade}${unidade}`
                ]);

                movimentacoes.push({
                    produto: produto.codigo,
                    descricao: produto.descricao,
                    quantidade_baixada: quantidade,
                    estoque_anterior: estoqueAnterior,
                    estoque_atual: novoEstoque,
                    unidade: unidade
                });

                console.log(`[ESTOQUE_AUTO] Baixa realizada: ${produto.codigo} - ${quantidade}${unidade} (${estoqueAnterior} -> ${novoEstoque})`);

            } catch (err) {
                console.error(`[ESTOQUE_AUTO] Erro ao baixar ${codigoMaterial}:`, err.message);
            }
        }

        return movimentacoes;
    }

    // Rota para baixar estoque manualmente (admin)
    router.post('/api/estoque/baixar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { pedido_id, itens } = req.body;
            const usuario_id = req.user?.id;

            if (!itens || !Array.isArray(itens) || itens.length === 0) {
                throw new Error('Itens não informados');
            }

            const movimentacoes = await baixarEstoqueAutomatico(connection, pedido_id || 0, itens, usuario_id);

            await connection.commit();

            res.json({
                success: true,
                message: `Estoque baixado com sucesso! ${movimentacoes.length} produtos atualizados.`,
                movimentacoes
            });
        } catch (error) {
            await connection.rollback();
            console.error('[ESTOQUE_BAIXAR] Erro:', error);
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
        } finally {
            connection.release();
        }
    });

    // Rota para buscar produtos com estoque disponível (para PCP)
    router.get('/estoque/produtos', authenticateToken, async (req, res) => {
        try {
            const [produtos] = await pool.query(`
                SELECT
                    p.id,
                    p.codigo,
                    p.descricao as nome,
                    p.sku,
                    p.categoria,
                    p.unidade_medida,
                    COALESCE(p.estoque_atual, 0) as estoque_atual,
                    COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                    p.preco_venda as preco,
                    CASE
                        WHEN COALESCE(p.estoque_atual, 0) <= 0 THEN 'zerado'
                        WHEN COALESCE(p.estoque_atual, 0) <= COALESCE(p.estoque_minimo, 10) THEN 'baixo'
                        ELSE 'normal'
                    END as status_estoque,
                    p.updated_at
                FROM produtos p
                WHERE p.estoque_atual > 0 OR p.id IN (
                    SELECT DISTINCT
                        CASE
                            WHEN pr.id IS NOT NULL THEN pr.id
                            ELSE NULL
                        END
                    FROM estoque_movimentacoes em
                    LEFT JOIN produtos pr ON (pr.codigo = em.codigo_material OR pr.sku = em.codigo_material)
                    WHERE em.tipo_movimento = 'entrada'
                )
                ORDER BY p.codigo ASC
            `);

            res.json({
                success: true,
                total: produtos.length,
                produtos: produtos
            });
        } catch (error) {
            console.error('[PCP_ESTOQUE] Erro:', error);
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =========================
    // ETAPAS DO PROCESSO PCP
    // =========================

    // GET /api/pcp/etapas - Buscar etapas configuradas do processo de faturamento
    router.get('/etapas', authenticateToken, async (req, res) => {
        try {
            // Buscar etapas existentes
            const [etapas] = await pool.query(`
                SELECT id, nome, cor, icone, ordem
                FROM pcp_etapas_processo
                WHERE ativo = 1
                ORDER BY ordem ASC
            `);

            // Se não houver etapas, inserir as padrão
            if (etapas.length === 0) {
                const etapasPadrao = [
                    { nome: 'Orçamento', cor: '#94a3b8', icone: 'fa-file-alt', ordem: 1 },
                    { nome: 'Análise de Crédito', cor: '#f59e0b', icone: 'fa-search-dollar', ordem: 2 },
                    { nome: 'Pedido Aprovado', cor: '#3b82f6', icone: 'fa-thumbs-up', ordem: 3 },
                    { nome: 'Faturar', cor: '#f97316', icone: 'fa-file-invoice', ordem: 4 },
                    { nome: 'Faturado', cor: '#22c55e', icone: 'fa-check-circle', ordem: 5 },
                    { nome: 'Recibo', cor: '#8b5cf6', icone: 'fa-receipt', ordem: 6 }
                ];

                for (const etapa of etapasPadrao) {
                    await pool.query(
                        'INSERT INTO pcp_etapas_processo (nome, cor, icone, ordem) VALUES (?, ?, ?, ?)',
                        [etapa.nome, etapa.cor, etapa.icone, etapa.ordem]
                    );
                }

                // Buscar novamente
                const [novasEtapas] = await pool.query(`
                    SELECT id, nome, cor, icone, ordem
                    FROM pcp_etapas_processo
                    WHERE ativo = 1
                    ORDER BY ordem ASC
                `);

                return res.json({
                    success: true,
                    etapas: novasEtapas
                });
            }

            res.json({
                success: true,
                etapas: etapas
            });
        } catch (error) {
            console.error('[PCP_ETAPAS] Erro ao buscar etapas:', error);
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // POST /api/pcp/etapas - Salvar configuração de etapas
    router.post('/etapas', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { etapas, alterarNumeracao } = req.body;

            if (!Array.isArray(etapas) || etapas.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'É necessário pelo menos 2 etapas'
                });
            }

            // Desativar todas as etapas atuais
            await connection.query('UPDATE pcp_etapas_processo SET ativo = 0');

            // Inserir ou atualizar cada etapa
            for (let i = 0; i < etapas.length; i++) {
                const etapa = etapas[i];

                if (etapa.id && typeof etapa.id === 'number' && etapa.id < 100000000) {
                    // Atualizar etapa existente
                    await connection.query(`
                        UPDATE pcp_etapas_processo
                        SET nome = ?, cor = ?, icone = ?, ordem = ?, ativo = 1
                        WHERE id = ?
                    `, [etapa.nome, etapa.cor || '#64748b', etapa.icone || 'fa-tag', i + 1, etapa.id]);
                } else {
                    // Inserir nova etapa
                    await connection.query(`
                        INSERT INTO pcp_etapas_processo (nome, cor, icone, ordem, ativo)
                        VALUES (?, ?, ?, ?, 1)
                    `, [etapa.nome, etapa.cor || '#64748b', etapa.icone || 'fa-tag', i + 1]);
                }
            }

            await connection.commit();

            // Buscar etapas atualizadas
            const [etapasAtualizadas] = await pool.query(`
                SELECT id, nome, cor, icone, ordem
                FROM pcp_etapas_processo
                WHERE ativo = 1
                ORDER BY ordem ASC
            `);

            console.log(`[PCP_ETAPAS] ${etapasAtualizadas.length} etapas salvas com sucesso`);

            res.json({
                success: true,
                message: 'Etapas atualizadas com sucesso',
                etapas: etapasAtualizadas
            });
        } catch (error) {
            await connection.rollback();
            console.error('[PCP_ETAPAS] Erro ao salvar etapas:', error);
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
        } finally {
            connection.release();
        }
    });

    // [REFACTORED] Sistema de Impressao (fila, impressoras, configuracoes)
    require('./pcp/print-routes')(router, deps);

    // API PARA BUSCAR ÚLTIMO NÚMERO DE PEDIDO
    router.get('/ultimo-pedido', authenticateToken, async (req, res) => {
        try {
            console.log('🔍 Buscando último número de pedido...');

            const connection = await pool.getConnection();
            try {
                // AUDIT-FIX S1.1: Usar sequence table ou fallback para MAX com FOR UPDATE
                let ultimoNumero = '0002025000';

                // Tentar sequence table primeiro (atômico)
                try {
                    const [seqRows] = await connection.query(
                        'SELECT current_val FROM sequences WHERE seq_name = ? FOR UPDATE',
                        ['pedido_op']
                    );
                    if (seqRows.length > 0 && seqRows[0].current_val > 0) {
                        ultimoNumero = String(seqRows[0].current_val);
                    }
                } catch (_) {
                    // Fallback: MAX query (tabela sequences pode não existir ainda)
                    const [rows] = await connection.query(`
                        SELECT MAX(CAST(numero_pedido AS UNSIGNED)) as ultimo_numero
                        FROM ordens_producao
                        WHERE numero_pedido IS NOT NULL
                        AND numero_pedido REGEXP '^[0-9]+$'
                    `);
                    if (rows && rows.length > 0 && rows[0].ultimo_numero) {
                        ultimoNumero = String(rows[0].ultimo_numero);
                    }
                }

                console.log('✅ Último número de pedido:', ultimoNumero);

                res.json({
                    success: true,
                    ultimo_numero: ultimoNumero
                });

            } finally {
                connection.release();
            }

        } catch (error) {
            console.error('❌ Erro ao buscar último pedido:', error);
            // Retornar número padrão em caso de erro
            res.json({
                success: true,
                ultimo_numero: '0002025000'
            });
        }
    });

    // API PARA GERAR ORDEM DE PRODUÇÁO EM EXCEL
    router.post('/api/gerar-ordem-excel', authenticateToken, async (req, res) => {
        try {
            console.log('📊 Iniciando geração de Ordem de Produção em Excel...');

            const dadosOrdem = req.body;

            // 🔧 FIX BUG-OP-01: Normalizar nomes de campos com cedilha (ç) enviados pelo frontend
            if (!dadosOrdem.numero_orcamento && dadosOrdem['num_orçamento']) {
                dadosOrdem.numero_orcamento = dadosOrdem['num_orçamento'];
            }
            if (!dadosOrdem.numero_orcamento && dadosOrdem.num_orcamento) {
                dadosOrdem.numero_orcamento = dadosOrdem.num_orcamento;
            }
            if (!dadosOrdem.numero_pedido && dadosOrdem.num_pedido) {
                dadosOrdem.numero_pedido = dadosOrdem.num_pedido;
            }

            console.log('🔍 DADOS RECEBIDOS - TRANSPORTADORA:', {
                transportadora_nome: dadosOrdem.transportadora_nome,
                transportadora_fone: dadosOrdem.transportadora_fone,
                transportadora_cep: dadosOrdem.transportadora_cep,
                transportadora_endereco: dadosOrdem.transportadora_endereco,
                transportadora_cpf_cnpj: dadosOrdem.transportadora_cpf_cnpj,
                transportadora_email_nfe: dadosOrdem.transportadora_email_nfe
            });

            // Validar dados obrigatórios
            if (!dadosOrdem.numero_orcamento || !dadosOrdem.cliente) {
                return res.status(400).json({
                    error: 'Dados obrigatórios não fornecidos (numero_orcamento, cliente)'
                });
            }

            // 🔧 FIX: Buscar dados completos do cliente no banco quando faltam campos
            if (dadosOrdem.cliente && (!dadosOrdem.cpf_cnpj || !dadosOrdem.contato_cliente || !dadosOrdem.fone_cliente)) {
                try {
                    const [clienteRows] = await pool.query(
                        'SELECT cnpj_cpf, contato, telefone, email, endereco, bairro, cidade, estado, cep FROM clientes WHERE (nome = ? OR razao_social = ? OR nome_fantasia = ?) AND ativo = 1 LIMIT 1',
                        [dadosOrdem.cliente, dadosOrdem.cliente, dadosOrdem.cliente]
                    );
                    if (clienteRows.length > 0) {
                        const cli = clienteRows[0];
                        if (!dadosOrdem.cpf_cnpj) dadosOrdem.cpf_cnpj = cli.cnpj_cpf || '';
                        if (!dadosOrdem.contato_cliente) dadosOrdem.contato_cliente = cli.contato || '';
                        if (!dadosOrdem.fone_cliente) dadosOrdem.fone_cliente = cli.telefone || '';
                        if (!dadosOrdem.email_cliente) dadosOrdem.email_cliente = cli.email || '';
                        if (!dadosOrdem.endereco) dadosOrdem.endereco = [cli.endereco, cli.bairro, cli.cidade, cli.estado].filter(Boolean).join(', ');
                        if (!dadosOrdem.cep) dadosOrdem.cep = cli.cep || '';
                        console.log('✅ Dados do cliente enriquecidos via banco:', cli.cnpj_cpf);
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados do cliente:', dbErr.message);
                }
            }

            // 🔧 FIX: Buscar dados completos da transportadora no banco quando faltam campos
            if (dadosOrdem.transportadora_nome && (!dadosOrdem.transportadora_fone || !dadosOrdem.transportadora_cep)) {
                try {
                    const [transpRows] = await pool.query(
                        'SELECT cnpj_cpf, telefone, email, bairro, cidade, estado, cep FROM transportadoras WHERE (razao_social = ? OR nome_fantasia = ?) LIMIT 1',
                        [dadosOrdem.transportadora_nome, dadosOrdem.transportadora_nome]
                    );
                    if (transpRows.length > 0) {
                        const tr = transpRows[0];
                        if (!dadosOrdem.transportadora_fone) dadosOrdem.transportadora_fone = tr.telefone || '';
                        if (!dadosOrdem.transportadora_cpf_cnpj) dadosOrdem.transportadora_cpf_cnpj = tr.cnpj_cpf || '';
                        if (!dadosOrdem.transportadora_email_nfe) dadosOrdem.transportadora_email_nfe = tr.email || '';
                        if (!dadosOrdem.transportadora_cep) dadosOrdem.transportadora_cep = tr.cep || '';
                        if (!dadosOrdem.transportadora_endereco) dadosOrdem.transportadora_endereco = [tr.bairro, tr.cidade, tr.estado].filter(Boolean).join(', ');
                        console.log('✅ Dados da transportadora enriquecidos via banco:', tr.cnpj_cpf);
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados da transportadora:', dbErr.message);
                }
            }

            try {
                console.log('📊 Tentando gerar XLSX usando template com ExcelJS...');

                const ExcelJS = require('exceljs');
                const fs = require('fs');
                const path = require('path');

                console.log('✅ ExcelJS carregado');

                // 🔧 TEMPLATE POR EMPRESA (23/07/2026): cada marca tem seu modelo de OP.
                // Os modelos de Aluforce e Energy foram atualizados pelo cliente e divergem
                // entre si no rodapé (observações/pagamento/total ficam em linhas diferentes),
                // por isso o layout é DETECTADO em runtime — ver detectarLayoutOP().
                // labor-eletric segue no template genérico até receber modelo próprio.
                const templatePath = resolverTemplateOP();
                const dataOrdem = dadosOrdem.data_liberacao || new Date().toLocaleDateString('pt-BR');
                // Formatar nome do cliente para nome de arquivo válido
                const nomeCliente = (dadosOrdem.cliente || dadosOrdem.cliente_razao || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
                const nomeArquivo = `Ordem de Produção - ${nomeCliente} - ERP.xlsx`;
                const outputPath = path.join(__dirname, nomeArquivo);

                console.log('📂 Template path:', templatePath);
                console.log('📄 Output path:', outputPath);

                // Verificar se template existe
                if (!fs.existsSync(templatePath)) {
                    throw new Error(`Template não encontrado: ${templatePath}`);
                }

                // Usar função existente que carrega e preenche o template
                const fileBuffer = await gerarExcelOrdemProducaoCompleta(dadosOrdem, ExcelJS, templatePath);

                console.log('✅ Template processado');
                console.log(`📊 Buffer gerado: ${fileBuffer.length} bytes`);

                // FIX BUG-17: Content-Disposition com RFC 5987 encoding para Unicode + prevenir header injection
                const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
                const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
                res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Length', fileBuffer.length);

                res.send(fileBuffer);

                console.log(`✅ Excel gerado com sucesso usando template: ${nomeArquivo}`);

            } catch (excelError) {
                console.error('[XLSX] Erro ao gerar:', excelError.message);

                // 🔧 FIX BUG-R5-31: Wrap CSV fallback em try/catch para não crashar silenciosamente
                try {
                    const csvBuffer = await gerarExcelOrdemProducaoFallback(dadosOrdem);

                    const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
                    const nomeArquivo = `Ordem de Produção - ${nomeCliente} - ERP.csv`;
                    const encodedCsvName = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
                    const asciiCsvName = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

                    res.setHeader('Content-Disposition', `attachment; filename="${asciiCsvName}"; filename*=UTF-8''${encodedCsvName}`);
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                    res.setHeader('Content-Length', csvBuffer.length);

                    res.send(csvBuffer);

                    console.log(`✅ CSV gerado com sucesso como fallback: ${nomeArquivo}`);
                } catch (csvError) {
                    console.error('[CSV Fallback] Também falhou:', csvError.message);
                    res.status(500).json({
                        error: 'Erro ao gerar Excel e CSV. Contate o suporte.',
                        detalhe: excelError.message
                    });
                }
            }

        } catch (error) {
            console.error('❌ Erro ao gerar Excel da ordem de produção:', error);
            res.status(500).json({
                error: 'Erro interno do servidor ao gerar Excel'
            });
        }
    });

    // ==================== ORDEM DE PRODUÇÃO → PDF (XSL-FO / Apache FOP) ====================
    // Pipeline: dados → XML (xmlbuilder2) → XSLT transforma em XSL-FO → Apache FOP gera PDF
    const { gerarOrdemXML, formatarData } = require('../services/ordem-xml-generator');
    const { gerarPdfComFop, verificarFop } = require('../services/fop-pdf-service');
    // PDF da OP sai diretamente do template HTML aprovado
    // (modules/PCP/Ordem de Produção - Template.html), renderizado pelo Puppeteer.
    // A exportação em .xlsx NÃO foi tocada e continua no caminho do ExcelJS.
    const { montarHtmlOrdemProducao } = require('../services/op-html-render.service');
    const { htmlParaPdf } = require('../services/pdf-render.service');
    const { buscarConfiguracoesEmpresa, formatarDadosParaPDF } = require('../modules/_shared/services/empresa-config.service');

    // GET /api/ordem-pdf/status - Verifica se FOP está disponível
    router.get('/api/ordem-pdf/status', authenticateToken, (req, res) => {
        const status = verificarFop();
        res.json({ fop: status });
    });

    // POST /api/gerar-ordem-pdf - Gera PDF da Ordem de Produção via XSL-FO
    router.post('/api/gerar-ordem-pdf', authenticateToken, async (req, res) => {
        try {
            console.log('📄 Iniciando geração de Ordem de Produção em PDF (XSL-FO)...');

            const dadosOrdem = req.body;

            // Normalizar campos com cedilha (mesmo tratamento da rota Excel)
            if (!dadosOrdem.numero_orcamento && dadosOrdem['num_orçamento']) {
                dadosOrdem.numero_orcamento = dadosOrdem['num_orçamento'];
            }
            if (!dadosOrdem.numero_orcamento && dadosOrdem.num_orcamento) {
                dadosOrdem.numero_orcamento = dadosOrdem.num_orcamento;
            }
            if (!dadosOrdem.numero_pedido && dadosOrdem.num_pedido) {
                dadosOrdem.numero_pedido = dadosOrdem.num_pedido;
            }

            // Validar dados obrigatórios
            if (!dadosOrdem.numero_orcamento || !dadosOrdem.cliente) {
                return res.status(400).json({
                    error: 'Dados obrigatórios não fornecidos (numero_orcamento, cliente)'
                });
            }

            // Enriquecer dados do cliente via banco (se faltam campos)
            if (dadosOrdem.cliente && (!dadosOrdem.cpf_cnpj || !dadosOrdem.contato_cliente || !dadosOrdem.fone_cliente)) {
                try {
                    const [clienteRows] = await pool.query(
                        'SELECT cnpj_cpf, contato, telefone, email, endereco, bairro, cidade, estado, cep FROM clientes WHERE (nome = ? OR razao_social = ? OR nome_fantasia = ?) AND ativo = 1 LIMIT 1',
                        [dadosOrdem.cliente, dadosOrdem.cliente, dadosOrdem.cliente]
                    );
                    if (clienteRows.length > 0) {
                        const cli = clienteRows[0];
                        if (!dadosOrdem.cpf_cnpj) dadosOrdem.cpf_cnpj = cli.cnpj_cpf || '';
                        if (!dadosOrdem.contato_cliente) dadosOrdem.contato_cliente = cli.contato || '';
                        if (!dadosOrdem.fone_cliente) dadosOrdem.fone_cliente = cli.telefone || '';
                        if (!dadosOrdem.email_cliente) dadosOrdem.email_cliente = cli.email || '';
                        if (!dadosOrdem.endereco) dadosOrdem.endereco = [cli.endereco, cli.bairro, cli.cidade, cli.estado].filter(Boolean).join(', ');
                        if (!dadosOrdem.cep) dadosOrdem.cep = cli.cep || '';
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados do cliente para PDF:', dbErr.message);
                }
            }

            // Enriquecer dados da transportadora via banco
            if (dadosOrdem.transportadora_nome && (!dadosOrdem.transportadora_fone || !dadosOrdem.transportadora_cep)) {
                try {
                    const [transpRows] = await pool.query(
                        'SELECT cnpj_cpf, telefone, email, bairro, cidade, estado, cep FROM transportadoras WHERE (razao_social = ? OR nome_fantasia = ?) LIMIT 1',
                        [dadosOrdem.transportadora_nome, dadosOrdem.transportadora_nome]
                    );
                    if (transpRows.length > 0) {
                        const tr = transpRows[0];
                        if (!dadosOrdem.transportadora_fone) dadosOrdem.transportadora_fone = tr.telefone || '';
                        if (!dadosOrdem.transportadora_cpf_cnpj) dadosOrdem.transportadora_cpf_cnpj = tr.cnpj_cpf || '';
                        if (!dadosOrdem.transportadora_email_nfe) dadosOrdem.transportadora_email_nfe = tr.email || '';
                        if (!dadosOrdem.transportadora_cep) dadosOrdem.transportadora_cep = tr.cep || '';
                        if (!dadosOrdem.transportadora_endereco) dadosOrdem.transportadora_endereco = [tr.bairro, tr.cidade, tr.estado].filter(Boolean).join(', ');
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados da transportadora para PDF:', dbErr.message);
                }
            }

            // 0. Buscar dados da empresa do banco
            try {
                const empresaConfig = await buscarConfiguracoesEmpresa(pool);
                const dadosEmpPDF = formatarDadosParaPDF(empresaConfig);
                dadosOrdem.empresa = {
                    nome: dadosEmpPDF.nome,
                    razao_social: dadosEmpPDF.nome,
                    endereco: dadosEmpPDF.endereco,
                    bairro: dadosEmpPDF.bairro || '',
                    cep: dadosEmpPDF.cep,
                    cidade: dadosEmpPDF.cidade,
                    estado: dadosEmpPDF.estado,
                    enderecoCompleto: `${dadosEmpPDF.endereco}, ${dadosEmpPDF.numero || ''} - ${dadosEmpPDF.bairro || ''}`.replace(/ - $/, '')
                };
                // O objeto acima é um recorte (sem CNPJ/IE/telefone/e-mail/site). O
                // cabeçalho do template HTML precisa dos campos completos.
                dadosOrdem.empresaPDF = dadosEmpPDF;
            } catch (empErr) {
                console.warn('⚠️ Erro ao buscar config empresa para OP PDF:', empErr.message);
            }

            // 1. Montar o HTML a partir do template aprovado da OP
            const htmlOrdem = montarHtmlOrdemProducao(dadosOrdem, dadosOrdem.empresaPDF);
            console.log(`📝 HTML da OP montado: ${htmlOrdem.length} bytes`);

            // `formato=html` devolve o próprio template para a tela. Antes, a tela
            // montava um HTML PRÓPRIO no cliente (gerarPdfOP em modules/PCP/js/
            // index-inline.js) e o PDF saía daqui: eram dois documentos diferentes
            // para a mesma OP. Agora a tela e o PDF são o mesmo template.
            const formato = String(req.query.formato || dadosOrdem.formato || '').toLowerCase();
            if (formato === 'html') {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send(htmlOrdem);
            }

            // 2. HTML → PDF (Puppeteer). O template já define as margens em mm
            // dentro do .report-page, então a página sai sem margem extra.
            const pdfBuffer = await htmlParaPdf(htmlOrdem, {
                margens: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
            });
            console.log(`✅ PDF gerado: ${pdfBuffer.length} bytes`);

            // 3. Enviar PDF
            const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
            const nomeArquivo = `Ordem de Produção - ${nomeCliente}.pdf`;
            const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
            const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

            res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);

            res.send(pdfBuffer);
            console.log(`✅ PDF da OP enviado: ${nomeArquivo}`);

        } catch (error) {
            console.error('❌ Erro ao gerar PDF da ordem de produção:', error);
            res.status(500).json({
                error: 'Erro ao gerar PDF da Ordem de Produção',
                detalhe: error.message
            });
        }
    });

    // GET /ordens-producao/:id/pdf-completo - Gera o PDF (mesmo template XSL-FO do /api/gerar-ordem-pdf)
    // para uma ordem JÁ SALVA no banco. Usado pela tela de visualização/impressão da OP, que antes
    // não tinha acesso aos dados comerciais (cliente, vendedor, orçamento etc.) porque a listagem
    // (GET /ordens-kanban) não seleciona essas colunas.
    router.get('/ordens-producao/:id/pdf-completo', async (req, res) => {
        try {
            const { id } = req.params;
            const [[ordem]] = await pool.query('SELECT * FROM ordens_producao WHERE id = ?', [id]);
            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }

            // A OP guarda os dados de produção, mas os dados comerciais continuam no
            // pedido que a originou. A mesma resolução usada pela aba Produtos evita
            // PDFs com cliente preenchido e preço/lance/cores/pesos zerados.
            const resultadoItens = await produtosDaOrdem(id);
            const pedidoBasico = resultadoItens && resultadoItens.pedido;
            let pedido = null;
            if (pedidoBasico && pedidoBasico.id) {
                const [[linhaPedido]] = await pool.query(`
                    SELECT p.*,
                           COALESCE(c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_razao_social,
                           COALESCE(c.cnpj_cpf, c.cnpj, c.cpf) AS cliente_documento,
                           COALESCE(p.contato, c.nome_contato, c.contato) AS cliente_contato_real,
                           COALESCE(p.email_cliente, c.email_nfe, c.email) AS cliente_email_real,
                           COALESCE(c.telefone, c.fone, c.celular) AS cliente_telefone_real,
                           c.cep AS cliente_cep_real,
                           CONCAT_WS(', ', NULLIF(c.endereco, ''), NULLIF(c.numero, '')) AS cliente_logradouro,
                           CONCAT_WS(' - ', NULLIF(c.bairro, ''),
                               NULLIF(CONCAT_WS('/', NULLIF(c.cidade, ''), NULLIF(c.estado, '')), '')) AS cliente_localidade,
                           COALESCE(NULLIF(p.vendedor_nome, ''), NULLIF(p.vendedor_orcamento_nome, ''),
                               NULLIF(u.nome, ''), NULLIF(c.vendedor_padrao, ''), NULLIF(c.vendedor_responsavel, '')) AS vendedor_real,
                           COALESCE(NULLIF(t.razao_social, ''), NULLIF(t.nome_fantasia, ''),
                               NULLIF(p.transportadora_nome, ''), NULLIF(p.transportadora, '')) AS transportadora_real,
                           t.cnpj_cpf AS transportadora_documento,
                           t.telefone AS transportadora_telefone_real,
                           t.email AS transportadora_email_real,
                           t.cep AS transportadora_cep_real,
                           CONCAT_WS(', ', NULLIF(t.endereco, ''), NULLIF(t.numero, '')) AS transportadora_logradouro,
                           CONCAT_WS(' - ', NULLIF(t.bairro, ''),
                               NULLIF(CONCAT_WS('/', NULLIF(t.cidade, ''), NULLIF(t.estado, '')), '')) AS transportadora_localidade
                    FROM pedidos p
                    LEFT JOIN clientes c ON c.id = p.cliente_id
                    LEFT JOIN usuarios u ON u.id = p.vendedor_id
                    LEFT JOIN transportadoras t ON t.id = p.transportadora_id
                    WHERE p.id = ?
                    LIMIT 1
                `, [pedidoBasico.id]);
                pedido = linhaPedido || pedidoBasico;
            }

            // Itens próprios da produção têm prioridade; sem materialização, a rotina
            // traz pedido_itens e completa cores/pesos pela árvore e estrutura.
            let produtos = [];
            if (resultadoItens && Array.isArray(resultadoItens.itens) && resultadoItens.itens.length) {
                produtos = resultadoItens.itens
                    .filter(item => item.status !== 'cancelado')
                    .map(item => ({
                        ...item,
                        valor_unitario: item.valor_unitario,
                        valor_total: item.valor_total
                    }));
            }
            const produtosRaw = ordem.produtos_json || ordem.produtos;
            if (!produtos.length && produtosRaw) {
                try {
                    produtos = typeof produtosRaw === 'string' ? JSON.parse(produtosRaw) : produtosRaw;
                    if (!Array.isArray(produtos)) produtos = [];
                } catch (_) { produtos = []; }
            }
            if (produtos.length === 0) {
                produtos = [{
                    codigo: ordem.codigo_produto || ordem.codigo || '',
                    descricao: ordem.descricao_produto || ordem.produto_nome || '',
                    embalagem: ordem.tipo_embalagem_entrega || 'Bobina',
                    lances: '',
                    quantidade: ordem.quantidade || 0,
                    valor_unitario: 0,
                    codigo_cores: ordem.cores_pe || '',
                    peso_liquido: ordem.peso_liquido || '',
                    lote: ordem.codigo || ''
                }];
            }

            const somarProdutos = campo => produtos.reduce(
                (total, item) => total + (Number(item && item[campo]) || 0), 0
            );
            const embalagensProdutos = [...new Set(produtos
                .map(item => String((item && item.embalagem) || '').trim())
                .filter(Boolean))];
            const volumesPorLances = produtos.reduce((total, item) => {
                const texto = String((item && item.lances) || '').trim();
                const match = texto.match(/^(\d+)\s*[xX]/);
                return total + (match ? Number(match[1]) : (texto ? 1 : 0));
            }, 0);
            const pesoBrutoItens = somarProdutos('peso_bruto');
            const pesoLiquidoItens = somarProdutos('peso_liquido');

            const dadosOrdem = {
                numero_orcamento: ordem.numero_orcamento || ordem.codigo || '',
                revisao: ordem.revisao || '01',
                numero_pedido: ordem.numero_pedido || ordem.num_pedido || (pedido && pedido.numero_pedido) || '',
                data_liberacao: ordem.data_liberacao ? formatarData(ordem.data_liberacao) : formatarData(ordem.created_at),
                vendedor: ordem.vendedor || ordem.vendedor_nome || (pedido && pedido.vendedor_real) || '',
                prazo_entrega: ordem.prazo_entrega || (pedido && (pedido.prazo_entrega || (pedido.data_prevista && formatarData(pedido.data_prevista)))) || (ordem.data_prevista ? formatarData(ordem.data_prevista) : ''),
                tipo_frete: ordem.tipo_frete || ordem.frete || (pedido && (pedido.tipo_frete || pedido.frete)) || 'CIF',
                cliente: ordem.cliente_nome || ordem.cliente || (pedido && pedido.cliente_razao_social) || '',
                contato_cliente: ordem.cliente_contato || ordem.contato || (pedido && pedido.cliente_contato_real) || '',
                fone_cliente: ordem.cliente_telefone || ordem.telefone || (pedido && pedido.cliente_telefone_real) || '',
                email_cliente: ordem.cliente_email || ordem.email || (pedido && pedido.cliente_email_real) || '',
                cpf_cnpj: ordem.cliente_cnpj || (pedido && pedido.cliente_documento) || '',
                endereco: ordem.cliente_endereco || (pedido && [pedido.cliente_logradouro, pedido.cliente_localidade].filter(Boolean).join(' - ')) || '',
                cep: ordem.cliente_cep || (pedido && pedido.cliente_cep_real) || '',
                transportadora_nome: ordem.transportadora_nome || (pedido && pedido.transportadora_real) || '',
                transportadora_fone: ordem.transportadora_telefone || ordem.transportadora_fone || (pedido && pedido.transportadora_telefone_real) || '',
                transportadora_cep: ordem.transportadora_cep || (pedido && pedido.transportadora_cep_real) || '',
                transportadora_endereco: ordem.transportadora_endereco || (pedido && [pedido.transportadora_logradouro, pedido.transportadora_localidade].filter(Boolean).join(' - ')) || '',
                transportadora_cpf_cnpj: ordem.transportadora_cnpj || ordem.transportadora_cpf_cnpj || (pedido && pedido.transportadora_documento) || '',
                transportadora_email_nfe: ordem.transportadora_email_nfe || (pedido && pedido.transportadora_email_real) || '',
                produtos,
                forma_pagamento: ordem.forma_pagamento || (pedido && (pedido.condicao_pagamento || pedido.condicoes_pagamento)) || '',
                prazo_pagamento: ordem.condicoes_pagamento || (pedido && (pedido.parcelas || pedido.condicoes_pagamento)) || '',
                observacoes: ordem.observacoes_pedido || ordem.observacoes || (pedido && (pedido.observacao_cliente || pedido.info_complementar)) || '',
                observacoes_entrega: ordem.observacoes_entrega || '',
                observacao_producao: ordem.observacao_producao || ordem.observacoes_producao || (pedido && pedido.observacao_producao) || '',
                observacoes_producao: ordem.observacoes_producao || ordem.observacao_producao || (pedido && pedido.observacao_producao) || '',
                qtd_volumes: Number(ordem.qtd_volumes) || (pedido && Number(pedido.qtd_volumes)) || volumesPorLances || '',
                embalagem_resumo: ordem.tipo_embalagem_entrega || (pedido && pedido.especie_volumes) || embalagensProdutos.join(', '),
                peso_bruto: Number(ordem.peso_bruto) || (pedido && Number(pedido.peso_bruto)) || pesoBrutoItens || '',
                peso_liquido: Number(ordem.peso_liquido) || (pedido && Number(pedido.peso_liquido)) || pesoLiquidoItens || '',
                status_entrega: (ordem.status === 'concluida' || ordem.status === 'armazenado') ? 'COMPLETO' : 'PARCIAL'
            };

            try {
                const empresaConfig = await buscarConfiguracoesEmpresa(pool);
                const dadosEmpPDF = formatarDadosParaPDF(empresaConfig);
                dadosOrdem.empresa = {
                    nome: dadosEmpPDF.nome,
                    razao_social: dadosEmpPDF.nome,
                    endereco: dadosEmpPDF.endereco,
                    bairro: dadosEmpPDF.bairro || '',
                    cep: dadosEmpPDF.cep,
                    cidade: dadosEmpPDF.cidade,
                    estado: dadosEmpPDF.estado,
                    enderecoCompleto: `${dadosEmpPDF.endereco}, ${dadosEmpPDF.numero || ''} - ${dadosEmpPDF.bairro || ''}`.replace(/ - $/, '')
                };
                // O objeto acima é um recorte (sem CNPJ/IE/telefone/e-mail/site). O
                // cabeçalho do template HTML precisa dos campos completos.
                dadosOrdem.empresaPDF = dadosEmpPDF;
            } catch (empErr) {
                console.warn('⚠️ Erro ao buscar config empresa para OP PDF (completo):', empErr.message);
            }

            const htmlOrdem = montarHtmlOrdemProducao(dadosOrdem, dadosOrdem.empresaPDF);
            const pdfBuffer = await htmlParaPdf(htmlOrdem, {
                margens: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
            });

            const nomeArquivo = `Ordem de Produção - ${ordem.codigo || id}.pdf`;
            const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
            const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

            res.setHeader('Content-Disposition', `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);
            res.send(pdfBuffer);
        } catch (error) {
            console.error('❌ Erro ao gerar PDF completo da ordem de produção:', error);
            res.status(500).json({ success: false, message: 'Erro ao gerar PDF da Ordem de Produção', detalhe: error.message });
        }
    });

    // POST /api/gerar-ordem-xml - Exporta apenas o XML da Ordem (para debug/integração)
    router.post('/api/gerar-ordem-xml', authenticateToken, async (req, res) => {
        try {
            const dadosOrdem = req.body;
            if (!dadosOrdem.numero_orcamento && dadosOrdem['num_orçamento']) {
                dadosOrdem.numero_orcamento = dadosOrdem['num_orçamento'];
            }
            if (!dadosOrdem.numero_orcamento && dadosOrdem.num_orcamento) {
                dadosOrdem.numero_orcamento = dadosOrdem.num_orcamento;
            }

            const xmlContent = gerarOrdemXML(dadosOrdem);

            const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
            const nomeArquivo = `Ordem de Produção - ${nomeCliente}.xml`;
            const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
            const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

            res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');

            res.send(xmlContent);
        } catch (error) {
            console.error('❌ Erro ao gerar XML da ordem:', error);
            res.status(500).json({ error: 'Erro ao gerar XML', detalhe: error.message });
        }
    });

    // Função para gerar Excel da Ordem de Produção usando ExcelJS COM TEMPLATE CORRETO
    /**
     * Resolve o template de Ordem de Produção da empresa desta instância.
     * Modelos atualizados em 23/07/2026 (pasta "modules/PCP/Modelo OP - Atualizado").
     */
    // A escolha do modelo mora em utils/op-template.js porque agora o admin pode
    // enviar um .xlsx próprio pelas Configurações do Sistema — o gerador e a tela de
    // configuração têm de concordar sobre qual arquivo está valendo.
    const resolverTemplateOP = require('../utils/op-template').resolverTemplateOP;

    /**
     * Descobre, LENDO O PRÓPRIO TEMPLATE, onde ficam as seções da OP.
     * Necessário porque os modelos de Aluforce e Energy não são iguais: o Energy tem
     * o rodapé deslocado ~1 linha (total, observações, formas de pagamento, COMPLETO/
     * PARCIAL) e mais um bloco de item na aba PRODUÇÃO. Hardcodar linhas quebraria um
     * dos dois — e quebraria de novo a cada revisão do modelo.
     */
    function detectarLayoutOP(abaVendas, abaProducao) {
        const txt = (cell) => {
            const v = cell && cell.value;
            if (v == null) return '';
            if (typeof v === 'object') {
                if (v.richText) return v.richText.map(t => t.text).join('');
                if (v.formula) return '';
                return '';
            }
            return String(v);
        };
        const formula = (cell) => (cell && cell.value && typeof cell.value === 'object' && cell.value.formula) ? cell.value.formula : '';
        const achaLinha = (col, teste, ini, fim) => {
            for (let r = ini; r <= fim; r++) {
                if (teste(txt(abaVendas.getCell(`${col}${r}`)).trim().toUpperCase())) return r;
            }
            return null;
        };

        // Última linha de produto: coluna A numera os itens (1,2,3...) a partir da 18.
        let ultimaLinhaProduto = 32;
        for (let r = 18; r <= 60; r++) {
            const v = abaVendas.getCell(`A${r}`).value;
            if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()))) ultimaLinhaProduto = r;
            else if (r > 18) break;
        }

        // Total do pedido: primeira célula da coluna I cuja fórmula soma a faixa de produtos.
        let totalCell = 'I35';
        for (let r = ultimaLinhaProduto; r <= ultimaLinhaProduto + 8; r++) {
            if (/^SUM\(J18:J\d+\)$/i.test(formula(abaVendas.getCell(`I${r}`)).replace(/\s/g, ''))) { totalCell = `I${r}`; break; }
        }

        // "Observações do Pedido": o conteúdo fica na linha seguinte ao rótulo.
        const lblObsPedido = achaLinha('E', t => t.includes('OBSERVAÇÕES DO PEDIDO'), ultimaLinhaProduto, ultimaLinhaProduto + 10)
            || achaLinha('A', t => t.includes('OBSERVAÇÕES DO PEDIDO'), ultimaLinhaProduto, ultimaLinhaProduto + 10);
        const obsPedidoCell = `A${(lblObsPedido || 36) + 1}`;

        // "FORMAS DE PAGAMENTO": cabeçalho; as 2 formas ficam nas 2 linhas seguintes.
        const lblFormas = achaLinha('A', t => t === 'FORMAS DE PAGAMENTO', ultimaLinhaProduto, ultimaLinhaProduto + 20) || 44;
        const pagLinha1 = lblFormas + 1;
        const pagLinha2 = lblFormas + 2;

        // "QTD - VOLUME:" (mesma linha traz "EMBALAGEM:" na coluna F, valor em H).
        const qtdVolumeRow = achaLinha('A', t => t.includes('QTD - VOLUME'), lblFormas, lblFormas + 10) || 48;

        // "OBSERVAÇÕES:" (para a produção) — conteúdo na linha seguinte.
        const lblObsProd = achaLinha('E', t => t === 'OBSERVAÇÕES:', qtdVolumeRow, qtdVolumeRow + 8) || 50;
        const obsProducaoCell = `E${lblObsProd + 1}`;

        // COMPLETO / PARCIAL (marcação de entrega na coluna C).
        const completoRow = achaLinha('C', t => t === 'COMPLETO', lblObsProd, lblObsProd + 8) || 51;
        const parcialRow = achaLinha('C', t => t === 'PARCIAL', completoRow, completoRow + 8) || 53;

        // Aba PRODUÇÃO: blocos de item de 3 em 3 linhas, ligados a VENDAS_PCP!B{n}.
        const linhasProducao = [];
        if (abaProducao) {
            for (let r = 13; r <= 90; r += 3) {
                if (/VENDAS_PCP!B\d+/i.test(formula(abaProducao.getCell(`B${r}`)))) linhasProducao.push(r);
                else if (linhasProducao.length) break;
            }
        }

        return {
            ultimaLinhaProduto, totalCell, obsPedidoCell, pagLinha1, pagLinha2,
            qtdVolumeRow, obsProducaoCell, completoRow, parcialRow,
            linhasProducao: linhasProducao.length ? linhasProducao : [13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55]
        };
    }

    async function gerarExcelOrdemProducaoCompleta(dados, ExcelJS, templatePath) {
        console.log('📂 Carregando template Excel...');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);

        // 🎯 CORREÇÃO: Usar a aba VENDAS_PCP explicitamente
        const abaVendas = workbook.getWorksheet('VENDAS_PCP') || workbook.worksheets[0];
        const abaProducao = workbook.getWorksheet('PRODUÇÃO') || workbook.getWorksheet('PRODUCAO') || workbook.worksheets[1];

        if (!abaVendas) {
            throw new Error('Aba VENDAS_PCP não encontrada no template!');
        }

        // Layout lido do próprio template (Aluforce e Energy divergem no rodapé)
        const layout = detectarLayoutOP(abaVendas, abaProducao);
        console.log(`📐 Layout detectado: ${JSON.stringify(layout)}`);

        console.log(`✅ Template carregado! Abas encontradas: ${workbook.worksheets.map(w => w.name).join(', ')}`);
        console.log('🔧 Usando template PREENCHIDO - fórmulas serão preservadas!\n');
        console.log('✏️ Preenchendo aba VENDAS_PCP...\n');

        // ========================================
        // ABA VENDAS_PCP - CABEÇALHO (linhas 4-9)
        // ========================================

        console.log('📝 Preenchendo cabeçalho...');

        // 🔧 FIX BUG-OP-01: Normalizar campos com cedilha vindos do frontend
        if (!dados.numero_orcamento && dados['num_orçamento']) {
            dados.numero_orcamento = dados['num_orçamento'];
        }
        if (!dados.numero_orcamento && dados.num_orcamento) {
            dados.numero_orcamento = dados.num_orcamento;
        }
        if (!dados.numero_pedido && dados.num_pedido) {
            dados.numero_pedido = dados.num_pedido;
        }

        // C4 - Número do Orçamento (como número se possível)
        const numOrcamento = dados.numero_orcamento || '';
        // 🔧 FIX BUG-R4-23: isNaN('') → false, parseFloat('') → NaN → célula com NaN
        if (numOrcamento === '') {
            abaVendas.getCell('C4').value = '';
        } else {
            abaVendas.getCell('C4').value = isNaN(numOrcamento) ? numOrcamento : parseFloat(numOrcamento);
        }

        // 🔧 FIX BUG-OP-04: E4 - Revisão (campo existente no modal mas nunca escrito no template)
        abaVendas.getCell('E4').value = dados.revisao || '';

        // G4 - Número da OP: sempre texto puro AAAA/NNNNN, sem "OP Nº".
        const numPedido = dados.numero_pedido || dados.num_pedido || '0';
        const numPedidoBruto = numPedido === '' || numPedido === null || numPedido === undefined ? '0' : numPedido;
        const numPedidoFinal = normalizeOpCode(numPedidoBruto) || String(numPedidoBruto).trim();
        abaVendas.getCell('G4').value = numPedidoFinal;
        abaVendas.getCell('G4').numFmt = '@';

        // J4 - Data de Liberação (como objeto Date)
        if (dados.data_liberacao) {
            // Se já é Date, usa direto
            if (dados.data_liberacao instanceof Date) {
                abaVendas.getCell('J4').value = dados.data_liberacao;
            } else {
                // Tentar converter string para Date (formato dd/mm/yyyy ou yyyy-mm-dd)
                const dataStr = String(dados.data_liberacao);
                let dataObj;

                if (dataStr.includes('/')) {
                    const [d, m, y] = dataStr.split('/');
                    dataObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
                } else if (dataStr.includes('-')) {
                    // 🔧 FIX BUG-R4-21: new Date('yyyy-mm-dd') cria data UTC → off-by-one em BRT
                    const [y2, m2, d2] = dataStr.split('-');
                    dataObj = new Date(parseInt(y2), parseInt(m2) - 1, parseInt(d2));
                } else {
                    dataObj = new Date();
                }

                abaVendas.getCell('J4').value = dataObj;
            }
            abaVendas.getCell('J4').numFmt = 'dd/mm/yyyy';
        } else {
            abaVendas.getCell('J4').value = new Date();
            abaVendas.getCell('J4').numFmt = 'dd/mm/yyyy';
        }

        // 🔧 FIX: Garantir largura mínima da coluna J para exibir data sem *******
        const colJ = abaVendas.getColumn('J');
        if (!colJ.width || colJ.width < 14) {
            colJ.width = 14;
        }

        // Vendedor (linha 6)
        abaVendas.getCell('C6').value = dados.vendedor || '';

        // 🔧 H6 - Calcular prazo de entrega (data liberação + dias) ao invés de usar fórmula
        if (dados.prazo_entrega) {
            // Se veio uma data específica, usar
            if (dados.prazo_entrega instanceof Date) {
                abaVendas.getCell('H6').value = dados.prazo_entrega;
            } else if (typeof dados.prazo_entrega === 'string' && dados.prazo_entrega.includes('/')) {
                // Tentar parsear data no formato dd/mm/yyyy
                const [d, m, y] = dados.prazo_entrega.split('/');
                abaVendas.getCell('H6').value = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            } else if (typeof dados.prazo_entrega === 'string' && dados.prazo_entrega.includes('-')) {
                // 🔧 FIX BUG-R4-22: <input type="date"> envia yyyy-mm-dd → parsear sem UTC
                const [y, m, d] = dados.prazo_entrega.split('-');
                abaVendas.getCell('H6').value = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            } else if (/^\s*\d+\s*(dias?)?\s*$/i.test(String(dados.prazo_entrega))) {
                // O prazo vem do Vendas como PRAZO EM DIAS ("30", "30 Dias"), não como data
                // — é o que o select da OP guarda. Sem este ramo o texto "30 Dias" caía
                // cru na célula e a OP saía sem data de entrega.
                const diasPrazo = parseInt(String(dados.prazo_entrega).match(/\d+/)[0], 10);
                const dataLibPrazo = abaVendas.getCell('J4').value;
                if (dataLibPrazo instanceof Date) {
                    const vencimento = new Date(dataLibPrazo);
                    vencimento.setDate(vencimento.getDate() + diasPrazo);
                    abaVendas.getCell('H6').value = vencimento;
                } else {
                    abaVendas.getCell('H6').value = dados.prazo_entrega;
                }
            } else {
                abaVendas.getCell('H6').value = dados.prazo_entrega;
            }
            abaVendas.getCell('H6').numFmt = 'dd/mm/yyyy';
        } else {
            // Calcular: data liberação + 30 dias
            const dataLib = abaVendas.getCell('J4').value;
            if (dataLib instanceof Date) {
                const prazo = new Date(dataLib);
                prazo.setDate(prazo.getDate() + 30);
                abaVendas.getCell('H6').value = prazo;
                abaVendas.getCell('H6').numFmt = 'dd/mm/yyyy';
            }
        }

        // Cliente (linhas 7-9)
        abaVendas.getCell('C7').value = dados.cliente || '';
        abaVendas.getCell('C8').value = dados.contato || dados.contato_cliente || '';

        // H8 - Telefone FORMATADO (texto): (DD) 9XXXX-XXXX. Antes saía só dígitos (11962397527).
        const telefone = dados.telefone || dados.fone_cliente || '';
        abaVendas.getCell('H8').value = formatarTelefoneBR(telefone);

        abaVendas.getCell('C9').value = dados.email || dados.email_cliente || '';
        abaVendas.getCell('J9').value = dados.frete || dados.tipo_frete || '';

        // ========================================
        // ABA VENDAS_PCP - TRANSPORTADORA (linhas 12-15)
        // ========================================

        // C12 - Nome da Transportadora
        const nomeTransp = dados.transportadora_nome || dados.transportadora?.nome || '';
        abaVendas.getCell('C12').value = nomeTransp;
        console.log(`   Transportadora Nome: ${nomeTransp}`);

        // 🔧 H12 - Telefone da transportadora (manter como string — NÃO parseFloat)
        const telefoneTransp = dados.transportadora_fone || dados.transportadora?.fone || telefone || '';
        if (telefoneTransp) {
            abaVendas.getCell('H12').value = formatarTelefoneBR(telefoneTransp);
            console.log(`   Transportadora Fone: ${telefoneTransp}`);
        } else {
            abaVendas.getCell('H12').value = '';
        }

        // C13 - CEP da Transportadora
        const cepTransp = dados.transportadora_cep || dados.transportadora?.cep || '';
        abaVendas.getCell('C13').value = cepTransp;
        console.log(`   Transportadora CEP: ${cepTransp}`);

        // F13 - Endereço da Transportadora
        const endTransp = dados.transportadora_endereco || dados.transportadora?.endereco || '';
        abaVendas.getCell('F13').value = endTransp;
        console.log(`   Transportadora Endereço: ${endTransp}`);

        // ========================================
        // ABA VENDAS_PCP - DADOS PARA COBRANÇA (linha 14)
        // ========================================

        console.log('💰 Dados para cobrança...');

        // C14 - NÃO PREENCHER (conforme template original)
        // A célula C14 deve ficar vazia/em branco
        const cellC14 = abaVendas.getCell('C14');
        cellC14.value = ''; // Manter vazio conforme template
        console.log(`   C14: Mantido em branco (conforme template)`);

        // G14 - Email NF-e para Cobrança - NÃO PREENCHER D14 (conforme requisito)
        // D14 deve ficar vazio
        abaVendas.getCell('D14').value = '';

        // C15 - CPF/CNPJ do CLIENTE (Dados para Cobrança - conforme template)
        // CORREÇÃO: Usar CNPJ do cliente, não da transportadora
        const cnpjCliente = dados.cpf_cnpj || dados.cliente_cpf_cnpj || '';
        // CRÍTICO: Não usar parseFloat() - causa notação científica (3.64086E+13)
        // Manter como string com formato de texto
        let cnpjStr = String(cnpjCliente).replace(/\D/g, ''); // Remove não-dígitos
        if (!cnpjStr || cnpjStr.length < 11) {
            cnpjStr = ''; // Deixar vazio se não informado
        }
        const cellC15 = abaVendas.getCell('C15');
        if (cnpjStr && cnpjStr.length >= 11) {
            // CPF/CNPJ nunca pode ser convertido para Number: documentos de 14 dígitos
            // são exibidos pelo Excel em notação científica e podem perder precisão.
            const documentoFormatado = cnpjStr.length === 11
                ? cnpjStr.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
                : cnpjStr.slice(0, 14).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
            cellC15.value = documentoFormatado;
            cellC15.numFmt = '@';
        } else {
            cellC15.value = ''; // Deixar vazio quando não informado (evita "TEMP" com formato)
        }

        // 🔧 G15 - Email NF-e da transportadora (calcular ao invés de fórmula)
        const emailNfe = dados.transportadora_email_nfe || dados.transportadora?.email_nfe ||
                         dados.email_nfe || dados.email_cliente;
        if (emailNfe) {
            abaVendas.getCell('G15').value = emailNfe;
        }

        // ========================================
        // ABA VENDAS_PCP - PRODUTOS (linhas 18-32)
        // ========================================
        //
        // MAPEAMENTO CORRETO DO TEMPLATE:
        // ┌─────────┬────────────────────────────────────────────────────────┐
        // │ COLUNA  │ CAMPO                                                  │
        // ├─────────┼────────────────────────────────────────────────────────┤
        // │ A       │ # Item (1, 2, 3...)                                    │
        // │ B       │ Código do Produto (TRN10, DUN16, etc)                  │
        // │ C-E     │ Produto (VLOOKUP automático - NÃO PREENCHER!)          │
        // │ F       │ Embalagem (Bobina, Caixa, etc)                         │
        // │ G       │ Lance(s) (1x1000, 1x500, etc)                          │
        // │ H       │ Quantidade                                             │
        // │ I       │ Valor Unitário R$                                      │
        // │ J       │ Valor Total R$ (calculado)                             │
        // └─────────┴────────────────────────────────────────────────────────┘
        //
        // ⚠️ IMPORTANTE:
        // - Coluna C tem FÓRMULA VLOOKUP que busca descrição pelo código
        // - Colunas C-E estão MESCLADAS no template
        // - NÃO existe coluna de "Variação" no template VENDAS_PCP
        // - Produtos começam na LINHA 18 (não 19!)
        // ========================================

        console.log('📦 Preenchendo produtos...');
        let produtos = dados.produtos || dados.items || dados.itens || [];

        // Converter string JSON se necessário
        if (typeof produtos === 'string') {
            try {
                produtos = JSON.parse(produtos);
            } catch(e) {
                console.error('❌ Erro ao parsear produtos:', e);
                produtos = [];
            }
        }

        // Garantir que é array
        if (!Array.isArray(produtos)) {
            produtos = [];
        }

        // ⚠️ LINHA 17 É CABEÇALHO, PRODUTOS COMEÇAM NA LINHA 18!
        let linhaAtual = 18;
        const LINHA_MAXIMA_PRODUTOS = layout.ultimaLinhaProduto; // detectado do template (32/33)

        // 🔧 Construir catálogo de produtos do template (colunas N:O)
        const catalogoProdutos = {};
        for (let r = 18; r <= 180; r++) {
            const cod = abaVendas.getCell(`N${r}`).value;
            const desc = abaVendas.getCell(`O${r}`).value;
            if (cod && cod !== 'PRODUTO' && desc) {
                catalogoProdutos[String(cod).trim().toUpperCase()] = String(desc).trim();
            }
        }
        console.log(`📚 Catálogo carregado: ${Object.keys(catalogoProdutos).length} produtos`);

        // 🎨 Catálogo de CÓDIGO DE CORES (aba PRODUÇÃO, colunas N=código e P=Cod. Cores).
        // O template já traz um VLOOKUP nessa coluna, mas ele só resolve quando o Excel
        // RECALCULA o arquivo. Em visualizadores que não recalculam (preview do navegador,
        // Google Drive, alguns leitores) a cor saía EM BRANCO. Aqui resolvemos o valor no
        // servidor e gravamos como resultado da fórmula — a cor aparece em qualquer visualizador.
        const catalogoCores = {};
        if (abaProducao) {
            for (let r = 18; r <= 320; r++) {
                const cod = abaProducao.getCell(`N${r}`).value;
                const cor = abaProducao.getCell(`P${r}`).value;
                if (cod && cor && String(cod).trim().toUpperCase() !== 'PRODUTO') {
                    catalogoCores[String(cod).trim().toUpperCase()] = String(cor).trim();
                }
            }
        }
        console.log(`🎨 Catálogo de cores carregado: ${Object.keys(catalogoCores).length} códigos`);

        produtos.forEach((prod, index) => {
            if (prod && linhaAtual <= LINHA_MAXIMA_PRODUTOS) {
                // 🐛 FIX 23/07/2026: o modal de OP envia a chave ACENTUADA (`código`), então
                // `prod.codigo` vinha UNDEFINED e o produto ia para a planilha SEM CÓDIGO —
                // o que quebrava o VLOOKUP da descrição E o do Cod. Cores (cor em branco).
                const codigoProd = String(prod.codigo || prod['código'] || '').trim().toUpperCase();
                // 🔧 FIX BUG-OP-05: Fallback para 'descrição' com cedilha (frontend envia com ç)
                const descricaoCatalogo = catalogoProdutos[codigoProd] || prod.descricao || prod['descrição'] || prod.nome || '';

                console.log(`   📦 Produto ${index + 1} → Linha ${linhaAtual}:`);
                console.log(`      Código: ${codigoProd}`);
                console.log(`      Descrição (catálogo): ${descricaoCatalogo}`);
                console.log(`      Embalagem: ${prod.embalagem}`);
                console.log(`      Lances: ${prod.lances}`);
                console.log(`      Qtd: ${prod.quantidade}`);
                console.log(`      Valor: ${prod.valor_unitario}`);

                // A - Número do item (sequencial)
                abaVendas.getCell(`A${linhaAtual}`).value = index + 1;

                // B - Código do produto (usado pelo VLOOKUP da coluna C)
                abaVendas.getCell(`B${linhaAtual}`).value = codigoProd;

                // C - Descrição do produto: SEMPRE forçar texto direto (evita "VLOOKUP" visível)
                const cellC = abaVendas.getCell(`C${linhaAtual}`);
                cellC.value = descricaoCatalogo || prod.descricao || prod['descrição'] || prod.nome || '';
                // Fonte 8: a descrição ocupa o merge C:E (~38 de largura). No modelo da Aluforce e
                // no genérico (o que Eletric e Cobal usam) ela vinha em 10 e o nome do cabo era
                // cortado — só o da Energy já nascia em 8. Mantém família/negrito do template e
                // muda apenas o tamanho, para as 4 saírem iguais.
                cellC.font = { ...(cellC.font || {}), size: 8 };

                // F - Embalagem (default 'Bobina' conforme dropdown do frontend)
                abaVendas.getCell(`F${linhaAtual}`).value = prod.embalagem || 'Bobina';

                // G - Lance(s)
                abaVendas.getCell(`G${linhaAtual}`).value = prod.lances || '';

                // H - Quantidade
                const quantidade = parseFloat(prod.quantidade) || 0;
                abaVendas.getCell(`H${linhaAtual}`).value = quantidade;

                // I - Valor Unitário
                const valorUnitario = parseFloat(prod.valor_unitario) || parseFloat(prod.preco) || 0;
                abaVendas.getCell(`I${linhaAtual}`).value = valorUnitario;
                abaVendas.getCell(`I${linhaAtual}`).numFmt = 'R$ #,##0.00';

                // J - Valor Total (calculado, não fórmula para garantir valor correto)
                const valorTotal = quantidade * valorUnitario;
                abaVendas.getCell(`J${linhaAtual}`).value = valorTotal;
                abaVendas.getCell(`J${linhaAtual}`).numFmt = 'R$ #,##0.00';

                console.log(`      ✅ Linha ${linhaAtual} preenchida!`);
                linhaAtual++;
            }
        });

        // 🔧 FIX BUG-R5-27: Limpar linhas de produto não utilizadas (stale template data)
        for (let i = linhaAtual; i <= LINHA_MAXIMA_PRODUTOS; i++) {
            for (const col of ['A', 'B', 'C', 'F', 'G', 'H', 'I', 'J']) {
                const cell = abaVendas.getCell(`${col}${i}`);
                // Preservar fórmulas, limpar apenas valores diretos
                if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    cell.value = { formula: cell.value.formula, result: '' };
                } else {
                    cell.value = null;
                }
            }
        }

        // Reforçar formatação de I18-I32 e J18-J32 após o preenchimento dos produtos
        // Linha 17 é cabeçalho, produtos começam na 18
        for (let i = 18; i <= LINHA_MAXIMA_PRODUTOS; i++) {
            // Preço unitário
            abaVendas.getCell(`I${i}`).numFmt = 'R$ #,##0.00';
            const valorUnit = abaVendas.getCell(`I${i}`).value;
            if (typeof valorUnit === 'number') {
                abaVendas.getCell(`I${i}`).value = Number(valorUnit.toFixed(2));
            }

            // Total - calcular sempre, mesmo se estiver vazio
            const qtd = parseFloat(abaVendas.getCell(`H${i}`).value) || 0;
            const preco = parseFloat(abaVendas.getCell(`I${i}`).value) || 0;
            const total = qtd * preco;
            abaVendas.getCell(`J${i}`).value = total;
            abaVendas.getCell(`J${i}`).numFmt = 'R$ #,##0.00';
        }

        // Calcular e preencher TOTAL GERAL (somando todas as linhas de produtos)
        // Produtos nas linhas 18-32
        let totalGeral = 0;
        for (let i = 18; i <= LINHA_MAXIMA_PRODUTOS; i++) {
            const valorLinha = parseFloat(abaVendas.getCell(`J${i}`).value) || 0;
            totalGeral += valorLinha;
        }

        // Preencher célula de total (I35 conforme template)
        // Template mostra: I34="Total do Pedido:$" e I35=fórmula de soma
        abaVendas.getCell(layout.totalCell).value = totalGeral;
        abaVendas.getCell(layout.totalCell).numFmt = 'R$ #,##0.00';
        console.log(`💰 Total Geral calculado: R$ ${totalGeral.toFixed(2)}`);

        console.log(`✅ ${produtos.length} produtos preenchidos!`);

        // ========================================
        // ABA VENDAS_PCP - OBSERVAÇÕES (linhas 36-54)
        // ========================================

        // Observações do Pedido (área mesclada A:J logo abaixo do rótulo)
        // SEMPRE escrever, mesmo vazio: os modelos novos de Aluforce/Energy trazem uma
        // observação de EXEMPLO nessa área ("FRETE FOB F9/50%" / "FRETE FOB - ENTREGA 30
        // DIAS"). Sem limpar, ela sairia em TODAS as ordens de produção.
        // O modal envia `observações` ACENTUADO; sem aceitar essa chave a observação
        // digitada pelo usuário era descartada silenciosamente.
        const obsPedido = dados.observacoes || dados['observações'] || dados.observacoes_pedido || '';
        console.log(`📝 Observações do pedido → ${layout.obsPedidoCell}`);
        abaVendas.getCell(layout.obsPedidoCell).value = obsPedido;

        // ========================================
        // CONDIÇÕES DE PAGAMENTO (linhas 44-46)
        // ========================================

        console.log('💳 Preenchendo condições de pagamento...');

        // Linha 45-46: Formas de pagamento (respeitar merged cells - preencher apenas célula principal)
        // Template: A44:D44=header, A45:D45=forma1, E45=%, F45:H45=método, I45:J45=valor
        //           A46:D46=forma2, E46=%, F46:H46=método, I45:J46=valor
        const formasPag = dados.formas_pagamento || [];

        if (formasPag.length > 0) {
            // Linha 45: Primeira forma de pagamento
            abaVendas.getCell(`A${layout.pagLinha1}`).value = formasPag[0].forma || dados.forma_pagamento || 'A_VISTA';
            const perc1 = parseFloat(formasPag[0].percentual || dados.percentual_pagamento || 100) / 100;
            abaVendas.getCell(`E${layout.pagLinha1}`).value = perc1;
            abaVendas.getCell(`E${layout.pagLinha1}`).numFmt = '0%';
            abaVendas.getCell(`F${layout.pagLinha1}`).value = formasPag[0].metodo || dados.metodo_pagamento || 'BOLETO';
            const valor1 = totalGeral * perc1;
            abaVendas.getCell(`I${layout.pagLinha1}`).value = valor1;
            abaVendas.getCell(`I${layout.pagLinha1}`).numFmt = 'R$ #,##0.00';

            // Linha 46: Segunda forma de pagamento (se houver)
            if (formasPag.length > 1) {
                abaVendas.getCell(`A${layout.pagLinha2}`).value = formasPag[1].forma || 'ENTREGA';
                const perc2 = parseFloat(formasPag[1].percentual || 0) / 100;
                abaVendas.getCell(`E${layout.pagLinha2}`).value = perc2;
                abaVendas.getCell(`E${layout.pagLinha2}`).numFmt = '0%';
                abaVendas.getCell(`F${layout.pagLinha2}`).value = formasPag[1].metodo || '';
                // 🔧 FIX BUG-R5-28: Valor da 2ª forma de pagamento nunca era preenchido
                const valor2 = totalGeral * perc2;
                abaVendas.getCell(`I${layout.pagLinha2}`).value = valor2;
                abaVendas.getCell(`I${layout.pagLinha2}`).numFmt = 'R$ #,##0.00';
            }

            // 🔧 FIX BUG-R5-28b: 3ª forma de pagamento (frontend coleta 3, backend só escrevia 2)
            if (formasPag.length > 2) {
                // Condições extras de pagamento vão para observações (template tem apenas 2 linhas)
                const perc3 = parseFloat(formasPag[2].percentual || 0);
                const valor3 = totalGeral * (perc3 / 100);
                const pag3Texto = `3ª Pag: ${formasPag[2].forma || ''} ${perc3}% ${formasPag[2].metodo || ''} R$ ${valor3.toFixed(2)}`;
                const obsExistente = abaVendas.getCell(layout.obsPedidoCell).value || '';
                abaVendas.getCell(layout.obsPedidoCell).value = obsExistente ? `${obsExistente}\n${pag3Texto}` : pag3Texto;
            }
        } else {
            // Fallback: usar campos legados
            abaVendas.getCell(`A${layout.pagLinha1}`).value = dados.forma_pagamento || 'A_VISTA';
            const perc = parseFloat(dados.percentual_pagamento || 100) / 100;
            abaVendas.getCell(`E${layout.pagLinha1}`).value = perc;
            abaVendas.getCell(`E${layout.pagLinha1}`).numFmt = '0%';
            abaVendas.getCell(`F${layout.pagLinha1}`).value = dados.metodo_pagamento || 'BOLETO';
            abaVendas.getCell(`I${layout.pagLinha1}`).value = totalGeral;
            abaVendas.getCell(`I${layout.pagLinha1}`).numFmt = 'R$ #,##0.00';

            // Se parcelado, calcular segunda linha
            if (perc < 1) {
                abaVendas.getCell(`A${layout.pagLinha2}`).value = 'ENTREGA';
                abaVendas.getCell(`E${layout.pagLinha2}`).value = 1 - perc;
                abaVendas.getCell(`E${layout.pagLinha2}`).numFmt = '0%';
            }
        }

        // ========================================
        // EMBALAGEM E OBSERVAÇÕES FINAIS (linhas 48-54)
        // ========================================

        // Seção OBSERVAÇÕES (para a produção) — célula mesclada logo abaixo do rótulo.
        const obsProducao = dados.observacao_producao || dados.observacoes_producao || dados['observação_producao'] || '';
        const cellObsProd = abaVendas.getCell(layout.obsProducaoCell);
        // O modelo da ENERGY traz uma INSTRUÇÃO FIXA nessa área ("*ATENÇÃO* FAZER EXATAMENTE
        // COMO ESTÁ NO PEDIDO."). Ela é do template, não do pedido: preservar e apenas
        // acrescentar a observação desta OP embaixo.
        const textoFixoProd = (() => {
            const v = cellObsProd.value;
            const t = (v && typeof v === 'object' && v.richText)
                ? v.richText.map(x => x.text).join('')
                : (typeof v === 'string' ? v : '');
            return t.includes('*ATENÇÃO*') ? t.trim() : '';
        })();
        console.log(`📝 Observações para Produção → ${layout.obsProducaoCell}`);
        cellObsProd.value = textoFixoProd
            ? (obsProducao ? `${textoFixoProd}\n${obsProducao}` : textoFixoProd)
            : obsProducao;

        // Status de entrega: COMPLETO ou PARCIAL (linhas detectadas no template)
        const statusEntrega = dados.status_entrega || 'COMPLETO';
        abaVendas.getCell(`C${layout.completoRow}`).value = statusEntrega === 'PARCIAL' ? '' : 'X';
        abaVendas.getCell(`C${layout.parcialRow}`).value = statusEntrega === 'PARCIAL' ? 'X' : '';

        // ========================================
        // ABA VENDAS_PCP - CONDIÇÕES DE PAGAMENTO (linhas 43-46)
        // ========================================

        // A43 é label fixo "CONDIÇOES DE PAGAMENTO." - NÃO sobrescrever
        // Condições extras vão na área de observações (B37) junto com as obs do pedido
        if (dados.condicoes_pagamento) {
            const obsExistente = abaVendas.getCell(layout.obsPedidoCell).value || '';
            const condPag = `Cond. Pagamento: ${dados.condicoes_pagamento}`;
            abaVendas.getCell(layout.obsPedidoCell).value = obsExistente ? `${obsExistente}\n${condPag}` : condPag;
        }

        // ========================================
        // ABA VENDAS_PCP - VOLUMES E EMBALAGEM (linha 48)
        // ========================================

        if (dados.qtd_volumes) {
            abaVendas.getCell(`C${layout.qtdVolumeRow}`).value = dados.qtd_volumes;
        }

        if (dados.tipo_embalagem_entrega) {
            abaVendas.getCell(`H${layout.qtdVolumeRow}`).value = dados.tipo_embalagem_entrega;
        }

        // ========================================
        // ========================================
        // REFORÇO FINAL: Preencher C15 (CNPJ do CLIENTE para cobrança)
        let cnpjClienteFinal = dados.cpf_cnpj || dados.cliente_cpf_cnpj || '';
        let cnpjStrFinal = String(cnpjClienteFinal).replace(/\D/g, '');
        if (cnpjStrFinal && cnpjStrFinal.length >= 11) {
            const cellC15Final = abaVendas.getCell('C15');
            const documentoFormatadoFinal = cnpjStrFinal.length === 11
                ? cnpjStrFinal.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
                : cnpjStrFinal.slice(0, 14).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
            cellC15Final.value = documentoFormatadoFinal;
            cellC15Final.numFmt = '@';
        }
        // ========================================
        // 🔧 ABA PRODUÇÃO: Atualizar fórmulas VLOOKUP com results
        // ========================================
        if (abaProducao) {
            console.log('\n🔧 Atualizando aba PRODUÇÃO...');

            // O ExcelJS não recalcula a fórmula VENDAS_PCP!E51 ao abrir o arquivo
            // em todos os visualizadores. Grave também o resultado no segundo bloco.
            const cellObsProducao = abaProducao.getCell('E61');
            if (cellObsProducao.value && typeof cellObsProducao.value === 'object' && cellObsProducao.value.formula) {
                cellObsProducao.value = { formula: cellObsProducao.value.formula, result: obsProducao };
            } else {
                cellObsProducao.value = obsProducao;
            }

            // ========================================
            // 🔧 FIX BUG-OP-PAGE2: Replicar cabeçalho/dados do cliente na aba PRODUÇÃO
            // A aba PRODUÇÃO tem cabeçalho (linhas 1-12) com fórmulas referenciando VENDAS_PCP.
            // ExcelJS NÃO recalcula fórmulas, então os "result" ficam vazios/stale.
            // Solução: atualizar o result de cada fórmula E/OU preencher diretamente.
            // ========================================
            console.log('📋 Replicando cabeçalho na aba PRODUÇÃO (FIX page 2)...');

            // Percorrer linhas 1-12 da aba PRODUÇÃO e atualizar results de fórmulas
            // 🔧 R2 FIX BUG-14: Regex expandido para suportar 'VENDAS_PCP'!$C$4, espaços, etc.
            const formulaRefRegex = /(?:'?VENDAS_PCP'?)\s*!\s*\$?([A-Z]{1,3})\$?(\d+)/i;
            for (let row = 1; row <= 12; row++) {
                for (const colLetter of ['A','B','C','D','E','F','G','H','I','J','K']) {
                    const cell = abaProducao.getCell(`${colLetter}${row}`);
                    if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                        const formula = cell.value.formula;
                        const match = formula.match(formulaRefRegex);
                        if (match) {
                            const refCol = match[1];
                            const refRow = match[2];
                            const sourceCell = abaVendas.getCell(`${refCol}${refRow}`);
                            const sourceValue = sourceCell.value;
                            // Preservar fórmula e injetar result calculado
                            cell.value = { formula: formula, result: sourceValue || '' };
                            if (sourceValue) {
                                console.log(`   📋 PRODUÇÃO ${colLetter}${row}: fórmula=${formula} → result=${String(sourceValue).substring(0, 30)}`);
                            }
                        }
                    }
                }
            }

            // Fallback direto: garantir que dados-chave estejam preenchidos APENAS se célula vazia
            // 🔧 R2 FIX BUG-15: Não sobrescrever fórmulas — só preencher células realmente vazias
            const headerMapping = [
                { cell: 'C4', value: dados.numero_orcamento || numOrcamento, desc: 'Nº Orçamento' },
                { cell: 'G4', value: numPedidoFinal, desc: 'Nº Pedido' },
                { cell: 'C6', value: dados.vendedor || '', desc: 'Vendedor' },
                { cell: 'C7', value: dados.cliente || '', desc: 'Cliente' },
                { cell: 'C8', value: dados.contato || dados.contato_cliente || '', desc: 'Contato' },
                { cell: 'H8', value: formatarTelefoneBR(dados.telefone || dados.fone_cliente || ''), desc: 'Telefone' },
                { cell: 'C9', value: dados.email || dados.email_cliente || '', desc: 'Email' },
                { cell: 'J9', value: dados.frete || dados.tipo_frete || '', desc: 'Tipo Frete' },
                { cell: 'C12', value: dados.transportadora_nome || '', desc: 'Transportadora' },
                { cell: 'H12', value: formatarTelefoneBR(dados.transportadora_fone || ''), desc: 'Transp. Fone' },
                { cell: 'C13', value: dados.transportadora_cep || '', desc: 'Transp. CEP' },
                { cell: 'F13', value: dados.transportadora_endereco || '', desc: 'Transp. Endereço' },
            ];

            for (const mapping of headerMapping) {
                const cell = abaProducao.getCell(mapping.cell);
                // 🔧 R2: Só preencher se a célula estiver REALMENTE vazia (sem valor algum)
                const val = cell.value;
                const isEmpty = !val || (typeof val === 'string' && val.trim() === '');
                if (isEmpty && mapping.value) {
                    cell.value = mapping.value;
                    console.log(`   📋 PRODUÇÃO ${mapping.cell} (${mapping.desc}): ${String(mapping.value).substring(0, 30)}`);
                }
            }

            // 🔧 R2 FIX BUG-16: Data de liberação na PRODUÇÃO — só se célula vazia
            const cellJ4Prod = abaProducao.getCell('J4');
            const j4Val = cellJ4Prod.value;
            const j4Empty = !j4Val || (typeof j4Val === 'string' && j4Val.trim() === '');
            if (j4Empty) {
                cellJ4Prod.value = abaVendas.getCell('J4').value || new Date();
                cellJ4Prod.numFmt = 'dd/mm/yyyy';
                console.log(`   📋 PRODUÇÃO J4 (Data): ${cellJ4Prod.value}`);
            }

            // 🔧 FIX: Garantir largura mínima da coluna J na PRODUÇÃO
            const colJProd = abaProducao.getColumn('J');
            if (!colJProd.width || colJProd.width < 14) {
                colJProd.width = 14;
            }

            console.log('   ✅ Cabeçalho da aba PRODUÇÃO atualizado!\n');

            // A aba PRODUÇÃO tem suas próprias fórmulas VLOOKUP na coluna C
            // As linhas de produtos são: 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52 (de 3 em 3)
            // Também precisa atualizar a coluna F (Código de Cores)

            // Pegar produtos já preenchidos na VENDAS_PCP
            // Blocos de item da aba PRODUÇÃO, detectados no template (Aluforce tem 15,
            // Energy tem 16 — hardcodar deixaria o 16º item de fora ou escreveria fora do lugar).
            const linhasProducao = layout.linhasProducao;

            // Mapeamento: linha VENDAS_PCP (18,19,20...) -> linha PRODUÇÃO (13,16,19...)
            // VENDAS_PCP linha 18 = primeiro produto -> PRODUÇÃO linha 13
            // VENDAS_PCP linha 19 = segundo produto -> PRODUÇÃO linha 16
            // etc.

            produtos.forEach((prod, index) => {
                if (index < linhasProducao.length && prod) {
                    const linhaProd = linhasProducao[index];
                    // 🐛 FIX 23/07/2026: o modal de OP envia a chave ACENTUADA (`código`), então
                // `prod.codigo` vinha UNDEFINED e o produto ia para a planilha SEM CÓDIGO —
                // o que quebrava o VLOOKUP da descrição E o do Cod. Cores (cor em branco).
                const codigoProd = String(prod.codigo || prod['código'] || '').trim().toUpperCase();
                    // 🔧 FIX BUG-OP-05: Fallback para 'descrição' com cedilha (frontend envia com ç)
                    const descricaoCatalogo = catalogoProdutos[codigoProd] || prod.descricao || prod['descrição'] || prod.nome || '';

                    // B - Código (pode ser uma fórmula referenciando VENDAS_PCP ou valor direto)
                    const cellB = abaProducao.getCell(`B${linhaProd}`);
                    if (cellB.value && typeof cellB.value === 'object' && cellB.value.formula) {
                        // Manter fórmula mas setar o result
                        cellB.value = { formula: cellB.value.formula, result: codigoProd };
                    } else {
                        cellB.value = codigoProd;
                    }

                    // C - Descrição do produto (tem VLOOKUP próprio)
                    const cellC = abaProducao.getCell(`C${linhaProd}`);
                    if (cellC.value && typeof cellC.value === 'object' && cellC.value.formula) {
                        cellC.value = { formula: cellC.value.formula, result: descricaoCatalogo };
                    } else if (descricaoCatalogo) {
                        cellC.value = descricaoCatalogo;
                    }

                    // Também verificar se há fórmula na linha +1 e +2 (layout 3-em-3)
                    for (let offset = 1; offset <= 2; offset++) {
                        const cellCExtra = abaProducao.getCell(`C${linhaProd + offset}`);
                        if (cellCExtra.value && typeof cellCExtra.value === 'object' && cellCExtra.value.formula) {
                            // Algumas linhas intermediárias podem ter fórmulas também
                            cellCExtra.value = { formula: cellCExtra.value.formula, result: '' };
                        }
                    }

                    // 🔧 CORREÇÃO: Preencher QUANTIDADE na coluna J com formato NUMÉRICO (SEM R$)
                    const quantidade = parseFloat(prod.quantidade) || 0;
                    if (quantidade > 0) {
                        const cellQtd = abaProducao.getCell(`J${linhaProd}`);
                        cellQtd.value = quantidade;
                        cellQtd.numFmt = '#,##0.00'; // Formato numérico SEM R$
                        console.log(`   J${linhaProd} (QTD) = ${quantidade} (formato numérico sem R$)`);
                    }

                    // Preencher P.LIQUIDO na coluna E da linha seguinte (linhaProd + 1)
                    const pesoLiquido = parseFloat(prod.peso_liquido) || 0;
                    if (pesoLiquido > 0) {
                        const cellPeso = abaProducao.getCell(`E${linhaProd + 1}`);
                        cellPeso.value = pesoLiquido;
                        cellPeso.numFmt = '#,##0.00';
                    }

                    // 🐛 FIX 23/07/2026 — as colunas estavam DESLOCADAS EM UMA POSIÇÃO.
                    // Layout real da aba PRODUÇÃO (linha 12 do template):
                    //   F:G (MESCLADAS) = "Cod. Cores"   |   H = "Embalagem:"   |   I = "Lance(s)"
                    // O código antigo escrevia cor em F, embalagem em G e lances em H. Como
                    // F:G é mesclada, escrever em G grava no MESTRE (F) e SOBRESCREVIA o código
                    // de cores com a embalagem (por isso a cor "não aparecia"); e a embalagem
                    // caía na coluna H, que é a de Lance(s) — o "embalagem saindo em lance(s)".
                    // Agora: cor→F (nunca G), embalagem→H, lances→I.
                    const escrever = (col, valor) => {
                        const cell = abaProducao.getCell(`${col}${linhaProd}`);
                        if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                            // Mantém a fórmula do template e injeta o resultado (para quem
                            // abrir o arquivo sem recalcular).
                            cell.value = { formula: cell.value.formula, result: valor };
                        } else {
                            cell.value = valor;
                        }
                    };

                    // F - Código de Cores. Prioriza o que veio no pedido; se não veio, resolve
                    // pelo catálogo do próprio template (mesma fonte do VLOOKUP). A fórmula é
                    // mantida — gravamos só o resultado — para o arquivo continuar íntegro.
                    const codigoCores = prod.codigo_cores || prod.cores || catalogoCores[codigoProd] || '';
                    if (codigoCores) escrever('F', codigoCores);

                    // H - Embalagem (default 'Bobina')
                    const embalagemProd = prod.embalagem || 'Bobina';
                    escrever('H', embalagemProd);

                    // I - Lance(s)
                    const lancesProd = prod.lances || '';
                    if (lancesProd) escrever('I', lancesProd);

                    // Preencher LOTE na coluna G da linha seguinte (linhaProd + 1)
                    if (prod.lote) {
                        const cellLote = abaProducao.getCell(`G${linhaProd + 1}`);
                        cellLote.value = prod.lote;
                    }

                    console.log(`   📦 PRODUÇÃO Linha ${linhaProd}: ${codigoProd} = ${descricaoCatalogo.substring(0, 40)}... | CodCores=${codigoCores} | Emb=${embalagemProd} | Lances=${lancesProd}`);
                }
            });

            // 🔧 FIX BUG-R5-29: Limpar linhas de produto não utilizadas na aba PRODUÇÃO
            const prodCount = Math.min(produtos.length, linhasProducao.length);
            for (let idx = prodCount; idx < linhasProducao.length; idx++) {
                const linhaClear = linhasProducao[idx];
                for (const col of ['B', 'C', 'F', 'G', 'H', 'J']) {
                    const cell = abaProducao.getCell(`${col}${linhaClear}`);
                    if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                        cell.value = { formula: cell.value.formula, result: '' };
                    } else {
                        cell.value = null;
                    }
                }
                // Limpar também linhas +1 e +2 (peso, lote)
                for (let offset = 1; offset <= 2; offset++) {
                    for (const col of ['E', 'G']) {
                        const cellExtra = abaProducao.getCell(`${col}${linhaClear + offset}`);
                        if (cellExtra.value && typeof cellExtra.value === 'object' && cellExtra.value.formula) {
                            cellExtra.value = { formula: cellExtra.value.formula, result: '' };
                        } else if (cellExtra.value) {
                            cellExtra.value = null;
                        }
                    }
                }
            }

            console.log(`   ✅ ${Math.min(produtos.length, linhasProducao.length)} produtos atualizados na aba PRODUÇÃO`);
        }

        console.log('\n✅ Excel completo gerado com sucesso!');
        console.log('📊 Estrutura:');
        console.log('   - Cabeçalho: C4, G4, J4, C6, C7-C9');
        console.log('   - Transportadora: C12, C13, F13, C15, H12, G15');
        console.log(`   - Produtos: ${produtos.length} itens (linhas 18-${linhaAtual - 1})`);
        console.log('   - Pagamento: M, N, O, P, Q preenchidos');
        console.log(`   - Total Geral: R$ ${totalGeral.toFixed(2)}`);
        console.log('   ✨ Todos os valores calculados diretamente (sem fórmulas)\n');

        return await workbook.xlsx.writeBuffer();
    }

    // Função fallback para CSV
    async function gerarExcelOrdemProducaoFallback(dados) {
        const csv = [];

        // Header da Ordem de Produção
        csv.push(['ORDEM DE PRODUÇÃO ZYNTRA']);
        csv.push(['']);
        csv.push(['Dados da Ordem:']);
        csv.push(['Número do Orçamento:', dados.numero_orcamento || '']);
        csv.push(['Número do Pedido:', dados.numero_pedido || '']);
        csv.push(['Data de Liberação:', dados.data_liberacao || '']);
        csv.push(['Vendedor:', dados.vendedor || '']);
        csv.push(['Prazo de Entrega:', dados.prazo_entrega || '']);
        csv.push(['']);

        // Dados do Cliente
        csv.push(['Dados do Cliente:']);
        csv.push(['Nome do Cliente:', dados.cliente || '']);
        csv.push(['Contato:', dados.contato_cliente || '']);
        csv.push(['Telefone:', formatarTelefoneBR(dados.fone_cliente || '')]);
        csv.push(['Email:', dados.email_cliente || '']);
        csv.push(['Tipo de Frete:', dados.tipo_frete || '']);
        csv.push(['']);

        // Dados da Transportadora
        csv.push(['Dados da Transportadora:']);
        csv.push(['Nome:', dados.transportadora_nome || '']);
        csv.push(['Telefone:', formatarTelefoneBR(dados.transportadora_fone || '')]);
        csv.push(['CEP:', dados.transportadora_cep || '']);
        csv.push(['Endereço:', dados.transportadora_endereco || '']);
        csv.push(['CPF/CNPJ:', dados.transportadora_cpf_cnpj || '']);
        csv.push(['Email NFe:', dados.transportadora_email_nfe || '']);
        csv.push(['']);

        // Produtos
        csv.push(['PRODUTOS:']);
        csv.push(['Código', 'Descrição', 'Embalagem', 'Lances', 'Quantidade', 'Valor Unitário', 'Total']);

        if (dados.produtos && Array.isArray(dados.produtos)) {
            dados.produtos.forEach(produto => {
                const total = (produto.quantidade || 0) * (produto.valor_unitario || 0);
                csv.push([
                    produto.codigo || '',
                    produto.descricao || '',
                    produto.embalagem || 'Padrão',
                    produto.lances || '',
                    produto.quantidade || 0,
                    `R$ ${(produto.valor_unitario || 0).toFixed(2)}`,
                    `R$ ${total.toFixed(2)}`
                ]);
            });

            // Total geral
            const valorTotal = dados.produtos.reduce((total, produto) => {
                return total + ((produto.quantidade || 0) * (produto.valor_unitario || 0));
            }, 0);

            csv.push(['', '', '', '', '', 'TOTAL GERAL:', `R$ ${valorTotal.toFixed(2)}`]);
        }

        csv.push(['']);

        // Observações
        csv.push(['OBSERVAÇÕES:']);
        csv.push([dados.observacoes_pedido || 'Nenhuma observação especial.']);
        csv.push(['']);

        // Dados de Pagamento e Entrega
        csv.push(['CONDIÇÕES DE PAGAMENTO:']);
        csv.push([dados.condicoes_pagamento || '30 dias após faturamento']);
        csv.push(['']);
        csv.push(['DADOS DE ENTREGA:']);
        csv.push(['Data Prevista:', dados.data_previsao_entrega || '']);
        csv.push(['Quantidade de Volumes:', dados.qtd_volumes || '']);
        csv.push(['Tipo de Embalagem:', dados.tipo_embalagem_entrega || '']);
        csv.push(['Observações de Entrega:', dados.observacoes_entrega || '']);

        // Converter CSV para Buffer
        const csvString = csv.map(row => row.join('\t')).join('\n');
        const buffer = Buffer.from('\ufeff' + csvString, 'utf8'); // BOM para UTF-8

        return buffer;
    }

    // PEDIDOS - AUDITORIA 02/02/2026: Otimizado com campos específicos
    router.get('/pedidos', async (req, res, next) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [rows] = await pool.query(`
                SELECT
                    p.id, p.cliente_id, p.empresa_id, p.vendedor_id,
                    p.valor, p.valor AS valor_total, p.status, p.prioridade,
                    p.prazo_entrega, p.condicao_pagamento, p.cenario_fiscal,
                    p.descricao, p.created_at, p.updated_at, p.version,
                    c.nome as cliente_nome,
                    COALESCE(e.nome_fantasia, e.razao_social) as empresa_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                ORDER BY p.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM pedidos');

            res.json({ pedidos: rows, total, page, limit });
        } catch (error) { next(error); }
    });

    // PEDIDOS DE VENDAS PARA PCP - aprovados em diante, sem restringir pelo vendedor logado
    router.get('/pedidos-vendas', async (req, res, next) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
            const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
            const defaultStatuses = [
                'aprovado',
                'pedido-aprovado',
                'pedido_aprovado',
                'pedido aprovado',
                'faturar',
                'faturado',
                'parcial',
                'faturamento-parcial',
                'faturamento_parcial',
                'faturamento parcial',
                'recibo',
                'entregue',
                'finalizado',
                'em-producao',
                'em produção',
                'em producao',
                'em_producao'
            ];
            const includeAll = ['1', 'true', 'sim', 'all', 'todos'].includes(
                String(req.query.all || req.query.todos || req.query.include_all || '').trim().toLowerCase()
            );
            const requestedStatuses = String(req.query.statuses || '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean);
            const statusList = requestedStatuses.length ? requestedStatuses : (includeAll ? [] : defaultStatuses);

            const pedidoColumns = await getTableColumnsSet('pedidos');
            const clienteColumns = await getTableColumnsSet('clientes').catch(() => new Set());
            const hasPedido = column => pedidoColumns.has(column);
            const hasCliente = column => clienteColumns.has(column);
            const selectOrNull = (column, alias) => hasPedido(column)
                ? `p.\`${column}\` AS \`${alias || column}\``
                : `NULL AS \`${alias || column}\``;
            const firstExistingExpression = (columns, fallback) => {
                const expressions = columns.filter(hasPedido).map(column => `p.\`${column}\``);
                return expressions.length ? `COALESCE(${expressions.join(', ')}, ${fallback})` : fallback;
            };

            const clienteExpressions = [];
            if (hasPedido('cliente_nome')) clienteExpressions.push('p.`cliente_nome`');
            if (hasPedido('cliente')) clienteExpressions.push('p.`cliente`');
            const joins = [];
            if (hasPedido('cliente_id') && clienteColumns.size) {
                joins.push('LEFT JOIN clientes c ON c.id = p.cliente_id');
                if (hasCliente('nome')) clienteExpressions.push('c.`nome`');
                if (hasCliente('razao_social')) clienteExpressions.push('c.`razao_social`');
                if (hasCliente('nome_fantasia')) clienteExpressions.push('c.`nome_fantasia`');
            }

            const clienteSelect = clienteExpressions.length
                ? `COALESCE(${clienteExpressions.join(', ')}, 'Cliente nao informado') AS cliente_nome`
                : `'Cliente nao informado' AS cliente_nome`;
            const numeroPedidoSelect = `${firstExistingExpression(['numero_pedido', 'num_pedido', 'numero'], 'p.id')} AS numero_pedido`;
            const valorSelect = `${firstExistingExpression(['valor', 'valor_total', 'total'], '0')} AS valor_total`;
            const dataSelect = `${firstExistingExpression(['updated_at', 'data_faturamento', 'data_aprovacao', 'data_pedido', 'created_at'], 'NULL')} AS data_referencia`;

            const where = [];
            const params = [];
            if (statusList.length) {
                where.push('LOWER(TRIM(p.`status`)) IN (?)');
                params.push(statusList);
            }
            const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

            const [rows] = await pool.query(`
                SELECT
                    p.id,
                    ${numeroPedidoSelect},
                    ${clienteSelect},
                    ${valorSelect},
                    ${selectOrNull('valor', 'valor')},
                    ${selectOrNull('status', 'status')},
                    ${selectOrNull('vendedor_id', 'vendedor_id')},
                    ${selectOrNull('vendedor_nome', 'vendedor_nome')},
                    ${selectOrNull('created_at', 'created_at')},
                    ${selectOrNull('updated_at', 'updated_at')},
                    ${selectOrNull('data_faturamento', 'data_faturamento')},
                    ${selectOrNull('prazo_entrega', 'prazo_entrega')},
                    ${dataSelect},
                    NULL AS op_id,
                    NULL AS op_codigo
                FROM pedidos p
                ${joins.join('\n')}
                ${whereSql}
                ORDER BY data_referencia DESC, p.id DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            res.json({ success: true, data: rows, total: rows.length, limit, offset });
        } catch (error) { next(error); }
    });

    // PEDIDOS FATURADOS - AUDITORIA 02/02/2026: Otimizado
    router.get('/pedidos/faturados', async (req, res, next) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
            const [rows] = await pool.query(`
                SELECT
                    p.id, p.cliente_id, p.empresa_id, p.vendedor_id,
                    p.valor, p.valor AS valor_total, p.status, p.prioridade,
                    p.prazo_entrega, p.numero_nf AS nfe_numero, p.nfe_chave,
                    p.numero_pedido, p.data_faturamento, p.faturado_em,
                    p.data_entrega_efetiva, p.transportadora_nome,
                    p.created_at, p.updated_at,
                    c.nome as cliente_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.status IN ('faturado', 'recibo')
                ORDER BY p.id DESC LIMIT ?`, [limit]);
            res.json(rows);
        } catch (error) { next(error); }
    });

    // PEDIDOS PRAZOS
    router.get('/pedidos/prazos', async (req, res, next) => {
        try {
            const [rows] = await pool.query("SELECT * FROM pedidos WHERE prazo_entrega IS NOT NULL ORDER BY prazo_entrega ASC LIMIT 10");
            res.json(rows);
        } catch (error) { next(error); }
    });

    // ACOMPANHAMENTO
    router.get('/acompanhamento', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const columns = await getTableColumnsSet('ordens_producao');
            const firstColumn = (names, fallback = 'NULL') => {
                const name = names.find(column => columns.has(column));
                return name ? `\`${name}\`` : fallback;
            };
            const numeroExpr = firstColumn(['numero_ordem', 'codigo', 'id'], 'id');
            const produtoExpr = firstColumn(['produto_nome', 'descricao_produto', 'produto', 'codigo_produto'], "''");
            const clienteExpr = firstColumn(['cliente', 'cliente_nome'], "''");
            const prazoExpr = firstColumn(['prazo_entrega', 'data_previsao_entrega', 'data_prevista']);
            const dataCriacaoExpr = firstColumn(['created_at', 'data_criacao'], 'NULL');
            const dataInicioExpr = firstColumn(['data_inicio'], 'NULL');
            const dataFimExpr = firstColumn(['data_conclusao', 'data_fim'], 'NULL');
            const produtoIdExpr = firstColumn(['produto_id'], 'NULL');
            const prioridadeExpr = firstColumn(['prioridade'], "'normal'");
            const observacoesExpr = firstColumn(['observacoes', 'observacao'], "''");
            const responsavelExpr = firstColumn(['responsavel', 'responsavel_nome'], "''");
            const [rows] = await pool.query(`
                SELECT id,
                       ${numeroExpr} AS numero,
                       ${produtoExpr} AS produto,
                       ${produtoIdExpr} AS produto_id,
                       ${clienteExpr} AS cliente,
                       quantidade, status, ${prioridadeExpr} AS prioridade,
                       ${prazoExpr} AS prazo_entrega,
                       ${dataCriacaoExpr} AS data_criacao,
                       ${dataInicioExpr} AS data_inicio,
                       ${dataFimExpr} AS data_fim,
                       ${observacoesExpr} AS observacoes,
                       ${responsavelExpr} AS responsavel
                FROM ordens_producao
                WHERE LOWER(COALESCE(status, '')) NOT IN ('concluido', 'concluída', 'concluida', 'cancelado', 'cancelada')
                ORDER BY id DESC LIMIT ?
            `, [limit]);
            res.json(rows);
        } catch (error) { next(error); }
    });

    // CLIENTES - Autocomplete
    router.get('/clientes', async (req, res, next) => {
        try {
            const query = req.query.q || '';
            const limit = parseInt(req.query.limit) || 500; // Aumentado para 500 resultados
            const empresaId = req.query.empresa_id || 1; // Default empresa 1

            if (!query) {
                const [rows] = await pool.query(
                    'SELECT id, nome, nome_fantasia, razao_social, cnpj, cnpj_cpf, contato, email, telefone, vendedor_responsavel FROM clientes WHERE empresa_id = ? ORDER BY nome LIMIT ?',
                    [empresaId, limit]
                );
                return res.json(rows);
            }

            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(
                `SELECT id, nome, nome_fantasia, razao_social, cnpj, cnpj_cpf, contato, email, telefone, vendedor_responsavel
                 FROM clientes
                 WHERE empresa_id = ? AND (nome LIKE ? OR nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ? OR cnpj_cpf LIKE ?)
                 ORDER BY nome
                 LIMIT ?`,
                [empresaId, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, limit]
            );
            res.json(rows);
        } catch (error) { next(error); }
    });

    // TRANSPORTADORAS - Autocomplete
    router.get('/transportadoras', async (req, res, next) => {
        try {
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            const query = req.query.q || req.query.termo || '';
            const limit = parseInt(req.query.limit) || 10;

            let sql, params;
            if (!query) {
                sql = 'SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, contato, telefone, email, bairro, cidade, estado, cep FROM transportadoras LIMIT ?';
                params = [limit];
            } else {
                // Buscar apenas por nome (cnpj está criptografado)
                const searchPattern = `%${query}%`;
                sql = 'SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, contato, telefone, email, bairro, cidade, estado, cep FROM transportadoras WHERE razao_social LIKE ? OR nome_fantasia LIKE ? LIMIT ?';
                params = [searchPattern, searchPattern, limit];
            }

            const [rows] = await pool.query(sql, params);
            const resultado = rows.map(r => ({
                id: r.id,
                nome: r.razao_social || r.nome_fantasia || '',
                razao_social: r.razao_social || '',
                nome_fantasia: r.nome_fantasia || '',
                cnpj: _dec(r.cnpj_cpf || ''),
                cnpj_cpf: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || ''),
                contato: r.contato || '',
                telefone: r.telefone || '',
                email: r.email || '',
                endereco: [r.bairro, r.cidade, r.estado].filter(Boolean).join(', '),
                bairro: r.bairro || '',
                cidade: r.cidade || '',
                estado: r.estado || '',
                cep: r.cep || ''
            }));
            res.json(resultado);
        } catch (error) { next(error); }
    });

    // VENDEDORES/FUNCIONÁRIOS - Autocomplete para PCP

    // API para criar ordem de produção completa
    router.post('/ordem-producao-completa', async (req, res, next) => {
        try {
            console.log('📋 Criando ordem de produção completa...');

            const {
                vendedor = 'Vendedor Padrão',
                cliente = 'Cliente Teste',
                contato_cliente = '',
                fone_cliente = '',
                email_cliente = '',
                tipo_frete = 'FOB',
                transportadora_nome = '',
                transportadora_fone = '',
                transportadora_endereco = '',
                transportadora_cpf_cnpj = '',
                transportadora_email_nfe = '',
                produtos = [],
                observacoes_pedido = '',
                condicoes_pagamento = '30 dias',
                prazo_entrega = '15 dias úteis'
            } = req.body;

            // Gerar número sequencial único
            const timestamp = Date.now();
            const novoSequencial = String(timestamp).slice(-5);
            const numeroOrcamento = `ORC-${novoSequencial}`;
            const numeroPedido = `PED-${novoSequencial}`;

            // Calcular total
            let valorTotal = 0;
            produtos.forEach(produto => {
                valorTotal += (produto.quantidade || 0) * (produto.valor_unitario || 0);
            });

            console.log(`💰 Valor total calculado: R$ ${valorTotal.toFixed(2)}`);

            // Preparar dados para o script de geração
            const dadosCompletos = {
                numero_sequencial: novoSequencial,
                numero_orcamento: numeroOrcamento,
                numero_pedido: numeroPedido,
                data_liberacao: new Date().toLocaleDateString('pt-BR'),
                vendedor,
                prazo_entrega,
                cliente,
                contato_cliente,
                fone_cliente,
                email_cliente,
                tipo_frete,
                transportadora_nome,
                transportadora_fone,
                transportadora_endereco,
                transportadora_cpf_cnpj,
                transportadora_email_nfe,
                produtos: produtos.map(p => ({
                    codigo: p.codigo || '',
                    descricao: p.descricao || p.nome || '',
                    embalagem: p.embalagem || 'UN',
                    lances: p.lances || '1',
                    quantidade: p.quantidade || 0,
                    valor_unitario: p.valor_unitario || 0
                })),
                observacoes_pedido,
                condicoes_pagamento,
                data_previsao_entrega: prazo_entrega
            };

            // Gerar Excel usando novo gerador funcional
            const TemplateXlsxGenerator = require('./template-xlsx-generator');

            try {
                console.log('🔧 Usando novo gerador funcional...');

                const gerador = new TemplateXlsxGenerator();
                const filename = `ORDEM_PRODUCAO_${novoSequencial}_${Date.now()}.xlsx`;
                const outputPath = path.join(__dirname, filename);

                // Preparar dados no formato esperado
                const dadosFormatados = {
                    numero_orcamento: dadosCompletos.numero_orcamento,
                    data_orcamento: dadosCompletos.data_liberacao,
                    vendedor: dadosCompletos.vendedor,
                    cliente: dadosCompletos.cliente,
                    cliente_contato: dadosCompletos.contato_cliente,
                    cliente_telefone: dadosCompletos.fone_cliente,
                    cliente_email: dadosCompletos.email_cliente,
                    transportadora: dadosCompletos.transportadora_nome,
                    frete: dadosCompletos.tipo_frete,
                    prazo_entrega: dadosCompletos.prazo_entrega,
                    produtos: produtos.map(p => ({
                        codigo: p.codigo || '',
                        descricao: p.descricao || p.nome || '',
                        quantidade: p.quantidade || 0,
                        unidade: p.embalagem || 'UN',
                        preco_unitario: p.valor_unitario || 0,
                        total: (p.quantidade || 0) * (p.valor_unitario || 0)
                    })),
                    observacoes: dadosCompletos.observacoes_pedido || 'Produto conforme especificação técnica.'
                };

                // Gerar arquivo usando novo gerador
                const resultado = await gerador.aplicarMapeamentoCompleto(dadosFormatados, outputPath);

                if (resultado.sucesso) {
                    console.log(`✅ Ordem de produção gerada com novo gerador: ${filename}`);
                    console.log(`💰 Total: R$ ${resultado.totalGeral.toFixed(2)}`);

                    // Retornar arquivo para download
                    res.download(outputPath, `Ordem_Producao_${numeroOrcamento}.xlsx`, (err) => {
                        if (!err) {
                            // Remover arquivo após download
                            setTimeout(() => {
                                try {
                                    fs.unlinkSync(outputPath);
                                } catch (cleanupError) {
                                    console.warn('Erro ao limpar arquivo:', cleanupError);
                                }
                            }, 5000);
                        }
                    });
                } else {
                    throw new Error('Falha na geração do arquivo com novo gerador');
                }

            } catch (excelError) {
                console.error('❌ Erro ao gerar Excel:', excelError);
                throw new Error(`Erro na geração do arquivo Excel: ${excelError.message}`);
            }

        } catch (error) {
            console.error('❌ Erro ao criar ordem de produção:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao gerar ordem de produção',
                error: 'Erro interno no servidor. Tente novamente.'
            });
        }
    });

    // Função para gerar ordem com ExcelJS (formato válido)
    async function gerarOrdemComExcelJS(workbook, worksheet, dados, outputPath) {
        console.log('\n🎯 GERANDO ORDEM COM EXCELJS...');

        // === CABEÇALHO ===
        worksheet.mergeCells('A1:K1');
        const tituloCell = worksheet.getCell('A1');
        tituloCell.value = 'ORDEM DE PRODUÇÃO ZYNTRA';
        tituloCell.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
        tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
        tituloCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;

        // === DADOS DA ORDEM ===
        worksheet.getCell('A3').value = 'Dados da Ordem:';
        worksheet.getCell('A3').font = { bold: true };

        worksheet.getCell('A4').value = 'Número do Orçamento:';
        worksheet.getCell('B4').value = dados.numero_orcamento || dados.orcamento || '';

        worksheet.getCell('D4').value = 'Número do Pedido:';
        worksheet.getCell('E4').value = dados.numero_pedido || dados.pedido || '';

        worksheet.getCell('A5').value = 'Data de Liberação:';
        worksheet.getCell('B5').value = dados.data_liberacao || new Date().toLocaleDateString('pt-BR');

        worksheet.getCell('D5').value = 'Vendedor:';
        worksheet.getCell('E5').value = dados.vendedor_nome || dados.vendedor || '';

        worksheet.getCell('G5').value = 'Prazo de Entrega:';
        worksheet.getCell('H5').value = dados.prazo_entrega || '';

        // === DADOS DO CLIENTE ===
        worksheet.getCell('A7').value = 'Dados do Cliente:';
        worksheet.getCell('A7').font = { bold: true };

        worksheet.getCell('A8').value = 'Nome do Cliente:';
        worksheet.getCell('B8').value = dados.cliente_nome || dados.cliente || '';

        worksheet.getCell('A9').value = 'Contato:';
        worksheet.getCell('B9').value = dados.cliente_contato || '';

        worksheet.getCell('D9').value = 'Telefone:';
        worksheet.getCell('E9').value = dados.cliente_fone || dados.cliente_telefone || '';

        worksheet.getCell('A10').value = 'Email:';
        worksheet.getCell('B10').value = dados.cliente_email || '';

        worksheet.getCell('D10').value = 'Tipo de Frete:';
        worksheet.getCell('E10').value = dados.frete || '';

        // === DADOS DA TRANSPORTADORA ===
        worksheet.getCell('A12').value = 'Dados da Transportadora:';
        worksheet.getCell('A12').font = { bold: true };

        const transportadoraFields = [
            { label: 'Nome:', cell: 'B13', value: dados.transportadora_nome || '' },
            { label: 'Telefone:', cell: 'B14', value: formatarTelefoneBR(dados.transportadora_fone || dados.transportadora_telefone || '') },
            { label: 'CEP:', cell: 'B15', value: dados.transportadora_cep || '' },
            { label: 'Endereço:', cell: 'B16', value: dados.transportadora_endereco || '' },
            { label: 'CPF/CNPJ:', cell: 'B17', value: dados.transportadora_cpf_cnpj || '' },
            { label: 'Email NFe:', cell: 'B18', value: dados.transportadora_email_nfe || dados.email_nfe || '' }
        ];

        transportadoraFields.forEach((field, index) => {
            worksheet.getCell(`A${13 + index}`).value = field.label;
            worksheet.getCell(field.cell).value = field.value;
        });

        // === PRODUTOS ===
        let currentRow = 20;
        worksheet.getCell(`A${currentRow}`).value = 'PRODUTOS:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };

        currentRow++;
        const headerRow = worksheet.getRow(currentRow);
        headerRow.values = ['Código', 'Descrição', 'Embalagem', 'Lances', 'Quantidade', 'Valor Unitário', 'Total'];
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

        let produtos = dados.produtos || dados.itens || [];
        if (typeof produtos === 'string') {
            try { produtos = JSON.parse(produtos); } catch(e) { produtos = []; }
        }

        let totalGeral = 0;
        let produtosProcessados = 0;

        currentRow++;
        produtos.forEach((produto, index) => {
            const row = worksheet.getRow(currentRow + index);
            const quantidade = parseFloat(produto.quantidade) || 0;
            const valorUnitario = parseFloat(produto.valor_unitario || produto.preco_unitario || produto.preco || 0);
            const total = quantidade * valorUnitario;

            row.values = [
                produto.codigo || '',
                produto.descricao || produto.nome || '',
                produto.embalagem || '',
                produto.lances || '',
                quantidade,
                valorUnitario.toFixed(2),
                total.toFixed(2)
            ];

            totalGeral += total;
            produtosProcessados++;
        });

        currentRow += produtos.length + 1;

        // === TOTAL ===
        worksheet.getCell(`F${currentRow}`).value = 'TOTAL GERAL:';
        worksheet.getCell(`F${currentRow}`).font = { bold: true };
        worksheet.getCell(`G${currentRow}`).value = `R$ ${totalGeral.toFixed(2)}`;
        worksheet.getCell(`G${currentRow}`).font = { bold: true };

        // === OBSERVAÇÕES ===
        currentRow += 2;
        worksheet.getCell(`A${currentRow}`).value = 'OBSERVAÇÕES:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };
        worksheet.getCell(`A${currentRow + 1}`).value = dados.observacoes || 'Nenhuma observação especial.';

        // === CONDIÇÕES DE PAGAMENTO ===
        currentRow += 3;
        worksheet.getCell(`A${currentRow}`).value = 'CONDIÇÕES DE PAGAMENTO:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };
        worksheet.getCell(`A${currentRow + 1}`).value = dados.condicoes_pagamento || '30 dias após faturamento';

        // === DADOS DE ENTREGA ===
        currentRow += 3;
        worksheet.getCell(`A${currentRow}`).value = 'DADOS DE ENTREGA:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };

        worksheet.getCell(`A${currentRow + 1}`).value = 'Data Prevista:';
        worksheet.getCell(`B${currentRow + 1}`).value = dados.data_entrega || '';

        worksheet.getCell(`A${currentRow + 2}`).value = 'Quantidade de Volumes:';
        worksheet.getCell(`B${currentRow + 2}`).value = dados.quantidade_volumes || '';

        worksheet.getCell(`A${currentRow + 3}`).value = 'Tipo de Embalagem:';
        worksheet.getCell(`B${currentRow + 3}`).value = dados.tipo_embalagem || '';

        worksheet.getCell(`A${currentRow + 4}`).value = 'Observações de Entrega:';
        worksheet.getCell(`B${currentRow + 4}`).value = dados.observacoes_entrega || '';

        // Ajustar largura das colunas
        worksheet.columns = [
            { width: 15 }, { width: 40 }, { width: 15 }, { width: 10 },
            { width: 12 }, { width: 15 }, { width: 15 }, { width: 15 },
            { width: 15 }, { width: 15 }, { width: 15 }
        ];

        // Salvar arquivo
        await workbook.xlsx.writeFile(outputPath);
        console.log(`✅ Arquivo salvo: ${outputPath}`);

        return {
            sucesso: true,
            totalGeral,
            produtosProcessados,
            arquivo: outputPath
        };
    }

    // Nova rota otimizada para gerar ordem de produção com gerador funcional
    router.post('/gerar-ordem', async (req, res, next) => {
        try {
            console.log('🏭 Gerando ordem via rota otimizada com ExcelJS...');

            const ExcelJS = require('exceljs');

            // Preparar dados recebidos
            const dadosOrdem = req.body;
            console.log('📋 Dados recebidos:', Object.keys(dadosOrdem));

            // Gerar número de ordem único
            const numeroOrdem = `OP${Date.now()}`;

            // Gerar nome único para arquivo
            const timestamp = Date.now();
            const filename = `ordem_producao_${timestamp}.xlsx`;
            const outputPath = path.join(__dirname, filename);

            // Criar workbook com ExcelJS
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Ordem de Produção');

            // Gerar ordem usando ExcelJS
            const resultado = await gerarOrdemComExcelJS(workbook, worksheet, dadosOrdem, outputPath);

            if (resultado.sucesso) {
                console.log(`✅ Ordem gerada: ${filename}`);
                console.log(`💰 Total: R$ ${resultado.totalGeral.toFixed(2)}`);
                console.log(`📦 Produtos: ${resultado.produtosProcessados}`);

                // Salvar ordem no banco de dados
                try {
                    const [insertResult] = await pool.query(`
                        INSERT INTO ordens_producao (
                            numero_ordem, numero_orcamento, numero_pedido, data_liberacao,
                            vendedor_nome, cliente_nome, cliente_fone, cliente_email, cliente_contato,
                            transportadora_nome, transportadora_fone, transportadora_cep,
                            transportadora_endereco, transportadora_cpf_cnpj, transportadora_email_nfe,
                            frete, prazo_entrega, percentual_parcelado, metodo_parcelado,
                            produtos, total_geral, quantidade_produtos,
                            observacoes, observacoes_pedido,
                            arquivo_xlsx, caminho_arquivo,
                            status, criado_por
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        numeroOrdem,
                        dadosOrdem.numero_orcamento || dadosOrdem.orcamento || null,
                        dadosOrdem.numero_pedido || dadosOrdem.pedido || null,
                        dadosOrdem.data_liberacao || new Date(),
                        dadosOrdem.vendedor_nome || dadosOrdem.vendedor || null,
                        dadosOrdem.cliente_nome || dadosOrdem.cliente || null,
                        dadosOrdem.cliente_fone || null,
                        dadosOrdem.cliente_email || null,
                        dadosOrdem.cliente_contato || null,
                        dadosOrdem.transportadora_nome || null,
                        dadosOrdem.transportadora_fone || dadosOrdem.transportadora_telefone || null,
                        dadosOrdem.transportadora_cep || null,
                        dadosOrdem.transportadora_endereco || null,
                        dadosOrdem.transportadora_cpf_cnpj || null,
                        dadosOrdem.transportadora_email_nfe || dadosOrdem.email_nfe || null,
                        dadosOrdem.frete || null,
                        dadosOrdem.prazo_entrega || null,
                        dadosOrdem.percentual_parcelado || 100.00,
                        dadosOrdem.metodo_parcelado || 'FATURAMENTO',
                        JSON.stringify(dadosOrdem.produtos || []),
                        resultado.totalGeral,
                        resultado.produtosProcessados,
                        dadosOrdem.observacoes || null,
                        dadosOrdem.observacoes_pedido || null,
                        filename,
                        outputPath,
                        'pendente',
                        req.user ? req.user.id : null
                    ]);

                    console.log(`✅ Ordem salva no banco: ID ${insertResult.insertId}`);

                    res.json({
                        sucesso: true,
                        ordemId: insertResult.insertId,
                        numeroOrdem: numeroOrdem,
                        arquivo: filename,
                        totalGeral: resultado.totalGeral,
                        produtosProcessados: resultado.produtosProcessados,
                        mensagem: 'Ordem de produção gerada e registrada com sucesso!'
                    });
                } catch (dbError) {
                    console.error('❌ Erro ao salvar ordem no banco:', dbError);
                    // Mesmo com erro no banco, retorna sucesso do arquivo gerado
                    res.json({
                        sucesso: true,
                        arquivo: filename,
                        totalGeral: resultado.totalGeral,
                        produtosProcessados: resultado.produtosProcessados,
                        mensagem: 'Ordem de produção gerada com sucesso! (Erro ao registrar no banco)',
                        avisoDb: 'Falha ao salvar no banco de dados'
                    });
                }
            } else {
                throw new Error('Falha na geração da ordem');
            }

        } catch (error) {
            console.error('❌ Erro na nova rota:', error);
            res.status(500).json({
                sucesso: false,
                erro: 'Erro interno ao processar ordem',
                mensagem: 'Erro ao gerar ordem de produção'
            });
        }
    });

    // LISTAR ORDENS DE PRODUÇÁO - Para página Controle de Produção
    router.get('/ordens', async (req, res, next) => {
        try {
            const { status, data_inicio, data_fim, cliente, limit = 50, offset = 0 } = req.query;

            let query = `
                SELECT
                    id, numero_ordem, numero_orcamento, numero_pedido,
                    data_liberacao, data_emissao,
                    vendedor_nome, cliente_nome,
                    total_geral, quantidade_produtos,
                    status, arquivo_xlsx,
                    criado_em, atualizado_em
                FROM ordens_producao
                WHERE 1=1
            `;
            const params = [];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }

            if (data_inicio) {
                query += ` AND data_emissao >= ?`;
                params.push(data_inicio);
            }

            if (data_fim) {
                query += ` AND data_emissao <= ?`;
                params.push(data_fim);
            }

            if (cliente) {
                query += ` AND cliente_nome LIKE ?`;
                params.push(`%${cliente}%`);
            }

            query += ` ORDER BY data_emissao DESC LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));

            const [ordens] = await pool.query(query, params);

            // Contar total de ordens (para paginação)
            const [countResult] = await pool.query(`
                SELECT COUNT(*) as total FROM ordens_producao WHERE 1=1
                ${status ? 'AND status = ?' : ''}
            `, status ? [status] : []);

            res.json({
                ordens,
                total: countResult[0].total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('❌ Erro ao listar ordens:', error);
            next(error);
        }
    });

    // OBTER ÚLTIMO NÚMERO DE PEDIDO PCP (Auto-increment)
    router.get('/ultimo-pedido', async (req, res, next) => {
        try {
            const [result] = await pool.query(`
                SELECT numero_pedido
                FROM ordens_producao
                WHERE numero_pedido IS NOT NULL
                AND numero_pedido REGEXP '^[0-9]+$'
                ORDER BY CAST(numero_pedido AS UNSIGNED) DESC
                LIMIT 1
            `);

            let ultimo_numero = '0002025000'; // Valor padrão inicial

            if (result.length > 0 && result[0].numero_pedido) {
                ultimo_numero = result[0].numero_pedido;
            }

            console.log(`✅ Último pedido PCP: ${ultimo_numero}`);
            res.json({ ultimo_numero });
        } catch (error) {
            console.error('❌ Erro ao buscar último pedido PCP:', error);
            // Retorna valor padrão em caso de erro
            res.json({ ultimo_numero: '0002025000' });
        }
    });

    // OBTER DETALHES DE UMA ORDEM ESPECÍFICA
    router.get('/ordens/:id', async (req, res, next) => {
        try {
            const { id } = req.params;

            const [ordens] = await pool.query(`
                SELECT * FROM ordens_producao WHERE id = ?
            `, [id]);

            if (ordens.length === 0) {
                return res.status(404).json({ erro: 'Ordem não encontrada' });
            }

            const ordem = ordens[0];

            // Parse produtos JSON
            if (ordem.produtos) {
                try {
                    ordem.produtos = JSON.parse(ordem.produtos);
                } catch (e) {
                    console.error('Erro ao parsear produtos:', e);
                    ordem.produtos = [];
                }
            }

            res.json(ordem);
        } catch (error) {
            console.error('❌ Erro ao buscar ordem:', error);
            next(error);
        }
    });

    // ATUALIZAR STATUS DE ORDEM
    router.patch('/ordens/:id/status', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            const statusValidos = ['pendente', 'em_producao', 'concluida', 'cancelada'];
            if (!statusValidos.includes(status)) {
                return res.status(400).json({ erro: 'Status inválido' });
            }

            await pool.query(`
                UPDATE ordens_producao
                SET status = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [status, id]);

            res.json({ sucesso: true, mensagem: 'Status atualizado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao atualizar status:', error);
            next(error);
        }
    });

    // VENDEDORES/FUNCIONÁRIOS - Autocomplete para PCP
    router.get('/vendedores', async (req, res, next) => {
        try {
            const query = req.query.q || '';
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);

            if (!query) {
                const [rows] = await pool.query(`
                    SELECT id, nome_completo as nome, cargo, departamento
                    FROM funcionarios
                    WHERE status = 'ativo' AND (cargo LIKE '%vendedor%' OR cargo LIKE '%comercial%' OR cargo LIKE '%representante%' OR departamento LIKE '%vendas%' OR departamento LIKE '%comercial%')
                    ORDER BY nome_completo
                    LIMIT ?
                `, [limit]);
                return res.json(rows);
            }

            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(`
                SELECT id, nome_completo as nome, cargo, departamento
                FROM funcionarios
                WHERE status = 'ativo'
                AND (cargo LIKE '%vendedor%' OR cargo LIKE '%comercial%' OR cargo LIKE '%representante%' OR departamento LIKE '%vendas%' OR departamento LIKE '%comercial%')
                AND (nome_completo LIKE ? OR cargo LIKE ?)
                ORDER BY nome_completo
                LIMIT ?
            `, [searchPattern, searchPattern, limit]);
            res.json(rows);
        } catch (error) { next(error); }
    });

    // ===================== INTEGRAÇÃO COMPRAS <-> PCP =====================

    // LISTAR MATERIAIS CRÍTICOS (estoque abaixo do mínimo)
    router.get('/materiais-criticos', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const [materiais] = await pool.query(`
                SELECT * FROM vw_materiais_criticos LIMIT ?
            `, [limit]);
            res.json(materiais);
        } catch (error) {
            console.error('❌ Erro ao buscar materiais críticos:', error);
            next(error);
        }
    });

    // CRIAR PEDIDO DE COMPRA A PARTIR DO PCP
    // AUDIT-FIX HIGH-012: Wrapped PCP purchase order creation in transaction
    router.post('/gerar-pedido-compra', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const {
                ordem_producao_id,
                fornecedor_id,
                materiais, // Array de {produto_id, quantidade, preco_unitario}
                prioridade = 'media',
                data_entrega_prevista,
                observacoes
            } = req.body;

            // Validações
            if (!fornecedor_id || !materiais || materiais.length === 0) {
                connection.release();
                return res.status(400).json({
                    erro: 'fornecedor_id e materiais são obrigatórios'
                });
            }

            await connection.beginTransaction();

            // Calcular valor total
            const valorTotal = materiais.reduce((total, item) => {
                return total + (item.quantidade * item.preco_unitario);
            }, 0);

            // Criar pedido de compra
            const [result] = await connection.query(`
                INSERT INTO pedidos_compras (
                    fornecedor_id, valor_total, origem, origem_id,
                    prioridade, data_entrega_prevista, observacoes, usuario_id
                ) VALUES (?, ?, 'pcp', ?, ?, ?, ?, ?)
            `, [
                fornecedor_id,
                valorTotal,
                ordem_producao_id,
                prioridade,
                data_entrega_prevista,
                observacoes,
                req.user ? req.user.id : null
            ]);

            const pedidoId = result.insertId;

            // Inserir itens do pedido
            for (const material of materiais) {
                await connection.query(`
                    INSERT INTO itens_pedido_compras (
                        pedido_id, produto_id, produto_descricao,
                        quantidade, preco_unitario, subtotal
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    pedidoId,
                    material.produto_id,
                    material.descricao,
                    material.quantidade,
                    material.preco_unitario,
                    material.quantidade * material.preco_unitario
                ]);

                // Criar/atualizar notificação de estoque
                await connection.query(`
                    UPDATE notificacoes_estoque
                    SET status = 'em_compra', pedido_compra_id = ?
                    WHERE produto_id = ? AND status = 'pendente'
                `, [pedidoId, material.produto_id]);
            }

            // Atualizar ordem de produção (se informada)
            if (ordem_producao_id) {
                await connection.query(`
                    UPDATE ordens_producao
                    SET pedidos_compra_vinculados = JSON_ARRAY_APPEND(
                        COALESCE(pedidos_compra_vinculados, '[]'),
                        '$',
                        ?
                    )
                    WHERE id = ?
                `, [pedidoId, ordem_producao_id]);
            }

            await connection.commit();

            res.json({
                sucesso: true,
                pedido_id: pedidoId,
                valor_total: valorTotal,
                mensagem: 'Pedido de compra criado com sucesso'
            });

        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao gerar pedido de compra:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // LISTAR NOTIFICAÇÕES DE ESTOQUE
    router.get('/notificacoes-estoque', async (req, res, next) => {
        try {
            const { status = 'pendente', tipo } = req.query;

            let query = `
                SELECT
                    n.*,
                    p.codigo, p.descricao, p.unidade,
                    op.numero_ordem,
                    pc.id as pedido_compra_numero
                FROM notificacoes_estoque n
                INNER JOIN produtos p ON n.produto_id = p.id
                LEFT JOIN ordens_producao op ON n.ordem_producao_id = op.id
                LEFT JOIN pedidos_compras pc ON n.pedido_compra_id = pc.id
                WHERE 1=1
            `;
            const params = [];

            if (status) {
                query += ` AND n.status = ?`;
                params.push(status);
            }

            if (tipo) {
                query += ` AND n.tipo = ?`;
                params.push(tipo);
            }

            query += ` ORDER BY
                CASE n.tipo
                    WHEN 'estoque_zero' THEN 1
                    WHEN 'estoque_critico' THEN 2
                    WHEN 'estoque_baixo' THEN 3
                END,
                n.criado_em DESC
            `;

            const [notificacoes] = await pool.query(query, params);
            res.json(notificacoes);

        } catch (error) {
            console.error('❌ Erro ao buscar notificações:', error);
            next(error);
        }
    });

    // RESOLVER/IGNORAR NOTIFICAÇÃO DE ESTOQUE
    router.patch('/notificacoes-estoque/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status, observacoes } = req.body;

            if (!['resolvido', 'ignorado'].includes(status)) {
                return res.status(400).json({ erro: 'Status inválido' });
            }

            await pool.query(`
                UPDATE notificacoes_estoque
                SET status = ?,
                    resolvido_em = CURRENT_TIMESTAMP,
                    resolvido_por = ?,
                    observacoes = ?
                WHERE id = ?
            `, [status, req.user ? req.user.id : null, observacoes, id]);

            res.json({ sucesso: true, mensagem: 'Notificação atualizada' });

        } catch (error) {
            console.error('❌ Erro ao atualizar notificação:', error);
            next(error);
        }
    });

    // VERIFICAR MATERIAIS NECESSÁRIOS PARA UMA ORDEM
    router.get('/ordens/:id/materiais-necessarios', async (req, res, next) => {
        try {
            const { id } = req.params;

            // Buscar ordem
            const [ordens] = await pool.query(`
                SELECT produtos FROM ordens_producao WHERE id = ?
            `, [id]);

            if (ordens.length === 0) {
                return res.status(404).json({ erro: 'Ordem não encontrada' });
            }

            let produtosOrdem = [];
            try {
                produtosOrdem = JSON.parse(ordens[0].produtos || '[]');
            } catch (e) {
                console.error('Erro ao parsear produtos:', e);
            }

            // Batch: carregar todos os produtos dos códigos necessários
            const codigosProdutos = produtosOrdem.map(p => p.codigo).filter(Boolean);
            let produtosMap = {};

            if (codigosProdutos.length > 0) {
                try {
                    const [allProdutos] = await pool.query(`
                        SELECT id, codigo, descricao, estoque_atual, estoque_minimo, unidade_medida as unidade
                        FROM produtos
                        WHERE codigo IN (?)
                    `, [codigosProdutos]);
                    for (const p of allProdutos) produtosMap[p.codigo] = p;
                } catch(e) {}
            }

            const materiaisNecessarios = [];
            for (const produto of produtosOrdem) {
                const p = produtosMap[produto.codigo];
                if (p) {
                    const quantidadeNecessaria = parseFloat(produto.quantidade || 0);
                    const deficit = quantidadeNecessaria - p.estoque_atual;
                    if (deficit > 0) {
                        materiaisNecessarios.push({
                            produto_id: p.id,
                            codigo: p.codigo,
                            descricao: p.descricao,
                            unidade: p.unidade,
                            quantidade_necessaria: quantidadeNecessaria,
                            estoque_atual: p.estoque_atual,
                            deficit: deficit,
                            criticidade: p.estoque_atual === 0 ? 'critico' : 'atencao'
                        });
                    }
                }
            }

            res.json({
                ordem_id: id,
                materiais_necessarios: materiaisNecessarios,
                total_itens_faltando: materiaisNecessarios.length
            });

        } catch (error) {
            console.error('❌ Erro ao verificar materiais:', error);
            next(error);
        }
    });

    // ESTOQUE - Produtos disponíveis (para módulo Vendas e outros)
    // IMPORTANTE: Retorna APENAS produtos que têm movimentação registrada no PCP
    router.get('/estoque/produtos-disponiveis', async (req, res, next) => {
        try {
            const { search, categoria, status } = req.query;

            // Buscar APENAS produtos que têm movimentação de estoque registrada OU estoque > 0
            let sql = `
                SELECT
                    p.id,
                    p.codigo,
                    p.nome,
                    p.descricao,
                    p.sku,
                    p.gtin,
                    COALESCE(p.quantidade_estoque, 0) as estoque_atual,
                    COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                    COALESCE(p.preco_venda, p.preco_custo, 0) as preco,
                    p.unidade_medida,
                    p.categoria,
                    (SELECT MAX(me.data_movimentacao) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as ultima_movimentacao,
                    (SELECT COUNT(*) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as total_movimentacoes
                FROM produtos p
                WHERE p.ativo = 1
                  AND (
                      p.quantidade_estoque > 0
                      OR EXISTS (SELECT 1 FROM movimentacoes_estoque me WHERE me.produto_id = p.id)
                  )
            `;

            const params = [];

            // Filtro de busca
            if (search) {
                sql += ` AND (p.codigo LIKE ? OR p.nome LIKE ? OR p.sku LIKE ? OR p.gtin LIKE ?)`;
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            // Filtro de categoria
            if (categoria) {
                sql += ` AND p.categoria = ?`;
                params.push(categoria);
            }

            // Filtro de status de estoque
            if (status === 'disponivel') {
                sql += ` AND p.quantidade_estoque > 0`;
            } else if (status === 'baixo') {
                sql += ` AND p.quantidade_estoque > 0 AND p.quantidade_estoque <= p.estoque_minimo`;
            }

            sql += ` ORDER BY p.nome ASC LIMIT 500`;

            const [produtos] = await pool.query(sql, params);

            // Estatísticas
            const stats = {
                total: produtos.length,
                comEstoque: produtos.filter(p => p.estoque_atual > 0).length,
                estoqueBaixo: produtos.filter(p => p.estoque_atual > 0 && p.estoque_atual <= p.estoque_minimo).length,
                semEstoque: produtos.filter(p => p.estoque_atual <= 0).length
            };

            res.json({
                success: true,
                produtos: produtos,
                stats: stats,
                total: produtos.length
            });

        } catch (error) {
            console.error('❌ Erro ao buscar produtos disponíveis:', error);
            next(error);
        }
    });

    // ===================== GESTÃO DE PRODUÇÃO - APIs =====================

    // Criar tabela de máquinas se não existir
    const criarTabelaMaquinasPrincipal = async () => {
        // Tables managed by startup migration
        console.log('[GESTAO] Tabelas maquinas_producao e historico_manutencoes gerenciadas pela migração de inicialização');
    };

    // Criar tabela de gestão de produção se não existir
    const criarTabelaGestaoProducaoPrincipal = async () => {
        // Table managed by startup migration
        console.log('[GESTAO] Tabela gestao_producao gerenciada pela migração de inicialização');
    };

    // Inicializar tabelas de gestão de produção
    setTimeout(async () => {
        await criarTabelaMaquinasPrincipal();
        await criarTabelaGestaoProducaoPrincipal();
    }, 3000);

    // Listar máquinas
    router.get('/maquinas', async (req, res, next) => {
        try {
            const [maquinas] = await pool.query(`
                SELECT id, codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes
                FROM maquinas_producao ORDER BY nome LIMIT 200
            `);
            res.json(maquinas);
        } catch (error) {
            console.error('[API_MAQUINAS] Erro:', error.message);
            next(error);
        }
    });

    // O modal de cadastro da máquina coleta tipo/descrição/responsável/custo da
    // última manutenção, mas isso nunca virava um registro em
    // historico_manutencoes — ficava só na tela. A OS de manutenção (abaixo) é
    // gerada a partir dessa tabela, então sem isto ela nunca teria dado real
    // pra mostrar. A checagem por (maquina_id, data, descrição) evita duplicar
    // a mesma manutenção a cada "Salvar" do formulário.
    async function registrarManutencaoDoFormulario(maquinaId, dados) {
        const { ultima_manutencao, tipo_manutencao, descricao_manutencao, responsavel_manutencao, custo_manutencao } = dados;
        if (!descricao_manutencao || !ultima_manutencao) return;
        const [existentes] = await pool.query(
            'SELECT id FROM historico_manutencoes WHERE maquina_id = ? AND data_manutencao = ? AND descricao = ? LIMIT 1',
            [maquinaId, ultima_manutencao, descricao_manutencao]
        );
        if (existentes.length) return;
        await pool.query(`
            INSERT INTO historico_manutencoes (maquina_id, data_manutencao, tipo, descricao, custo, responsavel, status)
            VALUES (?, ?, ?, ?, ?, ?, 'concluida')
        `, [maquinaId, ultima_manutencao, tipo_manutencao || 'preventiva', descricao_manutencao, custo_manutencao || 0, responsavel_manutencao || '']);
    }

    // Criar nova máquina
    router.post('/maquinas', async (req, res, next) => {
        try {
            const { codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes } = req.body;

            // Gerar código se não fornecido
            const codigoFinal = codigo || `MAQ-${Date.now().toString().slice(-6)}`;

            const [result] = await pool.query(`
                INSERT INTO maquinas_producao (codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [codigoFinal, nome, setor || 'Geral', status || 'ativa', ultima_manutencao, proxima_manutencao, observacoes]);

            await registrarManutencaoDoFormulario(result.insertId, req.body);

            res.status(201).json({
                message: 'Máquina criada com sucesso',
                id: result.insertId,
                codigo: codigoFinal
            });
        } catch (error) {
            console.error('[API_MAQUINAS] Erro ao criar:', error.message);
            next(error);
        }
    });

    // Atualizar máquina
    router.put('/maquinas/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes } = req.body;

            await pool.query(`
                UPDATE maquinas_producao SET nome = ?, setor = ?, status = ?, ultima_manutencao = ?, proxima_manutencao = ?, observacoes = ?
                WHERE id = ?
            `, [nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes, id]);

            await registrarManutencaoDoFormulario(id, req.body);

            res.json({ message: 'Máquina atualizada com sucesso' });
        } catch (error) {
            console.error('[API_MAQUINAS] Erro ao atualizar:', error.message);
            next(error);
        }
    });

    // Excluir máquina
    router.delete('/maquinas/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM maquinas_producao WHERE id = ?', [id]);
            res.json({ message: 'Máquina excluída com sucesso' });
        } catch (error) {
            console.error('[API_MAQUINAS] Erro ao excluir:', error.message);
            next(error);
        }
    });

    // ===================== HISTÓRICO DE MANUTENÇÕES =====================

    // Listar histórico de manutenções de uma máquina
    router.get('/maquinas/:id/manutencoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [manutencoes] = await pool.query(`
                SELECT * FROM historico_manutencoes
                WHERE maquina_id = ?
                ORDER BY data_manutencao DESC
                LIMIT 50
            `, [id]);
            res.json(manutencoes);
        } catch (error) {
            console.error('[API_MANUTENCOES] Erro:', error.message);
            next(error);
        }
    });

    // Adicionar manutenção ao histórico
    router.post('/maquinas/:id/manutencoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { data_manutencao, tipo, descricao, pecas_trocadas, custo, responsavel, tempo_parada_horas, status } = req.body;

            const [result] = await pool.query(`
                INSERT INTO historico_manutencoes (maquina_id, data_manutencao, tipo, descricao, pecas_trocadas, custo, responsavel, tempo_parada_horas, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, data_manutencao, tipo || 'preventiva', descricao, pecas_trocadas, custo || 0, responsavel, tempo_parada_horas || 0, status || 'concluida']);

            // Atualizar data de última manutenção na máquina
            await pool.query(`
                UPDATE maquinas_producao SET ultima_manutencao = ? WHERE id = ?
            `, [data_manutencao, id]);

            res.status(201).json({
                message: 'Manutenção registrada com sucesso',
                id: result.insertId
            });
        } catch (error) {
            console.error('[API_MANUTENCOES] Erro ao criar:', error.message);
            next(error);
        }
    });

    // Excluir manutenção
    router.delete('/manutencoes/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM historico_manutencoes WHERE id = ?', [id]);
            res.json({ message: 'Manutenção excluída com sucesso' });
        } catch (error) {
            console.error('[API_MANUTENCOES] Erro ao excluir:', error.message);
            next(error);
        }
    });

    // ===================== OS DE MANUTENÇÃO → PDF =====================
    // Ordem de Serviço de manutenção de máquina, no mesmo template HTML +
    // Puppeteer usado pelos relatórios do PCP e pelo Pedido de Compra
    // (html-relatorio-renderer + services/pdf-render.service).
    function corpoOsManutencao(maquina, manutencao) {
        const { escapeHtml, statusBadgeClass } = require('../src/services/html-relatorio-renderer');
        const texto = (v) => escapeHtml(v == null || v === '' ? '—' : v);
        const dataBr = (v) => {
            if (!v) return '—';
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? texto(v) : d.toLocaleDateString('pt-BR');
        };
        const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const tipoLabel = { preventiva: 'Preventiva', corretiva: 'Corretiva', preditiva: 'Preditiva' };
        const statusLabel = { concluida: 'Concluída', pendente: 'Pendente', em_andamento: 'Em andamento', cancelada: 'Cancelada' };
        const statusRaw = String(manutencao.status || '').toLowerCase();
        const badge = statusBadgeClass(statusRaw === 'concluida' ? 'finalizado' : statusRaw === 'cancelada' ? 'cancelado' : 'orcamento');

        let h = '<section class="grid-2 avoid-break"><div><h2 class="section-title">Dados da máquina</h2><div class="doc-box"><dl class="kv-grid cols-1">';
        h += `<div class="kv"><dt class="k">Código</dt><dd class="v">${texto(maquina.codigo)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Nome</dt><dd class="v">${texto(maquina.nome)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Setor</dt><dd class="v">${texto(maquina.setor)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Tipo</dt><dd class="v">${texto(maquina.tipo)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Fabricante / Modelo</dt><dd class="v">${texto([maquina.fabricante, maquina.modelo].filter(Boolean).join(' / ') || null)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Nº patrimônio</dt><dd class="v">${texto(maquina.num_patrimonio)}</dd></div>`;
        h += '</dl></div></div><div><h2 class="section-title">Dados da manutenção</h2><div class="doc-box"><dl class="kv-grid cols-1">';
        const tipoRaw = String(manutencao.tipo || '').toLowerCase();
        h += `<div class="kv"><dt class="k">Tipo</dt><dd class="v">${texto(tipoLabel[tipoRaw] || manutencao.tipo)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Data</dt><dd class="v">${dataBr(manutencao.data_manutencao)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Responsável</dt><dd class="v">${texto(manutencao.responsavel)}</dd></div>`;
        h += `<div class="kv"><dt class="k">Tempo de parada</dt><dd class="v">${manutencao.tempo_parada_horas ? `${Number(manutencao.tempo_parada_horas).toLocaleString('pt-BR')} h` : '—'}</dd></div>`;
        h += `<div class="kv"><dt class="k">Status</dt><dd class="v"><span class="status-badge ${badge}">${texto(statusLabel[statusRaw] || manutencao.status)}</span></dd></div>`;
        h += `<div class="kv"><dt class="k">Próxima manutenção prevista</dt><dd class="v">${dataBr(maquina.proxima_manutencao)}</dd></div>`;
        h += '</dl></div></div></section>';

        h += `<section class="avoid-break"><h2 class="section-title">Descrição do serviço</h2><div class="note-box"><p>${texto(manutencao.descricao).replace(/\n/g, '<br>')}</p></div></section>`;
        if (manutencao.pecas_trocadas) {
            h += `<section class="avoid-break"><h2 class="section-title">Peças trocadas</h2><div class="note-box"><p>${texto(manutencao.pecas_trocadas).replace(/\n/g, '<br>')}</p></div></section>`;
        }
        h += `<section class="totals avoid-break"><div class="box"><div class="row grand"><span>Custo da manutenção</span><strong>${moeda(manutencao.custo)}</strong></div></div></section>`;
        h += '<section class="signature-block avoid-break"><div class="signature"><div class="line"></div><p class="name">Técnico responsável</p><p class="role">Execução do serviço</p></div><div class="signature"><div class="line"></div><p class="name">Supervisão / PCP</p><p class="role">Aprovação</p></div></section>';
        return h;
    }

    async function gerarHtmlOsManutencao(maquina, manutencao) {
        const fs = require('fs');
        const path = require('path');
        const { buildEmpresaTemplateData, renderTemplateString, resolveRelatorioTemplate } = require('../src/services/html-relatorio-renderer');
        let cfg = {};
        try {
            const [rows] = await pool.query('SELECT * FROM empresa_config ORDER BY id LIMIT 1');
            cfg = (rows && rows[0]) || {};
        } catch (_) { /* segue com o cabeçalho padrão */ }
        const dados = {
            nome: cfg.razao_social || cfg.nome_fantasia || 'Empresa',
            nomeFantasia: cfg.nome_fantasia || cfg.razao_social || 'Empresa',
            cnpj: cfg.cnpj || '', inscricaoEstadual: cfg.inscricao_estadual || 'Isento',
            endereco: cfg.endereco || '', numero: cfg.numero || '', bairro: cfg.bairro || '',
            cidade: cfg.cidade || '', estado: cfg.estado || '', cep: cfg.cep || '',
            telefone: cfg.telefone || '', email: cfg.email || '', site: cfg.site || ''
        };
        const projectRoot = path.join(__dirname, '..');
        const empresa = buildEmpresaTemplateData(cfg, dados, projectRoot);
        let tpl = fs.readFileSync(resolveRelatorioTemplate(projectRoot, '_template.html'), 'utf8');
        const numero = manutencao.id ? `OS Nº ${manutencao.id}` : `OS — ${maquina.codigo || maquina.id}`;
        tpl = tpl.replace(/__TITULO__/g, 'Ordem de Serviço')
                 .replace(/__SUBTITULO__/g, 'Manutenção de máquina')
                 .replace(/__REFERENCIA__/g, numero)
                 .replace(/__FIELDS__/g, '')
                 .replace(/__BODY__/g, corpoOsManutencao(maquina, manutencao));
        return renderTemplateString(tpl, empresa);
    }

    // GET /maquinas/:id/os-pdf?manutencao_id= - Gera a Ordem de Serviço (PDF)
    // de uma manutenção. Sem manutencao_id, usa a mais recente já registrada
    // pra essa máquina; sem nenhuma no histórico ainda, monta a OS com os
    // campos de manutenção do próprio cadastro da máquina, pra o botão
    // funcionar mesmo pra quem ainda não tem nada em historico_manutencoes.
    router.get('/maquinas/:id/os-pdf', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [maquinas] = await pool.query('SELECT * FROM maquinas_producao WHERE id = ?', [id]);
            if (!maquinas.length) return res.status(404).json({ error: 'Máquina não encontrada' });
            const maquina = maquinas[0];

            let manutencao = null;
            if (req.query.manutencao_id) {
                const [rows] = await pool.query(
                    'SELECT * FROM historico_manutencoes WHERE id = ? AND maquina_id = ?',
                    [req.query.manutencao_id, id]
                );
                manutencao = rows[0] || null;
            }
            if (!manutencao) {
                const [rows] = await pool.query(
                    'SELECT * FROM historico_manutencoes WHERE maquina_id = ? ORDER BY data_manutencao DESC, id DESC LIMIT 1',
                    [id]
                );
                manutencao = rows[0] || null;
            }
            if (!manutencao) {
                manutencao = {
                    data_manutencao: maquina.ultima_manutencao,
                    tipo: 'preventiva',
                    descricao: maquina.observacoes || '',
                    pecas_trocadas: '',
                    custo: 0,
                    responsavel: '',
                    tempo_parada_horas: 0,
                    status: 'pendente'
                };
            }

            const html = await gerarHtmlOsManutencao(maquina, manutencao);
            const pdf = await htmlParaPdf(html);

            const nomeMaquina = String(maquina.nome || maquina.codigo || 'Maquina')
                .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Maquina';
            const nomeUtf8 = `Ordem de Serviço - ${nomeMaquina} - ERP.pdf`;
            const nomeAscii = nomeUtf8.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(nomeUtf8)}`);
            res.setHeader('Content-Length', pdf.length);
            return res.end(pdf);
        } catch (error) {
            console.error('[PCP/OS-MANUTENCAO] Erro ao gerar PDF:', error);
            return res.status(error.status || 500).json({ error: 'Erro ao gerar PDF da Ordem de Serviço' });
        }
    });

    // =====================================================
    // GESTÃO DE PRODUÇÃO - API INTEGRADA COM OPs
    // =====================================================

    // Listar registros de gestão de produção (integrado com ordens_producao)
    router.get('/gestao-producao', async (req, res, next) => {
        try {
            const { periodo, maquina, busca, fonte } = req.query;

            // Se fonte = 'ordens', busca diretamente das ordens de produção
            let registros = [];
            let periodoSQL = '';

            // Construir filtro de período
            if (periodo && periodo !== 'todos') {
                switch(periodo) {
                    case 'hoje':
                        periodoSQL = ' AND DATE(op.created_at) = CURDATE()';
                        break;
                    case 'semana':
                        periodoSQL = ' AND op.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
                        break;
                    case 'mes':
                        periodoSQL = ' AND MONTH(op.created_at) = MONTH(CURDATE()) AND YEAR(op.created_at) = YEAR(CURDATE())';
                        break;
                    case 'ano':
                        periodoSQL = ' AND YEAR(op.created_at) = YEAR(CURDATE())';
                        break;
                }
            }

            // Buscar ordens de produção
            let queryOP = `
                SELECT
                    op.id,
                    op.codigo as numero_pedido,
                    op.produto_nome,
                    op.quantidade as quantidade_planejada,
                    op.quantidade_produzida,
                    op.unidade,
                    op.status,
                    op.prioridade,
                    op.data_inicio,
                    op.data_prevista,
                    op.data_conclusao,
                    op.responsavel as cliente_nome,
                    op.progresso,
                    op.observacoes,
                    op.created_at,
                    op.updated_at,
                    CASE
                        WHEN op.data_inicio IS NOT NULL AND op.data_conclusao IS NOT NULL
                        THEN TIMESTAMPDIFF(MINUTE, op.data_inicio, op.data_conclusao)
                        WHEN op.data_inicio IS NOT NULL AND op.status = 'em_producao'
                        THEN TIMESTAMPDIFF(MINUTE, op.data_inicio, NOW())
                        ELSE 0
                    END as tempo_producao_minutos,
                    CASE
                        WHEN op.quantidade > 0 AND op.quantidade_produzida > 0
                        THEN ROUND((op.quantidade_produzida / op.quantidade) * 100, 1)
                        WHEN op.progresso > 0 THEN op.progresso
                        ELSE 0
                    END as eficiencia
                FROM ordens_producao op
                WHERE 1=1 ${periodoSQL}
            `;

            const params = [];

            // Filtro por busca
            if (busca) {
                queryOP += ' AND (op.codigo LIKE ? OR op.produto_nome LIKE ? OR op.responsavel LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
            }

            queryOP += ' ORDER BY op.created_at DESC LIMIT 100';

            const [ordensProducao] = await pool.query(queryOP, params);

            // Formatar dados
            registros = ordensProducao.map(op => ({
                id: op.id,
                numero_pedido: op.numero_pedido || `OP-${op.id}`,
                cliente_nome: op.cliente_nome || 'N/A',
                produto_nome: op.produto_nome,
                tempo_producao_minutos: op.tempo_producao_minutos || 0,
                tempo_formatado: formatarTempo(op.tempo_producao_minutos || 0),
                materiais_gastos: [],
                maquinas_utilizadas: [],
                quantidade_produzida: parseFloat(op.quantidade_produzida) || 0,
                quantidade_planejada: parseFloat(op.quantidade_planejada) || 0,
                unidade: op.unidade,
                status: op.status,
                prioridade: op.prioridade,
                eficiencia: op.eficiencia || 0,
                progresso: op.progresso || 0,
                data_inicio: op.data_inicio,
                data_prevista: op.data_prevista,
                data_conclusao: op.data_conclusao,
                created_at: op.created_at,
                fonte: 'ordens_producao'
            }));

            // Calcular estatísticas baseadas nas OPs
            const [statsOP] = await pool.query(`
                SELECT
                    COUNT(*) as total_ordens,
                    SUM(CASE
                        WHEN data_inicio IS NOT NULL AND data_conclusao IS NOT NULL
                        THEN TIMESTAMPDIFF(MINUTE, data_inicio, data_conclusao)
                        WHEN data_inicio IS NOT NULL AND status = 'em_producao'
                        THEN TIMESTAMPDIFF(MINUTE, data_inicio, NOW())
                        ELSE 0
                    END) as tempo_total_minutos,
                    COUNT(CASE WHEN status = 'em_producao' THEN 1 END) as em_producao,
                    COUNT(CASE WHEN status = 'concluida' THEN 1 END) as concluidas,
                    COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
                    SUM(quantidade) as qtd_total_planejada,
                    SUM(quantidade_produzida) as qtd_total_produzida,
                    AVG(CASE WHEN quantidade > 0 AND quantidade_produzida > 0
                        THEN (quantidade_produzida / quantidade) * 100
                        WHEN progresso > 0 THEN progresso
                        ELSE NULL END) as eficiencia_media
                FROM ordens_producao
                WHERE status != 'cancelada'
                  AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())
            `);

            const [maquinasAtivas] = await pool.query(`
                SELECT COUNT(*) as total FROM maquinas_producao WHERE status = 'ativa'
            `);

            // Contar materiais únicos usados (estimativa baseada em produtos)
            const [materiaisCount] = await pool.query(`
                SELECT COUNT(DISTINCT produto_nome) as total
                FROM ordens_producao
                WHERE status IN ('em_producao', 'concluida')
                  AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())
            `);

            const tempoTotal = statsOP[0]?.tempo_total_minutos || 0;

            res.json({
                registros,
                estatisticas: {
                    total_ordens: statsOP[0]?.total_ordens || 0,
                    tempo_total_minutos: tempoTotal,
                    tempo_total_formatado: formatarTempo(tempoTotal),
                    materiais_utilizados: materiaisCount[0]?.total || 0,
                    maquinas_ativas: maquinasAtivas[0]?.total || 0,
                    eficiencia_media: Math.round(statsOP[0]?.eficiencia_media || 0),
                    em_producao: statsOP[0]?.em_producao || 0,
                    concluidas: statsOP[0]?.concluidas || 0,
                    pendentes: statsOP[0]?.pendentes || 0,
                    qtd_total_planejada: parseFloat(statsOP[0]?.qtd_total_planejada) || 0,
                    qtd_total_produzida: parseFloat(statsOP[0]?.qtd_total_produzida) || 0
                }
            });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro:', error.message);
            next(error);
        }
    });

    // Função auxiliar para formatar tempo
    function formatarTempo(minutos) {
        if (!minutos || minutos <= 0) return '0h';
        const horas = Math.floor(minutos / 60);
        const mins = minutos % 60;
        if (horas === 0) return `${mins}min`;
        if (mins === 0) return `${horas}h`;
        return `${horas}h ${mins}min`;
    }

    // Dashboard de estatísticas detalhadas
    router.get('/gestao-producao/dashboard', async (req, res, next) => {
        try {
            // Estatísticas gerais
            const [statsGerais] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'ativa' THEN 1 END) as ativas,
                    COUNT(CASE WHEN status = 'em_producao' THEN 1 END) as em_producao,
                    COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
                    COUNT(CASE WHEN status = 'concluida' THEN 1 END) as concluidas,
                    COUNT(CASE WHEN status = 'cancelada' THEN 1 END) as canceladas
                FROM ordens_producao
            `);

            // Produção por setor/máquina
            const [maquinas] = await pool.query(`
                SELECT
                    m.id, m.codigo, m.nome, m.setor, m.status,
                    m.ultima_manutencao, m.proxima_manutencao
                FROM maquinas_producao m
                ORDER BY m.setor, m.nome
            `);

            // Produção por dia (últimos 7 dias)
            const [producaoDiaria] = await pool.query(`
                SELECT
                    DATE(created_at) as data,
                    COUNT(*) as ordens,
                    SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas
                FROM ordens_producao
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                GROUP BY dia
                ORDER BY data
            `);

            // Ordens por prioridade
            const [porPrioridade] = await pool.query(`
                SELECT
                    prioridade,
                    COUNT(*) as total
                FROM ordens_producao
                WHERE status NOT IN ('concluida', 'cancelada')
                GROUP BY prioridade
            `);

            res.json({
                estatisticas: statsGerais[0],
                maquinas,
                producaoDiaria,
                porPrioridade
            });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO_DASHBOARD] Erro:', error.message);
            next(error);
        }
    });

    // Criar registro de gestão de produção
    router.post('/gestao-producao', async (req, res, next) => {
        try {
            const {
                pedido_id, numero_pedido, cliente_nome, produto_nome,
                tempo_producao_minutos, materiais_gastos, maquinas_utilizadas,
                quantidade_produzida, quantidade_planejada, status,
                data_inicio, data_fim, observacoes
            } = req.body;

            // Calcular eficiência
            let eficiencia = 0;
            if (quantidade_planejada && quantidade_produzida) {
                eficiencia = Math.round((quantidade_produzida / quantidade_planejada) * 100);
            }

            const [result] = await pool.query(`
                INSERT INTO gestao_producao
                (pedido_id, numero_pedido, cliente_nome, produto_nome, tempo_producao_minutos,
                 materiais_gastos, maquinas_utilizadas, quantidade_produzida, quantidade_planejada,
                 status, data_inicio, data_fim, eficiencia, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                pedido_id, numero_pedido, cliente_nome, produto_nome, tempo_producao_minutos || 0,
                JSON.stringify(materiais_gastos || []), JSON.stringify(maquinas_utilizadas || []),
                quantidade_produzida || 0, quantidade_planejada || 0,
                status || 'planejado', data_inicio, data_fim, eficiencia, observacoes
            ]);

            res.status(201).json({
                message: 'Registro de produção criado',
                id: result.insertId
            });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro ao criar:', error.message);
            next(error);
        }
    });

    // Atualizar registro de gestão de produção
    router.put('/gestao-producao/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const {
                tempo_producao_minutos, materiais_gastos, maquinas_utilizadas,
                quantidade_produzida, quantidade_planejada, status,
                data_inicio, data_fim, observacoes
            } = req.body;

            // Calcular eficiência
            let eficiencia = 0;
            if (quantidade_planejada && quantidade_produzida) {
                eficiencia = Math.round((quantidade_produzida / quantidade_planejada) * 100);
            }

            await pool.query(`
                UPDATE gestao_producao SET
                    tempo_producao_minutos = ?, materiais_gastos = ?, maquinas_utilizadas = ?,
                    quantidade_produzida = ?, quantidade_planejada = ?, status = ?,
                    data_inicio = ?, data_fim = ?, eficiencia = ?, observacoes = ?
                WHERE id = ?
            `, [
                tempo_producao_minutos, JSON.stringify(materiais_gastos || []),
                JSON.stringify(maquinas_utilizadas || []),
                quantidade_produzida, quantidade_planejada, status,
                data_inicio, data_fim, eficiencia, observacoes, id
            ]);

            res.json({ message: 'Registro atualizado' });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro ao atualizar:', error.message);
            next(error);
        }
    });

    // Buscar detalhes de um registro
    router.get('/gestao-producao/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [registros] = await pool.query('SELECT * FROM gestao_producao WHERE id = ?', [id]);

            if (registros.length === 0) {
                return res.status(404).json({ message: 'Registro não encontrado' });
            }

            res.json(registros[0]);
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro:', error.message);
            next(error);
        }
    });

    // =================== CONTROLE PCP (ORDENS PRODUÇÃO) ===================

    // Função reutilizável para listar ordens de controle PCP
    async function listarOrdensPCP(req, res) {
        console.log('[API_CONTROLE_PCP] Listando ordens para controle...');
        try {
            const { busca, vendedor, extrusora, status } = req.query;

            let whereParts = [];
            let params = [];

            // Filtro de busca
            if (busca && busca.trim()) {
                const like = `%${busca.trim()}%`;
                whereParts.push('(op.codigo LIKE ? OR op.produto_nome LIKE ? OR op.cliente LIKE ?)');
                params.push(like, like, like);
            }

            // Filtro de vendedor/responsável
            if (vendedor && vendedor.trim()) {
                whereParts.push('op.responsavel = ?');
                params.push(vendedor.trim());
            }

            // Filtro de extrusora/máquina
            if (extrusora && extrusora.trim()) {
                whereParts.push('op.maquina = ?');
                params.push(extrusora.trim());
            }

            // Filtro de status
            if (status && status.trim()) {
                whereParts.push('op.status = ?');
                params.push(status.trim());
            }

            const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

            const sql = `
                SELECT
                    op.id, op.codigo, op.produto_nome, op.quantidade, op.unidade,
                    op.status, op.prioridade, op.data_inicio, op.data_prevista,
                    op.responsavel, op.maquina, op.progresso, op.cliente,
                    op.created_at, op.updated_at
                FROM ordens_producao op
                ${whereClause}
                ORDER BY
                    CASE op.status
                        WHEN 'em_producao' THEN 1
                        WHEN 'pendente' THEN 2
                        WHEN 'concluida' THEN 3
                        ELSE 4
                    END,
                    op.prioridade DESC,
                    op.data_prevista ASC
                LIMIT 100
            `;

            const [ordens] = await pool.query(sql, params);

            console.log(`[API_CONTROLE_PCP] Retornando ${ordens.length} ordens`);
            res.json({
                success: true,
                data: ordens || [],
                total: ordens.length
            });
        } catch (error) {
            console.error('[API_CONTROLE_PCP] Erro:', error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao listar ordens de produção',
                error: 'Erro interno no servidor. Tente novamente.'
            });
        }
    }

    // Rota principal: /controle-pcp
    router.get('/controle-pcp', listarOrdensPCP);

    // Alias para compatibilidade: /controle-producao (usa mesma função)
    router.get('/controle-producao', listarOrdensPCP);

    // Atualizar status de uma ordem no controle PCP
    router.put('/controle-pcp/:id/status', async (req, res) => {
        const { id } = req.params;
        const { status, observacao } = req.body;
        console.log(`[API_CONTROLE_PCP] Atualizando status da ordem ${id} para ${status}...`);

        try {
            if (!status) {
                return res.status(400).json({ success: false, message: 'Status é obrigatório' });
            }

            let updateSql = 'UPDATE ordens_producao SET status = ?, updated_at = NOW()';
            let params = [status];

            if (observacao) {
                updateSql += ', observacoes = ?';
                params.push(observacao);
            }

            // Atualizar data de conclusão se status for concluída
            if (status === 'concluida' || status === 'Concluída') {
                updateSql += ', data_conclusao = NOW(), progresso = 100';
            }

            updateSql += ' WHERE id = ?';
            params.push(id);

            const [result] = await pool.query(updateSql, params);

            if (result.affectedRows > 0) {
                console.log(`[API_CONTROLE_PCP] Status da ordem ${id} atualizado para ${status}`);
                res.json({ success: true, message: 'Status atualizado com sucesso' });
            } else {
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            console.error('[API_CONTROLE_PCP] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar status', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Buscar materiais de uma ordem no controle PCP
    router.get('/controle-pcp/:id/materiais', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_CONTROLE_PCP] Buscando materiais da ordem ${id}...`);

        try {
            // Tentar buscar materiais vinculados à ordem
            let materiais = [];
            try {
                const [rows] = await pool.query(`
                    SELECT
                        m.id, m.codigo_material, m.descricao, m.unidade_medida,
                        om.quantidade_necessaria, om.quantidade_utilizada
                    FROM ordem_materiais om
                    INNER JOIN materiais m ON om.material_id = m.id
                    WHERE om.ordem_producao_id = ?
                `, [id]);
                materiais = rows || [];
            } catch (e) {
                console.log('[API_CONTROLE_PCP] Tabela ordem_materiais não existe, retornando vazio');
            }

            res.json({ success: true, data: materiais, total: materiais.length });
        } catch (error) {
            console.error('[API_CONTROLE_PCP] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar materiais', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Buscar itens de uma ordem de produção
    // AUDIT-FIX: essa rota não existia (só GET) — "Incluir Item" em ordens-producao.html
    // (salvarItemEstrutura()) sempre dava 404 e o item só era adicionado visualmente na
    // tabela, nunca persistido em itens_ordem_producao. Sem itens persistidos, a baixa
    // automática de matéria-prima na conclusão da OP (registrarBaixaEstoqueOP) nunca
    // tinha o que processar.
    router.post('/ordens-producao/:id/itens', async (req, res) => {
        const { id } = req.params;
        try {
            const [[ordem]] = await pool.query('SELECT id FROM ordens_producao WHERE id = ?', [id]);
            if (!ordem) return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });

            const body = req.body || {};
            const codigo = String(body.codigo_material || '').trim();
            if (!codigo) return res.status(400).json({ success: false, message: 'Informe o código do material' });

            const qtd = parseFloat(body.quantidade_necessaria ?? body.quantidade) || 0;
            if (qtd <= 0) return res.status(400).json({ success: false, message: 'Informe a quantidade' });

            const descricao = body.descricao_material || body['descrição'] || body.descricao || codigo;
            const unidade = body.unidade_medida || body.unidade || 'UN';
            const custo = parseFloat(body.custo_unitario) || 0;

            const [[mat]] = await pool.query('SELECT id FROM materiais WHERE codigo_material = ?', [codigo]);

            const [result] = await pool.query(`
                INSERT INTO itens_ordem_producao
                (ordem_producao_id, material_id, codigo_material, descricao_material, quantidade_necessaria, unidade_medida, tipo_item, custo_unitario, local_estoque)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, mat ? mat.id : null, codigo, descricao, qtd, unidade, body.tipo_item || 'material', custo, body.local_estoque || null]);

            res.status(201).json({ success: true, id: result.insertId });
        } catch (error) {
            console.error(`[API_PCP] Erro ao incluir item na ordem ${id}:`, error.message);
            res.status(500).json({ success: false, message: 'Erro ao incluir item' });
        }
    });

    // Resolve o pedido de Vendas que originou a OP. Mesma escada do GET /ordens-kanban:
    // vínculo direto primeiro e, na falta dele, o número embutido no código da OP
    // ("2026/02083" -> pedido 2083) — que é o único elo das OPs geradas em lote.
    async function resolverPedidoDaOrdem(ordemId) {
        const [opRows] = await pool.query(`
            SELECT id, codigo, numero_orcamento, numero_pedido, num_pedido, pedido_referencia,
                   COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id_direto
            FROM ordens_producao WHERE id = ?
        `, [ordemId]);
        if (!opRows.length) return { ordem: null, pedido: null };
        const op = opRows[0];

        if (op.pedido_id_direto) {
            const [direto] = await pool.query(
                'SELECT id, numero_pedido, cliente_nome, cliente, valor FROM pedidos WHERE id = ? AND deleted_at IS NULL',
                [op.pedido_id_direto]
            );
            if (direto.length) return { ordem: op, pedido: direto[0] };
        }

        let numero = null;
        for (const bruto of [op.numero_orcamento, op.numero_pedido, op.num_pedido, op.pedido_referencia]) {
            const texto = String(bruto == null ? '' : bruto).trim();
            if (/^\d+$/.test(texto)) { numero = Number(texto); break; }
        }
        if (numero === null) {
            const codigo = String(op.codigo || '').trim();
            const match = codigo.match(/\/(\d+)$/) || codigo.match(/(^|\s)(\d+)$/);
            if (match) numero = Number(match[match.length - 1]);
        }
        if (numero === null || !Number.isFinite(numero)) return { ordem: op, pedido: null };

        const [porNumero] = await pool.query(`
            SELECT id, numero_pedido, cliente_nome, cliente, valor
            FROM pedidos
            WHERE numero_pedido = ?
              AND deleted_at IS NULL
              AND COALESCE(status, '') NOT IN ('excluido', 'excluído', 'cancelado', 'cancelada')
            ORDER BY id DESC
            LIMIT 1
        `, [numero]);
        return { ordem: op, pedido: porNumero.length ? porNumero[0] : null };
    }

    // O código do item de venda traz um sufixo que a estrutura não tem: o pedido
    // vende "DUN10C" e a `estrutura_produto` cadastra "DUN10". Sem esta escada de
    // candidatos nenhum produto do pedido encontra a própria estrutura.
    function candidatosEstruturaProduto(codigo) {
        const base = String(codigo == null ? '' : codigo).trim().toUpperCase();
        if (!base) return [];
        const lista = [base];
        if (base.endsWith('C')) lista.push(base.slice(0, -1));
        const semSufixo = base.replace(/[-/].*$/, ''); // TRN10-02 -> TRN10, QDN95/70 -> QDN95
        if (semSufixo && semSufixo !== base) {
            lista.push(semSufixo);
            if (semSufixo.endsWith('C')) lista.push(semSufixo.slice(0, -1));
        }
        const ateBitola = base.match(/^([A-Z]+\d+(?:\.\d+)?)/);
        if (ateBitola) lista.push(ateBitola[1]);
        return [...new Set(lista.filter(Boolean))];
    }

    // Peso líquido por metro = soma dos componentes em KG da estrutura. Hoje
    // `produtos.peso_liquido` está zerado nas 4 bases, então este é o único peso real
    // disponível para o produto acabado.
    async function pesoLiquidoPorMetroDaEstrutura(codigosEstrutura) {
        const mapa = new Map();
        if (!codigosEstrutura.length) return mapa;
        const [linhas] = await pool.query(`
            SELECT produto_codigo, SUM(COALESCE(quantidade_por_metro, 0)) AS kg_por_metro
            FROM estrutura_produto
            WHERE ativo = 1
              AND UPPER(COALESCE(unidade, '')) = 'KG'
              AND produto_codigo IN (?)
            GROUP BY produto_codigo
        `, [codigosEstrutura]);
        for (const linha of linhas) {
            mapa.set(String(linha.produto_codigo || '').trim().toUpperCase(), Number(linha.kg_por_metro) || 0);
        }
        return mapa;
    }

    // ==========================================================================
    // CORES / VARIAÇÕES PELA ÁRVORE DE PRODUTO
    //
    // Na árvore (GET /arvore-produto) o "Cod. Cores" é
    // `catalogo.cores || produtos.variacao` — e o pulo do gato é que o código
    // VENDIDO não tem a variação preenchida: `DUN10C`, `TRI16C` e afins vêm com
    // variacao/cores NULL, enquanto o código BASE (`DUN10`, `TRI16`) traz "PT/NU",
    // "PT/CZ/AZ". Por isso ler `produtos.cores` pelo código do item do pedido não
    // devolvia nada. Aqui resolvemos a derivação comercial (mesma regra do
    // findCatalogProduct da árvore) antes de buscar a cor.
    // ==========================================================================
    let catalogoArvoreCache = null;
    function catalogoDaArvoreProduto() {
        if (catalogoArvoreCache) return catalogoArvoreCache;
        const mapa = new Map();
        try {
            const dataPath = arvoreFonte.resolverArvore();
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                for (const produto of (Array.isArray(data.products) ? data.products : [])) {
                    if (!produto || !produto.codigo) continue;
                    mapa.set(String(produto.codigo).trim().toUpperCase(), produto);
                }
            }
        } catch (e) {
            console.warn('[PCP] Não consegui ler a árvore de produto:', e.message);
        }
        catalogoArvoreCache = mapa;
        return mapa;
    }

    // Resolve cada código de venda para o código base da árvore e devolve
    // { codigo_base, codigo_cores, variacao, variacoes_disponiveis, kg_por_metro }.
    async function coresEVariacoesDaArvore(codigos) {
        const resultado = new Map();
        const limpos = [...new Set(
            (codigos || []).map(c => String(c || '').trim().toUpperCase()).filter(Boolean)
        )];
        if (!limpos.length) return resultado;

        const catalogo = catalogoDaArvoreProduto();
        const baseDe = new Map();
        for (const codigo of limpos) {
            const candidatos = candidatosEstruturaProduto(codigo);
            const base = candidatos.find(c => catalogo.has(c)) || candidatos[candidatos.length - 1] || codigo;
            baseDe.set(codigo, base);
        }

        // O cadastro é a fonte viva: o JSON da árvore tem `cores` vazio hoje, e é
        // `produtos.variacao` que carrega "PT/CZ/AZ".
        const codigosConsulta = [...new Set([...limpos, ...baseDe.values()])];
        const porCodigo = new Map();
        const porBase = new Map();
        try {
            const [linhas] = await pool.query(`
                SELECT UPPER(TRIM(codigo)) AS codigo,
                       NULLIF(TRIM(COALESCE(variacao, '')), '') AS variacao,
                       NULLIF(TRIM(COALESCE(cores, '')), '')    AS cores,
                       NULLIF(TRIM(COALESCE(cor, '')), '')      AS cor
                  FROM produtos
                 WHERE UPPER(TRIM(codigo)) IN (?)
            `, [codigosConsulta]);
            for (const l of linhas) porCodigo.set(l.codigo, l);

            // Todas as variações irmãs do mesmo código base, para a tela oferecer
            // as opções em vez de exigir digitação livre.
            const bases = [...new Set(baseDe.values())];
            if (bases.length) {
                const [irmaos] = await pool.query(`
                    SELECT UPPER(TRIM(codigo)) AS codigo,
                           NULLIF(TRIM(COALESCE(variacao, '')), '') AS variacao,
                           NULLIF(TRIM(COALESCE(cores, '')), '')    AS cores
                      FROM produtos
                     WHERE UPPER(TRIM(codigo)) REGEXP ?
                `, [`^(${bases.map(b => b.replace(/[^A-Z0-9.]/g, '')).join('|')})`]);
                for (const irmao of irmaos) {
                    const base = bases.find(b => irmao.codigo.startsWith(b));
                    if (!base) continue;
                    const valor = irmao.variacao || irmao.cores;
                    if (!valor) continue;
                    if (!porBase.has(base)) porBase.set(base, new Set());
                    porBase.get(base).add(valor);
                }
            }
        } catch (e) {
            console.warn('[PCP] Falha ao buscar variações do cadastro:', e.message);
        }

        for (const codigo of limpos) {
            const base = baseDe.get(codigo);
            const doCatalogo = catalogo.get(base) || catalogo.get(codigo) || null;
            const proprio = porCodigo.get(codigo) || {};
            const doBase = porCodigo.get(base) || {};
            const cores = (doCatalogo && String(doCatalogo.cores || '').trim())
                || proprio.variacao || proprio.cores || proprio.cor
                || doBase.variacao || doBase.cores || doBase.cor
                || null;
            const disponiveis = [...(porBase.get(base) || [])].sort();
            if (cores && !disponiveis.includes(cores)) disponiveis.unshift(cores);
            resultado.set(codigo, {
                codigo_base: base,
                codigo_cores: cores,
                variacao: proprio.variacao || doBase.variacao || cores || null,
                variacoes_disponiveis: disponiveis,
                kg_por_metro: doCatalogo && Number(doCatalogo.kg_total) > 0 ? Number(doCatalogo.kg_total) : null
            });
        }
        return resultado;
    }

    async function codigosEstruturaDisponiveis() {
        const [linhas] = await pool.query('SELECT DISTINCT produto_codigo FROM estrutura_produto WHERE ativo = 1');
        return new Set(linhas.map(l => String(l.produto_codigo || '').trim().toUpperCase()));
    }

    // Produtos da OP no layout da planilha de produção: código, descrição, cód.
    // cores, embalagem, lances, quantidade, peso líquido/bruto, lote e valores.
    // Não confundir com /itens, que devolve a estrutura/BOM (matéria-prima
    // consumida), e não o que foi vendido.
    //
    // Duas origens: `ordens_producao_itens` — a tabela que tem codigo_cores/peso/lote
    // e vira a fonte da verdade assim que alguém edita um produto pelo modal — e os
    // itens do pedido de Vendas, usados enquanto a OP não tem linha própria.
    // Status por produto da OP. `cancelado` é o único que tira o item da conta:
    // não entra no total da ordem nem gera matéria-prima na estrutura.
    const STATUS_ITEM_OP = ['a_produzir', 'produzindo', 'concluido', 'embalado', 'cancelado'];
    // Só o que já foi produzido pode ser liberado para faturar.
    const STATUS_ITEM_FATURAVEL = ['concluido', 'embalado'];

    // Aceita as variações que chegam de tela e de base antiga (feminino, acento,
    // "em produção") e devolve sempre o slug canônico — ou null se não reconhecer.
    const EQUIVALENTES_STATUS_ITEM_OP = {
        concluida: 'concluido',
        'concluída': 'concluido',
        produzido: 'concluido',
        finalizado: 'concluido',
        embalada: 'embalado',
        cancelada: 'cancelado',
        em_producao: 'produzindo',
        'em_produção': 'produzindo',
        producao: 'produzindo',
        fila: 'a_produzir',
        pendente: 'a_produzir'
    };

    function normalizarStatusItemOP(valor) {
        const texto = String(valor == null ? '' : valor).trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (!texto) return null;
        const candidato = EQUIVALENTES_STATUS_ITEM_OP[texto] || texto;
        return STATUS_ITEM_OP.includes(candidato) ? candidato : null;
    }

    // Quanto de cada produto do pedido já saiu em NF-e. Mesma conta do
    // GET /api/vendas/pedidos/:id/saldo-itens — divergir faria o PCP liberar uma
    // quantidade que o motor de faturamento parcial recusaria depois.
    async function faturadoPorProdutoDoPedido(pedidoId) {
        const mapa = new Map();
        if (!pedidoId) return mapa;
        try {
            const [linhas] = await pool.query(`
                SELECT pfi.produto_id, COALESCE(SUM(pfi.quantidade), 0) AS quantidade
                  FROM pedido_faturamento_itens pfi
                  INNER JOIN pedido_faturamentos pf ON pf.id = pfi.pedido_faturamento_id
                 WHERE pfi.pedido_id = ?
                   AND pf.tipo = 'faturamento'
                   AND COALESCE(pf.nfe_status, 'pendente') <> 'cancelada'
                 GROUP BY pfi.produto_id
            `, [pedidoId]);
            for (const l of linhas) mapa.set(Number(l.produto_id), Number(l.quantidade) || 0);
        } catch (_) { /* tabela criada sob demanda pelo serviço de faturamento */ }
        return mapa;
    }

    async function produtosDaOrdem(ordemId) {
        const { ordem, pedido } = await resolverPedidoDaOrdem(ordemId);
        if (!ordem) return null;

        let itens = [];
        let origem = null;

        try {
            const [proprios] = await pool.query(`
                SELECT id, item_numero, codigo_produto, descricao_produto, codigo_cores,
                       embalagem, lances, quantidade, unidade_medida,
                       peso_liquido, peso_bruto, lote, observacao, valor_unitario, valor_total,
                       status, produto_id, pedido_item_id, quantidade_produzida,
                       liberado_faturamento, quantidade_liberada, liberado_em, liberado_por
                FROM ordens_producao_itens
                WHERE ordem_producao_id = ?
                ORDER BY item_numero ASC, id ASC
            `, [ordemId]);
            if (proprios.length) {
                origem = 'ordem';
                itens = proprios.map((item, indice) => ({
                    id: item.id,
                    item_numero: item.item_numero || indice + 1,
                    produto_id: item.produto_id == null ? null : Number(item.produto_id),
                    pedido_item_id: item.pedido_item_id == null ? null : Number(item.pedido_item_id),
                    codigo: item.codigo_produto,
                    descricao: item.descricao_produto,
                    codigo_cores: item.codigo_cores,
                    embalagem: item.embalagem,
                    lances: item.lances,
                    quantidade: Number(item.quantidade) || 0,
                    unidade: item.unidade_medida || ordem.unidade || 'M',
                    peso_liquido: item.peso_liquido == null ? null : Number(item.peso_liquido),
                    peso_bruto: item.peso_bruto == null ? null : Number(item.peso_bruto),
                    peso_calculado: false,
                    lote: item.lote,
                    observacao: item.observacao,
                    status: normalizarStatusItemOP(item.status) || 'a_produzir',
                    quantidade_produzida: Number(item.quantidade_produzida) || 0,
                    liberado_faturamento: Number(item.liberado_faturamento) === 1,
                    quantidade_liberada: item.quantidade_liberada == null ? null : Number(item.quantidade_liberada),
                    liberado_em: item.liberado_em,
                    liberado_por: item.liberado_por,
                    valor_unitario: Number(item.valor_unitario) || 0,
                    valor_total: Number(item.valor_total) || 0
                }));
            }
        } catch (e) {
            console.log('[API_PCP] ordens_producao_itens indisponível:', e.message);
        }

        if (!itens.length && pedido) {
            origem = 'pedido';
            const [itensPedido] = await pool.query(`
                SELECT pi.id, pi.produto_id, pi.codigo, pi.descricao, pi.quantidade, pi.unidade,
                       pi.embalagem, pi.lances, pi.preco_unitario, pi.desconto, pi.subtotal,
                       NULLIF(TRIM(COALESCE(NULLIF(pr.cores, ''), NULLIF(pr.cor, ''), '')), '') AS codigo_cores,
                       COALESCE(pr.peso_liquido, 0) AS peso_liquido_unitario,
                       COALESCE(pr.peso_bruto, 0) AS peso_bruto_unitario
                FROM pedido_itens pi
                LEFT JOIN produtos pr ON pr.codigo = pi.codigo
                WHERE pi.pedido_id = ?
                ORDER BY pi.id ASC
            `, [pedido.id]);

            if (itensPedido.length) {
                const disponiveis = await codigosEstruturaDisponiveis();
                const estruturaPorItem = itensPedido.map(item =>
                    candidatosEstruturaProduto(item.codigo).find(c => disponiveis.has(c)) || null
                );
                const pesos = await pesoLiquidoPorMetroDaEstrutura([...new Set(estruturaPorItem.filter(Boolean))]);

                const itensBase = itensPedido.map((item, indice) => {
                    const quantidade = Number(item.quantidade) || 0;
                    const liquidoCadastro = Number(item.peso_liquido_unitario) || 0;
                    const brutoCadastro = Number(item.peso_bruto_unitario) || 0;
                    const kgPorMetro = pesos.get(estruturaPorItem[indice]) || 0;
                    const pesoLiquido = liquidoCadastro > 0
                        ? liquidoCadastro * quantidade
                        : (kgPorMetro > 0 ? kgPorMetro * quantidade : null);
                    return {
                        id: null,
                        item_numero: indice + 1,
                        produto_id: item.produto_id == null ? null : Number(item.produto_id),
                        pedido_item_id: Number(item.id),
                        codigo: item.codigo,
                        descricao: item.descricao,
                        codigo_cores: item.codigo_cores,
                        embalagem: item.embalagem,
                        lances: item.lances,
                        quantidade,
                        unidade: item.unidade || 'M',
                        peso_liquido: pesoLiquido,
                        // Peso bruto depende da tara da embalagem, que não é cadastrada:
                        // só sai quando o produto tem peso_bruto no cadastro.
                        peso_bruto: brutoCadastro > 0 ? brutoCadastro * quantidade : null,
                        peso_calculado: liquidoCadastro <= 0 && kgPorMetro > 0,
                        // Não há lote por item de pedido; só as OPs com linha própria gravam.
                        lote: null,
                        observacao: null,
                        // Enquanto a OP não tem linha própria todo item nasce "a produzir".
                        status: 'a_produzir',
                        quantidade_produzida: 0,
                        liberado_faturamento: false,
                        quantidade_liberada: null,
                        liberado_em: null,
                        liberado_por: null,
                        valor_unitario: Number(item.preco_unitario) || 0,
                        valor_total: Number(item.subtotal) || 0
                    };
                });

                // O lance é a unidade de produção: "3x100" no item do pedido vira TRÊS
                // linhas de 100 m na OP (a última leva o resto quando a metragem não
                // fecha nos lances declarados). Quantidade, valor e peso são divididos,
                // então a soma da OP continua igual à do pedido. Feito aqui — e não só
                // na tela — para que a materialização em `ordens_producao_itens`, o
                // `produtos_json` e o PDF da OP nasçam já desdobrados.
                itens = desdobrarProdutosPorLances(itensBase, { campoValorUnitario: 'valor_unitario' })
                    .map((item, indice) => Object.assign(item, { item_numero: indice + 1 }));
            }
        }

        // Cor e variações sempre pela árvore de produto, para as duas origens: o
        // cadastro do código vendido vem vazio e só o código base tem a variação.
        // O que estiver gravado na própria OP (edição manual) manda.
        const arvore = await coresEVariacoesDaArvore(itens.map(i => i.codigo));
        for (const item of itens) {
            const info = arvore.get(String(item.codigo || '').trim().toUpperCase()) || {};
            item.codigo_base = info.codigo_base || null;
            item.variacoes_disponiveis = info.variacoes_disponiveis || [];
            if (!item.codigo_cores) {
                item.codigo_cores = info.codigo_cores || null;
                item.cores_da_arvore = Boolean(info.codigo_cores);
            } else {
                item.cores_da_arvore = false;
            }
            // Peso da árvore entra só onde a estrutura não soube responder.
            if ((item.peso_liquido == null || item.peso_liquido === 0) && info.kg_por_metro) {
                item.peso_liquido = info.kg_por_metro * (item.quantidade || 0);
                item.peso_calculado = true;
            }
        }

        // Saldo faturável por item: quantidade do item menos o que já saiu em NF-e
        // daquele produto. É o teto que a liberação do PCP pode marcar.
        const faturado = await faturadoPorProdutoDoPedido(pedido ? pedido.id : null);
        const usadoPorProduto = new Map();
        for (const item of itens) {
            const produtoId = item.produto_id;
            if (!produtoId) {
                item.quantidade_faturada = 0;
                item.saldo_faturavel = item.status === 'cancelado' ? 0 : item.quantidade;
                item.sem_produto_id = true;
                continue;
            }
            const jaUsado = usadoPorProduto.get(produtoId) || 0;
            const restanteDoProduto = Math.max(0, (faturado.get(produtoId) || 0) - jaUsado);
            const faturadaNesteItem = Math.min(item.quantidade, restanteDoProduto);
            usadoPorProduto.set(produtoId, jaUsado + faturadaNesteItem);
            item.quantidade_faturada = faturadaNesteItem;
            item.saldo_faturavel = item.status === 'cancelado'
                ? 0
                : Math.max(0, item.quantidade - faturadaNesteItem);
            item.sem_produto_id = false;
        }

        // Item cancelado sai da conta da ordem — é o que diferencia o status dos demais.
        const contabilizaveis = itens.filter(item => item.status !== 'cancelado');
        const totais = contabilizaveis.reduce((acc, item) => {
            acc.quantidade += item.quantidade || 0;
            acc.peso_liquido += item.peso_liquido || 0;
            acc.peso_bruto += item.peso_bruto || 0;
            acc.valor += item.valor_total || 0;
            return acc;
        }, { quantidade: 0, peso_liquido: 0, peso_bruto: 0, valor: 0 });
        totais.itens_cancelados = itens.length - contabilizaveis.length;
        totais.quantidade_liberada = itens.reduce(
            (acc, item) => acc + (item.liberado_faturamento ? (item.quantidade_liberada || 0) : 0), 0);
        totais.quantidade_produzida = contabilizaveis.reduce(
            (acc, item) => acc + (item.quantidade_produzida || 0), 0);

        return { ordem, pedido, origem, itens, totais };
    }

    function respostaProdutosDaOrdem(resultado) {
        return {
            success: true,
            origem: resultado.origem,
            editavel: true,
            status_possiveis: STATUS_ITEM_OP,
            status_faturavel: STATUS_ITEM_FATURAVEL,
            pedido_id: resultado.pedido ? resultado.pedido.id : null,
            numero_pedido: resultado.pedido ? resultado.pedido.numero_pedido : null,
            cliente: resultado.pedido ? (resultado.pedido.cliente_nome || resultado.pedido.cliente || null) : null,
            itens: resultado.itens,
            totais: resultado.totais
        };
    }

    router.get('/ordens-producao/:id/itens-pedido', async (req, res, next) => {
        const { id } = req.params;
        try {
            const resultado = await produtosDaOrdem(id);
            if (!resultado) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
            res.json(respostaProdutosDaOrdem(resultado));
        } catch (error) {
            console.error(`[API_PCP] Erro ao buscar produtos da ordem ${id}:`, error.message);
            next(error);
        }
    });

    // Materializa os produtos da OP em `ordens_producao_itens`. Enquanto a OP não tem
    // linha própria a aba lê direto do pedido de Vendas; na primeira edição o conteúdo
    // é congelado aqui, para que mexer na produção não altere o pedido do comercial.
    async function materializarItensDaOrdem(conexao, ordemId, itens) {
        const [existentes] = await conexao.query(
            'SELECT COUNT(*) AS total FROM ordens_producao_itens WHERE ordem_producao_id = ?',
            [ordemId]
        );
        if (existentes[0].total > 0) return false;

        for (const item of itens) {
            await conexao.query(`
                INSERT INTO ordens_producao_itens
                    (ordem_producao_id, item_numero, codigo_produto, descricao_produto,
                     embalagem, codigo_cores, lances, quantidade, unidade_medida,
                     valor_unitario, valor_total, peso_liquido, peso_bruto, lote, observacao,
                     status, produto_id, pedido_item_id, quantidade_produzida,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                ordemId, item.item_numero, item.codigo || null, item.descricao || null,
                item.embalagem || null, item.codigo_cores || null, item.lances || null,
                item.quantidade || 0, item.unidade || 'M',
                item.valor_unitario || 0, item.valor_total || 0,
                item.peso_liquido == null ? null : item.peso_liquido,
                item.peso_bruto == null ? null : item.peso_bruto,
                item.lote || null, item.observacao || null,
                item.status || 'a_produzir',
                item.produto_id || null, item.pedido_item_id || null,
                item.quantidade_produzida || 0
            ]);
        }
        return true;
    }

    // Reflete os produtos da OP no cabeçalho de `ordens_producao`. Sem isto a edição
    // ficaria presa na aba: a "Quantidade a produzir" do modal, o card do kanban e,
    // principalmente, o PDF da OP (que lê `produtos_json`) continuariam no valor antigo.
    async function sincronizarCabecalhoDaOrdem(conexao, ordemId) {
        const [todas] = await conexao.query(`
            SELECT item_numero, codigo_produto, descricao_produto, embalagem, codigo_cores,
                   lances, quantidade, unidade_medida, valor_unitario, valor_total,
                   peso_liquido, peso_bruto, lote, observacao, status, quantidade_produzida
            FROM ordens_producao_itens
            WHERE ordem_producao_id = ?
            ORDER BY item_numero ASC, id ASC
        `, [ordemId]);
        if (!todas.length) return null;

        // Item cancelado continua na lista (para o PCP ver o que foi cortado), mas não
        // soma no cabeçalho nem entra no produtos_json que vira o PDF da OP.
        const linhas = todas.filter(l => normalizarStatusItemOP(l.status) !== 'cancelado');
        if (!linhas.length) return null;

        const soma = campo => linhas.reduce((acc, l) => acc + (Number(l[campo]) || 0), 0);
        const quantidade = soma('quantidade');
        const valor = soma('valor_total');
        const pesoLiquido = soma('peso_liquido');
        const pesoBruto = soma('peso_bruto');
        const produzida = soma('quantidade_produzida');
        // Progresso do card do kanban e da barra da OP: produzido ÷ a produzir.
        const progresso = quantidade > 0
            ? Math.min(100, Math.round((produzida / quantidade) * 100))
            : 0;

        const distintos = campo => [...new Set(
            linhas.map(l => String(l[campo] == null ? '' : l[campo]).trim()).filter(Boolean)
        )];
        const unidades = distintos('unidade_medida');
        const embalagens = distintos('embalagem');
        const cores = distintos('codigo_cores');

        // Mesmo formato que o PDF da OP espera em produtos_json (ver GET /pdf-completo).
        const produtosJson = linhas.map(l => ({
            codigo: l.codigo_produto || '',
            descricao: l.descricao_produto || '',
            embalagem: l.embalagem || '',
            lances: l.lances || '',
            quantidade: Number(l.quantidade) || 0,
            unidade: l.unidade_medida || 'M',
            valor_unitario: Number(l.valor_unitario) || 0,
            valor_total: Number(l.valor_total) || 0,
            codigo_cores: l.codigo_cores || '',
            peso_liquido: l.peso_liquido == null ? '' : Number(l.peso_liquido),
            peso_bruto: l.peso_bruto == null ? '' : Number(l.peso_bruto),
            lote: l.lote || '',
            observacao: l.observacao || ''
        }));

        await conexao.query(`
            UPDATE ordens_producao SET
                quantidade = ?,
                quantidade_produzida = ?,
                progresso = ?,
                unidade = COALESCE(?, unidade),
                quantidade_produtos = ?,
                valor_total = ?,
                total_geral = ?,
                peso_liquido = ?,
                peso_bruto = ?,
                metragem = ?,
                tipo_embalagem_entrega = COALESCE(?, tipo_embalagem_entrega),
                cores_pe = COALESCE(?, cores_pe),
                produtos_json = ?,
                updated_at = NOW()
            WHERE id = ?
        `, [
            quantidade,
            produzida,
            progresso,
            unidades.length === 1 ? unidades[0] : null,
            linhas.length,
            valor,
            valor,
            pesoLiquido || null,
            pesoBruto || null,
            quantidade,
            embalagens.length === 1 ? embalagens[0] : null,
            cores.length ? cores.join(', ') : null,
            JSON.stringify(produtosJson),
            ordemId
        ]);

        return { quantidade, valor, pesoLiquido, pesoBruto, produzida, progresso };
    }

    // PUT - Edita UM produto da OP (duplo clique na linha da aba "Produtos do Pedido").
    // Grava em `ordens_producao_itens` e propaga para o cabeçalho da OP. O pedido de
    // Vendas NÃO é alterado: quantidade e preço da OP podem divergir do comercial de
    // propósito (sobra de produção, reprogramação), e reescrever `pedido_itens` daqui
    // mexeria em faturamento e contas a receber sem ninguém pedir.
    router.put('/ordens-producao/:id/itens-pedido/:itemNumero', async (req, res, next) => {
        const { id, itemNumero } = req.params;
        const numero = parseInt(itemNumero, 10);
        if (!Number.isFinite(numero) || numero <= 0) {
            return res.status(400).json({ success: false, message: 'Item inválido' });
        }

        const texto = valor => {
            if (valor === undefined) return undefined;
            const limpo = String(valor == null ? '' : valor).trim();
            return limpo === '' ? null : limpo.slice(0, 190);
        };
        const numeroOuNulo = valor => {
            if (valor === undefined) return undefined;
            if (valor === null || String(valor).trim() === '') return null;
            // Número já vem pronto do JSON. Só string passa pela normalização pt-BR, e
            // só quando tem vírgula — senão "123.456" (JSON, cento e vinte e três e
            // pouco) viraria 123456 ao ter o ponto removido como separador de milhar.
            if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
            let texto = String(valor).trim();
            if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
            const convertido = Number(texto);
            return Number.isFinite(convertido) ? convertido : null;
        };

        const alteracoes = {
            codigo_cores: texto(req.body.codigo_cores),
            embalagem: texto(req.body.embalagem),
            lances: texto(req.body.lances),
            lote: texto(req.body.lote),
            observacao: texto(req.body.observacao),
            unidade_medida: texto(req.body.unidade),
            quantidade: numeroOuNulo(req.body.quantidade),
            peso_liquido: numeroOuNulo(req.body.peso_liquido),
            peso_bruto: numeroOuNulo(req.body.peso_bruto),
            valor_unitario: numeroOuNulo(req.body.valor_unitario),
            quantidade_produzida: numeroOuNulo(req.body.quantidade_produzida)
        };
        // A coluna é NOT NULL DEFAULT 0 — campo apagado na tela vira zero, não NULL.
        if (alteracoes.quantidade_produzida === null) alteracoes.quantidade_produzida = 0;
        if (alteracoes.quantidade_produzida !== undefined && alteracoes.quantidade_produzida < 0) {
            return res.status(400).json({ success: false, message: 'Quantidade produzida não pode ser negativa' });
        }

        if (req.body.status !== undefined) {
            const status = normalizarStatusItemOP(req.body.status);
            if (!status) {
                return res.status(400).json({
                    success: false,
                    message: `Status inválido. Use: ${STATUS_ITEM_OP.join(', ')}`
                });
            }
            alteracoes.status = status;
        }
        if (alteracoes.quantidade != null && alteracoes.quantidade < 0) {
            return res.status(400).json({ success: false, message: 'Quantidade não pode ser negativa' });
        }
        if (alteracoes.valor_unitario != null && alteracoes.valor_unitario < 0) {
            return res.status(400).json({ success: false, message: 'Valor unitário não pode ser negativo' });
        }

        const conexao = await pool.getConnection();
        try {
            const resultado = await produtosDaOrdem(id);
            if (!resultado) {
                conexao.release();
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
            if (!resultado.itens.length) {
                conexao.release();
                return res.status(404).json({ success: false, message: 'Esta ordem não tem produtos para editar' });
            }

            await conexao.beginTransaction();
            await materializarItensDaOrdem(conexao, id, resultado.itens);

            const [alvo] = await conexao.query(
                'SELECT * FROM ordens_producao_itens WHERE ordem_producao_id = ? AND item_numero = ? LIMIT 1',
                [id, numero]
            );
            if (!alvo.length) {
                await conexao.rollback();
                conexao.release();
                return res.status(404).json({ success: false, message: 'Produto não encontrado nesta ordem' });
            }

            const campos = [];
            const valores = [];
            for (const [coluna, valor] of Object.entries(alteracoes)) {
                if (valor === undefined) continue;
                campos.push(`${coluna} = ?`);
                valores.push(valor);
            }

            // O total segue quantidade × valor unitário, salvo se vier explícito.
            const quantidadeFinal = alteracoes.quantidade !== undefined && alteracoes.quantidade != null
                ? alteracoes.quantidade
                : Number(alvo[0].quantidade) || 0;
            const unitarioFinal = alteracoes.valor_unitario !== undefined && alteracoes.valor_unitario != null
                ? alteracoes.valor_unitario
                : Number(alvo[0].valor_unitario) || 0;
            const totalExplicito = numeroOuNulo(req.body.valor_total);
            campos.push('valor_total = ?');
            valores.push(totalExplicito != null ? totalExplicito : quantidadeFinal * unitarioFinal);
            campos.push('updated_at = NOW()');

            await conexao.query(
                `UPDATE ordens_producao_itens SET ${campos.join(', ')} WHERE id = ?`,
                [...valores, alvo[0].id]
            );

            await sincronizarCabecalhoDaOrdem(conexao, id);
            await conexao.commit();
            conexao.release();

            const atualizado = await produtosDaOrdem(id);
            res.json(respostaProdutosDaOrdem(atualizado));
        } catch (error) {
            try { await conexao.rollback(); } catch (_) {}
            conexao.release();
            console.error(`[API_PCP] Erro ao editar produto da ordem ${id}:`, error.message);
            next(error);
        }
    });

    // POST - Status em lote dos produtos marcados na aba (produzindo / concluído /
    // embalado / cancelado). Materializa a OP igual à edição individual, porque o
    // status é um dado da produção e não existe no pedido de Vendas.
    router.post('/ordens-producao/:id/itens-pedido/status', async (req, res, next) => {
        const { id } = req.params;
        const status = normalizarStatusItemOP(req.body?.status);
        if (!status) {
            return res.status(400).json({
                success: false,
                message: `Status inválido. Use: ${STATUS_ITEM_OP.join(', ')}`
            });
        }
        const numeros = Array.isArray(req.body?.itens)
            ? [...new Set(req.body.itens.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n > 0))]
            : [];
        if (!numeros.length) {
            return res.status(400).json({ success: false, message: 'Selecione ao menos um produto' });
        }

        const conexao = await pool.getConnection();
        try {
            const resultado = await produtosDaOrdem(id);
            if (!resultado) {
                conexao.release();
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
            if (!resultado.itens.length) {
                conexao.release();
                return res.status(404).json({ success: false, message: 'Esta ordem não tem produtos' });
            }

            await conexao.beginTransaction();
            await materializarItensDaOrdem(conexao, id, resultado.itens);

            // Cancelar um item já liberado deixaria uma liberação órfã pendurada no
            // faturamento — a liberação cai junto.
            const [info] = await conexao.query(
                `UPDATE ordens_producao_itens
                    SET status = ?,
                        liberado_faturamento = CASE WHEN ? = 'cancelado' THEN 0 ELSE liberado_faturamento END,
                        quantidade_liberada = CASE WHEN ? = 'cancelado' THEN NULL ELSE quantidade_liberada END,
                        updated_at = NOW()
                  WHERE ordem_producao_id = ? AND item_numero IN (?)`,
                [status, status, status, id, numeros]
            );

            await sincronizarCabecalhoDaOrdem(conexao, id);
            await conexao.commit();
            conexao.release();

            const atualizado = await produtosDaOrdem(id);
            res.json({ ...respostaProdutosDaOrdem(atualizado), atualizados: info.affectedRows });
        } catch (error) {
            try { await conexao.rollback(); } catch (_) {}
            conexao.release();
            console.error(`[API_PCP] Erro ao mudar status de itens da ordem ${id}:`, error.message);
            next(error);
        }
    });

    // POST - Libera os produtos marcados para o faturamento parcial POR ITEM.
    //
    // O PCP NÃO emite nota: quem emite é
    // `POST /api/vendas/pedidos/:id/faturamento-parcial` (modo `itens_faturar`, em
    // services/faturamento-parcial.service.js). Esta rota faz a ponte — valida contra o
    // mesmo saldo que aquele motor usa, marca a liberação na OP, escreve a quantidade em
    // `pedido_itens.quantidade_parcial` (a coluna "Qtd. Parcial" que Vendas já exibe) e
    // devolve o payload `itens_faturar` pronto. Assim a produção diz o que pode ser
    // faturado sem disparar documento fiscal por conta própria.
    router.post('/ordens-producao/:id/liberar-faturamento', async (req, res, next) => {
        const { id } = req.params;
        const selecionados = Array.isArray(req.body?.itens) ? req.body.itens : [];
        if (!selecionados.length) {
            return res.status(400).json({ success: false, message: 'Selecione ao menos um produto' });
        }

        const conexao = await pool.getConnection();
        try {
            const resultado = await produtosDaOrdem(id);
            if (!resultado) {
                conexao.release();
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
            if (!resultado.pedido) {
                conexao.release();
                return res.status(409).json({
                    success: false,
                    message: 'Esta ordem não está vinculada a um pedido de Vendas — não há o que faturar.'
                });
            }

            const porNumero = new Map(resultado.itens.map(i => [Number(i.item_numero), i]));
            const aLiberar = [];
            for (const bruto of selecionados) {
                const numero = parseInt(bruto?.item_numero, 10);
                const item = porNumero.get(numero);
                if (!item) {
                    conexao.release();
                    return res.status(400).json({ success: false, message: `Produto ${numero} não pertence a esta ordem` });
                }
                if (!STATUS_ITEM_FATURAVEL.includes(item.status)) {
                    conexao.release();
                    return res.status(409).json({
                        success: false,
                        message: `"${item.codigo || numero}" está como "${item.status}". Só produto concluído ou embalado pode ser liberado para faturar.`,
                        item_numero: numero
                    });
                }
                if (!item.produto_id) {
                    conexao.release();
                    return res.status(409).json({
                        success: false,
                        message: `"${item.codigo || numero}" não tem produto vinculado no pedido (produto_id vazio) — o faturamento por item não consegue identificá-lo.`,
                        item_numero: numero
                    });
                }

                const pedida = bruto?.quantidade === undefined || bruto?.quantidade === null || bruto?.quantidade === ''
                    ? item.saldo_faturavel
                    : Number(bruto.quantidade);
                const quantidade = Math.round((Number(pedida) || 0) * 10000) / 10000;
                if (!(quantidade > 0)) {
                    conexao.release();
                    return res.status(400).json({ success: false, message: `Quantidade inválida para "${item.codigo || numero}"` });
                }
                if (quantidade > item.saldo_faturavel + 0.0001) {
                    conexao.release();
                    return res.status(409).json({
                        success: false,
                        message: `"${item.codigo || numero}": saldo faturável é ${item.saldo_faturavel} ${item.unidade || ''}`.trim(),
                        item_numero: numero,
                        saldo: item.saldo_faturavel
                    });
                }
                aLiberar.push({ item, quantidade });
            }

            const usuario = String(req.user?.nome || req.user?.email || req.user?.username || 'PCP').slice(0, 120);

            await conexao.beginTransaction();
            await materializarItensDaOrdem(conexao, id, resultado.itens);

            for (const { item, quantidade } of aLiberar) {
                await conexao.query(
                    `UPDATE ordens_producao_itens
                        SET liberado_faturamento = 1, quantidade_liberada = ?,
                            liberado_em = NOW(), liberado_por = ?, updated_at = NOW()
                      WHERE ordem_producao_id = ? AND item_numero = ?`,
                    [quantidade, usuario, id, item.item_numero]
                );
                if (item.pedido_item_id) {
                    await conexao.query(
                        'UPDATE pedido_itens SET quantidade_parcial = ? WHERE id = ?',
                        [quantidade, item.pedido_item_id]
                    );
                }
            }

            await conexao.commit();
            conexao.release();

            // Payload no formato exato que o motor de faturamento parcial espera.
            const itensFaturar = aLiberar.map(({ item, quantidade }) => ({
                produto_id: item.produto_id,
                quantidade,
                codigo: item.codigo,
                descricao: item.descricao,
                unidade: item.unidade
            }));

            const atualizado = await produtosDaOrdem(id);
            res.json({
                ...respostaProdutosDaOrdem(atualizado),
                liberados: itensFaturar.length,
                itens_faturar: itensFaturar,
                faturamento_parcial_url: `/api/vendas/pedidos/${resultado.pedido.id}/faturamento-parcial`
            });
        } catch (error) {
            try { await conexao.rollback(); } catch (_) {}
            conexao.release();
            console.error(`[API_PCP] Erro ao liberar itens para faturamento da ordem ${id}:`, error.message);
            next(error);
        }
    });

    // Monta a estrutura (BOM) somando TODOS os produtos do pedido de origem.
    // Antes a rota /itens casava UM produto por heurística sobre `op.produto_nome` —
    // que nas OPs geradas em lote é a concatenação de todos os itens — e acabava
    // mostrando a estrutura do último código citado no texto (na OP 2026/02083, o
    // "DUI10C" do fim do nome, sendo que o pedido vendeu DUN10C/DUN16C/TRN16C).
    async function montarItensPelaEstruturaDoPedido(ordemId) {
        // Vem de produtosDaOrdem() de propósito: quando alguém edita a quantidade de um
        // produto pelo modal, a matéria-prima tem de acompanhar a quantidade da OP, não
        // a do pedido original.
        const resultado = await produtosDaOrdem(ordemId);
        if (!resultado) return [];
        // Produto cancelado não consome matéria-prima.
        const itensPedido = resultado.itens.filter(item => item.status !== 'cancelado');
        if (!itensPedido.length) return [];

        const disponiveis = await codigosEstruturaDisponiveis();
        const pares = itensPedido.map(item => ({
            item,
            produtoEstrutura: candidatosEstruturaProduto(item.codigo).find(c => disponiveis.has(c)) || null
        }));

        const codigosEstrutura = [...new Set(pares.map(p => p.produtoEstrutura).filter(Boolean))];
        const porProduto = new Map();
        if (codigosEstrutura.length) {
            const [componentes] = await pool.query(`
                SELECT produto_codigo, componente_codigo, componente_descricao,
                       componente_tipo, quantidade_por_metro, unidade, local_estoque
                FROM estrutura_produto
                WHERE ativo = 1 AND produto_codigo IN (?)
                ORDER BY produto_codigo, componente_tipo, id
            `, [codigosEstrutura]);
            for (const comp of componentes) {
                const chave = String(comp.produto_codigo || '').trim().toUpperCase();
                if (!porProduto.has(chave)) porProduto.set(chave, []);
                porProduto.get(chave).push(comp);
            }
        }

        const codigosComponente = [...new Set(
            [...porProduto.values()].flat().map(c => c.componente_codigo).filter(Boolean)
        )];
        const estoqueMap = {};
        if (codigosComponente.length) {
            try {
                const [saldos] = await pool.query(`
                    SELECT codigo_material, COALESCE(SUM(quantidade_disponivel), 0) AS estoque
                    FROM estoque_saldos
                    WHERE codigo_material IN (?)
                    GROUP BY codigo_material
                `, [codigosComponente]);
                for (const s of saldos) estoqueMap[s.codigo_material] = parseFloat(s.estoque) || 0;
            } catch (e) { /* instância sem estoque_saldos */ }
        }

        const itens = [];
        for (const { item, produtoEstrutura } of pares) {
            const quantidadeItem = parseFloat(item.quantidade) || 0;
            const comuns = {
                id: 0,
                ordem_producao_id: Number(ordemId),
                material_id: null,
                quantidade_utilizada: 0,
                produto_codigo: item.codigo,
                produto_descricao: item.descricao,
                produto_quantidade: quantidadeItem,
                produto_unidade: item.unidade || 'M'
            };
            const componentes = produtoEstrutura ? (porProduto.get(produtoEstrutura) || []) : [];

            if (!componentes.length) {
                // Produto sem estrutura cadastrada aparece assim mesmo — senão o item
                // do pedido simplesmente sumiria da OP sem ninguém notar.
                itens.push({
                    ...comuns,
                    codigo_material: item.codigo,
                    descricao: item.descricao,
                    quantidade: quantidadeItem,
                    unidade: item.unidade || 'M',
                    estoque_disponivel: 0,
                    local_estoque: 'PRODUÇÃO',
                    tipo_item: 'PRODUTO_ACABADO',
                    principal: 1,
                    sem_estrutura: true
                });
                continue;
            }

            for (const comp of componentes) {
                itens.push({
                    ...comuns,
                    codigo_material: comp.componente_codigo,
                    descricao: comp.componente_descricao,
                    quantidade: quantidadeItem * (parseFloat(comp.quantidade_por_metro) || 0),
                    unidade: comp.unidade,
                    estoque_disponivel: estoqueMap[comp.componente_codigo] || 0,
                    local_estoque: comp.local_estoque,
                    tipo_item: String(comp.componente_tipo || 'MATERIAL').toUpperCase(),
                    principal: 0,
                    sem_estrutura: false
                });
            }
        }
        return itens;
    }

    router.get('/ordens-producao/:id/itens', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Buscando itens da ordem de produção ${id}...`);

        try {
            // Primeiro, buscar informações da ordem de produção
            const [opRows] = await pool.query(`
                SELECT id, codigo, produto_nome, quantidade, unidade
                FROM ordens_producao WHERE id = ?
            `, [id]);

            if (!opRows || opRows.length === 0) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }

            const op = opRows[0];
            const quantidadeOP = parseFloat(op.quantidade) || 0;

            // Buscar itens já salvos na tabela itens_ordem_producao
            let itens = [];
            try {
                const [savedItems] = await pool.query(`
                    SELECT
                        id, ordem_producao_id, material_id, codigo_material,
                        descricao_material as descricao, quantidade_necessaria as quantidade,
                        quantidade_utilizada, unidade_medida as unidade,
                        local_estoque, tipo_item, principal,
                        COALESCE(custo_unitario, 0) as custo_unitario,
                        COALESCE(custo_total, 0) as custo_total
                    FROM itens_ordem_producao
                    WHERE ordem_producao_id = ?
                    ORDER BY principal DESC, tipo_item, id ASC
                `, [id]);

                if (savedItems && savedItems.length > 0) {
                    // Batch: buscar estoque de todos os materiais de uma vez
                    const codigosMateriais = savedItems.map(i => i.codigo_material).filter(Boolean);

                    let estoqueMap = {};
                    let custosProdutosMap = {};
                    let custosMateriaisMap = {};

                    if (codigosMateriais.length > 0) {
                        try {
                            const [estoqueRows] = await pool.query(`
                                SELECT codigo_material, COALESCE(SUM(quantidade_disponivel), 0) as estoque
                                FROM estoque_saldos
                                WHERE codigo_material IN (?)
                                GROUP BY codigo_material
                            `, [codigosMateriais]);
                            for (const r of estoqueRows) estoqueMap[r.codigo_material] = parseFloat(r.estoque) || 0;
                        } catch(e) {}

                        try {
                            const [custoRows] = await pool.query(`
                                SELECT codigo, COALESCE(preco_custo, custo_unitario, 0) as custo
                                FROM produtos
                                WHERE codigo IN (?)
                            `, [codigosMateriais]);
                            for (const r of custoRows) custosProdutosMap[r.codigo] = parseFloat(r.custo) || 0;
                        } catch(e) {}

                        try {
                            const [matRows] = await pool.query(`
                                SELECT codigo_material, COALESCE(custo_unitario, 0) as custo
                                FROM materiais
                                WHERE codigo_material IN (?)
                            `, [codigosMateriais]);
                            for (const r of matRows) custosMateriaisMap[r.codigo_material] = parseFloat(r.custo) || 0;
                        } catch(e) {}
                    }

                    // Aplicar dados em batch
                    for (const item of savedItems) {
                        item.estoque_disponivel = estoqueMap[item.codigo_material] || 0;
                        if (!item.custo_unitario || item.custo_unitario === 0) {
                            item.custo_unitario = custosProdutosMap[item.codigo_material] || custosMateriaisMap[item.codigo_material] || 0;
                        }
                    }
                    itens = savedItems;
                }
            } catch (e) {
                console.log('[API_PCP] Tabela itens_ordem_producao não existe ou erro:', e.message);
            }

            // Antes da heurística por nome: se a OP veio de um pedido de Vendas, a
            // estrutura sai de TODOS os produtos do pedido, cada um multiplicado pela
            // própria quantidade. É o caminho certo — a heurística abaixo só sabe
            // casar um produto e ignora o resto do orçamento.
            if (itens.length === 0) {
                try {
                    itens = await montarItensPelaEstruturaDoPedido(id);
                    if (itens.length) {
                        console.log(`[API_PCP] Estrutura montada pelos ${new Set(itens.map(i => i.produto_codigo)).size} produto(s) do pedido da ordem ${id}`);
                    }
                } catch (e) {
                    console.log('[API_PCP] Falha ao montar estrutura pelo pedido:', e.message);
                    itens = [];
                }
            }

            // Se não há itens salvos, tentar gerar baseado na estrutura do produto
            if (itens.length === 0) {
                console.log(`[API_PCP] Buscando estrutura para produto: ${op.produto_nome}`);

                // Tentar encontrar estrutura correspondente ao produto
                try {
                    // Buscar por nome parcial
                    const produtoNome = (op.produto_nome || '').toUpperCase();
                    let estrutura = [];

                    // Buscar estruturas que correspondam ao produto
                    const [estruturas] = await pool.query(`
                        SELECT DISTINCT produto_codigo, produto_descricao
                        FROM estrutura_produto
                        WHERE ativo = 1
                    `);

                    // Tentar encontrar correspondência
                    let produtoEstrutura = null;

                    // 1. Verificar se o produto_nome contém diretamente o código (ex: "TRN70", "POT120")
                    for (const est of estruturas) {
                        const codigo = est.produto_codigo;
                        // Verificar se o código está no nome do produto
                        if (produtoNome.includes(codigo) || produtoNome.includes(codigo.replace(/([A-Z]+)(\d+)/, '$1 $2'))) {
                            produtoEstrutura = codigo;
                            console.log(`[API_PCP] Match direto por código: ${codigo}`);
                            break;
                        }
                    }

                    // 2. Se não encontrou, tentar extrair código do nome (ex: "TRIPLEX 70mm² NEUTRO" -> TRN70 ou TRI70)
                    if (!produtoEstrutura) {
                        // Extrair bitola (número) do nome
                        const bitolaMatch = produtoNome.match(/(\d+)\s*MM/);
                        const bitola = bitolaMatch ? bitolaMatch[1] : null;

                        if (bitola) {
                            // Verificar tipo de cabo
                            if (produtoNome.includes('TRIPLEX')) {
                                if (produtoNome.includes('ISOLADO') || produtoNome.includes('TRI')) {
                                    produtoEstrutura = `TRI${bitola}`;
                                } else if (produtoNome.includes('NU') || produtoNome.includes('TRN')) {
                                    produtoEstrutura = `TRN${bitola}`;
                                } else {
                                    // Default para TRIPLEX é Neutro Nu
                                    produtoEstrutura = `TRN${bitola}`;
                                }
                            } else if (produtoNome.includes('DUPLEX')) {
                                if (produtoNome.includes('ISOLADO') || produtoNome.includes('DUI')) {
                                    produtoEstrutura = `DUI${bitola}`;
                                } else {
                                    produtoEstrutura = `DUN${bitola}`;
                                }
                            } else if (produtoNome.includes('QUAD')) {
                                if (produtoNome.includes('ISOLADO') || produtoNome.includes('QDI')) {
                                    produtoEstrutura = `QDI${bitola}`;
                                } else {
                                    produtoEstrutura = `QDN${bitola}`;
                                }
                            } else if (produtoNome.includes('POT') || produtoNome.includes('POTÊNCIA') || produtoNome.includes('POTENCIA')) {
                                produtoEstrutura = `POT${bitola}`;
                            } else if (produtoNome.includes('PRO') || produtoNome.includes('PROTEGIDO')) {
                                produtoEstrutura = `PRO${bitola}`;
                            } else if (produtoNome.includes('UN') || produtoNome.includes('NBR 7285')) {
                                produtoEstrutura = `UN${bitola}`;
                            } else if (produtoNome.includes('CET') || produtoNome.includes('HEPR') || produtoNome.includes('0,6/1KV')) {
                                // Cabos de potência HEPR - formato CET{vias}.{bitola}
                                // Tentar extrair número de vias do nome (ex: "2x1,5mm²" -> 2 vias, 1.5mm²)
                                const viasMatch = produtoNome.match(/(\d+)\s*[xX]\s*(\d+[,.]?\d*)/);
                                if (viasMatch) {
                                    const vias = viasMatch[1];
                                    let bitolaHEPR = viasMatch[2].replace(',', '.');
                                    // Converter 1.5 -> 15, 2.5 -> 25, etc.
                                    if (bitolaHEPR.includes('.')) {
                                        bitolaHEPR = bitolaHEPR.replace('.', '');
                                    }
                                    produtoEstrutura = `CET${vias}.${bitolaHEPR}`;
                                } else {
                                    // Fallback para formato antigo
                                    produtoEstrutura = `CET${bitola}`;
                                }
                            }

                            console.log(`[API_PCP] Código extraído do nome: ${produtoEstrutura}`);

                            // Verificar se o código existe na tabela
                            const existe = estruturas.find(e => e.produto_codigo === produtoEstrutura);
                            if (!existe) {
                                console.log(`[API_PCP] Código ${produtoEstrutura} não encontrado na tabela estrutura_produto`);
                                produtoEstrutura = null;
                            }
                        }
                    }

                    // 3. Fallback: correspondência por palavras
                    if (!produtoEstrutura) {
                        for (const est of estruturas) {
                            const descUpper = (est.produto_descricao || '').toUpperCase();
                            const palavrasProduto = produtoNome.split(/[\s-_]+/).filter(p => p.length > 2);
                            const palavrasEstrutura = descUpper.split(/[\s-_]+/).filter(p => p.length > 2);
                            const matches = palavrasProduto.filter(p => palavrasEstrutura.some(e => e.includes(p) || p.includes(e)));
                            if (matches.length >= 2) {
                                produtoEstrutura = est.produto_codigo;
                                console.log(`[API_PCP] Match por palavras: ${produtoEstrutura}`);
                                break;
                            }
                        }
                    }

                    if (produtoEstrutura) {
                        // Buscar componentes da estrutura
                        const [componentes] = await pool.query(`
                            SELECT componente_codigo, componente_descricao, componente_tipo,
                                   quantidade_por_metro, unidade, local_estoque
                            FROM estrutura_produto
                            WHERE produto_codigo = ? AND ativo = 1
                            ORDER BY componente_tipo, id
                        `, [produtoEstrutura]);

                        console.log(`[API_PCP] Encontrados ${componentes.length} componentes na estrutura ${produtoEstrutura}`);

                        // Batch: buscar estoque de todos os componentes de uma vez
                        const codigosComp = componentes.map(c => c.componente_codigo).filter(Boolean);
                        let estoqueCompMap = {};
                        if (codigosComp.length > 0) {
                            try {
                                const [estoqueRows] = await pool.query(`
                                    SELECT codigo_material, COALESCE(SUM(quantidade_disponivel), 0) as estoque
                                    FROM estoque_saldos
                                    WHERE codigo_material IN (?)
                                    GROUP BY codigo_material
                                `, [codigosComp]);
                                for (const r of estoqueRows) estoqueCompMap[r.codigo_material] = parseFloat(r.estoque) || 0;
                            } catch(e) {}
                        }

                        for (const comp of componentes) {
                            const qtdNecessaria = quantidadeOP * parseFloat(comp.quantidade_por_metro);
                            const estoqueDisponivel = estoqueCompMap[comp.componente_codigo] || 0;

                            itens.push({
                                id: 0,
                                ordem_producao_id: id,
                                material_id: null,
                                codigo_material: comp.componente_codigo,
                                descricao: comp.componente_descricao,
                                quantidade: qtdNecessaria,
                                quantidade_utilizada: 0,
                                unidade: comp.unidade,
                                estoque_disponivel: estoqueDisponivel,
                                local_estoque: comp.local_estoque,
                                tipo_item: comp.componente_tipo.toUpperCase(),
                                principal: 0
                            });
                        }
                    }
                } catch (e) {
                    console.log('[API_PCP] Erro ao buscar estrutura:', e.message);
                }

                // Se ainda não há itens, mostrar apenas o produto principal
                if (itens.length === 0) {
                    itens = [{
                        id: 0,
                        ordem_producao_id: op.id,
                        material_id: null,
                        codigo_material: op.codigo,
                        descricao: op.produto_nome,
                        quantidade: op.quantidade,
                        quantidade_utilizada: 0,
                        unidade: op.unidade || 'M',
                        estoque_disponivel: 0,
                        local_estoque: 'PRODUÇÃO',
                        tipo_item: 'PRODUTO_ACABADO',
                        principal: 1
                    }];
                }
            }

            console.log(`[API_PCP] Retornando ${itens.length} itens da ordem ${id}`);
            res.json({ success: true, data: itens, total: itens.length });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar itens:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar itens da ordem', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // ========================================
    // GERENCIAMENTO DE COLUNAS/ETAPAS DO KANBAN PCP
    // ========================================

    // Listar todas as colunas/etapas do kanban
    router.get('/kanban-colunas', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT id, codigo, nome, descricao, cor, icone, ordem, ativo, permite_exclusao
                FROM kanban_colunas_pcp
                WHERE ativo = 1
                ORDER BY ordem ASC
            `);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[API_PCP] Erro ao listar colunas kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar colunas', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Listar todas as colunas (incluindo inativas) - para admin
    router.get('/kanban-colunas/todas', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT id, codigo, nome, descricao, cor, icone, ordem, ativo, permite_exclusao
                FROM kanban_colunas_pcp
                ORDER BY ordem ASC
            `);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[API_PCP] Erro ao listar todas colunas kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar colunas', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Criar nova coluna/etapa
    router.post('/kanban-colunas', async (req, res) => {
        const { codigo, nome, descricao, cor, icone } = req.body;
        console.log('[API_PCP] Criando nova coluna kanban:', nome);

        // AUDIT-FIX S7.5: Validar input
        if (!nome || typeof nome !== 'string' || nome.trim().length === 0 || nome.trim().length > 100) {
            return res.status(400).json({ success: false, message: 'Nome é obrigatório (máx 100 caracteres)' });
        }
        if (cor && !/^#[0-9a-fA-F]{6}$/.test(cor)) {
            return res.status(400).json({ success: false, message: 'Cor deve ser hexadecimal (#RRGGBB)' });
        }

        try {
            // Buscar próxima ordem
            const [[maxOrdem]] = await pool.query('SELECT MAX(ordem) as max FROM kanban_colunas_pcp');
            const novaOrdem = (maxOrdem.max || 0) + 1;

            // Gerar código único se não fornecido
            const codigoFinal = codigo || nome.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

            const [result] = await pool.query(`
                INSERT INTO kanban_colunas_pcp (codigo, nome, descricao, cor, icone, ordem, ativo, permite_exclusao)
                VALUES (?, ?, ?, ?, ?, ?, 1, 1)
            `, [codigoFinal, nome, descricao || '', cor || '#6b7280', icone || 'fa-circle', novaOrdem]);

            res.json({
                success: true,
                message: 'Coluna criada com sucesso',
                data: { id: result.insertId, codigo: codigoFinal, nome, ordem: novaOrdem }
            });
        } catch (error) {
            console.error('[API_PCP] Erro ao criar coluna kanban:', error.message);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, message: 'Já existe uma coluna com esse código' });
            }
            res.status(500).json({ success: false, message: 'Erro ao criar coluna', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Reordenar colunas (IMPORTANTE: deve vir ANTES das rotas com :id)
    router.put('/kanban-colunas/reordenar', async (req, res) => {
        const { ordem } = req.body; // Array de { id, ordem }
        console.log('[API_PCP] Reordenando colunas kanban');

        // AUDIT-FIX S7.1: Validar input + transaction
        if (!Array.isArray(ordem) || ordem.length === 0 || ordem.length > 100) {
            return res.status(400).json({ success: false, message: 'Dados de ordenação inválidos' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const item of ordem) {
                const id = parseInt(item.id);
                const pos = parseInt(item.ordem);
                if (!Number.isInteger(id) || !Number.isInteger(pos) || id <= 0) continue;
                await conn.query('UPDATE kanban_colunas_pcp SET ordem = ? WHERE id = ?', [pos, id]);
            }
            await conn.commit();
            res.json({ success: true, message: 'Colunas reordenadas com sucesso' });
        } catch (error) {
            await conn.rollback().catch(() => {});
            console.error('[API_PCP] Erro ao reordenar colunas:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao reordenar colunas', error: 'Erro interno no servidor. Tente novamente.' });
        } finally {
            conn.release();
        }
    });

    // Atualizar coluna/etapa
    router.put('/kanban-colunas/:id', async (req, res) => {
        const { id } = req.params;
        const { nome, descricao, cor, icone, ativo } = req.body;
        console.log('[API_PCP] Atualizando coluna kanban:', id);

        try {
            await pool.query(`
                UPDATE kanban_colunas_pcp
                SET nome = COALESCE(?, nome),
                    descricao = COALESCE(?, descricao),
                    cor = COALESCE(?, cor),
                    icone = COALESCE(?, icone),
                    ativo = COALESCE(?, ativo)
                WHERE id = ?
            `, [nome, descricao, cor, icone, ativo, id]);

            res.json({ success: true, message: 'Coluna atualizada com sucesso' });
        } catch (error) {
            console.error('[API_PCP] Erro ao atualizar coluna kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar coluna', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Excluir coluna/etapa
    router.delete('/kanban-colunas/:id', async (req, res) => {
        const { id } = req.params;
        console.log('[API_PCP] Excluindo coluna kanban:', id);

        try {
            // Verificar se permite exclusão
            const [[coluna]] = await pool.query('SELECT permite_exclusao, codigo FROM kanban_colunas_pcp WHERE id = ?', [id]);

            if (!coluna) {
                return res.status(404).json({ success: false, message: 'Coluna não encontrada' });
            }

            if (!coluna.permite_exclusao) {
                return res.status(400).json({ success: false, message: 'Esta coluna não pode ser excluída (é uma coluna do sistema)' });
            }

            // Verificar se há ordens nesta coluna
            const [[countOrdens]] = await pool.query('SELECT COUNT(*) as total FROM ordens_producao WHERE status = ?', [coluna.codigo]);

            if (countOrdens.total > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Não é possível excluir: existem ${countOrdens.total} ordens nesta etapa. Mova-as primeiro.`
                });
            }

            await pool.query('DELETE FROM kanban_colunas_pcp WHERE id = ?', [id]);

            res.json({ success: true, message: 'Coluna excluída com sucesso' });
        } catch (error) {
            console.error('[API_PCP] Erro ao excluir coluna kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao excluir coluna', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Excluir ordem de produção
    // AUDIT-FIX DB-003: Added transaction for safe cascading delete
    router.delete('/ordens-producao/:id', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Excluindo ordem de produção ${id}...`);
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();
            let deleted = false;

            // Excluir itens relacionados primeiro
            try {
                await connection.query('DELETE FROM itens_ordem_producao WHERE ordem_producao_id = ?', [id]);
            } catch (e) {
                console.log('[API_PCP] Tabela itens_ordem_producao não existe ou sem itens');
            }
            try { await connection.query('DELETE FROM tarefas_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM historico_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM anexos_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM apontamentos_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}

            // Tentar excluir de ordens_producao
            try {
                const [result] = await connection.query('DELETE FROM ordens_producao WHERE id = ?', [id]);
                if (result.affectedRows > 0) {
                    deleted = true;
                    console.log(`[API_PCP] Ordem ${id} excluída de ordens_producao`);
                }
            } catch (e) {
                console.log('[API_PCP] Erro ao excluir de ordens_producao:', e.message);
            }

            // Tentar excluir de ordens_producao_kanban também
            try {
                const [resultKanban] = await connection.query('DELETE FROM ordens_producao_kanban WHERE id = ?', [id]);
                if (resultKanban.affectedRows > 0) {
                    deleted = true;
                    console.log(`[API_PCP] Ordem ${id} excluída de ordens_producao_kanban`);
                }
            } catch (e) {
                console.log('[API_PCP] Tabela ordens_producao_kanban não existe');
            }

            if (deleted) {
                await connection.commit();
                res.json({ success: true, message: 'Ordem excluída com sucesso' });
            } else {
                await connection.rollback();
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            await connection.rollback();
            console.error('[API_PCP] Erro ao excluir ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao excluir ordem', error: 'Erro interno no servidor. Tente novamente.' });
        } finally {
            connection.release();
        }
    });

    // Salvar/atualizar ordem de produção
    router.put('/ordens-producao/:id', async (req, res) => {
        const { id } = req.params;
        const dados = req.body;
        console.log(`[API_PCP] Atualizando ordem de produção ${id}...`);

        try {
            const updateFields = [];
            const params = [];

            if (dados.data_prevista) {
                updateFields.push('data_prevista = ?');
                params.push(dados.data_prevista);
            }
            if (dados.observacoes !== undefined) {
                updateFields.push('observacoes = ?');
                params.push(dados.observacoes);
            }
            // Normaliza variações ("concluido"/"concluída") para o valor canônico usado
            // pelo fluxo do Kanban (mapKanbanToStatus) e pela baixa de estoque do Bloco K.
            let dbStatus = dados.status;
            if (dbStatus && ['concluido', 'concluída', 'concluido(a)'].includes(String(dbStatus).toLowerCase())) {
                dbStatus = 'concluida';
            }
            if (dbStatus) {
                updateFields.push('status = ?');
                params.push(dbStatus);
                if (dbStatus === 'concluida') {
                    updateFields.push('data_conclusao = NOW()');
                }
            }
            if (dados.responsavel) {
                updateFields.push('responsavel = ?');
                params.push(dados.responsavel);
            }
            if (dados.maquina) {
                updateFields.push('maquina = ?');
                params.push(dados.maquina);
            }
            if (dados.cliente) {
                updateFields.push('cliente = ?');
                params.push(dados.cliente);
            }
            if (dados.progresso !== undefined) {
                updateFields.push('progresso = ?');
                params.push(dados.progresso);
            }
            if (dados.produzido !== undefined || dados.quantidade_produzida !== undefined) {
                updateFields.push('quantidade_produzida = ?');
                params.push(dados.produzido !== undefined ? dados.produzido : dados.quantidade_produzida);
            }

            if (updateFields.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }

            // Se for concluir, verifica ANTES se já estava concluída — evita duplicar a baixa
            // de estoque e o avanço do pedido caso a mesma conclusão seja enviada de novo.
            let jaEstavaConcluida = false;
            if (dbStatus === 'concluida') {
                const [statusAtualRows] = await pool.query('SELECT status FROM ordens_producao WHERE id = ?', [id]);
                jaEstavaConcluida = statusAtualRows.length > 0 && statusAtualRows[0].status === 'concluida';
            }

            updateFields.push('updated_at = NOW()');
            params.push(id);

            const sql = `UPDATE ordens_producao SET ${updateFields.join(', ')} WHERE id = ?`;
            const [result] = await pool.query(sql, params);

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }

            if (dbStatus === 'concluida' && !jaEstavaConcluida) {
                // Mesmo comportamento do PUT /ordens-kanban/:id ao concluir: avança o pedido
                // vinculado no pipeline e registra a baixa de matéria-prima (K235/K270).
                const pipeConn = await pool.getConnection();
                try {
                    await pipeConn.beginTransaction();
                    const [opData] = await pipeConn.query('SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]);
                    if (opData.length > 0 && opData[0].pedido_id) {
                        const pedidoId = opData[0].pedido_id;
                        const [pedido] = await pipeConn.query('SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]);
                        if (pedido.length > 0 && pedido[0].status === 'pedido-aprovado') {
                            await pipeConn.query('UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?', [pedidoId]);
                            console.log(`[PIPELINE_AUTO] Pedido #${pedidoId} movido para "faturar" (OP #${id} concluída)`);
                        }
                    }
                    await pipeConn.commit();
                } catch (pipeErr) {
                    await pipeConn.rollback();
                    console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                } finally {
                    pipeConn.release();
                }

                registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                    console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                );
            }

            res.json({ success: true, message: 'Ordem atualizada com sucesso' });
        } catch (error) {
            console.error('[API_PCP] Erro ao atualizar ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar ordem', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Duplicar ordem de produção
    router.post('/ordens-producao/:id/duplicar', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Duplicando ordem de produção ${id}...`);

        try {
            // Buscar ordem original
            const [ordens] = await pool.query('SELECT * FROM ordens_producao WHERE id = ?', [id]);

            if (!ordens || ordens.length === 0) {
                return res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }

            const ordemOriginal = ordens[0];

            // Duplicações participam da mesma sequência oficial AAAA/NNNNN.
            const novoCodigo = await getNextOpCode(pool, new Date().getFullYear(), { lock: false });

            // Inserir cópia
            const [result] = await pool.query(`
                INSERT INTO ordens_producao
                (codigo, produto_nome, quantidade, unidade, status, prioridade, data_inicio, data_prevista, responsavel, maquina, observacoes, cliente)
                VALUES (?, ?, ?, ?, 'pendente', ?, CURDATE(), ?, ?, ?, ?, ?)
            `, [
                novoCodigo,
                ordemOriginal.produto_nome,
                ordemOriginal.quantidade,
                ordemOriginal.unidade,
                ordemOriginal.prioridade,
                ordemOriginal.data_prevista,
                ordemOriginal.responsavel,
                ordemOriginal.maquina,
                ordemOriginal.observacoes ? `[CÓPIA] ${ordemOriginal.observacoes}` : '[CÓPIA]',
                ordemOriginal.cliente
            ]);

            // Copiar itens se existirem
            try {
                const [itens] = await pool.query('SELECT * FROM itens_ordem_producao WHERE ordem_producao_id = ?', [id]);
                for (const item of itens) {
                    await pool.query(`
                        INSERT INTO itens_ordem_producao
                        (ordem_producao_id, material_id, codigo_material, descricao_material, quantidade_necessaria, unidade_medida, tipo_item, custo_unitario, local_estoque)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [result.insertId, item.material_id, item.codigo_material, item.descricao_material, item.quantidade_necessaria, item.unidade_medida, item.tipo_item, item.custo_unitario, item.local_estoque]);
                }
            } catch (e) {
                console.log('[API_PCP] Sem itens para copiar');
            }

            res.json({
                success: true,
                message: 'Ordem duplicada com sucesso',
                data: { id: result.insertId, codigo: novoCodigo }
            });
        } catch (error) {
            console.error('[API_PCP] Erro ao duplicar ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao duplicar ordem', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Concluir ordem de produção
    router.post('/ordens-producao/:id/concluir', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Concluindo ordem de produção ${id}...`);

        try {
            const [result] = await pool.query(`
                UPDATE ordens_producao
                SET status = 'concluida',
                    progresso = 100,
                    data_conclusao = NOW(),
                    data_finalizacao = NOW(),
                    updated_at = NOW()
                WHERE id = ?
            `, [id]);

            if (result.affectedRows > 0) {
                res.json({ success: true, message: 'Ordem concluída com sucesso' });
            } else {
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            console.error('[API_PCP] Erro ao concluir ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao concluir ordem', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Anexos da OP. A tela já oferecia listar/enviar/excluir, mas o GET antigo
    // consultava colunas que não existem (`tipo_arquivo` e `descricao`) e as duas
    // mutações nunca tinham sido implementadas.
    const anexosUploadRoot = uploadsRoot;
    const caminhoSeguroDeAnexo = (caminho) => {
        if (!caminho) return null;
        const resolved = path.resolve(String(caminho));
        return resolved.startsWith(`${anexosUploadRoot}${path.sep}`) ? resolved : null;
    };
    const apagarUploads = async (files) => {
        await Promise.all((files || []).map(async (file) => {
            const safePath = caminhoSeguroDeAnexo(file.path);
            if (safePath) await fs.promises.unlink(safePath).catch(() => {});
        }));
    };

    router.get('/ordens-producao/:id/anexos', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Ordem inválida' });
            }
            const [anexos] = await pool.query(`
                SELECT id,
                       nome_arquivo AS nome,
                       nome_arquivo AS filename,
                       tipo,
                       tipo AS extensao,
                       tamanho,
                       created_at,
                       CONCAT('/api/pcp/anexos/', id, '/download') AS url
                  FROM anexos_ordem_producao
                 WHERE ordem_producao_id = ?
                 ORDER BY created_at DESC
            `, [id]);
            return res.json({ success: true, data: anexos || [] });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar anexos:', error.message);
            return res.status(500).json({ success: false, message: 'Erro ao buscar anexos' });
        }
    });

    router.post('/ordens-producao/:id/anexos', upload.array('anexos', 10), async (req, res) => {
        const files = req.files || [];
        let connection;
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isSafeInteger(id) || id <= 0) {
                await apagarUploads(files);
                return res.status(400).json({ success: false, message: 'Ordem inválida' });
            }
            if (!files.length) {
                return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });
            }

            connection = await pool.getConnection();
            const [[ordem]] = await connection.query('SELECT id FROM ordens_producao WHERE id = ? LIMIT 1', [id]);
            if (!ordem) {
                await apagarUploads(files);
                return res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }

            await connection.beginTransaction();
            const anexos = [];
            for (const file of files) {
                const nome = path.basename(String(file.originalname || 'arquivo')).slice(0, 255);
                const [result] = await connection.query(
                    `INSERT INTO anexos_ordem_producao
                        (ordem_producao_id, nome_arquivo, caminho, tipo, tamanho, usuario_id)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, nome, path.resolve(file.path), file.mimetype, file.size, req.user?.id || null]
                );
                anexos.push({
                    id: result.insertId,
                    nome,
                    filename: nome,
                    tipo: file.mimetype,
                    tamanho: file.size,
                    url: `/api/pcp/anexos/${result.insertId}/download`
                });
            }
            await connection.commit();
            return res.status(201).json({ success: true, data: anexos });
        } catch (error) {
            if (connection) await connection.rollback().catch(() => {});
            await apagarUploads(files);
            console.error('[API_PCP] Erro ao enviar anexos:', error.message);
            return res.status(500).json({ success: false, message: 'Erro ao enviar anexos' });
        } finally {
            if (connection) connection.release();
        }
    });

    router.get('/anexos/:id/download', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Anexo inválido' });
            }
            const [[anexo]] = await pool.query(
                'SELECT nome_arquivo, caminho FROM anexos_ordem_producao WHERE id = ? LIMIT 1',
                [id]
            );
            if (!anexo) return res.status(404).json({ success: false, message: 'Anexo não encontrado' });
            const safePath = caminhoSeguroDeAnexo(anexo.caminho);
            if (!safePath || !fs.existsSync(safePath)) {
                return res.status(404).json({ success: false, message: 'Arquivo do anexo não encontrado' });
            }
            return res.download(safePath, path.basename(anexo.nome_arquivo || 'anexo'));
        } catch (error) {
            console.error('[API_PCP] Erro ao baixar anexo:', error.message);
            return res.status(500).json({ success: false, message: 'Erro ao baixar anexo' });
        }
    });

    router.delete('/anexos/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Anexo inválido' });
            }
            const [[anexo]] = await pool.query(
                'SELECT caminho FROM anexos_ordem_producao WHERE id = ? LIMIT 1',
                [id]
            );
            if (!anexo) return res.status(404).json({ success: false, message: 'Anexo não encontrado' });

            await pool.query('DELETE FROM anexos_ordem_producao WHERE id = ?', [id]);
            const safePath = caminhoSeguroDeAnexo(anexo.caminho);
            if (safePath) await fs.promises.unlink(safePath).catch(() => {});
            return res.json({ success: true, message: 'Anexo excluído' });
        } catch (error) {
            console.error('[API_PCP] Erro ao excluir anexo:', error.message);
            return res.status(500).json({ success: false, message: 'Erro ao excluir anexo' });
        }
    });

    // Buscar histórico de alterações de uma ordem
    router.get('/ordens-producao/:id/historico', async (req, res) => {
        const { id } = req.params;

        try {
            const [historico] = await pool.query(`
                SELECT id, usuario, acao, campo_alterado, valor_anterior, valor_novo, created_at
                FROM historico_ordem_producao
                WHERE ordem_producao_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `, [id]);

            res.json({ success: true, data: historico || [] });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar histórico:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar histórico', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Buscar tarefas de uma ordem
    router.get('/ordens-producao/:id/tarefas', async (req, res) => {
        const { id } = req.params;

        try {
            const [tarefas] = await pool.query(`
                SELECT id, titulo, descricao, responsavel, status, prioridade, data_prevista, data_conclusao, created_at
                FROM tarefas_ordem_producao
                WHERE ordem_producao_id = ?
                ORDER BY
                    CASE status WHEN 'em_andamento' THEN 1 WHEN 'pendente' THEN 2 ELSE 3 END,
                    prioridade DESC,
                    data_prevista ASC
            `, [id]);

            res.json({ success: true, data: tarefas || [] });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar tarefas:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar tarefas', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Criar tarefa para uma ordem
    router.post('/ordens-producao/:id/tarefas', async (req, res) => {
        const { id } = req.params;
        const { titulo, descricao, responsavel, prioridade, data_prevista } = req.body;

        try {
            const [result] = await pool.query(`
                INSERT INTO tarefas_ordem_producao
                (ordem_producao_id, titulo, descricao, responsavel, prioridade, data_prevista)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [id, titulo, descricao, responsavel, prioridade || 'media', data_prevista]);

            res.json({ success: true, message: 'Tarefa criada com sucesso', data: { id: result.insertId } });
        } catch (error) {
            console.error('[API_PCP] Erro ao criar tarefa:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao criar tarefa', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== ETIQUETAS DE PRODUÇÃO ===================

    // Gerar etiqueta de Bobina usando template Excel
    // Dados de UM produto da OP para a etiqueta (bobina / identificação de produto).
    // Sem `item_numero` devolve null e as rotas seguem no comportamento antigo, que
    // lia só o cabeçalho e adivinhava a cor varrendo o nome do produto.
    async function dadosEtiquetaDoItem(ordemId, itemNumero) {
        const numero = parseInt(itemNumero, 10);
        if (!Number.isFinite(numero) || numero <= 0) return null;
        try {
            const resultado = await produtosDaOrdem(ordemId);
            if (!resultado) return null;
            const item = resultado.itens.find(i => Number(i.item_numero) === numero);
            if (!item) return null;
            // A etiqueta acompanha o que saiu da máquina; sem apontamento, o pedido.
            const quantidade = item.quantidade_produzida > 0 ? item.quantidade_produzida : item.quantidade;
            return {
                item_numero: item.item_numero,
                codigo: item.codigo,
                descricao: item.descricao,
                cores: item.codigo_cores,
                lote: item.lote,
                embalagem: item.embalagem,
                lances: item.lances,
                unidade: item.unidade,
                quantidade,
                peso_liquido: item.peso_liquido,
                peso_bruto: item.peso_bruto,
                observacao: item.observacao
            };
        } catch (e) {
            console.warn('[ETIQUETA] Não consegui ler o item da OP:', e.message);
            return null;
        }
    }

    router.get('/ordens-producao/:id/etiqueta-bobina', async (req, res) => {
        const { id } = req.params;
        const { formato = 'excel', cor1 = '', quantidade_etiquetas = '1' } = req.query;
        const qtdEtiquetas = parseInt(quantidade_etiquetas) || 1;
        const ExcelJS = require('exceljs');
        const path = require('path');

        try {
            // Buscar dados da ordem de produção
            const [[ordem]] = await pool.query(`
                SELECT op.*, p.razao_social as cliente_nome, p.nome_fantasia as cliente_fantasia
                FROM ordens_producao op
                LEFT JOIN clientes p ON op.cliente COLLATE utf8mb4_general_ci = p.razao_social COLLATE utf8mb4_general_ci
                WHERE op.id = ?
            `, [id]);

            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }

            // Carregar template Excel preenchido como base
            const templatePath = path.join(__dirname, '..', 'modules', 'PCP', 'Etiquetas', 'Bobinas.xlsx');
            const workbook = new ExcelJS.Workbook();

            try {
                await workbook.xlsx.readFile(templatePath);
            } catch (e) {
                console.error('[ETIQUETA_BOBINA] Template não encontrado:', templatePath);
                return res.status(500).json({ success: false, message: 'Template de etiqueta não encontrado' });
            }

            const worksheet = workbook.worksheets[0];

            // Extrair código do cabo (número) do produto
            const produto = ordem.produto_nome || '';
            let codigoCabo = '-';
            const matchCabo = produto.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|MM)/i);
            if (matchCabo) {
                codigoCabo = matchCabo[1].replace(',', '.');
            } else {
                // Tentar extrair primeiro número do produto
                const numMatch = produto.match(/\b(\d+)\b/);
                if (numMatch) codigoCabo = numMatch[1];
            }

            // Extrair cor do produto (usar cor1 do query param se fornecida)
            let cor = cor1 || '';
            if (!cor) {
                const coresMap = {
                    'PRETO': 'PT', 'CINZA': 'CZ', 'VERMELHO': 'VM', 'AZUL': 'AZ',
                    'VERDE': 'VD', 'AMARELO': 'AM', 'BRANCO': 'BR', 'MARROM': 'MR',
                    'LARANJA': 'LJ', 'NEUTRO': 'NÚ', 'NU': 'NÚ'
                };
                for (const [nome, abrev] of Object.entries(coresMap)) {
                    if (produto.toUpperCase().includes(nome)) {
                        cor = abrev;
                        break;
                    }
                }
            }

            // Dados para preencher. Com `item_numero`, tudo que a aba "Produtos do
            // Pedido" mantém por item (lote, cores, pesos, produzido) manda sobre o
            // cabeçalho da OP — é o dado que o chão de fábrica realmente apontou.
            const itemEtiqueta = await dadosEtiquetaDoItem(id, req.query.item_numero);
            const dataAtual = new Date();
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '.');
            const lote = (itemEtiqueta && itemEtiqueta.lote) || `EX75 ${dataFormatada}`; // Formato: EX75 03.02.2026
            const quantidade = (itemEtiqueta && itemEtiqueta.quantidade) || parseFloat(ordem.quantidade) || 0;
            const unidade = (itemEtiqueta && itemEtiqueta.unidade) || ordem.unidade || 'METROS';
            const cliente = ordem.cliente || ordem.cliente_nome || 'Estoque';
            const numeroPedido = ordem.numero_pedido || '-';
            const pesoBruto = (itemEtiqueta && itemEtiqueta.peso_bruto) || parseFloat(ordem.peso_bruto) || 0;
            const pesoLiquido = (itemEtiqueta && itemEtiqueta.peso_liquido) || parseFloat(ordem.peso_liquido) || 0;
            const dimensaoBobina = (itemEtiqueta && itemEtiqueta.embalagem === 'Bobina' && itemEtiqueta.lances)
                ? itemEtiqueta.lances
                : (ordem.dimensao_bobina || '0,80x0,45');
            if (itemEtiqueta) {
                if (itemEtiqueta.codigo) codigoCabo = itemEtiqueta.codigo;
                if (!cor && itemEtiqueta.cores) cor = itemEtiqueta.cores;
            }

            // ============== MAPEAMENTO CORRETO BASEADO NO TEMPLATE PREENCHIDO ==============
            // C2: "CABO: 70"
            worksheet.getCell('C2').value = `CABO: ${codigoCabo}`;

            // F2: "  Nº  PEDIDO  236"
            worksheet.getCell('F2').value = `  Nº  PEDIDO  ${numeroPedido}`;

            // B5: "500               METROS"
            worksheet.getCell('B5').value = `${quantidade}               ${unidade}`;

            // F5: "CLIENTE:    VALTER ARAUJO NUNES"
            worksheet.getCell('F5').value = `CLIENTE:    ${cliente}`;

            // C8: Cores marcadas - manter template ou marcar a cor atual
            // As cores ficam no formato ( PT ) ( CZ ) ( VM ) ( AZ ) ( NÚ )
            // Vamos destacar a cor selecionada se houver
            if (cor) {
                const coresTexto = `( ${cor === 'PT' ? '●PT' : 'PT'} ) ( ${cor === 'CZ' ? '●CZ' : 'CZ'} ) ( ${cor === 'VM' ? '●VM' : 'VM'} ) ( ${cor === 'AZ' ? '●AZ' : 'AZ'} ) ( ${cor === 'NÚ' ? '●NÚ' : 'NÚ'} )`;
                worksheet.getCell('C8').value = coresTexto;
            }

            // B12: "PESO BRUTO: " (label) - D12: valor
            worksheet.getCell('B12').value = 'PESO BRUTO: ';
            worksheet.getCell('D12').value = pesoBruto || '';

            // G12: "BOBINA: " (label) - H12: dimensão
            worksheet.getCell('G12').value = 'BOBINA: ';
            worksheet.getCell('H12').value = dimensaoBobina;

            // B15: "PESO LIQUIDO: " (label) - D15: valor
            worksheet.getCell('B15').value = 'PESO LIQUIDO: ';
            worksheet.getCell('D15').value = pesoLiquido || '';

            // G15: "LOTE:" (label) - H15: lote
            worksheet.getCell('G15').value = 'LOTE:';
            worksheet.getCell('H15').value = lote;

            // Se formato for PDF, converter Excel para PDF
            if (formato === 'pdf') {
                const PDFDocument = require('pdfkit');
                const doc = new PDFDocument({
                    size: 'A6',
                    layout: 'landscape',
                    margin: 20
                });

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename=Etiqueta_Bobina_${lote.replace(/\s/g, '_')}.pdf`);
                doc.pipe(res);

                // Desenhar etiqueta de bobina
                const w = 380, h = 250;
                doc.rect(10, 10, w, h).stroke();

                // Título CABO
                doc.fontSize(16).font('Helvetica-Bold').text(`CABO: ${codigoCabo}`, 30, 25);
                doc.fontSize(12).text(`Nº PEDIDO  ${numeroPedido}`, 200, 28);

                // Quantidade
                doc.fontSize(20).font('Helvetica-Bold').text(`${quantidade}`, 30, 60);
                doc.fontSize(14).text(unidade, 120, 65);

                // Cliente
                doc.fontSize(11).font('Helvetica').text(`CLIENTE: ${cliente}`, 200, 60);

                // Cores
                doc.fontSize(10).text(`( PT ) ( CZ ) ( VM ) ( AZ ) ( NÚ )`, 80, 100);
                if (cor) {
                    // Destacar cor selecionada
                    doc.fontSize(10).font('Helvetica-Bold');
                }

                // Linha divisória
                doc.moveTo(20, 130).lineTo(380, 130).stroke();

                // Peso Bruto e Bobina
                doc.fontSize(10).font('Helvetica').text('PESO BRUTO:', 30, 145);
                doc.font('Helvetica-Bold').text(`${pesoBruto}`, 110, 145);
                doc.font('Helvetica').text('BOBINA:', 220, 145);
                doc.font('Helvetica-Bold').text(dimensaoBobina, 275, 145);

                // Peso Líquido e Lote
                doc.font('Helvetica').text('PESO LIQUIDO:', 30, 175);
                doc.font('Helvetica-Bold').text(`${pesoLiquido}`, 115, 175);
                doc.font('Helvetica').text('LOTE:', 220, 175);
                doc.font('Helvetica-Bold').text(lote, 260, 175);

                doc.end();
                return;
            }

            // Retornar Excel
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=Etiqueta_Bobina_${lote.replace(/\s/g, '_')}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error('[ETIQUETA_BOBINA] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar etiqueta', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Gerar etiqueta de Identificação de Produto usando template Excel
    router.get('/ordens-producao/:id/etiqueta-produto', async (req, res) => {
        const { id } = req.params;
        const { formato = 'excel', cor1 = '', cor2 = '', quantidade_etiquetas = '4' } = req.query;
        const qtdEtiquetas = parseInt(quantidade_etiquetas) || 4; // 1, 2, 4 ou 6
        const ExcelJS = require('exceljs');
        const path = require('path');

        try {
            // Buscar dados da ordem de produção
            const [[ordem]] = await pool.query(`
                SELECT op.*, p.razao_social as cliente_nome
                FROM ordens_producao op
                LEFT JOIN clientes p ON op.cliente COLLATE utf8mb4_general_ci = p.razao_social COLLATE utf8mb4_general_ci
                WHERE op.id = ?
            `, [id]);

            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }

            // Carregar template Excel - tentar múltiplos nomes de arquivo
            const fs = require('fs');
            const possibleNames = [
                'Identificacao_Produto_Template.xlsx',
                'Indentificação de Produto.xlsx',
                'Indentificacao de Produto.xlsx',
                'Identificacao_Produto_4x.xlsx',
                'Identificacao_Produto.xlsx',
                'identificacao_produto.xlsx'
            ];

            let templatePath = null;
            const etiquetasDir = path.join(__dirname, '..', 'modules', 'PCP', 'Etiquetas');

            for (const name of possibleNames) {
                const testPath = path.join(etiquetasDir, name);
                if (fs.existsSync(testPath)) {
                    templatePath = testPath;
                    console.log('[ETIQUETA_PRODUTO] Template encontrado:', templatePath);
                    break;
                }
            }

            if (!templatePath) {
                console.error('[ETIQUETA_PRODUTO] Nenhum template encontrado em:', etiquetasDir);
                const files = fs.readdirSync(etiquetasDir);
                console.error('[ETIQUETA_PRODUTO] Arquivos disponíveis:', files);
                return res.status(500).json({ success: false, message: 'Template de etiqueta não encontrado' });
            }

            const workbook = new ExcelJS.Workbook();

            try {
                await workbook.xlsx.readFile(templatePath);
            } catch (e) {
                console.error('[ETIQUETA_PRODUTO] Template não encontrado:', templatePath);
                return res.status(500).json({ success: false, message: 'Template de etiqueta não encontrado' });
            }

            const worksheet = workbook.worksheets[0];

            // Extrair código do cabo (número) do produto
            const produto = ordem.produto_nome || '';
            let codigoCabo = '-';
            const matchCabo = produto.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|MM)/i);
            if (matchCabo) {
                codigoCabo = matchCabo[1].replace(',', '.');
            } else {
                const numMatch = produto.match(/\b(\d+)\b/);
                if (numMatch) codigoCabo = numMatch[1];
            }

            // Extrair cor do produto se não informada
            let corProduto = cor1 || '';
            if (!corProduto) {
                const coresMap = {
                    'PRETO': 'PT', 'CINZA': 'CZ', 'VERMELHO': 'VM', 'AZUL': 'AZ',
                    'VERDE': 'VD', 'AMARELO': 'AM', 'BRANCO': 'BR', 'MARROM': 'MR',
                    'LARANJA': 'LJ', 'NEUTRO': 'NÚ', 'NU': 'NÚ'
                };
                for (const [nome, abrev] of Object.entries(coresMap)) {
                    if (produto.toUpperCase().includes(nome)) {
                        corProduto = abrev;
                        break;
                    }
                }
            }
            // Com `item_numero`, lote/cor/quantidade/descrição saem do produto da OP
            // (aba "Produtos do Pedido") em vez de serem adivinhados no cabeçalho.
            const itemEtiqueta = await dadosEtiquetaDoItem(id, req.query.item_numero);
            if (itemEtiqueta) {
                if (itemEtiqueta.codigo) codigoCabo = itemEtiqueta.codigo;
                if (!corProduto && itemEtiqueta.cores) corProduto = itemEtiqueta.cores;
            }
            const corEtiqueta2 = cor2 || corProduto;

            // Dados para preencher
            const dataAtual = new Date();
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '.');
            const lote = (itemEtiqueta && itemEtiqueta.lote) || `EX75 ${dataFormatada}`;
            const quantidade = (itemEtiqueta && itemEtiqueta.quantidade) || parseFloat(ordem.quantidade) || 0;
            const unidade = (itemEtiqueta && itemEtiqueta.unidade) || ordem.unidade || 'METROS';
            const cliente = ordem.cliente || ordem.cliente_nome || 'Estoque';
            const numeroPedido = ordem.numero_pedido || '-';
            const observacoes = (itemEtiqueta && itemEtiqueta.observacao) || ordem.observacoes || '';

            // ============== MAPEAMENTO PARA TEMPLATE "Indentificação de Produto.xlsx" ==============
            // Template com 4 etiquetas em formato 2x2:
            // - Etiquetas 1 e 2: Linhas 1-16 (superior)
            // - Etiquetas 3 e 4: Linhas 18-33 (inferior)
            // - Colunas A-G (1-7) para etiquetas esquerda
            // - Colunas I-O (9-15) para etiquetas direita
            //
            // Estrutura de cada etiqueta:
            // - LOTE: B (col 2 ou 10) | COR: F (col 6 ou 14)
            // - CABO: B (col 2 ou 10) | Nº PEDIDO: E (col 5 ou 13)
            // - QUANT: B (col 2 ou 10)
            // - CLIENTE: B (col 2 ou 10)
            // - OBS: B (col 2 ou 10)

            // Função para preencher uma etiqueta baseado na posição
            const preencherEtiquetaTemplate = (baseRow, baseCol, numEtiqueta, corUsada) => {
                // baseCol: 1 para esquerda (A), 9 para direita (I)
                const col = (offset) => baseCol + offset;

                try {
                    // LOTE (linha 3 relativa = baseRow + 2)
                    worksheet.getRow(baseRow + 2).getCell(col(1)).value = lote;

                    // COR (linha 3 relativa, coluna +5)
                    worksheet.getRow(baseRow + 2).getCell(col(5)).value = corUsada;

                    // CABO (linha 5 relativa = baseRow + 4)
                    worksheet.getRow(baseRow + 4).getCell(col(1)).value = codigoCabo;

                    // Nº PEDIDO (linha 5 relativa, coluna +4)
                    worksheet.getRow(baseRow + 4).getCell(col(4)).value = numeroPedido;

                    // QUANT (linha 8 relativa = baseRow + 7)
                    worksheet.getRow(baseRow + 7).getCell(col(1)).value = quantidade;

                    // CLIENTE (linha 11 relativa = baseRow + 10)
                    worksheet.getRow(baseRow + 10).getCell(col(1)).value = cliente;

                    // OBS (linha 14 relativa = baseRow + 13)
                    worksheet.getRow(baseRow + 13).getCell(col(1)).value = observacoes || '';

                    console.log('[ETIQUETA] Etiqueta', numEtiqueta, 'preenchida - LOTE:', lote, 'COR:', corUsada, 'CABO:', codigoCabo);
                } catch (e) {
                    console.log('[ETIQUETA] Erro ao preencher etiqueta', numEtiqueta, ':', e.message);
                }
            };

            // -------- PREENCHER ETIQUETAS CONFORME QUANTIDADE SELECIONADA --------
            const totalRows = worksheet.rowCount;
            console.log('[ETIQUETA] Template tem', totalRows, 'linhas, quantidade solicitada:', qtdEtiquetas);

            // Etiqueta 1 - Superior Esquerda (base: linha 1, coluna A=1)
            if (qtdEtiquetas >= 1) {
                preencherEtiquetaTemplate(1, 1, 1, corProduto);
            }

            // Etiqueta 2 - Superior Direita (base: linha 1, coluna I=9)
            if (qtdEtiquetas >= 2) {
                preencherEtiquetaTemplate(1, 9, 2, corEtiqueta2);
            }

            // Se o template tiver mais de 20 linhas, preencher etiquetas 3 e 4
            if (totalRows > 20) {
                // Etiqueta 3 - Inferior Esquerda (base: linha 18, coluna A=1)
                if (qtdEtiquetas >= 3) {
                    preencherEtiquetaTemplate(18, 1, 3, corProduto);
                }

                // Etiqueta 4 - Inferior Direita (base: linha 18, coluna I=9)
                if (qtdEtiquetas >= 4) {
                    preencherEtiquetaTemplate(18, 9, 4, corEtiqueta2);
                }
            }

            // Se formato for PDF, converter Excel para PDF (layout replica o template Excel: logo + QR por etiqueta)
            if (formato === 'pdf') {
                const PDFDocument = require('pdfkit');
                const fsSync = require('fs');
                const doc = new PDFDocument({
                    size: 'A5',
                    layout: 'landscape',
                    margin: 15
                });

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename=Etiqueta_Produto_${lote.replace(/\s/g, '_')}.pdf`);
                doc.pipe(res);

                const assetsDir = path.join(__dirname, '..', 'modules', 'PCP', 'Etiquetas', 'assets');
                const logoPath = path.join(assetsDir, 'logo-circulo.png');
                const qrPath = path.join(assetsDir, 'qrcode-etiqueta.png');
                const temLogo = fsSync.existsSync(logoPath);
                const temQr = fsSync.existsSync(qrPath);

                // Função para desenhar uma etiqueta (espelha o template Excel: título+logo, campos, QR)
                const desenharEtiqueta = (x, y, cor) => {
                    const w = 250, h = 170;

                    // Borda
                    doc.rect(x, y, w, h).stroke();

                    // Título + logo circular (topo direito)
                    doc.fontSize(10).font('Helvetica-Bold')
                       .text('IDENTIFICAÇÃO DE PRODUTO', x + 8, y + 9, { width: w - 45 });
                    if (temLogo) doc.image(logoPath, x + w - 32, y + 6, { width: 24, height: 24 });

                    // Linha
                    doc.moveTo(x + 5, y + 30).lineTo(x + w - 5, y + 30).stroke();

                    // LOTE e COR
                    doc.fontSize(8).font('Helvetica-Bold').text('LOTE:', x + 8, y + 38);
                    doc.font('Helvetica').fontSize(9).text(lote, x + 35, y + 37, { width: 115 });
                    doc.font('Helvetica-Bold').fontSize(8).text('COR', x + 160, y + 38);
                    doc.font('Helvetica').fontSize(9).text(cor || '-', x + 186, y + 37);

                    // CABO e Nº PEDIDO
                    doc.font('Helvetica-Bold').fontSize(8).text('CABO', x + 8, y + 58);
                    doc.font('Helvetica').fontSize(13).text(codigoCabo, x + 45, y + 55);
                    doc.font('Helvetica-Bold').fontSize(8).text('Nº PEDIDO', x + 130, y + 58);
                    doc.font('Helvetica').fontSize(11).text(numeroPedido, x + 190, y + 56);

                    // QUANTIDADE
                    doc.font('Helvetica-Bold').fontSize(8).text('QUANT:', x + 8, y + 82);
                    doc.font('Helvetica').fontSize(15).text(String(quantidade), x + 50, y + 78);
                    doc.fontSize(9).text(unidade, x + 120, y + 83);

                    // CLIENTE
                    doc.font('Helvetica-Bold').fontSize(8).text('CLIENTE', x + 8, y + 105);
                    doc.font('Helvetica').fontSize(9).text(cliente.substring(0, 40), x + 8, y + 117, { width: w - 70 });

                    // OBS
                    doc.font('Helvetica-Bold').fontSize(8).text('OBS:', x + 8, y + 142);
                    if (observacoes) {
                        doc.font('Helvetica').fontSize(7).text(observacoes.substring(0, 45), x + 30, y + 142, { width: w - 90 });
                    }

                    // QR code (rodapé direito)
                    if (temQr) doc.image(qrPath, x + w - 38, y + h - 38, { width: 32, height: 32 });
                };

                // Desenhar etiquetas conforme quantidade solicitada
                const posicoes = [
                    { x: 15, y: 15 },    // Superior Esquerda
                    { x: 285, y: 15 },   // Superior Direita
                    { x: 15, y: 200 },   // Inferior Esquerda
                    { x: 285, y: 200 },  // Inferior Direita
                    { x: 15, y: 385 },   // Página 2 Superior Esquerda (para 5+)
                    { x: 285, y: 385 }   // Página 2 Superior Direita (para 6)
                ];

                for (let i = 0; i < Math.min(qtdEtiquetas, posicoes.length); i++) {
                    if (i === 4) doc.addPage(); // Nova página para 5ª e 6ª etiqueta
                    const pos = i < 4 ? posicoes[i] : { x: posicoes[i - 4].x, y: posicoes[i - 4].y };
                    const corEtq = i % 2 === 0 ? corProduto : corEtiqueta2;
                    desenharEtiqueta(pos.x, pos.y, corEtq);
                }

                doc.end();
                return;
            }

            // Retornar Excel
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=Etiqueta_Produto_${lote.replace(/\s/g, '_')}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error('[ETIQUETA_PRODUTO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar etiqueta', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Gerar etiqueta de Identificação de Produto em PDF para visualização (rota legado)
    router.get('/ordens-producao/:id/etiqueta-produto-pdf', async (req, res) => {
        const { id } = req.params;
        const { cor1 = '', cor2 = '' } = req.query;
        const PDFDocument = require('pdfkit');

        try {
            // Buscar dados da ordem de produção
            const [[ordem]] = await pool.query(`
                SELECT op.*, p.razao_social as cliente_nome
                FROM ordens_producao op
                LEFT JOIN clientes p ON op.cliente COLLATE utf8mb4_general_ci = p.razao_social COLLATE utf8mb4_general_ci
                WHERE op.id = ?
            `, [id]);

            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }

            // Extrair código do cabo (número) do produto
            const produto = ordem.produto_nome || '';
            let codigoCabo = '-';
            const matchCabo = produto.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|MM)/i);
            if (matchCabo) {
                codigoCabo = matchCabo[1].replace(',', '.');
            } else {
                const numMatch = produto.match(/\b(\d+)\b/);
                if (numMatch) codigoCabo = numMatch[1];
            }

            // Extrair cor do produto se não informada
            let corProduto = cor1 || '';
            if (!corProduto) {
                const coresMap = {
                    'PRETO': 'PT', 'CINZA': 'CZ', 'VERMELHO': 'VM', 'AZUL': 'AZ',
                    'VERDE': 'VD', 'AMARELO': 'AM', 'BRANCO': 'BR', 'MARROM': 'MR',
                    'LARANJA': 'LJ', 'NEUTRO': 'NÚ', 'NU': 'NÚ'
                };
                for (const [nome, abrev] of Object.entries(coresMap)) {
                    if (produto.toUpperCase().includes(nome)) {
                        corProduto = abrev;
                        break;
                    }
                }
            }
            const corEtiqueta2 = cor2 || corProduto;

            // Dados para preencher
            const dataAtual = new Date();
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '.');
            const lote = `EX75 ${dataFormatada}`;
            const quantidade = parseFloat(ordem.quantidade) || 0;
            const unidade = ordem.unidade || 'METROS';
            const cliente = ordem.cliente || ordem.cliente_nome || 'Estoque';
            const observacoes = ordem.observacoes || '';
            const numeroPedido = ordem.numero_pedido || '-';

            // Criar PDF com duas etiquetas lado a lado
            const doc = new PDFDocument({
                size: 'A5',
                layout: 'landscape',
                margin: 15
            });

            // Configurar headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=Etiqueta_Produto_${lote.replace(/\s/g, '_')}.pdf`);

            doc.pipe(res);

            // Função para desenhar uma etiqueta
            const desenharEtiqueta = (x, y, num, cor) => {
                const w = 250, h = 170;

                // Borda
                doc.rect(x, y, w, h).stroke();

                // Título
                doc.fontSize(10).font('Helvetica-Bold')
                   .text('IDENTIFICAÇÃO DE PRODUTO', x + 10, y + 8, { width: w - 40 });
                doc.fontSize(12).text(num, x + w - 25, y + 5);

                // Linha
                doc.moveTo(x + 5, y + 25).lineTo(x + w - 5, y + 25).stroke();

                // LOTE e COR
                doc.fontSize(9).font('Helvetica-Bold').text('LOTE:', x + 10, y + 32);
                doc.font('Helvetica').text(lote, x + 45, y + 32);
                doc.font('Helvetica-Bold').text('COR', x + 160, y + 32);
                doc.font('Helvetica').fontSize(10).text(cor, x + 190, y + 32);

                // CABO e PEDIDO
                doc.fontSize(9).font('Helvetica-Bold').text('CABO', x + 10, y + 55);
                doc.font('Helvetica').fontSize(14).text(codigoCabo, x + 50, y + 52);
                doc.fontSize(9).font('Helvetica-Bold').text('Nº PEDIDO', x + 130, y + 55);
                doc.font('Helvetica').fontSize(12).text(numeroPedido, x + 195, y + 52);

                // QUANTIDADE
                doc.fontSize(9).font('Helvetica-Bold').text('QUANT:', x + 10, y + 80);
                doc.font('Helvetica').fontSize(16).text(quantidade, x + 55, y + 77);
                doc.fontSize(10).text(unidade, x + 150, y + 80);

                // CLIENTE
                doc.fontSize(9).font('Helvetica-Bold').text('CLIENTE', x + 10, y + 105);
                doc.font('Helvetica').fontSize(9).text(cliente.substring(0, 35), x + 10, y + 118, { width: w - 20 });

                // OBS
                doc.fontSize(8).font('Helvetica-Bold').text('OBS:', x + 10, y + 140);
                if (observacoes) {
                    doc.font('Helvetica').fontSize(7).text(observacoes.substring(0, 50), x + 35, y + 140, { width: w - 50 });
                }
            };

            // Desenhar as 4 etiquetas (2x2)
            // Linha superior
            desenharEtiqueta(15, 15, '1', corProduto);
            desenharEtiqueta(285, 15, '2', corProduto);
            // Linha inferior
            desenharEtiqueta(15, 200, '3', corProduto);
            desenharEtiqueta(285, 200, '4', corProduto);

            // Data no rodapé
            doc.fontSize(7).font('Helvetica')
               .text(`Gerado em: ${dataAtual.toLocaleDateString('pt-BR')}`, 400, 385);

            doc.end();

        } catch (error) {
            console.error('[ETIQUETA_PRODUTO_PDF] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar PDF', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== MULTIPLEXADO (PRODUÇÃO CABOS) ===================

    // Salvar ordem multiplexado
    router.post('/multiplexado', async (req, res) => {
        try {
            const dados = req.body;

            // Inserir dados
            const sql = `
                INSERT INTO ordens_multiplexado
                (numero_op, cliente, produtos, extrusora, time_producao, previsao_producao,
                 bobinas, qtd_bobinas, metragem, peso_bruto, peso_liquido, al_kg,
                 cores, secao, veias, semana, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const produtosJson = dados.produtos ? JSON.stringify(dados.produtos) : null;

            const [result] = await pool.query(sql, [
                dados.numero_op || null,
                dados.cliente || null,
                produtosJson,
                dados.extrusora || null,
                dados.time_producao || null,
                dados.previsao_producao || null,
                dados.bobinas || null,
                dados.qtd_bobinas || 0,
                dados.metragem || 0,
                dados.peso_bruto || 0,
                dados.peso_liquido || 0,
                dados.al_kg || 0,
                dados.cores || null,
                dados.secao || null,
                dados.veias || 0,
                dados.semana || null,
                dados.observacoes || null
            ]);

            console.log('[API_MULTIPLEXADO] Ordem multiplexado salva com sucesso, ID:', result.insertId);
            res.status(201).json({
                success: true,
                message: 'Dados multiplexado salvos com sucesso!',
                id: result.insertId
            });

        } catch (error) {
            console.error('[API_MULTIPLEXADO] Erro:', error && error.message ? error.message : error);
            res.status(500).json({
                success: false,
                message: 'Erro ao salvar dados multiplexado',
                error: 'Erro interno no servidor. Tente novamente.'
            });
        }
    });

    // Listar ordens multiplexado
    router.get('/multiplexado', async (req, res) => {
        try {
            // Verificar se tabela existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'ordens_multiplexado'");

            if (!tables || tables.length === 0) {
                return res.json([]);
            }

            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM ordens_multiplexado');
            // A tabela nunca teve `numero_ordem`, `produto` nem `quantidade`: os nomes reais
            // são numero_op, produtos (JSON) e metragem/qtd_bobinas. O SELECT antigo estourava
            // "Unknown column 'numero_ordem'" e a rota devolvia 500 em qualquer chamada.
            // Os aliases preservam os nomes que um consumidor antigo esperaria.
            const [rows] = await pool.query(`
                SELECT id,
                       numero_op, numero_op AS numero_ordem,
                       cliente,
                       produtos, produtos AS produto,
                       metragem, metragem AS quantidade,
                       qtd_bobinas, peso_liquido, extrusora, secao, veias, semana,
                       status, observacoes, created_at, updated_at
                FROM ordens_multiplexado
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });

        } catch (error) {
            console.error('[API_MULTIPLEXADO] Erro ao listar:', error && error.message ? error.message : error);
            res.status(500).json({ message: 'Erro ao buscar dados multiplexado' });
        }
    });

    // =================== COMPOSIÇÃO DE CABOS (Peso por Material) ===================

    // Buscar composição de um cabo pelo código
    router.get('/cabos-composicao/:codigo', async (req, res) => {
        try {
            const { codigo } = req.params;

            let [rows] = await pool.query(`
                SELECT
                    codigo,
                    descricao,
                    cores,
                    bitola,
                    peso_aluminio_kg_m,
                    peso_pe_kg_m,
                    peso_xlpe_kg_m,
                    peso_xlpe_at_kg_m,
                    peso_hepr_kg_m,
                    peso_pvc_kg_m,
                    peso_mb_pvc_kg_m,
                    peso_mbuvpe_kg_m,
                    peso_mbuvpt_kg_m,
                    peso_mbpeam_kg_m,
                    peso_mbpevd_kg_m,
                    peso_mbpeaz_kg_m,
                    peso_mbpebc_kg_m,
                    peso_mbpelj_kg_m,
                    peso_mbpemr_kg_m,
                    peso_mbpvccz_kg_m,
                    peso_mbpvcpt_kg_m,
                    peso_mbuvcz_kg_m,
                    peso_mbuvaz_kg_m,
                    peso_mbuvvm_kg_m,
                    peso_total_kg_m
                FROM cabos_composicao
                WHERE codigo = ? AND ativo = 1
            `, [codigo]);

            // Fallback: se não encontrou, tentar sem sufixo de variação (ex: C=Compacto, R=Redondo)
            if (rows.length === 0 && /[A-Z]$/i.test(codigo)) {
                const codigoBase = codigo.replace(/[A-Z]$/i, '');
                [rows] = await pool.query(`
                    SELECT codigo, descricao, cores, bitola,
                        peso_aluminio_kg_m, peso_pe_kg_m, peso_xlpe_kg_m, peso_xlpe_at_kg_m,
                        peso_hepr_kg_m, peso_pvc_kg_m, peso_mb_pvc_kg_m, peso_mbuvpe_kg_m,
                        peso_mbuvpt_kg_m, peso_mbpeam_kg_m, peso_mbpevd_kg_m, peso_mbpeaz_kg_m,
                        peso_mbpebc_kg_m, peso_mbpelj_kg_m, peso_mbpemr_kg_m, peso_mbpvccz_kg_m,
                        peso_mbpvcpt_kg_m, peso_mbuvcz_kg_m, peso_mbuvaz_kg_m, peso_mbuvvm_kg_m,
                        peso_total_kg_m
                    FROM cabos_composicao WHERE codigo = ? AND ativo = 1
                `, [codigoBase]);
            }

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Composição não encontrada para o código: ${codigo}`
                });
            }

            const cabo = rows[0];

            // Retornar com cálculos em gramas também
            res.json({
                success: true,
                data: {
                    ...cabo,
                    peso_aluminio_g_m: parseFloat(cabo.peso_aluminio_kg_m) * 1000,
                    peso_pe_g_m: parseFloat(cabo.peso_pe_kg_m) * 1000,
                    peso_xlpe_g_m: parseFloat(cabo.peso_xlpe_kg_m) * 1000,
                    peso_pvc_g_m: parseFloat(cabo.peso_pvc_kg_m) * 1000,
                    peso_total_g_m: parseFloat(cabo.peso_total_kg_m) * 1000
                }
            });

        } catch (error) {
            console.error('[API_COMPOSICAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar composição', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Calcular materiais necessários para uma ordem de produção
    router.post('/cabos-composicao/calcular', async (req, res) => {
        try {
            const { codigo, metragem } = req.body;

            if (!codigo || !metragem) {
                return res.status(400).json({
                    success: false,
                    message: 'Código do produto e metragem são obrigatórios'
                });
            }

            const metros = parseFloat(metragem);

            // Buscar composição
            let [rows] = await pool.query(`
                SELECT * FROM cabos_composicao WHERE codigo = ? AND ativo = 1
            `, [codigo]);

            // Fallback: se não encontrou, tentar sem sufixo de variação (ex: C=Compacto, R=Redondo)
            if (rows.length === 0 && /[A-Z]$/i.test(codigo)) {
                const codigoBase = codigo.replace(/[A-Z]$/i, '');
                [rows] = await pool.query(`
                    SELECT * FROM cabos_composicao WHERE codigo = ? AND ativo = 1
                `, [codigoBase]);
            }

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Composição não encontrada para: ${codigo}`
                });
            }

            const cabo = rows[0];

            // Helper para calcular material
            const calcMat = (campo) => {
                const v = parseFloat(cabo[campo]) || 0;
                return { kg_m: v, total_kg: v * metros, total_g: v * metros * 1000 };
            };

            // Calcular materiais necessários (base)
            const materiais = {
                aluminio: calcMat('peso_aluminio_kg_m'),
                pe: calcMat('peso_pe_kg_m'),
                xlpe: calcMat('peso_xlpe_kg_m'),
                xlpe_at: calcMat('peso_xlpe_at_kg_m'),
                hepr: calcMat('peso_hepr_kg_m'),
                pvc: calcMat('peso_pvc_kg_m'),
                mb_pvc: calcMat('peso_mb_pvc_kg_m'),
                mbuvpe: calcMat('peso_mbuvpe_kg_m')
            };

            // Pigmentos individuais detalhados
            const pigmentos = {
                mbuvpt:  calcMat('peso_mbuvpt_kg_m'),   // MB UV Preto
                mbuvcz:  calcMat('peso_mbuvcz_kg_m'),   // MB UV Cinza
                mbuvaz:  calcMat('peso_mbuvaz_kg_m'),    // MB UV Azul
                mbpvccz: calcMat('peso_mbpvccz_kg_m'),   // MB PVC Cinza
                mbpvcpt: calcMat('peso_mbpvcpt_kg_m'),   // MB PVC Preto
                mbpeam:  calcMat('peso_mbpeam_kg_m'),    // MB PE Amarelo
                mbpevd:  calcMat('peso_mbpevd_kg_m'),    // MB PE Verde
                mbpevm:  calcMat('peso_mbpevm_kg_m'),    // MB PE Vermelho
                mbpeaz:  calcMat('peso_mbpeaz_kg_m'),    // MB PE Azul
                mbpebc:  calcMat('peso_mbpebc_kg_m'),    // MB PE Branco
                mbpelj:  calcMat('peso_mbpelj_kg_m'),    // MB PE Laranja
                mbpemr:  calcMat('peso_mbpemr_kg_m'),    // MB PE Marrom
                mbuvvm:  calcMat('peso_mbuvvm_kg_m')     // MB UV Vermelho
            };

            // Agrupar pigmentos por COR para o frontend
            const coresPigmento = {
                pt: (pigmentos.mbuvpt.total_kg + pigmentos.mbpvcpt.total_kg),   // Preto total
                cz: (pigmentos.mbuvcz.total_kg + pigmentos.mbpvccz.total_kg),  // Cinza total
                az: (pigmentos.mbuvaz.total_kg + pigmentos.mbpeaz.total_kg),   // Azul total
                am: pigmentos.mbpeam.total_kg,                                  // Amarelo
                vd: pigmentos.mbpevd.total_kg,                                  // Verde
                vm: (pigmentos.mbpevm.total_kg + pigmentos.mbuvvm.total_kg),    // Vermelho total
                bc: pigmentos.mbpebc.total_kg,                                  // Branco
                lj: pigmentos.mbpelj.total_kg,                                  // Laranja
                mr: pigmentos.mbpemr.total_kg                                   // Marrom
            };

            // Totais
            const peso_total_kg = parseFloat(cabo.peso_total_kg_m) * metros;
            const kg_km = parseFloat(cabo.peso_total_kg_m) * 1000; // kg por quilômetro

            res.json({
                success: true,
                data: {
                    codigo: cabo.codigo,
                    descricao: cabo.descricao,
                    cores: cabo.cores || '',
                    bitola: cabo.bitola,
                    metragem: metros,
                    materiais,
                    pigmentos,
                    coresPigmento,
                    totais: {
                        peso_liquido_kg: peso_total_kg,
                        peso_bruto_kg: peso_total_kg * 1.05, // +5% embalagem/bobina
                        kg_km: kg_km
                    }
                }
            });

        } catch (error) {
            console.error('[API_COMPOSICAO] Erro calcular:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao calcular materiais', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Atualizar campos de peso em pcp_multiplexado_completo baseado na composição
    router.post('/controle-pcp/:id/atualizar-composicao', async (req, res) => {
        try {
            const { id } = req.params;

            // Buscar ordem
            const [ordens] = await pool.query(`
                SELECT id, produto_codigo, metragem_producao, quantidade
                FROM pcp_multiplexado_completo WHERE id = ?
            `, [id]);

            if (ordens.length === 0) {
                return res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }

            const ordem = ordens[0];
            const metragem = parseFloat(ordem.metragem_producao) || parseFloat(ordem.quantidade) || 0;

            if (!ordem.produto_codigo) {
                return res.status(400).json({ success: false, message: 'Ordem sem código de produto' });
            }

            // Buscar composição pelo código
            const [composicao] = await pool.query(`
                SELECT * FROM cabos_composicao WHERE codigo = ? AND ativo = 1
            `, [ordem.produto_codigo]);

            if (composicao.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Composição não encontrada para: ${ordem.produto_codigo}`
                });
            }

            const cabo = composicao[0];

            // Calcular totais
            const al_kg = parseFloat(cabo.peso_aluminio_kg_m) * metragem;
            const pe_kg = (parseFloat(cabo.peso_pe_kg_m) + parseFloat(cabo.peso_xlpe_kg_m) +
                           parseFloat(cabo.peso_pvc_kg_m) + parseFloat(cabo.peso_mb_pvc_kg_m)) * metragem;
            const peso_liquido = parseFloat(cabo.peso_total_kg_m) * metragem;
            const peso_bruto = peso_liquido * 1.05;
            const kg_km = parseFloat(cabo.peso_total_kg_m) * 1000;

            // Atualizar ordem
            await pool.query(`
                UPDATE pcp_multiplexado_completo SET
                    al_kg = ?,
                    pe_kg = ?,
                    peso_liquido = ?,
                    peso_bruto = ?,
                    kg_km_necessidade = ?,
                    necessidade_kg = ?,
                    updated_at = NOW()
                WHERE id = ?
            `, [al_kg, pe_kg, peso_liquido, peso_bruto, kg_km, peso_liquido, id]);

            console.log(`[API_COMPOSICAO] Ordem ${id} atualizada com composição de ${ordem.produto_codigo}`);

            res.json({
                success: true,
                message: 'Composição atualizada com sucesso',
                data: {
                    id,
                    produto: ordem.produto_codigo,
                    metragem,
                    al_kg: al_kg.toFixed(4),
                    pe_kg: pe_kg.toFixed(4),
                    peso_liquido: peso_liquido.toFixed(4),
                    peso_bruto: peso_bruto.toFixed(4),
                    kg_km: kg_km.toFixed(4)
                }
            });

        } catch (error) {
            console.error('[API_COMPOSICAO] Erro atualizar:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar composição', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Listar todos os cabos com composição cadastrada
    router.get('/cabos-composicao', async (req, res) => {
        try {
            const { busca } = req.query;

            let query = `
                SELECT
                    codigo,
                    descricao,
                    cores,
                    bitola,
                    ROUND(peso_aluminio_kg_m * 1000, 2) as aluminio_g_m,
                    ROUND(peso_pe_kg_m * 1000, 2) as pe_g_m,
                    ROUND(peso_pvc_kg_m * 1000, 2) as pvc_g_m,
                    ROUND(peso_xlpe_kg_m * 1000, 2) as xlpe_g_m,
                    ROUND(peso_mbuvpt_kg_m * 1000, 4) as mbuvpt_g_m,
                    ROUND(peso_mbuvcz_kg_m * 1000, 4) as mbuvcz_g_m,
                    ROUND(peso_mbuvaz_kg_m * 1000, 4) as mbuvaz_g_m,
                    ROUND(peso_mbpvccz_kg_m * 1000, 4) as mbpvccz_g_m,
                    ROUND(peso_mbpvcpt_kg_m * 1000, 4) as mbpvcpt_g_m,
                    ROUND(peso_mbpeam_kg_m * 1000, 4) as mbpeam_g_m,
                    ROUND(peso_mbpevd_kg_m * 1000, 4) as mbpevd_g_m,
                    ROUND(peso_mbpevm_kg_m * 1000, 4) as mbpevm_g_m,
                    ROUND(peso_mbpeaz_kg_m * 1000, 4) as mbpeaz_g_m,
                    ROUND(peso_mbpebc_kg_m * 1000, 4) as mbpebc_g_m,
                    ROUND(peso_mbpelj_kg_m * 1000, 4) as mbpelj_g_m,
                    ROUND(peso_mbpemr_kg_m * 1000, 4) as mbpemr_g_m,
                    ROUND(peso_mbuvvm_kg_m * 1000, 4) as mbuvvm_g_m,
                    ROUND(peso_total_kg_m * 1000, 2) as total_g_m,
                    ROUND(peso_total_kg_m, 4) as total_kg_m
                FROM cabos_composicao
                WHERE ativo = 1
            `;
            const params = [];

            if (busca) {
                query += ' AND (codigo LIKE ? OR descricao LIKE ? OR bitola LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
            }

            query += ' ORDER BY codigo ASC';

            const [rows] = await pool.query(query, params);

            res.json({
                success: true,
                total: rows.length,
                data: rows
            });

        } catch (error) {
            console.error('[API_COMPOSICAO] Erro listar:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar composições', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== MATERIAIS POR PEDIDO (Integração Vendas → PCP) ===================

    // Calcular materiais necessários para um pedido de vendas
    router.get('/pedidos/:id/materiais', async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`[API_MATERIAIS_PEDIDO] Calculando materiais para pedido ${id}`);

            // Buscar dados do pedido
            const [pedidos] = await pool.query(`
                SELECT p.id, p.cliente_id, p.valor, p.status,
                       c.razao_social as cliente, c.nome_fantasia
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ?
            `, [id]);

            if (pedidos.length === 0) {
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }

            const pedido = pedidos[0];

            // Buscar itens do pedido na tabela correta (pedido_itens)
            const [itens] = await pool.query(`
                SELECT
                    pi.id,
                    pi.produto_id,
                    pi.codigo,
                    pi.descricao,
                    pi.quantidade as metros,
                    pi.preco_unitario,
                    pi.subtotal,
                    pi.embalagem,
                    pi.lances,
                    pr.codigo as produto_codigo
                FROM pedido_itens pi
                LEFT JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ?
            `, [id]);

            console.log(`[API_MATERIAIS_PEDIDO] Pedido ${id} tem ${itens.length} itens`);

            // Calcular materiais para cada item usando a tabela cabos_composicao
            const itensCalculados = [];
            let totalAlKg = 0;
            let totalPeKg = 0;
            let totalXlpeKg = 0;
            let totalPvcKg = 0;
            let totalPesoLiquido = 0;
            let totalPesoBruto = 0;
            let totalMetros = 0;
            // Totais de pigmentos por cor
            let totalPigPt = 0, totalPigCz = 0, totalPigAz = 0;
            let totalPigAm = 0, totalPigVd = 0, totalPigBc = 0;
            let totalPigLj = 0, totalPigMr = 0;

            // PERFORMANCE: Pré-carregar TODAS as composições ativas em memória (1 query em vez de 5-6 por item)
            const [allComposicoes] = await pool.query(`SELECT id, codigo, descricao, cores, bitola,
                peso_aluminio_kg_m, peso_pe_kg_m, peso_xlpe_kg_m, peso_xlpe_at_kg_m, peso_hepr_kg_m,
                peso_pvc_kg_m, peso_mb_pvc_kg_m, peso_mbuvpe_kg_m, peso_total_kg_m,
                peso_mbuvpt_kg_m, peso_mbuvcz_kg_m, peso_mbuvaz_kg_m, peso_mbuvvm_kg_m,
                peso_mbpvccz_kg_m, peso_mbpvcpt_kg_m,
                peso_mbpeam_kg_m, peso_mbpevd_kg_m, peso_mbpevm_kg_m, peso_mbpeaz_kg_m,
                peso_mbpebc_kg_m, peso_mbpelj_kg_m, peso_mbpemr_kg_m
                FROM cabos_composicao WHERE ativo = 1`);
            const composicaoMap = new Map();
            for (const comp of allComposicoes) {
                if (!composicaoMap.has(comp.codigo)) {
                    composicaoMap.set(comp.codigo, []);
                }
                composicaoMap.get(comp.codigo).push(comp);
            }

            for (const item of itens) {
                const codigoOriginal = item.codigo || item.produto_codigo || '';
                const metros = parseFloat(item.metros) || 0;
                totalMetros += metros;

                // Tentar encontrar composição com diferentes variações do código (in-memory)
                let composicao = [];
                const codigosParaTentar = [
                    codigoOriginal,
                    codigoOriginal.replace(/[A-Z]$/i, ''),
                    codigoOriginal.replace(/C$/i, ''),
                    codigoOriginal.replace(/N$/i, ''),
                    codigoOriginal.replace(/I$/i, ''),
                ];

                let codigoEncontrado = null;
                for (const codigoTeste of codigosParaTentar) {
                    if (!codigoTeste) continue;
                    const comp = composicaoMap.get(codigoTeste);
                    if (comp && comp.length > 0) {
                        composicao = comp;
                        codigoEncontrado = codigoTeste;
                        break;
                    }
                }

                // Também tenta busca parcial se não encontrou (in-memory prefix match)
                if (composicao.length === 0 && codigoOriginal.length >= 3) {
                    const prefix = codigoOriginal.substring(0, codigoOriginal.length - 1);
                    for (const [key, comp] of composicaoMap.entries()) {
                        if (key.startsWith(prefix) && comp.length > 0) {
                            composicao = [comp[0]];
                            codigoEncontrado = comp[0].codigo;
                            break;
                        }
                    }
                }

                let itemCalculado = {
                    id: item.id,
                    codigo: codigoOriginal,
                    codigo_composicao: codigoEncontrado,
                    descricao: item.descricao,
                    metros: metros,
                    embalagem: item.embalagem || 'Bobina',
                    lances: item.lances || '1x1000',
                    // Materiais individuais
                    al_kg: 0,
                    pe_kg: 0,
                    xlpe_kg: 0,
                    pvc_kg: 0,
                    peso_liquido: 0,
                    peso_bruto: 0,
                    // Composição kg/m
                    al_kg_m: 0,
                    pe_kg_m: 0,
                    xlpe_kg_m: 0,
                    pvc_kg_m: 0,
                    peso_total_kg_m: 0,
                    composicao_encontrada: false,
                    // Pigmentos por cor (agrupados)
                    pigmentos: { pt: 0, cz: 0, az: 0, am: 0, vd: 0, bc: 0, lj: 0, mr: 0 },
                    cores: ''
                };

                if (composicao.length > 0) {
                    const comp = composicao[0];
                    const alKgM = parseFloat(comp.peso_aluminio_kg_m) || 0;
                    const peKgM = parseFloat(comp.peso_pe_kg_m) || 0;
                    const xlpeKgM = parseFloat(comp.peso_xlpe_kg_m) || 0;
                    const pvcKgM = parseFloat(comp.peso_pvc_kg_m) || 0;
                    const pesoTotalKgM = parseFloat(comp.peso_total_kg_m) || 0;

                    itemCalculado.al_kg_m = alKgM;
                    itemCalculado.pe_kg_m = peKgM;
                    itemCalculado.xlpe_kg_m = xlpeKgM;
                    itemCalculado.pvc_kg_m = pvcKgM;
                    itemCalculado.peso_total_kg_m = pesoTotalKgM;

                    itemCalculado.al_kg = alKgM * metros;
                    itemCalculado.pe_kg = peKgM * metros;
                    itemCalculado.xlpe_kg = xlpeKgM * metros;
                    itemCalculado.pvc_kg = pvcKgM * metros;
                    itemCalculado.peso_liquido = pesoTotalKgM * metros;
                    itemCalculado.peso_bruto = itemCalculado.peso_liquido * 1.05;
                    itemCalculado.composicao_encontrada = true;
                    itemCalculado.cores = comp.cores || '';

                    // Calcular pigmentos por cor
                    const pf = (campo) => (parseFloat(comp[campo]) || 0) * metros;
                    itemCalculado.pigmentos = {
                        pt: pf('peso_mbuvpt_kg_m') + pf('peso_mbpvcpt_kg_m'),
                        cz: pf('peso_mbuvcz_kg_m') + pf('peso_mbpvccz_kg_m'),
                        az: pf('peso_mbuvaz_kg_m') + pf('peso_mbpeaz_kg_m'),
                        am: pf('peso_mbpeam_kg_m'),
                        vd: pf('peso_mbpevd_kg_m'),
                        bc: pf('peso_mbpebc_kg_m'),
                        lj: pf('peso_mbpelj_kg_m'),
                        mr: pf('peso_mbpemr_kg_m')
                    };

                    totalAlKg += itemCalculado.al_kg;
                    totalPeKg += itemCalculado.pe_kg;
                    totalXlpeKg += itemCalculado.xlpe_kg;
                    totalPvcKg += itemCalculado.pvc_kg;
                    totalPesoLiquido += itemCalculado.peso_liquido;
                    totalPesoBruto += itemCalculado.peso_bruto;

                    // Acumular pigmentos nos totais
                    totalPigPt += itemCalculado.pigmentos.pt;
                    totalPigCz += itemCalculado.pigmentos.cz;
                    totalPigAz += itemCalculado.pigmentos.az;
                    totalPigAm += itemCalculado.pigmentos.am;
                    totalPigVd += itemCalculado.pigmentos.vd;
                    totalPigBc += itemCalculado.pigmentos.bc;
                    totalPigLj += itemCalculado.pigmentos.lj;
                    totalPigMr += itemCalculado.pigmentos.mr;

                    console.log(`[API_MATERIAIS_PEDIDO] Item ${codigoOriginal} -> ${codigoEncontrado}: ${metros}m x ${pesoTotalKgM}kg/m = ${itemCalculado.peso_liquido.toFixed(2)}kg | Cores: ${itemCalculado.cores}`);
                } else {
                    console.log(`[API_MATERIAIS_PEDIDO] ⚠️ Composição não encontrada para: ${codigoOriginal}`);
                }

                itensCalculados.push(itemCalculado);
            }

            res.json({
                pedido: {
                    id: pedido.id,
                    cliente: pedido.cliente || pedido.nome_fantasia,
                    valor: pedido.valor,
                    status: pedido.status
                },
                itens: itensCalculados,
                totais: {
                    metros: totalMetros,
                    al_kg: totalAlKg,
                    pe_kg: totalPeKg,
                    xlpe_kg: totalXlpeKg,
                    pvc_kg: totalPvcKg,
                    peso_liquido: totalPesoLiquido,
                    peso_bruto: totalPesoBruto,
                    kg_por_km: totalMetros > 0 ? (totalPesoLiquido / totalMetros) * 1000 : 0,
                    itens_count: itensCalculados.length,
                    composicoes_encontradas: itensCalculados.filter(i => i.composicao_encontrada).length,
                    pigmentos: {
                        pt: totalPigPt, cz: totalPigCz, az: totalPigAz,
                        am: totalPigAm, vd: totalPigVd, bc: totalPigBc,
                        lj: totalPigLj, mr: totalPigMr
                    }
                }
            });

        } catch (error) {
            console.error('[API_MATERIAIS_PEDIDO] Erro:', error.message);
            res.status(500).json({ error: 'Erro ao calcular materiais', message: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== OPERADORES (FUNCIONÁRIOS PCP) ===================

    router.get('/operadores', async (req, res) => {
        console.log('[API_OPERADORES] Listando operadores...');
        try {
            // Tentar buscar da tabela funcionarios primeiro
            let funcionarios = [];
            try {
                const [rows] = await pool.query(`
                    SELECT id, nome, cargo, departamento, ativo
                    FROM funcionarios
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome ASC
                `);
                funcionarios = rows || [];
            } catch (e) {
                console.log('[API_OPERADORES] Tabela funcionarios não encontrada, tentando usuarios...');
            }

            // Se não encontrou funcionários, buscar de usuarios
            if (funcionarios.length === 0) {
                try {
                    const [rows] = await pool.query(`
                        SELECT id, nome, role as cargo, setor as departamento, ativo
                        FROM usuarios
                        WHERE ativo = 1 OR ativo IS NULL
                        ORDER BY nome ASC
                    `);
                    funcionarios = rows || [];
                } catch (e) {
                    console.log('[API_OPERADORES] Tabela usuarios também falhou');
                }
            }

            // Se ainda não encontrou, retornar lista padrão
            if (funcionarios.length === 0) {
                funcionarios = [
                    { id: 1, nome: 'Operador 1', cargo: 'Operador', departamento: 'Produção' },
                    { id: 2, nome: 'Operador 2', cargo: 'Operador', departamento: 'Produção' },
                    { id: 3, nome: 'Operador 3', cargo: 'Operador', departamento: 'Produção' }
                ];
            }

            console.log(`[API_OPERADORES] Retornando ${funcionarios.length} operadores`);
            res.json({ funcionarios, total: funcionarios.length });
        } catch (error) {
            console.error('[API_OPERADORES] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao listar operadores', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== MATÉRIAS PRIMAS ===================

    router.get('/materias-primas', async (req, res) => {
        console.log('[API_MATERIAS_PRIMAS] Listando matérias-primas...');
        try {
            // Tentar buscar da tabela materiais primeiro
            let materias = [];
            try {
                const [rows] = await pool.query(`
                    SELECT id, codigo_material as codigo, descricao, unidade_medida,
                           estoque_atual, estoque_minimo, preco_unitario, fornecedor
                    FROM materiais
                    ORDER BY descricao ASC
                `);
                materias = rows || [];
            } catch (e) {
                console.log('[API_MATERIAS_PRIMAS] Tabela materiais não encontrada, tentando produtos...');
            }

            // Se não encontrou materiais, buscar de produtos (como alternativa)
            if (materias.length === 0) {
                try {
                    const [rows] = await pool.query(`
                        SELECT id, codigo, descricao, unidade_medida as unidade,
                               estoque_atual, estoque_minimo, preco_venda as preco_unitario
                        FROM produtos
                        WHERE tipo = 'materia_prima' OR categoria LIKE '%materia%' OR categoria LIKE '%insumo%'
                        ORDER BY descricao ASC
                        LIMIT 100
                    `);
                    materias = rows || [];
                } catch (e) {
                    console.log('[API_MATERIAS_PRIMAS] Tabela produtos também falhou');
                }
            }

            console.log(`[API_MATERIAS_PRIMAS] Retornando ${materias.length} matérias-primas`);
            res.json({ success: true, data: materias, total: materias.length });
        } catch (error) {
            console.error('[API_MATERIAS_PRIMAS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar matérias-primas', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    router.get('/materias-primas/:id', async (req, res) => {
        try {
            const materialId = parseInt(req.params.id, 10);
            if (!Number.isInteger(materialId) || materialId < 1) {
                return res.status(400).json({ success: false, message: 'Material inválido.' });
            }

            let origem = 'materiais';
            let material = null;
            try {
                const [rowsMaterial] = await pool.query(`
                    SELECT
                        m.id,
                        m.codigo_material AS codigo,
                        m.descricao,
                        m.unidade_medida AS unidade,
                        m.quantidade_estoque AS quantidade_atual,
                        m.estoque_minimo,
                        m.preco_unitario,
                        m.fornecedor
                    FROM materiais m
                    WHERE m.id = ?
                    LIMIT 1
                `, [materialId]);
                material = rowsMaterial[0] || null;
            } catch (_) {}

            if (!material) {
                origem = 'produtos';
                try {
                    const [rowsProduto] = await pool.query(`
                        SELECT
                            p.id,
                            p.codigo,
                            COALESCE(NULLIF(TRIM(p.descricao), ''), NULLIF(TRIM(p.nome), ''), '') AS descricao,
                            p.unidade_medida AS unidade,
                            p.estoque_atual AS quantidade_atual,
                            p.estoque_minimo,
                            COALESCE(p.preco_venda, p.preco_custo, 0) AS preco_unitario,
                            p.fornecedor
                        FROM produtos p
                        WHERE p.id = ?
                        LIMIT 1
                    `, [materialId]);
                    material = rowsProduto[0] || null;
                } catch (_) {}
            }

            if (!material) {
                return res.status(404).json({ success: false, message: 'Material não encontrado.' });
            }

            res.json({ success: true, material, origem });
        } catch (error) {
            console.error('[API_MATERIAS_PRIMAS] Erro ao buscar material:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar material', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    router.get('/materias-primas/:id/movimentacoes', async (req, res) => {
        try {
            const materialId = parseInt(req.params.id, 10);
            if (!Number.isInteger(materialId) || materialId < 1) {
                return res.status(400).json({ success: false, message: 'Material inválido.' });
            }

            let origem = 'materiais';
            let material = null;
            try {
                const [rowsMaterial] = await pool.query(`
                    SELECT id, codigo_material AS codigo, descricao
                    FROM materiais
                    WHERE id = ?
                    LIMIT 1
                `, [materialId]);
                material = rowsMaterial[0] || null;
            } catch (_) {}
            if (!material) {
                origem = 'produtos';
                try {
                    const [rowsProduto] = await pool.query(`
                        SELECT id, codigo, COALESCE(NULLIF(TRIM(descricao), ''), NULLIF(TRIM(nome), ''), '') AS descricao
                        FROM produtos
                        WHERE id = ?
                        LIMIT 1
                    `, [materialId]);
                    material = rowsProduto[0] || null;
                } catch (_) {}
            }
            if (!material) {
                return res.status(404).json({ success: false, message: 'Material não encontrado.' });
            }

            const limite = Math.min(parseInt(req.query.limit, 10) || 50, 500);
            const movimentacoes = [];

            try {
                const [rows] = await pool.query(`
                    SELECT
                        COALESCE(me.created_at, me.data_movimentacao, NOW()) AS data_movimentacao,
                        UPPER(COALESCE(me.tipo, 'AJUSTE')) AS tipo,
                        me.quantidade,
                        me.quantidade_anterior,
                        me.quantidade_atual,
                        CAST(me.material_id AS CHAR) AS referencia_id,
                        CAST(m.codigo_material AS CHAR) AS codigo,
                        CAST(COALESCE(m.descricao, m.codigo_material) AS CHAR) AS material_nome,
                        CAST(me.documento AS CHAR) AS documento,
                        CAST(COALESCE(me.observacoes, me.motivo, '') AS CHAR) AS motivo,
                        CAST('PCP' AS CHAR) AS origem,
                        me.usuario_id,
                        u.nome AS usuario_nome
                    FROM movimentacoes_estoque me
                    LEFT JOIN materiais m ON m.id = me.material_id
                    LEFT JOIN usuarios u ON u.id = me.usuario_id
                    WHERE me.material_id = ?
                    ORDER BY COALESCE(me.created_at, me.data_movimentacao) DESC
                    LIMIT ?
                `, [materialId, limite]);
                movimentacoes.push(...rows);
            } catch (errMovMaterial) {
                console.warn('[API_MATERIAS_PRIMAS] movimentacoes_estoque indisponível:', errMovMaterial.message);
            }

            if (origem === 'produtos') {
                try {
                    const [rows] = await pool.query(`
                        SELECT
                            COALESCE(me.created_at, me.data_movimentacao, NOW()) AS data_movimentacao,
                            UPPER(COALESCE(me.tipo, 'AJUSTE')) AS tipo,
                            me.quantidade,
                            me.quantidade_anterior,
                            me.quantidade_atual,
                            CAST(me.produto_id AS CHAR) AS referencia_id,
                            CAST(p.codigo AS CHAR) AS codigo,
                            CAST(COALESCE(p.nome, p.descricao, p.codigo) AS CHAR) AS material_nome,
                            CAST(me.documento AS CHAR) AS documento,
                            CAST(COALESCE(me.observacoes, me.motivo, '') AS CHAR) AS motivo,
                            CAST('PCP' AS CHAR) AS origem,
                            me.usuario_id,
                            u.nome AS usuario_nome
                        FROM movimentacoes_estoque me
                        LEFT JOIN produtos p ON p.id = me.produto_id
                        LEFT JOIN usuarios u ON u.id = me.usuario_id
                        WHERE me.produto_id = ?
                        ORDER BY COALESCE(me.created_at, me.data_movimentacao) DESC
                        LIMIT ?
                    `, [materialId, limite]);
                    movimentacoes.push(...rows);
                } catch (errMovProduto) {
                    console.warn('[API_MATERIAS_PRIMAS] movimentacoes_estoque por produto indisponível:', errMovProduto.message);
                }
            }

            try {
                if (material.codigo) {
                    const [rows] = await pool.query(`
                        SELECT
                            em.data_movimento AS data_movimentacao,
                            UPPER(COALESCE(em.tipo_movimento, 'AJUSTE')) AS tipo,
                            em.quantidade,
                            em.quantidade_anterior,
                            em.quantidade_atual,
                            CAST(NULL AS CHAR) AS referencia_id,
                            CAST(em.codigo_material AS CHAR) AS codigo,
                            CAST(COALESCE(m.descricao, em.codigo_material) AS CHAR) AS material_nome,
                            CAST(em.documento_numero AS CHAR) AS documento,
                            CAST(COALESCE(em.observacao, '') AS CHAR) AS motivo,
                            CAST(COALESCE(em.origem, 'Compras') AS CHAR) AS origem,
                            em.usuario_id,
                            u.nome AS usuario_nome
                        FROM estoque_movimentacoes em
                        LEFT JOIN materiais m ON m.codigo_material COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                        LEFT JOIN usuarios u ON u.id = em.usuario_id
                        WHERE em.codigo_material COLLATE utf8mb4_general_ci = ?
                        ORDER BY em.data_movimento DESC
                        LIMIT ?
                    `, [material.codigo, limite]);
                    movimentacoes.push(...rows);
                }
            } catch (errMovEstoque) {
                console.warn('[API_MATERIAS_PRIMAS] estoque_movimentacoes indisponível:', errMovEstoque.message);
            }

            movimentacoes.sort((a, b) => {
                const da = new Date(a.data_movimentacao || 0).getTime();
                const db = new Date(b.data_movimentacao || 0).getTime();
                return db - da;
            });

            res.json({ success: true, material, movimentacoes: movimentacoes.slice(0, limite) });
        } catch (error) {
            console.error('[API_MATERIAS_PRIMAS] Erro ao buscar movimentações:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar movimentações do material', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== APONTAMENTOS DE PRODUÇÃO ===================

    // Cache para verificação de colunas extras (evita query a cada POST)
    let _hasExtraColumnsCache = null; // null = não verificado, true/false = resultado
    async function checkHasExtraColumns() {
        if (_hasExtraColumnsCache !== null) return _hasExtraColumnsCache;
        try {
            await pool.query('SELECT pedido_id, maquina FROM apontamentos_producao LIMIT 0');
            _hasExtraColumnsCache = true;
        } catch (e) {
            _hasExtraColumnsCache = false;
        }
        return _hasExtraColumnsCache;
    }

    // Estatísticas de apontamentos
    router.get('/apontamentos/stats', async (req, res) => {
        console.log('[API_APONTAMENTOS] Buscando estatísticas...');
        try {
            // OPs ativas (em produção ou pendentes)
            let opsAtivas = 0;
            let opsEmProducao = 0;
            let apontamentosHoje = 0;
            let qtdProduzidaHoje = 0;

            try {
                const [result] = await pool.query(`
                    SELECT COUNT(*) as total FROM ordens_producao
                    WHERE status IN ('ativa', 'em_producao', 'pendente', 'Em Produção', 'Ativa')
                `);
                opsAtivas = result[0]?.total || 0;
            } catch (e) { /* Tabela pode não existir */ }

            try {
                const [result] = await pool.query(`
                    SELECT COUNT(*) as total FROM ordens_producao
                    WHERE status IN ('em_producao', 'Em Produção')
                `);
                opsEmProducao = result[0]?.total || 0;
            } catch (e) { /* Tabela pode não existir */ }

            try {
                const [result] = await pool.query(`
                    SELECT COUNT(*) as total, COALESCE(SUM(duracao_segundos), 0) as total_segundos
                    FROM apontamentos_producao
                    WHERE DATE(hora_inicio) = CURDATE()
                `);
                apontamentosHoje = result[0]?.total || 0;
                qtdProduzidaHoje = result[0]?.total_segundos || 0;
            } catch (e) { /* Tabela pode não existir */ }

            res.json({
                success: true,
                stats: {
                    ops_ativas: opsAtivas,
                    ops_em_producao: opsEmProducao,
                    apontamentos_hoje: apontamentosHoje,
                    qtd_produzida_hoje: qtdProduzidaHoje,
                    total_segundos_hoje: qtdProduzidaHoje
                }
            });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas' });
        }
    });

    // Listar OPs para apontamento
    router.get('/apontamentos/ordens', async (req, res) => {
        console.log('[API_APONTAMENTOS] Listando OPs para apontamento...');
        try {
            const { status } = req.query;

            let whereClause = "WHERE op.status NOT IN ('concluida', 'Concluída', 'cancelada')";
            if (status === 'ativas') {
                whereClause = "WHERE op.status IN ('ativa', 'Ativa')";
            } else if (status === 'em_producao') {
                whereClause = "WHERE op.status IN ('em_producao', 'Em Produção')";
            } else if (status === 'pendentes') {
                whereClause = "WHERE op.status IN ('pendente', 'Pendente', 'A Fazer')";
            }

            const [ordens] = await pool.query(`
                SELECT
                    op.id, op.codigo, op.produto_nome, op.quantidade, op.unidade,
                    op.status, op.prioridade, op.data_inicio, op.data_prevista,
                    op.responsavel, COALESCE(op.pedido_vinculado_id, op.pedido_id, p.id) AS pedido_id,
                    COALESCE(op.numero_pedido, p.numero_pedido) AS numero_pedido,
                    COALESCE(op.cliente, c.nome, p.cliente_nome) AS cliente,
                    GREATEST(COALESCE(op.quantidade_produzida, 0),
                        COALESCE((SELECT SUM(ap.quantidade_produzida)
                                  FROM apontamentos_producao ap
                                  WHERE ap.ordem_producao_id = op.id), 0)) AS quantidade_produzida,
                    LEAST(100, ROUND(
                        GREATEST(COALESCE(op.quantidade_produzida, 0),
                            COALESCE((SELECT SUM(ap2.quantidade_produzida)
                                      FROM apontamentos_producao ap2
                                      WHERE ap2.ordem_producao_id = op.id), 0))
                        / NULLIF(op.quantidade, 0) * 100, 2)) AS progresso
                FROM ordens_producao op
                LEFT JOIN pedidos p ON p.id = COALESCE(op.pedido_vinculado_id, op.pedido_id)
                    OR (COALESCE(op.pedido_vinculado_id, op.pedido_id) IS NULL AND p.numero_pedido = op.numero_pedido)
                LEFT JOIN clientes c ON c.id = p.cliente_id
                ${whereClause}
                ORDER BY
                    CASE op.prioridade
                        WHEN 'critica' THEN 1
                        WHEN 'alta' THEN 2
                        WHEN 'media' THEN 3
                        ELSE 4
                    END,
                    op.data_prevista ASC
            `);

            res.json({ success: true, data: ordens });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar OPs' });
        }
    });

    // Andamento dos CABOS de uma OP (por item), conforme apontamentos.
    // Cabos = itens do pedido vinculado (com lances). Produzido por cabo =
    // SUM(apontamentos.quantidade_produzida) casado por produto_descricao.
    router.get('/apontamentos/ordens/:id/cabos', async (req, res) => {
        try {
            const opId = Number(req.params.id);
            if (!opId) return res.status(400).json({ success: false, message: 'OP inválida' });

            const [[op]] = await pool.query(
                `SELECT id, quantidade, unidade, produto_nome,
                        COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id, numero_pedido
                 FROM ordens_producao WHERE id = ? LIMIT 1`, [opId]);
            if (!op) return res.status(404).json({ success: false, message: 'OP não encontrada' });

            // 1) Fonte estruturada: itens do pedido (com lances)
            let pedId = op.pedido_id;
            if (!pedId && op.numero_pedido) {
                try {
                    const [[p]] = await pool.query('SELECT id FROM pedidos WHERE numero_pedido = ? LIMIT 1', [op.numero_pedido]);
                    if (p) pedId = p.id;
                } catch (_) {}
            }
            let cabos = [];
            if (pedId) {
                const [itens] = await pool.query(
                    'SELECT descricao, quantidade, lances FROM pedido_itens WHERE pedido_id = ? ORDER BY id', [pedId]);
                cabos = itens.map(it => ({
                    descricao: it.descricao || '',
                    lances: it.lances || '',
                    meta: Number(it.quantidade) || lancesParaMetros(it.lances)
                }));
            }
            // 2) Fallback: parsear produto_nome (rateia a meta da OP)
            let rateado = false;
            if (cabos.length === 0 && op.produto_nome) {
                const nomes = String(op.produto_nome).split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
                const metaCada = nomes.length ? (Number(op.quantidade) || 0) / nomes.length : 0;
                cabos = nomes.map(n => ({ descricao: n, lances: '', meta: metaCada }));
                rateado = nomes.length > 0;
            }

            // 3) Produzido/refugo por cabo (match por descricao, case-insensitive)
            const [aps] = await pool.query(
                `SELECT produto_descricao,
                        COALESCE(SUM(quantidade_produzida), 0) AS produzido,
                        COALESCE(SUM(quantidade_refugo), 0)   AS refugo
                 FROM apontamentos_producao
                 WHERE ordem_producao_id = ? AND COALESCE(quantidade_produzida,0) > 0
                 GROUP BY produto_descricao`, [opId]);
            // Índice do que foi apontado: por cabo (base) e, dentro dele, por veia.
            // Apontamento antigo (sem veia) entra como metro de CABO pronto.
            const prodMap = new Map();
            for (const a of aps) {
                const { base, veia } = separarVeia(a.produto_descricao);
                const chave = base.toLowerCase();
                if (!prodMap.has(chave)) prodMap.set(chave, { semVeia: 0, refugo: 0, porVeia: new Map() });
                const reg = prodMap.get(chave);
                const produzido = Number(a.produzido) || 0;
                reg.refugo += Number(a.refugo) || 0;
                if (veia) {
                    reg.porVeia.set(veia.toLowerCase(), (reg.porVeia.get(veia.toLowerCase()) || 0) + produzido);
                } else {
                    reg.semVeia += produzido;
                }
            }

            const data = cabos.map(c => {
                const hit = prodMap.get(String(c.descricao || '').trim().toLowerCase());
                const nomesVeias = veiasDoCabo(c.descricao);
                const refugo = hit ? Number(hit.refugo) : 0;

                // Cada veia percorre a metragem inteira do cabo
                const veias = nomesVeias.map(nome => {
                    const feito = hit ? Number(hit.porVeia.get(nome.toLowerCase()) || 0) : 0;
                    return {
                        nome,
                        meta: c.meta,
                        produzido: feito,
                        progresso: c.meta > 0 ? Math.min(100, Math.round((feito / c.meta) * 100)) : 0
                    };
                });

                // Metro de veia vale 1/n de metro de cabo; apontamento sem veia vale 1
                const somaVeias = veias.reduce((acc, v) => acc + v.produzido, 0);
                const divisor = nomesVeias.length || 1;
                const produzido = (hit ? hit.semVeia : 0) + (somaVeias / divisor);
                const progresso = c.meta > 0 ? Math.min(100, Math.round((produzido / c.meta) * 100)) : 0;

                return { descricao: c.descricao, lances: c.lances, meta: c.meta, produzido, refugo, progresso, veias };
            });

            res.json({
                success: true,
                data,
                op: { id: op.id, quantidade: Number(op.quantidade) || 0, unidade: op.unidade || 'm', produto_nome: op.produto_nome, rateado }
            });
        } catch (error) {
            console.error('[API_APONTAMENTOS/CABOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar cabos da OP' });
        }
    });

    // Cache de detecção de colunas opcionais da tabela apontamentos_producao
    // (evita falha de SQL parse quando colunas não existem no schema)
    let _apColsCache = null;
    async function detectApontamentosColumns() {
        if (_apColsCache) return _apColsCache;
        const cols = {
            hora_inicio: false, hora_fim: false, data_apontamento: false,
            data_inicio: false, data_fim: false, created_at: false,
            duracao_segundos: false, tempo_producao: false,
            operador: false, operador_id: false, usuario_id: false,
            tipo_atividade: false, nome_atividade: false,
            pedido_id: false, produto_descricao: false, observacoes: false,
            ordem_producao_id: false, maquina: false, quantidade_produzida: false
        };
        try {
            const [rows] = await pool.query(`SHOW COLUMNS FROM apontamentos_producao`);
            for (const r of rows) {
                if (cols.hasOwnProperty(r.Field)) cols[r.Field] = true;
            }
        } catch (e) {
            // Tabela não existe - todos false
        }
        // Detectar foto/avatar em usuarios (uma vez)
        let userFoto = null;
        try {
            const [u] = await pool.query(`SHOW COLUMNS FROM usuarios`);
            const names = new Set(u.map(r => r.Field));
            if (names.has('foto')) userFoto = 'u.foto';
            else if (names.has('avatar')) userFoto = 'u.avatar';
        } catch (e) {}
        cols._userFoto = userFoto || `''`;
        _apColsCache = cols;
        return cols;
    }

    // Helper: monta expressão SQL para "data do apontamento" usando colunas
    // que realmente existem no schema. Sempre retorna uma expressão válida.
    function buildApDataExpr(c) {
        const parts = [];
        if (c.hora_inicio)        parts.push('ap.hora_inicio');
        if (c.data_apontamento)   parts.push('ap.data_apontamento');
        if (c.data_inicio)        parts.push('ap.data_inicio');
        if (c.created_at)         parts.push('ap.created_at');
        if (parts.length === 0)   return 'NULL';
        if (parts.length === 1)   return parts[0];
        return `COALESCE(${parts.join(', ')})`;
    }
    function buildApDuracaoExpr(c) {
        const parts = [];
        if (c.duracao_segundos) parts.push('ap.duracao_segundos');
        if (c.tempo_producao)   parts.push('(ap.tempo_producao * 60)'); // minutos -> segundos
        if (c.hora_inicio && c.hora_fim) parts.push('TIMESTAMPDIFF(SECOND, ap.hora_inicio, ap.hora_fim)');
        if (c.data_inicio && c.data_fim) parts.push('TIMESTAMPDIFF(SECOND, ap.data_inicio, ap.data_fim)');
        parts.push('0');
        return `COALESCE(${parts.join(', ')})`;
    }

    // Relatório de apontamentos (para supervisores/gerentes)
    router.get('/apontamentos/relatorio', async (req, res) => {
        console.log('[API_APONTAMENTOS] Gerando relatório...');
        try {
            const { dataInicio, dataFim, usuario, atividade, pedido } = req.query;

            // Detectar colunas existentes (evita SQL parse error)
            const c = await detectApontamentosColumns();
            const dataExpr = buildApDataExpr(c);
            const duracaoExpr = buildApDuracaoExpr(c);
            const userFoto = c._userFoto;

            let whereClause = 'WHERE 1=1';
            const params = [];

            if (dataInicio && dataExpr !== 'NULL') {
                whereClause += ` AND DATE(${dataExpr}) >= ?`;
                params.push(dataInicio);
            }
            if (dataFim && dataExpr !== 'NULL') {
                whereClause += ` AND DATE(${dataExpr}) <= ?`;
                params.push(dataFim);
            }
            if (usuario && (c.usuario_id || c.operador_id)) {
                whereClause += c.usuario_id ? ' AND ap.usuario_id = ?' : ' AND ap.operador_id = ?';
                params.push(usuario);
            }
            if (atividade && c.tipo_atividade) {
                whereClause += ' AND ap.tipo_atividade = ?';
                params.push(atividade);
            }
            if (pedido && c.pedido_id) {
                whereClause += ' AND ap.pedido_id = ?';
                params.push(pedido);
            }

            // Verificar se a tabela existe
            let tableExists = false;
            try {
                await pool.query('SELECT 1 FROM apontamentos_producao LIMIT 1');
                tableExists = true;
            } catch (e) {
                console.log('[API_APONTAMENTOS] Tabela apontamentos_producao não existe');
            }

            if (!tableExists) {
                return res.json({
                    success: true,
                    apontamentos: [],
                    funcionarios: [],
                    totalFuncionarios: 0,
                    totalHoras: 0,
                    horasProducao: 0,
                    totalApontamentos: 0
                });
            }

            // Selects condicionais por coluna existente
            const selId          = 'ap.id';
            const selUsuarioId   = c.usuario_id ? 'ap.usuario_id' : (c.operador_id ? 'ap.operador_id' : 'NULL') + ' as usuario_id';
            const selUsuarioNome = `COALESCE(u.nome${c.operador ? ', ap.operador' : ''}, 'Desconhecido') as usuario_nome`;
            const selUsuarioFoto = `${userFoto} as usuario_foto`;
            const selTipo        = c.tipo_atividade ? `COALESCE(ap.tipo_atividade, 'outros') as tipo` : `'outros' as tipo`;
            const selNome        = c.nome_atividade
                ? `COALESCE(ap.nome_atividade${c.tipo_atividade ? ', ap.tipo_atividade' : ''}, 'Sem nome') as nome`
                : (c.tipo_atividade ? `COALESCE(ap.tipo_atividade, 'Sem nome') as nome` : `'Sem nome' as nome`);
            const selData        = `DATE(${dataExpr}) as data`;
            const selHoraIni     = c.hora_inicio ? `TIME_FORMAT(ap.hora_inicio, '%H:%i') as hora_inicio` : `NULL as hora_inicio`;
            const selHoraFim     = c.hora_fim ? `TIME_FORMAT(ap.hora_fim, '%H:%i') as hora_fim` : `NULL as hora_fim`;
            const selDuracao     = `${duracaoExpr} as duracao`;
            const selOpCodigo    = c.ordem_producao_id ? `op.codigo as op_codigo` : `NULL as op_codigo`;
            const selPedidoId    = c.pedido_id ? `ap.pedido_id` : `NULL as pedido_id`;
            const selPedidoNum   = c.pedido_id ? `COALESCE(ped.numero_pedido, ped.id, ap.pedido_id) as pedido_numero` : `NULL as pedido_numero`;
            const selProdDesc    = c.produto_descricao ? `ap.produto_descricao` : `NULL as produto_descricao`;
            const selObs         = c.observacoes ? `ap.observacoes` : `NULL as observacoes`;

            const joinUsuarios = `LEFT JOIN usuarios u ON ap.${c.usuario_id ? 'usuario_id' : (c.operador_id ? 'operador_id' : 'id')} = u.id`;
            const joinOrdens   = c.ordem_producao_id ? `LEFT JOIN ordens_producao op ON ap.ordem_producao_id = op.id` : '';
            const joinPedidos  = c.pedido_id ? `LEFT JOIN pedidos ped ON ap.pedido_id = ped.id` : '';

            // Buscar apontamentos
            const [apontamentos] = await pool.query(`
                SELECT
                    ${selId},
                    ${selUsuarioId},
                    ${selUsuarioNome},
                    ${selUsuarioFoto},
                    ${selTipo},
                    ${selNome},
                    ${selData},
                    ${selHoraIni},
                    ${selHoraFim},
                    ${selDuracao},
                    ${selOpCodigo},
                    ${selPedidoId},
                    ${selPedidoNum},
                    ${selProdDesc},
                    ${selObs}
                FROM apontamentos_producao ap
                ${joinUsuarios}
                ${joinOrdens}
                ${joinPedidos}
                ${whereClause}
                ORDER BY ${dataExpr} DESC
                LIMIT 500
            `, params);

            // Buscar funcionários únicos que fizeram apontamentos
            const userIdCol = c.usuario_id ? 'ap.usuario_id' : (c.operador_id ? 'ap.operador_id' : 'NULL');
            const [funcionarios] = await pool.query(`
                SELECT DISTINCT
                    COALESCE(${userIdCol}, 0) as id,
                    COALESCE(u.nome${c.operador ? ', ap.operador' : ''}, 'Desconhecido') as nome,
                    ${userFoto} as foto,
                    '' as departamento,
                    'user' as role
                FROM apontamentos_producao ap
                ${joinUsuarios}
                ${whereClause}
            `, params);

            // Calcular estatísticas
            const totalSegundos = apontamentos.reduce((acc, a) => acc + (Number(a.duracao) || 0), 0);
            const producaoSegundos = apontamentos
                .filter(a => ['producao', '1', '1A'].includes(a.tipo))
                .reduce((acc, a) => acc + (Number(a.duracao) || 0), 0);

            res.json({
                success: true,
                apontamentos,
                funcionarios,
                totalFuncionarios: funcionarios.length,
                totalHoras: Math.round(totalSegundos / 3600 * 10) / 10,
                horasProducao: Math.round(producaoSegundos / 3600 * 10) / 10,
                totalApontamentos: apontamentos.length
            });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro no relatório:', error.message);
            // Fallback: retorna estrutura vazia em vez de 500 para não quebrar a UI
            res.json({
                success: true,
                apontamentos: [],
                funcionarios: [],
                totalFuncionarios: 0,
                totalHoras: 0,
                horasProducao: 0,
                totalApontamentos: 0,
                _warning: 'Apontamentos indisponíveis no momento'
            });
        }
    });

    // Recalcula o andamento da OP a partir da SOMA dos apontamentos vinculados.
    // Chamado apos cada apontamento com ordem_producao_id. Nao mexe no status
    // (o fluxo de status e do kanban/carteira); atualiza quantidade_produzida
    // e progresso (0-100, teto 100). Falha aqui NAO derruba o apontamento.
    async function atualizarAndamentoOrdem(opId) {
        if (!opId) return;
        try {
            const [[soma]] = await pool.query(
                'SELECT COALESCE(SUM(quantidade_produzida),0) AS total FROM apontamentos_producao WHERE ordem_producao_id = ?',
                [opId]
            );
            const [[op]] = await pool.query(
                'SELECT quantidade FROM ordens_producao WHERE id = ?', [opId]
            );
            if (!op) return;
            const produzido = Number(soma.total) || 0;
            const meta = Number(op.quantidade) || 0;
            const progresso = meta > 0 ? Math.min(100, Math.round((produzido / meta) * 100)) : 0;
            await pool.query(
                'UPDATE ordens_producao SET quantidade_produzida = ?, progresso = ?, updated_at = NOW() WHERE id = ?',
                [produzido, progresso, opId]
            );
            console.log(`[PCP/ANDAMENTO] OP ${opId}: produzido=${produzido}/${meta} progresso=${progresso}%`);
        } catch (e) {
            console.error('[PCP/ANDAMENTO] Erro ao atualizar OP', opId, '-', e.message);
        }
    }

    // Relatório de TEMPO DE MÁQUINA (rodando × parado) a partir dos apontamentos.
    // Classifica por CÓDIGO tipo_atividade (nomes têm mojibake): 1/1A=rodando,
    // ST/AM=setup, resto=parada. Tempo via buildApDuracaoExpr (robusto a schema).
    router.get('/relatorios/tempo-maquina', async (req, res) => {
        try {
            const { inicio, fim } = req.query;
            const c = await detectApontamentosColumns();
            const dataExpr = buildApDataExpr(c);
            const duracaoExpr = buildApDuracaoExpr(c);
            const maqExpr = c.maquina ? 'ap.maquina' : 'NULL';
            const tipoExpr = c.tipo_atividade ? 'ap.tipo_atividade' : "''";
            const nomeExpr = c.nome_atividade ? 'ap.nome_atividade' : "''";

            const where = ['1=1'];
            const params = [];
            if (inicio && dataExpr !== 'NULL') { where.push(`DATE(${dataExpr}) >= ?`); params.push(inicio); }
            if (fim && dataExpr !== 'NULL')    { where.push(`DATE(${dataExpr}) <= ?`); params.push(fim); }

            const [rows] = await pool.query(
                `SELECT ${maqExpr} AS maquina, ${tipoExpr} AS tipo, ${nomeExpr} AS nome,
                        COUNT(*) AS ocorrencias, COALESCE(SUM(${duracaoExpr}), 0) AS dur_seg
                 FROM apontamentos_producao ap
                 WHERE ${where.join(' AND ')}
                 GROUP BY maquina, tipo, nome`, params);

            const classe = (tipo) => {
                const t = String(tipo || '').toUpperCase().trim();
                if (t === '1' || t === '1A') return 'rodando';
                if (t === 'ST' || t === 'AM') return 'setup';
                return 'parada';
            };
            const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

            const resumo = { total_seg: 0, rodando_seg: 0, parado_seg: 0, setup_seg: 0, n_apontamentos: 0, n_paradas: 0 };
            const maqMap = new Map();
            const motMap = new Map();
            for (const r of rows) {
                const seg = Number(r.dur_seg) || 0;
                const oc = Number(r.ocorrencias) || 0;
                const cl = classe(r.tipo);
                resumo.total_seg += seg; resumo.n_apontamentos += oc;
                if (cl === 'rodando') resumo.rodando_seg += seg;
                else if (cl === 'setup') resumo.setup_seg += seg;
                else { resumo.parado_seg += seg; resumo.n_paradas += oc; }

                const mk = (r.maquina == null || String(r.maquina).trim() === '') ? 'Sem máquina informada' : String(r.maquina).trim();
                if (!maqMap.has(mk)) maqMap.set(mk, { maquina: mk, rodando_seg: 0, parado_seg: 0, setup_seg: 0, total_seg: 0, n_paradas: 0 });
                const m = maqMap.get(mk);
                m.total_seg += seg;
                if (cl === 'rodando') m.rodando_seg += seg;
                else if (cl === 'setup') m.setup_seg += seg;
                else { m.parado_seg += seg; m.n_paradas += oc; }

                if (cl !== 'rodando') {
                    const nomeLimpo = (String(r.nome || '').trim() || String(r.tipo || '').trim() || '—');
                    const key = (String(r.tipo || '').toUpperCase().trim() || nomeLimpo);
                    if (!motMap.has(key)) motMap.set(key, { tipo: r.tipo || '', motivo: nomeLimpo, classe: cl, tempo_seg: 0, ocorrencias: 0 });
                    const mo = motMap.get(key);
                    mo.tempo_seg += seg; mo.ocorrencias += oc;
                }
            }
            resumo.disponibilidade_pct = pct(resumo.rodando_seg, resumo.total_seg);
            resumo.n_maquinas = maqMap.size;

            const por_maquina = [...maqMap.values()]
                .map(m => ({ ...m, disponibilidade_pct: pct(m.rodando_seg, m.total_seg) }))
                .sort((a, b) => b.total_seg - a.total_seg);
            const paradoBase = resumo.parado_seg + resumo.setup_seg;
            const por_motivo = [...motMap.values()]
                .map(mo => ({ ...mo, pct: pct(mo.tempo_seg, paradoBase) }))
                .sort((a, b) => b.tempo_seg - a.tempo_seg);

            res.json({ success: true, periodo: { inicio: inicio || null, fim: fim || null }, resumo, por_maquina, por_motivo });
        } catch (e) {
            console.error('[PCP/RELATORIO/TEMPO-MAQUINA] Erro:', e.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de tempo de máquina' });
        }
    });

    // Salvar apontamento
    router.post('/apontamentos', async (req, res) => {
        try {
            const { tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, ordem_producao_id, pedido_numero, produto_descricao, observacoes, maquina, turno, quantidade_produzida, quantidade_refugo, lances } = req.body;
            const usuario_id = req.user?.id;
            const operador = req.user?.nome || 'Desconhecido';
            const qtdProdFinal = (Number(quantidade_produzida) > 0) ? Number(quantidade_produzida) : lancesParaMetros(lances);
            const obsFinal = lances ? `${observacoes ? observacoes + ' · ' : ''}Lances: ${String(lances).trim()}` : (observacoes || null);

            // Validação básica
            if (!tipo_atividade || !nome_atividade) {
                return res.status(400).json({
                    success: false,
                    message: 'tipo_atividade e nome_atividade são obrigatórios'
                });
            }

            // Formatação segura das datas
            const horaInicioFormatada = hora_inicio ? new Date(hora_inicio).toISOString().slice(0, 19).replace('T', ' ') : null;
            const horaFimFormatada = hora_fim ? new Date(hora_fim).toISOString().slice(0, 19).replace('T', ' ') : null;

            // Buscar pedido_id se pedido_numero fornecido
            let pedidoId = null;
            if (pedido_numero) {
                try {
                    const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE id = ? OR numero = ? LIMIT 1', [pedido_numero, pedido_numero]);
                    if (pedidos.length > 0) pedidoId = pedidos[0].id;
                } catch (e) {
                    console.log('[API_APONTAMENTOS] Pedido não encontrado:', pedido_numero);
                }
            }

            // Verificar se colunas extras existem (com cache)
            const hasExtraColumns = await checkHasExtraColumns();

            let result;
            if (hasExtraColumns) {
                [result] = await pool.query(`
                    INSERT INTO apontamentos_producao
                    (usuario_id, operador, maquina, turno, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, quantidade_produzida, quantidade_refugo, pedido_id, produto_descricao, observacoes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    usuario_id,
                    operador,
                    maquina || null,
                    turno || null,
                    ordem_producao_id || null,
                    tipo_atividade,
                    nome_atividade,
                    horaInicioFormatada,
                    horaFimFormatada,
                    duracao_segundos || 0,
                    qtdProdFinal || 0,
                    quantidade_refugo || 0,
                    pedidoId,
                    produto_descricao || null,
                    obsFinal
                ]);
            } else {
                [result] = await pool.query(`
                    INSERT INTO apontamentos_producao
                    (usuario_id, operador, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    usuario_id,
                    operador,
                    ordem_producao_id || null,
                    tipo_atividade,
                    nome_atividade,
                    horaInicioFormatada,
                    horaFimFormatada,
                    duracao_segundos || 0
                ]);
            }

            console.log('[API_APONTAMENTOS] Apontamento salvo com sucesso, id:', result.insertId);
            // propaga o apontamento para o andamento da OP (nao bloqueia a resposta em caso de erro)
            await atualizarAndamentoOrdem(ordem_producao_id);
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro ao salvar:', error.message, error.stack);
            res.status(500).json({ success: false, message: 'Erro ao salvar apontamento', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Listar apontamentos do usuário logado
    // Handler compartilhado: apontamentos do usuário (usado em /meus e /mcvs)
    async function _listarApontamentosUsuario(req, res) {
        console.log('[API_APONTAMENTOS] Listando apontamentos do usuário...');
        try {
            const usuario_id = req.user?.id;
            const { data } = req.query;

            // Verificar se a tabela existe
            try {
                await pool.query('SELECT 1 FROM apontamentos_producao LIMIT 1');
            } catch (e) {
                return res.json({ success: true, apontamentos: [] });
            }

            let whereClause = 'WHERE ap.usuario_id = ?';
            const params = [usuario_id];

            if (data) {
                whereClause += ' AND DATE(ap.hora_inicio) = ?';
                params.push(data);
            }

            const [apontamentos] = await pool.query(`
                SELECT
                    ap.id,
                    ap.tipo_atividade as tipo,
                    ap.nome_atividade as nome,
                    DATE(ap.hora_inicio) as data,
                    TIME_FORMAT(ap.hora_inicio, '%H:%i') as hora_inicio,
                    TIME_FORMAT(ap.hora_fim, '%H:%i') as hora_fim,
                    ap.duracao_segundos as duracao,
                    ap.pedido_id,
                    COALESCE(CAST(ped.id AS CHAR), CAST(ap.pedido_id AS CHAR)) as pedido_numero,
                    ap.produto_descricao,
                    ap.observacoes
                FROM apontamentos_producao ap
                LEFT JOIN pedidos ped ON ap.pedido_id = ped.id
                ${whereClause}
                ORDER BY ap.hora_inicio DESC
            `, params);

            res.json({ success: true, apontamentos });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar apontamentos' });
        }
    }

    // /mcvs é alias de /meus (compatibilidade com versões anteriores do front-end)
    router.get('/apontamentos/mcvs', _listarApontamentosUsuario);

    router.get('/apontamentos/meus', _listarApontamentosUsuario);

    // ============================================
    // APONTAMENTO EM TEMPO REAL (quem está fazendo o quê AGORA)
    //
    // O apontamento só entra em apontamentos_producao quando FINALIZA. Para o
    // supervisor acompanhar a fábrica ao vivo, a tela do operador manda um
    // heartbeat para cá; a linha é apagada ao finalizar e some sozinha se o
    // tablet parar de responder.
    // ============================================
    let _tabelaAtivosPronta = false;
    async function ensureTabelaAtivos() {
        if (_tabelaAtivosPronta) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS apontamentos_ativos (
                usuario_id INT NOT NULL PRIMARY KEY,
                operador VARCHAR(150) NULL,
                tipo_atividade VARCHAR(10) NULL,
                nome_atividade VARCHAR(120) NULL,
                ordem_producao_id INT NULL,
                op_codigo VARCHAR(60) NULL,
                pedido_numero VARCHAR(60) NULL,
                produto_descricao VARCHAR(255) NULL,
                veia VARCHAR(40) NULL,
                maquina VARCHAR(120) NULL,
                turno VARCHAR(20) NULL,
                quantidade_parcial DECIMAL(12,2) NULL DEFAULT 0,
                meta_veia DECIMAL(12,2) NULL DEFAULT 0,
                lances VARCHAR(120) NULL,
                pausado TINYINT(1) NOT NULL DEFAULT 0,
                hora_inicio DATETIME NULL,
                atualizado_em DATETIME NOT NULL,
                INDEX idx_atualizado (atualizado_em)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        _tabelaAtivosPronta = true;
    }

    // Heartbeat da tela do operador
    router.post('/apontamentos/ativo', async (req, res) => {
        try {
            await ensureTabelaAtivos();
            const usuario_id = req.user?.id;
            if (!usuario_id) return res.status(401).json({ success: false, message: 'Sem usuário' });

            const b = req.body || {};
            const horaInicio = b.hora_inicio ? new Date(b.hora_inicio) : null;
            const horaInicioSql = horaInicio && !isNaN(horaInicio.getTime())
                ? horaInicio.toISOString().slice(0, 19).replace('T', ' ')
                : null;

            await pool.query(
                `INSERT INTO apontamentos_ativos
                 (usuario_id, operador, tipo_atividade, nome_atividade, ordem_producao_id, op_codigo,
                  pedido_numero, produto_descricao, veia, maquina, turno, quantidade_parcial, meta_veia,
                  lances, pausado, hora_inicio, atualizado_em)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    operador = VALUES(operador), tipo_atividade = VALUES(tipo_atividade),
                    nome_atividade = VALUES(nome_atividade), ordem_producao_id = VALUES(ordem_producao_id),
                    op_codigo = VALUES(op_codigo), pedido_numero = VALUES(pedido_numero),
                    produto_descricao = VALUES(produto_descricao), veia = VALUES(veia),
                    maquina = VALUES(maquina), turno = VALUES(turno),
                    quantidade_parcial = VALUES(quantidade_parcial), meta_veia = VALUES(meta_veia),
                    lances = VALUES(lances), pausado = VALUES(pausado),
                    hora_inicio = VALUES(hora_inicio), atualizado_em = NOW()`,
                [usuario_id, req.user?.nome || b.operador || 'Operador', b.tipo_atividade || null,
                 b.nome_atividade || null, b.ordem_producao_id || null, b.op_codigo || null,
                 b.pedido_numero || null, b.produto_descricao || null, b.veia || null,
                 b.maquina || null, b.turno || null, Number(b.quantidade_parcial) || 0,
                 Number(b.meta_veia) || 0, b.lances || null, b.pausado ? 1 : 0, horaInicioSql]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS/ATIVO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao registrar atividade em andamento' });
        }
    });

    // Operador finalizou (ou saiu): tira da tela ao vivo
    router.delete('/apontamentos/ativo', async (req, res) => {
        try {
            await ensureTabelaAtivos();
            const usuario_id = req.user?.id;
            if (usuario_id) await pool.query('DELETE FROM apontamentos_ativos WHERE usuario_id = ?', [usuario_id]);
            res.json({ success: true });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS/ATIVO] Erro ao remover:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao encerrar atividade em andamento' });
        }
    });

    // Painel do supervisor: quem está fazendo o quê agora
    router.get('/apontamentos/ativos', async (req, res) => {
        try {
            await ensureTabelaAtivos();
            // Sem heartbeat há mais de 5 min o posto é considerado abandonado
            const minutos = Math.min(120, Math.max(2, Number(req.query.janela_min) || 5));
            const [linhas] = await pool.query(
                `SELECT a.*, TIMESTAMPDIFF(SECOND, a.hora_inicio, NOW()) AS segundos_decorridos,
                        TIMESTAMPDIFF(SECOND, a.atualizado_em, NOW()) AS segundos_sem_sinal,
                        op.codigo AS op_codigo_atual, op.quantidade AS op_quantidade,
                        op.produto_nome AS op_produto
                 FROM apontamentos_ativos a
                 LEFT JOIN ordens_producao op ON op.id = a.ordem_producao_id
                 WHERE a.atualizado_em >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
                 ORDER BY a.pausado ASC, a.hora_inicio ASC`,
                [minutos]
            );
            res.json({ success: true, data: linhas, janela_min: minutos });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS/ATIVOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar atividades em andamento' });
        }
    });


    // ==================== ROTAS DE RELATÓRIOS PCP (extraído → routes/pcp/relatorios.js) ====================
    require('./pcp/relatorios')(router, pool);

    // ============================================
    // ÁRVORE DE PRODUTO COM CUSTO — CUSTOS & PRECIFICAÇÃO
    // ============================================
    router.get('/arvore-produto', async (req, res) => {
        try {
            const path = require('path');
            const fs = require('fs');
            const dataPath = arvoreFonte.resolverArvore();

            if (!fs.existsSync(dataPath)) {
                return res.status(404).json({ success: false, message: 'Dados da árvore de produto não encontrados.' });
            }

            const rawData = fs.readFileSync(dataPath, 'utf-8');
            const data = JSON.parse(rawData);

            // Custos & Precificação trabalha somente com produtos acabados que têm
            // estrutura vigente. A lista e os consumos vêm de `estrutura_produto`,
            // atualizada pela importação da base; o JSON mantém parâmetros e metadados
            // comerciais que não existem na estrutura.
            const { categoria, search } = req.query;
            const catalogProducts = Array.isArray(data.products) ? data.products : [];
            const catalogEntries = catalogProducts
                .filter(p => p && p.codigo)
                .map(p => ({
                    code: String(p.codigo).trim().toUpperCase(),
                    product: p
                }))
                .sort((a, b) => b.code.length - a.code.length);
            const catalogByCode = new Map(catalogEntries.map(entry => [entry.code, entry.product]));
            const derivedVariantPattern = /^(?:-\d{2}|[A-Z]{1,2})$/;
            const findCatalogProduct = (code) => {
                const normalizedCode = String(code || '').trim().toUpperCase();
                const exact = catalogByCode.get(normalizedCode);
                if (exact) return { product: exact, source: 'composicao' };

                // Derivações comerciais aparecem como "BASE-01", "BASEC",
                // "BASEN", "BASEVM" etc. Elas preservam a construção física e
                // herdam a composição-base. Sufixos que introduzem outra bitola
                // (por exemplo "/35") só casam quando o código completo dessa
                // bitola existe no catálogo; nunca herdamos pelo prefixo curto.
                const inherited = catalogEntries.find(entry => {
                    if (!normalizedCode.startsWith(entry.code)) return false;
                    const suffix = normalizedCode.slice(entry.code.length);
                    return derivedVariantPattern.test(suffix);
                });
                return inherited
                    ? { product: inherited.product, source: 'composicao_variacao' }
                    : { product: null, source: null };
            };
            const materialKeys = Object.keys((data.parametros && data.parametros.precos_kg) || {});
            const emptyComposition = () => Object.fromEntries(materialKeys.map(k => [k, 0]));
            const normalizeCode = value => String(value || '').trim().toUpperCase();
            const materialKeyFromComponent = value => {
                const code = normalizeCode(value).replace(/\s+/g, '');
                if (code === 'AL') return 'AL';
                if (code === 'ACO' || code === 'AÇO') return 'ACO';
                if (code === 'PE') return 'PE';
                if (code === 'XLPE') return 'XLPE';
                if (code === 'XLPE/AT' || code === 'XLPE_AT') return 'XLPE_AT';
                if (code === 'HEPR') return 'HEPR';
                if (code === 'PVC') return 'PVC';
                if (code === 'SEMI_COND' || code === 'SEMICOND' || code === 'SEMI-COND') return 'SEMI_COND';
                if (code.startsWith('MB')) return 'MB_UV';
                return null;
            };

            const [structureRows] = await pool.query(`
                SELECT TRIM(produto_codigo) AS produto_codigo, produto_descricao,
                       TRIM(componente_codigo) AS componente_codigo,
                       quantidade_por_metro, unidade
                FROM estrutura_produto
                WHERE ativo = 1
                ORDER BY produto_codigo, componente_codigo
            `);
            const compositionByCode = new Map();
            const structureDescriptionByCode = new Map();
            structureRows.forEach(row => {
                const productCode = normalizeCode(row.produto_codigo);
                if (!productCode) return;
                if (row.produto_descricao && !structureDescriptionByCode.has(productCode)) {
                    structureDescriptionByCode.set(productCode, String(row.produto_descricao).trim());
                }
                if (normalizeCode(row.unidade) !== 'KG') return;
                const materialKey = materialKeyFromComponent(row.componente_codigo);
                if (!materialKey || !materialKeys.includes(materialKey)) return;
                if (!compositionByCode.has(productCode)) compositionByCode.set(productCode, emptyComposition());
                const composition = compositionByCode.get(productCode);
                composition[materialKey] += Number(row.quantidade_por_metro || 0);
            });

            const [dbProducts] = await pool.query(`
                SELECT id, TRIM(codigo) AS codigo, nome, descricao, categoria, variacao,
                       preco_venda, preco_custo, custo_unitario, custo_aquisicao,
                       markup, margem, margem_lucro
                FROM produtos p
                WHERE p.status = 'ativo'
                  AND EXISTS (
                      SELECT 1
                      FROM estrutura_produto ep
                      WHERE ep.ativo = 1
                        AND BINARY UPPER(TRIM(ep.produto_codigo)) = BINARY UPPER(TRIM(p.codigo))
                  )
                ORDER BY COALESCE(NULLIF(descricao, ''), NULLIF(nome, ''), codigo), codigo
            `);
            const allProducts = dbProducts.filter(p => p.codigo).map(p => {
                const code = String(p.codigo).trim();
                const normalizedCode = normalizeCode(code);
                const catalogMatch = findCatalogProduct(code);
                const catalog = catalogMatch.product;
                const kg = compositionByCode.get(normalizedCode) || emptyComposition();
                const hasComposition = Object.values(kg).some(v => Number(v) > 0);
                const registeredCost = Math.max(
                    Number(p.custo_unitario || 0),
                    Number(p.preco_custo || 0),
                    Number(p.custo_aquisicao || 0)
                );
                return {
                    ...(catalog || {}),
                    produto_id: p.id,
                    codigo: code,
                    descricao: p.descricao || p.nome || structureDescriptionByCode.get(normalizedCode)
                        || (catalog && catalog.descricao) || code,
                    nome: p.nome || '',
                    categoria: (catalog && catalog.categoria) || p.categoria || 'Sem categoria',
                    cores: (catalog && catalog.cores) || p.variacao || '',
                    kg_m: kg,
                    tem_composicao: hasComposition,
                    composicao_origem: 'estrutura_produto',
                    custo_base: registeredCost,
                    tem_base_precificacao: hasComposition || registeredCost > 0,
                    preco_venda_atual: Number(p.preco_venda || 0),
                    markup_atual: Number(p.markup || 0),
                    margem_atual: Number(p.margem || 0),
                    margem_lucro_atual: Number(p.margem_lucro || 0)
                };
            });
            const totalCadastrados = allProducts.length;
            let products = allProducts;

            if (categoria && categoria !== 'todos') {
                products = products.filter(p => p.categoria === categoria);
            }

            if (search) {
                const term = search.toLowerCase();
                products = products.filter(p =>
                    p.codigo.toLowerCase().includes(term) ||
                    p.descricao.toLowerCase().includes(term) ||
                    (p.cores || '').toLowerCase().includes(term)
                );
            }

            res.json({
                success: true,
                parametros: data.parametros,
                total: totalCadastrados,
                total_com_composicao: allProducts.filter(p => p.tem_composicao).length,
                total_sem_composicao: allProducts.filter(p => !p.tem_composicao).length,
                total_precificaveis: allProducts.filter(p => p.tem_base_precificacao).length,
                total_sem_base: allProducts.filter(p => !p.tem_base_precificacao).length,
                total_sem_preco: allProducts.filter(p => !(p.preco_venda_atual > 0)).length,
                total_sem_cadastro: 0,
                categorias: [...new Set(allProducts.map(p => p.categoria))].sort(),
                products
            });
        } catch (err) {
            console.error('[PCP] Erro árvore de produto:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar árvore de produto.' });
        }
    });

    // ------------------------------------------------------------------
    // Resolve UM produto para a precificação, nesta ordem: catálogo da árvore
    // -> composição de `estrutura_produto` (inclusive as variações do código)
    // -> custo do cadastro. Extraído do GET /arvore-produto/preco/:codigo para
    // que o repricing em lote do pedido use EXATAMENTE a mesma resolução —
    // duas resoluções diferentes dariam preços diferentes para o mesmo item.
    // Devolve null quando nem o cadastro tem o código (o chamador responde 404).
    // ------------------------------------------------------------------
    async function resolverProdutoPrecificavel(data, alvo) {
        const catalogo = Array.isArray(data.products) ? data.products : [];
        let produto = catalogo.find(p => String(p.codigo || '').trim().toUpperCase() === alvo);
        const normalizeCodePreco = value => String(value || '').trim().toUpperCase();
        const materialKeysPreco = Object.keys((data.parametros && data.parametros.precos_kg) || {});
        const emptyCompositionPreco = () => Object.fromEntries(materialKeysPreco.map(k => [k, 0]));
        const derivedVariantPatternPreco = /^(?:-\d{2}|[A-Z]{1,2})$/;
        const materialKeyFromComponentPreco = value => {
            const code = normalizeCodePreco(value).replace(/\s+/g, '');
            if (code === 'AL') return 'AL';
            if (code === 'ACO' || code === 'AÇO') return 'ACO';
            if (code === 'PE') return 'PE';
            if (code === 'XLPE') return 'XLPE';
            if (code === 'XLPE/AT' || code === 'XLPE_AT') return 'XLPE_AT';
            if (code === 'HEPR') return 'HEPR';
            if (code === 'PVC') return 'PVC';
            if (code === 'SEMI_COND' || code === 'SEMICOND' || code === 'SEMI-COND') return 'SEMI_COND';
            if (code.startsWith('MB')) return 'MB_UV';
            return null;
        };
        const carregarProdutoEstrutura = async (codigoAlvo) => {
            const [rows] = await pool.query(`
                SELECT TRIM(produto_codigo) AS produto_codigo, produto_descricao,
                       TRIM(componente_codigo) AS componente_codigo,
                       quantidade_por_metro, unidade
                FROM estrutura_produto
                WHERE ativo = 1
                  AND (
                    BINARY UPPER(TRIM(produto_codigo)) = BINARY ?
                    OR ? LIKE CONCAT(UPPER(TRIM(produto_codigo)), '%')
                  )
                ORDER BY CHAR_LENGTH(TRIM(produto_codigo)) DESC, id
            `, [codigoAlvo, codigoAlvo]);
            const grupos = new Map();
            rows.forEach(row => {
                const codigoProduto = normalizeCodePreco(row.produto_codigo);
                const sufixo = codigoAlvo.slice(codigoProduto.length);
                if (codigoProduto !== codigoAlvo && !derivedVariantPatternPreco.test(sufixo)) return;
                if (!grupos.has(codigoProduto)) grupos.set(codigoProduto, []);
                grupos.get(codigoProduto).push(row);
            });
            const codigoBase = [...grupos.keys()].sort((a, b) => b.length - a.length)[0];
            if (!codigoBase) return null;
            const composicao = emptyCompositionPreco();
            let descricao = '';
            grupos.get(codigoBase).forEach(row => {
                if (row.produto_descricao && !descricao) descricao = String(row.produto_descricao).trim();
                if (normalizeCodePreco(row.unidade) !== 'KG') return;
                const materialKey = materialKeyFromComponentPreco(row.componente_codigo);
                if (!materialKey || !materialKeysPreco.includes(materialKey)) return;
                composicao[materialKey] += Number(row.quantidade_por_metro || 0);
            });
            return {
                codigo: codigoAlvo,
                codigo_base_estrutura: codigoBase,
                descricao: descricao || codigoAlvo,
                kg_m: composicao,
                composicao_origem: codigoBase === codigoAlvo ? 'estrutura_produto' : 'estrutura_produto_variacao'
            };
        };
        const produtoEstrutura = await carregarProdutoEstrutura(alvo);
        if (produtoEstrutura) {
            produto = {
                ...(produto || {}),
                ...produtoEstrutura,
                descricao: (produto && produto.descricao) || produtoEstrutura.descricao
            };
        }

        // Sem composição na planilha, cai para o custo do cadastro: o preço
        // ainda sai, mas marcado como vindo do cadastro e não da árvore.
        if (!produto) {
            const [linhas] = await pool.query(
                `SELECT codigo, nome, descricao, preco_venda, preco_custo, custo_unitario, custo_aquisicao
                   FROM produtos WHERE UPPER(TRIM(codigo)) = ? LIMIT 1`, [alvo]
            );
            if (!linhas.length) return null;
            const linha = linhas[0];
            produto = {
                codigo: linha.codigo,
                descricao: linha.descricao || linha.nome || linha.codigo,
                kg_m: {},
                custo_base: Math.max(Number(linha.custo_unitario || 0), Number(linha.preco_custo || 0), Number(linha.custo_aquisicao || 0))
            };
        }
        return produto;
    }

    // ------------------------------------------------------------------
    // GET /arvore-produto/preco/:codigo
    // Precificação de UM item no contexto da cotação, para os módulos que
    // precisam de preço na hora (Vendas/orçamento, PCP, Compras) em vez de
    // esperar o "Aplicar em Orçamentos" repintar o catálogo inteiro.
    //
    // Query: uf, filial, tipo_cliente, frete, condicao_pagamento,
    //        faturamento_tipo, is_representante, preco_referencia
    // ------------------------------------------------------------------
    router.get('/arvore-produto/preco/:codigo', async (req, res) => {
        try {
            const path = require('path');
            const fs = require('fs');
            const core = require(path.join(__dirname, '..', 'public', 'js', 'custos-precificacao-core.js'));
            const dataPath = arvoreFonte.resolverArvore();
            if (!fs.existsSync(dataPath)) {
                return res.status(404).json({ success: false, message: 'Dados da árvore de produto não encontrados.' });
            }
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
            const alvo = String(req.params.codigo || '').trim().toUpperCase();
            if (!alvo) return res.status(400).json({ success: false, message: 'Código não informado.' });

            const produto = await resolverProdutoPrecificavel(data, alvo);
            if (!produto) return res.status(404).json({ success: false, message: 'Produto não encontrado.' });

            const q = req.query || {};
            const opcoes = {
                filial: q.filial || undefined,
                uf: q.uf || undefined,
                tipo_cliente: q.tipo_cliente || undefined,
                frete: q.frete || undefined,
                // Aceita a faixa (CIF_SUL) ou o modFrete da NF-e (0..9); o nucleo
                // traduz o modFrete pela UF de destino. redespacho forca a faixa REDESPACHO_SP.
                redespacho: q.redespacho === undefined ? undefined : q.redespacho,
                condicao_pagamento: q.condicao_pagamento || undefined,
                faturamento_tipo: q.faturamento_tipo || undefined,
                is_representante: q.is_representante === undefined ? undefined : /^(1|true|sim)$/i.test(String(q.is_representante)),
                preco_referencia: q.preco_referencia === undefined ? undefined : Number(q.preco_referencia)
            };
            Object.keys(opcoes).forEach(k => opcoes[k] === undefined && delete opcoes[k]);

            const r = core.calcularProduto(produto, data.parametros, opcoes);
            const gordura = core.analisarDesconto(produto, data.parametros, {
                ...opcoes,
                preco_base: r.preco
            });

            res.json({
                success: true,
                produto: {
                    codigo: produto.codigo, descricao: produto.descricao,
                    un: produto.un || 'm', familia: produto.familia || null,
                    complexidade: produto.complexidade || null, ipi_pct: produto.ipi_pct || 0
                },
                contexto: {
                    filial: r.contexto.filial, origem: r.contexto.origem, uf: r.contexto.uf,
                    tipo_cliente: r.contexto.tipo_cliente, frete: r.contexto.frete,
                    condicao_pagamento: r.contexto.condicao_pagamento,
                    prazo_medio_dias: r.contexto.prazo_medio_dias,
                    faturamento_tipo: r.contexto.faturamento_tipo, fator_nf: r.contexto.fator_nf
                },
                preco: {
                    custo_material: r.custo_material,
                    custo_fabril: r.custo_fabril,
                    markup_pct: r.markup_pct_aplicado,
                    markup_venda_pct: r.markup_venda_pct,
                    despesas_formacao: r.despesas_formacao,
                    bruto_sem_imposto: r.bruto_vendas_sem_imposto,
                    preco_venda_com_imposto: r.preco_venda_com_imposto,
                    fiscal_efetivo_pct: r.fiscal_efetivo_pct,
                    sugerido: r.preco_sugerido,
                    aplicado: r.preco,
                    base_origem: r.base_origem,
                    // R$/Kg = preço ÷ peso por metro, a MESMA conta da coluna R$/Kg da
                    // Prévia de Preços (cpPrecoPorKg em public/js/custos-precificacao.js).
                    // `preco_planilha_kg` não é gravado por nenhuma rotina do sistema,
                    // então esta chave saía sempre null na ficha exportada.
                    preco_kg: (() => {
                        // Peso por metro, na MESMA precedência da listagem:
                        //  1) kg_total do próprio item;
                        //  2) kg_total da BASE, quando o código é variante derivada —
                        //     UN10AZ não existe no JSON da árvore, é a variante "AZ" de
                        //     UN10, e a listagem herda o consolidado da base
                        //     (`...(catalog || {})`). Sem este degrau a ficha caía na
                        //     soma de kg_m e divergia ~0,9% da coluna R$/Kg da tela;
                        //  3) soma de kg_m, último recurso.
                        const pesoDe = item => Number((item || {}).kg_total || 0);
                        let peso = pesoDe(produto);
                        if (!(peso > 0)) {
                            const base = alvo.replace(/(?:-\d{2}|[A-Z]{1,2})$/, '');
                            if (base && base !== alvo) {
                                // `catalogo` e `normalizeCodePreco` são locais de
                                // resolverProdutoPrecificavel() e NÃO existem aqui — usá-los
                                // jogava `ReferenceError: catalogo is not defined`, que a rota
                                // devolvia como 500 "Erro ao precificar item". Efeito na tela:
                                // o modal "Novo Item de Pedido de Venda" não gravava nada.
                                // `data` está no escopo e é a mesma fonte que a função usa.
                                const produtosDaArvore = Array.isArray(data.products) ? data.products : [];
                                peso = pesoDe(produtosDaArvore.find(
                                    x => String(x.codigo || '').trim().toUpperCase() === base
                                ));
                            }
                        }
                        if (!(peso > 0)) {
                            peso = Object.keys(produto.kg_m || {})
                                .reduce((soma, m) => soma + (Number(produto.kg_m[m]) || 0), 0);
                        }
                        return (peso > 0 && Number(r.preco) > 0)
                            ? Number((Number(r.preco) / peso).toFixed(4))
                            : null;
                    })(),
                    piso: gordura.preco_minimo_comercial,
                    ponto_equilibrio: gordura.preco_equilibrio,
                    ipi: r.ipi, icms_st: r.icms_st,
                    total_com_impostos_por_fora: r.preco_com_impostos_por_fora
                },
                margem: {
                    fiscal_pct: r.fiscal_pct, fiscal_liquido: r.fiscal_liquido,
                    despesas_pct: r.contexto.despesas_total_pct, despesas: r.sumDesp,
                    ebitda: r.ebitda, ebitda_pct: r.ebitda_pct,
                    excedente_pct: r.excedente_pct, margem_alvo_pct: r.margem_alvo_pct,
                    crivo: r.crivo_rotulo, crivo_nivel: r.crivo_nivel
                },
                desconto: {
                    limite_politica_pct: gordura.limite_politica_pct,
                    disponivel_pct: gordura.desconto_disponivel_pct,
                    disponivel_valor: gordura.desconto_disponivel_valor,
                    regra_limitante: gordura.regra_limitante,
                    margem_ja_negativa: gordura.margem_ja_negativa
                },
                custo_origem: r.custo_origem
            });
        } catch (err) {
            console.error('[PCP] Erro ao precificar item:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao precificar item.' });
        }
    });

    // ------------------------------------------------------------------
    // POST /arvore-produto/repricar-pedido/:id
    // Repreça TODOS os itens de um pedido/orçamento pelo contexto dele.
    //
    // Existe porque o tipo de frete é escolhido no CABEÇALHO do pedido, não no
    // item: trocar FOB por CIF muda a faixa de frete de todos os itens de uma
    // vez. Repetir isso item a item pelo front esbarraria na trava de piso — o
    // preço de tabela novo pode ser MENOR que o `produtos.preco_venda` que serve
    // de piso, e o PUT do item devolveria 403 PRECO_ABAIXO_DO_PISO.
    //
    // O preço é sempre recalculado AQUI, a partir do núcleo — nunca aceito do
    // cliente. O contexto pode vir no corpo porque o vendedor repreça ANTES de
    // salvar o cabeçalho; o que faltar cai no que está gravado no pedido. São os
    // mesmos campos que o GET /arvore-produto/preco/:codigo já aceita.
    // ------------------------------------------------------------------
    router.post('/arvore-produto/repricar-pedido/:id', async (req, res) => {
        let conn = null;
        try {
            const pedidoId = parseInt(req.params.id, 10);
            if (!Number.isFinite(pedidoId) || pedidoId <= 0) {
                return res.status(400).json({ success: false, message: 'Pedido inválido.' });
            }
            const path = require('path');
            const fs = require('fs');
            const core = require(path.join(__dirname, '..', 'public', 'js', 'custos-precificacao-core.js'));
            const dataPath = arvoreFonte.resolverArvore();
            if (!fs.existsSync(dataPath)) {
                return res.status(404).json({ success: false, message: 'Dados da árvore de produto não encontrados.' });
            }
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

            conn = await pool.getConnection();
            const [[pedido]] = await conn.query(
                `SELECT p.id, p.status, p.tipo_venda, p.tipo_frete, p.condicao_pagamento,
                        p.condicoes_pagamento, p.parcelas,
                        p.is_representante, p.faturamento_tipo,
                        COALESCE(NULLIF(p.estado_destino, ''), c.estado, 'SP') AS estado_destino
                   FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
                  WHERE p.id = ? LIMIT 1`, [pedidoId]);
            if (!pedido) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            /* 🔴 TRAVA DE STATUS — faltava, e a rota irmã `aplicar-precos` sempre teve.
             *
             * Sem ela, trocar o Tipo do Frete (ou os toggles Representante / 50% NF) repreçava
             * QUALQUER pedido: medido em 09/09/2026, 101 itens de 44 pedidos tiveram o preço
             * negociado elevado ao preço do motor, entre eles um pedido em análise de crédito,
             * um aguardando faturamento e um JÁ FATURADO (3571) — cujo preço deveria bater com
             * a nota emitida. Fora do orçamento o preço combinado é fato, não sugestão. */
            const statusPedido = String(pedido.status || '').trim().toLowerCase();
            if (statusPedido !== 'orcamento') {
                return res.json({
                    success: true, atualizados: 0, ignorados: 0, preservados: 0, itens: [], contexto: null,
                    bloqueadoPorStatus: true,
                    message: 'Este pedido já saiu do orçamento — os preços negociados foram mantidos.'
                });
            }

            const b = req.body || {};
            const naoVazio = (...vs) => vs.find(v => v !== undefined && v !== null && String(v).trim() !== '');
            const tipoVenda = String(naoVazio(b.tipo_cliente, pedido.tipo_venda, 'consumidor')).toLowerCase();
            const opcoes = {
                uf: String(naoVazio(b.uf, pedido.estado_destino, 'SP')).toUpperCase(),
                tipo_cliente: (tipoVenda === 'consumidor' || tipoVenda === 'consumidor_final')
                    ? 'consumidor_final' : 'revenda',
                frete: naoVazio(b.frete, pedido.tipo_frete),
                condicao_pagamento: naoVazio(b.condicao_pagamento, pedido.condicao_pagamento,
                    pedido.condicoes_pagamento, pedido.parcelas),
                // Booleano não pode passar por naoVazio(): `false` é valor legítimo e seria
                // descartado como "vazio", fazendo o pedido voltar sozinho para representante.
                is_representante: b.is_representante !== undefined
                    ? (b.is_representante === true || b.is_representante === 1 || b.is_representante === '1')
                    : Boolean(Number(pedido.is_representante) || 0),
                faturamento_tipo: naoVazio(b.faturamento_tipo, pedido.faturamento_tipo, 'Total')
            };
            Object.keys(opcoes).forEach(k => opcoes[k] === undefined && delete opcoes[k]);

            /* `preco_manual` diz quem escreveu o preço de cada item: a pessoa ou o motor.
             *
             * Comparar o preço gravado com o preço recalculado NÃO serve como régua — os
             * parâmetros de custo (preço do kg do alumínio) mudam de um dia para o outro, então
             * recalcular hoje jamais reproduz o preço de ontem. Medido em 09/09/2026: por esse
             * critério 100% dos itens pareciam "digitados à mão" e o repreço virava letra morta.
             *
             * Base sem a migração devolve ER_BAD_FIELD_ERROR: o repreço volta a valer para todos
             * os itens, que é exatamente o comportamento antigo. */
            let temColunaPrecoManual = true;
            let itens;
            try {
                [itens] = await conn.query(
                    `SELECT id, codigo, quantidade, preco_unitario, desconto,
                            COALESCE(preco_manual, 0) AS preco_manual
                       FROM pedido_itens WHERE pedido_id = ? ORDER BY id`, [pedidoId]);
            } catch (e) {
                if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
                temColunaPrecoManual = false;
                console.warn('[PCP] repricar: pedido_itens.preco_manual não existe nesta base.');
                [itens] = await conn.query(
                    `SELECT id, codigo, quantidade, preco_unitario, desconto, 0 AS preco_manual
                       FROM pedido_itens WHERE pedido_id = ? ORDER BY id`, [pedidoId]);
            }
            if (!itens.length) {
                return res.json({ success: true, atualizados: 0, ignorados: 0, preservados: 0, itens: [], contexto: null });
            }

            // Um mesmo código costuma repetir no pedido; resolver e precificar uma
            // vez por código evita reler a estrutura para cada linha.
            const porCodigo = new Map();
            const alterados = [];
            const preservados = [];
            let atualizados = 0;
            let ignorados = 0;
            let contexto = null;

            // Meio centavo: a mesma tolerância que a trava de piso usa para comparar preços.
            const MESMO_PRECO = 0.005;

            for (const item of itens) {
                const codigo = String(item.codigo || '').trim().toUpperCase();
                if (!codigo) { ignorados++; continue; }
                const atual = Number(item.preco_unitario) || 0;

                /* 🔴 PRESERVAR O PREÇO NEGOCIADO.
                 *
                 * Antes o UPDATE era incondicional e apagava tudo. No pedido 3603 (09/09/2026) a
                 * vendedora montou 21 itens com preço negociado e autorizado por senha de
                 * supervisor; um clique num toggle de cabeçalho devolveu os 21 ao preço do motor
                 * (DUI10 2,02 → 4,8150; QDI50 20,60 → 38,1071) e alguém redigitou os 21 à mão.
                 *
                 * Preço que uma pessoa digitou é decisão comercial e não se mexe; o resto
                 * acompanha o contexto. Sai antes de precificar: item preservado não precisa nem
                 * ser calculado. */
                if (Number(item.preco_manual) === 1) {
                    preservados.push({ id: item.id, codigo, preco_unitario: atual });
                    continue;
                }

                if (!porCodigo.has(codigo)) {
                    let preco = null;
                    try {
                        const produto = await resolverProdutoPrecificavel(data, codigo);
                        if (produto) {
                            const r = core.calcularProduto(produto, data.parametros, opcoes);
                            if (!contexto) contexto = r.contexto;
                            const sugerido = Number(r.preco_sugerido || r.preco || 0);
                            if (sugerido > 0) preco = Math.round(sugerido * 10000) / 10000;
                        }
                    } catch (e) {
                        console.warn('[PCP] repricar: falha em', codigo, e.message);
                    }
                    porCodigo.set(codigo, preco);
                }
                const novo = porCodigo.get(codigo);
                if (!(novo > 0)) { ignorados++; continue; }
                if (Math.abs(atual - novo) <= MESMO_PRECO) continue;

                const qtd = Number(item.quantidade) || 0;
                const desc = Number(item.desconto) || 0;
                const subtotal = Math.round(Math.max(0, qtd * novo - desc) * 100) / 100;
                await conn.query(
                    'UPDATE pedido_itens SET preco_unitario = ?, subtotal = ? WHERE id = ? AND pedido_id = ?',
                    [novo, subtotal, item.id, pedidoId]);
                atualizados++;
                alterados.push({
                    id: item.id, codigo,
                    preco_anterior: atual,
                    preco_unitario: novo, subtotal
                });
            }

            /* Rastro. O repreço era MUDO: não escrevia nada em `pedido_historico`, então a linha
             * do tempo do pedido 3603 tem um buraco entre 20:18 e 20:29 exatamente onde os 21
             * preços foram reescritos — ninguém conseguia ver que tinha acontecido, nem quem fez. */
            if (alterados.length) {
                try {
                    const resumo = alterados
                        .map(a => `${a.codigo} ${a.preco_anterior} -> ${a.preco_unitario}`)
                        .join('; ');
                    await conn.query(
                        `INSERT INTO pedido_historico
                             (pedido_id, usuario_id, usuario_nome, acao, descricao, meta, created_at)
                         VALUES (?, ?, ?, 'itens_reprecados', ?, ?, NOW())`,
                        [
                            pedidoId,
                            req.user?.id || null,
                            req.user?.nome || req.user?.email || 'PCP',
                            `${alterados.length} item(ns) repreçado(s) pelo contexto`
                                + (preservados.length ? `; ${preservados.length} preservado(s) por preço negociado` : '')
                                + `: ${resumo}`.slice(0, 600),
                            JSON.stringify({ contexto: opcoes, itens: alterados, preservados })
                        ]);
                } catch (e) {
                    console.warn('[PCP] repricar: não consegui registrar o histórico:', e.message);
                }
            }

            res.json({
                success: true, atualizados, ignorados,
                preservados: preservados.length, itens: alterados,
                // Sem a coluna a base não distingue procedência e tudo volta a ser repreçável —
                // vale aparecer na resposta para não diagnosticar isso às cegas depois.
                procedenciaDisponivel: temColunaPrecoManual,
                contexto: contexto ? {
                    uf: contexto.uf, frete: contexto.frete,
                    tipo_cliente: contexto.tipo_cliente,
                    condicao_pagamento: contexto.condicao_pagamento,
                    prazo_medio_dias: contexto.prazo_medio_dias,
                    frete_pct: contexto.despesas.frete
                } : null
            });
        } catch (err) {
            console.error('[PCP] Erro ao repricar pedido:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao repreçar os itens do pedido.' });
        } finally {
            if (conn) conn.release();
        }
    });

    // Salvar parâmetros de custo (preços kg, markup, despesas)
    router.put('/arvore-produto/parametros', async (req, res) => {
        try {
            const path = require('path');
            const fs = require('fs');
            const dataPath = arvoreFonte.resolverArvore();

            if (!fs.existsSync(dataPath)) {
                return res.status(404).json({ success: false, message: 'Arquivo de dados não encontrado.' });
            }

            const rawData = fs.readFileSync(dataPath, 'utf-8');
            const data = JSON.parse(rawData);

            const { precos_kg, markup_pct, markup_venda_pct, despesas } = req.body;
            if (precos_kg) data.parametros.precos_kg = precos_kg;
            if (markup_pct !== undefined) data.parametros.markup_pct = parseFloat(markup_pct);
            if (markup_venda_pct !== undefined) {
                const markupVenda = parseFloat(markup_venda_pct);
                if (Number.isFinite(markupVenda) && markupVenda >= 0 && markupVenda <= 1000) {
                    data.parametros.markup_venda_pct = markupVenda;
                }
            }
            if (despesas) data.parametros.despesas = despesas;
            // Novos campos de precificação por estado
            if (req.body.icms_estados) data.parametros.icms_estados = req.body.icms_estados;
            if (req.body.frete_opcoes || req.body['frete_opções']) data.parametros.frete_opcoes = req.body.frete_opcoes || req.body['frete_opções'];
            if (req.body.comissao_normal !== undefined) data.parametros.comissao_normal = parseFloat(req.body.comissao_normal);
            if (req.body.comissao_representante !== undefined) data.parametros.comissao_representante = parseFloat(req.body.comissao_representante);
            if (req.body.estado_selecionado !== undefined) data.parametros.estado_selecionado = req.body.estado_selecionado;
            if (req.body.tipo_cliente !== undefined) data.parametros.tipo_cliente = req.body.tipo_cliente;
            if (req.body.is_representante !== undefined) data.parametros.is_representante = req.body.is_representante;
            if (req.body.frete_selecionado !== undefined) data.parametros.frete_selecionado = req.body.frete_selecionado;

            // Modelo da Planilha de Vendas (rev. MARROM): filial emissora, taxas
            // -base, crivo de aprovação e a tabela de prazos que rateia o
            // financeiro. Numéricos são saneados; os mapas vêm do próprio modal.
            const NUMERICOS = [
                'custo_fixo_pct', 'financeiro_mensal_pct', 'credito_icms_pct', 'acerto_custo_pct',
                'margem_alvo_pct', 'bobina_pct', 'perc_nf', 'prazo_medio_dias'
            ];
            for (const campo of NUMERICOS) {
                if (req.body[campo] === undefined) continue;
                const valor = parseFloat(req.body[campo]);
                if (Number.isFinite(valor) && valor >= 0 && valor <= 100000) data.parametros[campo] = valor;
            }
            const TEXTOS = ['filial_selecionada', 'faturamento_tipo', 'condicao_pagamento', 'modo_preco_sugerido'];
            for (const campo of TEXTOS) {
                if (typeof req.body[campo] === 'string' && req.body[campo].length <= 120) {
                    data.parametros[campo] = req.body[campo];
                }
            }
            const MAPAS = ['insumos', 'densidades', 'perdas_pct', 'filiais', 'prazos_pagamento',
                'complexidade', 'markup_por_complexidade', 'frete_rotulos', 'crivo'];
            for (const campo of MAPAS) {
                if (req.body[campo] && typeof req.body[campo] === 'object') data.parametros[campo] = req.body[campo];
            }
            if (req.body.usar_markup_planilha !== undefined) {
                data.parametros.usar_markup_planilha = Boolean(req.body.usar_markup_planilha);
            }
            if (req.body.usar_preco_referencia !== undefined) {
                data.parametros.usar_preco_referencia = Boolean(req.body.usar_preco_referencia);
            }

            // Grava FORA de api/ — ver utils/arvore-produto-fonte.js.
            const destinoArvore = arvoreFonte.gravarArvore(data);
            console.log('[PCP] Parâmetros de custo atualizados com sucesso em', destinoArvore);

            res.json({ success: true, message: 'Parâmetros salvos com sucesso.', parametros: data.parametros });
        } catch (err) {
            console.error('[PCP] Erro ao salvar parâmetros:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao salvar parâmetros.' });
        }
    });

    // Aplicar preços ao catálogo e somente aos itens de pedidos em orçamento.
    // Pedidos em análise de crédito ou qualquer etapa posterior preservam o preço
    // negociado, inclusive quando o preço do cadastro do produto muda.
    router.post('/arvore-produto/aplicar-precos', async (req, res) => {
        let connection = null;
        try {
            const { precos } = req.body;
            if (!Array.isArray(precos) || precos.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum preço informado.' });
            }
            if (precos.length > 5000) {
                return res.status(400).json({ success: false, message: 'Limite de 5.000 produtos por aplicação.' });
            }

            const uniquePrices = new Map();
            for (const item of precos) {
                const codigo = String(item && item.codigo || '').trim();
                const precoVenda = Number(item && item.preco_venda);
                const precoCusto = Number(item && item.preco_custo);
                const markup = Number(item && item.markup_pct);
                const margem = Number(item && item.margem_bruta_pct);
                const margemLucro = Number(item && item.margem_liquida_pct);
                const precoMinimo = Number(item && item.preco_minimo);
                const precoEquilibrio = Number(item && item.preco_equilibrio);
                if (!codigo || codigo.length > 255 || !Number.isFinite(precoVenda) || precoVenda <= 0) continue;
                if (!Number.isFinite(precoCusto) || precoCusto < 0) continue;
                if (!Number.isFinite(markup) || markup < 0 || markup > 10000) continue;
                if (!Number.isFinite(margem) || margem < -100 || margem > 100) continue;
                if (!Number.isFinite(margemLucro) || margemLucro < -100 || margemLucro > 100) continue;
                uniquePrices.set(codigo.toUpperCase(), {
                    codigo, precoVenda, precoCusto, markup, margem, margemLucro,
                    // Piso do crivo: só grava se for um número plausível e não
                    // ultrapassar o próprio preço aplicado.
                    precoMinimo: (Number.isFinite(precoMinimo) && precoMinimo > 0 && precoMinimo <= precoVenda * 10)
                        ? precoMinimo : null,
                    precoEquilibrio: (Number.isFinite(precoEquilibrio) && precoEquilibrio > 0 && precoEquilibrio <= precoVenda * 10)
                        ? precoEquilibrio : null
                });
            }
            if (uniquePrices.size === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum preço válido informado.' });
            }

            // `preco_minimo` é o piso do crivo. Nem toda base tem a coluna —
            // quando não tem, o piso continua sendo o preço de venda (que é o
            // que a trava de desconto de Vendas já lê).
            let temColunaPisoPreco = false;
            let temColunaEquilibrioPreco = false;
            try {
                const [colunasPreco] = await pool.query(`
                    SELECT COLUMN_NAME FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos'
                       AND COLUMN_NAME IN ('preco_minimo', 'preco_equilibrio')
                `);
                const nomesColunasPreco = new Set(colunasPreco.map(c => c.COLUMN_NAME));
                temColunaPisoPreco = nomesColunasPreco.has('preco_minimo');
                temColunaEquilibrioPreco = nomesColunasPreco.has('preco_equilibrio');
            } catch (e) {
                console.warn('[PCP] Não consegui checar produtos.preco_minimo:', e.message);
            }

            connection = await pool.getConnection();
            await connection.beginTransaction();
            let atualizados = 0;
            let pisosGravados = 0;
            let itensOrcamentoAtualizados = 0;
            const pedidosOrcamento = new Set();
            const pedidosProtegidos = new Set();
            const itensProtegidos = new Set();

            for (const item of uniquePrices.values()) {
                const [[product]] = await connection.query(
                    'SELECT id, codigo FROM produtos WHERE UPPER(TRIM(codigo)) = ? LIMIT 1 FOR UPDATE',
                    [item.codigo.toUpperCase()]
                );
                if (!product) continue;

                const [productResult] = await connection.query(`
                    UPDATE produtos
                       SET preco_venda = ?, preco = ?, preco_custo = ?, custo_unitario = ?,
                           markup = ?, margem = ?, margem_lucro = ?, updated_at = NOW()
                     WHERE id = ?
                `, [
                    item.precoVenda, item.precoVenda, item.precoCusto, item.precoCusto,
                    item.markup, item.margem, item.margemLucro, product.id
                ]);
                atualizados += productResult.affectedRows;

                if (temColunaPisoPreco && item.precoMinimo) {
                    const [pisoResult] = await connection.query(
                        'UPDATE produtos SET preco_minimo = ? WHERE id = ?',
                        [item.precoMinimo, product.id]
                    );
                    pisosGravados += pisoResult.affectedRows;
                }
                if (temColunaEquilibrioPreco && item.precoEquilibrio) {
                    await connection.query(
                        'UPDATE produtos SET preco_equilibrio = ? WHERE id = ?',
                        [item.precoEquilibrio, product.id]
                    );
                }

                const itemMatchSql = '(pi.produto_id = ? OR UPPER(TRIM(pi.codigo)) = ?)';
                const itemMatchParams = [product.id, item.codigo.toUpperCase()];
                const [budgetItems] = await connection.query(`
                    SELECT pi.id, p.id AS pedido_id
                      FROM pedido_itens pi
                      JOIN pedidos p ON p.id = pi.pedido_id
                     WHERE LOWER(TRIM(p.status)) = 'orcamento'
                       AND ${itemMatchSql}
                `, itemMatchParams);
                budgetItems.forEach(row => pedidosOrcamento.add(Number(row.pedido_id)));

                const [lockedItems] = await connection.query(`
                    SELECT pi.id, p.id AS pedido_id
                      FROM pedido_itens pi
                      JOIN pedidos p ON p.id = pi.pedido_id
                     WHERE LOWER(TRIM(p.status)) <> 'orcamento'
                       AND ${itemMatchSql}
                `, itemMatchParams);
                lockedItems.forEach(row => {
                    itensProtegidos.add(Number(row.id));
                    pedidosProtegidos.add(Number(row.pedido_id));
                });

                const [itemsResult] = await connection.query(`
                    UPDATE pedido_itens pi
                    JOIN pedidos p ON p.id = pi.pedido_id
                       SET pi.preco_unitario = ?,
                           pi.preco_custo = ?,
                           pi.subtotal = GREATEST((pi.quantidade * ?) - COALESCE(pi.desconto, 0), 0)
                     WHERE LOWER(TRIM(p.status)) = 'orcamento'
                       AND ${itemMatchSql}
                `, [item.precoVenda, item.precoCusto, item.precoVenda, ...itemMatchParams]);
                itensOrcamentoAtualizados += itemsResult.affectedRows;
            }

            const budgetOrderIds = [...pedidosOrcamento];
            if (budgetOrderIds.length > 0) {
                await connection.query(`
                    UPDATE pedidos p
                    JOIN (
                        SELECT pedido_id,
                               COALESCE(SUM(subtotal), 0) AS total_subtotais,
                               COALESCE(SUM(valor_ipi), 0) AS total_ipi,
                               COALESCE(SUM(valor_icms_st), 0) AS total_icms_st
                          FROM pedido_itens
                         WHERE pedido_id IN (?)
                         GROUP BY pedido_id
                    ) totals ON totals.pedido_id = p.id
                       SET p.valor = totals.total_subtotais + totals.total_ipi + totals.total_icms_st + COALESCE(p.frete, 0),
                           p.updated_at = NOW()
                     WHERE p.id IN (?)
                       AND LOWER(TRIM(p.status)) = 'orcamento'
                `, [budgetOrderIds, budgetOrderIds]);
            }

            await connection.commit();
            try {
                const cacheService = require('../services/cache');
                if (cacheService && cacheService.cacheClear) {
                    await cacheService.cacheClear('vendas_pedidos');
                }
            } catch (cacheError) {
                console.warn('[PCP] Cache de pedidos não invalidado:', cacheError.message);
            }

            console.log(`[PCP] Preços aplicados: ${atualizados} produtos, ${itensOrcamentoAtualizados} itens em orçamento; `
                + `${itensProtegidos.size} itens protegidos; ${pisosGravados} pisos gravados`);
            res.json({
                success: true,
                atualizados,
                pisos_gravados: pisosGravados,
                piso_persistido: temColunaPisoPreco,
                total: uniquePrices.size,
                itens_orcamento_atualizados: itensOrcamentoAtualizados,
                pedidos_orcamento_atualizados: pedidosOrcamento.size,
                itens_protegidos: itensProtegidos.size,
                pedidos_protegidos: pedidosProtegidos.size
            });
        } catch (err) {
            if (connection) await connection.rollback();
            console.error('[PCP] Erro ao aplicar preços:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao aplicar preços.' });
        } finally {
            if (connection) connection.release();
        }
    });

    // =====================================================
    // ROTAS ADICIONADAS — Correção de botões quebrados
    // =====================================================

    // BUSCA GLOBAL — Usado pela barra de pesquisa do dashboard PCP
    router.get('/search', async (req, res) => {
        try {
            const q = req.query.q || '';
            const type = req.query.type || '';
            const limit = parseInt(req.query.limit) || 20;

            if (!q || q.length < 2) {
                return res.json({ results: { ordens: [], materiais: [], produtos: [], pedidos: [] } });
            }

            const searchPattern = `%${q}%`;
            const results = {};

            // Buscar ordens
            if (!type || type === 'ordens' || type === 'Ordem') {
                try {
                    const [ordens] = await pool.query(
                        `SELECT id, codigo_produto, descricao_produto, cliente, status
                         FROM ordens_producao
                         WHERE codigo_produto LIKE ? OR descricao_produto LIKE ? OR cliente LIKE ? OR CAST(id AS CHAR) = ?
                         ORDER BY id DESC LIMIT ?`,
                        [searchPattern, searchPattern, searchPattern, q, limit]
                    );
                    results.ordens = ordens;
                } catch (e) { results.ordens = []; }
            }

            // Buscar materiais
            if (!type || type === 'materiais' || type === 'Material') {
                try {
                    const [materiais] = await pool.query(
                        `SELECT id, codigo_material, descricao, quantidade_estoque
                         FROM materiais
                         WHERE codigo_material LIKE ? OR descricao LIKE ?
                         ORDER BY descricao LIMIT ?`,
                        [searchPattern, searchPattern, limit]
                    );
                    results.materiais = materiais;
                } catch (e) { results.materiais = []; }
            }

            // Buscar produtos
            if (!type || type === 'produtos' || type === 'Produto') {
                try {
                    const [produtos] = await pool.query(
                        `SELECT id, codigo, nome AS descricao, estoque_atual AS quantidade_estoque
                         FROM produtos
                         WHERE codigo LIKE ? OR nome LIKE ? OR gtin LIKE ? OR sku LIKE ?
                         ORDER BY nome LIMIT ?`,
                        [searchPattern, searchPattern, searchPattern, searchPattern, limit]
                    );
                    results.produtos = produtos;
                } catch (e) { results.produtos = []; }
            }

            // Buscar pedidos
            if (!type || type === 'pedidos' || type === 'Pedido') {
                try {
                    const [pedidos] = await pool.query(
                        `SELECT id, cliente, produto_id, quantidade, status
                         FROM pedidos
                         WHERE cliente LIKE ? OR CAST(id AS CHAR) = ? OR produto_id LIKE ?
                         ORDER BY id DESC LIMIT ?`,
                        [searchPattern, q, searchPattern, limit]
                    );
                    results.pedidos = pedidos;
                } catch (e) { results.pedidos = []; }
            }

            res.json({ results });
        } catch (error) {
            console.error('[PCP/SEARCH] Erro:', error.message);
            res.status(500).json({ results: { ordens: [], materiais: [], produtos: [], pedidos: [] } });
        }
    });

    // ============================================================================
    // EXPORT EXCEL — Base de produtos (dados reais) em .xlsx, com 2 abas:
    //   "Produtos"  → cadastro completo (código, descrição, fiscal, preços, estoque…)
    //   "Estrutura" → composição/BOM de cada produto (tabela estrutura_produto)
    // Usado pelo botão "Baixar base" da página PCP > Estrutura dos Produtos.
    // ============================================================================
    // Exige login: a planilha traz custo, margem e preços (dado sensível).
    router.get('/produtos/export-excel', authenticateToken, async (req, res) => {
        try {
            const ExcelJS = require('exceljs');

            const [produtos] = await pool.query(`
                SELECT codigo, nome, descricao, categoria, familia, tipo_produto, unidade_medida,
                       ncm, cest, gtin, sku, origem, marca, material, secao, tensao, norma,
                       preco_custo, custo_unitario, preco_venda, margem_lucro,
                       estoque_atual, estoque_minimo, estoque_maximo, localizacao,
                       cst_icms, csosn_icms, aliquota_icms, mva_st, calcular_icms_st,
                       cst_ipi, aliquota_ipi, calcular_ipi,
                       cfop_saida_interna, cfop_saida_interestadual,
                       fornecedor_principal, peso, comprimento, largura, altura,
                       observacoes, ativo
                  FROM produtos
                 ORDER BY codigo`);

            // Se a tabela de estrutura não existir na instância, exporta só os produtos.
            const [estrutura] = await pool.query(`
                SELECT produto_codigo, produto_descricao, componente_codigo, componente_descricao,
                       componente_tipo, quantidade_por_metro, unidade, local_estoque, ativo
                  FROM estrutura_produto
                 ORDER BY produto_codigo, componente_codigo`).catch(() => [[]]);

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Zyntra';
            wb.created = new Date();

            const estiloCabecalho = (ws) => {
                const h = ws.getRow(1);
                h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
                h.alignment = { vertical: 'middle' };
                h.height = 20;
                ws.views = [{ state: 'frozen', ySplit: 1 }];
                ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
            };
            // Largura automática (limitada) a partir do conteúdo.
            const ajustarLarguras = (ws) => {
                ws.columns.forEach(col => {
                    let max = String(col.header || '').length;
                    col.eachCell({ includeEmpty: false }, c => {
                        const v = c.value == null ? '' : String(c.value);
                        if (v.length > max) max = v.length;
                    });
                    col.width = Math.min(Math.max(max + 2, 10), 45);
                });
            };

            // ---- Aba 1: Produtos ----
            const wsP = wb.addWorksheet('Produtos');
            wsP.columns = [
                { header: 'Código', key: 'codigo' }, { header: 'Nome', key: 'nome' },
                { header: 'Descrição', key: 'descricao' }, { header: 'Categoria', key: 'categoria' },
                { header: 'Família', key: 'familia' }, { header: 'Tipo', key: 'tipo_produto' },
                { header: 'Unidade', key: 'unidade_medida' },
                { header: 'NCM', key: 'ncm' }, { header: 'CEST', key: 'cest' },
                { header: 'GTIN', key: 'gtin' }, { header: 'SKU', key: 'sku' },
                { header: 'Origem', key: 'origem' }, { header: 'Marca', key: 'marca' },
                { header: 'Material', key: 'material' }, { header: 'Seção', key: 'secao' },
                { header: 'Tensão', key: 'tensao' }, { header: 'Norma', key: 'norma' },
                { header: 'Preço custo', key: 'preco_custo' }, { header: 'Custo unitário', key: 'custo_unitario' },
                { header: 'Preço venda', key: 'preco_venda' }, { header: 'Margem (%)', key: 'margem_lucro' },
                { header: 'Estoque atual', key: 'estoque_atual' }, { header: 'Estoque mín.', key: 'estoque_minimo' },
                { header: 'Estoque máx.', key: 'estoque_maximo' }, { header: 'Localização', key: 'localizacao' },
                { header: 'CST ICMS', key: 'cst_icms' }, { header: 'CSOSN', key: 'csosn_icms' },
                { header: 'Alíq. ICMS (%)', key: 'aliquota_icms' }, { header: 'MVA ST (%)', key: 'mva_st' },
                { header: 'Calcula ICMS-ST', key: 'calcular_icms_st' },
                { header: 'CST IPI', key: 'cst_ipi' }, { header: 'Alíq. IPI (%)', key: 'aliquota_ipi' },
                { header: 'Calcula IPI', key: 'calcular_ipi' },
                { header: 'CFOP saída interna', key: 'cfop_saida_interna' },
                { header: 'CFOP saída interest.', key: 'cfop_saida_interestadual' },
                { header: 'Fornecedor', key: 'fornecedor_principal' },
                { header: 'Peso', key: 'peso' }, { header: 'Comprimento', key: 'comprimento' },
                { header: 'Largura', key: 'largura' }, { header: 'Altura', key: 'altura' },
                { header: 'Observações', key: 'observacoes' }, { header: 'Ativo', key: 'ativo' }
            ];
            produtos.forEach(p => wsP.addRow(p));
            estiloCabecalho(wsP);
            ajustarLarguras(wsP);

            // ---- Aba 2: Estrutura (composição / BOM) ----
            const wsE = wb.addWorksheet('Estrutura');
            wsE.columns = [
                { header: 'Produto (código)', key: 'produto_codigo' },
                { header: 'Produto (descrição)', key: 'produto_descricao' },
                { header: 'Componente (código)', key: 'componente_codigo' },
                { header: 'Componente (descrição)', key: 'componente_descricao' },
                { header: 'Tipo', key: 'componente_tipo' },
                { header: 'Qtd por metro', key: 'quantidade_por_metro' },
                { header: 'Unidade', key: 'unidade' },
                { header: 'Local de estoque', key: 'local_estoque' },
                { header: 'Ativo', key: 'ativo' }
            ];
            estrutura.forEach(e => wsE.addRow(e));
            estiloCabecalho(wsE);
            ajustarLarguras(wsE);

            const buffer = await wb.xlsx.writeBuffer();
            const nome = `base-produtos-${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
            res.setHeader('Content-Length', buffer.length);
            console.log(`[PCP] Base de produtos exportada: ${produtos.length} produtos, ${estrutura.length} linhas de estrutura.`);
            return res.end(Buffer.from(buffer));
        } catch (error) {
            console.error('[PCP] Erro ao exportar base de produtos:', error);
            return res.status(500).json({ error: 'Erro ao gerar o Excel da base de produtos.' });
        }
    });

    // EXPORT PDF — Produtos (gera HTML para impressão no navegador)
    router.get('/produtos/export-pdf', async (req, res) => {
        try {
            const [produtos] = await pool.query(
                `SELECT id, codigo, nome, sku, gtin, unidade_medida, estoque_atual, categoria, custo_unitario
                 FROM produtos WHERE (ativo = 1 OR ativo IS NULL)
                 ORDER BY nome`
            );

            const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Catálogo de Produtos</title>
<style>
body{font-family:Arial,sans-serif;margin:20px;color:#333}
h1{text-align:center;color:#1e40af;margin-bottom:5px}
.subtitle{text-align:center;color:#64748b;margin-bottom:20px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#1e40af;color:#fff;padding:8px 6px;text-align:left}
td{padding:6px;border-bottom:1px solid #e2e8f0}
tr:nth-child(even){background:#f8fafc}
.footer{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
@media print{body{margin:0}h1{font-size:18px}.no-print{display:none}}
</style></head><body>
<h1>Catálogo de Produtos — Zyntra</h1>
<p class="subtitle">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} — ${produtos.length} produtos</p>
<table><thead><tr><th>Código</th><th>Descrição</th><th>SKU</th><th>GTIN</th><th>Unidade</th><th>Estoque</th><th>Categoria</th><th>Custo Unit.</th></tr></thead>
<tbody>${produtos.map(p => `<tr><td>${p.codigo || ''}</td><td>${p.nome || ''}</td><td>${p.sku || ''}</td><td>${p.gtin || ''}</td><td>${p.unidade_medida || ''}</td><td>${Number(p.estoque_atual || 0).toFixed(2)}</td><td>${p.categoria || ''}</td><td>R$ ${Number(p.custo_unitario || 0).toFixed(2)}</td></tr>`).join('')}
</tbody></table>
<p class="footer">Zyntra — Sistema PCP</p>
</body></html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="catalogo_produtos_${new Date().toISOString().split('T')[0]}.html"`);
            res.send(html);
        } catch (error) {
            console.error('[PCP/EXPORT-PDF] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao gerar catálogo' });
        }
    });

    // EXPORT PDF — Materiais (gera HTML para impressão no navegador)
    router.get('/materiais/export-pdf', async (req, res) => {
        try {
            const [materiais] = await pool.query(
                `SELECT id, codigo_material, descricao, unidade_medida, quantidade_estoque, preco_unitario, fornecedor
                 FROM materiais ORDER BY descricao`
            );

            const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Catálogo de Materiais</title>
<style>
body{font-family:Arial,sans-serif;margin:20px;color:#333}
h1{text-align:center;color:#1e40af;margin-bottom:5px}
.subtitle{text-align:center;color:#64748b;margin-bottom:20px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#1e40af;color:#fff;padding:8px 6px;text-align:left}
td{padding:6px;border-bottom:1px solid #e2e8f0}
tr:nth-child(even){background:#f8fafc}
.footer{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
@media print{body{margin:0}h1{font-size:18px}}
</style></head><body>
<h1>Catálogo de Materiais — Zyntra</h1>
<p class="subtitle">Gerado em ${new Date().toLocaleDateString('pt-BR')} — ${materiais.length} materiais</p>
<table><thead><tr><th>Código</th><th>Descrição</th><th>Unidade</th><th>Estoque</th><th>Preço Unit.</th><th>Fornecedor</th></tr></thead>
<tbody>${materiais.map(m => `<tr><td>${m.codigo_material || ''}</td><td>${m.descricao || ''}</td><td>${m.unidade_medida || ''}</td><td>${Number(m.quantidade_estoque || 0).toFixed(2)}</td><td>R$ ${Number(m.preco_unitario || 0).toFixed(2)}</td><td>${m.fornecedor || ''}</td></tr>`).join('')}
</tbody></table>
<p class="footer">Zyntra — Sistema PCP</p>
</body></html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="catalogo_materiais_${new Date().toISOString().split('T')[0]}.html"`);
            res.send(html);
        } catch (error) {
            console.error('[PCP/EXPORT-PDF-MAT] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao gerar catálogo de materiais' });
        }
    });

    // RECEBIMENTOS — Registrar recebimento de material
    router.post('/recebimentos', async (req, res) => {
        try {
            const { data, nome, numero_nf, fornecedor, material, observacao, responsavel } = req.body;

            if (!data || !nome || !numero_nf || !fornecedor || !material) {
                return res.status(400).json({ message: 'Campos obrigatórios: data, nome, numero_nf, fornecedor, material' });
            }

            // Verificar se tabela existe, criar se não
            try {
                await pool.query('SELECT 1 FROM recebimentos_compras LIMIT 0');
            } catch (e) {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS recebimentos_compras (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        data DATE NOT NULL,
                        nome VARCHAR(255) NOT NULL,
                        numero_nf VARCHAR(100) NOT NULL,
                        fornecedor VARCHAR(255) NOT NULL,
                        material VARCHAR(255) NOT NULL,
                        observacao TEXT,
                        responsavel VARCHAR(255),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }

            const [result] = await pool.query(
                `INSERT INTO recebimentos_compras (data, nome, numero_nf, fornecedor, material, observacao, responsavel)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [data, nome, numero_nf, fornecedor, material, observacao || null, responsavel || null]
            );

            res.status(201).json({ success: true, message: 'Recebimento registrado com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[PCP/RECEBIMENTOS] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao registrar recebimento' });
        }
    });

    // EXTRUSÃO — Registrar dados de extrusão
    router.post('/extrusao', async (req, res) => {
        try {
            const { data, lote, extrusora, descricao, secao, metragem, bobinas, lote_corda,
                    lote_polimero, lote_corante, inspecao_visual, diametro, operador, observacoes } = req.body;

            if (!data || !lote || !extrusora || !descricao || !metragem || !operador) {
                return res.status(400).json({ message: 'Campos obrigatórios: data, lote, extrusora, descricao, metragem, operador' });
            }

            // Verificar/criar tabela
            try {
                await pool.query('SELECT 1 FROM extrusao_registros LIMIT 0');
            } catch (e) {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS extrusao_registros (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        data DATE NOT NULL,
                        lote VARCHAR(50) NOT NULL,
                        extrusora VARCHAR(100) NOT NULL,
                        descricao VARCHAR(255) NOT NULL,
                        secao VARCHAR(100),
                        metragem DECIMAL(12,2) NOT NULL,
                        bobinas INT,
                        lote_corda VARCHAR(100),
                        lote_polimero VARCHAR(100),
                        lote_corante VARCHAR(100),
                        inspecao_visual VARCHAR(50),
                        diametro DECIMAL(10,4),
                        operador VARCHAR(255) NOT NULL,
                        observacoes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }

            const [result] = await pool.query(
                `INSERT INTO extrusao_registros
                 (data, lote, extrusora, descricao, secao, metragem, bobinas, lote_corda, lote_polimero, lote_corante, inspecao_visual, diametro, operador, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [data, lote, extrusora, descricao, secao || null, metragem, bobinas || null,
                 lote_corda || null, lote_polimero || null, lote_corante || null,
                 inspecao_visual || null, diametro || null, operador, observacoes || null]
            );

            res.status(201).json({ success: true, message: 'Registro de extrusão salvo com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[PCP/EXTRUSAO] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao salvar registro de extrusão' });
        }
    });

    // NOTIFICAR ATIVIDADE — Push notification de ações de apontamento (início, pausa, finalização)
    router.post('/notificar-atividade', async (req, res) => {
        try {
            const { tipo_atividade, nome_atividade, acao, duracao } = req.body;
            const operador = req.user?.nome || req.body.operador || 'Operador';

            console.log(`[PCP/NOTIFICACAO] ${operador} ${acao} ${nome_atividade} (${tipo_atividade})${duracao ? ' — Duração: ' + duracao : ''}`);

            // Emitir via WebSocket para todos os clientes PCP conectados
            if (global.io) {
                global.io.emit('pcp-atividade', {
                    tipo: tipo_atividade,
                    nome: nome_atividade,
                    operador: operador || 'Operador',
                    acao: acao,
                    duracao: duracao || null,
                    timestamp: new Date().toISOString()
                });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('[PCP/NOTIFICACAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao notificar' });
        }
    });

    // APONTAMENTOS CHÃO DE FÁBRICA — Endpoint específico para salvar registros do chão de fábrica
    router.post('/apontamentos/chao', async (req, res) => {
        try {
            const { tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, ordem_producao_id, pedido_numero, produto_descricao, observacoes, maquina, turno, quantidade_produzida, quantidade_refugo, lances } = req.body;
            const usuario_id = req.user?.id;
            const operador = req.user?.nome || 'Operador';

            if (!tipo_atividade || !nome_atividade) {
                return res.status(400).json({ success: false, message: 'tipo_atividade e nome_atividade são obrigatórios' });
            }

            // Andamento por cabo: se vierem lances (qtd x metragem), converter em metros.
            // A quantidade explícita, se enviada, tem precedência.
            const qtdProdFinal = (Number(quantidade_produzida) > 0)
                ? Number(quantidade_produzida)
                : lancesParaMetros(lances);
            const obsFinal = lances
                ? `${observacoes ? observacoes + ' · ' : ''}Lances: ${String(lances).trim()}`
                : (observacoes || null);

            const horaInicioFormatada = hora_inicio ? new Date(hora_inicio).toISOString().slice(0, 19).replace('T', ' ') : null;
            const horaFimFormatada = hora_fim ? new Date(hora_fim).toISOString().slice(0, 19).replace('T', ' ') : null;

            // Anti-duplicidade: rejeitar se existe registro idêntico nos últimos 30s
            if (horaInicioFormatada) {
                try {
                    const [dup] = await pool.query(
                        `SELECT id FROM apontamentos_producao
                         WHERE usuario_id = ? AND tipo_atividade = ? AND hora_inicio = ?
                         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 SECOND) LIMIT 1`,
                        [usuario_id, tipo_atividade, horaInicioFormatada]
                    );
                    if (dup.length > 0) {
                        console.log('[PCP/APONTAMENTOS/CHAO] Duplicidade detectada, ignorando');
                        return res.json({ success: true, id: dup[0].id, duplicate: true });
                    }
                } catch (e) { /* coluna created_at pode não existir — prosseguir */ }
            }

            // Buscar pedido_id se pedido_numero fornecido
            let pedidoId = null;
            if (pedido_numero) {
                try {
                    const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE id = ? OR numero = ? LIMIT 1', [pedido_numero, pedido_numero]);
                    if (pedidos.length > 0) pedidoId = pedidos[0].id;
                } catch (e) { /* pedido não encontrado — ok */ }
            }

            // Verificar colunas extras (com cache)
            const hasExtraColumns = await checkHasExtraColumns();

            let result;
            if (hasExtraColumns) {
                [result] = await pool.query(
                    `INSERT INTO apontamentos_producao
                     (usuario_id, operador, maquina, turno, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, quantidade_produzida, quantidade_refugo, pedido_id, produto_descricao, observacoes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [usuario_id, operador, maquina || null, turno || null, ordem_producao_id || null, tipo_atividade, nome_atividade,
                     horaInicioFormatada, horaFimFormatada, duracao_segundos || 0,
                     qtdProdFinal || 0, quantidade_refugo || 0,
                     pedidoId, produto_descricao || null, obsFinal]
                );
            } else {
                [result] = await pool.query(
                    `INSERT INTO apontamentos_producao
                     (usuario_id, operador, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [usuario_id, operador, ordem_producao_id || null, tipo_atividade, nome_atividade,
                     horaInicioFormatada, horaFimFormatada, duracao_segundos || 0]
                );
            }

            console.log('[PCP/APONTAMENTOS/CHAO] Registro salvo, id:', result.insertId);

            // Gravou = não está mais em andamento (some do painel ao vivo)
            try {
                await pool.query('DELETE FROM apontamentos_ativos WHERE usuario_id = ?', [usuario_id]);
            } catch (_) { /* tabela ainda não criada — sem problema */ }

            let progresso = null;
            if (ordem_producao_id && hasExtraColumns) {
                try {
                    const [soma] = await pool.query(
                        `SELECT COALESCE(SUM(quantidade_produzida), 0) AS produzido
                         FROM apontamentos_producao WHERE ordem_producao_id = ?`,
                        [ordem_producao_id]
                    );
                    const produzidoApontado = Number(soma[0]?.produzido || 0);
                    await pool.query(
                        `UPDATE ordens_producao
                         SET quantidade_produzida = GREATEST(COALESCE(quantidade_produzida, 0), ?),
                             progresso = LEAST(100, ROUND(GREATEST(COALESCE(quantidade_produzida, 0), ?) / NULLIF(quantidade, 0) * 100, 2)),
                             updated_at = NOW()
                         WHERE id = ?`,
                        [produzidoApontado, produzidoApontado, ordem_producao_id]
                    );
                    const [op] = await pool.query(
                        `SELECT quantidade_produzida, progresso FROM ordens_producao WHERE id = ? LIMIT 1`,
                        [ordem_producao_id]
                    );
                    progresso = op[0] || null;
                } catch (updateError) {
                    console.warn('[PCP/APONTAMENTOS/CHAO] Apontamento salvo, mas progresso da OP não foi recalculado:', updateError.message);
                }
            }
            res.json({ success: true, id: result.insertId, progresso });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS/CHAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao salvar apontamento' });
        }
    });

    // Editar apontamento
    router.put('/apontamentos/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.user?.id;
            const { tipo_atividade, nome_atividade, observacoes, pedido_numero, produto_descricao } = req.body;

            // Verificar se o apontamento pertence ao usuário
            const [existing] = await pool.query(
                'SELECT id, usuario_id FROM apontamentos_producao WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Apontamento não encontrado' });
            }
            if (existing[0].usuario_id !== usuario_id && req.user?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Sem permissão para editar este apontamento' });
            }

            const updates = [];
            const params = [];
            if (tipo_atividade) { updates.push('tipo_atividade = ?'); params.push(tipo_atividade); }
            if (nome_atividade) { updates.push('nome_atividade = ?'); params.push(nome_atividade); }
            if (observacoes !== undefined) { updates.push('observacoes = ?'); params.push(observacoes); }
            if (produto_descricao !== undefined) { updates.push('produto_descricao = ?'); params.push(produto_descricao); }
            if (pedido_numero !== undefined) {
                let pedidoId = null;
                if (pedido_numero) {
                    try {
                        const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE id = ? OR numero = ? LIMIT 1', [pedido_numero, pedido_numero]);
                        if (pedidos.length > 0) pedidoId = pedidos[0].id;
                    } catch (e) { /* ok */ }
                }
                updates.push('pedido_id = ?'); params.push(pedidoId);
            }

            if (!updates.length) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }

            params.push(id);
            await pool.query(`UPDATE apontamentos_producao SET ${updates.join(', ')} WHERE id = ?`, params);
            console.log('[PCP/APONTAMENTOS] Apontamento editado:', id);
            res.json({ success: true, message: 'Apontamento atualizado' });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS] Erro ao editar:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao editar apontamento' });
        }
    });

    // Excluir/cancelar apontamento
    router.delete('/apontamentos/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.user?.id;

            const [existing] = await pool.query(
                'SELECT id, usuario_id, ordem_producao_id FROM apontamentos_producao WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Apontamento não encontrado' });
            }
            if (existing[0].usuario_id !== usuario_id && req.user?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Sem permissão para excluir este apontamento' });
            }

            await pool.query('DELETE FROM apontamentos_producao WHERE id = ?', [id]);
            // apontamento excluido pode ter contribuido p/ o andamento da OP — recalcular
            await atualizarAndamentoOrdem(existing[0].ordem_producao_id);
            console.log('[PCP/APONTAMENTOS] Apontamento excluído:', id);
            res.json({ success: true, message: 'Apontamento excluído' });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS] Erro ao excluir:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao excluir apontamento' });
        }
    });

    // ============================================================
    // QUALIDADE - Inspeções, Não Conformidades, Checklists
    // ============================================================

    // --- KPIs ---
    router.get('/qualidade/kpis', authenticateToken, asyncHandler(async (req, res) => {
        const now = new Date();
        const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const [[insp]] = await pool.query(
            `SELECT COUNT(*) as total, SUM(status='aprovado') as aprovados, SUM(status='pendente') as pendentes
             FROM qualidade_inspecoes WHERE data_inspecao >= ?`, [firstDay]);
        const [[ncs]] = await pool.query(
            `SELECT COUNT(*) as abertas FROM qualidade_nao_conformidades WHERE status IN ('aberta','em_analise','acao_corretiva')`);
        const [[cks]] = await pool.query(
            `SELECT COUNT(*) as ativos FROM qualidade_checklists WHERE ativo = 1`);
        const total = insp.total || 0;
        const aprovados = insp.aprovados || 0;
        const taxa = total > 0 ? Math.round((aprovados / total) * 100) : 0;
        res.json({ success: true, data: {
            total_inspecoes: total,
            taxa_aprovacao: taxa,
            ncs_abertas: ncs.abertas || 0,
            inspecoes_pendentes: insp.pendentes || 0,
            checklists_ativos: cks.ativos || 0
        }});
    }));

    // --- INSPEÇÕES: CRUD ---
    router.get('/qualidade/inspecoes', authenticateToken, asyncHandler(async (req, res) => {
        let sql = 'SELECT * FROM qualidade_inspecoes WHERE 1=1';
        const params = [];
        if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
        if (req.query.data_inicio) { sql += ' AND data_inspecao >= ?'; params.push(req.query.data_inicio); }
        if (req.query.data_fim) { sql += ' AND data_inspecao <= ?'; params.push(req.query.data_fim); }
        sql += ' ORDER BY data_inspecao DESC, id DESC LIMIT 200';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    }));

    router.get('/qualidade/inspecoes/:id', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_inspecoes WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Inspeção não encontrada' });
        res.json({ success: true, data: rows[0] });
    }));

    router.post('/qualidade/inspecoes', authenticateToken, asyncHandler(async (req, res) => {
        const { tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao } = req.body;
        const inspetor_id = req.user?.id || null;
        const inspetor_nome = req.user?.nome || req.user?.username || null;
        const [result] = await pool.query(
            `INSERT INTO qualidade_inspecoes (tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao, inspetor_id, inspetor_nome)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status || 'pendente', data_inspecao, inspetor_id, inspetor_nome]
        );
        console.log('[PCP/QUALIDADE] Inspeção criada:', result.insertId);
        res.json({ success: true, id: result.insertId });
    }));

    router.put('/qualidade/inspecoes/:id', authenticateToken, asyncHandler(async (req, res) => {
        const { tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao } = req.body;
        await pool.query(
            `UPDATE qualidade_inspecoes SET tipo=?, checklist_id=?, ordem_producao=?, produto=?, quantidade_inspecionada=?, quantidade_aprovada=?, observacoes=?, checklist_respostas=?, status=?, data_inspecao=? WHERE id=?`,
            [tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao, req.params.id]
        );
        console.log('[PCP/QUALIDADE] Inspeção atualizada:', req.params.id);
        res.json({ success: true });
    }));

    router.delete('/qualidade/inspecoes/:id', authenticateToken, asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM qualidade_inspecoes WHERE id = ?', [req.params.id]);
        console.log('[PCP/QUALIDADE] Inspeção excluída:', req.params.id);
        res.json({ success: true });
    }));

    // --- NÃO CONFORMIDADES: CRUD ---
    router.get('/qualidade/nao-conformidades', authenticateToken, asyncHandler(async (req, res) => {
        let sql = 'SELECT * FROM qualidade_nao_conformidades WHERE 1=1';
        const params = [];
        if (req.query.severidade) { sql += ' AND severidade = ?'; params.push(req.query.severidade); }
        if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
        sql += ' ORDER BY created_at DESC LIMIT 200';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    }));

    router.get('/qualidade/nao-conformidades/:id', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_nao_conformidades WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'NC não encontrada' });
        res.json({ success: true, data: rows[0] });
    }));

    router.post('/qualidade/nao-conformidades', authenticateToken, asyncHandler(async (req, res) => {
        const { descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo } = req.body;
        const registrado_por = req.user?.id || null;
        const registrado_nome = req.user?.nome || req.user?.username || null;
        const [result] = await pool.query(
            `INSERT INTO qualidade_nao_conformidades (descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, registrado_por, registrado_nome)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, registrado_por, registrado_nome]
        );
        console.log('[PCP/QUALIDADE] NC criada:', result.insertId);
        res.json({ success: true, id: result.insertId });
    }));

    router.put('/qualidade/nao-conformidades/:id', authenticateToken, asyncHandler(async (req, res) => {
        const { descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, status } = req.body;
        await pool.query(
            `UPDATE qualidade_nao_conformidades SET descricao=?, severidade=?, origem=?, ordem_producao=?, produto=?, causa_raiz=?, acao_corretiva=?, responsavel=?, prazo=?, status=? WHERE id=?`,
            [descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, status, req.params.id]
        );
        console.log('[PCP/QUALIDADE] NC atualizada:', req.params.id);
        res.json({ success: true });
    }));

    router.delete('/qualidade/nao-conformidades/:id', authenticateToken, asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM qualidade_nao_conformidades WHERE id = ?', [req.params.id]);
        console.log('[PCP/QUALIDADE] NC excluída:', req.params.id);
        res.json({ success: true });
    }));

    // --- CHECKLISTS: CRUD ---
    router.get('/qualidade/checklists', authenticateToken, asyncHandler(async (req, res) => {
        let sql = `SELECT c.*, (SELECT COUNT(*) FROM qualidade_checklist_itens WHERE checklist_id = c.id) as total_itens
                    FROM qualidade_checklists c WHERE 1=1`;
        const params = [];
        if (req.query.ativo) { sql += ' AND c.ativo = ?'; params.push(req.query.ativo); }
        sql += ' ORDER BY c.nome';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    }));

    router.get('/qualidade/checklists/:id', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_checklists WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Checklist não encontrado' });
        res.json({ success: true, data: rows[0] });
    }));

    router.get('/qualidade/checklists/:id/itens', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_checklist_itens WHERE checklist_id = ? ORDER BY ordem', [req.params.id]);
        res.json({ success: true, data: rows });
    }));

    router.post('/qualidade/checklists', authenticateToken, asyncHandler(async (req, res) => {
        const { nome, tipo_inspecao, itens } = req.body;
        const [result] = await pool.query(
            'INSERT INTO qualidade_checklists (nome, tipo_inspecao) VALUES (?, ?)', [nome, tipo_inspecao]
        );
        const checklistId = result.insertId;
        if (itens && itens.length > 0) {
            const values = itens.map(i => [checklistId, i.descricao, i.ordem || 0]);
            await pool.query('INSERT INTO qualidade_checklist_itens (checklist_id, descricao, ordem) VALUES ?', [values]);
        }
        console.log('[PCP/QUALIDADE] Checklist criado:', checklistId);
        res.json({ success: true, id: checklistId });
    }));

    router.put('/qualidade/checklists/:id', authenticateToken, asyncHandler(async (req, res) => {
        const { nome, tipo_inspecao, itens } = req.body;
        await pool.query('UPDATE qualidade_checklists SET nome=?, tipo_inspecao=? WHERE id=?', [nome, tipo_inspecao, req.params.id]);
        // Rebuild itens
        await pool.query('DELETE FROM qualidade_checklist_itens WHERE checklist_id = ?', [req.params.id]);
        if (itens && itens.length > 0) {
            const values = itens.map(i => [req.params.id, i.descricao, i.ordem || 0]);
            await pool.query('INSERT INTO qualidade_checklist_itens (checklist_id, descricao, ordem) VALUES ?', [values]);
        }
        console.log('[PCP/QUALIDADE] Checklist atualizado:', req.params.id);
        res.json({ success: true });
    }));

    router.delete('/qualidade/checklists/:id', authenticateToken, asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM qualidade_checklist_itens WHERE checklist_id = ?', [req.params.id]);
        await pool.query('DELETE FROM qualidade_checklists WHERE id = ?', [req.params.id]);
        console.log('[PCP/QUALIDADE] Checklist excluído:', req.params.id);
        res.json({ success: true });
    }));


    // ==================== ROTAS DE RELATÓRIOS PCP ====================

    // ==================== ROTAS DE RELATÓRIOS PCP ====================

    // 1. Cabos mais vendidos (ranking por quantidade e valor)
    router.get('/relatorios/cabos-mais-vendidos', async (req, res) => {
        try {
            const { data_inicio, data_fim, limit } = req.query;
            const maxResults = parseInt(limit) || 20;
            let whereClause = '';
            let params = [];

            if (data_inicio && data_fim) {
                whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
                params = [data_inicio, data_fim];
            }

            const [porQuantidade] = await pool.query(`
                SELECT
                    pi.codigo,
                    pi.descricao,
                    SUM(pi.quantidade) as total_quantidade,
                    pi.unidade,
                    SUM(pi.subtotal) as total_valor,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                    AVG(pi.preco_unitario) as preco_medio
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY pi.codigo, pi.descricao, pi.unidade
                ORDER BY total_quantidade DESC
                LIMIT ?
            `, [...params, maxResults]);

            const [porValor] = await pool.query(`
                SELECT
                    pi.codigo,
                    pi.descricao,
                    SUM(pi.quantidade) as total_quantidade,
                    pi.unidade,
                    SUM(pi.subtotal) as total_valor,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                    AVG(pi.preco_unitario) as preco_medio
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY pi.codigo, pi.descricao, pi.unidade
                ORDER BY total_valor DESC
                LIMIT ?
            `, [...params, maxResults]);

            const [resumo] = await pool.query(`
                SELECT
                    COUNT(DISTINCT pi.codigo) as total_produtos_vendidos,
                    SUM(pi.quantidade) as quantidade_total,
                    SUM(pi.subtotal) as valor_total,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
            `, params);

            let whereOP = '';
            let paramsOP = [];
            if (data_inicio && data_fim) {
                whereOP = 'WHERE data_inicio BETWEEN ? AND ?';
                paramsOP = [data_inicio, data_fim];
            }

            const [ordensProducao] = await pool.query(`
                SELECT
                    produto_nome,
                    codigo,
                    SUM(quantidade) as total_quantidade,
                    SUM(metragem) as total_metragem,
                    COUNT(*) as total_ordens,
                    unidade
                FROM ordens_producao
                ${whereOP}
                GROUP BY produto_nome, codigo, unidade
                ORDER BY total_quantidade DESC
                LIMIT ?
            `, [...paramsOP, maxResults]);

            res.json({
                success: true,
                ranking_por_quantidade: porQuantidade,
                ranking_por_valor: porValor,
                ordens_producao: ordensProducao,
                resumo: resumo[0] || {},
                periodo: { data_inicio, data_fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro cabos mais vendidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de cabos mais vendidos.' });
        }
    });

    // 2. Ranking de vendas (por vendedor, cliente, produto)
    router.get('/relatorios/ranking-vendas', async (req, res) => {
        try {
            const { data_inicio, data_fim, agrupar } = req.query;
            let whereClause = '';
            let params = [];

            if (data_inicio && data_fim) {
                whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
                params = [data_inicio, data_fim];
            }

            const [porVendedor] = await pool.query(`
                SELECT
                    COALESCE(p.vendedor_nome, 'Não informado') as vendedor,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    COUNT(CASE WHEN p.status = 'faturado' THEN 1 END) as pedidos_faturados,
                    COUNT(CASE WHEN p.status = 'aprovado' THEN 1 END) as pedidos_aprovados
                FROM pedidos p
                ${whereClause}
                GROUP BY p.vendedor_nome
                ORDER BY valor_total DESC
                LIMIT 20
            `, params);

            const [porCliente] = await pool.query(`
                SELECT
                    COALESCE(p.cliente_nome, 'Não informado') as cliente,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    MAX(p.created_at) as ultimo_pedido
                FROM pedidos p
                ${whereClause}
                GROUP BY p.cliente_nome
                ORDER BY valor_total DESC
                LIMIT 20
            `, params);

            const [totais] = await pool.query(`
                SELECT
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    COUNT(DISTINCT p.vendedor_nome) as total_vendedores,
                    COUNT(DISTINCT p.cliente_nome) as total_clientes
                FROM pedidos p
                ${whereClause}
            `, params);

            const [evolucaoMensal] = await pool.query(`
                SELECT
                    DATE_FORMAT(p.created_at, '%Y-%m') as mes,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total
                FROM pedidos p
                ${whereClause.length > 0 ? whereClause : 'WHERE p.created_at IS NOT NULL'}
                GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
                ORDER BY mes DESC
                LIMIT 12
            `, params);

            res.json({
                success: true,
                por_vendedor: porVendedor,
                por_cliente: porCliente,
                evolucao_mensal: evolucaoMensal.reverse(),
                totais: totais[0] || {},
                periodo: { data_inicio, data_fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro ranking vendas:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar ranking de vendas.' });
        }
    });

    // 3. Metros produzidos por dia
    router.get('/relatorios/metros-produzidos', async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const fim = data_fim || new Date().toISOString().slice(0, 10);
            const inicio = data_inicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            // Detecta colunas disponíveis em apontamentos_producao
            const c = await detectApontamentosColumns();
            const dataExpr = buildApDataExpr(c);
            const hasQtd = c.quantidade_produzida;
            const hasTempo = c.tempo_producao || c.duracao_segundos;

            // Apontamentos diários — usa colunas existentes
            let apontamentosDiarios = [];
            let resumoApontamentos = {};
            if (dataExpr !== 'NULL') {
                try {
                    const tempoExpr = c.tempo_producao
                        ? 'SUM(ap.tempo_producao)'
                        : (c.duracao_segundos ? 'SUM(ap.duracao_segundos)/60' : '0');
                    const qtdExpr = hasQtd ? 'SUM(ap.quantidade_produzida)' : '0';
                    const maquinaExpr = c.maquina ? `GROUP_CONCAT(DISTINCT ap.maquina SEPARATOR ', ')` : `''`;
                    const operadorExpr = c.operador ? `GROUP_CONCAT(DISTINCT ap.operador SEPARATOR ', ')` : `''`;

                    [apontamentosDiarios] = await pool.query(`
                        SELECT
                            DATE(${dataExpr}) as data,
                            ${qtdExpr} as quantidade_produzida,
                            ${tempoExpr} as tempo_total_min,
                            COUNT(*) as total_apontamentos,
                            ${maquinaExpr} as maquinas,
                            ${operadorExpr} as operadores
                        FROM apontamentos_producao ap
                        WHERE DATE(${dataExpr}) BETWEEN ? AND ?
                        GROUP BY DATE(${dataExpr})
                        ORDER BY data ASC
                    `, [inicio, fim]);

                    const qtdResumoExpr = hasQtd ? 'ap.quantidade_produzida' : '0';
                    const [resumo] = await pool.query(`
                        SELECT
                            COALESCE(SUM(${qtdResumoExpr}), 0) as total_produzido,
                            COALESCE(AVG(${qtdResumoExpr}), 0) as media_diaria,
                            COALESCE(MAX(${qtdResumoExpr}), 0) as max_dia,
                            COALESCE(MIN(${qtdResumoExpr}), 0) as min_dia,
                            ${tempoExpr} as tempo_total,
                            COUNT(DISTINCT DATE(${dataExpr})) as dias_com_producao
                        FROM apontamentos_producao ap
                        WHERE DATE(${dataExpr}) BETWEEN ? AND ?
                    `, [inicio, fim]);
                    resumoApontamentos = resumo[0] || {};
                } catch (e) {
                    console.warn('[PCP_RELATORIOS] Apontamentos indisponíveis:', e.message);
                }
            }

            // Ordens concluídas por dia — fonte primária quando apontamentos vazios
            let ordensConcluidasDia = [];
            let resumoOrdens = {};
            try {
                [ordensConcluidasDia] = await pool.query(`
                    SELECT
                        DATE(COALESCE(data_conclusao, data_inicio, created_at)) as data,
                        COALESCE(SUM(metragem), 0) as total_metragem,
                        COALESCE(SUM(quantidade), 0) as total_quantidade,
                        COUNT(*) as total_ordens,
                        GROUP_CONCAT(DISTINCT produto_nome SEPARATOR ', ') as produtos
                    FROM ordens_producao
                    WHERE deleted_at IS NULL
                      AND (
                            DATE(COALESCE(data_conclusao, data_inicio, created_at)) BETWEEN ? AND ?
                          )
                    GROUP BY DATE(COALESCE(data_conclusao, data_inicio, created_at))
                    ORDER BY data ASC
                `, [inicio, fim]);

                const [resumoOp] = await pool.query(`
                    SELECT
                        COALESCE(SUM(metragem), 0) as total_metragem,
                        COALESCE(SUM(quantidade), 0) as total_quantidade,
                        COUNT(*) as total_ordens,
                        COUNT(CASE WHEN LOWER(status) IN ('concluida','concluído','concluido','finalizada','finalizado') THEN 1 END) as ordens_concluidas,
                        COUNT(CASE WHEN LOWER(status) IN ('em_producao','em produção','produzindo','iniciada') THEN 1 END) as ordens_em_producao
                    FROM ordens_producao
                    WHERE deleted_at IS NULL
                      AND DATE(COALESCE(data_conclusao, data_inicio, created_at)) BETWEEN ? AND ?
                `, [inicio, fim]);
                resumoOrdens = resumoOp[0] || {};
            } catch (e) {
                console.warn('[PCP_RELATORIOS] Ordens indisponíveis:', e.message);
            }

            // Se apontamentos não tiveram dados, usa ordens como resumo
            const semApontamentos = !apontamentosDiarios.length
                || (Number(resumoApontamentos.total_produzido || 0) === 0 && !hasQtd);

            if (semApontamentos && ordensConcluidasDia.length) {
                const totais = ordensConcluidasDia.map(d => Number(d.total_quantidade || d.total_metragem || 0));
                const totalProd = totais.reduce((a, b) => a + b, 0);
                resumoApontamentos = {
                    total_produzido: totalProd,
                    media_diaria: totais.length ? totalProd / totais.length : 0,
                    max_dia: totais.length ? Math.max(...totais) : 0,
                    min_dia: totais.length ? Math.min(...totais) : 0,
                    tempo_total: 0,
                    dias_com_producao: ordensConcluidasDia.length
                };
            }

            res.json({
                success: true,
                apontamentos_diarios: apontamentosDiarios,
                ordens_por_dia: ordensConcluidasDia,
                resumo_apontamentos: resumoApontamentos,
                resumo_ordens: resumoOrdens,
                periodo: { data_inicio: inicio, data_fim: fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro metros produzidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de metros produzidos.' });
        }
    });

    // 4. Faturamento mensal
    router.get('/relatorios/faturamento-mensal', async (req, res) => {
        try {
            const { ano } = req.query;
            const anoFiltro = parseInt(ano) || new Date().getFullYear();

            const [faturamentoPF] = await pool.query(`
                SELECT
                    DATE_FORMAT(data_faturamento, '%Y-%m') as mes,
                    MONTH(data_faturamento) as mes_num,
                    COUNT(*) as total_pedidos,
                    SUM(total) as valor_total,
                    AVG(total) as ticket_medio
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
                GROUP BY DATE_FORMAT(data_faturamento, '%Y-%m'), MONTH(data_faturamento)
                ORDER BY mes_num ASC
            `, [anoFiltro]);

            const [faturamentoPedidos] = await pool.query(`
                SELECT
                    DATE_FORMAT(p.created_at, '%Y-%m') as mes,
                    MONTH(p.created_at) as mes_num,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                AND YEAR(p.created_at) = ?
                GROUP BY DATE_FORMAT(p.created_at, '%Y-%m'), MONTH(p.created_at)
                ORDER BY mes_num ASC
            `, [anoFiltro]);

            // Resumo anual: tenta pedidos_faturados primeiro, depois fallback
            // para pedidos (status faturado/entregue/convertido)
            const [faturamentoAnoAnteriorPF] = await pool.query(`
                SELECT
                    COALESCE(SUM(total), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro - 1]);

            const [faturamentoAnoAtualPF] = await pool.query(`
                SELECT
                    COALESCE(SUM(total), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro]);

            const [faturamentoAnoAtualPed] = await pool.query(`
                SELECT
                    COALESCE(SUM(p.valor), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                  AND YEAR(p.created_at) = ?
            `, [anoFiltro]);

            const [faturamentoAnoAnteriorPed] = await pool.query(`
                SELECT
                    COALESCE(SUM(p.valor), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                  AND YEAR(p.created_at) = ?
            `, [anoFiltro - 1]);

            // Top clientes — tenta pedidos_faturados, fallback para pedidos
            const [topClientesPF] = await pool.query(`
                SELECT
                    cliente,
                    COUNT(*) as total_pedidos,
                    SUM(total) as valor_total
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
                GROUP BY cliente
                ORDER BY valor_total DESC
                LIMIT 10
            `, [anoFiltro]);

            let topClientes = topClientesPF;
            if (!topClientes || topClientes.length === 0) {
                const [topClientesPed] = await pool.query(`
                    SELECT
                        COALESCE(c.nome, p.cliente_nome, 'Cliente sem nome') as cliente,
                        COUNT(*) as total_pedidos,
                        COALESCE(SUM(p.valor), 0) as valor_total
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.status IN ('faturado', 'entregue', 'convertido')
                      AND YEAR(p.created_at) = ?
                    GROUP BY COALESCE(c.nome, p.cliente_nome, 'Cliente sem nome')
                    ORDER BY valor_total DESC
                    LIMIT 10
                `, [anoFiltro]).catch(() => [[]]);
                topClientes = topClientesPed;
            }

            // Escolhe a fonte que tem dados (PF preferida; senão pedidos)
            const pfAtual = Number(faturamentoAnoAtualPF[0]?.valor_total || 0);
            const pedAtual = Number(faturamentoAnoAtualPed[0]?.valor_total || 0);
            const usarPF = pfAtual >= pedAtual && pfAtual > 0;

            const totalAtual = usarPF ? pfAtual : pedAtual;
            const totalPedidosAtual = usarPF
                ? (faturamentoAnoAtualPF[0]?.total_pedidos || 0)
                : (faturamentoAnoAtualPed[0]?.total_pedidos || 0);
            const totalAnterior = usarPF
                ? Number(faturamentoAnoAnteriorPF[0]?.valor_total || 0)
                : Number(faturamentoAnoAnteriorPed[0]?.valor_total || 0);

            const variacao = totalAnterior > 0
                ? ((totalAtual - totalAnterior) / totalAnterior * 100).toFixed(2)
                : 0;

            res.json({
                success: true,
                faturamento_mensal: faturamentoPF,
                faturamento_pedidos: faturamentoPedidos,
                top_clientes: topClientes,
                resumo: {
                    ano: anoFiltro,
                    valor_total_ano: totalAtual,
                    total_pedidos_ano: totalPedidosAtual,
                    valor_ano_anterior: totalAnterior,
                    variacao_percentual: `${variacao}%`,
                    fonte: usarPF ? 'pedidos_faturados' : 'pedidos'
                }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro faturamento mensal:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de faturamento mensal.' });
        }
    });


    // Indicadores do fluxo completo. Cada percentual traz a amostra utilizada,
    // evitando transformar campo não alimentado em um falso zero operacional.
    router.get('/indicadores-operacionais', async (req, res) => {
        try {
            const [lead, otif, replan, capacidade] = await Promise.all([
                pool.query(`SELECT COUNT(*) AS amostra,
                           ROUND(AVG(TIMESTAMPDIFF(HOUR,created_at,data_entrega_efetiva))/24,1) AS dias
                             FROM pedidos WHERE deleted_at IS NULL
                              AND data_entrega_efetiva IS NOT NULL AND created_at IS NOT NULL`),
                pool.query(`SELECT COUNT(*) AS entregues,
                           SUM(CASE WHEN DATE(data_entrega_efetiva)<=DATE(COALESCE(data_prevista,data_previsao))
                                     AND (COALESCE(percentual_faturado,100)>=100 OR COALESCE(valor_pendente,0)=0)
                                    THEN 1 ELSE 0 END) AS no_otif
                             FROM pedidos WHERE deleted_at IS NULL
                              AND data_entrega_efetiva IS NOT NULL
                              AND COALESCE(data_prevista,data_previsao) IS NOT NULL`),
                pool.query(`SELECT COUNT(*) AS ordens,
                           SUM(CASE WHEN COALESCE(revisao,0)>0 THEN 1 ELSE 0 END) AS replanejadas,
                           SUM(COALESCE(revisao,0)) AS total_replanejamentos FROM ordens_producao`),
                pool.query(`SELECT COUNT(DISTINCT COALESCE(ordem_producao_id,pedido_id)) AS ordens,
                           ROUND(SUM(COALESCE(tempo_producao,0)),2) AS horas_produzidas,
                           ROUND(SUM(COALESCE(tempo_producao,0)+COALESCE(tempo_setup,0)+COALESCE(tempo_parada,0)),2) AS horas_disponiveis
                             FROM apontamentos_producao`)
            ]);
            const l=lead[0][0],o=otif[0][0],r=replan[0][0],c=capacidade[0][0];
            res.json({
                lead_time_pedido_dias:l.dias==null?null:Number(l.dias),
                otif_pct:Number(o.entregues)?Number(o.no_otif||0)/Number(o.entregues)*100:null,
                indice_replanejamento_pct:Number(r.ordens)?Number(r.replanejadas||0)/Number(r.ordens)*100:null,
                replanejamentos:Number(r.total_replanejamentos||0),
                ocupacao_capacidade_pct:Number(c.horas_disponiveis)?Number(c.horas_produzidas||0)/Number(c.horas_disponiveis)*100:null,
                cobertura:{entregas_lead_time:Number(l.amostra||0),entregas_otif:Number(o.entregues||0),
                    ordens_replanejamento:Number(r.ordens||0),ordens_apontadas:Number(c.ordens||0)}
            });
        } catch (err) {
            console.error('[PCP/INDICADORES] Erro:', err.message);
            res.status(500).json({ message:'Erro ao calcular indicadores operacionais.' });
        }
    });

    // EVOLUÇÃO X RETRAÇÃO DA CARTEIRA — série diária em tempo real para o dashboard PCP
    router.get('/carteira-evolucao', async (req, res) => {
        try {
            const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 7), 90);
            const [entradas] = await pool.query(`
                SELECT base.dia, COUNT(*) AS quantidade, COALESCE(SUM(base.valor), 0) AS valor
                FROM (
                    SELECT DATE(created_at) AS dia, valor
                    FROM pedidos
                    WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                ) AS base
                GROUP BY base.dia
            `, [dias - 1]);
            const [saidas] = await pool.query(`
                SELECT base.dia, COUNT(*) AS quantidade, COALESCE(SUM(base.valor), 0) AS valor
                FROM (
                    SELECT DATE(CASE WHEN LOWER(COALESCE(status, '')) IN ('faturado','recibo')
                                     THEN COALESCE(faturado_em, data_faturamento, updated_at, created_at)
                                     ELSE COALESCE(updated_at, created_at) END) AS dia,
                           valor
                    FROM pedidos
                    WHERE deleted_at IS NULL
                      AND LOWER(COALESCE(status, '')) IN ('faturado','cancelado','cancelada','recibo')
                      AND (CASE WHEN LOWER(COALESCE(status, '')) IN ('faturado','recibo')
                                THEN COALESCE(faturado_em, data_faturamento, updated_at, created_at)
                                ELSE COALESCE(updated_at, created_at) END) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                ) AS base
                GROUP BY base.dia
            `, [dias - 1]);
            const porDia = new Map();
            for (let i = dias - 1; i >= 0; i--) {
                const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                porDia.set(key, { dia: key, evolucao: 0, retracao: 0, quantidade_evolucao: 0, quantidade_retracao: 0 });
            }
            entradas.forEach(r => { const x = porDia.get(String(r.dia).slice(0, 10)); if (x) { x.evolucao = Number(r.valor); x.quantidade_evolucao = Number(r.quantidade); } });
            saidas.forEach(r => { const x = porDia.get(String(r.dia).slice(0, 10)); if (x) { x.retracao = Number(r.valor); x.quantidade_retracao = Number(r.quantidade); } });
            const serie = [...porDia.values()];
            res.json({ success: true, atualizado_em: new Date().toISOString(), dias, serie,
                totais: serie.reduce((a, x) => ({ evolucao: a.evolucao + x.evolucao, retracao: a.retracao + x.retracao, saldo: a.saldo + x.evolucao - x.retracao }), { evolucao: 0, retracao: 0, saldo: 0 }) });
        } catch (err) {
            console.error('[PCP/CARTEIRA-EVOLUCAO] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao calcular evolução da carteira.' });
        }
    });

    // CARTEIRA DE PEDIDOS
    // ============================================================
    // CARTEIRA POR SEMANA (PCP)
    // ============================================================
    // A semana é guardada como ano+semana ISO num inteiro só (202637 = semana 37
    // de 2026), que é exatamente o que `YEARWEEK(data, 3)` devolve. Assim o filtro
    // por semana da entrega e o filtro por semana planejada comparam a MESMA coisa,
    // ordenam certo e atravessam a virada de ano sem gambiarra (a semana 1 de 2027
    // é 202701, não 202653).
    const RE_SEMANA = /^(\d{4})-?W(\d{1,2})$/i;

    /** '2026-W37' | '2026W37' | 202637 -> 202637 ; inválido -> null */
    function semanaParaAnoSemana(valor) {
        if (valor === undefined || valor === null || valor === '') return null;
        const texto = String(valor).trim();
        const m = texto.match(RE_SEMANA);
        if (m) {
            const ano = Number(m[1]), semana = Number(m[2]);
            if (semana < 1 || semana > 53) return null;
            return ano * 100 + semana;
        }
        if (/^\d{6}$/.test(texto)) {
            const semana = Number(texto.slice(4));
            return semana >= 1 && semana <= 53 ? Number(texto) : null;
        }
        return null;
    }

    /** 202637 -> '2026-W37' */
    function anoSemanaParaTexto(valor) {
        const n = Number(valor);
        if (!Number.isInteger(n) || n < 100001) return null;
        return `${Math.floor(n / 100)}-W${String(n % 100).padStart(2, '0')}`;
    }

    let carteiraSemanaPronta = null;
    function garantirTabelaCarteiraSemana() {
        if (!carteiraSemanaPronta) {
            carteiraSemanaPronta = pool.query(`
                CREATE TABLE IF NOT EXISTS pcp_carteira_semana (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    pedido_id INT NOT NULL,
                    ano_semana INT NOT NULL COMMENT 'ISO ano*100+semana, igual a YEARWEEK(data,3)',
                    observacao VARCHAR(255) NULL,
                    incluido_por INT NULL,
                    incluido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_carteira_semana_pedido (pedido_id),
                    KEY idx_carteira_semana (ano_semana)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `).catch((erro) => {
                carteiraSemanaPronta = null;
                throw erro;
            });
        }
        return carteiraSemanaPronta;
    }

    /**
     * Semanas disponíveis para o seletor da tela, nos dois eixos:
     * o que vence por semana e o que já foi planejado por semana.
     */
    router.get('/carteira/semanas', async (req, res) => {
        try {
            await garantirTabelaCarteiraSemana();
            const [entrega] = await pool.query(`
                SELECT YEARWEEK(p.data_prevista, 3) AS ano_semana,
                       MIN(DATE(p.data_prevista))   AS inicio,
                       MAX(DATE(p.data_prevista))   AS fim,
                       COUNT(*)                     AS pedidos,
                       COALESCE(SUM(p.valor), 0)    AS valor
                  FROM pedidos p
                 WHERE p.deleted_at IS NULL
                   AND p.data_prevista IS NOT NULL
                   AND LOWER(COALESCE(p.status, '')) NOT IN ('cancelado', 'cancelada', 'excluido')
                 GROUP BY YEARWEEK(p.data_prevista, 3)
                 ORDER BY ano_semana DESC
                 LIMIT 60
            `);
            const [planejadas] = await pool.query(`
                SELECT cs.ano_semana, COUNT(*) AS pedidos, COALESCE(SUM(p.valor), 0) AS valor
                  FROM pcp_carteira_semana cs
                  JOIN pedidos p ON p.id = cs.pedido_id AND p.deleted_at IS NULL
                 GROUP BY cs.ano_semana
                 ORDER BY cs.ano_semana DESC
                 LIMIT 60
            `);
            const mapear = (linhas) => linhas.map((l) => ({
                semana: anoSemanaParaTexto(l.ano_semana),
                ano_semana: Number(l.ano_semana),
                inicio: l.inicio || null,
                fim: l.fim || null,
                pedidos: Number(l.pedidos) || 0,
                valor: Number(l.valor) || 0
            })).filter((l) => l.semana);

            const [[atual]] = await pool.query('SELECT YEARWEEK(CURDATE(), 3) AS semana');
            res.json({
                success: true,
                semana_atual: anoSemanaParaTexto(atual.semana),
                entrega: mapear(entrega),
                planejadas: mapear(planejadas)
            });
        } catch (err) {
            console.error('[PCP/CARTEIRA/SEMANAS] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao listar as semanas da carteira.' });
        }
    });

    /** Monta a carteira de uma semana: vincula os pedidos escolhidos à semana alvo. */
    router.post('/carteira/semana', async (req, res) => {
        try {
            await garantirTabelaCarteiraSemana();
            const anoSemana = semanaParaAnoSemana(req.body?.semana);
            if (!anoSemana) {
                return res.status(400).json({ success: false, message: 'Informe a semana no formato 2026-W37.' });
            }
            const ids = [...new Set((Array.isArray(req.body?.pedido_ids) ? req.body.pedido_ids : [])
                .map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0))];
            if (!ids.length) {
                return res.status(400).json({ success: false, message: 'Selecione ao menos um pedido.' });
            }

            // Só entra pedido que existe e não está excluído: um id solto viraria linha
            // órfã que aparece na contagem da semana e não abre em lugar nenhum.
            const [validos] = await pool.query(
                `SELECT id FROM pedidos WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ids
            );
            const idsValidos = validos.map((l) => l.id);
            if (!idsValidos.length) {
                return res.status(404).json({ success: false, message: 'Nenhum dos pedidos informados foi encontrado.' });
            }

            const observacao = String(req.body?.observacao || '').trim().slice(0, 255) || null;
            const usuarioId = req.user?.id || null;
            await pool.query(
                `INSERT INTO pcp_carteira_semana (pedido_id, ano_semana, observacao, incluido_por)
                 VALUES ${idsValidos.map(() => '(?, ?, ?, ?)').join(', ')}
                 ON DUPLICATE KEY UPDATE ano_semana = VALUES(ano_semana),
                                         observacao = VALUES(observacao),
                                         incluido_por = VALUES(incluido_por)`,
                idsValidos.flatMap((id) => [id, anoSemana, observacao, usuarioId])
            );

            const ignorados = ids.length - idsValidos.length;
            res.json({
                success: true,
                semana: anoSemanaParaTexto(anoSemana),
                vinculados: idsValidos.length,
                ignorados,
                message: `${idsValidos.length} pedido(s) na carteira da semana ${anoSemanaParaTexto(anoSemana)}.`
                    + (ignorados ? ` ${ignorados} ignorado(s) por não existirem.` : '')
            });
        } catch (err) {
            console.error('[PCP/CARTEIRA/SEMANA] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao montar a carteira da semana.' });
        }
    });

    /** Tira pedidos da semana planejada (não mexe no pedido em si). */
    router.delete('/carteira/semana', async (req, res) => {
        try {
            await garantirTabelaCarteiraSemana();
            const ids = [...new Set((Array.isArray(req.body?.pedido_ids) ? req.body.pedido_ids : [])
                .map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0))];
            if (!ids.length) {
                return res.status(400).json({ success: false, message: 'Selecione ao menos um pedido.' });
            }
            const [r] = await pool.query(
                `DELETE FROM pcp_carteira_semana WHERE pedido_id IN (${ids.map(() => '?').join(',')})`, ids
            );
            res.json({ success: true, removidos: r.affectedRows || 0, message: `${r.affectedRows || 0} pedido(s) retirado(s) da semana.` });
        } catch (err) {
            console.error('[PCP/CARTEIRA/SEMANA] Erro ao remover:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao retirar pedidos da semana.' });
        }
    });

    // Consulta compartilhada pela TELA (JSON) e pelo PDF. Uma função só de propósito:
    // documento montado duas vezes diverge — foi o que aconteceu com a CC-e, onde a tela
    // e o anexo do e-mail passaram a mostrar coisas diferentes.
    async function consultarCarteira(req) {
        {
            await garantirTabelaCarteiraSemana();
            const { status, cliente, prioridade, data_inicio, data_fim } = req.query;
            const limit = Math.min(parseInt(req.query.limit) || 500, 1000);

            // O recorte por empresa é OPCIONAL (`?empresa_id=`). Antes a carteira casava
            // `pedidos.empresa_id` com o `usuarios.empresa_id` (default 1) e vinha VAZIA em
            // labor-eletric, labor-energy e cobal: lá os pedidos nascem sem `empresa_id`
            // (o POST /pedidos só preenche quando encontra a empresa pelo nome do cliente) e
            // os admins são empresa_id = 1 — a tela mostrava zero com pedidos na base, sem erro.
            // Cada instância já é uma empresa, com banco próprio, então não há mistura a evitar.
            const empresaFiltro = Number(req.query.empresa_id) || null;
            const conditions = ['p.deleted_at IS NULL'];
            const params = [];
            if (empresaFiltro) { conditions.push('p.empresa_id = ?'); params.push(empresaFiltro); }

            if (status)      { conditions.push('p.status = ?');                                   params.push(status); }
            if (cliente)     { conditions.push('(p.cliente_nome LIKE ? OR c.nome LIKE ?)');       params.push(`%${cliente}%`, `%${cliente}%`); }
            if (prioridade)  { conditions.push('p.prioridade = ?');                               params.push(prioridade); }
            if (data_inicio) { conditions.push('DATE(p.created_at) >= ?');                        params.push(data_inicio); }
            if (data_fim)    { conditions.push('DATE(p.created_at) <= ?');                        params.push(data_fim); }

            // Recorte por SEMANA. Dois eixos diferentes, de propósito:
            //   ?semana=            — semana da ENTREGA (data_prevista). É a carteira como ela
            //                         está: o que vence naquela semana.
            //   ?semana_planejada=  — semana que o PCP MONTOU (tabela pcp_carteira_semana). É a
            //                         carteira como vai ser trabalhada, independente do prazo.
            // Sem os dois separados não dá para montar a semana que vem sem antes mexer na
            // data prometida ao cliente.
            const semanaEntrega = semanaParaAnoSemana(req.query.semana);
            if (req.query.semana && !semanaEntrega) {
                throw Object.assign(new Error('Semana inválida. Use o formato 2026-W37.'), { status: 400 });
            }
            if (semanaEntrega) { conditions.push('YEARWEEK(p.data_prevista, 3) = ?'); params.push(semanaEntrega); }

            const semanaPlan = semanaParaAnoSemana(req.query.semana_planejada);
            if (req.query.semana_planejada && !semanaPlan) {
                throw Object.assign(new Error('Semana planejada inválida. Use o formato 2026-W37.'), { status: 400 });
            }
            if (semanaPlan) { conditions.push('cs.ano_semana = ?'); params.push(semanaPlan); }

            const where = `WHERE ${conditions.join(' AND ')}`;
            params.push(limit);

            const [rows] = await pool.query(`
                SELECT
                    p.id,
                    p.numero_pedido,
                    COALESCE(c.nome, p.cliente_nome)   AS cliente,
                    p.descricao,
                    p.valor,
                    p.valor AS valor_total,
                    p.status,
                    p.prioridade,
                    p.prazo_entrega,
                    p.data_prevista,
                    p.condicao_pagamento,
                    p.numero_nf AS nfe_numero,
                    p.nfe_chave,
                    p.created_at,
                    op.id           AS op_id,
                    op.codigo       AS op_codigo,
                    op.status       AS status_producao,
                    op.progresso    AS progresso_producao,
                    -- Pedidos que ainda não geraram OP continuam aparecendo na carteira.
                    -- Nesses casos, usa os próprios itens do pedido em vez de exibir
                    -- produto e quantidade vazios na tela.
                    COALESCE(op.quantidade, itens_pedido.quantidade) AS quantidade,
                    COALESCE(op.produto_nome, itens_pedido.produto_nome) AS produto_nome,
                    -- prazo_entrega é INT (dias) e está sempre vazio; a data real de
                    -- entrega mora em data_prevista, que é o que o editor do PCP grava.
                    DATEDIFF(p.data_prevista, CURDATE()) AS dias_entrega,
                    YEARWEEK(p.data_prevista, 3) AS semana_entrega,
                    cs.ano_semana                AS semana_planejada,
                    cs.observacao                AS semana_observacao
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN pcp_carteira_semana cs ON cs.pedido_id = p.id
                LEFT JOIN (
                    -- BUG-PCP-CARTEIRA-002: ordens_producao nao tem coluna deleted_at
                    -- (soft-delete so existe em pedidos) - referencia-la aqui derrubava a rota.
                    SELECT
                        COALESCE(pedido_vinculado_id, pedido_id) AS pedido_link_id,
                        numero_pedido,
                        MAX(id) AS max_id
                    FROM ordens_producao
                    GROUP BY COALESCE(pedido_vinculado_id, pedido_id), numero_pedido
                ) op_latest ON op_latest.pedido_link_id = p.id
                    OR (op_latest.pedido_link_id IS NULL AND op_latest.numero_pedido = p.numero_pedido)
                LEFT JOIN ordens_producao op ON op.id = op_latest.max_id
                LEFT JOIN (
                    SELECT
                        pedido_id,
                        MAX(descricao) AS produto_nome,
                        SUM(COALESCE(quantidade, 0)) AS quantidade
                    FROM pedido_itens
                    GROUP BY pedido_id
                ) itens_pedido ON itens_pedido.pedido_id = p.id
                ${where}
                ORDER BY p.id DESC
                LIMIT ?
            `, params);

            const emProducao = rows.filter(r => {
                const s = (r.status_producao || '').toLowerCase();
                return s.includes('produ') || s === 'iniciada' || s === 'em_producao';
            }).length;
            const atrasados = rows.filter(r =>
                r.dias_entrega != null && r.dias_entrega < 0 &&
                !['faturado', 'cancelado', 'recibo'].includes(r.status)
            ).length;
            const aFaturar = rows.filter(r => r.status === 'faturar' && !r.nfe_numero).length;

            // A tela trabalha com '2026-W37'; o banco guarda 202637. Converte aqui para a
            // página não ter que repetir a regra de virada de ano no JavaScript.
            for (const linha of rows) {
                linha.semana_entrega = anoSemanaParaTexto(linha.semana_entrega);
                linha.semana_planejada = anoSemanaParaTexto(linha.semana_planejada);
            }

            return {
                success: true,
                pedidos: rows,
                filtro: {
                    semana: anoSemanaParaTexto(semanaEntrega),
                    semana_planejada: anoSemanaParaTexto(semanaPlan)
                },
                kpis: { total: rows.length, emProducao, atrasados, aFaturar }
            };
        }
    }


    // ============================================================
    // CARTEIRA EM PDF
    // ============================================================
    // Mesmos filtros da tela (semana, semana planejada, status, cliente) porque sai da
    // MESMA consulta — o PDF é o retrato do que está na tela, não um relatório paralelo.
    // Paisagem: são 9 colunas; em retrato a descrição fica ilegível.
    // Montagem do HTML da carteira, extraída da rota de PDF para ser reaproveitada pelo
    // envio por e-mail — o anexo do e-mail é o MESMO documento que o botão "Exportar PDF"
    // gera, não um relatório paralelo que pode divergir com o tempo.
    async function montarHtmlCarteira(req) {
            const dados = await consultarCarteira(req);
            const linhas = dados.pedidos || [];

            let empresa = {};
            try {
                const cfg = await buscarConfiguracoesEmpresa(pool);
                empresa = (typeof formatarDadosParaPDF === 'function' ? formatarDadosParaPDF(cfg) : cfg) || {};
            } catch (_) { empresa = {}; }

            const esc = (v) => String(v ?? '')
                .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            const moeda = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const dataBr = (v) => {
                if (!v) return '—';
                const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
                return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
            };
            const semanaBr = (s) => {
                const m = String(s || '').match(/^(\d{4})-W(\d{2})$/);
                return m ? `S${Number(m[2])}/${m[1]}` : '—';
            };
            const corta = (v, n) => {
                const t = String(v ?? '').trim();
                return !t ? '—' : (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
            };

            const valorTotal = linhas.reduce((s, l) => s + (Number(l.valor_total || l.valor) || 0), 0);
            const filtros = [];
            if (dados.filtro?.semana) filtros.push(`Semana de entrega: ${semanaBr(dados.filtro.semana)}`);
            if (dados.filtro?.semana_planejada) filtros.push(`Carteira planejada: ${semanaBr(dados.filtro.semana_planejada)}`);
            if (req.query.status) filtros.push(`Status: ${req.query.status}`);
            if (req.query.cliente) filtros.push(`Cliente: ${req.query.cliente}`);
            if (req.query.prioridade) filtros.push(`Prioridade: ${req.query.prioridade}`);
            const resumoFiltros = filtros.length ? filtros.join(' · ') : 'Carteira completa (sem filtros)';

            const emitidoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            // `formatarDadosParaPDF` devolve {nome, nomeFantasia}; o objeto cru traz
            // {razao_social, nome_fantasia}. Aceita os dois para não depender de qual veio.
            const nomeEmpresa = empresa.nome || empresa.razao_social
                || empresa.nomeFantasia || empresa.nome_fantasia || 'Carteira de Pedidos';

            const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Carteira de Pedidos</title><style>
@page{size:A4 landscape;margin:10mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Segoe UI",Arial,sans-serif;color:#0f172a;font-size:9px}
.cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a8a;padding-bottom:6px;margin-bottom:8px}
.cab h1{margin:0;font-size:15px;color:#1e3a8a}
.cab .emp{font-size:10px;font-weight:600}
.cab .meta{text-align:right;font-size:8px;color:#64748b;line-height:1.5}
.filtros{background:#f1f5f9;border-left:3px solid #1e3a8a;padding:5px 8px;margin-bottom:8px;font-size:9px}
.kpis{display:flex;gap:8px;margin-bottom:8px}
.kpi{flex:1;border:1px solid #e2e8f0;border-radius:4px;padding:5px 8px}
.kpi span{display:block;font-size:7px;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
.kpi strong{font-size:12px;color:#0f172a}
table{width:100%;border-collapse:collapse}
thead{display:table-header-group}
th{background:#1e3a8a;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.3px;padding:4px 5px;text-align:left}
td{padding:3px 5px;border-bottom:1px solid #e2e8f0;font-size:8.5px;vertical-align:top}
tr{break-inside:avoid}
tbody tr:nth-child(even){background:#f8fafc}
.num{text-align:right;white-space:nowrap}
.atraso{color:#b91c1c;font-weight:600}
.vazio{text-align:center;padding:28px;color:#94a3b8}
tfoot td{border-top:2px solid #1e3a8a;font-weight:700;font-size:9px;padding-top:5px}
.rodape{margin-top:10px;text-align:center;font-size:7px;color:#94a3b8}
</style></head><body>
<div class="cab">
  <div><div class="emp">${esc(nomeEmpresa)}</div><h1>Carteira de Pedidos</h1></div>
  <div class="meta">Emitido em ${esc(emitidoEm)}<br>${linhas.length} pedido(s)</div>
</div>
<div class="filtros"><strong>Filtro:</strong> ${esc(resumoFiltros)}</div>
<div class="kpis">
  <div class="kpi"><span>Pedidos</span><strong>${dados.kpis?.total ?? linhas.length}</strong></div>
  <div class="kpi"><span>Valor total</span><strong>${moeda(valorTotal)}</strong></div>
  <div class="kpi"><span>Em produção</span><strong>${dados.kpis?.emProducao ?? 0}</strong></div>
  <div class="kpi"><span>Atrasados</span><strong>${dados.kpis?.atrasados ?? 0}</strong></div>
  <div class="kpi"><span>A faturar</span><strong>${dados.kpis?.aFaturar ?? 0}</strong></div>
</div>
<table>
 <thead><tr>
  <th>Pedido</th><th>Cliente</th><th>Descrição</th><th class="num">Valor</th>
  <th>Entrega</th><th>Semana</th><th>Status</th><th>Produção</th><th>Prioridade</th>
 </tr></thead>
 <tbody>${linhas.length ? linhas.map((l) => `<tr>
  <td>${esc(l.numero_pedido)}</td>
  <td>${esc(corta(l.cliente, 34))}</td>
  <td>${esc(corta(l.descricao, 52))}</td>
  <td class="num">${moeda(l.valor_total || l.valor)}</td>
  <td class="${Number(l.dias_entrega) < 0 ? 'atraso' : ''}">${esc(dataBr(l.data_prevista))}</td>
  <td>${esc(semanaBr(l.semana_planejada || l.semana_entrega))}</td>
  <td>${esc(l.status || '—')}</td>
  <td>${esc(l.status_producao || 'Sem OP')}</td>
  <td>${esc(l.prioridade || '—')}</td>
 </tr>`).join('') : '<tr><td colspan="9" class="vazio">Nenhum pedido para este filtro.</td></tr>'}</tbody>
 ${linhas.length ? `<tfoot><tr><td colspan="3">Total (${linhas.length} pedidos)</td><td class="num">${moeda(valorTotal)}</td><td colspan="5"></td></tr></tfoot>` : ''}
</table>
<div class="rodape">Zyntra ERP · PCP · gerado automaticamente</div>
</body></html>`;

            const sufixo = dados.filtro?.semana_planejada || dados.filtro?.semana || new Date().toISOString().slice(0, 10);
            return { html, dados, linhas, valorTotal, resumoFiltros, nomeEmpresa, sufixo, emitidoEm };
    }

    router.get('/carteira/pdf', async (req, res) => {
        try {
            const { html, sufixo } = await montarHtmlCarteira(req);

            if (String(req.query.formato || '').toLowerCase() === 'html') {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send(html);
            }

            const pdf = await htmlParaPdf(html, {
                paisagem: true,
                margens: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
            });

            const nomeArquivo = `carteira-pedidos-${sufixo}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);
            res.setHeader('Content-Length', pdf.length);
            return res.end(pdf);
        } catch (err) {
            if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
            console.error('[PCP/CARTEIRA/PDF] Erro:', err.message);
            return res.status(err.status || 500).json({
                success: false,
                message: err.status === 503
                    ? `Gerador de PDF indisponível: ${err.message}`
                    : 'Erro ao gerar o PDF da carteira.'
            });
        }
    });

    // ============================================================
    // ENVIAR A CARTEIRA DA SEMANA POR E-MAIL
    // ============================================================
    // Mesmos filtros da tela → mesmo PDF do botão "Exportar PDF", anexado num e-mail.
    // Usa o transporte central (utils/email.js, hoje apontando para o Resend via SMTP),
    // igual ao aviso de Ordem de Produção que o próprio PCP já envia.
    router.post('/carteira/enviar-email', async (req, res) => {
        try {
            const destinatarios = (Array.isArray(req.body?.para) ? req.body.para : String(req.body?.para || '').split(/[;,]/))
                .map(e => String(e || '').trim())
                .filter(Boolean);
            if (!destinatarios.length) {
                return res.status(400).json({ success: false, message: 'Informe ao menos um e-mail de destino.' });
            }
            const invalidos = destinatarios.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
            if (invalidos.length) {
                return res.status(400).json({ success: false, message: `E-mail inválido: ${invalidos.join(', ')}` });
            }

            const { enviarEmail, isConfigured } = require('../utils/email');
            if (typeof isConfigured === 'function' && !isConfigured()) {
                return res.status(503).json({
                    success: false,
                    message: 'Envio de e-mail não está configurado no servidor (SMTP/Resend). Configure antes de usar.'
                });
            }

            // O filtro vem na query string, igual ao PDF — o corpo só traz destinatário/mensagem.
            const { html, linhas, valorTotal, resumoFiltros, nomeEmpresa, sufixo, emitidoEm } = await montarHtmlCarteira(req);
            const pdf = await htmlParaPdf(html, {
                paisagem: true,
                margens: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
            });

            const moeda = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            const recado = String(req.body?.mensagem || '').trim();

            const corpo = `
<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;font-size:14px;line-height:1.5">
  <h2 style="color:#1e3a8a;margin:0 0 4px">Carteira de Pedidos</h2>
  <div style="color:#64748b;font-size:13px;margin-bottom:14px">${escHtml(nomeEmpresa)} · emitida em ${escHtml(emitidoEm)}</div>
  ${recado ? `<p style="background:#f8fafc;border-left:3px solid #1e3a8a;padding:10px 12px;white-space:pre-wrap">${escHtml(recado)}</p>` : ''}
  <p><strong>Filtro:</strong> ${escHtml(resumoFiltros)}</p>
  <p><strong>${linhas.length}</strong> pedido(s) · valor total <strong>${moeda(valorTotal)}</strong></p>
  <p style="color:#64748b;font-size:13px">O detalhamento completo está no PDF anexo.</p>
</div>`;

            const resultado = await enviarEmail({
                rota: 'sistema',
                para: destinatarios,
                assunto: `Carteira de Pedidos — ${nomeEmpresa} (${linhas.length} pedidos)`,
                html: corpo,
                texto: `Carteira de Pedidos — ${nomeEmpresa}\nFiltro: ${resumoFiltros}\n${linhas.length} pedido(s) · total ${moeda(valorTotal)}\nDetalhamento no PDF anexo.`,
                anexos: [{
                    filename: `carteira-pedidos-${sufixo}.pdf`,
                    content: pdf,
                    contentType: 'application/pdf'
                }]
            });

            if (resultado && resultado.success === false) {
                return res.status(502).json({ success: false, message: resultado.motivo || resultado.message || 'Falha ao enviar o e-mail.' });
            }

            console.log(`[PCP/CARTEIRA-EMAIL] Carteira (${linhas.length} pedidos) enviada para ${destinatarios.join(', ')} por ${req.user?.email || req.user?.id || 'desconhecido'}`);
            return res.json({
                success: true,
                message: `Carteira enviada para ${destinatarios.join(', ')}.`,
                pedidos: linhas.length
            });
        } catch (err) {
            if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
            console.error('[PCP/CARTEIRA-EMAIL] Erro:', err.message);
            return res.status(err.status || 500).json({
                success: false,
                message: err.status === 503
                    ? `Gerador de PDF indisponível: ${err.message}`
                    : 'Não foi possível enviar a carteira por e-mail.'
            });
        }
    });

    router.get('/carteira', async (req, res) => {
        try {
            res.json(await consultarCarteira(req));
        } catch (err) {
            if (err.status) return res.status(err.status).json({ success: false, message: err.message });
            console.error('[PCP/CARTEIRA] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar carteira de pedidos.' });
        }
    });

    // ============================================================
    // DETALHE / EDIÇÃO DE PEDIDO NA CARTEIRA (PCP)
    // Alimenta a tela de itens (duplo-clique) e o modal Editar Pedido.
    // ============================================================

    // Mesma regra de trava do módulo Vendas: pedido faturado/em análise não
    // pode ter itens/valores alterados pelo PCP (evita divergência fiscal).
    const PCP_STATUS_BLOQUEIA_EDICAO = ['faturado', 'recibo', 'entregue', 'cancelado', 'analise-credito', 'análise-crédito', 'analise', 'análise'];
    const pedidoBloqueado = (status) => {
        const s = String(status || '').toLowerCase().trim();
        return PCP_STATUS_BLOQUEIA_EDICAO.includes(s) || /analise|análise/.test(s);
    };

    // Casa cada item do pedido à OP correspondente (por produto/código) para
    // derivar STATUS OP, % de produção e o status do item exibidos na tela.
    function montarItensComProducao(itens, ops) {
        const key = v => String(v || '').trim().toUpperCase();
        return itens.map(it => {
            const op = ops.find(o =>
                (it.produto_id && o.produto_id && Number(o.produto_id) === Number(it.produto_id)) ||
                (key(o.codigo_produto) && key(o.codigo_produto) === key(it.codigo || it.produto_codigo))
            );
            const prog = op ? Math.max(0, Math.min(100, Number(op.progresso) || 0)) : 0;
            const status_item = !op ? 'Aberto'
                : (/conclu/i.test(op.status || '') ? 'Concluído' : (prog > 0 ? 'Em produção' : 'Aberto'));
            return {
                id: it.id, produto_id: it.produto_id,
                codigo: it.codigo || it.produto_codigo || '',
                descricao: it.descricao || '',
                quantidade: Number(it.quantidade) || 0,
                unidade: it.unidade || 'm',
                preco_unitario: Number(it.preco_unitario) || 0,
                subtotal: Number(it.subtotal) || 0,
                status_op: op ? (op.status || 'Em OP') : 'Sem OP',
                progresso: prog,
                status_item
            };
        });
    }

    // GET /api/pcp/pedidos/:id/detalhe — pedido + itens com status de produção
    router.get('/pedidos/:id(\\d+)/detalhe', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const [[pedido]] = await pool.query(`
                SELECT p.id, p.numero_pedido, p.cliente_id,
                       COALESCE(c.nome, p.cliente_nome) AS cliente, p.cliente_nome,
                       p.descricao, p.valor, p.valor AS valor_total, p.status, p.prioridade,
                       p.data_prevista, p.prazo_entrega, p.condicao_pagamento
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ? AND p.deleted_at IS NULL
            `, [id]);
            if (!pedido) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            const [itens] = await pool.query(`
                SELECT pi.id, pi.produto_id, pi.codigo, pi.descricao, pi.quantidade, pi.unidade,
                       pi.preco_unitario, pi.subtotal, pr.codigo AS produto_codigo
                FROM pedido_itens pi
                LEFT JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ? ORDER BY pi.id
            `, [id]);

            const [ops] = await pool.query(`
                SELECT id, codigo, codigo_produto, produto_id, produto_nome, status, progresso
                FROM ordens_producao
                WHERE COALESCE(pedido_vinculado_id, pedido_id) = ?
                   OR (COALESCE(pedido_vinculado_id, pedido_id) IS NULL AND numero_pedido = ?)
                ORDER BY id DESC
            `, [id, String(pedido.numero_pedido || '')]);

            res.json({
                success: true,
                pedido,
                itens: montarItensComProducao(itens, ops),
                editavel: !pedidoBloqueado(pedido.status)
            });
        } catch (err) {
            console.error('[PCP/PEDIDO-DETALHE] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar o pedido.' });
        }
    });

    // PUT /api/pcp/pedidos/:id — edição pré-faturamento (cliente, prioridade,
    // entrega e itens). Itens existentes são atualizados pelo id (preservando as
    // colunas fiscais); novos são inseridos e os removidos, apagados. O valor do
    // pedido é recalculado como a soma dos subtotais.
    router.put('/pedidos/:id(\\d+)', async (req, res) => {
        const conn = await pool.getConnection();
        try {
            const id = parseInt(req.params.id, 10);
            const { cliente_id, cliente_nome, prioridade, data_prevista, itens } = req.body || {};

            await conn.beginTransaction();
            const [[ped]] = await conn.query(
                'SELECT id, status FROM pedidos WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id]
            );
            if (!ped) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Pedido não encontrado.' }); }
            if (pedidoBloqueado(ped.status)) {
                await conn.rollback();
                return res.status(409).json({ success: false, code: 'EDIT_LOCKED', message: `Pedido com status "${ped.status}" não pode ser editado pelo PCP.` });
            }

            // ---- Cabeçalho ----
            const sets = [], vals = [];
            if (cliente_id !== undefined) {
                sets.push('cliente_id = ?'); vals.push(cliente_id ? parseInt(cliente_id, 10) : null);
            }
            if (cliente_nome !== undefined) { sets.push('cliente_nome = ?'); vals.push(cliente_nome ? String(cliente_nome).slice(0, 255) : null); }
            if (prioridade !== undefined) { sets.push('prioridade = ?'); vals.push(String(prioridade || '').slice(0, 32) || null); }
            if (data_prevista !== undefined) {
                // Aceita 'YYYY-MM-DD' (input date) ou vazio para limpar.
                const dp = /^\d{4}-\d{2}-\d{2}/.test(String(data_prevista || '')) ? String(data_prevista).slice(0, 10) : null;
                sets.push('data_prevista = ?'); vals.push(dp);
            }
            if (sets.length) {
                vals.push(id);
                await conn.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, vals);
            }

            // ---- Itens ----
            if (Array.isArray(itens)) {
                const limpos = itens.map(it => ({
                    id: it.id ? parseInt(it.id, 10) : null,
                    produto_id: it.produto_id ? parseInt(it.produto_id, 10) : null,
                    codigo: String(it.codigo || '').slice(0, 255),
                    descricao: String(it.descricao || '').slice(0, 1000),
                    quantidade: Math.max(0, parseFloat(it.quantidade) || 0),
                    unidade: String(it.unidade || 'm').slice(0, 20),
                    preco_unitario: Math.max(0, parseFloat(it.preco_unitario) || 0)
                })).filter(it => it.descricao || it.produto_id);

                if (!limpos.length) {
                    await conn.rollback();
                    return res.status(400).json({ success: false, message: 'O pedido precisa ter ao menos um item.' });
                }

                // Traz também o preço atual: editando um item, o piso é o valor que já
                // estava gravado; item novo compara com o cadastro do produto.
                const [atuais] = await conn.query('SELECT id, preco_unitario, desconto FROM pedido_itens WHERE pedido_id = ?', [id]);
                const idsAtuais = new Set(atuais.map(r => r.id));
                const precoAtualPorItem = new Map(atuais.map(r => [r.id, parseFloat(r.preco_unitario) || 0]));
                const descontoAtualPorItem = new Map(atuais.map(r => [r.id, parseFloat(r.desconto) || 0]));
                const idsMantidos = new Set();

                // Piso do preço: o PUT do PCP grava e ATUALIZA preco_unitario vindo do
                // corpo — dava para baixar o preço de um item por aqui sem passar pela
                // tela de Vendas. Valida tudo antes de gravar qualquer linha.
                if (typeof global.__validarPisoPrecoItem === 'function') {
                    for (const it of limpos) {
                        const _erroPiso = await global.__validarPisoPrecoItem({
                            produtoId: it.produto_id,
                            codigo: it.codigo,
                            preco: it.preco_unitario,
                            quantidade: it.quantidade,
                            desconto: (it.id && descontoAtualPorItem.has(it.id)) ? descontoAtualPorItem.get(it.id) : 0,
                            precoAnterior: (it.id && precoAtualPorItem.has(it.id)) ? precoAtualPorItem.get(it.id) : null,
                            token: it.autorizacao_desconto_token || it.autorizacao_preco_token
                                || req.body?.autorizacao_desconto_token || req.body?.autorizacao_preco_token,
                            // O token do piso é reutilizável dentro do mesmo pedido; o id é o que
                            // impede a autorização de escorregar para outro documento.
                            pedidoId: id
                        });
                        if (_erroPiso) {
                            await conn.rollback();
                            return res.status(_erroPiso.status).json({ success: false, message: _erroPiso.message, code: _erroPiso.code });
                        }
                    }
                }

                for (const it of limpos) {
                    const subtotal = +(it.quantidade * it.preco_unitario).toFixed(2);
                    if (it.id && idsAtuais.has(it.id)) {
                        idsMantidos.add(it.id);
                        await conn.query(
                            `UPDATE pedido_itens SET produto_id = ?, codigo = ?, descricao = ?, quantidade = ?,
                                    unidade = ?, preco_unitario = ?, subtotal = ? WHERE id = ? AND pedido_id = ?`,
                            [it.produto_id, it.codigo, it.descricao, it.quantidade, it.unidade, it.preco_unitario, subtotal, it.id, id]
                        );
                    } else {
                        await conn.query(
                            `INSERT INTO pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, unidade, preco_unitario, subtotal)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [id, it.produto_id, it.codigo, it.descricao, it.quantidade, it.unidade, it.preco_unitario, subtotal]
                        );
                    }
                }
                // Remove os que o usuário tirou do pedido.
                const remover = [...idsAtuais].filter(x => !idsMantidos.has(x));
                if (remover.length) {
                    await conn.query(`DELETE FROM pedido_itens WHERE pedido_id = ? AND id IN (${remover.map(() => '?').join(',')})`, [id, ...remover]);
                }

                const [[{ total }]] = await conn.query(
                    'SELECT COALESCE(SUM(subtotal), 0) AS total FROM pedido_itens WHERE pedido_id = ?', [id]
                );
                await conn.query('UPDATE pedidos SET valor = ? WHERE id = ?', [total, id]);
            }

            await conn.commit();

            // Devolve o pedido já atualizado (reusa a mesma montagem do detalhe).
            const [[pedido]] = await pool.query(`
                SELECT p.id, p.numero_pedido, p.cliente_id, COALESCE(c.nome, p.cliente_nome) AS cliente,
                       p.cliente_nome, p.descricao, p.valor, p.status, p.prioridade, p.data_prevista, p.condicao_pagamento
                FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?`, [id]);
            const [itensAtualizados] = await pool.query(`
                SELECT pi.id, pi.produto_id, pi.codigo, pi.descricao, pi.quantidade, pi.unidade,
                       pi.preco_unitario, pi.subtotal, pr.codigo AS produto_codigo
                FROM pedido_itens pi LEFT JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ? ORDER BY pi.id`, [id]);
            const [ops] = await pool.query(`
                SELECT id, codigo, codigo_produto, produto_id, produto_nome, status, progresso
                FROM ordens_producao
                WHERE COALESCE(pedido_vinculado_id, pedido_id) = ?
                   OR (COALESCE(pedido_vinculado_id, pedido_id) IS NULL AND numero_pedido = ?)
                ORDER BY id DESC
            `, [id, String(pedido?.numero_pedido || '')]);
            res.json({ success: true, message: 'Pedido atualizado.', pedido, itens: montarItensComProducao(itensAtualizados, ops), editavel: !pedidoBloqueado(pedido?.status) });
        } catch (err) {
            try { await conn.rollback(); } catch (_) {}
            console.error('[PCP/PEDIDO-UPDATE] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao salvar o pedido. Nenhuma alteração foi mantida.' });
        } finally {
            conn.release();
        }
    });

    // ============================================================
    // Relatório do PCP no template neutro (Templates - Sistema/.../html-relatorios/_template.html)
    // O cliente monta a tabela (a partir dos endpoints reais) e envia em `body`; aqui embrulhamos
    // no template com o cabeçalho REAL da empresa (empresa_config) e devolvemos o HTML pronto para
    // o usuário imprimir como PDF. Reusa o mesmo renderer do Vendas (html-relatorio-renderer).
    // ============================================================
    router.post('/relatorio-render', authenticateToken, async (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const { buildEmpresaTemplateData, renderTemplateString, resolveRelatorioTemplate } = require('../src/services/html-relatorio-renderer');
            const { titulo, subtitulo, referencia, fields, body } = req.body || {};
            if (!body || typeof body !== 'string') return res.status(400).json({ error: 'Corpo do relatório vazio.' });

            let cfg = {};
            try { const [rows] = await pool.query('SELECT * FROM empresa_config ORDER BY id LIMIT 1'); cfg = (rows && rows[0]) || {}; } catch (_) { /* segue sem cabeçalho */ }
            const dados = {
                nome: cfg.razao_social || cfg.nome_fantasia || 'Empresa',
                nomeFantasia: cfg.nome_fantasia || cfg.razao_social || 'Empresa',
                cnpj: cfg.cnpj || '', inscricaoEstadual: cfg.inscricao_estadual || 'Isento',
                endereco: cfg.endereco || '', numero: cfg.numero || '', bairro: cfg.bairro || '',
                cidade: cfg.cidade || '', estado: cfg.estado || '', cep: cfg.cep || '',
                telefone: cfg.telefone || '', email: cfg.email || '', site: cfg.site || ''
            };
            const projectRoot = path.join(__dirname, '..');
            const emp = buildEmpresaTemplateData(cfg, dados, projectRoot);
            let tpl = fs.readFileSync(resolveRelatorioTemplate(projectRoot, '_template.html'), 'utf8');
            tpl = tpl.replace(/__TITULO__/g, String(titulo || 'Relatório'))
                     .replace(/__SUBTITULO__/g, String(subtitulo || ''))
                     .replace(/__REFERENCIA__/g, String(referencia || ''))
                     .replace(/__FIELDS__/g, String(fields || ''));
            tpl = renderTemplateString(tpl, emp);   // preenche {{empresa_*}} e {{gerado_em}}
            tpl = tpl.replace(/__BODY__/g, body);   // corpo (tabela) inserido cru por último
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(tpl);
        } catch (err) {
            console.error('[PCP/RELATORIO] erro:', err.message);
            res.status(500).send('<h1>Erro ao gerar o relatório</h1><p>' + String(err.message || '').replace(/</g, '&lt;') + '</p>');
        }
    });

    // Disponibilidade / OEE por máquina (sessões de operação, paradas, turnos e indicadores).
    // Vai no MESMO router para herdar authenticateToken + área pcp|compras + writeGuard,
    // e para não exigir patch em routes/index.js, que diverge entre as 3 instâncias.
    try {
        require('./pcp-oee')(router, pool);
    } catch (eOee) {
        console.error('[ROUTES] pcp-oee mount err:', eOee.message);
    }

    return router;
};
