'use strict';

/**
 * Log de não repúdio da emissão de NF-e — imutável e verificável.
 *
 * Cada tentativa de enviar uma nota à SEFAZ grava, ANTES da transmissão, quem foi
 * (usuário, perfil, IP, navegador), qual categoria da nota, o horário no servidor e o
 * SHA-256 do XML que seguiu. O horário e a identidade vêm do servidor, nunca do cliente.
 *
 * Imutabilidade em camadas — nenhuma isolada basta, juntas fazem a adulteração
 * silenciosa ser inviável:
 *
 *  1. CADEIA DE HASH por empresa: cada linha carrega o hash da anterior. Editar ou
 *     apagar uma linha do meio quebra a cadeia.
 *  2. HASH COM CHAVE (HMAC-SHA256): a chave vive no servidor (NFE_AUDIT_HMAC_KEY, ou
 *     derivada do JWT_SECRET), nunca no banco. Quem só tem acesso de escrita ao MySQL
 *     não consegue recalcular a cadeia depois de editar uma linha — com SHA-256 puro
 *     conseguiria, e ninguém perceberia.
 *  3. ÂNCORA FORA DO BANCO: cada linha gravada também é anexada, com MAC próprio, a um
 *     arquivo append-only no disco (chattr +a). Só a cadeia não detecta o corte das
 *     ÚLTIMAS linhas (o que sobra continua válido); a âncora detecta.
 *  4. REBAIXAMENTO PROIBIDO: depois da primeira linha com HMAC, nenhuma linha posterior
 *     pode voltar para SHA-256 simples (o atacante só sabe calcular esse).
 *  5. VIGILÂNCIA: a cadeia e as âncoras são reverificadas periodicamente; qualquer
 *     divergência vira alerta crítico no log do processo.
 *  5b. ESPELHO com o CONTEÚDO COMPLETO (também append-only, com MAC por linha): a âncora
 *     prova que houve fraude, mas só guarda hashes; o espelho permite RECONSTITUIR as
 *     linhas apagadas ou alteradas (recuperarDoEspelho), e o MAC prova que a cópia é
 *     autêntica.
 *  5c. TESTEMUNHA EXTERNA (services/nfe-audit-testemunha.service.js): o hash de cabeça da
 *     cadeia é enviado periodicamente para fora da máquina (e-mail/webhook), o que cobre
 *     quem tem root no servidor. Desligada até haver destinatário configurado.
 *  6. TRIGGERS de banco (BEFORE UPDATE/DELETE) impedem a alteração pela via normal.
 *     Exigem privilégio que o usuário da aplicação pode não ter (binlog ligado) — o
 *     script database/migrations/20260925_nfe_confirmacoes_emissao_imutavel.js gera o SQL para o root.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EVENTOS = Object.freeze({
    BLOQUEADO: 'BLOQUEADO_CAMPOS_OBRIGATORIOS',
    CONFIRMADO: 'ENVIO_CONFIRMADO',
    AUTORIZADA: 'AUTORIZADA',
    REJEITADA: 'REJEITADA_SEFAZ',
    ERRO: 'ERRO_TRANSMISSAO',
    ROLLBACK: 'ROLLBACK_FATURAMENTO',
    ROLLBACK_RECUSADO: 'ROLLBACK_RECUSADO'
});

const TABELA = 'nfe_confirmacoes_emissao';
const ALG_SIMPLES = 'sha256';
const ALG_HMAC = 'hmac-sha256';
const inicializacoes = new WeakMap();
const vigilancias = new WeakSet();

const COLUNAS_ADICIONAIS = [
    ['hash_alg', "VARCHAR(16) NOT NULL DEFAULT 'sha256'"],
    ['hash_kid', 'VARCHAR(16) NULL']
];

function ensure(pool) {
    if (!pool || typeof pool.query !== 'function') throw new Error('Pool de banco inválido para o log de emissão.');
    if (!inicializacoes.has(pool)) {
        const promise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS ${TABELA} (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    empresa_id INT NOT NULL DEFAULT 1,
                    evento VARCHAR(40) NOT NULL,
                    nfe_id BIGINT NULL,
                    pedido_id BIGINT NULL,
                    numero VARCHAR(20) NULL,
                    serie VARCHAR(5) NULL,
                    chave_acesso CHAR(44) NULL,
                    categoria VARCHAR(40) NOT NULL,
                    cfops VARCHAR(120) NULL,
                    ambiente CHAR(1) NULL,
                    destinatario_documento VARCHAR(20) NULL,
                    valor_total DECIMAL(15,2) NULL,
                    usuario_id INT NULL,
                    usuario_nome VARCHAR(150) NULL,
                    usuario_email VARCHAR(190) NULL,
                    usuario_perfil VARCHAR(60) NULL,
                    ip VARCHAR(64) NULL,
                    user_agent VARCHAR(255) NULL,
                    confirmou_em_tela TINYINT(1) NOT NULL DEFAULT 0,
                    origem_confirmacao VARCHAR(60) NULL,
                    pendencias TEXT NULL,
                    resultado_codigo VARCHAR(10) NULL,
                    resultado_motivo VARCHAR(500) NULL,
                    xml_sha256 CHAR(64) NULL,
                    registrado_em_utc CHAR(24) NOT NULL,
                    registrado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    hash_anterior CHAR(64) NOT NULL,
                    hash_registro CHAR(64) NOT NULL,
                    hash_alg VARCHAR(16) NOT NULL DEFAULT 'sha256',
                    hash_kid VARCHAR(16) NULL,
                    INDEX idx_nfe_conf_nfe (nfe_id),
                    INDEX idx_nfe_conf_usuario (empresa_id, usuario_id, registrado_em),
                    INDEX idx_nfe_conf_categoria (empresa_id, categoria, registrado_em)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            // Tabelas criadas antes desta versão não têm as colunas de algoritmo: as linhas
            // antigas ficam corretamente marcadas como 'sha256' pelo DEFAULT.
            for (const [coluna, definicao] of COLUNAS_ADICIONAIS) {
                await pool.query(`ALTER TABLE ${TABELA} ADD COLUMN ${coluna} ${definicao}`)
                    .catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
            }
            // Best-effort: sem privilégio de TRIGGER/SUPER a proteção continua nas camadas 1–5.
            for (const op of ['UPDATE', 'DELETE']) {
                await pool.query(`CREATE TRIGGER trg_nfe_conf_no_${op.toLowerCase()} BEFORE ${op} ON ${TABELA}
                    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Log de emissão de NF-e é somente de inserção'`)
                    .catch(e => { if (e.code !== 'ER_TRG_ALREADY_EXISTS') console.warn('[NFE-AUDIT] trigger não criada pela aplicação (rode database/migrations/20260925_nfe_confirmacoes_emissao_imutavel.js como root):', e.message); });
            }
        })().catch(error => { inicializacoes.delete(pool); throw error; });
        inicializacoes.set(pool, promise);
        promise.then(() => iniciarVigilancia(pool)).catch(() => {});
    }
    return inicializacoes.get(pool);
}

const GENESIS = '0'.repeat(64);
const sha256 = valor => crypto.createHash('sha256').update(valor).digest('hex');

// ── Chave do HMAC ─────────────────────────────────────────────────────────────
// Lida a cada uso (não no load do módulo) para acompanhar o ambiente e facilitar teste.
let cacheChave = null;
function chaveHmac() {
    const dedicada = process.env.NFE_AUDIT_HMAC_KEY;
    const segredo = dedicada && dedicada.length >= 16 ? dedicada : process.env.JWT_SECRET;
    if (!segredo) return null;
    if (cacheChave && cacheChave.segredo === segredo) return cacheChave.chave;
    const chave = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(segredo), Buffer.from('zyntra-nfe-audit-v1'),
        Buffer.from('cadeia-hmac'), 32));
    cacheChave = { segredo, chave };
    return chave;
}
const kidDe = chave => sha256(chave).slice(0, 12);
const hmac = (chave, valor) => crypto.createHmac('sha256', chave).update(valor).digest('hex');

function calcularHash(alg, chave, anterior, registro) {
    const conteudo = anterior + conteudoCanonico(registro);
    return alg === ALG_HMAC ? hmac(chave, conteudo) : sha256(conteudo);
}

// Campos que entram no hash, em ordem fixa. Mudar a lista invalida a verificação
// de registros antigos — só acrescentar ao FINAL e versionar se algum dia precisar.
function conteudoCanonico(r) {
    return JSON.stringify([
        r.empresa_id, r.evento, r.nfe_id, r.pedido_id, r.numero, r.serie, r.chave_acesso, r.categoria,
        r.cfops, r.ambiente, r.destinatario_documento, r.valor_total, r.usuario_id, r.usuario_nome,
        r.usuario_email, r.usuario_perfil, r.ip, r.confirmou_em_tela, r.origem_confirmacao,
        r.pendencias, r.resultado_codigo, r.resultado_motivo, r.xml_sha256, r.registrado_em_utc
    ]);
}

// ── Âncora fora do banco ──────────────────────────────────────────────────────
function arquivoAncora(empresaId) {
    const dir = process.env.NFE_AUDIT_ANCHOR_DIR || path.join(__dirname, '..', 'logs', 'audit-anchor');
    return path.join(dir, `nfe-audit-anchor-${Number(empresaId) || 1}.log`);
}

const macAncora = (chave, a) => hmac(chave, [a.e, a.id, a.h, a.p, a.alg, a.t].join('|'));

function anexarAncora(registro, id) {
    try {
        const chave = registro.hash_alg === ALG_HMAC ? chaveHmac() : null;
        const a = { e: registro.empresa_id, id, h: registro.hash_registro, p: registro.hash_anterior, alg: registro.hash_alg, t: registro.registrado_em_utc };
        if (chave) a.m = macAncora(chave, a);
        const arquivo = arquivoAncora(registro.empresa_id);
        fs.mkdirSync(path.dirname(arquivo), { recursive: true });
        fs.appendFileSync(arquivo, JSON.stringify(a) + '\n', { flag: 'a' });
        return true;
    } catch (e) {
        // A linha já está no banco (evidência primária). Sem âncora a proteção contra corte
        // do fim do log fica menor — alerta alto, mas não impede a operação fiscal.
        console.error('[NFE-AUDIT][ALERTA] não foi possível gravar a âncora do log:', e.message);
        return false;
    }
}

function lerAncoras(empresaId) {
    const arquivo = arquivoAncora(empresaId);
    if (!fs.existsSync(arquivo)) return { arquivo, existe: false, ancoras: [], invalidas: 0 };
    const ancoras = [];
    let invalidas = 0;
    for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
        if (!linha.trim()) continue;
        try {
            const a = JSON.parse(linha);
            if (a && a.id != null && a.h) ancoras.push(a); else invalidas++;
        } catch (_) { invalidas++; }
    }
    return { arquivo, existe: true, ancoras, invalidas };
}

function verificarAncoras(rows, empresaId, chave) {
    const { arquivo, existe, ancoras, invalidas } = lerAncoras(empresaId);
    const porId = new Map(rows.map(r => [Number(r.id), r]));
    const problemas = [];
    for (const a of ancoras) {
        if (a.alg === ALG_HMAC) {
            if (!chave) { problemas.push({ id: a.id, motivo: 'CHAVE_INDISPONIVEL' }); continue; }
            if (a.m !== macAncora(chave, a)) { problemas.push({ id: a.id, motivo: 'ANCORA_ADULTERADA' }); continue; }
        }
        const linha = porId.get(Number(a.id));
        if (!linha) problemas.push({ id: a.id, motivo: 'LINHA_APAGADA_OU_TRUNCADA' });
        else if (linha.hash_registro !== a.h || linha.hash_anterior !== a.p) problemas.push({ id: a.id, motivo: 'LINHA_ALTERADA_APOS_ANCORA' });
    }
    const ancoradas = new Set(ancoras.map(a => Number(a.id)));
    const semAncora = rows.filter(r => !ancoradas.has(Number(r.id))).length;
    return { arquivo, existe, ancoras: ancoras.length, linhasInvalidas: invalidas, semAncora, problemas };
}

// ── Espelho com o conteúdo completo ───────────────────────────────────────────
function arquivoEspelho(empresaId) {
    const dir = process.env.NFE_AUDIT_ANCHOR_DIR || path.join(__dirname, '..', 'logs', 'audit-anchor');
    return path.join(dir, `nfe-audit-espelho-${Number(empresaId) || 1}.log`);
}

// O MAC cobre id + conteúdo canônico + hashes + algoritmo: trocar qualquer campo invalida a linha.
const macEspelho = (chave, id, r) => hmac(chave, JSON.stringify([id, conteudoCanonico(r), r.hash_registro, r.hash_anterior, r.hash_alg]));

function anexarEspelho(registro, id) {
    try {
        const chave = registro.hash_alg === ALG_HMAC ? chaveHmac() : null;
        const linha = { e: registro.empresa_id, id, r: registro };
        if (chave) linha.m = macEspelho(chave, id, registro);
        const arquivo = arquivoEspelho(registro.empresa_id);
        fs.mkdirSync(path.dirname(arquivo), { recursive: true });
        fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n', { flag: 'a' });
        return true;
    } catch (e) {
        console.error('[NFE-AUDIT][ALERTA] não foi possível gravar o espelho do log:', e.message);
        return false;
    }
}

/** Lê o espelho e separa as linhas autênticas (MAC confere) das adulteradas/ilegíveis. */
function lerEspelho(empresaId, chave) {
    const arquivo = arquivoEspelho(empresaId);
    if (!fs.existsSync(arquivo)) return { arquivo, existe: false, linhas: [], adulteradas: 0, ilegiveis: 0 };
    const linhas = [];
    let adulteradas = 0;
    let ilegiveis = 0;
    for (const texto of fs.readFileSync(arquivo, 'utf8').split('\n')) {
        if (!texto.trim()) continue;
        let l;
        try { l = JSON.parse(texto); } catch (_) { ilegiveis++; continue; }
        if (!l || l.id == null || !l.r) { ilegiveis++; continue; }
        if (l.r.hash_alg === ALG_HMAC) {
            if (!chave || l.m !== macEspelho(chave, l.id, l.r)) { adulteradas++; continue; }
        }
        linhas.push({ id: Number(l.id), ...l.r });
    }
    return { arquivo, existe: true, linhas, adulteradas, ilegiveis };
}

