/**
 * API DE PERMISSÕES - ALUFORCE V.2
 * Gerenciamento de permissões de usuários
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/permissoes/perfis
 * Lista todos os perfis de permissão
 */
router.get('/perfis', async (req, res) => {
    try {
        const [perfis] = await pool.query(`
            SELECT * FROM perfis_permissao ORDER BY nome
        `);
        res.json({ success: true, data: perfis });
    } catch (error) {
        // Retornar perfis padrão se tabela não existir
        res.json({ 
            success: true, 
            data: [
                { id: 1, nome: 'Administrador', descricao: 'Acesso total ao sistema', nivel: 100 },
                { id: 2, nome: 'Gerente', descricao: 'Acesso gerencial', nivel: 80 },
                { id: 3, nome: 'Supervisor', descricao: 'Acesso de supervisão', nivel: 60 },
                { id: 4, nome: 'Operador', descricao: 'Acesso operacional', nivel: 40 },
                { id: 5, nome: 'Visualizador', descricao: 'Apenas visualização', nivel: 20 }
            ]
        });
    }
});

/**
 * GET /api/permissoes/usuario/:id
 * Busca permissões de um usuário específico
 */
router.get('/usuario/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [usuario] = await pool.query(`
            SELECT 
                id, nome, email, role, is_admin,
                permissoes_pcp, permissoes_rh, permissoes_vendas,
                permissoes_compras, permissoes_financeiro, permissoes_nfe,
                permissoes_custom, areas_bloqueadas, areas
            FROM usuarios 
            WHERE id = ?
        `, [id]);

        if (!usuario.length) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
        }

        res.json({ success: true, data: usuario[0] });
    } catch (error) {
        console.error('[PERMISSÕES] Erro ao buscar permissões:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar permissões' });
    }
});

/**
 * PUT /api/permissoes/usuario/:id
 * Atualiza permissões de um usuário
 */
router.put('/usuario/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            permissoes_pcp,
            permissoes_rh,
            permissoes_vendas,
            permissoes_compras,
            permissoes_financeiro,
            permissoes_nfe,
            permissoes_custom,
            areas_bloqueadas,
            areas,
            role,
            is_admin
        } = req.body;

        const updates = [];
        const params = [];

        if (permissoes_pcp !== undefined) {
            updates.push('permissoes_pcp = ?');
            params.push(typeof permissoes_pcp === 'string' ? permissoes_pcp : JSON.stringify(permissoes_pcp));
        }
        if (permissoes_rh !== undefined) {
            updates.push('permissoes_rh = ?');
            params.push(typeof permissoes_rh === 'string' ? permissoes_rh : JSON.stringify(permissoes_rh));
        }
        if (permissoes_vendas !== undefined) {
            updates.push('permissoes_vendas = ?');
            params.push(typeof permissoes_vendas === 'string' ? permissoes_vendas : JSON.stringify(permissoes_vendas));
        }
        if (permissoes_compras !== undefined) {
            updates.push('permissoes_compras = ?');
            params.push(typeof permissoes_compras === 'string' ? permissoes_compras : JSON.stringify(permissoes_compras));
        }
        if (permissoes_financeiro !== undefined) {
            updates.push('permissoes_financeiro = ?');
            params.push(typeof permissoes_financeiro === 'string' ? permissoes_financeiro : JSON.stringify(permissoes_financeiro));
        }
        if (permissoes_nfe !== undefined) {
            updates.push('permissoes_nfe = ?');
            params.push(typeof permissoes_nfe === 'string' ? permissoes_nfe : JSON.stringify(permissoes_nfe));
        }
        if (permissoes_custom !== undefined) {
            updates.push('permissoes_custom = ?');
            params.push(typeof permissoes_custom === 'string' ? permissoes_custom : JSON.stringify(permissoes_custom));
        }
        if (areas_bloqueadas !== undefined) {
            updates.push('areas_bloqueadas = ?');
            params.push(typeof areas_bloqueadas === 'string' ? areas_bloqueadas : JSON.stringify(areas_bloqueadas));
        }
        if (areas !== undefined) {
            updates.push('areas = ?');
            params.push(typeof areas === 'string' ? areas : JSON.stringify(areas));
        }
        if (role !== undefined) {
            updates.push('role = ?');
            params.push(role);
        }
        if (is_admin !== undefined) {
            updates.push('is_admin = ?');
            params.push(is_admin ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum campo para atualizar' });
        }

        params.push(id);
        await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Permissões atualizadas com sucesso' });
    } catch (error) {
        console.error('[PERMISSÕES] Erro ao atualizar permissões:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar permissões' });
    }
});

/**
 * GET /api/permissoes/modulos
 * Lista módulos e suas permissões disponíveis
 */
router.get('/modulos', async (req, res) => {
    res.json({
        success: true,
        data: {
            vendas: {
                nome: 'Vendas',
                permissoes: ['ver', 'criar', 'editar', 'excluir', 'aprovar', 'exportar', 'relatorios']
            },
            pcp: {
                nome: 'PCP',
                permissoes: ['ver', 'criar', 'editar', 'excluir', 'aprovar', 'producao', 'materiais']
            },
            rh: {
                nome: 'Recursos Humanos',
                permissoes: ['ver', 'criar', 'editar', 'excluir', 'holerites', 'ferias', 'admissao']
            },
            financeiro: {
                nome: 'Financeiro',
                permissoes: ['ver', 'criar', 'editar', 'excluir', 'pagar', 'receber', 'conciliar', 'relatorios']
            },
            compras: {
                nome: 'Compras',
                permissoes: ['ver', 'criar', 'editar', 'excluir', 'aprovar', 'cotacoes', 'fornecedores']
            },
            nfe: {
                nome: 'NF-e',
                permissoes: ['ver', 'emitir', 'cancelar', 'inutilizar', 'carta_correcao']
            }
        }
    });
});

/**
 * POST /api/permissoes/copiar
 * Copia permissões de um usuário para outro
 */
router.post('/copiar', async (req, res) => {
    try {
        const { origem_id, destino_id } = req.body;

        if (!origem_id || !destino_id) {
            return res.status(400).json({ success: false, error: 'IDs de origem e destino são obrigatórios' });
        }

        const [origem] = await pool.query(`
            SELECT 
                permissoes_pcp, permissoes_rh, permissoes_vendas,
                permissoes_compras, permissoes_financeiro, permissoes_nfe,
                permissoes_custom, areas
            FROM usuarios WHERE id = ?
        `, [origem_id]);

        if (!origem.length) {
            return res.status(404).json({ success: false, error: 'Usuário de origem não encontrado' });
        }

        await pool.query(`
            UPDATE usuarios SET
                permissoes_pcp = ?,
                permissoes_rh = ?,
                permissoes_vendas = ?,
                permissoes_compras = ?,
                permissoes_financeiro = ?,
                permissoes_nfe = ?,
                permissoes_custom = ?,
                areas = ?
            WHERE id = ?
        `, [
            origem[0].permissoes_pcp,
            origem[0].permissoes_rh,
            origem[0].permissoes_vendas,
            origem[0].permissoes_compras,
            origem[0].permissoes_financeiro,
            origem[0].permissoes_nfe,
            origem[0].permissoes_custom,
            origem[0].areas,
            destino_id
        ]);

        res.json({ success: true, message: 'Permissões copiadas com sucesso' });
    } catch (error) {
        console.error('[PERMISSÕES] Erro ao copiar permissões:', error);
        res.status(500).json({ success: false, error: 'Erro ao copiar permissões' });
    }
});

// Criar tabela de perfis se não existir
async function ensureTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS perfis_permissao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                descricao TEXT,
                nivel INT DEFAULT 0,
                permissoes JSON,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[PERMISSÕES] ✅ Tabela perfis_permissao verificada/criada');
    } catch (error) {
        console.error('[PERMISSÕES] Erro ao criar tabela:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    ensureTable();
    return router;
};
