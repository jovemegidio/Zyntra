const mysql = require('mysql2/promise');

async function checkVendedores() {
    const conn = await mysql.createConnection({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    console.log('=== VENDEDORES ===');
    const [users] = await conn.query(`
        SELECT id, nome, email, ativo 
        FROM usuarios 
        WHERE LOWER(nome) LIKE '%renata%' 
           OR LOWER(nome) LIKE '%augusto%' 
           OR LOWER(nome) LIKE '%fabiola%' 
           OR LOWER(nome) LIKE '%fabiano%' 
           OR LOWER(nome) LIKE '%marcia%' 
        ORDER BY nome
    `);
    console.log(JSON.stringify(users, null, 2));
    
    console.log('\n=== PEDIDOS POR VENDEDOR ===');
    const [pedidos] = await conn.query(`
        SELECT 
            u.id as vendedor_id,
            u.nome as vendedor_nome,
            COUNT(p.id) as total_pedidos,
            SUM(CASE WHEN p.status IN ('faturado', 'entregue', 'convertido') THEN 1 ELSE 0 END) as pedidos_faturados,
            COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'entregue', 'convertido') THEN p.valor ELSE 0 END), 0) as valor_faturado
        FROM usuarios u
        LEFT JOIN pedidos p ON p.vendedor_id = u.id
        WHERE u.id IN (5, 22, 38, 21, 35)
        GROUP BY u.id, u.nome
        ORDER BY valor_faturado DESC
    `);
    console.log(JSON.stringify(pedidos, null, 2));
    
    await conn.end();
}

checkVendedores().catch(console.error);
