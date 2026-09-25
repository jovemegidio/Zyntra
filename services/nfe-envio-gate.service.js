'use strict';

/**
 * Porta única antes de transmitir uma NF-e à SEFAZ:
 *   1. confere os campos obrigatórios da categoria (bloqueia com mensagem clara);
 *   2. grava o log de não repúdio — usuário + categoria + horário — ANTES de transmitir.
 * Se o log não puder ser gravado, a nota NÃO segue: sem registro de quem enviou, não envia.
 */

const { validarXml, erroObrigatoriedade } = require('./nfe-obrigatoriedade.service');
const audit = require('./nfe-confirmacao-audit.service');

/**
 * `contexto`: { req?, auditoria?, nfe, empresaId?, usuarioId?, valorTotal? }
 *  - `req`: requisição HTTP (identidade, IP e navegador saem dela);
 *  - `auditoria`: identidade já extraída (`audit.identidade(req)` + confirmouEmTela/origem),
 *    para quem transmite sem ter o `req` à mão (ex.: o emitter).
 */
async function autorizarEnvio(pool, xml, contexto = {}) {
    const resultado = validarXml(xml);
    const req = contexto.req || require('./request-context').currentRequest();
    const quem = { ...audit.identidadeConfirmada(req), ...(contexto.auditoria || {}) };
    if (quem.usuarioId == null && contexto.usuarioId != null) quem.usuarioId = contexto.usuarioId;
    const { confirmouEmTela, origemConfirmacao } = quem;
    delete quem.confirmouEmTela; delete quem.origemConfirmacao;
    const nfe = contexto.nfe || {};
    const base = {
        empresaId: contexto.empresaId || nfe.empresa_id || 1,
        nfeId: nfe.id ?? null, pedidoId: nfe.pedido_id ?? null,
        numero: nfe.numero ?? nfe.numero_nfe ?? null, serie: nfe.serie ?? null,
        chaveAcesso: nfe.chave_acesso ?? null,
        categoria: resultado.categoria, cfops: resultado.resumo.cfops, ambiente: resultado.resumo.ambiente,
        destinatarioDocumento: resultado.resumo.destinatarioDocumento,
        valorTotal: contexto.valorTotal ?? nfe.valor_total ?? null,
        ...quem, confirmouEmTela, origemConfirmacao, xml
    };

    if (!resultado.ok) {
        await audit.registrar(pool, { ...base, evento: audit.EVENTOS.BLOQUEADO, pendencias: resultado.erros })
            .catch(e => console.error('[NFE-AUDIT] falha ao registrar bloqueio:', e.message));
        throw erroObrigatoriedade(resultado);
    }

    let registro;
    try {
        registro = await audit.registrar(pool, { ...base, evento: audit.EVENTOS.CONFIRMADO, pendencias: resultado.avisos });
    } catch (e) {
        console.error('[NFE-AUDIT] falha ao registrar confirmação — envio abortado:', e.message);
        const erro = new Error('Não foi possível registrar o log de auditoria do envio. Por segurança a NF-e não foi transmitida; tente novamente.');
        erro.code = 'AUDITORIA_INDISPONIVEL';
        erro.status = 503;
        throw erro;
    }
    return { resultado, registro, contextoLog: base };
}

/** Desfecho da transmissão; melhor esforço — o envio já aconteceu, o log não pode desfazê-lo. */
async function registrarDesfecho(pool, autorizacao, evento, { codigo, motivo, chaveAcesso } = {}) {
    try {
        await audit.registrar(pool, {
            ...autorizacao.contextoLog, evento, pendencias: null,
            chaveAcesso: chaveAcesso || autorizacao.contextoLog.chaveAcesso,
            resultadoCodigo: codigo, resultadoMotivo: motivo
        });
    } catch (e) {
        console.error('[NFE-AUDIT] falha ao registrar desfecho:', e.message);
    }
}

module.exports = { autorizarEnvio, registrarDesfecho, EVENTOS: audit.EVENTOS };
