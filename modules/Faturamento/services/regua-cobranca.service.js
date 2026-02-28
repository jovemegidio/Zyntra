/**
 * RÉGUA DE COBRANÇA AUTOMATIZADA - ALUFORCE
 * Sistema de cobrança automática para contas a receber
 * Envia lembretes antes, no dia e após vencimento
 */

const nodemailer = require('nodemailer');

class ReguaCobrancaService {
    constructor(pool) {
        this.pool = pool;
        this.transporterEmail = null;
        this.intervaloExecucao = null;
    }

    /**
     * Criar tabelas necessárias
     */
    async criarTabelas() {
        const queries = [
            // Configuração da régua
            `CREATE TABLE IF NOT EXISTS regua_cobranca_config (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ativo BOOLEAN DEFAULT FALSE,
                horario_execucao TIME DEFAULT '08:00:00',
                
                -- Email SMTP
                smtp_host VARCHAR(255),
                smtp_port INT DEFAULT 587,
                smtp_user VARCHAR(255),
                smtp_pass TEXT,
                smtp_secure BOOLEAN DEFAULT FALSE,
                email_remetente VARCHAR(255),
                nome_remetente VARCHAR(255) DEFAULT 'ALUFORCE Financeiro',
                
                -- WhatsApp (opcional)
                whatsapp_ativo BOOLEAN DEFAULT FALSE,
                whatsapp_api_url VARCHAR(500),
                whatsapp_api_token TEXT,
                whatsapp_numero_origem VARCHAR(20),
                
                -- Geral
                gerar_pix_automatico BOOLEAN DEFAULT TRUE,
                dias_antes_vencimento VARCHAR(100) DEFAULT '[7, 3, 1]',
                dias_apos_vencimento VARCHAR(100) DEFAULT '[1, 3, 7, 15, 30]',
                
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`,

            // Templates de mensagens
            `CREATE TABLE IF NOT EXISTS regua_cobranca_templates (
                id INT PRIMARY KEY AUTO_INCREMENT,
                tipo ENUM('antes', 'dia', 'apos') NOT NULL,
                dias INT NOT NULL,
                canal ENUM('email', 'whatsapp', 'sms') DEFAULT 'email',
                assunto VARCHAR(255),
                corpo TEXT,
                corpo_html TEXT,
                ativo BOOLEAN DEFAULT TRUE,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_tipo_dias_canal (tipo, dias, canal)
            )`,

            // Histórico de cobranças enviadas
            `CREATE TABLE IF NOT EXISTS regua_cobranca_historico (
                id INT PRIMARY KEY AUTO_INCREMENT,
                conta_id INT NOT NULL,
                cliente_id INT,
                tipo ENUM('antes', 'dia', 'apos') NOT NULL,
                dias INT NOT NULL,
                canal ENUM('email', 'whatsapp', 'sms') DEFAULT 'email',
                destinatario VARCHAR(255),
                assunto VARCHAR(255),
                mensagem TEXT,
                status ENUM('enviado', 'falha', 'lido', 'respondido') DEFAULT 'enviado',
                erro_msg TEXT,
                pix_gerado BOOLEAN DEFAULT FALSE,
                pix_txid VARCHAR(100),
                enviado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                lido_em DATETIME,
                INDEX idx_conta (conta_id),
                INDEX idx_enviado (enviado_em),
                INDEX idx_status (status)
            )`,

            // Fila de envios pendentes
            `CREATE TABLE IF NOT EXISTS regua_cobranca_fila (
                id INT PRIMARY KEY AUTO_INCREMENT,
                conta_id INT NOT NULL,
                cliente_id INT,
                tipo ENUM('antes', 'dia', 'apos') NOT NULL,
                dias INT NOT NULL,
                canal ENUM('email', 'whatsapp', 'sms') DEFAULT 'email',
                destinatario VARCHAR(255),
                assunto VARCHAR(255),
                mensagem TEXT,
                mensagem_html TEXT,
                prioridade INT DEFAULT 5,
                agendado_para DATETIME,
                tentativas INT DEFAULT 0,
                max_tentativas INT DEFAULT 3,
                status ENUM('pendente', 'processando', 'enviado', 'falha', 'cancelado') DEFAULT 'pendente',
                erro_msg TEXT,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                processado_em DATETIME,
                INDEX idx_status (status),
                INDEX idx_agendado (agendado_para)
            )`,

            // Inserir templates padrão
            `INSERT IGNORE INTO regua_cobranca_templates (tipo, dias, canal, assunto, corpo, corpo_html, ativo) VALUES
                ('antes', 7, 'email', 'Lembrete: Fatura vence em 7 dias', 
                    'Olá {{cliente_nome}},\\Lembramos que sua fatura no valor de {{valor}} vence em {{data_vencimento}}.\\Para sua comodidade, segue o código PIX para pagamento:\{{pix_codigo}}\\Atenciosamente,\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Lembramos que sua fatura no valor de <strong>{{valor}}</strong> vence em <strong>{{data_vencimento}}</strong>.</p><p>Para sua comodidade, segue o código PIX para pagamento:</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>Atenciosamente,<br>ALUFORCE</p>', 1),
                ('antes', 3, 'email', 'Lembrete: Fatura vence em 3 dias',
                    'Olá {{cliente_nome}},\\Sua fatura de {{valor}} vence em {{data_vencimento}}.\\Pague via PIX: {{pix_codigo}}\\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Sua fatura de <strong>{{valor}}</strong> vence em <strong>{{data_vencimento}}</strong>.</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>ALUFORCE</p>', 1),
                ('antes', 1, 'email', 'AMANHÍ: Vencimento da sua fatura',
                    'Olá {{cliente_nome}},\\Sua fatura de {{valor}} vence AMANHÍ ({{data_vencimento}}).\\Pague agora via PIX:\{{pix_codigo}}\\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Sua fatura de <strong>{{valor}}</strong> vence <strong>AMANHÍ</strong> ({{data_vencimento}}).</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>ALUFORCE</p>', 1),
                ('dia', 0, 'email', 'HOJE: Vencimento da sua fatura',
                    'Olá {{cliente_nome}},\\Sua fatura de {{valor}} vence HOJE.\\Evite juros e multas, pague agora:\{{pix_codigo}}\\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Sua fatura de <strong>{{valor}}</strong> vence <strong style="color:red;">HOJE</strong>.</p><p>Evite juros e multas, pague agora:</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>ALUFORCE</p>', 1),
                ('apos', 1, 'email', 'Fatura vencida há 1 dia',
                    'Olá {{cliente_nome}},\\Sua fatura de {{valor}} venceu ontem ({{data_vencimento}}).\\Regularize sua situação:\{{pix_codigo}}\\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Sua fatura de <strong>{{valor}}</strong> venceu <strong style="color:red;">ontem</strong>.</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>ALUFORCE</p>', 1),
                ('apos', 7, 'email', '⚠️ Fatura vencida há 7 dias',
                    'Olá {{cliente_nome}},\\Sua fatura de {{valor}} está vencida há 7 dias.\\Evite negativação, regularize agora:\{{pix_codigo}}\\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Sua fatura de <strong>{{valor}}</strong> está <strong style="color:red;">vencida há 7 dias</strong>.</p><p>Evite negativação, regularize agora:</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>ALUFORCE</p>', 1),
                ('apos', 15, 'email', '🔴 URGENTE: Fatura vencida há 15 dias',
                    'Olá {{cliente_nome}},\\Sua fatura de {{valor}} está vencida há 15 dias.\\Último aviso antes de procedimentos de cobrança:\{{pix_codigo}}\\ALUFORCE',
                    '<p>Olá <strong>{{cliente_nome}}</strong>,</p><p style="color:red;font-weight:bold;">URGENTE: Sua fatura está vencida há 15 dias.</p><p>Valor: <strong>{{valor}}</strong></p><p>Último aviso antes de procedimentos de cobrança:</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>ALUFORCE</p>', 1),
                ('apos', 30, 'email', '🚨 ÚLTIMA NOTIFICAÇÍO: 30 dias de atraso',
                    'Prezado {{cliente_nome}},\\Sua fatura de {{valor}} está vencida há 30 dias.\\Esta é sua última notificação amigável.\\Pague agora para evitar medidas legais:\{{pix_codigo}}\\Departamento Financeiro\ALUFORCE',
                    '<p>Prezado <strong>{{cliente_nome}}</strong>,</p><p style="color:red;font-size:18px;font-weight:bold;">⚠️ ÚLTIMA NOTIFICAÇÍO</p><p>Sua fatura de <strong>{{valor}}</strong> está vencida há <strong>30 dias</strong>.</p><p>Esta é sua última notificação amigável antes de medidas legais.</p><pre style="background:#f5f5f5;padding:10px;border-radius:5px;">{{pix_codigo}}</pre><p>Departamento Financeiro<br>ALUFORCE</p>', 1)
            `
        ];

        for (const query of queries) {
            try {
                await this.pool.query(query);
            } catch (e) {
                if (!e.message.includes('Duplicate')) {
                    console.error('[RÉGUA] Erro na query:', e.message);
                }
            }
        }

        console.log('[RÉGUA] Tabelas criadas/verificadas com sucesso');
    }

