/**
 * SERVIÇO DE INTEGRAÇÃO COM VENDAS E ESTOQUE
 * Integra faturamento com controle de vendas, estoque e produção (PCP)
 */

class VendasEstoqueIntegracaoService {
    
    constructor(pool) {
        this.pool = pool;
    }
    
    /**
     * Validar estoque antes de faturar
     */
    async validarEstoqueParaFaturamento(pedido_id) {
        try {
            // Buscar itens do pedido
            const [itens] = await this.pool.query(`
                SELECT 
                    pi.produto_id,
                    pi.quantidade,
                    p.descricao as produto_descricao,
                    p.codigo as produto_codigo,
                    p.controla_estoque,
                    p.estoque_minimo,
                    COALESCE(e.quantidade_disponivel, 0) as estoque_disponivel
                FROM pedido_itens pi
                INNER JOIN produtos p ON pi.produto_id = p.id
                LEFT JOIN estoque e ON p.id = e.produto_id
                WHERE pi.pedido_id = ?
            `, [pedido_id]);
            
            const problemas = [];
            
            for (const item of itens) {
                if (item.controla_estoque) {
                    const quantidadeNecessaria = parseFloat(item.quantidade);
                    const estoqueDisponivel = parseFloat(item.estoque_disponivel);
                    
                    if (quantidadeNecessaria > estoqueDisponivel) {
                        problemas.push({
                            produto_id: item.produto_id,
                            produto: `${item.produto_codigo} - ${item.produto_descricao}`,
                            necessario: quantidadeNecessaria,
                            disponivel: estoqueDisponivel,
                            faltante: quantidadeNecessaria - estoqueDisponivel
                        });
                    }
                }
            }
            
            if (problemas.length > 0) {
                return {
                    valido: false,
                    problemas,
                    mensagem: 'Estoque insuficiente para alguns produtos'
                };
            }
            
            return {
                valido: true,
                mensagem: 'Estoque disponível para todos os produtos'
            };
            
        } catch (error) {
            throw new Error(`Erro ao validar estoque: ${error.message}`);
        }
    }
    
    /**
     * Reservar estoque para faturamento
     */
    async reservarEstoque(pedido_id, usuario_id) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Buscar itens do pedido
            const [itens] = await connection.query(`
                SELECT pi.*, p.controla_estoque
                FROM pedido_itens pi
                INNER JOIN produtos p ON pi.produto_id = p.id
                WHERE pi.pedido_id = ?
            `, [pedido_id]);
            
            for (const item of itens) {
                if (item.controla_estoque) {
                    // Criar reserva
                    await connection.query(`
                        INSERT INTO estoque_reservas (
                            produto_id,
                            pedido_id,
                            quantidade,
                            tipo,
                            status,
                            usuario_id,
                            created_at
                        ) VALUES (?, ?, ?, 'faturamento', 'ativa', ?, NOW())
                    `, [item.produto_id, pedido_id, item.quantidade, usuario_id]);
                    
                    // Atualizar estoque disponível
                    await connection.query(`
                        UPDATE estoque
                        SET quantidade_reservada = quantidade_reservada + ?
                        WHERE produto_id = ?
                    `, [item.quantidade, item.produto_id]);
                }
            }
            
            // Marcar pedido como com estoque reservado
            await connection.query(`
                UPDATE pedidos
                SET estoque_reservado = 1
                WHERE id = ?
            `, [pedido_id]);
            
            await connection.commit();
            
