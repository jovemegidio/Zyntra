/**
 * INTEGRAÇÍO: VENDAS → FATURAMENTO
 * Permite faturar pedidos de venda gerando NF-e automaticamente
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

class IntegracaoVendasFaturamento {
    constructor(config = {}) {
        this.faturamentoUrl = config.faturamentoUrl || 'http://localhost:3001';
        this.vendasUrl = config.vendasUrl || 'http://localhost:3003';
    }

    /**
     * Gera NF-e a partir de um pedido de venda
     * @param {number} pedidoId - ID do pedido em Vendas
     * @param {object} opcoes - Opções de faturamento
     * @returns {Promise<object>} Resultado da operação
     */
    async faturarPedido(pedidoId, opcoes = {}) {
        const {
            gerarDanfe = true,
            enviarEmail = false,
            numeroParcelas = 1,
            diaVencimento = 30,
            intervalo = 30,
            autoIntegrarFinanceiro = true,
            autoReservarEstoque = true,
            autoValidarEstoque = true,
            token = null
        } = opcoes;

        try {
            // 1. Buscar dados do pedido em Vendas
            const pedido = await this.buscarPedidoVendas(pedidoId, token);
            
            if (!pedido) {
                throw new Error(`Pedido ${pedidoId} não encontrado`);
            }

            // 2. Validar se pode ser faturado
            const validacao = this.validarPedidoParaFaturamento(pedido);
            if (!validacao.valido) {
                throw new Error(`Pedido não pode ser faturado: ${validacao.erros.join(', ')}`);
            }

            // 3. Chamar API de faturamento
            const response = await fetch(`${this.faturamentoUrl}/api/faturamento/gerar-nfe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    pedido_id: pedidoId,
                    gerar_danfe: gerarDanfe,
                    enviar_email: enviarEmail,
                    numeroParcelas,
                    diaVencimento,
                    intervalo,
                    autoIntegrarFinanceiro,
                    autoReservarEstoque,
                    autoValidarEstoque,
                    // Dados do pedido para o faturamento
                    dados_pedido: {
                        cliente_id: pedido.empresa_id,
                        vendedor_id: pedido.vendedor_id,
                        itens: pedido.itens,
                        valor_total: pedido.valor_total,
                        valor_frete: pedido.valor_frete,
                        condicao_pagamento: pedido.condicao_pagamento,
                        observacoes: pedido.observacoes
                    }
                })
            });

            const resultado = await response.json();

            if (!response.ok) {
                throw new Error(resultado.message || 'Erro ao gerar NF-e');
            }

            // 4. Atualizar status do pedido em Vendas
            await this.atualizarStatusPedido(pedidoId, 'faturado', {
                nfe_id: resultado.nfe_id,
                numero_nf: resultado.numero_nf,
                chave_acesso: resultado.chave_acesso
            }, token);

            return {
                success: true,
                message: 'NF-e gerada com sucesso',
                nfe_id: resultado.nfe_id,
                numero_nf: resultado.numero_nf,
                chave_acesso: resultado.chave_acesso,
                danfe_url: resultado.danfe_url,
                xml_url: resultado.xml_url
            };

        } catch (error) {
            console.error('[IntegracaoVendasFaturamento] Erro:', error);
            return {
                success: false,
                message: error.message,
                error: error
            };
        }
    }

    /**
     * Busca dados completos do pedido no módulo Vendas
     */
    async buscarPedidoVendas(pedidoId, token) {
        try {
            const response = await fetch(`${this.vendasUrl}/api/vendas/pedidos/${pedidoId}`, {
                headers: {
                    'Authorization': token ? `Bearer ${token}` : ''
                }
            });

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('[IntegracaoVendasFaturamento] Erro ao buscar pedido:', error);
            return null;
        }
    }

    /**
     * Valida se o pedido pode ser faturado
     */
    validarPedidoParaFaturamento(pedido) {
        const erros = [];

        // Status deve ser 'aprovado'
        if (pedido.status !== 'aprovado') {
            erros.push(`Status inválido: ${pedido.status}. Deve ser 'aprovado'`);
        }

        // Deve ter cliente/empresa
        if (!pedido.empresa_id && !pedido.cliente_id) {
            erros.push('Pedido sem cliente/empresa vinculado');
        }

        // Deve ter itens
        if (!pedido.itens || pedido.itens.length === 0) {
            erros.push('Pedido sem itens');
        }

        // Não pode já ter sido faturado
        if (pedido.nfe_id || pedido.status === 'faturado') {
            erros.push('Pedido já foi faturado');
        }

        // Valor deve ser maior que zero
        if (!pedido.valor_total || pedido.valor_total <= 0) {
            erros.push('Valor total inválido');
        }

        return {
            valido: erros.length === 0,
            erros
        };
    }

    /**
     * Atualiza o status do pedido após faturamento
     */
    async atualizarStatusPedido(pedidoId, status, dadosNfe, token) {
        try {
            const response = await fetch(`${this.vendasUrl}/api/vendas/pedidos/${pedidoId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    status,
                    nfe_id: dadosNfe.nfe_id,
                    numero_nf: dadosNfe.numero_nf,
                    chave_acesso: dadosNfe.chave_acesso,
                    faturado_em: new Date().toISOString()
                })
            });

            return response.ok;
        } catch (error) {
            console.error('[IntegracaoVendasFaturamento] Erro ao atualizar status:', error);
            return false;
        }
    }

    /**
     * Cancela uma NF-e e reverte o status do pedido
     */
    async cancelarNfe(nfeId, pedidoId, justificativa, token) {
        try {
            // 1. Cancelar NF-e no módulo Faturamento
            const response = await fetch(`${this.faturamentoUrl}/api/faturamento/nfes/${nfeId}/cancelar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ justificativa })
            });

            if (!response.ok) {
                const erro = await response.json();
                throw new Error(erro.message || 'Erro ao cancelar NF-e');
            }

            // 2. Reverter status do pedido
            await this.atualizarStatusPedido(pedidoId, 'aprovado', {
                nfe_id: null,
                numero_nf: null,
                chave_acesso: null
            }, token);

            return { success: true, message: 'NF-e cancelada com sucesso' };

        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Consulta status de uma NF-e
     */
    async consultarStatusNfe(nfeId, token) {
        try {
            const response = await fetch(`${this.faturamentoUrl}/api/faturamento/nfes/${nfeId}`, {
                headers: {
                    'Authorization': token ? `Bearer ${token}` : ''
                }
            });

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            return null;
        }
    }

    /**
     * Gera DANFE de uma NF-e
     */
    async gerarDanfe(nfeId, token) {
        try {
            const response = await fetch(`${this.faturamentoUrl}/api/faturamento/nfes/${nfeId}/danfe`, {
                headers: {
                    'Authorization': token ? `Bearer ${token}` : ''
                }
            });

            if (!response.ok) {
                throw new Error('Erro ao gerar DANFE');
            }

            // Retorna blob do PDF
            return await response.blob();
        } catch (error) {
            return null;
        }
    }
}

// Exportar para uso em Node.js e Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IntegracaoVendasFaturamento;
}

if (typeof window !== 'undefined') {
    window.IntegracaoVendasFaturamento = IntegracaoVendasFaturamento;
}
