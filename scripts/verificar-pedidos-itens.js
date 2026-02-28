const mysql = require('mysql2/promise');

async function main() {
    const conn = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '@dminalu',
        database: 'aluforce_vendas'
    });

    console.log('📦 Pedidos em orçamento SEM itens:\n');
    const [semItens] = await conn.query(`
        SELECT p.id, c.nome_fantasia, p.valor 
        FROM pedidos p 
        JOIN clientes c ON c.id = p.cliente_id 
        LEFT JOIN pedido_itens pi ON pi.pedido_id = p.id 
        WHERE p.status = 'orcamento' AND pi.id IS NULL
    `);
    console.table(semItens);

    console.log('\n📊 Resumo final:');
    const [total] = await conn.query(`SELECT COUNT(*) as total FROM pedidos WHERE status = 'orcamento'`);
    const [comItens] = await conn.query(`
        SELECT COUNT(DISTINCT p.id) as total 
        FROM pedidos p 
        JOIN pedido_itens pi ON pi.pedido_id = p.id 
        WHERE p.status = 'orcamento'
    `);
    const [totalItens] = await conn.query(`SELECT COUNT(*) as total FROM pedido_itens`);

    console.log(`Pedidos em orçamento: ${total[0].total}`);
    console.log(`Pedidos com itens: ${comItens[0].total}`);
    console.log(`Total de itens: ${totalItens[0].total}`);

    await conn.end();
}

main();
