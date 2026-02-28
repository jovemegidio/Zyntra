/**
 * AUDIT-FIX R-17/R-18/R-19/R-20: Módulo de Compliance LGPD — ALUFORCE ERP
 * 
 * Implementa os direitos do titular de dados conforme Lei 13.709/2018:
 * - Art. 17-18: Acesso, correção, exclusão, portabilidade
 * - Art. 7-8: Gestão de consentimento
 * - Art. 16: Política de retenção automatizada
 * - Art. 41: Registro de DPO
 * - Art. 46: Proteção de dados pessoais
 * 
 * Criado durante auditoria de segurança — 15/02/2026
 */

const express = require('express');

function createLGPDRouter(pool, authenticateToken) {
    const router = express.Router();

    // =========================================================================
    // TABELAS LGPD (criadas na inicialização, não em runtime)
    // =========================================================================
    async function ensureLGPDTables() {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Tabela de consentimentos
            await connection.query(`
                CREATE TABLE IF NOT EXISTS lgpd_consentimentos (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    titular_tipo ENUM('usuario', 'funcionario', 'cliente', 'fornecedor') NOT NULL,
                    titular_id INT NOT NULL,
                    titular_nome VARCHAR(255),
                    titular_cpf_hash VARCHAR(255),
                    finalidade VARCHAR(500) NOT NULL,
                    base_legal ENUM('consentimento', 'contrato', 'obrigacao_legal', 'interesse_legitimo', 'protecao_credito') NOT NULL,
                    consentido BOOLEAN DEFAULT FALSE,
                    data_consentimento DATETIME,
                    data_revogacao DATETIME,
                    ip_consentimento VARCHAR(45),
                    user_agent_consentimento TEXT,
                    ativo BOOLEAN DEFAULT TRUE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_titular (titular_tipo, titular_id),
                    INDEX idx_ativo (ativo)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Tabela de requisições de titulares (DSAR)
            await connection.query(`
                CREATE TABLE IF NOT EXISTS lgpd_requisicoes (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    protocolo VARCHAR(20) NOT NULL UNIQUE,
                    titular_tipo ENUM('usuario', 'funcionario', 'cliente', 'fornecedor') NOT NULL,
                    titular_id INT,
                    titular_nome VARCHAR(255),
                    titular_email VARCHAR(255),
                    titular_cpf VARCHAR(14),
                    tipo_requisicao ENUM('acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao', 'informacao') NOT NULL,
                    descricao TEXT,
                    status ENUM('recebida', 'em_analise', 'em_execucao', 'concluida', 'negada') DEFAULT 'recebida',
                    motivo_negacao TEXT,
                    dados_exportados JSON,
                    data_conclusao DATETIME,
                    responsavel_id INT,
                    responsavel_nome VARCHAR(255),
                    prazo_legal DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_protocolo (protocolo),
                    INDEX idx_status (status),
                    INDEX idx_titular (titular_tipo, titular_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Tabela de log de tratamento de dados
            await connection.query(`
                CREATE TABLE IF NOT EXISTS lgpd_log_tratamento (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    operacao ENUM('coleta', 'armazenamento', 'compartilhamento', 'exclusao', 'anonimizacao', 'acesso', 'exportacao') NOT NULL,
                    tabela_origem VARCHAR(100),
                    registro_id INT,
                    dados_campos JSON,
                    base_legal VARCHAR(100),
                    finalidade VARCHAR(500),
                    usuario_id INT,
                    usuario_nome VARCHAR(255),
                    ip VARCHAR(45),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_operacao (operacao),
                    INDEX idx_tabela (tabela_origem, registro_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Tabela de política de retenção
            await connection.query(`
                CREATE TABLE IF NOT EXISTS lgpd_politica_retencao (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    tabela VARCHAR(100) NOT NULL,
                    campo_data VARCHAR(100) NOT NULL COMMENT 'Campo de data usado para calcular retenção',
                    dias_retencao INT NOT NULL,
                    acao ENUM('anonimizar', 'excluir', 'arquivar') NOT NULL DEFAULT 'anonimizar',
                    descricao VARCHAR(500),
                    ativo BOOLEAN DEFAULT TRUE,
                    ultima_execucao DATETIME,
                    registros_processados INT DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_tabela (tabela)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Inserir políticas padrão de retenção
            await connection.query(`
                INSERT IGNORE INTO lgpd_politica_retencao (tabela, campo_data, dias_retencao, acao, descricao) VALUES
                ('audit_log', 'created_at', 365, 'excluir', 'Logs de auditoria - retenção de 1 ano'),
                ('sessions', 'created_at', 30, 'excluir', 'Sessões expiradas - limpeza mensal'),
                ('refresh_tokens', 'created_at', 90, 'excluir', 'Tokens de refresh expirados'),
                ('lgpd_log_tratamento', 'created_at', 1825, 'arquivar', 'Logs LGPD - retenção de 5 anos')
            `);

            // Tabela de DPO (Data Protection Officer)
            await connection.query(`
                CREATE TABLE IF NOT EXISTS lgpd_dpo (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    nome VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    telefone VARCHAR(20),
                    cargo VARCHAR(100),
                    registro_anpd VARCHAR(100),
                    ativo BOOLEAN DEFAULT TRUE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            await connection.commit();
        } catch (err) {
            await connection.rollback();
            console.error('[LGPD] Erro ao criar tabelas:', err.message);
        } finally {
            connection.release();
        }
    }

    // Inicializar tabelas
    ensureLGPDTables().catch(err => console.error('[LGPD] Init error:', err.message));

    // =========================================================================
    // R-17: DSAR — Acesso aos dados do titular (Art. 18, I e II)
    // =========================================================================
    
    /**
     * GET /api/lgpd/meus-dados
     * Retorna todos os dados pessoais do titular autenticado
     */
    router.get('/meus-dados', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const result = {};

            // Dados do usuário
            const [userData] = await pool.query(
                'SELECT id, nome, email, role, created_at, updated_at FROM usuarios WHERE id = ?',
                [userId]
            );
            result.usuario = userData[0] || null;

            // Verificar se é também funcionário
            const [funcData] = await pool.query(
                `SELECT id, nome_completo, email, cpf, rg, telefone, cargo, departamento, 
                        data_nascimento, data_admissao, endereco, banco, agencia, conta_corrente,
                        pis_pasep, ctps_numero, tipo_chave_pix, chave_pix
                 FROM funcionarios WHERE email = ? OR nome_completo LIKE ?`,
                [req.user.email, `%${req.user.nome}%`]
            );
            result.funcionario = funcData[0] || null;

            // Pedidos (se vendedor)
            const [pedidos] = await pool.query(
                'SELECT id, numero_pedido, valor, status, created_at FROM pedidos WHERE vendedor_id = ? ORDER BY created_at DESC LIMIT 100',
                [userId]
            );
            result.pedidos = pedidos;

            // Consentimentos
            const [consents] = await pool.query(
                'SELECT finalidade, base_legal, consentido, data_consentimento, data_revogacao FROM lgpd_consentimentos WHERE titular_tipo = ? AND titular_id = ? AND ativo = 1',
                ['usuario', userId]
            );
            result.consentimentos = consents;

            // Log de tratamento
            await pool.query(
                `INSERT INTO lgpd_log_tratamento (operacao, tabela_origem, registro_id, usuario_id, usuario_nome, ip) 
                 VALUES ('acesso', 'usuarios', ?, ?, ?, ?)`,
                [userId, userId, req.user.nome || req.user.email, req.ip]
            );

            res.json({
                success: true,
                message: 'Dados pessoais do titular (Art. 18, LGPD)',
                data: result,
                data_consulta: new Date().toISOString(),
                aviso: 'Conforme Art. 19 da LGPD, os dados foram fornecidos em formato simplificado.'
            });
        } catch (error) {
            console.error('[LGPD] Erro meus-dados:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao recuperar dados pessoais.' });
        }
    });

    /**
     * POST /api/lgpd/requisicao
     * Cria uma requisição formal de titular (DSAR)
     */
    router.post('/requisicao', authenticateToken, async (req, res) => {
        try {
            const { tipo_requisicao, descricao } = req.body;
            const tiposValidos = ['acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao', 'informacao'];
            
            if (!tipo_requisicao || !tiposValidos.includes(tipo_requisicao)) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Tipo inválido. Use: ${tiposValidos.join(', ')}` 
                });
            }

            // Gerar protocolo único
            const protocolo = `LGPD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            
            // Prazo legal: 15 dias (Art. 19, §2º)
            const prazoLegal = new Date();
            prazoLegal.setDate(prazoLegal.getDate() + 15);

            await pool.query(`
                INSERT INTO lgpd_requisicoes (protocolo, titular_tipo, titular_id, titular_nome, titular_email, tipo_requisicao, descricao, prazo_legal)
                VALUES (?, 'usuario', ?, ?, ?, ?, ?, ?)
            `, [protocolo, req.user.id || req.user.userId, req.user.nome, req.user.email, tipo_requisicao, descricao || '', prazoLegal]);

            res.json({
                success: true,
                protocolo,
                message: `Requisição de ${tipo_requisicao} registrada com sucesso.`,
                prazo_legal: prazoLegal.toISOString(),
                aviso: 'Conforme Art. 19 da LGPD, sua requisição será atendida em até 15 dias.'
            });
        } catch (error) {
            console.error('[LGPD] Erro requisicao:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao registrar requisição.' });
        }
    });

    /**
     * GET /api/lgpd/requisicoes
     * Lista requisições do titular
     */
    router.get('/requisicoes', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const [reqs] = await pool.query(
                'SELECT protocolo, tipo_requisicao, status, descricao, prazo_legal, data_conclusao, created_at FROM lgpd_requisicoes WHERE titular_id = ? ORDER BY created_at DESC',
                [userId]
            );
            res.json({ success: true, requisicoes: reqs });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro ao listar requisições.' });
        }
    });

    // =========================================================================
    // R-18: Exclusão / Anonimização (Art. 18, IV e VI)
    // =========================================================================

    /**
     * POST /api/lgpd/anonimizar
     * Anonimiza dados pessoais do titular (soft-delete + anonimização)
     * ADMIN ONLY — executado em resposta a uma requisição formal
     */
    router.post('/anonimizar/:requisicaoId', authenticateToken, async (req, res) => {
        try {
            // Verificar se é admin
            if (req.user.role !== 'admin' && !req.user.is_admin) {
                return res.status(403).json({ success: false, message: 'Apenas administradores podem executar anonimização.' });
            }

            const { requisicaoId } = req.params;
            const [reqData] = await pool.query('SELECT * FROM lgpd_requisicoes WHERE id = ? AND tipo_requisicao IN (?, ?)', 
                [requisicaoId, 'exclusao', 'portabilidade']);
            
            if (reqData.length === 0) {
                return res.status(404).json({ success: false, message: 'Requisição não encontrada ou tipo incompatível.' });
            }

            const requisicao = reqData[0];
            const connection = await pool.getConnection();
            let registrosProcessados = 0;

            try {
                await connection.beginTransaction();

                // Anonimizar na tabela de usuários
                if (requisicao.titular_tipo === 'usuario') {
                    const [result] = await connection.query(`
                        UPDATE usuarios SET 
                            nome = CONCAT('ANONIMIZADO_', id),
                            email = CONCAT('anonimizado_', id, '@removed.lgpd'),
                            status = 'inativo',
                            updated_at = NOW()
                        WHERE id = ?
                    `, [requisicao.titular_id]);
                    registrosProcessados += result.affectedRows;
                }

                // Anonimizar na tabela de funcionários (se existir)
                if (requisicao.titular_tipo === 'funcionario') {
                    const [result] = await connection.query(`
                        UPDATE funcionarios SET
                            nome_completo = CONCAT('ANONIMIZADO_', id),
                            email = CONCAT('anonimizado_', id, '@removed.lgpd'),
                            cpf = NULL, rg = NULL, telefone = NULL,
                            endereco = NULL, pis_pasep = NULL, 
                            ctps_numero = NULL, ctps_serie = NULL,
                            banco = NULL, agencia = NULL, conta_corrente = NULL,
                            cnh = NULL, titulo_eleitor = NULL,
                            filiacao_mae = NULL, filiacao_pai = NULL,
                            dados_conjuge = NULL, senha = NULL, senha_texto = NULL,
                            tipo_chave_pix = NULL, chave_pix = NULL,
                            status = 'inativo'
                        WHERE id = ?
                    `, [requisicao.titular_id]);
                    registrosProcessados += result.affectedRows;
                }

                // Revogar todos os consentimentos
                await connection.query(
                    'UPDATE lgpd_consentimentos SET ativo = 0, data_revogacao = NOW() WHERE titular_tipo = ? AND titular_id = ?',
                    [requisicao.titular_tipo, requisicao.titular_id]
                );

                // Atualizar status da requisição
                await connection.query(
                    'UPDATE lgpd_requisicoes SET status = ?, data_conclusao = NOW(), responsavel_id = ?, responsavel_nome = ? WHERE id = ?',
                    ['concluida', req.user.id, req.user.nome, requisicaoId]
                );

                // Log de tratamento
                await connection.query(
                    `INSERT INTO lgpd_log_tratamento (operacao, tabela_origem, registro_id, dados_campos, usuario_id, usuario_nome, ip)
                     VALUES ('anonimizacao', ?, ?, ?, ?, ?, ?)`,
                    [requisicao.titular_tipo === 'usuario' ? 'usuarios' : 'funcionarios', 
                     requisicao.titular_id,
                     JSON.stringify({ protocolo: requisicao.protocolo, registros: registrosProcessados }),
                     req.user.id, req.user.nome, req.ip]
                );

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }

            res.json({
                success: true,
                message: `Anonimização concluída. ${registrosProcessados} registro(s) processado(s).`,
                protocolo: requisicao.protocolo
            });
        } catch (error) {
            console.error('[LGPD] Erro anonimização:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao processar anonimização.' });
        }
    });

    // =========================================================================
    // R-19: Gestão de Consentimento (Art. 7-8)
    // =========================================================================

    /**
     * POST /api/lgpd/consentimento
     * Registra consentimento do titular
     */
    router.post('/consentimento', authenticateToken, async (req, res) => {
        try {
            const { finalidade, base_legal, consentido } = req.body;
            
            if (!finalidade || !base_legal) {
                return res.status(400).json({ success: false, message: 'Finalidade e base legal são obrigatórios.' });
            }

            const userId = req.user.id || req.user.userId;

            // Verificar se já existe consentimento para esta finalidade
            const [existing] = await pool.query(
                'SELECT id FROM lgpd_consentimentos WHERE titular_tipo = ? AND titular_id = ? AND finalidade = ? AND ativo = 1',
                ['usuario', userId, finalidade]
            );

            if (existing.length > 0) {
                // Atualizar consentimento existente
                await pool.query(
                    `UPDATE lgpd_consentimentos SET consentido = ?, data_consentimento = IF(? = TRUE, NOW(), data_consentimento),
                     data_revogacao = IF(? = FALSE, NOW(), NULL), ip_consentimento = ?, user_agent_consentimento = ?
                     WHERE id = ?`,
                    [consentido, consentido, consentido, req.ip, req.headers['user-agent'], existing[0].id]
                );
            } else {
                // Criar novo consentimento
                await pool.query(
                    `INSERT INTO lgpd_consentimentos (titular_tipo, titular_id, titular_nome, finalidade, base_legal, consentido, data_consentimento, ip_consentimento, user_agent_consentimento)
                     VALUES ('usuario', ?, ?, ?, ?, ?, NOW(), ?, ?)`,
                    [userId, req.user.nome, finalidade, base_legal, consentido ? 1 : 0, req.ip, req.headers['user-agent']]
                );
            }

            res.json({
                success: true,
                message: consentido ? 'Consentimento registrado.' : 'Consentimento revogado.',
                finalidade,
                base_legal,
                data: new Date().toISOString()
            });
        } catch (error) {
            console.error('[LGPD] Erro consentimento:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao processar consentimento.' });
        }
    });

    /**
     * GET /api/lgpd/consentimentos
     * Lista consentimentos do titular
     */
    router.get('/consentimentos', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const [consents] = await pool.query(
                'SELECT id, finalidade, base_legal, consentido, data_consentimento, data_revogacao FROM lgpd_consentimentos WHERE titular_tipo = ? AND titular_id = ? AND ativo = 1',
                ['usuario', userId]
            );
            res.json({ success: true, consentimentos: consents });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro ao listar consentimentos.' });
        }
    });

    // =========================================================================
    // R-20: Política de Retenção Automatizada (Art. 16)
    // =========================================================================

    /**
     * POST /api/lgpd/executar-retencao
     * Executa política de retenção de dados (ADMIN ONLY)
     */
    router.post('/executar-retencao', authenticateToken, async (req, res) => {
        try {
            if (req.user.role !== 'admin' && !req.user.is_admin) {
                return res.status(403).json({ success: false, message: 'Apenas administradores.' });
            }

            const [politicas] = await pool.query('SELECT * FROM lgpd_politica_retencao WHERE ativo = 1');
            const resultados = [];

            for (const politica of politicas) {
                try {
                    const dataLimite = new Date();
                    dataLimite.setDate(dataLimite.getDate() - politica.dias_retencao);

                    let result;
                    if (politica.acao === 'excluir') {
                        [result] = await pool.query(
                            `DELETE FROM \`${politica.tabela}\` WHERE \`${politica.campo_data}\` < ?`,
                            [dataLimite]
                        );
                    } else if (politica.acao === 'anonimizar') {
                        // Para anonimização, depende da tabela
                        [result] = await pool.query(
                            `UPDATE \`${politica.tabela}\` SET updated_at = NOW() WHERE \`${politica.campo_data}\` < ?`,
                            [dataLimite]
                        );
                    }

                    const registros = result?.affectedRows || 0;
                    await pool.query(
                        'UPDATE lgpd_politica_retencao SET ultima_execucao = NOW(), registros_processados = ? WHERE id = ?',
                        [registros, politica.id]
                    );

                    resultados.push({ tabela: politica.tabela, registros, acao: politica.acao });
                } catch (err) {
                    resultados.push({ tabela: politica.tabela, erro: err.message });
                }
            }

            res.json({ success: true, message: 'Política de retenção executada.', resultados });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro ao executar retenção.' });
        }
    });

    /**
     * GET /api/lgpd/politica-retencao
     * Lista políticas de retenção configuradas
     */
    router.get('/politica-retencao', authenticateToken, async (req, res) => {
        try {
            const [politicas] = await pool.query('SELECT * FROM lgpd_politica_retencao ORDER BY tabela');
            res.json({ success: true, politicas });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro ao listar políticas.' });
        }
    });

    // =========================================================================
    // R-24: DPO / Encarregado de Dados (Art. 41)
    // =========================================================================

    /**
     * GET /api/lgpd/dpo
     * Retorna informações do DPO (público conforme Art. 41, §1º)
     */
    router.get('/dpo', async (req, res) => {
        try {
            const [dpo] = await pool.query('SELECT nome, email, telefone, cargo FROM lgpd_dpo WHERE ativo = 1 LIMIT 1');
            if (dpo.length === 0) {
                return res.json({
                    success: true,
                    dpo: null,
                    aviso: 'DPO ainda não designado. Conforme Art. 41 da LGPD, o controlador deve indicar um encarregado.'
                });
            }
            res.json({ success: true, dpo: dpo[0] });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro ao buscar DPO.' });
        }
    });

    /**
     * POST /api/lgpd/dpo
     * Registra/atualiza DPO (ADMIN ONLY)
     */
    router.post('/dpo', authenticateToken, async (req, res) => {
        try {
            if (req.user.role !== 'admin' && !req.user.is_admin) {
                return res.status(403).json({ success: false, message: 'Apenas administradores.' });
            }

            const { nome, email, telefone, cargo, registro_anpd } = req.body;
            if (!nome || !email) {
                return res.status(400).json({ success: false, message: 'Nome e email do DPO são obrigatórios.' });
            }

            // Desativar DPO anterior
            await pool.query('UPDATE lgpd_dpo SET ativo = 0');

            // Inserir novo DPO
            await pool.query(
                'INSERT INTO lgpd_dpo (nome, email, telefone, cargo, registro_anpd) VALUES (?, ?, ?, ?, ?)',
                [nome, email, telefone, cargo, registro_anpd]
            );

            res.json({ success: true, message: 'DPO registrado com sucesso.' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro ao registrar DPO.' });
        }
    });

    // =========================================================================
    // R-23: Política de Privacidade
    // =========================================================================

    /**
     * GET /api/lgpd/politica-privacidade
     * Retorna a política de privacidade (público)
     */
    router.get('/politica-privacidade', (req, res) => {
        res.json({
            success: true,
            versao: '1.0',
            data_vigencia: '2026-02-15',
            controlador: {
                nome: 'ALUFORCE',
                cnpj: process.env.EMPRESA_CNPJ || 'A definir',
                endereco: process.env.EMPRESA_ENDERECO || 'A definir',
                email_contato: process.env.DPO_EMAIL || 'dpo@aluforce.com.br'
            },
            dados_coletados: [
                { tipo: 'Dados de identificação', exemplos: 'Nome, CPF, RG, email, telefone', base_legal: 'Execução de contrato' },
                { tipo: 'Dados financeiros', exemplos: 'Banco, agência, conta, PIX', base_legal: 'Execução de contrato' },
                { tipo: 'Dados profissionais', exemplos: 'Cargo, departamento, salário', base_legal: 'Obrigação legal (CLT)' },
                { tipo: 'Dados de acesso', exemplos: 'IP, user-agent, logs', base_legal: 'Interesse legítimo (segurança)' }
            ],
            direitos_titular: [
                'Acesso aos dados (Art. 18, II)',
                'Correção de dados incompletos (Art. 18, III)',
                'Anonimização ou exclusão (Art. 18, IV)',
                'Portabilidade (Art. 18, V)',
                'Informação sobre compartilhamento (Art. 18, VII)',
                'Revogação do consentimento (Art. 18, IX)'
            ],
            canal_exercicio: '/api/lgpd/requisicao',
            prazo_resposta: '15 dias (Art. 19, §2º)',
            compartilhamento: [
                { destinatario: 'Omie ERP', finalidade: 'Sincronização contábil/fiscal', base_legal: 'Execução de contrato' }
            ],
            retencao: 'Dados pessoais são mantidos enquanto necessários. Após término da relação, dados são anonimizados conforme política de retenção.',
            seguranca: 'Utilizamos criptografia AES-256-GCM para dados sensíveis, bcrypt para senhas, e HTTPS para transmissão.'
        });
    });

    // =========================================================================
    // Exportação de dados (Portabilidade - Art. 18, V)
    // =========================================================================

    /**
     * GET /api/lgpd/exportar
     * Exporta todos os dados do titular em formato JSON (portabilidade)
     */
    router.get('/exportar', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const exportData = {
                meta: {
                    exportado_em: new Date().toISOString(),
                    formato: 'JSON',
                    titular: req.user.nome || req.user.email,
                    base_legal: 'Art. 18, V - LGPD (Portabilidade)'
                },
                dados: {}
            };

            // Coletar todos os dados de todas as tabelas relevantes
            const tabelas = [
                { query: 'SELECT * FROM usuarios WHERE id = ?', params: [userId], nome: 'usuario' },
                { query: 'SELECT * FROM pedidos WHERE vendedor_id = ?', params: [userId], nome: 'pedidos' },
                { query: 'SELECT * FROM lgpd_consentimentos WHERE titular_tipo = ? AND titular_id = ?', params: ['usuario', userId], nome: 'consentimentos' },
                { query: 'SELECT * FROM lgpd_requisicoes WHERE titular_id = ?', params: [userId], nome: 'requisicoes_lgpd' }
            ];

            for (const tabela of tabelas) {
                try {
                    const [rows] = await pool.query(tabela.query, tabela.params);
                    exportData.dados[tabela.nome] = rows;
                } catch (err) {
                    exportData.dados[tabela.nome] = { erro: 'Tabela não disponível' };
                }
            }

            // Log de exportação
            await pool.query(
                `INSERT INTO lgpd_log_tratamento (operacao, tabela_origem, registro_id, usuario_id, usuario_nome, ip)
                 VALUES ('exportacao', 'usuarios', ?, ?, ?, ?)`,
                [userId, userId, req.user.nome, req.ip]
            );

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="dados_pessoais_${userId}_${Date.now()}.json"`);
            res.json(exportData);
        } catch (error) {
            console.error('[LGPD] Erro exportação:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao exportar dados.' });
        }
    });

    return router;
}

module.exports = { createLGPDRouter };