const normalizarLinha = row => ({ ...row, valor_total: row.valor_total == null ? null : Number(row.valor_total).toFixed(2) });
const assinaturaLinha = row => conteudoCanonico(normalizarLinha(row)) + '|' + row.hash_registro;

function verificarEspelho(rows, empresaId, chave) {
    const esp = lerEspelho(empresaId, chave);
    const porId = new Map(rows.map(r => [Number(r.id), r]));
    const ausentesNoBanco = [];
    const diferentes = [];
    for (const l of esp.linhas) {
        const noBanco = porId.get(l.id);
        if (!noBanco) ausentesNoBanco.push(l.id);
        else if (assinaturaLinha(noBanco) !== assinaturaLinha(l)) diferentes.push(l.id);
    }
    const noEspelho = new Set(esp.linhas.map(l => l.id));
    return {
        arquivo: esp.arquivo, existe: esp.existe, linhas: esp.linhas.length,
        adulteradas: esp.adulteradas, ilegiveis: esp.ilegiveis,
        ausentesNoBanco, diferentes, semEspelho: rows.filter(r => !noEspelho.has(Number(r.id))).length,
        recuperaveis: ausentesNoBanco.length + diferentes.length
    };
}

/**
 * Reconstitui, a partir do espelho, as linhas do log (autênticas pelo MAC), em ordem.
 * Serve para recuperar a evidência quando o banco foi apagado ou adulterado.
 */
