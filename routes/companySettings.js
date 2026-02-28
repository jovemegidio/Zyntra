/**
 * Company Settings Routes
 * Rotas para gerenciamento de configurações da empresa
 */

const express = require('express');
const router = express.Router();

// Esta função será chamada pelo server.js passando as dependências
module.exports = function({ pool, authenticateToken, requireAdmin }) {

// ============================================================
// EMPRESA CONFIG
// ============================================================

/**
 * GET /api/empresa-config
 * Retorna as configurações da empresa
 */
router.get('/empresa-config', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM empresa_config WHERE id = 1'
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Configurações não encontradas' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Erro ao buscar configurações:', error);
        res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
});

/**
 * PUT /api/empresa-config
 * Atualiza as configurações da empresa (somente admin)
 */
router.put('/empresa-config', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            razao_social,
            nome_fantasia,
            cnpj,
            inscricao_estadual,
            inscricao_municipal,
            telefone,
            email,
            site,
            endereco,
            numero,
            complemento,
            bairro,
            cidade,
            estado,
            cep,
            logo_path,
            favicon_path,
            // Campos fiscais Fase 1
            regime_tributario,
            codigo_municipio,
            codigo_uf,
            cnae,
            suframa,
            nfe_ambiente,
            nfe_serie,
            nfe_csc_id,
            nfe_csc_token
        } = req.body;

        // Calcular CRT a partir do regime
        let crt = 1; // Default: Simples Nacional
        if (regime_tributario === 'simples_excesso') crt = 2;
        else if (regime_tributario === 'normal') crt = 3;

        const [result] = await pool.execute(`
            UPDATE empresa_config 
            SET 
                razao_social = ?,
                nome_fantasia = ?,
                cnpj = ?,
                inscricao_estadual = ?,
                inscricao_municipal = ?,
                telefone = ?,
                email = ?,
                site = ?,
                endereco = ?,
                numero = ?,
                complemento = ?,
                bairro = ?,
                cidade = ?,
                estado = ?,
                cep = ?,
                logo_path = ?,
                favicon_path = ?,
                regime_tributario = COALESCE(?, regime_tributario),
                crt = COALESCE(?, crt),
                codigo_municipio = COALESCE(?, codigo_municipio),
                codigo_uf = COALESCE(?, codigo_uf),
                cnae = COALESCE(?, cnae),
                suframa = COALESCE(?, suframa),
                nfe_ambiente = COALESCE(?, nfe_ambiente),
                nfe_serie = COALESCE(?, nfe_serie),
                nfe_csc_id = COALESCE(?, nfe_csc_id),
                nfe_csc_token = COALESCE(?, nfe_csc_token),
                updated_by = ?
            WHERE id = 1
        `, [
            razao_social,
            nome_fantasia,
            cnpj,
            inscricao_estadual,
            inscricao_municipal,
            telefone,
            email,
            site,
            endereco,
            numero,
            complemento,
            bairro,
            cidade,
            estado,
            cep,
            logo_path,
            favicon_path,
            regime_tributario || null,
            regime_tributario ? crt : null,
            codigo_municipio || null,
            codigo_uf || null,
            cnae || null,
            suframa || null,
            nfe_ambiente != null ? nfe_ambiente : null,
            nfe_serie != null ? nfe_serie : null,
            nfe_csc_id || null,
            nfe_csc_token || null,
            req.user.id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Configurações não encontradas' });
        }

        res.json({ 
            success: true, 
            message: 'Configurações atualizadas com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao atualizar configurações:', error);
        res.status(500).json({ error: 'Erro ao atualizar configurações' });
    }
});

// ============================================================
// CERTIFICADO DIGITAL
// ============================================================

/**
 * PUT /api/empresa-config/certificado
 * Atualiza dados do certificado digital
 */
router.put('/empresa-config/certificado', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            certificado_a1_path,
            certificado_senha,
            certificado_validade
        } = req.body;

        await pool.execute(`
            UPDATE empresa_config 
            SET 
                certificado_a1_path = ?,
                certificado_senha = ?,
                certificado_validade = ?,
                updated_by = ?
            WHERE id = 1
        `, [certificado_a1_path, certificado_senha, certificado_validade, req.user.id]);

        res.json({ 
            success: true, 
            message: 'Certificado atualizado com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao atualizar certificado:', error);
        res.status(500).json({ error: 'Erro ao atualizar certificado' });
    }
});

