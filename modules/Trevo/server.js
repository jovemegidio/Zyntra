/*
 * TREVO — Autopecas | servidor STANDALONE
 *
 * ISOLAMENTO (importante):
 *   - Processo PM2 proprio (`trevo-autopecas`) numa porta propria (3200).
 *   - Banco de dados proprio (`trevo_autopecas`) e usuario proprio (`trevo`).
 *   - NAO e montado no server.js do ERP: as 3 empresas (aluforce, labor-energy,
 *     labor-eletric) nao carregam nem executam nada deste diretorio.
 *
 * Subir:  node modules/Trevo/server.js       (ou via ecosystem.trevo.config.js)
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pool, garantirSchema } = require('./db');
const { criarParcelasIguais, resumirNota } = require('./financeiro-notas');
const { normalizarData, resolverDataRealizacao } = require('./ordens-servico-datas');
const { grupoDaOrdem, podeExcluirOrdem, normalizarIdsSelecionados,
    validarEPrepararUnificacao } = require('./ordens-servico-unificacao');
const relatorios = require('./relatorios');
const sefaz = require('./sefaz');

const nfseAdn = require('./nfse-adn');
const emailTrevo = require('./email');

/* O motor de NF-e depende da arvore do ERP (xml-nfe, danfe, calculo-tributos).
   Require tolerante: se alguem rodar o Trevo isolado, o modulo sobe igual e so
   a emissao responde que esta indisponivel, em vez de derrubar o boot. */
let fiscalEmissao = null;
try { fiscalEmissao = require('./fiscal-emissao'); }
catch (e) { console.warn(`[TREVO] motor de NF-e/DANFE indisponivel: ${e.message}`); }

const exigirMotorNFe = () => {
    if (!fiscalEmissao) {
        throw Object.assign(new Error('Motor de NF-e indisponivel neste servidor'), { status: 503 });
    }
    return fiscalEmissao;
};

const app = express();
const PORTA = Number(process.env.TREVO_PORT || 3200);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------- helpers
const num = (v, def = 0) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : def;
};
const erro = (res, status, message) => res.status(status).json({ message });

// converte DECIMAL (que o mysql2 devolve como string) em number para o front
const nProd = (p) => ({
    ...p,
    preco_custo: Number(p.preco_custo),
    preco_venda: Number(p.preco_venda),
    estoque: Number(p.estoque),
    estoque_minimo: Number(p.estoque_minimo),
    ativo: !!p.ativo
});

function asyncRota(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ------------------------------------------------------- suspensao comercial
/*
 * Portao de suspensao por fatura vencida. Fica ANTES de qualquer rota (auth,
 * APIs e express.static), entao barra tambem quem ja tinha sessao valida — sem
 * isso o bloqueio seria fraco: o login com "lembrar" vale 30 dias.
 *
 * Liga/desliga em `suspensao.json` (mesmo diretorio). O arquivo e relido a cada
 * 5s, entao trocar "suspenso" para false reativa o sistema sem reiniciar o PM2.
 * NADA e apagado ou alterado no banco: e so um portao na frente das rotas.
 */
const ARQUIVO_SUSPENSAO = path.join(__dirname, 'suspensao.json');
const SUSPENSAO_PADRAO = {
    suspenso: false,
    titulo: 'Acesso suspenso',
    mensagem: 'O acesso ao sistema foi suspenso.',
    instrucao: 'Entre em contato para regularizar e reativar o acesso.',
    rodape: 'Zyntra'
};
let _suspensaoCache = { valor: SUSPENSAO_PADRAO, lido: 0 };

function lerSuspensao() {
    const agora = Date.now();
    if (agora - _suspensaoCache.lido < 5000) return _suspensaoCache.valor;
    let valor = SUSPENSAO_PADRAO;
    try {
        const bruto = JSON.parse(fs.readFileSync(ARQUIVO_SUSPENSAO, 'utf8'));
        valor = Object.assign({}, SUSPENSAO_PADRAO, bruto);
        valor.suspenso = bruto.suspenso === true;
    } catch (e) {
        // arquivo ausente ou invalido = sistema liberado. Um JSON quebrado nao
        // pode derrubar o acesso de ninguem, nem trancar o sistema por engano.
        valor = SUSPENSAO_PADRAO;
    }
    _suspensaoCache = { valor, lido: agora };
    return valor;
}

const escaparHtml = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function paginaSuspensao(cfg) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${escaparHtml(cfg.titulo)} — TREVO</title>
<link rel="icon" type="image/jpeg" href="/img/favicon-zyntra.jpg">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
       color:#1f2433;background:#0d1117;line-height:1.5;-webkit-font-smoothing:antialiased}
  body::before,body::after{content:"";position:fixed;inset:0;pointer-events:none}
  body::before{z-index:-2;background:#0d1117 url("/img/login-trevo.jpg") center center / cover no-repeat}
  body::after{z-index:-1;background:linear-gradient(180deg,rgba(6,10,18,.62) 0%,rgba(6,10,18,.48) 45%,rgba(6,10,18,.70) 100%)}
  .tela{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .cartao{width:min(460px,100%);background:#fff;border-radius:14px;padding:38px 34px 30px;
          box-shadow:0 26px 70px rgba(3,7,18,.45);text-align:center;animation:sobe .35s ease both}
  @keyframes sobe{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}
  .selo{width:58px;height:58px;margin:0 auto 18px;border-radius:16px;display:flex;align-items:center;
        justify-content:center;background:#fef2f2;color:#dc2626;font-size:27px;line-height:1}
  h1{font-size:21px;font-weight:700;color:#0f172a;letter-spacing:-.01em}
  .marca{margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8}
  .mensagem{margin-top:18px;font-size:15px;color:#334155}
  .instrucao{margin-top:10px;font-size:14px;color:#64748b}
  .regua{margin:26px 0 0;border:0;border-top:1px solid #e5e7eb}
  .rodape{margin-top:14px;font-size:12px;color:#94a3b8}
</style>
</head>
<body>
  <main class="tela">
    <section class="cartao" role="alert">
      <div class="selo" aria-hidden="true">!</div>
      <h1>${escaparHtml(cfg.titulo)}</h1>
      <p class="marca">TREVO Autopeças</p>
      <p class="mensagem">${escaparHtml(cfg.mensagem)}</p>
      <p class="instrucao">${escaparHtml(cfg.instrucao)}</p>
      <hr class="regua">
      <p class="rodape">${escaparHtml(cfg.rodape)}</p>
    </section>
  </main>
</body>
</html>`;
}

app.use((req, res, next) => {
    const cfg = lerSuspensao();
    if (!cfg.suspenso) return next();
    // A propria tela de aviso usa a foto e o favicon de /img/.
    if (req.path.startsWith('/img/')) return next();
    // 402 Payment Required: diz o motivo para qualquer cliente, inclusive o
    // fetch do front, sem se confundir com "sessao expirada" (401).
    if (req.path.startsWith('/api/')) {
        return res.status(402).json({
            code: 'ACESSO_SUSPENSO',
            message: `${cfg.mensagem} ${cfg.instrucao}`.trim()
        });
    }
    res.status(402).type('html').send(paginaSuspensao(cfg));
});

// ---------------------------------------------------------------- sessao
// Cookie httpOnly para o front web; header Bearer para clientes sem cookie jar (app mobile).
function tokenDe(req) {
    const auth = req.headers && req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return (req.cookies && req.cookies.trevo_sessao) || null;
}

async function sessaoDe(req) {
    const token = tokenDe(req);
    if (!token) return null;
    const [linhas] = await pool.query(
        'SELECT usuario, nome FROM sessoes WHERE token = ? AND expira > NOW() LIMIT 1', [token]
    );
    return linhas.length ? linhas[0] : null;
}

const PUBLICOS = ['/login.html', '/api/login', '/favicon.ico'];
function ehPublico(url) {
    // /img/ liberado: a tela de login exibe a marca antes de haver sessao
    return PUBLICOS.includes(url) ||
        url.startsWith('/css/') || url.startsWith('/js/') || url.startsWith('/img/');
}

app.use(asyncRota(async (req, res, next) => {
    const caminho = req.path;
    if (ehPublico(caminho)) return next();
    const sessao = await sessaoDe(req);
    if (sessao) { req.usuario = sessao; return next(); }
    if (caminho.startsWith('/api/')) return erro(res, 401, 'Nao autenticado');
    if (req.method === 'GET' && (caminho === '/' || caminho.endsWith('.html'))) {
        return res.redirect('/login.html');
    }
    next();
}));

// ---------------------------------------------------------------- auth
app.post('/api/login', asyncRota(async (req, res) => {
    const usuario = String(req.body.usuario || '').trim();
    const senha = String(req.body.senha || '');
    const [linhas] = await pool.query(
        'SELECT id, usuario, nome, senha_hash FROM usuarios WHERE usuario = ? AND ativo = 1 LIMIT 1', [usuario]
    );
    // mensagem unica: nao revela se o usuario existe
    if (!linhas.length || !bcrypt.compareSync(senha, linhas[0].senha_hash)) {
        return erro(res, 401, 'Usuario ou senha invalidos');
    }
    const u = linhas[0];
    const token = crypto.randomBytes(24).toString('hex');
    const dias = req.body.lembrar ? 30 : 1;
    await pool.query('INSERT INTO sessoes (token, usuario, nome, expira) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
        [token, u.usuario, u.nome, dias]);
    await pool.query('DELETE FROM sessoes WHERE expira < NOW()');
    res.cookie('trevo_sessao', token, { httpOnly: true, sameSite: 'lax', maxAge: dias * 86400000, path: '/' });
    // token no corpo tambem: clientes sem cookie jar (app mobile) usam via Authorization: Bearer.
    res.json({ id: u.id, usuario: u.usuario, nome: u.nome, token });
}));

app.post('/api/logout', asyncRota(async (req, res) => {
    const token = tokenDe(req);
    if (token) await pool.query('DELETE FROM sessoes WHERE token = ?', [token]);
    res.clearCookie('trevo_sessao', { path: '/' });
    res.json({ message: 'Sessao encerrada' });
}));

app.get('/api/me', (req, res) => res.json(req.usuario));

app.post('/api/alterar-senha', asyncRota(async (req, res) => {
    const [linhas] = await pool.query('SELECT senha_hash FROM usuarios WHERE usuario = ?', [req.usuario.usuario]);
    if (!linhas.length || !bcrypt.compareSync(String(req.body.senha_atual || ''), linhas[0].senha_hash)) {
        return erro(res, 400, 'Senha atual incorreta');
    }
    const nova = String(req.body.senha_nova || '');
    if (nova.length < 4) return erro(res, 400, 'A nova senha precisa ter pelo menos 4 caracteres');
    await pool.query('UPDATE usuarios SET senha_hash = ? WHERE usuario = ?',
        [bcrypt.hashSync(nova, 10), req.usuario.usuario]);
    // quem troca a senha espera derrubar quem estava logado com a antiga (outro
    // navegador, celular esquecido). A sessao atual segue valida — so ela.
    await pool.query('DELETE FROM sessoes WHERE usuario = ? AND token <> ?',
        [req.usuario.usuario, req.cookies.trevo_sessao]);
    res.json({ message: 'Senha alterada com sucesso' });
}));

// ---------------------------------------------------------------- produtos
app.get('/api/produtos', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.busca) {
        cond.push('(sku LIKE ? OR descricao LIKE ? OR marca LIKE ? OR aplicacao LIKE ? OR codigo_oem LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t, t);
    }
    if (req.query.ativos === '1') cond.push('ativo = 1');
    if (req.query.abaixo_minimo === '1') cond.push('ativo = 1 AND estoque <= estoque_minimo');
    if (req.query.categoria) { cond.push('categoria = ?'); params.push(req.query.categoria); }
    const [linhas] = await pool.query(
        'SELECT * FROM produtos' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') + ' ORDER BY descricao', params
    );
    res.json(linhas.map(nProd));
}));

function validarProduto(b) {
    if (!String(b.descricao || '').trim()) return 'Descricao e obrigatoria';
    if (!String(b.sku || '').trim()) return 'Codigo (SKU) e obrigatorio';
    if (num(b.preco_venda, -1) < 0) return 'Preco de venda invalido';
    return null;
}

app.post('/api/produtos', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = validarProduto(b);
    if (msg) return erro(res, 400, msg);
    const estoque = num(b.estoque);
    let id;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [r] = await conn.query(
            `INSERT INTO produtos (sku, descricao, marca, categoria, aplicacao, codigo_oem, localizacao,
                preco_custo, preco_venda, estoque, estoque_minimo, unidade, ativo)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [String(b.sku).trim(), String(b.descricao).trim(), b.marca || '', b.categoria || '',
             b.aplicacao || '', b.codigo_oem || '', b.localizacao || '',
             num(b.preco_custo), num(b.preco_venda), estoque, num(b.estoque_minimo),
             String(b.unidade || 'UN').toUpperCase().slice(0, 6),
             b.ativo === false ? 0 : 1]
        );
        id = r.insertId;
        if (estoque > 0) {
            await conn.query(
                `INSERT INTO movimentacoes (produto_id, sku, descricao, tipo, quantidade, estoque_apos, motivo, usuario)
                 VALUES (?,?,?,'entrada',?,?,?,?)`,
                [id, String(b.sku).trim(), String(b.descricao).trim(), estoque, estoque,
                 'Estoque inicial do cadastro', req.usuario.usuario]
            );
        }
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Ja existe um produto com esse SKU');
        throw e;
    } finally { conn.release(); }
    const [[novo]] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    res.status(201).json(nProd(novo));
}));

app.put('/api/produtos/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = validarProduto(b);
    if (msg) return erro(res, 400, msg);
    try {
        // estoque NAO e alterado aqui de proposito: so via /estoque/movimentar (rastreabilidade)
        const [r] = await pool.query(
            `UPDATE produtos SET sku=?, descricao=?, marca=?, categoria=?, aplicacao=?, codigo_oem=?,
                localizacao=?, preco_custo=?, preco_venda=?, estoque_minimo=?,
                unidade=IF(? <> '', ?, unidade), ativo=? WHERE id=?`,
            [String(b.sku).trim(), String(b.descricao).trim(), b.marca || '', b.categoria || '',
             b.aplicacao || '', b.codigo_oem || '', b.localizacao || '',
             num(b.preco_custo), num(b.preco_venda), num(b.estoque_minimo),
             b.unidade || '', String(b.unidade || '').toUpperCase().slice(0, 6),
             b.ativo === false ? 0 : 1, req.params.id]
        );
        if (!r.affectedRows) return erro(res, 404, 'Produto nao encontrado');
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Ja existe outro produto com esse SKU');
        throw e;
    }
    const [[p]] = await pool.query('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
    res.json(nProd(p));
}));

app.delete('/api/produtos/:id', asyncRota(async (req, res) => {
    // as FKs sao ON DELETE SET NULL: sem esta trava o historico perderia o vinculo em silencio
    const [[usado]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM venda_itens WHERE produto_id = ?) vendas,
                (SELECT COUNT(*) FROM os_itens WHERE produto_id = ?) ordens,
                (SELECT COUNT(*) FROM nota_fiscal_itens WHERE produto_id = ?) notas`,
        [req.params.id, req.params.id, req.params.id]);
    if (usado.vendas > 0 || usado.ordens > 0 || usado.notas > 0)
        return erro(res, 409, 'Peca ja usada em vendas, ordens de servico ou notas - inative-a em vez de excluir');
    const [r] = await pool.query('DELETE FROM produtos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Produto nao encontrado');
    res.json({ message: 'Produto excluido' });
}));

/* Exclusao em massa (multi-selecao do catalogo). Aplica a MESMA trava do
   DELETE individual, mas por lote: o que ja tem movimento nao e excluido e
   volta na lista `bloqueados` com o motivo — o resto vai embora. Excluir o que
   da e avisar sobre o que nao da e melhor do que falhar o lote inteiro por
   causa de um item. O historico de movimentacao NAO e apagado: a FK e
   ON DELETE SET NULL e a linha guarda sku/descricao proprios, entao o
   relatorio de estoque continua legivel depois da exclusao. */
app.post('/api/produtos/excluir-lote', asyncRota(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [])
        .map(Number).filter(Number.isInteger);
    if (!ids.length) return erro(res, 400, 'Informe os produtos a excluir');
    if (ids.length > 500) return erro(res, 400, 'Exclua no maximo 500 produtos por vez');

    const [usos] = await pool.query(
        `SELECT p.id, p.sku, p.descricao,
                (SELECT COUNT(*) FROM venda_itens       WHERE produto_id = p.id) vendas,
                (SELECT COUNT(*) FROM os_itens          WHERE produto_id = p.id) ordens,
                (SELECT COUNT(*) FROM nota_fiscal_itens WHERE produto_id = p.id) notas
           FROM produtos p WHERE p.id IN (?)`, [ids]);

    const bloqueados = [], liberados = [];
    for (const u of usos) {
        const motivos = [
            u.vendas > 0 && `${u.vendas} venda(s)`,
            u.ordens > 0 && `${u.ordens} ordem(ns) de servico`,
            u.notas  > 0 && `${u.notas} nota(s) fiscal(is)`
        ].filter(Boolean);
        if (motivos.length) bloqueados.push({ id: u.id, sku: u.sku, descricao: u.descricao, motivo: motivos.join(', ') });
        else liberados.push(u.id);
    }

    let excluidos = 0;
    if (liberados.length) {
        const [r] = await pool.query('DELETE FROM produtos WHERE id IN (?)', [liberados]);
        excluidos = r.affectedRows;
    }

    // ids que nem existem mais (outra aba ja excluiu) nao viram erro
    const inexistentes = ids.filter(id => !usos.some(u => u.id === id));
    res.json({ excluidos, bloqueados, inexistentes: inexistentes.length });
}));

/* Importacao em massa (usada pelo importador de DANFE em PDF).
   Cada item pode criar um produto novo ou atualizar um existente — o casamento
   e feito por SKU e, se nao achar, pelo codigo OEM. Quando `entrada` vem
   marcado, ja lanca a entrada no estoque com o numero da nota como motivo. */
app.post('/api/produtos/importar', asyncRota(async (req, res) => {
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!itens.length) return erro(res, 400, 'Nada para importar');
    if (itens.length > 500) return erro(res, 400, 'Importe no maximo 500 itens por vez');

    const documento = String(req.body.documento || '').trim();
    const fornecedor = String(req.body.fornecedor || '').trim();
    const motivo = ['Importacao de DANFE', documento && `NF ${documento}`, fornecedor]
        .filter(Boolean).join(' — ').slice(0, 200);

    const criados = [], atualizados = [], ignorados = [];
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        for (const [i, it] of itens.entries()) {
            const sku = String(it.sku || '').trim();
            const descricao = String(it.descricao || '').trim();
            if (!sku || !descricao) { ignorados.push({ linha: i + 1, motivo: 'SKU ou descricao em branco' }); continue; }

            const custo = num(it.preco_custo);
            const venda = num(it.preco_venda);
            const qtd = num(it.quantidade);
            const oem = String(it.codigo_oem || '').trim();
            // dados fiscais do quadro de produtos da DANFE, ja normalizados
            const ncmLimpo = String(it.ncm || '').replace(/\D/g, '').slice(0, 8);
            const cestLimpo = String(it.cest || '').replace(/\D/g, '').slice(0, 7);
            const cfopLimpo = String(it.cfop || '').replace(/\D/g, '').slice(0, 4);
            // a DANFE nao traz marca: vem do que o usuario digitou na conferencia
            const marcaLimpa = String(it.marca || '').trim().slice(0, 60);

            // procura primeiro pelo SKU; se nao houver, tenta pelo codigo do fabricante
            let [achados] = await conn.query('SELECT * FROM produtos WHERE sku = ? LIMIT 1', [sku]);
            if (!achados.length && oem)
                [achados] = await conn.query("SELECT * FROM produtos WHERE codigo_oem = ? AND codigo_oem <> '' LIMIT 1", [oem]);

            let produtoId, estoqueAtual, descricaoFinal;
            if (achados.length) {
                const p = achados[0];
                produtoId = p.id;
                estoqueAtual = Number(p.estoque);
                descricaoFinal = p.descricao;
                // no produto que ja existe so atualizamos custo/fiscal — descricao e preco
                // de venda sao decisao da loja e nao devem ser sobrescritos pela nota
                /* No produto que ja existe so completamos o que esta em branco:
                   NCM/CEST/CFOP que a loja ja classificou nao sao sobrescritos
                   pela nota do fornecedor. Custo e o unico que sempre atualiza. */
                await conn.query(
                    `UPDATE produtos SET preco_custo = IF(? > 0, ?, preco_custo),
                        codigo_oem = IF(codigo_oem = '', ?, codigo_oem),
                        ncm  = IF(ncm  = '' AND ? <> '', ?, ncm),
                        cest = IF(cest = '' AND ? <> '', ?, cest),
                        cfop = IF(cfop = '' AND ? <> '', ?, cfop),
                        marca = IF(marca = '' AND ? <> '', ?, marca),
                        unidade = IF(? <> '', ?, unidade)
                     WHERE id = ?`,
                    [custo, custo, oem,
                     ncmLimpo, ncmLimpo, cestLimpo, cestLimpo, cfopLimpo, cfopLimpo,
                     marcaLimpa, marcaLimpa,
                     it.unidade || '', String(it.unidade || '').toUpperCase().slice(0, 6), produtoId]);
                atualizados.push(sku);
            } else {
                const [r] = await conn.query(
                    `INSERT INTO produtos (sku, descricao, marca, categoria, aplicacao, codigo_oem, localizacao,
                        preco_custo, preco_venda, estoque, estoque_minimo, unidade, ncm, cest, cfop, origem)
                     VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,'0')`,
                    [sku, descricao, marcaLimpa, it.categoria || '', it.aplicacao || '', oem, it.localizacao || '',
                     custo, venda, num(it.estoque_minimo), String(it.unidade || 'UN').toUpperCase().slice(0, 6),
                     ncmLimpo, cestLimpo, cfopLimpo]);
                produtoId = r.insertId;
                estoqueAtual = 0;
                descricaoFinal = descricao;
                criados.push(sku);
            }

            if (it.entrada && qtd > 0) {
                const novo = estoqueAtual + qtd;
                await conn.query('UPDATE produtos SET estoque = ? WHERE id = ?', [novo, produtoId]);
                await conn.query(
                    `INSERT INTO movimentacoes (produto_id, sku, descricao, tipo, quantidade, estoque_apos, motivo, usuario)
                     VALUES (?,?,?,'entrada',?,?,?,?)`,
                    [produtoId, sku, descricaoFinal, qtd, novo, motivo || 'Importacao de DANFE', req.usuario.usuario]);
            }
        }
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Ha SKUs repetidos na lista importada');
        throw e;
    } finally { conn.release(); }

    res.status(201).json({
        criados: criados.length, atualizados: atualizados.length,
        ignorados, skus_criados: criados, skus_atualizados: atualizados
    });
}));

// ---------------------------------------------------------------- clientes
app.get('/api/clientes', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.busca) {
        cond.push('(nome LIKE ? OR razao_social LIKE ? OR nome_fantasia LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ? OR celular LIKE ? OR email LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t, t, t, t);
    }
    if (req.query.ativos === '1') cond.push('ativo = 1');
    if (req.query.tipo) { cond.push('tipo_pessoa = ?'); params.push(req.query.tipo); }
    const [linhas] = await pool.query(
        'SELECT * FROM clientes' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') + ' ORDER BY nome', params);
    res.json(linhas.map(nCliente));
}));

app.get('/api/clientes/:id', asyncRota(async (req, res) => {
    const [[c]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
    if (!c) return erro(res, 404, 'Cliente nao encontrado');
    res.json(nCliente(c));
}));

const nCliente = (c) => ({
    ...c,
    data_nascimento: dataIso(c.data_nascimento),
    data_abertura: dataIso(c.data_abertura),
    limite_credito: Number(c.limite_credito || 0),
    consumidor_final: !!c.consumidor_final,
    simples_nacional: !!c.simples_nacional,
    ativo: c.ativo === undefined ? true : !!c.ativo
});

// campos gravaveis do cadastro completo (o basico + os da migracao)
function camposCliente(b) {
    const soDigitos = (v) => String(v || '').replace(/\D/g, '');
    const data = (v) => {
        const s = String(v || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };
    return {
        nome: String(b.nome || '').trim(),
        tipo_pessoa: b.tipo_pessoa === 'juridica' ? 'juridica' : 'fisica',
        razao_social: b.razao_social || '',
        nome_fantasia: b.nome_fantasia || '',
        cpf_cnpj: soDigitos(b.cpf_cnpj),
        inscricao_estadual: b.inscricao_estadual || '',
        inscricao_municipal: b.inscricao_municipal || '',
        rg: b.rg || '',
        data_nascimento: data(b.data_nascimento),
        telefone: b.telefone || '',
        celular: b.celular || '',
        email: b.email || '',
        email_secundario: b.email_secundario || '',
        cep: b.cep || '',
        endereco: b.endereco || '',
        numero: b.numero || '',
        complemento: b.complemento || '',
        bairro: b.bairro || '',
        cidade: b.cidade || '',
        uf: String(b.uf || '').toUpperCase().slice(0, 2),
        codigo_municipio: b.codigo_municipio || '',
        contato_nome: b.contato_nome || '',
        indicador_ie: ['1', '2', '9'].includes(String(b.indicador_ie)) ? String(b.indicador_ie) : '9',
        consumidor_final: b.consumidor_final === false ? 0 : 1,
        limite_credito: num(b.limite_credito),
        condicao_pagamento: b.condicao_pagamento || '',
        situacao_cadastral: b.situacao_cadastral || '',
        atividade_principal: b.atividade_principal || '',
        natureza_juridica: b.natureza_juridica || '',
        data_abertura: data(b.data_abertura),
        porte: b.porte || '',
        simples_nacional: b.simples_nacional ? 1 : 0,
        observacoes: b.observacoes || '',
        ativo: b.ativo === false ? 0 : 1,
        /* Carimba quando o cadastro veio das bases oficiais (Receita/SEFAZ).
           Sem `fonte_oficial` mantem o carimbo anterior — edicao manual nao
           deve fingir que o dado foi conferido na Receita. */
        atualizado_receita_em: b.fonte_oficial ? new Date() : (b.atualizado_receita_em || null)
    };
}

app.post('/api/clientes', asyncRota(async (req, res) => {
    const dados = camposCliente(req.body);
    if (!dados.nome) return erro(res, 400, 'Nome e obrigatorio');
    const colunas = Object.keys(dados);
    const [r] = await pool.query(
        `INSERT INTO clientes (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(',')})`,
        colunas.map(c => dados[c])
    );
    const [[novo]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [r.insertId]);
    res.status(201).json(nCliente(novo));
}));

/* Atualizacao por MESCLAGEM: so grava as colunas que vieram no corpo.
   Campo ausente fica como esta; campo enviado vazio limpa de proposito.
   Sem isso um PUT parcial (integracao, app, formulario reduzido) apagaria
   silenciosamente as dezenas de colunas que ele nao conhece. */
app.put('/api/clientes/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const dados = camposCliente(b);
    if (b.nome !== undefined && !dados.nome) return erro(res, 400, 'Nome e obrigatorio');

    const colunas = Object.keys(dados).filter(c =>
        Object.prototype.hasOwnProperty.call(b, c) ||
        (c === 'atualizado_receita_em' && b.fonte_oficial));
    if (!colunas.length) return erro(res, 400, 'Nenhum campo para atualizar');

    const [r] = await pool.query(
        `UPDATE clientes SET ${colunas.map(c => c + '=?').join(', ')} WHERE id=?`,
        [...colunas.map(c => dados[c]), req.params.id]
    );
    if (!r.affectedRows) return erro(res, 404, 'Cliente nao encontrado');
    const [[c]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
    res.json(nCliente(c));
}));

app.delete('/api/clientes/:id', asyncRota(async (req, res) => {
    const id = req.params.id;
    const [[usado]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM vendas WHERE cliente_id = ?) v,
                (SELECT COUNT(*) FROM ordens_servico WHERE cliente_id = ?) o,
                (SELECT COUNT(*) FROM contas_receber WHERE cliente_id = ?) r,
                (SELECT COUNT(*) FROM notas_fiscais WHERE cliente_id = ?) n,
                (SELECT COUNT(*) FROM veiculos WHERE cliente_id = ?) ve`,
        [id, id, id, id, id]);
    if (usado.v > 0 || usado.o > 0 || usado.r > 0 || usado.n > 0 || usado.ve > 0)
        return erro(res, 409, 'Cliente possui movimentacao ou veiculos vinculados - inative-o em vez de excluir');
    const [r] = await pool.query('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Cliente nao encontrado');
    res.json({ message: 'Cliente excluido' });
}));

/* Resumo do cliente: quantas lavagens, trocas de oleo, manutencoes etc.
   A contagem sai de os_itens.servico_tipo das OS nao canceladas. */
// ================================================================
// PERIODO DOS RELATORIOS — dia, semana, mes ou intervalo livre.
//
// A VPS roda em UTC e a loja e UTC-3, entao os DATETIME estao gravados
// em UTC: uma OS aberta as 21h30 de 31/07 na loja fica como 01/08 00h30
// no banco. Sem converter, ela cairia no relatorio de agosto. Por isso
// todo filtro compara a data JA convertida para o fuso da loja.
// (O Brasil nao tem mais horario de verao desde 2019, entao o offset
//  fixo -03:00 vale o ano inteiro e dispensa as tabelas de fuso.)
// ================================================================
const FUSO_LOJA = '-03:00';
const dataNoFuso = (coluna) => `DATE(CONVERT_TZ(${coluna}, '+00:00', '${FUSO_LOJA}'))`;

const iso = (d) => d.toISOString().slice(0, 10);
// "agora" na loja: desloca o relogio UTC e usa os getters UTC como se fossem locais
const agoraNaLoja = () => new Date(Date.now() - 3 * 3600 * 1000);

function resolverDataComercial(valor, hoje, rotulo) {
    const dataHoje = normalizarData(hoje);
    if (!dataHoje) throw Object.assign(new Error('Data atual da loja invalida'), { status: 500 });
    const ausente = valor === undefined || valor === null || String(valor).trim() === '';
    const data = ausente ? dataHoje : normalizarData(valor);
    if (!data) throw Object.assign(new Error(`${rotulo} invalida`), { status: 400 });
    if (data > dataHoje) throw Object.assign(new Error(`${rotulo} nao pode estar no futuro`), { status: 400 });
    return data;
}

// Grava a data comercial ao meio-dia da loja (15:00 UTC) para a UI nao voltar um dia.
const dataComercialDatetime = (data) => `${data} 15:00:00`;

function resolverPeriodo(query = {}) {
    const hoje = agoraNaLoja();
    const ano = hoje.getUTCFullYear(), mes = hoje.getUTCMonth(), dia = hoje.getUTCDate();
    const dataUtc = (a, m, d) => new Date(Date.UTC(a, m, d));

    const valida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
    const de = valida(query.de), ate = valida(query.ate);

    // intervalo digitado a mao tem prioridade sobre o atalho
    if (de || ate) {
        const inicio = de || '1900-01-01';
        const fim = ate || iso(hoje);
        // datas invertidas: troca em vez de devolver relatorio vazio
        const [a, b] = inicio <= fim ? [inicio, fim] : [fim, inicio];
        return { de: a, ate: b, preset: 'intervalo',
                 rotulo: `${dataPtBr(a)} a ${dataPtBr(b)}` };
    }

    const preset = String(query.periodo || 'tudo');
    const mont = (ini, fim, rotulo) => ({ de: iso(ini), ate: iso(fim), preset, rotulo });

    switch (preset) {
        case 'hoje':
            return mont(dataUtc(ano, mes, dia), dataUtc(ano, mes, dia), 'Hoje');
        case 'ontem':
            return mont(dataUtc(ano, mes, dia - 1), dataUtc(ano, mes, dia - 1), 'Ontem');
        case 'semana': {
            // semana comeca na segunda-feira
            const diaSemana = (dataUtc(ano, mes, dia).getUTCDay() + 6) % 7;
            const seg = dataUtc(ano, mes, dia - diaSemana);
            return mont(seg, dataUtc(ano, mes, dia - diaSemana + 6), 'Semana atual');
        }
        case 'mes':
            return mont(dataUtc(ano, mes, 1), dataUtc(ano, mes + 1, 0), 'Mês atual');
        case 'mes-passado':
            return mont(dataUtc(ano, mes - 1, 1), dataUtc(ano, mes, 0), 'Mês passado');
        case 'ano':
            return mont(dataUtc(ano, 0, 1), dataUtc(ano, 11, 31), `Ano de ${ano}`);
        default:
            return { de: null, ate: null, preset: 'tudo', rotulo: 'Todo o período' };
    }
}

const dataPtBr = (isoStr) => {
    const m = String(isoStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

async function resumoCliente(id, periodo = { de: null, ate: null, rotulo: 'Todo o período' }) {
    const [[c]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
    if (!c) return null;

    /* O periodo recorta o MOVIMENTO (ordens, vendas, titulos). O cadastro e a
       frota do cliente continuam inteiros: numa ficha mensal ainda interessa
       ver todos os caminhoes dele, nao so os que rodaram no mes. */
    const noPeriodo = (coluna) => periodo.de ? ` AND ${dataNoFuso(coluna)} BETWEEN ? AND ?` : '';
    const dataAtendimentoOs = `COALESCE(o.data_realizacao, ${dataNoFuso('o.data_conclusao')}, ${dataNoFuso('o.data_abertura')})`;
    const osNoPeriodo = periodo.de ? ` AND ${dataAtendimentoOs} BETWEEN ? AND ?` : '';
    const pp = periodo.de ? [periodo.de, periodo.ate] : [];

    const [porTipo] = await pool.query(
        `SELECT i.servico_tipo AS tipo, SUM(i.quantidade) quantidade, SUM(i.valor_total) valor,
                MAX(${dataAtendimentoOs}) ultimo
         FROM os_itens i JOIN ordens_servico o ON o.id = i.os_id
         WHERE o.cliente_id = ? AND o.status <> 'cancelada' AND i.tipo = 'servico'
               ${osNoPeriodo}
         GROUP BY i.servico_tipo ORDER BY quantidade DESC`, [id, ...pp]);

    const [[tot]] = await pool.query(
        `SELECT COUNT(*) total_os, COALESCE(SUM(valor_servicos),0) servicos,
                COALESCE(SUM(valor_pecas),0) pecas, COALESCE(SUM(valor_total),0) total,
                MAX(${dataAtendimentoOs}) ultimo
         FROM ordens_servico o WHERE o.cliente_id = ? AND o.status <> 'cancelada'
               ${osNoPeriodo}`, [id, ...pp]);

    const [veiculos] = await pool.query('SELECT * FROM veiculos WHERE cliente_id = ? ORDER BY placa', [id]);
    const [motoristas] = await pool.query('SELECT * FROM motoristas WHERE cliente_id = ? ORDER BY ativo DESC, nome', [id]);

    /* `documento_em` = quando a OS foi impressa/baixada pela primeira vez. E o
       que permite o resumo mostrar que o documento da ordem ficou guardado, e
       nao so que a ordem existe. */
    const [historico] = await pool.query(
        `SELECT o.id, o.numero, o.data_abertura, o.data_realizacao,
                ${dataAtendimentoOs} data_atendimento, o.placa, o.status, o.valor_total,
                (SELECT GROUP_CONCAT(i.descricao SEPARATOR ', ') FROM os_itens i
                  WHERE i.os_id = o.id AND i.tipo = 'servico') resumo_servicos,
                (SELECT MIN(d.criado_em) FROM documentos_emitidos d
                  WHERE d.referencia_tipo = 'os' AND d.referencia_id = o.id AND d.tipo = 'os') documento_em
         FROM ordens_servico o WHERE o.cliente_id = ? ${osNoPeriodo}
         ORDER BY ${dataAtendimentoOs} DESC, o.id DESC LIMIT 100`, [id, ...pp]);

    // titulos entram pelo VENCIMENTO: e assim que se acompanha o mes do cliente
    const [[fin]] = await pool.query(
        `SELECT COUNT(*) titulos,
                SUM(status NOT IN ('recebida','cancelada')) abertos,
                COALESCE(SUM(CASE WHEN status NOT IN ('recebida','cancelada')
                    THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido ELSE 0 END),0) valor_aberto,
                COALESCE(SUM(CASE WHEN status NOT IN ('recebida','cancelada') AND data_vencimento < CURDATE()
                    THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido ELSE 0 END),0) valor_vencido,
                COALESCE(SUM(valor_recebido),0) valor_pago
         FROM contas_receber WHERE cliente_id = ?
               ${periodo.de ? ' AND data_vencimento BETWEEN ? AND ?' : ''}`, [id, ...pp]);

    const [[compras]] = await pool.query(
        `SELECT COUNT(*) n, COALESCE(SUM(total),0) total, MAX(data) ultima
         FROM vendas WHERE cliente_id = ? AND status = 'concluida' ${noPeriodo('data')}`, [id, ...pp]);

    /* A LISTA das vendas, nao so o total: a ficha mostrava `balcao` apenas como
       numero agregado — e nem isso chegava ao papel, porque o corpo do relatorio
       nunca usava esse campo. Quem abre a ficha quer ver QUANDO cada compra foi
       feita, do mesmo jeito que ve as ordens de servico. */
    const [comprasLista] = await pool.query(
        `SELECT id, data, total, forma_pagamento, observacoes
           FROM vendas
          WHERE cliente_id = ? AND status = 'concluida' ${noPeriodo('data')}
          ORDER BY data DESC, id DESC LIMIT 100`, [id, ...pp]);

    return {
        cliente: nCliente(c),
        periodo,
        total_os: tot.total_os,
        total_servicos: Number(tot.servicos),
        total_pecas: Number(tot.pecas),
        total_geral: Number(tot.total),
        ticket_medio: tot.total_os > 0 ? Number((Number(tot.total) / tot.total_os).toFixed(2)) : 0,
        ultimo_atendimento: dataIso(tot.ultimo),
        por_tipo: porTipo.map(t => ({ tipo: t.tipo || 'outros', quantidade: Number(t.quantidade),
            valor: Number(t.valor), ultimo: dataIso(t.ultimo) })),
        veiculos: veiculos.map(v => ({ ...v, km_atual: Number(v.km_atual) })),
        motoristas: motoristas.map(m => ({ ...m, ativo: !!m.ativo })),
        historico: historico.map(h => ({ ...h,
            data_realizacao: dataIso(h.data_realizacao), data_atendimento: dataIso(h.data_atendimento),
            // Quando a OS/orcamento foi EMITIDA. Difere da data do servico com meses de
            // distancia nos orcamentos (o cliente informa um atendimento passado), e era
            // a unica das duas que a ficha nao mostrava.
            data_abertura: dataIso(h.data_abertura),
            valor_total: Number(h.valor_total) })),
        financeiro: { titulos: fin.titulos, abertos: Number(fin.abertos || 0),
            valor_aberto: Number(fin.valor_aberto), valor_vencido: Number(fin.valor_vencido),
            valor_pago: Number(fin.valor_pago) },
        balcao: { compras: compras.n, total: Number(compras.total), ultima: compras.ultima },
        compras: comprasLista.map(v => ({
            id: v.id, data: dataIso(v.data), total: Number(v.total),
            forma_pagamento: v.forma_pagamento || null, observacoes: v.observacoes || null
        }))
    };
}

app.get('/api/clientes/:id/resumo', asyncRota(async (req, res) => {
    const resumo = await resumoCliente(req.params.id, resolverPeriodo(req.query));
    if (!resumo) return erro(res, 404, 'Cliente nao encontrado');
    res.json(resumo);
}));

/* Consulta do cadastro do contribuinte direto na SEFAZ (NfeConsultaCadastro).
   Traz o que a Receita nao tem: inscricao estadual, situacao do contribuinte,
   regime de apuracao e o endereco FISCAL — que e o que vale na nota. */
app.get('/api/integracao/sefaz/cadastro/:cnpj', asyncRota(async (req, res) => {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return erro(res, 400, 'CNPJ deve ter 14 digitos');

    const cfg = await configFiscal();
    if (!cfg.sefaz_certificado)
        return erro(res, 400, 'Certificado digital A1 nao configurado — a SEFAZ so responde com certificado');

    const uf = String(req.query.uf || cfg.uf || 'SP').toUpperCase();
    try {
        const dados = await sefaz.consultarCadastroContribuinte({
            uf, cnpj, certificado: cfg.sefaz_certificado, senha: cfg.sefaz_certificado_senha
        });
        res.json(dados);
    } catch (e) { return erro(res, 502, e.message); }
}));

/* Cadastro completo: junta o que cada fonte sabe. A Receita da a razao social,
   CNAE, porte e endereco de registro; a SEFAZ da a inscricao estadual, a
   situacao do contribuinte e o endereco fiscal. Quando as duas respondem, o
   dado da SEFAZ prevalece nos campos fiscais. */
app.get('/api/integracao/cadastro/:cnpj', asyncRota(async (req, res) => {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return erro(res, 400, 'CNPJ deve ter 14 digitos');

    const cfg = await configFiscal();
    const fontes = [];
    let dados = {};

    // 1) Receita Federal (publica, funciona sem certificado)
    try {
        const receita = await consultarCnpjReceita(cnpj, cfg);
        dados = { ...receita };
        fontes.push({ nome: 'Receita Federal', ok: true });
    } catch (e) {
        fontes.push({ nome: 'Receita Federal', ok: false, erro: e.message });
    }

    // 2) SEFAZ (so com certificado) — complementa e corrige os campos fiscais
    if (cfg.sefaz_certificado) {
        try {
            const uf = String(req.query.uf || dados.uf || cfg.uf || 'SP').toUpperCase();
            const s = await sefaz.consultarCadastroContribuinte({
                uf, cnpj, certificado: cfg.sefaz_certificado, senha: cfg.sefaz_certificado_senha
            });
            dados = {
                ...dados,
                inscricao_estadual: s.inscricao_estadual || dados.inscricao_estadual || '',
                razao_social: s.razao_social || dados.razao_social,
                nome_fantasia: s.nome_fantasia || dados.nome_fantasia,
                indicador_ie: s.indicador_ie,
                // endereco fiscal manda, quando a SEFAZ devolve
                endereco: s.endereco || dados.endereco,
                numero: s.numero || dados.numero,
                complemento: s.complemento || dados.complemento,
                bairro: s.bairro || dados.bairro,
                cidade: s.cidade || dados.cidade,
                uf: s.uf || dados.uf,
                cep: s.cep || dados.cep,
                codigo_municipio: s.codigo_municipio || dados.codigo_municipio,
                situacao_contribuinte: s.situacao_contribuinte,
                habilitado: s.habilitado,
                regime_apuracao: s.regime_apuracao
            };
            fontes.push({ nome: s.fonte, ok: true, retorno: s.retorno });
        } catch (e) {
            fontes.push({ nome: 'SEFAZ', ok: false, erro: e.message });
        }
    } else {
        fontes.push({ nome: 'SEFAZ', ok: false, erro: 'certificado digital nao configurado' });
    }

    if (!fontes.some(f => f.ok)) {
        return erro(res, 502, 'Nenhuma fonte respondeu: ' + fontes.map(f => `${f.nome} (${f.erro})`).join(' · '));
    }
    res.json({ ...dados, cpf_cnpj: cnpj, tipo_pessoa: 'juridica', fontes });
}));

/* ---------------------------------------------------------------- consulta CNPJ
   Puxa os dados cadastrais pelo CNPJ e devolve no formato do cadastro.
   Provedor configuravel em Fiscal > Configuracao (padrao BrasilAPI, publico).
   A consulta ao Cadastro Centralizado de Contribuintes da SEFAZ exige
   certificado digital A1/A3 — quando o certificado estiver configurado, a
   integracao entra aqui como um segundo passo (campo sefaz_certificado). */
/* Consulta o CNPJ na base publica da Receita. Extraida da rota para poder ser
   reaproveitada pela consulta combinada (Receita + SEFAZ). Lanca em vez de
   responder, para quem chama decidir o que fazer com a falha. */
async function consultarCnpjReceita(cnpj, cfg) {
    if (!cfg.consulta_cnpj_ativa) throw new Error('Consulta de CNPJ desativada na configuracao fiscal');

    const base = cfg.consulta_cnpj_url || 'https://brasilapi.com.br/api/cnpj/v1/';
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 12000);
    let dados;
    try {
        /* User-Agent explicito: o fetch do Node se identifica como "undici" e a
           BrasilAPI (atras de Cloudflare) devolve 403 para esse agente. Com um
           UA de navegador a mesma consulta passa — o curl sempre funcionou. */
        const resposta = await fetch(base + cnpj, {
            signal: controle.signal,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; TREVO-ERP/2.0; +https://zyntra.com.br)'
            }
        });
        if (resposta.status === 404) throw new Error('CNPJ nao encontrado na base da Receita');
        if (!resposta.ok) throw new Error(`Servico de consulta respondeu ${resposta.status}`);
        dados = await resposta.json();
    } catch (e) {
        throw new Error(e.name === 'AbortError'
            ? 'A consulta demorou demais e foi cancelada'
            : 'Nao foi possivel falar com o servico de consulta de CNPJ');
    } finally { clearTimeout(prazo); }

    // BrasilAPI e ReceitaWS usam nomes diferentes — aceita os dois
    const pegar = (...chaves) => {
        for (const k of chaves) if (dados[k] !== undefined && dados[k] !== null && dados[k] !== '') return dados[k];
        return '';
    };
    const razao = pegar('razao_social', 'nome');
    const municipio = pegar('municipio', 'descricao_municipio');
    return {
        tipo_pessoa: 'juridica',
        cpf_cnpj: cnpj,
        nome: pegar('nome_fantasia', 'fantasia') || razao,
        razao_social: razao,
        nome_fantasia: pegar('nome_fantasia', 'fantasia'),
        situacao_cadastral: String(pegar('descricao_situacao_cadastral', 'situacao') || ''),
        atividade_principal: (() => {
            const ap = dados.cnae_fiscal_descricao ||
                (Array.isArray(dados.atividade_principal) && dados.atividade_principal[0] &&
                 dados.atividade_principal[0].text) || '';
            const cod = dados.cnae_fiscal || (Array.isArray(dados.atividade_principal) &&
                dados.atividade_principal[0] && dados.atividade_principal[0].code) || '';
            return [cod, ap].filter(Boolean).join(' - ');
        })(),
        natureza_juridica: String(pegar('natureza_juridica') || ''),
        data_abertura: (() => {
            const d = String(pegar('data_inicio_atividade', 'abertura') || '');
            const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            return br ? `${br[3]}-${br[2]}-${br[1]}` : (/^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
        })(),
        porte: String(pegar('porte', 'descricao_porte') || ''),
        simples_nacional: !!(dados.opcao_pelo_simples || (dados.simples && dados.simples.optante)),
        telefone: pegar('ddd_telefone_1', 'telefone'),
        email: pegar('email'),
        cep: String(pegar('cep') || '').replace(/\D/g, ''),
        endereco: [pegar('descricao_tipo_de_logradouro'), pegar('logradouro')].filter(Boolean).join(' ').trim(),
        numero: String(pegar('numero') || ''),
        complemento: pegar('complemento'),
        bairro: pegar('bairro'),
        cidade: municipio,
        uf: String(pegar('uf') || '').toUpperCase().slice(0, 2),
        codigo_municipio: String(pegar('codigo_municipio_ibge', 'codigo_municipio') || ''),
        indicador_ie: '9',
        fonte: base
    };
}
app.get('/api/integracao/cnpj/:cnpj', asyncRota(async (req, res) => {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return erro(res, 400, 'CNPJ deve ter 14 digitos');
    const cfg = await configFiscal();
    try {
        res.json(await consultarCnpjReceita(cnpj, cfg));
    } catch (e) {
        return erro(res, /nao encontrado/i.test(e.message) ? 404 : 502, e.message);
    }
}));

// ---------------------------------------------------------------- estoque
app.get('/api/estoque/movimentacoes', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.produto_id) { cond.push('produto_id = ?'); params.push(req.query.produto_id); }
    if (req.query.tipo) { cond.push('tipo = ?'); params.push(req.query.tipo); }
    const limite = Math.min(Number(req.query.limite || 200), 500);
    const [linhas] = await pool.query(
        'SELECT * FROM movimentacoes' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY id DESC LIMIT ' + limite, params
    );
    res.json(linhas.map(m => ({ ...m, quantidade: Number(m.quantidade), estoque_apos: Number(m.estoque_apos) })));
}));

app.post('/api/estoque/movimentar', asyncRota(async (req, res) => {
    const tipo = String(req.body.tipo || '');
    const qtd = num(req.body.quantidade, NaN);
    if (!['entrada', 'saida', 'ajuste'].includes(tipo)) return erro(res, 400, 'Tipo deve ser entrada, saida ou ajuste');
    if (!Number.isFinite(qtd)) return erro(res, 400, 'Quantidade invalida');
    if (tipo !== 'ajuste' && qtd <= 0) return erro(res, 400, 'Quantidade deve ser maior que zero');

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        // FOR UPDATE: trava a linha ate o commit (evita 2 movimentacoes simultaneas furarem o estoque)
        const [linhas] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [req.body.produto_id]);
        if (!linhas.length) { await conn.rollback(); return erro(res, 404, 'Produto nao encontrado'); }
        const p = linhas[0];
        const atual = Number(p.estoque);
        let novo;
        if (tipo === 'entrada') novo = atual + qtd;
        else if (tipo === 'saida') {
            if (qtd > atual) { await conn.rollback(); return erro(res, 400, `Estoque insuficiente (disponivel: ${atual})`); }
            novo = atual - qtd;
        } else novo = qtd;

        await conn.query('UPDATE produtos SET estoque = ? WHERE id = ?', [novo, p.id]);
        await conn.query(
            `INSERT INTO movimentacoes (produto_id, sku, descricao, tipo, quantidade, estoque_apos, motivo, usuario)
             VALUES (?,?,?,?,?,?,?,?)`,
            [p.id, p.sku, p.descricao, tipo, qtd, novo, req.body.motivo || '', req.usuario.usuario]
        );
        await conn.commit();
        res.status(201).json({ estoque_atual: novo });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

// ---------------------------------------------------------------- vendas
async function montarVenda(id) {
    const [[v]] = await pool.query('SELECT * FROM vendas WHERE id = ?', [id]);
    if (!v) return null;
    const [itens] = await pool.query('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY id', [id]);
    return {
        ...v,
        subtotal: Number(v.subtotal), desconto: Number(v.desconto), total: Number(v.total),
        itens: itens.map(i => ({ ...i, quantidade: Number(i.quantidade),
            preco_unitario: Number(i.preco_unitario), total: Number(i.total) }))
    };
}

app.get('/api/vendas', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.status) { cond.push('v.status = ?'); params.push(req.query.status); }
    if (req.query.busca) {
        cond.push('(v.cliente_nome LIKE ? OR v.placa LIKE ? OR v.veiculo_descricao LIKE ? OR v.id = ?)');
        const busca = '%' + req.query.busca + '%';
        params.push(busca, busca, busca, Number(req.query.busca) || 0);
    }
    const limite = Math.min(Number(req.query.limite || 300), 500);
    const [vendas] = await pool.query(
        'SELECT v.* FROM vendas v' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY v.id DESC LIMIT ' + limite, params
    );
    if (!vendas.length) return res.json([]);
    const ids = vendas.map(v => v.id);
    const [itens] = await pool.query('SELECT * FROM venda_itens WHERE venda_id IN (?)', [ids]);
    const [vinculos] = await pool.query(
        `SELECT nfv.venda_id, nf.id nota_id, nf.modelo, nf.status nota_status
           FROM nota_fiscal_vendas nfv JOIN notas_fiscais nf ON nf.id = nfv.nota_id
          WHERE nfv.venda_id IN (?) AND nf.status <> 'cancelada'
         UNION
         SELECT nf.venda_id, nf.id nota_id, nf.modelo, nf.status nota_status
           FROM notas_fiscais nf
          WHERE nf.venda_id IN (?) AND nf.status <> 'cancelada'`, [ids, ids]);
    const porVenda = {};
    const fiscalPorVenda = {};
    for (const v of vinculos) {
        const id = Number(v.venda_id);
        if (!fiscalPorVenda[id]) fiscalPorVenda[id] = { modelos: [], notas: [] };
        fiscalPorVenda[id].modelos.push(v.modelo);
        fiscalPorVenda[id].notas.push(v);
    }
    for (const i of itens) (porVenda[i.venda_id] = porVenda[i.venda_id] || []).push({
        ...i, quantidade: Number(i.quantidade), preco_unitario: Number(i.preco_unitario), total: Number(i.total)
    });
    res.json(vendas.map(v => ({
        ...v, subtotal: Number(v.subtotal), desconto: Number(v.desconto), total: Number(v.total),
        itens: porVenda[v.id] || [],
        nota_id: fiscalPorVenda[v.id]?.notas?.[0]?.nota_id || null,
        nota_status: fiscalPorVenda[v.id]?.notas?.[0]?.nota_status || null,
        nota_modelos: [...new Set(fiscalPorVenda[v.id]?.modelos || [])]
    })));
}));

app.get('/api/vendas/:id', asyncRota(async (req, res) => {
    const v = await montarVenda(req.params.id);
    if (!v) return erro(res, 404, 'Venda nao encontrada');
    res.json(v);
}));

app.post('/api/vendas', asyncRota(async (req, res) => {
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!itens.length) return erro(res, 400, 'A venda precisa de pelo menos um item');

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        let cliente = null;
        if (req.body.cliente_id) {
            const [cs] = await conn.query('SELECT id, nome, cpf_cnpj, uf FROM clientes WHERE id = ?', [req.body.cliente_id]);
            if (!cs.length) { await conn.rollback(); return erro(res, 404, 'Cliente nao encontrado'); }
            cliente = cs[0];
        }
        const veiculo = await validarVeiculoDoCliente(conn, req.body.veiculo_id, cliente && cliente.id);
        const motorista = await validarMotoristaDoCliente(conn, req.body.motorista_id, cliente && cliente.id) || {
            id: null, nome: String(req.body.motorista_nome || '').trim().slice(0, 160),
            cpf: String(req.body.motorista_doc || '').trim().slice(0, 20),
            telefone: String(req.body.motorista_telefone || '').trim().slice(0, 30)
        };
        const dataVenda = resolverDataComercial(req.body.data_venda, iso(agoraNaLoja()), 'Data da venda');

        // 1) valida e trava todos os itens antes de gravar a venda
        const preparados = [];
        for (const it of itens) {
            const tipo = it.tipo === 'servico' || it.servico_id ? 'servico' : 'produto';
            if (tipo === 'servico') {
                const [ss] = await conn.query('SELECT * FROM servicos WHERE id = ?', [it.servico_id]);
                if (!ss.length) { await conn.rollback(); return erro(res, 404, `Servico id ${it.servico_id} nao encontrado`); }
                const s = ss[0];
                if (!s.ativo) { await conn.rollback(); return erro(res, 400, `Servico "${s.nome}" esta inativo`); }
                const qtd = num(it.quantidade, NaN);
                const preco = it.preco_unitario === undefined ? Number(s.preco) : num(it.preco_unitario, NaN);
                if (!Number.isFinite(qtd) || qtd <= 0) { await conn.rollback(); return erro(res, 400, `Quantidade invalida em "${s.nome}"`); }
                if (!Number.isFinite(preco) || preco < 0) { await conn.rollback(); return erro(res, 400, `Preco invalido em "${s.nome}"`); }
                preparados.push({ tipo, s, p: null, qtd, preco });
                continue;
            }

            const [ps] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [it.produto_id]);
            if (!ps.length) { await conn.rollback(); return erro(res, 404, `Produto id ${it.produto_id} nao encontrado`); }
            const p = ps[0];
            if (!p.ativo) { await conn.rollback(); return erro(res, 400, `Produto "${p.descricao}" esta inativo`); }
            const qtd = num(it.quantidade, NaN);
            const preco = it.preco_unitario === undefined ? Number(p.preco_venda) : num(it.preco_unitario, NaN);
            if (!Number.isFinite(qtd) || qtd <= 0) { await conn.rollback(); return erro(res, 400, `Quantidade invalida em "${p.descricao}"`); }
            if (!Number.isFinite(preco) || preco < 0) { await conn.rollback(); return erro(res, 400, `Preco invalido em "${p.descricao}"`); }
            if (qtd > Number(p.estoque)) { await conn.rollback(); return erro(res, 400, `Estoque insuficiente de "${p.descricao}" (disponivel: ${Number(p.estoque)})`); }
            preparados.push({ tipo, p, s: null, qtd, preco });
        }

        const subtotal = preparados.reduce((s, x) => s + x.qtd * x.preco, 0);
        const desconto = num(req.body.desconto);
        if (desconto < 0 || desconto > subtotal) { await conn.rollback(); return erro(res, 400, 'Desconto invalido'); }

        const [rv] = await conn.query(
            `INSERT INTO vendas (cliente_id, cliente_nome, veiculo_id, placa, veiculo_descricao,
                motorista_id, motorista_nome, motorista_doc, motorista_telefone,
                subtotal, desconto, total, forma_pagamento, observacoes, status, data)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'concluida',?)`,
            [cliente ? cliente.id : null, cliente ? cliente.nome : 'Consumidor Final',
             veiculo ? veiculo.id : null, veiculo ? veiculo.placa : '',
             veiculo ? descricaoVeiculo(veiculo) : '',
             motorista ? motorista.id : null, motorista ? motorista.nome : '',
             motorista ? motorista.cpf : '', motorista ? motorista.telefone : '',
             subtotal.toFixed(2), desconto.toFixed(2), (subtotal - desconto).toFixed(2),
             req.body.forma_pagamento || 'dinheiro', req.body.observacoes || '',
             dataComercialDatetime(dataVenda)]
        );
        const vendaId = rv.insertId;

        // 2) so agora grava itens; estoque/movimentacao apenas para produto
        for (const { tipo, p, s, qtd, preco } of preparados) {
            const sku = tipo === 'servico' ? (s.codigo || `SRV${String(s.id).padStart(5, '0')}`) : p.sku;
            const descricao = tipo === 'servico' ? s.nome : p.descricao;
            const unidade = tipo === 'servico' ? 'UN' : (p.unidade || 'UN');
            await conn.query(
                `INSERT INTO venda_itens (venda_id, tipo, produto_id, servico_id, sku, descricao, unidade,
                    quantidade, preco_unitario, total)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [vendaId, tipo, p ? p.id : null, s ? s.id : null, sku, descricao, unidade,
                 qtd, preco.toFixed(2), (qtd * preco).toFixed(2)]
            );
            if (tipo === 'servico') continue;
            const novo = Number(p.estoque) - qtd;
            await conn.query('UPDATE produtos SET estoque = ? WHERE id = ?', [novo, p.id]);
            await conn.query(
                `INSERT INTO movimentacoes (produto_id, sku, descricao, tipo, quantidade, estoque_apos, motivo, venda_id, usuario)
                 VALUES (?,?,?,'venda',?,?,?,?,?)`,
                [p.id, p.sku, p.descricao, qtd, novo, `Venda #${vendaId}`, vendaId, req.usuario.usuario]
            );
        }

        // 3) toda venda gera o respectivo titulo no contas a receber.
        // A prazo nasce pendente; dinheiro/PIX/cartao ja nasce liquidado. Antes as
        // vendas pagas na hora nao tinham titulo e desapareciam do contas a receber.
        const aPrazo = ['fiado', 'boleto'].includes(req.body.forma_pagamento);
        const gerarReceber = req.body.gerar_receber === undefined ? true : !!req.body.gerar_receber;
        if (gerarReceber) {
            const dias = Number.isFinite(Number(req.body.dias_prazo)) && Number(req.body.dias_prazo) > 0
                ? Math.floor(Number(req.body.dias_prazo)) : 30;
            const totalVenda = (subtotal - desconto).toFixed(2);
            const [rr] = await conn.query(
                `INSERT INTO contas_receber (cliente_id, cliente_nome, cliente_doc, descricao, numero_documento,
                    venda_id, data_emissao, data_vencimento, data_recebimento, valor_original, valor_recebido,
                    categoria, forma_recebimento, status, usuario_criacao, usuario_recebimento)
                 VALUES (?,?,?,?,?,?,?,DATE_ADD(?, INTERVAL ? DAY),?,?,?,'vendas',?,?,?,?)`,
                [cliente ? cliente.id : null, cliente ? cliente.nome : 'Consumidor Final',
                 cliente ? (cliente.cpf_cnpj || '') : '', `Venda #${vendaId}`, `V${vendaId}`,
                 vendaId, dataVenda, dataVenda, aPrazo ? dias : 0,
                 aPrazo ? null : dataVenda, totalVenda, aPrazo ? 0 : totalVenda,
                 req.body.forma_pagamento || 'dinheiro', aPrazo ? 'pendente' : 'recebida',
                 req.usuario.usuario, aPrazo ? '' : req.usuario.usuario]
            );
            await conn.query('UPDATE contas_receber SET codigo = ? WHERE id = ?',
                ['CR' + String(rr.insertId).padStart(6, '0'), rr.insertId]);
        }

        await conn.commit();
        res.status(201).json(await montarVenda(vendaId));
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

app.patch('/api/vendas/:id/data', asyncRota(async (req, res) => {
    const dataVenda = resolverDataComercial(req.body.data_venda, iso(agoraNaLoja()), 'Data da venda');
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [vs] = await conn.query('SELECT id, status FROM vendas WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!vs.length) { await conn.rollback(); return erro(res, 404, 'Venda nao encontrada'); }
        if (vs[0].status === 'cancelada') { await conn.rollback(); return erro(res, 400, 'Venda cancelada nao pode ter a data alterada'); }
        await conn.query('UPDATE vendas SET data = ? WHERE id = ?', [dataComercialDatetime(dataVenda), req.params.id]);
        await conn.query(
            `UPDATE contas_receber
                SET data_vencimento = DATE_ADD(?, INTERVAL GREATEST(DATEDIFF(data_vencimento, COALESCE(data_emissao, data_vencimento)), 0) DAY),
                    data_emissao = ?
              WHERE venda_id = ? AND valor_recebido = 0 AND status <> 'cancelada'`,
            [dataVenda, dataVenda, req.params.id]
        );
        await conn.commit();
        res.json(await montarVenda(req.params.id));
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

app.post('/api/vendas/:id/cancelar', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [vs] = await conn.query('SELECT * FROM vendas WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!vs.length) { await conn.rollback(); return erro(res, 404, 'Venda nao encontrada'); }
        if (vs[0].status === 'cancelada') { await conn.rollback(); return erro(res, 400, 'Venda ja esta cancelada'); }

        const [[notaVinculada]] = await conn.query(
            `SELECT nf.id, nf.status FROM notas_fiscais nf
              LEFT JOIN nota_fiscal_vendas nfv ON nfv.nota_id=nf.id
             WHERE (nf.venda_id=? OR nfv.venda_id=?) AND nf.status <> 'cancelada'
             ORDER BY nf.id DESC LIMIT 1`, [req.params.id, req.params.id]);
        if (notaVinculada) {
            await conn.rollback();
            return erro(res, 409, `Venda vinculada a NF-e #${notaVinculada.id}; cancele a nota antes de cancelar a venda`);
        }

        const [itens] = await conn.query('SELECT * FROM venda_itens WHERE venda_id = ?', [req.params.id]);
        for (const it of itens) {
            if (!it.produto_id) continue;
            const [ps] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [it.produto_id]);
            if (!ps.length) continue;
            const novo = Number(ps[0].estoque) + Number(it.quantidade);
            await conn.query('UPDATE produtos SET estoque = ? WHERE id = ?', [novo, it.produto_id]);
            await conn.query(
                `INSERT INTO movimentacoes (produto_id, sku, descricao, tipo, quantidade, estoque_apos, motivo, venda_id, usuario)
                 VALUES (?,?,?,'cancelamento',?,?,?,?,?)`,
                [it.produto_id, it.sku, it.descricao, Number(it.quantidade), novo,
                 `Cancelamento da venda #${req.params.id}`, req.params.id, req.usuario.usuario]
            );
        }
        await conn.query("UPDATE vendas SET status = 'cancelada', cancelada_em = NOW() WHERE id = ?", [req.params.id]);
        // titulo gerado pela venda tambem cai fora — mas so se ainda nao recebeu nada
        await conn.query(
            "UPDATE contas_receber SET status='cancelada' WHERE venda_id = ? AND valor_recebido = 0 AND status <> 'cancelada'",
            [req.params.id]);
        await conn.commit();
        res.json(await montarVenda(req.params.id));
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

// ---------------------------------------------------------------- dashboard
app.get('/api/dashboard', asyncRota(async (req, res) => {
    const [[hoje]] = await pool.query(
        `SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM vendas
         WHERE status='concluida' AND DATE(data) = CURDATE()`);
    const [[mes]] = await pool.query(
        `SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM vendas
         WHERE status='concluida' AND data >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`);
    const [[mesAnt]] = await pool.query(
        `SELECT COALESCE(SUM(total),0) t FROM vendas
         WHERE status='concluida'
           AND data >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
           AND data <  DATE_FORMAT(CURDATE(), '%Y-%m-01')`);
    const [[tot]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM produtos WHERE ativo=1) produtos,
                (SELECT COUNT(*) FROM clientes) clientes,
                (SELECT COALESCE(SUM(estoque*preco_custo),0) FROM produtos) valor_estoque`);
    const [abaixo] = await pool.query(
        `SELECT id, sku, descricao, estoque, estoque_minimo FROM produtos
         WHERE ativo=1 AND estoque <= estoque_minimo
         ORDER BY (estoque - estoque_minimo) LIMIT 10`);
    const [[qtdAbaixo]] = await pool.query(
        'SELECT COUNT(*) n FROM produtos WHERE ativo=1 AND estoque <= estoque_minimo');
    const [ultimas] = await pool.query(
        'SELECT id, cliente_nome, total, status, data FROM vendas ORDER BY id DESC LIMIT 8');

    res.json({
        vendas_hoje: hoje.n,
        faturamento_hoje: Number(hoje.t),
        vendas_mes: mes.n,
        faturamento_mes: Number(mes.t),
        faturamento_mes_anterior: Number(mesAnt.t),
        total_produtos: tot.produtos,
        total_clientes: tot.clientes,
        valor_estoque: Number(tot.valor_estoque),
        abaixo_minimo: abaixo.map(p => ({ ...p, estoque: Number(p.estoque), estoque_minimo: Number(p.estoque_minimo) })),
        abaixo_minimo_total: qtdAbaixo.n,
        ultimas_vendas: ultimas.map(v => ({ ...v, total: Number(v.total) }))
    });
}));

// ================================================================
// FINANCEIRO — fornecedores, contas a pagar e contas a receber
// (mesmo modelo do modulo Financeiro da Aluforce)
// ================================================================

// "vencida" NAO e status gravado: e derivado de data_vencimento < hoje.
// Assim a lista nunca depende de um job diario para ficar correta.
const dinheiro = (v) => Number(Number(v || 0).toFixed(2));

/* Colunas DATE voltam do mysql2 como Date na meia-noite LOCAL. Se saissem no
   JSON como ISO (UTC), um servidor em fuso positivo devolveria o dia anterior.
   Entao todo campo de data pura sai daqui ja como 'AAAA-MM-DD'. */
function dataIso(v) {
    if (!v) return null;
    if (v instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const nContaPagar = (c) => ({
    ...c,
    tem_historico_pagamento: !!c.tem_historico_pagamento,
    data_emissao: dataIso(c.data_emissao),
    data_vencimento: dataIso(c.data_vencimento),
    data_pagamento: dataIso(c.data_pagamento),
    valor_original: Number(c.valor_original), valor_pago: Number(c.valor_pago),
    valor_desconto: Number(c.valor_desconto), valor_juros: Number(c.valor_juros),
    valor_multa: Number(c.valor_multa),
    valor_devido: dinheiro(Number(c.valor_original) + Number(c.valor_juros) + Number(c.valor_multa) - Number(c.valor_desconto)),
    saldo: dinheiro(Number(c.valor_original) + Number(c.valor_juros) + Number(c.valor_multa) - Number(c.valor_desconto) - Number(c.valor_pago))
});

const nContaReceber = (c) => ({
    ...c,
    data_emissao: dataIso(c.data_emissao),
    data_vencimento: dataIso(c.data_vencimento),
    data_recebimento: dataIso(c.data_recebimento),
    valor_original: Number(c.valor_original), valor_recebido: Number(c.valor_recebido),
    valor_desconto: Number(c.valor_desconto), valor_juros: Number(c.valor_juros),
    valor_multa: Number(c.valor_multa),
    valor_devido: dinheiro(Number(c.valor_original) + Number(c.valor_juros) + Number(c.valor_multa) - Number(c.valor_desconto)),
    saldo: dinheiro(Number(c.valor_original) + Number(c.valor_juros) + Number(c.valor_multa) - Number(c.valor_desconto) - Number(c.valor_recebido))
});

/* Normaliza qualquer data para 'AAAA-MM-DD'.
   O mysql2 devolve coluna DATE como objeto Date, e `String(Date)` vira
   "Thu Aug 20 2026 ..." — cortar em 10 caracteres dava "Thu Aug 20", o regex
   reprovava e a funcao devolvia null. Como contas_pagar.data_vencimento e NOT
   NULL, todo caminho que reaproveita a data ja gravada (DDA -> conta a pagar,
   importacao de DANFE, sincronizacao da SEFAZ) morria com erro 500. */
const soData = (v) => {
    if (!v) return null;
    if (v instanceof Date) {
        if (isNaN(v.getTime())) return null;
        // compensa o fuso para nao andar um dia: interessa a data do calendario
        return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    const s = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [ano, mes, dia] = s.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
        ? s : null;
};

function validarConta(b) {
    if (!String(b.descricao || '').trim()) return 'Descricao e obrigatoria';
    if (!soData(b.data_vencimento)) return 'Data de vencimento invalida (use AAAA-MM-DD)';
    if (b.data_emissao && !soData(b.data_emissao)) return 'Data de emissao invalida';
    if (!(num(b.valor_original, -1) > 0)) return 'Valor deve ser maior que zero';
    return null;
}

const nNotaEntrada = (n) => n ? ({
    ...n,
    data_emissao: dataIso(n.data_emissao),
    valor_total: Number(n.valor_total),
    valor_parcelado: Number(n.valor_parcelado),
    valor_pago: Number(n.valor_pago),
    saldo: Number(n.saldo),
    total_parcelas: Number(n.total_parcelas),
    parcelas_quitadas: Number(n.parcelas_quitadas),
    parcelamento_estimado: !!n.parcelamento_estimado
}) : null;

async function recalcularNotaEntrada(conn, notaId) {
    if (!notaId) return null;
    const [[nota]] = await conn.query('SELECT * FROM notas_entrada WHERE id = ? FOR UPDATE', [notaId]);
    if (!nota) return null;
    const [parcelas] = await conn.query(
        `SELECT status, valor_original, valor_pago, valor_desconto, valor_juros, valor_multa,
                (valor_original + valor_juros + valor_multa - valor_desconto) valor_devido,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_pago) saldo
           FROM contas_pagar WHERE nota_entrada_id = ? ORDER BY id FOR UPDATE`, [notaId]);
    const resumo = resumirNota(parcelas, nota.valor_total);
    await conn.query(
        `UPDATE notas_entrada SET valor_parcelado=?, valor_pago=?, saldo=?, total_parcelas=?,
                parcelas_quitadas=?, status=?, quitada_em=CASE WHEN ?='quitada'
                    THEN COALESCE(quitada_em,NOW()) ELSE NULL END WHERE id=?`,
        [resumo.valor_parcelado, resumo.valor_pago, resumo.saldo, resumo.total_parcelas,
         resumo.parcelas_quitadas, resumo.status, resumo.status, notaId]);
    return nNotaEntrada({ ...nota, ...resumo,
        quitada_em: resumo.status === 'quitada' ? (nota.quitada_em || new Date()) : null });
}

/* Ordem unica de locks para qualquer mutacao financeira: nota-pai primeiro e
   todas as parcelas depois. Isso evita deadlock e snapshot antigo quando duas
   parcelas irmas sao pagas ao mesmo tempo. */
async function bloquearContaFinanceira(conn, contaId) {
    const [[referencia]] = await conn.query(
        'SELECT id, nota_entrada_id FROM contas_pagar WHERE id=?', [contaId]);
    if (!referencia) return null;
    if (!referencia.nota_entrada_id) {
        const [[conta]] = await conn.query('SELECT * FROM contas_pagar WHERE id=? FOR UPDATE', [contaId]);
        return conta || null;
    }
    await conn.query('SELECT id FROM notas_entrada WHERE id=? FOR UPDATE', [referencia.nota_entrada_id]);
    const [parcelas] = await conn.query(
        'SELECT * FROM contas_pagar WHERE nota_entrada_id=? ORDER BY id FOR UPDATE',
        [referencia.nota_entrada_id]);
    return parcelas.find(p => Number(p.id) === Number(contaId)) || null;
}

async function obterOuCriarFornecedor(conn, { id, nome, documento, observacao }) {
    if (id) {
        const [[fornecedor]] = await conn.query('SELECT * FROM fornecedores WHERE id = ?', [id]);
        if (!fornecedor) throw Object.assign(new Error('Fornecedor nao encontrado'), { status: 404 });
        return { fornecedor, criado: false };
    }

    const nomeLimpo = String(nome || '').trim();
    const docLimpo = String(documento || '').replace(/\D/g, '');
    if (!nomeLimpo) throw Object.assign(new Error('Informe o fornecedor da nota'), { status: 400 });

    let fornecedor = null;
    if (docLimpo) {
        const [porDoc] = await conn.query(
            `SELECT * FROM fornecedores
              WHERE REPLACE(REPLACE(REPLACE(cnpj_cpf,'.',''),'/',''),'-','') = ? LIMIT 1`, [docLimpo]);
        fornecedor = porDoc[0] || null;
    }
    if (!fornecedor) {
        const [porNome] = await conn.query('SELECT * FROM fornecedores WHERE nome = ? LIMIT 1', [nomeLimpo]);
        fornecedor = porNome[0] || null;
    }
    if (fornecedor) return { fornecedor, criado: false };

    const [r] = await conn.query(
        'INSERT INTO fornecedores (nome, cnpj_cpf, observacoes) VALUES (?,?,?)',
        [nomeLimpo, docLimpo, observacao || 'Cadastrado automaticamente por nota de entrada']);
    const [[novo]] = await conn.query('SELECT * FROM fornecedores WHERE id = ?', [r.insertId]);
    return { fornecedor: novo, criado: true };
}

/* Uma unica transacao cria o cabecalho fiscal, as parcelas no DDA e as contas.
   Assim nunca existe "meia nota" caso uma das quatro parcelas falhe. */
async function criarNotaEntradaComParcelas(conn, dados) {
    const parcelasRecebidas = Array.isArray(dados.parcelas) ? dados.parcelas : [];
    const parcelas = parcelasRecebidas
        .map((p, indice) => ({
            numero: String(p.numero || indice + 1).slice(0, 10),
            vencimento: soData(p.vencimento),
            valor: dinheiro(num(p.valor))
        }))
        .filter(p => p.vencimento && p.valor > 0);
    if (!parcelas.length) throw Object.assign(new Error('Informe ao menos uma parcela valida'), { status: 400 });
    if (parcelas.length !== parcelasRecebidas.length)
        throw Object.assign(new Error('Uma ou mais parcelas possuem vencimento ou valor invalido'), { status: 400 });

    const valorParcelado = dinheiro(parcelas.reduce((s, p) => s + p.valor, 0));
    const valorTotal = dinheiro(num(dados.valor_total, valorParcelado));
    if (!(valorTotal > 0)) throw Object.assign(new Error('Valor total da nota invalido'), { status: 400 });

    if (dados.origem_referencia) {
        const [[existente]] = await conn.query(
            'SELECT id FROM notas_entrada WHERE origem_referencia = ? FOR UPDATE', [dados.origem_referencia]);
        if (existente) {
            const e = new Error('Esta nota ja foi lancada no contas a pagar');
            e.status = 409; e.codigo = 'NOTA_DUPLICADA'; e.notaId = existente.id;
            throw e;
        }
    }

    const { fornecedor, criado } = await obterOuCriarFornecedor(conn, {
        id: dados.fornecedor_id,
        nome: dados.fornecedor_nome,
        documento: dados.fornecedor_doc,
        observacao: 'Cadastrado automaticamente pela importacao de documento fiscal'
    });
    const numero = String(dados.numero || '').trim().slice(0, 50);
    const serie = String(dados.serie || '').trim().slice(0, 10);
    const chave = String(dados.chave || '').replace(/\D/g, '').slice(0, 50);

    const [rn] = await conn.query(
        `INSERT INTO notas_entrada (origem, origem_referencia, chave, numero, serie, fornecedor_id,
            fornecedor_nome, fornecedor_doc, data_emissao, valor_total, valor_parcelado, saldo,
            total_parcelas, parcelamento_estimado, observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [String(dados.origem || 'manual').slice(0, 20), dados.origem_referencia || null,
         chave, numero, serie, fornecedor.id, fornecedor.nome, fornecedor.cnpj_cpf || '',
         soData(dados.data_emissao), valorTotal, valorParcelado, valorParcelado,
         parcelas.length, dados.parcelamento_estimado ? 1 : 0,
         String(dados.observacoes || '').slice(0, 500)]);
    const notaId = rn.insertId;
    const contas = [];

    for (const [indice, parcela] of parcelas.entries()) {
        const numeroParcela = indice + 1;
        const rotulo = dados.rotulo || 'NF';
        const descricao = `${rotulo} ${numero || 's/n'} — parcela ${numeroParcela}/${parcelas.length}`;
        const observacoes = [dados.observacoes_conta, chave ? `chave ${chave}` : '']
            .filter(Boolean).join(' — ').slice(0, 400);
        const docParcela = [numero, parcela.numero].filter(Boolean).join('/').slice(0, 50);

        const [rd] = await conn.query(
            `INSERT INTO dda_titulos (beneficiario_nome, beneficiario_cnpj, numero_documento,
                data_vencimento, valor, situacao, origem, nota_entrada_id, numero_parcela,
                total_parcelas, observacoes, usuario)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [fornecedor.nome, fornecedor.cnpj_cpf || '', docParcela, parcela.vencimento,
             parcela.valor, dados.gerar_contas === false ? 'disponivel' : 'vinculado',
             String(dados.origem || 'manual').slice(0, 12), notaId, numeroParcela, parcelas.length,
             observacoes || `Parcela de ${rotulo} ${numero || 's/n'}`, dados.usuario || 'sistema']);

        if (dados.gerar_contas === false) {
            contas.push({ id: null, dda_id: rd.insertId, numero: numeroParcela,
                vencimento: parcela.vencimento, valor: parcela.valor });
            continue;
        }

        const [rc] = await conn.query(
            `INSERT INTO contas_pagar (fornecedor_id, fornecedor_nome, fornecedor_doc, descricao,
                numero_documento, nota_entrada_id, numero_parcela, total_parcelas, data_emissao,
                data_vencimento, valor_original, categoria, forma_pagamento, observacoes, usuario_criacao)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [fornecedor.id, fornecedor.nome, fornecedor.cnpj_cpf || '', descricao, numero,
             notaId, numeroParcela, parcelas.length, soData(dados.data_emissao), parcela.vencimento,
             parcela.valor, dados.categoria || 'fornecedores', dados.forma_pagamento || 'boleto',
             observacoes, dados.usuario || 'sistema']);
        await conn.query('UPDATE contas_pagar SET codigo = ? WHERE id = ?',
            ['CP' + String(rc.insertId).padStart(6, '0'), rc.insertId]);
        await conn.query('UPDATE dda_titulos SET conta_pagar_id = ? WHERE id = ?', [rc.insertId, rd.insertId]);
        contas.push({ id: rc.insertId, dda_id: rd.insertId, numero: numeroParcela,
            vencimento: parcela.vencimento, valor: parcela.valor });
    }

    const nota = dados.gerar_contas === false
        ? nNotaEntrada((await conn.query('SELECT * FROM notas_entrada WHERE id=?', [notaId]))[0][0])
        : await recalcularNotaEntrada(conn, notaId);
    return { nota, contas, fornecedor_criado: criado };
}

// ---------------------------------------------------------------- notas de entrada
app.get('/api/notas-entrada', asyncRota(async (req, res) => {
    const cond = [], params = [];
    if (req.query.status) { cond.push('status = ?'); params.push(req.query.status); }
    if (req.query.busca) {
        cond.push('(numero LIKE ? OR chave LIKE ? OR fornecedor_nome LIKE ? OR fornecedor_doc LIKE ?)');
        const t = '%' + req.query.busca + '%'; params.push(t, t, t, t);
    }
    const [linhas] = await pool.query(
        `SELECT * FROM notas_entrada ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
         ORDER BY COALESCE(data_emissao,DATE(criado_em)) DESC,id DESC LIMIT 500`, params);
    res.json(linhas.map(nNotaEntrada));
}));

app.get('/api/notas-entrada/:id', asyncRota(async (req, res) => {
    const [[nota]] = await pool.query('SELECT * FROM notas_entrada WHERE id = ?', [req.params.id]);
    if (!nota) return erro(res, 404, 'Nota de entrada nao encontrada');
    const [parcelas] = await pool.query(
        'SELECT * FROM contas_pagar WHERE nota_entrada_id = ? ORDER BY numero_parcela,id', [req.params.id]);
    res.json({ ...nNotaEntrada(nota), parcelas: parcelas.map(nContaPagar) });
}));

app.post('/api/notas-entrada', asyncRota(async (req, res) => {
    const b = req.body;
    if (!String(b.numero || '').trim()) return erro(res, 400, 'Informe o numero da nota');
    let parcelas;
    try {
        parcelas = criarParcelasIguais({
            valorTotal: b.valor_total,
            quantidade: Number(b.quantidade_parcelas || 1),
            primeiroVencimento: b.primeiro_vencimento,
            intervaloMeses: Number(b.intervalo_meses || 1)
        });
    } catch (e) { return erro(res, 400, e.message); }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const criado = await criarNotaEntradaComParcelas(conn, {
            origem: 'manual',
            origem_referencia: `manual:${b.fornecedor_id || String(b.fornecedor_nome || '').trim().toLowerCase()}:${String(b.serie || '')}:${String(b.numero).trim()}`,
            numero: b.numero, serie: b.serie,
            fornecedor_id: b.fornecedor_id, fornecedor_nome: b.fornecedor_nome,
            fornecedor_doc: b.fornecedor_doc, data_emissao: b.data_emissao,
            valor_total: b.valor_total, parcelas, categoria: b.categoria,
            forma_pagamento: b.forma_pagamento, observacoes: b.observacoes,
            observacoes_conta: 'Gerado pelo parcelamento da nota de entrada',
            usuario: req.usuario.usuario
        });
        await conn.commit();
        res.status(201).json(criado);
    } catch (e) {
        await conn.rollback();
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Esta nota ja foi lancada no contas a pagar');
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

// ---------------------------------------------------------------- fornecedores
app.get('/api/fornecedores', asyncRota(async (req, res) => {
    let sql = 'SELECT * FROM fornecedores';
    const params = [];
    if (req.query.busca) {
        sql += ' WHERE nome LIKE ? OR cnpj_cpf LIKE ? OR telefone LIKE ? OR email LIKE ?';
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t);
    }
    const [linhas] = await pool.query(sql + ' ORDER BY nome', params);
    res.json(linhas.map(f => ({ ...f, ativo: !!f.ativo })));
}));

app.post('/api/fornecedores', asyncRota(async (req, res) => {
    const b = req.body;
    if (!String(b.nome || '').trim()) return erro(res, 400, 'Nome e obrigatorio');
    const [r] = await pool.query(
        `INSERT INTO fornecedores (nome, cnpj_cpf, telefone, email, endereco, cidade, uf, observacoes, ativo)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [String(b.nome).trim(), b.cnpj_cpf || '', b.telefone || '', b.email || '', b.endereco || '',
         b.cidade || '', String(b.uf || '').toUpperCase().slice(0, 2), b.observacoes || '',
         b.ativo === false ? 0 : 1]
    );
    const [[novo]] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [r.insertId]);
    res.status(201).json({ ...novo, ativo: !!novo.ativo });
}));

app.put('/api/fornecedores/:id', asyncRota(async (req, res) => {
    const b = req.body;
    if (!String(b.nome || '').trim()) return erro(res, 400, 'Nome e obrigatorio');
    const [r] = await pool.query(
        `UPDATE fornecedores SET nome=?, cnpj_cpf=?, telefone=?, email=?, endereco=?, cidade=?, uf=?,
            observacoes=?, ativo=? WHERE id=?`,
        [String(b.nome).trim(), b.cnpj_cpf || '', b.telefone || '', b.email || '', b.endereco || '',
         b.cidade || '', String(b.uf || '').toUpperCase().slice(0, 2), b.observacoes || '',
         b.ativo === false ? 0 : 1, req.params.id]
    );
    if (!r.affectedRows) return erro(res, 404, 'Fornecedor nao encontrado');
    const [[f]] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [req.params.id]);
    res.json({ ...f, ativo: !!f.ativo });
}));

app.delete('/api/fornecedores/:id', asyncRota(async (req, res) => {
    const [[usado]] = await pool.query('SELECT COUNT(*) n FROM contas_pagar WHERE fornecedor_id = ?', [req.params.id]);
    if (usado.n > 0) return erro(res, 409, 'Fornecedor possui contas lancadas - inative-o em vez de excluir');
    const [r] = await pool.query('DELETE FROM fornecedores WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Fornecedor nao encontrado');
    res.json({ message: 'Fornecedor excluido' });
}));

// ---------------------------------------------------------------- contas a pagar
app.get('/api/contas-pagar', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.status) { cond.push('cp.status = ?'); params.push(req.query.status); }
    if (req.query.categoria) { cond.push('cp.categoria = ?'); params.push(req.query.categoria); }
    if (req.query.fornecedor_id) { cond.push('cp.fornecedor_id = ?'); params.push(req.query.fornecedor_id); }
    if (req.query.nota_entrada_id) { cond.push('cp.nota_entrada_id = ?'); params.push(req.query.nota_entrada_id); }
    if (req.query.em_aberto === '1') cond.push("cp.status NOT IN ('paga','cancelada')");
    if (req.query.de) { cond.push('cp.data_vencimento >= ?'); params.push(soData(req.query.de)); }
    if (req.query.ate) { cond.push('cp.data_vencimento <= ?'); params.push(soData(req.query.ate)); }
    if (req.query.busca) {
        cond.push('(cp.fornecedor_nome LIKE ? OR cp.descricao LIKE ? OR cp.numero_documento LIKE ? OR cp.codigo LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t);
    }
    const limite = Math.min(Number(req.query.limite || 500), 2000);
    const [linhas] = await pool.query(
        `SELECT cp.*, ne.numero nota_numero, ne.serie nota_serie, ne.status nota_status,
                ne.valor_total nota_valor_total,
                EXISTS(SELECT 1 FROM contas_pagar_pagamentos cpp WHERE cpp.conta_pagar_id=cp.id) tem_historico_pagamento
           FROM contas_pagar cp LEFT JOIN notas_entrada ne ON ne.id=cp.nota_entrada_id` +
        (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY cp.data_vencimento ASC, cp.id ASC LIMIT ' + limite, params
    );
    res.json(linhas.map(nContaPagar));
}));

app.post('/api/contas-pagar', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = validarConta(b);
    if (msg) return erro(res, 400, msg);

    let fornecedor = null;
    if (b.fornecedor_id) {
        const [fs] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [b.fornecedor_id]);
        if (!fs.length) return erro(res, 404, 'Fornecedor nao encontrado');
        fornecedor = fs[0];
    }
    const nome = fornecedor ? fornecedor.nome : String(b.fornecedor_nome || '').trim();
    if (!nome) return erro(res, 400, 'Informe o fornecedor');

    const [r] = await pool.query(
        `INSERT INTO contas_pagar (fornecedor_id, fornecedor_nome, fornecedor_doc, descricao, numero_documento,
            data_emissao, data_vencimento, valor_original, categoria, forma_pagamento, observacoes, usuario_criacao)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [fornecedor ? fornecedor.id : null, nome, fornecedor ? fornecedor.cnpj_cpf : (b.fornecedor_doc || ''),
         String(b.descricao).trim(), b.numero_documento || '', soData(b.data_emissao), soData(b.data_vencimento),
         num(b.valor_original), b.categoria || 'outros', b.forma_pagamento || '', b.observacoes || '',
         req.usuario.usuario]
    );
    await pool.query('UPDATE contas_pagar SET codigo = ? WHERE id = ?',
        ['CP' + String(r.insertId).padStart(6, '0'), r.insertId]);
    const [[nova]] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [r.insertId]);
    res.status(201).json(nContaPagar(nova));
}));

app.put('/api/contas-pagar/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = validarConta(b);
    if (msg) return erro(res, 400, msg);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const atual = await bloquearContaFinanceira(conn, req.params.id);
        if (!atual) { await conn.rollback(); return erro(res, 404, 'Conta nao encontrada'); }
        if (atual.status === 'paga') {
            await conn.rollback(); return erro(res, 409, 'Conta ja paga - estorne o pagamento antes de editar');
        }

        if (atual.nota_entrada_id) {
            const mudouFiscal = dinheiro(b.valor_original) !== dinheiro(atual.valor_original) ||
                String(b.numero_documento || '') !== String(atual.numero_documento || '') ||
                Number(b.fornecedor_id || 0) !== Number(atual.fornecedor_id || 0) ||
                (b.data_emissao && soData(b.data_emissao) !== soData(atual.data_emissao));
            if (mudouFiscal) {
                await conn.rollback();
                return erro(res, 409, 'Valor, fornecedor, numero e emissao pertencem a nota fiscal e nao podem ser alterados na parcela');
            }
            await conn.query(
                `UPDATE contas_pagar SET descricao=?, data_vencimento=?, categoria=?, forma_pagamento=?,
                    observacoes=? WHERE id=?`,
                [String(b.descricao).trim(), soData(b.data_vencimento), b.categoria || 'fornecedores',
                 b.forma_pagamento || '', b.observacoes || '', atual.id]);
        } else {
            let fornecedor = null;
            if (b.fornecedor_id) {
                const [fs] = await conn.query('SELECT * FROM fornecedores WHERE id = ?', [b.fornecedor_id]);
                if (!fs.length) { await conn.rollback(); return erro(res, 404, 'Fornecedor nao encontrado'); }
                fornecedor = fs[0];
            }
            const nome = fornecedor ? fornecedor.nome : String(b.fornecedor_nome || '').trim();
            if (!nome) { await conn.rollback(); return erro(res, 400, 'Informe o fornecedor'); }
            await conn.query(
                `UPDATE contas_pagar SET fornecedor_id=?, fornecedor_nome=?, fornecedor_doc=?, descricao=?,
                    numero_documento=?, data_emissao=?, data_vencimento=?, valor_original=?, categoria=?,
                    forma_pagamento=?, observacoes=? WHERE id=?`,
                [fornecedor ? fornecedor.id : null, nome,
                 fornecedor ? fornecedor.cnpj_cpf : (b.fornecedor_doc || ''),
                 String(b.descricao).trim(), b.numero_documento || '', soData(b.data_emissao),
                 soData(b.data_vencimento), num(b.valor_original), b.categoria || 'outros',
                 b.forma_pagamento || '', b.observacoes || '', atual.id]);
        }
        const nota = await recalcularNotaEntrada(conn, atual.nota_entrada_id);
        const [[c]] = await conn.query('SELECT * FROM contas_pagar WHERE id = ?', [atual.id]);
        await conn.commit();
        res.json({ ...nContaPagar(c), nota_entrada: nota });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

app.post('/api/contas-pagar/:id/pagar', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const c = await bloquearContaFinanceira(conn, req.params.id);
        if (!c) { await conn.rollback(); return erro(res, 404, 'Conta nao encontrada'); }
        const idempotencia = String(req.get('Idempotency-Key') || req.body.idempotency_key || crypto.randomUUID()).slice(0, 80);
        const requestHash = crypto.createHash('sha256').update(JSON.stringify({
            valor: req.body.valor === undefined || req.body.valor === '' ? null : dinheiro(num(req.body.valor)),
            data_pagamento: String(req.body.data_pagamento || ''),
            desconto: dinheiro(num(req.body.desconto)), juros: dinheiro(num(req.body.juros)),
            multa: dinheiro(num(req.body.multa)), forma_pagamento: String(req.body.forma_pagamento || '')
        })).digest('hex');
        const [[jaProcessado]] = await conn.query(
            'SELECT id,request_hash FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND idempotency_key=?',
            [c.id, idempotencia]);
        if (jaProcessado) {
            if (jaProcessado.request_hash && jaProcessado.request_hash !== requestHash) {
                await conn.rollback();
                return erro(res, 409, 'A chave de idempotencia ja foi usada com dados de pagamento diferentes');
            }
            const [[atual]] = await conn.query('SELECT * FROM contas_pagar WHERE id = ?', [c.id]);
            const nota = c.nota_entrada_id
                ? (await conn.query('SELECT * FROM notas_entrada WHERE id = ?', [c.nota_entrada_id]))[0][0]
                : null;
            await conn.commit();
            return res.json({ ...nContaPagar(atual), nota_entrada: nNotaEntrada(nota), repetido: true });
        }
        if (c.status === 'paga') { await conn.rollback(); return erro(res, 400, 'Conta ja esta paga'); }
        if (c.status === 'cancelada') { await conn.rollback(); return erro(res, 400, 'Conta cancelada nao pode ser paga'); }

        const desconto = Number(c.valor_desconto) + num(req.body.desconto);
        const juros = Number(c.valor_juros) + num(req.body.juros);
        const multa = Number(c.valor_multa) + num(req.body.multa);
        const devido = dinheiro(Number(c.valor_original) + juros + multa - desconto);
        const saldo = dinheiro(devido - Number(c.valor_pago));

        // sem valor informado, quita o saldo restante
        const valor = req.body.valor === undefined || req.body.valor === '' ? saldo : num(req.body.valor, NaN);
        if (!Number.isFinite(valor) || valor <= 0) { await conn.rollback(); return erro(res, 400, 'Valor do pagamento invalido'); }
        if (valor > saldo + 0.005) { await conn.rollback(); return erro(res, 400, `Valor maior que o saldo devedor (${saldo.toFixed(2)})`); }

        const pago = dinheiro(Number(c.valor_pago) + valor);
        const quitada = pago + 0.005 >= devido;
        const data = soData(req.body.data_pagamento) || new Date().toISOString().slice(0, 10);

        await conn.query(
            `INSERT INTO contas_pagar_pagamentos (conta_pagar_id,idempotency_key,request_hash,valor,desconto,
                juros,multa,data_pagamento,forma_pagamento,usuario)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [c.id, idempotencia, requestHash, valor, num(req.body.desconto), num(req.body.juros),
             num(req.body.multa), data, req.body.forma_pagamento || c.forma_pagamento,
             req.usuario.usuario]);

        await conn.query(
            `UPDATE contas_pagar SET valor_pago=?, valor_desconto=?, valor_juros=?, valor_multa=?,
                status=?, data_pagamento=?, forma_pagamento=?, usuario_pagamento=? WHERE id=?`,
            [pago, desconto, juros, multa, quitada ? 'paga' : 'parcial', quitada ? data : c.data_pagamento,
             req.body.forma_pagamento || c.forma_pagamento, req.usuario.usuario, c.id]
        );
        const nota = await recalcularNotaEntrada(conn, c.nota_entrada_id);
        const [[nova]] = await conn.query('SELECT * FROM contas_pagar WHERE id = ?', [c.id]);
        await conn.commit();
        res.json({ ...nContaPagar(nova), nota_entrada: nota, idempotency_key: idempotencia });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

app.post('/api/contas-pagar/:id/estornar', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const atual = await bloquearContaFinanceira(conn, req.params.id);
        if (!atual) { await conn.rollback(); return erro(res, 404, 'Conta nao encontrada'); }
        await conn.query(
            `UPDATE contas_pagar SET valor_pago=0, valor_juros=0, valor_multa=0, valor_desconto=0,
                data_pagamento=NULL, status='pendente', usuario_pagamento='' WHERE id=?`, [req.params.id]);
        await conn.query(
            `UPDATE contas_pagar_pagamentos SET estornado_em=COALESCE(estornado_em,NOW()), estornado_por=?
              WHERE conta_pagar_id=? AND estornado_em IS NULL`, [req.usuario.usuario, req.params.id]);
        const nota = await recalcularNotaEntrada(conn, atual.nota_entrada_id);
        const [[c]] = await conn.query('SELECT * FROM contas_pagar WHERE id = ?', [req.params.id]);
        await conn.commit();
        res.json({ ...nContaPagar(c), nota_entrada: nota });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

app.get('/api/contas-pagar/:id/pagamentos', asyncRota(async (req, res) => {
    const [linhas] = await pool.query(
        `SELECT id,valor,desconto,juros,multa,data_pagamento,forma_pagamento,usuario,
                criado_em,estornado_em,estornado_por
           FROM contas_pagar_pagamentos WHERE conta_pagar_id=? ORDER BY id`, [req.params.id]);
    res.json(linhas.map(p => ({ ...p, valor: Number(p.valor), desconto: Number(p.desconto),
        juros: Number(p.juros), multa: Number(p.multa), data_pagamento: dataIso(p.data_pagamento) })));
}));

app.get('/api/contas-pagar-pagamentos/resumo', asyncRota(async (req, res) => {
    const mes = String(req.query.mes || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(mes)) return erro(res, 400, 'Mes invalido');
    const [[r]] = await pool.query(
        `SELECT COUNT(*) quantidade, COALESCE(SUM(valor),0) total_pago,
                COALESCE(SUM(desconto),0) total_desconto,
                COALESCE(SUM(juros + multa),0) total_encargos
           FROM contas_pagar_pagamentos
          WHERE estornado_em IS NULL AND DATE_FORMAT(data_pagamento,'%Y-%m')=?`, [mes]);
    res.json({ quantidade: Number(r.quantidade), total_pago: Number(r.total_pago),
        total_desconto: Number(r.total_desconto), total_encargos: Number(r.total_encargos) });
}));

app.post('/api/contas-pagar/:id/cancelar', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const atual = await bloquearContaFinanceira(conn, req.params.id);
        if (!atual || atual.status === 'paga') {
            await conn.rollback(); return erro(res, 409, 'Conta nao encontrada ou ja paga');
        }
        if (Number(atual.valor_pago) > 0 || atual.status === 'parcial') {
            await conn.rollback(); return erro(res, 409, 'Estorne os pagamentos antes de cancelar a parcela');
        }
        await conn.query("UPDATE contas_pagar SET status='cancelada' WHERE id=?", [req.params.id]);
        const nota = await recalcularNotaEntrada(conn, atual.nota_entrada_id);
        const [[c]] = await conn.query('SELECT * FROM contas_pagar WHERE id = ?', [req.params.id]);
        await conn.commit();
        res.json({ ...nContaPagar(c), nota_entrada: nota });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

app.delete('/api/contas-pagar/:id', asyncRota(async (req, res) => {
    const [[c]] = await pool.query('SELECT status, nota_entrada_id FROM contas_pagar WHERE id = ?', [req.params.id]);
    if (!c) return erro(res, 404, 'Conta nao encontrada');
    if (c.nota_entrada_id)
        return erro(res, 409, 'Parcela de nota fiscal nao pode ser excluida; cancele para preservar o historico');
    if (c.status === 'paga' || c.status === 'parcial')
        return erro(res, 409, 'Conta com pagamento registrado - estorne antes de excluir');
    const [[historico]] = await pool.query(
        'SELECT COUNT(*) n FROM contas_pagar_pagamentos WHERE conta_pagar_id=?', [req.params.id]);
    if (Number(historico.n) > 0)
        return erro(res, 409, 'Conta possui historico de pagamento e deve ser preservada; cancele em vez de excluir');
    await pool.query('DELETE FROM contas_pagar WHERE id = ?', [req.params.id]);
    res.json({ message: 'Conta excluida' });
}));

// ---------------------------------------------------------------- contas a receber
app.get('/api/contas-receber', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.status) { cond.push('status = ?'); params.push(req.query.status); }
    if (req.query.categoria) { cond.push('categoria = ?'); params.push(req.query.categoria); }
    if (req.query.cliente_id) { cond.push('cliente_id = ?'); params.push(req.query.cliente_id); }
    if (req.query.em_aberto === '1') cond.push("status NOT IN ('recebida','cancelada')");
    if (req.query.de) { cond.push('data_vencimento >= ?'); params.push(soData(req.query.de)); }
    if (req.query.ate) { cond.push('data_vencimento <= ?'); params.push(soData(req.query.ate)); }
    if (req.query.busca) {
        cond.push('(cliente_nome LIKE ? OR descricao LIKE ? OR numero_documento LIKE ? OR codigo LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t);
    }
    const limite = Math.min(Number(req.query.limite || 500), 2000);
    const [linhas] = await pool.query(
        'SELECT * FROM contas_receber' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY data_vencimento ASC, id ASC LIMIT ' + limite, params
    );
    res.json(linhas.map(nContaReceber));
}));

app.post('/api/contas-receber', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = validarConta(b);
    if (msg) return erro(res, 400, msg);

    let cliente = null;
    if (b.cliente_id) {
        const [cs] = await pool.query('SELECT * FROM clientes WHERE id = ?', [b.cliente_id]);
        if (!cs.length) return erro(res, 404, 'Cliente nao encontrado');
        cliente = cs[0];
    }
    const nome = cliente ? cliente.nome : String(b.cliente_nome || '').trim();
    if (!nome) return erro(res, 400, 'Informe o cliente');

    const [r] = await pool.query(
        `INSERT INTO contas_receber (cliente_id, cliente_nome, cliente_doc, descricao, numero_documento,
            data_emissao, data_vencimento, valor_original, categoria, forma_recebimento, observacoes, usuario_criacao)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [cliente ? cliente.id : null, nome, cliente ? cliente.cpf_cnpj : (b.cliente_doc || ''),
         String(b.descricao).trim(), b.numero_documento || '', soData(b.data_emissao), soData(b.data_vencimento),
         num(b.valor_original), b.categoria || 'vendas', b.forma_recebimento || '', b.observacoes || '',
         req.usuario.usuario]
    );
    await pool.query('UPDATE contas_receber SET codigo = ? WHERE id = ?',
        ['CR' + String(r.insertId).padStart(6, '0'), r.insertId]);
    const [[nova]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [r.insertId]);
    res.status(201).json(nContaReceber(nova));
}));

app.put('/api/contas-receber/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = validarConta(b);
    if (msg) return erro(res, 400, msg);
    const [[atual]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [req.params.id]);
    if (!atual) return erro(res, 404, 'Conta nao encontrada');
    if (atual.status === 'recebida') return erro(res, 409, 'Conta ja recebida - estorne o recebimento antes de editar');

    let cliente = null;
    if (b.cliente_id) {
        const [cs] = await pool.query('SELECT * FROM clientes WHERE id = ?', [b.cliente_id]);
        if (!cs.length) return erro(res, 404, 'Cliente nao encontrado');
        cliente = cs[0];
    }
    const nome = cliente ? cliente.nome : String(b.cliente_nome || '').trim();
    if (!nome) return erro(res, 400, 'Informe o cliente');

    await pool.query(
        `UPDATE contas_receber SET cliente_id=?, cliente_nome=?, cliente_doc=?, descricao=?, numero_documento=?,
            data_emissao=?, data_vencimento=?, valor_original=?, categoria=?, forma_recebimento=?, observacoes=?
         WHERE id=?`,
        [cliente ? cliente.id : null, nome, cliente ? cliente.cpf_cnpj : (b.cliente_doc || ''),
         String(b.descricao).trim(), b.numero_documento || '', soData(b.data_emissao), soData(b.data_vencimento),
         num(b.valor_original), b.categoria || 'vendas', b.forma_recebimento || '', b.observacoes || '',
         req.params.id]
    );
    const [[c]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [req.params.id]);
    res.json(nContaReceber(c));
}));

app.post('/api/contas-receber/:id/receber', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [cs] = await conn.query('SELECT * FROM contas_receber WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!cs.length) { await conn.rollback(); return erro(res, 404, 'Conta nao encontrada'); }
        const c = cs[0];
        if (c.status === 'recebida') { await conn.rollback(); return erro(res, 400, 'Conta ja esta recebida'); }
        if (c.status === 'cancelada') { await conn.rollback(); return erro(res, 400, 'Conta cancelada nao pode ser recebida'); }

        const desconto = Number(c.valor_desconto) + num(req.body.desconto);
        const juros = Number(c.valor_juros) + num(req.body.juros);
        const multa = Number(c.valor_multa) + num(req.body.multa);
        const devido = dinheiro(Number(c.valor_original) + juros + multa - desconto);
        const saldo = dinheiro(devido - Number(c.valor_recebido));

        const valor = req.body.valor === undefined || req.body.valor === '' ? saldo : num(req.body.valor, NaN);
        if (!Number.isFinite(valor) || valor <= 0) { await conn.rollback(); return erro(res, 400, 'Valor do recebimento invalido'); }
        if (valor > saldo + 0.005) { await conn.rollback(); return erro(res, 400, `Valor maior que o saldo em aberto (${saldo.toFixed(2)})`); }

        const recebido = dinheiro(Number(c.valor_recebido) + valor);
        const quitada = recebido + 0.005 >= devido;
        const data = soData(req.body.data_recebimento) || new Date().toISOString().slice(0, 10);

        await conn.query(
            `UPDATE contas_receber SET valor_recebido=?, valor_desconto=?, valor_juros=?, valor_multa=?,
                status=?, data_recebimento=?, forma_recebimento=?, usuario_recebimento=? WHERE id=?`,
            [recebido, desconto, juros, multa, quitada ? 'recebida' : 'parcial',
             quitada ? data : c.data_recebimento, req.body.forma_recebimento || c.forma_recebimento,
             req.usuario.usuario, c.id]
        );
        await conn.commit();
        const [[nova]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [c.id]);
        res.json(nContaReceber(nova));
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

app.post('/api/contas-receber/:id/estornar', asyncRota(async (req, res) => {
    const [r] = await pool.query(
        `UPDATE contas_receber SET valor_recebido=0, valor_juros=0, valor_multa=0, valor_desconto=0,
            data_recebimento=NULL, status='pendente', usuario_recebimento='' WHERE id=?`, [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Conta nao encontrada');
    const [[c]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [req.params.id]);
    res.json(nContaReceber(c));
}));

app.post('/api/contas-receber/:id/cancelar', asyncRota(async (req, res) => {
    const [r] = await pool.query("UPDATE contas_receber SET status='cancelada' WHERE id=? AND status <> 'recebida'", [req.params.id]);
    if (!r.affectedRows) return erro(res, 409, 'Conta nao encontrada ou ja recebida');
    const [[c]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [req.params.id]);
    res.json(nContaReceber(c));
}));

app.delete('/api/contas-receber/:id', asyncRota(async (req, res) => {
    const [[c]] = await pool.query('SELECT status FROM contas_receber WHERE id = ?', [req.params.id]);
    if (!c) return erro(res, 404, 'Conta nao encontrada');
    if (c.status === 'recebida' || c.status === 'parcial')
        return erro(res, 409, 'Conta com recebimento registrado - estorne antes de excluir');
    await pool.query('DELETE FROM contas_receber WHERE id = ?', [req.params.id]);
    res.json({ message: 'Conta excluida' });
}));

// ---------------------------------------------------------------- painel financeiro
app.get('/api/financeiro/resumo', asyncRota(async (req, res) => {
    const abertoSql = (t) => `${t} NOT IN ('cancelada', ?)`;

    const [[pagar]] = await pool.query(
        `SELECT COUNT(*) n,
                COALESCE(SUM(valor_original + valor_juros + valor_multa - valor_desconto - valor_pago),0) aberto,
                COALESCE(SUM(CASE WHEN data_vencimento < CURDATE()
                     THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_pago ELSE 0 END),0) vencido,
                COALESCE(SUM(CASE WHEN data_vencimento = CURDATE()
                     THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_pago ELSE 0 END),0) hoje,
                COALESCE(SUM(CASE WHEN data_vencimento BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY
                     THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_pago ELSE 0 END),0) proximos30
         FROM contas_pagar WHERE ${abertoSql('status')}`, ['paga']);

    const [[receber]] = await pool.query(
        `SELECT COUNT(*) n,
                COALESCE(SUM(valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido),0) aberto,
                COALESCE(SUM(CASE WHEN data_vencimento < CURDATE()
                     THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido ELSE 0 END),0) vencido,
                COALESCE(SUM(CASE WHEN data_vencimento = CURDATE()
                     THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido ELSE 0 END),0) hoje,
                COALESCE(SUM(CASE WHEN data_vencimento BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY
                     THEN valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido ELSE 0 END),0) proximos30
         FROM contas_receber WHERE ${abertoSql('status')}`, ['recebida']);

    const [[mes]] = await pool.query(
        `SELECT (SELECT COALESCE(SUM(valor_pago),0) FROM contas_pagar
                  WHERE data_pagamento >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) pago_mes,
                (SELECT COALESCE(SUM(valor_recebido),0) FROM contas_receber
                  WHERE data_recebimento >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) recebido_mes`);

    const [proximasPagar] = await pool.query(
        `SELECT id, codigo, fornecedor_nome AS parceiro, descricao, data_vencimento,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_pago) saldo
         FROM contas_pagar WHERE status NOT IN ('paga','cancelada')
         ORDER BY data_vencimento ASC LIMIT 8`);

    const [proximasReceber] = await pool.query(
        `SELECT id, codigo, cliente_nome AS parceiro, descricao, data_vencimento,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido) saldo
         FROM contas_receber WHERE status NOT IN ('recebida','cancelada')
         ORDER BY data_vencimento ASC LIMIT 8`);

    const porCategoria = await pool.query(
        `SELECT categoria, COALESCE(SUM(valor_original + valor_juros + valor_multa - valor_desconto - valor_pago),0) total
         FROM contas_pagar WHERE status NOT IN ('paga','cancelada')
         GROUP BY categoria ORDER BY total DESC`).then(([r]) => r);

    const numerar = (linhas) => linhas.map(l => ({
        ...l, saldo: Number(l.saldo), data_vencimento: dataIso(l.data_vencimento) }));

    res.json({
        pagar: { contas: pagar.n, aberto: Number(pagar.aberto), vencido: Number(pagar.vencido),
                 hoje: Number(pagar.hoje), proximos30: Number(pagar.proximos30) },
        receber: { contas: receber.n, aberto: Number(receber.aberto), vencido: Number(receber.vencido),
                   hoje: Number(receber.hoje), proximos30: Number(receber.proximos30) },
        pago_mes: Number(mes.pago_mes),
        recebido_mes: Number(mes.recebido_mes),
        saldo_previsto_30: dinheiro(Number(receber.proximos30) - Number(pagar.proximos30)),
        proximas_pagar: numerar(proximasPagar),
        proximas_receber: numerar(proximasReceber),
        pagar_por_categoria: porCategoria.map(c => ({ ...c, total: Number(c.total) }))
    });
}));

// ================================================================
// FISCAL — configuracao, dados fiscais das pecas e notas fiscais
//
// IMPORTANTE: a emissao aqui e um CONTROLE INTERNO de documentos.
// A nota nao e transmitida a SEFAZ e nao substitui um emissor
// homologado; a chave de acesso e montada localmente no layout
// oficial (44 digitos + DV modulo 11) apenas para conferencia.
// ================================================================
const CFOP_RE = /^\d{4}$/;

async function configFiscal(conn = pool) {
    const [[cfg]] = await conn.query('SELECT * FROM fiscal_config WHERE id = 1');
    return cfg;
}

const nConfig = (c) => ({
    ...c,
    aliquota_icms: Number(c.aliquota_icms),
    aliquota_pis: Number(c.aliquota_pis),
    aliquota_cofins: Number(c.aliquota_cofins)
});

app.get('/api/fiscal/config', asyncRota(async (req, res) => {
    res.json(nConfig(await configFiscal()));
}));

app.put('/api/fiscal/config', asyncRota(async (req, res) => {
    const b = req.body;
    if (b.cfop_dentro_uf && !CFOP_RE.test(b.cfop_dentro_uf)) return erro(res, 400, 'CFOP dentro do estado invalido');
    if (b.cfop_fora_uf && !CFOP_RE.test(b.cfop_fora_uf)) return erro(res, 400, 'CFOP fora do estado invalido');
    if (b.ambiente && !['homologacao', 'producao'].includes(b.ambiente)) return erro(res, 400, 'Ambiente invalido');

    const atual = await configFiscal();

    /* Campos livres: em branco significa "apagar", entao aceitam string vazia.
       Campos com padrao obrigatorio (regime, CFOP, aliquotas): em branco cai no
       valor atual, senao um formulario parcial zeraria a configuracao fiscal.
       A lista e montada por coluna — antes o UPDATE tinha um subconjunto fixo e
       telefone, e-mail, site, logo, bairro e numero eram descartados em silencio. */
    const texto = ['razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 'endereco',
        'numero', 'bairro', 'cidade', 'cep', 'telefone', 'email', 'site', 'logo_url',
        'sefaz_certificado', 'sefaz_certificado_senha',
        // identificacao municipal — usada pela NF-e e pelas notas de servico
        'codigo_municipio', 'inscricao_municipal'];
    const obrigatorio = ['regime_tributario', 'ambiente', 'ambiente_recebimento', 'cfop_dentro_uf',
        'cfop_fora_uf', 'natureza_operacao', 'csosn_padrao', 'cst_icms_padrao', 'consulta_cnpj_url'];
    const inteiro = ['serie_nfe', 'proximo_numero_nfe', 'serie_nfce', 'proximo_numero_nfce',
        'proximo_numero_recibo', 'sefaz_intervalo_min', 'sefaz_prazo_padrao',
        'nfse_intervalo_min', 'cte_intervalo_min'];
    const decimal = ['aliquota_icms', 'aliquota_pis', 'aliquota_cofins', 'aliquota_iss'];

    const colunas = [], valores = [];
    const gravar = (coluna, valor) => { colunas.push(`${coluna} = ?`); valores.push(valor); };

    for (const campo of texto) {
        if (b[campo] === undefined) continue;
        gravar(campo, String(b[campo] ?? '').trim());
    }
    if (b.uf !== undefined) gravar('uf', String(b.uf || '').toUpperCase().slice(0, 2));
    for (const campo of obrigatorio) {
        if (b[campo] === undefined || b[campo] === null || b[campo] === '') continue;
        gravar(campo, String(b[campo]).trim());
    }
    for (const campo of inteiro) {
        if (b[campo] === undefined || b[campo] === null || b[campo] === '') continue;
        gravar(campo, Math.max(1, Math.floor(Number(b[campo]) || 1)));
    }
    for (const campo of decimal) {
        if (b[campo] === undefined || b[campo] === null || b[campo] === '') continue;
        gravar(campo, num(b[campo]));
    }
    if (b.consulta_cnpj_ativa !== undefined) gravar('consulta_cnpj_ativa', b.consulta_cnpj_ativa ? 1 : 0);
    for (const flag of ['sefaz_auto', 'nfse_auto', 'cte_auto']) {
        if (b[flag] !== undefined) gravar(flag, b[flag] ? 1 : 0);
    }
    // permite reprocessar tudo desde o inicio zerando o NSU pela tela
    for (const nsu of ['sefaz_ultimo_nsu', 'nfse_ultimo_nsu', 'cte_ultimo_nsu']) {
        if (b[nsu] !== undefined) gravar(nsu, Math.max(0, Number(b[nsu]) || 0));
    }

    if (!colunas.length) return res.json(nConfig(atual));
    await pool.query(`UPDATE fiscal_config SET ${colunas.join(', ')} WHERE id = 1`, valores);

    // ligar/desligar ou mudar o intervalo vale na hora
    if (b.sefaz_auto !== undefined || b.sefaz_intervalo_min !== undefined) agendarSefaz();
    if (b.nfse_auto !== undefined || b.nfse_intervalo_min !== undefined
        || b.cte_auto !== undefined || b.cte_intervalo_min !== undefined) agendarRecebimento();
    res.json(nConfig(await configFiscal()));
}));

// dados fiscais das pecas (NCM, CFOP, CST/CSOSN, aliquotas)
app.put('/api/produtos/:id/fiscal', asyncRota(async (req, res) => {
    const b = req.body;
    if (b.ncm && !/^\d{8}$/.test(String(b.ncm).replace(/\D/g, '')))
        return erro(res, 400, 'NCM deve ter 8 digitos');
    if (b.cfop && !CFOP_RE.test(b.cfop)) return erro(res, 400, 'CFOP invalido');

    const [r] = await pool.query(
        `UPDATE produtos SET unidade=?, ncm=?, cest=?, cfop=?, origem=?, cst_icms=?, csosn=?,
            aliquota_icms=?, aliquota_ipi=?, aliquota_pis=?, aliquota_cofins=? WHERE id=?`,
        [String(b.unidade || 'UN').toUpperCase().slice(0, 6), String(b.ncm || '').replace(/\D/g, '').slice(0, 8),
         String(b.cest || '').replace(/\D/g, '').slice(0, 7), b.cfop || '', String(b.origem ?? '0').slice(0, 2),
         b.cst_icms || '', b.csosn || '', num(b.aliquota_icms), num(b.aliquota_ipi),
         num(b.aliquota_pis), num(b.aliquota_cofins), req.params.id]
    );
    if (!r.affectedRows) return erro(res, 404, 'Produto nao encontrado');
    const [[p]] = await pool.query('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
    res.json(nProd(p));
}));

// chave de acesso no layout oficial: cUF+AAMM+CNPJ+mod+serie+nNF+tpEmis+cNF+DV
const COD_UF = { AC:12, AL:27, AP:16, AM:13, BA:29, CE:23, DF:53, ES:32, GO:52, MA:21, MT:51,
    MS:50, MG:31, PA:15, PB:25, PR:41, PE:26, PI:22, RJ:33, RN:24, RS:43, RO:11, RR:14,
    SC:42, SP:35, SE:28, TO:17 };

function digitoChave(chave43) {
    // modulo 11 com pesos 2..9 da direita para a esquerda
    let peso = 2, soma = 0;
    for (let i = chave43.length - 1; i >= 0; i--) {
        soma += Number(chave43[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

/* LEGADO — nao e mais usado na autorizacao.
   Servia para inventar uma chave local quando a rota /autorizar fingia emitir.
   Agora a chave vem da SEFAZ, calculada pelo gerador de XML do ERP. Mantido
   apenas porque a numeracao de rascunho ainda exibe uma chave provisoria. */
function montarChave(cfg, nota) {
    const agora = new Date();
    const cUF = String(COD_UF[String(cfg.uf || '').toUpperCase()] || 35).padStart(2, '0');
    const aamm = String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0');
    const cnpj = String(cfg.cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const mod = nota.modelo === 'nfce' ? '65' : '55';
    const serie = String(nota.serie).padStart(3, '0');
    const numero = String(nota.numero).padStart(9, '0');
    const tpEmis = '1';
    const cNF = String(nota.id * 7919 % 100000000).padStart(8, '0'); // deterministico por nota
    const base = cUF + aamm + cnpj + mod + serie + numero + tpEmis + cNF;
    return base + digitoChave(base);
}

const nNota = (n) => ({
    ...n,
    valor_produtos: Number(n.valor_produtos), valor_desconto: Number(n.valor_desconto),
    valor_icms: Number(n.valor_icms), valor_ipi: Number(n.valor_ipi),
    valor_pis: Number(n.valor_pis), valor_cofins: Number(n.valor_cofins),
    valor_iss: Number(n.valor_iss || 0),
    valor_total: Number(n.valor_total)
});

const nItemNota = (i) => ({
    ...i,
    quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario),
    valor_total: Number(i.valor_total), base_icms: Number(i.base_icms),
    aliquota_icms: Number(i.aliquota_icms), valor_icms: Number(i.valor_icms),
    valor_ipi: Number(i.valor_ipi), valor_pis: Number(i.valor_pis), valor_cofins: Number(i.valor_cofins),
    aliquota_iss: Number(i.aliquota_iss || 0), valor_iss: Number(i.valor_iss || 0)
});

const itemVendaEhServico = (i) => i && (i.tipo === 'servico' || i.servico_id);
const modeloEhServico = (modelo) => String(modelo || '').toLowerCase() === 'nfse';
const modeloEhMercadoria = (modelo) => ['nfe', 'nfce'].includes(String(modelo || '').toLowerCase());

async function montarNota(id) {
    const [[n]] = await pool.query('SELECT * FROM notas_fiscais WHERE id = ?', [id]);
    if (!n) return null;
    const [itens] = await pool.query('SELECT * FROM nota_fiscal_itens WHERE nota_id = ? ORDER BY id', [id]);
    const [[destinatario]] = n.cliente_id
        ? await pool.query(
            `SELECT razao_social, nome, cpf_cnpj, inscricao_estadual, indicador_ie,
                    endereco, numero, complemento, bairro, cidade, codigo_municipio,
                    uf, cep, telefone, celular, email
               FROM clientes WHERE id = ?`, [n.cliente_id])
        : [[null]];
    return { ...nNota(n), destinatario: destinatario || null, itens: itens.map(nItemNota) };
}

app.get('/api/fiscal/notas', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.status) { cond.push('status = ?'); params.push(req.query.status); }
    if (req.query.modelo) { cond.push('modelo = ?'); params.push(req.query.modelo); }
    if (req.query.busca) {
        cond.push('(cliente_nome LIKE ? OR chave LIKE ? OR numero = ?)');
        params.push('%' + req.query.busca + '%', '%' + req.query.busca + '%', Number(req.query.busca) || 0);
    }
    const limite = Math.min(Number(req.query.limite || 300), 1000);
    const [linhas] = await pool.query(
        'SELECT * FROM notas_fiscais' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY id DESC LIMIT ' + limite, params
    );
    res.json(linhas.map(nNota));
}));

app.get('/api/fiscal/notas/:id', asyncRota(async (req, res) => {
    const n = await montarNota(req.params.id);
    if (!n) return erro(res, 404, 'Nota nao encontrada');
    res.json(n);
}));

/* Cria a nota como RASCUNHO. Aceita:
     - os_id     -> puxa cliente e separa produtos/servicos de uma OS concluida
     - venda_id  -> puxa cliente e itens de uma venda
     - venda_ids -> consolida vendas concluidas do mesmo cliente
     - itens[]   -> {produto_id, quantidade, valor_unitario?} para nota avulsa   */
app.post('/api/fiscal/notas', asyncRota(async (req, res) => {
    const b = req.body;
    const modelo = b.modelo === 'nfce' ? 'nfce' : (b.modelo === 'nfse' ? 'nfse' : 'nfe');
    const ehServico = modeloEhServico(modelo);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[cfg]] = await conn.query('SELECT * FROM fiscal_config WHERE id = 1 FOR UPDATE');

        let cliente = null, venda = null, ordem = null, vendasSelecionadas = [], brutos = [];
        const osId = Number(b.os_id);
        const vendaIds = [...new Set((Array.isArray(b.venda_ids) ? b.venda_ids : [b.venda_id])
            .map(Number).filter(Number.isInteger).filter(id => id > 0))];

        if (Number.isInteger(osId) && osId > 0) {
            const [ordens] = await conn.query('SELECT * FROM ordens_servico WHERE id = ? FOR UPDATE', [osId]);
            ordem = ordens[0] || null;
            if (!ordem) { await conn.rollback(); return erro(res, 404, 'Ordem de servico nao encontrada'); }
            if (ordem.status !== 'concluida') {
                await conn.rollback(); return erro(res, 400, 'Conclua a ordem de servico antes de emitir o documento fiscal');
            }
            if (!ordem.cliente_id) {
                await conn.rollback(); return erro(res, 400, 'A ordem precisa estar vinculada a um cliente cadastrado');
            }

            const [existentes] = await conn.query(
                `SELECT id, modelo FROM notas_fiscais
                  WHERE os_id = ? AND status <> 'cancelada' ORDER BY id DESC`, [osId]);
            const existente = existentes.find(n => ehServico ? modeloEhServico(n.modelo) : modeloEhMercadoria(n.modelo));
            if (existente) {
                await conn.rollback();
                return res.json(await montarNota(existente.id));
            }

            const [cs] = await conn.query('SELECT * FROM clientes WHERE id = ?', [ordem.cliente_id]);
            cliente = cs[0] || null;
            if (!cliente) { await conn.rollback(); return erro(res, 404, 'Cliente da ordem nao encontrado'); }
            const [itensOs] = await conn.query('SELECT * FROM os_itens WHERE os_id = ? ORDER BY id', [osId]);
            brutos = itensOs
                .filter(i => ehServico ? i.tipo === 'servico' : i.tipo !== 'servico')
                .map(i => ({
                    produto_id: i.produto_id,
                    servico_id: i.servico_id,
                    sku: i.sku,
                    descricao: i.descricao,
                    unidade: 'UN',
                    quantidade: Number(i.quantidade),
                    valor_unitario: Number(i.valor_unitario),
                    valor_total: Number(i.valor_total)
                }));
            if (!brutos.length) {
                await conn.rollback();
                return erro(res, 400, `A OS nao possui itens de ${ehServico ? 'servico para NFS-e' : 'produto para NF-e'}`);
            }
            const itemSemCadastro = brutos.find(i => ehServico ? !i.servico_id : !i.produto_id);
            if (itemSemCadastro) {
                await conn.rollback();
                return erro(res, 400, `O item "${itemSemCadastro.descricao}" nao esta vinculado ao cadastro fiscal de ${ehServico ? 'servicos' : 'produtos'}`);
            }
        } else if (vendaIds.length) {
            const [vs] = await conn.query('SELECT * FROM vendas WHERE id IN (?) FOR UPDATE', [vendaIds]);
            if (vs.length !== vendaIds.length) { await conn.rollback(); return erro(res, 404, 'Uma ou mais vendas nao foram encontradas'); }
            vendasSelecionadas = vendaIds.map(id => vs.find(v => Number(v.id) === id));
            if (vendasSelecionadas.some(v => v.status !== 'concluida')) {
                await conn.rollback(); return erro(res, 400, 'Somente vendas concluidas podem ser faturadas');
            }
            const clienteIds = [...new Set(vendasSelecionadas.map(v => Number(v.cliente_id) || 0))];
            if (clienteIds.length !== 1 || !clienteIds[0]) {
                await conn.rollback(); return erro(res, 400, 'Selecione vendas de um unico cliente cadastrado');
            }

            const [jaVinculadas] = await conn.query(
                `SELECT nfv.venda_id, nf.id nota_id, nf.modelo
                   FROM nota_fiscal_vendas nfv JOIN notas_fiscais nf ON nf.id=nfv.nota_id
                  WHERE nfv.venda_id IN (?) AND nf.status <> 'cancelada'
                 UNION
                 SELECT nf.venda_id, nf.id nota_id, nf.modelo FROM notas_fiscais nf
                  WHERE nf.venda_id IN (?) AND nf.status <> 'cancelada'`, [vendaIds, vendaIds]);
            const conflitoModelo = jaVinculadas.filter(x =>
                ehServico ? modeloEhServico(x.modelo) : modeloEhMercadoria(x.modelo));
            if (conflitoModelo.length) {
                const notas = [...new Set(conflitoModelo.map(x => Number(x.nota_id)))];
                const cobertas = new Set(conflitoModelo.map(x => Number(x.venda_id)));
                if (notas.length === 1 && vendaIds.every(id => cobertas.has(id))) {
                    await conn.rollback();
                    return res.json(await montarNota(notas[0]));
                }
                await conn.rollback();
                return erro(res, 409, `Uma ou mais vendas selecionadas ja possuem ${ehServico ? 'NFS-e' : 'NF-e'} ativa`);
            }

            venda = vendasSelecionadas[0];
            const [cs] = await conn.query('SELECT * FROM clientes WHERE id = ?', [clienteIds[0]]);
            cliente = cs[0] || null;
            const [itensVenda] = await conn.query('SELECT * FROM venda_itens WHERE venda_id IN (?) ORDER BY venda_id,id', [vendaIds]);
            brutos = itensVenda
                .filter(i => ehServico ? itemVendaEhServico(i) : !itemVendaEhServico(i))
                .map(i => ({
                    venda_id: i.venda_id,
                    produto_id: i.produto_id,
                    servico_id: i.servico_id,
                    sku: i.sku,
                    descricao: i.descricao,
                    unidade: i.unidade || 'UN',
                    quantidade: Number(i.quantidade),
                    valor_unitario: Number(i.preco_unitario),
                    valor_total: Number(i.total)
                }));
            if (!brutos.length) {
                await conn.rollback();
                return erro(res, 400, `A venda selecionada nao possui itens de ${ehServico ? 'servico' : 'produto'} para ${ehServico ? 'NFS-e' : 'NF-e'}`);
            }
        } else {
            const itens = Array.isArray(b.itens) ? b.itens : [];
            if (!itens.length) { await conn.rollback(); return erro(res, 400, 'Informe os itens da nota'); }
            if (b.cliente_id) {
                const [cs] = await conn.query('SELECT * FROM clientes WHERE id = ?', [b.cliente_id]);
                if (!cs.length) { await conn.rollback(); return erro(res, 404, 'Cliente nao encontrado'); }
                cliente = cs[0];
            }
            for (const it of itens) {
                if (ehServico) {
                    const [ss] = await conn.query('SELECT * FROM servicos WHERE id = ?', [it.servico_id]);
                    if (!ss.length) { await conn.rollback(); return erro(res, 404, `Servico id ${it.servico_id} nao encontrado`); }
                    const s = ss[0];
                    const qtd = num(it.quantidade, NaN);
                    if (!Number.isFinite(qtd) || qtd <= 0) { await conn.rollback(); return erro(res, 400, `Quantidade invalida em "${s.nome}"`); }
                    brutos.push({ servico_id: s.id, sku: s.codigo || `SRV${String(s.id).padStart(5, '0')}`,
                        descricao: s.nome, unidade: 'UN', quantidade: qtd,
                        valor_unitario: it.valor_unitario === undefined ? Number(s.preco) : num(it.valor_unitario) });
                    continue;
                }
                const [ps] = await conn.query('SELECT * FROM produtos WHERE id = ?', [it.produto_id]);
                if (!ps.length) { await conn.rollback(); return erro(res, 404, `Produto id ${it.produto_id} nao encontrado`); }
                const p = ps[0];
                const qtd = num(it.quantidade, NaN);
                if (!Number.isFinite(qtd) || qtd <= 0) { await conn.rollback(); return erro(res, 400, `Quantidade invalida em "${p.descricao}"`); }
                brutos.push({ produto_id: p.id, sku: p.sku, descricao: p.descricao, quantidade: qtd,
                    valor_unitario: it.valor_unitario === undefined ? Number(p.preco_venda) : num(it.valor_unitario) });
            }
        }

        const ufCliente = String(b.cliente_uf || (cliente && cliente.uf) || cfg.uf || '').toUpperCase().slice(0, 2);
        const cfopNota = b.cfop || (ufCliente && cfg.uf && ufCliente !== String(cfg.uf).toUpperCase()
            ? cfg.cfop_fora_uf : cfg.cfop_dentro_uf);

        // impostos: produto usa tributacao de mercadoria; servico usa ISS
        const itensCalculados = [];
        for (const it of brutos) {
            if (ehServico) {
                const [ss] = await conn.query('SELECT * FROM servicos WHERE id = ?', [it.servico_id]);
                const s = ss[0] || {};
                const total = dinheiro(it.quantidade * it.valor_unitario);
                const aliqIss = Number(s.aliquota_iss) > 0 ? Number(s.aliquota_iss) : Number(cfg.aliquota_iss || 0);
                itensCalculados.push({
                    ...it,
                    tipo: 'servico',
                    produto_id: null,
                    servico_id: s.id || it.servico_id || null,
                    sku: it.sku || s.codigo || '',
                    descricao: it.descricao || s.nome || 'Servico',
                    ncm: '',
                    cfop: '',
                    cst: s.codigo_tributacao_nacional || s.item_lc116 || 'ISS',
                    unidade: 'UN',
                    valor_total: total,
                    base_icms: 0,
                    aliquota_icms: 0,
                    valor_icms: 0,
                    valor_ipi: 0,
                    valor_pis: 0,
                    valor_cofins: 0,
                    aliquota_iss: aliqIss,
                    valor_iss: dinheiro(total * aliqIss / 100)
                });
                continue;
            }
            const [ps] = await conn.query('SELECT * FROM produtos WHERE id = ?', [it.produto_id]);
            const p = ps[0] || {};
            const total = dinheiro(it.quantidade * it.valor_unitario);
            const aliqIcms = Number(p.aliquota_icms) > 0 ? Number(p.aliquota_icms) : Number(cfg.aliquota_icms);
            const aliqPis = Number(p.aliquota_pis) > 0 ? Number(p.aliquota_pis) : Number(cfg.aliquota_pis);
            const aliqCofins = Number(p.aliquota_cofins) > 0 ? Number(p.aliquota_cofins) : Number(cfg.aliquota_cofins);
            const aliqIpi = Number(p.aliquota_ipi) || 0;
            /* Simples Nacional: ICMS, PIS e COFINS sao recolhidos no DAS, entao
               nao ha destaque na nota — o item sai com CSOSN e tributos zerados.
               Nos demais regimes destaca normalmente com CST. */
            const destaca = cfg.regime_tributario !== 'simples';
            itensCalculados.push({
                ...it,
                tipo: 'produto',
                servico_id: null,
                ncm: p.ncm || '', cfop: p.cfop || cfopNota,
                cst: destaca ? (p.cst_icms || cfg.cst_icms_padrao) : (p.csosn || cfg.csosn_padrao),
                unidade: p.unidade || 'UN',
                valor_total: total,
                base_icms: destaca ? total : 0,
                aliquota_icms: destaca ? aliqIcms : 0,
                valor_icms: destaca ? dinheiro(total * aliqIcms / 100) : 0,
                valor_ipi: dinheiro(total * aliqIpi / 100),
                valor_pis: destaca ? dinheiro(total * aliqPis / 100) : 0,
                valor_cofins: destaca ? dinheiro(total * aliqCofins / 100) : 0,
                aliquota_iss: 0,
                valor_iss: 0
            });
        }

        const soma = (campo) => dinheiro(itensCalculados.reduce((s, i) => s + i[campo], 0));
        const valorProdutos = soma('valor_total');
        const desconto = ordem
            ? dinheiro(Number(ordem.desconto || 0) * valorProdutos /
                Math.max(1, Number(ordem.valor_pecas || 0) + Number(ordem.valor_servicos || 0)))
            : vendasSelecionadas.length
            ? dinheiro(vendasSelecionadas.reduce((s, v) => {
                const subtotalVenda = Number(v.subtotal || 0);
                const subtotalModelo = brutos
                    .filter(i => Number(i.venda_id) === Number(v.id))
                    .reduce((acc, i) => acc + Number(i.valor_total || (i.quantidade * i.valor_unitario) || 0), 0);
                return s + (subtotalVenda > 0 ? Number(v.desconto || 0) * subtotalModelo / subtotalVenda : 0);
            }, 0))
            : num(b.desconto);
        if (desconto < 0 || desconto > valorProdutos) { await conn.rollback(); return erro(res, 400, 'Desconto invalido'); }

        const serie = modelo === 'nfse' ? cfg.serie_nfse : (modelo === 'nfce' ? cfg.serie_nfce : cfg.serie_nfe);
        const numero = modelo === 'nfse' ? cfg.proximo_numero_nfse : (modelo === 'nfce' ? cfg.proximo_numero_nfce : cfg.proximo_numero_nfe);

        const formas = [...new Set(vendasSelecionadas.map(v => v.forma_pagamento).filter(Boolean))];
        const formaPagamento = ordem ? String(ordem.forma_pagamento || '')
            : (formas.length === 1 ? formas[0] : (formas.length > 1 ? 'outros' : String(b.forma_pagamento || '')));
        const obsConsolidada = vendasSelecionadas.length > 1
            ? `Vendas consolidadas: ${vendasSelecionadas.map(v => '#' + v.id).join(', ')}` : '';
        const obsServico = ehServico ? 'Documento de servico gerado pelo Trevo; transmita/consulte a NFS-e no ambiente municipal quando aplicavel.' : '';
        const obsOrdem = ordem ? `Ordem de servico ${ordem.numero}${ordem.placas || ordem.placa ? ` — placa(s): ${ordem.placas || ordem.placa}` : ''}` : '';
        const observacoes = [b.observacoes || '', obsOrdem, obsConsolidada, obsServico].filter(Boolean).join(' — ');

        const [rn] = await conn.query(
            `INSERT INTO notas_fiscais (modelo, serie, numero, natureza_operacao, cfop, venda_id, os_id, cliente_id,
                cliente_nome, cliente_doc, cliente_uf, valor_produtos, valor_desconto, valor_icms, valor_ipi,
                valor_pis, valor_cofins, valor_iss, valor_total, forma_pagamento, status, ambiente, observacoes, usuario)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rascunho',?,?,?)`,
            [modelo, serie, numero, b.natureza_operacao || (ehServico ? 'Prestacao de servico' : cfg.natureza_operacao), ehServico ? '' : cfopNota,
             venda ? venda.id : null, ordem ? ordem.id : null, cliente ? cliente.id : null,
             cliente ? cliente.nome : (b.cliente_nome || (venda ? venda.cliente_nome : 'Consumidor Final')),
             cliente ? cliente.cpf_cnpj : (b.cliente_doc || ''), ufCliente,
             valorProdutos, desconto, soma('valor_icms'), soma('valor_ipi'), soma('valor_pis'), soma('valor_cofins'),
             soma('valor_iss'), dinheiro(valorProdutos - desconto + soma('valor_ipi')), formaPagamento, cfg.ambiente, observacoes,
             req.usuario.usuario]
        );
        const notaId = rn.insertId;

        for (const v of vendasSelecionadas) {
            await conn.query('INSERT INTO nota_fiscal_vendas (nota_id,venda_id) VALUES (?,?)', [notaId, v.id]);
        }

        for (const i of itensCalculados) {
            await conn.query(
                `INSERT INTO nota_fiscal_itens (nota_id, tipo, produto_id, servico_id, sku, descricao, ncm, cfop, cst, unidade,
                    quantidade, valor_unitario, valor_total, base_icms, aliquota_icms, valor_icms,
                    valor_ipi, valor_pis, valor_cofins, aliquota_iss, valor_iss)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [notaId, i.tipo, i.produto_id, i.servico_id, i.sku, i.descricao, i.ncm, i.cfop, i.cst, i.unidade,
                 i.quantidade, i.valor_unitario, i.valor_total, i.base_icms, i.aliquota_icms,
                 i.valor_icms, i.valor_ipi, i.valor_pis, i.valor_cofins, i.aliquota_iss, i.valor_iss]
            );
        }

        // consome a numeracao so depois de gravar a nota
        await conn.query(
            modelo === 'nfce'
                ? 'UPDATE fiscal_config SET proximo_numero_nfce = ? WHERE id = 1'
                : modelo === 'nfse'
                    ? 'UPDATE fiscal_config SET proximo_numero_nfse = ? WHERE id = 1'
                : 'UPDATE fiscal_config SET proximo_numero_nfe = ? WHERE id = 1',
            [numero + 1]
        );
        await conn.commit();
        res.status(201).json(await montarNota(notaId));
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}));

/* AUTORIZACAO DA NF-e — transmissao real a SEFAZ.
   ⚠️ ATE 04/08/2026 ESTA ROTA ERA FALSA: montava a chave localmente, inventava
   um protocolo com Date.now() e marcava a nota como 'autorizada' sem NUNCA
   falar com a SEFAZ. O motor de verdade (fiscal-emissao.js) existia mas nao
   estava sequer importado pelo server. Ninguem percebeu porque nao havia
   certificado digital — agora ha, entao a emissao passa pelo caminho correto:
   gera o XML 4.00 -> assina com o A1 -> transmite -> grava o retorno real.

   Consequencia esperada: notas com cadastro incompleto (cliente sem CPF/CNPJ,
   produto sem NCM) passam a ser REJEITADAS com o motivo da SEFAZ, em vez de
   "autorizadas" silenciosamente. Isso e o comportamento correto. */
app.post('/api/fiscal/notas/:id/autorizar', asyncRota(async (req, res) => {
    const [[n]] = await pool.query('SELECT * FROM notas_fiscais WHERE id = ?', [req.params.id]);
    if (!n) return erro(res, 404, 'Nota nao encontrada');
    if (n.status === 'autorizada') return erro(res, 400, `Nota ja esta autorizada (protocolo ${n.protocolo})`);
    if (n.status === 'cancelada') return erro(res, 400, 'Nota cancelada nao pode ser autorizada');
    if (String(n.modelo || '').toLowerCase() === 'nfse') {
        return erro(res, 501, 'Transmissao automatica de NFS-e ainda nao implementada neste modulo. ' +
            'O Trevo gera o documento de servico para conferencia/controle; a autorizacao deve ser feita no ambiente municipal.');
    }

    const motor = exigirMotorNFe();

    /* O motor cobre NF-e modelo 55. A NFC-e (modelo 65) tem fluxo proprio —
       exige CSC/token do estado e QR Code na DANFE — que nao esta implementado.
       Antes esta rota "autorizava" NFC-e sem transmitir nada; melhor recusar
       explicitamente do que devolver um documento que a SEFAZ nunca viu. */
    if (String(n.modelo || '').toLowerCase() === 'nfce') {
        return erro(res, 501, 'Emissao de NFC-e (modelo 65) ainda nao implementada — ' +
            'depende do CSC/token da SEFAZ-SP. Use NF-e modelo 55.');
    }

    const [[cfg]] = await pool.query('SELECT * FROM fiscal_config WHERE id = 1');
    if (!String(cfg.cnpj || '').replace(/\D/g, '')) {
        return erro(res, 400, 'Configure o CNPJ da empresa em Fiscal > Configuracao antes de emitir');
    }
    if (!cfg.sefaz_certificado) {
        return erro(res, 400, 'Certificado digital nao configurado — sem ele a SEFAZ nao aceita a nota');
    }

    let ambienteTransmissao = null;
    try {
        const nfeConfig = require(path.resolve(__dirname, '..', '..',
            'modules/Faturamento/config/nfe.config'));
        ambienteTransmissao = Number(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao';
    } catch (e) {
        return erro(res, 503, `Configuracao do ambiente de transmissao indisponivel: ${e.message}`);
    }
    const ambienteEmissao = /produ/i.test(String(cfg.ambiente || '')) ? 'producao' : 'homologacao';
    if (ambienteTransmissao !== ambienteEmissao) {
        return erro(res, 409,
            `Emissao bloqueada: XML em ${ambienteEmissao} e transmissao em ${ambienteTransmissao}. ` +
            'Ajuste a Configuracao Fiscal e NFE_AMBIENTE para o mesmo ambiente.');
    }

    let retorno;
    try {
        retorno = await motor.emitirNFe(pool, Number(req.params.id));
    } catch (e) {
        // 108/109/656: a SEFAZ pediu para tentar depois — a nota segue rascunho
        if (e.temporario) return erro(res, e.status || 503, e.message);
        // erro antes de transmitir (cadastro incompleto, certificado, montagem do XML)
        await pool.query('UPDATE notas_fiscais SET motivo_sefaz = ? WHERE id = ?',
            [String(e.message || '').slice(0, 255), n.id]);
        return erro(res, 400, e.message);
    }

    const nota = await montarNota(n.id);
    if (!retorno.autorizada) {
        return res.status(422).json({
            message: `SEFAZ ${retorno.cStat || ''}: ${retorno.xMotivo || 'nota rejeitada'}`.trim(),
            nota, retorno
        });
    }
    res.json({ ...nota, retorno });
}));

/* PRONTIDAO PARA EMITIR — responde "o que falta" antes de gastar uma chamada
   na SEFAZ. Cada item aqui saiu de uma rejeicao real no teste de 04/08/2026:
   IE vazia deu 225 (schema), cliente sem codigo IBGE deu 225, e a SEFAZ bloqueia
   por 656 quem insiste depois de varias recusas — entao vale conferir antes. */
app.get('/api/fiscal/prontidao', asyncRota(async (req, res) => {
    const cfg = await configFiscal();
    const bloqueios = [], avisos = [];

    const cnpj = String(cfg.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) bloqueios.push('CNPJ do emitente ausente ou invalido');
    if (!cfg.razao_social) bloqueios.push('Razao social do emitente');
    if (!String(cfg.cep || '').replace(/\D/g, '')) bloqueios.push('CEP do emitente');
    if (!String(cfg.codigo_municipio || '').replace(/\D/g, '')) bloqueios.push('Codigo IBGE do municipio do emitente');
    if (!cfg.endereco) bloqueios.push('Endereco do emitente');

    /* A IE do emitente vai para o XML com os nao-digitos removidos: "isento"
       vira string vazia e a SEFAZ recusa por schema. Ou tem IE numerica, ou o
       campo precisa dizer exatamente ISENTO. */
    const ie = String(cfg.inscricao_estadual || '').trim();
    if (!ie) bloqueios.push('Inscricao estadual do emitente');
    else if (!/^\d{2,14}$/.test(ie.replace(/\D/g, '')) && !/^isento$/i.test(ie)) {
        bloqueios.push(`Inscricao estadual invalida ("${ie}") — informe os digitos ou ISENTO`);
    } else if (/^isento$/i.test(ie)) {
        avisos.push('IE marcada como isenta: confirme na SEFAZ, pois IE em branco no XML e rejeitada por schema');
    }

    if (!cfg.sefaz_certificado) bloqueios.push('Certificado digital A1');
    else if (!require('fs').existsSync(cfg.sefaz_certificado)) bloqueios.push('Arquivo do certificado nao encontrado no servidor');
    else if (!cfg.sefaz_certificado_senha) bloqueios.push('Senha do certificado');

    /* ⚠️ ARMADILHA DOS DOIS AMBIENTES.
       O <tpAmb> do XML sai de `fiscal_config.ambiente` (banco), mas a URL para
       onde a nota e transmitida sai de NFE_AMBIENTE (variavel de ambiente, lida
       pelo nfe.config do ERP). Sao fontes DIFERENTES: se divergirem, o XML diz
       "producao" e o envio vai para o endereco de homologacao — a SEFAZ recusa
       com 252 ("Ambiente informado diverge do Ambiente de recebimento") e o
       motivo nao aponta para a causa. Conferimos aqui antes de deixar emitir. */
    let ambienteUrl = null;
    try {
        const nfeConfig = require(path.resolve(__dirname, '..', '..',
            'modules/Faturamento/config/nfe.config'));
        ambienteUrl = Number(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao';
    } catch (e) { /* sem a arvore do ERP a emissao ja esta indisponivel */ }

    const ambienteBanco = /produ/i.test(String(cfg.ambiente || '')) ? 'producao' : 'homologacao';
    if (ambienteUrl && ambienteUrl !== ambienteBanco) {
        bloqueios.push(
            `Ambiente divergente: a nota sairia como "${ambienteBanco}" (Configuracao Fiscal) mas seria ` +
            `transmitida para "${ambienteUrl}" (NFE_AMBIENTE no .env). Acerte os dois — a SEFAZ recusa com 252.`);
    }

    // cadastros que a SEFAZ valida item a item
    const [[prod]] = await pool.query(
        `SELECT COUNT(*) t,
                SUM(LENGTH(REGEXP_REPLACE(COALESCE(ncm,''), '[^0-9]', '')) <> 8) sem_ncm,
                SUM(COALESCE(preco_venda,0) <= 0) sem_preco
         FROM produtos WHERE COALESCE(ativo,1) = 1`);
    const [[cli]] = await pool.query(
        `SELECT COUNT(*) t,
                SUM(COALESCE(cpf_cnpj,'') = '') sem_doc,
                SUM(COALESCE(codigo_municipio,'') = '') sem_ibge,
                SUM(COALESCE(cep,'') = '') sem_cep
         FROM clientes WHERE COALESCE(ativo,1) = 1`);

    if (Number(prod.sem_ncm) > 0) avisos.push(`${prod.sem_ncm} produto(s) sem NCM de 8 digitos — a nota que os incluir sera recusada`);
    if (Number(cli.sem_doc) > 0) avisos.push(`${cli.sem_doc} cliente(s) sem CPF/CNPJ`);
    if (Number(cli.sem_ibge) > 0) avisos.push(`${cli.sem_ibge} cliente(s) sem codigo IBGE do municipio — causa rejeicao 225`);
    if (Number(cli.sem_cep) > 0) avisos.push(`${cli.sem_cep} cliente(s) sem CEP`);

    res.json({
        pronto: bloqueios.length === 0,
        ambiente_emissao: cfg.ambiente,
        ambiente_transmissao: ambienteUrl,          // de onde sai a URL da SEFAZ
        ambiente_recebimento: ambienteRecebimento(cfg),
        motor_disponivel: !!fiscalEmissao,
        bloqueios, avisos,
        emitente: { cnpj: cfg.cnpj, razao_social: cfg.razao_social, ie,
                    municipio: cfg.codigo_municipio, uf: cfg.uf, regime: cfg.regime_tributario },
        numeracao: { serie: cfg.serie_nfe, proximo: cfg.proximo_numero_nfe },
        cadastros: {
            produtos_ativos: prod.t, produtos_sem_ncm: Number(prod.sem_ncm || 0),
            clientes_ativos: cli.t, clientes_sem_documento: Number(cli.sem_doc || 0),
            clientes_sem_ibge: Number(cli.sem_ibge || 0)
        }
    });
}));

/* XML da nota — serve para conferir antes de transmitir e para guardar o
   arquivo autorizado. Depois da autorizacao devolve o XML assinado que foi
   efetivamente enviado; antes, gera na hora a partir do rascunho. */
app.get('/api/fiscal/notas/:id/xml', asyncRota(async (req, res) => {
    const motor = exigirMotorNFe();
    const [[n]] = await pool.query('SELECT xml_assinado, numero, serie FROM notas_fiscais WHERE id = ?', [req.params.id]);
    if (!n) return erro(res, 404, 'Nota nao encontrada');

    const xml = n.xml_assinado || await motor.gerarXML(pool, Number(req.params.id));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition',
        `attachment; filename="nfe-${n.serie}-${String(n.numero).padStart(9, '0')}.xml"`);
    res.send(xml);
}));

/* ================================================================
   E-MAIL — envio pelo mesmo SMTP das 3 empresas do ERP (Resend,
   dominio verificado zyntraerp.com.br). Ver modules/Trevo/email.js.
   ================================================================ */

/* Manda a nota ao cliente com DANFE (PDF) e XML autorizado anexados. */
app.post('/api/fiscal/notas/:id/enviar-email', asyncRota(async (req, res) => {
    const motor = exigirMotorNFe();
    try {
        const r = await emailTrevo.enviarNotaFiscal(pool, Number(req.params.id), {
            para: req.body.para, copia: req.body.copia, motor
        });
        res.json({ message: `Nota enviada para ${r.para}`, ...r });
    } catch (e) { return erro(res, e.status || 502, e.message); }
}));

/* Resumo de contas a pagar para o financeiro. */
app.post('/api/financeiro/enviar-aviso-contas', asyncRota(async (req, res) => {
    try {
        const r = await emailTrevo.enviarAvisoContas(pool, {
            para: req.body.para, dias: req.body.dias
        });
        res.json(r);
    } catch (e) { return erro(res, e.status || 502, e.message); }
}));

/* Diagnostico do envio + teste real, para a tela de configuracao. */
app.get('/api/email/status', asyncRota(async (req, res) => {
    res.json({
        disponivel: emailTrevo.disponivel(),
        servidor: process.env.SMTP_HOST || '',
        porta: Number(process.env.SMTP_PORT || 0),
        remetente_sistema: process.env.SMTP_FROM || '',
        remetente_fiscal: process.env.SMTP_FROM_FISCAL || '',
        contato: process.env.EMAIL_CONTATO || ''
    });
}));

app.post('/api/email/teste', asyncRota(async (req, res) => {
    try {
        const r = await emailTrevo.enviarTeste(req.body.para);
        res.json({ message: `E-mail de teste enviado para ${r.para}`, ...r });
    } catch (e) { return erro(res, e.status || 502, e.message); }
}));

/* DANFE oficial em PDF — o mesmo desenho que o ERP ja usa, gerado a partir dos
   dados da nota. E o documento que acompanha a mercadoria.
   A tela de conferencia em HTML continua em /api/documentos/nota/:id. */
app.get('/api/fiscal/notas/:id/danfe', asyncRota(async (req, res) => {
    const [[n]] = await pool.query('SELECT modelo, numero, serie, status FROM notas_fiscais WHERE id = ?', [req.params.id]);
    if (!n) return erro(res, 404, 'Nota nao encontrada');
    if (String(n.modelo || '').toLowerCase() === 'nfse') {
        return res.redirect(`/api/documentos/nota/${req.params.id}`);
    }
    const motor = exigirMotorNFe();

    const arquivo = path.join(require('os').tmpdir(),
        `danfe-trevo-${req.params.id}-${Date.now()}.pdf`);
    try {
        await motor.gerarDANFE(pool, Number(req.params.id), arquivo);
        const pdf = require('fs').readFileSync(arquivo);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `inline; filename="danfe-${n.serie}-${String(n.numero).padStart(9, '0')}.pdf"`);
        res.send(pdf);
    } finally {
        try { require('fs').unlinkSync(arquivo); } catch (e) { /* temporario */ }
    }
}));

/* CANCELAMENTO — transmite o evento 110111 quando a nota existe na SEFAZ.

   Duas situacoes diferentes, que antes eram tratadas como uma so:
     • nota AUTORIZADA  -> precisa do evento na SEFAZ, senao ela continua valida
                           para o fisco mesmo aparecendo cancelada aqui;
     • nota REJEITADA / RASCUNHO -> nunca chegou a base do fisco. Cancela so aqui,
                           e a numeracao consumida deveria ser INUTILIZADA
                           (evento proprio) se a nota ja tinha numero reservado.

   Antes esta rota so fazia UPDATE local — o mesmo tipo de casca que a rota de
   autorizacao era. */
app.post('/api/fiscal/notas/:id/cancelar', asyncRota(async (req, res) => {
    const motivo = String(req.body.motivo || '').trim();
    if (motivo.length < 15) return erro(res, 400, 'A justificativa do cancelamento precisa de pelo menos 15 caracteres');

    const [[n]] = await pool.query('SELECT * FROM notas_fiscais WHERE id = ?', [req.params.id]);
    if (!n) return erro(res, 404, 'Nota nao encontrada');
    if (n.status === 'cancelada') return erro(res, 400, 'Nota ja esta cancelada');

    const autorizadaNaSefaz = n.status === 'autorizada' && n.chave && n.protocolo;

    if (autorizadaNaSefaz) {
        const motor = exigirMotorNFe();
        let r;
        try {
            r = await motor.cancelarNFe(pool, Number(req.params.id), motivo);
        } catch (e) {
            return erro(res, e.status || 502, e.message);
        }
        if (!r.cancelada) {
            return res.status(422).json({
                message: `SEFAZ ${r.cStat}: ${r.xMotivo || 'cancelamento recusado'}`.trim(),
                nota: await montarNota(n.id), retorno: r
            });
        }
        return res.json({ ...(await montarNota(n.id)), retorno: r, cancelado_na_sefaz: true });
    }

    /* Nunca foi autorizada: cancela apenas no sistema e diz isso claramente,
       para ninguem achar que houve evento de cancelamento no fisco. */
    await pool.query(
        "UPDATE notas_fiscais SET status='cancelada', motivo_cancelamento=?, atualizado_em=NOW() WHERE id=?",
        [motivo.slice(0, 255), n.id]);
    res.json({
        ...(await montarNota(n.id)),
        cancelado_na_sefaz: false,
        observacao: 'Nota nao estava autorizada na SEFAZ — cancelada somente no sistema. ' +
                    'Se o numero ja foi reservado, considere inutilizar a numeracao.'
    });
}));

app.delete('/api/fiscal/notas/:id', asyncRota(async (req, res) => {
    const [[n]] = await pool.query('SELECT status FROM notas_fiscais WHERE id = ?', [req.params.id]);
    if (!n) return erro(res, 404, 'Nota nao encontrada');
    if (n.status !== 'rascunho') return erro(res, 409, 'Somente rascunhos podem ser excluidos');
    await pool.query('DELETE FROM notas_fiscais WHERE id = ?', [req.params.id]);
    res.json({ message: 'Rascunho excluido' });
}));

app.get('/api/fiscal/resumo', asyncRota(async (req, res) => {
    const condVendaSemDocumento = `
           AND (
                (EXISTS (SELECT 1 FROM venda_itens vi WHERE vi.venda_id=v.id AND COALESCE(vi.tipo,'produto') <> 'servico')
                 AND NOT EXISTS (
                    SELECT 1 FROM notas_fiscais nf
                     LEFT JOIN nota_fiscal_vendas nfv ON nfv.nota_id=nf.id
                    WHERE (nf.venda_id=v.id OR nfv.venda_id=v.id)
                      AND nf.status <> 'cancelada' AND nf.modelo IN ('nfe','nfce')))
             OR (EXISTS (SELECT 1 FROM venda_itens vi WHERE vi.venda_id=v.id AND (vi.tipo='servico' OR vi.servico_id IS NOT NULL))
                 AND NOT EXISTS (
                    SELECT 1 FROM notas_fiscais nf
                     LEFT JOIN nota_fiscal_vendas nfv ON nfv.nota_id=nf.id
                    WHERE (nf.venda_id=v.id OR nfv.venda_id=v.id)
                      AND nf.status <> 'cancelada' AND nf.modelo='nfse'))
           )`;
    const [[mes]] = await pool.query(
        `SELECT COUNT(*) n, COALESCE(SUM(valor_total),0) total
         FROM notas_fiscais WHERE status='autorizada'
           AND data_emissao >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`);
    const [[imp]] = await pool.query(
        `SELECT COALESCE(SUM(valor_icms),0) icms, COALESCE(SUM(valor_pis + valor_cofins),0) pis_cofins,
                COALESCE(SUM(valor_ipi),0) ipi
         FROM notas_fiscais WHERE status='autorizada'
           AND data_emissao >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`);
    const [[situacao]] = await pool.query(
        `SELECT SUM(status='rascunho') rascunhos, SUM(status='autorizada') autorizadas,
                SUM(status='cancelada') canceladas FROM notas_fiscais`);
    const [[pendencias]] = await pool.query(
        `SELECT COUNT(*) n FROM produtos WHERE ativo=1 AND (ncm = '' OR ncm IS NULL)`);
    const [[semNota]] = await pool.query(
        `SELECT COUNT(*) n FROM vendas v WHERE v.status='concluida'
         ${condVendaSemDocumento}`);
    res.json({
        notas_mes: mes.n,
        faturado_mes: Number(mes.total),
        icms_mes: Number(imp.icms),
        pis_cofins_mes: Number(imp.pis_cofins),
        ipi_mes: Number(imp.ipi),
        rascunhos: Number(situacao.rascunhos || 0),
        autorizadas: Number(situacao.autorizadas || 0),
        canceladas: Number(situacao.canceladas || 0),
        produtos_sem_ncm: pendencias.n,
        vendas_sem_nota: semNota.n
    });
}));

// vendas concluidas que ainda nao geraram documento fiscal
app.get('/api/fiscal/vendas-pendentes', asyncRota(async (req, res) => {
    const condVendaSemDocumento = `
           AND (
                (EXISTS (SELECT 1 FROM venda_itens vi WHERE vi.venda_id=v.id AND COALESCE(vi.tipo,'produto') <> 'servico')
                 AND NOT EXISTS (
                    SELECT 1 FROM notas_fiscais nf
                     LEFT JOIN nota_fiscal_vendas nfv ON nfv.nota_id=nf.id
                    WHERE (nf.venda_id=v.id OR nfv.venda_id=v.id)
                      AND nf.status <> 'cancelada' AND nf.modelo IN ('nfe','nfce')))
             OR (EXISTS (SELECT 1 FROM venda_itens vi WHERE vi.venda_id=v.id AND (vi.tipo='servico' OR vi.servico_id IS NOT NULL))
                 AND NOT EXISTS (
                    SELECT 1 FROM notas_fiscais nf
                     LEFT JOIN nota_fiscal_vendas nfv ON nfv.nota_id=nf.id
                    WHERE (nf.venda_id=v.id OR nfv.venda_id=v.id)
                      AND nf.status <> 'cancelada' AND nf.modelo='nfse'))
           )`;
    const [linhas] = await pool.query(
        `SELECT v.id, v.cliente_nome, v.total, v.data, v.forma_pagamento
         FROM vendas v WHERE v.status='concluida'
         ${condVendaSemDocumento}
         ORDER BY v.id DESC LIMIT 100`);
    res.json(linhas.map(v => ({ ...v, total: Number(v.total) })));
}));

// ================================================================
// DDA — titulos emitidos CONTRA o CNPJ da loja
//
// O DDA de verdade chega por convenio/arquivo do banco. Aqui os titulos
// entram por lancamento manual ou colagem em lote (uma linha por titulo),
// e cada um vira uma conta a pagar com um clique.
// ================================================================
const nDda = (d) => ({ ...d, valor: Number(d.valor), data_vencimento: dataIso(d.data_vencimento) });

app.get('/api/dda', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.situacao) { cond.push('situacao = ?'); params.push(req.query.situacao); }
    if (req.query.busca) {
        cond.push('(beneficiario_nome LIKE ? OR beneficiario_cnpj LIKE ? OR numero_documento LIKE ? OR linha_digitavel LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t);
    }
    const [linhas] = await pool.query(
        'SELECT * FROM dda_titulos' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY data_vencimento ASC, id ASC LIMIT 500', params);
    res.json(linhas.map(nDda));
}));

function validarDda(t) {
    if (!String(t.beneficiario_nome || '').trim()) return 'Informe o beneficiario';
    if (!soData(t.data_vencimento)) return 'Vencimento invalido';
    if (!(num(t.valor, -1) > 0)) return 'Valor invalido';
    return null;
}

async function inserirDda(t, usuario, origem) {
    const [r] = await pool.query(
        `INSERT INTO dda_titulos (linha_digitavel, beneficiario_nome, beneficiario_cnpj, banco,
            numero_documento, data_vencimento, valor, observacoes, origem, usuario)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [String(t.linha_digitavel || '').replace(/\s/g, ''), String(t.beneficiario_nome).trim(),
         String(t.beneficiario_cnpj || '').replace(/\D/g, ''), t.banco || '', t.numero_documento || '',
         soData(t.data_vencimento), num(t.valor), t.observacoes || '', origem, usuario]
    );
    return r.insertId;
}

app.post('/api/dda', asyncRota(async (req, res) => {
    const msg = validarDda(req.body);
    if (msg) return erro(res, 400, msg);
    const id = await inserirDda(req.body, req.usuario.usuario, 'manual');
    const [[t]] = await pool.query('SELECT * FROM dda_titulos WHERE id = ?', [id]);
    res.status(201).json(nDda(t));
}));

/* Importacao em lote. Cada linha:
   beneficiario ; CNPJ ; vencimento (AAAA-MM-DD ou DD/MM/AAAA) ; valor ; documento ; linha digitavel */
app.post('/api/dda/importar', asyncRota(async (req, res) => {
    const texto = String(req.body.texto || '');
    const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    if (!linhas.length) return erro(res, 400, 'Nada para importar');

    const paraIso = (v) => {
        const s = String(v || '').trim();
        const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (br) return `${br[3]}-${br[2]}-${br[1]}`;
        return soData(s);
    };
    const paraNumero = (v) => num(String(v || '').replace(/\./g, '').replace(',', '.'));

    const importados = [];
    const rejeitados = [];
    for (const [i, linha] of linhas.entries()) {
        const p = linha.split(';').map(x => x.trim());
        const titulo = {
            beneficiario_nome: p[0], beneficiario_cnpj: p[1], data_vencimento: paraIso(p[2]),
            valor: paraNumero(p[3]), numero_documento: p[4] || '', linha_digitavel: p[5] || ''
        };
        const msg = validarDda(titulo);
        if (msg) { rejeitados.push({ linha: i + 1, conteudo: linha, motivo: msg }); continue; }
        importados.push(await inserirDda(titulo, req.usuario.usuario, 'lote'));
    }
    res.status(201).json({ importados: importados.length, rejeitados });
}));

// gera a conta a pagar a partir do titulo do DDA (mesma rotina usada pela SEFAZ)
app.post('/api/dda/:id/vincular', asyncRota(async (req, res) => {
    const [[existe]] = await pool.query('SELECT conta_pagar_id FROM dda_titulos WHERE id = ?', [req.params.id]);
    if (!existe) return erro(res, 404, 'Titulo nao encontrado');
    if (existe.conta_pagar_id) return erro(res, 409, 'Titulo ja vinculado a uma conta a pagar');

    const conta = await gerarContaDoDda(req.params.id, {
        categoria: req.body.categoria || 'fornecedores',
        descricao: req.body.descricao || '',
        usuario: req.usuario.usuario
    });
    if (!conta) return erro(res, 409, 'Nao foi possivel vincular o titulo');
    res.status(201).json(nContaPagar(conta));
}));

app.post('/api/dda/:id/ignorar', asyncRota(async (req, res) => {
    const [r] = await pool.query("UPDATE dda_titulos SET situacao='baixado' WHERE id=? AND conta_pagar_id IS NULL",
        [req.params.id]);
    if (!r.affectedRows) return erro(res, 409, 'Titulo nao encontrado ou ja vinculado');
    res.json({ message: 'Titulo baixado' });
}));

app.delete('/api/dda/:id', asyncRota(async (req, res) => {
    const [[t]] = await pool.query('SELECT conta_pagar_id FROM dda_titulos WHERE id = ?', [req.params.id]);
    if (!t) return erro(res, 404, 'Titulo nao encontrado');
    if (t.conta_pagar_id) return erro(res, 409, 'Titulo ja gerou conta a pagar - cancele a conta antes');
    await pool.query('DELETE FROM dda_titulos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Titulo excluido' });
}));

/* NOTA DE ENTRADA — a nota que um fornecedor emitiu CONTRA o CNPJ da loja.
   Vinda do importador de DANFE, ela cria numa tacada so:
     1) o fornecedor (se ainda nao existir, casando pelo CNPJ)
     2) um titulo no DDA para cada duplicata da nota
     3) a conta a pagar de cada titulo, ja vinculada
   E o caminho automatico entre "recebi a nota" e "tenho a conta no financeiro".
   Sem duplicatas no papel, entra uma parcela unica com o total da nota.       */
app.post('/api/fiscal/nf-entrada', asyncRota(async (req, res) => {
    const b = req.body;
    const nome = String(b.fornecedor_nome || '').trim();
    if (!nome) return erro(res, 400, 'Informe o fornecedor da nota');

    const cnpj = String(b.fornecedor_cnpj || '').replace(/\D/g, '');
    const documento = String(b.documento || '').trim();
    const categoria = String(b.categoria || 'fornecedores').trim();
    const chave = String(b.chave || '').replace(/\D/g, '');
    if (!chave && !documento) return erro(res, 400, 'Informe o numero ou a chave da nota');

    let parcelas = Array.isArray(b.duplicatas) ? b.duplicatas : [];
    parcelas = parcelas
        .map(p => ({ numero: String(p.numero || '').slice(0, 10),
                     vencimento: soData(p.vencimento), valor: num(p.valor) }))
        .filter(p => p.vencimento && p.valor > 0);

    if (!parcelas.length) {
        const total = num(b.valor_total);
        if (!(total > 0)) return erro(res, 400, 'A nota nao tem duplicatas nem valor total');
        const dias = Number.isFinite(Number(b.dias_prazo)) ? Math.max(0, Number(b.dias_prazo)) : 30;
        const venc = soData(b.data_emissao)
            ? new Date(soData(b.data_emissao) + 'T00:00:00Z') : new Date();
        venc.setDate(venc.getDate() + dias);
        parcelas = [{ numero: '001', vencimento: venc.toISOString().slice(0, 10), valor: total }];
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const referencia = chave
            ? `danfe:${chave}`
            : `danfe:${cnpj}:${String(b.serie || '')}:${documento}:${soData(b.data_emissao) || ''}`;
        const criado = await criarNotaEntradaComParcelas(conn, {
            origem: 'danfe', origem_referencia: referencia, chave, numero: documento,
            serie: b.serie, fornecedor_nome: nome, fornecedor_doc: cnpj,
            data_emissao: b.data_emissao, valor_total: b.valor_total ||
                parcelas.reduce((s, p) => s + p.valor, 0), parcelas, categoria,
            forma_pagamento: 'boleto', observacoes: 'Nota importada de DANFE',
            observacoes_conta: 'Gerado pela importacao da DANFE', rotulo: 'NF',
            usuario: req.usuario.usuario
        });
        await conn.commit();
        res.status(201).json({
            fornecedor_id: criado.nota.fornecedor_id,
            fornecedor_criado: criado.fornecedor_criado,
            nota_id: criado.nota.id, nota_status: criado.nota.status,
            parcelas: criado.contas.length, total: criado.nota.valor_parcelado,
            titulos: criado.contas
        });
    } catch (e) {
        await conn.rollback();
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Esta nota ja foi lancada no contas a pagar');
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    }
    finally { conn.release(); }
}));

// Relatorio de caixa por periodo. Considera a data efetiva da baixa/recebimento
// (e nao a data de vencimento), permitindo comparar semana e mes com o extrato.
/* Fonte unica do Relatorio Financeiro: a tela (/api/financeiro/relatorio) e o
   papel (/api/documentos/relatorio-financeiro) leem daqui. Extraida do handler
   quando o PDF entrou — duplicar as 4 consultas faria o papel divergir da tela
   no dia em que uma das duas mudasse. */
async function dadosRelatorioFinanceiro(query) {
    const hoje = iso(agoraNaLoja());
    const periodo = query.periodo === 'semana' ? 'semana' : 'mes';
    const fim = soData(query.fim) || hoje;
    let inicio = soData(query.inicio);
    if (!inicio) {
        const d = new Date(`${fim}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - (periodo === 'semana' ? 6 : d.getUTCDate() - 1));
        inicio = d.toISOString().slice(0, 10);
    }
    // O helper nao tem `res`: quem responde e a rota. Devolver o marcador mantem
    // a mesma mensagem nos dois consumidores sem acoplar o helper ao HTTP.
    if (inicio > fim) return { erroPeriodo: 'Periodo invalido: inicio maior que fim' };
    /* Titulo liquidado SEM data de liquidacao sumia do relatorio: o BETWEEN o
       descartava em silencio. Medido em 09/09/2026: a conta #16 (BRIDA
       LUBRIFICANTES, parcial de R$ 1.794,00) nao aparecia em periodo nenhum.
       O vencimento entra como data de referencia — datar pelo vencimento e
       impreciso, mas some com R$ 1.794 do caixa e' pior. */
    const [recebimentos] = await pool.query(
        `SELECT COALESCE(cr.data_recebimento, cr.data_vencimento) data,
                cr.cliente_nome parceiro, cr.descricao,
                cr.valor_recebido valor, cr.categoria, cr.forma_recebimento forma,
                COALESCE(NULLIF(os.placas,''), NULLIF(os.placa,''), NULLIF(v.placa,''), '') placa,
                COALESCE(NULLIF(os.motorista_nome,''), NULLIF(v.motorista_nome,''), '') motorista,
                (cr.data_recebimento IS NULL) sem_data
           FROM contas_receber cr
           LEFT JOIN ordens_servico os ON os.id = cr.os_id
           LEFT JOIN vendas v ON v.id = cr.venda_id
          WHERE cr.status <> 'cancelada' AND cr.valor_recebido > 0
            AND COALESCE(cr.data_recebimento, cr.data_vencimento) BETWEEN ? AND ?
          ORDER BY data DESC, cr.id DESC`, [inicio, fim]);
    /* 🔴 As vendas de balcao NAO viravam entrada nenhuma. So 2 das 19 vendas
       geraram titulo em contas_receber; as outras 17 (dinheiro/pix, pagas na
       hora) nunca apareciam — o relatorio mostrava R$ 1.330,00 onde a loja
       tinha recebido R$ 12.854,40. Entram aqui as vendas SEM titulo vinculado;
       as que tem titulo continuam contadas uma unica vez, pelo recebimento. */
    const [vendasBalcao] = await pool.query(
        `SELECT v.data data, v.cliente_nome parceiro,
                 CONCAT('Venda #', v.id) descricao,
                 v.total valor, 'Vendas' categoria, v.forma_pagamento forma,
                 v.placa, v.motorista_nome motorista
           FROM vendas v
          WHERE v.cancelada_em IS NULL AND v.total > 0
            AND DATE(v.data) BETWEEN ? AND ?
            AND NOT EXISTS (SELECT 1 FROM contas_receber c WHERE c.venda_id = v.id)
          ORDER BY v.data DESC, v.id DESC`, [inicio, fim]);

    /* Servicos da oficina: a OS concluida e' receita e entra no relatorio.
       Data de referencia: a CONCLUSAO (quando o servico foi entregue e cobrado),
       caindo para a realizacao e depois a abertura quando a loja nao preencheu.
       `orcamento` fica de fora de proposito — sao 28 OS somando R$ 15.750 que
       ainda nao viraram servico nenhum; conta-las inflaria o caixa com proposta.
       Dedup por `venda_id`: hoje ele e' NULL em 100% das OS, mas quando a oficina
       passar a faturar a OS como venda o vinculo evita a contagem dupla sozinho. */
    // OS e orcamentos passam pelo contas_receber (vinculo os_id). Consultar a
    // oficina novamente aqui duplicava as OS que ja tinham titulo financeiro.
    const servicos = [];

    // Compromissos ainda não liquidados. Para estes grupos o período considera
    // o vencimento, pois ainda não existe data efetiva de pagamento/recebimento.
    const [receberAberto] = await pool.query(
        `SELECT CASE WHEN cr.os_id IS NOT NULL THEN COALESCE(cr.data_emissao,cr.data_vencimento) ELSE cr.data_vencimento END data,
                cr.cliente_nome parceiro, cr.descricao,
                (cr.valor_original + cr.valor_juros + cr.valor_multa - cr.valor_desconto - cr.valor_recebido) valor,
                cr.categoria, cr.forma_recebimento forma, 'em_aberto' status_financeiro,
                COALESCE(NULLIF(os.placas,''), NULLIF(os.placa,''), NULLIF(v.placa,''), '') placa,
                COALESCE(NULLIF(os.motorista_nome,''), NULLIF(v.motorista_nome,''), '') motorista
           FROM contas_receber cr
           LEFT JOIN ordens_servico os ON os.id = cr.os_id
           LEFT JOIN vendas v ON v.id = cr.venda_id
          WHERE cr.status NOT IN ('recebida','cancelada')
            AND (cr.valor_original + cr.valor_juros + cr.valor_multa - cr.valor_desconto - cr.valor_recebido) > 0
            AND (CASE WHEN cr.os_id IS NOT NULL THEN COALESCE(cr.data_emissao,cr.data_vencimento) ELSE cr.data_vencimento END) BETWEEN ? AND ?
          ORDER BY cr.data_vencimento, cr.id`, [inicio, fim]);
    const nMov = (m, tipo) => m.map(x => ({ ...x, tipo, valor: Number(x.valor), data: soData(x.data) }));
    // Tres fontes de entrada: recebimento de titulo, venda de balcao e servico da
    // oficina. As duas ultimas nao geram titulo e por isso ficavam invisiveis.
    const entradasRecebidas = nMov(recebimentos, 'entrada')
        .map(x => ({ ...x, status_financeiro:'recebida' }));
    const entradasFaturadas = [
        ...nMov(vendasBalcao, 'entrada'),
        ...nMov(servicos, 'entrada')
    ].map(x => ({ ...x, status_financeiro:'faturada' }));
    const entradasRealizadas = [...entradasRecebidas, ...entradasFaturadas]
     .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const entradasPendentes = nMov(receberAberto, 'entrada');
    const situacao = ['em_aberto','recebidas','faturadas','pago_faturado','todos'].includes(query.situacao)
        ? query.situacao : 'em_aberto';
    const movimentosSelecionados = situacao === 'em_aberto' ? entradasPendentes
        : situacao === 'recebidas' ? entradasRecebidas
        : situacao === 'faturadas' ? entradasFaturadas
        : situacao === 'pago_faturado' ? entradasRealizadas
        : [...entradasPendentes, ...entradasRealizadas];
    const entradas = movimentosSelecionados.filter(x => x.tipo === 'entrada');
    const saidas = movimentosSelecionados.filter(x => x.tipo === 'saida');
    const totalEntradas = entradas.reduce((s, x) => s + x.valor, 0);
    const totalSaidas = saidas.reduce((s, x) => s + x.valor, 0);

    /* "Por dia" e "Por categoria" saem AGORA da mesma lista de movimentos, e nao
       de duas consultas paralelas. Antes eram tres definicoes do que conta —
       bastava mexer numa para os quadros da mesma tela paravam de fechar entre si
       (foi o que aconteceu: os totais ignoravam as vendas de balcao). */
    const mapaDia = new Map();
    for (const m of [...entradas, ...saidas]) {
        const d = m.data;
        if (!mapaDia.has(d)) mapaDia.set(d, { data: d, entradas: 0, saidas: 0 });
        const linha = mapaDia.get(d);
        if (m.tipo === 'entrada') linha.entradas += m.valor; else linha.saidas += m.valor;
    }
    const porDia = [...mapaDia.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));

    const mapaCat = new Map();
    for (const m of [...entradas, ...saidas]) {
        const chave = m.tipo + '|' + (m.categoria || '');
        if (!mapaCat.has(chave)) mapaCat.set(chave, { tipo: m.tipo, categoria: m.categoria || null, total: 0 });
        mapaCat.get(chave).total += m.valor;
    }
    const categorias = [...mapaCat.values()]
        .sort((a, b) => (a.tipo === b.tipo ? b.total - a.total : a.tipo.localeCompare(b.tipo)));
    return { periodo, situacao, inicio, fim, total_entradas: dinheiro(totalEntradas), total_saidas: dinheiro(totalSaidas),
        saldo: dinheiro(totalEntradas - totalSaidas), quantidade_entradas: entradas.length,
        quantidade_saidas: saidas.length, movimentos: [...entradas, ...saidas].sort((a, b) => String(b.data).localeCompare(String(a.data))),
        por_dia: porDia.map(x => ({ data: soData(x.data), entradas: Number(x.entradas), saidas: Number(x.saidas), saldo: dinheiro(Number(x.entradas) - Number(x.saidas)) })),
        categorias: categorias.map(x => ({ ...x, total: Number(x.total) })) };
}

app.get('/api/financeiro/relatorio', asyncRota(async (req, res) => {
    const dados = await dadosRelatorioFinanceiro(req.query);
    if (dados.erroPeriodo) return erro(res, 400, dados.erroPeriodo);
    res.json(dados);
}));

/* Relatorio Financeiro em papel — o PDF sai pelo "Salvar como PDF" do dialogo
   de impressao do navegador, igual a todos os documentos do Trevo (o servidor
   nao tem gerador de PDF; ver comentario no topo do relatorios.js). Recebe os
   MESMOS filtros da tela, entao o papel reflete exatamente o que esta no monitor. */
app.get('/api/documentos/relatorio-financeiro', asyncRota(async (req, res) => {
    const dados = await dadosRelatorioFinanceiro(req.query);
    if (dados.erroPeriodo) return erro(res, 400, dados.erroPeriodo);

    const empresa = await empresaDoDocumento();
    const periodoLabel = `${relatorios.fmt.dataBr(dados.inicio)} a ${relatorios.fmt.dataBr(dados.fim)}`;
    const situacaoLabel = {
        em_aberto: 'Em aberto — a receber', recebidas: 'Recebidas / quitadas',
        faturadas: 'Vendas e serviços faturados', pago_faturado: 'Receitas realizadas',
        todos: 'Todos os lançamentos'
    }[dados.situacao] || 'Em aberto — a receber';

    enviarHtml(res, relatorios.renderRelatorio({
        titulo: 'Relatório Financeiro',
        subtitulo: `${situacaoLabel} por período`,
        referencia: periodoLabel,
        campos: [
            ['Período', periodoLabel],
            ['Situação', situacaoLabel],
            ['Emissão', relatorios.fmt.dataBr(new Date(), true)],
            ['Movimentações', String(dados.movimentos.length)]
        ],
        corpo: relatorios.corpos.corpoRelatorioFinanceiro(dados),
        empresa,
        autoImprimir: querDownload(req)
    }));
}));

/* ================================================================
   SEFAZ — busca automatica das notas emitidas contra o CNPJ da loja.
   Cada nota nova vira titulo no DDA e, se `gerar_contas`, tambem a
   conta a pagar. Sem certificado digital a SEFAZ nem aceita a conexao,
   entao a rota devolve o motivo em vez de falhar em silencio.
   ================================================================ */
async function sincronizarSefaz({ usuario = 'sistema', gerarContas = true, categoria = 'fornecedores' } = {}) {
    const cfg = await configFiscal();
    const cnpj = String(cfg.cnpj || '').replace(/\D/g, '');

    if (!cnpj) throw Object.assign(new Error('CNPJ da empresa nao configurado'), { status: 400 });
    if (!cfg.sefaz_certificado)
        throw Object.assign(new Error('Certificado digital A1 nao configurado — sem ele a SEFAZ nao libera a consulta'), { status: 400 });

    /* Usa o ambiente de RECEBIMENTO, nao o de emissao. Antes esta busca ia para
       hom1.nfe.fazenda.gov.br junto com a emissao em homologacao — ou seja,
       varria um ambiente sem nenhuma nota e devolvia "nada localizado" sem erro
       aparente. As notas de compra de verdade so existem em producao. */
    const retorno = await sefaz.consultarNotasRecebidas({
        cnpj, uf: cfg.uf, ambiente: ambienteRecebimento(cfg),
        certificado: cfg.sefaz_certificado, senha: cfg.sefaz_certificado_senha,
        ultimoNSU: cfg.sefaz_ultimo_nsu
    });

    const prazo = Math.max(0, Number(cfg.sefaz_prazo_padrao) || 30);
    const novos = [];
    const repetidos = [];

    for (const nota of retorno.notas) {
        // A referencia unica no cabecalho torna importacoes concorrentes seguras.
        const referencia = `sefaz:${nota.chave}`;
        const [[ja]] = await pool.query(
            `SELECT ne.*,
                    (SELECT COUNT(*) FROM contas_pagar_pagamentos cpp
                      JOIN contas_pagar cp ON cp.id=cpp.conta_pagar_id
                     WHERE cp.nota_entrada_id=ne.id) eventos_pagamento
               FROM notas_entrada ne WHERE ne.origem_referencia = ?`, [referencia]);
        const podeEnriquecer = ja && ja.parcelamento_estimado && nota.duplicatas.length &&
            Number(ja.valor_pago) === 0 && Number(ja.eventos_pagamento) === 0;
        if (ja && !podeEnriquecer) { repetidos.push(nota.chave); continue; }

        /* O resumo (resNFe) nao traz vencimento — so a nota completa traz o bloco
           de duplicatas. Sem duplicata, cria uma parcela com o prazo padrao e o
           titulo fica no DDA para a loja conferir a data antes de pagar. */
        const parcelas = nota.duplicatas.length ? nota.duplicatas : [{
            numero: '001',
            vencimento: (() => {
                const d = nota.emissao ? new Date(nota.emissao + 'T00:00:00') : new Date();
                d.setDate(d.getDate() + prazo);
                return d.toISOString().slice(0, 10);
            })(),
            valor: nota.valor
        }];

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (podeEnriquecer) {
                // O resumo da SEFAZ nao traz duplicatas. Quando chega o XML
                // completo, troca o vencimento estimado pelo cronograma real,
                // mas somente se nenhuma baixa chegou a acontecer.
                await conn.query('DELETE FROM dda_titulos WHERE nota_entrada_id=?', [ja.id]);
                await conn.query('DELETE FROM contas_pagar WHERE nota_entrada_id=?', [ja.id]);
                await conn.query('DELETE FROM notas_entrada WHERE id=?', [ja.id]);
            }
            const criado = await criarNotaEntradaComParcelas(conn, {
                origem: 'sefaz', origem_referencia: referencia, chave: nota.chave,
                numero: nota.chave.slice(25, 34), fornecedor_nome: nota.emitente_nome || 'Fornecedor',
                fornecedor_doc: nota.emitente_cnpj, data_emissao: nota.emissao,
                valor_total: nota.valor, parcelas, categoria, forma_pagamento: 'boleto',
                observacoes: 'Nota recebida automaticamente da SEFAZ',
                observacoes_conta: `Importado da SEFAZ${nota.duplicatas.length ? '' : ` — vencimento estimado em ${prazo} dias`}`,
                rotulo: 'NF-e', usuario, gerar_contas: gerarContas,
                parcelamento_estimado: !nota.duplicatas.length
            });
            await conn.commit();
            for (const titulo of criado.contas) novos.push({
                dda_id: titulo.dda_id, conta_id: titulo.id, nota_id: criado.nota.id,
                chave: nota.chave, emitente: nota.emitente_nome, vencimento: titulo.vencimento,
                valor: titulo.valor, estimado: !nota.duplicatas.length
            });
        } catch (e) {
            await conn.rollback();
            if (e.codigo === 'NOTA_DUPLICADA' || e.code === 'ER_DUP_ENTRY') repetidos.push(nota.chave);
            else throw e;
        } finally { conn.release(); }
    }

    await pool.query(
        `UPDATE fiscal_config SET sefaz_ultimo_nsu = ?, sefaz_ultima_sincronia = NOW(),
            sefaz_ultimo_retorno = ? WHERE id = 1`,
        [retorno.ultimoNSU, `${retorno.status.codigo} ${retorno.status.mensagem}`.slice(0, 255)]);

    return {
        notas_encontradas: retorno.notas.length,
        titulos_criados: novos.length,
        ja_importadas: repetidos.length,
        ultimo_nsu: retorno.ultimoNSU,
        max_nsu: retorno.maxNSU,
        status: retorno.status,
        titulos: novos
    };
}

/* Gera a conta a pagar de um titulo do DDA (reaproveitado pela rota /vincular
   e pela sincronizacao da SEFAZ). Devolve null se o titulo ja estiver vinculado. */
async function gerarContaDoDda(ddaId, { categoria = 'fornecedores', descricao = '', usuario = 'sistema' } = {}) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[ref]] = await conn.query('SELECT nota_entrada_id FROM dda_titulos WHERE id=?', [ddaId]);
        if (ref && ref.nota_entrada_id) {
            await conn.query('SELECT id FROM notas_entrada WHERE id=? FOR UPDATE', [ref.nota_entrada_id]);
            await conn.query('SELECT id FROM contas_pagar WHERE nota_entrada_id=? ORDER BY id FOR UPDATE',
                [ref.nota_entrada_id]);
        }
        const [ts] = await conn.query('SELECT * FROM dda_titulos WHERE id = ? FOR UPDATE', [ddaId]);
        if (!ts.length || ts[0].conta_pagar_id) { await conn.rollback(); return null; }
        const t = ts[0];

        let fornecedorId = null;
        if (t.beneficiario_cnpj) {
            const [fs] = await conn.query(
                `SELECT id FROM fornecedores
                 WHERE REPLACE(REPLACE(REPLACE(cnpj_cpf,'.',''),'/',''),'-','') = ? LIMIT 1`,
                [t.beneficiario_cnpj]);
            if (fs.length) fornecedorId = fs[0].id;
        }
        if (!fornecedorId) {
            const [rf] = await conn.query(
                'INSERT INTO fornecedores (nome, cnpj_cpf, observacoes) VALUES (?,?,?)',
                [t.beneficiario_nome, t.beneficiario_cnpj, 'Cadastrado automaticamente pela importacao de notas']);
            fornecedorId = rf.insertId;
        }

        const [rc] = await conn.query(
            `INSERT INTO contas_pagar (fornecedor_id, fornecedor_nome, fornecedor_doc, descricao,
                numero_documento, nota_entrada_id, numero_parcela, total_parcelas, data_emissao,
                data_vencimento, valor_original, categoria, forma_pagamento, observacoes, usuario_criacao)
             VALUES (?,?,?,?,?,?,?,?,CURDATE(),?,?,?,'boleto',?,?)`,
            [fornecedorId, t.beneficiario_nome, t.beneficiario_cnpj,
             descricao || `NF ${t.numero_documento} — ${t.beneficiario_nome}`,
             t.numero_documento, t.nota_entrada_id || null, t.numero_parcela || null,
             t.total_parcelas || null, soData(t.data_vencimento), Number(t.valor), categoria,
             t.observacoes, usuario]);

        await conn.query('UPDATE contas_pagar SET codigo = ? WHERE id = ?',
            ['CP' + String(rc.insertId).padStart(6, '0'), rc.insertId]);
        await conn.query("UPDATE dda_titulos SET situacao='vinculado', conta_pagar_id=? WHERE id=?",
            [rc.insertId, t.id]);
        await recalcularNotaEntrada(conn, t.nota_entrada_id);
        await conn.commit();

        const [[conta]] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [rc.insertId]);
        return conta;
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
}

app.post('/api/fiscal/sefaz/sincronizar', asyncRota(async (req, res) => {
    try {
        const r = await sincronizarSefaz({
            usuario: req.usuario.usuario,
            gerarContas: req.body.gerar_contas !== false,
            categoria: req.body.categoria || 'fornecedores'
        });
        res.json(r);
    } catch (e) {
        if (e.status) return erro(res, e.status, e.message);
        return erro(res, 502, e.message);
    }
}));

app.get('/api/fiscal/sefaz/status', asyncRota(async (req, res) => {
    const cfg = await configFiscal();
    const certificado = String(cfg.sefaz_certificado || '');
    let certificadoOk = false, certificadoErro = '';
    if (certificado) {
        try { certificadoOk = require('fs').existsSync(certificado); }
        catch (e) { certificadoErro = e.message; }
        if (!certificadoOk) certificadoErro = 'arquivo nao encontrado no servidor';
    }
    const [[dda]] = await pool.query(
        "SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM dda_titulos WHERE origem = 'sefaz'");

    res.json({
        configurado: !!(cfg.cnpj && certificado && certificadoOk),
        cnpj: cfg.cnpj,
        ambiente: cfg.ambiente,
        certificado_informado: !!certificado,
        certificado_ok: certificadoOk,
        certificado_erro: certificadoErro,
        automatico: !!cfg.sefaz_auto,
        intervalo_min: Number(cfg.sefaz_intervalo_min || 60),
        prazo_padrao: Number(cfg.sefaz_prazo_padrao || 30),
        ultimo_nsu: Number(cfg.sefaz_ultimo_nsu || 0),
        ultima_sincronia: cfg.sefaz_ultima_sincronia,
        ultimo_retorno: cfg.sefaz_ultimo_retorno,
        titulos_importados: dda.n,
        valor_importado: Number(dda.total)
    });
}));

/* ================================================================
   RECEBIMENTO DE NFS-e E CT-e

   Mesma ideia da busca de NF-e logo acima, para os outros dois documentos que
   envolvem o CNPJ do Trevo:

     NFS-e — vem do Ambiente de Dados Nacional (ADN gov.br). Traz TANTO as notas
             que fornecedores emitiram contra o Trevo (papel `tomador`) QUANTO as
             que o proprio Trevo emitiu pelo portal da prefeitura (papel
             `prestador`). O ADN identifica a empresa pelo certificado, nao por
             um CNPJ no corpo.
     CT-e  — vem do CTeDistribuicaoDFe da SEFAZ. Frete contratado pelo Trevo.

   So o que o Trevo TOMOU vira despesa. O que ele PRESTOU e guardado para
   conferencia do faturamento e nunca gera conta a pagar — lancar a propria
   receita como despesa seria o pior erro possivel aqui.
   ================================================================ */
const FONTES_RECEBIMENTO = {
    nfse: { rotulo: 'NFS-e', origem: 'nfse' },
    cte:  { rotulo: 'CT-e',  origem: 'cte' }
};

/* Ambiente das buscas de documento. Cai em producao quando a coluna ainda nao
   existe (base antiga) — receber de um sandbox vazio nao serve para nada. */
const ambienteRecebimento = (cfg) =>
    /homolog/i.test(String(cfg.ambiente_recebimento || 'producao')) ? 'homologacao' : 'producao';

/* Busca os documentos de uma fonte e devolve a lista ja normalizada.
   Cada cliente tem seu formato de retorno; aqui achatamos os dois. */
async function buscarDocumentos(fonte, cfg) {
    // ver o comentario de `ambiente_recebimento` em db.js: receber e leitura e
    // so faz sentido em producao — o sandbox nao tem documento nenhum
    const ambiente = ambienteRecebimento(cfg);
    if (fonte === 'nfse') {
        const r = await nfseAdn.consultarRecebidas({
            ambiente,
            certificado: cfg.sefaz_certificado, senha: cfg.sefaz_certificado_senha,
            cnpjEmpresa: cfg.cnpj, ultimoNSU: cfg.nfse_ultimo_nsu
        });
        return { documentos: r.documentos, ultimoNSU: r.ultimoNSU,
                 retorno: r.limitado ? r.mensagem : `${r.status} ${r.mensagem}`.trim(), limitado: r.limitado };
    }
    const r = await sefaz.consultarCTeRecebidos({
        cnpj: cfg.cnpj, uf: cfg.uf, ambiente,
        certificado: cfg.sefaz_certificado, senha: cfg.sefaz_certificado_senha,
        ultimoNSU: cfg.cte_ultimo_nsu
    });
    return { documentos: r.documentos, ultimoNSU: r.ultimoNSU,
             retorno: `${r.status.codigo} ${r.status.mensagem}`.trim(), limitado: false };
}

async function sincronizarRecebidos({ fonte, usuario = 'sistema', gerarContas = true, categoria = 'fornecedores' } = {}) {
    if (!FONTES_RECEBIMENTO[fonte]) throw Object.assign(new Error('Fonte invalida'), { status: 400 });
    const cfg = await configFiscal();
    const cnpj = String(cfg.cnpj || '').replace(/\D/g, '');

    if (!cnpj) throw Object.assign(new Error('CNPJ da empresa nao configurado'), { status: 400 });
    if (!cfg.sefaz_certificado) {
        throw Object.assign(new Error(
            `Certificado digital A1 nao configurado — sem ele o ambiente nao libera a consulta de ${FONTES_RECEBIMENTO[fonte].rotulo}`),
            { status: 400 });
    }

    const { documentos, ultimoNSU, retorno, limitado } = await buscarDocumentos(fonte, cfg);
    const prazo = Math.max(0, Number(cfg.sefaz_prazo_padrao) || 30);

    let novos = 0, repetidos = 0, comoPrestador = 0, titulosCriados = 0;
    const importados = [];

    for (const doc of documentos) {
        const valorCobranca = Number(doc.valor_liquido) > 0 ? Number(doc.valor_liquido) : Number(doc.valor);
        const vencimento = (() => {
            const d = doc.emissao ? new Date(doc.emissao + 'T00:00:00') : new Date();
            d.setDate(d.getDate() + prazo);
            return d.toISOString().slice(0, 10);
        })();
        const rotulo = FONTES_RECEBIMENTO[fonte].rotulo;
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            /* Documento e financeiro vivem no mesmo commit. Um registro antigo
               sem vinculo e retomado; um ja vinculado e apenas contabilizado
               como repetido. O NSU so avanca depois de todo o lote concluir. */
            const [[existente]] = await conn.query(
                'SELECT * FROM documentos_recebidos WHERE fonte=? AND nsu=? FOR UPDATE',
                [doc.fonte, doc.nsu]);
            if (existente && (existente.dda_titulo_id || existente.conta_pagar_id ||
                existente.status === 'ignorado' || existente.papel === 'prestador' || existente.cancelado)) {
                await conn.commit(); repetidos++;
                if (existente.papel === 'prestador') comoPrestador++;
                continue;
            }

            let documentoId = existente ? existente.id : null;
            if (!documentoId) {
                const [r] = await conn.query(
                    `INSERT INTO documentos_recebidos
                        (fonte, tipo, nsu, chave, numero, serie, papel, emitente_nome, emitente_doc, emitente_im,
                         destinatario_nome, destinatario_doc, municipio, uf, descricao, informacoes_complementares,
                         codigo_tributacao, emissao, competencia, valor, valor_liquido, base_calculo, aliquota,
                         valor_iss, valor_icms, situacao, cancelado, xml)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [doc.fonte, doc.tipo, doc.nsu, doc.chave, String(doc.numero || '').slice(0, 20),
                     String(doc.serie || '').slice(0, 10), doc.papel,
                     String(doc.emitente_nome || '').slice(0, 160), doc.emitente_doc, doc.emitente_im || '',
                     String(doc.destinatario_nome || '').slice(0, 160), doc.destinatario_doc || '',
                     String(doc.municipio || '').slice(0, 80), String(doc.uf || '').slice(0, 2),
                     String(doc.descricao || '').slice(0, 1000),
                     String(doc.informacoes_complementares || '').slice(0, 1000),
                     String(doc.codigo_tributacao || '').slice(0, 10), soData(doc.emissao), soData(doc.competencia),
                     doc.valor, doc.valor_liquido, doc.base_calculo, doc.aliquota, doc.valor_iss, doc.valor_icms,
                     String(doc.situacao || '').slice(0, 30), doc.cancelado ? 1 : 0, doc.xml || null]);
                documentoId = r.insertId;
            }

            if (doc.papel === 'prestador' || doc.cancelado || !(valorCobranca > 0)) {
                await conn.query("UPDATE documentos_recebidos SET status='ignorado' WHERE id=?", [documentoId]);
                await conn.commit();
                if (existente) repetidos++; else novos++;
                if (doc.papel === 'prestador') comoPrestador++;
                continue;
            }

            const criado = await criarNotaEntradaComParcelas(conn, {
                origem: fonte, origem_referencia: `${fonte}:${doc.chave || doc.nsu}`,
                chave: doc.chave, numero: doc.numero, serie: doc.serie,
                fornecedor_nome: doc.emitente_nome || 'Prestador', fornecedor_doc: doc.emitente_doc,
                data_emissao: doc.emissao, valor_total: valorCobranca,
                parcelas: [{ numero: 1, vencimento, valor: valorCobranca }], categoria,
                observacoes: `${rotulo} recebida automaticamente`,
                observacoes_conta: `Vencimento estimado: emissao + ${prazo} dias`,
                rotulo, usuario, gerar_contas: gerarContas, parcelamento_estimado: true
            });
            const titulo = criado.contas[0];
            await conn.query(
                "UPDATE documentos_recebidos SET status='vinculado', dda_titulo_id=?, conta_pagar_id=? WHERE id=?",
                [titulo.dda_id, titulo.id, documentoId]);
            await conn.commit();
            if (existente) repetidos++; else novos++;
            titulosCriados++;
            importados.push({ chave: doc.chave, emitente: doc.emitente_nome, valor: valorCobranca,
                vencimento, nota_id: criado.nota.id, dda_id: titulo.dda_id, conta_id: titulo.id });
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }
    }

    const colunaNSU = fonte === 'nfse' ? 'nfse_ultimo_nsu' : 'cte_ultimo_nsu';
    const colunaData = fonte === 'nfse' ? 'nfse_ultima_sincronia' : 'cte_ultima_sincronia';
    const colunaRetorno = fonte === 'nfse' ? 'nfse_ultimo_retorno' : 'cte_ultimo_retorno';
    await pool.query(
        `UPDATE fiscal_config SET ${colunaNSU} = ?, ${colunaData} = NOW(), ${colunaRetorno} = ? WHERE id = 1`,
        [ultimoNSU, String(retorno || '').slice(0, 255)]);

    return {
        fonte, documentos_encontrados: documentos.length, novos, ja_importados: repetidos,
        como_prestador: comoPrestador, titulos_criados: titulosCriados,
        ultimo_nsu: ultimoNSU, retorno, limitado, titulos: importados
    };
}

app.post('/api/fiscal/recebimento/:fonte/sincronizar', asyncRota(async (req, res) => {
    try {
        const r = await sincronizarRecebidos({
            fonte: String(req.params.fonte || '').toLowerCase(),
            usuario: req.usuario.usuario,
            gerarContas: req.body.gerar_contas !== false,
            categoria: req.body.categoria || 'fornecedores'
        });
        res.json(r);
    } catch (e) {
        if (e.status) return erro(res, e.status, e.message);
        return erro(res, 502, e.message);
    }
}));

app.get('/api/fiscal/recebimento/status', asyncRota(async (req, res) => {
    const cfg = await configFiscal();
    const [linhas] = await pool.query(
        `SELECT fonte, papel, COUNT(*) n, COALESCE(SUM(valor),0) total
         FROM documentos_recebidos GROUP BY fonte, papel`);

    const resumo = (fonte) => {
        const doFonte = linhas.filter(l => l.fonte === fonte);
        const por = (papel) => doFonte.find(l => l.papel === papel) || { n: 0, total: 0 };
        return {
            recebidos: Number(por('tomador').n), valor_recebido: Number(por('tomador').total),
            emitidos: Number(por('prestador').n), valor_emitido: Number(por('prestador').total)
        };
    };

    res.json({
        certificado_ok: !!cfg.sefaz_certificado && require('fs').existsSync(cfg.sefaz_certificado),
        ambiente: ambienteRecebimento(cfg),
        ambiente_emissao: cfg.ambiente,
        nfse: {
            ...resumo('nfse'),
            automatico: !!cfg.nfse_auto, intervalo_min: Number(cfg.nfse_intervalo_min || 180),
            ultimo_nsu: Number(cfg.nfse_ultimo_nsu || 0),
            ultima_sincronia: cfg.nfse_ultima_sincronia, ultimo_retorno: cfg.nfse_ultimo_retorno
        },
        cte: {
            ...resumo('cte'),
            automatico: !!cfg.cte_auto, intervalo_min: Number(cfg.cte_intervalo_min || 120),
            ultimo_nsu: Number(cfg.cte_ultimo_nsu || 0),
            ultima_sincronia: cfg.cte_ultima_sincronia, ultimo_retorno: cfg.cte_ultimo_retorno
        }
    });
}));

/* Lista os documentos baixados. `papel=prestador` mostra o que o Trevo emitiu
   (conferencia de faturamento); o padrao e o que ele recebeu. */
app.get('/api/fiscal/recebimento/documentos', asyncRota(async (req, res) => {
    const cond = [], params = [];
    if (req.query.fonte) { cond.push('fonte = ?'); params.push(String(req.query.fonte).toLowerCase()); }
    if (req.query.papel) { cond.push('papel = ?'); params.push(String(req.query.papel).toLowerCase()); }
    if (req.query.status) { cond.push('status = ?'); params.push(String(req.query.status).toLowerCase()); }
    if (req.query.busca) {
        cond.push('(emitente_nome LIKE ? OR emitente_doc LIKE ? OR chave LIKE ? OR descricao LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t);
    }
    if (req.query.de) { cond.push('emissao >= ?'); params.push(req.query.de); }
    if (req.query.ate) { cond.push('emissao <= ?'); params.push(req.query.ate); }

    const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 200));
    const [linhas] = await pool.query(
        `SELECT id, fonte, tipo, nsu, chave, numero, serie, papel, emitente_nome, emitente_doc,
                destinatario_nome, municipio, uf, descricao, informacoes_complementares,
                emissao, competencia, valor, valor_liquido, aliquota, valor_iss, valor_icms,
                situacao, cancelado, status, conta_pagar_id, dda_titulo_id, baixado_em
         FROM documentos_recebidos
         ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
         ORDER BY emissao DESC, id DESC LIMIT ?`, [...params, limite]);

    res.json(linhas.map(d => ({ ...d, valor: Number(d.valor), valor_liquido: Number(d.valor_liquido),
        aliquota: Number(d.aliquota), valor_iss: Number(d.valor_iss), valor_icms: Number(d.valor_icms),
        cancelado: !!d.cancelado })));
}));

/* XML original do documento — e o arquivo que o contador pede. */
app.get('/api/fiscal/recebimento/documentos/:id/xml', asyncRota(async (req, res) => {
    const [[d]] = await pool.query('SELECT fonte, chave, xml FROM documentos_recebidos WHERE id = ?', [req.params.id]);
    if (!d) return erro(res, 404, 'Documento nao encontrado');
    if (!d.xml) return erro(res, 404, 'XML nao guardado para este documento');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${d.fonte}-${d.chave || req.params.id}.xml"`);
    res.send(d.xml);
}));

/* Lanca manualmente a conta a pagar de um documento que ficou como 'novo'
   (por exemplo: importado com gerar_contas=false, ou ignorado por engano). */
app.post('/api/fiscal/recebimento/documentos/:id/gerar-conta', asyncRota(async (req, res) => {
    const prazo = Math.max(0, Number((await configFiscal()).sefaz_prazo_padrao) || 30);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[d]] = await conn.query(
            'SELECT * FROM documentos_recebidos WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!d) { await conn.rollback(); return erro(res, 404, 'Documento nao encontrado'); }
        if (d.papel === 'prestador') {
            await conn.rollback();
            return erro(res, 400, 'Este documento foi EMITIDO pelo Trevo — e receita, nao vira conta a pagar');
        }
        if (d.conta_pagar_id) {
            await conn.rollback(); return erro(res, 409, 'Documento ja tem conta a pagar vinculada');
        }
        const valor = Number(d.valor_liquido) > 0 ? Number(d.valor_liquido) : Number(d.valor);
        if (!(valor > 0)) { await conn.rollback(); return erro(res, 400, 'Documento sem valor'); }
        const vencimento = (() => {
            const base = d.emissao ? new Date(soData(d.emissao) + 'T00:00:00Z') : new Date();
            base.setUTCDate(base.getUTCDate() + prazo);
            return base.toISOString().slice(0, 10);
        })();

        /* O sync com gerar_contas=false ja cria nota-pai + DDA. Nesse caso
           reaproveita os dois e cria somente a CP, sem colidir com a referencia
           fiscal unica nem perder o cronograma original. */
        if (d.dda_titulo_id) {
            const [[ddaRef]] = await conn.query('SELECT * FROM dda_titulos WHERE id=?', [d.dda_titulo_id]);
            if (ddaRef && ddaRef.nota_entrada_id) {
                await conn.query('SELECT id FROM notas_entrada WHERE id=? FOR UPDATE', [ddaRef.nota_entrada_id]);
                await conn.query('SELECT id FROM contas_pagar WHERE nota_entrada_id=? ORDER BY id FOR UPDATE',
                    [ddaRef.nota_entrada_id]);
                const [[dda]] = await conn.query('SELECT * FROM dda_titulos WHERE id=? FOR UPDATE', [d.dda_titulo_id]);
                if (dda.conta_pagar_id) {
                    await conn.rollback(); return erro(res, 409, 'Titulo ja possui conta a pagar vinculada');
                }
                const [[notaPai]] = await conn.query('SELECT * FROM notas_entrada WHERE id=?', [dda.nota_entrada_id]);
                const [rc] = await conn.query(
                    `INSERT INTO contas_pagar (fornecedor_id, fornecedor_nome, fornecedor_doc, descricao,
                        numero_documento, nota_entrada_id, numero_parcela, total_parcelas, data_emissao,
                        data_vencimento, valor_original, categoria, forma_pagamento, observacoes, usuario_criacao)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [notaPai.fornecedor_id, notaPai.fornecedor_nome, notaPai.fornecedor_doc,
                     `${String(d.fonte).toUpperCase()} ${notaPai.numero || 's/n'} — parcela ${dda.numero_parcela || 1}/${dda.total_parcelas || 1}`,
                     notaPai.numero || dda.numero_documento, notaPai.id, dda.numero_parcela || 1,
                     dda.total_parcelas || 1, soData(notaPai.data_emissao), soData(dda.data_vencimento),
                     Number(dda.valor), req.body.categoria || 'fornecedores', 'boleto', dda.observacoes || '',
                     req.usuario.usuario]);
                await conn.query('UPDATE contas_pagar SET codigo=? WHERE id=?',
                    ['CP' + String(rc.insertId).padStart(6, '0'), rc.insertId]);
                await conn.query("UPDATE dda_titulos SET situacao='vinculado', conta_pagar_id=? WHERE id=?",
                    [rc.insertId, dda.id]);
                const nota = await recalcularNotaEntrada(conn, notaPai.id);
                await conn.query(
                    "UPDATE documentos_recebidos SET status='vinculado', conta_pagar_id=? WHERE id=?",
                    [rc.insertId, d.id]);
                const [[conta]] = await conn.query('SELECT * FROM contas_pagar WHERE id=?', [rc.insertId]);
                await conn.commit();
                return res.json({ message: 'Conta a pagar gerada', nota, conta: nContaPagar(conta) });
            }
            // DDA legado sem nota-pai: substitui por uma estrutura completa.
            await conn.query('DELETE FROM dda_titulos WHERE id=? AND conta_pagar_id IS NULL', [d.dda_titulo_id]);
        }

        const criado = await criarNotaEntradaComParcelas(conn, {
            origem: d.fonte, origem_referencia: `${d.fonte}:${d.chave || d.nsu}`,
            chave: d.chave, numero: d.numero, serie: d.serie,
            fornecedor_nome: d.emitente_nome || 'Prestador', fornecedor_doc: d.emitente_doc,
            data_emissao: soData(d.emissao), valor_total: valor,
            parcelas: [{ numero: 1, vencimento, valor }],
            categoria: req.body.categoria || 'fornecedores', rotulo: String(d.fonte).toUpperCase(),
            observacoes: 'Conta gerada manualmente a partir de documento recebido',
            observacoes_conta: `Vencimento estimado: emissao + ${prazo} dias`,
            usuario: req.usuario.usuario, parcelamento_estimado: true
        });
        const titulo = criado.contas[0];
        await conn.query(
            "UPDATE documentos_recebidos SET status='vinculado', dda_titulo_id=?, conta_pagar_id=? WHERE id=?",
            [titulo.dda_id, titulo.id, d.id]);
        const [[conta]] = await conn.query('SELECT * FROM contas_pagar WHERE id=?', [titulo.id]);
        await conn.commit();
        res.json({ message: 'Conta a pagar gerada', nota: criado.nota, conta: nContaPagar(conta) });
    } catch (e) {
        await conn.rollback();
        if (e.code === 'ER_DUP_ENTRY' || e.codigo === 'NOTA_DUPLICADA')
            return erro(res, 409, 'Este documento ja possui nota financeira criada; atualize a tela');
        throw e;
    } finally { conn.release(); }
}));

/* Marca como ignorado — documento que nao deve virar despesa (nota de outro
   estabelecimento, cobranca ja paga por fora, duplicidade do prestador). */
app.post('/api/fiscal/recebimento/documentos/:id/ignorar', asyncRota(async (req, res) => {
    const [r] = await pool.query(
        "UPDATE documentos_recebidos SET status='ignorado' WHERE id = ? AND conta_pagar_id IS NULL",
        [req.params.id]);
    if (!r.affectedRows) return erro(res, 409, 'Documento nao encontrado ou ja vinculado a uma conta');
    res.json({ message: 'Documento ignorado' });
}));

app.get('/api/dda/resumo', asyncRota(async (req, res) => {
    const [[r]] = await pool.query(
        `SELECT COUNT(*) total,
                SUM(situacao='disponivel') disponiveis,
                COALESCE(SUM(CASE WHEN situacao='disponivel' THEN valor ELSE 0 END),0) valor_disponivel,
                COALESCE(SUM(CASE WHEN situacao='disponivel' AND data_vencimento < CURDATE() THEN valor ELSE 0 END),0) valor_vencido,
                COALESCE(SUM(CASE WHEN situacao='disponivel' AND data_vencimento BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY
                    THEN valor ELSE 0 END),0) valor_semana,
                SUM(situacao='vinculado') vinculados
         FROM dda_titulos`);
    res.json({
        total: r.total, disponiveis: Number(r.disponiveis || 0), vinculados: Number(r.vinculados || 0),
        valor_disponivel: Number(r.valor_disponivel), valor_vencido: Number(r.valor_vencido),
        valor_semana: Number(r.valor_semana)
    });
}));

// ================================================================
// OFICINA — veiculos, catalogo de servicos e ordens de servico
// ================================================================
const nVeiculo = (v) => ({
    ...v, km_atual: Number(v.km_atual), eixos: Number(v.eixos || 0),
    capacidade_ton: Number(v.capacidade_ton || 0)
});

// composicoes de caminhao atendidas na lavagem
const TIPOS_VEICULO = ['cavalo', 'truck', 'toco', 'carreta', 'bitrem', 'rodotrem',
    'vanderleia', 'vuc', 'onibus', 'utilitario', 'outro'];

const ROTULO_TIPO_VEICULO = {
    cavalo: 'Cavalo mecânico', truck: 'Truck', toco: 'Toco', carreta: 'Carreta',
    bitrem: 'Bitrem', rodotrem: 'Rodotrem', vanderleia: 'Vanderleia', vuc: 'VUC',
    onibus: 'Ônibus', utilitario: 'Utilitário', outro: 'Outro'
};

async function validarVeiculoDoCliente(conn, veiculoId, clienteId) {
    if (!veiculoId) return null;
    const [vs] = await conn.query('SELECT * FROM veiculos WHERE id = ?', [veiculoId]);
    if (!vs.length) throw Object.assign(new Error('Veiculo nao encontrado'), { status: 404 });
    const veiculo = vs[0];
    if (!clienteId)
        throw Object.assign(new Error('Selecione o cliente responsavel pelo veiculo'), { status: 400 });
    if (Number(veiculo.cliente_id) !== Number(clienteId))
        throw Object.assign(new Error('O veiculo selecionado nao pertence ao cliente informado'), { status: 409 });
    return veiculo;
}

async function validarMotoristaDoCliente(conn, motoristaId, clienteId) {
    if (!motoristaId) return null;
    const [ms] = await conn.query('SELECT * FROM motoristas WHERE id = ? AND ativo = 1', [motoristaId]);
    if (!ms.length) throw Object.assign(new Error('Motorista nao encontrado ou inativo'), { status: 404 });
    if (!clienteId || Number(ms[0].cliente_id) !== Number(clienteId))
        throw Object.assign(new Error('O motorista selecionado nao pertence ao cliente informado'), { status: 409 });
    return ms[0];
}

app.get('/api/motoristas', asyncRota(async (req, res) => {
    const params = [], cond = [];
    if (req.query.cliente_id) { cond.push('m.cliente_id = ?'); params.push(req.query.cliente_id); }
    if (req.query.ativos === '1') cond.push('m.ativo = 1');
    const [linhas] = await pool.query(
        `SELECT m.*, c.nome cliente_nome FROM motoristas m JOIN clientes c ON c.id=m.cliente_id
         ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY m.nome`, params);
    res.json(linhas.map(m => ({ ...m, ativo: !!m.ativo })));
}));

app.post('/api/motoristas', asyncRota(async (req, res) => {
    const b=req.body, nome=String(b.nome||'').trim();
    if (!b.cliente_id || !nome) return erro(res,400,'Cliente e nome do motorista sao obrigatorios');
    const [r]=await pool.query(
        'INSERT INTO motoristas (cliente_id,nome,cpf,telefone,cnh,observacoes,ativo) VALUES (?,?,?,?,?,?,?)',
        [b.cliente_id,nome,String(b.cpf||'').slice(0,20),String(b.telefone||'').slice(0,30),
         String(b.cnh||'').slice(0,30),String(b.observacoes||'').slice(0,300),b.ativo===false?0:1]);
    const [[m]]=await pool.query('SELECT * FROM motoristas WHERE id=?',[r.insertId]);
    res.status(201).json(m);
}));

app.put('/api/motoristas/:id', asyncRota(async (req,res)=>{
    const b=req.body, nome=String(b.nome||'').trim();
    if (!nome) return erro(res,400,'Nome do motorista e obrigatorio');
    const [r]=await pool.query(
        'UPDATE motoristas SET nome=?,cpf=?,telefone=?,cnh=?,observacoes=?,ativo=? WHERE id=?',
        [nome,String(b.cpf||'').slice(0,20),String(b.telefone||'').slice(0,30),
         String(b.cnh||'').slice(0,30),String(b.observacoes||'').slice(0,300),b.ativo===false?0:1,req.params.id]);
    if(!r.affectedRows)return erro(res,404,'Motorista nao encontrado');
    const [[m]]=await pool.query('SELECT * FROM motoristas WHERE id=?',[req.params.id]); res.json(m);
}));

app.delete('/api/motoristas/:id', asyncRota(async (req,res)=>{
    const [r]=await pool.query('UPDATE motoristas SET ativo=0 WHERE id=?',[req.params.id]);
    if(!r.affectedRows)return erro(res,404,'Motorista nao encontrado');
    res.json({message:'Motorista inativado; historico preservado'});
}));

// descricao curta do caminhao para a OS e para os documentos impressos
const descricaoVeiculo = (v) => [
    ROTULO_TIPO_VEICULO[v.tipo_veiculo] || '',
    [v.marca, v.modelo].filter(Boolean).join(' '),
    v.eixos ? `${v.eixos} eixos` : '',
    v.numero_frota ? `frota ${v.numero_frota}` : ''
].filter(Boolean).join(' · ');

app.get('/api/veiculos', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.cliente_id) { cond.push('v.cliente_id = ?'); params.push(req.query.cliente_id); }
    if (req.query.busca) {
        cond.push('(v.placa LIKE ? OR v.modelo LIKE ? OR v.marca LIKE ? OR c.nome LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t);
    }
    const [linhas] = await pool.query(
        `SELECT v.*, c.nome AS cliente_nome FROM veiculos v
         LEFT JOIN clientes c ON c.id = v.cliente_id` +
        (cond.length ? ' WHERE ' + cond.join(' AND ') : '') + ' ORDER BY v.placa', params);
    res.json(linhas.map(nVeiculo));
}));

const placaLimpa = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

function camposVeiculo(b) {
    return [placaLimpa(b.placa),
        b.marca || '', b.modelo || '', String(b.ano || '').slice(0, 9), b.cor || '',
        b.combustivel || '', String(b.chassi || '').toUpperCase().slice(0, 24),
        String(b.renavam || '').replace(/\D/g, '').slice(0, 20),
        Math.max(0, Math.floor(num(b.km_atual))), b.observacoes || '',
        TIPOS_VEICULO.includes(b.tipo_veiculo) ? b.tipo_veiculo : 'cavalo',
        Math.max(0, Math.min(12, Math.floor(num(b.eixos)))),
        placaLimpa(b.placa_carreta), String(b.numero_frota || '').slice(0, 20),
        num(b.capacidade_ton), String(b.transportadora || '').slice(0, 120)];
}

app.post('/api/veiculos', asyncRota(async (req, res) => {
    const b = req.body;
    if (!String(b.placa || '').trim() && !String(b.modelo || '').trim())
        return erro(res, 400, 'Informe ao menos a placa ou o modelo');
    const [r] = await pool.query(
        `INSERT INTO veiculos (cliente_id, placa, marca, modelo, ano, cor, combustivel, chassi,
            renavam, km_atual, observacoes, tipo_veiculo, eixos, placa_carreta, numero_frota,
            capacidade_ton, transportadora)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [b.cliente_id || null, ...camposVeiculo(b)]);
    const [[v]] = await pool.query('SELECT * FROM veiculos WHERE id = ?', [r.insertId]);
    res.status(201).json(nVeiculo(v));
}));

// mesma mesclagem do cadastro de clientes: campo ausente nao e tocado
const CAMPOS_VEICULO = ['placa', 'marca', 'modelo', 'ano', 'cor', 'combustivel', 'chassi',
    'renavam', 'km_atual', 'observacoes', 'tipo_veiculo', 'eixos', 'placa_carreta',
    'numero_frota', 'capacidade_ton', 'transportadora'];

app.put('/api/veiculos/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const valores = camposVeiculo(b);
    const enviados = CAMPOS_VEICULO
        .map((coluna, i) => ({ coluna, valor: valores[i] }))
        .filter(c => Object.prototype.hasOwnProperty.call(b, c.coluna));
    if (Object.prototype.hasOwnProperty.call(b, 'cliente_id'))
        enviados.unshift({ coluna: 'cliente_id', valor: b.cliente_id || null });
    if (!enviados.length) return erro(res, 400, 'Nenhum campo para atualizar');

    const [r] = await pool.query(
        `UPDATE veiculos SET ${enviados.map(c => c.coluna + '=?').join(', ')} WHERE id=?`,
        [...enviados.map(c => c.valor), req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Veiculo nao encontrado');
    const [[v]] = await pool.query('SELECT * FROM veiculos WHERE id = ?', [req.params.id]);
    res.json(nVeiculo(v));
}));

app.delete('/api/veiculos/:id', asyncRota(async (req, res) => {
    const [[usado]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM ordens_servico WHERE veiculo_id = ?) os,
                (SELECT COUNT(*) FROM vendas WHERE veiculo_id = ?) vendas`,
        [req.params.id, req.params.id]);
    if (Number(usado.os) + Number(usado.vendas) > 0)
        return erro(res, 409, 'Veiculo possui vendas ou ordens de servico registradas');
    const [r] = await pool.query('DELETE FROM veiculos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Veiculo nao encontrado');
    res.json({ message: 'Veiculo excluido' });
}));

// ---------------------------------------------------------------- servicos
const TIPOS_SERVICO = ['lavagem', 'troca-oleo', 'manutencao', 'revisao', 'alinhamento',
    'freios', 'suspensao', 'eletrica', 'ar-condicionado', 'outros'];

const nServico = (s) => ({ ...s, preco: Number(s.preco), ativo: !!s.ativo,
    ficha_troca_oleo: !!s.ficha_troca_oleo,
    aliquota_iss: Number(s.aliquota_iss || 0), iss_retido: !!s.iss_retido });

/* Tributacao do servico — o que a NFS-e exige.
   `cTribNac` (codigo de tributacao nacional) e derivado do item da LC 116/03:
   o item "14.01" vira "140101". Quando o usuario informa so o item, montamos o
   codigo; quando informa o codigo direto, ele manda. */
const TRIBUTACAO_ISS = ['tributavel', 'isento', 'imune', 'exportacao', 'nao_incidencia'];

function normalizarItemLC116(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length < 3) return '';
    return `${d.slice(0, 2)}.${d.slice(2, 4)}`;
}

function codigoTributacaoNacional(b) {
    const direto = String(b.codigo_tributacao_nacional || '').replace(/\D/g, '');
    if (direto.length === 6) return direto;
    // item 14.01 -> 140101 (os dois ultimos digitos sao o desdobramento, 01 por padrao)
    const item = String(b.item_lc116 || '').replace(/\D/g, '');
    return item.length >= 4 ? (item.slice(0, 4) + '01') : '';
}

/* Colunas fiscais gravadas tanto no POST quanto no PUT — a lista fica num lugar
   so para as duas rotas nao sairem de sincronia (foi assim que telefone/email da
   config fiscal ficaram meses sendo descartados em silencio). */
function valoresFiscaisServico(b) {
    const tributacao = TRIBUTACAO_ISS.includes(String(b.tributacao_iss)) ? b.tributacao_iss : 'tributavel';
    return [
        normalizarItemLC116(b.item_lc116),
        codigoTributacaoNacional(b),
        String(b.codigo_tributacao_municipal || '').trim().slice(0, 20),
        String(b.cnae || '').replace(/\D/g, '').slice(0, 7),
        String(b.codigo_nbs || '').replace(/\D/g, '').slice(0, 9),
        Math.max(0, Math.min(100, num(b.aliquota_iss))),
        b.iss_retido ? 1 : 0,
        tributacao
    ];
}
const COLUNAS_FISCAIS_SERVICO = ['item_lc116', 'codigo_tributacao_nacional', 'codigo_tributacao_municipal',
    'cnae', 'codigo_nbs', 'aliquota_iss', 'iss_retido', 'tributacao_iss'];

app.get('/api/servicos', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.ativos === '1') cond.push('ativo = 1');
    if (req.query.tipo) { cond.push('tipo = ?'); params.push(req.query.tipo); }
    if (req.query.busca) {
        cond.push('(nome LIKE ? OR codigo LIKE ? OR descricao LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t);
    }
    const [linhas] = await pool.query(
        'SELECT * FROM servicos' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') + ' ORDER BY nome', params);
    res.json(linhas.map(nServico));
}));

/* A categoria do servico aceita DUAS origens: a lista historica (que os
   servicos antigos usam) e as categorias que a loja cadastra em Configuracoes.
   Sem isso, quem apaga as categorias para refazer a lista fica travado: o
   cadastro recusaria justamente as categorias novas que acabou de criar. */
async function validarServico(b) {
    if (!String(b.nome || '').trim()) return 'Nome do servico e obrigatorio';
    const tipo = String(b.tipo || '').trim();
    if (!tipo) return 'Informe a categoria do servico';
    if (!TIPOS_SERVICO.includes(tipo)) {
        const [[cat]] = await pool.query(
            "SELECT id FROM categorias WHERE escopo = 'servico' AND nome = ? LIMIT 1", [tipo]);
        if (!cat) return `Categoria "${tipo}" nao cadastrada — crie em Configuracoes > Servicos e Categorias`;
    }
    if (num(b.preco, -1) < 0) return 'Preco invalido';
    return null;
}

app.post('/api/servicos', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = await validarServico(b);
    if (msg) return erro(res, 400, msg);
    const [r] = await pool.query(
        `INSERT INTO servicos (codigo, nome, tipo, descricao, preco, tempo_estimado_min, garantia_dias, ativo, ficha_troca_oleo,
            ${COLUNAS_FISCAIS_SERVICO.join(', ')})
         VALUES (?,?,?,?,?,?,?,?,?,${COLUNAS_FISCAIS_SERVICO.map(() => '?').join(',')})`,
        [b.codigo || '', String(b.nome).trim(), b.tipo, b.descricao || '', num(b.preco),
         Math.max(0, Math.floor(num(b.tempo_estimado_min))), Math.max(0, Math.floor(num(b.garantia_dias))),
         b.ativo === false ? 0 : 1, b.ficha_troca_oleo ? 1 : 0, ...valoresFiscaisServico(b)]);
    await pool.query("UPDATE servicos SET codigo = ? WHERE id = ? AND codigo = ''",
        ['SV' + String(r.insertId).padStart(4, '0'), r.insertId]);
    const [[s]] = await pool.query('SELECT * FROM servicos WHERE id = ?', [r.insertId]);
    res.status(201).json(nServico(s));
}));

app.put('/api/servicos/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const msg = await validarServico(b);
    if (msg) return erro(res, 400, msg);
    const [r] = await pool.query(
        `UPDATE servicos SET codigo=?, nome=?, tipo=?, descricao=?, preco=?, tempo_estimado_min=?,
            garantia_dias=?, ativo=?, ficha_troca_oleo=?,
            ${COLUNAS_FISCAIS_SERVICO.map(c => c + '=?').join(', ')} WHERE id=?`,
        [b.codigo || '', String(b.nome).trim(), b.tipo, b.descricao || '', num(b.preco),
         Math.max(0, Math.floor(num(b.tempo_estimado_min))), Math.max(0, Math.floor(num(b.garantia_dias))),
         b.ativo === false ? 0 : 1, b.ficha_troca_oleo ? 1 : 0,
         ...valoresFiscaisServico(b), req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Servico nao encontrado');
    const [[s]] = await pool.query('SELECT * FROM servicos WHERE id = ?', [req.params.id]);
    res.json(nServico(s));
}));

app.delete('/api/servicos/:id', asyncRota(async (req, res) => {
    const [[usado]] = await pool.query('SELECT COUNT(*) n FROM os_itens WHERE servico_id = ?', [req.params.id]);
    if (usado.n > 0) return erro(res, 409, 'Servico ja usado em ordens - inative-o em vez de excluir');
    const [r] = await pool.query('DELETE FROM servicos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Servico nao encontrado');
    res.json({ message: 'Servico excluido' });
}));

// ---------------------------------------------------------------- ordens de servico
/* Fluxo da OS: orcamento -> aberta -> em-andamento -> concluida (ou cancelada).
   "concluida" e "cancelada" tem rota propria (baixa de estoque, titulo a
   receber), entao o cadastro nunca grava esses dois direto. */
const STATUS_OS_EDITAVEIS = ['orcamento', 'aberta', 'em-andamento'];
const TECNICO_OS_FIXO = 'Esponjão';

const nOs = (o) => ({
    ...o,
    // Mantem os campos historicos e tambem oferece arrays para as telas novas.
    veiculo_ids_lista: String(o.veiculo_ids || o.veiculo_id || '').split(',').map(Number).filter(Boolean),
    placas_lista: String(o.placas || o.placa || '').split(',').map(s => s.trim()).filter(Boolean),
    validade_orcamento: dataIso(o.validade_orcamento),
    data_realizacao: dataIso(o.data_realizacao),
    km_entrada: Number(o.km_entrada),
    troca_data: dataIso(o.troca_data),
    troca_km: Number(o.troca_km || 0),
    exige_ficha_oleo: !!o.exige_ficha_oleo,
    valor_pecas: Number(o.valor_pecas), valor_servicos: Number(o.valor_servicos),
    desconto: Number(o.desconto), valor_total: Number(o.valor_total)
});

/* Campos da ficha de troca de oleo. Só entram quando a OS tem algum serviço
   com `ficha_troca_oleo`; do contrário são gravados vazios. */
const CAMPOS_TROCA_OLEO = ['troca_oleo_motor', 'troca_fluido_oleo', 'troca_filtro_oleo',
    'troca_filtro_ar', 'troca_filtro_combustivel'];

function valoresTrocaOleo(b, preparados = []) {
    const texto = CAMPOS_TROCA_OLEO.map(c => String(b[c] || '').trim().slice(0, 120));
    // a ficha e exigida pelo SERVICO incluido, nao pelo que foi digitado:
    // na oficina esses campos costumam ser preenchidos a caneta no papel
    const exige = preparados.some(p => p.ficha_troca_oleo) ? 1 : 0;
    return [...texto, soData(b.troca_data) || null,
            Math.max(0, Math.floor(num(b.troca_km))), exige];
}
const SQL_SET_TROCA_OLEO = [...CAMPOS_TROCA_OLEO, 'troca_data', 'troca_km', 'exige_ficha_oleo']
    .map(c => `${c} = ?`).join(', ');

// a OS mostra a ficha se o servico exige ou se ja ha algo preenchido nela
const temFichaOleo = (os) => !!os.exige_ficha_oleo ||
    CAMPOS_TROCA_OLEO.some(c => String(os[c] || '').trim()) ||
    !!os.troca_data || Number(os.troca_km) > 0;

const nItemOs = (i) => ({
    ...i, quantidade: Number(i.quantidade),
    // placa a que o item pertence; null/'' = item da composicao inteira
    veiculo_id: i.veiculo_id ? Number(i.veiculo_id) : null,
    placa: String(i.placa || ''),
    // data real da ordem onde a linha nasceu (carimbada na unificacao); vazia
    // fora de unificacao, ai o papel cai para a data da propria ordem
    data_origem: dataIso(i.data_origem),
    valor_unitario: Number(i.valor_unitario), valor_total: Number(i.valor_total)
});

async function montarOs(id) {
    const [[o]] = await pool.query(
        `SELECT o.*, c.cpf_cnpj AS cliente_doc, c.telefone AS cliente_telefone
         FROM ordens_servico o LEFT JOIN clientes c ON c.id = o.cliente_id WHERE o.id = ?`, [id]);
    if (!o) return null;
    const [itens] = await pool.query('SELECT * FROM os_itens WHERE os_id = ? ORDER BY tipo DESC, id', [id]);
    /* Mesmo fallback do nOs: ordem gravada antes da coluna veiculo_ids traz o
       caminhao em veiculo_id. Sem isso a tela de edicao abriria sem veiculo
       marcado e o seletor de placa do item sairia vazio numa OS que TEM placa. */
    const ids = String(o.veiculo_ids || o.veiculo_id || '').split(',').map(Number).filter(Boolean);
    let veiculos = [];
    if (ids.length) {
        const [vs] = await pool.query('SELECT id, placa, marca, modelo, tipo_veiculo, eixos, numero_frota FROM veiculos WHERE id IN (?) ORDER BY FIELD(id, ?)', [ids, ids]);
        veiculos = vs;
    }
    const [unificacoes] = await pool.query(
        `SELECT origem_os_id, origem_numero, origem_status, criado_em
           FROM os_unificacoes WHERE destino_os_id = ? ORDER BY id`, [id]);
    const [notasFiscais] = await pool.query(
        `SELECT id, modelo, serie, numero, status, ambiente, protocolo, motivo_sefaz, data_emissao
           FROM notas_fiscais WHERE os_id = ? AND status <> 'cancelada' ORDER BY id DESC`, [id]);
    return { ...nOs(o), veiculos, itens: itens.map(nItemOs), unificacoes, notas_fiscais: notasFiscais };
}

/* Recorte da ordem para o documento. A ordem da frota nasce unificada — todas
   as placas do cliente na mesma proposta — e na hora de emitir a oficina
   escolhe o que vai para o papel:
     ?itens=12,15      emite exatamente essas linhas (a lavagem completa de um
                       caminhão e a semi-completa de outro, por exemplo);
     ?placa=ABC1D23    emite todas as linhas daquela placa;
     sem parâmetro     a ordem inteira.
   O desconto acompanha o recorte, rateado pelo peso do que foi selecionado:
   sem isso um papel de duas linhas sairia com o desconto inteiro da ordem.
   Nada é gravado — o recorte existe só na emissão, a ordem continua uma só.
   Devolve null quando o recorte não sobra nenhuma linha. */
function recortarOsParaDocumento(os, { placa, itens } = {}) {
    const alvo = placaLimpa(placa);
    const ids = String(itens || '').split(',').map(Number).filter(Boolean);

    let selecionados = os.itens;
    if (ids.length) selecionados = os.itens.filter(i => ids.includes(Number(i.id)));
    else if (alvo) selecionados = os.itens.filter(i => placaLimpa(i.placa) === alvo);
    if (!selecionados.length) return null;

    // seleção completa: usa os totais gravados, sem risco de fugir um centavo
    if (selecionados.length === os.itens.length)
        return { ...os, recorte: false, placa_recorte: '', total_ordem: Number(os.valor_total) };

    const somar = (tipo) => dinheiro(selecionados
        .filter(i => !tipo || i.tipo === tipo)
        .reduce((t, i) => t + Number(i.valor_total), 0));
    const pecas = somar('peca');
    const servicos = somar('servico');
    const bruto = dinheiro(pecas + servicos);
    const brutoOrdem = Number(os.valor_pecas) + Number(os.valor_servicos);
    const desconto = brutoOrdem > 0 ? dinheiro(Number(os.desconto) * (bruto / brutoOrdem)) : 0;

    /* O documento só se apresenta como "de uma placa" quando TODA a seleção é
       daquela placa; um recorte que mistura caminhões continua sendo um papel
       da ordem, com a placa em cada linha. */
    const placasNaSelecao = [...new Set(selecionados.map(i => placaLimpa(i.placa)))];
    const placaUnica = placasNaSelecao.length === 1 ? placasNaSelecao[0] : '';
    const veiculo = placaUnica
        ? (os.veiculos || []).find(v => placaLimpa(v.placa) === placaUnica) : null;

    return { ...os, itens: selecionados, recorte: true,
        valor_pecas: pecas, valor_servicos: servicos, desconto,
        valor_total: dinheiro(bruto - desconto),
        placa_recorte: placaUnica,
        veiculo_descricao: veiculo ? descricaoVeiculo(veiculo) : os.veiculo_descricao,
        // o total cheio continua no papel: dá para ver o pedaço e o todo
        total_ordem: Number(os.valor_total) };
}

/* Resolve a seleção de veículos de um orçamento. O primeiro continua sendo
   gravado nos campos legados; os demais ficam em veiculo_ids/placas. */
/* Placa digitada vira CADASTRO de veiculo. Antes esta funcao so resolvia veiculo
   quando a TELA mandava `veiculo_id` — e como a oficina digita a placa direto na
   ordem, `veiculo_id` ficou NULO em 100% das 43 ordens e a tela Frota ficava
   vazia com 37 placas reais no historico. Agora a placa acha o veiculo existente
   ou cria um registro minimo, sem tirar a digitacao livre de ninguem: quem digita
   continua digitando, e a frota se alimenta sozinha. */
async function garantirVeiculoPorPlaca(conn, placa, clienteId) {
    const chave = placaLimpa(placa);
    if (!chave) return null;
    // Casa pela placa NORMALIZADA: o cadastro antigo pode ter "ABC-1234" e a ordem "ABC1234".
    const [achados] = await conn.query(
        `SELECT * FROM veiculos
          WHERE UPPER(REGEXP_REPLACE(placa, '[^A-Za-z0-9]', '')) = ?
          ORDER BY (cliente_id <=> ?) DESC, id LIMIT 1`, [chave, clienteId || null]);
    if (achados.length) return achados[0];
    const [r] = await conn.query(
        `INSERT INTO veiculos (cliente_id, placa, observacoes)
         VALUES (?, ?, 'Cadastrado automaticamente pela ordem de serviço')`,
        [clienteId || null, chave]);
    const [[novo]] = await conn.query('SELECT * FROM veiculos WHERE id = ?', [r.insertId]);
    return novo;
}

async function resolverVeiculosOs(conn, body, clienteId) {
    const idsInformados = Array.isArray(body.veiculo_ids)
        ? body.veiculo_ids : (body.veiculo_id ? [body.veiculo_id] : []);
    const ids = [...new Set(idsInformados.map(Number).filter(Number.isInteger).filter(Boolean))];
    const veiculos = [];
    for (const id of ids) veiculos.push(await validarVeiculoDoCliente(conn, id, clienteId));
    const placasDigitadas = Array.isArray(body.placas)
        ? body.placas : String(body.placas || body.placa || '').split(/[;,\s]+/);
    const placas = veiculos.map(v => placaLimpa(v.placa)).filter(Boolean);

    for (const p of placasDigitadas.map(placaLimpa).filter(Boolean)) {
        if (placas.includes(p)) continue;
        placas.push(p);
        // A placa digitada passa a existir na frota e a ordem sai vinculada a ela.
        const v = await garantirVeiculoPorPlaca(conn, p, clienteId);
        if (v) { veiculos.push(v); if (!ids.includes(v.id)) ids.push(v.id); }
    }

    return {
        veiculo: veiculos[0] || null,
        veiculos,
        veiculoIds: ids,
        placas: [...new Set(placas)]
    };
}

/* Monta os itens da OS a partir do catalogo: pecas vem de produtos,
   servicos de servicos. O servico_tipo e copiado para o item porque e
   ele que alimenta o resumo por cliente mesmo se o catalogo mudar depois. */
async function prepararItensOs(conn, itens, selecaoVeiculos = null) {
    const preparados = [];
    /* Cada item pode apontar para UMA das placas da ordem. O vinculo é pela
       PLACA, e nao pelo cadastro de veiculo: na oficina a placa costuma ser
       digitada direto na ordem (a maioria das ordens nao tem veiculo cadastrado),
       e exigir cadastro deixaria o item sem como ser carimbado. Quando a placa
       corresponde a um veiculo selecionado, o id vai junto e liga o item à ficha.
       Validar contra a selecao — e nao contra o cadastro inteiro — impede que a
       ordem do cliente A saia com um item carimbado com a placa do cliente B. */
    const selecao = selecaoVeiculos || { veiculos: [], placas: [] };
    const veiculosPorId = new Map((selecao.veiculos || []).map(v => [Number(v.id), v]));
    const veiculosPorPlaca = new Map((selecao.veiculos || []).map(v => [placaLimpa(v.placa), v]));
    const placasDaOs = new Set((selecao.placas || []).map(placaLimpa).filter(Boolean));
    for (const it of itens) {
        const qtd = num(it.quantidade, NaN);
        if (!Number.isFinite(qtd) || qtd <= 0) throw Object.assign(new Error('Quantidade invalida em um dos itens'), { status: 400 });

        // aceita a placa direto ou o id do veiculo (compatibilidade)
        const doId = it.veiculo_id ? veiculosPorId.get(Number(it.veiculo_id)) : null;
        if (it.veiculo_id && !doId)
            throw Object.assign(new Error('O veiculo de um dos itens nao esta entre os veiculos da ordem'), { status: 400 });
        const placaItem = placaLimpa(it.placa || (doId ? doId.placa : ''));
        if (placaItem && !placasDaOs.has(placaItem))
            throw Object.assign(new Error(`A placa ${placaItem} de um dos itens nao esta nas placas da ordem`), { status: 400 });
        const veiculoDoItem = doId || veiculosPorPlaca.get(placaItem) || null;
        const vinculo = {
            veiculo_id: veiculoDoItem ? veiculoDoItem.id : null,
            placa: placaItem,
            origem_numero: String(it.origem_numero || '').trim().slice(0, 20)
        };

        if (it.tipo === 'peca') {
            const [ps] = await conn.query('SELECT * FROM produtos WHERE id = ?', [it.produto_id]);
            if (!ps.length) throw Object.assign(new Error(`Peca id ${it.produto_id} nao encontrada`), { status: 404 });
            const p = ps[0];
            const preco = it.valor_unitario === undefined || it.valor_unitario === ''
                ? Number(p.preco_venda) : num(it.valor_unitario);
            preparados.push({ ...vinculo, tipo: 'peca', produto_id: p.id, servico_id: null, servico_tipo: '',
                sku: p.sku, descricao: p.descricao, quantidade: qtd, valor_unitario: preco,
                valor_total: dinheiro(qtd * preco) });
        } else {
            const [ss] = await conn.query('SELECT * FROM servicos WHERE id = ?', [it.servico_id]);
            if (!ss.length) throw Object.assign(new Error(`Servico id ${it.servico_id} nao encontrado`), { status: 404 });
            const s = ss[0];
            const preco = it.valor_unitario === undefined || it.valor_unitario === ''
                ? Number(s.preco) : num(it.valor_unitario);
            preparados.push({ ...vinculo, tipo: 'servico', produto_id: null, servico_id: s.id, servico_tipo: s.tipo,
                sku: s.codigo, descricao: s.nome, quantidade: qtd, valor_unitario: preco,
                valor_total: dinheiro(qtd * preco),
                // so viaja na memoria: define se a OS imprime a ficha de troca de oleo
                ficha_troca_oleo: !!s.ficha_troca_oleo });
        }
    }
    return preparados;
}

function totaisOs(itens, desconto) {
    const pecas = dinheiro(itens.filter(i => i.tipo === 'peca').reduce((s, i) => s + i.valor_total, 0));
    const servicos = dinheiro(itens.filter(i => i.tipo === 'servico').reduce((s, i) => s + i.valor_total, 0));
    return { pecas, servicos, total: dinheiro(pecas + servicos - desconto) };
}

async function gravarItensOs(conn, osId, itens, numeroOrigem = '') {
    await conn.query('DELETE FROM os_itens WHERE os_id = ?', [osId]);
    for (const i of itens) {
        await conn.query(
            `INSERT INTO os_itens (os_id, tipo, produto_id, servico_id, servico_tipo, sku, descricao,
                quantidade, valor_unitario, valor_total, veiculo_id, placa, origem_numero)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [osId, i.tipo, i.produto_id, i.servico_id, i.servico_tipo, i.sku, i.descricao,
             i.quantidade, i.valor_unitario, i.valor_total, i.veiculo_id || null, i.placa || '',
             i.origem_numero || numeroOrigem]);
    }
}

app.get('/api/ordens-servico', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.status) { cond.push('o.status = ?'); params.push(req.query.status); }
    if (req.query.cliente_id) { cond.push('o.cliente_id = ?'); params.push(req.query.cliente_id); }
    const dataOs = 'COALESCE(o.data_realizacao, DATE(o.data_abertura))';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.inicio || ''))) {
        cond.push(`${dataOs} >= ?`); params.push(req.query.inicio);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fim || ''))) {
        cond.push(`${dataOs} <= ?`); params.push(req.query.fim);
    }
    if (req.query.busca) {
        cond.push('(o.numero LIKE ? OR o.cliente_nome LIKE ? OR o.placa LIKE ? OR o.placas LIKE ? OR o.veiculo_descricao LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t, t);
    }
    const [linhas] = await pool.query(
        `SELECT o.*, (SELECT GROUP_CONCAT(i.descricao SEPARATOR ', ') FROM os_itens i
            WHERE i.os_id = o.id AND i.tipo='servico') resumo_servicos
         FROM ordens_servico o` + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ` ORDER BY ${dataOs} DESC, o.id DESC LIMIT 400`, params);
    res.json(linhas.map(nOs));
}));

app.get('/api/ordens-servico/resumo', asyncRota(async (req, res) => {
    const [[r]] = await pool.query(
        `SELECT SUM(status='orcamento') orcamentos, SUM(status='aberta') abertas,
                SUM(status='em-andamento') andamento,
                SUM(status='concluida' AND COALESCE(data_realizacao, DATE(data_conclusao)) >= DATE_FORMAT(CURDATE(),'%Y-%m-01')) concluidas_mes,
                COALESCE(SUM(CASE WHEN status='concluida' AND COALESCE(data_realizacao, DATE(data_conclusao)) >= DATE_FORMAT(CURDATE(),'%Y-%m-01')
                    THEN valor_total ELSE 0 END),0) faturado_mes,
                COALESCE(SUM(CASE WHEN status IN ('orcamento','aberta','em-andamento')
                    THEN valor_total ELSE 0 END),0) em_aberto
         FROM ordens_servico`);
    const [porTipo] = await pool.query(
        `SELECT i.servico_tipo tipo, SUM(i.quantidade) quantidade, SUM(i.valor_total) valor
         FROM os_itens i JOIN ordens_servico o ON o.id = i.os_id
         WHERE i.tipo='servico' AND o.status <> 'cancelada'
         GROUP BY i.servico_tipo ORDER BY quantidade DESC`);
    res.json({
        orcamentos: Number(r.orcamentos || 0), abertas: Number(r.abertas || 0),
        andamento: Number(r.andamento || 0), concluidas_mes: Number(r.concluidas_mes || 0),
        faturado_mes: Number(r.faturado_mes), em_aberto: Number(r.em_aberto),
        por_tipo: porTipo.map(t => ({ tipo: t.tipo || 'outros', quantidade: Number(t.quantidade), valor: Number(t.valor) }))
    });
}));

app.get('/api/ordens-servico/:id', asyncRota(async (req, res) => {
    const o = await montarOs(req.params.id);
    if (!o) return erro(res, 404, 'Ordem de servico nao encontrada');
    res.json(o);
}));

/* A unificacao e sempre separada por natureza: orcamentos se juntam com
   orcamentos; OS abertas/em andamento se juntam entre si. A empresa precisa
   estar cadastrada, porque "Consumidor Final" nao identifica um unico dono. */
async function buscarCandidatasUnificacao(conn, destinoId, bloquear = false, idsInformados = []) {
    const [[destino]] = await conn.query('SELECT * FROM ordens_servico WHERE id = ?', [destinoId]);
    if (!destino) throw Object.assign(new Error('Ordem nao encontrada'), { status: 404 });
    const grupo = grupoDaOrdem(destino.status);
    if (!grupo) throw Object.assign(
        new Error('Somente orcamentos ou ordens em aberto podem ser unificados'), { status: 409 });
    if (!destino.cliente_id) throw Object.assign(
        new Error('Selecione uma empresa cadastrada antes de unificar'), { status: 409 });

    const ids = normalizarIdsSelecionados(idsInformados);
    if (ids.length) {
        if (!ids.includes(Number(destino.id))) throw Object.assign(
            new Error('A ordem de destino precisa estar entre as ordens selecionadas'), { status: 400 });
        const [selecionadas] = await conn.query(
            `SELECT * FROM ordens_servico WHERE id IN (?) ORDER BY id${bloquear ? ' FOR UPDATE' : ''}`,
            [ids]);
        if (selecionadas.length !== ids.length) throw Object.assign(
            new Error('Uma ou mais ordens selecionadas nao foram encontradas'), { status: 404 });
        return { destino, grupo, ordens: selecionadas };
    }

    const condStatus = grupo === 'orcamento' ? 'status = ?' : 'status IN (?, ?)';
    const params = grupo === 'orcamento'
        ? [destino.cliente_id, 'orcamento']
        : [destino.cliente_id, 'aberta', 'em-andamento'];
    const [ordens] = await conn.query(
        `SELECT * FROM ordens_servico
          WHERE cliente_id = ? AND ${condStatus}
          ORDER BY id${bloquear ? ' FOR UPDATE' : ''}`,
        params);
    return { destino, grupo, ordens };
}

app.get('/api/ordens-servico/:id/unificacao', asyncRota(async (req, res) => {
    try {
        const idsSelecionados = normalizarIdsSelecionados(req.query.ids);
        const { destino, grupo, ordens } = await buscarCandidatasUnificacao(
            pool, req.params.id, false, idsSelecionados);
        if (ordens.length > 1) validarEPrepararUnificacao(ordens, destino.id);
        const placas = [...new Set(ordens.flatMap(o =>
            String(o.placas || o.placa || '').split(',').map(p => placaLimpa(p)).filter(Boolean)))];
        res.json({
            disponivel: ordens.length > 1,
            tipo: grupo,
            destino_id: Number(destino.id),
            destino_numero: destino.numero,
            cliente_id: Number(destino.cliente_id),
            cliente_nome: destino.cliente_nome,
            quantidade: ordens.length,
            total: dinheiro(ordens.reduce((s, o) => s + Number(o.valor_total || 0), 0)),
            placas,
            ordens: ordens.map(o => ({
                id: Number(o.id), numero: o.numero, status: o.status,
                placas: o.placas || o.placa || '', valor_total: Number(o.valor_total || 0),
                data_realizacao: dataIso(o.data_realizacao), data_abertura: o.data_abertura
            }))
        });
    } catch (e) {
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    }
}));

app.post('/api/ordens-servico/:id/unificar', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { ordens } = await buscarCandidatasUnificacao(
            conn, req.params.id, true, normalizarIdsSelecionados(req.body.ids));
        const plano = validarEPrepararUnificacao(ordens, req.params.id);
        const [itensOriginais] = await conn.query(
            'SELECT * FROM os_itens WHERE os_id IN (?) ORDER BY os_id, id FOR UPDATE', [plano.ids]);
        const itensDestinoOriginais = itensOriginais.filter(
            i => Number(i.os_id) === Number(plano.destino.id));
        const destinoJson = JSON.stringify({ ordem: plano.destino, itens: itensDestinoOriginais });
        const placasConsolidadas = [...new Set([
            ...plano.placas,
            ...itensOriginais.map(i => placaLimpa(i.placa)).filter(Boolean)
        ])];
        const veiculosConsolidados = [...new Set([
            ...plano.veiculoIds,
            ...itensOriginais.map(i => Number(i.veiculo_id)).filter(Number.isInteger).filter(Boolean)
        ])];

        // A linha que ja estava no destino tambem ganha origem, para a tela
        // conseguir separar claramente de qual OS cada item veio.
        /* `data_origem` carimba a data REAL de cada linha (a da ordem onde ela
           nasceu), nao a data da ordem consolidada. Sem isso o papel emitido
           depois da unificacao saia com a mesma data em toda linha — a data do
           destino — mesmo quando as ordens de origem foram abertas em dias
           diferentes. So carimba quando ainda esta vazio: uma linha que ja
           veio de outra unificacao mantem a data de onde nasceu de verdade. */
        const dataReferencia = (o) => soData(o.data_realizacao) || soData(o.data_abertura);
        await conn.query(
            `UPDATE os_itens SET origem_numero = ?, data_origem = COALESCE(data_origem, ?)
              WHERE os_id = ? AND origem_numero = ''`,
            [plano.destino.numero, dataReferencia(plano.destino), plano.destino.id]);

        for (const origem of plano.origens) {
            await conn.query(
                `INSERT INTO os_itens (os_id, tipo, produto_id, servico_id, servico_tipo, sku, descricao,
                    quantidade, valor_unitario, valor_total, veiculo_id, placa, origem_numero, data_origem)
                 SELECT ?, tipo, produto_id, servico_id, servico_tipo, sku, descricao,
                    quantidade, valor_unitario, valor_total, veiculo_id, placa,
                    COALESCE(NULLIF(origem_numero, ''), ?), COALESCE(data_origem, ?)
                   FROM os_itens WHERE os_id = ? ORDER BY id`,
                [plano.destino.id, origem.numero, dataReferencia(origem), origem.id]);

            const itensDaOrigem = itensOriginais.filter(i => Number(i.os_id) === Number(origem.id));
            await conn.query(
                `INSERT INTO os_unificacoes
                    (destino_os_id, origem_os_id, origem_numero, origem_status, origem_json, destino_json, usuario)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [plano.destino.id, origem.id, origem.numero, origem.status,
                 JSON.stringify({ ordem: origem, itens: itensDaOrigem }), destinoJson, req.usuario.usuario]);
        }

        const [[totais]] = await conn.query(
            `SELECT
                COALESCE(SUM(CASE WHEN tipo='peca' THEN valor_total ELSE 0 END), 0) valor_pecas,
                COALESCE(SUM(CASE WHEN tipo='servico' THEN valor_total ELSE 0 END), 0) valor_servicos
               FROM os_itens WHERE os_id = ?`, [plano.destino.id]);
        const valorPecas = dinheiro(totais.valor_pecas);
        const valorServicos = dinheiro(totais.valor_servicos);
        const bruto = dinheiro(valorPecas + valorServicos);
        const desconto = dinheiro(Math.min(Math.max(0, plano.desconto), bruto));
        const valorTotal = dinheiro(bruto - desconto);

        await conn.query(
            `UPDATE ordens_servico SET
                veiculo_id=?, veiculo_ids=?, placa=?, placas=?, veiculo_descricao=?, km_entrada=?,
                status=?, reclamacao=?, diagnostico=?, observacoes=?,
                valor_pecas=?, valor_servicos=?, desconto=?, valor_total=?, forma_pagamento=?,
                exige_ficha_oleo=?, troca_oleo_motor=?, troca_fluido_oleo=?,
                troca_filtro_oleo=?, troca_filtro_ar=?, troca_filtro_combustivel=?, troca_km=?
              WHERE id=?`,
            [veiculosConsolidados[0] || plano.destino.veiculo_id || null,
             veiculosConsolidados.join(',').slice(0, 500),
             placasConsolidadas[0] || plano.destino.placa || '',
             placasConsolidadas.join(', ').slice(0, 500), plano.veiculoDescricao,
             plano.kmEntrada, plano.status, plano.reclamacao, plano.diagnostico, plano.observacoes,
             valorPecas, valorServicos, desconto, valorTotal, plano.formaPagamento,
             plano.exigeFichaOleo, plano.trocaOleoMotor, plano.trocaFluidoOleo,
             plano.trocaFiltroOleo, plano.trocaFiltroAr, plano.trocaFiltroCombustivel,
             plano.trocaKm, plano.destino.id]);

        // Documentos antigos passam a abrir o registro consolidado em vez de
        // apontar para ids removidos. O numero do documento emitido nao muda.
        await conn.query(
            "UPDATE documentos_emitidos SET referencia_id = ? WHERE referencia_tipo = 'os' AND referencia_id IN (?)",
            [plano.destino.id, plano.idsOrigens]);
        // Se uma das origens ja era resultado de outra unificacao, seus
        // registros de auditoria passam ao novo destino antes da exclusao.
        // Sem isso o ON DELETE CASCADE apagaria parte da arvore historica.
        await conn.query(
            'UPDATE os_unificacoes SET destino_os_id = ? WHERE destino_os_id IN (?)',
            [plano.destino.id, plano.idsOrigens]);
        await conn.query('DELETE FROM ordens_servico WHERE id IN (?)', [plano.idsOrigens]);
        await conn.commit();

        const unificada = await montarOs(plano.destino.id);
        res.json({ ...unificada,
            unificacao: {
                quantidade: plano.ids.length,
                origens: plano.origens.map(o => o.numero),
                message: `${plano.ids.length} registros unificados em ${plano.destino.numero}`
            }
        });
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

/* Desfaz uma unificacao enquanto ela ainda nao produziu efeitos de estoque ou
   financeiro. Tudo roda na mesma transacao: ou destino e origens voltam por
   inteiro, ou nenhuma linha e alterada. */
app.post('/api/ordens-servico/:id/desunificar', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[destino]] = await conn.query(
            'SELECT * FROM ordens_servico WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!destino) throw Object.assign(new Error('Ordem unificada nao encontrada'), { status: 404 });
        if (!grupoDaOrdem(destino.status) || destino.venda_id)
            throw Object.assign(new Error('Somente orcamento ou OS em aberto, sem venda vinculada, pode ser desunificado'), { status: 409 });

        const [registros] = await conn.query(
            'SELECT * FROM os_unificacoes WHERE destino_os_id = ? ORDER BY id FOR UPDATE', [destino.id]);
        if (!registros.length)
            throw Object.assign(new Error('Esta ordem nao possui unificacao para desfazer'), { status: 409 });
        const momentos = new Set(registros.map(r => new Date(r.criado_em).getTime()));
        if (momentos.size > 1)
            throw Object.assign(new Error('Esta ordem possui unificacoes em etapas diferentes; procure o suporte para uma reversao assistida'), { status: 409 });

        /* origem_json/destino_json vem de JSON.stringify: toda data de dentro
           (Date do mysql2) sai como texto ISO ("...T...Z"). Sem reconverter, o
           INSERT/UPDATE grava esse texto literal numa coluna DATE/DATETIME e o
           MySQL recusa com "Incorrect date(time) value" — a restauracao inteira
           falhava e a transacao caia em rollback antes de trocar uma linha. */
        const ISO_COM_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        const restaurarDatas = (objeto) => {
            const r = { ...objeto };
            for (const [chave, valor] of Object.entries(r))
                if (typeof valor === 'string' && ISO_COM_HORA.test(valor)) r[chave] = new Date(valor);
            return r;
        };
        const lerFoto = (texto, rotulo) => {
            try {
                const foto = typeof texto === 'string' ? JSON.parse(texto) : texto;
                if (!foto || !foto.ordem || !Array.isArray(foto.itens)) throw new Error();
                return { ordem: restaurarDatas(foto.ordem), itens: foto.itens.map(restaurarDatas) };
            } catch (_) {
                throw Object.assign(new Error(`Historico de ${rotulo} incompleto; nenhuma alteracao foi realizada`), { status: 409 });
            }
        };
        const origens = registros.map(r => lerFoto(r.origem_json, r.origem_numero));
        const destinoFoto = registros[0].destino_json
            ? lerFoto(registros[0].destino_json, destino.numero) : null;

        for (const foto of origens) {
            const [[existente]] = await conn.query('SELECT id FROM ordens_servico WHERE id = ?', [foto.ordem.id]);
            if (existente) throw Object.assign(new Error(`A ordem ${foto.ordem.numero} ja existe; nenhuma alteracao foi realizada`), { status: 409 });
        }

        if (destinoFoto) {
            await conn.query('DELETE FROM os_itens WHERE os_id = ?', [destino.id]);
            const restaurarDestino = { ...destinoFoto.ordem };
            delete restaurarDestino.id;
            await conn.query('UPDATE ordens_servico SET ? WHERE id = ?', [restaurarDestino, destino.id]);
            for (const item of destinoFoto.itens) await conn.query('INSERT INTO os_itens SET ?', item);
        } else {
            // Unificacoes antigas nao guardavam a fotografia do destino. Os
            // itens ainda trazem a origem, portanto o recorte e os totais sao exatos.
            const numeros = registros.map(r => r.origem_numero);
            await conn.query('DELETE FROM os_itens WHERE os_id = ? AND origem_numero IN (?)', [destino.id, numeros]);
            await conn.query("UPDATE os_itens SET origem_numero = '' WHERE os_id = ? AND origem_numero = ?", [destino.id, destino.numero]);
            const [[totais]] = await conn.query(
                `SELECT COALESCE(SUM(CASE WHEN tipo='peca' THEN valor_total ELSE 0 END),0) valor_pecas,
                        COALESCE(SUM(CASE WHEN tipo='servico' THEN valor_total ELSE 0 END),0) valor_servicos
                   FROM os_itens WHERE os_id = ?`, [destino.id]);
            const descontoOrigens = origens.reduce((s, f) => s + Number(f.ordem.desconto || 0), 0);
            const desconto = dinheiro(Math.max(0, Number(destino.desconto || 0) - descontoOrigens));
            /* Sem fotografia do destino, "placas"/"veiculo_ids" (consolidados na
               unificacao) ficavam presos no valor antigo depois de remover os
               itens das origens — o cabecalho do documento continuava listando
               caminhoes que ja nao tinham mais nenhuma linha na ordem. Recalcula
               das linhas que sobraram, a mesma fonte que a unificacao usa. */
            const [itensRestantes] = await conn.query(
                'SELECT DISTINCT veiculo_id, placa FROM os_itens WHERE os_id = ?', [destino.id]);
            const placasRestantes = [...new Set(itensRestantes.map(i => String(i.placa || '').trim().toUpperCase()).filter(Boolean))];
            const veiculoIdsRestantes = [...new Set(itensRestantes.map(i => i.veiculo_id).filter(Number.isInteger))];
            let veiculoDescricao = '';
            if (veiculoIdsRestantes.length) {
                const [vs] = await conn.query('SELECT * FROM veiculos WHERE id IN (?)', [veiculoIdsRestantes]);
                veiculoDescricao = vs.map(descricaoVeiculo).filter(Boolean).join(' / ').slice(0, 120);
            }
            await conn.query(
                `UPDATE ordens_servico SET valor_pecas=?, valor_servicos=?, desconto=?, valor_total=?,
                    veiculo_id=?, veiculo_ids=?, placa=?, placas=?, veiculo_descricao=? WHERE id=?`,
                [dinheiro(totais.valor_pecas), dinheiro(totais.valor_servicos), desconto,
                 dinheiro(Number(totais.valor_pecas) + Number(totais.valor_servicos) - desconto),
                 veiculoIdsRestantes[0] || null, veiculoIdsRestantes.join(','),
                 placasRestantes[0] || '', placasRestantes.join(', '), veiculoDescricao, destino.id]);
        }

        for (const foto of origens) {
            await conn.query('INSERT INTO ordens_servico SET ?', foto.ordem);
            for (const item of foto.itens) await conn.query('INSERT INTO os_itens SET ?', item);
        }
        await conn.query('DELETE FROM os_unificacoes WHERE destino_os_id = ?', [destino.id]);
        await conn.commit();
        res.json({ message: `Unificacao desfeita: ${origens.length + 1} registros restaurados`,
            destino_id: Number(destino.id), restauradas: origens.map(f => f.ordem.numero) });
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

async function sincronizarTituloOs(conn, osId, usuario) {
    const [[o]] = await conn.query('SELECT * FROM ordens_servico WHERE id=?', [osId]);
    if (!o || o.status === 'cancelada' || Number(o.valor_total) <= 0) return;
    const imediata = o.status === 'concluida' && !['fiado','boleto',''].includes(o.forma_pagamento || '');
    const data = soData(o.data_realizacao) || soData(o.data_abertura) || iso(agoraNaLoja());
    const vencimento = soData(o.validade_orcamento) || data;
    const [[titulo]] = await conn.query(
        'SELECT * FROM contas_receber WHERE os_id=? OR (os_id IS NULL AND numero_documento=?) ORDER BY id LIMIT 1 FOR UPDATE',
        [o.id, o.numero]);
    const categoria = o.status === 'orcamento' ? 'orcamentos' : 'servicos';
    const descricao = `${o.status === 'orcamento' ? 'Orcamento' : 'Ordem de servico'} ${o.numero}`;
    if (titulo) {
        const jaRecebido = Number(titulo.valor_recebido) > 0 || titulo.status === 'recebida';
        await conn.query(
            `UPDATE contas_receber SET os_id=?, cliente_id=?, cliente_nome=?, descricao=?, data_emissao=?,
                data_vencimento=?, valor_original=?, categoria=?, forma_recebimento=?,
                valor_recebido=?, data_recebimento=?, status=?, usuario_recebimento=? WHERE id=?`,
            [o.id, o.cliente_id, o.cliente_nome, descricao, data, vencimento, o.valor_total,
             categoria, o.forma_pagamento || '', jaRecebido ? titulo.valor_recebido : (imediata ? o.valor_total : 0),
             jaRecebido ? titulo.data_recebimento : (imediata ? data : null),
             jaRecebido || imediata ? 'recebida' : 'pendente',
             jaRecebido ? titulo.usuario_recebimento : (imediata ? usuario : ''), titulo.id]);
        return;
    }
    const [r] = await conn.query(
        `INSERT INTO contas_receber (cliente_id,cliente_nome,descricao,numero_documento,os_id,data_emissao,
            data_vencimento,data_recebimento,valor_original,valor_recebido,categoria,forma_recebimento,status,
            usuario_criacao,usuario_recebimento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [o.cliente_id,o.cliente_nome,descricao,o.numero,o.id,data,vencimento,imediata?data:null,o.valor_total,
         imediata?o.valor_total:0,categoria,o.forma_pagamento||'',imediata?'recebida':'pendente',usuario,imediata?usuario:'']);
    await conn.query('UPDATE contas_receber SET codigo=? WHERE id=?', ['CR'+String(r.insertId).padStart(6,'0'),r.insertId]);
}

app.post('/api/ordens-servico', asyncRota(async (req, res) => {
    const b = req.body;
    const itens = Array.isArray(b.itens) ? b.itens : [];
    if (!itens.length) return erro(res, 400, 'Inclua pelo menos um servico ou peca');
    if (b.status && !STATUS_OS_EDITAVEIS.includes(b.status))
        return erro(res, 400, 'Use as acoes de concluir ou cancelar para esses status');

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        let cliente = null, veiculo = null;
        if (b.cliente_id) {
            const [cs] = await conn.query('SELECT * FROM clientes WHERE id = ?', [b.cliente_id]);
            if (!cs.length) { await conn.rollback(); return erro(res, 404, 'Cliente nao encontrado'); }
            cliente = cs[0];
        }
        const selecaoVeiculos = await resolverVeiculosOs(conn, b, cliente && cliente.id);
        veiculo = selecaoVeiculos.veiculo;
        const motorista = await validarMotoristaDoCliente(conn, b.motorista_id, cliente && cliente.id) || {
            id: null, nome: String(b.motorista_nome || '').trim().slice(0, 160),
            cpf: String(b.motorista_doc || '').trim().slice(0, 20),
            telefone: String(b.motorista_telefone || '').trim().slice(0, 30)
        };

        const preparados = await prepararItensOs(conn, itens, selecaoVeiculos);
        const dataRealizacao = resolverDataRealizacao(b.data_realizacao, iso(agoraNaLoja()));
        const desconto = num(b.desconto);
        const t = totaisOs(preparados, desconto);
        if (desconto < 0 || desconto > t.pecas + t.servicos) { await conn.rollback(); return erro(res, 400, 'Desconto invalido'); }

        /* Numero sequencial proprio (fiscal_config.proximo_numero_os), mesmo
           mecanismo do recibo e da NF-e. O FOR UPDATE serializa duas OS abertas
           ao mesmo tempo. Antes o numero saia do id da tabela, o que expunha o
           id e abria buracos na sequencia a cada rollback. */
        const [[cfgOs]] = await conn.query(
            'SELECT proximo_numero_os FROM fiscal_config WHERE id = 1 FOR UPDATE');
        const sequencial = Number(cfgOs.proximo_numero_os) || 1;
        await conn.query('UPDATE fiscal_config SET proximo_numero_os = ? WHERE id = 1', [sequencial + 1]);
        const numeroOs = 'OS' + String(sequencial).padStart(6, '0');

        const [r] = await conn.query(
            `INSERT INTO ordens_servico (numero, cliente_id, cliente_nome, veiculo_id, veiculo_ids, placa, placas, veiculo_descricao,
                motorista_id, motorista_nome, motorista_doc, motorista_telefone,
                km_entrada, status, reclamacao, diagnostico, observacoes, tecnico,
                valor_pecas, valor_servicos, desconto, valor_total, forma_pagamento, validade_orcamento,
                data_realizacao, usuario)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [numeroOs,
             cliente ? cliente.id : null, cliente ? cliente.nome : (b.cliente_nome || 'Consumidor Final'),
             veiculo ? veiculo.id : null,
             selecaoVeiculos.veiculoIds.join(','),
             veiculo ? veiculo.placa : String(b.placa || '').toUpperCase(),
             selecaoVeiculos.placas.join(', '),
             veiculo ? descricaoVeiculo(veiculo) : (b.veiculo_descricao || ''),
             motorista ? motorista.id : null, motorista ? motorista.nome : '',
             motorista ? motorista.cpf : '', motorista ? motorista.telefone : '',
             Math.max(0, Math.floor(num(b.km_entrada))),
             b.status && STATUS_OS_EDITAVEIS.includes(b.status) ? b.status : 'orcamento',
             b.reclamacao || '', b.diagnostico || '', b.observacoes || '', TECNICO_OS_FIXO,
             t.pecas, t.servicos, desconto, t.total, b.forma_pagamento || '',
             soData(b.validade_orcamento) || null, dataRealizacao, req.usuario.usuario]
        );
        const osId = r.insertId;
        await conn.query(`UPDATE ordens_servico SET ${SQL_SET_TROCA_OLEO} WHERE id = ?`,
            [...valoresTrocaOleo(b, preparados), osId]);
        await gravarItensOs(conn, osId, preparados, numeroOs);
        await sincronizarTituloOs(conn, osId, req.usuario.usuario);

        // km informado na entrada atualiza a ficha do veiculo
        if (veiculo && num(b.km_entrada) > Number(veiculo.km_atual))
            await conn.query('UPDATE veiculos SET km_atual = ? WHERE id = ?',
                [Math.floor(num(b.km_entrada)), veiculo.id]);

        await conn.commit();
        res.status(201).json(await montarOs(osId));
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

app.put('/api/ordens-servico/:id', asyncRota(async (req, res) => {
    const b = req.body;
    const itens = Array.isArray(b.itens) ? b.itens : [];
    if (!itens.length) return erro(res, 400, 'Inclua pelo menos um servico ou peca');

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [os] = await conn.query('SELECT * FROM ordens_servico WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!os.length) { await conn.rollback(); return erro(res, 404, 'Ordem nao encontrada'); }
        if (['concluida', 'cancelada'].includes(os[0].status)) {
            await conn.rollback();
            return erro(res, 409, `Ordem ${os[0].status} nao pode mais ser editada`);
        }

        let cliente = null, veiculo = null;
        if (b.cliente_id) {
            const [cs] = await conn.query('SELECT * FROM clientes WHERE id = ?', [b.cliente_id]);
            if (!cs.length) { await conn.rollback(); return erro(res, 404, 'Cliente nao encontrado'); }
            cliente = cs[0];
        }
        const selecaoVeiculos = await resolverVeiculosOs(conn, b, cliente && cliente.id);
        veiculo = selecaoVeiculos.veiculo;
        const motorista = await validarMotoristaDoCliente(conn, b.motorista_id, cliente && cliente.id) || {
            id: null, nome: String(b.motorista_nome || '').trim().slice(0, 160),
            cpf: String(b.motorista_doc || '').trim().slice(0, 20),
            telefone: String(b.motorista_telefone || '').trim().slice(0, 30)
        };

        const preparados = await prepararItensOs(conn, itens, selecaoVeiculos);
        const dataRealizacao = resolverDataRealizacao(b.data_realizacao, iso(agoraNaLoja()));
        const desconto = num(b.desconto);
        const t = totaisOs(preparados, desconto);
        if (desconto < 0 || desconto > t.pecas + t.servicos) { await conn.rollback(); return erro(res, 400, 'Desconto invalido'); }

        await conn.query(
            `UPDATE ordens_servico SET cliente_id=?, cliente_nome=?, veiculo_id=?, veiculo_ids=?, placa=?, placas=?, veiculo_descricao=?,
                motorista_id=?, motorista_nome=?, motorista_doc=?, motorista_telefone=?,
                km_entrada=?, status=?, reclamacao=?, diagnostico=?, observacoes=?, tecnico=?,
                valor_pecas=?, valor_servicos=?, desconto=?, valor_total=?, forma_pagamento=?,
                validade_orcamento=?, data_realizacao=?
             WHERE id=?`,
            [cliente ? cliente.id : null, cliente ? cliente.nome : (b.cliente_nome || 'Consumidor Final'),
             veiculo ? veiculo.id : null,
             selecaoVeiculos.veiculoIds.join(','),
             veiculo ? veiculo.placa : String(b.placa || '').toUpperCase(),
             selecaoVeiculos.placas.join(', '),
             veiculo ? descricaoVeiculo(veiculo) : (b.veiculo_descricao || ''),
             motorista ? motorista.id : null, motorista ? motorista.nome : '',
             motorista ? motorista.cpf : '', motorista ? motorista.telefone : '',
             Math.max(0, Math.floor(num(b.km_entrada))),
             b.status && STATUS_OS_EDITAVEIS.includes(b.status) ? b.status : os[0].status,
             b.reclamacao || '', b.diagnostico || '', b.observacoes || '', TECNICO_OS_FIXO,
             t.pecas, t.servicos, desconto, t.total, b.forma_pagamento || '',
             soData(b.validade_orcamento) || null, dataRealizacao, req.params.id]
        );
        await conn.query(`UPDATE ordens_servico SET ${SQL_SET_TROCA_OLEO} WHERE id = ?`,
            [...valoresTrocaOleo(b, preparados), req.params.id]);
        await gravarItensOs(conn, req.params.id, preparados, os[0].numero);
        await sincronizarTituloOs(conn, req.params.id, req.usuario.usuario);
        await conn.commit();
        res.json(await montarOs(req.params.id));
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

app.patch('/api/ordens-servico/:id/data', asyncRota(async (req, res) => {
    const dataRealizacao = resolverDataRealizacao(req.body.data_realizacao, iso(agoraNaLoja()));
    const [r] = await pool.query(
        "UPDATE ordens_servico SET data_realizacao=? WHERE id=? AND status <> 'cancelada'",
        [dataRealizacao, req.params.id]
    );
    if (!r.affectedRows) return erro(res, 404, 'Ordem nao encontrada ou cancelada');
    await sincronizarTituloOs(pool, req.params.id, req.usuario.usuario);
    res.json(await montarOs(req.params.id));
}));

app.post('/api/ordens-servico/:id/status', asyncRota(async (req, res) => {
    const status = String(req.body.status || '');
    if (!STATUS_OS_EDITAVEIS.includes(status))
        return erro(res, 400, 'Use /concluir ou /cancelar para esses status');
    const [r] = await pool.query(
        "UPDATE ordens_servico SET status=? WHERE id=? AND status NOT IN ('concluida','cancelada')",
        [status, req.params.id]);
    if (!r.affectedRows) return erro(res, 409, 'Ordem nao encontrada ou ja finalizada');
    await sincronizarTituloOs(pool, req.params.id, req.usuario.usuario);
    res.json(await montarOs(req.params.id));
}));

/* Concluir: baixa o estoque das pecas, fecha a OS e (opcional) gera o titulo
   a receber. O estoque so sai aqui — enquanto e orcamento, nada e reservado. */
app.post('/api/ordens-servico/:id/concluir', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [os] = await conn.query('SELECT * FROM ordens_servico WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!os.length) { await conn.rollback(); return erro(res, 404, 'Ordem nao encontrada'); }
        const o = os[0];
        if (o.status === 'concluida') { await conn.rollback(); return erro(res, 400, 'Ordem ja concluida'); }
        if (o.status === 'cancelada') { await conn.rollback(); return erro(res, 400, 'Ordem cancelada'); }

        const dataRealizacao = resolverDataRealizacao(
            req.body.data_realizacao, iso(agoraNaLoja()));

        const [itens] = await conn.query("SELECT * FROM os_itens WHERE os_id = ? AND tipo='peca'", [req.params.id]);
        for (const it of itens) {
            if (!it.produto_id) continue;
            const [ps] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [it.produto_id]);
            if (!ps.length) continue;
            const p = ps[0];
            const qtd = Number(it.quantidade);
            if (qtd > Number(p.estoque)) {
                await conn.rollback();
                return erro(res, 400, `Estoque insuficiente de "${p.descricao}" (disponivel: ${Number(p.estoque)})`);
            }
            const novo = Number(p.estoque) - qtd;
            await conn.query('UPDATE produtos SET estoque = ? WHERE id = ?', [novo, p.id]);
            await conn.query(
                `INSERT INTO movimentacoes (produto_id, sku, descricao, tipo, quantidade, estoque_apos, motivo, usuario)
                 VALUES (?,?,?,'os',?,?,?,?)`,
                [p.id, p.sku, p.descricao, qtd, novo, `Ordem de servico ${o.numero}`, req.usuario.usuario]);
        }

        await conn.query(
            "UPDATE ordens_servico SET status='concluida', data_conclusao=NOW(), data_realizacao=?, forma_pagamento=? WHERE id=?",
            [dataRealizacao, req.body.forma_pagamento || o.forma_pagamento, req.params.id]);

        await sincronizarTituloOs(conn, req.params.id, req.usuario.usuario);

        await conn.commit();
        res.json(await montarOs(req.params.id));
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    }
    finally { conn.release(); }
}));

app.post('/api/ordens-servico/:id/cancelar', asyncRota(async (req, res) => {
    const [r] = await pool.query(
        "UPDATE ordens_servico SET status='cancelada' WHERE id=? AND status <> 'concluida'", [req.params.id]);
    if (!r.affectedRows) return erro(res, 409, 'Ordem nao encontrada ou ja concluida');
    await pool.query("UPDATE contas_receber SET status='cancelada' WHERE os_id=? AND valor_recebido=0", [req.params.id]);
    res.json(await montarOs(req.params.id));
}));

/* Excluir apaga a ordem de vez. Pode ser usado enquanto ela ainda esta em
   aberto (inclusive orcamento) ou depois de cancelar. Concluida nunca sai,
   porque ja baixou estoque e pode ter gerado titulo a receber. A interface
   explica a diferenca: cancelar preserva o historico; excluir nao. */
app.delete('/api/ordens-servico/:id', asyncRota(async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[o]] = await conn.query(
            'SELECT id, numero, status, venda_id FROM ordens_servico WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!o) { await conn.rollback(); return erro(res, 404, 'Ordem nao encontrada'); }
        if (!podeExcluirOrdem(o.status)) {
            await conn.rollback();
            return erro(res, 409, 'Ordem concluida nao pode ser excluida');
        }
        if (o.venda_id) {
            await conn.rollback();
            return erro(res, 409, 'Ordem vinculada a uma venda - exclua a venda primeiro');
        }
        /* Orcamento/OS aberta pode ter gerado um titulo em contas_receber
           (sincronizarTituloOs, vinculado por os_id). Excluir so a ordem sem
           excluir o titulo deixava um lancamento orfao: o orcamento sumia da
           tela mas o titulo "pendente" continuava aparecendo pra sempre no
           Relatorio Financeiro (secao "em aberto"), mesmo depois de excluido. */
        const [titulosRecebidos] = await conn.query(
            'SELECT id FROM contas_receber WHERE os_id = ? AND valor_recebido > 0', [o.id]);
        if (titulosRecebidos.length) {
            await conn.rollback();
            return erro(res, 409, 'Ordem possui recebimento ja lancado - estorne o recebimento antes de excluir');
        }
        await conn.query('DELETE FROM contas_receber WHERE os_id = ? AND valor_recebido = 0', [o.id]);
        // sem isso o registro de emissao ficaria apontando para uma ordem que
        // nao existe mais e a tela de documentos emitidos abriria link quebrado
        await conn.query(
            "DELETE FROM documentos_emitidos WHERE referencia_tipo = 'os' AND referencia_id = ?", [o.id]);
        // os_itens sai junto pela FK (ON DELETE CASCADE)
        await conn.query('DELETE FROM ordens_servico WHERE id = ?', [o.id]);
        await conn.commit();
        res.json({ message: `Ordem ${o.numero} excluida` });
    } catch (e) {
        await conn.rollback();
        if (e.status) return erro(res, e.status, e.message);
        throw e;
    } finally { conn.release(); }
}));

// ================================================================
// CATEGORIAS — cadastradas em Configuracoes e usadas nos filtros e
// formularios de produtos e servicos. `escopo` = produto | servico.
// ================================================================
const ESCOPOS_CATEGORIA = ['produto', 'servico'];
const nCategoria = (c) => ({ ...c, ativo: !!c.ativo });

app.get('/api/categorias', asyncRota(async (req, res) => {
    const cond = [];
    const params = [];
    if (ESCOPOS_CATEGORIA.includes(req.query.escopo)) { cond.push('escopo = ?'); params.push(req.query.escopo); }
    if (req.query.ativas === '1') cond.push('ativo = 1');
    const [linhas] = await pool.query(
        'SELECT * FROM categorias' + (cond.length ? ' WHERE ' + cond.join(' AND ') : '') +
        ' ORDER BY escopo, nome', params);
    res.json(linhas.map(nCategoria));
}));

app.post('/api/categorias', asyncRota(async (req, res) => {
    const nome = String(req.body.nome || '').trim();
    const escopo = ESCOPOS_CATEGORIA.includes(req.body.escopo) ? req.body.escopo : 'produto';
    if (!nome) return erro(res, 400, 'Informe o nome da categoria');
    if (nome.length > 80) return erro(res, 400, 'Nome muito longo (maximo 80 caracteres)');
    try {
        const [r] = await pool.query(
            'INSERT INTO categorias (escopo, nome, descricao, ativo) VALUES (?,?,?,?)',
            [escopo, nome, String(req.body.descricao || '').trim(), req.body.ativo === false ? 0 : 1]);
        const [[nova]] = await pool.query('SELECT * FROM categorias WHERE id = ?', [r.insertId]);
        res.status(201).json(nCategoria(nova));
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Ja existe uma categoria com esse nome');
        throw e;
    }
}));

app.put('/api/categorias/:id', asyncRota(async (req, res) => {
    const [[atual]] = await pool.query('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    if (!atual) return erro(res, 404, 'Categoria nao encontrada');

    const nome = req.body.nome === undefined ? atual.nome : String(req.body.nome).trim();
    if (!nome) return erro(res, 400, 'Informe o nome da categoria');
    const ativo = req.body.ativo === undefined ? atual.ativo : (req.body.ativo === false ? 0 : 1);
    const descricao = req.body.descricao === undefined ? atual.descricao : String(req.body.descricao).trim();

    try {
        await pool.query('UPDATE categorias SET nome = ?, descricao = ?, ativo = ? WHERE id = ?',
            [nome, descricao, ativo, atual.id]);
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Ja existe uma categoria com esse nome');
        throw e;
    }

    /* Renomear a categoria tem de arrastar quem ja usa ela, senao os produtos
       ficam apontando para um nome que nao existe mais na lista. */
    if (nome !== atual.nome) {
        if (atual.escopo === 'produto')
            await pool.query('UPDATE produtos SET categoria = ? WHERE categoria = ?', [nome, atual.nome]);
        else
            await pool.query('UPDATE servicos SET tipo = ? WHERE tipo = ?', [nome, atual.nome]);
    }

    const [[nova]] = await pool.query('SELECT * FROM categorias WHERE id = ?', [atual.id]);
    res.json(nCategoria(nova));
}));

app.delete('/api/categorias/:id', asyncRota(async (req, res) => {
    const [[c]] = await pool.query('SELECT * FROM categorias WHERE id = ?', [req.params.id]);
    if (!c) return erro(res, 404, 'Categoria nao encontrada');

    // categoria em uso nao some: viraria registro orfao apontando para nada
    const [[uso]] = c.escopo === 'produto'
        ? await pool.query('SELECT COUNT(*) n FROM produtos WHERE categoria = ?', [c.nome])
        : await pool.query('SELECT COUNT(*) n FROM servicos WHERE tipo = ?', [c.nome]);
    if (uso.n > 0) {
        return erro(res, 409, `Categoria em uso por ${uso.n} ${c.escopo === 'produto' ? 'produto(s)' : 'servico(s)'}. ` +
            'Desative-a ou troque a categoria desses registros antes de excluir.');
    }
    await pool.query('DELETE FROM categorias WHERE id = ?', [c.id]);
    res.json({ message: 'Categoria excluida' });
}));

// ================================================================
// BUSCA GLOBAL — a lupa do header procura em tudo que tem numero, nome
// ou codigo: OS, DANFE/NF-e, cliente (CNPJ e razao social), produto,
// veiculo, fornecedor, venda e titulos a pagar/receber.
//
// Cada grupo traz no maximo LIMITE_GRUPO itens: o objetivo e levar a
// pessoa ao registro certo em dois cliques, nao paginar resultado.
// ================================================================
const LIMITE_GRUPO = 6;

/* CPF/CNPJ e guardado com pontuacao em umas telas e sem em outras. Comparar
   so os digitos dos dois lados e o unico jeito de "32204910000182" achar
   "32.204.910/0001-82" — e vice-versa. */
const SO_DIGITOS_SQL = (coluna) => `REGEXP_REPLACE(${coluna}, '[^0-9]', '')`;

app.get('/api/busca', asyncRota(async (req, res) => {
    const termo = String(req.query.q || '').trim();
    if (termo.length < 2) return res.json({ termo, total: 0, grupos: [] });

    const t = '%' + termo + '%';
    const digitos = termo.replace(/\D/g, '');
    // sem digitos no termo, este parametro nao pode casar com nada
    const d = digitos.length >= 3 ? '%' + digitos + '%' : ' nao-casa';
    const L = LIMITE_GRUPO;

    const consultar = (sql, params) => pool.query(sql, params).then(r => r[0]).catch(() => []);

    const [os, notas, clientes, produtos, veiculos, fornecedores, vendas, pagar, receber] = await Promise.all([
        consultar(
            `SELECT id, numero, cliente_nome, placa, placas, veiculo_descricao, status, valor_total,
                    data_abertura, data_realizacao,
                    COALESCE(data_realizacao, DATE(data_conclusao), DATE(data_abertura)) data_atendimento
               FROM ordens_servico
              WHERE numero LIKE ? OR cliente_nome LIKE ? OR placa LIKE ? OR placas LIKE ? OR veiculo_descricao LIKE ?
              ORDER BY data_atendimento DESC, data_abertura DESC LIMIT ?`, [t, t, t, t, t, L]),
        consultar(
            `SELECT id, modelo, serie, numero, chave, cliente_nome, cliente_doc, status, valor_total, data_emissao
               FROM notas_fiscais
              WHERE CAST(numero AS CHAR) LIKE ? OR chave LIKE ? OR cliente_nome LIKE ?
                 OR ${SO_DIGITOS_SQL('cliente_doc')} LIKE ?
              ORDER BY data_emissao DESC LIMIT ?`, [t, t, t, d, L]),
        consultar(
            `SELECT id, nome, cpf_cnpj, telefone, email, cidade, uf
               FROM clientes
              WHERE nome LIKE ? OR email LIKE ? OR telefone LIKE ?
                 OR ${SO_DIGITOS_SQL('cpf_cnpj')} LIKE ?
              ORDER BY nome LIMIT ?`, [t, t, t, d, L]),
        consultar(
            `SELECT id, sku, descricao, marca, categoria, codigo_oem, ncm, estoque, preco_venda
               FROM produtos
              WHERE sku LIKE ? OR descricao LIKE ? OR marca LIKE ? OR codigo_oem LIKE ?
                 OR aplicacao LIKE ? OR ncm LIKE ?
              ORDER BY descricao LIMIT ?`, [t, t, t, t, t, t, L]),
        consultar(
            `SELECT v.id, v.placa, v.marca, v.modelo, v.numero_frota, v.placa_carreta, c.nome cliente_nome
               FROM veiculos v LEFT JOIN clientes c ON c.id = v.cliente_id
              WHERE v.placa LIKE ? OR v.marca LIKE ? OR v.modelo LIKE ?
                 OR v.numero_frota LIKE ? OR v.placa_carreta LIKE ? OR v.chassi LIKE ?
              ORDER BY v.placa LIMIT ?`, [t, t, t, t, t, t, L]),
        consultar(
            `SELECT id, nome, cnpj_cpf, telefone, cidade, uf
               FROM fornecedores
              WHERE nome LIKE ? OR telefone LIKE ? OR ${SO_DIGITOS_SQL('cnpj_cpf')} LIKE ?
              ORDER BY nome LIMIT ?`, [t, t, d, L]),
        consultar(
            `SELECT DISTINCT v.id, v.cliente_nome, v.total, v.data, v.status
               FROM vendas v LEFT JOIN venda_itens i ON i.venda_id = v.id
              WHERE CAST(v.id AS CHAR) LIKE ? OR v.cliente_nome LIKE ?
                 OR i.sku LIKE ? OR i.descricao LIKE ?
              ORDER BY v.data DESC LIMIT ?`, [t, t, t, t, L]),
        consultar(
            `SELECT id, descricao, fornecedor_nome, numero_documento, valor_original, data_vencimento, status
               FROM contas_pagar
              WHERE descricao LIKE ? OR fornecedor_nome LIKE ? OR numero_documento LIKE ?
                 OR ${SO_DIGITOS_SQL('fornecedor_doc')} LIKE ?
              ORDER BY data_vencimento DESC LIMIT ?`, [t, t, t, d, L]),
        consultar(
            `SELECT id, descricao, cliente_nome, numero_documento, valor_original, data_vencimento, status
               FROM contas_receber
              WHERE descricao LIKE ? OR cliente_nome LIKE ? OR numero_documento LIKE ?
              ORDER BY data_vencimento DESC LIMIT ?`, [t, t, t, L])
    ]);

    const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR',
        { style: 'currency', currency: 'BRL' });
    const juntar = (...partes) => partes.filter(Boolean).join(' · ');

    const grupos = [
        { id: 'os', rotulo: 'Ordens de serviço', icone: 'fa-clipboard-list', itens: os.map(o => ({
            titulo: o.numero || `OS #${o.id}`,
            sub: juntar(o.cliente_nome, o.placas || o.placa, o.veiculo_descricao),
            extra: dinheiro(o.valor_total),
            marca: o.status,
            href: `ordens-servico.html?busca=${encodeURIComponent(o.numero || '')}&abrir=${o.id}`
        })) },
        { id: 'nota', rotulo: 'Notas fiscais / DANFE', icone: 'fa-file-invoice', itens: notas.map(n => ({
            titulo: `${n.modelo === 'nfce' ? 'NFC-e' : 'NF-e'} nº ${n.numero} · série ${n.serie}`,
            sub: juntar(n.cliente_nome, n.cliente_doc && relatorios.fmt.documento(n.cliente_doc),
                        n.chave && `chave ${n.chave.slice(0, 12)}…`),
            extra: dinheiro(n.valor_total),
            marca: n.status,
            href: `fiscal.html?busca=${encodeURIComponent(String(n.numero))}&abrir=${n.id}`
        })) },
        { id: 'cliente', rotulo: 'Clientes', icone: 'fa-users', itens: clientes.map(c => ({
            titulo: c.nome,
            sub: juntar(c.cpf_cnpj && relatorios.fmt.documento(c.cpf_cnpj), c.telefone,
                        [c.cidade, c.uf].filter(Boolean).join(' - ')),
            href: `cliente.html?id=${c.id}`
        })) },
        { id: 'produto', rotulo: 'Produtos', icone: 'fa-boxes-stacked', itens: produtos.map(p => ({
            titulo: `${p.sku} — ${p.descricao}`,
            sub: juntar(p.marca, p.categoria, p.codigo_oem && `OEM ${p.codigo_oem}`,
                        p.ncm && `NCM ${p.ncm}`),
            extra: `${Number(p.estoque)} un · ${dinheiro(p.preco_venda)}`,
            href: `produtos.html?busca=${encodeURIComponent(p.sku)}`
        })) },
        { id: 'veiculo', rotulo: 'Frota', icone: 'fa-truck', itens: veiculos.map(v => ({
            titulo: v.placa || `Veículo #${v.id}`,
            sub: juntar([v.marca, v.modelo].filter(Boolean).join(' '), v.cliente_nome,
                        v.numero_frota && `frota ${v.numero_frota}`,
                        v.placa_carreta && `carreta ${v.placa_carreta}`),
            href: `veiculos.html?busca=${encodeURIComponent(v.placa || v.numero_frota || '')}`
        })) },
        { id: 'fornecedor', rotulo: 'Fornecedores', icone: 'fa-building', itens: fornecedores.map(f => ({
            titulo: f.nome,
            sub: juntar(f.cnpj_cpf && relatorios.fmt.documento(f.cnpj_cpf), f.telefone,
                        [f.cidade, f.uf].filter(Boolean).join(' - ')),
            href: `fornecedores.html?busca=${encodeURIComponent(f.nome)}`
        })) },
        { id: 'venda', rotulo: 'Vendas no balcão', icone: 'fa-cash-register', itens: vendas.map(v => ({
            titulo: `Venda #${v.id}`,
            sub: juntar(v.cliente_nome, relatorios.fmt.dataBr(v.data)),
            extra: dinheiro(v.total),
            marca: v.status,
            href: `vendas.html?busca=${encodeURIComponent(String(v.id))}&abrir=${v.id}`
        })) },
        { id: 'pagar', rotulo: 'Contas a pagar', icone: 'fa-file-invoice-dollar', itens: pagar.map(c => ({
            titulo: c.descricao,
            sub: juntar(c.fornecedor_nome, c.numero_documento && `doc ${c.numero_documento}`,
                        `vence ${relatorios.fmt.dataBr(c.data_vencimento)}`),
            extra: dinheiro(c.valor_original),
            marca: c.status,
            href: `contas-pagar.html?busca=${encodeURIComponent(c.descricao)}`
        })) },
        { id: 'receber', rotulo: 'Contas a receber', icone: 'fa-hand-holding-dollar', itens: receber.map(c => ({
            titulo: c.descricao,
            sub: juntar(c.cliente_nome, c.numero_documento && `doc ${c.numero_documento}`,
                        `vence ${relatorios.fmt.dataBr(c.data_vencimento)}`),
            extra: dinheiro(c.valor_original),
            marca: c.status,
            href: `contas-receber.html?busca=${encodeURIComponent(c.descricao)}`
        })) }
    ].filter(g => g.itens.length);

    res.json({ termo, total: grupos.reduce((s, g) => s + g.itens.length, 0), grupos });
}));

// ================================================================
// DOCUMENTOS IMPRESSOS — recibo, orcamento, OS, nota, resumo do cliente
// Todos usam Templates - Relatorios/_template.html via relatorios.js
// ================================================================
async function empresaDoDocumento() {
    const [[cfg]] = await pool.query('SELECT * FROM fiscal_config WHERE id = 1');
    return cfg;
}

function enviarHtml(res, html) {
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
}

/* Adapta a nota do banco isolado do Trevo para o MESMO contexto usado por
   /api/vendas/pedidos/:id/espelho-nfe no ERP. O desenho continua sendo o
   template canônico routes/danfe.html; aqui só existe tradução de campos. */
function renderEspelhoNFeErp(nota, empresa) {
    const fs = require('fs');
    const { renderDanfe, buildDanfeCtx } = require(path.resolve(__dirname, '..', '..', 'routes', 'danfe-renderer'));
    const d = nota.destinatario || {};
    const logoPath = path.join(__dirname, 'public', 'img', 'trevo-logo-print.png');
    const logoDataUri = fs.existsSync(logoPath)
        ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}` : '';

    const pedido = {
        id: nota.id,
        nf: String(nota.numero).padStart(9, '0'),
        serie_nf: nota.serie,
        nfe_chave: nota.chave,
        nfe_protocolo: nota.protocolo,
        natureza_operacao: nota.natureza_operacao,
        data_emissao: nota.data_emissao,
        data_faturamento: nota.data_autorizacao || nota.data_emissao,
        data_autorizacao: nota.data_autorizacao,
        created_at: nota.criado_em,
        // O builder parte do bruto e subtrai desconto para chegar ao vNF.
        valor_total: nota.valor_produtos,
        valor: nota.valor_produtos,
        desconto: nota.valor_desconto,
        total_icms: nota.valor_icms,
        total_ipi: nota.valor_ipi,
        total_pis: nota.valor_pis,
        total_cofins: nota.valor_cofins,
        base_calculo_icms: nota.itens.reduce((s, i) => s + Number(i.base_icms || 0), 0),
        frete: 0, valor_seguro: 0, outras_despesas: 0, tipo_frete: '9',
        condicao_pagamento: 'À vista',
        info_complementar: nota.observacoes || '',
        empresa_razao_social: empresa.razao_social,
        empresa_nome: empresa.nome_fantasia || empresa.razao_social,
        empresa_cnpj: empresa.cnpj,
        empresa_ie: empresa.inscricao_estadual,
        empresa_endereco: [empresa.endereco, empresa.numero].filter(Boolean).join(', '),
        empresa_bairro: empresa.bairro,
        empresa_cidade: empresa.cidade,
        empresa_uf: empresa.uf,
        empresa_cep: empresa.cep,
        empresa_telefone: empresa.telefone,
        empresa_crt: /simples/i.test(String(empresa.regime_tributario || '')) ? 1 : 3,
        cliente_razao_social: d.razao_social || d.nome || nota.cliente_nome,
        cliente_nome: d.nome || nota.cliente_nome,
        cliente_cnpj: String(nota.cliente_doc || '').replace(/\D/g, '').length === 14 ? nota.cliente_doc : '',
        cliente_cpf: String(nota.cliente_doc || '').replace(/\D/g, '').length === 11 ? nota.cliente_doc : '',
        cliente_ie: d.inscricao_estadual || '',
        cliente_endereco: [d.endereco, d.numero, d.complemento].filter(Boolean).join(', '),
        cliente_bairro: d.bairro,
        cliente_cidade: d.cidade,
        cliente_estado: d.uf || nota.cliente_uf,
        cliente_cep: d.cep,
        cliente_telefone: d.telefone || d.celular,
        cliente_email: d.email
    };
    const itens = nota.itens.map(i => ({
        codigo: i.sku || String(i.produto_id || ''), descricao: i.descricao,
        quantidade: i.quantidade, unidade: i.unidade, preco_unitario: i.valor_unitario,
        subtotal: i.valor_total, ncm: i.ncm, cfop: i.cfop, cst: i.cst,
        bc_icms: i.base_icms, icms_value: i.valor_icms, aliquota_icms: i.aliquota_icms,
        valor_ipi: i.valor_ipi, pis_value: i.valor_pis, cofins_value: i.valor_cofins
    }));
    const cfgFiscal = {
        regime_tributario: /simples/i.test(String(empresa.regime_tributario || '')) ? 'simples_nacional' : 'normal',
        crt: /simples/i.test(String(empresa.regime_tributario || '')) ? 1 : 3,
        cfop_venda_estado: empresa.cfop_dentro_uf,
        icms_padrao: Number(empresa.aliquota_icms || 0),
        pis_padrao: Number(empresa.aliquota_pis || 0),
        cofins_padrao: Number(empresa.aliquota_cofins || 0), ipi_padrao: 0
    };
    const preview = !(nota.status === 'autorizada' && nota.protocolo && String(nota.chave || '').length === 44);
    const ctx = buildDanfeCtx(pedido, itens, { preview, cfgFiscal, logoDataUri });
    if (!/produ/i.test(String(nota.ambiente || ''))) {
        ctx.marcaAguaClasse = 'watermark-logo';
        ctx.marcaAguaTexto = 'SEM VALOR FISCAL — HOMOLOGAÇÃO';
        ctx.avisoTopo = 'NF-e AUTORIZADA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL';
    }
    // O botão Fechar do template volta ao Faturamento do ERP; no Trevo volta à tela Fiscal.
    return renderDanfe(ctx).split('/Faturamento/index.html').join('/fiscal.html');
}

// ?download=1 faz o documento abrir ja no dialogo de "Salvar como PDF"
const querDownload = (req) => req.query.download === '1';

/* Registra a emissao em documentos_emitidos — e o que faz a OS "ficar salva":
   o resumo do cliente mostra desde quando o documento existe e quem tirou.
   So a PRIMEIRA emissao de cada tipo por ordem entra; reimprimir o mesmo papel
   nao pode virar uma linha nova a cada clique. */
async function registrarDocumento({ tipo, numero, referenciaTipo, referenciaId, clienteNome, valor, usuario }) {
    const [ja] = await pool.query(
        'SELECT id FROM documentos_emitidos WHERE tipo = ? AND referencia_tipo = ? AND referencia_id = ? LIMIT 1',
        [tipo, referenciaTipo, referenciaId]);
    if (ja.length) return;
    await pool.query(
        `INSERT INTO documentos_emitidos (tipo, numero, referencia_tipo, referencia_id, cliente_nome, valor, usuario)
         VALUES (?,?,?,?,?,?,?)`,
        [tipo, numero || '', referenciaTipo, referenciaId, clienteNome || '', valor || 0, usuario || '']);
}

/* ?itens=12,15 e ?placa=ABC1D23 recortam o que vai para o papel; sem nenhum
   dos dois sai a ordem inteira, agrupada por placa quando a frota tem mais
   de uma. Ver recortarOsParaDocumento. */
app.get('/api/documentos/os/:id', asyncRota(async (req, res) => {
    const ordem = await montarOs(req.params.id);
    if (!ordem) return erro(res, 404, 'Ordem nao encontrada');
    const os = recortarOsParaDocumento(ordem, req.query);
    if (!os) return erro(res, 404, 'A selecao pedida nao tem nenhum item desta ordem');
    const empresa = await empresaDoDocumento();
    await registrarDocumento({
        tipo: 'os', numero: ordem.numero, referenciaTipo: 'os', referenciaId: ordem.id,
        clienteNome: ordem.cliente_nome, valor: ordem.valor_total, usuario: req.usuario.usuario
    });
    enviarHtml(res, relatorios.renderRelatorio({
        titulo: 'Ordem de Serviço',
        subtitulo: os.placa_recorte
            ? `Placa ${os.placa_recorte}${os.veiculo_descricao ? ' · ' + os.veiculo_descricao : ''}`
            : (os.veiculo_descricao || os.cliente_nome),
        referencia: `Nº ${os.numero}`,
        campos: [
            ['Abertura', relatorios.fmt.dataBr(os.data_abertura, true)],
            os.data_realizacao
                ? ['Data do serviço', relatorios.fmt.dataBr(os.data_realizacao)]
                : null,
            ['Situação', os.status],
            os.tecnico ? ['Técnico', relatorios.fmt.esc(os.tecnico)] : null,
            !os.data_realizacao && os.data_conclusao
                ? ['Data do serviço', relatorios.fmt.dataBr(os.data_conclusao)]
                : null
        ],
        corpo: relatorios.corpos.corpoOrdemServico(os, { compacto: true }),
        empresa,
        /* ?ficha=branco sai com as linhas para a oficina preencher a caneta;
           sem o parametro sai o que esta gravado (o histórico que controla a
           proxima troca). Na tela da OS os dois botoes estao lado a lado. */
        // mesma regra do bloco no papel: OS antiga (anterior a coluna
        // exige_ficha_oleo) tambem precisa do botao se ja tem dados na ficha
        comFicha: temFichaOleo(os),
        fichaEmBranco: req.query.ficha === 'branco',
        autoImprimir: querDownload(req),
        // 2 vias na MESMA folha: corta no meio, uma fica com o cliente e a
        // outra com a oficina — sem gastar duas paginas por OS
        vias: ['1ª via — Oficina', '2ª via — Cliente'],
        viasNaMesmaFolha: true
    }));
}));

// mesmo recorte da OS: o orcamento da frota sai inteiro, por placa ou por item
app.get('/api/documentos/orcamento/:id', asyncRota(async (req, res) => {
    const ordem = await montarOs(req.params.id);
    if (!ordem) return erro(res, 404, 'Ordem nao encontrada');
    const os = recortarOsParaDocumento(ordem, req.query);
    if (!os) return erro(res, 404, 'A selecao pedida nao tem nenhum item desta ordem');
    const empresa = await empresaDoDocumento();
    await registrarDocumento({
        tipo: 'orcamento', numero: ordem.numero, referenciaTipo: 'os', referenciaId: ordem.id,
        clienteNome: ordem.cliente_nome, valor: ordem.valor_total, usuario: req.usuario.usuario
    });
    enviarHtml(res, relatorios.renderRelatorio({
        titulo: 'Orçamento',
        subtitulo: os.placa_recorte
            ? `Placa ${os.placa_recorte}${os.veiculo_descricao ? ' · ' + os.veiculo_descricao : ''}`
            : (os.veiculo_descricao || os.cliente_nome),
        referencia: `Nº ${os.numero}`,
        campos: [
            ['Data', relatorios.fmt.dataBr(os.data_realizacao || os.data_abertura)],
            ['Cliente', relatorios.fmt.esc(os.cliente_nome)]
        ],
        corpo: relatorios.corpos.corpoOrdemServico(os, { orcamento: true, compacto: true }),
        empresa,
        autoImprimir: querDownload(req),
        // O orçamento acompanha a mesma operação da OS: uma via é entregue ao
        // cliente e a segunda fica na oficina para aceite e conferência.
        vias: ['1ª via — Cliente', '2ª via — Oficina'],
        viasNaMesmaFolha: true
    }));
}));

/* DANFE no layout oficial. `?resumo=1` devolve a versao simplificada (util para
   conferencia rapida na tela); sem o parametro sai o DANFE completo, que e o
   documento a ser entregue junto com a mercadoria. */
app.get('/api/documentos/nota/:id', asyncRota(async (req, res) => {
    const nota = await montarNota(req.params.id);
    if (!nota) return erro(res, 404, 'Nota nao encontrada');
    const empresa = await empresaDoDocumento();
    const resumido = req.query.resumo === '1';

    if (!resumido && nota.modelo !== 'nfse') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        return enviarHtml(res, renderEspelhoNFeErp(nota, empresa));
    }

    enviarHtml(res, relatorios.renderRelatorio({
        titulo: nota.modelo === 'nfse' ? 'NFS-e' : (nota.modelo === 'nfce' ? 'NFC-e' : 'DANFE'),
        subtitulo: nota.modelo === 'nfse'
            ? 'Nota Fiscal de Serviço'
            : (resumido ? nota.cliente_nome : 'Documento Auxiliar da Nota Fiscal Eletrônica'),
        referencia: `Nº ${String(nota.numero).padStart(9, '0')} • Série ${nota.serie}`,
        campos: [
            ['Emissão', relatorios.fmt.dataBr(nota.data_emissao, true)],
            ['Situação', nota.status],
            ['Ambiente', nota.ambiente]
        ],
        corpo: resumido
            ? relatorios.corpos.corpoNotaFiscal(nota)
            : relatorios.corpos.corpoDanfe(nota, empresa),
        empresa,
        classeCorpo: resumido ? '' : 'danfe-document',
        autoImprimir: querDownload(req)
    }));
}));

app.get('/api/documentos/venda/:id', asyncRota(async (req, res) => {
    const venda = await montarVenda(req.params.id);
    if (!venda) return erro(res, 404, 'Venda nao encontrada');
    const empresa = await empresaDoDocumento();
    enviarHtml(res, relatorios.renderRelatorio({
        titulo: 'Comprovante de Venda',
        subtitulo: venda.cliente_nome,
        referencia: `Venda #${venda.id}`,
        campos: [['Data', relatorios.fmt.dataBr(venda.data, true)], ['Situação', venda.status]],
        corpo: relatorios.corpos.corpoVenda(venda),
        empresa,
        autoImprimir: querDownload(req)
    }));
}));

app.get('/api/documentos/cliente/:id', asyncRota(async (req, res) => {
    const periodo = resolverPeriodo(req.query);
    // mesma funcao que alimenta a tela de resumo — nunca divergem
    const resposta = await resumoCliente(req.params.id, periodo);
    if (!resposta) return erro(res, 404, 'Cliente nao encontrado');
    const empresa = await empresaDoDocumento();
    enviarHtml(res, relatorios.renderRelatorio({
        // o titulo diz o recorte: "Ficha Mensal" nao pode sair igual a ficha completa
        titulo: periodo.de ? 'Ficha do Cliente — Período' : 'Ficha do Cliente',
        subtitulo: resposta.cliente.nome,
        referencia: resposta.cliente.cpf_cnpj ? relatorios.fmt.documento(resposta.cliente.cpf_cnpj) : '',
        campos: [
            ['Período', periodo.rotulo],
            ['Ordens de serviço', String(resposta.total_os)],
            ['Último atendimento', relatorios.fmt.dataBr(resposta.ultimo_atendimento)]
        ],
        corpo: relatorios.corpos.corpoResumoCliente(resposta.cliente, resposta),
        empresa,
        autoImprimir: querDownload(req)
    }));
}));

/* Recibo: origem = os | receber | venda. O numero e sequencial proprio
   (fiscal_config.proximo_numero_recibo) e fica registrado em documentos_emitidos. */
app.get('/api/documentos/recibo', asyncRota(async (req, res) => {
    const origem = String(req.query.origem || '');
    const id = Number(req.query.id);
    if (!['os', 'receber', 'venda'].includes(origem)) return erro(res, 400, 'Origem invalida');

    let pagador = '', pagadorDoc = '', valor = 0, referente = '', forma = '', operacao = {};
    let dataRecibo = new Date();
    if (origem === 'os') {
        const os = await montarOs(id);
        if (!os) return erro(res, 404, 'Ordem nao encontrada');
        if (os.status !== 'concluida') return erro(res, 400, 'Conclua a ordem antes de emitir o recibo');
        pagador = os.cliente_nome; pagadorDoc = os.cliente_doc; valor = os.valor_total;
        referente = `serviços e produtos da ordem de serviço ${os.numero}`;
        forma = os.forma_pagamento;
        operacao = os;
        dataRecibo = os.data_realizacao || os.data_conclusao || dataRecibo;
    } else if (origem === 'receber') {
        const [[c]] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [id]);
        if (!c) return erro(res, 404, 'Titulo nao encontrado');
        pagador = c.cliente_nome; pagadorDoc = c.cliente_doc;
        valor = Number(c.valor_recebido) > 0 ? Number(c.valor_recebido) : Number(c.valor_original);
        referente = c.descricao; forma = c.forma_recebimento;
        dataRecibo = c.data_recebimento || c.data_pagamento || c.data_emissao || dataRecibo;
    } else {
        const venda = await montarVenda(id);
        if (!venda) return erro(res, 404, 'Venda nao encontrada');
        pagador = venda.cliente_nome; valor = venda.total;
        referente = `compra de produtos — venda #${venda.id}`; forma = venda.forma_pagamento;
        operacao = venda;
        dataRecibo = venda.data || dataRecibo;
    }
    if (req.query.valor) valor = num(req.query.valor);

    const empresa = await empresaDoDocumento();
    const conn = await pool.getConnection();
    let numero;
    try {
        await conn.beginTransaction();
        const [jaEmitidos] = await conn.query(
            `SELECT numero FROM documentos_emitidos
              WHERE tipo='recibo' AND referencia_tipo=? AND referencia_id=?
              ORDER BY id DESC LIMIT 1 FOR UPDATE`, [origem, id]);
        if (jaEmitidos.length) {
            numero = Number(String(jaEmitidos[0].numero || '').replace(/\D/g, ''));
            await conn.rollback();
        } else {
        const [[cfg]] = await conn.query('SELECT proximo_numero_recibo FROM fiscal_config WHERE id = 1 FOR UPDATE');
        numero = cfg.proximo_numero_recibo;
        await conn.query('UPDATE fiscal_config SET proximo_numero_recibo = ? WHERE id = 1', [numero + 1]);
        await conn.query(
            `INSERT INTO documentos_emitidos (tipo, numero, referencia_tipo, referencia_id, cliente_nome, valor, usuario)
             VALUES ('recibo',?,?,?,?,?,?)`,
            ['REC' + String(numero).padStart(6, '0'), origem, id, pagador, valor, req.usuario.usuario]);
        await conn.commit();
        }
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }

    enviarHtml(res, relatorios.renderRelatorio({
        titulo: 'Recibo',
        subtitulo: 'Comprovante de pagamento',
        referencia: `Nº REC${String(numero).padStart(6, '0')}`,
        campos: [['Emissão', relatorios.fmt.dataBr(dataRecibo)], ['Valor', relatorios.fmt.moeda(valor)]],
        corpo: relatorios.corpos.corpoRecibo({
            valor, pagador, pagadorDoc, referente, formaPagamento: forma,
            motoristaNome: operacao.motorista_nome, motoristaDoc: operacao.motorista_doc,
            motoristaTelefone: operacao.motorista_telefone, placa: operacao.placa,
            veiculoDescricao: operacao.veiculo_descricao,
            cidade: empresa.cidade, data: dataRecibo
        }),
        empresa,
        autoImprimir: querDownload(req)
    }));
}));

/* Catalogo de pecas em PDF (o navegador imprime a pagina).
   Filtros: categoria, marca, so com estoque, faixa de preco.       */
app.get('/api/documentos/catalogo', asyncRota(async (req, res) => {
    const cond = ['ativo = 1'];
    const params = [];
    if (req.query.categoria) { cond.push('categoria = ?'); params.push(req.query.categoria); }
    if (req.query.marca) { cond.push('marca = ?'); params.push(req.query.marca); }
    if (req.query.com_estoque === '1') cond.push('estoque > 0');
    if (req.query.preco_min) { cond.push('preco_venda >= ?'); params.push(num(req.query.preco_min)); }
    if (req.query.preco_max) { cond.push('preco_venda <= ?'); params.push(num(req.query.preco_max)); }
    if (req.query.busca) {
        cond.push('(sku LIKE ? OR descricao LIKE ? OR marca LIKE ? OR aplicacao LIKE ? OR codigo_oem LIKE ?)');
        const t = '%' + req.query.busca + '%';
        params.push(t, t, t, t, t);
    }

    const [produtos] = await pool.query(
        'SELECT * FROM produtos WHERE ' + cond.join(' AND ') + ' ORDER BY categoria, descricao LIMIT 2000', params);
    if (!produtos.length) return erro(res, 404, 'Nenhuma peca atende aos filtros escolhidos');

    const empresa = await empresaDoDocumento();
    const filtrosAplicados = [
        req.query.categoria ? `Categoria: ${req.query.categoria}` : null,
        req.query.marca ? `Marca: ${req.query.marca}` : null,
        req.query.com_estoque === '1' ? 'Somente itens em estoque' : null,
        req.query.busca ? `Busca: ${req.query.busca}` : null
    ].filter(Boolean);

    await pool.query(
        `INSERT INTO documentos_emitidos (tipo, numero, referencia_tipo, cliente_nome, valor, usuario)
         VALUES ('catalogo','', 'produtos', ?, 0, ?)`,
        [`${produtos.length} item(ns)`, req.usuario.usuario]);

    enviarHtml(res, relatorios.renderRelatorio({
        titulo: 'Catálogo de Produtos',
        subtitulo: filtrosAplicados.join(' • ') || 'Catálogo completo',
        referencia: `${produtos.length} item(ns)`,
        campos: [
            ['Emissão', relatorios.fmt.dataBr(new Date())],
            ['Validade dos preços', relatorios.fmt.dataBr(new Date(Date.now() + 30 * 86400000))]
        ],
        corpo: relatorios.corpos.corpoCatalogo(produtos.map(nProd), {
            mostrarEstoque: req.query.mostrar_estoque === '1',
            observacao: req.query.observacao || ''
        }),
        empresa,
        autoImprimir: querDownload(req)
    }));
}));

app.get('/api/documentos/emitidos', asyncRota(async (req, res) => {
    const [linhas] = await pool.query(
        'SELECT * FROM documentos_emitidos ORDER BY id DESC LIMIT 200');
    res.json(linhas.map(d => ({ ...d, valor: Number(d.valor) })));
}));

// ================================================================
// CONFIGURACOES DO SISTEMA — usuarios e informacoes
// (sem modulo de RH: aqui usuario e so acesso ao sistema)
// ================================================================
const nUsuario = (u) => ({ usuario: u.usuario, nome: u.nome, ativo: !!u.ativo, criado_em: u.criado_em });

app.get('/api/usuarios', asyncRota(async (req, res) => {
    const [linhas] = await pool.query(
        'SELECT usuario, nome, ativo, criado_em FROM usuarios ORDER BY nome');
    res.json(linhas.map(nUsuario));
}));

app.post('/api/usuarios', asyncRota(async (req, res) => {
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const nome = String(req.body.nome || '').trim();
    const senha = String(req.body.senha || '');
    if (!usuario) return erro(res, 400, 'Informe o usuario (e-mail de acesso)');
    if (!nome) return erro(res, 400, 'Informe o nome');
    if (senha.length < 4) return erro(res, 400, 'A senha precisa ter pelo menos 4 caracteres');
    try {
        await pool.query('INSERT INTO usuarios (usuario, nome, senha_hash, ativo) VALUES (?,?,?,?)',
            [usuario, nome, bcrypt.hashSync(senha, 10), req.body.ativo === false ? 0 : 1]);
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'Ja existe um usuario com esse acesso');
        throw e;
    }
    const [[novo]] = await pool.query('SELECT usuario, nome, ativo, criado_em FROM usuarios WHERE usuario = ?', [usuario]);
    res.status(201).json(nUsuario(novo));
}));

app.put('/api/usuarios/:usuario', asyncRota(async (req, res) => {
    const alvo = String(req.params.usuario || '').toLowerCase();
    const nome = String(req.body.nome || '').trim();
    if (!nome) return erro(res, 400, 'Informe o nome');

    // trava de seguranca: ninguem consegue se auto-desativar e travar o proprio acesso
    const ativo = req.body.ativo === false ? 0 : 1;
    if (!ativo && alvo === req.usuario.usuario.toLowerCase())
        return erro(res, 400, 'Voce nao pode desativar o proprio acesso');
    if (!ativo) {
        const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM usuarios WHERE ativo = 1');
        if (n <= 1) return erro(res, 400, 'O sistema precisa de pelo menos um usuario ativo');
    }

    const [r] = await pool.query('UPDATE usuarios SET nome = ?, ativo = ? WHERE usuario = ?', [nome, ativo, alvo]);
    if (!r.affectedRows) return erro(res, 404, 'Usuario nao encontrado');
    if (!ativo) await pool.query('DELETE FROM sessoes WHERE usuario = ?', [alvo]); // derruba a sessao aberta
    const [[u]] = await pool.query('SELECT usuario, nome, ativo, criado_em FROM usuarios WHERE usuario = ?', [alvo]);
    res.json(nUsuario(u));
}));

// redefinicao de senha pelo administrador (a troca da propria senha e /alterar-senha)
app.post('/api/usuarios/:usuario/senha', asyncRota(async (req, res) => {
    const senha = String(req.body.senha || '');
    if (senha.length < 4) return erro(res, 400, 'A senha precisa ter pelo menos 4 caracteres');
    const alvo = String(req.params.usuario || '').toLowerCase();
    const [r] = await pool.query('UPDATE usuarios SET senha_hash = ? WHERE usuario = ?',
        [bcrypt.hashSync(senha, 10), alvo]);
    if (!r.affectedRows) return erro(res, 404, 'Usuario nao encontrado');
    if (alvo !== req.usuario.usuario.toLowerCase())
        await pool.query('DELETE FROM sessoes WHERE usuario = ?', [alvo]);
    res.json({ message: 'Senha redefinida' });
}));

app.delete('/api/usuarios/:usuario', asyncRota(async (req, res) => {
    const alvo = String(req.params.usuario || '').toLowerCase();
    if (alvo === req.usuario.usuario.toLowerCase()) return erro(res, 400, 'Voce nao pode excluir o proprio acesso');
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM usuarios');
    if (n <= 1) return erro(res, 400, 'O sistema precisa de pelo menos um usuario');
    const [r] = await pool.query('DELETE FROM usuarios WHERE usuario = ?', [alvo]);
    if (!r.affectedRows) return erro(res, 404, 'Usuario nao encontrado');
    await pool.query('DELETE FROM sessoes WHERE usuario = ?', [alvo]);
    res.json({ message: 'Usuario excluido' });
}));

app.get('/api/sistema/info', asyncRota(async (req, res) => {
    const [[c]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM produtos) produtos,
                (SELECT COUNT(*) FROM clientes) clientes,
                (SELECT COUNT(*) FROM servicos) servicos,
                (SELECT COUNT(*) FROM vendas) vendas,
                (SELECT COUNT(*) FROM ordens_servico) ordens,
                (SELECT COUNT(*) FROM notas_fiscais) notas,
                (SELECT COUNT(*) FROM usuarios WHERE ativo=1) usuarios,
                (SELECT COUNT(*) FROM produtos WHERE ativo=1 AND (ncm='' OR ncm IS NULL)) sem_ncm`);
    const [[cfg]] = await pool.query('SELECT cnpj, razao_social, ambiente, regime_tributario FROM fiscal_config WHERE id = 1');
    const [[banco]] = await pool.query('SELECT DATABASE() nome, VERSION() versao');

    // checklist do que ainda falta para o sistema estar pronto para o dia a dia
    const pendencias = [];
    if (!String(cfg.cnpj || '').replace(/\D/g, '')) pendencias.push('CNPJ da empresa nao configurado');
    if (!String(cfg.razao_social || '').trim()) pendencias.push('Razao social nao preenchida');
    if (cfg.ambiente === 'homologacao') pendencias.push('Ambiente fiscal em homologacao (documentos de teste)');
    if (c.sem_ncm > 0) pendencias.push(`${c.sem_ncm} produto(s) sem NCM cadastrado`);
    if (c.servicos === 0) pendencias.push('Nenhum servico no catalogo da oficina');

    res.json({
        versao: '2.0',
        porta: PORTA,
        node: process.version,
        banco: { nome: banco.nome, versao: banco.versao },
        empresa: { cnpj: cfg.cnpj, razao_social: cfg.razao_social,
                   ambiente: cfg.ambiente, regime: cfg.regime_tributario },
        contagens: c,
        pendencias,
        uptime_horas: Number((process.uptime() / 3600).toFixed(1))
    });
}));

/* Busca periodica das notas na SEFAZ. Roda so quando `sefaz_auto` esta ligado
   e o certificado existe; qualquer erro e registrado na propria configuracao
   (sefaz_ultimo_retorno) para aparecer na tela, sem derrubar o processo.
   A cada volta a configuracao e relida, entao ligar/desligar ou mudar o
   intervalo pela tela vale na proxima execucao — sem reiniciar o PM2. */
let timerSefaz = null;

async function rodadaSefaz() {
    try {
        const cfg = await configFiscal();
        if (!cfg.sefaz_auto || !cfg.sefaz_certificado || !cfg.cnpj) return;

        const r = await sincronizarSefaz({ usuario: 'sefaz-automatico' });
        if (r.titulos_criados > 0) {
            console.log(`[TREVO][SEFAZ] ${r.titulos_criados} titulo(s) novo(s) importado(s) ` +
                        `de ${r.notas_encontradas} nota(s)`);
        }
    } catch (e) {
        console.error('[TREVO][SEFAZ] falha na busca automatica:', e.message);
        try {
            await pool.query(
                `UPDATE fiscal_config SET sefaz_ultima_sincronia = NOW(), sefaz_ultimo_retorno = ? WHERE id = 1`,
                [('ERRO: ' + e.message).slice(0, 255)]);
        } catch (_) { /* se nem o banco responde, o log acima ja registrou */ }
    }
}

async function agendarSefaz() {
    if (timerSefaz) clearInterval(timerSefaz);
    let minutos = 60;
    try {
        const cfg = await configFiscal();
        minutos = Math.max(15, Number(cfg.sefaz_intervalo_min) || 60);
        if (cfg.sefaz_auto && cfg.sefaz_certificado) {
            console.log(`[TREVO][SEFAZ] busca automatica ligada — a cada ${minutos} min`);
            setTimeout(rodadaSefaz, 60000);   // primeira volta 1 min apos subir
        }
    } catch (e) { /* schema ainda subindo: o intervalo padrao resolve */ }
    timerSefaz = setInterval(rodadaSefaz, minutos * 60000);
    timerSefaz.unref?.();
}

/* Busca periodica de NFS-e e CT-e recebidos. Mesmo desenho da rodada da SEFAZ.

   Os pisos de intervalo sao diferentes de proposito: o ADN da NFS-e responde
   HTTP 429 com facilidade (medido), e a distribuicao de CT-e herda a rejeicao
   656 "consumo indevido" da SEFAZ, que trava por 1 hora quando a consulta nao
   encontra documentos. Bater de 15 em 15 minutos so garante ficar bloqueado. */
const timersRecebimento = { nfse: null, cte: null };
const PISO_INTERVALO = { nfse: 60, cte: 60 };

async function rodadaRecebimento(fonte) {
    try {
        const cfg = await configFiscal();
        const ligado = fonte === 'nfse' ? cfg.nfse_auto : cfg.cte_auto;
        if (!ligado || !cfg.sefaz_certificado || !cfg.cnpj) return;

        const r = await sincronizarRecebidos({ fonte, usuario: `${fonte}-automatico` });
        if (r.novos > 0) {
            console.log(`[TREVO][${fonte.toUpperCase()}] ${r.novos} documento(s) novo(s) · ` +
                        `${r.titulos_criados} titulo(s) criado(s) · ${r.como_prestador} emitido(s) pelo Trevo`);
        }
        if (r.limitado) console.warn(`[TREVO][${fonte.toUpperCase()}] rate limit do ambiente — continua na proxima rodada`);
    } catch (e) {
        console.error(`[TREVO][${fonte.toUpperCase()}] falha na busca automatica:`, e.message);
        const coluna = fonte === 'nfse' ? 'nfse' : 'cte';
        try {
            await pool.query(
                `UPDATE fiscal_config SET ${coluna}_ultima_sincronia = NOW(), ${coluna}_ultimo_retorno = ? WHERE id = 1`,
                [('ERRO: ' + e.message).slice(0, 255)]);
        } catch (_) { /* se nem o banco responde, o log acima ja registrou */ }
    }
}

async function agendarRecebimento() {
    for (const fonte of ['nfse', 'cte']) {
        if (timersRecebimento[fonte]) clearInterval(timersRecebimento[fonte]);
        let minutos = fonte === 'nfse' ? 180 : 120;
        try {
            const cfg = await configFiscal();
            const configurado = Number(fonte === 'nfse' ? cfg.nfse_intervalo_min : cfg.cte_intervalo_min);
            minutos = Math.max(PISO_INTERVALO[fonte], configurado || minutos);
            const ligado = fonte === 'nfse' ? cfg.nfse_auto : cfg.cte_auto;
            if (ligado && cfg.sefaz_certificado) {
                console.log(`[TREVO][${fonte.toUpperCase()}] busca automatica ligada — a cada ${minutos} min`);
                // escalonado para nao disparar as tres buscas no mesmo minuto
                setTimeout(() => rodadaRecebimento(fonte), fonte === 'nfse' ? 120000 : 180000);
            }
        } catch (e) { /* schema ainda subindo: o intervalo padrao resolve */ }
        timersRecebimento[fonte] = setInterval(() => rodadaRecebimento(fonte), minutos * 60000);
        timersRecebimento[fonte].unref?.();
    }
}

// ================================================================
// CENTRAL DE NOTIFICACOES
//
// O gerador varre o sistema e cria avisos do que exige acao: conta vencendo,
// conta vencida, titulo a receber atrasado, produto zerado ou abaixo do
// minimo, orcamento vencendo, venda sem documento fiscal.
//
// A `chave` de cada aviso inclui a data de referencia, entao o mesmo problema
// nao vira dois avisos no mesmo dia — mas volta a avisar no dia seguinte se
// continuar sem resolucao.
// ================================================================
async function criarNotificacao({ chave, tipo, nivel = 'info', titulo, mensagem = '', link = '', valor = 0 }) {
    // INSERT IGNORE + indice unico: a repeticao morre no banco, sem SELECT antes
    const [r] = await pool.query(
        `INSERT IGNORE INTO notificacoes (chave, tipo, nivel, titulo, mensagem, link, valor)
         VALUES (?,?,?,?,?,?,?)`,
        [chave.slice(0, 120), tipo, nivel, titulo.slice(0, 120), mensagem.slice(0, 400), link, valor]);
    return r.affectedRows > 0;
}

async function gerarNotificacoes() {
    const hoje = new Date().toISOString().slice(0, 10);
    let criadas = 0;
    const marcar = (ok) => { if (ok) criadas++; };

    // ---- contas a pagar vencidas
    const [pagarVencidas] = await pool.query(
        `SELECT codigo, fornecedor_nome, data_vencimento, DATEDIFF(CURDATE(), data_vencimento) dias,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_pago) saldo
         FROM contas_pagar
         WHERE status NOT IN ('paga','cancelada') AND data_vencimento < CURDATE()
         ORDER BY data_vencimento LIMIT 20`);
    for (const c of pagarVencidas) {
        marcar(await criarNotificacao({
            chave: `pagar-vencida:${c.codigo}:${hoje}`, tipo: 'contas_pagar', nivel: 'erro',
            titulo: `Conta vencida — ${c.fornecedor_nome}`,
            mensagem: `${c.codigo} venceu há ${c.dias} dia(s). Saldo de ${moedaTexto(c.saldo)}.`,
            link: 'contas-pagar.html', valor: Number(c.saldo)
        }));
    }

    // ---- contas a pagar vencendo nos proximos 3 dias
    const [pagarVencendo] = await pool.query(
        `SELECT codigo, fornecedor_nome, data_vencimento, DATEDIFF(data_vencimento, CURDATE()) dias,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_pago) saldo
         FROM contas_pagar
         WHERE status NOT IN ('paga','cancelada')
           AND data_vencimento BETWEEN CURDATE() AND CURDATE() + INTERVAL 3 DAY
         ORDER BY data_vencimento LIMIT 20`);
    for (const c of pagarVencendo) {
        const quando = c.dias === 0 ? 'vence hoje' : `vence em ${c.dias} dia(s)`;
        marcar(await criarNotificacao({
            chave: `pagar-vencendo:${c.codigo}:${hoje}`, tipo: 'contas_pagar',
            nivel: c.dias === 0 ? 'alerta' : 'info',
            titulo: `Conta a pagar ${quando}`,
            mensagem: `${c.fornecedor_nome} — ${moedaTexto(c.saldo)} (${c.codigo}).`,
            link: 'contas-pagar.html', valor: Number(c.saldo)
        }));
    }

    // ---- titulos a receber vencidos
    const [receberVencidos] = await pool.query(
        `SELECT codigo, cliente_nome, DATEDIFF(CURDATE(), data_vencimento) dias,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido) saldo
         FROM contas_receber
         WHERE status NOT IN ('recebida','cancelada') AND data_vencimento < CURDATE()
         ORDER BY data_vencimento LIMIT 20`);
    for (const c of receberVencidos) {
        marcar(await criarNotificacao({
            chave: `receber-vencido:${c.codigo}:${hoje}`, tipo: 'contas_receber', nivel: 'alerta',
            titulo: `Recebimento atrasado — ${c.cliente_nome}`,
            mensagem: `${c.codigo} está ${c.dias} dia(s) em atraso. ${moedaTexto(c.saldo)} a receber.`,
            link: 'contas-receber.html', valor: Number(c.saldo)
        }));
    }

    // ---- titulos a receber vencendo hoje
    const [receberHoje] = await pool.query(
        `SELECT codigo, cliente_nome,
                (valor_original + valor_juros + valor_multa - valor_desconto - valor_recebido) saldo
         FROM contas_receber
         WHERE status NOT IN ('recebida','cancelada') AND data_vencimento = CURDATE() LIMIT 20`);
    for (const c of receberHoje) {
        marcar(await criarNotificacao({
            chave: `receber-hoje:${c.codigo}:${hoje}`, tipo: 'contas_receber', nivel: 'info',
            titulo: `Recebimento vence hoje — ${c.cliente_nome}`,
            mensagem: `${moedaTexto(c.saldo)} (${c.codigo}).`,
            link: 'contas-receber.html', valor: Number(c.saldo)
        }));
    }

    // ---- produtos zerados e abaixo do minimo
    const [zerados] = await pool.query(
        "SELECT sku, descricao FROM produtos WHERE ativo = 1 AND estoque = 0 LIMIT 20");
    for (const p of zerados) {
        marcar(await criarNotificacao({
            chave: `estoque-zerado:${p.sku}:${hoje}`, tipo: 'estoque', nivel: 'erro',
            titulo: `Estoque zerado — ${p.descricao}`,
            mensagem: `O produto ${p.sku} está sem estoque.`,
            link: 'estoque.html?minimo=1'
        }));
    }
    const [abaixo] = await pool.query(
        `SELECT sku, descricao, estoque, estoque_minimo FROM produtos
         WHERE ativo = 1 AND estoque > 0 AND estoque <= estoque_minimo LIMIT 20`);
    for (const p of abaixo) {
        marcar(await criarNotificacao({
            chave: `estoque-minimo:${p.sku}:${hoje}`, tipo: 'estoque', nivel: 'alerta',
            titulo: `Estoque baixo — ${p.descricao}`,
            mensagem: `Restam ${Number(p.estoque)} (mínimo ${Number(p.estoque_minimo)}). Hora de repor.`,
            link: 'estoque.html?minimo=1'
        }));
    }

    // ---- titulos novos do DDA aguardando conferencia
    const [dda] = await pool.query(
        "SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM dda_titulos WHERE situacao = 'disponivel'");
    if (dda[0] && dda[0].n > 0) {
        marcar(await criarNotificacao({
            chave: `dda-pendente:${hoje}`, tipo: 'dda', nivel: 'info',
            titulo: `${dda[0].n} boleto(s) no DDA aguardando`,
            mensagem: `${moedaTexto(dda[0].total)} em títulos ainda não lançados no contas a pagar.`,
            link: 'dda.html', valor: Number(dda[0].total)
        }));
    }

    // ---- vendas concluidas sem documento fiscal (aviso semanal, nao diario)
    const [[semNota]] = await pool.query(
        `SELECT COUNT(*) n FROM vendas v WHERE v.status='concluida'
           AND NOT EXISTS (SELECT 1 FROM nota_fiscal_vendas nfv JOIN notas_fiscais nf ON nf.id=nfv.nota_id
                            WHERE nfv.venda_id=v.id AND nf.status <> 'cancelada')
           AND NOT EXISTS (SELECT 1 FROM notas_fiscais nf WHERE nf.venda_id = v.id AND nf.status <> 'cancelada')`);
    if (semNota.n > 0) {
        const semana = `${new Date().getFullYear()}-S${Math.ceil(new Date().getDate() / 7)}-${new Date().getMonth()}`;
        marcar(await criarNotificacao({
            chave: `sem-nota:${semana}`, tipo: 'fiscal', nivel: 'info',
            titulo: `${semNota.n} venda(s) sem documento fiscal`,
            mensagem: 'Emita a nota das vendas pendentes na tela Fiscal.',
            link: 'fiscal.html'
        }));
    }

    return criadas;
}

const moedaTexto = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

app.get('/api/notificacoes', asyncRota(async (req, res) => {
    // gera antes de listar, no maximo uma vez a cada 10 min (controle em memoria)
    if (Date.now() - ultimaGeracaoNotificacoes > 10 * 60000) {
        ultimaGeracaoNotificacoes = Date.now();
        try { await gerarNotificacoes(); } catch (e) { console.error('[TREVO][NOTIF]', e.message); }
    }

    const somenteNaoLidas = req.query.nao_lidas === '1';
    const limite = Math.min(Number(req.query.limite || 40), 100);
    const [linhas] = await pool.query(
        `SELECT * FROM notificacoes ${somenteNaoLidas ? 'WHERE lida = 0' : ''}
         ORDER BY lida ASC, criado_em DESC LIMIT ${limite}`);
    const [[contagem]] = await pool.query(
        `SELECT COUNT(*) total, SUM(lida = 0) nao_lidas,
                SUM(lida = 0 AND nivel = 'erro') criticas FROM notificacoes`);

    // as ainda nao exibidas viram pop-up no navegador uma unica vez
    const novas = linhas.filter(n => !n.exibida && !n.lida).map(n => n.id);
    if (novas.length) await pool.query('UPDATE notificacoes SET exibida = 1 WHERE id IN (?)', [novas]);

    res.json({
        notificacoes: linhas.map(n => ({ ...n, valor: Number(n.valor), lida: !!n.lida,
                                         nova: novas.includes(n.id) })),
        nao_lidas: Number(contagem.nao_lidas || 0),
        criticas: Number(contagem.criticas || 0),
        total: contagem.total
    });
}));

app.post('/api/notificacoes/verificar', asyncRota(async (req, res) => {
    ultimaGeracaoNotificacoes = Date.now();
    const criadas = await gerarNotificacoes();
    res.json({ criadas });
}));

app.post('/api/notificacoes/:id/lida', asyncRota(async (req, res) => {
    const [r] = await pool.query('UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return erro(res, 404, 'Notificacao nao encontrada');
    res.json({ message: 'Notificacao marcada como lida' });
}));

app.post('/api/notificacoes/lidas', asyncRota(async (req, res) => {
    const [r] = await pool.query('UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE lida = 0');
    res.json({ marcadas: r.affectedRows });
}));

app.delete('/api/notificacoes/lidas', asyncRota(async (req, res) => {
    // limpa o historico ja lido; o que esta pendente continua na central
    const [r] = await pool.query('DELETE FROM notificacoes WHERE lida = 1');
    res.json({ removidas: r.affectedRows });
}));

let ultimaGeracaoNotificacoes = 0;

// ---------------------------------------------------------------- estatico + erros
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', dotfiles: 'deny' }));

app.use((req, res) => erro(res, 404, 'Rota nao encontrada'));

app.use((err, req, res, next) => {
    console.error('[TREVO][ERRO]', req.method, req.originalUrl, '-', err.message);
    if (res.headersSent) return next(err);
    erro(res, 500, 'Erro interno no servidor');
});

// ---------------------------------------------------------------- boot
(async () => {
    try {
        await garantirSchema();
        const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM usuarios');
        if (n === 0) {
            // usuario inicial definido pelo cliente
            await pool.query('INSERT INTO usuarios (usuario, nome, senha_hash) VALUES (?,?,?)',
                ['fabio@trevo.com.br', 'Fabio', bcrypt.hashSync('trevo123', 10)]);
            console.log('[TREVO] Usuario inicial criado: fabio@trevo.com.br (troque a senha ao entrar)');
        }
        app.listen(PORTA, () => {
            console.log(`[TREVO] Sistema rodando na porta ${PORTA}`);
            console.log(`[TREVO] Banco: ${process.env.TREVO_DB_NAME || 'trevo_autopecas'} (dedicado)`);
        });
        agendarSefaz();
        agendarRecebimento();
    } catch (e) {
        console.error('[TREVO] Falha no boot:', e.message);
        process.exit(1);
    }
})();
