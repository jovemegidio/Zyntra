/**
 * Migração para adicionar campos de integração com Omie
 * ALUFORCE Sistema v2.0
 */

const mysql = require('mysql2/promise');

async function migrate() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
        port: parseInt(process.env.DB_PORT) || 19396,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: process.env.DB_NAME || 'railway'
    });

    console.log('🔄 Iniciando migração para integração Omie...');

    const alteracoes = [
        // Clientes Financeiro
        {
            tabela: 'clientes_financeiro',
            colunas: [
                { nome: 'omie_codigo_cliente', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_cliente' }
            ]
        },
        // Fornecedores Financeiro
        {
            tabela: 'fornecedores_financeiro',
            colunas: [
                { nome: 'omie_codigo_cliente', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_cliente' }
            ]
        },
        // Contas a Pagar
        {
            tabela: 'contas_pagar',
            colunas: [
                { nome: 'omie_codigo_lancamento', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_lancamento' }
            ]
        },
        // Contas a Receber
        {
            tabela: 'contas_receber',
            colunas: [
                { nome: 'omie_codigo_lancamento', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_lancamento' }
            ]
        },
        // Produtos
        {
            tabela: 'produtos',
            colunas: [
                { nome: 'omie_codigo_produto', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_produto' }
            ]
        },
        // Pedidos
        {
            tabela: 'pedidos',
            colunas: [
                { nome: 'omie_codigo_pedido', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_numero_pedido', tipo: 'VARCHAR(20) NULL', after: 'omie_codigo_pedido' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_numero_pedido' }
            ]
        },
        // Materiais (PCP)
        {
            tabela: 'materiais',
            colunas: [
                { nome: 'omie_codigo_produto', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_produto' }
            ]
        },
        // Ordens de Produção
        {
            tabela: 'ordens_producao',
            colunas: [
                { nome: 'omie_codigo_op', tipo: 'BIGINT NULL', after: 'id' },
                { nome: 'omie_sync_at', tipo: 'DATETIME NULL', after: 'omie_codigo_op' }
            ]
        }
    ];

    for (const alteracao of alteracoes) {
        console.log(`📋 Tabela: ${alteracao.tabela}`);
        
        // Verificar se tabela existe
        const [tabelas] = await conn.query(
            'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            ['railway', alteracao.tabela]
        );

        if (tabelas.length === 0) {
            console.log(`   ⚠️  Tabela não existe, pulando...`);
            continue;
        }

        for (const coluna of alteracao.colunas) {
            // Verificar se coluna já existe
            const [colunas] = await conn.query(
                'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
                ['railway', alteracao.tabela, coluna.nome]
            );

            if (colunas.length > 0) {
                console.log(`   ⏭️  Coluna ${coluna.nome} já existe`);
                continue;
            }

            try {
                const sql = `ALTER TABLE ${alteracao.tabela} ADD COLUMN ${coluna.nome} ${coluna.tipo} AFTER ${coluna.after}`;
                await conn.query(sql);
                console.log(`   ✅ Coluna ${coluna.nome} adicionada`);
            } catch (error) {
                console.log(`   ❌ Erro ao adicionar ${coluna.nome}: ${error.message}`);
            }
        }
    }

    // Criar índices para otimizar buscas
    console.log('🔑 Criando índices...');

    const indices = [
        { tabela: 'clientes_financeiro', indice: 'idx_omie_cliente', coluna: 'omie_codigo_cliente' },
        { tabela: 'fornecedores_financeiro', indice: 'idx_omie_fornecedor', coluna: 'omie_codigo_cliente' },
        { tabela: 'contas_pagar', indice: 'idx_omie_cp', coluna: 'omie_codigo_lancamento' },
        { tabela: 'contas_receber', indice: 'idx_omie_cr', coluna: 'omie_codigo_lancamento' },
        { tabela: 'produtos', indice: 'idx_omie_produto', coluna: 'omie_codigo_produto' },
        { tabela: 'pedidos', indice: 'idx_omie_pedido', coluna: 'omie_codigo_pedido' },
        { tabela: 'materiais', indice: 'idx_omie_material', coluna: 'omie_codigo_produto' },
        { tabela: 'ordens_producao', indice: 'idx_omie_op', coluna: 'omie_codigo_op' }
    ];

    for (const idx of indices) {
        // Verificar se tabela existe
        const [tabelas] = await conn.query(
            'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            ['railway', idx.tabela]
        );

        if (tabelas.length === 0) continue;

        // Verificar se índice já existe
        const [indices] = await conn.query(
            'SHOW INDEX FROM ?? WHERE Key_name = ?',
            [idx.tabela, idx.indice]
        );

        if (indices.length > 0) {
            console.log(`   ⏭️  Índice ${idx.indice} já existe`);
            continue;
        }

        // Verificar se coluna existe
        const [colunas] = await conn.query(
            'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            ['railway', idx.tabela, idx.coluna]
        );

        if (colunas.length === 0) continue;

        try {
            await conn.query(`CREATE INDEX ${idx.indice} ON ${idx.tabela}(${idx.coluna})`);
            console.log(`   ✅ Índice ${idx.indice} criado`);
        } catch (error) {
            console.log(`   ❌ Erro: ${error.message}`);
        }
    }

    console.log('✅ Migração concluída!');
    await conn.end();
}

migrate().catch(console.error);
