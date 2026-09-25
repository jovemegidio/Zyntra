'use strict';

/**
 * Log de não repúdio da emissão de NF-e.
 *
 * Cada tentativa de enviar uma nota à SEFAZ grava, ANTES da transmissão, quem foi
 * (usuário, perfil, IP, navegador), qual categoria da nota, o horário no servidor e o
 * SHA-256 do XML que seguiu. O horário e a identidade vêm do servidor, nunca do cliente.
 *
 * A tabela é só de inserção: cada linha carrega o hash da anterior (por empresa), então
 * apagar ou editar uma linha quebra a cadeia e `verificarCadeia` aponta onde. Triggers
 * de banco (quando o usuário do banco permite criá-las) bloqueiam UPDATE/DELETE.
 */

const crypto = require('node:crypto');

const EVENTOS = Object.freeze({
    BLOQUEADO: 'BLOQUEADO_CAMPOS_OBRIGATORIOS',
    CONFIRMADO: 'ENVIO_CONFIRMADO',
    AUTORIZADA: 'AUTORIZADA',
    REJEITADA: 'REJEITADA_SEFAZ',
    ERRO: 'ERRO_TRANSMISSAO',
    ROLLBACK: 'ROLLBACK_FATURAMENTO',
    ROLLBACK_RECUSADO: 'ROLLBACK_RECUSADO'
});

const inicializacoes = new WeakMap();

function ensure(pool) {
    if (!pool || typeof pool.query !== 'function') throw new Error('Pool de banco inválido para o log de emissão.');
    if (!inicializacoes.has(pool)) {
        const promise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS nfe_confirmacoes_emissao (
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
                    INDEX idx_nfe_conf_nfe (nfe_id),
                    INDEX idx_nfe_conf_usuario (empresa_id, usuario_id, registrado_em),
                    INDEX idx_nfe_conf_categoria (empresa_id, categoria, registrado_em)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            // Best-effort: sem privilégio de TRIGGER a cadeia de hash continua protegendo.
            for (const op of ['UPDATE', 'DELETE']) {
                await pool.query(`CREATE TRIGGER trg_nfe_conf_no_${op.toLowerCase()} BEFORE ${op} ON nfe_confirmacoes_emissao
                    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Log de emissão de NF-e é somente de inserção'`)
                    .catch(e => { if (e.code !== 'ER_TRG_ALREADY_EXISTS') console.warn('[NFE-AUDIT] trigger não criada:', e.message); });
            }
        })().catch(error => { inicializacoes.delete(pool); throw error; });
        inicializacoes.set(pool, promise);
    }
    return inicializacoes.get(pool);
}

const GENESIS = '0'.repeat(64);
const sha256 = valor => crypto.createHash('sha256').update(valor).digest('hex');

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
            'SELECT hash_registro FROM nfe_confirmacoes_emissao WHERE empresa_id = ? ORDER BY id DESC LIMIT 1',
            [registro.empresa_id]);
        registro.hash_anterior = ultimo?.hash_registro || GENESIS;
        registro.hash_registro = sha256(registro.hash_anterior + conteudoCanonico(registro));
        const colunas = Object.keys(registro);
        const [r] = await conn.query(
            `INSERT INTO nfe_confirmacoes_emissao (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
            colunas.map(c => registro[c]));
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
           FROM nfe_confirmacoes_emissao WHERE nfe_id = ? AND empresa_id = ? ORDER BY id`, [nfeId, Number(empresaId) || 1]);
    return rows;
}

/** Recalcula a cadeia inteira da empresa; devolve o primeiro registro adulterado, se houver. */
async function verificarCadeia(pool, empresaId = 1) {
    await ensure(pool);
    const [rows] = await pool.query('SELECT * FROM nfe_confirmacoes_emissao WHERE empresa_id = ? ORDER BY id', [Number(empresaId) || 1]);
    let anterior = GENESIS;
    for (const row of rows) {
        const registro = { ...row, valor_total: row.valor_total == null ? null : Number(row.valor_total).toFixed(2) };
        if (row.hash_anterior !== anterior || sha256(anterior + conteudoCanonico(registro)) !== row.hash_registro) {
            return { integra: false, registros: rows.length, primeiroInvalidoId: row.id };
        }
        anterior = row.hash_registro;
    }
    return { integra: true, registros: rows.length, primeiroInvalidoId: null };
}

module.exports = { EVENTOS, ensure, registrar, listarPorNfe, verificarCadeia, identidade, identidadeConfirmada, sha256, conteudoCanonico };
