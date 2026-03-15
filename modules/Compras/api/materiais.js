const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR MATERIAIS ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { search, categoria, status, limit = 100, offset = 0 } = req.query;
        
        let sql = `SELECT m.* 
                   FROM materiais m 
                   WHERE 1=1`;
        const params = [];
        
        if (search) {
            sql += ' AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam);
        }
        
        if (categoria) {
            sql += ' AND m.tipo = ?';
            params.push(categoria);
        }
        
        if (status) {
            sql += ' AND m.ativo = ?';
            params.push(status === 'ativo' ? 1 : 0);
        }
        
        sql += ' ORDER BY m.descricao LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [materiais] = await db.query(sql, params);
        
        const countSql = `SELECT COUNT(*) as total FROM materiais m WHERE 1=1` +
            (search ? ' AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)' : '') +
            (categoria ? ' AND m.tipo = ?' : '') +
            (status ? ' AND m.ativo = ?' : '');
        const countParams = [];
        if (search) {
            const searchParam = `%${search}%`;
            countParams.push(searchParam, searchParam);
        }
        if (categoria) countParams.push(categoria);
        if (status) countParams.push(status === 'ativo' ? 1 : 0);
        
        const [countResult] = await db.query(countSql, countParams);
        const total = countResult[0].total;
        
        res.json({
            materiais,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar materiais:', error);
        res.status(500).json({ error: 'Erro ao buscar materiais', message: error.message });
    }
});

// ============ OBTER MATERIAL ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [materiais] = await db.query(
            `SELECT m.* 
             FROM materiais m 
             WHERE m.id = ?`,
            [req.params.id]
        );
        
        if (materiais.length === 0) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        
        res.json(materiais[0]);
    } catch (error) {
        console.error('Erro ao obter material:', error);
        res.status(500).json({ error: 'Erro ao buscar material', message: error.message });
    }
});

// ============ CRIAR MATERIAL ============
router.post('/', async (req, res) => {
    try {
        const db = getDatabase();
        const {
            codigo,
            descricao,
            categoria_id,
            unidade_medida,
            estoque_minimo,
            estoque_maximo,
            preco_medio,
            fornecedor_preferencial_id,
            status = 'ativo',
            observacoes
        } = req.body;
        
        if (!codigo || !descricao || !unidade_medida) {
            return res.status(400).json({ error: 'Código, descrição e unidade de medida são obrigatórios' });
        }
        
        // Verificar se código já existe
        const [existente] = await db.query(
            'SELECT id FROM materiais WHERE codigo_material = ?',
            [codigo]
        );
        
        if (existente.length > 0) {
            return res.status(400).json({ error: 'Código já cadastrado' });
        }
        
        const [result] = await db.query(
            `INSERT INTO materiais (
                codigo_material, descricao, unidade_medida,
                estoque_minimo, estoque_maximo, custo_unitario,
                tipo, ativo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                codigo,
                descricao,
                unidade_medida,
                estoque_minimo || 0,
                estoque_maximo || 0,
                preco_medio || 0,
                categoria_id || null,
                status === 'inativo' ? 0 : 1
            ]
        );
        
        res.status(201).json({
            success: true,
            message: 'Material criado com sucesso',
            material_id: result.insertId
        });
    } catch (error) {
        console.error('Erro ao criar material:', error);
        res.status(500).json({ error: 'Erro ao criar material', message: error.message });
    }
});

// ============ ATUALIZAR MATERIAL ============
router.put('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const {
            codigo,
            descricao,
            categoria_id,
            unidade_medida,
            estoque_minimo,
            estoque_maximo,
            preco_medio,
            fornecedor_preferencial_id,
            status,
            observacoes
        } = req.body;
        
        // Verificar se material existe
        const [materiais] = await db.query(
            'SELECT id FROM materiais WHERE id = ?',
            [req.params.id]
        );
        
        if (materiais.length === 0) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        
        // Verificar se código já existe em outro material
        if (codigo) {
            const [existente] = await db.query(
                'SELECT id FROM materiais WHERE codigo_material = ? AND id != ?',
                [codigo, req.params.id]
            );
            
            if (existente.length > 0) {
                return res.status(400).json({ error: 'Código já cadastrado em outro material' });
            }
        }
        
        await db.query(
            `UPDATE materiais SET 
                codigo_material = COALESCE(?, codigo_material),
                descricao = COALESCE(?, descricao),
                unidade_medida = COALESCE(?, unidade_medida),
                estoque_minimo = COALESCE(?, estoque_minimo),
                estoque_maximo = COALESCE(?, estoque_maximo),
                custo_unitario = COALESCE(?, custo_unitario),
                tipo = COALESCE(?, tipo)
            WHERE id = ?`,
            [
                codigo,
                descricao,
                unidade_medida,
                estoque_minimo,
                estoque_maximo,
                preco_medio,
                categoria_id,
                req.params.id
            ]
        );
        
        res.json({
            success: true,
            message: 'Material atualizado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao atualizar material:', error);
        res.status(500).json({ error: 'Erro ao atualizar material', message: error.message });
    }
});

// ============ DELETAR MATERIAL ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        // Marcar como inativo ao invés de deletar
        await db.query(
            "UPDATE materiais SET ativo = 0 WHERE id = ?",
            [req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Material inativado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao deletar material:', error);
        res.status(500).json({ error: 'Erro ao deletar material', message: error.message });
    }
});

// ============ LISTAR CATEGORIAS ============
router.get('/categorias/list', async (req, res) => {
    try {
        const db = getDatabase();
        const [categorias] = await db.query(
            'SELECT DISTINCT tipo as id, tipo as nome FROM materiais WHERE tipo IS NOT NULL ORDER BY tipo'
        );
        
        res.json({ categorias });
    } catch (error) {
        console.error('Erro ao listar categorias:', error);
        res.status(500).json({ error: 'Erro ao buscar categorias', message: error.message });
    }
});

// ============ CRIAR CATEGORIA ============
router.post('/categorias', async (req, res) => {
    try {
        const db = getDatabase();
        const { nome, descricao } = req.body;
        
        if (!nome) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }
        
        const [result] = await db.query(
            'SELECT DISTINCT tipo as nome FROM materiais WHERE tipo = ?',
            [nome]
        );
        
        if (result.length > 0) {
            return res.status(400).json({ error: 'Categoria já existe' });
        }
        
        res.status(201).json({
            success: true,
            message: 'Categoria registrada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao criar categoria:', error);
        res.status(500).json({ error: 'Erro ao criar categoria', message: error.message });
    }
});

module.exports = router;
