/**
 * SERVIÇO DE GERAÇÍO DE PDF
 * Gera PDFs para pedidos, orçamentos, relatórios e documentos diversos
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

class GeradorPDF {
    constructor(config = {}) {
        this.empresa = config.empresa || {
            nome: 'ALUFORCE INDÚSTRIA',
            cnpj: '00.000.000/0001-00',
            endereco: 'Rua Example, 123 - Centro',
            cidade: 'São Paulo - SP',
            telefone: '(11) 0000-0000',
            email: 'contato@aluforce.com.br',
            logo: null
        };
    }

    /**
     * Gera PDF de Pedido de Venda / Orçamento
     */
    async gerarPedidoVenda(pedido, opcoes = {}) {
        const {
            tipo = 'orcamento', // 'orcamento' ou 'pedido'
            incluirValores = true,
            incluirImpostos = false
        } = opcoes;

        const titulo = tipo === 'orcamento' ? 'ORÇAMENTO' : 'PEDIDO DE VENDA';
        const numero = pedido.id || pedido.numero;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${titulo} #${numero}</title>
    <style>
        ${this.getEstilosBase()}
        .titulo-doc { color: ${tipo === 'orcamento' ? '#2563eb' : '#059669'}; }
    </style>
</head>
<body>
    ${this.renderCabecalho(titulo, numero)}
    
    <div class="secao">
        <div class="secao-titulo">DADOS DO CLIENTE</div>
        <table class="tabela-info">
            <tr>
                <td><strong>Razão Social:</strong></td>
                <td>${pedido.cliente_nome || pedido.empresa_nome || '-'}</td>
                <td><strong>CNPJ/CPF:</strong></td>
                <td>${pedido.cliente_cnpj || pedido.empresa_cnpj || '-'}</td>
            </tr>
            <tr>
                <td><strong>Endereço:</strong></td>
                <td colspan="3">${this.formatarEndereco(pedido)}</td>
            </tr>
            <tr>
                <td><strong>Contato:</strong></td>
                <td>${pedido.cliente_contato || '-'}</td>
                <td><strong>Telefone:</strong></td>
                <td>${pedido.cliente_telefone || '-'}</td>
            </tr>
        </table>
    </div>

    <div class="secao">
        <div class="secao-titulo">INFORMAÇÕES DO ${titulo}</div>
        <table class="tabela-info">
            <tr>
                <td><strong>Data:</strong></td>
                <td>${this.formatarData(pedido.created_at || pedido.data)}</td>
                <td><strong>Validade:</strong></td>
                <td>${this.formatarData(pedido.data_validade) || '30 dias'}</td>
            </tr>
            <tr>
                <td><strong>Vendedor:</strong></td>
                <td>${pedido.vendedor_nome || '-'}</td>
                <td><strong>Cond. Pagamento:</strong></td>
                <td>${pedido.condicao_pagamento || '-'}</td>
            </tr>
            <tr>
                <td><strong>Previsão Entrega:</strong></td>
                <td>${this.formatarData(pedido.data_previsao) || 'A combinar'}</td>
                <td><strong>Frete:</strong></td>
                <td>${pedido.tipo_frete || 'CIF'}</td>
            </tr>
        </table>
    </div>

    <div class="secao">
        <div class="secao-titulo">ITENS</div>
        <table class="tabela-itens">
            <thead>
                <tr>
                    <th style="width: 8%">Item</th>
                    <th style="width: 15%">Código</th>
                    <th style="width: 37%">Descrição</th>
                    <th style="width: 8%">UN</th>
                    <th style="width: 8%">Qtd</th>
                    ${incluirValores ? `
                    <th style="width: 12%">Vl. Unit.</th>
                    <th style="width: 12%">Total</th>
                    ` : ''}
                </tr>
            </thead>
            <tbody>
                ${(pedido.itens || []).map((item, idx) => `
                <tr>
                    <td class="center">${idx + 1}</td>
                    <td>${item.codigo || '-'}</td>
                    <td>${item.descricao || '-'}</td>
                    <td class="center">${item.unidade || 'UN'}</td>
                    <td class="right">${this.formatarNumero(item.quantidade, 2)}</td>
                    ${incluirValores ? `
                    <td class="right">${this.formatarMoeda(item.preco_unitario || item.valor_unitario)}</td>
                    <td class="right">${this.formatarMoeda(item.total || (item.quantidade * (item.preco_unitario || item.valor_unitario)))}</td>
                    ` : ''}
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    ${incluirValores ? this.renderTotais(pedido) : ''}

    ${pedido.observacoes ? `
    <div class="secao">
        <div class="secao-titulo">OBSERVAÇÕES</div>
        <p class="observacoes">${pedido.observacoes}</p>
    </div>
    ` : ''}

    ${this.renderRodape()}
</body>
</html>`;

        return this.htmlToPDF(html, `${tipo}_${numero}.pdf`);
    }

    /**
     * Gera PDF de Pedido de Compra
     */
    async gerarPedidoCompra(pedido, opcoes = {}) {
        const numero = pedido.numero_pedido || pedido.id;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PEDIDO DE COMPRA #${numero}</title>
    <style>
        ${this.getEstilosBase()}
        .titulo-doc { color: #7c3aed; }
    </style>
</head>
<body>
    ${this.renderCabecalho('PEDIDO DE COMPRA', numero)}
    
    <div class="secao">
        <div class="secao-titulo">DADOS DO FORNECEDOR</div>
        <table class="tabela-info">
            <tr>
                <td><strong>Razão Social:</strong></td>
                <td>${pedido.fornecedor_nome || '-'}</td>
                <td><strong>CNPJ:</strong></td>
                <td>${pedido.fornecedor_cnpj || '-'}</td>
            </tr>
            <tr>
                <td><strong>Contato:</strong></td>
                <td>${pedido.fornecedor_contato || '-'}</td>
                <td><strong>Telefone:</strong></td>
                <td>${pedido.fornecedor_telefone || '-'}</td>
            </tr>
            <tr>
                <td><strong>Email:</strong></td>
                <td colspan="3">${pedido.fornecedor_email || '-'}</td>
            </tr>
        </table>
    </div>

    <div class="secao">
        <div class="secao-titulo">INFORMAÇÕES DO PEDIDO</div>
        <table class="tabela-info">
            <tr>
                <td><strong>Data Emissão:</strong></td>
                <td>${this.formatarData(pedido.data_emissao || pedido.created_at)}</td>
                <td><strong>Previsão Entrega:</strong></td>
                <td>${this.formatarData(pedido.data_previsao)}</td>
            </tr>
            <tr>
                <td><strong>Solicitante:</strong></td>
                <td>${pedido.solicitante_nome || '-'}</td>
                <td><strong>Cond. Pagamento:</strong></td>
                <td>${pedido.condicao_pagamento || '-'}</td>
            </tr>
        </table>
    </div>

    <div class="secao">
        <div class="secao-titulo">ITENS DO PEDIDO</div>
        <table class="tabela-itens">
            <thead>
                <tr>
                    <th style="width: 8%">Item</th>
                    <th style="width: 15%">Código</th>
                    <th style="width: 37%">Descrição</th>
                    <th style="width: 8%">UN</th>
                    <th style="width: 10%">Qtd</th>
                    <th style="width: 11%">Vl. Unit.</th>
                    <th style="width: 11%">Total</th>
                </tr>
            </thead>
            <tbody>
                ${(pedido.itens || []).map((item, idx) => `
                <tr>
                    <td class="center">${idx + 1}</td>
                    <td>${item.codigo || '-'}</td>
                    <td>${item.descricao || '-'}</td>
                    <td class="center">${item.unidade || 'UN'}</td>
                    <td class="right">${this.formatarNumero(item.quantidade, 2)}</td>
                    <td class="right">${this.formatarMoeda(item.preco_unitario)}</td>
                    <td class="right">${this.formatarMoeda(item.total)}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    ${this.renderTotaisCompra(pedido)}

    ${pedido.observacoes ? `
    <div class="secao">
        <div class="secao-titulo">OBSERVAÇÕES</div>
        <p class="observacoes">${pedido.observacoes}</p>
    </div>
    ` : ''}

    <div class="assinaturas">
        <div class="assinatura">
            <div class="linha-assinatura"></div>
            <p>Comprador</p>
        </div>
        <div class="assinatura">
            <div class="linha-assinatura"></div>
            <p>Aprovação</p>
        </div>
    </div>

    ${this.renderRodape()}
</body>
</html>`;

        return this.htmlToPDF(html, `pedido_compra_${numero}.pdf`);
    }

    /**
     * Gera PDF de Ordem de Produção
     */
    async gerarOrdemProducao(op, opcoes = {}) {
        const numero = op.numero || op.id;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>ORDEM DE PRODUÇÍO #${numero}</title>
    <style>
        ${this.getEstilosBase()}
        .titulo-doc { color: #ea580c; }
        .prioridade-alta { background: #fef2f2; color: #dc2626; }
        .prioridade-normal { background: #f0f9ff; color: #0284c7; }
        .prioridade-baixa { background: #f0fdf4; color: #16a34a; }
    </style>
</head>
<body>
    ${this.renderCabecalho('ORDEM DE PRODUÇÍO', numero)}
    
    <div class="secao">
        <div class="secao-titulo">INFORMAÇÕES GERAIS</div>
        <table class="tabela-info">
            <tr>
                <td><strong>Data Emissão:</strong></td>
                <td>${this.formatarData(op.created_at || op.data_emissao)}</td>
                <td><strong>Previsão:</strong></td>
                <td>${this.formatarData(op.data_previsao)}</td>
            </tr>
            <tr>
                <td><strong>Cliente:</strong></td>
                <td>${op.cliente_nome || '-'}</td>
                <td><strong>Pedido Venda:</strong></td>
                <td>${op.pedido_vendas_id ? `#${op.pedido_vendas_id}` : '-'}</td>
            </tr>
            <tr>
                <td><strong>Prioridade:</strong></td>
                <td><span class="badge prioridade-${op.prioridade || 'normal'}">${(op.prioridade || 'normal').toUpperCase()}</span></td>
                <td><strong>Status:</strong></td>
                <td>${this.formatarStatus(op.status)}</td>
            </tr>
        </table>
    </div>

    <div class="secao">
        <div class="secao-titulo">ITENS A PRODUZIR</div>
        <table class="tabela-itens">
            <thead>
                <tr>
                    <th style="width: 8%">Item</th>
                    <th style="width: 15%">Código</th>
                    <th style="width: 42%">Descrição</th>
                    <th style="width: 10%">UN</th>
                    <th style="width: 12%">Qtd</th>
                    <th style="width: 13%">Status</th>
                </tr>
            </thead>
            <tbody>
                ${(op.itens || []).map((item, idx) => `
                <tr>
                    <td class="center">${idx + 1}</td>
                    <td>${item.codigo || item.produto_codigo || '-'}</td>
                    <td>${item.descricao || item.produto_descricao || '-'}</td>
                    <td class="center">${item.unidade || 'UN'}</td>
                    <td class="right">${this.formatarNumero(item.quantidade, 2)}</td>
                    <td class="center">${this.formatarStatus(item.status || 'pendente')}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    ${op.observacoes ? `
    <div class="secao">
        <div class="secao-titulo">OBSERVAÇÕES</div>
        <p class="observacoes">${op.observacoes}</p>
    </div>
    ` : ''}

    <div class="secao">
        <div class="secao-titulo">CONTROLE DE PRODUÇÍO</div>
        <table class="tabela-controle">
            <tr>
                <td style="width: 25%"><strong>Início:</strong> ___/___/_____ ___:___</td>
                <td style="width: 25%"><strong>Término:</strong> ___/___/_____ ___:___</td>
                <td style="width: 25%"><strong>Operador:</strong> ______________</td>
                <td style="width: 25%"><strong>Visto QC:</strong> ______________</td>
            </tr>
        </table>
    </div>

    ${this.renderRodape()}
</body>
</html>`;

        return this.htmlToPDF(html, `op_${numero}.pdf`);
    }

    /**
     * Gera PDF de Relatório Genérico
     */
    async gerarRelatorio(dados, opcoes = {}) {
        const {
            titulo = 'RELATÓRIO',
            subtitulo = '',
            periodo = '',
            colunas = [],
            linhas = [],
            totais = null,
            orientacao = 'portrait'
        } = opcoes;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${titulo}</title>
    <style>
        ${this.getEstilosBase()}
        @page { size: A4 ${orientacao}; }
        .titulo-doc { color: #374151; }
    </style>
</head>
<body>
    <div class="cabecalho">
        <div class="empresa-info">
            <h2>${this.empresa.nome}</h2>
            <p>${this.empresa.cnpj}</p>
        </div>
        <div class="doc-info">
            <h1 class="titulo-doc">${titulo}</h1>
            ${subtitulo ? `<p class="subtitulo">${subtitulo}</p>` : ''}
            ${periodo ? `<p class="periodo">Período: ${periodo}</p>` : ''}
            <p class="data-emissao">Emitido em: ${this.formatarDataHora(new Date())}</p>
        </div>
    </div>

    <div class="secao">
        <table class="tabela-itens">
            <thead>
                <tr>
                    ${colunas.map(col => `
                        <th style="width: ${col.width || 'auto'}; text-align: ${col.align || 'left'}">${col.label}</th>
                    `).join('')}
                </tr>
            </thead>
            <tbody>
                ${linhas.map(linha => `
                <tr>
                    ${colunas.map(col => `
                        <td class="${col.align || 'left'}">${this.formatarCelula(linha[col.campo], col.tipo)}</td>
                    `).join('')}
                </tr>
                `).join('')}
            </tbody>
            ${totais ? `
            <tfoot>
                <tr class="totais">
                    ${colunas.map(col => `
                        <td class="${col.align || 'left'} total">${totais[col.campo] !== undefined ? this.formatarCelula(totais[col.campo], col.tipo) : ''}</td>
                    `).join('')}
                </tr>
            </tfoot>
            ` : ''}
        </table>
    </div>

    <div class="resumo-relatorio">
        <p>Total de registros: ${linhas.length}</p>
    </div>

    ${this.renderRodape()}
</body>
</html>`;

        return this.htmlToPDF(html, `relatorio_${Date.now()}.pdf`);
    }

    // ==================== MÉTODOS AUXILIARES ====================

    getEstilosBase() {
        return `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; font-size: 10pt; color: #333; padding: 20px; }
            
            .cabecalho { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
            .empresa-info h2 { font-size: 16pt; color: #1e40af; margin-bottom: 5px; }
            .empresa-info p { font-size: 9pt; color: #666; }
            .doc-info { text-align: right; }
            .doc-info h1 { font-size: 18pt; margin-bottom: 5px; }
            .doc-info .numero { font-size: 14pt; color: #666; }
            .doc-info .data-emissao { font-size: 8pt; color: #999; margin-top: 5px; }
            
            .secao { margin-bottom: 20px; }
            .secao-titulo { background: #f3f4f6; padding: 8px 12px; font-weight: bold; font-size: 10pt; color: #374151; border-left: 4px solid #3b82f6; margin-bottom: 10px; }
            
            .tabela-info { width: 100%; border-collapse: collapse; }
            .tabela-info td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
            .tabela-info td:first-child { width: 120px; color: #666; }
            
            .tabela-itens { width: 100%; border-collapse: collapse; }
            .tabela-itens th { background: #1e40af; color: white; padding: 10px 8px; text-align: left; font-size: 9pt; }
            .tabela-itens td { padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 9pt; }
            .tabela-itens tbody tr:nth-child(even) { background: #f9fafb; }
            .tabela-itens .center { text-align: center; }
            .tabela-itens .right { text-align: right; }
            
            .totais-box { margin-top: 20px; display: flex; justify-content: flex-end; }
            .totais-tabela { width: 300px; }
            .totais-tabela td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
            .totais-tabela td:first-child { text-align: right; color: #666; }
            .totais-tabela td:last-child { text-align: right; font-weight: bold; }
            .totais-tabela tr.total-geral td { background: #1e40af; color: white; font-size: 11pt; }
            
            .observacoes { background: #fffbeb; border: 1px solid #fbbf24; padding: 10px; border-radius: 4px; font-size: 9pt; }
            
            .assinaturas { display: flex; justify-content: space-around; margin-top: 40px; }
            .assinatura { text-align: center; }
            .linha-assinatura { width: 200px; border-top: 1px solid #333; margin-bottom: 5px; }
            .assinatura p { font-size: 9pt; color: #666; }
            
            .rodape { position: fixed; bottom: 20px; left: 20px; right: 20px; border-top: 1px solid #e5e7eb; padding-top: 10px; font-size: 8pt; color: #999; display: flex; justify-content: space-between; }
            
            .badge { padding: 3px 8px; border-radius: 4px; font-size: 8pt; font-weight: bold; }
            
            .tabela-controle { width: 100%; border-collapse: collapse; }
            .tabela-controle td { padding: 15px 10px; border: 1px solid #e5e7eb; }
            
            @media print {
                body { padding: 0; }
                .rodape { position: fixed; }
            }
        `;
    }

    renderCabecalho(titulo, numero) {
        return `
        <div class="cabecalho">
            <div class="empresa-info">
                <h2>${this.empresa.nome}</h2>
                <p>CNPJ: ${this.empresa.cnpj}</p>
                <p>${this.empresa.endereco}</p>
                <p>${this.empresa.cidade}</p>
                <p>Tel: ${this.empresa.telefone}</p>
            </div>
            <div class="doc-info">
                <h1 class="titulo-doc">${titulo}</h1>
                <p class="numero">Nº ${numero}</p>
                <p class="data-emissao">Emitido em: ${this.formatarDataHora(new Date())}</p>
            </div>
        </div>`;
    }

    renderTotais(pedido) {
        const subtotal = parseFloat(pedido.subtotal) || parseFloat(pedido.valor_total) || 0;
        const desconto = parseFloat(pedido.desconto) || 0;
        const frete = parseFloat(pedido.valor_frete) || 0;
        const total = subtotal - desconto + frete;

        return `
        <div class="totais-box">
            <table class="totais-tabela">
                <tr><td>Subtotal:</td><td>${this.formatarMoeda(subtotal)}</td></tr>
                ${desconto > 0 ? `<tr><td>Desconto:</td><td>- ${this.formatarMoeda(desconto)}</td></tr>` : ''}
                ${frete > 0 ? `<tr><td>Frete:</td><td>${this.formatarMoeda(frete)}</td></tr>` : ''}
                <tr class="total-geral"><td>TOTAL:</td><td>${this.formatarMoeda(total)}</td></tr>
            </table>
        </div>`;
    }

    renderTotaisCompra(pedido) {
        const subtotal = parseFloat(pedido.subtotal) || parseFloat(pedido.valor_total) || 0;
        const desconto = parseFloat(pedido.desconto) || 0;
        const frete = parseFloat(pedido.valor_frete) || 0;
        const total = parseFloat(pedido.valor_final) || (subtotal - desconto + frete);

        return `
        <div class="totais-box">
            <table class="totais-tabela">
                <tr><td>Subtotal:</td><td>${this.formatarMoeda(subtotal)}</td></tr>
                ${desconto > 0 ? `<tr><td>Desconto (${pedido.desconto_percentual || 0}%):</td><td>- ${this.formatarMoeda(desconto)}</td></tr>` : ''}
                ${frete > 0 ? `<tr><td>Frete:</td><td>${this.formatarMoeda(frete)}</td></tr>` : ''}
                <tr class="total-geral"><td>VALOR TOTAL:</td><td>${this.formatarMoeda(total)}</td></tr>
            </table>
        </div>`;
    }

    renderRodape() {
        return `
        <div class="rodape">
            <span>${this.empresa.nome} - ${this.empresa.email}</span>
            <span>Documento gerado pelo Sistema Aluforce ERP</span>
        </div>`;
    }

    formatarData(data) {
        if (!data) return '-';
        const d = new Date(data);
        return d.toLocaleDateString('pt-BR');
    }

    formatarDataHora(data) {
        if (!data) return '-';
        const d = new Date(data);
        return d.toLocaleString('pt-BR');
    }

    formatarMoeda(valor) {
        if (valor === null || valor === undefined) return '-';
        return parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    formatarNumero(valor, decimais = 2) {
        if (valor === null || valor === undefined) return '-';
        return parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
    }

    formatarEndereco(dados) {
        const partes = [];
        if (dados.endereco || dados.cliente_endereco) partes.push(dados.endereco || dados.cliente_endereco);
        if (dados.bairro || dados.cliente_bairro) partes.push(dados.bairro || dados.cliente_bairro);
        if (dados.cidade || dados.cliente_cidade) partes.push(dados.cidade || dados.cliente_cidade);
        if (dados.estado || dados.cliente_uf) partes.push(dados.estado || dados.cliente_uf);
        if (dados.cep || dados.cliente_cep) partes.push(`CEP: ${dados.cep || dados.cliente_cep}`);
        return partes.join(' - ') || '-';
    }

    formatarStatus(status) {
        const statusMap = {
            'pendente': '⏳ Pendente',
            'a_produzir': '📋 A Produzir',
            'produzindo': '🔨 Produzindo',
            'qualidade': '🔍 Qualidade',
            'conferido': '✓ Conferido',
            'concluido': '✅ Concluído',
            'armazenado': '📦 Armazenado',
            'aprovado': '✅ Aprovado',
            'cancelado': '❌ Cancelado'
        };
        return statusMap[status] || status || '-';
    }

    formatarCelula(valor, tipo) {
        switch (tipo) {
            case 'moeda': return this.formatarMoeda(valor);
            case 'numero': return this.formatarNumero(valor);
            case 'data': return this.formatarData(valor);
            case 'dataHora': return this.formatarDataHora(valor);
            default: return valor || '-';
        }
    }

    /**
     * Converte HTML para PDF (usando biblioteca no navegador ou servidor)
     */
    async htmlToPDF(html, filename) {
        // Em ambiente de navegador, usa window.print() ou biblioteca como html2pdf
        if (typeof window !== 'undefined') {
            // Abre em nova janela para impressão
            const printWindow = window.open('', '_blank');
            printWindow.document.write(html);
            printWindow.document.close();
            
            // Adiciona evento para imprimir após carregar
            printWindow.onload = function() {
                printWindow.print();
            };

            return { success: true, method: 'print', filename };
        }

        // Em ambiente Node.js, retorna o HTML para processamento com puppeteer ou similar
        return { success: true, html, filename };
    }

    /**
     * Gera e baixa o PDF (para uso no navegador)
     */
    async baixarPDF(html, filename) {
        if (typeof window !== 'undefined' && window.html2pdf) {
            // Usar html2pdf.js se disponível
            const element = document.createElement('div');
            element.innerHTML = html;
            document.body.appendChild(element);

            const opt = {
                margin: 10,
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            await window.html2pdf().set(opt).from(element).save();
            document.body.removeChild(element);

            return { success: true };
        }

        // Fallback: abrir para impressão
        return this.htmlToPDF(html, filename);
    }
}

// Exportar para uso em Node.js e Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeradorPDF;
}

if (typeof window !== 'undefined') {
    window.GeradorPDF = GeradorPDF;
}
