/**
 * PCP Domain Module: Configuracoes do Sistema (empresa, impostos, vendedores, certificados, etc.)
 * Extraido de pcp-routes.js em 10/03/2026
 * Padrao Mixin: registra rotas no router compartilhado do PCP
 * @module routes/pcp/configuracoes-routes
 */

module.exports = function registerConfiguracoesRoutes(router, deps) {
    const { pool, authenticateToken, authorizeAdmin, cacheMiddleware, CACHE_CONFIG, writeAuditLog } = deps;

    const path = require('path');
    const fs = require('fs');
    const multer = require('multer');
    const upload = multer({ dest: path.join(__dirname, '..', '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });

    // ========================================
    // API: CONFIGURAÇÕES DA EMPRESA
    // ========================================

    // GET - Buscar configurações da empresa
    router.get('/api/configuracoes/empresa', authenticateToken, cacheMiddleware('cfg_empresa', CACHE_CONFIG.configuracoes), async (req, res) => {
        try {
            console.log('📋 Buscando configurações da empresa...');

            const [rows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');

            if (rows.length > 0) {
                res.json(rows[0]);
            } else {
                // Retorna dados padrão da Aluforce
                res.json({
                    razao_social: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
                    nome_fantasia: 'ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES ELETRICOS',
                    cnpj: '68.192.475/0001-60',
                    telefone: '(11) 91793-9089',
                    cep: '08537-400',
                    estado: 'SP',
                    cidade: 'Ferraz de Vasconcelos (SP)',
                    bairro: 'VILA SÃO JOÃO',
                    endereco: 'RUA ERNESTINA',
                    numero: '270',
                    complemento: ''
                });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar configurações:', error);
            res.status(500).json({ error: 'Erro ao buscar configurações' });
        }
    });

    // POST - Salvar configurações da empresa
    router.post('/api/configuracoes/empresa', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Salvando configurações da empresa...');

            const {
                razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento
            } = req.body;

            // Verificar se já existe registro
            const [existing] = await pool.query('SELECT id FROM configuracoes_empresa LIMIT 1');

            if (existing.length > 0) {
                // Atualizar registro existente
                await pool.query(`
                    UPDATE configuracoes_empresa
                    SET razao_social = ?, nome_fantasia = ?, cnpj = ?, inscricao_estadual = ?,
                        inscricao_municipal = ?, telefone = ?, email = ?, site = ?, cep = ?,
                        estado = ?, cidade = ?, bairro = ?, endereco = ?, numero = ?, complemento = ?
                    WHERE id = ?
                `, [razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                    telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento,
                    existing[0].id]);

                console.log('✅ Configurações atualizadas');
            } else {
                // Inserir novo registro
                await pool.query(`
                    INSERT INTO configuracoes_empresa
                    (razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                     telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                    telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento]);

                console.log('✅ Configurações criadas');
            }

            res.json({
                success: true,
                message: 'Configurações salvas com sucesso!'
            });

        } catch (error) {
            console.error('❌ Erro ao salvar configurações:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao salvar configurações',
                message: error.message
            });
        }
    });

    // POST - Upload de logo da empresa
    router.post('/api/configuracoes/upload-logo', authenticateToken, authorizeAdmin, upload.single('logo'), async (req, res) => {
        try {
            console.log('🖼️ Upload de logo da empresa...');

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
            }

            const logoPath = '/uploads/empresa/' + req.file.filename;

            // Atualizar URL do logo no banco de dados
            const [existing] = await pool.query('SELECT id FROM configuracoes_empresa LIMIT 1');

            if (existing.length > 0) {
                await pool.query('UPDATE configuracoes_empresa SET logo_url = ? WHERE id = ?', [logoPath, existing[0].id]);
            } else {
                await pool.query('INSERT INTO configuracoes_empresa (logo_url) VALUES (?)', [logoPath]);
            }

            console.log('✅ Logo atualizado:', logoPath);

            res.json({
                success: true,
                url: logoPath,
                message: 'Logo atualizado com sucesso!'
            });

        } catch (error) {
            console.error('❌ Erro ao fazer upload do logo:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao fazer upload do logo',
                message: error.message
            });
        }
    });

    // POST - Upload de favicon da empresa
    router.post('/api/configuracoes/upload-favicon', authenticateToken, authorizeAdmin, upload.single('favicon'), async (req, res) => {
        try {
            console.log('🖼️ Upload de favicon da empresa...');

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
            }

            const faviconPath = '/uploads/empresa/' + req.file.filename;

            // Atualizar URL do favicon no banco de dados
            const [existing] = await pool.query('SELECT id FROM configuracoes_empresa LIMIT 1');

            if (existing.length > 0) {
                await pool.query('UPDATE configuracoes_empresa SET favicon_url = ? WHERE id = ?', [faviconPath, existing[0].id]);
            } else {
                await pool.query('INSERT INTO configuracoes_empresa (favicon_url) VALUES (?)', [faviconPath]);
            }

            console.log('✅ Favicon atualizado:', faviconPath);

            res.json({
                success: true,
                url: faviconPath,
                message: 'Favicon atualizado com sucesso!'
            });

        } catch (error) {
            console.error('❌ Erro ao fazer upload do favicon:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao fazer upload do favicon',
                message: error.message
            });
        }
    });

    // ========================================
    // API: POPULAR DADOS DE EXEMPLO
    // ========================================
    router.post('/api/admin/popular-dados', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('📝 Populando dados de exemplo...');

            // 1. Verificar produtos
            const [produtos] = await pool.query('SELECT COUNT(*) as total FROM produtos');
            let produtosInseridos = 0;

            if (produtos[0].total === 0) {
                const produtosExemplo = [
                    ['DUN10', 'CABO DUPLEX NEUTRO NU 2x10mm² LABOR 0,6/1KV', 'Preto / Nu', 'Labor Energy', 'Cabo multiplexado duplex com neutro nu', '7894567890123', 'SKU-DUN10', 28.90],
                    ['TRI25', 'CABO TRIPLEX 3x25mm² LABOR 0,6/1KV', 'Preto / Preto / Nu', 'Labor Energy', 'Cabo multiplexado triplex', '7894567890124', 'SKU-TRI25', 65.90],
                    ['QDN50', 'CABO QUADRUPLEX 3x50mm² + 1x50mm² LABOR 0,6/1KV', 'Preto / Preto / Preto / Nu', 'Labor Energy', 'Cabo multiplexado quadruplex', '7894567890125', 'SKU-QDN50', 125.50],
                    ['DUN16', 'CABO DUPLEX NEUTRO NU 2x16mm² LABOR 0,6/1KV', 'Preto / Nu', 'Aluforce', 'Cabo multiplexado duplex', '7894567890126', 'SKU-DUN16', 38.90],
                    ['TRI35', 'CABO TRIPLEX 3x35mm² LABOR 0,6/1KV', 'Preto / Preto / Nu', 'Aluforce', 'Cabo multiplexado triplex', '7894567890127', 'SKU-TRI35', 85.90],
                    ['QDN70', 'CABO QUADRUPLEX 3x70mm² + 1x70mm² LABOR 0,6/1KV', 'Preto / Preto / Preto / Nu', 'Aluforce', 'Cabo multiplexado quadruplex', '7894567890128', 'SKU-QDN70', 165.50],
                    ['DUN25', 'CABO DUPLEX NEUTRO NU 2x25mm² LABOR 0,6/1KV', 'Preto / Nu', 'Labor Energy', 'Cabo multiplexado duplex', '7894567890129', 'SKU-DUN25', 58.90],
                    ['TRI50', 'CABO TRIPLEX 3x50mm² LABOR 0,6/1KV', 'Preto / Preto / Nu', 'Labor Energy', 'Cabo multiplexado triplex', '7894567890130', 'SKU-TRI50', 105.90],
                    ['QDN95', 'CABO QUADRUPLEX 3x95mm² + 1x95mm² LABOR 0,6/1KV', 'Preto / Preto / Preto / Nu', 'Aluforce', 'Cabo multiplexado quadruplex', '7894567890131', 'SKU-QDN95', 225.50],
                    ['DUN35', 'CABO DUPLEX NEUTRO NU 2x35mm² LABOR 0,6/1KV', 'Preto / Nu', 'Aluforce', 'Cabo multiplexado duplex', '7894567890132', 'SKU-DUN35', 78.90]
                ];

                for (const prod of produtosExemplo) {
                    await pool.query(`
                        INSERT INTO produtos (codigo, nome, variacao, marca, descricao, gtin, sku, custo_unitario)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, prod);
                    produtosInseridos++;
                }
            }

            // 2. Verificar materiais
            const [materiais] = await pool.query('SELECT COUNT(*) as total FROM materiais');
            let materiaisInseridos = 0;

            if (materiais[0].total === 0) {
                const materiaisExemplo = [
                    ['ALU-PERFIL-20X20', 'Perfil de Alumínio 20x20mm', 'M', 15.50, 100.00, 'ALUFORCE'],
                    ['ALU-CHAPA-2MM', 'Chapa de Alumínio 2mm', 'M2', 85.00, 50.00, 'ALUFORCE'],
                    ['ALU-BARRA-30X30', 'Barra de Alumínio 30x30mm', 'M', 28.75, 75.00, 'FORNECEDOR A'],
                    ['ALU-TUBO-25MM', 'Tubo de Alumínio Redondo 25mm', 'M', 22.90, 120.00, 'FORNECEDOR B'],
                    ['ALU-CANTONEIRA-20X20', 'Cantoneira de Alumínio 20x20mm', 'M', 18.50, 80.00, 'ALUFORCE'],
                    ['ALU-PERFIL-U-30MM', 'Perfil U de Alumínio 30mm', 'M', 25.00, 60.00, 'FORNECEDOR A'],
                    ['ALU-CHAPA-3MM', 'Chapa de Alumínio 3mm', 'M2', 125.00, 30.00, 'ALUFORCE'],
                    ['ALU-BARRA-40X40', 'Barra de Alumínio 40x40mm', 'M', 38.50, 65.00, 'FORNECEDOR B'],
                    ['ALU-TUBO-32MM', 'Tubo de Alumínio Redondo 32mm', 'M', 32.90, 90.00, 'ALUFORCE'],
                    ['ALU-PERFIL-T-25MM', 'Perfil T de Alumínio 25mm', 'M', 21.75, 110.00, 'FORNECEDOR A']
                ];

                for (const mat of materiaisExemplo) {
                    await pool.query(`
                        INSERT INTO materiais (codigo_material, descricao, unidade_medida, custo_unitario, quantidade_estoque, fornecedor_padrao)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, mat);
                    materiaisInseridos++;
                }
            }

            // 3. Retornar resumo
            const [produtosTotal] = await pool.query('SELECT COUNT(*) as total FROM produtos');
            const [materiaisTotal] = await pool.query('SELECT COUNT(*) as total FROM materiais');

            console.log(`✅ Dados populados: ${produtosInseridos} produtos + ${materiaisInseridos} materiais`);

            res.json({
                success: true,
                message: 'Dados populados com sucesso',
                produtosInseridos,
                materiaisInseridos,
                totais: {
                    produtos: produtosTotal[0].total,
                    materiais: materiaisTotal[0].total
                }
            });

        } catch (error) {
            console.error('❌ Erro ao popular dados:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao popular dados',
                message: error.message
            });
        }
    });

    // ========================================
    // API: CONFIGURAÇÕES ESTENDIDAS
    // ========================================

    // Venda de Produtos
    router.post('/api/configuracoes/venda-produtos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { etapas, tabelas_preco, numeracao, reserva_estoque } = req.body;

            const [existing] = await pool.query('SELECT id FROM configuracoes_venda_produtos LIMIT 1');

            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_venda_produtos
                    SET etapas = ?, tabelas_preco = ?, numeracao = ?, reserva_estoque = ?
                    WHERE id = ?
                `, [JSON.stringify(etapas), JSON.stringify(tabelas_preco), JSON.stringify(numeracao), JSON.stringify(reserva_estoque), existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_venda_produtos (etapas, tabelas_preco, numeracao, reserva_estoque)
                    VALUES (?, ?, ?, ?)
                `, [JSON.stringify(etapas), JSON.stringify(tabelas_preco), JSON.stringify(numeracao), JSON.stringify(reserva_estoque)]);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config venda produtos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Venda de Serviços
    router.post('/api/configuracoes/venda-servicos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { etapas, proposta, numeracao } = req.body;

            const [existing] = await pool.query('SELECT id FROM configuracoes_venda_servicos LIMIT 1');

            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_venda_servicos
                    SET etapas = ?, proposta = ?, numeracao = ?
                    WHERE id = ?
                `, [JSON.stringify(etapas), JSON.stringify(proposta), JSON.stringify(numeracao), existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_venda_servicos (etapas, proposta, numeracao)
                    VALUES (?, ?, ?)
                `, [JSON.stringify(etapas), JSON.stringify(proposta), JSON.stringify(numeracao)]);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config venda serviços:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Clientes e Fornecedores
    router.post('/api/configuracoes/clientes-fornecedores', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { validacoes, credito, tags } = req.body;

            const [existing] = await pool.query('SELECT id FROM configuracoes_clientes_fornecedores LIMIT 1');

            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_clientes_fornecedores
                    SET validacoes = ?, credito = ?, tags = ?
                    WHERE id = ?
                `, [JSON.stringify(validacoes), JSON.stringify(credito), JSON.stringify(tags), existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_clientes_fornecedores (validacoes, credito, tags)
                    VALUES (?, ?, ?)
                `, [JSON.stringify(validacoes), JSON.stringify(credito), JSON.stringify(tags)]);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config clientes/fornecedores:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Finanças
    router.post('/api/configuracoes/financas', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { contas_atraso, email_remessa, juros_mes, multa_atraso } = req.body;

            const [existing] = await pool.query('SELECT id FROM configuracoes_financas LIMIT 1');

            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_financas
                    SET contas_atraso = ?, email_remessa = ?, juros_mes = ?, multa_atraso = ?
                    WHERE id = ?
                `, [contas_atraso, email_remessa, juros_mes, multa_atraso, existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_financas (contas_atraso, email_remessa, juros_mes, multa_atraso)
                    VALUES (?, ?, ?, ?)
                `, [contas_atraso, email_remessa, juros_mes, multa_atraso]);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config finanças:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // GET - Buscar etapas do processo de vendas
    // ========================================
    router.get('/api/configuracoes/venda-produtos', authenticateToken, cacheMiddleware('cfg_venda_prod', CACHE_CONFIG.configuracoes), async (req, res) => {
        try {
            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE (already in POST route)

            const [rows] = await pool.query('SELECT * FROM configuracoes_venda_produtos LIMIT 1');

            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    etapas: config.etapas ? JSON.parse(config.etapas) : null,
                    tabelas_preco: config.tabelas_preco ? JSON.parse(config.tabelas_preco) : null,
                    numeracao: config.numeracao ? JSON.parse(config.numeracao) : null,
                    reserva_estoque: config.reserva_estoque ? JSON.parse(config.reserva_estoque) : null
                });
            } else {
                // Retornar configuração padrão
                res.json({
                    success: true,
                    etapas: [
                        { id: 'orcamento', nome: 'Orçamento', status: 'orcamento' },
                        { id: 'analise', nome: 'Análise de Crédito', status: 'analise' },
                        { id: 'aprovado', nome: 'Pedido Aprovado', status: 'aprovado' },
                        { id: 'faturar', nome: 'Faturar', status: 'faturar' },
                        { id: 'faturado', nome: 'Faturado', status: 'faturado', destaque: true },
                        { id: 'recibo', nome: 'Recibo', status: 'recibo' }
                    ],
                    tabelas_preco: null,
                    numeracao: null,
                    reserva_estoque: null
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config venda produtos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // GET - Buscar configurações de venda de serviços
    // ========================================
    router.get('/api/configuracoes/venda-servicos', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_venda_servicos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                etapas TEXT,
                proposta TEXT,
                numeracao TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [rows] = await pool.query('SELECT * FROM configuracoes_venda_servicos LIMIT 1');
            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    etapas: config.etapas ? JSON.parse(config.etapas) : null,
                    proposta: config.proposta ? JSON.parse(config.proposta) : null,
                    numeracao: config.numeracao ? JSON.parse(config.numeracao) : null
                });
            } else {
                res.json({
                    success: true,
                    etapas: { ordem_servico: true, em_execucao: true, executada: true, faturar_servico: true },
                    proposta: { permitir_proposta: false },
                    numeracao: { proximo_os: 1001 }
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config venda serviços:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // GET - Buscar configurações de clientes e fornecedores
    // ========================================
    router.get('/api/configuracoes/clientes-fornecedores', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_clientes_fornecedores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                validacoes TEXT,
                credito TEXT,
                tags TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [rows] = await pool.query('SELECT * FROM configuracoes_clientes_fornecedores LIMIT 1');
            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    validacoes: config.validacoes ? JSON.parse(config.validacoes) : null,
                    credito: config.credito ? JSON.parse(config.credito) : null,
                    tags: config.tags ? JSON.parse(config.tags) : null
                });
            } else {
                res.json({
                    success: true,
                    validacoes: { obrigar_cnpj_cpf: false, obrigar_endereco: false, obrigar_email: false, validar_unicidade: false },
                    credito: { bloquear_novos: false, limite_padrao: '0' },
                    tags: { tags_automaticas: false }
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config clientes/fornecedores:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // GET - Buscar configurações de finanças
    // ========================================
    router.get('/api/configuracoes/financas', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_financas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                contas_atraso VARCHAR(50) DEFAULT 'nao-mostrar',
                email_remessa VARCHAR(255) DEFAULT '',
                juros_mes VARCHAR(10) DEFAULT '1.0',
                multa_atraso VARCHAR(10) DEFAULT '2.0',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [rows] = await pool.query('SELECT * FROM configuracoes_financas LIMIT 1');
            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    contas_atraso: config.contas_atraso || 'nao-mostrar',
                    email_remessa: config.email_remessa || '',
                    juros_mes: config.juros_mes || '1.0',
                    multa_atraso: config.multa_atraso || '2.0'
                });
            } else {
                res.json({
                    success: true,
                    contas_atraso: 'nao-mostrar',
                    email_remessa: '',
                    juros_mes: '1.0',
                    multa_atraso: '2.0'
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config finanças:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // TIPOS DE ENTREGA - CRUD completo
    // ========================================
    router.get('/api/configuracoes/tipos-entrega', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS tipos_entrega (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                prazo INT DEFAULT 0,
                transportadora_id INT DEFAULT NULL,
                situacao VARCHAR(20) DEFAULT 'ativo',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [tipos] = await pool.query(`
                SELECT te.*, t.nome as transportadora_nome 
                FROM tipos_entrega te 
                LEFT JOIN transportadoras t ON te.transportadora_id = t.id 
                ORDER BY te.nome
            `);
            res.json({ data: tipos });
        } catch (error) {
            console.error('Erro ao buscar tipos de entrega:', error);
            // Fallback sem JOIN de transportadoras
            try {
                const [tipos] = await pool.query('SELECT * FROM tipos_entrega ORDER BY nome');
                res.json({ data: tipos.map(t => ({...t, transportadora_nome: null})) });
            } catch(e2) {
                res.status(500).json({ error: e2.message });
            }
        }
    });

    router.post('/api/configuracoes/tipos-entrega', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, prazo, transportadora_id, situacao } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const [result] = await pool.query(
                'INSERT INTO tipos_entrega (nome, prazo, transportadora_id, situacao) VALUES (?, ?, ?, ?)',
                [nome, prazo || 0, transportadora_id || null, situacao || 'ativo']
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar tipo de entrega:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/configuracoes/tipos-entrega/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, prazo, transportadora_id, situacao } = req.body;
            await pool.query(
                'UPDATE tipos_entrega SET nome = ?, prazo = ?, transportadora_id = ?, situacao = ? WHERE id = ?',
                [nome, prazo || 0, transportadora_id || null, situacao || 'ativo', req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar tipo de entrega:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/tipos-entrega/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM tipos_entrega WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir tipo de entrega:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // INFORMAÇÕES DE FRETE - GET/POST
    // ========================================
    router.get('/api/configuracoes/info-frete', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_info_frete (
                id INT AUTO_INCREMENT PRIMARY KEY,
                modalidade VARCHAR(50) DEFAULT 'CIF',
                frete_minimo DECIMAL(10,2) DEFAULT 0,
                url_rastreio VARCHAR(500) DEFAULT '',
                habilitar_rastreamento TINYINT(1) DEFAULT 0,
                notificar_despacho TINYINT(1) DEFAULT 0,
                notificar_entrega TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [rows] = await pool.query('SELECT * FROM configuracoes_info_frete LIMIT 1');
            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    modalidade: config.modalidade || 'CIF',
                    frete_minimo: config.frete_minimo || 0,
                    url_rastreio: config.url_rastreio || '',
                    habilitar_rastreamento: !!config.habilitar_rastreamento,
                    notificar_despacho: !!config.notificar_despacho,
                    notificar_entrega: !!config.notificar_entrega
                });
            } else {
                res.json({
                    success: true,
                    modalidade: 'CIF',
                    frete_minimo: 0,
                    url_rastreio: '',
                    habilitar_rastreamento: false,
                    notificar_despacho: false,
                    notificar_entrega: false
                });
            }
        } catch (error) {
            console.error('Erro ao buscar info frete:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/configuracoes/info-frete', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { modalidade, frete_minimo, url_rastreio, habilitar_rastreamento, notificar_despacho, notificar_entrega } = req.body;
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_info_frete (
                id INT AUTO_INCREMENT PRIMARY KEY,
                modalidade VARCHAR(50) DEFAULT 'CIF',
                frete_minimo DECIMAL(10,2) DEFAULT 0,
                url_rastreio VARCHAR(500) DEFAULT '',
                habilitar_rastreamento TINYINT(1) DEFAULT 0,
                notificar_despacho TINYINT(1) DEFAULT 0,
                notificar_entrega TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [existing] = await pool.query('SELECT id FROM configuracoes_info_frete LIMIT 1');
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_info_frete
                    SET modalidade = ?, frete_minimo = ?, url_rastreio = ?,
                        habilitar_rastreamento = ?, notificar_despacho = ?, notificar_entrega = ?
                    WHERE id = ?
                `, [modalidade || 'CIF', frete_minimo || 0, url_rastreio || '', 
                    habilitar_rastreamento ? 1 : 0, notificar_despacho ? 1 : 0, notificar_entrega ? 1 : 0,
                    existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_info_frete (modalidade, frete_minimo, url_rastreio, habilitar_rastreamento, notificar_despacho, notificar_entrega)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [modalidade || 'CIF', frete_minimo || 0, url_rastreio || '',
                    habilitar_rastreamento ? 1 : 0, notificar_despacho ? 1 : 0, notificar_entrega ? 1 : 0]);
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar info frete:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // NFS-e CONFIGURAÇÕES - GET/POST
    // ========================================
    router.get('/api/configuracoes/nfse', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_nfse (
                id INT AUTO_INCREMENT PRIMARY KEY,
                inscricao_municipal VARCHAR(50) DEFAULT '',
                codigo_municipio VARCHAR(20) DEFAULT '',
                ambiente VARCHAR(20) DEFAULT 'homologacao',
                regime_tributacao VARCHAR(10) DEFAULT '1',
                envio_automatico TINYINT(1) DEFAULT 1,
                reter_iss TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [rows] = await pool.query('SELECT * FROM configuracoes_nfse LIMIT 1');
            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    inscricao_municipal: config.inscricao_municipal || '',
                    codigo_municipio: config.codigo_municipio || '',
                    ambiente: config.ambiente || 'homologacao',
                    regime_tributacao: config.regime_tributacao || '1',
                    envio_automatico: !!config.envio_automatico,
                    reter_iss: !!config.reter_iss
                });
            } else {
                res.json({
                    success: true,
                    inscricao_municipal: '',
                    codigo_municipio: '',
                    ambiente: 'homologacao',
                    regime_tributacao: '1',
                    envio_automatico: true,
                    reter_iss: false
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config NFS-e:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/configuracoes/nfse', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { inscricao_municipal, codigo_municipio, ambiente, regime_tributacao, envio_automatico, reter_iss } = req.body;
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_nfse (
                id INT AUTO_INCREMENT PRIMARY KEY,
                inscricao_municipal VARCHAR(50) DEFAULT '',
                codigo_municipio VARCHAR(20) DEFAULT '',
                ambiente VARCHAR(20) DEFAULT 'homologacao',
                regime_tributacao VARCHAR(10) DEFAULT '1',
                envio_automatico TINYINT(1) DEFAULT 1,
                reter_iss TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [existing] = await pool.query('SELECT id FROM configuracoes_nfse LIMIT 1');
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_nfse
                    SET inscricao_municipal = ?, codigo_municipio = ?, ambiente = ?,
                        regime_tributacao = ?, envio_automatico = ?, reter_iss = ?
                    WHERE id = ?
                `, [inscricao_municipal || '', codigo_municipio || '', ambiente || 'homologacao',
                    regime_tributacao || '1', envio_automatico ? 1 : 0, reter_iss ? 1 : 0,
                    existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_nfse (inscricao_municipal, codigo_municipio, ambiente, regime_tributacao, envio_automatico, reter_iss)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [inscricao_municipal || '', codigo_municipio || '', ambiente || 'homologacao',
                    regime_tributacao || '1', envio_automatico ? 1 : 0, reter_iss ? 1 : 0]);
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config NFS-e:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // CUSTOS E PRECIFICAÇÃO - GET/PUT
    // ========================================
    router.get('/api/configuracoes/custos-precificacao', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_custos_precificacao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                metodo_precificacao VARCHAR(50) DEFAULT 'markup',
                margem_padrao DECIMAL(10,2) DEFAULT 30,
                preco_venda_padrao DECIMAL(10,2) DEFAULT 0,
                custo_unitario_padrao DECIMAL(10,2) DEFAULT 0,
                incluir_frete VARCHAR(10) DEFAULT 'sim',
                incluir_impostos VARCHAR(10) DEFAULT 'nao',
                custo_mao_obra DECIMAL(10,2) DEFAULT 15,
                custos_indiretos DECIMAL(10,2) DEFAULT 10,
                casas_decimais INT DEFAULT 2,
                arredondamento VARCHAR(20) DEFAULT 'matematico',
                ncm_padrao VARCHAR(20) DEFAULT '',
                icms_padrao DECIMAL(10,2) DEFAULT 0,
                regime_tributario VARCHAR(30) DEFAULT 'simples',
                uf_origem VARCHAR(5) DEFAULT 'SP',
                exibir_moeda TINYINT(1) DEFAULT 1,
                exibir_margem TINYINT(1) DEFAULT 1,
                alerta_margem_min DECIMAL(10,2) DEFAULT 10,
                alerta_preco_custo VARCHAR(20) DEFAULT 'aviso',
                notif_email TINYINT(1) DEFAULT 0,
                notif_sistema TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [rows] = await pool.query('SELECT * FROM configuracoes_custos_precificacao LIMIT 1');
            if (rows.length > 0) {
                const c = rows[0];
                res.json({
                    success: true,
                    metodo_precificacao: c.metodo_precificacao || 'markup',
                    margem_padrao: parseFloat(c.margem_padrao) || 30,
                    preco_venda_padrao: parseFloat(c.preco_venda_padrao) || 0,
                    custo_unitario_padrao: parseFloat(c.custo_unitario_padrao) || 0,
                    incluir_frete: c.incluir_frete || 'sim',
                    incluir_impostos: c.incluir_impostos || 'nao',
                    custo_mao_obra: parseFloat(c.custo_mao_obra) || 15,
                    custos_indiretos: parseFloat(c.custos_indiretos) || 10,
                    casas_decimais: parseInt(c.casas_decimais) || 2,
                    arredondamento: c.arredondamento || 'matematico',
                    ncm_padrao: c.ncm_padrao || '',
                    icms_padrao: parseFloat(c.icms_padrao) || 0,
                    regime_tributario: c.regime_tributario || 'simples',
                    uf_origem: c.uf_origem || 'SP',
                    exibir_moeda: !!c.exibir_moeda,
                    exibir_margem: !!c.exibir_margem,
                    alerta_margem_min: parseFloat(c.alerta_margem_min) || 10,
                    alerta_preco_custo: c.alerta_preco_custo || 'aviso',
                    notif_email: !!c.notif_email,
                    notif_sistema: !!c.notif_sistema
                });
            } else {
                res.json({
                    success: true,
                    metodo_precificacao: 'markup', margem_padrao: 30, preco_venda_padrao: 0,
                    custo_unitario_padrao: 0, incluir_frete: 'sim', incluir_impostos: 'nao',
                    custo_mao_obra: 15, custos_indiretos: 10, casas_decimais: 2,
                    arredondamento: 'matematico', ncm_padrao: '', icms_padrao: 0,
                    regime_tributario: 'simples', uf_origem: 'SP', exibir_moeda: true,
                    exibir_margem: true, alerta_margem_min: 10, alerta_preco_custo: 'aviso',
                    notif_email: false, notif_sistema: true
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config custos/precificação:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/configuracoes/custos-precificacao', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { metodo_precificacao, margem_padrao, preco_venda_padrao, custo_unitario_padrao,
                    incluir_frete, incluir_impostos, custo_mao_obra, custos_indiretos,
                    casas_decimais, arredondamento, ncm_padrao, icms_padrao,
                    regime_tributario, uf_origem, exibir_moeda, exibir_margem,
                    alerta_margem_min, alerta_preco_custo, notif_email, notif_sistema } = req.body;
            
            await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_custos_precificacao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                metodo_precificacao VARCHAR(50) DEFAULT 'markup',
                margem_padrao DECIMAL(10,2) DEFAULT 30,
                preco_venda_padrao DECIMAL(10,2) DEFAULT 0,
                custo_unitario_padrao DECIMAL(10,2) DEFAULT 0,
                incluir_frete VARCHAR(10) DEFAULT 'sim',
                incluir_impostos VARCHAR(10) DEFAULT 'nao',
                custo_mao_obra DECIMAL(10,2) DEFAULT 15,
                custos_indiretos DECIMAL(10,2) DEFAULT 10,
                casas_decimais INT DEFAULT 2,
                arredondamento VARCHAR(20) DEFAULT 'matematico',
                ncm_padrao VARCHAR(20) DEFAULT '',
                icms_padrao DECIMAL(10,2) DEFAULT 0,
                regime_tributario VARCHAR(30) DEFAULT 'simples',
                uf_origem VARCHAR(5) DEFAULT 'SP',
                exibir_moeda TINYINT(1) DEFAULT 1,
                exibir_margem TINYINT(1) DEFAULT 1,
                alerta_margem_min DECIMAL(10,2) DEFAULT 10,
                alerta_preco_custo VARCHAR(20) DEFAULT 'aviso',
                notif_email TINYINT(1) DEFAULT 0,
                notif_sistema TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);

            const [existing] = await pool.query('SELECT id FROM configuracoes_custos_precificacao LIMIT 1');
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_custos_precificacao SET
                        metodo_precificacao = ?, margem_padrao = ?, preco_venda_padrao = ?,
                        custo_unitario_padrao = ?, incluir_frete = ?, incluir_impostos = ?,
                        custo_mao_obra = ?, custos_indiretos = ?, casas_decimais = ?,
                        arredondamento = ?, ncm_padrao = ?, icms_padrao = ?,
                        regime_tributario = ?, uf_origem = ?, exibir_moeda = ?,
                        exibir_margem = ?, alerta_margem_min = ?, alerta_preco_custo = ?,
                        notif_email = ?, notif_sistema = ?
                    WHERE id = ?
                `, [metodo_precificacao || 'markup', margem_padrao || 30, preco_venda_padrao || 0,
                    custo_unitario_padrao || 0, incluir_frete || 'sim', incluir_impostos || 'nao',
                    custo_mao_obra || 15, custos_indiretos || 10, casas_decimais || 2,
                    arredondamento || 'matematico', ncm_padrao || '', icms_padrao || 0,
                    regime_tributario || 'simples', uf_origem || 'SP', exibir_moeda ? 1 : 0,
                    exibir_margem ? 1 : 0, alerta_margem_min || 10, alerta_preco_custo || 'aviso',
                    notif_email ? 1 : 0, notif_sistema ? 1 : 0, existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_custos_precificacao 
                    (metodo_precificacao, margem_padrao, preco_venda_padrao, custo_unitario_padrao,
                     incluir_frete, incluir_impostos, custo_mao_obra, custos_indiretos,
                     casas_decimais, arredondamento, ncm_padrao, icms_padrao,
                     regime_tributario, uf_origem, exibir_moeda, exibir_margem,
                     alerta_margem_min, alerta_preco_custo, notif_email, notif_sistema)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [metodo_precificacao || 'markup', margem_padrao || 30, preco_venda_padrao || 0,
                    custo_unitario_padrao || 0, incluir_frete || 'sim', incluir_impostos || 'nao',
                    custo_mao_obra || 15, custos_indiretos || 10, casas_decimais || 2,
                    arredondamento || 'matematico', ncm_padrao || '', icms_padrao || 0,
                    regime_tributario || 'simples', uf_origem || 'SP', exibir_moeda ? 1 : 0,
                    exibir_margem ? 1 : 0, alerta_margem_min || 10, alerta_preco_custo || 'aviso',
                    notif_email ? 1 : 0, notif_sistema ? 1 : 0]);
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config custos/precificação:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // GRUPOS DE CLIENTES - CRUD
    // ========================================
    router.get('/api/clientes/grupos', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS grupos_clientes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                desconto DECIMAL(5,2) DEFAULT 0,
                prazo_padrao INT DEFAULT 0,
                descricao TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [grupos] = await pool.query(`
                SELECT gc.*, 
                    (SELECT COUNT(*) FROM clientes c WHERE c.grupo_id = gc.id) as total_clientes
                FROM grupos_clientes gc
                ORDER BY gc.nome
            `);
            res.json({ data: grupos });
        } catch (error) {
            console.error('Erro ao buscar grupos de clientes:', error);
            try {
                const [grupos] = await pool.query('SELECT *, 0 as total_clientes FROM grupos_clientes ORDER BY nome');
                res.json({ data: grupos });
            } catch(e2) {
                res.status(500).json({ error: e2.message });
            }
        }
    });

    router.post('/api/clientes/grupos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, desconto, prazo_padrao, descricao } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const [result] = await pool.query(
                'INSERT INTO grupos_clientes (nome, desconto, prazo_padrao, descricao) VALUES (?, ?, ?, ?)',
                [nome, desconto || 0, prazo_padrao || 0, descricao || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar grupo de clientes:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/clientes/grupos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, desconto, prazo_padrao, descricao } = req.body;
            await pool.query(
                'UPDATE grupos_clientes SET nome = ?, desconto = ?, prazo_padrao = ?, descricao = ? WHERE id = ?',
                [nome, desconto || 0, prazo_padrao || 0, descricao || null, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar grupo:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/clientes/grupos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM grupos_clientes WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir grupo:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // TIPOS DE FORNECEDOR - CRUD
    // ========================================
    router.get('/api/fornecedores/tipos', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS tipos_fornecedor (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                descricao TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [tipos] = await pool.query(`
                SELECT tf.*, 
                    (SELECT COUNT(*) FROM fornecedores f WHERE f.tipo_id = tf.id) as total_fornecedores
                FROM tipos_fornecedor tf
                ORDER BY tf.nome
            `);
            res.json({ data: tipos });
        } catch (error) {
            console.error('Erro ao buscar tipos de fornecedor:', error);
            try {
                const [tipos] = await pool.query('SELECT *, 0 as total_fornecedores FROM tipos_fornecedor ORDER BY nome');
                res.json({ data: tipos });
            } catch(e2) {
                res.status(500).json({ error: e2.message });
            }
        }
    });

    router.post('/api/fornecedores/tipos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const [result] = await pool.query(
                'INSERT INTO tipos_fornecedor (nome, descricao) VALUES (?, ?)',
                [nome, descricao || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar tipo de fornecedor:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/fornecedores/tipos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao } = req.body;
            await pool.query(
                'UPDATE tipos_fornecedor SET nome = ?, descricao = ? WHERE id = ?',
                [nome, descricao || null, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar tipo de fornecedor:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/fornecedores/tipos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM tipos_fornecedor WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir tipo de fornecedor:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // TIPOS DE SERVIÇO - CRUD
    // ========================================
    router.get('/api/servicos/tipos', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS tipos_servico (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                codigo_lc VARCHAR(20) DEFAULT '',
                iss DECIMAL(5,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [tipos] = await pool.query('SELECT * FROM tipos_servico ORDER BY nome');
            res.json({ data: tipos });
        } catch (error) {
            console.error('Erro ao buscar tipos de serviço:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/servicos/tipos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, codigo_lc, iss } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const [result] = await pool.query(
                'INSERT INTO tipos_servico (nome, codigo_lc, iss) VALUES (?, ?, ?)',
                [nome, codigo_lc || '', iss || 0]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar tipo de serviço:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/servicos/tipos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, codigo_lc, iss } = req.body;
            await pool.query(
                'UPDATE tipos_servico SET nome = ?, codigo_lc = ?, iss = ? WHERE id = ?',
                [nome, codigo_lc || '', iss || 0, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar tipo de serviço:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/servicos/tipos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM tipos_servico WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir tipo de serviço:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ========================================
    // MODELOS DE CONTRATO - CRUD
    // ========================================
    router.get('/api/servicos/contratos/modelos', authenticateToken, async (req, res) => {
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS modelos_contrato (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(200) NOT NULL,
                tipo VARCHAR(50) DEFAULT 'servico',
                descricao TEXT,
                conteudo LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            const [modelos] = await pool.query('SELECT * FROM modelos_contrato ORDER BY nome');
            res.json({ data: modelos });
        } catch (error) {
            console.error('Erro ao buscar modelos de contrato:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/servicos/contratos/modelos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, tipo, descricao, conteudo } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const [result] = await pool.query(
                'INSERT INTO modelos_contrato (nome, tipo, descricao, conteudo) VALUES (?, ?, ?, ?)',
                [nome, tipo || 'servico', descricao || null, conteudo || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar modelo de contrato:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/servicos/contratos/modelos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, tipo, descricao, conteudo } = req.body;
            await pool.query(
                'UPDATE modelos_contrato SET nome = ?, tipo = ?, descricao = ?, conteudo = ? WHERE id = ?',
                [nome, tipo || 'servico', descricao || null, conteudo || null, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar modelo de contrato:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/servicos/contratos/modelos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM modelos_contrato WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir modelo de contrato:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================

    // GET /api/configuracoes/impostos - Buscar configurações de impostos do sistema
    router.get('/api/configuracoes/impostos', authenticateToken, async (req, res) => {
        try {
            // Garantir que as colunas extras existam
            try {
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN regime_tributario VARCHAR(50) DEFAULT 'simples'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_venda_interna VARCHAR(10) DEFAULT '5102'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_venda_externa VARCHAR(10) DEFAULT '6102'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_devolucao_interna VARCHAR(10) DEFAULT '5202'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_devolucao_externa VARCHAR(10) DEFAULT '6202'`);
            } catch (e) { /* colunas já existem */ }

            const [rows] = await pool.query('SELECT * FROM configuracoes_impostos LIMIT 1');

            if (rows && rows.length > 0) {
                res.json(rows[0]);
            } else {
                // Inserir valores padrão
                await pool.query(`
                    INSERT INTO configuracoes_impostos (icms, ipi, pis, cofins, iss)
                    VALUES (18.00, 5.00, 1.65, 7.60, 5.00)
                `);

                res.json({
                    icms: 18.00,
                    ipi: 5.00,
                    pis: 1.65,
                    cofins: 7.60,
                    iss: 5.00,
                    csll: 9.00,
                    irpj: 15.00,
                    icms_st: 0.00,
                    mva: 0.00
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config impostos:', error);
            // Retornar valores padrão em caso de erro
            res.json({
                icms: 18.00,
                ipi: 5.00,
                pis: 1.65,
                cofins: 7.60,
                iss: 5.00
            });
        }
    });

    // POST /api/configuracoes/impostos - Salvar configurações de impostos
    router.post('/api/configuracoes/impostos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { icms, ipi, pis, cofins, iss, csll, irpj, icms_st, mva,
                    regime_tributario, cfop_venda_interna, cfop_venda_externa,
                    cfop_devolucao_interna, cfop_devolucao_externa } = req.body;

            // Garantir que as colunas extras existam
            try {
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN regime_tributario VARCHAR(50) DEFAULT 'simples'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_venda_interna VARCHAR(10) DEFAULT '5102'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_venda_externa VARCHAR(10) DEFAULT '6102'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_devolucao_interna VARCHAR(10) DEFAULT '5202'`);
                await pool.query(`ALTER TABLE configuracoes_impostos ADD COLUMN cfop_devolucao_externa VARCHAR(10) DEFAULT '6202'`);
            } catch (e) { /* colunas já existem */ }

            const [existing] = await pool.query('SELECT id FROM configuracoes_impostos LIMIT 1');

            if (existing && existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_impostos
                    SET icms = ?, ipi = ?, pis = ?, cofins = ?, iss = ?,
                        csll = ?, irpj = ?, icms_st = ?, mva = ?,
                        regime_tributario = ?, cfop_venda_interna = ?, cfop_venda_externa = ?,
                        cfop_devolucao_interna = ?, cfop_devolucao_externa = ?
                    WHERE id = ?
                `, [icms || 18, ipi || 5, pis || 1.65, cofins || 7.6, iss || 5,
                    csll || 9, irpj || 15, icms_st || 0, mva || 0,
                    regime_tributario || 'simples', cfop_venda_interna || '5102', cfop_venda_externa || '6102',
                    cfop_devolucao_interna || '5202', cfop_devolucao_externa || '6202',
                    existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_impostos (icms, ipi, pis, cofins, iss, csll, irpj, icms_st, mva,
                        regime_tributario, cfop_venda_interna, cfop_venda_externa, cfop_devolucao_interna, cfop_devolucao_externa)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [icms || 18, ipi || 5, pis || 1.65, cofins || 7.6, iss || 5,
                    csll || 9, irpj || 15, icms_st || 0, mva || 0,
                    regime_tributario || 'simples', cfop_venda_interna || '5102', cfop_venda_externa || '6102',
                    cfop_devolucao_interna || '5202', cfop_devolucao_externa || '6202']);
            }

            res.json({ success: true, message: 'Configurações de impostos salvas' });
        } catch (error) {
            console.error('Erro ao salvar config impostos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // REGIÕES DE VENDA
    // =========================

    router.get('/api/vendas/regioes', authenticateToken, async (req, res) => {
        try {
            const [regioes] = await pool.query(`
                SELECT r.*, 
                    (SELECT COUNT(*) FROM clientes c WHERE c.regiao_id = r.id) as total_clientes,
                    v.nome as vendedor_responsavel
                FROM regioes_venda r
                LEFT JOIN vendedores v ON r.vendedor_id = v.id
                ORDER BY r.nome
            `);
            res.json({ data: regioes });
        } catch (error) {
            console.error('Erro ao buscar regiões:', error);
            // Fallback se a coluna regiao_id não existir em clientes
            try {
                const [regioes] = await pool.query('SELECT * FROM regioes_venda ORDER BY nome');
                res.json({ data: regioes.map(r => ({...r, total_clientes: 0})) });
            } catch(e2) {
                res.status(500).json({ error: e2.message });
            }
        }
    });

    router.post('/api/vendas/regioes', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, estados, descricao, vendedor_id } = req.body;
            const [result] = await pool.query(
                'INSERT INTO regioes_venda (nome, estados, descricao, vendedor_id) VALUES (?, ?, ?, ?)',
                [nome, estados || null, descricao || null, vendedor_id || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar região:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/vendas/regioes/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, estados, descricao, vendedor_id } = req.body;
            await pool.query(
                'UPDATE regioes_venda SET nome = ?, estados = ?, descricao = ?, vendedor_id = ? WHERE id = ?',
                [nome, estados || null, descricao || null, vendedor_id || null, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar região:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/vendas/regioes/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM regioes_venda WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir região:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // CONDIÇÕES DE PAGAMENTO
    // =========================

    router.get('/api/configuracoes/condicoes-pagamento', authenticateToken, async (req, res) => {
        try {
            // Garantir colunas extras
            try {
                await pool.query(`ALTER TABLE condicoes_pagamento ADD COLUMN parcelas INT DEFAULT 1`);
                await pool.query(`ALTER TABLE condicoes_pagamento ADD COLUMN acrescimo DECIMAL(5,2) DEFAULT 0`);
            } catch (e) { /* colunas já existem */ }

            const [condicoes] = await pool.query('SELECT *, COALESCE(dias, 0) as prazo FROM condicoes_pagamento ORDER BY nome');
            res.json({ data: condicoes });
        } catch (error) {
            console.error('Erro ao buscar condições:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/configuracoes/condicoes-pagamento', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, parcelas, prazo, acrescimo, descricao } = req.body;

            // Garantir colunas extras
            try {
                await pool.query(`ALTER TABLE condicoes_pagamento ADD COLUMN parcelas INT DEFAULT 1`);
                await pool.query(`ALTER TABLE condicoes_pagamento ADD COLUMN acrescimo DECIMAL(5,2) DEFAULT 0`);
            } catch (e) { /* colunas já existem */ }

            const [result] = await pool.query(
                'INSERT INTO condicoes_pagamento (nome, parcelas, dias, acrescimo, descricao) VALUES (?, ?, ?, ?, ?)',
                [nome, parcelas || 1, prazo || null, acrescimo || 0, descricao || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar condição:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/configuracoes/condicoes-pagamento/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            // O front envia "dias" (ex.: "21,28,35"); versoes antigas enviavam "prazo".
            // Fazemos merge com a linha atual para nao zerar campos que nao vieram no body.
            const { nome, parcelas, prazo, dias, acrescimo, descricao } = req.body;
            const [[atual]] = await pool.query('SELECT * FROM condicoes_pagamento WHERE id = ?', [req.params.id]);
            if (!atual) return res.status(404).json({ success: false, error: 'Condição não encontrada' });

            const diasFinal = (dias !== undefined && dias !== null && String(dias).trim() !== '')
                ? String(dias).trim()
                : (prazo !== undefined && prazo !== null && String(prazo).trim() !== '' ? String(prazo).trim() : atual.dias);

            let parcelasFinal = parcelas;
            if (parcelasFinal === undefined || parcelasFinal === null || parcelasFinal === '') {
                const qtd = String(diasFinal || '').split(/[/,;]/).map(s => s.trim()).filter(Boolean).length;
                parcelasFinal = qtd > 0 ? qtd : (atual.parcelas || 1);
            }

            const acrescimoFinal = (acrescimo !== undefined && acrescimo !== null && acrescimo !== '')
                ? acrescimo : (atual.acrescimo || 0);
            const nomeFinal = (nome !== undefined && nome !== null && String(nome).trim() !== '') ? nome : atual.nome;
            const descricaoFinal = descricao !== undefined ? descricao : atual.descricao;

            await pool.query(
                'UPDATE condicoes_pagamento SET nome = ?, parcelas = ?, dias = ?, acrescimo = ?, descricao = ? WHERE id = ?',
                [nomeFinal, parcelasFinal, diasFinal, acrescimoFinal, descricaoFinal, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar condição:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/condicoes-pagamento/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM condicoes_pagamento WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir condição:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // TABELAS DE PREÇO
    // =========================

    router.get('/api/produtos/tabelas-preco', authenticateToken, async (req, res) => {
        try {
            const [tabelas] = await pool.query(`
                SELECT t.*,
                    (SELECT COUNT(*) FROM produtos_tabela_preco pt WHERE pt.tabela_id = t.id) as total_produtos
                FROM tabelas_preco t
                ORDER BY t.nome
            `);
            res.json({ data: tabelas });
        } catch (error) {
            // Fallback if join table doesn't exist
            try {
                const [tabelas] = await pool.query('SELECT *, 0 as total_produtos FROM tabelas_preco ORDER BY nome');
                res.json({ data: tabelas });
            } catch(e2) {
                console.error('Erro ao buscar tabelas de preço:', e2);
                res.status(500).json({ error: e2.message });
            }
        }
    });

    router.post('/api/produtos/tabelas-preco', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, tipo, validade, descricao, status } = req.body;
            const [result] = await pool.query(
                'INSERT INTO tabelas_preco (nome, tipo, validade, descricao, status) VALUES (?, ?, ?, ?, ?)',
                [nome, tipo || 'padrao', validade || null, descricao || null, status || 'ativo']
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar tabela de preço:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/produtos/tabelas-preco/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, tipo, validade, descricao, status } = req.body;
            await pool.query(
                'UPDATE tabelas_preco SET nome = ?, tipo = ?, validade = ?, descricao = ?, status = ? WHERE id = ?',
                [nome, tipo || 'padrao', validade || null, descricao || null, status || 'ativo', req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar tabela de preço:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/produtos/tabelas-preco/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM tabelas_preco WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir tabela de preço:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // UNIDADES DE MEDIDA
    // =========================

    router.get('/api/produtos/unidades-medida', authenticateToken, async (req, res) => {
        try {
            const [unidades] = await pool.query('SELECT * FROM unidades_medida ORDER BY nome');
            res.json({ data: unidades });
        } catch (error) {
            console.error('Erro ao buscar unidades de medida:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/produtos/unidades-medida', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { sigla, nome, tipo } = req.body;
            const [result] = await pool.query(
                'INSERT INTO unidades_medida (sigla, nome, tipo) VALUES (?, ?, ?)',
                [sigla, nome, tipo || 'quantidade']
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar unidade de medida:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/produtos/unidades-medida/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { sigla, nome, tipo } = req.body;
            await pool.query(
                'UPDATE unidades_medida SET sigla = ?, nome = ?, tipo = ? WHERE id = ?',
                [sigla, nome, tipo || 'quantidade', req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar unidade de medida:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/produtos/unidades-medida/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM unidades_medida WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir unidade de medida:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // CÓDIGOS NCM
    // =========================

    router.get('/api/produtos/ncm', authenticateToken, async (req, res) => {
        try {
            const [ncms] = await pool.query('SELECT * FROM ncm_codigos ORDER BY codigo LIMIT 500');
            res.json({ data: ncms });
        } catch (error) {
            console.error('Erro ao buscar NCMs:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/produtos/ncm', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { codigo, descricao, aliquota_ipi } = req.body;
            const [result] = await pool.query(
                'INSERT INTO ncm_codigos (codigo, descricao, aliquota_ipi) VALUES (?, ?, ?)',
                [codigo, descricao || null, aliquota_ipi || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar NCM:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // SLA DE ATENDIMENTO
    // =========================

    router.get('/api/servicos/sla', authenticateToken, async (req, res) => {
        try {
            const [slas] = await pool.query('SELECT * FROM sla_atendimento ORDER BY nome');
            res.json({ data: slas });
        } catch (error) {
            console.error('Erro ao buscar SLAs:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/servicos/sla', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, prioridade, tempo_resposta, tempo_resolucao, descricao } = req.body;
            const [result] = await pool.query(
                'INSERT INTO sla_atendimento (nome, prioridade, tempo_resposta, tempo_resolucao, descricao) VALUES (?, ?, ?, ?, ?)',
                [nome, prioridade || 'media', tempo_resposta || 24, tempo_resolucao || 48, descricao || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar SLA:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/servicos/sla/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, prioridade, tempo_resposta, tempo_resolucao, descricao, status } = req.body;
            await pool.query(
                'UPDATE sla_atendimento SET nome = ?, prioridade = ?, tempo_resposta = ?, tempo_resolucao = ?, descricao = ?, status = ? WHERE id = ?',
                [nome, prioridade || 'media', tempo_resposta || 24, tempo_resolucao || 48, descricao || null, status || 'ativo', req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar SLA:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/servicos/sla/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM sla_atendimento WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir SLA:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // FAMÍLIAS DE PRODUTOS
    // =========================

    // Alias route: /api/configuracoes/familias -> familias-produtos (compatibility)
    router.get('/api/configuracoes/familias', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM familias_produtos');
            const [familias] = await pool.query('SELECT id, nome, descricao, ativo, created_at, created_at as updated_at FROM familias_produtos ORDER BY nome LIMIT ? OFFSET ?', [limit, offset]);
            res.json({ data: familias, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar famílias:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/api/configuracoes/familias-produtos', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM familias_produtos');
            const [familias] = await pool.query('SELECT id, nome, descricao, ativo, created_at, created_at as updated_at FROM familias_produtos ORDER BY nome LIMIT ? OFFSET ?', [limit, offset]);
            res.json({ data: familias, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar famílias:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/configuracoes/familias-produtos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao } = req.body;
            const [result] = await pool.query(
                'INSERT INTO familias_produtos (nome, descricao) VALUES (?, ?)',
                [nome, descricao || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/configuracoes/familias', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao } = req.body;
            const [result] = await pool.query(
                'INSERT INTO familias_produtos (nome, descricao) VALUES (?, ?)',
                [nome, descricao || null]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/configuracoes/familias/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao } = req.body;
            await pool.query('UPDATE familias_produtos SET nome = ?, descricao = ? WHERE id = ?', [nome, descricao || null, req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/familias-produtos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM familias_produtos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/familias/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM familias_produtos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // CARACTERÍSTICAS DE PRODUTOS
    // =========================

    router.get('/api/configuracoes/caracteristicas-produtos', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM caracteristicas_produtos');
            const [caracteristicas] = await pool.query('SELECT id, nome, conteudos_possiveis, visualizar_em, preenchimento, created_at, updated_at FROM caracteristicas_produtos ORDER BY nome LIMIT ? OFFSET ?', [limit, offset]);
            res.json({ data: caracteristicas, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar características:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Alias route for compatibility
    router.get('/api/configuracoes/caracteristicas', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM caracteristicas_produtos');
            const [caracteristicas] = await pool.query('SELECT id, nome, conteudos_possiveis, visualizar_em, preenchimento, created_at, updated_at FROM caracteristicas_produtos ORDER BY nome LIMIT ? OFFSET ?', [limit, offset]);
            res.json({ data: caracteristicas, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar características:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/configuracoes/caracteristicas-produtos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, conteudos_possiveis, visualizar_em, preenchimento } = req.body;
            const [result] = await pool.query(
                'INSERT INTO caracteristicas_produtos (nome, conteudos_possiveis, visualizar_em, preenchimento) VALUES (?, ?, ?, ?)',
                [nome, conteudos_possiveis, visualizar_em, preenchimento]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/configuracoes/caracteristicas', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, conteudos_possiveis, visualizar_em, preenchimento } = req.body;
            const [result] = await pool.query(
                'INSERT INTO caracteristicas_produtos (nome, conteudos_possiveis, visualizar_em, preenchimento) VALUES (?, ?, ?, ?)',
                [nome, conteudos_possiveis, visualizar_em, preenchimento]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.put('/api/configuracoes/caracteristicas/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, conteudos_possiveis, visualizar_em, preenchimento } = req.body;
            await pool.query(
                'UPDATE caracteristicas_produtos SET nome = ?, conteudos_possiveis = ?, visualizar_em = ?, preenchimento = ? WHERE id = ?',
                [nome, conteudos_possiveis, visualizar_em, preenchimento, req.params.id]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/caracteristicas-produtos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM caracteristicas_produtos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/caracteristicas/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM caracteristicas_produtos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =========================
    // VENDEDORES
    // =========================

    router.get('/api/configuracoes/vendedores', authenticateToken, async (req, res) => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS vendedores (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    nome VARCHAR(255) NOT NULL,
                    email VARCHAR(255),
                    comissao DECIMAL(5,2) DEFAULT 0,
                    permissoes TEXT,
                    situacao ENUM('ativo', 'inativo') DEFAULT 'ativo',
                    usuario_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);

            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM vendedores');
            const [vendedores] = await pool.query(`
                SELECT
                    id,
                    nome,
                    email,
                    comissao,
                    COALESCE(permissoes, 'vendas') as permissoes,
                    situacao,
                    usuario_id,
                    created_at as inclusao,
                    updated_at as ultima_alteracao
                FROM vendedores
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);
            res.json({ data: vendedores, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar vendedores:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/configuracoes/vendedores', authenticateToken, authorizeAdmin, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { nome, email, comissao, permissoes, situacao } = req.body;

            // Criar usuário no sistema com acesso ao módulo de vendas
            // AUDIT-FIX HIGH-010: Use crypto.randomBytes instead of Math.random for temp password
            const senhaTemp = require('crypto').randomBytes(12).toString('base64url').slice(0, 12);
            const senhaHash = await bcrypt.hash(senhaTemp, 12);

            const [usuario] = await connection.query(
                'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES (?, ?, ?, ?)',
                [nome, email, senhaHash, 'vendedor']
            );

            // Dar permissão ao módulo de vendas
            await connection.query(
                'INSERT INTO permissoes_modulos (usuario_id, modulo) VALUES (?, ?)',
                [usuario.insertId, 'vendas']
            );

            // Criar registro de vendedor
            const [result] = await connection.query(
                'INSERT INTO vendedores (nome, email, comissao, permissoes, situacao, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
                [nome, email, comissao, permissoes, situacao, usuario.insertId]
            );

            await connection.commit();
            res.json({ success: true, id: result.insertId, senhaTemp });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao criar vendedor:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            connection.release();
        }
    });

    router.put('/api/configuracoes/vendedores/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, email, comissao, permissoes, situacao, telefone } = req.body;
            const fields = [];
            const values = [];
            if (nome !== undefined) { fields.push('nome = ?'); values.push(nome); }
            if (email !== undefined) { fields.push('email = ?'); values.push(email); }
            if (comissao !== undefined) { fields.push('comissao = ?'); values.push(comissao); }
            if (permissoes !== undefined) { fields.push('permissoes = ?'); values.push(permissoes); }
            if (situacao !== undefined) { fields.push('situacao = ?'); values.push(situacao); }
            if (telefone !== undefined) { fields.push('telefone = ?'); values.push(telefone); }
            
            if (fields.length === 0) return res.json({ success: true });
            
            values.push(req.params.id);
            await pool.query(`UPDATE vendedores SET ${fields.join(', ')} WHERE id = ?`, values);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar vendedor:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/vendedores/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Buscar usuario_id do vendedor
            const [vendedor] = await connection.query('SELECT usuario_id FROM vendedores WHERE id = ?', [req.params.id]);

            if (vendedor.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, error: 'Vendedor não encontrado' });
            }

            // Verificar se vendedor tem pedidos vinculados
            const [pedidos] = await connection.query('SELECT COUNT(*) as count FROM pedidos WHERE vendedor_id = ?', [req.params.id]);
            if (pedidos[0].count > 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: `Vendedor possui ${pedidos[0].count} pedido(s) vinculado(s). Inative-o em vez de excluir.`
                });
            }

            if (vendedor[0].usuario_id) {
                // Remover permissões
                await connection.query('DELETE FROM permissoes_modulos WHERE usuario_id = ?', [vendedor[0].usuario_id]);
                // Remover usuário
                await connection.query('DELETE FROM usuarios WHERE id = ?', [vendedor[0].usuario_id]);
            }

            // Remover vendedor
            await connection.query('DELETE FROM vendedores WHERE id = ?', [req.params.id]);

            await connection.commit();
            res.json({ success: true });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao excluir vendedor:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            connection.release();
        }
    });

    // =========================
    // COMPRADORES
    // =========================

    router.get('/api/configuracoes/compradores', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM compradores');
            const [compradores] = await pool.query(`
                SELECT
                    id, nome, email, telefone, departamento,
                    limite_aprovacao, situacao, observacoes, foto_url,
                    COALESCE(incluido_por, 'Sistema') as incluido_por,
                    created_at as inclusao,
                    updated_at as ultima_alteracao
                FROM compradores
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);
            res.json({ data: compradores, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar compradores:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api/configuracoes/compradores', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, email, telefone, departamento, limite_aprovacao, situacao, observacoes, foto_url } = req.body;
            const incluido_por = req.body.incluido_por || (req.user ? req.user.nome : 'Sistema');
            const [result] = await pool.query(
                `INSERT INTO compradores (nome, email, telefone, departamento, limite_aprovacao, situacao, observacoes, foto_url, incluido_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [nome, email || null, telefone || null, departamento || null, limite_aprovacao || 0, situacao || 'ativo', observacoes || null, foto_url || null, incluido_por]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar comprador:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // PUT - Atualizar comprador
    router.put('/api/configuracoes/compradores/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, email, telefone, departamento, limite_aprovacao, situacao, observacoes, foto_url } = req.body;
            const fields = [];
            const values = [];

            if (nome !== undefined) { fields.push('nome = ?'); values.push(nome); }
            if (email !== undefined) { fields.push('email = ?'); values.push(email || null); }
            if (telefone !== undefined) { fields.push('telefone = ?'); values.push(telefone || null); }
            if (departamento !== undefined) { fields.push('departamento = ?'); values.push(departamento || null); }
            if (limite_aprovacao !== undefined) { fields.push('limite_aprovacao = ?'); values.push(limite_aprovacao || 0); }
            if (situacao !== undefined) { fields.push('situacao = ?'); values.push(situacao); }
            if (observacoes !== undefined) { fields.push('observacoes = ?'); values.push(observacoes || null); }
            if (foto_url !== undefined) { fields.push('foto_url = ?'); values.push(foto_url || null); }

            if (fields.length === 0) {
                return res.status(400).json({ success: false, error: 'Nenhum campo para atualizar' });
            }

            values.push(id);
            await pool.query(`UPDATE compradores SET ${fields.join(', ')} WHERE id = ?`, values);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao atualizar comprador:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/configuracoes/compradores/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM compradores WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir comprador:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // =================================================================
    // ROTAS ADICIONAIS DE CONFIGURAÇÓES
    // =================================================================

    // GET - Listar categorias
    router.get('/api/configuracoes/categorias', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando categorias...');

            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM categorias WHERE ativo = 1');
            const [categorias] = await pool.query(`
                SELECT id, nome, descricao, created_at, updated_at
                FROM categorias
                WHERE ativo = 1
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            res.json({ data: categorias, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao buscar categorias:', error);
            res.status(500).json({ error: 'Erro ao buscar categorias' });
        }
    });

    // POST - Criar categoria
    router.post('/api/configuracoes/categorias', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Criando categoria...');

            const { nome, descricao, cor } = req.body;

            const [result] = await pool.query(`
                INSERT INTO categorias (nome, descricao, cor, ativo, created_at, updated_at)
                VALUES (?, ?, ?, 1, NOW(), NOW())
            `, [nome, descricao, cor || '#6366f1']);

            console.log('✅ Categoria criada com sucesso');
            res.json({ success: true, id: result.insertId });

        } catch (error) {
            console.error('❌ Erro ao criar categoria:', error);
            res.status(500).json({ error: 'Erro ao criar categoria' });
        }
    });

    // DELETE - Excluir categoria
    router.delete('/api/configuracoes/categorias/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Excluindo categoria...');

            const { id } = req.params;

            await pool.query(`
                UPDATE categorias SET ativo = 0, updated_at = NOW() WHERE id = ?
            `, [id]);

            console.log('✅ Categoria excluída com sucesso');
            res.json({ success: true });

        } catch (error) {
            console.error('❌ Erro ao excluir categoria:', error);
            res.status(500).json({ error: 'Erro ao excluir categoria' });
        }
    });

    // GET - Buscar categoria por ID
    router.get('/api/configuracoes/categorias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [categorias] = await pool.query(`
                SELECT id, nome, descricao, cor FROM categorias WHERE id = ? AND ativo = 1
            `, [id]);

            if (categorias.length === 0) {
                return res.status(404).json({ error: 'Categoria não encontrada' });
            }

            res.json(categorias[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar categoria:', error);
            res.status(500).json({ error: 'Erro ao buscar categoria' });
        }
    });

    // PUT - Atualizar categoria
    router.put('/api/configuracoes/categorias/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, descricao, cor } = req.body;

            await pool.query(`
                UPDATE categorias SET nome = ?, descricao = ?, cor = ?, updated_at = NOW() WHERE id = ?
            `, [nome, descricao, cor, id]);

            console.log('✅ Categoria atualizada com sucesso');
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Erro ao atualizar categoria:', error);
            res.status(500).json({ error: 'Erro ao atualizar categoria' });
        }
    });

    // GET - Listar departamentos
    router.get('/api/configuracoes/departamentos', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando departamentos...');

            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM departamentos WHERE ativo = 1');
            const [departamentos] = await pool.query(`
                SELECT id, nome, descricao, created_at, updated_at
                FROM departamentos
                WHERE ativo = 1
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            res.json({ data: departamentos, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao buscar departamentos:', error);
            res.status(500).json({ error: 'Erro ao buscar departamentos' });
        }
    });

    // POST - Criar departamento
    router.post('/api/configuracoes/departamentos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Criando departamento...');

            const { nome, descricao, responsavel } = req.body;

            const [result] = await pool.query(`
                INSERT INTO departamentos (nome, descricao, responsavel, ativo, created_at, updated_at)
                VALUES (?, ?, ?, 1, NOW(), NOW())
            `, [nome, descricao, responsavel || null]);

            console.log('✅ Departamento criado com sucesso');
            res.json({ success: true, id: result.insertId });

        } catch (error) {
            console.error('❌ Erro ao criar departamento:', error);
            res.status(500).json({ error: 'Erro ao criar departamento' });
        }
    });

    // DELETE - Excluir departamento
    router.delete('/api/configuracoes/departamentos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Excluindo departamento...');

            const { id } = req.params;

            await pool.query(`
                UPDATE departamentos SET ativo = 0, updated_at = NOW() WHERE id = ?
            `, [id]);

            console.log('✅ Departamento excluído com sucesso');
            res.json({ success: true });

        } catch (error) {
            console.error('❌ Erro ao excluir departamento:', error);
            res.status(500).json({ error: 'Erro ao excluir departamento' });
        }
    });

    // GET - Buscar departamento por ID
    router.get('/api/configuracoes/departamentos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [departamentos] = await pool.query(`
                SELECT id, nome, descricao, responsavel FROM departamentos WHERE id = ? AND ativo = 1
            `, [id]);

            if (departamentos.length === 0) {
                return res.status(404).json({ error: 'Departamento não encontrado' });
            }

            res.json(departamentos[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar departamento:', error);
            res.status(500).json({ error: 'Erro ao buscar departamento' });
        }
    });

    // PUT - Atualizar departamento
    router.put('/api/configuracoes/departamentos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, descricao, responsavel } = req.body;

            await pool.query(`
                UPDATE departamentos SET nome = ?, descricao = ?, responsavel = ?, updated_at = NOW() WHERE id = ?
            `, [nome, descricao, responsavel, id]);

            console.log('✅ Departamento atualizado com sucesso');
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Erro ao atualizar departamento:', error);
            res.status(500).json({ error: 'Erro ao atualizar departamento' });
        }
    });

    // GET - Listar projetos
    router.get('/api/configuracoes/projetos', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando projetos...');

            const [projetos] = await pool.query(`
                SELECT id, nome, descricao, created_at, updated_at
                FROM projetos
                WHERE ativo = 1
                ORDER BY nome
            `);

            res.json(projetos);
        } catch (error) {
            console.error('❌ Erro ao buscar projetos:', error);
            res.status(500).json({ error: 'Erro ao buscar projetos' });
        }
    });

    // POST - Criar projeto
    router.post('/api/configuracoes/projetos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Criando projeto...');

            const { nome, descricao, data_inicio, data_fim, status } = req.body;

            // Mapear status do frontend para o ENUM do banco
            const statusMap = {
                'ativo': 'em_andamento',
                'pausado': 'pausado',
                'concluido': 'concluido',
                'cancelado': 'cancelado'
            };
            const dbStatus = statusMap[status] || 'em_andamento';

            const [result] = await pool.query(`
                INSERT INTO projetos (nome, descricao, data_inicio, data_previsao_fim, status, ativo, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
            `, [nome, descricao, data_inicio || null, data_fim || null, dbStatus]);

            console.log('✅ Projeto criado com sucesso');
            res.json({ success: true, id: result.insertId });

        } catch (error) {
            console.error('❌ Erro ao criar projeto:', error);
            res.status(500).json({ error: 'Erro ao criar projeto' });
        }
    });

    // DELETE - Excluir projeto
    router.delete('/api/configuracoes/projetos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Excluindo projeto...');

            const { id } = req.params;

            await pool.query(`
                UPDATE projetos SET ativo = 0, updated_at = NOW() WHERE id = ?
            `, [id]);

            console.log('✅ Projeto excluído com sucesso');
            res.json({ success: true });

        } catch (error) {
            console.error('❌ Erro ao excluir projeto:', error);
            res.status(500).json({ error: 'Erro ao excluir projeto' });
        }
    });

    // GET - Buscar projeto por ID
    router.get('/api/configuracoes/projetos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [projetos] = await pool.query(`
                SELECT id, nome, descricao, data_inicio, data_previsao_fim as data_fim, status FROM projetos WHERE id = ? AND ativo = 1
            `, [id]);

            if (projetos.length === 0) {
                return res.status(404).json({ error: 'Projeto não encontrado' });
            }

            res.json(projetos[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar projeto:', error);
            res.status(500).json({ error: 'Erro ao buscar projeto' });
        }
    });

    // PUT - Atualizar projeto
    router.put('/api/configuracoes/projetos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, descricao, data_inicio, data_fim, status } = req.body;

            // Mapear status do frontend para o ENUM do banco
            const statusMap = {
                'ativo': 'em_andamento',
                'pausado': 'pausado',
                'concluido': 'concluido',
                'cancelado': 'cancelado'
            };
            const dbStatus = statusMap[status] || 'em_andamento';

            await pool.query(`
                UPDATE projetos SET nome = ?, descricao = ?, data_inicio = ?, data_previsao_fim = ?, status = ?, updated_at = NOW() WHERE id = ?
            `, [nome, descricao, data_inicio || null, data_fim || null, dbStatus, id]);

            console.log('✅ Projeto atualizado com sucesso');
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Erro ao atualizar projeto:', error);
            res.status(500).json({ error: 'Erro ao atualizar projeto' });
        }
    });

    // GET - Buscar dados do certificado (integrado com módulo NFe)
    router.get('/api/configuracoes/certificado', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando certificado digital...');

            const empresaId = 1; // Empresa padrão

            // Primeiro tentar buscar da tabela nfe_configuracoes (mais completa)
            const [nfeConfig] = await pool.query(`
                SELECT certificado_validade as validade,
                       certificado_cnpj as cnpj,
                       certificado_nome as nome,
                       created_at,
                       updated_at,
                       CASE WHEN certificado_pfx IS NOT NULL THEN 1 ELSE 0 END as tem_certificado
                FROM nfe_configuracoes
                WHERE empresa_id = ?
                LIMIT 1
            `, [empresaId]);

            if (nfeConfig && nfeConfig.length > 0 && nfeConfig[0].tem_certificado) {
                const cert = nfeConfig[0];
                const diasRestantes = cert.validade ?
                    Math.ceil((new Date(cert.validade) - new Date()) / (1000 * 60 * 60 * 24)) : null;

                res.json({
                    configurado: true,
                    validade: cert.validade,
                    cnpj: cert.cnpj,
                    nome: cert.nome,
                    diasRestantes: diasRestantes,
                    status: diasRestantes > 30 ? 'valido' : diasRestantes > 0 ? 'expirando' : 'expirado',
                    created_at: cert.created_at,
                    updated_at: cert.updated_at
                });
                return;
            }

            // Fallback: buscar da tabela certificados_digitais
            const [rows] = await pool.query(`
                SELECT validade, created_at, updated_at
                FROM certificados_digitais
                ORDER BY id DESC LIMIT 1
            `);

            if (rows.length > 0) {
                res.json({
                    configurado: true,
                    ...rows[0]
                });
            } else {
                res.json({
                    configurado: false
                });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar certificado:', error);
            res.status(500).json({ error: 'Erro ao buscar certificado' });
        }
    });

    // POST - Salvar certificado digital (integrado com módulo NFe)
    router.post('/api/configuracoes/certificado', authenticateToken, authorizeAdmin, upload.single('certificado'), async (req, res) => {
        try {
            console.log('💾 Salvando certificado digital...');

            if (!req.file) {
                return res.status(400).json({ error: 'Arquivo de certificado não enviado' });
            }

            const { senha } = req.body;
            if (!senha) {
                return res.status(400).json({ error: 'Senha do certificado é obrigatória' });
            }

            const empresaId = 1; // Empresa padrão
            const pfxBuffer = req.file.buffer;

            // Validar certificado usando node-forge
            let certInfo = null;
            try {
                const forge = require('node-forge');
                const pfxBase64 = pfxBuffer.toString('base64');
                const pfxAsn1 = forge.util.decode64(pfxBase64);
                const p12Asn1 = forge.asn1.fromDer(pfxAsn1);
                const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

                const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
                if (certBags && certBags[forge.pki.oids.certBag] && certBags[forge.pki.oids.certBag].length > 0) {
                    const cert = certBags[forge.pki.oids.certBag][0].cert;

                    // Extrair informações
                    const cn = cert.subject.getField('CN');
                    const cnValue = cn ? cn.value : '';
                    const cnpjMatch = cnValue.match(/(\d{14})/);

                    certInfo = {
                        cnpj: cnpjMatch ? cnpjMatch[1] : '',
                        razaoSocial: cnValue.split(':')[0].trim(),
                        validade: cert.validity.notAfter,
                        emissao: cert.validity.notBefore
                    };

                    // Verificar se certificado está válido
                    const agora = new Date();
                    if (cert.validity.notAfter < agora) {
                        return res.status(400).json({ error: 'Certificado expirado' });
                    }
                }
            } catch (forgeError) {
                console.error('❌ Erro ao validar certificado:', forgeError.message);
                if (forgeError.message.includes('Invalid password')) {
                    return res.status(400).json({ error: 'Senha do certificado incorreta' });
                }
                return res.status(400).json({ error: 'Certificado inválido: ' + forgeError.message });
            }

            // Criptografar senha (base64 simples - em produção usar algo mais seguro)
            const senhaCriptografada = Buffer.from(senha).toString('base64');

            // Verificar se já existe configuração para a empresa na tabela nfe_configuracoes
            const [existing] = await pool.query(
                'SELECT id FROM nfe_configuracoes WHERE empresa_id = ?',
                [empresaId]
            );

            if (existing && existing.length > 0) {
                // Atualizar configuração existente
                await pool.query(`
                    UPDATE nfe_configuracoes
                    SET certificado_pfx = ?,
                        certificado_senha = ?,
                        certificado_validade = ?,
                        certificado_cnpj = ?,
                        certificado_nome = ?,
                        updated_at = NOW()
                    WHERE empresa_id = ?
                `, [
                    pfxBuffer,
                    senhaCriptografada,
                    certInfo ? certInfo.validade : null,
                    certInfo ? certInfo.cnpj : null,
                    certInfo ? certInfo.razaoSocial : req.file.originalname,
                    empresaId
                ]);
            } else {
                // Criar nova configuração
                await pool.query(`
                    INSERT INTO nfe_configuracoes
                    (empresa_id, certificado_pfx, certificado_senha, certificado_validade, certificado_cnpj, certificado_nome, ambiente, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'homologacao', NOW(), NOW())
                `, [
                    empresaId,
                    pfxBuffer,
                    senhaCriptografada,
                    certInfo ? certInfo.validade : null,
                    certInfo ? certInfo.cnpj : null,
                    certInfo ? certInfo.razaoSocial : req.file.originalname
                ]);
            }

            // Também salvar na tabela certificados_digitais para compatibilidade
            await pool.query(`
                INSERT INTO certificados_digitais (arquivo_nome, senha_hash, validade, created_at, updated_at)
                VALUES (?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    arquivo_nome = VALUES(arquivo_nome),
                    senha_hash = VALUES(senha_hash),
                    validade = VALUES(validade),
                    updated_at = NOW()
            `, [
                req.file.originalname,
                senhaCriptografada,
                certInfo ? certInfo.validade : new Date(Date.now() + 365*24*60*60*1000)
            ]);

            console.log('✅ Certificado salvo com sucesso nas tabelas nfe_configuracoes e certificados_digitais');

            res.json({
                success: true,
                message: 'Certificado instalado com sucesso',
                info: certInfo ? {
                    cnpj: certInfo.cnpj,
                    razaoSocial: certInfo.razaoSocial,
                    validade: certInfo.validade,
                    diasRestantes: Math.ceil((certInfo.validade - new Date()) / (1000 * 60 * 60 * 24))
                } : null
            });

        } catch (error) {
            console.error('❌ Erro ao salvar certificado:', error);
            res.status(500).json({ error: 'Erro ao salvar certificado: ' + error.message });
        }
    });

    // DELETE - Remover certificado digital
    router.delete('/api/configuracoes/certificado', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Removendo certificado digital...');
            const empresaId = 1;

            // Limpar certificado da tabela nfe_configuracoes
            await pool.query(`
                UPDATE nfe_configuracoes
                SET certificado_pfx = NULL,
                    certificado_senha = NULL,
                    certificado_validade = NULL,
                    certificado_cnpj = NULL,
                    certificado_nome = NULL,
                    updated_at = NOW()
                WHERE empresa_id = ?
            `, [empresaId]);

            // Limpar da tabela certificados_digitais
            await pool.query('DELETE FROM certificados_digitais');

            console.log('✅ Certificado removido com sucesso');
            res.json({ success: true, message: 'Certificado removido com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao remover certificado:', error);
            res.status(500).json({ error: 'Erro ao remover certificado' });
        }
    });

    // GET - Buscar configuração de importação de NF-e
    router.get('/api/configuracoes/nfe-import', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando config de NF-e...');

            const [rows] = await pool.query(`
                SELECT ativo, data_ativacao, updated_at
                FROM configuracoes_nfe
                ORDER BY id DESC LIMIT 1
            `);

            if (rows.length > 0) {
                res.json(rows[0]);
            } else {
                res.json({ ativo: false });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar config de NF-e:', error);
            res.status(500).json({ error: 'Erro ao buscar configuração' });
        }
    });

    // POST - Salvar configuração de importação de NF-e
    router.post('/api/configuracoes/nfe-import', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Salvando config de NF-e...');

            const { ativo, data_ativacao } = req.body;

            // Verificar se já existe registro
            const [existing] = await pool.query('SELECT id FROM configuracoes_nfe LIMIT 1');

            if (existing.length > 0) {
                // Atualizar
                await pool.query(`
                    UPDATE configuracoes_nfe SET
                        ativo = ?, data_ativacao = ?, updated_at = NOW()
                    WHERE id = ?
                `, [ativo, data_ativacao, existing[0].id]);
            } else {
                // Inserir
                await pool.query(`
                    INSERT INTO configuracoes_nfe (ativo, data_ativacao, created_at, updated_at)
                    VALUES (?, ?, NOW(), NOW())
                `, [ativo, data_ativacao]);
            }

            console.log('✅ Config de NF-e salva com sucesso');
            res.json({ success: true });

        } catch (error) {
            console.error('❌ Erro ao salvar config de NF-e:', error);
            res.status(500).json({ error: 'Erro ao salvar configuração' });
        }
    });


};
