/**
 * PIX GATEWAY SERVICE - ALUFORCE
 * Serviço para geração de cobranças PIX e recebimento automático
 * Suporta: Mercado Pago, PagSeguro, Gerencianet/EfiBank, PicPay
 */

const crypto = require('crypto');
const https = require('https');

class PixGatewayService {
    constructor(pool) {
        this.pool = pool;
        this.provedores = {
            mercadopago: {
                nome: 'Mercado Pago',
                baseUrl: 'https://api.mercadopago.com',
                tokenEnv: 'MERCADOPAGO_ACCESS_TOKEN'
            },
            pagseguro: {
                nome: 'PagSeguro',
                baseUrl: 'https://api.pagseguro.com',
                tokenEnv: 'PAGSEGURO_TOKEN'
            },
            gerencianet: {
                nome: 'Gerencianet/EfiBank',
                baseUrl: 'https://pix.api.efipay.com.br',
                tokenEnv: 'GERENCIANET_CLIENT_ID'
            },
            picpay: {
                nome: 'PicPay',
                baseUrl: 'https://appws.picpay.com',
                tokenEnv: 'PICPAY_TOKEN'
            }
        };
    }

    /**
     * Criar tabelas necessárias para gestão PIX
     */
    async criarTabelas() {
        const queries = [
            // Tabela de configuração dos provedores PIX
            `CREATE TABLE IF NOT EXISTS pix_config (
                id INT PRIMARY KEY AUTO_INCREMENT,
                provedor VARCHAR(50) NOT NULL,
                ativo BOOLEAN DEFAULT FALSE,
                access_token TEXT,
                client_id VARCHAR(255),
                client_secret TEXT,
                chave_pix VARCHAR(255),
                tipo_chave ENUM('cpf','cnpj','email','telefone','aleatorio') DEFAULT 'aleatorio',
                certificado_path VARCHAR(500),
                webhook_url VARCHAR(500),
                ambiente ENUM('sandbox','producao') DEFAULT 'sandbox',
                configuracoes JSON,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_provedor (provedor)
            )`,

            // Tabela de cobranças PIX
            `CREATE TABLE IF NOT EXISTS pix_cobrancas (
                id INT PRIMARY KEY AUTO_INCREMENT,
                txid VARCHAR(100) NOT NULL,
                provedor VARCHAR(50) NOT NULL,
                origem_tipo ENUM('nfe','conta_receber','pedido','avulso') DEFAULT 'avulso',
                origem_id INT,
                cliente_id INT,
                cliente_nome VARCHAR(200),
                cliente_cpf_cnpj VARCHAR(20),
                valor DECIMAL(15,2) NOT NULL,
                descricao VARCHAR(500),
                chave_pix VARCHAR(255),
                qrcode_base64 LONGTEXT,
                qrcode_texto TEXT,
                copia_cola TEXT,
                expiracao INT DEFAULT 3600,
                data_expiracao DATETIME,
                status ENUM('ativo','concluido','cancelado','expirado','erro') DEFAULT 'ativo',
                pago_em DATETIME,
                end_to_end_id VARCHAR(100),
                info_pagador JSON,
                resposta_api JSON,
                webhook_recebido BOOLEAN DEFAULT FALSE,
                webhook_data JSON,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_txid (txid),
                INDEX idx_status (status),
                INDEX idx_origem (origem_tipo, origem_id)
            )`,

            // Tabela de webhooks recebidos
            `CREATE TABLE IF NOT EXISTS pix_webhooks (
                id INT PRIMARY KEY AUTO_INCREMENT,
                provedor VARCHAR(50),
                txid VARCHAR(100),
                end_to_end_id VARCHAR(100),
                tipo_evento VARCHAR(50),
                payload JSON,
                processado BOOLEAN DEFAULT FALSE,
                erro_processamento TEXT,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabela de logs
            `CREATE TABLE IF NOT EXISTS pix_logs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                acao VARCHAR(100),
                provedor VARCHAR(50),
                txid VARCHAR(100),
                request JSON,
                response JSON,
                status_http INT,
                sucesso BOOLEAN,
                mensagem TEXT,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const query of queries) {
            await this.pool.query(query);
        }

        console.log('[PIX] Tabelas criadas/verificadas com sucesso');
    }

