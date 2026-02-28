const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectTimeout: 60000
    });

    try {
        // Ver estrutura da tabela pedidos
        console.log('=== ESTRUTURA TABELA PEDIDOS ===');
        const [cols] = await conn.query('DESCRIBE pedidos');
        cols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

        // Ver vendedores
        console.log('\n=== VENDEDORES ===');
        const [vendedores] = await conn.query(`
            SELECT id, nome, email 
            FROM usuarios 
            WHERE ativo = 1 
            ORDER BY nome
        `);
        vendedores.forEach(v => console.log(`  ID: ${v.id} | ${v.nome}`));

        // Ver pedidos (usando coluna correta de valor)
        console.log('\n=== PEDIDOS (TOP 30) ===');
        const [pedidos] = await conn.query(`
            SELECT id, omie_numero_pedido as numero, valor, vendedor_id, status 
            FROM pedidos 
            ORDER BY COALESCE(valor, 0) DESC 
            LIMIT 30
        `);
        pedidos.forEach(p => console.log(`  ID: ${p.id} | Valor: R$ ${p.valor || 0} | Status: ${p.status}`));

        // Identificar IDs dos vendedores Marcia, Augusto e Renata
        const [targetVendedores] = await conn.query(`
            SELECT id, nome FROM usuarios 
            WHERE nome LIKE '%Marcia%' OR nome LIKE '%Márcia%' 
               OR nome LIKE '%Augusto%' 
               OR nome LIKE '%Renata%'
        `);
        console.log('\n=== VENDEDORES ALVO ===');
        targetVendedores.forEach(v => console.log(`  ID: ${v.id} | ${v.nome}`));

        if (targetVendedores.length >= 3) {
            // Distribuir os 30 maiores pedidos entre os 3 vendedores
            console.log('\n=== DISTRIBUINDO PEDIDOS ===');
            
            for (let i = 0; i < Math.min(pedidos.length, 30); i++) {
                const vendedor = targetVendedores[i % targetVendedores.length];
                const pedido = pedidos[i];
                
                await conn.query(`
                    UPDATE pedidos 
                    SET vendedor_id = ?
                    WHERE id = ?
                `, [vendedor.id, pedido.id]);
                
                console.log(`  Pedido #${pedido.id} (R$ ${pedido.valor || 0}) -> ${vendedor.nome}`);
            }
            
            console.log('\n✅ Pedidos distribuídos com sucesso!');
        } else {
            console.log('\n⚠️ Não foram encontrados os 3 vendedores (Marcia, Augusto, Renata)');
            console.log('Por favor, verifique os nomes no banco de dados.');
        }

    } catch (error) {
        console.error('Erro:', error.message);
    } finally {
        await conn.end();
    }
}

main();
