'use strict';

/**
 * Inline migrations extracted from server.js
 * These run at startup when SKIP_MIGRATIONS is not set.
 * Creates/alters tables: nfe, clientes, usuarios (permissions), funcionarios (seeds),
 * produtos (PCP cols + indexes), password_reset_tokens, compras-pcp integration,
 * notificacoes, vw_materiais_criticos view.
 */

async function runInlineMigrations(pool) {
    // ============================================================
    // NFe table
    // ============================================================
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS nfe (
            id INT AUTO_INCREMENT PRIMARY KEY,
            numero VARCHAR(20) UNIQUE NOT NULL,
            cliente_id INT NOT NULL,
            cliente_nome VARCHAR(100),
            descricao_servico TEXT NOT NULL,
            valor DECIMAL(10,2) NOT NULL,
            iss DECIMAL(10,2) DEFAULT 0,
            pis DECIMAL(10,2) DEFAULT 0,
            cofins DECIMAL(10,2) DEFAULT 0,
            irrf DECIMAL(10,2) DEFAULT 0,
            csll DECIMAL(10,2) DEFAULT 0,
            status ENUM('pendente', 'autorizada', 'cancelada', 'rejeitada', 'denegada') DEFAULT 'pendente',
            data_emissao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            observacoes TEXT,
            email_enviado BOOLEAN DEFAULT FALSE,
            data_envio_email TIMESTAMP NULL,
            usuario_id INT,
            xml_arquivo LONGTEXT,
            FOREIGN KEY (usuario_id) REFERENCES funcionarios(id) ON DELETE SET NULL
        )`);

        const nfeCols = ['iss', 'pis', 'cofins', 'irrf', 'csll'];
        for (const col of nfeCols) {
            try {
                await pool.query(`ALTER TABLE nfe ADD COLUMN ${col} DECIMAL(10,2) DEFAULT 0`);
                console.log(`✅ Coluna ${col} adicionada a nfe`);
            } catch (e) { /* already exists */ }
        }

        // Colunas adicionais para integração completa
        const nfeExtraCols = [
            { col: 'valor_total', type: 'DECIMAL(10,2) DEFAULT 0' },
            { col: 'pedido_id', type: 'INT NULL' },
            { col: 'serie', type: "VARCHAR(5) DEFAULT '1'" },
            { col: 'chave_acesso', type: 'VARCHAR(60) NULL' },
            { col: 'protocolo', type: 'VARCHAR(30) NULL' },
            { col: 'natureza_operacao', type: "VARCHAR(100) DEFAULT 'Venda de mercadoria'" },
        ];
        for (const { col, type } of nfeExtraCols) {
            try {
                await pool.query(`ALTER TABLE nfe ADD COLUMN ${col} ${type}`);
                console.log(`✅ Coluna ${col} adicionada a nfe`);
            } catch (e) { /* already exists */ }
        }

        // Tabela nfe_itens
        await pool.query(`CREATE TABLE IF NOT EXISTS nfe_itens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nfe_id INT NOT NULL,
            produto_id INT NULL,
            descricao VARCHAR(255),
            ncm VARCHAR(10),
            cfop VARCHAR(10),
            unidade VARCHAR(10) DEFAULT 'UN',
            quantidade DECIMAL(12,4) DEFAULT 1,
            valor_unitario DECIMAL(12,4) DEFAULT 0,
            valor_total DECIMAL(12,2) DEFAULT 0,
            icms_base DECIMAL(12,2) DEFAULT 0,
            icms_aliquota DECIMAL(5,2) DEFAULT 0,
            icms_valor DECIMAL(12,2) DEFAULT 0,
            ipi_aliquota DECIMAL(5,2) DEFAULT 0,
            ipi_valor DECIMAL(12,2) DEFAULT 0,
            pis_valor DECIMAL(12,2) DEFAULT 0,
            cofins_valor DECIMAL(12,2) DEFAULT 0,
            FOREIGN KEY (nfe_id) REFERENCES nfe(id) ON DELETE CASCADE
        )`);
        console.log('✅ Tabela nfe_itens verificada/criada.');

        // Atualizar ENUM de status para incluir 'denegada'
        try {
            await pool.query(`ALTER TABLE nfe MODIFY COLUMN status ENUM('pendente', 'autorizada', 'cancelada', 'rejeitada', 'denegada') DEFAULT 'pendente'`);
        } catch (e) { /* ignore if already correct */ }

        console.log('✅ Tabela nfe verificada/criada.');
    } catch (e) {
        console.warn('⚠️ Falha ao criar/verificar tabela nfe:', e.message || e);
    }

    // ============================================================
    // Clientes table
    // ============================================================
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS clientes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(100) NOT NULL,
            cnpj VARCHAR(18) UNIQUE,
            cpf VARCHAR(14) UNIQUE,
            email VARCHAR(100),
            telefone VARCHAR(20),
            endereco TEXT,
            inscricao_municipal VARCHAR(20),
            ativo BOOLEAN DEFAULT TRUE,
            data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`);

        try { await pool.query(`ALTER TABLE clientes ADD COLUMN cnpj VARCHAR(18) UNIQUE`); } catch (e) { /* exists */ }
        try { await pool.query(`ALTER TABLE clientes ADD COLUMN cpf VARCHAR(14) UNIQUE`); } catch (e) { /* exists */ }
        console.log('✅ Tabela clientes verificada/criada.');
    } catch (e) {
        console.warn('⚠️ Falha ao criar/verificar tabela clientes:', e.message || e);
    }

    // ============================================================
    // Permissions columns on usuarios
    // ============================================================
    const permissionColumns = ['permissoes_rh', 'permissoes_vendas', 'permissoes_compras', 'permissoes_financeiro', 'permissoes_nfe'];
    for (const col of permissionColumns) {
        try {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN ${col} JSON DEFAULT NULL`);
            console.log(`✅ Coluna ${col} adicionada com sucesso`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') {
                console.warn(`⚠️ Erro ao adicionar coluna ${col}:`, e.message);
            }
        }
    }

    // ============================================================
    // FIX: Converter role de ENUM para VARCHAR(50) — suporte a todos os roles
    // (admin, user, financeiro, vendedor, pcp, operador, diretor, gerente, etc.)
    // ============================================================
    try {
        const [[col]] = await pool.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'role'");
        if (col && col.DATA_TYPE === 'enum') {
            await pool.query("ALTER TABLE usuarios MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user'");
            console.log('✅ Coluna role migrada de ENUM para VARCHAR(50)');
        }
    } catch (e) {
        console.warn('⚠️ role VARCHAR migration:', e.message);
    }

    // ============================================================
    // Comissão percentual por vendedor (default 1%)
    // ============================================================
    try {
        await pool.query('ALTER TABLE usuarios ADD COLUMN comissao_percentual DECIMAL(5,2) DEFAULT 1.0');
        console.log('✅ Coluna comissao_percentual adicionada a usuarios');
    } catch (e) { /* already exists */ }

    // ============================================================
    // Seed funcionarios (example + admin + test users)
    // ============================================================
    try {
        const [rows] = await pool.query('SELECT COUNT(*) as count FROM funcionarios WHERE id = 6');
        if (rows[0].count === 0) {
            const bcryptjs = require('bcryptjs');
            const exemploHash = await bcryptjs.hash('aluvendas01', 10);
            await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf) VALUES (6, 'Funcionário Exemplo', 'exemplo@aluforce.ind.br', '', ?, 'comercial', 'vendedor', '1990-01-01', '00000000000')`, [exemploHash]);
            console.log('✅ Funcionário id=6 criado automaticamente.');

            const adminHash = await bcryptjs.hash('admin123', 10);
            await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf, role, is_admin) VALUES (1, 'Administrador', 'admin@aluforce.com', '', ?, 'ti', 'administrador', '1985-01-01', '11111111111', 'admin', 1)`, [adminHash]);
            console.log('✅ Usuário admin criado automaticamente.');

            const testHash = await bcryptjs.hash('123456', 10);
            await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf, role, is_admin) VALUES (2, 'Thiago Scarcella', 'thiago@aluforce.com', '', ?, 'gestao', 'gerente', '1990-05-15', '22222222222', 'user', 0)`, [testHash]);
            await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf, role, is_admin) VALUES (3, 'Guilherme Silva', 'guilherme@aluforce.com', '', ?, 'pcp', 'analista', '1992-08-20', '33333333333', 'user', 0)`, [testHash]);
            console.log('✅ Usuários de teste criados automaticamente.');
        } else {
            console.log('✅ Funcionário id=6 já existe (verificado).');
        }
    } catch (e) {
        try {
            const bcryptjs = require('bcryptjs');
            const fallbackHash = await bcryptjs.hash('aluvendas01', 10);
            await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf) VALUES (6, 'Funcionário Exemplo', 'exemplo@aluforce.ind.br', '', ?, 'comercial', 'vendedor', '1990-01-01', '00000000000')`, [fallbackHash]);
            console.log('✅ Funcionário id=6 criado com INSERT IGNORE.');
        } catch (e2) {
            console.warn('⚠️ Falha ao verificar/inserir funcionário id=6:', e2.message || e2);
        }
    }

    // ============================================================
    // Produtos table — PCP columns + indexes
    // ============================================================
    console.log('\n🔄 Verificando estrutura da tabela produtos...');

    const produtosColumns = [
        { name: 'categoria', sql: "ALTER TABLE produtos ADD COLUMN categoria VARCHAR(100) DEFAULT 'GERAL' AFTER descricao" },
        { name: 'gtin', sql: "ALTER TABLE produtos ADD COLUMN gtin VARCHAR(20) DEFAULT NULL AFTER categoria" },
        { name: 'ncm', sql: "ALTER TABLE produtos ADD COLUMN ncm VARCHAR(20) DEFAULT NULL AFTER sku" },
        { name: 'estoque_atual', sql: "ALTER TABLE produtos ADD COLUMN estoque_atual DECIMAL(10,2) DEFAULT 0 AFTER ncm" },
        { name: 'estoque_minimo', sql: "ALTER TABLE produtos ADD COLUMN estoque_minimo DECIMAL(10,2) DEFAULT 0 AFTER estoque_atual" },
        { name: 'preco_custo', sql: "ALTER TABLE produtos ADD COLUMN preco_custo DECIMAL(10,2) DEFAULT 0 AFTER estoque_minimo" },
        { name: 'preco_venda', sql: "ALTER TABLE produtos ADD COLUMN preco_venda DECIMAL(10,2) DEFAULT 0 AFTER preco_custo" },
        { name: 'unidade_medida', sql: "ALTER TABLE produtos ADD COLUMN unidade_medida VARCHAR(10) DEFAULT 'UN' AFTER preco_venda" },
        { name: 'embalagem', sql: "ALTER TABLE produtos ADD COLUMN embalagem VARCHAR(50) DEFAULT NULL AFTER unidade_medida" },
        { name: 'imagem_url', sql: "ALTER TABLE produtos ADD COLUMN imagem_url VARCHAR(255) DEFAULT NULL AFTER embalagem" },
        { name: 'status', sql: "ALTER TABLE produtos ADD COLUMN status VARCHAR(20) DEFAULT 'ativo' AFTER imagem_url" },
        { name: 'data_criacao', sql: "ALTER TABLE produtos ADD COLUMN data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status" },
        { name: 'controla_estoque', sql: "ALTER TABLE produtos ADD COLUMN controla_estoque TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = sob encomenda / fabricar sob demanda (não bloqueia faturamento por falta de estoque)' AFTER data_criacao" }
    ];

    for (const column of produtosColumns) {
        try {
            await pool.query(column.sql);
            console.log(`✅ Coluna '${column.name}' adicionada à tabela produtos`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') {
                console.warn(`⚠️ Erro ao adicionar coluna '${column.name}':`, e.message);
            }
        }
    }

    try {
        await pool.query("UPDATE produtos SET categoria = 'GERAL' WHERE categoria IS NULL OR categoria = ''");
        await pool.query("UPDATE produtos SET unidade_medida = 'UN' WHERE unidade_medida IS NULL OR unidade_medida = ''");
        await pool.query("UPDATE produtos SET status = 'ativo' WHERE status IS NULL OR status = ''");
        console.log('✅ Valores padrão aplicados aos produtos existentes');
    } catch (e) {
        console.warn('⚠️ Erro ao atualizar valores padrão:', e.message);
    }

    // Marcar produtos fabricados sob encomenda (cabos elétricos Aluforce) com controla_estoque = 0
    // Esses produtos podem ser faturados mesmo sem estoque disponível — produção via PCP
    try {
        const prefixosSobEncomenda = ['DUN', 'DUI', 'TRN', 'TRI', 'QDN', 'QDI', 'UN', 'PRO', 'CET', 'POT', 'PEAC', 'ROSE', 'IRIS', 'PANS', 'POPP', 'ASTE', 'PHLO', 'OXLI', 'SNEE', 'CLIP'];
        const conditions = prefixosSobEncomenda.map(() => 'codigo REGEXP ?').join(' OR ');
        const params = prefixosSobEncomenda.map(p => `^${p}`);
        await pool.query(`UPDATE produtos SET controla_estoque = 0 WHERE (${conditions})`, params);
        console.log('✅ controla_estoque = 0 aplicado aos cabos fabricados sob encomenda');
    } catch (e2) {
        console.warn('⚠️ Erro ao marcar produtos sob encomenda:', e2.message);
    }

    const produtosIndexes = [
        { name: 'idx_produtos_categoria', sql: 'CREATE INDEX idx_produtos_categoria ON produtos(categoria)' },
        { name: 'idx_produtos_gtin', sql: 'CREATE INDEX idx_produtos_gtin ON produtos(gtin)' },
        { name: 'idx_produtos_sku', sql: 'CREATE INDEX idx_produtos_sku ON produtos(sku)' },
        { name: 'idx_produtos_ncm', sql: 'CREATE INDEX idx_produtos_ncm ON produtos(ncm)' },
        { name: 'idx_produtos_status', sql: 'CREATE INDEX idx_produtos_status ON produtos(status)' },
        { name: 'idx_produtos_estoque', sql: 'CREATE INDEX idx_produtos_estoque ON produtos(estoque_atual)' }
    ];

    for (const index of produtosIndexes) {
        try {
            await pool.query(index.sql);
            console.log(`✅ Índice '${index.name}' criado`);
        } catch (e) {
            if (e.code !== 'ER_DUP_KEYNAME') {
                console.warn(`⚠️ Erro ao criar índice '${index.name}':`, e.message);
            }
        }
    }

    try {
        await pool.query("ALTER TABLE clientes ADD COLUMN ativo TINYINT(1) DEFAULT 1");
        console.log('✅ Coluna ativo adicionada à tabela clientes');
    } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') {
            console.warn('⚠️ Erro ao adicionar coluna ativo:', e.message);
        }
    }

    // Colunas extras do modal de clientes (Dados Bancários, Inscrições, Recomendações, Faturamento)
    const clienteExtraCols = [
        { col: 'celular', type: 'VARCHAR(20)' },
        { col: 'numero', type: 'VARCHAR(20)' },
        { col: 'complemento', type: 'VARCHAR(255)' },
        { col: 'website', type: 'VARCHAR(255)' },
        { col: 'fax', type: 'VARCHAR(20)' },
        { col: 'ddd_fax', type: 'VARCHAR(5)' },
        { col: 'enviar_anexos', type: 'TINYINT(1) DEFAULT 1' },
        { col: 'banco', type: 'VARCHAR(100)' },
        { col: 'agencia', type: 'VARCHAR(20)' },
        { col: 'conta', type: 'VARCHAR(30)' },
        { col: 'pix', type: 'VARCHAR(255)' },
        { col: 'titular_doc', type: 'VARCHAR(30)' },
        { col: 'titular_nome', type: 'VARCHAR(255)' },
        { col: 'suframa', type: 'VARCHAR(20)' },
        { col: 'simples_nacional', type: 'TINYINT(1) DEFAULT 0' },
        { col: 'produtor_rural', type: 'TINYINT(1) DEFAULT 0' },
        { col: 'tipo_atividade', type: 'VARCHAR(50)' },
        { col: 'cnae', type: 'VARCHAR(100)' },
        { col: 'obs_internas', type: 'TEXT' },
        { col: 'obs_detalhadas', type: 'TEXT' },
        { col: 'parcelas_padrao', type: 'VARCHAR(50)' },
        { col: 'vendedor_padrao', type: 'VARCHAR(255)' },
        { col: 'email_nfe', type: 'VARCHAR(255)' },
        { col: 'transportadora', type: 'VARCHAR(255)' },
        { col: 'codigo_receita', type: 'VARCHAR(50)' },
        { col: 'bloquear_faturamento', type: 'TINYINT(1) DEFAULT 0' }
    ];
    for (const c of clienteExtraCols) {
        try { await pool.query(`ALTER TABLE clientes ADD COLUMN ${c.col} ${c.type}`); } catch (_) { /* exists */ }
    }

    console.log('✅ Migração da tabela produtos concluída!\n');

    // ============================================================
    // Password reset tokens
    // ============================================================
    console.log('🔄 Verificando tabela password_reset_tokens...');
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                token VARCHAR(255) NOT NULL UNIQUE,
                expira_em DATETIME NOT NULL,
                usado TINYINT(1) DEFAULT 0,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_token (token),
                INDEX idx_email (email),
                INDEX idx_expira_em (expira_em)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabela password_reset_tokens verificada/criada');
    } catch (e) {
        console.warn('⚠️ Erro ao criar tabela password_reset_tokens:', e.message);
    }

    // ============================================================
    // Compras-PCP integration
    // ============================================================
    console.log('\n🔄 Verificando integração Compras-PCP...');

    const comprasPcpAlters = [
        `ALTER TABLE pedidos_compras ADD COLUMN origem ENUM('manual', 'pcp', 'estoque_minimo') DEFAULT 'manual' AFTER usuario_id`,
        `ALTER TABLE pedidos_compras ADD COLUMN origem_id INT NULL COMMENT 'ID da ordem de produção ou outro registro de origem' AFTER origem`,
        `ALTER TABLE pedidos_compras ADD COLUMN prioridade ENUM('baixa', 'media', 'alta', 'urgente') DEFAULT 'media' AFTER origem_id`,
        `ALTER TABLE itens_pedido_compras ADD COLUMN produto_id INT NULL COMMENT 'Referência ao produtos (materiais PCP)' AFTER pedido_id`,
        `ALTER TABLE ordens_producao ADD COLUMN pedidos_compra_vinculados JSON NULL COMMENT 'Array de IDs de pedidos de compra relacionados' AFTER arquivo_xlsx`,
        `ALTER TABLE ordens_producao ADD COLUMN materiais_pendentes JSON NULL COMMENT 'Materiais aguardando compra' AFTER pedidos_compra_vinculados`
    ];

    for (const sql of comprasPcpAlters) {
        try {
            await pool.query(sql);
        } catch (e) {
            if (!e.message.includes('Duplicate column')) {
                // already exists — OK
            }
        }
    }

    // ============================================================
    // Módulo Compras (rotas reais: tabelas no singular) — colunas
    // exigidas por modules/Compras/api/* que faltavam em produção.
    // Auditoria 2026-06-07: recebimento, propostas e encerramento de
    // cotação, e integração com estoque/movimentações (compartilhadas
    // com PCP — alterações apenas aditivas + relaxa NOT NULL de `tipo`).
    // ============================================================
    const comprasModuloAlters = [
        // Grupo A — tabelas exclusivas de Compras
        `ALTER TABLE pedidos_compra ADD COLUMN valor_recebido DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE propostas_cotacao ADD COLUMN condicao_pagamento VARCHAR(255) NULL`,
        `ALTER TABLE cotacoes ADD COLUMN data_encerramento DATETIME NULL`,
        `ALTER TABLE cotacoes ADD COLUMN motivo_encerramento TEXT NULL`,
        // Grupo B — estoque/movimentações (compartilhadas com PCP, aditivo)
        `ALTER TABLE estoque ADD COLUMN data_ultima_entrada DATETIME NULL`,
        `ALTER TABLE movimentacoes_estoque ADD COLUMN tipo_movimentacao VARCHAR(20) NULL`,
        `ALTER TABLE movimentacoes_estoque ADD COLUMN saldo_anterior DECIMAL(15,4) NULL`,
        `ALTER TABLE movimentacoes_estoque ADD COLUMN saldo_atual DECIMAL(15,4) NULL`,
        `ALTER TABLE movimentacoes_estoque ADD COLUMN motivo VARCHAR(255) NULL`,
        `ALTER TABLE movimentacoes_estoque ADD COLUMN data_movimentacao DATETIME NULL`,
        // Permite que inserts do módulo Compras (que não preenchem `tipo` do PCP) funcionem
        `ALTER TABLE movimentacoes_estoque MODIFY COLUMN tipo ENUM('ENTRADA','SAIDA','AJUSTE','RESERVA','TRANSFERENCIA') NULL`
    ];

    for (const sql of comprasModuloAlters) {
        try {
            await pool.query(sql);
        } catch (e) {
            // Duplicate column / já aplicado — OK, idempotente
            if (!/Duplicate column|check that column/i.test(e.message || '')) {
                console.warn('⚠️ Compras migration aviso:', e.message);
            }
        }
    }
    console.log('✅ Migrations do módulo Compras (singular) verificadas.');

    // Notificacoes_estoque table
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes_estoque (
                id INT AUTO_INCREMENT PRIMARY KEY,
                produto_id INT NOT NULL,
                tipo ENUM('estoque_baixo', 'estoque_critico', 'estoque_zero') NOT NULL,
                quantidade_atual DECIMAL(10,2) NOT NULL,
                quantidade_minima DECIMAL(10,2) NOT NULL,
                ordem_producao_id INT NULL COMMENT 'Ordem que gerou a necessidade',
                pedido_compra_id INT NULL COMMENT 'Pedido de compra gerado',
                status ENUM('pendente', 'em_compra', 'resolvido', 'ignorado') DEFAULT 'pendente',
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolvido_em TIMESTAMP NULL,
                resolvido_por INT NULL,
                observacoes TEXT,
                FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
                FOREIGN KEY (ordem_producao_id) REFERENCES ordens_producao(id) ON DELETE SET NULL,
                FOREIGN KEY (pedido_compra_id) REFERENCES pedidos_compras(id) ON DELETE SET NULL,
                FOREIGN KEY (resolvido_por) REFERENCES funcionarios(id) ON DELETE SET NULL,
                INDEX idx_status_tipo (status, tipo),
                INDEX idx_produto_status (produto_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabela notificacoes_estoque verificada/criada');
    } catch (e) {
        console.warn('⚠️ Erro ao criar tabela notificacoes_estoque:', e.message);
    }

    // Notificacoes table
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT NULL COMMENT 'NULL = broadcast para todos',
                titulo VARCHAR(255) NOT NULL DEFAULT '',
                mensagem TEXT NOT NULL,
                tipo VARCHAR(50) DEFAULT 'info',
                modulo VARCHAR(50) DEFAULT 'sistema',
                link VARCHAR(500) NULL,
                prioridade INT DEFAULT 3 COMMENT '1=alta, 2=média, 3=normal',
                entidade_tipo VARCHAR(50) NULL COMMENT 'pedido, ordem, conta, etc',
                entidade_id INT NULL,
                lida TINYINT(1) DEFAULT 0,
                lida_em TIMESTAMP NULL,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_usuario_lida (usuario_id, lida),
                INDEX idx_modulo (modulo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const colunasNotif = [
            { nome: 'titulo', def: "VARCHAR(255) NOT NULL DEFAULT '' AFTER usuario_id" },
            { nome: 'modulo', def: "VARCHAR(50) DEFAULT 'sistema' AFTER tipo" },
            { nome: 'link', def: "VARCHAR(500) NULL AFTER modulo" },
            { nome: 'prioridade', def: "INT DEFAULT 3 AFTER link" },
            { nome: 'entidade_tipo', def: "VARCHAR(50) NULL AFTER prioridade" },
            { nome: 'entidade_id', def: "INT NULL AFTER entidade_tipo" },
            { nome: 'lida_em', def: "TIMESTAMP NULL AFTER lida" },
            { nome: 'created_at', def: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER lida_em" }
        ];
        for (const col of colunasNotif) {
            try {
                const [exists] = await pool.query(`SHOW COLUMNS FROM notificacoes LIKE '${col.nome}'`);
                if (exists.length === 0) {
                    await pool.query(`ALTER TABLE notificacoes ADD COLUMN ${col.nome} ${col.def}`);
                    console.log(`  ✅ Coluna notificacoes.${col.nome} adicionada`);
                }
            } catch (ce) { /* already exists */ }
        }
        try {
            await pool.query(`UPDATE notificacoes SET created_at = criado_em WHERE created_at IS NULL AND criado_em IS NOT NULL`);
        } catch (ce) { /* ignore */ }
        console.log('✅ Tabela notificacoes verificada/criada');
    } catch (e) {
        console.warn('⚠️ Erro ao criar tabela notificacoes:', e.message);
    }

    // Materiais criticos view
    try {
        await pool.query(`
            CREATE OR REPLACE VIEW vw_materiais_criticos AS
            SELECT
                p.id,
                p.codigo,
                p.descricao,
                p.estoque_atual,
                p.estoque_minimo,
                (p.estoque_minimo - p.estoque_atual) as deficit,
                CASE
                    WHEN p.estoque_atual = 0 THEN 'zero'
                    WHEN p.estoque_atual < (p.estoque_minimo * 0.5) THEN 'critico'
                    WHEN p.estoque_atual < p.estoque_minimo THEN 'baixo'
                    ELSE 'normal'
                END as nivel_criticidade,
                (SELECT COUNT(*) FROM notificacoes_estoque WHERE produto_id = p.id AND status = 'pendente') as notificacoes_pendentes
            FROM produtos p
            WHERE p.estoque_atual < p.estoque_minimo
            ORDER BY
                CASE
                    WHEN p.estoque_atual = 0 THEN 1
                    WHEN p.estoque_atual < (p.estoque_minimo * 0.5) THEN 2
                    WHEN p.estoque_atual < p.estoque_minimo THEN 3
                    ELSE 4
                END,
                p.estoque_atual ASC
        `);
        console.log('✅ View vw_materiais_criticos criada/atualizada');
    } catch (e) {
        console.warn('⚠️ Erro ao criar view vw_materiais_criticos:', e.message);
    }

    console.log('✅ Migração Compras-PCP concluída!\n');

    // ============================================================
    // contas_receber — missing columns (tipo, cliente_nome)
    // ============================================================
    console.log('🔄 Verificando colunas contas_receber...');
    const contasReceberCols = [
        { nome: 'tipo', sql: "ALTER TABLE contas_receber ADD COLUMN tipo VARCHAR(50) DEFAULT NULL" },
        { nome: 'cliente_nome', sql: "ALTER TABLE contas_receber ADD COLUMN cliente_nome VARCHAR(255) DEFAULT NULL" }
    ];
    for (const col of contasReceberCols) {
        try {
            await pool.query(col.sql);
            console.log(`  ✅ Coluna contas_receber.${col.nome} adicionada`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') {
                console.warn(`  ⚠️ Erro ao adicionar coluna contas_receber.${col.nome}:`, e.message);
            }
        }
    }
    console.log('✅ Migração contas_receber concluída!\n');

    // ============================================================
    // pedido_historico — missing columns used by code
    // Production schema only has: usuario_id, campo_alterado, valor_antigo, valor_novo, status_antigo, status_novo, observacao
    // Code uses: user_id, user_name, action, descricao, meta, usuario_nome, acao
    // ============================================================
    console.log('🔄 Verificando colunas pedido_historico...');
    const pedidoHistCols = [
        { nome: 'user_id', sql: "ALTER TABLE pedido_historico ADD COLUMN user_id INT DEFAULT NULL" },
        { nome: 'user_name', sql: "ALTER TABLE pedido_historico ADD COLUMN user_name VARCHAR(100) DEFAULT NULL" },
        { nome: 'usuario_nome', sql: "ALTER TABLE pedido_historico ADD COLUMN usuario_nome VARCHAR(100) DEFAULT NULL" },
        { nome: 'action', sql: "ALTER TABLE pedido_historico ADD COLUMN action VARCHAR(50) DEFAULT NULL" },
        { nome: 'acao', sql: "ALTER TABLE pedido_historico ADD COLUMN acao VARCHAR(50) DEFAULT NULL" },
        { nome: 'descricao', sql: "ALTER TABLE pedido_historico ADD COLUMN descricao TEXT" },
        { nome: 'meta', sql: "ALTER TABLE pedido_historico ADD COLUMN meta JSON DEFAULT NULL" }
    ];
    for (const col of pedidoHistCols) {
        try {
            await pool.query(col.sql);
            console.log(`  ✅ Coluna pedido_historico.${col.nome} adicionada`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') {
                console.warn(`  ⚠️ Erro ao adicionar coluna pedido_historico.${col.nome}:`, e.message);
            }
        }
    }
    console.log('✅ Migração pedido_historico concluída!\n');

    // ============================================================
    // pedidos — columns used by faturamento, logística, etc.
    // Production dump (Dec 2025) was missing these
    // ============================================================
    console.log('🔄 Verificando colunas de faturamento na tabela pedidos...');
    const pedidosFatCols = [
        { nome: 'nf', sql: "ALTER TABLE pedidos ADD COLUMN nf VARCHAR(50) DEFAULT NULL" },
        { nome: 'numero_nf', sql: "ALTER TABLE pedidos ADD COLUMN numero_nf VARCHAR(50) DEFAULT NULL" },
        { nome: 'data_faturamento', sql: "ALTER TABLE pedidos ADD COLUMN data_faturamento DATETIME DEFAULT NULL" },
        { nome: 'nfe_chave', sql: "ALTER TABLE pedidos ADD COLUMN nfe_chave VARCHAR(60) DEFAULT NULL" },
        { nome: 'nfe_protocolo', sql: "ALTER TABLE pedidos ADD COLUMN nfe_protocolo VARCHAR(30) DEFAULT NULL" },
        { nome: 'status_logistica', sql: "ALTER TABLE pedidos ADD COLUMN status_logistica VARCHAR(50) DEFAULT NULL" },
        { nome: 'updated_at', sql: "ALTER TABLE pedidos ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP" },
        { nome: 'cliente', sql: "ALTER TABLE pedidos ADD COLUMN cliente VARCHAR(255) DEFAULT NULL" },
        { nome: 'condicao_pagamento', sql: "ALTER TABLE pedidos ADD COLUMN condicao_pagamento VARCHAR(100) DEFAULT NULL" },
        { nome: 'cliente_nome', sql: "ALTER TABLE pedidos ADD COLUMN cliente_nome VARCHAR(255) DEFAULT NULL" },
        { nome: 'numero_pedido', sql: "ALTER TABLE pedidos ADD COLUMN numero_pedido INT DEFAULT NULL" },
        { nome: 'condicoes_pagamento', sql: "ALTER TABLE pedidos ADD COLUMN condicoes_pagamento VARCHAR(255) DEFAULT NULL" },
        { nome: 'cenario_fiscal', sql: "ALTER TABLE pedidos ADD COLUMN cenario_fiscal VARCHAR(100) DEFAULT NULL" },
        { nome: 'transportadora_nome', sql: "ALTER TABLE pedidos ADD COLUMN transportadora_nome VARCHAR(255) DEFAULT NULL" },
        { nome: 'tipo_frete', sql: "ALTER TABLE pedidos ADD COLUMN tipo_frete VARCHAR(20) DEFAULT NULL" },
        { nome: 'frete', sql: "ALTER TABLE pedidos ADD COLUMN frete DECIMAL(15,2) DEFAULT 0" },
        { nome: 'placa_veiculo', sql: "ALTER TABLE pedidos ADD COLUMN placa_veiculo VARCHAR(20) DEFAULT NULL" },
        { nome: 'veiculo_uf', sql: "ALTER TABLE pedidos ADD COLUMN veiculo_uf VARCHAR(2) DEFAULT NULL" },
        { nome: 'rntrc', sql: "ALTER TABLE pedidos ADD COLUMN rntrc VARCHAR(50) DEFAULT NULL" },
        { nome: 'qtd_volumes', sql: "ALTER TABLE pedidos ADD COLUMN qtd_volumes DECIMAL(15,3) DEFAULT NULL" },
        { nome: 'especie_volumes', sql: "ALTER TABLE pedidos ADD COLUMN especie_volumes VARCHAR(100) DEFAULT NULL" },
        { nome: 'marca_volumes', sql: "ALTER TABLE pedidos ADD COLUMN marca_volumes VARCHAR(100) DEFAULT NULL" },
        { nome: 'numeracao_volumes', sql: "ALTER TABLE pedidos ADD COLUMN numeracao_volumes VARCHAR(100) DEFAULT NULL" },
        { nome: 'peso_liquido', sql: "ALTER TABLE pedidos ADD COLUMN peso_liquido DECIMAL(15,3) DEFAULT NULL" },
        { nome: 'peso_bruto', sql: "ALTER TABLE pedidos ADD COLUMN peso_bruto DECIMAL(15,3) DEFAULT NULL" },
        { nome: 'valor_seguro', sql: "ALTER TABLE pedidos ADD COLUMN valor_seguro DECIMAL(15,2) DEFAULT NULL" },
        { nome: 'outras_despesas', sql: "ALTER TABLE pedidos ADD COLUMN outras_despesas DECIMAL(15,2) DEFAULT NULL" },
        { nome: 'desconto_pct', sql: "ALTER TABLE pedidos ADD COLUMN desconto_pct DECIMAL(6,3) DEFAULT 0" },
        { nome: 'origem', sql: "ALTER TABLE pedidos ADD COLUMN origem VARCHAR(50) DEFAULT NULL" },
        { nome: 'observacao', sql: "ALTER TABLE pedidos ADD COLUMN observacao TEXT" },
        { nome: 'parcelas', sql: "ALTER TABLE pedidos ADD COLUMN parcelas TEXT" },
        { nome: 'version', sql: "ALTER TABLE pedidos ADD COLUMN version INT NOT NULL DEFAULT 1" }
    ];
    for (const col of pedidosFatCols) {
        try {
            await pool.query(col.sql);
            console.log(`  ✅ Coluna pedidos.${col.nome} adicionada`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') {
                console.warn(`  ⚠️ Erro ao adicionar coluna pedidos.${col.nome}:`, e.message);
            }
        }
    }
    console.log('✅ Migração pedidos (faturamento) concluída!\n');
}

module.exports = { runInlineMigrations };