            return {
                success: true,
                mensagem: 'Estoque reservado com sucesso'
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Baixar estoque ao faturar NFe
     */
    async baixarEstoque(nfe_id, usuario_id) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Buscar NFe e itens
            const [nfe] = await connection.query(`
                SELECT * FROM nfe WHERE id = ?
            `, [nfe_id]);
            
            if (nfe.length === 0) {
                throw new Error('NFe não encontrada');
            }
            
            const nfeData = nfe[0];
            
            const [itens] = await connection.query(`
                SELECT ni.*, p.controla_estoque
                FROM nfe_itens ni
                INNER JOIN produtos p ON ni.produto_id = p.id
                WHERE ni.nfe_id = ?
            `, [nfe_id]);
            
            for (const item of itens) {
                if (item.controla_estoque) {
                    // Registrar movimento de saída
                    await connection.query(`
                        INSERT INTO estoque_movimentos (
                            produto_id,
                            tipo_movimento,
                            quantidade,
                            valor_unitario,
                            documento_tipo,
                            documento_id,
                            observacoes,
                            usuario_id,
                            data_movimento,
                            created_at
                        ) VALUES (?, 'saida', ?, ?, 'nfe', ?, ?, ?, NOW(), NOW())
                    `, [
                        item.produto_id,
                        item.quantidade,
                        item.valor_unitario,
                        nfe_id,
                        `Saída por faturamento NF-e ${nfeData.numero_nfe}`,
                        usuario_id
                    ]);
                    
                    // Atualizar estoque
                    await connection.query(`
                        UPDATE estoque
                        SET quantidade_disponivel = quantidade_disponivel - ?,
                            quantidade_reservada = GREATEST(0, quantidade_reservada - ?),
                            ultima_saida = NOW()
                        WHERE produto_id = ?
                    `, [item.quantidade, item.quantidade, item.produto_id]);
                    
                    // Liberar reserva se existir
                    if (nfeData.pedido_id) {
                        await connection.query(`
                            UPDATE estoque_reservas
                            SET status = 'baixada', data_baixa = NOW()
                            WHERE pedido_id = ? AND produto_id = ? AND status = 'ativa'
                        `, [nfeData.pedido_id, item.produto_id]);
                    }
                }
            }
            
            // Marcar NFe como com estoque baixado
            await connection.query(`
                UPDATE nfe
                SET estoque_baixado = 1, data_baixa_estoque = NOW()
                WHERE id = ?
            `, [nfe_id]);
            
            await connection.commit();
            
            return {
                success: true,
                mensagem: 'Estoque baixado com sucesso'
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Estornar estoque ao cancelar NFe
     */
    async estornarEstoque(nfe_id, usuario_id) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const [nfe] = await connection.query(`
                SELECT * FROM nfe WHERE id = ?
            `, [nfe_id]);
            
            if (nfe.length === 0) {
                throw new Error('NFe não encontrada');
            }
            
            const nfeData = nfe[0];
            
            // Verificar se estoque foi baixado
            if (!nfeData.estoque_baixado) {
                await connection.commit();
                return {
                    success: true,
                    mensagem: 'Estoque não havia sido baixado'
                };
            }
            
            const [itens] = await connection.query(`
                SELECT ni.*, p.controla_estoque
                FROM nfe_itens ni
                INNER JOIN produtos p ON ni.produto_id = p.id
                WHERE ni.nfe_id = ?
            `, [nfe_id]);
            
            for (const item of itens) {
                if (item.controla_estoque) {
                    // Registrar movimento de entrada (estorno)
                    await connection.query(`
                        INSERT INTO estoque_movimentos (
                            produto_id,
                            tipo_movimento,
                            quantidade,
                            valor_unitario,
                            documento_tipo,
                            documento_id,
                            observacoes,
                            usuario_id,
                            data_movimento,
                            created_at
                        ) VALUES (?, 'entrada', ?, ?, 'nfe_cancelamento', ?, ?, ?, NOW(), NOW())
                    `, [
                        item.produto_id,
                        item.quantidade,
                        item.valor_unitario,
                        nfe_id,
                        `Estorno por cancelamento NF-e ${nfeData.numero_nfe}`,
                        usuario_id
                    ]);
                    
                    // Devolver ao estoque
                    await connection.query(`
                        UPDATE estoque
                        SET quantidade_disponivel = quantidade_disponivel + ?
                        WHERE produto_id = ?
                    `, [item.quantidade, item.produto_id]);
                }
            }
            
            // Marcar NFe como estoque estornado
            await connection.query(`
                UPDATE nfe
                SET estoque_baixado = 0, data_estorno_estoque = NOW()
                WHERE id = ?
            `, [nfe_id]);
            
            await connection.commit();
            
            return {
                success: true,
                mensagem: 'Estoque estornado com sucesso'
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Integração com PCP - Verificar ordens de produção
     */
    async verificarOrdemProducao(pedido_id) {
        try {
            const [ordens] = await this.pool.query(`
                SELECT 
                    op.*,
                    COUNT(opi.id) as total_itens,
                    SUM(CASE WHEN opi.status = 'concluido' THEN 1 ELSE 0 END) as itens_concluidos
                FROM ordem_producao op
                LEFT JOIN ordem_producao_itens opi ON op.id = opi.ordem_producao_id
                WHERE op.pedido_id = ?
                GROUP BY op.id
            `, [pedido_id]);
            
            if (ordens.length === 0) {
                return {
                    tem_ordem: false,
                    mensagem: 'Pedido sem ordem de produção'
                };
            }
            
            const ordem = ordens[0];
            const produzido = ordem.total_itens === ordem.itens_concluidos;
            
            return {
                tem_ordem: true,
                ordem_id: ordem.id,
                status: ordem.status,
                produzido,
                percentual: (ordem.itens_concluidos / ordem.total_itens) * 100,
                mensagem: produzido ? 'Ordem de produção concluída' : 'Ordem de produção em andamento'
            };
            
        } catch (error) {
            throw new Error(`Erro ao verificar ordem de produção: ${error.message}`);
        }
    }
    
    /**
     * Bloquear edição de pedido faturado
     */
    async bloquearPedidoFaturado(pedido_id) {
        try {
            await this.pool.query(`
                UPDATE pedidos
                SET bloqueado_edicao = 1,
                    motivo_bloqueio = 'Pedido faturado - NFe emitida',
                    data_bloqueio = NOW()
                WHERE id = ?
            `, [pedido_id]);
            
            return {
                success: true,
                mensagem: 'Pedido bloqueado para edição'
            };
            
        } catch (error) {
            throw error;
        }
    }
    
    /**
     * Faturamento parcial - Validar
     */
    async validarFaturamentoParcial(pedido_id, itens_faturar) {
        try {
            // Buscar itens do pedido
            const [itensPedido] = await this.pool.query(`
                SELECT 
                    pi.*,
                    COALESCE(SUM(nfi.quantidade), 0) as quantidade_faturada
                FROM pedido_itens pi
                LEFT JOIN nfe n ON pi.pedido_id = n.pedido_id
                LEFT JOIN nfe_itens nfi ON n.id = nfi.nfe_id AND pi.produto_id = nfi.produto_id
                WHERE pi.pedido_id = ?
                GROUP BY pi.id
            `, [pedido_id]);
            
            const validacao = {
                valido: true,
                problemas: []
            };
            
            for (const itemFaturar of itens_faturar) {
                const itemPedido = itensPedido.find(i => i.produto_id === itemFaturar.produto_id);
                
                if (!itemPedido) {
                    validacao.valido = false;
                    validacao.problemas.push({
                        produto_id: itemFaturar.produto_id,
                        erro: 'Produto não encontrado no pedido'
                    });
                    continue;
                }
                
                const quantidadeRestante = parseFloat(itemPedido.quantidade) - parseFloat(itemPedido.quantidade_faturada);
                
                if (parseFloat(itemFaturar.quantidade) > quantidadeRestante) {
                    validacao.valido = false;
                    validacao.problemas.push({
                        produto_id: itemFaturar.produto_id,
                        quantidade_pedido: itemPedido.quantidade,
                        quantidade_faturada: itemPedido.quantidade_faturada,
                        quantidade_restante: quantidadeRestante,
                        quantidade_solicitada: itemFaturar.quantidade,
                        erro: 'Quantidade solicitada maior que a restante'
                    });
                }
            }
            
            return validacao;
            
        } catch (error) {
            throw error;
        }
    }
    
    /**
     * Rastreabilidade - Registrar lotes/séries
     */
    async registrarRastreabilidade(nfe_id, itensComLote) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            for (const item of itensComLote) {
                if (item.lotes && item.lotes.length > 0) {
                    for (const lote of item.lotes) {
                        await connection.query(`
                            INSERT INTO rastreabilidade (
                                nfe_id,
                                produto_id,
                                lote,
                                quantidade,
                                data_fabricacao,
                                data_validade,
                                created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, NOW())
                        `, [
                            nfe_id,
                            item.produto_id,
                            lote.numero_lote,
                            lote.quantidade,
                            lote.data_fabricacao,
                            lote.data_validade
                        ]);
                        
                        // Baixar do estoque por lote
                        await connection.query(`
                            UPDATE estoque_lotes
                            SET quantidade = quantidade - ?
                            WHERE produto_id = ? AND numero_lote = ?
                        `, [lote.quantidade, item.produto_id, lote.numero_lote]);
                    }
                }
            }
            
            await connection.commit();
            
            return {
                success: true,
                mensagem: 'Rastreabilidade registrada'
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Relatório de produtos mais faturados
     */
    async relatorioProdutosMaisFaturados(filtros = {}) {
        const { data_inicio, data_fim, limite = 20 } = filtros;
        
        let query = `
            SELECT 
                p.id as produto_id,
                p.codigo,
                p.descricao,
                SUM(ni.quantidade) as quantidade_total,
                COUNT(DISTINCT n.id) as total_nfes,
                SUM(ni.valor_total) as valor_total_faturado,
                AVG(ni.valor_unitario) as preco_medio
            FROM nfe_itens ni
            INNER JOIN nfe n ON ni.nfe_id = n.id
            INNER JOIN produtos p ON ni.produto_id = p.id
            WHERE n.status = 'autorizada'
        `;
        
        const params = [];
        
        if (data_inicio) {
            query += ' AND n.data_emissao >= ?';
            params.push(data_inicio);
        }
        
        if (data_fim) {
            query += ' AND n.data_emissao <= ?';
            params.push(data_fim);
        }
        
        query += ` GROUP BY p.id ORDER BY valor_total_faturado DESC LIMIT ?`;
        params.push(parseInt(limite));
        
        const [produtos] = await this.pool.query(query, params);
        
        return produtos;
    }
}

module.exports = VendasEstoqueIntegracaoService;
