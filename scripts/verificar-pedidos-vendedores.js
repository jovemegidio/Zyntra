const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    console.log('=== DATAS DOS PEDIDOS POR VENDEDOR ===\n');
    
    const [datas] = await conn.query(`
        SELECT 
            u.nome,
            DATE_FORMAT(p.created_at, '%Y-%m') as mes,
            COUNT(*) as qtd,
            SUM(p.valor) as total
        FROM pedidos p
        JOIN usuarios u ON u.id = p.vendedor_id
        WHERE p.vendedor_id IN (5, 12, 13, 22, 38)
        GROUP BY u.nome, DATE_FORMAT(p.created_at, '%Y-%m')
        ORDER BY u.nome, mes
    `);
    
    console.table(datas);
    
    console.log('\n=== PEDIDOS DE JANEIRO 2026 ===');
    const [jan2026] = await conn.query(`
        SELECT 
            u.nome,
            COUNT(*) as total,
            SUM(CASE WHEN p.status IN ('convertido', 'faturado', 'entregue') THEN p.valor ELSE 0 END) as faturado
        FROM pedidos p
        JOIN usuarios u ON u.id = p.vendedor_id
        WHERE p.vendedor_id IN (5, 12, 13, 22, 38)
        AND DATE_FORMAT(p.created_at, '%Y-%m') = '2026-01'
        GROUP BY u.nome
    `);
    console.table(jan2026);
    
    await conn.end();
})().catch(console.error);