/**
 * PUT /api/empresa-config/nfe
 * Atualiza configurações de NF-e
 */
router.put('/empresa-config/nfe', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { nfe_agente_ativo } = req.body;

        await pool.execute(`
            UPDATE empresa_config 
            SET 
                nfe_agente_ativo = ?,
                nfe_agente_data_ativacao = IF(? = TRUE AND nfe_agente_ativo = FALSE, NOW(), nfe_agente_data_ativacao),
                updated_by = ?
            WHERE id = 1
        `, [nfe_agente_ativo, nfe_agente_ativo, req.user.id]);

        res.json({ 
            success: true, 
            message: 'Configuração de NF-e atualizada com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao atualizar NF-e:', error);
        res.status(500).json({ error: 'Erro ao atualizar NF-e' });
    }
});

// ============================================================
// CATEGORIAS
// ============================================================

/**
 * GET /api/categorias
 * Lista todas as categorias
 */
router.get('/categorias', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT c.*, f.nome as created_by_name
            FROM categorias c
            LEFT JOIN funcionarios f ON c.created_by = f.id
            ORDER BY c.ordem, c.nome
        `);
        
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar categorias:', error);
        res.status(500).json({ error: 'Erro ao buscar categorias' });
    }
});

/**
 * POST /api/categorias
 * Cria nova categoria (somente admin)
 */
router.post('/categorias', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { nome, descricao, cor, icone } = req.body;

        if (!nome) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }

        const [result] = await pool.execute(`
            INSERT INTO categorias (nome, descricao, cor, icone, created_by)
            VALUES (?, ?, ?, ?, ?)
        `, [nome, descricao, cor || '#3B82F6', icone || 'fa-folder', req.user.id]);

        res.status(201).json({ 
            success: true, 
            id: result.insertId,
            message: 'Categoria criada com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao criar categoria:', error);
        res.status(500).json({ error: 'Erro ao criar categoria' });
    }
});

/**
 * PUT /api/categorias/:id
 * Atualiza uma categoria (somente admin)
 */
router.put('/categorias/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, descricao, cor, icone, ativo } = req.body;

        const [result] = await pool.execute(`
            UPDATE categorias 
            SET nome = ?, descricao = ?, cor = ?, icone = ?, ativo = ?
            WHERE id = ?
        `, [nome, descricao, cor, icone, ativo, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Categoria não encontrada' });
        }

        res.json({ 
            success: true, 
            message: 'Categoria atualizada com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao atualizar categoria:', error);
        res.status(500).json({ error: 'Erro ao atualizar categoria' });
    }
});

/**
 * DELETE /api/categorias/:id
 * Remove uma categoria (somente admin)
 */
router.delete('/categorias/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.execute('DELETE FROM categorias WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Categoria não encontrada' });
        }

        res.json({ 
            success: true, 
            message: 'Categoria removida com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao remover categoria:', error);
        res.status(500).json({ error: 'Erro ao remover categoria' });
    }
});

// ============================================================
// DEPARTAMENTOS
// ============================================================

/**
 * GET /api/departamentos
 * Lista todos os departamentos
 */
router.get('/departamentos', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT d.*, f.nome as responsavel_nome
            FROM departamentos d
            LEFT JOIN funcionarios f ON d.responsavel_id = f.id
            ORDER BY d.ordem, d.nome
        `);
        
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar departamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar departamentos' });
    }
});

/**
 * POST /api/departamentos
 * Cria novo departamento (somente admin)
 */
