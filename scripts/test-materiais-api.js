const mysql = require('mysql2/promise');

async function testMateriais() {
    const pool = mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    console.log('=== Teste de Materiais ===\n');
    
    // Contar materiais em cada tabela
    const [mat] = await pool.query('SELECT COUNT(*) as total FROM materiais WHERE ativo = 1');
    const [emp] = await pool.query('SELECT COUNT(*) as total FROM estoque_materias_primas WHERE ativo = 1');
    
    console.log('Tabela materiais (ativo=1):', mat[0].total);
    console.log('Tabela estoque_materias_primas (ativo=1):', emp[0].total);
    
    // Exemplo da query que a API usa
    const queryMateriais = `
        SELECT 
            id,
            codigo_material as codigo,
            descricao as nome,
            unidade_medida as unidade,
            quantidade_estoque as quantidade_atual,
            COALESCE(estoque_minimo, 0) as quantidade_minima,
            COALESCE(custo_unitario, 0) as preco_medio,
            tipo,
            fornecedor_padrao as fornecedor,
            1 as ativo
        FROM materiais 
        WHERE (ativo = 1 OR ativo IS NULL)
        ORDER BY descricao 
        LIMIT 10
    `;
    
    const [materiais] = await pool.query(queryMateriais);
    console.log('\nPrimeiros 10 materiais:');
    materiais.forEach((m, i) => {
        console.log(`${i+1}. ${m.codigo} - ${m.nome?.substring(0, 50)}`);
    });
    
    // Buscar por termo (teste)
    const [buscaCorda] = await pool.query(`
        SELECT id, codigo_material as codigo, descricao as nome 
        FROM materiais 
        WHERE descricao LIKE '%CORDA%' OR descricao LIKE '%corda%'
        LIMIT 5
    `);
    console.log('\nMateriais com "corda" no nome:', buscaCorda.length);
    buscaCorda.forEach(m => console.log('  -', m.codigo, '-', m.nome));
    
    pool.end();
}

testMateriais().catch(console.error);
