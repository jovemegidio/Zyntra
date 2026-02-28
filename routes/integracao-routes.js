/**
 * INTEGRACAO ROUTES - Extracted from server.js (Lines 28955-29771)
 * Cross-module integration: estoque, vendas-financeiro, compras-financeiro
 * @module routes/integracao-routes
 */
const express = require('express');
let logger;
try { logger = require('../src/logger'); } catch(_) { logger = console; }

module.exports = function createIntegracaoRoutes(deps) {
    const { pool, authenticateToken, writeAuditLog } = deps;
    const router = express.Router();

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const path = require('path');
    const multer = require('multer');
    const fs = require('fs');
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };
    router.use(authenticateToken);
    router.use(authenticateToken);
    
    // ========== API DE RESERVA DE ESTOQUE ==========
    
    /**
     * Criar reserva de estoque para pedido de venda
     * Reserva produtos sem baixar estoque físico
     */
    router.post('/estoque/reservar', [
        body('pedido_id').isInt({ min: 1 }),
        body('itens').isArray({ min: 1 }),
        body('itens.*.codigo_material').trim().notEmpty(),
        body('itens.*.quantidade').isFloat({ min: 0.01 }),
        body('dias_expiracao').optional().isInt({ min: 1, max: 365 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id, itens, dias_expiracao = 7 } = req.body;
            const usuario_id = req.user.id;
    
            const reservasCriadas = [];
            const erros = [];
    
            for (const item of itens) {
                try {
                    // Verificar disponibilidade
                    const [estoque] = await connection.query(`
                        SELECT quantidade_fisica, quantidade_reservada, quantidade_disponivel
                        FROM estoque_saldos
                        WHERE codigo_material = ?
                    `, [item.codigo_material]);
    
                    if (estoque.length === 0) {
                        erros.push(`Material ${item.codigo_material} não encontrado no estoque`);
                        continue;
                    }
    
                    const disponivel = parseFloat(estoque[0].quantidade_disponivel);
                    if (disponivel < item.quantidade) {
                        erros.push(`Estoque insuficiente para ${item.codigo_material}. Disponível: ${disponivel}, Solicitado: ${item.quantidade}`);
                        continue;
                    }
    
                    // Criar reserva
                    const [reserva] = await connection.query(`
                        INSERT INTO estoque_reservas
                        (codigo_material, quantidade, tipo_origem, documento_id, documento_numero,
                         usuario_id, data_expiracao, status)
                        VALUES (?, ?, 'pedido_venda', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'ativa')
                    `, [
                        item.codigo_material,
                        item.quantidade,
                        pedido_id,
                        `PED-${pedido_id}`,
                        usuario_id,
                        dias_expiracao
                    ]);
    
                    reservasCriadas.push({
                        reserva_id: reserva.insertId,
                        codigo_material: item.codigo_material,
                        quantidade: item.quantidade,
                        disponivel_antes: disponivel,
                        disponivel_depois: disponivel - item.quantidade
                    });
    
                } catch (error) {
                    erros.push(`Erro ao reservar ${item.codigo_material}: ${error.message}`);
                }
            }
    
            if (erros.length > 0 && reservasCriadas.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Não foi possível criar nenhuma reserva',
                    erros
                });
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${reservasCriadas.length} reserva(s) criada(s)`,
                data: {
                    pedido_id,
                    reservas: reservasCriadas,
                    erros: erros.length > 0 ? erros : undefined
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao criar reserva:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    /**
     * Consumir reserva e baixar estoque físico
     * Usado quando pedido é aprovado e estoque deve ser baixado
     */
    router.post('/estoque/consumir-reserva', [
        body('pedido_id').isInt({ min: 1 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id } = req.body;
            const usuario_id = req.user.id;
    
            // Buscar todas as reservas ativas do pedido
            const [reservas] = await connection.query(`
                SELECT * FROM estoque_reservas
                WHERE tipo_origem = 'pedido_venda'
                AND documento_id = ?
                AND status = 'ativa'
            `, [pedido_id]);
    
            if (reservas.length === 0) {
                throw new Error('Nenhuma reserva ativa encontrada para este pedido');
            }
    
            const movimentacoes = [];
    
            for (const reserva of reservas) {
                // Buscar saldo atual
                const [estoque] = await connection.query(`
                    SELECT quantidade_fisica FROM estoque_saldos
                    WHERE codigo_material = ?
                `, [reserva.codigo_material]);
    
                if (estoque.length === 0) continue;
    
                const qtdAnterior = parseFloat(estoque[0].quantidade_fisica);
                const qtdAtual = qtdAnterior - reserva.quantidade;
    
                // Baixar estoque físico
                await connection.query(`
                    UPDATE estoque_saldos
                    SET quantidade_fisica = quantidade_fisica - ?,
                        ultima_saida = CURDATE()
                    WHERE codigo_material = ?
                `, [reserva.quantidade, reserva.codigo_material]);
    
                // Registrar movimentação
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                     quantidade_atual, documento_tipo, documento_id, documento_numero, usuario_id)
                    VALUES (?, 'saida', 'venda', ?, ?, ?, 'pedido_venda', ?, ?, ?)
                `, [
                    reserva.codigo_material,
                    reserva.quantidade,
                    qtdAnterior,
                    qtdAtual,
                    pedido_id,
                    reserva.documento_numero,
                    usuario_id
                ]);
    
                // Marcar reserva como consumida
                await connection.query(`
                    UPDATE estoque_reservas
                    SET status = 'consumida',
                        data_consumo = NOW()
                    WHERE id = ?
                `, [reserva.id]);
    
                movimentacoes.push({
                    codigo_material: reserva.codigo_material,
                    quantidade: reserva.quantidade,
                    quantidade_anterior: qtdAnterior,
                    quantidade_atual: qtdAtual
                });
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${movimentacoes.length} reserva(s) consumida(s) e estoque baixado`,
                data: {
                    pedido_id,
                    movimentacoes
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao consumir reserva:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    /**
     * Cancelar reserva de estoque
     */
    router.post('/estoque/cancelar-reserva', [
        body('pedido_id').isInt({ min: 1 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id } = req.body;
    
            // Marcar reservas como canceladas (trigger vai liberar automaticamente)
            const [result] = await connection.query(`
                UPDATE estoque_reservas
                SET status = 'cancelada'
                WHERE tipo_origem = 'pedido_venda'
                AND documento_id = ?
                AND status = 'ativa'
            `, [pedido_id]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${result.affectedRows} reserva(s) cancelada(s)`,
                data: { pedido_id, reservas_canceladas: result.affectedRows }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao cancelar reserva:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: VENDAS → ESTOQUE → FINANCEIRO ==========
    
    /**
     * Aprovar pedido de venda e realizar todas as integrações
     * 1. Baixa estoque (se produto acabado)
     * 2. Cria conta a receber no Financeiro
     * 3. Pode criar OP no PCP (se necessário)
     */
    router.post('/vendas/aprovar-pedido', [
        body('pedido_id').isInt({ min: 1 }),
        body('gerar_op').optional().isBoolean(),
        body('baixar_estoque').optional().isBoolean(),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id, gerar_op = false, baixar_estoque = true } = req.body;
            const usuario_id = req.user.id;
    
            // 1. Buscar dados do pedido
            const [pedidos] = await connection.query(`
                SELECT p.*, c.nome as cliente_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ?
            `, [pedido_id]);
    
            if (pedidos.length === 0) {
                throw new Error('Pedido não encontrado');
            }
    
            const pedido = pedidos[0];
    
            // 2. Buscar itens do pedido
            const [itens] = await connection.query(`
                SELECT pi.*, pr.codigo, pr.descricao
                FROM pedido_itens pi
                LEFT JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ?
            `, [pedido_id]);
    
            // 3. Baixar estoque (se solicitado)
            if (baixar_estoque) {
                for (const item of itens) {
                    // Verificar estoque disponível
                    const [estoqueCheck] = await connection.query(`
                        SELECT quantidade_fisica, quantidade_reservada
                        FROM estoque_saldos
                        WHERE codigo_material = ?
                    `, [item.codigo]);
    
                    if (estoqueCheck.length > 0) {
                        const estoque = estoqueCheck[0];
                        const disponivel = estoque.quantidade_fisica - estoque.quantidade_reservada;
    
                        if (disponivel < item.quantidade) {
                            throw new Error(`Estoque insuficiente para ${item.descricao}. Disponível: ${disponivel}, Necessário: ${item.quantidade}`);
                        }
    
                        // Registrar movimentação de saída
                        await connection.query(`
                            INSERT INTO estoque_movimentacoes
                            (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                             quantidade_atual, documento_tipo, documento_id, documento_numero,
                             usuario_id, data_movimento)
                            VALUES (?, 'saida', 'venda', ?, ?, ?, 'pedido_venda', ?, ?, ?, NOW())
                        `, [
                            item.codigo,
                            item.quantidade,
                            estoque.quantidade_fisica,
                            estoque.quantidade_fisica - item.quantidade,
                            pedido_id,
                            pedido.numero_pedido || `PED-${pedido_id}`,
                            usuario_id
                        ]);
    
                        // Atualizar saldo
                        await connection.query(`
                            UPDATE estoque_saldos
                            SET quantidade_fisica = quantidade_fisica - ?,
                                ultima_saida = CURDATE()
                            WHERE codigo_material = ?
                        `, [item.quantidade, item.codigo]);
                    }
                }
            }
    
            // 4. Criar conta a receber no Financeiro
            const valorTotal = pedido.valor_total || itens.reduce((sum, i) => sum + (i.quantidade * i.preco_unitario), 0);
    
            const [contaReceber] = await connection.query(`
                INSERT INTO contas_receber
                (cliente_id, valor, vencimento, categoria_id, forma_pagamento_id,
                 descricao, documento, venda_id, status, criado_por, data_criacao)
                VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL 30 DAY),
                        (SELECT id FROM categorias_financeiras WHERE tipo = 'receita' AND nome LIKE '%Venda%' LIMIT 1),
                        1, ?, ?, ?, 'pendente', ?, NOW())
            `, [
                pedido.cliente_id,
                valorTotal,
                `Venda ${pedido.numero_pedido || `PED-${pedido_id}`} - ${pedido.cliente_nome}`,
                pedido.numero_pedido || `PED-${pedido_id}`,
                pedido_id,
                usuario_id
            ]);
    
            // 5. Gerar OP se solicitado
            let op_id = null;
            if (gerar_op) {
                const [op] = await connection.query(`
                    INSERT INTO ordens_producao
                    (numero_op, pedido_id, descricao, quantidade, status, data_inicio_prevista, usuario_id)
                    VALUES (?, ?, ?, ?, 'planejada', DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?)
                `, [
                    `OP-${Date.now()}`,
                    pedido_id,
                    `Produção para ${pedido.numero_pedido}`,
                    itens.reduce((sum, i) => sum + i.quantidade, 0),
                    usuario_id
                ]);
                op_id = op.insertId;
            }
    
            // 6. Atualizar status do pedido
            await connection.query(`
                UPDATE pedidos
                SET status = 'aprovado',
                    data_aprovacao = NOW(),
                    aprovado_por = ?,
                    ordem_producao_id = ?
                WHERE id = ?
            `, [usuario_id, op_id, pedido_id]);
    
            // 7. Log de integração
            await connection.query(`
                INSERT INTO logs_integracao_financeiro
                (tipo_origem, origem_id, tipo_destino, destino_id, valor, usuario_id, status, observacoes)
                VALUES ('venda', ?, 'conta_receber', ?, ?, ?, 'sucesso', ?)
            `, [pedido_id, contaReceber.insertId, valorTotal, usuario_id, `Pedido aprovado e integrado`]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Pedido aprovado e integrado com sucesso',
                data: {
                    pedido_id,
                    conta_receber_id: contaReceber.insertId,
                    op_id,
                    estoque_baixado: baixar_estoque,
                    valor_total: valorTotal
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao aprovar pedido:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: COMPRAS → ESTOQUE → FINANCEIRO ==========
    
    /**
     * Receber pedido de compra e realizar integrações
     * 1. Cria conta a pagar no Financeiro
     * 2. Dá entrada no estoque
     */
    router.post('/compras/receber-pedido', [
        body('pedido_compra_id').isInt({ min: 1 }),
        body('numero_nf').optional().trim(),
        body('itens').isArray({ min: 1 }),
        body('itens.*.codigo_material').trim().notEmpty(),
        body('itens.*.quantidade_recebida').isFloat({ min: 0.01 }),
        body('itens.*.custo_unitario').optional().isFloat({ min: 0 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_compra_id, numero_nf, itens } = req.body;
            const usuario_id = req.user.id;
    
            // 1. Buscar dados do pedido de compra
            const [pedidos] = await connection.query(`
                SELECT pc.*, f.nome as fornecedor_nome
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                WHERE pc.id = ?
            `, [pedido_compra_id]);
    
            if (pedidos.length === 0) {
                throw new Error('Pedido de compra não encontrado');
            }
    
            const pedido = pedidos[0];
    
            // 2. Processar cada item recebido
            let valorTotal = 0;
    
            for (const item of itens) {
                const custo = item.custo_unitario || 0;
                valorTotal += item.quantidade_recebida * custo;
    
                // Verificar se material existe em estoque_saldos
                const [saldoCheck] = await connection.query(`
                    SELECT id, quantidade_fisica, custo_medio
                    FROM estoque_saldos
                    WHERE codigo_material = ?
                `, [item.codigo_material]);
    
                if (saldoCheck.length === 0) {
                    // Criar registro de saldo
                    await connection.query(`
                        INSERT INTO estoque_saldos
                        (codigo_material, quantidade_fisica, custo_medio, ultima_entrada)
                        VALUES (?, ?, ?, CURDATE())
                    `, [item.codigo_material, item.quantidade_recebida, custo]);
                } else {
                    const saldo = saldoCheck[0];
                    const qtdNova = saldo.quantidade_fisica + item.quantidade_recebida;
                    const custoMedioNovo = ((saldo.quantidade_fisica * saldo.custo_medio) +
                                            (item.quantidade_recebida * custo)) / qtdNova;
    
                    // Atualizar saldo
                    await connection.query(`
                        UPDATE estoque_saldos
                        SET quantidade_fisica = ?,
                            custo_medio = ?,
                            ultima_entrada = CURDATE()
                        WHERE codigo_material = ?
                    `, [qtdNova, custoMedioNovo, item.codigo_material]);
                }
    
                // Registrar movimentação de entrada
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                     quantidade_atual, documento_tipo, documento_id, documento_numero,
                     custo_unitario, usuario_id, data_movimento)
                    VALUES (?, 'entrada', 'compra', ?,
                            (SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?),
                            (SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?),
                            'pedido_compra', ?, ?, ?, ?, NOW())
                `, [
                    item.codigo_material,
                    item.quantidade_recebida,
                    item.codigo_material,
                    item.codigo_material,
                    pedido_compra_id,
                    numero_nf || `PC-${pedido_compra_id}`,
                    custo,
                    usuario_id
                ]);
            }
    
            // 3. Criar conta a pagar no Financeiro
            const [contaPagar] = await connection.query(`
                INSERT INTO contas_pagar
                (fornecedor_id, valor, vencimento, categoria_id, forma_pagamento_id,
                 descricao, documento, pedido_compra_id, status, criado_por, data_criacao)
                VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL 30 DAY),
                        (SELECT id FROM categorias_financeiras WHERE tipo = 'despesa' AND nome LIKE '%Compra%' LIMIT 1),
                        1, ?, ?, ?, 'pendente', ?, NOW())
            `, [
                pedido.fornecedor_id,
                valorTotal,
                `Compra ${numero_nf || `PC-${pedido_compra_id}`} - ${pedido.fornecedor_nome}`,
                numero_nf || `PC-${pedido_compra_id}`,
                pedido_compra_id,
                usuario_id
            ]);
    
            // 4. Atualizar status do pedido de compra
            await connection.query(`
                UPDATE pedidos_compra
                SET status = 'recebido', data_recebimento = NOW()
                WHERE id = ?
            `, [pedido_compra_id]);
    
            // 5. Log
            await connection.query(`
                INSERT INTO logs_integracao_financeiro
                (tipo_origem, origem_id, tipo_destino, destino_id, valor, usuario_id, status, observacoes)
                VALUES ('compra', ?, 'conta_pagar', ?, ?, ?, 'sucesso', ?)
            `, [pedido_compra_id, contaPagar.insertId, valorTotal, usuario_id, `Pedido recebido e integrado`]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Pedido de compra recebido e integrado',
                data: {
                    pedido_compra_id,
                    conta_pagar_id: contaPagar.insertId,
                    valor_total: valorTotal,
                    itens_recebidos: itens.length
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao receber pedido de compra:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: PCP → ESTOQUE (Consumo de OP) ==========
    
    /**
     * Consumir materiais de uma Ordem de Produção
     * Baixa estoque dos materiais usados na produção
     */
    router.post('/pcp/consumir-materiais', [
        body('op_id').isInt({ min: 1 }),
        body('materiais').isArray({ min: 1 }),
        body('materiais.*.codigo_material').trim().notEmpty(),
        body('materiais.*.quantidade_consumida').isFloat({ min: 0.01 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { op_id, materiais } = req.body;
            const usuario_id = req.user.id;
    
            // Verificar OP
            const [ops] = await connection.query('SELECT * FROM ordens_producao WHERE id = ?', [op_id]);
            if (ops.length === 0) throw new Error('OP não encontrada');
    
            const op = ops[0];
    
            // Processar cada material
            for (const material of materiais) {
                // Verificar estoque
                const [saldo] = await connection.query(`
                    SELECT quantidade_fisica, quantidade_reservada
                    FROM estoque_saldos
                    WHERE codigo_material = ?
                `, [material.codigo_material]);
    
                if (saldo.length === 0 || saldo[0].quantidade_fisica < material.quantidade_consumida) {
                    throw new Error(`Estoque insuficiente para ${material.codigo_material}`);
                }
    
                // Registrar saída
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                     quantidade_atual, documento_tipo, documento_id, documento_numero,
                     usuario_id, data_movimento)
                    VALUES (?, 'saida', 'producao', ?, ?, ?, 'ordem_producao', ?, ?, ?, NOW())
                `, [
                    material.codigo_material,
                    material.quantidade_consumida,
                    saldo[0].quantidade_fisica,
                    saldo[0].quantidade_fisica - material.quantidade_consumida,
                    op_id,
                    op.numero_op,
                    usuario_id
                ]);
    
                // Atualizar saldo
                await connection.query(`
                    UPDATE estoque_saldos
                    SET quantidade_fisica = quantidade_fisica - ?,
                        ultima_saida = CURDATE()
                    WHERE codigo_material = ?
                `, [material.quantidade_consumida, material.codigo_material]);
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Materiais consumidos com sucesso',
                data: { op_id, materiais_consumidos: materiais.length }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao consumir materiais:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: PCP → ESTOQUE (Produção Finalizada) ==========
    
    /**
     * Finalizar OP e dar entrada no produto acabado
     */
    router.post('/pcp/finalizar-op', [
        body('op_id').isInt({ min: 1 }),
        body('codigo_produto').trim().notEmpty(),
        body('quantidade_produzida').isFloat({ min: 0.01 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { op_id, codigo_produto, quantidade_produzida } = req.body;
            const usuario_id = req.user.id;
    
            const [ops] = await connection.query('SELECT * FROM ordens_producao WHERE id = ?', [op_id]);
            if (ops.length === 0) throw new Error('OP não encontrada');
    
            const op = ops[0];
    
            // Dar entrada no produto acabado
            await connection.query(`
                INSERT INTO estoque_movimentacoes
                (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                 quantidade_atual, documento_tipo, documento_id, documento_numero,
                 usuario_id, data_movimento)
                VALUES (?, 'entrada', 'producao', ?,
                        COALESCE((SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?), 0),
                        COALESCE((SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?), 0) + ?,
                        'ordem_producao', ?, ?, ?, NOW())
            `, [codigo_produto, quantidade_produzida, codigo_produto, codigo_produto,
                quantidade_produzida, op_id, op.numero_op, usuario_id]);
    
            // Atualizar ou criar saldo
            const [saldoCheck] = await connection.query(`
                SELECT id FROM estoque_saldos WHERE codigo_material = ?
            `, [codigo_produto]);
    
            if (saldoCheck.length === 0) {
                await connection.query(`
                    INSERT INTO estoque_saldos (codigo_material, quantidade_fisica, ultima_entrada)
                    VALUES (?, ?, CURDATE())
                `, [codigo_produto, quantidade_produzida]);
            } else {
                await connection.query(`
                    UPDATE estoque_saldos
                    SET quantidade_fisica = quantidade_fisica + ?,
                        ultima_entrada = CURDATE()
                    WHERE codigo_material = ?
                `, [quantidade_produzida, codigo_produto]);
            }
    
            // Atualizar status da OP
            await connection.query(`
                UPDATE ordens_producao
                SET status = 'finalizada', data_finalizacao = NOW()
                WHERE id = ?
            `, [op_id]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'OP finalizada e produto em estoque',
                data: { op_id, codigo_produto, quantidade_produzida }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao finalizar OP:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== RELATÓRIOS DE INTEGRAÇÃO ==========
    
    /**
     * Relatório de movimentações integradas
     */
    router.get('/relatorio/movimentacoes', async (req, res, next) => {
        try {
            const { data_inicio, data_fim, tipo } = req.query;
    
            let where = '1=1';
            const params = [];
    
            if (data_inicio) {
                where += ' AND DATE(data_movimento) >= ?';
                params.push(data_inicio);
            }
            if (data_fim) {
                where += ' AND DATE(data_movimento) <= ?';
                params.push(data_fim);
            }
            if (tipo) {
                where += ' AND tipo_movimento = ?';
                params.push(tipo);
            }
    
            const [movimentacoes] = await pool.query(`
                SELECT
                    em.*,
                    es.descricao,
                    u.nome as usuario_nome
                FROM estoque_movimentacoes em
                LEFT JOIN estoque_saldos es ON em.codigo_material = es.codigo_material
                LEFT JOIN usuarios u ON em.usuario_id = u.id
                WHERE ${where}
                ORDER BY em.data_movimento DESC
                LIMIT 100
            `, params);
    
            res.json({ success: true, data: movimentacoes });
    
        } catch (error) {
            logger.error('[INTEGRAÇÃO] Erro ao gerar relatório:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
    
    /**
     * Dashboard de integração
     */
    router.get('/dashboard', async (req, res, next) => {
        try {
            // KPIs
            const [pedidosAprovados] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos WHERE status = 'aprovado' AND DATE(data_aprovacao) = CURDATE()
            `);
    
            const [comprasRecebidas] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra WHERE status = 'recebido' AND DATE(data_recebimento) = CURDATE()
            `);
    
            const [opsFinalizadas] = await pool.query(`
                SELECT COUNT(*) as total FROM ordens_producao WHERE status = 'finalizada' AND DATE(data_finalizacao) = CURDATE()
            `);
    
            const [movimentacoesHoje] = await pool.query(`
                SELECT COUNT(*) as total FROM estoque_movimentacoes WHERE DATE(data_movimento) = CURDATE()
            `);
    
            const [estoqueTotal] = await pool.query(`
                SELECT SUM(valor_estoque) as total FROM estoque_saldos
            `);
    
            const [alertasCriticos] = await pool.query(`
                SELECT COUNT(*) as total
                FROM estoque_saldos es
                JOIN pcp_parametros_compra pp ON es.codigo_material = pp.codigo_material
                WHERE es.quantidade_disponivel < pp.estoque_minimo
            `);
    
            res.json({
                success: true,
                data: {
                    pedidos_aprovados_hoje: pedidosAprovados[0].total,
                    compras_recebidas_hoje: comprasRecebidas[0].total,
                    ops_finalizadas_hoje: opsFinalizadas[0].total,
                    movimentacoes_hoje: movimentacoesHoje[0].total,
                    valor_estoque_total: estoqueTotal[0].total || 0,
                    alertas_criticos: alertasCriticos[0].total
                }
            });
    
        } catch (error) {
            logger.error('[INTEGRAÇÃO] Erro ao carregar dashboard:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
    
    return router;
};
