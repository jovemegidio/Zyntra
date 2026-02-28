/**
 * WORKFLOW DE APROVAÇÃO - COMPRAS
 * AUDITORIA 02/02/2026: Implementação de fluxo de aprovação multinível
 * 
 * Níveis de aprovação baseados em valor:
 * - Até R$ 5.000: Aprovação automática
 * - R$ 5.001 a R$ 20.000: Gerente de Compras
 * - R$ 20.001 a R$ 50.000: Gerente Financeiro
 * - Acima de R$ 50.000: Diretoria
 */

// Limites de aprovação por nível
const APPROVAL_LIMITS = {
    auto: 5000,          // Aprovação automática
    gerente_compras: 20000,
    gerente_financeiro: 50000,
    diretoria: Infinity
};

// Mapeamento de roles para níveis
const ROLE_LEVELS = {
    'admin': 4,
    'diretor': 4,
    'gerente_financeiro': 3,
    'gerente_compras': 2,
    'comprador': 1,
    'usuario': 0
};

/**
 * Determina o nível de aprovação necessário para um valor
 * @param {number} valor - Valor do pedido de compra
 * @returns {Object} - Nível e aprovadores necessários
 */
function determineApprovalLevel(valor) {
    if (valor <= APPROVAL_LIMITS.auto) {
        return {
            level: 0,
            name: 'auto',
            description: 'Aprovação automática',
            requiredRole: null
        };
    }
    
    if (valor <= APPROVAL_LIMITS.gerente_compras) {
        return {
            level: 1,
            name: 'gerente_compras',
            description: 'Aprovação do Gerente de Compras',
            requiredRole: 'gerente_compras'
        };
    }
    
    if (valor <= APPROVAL_LIMITS.gerente_financeiro) {
        return {
            level: 2,
            name: 'gerente_financeiro',
            description: 'Aprovação do Gerente Financeiro',
            requiredRole: 'gerente_financeiro'
        };
    }
    
    return {
        level: 3,
        name: 'diretoria',
        description: 'Aprovação da Diretoria',
        requiredRole: 'diretor'
    };
}

/**
 * Verifica se usuário pode aprovar um pedido
 * @param {Object} user - Dados do usuário
 * @param {number} valorPedido - Valor do pedido
 * @returns {Object} - Se pode aprovar e motivo
 */
function canUserApprove(user, valorPedido) {
    const userLevel = ROLE_LEVELS[user.role] || 0;
    const requiredApproval = determineApprovalLevel(valorPedido);
    
    // Admin pode aprovar qualquer coisa
    if (user.role === 'admin') {
        return { canApprove: true, reason: 'Admin tem permissão total' };
    }
    
    // Aprovação automática
    if (requiredApproval.level === 0) {
        return { canApprove: true, reason: 'Valor abaixo do limite de aprovação automática' };
    }
    
    // Verificar nível
    if (userLevel >= requiredApproval.level + 1) {
        return { canApprove: true, reason: `Usuário com nível ${user.role} pode aprovar` };
    }
    
    return {
        canApprove: false,
        reason: `Requer aprovação de: ${requiredApproval.description}`,
        requiredRole: requiredApproval.requiredRole,
        requiredLevel: requiredApproval.level
    };
}

/**
 * Cria registro de aprovação
 * @param {Object} pool - Pool MySQL
 * @param {Object} params - Parâmetros da aprovação
 */
