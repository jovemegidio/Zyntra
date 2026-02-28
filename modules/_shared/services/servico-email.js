/**
 * SERVIÇO UNIFICADO DE NOTIFICAÇÕES POR EMAIL
 * Envia emails transacionais para todos os módulos do ERP
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

const nodemailer = require('nodemailer');

class ServicoEmail {
    constructor(config = {}) {
        this.config = {
            host: config.host || process.env.SMTP_HOST || 'smtp.gmail.com',
            port: config.port || process.env.SMTP_PORT || 587,
            secure: config.secure || process.env.SMTP_SECURE === 'true' || false,
            auth: {
                user: config.user || process.env.SMTP_USER || '',
                pass: config.pass || process.env.SMTP_PASS || ''
            }
        };

        this.remetente = {
            nome: config.remetenteNome || process.env.EMAIL_FROM_NAME || 'Aluforce ERP',
            email: config.remetenteEmail || process.env.EMAIL_FROM || 'noreply@aluforce.com.br'
        };

        this.empresa = config.empresa || {
            nome: 'ALUFORCE INDÚSTRIA',
            site: 'www.aluforce.com.br',
            telefone: '(11) 0000-0000'
        };

        this.transporter = null;
        this.templates = this.getTemplates();
    }

    /**
     * Inicializa o transportador de email
     */
    async inicializar() {
        if (!this.config.auth.user || !this.config.auth.pass) {
            console.warn('[ServicoEmail] Credenciais SMTP não configuradas');
            return false;
        }

        try {
            this.transporter = nodemailer.createTransport(this.config);
            await this.transporter.verify();
            console.log('[ServicoEmail] Conexão SMTP verificada com sucesso');
            return true;
        } catch (error) {
            console.error('[ServicoEmail] Erro ao conectar SMTP:', error.message);
            return false;
        }
    }

    /**
     * Envia email genérico
     */
    async enviar(para, assunto, html, opcoes = {}) {
        if (!this.transporter) {
            await this.inicializar();
        }

        if (!this.transporter) {
            return { success: false, message: 'Serviço de email não configurado' };
        }

        try {
            const mailOptions = {
                from: `"${this.remetente.nome}" <${this.remetente.email}>`,
                to: para,
                subject: assunto,
                html: this.wrapTemplate(html),
                ...opcoes
            };

            const info = await this.transporter.sendMail(mailOptions);
            
            console.log(`[ServicoEmail] Email enviado: ${info.messageId}`);
            
            return { 
                success: true, 
                messageId: info.messageId,
                message: 'Email enviado com sucesso'
            };

        } catch (error) {
            console.error('[ServicoEmail] Erro ao enviar:', error);
            return { success: false, message: error.message };
        }
    }

    // ==================== EMAILS DO MÓDULO VENDAS ====================

    /**
     * Envia orçamento para cliente
     */
    async enviarOrcamento(orcamento, cliente) {
        const html = `
            <h2>Orçamento #${orcamento.id}</h2>
            <p>Prezado(a) ${cliente.nome},</p>
            <p>Segue abaixo o orçamento solicitado:</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                    <tr style="background: #f3f4f6;">
                        <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: left;">Item</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: left;">Descrição</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">Qtd</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">Valor Unit.</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${(orcamento.itens || []).map((item, idx) => `
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${item.descricao}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">${item.quantidade}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">${this.formatarMoeda(item.preco_unitario)}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">${this.formatarMoeda(item.total)}</td>
                    </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr style="background: #1e40af; color: white;">
                        <td colspan="4" style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;"><strong>TOTAL:</strong></td>
                        <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;"><strong>${this.formatarMoeda(orcamento.valor_total)}</strong></td>
                    </tr>
                </tfoot>
            </table>
            
            <p><strong>Validade:</strong> ${orcamento.validade || '30 dias'}</p>
            <p><strong>Condição de Pagamento:</strong> ${orcamento.condicao_pagamento || 'A combinar'}</p>
            
            ${orcamento.observacoes ? `<p><strong>Observações:</strong> ${orcamento.observacoes}</p>` : ''}
            
            <p style="margin-top: 20px;">Aguardamos seu retorno!</p>
        `;

        return this.enviar(
            cliente.email,
            `Orçamento #${orcamento.id} - ${this.empresa.nome}`,
            html
        );
    }

    /**
     * Envia confirmação de pedido aprovado
     */
    async enviarPedidoAprovado(pedido, cliente) {
        const html = `
            <h2>✅ Pedido Aprovado!</h2>
            <p>Prezado(a) ${cliente.nome},</p>
            <p>Seu pedido <strong>#${pedido.id}</strong> foi aprovado e está em processamento.</p>
            
            <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0;">
                <p><strong>Valor Total:</strong> ${this.formatarMoeda(pedido.valor_total)}</p>
                <p><strong>Previsão de Entrega:</strong> ${this.formatarData(pedido.data_previsao) || 'A confirmar'}</p>
            </div>
            
            <p>Você receberá atualizações sobre o status do seu pedido.</p>
        `;

        return this.enviar(
            cliente.email,
            `Pedido #${pedido.id} Aprovado - ${this.empresa.nome}`,
            html
        );
    }

    // ==================== EMAILS DO MÓDULO COMPRAS ====================

    /**
     * Envia solicitação de cotação para fornecedor
     */
    async enviarCotacao(cotacao, fornecedor) {
        const html = `
            <h2>Solicitação de Cotação #${cotacao.id}</h2>
            <p>Prezado(a) ${fornecedor.contato || fornecedor.nome},</p>
            <p>Solicitamos gentilmente sua cotação para os itens abaixo:</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                    <tr style="background: #7c3aed; color: white;">
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Item</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Descrição</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Qtd</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">UN</th>
                    </tr>
                </thead>
                <tbody>
                    ${(cotacao.itens || []).map((item, idx) => `
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${idx + 1}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${item.descricao}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${item.quantidade}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${item.unidade}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
                <p><strong>⏰ Data limite para resposta:</strong> ${this.formatarData(cotacao.data_limite)}</p>
            </div>
            
            <p>Por favor, responda este email com sua proposta comercial incluindo:</p>
            <ul>
                <li>Preços unitários</li>
                <li>Prazo de entrega</li>
                <li>Condições de pagamento</li>
                <li>Validade da proposta</li>
            </ul>
        `;

        return this.enviar(
            fornecedor.email,
            `Solicitação de Cotação #${cotacao.id} - ${this.empresa.nome}`,
            html
        );
    }

    /**
     * Envia pedido de compra aprovado para fornecedor
     */
    async enviarPedidoCompra(pedido, fornecedor) {
        const html = `
            <h2>Pedido de Compra #${pedido.numero_pedido}</h2>
            <p>Prezado(a) ${fornecedor.contato || fornecedor.nome},</p>
            <p>Confirmamos o pedido de compra conforme detalhamento abaixo:</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                    <tr style="background: #7c3aed; color: white;">
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Código</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Descrição</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Qtd</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Valor Unit.</th>
                        <th style="padding: 10px; border: 1px solid #e5e7eb;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${(pedido.itens || []).map(item => `
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${item.codigo}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb;">${item.descricao}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${item.quantidade}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">${this.formatarMoeda(item.preco_unitario)}</td>
                        <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">${this.formatarMoeda(item.total)}</td>
                    </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr style="background: #7c3aed; color: white;">
                        <td colspan="4" style="padding: 10px; text-align: right;"><strong>TOTAL:</strong></td>
                        <td style="padding: 10px; text-align: right;"><strong>${this.formatarMoeda(pedido.valor_final)}</strong></td>
                    </tr>
                </tfoot>
            </table>
            
            <p><strong>Previsão de Entrega:</strong> ${this.formatarData(pedido.data_previsao)}</p>
            <p><strong>Condição de Pagamento:</strong> ${pedido.condicao_pagamento || 'Conforme negociado'}</p>
            
            <p style="margin-top: 20px;">Por favor, confirme o recebimento deste pedido.</p>
        `;

        return this.enviar(
            fornecedor.email,
            `Pedido de Compra #${pedido.numero_pedido} - ${this.empresa.nome}`,
            html
        );
    }

    // ==================== EMAILS DO MÓDULO FINANCEIRO ====================

    /**
     * Envia lembrete de vencimento
     */
    async enviarLembreteVencimento(conta, cliente) {
        const diasRestantes = this.calcularDiasRestantes(conta.data_vencimento);
        
        const html = `
            <h2>⏰ Lembrete de Vencimento</h2>
            <p>Prezado(a) ${cliente.nome},</p>
            <p>Este é um lembrete de que você possui um título com vencimento ${diasRestantes === 0 ? 'HOJE' : `em ${diasRestantes} dia(s)`}.</p>
            
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
                <p><strong>Descrição:</strong> ${conta.descricao}</p>
                <p><strong>Valor:</strong> ${this.formatarMoeda(conta.valor)}</p>
                <p><strong>Vencimento:</strong> ${this.formatarData(conta.data_vencimento)}</p>
                ${conta.numero_nf ? `<p><strong>NF:</strong> ${conta.numero_nf}</p>` : ''}
            </div>
            
            <p>Caso já tenha efetuado o pagamento, por favor desconsidere este aviso.</p>
        `;

        return this.enviar(
            cliente.email,
            `Lembrete: Vencimento em ${this.formatarData(conta.data_vencimento)} - ${this.empresa.nome}`,
            html
        );
    }

    /**
     * Envia aviso de título vencido (cobrança)
     */
    async enviarCobranca(conta, cliente) {
        const diasVencido = Math.abs(this.calcularDiasRestantes(conta.data_vencimento));
        
        const html = `
            <h2>⚠️ Aviso de Título Vencido</h2>
            <p>Prezado(a) ${cliente.nome},</p>
            <p>Identificamos que o título abaixo encontra-se vencido há <strong>${diasVencido} dia(s)</strong>:</p>
            
            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                <p><strong>Descrição:</strong> ${conta.descricao}</p>
                <p><strong>Valor Original:</strong> ${this.formatarMoeda(conta.valor)}</p>
                <p><strong>Vencimento:</strong> ${this.formatarData(conta.data_vencimento)}</p>
                ${conta.juros ? `<p><strong>Juros/Multa:</strong> ${this.formatarMoeda(conta.juros + (conta.multa || 0))}</p>` : ''}
            </div>
            
            <p>Solicitamos a regularização do pagamento o mais breve possível.</p>
            <p>Em caso de dúvidas ou para negociação, entre em contato conosco.</p>
        `;

        return this.enviar(
            cliente.email,
            `URGENTE: Título Vencido - ${this.empresa.nome}`,
            html
        );
    }

    // ==================== EMAILS DO MÓDULO NFE ====================

    /**
     * Envia NF-e para destinatário
     */
    async enviarNFe(nfe, destinatario, anexos = []) {
        const html = `
            <h2>📄 Nota Fiscal Eletrônica</h2>
            <p>Prezado(a) ${destinatario.nome},</p>
            <p>Segue a Nota Fiscal Eletrônica referente à sua compra:</p>
            
            <div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 15px; margin: 20px 0;">
                <p><strong>Número da NF-e:</strong> ${nfe.numero}</p>
                <p><strong>Série:</strong> ${nfe.serie}</p>
                <p><strong>Data de Emissão:</strong> ${this.formatarData(nfe.data_emissao)}</p>
                <p><strong>Valor Total:</strong> ${this.formatarMoeda(nfe.valor_total)}</p>
                <p><strong>Chave de Acesso:</strong></p>
                <p style="font-family: monospace; word-break: break-all; background: #e5e7eb; padding: 10px;">${nfe.chave_acesso}</p>
            </div>
            
            <p>Para consultar a autenticidade desta NF-e, acesse:</p>
            <p><a href="https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx">Portal Nacional da NF-e</a></p>
            
            <p>Em anexo você encontrará o DANFE (PDF) e o XML da nota fiscal.</p>
        `;

        return this.enviar(
            destinatario.email,
            `NF-e ${nfe.numero} - ${this.empresa.nome}`,
            html,
            { attachments: anexos }
        );
    }

    // ==================== EMAILS DO MÓDULO RH ====================

    /**
     * Envia holerite para funcionário
     */
    async enviarHolerite(funcionario, competencia, anexo) {
        const html = `
            <h2>📋 Holerite - ${competencia}</h2>
            <p>Prezado(a) ${funcionario.nome},</p>
            <p>Segue em anexo seu holerite referente à competência <strong>${competencia}</strong>.</p>
            
            <p>Este documento também está disponível no Portal do Funcionário.</p>
            
            <p style="margin-top: 20px; color: #666; font-size: 12px;">
                Em caso de dúvidas, entre em contato com o setor de RH.
            </p>
        `;

        return this.enviar(
            funcionario.email,
            `Holerite ${competencia} - ${this.empresa.nome}`,
            html,
            { attachments: anexo ? [anexo] : [] }
        );
    }

    /**
     * Envia notificação de férias aprovadas
     */
    async enviarFeriasAprovadas(funcionario, ferias) {
        const html = `
            <h2>🏖️ Férias Aprovadas!</h2>
            <p>Prezado(a) ${funcionario.nome},</p>
            <p>Suas férias foram aprovadas conforme solicitação:</p>
            
            <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0;">
                <p><strong>Período:</strong> ${this.formatarData(ferias.data_inicio)} a ${this.formatarData(ferias.data_fim)}</p>
                <p><strong>Dias:</strong> ${ferias.dias_totais} dias</p>
                ${ferias.abono ? `<p><strong>Abono Pecuniário:</strong> ${ferias.dias_abono} dias</p>` : ''}
            </div>
            
            <p><strong>Data de Retorno:</strong> ${this.formatarData(ferias.data_retorno)}</p>
            
            <p>Boas férias!</p>
        `;

        return this.enviar(
            funcionario.email,
            `Férias Aprovadas - ${this.empresa.nome}`,
            html
        );
    }

    // ==================== MÉTODOS AUXILIARES ====================

    wrapTemplate(conteudo) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">${this.empresa.nome}</h1>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
        ${conteudo}
    </div>
    
    <!-- Footer -->
    <div style="background: #f3f4f6; padding: 20px; text-align: center; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="margin: 0; color: #666; font-size: 12px;">
            ${this.empresa.nome}<br>
            ${this.empresa.telefone} | ${this.empresa.site}
        </p>
        <p style="margin: 10px 0 0; color: #999; font-size: 11px;">
            Este é um email automático enviado pelo Sistema Aluforce ERP.<br>
            Por favor, não responda diretamente a este email.
        </p>
    </div>
</body>
</html>`;
    }

    formatarData(data) {
        if (!data) return null;
        return new Date(data).toLocaleDateString('pt-BR');
    }

    formatarMoeda(valor) {
        if (valor === null || valor === undefined) return 'R$ 0,00';
        return parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    calcularDiasRestantes(dataVencimento) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const vencimento = new Date(dataVencimento);
        vencimento.setHours(0, 0, 0, 0);
        const diff = vencimento - hoje;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    /**
     * Retorna templates predefinidos
     */
    getTemplates() {
        return {
            // Templates podem ser customizados aqui
        };
    }
}

module.exports = ServicoEmail;
