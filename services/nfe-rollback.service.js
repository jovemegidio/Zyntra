'use strict';

/**
 * Rollback do faturamento de uma NF-e que FALHOU na SEFAZ.
 *
 * O "Faturar" grava tudo antes de transmitir (pedido → faturado, baixa de estoque,
 * conta a receber, logística) e, se a nota não é autorizada, só devolve o erro — o
 * pedido fica "faturado" sem documento fiscal válido. Este serviço desfaz, numa única
 * transação, exatamente o que ESSA nota originou.
 *
 * Regras de segurança (cada uma vira um bloqueio explícito, nunca um "tenta e vê"):
 *  - nota autorizada / cancelada / denegada / inutilizada: NUNCA é revertida;
 *  - resultado incerto (timeout, SEFAZ fora do ar): antes de qualquer coisa consulta a
 *    chave na SEFAZ — se ela consta como autorizada, não reverte;
 *  - título a receber já recebido: não reverte (o dinheiro entrou);
 *  - faturamento parcial (meia nota): não reverte aqui — fluxo próprio, exige revisão;
 *  - só toca no pedido/estoque/financeiro quando o "faturamento" registrado no histórico
 *    aconteceu na janela de criação desta nota; fora disso (reemissão, devolução) só a
 *    nota é encerrada e o pedido segue como está.
 *
 * Numeração: a sequência NUNCA anda para trás (ver gerarProximoNumeroNFe). O número da
 * nota revertida vira lacuna e é devolvido em `numeroLacuna` para inutilização.
 */

const audit = require('./nfe-confirmacao-audit.service');

const JANELA_MS = 15 * 60 * 1000;
const STATUS_REVERSIVEL = ['pendente', 'rejeitada', 'erro'];
const STATUS_FINAL = ['autorizada', 'cancelada', 'denegada', 'inutilizada'];
const STATUS_TITULO_QUITADO = ['recebido', 'recebida', 'liquidado', 'liquidada', 'pago', 'paga', 'compensado'];
const STATUS_TITULO_ENCERRADO = ['cancelado', 'cancelada', 'estornado', 'estornada', 'excluida', 'excluido'];
const DENEGADAS = new Set(['110', '205', '301', '302']);
const DUPLICIDADE = new Set(['204', '539']); // a nota pode já existir autorizada

const CLASSES = Object.freeze({
    AUTORIZADA: 'AUTORIZADA',
    FINALIZADA: 'FINALIZADA',
    DENEGADA: 'DENEGADA',
    REJEICAO_DEFINITIVA: 'REJEICAO_DEFINITIVA',
    NAO_TRANSMITIDA: 'NAO_TRANSMITIDA',
    INCERTA: 'INCERTA'
});

const minusculo = v => String(v == null ? '' : v).trim().toLowerCase();

/** Classifica o último retorno gravado na nota. Conservador: na dúvida, INCERTA. */
function classificarRetorno(nfe) {
    const status = minusculo(nfe.status);
    const cod = String(nfe.sefaz_codigo_status == null ? '' : nfe.sefaz_codigo_status).trim();
    const tipo = minusculo(nfe.sefaz_tipo_retorno);

    if (nfe.protocolo_autorizacao || status === 'autorizada' || cod === '100') return CLASSES.AUTORIZADA;
    if (DENEGADAS.has(cod) || status === 'denegada') return CLASSES.DENEGADA;
    if (STATUS_FINAL.includes(status)) return CLASSES.FINALIZADA;
    if (tipo === 'rejeicao' && /^\d{3}$/.test(cod)) {
        if (DUPLICIDADE.has(cod)) return CLASSES.INCERTA;
        return Number(cod) >= 200 ? CLASSES.REJEICAO_DEFINITIVA : CLASSES.INCERTA;
    }
    // Falha ao assinar: o XML nunca saiu do servidor.
    if (tipo === 'certificado') return CLASSES.NAO_TRANSMITIDA;
    // Rascunho que nunca foi assinado nem enviado.
    if (status === 'pendente' && !cod && !nfe.xml_assinado) return CLASSES.NAO_TRANSMITIDA;
    return CLASSES.INCERTA;
}

