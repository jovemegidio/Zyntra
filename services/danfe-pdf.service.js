/**
 * Serviço DANFE PDF — gera Documento Auxiliar da NF-e em PDF.
 *
 * Implementação simplificada do layout DANFE (NT 2017/002):
 *   - Cabeçalho: razão social, CNPJ, IE
 *   - Chave de acesso (44 dígitos) + barcode Code128
 *   - Dados da NF: número, série, data emissão, protocolo
 *   - Destinatário
 *   - Itens da NF
 *   - Totais
 *   - Observações
 *
 * Para produção, recomendado contratar serviço terceirizado (FocusNFe,
 * NFe.io) que gera DANFE com layout oficial completo (fundo decorativo,
 * QR Code NFC-e, todos os 50+ campos do layout).
 *
 * @module services/danfe-pdf.service
 */

const PDFDocument = require('pdfkit');
let bwipjs;
try { bwipjs = require('bwip-js'); } catch (_) { bwipjs = null; }

/**
 * Gera DANFE PDF como Buffer.
 *
 * @param {Object} params  { nfeData, pedido, cfg }
 *   nfeData = { chave, protocolo, dhEmissao, numero, serie }
 *   pedido  = { id, cliente, itens, valor_total, ... }
 *   cfg     = { razao_social, cnpj, endereco, ... }
 * @returns {Promise<Buffer>}
 */
