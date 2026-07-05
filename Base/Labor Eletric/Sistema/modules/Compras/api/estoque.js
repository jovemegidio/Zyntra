const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ BUSCAR MATERIAL POR QR CODE ============
router.get('/qrcode/lookup', async (req, res) => {
    try {
        const db = getDatabase();
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'Código é obrigatório' });
        }
        const searchParam = `%${code}%`;
        let material = null;
        // Try estoque_materias_primas (exact match first, then LIKE)
        try {
            const [rows] = await db.query(
                `SELECT id, codigo, descricao, unidade_medida as unidade,
                        quantidade_minima as estoque_min, quantidade_minima as estoque_max,
                        COALESCE(quantidade_atual, 0) as estoque_atual, localizacao, tipo
                 FROM estoque_materias_primas
                 WHERE codigo = ? OR id = ? OR codigo LIKE ? OR descricao LIKE ?
                 ORDER BY CASE WHEN codigo = ? THEN 0 ELSE 1 END
                 LIMIT 1`,
                [code, parseInt(code) || 0, searchParam, searchParam, code]
            );
            if (rows.length > 0) material = rows[0];
        } catch (e) { /* table may not exist */ }
        // Try materiais
        if (!material) {
            try {
                const [rows] = await db.query(
                    `SELECT m.id, m.codigo_material as codigo, m.descricao,
                            m.unidade_medida as unidade, m.estoque_minimo as estoque_min,
                            m.estoque_maximo as estoque_max,
                            COALESCE(e.quantidade_atual, 0) as estoque_atual, m.tipo
                     FROM materiais m LEFT JOIN estoque e ON e.material_id = m.id
                     WHERE m.codigo_material = ? OR m.id = ? OR m.codigo_material LIKE ? OR m.descricao LIKE ?
                     ORDER BY CASE WHEN m.codigo_material = ? THEN 0 ELSE 1 END
                     LIMIT 1`,
                    [code, parseInt(code) || 0, searchParam, searchParam, code]
                );
                if (rows.length > 0) material = rows[0];
            } catch (e) { /* table may not exist */ }
        }
        if (!material) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        material.status = material.estoque_atual <= 0 ? 'critico'
            : material.estoque_atual < (material.estoque_min || 0) ? 'baixo' : 'adequado';
        res.json({ material });
    } catch (error) {
        console.error('Erro QR lookup:', error);
        res.status(500).json({ error: 'Erro ao buscar material' });
    }
});

