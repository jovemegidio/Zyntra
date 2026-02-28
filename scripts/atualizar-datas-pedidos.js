const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    console.log('=== ATUALIZANDO DATAS DOS PEDIDOS PARA JANEIRO 2026 ===\n');
    
    // Atualizar pedidos de Augusto, Márcia e Renata para janeiro 2026
    const [result] = await conn.query(`
        UPDATE pedidos 
        SET created_at = DATE_ADD(created_at, INTERVAL 1 MONTH)
        WHERE vendedor_id IN (5, 22, 38) 
        AND DATE_FORMAT(created_at, '%Y-%m') = '2025-12'
    `);
    
    console.log(`✅ ${result.affectedRows} pedidos atualizados para janeiro 2026\n`);
    
    // Verificar resultado
    const [resumo] = await conn.query(`
        SELECT 
            u.nome,
            DATE_FORMAT(p.created_at, '%Y-%m') as mes,
            COUNT(*) as qtd,
            SUM(CASE WHEN p.status IN ('convertido', 'faturado', 'entregue') THEN p.valor ELSE 0 END) as faturado
        FROM pedidos p
        JOIN usuarios u ON u.id = p.vendedor_id
        WHERE p.vendedor_id IN (5, 12, 13, 22, 38)
        GROUP BY u.nome, DATE_FORMAT(p.created_at, '%Y-%m')
        ORDER BY u.nome, mes
    `);
    
    console.log('=== RESUMO ATUALIZADO ===');
    console.table(resumo);
    
    await conn.end();
})().catch(console.error);