async function gerarDanfePDF({ nfeData, pedido, cfg }) {
    const doc = new PDFDocument({ size: 'A4', margin: 24 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const doneP = new Promise(r => doc.on('end', () => r(Buffer.concat(chunks))));

    // ---- Cabeçalho
    doc.font('Helvetica-Bold').fontSize(14).text('DANFE — Documento Auxiliar da NF-e', { align: 'center' });
    doc.font('Helvetica').fontSize(9).text(
        nfeData.protocolo ? 'NF-e AUTORIZADA — Protocolo ' + nfeData.protocolo : 'NF-e em processamento',
        { align: 'center' }
    );
    doc.moveDown(0.5);

    // Linha
    doc.strokeColor('#000').lineWidth(0.5).moveTo(24, doc.y).lineTo(571, doc.y).stroke();
    doc.moveDown(0.3);

    // ---- Bloco Emitente
    const yStart = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).text(cfg.razao_social || 'EMITENTE', 24, yStart);
    doc.font('Helvetica').fontSize(8);
    doc.text(`CNPJ: ${formatarCnpj(cfg.cnpj)} | IE: ${cfg.inscricao_estadual || 'ISENTO'}`, 24);
    doc.text(`${cfg.endereco || ''}, ${cfg.numero || ''} — ${cfg.bairro || ''}`, 24);
    doc.text(`${cfg.cidade || ''} - ${cfg.estado || ''} | CEP: ${formatarCep(cfg.cep)}`, 24);

    // Caixa NF (direita)
    doc.font('Helvetica-Bold').fontSize(11).text('NF-e Nº', 400, yStart);
    doc.font('Helvetica').fontSize(14).text(
        String(nfeData.numero || pedido.numero_nf || pedido.id).padStart(9, '0'),
        400, yStart + 14
    );
    doc.fontSize(9).text(`Série: ${nfeData.serie || 1}`, 400, yStart + 32);
    doc.text(`Emissão: ${new Date(nfeData.dhEmissao || Date.now()).toLocaleString('pt-BR')}`, 400, yStart + 44);

    doc.moveDown(3);

    // ---- Chave de acesso + barcode
    doc.strokeColor('#000').rect(24, doc.y, 547, 50).stroke();
    doc.font('Helvetica-Bold').fontSize(8).text('CHAVE DE ACESSO', 28, doc.y + 4);
    doc.font('Helvetica').fontSize(9).text(
        formatarChave(nfeData.chave || ''),
        28, doc.y + 16,
        { width: 540 }
    );

    if (nfeData.chave && bwipjs) {
        try {
            const png = await bwipjs.toBuffer({
                bcid: 'code128', text: nfeData.chave,
                scale: 2, height: 8, includetext: false
            });
            doc.image(png, 28, doc.y + 30, { width: 540, height: 20 });
        } catch (e) {
            doc.font('Helvetica').fontSize(7).fillColor('#888').text('Barcode indisponível: ' + e.message, 28, doc.y + 35);
            doc.fillColor('#000');
        }
    }

    doc.y += 60;
    doc.font('Helvetica').fontSize(8).text('Consulte autenticidade em http://www.nfe.fazenda.gov.br/portal', 24, doc.y);
    doc.moveDown(1);

    // ---- Destinatário
    const cli = pedido.cliente || {};
    doc.strokeColor('#000').rect(24, doc.y, 547, 50).stroke();
    doc.font('Helvetica-Bold').fontSize(8).text('DESTINATÁRIO', 28, doc.y + 4);
    doc.font('Helvetica').fontSize(9);
    doc.text(`${cli.razao_social || cli.nome || cli.nome_fantasia || pedido.cliente_nome || 'Cliente'}`, 28, doc.y + 16);
    doc.fontSize(8).text(`CNPJ/CPF: ${formatarCnpj(cli.cnpj || cli.cpf || cli.cpf_cnpj)} | IE: ${cli.inscricao_estadual || 'ISENTO'}`, 28);
    doc.text(`${cli.endereco || ''}, ${cli.numero || ''} — ${cli.bairro || ''} | ${cli.cidade || ''} - ${cli.uf || cli.estado || ''}`, 28);
    doc.y += 16;

    doc.moveDown(1);

    // ---- Itens (tabela)
    doc.font('Helvetica-Bold').fontSize(9).text('PRODUTOS / SERVIÇOS', 24, doc.y);
    const headerY = doc.y + 4;
    doc.strokeColor('#000').rect(24, headerY, 547, 14).stroke().fill('#f0f0f0').rect(24, headerY, 547, 14).fillAndStroke('#e5e5e5', '#000');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(7);
    const cols = [
        { x: 28, w: 50, label: 'Código' },
        { x: 78, w: 220, label: 'Descrição' },
        { x: 298, w: 50, label: 'NCM' },
        { x: 348, w: 30, label: 'CFOP' },
        { x: 378, w: 30, label: 'Un' },
        { x: 408, w: 50, label: 'Qtde' },
        { x: 458, w: 55, label: 'Vl. Unit' },
        { x: 513, w: 58, label: 'Vl. Total' }
    ];
    cols.forEach(c => doc.text(c.label, c.x, headerY + 4, { width: c.w }));

    let yRow = headerY + 16;
    let totalGeral = 0;
    doc.font('Helvetica').fontSize(7);
    (pedido.itens || []).forEach((it, i) => {
        if (yRow > 720) { doc.addPage(); yRow = 50; }
        const qtd = Number(it.quantidade || 1);
        const vUn = Number(it.preco_unitario || it.valor_unitario || 0);
        const vTot = qtd * vUn;
        totalGeral += vTot;
        doc.strokeColor('#ccc').rect(24, yRow, 547, 12).stroke();
        doc.text(String(it.codigo_produto || it.codigo || `${i + 1}`).slice(0, 10), 28, yRow + 3, { width: 50 });
        doc.text(String(it.descricao || it.produto || '').slice(0, 50), 78, yRow + 3, { width: 220 });
        doc.text(String(it.ncm || '00000000'), 298, yRow + 3, { width: 50 });
        doc.text('5102', 348, yRow + 3, { width: 30 });
        doc.text(String(it.unidade || 'UN'), 378, yRow + 3, { width: 30 });
        doc.text(qtd.toFixed(2), 408, yRow + 3, { width: 50, align: 'right' });
        doc.text(vUn.toFixed(2), 458, yRow + 3, { width: 50, align: 'right' });
        doc.text(vTot.toFixed(2), 510, yRow + 3, { width: 58, align: 'right' });
        yRow += 12;
    });

    yRow += 8;

    // ---- Totais
    doc.strokeColor('#000').rect(24, yRow, 547, 30).stroke();
    doc.font('Helvetica-Bold').fontSize(9).text('TOTAL DA NOTA', 28, yRow + 4);
    doc.font('Helvetica').fontSize(11).text(
        'R$ ' + (Number(pedido.valor || pedido.valor_total || totalGeral) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        400, yRow + 10
    );
    yRow += 36;

    // ---- Rodapé
    doc.font('Helvetica').fontSize(7).fillColor('#666');
    doc.text(`Pedido: #${pedido.id || '-'} | Documento gerado em ${new Date().toLocaleString('pt-BR')} por Zyntra ERP`, 24, 800);
    doc.text(`Versão DANFE: simplificada — para layout oficial completo, consulte XML autorizado em /api/nfe/${pedido.id}/xml`, 24, 810);

    doc.end();
    return doneP;
}

function formatarCnpj(s) {
    const v = String(s || '').replace(/\D/g, '');
    if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return v || '—';
}

function formatarCep(s) {
    const v = String(s || '').replace(/\D/g, '');
    return v.length === 8 ? v.replace(/(\d{5})(\d{3})/, '$1-$2') : v || '—';
}

function formatarChave(s) {
    return String(s || '').replace(/(.{4})/g, '$1 ').trim();
}

module.exports = { gerarDanfePDF };
