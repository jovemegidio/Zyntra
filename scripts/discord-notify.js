#!/usr/bin/env node
// =====================================================
// DISCORD NOTIFY - ALUFORCE SISTEMA
// Script CLI para notificar atualizações no Discord
// =====================================================
// Uso:
//   node scripts/discord-notify.js deploy "Correção de bugs" "Vendas,Financeiro"
//   node scripts/discord-notify.js feature "Nova funcionalidade X" "Vendas" "item1|item2|item3"
//   node scripts/discord-notify.js fix "Correção do bug Y" "Sistema" "correção1|correção2" "arquivo1.js|arquivo2.html"
//   node scripts/discord-notify.js --auto   (detecta arquivos modificados via git)
// =====================================================

'use strict';

const https = require('https');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Webhook URL do Discord (canal #atualizações)
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL 
    || 'https://discord.com/api/webhooks/1465740298243018793/fjkXYSN7Vv06YRyimpqneNVOhADqDACpVTXQxRbyUJnsk-cWpJvnpZzD9JntRVFyhfVt';

const CHANGELOG_FILE = path.join(__dirname, '..', 'logs', 'changelog.json');

// =========================================================
// TIPOS DE NOTIFICAÇÃO
// =========================================================
const TIPOS = {
    'feature':     { emoji: '✨', color: 0x2ecc71, label: 'Nova Funcionalidade' },
    'fix':         { emoji: '🐛', color: 0xe74c3c, label: 'Correção de Bug' },
    'improvement': { emoji: '⚡', color: 0xf39c12, label: 'Melhoria' },
    'security':    { emoji: '🔒', color: 0xe91e63, label: 'Segurança' },
    'deploy':      { emoji: '🚀', color: 0x3498db, label: 'Deploy' },
    'hotfix':      { emoji: '🚑', color: 0xff0000, label: 'Hotfix Urgente' },
    'refactor':    { emoji: '♻️', color: 0x9b59b6, label: 'Refatoração' },
    'style':       { emoji: '🎨', color: 0x1abc9c, label: 'Interface/Estilo' },
    'perf':        { emoji: '⚡', color: 0xf39c12, label: 'Performance' },
    'docs':        { emoji: '📝', color: 0x95a5a6, label: 'Documentação' }
};

// =========================================================
// ENVIO WEBHOOK
// =========================================================
function sendWebhook(payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const url = new URL(WEBHOOK_URL);

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            if (res.statusCode === 204 || res.statusCode === 200) {
                resolve(true);
            } else {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    console.error(`❌ Discord respondeu ${res.statusCode}: ${body}`);
                    resolve(false);
                });
            }
        });

        req.on('error', (err) => {
            console.error('❌ Erro de rede:', err.message);
            resolve(false);
        });

        req.write(data);
        req.end();
    });
}

// =========================================================
// UTILITÁRIOS
// =========================================================
function getVersion() {
    try {
        return require(path.join(__dirname, '..', 'package.json')).version || '2.0.0';
    } catch {
        return '2.0.0';
    }
}

function getTimestamp() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function saveToChangelog(entry) {
    try {
        const dir = path.dirname(CHANGELOG_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let changelog = [];
        if (fs.existsSync(CHANGELOG_FILE)) {
            changelog = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
        }

        changelog.push({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            ...entry
        });

        // Manter apenas últimas 500 entradas
        if (changelog.length > 500) changelog = changelog.slice(-500);

        fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(changelog, null, 2), 'utf8');
    } catch (e) {
        // Silencioso — não impedir o envio por erro no log
    }
}

function getGitInfo() {
    try {
        const lastCommit = execSync('git log -1 --pretty=format:"%h|%s|%an|%ai"', { encoding: 'utf8', cwd: path.join(__dirname, '..') });
        const [hash, message, author, date] = lastCommit.split('|');
        return { hash, message, author, date };
    } catch {
        return null;
    }
}

