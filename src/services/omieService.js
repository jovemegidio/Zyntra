/**
 * Serviço de Integração com API do Omie ERP
 * ALUFORCE Sistema v2.0
 * 
 * Documentação: https://developer.omie.com.br/
 */

const https = require('https');

class OmieService {
    constructor() {
        this.baseUrl = 'https://app.omie.com.br/api/v1';
        // SECURITY FIX: Credenciais DEVEM vir de variáveis de ambiente (Due Diligence 2026-02-15)
        // Nunca usar fallback hardcoded — chaves antigas foram rotacionadas
        this.appKey = process.env.OMIE_APP_KEY || '';
        this.appSecret = process.env.OMIE_APP_SECRET || '';
        if (!this.appKey || !this.appSecret) {
            console.warn('⚠️  [OMIE] OMIE_APP_KEY e OMIE_APP_SECRET não configurados no .env');
        }
    }

    /**
     * Chamada genérica para a API do Omie
     */
    async callAPI(endpoint, call, params = {}) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                call: call,
                app_key: this.appKey,
                app_secret: this.appSecret,
                param: [params]
            });

            const url = new URL(`${this.baseUrl}/${endpoint}/`);
            
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        if (response.faultstring) {
                            reject(new Error(response.faultstring));
                        } else {
                            resolve(response);
                        }
                    } catch (e) {
                        reject(new Error('Erro ao parsear resposta do Omie'));
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    // ========================================
    // CLIENTES
    // ========================================

    /**
     * Listar clientes do Omie
     */
    async listarClientes(pagina = 1, registrosPorPagina = 50) {
        return this.callAPI('geral/clientes', 'ListarClientes', {
            pagina: pagina,
            registros_por_pagina: registrosPorPagina,
            apenas_importado_api: 'N'
        });
    }

    /**
     * Consultar cliente por código
     */
    async consultarCliente(codigoCliente) {
        return this.callAPI('geral/clientes', 'ConsultarCliente', {
            codigo_cliente_omie: codigoCliente
        });
    }

    /**
     * Incluir cliente no Omie
     */
    async incluirCliente(cliente) {
        return this.callAPI('geral/clientes', 'IncluirCliente', cliente);
    }

    /**
     * Alterar cliente no Omie
     */
    async alterarCliente(cliente) {
        return this.callAPI('geral/clientes', 'AlterarCliente', cliente);
    }

    // ========================================
    // FORNECEDORES
    // ========================================

    /**
     * Listar fornecedores (usa mesma API de clientes com filtro)
     */
    async listarFornecedores(pagina = 1, registrosPorPagina = 50) {
        return this.callAPI('geral/clientes', 'ListarClientes', {
            pagina: pagina,
            registros_por_pagina: registrosPorPagina,
            clientesFiltro: {
                tags: [{ tag: 'Fornecedor' }]
            }
        });
    }

    // ========================================
    // CONTAS A PAGAR
    // ========================================

    /**
     * Listar contas a pagar
     */
    async listarContasPagar(pagina = 1, registrosPorPagina = 50, filtros = {}) {
        return this.callAPI('financas/contapagar', 'ListarContasPagar', {
            pagina: pagina,
            registros_por_pagina: registrosPorPagina,
            ...filtros
        });
    }

    /**
     * Consultar conta a pagar
     */
    async consultarContaPagar(codigoLancamento) {
        return this.callAPI('financas/contapagar', 'ConsultarContaPagar', {
            codigo_lancamento_omie: codigoLancamento
        });
    }

    /**
     * Incluir conta a pagar
     */
    async incluirContaPagar(conta) {
        return this.callAPI('financas/contapagar', 'IncluirContaPagar', conta);
    }

    /**
     * Baixar conta a pagar (registrar pagamento)
     */
    async baixarContaPagar(codigoLancamento, dataBaixa, valor) {
        return this.callAPI('financas/contapagar', 'LancarBaixaContaPagar', {
            codigo_lancamento_omie: codigoLancamento,
            data_baixa: dataBaixa,
            valor_baixa: valor
        });
    }

    // ========================================
    // CONTAS A RECEBER
    // ========================================

    /**
     * Listar contas a receber
     */
    async listarContasReceber(pagina = 1, registrosPorPagina = 50, filtros = {}) {
        return this.callAPI('financas/contareceber', 'ListarContasReceber', {
            pagina: pagina,
            registros_por_pagina: registrosPorPagina,
            ...filtros
        });
    }

    /**
     * Consultar conta a receber
     */
    async consultarContaReceber(codigoLancamento) {
        return this.callAPI('financas/contareceber', 'ConsultarContaReceber', {
            codigo_lancamento_omie: codigoLancamento
        });
    }

    /**
     * Incluir conta a receber
     */
    async incluirContaReceber(conta) {
        return this.callAPI('financas/contareceber', 'IncluirContaReceber', conta);
    }

    /**
     * Baixar conta a receber (registrar recebimento)
     */
    async baixarContaReceber(codigoLancamento, dataBaixa, valor) {
        return this.callAPI('financas/contareceber', 'LancarBaixaContaReceber', {
            codigo_lancamento_omie: codigoLancamento,
            data_baixa: dataBaixa,
            valor_baixa: valor
        });
    }

    // ========================================
    // BOLETOS E PIX
    // ========================================

    /**
     * Gerar boleto para conta a receber
     */
    async gerarBoleto(codigoLancamento) {
        return this.callAPI('financas/boleto', 'GerarBoleto', {
            codigo_lancamento_omie: codigoLancamento
        });
    }

    /**
     * Gerar QR Code PIX
     */
    async gerarPix(codigoLancamento) {
        return this.callAPI('financas/pix', 'GerarPix', {
            codigo_lancamento_omie: codigoLancamento
        });
    }

    // ========================================
    // PRODUTOS
    // ========================================

    /**
     * Listar produtos
     */
    async listarProdutos(pagina = 1, registrosPorPagina = 50) {
        return this.callAPI('geral/produtos', 'ListarProdutos', {
            pagina: pagina,
            registros_por_pagina: registrosPorPagina,
            apenas_importado_api: 'N'
        });
    }

    /**
     * Consultar produto
     */
    async consultarProduto(codigoProduto) {
        return this.callAPI('geral/produtos', 'ConsultarProduto', {
            codigo_produto: codigoProduto
        });
    }

    /**
     * Consultar estoque
     */
    async consultarEstoque(codigoProduto, codigoLocalEstoque = null) {
        const params = { codigo_produto: codigoProduto };
        if (codigoLocalEstoque) {
            params.codigo_local_estoque = codigoLocalEstoque;
        }
        return this.callAPI('estoque/consulta', 'ConsultarPosEstoque', params);
    }

    /**
     * Listar posição de estoque
     */
    async listarPosicaoEstoque(pagina = 1) {
        return this.callAPI('estoque/consulta', 'ListarPosEstoque', {
            nPagina: pagina,
            nRegPorPagina: 50
        });
    }

    // ========================================
    // PEDIDOS DE VENDA
    // ========================================

    /**
     * Listar pedidos de venda
     */
    async listarPedidosVenda(pagina = 1, registrosPorPagina = 50, filtros = {}) {
        return this.callAPI('produtos/pedido', 'ListarPedidos', {
            pagina: pagina,
            registros_por_pagina: registrosPorPagina,
            ...filtros
        });
    }

    /**
     * Consultar pedido de venda
     */
    async consultarPedidoVenda(codigoPedido) {
        return this.callAPI('produtos/pedido', 'ConsultarPedido', {
            codigo_pedido: codigoPedido
        });
    }

    /**
     * Incluir pedido de venda
     */
    async incluirPedidoVenda(pedido) {
        return this.callAPI('produtos/pedido', 'IncluirPedido', pedido);
    }

    // ========================================
    // NF-e
    // ========================================

    /**
     * Consultar NF-e
     */
    async consultarNFe(chaveNFe) {
        return this.callAPI('produtos/nfeconsultar', 'ConsultarNF', {
            cChaveNFe: chaveNFe
        });
    }

    /**
     * Obter PDF da DANFE
     */
    async obterPdfNFe(chaveNFe) {
        return this.callAPI('produtos/nfeutilidades', 'ObterDanfe', {
            cChaveNFe: chaveNFe
        });
    }

    /**
     * Obter XML da NF-e
     */
    async obterXmlNFe(chaveNFe) {
        return this.callAPI('produtos/nfeutilidades', 'ObterXML', {
            cChaveNFe: chaveNFe
        });
    }

    /**
     * Listar NF-e
     */
    async listarNFe(pagina = 1, filtros = {}) {
        return this.callAPI('produtos/nfeconsultar', 'ListarNF', {
            pagina: pagina,
            registros_por_pagina: 50,
            ...filtros
        });
    }

    // ========================================
    // ORDENS DE PRODUÇÍO (PCP)
    // ========================================

    /**
     * Listar ordens de produção
     */
    async listarOrdensProducao(pagina = 1) {
        return this.callAPI('produtos/op', 'ListarOP', {
            nPagina: pagina,
            nQtdeRegistros: 50
        });
    }

    /**
     * Consultar ordem de produção
     */
    async consultarOrdemProducao(codigoOP) {
        return this.callAPI('produtos/op', 'ConsultarOP', {
            nCodOP: codigoOP
        });
    }

    /**
     * Incluir ordem de produção
     */
    async incluirOrdemProducao(op) {
        return this.callAPI('produtos/op', 'IncluirOP', op);
    }

    /**
     * Alterar status da ordem de produção
     */
    async alterarStatusOP(codigoOP, status) {
        return this.callAPI('produtos/op', 'AlterarStatusOP', {
            nCodOP: codigoOP,
            cStatus: status
        });
    }

    // ========================================
    // CATEGORIAS
    // ========================================

    /**
     * Listar categorias
     */
    async listarCategorias() {
        return this.callAPI('geral/categorias', 'ListarCategorias', {
            pagina: 1,
            registros_por_pagina: 500
        });
    }

    // ========================================
    // CONTAS CORRENTES
    // ========================================

    /**
     * Listar contas correntes
     */
    async listarContasCorrentes() {
        return this.callAPI('geral/contacorrente', 'ListarContasCorrentes', {
            pagina: 1,
            registros_por_pagina: 50
        });
    }

    /**
     * Consultar extrato
     */
    async consultarExtrato(codigoContaCorrente, dataInicio, dataFim) {
        return this.callAPI('financas/extrato', 'ConsultarExtrato', {
            codigo_conta_corrente: codigoContaCorrente,
            data_inicio: dataInicio,
            data_fim: dataFim
        });
    }

    // ========================================
    // RESUMO FINANCEIRO
    // ========================================

    /**
     * Obter resumo financeiro
     */
    async obterResumoFinanceiro(dataInicio, dataFim) {
        return this.callAPI('financas/resumo', 'ObterResumo', {
            data_inicio: dataInicio,
            data_fim: dataFim
        });
    }

    // ========================================
    // UTILITÁRIOS
    // ========================================

    /**
     * Verificar se credenciais estão configuradas
     */
    isConfigured() {
        return this.appKey && this.appSecret;
    }

    /**
     * Testar conexão com a API
     */
    async testarConexao() {
        if (!this.isConfigured()) {
            throw new Error('Credenciais do Omie não configuradas');
        }
        
        try {
            await this.listarCategorias();
            return { success: true, message: 'Conexão com Omie OK' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

module.exports = new OmieService();
