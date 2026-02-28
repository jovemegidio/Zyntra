/**
 * SERVIDOR FINANCEIRO - ALUFORCE V.2
 * Módulo completo de gestão financeira com integração MySQL
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');

// SEGURANÇA: Validar JWT_SECRET obrigatório
if (!process.env.JWT_SECRET) {
    console.error('❌ ERRO FATAL: JWT_SECRET não definido no .env');
    console.error('Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor');
    process.exit(1);
}

// Configurar multer para upload de anexos
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Sanitiza nome de arquivo para prevenir path traversal e caracteres maliciosos
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9._-]/g, '_') // Remove caracteres especiais
        .replace(/\.{2,}/g, '.') // Remove múltiplos pontos
        .replace(/^\.+/, '') // Remove pontos no início
        .substring(0, 100); // Limita tamanho
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const safeName = sanitizeFilename(file.originalname);
        cb(null, uniqueSuffix + '-' + safeName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido'));
        }
    }
});

// Importar security middleware
const {
    generalLimiter,
    sanitizeInput,
    securityHeaders
} = require('../../security-middleware');

const app = express();
const PORT = process.env.PORT_FINANCEIRO || 3006;

// Configuração do pool MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'railway',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    charset: 'utf8mb4',
    connectionLimit: 20,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Middleware de autenticação JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    // AUDIT-FIX ARCH-004: Enforce HS256 algorithm (audience enforced in sign, verify-side after token rotation)
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
            }
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
};

// AUDITORIA ENTERPRISE: Verificação de papel de administrador
function isAdminUser(user) {
    if (!user) return false;
    const adminRoles = ['admin', 'administrador', 'gerente', 'financeiro_admin'];
    return adminRoles.includes(user.role) || 
           adminRoles.includes(user.papel) || 
           user.is_admin === true ||
           user.admin === true;
}

// AUDITORIA ENTERPRISE: Middleware de verificação de permissão financeira
const requireFinancePermission = (action) => {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }
        
        // Admins têm acesso total
        if (isAdminUser(user)) {
            return next();
        }
        
        // Definir permissões por papel
        const permissoes = {
            gerente: ['visualizar', 'criar', 'editar', 'aprovar'],
            financeiro: ['visualizar', 'criar', 'editar'],
            usuario: ['visualizar']
        };
        
        const papel = user.role || user.papel || 'usuario';
        const permsUsuario = permissoes[papel] || permissoes.usuario;
        
        if (!permsUsuario.includes(action)) {
            return res.status(403).json({ 
                error: 'Acesso negado',
                message: `Você não tem permissão para ${action} neste módulo`
            });
        }
        
        next();
    };
};

// Middlewares
app.use(securityHeaders());
app.use(generalLimiter);
app.use(sanitizeInput);
app.use(cors());
app.use(express.json({ limit: '2mb' })); // SEGURANÇA: Limite de payload
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Servir arquivos estáticos
app.use('/modules/Financeiro', express.static(__dirname));
app.use('/modules/Financeiro/public', express.static(path.join(__dirname, 'public')));

// ============================================
// ROTAS - CONTAS A PAGAR
// ============================================

// Listar contas a pagar
app.get('/api/financeiro/contas-pagar', authenticateToken, async (req, res) => {
    try {
        const { status, fornecedor_id, vencimento_inicio, vencimento_fim, limite = 100 } = req.query;
        
        let sql = 'SELECT * FROM contas_pagar WHERE 1=1';
        const params = [];
        
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        if (fornecedor_id) {
            sql += ' AND fornecedor_id = ?';
            params.push(fornecedor_id);
        }
        if (vencimento_inicio) {
            sql += ' AND data_vencimento >= ?';
            params.push(vencimento_inicio);
        }
        if (vencimento_fim) {
            sql += ' AND data_vencimento <= ?';
            params.push(vencimento_fim);
        }
        
        sql += ' ORDER BY data_vencimento DESC LIMIT ?';
        params.push(parseInt(limite));
        
        const [contas] = await pool.execute(sql, params);
        res.json({ success: true, data: contas });
    } catch (error) {
        console.error('❌ Erro ao buscar contas a pagar:', error);
        res.status(500).json({ error: 'Erro ao buscar contas a pagar', message: error.message });
    }
});

// Criar conta a pagar
app.post('/api/financeiro/contas-pagar', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const {
            fornecedor_id,
            descricao,
            valor_total,
            data_emissao,
            data_vencimento,
            numero_documento,
            categoria_id,
            centro_custo_id,
            observacoes,
            parcelas = 1
        } = req.body;
        
        // SEGURANÇA: Validar valor monetário
        const valorParsed = parseFloat(valor_total);
        if (isNaN(valorParsed) || valorParsed <= 0 || valorParsed > 999999999.99) {
            return res.status(400).json({ error: 'Valor total inválido. Deve ser maior que 0' });
        }
        const valorSanitizado = Math.round(valorParsed * 100) / 100;
        
        // SEGURANÇA: Validar formato de datas
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(data_emissao) || !dateRegex.test(data_vencimento)) {
            return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
        }
        
        // Validar que vencimento não é anterior à emissão
        if (new Date(data_vencimento) < new Date(data_emissao)) {
            return res.status(400).json({ error: 'Data de vencimento não pode ser anterior à emissão' });
        }
        
        const [result] = await connection.execute(
            `INSERT INTO contas_pagar 
            (fornecedor_id, descricao, valor_total, data_emissao, data_vencimento, 
             numero_documento, categoria_id, centro_custo_id, observacoes, status, usuario_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
            [fornecedor_id, descricao, valorSanitizado, data_emissao, data_vencimento,
             numero_documento, categoria_id, centro_custo_id, observacoes, req.user.id]
        );
        
        await connection.commit();
        res.json({ success: true, id: result.insertId, message: 'Conta a pagar criada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao criar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao criar conta a pagar', message: error.message });
    } finally {
        connection.release();
    }
});

// Atualizar conta a pagar
app.put('/api/financeiro/contas-pagar/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // SEGURANÇA: Validar ID
        const idParsed = parseInt(id, 10);
        if (!Number.isInteger(idParsed) || idParsed <= 0) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        const campos = req.body;
        
        // SEGURANÇA: Whitelist de campos permitidos para evitar SQL Injection
        const camposPermitidos = [
            'fornecedor_id', 'descricao', 'valor_total', 'data_emissao', 
            'data_vencimento', 'numero_documento', 'categoria_id', 
            'centro_custo_id', 'observacoes', 'status', 'valor_pago',
            'data_pagamento', 'forma_pagamento', 'conta_bancaria_id'
        ];
        
        const camposFiltrados = {};
        for (const key of Object.keys(campos)) {
            if (camposPermitidos.includes(key)) {
                let valor = campos[key];
                
                // SEGURANÇA: Validar valores monetários
                if (['valor_total', 'valor_pago'].includes(key) && valor !== null && valor !== undefined) {
                    const valorParsed = parseFloat(valor);
                    if (isNaN(valorParsed) || valorParsed < 0 || valorParsed > 999999999.99) {
                        return res.status(400).json({ error: `${key} inválido` });
                    }
                    valor = Math.round(valorParsed * 100) / 100;
                }
                
                camposFiltrados[key] = valor;
            }
        }
        
        if (Object.keys(camposFiltrados).length === 0) {
            return res.status(400).json({ error: 'Nenhum campo válido fornecido para atualização' });
        }
        
        // SEGURANÇA: Usar backticks para escapar nomes de colunas
        const setClauses = Object.keys(camposFiltrados).map(key => `\`${key}\` = ?`).join(', ');
        const valores = [...Object.values(camposFiltrados), idParsed];
        
        await pool.execute(
            `UPDATE contas_pagar SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
            valores
        );
        
        res.json({ success: true, message: 'Conta a pagar atualizada com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta a pagar', message: error.message });
    }
});

// Baixar conta a pagar (pagamento) - Suporta /baixar e /pagar
app.post('/api/financeiro/contas-pagar/:id/baixar', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        const { data_pagamento, valor_pago, conta_bancaria_id, forma_pagamento, observacoes } = req.body;
        
        // Atualizar conta a pagar
        await connection.execute(
            `UPDATE contas_pagar 
             SET status = 'pago', data_pagamento = ?, valor_pago = ?, 
                 conta_bancaria_id = ?, forma_pagamento = ?, observacoes_pagamento = ?
             WHERE id = ?`,
            [data_pagamento, valor_pago, conta_bancaria_id, forma_pagamento, observacoes, id]
        );
        
        // Registrar pagamento
        await connection.execute(
            `INSERT INTO financeiro_pagamentos 
             (conta_pagar_id, data_pagamento, valor, conta_bancaria_id, forma_pagamento, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, data_pagamento, valor_pago, conta_bancaria_id, forma_pagamento, req.user.id]
        );
        
        await connection.commit();
        res.json({ success: true, message: 'Pagamento registrado com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao baixar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao baixar conta a pagar', message: error.message });
    } finally {
        connection.release();
    }
});

// Alias para /pagar (compatibilidade com frontend)
app.post('/api/financeiro/contas-pagar/:id/pagar', authenticateToken, async (req, res, next) => {
    req.url = req.url.replace('/pagar', '/baixar');
    next();
});

// DELETE - Excluir conta a pagar
app.delete('/api/financeiro/contas-pagar/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar se a conta existe e não está paga
        const [conta] = await pool.execute('SELECT status FROM contas_pagar WHERE id = ?', [id]);
        if (conta.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        if (conta[0].status === 'pago') {
            return res.status(400).json({ error: 'Não é possível excluir uma conta já paga' });
        }
        
        await pool.execute('DELETE FROM contas_pagar WHERE id = ?', [id]);
        res.json({ success: true, message: 'Conta excluída com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao excluir conta a pagar', message: error.message });
    }
});

// GET - Obter conta a pagar específica
app.get('/api/financeiro/contas-pagar/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [contas] = await pool.execute(
            `SELECT cp.*, f.razao_social as fornecedor_nome, f.cnpj_cpf
             FROM contas_pagar cp
             LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
             WHERE cp.id = ?`,
            [id]
        );
        
        if (contas.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        res.json({ success: true, data: contas[0] });
    } catch (error) {
        console.error('❌ Erro ao buscar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao buscar conta a pagar', message: error.message });
    }
});

// ============================================
// ROTAS - CONTAS A RECEBER
// ============================================

// Listar contas a receber
app.get('/api/financeiro/contas-receber', authenticateToken, async (req, res) => {
    try {
        const { status, cliente_id, vencimento_inicio, vencimento_fim, limite = 100 } = req.query;
        
        let sql = `SELECT cr.*, 
                          c.nome as cliente_nome, c.cpf_cnpj as cnpj_cpf,
                          cr.valor as valor_total, cr.observacoes as categoria,
                          cr.forma_recebimento, '' as conta_bancaria, 
                          '' as centro_receita, '' as numero_documento,
                          3 as dias_lembrete, NULL as competencia, NULL as recorrencia
                   FROM contas_receber cr
                   LEFT JOIN clientes c ON cr.cliente_id = c.id
                   WHERE 1=1`;
        const params = [];
        
        if (status) {
            sql += ' AND cr.status = ?';
            params.push(status);
        }
        if (cliente_id) {
            sql += ' AND cr.cliente_id = ?';
            params.push(cliente_id);
        }
        if (vencimento_inicio) {
            sql += ' AND cr.data_vencimento >= ?';
            params.push(vencimento_inicio);
        }
        if (vencimento_fim) {
            sql += ' AND cr.data_vencimento <= ?';
            params.push(vencimento_fim);
        }
        
        sql += ' ORDER BY cr.data_vencimento DESC LIMIT ?';
        params.push(parseInt(limite));
        
        const [contas] = await pool.execute(sql, params);
        res.json(contas); // Retornar array direto para compatibilidade com frontend
    } catch (error) {
        console.error('❌ Erro ao buscar contas a receber:', error);
        res.status(500).json({ error: 'Erro ao buscar contas a receber', message: error.message });
    }
});

// Criar conta a receber
app.post('/api/financeiro/contas-receber', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const {
            cliente_id,
            descricao,
            valor_total,
            data_emissao,
            data_vencimento,
            numero_documento,
            categoria_id,
            observacoes
        } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar valor monetário
        const valorParsed = parseFloat(valor_total);
        if (isNaN(valorParsed) || valorParsed <= 0 || valorParsed > 999999999.99) {
            return res.status(400).json({ error: 'Valor total inválido. Deve ser maior que 0' });
        }
        const valorSanitizado = Math.round(valorParsed * 100) / 100;
        
        // AUDITORIA ENTERPRISE: Validar formato de datas
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(data_emissao) || !dateRegex.test(data_vencimento)) {
            return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
        }
        
        // Validar que vencimento não é anterior à emissão
        if (new Date(data_vencimento) < new Date(data_emissao)) {
            return res.status(400).json({ error: 'Data de vencimento não pode ser anterior à emissão' });
        }
        
        const [result] = await connection.execute(
            `INSERT INTO contas_receber 
            (cliente_id, descricao, valor_total, data_emissao, data_vencimento, 
             numero_documento, categoria_id, observacoes, status, usuario_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
            [cliente_id, descricao, valor_total, data_emissao, data_vencimento,
             numero_documento, categoria_id, observacoes, req.user.id]
        );
        
        await connection.commit();
        res.json({ success: true, id: result.insertId, message: 'Conta a receber criada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao criar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao criar conta a receber', message: error.message });
    } finally {
        connection.release();
    }
});

// Editar conta a receber
app.put('/api/financeiro/contas-receber/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // AUDITORIA ENTERPRISE: Validar ID
        const idParsed = parseInt(id, 10);
        if (!Number.isInteger(idParsed) || idParsed <= 0) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        const {
            cliente_nome,
            cnpj_cpf,
            descricao,
            categoria,
            centro_receita,
            valor_total,
            data_vencimento,
            competencia,
            forma_recebimento,
            conta_bancaria,
            numero_documento,
            dias_lembrete,
            recorrencia,
            status
        } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar valor monetário se fornecido
        let valorSanitizado = null;
        if (valor_total !== undefined && valor_total !== null) {
            const valorParsed = parseFloat(valor_total);
            if (isNaN(valorParsed) || valorParsed < 0 || valorParsed > 999999999.99) {
                return res.status(400).json({ error: 'Valor total inválido' });
            }
            valorSanitizado = Math.round(valorParsed * 100) / 100;
        }
        
        // AUDITORIA ENTERPRISE: Validar data se fornecida
        if (data_vencimento) {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(data_vencimento)) {
                return res.status(400).json({ error: 'Data de vencimento inválida (YYYY-MM-DD)' });
            }
        }
        
        await pool.execute(
            `UPDATE contas_receber SET
                descricao = COALESCE(?, descricao),
                valor = COALESCE(?, valor),
                data_vencimento = COALESCE(?, data_vencimento),
                forma_recebimento = COALESCE(?, forma_recebimento),
                observacoes = COALESCE(?, observacoes),
                status = COALESCE(?, status)
             WHERE id = ?`,
            [descricao, valor_total, data_vencimento, forma_recebimento, 
             `${cliente_nome || ''} | ${categoria || ''} | ${conta_bancaria || ''}`, 
             status, id]
        );
        
        res.json({ success: true, message: 'Conta atualizada com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta a receber', message: error.message });
    }
});

// DELETE - Excluir conta a receber
app.delete('/api/financeiro/contas-receber/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar se a conta existe e não está recebida
        const [conta] = await pool.execute('SELECT status FROM contas_receber WHERE id = ?', [id]);
        if (conta.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        if (conta[0].status === 'recebido') {
            return res.status(400).json({ error: 'Não é possível excluir uma conta já recebida' });
        }
        
        await pool.execute('DELETE FROM contas_receber WHERE id = ?', [id]);
        res.json({ success: true, message: 'Conta excluída com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir conta a receber:', error);
        res.status(500).json({ error: 'Erro ao excluir conta a receber', message: error.message });
    }
});

// GET - Obter conta a receber específica
app.get('/api/financeiro/contas-receber/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [contas] = await pool.execute(
            `SELECT cr.*, c.nome as cliente_nome, c.cpf_cnpj
             FROM contas_receber cr
             LEFT JOIN clientes c ON cr.cliente_id = c.id
             WHERE cr.id = ?`,
            [id]
        );
        
        if (contas.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        res.json({ success: true, data: contas[0] });
    } catch (error) {
        console.error('❌ Erro ao buscar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao buscar conta a receber', message: error.message });
    }
});

// Baixar conta a receber (recebimento)
app.post('/api/financeiro/contas-receber/:id/baixar', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        const { data_recebimento, valor_recebido, conta_bancaria_id, forma_recebimento } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar ID
        const idParsed = parseInt(id, 10);
        if (!Number.isInteger(idParsed) || idParsed <= 0) {
            connection.release();
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        // AUDITORIA ENTERPRISE: Validar valor monetário
        const valorParsed = parseFloat(valor_recebido);
        if (isNaN(valorParsed) || valorParsed <= 0 || valorParsed > 999999999.99) {
            connection.release();
            return res.status(400).json({ error: 'Valor recebido inválido' });
        }
        const valorSanitizado = Math.round(valorParsed * 100) / 100;
        
        // AUDITORIA ENTERPRISE: Verificar se conta existe e não está já recebida
        const [conta] = await connection.execute('SELECT status, valor FROM contas_receber WHERE id = ?', [idParsed]);
        if (conta.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        if (conta[0].status === 'recebido') {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ error: 'Esta conta já foi recebida' });
        }
        
        // AUDITORIA ENTERPRISE: Usar connection (não pool) para garantir transação
        await connection.execute(
            `UPDATE contas_receber 
             SET status = 'recebido', data_recebimento = ?, valor_recebido = ?, 
                 banco_id = ?, forma_recebimento = ?
             WHERE id = ?`,
            [data_recebimento, valorSanitizado, conta_bancaria_id, forma_recebimento, idParsed]
        );
        
        // AUDITORIA ENTERPRISE: Registrar no histórico de recebimentos
        await connection.execute(
            `INSERT INTO financeiro_recebimentos 
             (conta_receber_id, data_recebimento, valor, conta_bancaria_id, forma_recebimento, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [idParsed, data_recebimento, valorSanitizado, conta_bancaria_id, forma_recebimento, req.user.id]
        );
        
        await connection.commit();
        res.json({ success: true, message: 'Recebimento registrado com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao baixar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao baixar conta a receber', message: error.message });
    } finally {
        connection.release();
    }
});

// ============================================
// ROTAS - CONTAS BANCÁRIAS
// ============================================

app.get('/api/financeiro/contas-bancarias', authenticateToken, async (req, res) => {
    try {
        const [contas] = await pool.execute('SELECT * FROM contas_bancarias WHERE ativo = 1');
        res.json({ success: true, data: contas });
    } catch (error) {
        console.error('❌ Erro ao buscar contas bancárias:', error);
        res.status(500).json({ error: 'Erro ao buscar contas bancárias', message: error.message });
    }
});

app.post('/api/financeiro/contas-bancarias', authenticateToken, async (req, res) => {
    try {
        const { banco, agencia, conta, tipo_conta, saldo_inicial, descricao } = req.body;
        
        const [result] = await pool.execute(
            `INSERT INTO contas_bancarias 
             (banco, agencia, conta, tipo_conta, saldo_inicial, saldo_atual, descricao)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [banco, agencia, conta, tipo_conta, saldo_inicial, saldo_inicial, descricao]
        );
        
        res.json({ success: true, id: result.insertId, message: 'Conta bancária criada' });
    } catch (error) {
        console.error('❌ Erro ao criar conta bancária:', error);
        res.status(500).json({ error: 'Erro ao criar conta bancária', message: error.message });
    }
});

// ============================================
// ROTAS - DASHBOARD E RELATÓRIOS
// ============================================

app.get('/api/financeiro/dashboard', authenticateToken, async (req, res) => {
    try {
        const [totalPagar] = await pool.execute(
            "SELECT SUM(valor_total) as total FROM contas_pagar WHERE status = 'pendente'"
        );
        
        const [totalReceber] = await pool.execute(
            "SELECT SUM(valor_total) as total FROM contas_receber WHERE status = 'pendente'"
        );
        
        const [vencidosPagar] = await pool.execute(
            "SELECT COUNT(*) as total FROM contas_pagar WHERE status = 'pendente' AND data_vencimento < CURDATE()"
        );
        
        const [vencidosReceber] = await pool.execute(
            "SELECT COUNT(*) as total FROM contas_receber WHERE status = 'pendente' AND data_vencimento < CURDATE()"
        );
        
        const [saldoContas] = await pool.execute(
            "SELECT SUM(saldo_atual) as total FROM contas_bancarias WHERE ativo = 1"
        );
        
        res.json({
            success: true,
            data: {
                total_pagar: totalPagar[0]?.total || 0,
                total_receber: totalReceber[0]?.total || 0,
                vencidos_pagar: vencidosPagar[0]?.total || 0,
                vencidos_receber: vencidosReceber[0]?.total || 0,
                saldo_contas: saldoContas[0]?.total || 0,
                saldo_projetado: (saldoContas[0]?.total || 0) + (totalReceber[0]?.total || 0) - (totalPagar[0]?.total || 0)
            }
        });
    } catch (error) {
        console.error('❌ Erro ao buscar dashboard:', error);
        res.status(500).json({ error: 'Erro ao buscar dashboard', message: error.message });
    }
});

// Relatório DRE
app.get('/api/financeiro/relatorios/dre', authenticateToken, async (req, res) => {
    try {
        const { inicio, fim, periodo } = req.query;
        
        const [receitas] = await pool.execute(
            `SELECT SUM(valor_recebido) as total 
             FROM contas_receber 
             WHERE status = 'recebido' AND data_recebimento BETWEEN ? AND ?`,
            [inicio, fim]
        );
        
        const [despesas] = await pool.execute(
            `SELECT SUM(valor_pago) as total 
             FROM contas_pagar 
             WHERE status = 'pago' AND data_pagamento BETWEEN ? AND ?`,
            [inicio, fim]
        );
        
        const receita = parseFloat(receitas[0]?.total || 0);
        const despesa = parseFloat(despesas[0]?.total || 0);
        
        res.json({
            success: true,
            data: {
                receitas: receita,
                despesas: despesa,
                lucro_liquido: receita - despesa,
                margem_liquida: receita > 0 ? ((receita - despesa) / receita * 100).toFixed(2) : 0
            }
        });
    } catch (error) {
        console.error('❌ Erro ao gerar DRE:', error);
        res.status(500).json({ error: 'Erro ao gerar DRE', message: error.message });
    }
});

// Fluxo de caixa
app.get('/api/financeiro/fluxo-caixa', authenticateToken, async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        
        const [entradas] = await pool.execute(
            `SELECT DATE(data_recebimento) as data, SUM(valor_recebido) as total
             FROM contas_receber
             WHERE status = 'recebido' AND data_recebimento BETWEEN ? AND ?
             GROUP BY DATE(data_recebimento)
             ORDER BY data`,
            [inicio, fim]
        );
        
        const [saidas] = await pool.execute(
            `SELECT DATE(data_pagamento) as data, SUM(valor_pago) as total
             FROM contas_pagar
             WHERE status = 'pago' AND data_pagamento BETWEEN ? AND ?
             GROUP BY DATE(data_pagamento)
             ORDER BY data`,
            [inicio, fim]
        );
        
        res.json({ success: true, data: { entradas, saidas } });
    } catch (error) {
        console.error('❌ Erro ao buscar fluxo de caixa:', error);
        res.status(500).json({ error: 'Erro ao buscar fluxo de caixa', message: error.message });
    }
});

// ============================================
// ROTAS - FORNECEDORES E CLIENTES
// ============================================

app.get('/api/financeiro/fornecedores', authenticateToken, async (req, res) => {
    try {
        const [fornecedores] = await pool.execute(
            'SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY razao_social'
        );
        res.json({ success: true, data: fornecedores });
    } catch (error) {
        console.error('❌ Erro ao buscar fornecedores:', error);
        res.status(500).json({ error: 'Erro ao buscar fornecedores', message: error.message });
    }
});

app.get('/api/financeiro/clientes', authenticateToken, async (req, res) => {
    try {
        const [clientes] = await pool.execute(
            'SELECT * FROM clientes WHERE ativo = 1 ORDER BY razao_social'
        );
        res.json({ success: true, data: clientes });
    } catch (error) {
        console.error('❌ Erro ao buscar clientes:', error);
        res.status(500).json({ error: 'Erro ao buscar clientes', message: error.message });
    }
});

// ============================================
// ROTAS - BANCOS (GESTÃO COMPLETA)
// ============================================

// Listar bancos
app.get('/api/financeiro/bancos', authenticateToken, async (req, res) => {
    try {
        const [bancos] = await pool.execute(`
            SELECT b.*, 
                   COALESCE((SELECT SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor ELSE -m.valor END) FROM movimentacoes_bancarias m WHERE m.banco_id = b.id), 0) as movimentos_total,
                   (SELECT COUNT(*) FROM movimentacoes_bancarias m WHERE m.banco_id = b.id) as total_movimentos
            FROM bancos b 
            WHERE b.status = 'ativo'
            ORDER BY b.nome
        `);
        res.json({ success: true, data: bancos });
    } catch (error) {
        console.error('❌ Erro ao buscar bancos:', error);
        res.status(500).json({ error: 'Erro ao buscar bancos', message: error.message });
    }
});

// Buscar banco por ID
app.get('/api/financeiro/bancos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [bancos] = await pool.execute('SELECT * FROM bancos WHERE id = ?', [id]);
        if (bancos.length === 0) {
            return res.status(404).json({ error: 'Banco não encontrado' });
        }
        res.json({ success: true, data: bancos[0] });
    } catch (error) {
        console.error('❌ Erro ao buscar banco:', error);
        res.status(500).json({ error: 'Erro ao buscar banco', message: error.message });
    }
});

// Criar banco
app.post('/api/financeiro/bancos', authenticateToken, async (req, res) => {
    try {
        const { codigo, nome, tipo, agencia, conta, apelido, saldo_inicial, observacoes } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar campos obrigatórios
        if (!nome || nome.trim().length === 0) {
            return res.status(400).json({ error: 'Nome do banco é obrigatório' });
        }
        
        // AUDITORIA ENTERPRISE: Validar saldo inicial
        let saldoSanitizado = 0;
        if (saldo_inicial !== undefined && saldo_inicial !== null && saldo_inicial !== '') {
            const saldoParsed = parseFloat(saldo_inicial);
            if (isNaN(saldoParsed) || saldoParsed < -999999999.99 || saldoParsed > 999999999.99) {
                return res.status(400).json({ error: 'Saldo inicial inválido' });
            }
            saldoSanitizado = Math.round(saldoParsed * 100) / 100;
        }
        
        // AUDITORIA ENTERPRISE: Sanitizar agência e conta (apenas números)
        const agenciaSanitizada = agencia ? String(agencia).replace(/[^0-9-]/g, '') : null;
        const contaSanitizada = conta ? String(conta).replace(/[^0-9-]/g, '') : null;
        
        const [result] = await pool.execute(
            `INSERT INTO bancos (nome, instituicao, tipo_conta, agencia, conta_corrente, saldo_inicial, saldo_atual, status, considera_fluxo)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo', 1)`,
            [apelido || nome, codigo, tipo, agenciaSanitizada, contaSanitizada, saldoSanitizado, saldoSanitizado]
        );
        
        res.json({ success: true, id: result.insertId, message: 'Banco cadastrado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao criar banco:', error);
        res.status(500).json({ error: 'Erro ao criar banco', message: error.message });
    }
});

// Atualizar banco
app.put('/api/financeiro/bancos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // AUDITORIA ENTERPRISE: Validar ID
        const idParsed = parseInt(id, 10);
        if (!Number.isInteger(idParsed) || idParsed <= 0) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        const { codigo, nome, tipo, agencia, conta, apelido, saldo_inicial, observacoes, ativo } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar saldo inicial se fornecido
        let saldoSanitizado = 0;
        if (saldo_inicial !== undefined && saldo_inicial !== null && saldo_inicial !== '') {
            const saldoParsed = parseFloat(saldo_inicial);
            if (isNaN(saldoParsed) || saldoParsed < -999999999.99 || saldoParsed > 999999999.99) {
                return res.status(400).json({ error: 'Saldo inicial inválido' });
            }
            saldoSanitizado = Math.round(saldoParsed * 100) / 100;
        }
        
        // AUDITORIA ENTERPRISE: Sanitizar agência e conta
        const agenciaSanitizada = agencia ? String(agencia).replace(/[^0-9-]/g, '') : null;
        const contaSanitizada = conta ? String(conta).replace(/[^0-9-]/g, '') : null;
        
        await pool.execute(
            `UPDATE bancos SET 
             nome = ?, instituicao = ?, tipo_conta = ?, agencia = ?, conta_corrente = ?, 
             saldo_inicial = ?, status = ?, updated_at = NOW()
             WHERE id = ?`,
            [apelido || nome, codigo, tipo, agenciaSanitizada, contaSanitizada, saldoSanitizado, ativo ? 'ativo' : 'inativo', idParsed]
        );
        
        res.json({ success: true, message: 'Banco atualizado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar banco:', error);
        res.status(500).json({ error: 'Erro ao atualizar banco', message: error.message });
    }
});

// Excluir banco (soft delete)
app.delete('/api/financeiro/bancos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute("UPDATE bancos SET status = 'inativo' WHERE id = ?", [id]);
        res.json({ success: true, message: 'Banco desativado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir banco:', error);
        res.status(500).json({ error: 'Erro ao excluir banco', message: error.message });
    }
});

// ============================================
// ROTAS - MOVIMENTAÇÕES BANCÁRIAS
// ============================================

// Listar movimentações
app.get('/api/financeiro/movimentacoes-bancarias', authenticateToken, async (req, res) => {
    try {
        const { banco_id, data_inicio, data_fim, tipo, limit = 100 } = req.query;
        
        let sql = `
            SELECT m.*, m.cliente_fornecedor as descricao, m.saldo as saldo_apos, b.nome as banco_nome, b.apelido as banco_apelido
            FROM movimentacoes_bancarias m
            JOIN bancos b ON m.banco_id = b.id
            WHERE 1=1
        `;
        const params = [];
        
        if (banco_id) {
            sql += ' AND m.banco_id = ?';
            params.push(banco_id);
        }
        if (data_inicio) {
            sql += ' AND m.data >= ?';
            params.push(data_inicio);
        }
        if (data_fim) {
            sql += ' AND m.data <= ?';
            params.push(data_fim);
        }
        if (tipo) {
            sql += ' AND m.tipo = ?';
            params.push(tipo);
        }
        
        sql += ' ORDER BY m.data DESC, m.id DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const [movimentacoes] = await pool.execute(sql, params);
        res.json({ success: true, data: movimentacoes });
    } catch (error) {
        console.error('❌ Erro ao buscar movimentações:', error);
        res.status(500).json({ error: 'Erro ao buscar movimentações', message: error.message });
    }
});

// Criar movimentação
app.post('/api/financeiro/movimentacoes-bancarias', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { banco_id, tipo, valor, data, descricao, categoria } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar tipo de movimentação
        if (!['entrada', 'saida'].includes(tipo)) {
            connection.release();
            return res.status(400).json({ error: 'Tipo de movimentação inválido. Use "entrada" ou "saida"' });
        }
        
        // AUDITORIA ENTERPRISE: Validar valor monetário
        const valorNum = parseFloat(valor);
        if (isNaN(valorNum) || valorNum <= 0 || valorNum > 999999999.99) {
            connection.release();
            return res.status(400).json({ error: 'Valor da movimentação inválido. Deve ser maior que 0' });
        }
        const valorSanitizado = Math.round(valorNum * 100) / 100;
        
        // AUDITORIA ENTERPRISE: Validar data
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(data)) {
            connection.release();
            return res.status(400).json({ error: 'Data inválida (YYYY-MM-DD)' });
        }
        
        // Buscar saldo atual do banco
        const [banco] = await connection.execute('SELECT saldo_atual FROM bancos WHERE id = ?', [banco_id]);
        if (banco.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Banco não encontrado' });
        }
        
        const saldoAtual = parseFloat(banco[0].saldo_atual) || 0;
        const novoSaldo = tipo === 'entrada' 
            ? Math.round((saldoAtual + valorSanitizado) * 100) / 100 
            : Math.round((saldoAtual - valorSanitizado) * 100) / 100;
        
        // Inserir movimentação
        await connection.execute(
            `INSERT INTO movimentacoes_bancarias (banco_id, data, tipo, valor, saldo, cliente_fornecedor, categoria)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [banco_id, data, tipo, valorSanitizado, novoSaldo, descricao, categoria]
        );
        
        // Atualizar saldo do banco
        await connection.execute('UPDATE bancos SET saldo_atual = ? WHERE id = ?', [novoSaldo, banco_id]);
        
        await connection.commit();
        res.json({ success: true, message: 'Movimentação registrada com sucesso', novo_saldo: novoSaldo });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao criar movimentação:', error);
        res.status(500).json({ error: 'Erro ao criar movimentação', message: error.message });
    } finally {
        connection.release();
    }
});

// ============================================
// ROTAS - TRANSFERÊNCIAS BANCÁRIAS
// ============================================

app.post('/api/financeiro/transferencia-bancaria', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { conta_origem, conta_destino, valor, data, descricao } = req.body;
        
        // AUDITORIA ENTERPRISE: Validar valor monetário
        const valorNum = parseFloat(valor);
        if (isNaN(valorNum) || valorNum <= 0 || valorNum > 999999999.99) {
            connection.release();
            return res.status(400).json({ error: 'Valor da transferência inválido. Deve ser maior que 0' });
        }
        const valorSanitizado = Math.round(valorNum * 100) / 100;
        
        // AUDITORIA ENTERPRISE: Validar contas origem e destino diferentes
        if (conta_origem === conta_destino) {
            connection.release();
            return res.status(400).json({ error: 'Conta de origem e destino não podem ser iguais' });
        }
        
        // AUDITORIA ENTERPRISE: Validar data
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(data)) {
            connection.release();
            return res.status(400).json({ error: 'Data inválida (YYYY-MM-DD)' });
        }
        
        // Buscar saldos atuais
        const [origem] = await connection.execute('SELECT saldo_atual, nome FROM bancos WHERE id = ?', [conta_origem]);
        const [destino] = await connection.execute('SELECT saldo_atual, nome FROM bancos WHERE id = ?', [conta_destino]);
        
        if (origem.length === 0 || destino.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        const saldoOrigem = parseFloat(origem[0].saldo_atual) || 0;
        const saldoDestino = parseFloat(destino[0].saldo_atual) || 0;
        
        // AUDITORIA ENTERPRISE: Verificar saldo suficiente na origem
        if (saldoOrigem < valorSanitizado) {
            await connection.rollback();
            return res.status(400).json({ 
                error: 'Saldo insuficiente na conta de origem',
                saldo_disponivel: saldoOrigem,
                valor_solicitado: valorSanitizado
            });
        }
        
        const novoSaldoOrigem = Math.round((saldoOrigem - valorSanitizado) * 100) / 100;
        const novoSaldoDestino = Math.round((saldoDestino + valorSanitizado) * 100) / 100;
        
        // Movimentação de saída na origem
        await connection.execute(
            `INSERT INTO movimentacoes_bancarias (banco_id, data, tipo, valor, saldo, cliente_fornecedor, categoria)
             VALUES (?, ?, 'saida', ?, ?, ?, 'Transferência')`,
            [conta_origem, data, valorSanitizado, novoSaldoOrigem, `Transferência para ${destino[0].nome}` + (descricao ? ` - ${descricao}` : '')]
        );
        
        // Movimentação de entrada no destino
        await connection.execute(
            `INSERT INTO movimentacoes_bancarias (banco_id, data, tipo, valor, saldo, cliente_fornecedor, categoria)
             VALUES (?, ?, 'entrada', ?, ?, ?, 'Transferência')`,
            [conta_destino, data, valorSanitizado, novoSaldoDestino, `Transferência de ${origem[0].nome}` + (descricao ? ` - ${descricao}` : '')]
        );
        
        // Atualizar saldos
        await connection.execute('UPDATE bancos SET saldo_atual = ? WHERE id = ?', [novoSaldoOrigem, conta_origem]);
        await connection.execute('UPDATE bancos SET saldo_atual = ? WHERE id = ?', [novoSaldoDestino, conta_destino]);
        
        await connection.commit();
        res.json({ success: true, message: 'Transferência realizada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro na transferência:', error);
        res.status(500).json({ error: 'Erro na transferência', message: error.message });
    } finally {
        connection.release();
    }
});

// Extrato bancário
app.get('/api/financeiro/bancos/:id/extrato', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { data_inicio, data_fim } = req.query;
        
        let sql = `
            SELECT m.*, m.cliente_fornecedor as descricao, m.saldo as saldo_apos, b.nome as banco_nome, b.apelido as banco_apelido
            FROM movimentacoes_bancarias m
            JOIN bancos b ON m.banco_id = b.id
            WHERE m.banco_id = ?
        `;
        const params = [id];
        
        if (data_inicio) {
            sql += ' AND m.data >= ?';
            params.push(data_inicio);
        }
        if (data_fim) {
            sql += ' AND m.data <= ?';
            params.push(data_fim);
        }
        
        sql += ' ORDER BY m.data DESC, m.id DESC LIMIT 500';
        
        const [movimentacoes] = await pool.execute(sql, params);
        res.json({ success: true, data: movimentacoes });
    } catch (error) {
        console.error('❌ Erro ao buscar extrato:', error);
        res.status(500).json({ error: 'Erro ao buscar extrato', message: error.message });
    }
});

// ============================================
// ROTAS - CENTROS DE CUSTO
// ============================================

app.get('/api/financeiro/centros-custo', authenticateToken, async (req, res) => {
    try {
        const [centros] = await pool.execute('SELECT * FROM centros_custo WHERE ativo = 1 ORDER BY nome');
        res.json({ success: true, data: centros });
    } catch (error) {
        console.error('❌ Erro ao buscar centros de custo:', error);
        res.status(500).json({ error: 'Erro ao buscar centros de custo', message: error.message });
    }
});

app.get('/api/financeiro/centros-custo/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [centros] = await pool.execute('SELECT * FROM centros_custo WHERE id = ?', [id]);
        if (centros.length === 0) {
            return res.status(404).json({ error: 'Centro de custo não encontrado' });
        }
        res.json({ success: true, data: centros[0] });
    } catch (error) {
        console.error('❌ Erro ao buscar centro de custo:', error);
        res.status(500).json({ error: 'Erro ao buscar centro de custo', message: error.message });
    }
});

app.post('/api/financeiro/centros-custo', authenticateToken, async (req, res) => {
    try {
        const { nome, responsavel, descricao, orcamento } = req.body;
        
        const [result] = await pool.execute(
            'INSERT INTO centros_custo (nome, responsavel, ativo) VALUES (?, ?, 1)',
            [nome, responsavel]
        );
        
        res.json({ success: true, id: result.insertId, message: 'Centro de custo criado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao criar centro de custo:', error);
        res.status(500).json({ error: 'Erro ao criar centro de custo', message: error.message });
    }
});

app.put('/api/financeiro/centros-custo/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, responsavel, descricao, orcamento, ativo } = req.body;
        
        await pool.execute(
            'UPDATE centros_custo SET nome = ?, responsavel = ?, ativo = ?, updated_at = NOW() WHERE id = ?',
            [nome, responsavel, ativo !== false ? 1 : 0, id]
        );
        
        res.json({ success: true, message: 'Centro de custo atualizado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar centro de custo:', error);
        res.status(500).json({ error: 'Erro ao atualizar centro de custo', message: error.message });
    }
});

app.delete('/api/financeiro/centros-custo/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('UPDATE centros_custo SET ativo = 0 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Centro de custo desativado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir centro de custo:', error);
        res.status(500).json({ error: 'Erro ao excluir centro de custo', message: error.message });
    }
});

// ============================================
// ROTAS - IMPOSTOS/TRIBUTOS
// ============================================

app.get('/api/financeiro/impostos', authenticateToken, async (req, res) => {
    try {
        const [impostos] = await pool.execute('SELECT * FROM impostos WHERE ativo = 1 ORDER BY tipo');
        res.json({ success: true, data: impostos });
    } catch (error) {
        console.error('❌ Erro ao buscar impostos:', error);
        res.status(500).json({ error: 'Erro ao buscar impostos', message: error.message });
    }
});

app.get('/api/financeiro/impostos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [impostos] = await pool.execute('SELECT * FROM impostos WHERE id = ?', [id]);
        if (impostos.length === 0) {
            return res.status(404).json({ error: 'Imposto não encontrado' });
        }
        res.json({ success: true, data: impostos[0] });
    } catch (error) {
        console.error('❌ Erro ao buscar imposto:', error);
        res.status(500).json({ error: 'Erro ao buscar imposto', message: error.message });
    }
});

app.post('/api/financeiro/impostos', authenticateToken, async (req, res) => {
    try {
        const { tipo, aliquota, descricao, base, observacoes } = req.body;
        
        const [result] = await pool.execute(
            'INSERT INTO impostos (tipo, aliquota, descricao, base, observacoes, ativo) VALUES (?, ?, ?, ?, ?, 1)',
            [tipo, aliquota || 0, descricao, base, observacoes]
        );
        
        res.json({ success: true, id: result.insertId, message: 'Imposto criado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao criar imposto:', error);
        res.status(500).json({ error: 'Erro ao criar imposto', message: error.message });
    }
});

app.put('/api/financeiro/impostos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo, aliquota, descricao, base, observacoes, ativo } = req.body;
        
        await pool.execute(
            'UPDATE impostos SET tipo = ?, aliquota = ?, descricao = ?, base = ?, observacoes = ?, ativo = ?, updated_at = NOW() WHERE id = ?',
            [tipo, aliquota || 0, descricao, base, observacoes, ativo !== false ? 1 : 0, id]
        );
        
        res.json({ success: true, message: 'Imposto atualizado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar imposto:', error);
        res.status(500).json({ error: 'Erro ao atualizar imposto', message: error.message });
    }
});

app.delete('/api/financeiro/impostos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('UPDATE impostos SET ativo = 0 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Imposto desativado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir imposto:', error);
        res.status(500).json({ error: 'Erro ao excluir imposto', message: error.message });
    }
});

// ============================================
// ROTAS - CATEGORIAS FINANCEIRAS
// ============================================

app.get('/api/financeiro/categorias', authenticateToken, async (req, res) => {
    try {
        const [categorias] = await pool.execute('SELECT * FROM categorias_financeiras ORDER BY nome');
        res.json({ success: true, data: categorias });
    } catch (error) {
        console.error('❌ Erro ao buscar categorias:', error);
        res.status(500).json({ error: 'Erro ao buscar categorias', message: error.message });
    }
});

// ============================================
// ROTAS ESTÁTICAS
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/contas-pagar', (req, res) => {
    res.sendFile(path.join(__dirname, 'contas-pagar.html'));
});

app.get('/contas-receber', (req, res) => {
    res.sendFile(path.join(__dirname, 'contas-receber.html'));
});

app.get('/fluxo-caixa', (req, res) => {
    res.sendFile(path.join(__dirname, 'fluxo-caixa.html'));
});

app.get('/bancos', (req, res) => {
    res.sendFile(path.join(__dirname, 'bancos.html'));
});

app.get('/relatorios', (req, res) => {
    res.sendFile(path.join(__dirname, 'relatorios.html'));
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((err, req, res, next) => {
    console.error('❌ Erro:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        message: err.message 
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// ============================================
// INICIALIZAÇÃO
// ============================================

async function startServer() {
    try {
        // ============================================
        // ROTAS ADICIONAIS - PARCELAMENTO
        // ============================================
        
        app.post('/api/financeiro/parcelamento', authenticateToken, async (req, res) => {
            try {
                const { tipo, entidade_id, valor_total, num_parcelas, data_inicio, conta_bancaria_id, forma_pagamento, parcelas } = req.body;
                
                // SEGURANÇA: Validar tipo para evitar SQL Injection
                if (!['pagar', 'receber'].includes(tipo)) {
                    return res.status(400).json({ error: 'Tipo inválido. Deve ser "pagar" ou "receber"' });
                }
                
                const connection = await pool.getConnection();
                await connection.beginTransaction();
                
                try {
                    // Criar contas conforme tipo (pagar ou receber)
                    // SEGURANÇA: Valores já validados via whitelist acima
                    const tabela = tipo === 'pagar' ? 'contas_pagar' : 'contas_receber';
                    const campo_entidade = tipo === 'pagar' ? 'fornecedor_id' : 'cliente_id';
                    
                    for (const parcela of parcelas) {
                        const sql = `INSERT INTO ${tabela} (${campo_entidade}, valor, descricao, data_vencimento, status, forma_pagamento, conta_bancaria_id) VALUES (?, ?, ?, ?, 'pendente', ?, ?)`;
                        await connection.execute(sql, [entidade_id, parcela.valor, parcela.descricao, parcela.vencimento, forma_pagamento, conta_bancaria_id]);
                    }
                    
                    await connection.commit();
                    res.json({ success: true, parcelas_criadas: parcelas.length });
                } catch (error) {
                    await connection.rollback();
                    throw error;
                } finally {
                    connection.release();
                }
            } catch (error) {
                console.error('Erro ao criar parcelamento:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // ============================================
        // ROTAS - PERMISSÕES
        // ============================================
        
        app.get('/api/financeiro/permissoes', authenticateToken, async (req, res) => {
            try {
                // Verificar se usuário tem permissões configuradas
                const [permissoes] = await pool.execute(
                    'SELECT * FROM permissoes_modulos WHERE usuario_id = ? AND modulo = "financeiro"',
                    [req.user.id]
                );
                
                // Se não encontrar, retornar permissões padrão baseadas no papel
                if (permissoes.length === 0) {
                    const permissoesPadrao = {
                        admin: { visualizar: true, criar: true, editar: true, excluir: true, aprovar: true },
                        gerente: { visualizar: true, criar: true, editar: true, excluir: false, aprovar: true },
                        usuario: { visualizar: true, criar: false, editar: false, excluir: false, aprovar: false }
                    };
                    
                    const papel = req.user.papel || 'usuario';
                    return res.json(permissoesPadrao[papel] || permissoesPadrao.usuario);
                }
                
                res.json(permissoes[0]);
            } catch (error) {
                console.error('Erro ao buscar permissões:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // ============================================
        // ROTAS - ANEXOS
        // ============================================
        
        // Upload de anexo
        app.post('/api/financeiro/anexos/upload', authenticateToken, upload.single('arquivo'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
                }
                
                const { entidade, entidade_id } = req.body;
                const arquivo = req.file;
                
                // Salvar registro no banco
                const [result] = await pool.execute(
                    `INSERT INTO financeiro_anexos (tipo_entidade, entidade_id, nome_arquivo, caminho_arquivo, tamanho_bytes, tipo_mime, usuario_upload_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [entidade, entidade_id, arquivo.originalname, arquivo.path, arquivo.size, arquivo.mimetype, req.user.id || 1]
                );
                
                res.json({
                    id: result.insertId,
                    nome: arquivo.originalname,
                    tamanho: arquivo.size,
                    tipo: arquivo.mimetype,
                    entidade,
                    entidade_id,
                    url: `/uploads/${arquivo.filename}`,
                    data_upload: new Date().toISOString(),
                    usuario: req.user.nome || 'Usuário'
                });
            } catch (error) {
                console.error('Erro ao fazer upload:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        app.get('/api/financeiro/anexos', authenticateToken, async (req, res) => {
            try {
                const { entidade, entidade_id } = req.query;
                
                const [anexos] = await pool.execute(
                    'SELECT * FROM financeiro_anexos WHERE tipo_entidade = ? AND entidade_id = ? ORDER BY data_upload DESC',
                    [entidade, entidade_id]
                );
                
                res.json({ data: anexos });
            } catch (error) {
                console.error('Erro ao listar anexos:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        app.delete('/api/financeiro/anexos/:id', authenticateToken, async (req, res) => {
            try {
                const { id } = req.params;
                
                await pool.execute('DELETE FROM financeiro_anexos WHERE id = ?', [id]);
                
                res.json({ success: true });
            } catch (error) {
                console.error('Erro ao excluir anexo:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Testar conexão
        const connection = await pool.getConnection();
        console.log('✅ Financeiro conectado ao MySQL Railway');
        connection.release();
        
        app.listen(PORT, () => {
            console.log('🚀 ========================================');
            console.log('🚀 Módulo Financeiro - ALUFORCE');
            console.log('🚀 ========================================');
            console.log(`📡 Servidor rodando na porta ${PORT}`);
            console.log(`🌐 Dashboard: http://localhost:${PORT}`);
            console.log(`💰 Contas a Pagar: http://localhost:${PORT}/contas-pagar`);
            console.log(`💵 Contas a Receber: http://localhost:${PORT}/contas-receber`);
            console.log(`📊 Fluxo de Caixa: http://localhost:${PORT}/fluxo-caixa`);
            console.log(`🏦 Contas Bancárias: http://localhost:${PORT}/bancos`);
            console.log(`📈 Relatórios: http://localhost:${PORT}/relatorios`);
            console.log('🚀 ========================================');
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor Financeiro:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app, pool };
