// =================================================================
// n8n INTEGRATION SERVICE — Comunicação bidirecional com n8n
// ALUFORCE ERP v2.0
// =================================================================
// Serviço para disparar eventos do ALUFORCE → n8n via webhooks
// e gerenciar a integração entre os dois sistemas.
// =================================================================

'use strict';

const http = require('http');
const https = require('https');

let _n8nBreaker;
try {
    _n8nBreaker = require('./external-breakers').n8nBreaker;
} catch (e) { /* fallback: no circuit breaker */ }

class N8nIntegration {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || process.env.N8N_WEBHOOK_URL || 'http://localhost:5678';
        this.apiKey = options.apiKey || process.env.N8N_API_KEY || 'n8n-internal-key-2026';
        this.enabled = options.enabled !== false && process.env.N8N_ENABLED !== 'false';
        this.timeout = options.timeout || 10000;
        this.retries = options.retries || 2;

        // Fila de eventos para retry
        this._queue = [];
        this._processing = false;

        if (this.enabled) {
            console.log(`🤖 [n8n] Integration ativa — URL: ${this.baseUrl}`);
        } else {
            console.log('🤖 [n8n] Integration desabilitada');
        }
    }

    // ── HTTP Helper ────────────────────────────────────
    async _request(method, path, data = null) {
        if (!this.enabled) return { success: false, reason: 'n8n disabled' };

        // Circuit breaker — skip if n8n is known-down
        if (_n8nBreaker) {
            try {
                return await _n8nBreaker.execute(() => this._doRequest(method, path, data));
            } catch (e) {
                console.warn(`⚠️ [n8n] Circuit breaker: ${e.message}`);
                return { success: false, error: e.message };
            }
        }
        return this._doRequest(method, path, data);
    }

    async _doRequest(method, path, data = null) {

        const url = new URL(path, this.baseUrl);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const body = data ? JSON.stringify(data) : null;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: method.toUpperCase(),
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'X-N8N-API-Key': this.apiKey,
                'User-Agent': 'ALUFORCE-ERP/2.0'
            }
        };

        if (body) {
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }

        return new Promise((resolve, reject) => {
            const req = lib.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        resolve({
                            success: res.statusCode >= 200 && res.statusCode < 300,
                            status: res.statusCode,
                            data: JSON.parse(responseData)
                        });
                    } catch {
                        resolve({
                            success: res.statusCode >= 200 && res.statusCode < 300,
                            status: res.statusCode,
                            data: responseData
                        });
                    }
                });
            });

            req.on('error', (err) => {
                console.warn(`[n8n] Erro na requisição ${method} ${path}:`, err.message);
                reject(err);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('n8n request timeout'));
            });

            if (body) req.write(body);
            req.end();
        });
    }

    // ── Disparar Webhook no n8n ──────────────────────────
    // Cada webhook corresponde a um Workflow no n8n configurado
    // com um "Webhook Trigger" node.

    /**
     * Dispara um webhook genérico no n8n
     * @param {string} webhookPath - Caminho do webhook (ex: '/webhook/vendas-nova')
     * @param {object} payload - Dados a enviar
     */
    async triggerWebhook(webhookPath, payload) {
        const fullPath = webhookPath.startsWith('/') ? webhookPath : `/webhook/${webhookPath}`;
        return this._requestWithRetry('POST', fullPath, {
            ...payload,
            _source: 'aluforce-erp',
            _timestamp: new Date().toISOString()
        });
    }

    async _requestWithRetry(method, path, data, attempt = 0) {
        try {
            const result = await this._request(method, path, data);
            if (!result.success && attempt < this.retries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(r => setTimeout(r, delay));
                return this._requestWithRetry(method, path, data, attempt + 1);
            }
            return result;
        } catch (err) {
            if (attempt < this.retries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(r => setTimeout(r, delay));
                return this._requestWithRetry(method, path, data, attempt + 1);
            }
            return { success: false, error: err.message };
        }
    }

    // =================================================================
    // 🎯 EVENTOS DE NEGÓCIO — Disparos para workflows do n8n
    // =================================================================

    // ── VENDAS ──────────────────────────────────────────

    /** Nova venda criada */
    async onVendaCriada(venda) {
        return this.triggerWebhook('vendas-nova', {
            evento: 'venda_criada',
            venda_id: venda.id,
            cliente: venda.cliente_nome || venda.cliente_id,
            valor: venda.valor,
            vendedor: venda.vendedor_nome || venda.vendedor_id,
            itens: venda.itens_count || 0
        });
    }

    /** Venda aprovada */
    async onVendaAprovada(venda) {
        return this.triggerWebhook('vendas-aprovada', {
            evento: 'venda_aprovada',
            venda_id: venda.id,
            cliente: venda.cliente_nome,
            valor: venda.valor
        });
    }

    // ── FINANCEIRO ──────────────────────────────────────

    /** Pagamento recebido */
    async onPagamentoRecebido(pagamento) {
        return this.triggerWebhook('financeiro-pagamento', {
            evento: 'pagamento_recebido',
            conta_id: pagamento.id,
            cliente: pagamento.cliente_nome,
            valor: pagamento.valor,
            forma_pagamento: pagamento.forma_pagamento
        });
    }

    /** Conta vencida (não paga) */
    async onContaVencida(conta) {
        return this.triggerWebhook('financeiro-vencida', {
            evento: 'conta_vencida',
            conta_id: conta.id,
            tipo: conta.tipo, // 'receber' ou 'pagar'
            cliente_fornecedor: conta.nome,
            email: conta.email,
            valor: conta.valor,
            vencimento: conta.vencimento,
            dias_atraso: conta.dias_atraso
        });
    }

    // ── COMPRAS ─────────────────────────────────────────

    /** Pedido de compra criado */
    async onPedidoCompraCriado(pedido) {
        return this.triggerWebhook('compras-novo-pedido', {
            evento: 'pedido_compra_criado',
            pedido_id: pedido.id,
            numero: pedido.numero_pedido,
            fornecedor: pedido.fornecedor,
            valor: pedido.valor_total,
            solicitante: pedido.solicitante
        });
    }

    /** Estoque crítico detectado */
    async onEstoqueCritico(produtos) {
        return this.triggerWebhook('estoque-critico', {
            evento: 'estoque_critico',
            total_produtos: produtos.length,
            produtos: produtos.slice(0, 20) // Limitar a 20 itens
        });
    }

    // ── RH ──────────────────────────────────────────────

    /** Novo funcionário admitido */
    async onAdmissao(funcionario) {
        return this.triggerWebhook('rh-admissao', {
            evento: 'admissao',
            funcionario_id: funcionario.id,
            nome: funcionario.nome,
            cargo: funcionario.cargo,
            area: funcionario.area,
            data_admissao: funcionario.data_admissao
        });
    }

    /** Aniversariante do dia */
    async onAniversario(funcionario) {
        return this.triggerWebhook('rh-aniversario', {
            evento: 'aniversario',
            funcionario_id: funcionario.id,
            nome: funcionario.nome,
            email: funcionario.email,
            idade: funcionario.idade
        });
    }

    // ── PCP / PRODUÇÃO ──────────────────────────────────

    /** Ordem de produção iniciada */
    async onProducaoIniciada(op) {
        return this.triggerWebhook('pcp-producao', {
            evento: 'producao_iniciada',
            op_id: op.id,
            numero: op.numero,
            produto: op.produto,
            quantidade: op.quantidade
        });
    }

    /** Produção concluída */
    async onProducaoConcluida(op) {
        return this.triggerWebhook('pcp-producao-concluida', {
            evento: 'producao_concluida',
            op_id: op.id,
            numero: op.numero,
            produto: op.produto
        });
    }

    // ── SISTEMA / DEVOPS ────────────────────────────────

    /** Servidor iniciado/reiniciado */
    async onServerStart(info = {}) {
        return this.triggerWebhook('sistema-startup', {
            evento: 'server_start',
            versao: info.versao || '2.0',
            ambiente: process.env.NODE_ENV || 'development',
            pid: process.pid,
            node_version: process.version,
            uptime: process.uptime()
        });
    }

    /** Erro crítico no sistema */
    async onErroSistema(error, contexto = '') {
        return this.triggerWebhook('sistema-erro', {
            evento: 'erro_critico',
            mensagem: error.message || String(error),
            stack: (error.stack || '').slice(0, 500),
            contexto,
            timestamp: new Date().toISOString()
        });
    }

    /** Deploy realizado */
    async onDeploy(info = {}) {
        return this.triggerWebhook('sistema-deploy', {
            evento: 'deploy',
            versao: info.versao,
            autor: info.autor,
            arquivos: info.arquivos || [],
            ambiente: info.ambiente || 'production'
        });
    }

    /** Health check falhou */
    async onHealthCheckFailed(details = {}) {
        return this.triggerWebhook('sistema-health-fail', {
            evento: 'health_check_failed',
            ...details
        });
    }

    // ── RELATÓRIOS ──────────────────────────────────────

    /** Relatório gerado em qualquer módulo → notifica por email via n8n */
    async onRelatorioGerado(relatorio) {
        return this.triggerWebhook('relatorio-gerado', {
            evento: 'relatorio_gerado',
            modulo: relatorio.modulo || 'sistema',
            nome_relatorio: relatorio.nome_relatorio || 'Relatório',
            tipo_relatorio: relatorio.tipo_relatorio || 'pdf',
            usuario: relatorio.usuario || 'Sistema',
            email_usuario: relatorio.email_usuario || '',
            email_destino: relatorio.email_destino || relatorio.email_usuario || '',
            descricao: relatorio.descricao || '',
            parametros: relatorio.parametros || {},
            link_download: relatorio.link_download || '',
            timestamp: new Date().toISOString()
        });
    }
}

// Singleton
let instance = null;

function getN8nIntegration(options) {
    if (!instance) {
        instance = new N8nIntegration(options);
    }
    return instance;
}

module.exports = { N8nIntegration, getN8nIntegration };