// ============ MATERIAIS PCP (Gestão de Estoque) ============
router.get('/materiais-pcp', async (req, res) => {
    try {
        const db = getDatabase();
        const { page = 1, limit = 50, busca = '', tipo = '', ativo = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const limitNum = parseInt(limit);

        let materiais = [];
        let total = 0;
        let tipos = [];

        // Usar tabela 'materiais' como fonte principal (191 itens classificados)
        try {
            let sql = `SELECT m.id, m.codigo_material as codigo, m.descricao,
                        m.unidade_medida as unidade, m.estoque_minimo as estoque_min,
                        COALESCE(e.quantidade_atual, 0) as estoque_atual,
                        m.tipo, m.ativo, m.custo_unitario, m.ncm,
                        CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END as vinculado_estoque
                 FROM materiais m LEFT JOIN estoque e ON e.material_id = m.id WHERE 1=1 AND m.tipo != 'MIGRADO_PARA_PRODUTOS'`;
            const params = [];

            if (busca) {
                sql += ' AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`);
            }
            if (tipo) {
                sql += ' AND m.tipo = ?';
                params.push(tipo);
            }
            if (ativo === '1') sql += ' AND m.ativo = 1';
            else if (ativo === '0') sql += ' AND m.ativo = 0';

            let countSql = `SELECT COUNT(*) as total FROM materiais m LEFT JOIN estoque e ON e.material_id = m.id WHERE 1=1 AND m.tipo != 'MIGRADO_PARA_PRODUTOS'`;
            if (busca) countSql += ' AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)';
            if (tipo)  countSql += ' AND m.tipo = ?';
            if (ativo === '1') countSql += ' AND m.ativo = 1';
            else if (ativo === '0') countSql += ' AND m.ativo = 0';
            const [countRows] = await db.query(countSql, params);
            total = countRows[0]?.total || 0;

            sql += ' ORDER BY m.descricao LIMIT ? OFFSET ?';
            params.push(limitNum, offset);
            const [rows] = await db.query(sql, params);
            materiais = rows;

            const [tiposRows] = await db.query("SELECT tipo, COUNT(*) as count FROM materiais WHERE ativo = 1 AND tipo != 'MIGRADO_PARA_PRODUTOS' GROUP BY tipo ORDER BY tipo");
            tipos = tiposRows;
        } catch (e) {
            // Fallback to estoque_materias_primas
            try {
                let sql = `SELECT id, codigo, descricao, unidade_medida as unidade,
                            quantidade_minima as estoque_min,
                            COALESCE(quantidade_atual, 0) as estoque_atual,
                            localizacao, tipo, ativo,
                            CASE WHEN EXISTS (SELECT 1 FROM estoque e2 WHERE e2.material_id = estoque_materias_primas.id) THEN 1 ELSE 0 END as vinculado_estoque
                     FROM estoque_materias_primas WHERE 1=1`;
                const params = [];

                if (busca) {
                    sql += ' AND (codigo LIKE ? OR descricao LIKE ?)';
                    params.push(`%${busca}%`, `%${busca}%`);
                }
                if (tipo) {
                    sql += ' AND tipo = ?';
                    params.push(tipo);
                }
                if (ativo === '1') sql += ' AND ativo = 1';
                else if (ativo === '0') sql += ' AND ativo = 0';

                let countSql = 'SELECT COUNT(*) as total FROM estoque_materias_primas WHERE 1=1';
                if (busca) countSql += ' AND (codigo LIKE ? OR descricao LIKE ?)';
                if (tipo)  countSql += ' AND tipo = ?';
                if (ativo === '1') countSql += ' AND ativo = 1';
                else if (ativo === '0') countSql += ' AND ativo = 0';
                const [countRows] = await db.query(countSql, params);
                total = countRows[0]?.total || 0;

                sql += ' ORDER BY descricao LIMIT ? OFFSET ?';
                params.push(limitNum, offset);
                const [rows] = await db.query(sql, params);
                materiais = rows;

                const [tiposRows] = await db.query('SELECT tipo, COUNT(*) as count FROM estoque_materias_primas GROUP BY tipo ORDER BY tipo');
                tipos = tiposRows;
            } catch (e2) {
                materiais = [];
            }
        }

        const ativos = materiais.filter(m => m.ativo !== 0).length;
        const totalPages = Math.ceil(total / limitNum) || 1;

        res.json({
            materiais,
            paginacao: { total, totalPages, page: parseInt(page), limit: limitNum },
            tipos,
            stats: { total, ativos, inativos: total - ativos }
        });
    } catch (error) {
        console.error('Erro ao buscar materiais PCP:', error);
        res.status(500).json({ error: 'Erro ao buscar materiais' });
    }
});

// ============ CONSULTAR ESTOQUE ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { material_id, baixo_estoque, busca } = req.query;

        // Se tiver busca, procurar em todas as tabelas de materiais (não exige entrada prévia)
        if (busca) {
            const searchParam = `%${busca}%`;
            let materiais = [];

            // Tentar estoque_materias_primas primeiro
            try {
                const [rows] = await db.query(
                    `SELECT id, codigo, descricao, unidade_medida as unidade,
                            quantidade_minima as estoque_minimo, quantidade_minima as estoque_maximo,
                            COALESCE(quantidade_atual, 0) as quantidade_estoque, localizacao, tipo
                     FROM estoque_materias_primas
                     WHERE codigo LIKE ? OR descricao LIKE ?
                     ORDER BY descricao LIMIT 20`,
                    [searchParam, searchParam]
                );
                materiais = rows;
            } catch (e) { /* table may not exist */ }

            // Se não achou, tenta materiais + estoque
            if (materiais.length === 0) {
                try {
                    const [rows] = await db.query(
                        `SELECT m.id, m.codigo_material as codigo, m.descricao,
                                m.unidade_medida as unidade, m.estoque_minimo,
                                m.estoque_maximo,
                                COALESCE(e.quantidade_atual, 0) as quantidade_estoque, m.tipo
                         FROM materiais m LEFT JOIN estoque e ON e.material_id = m.id
                         WHERE m.codigo_material LIKE ? OR m.descricao LIKE ?
                         ORDER BY m.descricao LIMIT 20`,
                        [searchParam, searchParam]
                    );
                    materiais = rows;
                } catch (e) { /* table may not exist */ }
            }

            return res.json({ materiais });
        }

        let sql = `SELECT e.*, m.codigo_material, m.descricao, m.unidade_medida,
                          m.estoque_minimo, m.estoque_maximo
                   FROM estoque e
                   INNER JOIN materiais m ON e.material_id = m.id
                   WHERE 1=1`;
        const params = [];
        
        if (material_id) {
            sql += ' AND e.material_id = ?';
            params.push(material_id);
        }
        
        if (baixo_estoque === 'true') {
            sql += ' AND e.quantidade_atual < m.estoque_minimo';
        }
        
        sql += ' ORDER BY m.descricao';
        
        const [estoque] = await db.query(sql, params);
        
        res.json({ estoque });
    } catch (error) {
        console.error('Erro ao consultar estoque:', error);
        res.status(500).json({ error: 'Erro ao consultar estoque' });
    }
});

