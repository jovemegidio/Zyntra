/**
 * INTEGRAÇÍO: PCP ↔ VENDAS
 * Sincroniza pedidos de venda com ordens de produção
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

class IntegracaoPCPVendas {
    constructor(config = {}) {
        this.pcpUrl = config.pcpUrl || 'http://localhost:3000';
        this.vendasUrl = config.vendasUrl || 'http://localhost:3003';
    }

    /**
     * Gera Ordem de Produção a partir de um pedido de venda
     * @param {number} pedidoId - ID do pedido em Vendas
     * @param {object} opcoes - Opções de geração
     * @returns {Promise<object>} Resultado da operação
     */
    async gerarOrdemProducao(pedidoId, opcoes = {}) {
        const {
            prioridade = 'normal',
            dataPrevisao = null,
            observacoes = '',
            token = null
        } = opcoes;

        try {
            // 1. Buscar dados do pedido
            const pedido = await this.buscarPedidoVendas(pedidoId, token);
            
            if (!pedido) {
                throw new Error(`Pedido ${pedidoId} não encontrado`);
            }

            // 2. Validar pedido
            if (!['aprovado', 'em_producao'].includes(pedido.status)) {
                throw new Error(`Pedido com status '${pedido.status}' não pode gerar OP`);
            }

            // 3. Preparar dados da OP
            const dataEntrega = dataPrevisao || pedido.data_previsao || this.calcularDataPrevisao(7);
            
            const dadosOP = {
                pedido_vendas_id: pedidoId,
                numero_pedido_cliente: pedido.id,
                cliente_id: pedido.empresa_id,
                cliente_nome: pedido.empresa_nome || pedido.cliente_nome,
                prioridade,
                data_previsao: dataEntrega,
                observacoes: observacoes || `Gerado do pedido de venda #${pedidoId}`,
                itens: pedido.itens.map(item => ({
                    produto_codigo: item.codigo,
                    produto_descricao: item.descricao,
                    quantidade: item.quantidade,
                    unidade: item.unidade,
                    observacoes: item.observacoes || ''
                })),
                status: 'a_produzir'
            };

            // 4. Criar OP no PCP
            const response = await fetch(`${this.pcpUrl}/api/pcp/ordens-producao`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify(dadosOP)
            });

            const resultado = await response.json();

            if (!response.ok) {
                throw new Error(resultado.message || 'Erro ao criar Ordem de Produção');
            }

            // 5. Atualizar pedido de venda com referência da OP
            await this.vincularOPAoPedido(pedidoId, resultado.id, token);

            return {
                success: true,
                message: 'Ordem de Produção criada com sucesso',
                op_id: resultado.id,
                op_numero: resultado.numero,
                data_previsao: dataEntrega
            };

        } catch (error) {
            console.error('[IntegracaoPCPVendas] Erro:', error);
            return {
                success: false,
                message: error.message,
                error
            };
        }
    }

    /**
     * Busca dados do pedido no módulo Vendas
     */
    async buscarPedidoVendas(pedidoId, token) {
        try {
            const response = await fetch(`${this.vendasUrl}/api/vendas/pedidos/${pedidoId}`, {
                headers: {
                    'Authorization': token ? `Bearer ${token}` : ''
                }
            });

            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    /**
     * Vincula OP ao pedido de venda
     */
    async vincularOPAoPedido(pedidoId, opId, token) {
        try {
            await fetch(`${this.vendasUrl}/api/vendas/pedidos/${pedidoId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    op_id: opId,
                    status: 'em_producao'
                })
            });
        } catch (error) {
            console.error('[IntegracaoPCPVendas] Erro ao vincular OP:', error);
        }
    }

    /**
     * Atualiza status do pedido baseado no progresso da OP
     */
    async sincronizarStatusOP(opId, novoStatus, token) {
        try {
            // Buscar OP para pegar pedido vinculado
            const opResponse = await fetch(`${this.pcpUrl}/api/pcp/ordens-producao/${opId}`, {
                headers: { 'Authorization': token ? `Bearer ${token}` : '' }
            });

            if (!opResponse.ok) return { success: false };

            const op = await opResponse.json();
            
            if (!op.pedido_vendas_id) {
                return { success: true, message: 'OP sem pedido vinculado' };
            }

            // Mapear status da OP para status do pedido
            const statusMap = {
                'a_produzir': 'em_producao',
                'produzindo': 'em_producao',
                'qualidade': 'em_producao',
                'conferido': 'em_producao',
                'concluido': 'produzido',
                'armazenado': 'pronto_faturar'
            };

            const novoStatusPedido = statusMap[novoStatus];
            
            if (novoStatusPedido) {
                await fetch(`${this.vendasUrl}/api/vendas/pedidos/${op.pedido_vendas_id}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({ status: novoStatusPedido })
                });
            }

            return { success: true, novo_status: novoStatusPedido };

        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Lista OPs vinculadas a um pedido
     */
    async listarOPsDoPedido(pedidoId, token) {
        try {
            const response = await fetch(
                `${this.pcpUrl}/api/pcp/ordens-producao?pedido_vendas_id=${pedidoId}`,
                {
                    headers: { 'Authorization': token ? `Bearer ${token}` : '' }
                }
            );

            if (!response.ok) return [];

            const data = await response.json();
            return data.ordens || data || [];
        } catch (error) {
            return [];
        }
    }

    /**
     * Verifica disponibilidade de materiais para produção
     */
    async verificarDisponibilidadeMateriais(pedidoId, token) {
        try {
            const pedido = await this.buscarPedidoVendas(pedidoId, token);
            
            if (!pedido || !pedido.itens) {
                return { disponivel: false, message: 'Pedido sem itens' };
            }

            const indisponibilidades = [];

            for (const item of pedido.itens) {
                // Verificar estoque no PCP
                const estoqueResponse = await fetch(
                    `${this.pcpUrl}/api/pcp/estoque/produto/${item.codigo}`,
                    {
                        headers: { 'Authorization': token ? `Bearer ${token}` : '' }
                    }
                );

                if (estoqueResponse.ok) {
                    const estoque = await estoqueResponse.json();
                    const qtdDisponivel = estoque.quantidade_disponivel || 0;
                    
                    if (qtdDisponivel < item.quantidade) {
                        indisponibilidades.push({
                            codigo: item.codigo,
                            descricao: item.descricao,
                            necessario: item.quantidade,
                            disponivel: qtdDisponivel,
                            falta: item.quantidade - qtdDisponivel
                        });
                    }
                }
            }

            return {
                disponivel: indisponibilidades.length === 0,
                itens_indisponiveis: indisponibilidades,
                message: indisponibilidades.length > 0 
                    ? `${indisponibilidades.length} item(s) com estoque insuficiente`
                    : 'Todos os materiais disponíveis'
            };

        } catch (error) {
            return { disponivel: false, message: error.message };
        }
    }

    /**
     * Calcula data de previsão padrão
     */
    calcularDataPrevisao(diasUteis = 7) {
        const data = new Date();
        let diasAdicionados = 0;
        
        while (diasAdicionados < diasUteis) {
            data.setDate(data.getDate() + 1);
            const diaSemana = data.getDay();
            // Pular sábado (6) e domingo (0)
            if (diaSemana !== 0 && diaSemana !== 6) {
                diasAdicionados++;
            }
        }
        
        return data.toISOString().split('T')[0];
    }

    /**
     * Obtém status consolidado de produção para um pedido
     */
    async statusProducaoPedido(pedidoId, token) {
        const ops = await this.listarOPsDoPedido(pedidoId, token);
        
        if (ops.length === 0) {
            return { status: 'sem_op', message: 'Nenhuma OP vinculada' };
        }

        const statusCount = {};
        let totalItens = 0;
        let itensFinalizados = 0;

        for (const op of ops) {
            statusCount[op.status] = (statusCount[op.status] || 0) + 1;
            
            if (op.itens) {
                totalItens += op.itens.length;
                itensFinalizados += op.itens.filter(i => 
                    ['concluido', 'armazenado'].includes(i.status)
                ).length;
            }
        }

        const percentualConcluido = totalItens > 0 
            ? Math.round((itensFinalizados / totalItens) * 100) 
            : 0;

        // Determinar status geral
        let statusGeral = 'em_andamento';
        if (ops.every(op => ['concluido', 'armazenado'].includes(op.status))) {
            statusGeral = 'finalizado';
        } else if (ops.every(op => op.status === 'a_produzir')) {
            statusGeral = 'aguardando';
        }

        return {
            status: statusGeral,
            total_ops: ops.length,
            percentual_concluido: percentualConcluido,
            detalhes: statusCount
        };
    }
}

// Exportar para uso em Node.js e Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IntegracaoPCPVendas;
}

if (typeof window !== 'undefined') {
    window.IntegracaoPCPVendas = IntegracaoPCPVendas;
}
