const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR MATERIAIS ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { search, categoria, status, limit = 100, offset = 0 } = req.query;
        
        let sql = `SELECT m.*, c.nome as categoria_nome 
                   FROM materiais m 
                   LEFT JOIN categorias_material c ON m.categoria_id = c.id 
                   WHERE 1=1`;
        const params = [];
        
        if (search) {
            sql += ' AND (m.codigo LIKE ? OR m.descricao LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam);
        }
        
        if (categoria) {
            sql += ' AND m.categoria_id = ?';
            params.push(categoria);
        }
        
        if (status) {
            sql += ' AND m.status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY m.descricao LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [materiais] = await db.execute(sql, params);
        
        const countSql = `SELECT COUNT(*) as total FROM materiais m WHERE 1=1` +
            (search ? ' AND (m.codigo LIKE ? OR m.descricao LIKE ?)' : '') +
            (categoria ? ' AND m.categoria_id = ?' : '') +
            (status ? ' AND m.status = ?' : '');
        const countParams = [];
        if (search) {
            const searchParam = `%${search}%`;
            countParams.push(searchParam, searchParam);
        }
        if (categoria) countParams.push(categoria);
        if (status) countParams.push(status);
        
        const [countResult] = await db.execute(countSql, countParams);
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
        const [materiais] = await db.execute(
            `SELECT m.*, c.nome as categoria_nome 
             FROM materiais m 
             LEFT JOIN categorias_material c ON m.categoria_id = c.id 
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
        const [existente] = await db.execute(
            'SELECT id FROM materiais WHERE codigo = ?',
            [codigo]
        );
        
        if (existente.length > 0) {
            return res.status(400).json({ error: 'Código já cadastrado' });
        }
        
        const [result] = await db.execute(
            `INSERT INTO materiais (
                codigo, descricao, categoria_id, unidade_medida,
                estoque_minimo, estoque_maximo, preco_medio,
                fornecedor_preferencial_id, status, observacoes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                codigo,
                descricao,
                categoria_id,
                unidade_medida,
                estoque_minimo || 0,
                estoque_maximo || 0,
                preco_medio || 0,
                fornecedor_preferencial_id,
                status,
                observacoes
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
        const [materiais] = await db.execute(
            'SELECT id FROM materiais WHERE id = ?',
            [req.params.id]
        );
        
        if (materiais.length === 0) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }
        
        // Verificar se código já existe em outro material
        if (codigo) {
            const [existente] = await db.execute(
                'SELECT id FROM materiais WHERE codigo = ? AND id != ?',
                [codigo, req.params.id]
            );
            
            if (existente.length > 0) {
                return res.status(400).json({ error: 'Código já cadastrado em outro material' });
            }
        }
        
        await db.execute(
            `UPDATE materiais SET 
                codigo = COALESCE(?, codigo),
                descricao = COALESCE(?, descricao),
                categoria_id = COALESCE(?, categoria_id),
                unidade_medida = COALESCE(?, unidade_medida),
                estoque_minimo = COALESCE(?, estoque_minimo),
                estoque_maximo = COALESCE(?, estoque_maximo),
                preco_medio = COALESCE(?, preco_medio),
                fornecedor_preferencial_id = COALESCE(?, fornecedor_preferencial_id),
                status = COALESCE(?, status),
                observacoes = COALESCE(?, observacoes)
            WHERE id = ?`,
            [
                codigo,
                descricao,
                categoria_id,
                unidade_medida,
                estoque_minimo,
                estoque_maximo,
                preco_medio,
                fornecedor_preferencial_id,
                status,
                observacoes,
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
        await db.execute(
            "UPDATE materiais SET status = 'inativo' WHERE id = ?",
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
        const [categorias] = await db.execute(
            'SELECT * FROM categorias_material ORDER BY nome'
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
        
        const [result] = await db.execute(
            'INSERT INTO categorias_material (nome, descricao) VALUES (?, ?)',
            [nome, descricao]
        );
        
        res.status(201).json({
            success: true,
            message: 'Categoria criada com sucesso',
            categoria_id: result.insertId
        });
    } catch (error) {
        console.error('Erro ao criar categoria:', error);
        res.status(500).json({ error: 'Erro ao criar categoria', message: error.message });
    }
});

module.exports = router;
