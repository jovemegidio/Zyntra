const mysql = require('mysql2/promise');

async function verificarVendedores() {
    const railway = await mysql.createConnection({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });

    const local = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '@dminalu',
        database: 'aluforce_vendas'
    });

    console.log('📊 COMPARAÇÁO DE VENDEDORES LOCAL vs RAILWAY\n');

    // Verificar no Local
    const [localPedidos] = await local.query(`
        SELECT p.id, p.vendedor_id, u.nome as vendedor
        FROM pedidos p
        LEFT JOIN usuarios u ON p.vendedor_id = u.id
        WHERE p.status = 'orcamento'
        ORDER BY p.id DESC
        LIMIT 15
    `);
    console.log('📦 VENDEDORES NO LOCAL:');
    console.table(localPedidos);

    // Verificar no Railway
    const [railwayPedidos] = await railway.query(`
        SELECT p.id, p.vendedor_id, u.nome as vendedor
        FROM pedidos p
        LEFT JOIN usuarios u ON p.vendedor_id = u.id
        WHERE p.status = 'orcamento'
        ORDER BY p.id DESC
        LIMIT 15
    `);
    console.log('\n📦 VENDEDORES NO RAILWAY:');
    console.table(railwayPedidos);

    // Contar quantos têm vendedor
    const [statsLocal] = await local.query(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN vendedor_id IS NOT NULL AND vendedor_id > 0 THEN 1 ELSE 0 END) as com_vendedor
        FROM pedidos WHERE status = 'orcamento'
    `);
    console.log('\n📊 ESTATÍSTICAS LOCAL:');
    console.table(statsLocal);

    const [statsRailway] = await railway.query(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN vendedor_id IS NOT NULL AND vendedor_id > 0 THEN 1 ELSE 0 END) as com_vendedor
        FROM pedidos WHERE status = 'orcamento'
    `);
    console.log('\n📊 ESTATÍSTICAS RAILWAY:');
    console.table(statsRailway);

    await railway.end();
    await local.end();
}

verificarVendedores();
