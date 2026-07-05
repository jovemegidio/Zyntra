// ============================================
// ZYNTRA SGE - Rotas de Teste Grátis (Trial)
// Salva cadastros de leads do site Zyntra
// ============================================

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// CORS para permitir chamadas do site Zyntra
router.use((req, res, next) => {
    const allowedOrigins = [
        'https://aluforce.com.br',
        'https://www.aluforce.com.br',
        'https://zyntraerp.com.br',
        'http://localhost:3000',
        'http://localhost:4173',
        'http://YOUR_VPS_IP'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Pool de conexão
let pool = null;
function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'aluforce',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'aluforce_vendas',
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });
    }
    return pool;
}

// ============================================
// Criar tabela automaticamente se não existir
// ============================================
async function ensureTable() {
    const db = getPool();
    await db.query(`
        CREATE TABLE IF NOT EXISTS zyntra_trials (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            telefone VARCHAR(30),
            empresa VARCHAR(255),
            cnpj VARCHAR(20),
            segmento VARCHAR(100),
            funcionarios VARCHAR(20),
            plano VARCHAR(50),
            origem VARCHAR(100) DEFAULT 'landing-page',
            ip_address VARCHAR(45),
            user_agent TEXT,
            status ENUM('novo', 'contatado', 'demo_agendada', 'convertido', 'cancelado') DEFAULT 'novo',
            notas TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_email (email),
            INDEX idx_status (status),
            INDEX idx_created (created_at),
            INDEX idx_plano (plano)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

// Inicializar tabela ao carregar o módulo
ensureTable().then(() => {
    console.log('✅ Tabela zyntra_trials pronta');
}).catch(err => {
    console.error('❌ Erro ao criar tabela zyntra_trials:', err.message);
});

// ============================================
// POST /api/zyntra/trial — Novo cadastro de teste grátis
// ============================================
router.post('/trial', async (req, res) => {
    try {
        const { name, email, phone, company, cnpj, segment, employees, plan } = req.body;

        // Validações básicas
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Nome é obrigatório.' });
        }
        if (!email || !email.trim() || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'E-mail válido é obrigatório.' });
        }
        if (!phone || !phone.trim()) {
            return res.status(400).json({ success: false, message: 'Telefone é obrigatório.' });
        }
        if (!company || !company.trim()) {
            return res.status(400).json({ success: false, message: 'Nome da empresa é obrigatório.' });
        }

        const db = getPool();

        // Verificar se e-mail já existe
        const [existing] = await db.query(
            'SELECT id, nome, empresa, status, created_at FROM zyntra_trials WHERE email = ?',
            [email.trim().toLowerCase()]
        );

        if (existing.length > 0) {
            const trial = existing[0];
            // Atualizar dados se já existe
            await db.query(
                `UPDATE zyntra_trials SET 
                    nome = ?, telefone = ?, empresa = ?, cnpj = ?, 
                    segmento = ?, funcionarios = ?, plano = ?,
                    ip_address = ?, user_agent = ?
                WHERE email = ?`,
                [
                    name.trim(),
                    phone.trim(),
                    company.trim(),
                    cnpj ? cnpj.trim() : null,
                    segment || null,
                    employees || null,
                    plan || null,
                    req.ip || req.connection?.remoteAddress || null,
                    req.headers['user-agent'] || null,
                    email.trim().toLowerCase()
                ]
            );

            return res.json({
                success: true,
                message: 'Dados atualizados! Bem-vindo de volta.',
                trial_id: trial.id,
                is_returning: true
            });
        }

        // Inserir novo trial
        const [result] = await db.query(
            `INSERT INTO zyntra_trials 
                (nome, email, telefone, empresa, cnpj, segmento, funcionarios, plano, ip_address, user_agent) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                email.trim().toLowerCase(),
                phone.trim(),
                company.trim(),
                cnpj ? cnpj.trim() : null,
                segment || null,
                employees || null,
                plan || null,
                req.ip || req.connection?.remoteAddress || null,
                req.headers['user-agent'] || null
            ]
        );

        console.log(`🚀 Novo trial Zyntra: ${name} (${email}) - ${company} - Plano: ${plan || 'N/A'}`);

        res.json({
            success: true,
            message: 'Teste grátis ativado com sucesso!',
            trial_id: result.insertId,
            is_returning: false
        });

    } catch (error) {
        console.error('❌ Erro ao salvar trial Zyntra:', error.message);
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Este e-mail já está cadastrado. Tente outro e-mail.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Erro interno ao processar cadastro. Tente novamente.'
        });
    }
});