function getRecentChangedFiles(hours = 2) {
    try {
        const result = execSync(`git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only`, {
            encoding: 'utf8',
            cwd: path.join(__dirname, '..')
        });
        return result.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function detectModuleFromFiles(files) {
    const modules = new Set();
    for (const f of files) {
        if (f.includes('modules/Vendas') || f.includes('Vendas')) modules.add('Vendas');
        else if (f.includes('modules/Financeiro') || f.includes('Financeiro')) modules.add('Financeiro');
        else if (f.includes('modules/PCP') || f.includes('PCP')) modules.add('PCP');
        else if (f.includes('modules/RH') || f.includes('RH')) modules.add('RH');
        else if (f.includes('modules/Compras') || f.includes('Compras')) modules.add('Compras');
        else if (f.includes('modules/Faturamento') || f.includes('Faturamento')) modules.add('Faturamento');
        else if (f.includes('server.js') || f.includes('services/') || f.includes('routes/')) modules.add('Backend');
        else if (f.includes('public/')) modules.add('Frontend');
        else modules.add('Sistema');
    }
    return [...modules].join(', ') || 'Sistema';
}

// =========================================================
// BUILDERS DE EMBED
// =========================================================
function buildUpdateEmbed(tipo, titulo, descricao, modulo, alteracoes = [], arquivos = []) {
    const config = TIPOS[tipo] || TIPOS['improvement'];
    const versao = getVersion();

    const embed = {
        title: `${config.emoji} ${titulo}`,
        color: config.color,
        timestamp: new Date().toISOString(),
        footer: { text: `ALUFORCE v${versao} • ${getTimestamp()}` }
    };

    if (descricao) embed.description = descricao;

    embed.fields = [
        { name: '📂 Tipo', value: config.label, inline: true },
        { name: '📦 Módulo', value: modulo || 'Sistema', inline: true },
        { name: '📌 Versão', value: `v${versao}`, inline: true }
    ];

    if (alteracoes.length > 0) {
        embed.fields.push({
            name: `📋 Alterações (${alteracoes.length})`,
            value: alteracoes.map(a => `• ${a}`).join('\n').substring(0, 1024),
            inline: false
        });
    }

    if (arquivos.length > 0) {
        const lista = arquivos.slice(0, 15).map(f => `\`${f}\``).join('\n');
        const extra = arquivos.length > 15 ? `\n... +${arquivos.length - 15} arquivo(s)` : '';
        embed.fields.push({
            name: `📁 Arquivos (${arquivos.length})`,
            value: (lista + extra).substring(0, 1024),
            inline: false
        });
    }

    return embed;
}

function buildDeployEmbed(descricao, arquivos = [], alteracoes = []) {
    const versao = getVersion();
    const gitInfo = getGitInfo();

    const embed = {
        title: `🚀 Deploy Produção — ALUFORCE v${versao}`,
        color: 0x3498db,
        description: descricao || 'Deploy realizado com sucesso no servidor de produção.',
        timestamp: new Date().toISOString(),
        footer: { text: `ALUFORCE v${versao} • Produção` },
        fields: []
    };

    if (alteracoes.length > 0) {
        embed.fields.push({
            name: '📋 Alterações incluídas',
            value: alteracoes.map(a => `• ${a}`).join('\n').substring(0, 1024),
            inline: false
        });
    }

    if (arquivos.length > 0) {
        const modulo = detectModuleFromFiles(arquivos);
        embed.fields.push(
            { name: '📦 Módulos', value: modulo, inline: true },
            {
                name: `📁 Arquivos (${arquivos.length})`,
                value: arquivos.slice(0, 12).map(f => `\`${f}\``).join('\n').substring(0, 1024),
                inline: false
            }
        );
    }

    if (gitInfo) {
        embed.fields.push({
            name: '🔗 Último Commit',
            value: `\`${gitInfo.hash}\` ${gitInfo.message}\n👨‍💻 ${gitInfo.author}`,
            inline: false
        });
    }

    embed.fields.push({
        name: '🕐 Horário',
        value: getTimestamp(),
        inline: true
    });

    return embed;
}

// =========================================================
// COMANDOS
// =========================================================
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help') {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║           ALUFORCE — Discord Notifier CLI                    ║
╚══════════════════════════════════════════════════════════════╝

Uso:
  node scripts/discord-notify.js <comando> [argumentos]

Comandos:
  deploy <descricao> [modulo]
    Notifica deploy realizado

  feature <titulo> [modulo] [alteracoes separadas por |] [arquivos separados por |]
    Publica nova funcionalidade

  fix <titulo> [modulo] [alteracoes] [arquivos]
    Publica correção de bug

  improvement <titulo> [modulo] [alteracoes] [arquivos]
    Publica melhoria

  hotfix <titulo> [modulo] [alteracoes] [arquivos]
    Publica hotfix urgente

  security <titulo> [modulo] [alteracoes] [arquivos]
    Publica correção de segurança

  style <titulo> [modulo] [alteracoes] [arquivos]
    Publica mudança de interface

  --auto
    Detecta automaticamente arquivos alterados via git e envia como deploy

  --test
    Envia mensagem de teste para verificar conexão

Exemplos:
  node scripts/discord-notify.js deploy "Correção de notificações" "Vendas"
  node scripts/discord-notify.js fix "Notificações não navegavam" "Vendas" "Corrigido abrirDetalhesPedido|Adicionado suporte a ?pedido= na URL"
  node scripts/discord-notify.js --auto
        `);
        return;
    }

    const command = args[0];

    // Teste de conexão
    if (command === '--test') {
        console.log('🧪 Testando conexão com Discord...');
        const ok = await sendWebhook({
            embeds: [{
                title: '🧪 Teste de Conexão',
                description: '✅ Sistema de notificações ALUFORCE conectado com sucesso!',
                color: 0x00ff00,
                footer: { text: `ALUFORCE v${getVersion()} • ${getTimestamp()}` },
                timestamp: new Date().toISOString()
            }]
        });
        console.log(ok ? '✅ Webhook funcionando!' : '❌ Falha no webhook');
        process.exit(ok ? 0 : 1);
    }

    // Auto-detect (usado em scripts de deploy)
    if (command === '--auto') {
        const files = getRecentChangedFiles();
        const gitInfo = getGitInfo();
        const modulo = detectModuleFromFiles(files);

        const descricao = gitInfo 
            ? `Deploy automático: ${gitInfo.message}`
            : 'Deploy automático realizado';

        console.log(`📦 Detectados ${files.length} arquivo(s) alterado(s) em: ${modulo}`);

        const embed = buildDeployEmbed(descricao, files);
        const ok = await sendWebhook({ embeds: [embed] });

        saveToChangelog({
            tipo: 'deploy',
            titulo: descricao,
            modulo,
            arquivos: files,
            versao: getVersion()
        });

        console.log(ok ? '✅ Deploy notificado no Discord!' : '⚠️  Falha ao notificar (salvo localmente)');
        process.exit(ok ? 0 : 1);
    }

    // Comandos tipados: deploy, feature, fix, improvement, etc.
    const tipo = command;
    const titulo = args[1] || 'Atualização do sistema';
    const modulo = args[2] || 'Sistema';
    const alteracoes = args[3] ? args[3].split('|').map(s => s.trim()) : [];
    const arquivos = args[4] ? args[4].split('|').map(s => s.trim()) : [];

    if (tipo === 'deploy') {
        const embed = buildDeployEmbed(titulo, arquivos.length ? arquivos : getRecentChangedFiles(), alteracoes);
        const ok = await sendWebhook({ embeds: [embed] });
        saveToChangelog({ tipo: 'deploy', titulo, modulo, alteracoes, arquivos, versao: getVersion() });
        console.log(ok ? '✅ Deploy notificado no Discord!' : '⚠️  Falha ao notificar');
    } else {
        const embed = buildUpdateEmbed(tipo, titulo, '', modulo, alteracoes, arquivos);
        const ok = await sendWebhook({ embeds: [embed] });
        saveToChangelog({ tipo, titulo, modulo, alteracoes, arquivos, versao: getVersion() });
        console.log(ok ? `✅ ${TIPOS[tipo]?.label || 'Atualização'} notificada no Discord!` : '⚠️  Falha ao notificar');
    }
}

main().catch(err => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
});
