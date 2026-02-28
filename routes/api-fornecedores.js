// =================================================================
// ROTAS API FORNECEDORES - ALUFORCE v2.0
// CRUD de fornecedores (auto-criados via NF Entrada ou manual)
// =================================================================
'use strict';

const express = require('express');
const router = express.Router();

function createFornecedoresRouter(pool, authenticateToken) {

    /**
     * GET /api/fornecedores
     * Lista fornecedores com busca
     */
    router.get('/', authenticateToken, async (req, res) => {
        try {
            const { busca, uf, ativo, pagina = 1, limite = 50 } = req.query;
            let query = 'SELECT * FROM fornecedores WHERE 1=1';
            const params = [];

            if (busca) {
                query += ' AND (cnpj LIKE ? OR razao_social LIKE ? OR nome_fantasia LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
            }
            if (uf) {
                query += ' AND uf = ?';
                params.push(uf.toUpperCase());
            }
            if (ativo !== undefined) {
                query += ' AND ativo = ?';
                params.push(parseInt(ativo));
            }

            const countQuery = query.replace('SELECT * FROM', 'SELECT COUNT(*) as total FROM');
            const [countRows] = await pool.query(countQuery, params);
            const total = countRows[0].total;

            query += ' ORDER BY razao_social LIMIT ? OFFSET ?';
            params.push(parseInt(limite), (parseInt(pagina) - 1) * parseInt(limite));

            const [rows] = await pool.query(query, params);
            res.json({ total, pagina: parseInt(pagina), limite: parseInt(limite), fornecedores: rows });
        } catch (error) {
            console.error('❌ Erro ao listar fornecedores:', error);
            res.status(500).json({ error: 'Erro ao listar fornecedores' });
        }
    });

    /**
     * GET /api/fornecedores/:id
     */
    router.get('/:id', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [req.params.id]);
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Fornecedor não encontrado' });
            }

            // Total de NFs desse fornecedor
            const [nfs] = await pool.query(
                'SELECT COUNT(*) as total, SUM(valor_total) as valor FROM nf_entrada WHERE fornecedor_cnpj = ?',
                [rows[0].cnpj]
            );

            res.json({ ...rows[0], total_nfs: nfs[0].total || 0, valor_total_nfs: nfs[0].valor || 0 });
        } catch (error) {
            console.error('❌ Erro ao buscar fornecedor:', error);
            res.status(500).json({ error: 'Erro ao buscar fornecedor' });
        }
    });

    /**
     * POST /api/fornecedores
     */
    router.post('/', authenticateToken, async (req, res) => {
        try {
            const {
                cnpj, razao_social, nome_fantasia, inscricao_estadual,
                uf, cidade, codigo_municipio, endereco, numero, complemento,
                bairro, cep, telefone, email, contato
            } = req.body;

            if (!cnpj || !razao_social) {
                return res.status(400).json({ error: 'CNPJ e razão social são obrigatórios' });
            }

            const [existe] = await pool.query('SELECT id FROM fornecedores WHERE cnpj = ?', [cnpj]);
            if (existe.length > 0) {
                return res.status(400).json({ error: 'Fornecedor já cadastrado', id: existe[0].id });
            }

            const [result] = await pool.query(`
                INSERT INTO fornecedores (
                    cnpj, razao_social, nome_fantasia, inscricao_estadual,
                    uf, cidade, codigo_municipio, endereco, numero, complemento,
                    bairro, cep, telefone, email, contato
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                cnpj, razao_social, nome_fantasia || razao_social, inscricao_estadual || '',
                uf || '', cidade || '', codigo_municipio || '', endereco || '', numero || '', complemento || '',
                bairro || '', cep || '', telefone || '', email || '', contato || ''
            ]);

            res.status(201).json({ success: true, id: result.insertId, message: 'Fornecedor criado' });
        } catch (error) {
            console.error('❌ Erro ao criar fornecedor:', error);
            res.status(500).json({ error: 'Erro ao criar fornecedor' });
        }
    });

    /**
     * PUT /api/fornecedores/:id
     */
    router.put('/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const {
                razao_social, nome_fantasia, inscricao_estadual,
                uf, cidade, codigo_municipio, endereco, numero, complemento,
                bairro, cep, telefone, email, contato, ativo
            } = req.body;

            await pool.query(`
                UPDATE fornecedores SET
                    razao_social = COALESCE(?, razao_social),
                    nome_fantasia = COALESCE(?, nome_fantasia),
                    inscricao_estadual = COALESCE(?, inscricao_estadual),
                    uf = COALESCE(?, uf),
                    cidade = COALESCE(?, cidade),
                    codigo_municipio = COALESCE(?, codigo_municipio),
                    endereco = COALESCE(?, endereco),
                    numero = COALESCE(?, numero),
                    complemento = COALESCE(?, complemento),
                    bairro = COALESCE(?, bairro),
                    cep = COALESCE(?, cep),
                    telefone = COALESCE(?, telefone),
                    email = COALESCE(?, email),
                    contato = COALESCE(?, contato),
                    ativo = COALESCE(?, ativo),
                    updated_at = NOW()
                WHERE id = ?
            `, [
                razao_social, nome_fantasia, inscricao_estadual,
                uf, cidade, codigo_municipio, endereco, numero, complemento,
                bairro, cep, telefone, email, contato,
                ativo !== undefined ? parseInt(ativo) : null,
                id
            ]);

            res.json({ success: true, message: 'Fornecedor atualizado' });
        } catch (error) {
            console.error('❌ Erro ao atualizar fornecedor:', error);
            res.status(500).json({ error: 'Erro ao atualizar fornecedor' });
        }
    });

    return router;
}

module.exports = createFornecedoresRouter;