    /**
     * Obter configuração
     */
    async getConfig() {
        const [config] = await this.pool.query('SELECT * FROM regua_cobranca_config LIMIT 1');
        return config[0] || {};
    }

    /**
     * Salvar configuração
     */
    async salvarConfig(dados) {
        const [existing] = await this.pool.query('SELECT id FROM regua_cobranca_config LIMIT 1');

        const campos = [
            'ativo', 'horario_execucao', 'smtp_host', 'smtp_port', 'smtp_user', 
            'smtp_pass', 'smtp_secure', 'email_remetente', 'nome_remetente',
            'whatsapp_ativo', 'whatsapp_api_url', 'whatsapp_api_token', 'whatsapp_numero_origem',
            'gerar_pix_automatico', 'dias_antes_vencimento', 'dias_apos_vencimento'
        ];

        if (existing.length > 0) {
            const sets = campos.map(c => `${c} = ?`).join(', ');
            const values = campos.map(c => {
                if (c.includes('dias_')) return JSON.stringify(dados[c] || []);
                return dados[c];
            });
            values.push(existing[0].id);
            
            await this.pool.query(`UPDATE regua_cobranca_config SET ${sets} WHERE id = ?`, values);
        } else {
            const values = campos.map(c => {
                if (c.includes('dias_')) return JSON.stringify(dados[c] || []);
                return dados[c];
            });
            
            await this.pool.query(`INSERT INTO regua_cobranca_config (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`, values);
        }

        // Reconfigurar transporter se mudou SMTP
        if (dados.smtp_host) {
            await this.configurarEmailTransporter();
        }

        return { success: true };
    }

