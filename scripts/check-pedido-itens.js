const mysql = require('mysql2/promise');

async function main() {
    const conn = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '@dminalu',
        database: 'aluforce_vendas'
    });

    try {
        // Ver estrutura da tabela pedido_itens
        console.log('\n📋 Estrutura da tabela pedido_itens:');
        const [desc] = await conn.query('DESCRIBE pedido_itens');
        console.table(desc.map(d => ({ Campo: d.Field, Tipo: d.Type, Null: d.Null, Key: d.Key })));

        // Ver quantos itens existem
        const [count] = await conn.query('SELECT COUNT(*) as total FROM pedido_itens');
        console.log('\n📊 Total de itens na tabela:', count[0].total);

        // Ver alguns itens de exemplo
        console.log('\n🔍 Exemplo de itens (primeiros 5):');
        const [items] = await conn.query('SELECT * FROM pedido_itens LIMIT 5');
        console.table(items);

        // Ver um pedido importado e seus itens
        console.log('\n🔍 Verificando pedido importado (ex: pedido mais recente):');
        const [pedidos] = await conn.query(`
            SELECT id, numero_pedido, cliente_id, valor_total 
            FROM pedidos 
            WHERE numero_pedido LIKE '1316%' 
            LIMIT 5
        `);
        console.table(pedidos);

        if (pedidos.length > 0) {
            const pedidoId = pedidos[0].id;
            console.log(`\n🔍 Itens do pedido ID ${pedidoId}:`);
            const [itens] = await conn.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [pedidoId]);
            console.log('Quantidade de itens:', itens.length);
            if (itens.length > 0) {
                console.table(itens);
            }
        }

    } catch (error) {
        console.error('Erro:', error.message);
    } finally {
        await conn.end();
    }
}

main();
