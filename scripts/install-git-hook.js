#!/usr/bin/env node
// =====================================================
// INSTALADOR DO GIT HOOK PARA DISCORD
// Instala o hook post-commit automaticamente
// Uso: node scripts/install-git-hook.js
// =====================================================

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOOKS_DIR = path.join(ROOT, '.git', 'hooks');
const HOOK_FILE = path.join(HOOKS_DIR, 'post-commit');

const hookContent = `#!/bin/sh
# ALUFORCE - Git Post-Commit Hook
# Envia notificação de commit para o Discord
# Instalado automaticamente por: node scripts/install-git-hook.js

# Executa o script Node.js em background para não atrasar o commit
node "${path.join(ROOT, 'scripts', 'discord-git-hook.js').replace(/\\/g, '/')}" &
`;

function install() {
    console.log('🔧 Instalando Git Hook para Discord...\n');

    // Verifica se é um repositório git
    if (!fs.existsSync(path.join(ROOT, '.git'))) {
        console.error('❌ Não é um repositório Git. Execute "git init" primeiro.');
        process.exit(1);
    }

    // Cria diretório hooks se não existir
    if (!fs.existsSync(HOOKS_DIR)) {
        fs.mkdirSync(HOOKS_DIR, { recursive: true });
    }

    // Backup do hook existente
    if (fs.existsSync(HOOK_FILE)) {
        const backup = HOOK_FILE + '.backup.' + Date.now();
        fs.copyFileSync(HOOK_FILE, backup);
        console.log(`📁 Backup do hook existente salvo em: ${backup}`);
    }

    // Escreve o hook
    fs.writeFileSync(HOOK_FILE, hookContent, { mode: 0o755 });

    console.log('✅ Git hook post-commit instalado com sucesso!');
    console.log(`📍 Local: ${HOOK_FILE}`);
    console.log('\n📋 O que acontece agora:');
    console.log('   • Cada "git commit" vai notificar automaticamente no Discord');
    console.log('   • O hook roda em background (não atrasa o commit)');
    console.log('   • Configure DISCORD_WEBHOOK_ATUALIZACOES no .env');
    console.log('\n⚙️  Variáveis de ambiente necessárias no .env:');
    console.log('   DISCORD_WEBHOOK_ATUALIZACOES=https://discord.com/api/webhooks/...');
    console.log('   ou DISCORD_BOT_TOKEN=seu_token_aqui (para usar o bot)');
}

install();