    /**
     * Configurar transporter de e-mail
     */
    async configurarEmailTransporter() {
        const config = await this.getConfig();
        
        if (!config.smtp_host) {
            console.log('[RÉGUA] SMTP não configurado');
            return;
        }

        try {
            this.transporterEmail = nodemailer.createTransport({
                host: config.smtp_host,
                port: config.smtp_port || 587,
                secure: config.smtp_secure || false,
                auth: {
                    user: config.smtp_user,
                    pass: config.smtp_pass
                }
            });

            await this.transporterEmail.verify();
            console.log('[RÉGUA] E-mail transporter configurado com sucesso');
        } catch (error) {
            console.error('[RÉGUA] Erro ao configurar e-mail:', error.message);
            this.transporterEmail = null;
        }
    }

    /**
     * Listar templates
     */
    async listarTemplates() {
        const [templates] = await this.pool.query(`
            SELECT * FROM regua_cobranca_templates ORDER BY tipo, dias
        `);
        return templates;
    }

    /**
     * Salvar template
     */
    async salvarTemplate(dados) {
        const { id, tipo, dias, canal, assunto, corpo, corpo_html, ativo } = dados;

        if (id) {
            await this.pool.query(`
                UPDATE regua_cobranca_templates SET
                    tipo = ?, dias = ?, canal = ?, assunto = ?, corpo = ?, corpo_html = ?, ativo = ?
                WHERE id = ?
            `, [tipo, dias, canal, assunto, corpo, corpo_html, ativo, id]);
        } else {
            await this.pool.query(`
                INSERT INTO regua_cobranca_templates (tipo, dias, canal, assunto, corpo, corpo_html, ativo)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE assunto = VALUES(assunto), corpo = VALUES(corpo), corpo_html = VALUES(corpo_html), ativo = VALUES(ativo)
            `, [tipo, dias, canal, assunto, corpo, corpo_html, ativo ?? true]);
        }

        return { success: true };
    }