function recuperarDoEspelho(empresaId = 1) {
    const esp = lerEspelho(empresaId, chaveHmac());
    return { arquivo: esp.arquivo, existe: esp.existe, adulteradas: esp.adulteradas, ilegiveis: esp.ilegiveis,
        linhas: esp.linhas.sort((a, b) => a.id - b.id) };
}

/** Qual chave está em uso (sem revelá-la): dedicada, derivada do JWT_SECRET ou nenhuma. */
function chaveInfo() {
    const dedicada = process.env.NFE_AUDIT_HMAC_KEY;
    const chave = chaveHmac();
    if (!chave) return { origem: 'nenhuma', kid: null };
    return { origem: dedicada && dedicada.length >= 16 ? 'dedicada' : 'jwt', kid: kidDe(chave) };
}

function identidade(req) {
    const u = req?.user || {};
    const ip = String(req?.headers?.['x-forwarded-for'] || req?.ip || req?.socket?.remoteAddress || '').split(',')[0].trim();
    return {
        usuarioId: u.id ?? null,
        usuarioNome: u.nome || u.name || u.username || null,
        usuarioEmail: u.email || null,
        usuarioPerfil: u.role || u.cargo || null,
        ip: ip || null,
        userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 255) || null
    };
}

/** Identidade + se a tela de confirmação foi aceita (corpo `confirmacaoEnvio` enviado pelo front). */
function identidadeConfirmada(req) {
    const corpo = req?.body?.confirmacaoEnvio;
    return {
        ...identidade(req),
        confirmouEmTela: corpo?.aceite === true,
        origemConfirmacao: corpo?.origem ? String(corpo.origem) : null
    };
}

