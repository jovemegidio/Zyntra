'use strict';

/**
 * Testemunha EXTERNA do log de não repúdio da NF-e.
 *
 * A cadeia HMAC, as âncoras (`chattr +a`) e o espelho protegem contra quem só tem o
 * banco ou a aplicação. Nenhum deles resiste a alguém com ROOT no próprio servidor: ele
 * pode remover o atributo, reescrever tudo e recalcular. A defesa é ter uma cópia do
 * "estado" do log FORA da máquina, onde ele não alcança: o hash de cabeça da cadeia
 * (que resume todas as linhas anteriores) enviado periodicamente por e-mail e/ou webhook.
 * Depois, qualquer reescrita do histórico contradiz o hash que já está com o terceiro.
 *
 * Desligada por padrão. Para ligar, no .env:
 *   NFE_AUDIT_TESTEMUNHA_EMAIL=auditoria@empresa.com,outro@empresa.com   (vírgula)
 *   NFE_AUDIT_TESTEMUNHA_WEBHOOK=https://...                            (Discord/Slack/qualquer POST JSON)
 *   NFE_AUDIT_TESTEMUNHA_HORAS=24                                        (padrão 24)
 *
 * Envia: a cada NFE_AUDIT_TESTEMUNHA_HORAS (se houver registros) e, imediatamente, quando a
 * vigilância detecta falha (no máximo 1 alerta por hora). Nunca lança: falha de e-mail não
 * pode afetar a emissão nem a vigilância.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const audit = require('./nfe-confirmacao-audit.service');

const UMA_HORA = 60 * 60 * 1000;

function config() {
    const emails = String(process.env.NFE_AUDIT_TESTEMUNHA_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
    const webhook = String(process.env.NFE_AUDIT_TESTEMUNHA_WEBHOOK || '').trim();
    const horas = Math.max(1, Number(process.env.NFE_AUDIT_TESTEMUNHA_HORAS) || 24);
    return { emails, webhook, horas, ativa: emails.length > 0 || !!webhook };
}

function arquivoEstado() {
    const dir = process.env.NFE_AUDIT_ANCHOR_DIR || path.join(__dirname, '..', 'logs', 'audit-anchor');
    return path.join(dir, 'testemunha-estado.json');
}

function lerEstado() {
    try { return JSON.parse(fs.readFileSync(arquivoEstado(), 'utf8')); } catch (_) { return {}; }
}

function gravarEstado(estado) {
    try {
        const arquivo = arquivoEstado();
        fs.mkdirSync(path.dirname(arquivo), { recursive: true });
        fs.writeFileSync(arquivo, JSON.stringify(estado));
    } catch (e) { console.error('[NFE-AUDIT] não foi possível gravar o estado da testemunha:', e.message); }
}

/** Hash de cabeça (última linha) de cada empresa que tem registros. */
async function coletarCabecas(pool) {
    const [grupos] = await pool.query(`SELECT empresa_id, COUNT(*) AS registros, MAX(id) AS ultimo_id FROM ${audit.TABELA} GROUP BY empresa_id`);
    const cabecas = [];
    for (const g of grupos) {
        const [[ultima]] = await pool.query(
            `SELECT hash_registro, hash_alg, registrado_em_utc FROM ${audit.TABELA} WHERE id = ?`, [g.ultimo_id]);
        cabecas.push({
            empresa: Number(g.empresa_id), registros: Number(g.registros), ultimoId: Number(g.ultimo_id),
            hashCabeca: ultima ? ultima.hash_registro : null, algoritmo: ultima ? (ultima.hash_alg || 'sha256') : null,
            ultimoRegistroEm: ultima ? ultima.registrado_em_utc : null
        });
    }
    return cabecas;
}

