const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({ 
        host: 'interchange.proxy.rlwy.net', 
        user: 'root', 
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu', 
        database: 'railway', 
        port: 19396 
    });
    
    // Simulando a query da API atualizada
    const [materiais] = await pool.query(`
        SELECT 
            m.id,
            m.codigo_material as codigo,
            m.descricao as nome,
            m.descricao,
            m.gtin,
            COALESCE(m.quantidade_estoque, 0) as estoque_atual,
            COALESCE(m.estoque_minimo, 10) as estoque_minimo,
            COALESCE(m.preco_venda, m.custo_unitario, 0) as preco,
            COALESCE(m.unidade_medida, 'MT') as unidade_medida,
            m.tipo as categoria,
            'PRINCIPAL' as local_estoque
        FROM materiais m
        WHERE (m.ativo = 1 OR m.ativo IS NULL)
          AND EXISTS (
              SELECT 1 FROM movimentacoes_estoque me 
              WHERE me.material_id = m.id AND me.tipo = 'ENTRADA'
          )
        ORDER BY m.descricao ASC
    `);
    
    console.log('=== MATERIAIS COM ENTRADA REGISTRADA NO PCP ===');
    console.log('Total encontrados:', materiais.length);
    console.log('');
    
    if (materiais.length > 0) {
        materiais.forEach((m, i) => {
            console.log(`${i + 1}. ${m.nome}`);
            console.log(`   Código: ${m.codigo}`);
            console.log(`   Estoque: ${m.estoque_atual} ${m.unidade_medida}`);
            console.log(`   Categoria: ${m.categoria}`);
            console.log('');
        });
    } else {
        console.log('Nenhum material com entrada encontrado.');
    }
    
    await pool.end();
})();