// ============================================
// GET /api/zyntra/trials — Listar todos os trials (protegido)
// ============================================
router.get('/trials', async (req, res) => {
    try {
        // Verificar API key simples para acesso admin
        const apiKey = req.headers['x-api-key'] || req.query.key;
        if (apiKey !== '2d6e45d6-cdd2-468b-b79a-fda468674113') {
            return res.status(401).json({ success: false, message: 'Não autorizado.' });
        }

        const db = getPool();
        const { status, limit = 50, offset = 0 } = req.query;

        let query = 'SELECT * FROM zyntra_trials';
        const params = [];

        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [rows] = await db.query(query, params);

        // Totais por status
        const [totals] = await db.query(`
            SELECT 
                COUNT(*) as total,
                SUM(status = 'novo') as novos,
                SUM(status = 'contatado') as contatados,
                SUM(status = 'demo_agendada') as demos,
                SUM(status = 'convertido') as convertidos,
                SUM(status = 'cancelado') as cancelados
            FROM zyntra_trials
        `);

        res.json({
            success: true,
            data: rows,
            totals: totals[0],
            pagination: { limit: parseInt(limit), offset: parseInt(offset) }
        });

    } catch (error) {
        console.error('❌ Erro ao listar trials:', error.message);
        res.status(500).json({ success: false, message: 'Erro interno.' });
    }
});

// ============================================
// PATCH /api/zyntra/trials/:id — Atualizar status do trial
// ============================================
router.patch('/trials/:id', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'] || req.query.key;
        if (apiKey !== '2d6e45d6-cdd2-468b-b79a-fda468674113') {
            return res.status(401).json({ success: false, message: 'Não autorizado.' });
        }

        const { id } = req.params;
        const { status, notas } = req.body;

        const validStatuses = ['novo', 'contatado', 'demo_agendada', 'convertido', 'cancelado'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: `Status inválido. Use: ${validStatuses.join(', ')}` });
        }

        const db = getPool();
        const updates = [];
        const params = [];

        if (status) {
            updates.push('status = ?');
            params.push(status);
        }
        if (notas !== undefined) {
            updates.push('notas = ?');
            params.push(notas);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar.' });
        }

        params.push(id);
        await db.query(`UPDATE zyntra_trials SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Trial atualizado.' });

    } catch (error) {
        console.error('❌ Erro ao atualizar trial:', error.message);
        res.status(500).json({ success: false, message: 'Erro interno.' });
    }
});

// ============================================
// GET /api/zyntra/trials/stats — Dashboard de métricas
// ============================================
router.get('/trials/stats', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'] || req.query.key;
        if (apiKey !== '2d6e45d6-cdd2-468b-b79a-fda468674113') {
            return res.status(401).json({ success: false, message: 'Não autorizado.' });
        }

        const db = getPool();

        // Totais por status
        const [byStatus] = await db.query(`
            SELECT status, COUNT(*) as total 
            FROM zyntra_trials 
            GROUP BY status
        `);

        // Por plano
        const [byPlan] = await db.query(`
            SELECT COALESCE(plano, 'Não informado') as plano, COUNT(*) as total 
            FROM zyntra_trials 
            GROUP BY plano
        `);

        // Por segmento
        const [bySegment] = await db.query(`
            SELECT COALESCE(segmento, 'Não informado') as segmento, COUNT(*) as total 
            FROM zyntra_trials 
            GROUP BY segmento
        `);

        // Por dia (últimos 30 dias)
        const [byDay] = await db.query(`
            SELECT DATE(created_at) as dia, COUNT(*) as total 
            FROM zyntra_trials 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(created_at)
            ORDER BY dia
        `);

        // Por funcionários
        const [bySize] = await db.query(`
            SELECT COALESCE(funcionarios, 'Não informado') as faixa, COUNT(*) as total 
            FROM zyntra_trials 
            GROUP BY funcionarios
        `);

        res.json({
            success: true,
            stats: {
                byStatus,
                byPlan,
                bySegment,
                byDay,
                bySize
            }
        });

    } catch (error) {
        console.error('❌ Erro ao gerar stats:', error.message);
        res.status(500).json({ success: false, message: 'Erro interno.' });
    }
});

module.exports = router;
