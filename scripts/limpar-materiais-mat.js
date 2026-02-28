const mysql = require('mysql2/promise');

async function limparMateriaisMAT() {
    const pool = mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });

    try {
        // Contar antes
        const [countMat] = await pool.query("SELECT COUNT(*) as total FROM materiais WHERE codigo_material LIKE 'MAT-%'");
        const [countPot] = await pool.query("SELECT COUNT(*) as total FROM materiais WHERE codigo_material LIKE 'POT%'");
        const [countTotal] = await pool.query("SELECT COUNT(*) as total FROM materiais");
        
        console.log('=== ANTES DA LIMPEZA ===');
        console.log('Total de materiais:', countTotal[0].total);
        console.log('Materiais MAT-:', countMat[0].total);
        console.log('Materiais POT:', countPot[0].total);
        
        // Deletar materiais com código MAT-
        console.log('\n🗑️  Deletando materiais com código MAT-...');
        const [deleteResult] = await pool.query("DELETE FROM materiais WHERE codigo_material LIKE 'MAT-%'");
        console.log('✅ Registros deletados:', deleteResult.affectedRows);
        
        // Contar depois
        const [countAfter] = await pool.query("SELECT COUNT(*) as total FROM materiais");
        const [potAfter] = await pool.query("SELECT COUNT(*) as total FROM materiais WHERE codigo_material LIKE 'POT%'");
        
        console.log('\n=== DEPOIS DA LIMPEZA ===');
        console.log('Total de materiais:', countAfter[0].total);
        console.log('Materiais POT restantes:', potAfter[0].total);
        
        // Listar os POT restantes
        const [potList] = await pool.query("SELECT codigo_material, descricao FROM materiais WHERE codigo_material LIKE 'POT%' ORDER BY codigo_material");
        console.log('\n📋 Materiais POT mantidos:');
        potList.forEach(p => console.log('  -', p.codigo_material, '-', p.descricao?.substring(0, 50)));
        
    } catch (error) {
        console.error('Erro:', error.message);
    } finally {
        await pool.end();
    }
}

limparMateriaisMAT();