async function createApprovalRecord(pool, params) {
    const {
        pedido_id,
        tipo = 'compra',
        nivel,
        usuario_id,
        usuario_nome,
        acao,
        observacao
    } = params;
    
    await pool.query(`
        INSERT INTO aprovacoes (
            pedido_id,
            tipo,
            nivel,
            usuario_id,
            usuario_nome,
            acao,
            observacao,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [pedido_id, tipo, nivel, usuario_id, usuario_nome, acao, observacao]);
}

/**
 * Processa aprovação de pedido de compra
 * @param {Object} pool - Pool MySQL
 * @param {number} pedidoId - ID do pedido
 * @param {Object} user - Usuário aprovador
 * @param {string} acao - 'aprovar' | 'rejeitar'
 * @param {string} observacao - Observação opcional
 * @returns {Promise<Object>}
 */
async function processApproval(pool, pedidoId, user, acao, observacao = '') {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Buscar pedido
        const [pedidos] = await connection.query(`
            SELECT pc.*, f.nome as fornecedor_nome
            FROM pedidos_compra pc
            LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
            WHERE pc.id = ?
            FOR UPDATE
        `, [pedidoId]);
        
        if (pedidos.length === 0) {
            throw new Error('Pedido não encontrado');
        }
        
        const pedido = pedidos[0];
        
        // Verificar status
        if (pedido.status !== 'pendente_aprovacao' && pedido.status !== 'pendente') {
            throw new Error(`Pedido não está pendente de aprovação (status: ${pedido.status})`);
        }
        
        // Verificar permissão
        const permission = canUserApprove(user, pedido.valor_total);
        
        if (!permission.canApprove) {
            throw new Error(permission.reason);
        }
        
        const requiredApproval = determineApprovalLevel(pedido.valor_total);
        let novoStatus;
        
        if (acao === 'aprovar') {
            novoStatus = 'aprovado';
            
            // Registrar aprovação
            await createApprovalRecord(pool, {
                pedido_id: pedidoId,
                tipo: 'compra',
                nivel: requiredApproval.name,
                usuario_id: user.id,
                usuario_nome: user.nome,
                acao: 'APROVADO',
                observacao
            });
            
        } else if (acao === 'rejeitar') {
            novoStatus = 'rejeitado';
            
            await createApprovalRecord(pool, {
                pedido_id: pedidoId,
                tipo: 'compra',
                nivel: requiredApproval.name,
                usuario_id: user.id,
                usuario_nome: user.nome,
                acao: 'REJEITADO',
                observacao
            });
            
        } else {
            throw new Error('Ação inválida. Use "aprovar" ou "rejeitar"');
        }
        
        // Atualizar pedido
        await connection.query(`
            UPDATE pedidos_compra 
            SET status = ?,
                aprovado_por = ?,
                aprovado_em = NOW(),
                observacao_aprovacao = ?,
                updated_at = NOW()
            WHERE id = ?
        `, [novoStatus, user.id, observacao, pedidoId]);
        
        // Auditoria
        await connection.query(`
            INSERT INTO audit_log (
                tabela,
                registro_id,
                acao,
                dados_anteriores,
                dados_novos,
                usuario_id,
                created_at
            ) VALUES ('pedidos_compra', ?, 'APPROVAL', ?, ?, ?, NOW())
        `, [
            pedidoId,
            JSON.stringify({ status: pedido.status }),
            JSON.stringify({ 
                status: novoStatus, 
                aprovado_por: user.id,
                acao,
                valor: pedido.valor_total,
                nivel_aprovacao: requiredApproval.name
            }),
            user.id
        ]);
        
        await connection.commit();
        
        console.log(`✅ Pedido de Compra #${pedidoId} ${acao === 'aprovar' ? 'APROVADO' : 'REJEITADO'} por ${user.nome}`);
        
        return {
            success: true,
            pedido_id: pedidoId,
            status: novoStatus,
            aprovado_por: user.nome,
            nivel_aprovacao: requiredApproval.description,
            message: `Pedido ${acao === 'aprovar' ? 'aprovado' : 'rejeitado'} com sucesso`
        };
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro no workflow de aprovação:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Lista pedidos pendentes de aprovação para um usuário
 * @param {Object} pool 
 * @param {Object} user 
 * @returns {Promise<Array>}
 */
async function listPendingApprovals(pool, user) {
    const userLevel = ROLE_LEVELS[user.role] || 0;
    
    // Admin vê todos
    if (user.role === 'admin' || user.role === 'diretor') {
        const [pedidos] = await pool.query(`
            SELECT pc.*, f.nome as fornecedor_nome,
                   u.nome as solicitante_nome
            FROM pedidos_compra pc
            LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
            LEFT JOIN usuarios u ON pc.criado_por = u.id
            WHERE pc.status IN ('pendente', 'pendente_aprovacao')
            ORDER BY pc.valor_total DESC, pc.created_at ASC
        `);
        return pedidos;
    }
    
    // Outros níveis veem apenas o que podem aprovar
    let valorMax = 0;
    if (userLevel >= 3) valorMax = APPROVAL_LIMITS.gerente_financeiro;
    else if (userLevel >= 2) valorMax = APPROVAL_LIMITS.gerente_compras;
    else valorMax = APPROVAL_LIMITS.auto;
    
    const [pedidos] = await pool.query(`
        SELECT pc.*, f.nome as fornecedor_nome,
               u.nome as solicitante_nome
        FROM pedidos_compra pc
        LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
        LEFT JOIN usuarios u ON pc.criado_por = u.id
        WHERE pc.status IN ('pendente', 'pendente_aprovacao')
        AND pc.valor_total <= ?
        ORDER BY pc.valor_total DESC, pc.created_at ASC
    `, [valorMax]);
    
    return pedidos;
}

/**
 * SQL para criar tabela de aprovações
 */
const CREATE_APPROVALS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS aprovacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    tipo ENUM('compra', 'venda', 'pagamento', 'outro') DEFAULT 'compra',
    nivel VARCHAR(50) NOT NULL,
    usuario_id INT NOT NULL,
    usuario_nome VARCHAR(200),
    acao ENUM('APROVADO', 'REJEITADO', 'PENDENTE') NOT NULL,
    observacao TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pedido (pedido_id),
    INDEX idx_usuario (usuario_id),
    INDEX idx_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Adicionar colunas em pedidos_compra
ALTER TABLE pedidos_compra
ADD COLUMN IF NOT EXISTS aprovado_por INT NULL,
ADD COLUMN IF NOT EXISTS aprovado_em DATETIME NULL,
ADD COLUMN IF NOT EXISTS observacao_aprovacao TEXT NULL;
`;

module.exports = {
    APPROVAL_LIMITS,
    ROLE_LEVELS,
    determineApprovalLevel,
    canUserApprove,
    createApprovalRecord,
    processApproval,
    listPendingApprovals,
    CREATE_APPROVALS_TABLE_SQL
};