const recorta = (v, n) => (v == null ? null : String(v).slice(0, n));

/**
 * Grava um evento. Lança se não conseguir gravar — quem chama decide se falha fechado
 * (antes de transmitir) ou só avisa (depois do retorno da SEFAZ).
 */
async function registrar(pool, evt) {
    await ensure(pool);
    const chave = chaveHmac();
    if (!chave) console.warn('[NFE-AUDIT][ALERTA] sem NFE_AUDIT_HMAC_KEY/JWT_SECRET: hash SEM chave (menos resistente a adulteração).');
    const registro = {
        empresa_id: Number(evt.empresaId) || 1,
        evento: evt.evento,
        nfe_id: evt.nfeId != null ? Number(evt.nfeId) : null,
        pedido_id: evt.pedidoId != null ? Number(evt.pedidoId) : null,
        numero: recorta(evt.numero, 20),
        serie: recorta(evt.serie, 5),
        chave_acesso: evt.chaveAcesso && String(evt.chaveAcesso).length === 44 ? String(evt.chaveAcesso) : null,
        categoria: evt.categoria,
        cfops: recorta((evt.cfops || []).join(','), 120),
        ambiente: recorta(evt.ambiente, 1),
        destinatario_documento: recorta(evt.destinatarioDocumento, 20),
        valor_total: evt.valorTotal != null && Number.isFinite(Number(evt.valorTotal)) ? Number(evt.valorTotal).toFixed(2) : null,
        usuario_id: evt.usuarioId != null ? Number(evt.usuarioId) : null,
        usuario_nome: recorta(evt.usuarioNome, 150),
        usuario_email: recorta(evt.usuarioEmail, 190),
        usuario_perfil: recorta(evt.usuarioPerfil, 60),
        ip: recorta(evt.ip, 64),
        user_agent: recorta(evt.userAgent, 255),
        confirmou_em_tela: evt.confirmouEmTela ? 1 : 0,
        origem_confirmacao: recorta(evt.origemConfirmacao, 60),
        pendencias: evt.pendencias && evt.pendencias.length
            ? JSON.stringify(evt.pendencias.map(p => ({ campo: p.campo, item: p.item?.indice ?? null, mensagem: p.mensagem })))
            : null,
        resultado_codigo: recorta(evt.resultadoCodigo, 10),
        resultado_motivo: recorta(evt.resultadoMotivo, 500),
        xml_sha256: evt.xml ? sha256(String(evt.xml)) : (evt.xmlSha256 || null),
        registrado_em_utc: new Date().toISOString().slice(0, 23) + 'Z'
    };

    const conn = await pool.getConnection();
    const trava = `nfe_conf_chain_${registro.empresa_id}`;
    let travou = false;
    try {
        const [[l]] = await conn.query('SELECT GET_LOCK(?, 10) AS ok', [trava]);
        travou = Number(l?.ok) === 1;
        if (!travou) throw new Error('Não foi possível obter a trava da cadeia de auditoria.');
        const [[ultimo]] = await conn.query(
            `SELECT hash_registro FROM ${TABELA} WHERE empresa_id = ? ORDER BY id DESC LIMIT 1`,
            [registro.empresa_id]);
        registro.hash_anterior = ultimo?.hash_registro || GENESIS;
        registro.hash_alg = chave ? ALG_HMAC : ALG_SIMPLES;
        registro.hash_kid = chave ? kidDe(chave) : null;
        registro.hash_registro = calcularHash(registro.hash_alg, chave, registro.hash_anterior, registro);
        const colunas = Object.keys(registro);
        const [r] = await conn.query(
            `INSERT INTO ${TABELA} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
            colunas.map(c => registro[c]));
        // Ainda dentro da trava: a ordem no arquivo de âncora é a mesma da cadeia.
        anexarAncora(registro, r.insertId);
        anexarEspelho(registro, r.insertId);
        return { id: r.insertId, hash: registro.hash_registro, registradoEm: registro.registrado_em_utc };
    } finally {
        if (travou) await conn.query('SELECT RELEASE_LOCK(?)', [trava]).catch(() => {});
        conn.release();
    }
}

async function listarPorNfe(pool, nfeId, empresaId = 1) {
    await ensure(pool);
    const [rows] = await pool.query(
        `SELECT id, evento, categoria, cfops, ambiente, numero, serie, usuario_id, usuario_nome, usuario_email,
                usuario_perfil, ip, confirmou_em_tela, origem_confirmacao, pendencias, resultado_codigo,
                resultado_motivo, xml_sha256, registrado_em_utc, registrado_em
           FROM ${TABELA} WHERE nfe_id = ? AND empresa_id = ? ORDER BY id`, [nfeId, Number(empresaId) || 1]);
    return rows;
}

/** Confere se os triggers anti-UPDATE/DELETE estão no banco (proteção de prevenção, não só de detecção). */
async function verificarTriggers(pool) {
    const [rows] = await pool.query(`SHOW TRIGGERS LIKE '${TABELA}'`);
    const eventos = new Set(rows.map(r => String(r.Event || '').toUpperCase()));
    return { update: eventos.has('UPDATE'), delete: eventos.has('DELETE'), completo: eventos.has('UPDATE') && eventos.has('DELETE') };
}

/**
 * Recalcula a cadeia inteira da empresa e confere as âncoras.
 * `integra` só é true se a cadeia fecha E nenhuma âncora acusa corte/edição.
 */
async function verificarCadeia(pool, empresaId = 1, opcoes = {}) {
    await ensure(pool);
    const emp = Number(empresaId) || 1;
    const [rows] = await pool.query(`SELECT * FROM ${TABELA} WHERE empresa_id = ? ORDER BY id`, [emp]);
    const chave = chaveHmac();
    const kidAtual = chave ? kidDe(chave) : null;
    const resultado = (extra) => ({ integra: false, registros: rows.length, primeiroInvalidoId: null, motivo: null, ...extra });

    let anterior = GENESIS;
    let viuHmac = false;
    let falhaCadeia = null;
    for (const row of rows) {
        const alg = row.hash_alg || ALG_SIMPLES;
        if (alg !== ALG_SIMPLES && alg !== ALG_HMAC) { falhaCadeia = { id: row.id, motivo: 'ALGORITMO_DESCONHECIDO' }; break; }
        if (viuHmac && alg !== ALG_HMAC) { falhaCadeia = { id: row.id, motivo: 'REBAIXAMENTO_DE_ALGORITMO' }; break; }
        if (alg === ALG_HMAC) {
            viuHmac = true;
            if (!chave) { falhaCadeia = { id: row.id, motivo: 'CHAVE_INDISPONIVEL' }; break; }
            if (row.hash_kid && row.hash_kid !== kidAtual) { falhaCadeia = { id: row.id, motivo: 'CHAVE_DIFERENTE' }; break; }
        }
        const registro = { ...row, valor_total: row.valor_total == null ? null : Number(row.valor_total).toFixed(2) };
        if (row.hash_anterior !== anterior || calcularHash(alg, chave, anterior, registro) !== row.hash_registro) {
            falhaCadeia = { id: row.id, motivo: 'HASH_NAO_CONFERE' };
            break;
        }
        anterior = row.hash_registro;
    }

    const ancora = verificarAncoras(rows, emp, chave);
    const espelho = verificarEspelho(rows, emp, chave);
    const infoChave = chaveInfo();
    let protecaoBanco = null;
    if (opcoes.verificarBanco !== false) protecaoBanco = await verificarTriggers(pool).catch(() => null);

    const base = { ancora, espelho, chave: infoChave, protecaoBanco };
    if (falhaCadeia) return resultado({ primeiroInvalidoId: falhaCadeia.id, motivo: falhaCadeia.motivo, ...base });
    if (ancora.problemas.length) {
        return resultado({ primeiroInvalidoId: ancora.problemas[0].id, motivo: ancora.problemas[0].motivo, ...base });
    }
    // Espelho: cópia adulterada, linha do banco diferente da cópia autêntica, ou linha que sumiu.
    if (espelho.adulteradas) return resultado({ motivo: 'ESPELHO_ADULTERADO', ...base });
    if (espelho.diferentes.length) return resultado({ primeiroInvalidoId: espelho.diferentes[0], motivo: 'LINHA_DIFERE_DO_ESPELHO', ...base });
    if (espelho.ausentesNoBanco.length) return resultado({ primeiroInvalidoId: espelho.ausentesNoBanco[0], motivo: 'LINHA_APAGADA_OU_TRUNCADA', ...base });
    return resultado({ integra: true, ...base });
}

// ── Vigilância ────────────────────────────────────────────────────────────────
async function vigiarUmaVez(pool) {
    await ensure(pool);
    const [empresas] = await pool.query(`SELECT DISTINCT empresa_id FROM ${TABELA}`);
    let houveFalha = false;
    for (const { empresa_id: emp } of empresas) {
        const r = await verificarCadeia(pool, emp);
        if (!r.integra) {
            houveFalha = true;
            const msg = `LOG DE EMISSÃO DE NF-e ADULTERADO OU INCONSISTENTE (empresa ${emp}): ${r.motivo} na linha ${r.primeiroInvalidoId}.`;
            console.error(`[NFE-AUDIT][ALERTA-CRITICO] ${msg}`);
            try {
                if (typeof global.createNotification === 'function') global.createNotification('security', 'Alerta: log fiscal adulterado', msg, { empresa_id: emp, motivo: r.motivo });
            } catch (_) { /* melhor esforço */ }
        }
        if (r.protecaoBanco && !r.protecaoBanco.completo) {
            console.warn(`[NFE-AUDIT][ALERTA] empresa ${emp}: triggers anti-UPDATE/DELETE ausentes no banco (só detecção, sem prevenção).`);
        }
    }
    // Testemunha externa (e-mail/webhook): melhor esforço, nunca derruba a vigilância.
    try { await require('./nfe-audit-testemunha.service').publicar(pool, { falha: houveFalha }); }
    catch (e) { console.error('[NFE-AUDIT] testemunha externa falhou:', e.message); }
}

/** Reverifica periodicamente. Não segura o processo vivo (unref) e nunca lança. */
function iniciarVigilancia(pool, { intervaloMs = 15 * 60 * 1000 } = {}) {
    if (process.env.NFE_AUDIT_VIGILANCIA === 'off' || vigilancias.has(pool)) return;
    vigilancias.add(pool);
    const tick = () => vigiarUmaVez(pool).catch(e => console.error('[NFE-AUDIT] vigilância falhou:', e.message));
    const primeiro = setTimeout(tick, 30 * 1000);
    const periodico = setInterval(tick, intervaloMs);
    for (const t of [primeiro, periodico]) if (typeof t.unref === 'function') t.unref();
}

module.exports = {
    EVENTOS, ensure, registrar, listarPorNfe, verificarCadeia, verificarTriggers, iniciarVigilancia, vigiarUmaVez,
    identidade, identidadeConfirmada, sha256, conteudoCanonico, arquivoAncora, arquivoEspelho, recuperarDoEspelho,
    chaveInfo, ALG_HMAC, ALG_SIMPLES, TABELA
};