    /**
     * Gerar TXID único para cobrança
     */
    gerarTxId(provedor) {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(8).toString('hex');
        return `ALU${provedor.substring(0, 3).toUpperCase()}${timestamp}${random}`.substring(0, 35);
    }

    /**
     * Obter configuração do provedor ativo
     */
    async getProvedorAtivo() {
        const [config] = await this.pool.query(`
            SELECT * FROM pix_config WHERE ativo = TRUE LIMIT 1
        `);
        return config[0] || null;
    }

    /**
     * Salvar configuração de provedor
     */
    async salvarConfiguracao(dados) {
        const {
            provedor,
            ativo = false,
            access_token,
            client_id,
            client_secret,
            chave_pix,
            tipo_chave = 'aleatorio',
            certificado_path,
            webhook_url,
            ambiente = 'sandbox',
            configuracoes = {}
        } = dados;

        // Desativar outros se este estiver sendo ativado
        if (ativo) {
            await this.pool.query('UPDATE pix_config SET ativo = FALSE');
        }

        const [existing] = await this.pool.query(
            'SELECT id FROM pix_config WHERE provedor = ?',
            [provedor]
        );

        if (existing.length > 0) {
            await this.pool.query(`
                UPDATE pix_config SET
                    ativo = ?,
                    access_token = ?,
                    client_id = ?,
                    client_secret = ?,
                    chave_pix = ?,
                    tipo_chave = ?,
                    certificado_path = ?,
                    webhook_url = ?,
                    ambiente = ?,
                    configuracoes = ?
                WHERE provedor = ?
            `, [ativo, access_token, client_id, client_secret, chave_pix, tipo_chave,
                certificado_path, webhook_url, ambiente, JSON.stringify(configuracoes), provedor]);
        } else {
            await this.pool.query(`
                INSERT INTO pix_config (
                    provedor, ativo, access_token, client_id, client_secret,
                    chave_pix, tipo_chave, certificado_path, webhook_url, ambiente, configuracoes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [provedor, ativo, access_token, client_id, client_secret, chave_pix,
                tipo_chave, certificado_path, webhook_url, ambiente, JSON.stringify(configuracoes)]);
        }

        return { success: true, message: 'Configuração salva' };
    }

    /**
     * Criar cobrança PIX
     */
    async criarCobranca(dados) {
        const config = await this.getProvedorAtivo();
        if (!config) {
            throw new Error('Nenhum provedor PIX configurado');
        }

        const txid = this.gerarTxId(config.provedor);
        const dataExpiracao = new Date();
        dataExpiracao.setSeconds(dataExpiracao.getSeconds() + (dados.expiracao || 3600));

        // Criar cobrança conforme provedor
        let resultado;
        switch (config.provedor) {
            case 'mercadopago':
                resultado = await this.criarCobrancaMercadoPago(config, txid, dados);
                break;
            case 'pagseguro':
                resultado = await this.criarCobrancaPagSeguro(config, txid, dados);
                break;
            case 'gerencianet':
                resultado = await this.criarCobrancaGerencianet(config, txid, dados);
                break;
            case 'picpay':
                resultado = await this.criarCobrancaPicPay(config, txid, dados);
                break;
            default:
                // Modo simulação/desenvolvimento
                resultado = this.criarCobrancaSimulada(txid, dados, config);
        }

        // Salvar cobrança no banco
        await this.pool.query(`
            INSERT INTO pix_cobrancas (
                txid, provedor, origem_tipo, origem_id, cliente_id,
                cliente_nome, cliente_cpf_cnpj, valor, descricao, chave_pix,
                qrcode_base64, qrcode_texto, copia_cola, expiracao,
                data_expiracao, status, resposta_api
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?)
        `, [
            txid,
            config.provedor,
            dados.origem_tipo || 'avulso',
            dados.origem_id || null,
            dados.cliente_id || null,
            dados.cliente_nome || null,
            dados.cliente_cpf_cnpj || null,
            dados.valor,
            dados.descricao || null,
            config.chave_pix,
            resultado.qrcode_base64 || null,
            resultado.qrcode_texto || null,
            resultado.copia_cola || null,
            dados.expiracao || 3600,
            dataExpiracao,
            JSON.stringify(resultado.resposta_api || {})
        ]);

        // Log da operação
        await this.registrarLog('criar_cobranca', config.provedor, txid, dados, resultado, true);

        return {
            success: true,
            txid,
            qrcode: resultado.qrcode_base64,
            qrcode_texto: resultado.qrcode_texto,
            copia_cola: resultado.copia_cola,
            valor: dados.valor,
            expiracao: dados.expiracao || 3600,
            data_expiracao: dataExpiracao
        };
    }

    /**
     * Mercado Pago - Criar cobrança
     */
    async criarCobrancaMercadoPago(config, txid, dados) {
        const body = {
            transaction_amount: parseFloat(dados.valor),
            description: dados.descricao || 'Cobrança PIX ALUFORCE',
            payment_method_id: 'pix',
            payer: {
                email: dados.email || 'cliente@email.com',
                first_name: dados.cliente_nome?.split(' ')[0] || 'Cliente',
                last_name: dados.cliente_nome?.split(' ').slice(1).join(' ') || '',
                identification: {
                    type: dados.cliente_cpf_cnpj?.length > 11 ? 'CNPJ' : 'CPF',
                    number: dados.cliente_cpf_cnpj?.replace(/\D/g, '') || ''
                }
            },
            external_reference: txid
        };

        try {
            const response = await this.httpRequest({
                hostname: 'api.mercadopago.com',
                path: '/v1/payments',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.access_token}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': txid
                }
            }, body);

            return {
                qrcode_base64: response.point_of_interaction?.transaction_data?.qr_code_base64,
                qrcode_texto: response.point_of_interaction?.transaction_data?.qr_code,
                copia_cola: response.point_of_interaction?.transaction_data?.qr_code,
                resposta_api: response
            };
        } catch (error) {
            console.error('[PIX-MP] Erro:', error);
            throw new Error(`Mercado Pago: ${error.message}`);
        }
    }

    /**
     * PagSeguro - Criar cobrança
     */
    async criarCobrancaPagSeguro(config, txid, dados) {
        const body = {
            reference_id: txid,
            customer: {
                name: dados.cliente_nome || 'Cliente',
                email: dados.email || 'cliente@email.com',
                tax_id: dados.cliente_cpf_cnpj?.replace(/\D/g, '') || ''
            },
            qr_codes: [{
                amount: {
                    value: Math.round(dados.valor * 100) // Em centavos
                },
                expiration_date: new Date(Date.now() + (dados.expiracao || 3600) * 1000).toISOString()
            }]
        };

        try {
            const response = await this.httpRequest({
                hostname: config.ambiente === 'producao' ? 'api.pagseguro.com' : 'sandbox.api.pagseguro.com',
                path: '/orders',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.access_token}`,
                    'Content-Type': 'application/json'
                }
            }, body);

