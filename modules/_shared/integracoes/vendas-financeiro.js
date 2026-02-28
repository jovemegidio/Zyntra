/**
 * INTEGRAÇÍO: VENDAS → FINANCEIRO
 * Gera contas a receber automaticamente a partir de pedidos faturados
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

class IntegracaoVendasFinanceiro {
    constructor(config = {}) {
        this.financeiroUrl = config.financeiroUrl || 'http://localhost:3004';
        this.vendasUrl = config.vendasUrl || 'http://localhost:3003';
    }

    /**
     * Gera contas a receber a partir de um pedido faturado
     * @param {object} pedido - Dados do pedido
     * @param {object} opcoes - Opções de parcelamento
     * @returns {Promise<object>} Resultado da operação
     */
    async gerarContasReceber(pedido, opcoes = {}) {
        const {
            numeroParcelas = 1,
            diasPrimeiroVencimento = 30,
            intervaloDias = 30,
            formaPagamento = 'boleto',
            categoriaId = null,
            bancoId = null,
            token = null
        } = opcoes;

        try {
            const contasCriadas = [];
            const valorTotal = parseFloat(pedido.valor_total) || 0;
            const valorParcela = valorTotal / numeroParcelas;
            
            // Dados do cliente
            const clienteNome = pedido.empresa_nome || pedido.cliente_nome || 'Cliente não identificado';

            for (let i = 0; i < numeroParcelas; i++) {
                const dataVencimento = new Date();
                dataVencimento.setDate(dataVencimento.getDate() + diasPrimeiroVencimento + (i * intervaloDias));

                const parcela = i + 1;
                const descricao = numeroParcelas > 1
                    ? `Pedido #${pedido.id} - ${clienteNome} (${parcela}/${numeroParcelas})`
                    : `Pedido #${pedido.id} - ${clienteNome}`;

                const contaData = {
                    descricao,
                    valor: Math.round(valorParcela * 100) / 100,
                    data_vencimento: dataVencimento.toISOString().split('T')[0],
                    cliente_id: pedido.empresa_id || pedido.cliente_id,
                    pedido_id: pedido.id,
                    nfe_id: pedido.nfe_id || null,
                    numero_nf: pedido.numero_nf || null,
                    numero_parcela: parcela,
                    total_parcelas: numeroParcelas,
                    forma_pagamento: formaPagamento,
                    categoria_id: categoriaId,
                    banco_id: bancoId,
                    observacoes: `Gerado automaticamente do pedido de venda #${pedido.id}`,
                    status: 'PENDENTE'
                };

                const response = await fetch(`${this.financeiroUrl}/api/financeiro/contas-receber`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify(contaData)
                });

                const resultado = await response.json();

                if (response.ok) {
                    contasCriadas.push({
                        id: resultado.id,
                        parcela,
                        valor: contaData.valor,
                        vencimento: contaData.data_vencimento
                    });
                } else {
                    console.error(`[IntegracaoVendasFinanceiro] Erro na parcela ${parcela}:`, resultado);
                }
            }

            // Ajustar última parcela para compensar arredondamentos
            if (contasCriadas.length === numeroParcelas && numeroParcelas > 1) {
                const somaGerada = contasCriadas.reduce((acc, c) => acc + c.valor, 0);
                const diferenca = valorTotal - somaGerada;
                
                if (Math.abs(diferenca) > 0.01) {
                    // Atualizar última parcela
                    const ultimaConta = contasCriadas[contasCriadas.length - 1];
                    await this.atualizarValorConta(ultimaConta.id, ultimaConta.valor + diferenca, token);
                    ultimaConta.valor += diferenca;
                }
            }

            return {
                success: true,
                message: `${contasCriadas.length} conta(s) a receber gerada(s)`,
                contas: contasCriadas,
                valor_total: valorTotal
            };

        } catch (error) {
            console.error('[IntegracaoVendasFinanceiro] Erro:', error);
            return {
                success: false,
                message: error.message,
                error
            };
        }
    }

    /**
     * Atualiza valor de uma conta a receber
     */
    async atualizarValorConta(contaId, novoValor, token) {
        try {
            await fetch(`${this.financeiroUrl}/api/financeiro/contas-receber/${contaId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ valor: novoValor })
            });
        } catch (error) {
            console.error('[IntegracaoVendasFinanceiro] Erro ao atualizar valor:', error);
        }
    }

    /**
     * Busca contas a receber de um pedido específico
     */
    async buscarContasDoPedido(pedidoId, token) {
        try {
            const response = await fetch(
                `${this.financeiroUrl}/api/financeiro/contas-receber?pedido_id=${pedidoId}`,
                {
                    headers: {
                        'Authorization': token ? `Bearer ${token}` : ''
                    }
                }
            );

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            return data.contas || data || [];
        } catch (error) {
            return [];
        }
    }

    /**
     * Cancela contas a receber de um pedido (quando NFe é cancelada)
     */
    async cancelarContasDoPedido(pedidoId, motivo, token) {
        try {
            const contas = await this.buscarContasDoPedido(pedidoId, token);
            let canceladas = 0;

            for (const conta of contas) {
                if (conta.status === 'PENDENTE') {
                    const response = await fetch(
                        `${this.financeiroUrl}/api/financeiro/contas-receber/${conta.id}`,
                        {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': token ? `Bearer ${token}` : ''
                            },
                            body: JSON.stringify({
                                status: 'CANCELADA',
                                observacoes: `Cancelado: ${motivo}`
                            })
                        }
                    );

                    if (response.ok) {
                        canceladas++;
                    }
                }
            }

            return {
                success: true,
                message: `${canceladas} conta(s) cancelada(s)`,
                total_canceladas: canceladas
            };

        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Registra recebimento de uma conta
     */
    async registrarRecebimento(contaId, dadosPagamento, token) {
        const {
            valor_pago,
            data_pagamento = new Date().toISOString().split('T')[0],
            forma_pagamento,
            banco_id,
            observacoes
        } = dadosPagamento;

        try {
            const response = await fetch(
                `${this.financeiroUrl}/api/financeiro/contas-receber/${contaId}/pagar`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({
                        valor_pago,
                        data_pagamento,
                        forma_pagamento,
                        banco_id,
                        observacoes
                    })
                }
            );

            const resultado = await response.json();

            if (!response.ok) {
                throw new Error(resultado.message || 'Erro ao registrar recebimento');
            }

            return { success: true, ...resultado };

        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Obtém resumo financeiro de um cliente
     */
    async resumoFinanceiroCliente(clienteId, token) {
        try {
            const response = await fetch(
                `${this.financeiroUrl}/api/financeiro/clientes/${clienteId}/resumo`,
                {
                    headers: {
                        'Authorization': token ? `Bearer ${token}` : ''
                    }
                }
            );

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            return null;
        }
    }

    /**
     * Verifica se cliente tem débitos em aberto
     */
    async clienteComDebitos(clienteId, token) {
        try {
            const contas = await fetch(
                `${this.financeiroUrl}/api/financeiro/contas-receber?cliente_id=${clienteId}&status=VENCIDA`,
                {
                    headers: {
                        'Authorization': token ? `Bearer ${token}` : ''
                    }
                }
            );

            if (!contas.ok) return false;

            const data = await contas.json();
            const lista = data.contas || data || [];
            
            return lista.length > 0;
        } catch (error) {
            return false;
        }
    }
}

// Exportar para uso em Node.js e Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IntegracaoVendasFinanceiro;
}

if (typeof window !== 'undefined') {
    window.IntegracaoVendasFinanceiro = IntegracaoVendasFinanceiro;
}
