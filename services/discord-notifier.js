// =====================================================
// DISCORD NOTIFIER - ALUFORCE SISTEMA
// Envia notificações em tempo real via Webhook do Discord
// Funciona sem bot token — usa apenas webhook URL
// =====================================================

'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHANGELOG_FILE = path.join(__dirname, '..', 'logs', 'changelog.json');

class DiscordNotifier {
    constructor() {
        this.webhookUrl = process.env.DISCORD_WEBHOOK_URL 
            || process.env.DISCORD_WEBHOOK_ATUALIZACOES 
            || 'https://discord.com/api/webhooks/1465740298243018793/fjkXYSN7Vv06YRyimpqneNVOhADqDACpVTXQxRbyUJnsk-cWpJvnpZzD9JntRVFyhfVt';
        this.enabled = process.env.DISCORD_NOTIFICATIONS_ENABLED !== 'false'; // Habilitado por padrão
        this.changelog = [];
        this.queue = [];
        this.processing = false;
        this.rateLimitReset = 0;
        this._loadChangelog();
    }

    // =========================================================
    // CORE — ENVIO VIA WEBHOOK
    // =========================================================

    /**
     * Envia um payload para o webhook do Discord
     * @param {Object} payload - Objeto com embeds do Discord
     * @returns {Promise<boolean>}
     */
    async _sendWebhook(payload) {
        if (!this.webhookUrl) {
            console.warn('⚠️  [Discord] DISCORD_WEBHOOK_URL não configurado');
            return false;
        }

        // Respeitar rate limit
        const now = Date.now();
        if (now < this.rateLimitReset) {
            const wait = this.rateLimitReset - now;
            console.log(`⏳ [Discord] Rate limit, aguardando ${wait}ms...`);
            await new Promise(r => setTimeout(r, wait));
        }

        return new Promise((resolve) => {
            try {
                const data = JSON.stringify(payload);
                const url = new URL(this.webhookUrl);
                const isHttps = url.protocol === 'https:';

                const req = (isHttps ? https : http).request({
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data)
                    },
                    timeout: 10000
                }, (res) => {
                    // Atualizar rate limit
                    const remaining = res.headers['x-ratelimit-remaining'];
                    const resetAfter = res.headers['x-ratelimit-reset-after'];
                    if (remaining === '0' && resetAfter) {
                        this.rateLimitReset = Date.now() + (parseFloat(resetAfter) * 1000);
                    }

                    if (res.statusCode === 204 || res.statusCode === 200) {
                        resolve(true);
                    } else if (res.statusCode === 429) {
                        // Rate limited — ler retry_after do body
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            try {
                                const parsed = JSON.parse(body);
                                this.rateLimitReset = Date.now() + (parsed.retry_after || 1) * 1000;
                            } catch {}
                            resolve(false);
                        });
                    } else {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            console.warn(`⚠️  [Discord] Webhook respondeu ${res.statusCode}: ${body.substring(0, 200)}`);
                            resolve(false);
                        });
                    }
                });

                req.on('error', (err) => {
                    console.error('❌ [Discord] Erro de rede:', err.message);
                    resolve(false);
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });

                req.write(data);
                req.end();
            } catch (err) {
                console.error('❌ [Discord] Erro ao enviar webhook:', err.message);
                resolve(false);
            }
        });
    }

    /**
     * Processa a fila de mensagens (evita rate limit)
     */
    async _processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const payload = this.queue.shift();
            await this._sendWebhook(payload);
            // Aguarda 500ms entre mensagens para não bater rate limit
            if (this.queue.length > 0) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        this.processing = false;
    }

    /**
     * Enfileira uma mensagem para envio
     */
    _enqueue(payload) {
        this.queue.push(payload);
        this._processQueue();
    }

    // =========================================================
    // TIPOS DE NOTIFICAÇÃO
    // =========================================================

    /**
     * Configuração de tipos de atualização
     */
    static get TIPOS() {
        return {
            'feature':     { emoji: '✨', color: 0x2ecc71, label: 'Nova Funcionalidade' },
            'fix':         { emoji: '🐛', color: 0xe74c3c, label: 'Correção de Bug' },
            'improvement': { emoji: '⚡', color: 0xf39c12, label: 'Melhoria' },
            'security':    { emoji: '🔒', color: 0xe91e63, label: 'Segurança' },
            'deploy':      { emoji: '🚀', color: 0x3498db, label: 'Deploy' },
            'hotfix':      { emoji: '🚑', color: 0xff0000, label: 'Hotfix Urgente' },
            'refactor':    { emoji: '♻️', color: 0x9b59b6, label: 'Refatoração' },
            'docs':        { emoji: '📝', color: 0x95a5a6, label: 'Documentação' },
            'style':       { emoji: '🎨', color: 0x3498db, label: 'Interface/Estilo' },
            'breaking':    { emoji: '💥', color: 0xff0000, label: 'Mudança Importante' },
            'startup':     { emoji: '🟢', color: 0x00e676, label: 'Sistema Online' },
            'shutdown':    { emoji: '🔴', color: 0xf44336, label: 'Sistema Offline' },
            'config':      { emoji: '⚙️', color: 0x607d8b, label: 'Configuração' }
        };
    }

    // =========================================================
    // MÉTODOS PÚBLICOS DE NOTIFICAÇÃO
    // =========================================================

    /**
     * Publica uma atualização genérica
     * @param {Object} update
     * @param {string} update.tipo - Tipo da atualização (feature, fix, improvement, etc.)
     * @param {string} update.titulo - Título
     * @param {string} update.descricao - Descrição
     * @param {string} [update.modulo] - Módulo afetado
     * @param {string[]} [update.alteracoes] - Lista de alterações
     * @param {string} [update.autor] - Autor
     * @param {string[]} [update.arquivos] - Arquivos alterados
     */
    async publicarAtualizacao(update) {
        // Sempre salva no changelog local
        this._saveToChangelog(update);

        if (!this.enabled) {
            console.log('📋 [Discord] Notificação salva localmente (envio desabilitado)');
            return false;
        }

        const config = DiscordNotifier.TIPOS[update.tipo] || DiscordNotifier.TIPOS['improvement'];
        const versao = update.versao || this._getVersion();

        const embed = {
            title: `${config.emoji} ${update.titulo}`,
            color: config.color,
            timestamp: new Date().toISOString(),
            footer: { text: `ALUFORCE v${versao} | ${(process.env.NODE_ENV || 'dev').toUpperCase()}` }
        };

        if (update.descricao) {
            embed.description = update.descricao;
        }

        embed.fields = [
            { name: '📂 Tipo', value: config.label, inline: true },
            { name: '📦 Módulo', value: update.modulo || 'Sistema', inline: true },
            { name: '📌 Versão', value: `v${versao}`, inline: true }
        ];

        if (update.alteracoes && update.alteracoes.length > 0) {
            embed.fields.push({
                name: '📋 Alterações',
                value: update.alteracoes.map(a => `• ${a}`).join('\n').substring(0, 1024),
                inline: false
            });
        }

        if (update.arquivos && update.arquivos.length > 0) {
            const lista = update.arquivos.slice(0, 15).map(f => `\`${f}\``).join('\n');
            const extra = update.arquivos.length > 15 ? `\n... +${update.arquivos.length - 15} arquivo(s)` : '';
            embed.fields.push({
                name: `📁 Arquivos (${update.arquivos.length})`,
                value: (lista + extra).substring(0, 1024),
                inline: false
            });
        }

        if (update.autor) {
            embed.fields.push({ name: '👨‍💻 Autor', value: update.autor, inline: true });
        }

        embed.fields.push({
            name: '🕐 Data/Hora',
            value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            inline: true
        });

        const payload = { embeds: [embed] };
        this._enqueue(payload);

        console.log(`📢 [Discord] Atualização enfileirada: ${update.titulo}`);
        return true;
    }

    /**
     * Notifica deploy realizado
     */
    async publicarDeploy(info = {}) {
        const versao = info.versao || this._getVersion();
        const embed = {
            title: `🚀 Deploy ${info.ambiente || 'Produção'} — v${versao}`,
            color: 0x3498db,
            description: info.descricao || 'Deploy realizado com sucesso no servidor.',
            timestamp: new Date().toISOString(),
            footer: { text: `ALUFORCE v${versao}` },
            fields: []
        };

        if (info.alteracoes && info.alteracoes.length > 0) {
            embed.fields.push({
                name: '📋 Alterações incluídas',
                value: info.alteracoes.map(a => `• ${a}`).join('\n').substring(0, 1024),
                inline: false
            });
        }

        if (info.arquivos && info.arquivos.length > 0) {
            embed.fields.push({
                name: `📁 Arquivos (${info.arquivos.length})`,
                value: info.arquivos.slice(0, 10).map(f => `\`${f}\``).join('\n').substring(0, 1024),
                inline: false
            });
        }

        embed.fields.push(
            { name: '👨‍💻 Autor', value: info.autor || 'Deploy Automático', inline: true },
            { name: '🕐 Horário', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: true }
        );

        this._saveToChangelog({ tipo: 'deploy', titulo: embed.title, descricao: embed.description, modulo: 'Sistema', versao });
        this._enqueue({ embeds: [embed] });
        console.log(`🚀 [Discord] Deploy notificado: v${versao}`);
        return true;
    }

    /**
     * Notifica startup do servidor (inclui info de deploy se for restart)
     */
    async publicarStartup() {
        const versao = this._getVersion();
        const uptime = process.uptime ? process.uptime() : 0;
        const isRestart = uptime < 10; // Se uptime < 10s, é um restart (deploy provável)
        
        const embed = {
            title: isRestart ? '🚀 Deploy Realizado — ALUFORCE' : '🟢 Sistema ALUFORCE Online',
            color: isRestart ? 0x3498db : 0x00e676,
            description: isRestart 
                ? `O servidor foi reiniciado com sucesso após deploy.\n**Versão:** v${versao}\n**Ambiente:** ${(process.env.NODE_ENV || 'development').toUpperCase()}`
                : `O servidor iniciou com sucesso.\n**Versão:** v${versao}\n**Ambiente:** ${(process.env.NODE_ENV || 'development').toUpperCase()}`,
            timestamp: new Date().toISOString(),
            footer: { text: `ALUFORCE v${versao} | Deploy via PM2` },
            fields: [
                { name: '⏱️ Iniciado em', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: true },
                { name: '🌐 Porta', value: `${process.env.PORT || 3000}`, inline: true },
                { name: '📌 Versão', value: `v${versao}`, inline: true }
            ]
        };

        // Tentar detectar arquivos modificados recentemente no servidor
        if (isRestart) {
            try {
                const fs = require('fs');
                const path = require('path');
                const baseDir = path.resolve(__dirname, '..');
                const agora = Date.now();
                const limiteMs = 5 * 60 * 1000; // últimos 5 minutos
                const arquivosRecentes = [];
                
                const pastas = ['routes', 'services', 'modules', 'public/js'];
                for (const pasta of pastas) {
                    const dir = path.join(baseDir, pasta);
                    if (fs.existsSync(dir)) {
                        const scan = (d) => {
                            try {
                                const items = fs.readdirSync(d);
                                for (const item of items) {
                                    const full = path.join(d, item);
                                    const stat = fs.statSync(full);
                                    if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                                        scan(full);
                                    } else if (stat.isFile() && (agora - stat.mtimeMs) < limiteMs) {
                                        arquivosRecentes.push(full.replace(baseDir + path.sep, '').replace(/\\/g, '/'));
                                    }
                                }
                            } catch(e) {}
                        };
                        scan(dir);
                    }
                }
                
                if (arquivosRecentes.length > 0) {
                    const lista = arquivosRecentes.slice(0, 10).map(f => `\`${f}\``).join('\n');
                    const extra = arquivosRecentes.length > 10 ? `\n... +${arquivosRecentes.length - 10} mais` : '';
                    embed.fields.push({
                        name: `📁 Arquivos Atualizados (${arquivosRecentes.length})`,
                        value: (lista + extra).substring(0, 1024),
                        inline: false
                    });
                }
            } catch(e) {
                // Silenciar erro de detecção de arquivos
            }
        }

        this._enqueue({ embeds: [embed] });
        return true;
    }

    /**
     * Notifica shutdown do servidor
     */
    async publicarShutdown(reason) {
        const embed = {
            title: '🔴 Sistema ALUFORCE Offline',
            color: 0xf44336,
            description: `O servidor foi encerrado.\n**Motivo:** ${reason || 'Desligamento gracioso'}`,
            timestamp: new Date().toISOString(),
            footer: { text: `ALUFORCE v${this._getVersion()}` }
        };

        // Envio síncrono (sem fila) pois o servidor está encerrando
        return await this._sendWebhook({ embeds: [embed] });
    }

    /**
     * Publica notificação de commits do Git
     */
    async publicarCommits(commits) {
        if (!commits || commits.length === 0) return false;

        const tipoMap = {
            'feat': { emoji: '✨', label: 'Nova Funcionalidade' },
            'fix': { emoji: '🐛', label: 'Correção de Bug' },
            'perf': { emoji: '⚡', label: 'Performance' },
            'refactor': { emoji: '♻️', label: 'Refatoração' },
            'security': { emoji: '🔒', label: 'Segurança' },
            'style': { emoji: '🎨', label: 'Interface/Estilo' },
            'docs': { emoji: '📝', label: 'Documentação' },
            'hotfix': { emoji: '🚑', label: 'Hotfix' },
            'chore': { emoji: '🔧', label: 'Manutenção' },
            'deploy': { emoji: '🚀', label: 'Deploy' }
        };

        // Agrupar commits por tipo
        const grouped = {};
        for (const commit of commits) {
            const prefix = (commit.message || '').split(':')[0]?.split('(')[0]?.trim().toLowerCase();
            const info = tipoMap[prefix] || { emoji: '🔄', label: 'Atualização' };

            if (!grouped[info.label]) {
                grouped[info.label] = { ...info, items: [] };
            }
            const cleanMsg = commit.message.replace(/^[a-z]+(\([^)]*\))?:\s*/i, '');
            grouped[info.label].items.push({
                message: cleanMsg,
                author: commit.author,
                hash: (commit.hash || '').substring(0, 7)
            });
        }

        const versao = this._getVersion();
        const embed = {
            title: `📦 Atualização do Sistema — v${versao}`,
            color: 0x2ecc71,
            description: `**${commits.length} alteração(ões)** aplicadas ao sistema`,
            timestamp: new Date().toISOString(),
            footer: { text: `ALUFORCE v${versao} | ${(process.env.NODE_ENV || 'dev').toUpperCase()}` },
            fields: []
        };

        for (const [label, group] of Object.entries(grouped)) {
            const items = group.items
                .map(i => `${group.emoji} ${i.message}${i.hash ? ` (\`${i.hash}\`)` : ''}`)
                .join('\n');
            embed.fields.push({
                name: `${group.emoji} ${label} (${group.items.length})`,
                value: items.substring(0, 1024),
                inline: false
            });
        }

        const autores = [...new Set(commits.map(c => c.author).filter(Boolean))];
        if (autores.length > 0) {
            embed.fields.push({ name: '👨‍💻 Desenvolvedores', value: autores.join(', '), inline: false });
        }

        this._saveToChangelog({
            tipo: 'deploy',
            titulo: `Atualização v${versao} (${commits.length} commits)`,
            descricao: Object.entries(grouped).map(([k, v]) => `${k}: ${v.items.length}`).join(', '),
            modulo: 'Sistema'
        });

        this._enqueue({ embeds: [embed] });
        console.log(`📢 [Discord] ${commits.length} commits notificados`);
        return true;
    }

    // =========================================================
    // CHANGELOG LOCAL
    // =========================================================

    _loadChangelog() {
        try {
            if (fs.existsSync(CHANGELOG_FILE)) {
                this.changelog = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
            }
        } catch (e) {
            this.changelog = [];
        }
    }

    _saveToChangelog(update) {
        const entry = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            tipo: update.tipo || 'improvement',
            titulo: update.titulo,
            descricao: update.descricao || '',
            modulo: update.modulo || 'Sistema',
            alteracoes: update.alteracoes || [],
            autor: update.autor || null,
            versao: update.versao || this._getVersion()
        };

        this.changelog.push(entry);
        if (this.changelog.length > 500) {
            this.changelog = this.changelog.slice(-500);
        }

        try {
            const dir = path.dirname(CHANGELOG_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(this.changelog, null, 2), 'utf8');
        } catch (e) {
            console.error('❌ [Discord] Erro ao salvar changelog:', e.message);
        }
    }

    _getVersion() {
        try {
            return require('../package.json').version || '2.0.0';
        } catch {
            return '2.0.0';
        }
    }

    // =========================================================
    // GETTERS
    // =========================================================

    getChangelog(limit = 20) {
        return this.changelog.slice(-limit).reverse();
    }

    isReady() {
        return this.enabled && !!this.webhookUrl;
    }

    getStatus() {
        return {
            enabled: this.enabled,
            hasWebhook: !!this.webhookUrl,
            queueSize: this.queue.length,
            changelogCount: this.changelog.length
        };
    }

    async shutdown() {
        // Nada para desconectar com webhook
        console.log('🛑 [Discord] Notifier encerrado');
    }

    // Compatibilidade com discord-bot.js
    async init() {
        if (!this.enabled) {
            console.log('🤖 [Discord] Notificações desabilitadas via DISCORD_NOTIFICATIONS_ENABLED');
            return false;
        }
        if (!this.webhookUrl) {
            console.warn('⚠️  [Discord] DISCORD_WEBHOOK_URL não configurado');
            return false;
        }
        console.log('✅ [Discord] Notifier pronto (modo Webhook)');
        return true;
    }
}

// Singleton
const notifier = new DiscordNotifier();
module.exports = notifier;