function falha(codigo, mensagem, extra = {}) {
    const e = new Error(mensagem);
    e.code = codigo;
    e.status = extra.status || 409;
    Object.assign(e, extra);
    return e;
}

// ── Colunas (schema varia entre as instâncias) ────────────────────────────────
const inicializacoes = new WeakMap();
const COLUNAS_NFES = [
    ['rollback_em', 'DATETIME NULL'],
    ['rollback_por', 'INT NULL'],
    ['rollback_origem', 'VARCHAR(20) NULL'],
    ['rollback_motivo', 'VARCHAR(255) NULL'],
    ['pedido_id_origem', 'BIGINT NULL']
];

function ensure(pool) {
    if (!inicializacoes.has(pool)) {
        const promise = (async () => {
            for (const [coluna, definicao] of COLUNAS_NFES) {
                await pool.query(`ALTER TABLE nfes ADD COLUMN ${coluna} ${definicao}`)
                    .catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
            }
        })().catch(e => { inicializacoes.delete(pool); throw e; });
        inicializacoes.set(pool, promise);
    }
    return inicializacoes.get(pool);
}

async function colunasDe(conn, tabela) {
    const [rows] = await conn.query(`SHOW COLUMNS FROM ${tabela}`);
    return new Set(rows.map(r => r.Field));
}

const tolera = async (fn, codigos) => {
    try { return await fn(); } catch (e) { if (!codigos.includes(e.code)) throw e; return null; }
};

function instante(row, campos) {
    for (const c of campos) {
        if (row && row[c]) { const t = new Date(row[c]).getTime(); if (Number.isFinite(t)) return t; }
    }
    return null;
}

function lerMeta(valor) {
    if (!valor) return {};
    if (typeof valor === 'object') return valor;
    try { return JSON.parse(valor); } catch (_) { return {}; }
}

// ── Plano (o que seria desfeito) ──────────────────────────────────────────────
/**
 * Monta o plano dentro de uma conexão. Com `travar`, bloqueia as linhas (FOR UPDATE)
 * para a execução; sem, é só leitura (simulação para a tela de confirmação).
 */