    /**
     * Executar régua de cobrança
     * Esta é a função principal que processa todas as contas
     */
    async executarRegua() {
        const config = await this.getConfig();
        
        if (!config.ativo) {
            console.log('[RÉGUA] Serviço desativado');
            return { executado: false, motivo: 'Serviço desativado' };
        }

        console.log('[RÉGUA] Iniciando execução...');
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const diasAntes = JSON.parse(config.dias_antes_vencimento || '[7,3,1]');
        const diasApos = JSON.parse(config.dias_apos_vencimento || '[1,3,7,15,30]');

        const resultado = {
            antes: 0,
            dia: 0,
            apos: 0,
            erros: 0
        };

        // Buscar contas a vencer (antes)
        for (const dias of diasAntes) {
            const dataAlvo = new Date(hoje);
            dataAlvo.setDate(dataAlvo.getDate() + dias);
            const dataStr = dataAlvo.toISOString().split('T')[0];

            const [contas] = await this.pool.query(`
                SELECT cr.*, c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE DATE(cr.data_vencimento) = ?
                AND cr.status IN ('pendente', 'aberto')
                AND cr.id NOT IN (
                    SELECT conta_id FROM regua_cobranca_historico 
                    WHERE tipo = 'antes' AND dias = ? 
                    AND DATE(enviado_em) = CURDATE()
                )
            `, [dataStr, dias]);

            for (const conta of contas) {
                try {
                    await this.enviarCobranca(conta, 'antes', dias, config);
                    resultado.antes++;
                } catch (e) {
                    console.error(`[RÉGUA] Erro conta ${conta.id}:`, e.message);
                    resultado.erros++;
                }
            }
        }

        // Contas vencendo hoje
        const hojeStr = hoje.toISOString().split('T')[0];
        const [contasHoje] = await this.pool.query(`
            SELECT cr.*, c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE DATE(cr.data_vencimento) = ?
            AND cr.status IN ('pendente', 'aberto')
            AND cr.id NOT IN (
                SELECT conta_id FROM regua_cobranca_historico 
                WHERE tipo = 'dia' AND dias = 0
                AND DATE(enviado_em) = CURDATE()
            )
        `, [hojeStr]);

        for (const conta of contasHoje) {
            try {
                await this.enviarCobranca(conta, 'dia', 0, config);
                resultado.dia++;
            } catch (e) {
                resultado.erros++;
            }
        }

        // Contas vencidas (após)
        for (const dias of diasApos) {
            const dataAlvo = new Date(hoje);
            dataAlvo.setDate(dataAlvo.getDate() - dias);
            const dataStr = dataAlvo.toISOString().split('T')[0];

            const [contas] = await this.pool.query(`
                SELECT cr.*, c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE DATE(cr.data_vencimento) = ?
                AND cr.status IN ('pendente', 'aberto', 'vencido')
                AND cr.id NOT IN (
                    SELECT conta_id FROM regua_cobranca_historico 
                    WHERE tipo = 'apos' AND dias = ?
                    AND DATE(enviado_em) = CURDATE()
                )
            `, [dataStr, dias]);

            for (const conta of contas) {
                try {
                    await this.enviarCobranca(conta, 'apos', dias, config);
                    resultado.apos++;
                } catch (e) {
                    resultado.erros++;
                }
            }
        }

        console.log('[RÉGUA] Execução concluída:', resultado);
        return { executado: true, resultado };
    }

