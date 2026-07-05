/**
 * SERVIDOR FINANCEIRO - ALUFORCE V.2
 * Módulo completo de gestão financeira com integração MySQL
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');

// Auth centralizado (Sprint 7 — Consolidação de Arquitetura)
const { authenticateToken } = require('../../middleware/auth-central');
const { corsOptions } = require('../../config/cors');
const { errorHandler } = require('../../middleware/error-handler');

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

// Corte Temporal Hard Limit 2026 (Dev Spec 1.1)
const { corteTemporalMiddleware, buildCorteClause, CORTE_DATE } = require('../../src/middleware/financeiro-corte-temporal');

const app = express();
const PORT = process.env.PORT_FINANCEIRO || 3006;

// Pool MySQL centralizado (Sprint 7 — usa database/pool.js)
const pool = require('../../database/pool');

// 🔐 AUTHENTICATION: Delegado para middleware/auth-central.js (Sprint 7)

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

// Middlewares (Sprint 7: CORS centralizado em config/cors.js)
app.use(securityHeaders());
app.use(generalLimiter);
app.use(sanitizeInput);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' })); // SEGURANÇA: Limite de payload
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Dev Spec 1.1: Interceptador global de corte temporal
app.use('/api/financeiro', corteTemporalMiddleware);

// ============================================
// ROTA: /api/me — usada por auth-unified.js e financeiro-sidebar.js
// Sem esta rota, auth-unified.js recebe 404, trata como "sessão expirada"
// e redireciona o usuário para login.html incorretamente.
// ============================================
app.get('/api/me', authenticateToken, (req, res) => {
    res.json(req.user);
});

// Compatibilidade: /api/auth/refresh para auth-unified.js (token refresh)
app.post('/api/auth/refresh', async (req, res) => {
    try {
        // Delegar refresh para o módulo de auth central via cookie
        const jwt = require('jsonwebtoken');
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ message: 'Refresh token não encontrado', code: 'AUTH_MISSING' });
        }
        const crypto = require('crypto');
        const JWT_SECRET_BASE = process.env.JWT_SECRET || process.env.SECRET_KEY;
        const JWT_REFRESH_SECRET = process.env.REFRESH_SECRET || 
            crypto.createHmac('sha256', JWT_SECRET_BASE).update('refresh-token-secret').digest('hex');
        try {
            const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
            const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY;
            const accessToken = jwt.sign(
                { id: payload.id, email: payload.email, role: payload.role, nome: payload.nome, is_admin: payload.is_admin },
                JWT_SECRET,
                { algorithm: 'HS256', expiresIn: '15m' }
            );
            res.cookie('authToken', accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 15 * 60 * 1000
            });
            return res.json({ success: true, user: { id: payload.id, email: payload.email, role: payload.role, nome: payload.nome } });
        } catch (jwtErr) {
            return res.status(401).json({ message: 'Refresh token expirado ou inválido', code: 'AUTH_EXPIRED' });
        }
    } catch (err) {
        console.error('[Financeiro] Erro no refresh de token:', err);
        return res.status(500).json({ message: 'Erro interno no refresh', code: 'SERVER_ERROR' });
    }
});

// Servir arquivos estáticos (HTML sem cache para deploy imediato)
app.use('/_shared', express.static(path.join(__dirname, '../../_shared'), { dotfiles: 'deny', index: false }));
app.use('/modules/Financeiro', express.static(__dirname, { dotfiles: 'deny', index: false, setHeaders(res, filePath) { if (filePath.endsWith('.html')) { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); res.setHeader('Pragma', 'no-cache'); } } }));
app.use('/modules/Financeiro/public', express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: false, setHeaders(res, filePath) { if (filePath.endsWith('.html')) { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); res.setHeader('Pragma', 'no-cache'); } } }));

// ============================================
// ROTAS - CONTAS A PAGAR
// ============================================

// Listar contas a pagar
app.get('/api/financeiro/contas-pagar', authenticateToken, async (req, res) => {
    try {
        const { status, fornecedor_id, vencimento_inicio, vencimento_fim, limite = 100 } = req.query;

        // Dev Spec 1.1: Corte temporal 2026 aplicado via middleware
        const corte = req.financeiroCorteTemporal;
        let sql = `SELECT * FROM contas_pagar cp WHERE 1=1${corte ? corte.cpClause('cp') : ''}`;
        const params = [];

        if (status) {
            sql += ' AND cp.status = ?';
            params.push(status);
        }
        if (fornecedor_id) {
            sql += ' AND cp.fornecedor_id = ?';
            params.push(fornecedor_id);
        }
        if (vencimento_inicio) {
            sql += ' AND cp.data_vencimento >= ?';
            params.push(vencimento_inicio);
        }
        if (vencimento_fim) {
            sql += ' AND cp.data_vencimento <= ?';
            params.push(vencimento_fim);
        }

        sql += ' ORDER BY cp.data_vencimento DESC LIMIT ?';
        params.push(parseInt(limite));

        const [contas] = await pool.execute(sql, params);
        res.json({ success: true, data: contas });
    } catch (error) {
        console.error('❌ Erro ao buscar contas a pagar:', error);
        res.status(500).json({ error: 'Erro ao buscar contas a pagar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// UC-FIN-01: Criar Conta a Pagar
// Atores: Analista Financeiro, Gerente Financeiro
// Endpoint: POST /api/financeiro/contas-pagar
// Pré-condição: Usuário autenticado com permissão 'criar'; fornecedor cadastrado
// Pós-condição: Conta criada; incluída no fluxo de caixa projetado; auditoria registrada
app.post('/api/financeiro/contas-pagar', authenticateToken, requireFinancePermission('criar'), async (req, res) => {
    // UC-FIN-01 Cenário Excepcional 1: Guard de idempotência via X-Idempotency-Key
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return res.status(400).json({
            error: 'Header X-Idempotency-Key obrigatório (8-128 caracteres)',
            detail: 'Envie um UUID ou identificador único para prevenir lançamentos duplicados'
        });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Verificar duplicidade pela idempotency key
        const [existing] = await connection.execute(
            'SELECT id FROM contas_pagar WHERE idempotency_key = ? LIMIT 1',
            [idempotencyKey]
        );
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Lançamento duplicado detectado',
                detail: 'Uma conta com esta X-Idempotency-Key já existe',
                id: existing[0].id
            });
        }

        const {
            fornecedor_id,
            descricao,
            valor_total,
            data_emissao,
            data_vencimento,
            numero_documento,
            categoria_id,
            centro_custo_id,
            forma_pagamento,
            observacoes,
            parcelas = 1
        } = req.body;

        // Validar campos obrigatórios (UC-FIN-01 Cenário Básico - Step 2)
        if (!fornecedor_id || !descricao || !valor_total || !data_vencimento) {
            await connection.rollback();
            return res.status(400).json({ error: 'Campos obrigatórios: fornecedor_id, descricao, valor_total, data_vencimento' });
        }

        // SEGURANÇA: Validar valor monetário
        const valorParsed = parseFloat(valor_total);
        if (isNaN(valorParsed) || valorParsed <= 0 || valorParsed > 999999999.99) {
            await connection.rollback();
            return res.status(400).json({ error: 'Valor total inválido. Deve ser maior que 0' });
        }
        const valorSanitizado = Math.round(valorParsed * 100) / 100;

        // SEGURANÇA: Validar formato de datas
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const emissao = data_emissao || new Date().toISOString().split('T')[0];
        if (!dateRegex.test(emissao) || !dateRegex.test(data_vencimento)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
        }

        // Validar que vencimento não é anterior à emissão
        if (new Date(data_vencimento) < new Date(emissao)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Data de vencimento não pode ser anterior à emissão' });
        }

        // Validar fornecedor cadastrado (pré-condição UC-FIN-01)
        const [fornecedor] = await connection.execute(
            'SELECT id, razao_social FROM fornecedores WHERE id = ? LIMIT 1',
            [fornecedor_id]
        );
        if (fornecedor.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Fornecedor não encontrado. Cadastre o fornecedor antes de criar a conta.' });
        }

        // Validar forma de pagamento se fornecida
        const formasPagamentoPermitidas = ['boleto', 'pix', 'ted', 'doc', 'cartao', 'cheque', 'dinheiro', 'debito_automatico', null, undefined, ''];
        if (forma_pagamento && !formasPagamentoPermitidas.includes(forma_pagamento.toLowerCase())) {
            await connection.rollback();
            return res.status(400).json({ error: 'Forma de pagamento inválida' });
        }

        // Validar parcelas
        const numParcelas = parseInt(parcelas, 10);
        if (!Number.isInteger(numParcelas) || numParcelas < 1 || numParcelas > 360) {
            await connection.rollback();
            return res.status(400).json({ error: 'Número de parcelas inválido (1-360)' });
        }

        const idsInseridos = [];

        if (numParcelas === 1) {
            // Cenário Básico: Conta única
            const [result] = await connection.execute(
                `INSERT INTO contas_pagar
                (fornecedor_id, descricao, valor_total, data_emissao, data_vencimento,
                 numero_documento, categoria_id, centro_custo_id, forma_pagamento, observacoes,
                 status, usuario_id, idempotency_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`,
                [fornecedor_id, descricao, valorSanitizado, emissao, data_vencimento,
                 numero_documento, categoria_id, centro_custo_id, forma_pagamento || null, observacoes,
                 req.user.id, idempotencyKey]
            );
            idsInseridos.push(result.insertId);
        } else {
            // UC-FIN-01 Cenário Alternativo 1: Parcelamento
            // Sistema cria uma conta por parcela vinculadas à mesma origem
            const valorParcela = Math.round((valorSanitizado / numParcelas) * 100) / 100;
            const restoCentavos = Math.round((valorSanitizado - (valorParcela * numParcelas)) * 100) / 100;

            for (let i = 1; i <= numParcelas; i++) {
                const vencimentoParcela = new Date(data_vencimento);
                vencimentoParcela.setMonth(vencimentoParcela.getMonth() + (i - 1));
                const vencStr = vencimentoParcela.toISOString().split('T')[0];

                // Última parcela absorve diferença de arredondamento
                const valorEstaParcela = (i === numParcelas) ? valorParcela + restoCentavos : valorParcela;

                const [result] = await connection.execute(
                    `INSERT INTO contas_pagar
                    (fornecedor_id, descricao, valor_total, data_emissao, data_vencimento,
                     numero_documento, categoria_id, centro_custo_id, forma_pagamento, observacoes,
                     status, usuario_id, idempotency_key,
                     parcelado, numero_parcela, total_parcelas)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?,
                     1, ?, ?)`,
                    [fornecedor_id, `${descricao} (${i}/${numParcelas})`,
                     Math.round(valorEstaParcela * 100) / 100, emissao, vencStr,
                     numero_documento ? `${numero_documento}-${i}` : null,
                     categoria_id, centro_custo_id, forma_pagamento || null, observacoes,
                     req.user.id, i === 1 ? idempotencyKey : `${idempotencyKey}-p${i}`,
                     i, numParcelas]
                );
                idsInseridos.push(result.insertId);
            }
        }

        // UC-FIN-01 Pós-condição: Registrar operação em auditoria
        try {
            await connection.execute(
                `INSERT INTO financeiro_auditoria
                (usuario_id, usuario_nome, acao, modulo, entidade, entidade_id,
                 descricao, dados_json, ip_address)
                VALUES (?, ?, 'criar', 'contas_pagar', 'conta_pagar', ?, ?, ?, ?)`,
                [
                    req.user.id,
                    req.user.nome || req.user.name || 'Sistema',
                    'criar',
                    idsInseridos[0],
                    `Conta a pagar criada: ${descricao} - R$ ${valorSanitizado.toFixed(2)} (${numParcelas} parcela${numParcelas > 1 ? 's' : ''})`,
                    JSON.stringify({
                        fornecedor_id, valor_total: valorSanitizado, data_vencimento,
                        parcelas: numParcelas, forma_pagamento, ids: idsInseridos,
                        idempotency_key: idempotencyKey
                    }),
                    req.ip || req.connection?.remoteAddress || 'unknown'
                ]
            );
        } catch (auditErr) {
            console.warn('⚠️ Falha ao registrar auditoria (não-crítico):', auditErr.message);
        }

        await connection.commit();
        res.json({
            success: true,
            id: idsInseridos[0],
            ids: idsInseridos,
            parcelas: numParcelas,
            message: numParcelas > 1
                ? `${numParcelas} parcelas criadas com sucesso`
                : 'Conta a pagar criada com sucesso'
        });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao criar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao criar conta a pagar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao atualizar conta a pagar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao baixar conta a pagar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
app.delete('/api/financeiro/contas-pagar/:id', authenticateToken, requireFinancePermission('excluir'), async (req, res) => {
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
        res.status(500).json({ error: 'Erro ao excluir conta a pagar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar conta a pagar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// ============================================
// ROTAS - CONTAS A RECEBER
// ============================================

// Listar contas a receber
app.get('/api/financeiro/contas-receber', authenticateToken, async (req, res) => {
    try {
        const { status, cliente_id, vencimento_inicio, vencimento_fim, limite = 2000, ano_vigente } = req.query;

        // Dev Spec 1.1: Corte temporal 2026 aplicado via middleware
        const corte = req.financeiroCorteTemporal;
        let sql = `SELECT cr.*,
                          COALESCE(cr.cliente_nome, c.nome) as cliente_nome,
                          COALESCE(cr.cnpj_cliente, c.cnpj_cpf) as cnpj_cpf,
                          cr.cnpj_empresa,
                          COALESCE(cr.valor, 0) as valor_total,
                          cr.forma_recebimento,
                          cr.empresa, cr.nota_fiscal, cr.parcela_info,
                          cr.data_emissao, cr.categoria_nome as categoria, cr.conta_corrente_nome as centro_receita,
                          cr.numero_documento, cr.numero_boleto, cr.vendedor,
                          cr.projeto, cr.situacao, cr.portador,
                          cr.valor_pis, cr.valor_cofins, cr.valor_csll,
                          cr.valor_ir, cr.valor_iss, cr.valor_inss,
                          (cr.valor - COALESCE(cr.valor_pis,0) - COALESCE(cr.valor_cofins,0) - COALESCE(cr.valor_csll,0) - COALESCE(cr.valor_ir,0) - COALESCE(cr.valor_iss,0) - COALESCE(cr.valor_inss,0)) as valor_liquido,
                          cr.valor_recebido,
                          (cr.valor - COALESCE(cr.valor_recebido,0)) as a_receber,
                          cr.dias_vencido,
                          cr.pago_no_dia, cr.aceita_troca_factory,
                          cr.comprovante_url,
                          cr.dia_recomprado, cr.data_para_cartorio, cr.data_protestado,
                          cr.origem_integracao
                   FROM contas_receber cr
                   LEFT JOIN clientes c ON cr.cliente_id = c.id
                   WHERE 1=1${corte ? corte.crClause('cr') : ''}`;
        const params = [];

        // Dev Spec 1.3: Filtrar notas do ano vigente + parcelas futuras
        if (ano_vigente === '1') {
            const anoAtual = new Date().getFullYear();
            sql += ` AND (YEAR(cr.data_emissao) = ? OR cr.data_vencimento >= CURDATE())`;
            params.push(anoAtual);
        }

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
        res.status(500).json({ error: 'Erro ao buscar contas a receber', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Dev Spec 1.3: Estatísticas de contas a receber
app.get('/api/financeiro/contas-receber/estatisticas', authenticateToken, async (req, res) => {
    try {
        const [totais] = await pool.execute(`
            SELECT
                COALESCE(SUM(CASE WHEN status NOT IN ('recebido','pago','liquidado','cancelada') THEN COALESCE(NULLIF(a_receber,0), valor - COALESCE(valor_recebido,0)) ELSE 0 END), 0) as total_receber,
                COALESCE(SUM(CASE WHEN status NOT IN ('recebido','pago','liquidado','cancelada') AND data_vencimento >= CURDATE() THEN COALESCE(NULLIF(a_receber,0), valor - COALESCE(valor_recebido,0)) ELSE 0 END), 0) as vencendo,
                COALESCE(SUM(CASE WHEN status NOT IN ('recebido','pago','liquidado','cancelada') AND data_vencimento < CURDATE() THEN COALESCE(NULLIF(a_receber,0), valor - COALESCE(valor_recebido,0)) ELSE 0 END), 0) as vencidas,
                COALESCE(SUM(CASE WHEN status IN ('recebido','pago','liquidado') THEN COALESCE(NULLIF(valor_recebido,0), valor) ELSE 0 END), 0) as recebidas_mes
            FROM contas_receber
            WHERE YEAR(data_emissao) >= YEAR(CURDATE()) OR data_vencimento >= CURDATE()
        `);
        res.json(totais[0] || { total_receber: 0, vencendo: 0, vencidas: 0, recebidas_mes: 0 });
    } catch (error) {
        console.error('❌ Erro estatísticas CR:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Dev Spec 1.3: Receber conta (alias para baixar)
app.post('/api/financeiro/contas-receber/:id/receber', authenticateToken, async (req, res, next) => {
    req.url = req.url.replace('/receber', '/baixar');
    next();
});

// Criar conta a receber
app.post('/api/financeiro/contas-receber', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            cliente_id,
            descricao,
            valor_total, valor,
            data_emissao,
            data_vencimento, vencimento,
            numero_documento,
            categoria_id,
            observacoes,
            forma_recebimento,
            num_parcelas,
            status,
            pago_no_dia,
            aceita_troca_factory
        } = req.body;

        const valorFinal = valor_total || valor;

        // AUDITORIA ENTERPRISE: Validar valor monetário
        const valorParsed = parseFloat(valorFinal);
        if (isNaN(valorParsed) || valorParsed <= 0 || valorParsed > 999999999.99) {
            return res.status(400).json({ error: 'Valor total inválido. Deve ser maior que 0' });
        }
        const valorSanitizado = Math.round(valorParsed * 100) / 100;

        const vencFinal = data_vencimento || vencimento;
        const emissaoFinal = data_emissao || new Date().toISOString().slice(0, 10);

        // AUDITORIA ENTERPRISE: Validar formato de datas
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(emissaoFinal) || !dateRegex.test(vencFinal)) {
            return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
        }

        // Dev Spec 1.3: Status válidos
        const statusFinal = status || 'a_vencer';
        const STATUS_VALIDOS = ['cancelada', 'liquidada', 'vencida', 'a_vencer', 'pendente'];
        if (!STATUS_VALIDOS.includes(statusFinal)) {
            return res.status(400).json({ error: `Status inválido. Valores permitidos: ${STATUS_VALIDOS.join(', ')}` });
        }

        const [result] = await connection.execute(
            `INSERT INTO contas_receber
            (cliente_id, descricao, valor, valor_total, data_emissao, data_vencimento,
             numero_documento, categoria_id, observacoes, status, usuario_id,
             forma_recebimento, pago_no_dia, aceita_troca_factory, a_receber)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cliente_id, descricao, valorSanitizado, valorSanitizado, emissaoFinal, vencFinal,
             numero_documento, categoria_id, observacoes, statusFinal, req.user.id,
             forma_recebimento, pago_no_dia || null,
             aceita_troca_factory ? 1 : 0, valorSanitizado]
        );

        await connection.commit();
        res.json({ success: true, id: result.insertId, message: 'Conta a receber criada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro ao criar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao criar conta a receber', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    } finally {
        connection.release();
    }
});

// Dev Spec 1.3: Importar Excel de contas a receber
app.post('/api/financeiro/contas-receber/importar-excel', authenticateToken, upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(req.file.path);

        // Auto-detect best sheet: prefer FATURAMENTO, then first sheet
        const preferredSheets = ['FATURAMENTO', 'A RECEBER', 'CONTAS A RECEBER'];
        let sheetName = workbook.SheetNames[0];
        for (const pref of preferredSheets) {
            if (workbook.SheetNames.includes(pref)) { sheetName = pref; break; }
        }
        const sheet = workbook.Sheets[sheetName];
        console.log('[IMPORTAR-CR] Usando aba:', sheetName, '| Abas disponíveis:', workbook.SheetNames.join(', '));

        // Read raw rows (array of arrays) to auto-detect header row
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
        if (!rawData || rawData.length < 2) {
            throw new Error('Arquivo vazio ou sem dados');
        }

        // Detect header row: find row containing known keywords
        const HEADER_KEYWORDS = ['EMPRESA', 'CLIENTE', 'CNPJ', 'VALOR', 'VCTO', 'NFe', 'EMISSÃO', 'EMISSAO', 'Empresa', 'Cliente', 'Vencimento'];
        let headerRowIdx = 0;
        for (let i = 0; i < Math.min(rawData.length, 15); i++) {
            const row = rawData[i];
            if (!row) continue;
            const rowStr = row.map(c => String(c || '')).join('|').toUpperCase();
            const matches = HEADER_KEYWORDS.filter(kw => rowStr.includes(kw.toUpperCase()));
            if (matches.length >= 3) { headerRowIdx = i; break; }
        }
        const headers = (rawData[headerRowIdx] || []).map(h => String(h || '').trim());
        console.log('[IMPORTAR-CR] Header na linha:', headerRowIdx + 1, '| Colunas:', headers.join(', '));

        // Column name mapping: Excel header → DB field
        // Supports both ALUFORCE FATURAMENTO and standard templates
        const COLUMN_MAP = {
            'EMPRESA': 'empresa', 'Empresa': 'empresa', 'empresa': 'empresa',
            'EMISSÃO': 'data_emissao', 'Emissão': 'data_emissao', 'Emissao': 'data_emissao', 'emissao': 'data_emissao', 'Data de Emissão': 'data_emissao',
            'TIPO': 'tipo_documento', 'Tipo': 'tipo_documento', 'tipo': 'tipo_documento', 'Tipo de Documento': 'tipo_documento',
            'NFe': 'nota_fiscal', 'nfe': 'nota_fiscal', 'Nota Fiscal': 'nota_fiscal', 'NF': 'nota_fiscal',
            'P': 'parcela_info', 'Parcela': 'parcela_info', 'parcela': 'parcela_info',
            'CLIENTE': 'cliente_nome', 'Cliente': 'cliente_nome', 'cliente': 'cliente_nome',
            'CNPJ': 'cnpj_cliente', 'cnpj': 'cnpj_cliente', 'CNPJ/CPF': 'cnpj_cliente',
            'VALOR P': 'valor', 'Valor': 'valor', 'valor': 'valor', 'Valor da Conta': 'valor',
            'VCTO': 'data_vencimento', 'Vencimento': 'data_vencimento', 'vencimento': 'data_vencimento', 'Data de Vencimento': 'data_vencimento',
            'SITUAÇÃO': 'situacao', 'Situação': 'situacao', 'Situacao': 'situacao', 'situacao': 'situacao',
            'PORTADOR': 'portador', 'Portador': 'portador', 'portador': 'portador',
            'DATA': 'data_operacao',
            'STATUS': 'status', 'Status': 'status', 'status': 'status',
            'DIAS': 'dias_vencido',
            'POSIÇÃO': 'posicao', 'Posição': 'posicao',
            'RECOMPRADO': 'recomprado',
            'CARTORIO': 'cartorio',
            'OBSERVAÇÃO': 'observacoes', 'Observação': 'observacoes', 'Observacao': 'observacoes', 'Observações': 'observacoes',
            'ACEITA TROCA  FACTORY': 'aceita_troca', 'ACEITA TROCA FACTORY': 'aceita_troca',
            'COMISSÁRIA': 'comissaria', 'COMISSARIA': 'comissaria',
            'Vendedor': 'vendedor', 'VENDEDOR': 'vendedor',
            'Conta Corrente': 'conta_corrente_nome', 'CONTA CORRENTE': 'conta_corrente_nome',
            'Categoria': 'categoria_nome', 'CATEGORIA': 'categoria_nome',
            'Número do Documento': 'numero_documento', 'DOCUMENTO': 'numero_documento',
            'Número do Boleto': 'numero_boleto', 'BOLETO': 'numero_boleto',
            'Projeto': 'projeto', 'PROJETO': 'projeto',
            'PIS': 'valor_pis', 'COFINS': 'valor_cofins', 'CSLL': 'valor_csll',
            'IR': 'valor_ir', 'ISS': 'valor_iss', 'INSS': 'valor_inss'
        };

        // Build column index mapping
        const colMap = {}; // { dbField: colIndex }
        for (let i = 0; i < headers.length; i++) {
            const mapped = COLUMN_MAP[headers[i]];
            if (mapped && !(mapped in colMap)) colMap[mapped] = i;
        }
        console.log('[IMPORTAR-CR] Mapeamento:', JSON.stringify(colMap));

        const getVal = (row, field) => {
            if (!(field in colMap)) return null;
            const v = row[colMap[field]];
            return (v !== undefined && v !== null && v !== '') ? v : null;
        };

        // Converter datas Excel
        const parseData = (d) => {
            if (!d) return null;
            if (d instanceof Date) return d.toISOString().slice(0, 10);
            if (typeof d === 'number') {
                const dt = XLSX.SSF.parse_date_code(d);
                if (dt) return `${dt.y}-${String(dt.m).padStart(2,'0')}-${String(dt.d).padStart(2,'0')}`;
            }
            const s = String(d).trim();
            const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
            return null;
        };

        const parseValor = (v) => {
            if (!v) return 0;
            if (typeof v === 'number') return v;
            const s = String(v).replace(/[^\d,.-]/g, '').replace(',', '.');
            return parseFloat(s) || 0;
        };

        // Delete previous imports (importacao_excel + broken records with all key fields NULL)
        const [delResult] = await pool.execute(`DELETE FROM contas_receber WHERE
            origem_integracao = 'importacao_excel'
            OR (empresa IS NULL AND nota_fiscal IS NULL AND cnpj_cliente IS NULL AND data_emissao IS NULL AND origem_integracao = 'manual')`);
        console.log('[IMPORTAR-CR] Registros anteriores removidos:', delResult.affectedRows);

        let importados = 0;
        let erros = 0;
        let erroDetalhe = [];

        for (let i = headerRowIdx + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || row.length === 0) continue;

            try {
                const cliente = getVal(row, 'cliente_nome');
                const valorRaw = getVal(row, 'valor');
                const valor = parseValor(valorRaw);

                // Skip empty/header/total rows
                if (!cliente && !valor) continue;
                if (String(cliente || '').toUpperCase() === 'CLIENTE') continue;
                if (String(getVal(row, 'empresa') || '').toUpperCase() === 'DADOS DA NF') continue;

                const empresa = String(getVal(row, 'empresa') || '').trim();
                const nfe = String(getVal(row, 'nota_fiscal') || '').trim();
                const parcela = String(getVal(row, 'parcela_info') || '').trim();
                const cnpj = String(getVal(row, 'cnpj_cliente') || '').trim();
                const emissao = parseData(getVal(row, 'data_emissao'));
                const vencimento = parseData(getVal(row, 'data_vencimento'));
                const situacao = String(getVal(row, 'situacao') || '').trim();
                const portador = String(getVal(row, 'portador') || '').trim();
                const dataOp = parseData(getVal(row, 'data_operacao'));
                const statusRaw = String(getVal(row, 'status') || '').trim().toUpperCase();
                const diasRaw = getVal(row, 'dias_vencido');
                const dias = diasRaw ? parseInt(diasRaw) || 0 : null;
                const posicao = String(getVal(row, 'posicao') || '').trim();
                const recomprado = String(getVal(row, 'recomprado') || '').trim();
                const cartorio = String(getVal(row, 'cartorio') || '').trim();
                const obs = String(getVal(row, 'observacoes') || '').trim();
                const aceitaTroca = String(getVal(row, 'aceita_troca') || '').trim();
                const comissaria = String(getVal(row, 'comissaria') || '').trim();
                const tipoDoc = String(getVal(row, 'tipo_documento') || '').trim();
                const vendedor = String(getVal(row, 'vendedor') || '').trim();
                const contaCorrente = String(getVal(row, 'conta_corrente_nome') || '').trim();
                const categoria = String(getVal(row, 'categoria_nome') || '').trim();
                const numDocumento = String(getVal(row, 'numero_documento') || '').trim();
                const numBoleto = String(getVal(row, 'numero_boleto') || '').trim();
                const projeto = String(getVal(row, 'projeto') || '').trim();

                const pis = parseValor(getVal(row, 'valor_pis'));
                const cofins = parseValor(getVal(row, 'valor_cofins'));
                const csll = parseValor(getVal(row, 'valor_csll'));
                const ir = parseValor(getVal(row, 'valor_ir'));
                const iss = parseValor(getVal(row, 'valor_iss'));
                const inss = parseValor(getVal(row, 'valor_inss'));

                // Map status: LIQUIDADO→liquidada, VENCIDO→vencida, A VENCER→a_vencer
                let statusFinal = 'a_vencer';
                if (statusRaw === 'LIQUIDADO' || statusRaw === 'LIQUIDADA') statusFinal = 'liquidada';
                else if (statusRaw === 'VENCIDO' || statusRaw === 'VENCIDA') statusFinal = 'vencida';
                else if (statusRaw === 'A VENCER') statusFinal = 'a_vencer';
                else if (statusRaw === 'RECOMPRADO' || statusRaw === 'RECOMPRADA') statusFinal = 'liquidada';
                else if (statusRaw) statusFinal = statusRaw.toLowerCase().replace(/ /g, '_');

                const emissaoFinal = emissao || new Date().toISOString().slice(0,10);
                const vencimentoFinal = vencimento || emissaoFinal;
                const valorLiquido = valor - pis - cofins - csll - ir - iss - inss;

                await pool.execute(
                    `INSERT INTO contas_receber
                     (empresa, nota_fiscal, parcela_info, cliente_nome, cnpj_cliente,
                      data_emissao, data_vencimento, valor, tipo_documento,
                      situacao, portador, data_operacao, status, dias_vencido,
                      posicao, recomprado, cartorio, observacoes,
                      aceita_troca, comissaria, vendedor,
                      conta_corrente_nome, categoria_nome, numero_documento, numero_boleto, projeto,
                      valor_pis, valor_cofins, valor_csll, valor_ir, valor_iss, valor_inss,
                      valor_liquido, a_receber, origem_integracao)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'importacao_excel')`,
                    [empresa || null, nfe || null, parcela || null, cliente || null, cnpj || null,
                     emissaoFinal, vencimentoFinal, valor, tipoDoc || null,
                     situacao || null, portador || null, dataOp, statusFinal, dias,
                     posicao || null, recomprado || null, cartorio || null, obs || null,
                     aceitaTroca || null, comissaria || null, vendedor || null,
                     contaCorrente || null, categoria || tipoDoc || null, numDocumento || null, numBoleto || null, projeto || null,
                     pis, cofins, csll, ir, iss, inss,
                     valorLiquido, valorLiquido]
                );
                importados++;
            } catch (e) {
                erros++;
                erroDetalhe.push({ linha: i + 1, erro: e.message });
                console.error(`Erro importando linha ${i + 1}:`, e.message);
            }
        }

        // Limpar arquivo temporário
        try { fs.unlinkSync(req.file.path); } catch(e) {}

        console.log('[IMPORTAR-CR] Concluído:', importados, 'importados |', erros, 'erros | Aba:', sheetName);
        res.json({ success: true, importados, erros, sheet: sheetName, erroDetalhe: erroDetalhe.slice(0, 10) });
    } catch (error) {
        console.error('❌ Erro ao importar Excel:', error);
        res.status(500).json({ error: 'Erro ao importar arquivo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Importar contas a receber via JSON (frontend faz parse do Excel e envia array)
app.post('/api/financeiro/contas-receber/importar-json', authenticateToken, async (req, res) => {
    try {
        const { dados } = req.body;
        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Dados inválidos. Envie um array de registros em "dados".' });
        }
        if (dados.length > 5000) {
            return res.status(400).json({ error: 'Limite de 5000 registros por importação' });
        }

        // Remover imports anteriores
        await pool.execute(`DELETE FROM contas_receber WHERE origem_integracao = 'importacao_excel'`);

        let importados = 0;
        const erros = [];

        for (let i = 0; i < dados.length; i++) {
            const row = dados[i];
            try {
                const valor = parseFloat(row.valor) || 0;
                if (valor <= 0) continue;

                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                const emissao = row.data_emissao && dateRegex.test(row.data_emissao) ? row.data_emissao : new Date().toISOString().slice(0, 10);
                const vencimento = row.data_vencimento && dateRegex.test(row.data_vencimento) ? row.data_vencimento : emissao;

                const statusMap = { 'liquidado': 'liquidada', 'liquidada': 'liquidada', 'vencido': 'vencida', 'vencida': 'vencida', 'a vencer': 'a_vencer' };
                const statusFinal = statusMap[String(row.status || '').toLowerCase()] || 'a_vencer';

                await pool.execute(
                    `INSERT INTO contas_receber
                     (empresa, nota_fiscal, parcela_info, cliente_nome, cnpj_cliente,
                      data_emissao, data_vencimento, valor, tipo_documento,
                      situacao, portador, data_operacao, status, dias_vencido,
                      posicao, observacoes, origem_integracao)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'importacao_excel')`,
                    [
                        row.empresa || null, row.nota_fiscal || null, row.parcela_info || null,
                        row.cliente_nome || null, row.cnpj_cliente || null,
                        emissao, vencimento, valor, row.tipo || null,
                        row.situacao || null, row.portador || null, row.data_operacao || null,
                        statusFinal, parseInt(row.dias_vencido) || null,
                        row.posicao || null, row.observacoes || null
                    ]
                );
                importados++;
            } catch (e) {
                erros.push({ linha: i + 1, erro: e.message });
            }
        }

        res.json({ success: true, importados, erros: erros.slice(0, 10) });
    } catch (error) {
        console.error('❌ Erro ao importar contas a receber (JSON):', error);
        res.status(500).json({ error: 'Erro ao importar', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
            cliente_id,
            cliente_nome,
            cnpj_cpf,
            descricao,
            categoria, categoria_id,
            centro_receita,
            valor_total, valor,
            data_vencimento,
            competencia,
            forma_recebimento,
            conta_bancaria,
            numero_documento,
            dias_lembrete,
            recorrencia,
            status,
            nota_fiscal,
            data_emissao,
            data_registro,
            projeto,
            vendedor,
            previsao_recebimento,
            valor_pis, valor_cofins, valor_csll,
            valor_ir, valor_iss, valor_inss,
            // Dev Spec 1.3: Novos campos CR
            pago_no_dia,
            aceita_troca_factory,
            comprovante_url,
            dia_recomprado,
            data_para_cartorio,
            data_protestado
        } = req.body;

        // Suportar 'observações' (com acento) e 'observacoes' (sem acento)
        const observacoes = req.body.observacoes !== undefined ? req.body.observacoes
                          : req.body['observações'] !== undefined ? req.body['observações']
                          : undefined;
        // Suportar 'data_para_cartório' (com acento)
        const dataCartorio = data_para_cartorio !== undefined ? data_para_cartorio
                           : req.body['data_para_cartório'] !== undefined ? req.body['data_para_cartório']
                           : undefined;

        // AUDITORIA ENTERPRISE: Validar valor monetário se fornecido
        const valorFinal = valor_total || valor;
        let valorSanitizado = null;
        if (valorFinal !== undefined && valorFinal !== null) {
            const valorParsed = parseFloat(valorFinal);
            if (isNaN(valorParsed) || valorParsed < 0 || valorParsed > 999999999.99) {
                return res.status(400).json({ error: 'Valor total inválido' });
            }
            valorSanitizado = Math.round(valorParsed * 100) / 100;
        }

        // AUDITORIA ENTERPRISE: Validar data se fornecida
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (data_vencimento) {
            if (!dateRegex.test(data_vencimento)) {
                return res.status(400).json({ error: 'Data de vencimento inválida (YYYY-MM-DD)' });
            }
        }

        // Dev Spec 1.3: Validar pago_no_dia (não pode ser futuro)
        if (pago_no_dia) {
            if (!dateRegex.test(pago_no_dia)) {
                return res.status(400).json({ error: 'Data de pagamento inválida (YYYY-MM-DD)' });
            }
            if (new Date(pago_no_dia) > new Date()) {
                return res.status(400).json({ error: 'Data de pagamento não pode ser futura' });
            }
        }

        // Dev Spec 1.3: Validar status estrito
        const STATUS_VALIDOS_CR = ['cancelada', 'liquidada', 'vencida', 'a_vencer'];
        if (status && !STATUS_VALIDOS_CR.includes(status)) {
            return res.status(400).json({ error: `Status inválido. Valores permitidos: ${STATUS_VALIDOS_CR.join(', ')}` });
        }

        // Validar datas opcionais
        for (const [campo, val] of [['dia_recomprado', dia_recomprado], ['data_para_cartorio', dataCartorio], ['data_protestado', data_protestado]]) {
            if (val && !dateRegex.test(val)) {
                return res.status(400).json({ error: `${campo} inválida (YYYY-MM-DD)` });
            }
        }

        await pool.execute(
            `UPDATE contas_receber SET
                cliente_id = COALESCE(?, cliente_id),
                descricao = COALESCE(?, descricao),
                valor = COALESCE(?, valor),
                data_vencimento = COALESCE(?, data_vencimento),
                forma_recebimento = COALESCE(?, forma_recebimento),
                observacoes = COALESCE(?, observacoes),
                status = COALESCE(?, status),
                pago_no_dia = COALESCE(?, pago_no_dia),
                aceita_troca_factory = COALESCE(?, aceita_troca_factory),
                comprovante_url = COALESCE(?, comprovante_url),
                dia_recomprado = COALESCE(?, dia_recomprado),
                data_para_cartorio = COALESCE(?, data_para_cartorio),
                data_protestado = COALESCE(?, data_protestado),
                nota_fiscal = COALESCE(?, nota_fiscal),
                data_emissao = COALESCE(?, data_emissao),
                numero_documento = COALESCE(?, numero_documento),
                categoria_id = COALESCE(?, categoria_id),
                projeto = COALESCE(?, projeto),
                vendedor = COALESCE(?, vendedor),
                valor_pis = COALESCE(?, valor_pis),
                valor_cofins = COALESCE(?, valor_cofins),
                valor_csll = COALESCE(?, valor_csll),
                valor_ir = COALESCE(?, valor_ir),
                valor_iss = COALESCE(?, valor_iss),
                valor_inss = COALESCE(?, valor_inss)
             WHERE id = ?`,
            [
                cliente_id || null, descricao, valorSanitizado, data_vencimento, forma_recebimento,
                observacoes !== undefined ? observacoes : null,
                status, pago_no_dia || null,
                aceita_troca_factory !== undefined ? (aceita_troca_factory ? 1 : 0) : null,
                comprovante_url, dia_recomprado || null, dataCartorio || null, data_protestado || null,
                nota_fiscal || null, data_emissao || null, numero_documento || null,
                categoria_id || null, projeto || null, vendedor || null,
                valor_pis !== undefined ? (parseFloat(valor_pis) || 0) : null,
                valor_cofins !== undefined ? (parseFloat(valor_cofins) || 0) : null,
                valor_csll !== undefined ? (parseFloat(valor_csll) || 0) : null,
                valor_ir !== undefined ? (parseFloat(valor_ir) || 0) : null,
                valor_iss !== undefined ? (parseFloat(valor_iss) || 0) : null,
                valor_inss !== undefined ? (parseFloat(valor_inss) || 0) : null,
                idParsed
            ]
        );

        res.json({ success: true, message: 'Conta atualizada com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta a receber', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// DELETE - Excluir conta a receber
app.delete('/api/financeiro/contas-receber/:id', authenticateToken, requireFinancePermission('excluir'), async (req, res) => {
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
        res.status(500).json({ error: 'Erro ao excluir conta a receber', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Dev Spec 1.3: Upload de comprovante para conta a receber
app.post('/api/financeiro/contas-receber/:id/comprovante', authenticateToken, upload.single('comprovante'), async (req, res) => {
    try {
        const { id } = req.params;
        const idParsed = parseInt(id, 10);
        if (!Number.isInteger(idParsed) || idParsed <= 0) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const comprovante_url = `/uploads/${req.file.filename}`;

        await pool.execute(
            'UPDATE contas_receber SET comprovante_url = ? WHERE id = ?',
            [comprovante_url, idParsed]
        );

        res.json({ success: true, comprovante_url, message: 'Comprovante enviado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao fazer upload do comprovante:', error);
        res.status(500).json({ error: 'Erro ao fazer upload', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// GET - Obter conta a receber específica
app.get('/api/financeiro/contas-receber/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Dev Spec 2.3: Retornar objeto completo (parcelas, recebimentos, histórico)
        const [contas] = await pool.execute(
            `SELECT cr.*, c.nome as cliente_nome, c.cnpj_cpf,
                    cr.pago_no_dia, cr.aceita_troca_factory, cr.comprovante_url,
                    cr.dia_recomprado, cr.data_para_cartorio, cr.data_protestado,
                    cr.origem_integracao
             FROM contas_receber cr
             LEFT JOIN clientes c ON cr.cliente_id = c.id
             WHERE cr.id = ?`,
            [id]
        );

        if (contas.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        const conta = contas[0];

        // Buscar parcelas vinculadas
        let parcelas = [];
        try {
            const [p] = await pool.execute(
                `SELECT * FROM contas_receber_parcelas WHERE conta_receber_id = ? ORDER BY numero_parcela`,
                [id]
            );
            parcelas = p;
        } catch (e) { /* tabela pode não existir */ }

        // Buscar recebimentos (histórico de movimentações)
        let recebimentos = [];
        try {
            const [r] = await pool.execute(
                `SELECT fr.*, cb.nome as banco_nome
                 FROM financeiro_recebimentos fr
                 LEFT JOIN contas_bancarias cb ON fr.conta_bancaria_id = cb.id
                 WHERE fr.conta_receber_id = ?
                 ORDER BY fr.data_recebimento DESC`,
                [id]
            );
            recebimentos = r;
        } catch (e) { /* tabela pode não existir */ }

        // Buscar itens da nota (se vinculada a NFe)
        let itens_nota = [];
        if (conta.nfe_id) {
            try {
                const [items] = await pool.execute(
                    `SELECT * FROM nfe_itens WHERE nfe_id = ?`, [conta.nfe_id]
                );
                itens_nota = items;
            } catch (e) { /* tabela pode não existir */ }
        }

        res.json({
            success: true,
            data: {
                ...conta,
                parcelas,
                recebimentos,
                itens_nota
            }
        });
    } catch (error) {
        console.error('❌ Erro ao buscar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao buscar conta a receber', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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

        // AUDIT-FIX R3: FOR UPDATE para evitar race condition de double-payment
        const [conta] = await connection.execute('SELECT status, valor FROM contas_receber WHERE id = ? FOR UPDATE', [idParsed]);
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
        res.status(500).json({ error: 'Erro ao baixar conta a receber', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar contas bancárias', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao criar conta bancária', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// ============================================
// ROTAS - DASHBOARD E RELATÓRIOS
// ============================================

app.get('/api/financeiro/dashboard', authenticateToken, async (req, res) => {
    try {
        // Dev Spec 1.1: Corte temporal 2026
        const cpCorte = ` AND ${buildCorteClause('cp', { incluirParcelasFuturas: true })}`;
        const crCorte = ` AND ${buildCorteClause('cr', { incluirParcelasFuturas: true })}`;

        const [totalPagar] = await pool.execute(
            `SELECT SUM(valor_total) as total FROM contas_pagar cp WHERE status = 'pendente'${cpCorte}`
        );

        const [totalReceber] = await pool.execute(
            `SELECT SUM(valor_total) as total FROM contas_receber cr WHERE status = 'pendente'${crCorte}`
        );

        const [vencidosPagar] = await pool.execute(
            `SELECT COUNT(*) as total FROM contas_pagar cp WHERE status = 'pendente' AND data_vencimento < CURDATE()${cpCorte}`
        );

        const [vencidosReceber] = await pool.execute(
            `SELECT COUNT(*) as total FROM contas_receber cr WHERE status = 'pendente' AND data_vencimento < CURDATE()${crCorte}`
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
        res.status(500).json({ error: 'Erro ao buscar dashboard', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Relatório DRE
app.get('/api/financeiro/relatorios/dre', authenticateToken, async (req, res) => {
    try {
        const { inicio, fim, periodo } = req.query;

        const [receitas] = await pool.execute(
            `SELECT SUM(valor_recebido) as total
             FROM contas_receber cr
             WHERE cr.status = 'recebido' AND cr.data_recebimento BETWEEN ? AND ?
             AND ${buildCorteClause('cr', { incluirParcelasFuturas: true })}`,
            [inicio, fim]
        );

        const [despesas] = await pool.execute(
            `SELECT SUM(valor_pago) as total
             FROM contas_pagar cp
             WHERE cp.status = 'pago' AND cp.data_pagamento BETWEEN ? AND ?
             AND ${buildCorteClause('cp', { incluirParcelasFuturas: true })}`,
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
        res.status(500).json({ error: 'Erro ao gerar DRE', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Fluxo de caixa
app.get('/api/financeiro/fluxo-caixa', authenticateToken, async (req, res) => {
    try {
        const { inicio, fim } = req.query;

        // Dev Spec 1.1: Corte temporal 2026
        const crCorte = ` AND ${buildCorteClause('cr', { incluirParcelasFuturas: true })}`;
        const cpCorte = ` AND ${buildCorteClause('cp', { incluirParcelasFuturas: true })}`;

        const [entradas] = await pool.execute(
            `SELECT DATE(cr.data_recebimento) as data, SUM(cr.valor_recebido) as total
             FROM contas_receber cr
             WHERE cr.status = 'recebido' AND cr.data_recebimento BETWEEN ? AND ?${crCorte}
             GROUP BY DATE(cr.data_recebimento)
             ORDER BY data`,
            [inicio, fim]
        );

        const [saidas] = await pool.execute(
            `SELECT DATE(cp.data_pagamento) as data, SUM(cp.valor_pago) as total
             FROM contas_pagar cp
             WHERE cp.status = 'pago' AND cp.data_pagamento BETWEEN ? AND ?${cpCorte}
             GROUP BY DATE(cp.data_pagamento)
             ORDER BY data`,
            [inicio, fim]
        );

        res.json({ success: true, data: { entradas, saidas } });
    } catch (error) {
        console.error('❌ Erro ao buscar fluxo de caixa:', error);
        res.status(500).json({ error: 'Erro ao buscar fluxo de caixa', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Fluxo de caixa - Resumo (próximos N dias)
// Supports both /fluxo-caixa-resumo and /fluxo-caixa/resumo
app.get(['/api/financeiro/fluxo-caixa-resumo', '/api/financeiro/fluxo-caixa/resumo'], authenticateToken, async (req, res) => {
    try {
        const periodo = req.query.periodo || '30d';
        const dias = parseInt(periodo) || 30;
        const hoje = new Date();
        const fim = new Date(hoje);
        fim.setDate(fim.getDate() + dias);

        const inicioStr = hoje.toISOString().slice(0, 10);
        const fimStr = fim.toISOString().slice(0, 10);

        const [bancos] = await pool.execute(
            'SELECT COALESCE(SUM(saldo_atual), 0) as saldo FROM bancos WHERE status = "ativo" AND considera_fluxo = 1'
        );
        const saldoInicial = bancos[0]?.saldo || 0;

        const [entradas] = await pool.execute(
            `SELECT DATE(data_vencimento) as data, SUM(valor) as entradas
             FROM contas_receber cr
             WHERE cr.status IN ('aberto','parcial') AND cr.data_vencimento BETWEEN ? AND ?
             AND ${buildCorteClause('cr', { incluirParcelasFuturas: true })}
             GROUP BY DATE(data_vencimento) ORDER BY data`,
            [inicioStr, fimStr]
        );

        const [saidas] = await pool.execute(
            `SELECT DATE(data_vencimento) as data, SUM(valor) as saidas
             FROM contas_pagar cp
             WHERE cp.status IN ('aberto','parcial') AND cp.data_vencimento BETWEEN ? AND ?
             AND ${buildCorteClause('cp', { incluirParcelasFuturas: true })}
             GROUP BY DATE(data_vencimento) ORDER BY data`,
            [inicioStr, fimStr]
        );

        const mapaFluxo = new Map();
        for (const e of entradas) {
            const d = String(e.data).slice(0, 10);
            if (!mapaFluxo.has(d)) mapaFluxo.set(d, { data: d, entradas: 0, saidas: 0 });
            mapaFluxo.get(d).entradas = parseFloat(e.entradas) || 0;
        }
        for (const s of saidas) {
            const d = String(s.data).slice(0, 10);
            if (!mapaFluxo.has(d)) mapaFluxo.set(d, { data: d, entradas: 0, saidas: 0 });
            mapaFluxo.get(d).saidas = parseFloat(s.saidas) || 0;
        }

        const fluxoDiario = Array.from(mapaFluxo.values()).sort((a, b) => a.data.localeCompare(b.data));

        res.json({ saldoInicial: parseFloat(saldoInicial), fluxoDiario });
    } catch (error) {
        console.error('❌ Erro ao buscar fluxo de caixa resumo:', error);
        res.status(500).json({ error: 'Erro ao buscar fluxo de caixa resumo' });
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
        res.status(500).json({ error: 'Erro ao buscar fornecedores', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar clientes', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar bancos', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar banco', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao criar banco', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao atualizar banco', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Excluir banco (soft delete)
app.delete('/api/financeiro/bancos/:id', authenticateToken, requireFinancePermission('excluir'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute("UPDATE bancos SET status = 'inativo' WHERE id = ?", [id]);
        res.json({ success: true, message: 'Banco desativado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir banco:', error);
        res.status(500).json({ error: 'Erro ao excluir banco', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar movimentações', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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

        // AUDIT-FIX R3: FOR UPDATE para evitar race condition no saldo
        const [banco] = await connection.execute('SELECT saldo_atual FROM bancos WHERE id = ? FOR UPDATE', [banco_id]);
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
        res.status(500).json({ error: 'Erro ao criar movimentação', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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

        // AUDIT-FIX R3: FOR UPDATE para evitar race condition em transferências concorrentes
        const [origem] = await connection.execute('SELECT saldo_atual, nome FROM bancos WHERE id = ? FOR UPDATE', [conta_origem]);
        const [destino] = await connection.execute('SELECT saldo_atual, nome FROM bancos WHERE id = ? FOR UPDATE', [conta_destino]);

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
        res.status(500).json({ error: 'Erro na transferência', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar extrato', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar centros de custo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar centro de custo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao criar centro de custo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao atualizar centro de custo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

app.delete('/api/financeiro/centros-custo/:id', authenticateToken, requireFinancePermission('excluir'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('UPDATE centros_custo SET ativo = 0 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Centro de custo desativado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir centro de custo:', error);
        res.status(500).json({ error: 'Erro ao excluir centro de custo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar impostos', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao buscar imposto', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
        res.status(500).json({ error: 'Erro ao criar imposto', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

app.put('/api/financeiro/impostos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo, aliquota, descricao, base, observacoes, ativo } = req.body;

        if (!tipo || !descricao) {
            return res.status(400).json({ success: false, error: 'Tipo e descrição são obrigatórios' });
        }

        await pool.execute(
            'UPDATE impostos SET tipo = ?, aliquota = ?, descricao = ?, base = ?, observacoes = ?, ativo = ?, updated_at = NOW() WHERE id = ?',
            [tipo, parseFloat(aliquota) || 0, descricao, parseFloat(base) || 0, observacoes || '', ativo !== false ? 1 : 0, id]
        );

        res.json({ success: true, message: 'Imposto atualizado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar imposto:', error);
        res.status(500).json({ error: 'Erro ao atualizar imposto', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

app.delete('/api/financeiro/impostos/:id', authenticateToken, requireFinancePermission('excluir'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('UPDATE impostos SET ativo = 0 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Imposto desativado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir imposto:', error);
        res.status(500).json({ error: 'Erro ao excluir imposto', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// ============================================
// DEV SPEC 1.2: WEBHOOKS DE INTEGRAÇÃO E2E
// ============================================

const FinanceiroIntegracaoService = require('../Faturamento/services/financeiro-integracao.service');
const integracaoService = new FinanceiroIntegracaoService(pool);

// Webhook: Faturamento → Financeiro (mudança de status NFe)
app.post('/api/financeiro/webhook/nfe-status', authenticateToken, async (req, res) => {
    try {
        const { nfe_id, status, motivo } = req.body;
        if (!nfe_id || !status) {
            return res.status(400).json({ error: 'nfe_id e status são obrigatórios' });
        }
        const result = await integracaoService.sincronizarStatusNFe(nfe_id, status, {
            motivo, usuario_id: req.user.id
        });
        res.json(result);
    } catch (error) {
        console.error('❌ Erro webhook nfe-status:', error);
        res.status(500).json({ error: 'Erro ao processar webhook NFe', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Webhook: Faturamento → Financeiro (alteração de valor NFe / CC-e)
app.post('/api/financeiro/webhook/nfe-valor', authenticateToken, async (req, res) => {
    try {
        const { nfe_id, novo_valor } = req.body;
        if (!nfe_id || !novo_valor) {
            return res.status(400).json({ error: 'nfe_id e novo_valor são obrigatórios' });
        }
        const result = await integracaoService.sincronizarValorNFe(nfe_id, novo_valor);
        res.json(result);
    } catch (error) {
        console.error('❌ Erro webhook nfe-valor:', error);
        res.status(500).json({ error: 'Erro ao processar webhook valor NFe', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Webhook: Logística/Compras → Financeiro (NF de compra → CP)
app.post('/api/financeiro/webhook/compra', authenticateToken, async (req, res) => {
    try {
        const { compra_id, fornecedor_id, valor_total, data_emissao, numero_nf, parcelas, intervalo_dias, categoria_id, observacoes } = req.body;
        if (!compra_id || !fornecedor_id || !valor_total) {
            return res.status(400).json({ error: 'compra_id, fornecedor_id e valor_total são obrigatórios' });
        }
        const result = await integracaoService.gerarContaPagarDeCompra(compra_id, req.body);
        res.json(result);
    } catch (error) {
        console.error('❌ Erro webhook compra:', error);
        res.status(500).json({ error: 'Erro ao processar webhook compra', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Webhook: Logística/Compras → Financeiro (cancelamento de compra)
app.post('/api/financeiro/webhook/compra-cancelada', authenticateToken, async (req, res) => {
    try {
        const { compra_id } = req.body;
        if (!compra_id) {
            return res.status(400).json({ error: 'compra_id é obrigatório' });
        }
        const result = await integracaoService.estornarCompraCancelada(compra_id);
        res.json(result);
    } catch (error) {
        console.error('❌ Erro webhook compra-cancelada:', error);
        res.status(500).json({ error: 'Erro ao processar webhook cancelamento', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// ============================================
// ROTAS - CATEGORIAS FINANCEIRAS
// ============================================

app.get('/api/financeiro/categorias', authenticateToken, async (req, res) => {
    try {
        // Se fornecedor_id passar, tentar filtrar categorias vinculadas ao fornecedor
        if (req.query.fornecedor_id) {
            try {
                const [rows] = await pool.execute(
                    'SELECT DISTINCT cf.* FROM categorias_financeiras cf INNER JOIN fornecedor_categorias fc ON fc.categoria_id = cf.id WHERE fc.fornecedor_id = ? ORDER BY cf.nome',
                    [req.query.fornecedor_id]
                );
                if (rows.length > 0) {
                    return res.json({ success: true, data: rows });
                }
            } catch (e) {
                // Tabela fornecedor_categorias pode não existir — retornar todas
            }
        }
        const [categorias] = await pool.execute('SELECT * FROM categorias_financeiras ORDER BY nome');
        res.json({ success: true, data: categorias });
    } catch (error) {
        console.error('❌ Erro ao buscar categorias:', error);
        res.status(500).json({ error: 'Erro ao buscar categorias', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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

app.get('/plano-contas', (req, res) => {
    res.sendFile(path.join(__dirname, 'plano-contas.html'));
});

app.get('/orcamentos', (req, res) => {
    res.sendFile(path.join(__dirname, 'orcamentos.html'));
});

app.get('/conciliacao', (req, res) => {
    res.sendFile(path.join(__dirname, 'conciliacao.html'));
});

app.get('/impostos', (req, res) => {
    res.sendFile(path.join(__dirname, 'impostos.html'));
});

app.get('/centros-custo', (req, res) => {
    res.sendFile(path.join(__dirname, 'centros-custo.html'));
});

// ============================================
// ERROR HANDLERS
// ============================================

// Error handling centralizado (Sprint 7)
app.use(errorHandler);

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
                res.status(500).json({ error: 'Erro ao criar parcelamento', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
                res.status(500).json({ error: 'Erro ao buscar permissões', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
                res.status(500).json({ error: 'Erro ao fazer upload', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
                res.status(500).json({ error: 'Erro ao listar anexos', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
            }
        });

        app.delete('/api/financeiro/anexos/:id', authenticateToken, requireFinancePermission('excluir'), async (req, res) => {
            try {
                const { id } = req.params;

                await pool.execute('DELETE FROM financeiro_anexos WHERE id = ?', [id]);

                res.json({ success: true });
            } catch (error) {
                console.error('Erro ao excluir anexo:', error);
                res.status(500).json({ error: 'Erro ao excluir anexo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
            }
        });

        // ========================
        // OPERAÇÕES DE CRÉDITO
        // ========================

        // Listar operações de crédito
        app.get('/api/financeiro/operacoes-credito', authenticateToken, async (req, res) => {
            try {
                const [rows] = await pool.execute(
                    `SELECT * FROM operacoes_credito ORDER BY data_operacao DESC, id DESC`
                );
                res.json({ data: rows });
            } catch (error) {
                console.error('Erro ao listar operações de crédito:', error);
                res.status(500).json({ error: 'Erro ao listar operações' });
            }
        });

        // Estatísticas operações de crédito
        app.get('/api/financeiro/operacoes-credito/estatisticas', authenticateToken, async (req, res) => {
            try {
                const [rows] = await pool.execute(`
                    SELECT
                        COUNT(*) as total_operacoes,
                        SUM(vlr_bruto) as total_bruto,
                        SUM(total_deducoes) as total_deducoes,
                        SUM(liq_op) as total_liquido_op,
                        SUM(liq_lib) as total_liquido_lib,
                        SUM(recompra) as total_recompra,
                        SUM(retencao_passivo) as total_retencao,
                        AVG(prazo_medio) as prazo_medio_geral,
                        AVG(taxa_periodo) as taxa_media
                    FROM operacoes_credito
                `);
                res.json({ data: rows[0] });
            } catch (error) {
                console.error('Erro ao obter estatísticas operações:', error);
                res.status(500).json({ error: 'Erro ao obter estatísticas' });
            }
        });

        // Importar operações via Excel (aba OPERAÇÕES)
        app.post('/api/financeiro/operacoes-credito/importar-excel', authenticateToken, upload.single('arquivo'), async (req, res) => {
            try {
                if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

                const XLSX = require('xlsx');
                const workbook = XLSX.readFile(req.file.path);

                // Procura aba OPERAÇÕES
                const sheetName = workbook.SheetNames.find(s => s.toUpperCase().includes('OPERA')) || workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

                // Detectar header
                const HEADER_KW = ['BORDERÔ', 'BORDERO', 'EMPRESA', 'VLR_BRUTO', 'INSTITUICAO', 'TIPO OPERACAO'];
                let headerIdx = 0;
                for (let i = 0; i < Math.min(rawData.length, 10); i++) {
                    const rowStr = (rawData[i] || []).map(c => String(c || '')).join('|').toUpperCase();
                    if (HEADER_KW.filter(kw => rowStr.includes(kw)).length >= 3) { headerIdx = i; break; }
                }
                const headers = (rawData[headerIdx] || []).map(h => String(h || '').trim().toUpperCase());

                const COL = {};
                const MAP = {
                    'BORDERÔ': 'bordero', 'BORDERO': 'bordero',
                    'EMPRESA': 'empresa', 'TIPO OPERACAO': 'tipo_operacao',
                    'INSTITUICAO': 'instituicao', 'PRORROGACAO': 'prorrogacao',
                    'PRAZO_MEDIO': 'prazo_medio', 'DATA OP': 'data_operacao',
                    'TAXA PERIODO': 'taxa_periodo', 'TMP': 'tmp',
                    'VLR_BRUTO': 'vlr_bruto', 'QTDE_TITULOS': 'qtde_titulos',
                    'DIF_MONET': 'dif_monet', 'TARIFAS': 'tarifas',
                    'ISS/RISS/IRRF_PERC': 'iss_riss_irrf_perc',
                    'ISS/RISS/IRRF_MONET': 'iss_riss_irrf_monet',
                    'IOF': 'iof', 'CPMF_COBR': 'cpmf_cobr',
                    'TOTAL DEDUCOES': 'total_deducoes', 'LIQ_OP': 'liq_op',
                    'RETENCAO PASSIVO': 'retencao_passivo', 'RECOMPRA': 'recompra',
                    'AMORT_FOM': 'amort_fom', 'CONTA GRAFICA': 'conta_grafica',
                    'LIQ_LIB': 'liq_lib'
                };
                for (let i = 0; i < headers.length; i++) {
                    const mapped = MAP[headers[i]];
                    if (mapped) COL[mapped] = i;
                }

                const parseData = (d) => {
                    if (!d) return null;
                    if (d instanceof Date) return d.toISOString().slice(0, 10);
                    if (typeof d === 'number') {
                        const dt = XLSX.SSF.parse_date_code(d);
                        if (dt) return `${dt.y}-${String(dt.m).padStart(2,'0')}-${String(dt.d).padStart(2,'0')}`;
                    }
                    return null;
                };
                const num = (v) => (v !== undefined && v !== null && !isNaN(Number(v))) ? Number(v) : 0;
                const str = (v) => (v !== undefined && v !== null) ? String(v).trim() : '';

                // Limpar anteriores
                await pool.execute('DELETE FROM operacoes_credito');

                let importados = 0;
                for (let i = headerIdx + 1; i < rawData.length; i++) {
                    const row = rawData[i];
                    if (!row || row.length === 0) continue;
                    const empresa = str(row[COL.empresa]);
                    const vlr = num(row[COL.vlr_bruto]);
                    if (!empresa && !vlr) continue;

                    await pool.execute(
                        `INSERT INTO operacoes_credito
                         (bordero,empresa,tipo_operacao,instituicao,prorrogacao,prazo_medio,
                          data_operacao,taxa_periodo,tmp,vlr_bruto,qtde_titulos,dif_monet,
                          tarifas,iss_riss_irrf_perc,iss_riss_irrf_monet,iof,cpmf_cobr,
                          total_deducoes,liq_op,retencao_passivo,recompra,amort_fom,
                          conta_grafica,liq_lib)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                        [
                            str(row[COL.bordero]), empresa, str(row[COL.tipo_operacao]),
                            str(row[COL.instituicao]), str(row[COL.prorrogacao]),
                            num(row[COL.prazo_medio]), parseData(row[COL.data_operacao]),
                            num(row[COL.taxa_periodo]), num(row[COL.tmp]),
                            vlr, parseInt(num(row[COL.qtde_titulos])) || 0,
                            num(row[COL.dif_monet]), num(row[COL.tarifas]),
                            num(row[COL.iss_riss_irrf_perc]), num(row[COL.iss_riss_irrf_monet]),
                            num(row[COL.iof]), num(row[COL.cpmf_cobr]),
                            num(row[COL.total_deducoes]), num(row[COL.liq_op]),
                            num(row[COL.retencao_passivo]), num(row[COL.recompra]),
                            num(row[COL.amort_fom]), num(row[COL.conta_grafica]),
                            num(row[COL.liq_lib])
                        ]
                    );
                    importados++;
                }

                try { fs.unlinkSync(req.file.path); } catch(e) {}
                res.json({ success: true, importados, sheet: sheetName });
            } catch (error) {
                console.error('Erro ao importar operações:', error);
                res.status(500).json({ error: 'Erro ao importar operações' });
            }
        });

        // Registrar operação de desconto de títulos (usado por relatorios.html)
        app.post('/api/financeiro/operacoes/desconto', authenticateToken, async (req, res) => {
            try {
                const {
                    número_título, cliente_sacado, valor_titulo, data_vencimento,
                    banco, data_operação, taxa_desconto, iof, observacoes, valor_liquido
                } = req.body;

                if (!valor_titulo || !data_vencimento) {
                    return res.status(400).json({ error: 'valor_titulo e data_vencimento são obrigatórios' });
                }

                const valorNum = parseFloat(valor_titulo);
                if (isNaN(valorNum) || valorNum <= 0) {
                    return res.status(400).json({ error: 'valor_titulo inválido' });
                }

                const [result] = await pool.execute(
                    `INSERT INTO operacoes_credito
                     (empresa, tipo_operacao, instituicao, data_operacao, vlr_bruto,
                      iof, liq_op, taxa_periodo, bordero)
                     VALUES (?, 'desconto', ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        cliente_sacado || null,
                        banco || null,
                        data_operação || new Date().toISOString().slice(0, 10),
                        Math.round(valorNum * 100) / 100,
                        parseFloat(iof) || 0,
                        parseFloat(valor_liquido) || valorNum,
                        parseFloat(taxa_desconto) || 0,
                        número_título || null
                    ]
                );

                res.json({ success: true, id: result.insertId, message: 'Operação de desconto registrada com sucesso' });
            } catch (error) {
                console.error('Erro ao registrar operação de desconto:', error);
                res.status(500).json({ error: 'Erro ao registrar operação de desconto', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
            }
        });

        // Dados da empresa (stub para compatibilidade com relatorios.html)
        app.get('/api/configuracoes/empresa', authenticateToken, async (req, res) => {
            try {
                const [rows] = await pool.execute(
                    'SELECT * FROM configuracoes_empresa LIMIT 1'
                );
                if (rows.length > 0) {
                    return res.json({ success: true, data: rows[0] });
                }
                // Retornar dados padrão se não houver registro
                res.json({ success: true, data: { razao_social: 'ALUFORCE', nome_fantasia: 'ALUFORCE', cnpj: '' } });
            } catch (error) {
                // Tabela pode não existir — retornar dados padrão sem erro
                res.json({ success: true, data: { razao_social: 'ALUFORCE', nome_fantasia: 'ALUFORCE', cnpj: '' } });
            }
        });

        // =============================================
        // STUBS: Integrações Bancárias (bancos.html)
        // =============================================
        const notImplemented = (featureName) => (req, res) => {
            res.status(501).json({ error: 'Funcionalidade não implementada', feature: featureName });
        };

        app.post('/api/financeiro/integracoes-bancarias', authenticateToken, notImplemented('integracoes-bancarias-criar'));
        app.post('/api/financeiro/integracoes-bancarias/testar', authenticateToken, notImplemented('integracoes-bancarias-testar'));
        app.get('/api/financeiro/integracoes-bancarias/:bancoId', authenticateToken, notImplemented('integracoes-bancarias-obter'));
        app.delete('/api/financeiro/integracoes-bancarias/:bancoId', authenticateToken, notImplemented('integracoes-bancarias-excluir'));
        app.post('/api/financeiro/integracoes-bancarias/:bancoId/remessa', authenticateToken, notImplemented('integracoes-bancarias-remessa'));
        app.post('/api/financeiro/integracoes-bancarias/retorno', authenticateToken, notImplemented('integracoes-bancarias-retorno'));

        // =============================================
        // STUBS: Conciliação Bancária (conciliacao.html)
        // =============================================
        app.post('/api/financeiro/conciliacao', authenticateToken, notImplemented('conciliacao-registrar'));
        app.post('/api/financeiro/conciliacao/automatica', authenticateToken, notImplemented('conciliacao-automatica'));
        app.delete('/api/financeiro/conciliacao/:id', authenticateToken, notImplemented('conciliacao-excluir'));
        app.post('/api/financeiro/conciliacao/importar-ofx', authenticateToken, notImplemented('conciliacao-importar-ofx'));

        // =============================================
        // STUBS: Orçamentos (orcamentos.html)
        // =============================================
        app.get('/api/financeiro/orcamentos', authenticateToken, async (req, res) => {
            try {
                const [rows] = await pool.execute(
                    'SELECT * FROM orcamentos ORDER BY created_at DESC LIMIT 100'
                );
                res.json({ success: true, data: rows });
            } catch (error) {
                // Tabela pode não existir ainda
                res.json({ success: true, data: [] });
            }
        });

        app.post('/api/financeiro/orcamentos', authenticateToken, async (req, res) => {
            try {
                const { descricao, valor, periodo } = req.body;
                if (!descricao || valor === undefined) {
                    return res.status(400).json({ error: 'descricao e valor são obrigatórios' });
                }
                const [result] = await pool.execute(
                    'INSERT INTO orcamentos (descricao, valor, periodo, criado_em) VALUES (?, ?, ?, NOW())',
                    [descricao, parseFloat(valor) || 0, periodo || null]
                );
                res.json({ success: true, id: result.insertId });
            } catch (error) {
                console.error('Erro ao salvar orçamento:', error);
                res.status(500).json({ error: 'Erro ao salvar orçamento', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
            }
        });

        app.put('/api/financeiro/orcamentos/:id', authenticateToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { descricao, valor, periodo } = req.body;
                await pool.execute(
                    'UPDATE orcamentos SET descricao = ?, valor = ?, periodo = ? WHERE id = ?',
                    [descricao, parseFloat(valor) || 0, periodo || null, id]
                );
                res.json({ success: true });
            } catch (error) {
                console.error('Erro ao atualizar orçamento:', error);
                res.status(500).json({ error: 'Erro ao atualizar orçamento', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