            const qrCode = response.qr_codes?.[0];
            return {
                qrcode_base64: qrCode?.links?.find(l => l.rel === 'QRCODE.PNG')?.href,
                qrcode_texto: qrCode?.text,
                copia_cola: qrCode?.text,
                resposta_api: response
            };
        } catch (error) {
            console.error('[PIX-PS] Erro:', error);
            throw new Error(`PagSeguro: ${error.message}`);
        }
    }

    /**
     * Gerencianet/EfiBank - Criar cobrança
     */
    async criarCobrancaGerencianet(config, txid, dados) {
        // Primeiro obter access_token via OAuth
        const accessToken = await this.getGerencianetToken(config);

        const body = {
            calendario: {
                expiracao: dados.expiracao || 3600
            },
            devedor: {
                cpf: dados.cliente_cpf_cnpj?.length === 11 ? dados.cliente_cpf_cnpj : undefined,
                cnpj: dados.cliente_cpf_cnpj?.length === 14 ? dados.cliente_cpf_cnpj : undefined,
                nome: dados.cliente_nome || 'Cliente'
            },
            valor: {
                original: dados.valor.toFixed(2)
            },
            chave: config.chave_pix,
            solicitacaoPagador: dados.descricao || 'Cobrança ALUFORCE'
        };

        try {
            const hostname = config.ambiente === 'producao' 
                ? 'pix.api.efipay.com.br' 
                : 'pix-h.api.efipay.com.br';

            const response = await this.httpRequest({
                hostname,
                path: `/v2/cob/${txid}`,
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }, body);

            // Obter QR Code
            const qrResponse = await this.httpRequest({
                hostname,
                path: `/v2/loc/${response.loc?.id}/qrcode`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            return {
                qrcode_base64: qrResponse.imagemQrcode?.replace('data:image/png;base64,', ''),
                qrcode_texto: qrResponse.qrcode,
                copia_cola: response.pixCopiaECola,
                resposta_api: { ...response, qr: qrResponse }
            };
        } catch (error) {
            console.error('[PIX-GN] Erro:', error);
            throw new Error(`Gerencianet: ${error.message}`);
        }
    }

    /**
     * Obter token OAuth Gerencianet
     */
    async getGerencianetToken(config) {
        const auth = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');
        
        const response = await this.httpRequest({
            hostname: config.ambiente === 'producao' 
                ? 'pix.api.efipay.com.br' 
                : 'pix-h.api.efipay.com.br',
            path: '/oauth/token',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        }, { grant_type: 'client_credentials' });

        return response.access_token;
    }

    /**
     * PicPay - Criar cobrança
     */
    async criarCobrancaPicPay(config, txid, dados) {
        const body = {
            referenceId: txid,
            callbackUrl: config.webhook_url,
            returnUrl: dados.return_url || null,
            value: parseFloat(dados.valor),
            expiresAt: new Date(Date.now() + (dados.expiracao || 3600) * 1000).toISOString(),
            buyer: {
                firstName: dados.cliente_nome?.split(' ')[0] || 'Cliente',
                lastName: dados.cliente_nome?.split(' ').slice(1).join(' ') || '',
                document: dados.cliente_cpf_cnpj?.replace(/\D/g, '') || ''
            }
        };

        try {
            const response = await this.httpRequest({
                hostname: 'appws.picpay.com',
                path: '/ecommerce/public/payments',
                method: 'POST',
                headers: {
                    'x-picpay-token': config.access_token,
                    'Content-Type': 'application/json'
                }
            }, body);

            // PicPay retorna URL do QR code
            return {
                qrcode_base64: null,
                qrcode_texto: response.qrcode?.content,
                copia_cola: response.qrcode?.content,
                resposta_api: response
            };
        } catch (error) {
            console.error('[PIX-PP] Erro:', error);
            throw new Error(`PicPay: ${error.message}`);
        }
    }

    /**
     * Modo simulação - Para desenvolvimento
     */
    criarCobrancaSimulada(txid, dados, config) {
        // Gerar payload PIX EMV simulado
        const payload = this.gerarPayloadPixEMV({
            chave: config.chave_pix || '12345678901',
            valor: dados.valor,
            cidade: 'SAO PAULO',
            nome: 'ALUFORCE LTDA',
            txid: txid
        });

        return {
            qrcode_base64: this.gerarQRCodeBase64Simples(payload),
            qrcode_texto: payload,
            copia_cola: payload,
            resposta_api: { modo: 'simulacao' }
        };
    }

    /**
     * Gerar payload PIX EMV (simplificado)
     */
    gerarPayloadPixEMV({ chave, valor, cidade, nome, txid }) {
        // Payload Format Indicator
        let payload = '000201';
        // Point of Initiation
        payload += '010212';
        // Merchant Account Information (PIX)
        let mai = '0014BR.GOV.BCB.PIX';
        mai += this.emvField('01', chave);
        payload += this.emvField('26', mai);
        // Merchant Category Code
        payload += '52040000';
        // Transaction Currency (986 = BRL)
        payload += '5303986';
        // Transaction Amount
        if (valor) {
            payload += this.emvField('54', valor.toFixed(2));
        }
        // Country Code
        payload += '5802BR';
        // Merchant Name
        payload += this.emvField('59', nome.substring(0, 25));
        // Merchant City
        payload += this.emvField('60', cidade.substring(0, 15));
        // Additional Data Field (TXID)
        if (txid) {
            payload += this.emvField('62', this.emvField('05', txid.substring(0, 25)));
        }
        // CRC placeholder
        payload += '6304';
        // Calcular CRC16
        const crc = this.crc16(payload);
        payload += crc;

        return payload;
    }

    emvField(id, value) {
        const len = value.length.toString().padStart(2, '0');
        return id + len + value;
    }

    crc16(str) {
        let crc = 0xFFFF;
        for (let i = 0; i < str.length; i++) {
            crc ^= str.charCodeAt(i) << 8;
            for (let j = 0; j < 8; j++) {
                if (crc & 0x8000) {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc <<= 1;
                }
            }
        }
        return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    }

    gerarQRCodeBase64Simples(data) {
        // Retorna um placeholder - em produção usar biblioteca qrcode
        return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    }

    /**
     * Consultar status de cobrança
     */
    async consultarCobranca(txid) {
        const [cobranca] = await this.pool.query(`
            SELECT * FROM pix_cobrancas WHERE txid = ?
        `, [txid]);

        if (!cobranca.length) {
            throw new Error('Cobrança não encontrada');
        }

        const cob = cobranca[0];

        // Verificar expiração
        if (cob.status === 'ativo' && new Date(cob.data_expiracao) < new Date()) {
            await this.pool.query(`
                UPDATE pix_cobrancas SET status = 'expirado' WHERE id = ?
            `, [cob.id]);
            cob.status = 'expirado';
        }

        return cob;
    }

    /**
     * Processar webhook de pagamento
     */
    async processarWebhook(provedor, payload) {
        let txid, endToEndId, valorPago;

        // Extrair dados conforme provedor
        switch (provedor) {
            case 'mercadopago':
                txid = payload.data?.external_reference;
                endToEndId = payload.data?.id?.toString();
                valorPago = payload.data?.transaction_amount;
                break;
            case 'pagseguro':
                txid = payload.reference_id;
                endToEndId = payload.id;
                valorPago = payload.charges?.[0]?.amount?.summary?.total / 100;
                break;
            case 'gerencianet':
                const pix = payload.pix?.[0];
                txid = pix?.txid;
                endToEndId = pix?.endToEndId;
                valorPago = parseFloat(pix?.valor);
                break;
            case 'picpay':
                txid = payload.referenceId;
                endToEndId = payload.authorizationId;
                valorPago = payload.value;
                break;
            default:
                txid = payload.txid;
                endToEndId = payload.endToEndId;
                valorPago = payload.valor;
        }

        // Registrar webhook
        await this.pool.query(`
            INSERT INTO pix_webhooks (provedor, txid, end_to_end_id, tipo_evento, payload)
            VALUES (?, ?, ?, 'pagamento', ?)
        `, [provedor, txid, endToEndId, JSON.stringify(payload)]);

        if (!txid) {
            console.warn('[PIX] Webhook sem TXID');
            return { success: false, message: 'TXID não encontrado' };
        }

        // Atualizar cobrança
        const [result] = await this.pool.query(`
            UPDATE pix_cobrancas SET
                status = 'concluido',
                pago_em = NOW(),
                end_to_end_id = ?,
                webhook_recebido = TRUE,
                webhook_data = ?
            WHERE txid = ? AND status = 'ativo'
        `, [endToEndId, JSON.stringify(payload), txid]);

        if (result.affectedRows > 0) {
            // Buscar cobrança para integração
            const [cobranca] = await this.pool.query(`
                SELECT * FROM pix_cobrancas WHERE txid = ?
            `, [txid]);

            if (cobranca.length > 0) {
                await this.integrarPagamento(cobranca[0]);
            }

            await this.pool.query(`
                UPDATE pix_webhooks SET processado = TRUE WHERE txid = ? ORDER BY id DESC LIMIT 1
            `, [txid]);

            return { success: true, message: 'Pagamento processado' };
        }

        return { success: false, message: 'Cobrança não encontrada ou já processada' };
    }

    /**
     * Integrar pagamento com Financeiro
     */
    async integrarPagamento(cobranca) {
        try {
            if (cobranca.origem_tipo === 'conta_receber' && cobranca.origem_id) {
                // Baixar conta a receber
                await this.pool.query(`
                    UPDATE contas_receber SET
                        status = 'pago',
                        data_pagamento = NOW(),
                        valor_pago = valor,
                        forma_pagamento = 'PIX'
                    WHERE id = ?
                `, [cobranca.origem_id]);

                console.log(`[PIX] Conta ${cobranca.origem_id} baixada automaticamente`);
            } else if (cobranca.origem_tipo === 'nfe' && cobranca.origem_id) {
                // Atualizar parcelas da NF-e
                await this.pool.query(`
                    UPDATE nfe_parcelas SET
                        status = 'pago',
                        data_pagamento = NOW(),
                        valor_pago = valor
                    WHERE nfe_id = ? AND status = 'pendente'
                    ORDER BY numero_parcela LIMIT 1
                `, [cobranca.origem_id]);

                console.log(`[PIX] Parcela NF-e ${cobranca.origem_id} baixada automaticamente`);
            }
        } catch (error) {
            console.error('[PIX] Erro ao integrar pagamento:', error);
        }
    }

    /**
     * Cancelar cobrança
     */
    async cancelarCobranca(txid) {
        const [result] = await this.pool.query(`
            UPDATE pix_cobrancas SET status = 'cancelado' WHERE txid = ? AND status = 'ativo'
        `, [txid]);

        return { success: result.affectedRows > 0 };
    }

    /**
     * Listar cobranças
     */
    async listarCobrancas(filtros = {}) {
        let where = '1=1';
        const params = [];

        if (filtros.status) {
            where += ' AND status = ?';
            params.push(filtros.status);
        }
        if (filtros.data_inicio) {
            where += ' AND criado_em >= ?';
            params.push(filtros.data_inicio);
        }
        if (filtros.data_fim) {
            where += ' AND criado_em <= ?';
            params.push(filtros.data_fim + ' 23:59:59');
        }
        if (filtros.cliente_id) {
            where += ' AND cliente_id = ?';
            params.push(filtros.cliente_id);
        }

        const [cobrancas] = await this.pool.query(`
            SELECT * FROM pix_cobrancas
            WHERE ${where}
            ORDER BY criado_em DESC
            LIMIT ${filtros.limite || 100}
        `, params);

        return cobrancas;
    }

    /**
     * Dashboard PIX
     */
    async getDashboard(periodo = 30) {
        const dataInicio = new Date();
        dataInicio.setDate(dataInicio.getDate() - periodo);

        const [stats] = await this.pool.query(`
            SELECT
                COUNT(*) as total_cobrancas,
                SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) as pagos,
                SUM(CASE WHEN status = 'ativo' THEN 1 ELSE 0 END) as pendentes,
                SUM(CASE WHEN status = 'expirado' THEN 1 ELSE 0 END) as expirados,
                SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) as cancelados,
                SUM(CASE WHEN status = 'concluido' THEN valor ELSE 0 END) as valor_recebido,
                SUM(CASE WHEN status = 'ativo' THEN valor ELSE 0 END) as valor_pendente
            FROM pix_cobrancas
            WHERE criado_em >= ?
        `, [dataInicio]);

        const [ultimos] = await this.pool.query(`
            SELECT * FROM pix_cobrancas
            WHERE status = 'concluido'
            ORDER BY pago_em DESC
            LIMIT 10
        `);

        const [porDia] = await this.pool.query(`
            SELECT 
                DATE(pago_em) as data,
                COUNT(*) as quantidade,
                SUM(valor) as total
            FROM pix_cobrancas
            WHERE status = 'concluido' AND pago_em >= ?
            GROUP BY DATE(pago_em)
            ORDER BY data
        `, [dataInicio]);

        return {
            stats: stats[0],
            ultimos_pagamentos: ultimos,
            por_dia: porDia
        };
    }

    /**
     * Helper: HTTP Request
     */
    httpRequest(options, body = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(json);
                        } else {
                            reject(new Error(json.message || JSON.stringify(json)));
                        }
                    } catch (e) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', reject);

            if (body) {
                req.write(JSON.stringify(body));
            }

            req.end();
        });
    }

    /**
     * Registrar log
     */
    async registrarLog(acao, provedor, txid, request, response, sucesso, mensagem = '') {
        try {
            await this.pool.query(`
                INSERT INTO pix_logs (acao, provedor, txid, request, response, sucesso, mensagem)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [acao, provedor, txid, JSON.stringify(request), JSON.stringify(response), sucesso, mensagem]);
        } catch (e) {
            console.error('[PIX] Erro ao registrar log:', e);
        }
    }
}

module.exports = PixGatewayService;
