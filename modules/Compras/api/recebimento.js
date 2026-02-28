const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ ESTATÍSTICAS DE RECEBIMENTO ============
router.get('/stats', async (req, res) => {
    try {
        const db = getDatabase();
        const hoje = new Date().toISOString().split('T')[0];
        
        // Pedidos pendentes de recebimento (aprovados ou enviados mas não recebidos)
        const [pendentes] = await db.execute(`
            SELECT COUNT(*) as total FROM pedidos_compra 
            WHERE status IN ('aprovado', 'enviado', 'pendente') 
            AND (data_recebimento IS NULL OR data_recebimento = '')
        `);
        
        // Pedidos atrasados (data_entrega_prevista < hoje e não recebidos)
        const [atrasados] = await db.execute(`
            SELECT COUNT(*) as total FROM pedidos_compra 
            WHERE status IN ('aprovado', 'enviado', 'pendente') 
            AND (data_recebimento IS NULL OR data_recebimento = '')
            AND data_entrega_prevista < ?
        `, [hoje]);
        
        // Recebidos hoje
        const [recebidosHoje] = await db.execute(`
            SELECT COUNT(*) as total FROM pedidos_compra 
            WHERE DATE(data_recebimento) = ?
        `, [hoje]);
        
        // Valor pendente
        const [valorPendente] = await db.execute(`
            SELECT COALESCE(SUM(valor_total), 0) as total FROM pedidos_compra 
            WHERE status IN ('aprovado', 'enviado', 'pendente') 
            AND (data_recebimento IS NULL OR data_recebimento = '')
        `);
        
        res.json({
            pendentes: pendentes[0].total || 0,
            atrasados: atrasados[0].total || 0,
            recebidos_hoje: recebidosHoje[0].total || 0,
            valor_pendente: valorPendente[0].total || 0
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de recebimento:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas', message: error.message });
    }
});

// ============ LISTAR PEDIDOS PARA RECEBIMENTO ============
router.get('/pedidos', async (req, res) => {
    try {
        const db = getDatabase();
        const { status = 'pendente', limit = 50, offset = 0, busca } = req.query;
        const hoje = new Date().toISOString().split('T')[0];
        
        let sql = `
            SELECT pc.*, f.razao_social as fornecedor_nome 
            FROM pedidos_compra pc 
            LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id 
            WHERE 1=1
        `;
        const params = [];
        
        // Filtrar por status
        if (status === 'pendente') {
            sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente') 
                     AND (pc.data_recebimento IS NULL OR pc.data_recebimento = '')`;
        } else if (status === 'atrasado') {
            sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente') 
                     AND (pc.data_recebimento IS NULL OR pc.data_recebimento = '')
                     AND pc.data_entrega_prevista < ?`;
            params.push(hoje);
        } else if (status === 'recebido') {
            sql += ` AND pc.status = 'recebido'`;
        } else if (status === 'parcial') {
            sql += ` AND pc.status = 'parcial'`;
        }
        // 'todos' não adiciona filtro
        
        // Busca por texto
        if (busca) {
            sql += ` AND (pc.id LIKE ? OR f.razao_social LIKE ? OR pc.numero_nfe LIKE ?)`;
            const buscaTerm = `%${busca}%`;
            params.push(buscaTerm, buscaTerm, buscaTerm);
        }
        
        sql += ` ORDER BY 
            CASE WHEN pc.data_entrega_prevista < '${hoje}' AND pc.status != 'recebido' THEN 0 ELSE 1 END,
            pc.data_entrega_prevista ASC, pc.data_pedido DESC
        `;
        
        // Count total
        const countSql = sql.replace('pc.*, f.razao_social as fornecedor_nome', 'COUNT(*) as total');
        const [countResult] = await db.execute(countSql, params);
        const total = countResult[0].total;
        
        // Adicionar paginação
        sql += ` LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const [pedidos] = await db.execute(sql, params);
        
        res.json({
            pedidos,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar pedidos para recebimento:', error);
        res.status(500).json({ error: 'Erro ao buscar pedidos', message: error.message });
    }
});

// ============ REGISTRAR RECEBIMENTO ============
router.post('/registrar', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            pedido_id,
            data_recebimento,
            numero_nfe,
            tipo_recebimento = 'total',
            responsavel,
            local_armazenamento,
            atualizar_estoque = true,
            observacoes,
            itens = []
        } = req.body;
        
        if (!pedido_id || !data_recebimento) {
            await connection.rollback();
            return res.status(400).json({ error: 'Pedido e data de recebimento são obrigatórios' });
        }
        
        // Verificar se pedido existe
        const [pedidos] = await connection.execute(
            'SELECT * FROM pedidos_compra WHERE id = ?',
            [pedido_id]
        );
        
        if (pedidos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        const pedido = pedidos[0];
        
        if (pedido.status === 'recebido') {
            await connection.rollback();
            return res.status(400).json({ error: 'Este pedido já foi totalmente recebido' });
        }
        
        // Determinar novo status
        const novoStatus = tipo_recebimento === 'parcial' ? 'parcial' : 'recebido';
        
        // Atualizar pedido
        await connection.execute(`
            UPDATE pedidos_compra SET 
                data_recebimento = ?,
                data_entrega_real = ?,
                numero_nfe = COALESCE(?, numero_nfe),
                status = ?,
                estoque_atualizado = ?,
                observacoes = CONCAT(COALESCE(observacoes, ''), '', ?)
            WHERE id = ?
        `, [
            data_recebimento,
            data_recebimento,
            numero_nfe,
            novoStatus,
            atualizar_estoque ? 1 : 0,
            `[${new Date().toLocaleString('pt-BR')}] Recebimento: ${observacoes || 'Sem observações'}`,
            pedido_id
        ]);
        
        // Registrar recebimento detalhado (se houver tabela)
        try {
            await connection.execute(`
                INSERT INTO recebimentos_compra (
                    pedido_id, data_recebimento, numero_nfe, tipo_recebimento,
                    responsavel, local_armazenamento, observacoes, usuario_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                pedido_id,
                data_recebimento,
                numero_nfe,
                tipo_recebimento,
                responsavel,
                local_armazenamento,
                observacoes,
                req.user ? req.user.id : null
            ]);
        } catch (e) {
            // Tabela pode não existir, continuar sem erro
            console.log('Tabela recebimentos_compra não existe, continuando...');
        }
        
        // Atualizar estoque se solicitado
        if (atualizar_estoque && itens.length > 0) {
            for (const item of itens) {
                if (item.material_id && item.quantidade_recebida > 0) {
                    // Verificar se existe registro de estoque para o material
                    const [estoqueExistente] = await connection.execute(
                        'SELECT id, quantidade_atual FROM estoque WHERE material_id = ?',
                        [item.material_id]
                    );
                    
                    if (estoqueExistente.length > 0) {
                        // Atualizar estoque existente
                        await connection.execute(`
                            UPDATE estoque SET 
                                quantidade_atual = quantidade_atual + ?,
                                data_ultima_entrada = ?
                            WHERE material_id = ?
                        `, [item.quantidade_recebida, data_recebimento, item.material_id]);
                    } else {
                        // Criar novo registro de estoque
                        await connection.execute(`
                            INSERT INTO estoque (material_id, quantidade_atual, data_ultima_entrada)
                            VALUES (?, ?, ?)
                        `, [item.material_id, item.quantidade_recebida, data_recebimento]);
                    }
                    
                    // Registrar movimentação
                    try {
                        await connection.execute(`
                            INSERT INTO movimentacoes_estoque (
                                material_id, tipo_movimentacao, quantidade, 
                                motivo, documento, data_movimentacao
                            ) VALUES (?, 'entrada', ?, 'Recebimento de compra', ?, ?)
                        `, [item.material_id, item.quantidade_recebida, `Pedido #${pedido_id}`, data_recebimento]);
                    } catch (e) {
                        console.log('Erro ao registrar movimentação:', e.message);
                    }
                }
            }
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: `Recebimento ${tipo_recebimento} registrado com sucesso`,
            pedido_id,
            novo_status: novoStatus
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao registrar recebimento:', error);
        res.status(500).json({ error: 'Erro ao registrar recebimento', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ HISTÓRICO DE RECEBIMENTOS ============
router.get('/historico', async (req, res) => {
    try {
        const db = getDatabase();
        const { data_inicio, data_fim, limit = 50, offset = 0 } = req.query;
        
        let sql = `
            SELECT pc.*, f.razao_social as fornecedor_nome 
            FROM pedidos_compra pc 
            LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id 
            WHERE pc.data_recebimento IS NOT NULL
        `;
        const params = [];
        
        if (data_inicio) {
            sql += ` AND pc.data_recebimento >= ?`;
            params.push(data_inicio);
        }
        
        if (data_fim) {
            sql += ` AND pc.data_recebimento <= ?`;
            params.push(data_fim);
        }
        
        sql += ` ORDER BY pc.data_recebimento DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const [recebimentos] = await db.execute(sql, params);
        
        res.json({ recebimentos });
    } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico', message: error.message });
    }
});

// ============ CANCELAR RECEBIMENTO ============
router.post('/:id/cancelar', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const pedidoId = req.params.id;
        const { motivo } = req.body;
        
        // Verificar se pedido existe e foi recebido
        const [pedidos] = await connection.execute(
            'SELECT * FROM pedidos_compra WHERE id = ?',
            [pedidoId]
        );
        
        if (pedidos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        const pedido = pedidos[0];
        
        if (!pedido.data_recebimento) {
            await connection.rollback();
            return res.status(400).json({ error: 'Este pedido não foi recebido ainda' });
        }
        
        // Se estoque foi atualizado, precisamos reverter
        if (pedido.estoque_atualizado) {
            // Buscar itens do pedido
            const [itens] = await connection.execute(
                'SELECT * FROM pedidos_compra_itens WHERE pedido_id = ?',
                [pedidoId]
            );
            
            for (const item of itens) {
                if (item.material_id) {
                    await connection.execute(`
                        UPDATE estoque SET 
                            quantidade_atual = quantidade_atual - ?
                        WHERE material_id = ?
                    `, [item.quantidade, item.material_id]);
                    
                    // Registrar movimentação de estorno
                    try {
                        await connection.execute(`
                            INSERT INTO movimentacoes_estoque (
                                material_id, tipo_movimentacao, quantidade, 
                                motivo, documento, data_movimentacao
                            ) VALUES (?, 'saida', ?, 'Cancelamento de recebimento', ?, NOW())
                        `, [item.material_id, item.quantidade, `Pedido #${pedidoId} - ${motivo || 'Cancelado'}`]);
                    } catch (e) {
                        console.log('Erro ao registrar movimentação de estorno:', e.message);
                    }
                }
            }
        }
        
        // Reverter status do pedido
        await connection.execute(`
            UPDATE pedidos_compra SET 
                data_recebimento = NULL,
                data_entrega_real = NULL,
                status = 'aprovado',
                estoque_atualizado = 0,
                observacoes = CONCAT(COALESCE(observacoes, ''), '', ?)
            WHERE id = ?
        `, [
            `[${new Date().toLocaleString('pt-BR')}] Recebimento cancelado: ${motivo || 'Sem motivo'}`,
            pedidoId
        ]);
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Recebimento cancelado com sucesso'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao cancelar recebimento:', error);
        res.status(500).json({ error: 'Erro ao cancelar recebimento', message: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;
