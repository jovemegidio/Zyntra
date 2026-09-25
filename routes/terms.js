'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TERMS_VERSION = process.env.TERMS_VERSION || '2026-07-16';
const PRIVACY_VERSION = process.env.PRIVACY_VERSION || '2026-07-16';
const TERMS_URL = '/termos-de-uso.html';
const PRIVACY_URL = '/politica-de-privacidade.html';

function createTermsService({ pool, jwt, jwtSecret }) {
    const router = express.Router();
    const acceptedCache = new Map();
    let tablesReady = false;

    const versionKey = `${TERMS_VERSION}:${PRIVACY_VERSION}`;
    const documentHash = file => crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(__dirname, '..', 'public', file)))
        .digest('hex');
    const termsHash = documentHash('termos-de-uso.html');
    const privacyHash = documentHash('politica-de-privacidade.html');

    async function ensureTables() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS termos_aceites (
                id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
                usuario_id INT NOT NULL,
                empresa_id INT NULL,
                termos_versao VARCHAR(40) NOT NULL,
                privacidade_versao VARCHAR(40) NOT NULL,
                termos_hash CHAR(64) NOT NULL,
                privacidade_hash CHAR(64) NOT NULL,
                ip VARCHAR(45) NULL,
                user_agent VARCHAR(500) NULL,
                instancia VARCHAR(100) NULL,
                aceito_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                revogado_em DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_termos_usuario_versao (usuario_id, termos_versao, privacidade_versao),
                INDEX idx_termos_usuario (usuario_id),
                INDEX idx_termos_aceito (aceito_em)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        tablesReady = true;
    }

    ensureTables().catch(err => console.error('[TERMS] Falha ao criar tabela:', err.message));

    function readToken(req) {
        return req.cookies?.authToken || req.cookies?.token ||
            String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    }

    function decodeUser(req) {
        if (req.user?.id) return req.user;
        const token = readToken(req);
        if (!token) return null;
        try {
            return jwt.verify(token, jwtSecret, { algorithms: ['HS256'], audience: 'aluforce' });
        } catch (_) {
            return null;
        }
    }

    async function hasAccepted(userId) {
        const cached = acceptedCache.get(userId);
        if (cached && cached.key === versionKey && cached.expiresAt > Date.now()) return true;
        const [rows] = await pool.query(
            `SELECT id FROM termos_aceites
             WHERE usuario_id = ? AND termos_versao = ? AND privacidade_versao = ?
               AND revogado_em IS NULL LIMIT 1`,
            [userId, TERMS_VERSION, PRIVACY_VERSION]
        );
        if (rows.length) acceptedCache.set(userId, { key: versionKey, expiresAt: Date.now() + 5 * 60 * 1000 });
        return rows.length > 0;
    }

    const exemptPrefixes = [
        '/api/login', '/api/logout', '/api/refresh', '/api/verify-2fa', '/api/resend-2fa',
        '/api/auth/', '/api/terms', '/api/health', '/api/db-check', '/api/csrf-token',
        '/api/lgpd/',
        // MÍNIMO para a tela se desenhar e o modal de aceite aparecer sobre algo funcional.
        // Sem estas, o hub carregava vazio ("0 empresas", usuário sem nome) e o usuário era
        // expulso ANTES de conseguir aceitar — um paradoxo: aceitar exige entrar, entrar exigia
        // as APIs. São leitura pura da identidade de quem já está autenticado, sem dado de negócio.
        // Todo o resto (dashboard, notifications, vendas, financeiro...) segue bloqueado até aceitar.
        '/api/me', '/api/empresa/logo',
        // '/api/public/' é consumida pela TELA DE LOGIN (ex.: /api/public/usuarios/preview),
        // ANTES de o usuário entrar. Sem esta isenção, quem chegava ao login com um cookie de
        // sessão anterior era reconhecido pelo decodeUser, o middleware exigia o aceite e devolvia
        // 428 — o front lia como sessão inválida e voltava pro login, sem nunca mostrar o modal
        // de aceite. Rota pública não deve exigir aceite de termos.
        '/api/public/'
    ];

    async function requireCurrentTerms(req, res, next) {
        if (!req.path.startsWith('/api/') || exemptPrefixes.some(prefix => req.path.startsWith(prefix))) return next();
        const user = decodeUser(req);
        if (!user?.id) return next(); // autenticação normal da rota continua responsável pelo 401
        if (!tablesReady) return next(); // fail-open somente durante bootstrap/migração
        try {
            if (await hasAccepted(user.id)) return next();
            return res.status(428).json({
                success: false,
                code: 'TERMS_ACCEPTANCE_REQUIRED',
                message: 'É necessário aceitar os Termos de Uso e a Política de Privacidade vigentes.',
                terms: { version: TERMS_VERSION, url: TERMS_URL },
                privacy: { version: PRIVACY_VERSION, url: PRIVACY_URL }
            });
        } catch (err) {
            console.error('[TERMS] Falha ao verificar aceite:', err.message);
            return next(); // indisponibilidade do registro não derruba o ERP
        }
    }

    router.get('/status', async (req, res) => {
        const user = decodeUser(req);
        if (!user?.id) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Não autenticado.' });
        try {
            const accepted = tablesReady && await hasAccepted(user.id);
            return res.json({
                accepted,
                userId: user.id,
                terms: { version: TERMS_VERSION, url: TERMS_URL },
                privacy: { version: PRIVACY_VERSION, url: PRIVACY_URL }
            });
        } catch (err) {
            return res.status(503).json({ code: 'TERMS_STATUS_UNAVAILABLE', message: 'Não foi possível verificar o aceite.' });
        }
    });

    router.post('/accept', async (req, res) => {
        const user = decodeUser(req);
        if (!user?.id) return res.status(401).json({ code: 'AUTH_MISSING', message: 'Não autenticado.' });
        const { termsAccepted, privacyAcknowledged, termsVersion, privacyVersion } = req.body || {};
        if (termsAccepted !== true || privacyAcknowledged !== true ||
            termsVersion !== TERMS_VERSION || privacyVersion !== PRIVACY_VERSION) {
            return res.status(400).json({ code: 'INVALID_TERMS_ACCEPTANCE', message: 'Confirme os documentos vigentes.' });
        }
        try {
            await ensureTables();
            await pool.query(
                `INSERT INTO termos_aceites
                    (usuario_id, empresa_id, termos_versao, privacidade_versao, termos_hash,
                     privacidade_hash, ip, user_agent, instancia, aceito_em, revogado_em)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
                 ON DUPLICATE KEY UPDATE ip = VALUES(ip), user_agent = VALUES(user_agent),
                    instancia = VALUES(instancia), aceito_em = NOW(), revogado_em = NULL`,
                [user.id, user.empresa_id || null, TERMS_VERSION, PRIVACY_VERSION,
                    termsHash, privacyHash,
                    req.ip, String(req.headers['user-agent'] || '').substring(0, 500), req.hostname]
            );
            acceptedCache.set(user.id, { key: versionKey, expiresAt: Date.now() + 5 * 60 * 1000 });
            return res.json({
                success: true,
                userId: user.id,
                termsVersion: TERMS_VERSION,
                privacyVersion: PRIVACY_VERSION,
                acceptedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error('[TERMS] Falha ao registrar aceite:', err.message);
            return res.status(500).json({ code: 'TERMS_ACCEPTANCE_FAILED', message: 'Não foi possível registrar o aceite.' });
        }
    });

    return { router, requireCurrentTerms, ensureTables };
}

module.exports = { createTermsService, TERMS_VERSION, PRIVACY_VERSION };
