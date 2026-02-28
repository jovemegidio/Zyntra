// =====================================================
// ROTAS API — DISCORD NOTIFICATIONS
// POST /api/discord/notify     — Notificação genérica
// POST /api/discord/deploy     — Notificação de deploy
// POST /api/discord/commits    — Notificação de commits (git hook)
// GET  /api/discord/changelog  — Histórico de alterações
// GET  /api/discord/status     — Status do notifier
// =====================================================

'use strict';

const express = require('express');
const router = express.Router();

let discord;
try {
    discord = require('../services/discord-notifier');
} catch (e) {
    console.warn('[Discord Routes] Notifier não disponível:', e.message);
}

/**
 * POST /api/discord/notify
 * Publica uma atualização no Discord
 */
router.post('/notify', async (req, res) => {
    if (!discord) return res.status(503).json({ success: false, error: 'Discord notifier não disponível' });

    try {
        const { tipo, titulo, descricao, modulo, alteracoes, autor, arquivos } = req.body;

        if (!titulo) {
            return res.status(400).json({ success: false, error: 'Campo "titulo" é obrigatório' });
        }

        const sent = await discord.publicarAtualizacao({
            tipo: tipo || 'improvement',
            titulo,
            descricao: descricao || '',
            modulo: modulo || 'Sistema',
            alteracoes: alteracoes || [],
            autor: autor || (req.user && req.user.nome) || 'Sistema',
            arquivos: arquivos || []
        });

        res.json({ success: true, sent, message: sent ? 'Notificação enviada' : 'Salvo localmente' });
    } catch (error) {
        console.error('[Discord API] Erro em /notify:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/discord/deploy
 * Notifica um deploy realizado
 */
router.post('/deploy', async (req, res) => {
    if (!discord) return res.status(503).json({ success: false, error: 'Discord notifier não disponível' });

    try {
        const { versao, ambiente, descricao, alteracoes, arquivos, autor } = req.body;

        const sent = await discord.publicarDeploy({
            versao,
            ambiente: ambiente || 'Produção',
            descricao: descricao || 'Deploy realizado com sucesso.',
            alteracoes: alteracoes || [],
            arquivos: arquivos || [],
            autor: autor || (req.user && req.user.nome) || 'Deploy Automático'
        });

        res.json({ success: true, sent });
    } catch (error) {
        console.error('[Discord API] Erro em /deploy:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/discord/commits
 * Recebe commits do git hook e publica no Discord
 */
router.post('/commits', async (req, res) => {
    if (!discord) return res.status(503).json({ success: false, error: 'Discord notifier não disponível' });

    // Aceitar chamadas internas do git hook
    const internalHook = req.headers['x-internal-hook'] === 'git-post-commit';

    try {
        const { commits } = req.body;
        if (!commits || !Array.isArray(commits) || commits.length === 0) {
            return res.status(400).json({ success: false, error: 'Array "commits" é obrigatório' });
        }

        const sent = await discord.publicarCommits(commits);
        res.json({ success: true, sent, count: commits.length });
    } catch (error) {
        console.error('[Discord API] Erro em /commits:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/discord/changelog
 * Retorna o histórico de alterações
 */
router.get('/changelog', (req, res) => {
    if (!discord) return res.status(503).json({ success: false, error: 'Discord notifier não disponível' });

    const limit = parseInt(req.query.limit) || 20;
    const changelog = discord.getChangelog(limit);
    res.json({ success: true, count: changelog.length, changelog });
});

/**
 * GET /api/discord/status
 * Retorna o status do notifier
 */
router.get('/status', (req, res) => {
    if (!discord) return res.status(503).json({ success: false, error: 'Discord notifier não disponível' });

    res.json({ success: true, ...discord.getStatus() });
});

module.exports = router;
