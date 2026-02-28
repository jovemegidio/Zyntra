/**
 * COMPRAS EXTENDED ROUTES - Extracted from server.js (Lines 22797-24849)
 * Fornecedores CRUD, cotacoes, requisicoes avancadas
 * @module routes/compras-extended
 */
const express = require('express');
const multer = require('multer');
const path = require('path');

module.exports = function createComprasExtendedRoutes(deps) {
    const { pool, authenticateToken, authenticatePage, authorizeArea, writeAuditLog, cacheMiddleware, CACHE_CONFIG } = deps;
    const router = express.Router();
    let userPermissions;
    try { userPermissions = require('../src/permissions-server'); } catch(_) { userPermissions = { isAdmin: () => false }; }

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const fs = require('fs');
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };
    // ============================================================
    // ROTAS DO MÓDULO DE COMPRAS
    // ============================================================

    // ===== FORNECEDORES =====

    // Listar todos os fornecedores
    router.get('/fornecedores', authenticateToken, async (req, res) => {
        try {
            const { ativo, search, page = 1, limit = 100 } = req.query;
            const limitNum = Math.min(Math.max(1, parseInt(limit) || 100), 500);
            const offset = (Math.max(1, parseInt(page) || 1) - 1) * limitNum;
            let query = 'SELECT id, razao_social, nome_fantasia, cnpj, ie, endereco, cidade, estado, cep, telefone, email, contato_principal, condicoes_pagamento, prazo_entrega_padrao, ativo, observacoes, created_at FROM fornecedores';
            const params = [];
            let conditions = [];

            if (ativo !== undefined) {
                conditions.push('ativo = ?');
                params.push(ativo);
            }

            if (search) {
                conditions.push('(razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?)');
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
            query += ' ORDER BY razao_social ASC LIMIT ? OFFSET ?';
            params.push(limitNum, offset);

            const [fornecedores] = await pool.query(query, params);
            res.json(fornecedores);
        } catch (err) {
            console.error('[COMPRAS] Erro ao listar fornecedores:', err);
            res.status(500).json({ message: 'Erro ao listar fornecedores' });
        }
    });

    // Buscar fornecedor por ID
    router.get('/fornecedores/:id', authenticateToken, async (req, res) => {
        try {
            const [fornecedor] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [req.params.id]);
            if (fornecedor.length === 0) {
                return res.status(404).json({ message: 'Fornecedor não encontrado' });
            }
            res.json(fornecedor[0]);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar fornecedor:', err);
            res.status(500).json({ message: 'Erro ao buscar fornecedor' });
        }
    });

    // Criar novo fornecedor
    router.post('/fornecedores', authenticateToken, async (req, res) => {
        try {
            const {
                razao_social, nome_fantasia, cnpj, ie, endereco, cidade,
                estado, cep, telefone, email, contato_principal,
                condicoes_pagamento, prazo_entrega_padrao, observacoes
            } = req.body;

            if (!razao_social || !cnpj) {
                return res.status(400).json({ message: 'Razão social e CNPJ são obrigatórios' });
            }

            const [result] = await pool.query(
                `INSERT INTO fornecedores (
                    razao_social, nome_fantasia, cnpj, ie, endereco, cidade, estado, cep,
                    telefone, email, contato_principal, condicoes_pagamento,
                    prazo_entrega_padrao, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    razao_social, nome_fantasia, cnpj, ie, endereco, cidade, estado, cep,
                    telefone, email, contato_principal, condicoes_pagamento,
                    prazo_entrega_padrao, observacoes
                ]
            );

            res.status(201).json({
                success: true,
                message: 'Fornecedor criado com sucesso',
                id: result.insertId
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao criar fornecedor:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: 'CNPJ já cadastrado' });
            }
            res.status(500).json({ message: 'Erro ao criar fornecedor' });
        }
    });

    // Atualizar fornecedor
    router.put('/fornecedores/:id', authenticateToken, async (req, res) => {
        try {
            const {
                razao_social, nome_fantasia, cnpj, ie, endereco, cidade,
                estado, cep, telefone, email, contato_principal,
                condicoes_pagamento, prazo_entrega_padrao, observacoes, ativo
            } = req.body;

            await pool.query(
                `UPDATE fornecedores SET
                    razao_social = ?, nome_fantasia = ?, cnpj = ?, ie = ?, endereco = ?,
                    cidade = ?, estado = ?, cep = ?, telefone = ?, email = ?,
                    contato_principal = ?, condicoes_pagamento = ?,
                    prazo_entrega_padrao = ?, observacoes = ?, ativo = ?
                WHERE id = ?`,
                [
                    razao_social, nome_fantasia, cnpj, ie, endereco, cidade,
                    estado, cep, telefone, email, contato_principal,
                    condicoes_pagamento, prazo_entrega_padrao, observacoes,
                    ativo, req.params.id
                ]
            );

            res.json({ success: true, message: 'Fornecedor atualizado com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao atualizar fornecedor:', err);
            res.status(500).json({ message: 'Erro ao atualizar fornecedor' });
        }
    });

    // Desativar fornecedor
    router.delete('/fornecedores/:id', authenticateToken, async (req, res) => {
        try {
            await pool.query('UPDATE fornecedores SET ativo = 0 WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Fornecedor desativado com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao desativar fornecedor:', err);
            res.status(500).json({ message: 'Erro ao desativar fornecedor' });
        }
    });

    // ===== MATERIAIS DE COMPRAS =====

    // Listar todos os materiais
    router.get('/materiais', authenticateToken, async (req, res) => {
        try {
            const { categoria, ativo, busca, status } = req.query;
            let query = `
                SELECT m.*, f.razao_social as fornecedor_nome
                FROM compras_materiais m
                LEFT JOIN fornecedores f ON m.fornecedor_id = f.id
                WHERE 1=1
            `;
            const params = [];

            if (ativo !== undefined) {
                query += ' AND m.ativo = ?';
                params.push(ativo);
            }

            if (categoria && categoria !== 'todos') {
                query += ' AND m.categoria = ?';
                params.push(categoria);
            }

            if (busca) {
                query += ' AND (m.codigo LIKE ? OR m.descricao LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`);
            }

            // Filtro por status de estoque
            if (status === 'disponivel') {
                query += ' AND m.estoque_atual > m.estoque_min';
            } else if (status === 'baixo') {
                query += ' AND m.estoque_atual <= m.estoque_min AND m.estoque_atual > 0';
            } else if (status === 'critico') {
                query += ' AND m.estoque_atual = 0';
            }

            query += ' ORDER BY m.descricao ASC';

            const [materiais] = await pool.query(query, params);

            // Calcular status de cada material
            const materiaisComStatus = materiais.map(m => ({
                ...m,
                status: m.estoque_atual === 0 ? 'critico' :
                        m.estoque_atual <= m.estoque_min ? 'baixo' : 'disponivel'
            }));

            res.json(materiaisComStatus);
        } catch (err) {
            console.error('[COMPRAS] Erro ao listar materiais:', err);
            res.status(500).json({ message: 'Erro ao listar materiais' });
        }
    });

    // Estatísticas dos materiais
    router.get('/materiais/estatisticas', authenticateToken, async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN estoque_atual > estoque_min THEN 1 ELSE 0 END) as disponiveis,
                    SUM(CASE WHEN estoque_atual <= estoque_min AND estoque_atual > 0 THEN 1 ELSE 0 END) as estoque_baixo,
                    SUM(CASE WHEN estoque_atual = 0 THEN 1 ELSE 0 END) as criticos
                FROM compras_materiais WHERE ativo = 1
            `);
            res.json(stats[0]);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar estatísticas:', err);
            res.status(500).json({ message: 'Erro ao buscar estatísticas' });
        }
    });

    // Buscar material por ID
    router.get('/materiais/:id', authenticateToken, async (req, res) => {
        try {
            const [material] = await pool.query(`
                SELECT m.*, f.razao_social as fornecedor_nome
                FROM compras_materiais m
                LEFT JOIN fornecedores f ON m.fornecedor_id = f.id
                WHERE m.id = ?
            `, [req.params.id]);

            if (material.length === 0) {
                return res.status(404).json({ message: 'Material não encontrado' });
            }
            res.json(material[0]);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar material:', err);
            res.status(500).json({ message: 'Erro ao buscar material' });
        }
    });

    // Criar novo material
    router.post('/materiais', authenticateToken, async (req, res) => {
        try {
            const {
                codigo, descricao, categoria, unidade, especificacoes, ncm, cest,
                codigo_barras, estoque_min, estoque_max, estoque_atual, lead_time,
                fornecedor_id, ultimo_preco, sinc_pcp, observacoes
            } = req.body;

            if (!codigo || !descricao) {
                return res.status(400).json({ message: 'Código e descrição são obrigatórios' });
            }

            const [result] = await pool.query(
                `INSERT INTO compras_materiais (
                    codigo, descricao, categoria, unidade, especificacoes, ncm, cest,
                    codigo_barras, estoque_min, estoque_max, estoque_atual, lead_time,
                    fornecedor_id, ultimo_preco, sinc_pcp, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    codigo, descricao, categoria || 'Geral', unidade || 'UN', especificacoes,
                    ncm, cest, codigo_barras, estoque_min || 0, estoque_max || 0,
                    estoque_atual || 0, lead_time || 0, fornecedor_id, ultimo_preco || 0,
                    sinc_pcp || 0, observacoes
                ]
            );

            res.status(201).json({
                success: true,
                message: 'Material cadastrado com sucesso',
                id: result.insertId
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao criar material:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: 'Código do material já existe' });
            }
            res.status(500).json({ message: 'Erro ao criar material' });
        }
    });

    // Atualizar material
    router.put('/materiais/:id', authenticateToken, async (req, res) => {
        try {
            const {
                codigo, descricao, categoria, unidade, especificacoes, ncm, cest,
                codigo_barras, estoque_min, estoque_max, estoque_atual, lead_time,
                fornecedor_id, ultimo_preco, ativo, sinc_pcp, observacoes
            } = req.body;

            await pool.query(
                `UPDATE compras_materiais SET
                    codigo = ?, descricao = ?, categoria = ?, unidade = ?, especificacoes = ?,
                    ncm = ?, cest = ?, codigo_barras = ?, estoque_min = ?, estoque_max = ?,
                    estoque_atual = ?, lead_time = ?, fornecedor_id = ?, ultimo_preco = ?,
                    ativo = ?, sinc_pcp = ?, observacoes = ?
                WHERE id = ?`,
                [
                    codigo, descricao, categoria, unidade, especificacoes, ncm, cest,
                    codigo_barras, estoque_min, estoque_max, estoque_atual, lead_time,
                    fornecedor_id, ultimo_preco, ativo, sinc_pcp, observacoes, req.params.id
                ]
            );

            res.json({ success: true, message: 'Material atualizado com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao atualizar material:', err);
            res.status(500).json({ message: 'Erro ao atualizar material' });
        }
    });

    // Desativar material
    router.delete('/materiais/:id', authenticateToken, async (req, res) => {
        try {
            await pool.query('UPDATE compras_materiais SET ativo = 0 WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Material desativado com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao desativar material:', err);
            res.status(500).json({ message: 'Erro ao desativar material' });
        }
    });

    // Categorias de materiais
    router.get('/materiais-categorias', authenticateToken, async (req, res) => {
        try {
            const [categorias] = await pool.query(
                'SELECT DISTINCT categoria FROM compras_materiais WHERE ativo = 1 ORDER BY categoria'
            );
            res.json(categorias.map(c => c.categoria));
        } catch (err) {
            console.error('[COMPRAS] Erro ao listar categorias:', err);
            res.status(500).json({ message: 'Erro ao listar categorias' });
        }
    });

    // ===== ESTOQUE DE MATÉRIAS-PRIMAS =====

    // Materiais com entrada (para Gestão de Estoque MP)
    router.get('/estoque/materiais-com-entrada', authenticateToken, async (req, res) => {
        try {
            const { search, status } = req.query;

            // Tentar buscar na tabela estoque_materias_primas
            let materiais = [];
            let sql = '';
            const params = [];

            try {
                sql = `
                    SELECT DISTINCT
                        mp.id,
                        mp.codigo,
                        mp.descricao,
                        mp.unidade_medida as unidade,
                        mp.quantidade_minima as estoque_min,
                        mp.quantidade_minima as estoque_max,
                        COALESCE(mp.quantidade_atual, 0) as estoque_atual,
                        mp.localizacao,
                        mp.tipo,
                        mp.updated_at,
                        CASE
                            WHEN COALESCE(mp.quantidade_atual, 0) = 0 THEN 'critico'
                            WHEN COALESCE(mp.quantidade_atual, 0) < mp.quantidade_minima THEN 'baixo'
                            ELSE 'adequado'
                        END as status
                    FROM estoque_materias_primas mp
                    WHERE EXISTS (
                        SELECT 1 FROM movimentacao_materias_primas me
                        WHERE me.material_id = mp.id
                        AND me.tipo_movimentacao = 'ENTRADA'
                    )
                `;

                if (search) {
                    sql += ' AND (mp.codigo LIKE ? OR mp.descricao LIKE ?)';
                    const searchParam = `%${search}%`;
                    params.push(searchParam, searchParam);
                }

                if (status === 'critico') {
                    sql += ' AND COALESCE(mp.quantidade_atual, 0) = 0';
                } else if (status === 'baixo') {
                    sql += ' AND COALESCE(mp.quantidade_atual, 0) > 0 AND COALESCE(mp.quantidade_atual, 0) < mp.quantidade_minima';
                } else if (status === 'adequado') {
                    sql += ' AND COALESCE(mp.quantidade_atual, 0) >= mp.quantidade_minima';
                }

                sql += ' ORDER BY mp.descricao';

                const [rows] = await pool.query(sql, params);
                materiais = rows;
            } catch (e) {
                console.log('[COMPRAS] Tabela estoque_materias_primas não encontrada, tentando materias_primas...');

                // Fallback para tabela materias_primas
                try {
                    sql = `
                        SELECT DISTINCT
                            mp.id,
                            mp.codigo,
                            mp.descricao,
                            mp.unidade_medida as unidade,
                            mp.quantidade_minima as estoque_min,
                            mp.quantidade_minima as estoque_max,
                            COALESCE(mp.quantidade_atual, 0) as estoque_atual,
                            mp.localizacao,
                            mp.tipo,
                            mp.updated_at,
                            CASE
                                WHEN COALESCE(mp.quantidade_atual, 0) = 0 THEN 'critico'
                                WHEN COALESCE(mp.quantidade_atual, 0) < mp.quantidade_minima THEN 'baixo'
                                ELSE 'adequado'
                            END as status
                        FROM materias_primas mp
                        WHERE EXISTS (
                            SELECT 1 FROM movimentacao_materias_primas me
                            WHERE me.material_id = mp.id
                            AND me.tipo_movimentacao = 'ENTRADA'
                        )
                    `;

                    if (search) {
                        sql += ' AND (mp.codigo LIKE ? OR mp.descricao LIKE ?)';
                    }

                    sql += ' ORDER BY mp.descricao';

                    const [rows2] = await pool.query(sql, params);
                    materiais = rows2;
                } catch (e2) {
                    console.log('[COMPRAS] Tabela materias_primas não encontrada, tentando compras_materiais...');

                    // Fallback final para compras_materiais
                    // Retorna lista vazia - sem tabela de movimentação, não há entradas registradas
                    sql = `
                        SELECT
                            id,
                            codigo,
                            descricao,
                            unidade,
                            estoque_min,
                            estoque_max,
                            COALESCE(estoque_atual, 0) as estoque_atual,
                            '' as localizacao,
                            categoria as tipo,
                            updated_at,
                            CASE
                                WHEN COALESCE(estoque_atual, 0) = 0 THEN 'critico'
                                WHEN COALESCE(estoque_atual, 0) < estoque_min THEN 'baixo'
                                ELSE 'adequado'
                            END as status
                        FROM compras_materiais
                        WHERE ativo = 1 AND COALESCE(estoque_atual, 0) > 0
                    `;

                    if (search) {
                        sql += ' AND (codigo LIKE ? OR descricao LIKE ?)';
                    }

                    sql += ' ORDER BY descricao';

                    const [rows3] = await pool.query(sql, params);
                    materiais = rows3;
                }
            }

            // Calcular estatísticas
            const stats = {
                total: materiais.length,
                adequado: materiais.filter(m => m.status === 'adequado').length,
                baixo: materiais.filter(m => m.status === 'baixo').length,
                critico: materiais.filter(m => m.status === 'critico').length
            };

            res.json({ materiais, stats });
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar materiais com entrada:', err);
            res.status(500).json({ message: 'Erro ao buscar materiais', error: err.message });
        }
    });

    // Movimentações de estoque
    router.get('/estoque/movimentacoes', authenticateToken, async (req, res) => {
        try {
            const { material_id, tipo, limit = 50 } = req.query;
            let sql = `
                SELECT m.*, mp.descricao as material_descricao, mp.codigo as material_codigo
                FROM movimentacao_materias_primas m
                LEFT JOIN materias_primas mp ON m.material_id = mp.id
                WHERE 1=1
            `;
            const params = [];
            if (material_id) { sql += ' AND m.material_id = ?'; params.push(material_id); }
            if (tipo) { sql += ' AND m.tipo_movimentacao = ?'; params.push(tipo); }
            sql += ' ORDER BY m.created_at DESC LIMIT ?';
            params.push(parseInt(limit));
            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar movimentações:', err);
            // Fallback: tentar tabela alternativa
            try {
                const [rows] = await pool.query('SELECT * FROM movimentacao_materias_primas ORDER BY created_at DESC LIMIT 50');
                res.json(rows);
            } catch (e2) {
                res.json([]);
            }
        }
    });

    // Entrada de estoque
    router.post('/estoque/entrada', authenticateToken, async (req, res) => {
        try {
            const { material_id, quantidade, observacao, documento, fornecedor_id } = req.body;
            if (!material_id || !quantidade) {
                return res.status(400).json({ message: 'Material e quantidade são obrigatórios' });
            }
            // Registrar movimentação
            await pool.query(
                `INSERT INTO movimentacao_materias_primas (material_id, tipo_movimentacao, quantidade, observacao, documento, usuario_id, created_at)
                 VALUES (?, 'ENTRADA', ?, ?, ?, ?, NOW())`,
                [material_id, quantidade, observacao || '', documento || '', req.user?.id || null]
            );
            // Atualizar estoque atual
            await pool.query(
                'UPDATE materias_primas SET quantidade_atual = COALESCE(quantidade_atual, 0) + ? WHERE id = ?',
                [quantidade, material_id]
            );
            res.json({ success: true, message: 'Entrada registrada com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao registrar entrada:', err);
            res.status(500).json({ message: 'Erro ao registrar entrada de estoque' });
        }
    });

    // Saída de estoque
    router.post('/estoque/saida', authenticateToken, async (req, res) => {
        try {
            const { material_id, quantidade, observacao, documento, destino } = req.body;
            if (!material_id || !quantidade) {
                return res.status(400).json({ message: 'Material e quantidade são obrigatórios' });
            }
            // Verificar estoque disponível
            const [mat] = await pool.query('SELECT quantidade_atual FROM materias_primas WHERE id = ?', [material_id]);
            if (!mat.length || (mat[0].quantidade_atual || 0) < quantidade) {
                return res.status(400).json({ message: 'Estoque insuficiente' });
            }
            // Registrar movimentação
            await pool.query(
                `INSERT INTO movimentacao_materias_primas (material_id, tipo_movimentacao, quantidade, observacao, documento, usuario_id, created_at)
                 VALUES (?, 'SAIDA', ?, ?, ?, ?, NOW())`,
                [material_id, quantidade, observacao || '', documento || '', req.user?.id || null]
            );
            // Atualizar estoque atual
            await pool.query(
                'UPDATE materias_primas SET quantidade_atual = COALESCE(quantidade_atual, 0) - ? WHERE id = ?',
                [quantidade, material_id]
            );
            res.json({ success: true, message: 'Saída registrada com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao registrar saída:', err);
            res.status(500).json({ message: 'Erro ao registrar saída de estoque' });
        }
    });

    // Ajuste de estoque
    router.post('/estoque/ajuste', authenticateToken, async (req, res) => {
        try {
            const { material_id, quantidade_nova, motivo } = req.body;
            if (!material_id || quantidade_nova === undefined) {
                return res.status(400).json({ message: 'Material e quantidade são obrigatórios' });
            }
            // Buscar quantidade atual
            const [mat] = await pool.query('SELECT quantidade_atual FROM materias_primas WHERE id = ?', [material_id]);
            const qtdAtual = mat.length ? (mat[0].quantidade_atual || 0) : 0;
            const diferenca = quantidade_nova - qtdAtual;
            // Registrar movimentação
            await pool.query(
                `INSERT INTO movimentacao_materias_primas (material_id, tipo_movimentacao, quantidade, observacao, usuario_id, created_at)
                 VALUES (?, 'AJUSTE', ?, ?, ?, NOW())`,
                [material_id, Math.abs(diferenca), motivo || `Ajuste: ${qtdAtual} → ${quantidade_nova}`, req.user?.id || null]
            );
            // Atualizar estoque
            await pool.query(
                'UPDATE materias_primas SET quantidade_atual = ? WHERE id = ?',
                [quantidade_nova, material_id]
            );
            res.json({ success: true, message: 'Ajuste registrado com sucesso', diferenca });
        } catch (err) {
            console.error('[COMPRAS] Erro ao ajustar estoque:', err);
            res.status(500).json({ message: 'Erro ao ajustar estoque' });
        }
    });

    // ===== PEDIDOS DE COMPRA =====

    // Listar todos os pedidos
    router.get('/pedidos', authenticateToken, async (req, res) => {
        try {
            const { status, fornecedor_id, data_inicio, data_fim } = req.query;
            let query = `
                SELECT p.*, f.razao_social as fornecedor_nome
                FROM pedidos_compra p
                LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
                WHERE 1=1
            `;
            const params = [];

            if (status) {
                query += ' AND p.status = ?';
                params.push(status);
            }
            if (fornecedor_id) {
                query += ' AND p.fornecedor_id = ?';
                params.push(fornecedor_id);
            }
            if (data_inicio) {
                query += ' AND p.data_pedido >= ?';
                params.push(data_inicio);
            }
            if (data_fim) {
                query += ' AND p.data_pedido <= ?';
                params.push(data_fim);
            }

            query += ' ORDER BY p.created_at DESC';

            const [pedidos] = await pool.query(query, params);
            res.json(pedidos);
        } catch (err) {
            console.error('[COMPRAS] Erro ao listar pedidos:', err);
            res.status(500).json({ message: 'Erro ao listar pedidos' });
        }
    });

    // Buscar pedido por ID com itens
    router.get('/pedidos/:id', authenticateToken, async (req, res) => {
        try {
            const [pedido] = await pool.query(`
                SELECT p.*, f.razao_social as fornecedor_nome
                FROM pedidos_compra p
                LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
                WHERE p.id = ?
            `, [req.params.id]);

            if (pedido.length === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }

            const [itens] = await pool.query('SELECT * FROM itens_pedido WHERE pedido_id = ?', [req.params.id]);

            const [historico] = await pool.query(
                'SELECT * FROM historico_aprovacoes WHERE pedido_id = ? ORDER BY data_acao DESC',
                [req.params.id]
            );

            res.json({
                ...pedido[0],
                itens,
                historico
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar pedido:', err);
            res.status(500).json({ message: 'Erro ao buscar pedido' });
        }
    });

    // Criar novo pedido de compra
    router.post('/pedidos', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const {
                numero_pedido, fornecedor_id, data_pedido, data_entrega_prevista,
                observacoes, itens
            } = req.body;

            if (!numero_pedido || !fornecedor_id || !itens || itens.length === 0) {
                await connection.rollback();
                return res.status(400).json({ message: 'Dados obrigatórios faltando' });
            }

            // AUDITORIA ENTERPRISE: Validar fornecedor_id
            const fornecedorIdParsed = parseInt(fornecedor_id, 10);
            if (!Number.isInteger(fornecedorIdParsed) || fornecedorIdParsed <= 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'ID de fornecedor inválido' });
            }

            // AUDITORIA ENTERPRISE: Verificar se fornecedor existe e está ativo
            const [fornecedorCheck] = await connection.query(
                'SELECT id, razao_social, ativo FROM fornecedores WHERE id = ?',
                [fornecedorIdParsed]
            );

            if (fornecedorCheck.length === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Fornecedor não encontrado' });
            }

            if (fornecedorCheck[0].ativo === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Fornecedor inativo não pode receber pedidos' });
            }

            // AUDITORIA ENTERPRISE: Validar e sanitizar todos os itens
            for (let i = 0; i < itens.length; i++) {
                const item = itens[i];

                // Validar quantidade
                const qtd = parseFloat(item.quantidade);
                if (isNaN(qtd) || qtd <= 0 || qtd > 999999999) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `Quantidade inválida no item ${i + 1}`,
                        item_descricao: item.descricao || `Item ${i + 1}`
                    });
                }

                // Validar preço unitário
                const preco = parseFloat(item.preco_unitario);
                if (isNaN(preco) || preco < 0 || preco > 999999999.99) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `Preço unitário inválido no item ${i + 1}`,
                        item_descricao: item.descricao || `Item ${i + 1}`
                    });
                }

                // Sanitizar valores
                itens[i].quantidade = Math.round(qtd * 1000) / 1000; // 3 casas decimais
                itens[i].preco_unitario = Math.round(preco * 100) / 100; // 2 casas decimais
                itens[i].preco_total = Math.round(itens[i].quantidade * itens[i].preco_unitario * 100) / 100;
            }

            // Calcular valor total sanitizado
            const valor_total = itens.reduce((sum, item) => sum + (item.preco_total || 0), 0);
            const valor_total_sanitizado = Math.round(valor_total * 100) / 100;

            // AUDITORIA ENTERPRISE: Validar valor total
            if (valor_total_sanitizado <= 0 || valor_total_sanitizado > 999999999.99) {
                await connection.rollback();
                return res.status(400).json({ error: 'Valor total do pedido inválido' });
            }

            console.log(`[COMPRAS-AUDIT] Novo pedido criado por usuário ${req.user.id} - Fornecedor: ${fornecedorCheck[0].razao_social} - Valor: R$ ${valor_total_sanitizado.toFixed(2)} - Itens: ${itens.length}`);

            // Inserir pedido
            const [result] = await connection.query(
                `INSERT INTO pedidos_compra (
                    numero_pedido, fornecedor_id, data_pedido, data_entrega_prevista,
                    valor_total, valor_final, observacoes, usuario_solicitante_id, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`,
                [numero_pedido, fornecedorIdParsed, data_pedido, data_entrega_prevista,
                 valor_total_sanitizado, valor_total_sanitizado, observacoes, req.user.id]
            );

            const pedido_id = result.insertId;

            // Inserir itens
            for (const item of itens) {
                await connection.query(
                    `INSERT INTO itens_pedido (
                        pedido_id, codigo_produto, descricao, quantidade, unidade,
                        preco_unitario, preco_total, observacoes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        pedido_id, item.codigo_produto, item.descricao, item.quantidade,
                        item.unidade || 'UN', item.preco_unitario, item.preco_total,
                        item.observacoes
                    ]
                );

                // Registrar no histórico de preços
                await connection.query(
                    `INSERT INTO historico_precos (
                        fornecedor_id, codigo_produto, descricao, preco_unitario,
                        quantidade, pedido_id, data_compra
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        fornecedor_id, item.codigo_produto, item.descricao,
                        item.preco_unitario, item.quantidade, pedido_id, data_pedido
                    ]
                );
            }

            // Registrar no histórico de aprovações
            await connection.query(
                `INSERT INTO historico_aprovacoes (pedido_id, usuario_id, acao, observacoes)
                 VALUES (?, ?, 'solicitado', 'Pedido criado')`,
                [pedido_id, req.user.id]
            );

            await connection.commit();
            res.status(201).json({
                success: true,
                message: 'Pedido criado com sucesso',
                id: pedido_id
            });
        } catch (err) {
            await connection.rollback();
            console.error('[COMPRAS] Erro ao criar pedido:', err);
            res.status(500).json({ message: 'Erro ao criar pedido' });
        } finally {
            connection.release();
        }
    });

    // Aprovar pedido
    router.post('/pedidos/:id/aprovar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const { observacoes, prazo_pagamento = 30, categoria_financeira_id, forma_pagamento, parcelas = 1 } = req.body;

            // AUDITORIA ENTERPRISE: Validar ID do pedido
            const pedidoId = parseInt(req.params.id, 10);
            if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'ID de pedido inválido' });
            }

            // AUDITORIA ENTERPRISE: Buscar pedido e valor para verificar limite de aprovação
            const [pedidoCheck] = await connection.query(
                'SELECT id, valor_total, valor_final, status, fornecedor_id FROM pedidos_compra WHERE id = ?',
                [pedidoId]
            );

            if (pedidoCheck.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }

            const pedidoInfo = pedidoCheck[0];

            // AUDITORIA ENTERPRISE: Verificar se já foi aprovado
            if (pedidoInfo.status === 'aprovado') {
                await connection.rollback();
                return res.status(400).json({ error: 'Este pedido já foi aprovado' });
            }

            // AUDITORIA ENTERPRISE: Verificar se está pendente para aprovação
            if (pedidoInfo.status !== 'pendente') {
                await connection.rollback();
                return res.status(400).json({ error: 'Apenas pedidos pendentes podem ser aprovados' });
            }

            // AUDITORIA ENTERPRISE: RBAC - Limites de aprovação por papel
            const valorPedido = parseFloat(pedidoInfo.valor_final || pedidoInfo.valor_total) || 0;
            const userRole = req.user.role || req.user.papel || 'usuario';
            const isAdmin = req.user.is_admin === true || ['admin', 'administrador'].includes(userRole);

            // Definir limites de aprovação por papel
            const limitesAprovacao = {
                'comprador': 5000,           // Até R$ 5.000
                'compras': 5000,             // Até R$ 5.000
                'supervisor_compras': 25000, // Até R$ 25.000
                'gerente_compras': 100000,   // Até R$ 100.000
                'gerente': 100000,           // Até R$ 100.000
                'diretor': 500000,           // Até R$ 500.000
                'admin': Infinity,           // Sem limite
                'administrador': Infinity    // Sem limite
            };

            const limiteUsuario = limitesAprovacao[userRole] || 5000; // Default: R$ 5.000

            if (!isAdmin && valorPedido > limiteUsuario) {
                await connection.rollback();
                console.log(`[COMPRAS-RBAC] Usuário ${req.user.id} (${userRole}) tentou aprovar pedido ${pedidoId} de R$ ${valorPedido.toFixed(2)} acima do limite de R$ ${limiteUsuario.toFixed(2)}`);
                return res.status(403).json({
                    error: 'Você não tem permissão para aprovar este valor',
                    seu_limite: limiteUsuario,
                    valor_pedido: valorPedido,
                    mensagem: `Seu limite de aprovação é R$ ${limiteUsuario.toLocaleString('pt-BR', {minimumFractionDigits: 2})}. Solicite aprovação de um gerente ou diretor.`
                });
            }

            // AUDITORIA ENTERPRISE: Registrar log de aprovação com valor e aprovador
            console.log(`[COMPRAS-AUDIT] Pedido ${pedidoId} aprovado por usuário ${req.user.id} (${req.user.nome || req.user.email}) - Valor: R$ ${valorPedido.toFixed(2)} - Limite do aprovador: R$ ${limiteUsuario === Infinity ? 'Ilimitado' : limiteUsuario.toFixed(2)}`);

            // Atualizar pedido
            await connection.query(
                `UPDATE pedidos_compra SET
                    status = 'aprovado',
                    usuario_aprovador_id = ?,
                    data_aprovacao = NOW()
                WHERE id = ?`,
                [req.user.id, req.params.id]
            );

            await connection.query(
                `INSERT INTO historico_aprovacoes (pedido_id, usuario_id, acao, observacoes)
                 VALUES (?, ?, 'aprovado', ?)`,
                [req.params.id, req.user.id, observacoes]
            );

            // === INTEGRAÇÃO FINANCEIRO ===
            // Buscar dados do pedido para criar conta a pagar
            const [pedidoData] = await connection.query(`
                SELECT p.*, f.razao_social as fornecedor_nome, f.cnpj, f.email
                FROM pedidos_compra p
                LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
                WHERE p.id = ?
            `, [req.params.id]);

            if (pedidoData.length > 0) {
                const pedido = pedidoData[0];
                const dataVencimento = new Date();
                dataVencimento.setDate(dataVencimento.getDate() + prazo_pagamento);

                // Determinar categoria automaticamente se não fornecida
                let categoriaId = categoria_financeira_id;
                if (!categoriaId) {
                    const [catResult] = await connection.query(
                        `SELECT id FROM categorias_financeiras WHERE nome LIKE '%Compra%' AND tipo = 'despesa' LIMIT 1`
                    );
                    if (catResult.length > 0) {
                        categoriaId = catResult[0].id;
                    }
                }

                // Criar conta a pagar
                const descricaoCompleta = `Pedido de Compra #${pedido.numero_pedido || pedido.id} - ${pedido.fornecedor_nome || 'Fornecedor'}${observacoes ? ` - ${observacoes}` : ''}`;

                const [contaResult] = await connection.query(
                    `INSERT INTO contas_pagar (
                        descricao, fornecedor, valor_original, valor_restante,
                        data_vencimento, data_emissao, categoria_id, forma_pagamento,
                        status, numero_documento, observacoes, pedido_compra_id,
                        criado_por, criado_em
                    ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, 'pendente', ?, ?, ?, ?, NOW())`,
                    [
                        descricaoCompleta,
                        pedido.fornecedor_nome || `Fornecedor ID ${pedido.fornecedor_id}`,
                        pedido.valor_final || pedido.valor_total,
                        pedido.valor_final || pedido.valor_total,
                        dataVencimento.toISOString().split('T')[0],
                        categoriaId,
                        forma_pagamento || 'boleto',
                        pedido.numero_pedido || `PC-${pedido.id}`,
                        observacoes,
                        pedido.id,
                        req.user.id
                    ]
                );

                const contaId = contaResult.insertId;

                // Se houver parcelamento, gerar parcelas
                if (parcelas > 1) {
                    const valorParcela = (pedido.valor_final || pedido.valor_total) / parcelas;

                    for (let i = 1; i <= parcelas; i++) {
                        const dataVencParcela = new Date();
                        dataVencParcela.setDate(dataVencParcela.getDate() + (prazo_pagamento * i));

                        await connection.query(
                            `INSERT INTO parcelas_financeiras (
                                conta_pagar_id, numero_parcela, valor_parcela,
                                data_vencimento, status, criado_em
                            ) VALUES (?, ?, ?, ?, 'pendente', NOW())`,
                            [contaId, i, valorParcela, dataVencParcela.toISOString().split('T')[0]]
                        );
                    }

                    // Atualizar conta para indicar parcelamento
                    await connection.query(
                        `UPDATE contas_pagar SET observacoes = CONCAT(COALESCE(observacoes, ''), ' [Parcelado em ${parcelas}x]') WHERE id = ?`,
                        [contaId]
                    );
                }

                console.log(`[INTEGRAÇÃO] Conta a pagar #${contaId} criada automaticamente para Pedido de Compra #${pedido.id}`);
            }

            await connection.commit();
            res.json({
                success: true,
                message: 'Pedido aprovado e conta a pagar criada com sucesso',
                financeiro_integrado: true
            });
        } catch (err) {
            await connection.rollback();
            console.error('[COMPRAS] Erro ao aprovar pedido:', err);
            res.status(500).json({ message: 'Erro ao aprovar pedido: ' + err.message });
        } finally {
            connection.release();
        }
    });

    // Cancelar pedido
    router.post('/pedidos/:id/cancelar', authenticateToken, async (req, res) => {
        try {
            const { motivo } = req.body;

            // AUDITORIA ENTERPRISE: Validar ID do pedido
            const pedidoId = parseInt(req.params.id, 10);
            if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
                return res.status(400).json({ error: 'ID de pedido inválido' });
            }

            // AUDITORIA ENTERPRISE: Verificar se motivo foi fornecido
            if (!motivo || motivo.trim().length < 5) {
                return res.status(400).json({ error: 'Motivo do cancelamento é obrigatório (mínimo 5 caracteres)' });
            }

            // AUDITORIA ENTERPRISE: Verificar se pedido existe e pode ser cancelado
            const [pedidoCheck] = await pool.query(
                'SELECT id, status, valor_total FROM pedidos_compra WHERE id = ?',
                [pedidoId]
            );

            if (pedidoCheck.length === 0) {
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }

            const pedidoInfo = pedidoCheck[0];

            // AUDITORIA ENTERPRISE: Impedir cancelamento de pedidos já recebidos ou cancelados
            if (pedidoInfo.status === 'recebido') {
                return res.status(400).json({ error: 'Pedidos já recebidos não podem ser cancelados' });
            }

            if (pedidoInfo.status === 'cancelado') {
                return res.status(400).json({ error: 'Este pedido já está cancelado' });
            }

            // AUDITORIA ENTERPRISE: RBAC - Verificar permissão para cancelar pedidos aprovados
            const userRole = req.user.role || req.user.papel || 'usuario';
            const isAdmin = req.user.is_admin === true || ['admin', 'administrador', 'diretor'].includes(userRole);

            if (pedidoInfo.status === 'aprovado' && !isAdmin) {
                const rolesComPermissaoCancelar = ['gerente', 'gerente_compras', 'supervisor_compras'];
                if (!rolesComPermissaoCancelar.includes(userRole)) {
                    console.log(`[COMPRAS-RBAC] Usuário ${req.user.id} (${userRole}) tentou cancelar pedido aprovado ${pedidoId} sem permissão`);
                    return res.status(403).json({
                        error: 'Você não tem permissão para cancelar pedidos aprovados',
                        mensagem: 'Apenas gerentes ou administradores podem cancelar pedidos aprovados'
                    });
                }
            }

            console.log(`[COMPRAS-AUDIT] Pedido ${pedidoId} CANCELADO por usuário ${req.user.id} (${req.user.nome || req.user.email}) - Motivo: ${motivo} - Valor: R$ ${(pedidoInfo.valor_total || 0).toFixed(2)}`);

            await pool.query(
                'UPDATE pedidos_compra SET status = \'cancelado\', motivo_cancelamento = ? WHERE id = ?',
                [motivo.trim(), pedidoId]
            );

            await pool.query(
                `INSERT INTO historico_aprovacoes (pedido_id, usuario_id, acao, observacoes)
                 VALUES (?, ?, 'rejeitado', ?)`,
                [pedidoId, req.user.id, motivo.trim()]
            );

            res.json({ success: true, message: 'Pedido cancelado com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao cancelar pedido:', err);
            res.status(500).json({ message: 'Erro ao cancelar pedido' });
        }
    });

    // Receber pedido (total ou parcial) — CORRIGIDO: aceita formato completo do frontend
    router.post('/pedidos/:id/receber', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const pedidoId = req.params.id;
            const {
                data_recebimento,
                numero_nfe,
                tipo = 'total',
                chave_acesso,
                responsavel,
                local_armazenamento,
                atualizar_estoque = true,
                observacoes,
                itens = [],
                dados_sefaz,
                // Compatibilidade com formato antigo
                itens_recebidos,
                data_entrega_real
            } = req.body;

            // Verificar se pedido existe
            const [pedidos] = await connection.query(
                'SELECT pc.*, f.razao_social as fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE pc.id = ?',
                [pedidoId]
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

            // ====== FORMATO NOVO (recebimento.html) ======
            if (data_recebimento || numero_nfe) {
                const novoStatus = tipo === 'parcial' ? 'parcial' : 'recebido';

                await connection.query(`
                    UPDATE pedidos_compra SET 
                        data_recebimento = COALESCE(?, data_recebimento),
                        data_entrega_real = COALESCE(?, data_entrega_real),
                        numero_nfe = COALESCE(?, numero_nfe),
                        chave_acesso_nfe = COALESCE(?, chave_acesso_nfe),
                        status = ?,
                        estoque_atualizado = ?,
                        observacoes = CONCAT(COALESCE(observacoes, ''), '\n', ?)
                    WHERE id = ?
                `, [
                    data_recebimento,
                    data_recebimento || data_entrega_real,
                    numero_nfe,
                    chave_acesso || null,
                    novoStatus,
                    atualizar_estoque ? 1 : 0,
                    `[${new Date().toLocaleString('pt-BR')}] Recebimento ${tipo} por ${responsavel || req.user.nome || 'Sistema'}: NF-e ${numero_nfe || 'N/A'}. ${observacoes || ''}`,
                    pedidoId
                ]);

                // Registrar recebimento detalhado
                try {
                    await connection.query(`
                        INSERT INTO recebimentos_compra (
                            pedido_id, data_recebimento, numero_nfe, chave_acesso,
                            tipo_recebimento, responsavel, local_armazenamento,
                            observacoes, usuario_id, dados_sefaz_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        pedidoId, data_recebimento, numero_nfe, chave_acesso || null,
                        tipo, responsavel, local_armazenamento,
                        observacoes, req.user?.id || null,
                        dados_sefaz ? JSON.stringify(dados_sefaz) : null
                    ]);
                } catch (e) {
                    console.log('[COMPRAS] Tabela recebimentos_compra não existe, continuando...');
                }

                // Atualizar estoque com itens recebidos
                if (atualizar_estoque && itens.length > 0) {
                    // Buscar itens do pedido para obter material_id
                    const [itensPedido] = await connection.query(
                        'SELECT * FROM pedidos_compra_itens WHERE pedido_id = ?',
                        [pedidoId]
                    );

                    for (let i = 0; i < itens.length; i++) {
                        const qtdRecebida = parseFloat(itens[i].quantidade_recebida) || 0;
                        if (qtdRecebida <= 0) continue;

                        const materialId = itensPedido[i]?.material_id;
                        if (!materialId) continue;

                        // Verificar se existe registro de estoque
                        const [estoqueExistente] = await connection.query(
                            'SELECT id, quantidade_atual FROM estoque WHERE material_id = ?',
                            [materialId]
                        );

                        if (estoqueExistente.length > 0) {
                            await connection.query(
                                'UPDATE estoque SET quantidade_atual = quantidade_atual + ?, data_ultima_entrada = ? WHERE material_id = ?',
                                [qtdRecebida, data_recebimento, materialId]
                            );
                        } else {
                            await connection.query(
                                'INSERT INTO estoque (material_id, quantidade_atual, data_ultima_entrada) VALUES (?, ?, ?)',
                                [materialId, qtdRecebida, data_recebimento]
                            );
                        }

                        // Registrar movimentação
                        try {
                            await connection.query(`
                                INSERT INTO movimentacoes_estoque (
                                    material_id, tipo_movimentacao, quantidade,
                                    motivo, documento, data_movimentacao
                                ) VALUES (?, 'entrada', ?, 'Recebimento de compra', ?, ?)
                            `, [materialId, qtdRecebida, `Pedido #${pedidoId} NF-e ${numero_nfe || ''}`, data_recebimento]);
                        } catch (e) { /* tabela pode não existir */ }
                    }
                }

                // Se tem chave de acesso NF-e, registrar na tabela nf_entrada
                if (chave_acesso && chave_acesso.length === 44) {
                    try {
                        const [existe] = await connection.query(
                            'SELECT id FROM nf_entrada WHERE chave_acesso = ?', [chave_acesso]
                        );
                        if (existe.length === 0) {
                            await connection.query(`
                                INSERT INTO nf_entrada (
                                    chave_acesso, numero_nfe, fornecedor_razao_social,
                                    valor_total, data_entrada, status, importado_por
                                ) VALUES (?, ?, ?, ?, ?, 'importada', ?)
                            `, [
                                chave_acesso, numero_nfe, pedido.fornecedor_nome,
                                pedido.valor_total, data_recebimento, req.user?.id
                            ]);
                        }
                    } catch (e) {
                        console.log('[COMPRAS] Erro ao registrar NF entrada:', e.message);
                    }
                }

                await connection.commit();
                return res.json({
                    success: true,
                    message: `Recebimento ${tipo} registrado com sucesso`,
                    pedido_id: pedidoId,
                    novo_status: novoStatus
                });
            }

            // ====== FORMATO ANTIGO (compatibilidade) ======
            if (itens_recebidos) {
                for (const item of itens_recebidos) {
                    await connection.query(
                        'UPDATE itens_pedido SET quantidade_recebida = quantidade_recebida + ? WHERE id = ?',
                        [item.quantidade_recebida, item.id]
                    );
                }

                const [itensCheck] = await connection.query(
                    'SELECT * FROM itens_pedido WHERE pedido_id = ?',
                    [pedidoId]
                );

                const todosRecebidos = itensCheck.every(item =>
                    parseFloat(item.quantidade_recebida) >= parseFloat(item.quantidade)
                );

                const novoStatus = todosRecebidos ? 'recebido' : 'parcial';

                await connection.query(
                    'UPDATE pedidos_compra SET status = ?, data_entrega_real = ? WHERE id = ?',
                    [novoStatus, data_entrega_real, pedidoId]
                );

                await connection.commit();
                return res.json({
                    success: true,
                    message: todosRecebidos ? 'Pedido recebido completamente' : 'Recebimento parcial registrado'
                });
            }

            await connection.rollback();
            res.status(400).json({ error: 'Dados de recebimento não fornecidos' });
        } catch (err) {
            await connection.rollback();
            console.error('[COMPRAS] Erro ao receber pedido:', err);
            res.status(500).json({ message: 'Erro ao registrar recebimento' });
        } finally {
            connection.release();
        }
    });

    // ===================== NF-e ENTRADA - Importação XML =====================

    // Importar XML NF-e como texto (colar no textarea)
    router.post('/nf-entrada/importar-xml-texto', authenticateToken, async (req, res) => {
        try {
            const { xml } = req.body;
            if (!xml || !xml.trim()) {
                return res.status(400).json({ error: 'Conteúdo XML é obrigatório' });
            }

            const resultado = await processarXMLEntradaCompras(pool, xml, req.user?.id);
            res.json(resultado);
        } catch (error) {
            console.error('[COMPRAS] Erro ao importar XML:', error);
            res.status(500).json({ error: 'Erro ao importar XML: ' + error.message });
        }
    });

    // Listar NFs de entrada importadas
    router.get('/nf-entrada', authenticateToken, async (req, res) => {
        try {
            const { status, fornecedor, pagina = 1, limite = 50 } = req.query;
            let query = `
                SELECT id, chave_acesso, numero_nfe, serie,
                    fornecedor_cnpj, fornecedor_razao_social, fornecedor_uf,
                    valor_total, valor_icms, valor_ipi, valor_pis, valor_cofins,
                    data_emissao, data_entrada, status, natureza_operacao
                FROM nf_entrada WHERE 1=1
            `;
            const params = [];

            if (status) { query += ' AND status = ?'; params.push(status); }
            if (fornecedor) {
                query += ' AND (fornecedor_cnpj LIKE ? OR fornecedor_razao_social LIKE ?)';
                params.push(`%${fornecedor}%`, `%${fornecedor}%`);
            }

            const countQuery = query.replace(/SELECT .+ FROM/, 'SELECT COUNT(*) as total FROM');
            const [countRows] = await pool.query(countQuery, params);

            query += ' ORDER BY data_emissao DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limite), (parseInt(pagina) - 1) * parseInt(limite));
            const [rows] = await pool.query(query, params);

            res.json({ total: countRows[0]?.total || 0, notas: rows });
        } catch (error) {
            console.error('[COMPRAS] Erro ao listar NF entrada:', error);
            res.status(500).json({ error: 'Erro ao listar notas' });
        }
    });

    // Consultar NF-e por chave de acesso (simula SEFAZ — busca no banco local)
    router.get('/nfe/consultar/:chave', authenticateToken, async (req, res) => {
        try {
            const chave = req.params.chave.replace(/\D/g, '');
            if (chave.length !== 44) {
                return res.status(400).json({ error: 'Chave de acesso deve ter 44 dígitos' });
            }

            // Buscar na tabela nf_entrada
            const [nfs] = await pool.query(
                'SELECT * FROM nf_entrada WHERE chave_acesso = ?', [chave]
            );

            if (nfs.length > 0) {
                const nf = nfs[0];
                return res.json({
                    encontrada: true,
                    numero: nf.numero_nfe,
                    serie: nf.serie,
                    data_emissao: nf.data_emissao,
                    emitente: {
                        razao_social: nf.fornecedor_razao_social,
                        cnpj: nf.fornecedor_cnpj
                    },
                    valor_total: nf.valor_total,
                    status: nf.status
                });
            }

            // Decodificar informações da chave de acesso (padrão 44 dígitos)
            const info = {
                uf: chave.substring(0, 2),
                aamm: chave.substring(2, 6),
                cnpj: chave.substring(6, 20),
                modelo: chave.substring(20, 22),
                serie: parseInt(chave.substring(22, 25)),
                numero: parseInt(chave.substring(25, 34)),
                forma_emissao: chave.substring(34, 35),
                codigo_numerico: chave.substring(35, 43),
                dv: chave.substring(43, 44)
            };

            // Buscar fornecedor pelo CNPJ extraído da chave
            const [fornecedores] = await pool.query(
                'SELECT razao_social, nome_fantasia, cnpj FROM fornecedores WHERE cnpj = ?',
                [info.cnpj]
            );

            res.json({
                encontrada: false,
                decodificada: true,
                numero: info.numero,
                serie: info.serie,
                data_emissao: `20${info.aamm.substring(0, 2)}-${info.aamm.substring(2, 4)}-01`,
                emitente: fornecedores.length > 0 ? {
                    razao_social: fornecedores[0].razao_social,
                    cnpj: fornecedores[0].cnpj
                } : { cnpj: info.cnpj, razao_social: 'Fornecedor não cadastrado' },
                valor_total: null,
                message: 'NF-e não encontrada no banco local. Dados decodificados da chave de acesso.'
            });
        } catch (error) {
            console.error('[COMPRAS] Erro ao consultar NF-e:', error);
            res.status(500).json({ error: 'Erro ao consultar NF-e' });
        }
    });

    // ===== DASHBOARD =====

    // Estatísticas do dashboard
    router.get('/dashboard', authenticateToken, async (req, res) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];
            const mesAtual = hoje.substring(0, 7);

            // Total de pedidos
            const [totalPedidos] = await pool.query(
                'SELECT COUNT(*) as total FROM pedidos_compra'
            );

            // Pedidos pendentes
            const [pedidosPendentes] = await pool.query(
                'SELECT COUNT(*) as total FROM pedidos_compra WHERE status = \'pendente\''
            );

            // Valor total de compras do mês
            const [comprasMes] = await pool.query(
                'SELECT SUM(valor_final) as total FROM pedidos_compra WHERE DATE_FORMAT(data_pedido, \'%Y-%m\') = ?',
                [mesAtual]
            );

            // Fornecedores ativos
            const [fornecedoresAtivos] = await pool.query(
                'SELECT COUNT(*) as total FROM fornecedores WHERE ativo = 1'
            );

            // Pedidos por status
            const [pedidosPorStatus] = await pool.query(
                'SELECT status, COUNT(*) as total FROM pedidos_compra GROUP BY status'
            );

            // Top 5 fornecedores por volume
            const [topFornecedores] = await pool.query(`
                SELECT f.razao_social, COUNT(p.id) as total_pedidos, SUM(p.valor_final) as total_valor
                FROM pedidos_compra p
                JOIN fornecedores f ON p.fornecedor_id = f.id
                GROUP BY f.id
                ORDER BY total_valor DESC
                LIMIT 5
            `);

            // Pedidos recentes
            const [pedidosRecentes] = await pool.query(`
                SELECT p.*, f.razao_social as fornecedor_nome
                FROM pedidos_compra p
                LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
                ORDER BY p.created_at DESC
                LIMIT 10
            `);

            res.json({
                stats: {
                    total_pedidos: totalPedidos[0].total,
                    pedidos_pendentes: pedidosPendentes[0].total,
                    compras_mes: comprasMes[0].total || 0,
                    fornecedores_ativos: fornecedoresAtivos[0].total
                },
                pedidos_por_status: pedidosPorStatus,
                top_fornecedores: topFornecedores,
                pedidos_recentes: pedidosRecentes
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar dashboard:', err);
            res.status(500).json({ message: 'Erro ao buscar dados do dashboard' });
        }
    });

    // Histórico de preços de um produto
    router.get('/historico-precos', authenticateToken, async (req, res) => {
        try {
            const { codigo_produto, fornecedor_id } = req.query;
            let query = `
                SELECT h.*, f.razao_social as fornecedor_nome
                FROM historico_precos h
                LEFT JOIN fornecedores f ON h.fornecedor_id = f.id
                WHERE 1=1
            `;
            const params = [];

            if (codigo_produto) {
                query += ' AND h.codigo_produto = ?';
                params.push(codigo_produto);
            }
            if (fornecedor_id) {
                query += ' AND h.fornecedor_id = ?';
                params.push(fornecedor_id);
            }

            query += ' ORDER BY h.data_compra DESC LIMIT 50';

            const [historico] = await pool.query(query, params);
            res.json(historico);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar histórico de preços:', err);
            res.status(500).json({ message: 'Erro ao buscar histórico' });
        }
    });

    // ===== REQUISIÇÕES DE COMPRA =====

    // Criar tabela de requisições se não existir (aguarda conclusão antes de aceitar requests)
    let tabelasRequisicoesProntas = false;
    const initTabelasRequisicoes = (async () => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS requisicoes_compra (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    numero VARCHAR(50) NOT NULL UNIQUE,
                    solicitante VARCHAR(100) NOT NULL,
                    solicitante_id INT,
                    centro_custo_id INT,
                    centro_custo VARCHAR(100),
                    data_solicitacao DATE NOT NULL,
                    data_necessidade DATE,
                    prioridade ENUM('baixa', 'normal', 'alta', 'urgente') DEFAULT 'normal',
                    projeto VARCHAR(200),
                    justificativa TEXT,
                    observacoes TEXT,
                    fornecedores_sugeridos TEXT,
                    status ENUM('rascunho', 'pendente', 'aprovado', 'rejeitado', 'cotacao', 'cancelado') DEFAULT 'pendente',
                    valor_estimado DECIMAL(15,2) DEFAULT 0,
                    aprovador_id INT,
                    data_aprovacao DATETIME,
                    motivo_rejeicao TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);

            // Adicionar coluna fornecedores_sugeridos se não existir (migração)
            try {
                await pool.query(`ALTER TABLE requisicoes_compra ADD COLUMN fornecedores_sugeridos TEXT AFTER observacoes`);
                console.log('[COMPRAS] ✅ Coluna fornecedores_sugeridos adicionada');
            } catch (e) {
                // Coluna já existe — OK
            }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS itens_requisicao (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    requisicao_id INT NOT NULL,
                    produto_id INT,
                    descricao VARCHAR(255) NOT NULL,
                    quantidade DECIMAL(15,3) NOT NULL,
                    unidade VARCHAR(10) DEFAULT 'UN',
                    valor_estimado DECIMAL(15,2) DEFAULT 0,
                    subtotal DECIMAL(15,2) DEFAULT 0,
                    observacao TEXT,
                    FOREIGN KEY (requisicao_id) REFERENCES requisicoes_compra(id) ON DELETE CASCADE
                )
            `);

            tabelasRequisicoesProntas = true;
            console.log('✅ Tabelas de requisições de compra verificadas/criadas');
        } catch (err) {
            console.error('❌ Erro ao criar tabelas de requisições:', err);
        }
    })();

    // Listar todas as requisições
    router.get('/requisicoes', authenticateToken, async (req, res) => {
        try {
            const { status, prioridade, solicitante, data_inicio, data_fim } = req.query;
            let query = `
                SELECT r.*,
                       (SELECT COUNT(*) FROM itens_requisicao WHERE requisicao_id = r.id) as total_itens
                FROM requisicoes_compra r
                WHERE 1=1
            `;
            const params = [];

            if (status && status !== 'todos') {
                query += ' AND r.status = ?';
                params.push(status);
            }
            if (prioridade) {
                query += ' AND r.prioridade = ?';
                params.push(prioridade);
            }
            if (solicitante) {
                query += ' AND r.solicitante LIKE ?';
                params.push(`%${solicitante}%`);
            }
            if (data_inicio) {
                query += ' AND r.data_solicitacao >= ?';
                params.push(data_inicio);
            }
            if (data_fim) {
                query += ' AND r.data_solicitacao <= ?';
                params.push(data_fim);
            }

            query += ' ORDER BY r.created_at DESC';

            const [requisicoes] = await pool.query(query, params);
            res.json(requisicoes);
        } catch (err) {
            console.error('[COMPRAS] Erro ao listar requisições:', err);
            res.status(500).json({ message: 'Erro ao listar requisições' });
        }
    });

    // Gerar próximo número de requisição (DEVE vir ANTES de /:id)
    router.get('/requisicoes/proximo-numero', authenticateToken, async (req, res) => {
        try {
            await initTabelasRequisicoes; // Garantir que tabelas existem

            const [result] = await pool.query(`
                SELECT numero FROM requisicoes_compra
                ORDER BY id DESC LIMIT 1
            `);

            let proximoNumero = 'REQ-0001';
            if (result.length > 0) {
                const ultimoNumero = result[0].numero;
                // Extrair apenas dígitos do final do número para evitar NaN
                const match = ultimoNumero.match(/(\d+)$/);
                if (match) {
                    const numero = parseInt(match[1]) + 1;
                    proximoNumero = `REQ-${numero.toString().padStart(4, '0')}`;
                } else {
                    // Fallback: contar registros + 1
                    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM requisicoes_compra');
                    proximoNumero = `REQ-${(countResult[0].total + 1).toString().padStart(4, '0')}`;
                }
            }

            res.json({ numero: proximoNumero });
        } catch (err) {
            console.error('[COMPRAS] Erro ao gerar número:', err);
            res.status(500).json({ message: 'Erro ao gerar número' });
        }
    });

    // Buscar requisição por ID com itens
    router.get('/requisicoes/:id', authenticateToken, async (req, res) => {
        try {
            const [requisicao] = await pool.query('SELECT * FROM requisicoes_compra WHERE id = ?', [req.params.id]);

            if (requisicao.length === 0) {
                return res.status(404).json({ message: 'Requisição não encontrada' });
            }

            const [itens] = await pool.query('SELECT * FROM itens_requisicao WHERE requisicao_id = ?', [req.params.id]);

            res.json({
                ...requisicao[0],
                itens
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar requisição:', err);
            res.status(500).json({ message: 'Erro ao buscar requisição' });
        }
    });

    // Criar nova requisição
    router.post('/requisicoes', authenticateToken, async (req, res) => {
        await initTabelasRequisicoes; // Garantir que tabelas existem

        let connection;
        try {
            connection = await pool.getConnection();
        } catch (connErr) {
            console.error('[COMPRAS] Erro ao obter conexão:', connErr);
            return res.status(500).json({ message: 'Erro de conexão com o banco de dados' });
        }

        try {
            await connection.beginTransaction();

            const {
                numero, solicitante, solicitante_id, centro_custo_id, centro_custo,
                data_solicitacao, data_necessidade, prioridade, projeto,
                justificativa, observacoes, fornecedores_sugeridos, status, itens
            } = req.body;

            if (!numero || !solicitante) {
                await connection.rollback();
                return res.status(400).json({ message: 'Número e solicitante são obrigatórios' });
            }

            // Verificar duplicidade de número
            const [existente] = await connection.query(
                'SELECT id FROM requisicoes_compra WHERE numero = ?', [numero]
            );
            if (existente.length > 0) {
                await connection.rollback();
                return res.status(409).json({ message: `Requisição ${numero} já existe. Reabra o formulário para gerar novo número.` });
            }

            // Calcular valor total
            const valor_estimado = itens ? itens.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0) : 0;

            // Garantir data_solicitacao válida
            const dataSolicitacao = data_solicitacao && data_solicitacao.trim() !== ''
                ? data_solicitacao
                : new Date().toISOString().split('T')[0];

            // Inserir requisição
            const [result] = await connection.query(
                `INSERT INTO requisicoes_compra (
                    numero, solicitante, solicitante_id, centro_custo_id, centro_custo,
                    data_solicitacao, data_necessidade, prioridade, projeto,
                    justificativa, observacoes, fornecedores_sugeridos, status, valor_estimado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    numero, solicitante, solicitante_id || null, centro_custo_id || null, centro_custo || null,
                    dataSolicitacao, data_necessidade || null, prioridade || 'normal', projeto || null,
                    justificativa || null, observacoes || null, fornecedores_sugeridos || null,
                    status || 'pendente', valor_estimado
                ]
            );

            const requisicaoId = result.insertId;

            // Inserir itens
            if (itens && itens.length > 0) {
                for (const item of itens) {
                    await connection.query(
                        `INSERT INTO itens_requisicao (
                            requisicao_id, produto_id, descricao, quantidade, unidade, valor_estimado, subtotal, observacao
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            requisicaoId, item.produto_id || null, item.descricao || 'Item sem descrição',
                            item.quantidade || 0, item.unidade || 'UN', item.valor_estimado || 0,
                            item.subtotal || 0, item.observacao || null
                        ]
                    );
                }
            }

            await connection.commit();

            res.status(201).json({
                message: 'Requisição criada com sucesso',
                id: requisicaoId,
                numero: numero
            });
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[COMPRAS] Erro ao criar requisição:', err);

            // Erro de duplicidade
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'Número de requisição já existe. Feche o formulário e tente novamente.' });
            }

            res.status(500).json({ message: 'Erro ao criar requisição: ' + (err.sqlMessage || err.message) });
        } finally {
            if (connection) connection.release();
        }
    });

    // Atualizar requisição
    router.put('/requisicoes/:id', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const {
                centro_custo_id, centro_custo, data_necessidade, prioridade, projeto,
                justificativa, observacoes, status, itens
            } = req.body;

            // Verificar se existe
            const [existing] = await connection.query('SELECT * FROM requisicoes_compra WHERE id = ?', [req.params.id]);
            if (existing.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Requisição não encontrada' });
            }

            // Calcular valor total
            const valor_estimado = itens ? itens.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0) : existing[0].valor_estimado;

            // Atualizar requisição
            await connection.query(
                `UPDATE requisicoes_compra SET
                    centro_custo_id = ?, centro_custo = ?, data_necessidade = ?, prioridade = ?,
                    projeto = ?, justificativa = ?, observacoes = ?, status = ?, valor_estimado = ?
                WHERE id = ?`,
                [
                    centro_custo_id || null, centro_custo || null, data_necessidade || null, prioridade || 'normal',
                    projeto || null, justificativa || null, observacoes || null, status || existing[0].status, valor_estimado,
                    req.params.id
                ]
            );

            // Atualizar itens (deletar e reinserir)
            if (itens) {
                await connection.query('DELETE FROM itens_requisicao WHERE requisicao_id = ?', [req.params.id]);

                for (const item of itens) {
                    await connection.query(
                        `INSERT INTO itens_requisicao (
                            requisicao_id, produto_id, descricao, quantidade, unidade, valor_estimado, subtotal, observacao
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            req.params.id, item.produto_id || null, item.descricao, item.quantidade,
                            item.unidade || 'UN', item.valor_estimado || 0, item.subtotal || 0, item.observacao || null
                        ]
                    );
                }
            }

            await connection.commit();

            res.json({ message: 'Requisição atualizada com sucesso' });
        } catch (err) {
            await connection.rollback();
            console.error('[COMPRAS] Erro ao atualizar requisição:', err);
            res.status(500).json({ message: 'Erro ao atualizar requisição' });
        } finally {
            connection.release();
        }
    });

    // Excluir requisição
    router.delete('/requisicoes/:id', authenticateToken, async (req, res) => {
        try {
            const [existing] = await pool.query('SELECT * FROM requisicoes_compra WHERE id = ?', [req.params.id]);
            if (existing.length === 0) {
                return res.status(404).json({ message: 'Requisição não encontrada' });
            }

            // Verificar se pode excluir (apenas rascunho ou pendente)
            if (!['rascunho', 'pendente'].includes(existing[0].status)) {
                return res.status(400).json({ message: 'Apenas requisições pendentes ou em rascunho podem ser excluídas' });
            }

            await pool.query('DELETE FROM requisicoes_compra WHERE id = ?', [req.params.id]);

            res.json({ message: 'Requisição excluída com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao excluir requisição:', err);
            res.status(500).json({ message: 'Erro ao excluir requisição' });
        }
    });

    // Aprovar/Rejeitar requisição
    router.post('/requisicoes/:id/aprovar', authenticateToken, async (req, res) => {
        try {
            const { aprovado, motivo } = req.body;

            // AUDITORIA ENTERPRISE: Validar ID da requisição
            const reqId = parseInt(req.params.id, 10);
            if (!Number.isInteger(reqId) || reqId <= 0) {
                return res.status(400).json({ error: 'ID de requisição inválido' });
            }

            // AUDITORIA ENTERPRISE: Buscar requisição para verificar estado e valor
            const [reqCheck] = await pool.query(
                'SELECT id, status, valor_estimado, solicitante, solicitante_id FROM requisicoes_compra WHERE id = ?',
                [reqId]
            );

            if (reqCheck.length === 0) {
                return res.status(404).json({ error: 'Requisição não encontrada' });
            }

            const requisicaoInfo = reqCheck[0];

            // AUDITORIA ENTERPRISE: Verificar se já foi processada
            if (requisicaoInfo.status !== 'pendente') {
                return res.status(400).json({ error: 'Esta requisição já foi processada' });
            }

            // AUDITORIA ENTERPRISE: Impedir auto-aprovação (quem solicitou não pode aprovar)
            if (requisicaoInfo.solicitante_id && requisicaoInfo.solicitante_id === req.user.id) {
                return res.status(403).json({
                    error: 'Você não pode aprovar sua própria requisição',
                    mensagem: 'Segregação de funções: o solicitante não pode ser o aprovador'
                });
            }

            // AUDITORIA ENTERPRISE: RBAC - Verificar permissão para aprovar
            const userRole = req.user.role || req.user.papel || 'usuario';
            const rolesComPermissaoAprovar = ['admin', 'administrador', 'gerente', 'gerente_compras', 'supervisor_compras', 'diretor'];
            const isAdmin = req.user.is_admin === true;

            if (!isAdmin && !rolesComPermissaoAprovar.includes(userRole)) {
                console.log(`[COMPRAS-RBAC] Usuário ${req.user.id} (${userRole}) tentou aprovar requisição ${reqId} sem permissão`);
                return res.status(403).json({
                    error: 'Você não tem permissão para aprovar requisições',
                    mensagem: 'Apenas supervisores, gerentes ou administradores podem aprovar requisições'
                });
            }

            const novoStatus = aprovado ? 'aprovado' : 'rejeitado';

            // AUDITORIA ENTERPRISE: Log de aprovação
            console.log(`[COMPRAS-AUDIT] Requisição ${reqId} ${novoStatus} por usuário ${req.user.id} (${req.user.nome || req.user.email}) - Valor estimado: R$ ${(requisicaoInfo.valor_estimado || 0).toFixed(2)}`);

            await pool.query(
                `UPDATE requisicoes_compra SET
                    status = ?, aprovador_id = ?, data_aprovacao = NOW(), motivo_rejeicao = ?
                WHERE id = ?`,
                [novoStatus, req.user.id, aprovado ? null : motivo, reqId]
            );

            res.json({
                success: true,
                message: aprovado ? 'Requisição aprovada' : 'Requisição rejeitada',
                aprovador: req.user.nome || req.user.email
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao aprovar/rejeitar requisição:', err);
            res.status(500).json({ message: 'Erro ao processar aprovação' });
        }
    });

    // Estatísticas das requisições
    router.get('/requisicoes-stats', authenticateToken, async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                    SUM(CASE WHEN status = 'aprovado' THEN 1 ELSE 0 END) as aprovadas,
                    SUM(CASE WHEN status = 'cotacao' THEN 1 ELSE 0 END) as em_cotacao,
                    SUM(CASE WHEN prioridade = 'urgente' THEN 1 ELSE 0 END) as urgentes
                FROM requisicoes_compra
            `);
            res.json(stats[0]);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar estatísticas:', err);
            res.status(500).json({ message: 'Erro ao buscar estatísticas' });
        }
    });

    // ===== COTAÇÕES DE COMPRA =====

    // Criar tabela de cotações se não existir
    (async () => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS cotacoes_compra (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    numero VARCHAR(20) NOT NULL UNIQUE,
                    descricao VARCHAR(255) NOT NULL,
                    requisicao_id INT,
                    data_abertura DATE NOT NULL,
                    data_validade DATE,
                    quantidade DECIMAL(15,3),
                    unidade VARCHAR(10) DEFAULT 'UN',
                    especificacoes TEXT,
                    observacoes TEXT,
                    valor_medio DECIMAL(15,2) DEFAULT 0,
                    melhor_preco DECIMAL(15,2) DEFAULT 0,
                    fornecedor_vencedor_id INT,
                    status ENUM('aberta', 'analise', 'finalizada', 'cancelada') DEFAULT 'aberta',
                    criado_por INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS cotacao_fornecedores (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    cotacao_id INT NOT NULL,
                    fornecedor_id INT NOT NULL,
                    valor_unitario DECIMAL(15,2),
                    valor_total DECIMAL(15,2),
                    prazo_entrega INT,
                    condicao_pagamento VARCHAR(100),
                    observacoes TEXT,
                    data_resposta DATETIME,
                    selecionado BOOLEAN DEFAULT FALSE,
                    FOREIGN KEY (cotacao_id) REFERENCES cotacoes_compra(id) ON DELETE CASCADE
                )
            `);

            console.log('✅ Tabelas de cotações de compra verificadas/criadas');
        } catch (err) {
            console.error('Erro ao criar tabelas de cotações:', err);
        }
    })();

    // Listar todas as cotações
    router.get('/cotacoes', authenticateToken, async (req, res) => {
        try {
            const { status } = req.query;
            let query = `
                SELECT c.*,
                       (SELECT COUNT(*) FROM cotacao_fornecedores WHERE cotacao_id = c.id) as total_fornecedores,
                       f.razao_social as fornecedor_vencedor
                FROM cotacoes_compra c
                LEFT JOIN fornecedores f ON c.fornecedor_vencedor_id = f.id
                WHERE 1=1
            `;
            const params = [];

            if (status && status !== 'todas') {
                query += ' AND c.status = ?';
                params.push(status);
            }

            query += ' ORDER BY c.created_at DESC';

            const [cotacoes] = await pool.query(query, params);
            res.json(cotacoes);
        } catch (err) {
            console.error('[COMPRAS] Erro ao listar cotações:', err);
            res.status(500).json({ message: 'Erro ao listar cotações' });
        }
    });

    // Gerar próximo número de cotação (DEVE ficar ANTES de /:id)
    router.get('/cotacoes/proximo-numero', authenticateToken, async (req, res) => {
        try {
            const [result] = await pool.query(`
                SELECT numero FROM cotacoes_compra ORDER BY id DESC LIMIT 1
            `);

            let proximoNumero = 'COT-0001';
            if (result.length > 0) {
                const numero = parseInt(result[0].numero.replace('COT-', '')) + 1;
                proximoNumero = `COT-${numero.toString().padStart(4, '0')}`;
            }

            res.json({ numero: proximoNumero });
        } catch (err) {
            console.error('[COMPRAS] Erro ao gerar número:', err);
            res.status(500).json({ message: 'Erro ao gerar número' });
        }
    });

    // Buscar cotação por ID com fornecedores
    router.get('/cotacoes/:id', authenticateToken, async (req, res) => {
        try {
            const [cotacao] = await pool.query('SELECT * FROM cotacoes_compra WHERE id = ?', [req.params.id]);

            if (cotacao.length === 0) {
                return res.status(404).json({ message: 'Cotação não encontrada' });
            }

            const [fornecedores] = await pool.query(`
                SELECT cf.*, f.razao_social, f.cnpj, f.telefone, f.email
                FROM cotacao_fornecedores cf
                LEFT JOIN fornecedores f ON cf.fornecedor_id = f.id
                WHERE cf.cotacao_id = ?
            `, [req.params.id]);

            res.json({
                ...cotacao[0],
                fornecedores
            });
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar cotação:', err);
            res.status(500).json({ message: 'Erro ao buscar cotação' });
        }
    });

    // Criar nova cotação
    router.post('/cotacoes', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const {
                numero, descricao, requisicao_id, data_abertura, data_validade,
                quantidade, unidade, especificacoes, observacoes, fornecedores_ids
            } = req.body;

            if (!numero || !descricao) {
                await connection.rollback();
                return res.status(400).json({ message: 'Número e descrição são obrigatórios' });
            }

            const [result] = await connection.query(
                `INSERT INTO cotacoes_compra (
                    numero, descricao, requisicao_id, data_abertura, data_validade,
                    quantidade, unidade, especificacoes, observacoes, criado_por
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    numero, descricao, requisicao_id || null, data_abertura || new Date(),
                    data_validade || null, quantidade || null, unidade || 'UN',
                    especificacoes || null, observacoes || null, req.user.id
                ]
            );

            const cotacaoId = result.insertId;

            // Adicionar fornecedores
            if (fornecedores_ids && fornecedores_ids.length > 0) {
                for (const fornId of fornecedores_ids) {
                    await connection.query(
                        'INSERT INTO cotacao_fornecedores (cotacao_id, fornecedor_id) VALUES (?, ?)',
                        [cotacaoId, fornId]
                    );
                }
            }

            await connection.commit();

            res.status(201).json({
                message: 'Cotação criada com sucesso',
                id: cotacaoId,
                numero: numero
            });
        } catch (err) {
            await connection.rollback();
            console.error('[COMPRAS] Erro ao criar cotação:', err);
            res.status(500).json({ message: 'Erro ao criar cotação' });
        } finally {
            connection.release();
        }
    });

    // Atualizar cotação
    router.put('/cotacoes/:id', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const {
                descricao, data_validade, quantidade, unidade, especificacoes,
                observacoes, status, fornecedores
            } = req.body;

            const [existing] = await connection.query('SELECT * FROM cotacoes_compra WHERE id = ?', [req.params.id]);
            if (existing.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Cotação não encontrada' });
            }

            // Calcular valor médio e melhor preço
            let valorMedio = 0, melhorPreco = 0, fornecedorVencedor = null;
            if (fornecedores && fornecedores.length > 0) {
                const valores = fornecedores.filter(f => f.valor_total > 0).map(f => parseFloat(f.valor_total));
                if (valores.length > 0) {
                    valorMedio = valores.reduce((a, b) => a + b, 0) / valores.length;
                    melhorPreco = Math.min(...valores);
                    const vencedor = fornecedores.find(f => f.selecionado);
                    if (vencedor) fornecedorVencedor = vencedor.fornecedor_id;
                }
            }

            await connection.query(
                `UPDATE cotacoes_compra SET
                    descricao = ?, data_validade = ?, quantidade = ?, unidade = ?,
                    especificacoes = ?, observacoes = ?, status = ?, valor_medio = ?,
                    melhor_preco = ?, fornecedor_vencedor_id = ?
                WHERE id = ?`,
                [
                    descricao || existing[0].descricao, data_validade || existing[0].data_validade,
                    quantidade || existing[0].quantidade, unidade || existing[0].unidade,
                    especificacoes || existing[0].especificacoes, observacoes || existing[0].observacoes,
                    status || existing[0].status, valorMedio, melhorPreco, fornecedorVencedor, req.params.id
                ]
            );

            // Atualizar fornecedores
            if (fornecedores) {
                for (const forn of fornecedores) {
                    await connection.query(
                        `UPDATE cotacao_fornecedores SET
                            valor_unitario = ?, valor_total = ?, prazo_entrega = ?,
                            condicao_pagamento = ?, observacoes = ?, data_resposta = ?, selecionado = ?
                        WHERE cotacao_id = ? AND fornecedor_id = ?`,
                        [
                            forn.valor_unitario || 0, forn.valor_total || 0, forn.prazo_entrega || null,
                            forn.condicao_pagamento || null, forn.observacoes || null,
                            forn.data_resposta || null, forn.selecionado || false,
                            req.params.id, forn.fornecedor_id
                        ]
                    );
                }
            }

            await connection.commit();
            res.json({ message: 'Cotação atualizada com sucesso' });
        } catch (err) {
            await connection.rollback();
            console.error('[COMPRAS] Erro ao atualizar cotação:', err);
            res.status(500).json({ message: 'Erro ao atualizar cotação' });
        } finally {
            connection.release();
        }
    });

    // Excluir cotação
    router.delete('/cotacoes/:id', authenticateToken, async (req, res) => {
        try {
            const [existing] = await pool.query('SELECT * FROM cotacoes_compra WHERE id = ?', [req.params.id]);
            if (existing.length === 0) {
                return res.status(404).json({ message: 'Cotação não encontrada' });
            }

            if (existing[0].status === 'finalizada') {
                return res.status(400).json({ message: 'Cotações finalizadas não podem ser excluídas' });
            }

            await pool.query('DELETE FROM cotacoes_compra WHERE id = ?', [req.params.id]);
            res.json({ message: 'Cotação excluída com sucesso' });
        } catch (err) {
            console.error('[COMPRAS] Erro ao excluir cotação:', err);
            res.status(500).json({ message: 'Erro ao excluir cotação' });
        }
    });

    // Estatísticas das cotações
    router.get('/cotacoes-stats', authenticateToken, async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'aberta' THEN 1 ELSE 0 END) as abertas,
                    SUM(CASE WHEN status = 'analise' THEN 1 ELSE 0 END) as em_analise,
                    SUM(CASE WHEN status = 'finalizada' THEN 1 ELSE 0 END) as finalizadas
                FROM cotacoes_compra
            `);
            res.json(stats[0]);
        } catch (err) {
            console.error('[COMPRAS] Erro ao buscar estatísticas:', err);
            res.status(500).json({ message: 'Erro ao buscar estatísticas' });
        }
    });

    // Observação: não definir rotas públicas here para /dashboard ou /index.html —
    // elas já estão protegidas acima usando `requireAuthPage`.

    // Rota para tela de configurações — somente administradores
    router.get('/config.html', authenticatePage, (req, res) => {
        // Se não autenticado, redirecionar para raiz (front-end mostrará o login se necessário)
        if (!req.user) return res.redirect('/');
        const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
        const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';
        // Usa userPermissions.isAdmin para verificar lista de administradores
        if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
            return res.sendFile(path.join(__dirname, '..', 'public', 'config.html'));
        }
        return res.status(403).send('<h1>Acesso Negado</h1><p>Esta área é restrita a administradores.</p>');
    });

    // Endpoint administrativo para configurar permissões de vendas
    router.post('/api/admin/configure-vendas-permissions', authenticateToken, async (req, res) => {
        try {
            // Verificar se é admin
            if (!req.user.is_admin && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
            }

            const permissoesVendas = JSON.stringify({
                visualizar: true,
                criar: true,
                editar: true,
                excluir: true,
                aprovar: true,
                dashboard: true
            });

            // Usuários que devem ter acesso a vendas
            const usuarios = [
                'ti@aluforce.ind.br', 'douglas@aluforce.ind.br', 'andreia@aluforce.ind.br',
                'renata@aluforce.ind.br', 'augusto@aluforce.ind.br', 'marcia@aluforce.ind.br',
                'clemerson@aluforce.ind.br', 'thiago@aluforce.ind.br', 'ariel@aluforce.ind.br',
                'fabiano@aluforce.ind.br', 'fabiola@aluforce.ind.br'
            ];

            const results = [];

            for (const email of usuarios) {
                try {
                    const [result] = await pool.query(
                        'UPDATE usuarios SET permissoes_vendas = ? WHERE email = ? OR login = ? OR nome LIKE ?',
                        [permissoesVendas, email, email.split('@')[0], `%${email.split('@')[0]}%`]
                    );

                    if (result.affectedRows > 0) {
                        results.push({ email, status: 'success', affected: result.affectedRows });
                    } else {
                        results.push({ email, status: 'not_found' });
                    }
                } catch (err) {
                    results.push({ email, status: 'error', message: err.message });
                }
            }

            res.json({ success: true, results });
        } catch (error) {
            console.error('Erro ao configurar permissões:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Endpoint para configurar permissões baseado em nomes da tabela funcionarios
    router.post('/api/admin/configure-vendas-by-names', authenticateToken, async (req, res) => {
        try {
            // Verificar se é admin
            if (!req.user.is_admin && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
            }

            const permissoesVendas = JSON.stringify({
                visualizar: true,
                criar: true,
                editar: true,
                excluir: true,
                aprovar: true,
                dashboard: true
            });

            // Nomes base para buscar (sem sobrenome, apenas primeiro nome ou parte)
            const nomesBase = [
                'ti', 'douglas', 'andreia', 'renata', 'augusto',
                'marcia', 'clemerson', 'thiago', 'ariel', 'fabiano', 'fabiola'
            ];

            const results = [];
            let totalFound = 0;

            console.log('\n🔍 Buscando usuários na tabela usuarios por nome...\n');

            for (const nomeBase of nomesBase) {
                try {
                    // Buscar na tabela usuarios por nome, email ou login
                    const [usuarios] = await pool.query(
                        `SELECT id, nome, email, login
                         FROM usuarios
                         WHERE LOWER(nome) LIKE ?
                            OR LOWER(email) LIKE ?
                            OR LOWER(login) LIKE ?`,
                        [`%${nomeBase.toLowerCase()}%`, `%${nomeBase.toLowerCase()}%`, `%${nomeBase.toLowerCase()}%`]
                    );

                    if (usuarios.length > 0) {
                        for (const usuario of usuarios) {
                            try {
                                const [result] = await pool.query(
                                    'UPDATE usuarios SET permissoes_vendas = ? WHERE id = ?',
                                    [permissoesVendas, usuario.id]
                                );

                                console.log(`✅ ${usuario.nome} (ID: ${usuario.id}) - Permissões atualizadas`);

                                results.push({
                                    name: nomeBase,
                                    status: 'success',
                                    id: usuario.id,
                                    nome_completo: usuario.nome,
                                    email: usuario.email,
                                    login: usuario.login
                                });
                                totalFound++;
                            } catch (err) {
                                console.error(`❌ Erro ao atualizar ${usuario.nome}:`, err.message);
                                results.push({
                                    name: nomeBase,
                                    status: 'error',
                                    message: err.message
                                });
                            }
                        }
                    } else {
                        console.log(`⚠️  ${nomeBase} - Não encontrado`);
                        results.push({
                            name: nomeBase,
                            status: 'not_found'
                        });
                    }

                } catch (err) {
                    console.error(`❌ Erro ao buscar ${nomeBase}:`, err.message);
                    results.push({
                        name: nomeBase,
                        status: 'error',
                        message: err.message
                    });
                }
            }

            console.log(`\n✅ Total de ${totalFound} usuários atualizados\n`);

            res.json({
                success: true,
                results,
                found: totalFound,
                searched: nomesBase.length
            });
        } catch (error) {
            console.error('Erro ao configurar permissões:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Endpoint para remover permissões de vendas de um usuário específico
    router.post('/api/admin/remove-vendas-permission', authenticateToken, async (req, res) => {
        try {
            // Verificar se é admin
            if (!req.user.is_admin && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
            }

            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({ error: 'userId é obrigatório' });
            }

            // Buscar dados do usuário antes de remover
            const [[usuario]] = await pool.query(
                'SELECT id, nome, email, login FROM usuarios WHERE id = ?',
                [userId]
            );

            if (!usuario) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            // Remover permissões (setar como NULL)
            await pool.query(
                'UPDATE usuarios SET permissoes_vendas = NULL WHERE id = ?',
                [userId]
            );

            console.log(`🗑️  Permissões de vendas removidas do usuário ID ${userId} (${usuario.nome})`);

            res.json({
                success: true,
                user: usuario,
                message: 'Permissões de vendas removidas com sucesso'
            });
        } catch (error) {
            console.error('Erro ao remover permissões:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Endpoint para corrigir permissões malformadas
    router.post('/api/admin/fix-vendas-permissions', authenticateToken, async (req, res) => {
        try {
            // Verificar se é admin
            if (!req.user.is_admin && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
            }

            // Permissões corretas em formato JSON
            const permissoesCorretas = JSON.stringify({
                visualizar: true,
                criar: true,
                editar: true,
                excluir: true,
                aprovar: true,
                dashboard: true
            });

            // IDs dos usuários que devem ter acesso (excluindo ID 67)
            const userIds = [2, 79, 70, 69, 63, 62, 71, 64, 65, 72];

            const results = [];
            let fixed = 0;

            console.log('\n🔧 Corrigindo permissões de vendas...\n');

            for (const id of userIds) {
                try {
                    // Buscar usuário
                    const [[usuario]] = await pool.query(
                        'SELECT id, nome, email, login FROM usuarios WHERE id = ?',
                        [id]
                    );

                    if (usuario) {
                        // Atualizar com JSON válido
                        await pool.query(
                            'UPDATE usuarios SET permissoes_vendas = ? WHERE id = ?',
                            [permissoesCorretas, id]
                        );

                        console.log(`✅ ${usuario.nome} (ID: ${id}) - Permissões corrigidas`);

                        results.push({
                            status: 'success',
                            id: usuario.id,
                            nome: usuario.nome,
                            email: usuario.email || usuario.login
                        });
                        fixed++;
                    } else {
                        console.log(`⚠️  ID ${id} - Não encontrado`);
                        results.push({
                            status: 'not_found',
                            id: id
                        });
                    }

                } catch (err) {
                    console.error(`❌ Erro ao corrigir ID ${id}:`, err.message);
                    results.push({
                        status: 'error',
                        id: id,
                        message: err.message
                    });
                }
            }

            console.log(`\n✅ Total de ${fixed} usuários corrigidos\n`);

            res.json({
                success: true,
                fixed,
                results
            });
        } catch (error) {
            console.error('Erro ao corrigir permissões:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};

// ============================================================
// PROCESSAMENTO DE XML DE ENTRADA (Módulo Compras)
// Função reutilizável para importar NF-e de fornecedores
// ============================================================
async function processarXMLEntradaCompras(pool, xmlContent, userId) {
    const parseTag = (xml, tag) => {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : null;
    };
    const parseTagSimples = (xml, tag) => {
        const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'gi');
        const match = regex.exec(xml);
        return match ? match[1].trim() : '';
    };

    // Extrair chave de acesso
    let chaveAcesso = '';
    const infNFeMatch = xmlContent.match(/Id="NFe(\d{44})"/);
    if (infNFeMatch) {
        chaveAcesso = infNFeMatch[1];
    } else {
        const chNFeMatch = xmlContent.match(/<chNFe>(\d{44})<\/chNFe>/);
        if (chNFeMatch) chaveAcesso = chNFeMatch[1];
    }
    if (!chaveAcesso || chaveAcesso.length !== 44) {
        throw new Error('Chave de acesso não encontrada no XML (44 dígitos)');
    }

    // Verificar duplicidade
    const [existe] = await pool.query('SELECT id FROM nf_entrada WHERE chave_acesso = ?', [chaveAcesso]);
    if (existe.length > 0) {
        return { success: false, error: 'NF já importada', id: existe[0].id, duplicada: true };
    }

    // Extrair emitente
    const emitXML = parseTag(xmlContent, 'emit') || '';
    const fornecedorCNPJ = parseTagSimples(emitXML, 'CNPJ');
    const fornecedorRazao = parseTagSimples(emitXML, 'xNome');
    const fornecedorFantasia = parseTagSimples(emitXML, 'xFant');
    const fornecedorIE = parseTagSimples(emitXML, 'IE');
    const fornecedorUF = parseTagSimples(emitXML, 'UF');
    const fornecedorMun = parseTagSimples(emitXML, 'xMun');
    const fornecedorCodMun = parseTagSimples(emitXML, 'cMun');

    // Extrair IDE
    const ideXML = parseTag(xmlContent, 'ide') || '';
    const nNF = parseTagSimples(ideXML, 'nNF');
    const serie = parseTagSimples(ideXML, 'serie');
    const mod = parseTagSimples(ideXML, 'mod');
    const natOp = parseTagSimples(ideXML, 'natOp');
    const dhEmi = parseTagSimples(ideXML, 'dhEmi');
    const dhSaiEnt = parseTagSimples(ideXML, 'dhSaiEnt');

    // Extrair totais
    const icmsTotXML = parseTag(xmlContent, 'ICMSTot') || '';
    const valorProd = parseFloat(parseTagSimples(icmsTotXML, 'vProd')) || 0;
    const valorFrete = parseFloat(parseTagSimples(icmsTotXML, 'vFrete')) || 0;
    const valorSeg = parseFloat(parseTagSimples(icmsTotXML, 'vSeg')) || 0;
    const valorDesc = parseFloat(parseTagSimples(icmsTotXML, 'vDesc')) || 0;
    const valorOutro = parseFloat(parseTagSimples(icmsTotXML, 'vOutro')) || 0;
    const valorNF = parseFloat(parseTagSimples(icmsTotXML, 'vNF')) || 0;
    const bcICMS = parseFloat(parseTagSimples(icmsTotXML, 'vBC')) || 0;
    const valorICMS = parseFloat(parseTagSimples(icmsTotXML, 'vICMS')) || 0;
    const bcST = parseFloat(parseTagSimples(icmsTotXML, 'vBCST')) || 0;
    const valorST = parseFloat(parseTagSimples(icmsTotXML, 'vST')) || 0;
    const valorIPI = parseFloat(parseTagSimples(icmsTotXML, 'vIPI')) || 0;
    const valorPIS = parseFloat(parseTagSimples(icmsTotXML, 'vPIS')) || 0;
    const valorCOFINS = parseFloat(parseTagSimples(icmsTotXML, 'vCOFINS')) || 0;

    const nProt = parseTagSimples(xmlContent, 'nProt');
    const dhRecbto = parseTagSimples(xmlContent, 'dhRecbto');

    // Inserir NF de entrada
    const [insertResult] = await pool.query(`
        INSERT INTO nf_entrada (
            chave_acesso, numero_nfe, serie, modelo,
            fornecedor_cnpj, fornecedor_razao_social, fornecedor_nome_fantasia,
            fornecedor_ie, fornecedor_uf, fornecedor_municipio, fornecedor_codigo_municipio,
            valor_produtos, valor_frete, valor_seguro, valor_desconto, valor_outros, valor_total,
            bc_icms, valor_icms, bc_icms_st, valor_icms_st, valor_ipi, valor_pis, valor_cofins,
            data_emissao, data_saida, protocolo_autorizacao, data_autorizacao,
            natureza_operacao, status, xml_completo, importado_por
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importada', ?, ?)
    `, [
        chaveAcesso, parseInt(nNF) || 0, parseInt(serie) || 1, mod || '55',
        fornecedorCNPJ, fornecedorRazao, fornecedorFantasia || fornecedorRazao,
        fornecedorIE, fornecedorUF, fornecedorMun, fornecedorCodMun,
        valorProd, valorFrete, valorSeg, valorDesc, valorOutro, valorNF,
        bcICMS, valorICMS, bcST, valorST, valorIPI, valorPIS, valorCOFINS,
        dhEmi || new Date(), dhSaiEnt || null, nProt || null, dhRecbto || null,
        natOp || '', xmlContent, userId
    ]);

    const nfEntradaId = insertResult.insertId;

    // Extrair e inserir itens
    const detMatches = xmlContent.match(/<det nItem="(\d+)">([\s\S]*?)<\/det>/gi) || [];
    let itensInseridos = 0;

    for (const detXML of detMatches) {
        const nItemMatch = detXML.match(/nItem="(\d+)"/);
        const nItem = nItemMatch ? parseInt(nItemMatch[1]) : ++itensInseridos;

        const prodXML = parseTag(detXML, 'prod') || '';
        const cProd = parseTagSimples(prodXML, 'cProd');
        const xProd = parseTagSimples(prodXML, 'xProd');
        const ncm = parseTagSimples(prodXML, 'NCM');
        const cest = parseTagSimples(prodXML, 'CEST');
        const cfop = parseTagSimples(prodXML, 'CFOP');
        const uCom = parseTagSimples(prodXML, 'uCom');
        const qCom = parseFloat(parseTagSimples(prodXML, 'qCom')) || 0;
        const vUnCom = parseFloat(parseTagSimples(prodXML, 'vUnCom')) || 0;
        const vProd = parseFloat(parseTagSimples(prodXML, 'vProd')) || 0;
        const cEAN = parseTagSimples(prodXML, 'cEAN');

        const impostoXML = parseTag(detXML, 'imposto') || '';
        const icmsXML = parseTag(impostoXML, 'ICMS') || '';
        const ipiXML = parseTag(impostoXML, 'IPI') || '';
        const pisXML = parseTag(impostoXML, 'PIS') || '';
        const cofinsXML = parseTag(impostoXML, 'COFINS') || '';

        const cstICMS = parseTagSimples(icmsXML, 'CST') || '';
        const valorICMSItem = parseFloat(parseTagSimples(icmsXML, 'vICMS')) || 0;
        const aliqICMS = parseFloat(parseTagSimples(icmsXML, 'pICMS')) || 0;
        const valorIPIItem = parseFloat(parseTagSimples(ipiXML, 'vIPI')) || 0;
        const valorPISItem = parseFloat(parseTagSimples(pisXML, 'vPIS')) || 0;
        const valorCOFINSItem = parseFloat(parseTagSimples(cofinsXML, 'vCOFINS')) || 0;

        try {
            await pool.query(`
                INSERT INTO nf_entrada_itens (
                    nf_entrada_id, numero_item, codigo_produto, descricao, ncm, cest, cfop,
                    unidade, quantidade, valor_unitario, valor_total, ean,
                    cst_icms, aliquota_icms, valor_icms, valor_ipi, valor_pis, valor_cofins
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                nfEntradaId, nItem, cProd, xProd, ncm, cest || null, cfop,
                uCom || 'UN', qCom, vUnCom, vProd, cEAN || null,
                cstICMS, aliqICMS, valorICMSItem, valorIPIItem, valorPISItem, valorCOFINSItem
            ]);
        } catch (e) {
            console.warn('[COMPRAS] Erro ao inserir item NF:', e.message);
        }
        itensInseridos++;
    }

    // Auto-cadastrar fornecedor
    try {
        await pool.query(`
            INSERT INTO fornecedores (cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, cidade, codigo_municipio)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE razao_social = VALUES(razao_social), nome_fantasia = VALUES(nome_fantasia)
        `, [fornecedorCNPJ, fornecedorRazao, fornecedorFantasia, fornecedorIE, fornecedorUF, fornecedorMun, fornecedorCodMun]);
    } catch (e) {
        console.warn('[COMPRAS] Erro ao auto-cadastrar fornecedor:', e.message);
    }

    return {
        success: true,
        id: nfEntradaId,
        chave_acesso: chaveAcesso,
        numero_nfe: parseInt(nNF),
        serie: parseInt(serie) || 1,
        fornecedor: { razao_social: fornecedorRazao, cnpj: fornecedorCNPJ },
        valor_total: valorNF,
        itens: itensInseridos,
        impostos: { icms: valorICMS, ipi: valorIPI, pis: valorPIS, cofins: valorCOFINS },
        message: `NF ${nNF} importada com sucesso (${itensInseridos} itens)`
    };
}
