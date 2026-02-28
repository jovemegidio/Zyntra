/**
 * COMPRAS ROUTES (PART 1 - Professional) - Extracted from server.js (Lines 2815-3195)
 * Pedidos de compra, cota��es, requisi��es
 * @module routes/compras-routes
 */
const express = require('express');

module.exports = function createComprasRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, writeAuditLog } = deps;
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

    // Validation schemas
    const fornecedorValidation = [
        body('nome').isString().notEmpty().withMessage('Nome é obrigatório'),
        body('cnpj').isString().notEmpty().withMessage('CNPJ é obrigatório'),
        body('email').optional().isEmail().withMessage('Email inválido'),
        body('telefone').optional().isString(),
        body('endereco').optional().isString(),
        body('contato_principal').optional().isString(),
        body('ativo').optional().isBoolean(),
        validate
    ];
    const pedidoValidation = [
        body('fornecedor_id').isInt().withMessage('Fornecedor é obrigatório'),
        body('itens').isArray({ min: 1 }).withMessage('Itens são obrigatórios'),
        body('itens.*.descricao').isString().notEmpty().withMessage('Descrição do item é obrigatória'),
        body('itens.*.quantidade').isNumeric().withMessage('Quantidade do item deve ser numérica'),
        body('itens.*.preco_unitario').isNumeric().withMessage('Preço unitário deve ser numérico'),
        body('observacoes').optional().isString(),
        validate
    ];

    router.use(authenticateToken);
    router.use(authorizeArea('compras'));
    // ===================== ROTAS COMPRAS PROFISSIONAL =====================
    
    // 1. Dashboard de Compras
    router.get('/dashboard', async (req, res, next) => {
        try {
            // Estatísticas gerais de compras
            const [pedidosPendentes] = await pool.query(`
                SELECT COUNT(*) as total
                FROM pedidos_compras
                WHERE status = 'pendente'
            `);
    
            const [totalMesAtual] = await pool.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total
                FROM pedidos_compras
                WHERE MONTH(data_pedido) = MONTH(CURRENT_DATE())
                AND YEAR(data_pedido) = YEAR(CURRENT_DATE())
            `);
    
            const [fornecedoresAtivos] = await pool.query(`
                SELECT COUNT(*) as total
                FROM fornecedores
                WHERE ativo = true
            `);
    
            res.json({
                success: true,
                data: {
                    pedidos_pendentes: pedidosPendentes[0].total,
                    total_mes_atual: totalMesAtual[0].total,
                    fornecedores_ativos: fornecedoresAtivos[0].total,
                    periodo: new Date().toISOString().slice(0, 7)
                }
            });
        } catch (error) {
            next(error);
        }
    });
    
    // 2. Gestão de Fornecedores
    router.get('/fornecedores', async (req, res, next) => {
        try {
            const { page = 1, limit = 20, search = '', ativo } = req.query;
            const offset = (page - 1) * limit;
    
            let whereClause = 'WHERE 1=1';
            const params = [];
    
            if (search) {
                whereClause += ' AND (nome LIKE ? OR cnpj LIKE ? OR email LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
    
            if (ativo !== undefined) {
                whereClause += ' AND ativo = ?';
                params.push(ativo === 'true');
            }
    
            const [fornecedores] = await pool.query(`
                SELECT * FROM fornecedores
                ${whereClause}
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [...params, parseInt(limit), offset]);
    
            const [total] = await pool.query(`
                SELECT COUNT(*) as count FROM fornecedores ${whereClause}
            `, params);
    
            res.json({
                success: true,
                data: {
                    fornecedores,
                    pagination: {
                        current_page: parseInt(page),
                        total_pages: Math.ceil(total[0].count / limit),
                        total_records: total[0].count
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    });
    
    router.post('/fornecedores', fornecedorValidation, asyncHandler(async (req, res, next) => {
        try {
            const { nome, cnpj, email, telefone, endereco, contato_principal, ativo = true } = req.body;
    
            // Validação já feita pelo express-validator
    
            const [result] = await pool.query(`
                INSERT INTO fornecedores
                (nome, cnpj, email, telefone, endereco, contato_principal, ativo, data_cadastro)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            `, [nome, cnpj, email, telefone, endereco, contato_principal, ativo]);
    
            res.status(201).json({
                success: true,
                message: 'Fornecedor criado com sucesso',
                data: { id: result.insertId }
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({
                    success: false,
                    message: 'CNPJ já cadastrado'
                });
            }
            next(error);
        }
    }));
    
    // 3. Gestão de Pedidos de Compras
    router.get('/pedidos', async (req, res, next) => {
        try {
            const { page = 1, limit = 20, status, fornecedor_id, data_inicio, data_fim } = req.query;
            const offset = (page - 1) * limit;
    
            let whereClause = 'WHERE 1=1';
            const params = [];
    
            if (status) {
                whereClause += ' AND pc.status = ?';
                params.push(status);
            }
    
            if (fornecedor_id) {
                whereClause += ' AND pc.fornecedor_id = ?';
                params.push(fornecedor_id);
            }
    
            if (data_inicio && data_fim) {
                whereClause += ' AND pc.data_pedido BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }
    
            const [pedidos] = await pool.query(`
                SELECT
                    pc.*,
                    f.nome as fornecedor_nome,
                    f.cnpj as fornecedor_cnpj
                FROM pedidos_compras pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                ${whereClause}
                ORDER BY pc.data_pedido DESC
                LIMIT ? OFFSET ?
            `, [...params, parseInt(limit), offset]);
    
            res.json({
                success: true,
                data: { pedidos }
            });
        } catch (error) {
            next(error);
        }
    });
    
    router.post('/pedidos', pedidoValidation, asyncHandler(async (req, res, next) => {
        try {
            const { fornecedor_id, itens, observacoes } = req.body;
    
            // Validação já feita pelo express-validator
    
            // Calcular valor total
            const valor_total = itens.reduce((total, item) => {
                return total + (item.quantidade * item.preco_unitario);
            }, 0);
    
            // Iniciar transação
            const connection = await pool.getConnection();
            await connection.beginTransaction();
    
            try {
                // Inserir pedido
                const [pedidoResult] = await connection.query(`
                    INSERT INTO pedidos_compras
                    (fornecedor_id, valor_total, status, data_pedido, observacoes, usuario_id)
                    VALUES (?, ?, 'pendente', NOW(), ?, ?)
                `, [fornecedor_id, valor_total, observacoes, req.user.id]);
    
                const pedido_id = pedidoResult.insertId;
    
                // Inserir itens do pedido
                for (const item of itens) {
                    await connection.query(`
                        INSERT INTO itens_pedido_compras
                        (pedido_id, produto_descricao, quantidade, preco_unitario, subtotal)
                        VALUES (?, ?, ?, ?, ?)
                    `, [pedido_id, item.descricao, item.quantidade, item.preco_unitario, item.quantidade * item.preco_unitario]);
                }
    
                await connection.commit();
    
                res.status(201).json({
                    success: true,
                    message: 'Pedido de compra criado com sucesso',
                    data: { id: pedido_id }
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            next(error);
        }
    }));
    
    // 4. Relatórios de Compras
    router.get('/relatorios/gastos-periodo', async (req, res, next) => {
        try {
            const { data_inicio, data_fim, fornecedor_id } = req.query;
    
            let whereClause = 'WHERE pc.status = "aprovado"';
            const params = [];
    
            if (data_inicio && data_fim) {
                whereClause += ' AND pc.data_pedido BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }
    
            if (fornecedor_id) {
                whereClause += ' AND pc.fornecedor_id = ?';
                params.push(fornecedor_id);
            }
    
            const [gastos] = await pool.query(`
                SELECT
                    f.nome as fornecedor,
                    COUNT(pc.id) as total_pedidos,
                    SUM(pc.valor_total) as total_gasto,
                    AVG(pc.valor_total) as ticket_medio
                FROM pedidos_compras pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                ${whereClause}
                GROUP BY pc.fornecedor_id, f.nome
                ORDER BY total_gasto DESC
            `, params);
    
            res.json({
                success: true,
                data: { gastos }
            });
        } catch (error) {
            next(error);
        }
    });
    
    // ===================== ROTAS DE RECEBIMENTO =====================
    
    // Estatísticas de Recebimento
    router.get('/recebimento/stats', async (req, res, next) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];
    
            // Pedidos pendentes de recebimento (aprovados ou enviados mas não recebidos)
            const [pendentes] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
            `);
    
            // Pedidos atrasados (data_entrega_prevista < hoje e não recebidos)
            const [atrasados] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
                AND data_entrega_prevista < ?
            `, [hoje]);
    
            // Recebidos hoje
            const [recebidosHoje] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE DATE(data_recebimento) = ?
            `, [hoje]);
    
            // Valor pendente
            const [valorPendente] = await pool.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
            `);
    
            res.json({
                pendentes: pendentes[0].total || 0,
                atrasados: atrasados[0].total || 0,
                recebidos_hoje: recebidosHoje[0].total || 0,
                valor_pendente: valorPendente[0].total || 0
            });
        } catch (error) {
            console.error('Erro ao buscar estatísticas de recebimento:', error);
            next(error);
        }
    });
    
    // Listar Pedidos para Recebimento
    router.get('/recebimento/pedidos', async (req, res, next) => {
        try {
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
                         AND pc.data_recebimento IS NULL`;
            } else if (status === 'atrasado') {
                sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL
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
            const [countResult] = await pool.query(countSql, params);
            const total = countResult[0].total;
    
            // Adicionar paginação
            sql += ` LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));
    
            const [pedidos] = await pool.query(sql, params);
    
            res.json({
                pedidos,
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('Erro ao listar pedidos para recebimento:', error);
            next(error);
        }
    });
    
    // Centros de Custo (acessível para quem tem permissão de compras)
    router.get('/centros-custo', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT id, nome FROM centros_custo WHERE ativo = 1 ORDER BY nome');
            res.json(rows);
        } catch (error) {
            // Fallback caso a tabela não exista
            res.json([{ id: 1, nome: 'Vendas' }, { id: 2, nome: 'Marketing' }, { id: 3, nome: 'Produção' }, { id: 4, nome: 'Administrativo' }]);
        }
    });
    
    return router;
};
