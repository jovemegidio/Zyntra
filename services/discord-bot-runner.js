#!/usr/bin/env node
// =====================================================
// DISCORD BOT RUNNER - ALUFORCE
// Processo standalone para rodar o bot Discord via PM2
// =====================================================
// Uso: node services/discord-bot-runner.js
// PM2:  pm2 start services/discord-bot-runner.js --name aluforce-discord-bot
// =====================================================

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const discordBot = require('./discord-bot');

async function start() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║        ALUFORCE — Discord Bot Inicializando         ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    if (!process.env.DISCORD_BOT_TOKEN) {
        console.log('⚠️  DISCORD_BOT_TOKEN não configurado no .env');
        console.log('');
        console.log('Para usar o bot completo:');
        console.log('  1. Acesse https://discord.com/developers/applications');
        console.log('  2. Crie uma nova Application');
        console.log('  3. Vá em Bot > Token > Copy');
        console.log('  4. Adicione ao .env: DISCORD_BOT_TOKEN=seu_token_aqui');
        console.log('  5. Adicione ao .env: DISCORD_BOT_ENABLED=true');
        console.log('');
        console.log('💡 Enquanto isso, o sistema de Webhook continua funcionando normalmente.');
        console.log('   O webhook não precisa de bot token — apenas da DISCORD_WEBHOOK_URL.');
        process.exit(0);
    }

    try {
        const started = await discordBot.init();
        if (started) {
            console.log('✅ Bot Discord conectado e pronto!');
        } else {
            console.log('⚠️  Bot não iniciou (verifique configurações)');
            // Não fecha — mantém o processo ativo para tentar reconectar
        }
    } catch (err) {
        console.error('❌ Erro fatal:', err.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando bot...');
    await discordBot.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Encerrando bot (SIGTERM)...');
    await discordBot.shutdown();
    process.exit(0);
});

start();
