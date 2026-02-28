const mysql = require('mysql2/promise');

async function atualizarUnidades() {
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

    console.log('🔄 Atualizando unidade de UN para M...\n');

    // Atualizar Railway
    const [r1] = await railway.query("UPDATE pedido_itens SET unidade = 'M' WHERE unidade = 'UN'");
    console.log(`✅ Railway atualizado: ${r1.affectedRows} itens`);

    // Atualizar Local
    const [r2] = await local.query("UPDATE pedido_itens SET unidade = 'M' WHERE unidade = 'UN'");
    console.log(`✅ Local atualizado: ${r2.affectedRows} itens`);

    // Verificar
    const [check] = await railway.query('SELECT unidade, COUNT(*) as qtd FROM pedido_itens GROUP BY unidade');
    console.log('\n📊 Verificação Railway:');
    console.table(check);

    await railway.end();
    await local.end();
}

atualizarUnidades();
