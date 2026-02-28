#!/usr/bin/env node
// =====================================================
// GIT POST-COMMIT HOOK - ALUFORCE
// Envia automaticamente commits para o Discord
// 
// INSTALAÇÃO:
//   Copie este arquivo para .git/hooks/post-commit
//   Ou execute: node scripts/install-git-hook.js
// =====================================================

'use strict';

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Carrega .env se disponível
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
    // dotenv pode não estar disponível no contexto do hook
}

// Configuração
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_ATUALIZACOES || process.env.DISCORD_WEBHOOK_URL;
const API_URL = process.env.ALUFORCE_API_URL || 'http://localhost:3000';

/**
 * Obtém informações do último commit
 */
function getLastCommit() {
    try {
        const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        const message = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
        const author = execSync('git log -1 --pretty=%an', { encoding: 'utf8' }).trim();
        const email = execSync('git log -1 --pretty=%ae', { encoding: 'utf8' }).trim();
        const date = execSync('git log -1 --pretty=%ci', { encoding: 'utf8' }).trim();
        const filesChanged = execSync('git diff-tree --no-commit-id --name-only -r HEAD', { encoding: 'utf8' })
            .trim().split('\n').filter(Boolean);
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

        return { hash, message, author, email, date, filesChanged, branch };
    } catch (error) {
        console.error('Erro ao obter informações do commit:', error.message);
        return null;
    }
}

/**
 * Classifica o tipo de commit pelo prefixo conventional commits
 */
function classifyCommit(message) {
    const types = {
        'feat': { emoji: '✨', color: 0x2ecc71, label: 'Nova Funcionalidade' },
        'fix': { emoji: '🐛', color: 0xe74c3c, label: 'Correção de Bug' },
        'perf': { emoji: '⚡', color: 0xf39c12, label: 'Performance' },
        'refactor': { emoji: '♻️', color: 0x9b59b6, label: 'Refatoração' },
        'security': { emoji: '🔒', color: 0xe91e63, label: 'Segurança' },
        'style': { emoji: '🎨', color: 0x3498db, label: 'Interface/Estilo' },
        'docs': { emoji: '📝', color: 0x95a5a6, label: 'Documentação' },
        'hotfix': { emoji: '🚑', color: 0xff0000, label: 'Hotfix' },
        'chore': { emoji: '🔧', color: 0x607d8b, label: 'Manutenção' },
        'deploy': { emoji: '🚀', color: 0x00bcd4, label: 'Deploy' },
        'test': { emoji: '🧪', color: 0x4caf50, label: 'Testes' }
    };

    const prefix = message.split(':')[0]?.split('(')[0]?.trim().toLowerCase();
    return types[prefix] || { emoji: '🔄', color: 0x607d8b, label: 'Atualização' };
}

/**
 * Detecta módulo afetado pelos arquivos alterados
 */
function detectModule(files) {
    const moduleMap = {
        'modules/Vendas': 'Vendas',
        'modules/Financeiro': 'Financeiro',
        'modules/PCP': 'PCP',
        'modules/RH': 'RH',
        'modules/Compras': 'Compras',
        'modules/Logistica': 'Logística',
        'modules/Qualidade': 'Qualidade',
        'modules/Manutencao': 'Manutenção',
        'server.js': 'Backend',
        'services/': 'Serviços',
        'routes/': 'API/Rotas',
        'middleware/': 'Middleware',
        'config/': 'Configuração',
        'public/': 'Frontend',
        'src/': 'Core',
        'scripts/': 'Scripts'
    };

    const modules = new Set();
    for (const file of files) {
        for (const [pattern, modulo] of Object.entries(moduleMap)) {
            if (file.includes(pattern)) {
                modules.add(modulo);
            }
        }
    }

    return modules.size > 0 ? [...modules].join(', ') : 'Sistema';
}

/**
 * Lê a versão do package.json
 */
function getVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        return pkg.version || '2.0.0';
    } catch {
        return '2.0.0';
    }
}

/**
 * Envia via Webhook do Discord (mais rápido, não depende do servidor)
 */
async function sendViaWebhook(commit) {
    if (!WEBHOOK_URL) return false;

    const info = classifyCommit(commit.message);
    const modulo = detectModule(commit.filesChanged);
    const cleanMsg = commit.message.replace(/^[a-z]+(\([^)]*\))?:\s*/i, '');

    const payload = {
        embeds: [{
            title: `${info.emoji} ${cleanMsg}`,
            color: info.color,
            fields: [
                { name: '📂 Tipo', value: info.label, inline: true },
                { name: '📦 Módulo', value: modulo, inline: true },
                { name: '📌 Versão', value: `v${getVersion()}`, inline: true },
                { name: '👨‍💻 Autor', value: commit.author, inline: true },
                { name: '🌿 Branch', value: `\`${commit.branch}\``, inline: true },
                { name: '🔗 Commit', value: `\`${commit.hash}\``, inline: true }
            ],
            footer: { text: `ALUFORCE Sistema | ${commit.filesChanged.length} arquivo(s) alterado(s)` },
            timestamp: new Date().toISOString()
        }]
    };

    // Mostra arquivos alterados (até 10)
    if (commit.filesChanged.length > 0) {
        const filesList = commit.filesChanged
            .slice(0, 10)
            .map(f => `\`${f}\``)
            .join('\n');
        const extra = commit.filesChanged.length > 10 
            ? `\n... e mais ${commit.filesChanged.length - 10} arquivo(s)` 
            : '';
        payload.embeds[0].fields.push({
            name: '📁 Arquivos Alterados',
            value: filesList + extra,
            inline: false
        });
    }

    return new Promise((resolve) => {
        const data = JSON.stringify(payload);
        const url = new URL(WEBHOOK_URL);

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            resolve(res.statusCode === 204 || res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.write(data);
        req.end();
    });
}

/**
 * Envia via API do servidor (usa o bot Discord)
 */
async function sendViaAPI(commit) {
    const info = classifyCommit(commit.message);
    const modulo = detectModule(commit.filesChanged);

    const payload = JSON.stringify({
        commits: [{
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            files: commit.filesChanged,
            branch: commit.branch
        }]
    });

    return new Promise((resolve) => {
        const url = new URL(`${API_URL}/api/discord/commits`);
        const protocol = url.protocol === 'https:' ? https : require('http');

        const req = protocol.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'X-Internal-Hook': 'git-post-commit'
            }
        }, (res) => {
            resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => { req.destroy(); resolve(false); });
        req.write(payload);
        req.end();
    });
}

// =====================================================
// EXECUÇÃO PRINCIPAL
// =====================================================
async function main() {
    const commit = getLastCommit();
    if (!commit) {
        process.exit(0);
    }

    // Ignora commits de merge automático
    if (commit.message.startsWith('Merge') || commit.message.startsWith('merge')) {
        process.exit(0);
    }

    console.log(`📢 [Git Hook] Notificando commit: ${commit.hash} - ${commit.message}`);

    // Tenta primeiro via webhook (mais rápido e confiável)
    let sent = await sendViaWebhook(commit);
    
    if (!sent) {
        // Fallback: tenta via API do servidor
        sent = await sendViaAPI(commit);
    }

    if (sent) {
        console.log('✅ [Git Hook] Commit notificado no Discord');
    } else {
        console.log('⚠️  [Git Hook] Não foi possível notificar (webhook/API indisponível)');
    }
}

// Executa se chamado diretamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { getLastCommit, classifyCommit, detectModule, sendViaWebhook };
