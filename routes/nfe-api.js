'use strict';

/**
 * NFe API routes — extracted from server.js
 * Endpoints: preview, emitir, validar, configuracoes
 */
const express = require('express');

module.exports = function createNfeApiRouter({ authenticateToken, pool }) {
    const router = express.Router();

    // Formata valor em BRL para uso em mensagens de erro
    function formatarValor(v) {
        return 'R$' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Escapa caracteres especiais XML para prevenir XML injection
    function escapeXml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // Compatibilidade com o Vendas legado: o front antigo consultava
    // /api/nfe/pedido/:id antes de abrir o DANFE do pedido.
    router.get('/pedido/:pedidoId', authenticateToken, async (req, res) => {
        try {
            const pedidoId = Number(req.params.pedidoId);
            if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
                return res.status(400).json({ success: false, message: 'Pedido invalido.' });
            }

            const [[pedido]] = await pool.query(
                `SELECT id, nf, numero_nf, nfe_id, nfe_chave, nfe_faturamento_numero, nfe_remessa_numero
                   FROM pedidos
                  WHERE id = ?
                  LIMIT 1`,
                [pedidoId]
            );

            if (!pedido) {
                return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' });
            }

            const numeroPedido = pedido.nf || pedido.numero_nf || pedido.nfe_faturamento_numero || pedido.nfe_remessa_numero || null;
            let nfe = null;

            try {
                const [[row]] = await pool.query(
                    `SELECT id, numero, chave_acesso, protocolo_autorizacao, status
                       FROM nfes
                      WHERE (id = ? OR pedido_id = ?)
                        AND COALESCE(status, '') <> 'cancelada'
                   ORDER BY (status = 'autorizada') DESC, id DESC
                      LIMIT 1`,
                    [pedido.nfe_id || 0, pedidoId]
                );
                if (row) nfe = row;
            } catch (_) {
                // A tabela nfes nao existe em todas as instancias antigas.
            }

            if (!nfe) {
                try {
                    const [[row]] = await pool.query(
                        `SELECT id, COALESCE(numero_nfe, numero) AS numero, chave_acesso, protocolo_nfe AS protocolo_autorizacao, status
                           FROM nfe
                          WHERE (id = ? OR pedido_id = ?)
                            AND COALESCE(status, '') <> 'cancelada'
                       ORDER BY (status = 'autorizada') DESC, id DESC
                          LIMIT 1`,
                        [pedido.nfe_id || 0, pedidoId]
                    );
                    if (row) nfe = row;
                } catch (_) {
                    // Fallback legado best-effort.
                }
            }

            const numero = nfe?.numero || numeroPedido;
            const chave = nfe?.chave_acesso || pedido.nfe_chave || null;
            if (!numero && !chave) {
                return res.status(404).json({ success: false, message: 'Este pedido ainda nao possui NF-e emitida.' });
            }

            res.json({
                success: true,
                pedido_id: pedidoId,
                nfe_id: nfe?.id || pedido.nfe_id || null,
                numero,
                chave_acesso: chave,
                protocolo: nfe?.protocolo_autorizacao || null,
                status: nfe?.status || null,
                danfe_url: `/api/vendas/pedidos/${pedidoId}/danfe`
            });
        } catch (err) {
            console.error('[NFe Pedido] Erro:', err);
            res.status(500).json({ success: false, message: 'Erro interno ao buscar NF-e do pedido.' });
        }
    });

    // POST /api/nfe/preview
    router.post('/preview', authenticateToken, async (req, res) => {
        try {
            const nfeData = req.body;
            if (!nfeData || !nfeData.itens || !nfeData.itens.length) {
                return res.status(400).json({ success: false, message: 'Dados da NFe inválidos. Adicione ao menos um item.' });
            }

            const dest = nfeData.destinatario || {};
            const totalValue = nfeData.totais?.valorTotal || nfeData.itens.reduce((s, i) => s + (i.valorTotal || 0), 0);
            const now = new Date().toISOString();

            let itensXml = '';
            (nfeData.itens || []).forEach((item, idx) => {
                itensXml += `
    <det nItem="${parseInt(item.numero, 10) || idx + 1}">
      <prod>
        <cProd>${escapeXml(item.codigo)}</cProd>
        <xProd>${escapeXml(item.descricao)}</xProd>
        <NCM>${escapeXml(item.ncm)}</NCM>
        <CFOP>${escapeXml(item.cfop || '5102')}</CFOP>
        <uCom>${escapeXml(item.unidade || 'UN')}</uCom>
        <qCom>${parseFloat(item.quantidade) || 0}</qCom>
        <vUnCom>${(parseFloat(item.valorUnitario) || 0).toFixed(2)}</vUnCom>
        <vProd>${(parseFloat(item.valorTotal) || 0).toFixed(2)}</vProd>
      </prod>
      <imposto>
        <ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>
      </imposto>
    </det>`;
            });

            const tipoDoc = ['CNPJ', 'CPF'].includes(dest.tipoDocumento) ? dest.tipoDocumento : 'CNPJ';

            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00">
    <ide>
      <natOp>${escapeXml(nfeData.naturezaOperacao || 'Venda de mercadoria')}</natOp>
      <tpNF>${['0', '1'].includes(String(nfeData.tipoOperacao)) ? nfeData.tipoOperacao : '1'}</tpNF>
      <dhEmi>${escapeXml(nfeData.dataEmissao || now)}</dhEmi>
      <tpAmb>2</tpAmb>
    </ide>
    <dest>
      <${tipoDoc}>${escapeXml(dest.documento)}</${tipoDoc}>
      <xNome>${escapeXml(dest.nome)}</xNome>
      <enderDest>
        <xLgr>${escapeXml(dest.endereco)}</xLgr>
        <nro>${escapeXml(dest.numero)}</nro>
        <xCpl>${escapeXml(dest.complemento)}</xCpl>
        <xBairro>${escapeXml(dest.bairro)}</xBairro>
        <cMun>${escapeXml(dest.codigoMunicipio)}</cMun>
        <xMun>${escapeXml(dest.municipio)}</xMun>
        <UF>${escapeXml(dest.uf)}</UF>
        <CEP>${(dest.cep || '').replace(/\D/g, '')}</CEP>
      </enderDest>
      <email>${escapeXml(dest.email)}</email>
    </dest>${itensXml}
    <total>
      <ICMSTot>
        <vProd>${(parseFloat(nfeData.totais?.totalProdutos) || totalValue).toFixed(2)}</vProd>
        <vDesc>${(parseFloat(nfeData.totais?.totalDesconto) || 0).toFixed(2)}</vDesc>
        <vFrete>${(parseFloat(nfeData.totais?.totalFrete) || 0).toFixed(2)}</vFrete>
        <vNF>${totalValue.toFixed(2)}</vNF>
      </ICMSTot>
    </total>
  </infNFe>
</NFe>`;

            res.json({ success: true, xml });
        } catch (err) {
            console.error('[NFe Preview] Erro:', err);
            res.status(500).json({ success: false, message: 'Erro interno ao gerar preview da NFe.' });
        }
    });

    // POST /api/nfe/emitir
    router.post('/emitir', authenticateToken, async (req, res) => {
        // [FISCAL-SAFETY] ROTA DESCONTINUADA — este proxy encaminhava a emissão para
        // localhost:3003, que é a instância "zyntra-demo" (ver deploy/nginx-zyntra-demo.conf),
        // e NÃO o motor fiscal correto. A emissão fiscal real roda in-process em
        // /api/faturamento/* (server.js). Mantido apenas como stub para evitar emissão cruzada.
        return res.status(410).json({
            success: false,
            code: 'ROTA_DESCONTINUADA',
            message: 'Esta rota de emissão foi descontinuada. Use /api/faturamento/gerar-nfe e /api/faturamento/nfes/:id/enviar-sefaz.'
        });
        // eslint-disable-next-line no-unreachable
        try {
            const nfeData = req.body;
            if (!nfeData || !nfeData.itens || !nfeData.itens.length) {
                return res.status(400).json({ success: false, message: 'Dados da NFe inválidos. Adicione ao menos um item.' });
            }

            try {
                const http = require('http');
                const payload = JSON.stringify(nfeData);
                const faturamentoReq = http.request({
                    hostname: 'localhost',
                    port: 3003,
                    path: '/api/faturamento/enviar-sefaz',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
                        'Authorization': req.headers['authorization'] || ''
                    },
                    timeout: 30000
                }, (faturamentoRes) => {
                    let body = '';
                    faturamentoRes.on('data', chunk => body += chunk);
                    faturamentoRes.on('end', () => {
                        try {
                            const result = JSON.parse(body);
                            res.status(faturamentoRes.statusCode).json(result);
                        } catch {
                            res.status(502).json({ success: false, message: 'Resposta inválida do serviço de faturamento.' });
                        }
                    });
                });
                faturamentoReq.on('error', () => {
                    res.status(503).json({
                        success: false,
                        message: 'Serviço de faturamento (SEFAZ) não está disponível no momento. Verifique se o módulo de Faturamento está em execução (porta 3003) e tente novamente.',
                        code: 'FATURAMENTO_OFFLINE'
                    });
                });
                faturamentoReq.on('timeout', () => {
                    faturamentoReq.destroy();
                    res.status(504).json({ success: false, message: 'Timeout ao conectar com serviço de faturamento.' });
                });
                faturamentoReq.write(payload);
                faturamentoReq.end();
            } catch (proxyErr) {
                console.error('[NFe Emitir] Erro de proxy:', proxyErr);
                res.status(503).json({
                    success: false,
                    message: 'Serviço de faturamento indisponível. Configure o módulo de Faturamento para emissão de NFe.',
                    code: 'FATURAMENTO_OFFLINE'
                });
            }
        } catch (err) {
            console.error('[NFe Emitir] Erro:', err);
            res.status(500).json({ success: false, message: 'Erro interno ao emitir NFe.' });
        }
    });

    // POST /api/nfe/validar
    router.post('/validar', authenticateToken, async (req, res) => {
        try {
            const nfeData = req.body;
            const erros = [];

            if (!nfeData) {
                return res.status(400).json({ valid: false, errors: ['Dados da NFe não fornecidos.'] });
            }

            if (!nfeData.naturezaOperacao) erros.push('Natureza da operação é obrigatória.');
            if (!nfeData.dataEmissao) erros.push('Data de emissão é obrigatória.');

            const dest = nfeData.destinatario || {};
            if (!dest.documento) erros.push('Documento do destinatário (CNPJ/CPF) é obrigatório.');
            if (!dest.nome) erros.push('Nome/Razão Social do destinatário é obrigatório.');
            if (!dest.endereco) erros.push('Endereço do destinatário é obrigatório.');
            if (!dest.numero) erros.push('Número do endereço é obrigatório.');
            if (!dest.bairro) erros.push('Bairro é obrigatório.');
            if (!dest.municipio) erros.push('Município é obrigatório.');
            if (!dest.uf) erros.push('UF é obrigatória.');
            if (!dest.cep) erros.push('CEP é obrigatório.');

            if (dest.documento) {
                const doc = dest.documento.replace(/\D/g, '');
                if (dest.tipoDocumento === 'CNPJ' && doc.length !== 14) erros.push('CNPJ inválido (deve ter 14 dígitos).');
                if (dest.tipoDocumento === 'CPF' && doc.length !== 11) erros.push('CPF inválido (deve ter 11 dígitos).');
            }

            if (!nfeData.itens || !nfeData.itens.length) {
                erros.push('Adicione ao menos um item à NFe.');
            } else {
                let valorTotalItens = 0;
                nfeData.itens.forEach((item, idx) => {
                    const n = idx + 1;
                    if (!item.descricao) erros.push(`Item ${n}: descrição é obrigatória.`);
                    if (!item.ncm) erros.push(`Item ${n}: NCM é obrigatório.`);
                    if (!item.cfop) erros.push(`Item ${n}: CFOP é obrigatório.`);
                    if (!item.quantidade || item.quantidade <= 0) erros.push(`Item ${n}: quantidade deve ser maior que zero.`);
                    // FISC-007: Bloquear NF-e com produto de valor zero
                    if (item.valorUnitario === undefined || item.valorUnitario === null || parseFloat(item.valorUnitario) <= 0) {
                        erros.push(`Item ${n} (${item.descricao || 'sem nome'}): valor unitário deve ser maior que zero. Produtos com preço R$0,00 não podem ser faturados.`);
                    } else {
                        valorTotalItens += parseFloat(item.quantidade || 0) * parseFloat(item.valorUnitario);
                    }
                });

                // FISC-006: Validar que condições de pagamento somam = valor total da NF-e
                const pagamentos = nfeData.pagamentos || nfeData.formasPagamento || [];
                if (pagamentos.length > 0 && valorTotalItens > 0) {
                    const totalPagamentos = pagamentos.reduce((s, p) => s + parseFloat(p.valor || p.amount || 0), 0);
                    const diff = Math.abs(totalPagamentos - valorTotalItens);
                    if (diff > 0.05) { // tolerância de R$0,05 para arredondamentos
                        erros.push(`Condições de pagamento (${formatarValor(totalPagamentos)}) não batem com o total da NF-e (${formatarValor(valorTotalItens)}). Diferença: R$${diff.toFixed(2)}.`);
                    }
                }
            }

            if (erros.length > 0) {
                return res.json({ valid: false, success: false, errors: erros });
            }

            res.json({ valid: true, success: true, message: 'XML validado com sucesso! Nenhum erro encontrado.' });
        } catch (err) {
            console.error('[NFe Validar] Erro:', err);
            res.status(500).json({ valid: false, errors: ['Erro interno ao validar NFe.'] });
        }
    });

    // GET /api/nfe/listar — Lista NF-es para espelho/consulta
    router.get('/listar', authenticateToken, async (req, res) => {
        try {
            const limite = Math.min(parseInt(req.query.limite) || 100, 500);
            const offset = Math.max(parseInt(req.query.offset) || 0, 0);
            let rows = [];

            // Tabelas com schema de NF-e produto (DANFE)
            const queries = [
                { table: 'notas_fiscais', sql: `SELECT id, numero, serie, chave_acesso, cliente_nome AS destinatario_nome, cliente_cnpj AS destinatario_cnpj, data_emissao, valor_total, status, protocolo_autorizacao AS numero_protocolo, pedido_numero FROM notas_fiscais ORDER BY id DESC LIMIT ? OFFSET ?` },
                { table: 'nfes', sql: `SELECT id, numero, serie, chave_acesso, destinatario_nome, destinatario_cnpj_cpf AS destinatario_cnpj, data_emissao, valor_total, status, protocolo_autorizacao AS numero_protocolo, NULL AS pedido_numero FROM nfes ORDER BY id DESC LIMIT ? OFFSET ?` }
            ];

            for (const q of queries) {
                try {
                    const [result] = await pool.query(q.sql, [limite, offset]);
                    if (result && result.length > 0) {
                        rows = rows.concat(result);
                    }
                } catch (_) {}
            }

            // Ordenar por id desc (merge das tabelas)
            rows.sort((a, b) => (b.id || 0) - (a.id || 0));
            rows = rows.slice(0, limite);

            const notas = rows.map(row => ({
                id:           row.id,
                numero:       row.numero || '',
                serie:        row.serie || '1',
                destinatario: row.destinatario_nome || '',
                cnpj:         row.destinatario_cnpj || '',
                dataEmissao:  row.data_emissao || null,
                valor:        parseFloat(row.valor_total || 0),
                status:       row.status || 'rascunho',
                chave:        row.chave_acesso || '',
                protocolo:    row.numero_protocolo || '',
                pedido:       row.pedido_numero || ''
            }));

            res.json({ notas, total: notas.length });
        } catch (err) {
            console.error('[NFe Listar] Erro:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // GET /api/nfe/:id/espelho — Pré-visualização HTML sem valor fiscal
    router.get('/:id/espelho', authenticateToken, async (req, res) => {
        try {
            const nfeId = req.params.id;
            let row = null;

            const tryTables = async (whereClause, params) => {
                for (const table of ['nfes', 'nfe']) {
                    try {
                        const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE ${whereClause} LIMIT 1`, params);
                        if (rows && rows[0]) return rows[0];
                    } catch (_) { /* table may not exist */ }
                }
                return null;
            };

            if (/^\d{44}$/.test(nfeId)) {
                row = await tryTables('chave_acesso = ?', [nfeId]);
            } else if (/^\d+$/.test(nfeId)) {
                row = await tryTables('id = ?', [parseInt(nfeId)]);
                if (!row) row = await tryTables('numero = ? OR numero_nfe = ?', [nfeId, nfeId]);
            } else {
                row = await tryTables('numero = ? OR numero_nfe = ?', [nfeId, nfeId]);
                if (!row && /^\d+$/.test(nfeId.replace(/\D/g, ''))) {
                    row = await tryTables('id = ?', [parseInt(nfeId.replace(/\D/g, ''))]);
                }
            }

            if (!row) {
                return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px;"><h2 style="color:#ef4444;">NF-e não encontrada</h2><p>ID/Chave: ' + escapeXml(nfeId) + '</p></body></html>');
            }

            // Normaliza campos entre tabelas nfes e nfe
            const nfe = {
                id: row.id,
                numero: row.numero || row.numero_nfe || '',
                serie: row.serie || '1',
                chave_acesso: row.chave_acesso || '',
                status: row.status || 'pendente',
                data_emissao: row.data_emissao,
                protocolo: row.protocolo_nfe || row.numero_protocolo || '',
                natureza_operacao: row.natureza_operacao || 'Venda de Produtos',
                tipo_operacao: row.tipo_operacao || row.tpNF || '1',
                modalidade_frete: row.modalidade_frete,
                destinatario_nome: row.destinatario_nome || row.destinatario || '',
                destinatario_cnpj: row.destinatario_cnpj || row.cli_cnpj || '',
                destinatario_ie: row.destinatario_ie || row.cli_ie || '',
                destinatario_end: (row.destinatario_logradouro || row.cli_endereco || '') + (row.destinatario_bairro || row.cli_bairro ? ', ' + (row.destinatario_bairro || row.cli_bairro) : ''),
                destinatario_cidade: row.destinatario_municipio || row.destinatario_cidade || row.cli_cidade || '',
                destinatario_uf: row.destinatario_uf || row.cli_uf || '',
                destinatario_cep: row.destinatario_cep || row.cli_cep || '',
                destinatario_email: row.destinatario_email || row.cli_email || '',
                valor_total: row.valor_total || row.valor || 0
            };

            // Itens
            let itens = [];
            try {
                const nfeIdNum = parseInt(row.id);
                for (const table of ['nfe_itens', 'nfes_itens']) {
                    try {
                        const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE nfe_id = ?`, [nfeIdNum]);
                        if (rows && rows.length) { itens = rows; break; }
                    } catch (_) {}
                }
            } catch (_) {}
            // Fallback: busca itens via pedido_itens se NF-e não tem itens próprios (ex.: NF-e
            // ainda pendente, sem nfe_itens gravado). Inclui o mesmo JOIN com `produtos` usado
            // no /danfe oficial para trazer NCM/CFOP/CST/CSOSN/alíquotas reais em vez de campos
            // vazios — ver memória nfe-emitente-empresas-bug-2026-06-28.
            if (!itens.length && (row.pedido_id || row.venda_id)) {
                try {
                    const pedidoId = row.pedido_id || row.venda_id;
                    const [rows] = await pool.query(`
                        SELECT pi.codigo AS codigo_produto, pi.descricao, pi.unidade, pi.quantidade,
                               pi.preco_unitario AS valor_unitario, pi.desconto AS valor_desconto, pi.subtotal AS valor_total,
                               pi.icms_value AS valor_icms, pi.aliquota_icms, pi.valor_ipi, pi.aliquota_ipi, pi.cfop AS cfop_item,
                               COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                               COALESCE(pi.cfop, pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS cfop,
                               COALESCE(pr_id.cst_icms, pr_cod.cst_icms) AS cst,
                               COALESCE(pr_id.csosn_icms, pr_cod.csosn_icms) AS csosn,
                               COALESCE(pr_id.aliquota_icms, pr_cod.aliquota_icms) AS produto_aliquota_icms,
                               COALESCE(pr_id.aliquota_ipi, pr_cod.aliquota_ipi) AS produto_aliquota_ipi
                        FROM pedido_itens pi
                        LEFT JOIN produtos pr_id ON pi.produto_id = pr_id.id
                        LEFT JOIN produtos pr_cod ON pi.produto_id IS NULL AND pr_cod.codigo = pi.codigo
                        WHERE pi.pedido_id = ? ORDER BY pi.id ASC
                    `, [pedidoId]);
                    if (rows && rows.length) {
                        // pedido_itens.aliquota_icms/aliquota_ipi/valor_ipi têm DEFAULT 0.00 (não
                        // NULL) quando nunca preenchidos — tratar 0 como "não definido" e cair no
                        // dado fiscal do produto e, por fim, na alíquota padrão da empresa (mesma
                        // lógica de buildDanfeCtx/firstPositiveOrLast em danfe-renderer.js).
                        const firstPositiveOrLast = (...vals) => {
                            for (let i = 0; i < vals.length; i++) {
                                const n = parseFloat(vals[i]);
                                if (!isNaN(n) && (n > 0 || i === vals.length - 1)) return n;
                            }
                            return 0;
                        };
                        itens = rows.map(it => {
                            const sub = parseFloat(it.valor_total) || 0;
                            const aliqIcms = firstPositiveOrLast(it.aliquota_icms, it.produto_aliquota_icms, aliqIcmsPadraoEspelho);
                            const aliqIpi = firstPositiveOrLast(it.aliquota_ipi, it.produto_aliquota_ipi, aliqIpiPadraoEspelho);
                            const vIcms = it.valor_icms != null && parseFloat(it.valor_icms) > 0
                                ? parseFloat(it.valor_icms) : (sub * aliqIcms / 100);
                            const vIpi = firstPositiveOrLast(it.valor_ipi, sub * aliqIpi / 100);
                            return {
                                ...it,
                                aliquota_icms: aliqIcms,
                                aliquota_ipi: aliqIpi,
                                valor_icms: vIcms,
                                valor_ipi: vIpi,
                                base_icms: aliqIcms > 0 ? (vIcms / (aliqIcms / 100)) : sub
                            };
                        });
                    }
                } catch (_) {}
            }

            // Alíquotas padrão da empresa (fallback quando pedido_itens/produtos não têm
            // alíquota própria configurada — usado no fallback de itens abaixo).
            const [[cfgFiscalEspelho]] = await pool.query('SELECT * FROM config_fiscal_empresa LIMIT 1').catch(() => [[]]);
            const aliqIcmsPadraoEspelho = parseFloat(cfgFiscalEspelho && cfgFiscalEspelho.icms_padrao) || 0;
            const aliqIpiPadraoEspelho = parseFloat(cfgFiscalEspelho && cfgFiscalEspelho.ipi_padrao) || 0;

            // Emitente — FiscalProfileService (mesma fonte usada na emissão real, já validada
            // contra o certificado digital). BUG-FIX 2026-06-28: a cascata antiga caía no
            // fallback `empresas WHERE id = empresa_id`, mas essa tabela é, na prática, um
            // cadastro de CLIENTES — o registro id=1 (empresa_id padrão de todo usuário
            // Aluforce) era um cliente inativo de teste, fazendo o espelho da NF-e exibir o
            // emitente errado. Ver memória nfe-emitente-empresas-bug-2026-06-28.
            let emit = { razaoSocial: '', nomeFantasia: '', cnpj: '', ie: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: 'SP', cep: '', telefone: '', logoPath: '' };
            try {
                const FiscalProfileService = require('../modules/Faturamento/services/fiscal-profile.service');
                const perfil = await FiscalProfileService.carregar(pool);
                emit = {
                    razaoSocial: perfil.razaoSocial || '', nomeFantasia: perfil.nomeFantasia || '',
                    cnpj: perfil.cnpj || '', ie: perfil.ie || '',
                    logradouro: perfil.logradouro || '', numero: perfil.numero || '', bairro: perfil.bairro || '',
                    cidade: perfil.municipio || '', uf: perfil.uf || 'SP', cep: perfil.cep || '',
                    telefone: perfil.telefone || '', logoPath: ''
                };
            } catch (_) {}
            if (!emit.logoPath) {
                try {
                    const [r] = await pool.query("SELECT logo_path FROM configuracoes_empresa LIMIT 1");
                    emit.logoPath = (r && r[0] && r[0].logo_path) || '';
                } catch (_) {}
            }

            // Usar danfe-renderer.js para layout DANFE oficial A4
            const { renderDanfe } = require('./danfe-renderer');

            const fmtMoney = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fmtQty   = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
            const fmtDate  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR'); };
            const fmtTime  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

            const isPreview  = !nfe.chave_acesso && !nfe.protocolo;
            const chave      = nfe.chave_acesso || '';
            const valorTotal = parseFloat(nfe.valor_total) || 0;
            const totalItens = itens.reduce((s, i) => s + parseFloat(i.valor_total || 0), 0);
            const valorNF    = valorTotal || totalItens;

            // Separar logradouro / número do destinatário
            const splitEnd = str => { const m = (str || '').match(/^(.+?),\s*(\S+.*)$/); return m ? [m[1].trim(), m[2].trim()] : [(str || ''), '']; };
            const [dstLgr, dstNro] = splitEnd(nfe.destinatario_end);

            // Duplicatas (se tabela existir)
            let dups = [];
            try {
                const [dupRows] = await pool.query('SELECT * FROM nfe_duplicatas WHERE nfe_id = ? ORDER BY numero', [row.id]);
                dups = dupRows.map(d => ({ nDup: d.numero || '', dVenc: fmtDate(d.vencimento), vDup: fmtMoney(d.valor) }));
            } catch (_) { /* tabela pode não existir */ }

            const logoUrl = emit.logoPath || '/images/Logo Monocromatico - Azul - Aluforce.png';

            const ctx = {
                marcaAguaClasse: isPreview ? '' : 'hidden',
                avisoTopo: isPreview ? 'DOCUMENTO DE PRÉVIA — NÃO POSSUI VALOR FISCAL' : '',
                paginaAtual: '1',
                paginaTotal: '1',
                codigoBarrasUrl: chave ? `https://barcodeapi.org/api/128/${chave}` : '',
                emitenteLogoUrl: logoUrl,
                portalConsultaUrl: 'www.nfe.fazenda.gov.br/portal',
                NFe: {
                    infNFe: {
                        ide: {
                            nNF: nfe.numero || '',
                            serie: nfe.serie || '1',
                            tpNF: nfe.tipo_operacao || '1',
                            natOp: nfe.natureza_operacao || 'Venda de Mercadoria',
                            dhEmi: fmtDate(nfe.data_emissao),
                            dhSaiEnt: fmtDate(row.data_saida || nfe.data_emissao),
                            _danfeHoraSaida: fmtTime(row.data_saida || nfe.data_emissao)
                        },
                        emit: {
                            xNome: emit.razaoSocial,
                            xFant: emit.nomeFantasia,
                            CNPJ: emit.cnpj, CPF: '',
                            IE: emit.ie, IEST: '', CRT: row.crt || '', IM: '', email: '',
                            enderEmit: {
                                xLgr: emit.logradouro, nro: emit.numero, xCpl: '',
                                xBairro: emit.bairro, xMun: emit.cidade, UF: emit.uf,
                                CEP: emit.cep, fone: emit.telefone
                            }
                        },
                        dest: {
                            xNome: nfe.destinatario_nome || '',
                            CNPJ: (nfe.destinatario_cnpj || '').length > 11 ? (nfe.destinatario_cnpj || '') : '',
                            CPF: (nfe.destinatario_cnpj || '').length <= 11 ? (nfe.destinatario_cnpj || '') : '',
                            IE: nfe.destinatario_ie || '',
                            indIEDest: nfe.destinatario_ie ? '1' : '9',
                            enderDest: {
                                xLgr: dstLgr, nro: dstNro, xCpl: '',
                                xBairro: row.destinatario_bairro || row.cli_bairro || '',
                                xMun: nfe.destinatario_cidade || '',
                                UF: nfe.destinatario_uf || '',
                                CEP: nfe.destinatario_cep || '',
                                fone: row.destinatario_telefone || row.cli_telefone || ''
                            }
                        },
                        cobr: {
                            fat: { nFat: nfe.numero || '', vOrig: fmtMoney(valorNF), vLiq: fmtMoney(valorNF) },
                            dup: dups
                        },
                        det: itens.map((item, i) => {
                            // BUG-FIX 2026-06-28: coluna real é `base_calculo_icms` (gravada pelo
                            // emissor real em nfe_itens); `base_icms` nunca existiu, então a BC do
                            // ICMS sempre mostrava 0,00. Para itens vindos do fallback pedido_itens
                            // (sem NF-e gravada ainda), `base_icms` é calculado acima a partir do
                            // valor/alíquota disponíveis.
                            const aliqIcms = parseFloat(item.aliquota_icms) || 0;
                            const vIcms = parseFloat(item.valor_icms) || 0;
                            const vTotal = parseFloat(item.valor_total) || 0;
                            const bcIcms = item.base_calculo_icms != null
                                ? item.base_calculo_icms
                                : (item.base_icms != null ? item.base_icms : (aliqIcms > 0 ? (vIcms / (aliqIcms / 100)) : vTotal));
                            return {
                                prod: {
                                    cProd: item.codigo_produto || item.codigo || String(i + 1).padStart(3, '0'),
                                    xProd: item.descricao || '',
                                    NCM: item.ncm || '',
                                    CFOP: item.cfop || '',
                                    uCom: item.unidade || 'UN',
                                    qCom: fmtQty(item.quantidade),
                                    vUnCom: fmtMoney(item.valor_unitario),
                                    vProd: fmtMoney(item.valor_total)
                                },
                                _danfeCstCsosn: item.cst || item.csosn || '',
                                _danfeBcIcms: fmtMoney(bcIcms),
                                _danfeVIcms: fmtMoney(vIcms),
                                _danfePIcms: aliqIcms ? fmtMoney(aliqIcms) : '',
                                _danfeVIpi: fmtMoney(item.valor_ipi || 0),
                                _danfePIpi: item.aliquota_ipi ? fmtMoney(item.aliquota_ipi) : ''
                            };
                        }),
                        total: (() => {
                            // BUG-FIX 2026-06-28: mysql2 retorna DECIMAL como string ("0.00"), que
                            // é truthy em JS — "0.00" || calc nunca cai no somatório dos itens.
                            // parseFloat(...) converte pra número (0 é falsy) antes do fallback.
                            const rowBcIcms = parseFloat(row.base_calculo_icms) || 0;
                            const rowVIcms = parseFloat(row.valor_icms) || 0;
                            const rowVIpi = parseFloat(row.valor_ipi) || 0;
                            const rowVPis = parseFloat(row.valor_pis) || 0;
                            const rowVCofins = parseFloat(row.valor_cofins) || 0;
                            const somaBcIcms = itens.reduce((s, it) => s + (parseFloat(it.base_calculo_icms ?? it.base_icms) || 0), 0);
                            const somaVIcms = itens.reduce((s, it) => s + (parseFloat(it.valor_icms) || 0), 0);
                            const somaVIpi = itens.reduce((s, it) => s + (parseFloat(it.valor_ipi) || 0), 0);
                            return {
                            ICMSTot: {
                                vBC: fmtMoney(rowBcIcms || somaBcIcms),
                                vICMS: fmtMoney(rowVIcms || somaVIcms),
                                vBCST: fmtMoney(row.base_calculo_st || 0),
                                vST: fmtMoney(row.valor_icms_st || 0),
                                vTotTrib: fmtMoney(row.valor_tributos
                                    || ((rowVIcms || somaVIcms) + (rowVIpi || somaVIpi) + rowVPis + rowVCofins)),
                                vProd: fmtMoney(totalItens),
                                vFCPSTRet: '0,00',
                                vFrete: fmtMoney(row.valor_frete || 0),
                                vSeg: fmtMoney(row.valor_seguro || 0),
                                vDesc: fmtMoney(row.valor_desconto || 0),
                                vOutro: fmtMoney(row.outras_despesas || 0),
                                vIPI: fmtMoney(rowVIpi || somaVIpi),
                                vPIS: fmtMoney(rowVPis),
                                vCOFINS: fmtMoney(rowVCofins),
                                vNF: fmtMoney(valorNF),
                                vII: '0,00'
                            },
                            ISSQNtot: { vServ: '', vBC: '', vISS: '', cMunFG: '' }
                            };
                        })(),
                        transp: {
                            modFrete: { '0': '0 - Emitente', '1': '1 - Destinatário', '9': '9 - Sem Frete' }[nfe.modalidade_frete] || '',
                            transporta: { xNome: row.transportadora_nome || '', CNPJ: '', CPF: '', IE: '', xEnder: '', xMun: '', UF: '' },
                            veicTransp: { placa: '', UF: '', RNTC: '' },
                            _danfeQVol: row.qtd_volumes || '', _danfeEsp: row.especie_volumes || '',
                            _danfeMarca: '', _danfeNVol: '',
                            _danfePesoB: row.peso_bruto ? fmtMoney(row.peso_bruto) : '',
                            _danfePesoL: row.peso_liquido ? fmtMoney(row.peso_liquido) : ''
                        },
                        infAdProd: '',
                        infAdic: {
                            infCpl: row.informacoes_complementares || row.observacao || '',
                            infAdFisco: row.informacoes_fisco || ''
                        }
                    }
                },
                protNFe: {
                    infProt: {
                        chNFe: chave,
                        nProt: nfe.protocolo || (isPreview ? 'Pré-autorização' : ''),
                        dhRecbto: fmtDate(row.data_autorizacao || nfe.data_emissao)
                    }
                }
            };

            const html = renderDanfe(ctx);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            return res.send(html);

        } catch (err) {
            console.error('[NFe Espelho] Erro:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // GET /api/nfe/configuracoes
    router.get('/configuracoes', authenticateToken, async (req, res) => {
        try {
            const empresaId = req.user?.empresa_id || 1;

            // Identidade do emitente — FiscalProfileService (mesma fonte da emissão real).
            // BUG-FIX 2026-06-28: o fallback antigo (`empresas WHERE id = empresa_id`) lia de
            // uma tabela que é, na prática, um cadastro de CLIENTES — o id=1 (empresa_id
            // padrão de todo usuário Aluforce) era um cliente inativo de teste. Ver memória
            // nfe-emitente-empresas-bug-2026-06-28.
            const FiscalProfileService = require('../modules/Faturamento/services/fiscal-profile.service');
            const perfil = await FiscalProfileService.carregar(pool).catch(() => null);
            let emitente = perfil ? {
                cnpj: perfil.cnpj || '', razao_social: perfil.razaoSocial || '', nome_fantasia: perfil.nomeFantasia || '',
                inscricao_estadual: perfil.ie || '', endereco: perfil.logradouro || '', numero: perfil.numero || '',
                bairro: perfil.bairro || '', municipio: perfil.municipio || '', uf: perfil.uf || '',
                cep: perfil.cep || '', ambiente: perfil.ambiente, serie: perfil.serie
            } : {};

            // Dados operacionais do certificado (não fazem parte da identidade do emitente)
            try {
                const [rows] = await pool.query(
                    `SELECT crt, ativo, certificado_validade
                     FROM nfe_configuracoes WHERE empresa_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1`,
                    [empresaId]
                );
                if (rows && rows[0]) Object.assign(emitente, rows[0]);
            } catch (_) {}

            res.json({ success: true, emitente, empresa_id: empresaId });
        } catch (err) {
            console.error('[NFe Config] Erro:', err);
            res.status(500).json({ success: false, message: 'Erro ao carregar configurações NFe.' });
        }
    });

    return router;
};