async function montarPlano(conn, nfeId, { travar = false, classeInformada = null } = {}) {
    const lock = travar ? ' FOR UPDATE' : '';
    const [[nfe]] = await conn.query(`SELECT * FROM nfes WHERE id = ?${lock}`, [nfeId]);
    if (!nfe) throw falha('NFE_NAO_ENCONTRADA', 'NF-e não encontrada.', { status: 404 });
    if (nfe.rollback_em) throw falha('JA_REVERTIDA', `NF-e ${nfe.numero} já teve o faturamento revertido.`);

    const classe = classeInformada || classificarRetorno(nfe);
    const status = minusculo(nfe.status);
    if (classe === CLASSES.AUTORIZADA) throw falha('NOTA_AUTORIZADA', `NF-e ${nfe.numero} está autorizada na SEFAZ: use o cancelamento, não o rollback.`);
    if (classe === CLASSES.DENEGADA) throw falha('NOTA_DENEGADA', `NF-e ${nfe.numero} foi denegada (o número foi consumido e a nota existe na SEFAZ). Trate como devolução/ajuste, não como rollback.`);
    if (classe === CLASSES.FINALIZADA) throw falha('STATUS_NAO_REVERSIVEL', `NF-e ${nfe.numero} está "${nfe.status}" e não pode ser revertida.`);
    if (!STATUS_REVERSIVEL.includes(status)) throw falha('STATUS_NAO_REVERSIVEL', `NF-e ${nfe.numero} está "${nfe.status}" (envio em andamento?). Aguarde o retorno antes de reverter.`);
    if (classe === CLASSES.INCERTA) throw falha('RESULTADO_INCERTO', `NF-e ${nfe.numero}: o retorno da SEFAZ é incerto. Confirme na SEFAZ que a nota NÃO foi autorizada antes de reverter.`);

    const plano = {
        nfe: { id: nfe.id, numero: nfe.numero, serie: nfe.serie, chave: nfe.chave_acesso || null, status: nfe.status, codigoStatus: nfe.sefaz_codigo_status || null },
        classe, escopo: 'SOMENTE_NOTA', pedido: null, statusAnterior: null,
        estoque: [], titulos: [], numeroLacuna: { numero: nfe.numero, serie: nfe.serie }, avisos: []
    };

    const pedidoId = nfe.pedido_id ? Number(nfe.pedido_id) : null;
    if (!pedidoId) { plano.avisos.push('Nota avulsa: somente a nota é encerrada.'); return { plano, nfe, pedido: null }; }

    const [[pedido]] = await conn.query(`SELECT * FROM pedidos WHERE id = ?${lock}`, [pedidoId]);
    if (!pedido) return { plano, nfe, pedido: null };
    plano.pedido = { id: pedido.id, status: pedido.status };

    const parcial = await tolera(async () => {
        const [rows] = await conn.query('SELECT id FROM pedido_faturamentos WHERE pedido_id = ? AND nfe_numero = ? LIMIT 1', [pedidoId, String(nfe.numero)]);
        return rows[0] || null;
    }, ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);
    if (parcial) throw falha('FATURAMENTO_PARCIAL_MANUAL', `NF-e ${nfe.numero} pertence a um faturamento parcial (meia nota): o rollback automático não cobre esse fluxo. Trate pelo Faturamento Parcial.`);

    if (String(nfe.finalidade || '1') !== '1') { plano.avisos.push('Nota de finalidade diferente de venda (devolução/ajuste): o pedido não é alterado.'); return { plano, nfe, pedido }; }
    if (minusculo(pedido.status) !== 'faturado') { plano.avisos.push(`Pedido está "${pedido.status}": não foi este faturamento que o moveu; o pedido não é alterado.`); return { plano, nfe, pedido }; }

    // O faturamento que originou a nota é o último evento 'faturamento' do histórico, e
    // precisa ter acontecido logo antes de a nota ser criada (mesma ação do usuário).
    const [[hist]] = await conn.query(
        "SELECT * FROM pedido_historico WHERE pedido_id = ? AND acao = 'faturamento' ORDER BY id DESC LIMIT 1", [pedidoId]);
    const tHist = instante(hist, ['created_at', 'data_criacao', 'data_hora', 'data']);
    const tNfe = instante(nfe, ['created_at', 'data_emissao']);
    if (!hist || tHist == null || tNfe == null || tHist > tNfe + 60000 || tNfe - tHist > JANELA_MS) {
        plano.avisos.push('O faturamento do pedido não foi originado por esta nota (reemissão ou histórico fora da janela): o pedido não é alterado.');
        return { plano, nfe, pedido };
    }

    plano.escopo = 'FATURAMENTO_INTEGRAL';
    plano.statusAnterior = String(lerMeta(hist.meta).status_anterior || 'aprovado');
    const ini = new Date(tNfe - JANELA_MS), fim = new Date(tNfe + 60000);

    // Baixa de estoque desta ação (mesma janela) e ainda não estornada.
    const [movs] = await conn.query(
        `SELECT id, codigo_material, quantidade FROM estoque_movimentacoes
          WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'
            AND data_movimento BETWEEN ? AND ?`, [pedidoId, ini, fim]);
    const [[jaEstornado]] = await conn.query(
        `SELECT COUNT(*) AS n FROM estoque_movimentacoes
          WHERE documento_tipo = 'pedido_rollback' AND documento_id = ? AND data_movimento >= ?`, [pedidoId, ini]);
    if (!Number(jaEstornado && jaEstornado.n)) {
        plano.estoque = movs.map(m => ({ codigo: m.codigo_material, quantidade: Number(m.quantidade) }));
    }

    // Títulos gerados pelo faturamento ("Faturamento Pedido #N - ...") e ainda vigentes.
    const [titulos] = await conn.query(
        `SELECT id, status, valor FROM contas_receber
          WHERE pedido_id = ? AND descricao LIKE 'Faturamento Pedido #%'`, [pedidoId]);
    for (const t of titulos) {
        const st = minusculo(t.status);
        if (STATUS_TITULO_QUITADO.includes(st)) {
            throw falha('TITULO_RECEBIDO', `O título #${t.id} deste faturamento já foi recebido: o rollback não pode cancelar dinheiro que entrou. Trate o financeiro antes.`);
        }
        if (STATUS_TITULO_ENCERRADO.includes(st)) continue;
        plano.titulos.push({ id: t.id, valor: Number(t.valor) || 0, status: t.status });
    }
    return { plano, nfe, pedido, hist, ini };
}