router.post('/departamentos', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { nome, sigla, descricao, responsavel_id, cor, icone } = req.body;

        if (!nome) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }

        const [result] = await pool.execute(`
            INSERT INTO departamentos (nome, sigla, descricao, responsavel_id, cor, icone)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [nome, sigla, descricao, responsavel_id, cor || '#10B981', icone || 'fa-sitemap']);

        res.status(201).json({ 
            success: true, 
            id: result.insertId,
            message: 'Departamento criado com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao criar departamento:', error);
        res.status(500).json({ error: 'Erro ao criar departamento' });
    }
});

/**
 * PUT /api/departamentos/:id
 * Atualiza um departamento (somente admin)
 */
router.put('/departamentos/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, sigla, descricao, responsavel_id, cor, icone, ativo } = req.body;

        const [result] = await pool.execute(`
            UPDATE departamentos 
            SET nome = ?, sigla = ?, descricao = ?, responsavel_id = ?, cor = ?, icone = ?, ativo = ?
            WHERE id = ?
        `, [nome, sigla, descricao, responsavel_id, cor, icone, ativo, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Departamento não encontrado' });
        }

        res.json({ 
            success: true, 
            message: 'Departamento atualizado com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao atualizar departamento:', error);
        res.status(500).json({ error: 'Erro ao atualizar departamento' });
    }
});

/**
 * DELETE /api/departamentos/:id
 * Remove um departamento (somente admin)
 */
router.delete('/departamentos/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.execute('DELETE FROM departamentos WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Departamento não encontrado' });
        }

        res.json({ 
            success: true, 
            message: 'Departamento removido com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao remover departamento:', error);
        res.status(500).json({ error: 'Erro ao remover departamento' });
    }
});

// ============================================================
// PROJETOS
// ============================================================

/**
 * GET /api/projetos
 * Lista todos os projetos
 */
router.get('/projetos', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT 
                p.*,
                d.nome as departamento_nome,
                f.nome as responsavel_nome
            FROM projetos p
            LEFT JOIN departamentos d ON p.departamento_id = d.id
            LEFT JOIN funcionarios f ON p.responsavel_id = f.id
            ORDER BY p.created_at DESC
        `);
        
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar projetos:', error);
        res.status(500).json({ error: 'Erro ao buscar projetos' });
    }
});

/**
 * POST /api/projetos
 * Cria novo projeto (somente admin)
 */
router.post('/projetos', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            nome,
            codigo,
            descricao,
            departamento_id,
            responsavel_id,
            status,
            data_inicio,
            data_previsao_fim,
            orcamento,
            cor
        } = req.body;

        if (!nome) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }

        const [result] = await pool.execute(`
            INSERT INTO projetos (
                nome, codigo, descricao, departamento_id, responsavel_id,
                status, data_inicio, data_previsao_fim, orcamento, cor
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            nome, codigo, descricao, departamento_id, responsavel_id,
            status || 'planejamento', data_inicio, data_previsao_fim, orcamento, cor || '#8B5CF6'
        ]);

        res.status(201).json({ 
            success: true, 
            id: result.insertId,
            message: 'Projeto criado com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao criar projeto:', error);
        res.status(500).json({ error: 'Erro ao criar projeto' });
    }
});

/**
 * PUT /api/projetos/:id
 * Atualiza um projeto (somente admin)
 */
router.put('/projetos/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nome,
            codigo,
            descricao,
            departamento_id,
            responsavel_id,
            status,
            data_inicio,
            data_previsao_fim,
            data_fim_real,
            orcamento,
            cor,
            ativo
        } = req.body;

        const [result] = await pool.execute(`
            UPDATE projetos 
            SET 
                nome = ?,
                codigo = ?,
                descricao = ?,
                departamento_id = ?,
                responsavel_id = ?,
                status = ?,
                data_inicio = ?,
                data_previsao_fim = ?,
                data_fim_real = ?,
                orcamento = ?,
                cor = ?,
                ativo = ?
            WHERE id = ?
        `, [
            nome, codigo, descricao, departamento_id, responsavel_id,
            status, data_inicio, data_previsao_fim, data_fim_real,
            orcamento, cor, ativo, id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Projeto não encontrado' });
        }

        res.json({ 
            success: true, 
            message: 'Projeto atualizado com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao atualizar projeto:', error);
        res.status(500).json({ error: 'Erro ao atualizar projeto' });
    }
});

/**
 * DELETE /api/projetos/:id
 * Remove um projeto (somente admin)
 */
router.delete('/projetos/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.execute('DELETE FROM projetos WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Projeto não encontrado' });
        }

        res.json({ 
            success: true, 
            message: 'Projeto removido com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao remover projeto:', error);
        res.status(500).json({ error: 'Erro ao remover projeto' });
    }
});

return router;
};