// ============ MATERIAIS COM ENTRADA (para Gestão de Estoque) ============
// Retorna APENAS materiais que tiveram movimentação de ENTRADA registrada pelo comprador
// IMPORTANTE: Esta rota DEVE vir ANTES de /:material_id para não ser capturada pelo parâmetro dinâmico
router.get('/materiais-com-entrada', async (req, res) => {
    try {
        const db = getDatabase();
        const { search, status } = req.query;
        
        // ★★★ QUERY 1: Buscar em estoque_materias_primas + movimentacao_materias_primas ★★★
        // Apenas materiais que tiveram ENTRADA registrada na tabela de movimentações
        let sql = `
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
        
        const params = [];
        
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
        
        let materiais = [];
        
        try {
            const [rows] = await db.query(sql, params);
            materiais = rows;
        } catch (e) {
            console.log('Tabela estoque_materias_primas não encontrada, tentando materias_primas...');
            
            // ★★★ QUERY 2: Fallback para tabela materias_primas ★★★
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
            
            try {
                const [rows2] = await db.query(sql, params);
                materiais = rows2;
            } catch (e2) {
                console.log('Tabela materias_primas não encontrada, tentando materiais...');
                
                // ★★★ QUERY 3: Fallback para tabela materiais + estoque ★★★
                sql = `
                    SELECT DISTINCT 
                        m.id,
                        m.codigo_material as codigo,
                        m.descricao,
                        m.unidade_medida as unidade,
                        m.estoque_minimo as estoque_min,
                        m.estoque_maximo as estoque_max,
                        COALESCE(e.quantidade_atual, 0) as estoque_atual,
                        NULL as localizacao,
                        m.tipo as categoria,
                        COALESCE(e.updated_at, NULL) as updated_at,
                        CASE 
                            WHEN COALESCE(e.quantidade_atual, 0) = 0 THEN 'critico'
                            WHEN COALESCE(e.quantidade_atual, 0) < m.estoque_minimo THEN 'baixo'
                            ELSE 'adequado'
                        END as status
                    FROM materiais m
                    LEFT JOIN estoque e ON e.material_id = m.id
                    WHERE EXISTS (
                        SELECT 1 FROM movimentacoes_estoque me 
                        WHERE me.material_id = m.id 
                        AND (me.tipo_movimentacao = 'entrada' OR me.tipo_movimentacao = 'ENTRADA')
                    )
                `;
                
                if (search) {
                    sql += ' AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)';
                }
                
                sql += ' ORDER BY m.descricao';
                
                try {
                    const [rows3] = await db.query(sql, params);
                    materiais = rows3;
                } catch (e3) {
                    console.error('Nenhuma tabela de materiais encontrada:', e3.message);
                    materiais = [];
                }
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
    } catch (error) {
        console.error('Erro ao buscar materiais com entrada:', error);
        res.status(500).json({ error: 'Erro ao buscar materiais' });
    }
});

// ============ REGISTRAR MOVIMENTAÇÃO ============
router.post('/movimentacao', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            material_id,
            tipo_movimentacao, // 'entrada' ou 'saida'
            quantidade,
            motivo,
            documento,
            observacoes
        } = req.body;
        
        // Usar usuario_id do token autenticado, não do body (previne spoofing)
        const usuario_id = req.user ? req.user.id : null;
        
        if (!material_id || !tipo_movimentacao || !quantidade) {
            await connection.rollback();
            return res.status(400).json({ error: 'Material, tipo de movimentação e quantidade são obrigatórios' });
        }
        
        const qtdNum = parseFloat(quantidade);
        if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Quantidade deve ser um número positivo' });
        }
        
        if (!['entrada', 'saida'].includes(tipo_movimentacao)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Tipo de movimentação inválido. Use "entrada" ou "saida"' });
        }
        
        // AUDIT-FIX S1.2: FOR UPDATE lock para evitar race condition em movimentação
        const [estoqueAtual] = await connection.query(
            'SELECT quantidade_atual FROM estoque WHERE material_id = ? FOR UPDATE',
            [material_id]
        );
        
        let quantidade_atual = 0;
        
        if (estoqueAtual.length === 0) {
            // Criar registro de estoque se não existir
            await connection.query(
                'INSERT INTO estoque (material_id, quantidade_atual) VALUES (?, 0)',
                [material_id]
            );
        } else {
            quantidade_atual = estoqueAtual[0].quantidade_atual;
        }
        
        // Calcular nova quantidade
        let nova_quantidade;
        if (tipo_movimentacao === 'entrada') {
            nova_quantidade = quantidade_atual + quantidade;
        } else {
            if (quantidade_atual < quantidade) {
                await connection.rollback();
                return res.status(400).json({ 
                    error: 'Quantidade insuficiente em estoque',
                    estoque_atual: quantidade_atual,
                    quantidade_solicitada: quantidade
                });
            }
            nova_quantidade = quantidade_atual - quantidade;
        }
        
        // Atualizar estoque
        await connection.query(
            'UPDATE estoque SET quantidade_atual = ? WHERE material_id = ?',
            [nova_quantidade, material_id]
        );
        
        // Registrar movimentação
        await connection.query(
            `INSERT INTO movimentacoes_estoque (
                material_id, tipo_movimentacao, quantidade, 
                saldo_anterior, saldo_atual, motivo, documento,
                observacoes, usuario_id, data_movimentacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                material_id,
                tipo_movimentacao,
                quantidade,
                quantidade_atual,
                nova_quantidade,
                motivo,
                documento,
                observacoes,
                usuario_id
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Movimentação registrada com sucesso',
            saldo_anterior: quantidade_atual,
            saldo_atual: nova_quantidade
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao registrar movimentação:', error);
        res.status(500).json({ error: 'Erro ao registrar movimentação' });
    } finally {
        connection.release();
    }
});

// ============ LISTAR MOVIMENTAÇÕES (rota simplificada) ============
router.get('/movimentacoes', async (req, res) => {
    try {
        const db = getDatabase();
        const { limit = 100, offset = 0 } = req.query;
        
        // Primeiro tenta na tabela movimentacao_materias_primas
        let movimentacoes = [];
        
        try {
            const [rows] = await db.query(`
                SELECT 
                    m.id,
                    m.tipo_movimentacao as tipo,
                    m.quantidade,
                    m.destino,
                    m.documento,
                    m.observacao,
                    m.created_at,
                    mp.descricao as material_descricao,
                    mp.codigo as material_codigo
                FROM movimentacao_materias_primas m
                LEFT JOIN estoque_materias_primas mp ON m.material_id = mp.id
                ORDER BY m.created_at DESC
                LIMIT ? OFFSET ?
            `, [parseInt(limit), parseInt(offset)]);
            movimentacoes = rows;
        } catch (e) {
            // Fallback para movimentacoes_estoque
            try {
                const [rows2] = await db.query(`
                    SELECT 
                        m.id,
                        m.tipo_movimentacao as tipo,
                        m.quantidade,
                        m.destino,
                        m.documento,
                        m.observacao,
                        m.data_movimentacao as created_at,
                        mat.descricao as material_descricao,
                        mat.codigo as material_codigo
                    FROM movimentacoes_estoque m
                    LEFT JOIN materiais mat ON m.material_id = mat.id
                    ORDER BY m.data_movimentacao DESC
                    LIMIT ? OFFSET ?
                `, [parseInt(limit), parseInt(offset)]);
                movimentacoes = rows2;
            } catch (e2) {
                console.log('Nenhuma tabela de movimentações encontrada');
            }
        }
        
        res.json({ movimentacoes });
    } catch (error) {
        console.error('Erro ao listar movimentações:', error);
        res.status(500).json({ error: 'Erro ao buscar movimentações' });
    }
});

// ============ HISTÓRICO DE MOVIMENTAÇÕES ============
router.get('/movimentacoes/historico', async (req, res) => {
    try {
        const db = getDatabase();
        const { material_id, tipo_movimentacao, data_inicio, data_fim, limit = 100, offset = 0 } = req.query;
        
        let sql = `SELECT m.*, mat.codigo, mat.descricao
                   FROM movimentacoes_estoque m
                   INNER JOIN materiais mat ON m.material_id = mat.id
                   WHERE 1=1`;
        const params = [];
        
        if (material_id) {
            sql += ' AND m.material_id = ?';
            params.push(material_id);
        }
        
        if (tipo_movimentacao) {
            sql += ' AND m.tipo_movimentacao = ?';
            params.push(tipo_movimentacao);
        }
        
        if (data_inicio) {
            sql += ' AND m.data_movimentacao >= ?';
            params.push(data_inicio);
        }
        
        if (data_fim) {
            sql += ' AND m.data_movimentacao <= ?';
            params.push(data_fim);
        }
        
        sql += ' ORDER BY m.data_movimentacao DESC LIMIT ? OFFSET ?';
        const parsedLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
        const parsedOffset = Math.max(parseInt(offset) || 0, 0);
        params.push(parsedLimit, parsedOffset);
        
        const [movimentacoes] = await db.query(sql, params);
        
        res.json({ movimentacoes });
    } catch (error) {
        console.error('Erro ao listar movimentações:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

// ============ AJUSTAR ESTOQUE (INVENTÁRIO) ============
router.post('/ajuste', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            material_id,
            quantidade_contada,
            motivo = 'Ajuste de inventário',
            observacoes
        } = req.body;
        
        // Usar usuario_id do token autenticado, não do body (previne spoofing)
        const usuario_id = req.user ? req.user.id : null;
        
        if (!material_id || quantidade_contada === undefined) {
            await connection.rollback();
            return res.status(400).json({ error: 'Material e quantidade contada são obrigatórios' });
        }
        
        const qtdContada = parseFloat(quantidade_contada);
        if (!Number.isFinite(qtdContada) || qtdContada < 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Quantidade contada deve ser um número >= 0' });
        }
        
        // AUDIT-FIX S1.2: FOR UPDATE lock para evitar race condition em ajuste
        const [estoqueAtual] = await connection.query(
            'SELECT quantidade_atual FROM estoque WHERE material_id = ? FOR UPDATE',
            [material_id]
        );
        
        if (estoqueAtual.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Material não encontrado no estoque' });
        }
        
        const quantidade_atual = estoqueAtual[0].quantidade_atual;
        const diferenca = qtdContada - quantidade_atual;
        
        // Atualizar estoque
        await connection.query(
            'UPDATE estoque SET quantidade_atual = ? WHERE material_id = ?',
            [qtdContada, material_id]
        );
        
        // Registrar movimentação de ajuste
        const tipo_movimentacao = diferenca >= 0 ? 'entrada' : 'saida';
        const quantidade_movimento = Math.abs(diferenca);
        
        await connection.query(
            `INSERT INTO movimentacoes_estoque (
                material_id, tipo_movimentacao, quantidade, 
                saldo_anterior, saldo_atual, motivo, observacoes,
                usuario_id, data_movimentacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                material_id,
                tipo_movimentacao,
                quantidade_movimento,
                quantidade_atual,
                quantidade_contada,
                motivo,
                `Ajuste: ${observacoes || 'Inventário'}. Diferença: ${diferenca}`,
                usuario_id
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Estoque ajustado com sucesso',
            saldo_anterior: quantidade_atual,
            saldo_atual: quantidade_contada,
            diferenca
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao ajustar estoque:', error);
        res.status(500).json({ error: 'Erro ao ajustar estoque' });
    } finally {
        connection.release();
    }
});

// ============ ALERTAS DE ESTOQUE BAIXO ============
router.get('/alertas/estoque-baixo', async (req, res) => {
    try {
        const db = getDatabase();
        
        const [alertas] = await db.query(
            `SELECT e.*, m.codigo_material, m.descricao, m.unidade_medida,
                    m.estoque_minimo, m.estoque_maximo,
                    (m.estoque_minimo - e.quantidade_atual) as quantidade_faltante
             FROM estoque e
             INNER JOIN materiais m ON e.material_id = m.id
             WHERE e.quantidade_atual < m.estoque_minimo
             ORDER BY (m.estoque_minimo - e.quantidade_atual) DESC`
        );
        
        res.json({ alertas, total: alertas.length });
    } catch (error) {
        console.error('Erro ao buscar alertas:', error);
        res.status(500).json({ error: 'Erro ao buscar alertas de estoque' });
    }
});

// ============ OBTER ESTOQUE DE UM MATERIAL ============
// IMPORTANTE: /:material_id DEVE vir DEPOIS de todas as rotas estáticas
// para não capturar /movimentacoes, /alertas, etc.
router.get('/:material_id', async (req, res) => {
    try {
        const db = getDatabase();
        const [estoque] = await db.query(
            `SELECT e.*, m.codigo_material, m.descricao, m.unidade_medida,
                    m.estoque_minimo, m.estoque_maximo
             FROM estoque e
             INNER JOIN materiais m ON e.material_id = m.id
             WHERE e.material_id = ?`,
            [req.params.material_id]
        );
        
        if (estoque.length === 0) {
            return res.status(404).json({ error: 'Estoque não encontrado para este material' });
        }
        
        res.json(estoque[0]);
    } catch (error) {
        console.error('Erro ao obter estoque:', error);
        res.status(500).json({ error: 'Erro ao buscar estoque' });
    }
});

// ============ MATERIAIS PCP - GESTÃO ============
router.get('/materiais-pcp', async (req, res) => {
    try {
        const db = getDatabase();
        const { busca, search, tipo, ativo, page = 1, limit = 50 } = req.query;
        const searchTerm = busca || search || '';
        const offset = (parseInt(page) - 1) * parseInt(limit);
        let where = '1=1';
        const params = [];

        if (searchTerm) {
            where += ' AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)';
            params.push(`%${searchTerm}%`, `%${searchTerm}%`);
        }
        if (tipo && tipo !== 'todos') {
            if (tipo === 'sem_tipo') {
                where += ' AND (m.tipo IS NULL OR m.tipo = "")';
            } else {
                where += ' AND m.tipo = ?';
                params.push(tipo);
            }
        }
        if (ativo !== undefined && ativo !== '') {
            where += ' AND m.ativo = ?';
            params.push(parseInt(ativo));
        }

        const [countResult] = await db.query(`SELECT COUNT(*) as total FROM materiais m WHERE ${where}`, params);
        const total = countResult[0].total;

        const [materiais] = await db.query(`
            SELECT m.id, m.codigo_material, m.descricao, m.unidade_medida, m.tipo, m.ativo,
                   m.custo_unitario, m.quantidade_estoque, m.estoque_minimo, m.ncm
            FROM materiais m WHERE ${where}
            ORDER BY m.ativo DESC, m.descricao ASC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [tipos] = await db.query(`
            SELECT COALESCE(tipo, 'sem_tipo') as tipo, COUNT(*) as count
            FROM materiais GROUP BY COALESCE(tipo, 'sem_tipo') ORDER BY count DESC
        `);

        const [stats] = await db.query(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN ativo = 1 THEN 1 ELSE 0 END) as ativos,
                   SUM(CASE WHEN ativo = 0 THEN 1 ELSE 0 END) as inativos
            FROM materiais
        `);

        res.json({
            materiais,
            tipos,
            stats: stats[0],
            paginacao: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (err) {
        console.error('[COMPRAS] Erro ao listar materiais PCP:', err);
        res.status(500).json({ message: 'Erro ao listar materiais PCP' });
    }
});

router.put('/materiais-pcp/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const { id } = req.params;
        const { descricao, unidade_medida, tipo, ativo, custo_unitario, quantidade_estoque, estoque_minimo, ncm } = req.body;
        const fields = [];
        const values = [];
        if (descricao !== undefined) { fields.push('descricao = ?'); values.push(descricao); }
        if (unidade_medida !== undefined) { fields.push('unidade_medida = ?'); values.push(unidade_medida); }
        if (tipo !== undefined) { fields.push('tipo = ?'); values.push(tipo); }
        if (ativo !== undefined) { fields.push('ativo = ?'); values.push(parseInt(ativo)); }
        if (custo_unitario !== undefined) { fields.push('custo_unitario = ?'); values.push(parseFloat(custo_unitario)); }
        if (quantidade_estoque !== undefined) { fields.push('quantidade_estoque = ?'); values.push(parseFloat(quantidade_estoque)); }
        if (estoque_minimo !== undefined) { fields.push('estoque_minimo = ?'); values.push(parseFloat(estoque_minimo)); }
        if (ncm !== undefined) { fields.push('ncm = ?'); values.push(ncm); }
        if (!fields.length) return res.status(400).json({ message: 'Nenhum campo para atualizar' });
        values.push(id);
        await db.query(`UPDATE materiais SET ${fields.join(', ')} WHERE id = ?`, values);
        res.json({ success: true, message: 'Material atualizado' });
    } catch (err) {
        console.error('[COMPRAS] Erro ao atualizar material PCP:', err);
        res.status(500).json({ message: 'Erro ao atualizar material' });
    }
});

router.post('/materiais-pcp/bulk-toggle', async (req, res) => {
    try {
        const db = getDatabase();
        const { ids, ativo } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ message: 'IDs obrigatórios' });
        await db.query(`UPDATE materiais SET ativo = ? WHERE id IN (?)`, [parseInt(ativo), ids]);
        res.json({ success: true, message: `${ids.length} materiais atualizados` });
    } catch (err) {
        console.error('[COMPRAS] Erro bulk-toggle:', err);
        res.status(500).json({ message: 'Erro ao atualizar materiais' });
    }
});

router.post('/materiais-pcp/bulk-delete', async (req, res) => {
    try {
        const db = getDatabase();
        const { ids } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ message: 'IDs obrigatórios' });
        await db.query(`DELETE FROM materiais WHERE id IN (?)`, [ids]);
        res.json({ success: true, message: `${ids.length} materiais excluídos` });
    } catch (err) {
        console.error('[COMPRAS] Erro bulk-delete:', err);
        res.status(500).json({ message: 'Erro ao excluir materiais' });
    }
});

router.post('/materiais-pcp/criar', async (req, res) => {
    try {
        const db = getDatabase();
        const { codigo_material, descricao, unidade_medida, tipo, custo_unitario, quantidade_estoque, estoque_minimo, ncm } = req.body;
        if (!descricao) return res.status(400).json({ message: 'Descrição é obrigatória' });
        const [result] = await db.query(
            `INSERT INTO materiais (codigo_material, descricao, unidade_medida, tipo, custo_unitario, quantidade_estoque, estoque_minimo, ncm, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [codigo_material || null, descricao, unidade_medida || 'UN', tipo || null, parseFloat(custo_unitario) || 0, parseFloat(quantidade_estoque) || 0, parseFloat(estoque_minimo) || 0, ncm || null]
        );
        res.json({ success: true, id: result.insertId, message: 'Material criado' });
    } catch (err) {
        console.error('[COMPRAS] Erro ao criar material:', err);
        res.status(500).json({ message: 'Erro ao criar material' });
    }
});

module.exports = router;