/** Simulação: devolve o plano sem alterar nada (tela de confirmação do botão). */
async function simular(pool, nfeId, opcoes = {}) {
    await ensure(pool);
    const conn = await pool.getConnection();
    try { return (await montarPlano(conn, nfeId, opcoes)).plano; }
    finally { conn.release(); }
}

/**
 * Executa o rollback.
 *  - `origem`: 'automatico' (só rejeição definitiva) | 'manual';
 *  - `consultar(chave, uf, tpAmb)`: consulta a SEFAZ; usada quando o retorno é incerto.
 */
async function executar(pool, nfeId, { origem = 'manual', usuario = {}, motivo = null, consultar = null, req = null } = {}) {
    await ensure(pool);
    let classeInformada = null;

    // 1) Leitura sem trava para classificar e, se preciso, consultar a SEFAZ (rede, fora da transação).
    const [[previa]] = await pool.query('SELECT * FROM nfes WHERE id = ?', [nfeId]);
    if (!previa) throw falha('NFE_NAO_ENCONTRADA', 'NF-e não encontrada.', { status: 404 });
    const classe = classificarRetorno(previa);
    if (origem === 'automatico' && classe !== CLASSES.REJEICAO_DEFINITIVA) {
        throw falha('AUTOMATICO_SOMENTE_REJEICAO_DEFINITIVA', 'O rollback automático só roda em rejeição definitiva da SEFAZ.');
    }
    if (classe === CLASSES.INCERTA) {
        if (typeof consultar !== 'function' || !previa.chave_acesso) {
            throw falha('RESULTADO_INCERTO', `NF-e ${previa.numero}: retorno incerto e sem como consultar a SEFAZ. Confirme o status da chave antes de reverter.`);
        }
        const tpAmb = minusculo(previa.sefaz_ambiente) === 'producao' ? '1' : '2';
        const r = await consultar(previa.chave_acesso, previa.emitente_uf, tpAmb);
        if (!r) throw falha('SEFAZ_INDISPONIVEL_CONSULTA', 'Não foi possível consultar a chave na SEFAZ agora. Nada foi revertido; tente novamente.', { status: 503 });
        const cStat = String(r.codigoStatus || '');
        if (r.autorizado || cStat === '100') throw falha('AUTORIZADA_NA_SEFAZ', `A SEFAZ informa que a NF-e ${previa.numero} FOI autorizada. Nada foi revertido: reconcilie a nota como autorizada.`);
        if (DENEGADAS.has(cStat)) throw falha('NOTA_DENEGADA', `A SEFAZ informa NF-e ${previa.numero} denegada (cStat ${cStat}). Nada foi revertido.`);
        if (cStat !== '217') throw falha('RESULTADO_INCERTO', `Consulta na SEFAZ retornou cStat ${cStat || '?'} (${r.motivo || 'sem motivo'}): não é possível afirmar que a nota não foi autorizada. Nada foi revertido.`);
        classeInformada = CLASSES.REJEICAO_DEFINITIVA; // 217 = "NF-e não consta na base de dados da SEFAZ"
    }

    // 2) Transação: revalida com trava e desfaz.
    const conn = await pool.getConnection();
    let resultado;
    try {
        await conn.beginTransaction();
        const { plano, nfe, pedido } = await montarPlano(conn, nfeId, { travar: true, classeInformada });
        const agora = new Date();
        const motivoTxt = String(motivo || `Falha na SEFAZ${plano.nfe.codigoStatus ? ` (cStat ${plano.nfe.codigoStatus})` : ''}`).slice(0, 255);

        if (plano.escopo === 'FATURAMENTO_INTEGRAL') {
            // Estoque: devolve o que a baixa automática tirou e registra o estorno.
            for (const mov of plano.estoque) {
                const [[prod]] = await conn.query('SELECT id, codigo, estoque_atual FROM produtos WHERE codigo = ? LIMIT 1', [mov.codigo]);
                if (!prod) { plano.avisos.push(`Produto ${mov.codigo} não encontrado: estorno de estoque ignorado.`); continue; }
                const anterior = Number(prod.estoque_atual) || 0;
                const novo = anterior + mov.quantidade;
                await conn.query('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novo, prod.id]);
                await conn.query(
                    `INSERT INTO estoque_movimentacoes
                        (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                         documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                     VALUES (?, 'entrada', 'ajuste', ?, ?, ?, 'pedido_rollback', ?, ?, ?, NOW())`,
                    [prod.codigo, mov.quantidade, anterior, novo, pedido.id, usuario.id || null,
                     `Estorno por falha da NF-e ${nfe.numero} - Pedido #${pedido.id}`]);
            }

            // Financeiro: cancela os títulos abertos deste faturamento (mesma convenção do cancelamento de NF-e).
            for (const t of plano.titulos) {
                await tolera(() => conn.query(
                    `UPDATE contas_receber_parcelas SET status = 'cancelado'
                      WHERE conta_receber_id = ? AND status IN ('aberto', 'a_vencer', 'pendente')`, [t.id]), ['ER_NO_SUCH_TABLE']);
                await conn.query(
                    `UPDATE contas_receber SET status = 'cancelada', a_receber = 0, data_cancelamento = NOW(), motivo_cancelamento = ?
                      WHERE id = ?`, [`NF-e ${nfe.numero} não autorizada — faturamento revertido`.slice(0, 255), t.id]);
                await tolera(() => conn.query('UPDATE contas_receber SET valor_saldo = 0 WHERE id = ?', [t.id]), ['ER_BAD_FIELD_ERROR']);
            }

            // Pedido: volta ao status anterior e solta os vínculos com a nota.
            const cols = await colunasDe(conn, 'pedidos');
            const [[outraAutorizada]] = await conn.query(
                'SELECT COUNT(*) AS n FROM nfes WHERE pedido_id = ? AND protocolo_autorizacao IS NOT NULL AND id <> ?', [pedido.id, nfe.id]);
            const sets = [['status = ?', plano.statusAnterior]];
            for (const c of ['nf', 'numero_nf', 'nfe_id', 'nfe_chave', 'nfe_protocolo', 'nfe_faturamento_numero', 'nfe_erro']) {
                if (cols.has(c)) sets.push([`${c} = NULL`]);
            }
            if (cols.has('data_faturamento') && !Number(outraAutorizada && outraAutorizada.n)) sets.push(['data_faturamento = NULL']);
            if (cols.has('status_logistica') && minusculo(pedido.status_logistica) === 'pendente') sets.push(['status_logistica = NULL']);
            if (cols.has('updated_at')) sets.push(['updated_at = NOW()']);
            await conn.query(`UPDATE pedidos SET ${sets.map(s => s[0]).join(', ')} WHERE id = ?`,
                [...sets.filter(s => s.length > 1).map(s => s[1]), pedido.id]);

            await tolera(() => conn.query(
                'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                [pedido.id, usuario.id || null, usuario.nome || (origem === 'automatico' ? 'Sistema' : 'Usuário'), 'rollback_faturamento',
                 `Faturamento revertido: NF-e ${nfe.numero} não autorizada pela SEFAZ. Pedido voltou para "${plano.statusAnterior}".`,
                 JSON.stringify({ nfe_id: nfe.id, numero: nfe.numero, cstat: plano.nfe.codigoStatus, origem, motivo: motivoTxt,
                                  estoque: plano.estoque.length, titulos: plano.titulos.map(t => t.id) })]), ['ER_BAD_FIELD_ERROR']);
        }

        // Nota: encerrada e desvinculada do pedido (senão bloquearia um novo faturamento
        // e poderia ser retransmitida órfã). O número fica registrado como lacuna.
        await conn.query(
            `UPDATE nfes SET rollback_em = ?, rollback_por = ?, rollback_origem = ?, rollback_motivo = ?,
                    pedido_id_origem = pedido_id, pedido_id = NULL
              WHERE id = ?`, [agora, usuario.id || null, origem, motivoTxt, nfe.id]);
        await conn.commit();
        resultado = { revertida: true, origem, escopo: plano.escopo, plano, motivo: motivoTxt };
    } catch (erro) {
        await conn.rollback().catch(() => {});
        // Recusa também fica no log de não repúdio (melhor esforço).
        await audit.registrar(pool, {
            evento: audit.EVENTOS.ROLLBACK_RECUSADO, categoria: 'ROLLBACK', nfeId, numero: previa.numero, serie: previa.serie,
            chaveAcesso: previa.chave_acesso, pedidoId: previa.pedido_id,
            ...audit.identidade(req), ...(usuario.id ? { usuarioId: usuario.id } : {}),
            origemConfirmacao: origem, resultadoCodigo: String(erro.code || 'ERRO').slice(0, 10), resultadoMotivo: erro.message
        }).catch(e => console.error('[NFE-ROLLBACK] log de recusa falhou:', e.message));
        throw erro;
    } finally {
        conn.release();
    }

    await audit.registrar(pool, {
        evento: audit.EVENTOS.ROLLBACK, categoria: 'ROLLBACK', nfeId, numero: previa.numero, serie: previa.serie,
        chaveAcesso: previa.chave_acesso, pedidoId: previa.pedido_id,
        ...audit.identidade(req), ...(usuario.id ? { usuarioId: usuario.id } : {}),
        origemConfirmacao: origem, resultadoCodigo: String(resultado.plano.nfe.codigoStatus || '').slice(0, 10) || null,
        resultadoMotivo: resultado.motivo,
        pendencias: [{ campo: 'rollback', mensagem: `escopo=${resultado.escopo}; estoque=${resultado.plano.estoque.length}; titulos=${resultado.plano.titulos.length}; lacuna=${previa.numero}/${previa.serie}` }]
    }).catch(e => console.error('[NFE-ROLLBACK] log do rollback falhou:', e.message));
    return resultado;
}

/**
 * Uso automático (chamado quando a SEFAZ acabou de rejeitar): nunca lança — devolve o
 * resultado ou o motivo de não ter revertido, para o chamador informar o usuário.
 */
async function aoRejeitar(pool, nfeId, { usuario = {}, req = null } = {}) {
    try {
        return await executar(pool, nfeId, { origem: 'automatico', usuario, req });
    } catch (erro) {
        console.warn(`[NFE-ROLLBACK] rollback automático não executado (NF-e ${nfeId}): ${erro.code || ''} ${erro.message}`);
        return { revertida: false, codigo: erro.code || 'ERRO', motivo: erro.message };
    }
}

module.exports = { CLASSES, classificarRetorno, montarPlano, simular, executar, aoRejeitar, ensure };
