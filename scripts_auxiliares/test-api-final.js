const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({ 
        host: 'interchange.proxy.rlwy.net', 
        user: 'root', 
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu', 
        database: 'railway', 
        port: 19396 
    });
    
    // Função de detecção de categoria - ATUALIZADA
    function detectarCategoria(nome) {
        if (!nome) return 'OUTROS';
        nome = nome.toUpperCase();
        // Detectar pela formação do cabo (2X, 3X, 4X, etc) - sem \b no final para pegar 3X2,5
        if (nome.includes('DUPLEX') || nome.includes('DUN') || nome.includes('DUI') || /\b2\s*X/.test(nome)) return 'DUPLEX';
        if (nome.includes('TRIPLEX') || nome.includes('TRI') || /\b3\s*X/.test(nome)) return 'TRIPLEX';
        if (nome.includes('QUADRUPLEX') || nome.includes('QDR') || nome.includes('QDN') || /\b4\s*X/.test(nome)) return 'QUADRUPLEX';
        if (nome.includes('QUINTUPLEX') || nome.includes('QUI') || /\b5\s*X/.test(nome)) return 'QUINTUPLEX';
        if (nome.includes('SEXTUPLEX') || nome.includes('SEX') || /\b6\s*X/.test(nome)) return 'SEXTUPLEX';
        if (nome.includes('MULTIPLEX') || nome.includes('MULTI') || /\b[7-9]\s*X/.test(nome) || /\b\d{2,}\s*X/.test(nome)) return 'MULTIPLEX';
        if (nome.includes('UNIPOLAR') || /\b1\s*X/.test(nome)) return 'UNIPOLAR';
        return 'OUTROS';
    }
    
    // Simulando a query da API atualizada
    const [materiais] = await pool.query(`
        SELECT 
            m.id,
            m.codigo_material as codigo,
            m.descricao as nome,
            m.gtin,
            COALESCE(m.quantidade_estoque, 0) as estoque_atual,
            COALESCE(m.estoque_minimo, 10) as estoque_minimo,
            COALESCE(m.preco_venda, m.custo_unitario, 0) as preco,
            COALESCE(m.unidade_medida, 'MT') as unidade_medida,
            m.tipo as tipo_material,
            'PRINCIPAL' as local_estoque
        FROM materiais m
        WHERE (m.ativo = 1 OR m.ativo IS NULL)
          AND EXISTS (
              SELECT 1 FROM movimentacoes_estoque me 
              WHERE me.material_id = m.id AND me.tipo = 'ENTRADA'
          )
        ORDER BY m.descricao ASC
    `);
    
    console.log('=========================================');
    console.log('MATERIAIS COM ENTRADA REGISTRADA NO PCP');
    console.log('=========================================');
    console.log('Total encontrados:', materiais.length);
    console.log('');
    
    if (materiais.length > 0) {
        // Contar categorias
        const categoriasCounts = {};
        
        materiais.forEach((m, i) => {
            const cat = detectarCategoria(m.nome);
            categoriasCounts[cat] = (categoriasCounts[cat] || 0) + 1;
            
            console.log(`${i + 1}. ${m.nome}`);
            console.log(`   Código: ${m.codigo}`);
            console.log(`   Estoque: ${m.estoque_atual} ${m.unidade_medida}`);
            console.log(`   Categoria detectada: ${cat}`);
            console.log('');
        });
        
        console.log('=========================================');
        console.log('CATEGORIAS:');
        console.log(JSON.stringify(categoriasCounts, null, 2));
    } else {
        console.log('Nenhum material com entrada encontrado.');
    }
    
    await pool.end();
})();
