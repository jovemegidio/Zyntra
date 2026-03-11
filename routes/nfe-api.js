'use strict';

/**
 * NFe API routes — extracted from server.js
 * Endpoints: preview, emitir, validar, configuracoes
 */
const express = require('express');

module.exports = function createNfeApiRouter({ authenticateToken, pool }) {
    const router = express.Router();

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
                nfeData.itens.forEach((item, idx) => {
                    const n = idx + 1;
                    if (!item.descricao) erros.push(`Item ${n}: descrição é obrigatória.`);
                    if (!item.ncm) erros.push(`Item ${n}: NCM é obrigatório.`);
                    if (!item.cfop) erros.push(`Item ${n}: CFOP é obrigatório.`);
                    if (!item.quantidade || item.quantidade <= 0) erros.push(`Item ${n}: quantidade deve ser maior que zero.`);
                    if (!item.valorUnitario || item.valorUnitario <= 0) erros.push(`Item ${n}: valor unitário deve ser maior que zero.`);
                });
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

    // GET /api/nfe/configuracoes
    router.get('/configuracoes', authenticateToken, async (req, res) => {
        try {
            let emitente = {};
            try {
                const [rows] = await pool.query(
                    "SELECT id, cnpj, razao_social, nome_fantasia, inscricao_estadual, endereco, numero, bairro, codigo_municipio, municipio, uf, cep, crt, ativo FROM configuracoes_nfe WHERE ativo = 1 ORDER BY id DESC LIMIT 1"
                );
                if (rows && rows.length > 0) {
                    emitente = rows[0];
                }
            } catch (dbErr) {
                console.warn('[NFe Config] Tabela configuracoes_nfe não encontrada, usando fallback.');
            }

            if (!emitente.cnpj) {
                try {
                    const [empresaRows] = await pool.query(
                        "SELECT id, cnpj, razao_social, nome, nome_fantasia, fantasia, inscricao_estadual, ie, endereco, logradouro, numero, bairro, codigo_municipio, municipio, uf, cep FROM empresa ORDER BY id LIMIT 1"
                    );
                    if (empresaRows && empresaRows.length > 0) {
                        const emp = empresaRows[0];
                        emitente = {
                            cnpj: emp.cnpj || '',
                            razao_social: emp.razao_social || emp.nome || '',
                            nome_fantasia: emp.nome_fantasia || emp.fantasia || '',
                            inscricao_estadual: emp.inscricao_estadual || emp.ie || '',
                            endereco: emp.endereco || emp.logradouro || '',
                            numero: emp.numero || '',
                            bairro: emp.bairro || '',
                            municipio: emp.municipio || emp.cidade || '',
                            uf: emp.uf || emp.estado || '',
                            cep: emp.cep || '',
                            ambiente: 2
                        };
                    }
                } catch {
                    console.warn('[NFe Config] Tabela empresa não encontrada.');
                }
            }

            res.json({ success: true, emitente });
        } catch (err) {
            console.error('[NFe Config] Erro:', err);
            res.status(500).json({ success: false, message: 'Erro ao carregar configurações NFe.' });
        }
    });

    return router;
};