function montarMensagem({ cabecas, verificacoes, falha, geradoEm, chave }) {
    const rotuloEstado = falha ? 'ALERTA — INCONSISTÊNCIA DETECTADA' : 'íntegro';
    const linhas = cabecas.map(c => {
        const v = verificacoes.find(x => x.empresa === c.empresa);
        const estado = v ? (v.integra ? 'ÍNTEGRA' : `FALHA (${v.motivo}${v.primeiroInvalidoId ? `, linha ${v.primeiroInvalidoId}` : ''})`) : 'não verificada';
        return `Empresa ${c.empresa}: ${c.registros} registro(s), último id ${c.ultimoId} (${c.ultimoRegistroEm}), verificação: ${estado}\n  hash de cabeça (${c.algoritmo}): ${c.hashCabeca}`;
    });
    const host = os.hostname();
    const texto = [
        `[Zyntra] Testemunha do log fiscal de NF-e — ${rotuloEstado}`,
        `Servidor: ${host}`,
        `Gerado em: ${geradoEm}`,
        `Chave do HMAC: ${chave.origem}${chave.kid ? ` (kid ${chave.kid})` : ''}`,
        '',
        ...(linhas.length ? linhas : ['(sem registros)']),
        '',
        'Guarde esta mensagem: ela é o registro EXTERNO do estado do log na data acima. Se o histórico do banco',
        'for reescrito depois, ele deixará de bater com o hash de cabeça enviado aqui.'
    ].join('\n');
    const json = { tipo: 'nfe-audit-cabeca', geradoEm, servidor: host, falha: !!falha, chave, cabecas, verificacoes };
    const escapar = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<pre style="font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap">${escapar(texto)}</pre>`;
    return { assunto: `[Zyntra] Log fiscal NF-e — ${falha ? 'ALERTA de adulteração' : 'hash de cabeça'} (${geradoEm.slice(0, 10)})`, texto, html, json };
}

async function enviarPadrao(canal, msg, cfg) {
    if (canal === 'email') {
        const r = await require('../utils/email').enviarEmail({
            rota: 'fiscal', para: cfg.emails.join(','), assunto: msg.assunto, html: msg.html, texto: msg.texto
        });
        if (!r || !r.success) throw new Error((r && r.error) || 'e-mail não enviado');
        return;
    }
    if (canal === 'webhook') {
        const resp = await fetch(cfg.webhook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: msg.texto, content: msg.texto.slice(0, 1900), digest: msg.json }),
            signal: AbortSignal.timeout(10000)
        });
        if (!resp.ok) throw new Error(`webhook respondeu HTTP ${resp.status}`);
        return;
    }
    throw new Error(`canal desconhecido: ${canal}`);
}

/**
 * @param {{falha?: boolean, forcar?: boolean, agora?: number, enviar?: Function}} [opcoes]
 *   `enviar(canal, msg, cfg)` é injetável (testes).
 */
async function publicar(pool, { falha = false, forcar = false, agora = Date.now(), enviar = enviarPadrao } = {}) {
    const cfg = config();
    if (!cfg.ativa) return { enviado: false, motivo: 'NAO_CONFIGURADA' };

    const estado = lerEstado();
    const chegouAHora = agora - (estado.ultimoEnvioMs || 0) >= cfg.horas * UMA_HORA;
    const alertaLiberado = falha && agora - (estado.ultimoAlertaMs || 0) >= UMA_HORA;
    if (!forcar && !chegouAHora && !alertaLiberado) return { enviado: false, motivo: 'AINDA_NAO_E_HORA' };

    const cabecas = await coletarCabecas(pool);
    if (!cabecas.length && !falha && !forcar) return { enviado: false, motivo: 'SEM_REGISTROS' };

    const verificacoes = [];
    for (const c of cabecas) {
        const r = await audit.verificarCadeia(pool, c.empresa, { verificarBanco: false });
        verificacoes.push({ empresa: c.empresa, integra: !!r.integra, motivo: r.motivo, primeiroInvalidoId: r.primeiroInvalidoId });
    }
    const houveFalha = falha || verificacoes.some(v => !v.integra);
    const msg = montarMensagem({ cabecas, verificacoes, falha: houveFalha, geradoEm: new Date(agora).toISOString(), chave: audit.chaveInfo() });

    const canais = [];
    if (cfg.emails.length) canais.push('email');
    if (cfg.webhook) canais.push('webhook');
    const enviados = [];
    const erros = [];
    for (const canal of canais) {
        try { await enviar(canal, msg, cfg); enviados.push(canal); }
        catch (e) { erros.push({ canal, erro: e.message }); console.error(`[NFE-AUDIT] testemunha (${canal}) falhou:`, e.message); }
    }
    if (enviados.length) {
        gravarEstado({
            ultimoEnvioMs: agora, ultimoAlertaMs: houveFalha ? agora : (estado.ultimoAlertaMs || 0),
            cabecas: Object.fromEntries(cabecas.map(c => [c.empresa, c.hashCabeca]))
        });
    }
    return { enviado: enviados.length > 0, canais: enviados, erros, falha: houveFalha, mensagem: msg };
}

module.exports = { config, publicar, montarMensagem, coletarCabecas, arquivoEstado };
