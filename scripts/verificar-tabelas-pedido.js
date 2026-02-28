const mysql = require('mysql2/promise');

async function main() {
    const conn = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '@dminalu',
        database: 'aluforce_vendas'
    });

    // Verificar tabelas de pedido
    console.log('📋 Tabelas com "pedido":');
    const [tables] = await conn.query("SHOW TABLES LIKE '%pedido%'");
    tables.forEach(t => console.log(' -', Object.values(t)[0]));

    // Verificar contagem em cada tabela
    for (const t of tables) {
        const tableName = Object.values(t)[0];
        const [count] = await conn.query(`SELECT COUNT(*) as total FROM ${tableName}`);
        console.log(`   ${tableName}: ${count[0].total} registros`);
    }

    // Verificar onde estão os 196 pedidos
    console.log('\n📊 Verificando pedidos_vendas:');
    try {
        const [count] = await conn.query('SELECT COUNT(*) as total FROM pedidos_vendas');
        console.log('Total em pedidos_vendas:', count[0].total);
        
        const [sample] = await conn.query('SELECT * FROM pedidos_vendas LIMIT 3');
        if (sample.length > 0) {
            console.log('Colunas:', Object.keys(sample[0]).join(', '));
        }
    } catch (e) {
        console.log('Erro:', e.message);
    }

    // Ver total na tabela pedidos
    console.log('\n📊 Total em tabela pedidos:', );
    const [countPedidos] = await conn.query('SELECT COUNT(*) as total FROM pedidos');
    console.log('Total:', countPedidos[0].total);

    await conn.end();
}

main();