    /**
     * Enviar cobrança individual
     */
    async enviarCobranca(conta, tipo, dias, config) {
        // Buscar template
        const [templates] = await this.pool.query(`
            SELECT * FROM regua_cobranca_templates 
            WHERE tipo = ? AND dias = ? AND canal = 'email' AND ativo = TRUE
            LIMIT 1
        `, [tipo, dias]);

        if (!templates.length) {
            console.log(`[RÉGUA] Template não encontrado: ${tipo} ${dias} dias`);
            return;
        }

        const template = templates[0];
        const email = conta.cliente_email;

        if (!email) {
            console.log(`[RÉGUA] Conta ${conta.id} sem e-mail`);
            return;
        }

        // Gerar PIX se configurado
        let pixCodigo = '';
        let pixTxid = '';
        if (config.gerar_pix_automatico) {
            try {
                const PixGatewayService = require('./pix-gateway.service');
                const pixService = new PixGatewayService(this.pool);
                
                const pixResult = await pixService.criarCobranca({
                    origem_tipo: 'conta_receber',
                    origem_id: conta.id,
                    cliente_id: conta.cliente_id,
                    cliente_nome: conta.cliente_nome,
                    valor: parseFloat(conta.valor),
                    descricao: conta.descricao || `Cobrança ${conta.id}`,
                    expiracao: 86400 * 2 // 2 dias
                });

                pixCodigo = pixResult.copia_cola || '';
                pixTxid = pixResult.txid;
            } catch (e) {
                console.log('[RÉGUA] Erro ao gerar PIX:', e.message);
            }
        }

        // Substituir variáveis no template
        const dataVenc = new Date(conta.data_vencimento).toLocaleDateString('pt-BR');
        const valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(conta.valor);

        const variaveis = {
            '{{cliente_nome}}': conta.cliente_nome || 'Cliente',
            '{{valor}}': valor,
            '{{data_vencimento}}': dataVenc,
            '{{descricao}}': conta.descricao || '',
            '{{pix_codigo}}': pixCodigo || '[PIX não disponível]',
            '{{numero_conta}}': conta.id.toString()
        };

        let assunto = template.assunto;
        let corpo = template.corpo;
        let corpoHtml = template.corpo_html;

        for (const [chave, valor] of Object.entries(variaveis)) {
            assunto = assunto.replace(new RegExp(chave, 'g'), valor);
            corpo = corpo.replace(new RegExp(chave, 'g'), valor);
            if (corpoHtml) {
                corpoHtml = corpoHtml.replace(new RegExp(chave, 'g'), valor);
            }
        }

        // Enviar e-mail
        let status = 'enviado';
        let erroMsg = null;

        if (this.transporterEmail) {
            try {
                await this.transporterEmail.sendMail({
                    from: `"${config.nome_remetente || 'ALUFORCE'}" <${config.email_remetente}>`,
                    to: email,
                    subject: assunto,
                    text: corpo,
                    html: corpoHtml
                });
            } catch (e) {
                status = 'falha';
                erroMsg = e.message;
            }
        } else {
            console.log('[RÉGUA] E-mail simulado para:', email, assunto);
        }

        // Registrar no histórico
        await this.pool.query(`
            INSERT INTO regua_cobranca_historico 
            (conta_id, cliente_id, tipo, dias, canal, destinatario, assunto, mensagem, status, erro_msg, pix_gerado, pix_txid)
            VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?)
        `, [conta.id, conta.cliente_id, tipo, dias, email, assunto, corpo, status, erroMsg, !!pixTxid, pixTxid]);

        return { status, pixTxid };
    }

