/**
 * ============================================================
 * SCRIPT DE OTIMIZAÇÁO DO BANCO DE DADOS - ALUFORCE
 * Execute: node scripts/otimizar-banco.js
 * ============================================================
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function otimizarBanco() {
    console.log('🚀 Iniciando otimização do banco de dados...\n');

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'aluforce_vendas',
        charset: 'utf8mb4'
    });

    try {
        // 1. CRIAR ÍNDICES PARA MELHOR PERFORMANCE
        console.log('📊 Criando índices otimizados...\n');

        const indices = [
            // Pedidos
            { table: 'pedidos', column: 'cliente_id', name: 'idx_pedidos_cliente' },
            { table: 'pedidos', column: 'data_pedido', name: 'idx_pedidos_data' },
            { table: 'pedidos', column: 'status', name: 'idx_pedidos_status' },
            { table: 'pedidos', column: 'vendedor_id', name: 'idx_pedidos_vendedor' },
            
            // Produtos
            { table: 'produtos', column: 'codigo', name: 'idx_produtos_codigo' },
            { table: 'produtos', column: 'nome', name: 'idx_produtos_nome' },
            { table: 'produtos', column: 'ativo', name: 'idx_produtos_ativo' },
            
            // Clientes
            { table: 'clientes', column: 'cnpj_cpf', name: 'idx_clientes_cnpj' },
            { table: 'clientes', column: 'razao_social', name: 'idx_clientes_razao' },
            { table: 'clientes', column: 'vendedor_id', name: 'idx_clientes_vendedor' },
            
            // Ordens de Produção
            { table: 'ordens_producao', column: 'status', name: 'idx_op_status' },
            { table: 'ordens_producao', column: 'data_criacao', name: 'idx_op_data' },
            { table: 'ordens_producao', column: 'pedido_id', name: 'idx_op_pedido' },
            
            // Usuários
            { table: 'usuarios', column: 'email', name: 'idx_usuarios_email' },
            { table: 'usuarios', column: 'ativo', name: 'idx_usuarios_ativo' },
            
            // Itens de Pedido
            { table: 'itens_pedido', column: 'pedido_id', name: 'idx_itens_pedido' },
            { table: 'itens_pedido', column: 'produto_id', name: 'idx_itens_produto' },
            
            // Contas a Pagar/Receber
            { table: 'contas_pagar', column: 'data_vencimento', name: 'idx_cp_vencimento' },
            { table: 'contas_pagar', column: 'status', name: 'idx_cp_status' },
            { table: 'contas_receber', column: 'data_vencimento', name: 'idx_cr_vencimento' },
            { table: 'contas_receber', column: 'status', name: 'idx_cr_status' },
        ];

        for (const idx of indices) {
            try {
                // Verificar se tabela existe
                const [tables] = await conn.query(
                    `SELECT TABLE_NAME FROM information_schema.TABLES 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                    [process.env.DB_NAME || 'aluforce_vendas', idx.table]
                );
                
                if (tables.length === 0) {
                    console.log(`   ⏭️  Tabela ${idx.table} não existe, pulando...`);
                    continue;
                }

                // Verificar se índice já existe
                const [existing] = await conn.query(
                    `SELECT INDEX_NAME FROM information_schema.STATISTICS 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                    [process.env.DB_NAME || 'aluforce_vendas', idx.table, idx.name]
                );

                if (existing.length > 0) {
                    console.log(`   ✅ Índice ${idx.name} já existe`);
                    continue;
                }

                // Criar índice
                await conn.query(`CREATE INDEX ${idx.name} ON ${idx.table}(${idx.column})`);
                console.log(`   ✅ Índice ${idx.name} criado em ${idx.table}.${idx.column}`);
            } catch (err) {
                if (!err.message.includes('Duplicate key name')) {
                    console.log(`   ⚠️  Erro ao criar índice ${idx.name}: ${err.message}`);
                }
            }
        }

        // 2. OTIMIZAR TABELAS
        console.log('\n🔧 Otimizando tabelas...\n');

        const [allTables] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES 
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [process.env.DB_NAME || 'aluforce_vendas']
        );

        for (const row of allTables) {
            try {
                await conn.query(`OPTIMIZE TABLE ${row.TABLE_NAME}`);
                console.log(`   ✅ Tabela ${row.TABLE_NAME} otimizada`);
            } catch (err) {
                console.log(`   ⚠️  Erro ao otimizar ${row.TABLE_NAME}: ${err.message}`);
            }
        }

        // 3. ANALISAR TABELAS
        console.log('\n📈 Analisando estatísticas das tabelas...\n');

        for (const row of allTables) {
            try {
                await conn.query(`ANALYZE TABLE ${row.TABLE_NAME}`);
            } catch (err) {
                // Silencioso
            }
        }
        console.log('   ✅ Estatísticas atualizadas');

        // 4. LIMPAR LOGS ANTIGOS (se existir tabela de logs)
        console.log('\n🧹 Limpando dados antigos...\n');

        try {
            const [logsResult] = await conn.query(
                `DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`
            );
            console.log(`   ✅ ${logsResult.affectedRows} logs antigos removidos`);
        } catch (err) {
            console.log('   ℹ️  Tabela de logs não encontrada ou sem dados antigos');
        }

        // 5. VERIFICAR TAMANHO DAS TABELAS
        console.log('\n📊 Tamanho das tabelas principais:\n');

        const [sizes] = await conn.query(`
            SELECT 
                TABLE_NAME as tabela,
                ROUND(DATA_LENGTH / 1024 / 1024, 2) as dados_mb,
                ROUND(INDEX_LENGTH / 1024 / 1024, 2) as indices_mb,
                TABLE_ROWS as linhas
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ?
            ORDER BY DATA_LENGTH DESC
            LIMIT 15
        `, [process.env.DB_NAME || 'aluforce_vendas']);

        console.log('   Tabela                    | Dados (MB) | Índices (MB) | Linhas');
        console.log('   --------------------------|------------|--------------|--------');
        for (const row of sizes) {
            const nome = row.tabela.padEnd(25);
            const dados = String(row.dados_mb).padStart(10);
            const indices = String(row.indices_mb).padStart(12);
            const linhas = String(row.linhas || 0).padStart(8);
            console.log(`   ${nome} | ${dados} | ${indices} | ${linhas}`);
        }

        console.log('\n✅ Otimização concluída com sucesso!\n');

    } catch (error) {
        console.error('❌ Erro durante otimização:', error.message);
    } finally {
        await conn.end();
    }
}

otimizarBanco();
