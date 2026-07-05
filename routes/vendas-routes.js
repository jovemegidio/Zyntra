/**
 * VENDAS ROUTES (CRM) - Extracted from server.js (Lines 17347-19745)
 * Pedidos, clientes, faturamento, parciais
 * @module routes/vendas-routes
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const { auditTrail } = require('../middleware/audit-trail');
const { tenantScope } = require('../middleware/rls-tenant');
const { validate: joiValidate, schemas: joiSchemas } = require('../middleware/schema-validation');

module.exports = function createVendasRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, authorizeAdminOrComercial, writeAuditLog, cacheMiddleware, CACHE_CONFIG, checkOwnership, writeGuard } = deps;
    const router = express.Router();

    // Repository pattern (ARCH-008)
    const createRepositories = require('../repositories');
    const repos = createRepositories(pool);
    const ReformaTributariaService = require('../services/reforma-tributaria.service');
    const tableColumnsCache = new Map();

    async function getTableColumns(tableName) {
        if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
            throw new Error('Nome de tabela inválido');
        }

        if (tableColumnsCache.has(tableName)) {
            return tableColumnsCache.get(tableName);
        }

        const [rows] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const columns = new Set(rows.map(row => row.Field));
        tableColumnsCache.set(tableName, columns);
        return columns;
    }

    // Validação de documento (CNPJ 14 díg. OU CPF 11 díg. com dígitos verificadores).
    // Mesma regra usada no cadastro de fornecedor (Compras).
    function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
    function isValidCPF(cpf) {
        cpf = onlyDigits(cpf);
        if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
        let s = 0; for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
        let d = (s * 10) % 11; if (d === 10) d = 0; if (d !== +cpf[9]) return false;
        s = 0; for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
        d = (s * 10) % 11; if (d === 10) d = 0; return d === +cpf[10];
    }
    function isValidCNPJ(cnpj) {
        cnpj = onlyDigits(cnpj);
        if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
        const calc = (len) => {
            let p = len - 7, s = 0;
            for (let i = len; i >= 1; i--) { s += cnpj[len - i] * p--; if (p < 2) p = 9; }
            const r = s % 11; return r < 2 ? 0 : 11 - r;
        };
        return calc(12) === +cnpj[12] && calc(13) === +cnpj[13];
    }
    function isValidDoc(doc) {
        const d = onlyDigits(doc);
        return (d.length === 14 && isValidCNPJ(d)) || (d.length === 11 && isValidCPF(d));
    }

    // Verifica se o usuario logado pode cadastrar pedidos/clientes de venda.
    // Admins e papeis comerciais sempre podem. Usuarios com permissoes_vendas.<tipo>===false sao bloqueados.
    // Fail-open quando nao ha configuracao explicita (comportamento legado), para nao travar vendedores.
    // Papéis autorizados a criar pedido/orçamento e cadastrar cliente.
    // Regra definida pela gestão em 04/07/2026: vendedor (comercial) + gestão; quem NÃO é desses
    // papéis só passa com permissão granular explícita. Deny-by-default (fallbacks negam) para não
    // vazar a criação a perfis como financeiro/pcp/rh/operador que só têm acesso de leitura.
    async function podeCadastrarVendas(reqUser, tipo) {
        try {
            if (!reqUser || !reqUser.id) return false;
            const role = String(reqUser.role || '').toLowerCase().trim();
            const ROLES_VENDAS = ['admin','super_admin','ti','diretoria','gerente','supervisor','comercial','vendas','faturamento'];
            if (reqUser.is_admin === 1 || reqUser.is_admin === true || reqUser.is_admin === '1' ||
                ROLES_VENDAS.includes(role)) {
                return true;
            }
            // Fora dos papéis de vendas: só passa com permissão granular explícita = true
            const cols = await getTableColumns('usuarios');
            if (!cols.has('permissoes_vendas')) return false;
            const [prows] = await pool.query('SELECT permissoes_vendas FROM usuarios WHERE id = ? LIMIT 1', [reqUser.id]);
            if (!prows.length) return false;
            let p = prows[0].permissoes_vendas;
            if (p == null || p === '') return false;
            if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { return false; } }
            if (p && typeof p === 'object') {
                const key = tipo === 'clientes' ? 'clientes' : 'pedidos';
                return p[key] === true;
            }
            return false;
        } catch (e) {
            console.warn('[VENDAS/PERM] podeCadastrarVendas erro — negando por segurança:', e.message);
            return false;
        }
    }

    function firstExistingColumnSelect(alias, columns, candidates, outputAlias) {
        const existing = candidates.filter(column => columns.has(column));
        if (existing.length === 0) return `NULL AS ${outputAlias}`;
        if (existing.length === 1) return `${alias}.${existing[0]} AS ${outputAlias}`;
        return `COALESCE(${existing.map(column => `${alias}.${column}`).join(', ')}) AS ${outputAlias}`;
    }

    function selectExistingColumns(alias, columns, candidates) {
        return candidates.map(({ column, alias: outputAlias, fallback }) => {
            if (columns.has(column)) return `${alias}.${column} AS ${outputAlias || column}`;
            return `${fallback === undefined ? 'NULL' : fallback} AS ${outputAlias || column}`;
        });
    }

    function normalizePaymentDays(value) {
        const parts = String(value || '0')
            .replace(/[/;]/g, ',')
            .split(',')
            .map(v => v.trim())
            .filter(Boolean)
            .filter(v => /^\d+$/.test(v));
        return parts.length ? parts.join(',') : '0';
    }

    // Payment conditions validation
    const { validarCondicaoPagamento, getFaixaPagamento, gerarParcelasAutomaticas, formatarCondicaoPagamento } = require('../utils/condicoes-pagamento');

    // Serviço compartilhado de faturamento (configuração centralizada, CFOP, numeração, admin check)
    const { getFaturamentoSharedService } = require('../services/faturamento-shared.service');
    const {
        createFaturamentoParcialHandlers,
        determineRemessaCfop
    } = require('../services/faturamento-parcial.service');
    const faturamentoShared = getFaturamentoSharedService(pool);

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const fs = require('fs');
    const SAFE_MIMES = new Set(['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/xml','text/xml']);
    const safeFileFilter = (req, file, cb) => SAFE_MIMES.has(file.mimetype) ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: safeFileFilter });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };

    // AUDIT-FIX SEC-001: IDOR protection for pedidos (owner = vendedor_id)
    const pedidoOwnership = checkOwnership ? checkOwnership(pool, 'pedidos', 'vendedor_id') : (req, res, next) => next();

    // LGPD-FIX: Criptografar PII (CNPJ/CPF) antes de gravar no banco
    let lgpdCrypto = null;
    try { lgpdCrypto = require('../lgpd-crypto'); } catch (_) {}
    const _enc = (val) => (lgpdCrypto && lgpdCrypto.encryptPII) ? lgpdCrypto.encryptPII(val) : val;

    // Detecta usuário do PCP (chefe de produção). O PCP NÃO cria pedidos, mas
    // precisa ver o Kanban de Vendas inteiro e faturar (mover de Aprovado em diante).
    function isPcpUser(reqUser) {
        if (!reqUser) return false;
        const role = String(reqUser.role || '').toLowerCase().trim();
        const email = String(reqUser.email || '').toLowerCase().trim();
        return role === 'pcp' || role === 'producao' || role === 'produção'
            || email.startsWith('pcp@');
    }

    router.use(authenticateToken);
    // PCP entra no módulo Vendas (somente leitura do Kanban + faturamento — criação
    // e edição continuam barradas pelas verificações por-rota abaixo).
    router.use(authorizeArea(['vendas', 'pcp']));
    // AUDIT-FIX PERM-004: Block mutations for consultoria/restricted roles
    router.use(writeGuard || ((req, res, next) => next()));
    // Audit trail for mutation operations
    router.use(auditTrail('vendas'));
    // Multi-tenant isolation
    router.use(tenantScope());

    // Garantir que tabela notificacoes existe (inicialização única)
    pool.query(`
        CREATE TABLE IF NOT EXISTS notificacoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT,
            titulo VARCHAR(255),
            mensagem TEXT,
            tipo VARCHAR(50) DEFAULT 'info',
            link VARCHAR(500),
            dados_extras JSON,
            lida TINYINT(1) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).catch(e => console.error('Erro ao criar tabela notificacoes:', e.message));

    // Correção pontual dos pedidos afetados pela falha de persistência de condição de pagamento
    const sincronizarCondicoesPedidosAfetados = async () => {
        try {
            const pedidosAfetados = [
                { numero: 4, condicao: '28 / 35 / 42 dias' },
                { numero: 5, condicao: '28 / 35 / 42 / 49 dias' }
            ];

            for (const pedido of pedidosAfetados) {
                await pool.query(`
                    UPDATE pedidos
                    SET condicao_pagamento = ?,
                        condicoes_pagamento = ?,
                        parcelas = ?,
                        updated_at = NOW()
                    WHERE (id = ? OR numero_pedido = ?)
                      AND (
                          COALESCE(condicao_pagamento, '') <> ? OR
                          COALESCE(condicoes_pagamento, '') <> ? OR
                          COALESCE(parcelas, '') <> ?
                      )
                `, [
                    pedido.condicao,
                    pedido.condicao,
                    pedido.condicao,
                    pedido.numero,
                    pedido.numero,
                    pedido.condicao,
                    pedido.condicao,
                    pedido.condicao
                ]);
            }
        } catch (e) {
            console.warn('[VENDAS] Falha ao sincronizar condições dos pedidos afetados:', e.message);
        }
    };
    sincronizarCondicoesPedidosAfetados();

    // Precificação: retorna fatores de preço por tipo de venda e UF
    router.get('/precificacao', async (req, res) => {
        try {
            const tipoVenda = req.query.tipo_venda || 'consumidor';
            const uf = (req.query.uf || 'SP').toUpperCase();

            // Buscar configuração de precificação do banco se existir
            let config = null;
            try {
                const [rows] = await pool.query(
                    'SELECT * FROM configuracoes_custos_precificacao WHERE ativo = 1 ORDER BY id DESC LIMIT 1'
                );
                if (rows.length > 0) config = rows[0];
            } catch (e) {
                // Tabela pode não existir
            }

            // Tabela de ICMS interestadual por UF (alíquota destino)
            const icmsEstados = {
                'AC': { icms: 12, difal: 5, st: 0 }, 'AL': { icms: 12, difal: 6, st: 0 },
                'AM': { icms: 12, difal: 6, st: 0 }, 'AP': { icms: 12, difal: 6, st: 0 },
                'BA': { icms: 12, difal: 7.5, st: 0 }, 'CE': { icms: 12, difal: 6, st: 0 },
                'DF': { icms: 12, difal: 6, st: 0 }, 'ES': { icms: 12, difal: 5, st: 0 },
                'GO': { icms: 12, difal: 5, st: 0 }, 'MA': { icms: 12, difal: 6, st: 0 },
                'MG': { icms: 12, difal: 6, st: 10 }, 'MS': { icms: 12, difal: 5, st: 0 },
                'MT': { icms: 12, difal: 5, st: 0 }, 'PA': { icms: 12, difal: 5, st: 0 },
                'PB': { icms: 12, difal: 6, st: 0 }, 'PE': { icms: 12, difal: 6, st: 0 },
                'PI': { icms: 12, difal: 9, st: 0 }, 'PR': { icms: 12, difal: 7, st: 10 },
                'RJ': { icms: 12, difal: 8, st: 10 }, 'RN': { icms: 12, difal: 6, st: 0 },
                'RO': { icms: 12, difal: 5.5, st: 0 }, 'RR': { icms: 12, difal: 5, st: 0 },
                'RS': { icms: 12, difal: 5, st: 10 }, 'SC': { icms: 12, difal: 5, st: 10 },
                'SE': { icms: 12, difal: 6, st: 0 }, 'SP': { icms: 18, difal: 0, st: 10 },
                'TO': { icms: 12, difal: 6, st: 0 }
            };

            const ufData = icmsEstados[uf] || { icms: 12, difal: 5, st: 0 };

            // Calcular fator de preço baseado no tipo de venda
            let markup = config ? parseFloat(config.markup_padrao || 1.3) : 1.3;
            let icms = ufData.icms;
            let difal = 0;
            let icms_st = 0;

            if (tipoVenda === 'consumidor' || tipoVenda === 'consumidor_final') {
                difal = ufData.difal;
                icms_st = 0;
            } else {
                // revenda
                difal = 0;
                icms_st = ufData.st;
            }

            res.json({
                tipo_venda: tipoVenda,
                uf: uf,
                markup: markup,
                fator_preco: markup,
                icms: icms,
                difal: difal,
                icms_st: icms_st,
                pis_cofins: 3.65
            });
        } catch (error) {
            console.error('Erro ao buscar precificação:', error);
            res.status(500).json({ message: 'Erro ao buscar precificação' });
        }
    });

    // Endpoint de KPIs para o módulo de Vendas — AUDIT-FIX PERF-001: Add cache
    router.get('/kpis', cacheMiddleware('vendas_kpis', CACHE_CONFIG.dashboardKPIs || 300000), async (req, res) => {
        try {
            // Verificar se é admin
            const isAdmin = req.user && (req.user.is_admin === 1 || req.user.role === 'admin');
            if (!isAdmin) {
                return res.status(403).json({ success: false, message: 'Acesso negado' });
            }

            const hoje = new Date().toISOString().split('T')[0];

            // Buscar Contas a Pagar (vencendo hoje)
            let contasPagarHoje = { valor: 0, quantidade: 0 };
            try {
                const [pagarRows] = await pool.query(`
                    SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                    FROM contas_pagar
                    WHERE data_vencimento = ? AND (status IS NULL OR status NOT IN ('pago', 'cancelado'))
                `, [hoje]);
                if (pagarRows[0]) {
                    contasPagarHoje = { valor: parseFloat(pagarRows[0].valor) || 0, quantidade: parseInt(pagarRows[0].quantidade) || 0 };
                }
            } catch (e) {
                console.log('[KPIs] Tabela contas_pagar não encontrada:', e.message);
            }

            // Buscar Contas a Receber (vencendo hoje)
            let contasReceberHoje = { valor: 0, quantidade: 0 };
            try {
                const [receberRows] = await pool.query(`
                    SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                    FROM contas_receber
                    WHERE data_vencimento = ? AND (status IS NULL OR status NOT IN ('recebido', 'cancelado'))
                `, [hoje]);
                if (receberRows[0]) {
                    contasReceberHoje = { valor: parseFloat(receberRows[0].valor) || 0, quantidade: parseInt(receberRows[0].quantidade) || 0 };
                }
            } catch (e) {
                console.log('[KPIs] Tabela contas_receber não encontrada:', e.message);
            }

            // Buscar Pedidos a Faturar (etapa = 'Pedido Aprovado' ou 'Pedido a Faturar')
            let pedidosAFaturar = { valor: 0, quantidade: 0 };
            try {
                // FIX: Usar coluna 'status' (padrão do sistema) em vez de 'etapa' que pode não existir
                const [pedidosRows] = await pool.query(`
                    SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                    FROM pedidos
                    WHERE status IN ('aprovado', 'pedido-aprovado', 'faturar')
                `);
                if (pedidosRows[0]) {
                    pedidosAFaturar = { valor: parseFloat(pedidosRows[0].valor) || 0, quantidade: parseInt(pedidosRows[0].quantidade) || 0 };
                }
            } catch (e) {
                console.log('[KPIs] Erro ao buscar pedidos a faturar:', e.message);
            }

            res.json({
                success: true,
                kpis: {
                    contas_pagar_hoje: contasPagarHoje,
                    a_receber_hoje: contasReceberHoje,
                    pedidos_a_faturar: pedidosAFaturar
                }
            });
        } catch (error) {
            console.error('[API/VENDAS/KPIS] Erro:', error);
            res.status(500).json({ success: false, message: 'Erro ao carregar KPIs' });
        }
    });

    // Rota /me para Vendas retornar dados do usuário logado
    router.get('/me', async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Não autenticado' });
            }

            // Buscar dados completos do usuário no banco com JOIN para foto do funcionário
            const [[dbUser]] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin,
                        u.permissoes_vendas as permissoes, u.foto, u.avatar,
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
                    console.error('[API/VENDAS/ME] Erro ao parsear permissoes:', e);
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
            console.error('[API/VENDAS/ME] Erro ao buscar usuário:', error);
            res.status(500).json({ message: 'Erro ao buscar dados do usuário' });
        }
    });

    router.get('/permissoes-acesso', async (req, res, next) => {
        try {
            const columns = await getTableColumns('usuarios');
            const select = selectExistingColumns('u', columns, [
                { column: 'id', alias: 'id' },
                { column: 'nome', alias: 'nome', fallback: "''" },
                { column: 'email', alias: 'email', fallback: "''" },
                { column: 'role', alias: 'role', fallback: "'usuario'" },
                { column: 'is_admin', alias: 'is_admin', fallback: '0' },
                { column: 'permissoes_vendas', alias: 'permissoes_vendas', fallback: 'NULL' },
                { column: 'permissoes', alias: 'permissoes', fallback: 'NULL' },
                { column: 'areas', alias: 'areas', fallback: 'NULL' },
                { column: 'ativo', alias: 'ativo', fallback: '1' },
                { column: 'status', alias: 'status', fallback: "'ativo'" },
                { column: 'deleted_at', alias: 'deleted_at', fallback: 'NULL' }
            ]).join(', ');
            const filtros = [
                "LOWER(COALESCE(u.email, '')) LIKE '%@aluforce.ind.br'"
            ];
            if (columns.has('ativo')) filtros.push('COALESCE(u.ativo, 1) = 1');
            if (columns.has('status')) filtros.push("LOWER(COALESCE(u.status, 'ativo')) NOT IN ('inativo','bloqueado','desativado','excluido','excluido','demitido','desligado','removido')");
            if (columns.has('deleted_at')) filtros.push('u.deleted_at IS NULL');
            const where = `WHERE ${filtros.join(' AND ')}`;
            const order = columns.has('nome') ? 'ORDER BY u.nome ASC' : 'ORDER BY u.id ASC';
            const [rows] = await pool.query(`SELECT ${select} FROM usuarios u ${where} ${order}`);

            function parsePermissoes(raw) {
                if (!raw) return null;
                if (typeof raw === 'object') return raw;
                try { return JSON.parse(raw); } catch (_) { return String(raw); }
            }

            function temPermissaoVendas(perms) {
                if (!perms) return false;
                let p = perms;
                if (typeof p === 'string') {
                    try { p = JSON.parse(p); } catch (_) { return /vendas|comercial|faturamento/i.test(perms); }
                }
                if (Array.isArray(p)) return p.some(item => /vendas|comercial|faturamento|nfe|nf-e/i.test(String(item || '')));
                if (p && typeof p === 'object') {
                    // Acesso real ao cadastro de vendas: criar pedidos OU clientes OU emitir NF-e
                    return p.vendas === true || p.modulo === 'vendas' || p.area === 'vendas'
                        || p.pedidos === true || p.clientes === true || p.nfe === true || p.gestao === true
                        || (p.modulos && (p.modulos.vendas === true || p.modulos.nfe === true))
                        || (p.areas && Array.isArray(p.areas) && p.areas.includes('vendas'));
                }
                return false;
            }

            function emailPermitido(email) {
                const e = String(email || '').toLowerCase().trim();
                if (!e.endsWith('@aluforce.ind.br')) return false;
                if (e === 'teste@aluforce.ind.br' || e.startsWith('qa')) return false;
                if (e.includes('+qa') || e.includes('.qa@') || e.includes('teste')) return false;
                if (e === 'regina.ballotti@aluforce.ind.br' || e === 'regina.balotti@aluforce.ind.br') return false;
                return true;
            }

            function areasInclui(areasRaw, alvo) {
                let a = parsePermissoes(areasRaw);
                // Suporte ao formato "base64:typeNN:<conteudo>" (algumas linhas da coluna areas)
                if (typeof a === 'string') {
                    const b64 = a.match(/^base64:[^:]*:(.+)$/);
                    if (b64) { try { a = JSON.parse(Buffer.from(b64[1], 'base64').toString('utf8')); } catch (_) { /* mantem */ } }
                }
                if (Array.isArray(a)) return a.map(x => String(x).toLowerCase()).includes(alvo);
                if (typeof a === 'string') return a.toLowerCase().includes(alvo);
                return false;
            }

            function usuarioTemAcessoVendas(user) {
                const role = String(user.role || '').toLowerCase();
                const permsVendas = parsePermissoes(user.permissoes_vendas);
                const permsGerais = parsePermissoes(user.permissoes);
                const admin = user.is_admin === 1 || user.is_admin === true || ['admin', 'super_admin', 'ti', 'diretoria'].includes(role);
                return admin || temPermissaoVendas(permsVendas) || temPermissaoVendas(permsGerais)
                    || areasInclui(user.areas, 'vendas')
                    || /vendas|comercial|faturamento|nfe|nf-e/.test(role);
            }

            function grupoUsuario(user) {
                const role = String(user.role || '').toLowerCase();
                const perms = parsePermissoes(user.permissoes_vendas || user.permissoes);
                if (user.is_admin === 1 || user.is_admin === true || ['admin', 'super_admin', 'ti', 'diretoria'].includes(role)) {
                    return 'Administrador';
                }
                if (temPermissaoVendas(perms) || /vendas|comercial|faturamento|nfe|nf-e/.test(role)) {
                    return 'Vendas e NF-e';
                }
                return 'Vendas e NF-e';
            }

            const gruposMap = new Map();
            rows.filter(row => emailPermitido(row.email) && usuarioTemAcessoVendas(row)).forEach(row => {
                const grupo = grupoUsuario(row);
                if (!gruposMap.has(grupo)) gruposMap.set(grupo, []);
                gruposMap.get(grupo).push({
                    id: row.id,
                    nome: row.nome || row.email || ('Usuario ' + row.id),
                    email: row.email || '',
                    role: row.role || '',
                    is_admin: row.is_admin === 1 || row.is_admin === true,
                    permissoes: parsePermissoes(row.permissoes_vendas || row.permissoes)
                });
            });

            res.json({
                success: true,
                grupos: Array.from(gruposMap.entries()).map(([nome, usuarios]) => ({ nome, usuarios }))
            });
        } catch (error) {
            console.error('[API/VENDAS/PERMISSOES] Erro:', error);
            next(error);
        }
    });

    // PEDIDOS
    router.get('/pedidos', cacheMiddleware('vendas_pedidos', 60000), async (req, res, next) => {
        try {
            const { period, page = 1, limit = 100, status } = req.query;
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
            // AUDIT-FIX S9.8: Cap limit to prevent unbounded queries
            const safeLimit = Math.min(Math.max(1, parseInt(limit) || 100), 500);
            const rows = await repos.pedido.list({ period, page, limit: safeLimit, userId: user.id, isAdmin, status });
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/pedidos/search', async (req, res, next) => {
        try {
            const q = req.query.q || '';
            const rows = await repos.pedido.search(q);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/pedidos/:id', pedidoOwnership, async (req, res, next) => {
        try {
            const { id } = req.params;
            const [[pedido]] = await pool.query(`
                SELECT p.*, p.valor as valor_total, p.created_at as data_pedido,
                       p.transportadora_id, p.transportadora_nome,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente, 'Cliente não informado') AS cliente_nome,
                       c.cnpj_cpf AS cliente_cnpj, c.inscricao_estadual AS cliente_ie,
                       c.endereco AS cliente_endereco, c.numero AS cliente_numero,
                       c.bairro AS cliente_bairro, c.cidade AS cliente_cidade,
                       c.estado AS cliente_uf, c.cep AS cliente_cep,
                       c.contato AS cliente_contato, c.complemento AS cliente_complemento,
                       c.email AS cliente_email, c.telefone AS cliente_telefone,
                       e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
                       COALESCE(p.vendedor_nome, u.nome) AS vendedor_nome,
                       t.razao_social AS transp_razao_social,
                       t.cnpj_cpf AS transp_cnpj,
                       t.telefone AS transp_telefone,
                       t.email AS transp_email,
                       t.cidade AS transp_cidade,
                       t.estado AS transp_estado,
                       t.bairro AS transp_bairro,
                       t.cep AS transp_cep,
                       t.endereco AS transp_endereco
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.id = ?
            `, [id]);
            if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

            // Buscar itens do pedido
            let itensDB = [];
            try {
                const [rows] = await pool.query('SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
                itensDB = rows;
            } catch (e) { /* tabela pode não existir */ }

            // Auto-repair: se pedido_itens vazio mas produtos_preview tem dados
            // AUDIT-FIX HIGH-007: Wrapped auto-repair in transaction to prevent partial inserts
            let previewItens = [];
            try { previewItens = JSON.parse(pedido.produtos_preview || '[]'); } catch(e) { previewItens = []; }
            if (itensDB.length === 0 && previewItens.length > 0) {
                console.log(`[VENDAS] Auto-repair (router): inserindo ${previewItens.length} itens do preview para pedido #${id}`);
                const repairConn = await pool.getConnection();
                try {
                    await repairConn.beginTransaction();
                    for (const item of previewItens) {
                        const qty = parseFloat(item.quantidade) || 1;
                        const preco = parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0;
                        const desc = parseFloat(item.desconto) || 0;
                        const subtotal = (qty * preco) - desc;
                        await repairConn.query(
                            `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [id, item.codigo || '', item.descricao || item.nome || '', qty, parseFloat(item.quantidade_parcial) || 0,
                             item.unidade || 'UN', item.local_estoque || 'PADRAO - Local de Estoque Padrão', preco, desc, subtotal]
                        );
                    }
                    await repairConn.commit();
                    const [rows2] = await pool.query('SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
                    itensDB = rows2;
                    // Sprint 4.7: Limpar produtos_preview após migração bem-sucedida para pedido_itens
                    await pool.query('UPDATE pedidos SET produtos_preview = NULL WHERE id = ?', [id]);
                    console.log(`[VENDAS] Sprint 4.7: produtos_preview limpo para pedido #${id} após migração (${rows2.length} itens migrados)`);
                } catch (e) {
                    await repairConn.rollback();
                    console.log('[VENDAS] Erro no auto-repair router (rollback):', e.message);
                } finally {
                    repairConn.release();
                }
            }

            // Auto-repair: fill NULL/VLOOKUP codigo/descricao from produto_id or codigo lookup
            let repaired = false;
            for (const item of itensDB) {
                const descInvalid = !item.descricao || item.descricao.includes('VLOOKUP') || item.descricao.includes('vlookup');
                if (descInvalid || !item.codigo) {
                    try {
                        let prods = [];
                        if (item.produto_id) {
                            const [rows] = await pool.query('SELECT codigo, COALESCE(NULLIF(TRIM(descricao),\'\'), nome, codigo) as descricao FROM produtos WHERE id = ?', [item.produto_id]);
                            prods = rows;
                        }
                        if (prods.length === 0 && item.codigo) {
                            const [rows] = await pool.query('SELECT codigo, COALESCE(NULLIF(TRIM(descricao),\'\'), nome, codigo) as descricao FROM produtos WHERE codigo = ? LIMIT 1', [item.codigo]);
                            prods = rows;
                        }
                        if (prods.length > 0 && prods[0].descricao && !prods[0].descricao.includes('VLOOKUP')) {
                            const pCodigo = prods[0].codigo || '';
                            const pDescricao = prods[0].descricao || '';
                            if (!item.codigo && pCodigo) { item.codigo = pCodigo; }
                            if (descInvalid && pDescricao) {
                                item.descricao = pDescricao;
                                await pool.query('UPDATE pedido_itens SET descricao = ? WHERE id = ?', [pDescricao, item.id]);
                                repaired = true;
                            }
                            if (!item.codigo) {
                                await pool.query('UPDATE pedido_itens SET codigo = COALESCE(NULLIF(codigo,\'\'), ?) WHERE id = ?', [pCodigo, item.id]);
                                repaired = true;
                            }
                        }
                    } catch (repairErr) { console.warn('[VENDAS] Auto-repair codigo/descricao erro:', repairErr.message); }
                }
            }
            if (repaired) console.log(`[VENDAS] Auto-repair: preencheu codigo/descricao via produto_id/codigo para pedido #${id}`);

            pedido.itens = itensDB;
            res.json(pedido);
        } catch (error) { next(error); }
    });
    const cacheService = (() => { try { return require('../services/cache'); } catch(_) { return null; } })();
    const clearPedidosCache = () => {
        if (cacheService && cacheService.cacheClear) {
            cacheService.cacheClear('vendas_pedidos').catch(() => {});
        }
    };

    let pedidosWriteColumnsReady = null;
    const ensurePedidosWriteColumns = () => {
        if (pedidosWriteColumnsReady) return pedidosWriteColumnsReady;

        const columns = [
            ['cliente_nome', 'VARCHAR(255) NULL'],
            ['numero_pedido', 'INT NULL'],
            ['condicao_pagamento', 'VARCHAR(255) NULL'],
            ['condicoes_pagamento', 'VARCHAR(255) NULL'],
            ['cenario_fiscal', 'VARCHAR(100) NULL'],
            ['transportadora_nome', 'VARCHAR(255) NULL'],
            ['tipo_frete', 'VARCHAR(20) NULL'],
            ['frete', 'DECIMAL(15,2) DEFAULT 0'],
            ['placa_veiculo', 'VARCHAR(20) NULL'],
            ['veiculo_uf', 'VARCHAR(2) NULL'],
            ['rntrc', 'VARCHAR(50) NULL'],
            ['qtd_volumes', 'DECIMAL(15,3) NULL'],
            ['especie_volumes', 'VARCHAR(100) NULL'],
            ['marca_volumes', 'VARCHAR(100) NULL'],
            ['numeracao_volumes', 'VARCHAR(100) NULL'],
            ['peso_liquido', 'DECIMAL(15,3) NULL'],
            ['peso_bruto', 'DECIMAL(15,3) NULL'],
            ['valor_seguro', 'DECIMAL(15,2) NULL'],
            ['outras_despesas', 'DECIMAL(15,2) NULL'],
            ['tipo_entrega', 'VARCHAR(50) NULL'],
            ['numero_lacre', 'VARCHAR(50) NULL'],
            ['codigo_rastreio', 'VARCHAR(100) NULL'],
            ['veiculo_proprio', 'TINYINT(1) DEFAULT 0'],
            ['redespacho', 'TINYINT(1) DEFAULT 0'],
            ['desconto_pct', 'DECIMAL(6,3) DEFAULT 0'],
            ['origem', 'VARCHAR(50) NULL'],
            ['observacao', 'TEXT NULL'],
            ['observacao_producao', 'TEXT NULL'],
            ['parcelas', 'TEXT NULL'],
            ['estado_destino', 'VARCHAR(2) NULL'],
            ['tipo_venda', 'VARCHAR(20) NULL'],
            ['etapa', 'VARCHAR(50) NULL'],
            ['version', 'INT NOT NULL DEFAULT 1']
        ];

        // Colunas em `clientes` usadas pelo bloqueio de inadimplência na criação do pedido.
        // Sem elas o SELECT falha com "Unknown column ... in 'field list'" (500).
        const clientesColumns = [
            ['ativo', 'TINYINT(1) NOT NULL DEFAULT 1'],
            ['bloqueado_inadimplencia', 'TINYINT(1) NOT NULL DEFAULT 0']
        ];

        pedidosWriteColumnsReady = (async () => {
            for (const [column, definition] of columns) {
                try {
                    const [existing] = await pool.query('SHOW COLUMNS FROM pedidos LIKE ?', [column]);
                    if (existing.length === 0) {
                        await pool.query(`ALTER TABLE pedidos ADD COLUMN \`${column}\` ${definition}`);
                    }
                } catch (err) {
                    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
                }
            }
            for (const [column, definition] of clientesColumns) {
                try {
                    const [existing] = await pool.query('SHOW COLUMNS FROM clientes LIKE ?', [column]);
                    if (existing.length === 0) {
                        await pool.query(`ALTER TABLE clientes ADD COLUMN \`${column}\` ${definition}`);
                    }
                } catch (err) {
                    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
                }
            }
            // Pedido pode ser criado sem empresa/cliente resolvidos (handler permite NULL).
            // Se a coluna for NOT NULL, o INSERT falha com "Column ... cannot be null".
            for (const column of ['empresa_id', 'cliente_id']) {
                try {
                    const [rows] = await pool.query('SHOW COLUMNS FROM pedidos LIKE ?', [column]);
                    if (rows.length && String(rows[0].Null).toUpperCase() === 'NO') {
                        const tipo = rows[0].Type || 'INT';
                        await pool.query(`ALTER TABLE pedidos MODIFY \`${column}\` ${tipo} NULL`);
                    }
                } catch (err) { /* nao bloquear criacao por ajuste de nullability */ }
            }
        })().catch((err) => {
            pedidosWriteColumnsReady = null;
            throw err;
        });

        return pedidosWriteColumnsReady;
    };

    router.post('/pedidos', authenticateToken, async (req, res, next) => {
        let connection;
        try {
            // PCP tem acesso de leitura/faturamento ao Kanban, mas NÃO pode criar pedidos.
            if (isPcpUser(req.user) || !(await podeCadastrarVendas(req.user, 'pedidos'))) {
                return res.status(403).json({ success: false, message: 'Seu perfil nao tem permissao para criar pedidos de venda.', code: 'SEM_PERMISSAO_PEDIDOS' });
            }
            await ensurePedidosWriteColumns();
            connection = await pool.getConnection();
            await connection.beginTransaction();

            const sanitize = (v) => (v === 'null' || v === 'undefined' || v === '' || v === undefined ? null : v);
            const sanitizeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

            const {
                empresa_id, cliente_id, cliente_nome, cliente,
                valor, descricao, observacao, observacoes, observacao_producao,
                status = 'orcamento',
                condicao_pagamento, condicoes_pagamento, cenario_fiscal,
                transportadora, transportadora_nome,
                tipo_frete, frete = 0,
                placa_veiculo, veiculo_uf, rntrc,
                qtd_volumes, especie_volumes, marca_volumes, numeracao_volumes,
                peso_liquido, peso_bruto, valor_seguro, outras_despesas,
                tipo_entrega, endereco_entrega, municipio_entrega, prazo_entrega,
                desconto_pct = 0, origem,
                vendedor_id: vendedorSelecionado,
                itens, produtos, parcelas
            } = req.body;

            // BUG-VEND-012: gravar o vendedor SELECIONADO no formulário quando informado.
            // Antes usava sempre req.user.id, então o pedido saía atribuído ao usuário logado
            // em vez do vendedor escolhido. Fallback no logado quando nada é informado.
            const vendedorFormId = sanitizeNum(vendedorSelecionado);
            const vendedor_id = (vendedorFormId && vendedorFormId > 0) ? vendedorFormId : req.user.id;
            const nomeCliente = sanitize(cliente_nome) || sanitize(cliente) || null;
            const obs = sanitize(observacao) || sanitize(observacoes) || sanitize(descricao) || null;

            // empresa_id: aceitar do body OU buscar pelo nome do cliente
            let empresaFinalId = sanitize(empresa_id) ? parseInt(empresa_id) : null;
            if (!empresaFinalId && nomeCliente) {
                const [existing] = await connection.query(
                    'SELECT id FROM empresas WHERE nome_fantasia = ? OR razao_social = ? LIMIT 1',
                    [nomeCliente, nomeCliente]
                );
                if (existing.length > 0) {
                    empresaFinalId = existing[0].id;
                }
                // Se empresa não encontrada, empresa_id fica NULL — NÃO usar fallback genérico
            }

            // Declarar clienteFinalId antes de qualquer referência (evita TDZ)
            let clienteFinalId = sanitize(cliente_id) ? parseInt(cliente_id) : null;
            let clienteFinalNome = sanitize(cliente_nome) || sanitize(cliente) || null;

            if (!empresaFinalId && !clienteFinalId && !nomeCliente) {
                await connection.rollback();
                return res.status(400).json({ message: 'Informe o cliente ou empresa.' });
            }

            // Validar tipo de frete obrigatório
            if (!sanitize(tipo_frete) && sanitize(tipo_frete) !== '0' && sanitize(tipo_frete) !== 0) {
                await connection.rollback();
                return res.status(400).json({ message: 'Selecione o Tipo de Frete (CIF, FOB, etc.).' });
            }

            // Validar cliente_id: se enviado, verificar se existe na tabela clientes
            if (clienteFinalId) {
                const [clienteRows] = await connection.query(
                    'SELECT id, COALESCE(nome_fantasia, razao_social, nome) as nome_resolved, ativo, bloqueado_inadimplencia FROM clientes WHERE id = ? LIMIT 1',
                    [clienteFinalId]
                );
                if (clienteRows.length === 0) {
                    clienteFinalId = null; // ID não existe em clientes, usar NULL
                } else {
                    if (!clienteFinalNome) {
                        clienteFinalNome = clienteRows[0].nome_resolved;
                    }
                    // Bloquear criação de pedido para clientes inadimplentes
                    if (clienteRows[0].bloqueado_inadimplencia === 1) {
                        await connection.rollback();
                        return res.status(403).json({
                            message: `Cliente bloqueado por inadimplência. Regularize as contas a receber vencidas no módulo Financeiro antes de emitir novos pedidos.`,
                            code: 'CLIENTE_INADIMPLENTE'
                        });
                    }
                }
            }

            // Calcular valor total dos itens (server-side)
            const itensArray = itens || produtos || [];
            let valorTotal = 0;
            if (Array.isArray(itensArray) && itensArray.length > 0) {
                for (const item of itensArray) {
                    const qty = parseFloat(item.quantidade) || 1;
                    const preco = parseFloat(item.preco_unitario || item.preco || 0);
                    const desc = parseFloat(item.desconto) || 0;
                    // BUG-VEND-011: rejeitar quantidade/preço inválidos (quantidade negativa gerava
                    // total negativo). Quantidade deve ser > 0 e preço não pode ser negativo.
                    if (!(qty > 0)) {
                        await connection.rollback();
                        return res.status(400).json({ message: 'Quantidade dos itens deve ser maior que zero.' });
                    }
                    if (preco < 0) {
                        await connection.rollback();
                        return res.status(400).json({ message: 'Preço dos itens não pode ser negativo.' });
                    }
                    valorTotal += (qty * preco) - desc;
                }
                const subtotalBruto = valorTotal;
                const descontoVal = valorTotal * ((sanitizeNum(desconto_pct) || 0) / 100);
                valorTotal = valorTotal - descontoVal + (sanitizeNum(frete) || 0);
                // BUG-CVF-005: pedido com itens não pode ter total <= 0 (desconto de 100% zerava
                // o valor e a venda era aceita). Desconto não pode anular a venda inteira.
                if (subtotalBruto > 0 && valorTotal <= 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        code: 'DESCONTO_INVALIDO',
                        message: 'O desconto não pode zerar ou tornar negativo o valor do pedido.'
                    });
                }
            } else {
                // Sem itens: aceitar valor do body como fallback (para compatibilidade)
                valorTotal = sanitizeNum(valor) || 0;
            }

            // Gerar numero_pedido sequencial — AUDIT-FIX BUG-02: FOR UPDATE lock para evitar duplicata
            const [[npRow]] = await connection.query('SELECT COALESCE(MAX(CAST(numero_pedido AS UNSIGNED)), 0) + 1 AS next_num FROM pedidos FOR UPDATE');
            const numeroPedido = npRow.next_num || 1;

            const [result] = await connection.query(`
                INSERT INTO pedidos (
                    empresa_id, cliente_id, cliente_nome, vendedor_id, valor, descricao, status,
                    numero_pedido, condicao_pagamento, cenario_fiscal,
                    transportadora_nome, tipo_frete, frete,
                    placa_veiculo, veiculo_uf, rntrc,
                    qtd_volumes, especie_volumes, marca_volumes, numeracao_volumes,
                    peso_liquido, peso_bruto, valor_seguro, outras_despesas,
                    desconto_pct, origem, observacao, parcelas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                empresaFinalId,
                clienteFinalId,
                clienteFinalNome,
                vendedor_id,
                valorTotal,
                obs,
                'orcamento',
                numeroPedido,
                sanitize(condicao_pagamento) || sanitize(condicoes_pagamento),
                sanitize(cenario_fiscal),
                sanitize(transportadora_nome) || sanitize(transportadora),
                sanitize(tipo_frete),
                sanitizeNum(frete) || 0,
                sanitize(placa_veiculo),
                sanitize(veiculo_uf),
                sanitize(rntrc),
                sanitizeNum(qtd_volumes),
                sanitize(especie_volumes),
                sanitize(marca_volumes),
                sanitize(numeracao_volumes),
                sanitizeNum(peso_liquido),
                sanitizeNum(peso_bruto),
                sanitizeNum(valor_seguro),
                sanitizeNum(outras_despesas),
                sanitizeNum(desconto_pct) || 0,
                sanitize(origem) || 'Sistema',
                obs,
                parcelas ? (typeof parcelas === 'string' ? parcelas : JSON.stringify(parcelas)) : null
            ]);

            const pedidoId = result.insertId;

            // Salvar itens
            if (Array.isArray(itensArray) && itensArray.length > 0) {
                for (const item of itensArray) {
                    const qty = parseFloat(item.quantidade) || 1;
                    const preco = parseFloat(item.preco_unitario || item.preco || 0);
                    const desc = parseFloat(item.desconto) || 0;
                    const subtotal = (qty * preco) - desc;
                    const itemCodigo = item.codigo || item['código'] || '';
                    const itemDescricao = item.descricao || item['descrição'] || item.nome || '';
                    await connection.query(
                        `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, unidade, local_estoque, preco_unitario, desconto, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [pedidoId, itemCodigo, itemDescricao, qty,
                         item.unidade || 'UN', item.local_estoque || 'PADRAO', preco, desc, subtotal]
                    );
                }
            }

            await connection.commit();

            // Invalidar cache do GET /pedidos para que o kanban veja o novo pedido imediatamente
            clearPedidosCache();

            // AUDIT-FIX (campos do modal): o INSERT base persiste apenas o núcleo do pedido.
            // O modal "Novo Orçamento/Pedido" envia ~20 campos adicionais (abas Informações
            // Adicionais, E-mail, NF-e, Transporte, etc.) que antes eram descartados na criação
            // e só persistiam num segundo salvar (PATCH). Aqui gravamos todos de uma vez.
            // Best-effort pós-commit: nunca derruba a criação caso uma coluna não exista.
            try {
                const b = req.body || {};
                const toBit = (v) => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0;
                const extraCols = [];
                const extraVals = [];
                const setIf = (cond, col, val) => { if (cond) { extraCols.push('`' + col + '` = ?'); extraVals.push(val); } };

                setIf(b.estado_destino !== undefined && sanitize(b.estado_destino), 'estado_destino', sanitize(b.estado_destino) ? String(b.estado_destino).toUpperCase().slice(0, 2) : null);
                setIf(b.tipo_venda !== undefined, 'tipo_venda', sanitize(b.tipo_venda));
                setIf(b.observacao_cliente !== undefined, 'observacao_cliente', sanitize(b.observacao_cliente));
                setIf(b.observacao_producao !== undefined, 'observacao_producao', sanitize(b.observacao_producao));
                setIf(b.info_complementar !== undefined, 'info_complementar', sanitize(b.info_complementar));
                setIf(b.email_cliente !== undefined, 'email_cliente', sanitize(b.email_cliente));
                setIf(b.transportadora_id !== undefined, 'transportadora_id', sanitizeNum(b.transportadora_id));
                setIf((b.transportadora_nome || b.transportadora) !== undefined, 'transportadora', sanitize(b.transportadora_nome) || sanitize(b.transportadora));
                setIf((b.previsao_faturamento || b.data_previsao || b.data_previsao_entrega) !== undefined, 'data_previsao', sanitize(b.data_previsao_entrega) || sanitize(b.data_previsao) || sanitize(b.previsao_faturamento) || null);
                setIf(b.redespacho !== undefined, 'redespacho', toBit(b.redespacho));
                setIf(b.placa_veiculo !== undefined, 'placa_veiculo', sanitize(b.placa_veiculo));
                setIf(b.veiculo_uf !== undefined, 'veiculo_uf', sanitize(b.veiculo_uf));
                setIf(b.rntrc !== undefined, 'rntrc', sanitize(b.rntrc));
                setIf(b.qtd_volumes !== undefined, 'qtd_volumes', sanitizeNum(b.qtd_volumes));
                setIf(b.especie_volumes !== undefined, 'especie_volumes', sanitize(b.especie_volumes));
                setIf(b.marca_volumes !== undefined, 'marca_volumes', sanitize(b.marca_volumes));
                setIf(b.numeracao_volumes !== undefined, 'numeracao_volumes', sanitize(b.numeracao_volumes));
                setIf(b.peso_liquido !== undefined, 'peso_liquido', sanitizeNum(b.peso_liquido));
                setIf(b.peso_bruto !== undefined, 'peso_bruto', sanitizeNum(b.peso_bruto));
                setIf(b.valor_seguro !== undefined, 'valor_seguro', sanitizeNum(b.valor_seguro));
                setIf(b.tipo_entrega !== undefined, 'tipo_entrega', sanitize(b.tipo_entrega));
                setIf(b.numero_lacre !== undefined, 'numero_lacre', sanitize(b.numero_lacre));
                setIf(b.outras_despesas !== undefined, 'outras_despesas', sanitizeNum(b.outras_despesas));
                setIf(b.codigo_rastreio !== undefined, 'codigo_rastreio', sanitize(b.codigo_rastreio));
                setIf(b.veiculo_proprio !== undefined, 'veiculo_proprio', toBit(b.veiculo_proprio));
                setIf(b.nf !== undefined, 'nf', sanitize(b.nf));
                setIf(b.categoria !== undefined, 'categoria', sanitize(b.categoria));
                setIf(b.conta_corrente !== undefined, 'conta_corrente', sanitize(b.conta_corrente));
                setIf(b.etapa !== undefined, 'etapa', sanitize(b.etapa));
                setIf(b.pedido_cliente !== undefined, 'pedido_cliente', sanitize(b.pedido_cliente));
                setIf(b.contrato_venda !== undefined, 'contrato_venda', sanitize(b.contrato_venda));
                setIf(b.contato !== undefined, 'contato', sanitize(b.contato));
                setIf(b.projeto !== undefined, 'projeto', sanitize(b.projeto));
                setIf(b.origem_pedido !== undefined, 'origem_pedido', sanitize(b.origem_pedido));
                setIf(b.departamento !== undefined, 'departamento', sanitize(b.departamento));
                setIf(b.cenario_fiscal_id !== undefined, 'cenario_fiscal_id', sanitizeNum(b.cenario_fiscal_id));
                setIf(b.nota_fiscal_consumo_final !== undefined, 'nota_fiscal_consumo_final', toBit(b.nota_fiscal_consumo_final));
                setIf(b.email_boleto !== undefined, 'email_boleto', toBit(b.email_boleto));
                setIf(b.email_pix !== undefined, 'email_pix', toBit(b.email_pix));
                setIf(b.dados_adicionais_nf !== undefined, 'dados_adicionais_nf', sanitize(b.dados_adicionais_nf));
                setIf(b.campos_obs_nfe !== undefined, 'campos_obs_nfe', sanitize(b.campos_obs_nfe));
                setIf(b.endereco_entrega_nfe !== undefined, 'endereco_entrega_nfe', sanitize(b.endereco_entrega_nfe));
                setIf(b.dados_agropecuaria !== undefined, 'dados_agropecuaria', sanitize(b.dados_agropecuaria));

                if (extraCols.length > 0) {
                    extraVals.push(pedidoId);
                    await pool.query('UPDATE pedidos SET ' + extraCols.join(', ') + ' WHERE id = ?', extraVals);
                }
            } catch (extraErr) {
                console.error('[POST /pedidos] Falha ao persistir campos adicionais do modal (nao-bloqueante) pedido #' + pedidoId + ':', extraErr.message);
            }

            // Notificação (não-bloqueante)
            try {
                const nomeVendedor = req.user.nome || 'Vendedor';
                const nomeEmpresa = nomeCliente || 'Cliente';
                const valorFormatado = valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const [admins] = await pool.query(
                    `SELECT id FROM usuarios WHERE (role = 'admin' OR is_admin = 1) AND id != ?`,
                    [vendedor_id]
                );
                const notifs = admins.map(a => [
                    a.id, `📋 Novo Pedido #${pedidoId}`,
                    `${nomeVendedor} criou pedido para ${nomeEmpresa} - ${valorFormatado}`,
                    'pedido', '/modules/Vendas/public/index.html',
                    JSON.stringify({ pedido_id: pedidoId })
                ]);
                notifs.push([
                    vendedor_id, `✅ Pedido #${pedidoId} criado`,
                    `Pedido para ${nomeEmpresa} (${valorFormatado}) registrado com sucesso`,
                    'pedido', '/modules/Vendas/public/index.html',
                    JSON.stringify({ pedido_id: pedidoId })
                ]);
                if (notifs.length > 0) {
                    await pool.query(
                        'INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, link, dados_extras) VALUES ?',
                        [notifs]
                    );
                }
            } catch (_) {}

            res.status(201).json({ message: 'Pedido criado com sucesso!', id: pedidoId, insertId: pedidoId });
        } catch (error) {
            if (connection) { try { await connection.rollback(); } catch (_) {} }
            next(error);
        } finally {
            if (connection) connection.release();
        }
    });
    // Statuses bloqueados para edição; só ti@aluforce.ind.br pode editar tudo.
    // Orçamento/aprovado/faturar seguem o controle RBAC normal (vendedor edita o próprio; admin edita qualquer um).
    const STATUS_ANALISE_CREDITO_BLOQUEADO = ['analise-credito', 'análise-crédito', 'analise', 'análise'];
    const STATUS_FINAL_BLOQUEADO_EDICAO = ['faturado', 'recibo', 'entregue'];
    const STATUS_BLOQUEADO_EDICAO = [...STATUS_ANALISE_CREDITO_BLOQUEADO, ...STATUS_FINAL_BLOQUEADO_EDICAO];
    const EMAIL_EDICAO_LIBERADO = 'ti@aluforce.ind.br';

    router.put('/pedidos/:id', pedidoOwnership, async (req, res, next) => {
        try {
            const { id } = req.params;

            // Lock: verificar status do pedido antes de permitir edição
            const [[pedidoLock]] = await pool.query('SELECT status FROM pedidos WHERE id = ?', [parseInt(id)]);
            if (pedidoLock && STATUS_BLOQUEADO_EDICAO.includes((pedidoLock.status || '').toLowerCase())) {
                const userEmail = (req.user && req.user.email || '').toLowerCase();
                if (userEmail !== EMAIL_EDICAO_LIBERADO) {
                    return res.status(403).json({ message: `Pedido com status "${pedidoLock.status}" não pode ser editado. Somente TI pode editar pedidos neste status.`, code: 'EDIT_LOCKED_BY_STATUS' });
                }
            }

            const sanitize = (v) => (v === 'null' || v === 'undefined' || v === '' || v === undefined ? null : v);
            const sanitizeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

            const {
                empresa_id, cliente_id, cliente_nome, cliente,
                valor, descricao, observacao, observacoes,
                status,
                condicao_pagamento, condicoes_pagamento, cenario_fiscal,
                transportadora, transportadora_nome,
                tipo_frete, frete,
                placa_veiculo, veiculo_uf, rntrc,
                qtd_volumes, especie_volumes, marca_volumes, numeracao_volumes,
                peso_liquido, peso_bruto, valor_seguro, outras_despesas,
                tipo_entrega, numero_lacre, codigo_rastreio, veiculo_proprio, data_previsao_entrega,
                desconto_pct, origem, parcelas
            } = req.body;

            const obs = sanitize(observacao) || sanitize(observacoes) || sanitize(descricao) || null;

            // Build dynamic SET clause — only update fields that were sent
            const sets = [];
            const params = [];

            if (empresa_id !== undefined && sanitize(empresa_id)) { sets.push('empresa_id = ?'); params.push(parseInt(empresa_id)); }
            if (cliente_id !== undefined) { sets.push('cliente_id = ?'); params.push(sanitize(cliente_id) ? parseInt(cliente_id) : null); }
            if (cliente_nome !== undefined || cliente !== undefined) {
                const nome = sanitize(cliente_nome) || sanitize(cliente);
                if (nome) { sets.push('cliente_nome = ?'); params.push(nome); }
            }
            if (valor !== undefined && sanitizeNum(valor) !== null) { sets.push('valor = ?'); params.push(sanitizeNum(valor)); }
            if (obs !== null) { sets.push('descricao = ?'); params.push(obs); sets.push('observacao = ?'); params.push(obs); }
            if (observacao_producao !== undefined) { sets.push('observacao_producao = ?'); params.push(sanitize(observacao_producao)); }
            // AUDIT-FIX BUG-03: Block status changes via PUT — must use PUT /pedidos/:id/status (state machine)
            if (status !== undefined && sanitize(status)) {
                return res.status(400).json({ message: 'Alteração de status não permitida via PUT. Use PUT /pedidos/:id/status para garantir validação de transição.' });
            }
            const condicaoPagamentoFinal = condicao_pagamento !== undefined ? condicao_pagamento : condicoes_pagamento;
            if (condicaoPagamentoFinal !== undefined) {
                const condicaoSanitizada = sanitize(condicaoPagamentoFinal);
                sets.push('condicao_pagamento = ?'); params.push(condicaoSanitizada);
                sets.push('condicoes_pagamento = ?'); params.push(condicaoSanitizada);
            }
            if (cenario_fiscal !== undefined) { sets.push('cenario_fiscal = ?'); params.push(sanitize(cenario_fiscal)); }
            if (transportadora_nome !== undefined || transportadora !== undefined) {
                sets.push('transportadora_nome = ?'); params.push(sanitize(transportadora_nome) || sanitize(transportadora));
            }
            if (tipo_frete !== undefined) { sets.push('tipo_frete = ?'); params.push(sanitize(tipo_frete)); }
            if (frete !== undefined) { sets.push('frete = ?'); params.push(sanitizeNum(frete) || 0); }
            if (placa_veiculo !== undefined) { sets.push('placa_veiculo = ?'); params.push(sanitize(placa_veiculo)); }
            if (veiculo_uf !== undefined) { sets.push('veiculo_uf = ?'); params.push(sanitize(veiculo_uf)); }
            if (rntrc !== undefined) { sets.push('rntrc = ?'); params.push(sanitize(rntrc)); }
            if (qtd_volumes !== undefined) { sets.push('qtd_volumes = ?'); params.push(sanitizeNum(qtd_volumes)); }
            if (especie_volumes !== undefined) { sets.push('especie_volumes = ?'); params.push(sanitize(especie_volumes)); }
            if (marca_volumes !== undefined) { sets.push('marca_volumes = ?'); params.push(sanitize(marca_volumes)); }
            if (numeracao_volumes !== undefined) { sets.push('numeracao_volumes = ?'); params.push(sanitize(numeracao_volumes)); }
            if (peso_liquido !== undefined) { sets.push('peso_liquido = ?'); params.push(sanitizeNum(peso_liquido)); }
            if (peso_bruto !== undefined) { sets.push('peso_bruto = ?'); params.push(sanitizeNum(peso_bruto)); }
            if (valor_seguro !== undefined) { sets.push('valor_seguro = ?'); params.push(sanitizeNum(valor_seguro)); }
            if (outras_despesas !== undefined) { sets.push('outras_despesas = ?'); params.push(sanitizeNum(outras_despesas)); }
            if (tipo_entrega !== undefined) { sets.push('tipo_entrega = ?'); params.push(sanitize(tipo_entrega)); }
            if (numero_lacre !== undefined) { sets.push('numero_lacre = ?'); params.push(sanitize(numero_lacre)); }
            if (codigo_rastreio !== undefined) { sets.push('codigo_rastreio = ?'); params.push(sanitize(codigo_rastreio)); }
            if (veiculo_proprio !== undefined) { sets.push('veiculo_proprio = ?'); params.push(veiculo_proprio === '1' || veiculo_proprio === 1 || veiculo_proprio === true ? 1 : 0); }
            if (data_previsao_entrega !== undefined) { sets.push('data_previsao = ?'); params.push(sanitize(data_previsao_entrega)); }
            if (desconto_pct !== undefined) { sets.push('desconto_pct = ?'); params.push(sanitizeNum(desconto_pct) || 0); }
            if (origem !== undefined) { sets.push('origem = ?'); params.push(sanitize(origem)); }
            if (parcelas !== undefined) { sets.push('parcelas = ?'); params.push(parcelas ? (typeof parcelas === 'string' ? parcelas : JSON.stringify(parcelas)) : null); }

            if (sets.length === 0) {
                return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
            }

            // AUDIT-FIX S4.6: Optimistic locking — increment version + check
            sets.push('version = version + 1');
            const expectedVersion = req.body.version ? parseInt(req.body.version) : null;

            if (expectedVersion) {
                params.push(parseInt(id), expectedVersion);
                const [result] = await pool.query(
                    `UPDATE pedidos SET ${sets.join(', ')} WHERE id = ? AND version = ?`,
                    params
                );
                if (result.affectedRows === 0) {
                    // Verificar se o pedido existe
                    const [[exists]] = await pool.query('SELECT id, version FROM pedidos WHERE id = ?', [parseInt(id)]);
                    if (!exists) return res.status(404).json({ message: 'Pedido não encontrado.' });
                    return res.status(409).json({
                        message: 'Pedido foi alterado por outro usuário. Recarregue e tente novamente.',
                        code: 'VERSION_CONFLICT',
                        current_version: exists.version
                    });
                }
            } else {
                // Sem version no request → update sem check (retrocompatibilidade)
                params.push(parseInt(id));
                const [result] = await pool.query(
                    `UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`,
                    params
                );
                if (result.affectedRows === 0) return res.status(404).json({ message: 'Pedido não encontrado.' });
            }
            clearPedidosCache();
            res.json({ message: 'Pedido atualizado com sucesso.' });
        } catch (error) { next(error); }
    });
    router.delete('/pedidos/:id', authenticateToken, authorizeAdmin, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { id } = req.params;

            // Verificar se pedido existe
            const [pedido] = await connection.query('SELECT id, status, nfe_chave FROM pedidos WHERE id = ?', [id]);
            if (pedido.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: "Pedido não encontrado." });
            }

            // Não permitir exclusão de pedidos faturados ou com NF-e
            if (pedido[0].status === 'faturado' || pedido[0].nfe_chave) {
                await connection.rollback();
                return res.status(400).json({
                    message: 'Pedido faturado ou com NF-e emitida não pode ser excluído.'
                });
            }

            // Contas a receber vinculadas: como é soft-delete, bloqueia APENAS se houver
            // recebimento (dinheiro que já entrou). Contas a receber em aberto são canceladas
            // junto com o pedido (mais abaixo, após o soft-delete).
            let temCancelarContasReceber = false;
            try {
                const [crs] = await connection.query(
                    'SELECT id, status FROM contas_receber WHERE pedido_id = ?', [id]
                );
                const recebidas = crs.filter(c =>
                    ['recebido', 'pago', 'liquidado', 'parcial'].includes(String(c.status || '').toLowerCase())
                );
                if (recebidas.length > 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Pedido possui ${recebidas.length} conta(s) a receber já recebida(s) e não pode ser excluído. Estorne o recebimento antes.`
                    });
                }
                temCancelarContasReceber = crs.length > 0;
            } catch (e) {
                // Tabela não existe ou não tem coluna pedido_id - ignorar verificação
                console.log('⚠️ Verificação contas_receber ignorada:', e.message);
            }

            // Verificar ordens de produção vinculadas (se a coluna pedido_id existir)
            try {
                const [ops] = await connection.query('SELECT COUNT(*) as count FROM ordens_producao WHERE pedido_id = ?', [id]);
                if (ops[0].count > 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Pedido possui ${ops[0].count} ordem(ns) de produção vinculada(s).`
                    });
                }
            } catch (e) {
                // Tabela não existe ou não tem coluna pedido_id - ignorar verificação
                console.log('⚠️ Verificação ordens_producao ignorada:', e.message);
            }

            // AUDIT-FIX S4.1: Soft-delete — preserva dados para auditoria fiscal
            const [result] = await connection.query(
                `UPDATE pedidos SET status = 'excluido', deleted_at = NOW() WHERE id = ?`,
                [id]
            );

            // Cancela as contas a receber em aberto vinculadas (não-recebidas), para não
            // deixar lançamento órfão no Financeiro após a exclusão do pedido.
            if (temCancelarContasReceber) {
                try {
                    await connection.query(
                        `UPDATE contas_receber SET status = 'cancelado'
                         WHERE pedido_id = ?
                           AND (status IS NULL OR LOWER(status) NOT IN ('recebido','pago','liquidado','parcial'))`,
                        [id]
                    );
                } catch (e) {
                    console.log('⚠️ Cancelamento de contas_receber vinculadas falhou:', e.message);
                }
            }

            // Registrar no histórico
            try {
                await connection.query(
                    `INSERT INTO pedido_historico (pedido_id, acao, usuario_id, detalhes, created_at)
                     VALUES (?, 'exclusao_logica', ?, 'Pedido marcado como excluído (soft-delete)', NOW())`,
                    [id, req.user?.id || null]
                );
            } catch (histErr) {
                // Tabela pode não existir — não bloquear a operação
                console.log('⚠️ Histórico de exclusão não registrado:', histErr.message);
            }

            await connection.commit();

            clearPedidosCache();

            console.log(`🗑️ Pedido #${id} soft-deleted por usuário ${req.user?.id}`);
            res.json({ message: 'Pedido excluído com sucesso.', soft_deleted: true });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });

    // POST /pedidos/:id/duplicar - Duplicar pedido existente
    router.post('/pedidos/:id/duplicar', pedidoOwnership, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            await connection.beginTransaction();

            // Buscar pedido original
            const [[pedidoOriginal]] = await connection.query('SELECT * FROM pedidos WHERE id = ?', [id]);
            if (!pedidoOriginal) {
                await connection.rollback();
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }

            // Criar novo pedido (cópia) - usando nomes corretos das colunas
            const [result] = await connection.query(`
                INSERT INTO pedidos (
                    cliente_id, cliente, valor, status, vendedor_id,
                    observacoes, data_prevista, empresa_id, frete, desconto, cenario_fiscal,
                    condicao_pagamento, parcelas, created_at
                ) VALUES (?, ?, ?, 'orcamento', ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?, ?, ?, ?, ?, NOW())
            `, [
                pedidoOriginal.cliente_id,
                pedidoOriginal.cliente,
                pedidoOriginal.valor,
                pedidoOriginal.vendedor_id,
                `[CÓPIA DO PEDIDO #${id}] ${pedidoOriginal.observacoes || ''}`,
                req.user.empresa_id,
                pedidoOriginal.frete || 0,
                pedidoOriginal.desconto || 0,
                pedidoOriginal.cenario_fiscal || 'Venda Normal',
                pedidoOriginal.condicao_pagamento || 'A Vista',
                pedidoOriginal.parcelas || 1
            ]);

            const novoPedidoId = result.insertId;

            // Copiar itens do pedido usando colunas corretas (batch INSERT)
            const [itens] = await connection.query('SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ?', [id]);
            if (itens.length > 0) {
                const values = itens.map(item => [
                    novoPedidoId,
                    item.codigo || item.produto_codigo || '',
                    item.descricao || item.produto_nome || '',
                    item.quantidade || 1,
                    item.unidade || 'UN',
                    item.preco_unitario || item.valor_unitario || 0,
                    item.subtotal || item.valor_total || 0,
                    item.desconto || 0
                ]);
                const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                await connection.query(`
                    INSERT INTO pedido_itens (
                        pedido_id, codigo, descricao, quantidade, unidade,
                        preco_unitario, subtotal, desconto
                    ) VALUES ${placeholders}
                `, values.flat());
            }

            await connection.commit();

            console.log(`📋 Pedido #${id} duplicado como #${novoPedidoId} por usuário ${req.user?.id}`);
            clearPedidosCache();
            res.status(201).json({
                success: true,
                message: 'Pedido duplicado com sucesso',
                id: novoPedidoId,
                original_id: id
            });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao duplicar pedido:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // PATCH /pedidos/:id - Atualização parcial do pedido (para o Kanban)
    // Sprint E2E-S1 (RC-HIGH-01 fix): Wrapped in transaction for atomicity
    router.patch('/pedidos/:id', async (req, res, next) => {
        const patchConn = await pool.getConnection();
        try {
            await patchConn.beginTransaction();
            const { id } = req.params;
            let updates = req.body;

            // Sanitizar valores: converter 'null' string para null real e tratar números inválidos
            const sanitizeValue = (val) => {
                if (val === 'null' || val === 'undefined' || val === '') return null;
                return val;
            };

            const sanitizeNumber = (val) => {
                if (val === 'null' || val === 'undefined' || val === '' || val === null) return null;
                const num = parseFloat(val);
                return isNaN(num) ? null : num;
            };

            // Aplicar sanitização em todos os campos
            Object.keys(updates).forEach(key => {
                updates[key] = sanitizeValue(updates[key]);
            });

            // Verificar se pedido existe — Sprint E2E-S1: usa patchConn (transação)
            const [existingRows] = await patchConn.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [id]);
            if (existingRows.length === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }

            const existing = existingRows[0];
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');

            // Lock: pedidos em análise de crédito bloqueiam alterações comerciais;
            // pedidos finais/fiscais bloqueiam alterações gerais. Somente TI tem acesso total.
            const statusAtualPatch = (existing.status || '').toLowerCase().trim();
            const userEmail = (user.email || '').toLowerCase();
            if (STATUS_ANALISE_CREDITO_BLOQUEADO.includes(statusAtualPatch) && userEmail !== EMAIL_EDICAO_LIBERADO) {
                const CAMPOS_LIBERADOS_ANALISE_CREDITO = ['transportadora_nome', 'transportadora', 'transportadora_id', 'metodo_envio', 'tipo_frete', 'conta_corrente'];
                Object.keys(updates).forEach(k => {
                    if (!CAMPOS_LIBERADOS_ANALISE_CREDITO.includes(k)) delete updates[k];
                });
                if (Object.keys(updates).length === 0) {
                    await patchConn.rollback();
                    return res.status(403).json({ message: `Pedido em Análise de Crédito só permite ajustar Transportadora e Conta Corrente.`, code: 'EDIT_LOCKED_BY_STATUS' });
                }
            } else if (STATUS_FINAL_BLOQUEADO_EDICAO.includes(statusAtualPatch) && userEmail !== EMAIL_EDICAO_LIBERADO) {
                const CAMPOS_LIBERADOS_FATURADO = ['categoria', 'projeto', 'vendedor_id', 'vendedor_nome', 'conta_corrente', 'condicao_pagamento', 'condicoes_pagamento', 'parcelas'];
                Object.keys(updates).forEach(k => {
                    if (!CAMPOS_LIBERADOS_FATURADO.includes(k)) delete updates[k];
                });
                if (Object.keys(updates).length === 0) {
                    await patchConn.rollback();
                    return res.status(403).json({ message: `Pedido com status "${existing.status}" só permite ajustar Categoria, Projeto, Vendedor, Conta Corrente e Condição de Pagamento.`, code: 'EDIT_LOCKED_BY_STATUS' });
                }
            }

            // Verificar permissão
            if (!isAdmin && existing.vendedor_id && Number(existing.vendedor_id) !== Number(user.id)) {
                return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem editar este pedido.' });
            }

            // Sprint 1 (K-05 fix): Bloquear alteração de status via PATCH
            // Toda mudança de status DEVE usar PUT /pedidos/:id/status (com máquina de estados + FOR UPDATE)
            if (updates.status !== undefined) {
                console.log(`🚫 PATCH bloqueado: tentativa de alterar status do pedido #${id} via PATCH. Use PUT /pedidos/${id}/status.`);
                return res.status(400).json({
                    message: 'Alteração de status não é permitida via PATCH. Use o endpoint PUT /pedidos/:id/status.',
                    endpoint_correto: `PUT /api/vendas/pedidos/${id}/status`
                });
            }

            // AUDIT-FIX: Block financial field changes on faturado/finalizado pedidos
            const statusAtual = (existing.status || '').toLowerCase().trim();
            const isFaturado = ['faturado', 'finalizado', 'entregue', 'recibo'].includes(statusAtual);
            const financialFields = ['valor', 'frete', 'desconto', 'valor_seguro', 'outras_despesas'];
            // Sprint E2E-S1 (E4-HIGH-07 fix): Block address/transport fields after faturamento too
            const deliveryFields = ['endereco_entrega', 'municipio_entrega', 'tipo_frete', 'transportadora_nome', 'transportadora', 'transportadora_id', 'metodo_envio', 'tipo_entrega'];

            if (isFaturado && !isAdmin) {
                const blockedFields = [...financialFields, ...deliveryFields].filter(f => updates[f] !== undefined);
                if (blockedFields.length > 0) {
                    console.log(`🚫 PATCH bloqueado: pedido #${id} status=${statusAtual}, campos protegidos: ${blockedFields.join(', ')}`);
                    return res.status(403).json({
                        message: `Pedido com status "${statusAtual}" não permite alteração de campos financeiros/entrega (${blockedFields.join(', ')}). Contate um administrador.`
                    });
                }
            }

            // Sprint 2 (P-03): Bloquear edição de campos críticos quando há OP ativa vinculada
            const camposCriticos = ['valor', 'frete', 'desconto', 'cliente_id', 'cliente_nome'];
            const camposCriticosAlterados = camposCriticos.filter(f => updates[f] !== undefined);
            if (camposCriticosAlterados.length > 0) {
                let opAtiva = [];
                try {
                    [opAtiva] = await patchConn.query(
                        'SELECT id, codigo FROM ordens_producao WHERE pedido_vinculado_id = ? AND status NOT IN ("concluida", "cancelada") LIMIT 1',
                        [id]
                    );
                } catch (_opErr) {
                    // pedido_vinculado_id column may not exist in this deployment — skip OP check
                    opAtiva = [];
                }
                if (opAtiva.length > 0 && !isAdmin) {
                    console.log(`🚫 PATCH bloqueado: pedido #${id} tem OP ativa ${opAtiva[0].codigo}, campos: ${camposCriticosAlterados.join(', ')}`);
                    return res.status(403).json({
                        message: `Pedido com ordem de produção ativa (${opAtiva[0].codigo}) não permite alteração de ${camposCriticosAlterados.join(', ')}. Cancele a OP primeiro ou contate um administrador.`,
                        op_ativa: opAtiva[0]
                    });
                }
            }

            // Construir query de atualização dinâmica
            const fieldsToUpdate = [];
            const values = [];

            // Atualizar vendedor somente quando houver seleção válida.
            // Admin abrir/salvar sem escolher vendedor não pode sobrescrever o dono do pedido.
            if (updates.vendedor_id !== undefined || updates.vendedor_nome !== undefined) {
                const vendedorIdNum = sanitizeNumber(updates.vendedor_id);
                const vendedorNomeLimpo = updates.vendedor_nome ? String(updates.vendedor_nome).trim() : '';
                let vendedorRows = [];

                if (vendedorIdNum) {
                    [vendedorRows] = await patchConn.query(
                        'SELECT id, nome FROM usuarios WHERE id = ? LIMIT 1',
                        [vendedorIdNum]
                    );
                } else if (vendedorNomeLimpo) {
                    [vendedorRows] = await patchConn.query(
                        'SELECT id, nome FROM usuarios WHERE nome = ? OR apelido = ? LIMIT 1',
                        [vendedorNomeLimpo, vendedorNomeLimpo]
                    );
                }

                if (vendedorRows.length > 0) {
                    if (!isAdmin && Number(vendedorRows[0].id) !== Number(user.id)) {
                        await patchConn.rollback();
                        return res.status(403).json({ message: 'Acesso negado: vendedor não pode reatribuir o pedido.' });
                    }
                    fieldsToUpdate.push('vendedor_id = ?');
                    values.push(vendedorRows[0].id);
                    fieldsToUpdate.push('vendedor_nome = ?');
                    values.push(vendedorRows[0].nome);
                    console.log(`✅ Vendedor atualizado: ID ${vendedorRows[0].id} (${vendedorRows[0].nome})`);
                } else if (updates.vendedor_id !== undefined || vendedorNomeLimpo) {
                    console.warn(`[VENDAS] Vendedor informado não encontrado; mantendo vendedor atual do pedido #${id}.`);
                }
            }

            // Observação existe na tabela
            if (updates.observacao !== undefined) {
                fieldsToUpdate.push('observacao = ?');
                values.push(updates.observacao);
            }
            if (updates.observacao_producao !== undefined) {
                fieldsToUpdate.push('observacao_producao = ?');
                values.push(updates.observacao_producao);
            }

            // Status NÃO aceito via PATCH (Sprint 1 K-05) — bloqueado acima

            // Valor existe na tabela (campo numérico)
            if (updates.valor !== undefined) {
                fieldsToUpdate.push('valor = ?');
                values.push(sanitizeNumber(updates.valor));
            }

            // Frete existe na tabela (campo numérico)
            if (updates.frete !== undefined) {
                fieldsToUpdate.push('frete = ?');
                values.push(sanitizeNumber(updates.frete));
            }

            // Descrição existe na tabela
            if (updates.descricao !== undefined) {
                fieldsToUpdate.push('descricao = ?');
                values.push(updates.descricao);
            }

            // Prioridade existe na tabela
            if (updates.prioridade !== undefined) {
                fieldsToUpdate.push('prioridade = ?');
                values.push(updates.prioridade);
            }

            // Cliente_id existe na tabela (campo numérico) - só atualiza se valor válido
            if (updates.cliente_id !== undefined && updates.cliente_id !== null && updates.cliente_id !== '') {
                fieldsToUpdate.push('cliente_id = ?');
                values.push(sanitizeNumber(updates.cliente_id));
            }

            // Empresa_id existe na tabela (campo numérico) - só atualiza se valor válido
            if (updates.empresa_id !== undefined && updates.empresa_id !== null && updates.empresa_id !== '') {
                fieldsToUpdate.push('empresa_id = ?');
                values.push(sanitizeNumber(updates.empresa_id));
            }

            // Cliente nome
            if (updates.cliente !== undefined) {
                fieldsToUpdate.push('cliente_nome = ?');
                values.push(updates.cliente);
            }

            // Transportadora - salvar em ambos os campos
            if (updates.transportadora !== undefined || updates.transportadora_nome !== undefined) {
                const transportadoraValor = updates.transportadora || updates.transportadora_nome;
                fieldsToUpdate.push('transportadora_nome = ?');
                values.push(transportadoraValor);
                fieldsToUpdate.push('transportadora = ?');
                values.push(transportadoraValor);
            }

            // Transportadora ID
            if (updates.transportadora_id !== undefined && updates.transportadora_id !== null) {
                fieldsToUpdate.push('transportadora_id = ?');
                values.push(sanitizeNumber(updates.transportadora_id));
            }

            // NF - salvar em nf
            if (updates.nf !== undefined) {
                fieldsToUpdate.push('nf = ?');
                values.push(updates.nf);
            }

            // Parcelas/Condição de Pagamento - salvar em múltiplos campos
            if (updates.parcelas !== undefined || updates.condicao_pagamento !== undefined || updates.condicoes_pagamento !== undefined) {
                const condicaoValor = updates.condicao_pagamento || updates.condicoes_pagamento || updates.parcelas;
                fieldsToUpdate.push('condicao_pagamento = ?');
                values.push(condicaoValor);
                fieldsToUpdate.push('condicoes_pagamento = ?');
                values.push(condicaoValor);
                fieldsToUpdate.push('parcelas = ?');
                values.push(condicaoValor);
            }

            // ========== CAMPOS DE TRANSPORTE ==========
            if (updates.tipo_frete !== undefined) {
                fieldsToUpdate.push('tipo_frete = ?');
                values.push(updates.tipo_frete);
            }
            if (updates.metodo_envio !== undefined) {
                fieldsToUpdate.push('metodo_envio = ?');
                values.push(updates.metodo_envio);
            }
            if (updates.redespacho !== undefined) {
                fieldsToUpdate.push('redespacho = ?');
                values.push(updates.redespacho === '1' || updates.redespacho === true || updates.redespacho === 'true' ? 1 : 0);
            }
            if (updates.placa_veiculo !== undefined) {
                fieldsToUpdate.push('placa_veiculo = ?');
                values.push(updates.placa_veiculo);
            }
            if (updates.veiculo_uf !== undefined) {
                fieldsToUpdate.push('veiculo_uf = ?');
                values.push(updates.veiculo_uf);
            }
            if (updates.rntrc !== undefined) {
                fieldsToUpdate.push('rntrc = ?');
                values.push(updates.rntrc);
            }
            if (updates.veiculo_proprio !== undefined) {
                fieldsToUpdate.push('veiculo_proprio = ?');
                values.push(updates.veiculo_proprio === '1' || updates.veiculo_proprio === true || updates.veiculo_proprio === 'true' ? 1 : 0);
            }

            // ========== CAMPOS DE VOLUMES/PESO ==========
            if (updates.qtd_volumes !== undefined) {
                fieldsToUpdate.push('qtd_volumes = ?');
                values.push(sanitizeNumber(updates.qtd_volumes));
            }
            if (updates.especie_volumes !== undefined) {
                fieldsToUpdate.push('especie_volumes = ?');
                values.push(updates.especie_volumes);
            }
            if (updates.marca_volumes !== undefined) {
                fieldsToUpdate.push('marca_volumes = ?');
                values.push(updates.marca_volumes);
            }
            if (updates.numeracao_volumes !== undefined) {
                fieldsToUpdate.push('numeracao_volumes = ?');
                values.push(updates.numeracao_volumes);
            }
            if (updates.peso_liquido !== undefined) {
                fieldsToUpdate.push('peso_liquido = ?');
                values.push(sanitizeNumber(updates.peso_liquido));
            }
            if (updates.peso_bruto !== undefined) {
                fieldsToUpdate.push('peso_bruto = ?');
                values.push(sanitizeNumber(updates.peso_bruto));
            }

            // ========== CAMPOS DE VALORES ADICIONAIS ==========
            if (updates.valor_seguro !== undefined) {
                fieldsToUpdate.push('valor_seguro = ?');
                values.push(sanitizeNumber(updates.valor_seguro));
            }
            if (updates.outras_despesas !== undefined) {
                fieldsToUpdate.push('outras_despesas = ?');
                values.push(sanitizeNumber(updates.outras_despesas));
            }
            if (updates.desconto !== undefined) {
                fieldsToUpdate.push('desconto = ?');
                values.push(sanitizeNumber(updates.desconto));
            }
            if (updates.desconto_pct !== undefined) {
                fieldsToUpdate.push('desconto_pct = ?');
                values.push(sanitizeNumber(updates.desconto_pct));
            }
            if (updates.numero_lacre !== undefined) {
                fieldsToUpdate.push('numero_lacre = ?');
                values.push(updates.numero_lacre);
            }
            if (updates.codigo_rastreio !== undefined) {
                fieldsToUpdate.push('codigo_rastreio = ?');
                values.push(updates.codigo_rastreio);
            }

            // ========== CAMPOS DE ENTREGA ==========
            if (updates.endereco_entrega !== undefined) {
                fieldsToUpdate.push('endereco_entrega = ?');
                values.push(updates.endereco_entrega);
            }
            if (updates.municipio_entrega !== undefined) {
                fieldsToUpdate.push('municipio_entrega = ?');
                values.push(updates.municipio_entrega);
            }
            // prazo_entrega é INT (número de dias), só salvar se for número
            if (updates.prazo_entrega !== undefined && !isNaN(parseInt(updates.prazo_entrega))) {
                fieldsToUpdate.push('prazo_entrega = ?');
                values.push(parseInt(updates.prazo_entrega));
            }
            if (updates.tipo_entrega !== undefined) {
                fieldsToUpdate.push('tipo_entrega = ?');
                values.push(updates.tipo_entrega);
            }
            // data_previsao aceita datas
            if (updates.data_previsao !== undefined || updates.previsao_faturamento !== undefined || updates.data_previsao_entrega !== undefined) {
                fieldsToUpdate.push('data_previsao = ?');
                values.push(updates.data_previsao_entrega || updates.data_previsao || updates.previsao_faturamento || null);
            }

            // ========== CAMPOS DE OBSERVAÇÕES E INFORMAÇÕES ==========
            if (updates.observacao_cliente !== undefined) {
                fieldsToUpdate.push('observacao_cliente = ?');
                values.push(updates.observacao_cliente);
            }
            if (updates.info_complementar !== undefined) {
                fieldsToUpdate.push('info_complementar = ?');
                values.push(updates.info_complementar);
            }
            if (updates.campos_obs_nfe !== undefined) {
                fieldsToUpdate.push('campos_obs_nfe = ?');
                values.push(updates.campos_obs_nfe);
            }
            if (updates.dados_adicionais_nf !== undefined) {
                fieldsToUpdate.push('dados_adicionais_nf = ?');
                values.push(updates.dados_adicionais_nf);
            }

            // ========== ESTADO DESTINO / UF ==========
            if (updates.estado_destino !== undefined && updates.estado_destino !== null && updates.estado_destino !== '') {
                fieldsToUpdate.push('estado_destino = ?');
                values.push(String(updates.estado_destino).toUpperCase().slice(0, 2));
            }

            // ========== CAMPOS DE ORIGEM E EMAIL ==========
            if (updates.origem !== undefined) {
                fieldsToUpdate.push('origem = ?');
                values.push(updates.origem);
            }
            if (updates.origem_pedido !== undefined) {
                fieldsToUpdate.push('origem_pedido = ?');
                values.push(updates.origem_pedido);
            }
            if (updates.nota_fiscal_consumo_final !== undefined) {
                fieldsToUpdate.push('nota_fiscal_consumo_final = ?');
                values.push(updates.nota_fiscal_consumo_final === '1' || updates.nota_fiscal_consumo_final === 1 || updates.nota_fiscal_consumo_final === true ? 1 : 0);
            }
            if (updates.email_boleto !== undefined) {
                fieldsToUpdate.push('email_boleto = ?');
                values.push(updates.email_boleto === '1' || updates.email_boleto === 1 || updates.email_boleto === true ? 1 : 0);
            }
            if (updates.email_pix !== undefined) {
                fieldsToUpdate.push('email_pix = ?');
                values.push(updates.email_pix === '1' || updates.email_pix === 1 || updates.email_pix === true ? 1 : 0);
            }
            if (updates.endereco_entrega_nfe !== undefined) {
                fieldsToUpdate.push('endereco_entrega_nfe = ?');
                values.push(updates.endereco_entrega_nfe);
            }
            if (updates.dados_agropecuaria !== undefined) {
                fieldsToUpdate.push('dados_agropecuaria = ?');
                values.push(updates.dados_agropecuaria);
            }
            if (updates.email_cliente !== undefined) {
                fieldsToUpdate.push('email_cliente = ?');
                values.push(updates.email_cliente);
            }
            if (updates.email_assunto !== undefined) {
                fieldsToUpdate.push('email_assunto = ?');
                values.push(updates.email_assunto);
            }
            if (updates.email_mensagem !== undefined) {
                fieldsToUpdate.push('email_mensagem = ?');
                values.push(updates.email_mensagem);
            }

            // ========== CAMPOS ADICIONAIS ==========
            if (updates.projeto !== undefined) {
                fieldsToUpdate.push('projeto = ?');
                values.push(updates.projeto);
            }
            if (updates.contato !== undefined) {
                fieldsToUpdate.push('contato = ?');
                values.push(updates.contato);
            }
            if (updates.categoria !== undefined) {
                fieldsToUpdate.push('categoria = ?');
                values.push(updates.categoria);
            }
            if (updates.conta_corrente !== undefined) {
                fieldsToUpdate.push('conta_corrente = ?');
                values.push(updates.conta_corrente);
            }
            if (updates.pedido_cliente !== undefined) {
                fieldsToUpdate.push('pedido_cliente = ?');
                values.push(updates.pedido_cliente);
            }
            if (updates.contrato_venda !== undefined) {
                fieldsToUpdate.push('contrato_venda = ?');
                values.push(updates.contrato_venda);
            }
            if (updates.cenario_fiscal !== undefined) {
                fieldsToUpdate.push('cenario_fiscal = ?');
                values.push(updates.cenario_fiscal);
            }
            if (updates.departamento !== undefined) {
                fieldsToUpdate.push('departamento = ?');
                values.push(updates.departamento);
            }
            // AUDIT-FIX: Tipo de Venda (Consumidor Final / Revenda) e Etapa do modal
            if (updates.tipo_venda !== undefined) {
                fieldsToUpdate.push('tipo_venda = ?');
                values.push(updates.tipo_venda);
            }
            if (updates.etapa !== undefined) {
                fieldsToUpdate.push('etapa = ?');
                values.push(updates.etapa);
            }

            // Se não há campos para atualizar
            if (fieldsToUpdate.length === 0) {
                console.log(`⚠️ Nenhum campo válido para atualizar`);
                return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
            }

            values.push(id);

            const query = `UPDATE pedidos SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;

            const [result] = await patchConn.query(query, values);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }

            console.log(`✅ Pedido ${id} atualizado com sucesso! (${result.affectedRows} linha(s) afetada(s))`);

            // Sprint 4.3: Recalcular valor server-side a partir de pedido_itens
            // Sempre que campos financeiros mudam (frete, desconto, valor direto), recalcula se itens existem
            const camposFinanceirosAlterados = ['frete', 'desconto', 'valor', 'valor_seguro', 'outras_despesas'].some(f => updates[f] !== undefined);
            if (camposFinanceirosAlterados) {
                try {
                    const [itensAgg] = await patchConn.query(
                        `SELECT COUNT(*) as count,
                                COALESCE(SUM(subtotal), 0) as total_subtotais,
                                COALESCE(SUM(valor_ipi), 0) as total_ipi,
                                COALESCE(SUM(valor_icms_st), 0) as total_icms_st
                         FROM pedido_itens WHERE pedido_id = ?`, [id]
                    );
                    if (itensAgg[0].count > 0) {
                        const [pedAtual] = await patchConn.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [id]);
                        const novoValor = parseFloat(itensAgg[0].total_subtotais) + parseFloat(itensAgg[0].total_ipi) + parseFloat(itensAgg[0].total_icms_st) + parseFloat(pedAtual[0]?.frete || 0);
                        await patchConn.query('UPDATE pedidos SET valor = ?, total_ipi = ?, total_icms_st = ? WHERE id = ?',
                            [novoValor, itensAgg[0].total_ipi, itensAgg[0].total_icms_st, id]);
                        console.log(`🔄 [Sprint 4.3] Valor recalculado pedido #${id}: R$${novoValor.toFixed(2)} (${itensAgg[0].count} itens, subtotais: ${itensAgg[0].total_subtotais}, IPI: ${itensAgg[0].total_ipi}, ICMS-ST: ${itensAgg[0].total_icms_st}, frete: ${pedAtual[0]?.frete || 0})`);
                    }
                } catch (recalcErr) {
                    console.error(`[Sprint 4.3] Erro ao recalcular valor pedido #${id} (não-bloqueante):`, recalcErr.message);
                }
            }

            // Registrar histórico da alteração via PATCH
            try {
                const camposAlterados = Object.keys(updates).filter(k => updates[k] !== undefined).join(', ');

                // Sprint E2E-S2 (E1-HIGH-02): Auditoria delta — registrar valor anterior vs novo
                let deltaInfo = {};
                const camposAuditaveis = ['valor', 'frete', 'desconto', 'valor_seguro', 'outras_despesas', 'condicao_pagamento'];
                camposAuditaveis.forEach(campo => {
                    if (updates[campo] !== undefined && existing[campo] !== undefined) {
                        deltaInfo[campo] = { anterior: existing[campo], novo: updates[campo] };
                    }
                });

                await patchConn.query(
                    'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, user.id || null, user.nome || user.email || 'Sistema', 'edicao',
                     `Atualização via PATCH: ${camposAlterados}`,
                     JSON.stringify({ campos: Object.keys(updates), status_anterior: statusAtual, status_novo: updates.status || statusAtual, delta: deltaInfo })]
                ).catch(() => {
                    // Fallback para colunas alternativas
                    return patchConn.query(
                        'INSERT INTO pedido_historico (pedido_id, descricao, acao, meta) VALUES (?, ?, ?, ?)',
                        [id, `${user.nome || 'Sistema'}: Atualização PATCH - ${camposAlterados}`, 'edicao',
                         JSON.stringify({ campos: Object.keys(updates), delta: deltaInfo })]
                    );
                });
            } catch (histErr) {
                console.error(`[HISTORICO] Erro ao registrar histórico PATCH pedido #${id}:`, histErr.message);
            }

            // Sprint 1 (K-05): Estorno de estoque removido do PATCH — cancelamento agora DEVE usar PUT /pedidos/:id/status

            // Buscar pedido atualizado para retornar
            const [updatedRows] = await patchConn.query(`
                SELECT p.*,
                       c.nome as cliente_nome,
                       u.nome as vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.id = ?
            `, [id]);

            await patchConn.commit();
            clearPedidosCache();
            res.json({
                message: 'Pedido atualizado com sucesso.',
                pedido: updatedRows[0] || null
            });
        } catch (error) {
            await patchConn.rollback().catch(() => {});
            console.error('❌ Erro ao atualizar pedido (PATCH):', error);
            next(error);
        } finally {
            patchConn.release();
        }
    });

    // ========================================
    // FUNÇÃO: BAIXA AUTOMÁTICA DE ESTOQUE
    // Copiada de pcp-routes.js para uso local em vendas-routes.js
    // ========================================
    async function baixarEstoqueAutomatico(connection, pedidoId, itens, usuarioId = null) {
        console.log(`[ESTOQUE_AUTO] Iniciando baixa automática para pedido ${pedidoId}`);
        const movimentacoes = [];

        for (const item of itens) {
            const codigoMaterial = item.codigo || item.codigo_material || item.sku;
            const quantidade = parseFloat(item.quantidade || 0);
            const unidade = item.unidade || 'm';

            if (!codigoMaterial || quantidade <= 0) continue;

            try {
                // Buscar produto no estoque — AUDIT-FIX BUG-01: Remover LIKE wildcard para evitar match errado
                const [produtos] = await connection.query(`
                    SELECT id, codigo, descricao, estoque_atual, unidade_medida
                    FROM produtos
                    WHERE codigo = ? OR sku = ?
                    LIMIT 1
                `, [codigoMaterial, codigoMaterial]);

                if (produtos.length === 0) {
                    console.log(`[ESTOQUE_AUTO] Produto não encontrado: ${codigoMaterial}`);
                    continue;
                }

                const produto = produtos[0];
                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                // AUDIT-FIX BUG-05: Log warning when stock goes negative instead of silently clamping
                const novoEstoque = estoqueAnterior - quantidade;
                if (novoEstoque < 0) {
                    console.warn(`[ESTOQUE_AUTO] ⚠️ ALERTA: Produto ${produto.codigo} ficará com estoque negativo (${estoqueAnterior} - ${quantidade} = ${novoEstoque}). Pedido #${pedidoId}`);
                }

                // Atualizar estoque do produto
                await connection.query(`
                    UPDATE produtos
                    SET estoque_atual = ?
                    WHERE id = ?
                `, [novoEstoque, produto.id]);

                // Registrar movimentação
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                    VALUES (?, 'saida', 'venda', ?, ?, ?, 'pedido', ?, ?, ?, NOW())
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

    // ============================================================
    // SISTEMA DE PERMISSÕES DE STATUS POR ROLE/CARGO (Sprint 1 - K-01 fix)
    // Usa role do JWT (admin/comercial/user) ao invés de primeiro nome
    // ============================================================
    const userPermissions = {
        // Mapa de permissões por role do banco (usuarios.role)
        statusPermissions: {
            // Vendedores (role=user/comercial) podem mover até análise de crédito e cancelar antes de aprovação final
            'default': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'cancelado'],
            'user': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'cancelado'],
            'comercial': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'cancelado'],
            // Supervisores podem aprovar, mas não faturar diretamente
            'supervisor': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'cancelado'],
            // Aprovadores podem encaminhar para faturamento, mas não marcar como faturado diretamente
            'aprovador': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'cancelado'],
            // PCP (produção) não cria pedidos, mas fatura: move de Aprovado em diante.
            'pcp': ['aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'faturado', 'entregue', 'recibo'],
            'producao': ['aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'faturado', 'entregue', 'recibo'],
            // Admin tem acesso total (redundante pois admin bypassa, mas documenta)
            'admin': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'faturado', 'entregue', 'recibo', 'cancelado']
        },
        canMoveToStatus(userRole, status) {
            const role = (userRole || 'default').toLowerCase();
            const perms = this.statusPermissions[role] || this.statusPermissions['default'];
            return perms.includes(status);
        }
    };

    // Mapa de transições válidas de status de pedido
    const VALID_STATUS_TRANSITIONS = {
        'orcamento': ['analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'cancelado'],
        'orçamento': ['analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'cancelado'],
        'analise': ['analise-credito', 'aprovado', 'orcamento', 'cancelado'],
        'analise-credito': ['aprovado', 'pedido-aprovado', 'orcamento', 'cancelado'],
        'aprovado': ['pedido-aprovado', 'aguardando-faturamento', 'faturar', 'analise-credito', 'cancelado'],
        'pedido-aprovado': ['aguardando-faturamento', 'faturar', 'faturado', 'cancelado'],
        // NOVO 25/06/2026: etapa "Aguardando Faturamento" entre Aprovado e Faturar.
        // O modal de espelho/faturamento abre ao arrastar aguardando-faturamento -> faturar.
        'aguardando-faturamento': ['faturar', 'aprovado', 'cancelado'],
        'faturar': ['faturado', 'aguardando-faturamento', 'cancelado'],
        'parcial': ['faturado', 'entregue', 'cancelado'], // Faturamento parcial pode completar ou cancelar
        'faturado': ['entregue', 'recibo'], // Não pode ser cancelado diretamente (precisa cancelar NF-e)
        'entregue': ['recibo'],
        'recibo': [],
        'cancelado': [] // Estado final
    };

    // Persiste o rascunho da "Conta a Receber" (parcelas editadas no modal) na coluna JSON
    // pedidos.parcelas_conta_receber. NÃO cria contas_receber real — isso só ocorre no faturamento,
    // que verifica a existência de contas_receber e seria corrompido por um registro antecipado.
    router.put('/pedidos/:id/parcelas-conta-receber', pedidoOwnership, async (req, res, next) => {
        try {
            const { id } = req.params;
            const { numero, dados, parcelas } = req.body || {};

            const [[ped]] = await pool.query('SELECT parcelas_conta_receber FROM pedidos WHERE id = ?', [id]);
            if (!ped) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            let mapa = {};
            if (ped.parcelas_conta_receber) {
                try { mapa = (typeof ped.parcelas_conta_receber === 'object') ? ped.parcelas_conta_receber : JSON.parse(ped.parcelas_conta_receber); } catch (_) { mapa = {}; }
            }
            if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) mapa = {};

            if (parcelas && typeof parcelas === 'object') {
                mapa = parcelas; // substituição completa do conjunto de parcelas
            } else if (numero !== undefined && numero !== null) {
                mapa[String(numero)] = dados || {};
            } else {
                return res.status(400).json({ success: false, message: 'Informe "numero"+"dados" ou "parcelas".' });
            }

            await pool.query('UPDATE pedidos SET parcelas_conta_receber = ? WHERE id = ?', [JSON.stringify(mapa), id]);
            res.json({ success: true, parcelas_conta_receber: mapa });
        } catch (error) {
            console.error('[API/VENDAS/PARCELAS-CR] Erro:', error);
            next(error);
        }
    });

    router.put('/pedidos/:id/status', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { status, forceTransition, baixar_estoque = true } = req.body;

            console.log(`📝 Atualizando status do pedido ${id} para: ${status}`);

            const validStatuses = ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'faturado', 'entregue', 'cancelado', 'recibo'];
            if (!status || !validStatuses.includes(status)) {
                console.log(`❌ Status inválido: ${status}`);
                return res.status(400).json({ message: 'Status inválido.' });
            }

            // Sprint 1 (K-03/RC-01 fix): SELECT ... FOR UPDATE para atomicidade
            await connection.beginTransaction();
            const [pedidoAtual] = await connection.query('SELECT id, status, vendedor_id, cliente_id, cliente_nome, valor, condicao_pagamento, parcelas FROM pedidos WHERE id = ? FOR UPDATE', [id]);
            if (pedidoAtual.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }

            const statusAtual = pedidoAtual[0].status || 'orcamento';

            // Verificar se é admin (usando serviço centralizado - consulta is_admin/role do banco)
            const user = req.user || {};
            const isAdmin = faturamentoShared.isAdmin(user);

            // Validar transição de status (admin pode forçar)
            const transicoesValidas = VALID_STATUS_TRANSITIONS[statusAtual] || [];
            // Sprint E2E-S2 (E2-CRIT-03): forceTransition só permitido para admin
            const canForce = forceTransition && isAdmin;
            if (!transicoesValidas.includes(status) && !canForce) {
                if (!isAdmin) {
                    console.log(`❌ Transição inválida: ${statusAtual} -> ${status}`);
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Transição de status inválida: "${statusAtual}" → "${status}". Transições válidas: ${transicoesValidas.join(', ') || 'nenhuma'}`
                    });
                }
                // Admin sem forceTransition: bloquear também
                console.log(`❌ Admin ${user.nome || user.email} tentou transição inválida sem forceTransition: ${statusAtual} -> ${status}`);
                await connection.rollback();
                // Privacy by design: não expor o mecanismo interno de bypass na mensagem ao cliente.
                return res.status(400).json({
                    message: `Não é possível alterar o status de "${statusAtual}" para "${status}".`
                });
            }
            if (canForce && !transicoesValidas.includes(status)) {
                console.log(`⚠️ [AUDIT] Admin ${user.nome || user.email} (id=${user.id}) FORÇOU transição: ${statusAtual} -> ${status} (forceTransition=true)`);
            }

            console.log(`🔐 Verificação de permissão - Usuário: ${user.nome || user.email} | Admin: ${isAdmin} | Status desejado: ${status}`);

// ===== VERIFICAÇÃO GRANULAR DE PERMISSÕES (Sprint 1 - K-01 fix: usa role, não nome) =====
            if (!isAdmin) {
                const isComprasUser = String(user.email || '').toLowerCase().indexOf('compras@') === 0;
                const _isPcp = isPcpUser(user);
                const userRole = _isPcp ? 'pcp' : (isComprasUser ? 'aprovador' : (user.role || 'user'));

                // Verificar se o role do usuário pode mover para este status específico
                if (!userPermissions.canMoveToStatus(userRole, status)) {
                    console.log(`[PERMISSOES] Usuário ${user.nome || user.email} (role=${userRole}) não tem permissão para mover para status: ${status}`);
                    await connection.rollback();
                    return res.status(403).json({
                        message: `Você não tem permissão para mover pedidos para o status "${status}".`,
                        status_negado: status,
                        role: userRole
                    });
                }
                console.log(`[PERMISSOES] Usuário ${user.nome || user.email} (role=${userRole}) autorizado para mover para: ${status}`);
            }


            // Vendedores (não-admin) só podem mover até "analise"
            if (!isAdmin) {
                // Usar pedidoAtual já consultado acima
                const pedido = pedidoAtual[0];
                const _isCompras = String(user.email || '').toLowerCase().indexOf('compras@') === 0;
                // PCP fatura pedidos de qualquer vendedor — não tem "pedidos próprios".
                const _isPcpMover = isPcpUser(user);
                if (!_isCompras && !_isPcpMover && pedido.vendedor_id && user.id && Number(pedido.vendedor_id) !== Number(user.id)) {
                    // Fallback: o mesmo vendedor pode existir com IDs diferentes entre instâncias
                    // (ex.: cadastro @aluforce e @labor com o mesmo nome). Permite mover se o vendedor
                    // do pedido tem o MESMO NOME do usuário logado.
                    let mesmoVendedorPorNome = false;
                    try {
                        const [[vendDono]] = await connection.query('SELECT nome FROM usuarios WHERE id = ?', [pedido.vendedor_id]);
                        const nomeDono = (vendDono && vendDono.nome ? String(vendDono.nome) : '').trim().toLowerCase();
                        const nomeUser = String(user.nome || '').trim().toLowerCase();
                        if (nomeDono && nomeUser && nomeDono === nomeUser) mesmoVendedorPorNome = true;
                    } catch (_e) { /* mantém bloqueio se a consulta falhar */ }
                    if (!mesmoVendedorPorNome) {
                        console.log(`❌ Usuário ${user.id} não é dono do pedido ${id} (vendedor_id=${pedido.vendedor_id})`);
                        await connection.rollback();
                        return res.status(403).json({ message: 'Você só pode mover seus próprios pedidos.' });
                    }
                    console.log(`✅ Usuário ${user.id} autorizado por NOME a mover pedido ${id} (vendedor_id=${pedido.vendedor_id}, mesmo nome)`);
                }

                // Sprint E2E-S2 (E2-HIGH-03): Vendedor/comercial não pode cancelar pedido já aprovado+
                const userRole = (user.role || 'user').toLowerCase();
                if (status === 'cancelado' && ['user', 'comercial', 'default'].includes(userRole)) {
                    const statusAvancados = ['aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'entregue', 'recibo'];
                    if (statusAvancados.includes(statusAtual)) {
                        console.log(`🚫 [PERMISSOES] Vendedor ${user.nome || user.email} tentou cancelar pedido #${id} em status "${statusAtual}" — bloqueado`);
                        await connection.rollback();
                        return res.status(403).json({
                            message: `Vendedores não podem cancelar pedidos com status "${statusAtual}". Solicite o cancelamento a um supervisor ou admin.`
                        });
                    }
                }

                // Permissão já verificada pelo sistema userPermissions acima
            }

            // ========================================
            // A3-NC-011: bloquear avanço de pedido sem valor/sem itens
            // Bloquear avanço para etapas faturáveis (aprovado/faturar) quando o
            // pedido não tem valor ou não tem itens. Orçamento vazio continua OK.
            // Não contornável por forceTransition (NF-e com R$0 é inválida).
            // ========================================
            if (['aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'faturado'].includes(status)) {
                const [itensVal] = await connection.query(
                    `SELECT COUNT(*) AS qtd, COALESCE(SUM(subtotal), 0) AS total_itens FROM pedido_itens WHERE pedido_id = ?`,
                    [id]
                );
                const qtdItens = Number(itensVal[0]?.qtd || 0);
                const somaItens = parseFloat(itensVal[0]?.total_itens || 0);
                const valorPedidoCab = parseFloat(pedidoAtual[0]?.valor || 0);
                const valorEfetivo = somaItens > 0 ? somaItens : valorPedidoCab;
                if (qtdItens === 0 || valorEfetivo <= 0) {
                    console.log(`🚫 [A3] Bloqueado avanço do pedido #${id} para "${status}": itens=${qtdItens}, valor=${valorEfetivo}`);
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        success: false,
                        message: 'Não é possível aprovar/faturar um pedido sem valor ou sem itens.'
                    });
                }
            }

            // ========================================
            // AUDIT-FIX 2026-04-03: VALIDAÇÃO DE LIMITE DE CRÉDITO
            // Quando pedido vai para 'aprovado' ou 'pedido-aprovado', verificar se
            // o cliente possui limite de crédito suficiente.
            // Admin pode forçar com forceTransition=true.
            // ========================================
            if (['aprovado', 'pedido-aprovado'].includes(status) && !canForce) {
                try {
                    const pedidoData = pedidoAtual[0];
                    const valorPedido = parseFloat(pedidoData.valor || 0);

                    if (pedidoData.cliente_id && valorPedido > 0) {
                        const [clienteData] = await connection.query(
                            'SELECT limite_credito FROM clientes WHERE id = ? LIMIT 1',
                            [pedidoData.cliente_id]
                        );
                        const limiteCredito = parseFloat(clienteData[0]?.limite_credito || 0);

                        // Só valida se o cliente possui limite configurado (> 0)
                        if (limiteCredito > 0) {
                            // Somar pedidos pendentes do mesmo cliente (excluir cancelados e o pedido atual)
                            const [creditUsed] = await connection.query(
                                `SELECT COALESCE(SUM(valor), 0) as total_pendente
                                 FROM pedidos
                                 WHERE cliente_id = ? AND id != ?
                                   AND status IN ('aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'parcial')`,
                                [pedidoData.cliente_id, id]
                            );
                            const totalExposicao = parseFloat(creditUsed[0].total_pendente) + valorPedido;

                            if (totalExposicao > limiteCredito) {
                                console.log(`[CREDITO] ❌ Limite excedido para cliente #${pedidoData.cliente_id}: limite=R$${limiteCredito.toFixed(2)}, exposição=R$${totalExposicao.toFixed(2)}`);
                                await connection.rollback();
                                return res.status(400).json({
                                    message: `Limite de crédito excedido. Limite: R$${limiteCredito.toFixed(2)}, Exposição total: R$${totalExposicao.toFixed(2)} (pendente: R$${parseFloat(creditUsed[0].total_pendente).toFixed(2)} + este pedido: R$${valorPedido.toFixed(2)}). Solicite aprovação a um administrador.`,
                                    code: 'CREDIT_LIMIT_EXCEEDED',
                                    limite: limiteCredito,
                                    exposicao: totalExposicao
                                });
                            }
                            console.log(`[CREDITO] ✅ Cliente #${pedidoData.cliente_id} dentro do limite: R$${totalExposicao.toFixed(2)} / R$${limiteCredito.toFixed(2)}`);
                        }
                    }
                } catch (creditErr) {
                    console.warn('[CREDITO] Erro ao validar limite (não-bloqueante):', creditErr.message);
                    // Não bloqueia operação se a validação falhar por erro técnico
                }
            }

            // Atualiza status e registra histórico (usando updated_at se existir)
            const [result] = await connection.query('UPDATE pedidos SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);

            // ========================================
            // Sprint 3 (Gap-1 fix): FILA AUTOMÁTICA VENDAS → PCP
            // Quando pedido chega em "pedido-aprovado", gerar OP automaticamente
            // com vínculo real (pedido_id) para eliminar gap manual
            // ========================================
            let opAutoCriada = null;
            if (status === 'pedido-aprovado' && statusAtual !== 'pedido-aprovado') {
                try {
                    // Verificar se já existe OP para este pedido
                    const [opExistente] = await connection.query(
                        'SELECT id, codigo FROM ordens_producao WHERE pedido_vinculado_id = ? AND status NOT IN ("cancelada") LIMIT 1', [id]
                    );
                    if (opExistente.length === 0) {
                        // BUG-10 FIX: Buscar TODOS os itens do pedido (não só o primeiro)
                        const [itensOP] = await connection.query(
                            'SELECT codigo, descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]
                        );
                        // Gerar código sequencial da OP (com FOR UPDATE para evitar race condition)
                        const [ultimaOrdem] = await connection.query(`
                            SELECT codigo FROM ordens_producao
                            WHERE codigo LIKE 'OP N° %'
                            ORDER BY id DESC LIMIT 1
                            FOR UPDATE
                        `);
                        let proximoNumero = 1;
                        if (ultimaOrdem.length > 0 && ultimaOrdem[0].codigo) {
                            const matchNum = ultimaOrdem[0].codigo.match(/(\d+)$/);
                            if (matchNum) proximoNumero = parseInt(matchNum[1]) + 1;
                        }
                        const ano = new Date().getFullYear();
                        const codigoOP = `OP N° ${ano}/${String(proximoNumero).padStart(5, '0')}`;

                        const pedidoData = pedidoAtual[0];

                        // Buscar dados completos do cliente para a OP
                        let clienteNomeOP = pedidoData.cliente_nome || '';
                        let clienteCnpjOP = '';
                        let clienteContatoOP = '';
                        let clienteTelefoneOP = '';
                        let clienteEmailOP = '';
                        let clienteEnderecoOP = '';
                        let clienteCepOP = '';
                        let vendedorOP = '';
                        let condicaoPagamentoOP = pedidoData.condicao_pagamento || '';
                        let valorTotalOP = parseFloat(pedidoData.valor) || 0;

                        if (pedidoData.cliente_id) {
                            try {
                                const [clienteRows] = await connection.query(
                                    'SELECT nome, razao_social, nome_fantasia, cnpj_cpf, contato, telefone, email, endereco, numero, bairro, cidade, estado, cep FROM clientes WHERE id = ?',
                                    [pedidoData.cliente_id]
                                );
                                if (clienteRows.length > 0) {
                                    const cl = clienteRows[0];
                                    clienteNomeOP = cl.razao_social || cl.nome_fantasia || cl.nome || clienteNomeOP;
                                    clienteCnpjOP = cl.cnpj_cpf || '';
                                    clienteContatoOP = cl.contato || '';
                                    clienteTelefoneOP = cl.telefone || '';
                                    clienteEmailOP = cl.email || '';
                                    clienteEnderecoOP = [cl.endereco, cl.numero, cl.bairro, cl.cidade ? cl.cidade + '/' + (cl.estado || '') : ''].filter(Boolean).join(', ');
                                    clienteCepOP = cl.cep || '';
                                }
                            } catch (clErr) { console.warn('[PIPELINE_AUTO] Erro ao buscar cliente:', clErr.message); }
                        }

                        // Buscar nome do vendedor
                        if (pedidoData.vendedor_id) {
                            try {
                                const [vendRows] = await connection.query('SELECT nome FROM usuarios WHERE id = ?', [pedidoData.vendedor_id]);
                                if (vendRows.length > 0) vendedorOP = vendRows[0].nome;
                            } catch (_) {}
                        }

                        let descProduto, qtdOP, undOP, obsItens;
                        if (itensOP.length > 1) {
                            // Múltiplos itens: listar todos na descrição e observações
                            descProduto = itensOP.map(i => `${i.descricao}${i.codigo ? ' (' + i.codigo + ')' : ''}`).join(', ');
                            if (descProduto.length > 250) descProduto = descProduto.substring(0, 247) + '...';
                            qtdOP = itensOP.reduce((sum, i) => sum + (parseFloat(i.quantidade) || 0), 0);
                            undOP = itensOP[0].unidade || 'UN';
                            obsItens = `Auto-gerada a partir do Pedido #${id} | ${itensOP.length} itens: ` +
                                itensOP.map(i => `${i.descricao} x${i.quantidade} ${i.unidade || 'UN'}`).join('; ');
                        } else if (itensOP.length === 1) {
                            descProduto = `${itensOP[0].descricao}${itensOP[0].codigo ? ' - ' + itensOP[0].codigo : ''}`;
                            qtdOP = itensOP[0].quantidade;
                            undOP = itensOP[0].unidade || 'UN';
                            obsItens = `Auto-gerada a partir do Pedido #${id}`;
                        } else {
                            descProduto = `Pedido #${id} - ${pedidoData.cliente_nome || 'Cliente'}`;
                            qtdOP = 1;
                            undOP = 'UN';
                            obsItens = `Auto-gerada a partir do Pedido #${id}`;
                        }

                        const [opResult] = await connection.query(`
                            INSERT INTO ordens_producao (
                                codigo, produto_nome, quantidade, unidade,
                                status, prioridade, data_prevista, responsavel, observacoes,
                                progresso, quantidade_produzida, pedido_vinculado_id,
                                cliente_nome, cliente_cnpj, cliente_contato, cliente_telefone,
                                cliente_email, cliente_endereco, cliente_cep,
                                vendedor, condicoes_pagamento, valor_total, numero_pedido,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, ?, 'ativa', 'media', NULL, NULL, ?, 0, 0, ?,
                                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                        `, [codigoOP, descProduto, qtdOP, undOP, obsItens, id,
                            clienteNomeOP, clienteCnpjOP, clienteContatoOP, clienteTelefoneOP,
                            clienteEmailOP, clienteEnderecoOP, clienteCepOP,
                            vendedorOP, condicaoPagamentoOP, valorTotalOP, String(id)]);

                        opAutoCriada = { id: opResult.insertId, codigo: codigoOP };
                        console.log(`[PIPELINE_AUTO] OP ${codigoOP} criada automaticamente para Pedido #${id}`);
                    } else {
                        console.log(`[PIPELINE_AUTO] OP já existe para Pedido #${id}: ${opExistente[0].codigo}`);
                    }
                } catch (opError) {
                    console.error(`[PIPELINE_AUTO] Erro ao criar OP para pedido #${id}:`, opError.message);
                    // Não falha a operação principal
                }
            }

            // ========================================
            // BAIXA AUTOMÁTICA DE ESTOQUE
            // Quando pedido vai para "faturar" ou "faturado", baixar estoque automaticamente
            // ========================================
            let movimentacoesEstoque = [];
            // FIX: Estoque só baixa em 'faturar' ou 'faturado', NÃO em 'aprovado'
            // Baixar estoque na aprovação causava estoque fantasma quando pedidos eram cancelados
            if (baixar_estoque && ['faturar', 'faturado'].includes(status) &&
                !['faturar', 'faturado'].includes(statusAtual)) {
                try {
                    // AUDIT-FIX: Verificar se já existem movimentações de saída para evitar duplicação
                    const [movExistentes] = await connection.query(
                        "SELECT COUNT(*) as count FROM estoque_movimentacoes WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'",
                        [id]
                    );
                    if (movExistentes[0]?.count > 0) {
                        console.log(`[ESTOQUE_AUTO] Estoque já baixado anteriormente para pedido #${id} — pulando`);
                    } else {
                    // Buscar itens do pedido
                    const [itens] = await connection.query(`
                        SELECT codigo, descricao, quantidade, unidade, preco_unitario
                        FROM pedido_itens
                        WHERE pedido_id = ?
                    `, [id]);

                    if (itens.length > 0) {
                        console.log(`[ESTOQUE_AUTO] Baixando estoque para pedido #${id} (${itens.length} itens)`);
                        movimentacoesEstoque = await baixarEstoqueAutomatico(connection, id, itens, user?.id);
                    }
                    } // fecha else (movExistentes check)
                } catch (estoqueError) {
                    console.error('[ESTOQUE_AUTO] Erro (não crítico):', estoqueError.message);
                    // Não falha a operação principal se a baixa de estoque falhar
                }
            }

            // ========================================
            // Sprint 1 (F-01 fix): GERAÇÃO DE CONTAS A RECEBER NO FATURAMENTO NORMAL
            // Quando pedido muda para 'faturar' ou 'faturado' pelo fluxo normal (Kanban),
            // gerar título financeiro automaticamente via serviço centralizado
            // ========================================
            let contaReceberGerada = null;
            if (['faturar', 'faturado'].includes(status) && !['faturar', 'faturado', 'parcial'].includes(statusAtual)) {
                try {
                    const pedidoData = pedidoAtual[0];
                    const valorPedido = parseFloat(pedidoData.valor || 0);

                    // Sprint E2E-S1 (E5-CRIT-06 fix): Preferir SUM(itens) sobre pedido.valor livre
                    let valorFaturamento = valorPedido;
                    const [itensSum] = await connection.query(
                        `SELECT COUNT(*) as count, COALESCE(SUM(subtotal), 0) as total_itens FROM pedido_itens WHERE pedido_id = ?`, [id]
                    );
                    if (itensSum[0].count > 0 && parseFloat(itensSum[0].total_itens) > 0) {
                        valorFaturamento = parseFloat(itensSum[0].total_itens);
                        if (Math.abs(valorFaturamento - valorPedido) > 0.01) {
                            console.log(`[FINANCEIRO_AUTO] ALERTA: pedido #${id} valor (R$${valorPedido}) difere de SUM(itens) (R$${valorFaturamento}). Usando SUM(itens).`);
                        }
                    }

                    if (valorFaturamento > 0) {
                        // Verificar se já existe conta a receber para este pedido (evita duplicação)
                        const [existingCR] = await connection.query(
                            'SELECT id FROM contas_receber WHERE pedido_id = ? LIMIT 1', [id]
                        );
                        if (existingCR.length === 0) {
                            contaReceberGerada = await faturamentoShared.gerarContaReceber(connection, {
                                pedido_id: parseInt(id),
                                cliente_id: pedidoData.cliente_id || null,
                                descricao: `Faturamento Pedido #${id} - ${pedidoData.cliente_nome || 'Cliente'}`,
                                valor: valorFaturamento,
                                tipo: 'faturamento',
                                pedido: pedidoData
                            });
                            console.log(`[FINANCEIRO_AUTO] Conta a receber #${contaReceberGerada.insertId} gerada para pedido #${id} (R$${valorFaturamento}, venc. ${contaReceberGerada.data_vencimento_dias} dias)`);
                        } else {
                            console.log(`[FINANCEIRO_AUTO] Conta a receber já existe para pedido #${id} (id=${existingCR[0].id}), pulando`);
                        }
                    }
                } catch (financeiroError) {
                    console.error(`[FINANCEIRO_AUTO] Erro ao gerar conta a receber pedido #${id}:`, financeiroError.message);
                    // Não falha a operação principal
                }
            }

            // ========================================
            // ESTORNO DE ESTOQUE AO CANCELAR
            // Quando pedido é cancelado a partir de status que já tiveram baixa de estoque,
            // devolver os produtos ao estoque automaticamente.
            // Regra: só retorna estoque se cancelar a partir de "analise-credito" ou "pedido-aprovado"
            // ========================================
            let estornoEstoque = [];
            // FIX: Agora só estorna de status que realmente tiveram baixa de estoque (faturar)
            if (status === 'cancelado' && ['faturar', 'faturado', 'parcial'].includes(statusAtual)) {
                try {
                    console.log(`[ESTORNO_ESTOQUE] Cancelamento do pedido #${id} a partir de "${statusAtual}" - verificando itens para estorno...`);

                    // Buscar movimentações de saída deste pedido
                    const [movimentacoes] = await connection.query(`
                        SELECT id, codigo_material, quantidade, quantidade_anterior, quantidade_atual
                        FROM estoque_movimentacoes
                        WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'
                        ORDER BY id ASC
                    `, [id]);

                    if (movimentacoes.length > 0) {
                        for (const mov of movimentacoes) {
                            const [produtos] = await connection.query(
                                'SELECT id, codigo, descricao, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ? LIMIT 1',
                                [mov.codigo_material]
                            );

                            if (produtos.length > 0) {
                                const produto = produtos[0];
                                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                                const qtdEstorno = parseFloat(mov.quantidade);
                                const novoEstoque = estoqueAnterior + qtdEstorno;

                                // FIX: Restaurar para estoque_atual (disponível), não apenas estoque_cancelado
                                await connection.query('UPDATE produtos SET estoque_atual = ?, estoque_cancelado = COALESCE(estoque_cancelado, 0) + ? WHERE id = ?', [novoEstoque, qtdEstorno, produto.id]);

                                // Sync tabela estoque unificada se existir
                                try {
                                    await connection.query('UPDATE estoque SET quantidade_disponivel = quantidade_disponivel + ? WHERE produto_id = ?', [qtdEstorno, produto.id]);
                                } catch (syncErr) { /* tabela pode nao existir */ }

                                await connection.query(`
                                    INSERT INTO estoque_movimentacoes
                                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                    VALUES (?, 'entrada', 'estorno', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                `, [
                                    mov.codigo_material, qtdEstorno, estoqueAnterior, novoEstoque,
                                    id, user.id || null,
                                    `Estorno automatico - Cancelamento Pedido #${id} - ${qtdEstorno} devolvido ao estoque disponivel`
                                ]);

                                estornoEstoque.push({
                                    produto: produto.codigo,
                                    descricao: produto.descricao,
                                    quantidade_devolvida: qtdEstorno,
                                    estoque_anterior: estoqueAnterior,
                                    estoque_atual: novoEstoque,
                                    tipo: 'estorno_disponivel'
                                });

                                console.log(`[ESTORNO_ESTOQUE] ${produto.codigo} - ${qtdEstorno} devolvido ao estoque_atual (${estoqueAnterior} -> ${novoEstoque})`);
                            }
                        }
                        console.log(`[ESTORNO_ESTOQUE] ${estornoEstoque.length} produto(s) movidos para estoque_cancelado no pedido #${id}`);
                    } else {
                        // Sem movimentações registradas - tentar estorno direto pelos itens do pedido
                        const [itensEstorno] = await connection.query('SELECT codigo, descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                        if (itensEstorno.length > 0) {
                            for (const item of itensEstorno) {
                                const codigoMaterial = item.codigo;
                                if (!codigoMaterial) continue;

                                const [produtos] = await connection.query(
                                    'SELECT id, codigo, descricao, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ? OR sku = ? LIMIT 1',
                                    [codigoMaterial, codigoMaterial]
                                );

                                if (produtos.length > 0) {
                                    const produto = produtos[0];
                                    const quantidade = parseFloat(item.quantidade || 0);
                                    if (quantidade <= 0) continue;

                                    const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                                    const novoEstoque = estoqueAnterior + quantidade;

                                    // FIX: Restaurar para estoque_atual (disponível)
                                    await connection.query('UPDATE produtos SET estoque_atual = ?, estoque_cancelado = COALESCE(estoque_cancelado, 0) + ? WHERE id = ?', [novoEstoque, quantidade, produto.id]);

                                    // Sync tabela estoque unificada se existir
                                    try {
                                        await connection.query('UPDATE estoque SET quantidade_disponivel = quantidade_disponivel + ? WHERE produto_id = ?', [quantidade, produto.id]);
                                    } catch (syncErr) { /* tabela pode nao existir */ }

                                    await connection.query(`
                                        INSERT INTO estoque_movimentacoes
                                        (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                         documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                        VALUES (?, 'entrada', 'estorno', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                    `, [
                                        produto.codigo, quantidade, estoqueAnterior, novoEstoque,
                                        id, user.id || null,
                                        `Estorno automatico - Cancelamento Pedido #${id} - ${quantidade}${item.unidade || 'UN'} devolvido ao estoque`
                                    ]);

                                    estornoEstoque.push({
                                        produto: produto.codigo,
                                        descricao: produto.descricao,
                                        quantidade_devolvida: quantidade,
                                        estoque_anterior: estoqueAnterior,
                                        estoque_atual: novoEstoque,
                                        tipo: 'estorno_disponivel'
                                    });

                                    console.log(`[ESTORNO_ESTOQUE] ${produto.codigo} - ${quantidade} devolvido ao estoque_atual (fallback)`);
                                }
                            }
                        }
                        console.log(`[ESTORNO_ESTOQUE] Estorno por itens para estoque_cancelado: ${estornoEstoque.length} produto(s)`);
                    }
                } catch (estornoErr) {
                    console.error(`[ESTORNO_ESTOQUE] Erro ao estornar estoque do pedido #${id}:`, estornoErr.message);
                    // Não falha a operação principal
                }
            }

            await connection.commit();

            clearPedidosCache();
            console.log(`✅ Status do pedido ${id} atualizado: ${statusAtual} → ${status} por ${user.nome || user.email} (Admin: ${isAdmin})`);
            res.json({
                message: 'Status atualizado com sucesso.',
                success: true,
                transicao: { de: statusAtual, para: status },
                estoque_baixado: movimentacoesEstoque.length > 0,
                movimentacoes_estoque: movimentacoesEstoque,
                conta_receber_gerada: contaReceberGerada ? { id: contaReceberGerada.insertId, vencimento_dias: contaReceberGerada.data_vencimento_dias } : null,
                op_auto_criada: opAutoCriada || null,
                estoque_estornado: estornoEstoque.length > 0,
                estorno_estoque: estornoEstoque
            });
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao atualizar status:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // GET /pedidos/:id/comunicacao-sefaz - Timeline de comunicação com a SEFAZ
    // (emissão/envio/autorização/cancelamento da NF-e + eventos registrados).
    // Sintetiza eventos a partir da NF-e/pedido quando não há log granular, de modo
    // que pedidos faturados já existentes também exibam a comunicação.
    router.get('/pedidos/:id/comunicacao-sefaz', async (req, res, next) => {
        try {
            const { id } = req.params;
            const fmt = (d) => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? String(d) : dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); };
            const padNum = (n) => n ? String(n).replace(/\D/g, '').padStart(8, '0') : '—';

            const [[ped]] = await pool.query(
                `SELECT id, numero_pedido, status, faturado_em, data_faturamento, created_at,
                        nfe_chave, nfe_protocolo, nfe_faturamento_numero, nfe_remessa_numero
                 FROM pedidos WHERE id = ?`, [id]
            );
            if (!ped) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            // NF-e vinculada (nfes.pedido_id)
            let nfe = null;
            try {
                const [rows] = await pool.query(
                    `SELECT id, numero, serie, chave_acesso, status, data_emissao, protocolo_autorizacao, created_at, usuario_id
                     FROM nfes WHERE pedido_id = ? ORDER BY id DESC LIMIT 1`, [id]
                );
                nfe = rows[0] || null;
            } catch (_e) { nfe = null; }

            let usuarioNome = 'Integração';
            if (nfe && nfe.usuario_id) {
                try { const [[u]] = await pool.query('SELECT nome FROM usuarios WHERE id = ?', [nfe.usuario_id]); if (u && u.nome) usuarioNome = u.nome; } catch (_e) { /* noop */ }
            }

            const numeroFmt  = padNum((nfe && nfe.numero) || ped.nfe_faturamento_numero || ped.nfe_remessa_numero);
            const protocolo  = (nfe && nfe.protocolo_autorizacao) || ped.nfe_protocolo || null;
            const statusPed  = String(ped.status || '').toLowerCase();
            const faturado   = ['faturado', 'entregue', 'recibo', 'concluido', 'concluído', 'finalizado', 'emitida', 'autorizada'].includes(statusPed);
            const eventos = [];

            if (nfe) {
                const dtBase    = nfe.data_emissao || nfe.created_at;
                const statusNfe = String(nfe.status || '').toLowerCase();
                eventos.push({ status: 'info', data: dtBase, descricao: `Enviando a NF-e Nº ${numeroFmt} para a SEFAZ`, usuario: usuarioNome });
                if (statusNfe === 'cancelada') {
                    eventos.push({ status: 'ok',    data: dtBase, descricao: `NF-e Nº ${numeroFmt} autorizada${protocolo ? `, protocolo ${protocolo}` : ''}.`, usuario: usuarioNome });
                    eventos.push({ status: 'error', data: nfe.created_at, descricao: `NF-e Nº ${numeroFmt} cancelada.`, usuario: usuarioNome });
                } else {
                    eventos.push({ status: 'ok', data: dtBase, descricao: `NF-e Nº ${numeroFmt} autorizada${protocolo ? `, protocolo ${protocolo}` : ''}.`, usuario: usuarioNome });
                }
                // Eventos registrados (CC-e, cancelamento eletrônico, e-mail, etc.)
                try {
                    const [evs] = await pool.query(
                        `SELECT tipo_evento, descricao_evento, COALESCE(data_evento, created_at) AS data, protocolo_evento, status
                         FROM nfe_eventos WHERE nfe_id = ? ORDER BY COALESCE(data_evento, created_at) ASC`, [nfe.id]
                    );
                    evs.forEach(r => {
                        const st = String(r.status || '').toLowerCase();
                        const tp = String(r.tipo_evento || '').toLowerCase();
                        const isErr = st.includes('err') || st.includes('rejeit') || tp.includes('cancel');
                        eventos.push({ status: isErr ? 'error' : 'ok', data: r.data, descricao: r.descricao_evento || r.tipo_evento || 'Evento', usuario: usuarioNome });
                    });
                } catch (_e) { /* tabela pode não existir */ }
            } else if (faturado) {
                const dt = ped.faturado_em || ped.data_faturamento || ped.created_at;
                if (ped.nfe_chave || ped.nfe_protocolo || ped.nfe_faturamento_numero) {
                    eventos.push({ status: 'info', data: dt, descricao: `Enviando a NF-e Nº ${numeroFmt} para a SEFAZ`, usuario: 'Integração' });
                    eventos.push({ status: 'ok',   data: dt, descricao: `NF-e Nº ${numeroFmt} autorizada${protocolo ? `, protocolo ${protocolo}` : ''}.`, usuario: 'Integração' });
                } else {
                    eventos.push({ status: 'ok', data: dt, descricao: 'Pedido faturado.', usuario: 'Integração' });
                }
            }

            eventos.sort((a, b) => new Date(a.data) - new Date(b.data));
            res.json({ success: true, data: eventos.map(e => ({ status: e.status, data_hora: fmt(e.data), descricao: e.descricao, usuario: e.usuario })) });
        } catch (error) { next(error); }
    });

    // POST /pedidos/:id/devolucao - Emite NF-e de DEVOLUÇÃO (modelo 55, finNFe=4, entrada)
    // referenciando a NF-e original autorizada do pedido. Transmite à SEFAZ de verdade.
    // Admin-only + exige confirmar:true. Idempotente: não reemite se já houver devolução.
    router.get('/pedidos/:id/devolucao', authenticateToken, async (req, res, next) => {
        // Pré-visualização: itens elegíveis + chave da NF-e original.
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT id, numero, serie, chave_acesso, status, valor_total, finalidade
                 FROM nfes WHERE pedido_id = ? ORDER BY id DESC`, [id]
            );
            const original = rows.find(n => String(n.status).toLowerCase() === 'autorizada' && String(n.finalidade || '1') !== '4') || null;
            const devolucaoExistente = rows.find(n => String(n.finalidade || '') === '4') || null;
            if (!original) {
                return res.json({ success: true, podeDevolver: false, motivo: 'Pedido sem NF-e autorizada para devolver.', itens: [] });
            }
            const [itens] = await pool.query(
                `SELECT produto_id, codigo_produto, descricao, quantidade, valor_unitario
                 FROM nfe_itens WHERE nfe_id = ?`, [original.id]
            );
            res.json({
                success: true,
                podeDevolver: !devolucaoExistente,
                jaDevolvido: !!devolucaoExistente,
                nfeOriginal: { id: original.id, numero: original.numero, chave: original.chave_acesso, valor_total: original.valor_total },
                devolucao: devolucaoExistente ? { id: devolucaoExistente.id, numero: devolucaoExistente.numero, status: devolucaoExistente.status } : null,
                itens
            });
        } catch (error) { next(error); }
    });

    router.post('/pedidos/:id/devolucao', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;
            const { confirmar, itens: itensBody, cfop, naturezaOperacao, tipoOperacao } = req.body || {};
            const usuarioId = req.user?.id || req.user?.userId || null;
            const isAdmin = req.user?.isAdmin || req.user?.is_admin || req.user?.perfil === 'admin';
            if (!isAdmin) return res.status(403).json({ success: false, message: 'Ação restrita a administradores.' });
            if (confirmar !== true) return res.status(400).json({ success: false, message: 'Confirmação obrigatória (confirmar:true).' });

            // NF-e original autorizada do pedido
            const [rows] = await pool.query(
                `SELECT id, numero, chave_acesso, status, finalidade FROM nfes WHERE pedido_id = ? ORDER BY id DESC`, [id]
            );
            const original = rows.find(n => String(n.status).toLowerCase() === 'autorizada' && String(n.finalidade || '1') !== '4') || null;
            if (!original) return res.status(400).json({ success: false, message: 'Pedido não possui NF-e autorizada para devolver.' });
            if (!original.chave_acesso || String(original.chave_acesso).replace(/\D/g, '').length !== 44) {
                return res.status(400).json({ success: false, message: 'NF-e original sem chave de acesso válida (44 dígitos).' });
            }
            // Idempotência: já existe devolução?
            const devExistente = rows.find(n => String(n.finalidade || '') === '4');
            if (devExistente) {
                return res.status(409).json({ success: false, message: `Já existe NF-e de devolução (Nº ${devExistente.numero}, ${devExistente.status}) para este pedido.`, devolucao: devExistente });
            }

            // Itens a devolver: do corpo, senão todos os itens da NF-e original
            let itens = Array.isArray(itensBody) && itensBody.length ? itensBody : null;
            if (!itens) {
                const [orig] = await pool.query(
                    `SELECT produto_id, quantidade, valor_unitario FROM nfe_itens WHERE nfe_id = ?`, [original.id]
                );
                itens = orig.map(i => ({ produto_id: i.produto_id, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario) }));
            }
            itens = itens.filter(i => i.produto_id && Number(i.quantidade) > 0 && Number(i.valor_unitario) > 0);
            if (!itens.length) return res.status(400).json({ success: false, message: 'Nenhum item válido para devolução.' });

            // CFOP de devolução de venda (entrada): interna 1202 / interestadual 2202 (override por body.cfop).
            let cfopDev = cfop || null;
            if (!cfopDev) {
                try {
                    const FiscalProfileService = require('../modules/Faturamento/services/fiscal-profile.service');
                    const emit = await FiscalProfileService.carregar(pool);
                    const [[cli]] = await pool.query(
                        `SELECT c.estado FROM pedidos p INNER JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?`, [id]
                    );
                    cfopDev = (emit && cli && emit.uf === cli.estado) ? '1202' : '2202';
                } catch (_e) { cfopDev = '2202'; }
            }

            const { emitirNFePedido } = require('../services/nfe-emitter.service');
            const emissao = await emitirNFePedido(pool, {
                pedidoId: Number(id),
                itens,
                usuarioId,
                naturezaOperacao: naturezaOperacao || 'Devolução de Venda',
                cfopOverride: cfopDev,
                finalidade: '4',
                tipoOperacao: String(tipoOperacao || '0'), // 0 = entrada (mercadoria retornando)
                nfRef: [original.chave_acesso],
                transmitir: true
            });

            // Histórico
            try {
                await pool.query(
                    `INSERT INTO pedido_historico (pedido_id, usuario_id, acao, descricao)
                     VALUES (?, ?, 'devolucao', ?)`,
                    [id, usuarioId, `NF-e de devolução Nº ${emissao.numero} ${emissao.autorizado ? 'autorizada' : (emissao.status || 'emitida')} (ref. NF-e ${original.numero}).`]
                );
            } catch (_e) { /* tabela de histórico pode variar */ }

            return res.json({
                success: !!emissao.autorizado || emissao.status === 'pendente',
                autorizado: !!emissao.autorizado,
                message: emissao.autorizado
                    ? `NF-e de devolução Nº ${emissao.numero} autorizada${emissao.protocolo ? ` (protocolo ${emissao.protocolo})` : ''}.`
                    : `NF-e de devolução Nº ${emissao.numero}: ${emissao.motivo || emissao.status}.`,
                devolucao: emissao
            });
        } catch (error) {
            if (error.code === 'IBGE_PREFLIGHT') {
                return res.status(422).json({ success: false, message: error.message });
            }
            next(error);
        }
    });

    // ====================== NF-e PAGAMENTO ANTECIPADO ======================
    // Emite NF-e (modelo 55, finalidade 1) para venda com pagamento antecipado,
    // antes do faturamento normal. Reusa o motor NF-e. Admin + confirmar. Idempotente.
    router.get('/pedidos/:id/nfe-antecipada', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;
            const [itens] = await pool.query(
                `SELECT produto_id, codigo, descricao, quantidade, preco_unitario, desconto
                 FROM pedido_itens WHERE pedido_id = ? AND produto_id IS NOT NULL`, [id]
            );
            const [nfes] = await pool.query(
                `SELECT id, numero, status, natureza_operacao FROM nfes WHERE pedido_id = ? ORDER BY id DESC`, [id]
            );
            const jaEmitida = nfes.find(n => /antecipad/i.test(n.natureza_operacao || '')) || null;
            const total = itens.reduce((s, i) => s + (Number(i.preco_unitario) * Number(i.quantidade) - (Number(i.desconto) || 0)), 0);
            res.json({ success: true, podeEmitir: !jaEmitida && itens.length > 0, jaEmitida, itens, total });
        } catch (error) { next(error); }
    });

    router.post('/pedidos/:id/nfe-antecipada', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;
            const { confirmar } = req.body || {};
            const usuarioId = req.user?.id || req.user?.userId || null;
            const isAdmin = req.user?.isAdmin || req.user?.is_admin || req.user?.perfil === 'admin';
            if (!isAdmin) return res.status(403).json({ success: false, message: 'Ação restrita a administradores.' });
            if (confirmar !== true) return res.status(400).json({ success: false, message: 'Confirmação obrigatória (confirmar:true).' });

            const [nfes] = await pool.query(`SELECT id, numero, status, natureza_operacao FROM nfes WHERE pedido_id = ? ORDER BY id DESC`, [id]);
            const ja = nfes.find(n => /antecipad/i.test(n.natureza_operacao || ''));
            if (ja) return res.status(409).json({ success: false, message: `Já existe NF-e de pagamento antecipado (Nº ${ja.numero}, ${ja.status}).` });

            const [rows] = await pool.query(
                `SELECT produto_id, quantidade, preco_unitario, desconto FROM pedido_itens WHERE pedido_id = ? AND produto_id IS NOT NULL`, [id]
            );
            const itens = rows.map(i => ({ produto_id: i.produto_id, quantidade: Number(i.quantidade), valor_unitario: Number(i.preco_unitario), desconto: Number(i.desconto) || 0 }))
                              .filter(i => i.produto_id && i.quantidade > 0 && i.valor_unitario > 0);
            if (!itens.length) return res.status(400).json({ success: false, message: 'Pedido sem itens válidos para emissão.' });

            const { emitirNFePedido } = require('../services/nfe-emitter.service');
            const emissao = await emitirNFePedido(pool, {
                pedidoId: Number(id), itens, usuarioId,
                naturezaOperacao: 'Venda - Pagamento Antecipado',
                finalidade: '1', tipoOperacao: '1', transmitir: true
            });
            try {
                await pool.query(`INSERT INTO pedido_historico (pedido_id, usuario_id, acao, descricao) VALUES (?, ?, 'nfe_antecipada', ?)`,
                    [id, usuarioId, `NF-e de pagamento antecipado Nº ${emissao.numero} ${emissao.autorizado ? 'autorizada' : (emissao.status || 'emitida')}.`]);
            } catch (_e) { /* noop */ }
            res.json({ success: !!emissao.autorizado, autorizado: !!emissao.autorizado,
                message: emissao.autorizado ? `NF-e antecipada Nº ${emissao.numero} autorizada${emissao.protocolo ? ` (protocolo ${emissao.protocolo})` : ''}.` : `NF-e antecipada Nº ${emissao.numero}: ${emissao.motivo || emissao.status}.`,
                nfe: emissao });
        } catch (error) {
            if (error.code === 'IBGE_PREFLIGHT') return res.status(422).json({ success: false, message: error.message });
            next(error);
        }
    });

    // ====================== MDF-e (Manifesto Eletrônico, modelo 58) ======================
    // Cria/lista o MDF-e do pedido a partir dos dados de transporte. Persiste como
    // 'rascunho' (a transmissão modelo-58 à SEFAZ depende do webservice MDFe dedicado).
    async function ensureMdfeTable() {
        await pool.query(`CREATE TABLE IF NOT EXISTS mdfe_documentos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NULL, numero INT NULL, serie INT DEFAULT 1, chave VARCHAR(60) NULL,
            uf_ini VARCHAR(2) NULL, uf_fim VARCHAR(2) NULL, placa VARCHAR(10) NULL,
            transportadora VARCHAR(180) NULL, modal VARCHAR(2) DEFAULT '01',
            valor_carga DECIMAL(14,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'rascunho',
            payload JSON NULL, usuario_id INT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    router.get('/pedidos/:id/mdfe', authenticateToken, async (req, res, next) => {
        try {
            await ensureMdfeTable();
            const { id } = req.params;
            const [docs] = await pool.query(`SELECT * FROM mdfe_documentos WHERE pedido_id = ? ORDER BY id DESC`, [id]);
            const [[ped]] = await pool.query(
                `SELECT p.id, p.valor, p.transportadora_nome, p.estado_destino, c.estado AS cliente_uf
                 FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?`, [id]);
            res.json({ success: true, mdfe: docs, pedido: ped || null });
        } catch (error) { next(error); }
    });
    router.post('/pedidos/:id/mdfe', authenticateToken, async (req, res, next) => {
        try {
            await ensureMdfeTable();
            const { id } = req.params;
            const usuarioId = req.user?.id || req.user?.userId || null;
            const isAdmin = req.user?.isAdmin || req.user?.is_admin || req.user?.perfil === 'admin';
            if (!isAdmin) return res.status(403).json({ success: false, message: 'Ação restrita a administradores.' });
            const { placa, uf_ini, uf_fim, modal } = req.body || {};
            const [[ped]] = await pool.query(
                `SELECT p.id, p.valor, p.transportadora_nome, p.estado_destino, c.estado AS cliente_uf
                 FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?`, [id]);
            if (!ped) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
            const [[mx]] = await pool.query(`SELECT COALESCE(MAX(numero),0)+1 AS prox FROM mdfe_documentos`);
            const payload = { itensCarga: ped.valor, origem: 'vendas' };
            const [ins] = await pool.query(
                `INSERT INTO mdfe_documentos (pedido_id, numero, uf_ini, uf_fim, placa, transportadora, modal, valor_carga, status, payload, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?)`,
                [id, mx.prox, uf_ini || ped.cliente_uf || ped.estado_destino || null, uf_fim || ped.estado_destino || ped.cliente_uf || null,
                 placa || null, ped.transportadora_nome || null, modal || '01', Number(ped.valor) || 0, JSON.stringify(payload), usuarioId]);
            try { await pool.query(`INSERT INTO pedido_historico (pedido_id, usuario_id, acao, descricao) VALUES (?, ?, 'mdfe', ?)`,
                [id, usuarioId, `MDF-e Nº ${mx.prox} criado (rascunho).`]); } catch (_e) {}
            res.json({ success: true, message: `MDF-e Nº ${mx.prox} criado (rascunho). Transmissão modelo-58 pendente de webservice MDFe.`, id: ins.insertId, numero: mx.prox });
        } catch (error) { next(error); }
    });

    // ====================== EVENTOS DA REFORMA TRIBUTÁRIA (IBS/CBS 2026) ======================
    // Calcula e lista os tributos da reforma (IBS estadual/municipal + CBS federal) para a
    // NF-e do pedido, no período de transição 2026, e registra eventos informativos.
    async function ensureReformaTable() {
        await pool.query(`CREATE TABLE IF NOT EXISTS reforma_tributaria_eventos (
            id INT AUTO_INCREMENT PRIMARY KEY, pedido_id INT NULL, nfe_id INT NULL,
            base DECIMAL(14,2) DEFAULT 0, ibs DECIMAL(14,2) DEFAULT 0, cbs DECIMAL(14,2) DEFAULT 0,
            imposto_seletivo DECIMAL(14,2) DEFAULT 0,
            aliq_ibs DECIMAL(6,4) DEFAULT 0.1000, aliq_cbs DECIMAL(6,4) DEFAULT 0.9000, aliq_is DECIMAL(6,4) DEFAULT 0.0000,
            descricao VARCHAR(255) NULL, usuario_id INT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        // Coluna IS pode faltar em tabela legada
        await pool.query("ALTER TABLE reforma_tributaria_eventos ADD COLUMN imposto_seletivo DECIMAL(14,2) DEFAULT 0").catch(() => {});
        await pool.query("ALTER TABLE reforma_tributaria_eventos ADD COLUMN aliq_is DECIMAL(6,4) DEFAULT 0.0000").catch(() => {});
        // Config singleton de alíquotas (editável). Default = transição 2026 (EC 132/2023, LC 214/2025).
        await pool.query(`CREATE TABLE IF NOT EXISTS reforma_tributaria_config (
            id INT PRIMARY KEY DEFAULT 1,
            aliq_cbs DECIMAL(6,4) DEFAULT 0.9000, aliq_ibs DECIMAL(6,4) DEFAULT 0.1000, aliq_is DECIMAL(6,4) DEFAULT 0.0000,
            atualizado_por INT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await pool.query(`INSERT IGNORE INTO reforma_tributaria_config (id, aliq_cbs, aliq_ibs, aliq_is) VALUES (1, 0.9000, 0.1000, 0.0000)`);
    }
    // Lê as alíquotas configuradas (percentual: 0.9 = 0,9%).
    async function getReformaConfig() {
        await ensureReformaTable();
        const [[c]] = await pool.query(`SELECT aliq_cbs, aliq_ibs, aliq_is FROM reforma_tributaria_config WHERE id = 1`);
        return {
            aliq_cbs: Number(c?.aliq_cbs ?? 0.9),
            aliq_ibs: Number(c?.aliq_ibs ?? 0.1),
            aliq_is: Number(c?.aliq_is ?? 0)
        };
    }
    // Motor de cálculo CBS/IBS/IS sobre uma base (valor). Retorna valores arredondados em R$.
    function calcReforma(base, cfg) {
        base = Number(base) || 0;
        const cbs = Math.round(base * cfg.aliq_cbs) / 100;
        const ibs = Math.round(base * cfg.aliq_ibs) / 100;
        const is  = Math.round(base * cfg.aliq_is) / 100;
        return { base, cbs, ibs, imposto_seletivo: is, total_reforma: Math.round((cbs + ibs + is) * 100) / 100 };
    }
    // Overrides centrais: mantem compatibilidade dos endpoints antigos usando o novo motor.
    const ensureReformaTableAtual = async function ensureReformaTableCentral() {
        await ReformaTributariaService.ensureReformaTributariaSchema(pool);
    };
    const getReformaConfigAtual = async function getReformaConfigCentral() {
        return ReformaTributariaService.getConfig(pool);
    };
    // Config das alíquotas — GET / PUT (admin)
    router.get('/reforma-tributaria/config', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, config: await getReformaConfigAtual() }); } catch (e) { next(e); }
    });
    router.put('/reforma-tributaria/config', authenticateToken, async (req, res, next) => {
        try {
            await ensureReformaTableAtual();
            const cbs = Math.max(0, Number(req.body.aliq_cbs)); const ibs = Math.max(0, Number(req.body.aliq_ibs)); const is = Math.max(0, Number(req.body.aliq_is));
            if ([cbs, ibs, is].some(n => !isFinite(n))) return res.status(400).json({ success: false, message: 'Alíquotas inválidas.' });
            await pool.query(`UPDATE reforma_tributaria_config SET aliq_cbs=?, aliq_ibs=?, aliq_is=?, atualizado_por=? WHERE id=1`,
                [cbs, ibs, is, req.user?.id || null]);
            res.json({ success: true, message: 'Alíquotas atualizadas.', config: await getReformaConfigAtual() });
        } catch (e) { next(e); }
    });
    // Apuração CBS/IBS/IS por período (para a página /Financeiro/impostos)
    router.get('/reforma-tributaria/apuracao', authenticateToken, async (req, res, next) => {
        try {
            const cfg = await getReformaConfigAtual();
            const { ano, mes } = req.query;
            let where = '1=1'; const params = [];
            if (ano) { where += ' AND YEAR(created_at) = ?'; params.push(ano); }
            if (mes) { where += ' AND MONTH(created_at) = ?'; params.push(mes); }
            const [[t]] = await pool.query(
                `SELECT COALESCE(SUM(base),0) base, COALESCE(SUM(cbs),0) cbs, COALESCE(SUM(ibs),0) ibs,
                        COALESCE(SUM(imposto_seletivo),0) imposto_seletivo, COUNT(*) eventos
                 FROM reforma_tributaria_eventos WHERE ${where}`, params);
            const cbs = Number(t.cbs), ibs = Number(t.ibs), is = Number(t.imposto_seletivo);
            res.json({ success: true, config: cfg, apuracao: {
                base: Number(t.base), cbs, ibs, imposto_seletivo: is,
                total: Math.round((cbs + ibs + is) * 100) / 100, eventos: Number(t.eventos)
            }});
        } catch (e) { next(e); }
    });
    // Monta o grupo XML CBS/IBS/IS (layout reforma — NT 2025) para uma base.
    // Usado no PREVIEW (dry-run) e, futuramente, na emissão real quando habilitado.
    function buildIbsCbsXml(calc, cfg) {
        const d = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
        const p = (n) => (Number(n) || 0).toFixed(4);
        return (
`    <IBSCBS>
      <CST>000</CST>
      <cClassTrib>000001</cClassTrib>
      <gIBSCBS>
        <vBC>${d(calc.base)}</vBC>
        <gIBSUF><pIBSUF>${p(cfg.aliq_ibs / 2)}</pIBSUF><vIBSUF>${d(calc.ibs / 2)}</vIBSUF></gIBSUF>
        <gIBSMun><pIBSMun>${p(cfg.aliq_ibs / 2)}</pIBSMun><vIBSMun>${d(calc.ibs / 2)}</vIBSMun></gIBSMun>
        <vIBS>${d(calc.ibs)}</vIBS>
        <gCBS><pCBS>${p(cfg.aliq_cbs)}</pCBS><vCBS>${d(calc.cbs)}</vCBS></gCBS>
        ${calc.imposto_seletivo > 0 ? `<gIS><pIS>${p(cfg.aliq_is)}</pIS><vIS>${d(calc.imposto_seletivo)}</vIS></gIS>` : '<!-- IS isento -->'}
      </gIBSCBS>
    </IBSCBS>`
        );
    }
    // PREVIEW dry-run: gera a NF-e do pedido com CBS/IBS/IS, NÃO transmite à SEFAZ (tpAmb=2 homologação).
    router.get('/pedidos/:id/nfe-reforma-preview', authenticateToken, async (req, res, next) => {
        try {
            const cfg = await getReformaConfigAtual();
            const { id } = req.params;
            const calcPedido = await ReformaTributariaService.calcularPedido(pool, id, { config: cfg });
            const calc = calcPedido;
            const grupoItem = buildIbsCbsXml(calc, cfg);
            const totalXml =
`  <IBSCBSTot>
    <vBCIBSCBS>${calc.base.toFixed(2)}</vBCIBSCBS>
    <gIBS><vIBS>${calc.ibs.toFixed(2)}</vIBS></gIBS>
    <gCBS><vCBS>${calc.cbs.toFixed(2)}</vCBS></gCBS>
    <vIS>${calc.imposto_seletivo.toFixed(2)}</vIS>
  </IBSCBSTot>`;
            res.json({
                success: true,
                transmitido: false,
                tpAmb: '2',
                ambiente: 'PREVIEW (homologação) — NÃO enviado à SEFAZ',
                pedido: { ...calcPedido.pedido, base: calc.base },
                aliquotas: cfg,
                calculo: { cbs: calc.cbs, ibs: calc.ibs, imposto_seletivo: calc.imposto_seletivo, total_reforma: calc.total_reforma, itens: calcPedido.itens },
                xml_preview: { grupo_por_item: grupoItem, grupo_total: totalXml }
            });
        } catch (e) { next(e); }
    });
    router.get('/pedidos/:id/reforma-tributaria', authenticateToken, async (req, res, next) => {
        try {
            const cfg = await getReformaConfigAtual();
            const { id } = req.params;
            const r = await ReformaTributariaService.calcularPedido(pool, id, { config: cfg });
            const [eventos] = await pool.query(`SELECT * FROM reforma_tributaria_eventos WHERE pedido_id = ? ORDER BY id DESC`, [id]);
            res.json({ success: true, ...r, aliq_ibs: cfg.aliq_ibs, aliq_cbs: cfg.aliq_cbs, aliq_is: cfg.aliq_is, eventos });
        } catch (error) { next(error); }
    });
    router.post('/pedidos/:id/reforma-tributaria', authenticateToken, async (req, res, next) => {
        try {
            const cfg = await getReformaConfigAtual();
            const { id } = req.params;
            const usuarioId = req.user?.id || req.user?.userId || null;
            const [[nfe]] = await pool.query(`SELECT id FROM nfes WHERE pedido_id = ? ORDER BY id DESC LIMIT 1`, [id]);
            const r = await ReformaTributariaService.calcularPedido(pool, id, { config: cfg });
            const eventoId = await ReformaTributariaService.registrarEventoPedido(pool, id, usuarioId, r, nfe ? nfe.id : null);
            res.json({ success: true, message: 'Apuração CBS/IBS/IS registrada.', id: eventoId, ...r });
        } catch (error) { next(error); }
    });

    // GET /pedidos/:id/historico - Buscar histórico do pedido
    router.get('/pedidos/:id/historico', async (req, res, next) => {
        try {
            const { id } = req.params;

            // Verificar se tabela existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'pedido_historico'");
            if (tables.length === 0) {
                return res.json({ success: true, data: [] });
            }

            const [historico] = await pool.query(`
                SELECT id, pedido_id, usuario_id, usuario_nome, acao, descricao, meta, created_at
                FROM pedido_historico
                WHERE pedido_id = ?
                ORDER BY created_at DESC
                LIMIT 100
            `, [id]);

            res.json({ success: true, data: historico });
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            res.json({ success: true, data: [] }); // Retorna vazio em caso de erro
        }
    });

    // POST /pedidos/:id/historico - Registrar histórico do pedido
    router.post('/pedidos/:id/historico', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { tipo, action, descricao, usuario, meta } = req.body;
            const user = req.user || {};

            // Garantir que a tabela existe com colunas corretas
            try {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS pedido_historico (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        pedido_id INT NOT NULL,
                        usuario_id INT,
                        usuario_nome VARCHAR(100),
                        acao VARCHAR(50) NOT NULL,
                        descricao TEXT,
                        meta JSON,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_pedido (pedido_id),
                        INDEX idx_acao (acao)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                `);
            } catch (e) { /* tabela já existe */ }

            // Tentar inserir com colunas corretas (usuario_id/usuario_nome ou user_id/user_name)
            try {
                await pool.query(
                    'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, user.id || null, usuario || user.nome || 'Sistema', tipo || action || 'status', descricao || '', meta ? JSON.stringify(meta) : null]
                );
            } catch (e) {
                // Fallback para colunas alternativas
                await pool.query(
                    'INSERT INTO pedido_historico (pedido_id, descricao, acao, meta) VALUES (?, ?, ?, ?)',
                    [id, `${usuario || user.nome || 'Sistema'}: ${descricao || ''}`, tipo || action || 'status', meta ? JSON.stringify(meta) : null]
                );
            }

            res.status(201).json({ message: 'Histórico registrado com sucesso!' });
        } catch (error) {
            console.error('❌ Erro ao registrar histórico:', error);
            // Não bloqueia a operação principal
            res.status(201).json({ message: 'Histórico não registrado (tabela não configurada)', warning: true });
        }
    });

    // ====================== TAREFAS DO PEDIDO ======================
    // Garante que a tabela de tarefas exista (idempotente)
    async function ensurePedidoTarefasTable() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedido_tarefas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                texto VARCHAR(500) NOT NULL,
                concluida TINYINT(1) NOT NULL DEFAULT 0,
                usuario_id INT,
                usuario_nome VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pedido (pedido_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    }

    // GET /pedidos/:id/tarefas - Listar tarefas do pedido (retorna array puro)
    router.get('/pedidos/:id/tarefas', async (req, res) => {
        try {
            const { id } = req.params;
            await ensurePedidoTarefasTable();
            const [rows] = await pool.query(
                'SELECT id, texto, concluida FROM pedido_tarefas WHERE pedido_id = ? ORDER BY concluida ASC, created_at ASC',
                [id]
            );
            res.json(rows.map(r => ({ id: r.id, texto: r.texto, concluida: !!r.concluida })));
        } catch (error) {
            console.error('❌ Erro ao buscar tarefas do pedido:', error.message);
            res.json([]); // não quebra a UI
        }
    });

    // POST /pedidos/:id/tarefas - Criar tarefa (retorna o objeto criado)
    router.post('/pedidos/:id/tarefas', async (req, res) => {
        try {
            const { id } = req.params;
            const texto = (req.body && req.body.texto ? String(req.body.texto) : '').trim();
            if (!texto) {
                return res.status(400).json({ message: 'Descrição da tarefa é obrigatória' });
            }
            const user = req.user || {};
            await ensurePedidoTarefasTable();
            const [result] = await pool.query(
                'INSERT INTO pedido_tarefas (pedido_id, texto, concluida, usuario_id, usuario_nome) VALUES (?, ?, 0, ?, ?)',
                [id, texto, user.id || null, user.nome || user.name || 'Sistema']
            );
            res.status(201).json({ id: result.insertId, texto, concluida: false });
        } catch (error) {
            console.error('❌ Erro ao criar tarefa do pedido:', error.message);
            res.status(500).json({ message: 'Erro ao adicionar tarefa' });
        }
    });

    // PUT /tarefas/:tarefaId - Atualizar tarefa (concluída / texto)
    router.put('/tarefas/:tarefaId', async (req, res) => {
        try {
            const { tarefaId } = req.params;
            await ensurePedidoTarefasTable();
            const campos = [];
            const valores = [];
            if (typeof req.body.concluida !== 'undefined') {
                campos.push('concluida = ?');
                valores.push(req.body.concluida ? 1 : 0);
            }
            if (typeof req.body.texto !== 'undefined') {
                campos.push('texto = ?');
                valores.push(String(req.body.texto).trim());
            }
            if (campos.length === 0) {
                return res.status(400).json({ message: 'Nada para atualizar' });
            }
            valores.push(tarefaId);
            await pool.query(`UPDATE pedido_tarefas SET ${campos.join(', ')} WHERE id = ?`, valores);
            const [rows] = await pool.query('SELECT id, texto, concluida FROM pedido_tarefas WHERE id = ?', [tarefaId]);
            if (rows.length === 0) return res.status(404).json({ message: 'Tarefa não encontrada' });
            res.json({ id: rows[0].id, texto: rows[0].texto, concluida: !!rows[0].concluida });
        } catch (error) {
            console.error('❌ Erro ao atualizar tarefa do pedido:', error.message);
            res.status(500).json({ message: 'Erro ao atualizar tarefa' });
        }
    });

    // DELETE /tarefas/:tarefaId - Excluir tarefa
    router.delete('/tarefas/:tarefaId', async (req, res) => {
        try {
            const { tarefaId } = req.params;
            await ensurePedidoTarefasTable();
            await pool.query('DELETE FROM pedido_tarefas WHERE id = ?', [tarefaId]);
            res.json({ success: true, message: 'Tarefa removida' });
        } catch (error) {
            console.error('❌ Erro ao excluir tarefa do pedido:', error.message);
            res.status(500).json({ message: 'Erro ao excluir tarefa' });
        }
    });

    // BUSCA UNIFICADA: CLIENTES + EMPRESAS (para autocomplete de dropdowns)
    router.get('/clientes-empresas/search', async (req, res, next) => {
        try {
            const q = (req.query.q || '').trim();
            if (q.length < 1) return res.json([]);
            const queryLike = `%${q}%`;
            const qDigits = q.replace(/\D/g, '');
            const queryDigits = qDigits.length >= 3 ? `%${qDigits}%` : null;
            const [empresaColumns, clienteColumns] = await Promise.all([
                getTableColumns('empresas'),
                getTableColumns('clientes')
            ]);
            const empresaUfSelect = firstExistingColumnSelect('e', empresaColumns, ['estado', 'uf'], 'uf');
            const clienteUfSelect = firstExistingColumnSelect('c', clienteColumns, ['estado', 'uf'], 'uf');
            const normalizeUf = value => String(value || '').trim().toUpperCase();

            // Buscar empresas (nome_fantasia, razao_social, cnpj com/sem formatação)
            let sqlEmpresas = `SELECT e.id, e.nome_fantasia, e.razao_social, e.cnpj, ${empresaUfSelect}, 'empresa' as tipo
                 FROM empresas e WHERE e.nome_fantasia LIKE ? OR e.razao_social LIKE ? OR e.cnpj LIKE ?`;
            const paramsEmpresas = [queryLike, queryLike, queryLike];
            if (queryDigits) {
                sqlEmpresas += ` OR REPLACE(REPLACE(REPLACE(e.cnpj, '.', ''), '-', ''), '/', '') LIKE ?`;
                paramsEmpresas.push(queryDigits);
            }
            sqlEmpresas += ` ORDER BY e.nome_fantasia LIMIT 15`;
            const [empresas] = await pool.query(sqlEmpresas, paramsEmpresas);

            // Buscar clientes (nome, nome_fantasia, razao_social, cnpj, cnpj_cpf, cpf, email)
            let sqlClientes = `SELECT c.id, c.nome, c.nome_fantasia, c.razao_social, c.email,
                        c.telefone, c.cpf, c.cnpj, c.cnpj_cpf, ${clienteUfSelect}, c.empresa_id,
                        e.nome_fantasia as empresa_nome, 'cliente' as tipo
                 FROM clientes c LEFT JOIN empresas e ON c.empresa_id = e.id
                 WHERE c.nome LIKE ? OR c.nome_fantasia LIKE ? OR c.razao_social LIKE ?
                    OR c.email LIKE ? OR c.cpf LIKE ? OR c.cnpj LIKE ? OR c.cnpj_cpf LIKE ?`;
            const paramsClientes = [queryLike, queryLike, queryLike, queryLike, queryLike, queryLike, queryLike];
            if (queryDigits) {
                sqlClientes += ` OR REPLACE(REPLACE(REPLACE(c.cnpj_cpf, '.', ''), '-', ''), '/', '') LIKE ?`;
                sqlClientes += ` OR REPLACE(REPLACE(REPLACE(c.cnpj, '.', ''), '-', ''), '/', '') LIKE ?`;
                paramsClientes.push(queryDigits, queryDigits);
            }
            sqlClientes += ` ORDER BY c.nome LIMIT 15`;
            const [clientes] = await pool.query(sqlClientes, paramsClientes);

            // Combinar: empresas primeiro, depois clientes
            const resultados = [
                ...empresas.map(e => ({
                    id: e.id,
                    nome: e.nome_fantasia || e.razao_social || `Empresa #${e.id}`,
                    razao_social: e.razao_social || '',
                    cnpj: e.cnpj || '',
                    uf: normalizeUf(e.uf),
                    estado: normalizeUf(e.uf),
                    subtitulo: [e.razao_social, e.cnpj ? `CNPJ: ${e.cnpj}` : '', e.uf ? `UF: ${normalizeUf(e.uf)}` : ''].filter(Boolean).join(' | '),
                    tipo: 'empresa',
                    empresa_id: e.id
                })),
                ...clientes.map(c => ({
                    id: c.id,
                    nome: c.nome_fantasia || c.nome || c.razao_social || `Cliente #${c.id}`,
                    razao_social: c.razao_social || '',
                    cnpj: c.cnpj || c.cnpj_cpf || '',
                    cpf: c.cpf || '',
                    email: c.email || '',
                    uf: normalizeUf(c.uf),
                    estado: normalizeUf(c.uf),
                    subtitulo: [
                        c.razao_social && c.razao_social !== (c.nome_fantasia || c.nome) ? c.razao_social : '',
                        c.cnpj || c.cnpj_cpf ? `CNPJ/CPF: ${c.cnpj || c.cnpj_cpf}` : (c.cpf ? `CPF: ${c.cpf}` : ''),
                        c.uf ? `UF: ${normalizeUf(c.uf)}` : '',
                        c.empresa_nome ? `(${c.empresa_nome})` : ''
                    ].filter(Boolean).join(' | '),
                    tipo: 'cliente',
                    cliente_id: c.id,
                    empresa_id: c.empresa_id
                }))
            ];

            res.json(resultados);
        } catch (error) { next(error); }
    });

    // EMPRESAS
    router.get('/empresas', cacheMiddleware('vendas_empresas', 120000), async (req, res, next) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');
            const rows = await repos.empresa.list({ page, limit, isAdmin, vendedorId: req.user?.id });
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/empresas/search', async (req, res, next) => {
        try {
            const q = req.query.q || '';
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');
            const rows = await repos.empresa.search(q, { isAdmin, vendedorId: req.user?.id });
            res.json(rows);
        } catch (error) { next(error); }
    });
    // Busca de empresas (autocomplete) - DEVE ficar ANTES de /empresas/:id
    router.get('/empresas/buscar', async (req, res, next) => {
        try {
            const search = req.query.search || req.query.q || req.query.termo || '';
            const limit = parseInt(req.query.limit) || 15;
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');

            let query = `SELECT id, nome_fantasia, razao_social, cnpj, telefone, email FROM empresas WHERE 1=1`;
            const params = [];

            if (search) {
                query += ` AND (nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (!isAdmin && req.user && req.user.id) {
                // Não-admin: clientes do próprio vendedor + os ainda sem vendedor (recém-cadastrados).
                // (Hoje as empresas estão com vendedor_id NULL, então todos continuam visíveis;
                //  o filtro vai apertando conforme as empresas recebem um vendedor responsável.)
                query += ` AND (vendedor_id = ? OR vendedor_id IS NULL)`;
                params.push(req.user.id);
            }

            query += ` ORDER BY nome_fantasia LIMIT ?`;
            params.push(limit);

            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/empresas/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [[empresa]] = await pool.query('SELECT * FROM empresas WHERE id = ?', [id]);
            if (!empresa) return res.status(404).json({ message: 'Empresa não encontrada.' });
            res.json(empresa);
        } catch (error) { next(error); }
    });
    router.get('/empresas/:id/details', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [empresaResult, kpisResult, pedidosResult, clientesResult] = await Promise.all([
                pool.query('SELECT * FROM empresas WHERE id = ?', [id]),
                pool.query(`SELECT COUNT(*) AS totalPedidos, COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS totalFaturado, COALESCE(AVG(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS ticketMedio FROM pedidos WHERE empresa_id = ?`, [id]),
                pool.query('SELECT id, valor, status, created_at FROM pedidos WHERE empresa_id = ? ORDER BY created_at DESC', [id]),
                pool.query('SELECT id, nome, email, telefone FROM clientes WHERE empresa_id = ? ORDER BY nome ASC', [id])
            ]);
            const [details] = empresaResult[0];
            if (!details) return res.status(404).json({ message: 'Empresa não encontrada.' });
            const [kpis] = kpisResult[0];
            const [pedidos] = pedidosResult;
            const [clientes] = clientesResult;
            res.json({ details, kpis: kpis[0], pedidos, clientes });
        } catch (error) { next(error); }
    });
    router.post('/empresas', [
        body('cnpj').trim().notEmpty().withMessage('CNPJ é obrigatório')
            .matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/).withMessage('CNPJ deve estar no formato XX.XXX.XXX/XXXX-XX'),
        body('nome_fantasia').trim().notEmpty().withMessage('Nome fantasia é obrigatório')
            .isLength({ max: 255 }).withMessage('Nome fantasia muito longo'),
        body('razao_social').optional().trim().isLength({ max: 255 }).withMessage('Razão social muito longa'),
        body('email').optional().trim().isEmail().withMessage('Email inválido'),
        body('telefone').optional().trim().matches(/^\(\d{2}\) \d{4,5}-\d{4}$/).withMessage('Telefone inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const { cnpj, nome_fantasia, razao_social, email, telefone, cep, logradouro, numero, bairro, municipio, uf } = req.body;

            // Associar o vendedor que está cadastrando a empresa
            const vendedor_id = req.user ? req.user.id : null;

            await pool.query(
                `INSERT INTO empresas (cnpj, nome_fantasia, razao_social, email, telefone, cep, logradouro, numero, bairro, municipio, uf, vendedor_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [cnpj, nome_fantasia, razao_social || null, email || null, telefone || null, cep || null, logradouro || null, numero || null, bairro || null, municipio || null, uf || null, vendedor_id, vendedor_id]
            );
            res.status(201).json({ message: 'Empresa cadastrada com sucesso!' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Este CNPJ já está cadastrado.' });
            next(error);
        }
    });

    // CLIENTES (CONTATOS)
    // Busca de clientes (autocomplete) — DEVE ficar ANTES de /clientes/:id
    router.get('/clientes/buscar', authenticateToken, async (req, res, next) => {
        try {
            const search = req.query.search || req.query.q || req.query.termo || '';
            const limit = parseInt(req.query.limit) || 20;
            let query = `SELECT id, nome, razao_social, nome_fantasia, cnpj_cpf, email, telefone, cidade, estado FROM clientes WHERE ativo = 1`;
            const params = [];
            if (search) {
                query += ` AND (nome LIKE ? OR razao_social LIKE ? OR cnpj_cpf LIKE ? OR email LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            }
            query += ` ORDER BY nome LIMIT ?`;
            params.push(limit);
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/clientes', authenticateToken, cacheMiddleware('vendas_clientes', 120000, true), async (req, res, next) => {
        try {
            const { page = 1, limit = 2000 } = req.query;
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');
            const isComercial = req.user?.role === 'comercial';
            const rows = await repos.cliente.list({ page, limit, isAdmin, isComercial, vendedorId: req.user?.id, vendedorNome: req.user?.nome });
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/clientes/:id', authenticateToken, async (req, res, next) => {
        try {
            const cliente = await repos.cliente.findById(req.params.id);
            if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' });
            res.json(cliente);
        } catch (error) { next(error); }
    });
    // Resumo/inteligência do cliente (KPIs, pedidos recentes, financeiro)
    router.get('/clientes/:id/resumo', authenticateToken, async (req, res, next) => {
        try {
            const clienteId = parseInt(req.params.id);
            if (isNaN(clienteId)) return res.status(400).json({ message: 'ID inválido.' });

            const [clienteRows] = await pool.query('SELECT id, data_cadastro, created_at FROM clientes WHERE id = ?', [clienteId]);
            if (clienteRows.length === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });

            const dataInicio = clienteRows[0].data_cadastro || clienteRows[0].created_at;
            let tempo_cliente = null;
            if (dataInicio) {
                const inicio = new Date(dataInicio);
                const agora = new Date();
                const diffMs = agora - inicio;
                const totalDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                const anos = Math.floor(totalDias / 365);
                const meses = Math.floor((totalDias % 365) / 30);
                const dias = totalDias % 30;
                tempo_cliente = { anos, meses, dias, total_dias: totalDias, data_inicio: dataInicio };
            }

            let stats = { total_pedidos: 0, valor_total: 0, ticket_medio: 0, maior_pedido: 0, pedidos_concluidos: 0, pedidos_aprovados: 0, pedidos_em_aberto: 0, pedidos_cancelados: 0 };
            try {
                const [statsRows] = await pool.query(
                    `SELECT COUNT(*) as total_pedidos, COALESCE(SUM(valor_total),0) as valor_total,
                            COALESCE(AVG(valor_total),0) as ticket_medio, COALESCE(MAX(valor_total),0) as maior_pedido,
                            SUM(CASE WHEN status IN ('entregue','faturado') THEN 1 ELSE 0 END) as pedidos_concluidos,
                            SUM(CASE WHEN status = 'aprovado' OR status = 'pedido-aprovado' THEN 1 ELSE 0 END) as pedidos_aprovados,
                            SUM(CASE WHEN status IN ('orcamento','analise','analise-credito') THEN 1 ELSE 0 END) as pedidos_em_aberto,
                            SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) as pedidos_cancelados
                     FROM pedidos WHERE cliente_id = ?`, [clienteId]
                );
                if (statsRows[0]) stats = statsRows[0];
            } catch (e) { console.error('[Vendas] Erro stats resumo cliente:', e.message); }

            let pedidosRecentes = [];
            try {
                const [rows] = await pool.query(
                    `SELECT id, created_at, valor_total as valor, status FROM pedidos WHERE cliente_id = ? ORDER BY created_at DESC LIMIT 5`, [clienteId]
                );
                pedidosRecentes = rows;
            } catch (e) { console.error('[Vendas] Erro pedidos recentes:', e.message); }

            let produtosMais = [];
            try {
                const [rows] = await pool.query(
                    `SELECT p.nome, SUM(pi.quantidade) as quantidade
                     FROM pedido_itens pi JOIN produtos p ON pi.produto_id = p.id
                     JOIN pedidos ped ON pi.pedido_id = ped.id
                     WHERE ped.cliente_id = ? GROUP BY p.id, p.nome ORDER BY quantidade DESC LIMIT 5`, [clienteId]
                );
                produtosMais = rows;
            } catch (e) { console.error('[Vendas] Erro produtos mais:', e.message); }

            let financeiro = { valor_pago: 0, valor_pendente: 0, valor_vencido: 0, total_titulos: 0 };
            try {
                const [fin] = await pool.query(
                    `SELECT COUNT(*) as total_titulos,
                            COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END),0) as valor_pago,
                            COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento >= CURDATE() THEN valor ELSE 0 END),0) as valor_pendente,
                            COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento < CURDATE() THEN valor ELSE 0 END),0) as valor_vencido
                     FROM contas_receber WHERE cliente_id = ?`, [clienteId]
                );
                if (fin[0]) financeiro = fin[0];
            } catch (_) { /* contas_receber may not exist */ }

            res.json({
                estatisticas: stats,
                tempo_cliente,
                pedidos_recentes: pedidosRecentes,
                produtos_mais_comprados: produtosMais,
                financeiro
            });
        } catch (error) { next(error); }
    });

    // ═══════════════════════════════════════════════════════
    // CREDIT ANALYSIS ROUTES
    // ═══════════════════════════════════════════════════════

    // GET /clientes/:id/credito — Credit limit and available credit
    router.get('/clientes/:id/credito', authenticateToken, async (req, res, next) => {
        try {
            const clienteId = parseInt(req.params.id);
            if (isNaN(clienteId)) return res.status(400).json({ message: 'ID inválido.' });

            const [clienteRows] = await pool.query(
                'SELECT id, nome, razao_social, limite_credito, empresa_id FROM clientes WHERE id = ? LIMIT 1',
                [clienteId]
            );
            if (clienteRows.length === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });

            const cliente = clienteRows[0];
            const limiteCredito = parseFloat(cliente.limite_credito || 0);

            const [creditUsed] = await pool.query(
                `SELECT COALESCE(SUM(valor), 0) as total_pendente
                 FROM pedidos
                 WHERE cliente_id = ?
                   AND status IN ('aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'parcial')`,
                [clienteId]
            );
            const totalPendente = parseFloat(creditUsed[0].total_pendente || 0);
            const creditoDisponivel = Math.max(0, limiteCredito - totalPendente);

            res.json({
                cliente_id: clienteId,
                nome: cliente.razao_social || cliente.nome,
                limite_credito: limiteCredito,
                total_pendente: totalPendente,
                credito_disponivel: creditoDisponivel
            });
        } catch (error) { next(error); }
    });

    // POST /pedidos/:id/aprovacao-credito — Register credit analysis decision
    router.post('/pedidos/:id/aprovacao-credito', authenticateToken, async (req, res, next) => {
        try {
            const pedidoId = parseInt(req.params.id);
            if (isNaN(pedidoId)) return res.status(400).json({ success: false, message: 'ID inválido.' });

            const { parecer, condicao_pagamento, observacoes } = req.body;
            if (!parecer || !['aprovado', 'aprovado_avista', 'reprovado'].includes(parecer)) {
                return res.status(400).json({ success: false, message: 'Parecer inválido.' });
            }

            const [pedidoRows] = await pool.query('SELECT id, status, cliente_id, valor FROM pedidos WHERE id = ? LIMIT 1', [pedidoId]);
            if (pedidoRows.length === 0) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                if (condicao_pagamento) {
                    await connection.query('UPDATE pedidos SET condicao_pagamento = ? WHERE id = ?', [condicao_pagamento, pedidoId]);
                }

                let novoStatus;
                let descricao = '';
                if (parecer === 'aprovado') {
                    novoStatus = 'pedido-aprovado';
                    descricao = 'Crédito aprovado';
                } else if (parecer === 'aprovado_avista') {
                    novoStatus = 'pedido-aprovado';
                    descricao = 'Crédito aprovado (à vista)';
                    await connection.query('UPDATE pedidos SET condicao_pagamento = ? WHERE id = ?', ['a_vista', pedidoId]);
                } else {
                    novoStatus = 'credito-reprovado';
                    descricao = 'Crédito reprovado';
                }
                if (observacoes) descricao += ' — ' + observacoes;

                await connection.query('UPDATE pedidos SET status = ? WHERE id = ?', [novoStatus, pedidoId]);

                // Log to history
                try {
                    const [tables] = await connection.query("SHOW TABLES LIKE 'pedido_historico'");
                    if (tables.length > 0) {
                        await connection.query(
                            `INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, created_at)
                             VALUES (?, ?, ?, ?, ?, NOW())`,
                            [pedidoId, req.user.id, req.user.nome || req.user.email, 'aprovacao-credito', descricao]
                        );
                    }
                } catch (_) { /* table may not exist */ }

                await connection.commit();
                res.json({ success: true, message: descricao, novo_status: novoStatus });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        } catch (error) { next(error); }
    });

    router.post('/clientes', authenticateToken, async (req, res, next) => {
        try {
            if (!(await podeCadastrarVendas(req.user, 'clientes'))) {
                return res.status(403).json({ success: false, message: 'Seu perfil nao tem permissao para cadastrar clientes.', code: 'SEM_PERMISSAO_CLIENTES' });
            }
            // Field aliasing — frontend may send razao_social/cnpj_cpf/ie/logradouro/número
            const b = req.body;
            const nome = (b.nome || b.razao_social || '').trim();
            const cnpj = b.cnpj || b.cnpj_cpf || null;
            const endereco = b.endereco || b.logradouro || null;
            const numero = b.numero || b.número || null;
            const inscricao_estadual = b.inscricao_estadual || b.ie || null;
            const contato = b.contato || b.contato_nome || null;
            const { nome_fantasia, telefone, celular, email, website,
                    complemento, bairro, cidade, uf, cep,
                    inscricao_municipal, limite_credito, ativo, empresa_id,
                    contato_nome, contato_cargo, observacoes,
                    fax, ddd_fax, enviar_anexos, banco, agencia, conta, pix, titular_doc, titular_nome, tipo_conta,
                    suframa, simples_nacional, produtor_rural, tipo_atividade, cnae,
                    obs_internas, obs_detalhadas, parcelas_padrao, vendedor_padrao,
                    email_nfe, transportadora, codigo_receita, bloquear_faturamento } = b;
            if (!nome) {
                return res.status(400).json({ message: 'Nome / Razão Social é obrigatório.' });
            }
            if (nome.length > 255) {
                return res.status(400).json({ message: 'Nome muito longo (máx 255 caracteres).' });
            }
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ message: 'Email inválido.' });
            }
            // BUG-VEND-008: rejeitar CNPJ/CPF inválido (só valida se informado — documento é opcional)
            if (cnpj && onlyDigits(cnpj).length > 0 && !isValidDoc(cnpj)) {
                return res.status(400).json({ message: 'CNPJ/CPF inválido — verifique os dígitos (14 díg. p/ CNPJ ou 11 p/ CPF).' });
            }

            const [cols] = await pool.query('SHOW COLUMNS FROM clientes');
            const availableColumns = new Set(cols.map(col => col.Field));
            const usuarioLogadoId = req.user?.id || null;
            const usuarioLogadoNome = req.user?.nome || req.user?.name || req.user?.email || null;

            // Resolver empresa_id: body > user token > buscar primeira empresa
            let empresaIdFinal = empresa_id || req.user?.empresa_id || null;
            if (!empresaIdFinal && availableColumns.has('empresa_id')) {
                try {
                    const [empRows] = await pool.query('SELECT id FROM empresas ORDER BY id LIMIT 1');
                    empresaIdFinal = empRows.length > 0 ? empRows[0].id : null;
                } catch (_) { /* tabela empresas pode não existir */ }
            }

            const payload = {
                nome,
                nome_fantasia: nome_fantasia || null,
                razao_social: nome || null,
                cnpj: cnpj || null,
                cnpj_cpf: cnpj || null,
                contato: contato || null,
                nome_contato: contato_nome || contato || null,
                contato_cargo: contato_cargo || null,
                telefone: telefone || null,
                celular: celular || null,
                email: email || null,
                website: website || null,
                endereco: endereco || null,
                logradouro: endereco || null,
                numero: numero || null,
                complemento: complemento || null,
                bairro: bairro || null,
                cidade: cidade || null,
                estado: uf || null,
                uf: uf || null,
                cep: cep || null,
                inscricao_estadual: inscricao_estadual || null,
                ie: inscricao_estadual || null,
                inscricao_municipal: inscricao_municipal || null,
                credito_total: limite_credito ? parseFloat(limite_credito) : 0,
                ativo: ativo !== undefined ? (ativo ? 1 : 0) : 1,
                empresa_id: empresaIdFinal,
                observacoes: observacoes || null,
                data_cadastro: new Date(),
                vendedor_id: usuarioLogadoId,
                usuario_id: usuarioLogadoId,
                user_id: usuarioLogadoId,
                created_by: usuarioLogadoId,
                vendedor_responsavel: usuarioLogadoNome,
                vendedor_proprietario: usuarioLogadoNome,
                incluido_por: usuarioLogadoNome || 'Sistema',
                fax: fax || null,
                ddd_fax: ddd_fax || null,
                enviar_anexos: enviar_anexos !== undefined ? (enviar_anexos ? 1 : 0) : 1,
                banco: banco || null,
                agencia: agencia || null,
                conta: conta || null,
                conta_corrente: conta || null,
                pix: pix || null,
                titular_doc: titular_doc || null,
                titular_nome: titular_nome || null,
                tipo_conta: tipo_conta || 'corrente',
                suframa: suframa || null,
                simples_nacional: simples_nacional ? 1 : 0,
                produtor_rural: produtor_rural ? 1 : 0,
                tipo_atividade: tipo_atividade || null,
                cnae: cnae || null,
                obs_internas: obs_internas || null,
                obs_detalhadas: obs_detalhadas || null,
                parcelas_padrao: parcelas_padrao || null,
                vendedor_padrao: vendedor_padrao || usuarioLogadoNome || null,
                email_nfe: email_nfe || null,
                transportadora: transportadora || null,
                codigo_receita: codigo_receita || null,
                bloquear_faturamento: bloquear_faturamento ? 1 : 0
            };

            const documentoDigits = String(cnpj || '').replace(/\D/g, '');
            if (documentoDigits) {
                const docConditions = [];
                const docParams = [];
                ['cnpj', 'cnpj_cpf', 'cpf'].forEach(field => {
                    if (availableColumns.has(field)) {
                        docConditions.push(`REPLACE(REPLACE(REPLACE(COALESCE(${field}, ''), '.', ''), '/', ''), '-', '') = ?`);
                        docParams.push(documentoDigits);
                    }
                });

                if (docConditions.length) {
                    const [clientesExistentes] = await pool.query(
                        `SELECT id FROM clientes WHERE ${docConditions.join(' OR ')} LIMIT 1`,
                        docParams
                    );

                    if (clientesExistentes.length) {
                        const updateFields = [];
                        const updateValues = [];
                        ['vendedor_id', 'usuario_id', 'user_id'].forEach(field => {
                            if (availableColumns.has(field) && usuarioLogadoId) {
                                updateFields.push(`${field} = ?`);
                                updateValues.push(usuarioLogadoId);
                            }
                        });
                        ['vendedor_responsavel', 'vendedor_proprietario'].forEach(field => {
                            if (availableColumns.has(field) && usuarioLogadoNome) {
                                updateFields.push(`${field} = ?`);
                                updateValues.push(usuarioLogadoNome);
                            }
                        });
                        if (availableColumns.has('incluido_por') && usuarioLogadoNome) {
                            updateFields.push(`incluido_por = COALESCE(NULLIF(incluido_por, ''), ?)`);
                            updateValues.push(usuarioLogadoNome);
                        }
                        if (availableColumns.has('created_by') && usuarioLogadoId) {
                            updateFields.push(`created_by = COALESCE(created_by, ?)`);
                            updateValues.push(usuarioLogadoId);
                        }

                        if (updateFields.length) {
                            updateValues.push(clientesExistentes[0].id);
                            await pool.query(`UPDATE clientes SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
                        }

                        return res.status(200).json({
                            message: 'Cliente já cadastrado e vinculado ao vendedor atual.',
                            id: clientesExistentes[0].id,
                            existente: true
                        });
                    }
                }
            }

            const insertColumns = [];
            const insertValues = [];
            const placeholders = [];

            Object.entries(payload).forEach(([field, value]) => {
                if (availableColumns.has(field)) {
                    insertColumns.push(field);
                    insertValues.push(value);
                    placeholders.push('?');
                }
            });

            const [result] = await pool.query(
                `INSERT INTO clientes (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
                insertValues
            );
            res.status(201).json({ message: 'Cliente cadastrado com sucesso!', id: result.insertId });
        } catch (error) {
            console.error('[VENDAS] Erro ao cadastrar cliente:', error.code, error.message);
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.status(500).json({ message: 'Tabela de clientes não encontrada. Execute as migrações do sistema.' });
            }
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'Já existe um cliente com este CNPJ/CPF cadastrado.' });
            }
            if (error.code === 'ER_NO_REFERENCED_ROW' || error.code === 'ER_NO_REFERENCED_ROW_2') {
                return res.status(400).json({ message: 'Empresa vinculada não encontrada. Verifique as configurações.' });
            }
            next(error);
        }
    });
    router.put('/clientes/:id', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;
            const body = req.body;

            // Se é apenas toggle de ativo, permitir sem exigir nome/empresa
            if (body.ativo !== undefined && Object.keys(body).length <= 2) {
                const [result] = await pool.query(
                    'UPDATE clientes SET ativo = ? WHERE id = ?',
                    [body.ativo ? 1 : 0, id]
                );
                if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
                return res.json({ message: `Cliente ${body.ativo ? 'ativado' : 'inativado'} com sucesso.` });
            }

            // Field aliasing — frontend may send razao_social/cnpj_cpf/ie/logradouro/número
            const nome = (body.nome || body.razao_social || '').trim();
            const cnpj = body.cnpj || body.cnpj_cpf || null;
            const endereco = body.endereco || body.logradouro || null;
            const numero = body.numero || body.número || null;
            const inscricao_estadual = body.inscricao_estadual || body.ie || null;
            const contato = body.contato || body.contato_nome || null;
            const { nome_fantasia, telefone, celular, email, website,
                    complemento, bairro, cidade, uf, cep,
                    inscricao_municipal, limite_credito, empresa_id,
                    contato_nome, contato_cargo, observacoes,
                    fax, ddd_fax, enviar_anexos, banco, agencia, conta, pix, titular_doc, titular_nome, tipo_conta,
                    suframa, simples_nacional, produtor_rural, tipo_atividade, cnae,
                    obs_internas, obs_detalhadas, parcelas_padrao, vendedor_padrao,
                    email_nfe, transportadora, codigo_receita, bloquear_faturamento } = body;

            if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' });

            const [cols] = await pool.query('SHOW COLUMNS FROM clientes');
            const availableColumns = new Set(cols.map(col => col.Field));

            const payload = {
                nome,
                nome_fantasia: nome_fantasia || null,
                razao_social: nome,
                cnpj: cnpj || null,
                cnpj_cpf: cnpj || null,
                contato: contato || null,
                nome_contato: contato_nome || contato || null,
                contato_cargo: contato_cargo || null,
                telefone: telefone || null,
                celular: celular || null,
                email: email || null,
                website: website || null,
                endereco: endereco || null,
                logradouro: endereco || null,
                numero: numero || null,
                complemento: complemento || null,
                bairro: bairro || null,
                cidade: cidade || null,
                estado: uf || null,
                uf: uf || null,
                cep: cep || null,
                inscricao_estadual: inscricao_estadual || null,
                ie: inscricao_estadual || null,
                inscricao_municipal: inscricao_municipal || null,
                credito_total: limite_credito ? parseFloat(limite_credito) : 0,
                ativo: body.ativo !== undefined ? (body.ativo ? 1 : 0) : 1,
                observacoes: observacoes || null,
                fax: fax || null,
                ddd_fax: ddd_fax || null,
                enviar_anexos: enviar_anexos !== undefined ? (enviar_anexos ? 1 : 0) : 1,
                banco: banco || null,
                agencia: agencia || null,
                conta: conta || null,
                conta_corrente: conta || null,
                pix: pix || null,
                titular_doc: titular_doc || null,
                titular_nome: titular_nome || null,
                tipo_conta: tipo_conta || 'corrente',
                suframa: suframa || null,
                simples_nacional: simples_nacional ? 1 : 0,
                produtor_rural: produtor_rural ? 1 : 0,
                tipo_atividade: tipo_atividade || null,
                cnae: cnae || null,
                obs_internas: obs_internas || null,
                obs_detalhadas: obs_detalhadas || null,
                parcelas_padrao: parcelas_padrao || null,
                vendedor_padrao: vendedor_padrao || null,
                email_nfe: email_nfe || null,
                transportadora: transportadora || null,
                codigo_receita: codigo_receita || null,
                bloquear_faturamento: bloquear_faturamento ? 1 : 0
            };

            // Só incluir empresa_id se tiver valor válido (coluna NOT NULL)
            const empresaIdUpdate = empresa_id || req.user?.empresa_id;
            if (empresaIdUpdate) {
                payload.empresa_id = empresaIdUpdate;
            }

            const fields = [];
            const values = [];
            Object.entries(payload).forEach(([field, value]) => {
                if (availableColumns.has(field)) {
                    fields.push(`${field} = ?`);
                    values.push(value);
                }
            });
            values.push(id);

            const [result] = await pool.query(
                `UPDATE clientes SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
            res.json({ message: 'Cliente atualizado com sucesso.' });
        } catch (error) {
            console.error('[VENDAS] Erro ao atualizar cliente:', error.code, error.message);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'Já existe um cliente com este CNPJ/CPF cadastrado.' });
            }
            if (error.code === 'ER_NO_REFERENCED_ROW' || error.code === 'ER_NO_REFERENCED_ROW_2') {
                return res.status(400).json({ message: 'Empresa vinculada não encontrada. Verifique as configurações.' });
            }
            next(error);
        }
    });
    router.delete('/clientes/:id', authenticateToken, authorizeAdmin, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { id } = req.params;

            // Verificar se cliente existe
            const [cliente] = await connection.query('SELECT id, nome FROM clientes WHERE id = ?', [id]);
            if (cliente.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Cliente não encontrado.' });
            }

            // Verificar pedidos vinculados
            const [pedidos] = await connection.query('SELECT COUNT(*) as count FROM pedidos WHERE cliente_id = ?', [id]);
            if (pedidos[0].count > 0) {
                await connection.rollback();
                return res.status(400).json({
                    message: `Cliente possui ${pedidos[0].count} pedido(s) vinculado(s). Inative-o em vez de excluir.`
                });
            }

            // Verificar contas a receber vinculadas
            const [contas] = await connection.query('SELECT COUNT(*) as count FROM contas_receber WHERE cliente_id = ?', [id]);
            if (contas[0].count > 0) {
                await connection.rollback();
                return res.status(400).json({
                    message: `Cliente possui ${contas[0].count} conta(s) a receber vinculada(s).`
                });
            }

            // Excluir interações do cliente
            await connection.query('DELETE FROM cliente_interacoes WHERE cliente_id = ?', [id]);

            // Excluir cliente
            const [result] = await connection.query('DELETE FROM clientes WHERE id = ?', [id]);

            await connection.commit();

            console.log(`🗑️ Cliente #${id} (${cliente[0].nome}) excluído com sucesso por usuário ${req.user?.id}`);
            res.status(204).send();
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });
    router.post('/clientes/:id/interacoes', async (req, res, next) => {
        try {
            const { id: cliente_id } = req.params;
            const { tipo, anotacao } = req.body;
            const { id: usuario_id } = req.user;
            if (!tipo || !anotacao) return res.status(400).json({ message: 'Tipo e anotação são obrigatórios.' });
            await pool.query(
                'INSERT INTO cliente_interacoes (cliente_id, usuario_id, tipo, anotacao) VALUES (?, ?, ?, ?)',
                [cliente_id, usuario_id, tipo, anotacao]
            );
            res.status(201).json({ message: 'Interação registrada com sucesso!' });
        } catch (error) { next(error); }
    });

    // METAS, COMISSÕES E RELATÓRIOS (ADMIN)
    router.get('/metas', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const [tables] = await pool.query("SHOW TABLES LIKE 'metas_vendas'");
            if (tables.length === 0) return res.json([]);
            const periodo = req.query.periodo;
            const params = [];
            let where = 'WHERE (m.ativo = 1 OR m.ativo IS NULL)';
            if (periodo) { where += ' AND m.periodo = ?'; params.push(periodo); }
            const [rows] = await pool.query(
                `SELECT m.*, u.nome AS vendedor_nome FROM metas_vendas m LEFT JOIN usuarios u ON m.vendedor_id = u.id ${where} ORDER BY m.periodo DESC, m.vendedor_id`,
                params
            );
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/metas', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { vendedor_id, periodo, tipo, valor_meta } = req.body;
            await pool.query('INSERT INTO metas_vendas (vendedor_id, periodo, tipo, valor_meta) VALUES (?, ?, ?, ?)', [vendedor_id || null, periodo, tipo, valor_meta]);
            res.status(201).json({ message: 'Meta criada com sucesso!' });
        } catch (error) { next(error); }
    });
    router.put('/metas/:id', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            // AUDIT-FIX R3: Comercial só pode editar metas do próprio vendedor
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
            if (!isAdmin) {
                const [metaCheck] = await pool.query('SELECT vendedor_id FROM metas_vendas WHERE id = ?', [req.params.id]);
                if (!metaCheck.length) return res.status(404).json({ error: 'Meta não encontrada' });
                if (metaCheck[0].vendedor_id !== user.id) return res.status(403).json({ error: 'Acesso negado' });
            }
            const { vendedor_id, periodo, tipo, valor_meta } = req.body;
            await pool.query('UPDATE metas_vendas SET vendedor_id=?, periodo=?, tipo=?, valor_meta=? WHERE id=?', [vendedor_id || null, periodo, tipo, valor_meta, req.params.id]);
            res.json({ message: 'Meta atualizada com sucesso!' });
        } catch (error) { next(error); }
    });
    router.delete('/metas/:id', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            // AUDIT-FIX R3: Comercial só pode excluir metas do próprio vendedor
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
            if (!isAdmin) {
                const [metaCheck] = await pool.query('SELECT vendedor_id FROM metas_vendas WHERE id = ?', [req.params.id]);
                if (!metaCheck.length) return res.status(404).json({ error: 'Meta não encontrada' });
                if (metaCheck[0].vendedor_id !== user.id) return res.status(403).json({ error: 'Acesso negado' });
            }
            // AUDIT-FIX R3: Soft delete (SET ativo = 0) em vez de DELETE
            await pool.query('UPDATE metas_vendas SET ativo = 0 WHERE id=?', [req.params.id]);
            res.json({ message: 'Meta excluída com sucesso!' });
        } catch (error) { next(error); }
    });
    router.get('/metas/progresso', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const periodo = req.query.periodo || new Date().toISOString().substring(0, 7);
            const [progresso] = await pool.query(`
                SELECT m.id AS meta_id, m.periodo, m.tipo, m.vendedor_id, m.valor_meta,
                       COALESCE(SUM(p.valor), 0) AS totalVendido
                FROM metas_vendas m
                LEFT JOIN pedidos p ON p.status IN ('faturado', 'recibo')
                    AND DATE_FORMAT(p.created_at, '%Y-%m') = m.periodo
                    AND (m.vendedor_id IS NULL OR p.vendedor_id = m.vendedor_id)
                WHERE m.periodo = ?
                  AND (m.ativo = 1 OR m.ativo IS NULL)
                GROUP BY m.id, m.periodo, m.tipo, m.vendedor_id, m.valor_meta
            `, [periodo]);
            res.json(progresso);
        } catch (error) { next(error); }
    });

    // Ranking de vendedores com metas
    router.get('/metas/ranking', async (req, res, next) => {
        try {
            const periodo = req.query.periodo || new Date().toISOString().substring(0, 7);

            // Verificar se tabela metas_vendas existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'metas_vendas'");

            let rows = [];
            if (tables.length > 0) {
                [rows] = await pool.query(`
                    SELECT
                        u.id, u.nome, u.email,
                        COALESCE(f.foto_perfil_url, u.foto, u.avatar) as foto,
                        COALESCE(m.valor_meta, 0) as valor_meta,
                        COALESCE((SELECT SUM(valor) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as valor_realizado,
                        COALESCE((SELECT COUNT(*) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as qtd_vendas
                    FROM usuarios u
                    LEFT JOIN metas_vendas m ON u.id = m.vendedor_id AND m.periodo = ?
                    LEFT JOIN funcionarios f ON f.email = u.email
                    WHERE (u.departamento = 'Comercial' OR u.departamento = 'Vendas' OR u.role = 'comercial')
                      AND (u.ativo = 1 OR u.ativo IS NULL)
                      AND (f.id IS NULL OR f.status != 'Demitido')
                    ORDER BY valor_realizado DESC
                `, [periodo, periodo, periodo]);
            } else {
                // Fallback sem tabela de metas
                [rows] = await pool.query(`
                    SELECT
                        u.id, u.nome, u.email,
                        COALESCE(f.foto_perfil_url, u.foto, u.avatar) as foto,
                        0 as valor_meta,
                        COALESCE((SELECT SUM(valor) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as valor_realizado,
                        COALESCE((SELECT COUNT(*) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as qtd_vendas
                    FROM usuarios u
                    LEFT JOIN funcionarios f ON f.email = u.email
                    WHERE (u.departamento = 'Comercial' OR u.departamento = 'Vendas' OR u.role = 'comercial')
                      AND (u.ativo = 1 OR u.ativo IS NULL)
                      AND (f.id IS NULL OR f.status != 'Demitido')
                    ORDER BY valor_realizado DESC
                `, [periodo, periodo]);
            }

            const ranking = rows.map((r, index) => ({
                ...r,
                posicao: index + 1,
                percentual_atingido: r.valor_meta > 0 ? ((r.valor_realizado / r.valor_meta) * 100).toFixed(2) : 0,
                status_meta: r.valor_realizado >= r.valor_meta && r.valor_meta > 0 ? 'atingida' :
                             r.valor_realizado >= r.valor_meta * 0.8 && r.valor_meta > 0 ? 'proxima' : 'pendente'
            }));

            res.json({ periodo, ranking });
        } catch (error) {
            console.error('Erro ao buscar ranking:', error);
            res.json({ periodo: req.query.periodo, ranking: [] });
        }
    });

    // --- ROTAS DE COMISSÕES - CONFIGURAÇÃO ---

    // Configuração de comissões por vendedor
    router.get('/comissoes/configuracao', async (req, res, next) => {
        try {
            const [vendedores] = await pool.query(`
                SELECT
                    u.id, u.nome, u.email,
                    COALESCE(u.comissao_percentual, 1.0) as comissao_percentual,
                    COALESCE(u.comissao_tipo, 'percentual') as comissao_tipo
                FROM usuarios u
                LEFT JOIN departamentos d ON u.departamento_id = d.id
                WHERE d.nome = 'Comercial' AND u.status = 'ativo'
                ORDER BY u.nome
            `);

            res.json(vendedores);
        } catch (error) {
            next(error);
        }
    });

    // Atualizar configuração de comissão de vendedor (Apenas Andreia e Antonio T.I.)
    router.put('/comissoes/configuracao/:vendedorId', async (req, res, next) => {
        try {
            const user = req.user;
            const username = (user.email || '').split('@')[0].toLowerCase();
            const USERS_PERMITIDOS_COMISSAO = ['andreia', 'antonio', 'ti', 'tialuforce'];
            const podeAlterarComissao = USERS_PERMITIDOS_COMISSAO.includes(username);
            if (!podeAlterarComissao) {
                return res.status(403).json({ message: 'Apenas Andreia e Antonio (T.I.) podem alterar comissões.' });
            }

            const { vendedorId } = req.params;
            const { comissao_percentual } = req.body;

            try {
                await pool.query(
                    'UPDATE usuarios SET comissao_percentual = ? WHERE id = ?',
                    [parseFloat(comissao_percentual) || 1.0, vendedorId]
                );
            } catch (e) {
                await pool.query('ALTER TABLE usuarios ADD COLUMN comissao_percentual DECIMAL(5,2) DEFAULT 1.0');
                await pool.query(
                    'UPDATE usuarios SET comissao_percentual = ? WHERE id = ?',
                    [parseFloat(comissao_percentual) || 1.0, vendedorId]
                );
            }

            res.json({ message: 'Comissão atualizada com sucesso' });
        } catch (error) {
            next(error);
        }
    });

    router.get('/comissoes', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { periodo, vendedor_id } = req.query;
            const periodoAtual = periodo || new Date().toISOString().substring(0, 7);

            // Verificar se usuário é admin de comissões
            const ADMINS_COMISSAO_DET = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
            const currentUser = req.user;
            const usernameDet = (currentUser.email || '').split('@')[0].toLowerCase();
            const isAdminDet = currentUser.is_admin === 1 || currentUser.role === 'admin' || ADMINS_COMISSAO_DET.includes(usernameDet);

            let whereExtra = '';
            let params = [periodoAtual];

            if (!isAdminDet) {
                whereExtra = ' AND p.vendedor_id = ?';
                params.push(currentUser.id);
            } else if (vendedor_id) {
                whereExtra = ' AND p.vendedor_id = ?';
                params.push(vendedor_id);
            }

            const [rows] = await pool.query(`
                SELECT p.id AS pedido_id, p.numero_pedido, p.valor, p.status, p.created_at,
                       u.id AS vendedor_id, u.nome AS vendedor_nome, u.email AS vendedor_email,
                       COALESCE(u.comissao_percentual, 1.0) AS comissao_percentual,
                       (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) AS valor_comissao,
                       c.razao_social AS cliente_nome
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.status NOT IN ('cancelado')
                  AND DATE_FORMAT(p.created_at, '%Y-%m') = ?${whereExtra}
                ORDER BY p.created_at DESC
            `, params);
            res.json(rows);
        } catch (error) { next(error); }
    });

    // Resumo de comissões por vendedor
    router.get('/comissoes/resumo', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { periodo, vendedor_id } = req.query;
            const periodoAtual = periodo || new Date().toISOString().substring(0, 7);

            // Verificar se usuário é admin (pode ver todas as comissões)
            const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
            const currentUser = req.user;
            const username = (currentUser.email || '').split('@')[0].toLowerCase();
            const isAdminComissao = currentUser.is_admin === 1 || currentUser.role === 'admin' || ADMINS_COMISSAO.includes(username);

            // Se não é admin de comissões, filtrar apenas a própria comissão
            let whereExtra = '';
            let queryParams = [periodoAtual];

            if (!isAdminComissao) {
                // Vendedor/supervisor vê apenas a própria comissão
                whereExtra = ' AND u.id = ?';
                queryParams.push(currentUser.id);
            } else if (vendedor_id) {
                // Admin filtrando por vendedor específico
                whereExtra = ' AND u.id = ?';
                queryParams.push(vendedor_id);
            }

            const [rows] = await pool.query(`
                SELECT
                    u.id as vendedor_id,
                    u.nome as vendedor_nome,
                    u.email,
                    COALESCE(u.comissao_percentual, 1.0) as percentual_comissao,
                    COUNT(CASE WHEN p.status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturados,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_faturado,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao_faturada,
                    COUNT(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN 1 END) as qtd_pendentes,
                    COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_pendente,
                    COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao_pendente
                FROM usuarios u
                LEFT JOIN pedidos p ON u.id = p.vendedor_id AND DATE_FORMAT(p.created_at, '%Y-%m') = ?
                WHERE (u.role IN ('comercial', 'vendedor') OR u.departamento IN ('Comercial', 'Vendas')) AND u.status = 'ativo'${whereExtra}
                GROUP BY u.id, u.nome, u.email, u.comissao_percentual
                ORDER BY comissao_faturada DESC
            `, queryParams);

            const totais = {
                total_faturado: rows.reduce((sum, r) => sum + parseFloat(r.valor_faturado || 0), 0),
                total_comissao_faturada: rows.reduce((sum, r) => sum + parseFloat(r.comissao_faturada || 0), 0),
                total_pendente: rows.reduce((sum, r) => sum + parseFloat(r.valor_pendente || 0), 0),
                total_comissao_pendente: rows.reduce((sum, r) => sum + parseFloat(r.comissao_pendente || 0), 0)
            };

            res.json({ periodo: periodoAtual, vendedores: rows, totais });
        } catch (error) { next(error); }
    });

    // Histórico de comissões pagas
    router.get('/comissoes/historico', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { vendedor_id, ano } = req.query;
            const anoAtual = ano || new Date().getFullYear();

            // Verificar se usuário é admin de comissões
            const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
            const currentUser = req.user;
            const usernameH = (currentUser.email || '').split('@')[0].toLowerCase();
            const isAdminComissaoH = currentUser.is_admin === 1 || currentUser.role === 'admin' || ADMINS_COMISSAO.includes(usernameH);

            let query = `
                SELECT
                    DATE_FORMAT(p.created_at, '%Y-%m') as periodo,
                    u.id as vendedor_id,
                    u.nome as vendedor_nome,
                    COUNT(*) as qtd_vendas,
                    SUM(p.valor) as valor_total,
                    SUM(p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) as comissao_total
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.status IN ('faturado', 'recibo')
                AND YEAR(p.created_at) = ?
            `;
            const params = [anoAtual];

            if (!isAdminComissaoH) {
                // Não-admin vê apenas o próprio histórico
                query += ' AND p.vendedor_id = ?';
                params.push(currentUser.id);
            } else if (vendedor_id) {
                query += ' AND p.vendedor_id = ?';
                params.push(vendedor_id);
            }

            query += ' GROUP BY DATE_FORMAT(p.created_at, "%Y-%m"), u.id, u.nome ORDER BY periodo DESC, u.nome';

            const [rows] = await pool.query(query, params);

            res.json(rows);
        } catch (error) { next(error); }
    });

    // Exportar comissões em CSV
    router.get('/comissoes/exportar', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { periodo } = req.query;
            const periodoAtual = periodo || new Date().toISOString().substring(0, 7);

            const [rows] = await pool.query(`
                SELECT
                    u.nome as vendedor,
                    u.email,
                    COALESCE(u.comissao_percentual, 1.0) as percentual,
                    COUNT(CASE WHEN p.status IN ('faturado', 'recibo') THEN 1 END) as vendas_faturadas,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_faturado,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao
                FROM usuarios u
                LEFT JOIN pedidos p ON u.id = p.vendedor_id AND DATE_FORMAT(p.created_at, '%Y-%m') = ?
                WHERE (u.role IN ('comercial', 'vendedor') OR u.departamento IN ('Comercial', 'Vendas')) AND u.status = 'ativo'
                GROUP BY u.id, u.nome, u.email, u.comissao_percentual
                ORDER BY u.nome
            `, [periodoAtual]);

            const header = 'Vendedor;Email;Percentual;Vendas Faturadas;Valor Faturado;Comissao\n';
            const csvRows = rows.map(r =>
                `${r.vendedor};${r.email};${r.percentual}%;${r.vendas_faturadas};${parseFloat(r.valor_faturado).toFixed(2)};${parseFloat(r.comissao).toFixed(2)}`
            ).join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="comissoes-${periodoAtual}.csv"`);
            res.send('\uFEFF' + header + csvRows);
        } catch (error) { next(error); }
    });

    router.get('/relatorios/vendas', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { inicio, fim, vendedor_id } = req.query;
            let where = 'p.created_at >= ? AND p.created_at <= ?';
            let params = [inicio, fim];
            if (vendedor_id) {
                where += ' AND p.vendedor_id = ?';
                params.push(vendedor_id);
            }
            const [rows] = await pool.query(`
                SELECT p.id, p.valor, p.status, p.created_at, u.nome AS vendedor_nome, e.nome_fantasia AS empresa_nome
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                WHERE ${where}
                ORDER BY p.created_at DESC
            `, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/relatorios/funil', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { inicio, fim } = req.query;
            const [rows] = await pool.query(`
                SELECT status, COUNT(*) AS total
                FROM pedidos
                WHERE created_at >= ? AND created_at <= ?
                GROUP BY status
            `, [inicio, fim]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    // Alias para dashboard-stats
    router.get('/dashboard', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const [faturadoResult] = await pool.query(`SELECT COALESCE(SUM(valor), 0) AS totalFaturadoMes FROM pedidos WHERE status IN ('faturado', 'recibo') AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            const [pendentesResult] = await pool.query(`SELECT COUNT(*) AS pedidosPendentes FROM pedidos WHERE status IN ('orcamento', 'analise', 'aprovado')`);
            const [clientesResult] = await pool.query(`SELECT COUNT(*) AS novosClientesMes FROM empresas WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            res.json({
                totalFaturadoMes: faturadoResult[0].totalFaturadoMes,
                pedidosPendentes: pendentesResult[0].pedidosPendentes,
                novosClientesMes: clientesResult[0].novosClientesMes
            });
        } catch (error) { next(error); }
    });
    router.get('/dashboard-stats', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const [faturadoResult] = await pool.query(`SELECT COALESCE(SUM(valor), 0) AS totalFaturadoMes FROM pedidos WHERE status IN ('faturado', 'recibo') AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            const [pendentesResult] = await pool.query(`SELECT COUNT(*) AS pedidosPendentes FROM pedidos WHERE status IN ('orcamento', 'analise', 'aprovado')`);
            const [clientesResult] = await pool.query(`SELECT COUNT(*) AS novosClientesMes FROM empresas WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            res.json({
                totalFaturadoMes: faturadoResult[0].totalFaturadoMes,
                pedidosPendentes: pendentesResult[0].pedidosPendentes,
                novosClientesMes: clientesResult[0].novosClientesMes
            });
        } catch (error) { next(error); }
    });

    // Helper: criar tabela de itens se não existir
    // AUDIT-FIX DB-005: Added FOREIGN KEY on pedido_id
    async function ensurePedidoItensTable() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedido_itens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                codigo VARCHAR(100),
                descricao TEXT,
                quantidade DECIMAL(15,3) DEFAULT 1,
                quantidade_parcial DECIMAL(15,3) DEFAULT 0,
                unidade VARCHAR(20) DEFAULT 'UN',
                local_estoque VARCHAR(255) DEFAULT 'PADRAO - Local de Estoque Padrão',
                preco_unitario DECIMAL(18,2) DEFAULT 0,
                desconto DECIMAL(18,2) DEFAULT 0,
                total DECIMAL(18,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pedido_id (pedido_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        // AUDIT-FIX DB-005: Try to add FK if missing (safe — ignores if exists)
        try {
            await pool.query(`ALTER TABLE pedido_itens ADD CONSTRAINT fk_pedido_itens_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE`);
        } catch(e) { /* FK already exists or table mismatch — safe to ignore */ }

        // Adicionar colunas de impostos se não existirem
        const colunasExtras = [
            { nome: 'produto_id', tipo: 'INT DEFAULT NULL' },
            { nome: 'valor_ipi', tipo: 'DECIMAL(18,2) DEFAULT 0' },
            { nome: 'valor_icms_st', tipo: 'DECIMAL(18,2) DEFAULT 0' },
            { nome: 'aliquota_ipi', tipo: 'DECIMAL(10,2) DEFAULT 0' },
            { nome: 'aliquota_icms', tipo: 'DECIMAL(10,2) DEFAULT 0' },
            { nome: 'mva_st', tipo: 'DECIMAL(10,2) DEFAULT 0' },
            { nome: 'subtotal', tipo: 'DECIMAL(18,2) DEFAULT 0' },
            { nome: 'cfop', tipo: 'VARCHAR(20) DEFAULT NULL' },
            { nome: 'cenario_fiscal', tipo: 'VARCHAR(100) DEFAULT NULL' },
            { nome: 'observacoes', tipo: 'TEXT DEFAULT NULL' }
        ];
        for (const col of colunasExtras) {
            try {
                await pool.query(`ALTER TABLE pedido_itens ADD COLUMN ${col.nome} ${col.tipo}`);
            } catch(e) { /* Column already exists — safe to ignore */ }
        }
    }

    // AUDIT-FIX DB-008: audit_trail now consolidated into auditoria_logs (see writeAuditLog helper)
    // Legacy ensureAuditTrailTable kept for backward compatibility with existing data
    async function ensureAuditTrailTable() {
        // No longer needed — auditoria_logs is created at startup
        // Keeping function stub so existing callers don't break
    }

    // Call audit trail table creation on startup (no-op, using auditoria_logs instead)
    ensureAuditTrailTable().catch(e => console.log('[AUDIT] Tabela audit_trail init:', e.message));

    // ====================================================
    // Histórico de pedidos por cliente
    // ====================================================
    router.get('/clientes/:clienteId/historico', async (req, res, next) => {
        try {
            const { clienteId } = req.params;
            const nomeCliente = req.query.nome || '';

            let query = `SELECT p.id, p.cliente, p.cliente_nome, p.status, p.valor,
                         COALESCE(p.vendedor_nome, '') as vendedor, p.nf, p.parcelas,
                         p.created_at as data_criacao, p.updated_at as data_atualizacao, p.desconto_pct,
                         (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = p.id) as total_itens
                         FROM pedidos p WHERE `;
            let params = [];

            if (clienteId && clienteId !== '0' && clienteId !== 'null' && clienteId !== 'undefined') {
                query += `p.cliente_id = ? `;
                params = [clienteId];
            } else if (nomeCliente) {
                query += `(p.cliente LIKE ? OR p.cliente_nome LIKE ?) `;
                params = [`%${nomeCliente}%`, `%${nomeCliente}%`];
            } else {
                return res.json({ pedidos: [], total: 0, totalValor: 0 });
            }

            query += `ORDER BY p.created_at DESC LIMIT 100`;

            const [pedidos] = await pool.query(query, params);

            // Calcular totais
            const totalValor = pedidos.reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0);
            const statusCount = {};
            pedidos.forEach(p => {
                const st = p.status || 'Sem status';
                statusCount[st] = (statusCount[st] || 0) + 1;
            });

            // Map pedidos to historico format expected by frontend
            const historico = pedidos.map(p => ({
                data_alteracao: p.data_criacao,
                descricao: `Pedido #${p.id} — ${p.status || 'orçamento'} — R$ ${(parseFloat(p.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                usuario: p.vendedor || 'Sistema',
                tipo: 'pedido'
            }));

            res.json({
                historico,
                pedidos,
                total: pedidos.length,
                totalValor,
                statusCount
            });
        } catch (error) {
            console.error('[VENDAS] Erro ao buscar histórico do cliente:', error);
            next(error);
        }
    });

    // Itens do pedido - Listar
    router.get('/pedidos/:id/itens', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { id } = req.params;
            if (!id || id === 'null' || id === 'undefined' || !Number.isFinite(Number(id))) {
                return res.status(400).json({ error: 'ID do pedido inválido' });
            }
            const [itens] = await pool.query(
                `SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque,
                 preco_unitario, desconto, subtotal, produto_id, valor_ipi, valor_icms_st,
                 aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, nao_gerar_saida_estoque
                 FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC`,
                [id]
            );

            // Auto-repair: fill NULL/VLOOKUP codigo/descricao from produto_id or codigo lookup
            for (const item of itens) {
                const descInvalid = !item.descricao || item.descricao.includes('VLOOKUP') || item.descricao.includes('vlookup');
                if (descInvalid || !item.codigo) {
                    try {
                        let prods = [];
                        // Tentar por produto_id primeiro
                        if (item.produto_id) {
                            const [rows] = await pool.query("SELECT codigo, COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao FROM produtos WHERE id = ?", [item.produto_id]);
                            prods = rows;
                        }
                        // Se não achou por produto_id, tentar pelo código
                        if (prods.length === 0 && item.codigo) {
                            const [rows] = await pool.query("SELECT codigo, COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao FROM produtos WHERE codigo = ? LIMIT 1", [item.codigo]);
                            prods = rows;
                        }
                        if (prods.length > 0 && prods[0].descricao && !prods[0].descricao.includes('VLOOKUP')) {
                            if (!item.codigo && prods[0].codigo) item.codigo = prods[0].codigo;
                            if (descInvalid && prods[0].descricao) {
                                item.descricao = prods[0].descricao;
                                await pool.query("UPDATE pedido_itens SET descricao = ? WHERE id = ?", [prods[0].descricao, item.id]);
                            }
                            if (!item.codigo) {
                                await pool.query("UPDATE pedido_itens SET codigo = COALESCE(NULLIF(codigo,''), ?) WHERE id = ?", [prods[0].codigo || '', item.id]);
                            }
                        }
                    } catch (e) { /* non-blocking */ }
                }
            }

            res.json(itens);
        } catch (error) {
            if (error && error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            next(error);
        }
    });

    // Itens do pedido - Adicionar
    router.post('/pedidos/:id/itens', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { id } = req.params;
            if (!id || id === 'null' || id === 'undefined' || !Number.isFinite(Number(id))) {
                return res.status(400).json({ error: 'ID do pedido inválido' });
            }

            // Lock: verificar status do pedido antes de permitir adicionar item
            const [[pedidoStatusCheck]] = await pool.query('SELECT status FROM pedidos WHERE id = ?', [parseInt(id)]);
            if (pedidoStatusCheck && STATUS_BLOQUEADO_EDICAO.includes((pedidoStatusCheck.status || '').toLowerCase())) {
                const userEmail = (req.user && req.user.email || '').toLowerCase();
                if (userEmail !== EMAIL_EDICAO_LIBERADO) {
                    return res.status(403).json({ message: `Pedido com status "${pedidoStatusCheck.status}" não pode ser editado. Somente TI pode adicionar itens neste status.`, code: 'EDIT_LOCKED_BY_STATUS' });
                }
            }

            const b = req.body;
            // Accept both accented and unaccented keys from frontend
            const codigo = b.codigo || b['código'] || '';
            const descricao = b.descricao || b['descrição'] || '';
            const { quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto,
                    produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo,
                    nao_gerar_saida_estoque } = b;

            if (!codigo || !descricao) {
                return res.status(400).json({ message: 'Código e descrição são obrigatórios.' });
            }

            const qty = parseFloat(quantidade) || 1;
            // BUG-VEND-011: quantidade deve ser > 0 (valor negativo gerava total negativo)
            if (!(qty > 0)) {
                return res.status(400).json({ message: 'Quantidade do item deve ser maior que zero.' });
            }
            const qtyParcial = parseFloat(quantidade_parcial) || 0;
            const preco = parseFloat(preco_unitario) || 0;
            if (preco < 0) {
                return res.status(400).json({ message: 'Preço do item não pode ser negativo.' });
            }
            const desc = parseFloat(desconto) || 0;
            let vIPI = parseFloat(valor_ipi) || 0;
            let vICMSST = parseFloat(valor_icms_st) || 0;
            let aliqIPI = parseFloat(aliquota_ipi) || 0;
            let aliqICMS_local = parseFloat(aliquota_icms) || 0;
            let mvaST_local = parseFloat(mva_st) || 0;
            const total = (qty * preco) - desc;

            // Sprint 4.6: Auto-calcular impostos a partir dos dados fiscais do produto
            if (vIPI === 0 && vICMSST === 0 && (produto_id || codigo)) {
                try {
                    let produtoFiscal = null;
                    if (produto_id) {
                        const [pf] = await pool.query(
                            'SELECT aliquota_ipi, calcular_ipi, aliquota_icms, calcular_icms_st, mva_st FROM produtos WHERE id = ?', [produto_id]
                        );
                        if (pf.length > 0) produtoFiscal = pf[0];
                    }
                    if (!produtoFiscal && codigo) {
                        const [pf] = await pool.query(
                            'SELECT aliquota_ipi, calcular_ipi, aliquota_icms, calcular_icms_st, mva_st FROM produtos WHERE codigo = ?', [codigo]
                        );
                        if (pf.length > 0) produtoFiscal = pf[0];
                    }
                    if (produtoFiscal) {
                        aliqIPI = parseFloat(produtoFiscal.aliquota_ipi) || 0;
                        if (aliqIPI > 0) {
                            vIPI = total * (aliqIPI / 100);
                        }
                        const calcST = parseInt(produtoFiscal.calcular_icms_st) || 0;
                        mvaST_local = parseFloat(produtoFiscal.mva_st) || 0;
                        aliqICMS_local = parseFloat(produtoFiscal.aliquota_icms) || 0;
                        if (calcST && mvaST_local > 0 && aliqICMS_local > 0) {
                            const baseICMSST = total * (1 + mvaST_local / 100);
                            vICMSST = Math.max(0, (baseICMSST * aliqICMS_local / 100) - (total * aliqICMS_local / 100));
                        }
                        if (vIPI > 0 || vICMSST > 0) {
                            console.log(`[Sprint 4.6] Auto-cálculo fiscal item ${codigo}: IPI=${vIPI.toFixed(2)} ICMS-ST=${vICMSST.toFixed(2)}`);
                        }
                    }
                } catch (fiscalErr) {
                    console.error(`[Sprint 4.6] Erro auto-cálculo fiscal (não-bloqueante):`, fiscalErr.message);
                }
            }

            const [result] = await pool.query(
                `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque,
                 preco_unitario, desconto, subtotal, produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo, nao_gerar_saida_estoque)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, codigo, descricao, qty, qtyParcial, unidade || 'UN', local_estoque || 'PADRAO - Local de Estoque Padrão',
                 preco, desc, total, produto_id || null, vIPI, vICMSST,
                 aliqIPI, aliqICMS_local, mvaST_local,
                 cfop || null, cenario_fiscal || null, observacoes || null, parseFloat(preco_custo) || 0,
                 nao_gerar_saida_estoque ? 1 : 0]
            );

            // Recalcular totais de impostos e valor do pedido
            const [totaisImpostos] = await pool.query(
                'SELECT COALESCE(SUM(valor_ipi), 0) as total_ipi, COALESCE(SUM(valor_icms_st), 0) as total_icms_st, COALESCE(SUM(subtotal), 0) as total_subtotais FROM pedido_itens WHERE pedido_id = ?',
                [id]
            );
            const [pedidoFrete] = await pool.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [id]);
            const novoValor = parseFloat(totaisImpostos[0].total_subtotais) + parseFloat(totaisImpostos[0].total_ipi) + parseFloat(totaisImpostos[0].total_icms_st) + parseFloat(pedidoFrete[0]?.frete || 0);
            await pool.query('UPDATE pedidos SET total_ipi = ?, total_icms_st = ?, valor = ? WHERE id = ?',
                [totaisImpostos[0].total_ipi, totaisImpostos[0].total_icms_st, novoValor, id]);

            console.log(`📦 Item adicionado ao pedido #${id}. Novo valor: R$${novoValor.toFixed(2)} (subtotais: ${totaisImpostos[0].total_subtotais}, IPI: ${totaisImpostos[0].total_ipi}, ICMS ST: ${totaisImpostos[0].total_icms_st}, frete: ${pedidoFrete[0]?.frete || 0})`);
            res.status(201).json({ message: 'Item adicionado com sucesso!', id: result.insertId });
        } catch (error) {
            next(error);
        }
    });

    // Itens do pedido - Atualizar
    router.put('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { pedidoId, itemId } = req.params;
            if (!pedidoId || pedidoId === 'null' || pedidoId === 'undefined' || !Number.isFinite(Number(pedidoId))) {
                return res.status(400).json({ error: 'ID do pedido inválido' });
            }
            if (!itemId || itemId === 'null' || itemId === 'undefined' || !Number.isFinite(Number(itemId))) {
                return res.status(400).json({ error: 'ID do item inválido' });
            }

            // Lock: verificar status do pedido antes de permitir edição de item
            const [[pedidoStatusCheck]] = await pool.query('SELECT status FROM pedidos WHERE id = ?', [parseInt(pedidoId)]);
            if (pedidoStatusCheck && STATUS_BLOQUEADO_EDICAO.includes((pedidoStatusCheck.status || '').toLowerCase())) {
                const userEmail = (req.user && req.user.email || '').toLowerCase();
                if (userEmail !== EMAIL_EDICAO_LIBERADO) {
                    return res.status(403).json({ message: `Pedido com status "${pedidoStatusCheck.status}" não pode ser editado. Somente TI pode editar itens neste status.`, code: 'EDIT_LOCKED_BY_STATUS' });
                }
            }

            // AUDIT-FIX R3: Ownership check — vendedor só edita itens de seus próprios pedidos
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
            if (!isAdmin) {
                const [ownerCheck] = await pool.query('SELECT vendedor_id FROM pedidos WHERE id = ?', [pedidoId]);
                if (!ownerCheck.length) return res.status(404).json({ error: 'Pedido não encontrado' });
                if (ownerCheck[0].vendedor_id !== user.id) return res.status(403).json({ error: 'Acesso negado' });
            }

            const b = req.body;
            // Accept both accented and unaccented keys from frontend
            const codigo = b.codigo || b['código'] || '';
            const descricao = b.descricao || b['descrição'] || '';
            const { quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto,
                    produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo,
                    nao_gerar_saida_estoque } = b;

            const qty = parseFloat(quantidade) || 1;
            // BUG-VEND-011: quantidade deve ser > 0 (valor negativo gerava total negativo)
            if (!(qty > 0)) {
                return res.status(400).json({ message: 'Quantidade do item deve ser maior que zero.' });
            }
            const qtyParcial = parseFloat(quantidade_parcial) || 0;
            const preco = parseFloat(preco_unitario) || 0;
            if (preco < 0) {
                return res.status(400).json({ message: 'Preço do item não pode ser negativo.' });
            }
            const desc = parseFloat(desconto) || 0;
            const vIPI = parseFloat(valor_ipi) || 0;
            const vICMSST = parseFloat(valor_icms_st) || 0;
            const total = (qty * preco) - desc;

            await pool.query(
                `UPDATE pedido_itens SET codigo = ?, descricao = ?, quantidade = ?, quantidade_parcial = ?, unidade = ?,
                 local_estoque = ?, preco_unitario = ?, desconto = ?, subtotal = ?,
                 produto_id = ?, valor_ipi = ?, valor_icms_st = ?, aliquota_ipi = ?, aliquota_icms = ?, mva_st = ?,
                 cfop = ?, cenario_fiscal = ?, observacoes = ?, preco_custo = ?, nao_gerar_saida_estoque = ? WHERE id = ? AND pedido_id = ?`,
                [codigo, descricao, qty, qtyParcial, unidade, local_estoque, preco, desc, total,
                 produto_id || null, vIPI, vICMSST, parseFloat(aliquota_ipi) || 0, parseFloat(aliquota_icms) || 0, parseFloat(mva_st) || 0,
                 cfop || null, cenario_fiscal || null, observacoes || null, parseFloat(preco_custo) || 0,
                 nao_gerar_saida_estoque ? 1 : 0, itemId, pedidoId]
            );

            // Recalcular totais de impostos e valor do pedido
            const [totaisImpostos] = await pool.query(
                'SELECT COALESCE(SUM(valor_ipi), 0) as total_ipi, COALESCE(SUM(valor_icms_st), 0) as total_icms_st, COALESCE(SUM(subtotal), 0) as total_subtotais FROM pedido_itens WHERE pedido_id = ?',
                [pedidoId]
            );
            const [pedidoFrete] = await pool.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [pedidoId]);
            const novoValor = parseFloat(totaisImpostos[0].total_subtotais) + parseFloat(totaisImpostos[0].total_ipi) + parseFloat(totaisImpostos[0].total_icms_st) + parseFloat(pedidoFrete[0]?.frete || 0);
            await pool.query('UPDATE pedidos SET total_ipi = ?, total_icms_st = ?, valor = ? WHERE id = ?',
                [totaisImpostos[0].total_ipi, totaisImpostos[0].total_icms_st, novoValor, pedidoId]);

            console.log(`📝 Item atualizado no pedido #${pedidoId}. Novo valor: R$${novoValor.toFixed(2)}`);
            res.json({ message: 'Item atualizado com sucesso!' });
        } catch (error) {
            next(error);
        }
    });

    // Itens do pedido - Buscar item específico (GET)
    router.get('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { pedidoId, itemId } = req.params;
            if (!pedidoId || pedidoId === 'null' || pedidoId === 'undefined' || !Number.isFinite(Number(pedidoId))) {
                return res.status(400).json({ error: 'ID do pedido inválido' });
            }
            if (!itemId || itemId === 'null' || itemId === 'undefined' || !Number.isFinite(Number(itemId))) {
                return res.status(400).json({ error: 'ID do item inválido' });
            }
            const [rows] = await pool.query(
                'SELECT * FROM pedido_itens WHERE id = ? AND pedido_id = ?',
                [itemId, pedidoId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ message: 'Item não encontrado.' });
            }

            res.json(rows[0]);
        } catch (error) {
            next(error);
        }
    });

    // Itens do pedido - Excluir
    // AUDIT-FIX: Added transaction + automatic pedido total recalculation after item delete
    router.delete('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await ensurePedidoItensTable();
            const { pedidoId, itemId } = req.params;

            // AUDIT-FIX R3: Ownership check — vendedor só exclui itens de seus próprios pedidos
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');

            // Lock: verificar status do pedido antes de permitir exclusão de item
            const [[pedidoStatusDel]] = await pool.query('SELECT status FROM pedidos WHERE id = ?', [parseInt(pedidoId)]);
            if (pedidoStatusDel && STATUS_BLOQUEADO_EDICAO.includes((pedidoStatusDel.status || '').toLowerCase())) {
                const userEmail = (user.email || '').toLowerCase();
                if (userEmail !== EMAIL_EDICAO_LIBERADO) {
                    connection.release();
                    return res.status(403).json({ message: `Pedido com status "${pedidoStatusDel.status}" não pode ser editado. Somente TI pode excluir itens neste status.`, code: 'EDIT_LOCKED_BY_STATUS' });
                }
            }

            if (!isAdmin) {
                const [ownerCheck] = await pool.query('SELECT vendedor_id FROM pedidos WHERE id = ?', [pedidoId]);
                if (!ownerCheck.length) { connection.release(); return res.status(404).json({ error: 'Pedido não encontrado' }); }
                if (ownerCheck[0].vendedor_id !== user.id) { connection.release(); return res.status(403).json({ error: 'Acesso negado' }); }
            }

            await connection.beginTransaction();

            // AUDIT-FIX 2026-04-03: Bloquear exclusão de item se pedido já faturado/parcial
            const [pedidoCheck] = await connection.query(
                'SELECT status FROM pedidos WHERE id = ? FOR UPDATE',
                [pedidoId]
            );
            if (pedidoCheck.length > 0 && ['faturado', 'parcial', 'entregue'].includes(pedidoCheck[0].status)) {
                await connection.rollback();
                return res.status(400).json({
                    message: `Não é possível excluir itens de um pedido com status '${pedidoCheck[0].status}'. Cancele o faturamento primeiro.`,
                    code: 'ITEM_DELETE_BLOCKED_BY_STATUS'
                });
            }

            // Delete the item
            const [deleteResult] = await connection.query(
                'DELETE FROM pedido_itens WHERE id = ? AND pedido_id = ?',
                [itemId, pedidoId]
            );

            if (deleteResult.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Item não encontrado.' });
            }

            // Recalcular totais (subtotais + impostos) dos itens restantes
            const [totals] = await connection.query(
                `SELECT COALESCE(SUM(subtotal), 0) as total_subtotais,
                        COALESCE(SUM(valor_ipi), 0) as total_ipi,
                        COALESCE(SUM(valor_icms_st), 0) as total_icms_st
                FROM pedido_itens WHERE pedido_id = ?`,
                [pedidoId]
            );

            const [pedidoFrete] = await connection.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [pedidoId]);
            const totalSubtotais = parseFloat(totals[0]?.total_subtotais) || 0;
            const totalIPI = parseFloat(totals[0]?.total_ipi) || 0;
            const totalICMSST = parseFloat(totals[0]?.total_icms_st) || 0;
            const frete = parseFloat(pedidoFrete[0]?.frete) || 0;
            const novoTotal = totalSubtotais + totalIPI + totalICMSST + frete;
            await connection.query(
                'UPDATE pedidos SET valor = ?, total_ipi = ?, total_icms_st = ? WHERE id = ?',
                [novoTotal, totalIPI, totalICMSST, pedidoId]
            );

            await connection.commit();

            console.log(`🗑️ Item #${itemId} excluído do pedido #${pedidoId}. Novo total: R$${novoTotal.toFixed(2)} (subtotais: ${totalSubtotais}, IPI: ${totalIPI}, ICMS ST: ${totalICMSST}, frete: ${frete})`);
            res.json({ message: 'Item excluído com sucesso!', novo_total: novoTotal });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });

    // Autocomplete de produtos - busca rápida para dropdown
    // Colunas reais da tabela: unidade_medida (não unidade), gtin (não ean),
    // localizacao (não local_estoque), status/ativo (não situacao), nome (não descricao para muitos produtos)
    router.get('/produtos/autocomplete/:termo?', async (req, res, next) => {
        try {
            const termo = req.params.termo || req.query.termo || req.query.q || '_';
            const limit = parseInt(req.query.limit) || 30;

            const [rows] = await pool.query(
                `SELECT id, codigo,
                        COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao,
                        COALESCE(nome, descricao, codigo) as nome,
                        COALESCE(unidade_medida, '') as unidade,
                        COALESCE(NULLIF(preco_venda, 0), NULLIF(preco, 0), preco_custo, 0) as preco_venda,
                        COALESCE(preco_custo, 0) as preco_custo,
                        COALESCE(estoque_atual, 0) as estoque_atual,
                        COALESCE(localizacao, '') as local_estoque,
                        COALESCE(gtin, '') as ean,
                        COALESCE(aliquota_ipi, 0) as aliquota_ipi,
                        COALESCE(calcular_ipi, 0) as calcular_ipi,
                        COALESCE(aliquota_icms, 0) as aliquota_icms,
                        COALESCE(calcular_icms_st, 0) as calcular_icms_st,
                        COALESCE(mva_st, 0) as mva_st,
                        COALESCE(ncm, '') as ncm
                 FROM produtos
                 WHERE (codigo LIKE ? OR COALESCE(descricao,'') LIKE ? OR COALESCE(nome,'') LIKE ? OR COALESCE(gtin,'') LIKE ?)
                 ORDER BY
                    CASE
                        WHEN codigo = ? THEN 1
                        WHEN codigo LIKE ? THEN 2
                        ELSE 3
                    END,
                    COALESCE(NULLIF(TRIM(descricao),''), nome) ASC
                 LIMIT ?`,
                [`%${termo}%`, `%${termo}%`, `%${termo}%`, `%${termo}%`, termo, `${termo}%`, limit]
            );
            return res.json(rows);
        } catch (error) {
            console.error('[Vendas] Autocomplete error:', error.code, error.message);
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            // Fallback ultra-seguro: apenas colunas básicas que certamente existem
            if (error.code === 'ER_BAD_FIELD_ERROR') {
                try {
                    const { termo } = req.params;
                    const limit = parseInt(req.query.limit) || 15;
                    const [rows] = await pool.query(
                        `SELECT id, codigo, COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao, COALESCE(nome, codigo) as nome
                         FROM produtos
                         WHERE codigo LIKE ? OR COALESCE(descricao,'') LIKE ? OR COALESCE(nome,'') LIKE ?
                         ORDER BY COALESCE(NULLIF(TRIM(descricao),''), nome) ASC
                         LIMIT ?`,
                        [`%${termo}%`, `%${termo}%`, `%${termo}%`, limit]
                    );
                    return res.json(rows);
                } catch (e2) {
                    console.error('[Vendas] Autocomplete fallback error:', e2.message);
                    return res.json([]);
                }
            }
            next(error);
        }
    });

    // Buscar dados fiscais de um produto específico (para cálculo de IPI/ICMS ST)
    router.get('/produtos/:id/fiscal', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT id, codigo,
                        COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao,
                        COALESCE(aliquota_ipi, 0) as aliquota_ipi,
                        COALESCE(calcular_ipi, 0) as calcular_ipi,
                        COALESCE(aliquota_icms, 0) as aliquota_icms,
                        COALESCE(calcular_icms_st, 0) as calcular_icms_st,
                        COALESCE(mva_st, 0) as mva_st,
                        COALESCE(ncm, '') as ncm,
                        COALESCE(cst_icms, '') as cst_icms,
                        COALESCE(cst_ipi, '') as cst_ipi,
                        COALESCE(aliquota_pis, 0) as aliquota_pis,
                        COALESCE(aliquota_cofins, 0) as aliquota_cofins
                 FROM produtos WHERE id = ?`, [id]
            );
            if (rows.length === 0) return res.status(404).json({ message: 'Produto não encontrado' });
            res.json(rows[0]);
        } catch (error) {
            next(error);
        }
    });

    // Atualizar impostos de todos os itens de um pedido
    router.post('/pedidos/:id/atualizar-impostos', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { cenario_fiscal } = req.body;

            // Buscar itens do pedido
            const [itens] = await pool.query(
                'SELECT id, codigo, produto_id, quantidade, preco_unitario, desconto FROM pedido_itens WHERE pedido_id = ?',
                [id]
            );

            if (itens.length === 0) return res.json({ message: 'Nenhum item para atualizar', itens: [] });

            let totalIPI = 0;
            let totalICMSST = 0;
            const itensAtualizados = [];

            for (const item of itens) {
                // Buscar dados fiscais do produto pelo código ou produto_id
                let produto = null;
                if (item.produto_id) {
                    const [prods] = await pool.query(
                        'SELECT aliquota_ipi, calcular_ipi, aliquota_icms, calcular_icms_st, mva_st FROM produtos WHERE id = ?',
                        [item.produto_id]
                    );
                    if (prods.length > 0) produto = prods[0];
                }
                if (!produto && item.codigo) {
                    const [prods] = await pool.query(
                        'SELECT id, aliquota_ipi, calcular_ipi, aliquota_icms, calcular_icms_st, mva_st FROM produtos WHERE codigo = ?',
                        [item.codigo]
                    );
                    if (prods.length > 0) produto = prods[0];
                }

                const subtotal = (parseFloat(item.quantidade) * parseFloat(item.preco_unitario)) - parseFloat(item.desconto || 0);
                let valorIPI = 0;
                let valorICMSST = 0;

                if (produto) {
                    // Calcular IPI
                    const aliqIPI = parseFloat(produto.aliquota_ipi) || 0;
                    if (aliqIPI > 0) {
                        valorIPI = subtotal * (aliqIPI / 100);
                    }

                    // Calcular ICMS ST (se calcular_icms_st = 1)
                    const calcST = parseInt(produto.calcular_icms_st) || 0;
                    const mvaST = parseFloat(produto.mva_st) || 0;
                    const aliqICMS = parseFloat(produto.aliquota_icms) || 0;
                    if (calcST && mvaST > 0 && aliqICMS > 0) {
                        const baseICMSST = subtotal * (1 + mvaST / 100);
                        const icmsST = (baseICMSST * aliqICMS / 100) - (subtotal * aliqICMS / 100);
                        valorICMSST = Math.max(0, icmsST);
                    }
                }

                totalIPI += valorIPI;
                totalICMSST += valorICMSST;

                itensAtualizados.push({
                    id: item.id,
                    valor_ipi: valorIPI,
                    valor_icms_st: valorICMSST,
                    aliquota_ipi: produto ? parseFloat(produto.aliquota_ipi) || 0 : 0,
                    produto_id: produto ? produto.id || item.produto_id : item.produto_id
                });
            }

            // Salvar valores de impostos em cada item do pedido
            for (const itemCalc of itensAtualizados) {
                await pool.query(
                    'UPDATE pedido_itens SET valor_ipi = ?, valor_icms_st = ?, aliquota_ipi = ?, produto_id = COALESCE(?, produto_id) WHERE id = ?',
                    [itemCalc.valor_ipi, itemCalc.valor_icms_st, itemCalc.aliquota_ipi, itemCalc.produto_id, itemCalc.id]
                );
            }

            // Atualizar totais no pedido
            await pool.query(
                'UPDATE pedidos SET total_ipi = ?, total_icms_st = ? WHERE id = ?',
                [totalIPI, totalICMSST, id]
            );

            res.json({
                message: 'Impostos atualizados com sucesso!',
                total_ipi: totalIPI,
                total_icms_st: totalICMSST,
                itens: itensAtualizados
            });
        } catch (error) {
            console.error('[Vendas] Erro ao atualizar impostos:', error);
            next(error);
        }
    });

    // GET /transportadoras - Buscar transportadoras para o módulo de vendas
    router.get('/transportadoras', async (req, res, next) => {
        try {
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            const [rows] = await pool.query(`
                SELECT id, nome_fantasia, razao_social, cnpj_cpf, inscricao_estadual, telefone, email, cidade, estado, cep
                FROM transportadoras
                ORDER BY COALESCE(nome_fantasia, razao_social)
                LIMIT 100
            `);
            const resultado = rows.map(r => ({
                id: r.id,
                nome: r.nome_fantasia || r.razao_social || '',
                razao_social: r.razao_social || '',
                nome_fantasia: r.nome_fantasia || '',
                cnpj: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || ''),
                telefone: r.telefone || '',
                email: r.email || '',
                cidade: r.cidade || '',
                uf: r.estado || '',
                cep: r.cep || ''
            }));
            res.json(resultado);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.json([]);
            }
            console.error('❌ Erro ao buscar transportadoras:', error);
            next(error);
        }
    });

    // POST /transportadoras - Criar nova transportadora
    router.post('/transportadoras', async (req, res, next) => {
        try {
            const { razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, telefone, email, cidade, estado, cep } = req.body;
            if (!razao_social || !razao_social.trim()) {
                return res.status(400).json({ error: 'Razão Social é obrigatória' });
            }
            const _enc = lgpdCrypto ? lgpdCrypto.encryptPII : (v => v);
            const [result] = await pool.query(`
                INSERT INTO transportadoras (razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, telefone, email, cidade, estado, cep)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                razao_social.trim(),
                (nome_fantasia || '').trim(),
                _enc((cnpj_cpf || '').replace(/\D/g, '')),
                _enc((inscricao_estadual || '').trim()),
                (telefone || '').trim(),
                (email || '').trim(),
                (cidade || '').trim(),
                (estado || '').trim(),
                (cep || '').trim()
            ]);
            res.json({ success: true, id: result.insertId, message: 'Transportadora cadastrada com sucesso' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Transportadora já cadastrada com este CNPJ' });
            }
            console.error('❌ Erro ao criar transportadora:', error);
            next(error);
        }
    });

    // GET /vendedores - Lista vendedores para filtros e dashboards
    router.get('/vendedores', async (req, res, next) => {
        try {
            const columns = await getTableColumns('usuarios');
            const selectCols = [
                'u.id',
                'u.nome',
                ...selectExistingColumns('u', columns, [
                    { column: 'email' },
                    { column: 'apelido' },
                    { column: 'avatar' },
                    { column: 'foto' },
                    { column: 'role' },
                    { column: 'departamento' },
                    { column: 'cargo' },
                    { column: 'setor' }
                ])
            ];

            const activeChecks = [];
            if (columns.has('ativo')) activeChecks.push('(u.ativo = 1 OR u.ativo IS NULL)');
            if (columns.has('status')) activeChecks.push("(u.status IS NULL OR LOWER(u.status) NOT IN ('inativo','bloqueado','desativado','excluido'))");
            if (columns.has('deleted_at')) activeChecks.push('u.deleted_at IS NULL');
            activeChecks.push("NOT EXISTS (SELECT 1 FROM funcionarios f WHERE f.email = u.email AND (LOWER(f.status) = 'demitido' OR f.ativo = 0 OR f.data_demissao IS NOT NULL))");

            const vendedorChecks = [];
            if (columns.has('role')) vendedorChecks.push("LOWER(COALESCE(u.role,'')) IN ('comercial','vendedor','sales')");
            if (columns.has('departamento')) vendedorChecks.push("LOWER(COALESCE(u.departamento,'')) LIKE '%comercial%' OR LOWER(COALESCE(u.departamento,'')) LIKE '%vendas%'");
            if (columns.has('cargo')) vendedorChecks.push("LOWER(COALESCE(u.cargo,'')) LIKE '%vendedor%' OR LOWER(COALESCE(u.cargo,'')) LIKE '%consultor%' OR LOWER(COALESCE(u.cargo,'')) LIKE '%comercial%'");
            if (columns.has('setor')) vendedorChecks.push("LOWER(COALESCE(u.setor,'')) LIKE '%comercial%' OR LOWER(COALESCE(u.setor,'')) LIKE '%vendas%'");
            if (columns.has('perfil')) vendedorChecks.push("LOWER(COALESCE(u.perfil,'')) LIKE '%vendedor%' OR LOWER(COALESCE(u.perfil,'')) LIKE '%comercial%'");
            vendedorChecks.push("LOWER(COALESCE(u.nome,'')) LIKE '%melissa%navarro%'");

            const activeWhere = activeChecks.length ? activeChecks.join(' AND ') : '1=1';
            const vendedorWhere = vendedorChecks.length ? vendedorChecks.map(c => `(${c})`).join(' OR ') : '1=1';
            const [rows] = await pool.query(`
                SELECT DISTINCT ${selectCols.join(', ')}
                FROM usuarios u
                WHERE ${activeWhere} AND (${vendedorWhere})
                ORDER BY u.nome ASC
            `);

            if (rows.length > 0) return res.json(rows);

            const [fallback] = await pool.query(`
                SELECT DISTINCT ${selectCols.join(', ')}
                FROM usuarios u
                WHERE ${activeWhere}
                ORDER BY u.nome ASC
                LIMIT 50
            `);
            res.json(fallback);
        } catch (error) {
            console.error('❌ Erro ao buscar vendedores:', error);
            // Fallback em caso de erro
            res.json([]);
        }
    });

    // GET /leads - Lista leads de prospecção
    router.get('/leads', async (req, res, next) => {
        try {
            const { status, vendedor_id, search, limit = 50, offset = 0 } = req.query;

            let where = '1=1';
            let params = [];

            if (status) {
                where += ' AND status = ?';
                params.push(status);
            }

            if (vendedor_id) {
                where += ' AND vendedor_id = ?';
                params.push(vendedor_id);
            }

            if (search) {
                where += ' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR email LIKE ?)';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            params.push(parseInt(limit), parseInt(offset));

            const [rows] = await pool.query(`
                SELECT l.*, u.nome as vendedor_nome
                FROM leads_prospeccao l
                LEFT JOIN usuarios u ON l.vendedor_id = u.id
                WHERE ${where}
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?
            `, params);

            // Total para paginação
            const [countResult] = await pool.query(`
                SELECT COUNT(*) as total FROM leads_prospeccao WHERE ${where.replace(' LIMIT ? OFFSET ?', '')}
            `, params.slice(0, -2));

            res.json({
                leads: rows,
                total: countResult[0]?.total || 0,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            // Retornar lista vazia se a tabela não existir
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.json({ leads: [], total: 0, limit: 50, offset: 0 });
            }
            console.error('❌ Erro ao buscar leads:', error);
            next(error);
        }
    });

    // GET /leads/:id - Detalhes de um lead
    router.get('/leads/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(`
                SELECT l.*, u.nome as vendedor_nome
                FROM leads_prospeccao l
                LEFT JOIN usuarios u ON l.vendedor_id = u.id
                WHERE l.id = ?
            `, [id]);

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Lead não encontrado' });
            }

            res.json(rows[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar lead:', error);
            next(error);
        }
    });

    // POST /leads - Criar novo lead
    router.post('/leads', async (req, res, next) => {
        try {
            const data = req.body;
            const vendedor_id = req.user?.id || null;

            const [result] = await pool.query(`
                INSERT INTO leads_prospeccao (
                    razao_social, nome_fantasia, cnpj, telefone, email,
                    cidade, uf, endereco, status, origem, vendedor_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                data.razao_social,
                data.nome_fantasia || null,
                data.cnpj || null,
                data.telefone || null,
                data.email || null,
                data.cidade || null,
                data.uf || null,
                data.endereco || null,
                data.status || 'novo',
                data.origem || 'manual',
                vendedor_id
            ]);

            res.status(201).json({ id: result.insertId, message: 'Lead criado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao criar lead:', error);
            next(error);
        }
    });

    // PUT /leads/:id - Atualizar lead
    router.put('/leads/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const data = req.body;

            // AUDIT-FIX R2: IDOR protection — verificar ownership ou admin
            const userRole = (req.user?.role || '').toLowerCase();
            const isAdmin = userRole === 'admin' || req.user?.is_admin;
            if (!isAdmin) {
                const [lead] = await pool.query('SELECT vendedor_id FROM leads_prospeccao WHERE id = ?', [id]);
                if (!lead.length || String(lead[0].vendedor_id) !== String(req.user?.id)) {
                    return res.status(403).json({ error: 'Você só pode editar seus próprios leads.' });
                }
                // Não-admin não pode reassignar vendedor_id
                delete data.vendedor_id;
            }

            const fields = [];
            const values = [];

            const allowedFields = ['razao_social', 'nome_fantasia', 'cnpj', 'telefone', 'email',
                'cidade', 'uf', 'endereco', 'status', 'origem', 'vendedor_id', 'observacoes'];

            for (const field of allowedFields) {
                if (data[field] !== undefined) {
                    fields.push(`${field} = ?`);
                    values.push(data[field]);
                }
            }

            if (fields.length === 0) {
                return res.status(400).json({ error: 'Nenhum campo para atualizar' });
            }

            fields.push('updated_at = NOW()');
            values.push(id);

            await pool.query(`UPDATE leads_prospeccao SET ${fields.join(', ')} WHERE id = ?`, values);

            res.json({ message: 'Lead atualizado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao atualizar lead:', error);
            next(error);
        }
    });

    // DELETE /leads/:id - Excluir lead
    router.delete('/leads/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            // AUDIT-FIX R2: IDOR protection — verificar ownership ou admin
            const userRole = (req.user?.role || '').toLowerCase();
            const isAdmin = userRole === 'admin' || req.user?.is_admin;
            if (!isAdmin) {
                const [lead] = await pool.query('SELECT vendedor_id FROM leads_prospeccao WHERE id = ?', [id]);
                if (!lead.length || String(lead[0].vendedor_id) !== String(req.user?.id)) {
                    return res.status(403).json({ error: 'Você só pode excluir seus próprios leads.' });
                }
            }
            await pool.query('UPDATE leads_prospeccao SET status = "excluido", deleted_at = NOW() WHERE id = ?', [id]);
            res.json({ message: 'Lead excluído com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao excluir lead:', error);
            next(error);
        }
    });

    // ======================================================
    // REGIÕES DE VENDA - CRUD de configurações comerciais
    // ======================================================
    async function ensureRegioesVendaTable() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendas_regioes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(120) NOT NULL,
                estados VARCHAR(255) NULL,
                descricao TEXT NULL,
                vendedor_responsavel VARCHAR(255) NULL,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
    }

    router.get('/regioes', async (req, res, next) => {
        try {
            await ensureRegioesVendaTable();
            const [rows] = await pool.query(`
                SELECT id, nome, estados, descricao, vendedor_responsavel,
                       0 AS total_clientes,
                       COALESCE(ativo, 1) AS ativo,
                       created_at, updated_at
                FROM vendas_regioes
                WHERE ativo = 1 OR ativo IS NULL
                ORDER BY nome
            `);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('❌ Erro ao listar regiões de venda:', error);
            res.json({ success: true, data: [] });
        }
    });

    router.post('/regioes', authenticateToken, async (req, res, next) => {
        try {
            await ensureRegioesVendaTable();
            const { nome, estados, descricao, vendedor_responsavel } = req.body || {};
            if (!nome || !String(nome).trim()) {
                return res.status(400).json({ message: 'Nome da região é obrigatório.' });
            }

            const [result] = await pool.query(`
                INSERT INTO vendas_regioes (nome, estados, descricao, vendedor_responsavel, ativo)
                VALUES (?, ?, ?, ?, 1)
            `, [String(nome).trim(), estados || null, descricao || null, vendedor_responsavel || null]);

            res.status(201).json({ success: true, id: result.insertId, message: 'Região criada com sucesso.' });
        } catch (error) {
            console.error('❌ Erro ao criar região de venda:', error);
            next(error);
        }
    });

    router.put('/regioes/:id', authenticateToken, async (req, res, next) => {
        try {
            await ensureRegioesVendaTable();
            const { id } = req.params;
            const { nome, estados, descricao, vendedor_responsavel, ativo } = req.body || {};

            const [result] = await pool.query(`
                UPDATE vendas_regioes
                SET nome = ?, estados = ?, descricao = ?, vendedor_responsavel = ?, ativo = COALESCE(?, ativo), updated_at = NOW()
                WHERE id = ?
            `, [String(nome || '').trim(), estados || null, descricao || null, vendedor_responsavel || null, ativo, id]);

            if (!result.affectedRows) {
                return res.status(404).json({ message: 'Região não encontrada.' });
            }

            res.json({ success: true, message: 'Região atualizada com sucesso.' });
        } catch (error) {
            console.error('❌ Erro ao atualizar região de venda:', error);
            next(error);
        }
    });

    router.delete('/regioes/:id', authenticateToken, async (req, res, next) => {
        try {
            await ensureRegioesVendaTable();
            const { id } = req.params;
            const [result] = await pool.query('UPDATE vendas_regioes SET ativo = 0, updated_at = NOW() WHERE id = ?', [id]);
            if (!result.affectedRows) {
                return res.status(404).json({ message: 'Região não encontrada.' });
            }
            res.json({ success: true, message: 'Região excluída com sucesso.' });
        } catch (error) {
            console.error('❌ Erro ao excluir região de venda:', error);
            next(error);
        }
    });

    // GET /condicoes-pagamento - Listar condições de pagamento
    router.get('/condicoes-pagamento', async (req, res, next) => {
        try {
            // Tentar buscar da tabela condicoes_pagamento
            try {
                const [rows] = await pool.query(`
                    SELECT id, nome, dias, descricao, ativo
                    FROM condicoes_pagamento
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome
                `);
                return res.json(rows);
            } catch (tableErr) {
                // Tabela não existe ou erro de coluna - retornar condições padrão
                if (tableErr.code === 'ER_NO_SUCH_TABLE' || tableErr.code === 'ER_BAD_FIELD_ERROR') {
                    return res.json([
                        { id: 1, nome: 'À Vista', descricao: 'Pagamento à vista', dias: '0' },
                        { id: 2, nome: '30 dias', descricao: 'Pagamento em 30 dias', dias: '30' },
                        { id: 3, nome: '30/60', descricao: '2x - 30/60 dias', dias: '30,60' },
                        { id: 4, nome: '30/60/90', descricao: '3x - 30/60/90 dias', dias: '30,60,90' },
                        { id: 5, nome: '30/60/90/120', descricao: '4x - 30/60/90/120 dias', dias: '30,60,90,120' },
                        { id: 6, nome: 'Entrada + 30', descricao: 'Entrada + 30 dias', dias: '0,30' },
                        { id: 7, nome: 'Entrada + 30/60', descricao: 'Entrada + 30/60 dias', dias: '0,30,60' }
                    ]);
                }
                throw tableErr;
            }
        } catch (error) {
            console.error('❌ Erro ao buscar condições de pagamento:', error);
            next(error);
        }
    });

    // POST /condicoes-pagamento - Criar nova condição de pagamento
    router.post('/condicoes-pagamento', async (req, res, next) => {
        try {
            const { nome, dias, descricao } = req.body;
            if (!nome) {
                return res.status(400).json({ message: 'Nome da condição é obrigatório' });
            }

            // Garantir que a tabela existe
            try {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS condicoes_pagamento (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        nome VARCHAR(100) NOT NULL,
                        dias VARCHAR(100) DEFAULT '0',
                        descricao VARCHAR(255) DEFAULT '',
                        ativo TINYINT(1) DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            } catch (e) { /* tabela já existe */ }

            const [result] = await pool.query(
                'INSERT INTO condicoes_pagamento (nome, dias, descricao) VALUES (?, ?, ?)',
                [nome, dias || '0', descricao || '']
            );

            res.status(201).json({
                id: result.insertId,
                nome,
                dias: dias || '0',
                descricao: descricao || '',
                message: 'Condição de pagamento criada com sucesso'
            });
        } catch (error) {
            console.error('❌ Erro ao criar condição de pagamento:', error);
            next(error);
        }
    });

    // PUT /condicoes-pagamento/:id - Editar condição de pagamento
    router.put('/condicoes-pagamento/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { nome, dias, descricao, ativo } = req.body;
            if (!id || !Number.isFinite(Number(id))) {
                return res.status(400).json({ message: 'ID da condição é obrigatório' });
            }
            if (!nome) {
                return res.status(400).json({ message: 'Nome da condição é obrigatório' });
            }

            const [result] = await pool.query(
                'UPDATE condicoes_pagamento SET nome = ?, dias = ?, descricao = ?, ativo = COALESCE(?, ativo) WHERE id = ?',
                [nome, dias || '0', descricao || '', ativo === undefined ? null : (ativo ? 1 : 0), id]
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Condição de pagamento não encontrada' });
            }
            res.json({ id: Number(id), nome, dias: dias || '0', descricao: descricao || '', ativo: ativo === undefined ? 1 : (ativo ? 1 : 0), message: 'Condição de pagamento atualizada com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao editar condição de pagamento:', error);
            next(error);
        }
    });

    // DELETE /condicoes-pagamento/:id - Remover condição de pagamento
    router.delete('/condicoes-pagamento/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            if (!id || !Number.isFinite(Number(id))) {
                return res.status(400).json({ message: 'ID da condição é obrigatório' });
            }
            const [result] = await pool.query(
                'UPDATE condicoes_pagamento SET ativo = 0 WHERE id = ?',
                [id]
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Condição de pagamento não encontrada' });
            }
            res.json({ success: true, message: 'Condição de pagamento removida com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao remover condição de pagamento:', error);
            next(error);
        }
    });

    // ========================================
    // ROTAS DE HISTÓRICO
    // Definidas ANTES do apiVendasRouter para ter prioridade
    // ========================================
    router.get('/pedidos/:id/historico', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            // Verificar se tabela existe
            try {
                const [tables] = await pool.query("SHOW TABLES LIKE 'pedido_historico'");
                if (tables.length === 0) {
                    return res.json([]);
                }
            } catch (e) {
                return res.json([]);
            }

            // Verificar estrutura da tabela e usar colunas corretas
            try {
                // Tentar primeiro com nomes padrão user_id/user_name
                const [historico] = await pool.query(`
                    SELECT id, pedido_id,
                           COALESCE(user_id, usuario_id) as user_id,
                           COALESCE(user_name, usuario_nome) as user_name,
                           COALESCE(action, acao) as action,
                           descricao, meta, created_at
                    FROM pedido_historico
                    WHERE pedido_id = ?
                    ORDER BY created_at DESC
                    LIMIT 100
                `, [id]);

                res.json(historico);
            } catch (e) {
                // Se falhar, usar SELECT * e mapear
                try {
                    const [historico] = await pool.query(`
                        SELECT * FROM pedido_historico
                        WHERE pedido_id = ?
                        ORDER BY created_at DESC
                        LIMIT 100
                    `, [id]);
                    res.json(historico);
                } catch (e2) {
                    console.error('❌ Erro ao buscar histórico:', e2);
                    res.json([]);
                }
            }
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            res.json([]);
        }
    });

    router.post('/pedidos/:id/historico', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { action, descricao, meta, usuario } = req.body;

            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE pedido_historico (already in apiVendasRouter)

            await pool.query(
                'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                [id, null, usuario || 'Sistema', action || 'manual', descricao || '', meta ? JSON.stringify(meta) : null]
            );

            res.status(201).json({ message: 'Histórico registrado com sucesso!' });
        } catch (error) {
            console.error('❌ Erro ao registrar histórico:', error);
            res.status(500).json({ message: 'Erro ao registrar histórico' });
        }
    });

    // =====================================================
    // FATURAMENTO PARCIAL (F9) - ENTREGA FUTURA
    // =====================================================

    async function ensureFaturamentoParcialTables() {
        try {
            const [cols] = await pool.query(`SHOW COLUMNS FROM pedidos LIKE 'tipo_faturamento'`);
            if (cols.length === 0) {
                await pool.query(`
                    ALTER TABLE pedidos
                    ADD COLUMN tipo_faturamento ENUM('normal','parcial_50','entrega_futura','consignado') DEFAULT 'normal',
                    ADD COLUMN percentual_faturado DECIMAL(5,2) DEFAULT 0,
                    ADD COLUMN valor_faturado DECIMAL(15,2) DEFAULT 0,
                    ADD COLUMN valor_pendente DECIMAL(15,2) DEFAULT 0,
                    ADD COLUMN estoque_baixado TINYINT(1) DEFAULT 0,
                    ADD COLUMN nfe_faturamento_numero VARCHAR(50) NULL,
                    ADD COLUMN nfe_faturamento_cfop VARCHAR(10) DEFAULT '5922',
                    ADD COLUMN nfe_remessa_numero VARCHAR(50) NULL,
                    ADD COLUMN nfe_remessa_cfop VARCHAR(10) DEFAULT '5117'
                `);
            }
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pedido_faturamentos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    pedido_id INT NOT NULL,
                    sequencia INT NOT NULL DEFAULT 1,
                    tipo ENUM('faturamento','remessa','complementar') NOT NULL,
                    percentual DECIMAL(5,2) NOT NULL,
                    valor DECIMAL(15,2) NOT NULL,
                    nfe_numero VARCHAR(50) NULL,
                    nfe_chave VARCHAR(50) NULL,
                    nfe_cfop VARCHAR(10) NULL,
                    nfe_status ENUM('pendente','autorizada','cancelada','denegada') DEFAULT 'pendente',
                    baixa_estoque TINYINT(1) DEFAULT 0,
                    conta_receber_id INT NULL,
                    usuario_id INT NULL,
                    usuario_nome VARCHAR(100) NULL,
                    observacoes TEXT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_pedido_id (pedido_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        } catch (e) {
            console.warn('[FATURAMENTO_PARCIAL] Erro ao garantir tabelas:', e.message);
        }
    }

    async function registrarHistoricoPedido(pedidoId, userId, userName, action, descricao, meta) {
        try {
            await pool.query(
                'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                [pedidoId, userId || null, userName || 'Sistema', action, descricao, meta ? JSON.stringify(meta) : null]
            );
        } catch (e) {
            console.warn('[HISTORICO] Erro:', e.message);
        }
    }

    const faturamentoParcialHandlers = createFaturamentoParcialHandlers({
        pool,
        faturamentoShared
    });
    router.post('/pedidos/:id/faturamento-parcial', faturamentoParcialHandlers.faturar);
    router.post('/pedidos/:id/remessa-entrega', faturamentoParcialHandlers.remessa);

    router.get('/faturamento/cfops', async (req, res, next) => {
        try {
            res.json({
                faturamento: {
                    dentro_estado: { cfop: '5922', descricao: 'Simples Faturamento - Operacao Interna' },
                    fora_estado: { cfop: '6922', descricao: 'Simples Faturamento - Operacao Interestadual' },
                    zona_franca: { cfop: '7922', descricao: 'Simples Faturamento - Zona Franca de Manaus' }
                },
                remessa: {
                    dentro_estado: { cfop: '5117', descricao: 'Remessa Entrega Futura - Operacao Interna' },
                    fora_estado: { cfop: '6117', descricao: 'Remessa Entrega Futura - Operacao Interestadual' },
                    zona_franca: { cfop: '7117', descricao: 'Remessa Entrega Futura - Zona Franca de Manaus' }
                },
                normal: {
                    dentro_estado: { cfop: '5102', descricao: 'Venda Mercadoria - Operacao Interna' },
                    fora_estado: { cfop: '6102', descricao: 'Venda Mercadoria - Operacao Interestadual' },
                    zona_franca: { cfop: '7102', descricao: 'Venda Mercadoria - Zona Franca de Manaus' }
                },
                suframa: {
                    info: 'UFs Zona Franca: AM, RR, AP, AC, RO',
                    nota: 'Para vendas a Zona Franca de Manaus, usar CFOPs 7xxx com isencao de ICMS/IPI conforme Decreto 288/67'
                }
            });
        } catch (error) { next(error); }
    });

    // =============================================================
    // =============================================================
    // BAIXAR ESTOQUE — chamado ao aprovar pedido
    // =============================================================
    router.post('/pedidos/:id/baixar-estoque', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const user = req.user || {};

            await connection.beginTransaction();

            const [pedidoRows] = await connection.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [id]);
            if (pedidoRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
            }
            const pedido = pedidoRows[0];
            if (pedido.estoque_baixado === 1) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Estoque já foi baixado para este pedido.' });
            }

            const [itens] = await connection.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
            const baixados = [];

            for (const item of itens) {
                if (!item.produto_id || !item.quantidade) continue;

                try {
                    await connection.query(
                        `INSERT INTO estoque_movimentos (produto_id, tipo, quantidade, referencia_tipo, referencia_id, observacoes, usuario_id)
                         VALUES (?, 'saida', ?, 'aprovacao_pedido', ?, ?, ?)`,
                        [item.produto_id, item.quantidade, id, `Aprovação do Pedido #${id}`, user.id || null]
                    );
                } catch (e) {
                    // estoque_movimentos pode não existir — continuar
                }

                const [stockResult] = await connection.query(
                    'UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ? AND estoque_atual >= ?',
                    [item.quantidade, item.produto_id, item.quantidade]
                );
                baixados.push({ produto_id: item.produto_id, quantidade: item.quantidade, atualizado: stockResult.affectedRows > 0 });
            }

            await connection.query(
                'UPDATE pedidos SET estoque_baixado = 1, data_baixa_estoque = NOW() WHERE id = ?', [id]
            ).catch(colErr => {
                // Colunas estoque_baixado/data_baixa_estoque podem não existir
                console.warn('⚠️ Não foi possível marcar estoque_baixado no pedido:', colErr.message);
            });

            try {
                await connection.query(
                    'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao) VALUES (?, ?, ?, ?, ?)',
                    [id, user.id || null, user.nome || 'Sistema', 'baixa_estoque', `Estoque baixado na aprovação do pedido #${id}`]
                );
            } catch (_) {}

            await connection.commit();
            res.json({ success: true, message: 'Estoque baixado com sucesso.', itens_baixados: baixados });
        } catch (err) {
            try { await connection.rollback(); } catch (_) {}
            next(err);
        } finally {
            connection.release();
        }
    });

    // =============================================================
    // ESPELHO da NF-e a partir do PEDIDO (prévia, ANTES do envio ao SEFAZ)
    // GET /api/vendas/pedidos/:id/espelho-nfe?tipo=normal|parcial&pct=NN
    // Render HTML (DANFE marca d'água) p/ conferência no modal de faturamento.
    // Fica no router de Vendas (área 'vendas') p/ ser acessível a quem fatura no Kanban,
    // sem depender da área 'nfe'. Não transmite nem persiste nada.
    // =============================================================
    router.get('/pedidos/:id/espelho-nfe', async (req, res) => {
        try {
            const pedidoId = parseInt(req.params.id, 10);
            if (!pedidoId) return res.status(400).send('<html><body style="font-family:sans-serif;padding:40px;"><h2>Pedido inválido</h2></body></html>');

            // BUG-FIX 2026-06-28: este endpoint reimplementava manualmente o ctx da DANFE
            // (emitente errado via tabela `empresas`, impostos sempre zerados, sem fallback
            // de cliente por nome). Agora reaproveita exatamente a mesma lógica comprovada de
            // GET /pedidos/:id/danfe?preview=1 — mesmos JOINs de cliente/produto, mesmo
            // resolvedor de emitente/logo, e buildDanfeCtx/renderDanfe — só adicionando o
            // fator de meia-nota (tipo/pct) por cima. Ver memória nfe-emitente-empresas-bug-2026-06-28.
            const [[ped]] = await pool.query(`
                SELECT p.*, p.valor as valor_total,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_nome,
                       COALESCE(c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_razao_social,
                       COALESCE(c.cnpj, c.cnpj_cpf) AS cliente_cnpj,
                       COALESCE(c.cpf) AS cliente_cpf,
                       c.inscricao_estadual AS cliente_ie,
                       COALESCE(c.email, p.email_cliente) AS cliente_email,
                       c.telefone AS cliente_telefone,
                       c.endereco AS cliente_endereco, c.bairro AS cliente_bairro,
                       c.cidade AS cliente_cidade, c.estado AS cliente_estado,
                       c.cep AS cliente_cep,
                       t.razao_social AS transportadora_razao_social,
                       t.nome_fantasia AS transportadora_nome_fantasia,
                       t.cnpj_cpf AS transportadora_cnpj_cpf
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.id = ? LIMIT 1
            `, [pedidoId]);
            if (!ped) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px;"><h2 style="color:#ef4444;">Pedido não encontrado</h2></body></html>');

            // Se cliente_id NULL mas temos cliente_nome (caso dos pedidos de teste), tentar
            // resolver o destinatário completo (endereço/CNPJ/IE) pelo nome.
            if (!ped.cliente_cnpj && (ped.cliente_nome || ped.cliente)) {
                try {
                    const nomeBusca = ped.cliente_nome || ped.cliente;
                    const [[clienteMatch]] = await pool.query(
                        `SELECT COALESCE(cnpj, cnpj_cpf) AS cnpj, cpf, inscricao_estadual,
                                endereco, bairro, cidade, estado, cep, telefone, email,
                                razao_social, nome_fantasia
                         FROM clientes WHERE razao_social = ? OR nome = ? OR nome_fantasia = ? LIMIT 1`,
                        [nomeBusca, nomeBusca, nomeBusca]
                    );
                    if (clienteMatch) {
                        ped.cliente_razao_social = clienteMatch.razao_social || ped.cliente_razao_social;
                        ped.cliente_cnpj = clienteMatch.cnpj || '';
                        ped.cliente_cpf = clienteMatch.cpf || '';
                        ped.cliente_ie = clienteMatch.inscricao_estadual || '';
                        ped.cliente_endereco = clienteMatch.endereco || '';
                        ped.cliente_bairro = clienteMatch.bairro || '';
                        ped.cliente_cidade = clienteMatch.cidade || '';
                        ped.cliente_estado = clienteMatch.estado || '';
                        ped.cliente_cep = clienteMatch.cep || '';
                        ped.cliente_telefone = clienteMatch.telefone || '';
                        ped.cliente_email = clienteMatch.email || '';
                    }
                } catch (_) { /* best-effort */ }
            }

            // Emitente — sempre a empresa configurada (mesma fonte da emissão real e do
            // /danfe oficial), nunca a tabela `empresas` (que é, na prática, cadastro de
            // CLIENTES — ver memória nfe-emitente-empresas-bug-2026-06-28).
            const [[cfgEmpresa]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
            if (cfgEmpresa) {
                ped.empresa_razao_social = cfgEmpresa.razao_social;
                ped.empresa_nome = cfgEmpresa.nome_fantasia;
                ped.empresa_cnpj = cfgEmpresa.cnpj;
                ped.empresa_ie = cfgEmpresa.inscricao_estadual;
                ped.empresa_endereco = cfgEmpresa.endereco + (cfgEmpresa.numero ? ', ' + cfgEmpresa.numero : '');
                ped.empresa_bairro = cfgEmpresa.bairro;
                ped.empresa_cidade = cfgEmpresa.cidade;
                ped.empresa_uf = cfgEmpresa.estado;
                ped.empresa_cep = cfgEmpresa.cep;
                ped.empresa_telefone = cfgEmpresa.telefone;
            }
            const [[cfgFiscal]] = await pool.query('SELECT * FROM config_fiscal_empresa LIMIT 1').catch(() => [[]]);

            // Itens com dados fiscais reais do produto (NCM, CFOP, CST/CSOSN, alíquotas) —
            // mesmo JOIN do /danfe oficial, em vez dos campos crus (e quase sempre vazios)
            // de pedido_itens.
            const [itensRaw] = await pool.query(`
                SELECT pi.codigo, pi.descricao, pi.quantidade, pi.unidade, pi.preco_unitario,
                       pi.desconto, pi.subtotal, pi.produto_id,
                       pi.icms_percent, pi.icms_value, pi.aliquota_icms, pi.aliquota_ipi,
                       pi.valor_ipi, pi.valor_icms_st, pi.cfop,
                       pi.pis_percent, pi.pis_value, pi.cofins_percent, pi.cofins_value,
                       COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                       COALESCE(pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS produto_cfop,
                       COALESCE(pr_id.cst_icms, pr_cod.cst_icms) AS produto_cst_icms,
                       COALESCE(pr_id.csosn_icms, pr_cod.csosn_icms) AS produto_csosn_icms,
                       COALESCE(pr_id.aliquota_icms, pr_cod.aliquota_icms) AS produto_aliquota_icms,
                       COALESCE(pr_id.aliquota_ipi, pr_cod.aliquota_ipi) AS produto_aliquota_ipi,
                       COALESCE(pr_id.aliquota_pis, pr_cod.aliquota_pis) AS produto_aliquota_pis,
                       COALESCE(pr_id.aliquota_cofins, pr_cod.aliquota_cofins) AS produto_aliquota_cofins
                FROM pedido_itens pi
                LEFT JOIN produtos pr_id ON pi.produto_id = pr_id.id
                LEFT JOIN produtos pr_cod ON pi.produto_id IS NULL AND pr_cod.codigo = pi.codigo
                WHERE pi.pedido_id = ? ORDER BY pi.id ASC
            `, [pedidoId]).catch(() => [[]]);

            // Fator de meia-nota (faturamento parcial): escala valores monetários do item,
            // mantendo quantidade/preço unitário reais (mesmo comportamento de antes).
            const tipo = String(req.query.tipo || 'normal').toLowerCase();
            const pct = Math.max(1, Math.min(100, parseFloat(req.query.pct) || 100));
            const fator = (tipo === 'parcial' || tipo === 'meianota' || tipo === 'meia-nota') ? (pct / 100) : 1;
            const itens = (itensRaw || []).map(it => ({
                ...it,
                subtotal: (parseFloat(it.subtotal) || 0) * fator,
                icms_value: it.icms_value != null ? (parseFloat(it.icms_value) || 0) * fator : it.icms_value,
                valor_ipi: it.valor_ipi != null ? (parseFloat(it.valor_ipi) || 0) * fator : it.valor_ipi,
                pis_value: it.pis_value != null ? (parseFloat(it.pis_value) || 0) * fator : it.pis_value,
                cofins_value: it.cofins_value != null ? (parseFloat(it.cofins_value) || 0) * fator : it.cofins_value
            }));
            if (fator < 1) {
                ped.valor_total = (parseFloat(ped.valor_total) || 0) * fator;
                ped.valor = ped.valor_total;
            }

            // Logo da empresa como data-URI (mesmo resolvedor do /danfe oficial)
            const { resolverCaminhoLogo } = require('../modules/_shared/services/empresa-config.service');
            let logoDataUri = '';
            try {
                const logoAbsPath = resolverCaminhoLogo(cfgEmpresa || {});
                if (logoAbsPath && fs.existsSync(logoAbsPath)) {
                    const logoBuffer = fs.readFileSync(logoAbsPath);
                    const ext = path.extname(logoAbsPath).toLowerCase().replace('.', '');
                    const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
                    logoDataUri = `data:${mime};base64,${logoBuffer.toString('base64')}`;
                }
            } catch (logoErr) {
                console.warn('[Vendas/EspelhoNFe] Falha ao resolver logo:', logoErr.message);
            }

            const { renderDanfe, buildDanfeCtx } = require('./danfe-renderer');
            const ctx = buildDanfeCtx(ped, itens, { preview: true, cfgFiscal, logoDataUri });
            if (fator < 1) ctx.avisoTopo += ' — MEIA NOTA (' + pct + '%)';

            const html = renderDanfe(ctx);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            return res.send(html);
        } catch (err) {
            console.error('[Vendas/EspelhoNFe] Erro:', err);
            res.status(500).send('<html><body style="font-family:sans-serif;padding:40px;"><h2 style="color:#ef4444;">Erro ao gerar espelho</h2><pre>' + String(err && err.message || err) + '</pre></body></html>');
        }
    });

    // =============================================================
    // ESPELHO NF-e EDITÁVEL — editor HTML em iframe antes do envio ao SEFAZ
    // GET  /api/vendas/pedidos/:id/espelho-nfe-edit
    // POST /api/vendas/pedidos/:id/espelho-nfe-patch
    // =============================================================
    router.get('/pedidos/:id/espelho-nfe-edit', async (req, res) => {
        try {
            const pedidoId = parseInt(req.params.id, 10);
            if (!pedidoId) return res.status(400).send('<p style="color:red">Pedido inválido</p>');

            const [[ped]] = await pool.query(
                `SELECT p.*, c.nome AS cli_nome, c.razao_social AS cli_razao,
                        c.cnpj AS cli_cnpj, c.inscricao_estadual AS cli_ie
                 FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
                 WHERE p.id = ? LIMIT 1`, [pedidoId]
            );
            if (!ped) return res.status(404).send('<p style="color:red">Pedido não encontrado</p>');

            const [itens] = await pool.query(
                `SELECT i.id, i.codigo, i.descricao, i.quantidade, i.preco_unitario, i.subtotal, i.cfop,
                        COALESCE(p.ncm,'') AS ncm, COALESCE(p.nome, i.descricao) AS produto_nome
                 FROM pedido_itens i
                 LEFT JOIN produtos p ON p.id = i.produto_id
                 WHERE i.pedido_id = ? ORDER BY i.id ASC`, [pedidoId]
            ).catch(() => [[]]);

            const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const fmtV = v => (parseFloat(v)||0).toFixed(2);

            const itensRows = (itens||[]).map((it, i) => `
                <tr>
                    <td style="padding:6px 4px;font-size:11px;color:#64748b;">${i+1}</td>
                    <td style="padding:6px 4px;">
                        <input name="item_${it.id}_descricao" value="${esc(it.descricao||it.produto_nome)}"
                            style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:5px 8px;font-size:12px;" />
                    </td>
                    <td style="padding:6px 4px;">
                        <input name="item_${it.id}_ncm" value="${esc(it.ncm)}" maxlength="8"
                            placeholder="00000000"
                            style="width:90px;border:1px solid #e2e8f0;border-radius:6px;padding:5px 8px;font-size:12px;" />
                    </td>
                    <td style="padding:6px 4px;">
                        <input name="item_${it.id}_cfop" value="${esc(it.cfop)}" maxlength="4"
                            placeholder="5102"
                            style="width:70px;border:1px solid #e2e8f0;border-radius:6px;padding:5px 8px;font-size:12px;" />
                    </td>
                    <td style="padding:6px 4px;text-align:right;font-size:12px;color:#334155;">${fmtV(it.quantidade)}</td>
                    <td style="padding:6px 4px;text-align:right;font-size:12px;color:#334155;">${fmtV(it.preco_unitario)}</td>
                    <td style="padding:6px 4px;text-align:right;font-size:12px;font-weight:600;color:#1e40af;">${fmtV(it.subtotal)}</td>
                </tr>`).join('');

            const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Editar NF-e — Pedido #${pedidoId}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:13px}
.header{background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.header h2{font-size:15px;font-weight:700;margin:0}
.header small{font-size:11px;opacity:0.75}
.body{padding:16px 20px 80px}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px}
.section h3{font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f1f5f9}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px}
input,select,textarea{width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:13px;color:#1e293b;background:#fff;outline:none;transition:border .15s}
input:focus,select:focus,textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
textarea{resize:vertical;min-height:70px}
table{width:100%;border-collapse:collapse}
th{padding:8px 4px;font-size:11px;font-weight:700;color:#475569;text-align:left;background:#f8fafc;border-bottom:2px solid #e2e8f0}
tr:hover td{background:#f8fafc}
.footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e2e8f0;padding:12px 20px;display:flex;gap:10px;justify-content:flex-end;box-shadow:0 -4px 20px rgba(0,0,0,.06)}
.btn{padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s}
.btn-primary{background:#1e40af;color:#fff}.btn-primary:hover{background:#1d4ed8}
.btn-secondary{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}.btn-secondary:hover{background:#e2e8f0}
.alert{padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:12px;display:none}
.alert-success{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.alert-error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
</style></head><body>
<div class="header">
  <div style="width:36px;height:36px;background:rgba(255,255,255,.15);border-radius:8px;display:flex;align-items:center;justify-content:center;">
    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  </div>
  <div>
    <h2>Editar NF-e — Pedido #${pedidoId}</h2>
    <small>Ajuste as informações fiscais antes de enviar ao SEFAZ</small>
  </div>
</div>
<div class="body">
  <div id="msg-success" class="alert alert-success">✓ Dados salvos! O espelho será atualizado.</div>
  <div id="msg-error" class="alert alert-error">Erro ao salvar. Tente novamente.</div>

  <form id="form-nfe-edit">
    <input type="hidden" name="pedido_id" value="${pedidoId}" />

    <div class="section">
      <h3>Dados da NF-e</h3>
      <div class="grid2">
        <div>
          <label>Natureza da Operação</label>
          <input name="natureza_operacao" value="${esc(ped.natureza_operacao||'Venda de Mercadoria')}" placeholder="Venda de Mercadoria" />
        </div>
        <div>
          <label>Tipo de Frete</label>
          <select name="tipo_frete">
            <option value="CIF" ${(ped.tipo_frete||'')=='CIF'?'selected':''}>CIF — Por conta do Emitente</option>
            <option value="FOB" ${(ped.tipo_frete||'')=='FOB'?'selected':''}>FOB — Por conta do Destinatário</option>
            <option value="3" ${(ped.tipo_frete||'')=='3'?'selected':''}>3 — Por conta de Terceiros</option>
            <option value="9" ${(ped.tipo_frete||'')=='9'?'selected':''}>9 — Sem Frete</option>
          </select>
        </div>
        <div>
          <label>Transportadora</label>
          <input name="transportadora_nome" value="${esc(ped.transportadora_nome)}" placeholder="Nome da transportadora" />
        </div>
        <div>
          <label>Destinatário (Cliente)</label>
          <input value="${esc(ped.cli_razao||ped.cli_nome||ped.cliente_nome)}" readonly style="background:#f8fafc;color:#64748b" />
        </div>
      </div>
    </div>

    <div class="section">
      <h3>Itens da NF-e</h3>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th style="width:30px">#</th>
            <th>Descrição</th>
            <th>NCM</th>
            <th>CFOP</th>
            <th style="text-align:right">Qtd</th>
            <th style="text-align:right">V.Unit</th>
            <th style="text-align:right">Total</th>
          </tr></thead>
          <tbody>${itensRows}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h3>Informações Adicionais</h3>
      <label>Informações Complementares (campo 61 da NF-e)</label>
      <textarea name="campos_obs_nfe" rows="4" placeholder="Observações que constarão na NF-e...">${esc(ped.campos_obs_nfe)}</textarea>
    </div>
  </form>
</div>

<div class="footer">
  <button type="button" class="btn btn-secondary" onclick="window.parent && window.parent.voltarEspelho ? window.parent.voltarEspelho() : history.back()">
    Cancelar
  </button>
  <button type="button" class="btn btn-primary" id="btn-salvar" onclick="salvarEdicao()">
    <span id="btn-salvar-txt">Salvar e Atualizar Espelho</span>
  </button>
</div>

<script>
async function salvarEdicao() {
  const btn = document.getElementById('btn-salvar');
  const txt = document.getElementById('btn-salvar-txt');
  const msgOk = document.getElementById('msg-success');
  const msgErr = document.getElementById('msg-error');
  btn.disabled = true; txt.textContent = 'Salvando...';
  msgOk.style.display = 'none'; msgErr.style.display = 'none';

  const form = document.getElementById('form-nfe-edit');
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v; });

  try {
    const r = await fetch('/api/vendas/pedidos/${pedidoId}/espelho-nfe-patch', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'Erro ao salvar');
    msgOk.style.display = 'block';
    btn.disabled = false; txt.textContent = 'Salvar e Atualizar Espelho';
    // notify parent to reload the DANFE preview
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'espelho-saved', pedidoId: ${pedidoId} }, '*');
    }
  } catch(e) {
    msgErr.style.display = 'block'; msgErr.textContent = '✗ ' + e.message;
    btn.disabled = false; txt.textContent = 'Salvar e Atualizar Espelho';
  }
}
</script>
</body></html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(html);
        } catch (err) {
            console.error('[Vendas/EspelhoEdit] Erro:', err);
            res.status(500).send('<p style="color:red;padding:20px">Erro: ' + String(err.message) + '</p>');
        }
    });

    // PATCH — salva campos editados da NF-e de volta ao pedido/itens
    router.post('/pedidos/:id/espelho-nfe-patch', async (req, res) => {
        try {
            const pedidoId = parseInt(req.params.id, 10);
            if (!pedidoId) return res.status(400).json({ ok: false, error: 'ID inválido' });

            const { natureza_operacao, campos_obs_nfe, transportadora_nome, tipo_frete, ...rest } = req.body;

            // Update pedido-level fields
            await pool.query(
                `UPDATE pedidos SET
                    natureza_operacao = ?,
                    campos_obs_nfe    = ?,
                    transportadora_nome = ?,
                    tipo_frete        = ?
                 WHERE id = ?`,
                [natureza_operacao || null, campos_obs_nfe || null,
                 transportadora_nome || null, tipo_frete || null, pedidoId]
            );

            // Update item-level fields (item_<id>_<field>)
            const itemUpdates = {};
            for (const [key, val] of Object.entries(rest)) {
                const m = key.match(/^item_(\d+)_(descricao|cfop)$/);
                if (m) {
                    const itemId = parseInt(m[1], 10);
                    if (!itemUpdates[itemId]) itemUpdates[itemId] = {};
                    itemUpdates[itemId][m[2]] = val;
                }
            }
            for (const [itemId, fields] of Object.entries(itemUpdates)) {
                const sets = [], vals = [];
                if (fields.descricao !== undefined) { sets.push('descricao = ?'); vals.push(fields.descricao); }
                if (fields.cfop !== undefined) { sets.push('cfop = ?'); vals.push(fields.cfop || null); }
                if (sets.length) {
                    vals.push(parseInt(itemId, 10), pedidoId);
                    await pool.query(`UPDATE pedido_itens SET ${sets.join(', ')} WHERE id = ? AND pedido_id = ?`, vals);
                }
            }

            return res.json({ ok: true });
        } catch (err) {
            console.error('[Vendas/EspelhoPatch] Erro:', err);
            return res.status(500).json({ ok: false, error: err.message });
        }
    });

    // =============================================================
    // FATURAMENTO NORMAL (100%) - Frontend chama POST /pedidos/:id/faturar
    // Usado por executarFaturamentoNormalKanban() e executarFaturamentoNormal()
    // Inclui: NF sequencial atômica, baixa de estoque, conta a receber, logística
    // =============================================================
    router.post('/pedidos/:id/faturar', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { gerarNFe = true } = req.body;
            const user = req.user || {};

            // AUDIT-FIX BUG-04: Verificar permissão de faturamento antes de processar
            if (!faturamentoShared.canFaturar(user)) {
                connection.release();
                return res.status(403).json({ message: 'Você não tem permissão para faturar pedidos.', code: 'FATURAMENTO_DENIED' });
            }

            // TRANSAÇÃO ATÔMICA — tudo dentro da transaction com FOR UPDATE para evitar race condition
            await connection.beginTransaction();

            // 1. Buscar pedido com dados do cliente via JOIN + FOR UPDATE lock
            // Compatibilidade de schema: alguns ambientes usam `cnpj`, outros `cpf_cnpj`
            const [clienteColumns] = await connection.query('SHOW COLUMNS FROM clientes');
            const clienteFields = new Set(clienteColumns.map(col => col.Field));
            const clienteSelectParts = [
                'c.nome as cliente_nome_join',
                clienteFields.has('cpf_cnpj') ? 'c.cpf_cnpj' : (clienteFields.has('cnpj') ? 'c.cnpj as cpf_cnpj' : 'NULL as cpf_cnpj'),
                clienteFields.has('cnpj') ? 'c.cnpj' : (clienteFields.has('cpf_cnpj') ? 'c.cpf_cnpj as cnpj' : 'NULL as cnpj'),
                clienteFields.has('email') ? 'c.email as cliente_email' : 'NULL as cliente_email',
                clienteFields.has('telefone') ? 'c.telefone as cliente_telefone' : 'NULL as cliente_telefone',
                clienteFields.has('endereco') ? 'c.endereco' : 'NULL as endereco',
                clienteFields.has('numero') ? 'c.numero as num_endereco' : 'NULL as num_endereco',
                clienteFields.has('complemento') ? 'c.complemento' : 'NULL as complemento',
                clienteFields.has('bairro') ? 'c.bairro' : 'NULL as bairro',
                clienteFields.has('cidade') ? 'c.cidade' : 'NULL as cidade',
                clienteFields.has('estado') ? 'c.estado as uf' : 'NULL as uf',
                clienteFields.has('cep') ? 'c.cep' : 'NULL as cep'
            ];

            const [pedidoRows] = await connection.query(
                `SELECT p.*, ${clienteSelectParts.join(', ')}
                 FROM pedidos p
                 LEFT JOIN clientes c ON c.id = p.cliente_id
                 WHERE p.id = ? FOR UPDATE`,
                [id]
            );
            if (pedidoRows.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }

            const pedido = pedidoRows[0];

            // Validar: pedido já faturado não pode ser faturado novamente
            if (['faturado', 'entregue', 'cancelado'].includes(pedido.status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ message: `Pedido já está com status "${pedido.status}" e não pode ser faturado novamente.` });
            }

            // Bloquear faturamento de pedido cujo cliente está bloqueado por inadimplência
            if (pedido.cliente_id) {
                try {
                    const [bloqRows] = await connection.query(
                        'SELECT bloqueado_inadimplencia FROM clientes WHERE id = ? LIMIT 1',
                        [pedido.cliente_id]
                    );
                    if (bloqRows.length && Number(bloqRows[0].bloqueado_inadimplencia) === 1) {
                        await connection.rollback();
                        connection.release();
                        return res.status(403).json({
                            message: 'Cliente bloqueado por inadimplência. Regularize as contas a receber vencidas no módulo Financeiro (registre a baixa com comprovante) antes de faturar este pedido.',
                            code: 'CLIENTE_INADIMPLENTE'
                        });
                    }
                } catch (_inadimplenciaErr) {
                    // Coluna bloqueado_inadimplencia ainda não existe neste schema — não bloquear
                }
            }

            // 2. Buscar itens
            const [itensRows] = await connection.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
            // ========================================
            // A3-NC-011: bloquear faturamento de pedido sem valor/sem itens
            // NF-e com R$0 ou sem itens é inválida — bloquear antes de gerar.
            // Orçamento vazio é permitido; aqui já estamos no faturamento.
            // ========================================
            {
                const somaItensFat = (itensRows || []).reduce((acc, it) => acc + parseFloat(it.subtotal || 0), 0);
                const valorCabFat = parseFloat(pedido.valor || 0);
                const valorEfetivoFat = somaItensFat > 0 ? somaItensFat : valorCabFat;
                if (!itensRows || itensRows.length === 0 || valorEfetivoFat <= 0) {
                    console.log(`🚫 [A3] Bloqueado faturamento do pedido #${id}: itens=${(itensRows || []).length}, valor=${valorEfetivoFat}`);
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        success: false,
                        message: 'Não é possível aprovar/faturar um pedido sem valor ou sem itens.'
                    });
                }
            }

            // ========================================
            // CV-005: bloquear faturamento sem cenário fiscal definido.
            // O cenário fiscal é quem determina a tributação (inclusive isenção/Simples, que são
            // imposto zero LEGÍTIMO). Sem cenário, emitir NF-e geraria nota sem tributação por
            // omissão — risco fiscal. Exigimos o cenário; impostos zerados COM cenário são válidos.
            // ========================================
            {
                const cenarioFiscalDef = pedido.cenario_fiscal_id || pedido.cenario_fiscal;
                const semCenario = cenarioFiscalDef === null || cenarioFiscalDef === undefined ||
                    String(cenarioFiscalDef).trim() === '';
                if (semCenario) {
                    console.log(`🚫 [CV-005] Bloqueado faturamento do pedido #${id}: cenário fiscal não definido`);
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        success: false,
                        code: 'SEM_CENARIO_FISCAL',
                        message: 'Defina o cenário fiscal do pedido antes de faturar. A nota fiscal precisa de uma classificação tributária (ex.: Venda Normal, Simples Nacional, Isento).'
                    });
                }
            }

            let novaNf = null;
            let nfeData = null;

            // 3. Tentar gerar NFe via módulo externo (não bloqueia o faturamento se falhar)
            if (gerarNFe && itensRows.length > 0) {
                try {
                    const nfePayload = {
                        pedido_id: id,
                        cliente: {
                            nome: pedido.cliente_nome_join || pedido.cliente,
                            cpf_cnpj: pedido.cpf_cnpj || pedido.cnpj,
                            email: pedido.cliente_email,
                            telefone: pedido.cliente_telefone,
                            endereco: pedido.endereco,
                            numero: pedido.num_endereco,
                            complemento: pedido.complemento,
                            bairro: pedido.bairro,
                            cidade: pedido.cidade,
                            uf: pedido.uf,
                            cep: pedido.cep
                        },
                        produtos: itensRows.map(item => ({
                            codigo: item.codigo_produto || item.codigo,
                            descricao: item.descricao || item.produto,
                            ncm: item.ncm || '00000000',
                            quantidade: item.quantidade,
                            valor_unitario: item.preco_unitario || item.valor_unitario,
                            valor_total: parseFloat(item.quantidade) * parseFloat(item.preco_unitario || item.valor_unitario || 0)
                        })),
                        valor_total: pedido.valor,
                        observacoes: pedido.observacoes || ''
                    };
                    const axios = require('axios');
                    const nfeResponse = await axios.post('http://localhost:3003/api/nfe/gerar', nfePayload, {
                        timeout: 30000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (nfeResponse.data && nfeResponse.data.numero) {
                        novaNf = nfeResponse.data.numero;
                        nfeData = {
                            numero: nfeResponse.data.numero,
                            chave: nfeResponse.data.chave,
                            protocolo: nfeResponse.data.protocolo,
                            danfe_url: nfeResponse.data.danfe_url
                        };
                        console.log(`[FATURAR] NFe ${novaNf} gerada para pedido #${id}`);
                    }
                } catch (nfeError) {
                    console.error('[FATURAR] Erro ao gerar NFe (não crítico):', nfeError.message);
                }
            }

            try {
                // 4a. NF sequencial via serviço compartilhado (usa colunas reais: nf, numero_nf)
                // Quando vamos emitir NF-e real à SEFAZ (pós-commit), o número vem do emissor —
                // não reservar aqui para não criar gap de numeração.
                if (!novaNf && !gerarNFe) {
                    const nfData = await faturamentoShared.gerarProximoNumeroNFe(connection);
                    novaNf = nfData.numero;
                }

                const statusAnterior = pedido.status;

                // 4b. Atualizar pedido para faturado — salva em AMBOS os campos nf e numero_nf
                await connection.query(
                    'UPDATE pedidos SET status = ?, nf = ?, numero_nf = ?, data_faturamento = COALESCE(data_faturamento, NOW()), nfe_chave = ?, updated_at = NOW() WHERE id = ?',
                    ['faturado', novaNf, novaNf, nfeData?.chave || null, id]
                );

                // 4c. Baixar estoque automaticamente — AUDIT-FIX: Verificar se já foi baixado pelo endpoint de status
                let movimentacoesEstoque = [];
                try {
                    // Checar se já existem movimentações de saída para este pedido (evita duplicação)
                    const [movExistentes] = await connection.query(
                        "SELECT COUNT(*) as count FROM estoque_movimentacoes WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'",
                        [id]
                    );
                    const jaTemBaixa = movExistentes[0]?.count > 0;

                    if (itensRows.length > 0 && !jaTemBaixa) {
                        movimentacoesEstoque = await baixarEstoqueAutomatico(connection, id, itensRows, user?.id);
                        console.log(`[FATURAR] Estoque baixado: ${movimentacoesEstoque.length} item(s) para pedido #${id}`);
                    } else if (jaTemBaixa) {
                        console.log(`[FATURAR] Estoque já baixado anteriormente para pedido #${id} — pulando`);
                    }
                } catch (estoqueError) {
                    console.error('[FATURAR] Erro ao baixar estoque (não crítico):', estoqueError.message);
                }

                // 4d. Gerar conta a receber (evita duplicação)
                let contaReceberGerada = null;
                try {
                    const valorPedido = parseFloat(pedido.valor || 0);
                    let valorFaturamento = valorPedido;

                    // Preferir SUM(itens.subtotal) sobre pedido.valor para precisão
                    const [itensSum] = await connection.query(
                        'SELECT COUNT(*) as count, COALESCE(SUM(subtotal), 0) as total_itens FROM pedido_itens WHERE pedido_id = ?',
                        [id]
                    );
                    if (itensSum[0].count > 0 && parseFloat(itensSum[0].total_itens) > 0) {
                        valorFaturamento = parseFloat(itensSum[0].total_itens);
                    }

                    if (valorFaturamento > 0) {
                        const [existingCR] = await connection.query(
                            'SELECT id FROM contas_receber WHERE pedido_id = ? LIMIT 1', [id]
                        );
                        if (existingCR.length === 0) {
                            contaReceberGerada = await faturamentoShared.gerarContaReceber(connection, {
                                pedido_id: parseInt(id),
                                cliente_id: pedido.cliente_id || null,
                                descricao: `Faturamento Pedido #${id} - ${pedido.cliente || 'Cliente'}`,
                                valor: valorFaturamento,
                                tipo: 'faturamento',
                                pedido
                            });
                            console.log(`[FATURAR] Conta a receber #${contaReceberGerada?.insertId} gerada para pedido #${id} (R$${valorFaturamento})`);
                        } else {
                            console.log(`[FATURAR] Conta a receber já existe para pedido #${id} — pulando`);
                        }
                    }
                } catch (financeiroError) {
                    console.error('[FATURAR] Erro ao gerar conta a receber (não crítico):', financeiroError.message);
                }

                // 4e. Inicializar status_logistica para fila de logística
                try {
                    await connection.query(
                        `UPDATE pedidos SET status_logistica = 'pendente'
                         WHERE id = ? AND (status_logistica IS NULL OR status_logistica = '')`,
                        [id]
                    );
                } catch (logisticaError) {
                    console.error('[FATURAR] Erro ao inicializar status_logistica (não crítico):', logisticaError.message);
                }

                // 4f. Registrar histórico
                await connection.query(
                    'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        id, user.id || null, user.nome || user.name || 'Usuário', 'faturamento',
                        nfeData ? `Pedido faturado - NFe ${novaNf} emitida` : `Pedido faturado - NF ${novaNf}`,
                        JSON.stringify({ nf_numero: novaNf, valor: pedido.valor, nfe_gerada: !!nfeData, status_anterior: statusAnterior })
                    ]
                );

                await connection.commit();
            } catch (txError) {
                await connection.rollback();
                throw txError;
            }

            // 4g. EMISSÃO REAL DA NF-e À SEFAZ (in-process, fora da transação).
            // Substitui o antigo POST a localhost:3003 (serviço inexistente). Usa o motor
            // comprovado (cStat 100). Falha não desfaz o faturamento — NF fica pendente.
            if (gerarNFe && !nfeData && itensRows.length > 0) {
                try {
                    const { emitirNFePedido } = require('../services/nfe-emitter.service');
                    const itensEmitir = itensRows
                        .filter(it => Number(it.produto_id) > 0)
                        .map(it => ({
                            produto_id: Number(it.produto_id),
                            quantidade: Number(it.quantidade),
                            valor_unitario: Number(it.preco_unitario || it.valor_unitario) || 0
                        }))
                        .filter(it => it.quantidade > 0 && it.valor_unitario > 0);
                    if (itensEmitir.length > 0) {
                        const em = await emitirNFePedido(pool, {
                            pedidoId: parseInt(id), itens: itensEmitir, usuarioId: user.id || null
                        });
                        if (em.autorizado) {
                            novaNf = em.numero;
                            nfeData = { numero: em.numero, chave: em.chaveAcesso, protocolo: em.protocolo };
                            await pool.query(
                                'UPDATE pedidos SET nf = ?, numero_nf = ?, nfe_chave = ?, nfe_id = COALESCE(nfe_id, ?) WHERE id = ?',
                                [String(em.numero), String(em.numero), em.chaveAcesso, em.nfeId, id]
                            );
                        } else {
                            console.error(`[FATURAR] NF-e não autorizada p/ pedido ${id}: ${em.codigoStatus} ${em.motivo}`);
                        }
                    }
                } catch (emitErr) {
                    console.error('[FATURAR] Emissão SEFAZ falhou (pedido faturado, NF pendente):', emitErr.message);
                }
            }
            // Fallback: se nenhuma NF-e real foi emitida, garante número legado ao pedido.
            if (!novaNf) {
                const conn2 = await pool.getConnection();
                try {
                    await conn2.beginTransaction();
                    const nfData = await faturamentoShared.gerarProximoNumeroNFe(conn2);
                    novaNf = nfData.numero;
                    await conn2.query('UPDATE pedidos SET nf = ?, numero_nf = ? WHERE id = ?', [novaNf, novaNf, id]);
                    await conn2.commit();
                } catch (e) {
                    await conn2.rollback().catch(() => {});
                    console.error('[FATURAR] Falha ao reservar número fallback:', e.message);
                } finally {
                    conn2.release();
                }
            }

            // 5. Notificação (fora da transação)
            if (global.createNotification) {
                const nomeUsuario = user.nome || user.name || user.email || 'Usuário';
                const valorFormatado = (parseFloat(pedido.valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                global.createNotification(
                    'payment',
                    `Pedido #${id} → Faturado`,
                    `${nomeUsuario} faturou pedido - ${nfeData ? 'NFe' : 'NF'} ${novaNf} - ${valorFormatado}`,
                    {
                        pedido_id: id, nf_numero: novaNf, valor: pedido.valor,
                        nfe_data: nfeData, user_id: user.id || null, user_nome: nomeUsuario,
                        vendedor_id: pedido.vendedor_id || null,
                        status: 'faturado', status_label: 'Faturado', tipo: 'movimentacao_status'
                    }
                );
            }

            console.log(`[FATURAR] ✅ Pedido #${id} faturado — NF: ${novaNf} | por: ${user.nome || user.email || 'Usuário'}`);
            res.json({
                message: nfeData ? 'Pedido faturado e NFe gerada com sucesso!' : 'Pedido faturado com sucesso!',
                nf_numero: novaNf,
                nfe_gerada: !!nfeData,
                nfe_data: nfeData
            });

        } catch (error) {
            console.error('[FATURAR] Erro:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    router.post('/pedidos/:id/faturamento-parcial-legacy', async (req, res, next) => {
        // AUDIT-FIX R-07 + R-11: Transação completa com lock para evitar NF-e duplicada
        // FIX-2026-02-24: gerarNFe=true, faturamento por item, numeração unificada, validação estoque, CFOP inteligente
        const connection = await pool.getConnection();
        try {
            // AUDIT-FIX BUG-06: Verificar permissão de faturamento
            const user = req.user || {};
            if (!faturamentoShared.canFaturar(user)) {
                connection.release();
                return res.status(403).json({ success: false, message: 'Você não tem permissão para faturar pedidos.', code: 'FATURAMENTO_DENIED' });
            }

            await connection.beginTransaction();
            await ensureFaturamentoParcialTables();
            const { id } = req.params;
            const {
                tipo_faturamento = 'parcial_50',
                percentual = 50,
                cfop: cfopManual,
                gerarNFe = true,
                gerarFinanceiro = true,
                observacoes = '',
                itens_faturar = null
            } = req.body;

            // Lock do pedido para evitar faturamento concorrente
            const [pedidoRows] = await connection.query('SELECT p.*, c.estado as cliente_uf, e.estado as empresa_uf FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id LEFT JOIN empresas e ON p.empresa_id = e.id WHERE p.id = ? FOR UPDATE', [id]);
            if (pedidoRows.length === 0) { await connection.rollback(); connection.release(); return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' }); }

            const pedido = pedidoRows[0];
            if (pedido.status === 'cancelado') { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Nao e possivel faturar pedido cancelado.' }); }
            if (pedido.percentual_faturado >= 100) { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Pedido ja esta 100% faturado.' }); }

            // Bloquear faturamento de pedido cujo cliente está bloqueado por inadimplência
            if (pedido.cliente_id) {
                try {
                    const [bloqRows] = await connection.query('SELECT bloqueado_inadimplencia FROM clientes WHERE id = ? LIMIT 1', [pedido.cliente_id]);
                    if (bloqRows.length && Number(bloqRows[0].bloqueado_inadimplencia) === 1) {
                        await connection.rollback();
                        connection.release();
                        return res.status(403).json({ success: false, message: 'Cliente bloqueado por inadimplência. Regularize as contas a receber vencidas no módulo Financeiro (registre a baixa com comprovante) antes de faturar este pedido.', code: 'CLIENTE_INADIMPLENTE' });
                    }
                } catch (_inadimplenciaErr) {
                    // Coluna bloqueado_inadimplencia ainda não existe neste schema — não bloquear
                }
            }

            const valorTotal = parseFloat(pedido.valor) || 0;
            let percentualFaturar, valorFaturar;

            // FIX-5: Faturamento por item — se itens_faturar é fornecido, calcular valor a partir dos itens
            if (itens_faturar && Array.isArray(itens_faturar) && itens_faturar.length > 0) {
                // Buscar itens do pedido para validação
                const [itensPedido] = await connection.query(`
                    SELECT pi.*, p.descricao as produto_descricao, p.estoque_atual,
                        COALESCE(p.controla_estoque, 1) as controla_estoque,
                        COALESCE((SELECT SUM(nfi.quantidade) FROM nfe_itens nfi INNER JOIN nfe n ON nfi.nfe_id = n.id WHERE n.pedido_id = pi.pedido_id AND nfi.produto_id = pi.produto_id AND n.status != 'cancelada'), 0) as qtd_ja_faturada
                    FROM pedido_itens pi
                    INNER JOIN produtos p ON pi.produto_id = p.id
                    WHERE pi.pedido_id = ?
                `, [id]);

                // Validar cada item
                valorFaturar = 0;
                const problemas = [];
                for (const itemFat of itens_faturar) {
                    const itemPedido = itensPedido.find(i => i.produto_id === itemFat.produto_id);
                    if (!itemPedido) {
                        problemas.push(`Produto ID ${itemFat.produto_id} nao encontrado no pedido`);
                        continue;
                    }
                    const qtdRestante = parseFloat(itemPedido.quantidade) - parseFloat(itemPedido.qtd_ja_faturada);
                    if (parseFloat(itemFat.quantidade) > qtdRestante) {
                        problemas.push(`Produto ${itemPedido.produto_descricao}: solicitado ${itemFat.quantidade}, disponivel ${qtdRestante}`);
                    }
                    // Validar estoque disponível — somente para produtos que controlam estoque (controla_estoque = 1)
                    // Produtos fabricados sob encomenda (controla_estoque = 0) não bloqueiam por falta de estoque
                    if (parseInt(itemPedido.controla_estoque) !== 0 && parseFloat(itemPedido.estoque_atual || 0) < parseFloat(itemFat.quantidade)) {
                        problemas.push(`Produto ${itemPedido.produto_descricao}: estoque insuficiente (${itemPedido.estoque_atual || 0} disponivel, ${itemFat.quantidade} solicitado)`);
                    }
                    valorFaturar += parseFloat(itemFat.quantidade) * parseFloat(itemPedido.preco_unitario || 0);
                }

                if (problemas.length > 0) {
                    await connection.rollback(); connection.release();
                    return res.status(400).json({ success: false, message: 'Validacao falhou', problemas });
                }

                // AUDIT-FIX 2026-04-03: Deduzir estoque dos itens faturados parcialmente
                // FIX-02-v2: Corrigido para usar colunas reais da tabela estoque_movimentacoes
                for (const itemFat of itens_faturar) {
                    const itemPedido = itensPedido.find(i => i.produto_id === itemFat.produto_id);
                    if (itemPedido && parseInt(itemPedido.controla_estoque) !== 0 && parseFloat(itemFat.quantidade) > 0) {
                        // Verificar se já existe movimentação para este faturamento parcial (idempotência)
                        const [existingMov] = await connection.query(
                            `SELECT id FROM estoque_movimentacoes
                             WHERE documento_tipo = 'faturamento_parcial' AND documento_id = ?
                               AND codigo_material = ? AND tipo_movimento = 'saida'
                               AND quantidade = ?
                             LIMIT 1`,
                            [id, itemPedido.produto_descricao ? (itemPedido.codigo || itemPedido.produto_descricao) : String(itemFat.produto_id), itemFat.quantidade]
                        );
                        if (existingMov.length === 0) {
                            const estoqueAnterior = parseFloat(itemPedido.estoque_atual || 0);
                            const novoEstoque = estoqueAnterior - parseFloat(itemFat.quantidade);
                            await connection.query(
                                'UPDATE produtos SET estoque_atual = ? WHERE id = ?',
                                [novoEstoque, itemFat.produto_id]
                            );
                            // Buscar codigo do produto para usar como codigo_material
                            const [prodInfo] = await connection.query(
                                'SELECT codigo FROM produtos WHERE id = ? LIMIT 1',
                                [itemFat.produto_id]
                            );
                            const codigoMaterial = prodInfo[0]?.codigo || String(itemFat.produto_id);
                            await connection.query(
                                `INSERT INTO estoque_movimentacoes
                                 (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                  documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                 VALUES (?, 'saida', 'faturamento_parcial', ?, ?, ?, 'faturamento_parcial', ?, ?, ?, NOW())`,
                                [codigoMaterial, itemFat.quantidade, estoqueAnterior, novoEstoque,
                                 id, user.id || null, `Faturamento parcial - Pedido #${id} - ${itemFat.quantidade}${itemPedido.unidade || 'UN'}`]
                            );
                            if (novoEstoque < 0) {
                                console.warn(`[ESTOQUE_PARCIAL] ⚠️ Produto ${codigoMaterial} ficará negativo (${estoqueAnterior} -> ${novoEstoque}). Pedido #${id}`);
                            }
                        }
                    }
                }

                percentualFaturar = valorTotal > 0 ? Math.round((valorFaturar / valorTotal) * 10000) / 100 : 0;
                percentualFaturar = Math.min(percentualFaturar, 100 - (parseFloat(pedido.percentual_faturado) || 0));
            } else {
                // Modo percentual (legado)
                percentualFaturar = Math.min(parseFloat(percentual), 100 - (parseFloat(pedido.percentual_faturado) || 0));
                valorFaturar = Math.round((valorTotal * percentualFaturar) / 100 * 100) / 100;
            }

            // CFOP inteligente via serviço compartilhado
            const ufEmpresa = (pedido.empresa_uf || 'MG').toUpperCase();
            const ufCliente = (pedido.cliente_uf || pedido.estado || '').toUpperCase();
            const tipoOp = (tipo_faturamento === 'normal' || percentualFaturar >= 100) ? 'venda' : 'faturamento';
            const cfopResult = await faturamentoShared.determinarCFOP(tipoOp, ufEmpresa, ufCliente, cfopManual);
            const cfop = cfopResult.cfop;

            // Numeração unificada via serviço compartilhado (verifica nfe + pedidos faturamento + pedidos remessa)
            const nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const novoNfNumero = nfNumero.numero;

            const novoPercentualFaturado = Math.round(((parseFloat(pedido.percentual_faturado) || 0) + percentualFaturar) * 100) / 100;
            const novoValorFaturado = Math.round(((parseFloat(pedido.valor_faturado) || 0) + valorFaturar) * 100) / 100;
            const novoStatus = novoPercentualFaturado >= 100 ? 'faturado' : 'parcial';

            await connection.query(`
                UPDATE pedidos SET tipo_faturamento = ?, percentual_faturado = ?, valor_faturado = ?,
                    valor_pendente = ? - ?, nfe_faturamento_numero = ?, nfe_faturamento_cfop = ?,
                    status = ?, data_faturamento = IF(data_faturamento IS NULL, NOW(), data_faturamento)
                WHERE id = ?
            `, [tipo_faturamento, novoPercentualFaturado, novoValorFaturado, valorTotal, novoValorFaturado, novoNfNumero, cfop, novoStatus, id]);

            // Calcular sequência corretamente
            const [seqRows] = await connection.query('SELECT COALESCE(MAX(sequencia), 0) + 1 as proxSeq FROM pedido_faturamentos WHERE pedido_id = ?', [id]);
            const proxSeq = seqRows[0].proxSeq;

            const [fatResult] = await connection.query(`
                INSERT INTO pedido_faturamentos (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, baixa_estoque, usuario_id, usuario_nome, observacoes)
                VALUES (?, ?, 'faturamento', ?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, proxSeq, percentualFaturar, valorFaturar, novoNfNumero, cfop, itens_faturar ? 1 : 0, user.id || null, user.nome || 'Sistema', observacoes]);

            await registrarHistoricoPedido(id, user.id, user.nome || 'Sistema', 'faturamento_parcial',
                `Faturamento Parcial (${percentualFaturar}%) - NF ${novoNfNumero} - CFOP ${cfop} - R$ ${valorFaturar.toFixed(2)}`,
                { tipo: 'faturamento', percentual: percentualFaturar, valor: valorFaturar, nf_numero: novoNfNumero, cfop, baixa_estoque: !!itens_faturar, itens_faturar: itens_faturar || 'percentual' });

            let contaReceberId = null;
            if (gerarFinanceiro) {
                try {
                    // Vencimento inteligente: usa condicao_pagamento do pedido, ou prazo padrão do config
                    const contaResult = await faturamentoShared.gerarContaReceber(connection, {
                        pedido_id: id,
                        cliente_id: pedido.cliente_id || pedido.empresa_id,
                        descricao: `Faturamento ${percentualFaturar}% - Pedido #${id}`,
                        valor: valorFaturar,
                        tipo: 'faturamento_parcial',
                        pedido: pedido
                    });
                    contaReceberId = contaResult.insertId;
                    await connection.query('UPDATE pedido_faturamentos SET conta_receber_id = ? WHERE id = ?', [contaReceberId, fatResult.insertId]);
                } catch (finErr) { console.warn('[FATURAMENTO_PARCIAL] Erro financeiro:', finErr.message); }
            }

            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: `Faturamento parcial de ${percentualFaturar}% realizado com sucesso!`,
                dados: {
                    pedido_id: id, nf_numero: novoNfNumero, cfop,
                    percentual_faturado: novoPercentualFaturado, valor_faturado: novoValorFaturado,
                    valor_pendente: Math.round((valorTotal - novoValorFaturado) * 100) / 100, baixa_estoque: !!itens_faturar,
                    conta_receber_id: contaReceberId,
                    modo: itens_faturar ? 'por_item' : 'percentual',
                    proximo_passo: novoPercentualFaturado < 100 ? 'Aguardando remessa para completar faturamento' : 'Faturamento completo'
                }
            });
        } catch (error) {
            try { await connection.rollback(); } catch (e) { /* ignore */ }
            try { connection.release(); } catch (e) { /* ignore */ }
            console.error('[FATURAMENTO_PARCIAL] Erro:', error);
            next(error);
        }
    });

    router.post('/pedidos/:id/remessa-entrega-legacy', async (req, res, next) => {
        // AUDIT-FIX R-07 + R-11: Transação completa com lock para NF-e remessa
        // FIX-2026-02-24: Rollback estoque, numeração unificada, sync estoque table, CFOP inteligente
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { cfop: cfopManual, gerarNFe = true, gerarFinanceiro = true, baixarEstoque = true, observacoes = '' } = req.body;
            const user = req.user || {};

            // AUDIT-FIX BUG-07: Verificar permissão de faturamento
            if (!faturamentoShared.canFaturar(user)) {
                connection.release();
                return res.status(403).json({ success: false, message: 'Você não tem permissão para operações de remessa.', code: 'FATURAMENTO_DENIED' });
            }

            await connection.beginTransaction();
            await ensureFaturamentoParcialTables();

            // Lock do pedido com UF para CFOP inteligente
            const [pedidoRows] = await connection.query('SELECT p.*, c.estado as cliente_uf, e.estado as empresa_uf FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id LEFT JOIN empresas e ON p.empresa_id = e.id WHERE p.id = ? FOR UPDATE', [id]);
            if (pedidoRows.length === 0) { await connection.rollback(); connection.release(); return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' }); }

            const pedido = pedidoRows[0];
            if (pedido.estoque_baixado === 1) { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Estoque ja foi baixado para este pedido.' }); }
            if (pedido.tipo_faturamento === 'normal') { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Este pedido nao e de faturamento parcial.' }); }

            if (pedido.cliente_id) {
                try {
                    const [bloqRows] = await connection.query('SELECT bloqueado_inadimplencia FROM clientes WHERE id = ? LIMIT 1', [pedido.cliente_id]);
                    if (bloqRows.length && Number(bloqRows[0].bloqueado_inadimplencia) === 1) {
                        await connection.rollback();
                        connection.release();
                        return res.status(403).json({
                            success: false,
                            message: 'Cliente bloqueado por inadimplência. Regularize as contas a receber vencidas no módulo Financeiro (registre a baixa com comprovante) antes de faturar este pedido.',
                            code: 'CLIENTE_INADIMPLENTE'
                        });
                    }
                } catch (_) {
                    // Coluna bloqueado_inadimplencia ainda não existe neste schema.
                }
            }

            const valorTotal = parseFloat(pedido.valor) || 0;
            const valorFaturado = parseFloat(pedido.valor_faturado) || 0;
            const valorRestante = Math.round((valorTotal - valorFaturado) * 100) / 100;
            const percentualRestante = Math.round((100 - (parseFloat(pedido.percentual_faturado) || 0)) * 100) / 100;

            // FIX-6: Validar estoque ANTES de baixar — rollback se insuficiente
            // Produtos com controla_estoque = 0 são fabricados sob encomenda e não bloqueiam por falta de estoque
            if (baixarEstoque) {
                const [itensCheck] = await connection.query('SELECT pi.produto_id, pi.quantidade, p.descricao, p.estoque_atual, COALESCE(p.controla_estoque, 1) as controla_estoque FROM pedido_itens pi INNER JOIN produtos p ON pi.produto_id = p.id WHERE pi.pedido_id = ?', [id]);
                const estoqueProblemas = [];
                for (const item of itensCheck) {
                    if (parseInt(item.controla_estoque) === 0) continue; // sob encomenda — sem bloqueio de estoque
                    const estAtual = parseFloat(item.estoque_atual) || 0;
                    const qtdNecessaria = parseFloat(item.quantidade) || 0;
                    if (estAtual < qtdNecessaria) {
                        estoqueProblemas.push(`${item.descricao}: disponivel ${estAtual}, necessario ${qtdNecessaria} (faltam ${Math.round((qtdNecessaria - estAtual) * 100) / 100})`);
                    }
                }
                if (estoqueProblemas.length > 0) {
                    await connection.rollback(); connection.release();
                    return res.status(400).json({ success: false, message: 'Estoque insuficiente para remessa. Transação abortada.', problemas: estoqueProblemas });
                }
            }

            // CFOP inteligente via serviço compartilhado
            const ufEmpresa = (pedido.empresa_uf || 'MG').toUpperCase();
            const ufCliente = (pedido.cliente_uf || '').toUpperCase();
            const cfopResult = await faturamentoShared.determinarCFOP('remessa', ufEmpresa, ufCliente, cfopManual);
            const cfop = cfopResult.cfop;

            // Numeração unificada via serviço compartilhado
            const nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const novoNfRemessa = nfNumero.numero;

            await connection.query(`
                UPDATE pedidos SET percentual_faturado = 100, valor_faturado = ?, valor_pendente = 0,
                    estoque_baixado = 1, data_baixa_estoque = NOW(), nfe_remessa_numero = ?,
                    nfe_remessa_cfop = ?, status = 'faturado', data_entrega_efetiva = NOW()
                WHERE id = ?
            `, [valorTotal, novoNfRemessa, cfop, id]);

            // Sequência correta de faturamentos
            const [seqRows] = await connection.query('SELECT COALESCE(MAX(sequencia), 0) + 1 as proxSeq FROM pedido_faturamentos WHERE pedido_id = ?', [id]);
            const proxSeq = seqRows[0].proxSeq;

            const [fatResult] = await connection.query(`
                INSERT INTO pedido_faturamentos (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, baixa_estoque, usuario_id, usuario_nome, observacoes)
                VALUES (?, ?, 'remessa', ?, ?, ?, ?, 1, ?, ?, ?)
            `, [id, proxSeq, percentualRestante, valorRestante, novoNfRemessa, cfop, user.id || null, user.nome || 'Sistema', observacoes]);

            if (baixarEstoque) {
                const [itens] = await connection.query('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                if (itens.length > 0) {
                    // Batch INSERT for estoque_movimentos
                    const movValues = itens.map(item => [
                        item.produto_id, item.quantidade, id, `Remessa pedido #${id}`, user.id || null
                    ]);
                    const movPlaceholders = movValues.map(() => "(?, 'saida', ?, 'remessa', ?, ?, ?)").join(', ');
                    await connection.query(
                        `INSERT INTO estoque_movimentos (produto_id, tipo, quantidade, referencia_tipo, referencia_id, observacoes, usuario_id) VALUES ${movPlaceholders}`,
                        movValues.flat()
                    );
                    // FIX-6: Estoque agora faz rollback se insuficiente (validado acima)
                    for (const item of itens) {
                        await connection.query(`UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?`, [item.quantidade, item.produto_id]);
                    }
                    // FIX-2: Sync tabela estoque (Enterprise) se existir
                    try {
                        for (const item of itens) {
                            await connection.query(`UPDATE estoque SET quantidade_disponivel = GREATEST(0, quantidade_disponivel - ?) WHERE produto_id = ?`, [item.quantidade, item.produto_id]);
                        }
                    } catch (syncErr) { /* tabela estoque pode não existir ainda */ }
                }
            }

            await registrarHistoricoPedido(id, user.id, user.nome || 'Sistema', 'remessa_entrega',
                `Remessa/Entrega - NF ${novoNfRemessa} - CFOP ${cfop} - R$ ${valorRestante.toFixed(2)} - Estoque baixado`,
                { tipo: 'remessa', percentual: percentualRestante, valor: valorRestante, nf_numero: novoNfRemessa, cfop, baixa_estoque: true });

            let contaReceberId = null;
            if (gerarFinanceiro && valorRestante > 0) {
                try {
                    // Vencimento inteligente: usa condicao_pagamento do pedido, ou prazo padrão do config
                    const contaResult = await faturamentoShared.gerarContaReceber(connection, {
                        pedido_id: id,
                        cliente_id: pedido.cliente_id || pedido.empresa_id,
                        descricao: `Remessa/Entrega - Pedido #${id}`,
                        valor: valorRestante,
                        tipo: 'remessa_entrega',
                        pedido: pedido
                    });
                    contaReceberId = contaResult.insertId;
                    await connection.query('UPDATE pedido_faturamentos SET conta_receber_id = ? WHERE id = ?', [contaReceberId, fatResult.insertId]);
                } catch (finErr) { console.warn('[REMESSA] Erro financeiro:', finErr.message); }
            }

            await connection.commit();
            connection.release();

            res.json({
                success: true, message: 'Remessa/Entrega realizada com sucesso! Estoque baixado.',
                dados: { pedido_id: id, nf_remessa: novoNfRemessa, cfop, percentual_faturado: 100, valor_total: valorTotal, estoque_baixado: true, conta_receber_id: contaReceberId, status: 'Faturamento completo' }
            });
        } catch (error) {
            try { await connection.rollback(); } catch (e) { /* ignore */ }
            try { connection.release(); } catch (e) { /* ignore */ }
            console.error('[REMESSA] Erro:', error);
            next(error);
        }
    });

    router.get('/pedidos/:id/faturamento-status', async (req, res, next) => {
        try {
            await ensureFaturamentoParcialTables();
            const { id } = req.params;

            const [pedidoRows] = await pool.query(`SELECT p.*, e.nome_fantasia as empresa_nome, e.estado as empresa_uf, c.estado as cliente_uf FROM pedidos p LEFT JOIN empresas e ON p.empresa_id = e.id LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?`, [id]);
            if (pedidoRows.length === 0) return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' });

            const pedido = pedidoRows[0];
            const [faturamentos] = await pool.query(`SELECT id, pedido_id, sequencia, tipo, valor, percentual, nfe_numero, nfe_chave, nfe_cfop AS cfop, created_at AS data_faturamento, nfe_status AS status, observacoes, created_at FROM pedido_faturamentos WHERE pedido_id = ? ORDER BY sequencia ASC`, [id]);

            let proximaAcao = null, cfopSugerido = null;
            const ufClienteStatus = (pedido.cliente_uf || '').toUpperCase();
            const ufEmpresaStatus = (pedido.empresa_uf || 'MG').toUpperCase();
            // CFOP via serviço compartilhado (usa mapa centralizado com Zona Franca e interestadual)
            let cfopRemessaSugerido = null;
            if (pedido.tipo_faturamento && pedido.tipo_faturamento !== 'normal') {
                const [origemRows] = await pool.query(
                    `SELECT
                        SUM(CASE WHEN COALESCE(p.controla_estoque, 1) = 0 THEN 1 ELSE 0 END) AS producao_propria,
                        SUM(CASE WHEN COALESCE(p.controla_estoque, 1) <> 0 THEN 1 ELSE 0 END) AS terceiros
                     FROM pedido_itens pi
                     INNER JOIN produtos p ON p.id = pi.produto_id
                     WHERE pi.pedido_id = ?`,
                    [id]
                );
                const temProducaoPropria = Number(origemRows[0]?.producao_propria) > 0;
                const temTerceiros = Number(origemRows[0]?.terceiros) > 0;
                if (!(temProducaoPropria && temTerceiros)) {
                    cfopRemessaSugerido = determineRemessaCfop(
                        ufEmpresaStatus,
                        ufClienteStatus,
                        temProducaoPropria
                    );
                }
            }

            if (pedido.tipo_faturamento === 'normal' || !pedido.tipo_faturamento) {
                proximaAcao = 'faturamento_normal';
                const r = await faturamentoShared.determinarCFOP('venda', ufEmpresaStatus, ufClienteStatus);
                cfopSugerido = r.cfop;
            } else if (pedido.percentual_faturado < 100) {
                proximaAcao = 'aguardando_remessa';
                cfopSugerido = cfopRemessaSugerido;
            } else if (!pedido.estoque_baixado) {
                proximaAcao = 'aguardando_baixa_estoque';
                cfopSugerido = cfopRemessaSugerido;
            } else { proximaAcao = 'completo'; }

            res.json({
                success: true,
                pedido: { id: pedido.id, numero: pedido.numero, status: pedido.status, tipo_faturamento: pedido.tipo_faturamento || 'normal', valor_total: parseFloat(pedido.valor) || 0, percentual_faturado: parseFloat(pedido.percentual_faturado) || 0, valor_faturado: parseFloat(pedido.valor_faturado) || 0, valor_pendente: parseFloat(pedido.valor_pendente) || 0, estoque_baixado: pedido.estoque_baixado === 1, nfe_faturamento: pedido.nfe_faturamento_numero, nfe_remessa: pedido.nfe_remessa_numero, empresa_nome: pedido.empresa_nome, empresa_uf: pedido.empresa_uf },
                faturamentos, proxima_acao: proximaAcao, cfop_sugerido: cfopSugerido,
                resumo: { etapa_1: pedido.nfe_faturamento_numero ? 'concluido' : 'pendente', etapa_2: pedido.nfe_remessa_numero ? 'concluido' : 'pendente' }
            });
        } catch (error) { next(error); }
    });

    router.get('/faturamento/parciais-pendentes', async (req, res, next) => {
        try {
            await ensureFaturamentoParcialTables();
            const [rows] = await pool.query(`
                SELECT p.*, e.nome_fantasia as empresa_nome, u.nome as vendedor_nome
                FROM pedidos p LEFT JOIN empresas e ON p.empresa_id = e.id LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.tipo_faturamento IN ('parcial_50', 'entrega_futura') AND (p.percentual_faturado < 100 OR p.estoque_baixado = 0) AND p.status NOT IN ('cancelado', 'denegado')
                ORDER BY p.created_at DESC
            `);
            res.json({
                success: true, total: rows.length,
                pedidos: rows.map(p => ({ id: p.id, numero: p.numero, empresa: p.empresa_nome, vendedor: p.vendedor_nome, valor_total: parseFloat(p.valor) || 0, percentual_faturado: parseFloat(p.percentual_faturado) || 0, valor_pendente: parseFloat(p.valor_pendente) || 0, estoque_baixado: p.estoque_baixado === 1, proxima_acao: p.percentual_faturado < 100 ? 'Emitir Remessa' : 'Baixar Estoque', created_at: p.created_at }))
            });
        } catch (error) { next(error); }
    });

    // ============================================================
    // DANFE — Geração de Documento Auxiliar da NF-e
    // GET /api/vendas/pedidos/:id/danfe
    // ============================================================
    router.get('/pedidos/:id/danfe', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;
            const isPreview = req.query.preview === '1';

            // Buscar pedido completo com cliente e empresa
            const [[pedido]] = await pool.query(`
                SELECT p.*, p.valor as valor_total,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_nome,
                       COALESCE(c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_razao_social,
                       COALESCE(c.cnpj, c.cnpj_cpf) AS cliente_cnpj,
                       COALESCE(c.cpf) AS cliente_cpf,
                       c.inscricao_estadual AS cliente_ie,
                       COALESCE(c.email, p.email_cliente) AS cliente_email,
                       c.telefone AS cliente_telefone,
                       c.endereco AS cliente_endereco, c.bairro AS cliente_bairro,
                       c.cidade AS cliente_cidade, c.estado AS cliente_estado,
                       c.cep AS cliente_cep,
                       e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
                       e.cnpj AS empresa_cnpj, e.inscricao_estadual AS empresa_ie,
                       e.endereco AS empresa_endereco, e.bairro AS empresa_bairro,
                       e.cidade AS empresa_cidade, e.estado AS empresa_uf, e.cep AS empresa_cep,
                       e.telefone AS empresa_telefone,
                       t.razao_social AS transportadora_razao_social,
                       t.nome_fantasia AS transportadora_nome_fantasia,
                       t.cnpj_cpf AS transportadora_cnpj_cpf,
                       t.inscricao_estadual AS transportadora_inscricao_estadual,
                       t.endereco AS transportadora_endereco,
                       t.cidade AS transportadora_cidade,
                       t.estado AS transportadora_estado
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.id = ?
            `, [id]);

            if (!pedido) {
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }

            // Se cliente_id NULL mas temos cliente_nome, tentar resolver pelo nome
            if (!pedido.cliente_cnpj && (pedido.cliente_nome || pedido.cliente)) {
                try {
                    const nomeBusca = pedido.cliente_nome || pedido.cliente;
                    const [[clienteMatch]] = await pool.query(
                        `SELECT COALESCE(cnpj, cnpj_cpf) AS cnpj, cpf, inscricao_estadual,
                                endereco, bairro, cidade, estado, cep, telefone, email,
                                razao_social, nome_fantasia
                         FROM clientes WHERE razao_social = ? OR nome = ? OR nome_fantasia = ? LIMIT 1`,
                        [nomeBusca, nomeBusca, nomeBusca]
                    );
                    if (clienteMatch) {
                        pedido.cliente_razao_social = clienteMatch.razao_social || pedido.cliente_razao_social;
                        pedido.cliente_cnpj = clienteMatch.cnpj || '';
                        pedido.cliente_cpf = clienteMatch.cpf || '';
                        pedido.cliente_ie = clienteMatch.inscricao_estadual || '';
                        pedido.cliente_endereco = clienteMatch.endereco || '';
                        pedido.cliente_bairro = clienteMatch.bairro || '';
                        pedido.cliente_cidade = clienteMatch.cidade || '';
                        pedido.cliente_estado = clienteMatch.estado || '';
                        pedido.cliente_cep = clienteMatch.cep || '';
                        pedido.cliente_telefone = clienteMatch.telefone || '';
                        pedido.cliente_email = clienteMatch.email || '';
                    }
                } catch (e) { /* best-effort */ }
            }

            // Sempre usar dados da empresa configurada (ALUFORCE) como emitente
            const [[cfgEmpresa]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
            if (cfgEmpresa) {
                pedido.empresa_razao_social = cfgEmpresa.razao_social;
                pedido.empresa_nome = cfgEmpresa.nome_fantasia;
                pedido.empresa_cnpj = cfgEmpresa.cnpj;
                pedido.empresa_ie = cfgEmpresa.inscricao_estadual;
                pedido.empresa_endereco = cfgEmpresa.endereco + (cfgEmpresa.numero ? ', ' + cfgEmpresa.numero : '');
                pedido.empresa_bairro = cfgEmpresa.bairro;
                pedido.empresa_cidade = cfgEmpresa.cidade;
                pedido.empresa_uf = cfgEmpresa.estado;
                pedido.empresa_cep = cfgEmpresa.cep;
                pedido.empresa_telefone = cfgEmpresa.telefone;
            }

            // Buscar configuração fiscal da empresa para defaults
            const [[cfgFiscal]] = await pool.query('SELECT * FROM config_fiscal_empresa LIMIT 1').catch(() => [[]]);

            // Em modo preview, NF não precisa estar emitida
            if (!isPreview) {
                let nfNumero = pedido.nf || pedido.numero_nf || pedido.nfe_faturamento_numero || pedido.nfe_remessa_numero;
                // O fluxo real de emissão (/api/faturamento) grava na tabela `nfes` e seta
                // pedido.nfe_id, mas NÃO preenche pedido.nf — resolver a NF-e autorizada aqui
                // para o DANFE não bloquear pedidos faturados de verdade.
                if (!nfNumero || !pedido.nfe_chave) {
                    try {
                        const [[nfeRow]] = await pool.query(
                            `SELECT numero, chave_acesso, protocolo_autorizacao, status
                               FROM nfes
                              WHERE id = ? OR pedido_id = ?
                           ORDER BY (status = 'autorizada') DESC, id DESC
                              LIMIT 1`,
                            [pedido.nfe_id || 0, id]
                        );
                        if (nfeRow && (nfeRow.chave_acesso || nfeRow.numero)) {
                            nfNumero = nfNumero || nfeRow.numero;
                            pedido.nf = pedido.nf || nfeRow.numero;
                            pedido.numero_nf = pedido.numero_nf || nfeRow.numero;
                            pedido.nfe_chave = pedido.nfe_chave || nfeRow.chave_acesso;
                            pedido.nfe_protocolo = pedido.nfe_protocolo || nfeRow.protocolo_autorizacao;
                        }
                    } catch (_) { /* tabela nfes pode não existir nesta instância */ }
                }
                if (!nfNumero) {
                    return res.status(404).json({ message: 'Este pedido não possui Nota Fiscal emitida. Use ?preview=1 para visualizar sem NF.' });
                }
            }

            // Buscar itens do pedido com dados fiscais
            let itens = [];
            try {
                const [rows] = await pool.query(`
                    SELECT pi.codigo, pi.descricao, pi.quantidade, pi.unidade, pi.preco_unitario,
                           pi.desconto, pi.subtotal, pi.produto_id,
                           pi.icms_percent, pi.icms_value, pi.aliquota_icms, pi.aliquota_ipi,
                           pi.valor_ipi, pi.valor_icms_st, pi.cfop,
                           pi.pis_percent, pi.pis_value, pi.cofins_percent, pi.cofins_value,
                           COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                           COALESCE(pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS produto_cfop,
                           COALESCE(pr_id.cst_icms, pr_cod.cst_icms) AS produto_cst_icms,
                           COALESCE(pr_id.csosn_icms, pr_cod.csosn_icms) AS produto_csosn_icms,
                           COALESCE(pr_id.aliquota_icms, pr_cod.aliquota_icms) AS produto_aliquota_icms,
                           COALESCE(pr_id.aliquota_ipi, pr_cod.aliquota_ipi) AS produto_aliquota_ipi,
                           COALESCE(pr_id.aliquota_pis, pr_cod.aliquota_pis) AS produto_aliquota_pis,
                           COALESCE(pr_id.aliquota_cofins, pr_cod.aliquota_cofins) AS produto_aliquota_cofins
                    FROM pedido_itens pi
                    LEFT JOIN produtos pr_id ON pi.produto_id = pr_id.id
                    LEFT JOIN produtos pr_cod ON pi.produto_id IS NULL AND pr_cod.codigo = pi.codigo
                    WHERE pi.pedido_id = ? ORDER BY pi.id ASC
                `, [id]);
                itens = rows;
            } catch (e) { /* tabela pode não existir */ }

            // Se não tem itens, tentar do preview
            if (itens.length === 0) {
                try {
                    itens = JSON.parse(pedido.produtos_preview || '[]').map(item => ({
                        codigo: item.codigo || '-',
                        descricao: item.descricao || item.nome || '-',
                        quantidade: parseFloat(item.quantidade) || 1,
                        unidade: item.unidade || 'UN',
                        preco_unitario: parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0,
                        desconto: parseFloat(item.desconto) || 0,
                        subtotal: parseFloat(item.subtotal || item.total) || 0
                    }));
                } catch (e) { itens = []; }
            }

            // Resolver logo da empresa como data-URI para embutir no HTML
            const { resolverCaminhoLogo } = require('../modules/_shared/services/empresa-config.service');
            let logoDataUri = '';
            try {
                const logoAbsPath = resolverCaminhoLogo(cfgEmpresa || {});
                if (logoAbsPath && fs.existsSync(logoAbsPath)) {
                    const logoBuffer = fs.readFileSync(logoAbsPath);
                    const ext = path.extname(logoAbsPath).toLowerCase().replace('.', '');
                    const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
                    logoDataUri = `data:${mime};base64,${logoBuffer.toString('base64')}`;
                }
            } catch (logoErr) {
                console.warn('[DANFE] Falha ao resolver logo:', logoErr.message);
            }

            // Gerar HTML da DANFE usando template oficial (routes/danfe-renderer.js)
            const { renderDanfe, buildDanfeCtx } = require('./danfe-renderer');
            const danfeHTML = renderDanfe(buildDanfeCtx(pedido, itens, { preview: isPreview, cfgFiscal, logoDataUri }));

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="danfe-pedido-${id}.html"`);
            res.send(danfeHTML);

        } catch (error) {
            console.error('[DANFE] Erro ao gerar:', error);
            next(error);
        }
    });

    router.get('/pedidos/:id/recibo', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;

            const [[pedido]] = await pool.query(`
                SELECT p.*,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente, 'Cliente') AS cliente_nome,
                       COALESCE(c.cnpj, c.cnpj_cpf, c.cpf, '') AS cliente_doc,
                       COALESCE(c.endereco, '') AS cliente_endereco,
                       COALESCE(c.cidade, '') AS cliente_cidade,
                       COALESCE(c.estado, '') AS cliente_estado,
                       COALESCE(u.nome, '') AS vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.id = ?
                LIMIT 1
            `, [id]);

            if (!pedido) {
                return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
            }

            const [[cfg]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1').catch(() => [[null]]);
            const empresa = cfg || {
                razao_social: 'ALUFORCE',
                nome_fantasia: 'ALUFORCE',
                cnpj: '',
                endereco: '',
                cidade: '',
                estado: ''
            };

            const valor = Number(pedido.valor_total || pedido.valor || 0);
            const valorFmt = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const dataEmissao = new Date(pedido.data_faturamento || pedido.updated_at || pedido.created_at || Date.now());
            const dataFmt = dataEmissao.toLocaleDateString('pt-BR');

            // Valor por extenso (simplificado)
            function valorExtenso(v) {
                const inteiro = Math.floor(v);
                const cents = Math.round((v - inteiro) * 100);
                return `${inteiro.toLocaleString('pt-BR')} reais${cents > 0 ? ` e ${cents} centavos` : ''}`;
            }

            const esc = s => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Recibo Pedido #${esc(pedido.id)}</title>
<style>
  body { font-family: 'Inter', Arial, sans-serif; max-width: 780px; margin: 32px auto; padding: 0 24px; color: #111; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 24px; }
  .header h1 { margin: 0; font-size: 28px; letter-spacing: 2px; }
  .empresa { font-size: 12px; color: #555; text-align: right; }
  .numero { background: #f4f4f4; padding: 12px 16px; border-radius: 6px; display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 14px; }
  .valor-destaque { font-size: 32px; font-weight: 700; color: #1e40af; text-align: center; margin: 24px 0; padding: 16px; background: #eff6ff; border-radius: 8px; }
  .bloco { margin: 16px 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; line-height: 1.6; }
  .bloco strong { display: inline-block; min-width: 110px; color: #444; }
  .assinatura { margin-top: 64px; text-align: center; }
  .assinatura .linha { border-top: 1px solid #111; width: 60%; margin: 0 auto 8px; }
  .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #888; }
  @media print {
    body { margin: 0; }
    .no-print { display: none; }
  }
  .print-btn { background: #1e40af; color: #fff; border: 0; padding: 10px 18px; border-radius: 6px; cursor: pointer; margin-bottom: 16px; }
</style>
</head>
<body>
  <button class="no-print print-btn" onclick="window.print()">🖨️ Imprimir</button>

  <div class="header">
    <div>
      <h1>RECIBO</h1>
      <div style="font-size:11px;color:#666;">Comprovante de recebimento</div>
    </div>
    <div class="empresa">
      <strong>${esc(empresa.razao_social || empresa.nome_fantasia)}</strong><br>
      ${esc(empresa.cnpj ? 'CNPJ: ' + empresa.cnpj : '')}<br>
      ${esc([empresa.endereco, empresa.cidade, empresa.estado].filter(Boolean).join(' - '))}
    </div>
  </div>

  <div class="numero">
    <div><strong>Recibo nº:</strong> ${String(pedido.id).padStart(6, '0')}</div>
    <div><strong>Pedido:</strong> #${esc(pedido.numero_pedido || pedido.id)}</div>
    <div><strong>Data:</strong> ${esc(dataFmt)}</div>
  </div>

  <div class="valor-destaque">
    ${esc(valorFmt)}
  </div>

  <div class="bloco">
    Recebi(emos) de <strong>${esc(pedido.cliente_nome)}</strong>${pedido.cliente_doc ? ' (CNPJ/CPF: ' + esc(pedido.cliente_doc) + ')' : ''},
    a importância de <strong>${esc(valorFmt)}</strong> (${esc(valorExtenso(valor))}),
    referente ao pedido nº <strong>#${esc(pedido.numero_pedido || pedido.id)}</strong>${pedido.nf || pedido.numero_nf ? ', NF-e nº ' + esc(pedido.nf || pedido.numero_nf) : ''},
    emitido em ${esc(dataFmt)}.
  </div>

  <div class="bloco">
    <strong>Cliente:</strong> ${esc(pedido.cliente_nome)}<br>
    <strong>Documento:</strong> ${esc(pedido.cliente_doc || '—')}<br>
    <strong>Endereço:</strong> ${esc([pedido.cliente_endereco, pedido.cliente_cidade, pedido.cliente_estado].filter(Boolean).join(' - ') || '—')}<br>
    <strong>Vendedor:</strong> ${esc(pedido.vendedor_nome || '—')}<br>
    <strong>Cond. pagto:</strong> ${esc(pedido.condicao_pagamento || '—')}
  </div>

  <div class="bloco">
    Para clareza, firmo(amos) o presente recibo, dando plena, geral e irrevogável quitação
    do valor acima descrito.
  </div>

  <div class="assinatura">
    <div class="linha"></div>
    <div>${esc(empresa.razao_social || empresa.nome_fantasia)}</div>
    <div style="font-size:11px;color:#666;">${esc(empresa.cnpj ? 'CNPJ: ' + empresa.cnpj : '')}</div>
  </div>

  <div class="footer">
    Documento gerado eletronicamente por Zyntra ERP em ${new Date().toLocaleString('pt-BR')}
  </div>
</body>
</html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="recibo-pedido-${id}.html"`);
            res.send(html);
        } catch (error) {
            console.error('[RECIBO] Erro ao gerar:', error.message);
            next(error);
        }
    });

    // ============================================================
    // GERAR NF NÚMERO — Para uso pelo drag-drop do Kanban
    // POST /api/vendas/pedidos/:id/gerar-nf
    // ============================================================
    router.post('/pedidos/:id/gerar-nf', authenticateToken, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { id } = req.params;

            // Verificar pedido
            const [[pedido]] = await connection.query(
                'SELECT id, status, nf, numero_nf, empresa_id, cliente_id FROM pedidos WHERE id = ? FOR UPDATE',
                [id]
            );
            if (!pedido) {
                await connection.rollback();
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }

            // Se já tem NF, retornar o existente
            if (pedido.nf || pedido.numero_nf) {
                await connection.rollback();
                return res.json({
                    success: true,
                    nf_numero: pedido.nf || pedido.numero_nf,
                    ja_existia: true
                });
            }

            // Gerar novo número via faturamentoShared
            const nfData = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const nfNumero = nfData.numero;

            // Salvar em AMBOS os campos
            await connection.query(
                'UPDATE pedidos SET nf = ?, numero_nf = ?, data_faturamento = COALESCE(data_faturamento, NOW()), updated_at = NOW() WHERE id = ?',
                [nfNumero, nfNumero, id]
            );

            await connection.commit();

            console.log(`[GERAR-NF] NF ${nfNumero} gerada para pedido #${id}`);
            res.json({
                success: true,
                nf_numero: nfNumero,
                serie: nfData.serie,
                ja_existia: false
            });

        } catch (error) {
            await connection.rollback();
            console.error('[GERAR-NF] Erro:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // =============================================================
    // ENVIAR EMAIL AO CLIENTE
    // =============================================================
    router.post('/pedidos/:id/enviar-email', async (req, res) => {
        try {
            const { id } = req.params;
            // O frontend envia o campo como `email`; aceitamos ambos por robustez.
            const destinatario = req.body.destinatario || req.body.email;
            const { assunto, mensagem } = req.body;
            const user = req.user || {};

            if (!destinatario || !assunto) {
                return res.status(400).json({ message: 'Destinatário e assunto são obrigatórios' });
            }

            // Buscar dados do pedido
            const [pedidos] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
            if (!pedidos || pedidos.length === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }
            const pedido = pedidos[0];

            // Tentar enviar via nodemailer
            let nodemailer;
            try { nodemailer = require('nodemailer'); } catch(e) {
                return res.status(500).json({ message: 'Serviço de e-mail não disponível' });
            }

            const transporter = nodemailer.createTransport({
                host: 'mail.aluforce.ind.br',
                port: 465,
                secure: true,
                auth: {
                    user: process.env.SMTP_USER || 'noreply@aluforce.ind.br',
                    pass: process.env.SMTP_PASS || 'noreplyalu'
                },
                tls: { rejectUnauthorized: false }
            });

            const pedidoNum = String(pedido.id).padStart(5, '0');
            const htmlBody = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #0b2842; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                        <h2 style="margin: 0;">ALUFORCE</h2>
                        <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.8;">Esquadrias de Alumínio</p>
                    </div>
                    <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <h3 style="color: #1e293b; margin: 0 0 16px;">${assunto}</h3>
                        <p style="color: #475569; line-height: 1.6; white-space: pre-wrap;">${mensagem || ''}</p>
                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                        <p style="font-size: 12px; color: #94a3b8;">Pedido Nº ${pedidoNum} | Cliente: ${pedido.cliente || '-'}</p>
                    </div>
                </div>
            `;

            await transporter.sendMail({
                from: `"Aluforce ERP" <${process.env.SMTP_USER || 'noreply@aluforce.ind.br'}>`,
                to: destinatario,
                subject: assunto,
                html: htmlBody
            });

            // Salvar no pedido que email foi enviado
            await pool.query('UPDATE pedidos SET email_cliente = ?, email_assunto = ?, email_mensagem = ? WHERE id = ?',
                [destinatario, assunto, mensagem || '', id]);

            res.json({ success: true, message: 'E-mail enviado com sucesso' });

        } catch (error) {
            console.error('Erro ao enviar e-mail:', error);
            res.status(500).json({ message: 'Erro ao enviar e-mail: ' + (error.message || 'Erro desconhecido') });
        }
    });

    // =================================================================
    // CONDIÇÕES DE PAGAMENTO — API
    // =================================================================

    // GET /api/vendas/condicoes-pagamento?valor=5000
    router.get('/condicoes-pagamento', authenticateToken, (req, res) => {
        const valor = parseFloat(req.query.valor) || 0;
        const faixa = getFaixaPagamento(valor);
        res.json({
            faixa: faixa.label,
            condicao: faixa.condicao,
            prazo_medio: faixa.prazo_medio,
            prazo_maximo: faixa.prazo_maximo,
            parcelas_max: faixa.parcelas_max,
            parcelas_padrao: faixa.parcelas_padrao,
            parcelas_alternativas: faixa.parcelas_alternativas || null,
            requer_aprovacao_financeiro: faixa.requer_aprovacao_financeiro,
            condicao_texto: formatarCondicaoPagamento(valor)
        });
    });

    // POST /api/vendas/condicoes-pagamento/validar
    router.post('/condicoes-pagamento/validar', authenticateToken, (req, res) => {
        const { valor, prazos, num_parcelas } = req.body;
        const resultado = validarCondicaoPagamento(valor, prazos, num_parcelas);
        res.json(resultado);
    });

    // POST /api/vendas/condicoes-pagamento/gerar-parcelas
    router.post('/condicoes-pagamento/gerar-parcelas', authenticateToken, (req, res) => {
        const { valor, data_base } = req.body;
        const parcelas = gerarParcelasAutomaticas(valor, data_base);
        const faixa = getFaixaPagamento(valor);
        res.json({
            parcelas,
            faixa: faixa.label,
            condicao: faixa.condicao,
            requer_aprovacao: faixa.requer_aprovacao_financeiro
        });
    });

    return router;
};