    /**
     * Obter histórico de cobranças
     */
    async getHistorico(filtros = {}) {
        let where = '1=1';
        const params = [];

        if (filtros.conta_id) {
            where += ' AND h.conta_id = ?';
            params.push(filtros.conta_id);
        }
        if (filtros.cliente_id) {
            where += ' AND h.cliente_id = ?';
            params.push(filtros.cliente_id);
        }
        if (filtros.tipo) {
            where += ' AND h.tipo = ?';
            params.push(filtros.tipo);
        }
        if (filtros.status) {
            where += ' AND h.status = ?';
            params.push(filtros.status);
        }
        if (filtros.data_inicio) {
            where += ' AND DATE(h.enviado_em) >= ?';
            params.push(filtros.data_inicio);
        }
        if (filtros.data_fim) {
            where += ' AND DATE(h.enviado_em) <= ?';
            params.push(filtros.data_fim);
        }

        const [historico] = await this.pool.query(`
            SELECT h.*, c.nome as cliente_nome
            FROM regua_cobranca_historico h
            LEFT JOIN clientes c ON h.cliente_id = c.id
            WHERE ${where}
            ORDER BY h.enviado_em DESC
            LIMIT ${filtros.limite || 100}
        `, params);

        return historico;
    }

    /**
     * Dashboard da régua
     */
    async getDashboard(periodo = 30) {
        const dataInicio = new Date();
        dataInicio.setDate(dataInicio.getDate() - periodo);

        const [stats] = await this.pool.query(`
            SELECT
                COUNT(*) as total_envios,
                SUM(CASE WHEN status = 'enviado' THEN 1 ELSE 0 END) as enviados,
                SUM(CASE WHEN status = 'falha' THEN 1 ELSE 0 END) as falhas,
                SUM(CASE WHEN pix_gerado = TRUE THEN 1 ELSE 0 END) as pix_gerados,
                SUM(CASE WHEN tipo = 'antes' THEN 1 ELSE 0 END) as tipo_antes,
                SUM(CASE WHEN tipo = 'dia' THEN 1 ELSE 0 END) as tipo_dia,
                SUM(CASE WHEN tipo = 'apos' THEN 1 ELSE 0 END) as tipo_apos
            FROM regua_cobranca_historico
            WHERE enviado_em >= ?
        `, [dataInicio]);

        const [porDia] = await this.pool.query(`
            SELECT 
                DATE(enviado_em) as data,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'enviado' THEN 1 ELSE 0 END) as enviados
            FROM regua_cobranca_historico
            WHERE enviado_em >= ?
            GROUP BY DATE(enviado_em)
            ORDER BY data
        `, [dataInicio]);

        const [ultimosEnvios] = await this.pool.query(`
            SELECT h.*, c.nome as cliente_nome
            FROM regua_cobranca_historico h
            LEFT JOIN clientes c ON h.cliente_id = c.id
            ORDER BY h.enviado_em DESC
            LIMIT 10
        `);

        return {
            stats: stats[0],
            por_dia: porDia,
            ultimos_envios: ultimosEnvios
        };
    }

    /**
     * Iniciar serviço automático (execução diária)
     */
    iniciarServico() {
        // Executar a cada hora para verificar se está no horário configurado
        this.intervaloExecucao = setInterval(async () => {
            try {
                const config = await this.getConfig();
                if (!config.ativo) return;

                const agora = new Date();
                const horaAtual = `${agora.getHours().toString().padStart(2, '0')}:${agora.getMinutes().toString().padStart(2, '0')}`;
                const horaConfig = config.horario_execucao?.substring(0, 5) || '08:00';

                // Executar se estiver dentro de 5 minutos do horário configurado
                if (horaAtual === horaConfig) {
                    console.log('[RÉGUA] Executando régua agendada...');
                    await this.executarRegua();
                }
            } catch (e) {
                console.error('[RÉGUA] Erro no serviço automático:', e);
            }
        }, 60000); // Verificar a cada minuto

        console.log('[RÉGUA] Serviço automático iniciado');
    }

    /**
     * Parar serviço
     */
    pararServico() {
        if (this.intervaloExecucao) {
            clearInterval(this.intervaloExecucao);
            this.intervaloExecucao = null;
            console.log('[RÉGUA] Serviço parado');
        }
    }
}

module.exports = ReguaCobrancaService;
