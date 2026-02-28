const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({ 
        host: 'interchange.proxy.rlwy.net', 
        user: 'root', 
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu', 
        database: 'railway', 
        port: 19396 
    });
    
    try {
        console.log('=== VERIFICANDO TABELAS ===\n');
        
        // Verificar tabelas relacionadas a alçadas
        const [tables] = await pool.query(`SHOW TABLES`);
        const tableNames = tables.map(t => Object.values(t)[0]);
        
        const alcadaTables = tableNames.filter(t => 
            t.includes('alcada') || t.includes('aprovacao') || t.includes('workflow')
        );
        console.log('Tabelas de alçadas/aprovação:', alcadaTables);
        
        // Verificar se existe tabela de usuarios
        const usuarioTables = tableNames.filter(t => t.includes('usuario'));
        console.log('Tabelas de usuários:', usuarioTables);
        
        // Verificar estrutura tabela usuarios
        if (tableNames.includes('usuarios')) {
            const [cols] = await pool.query('SHOW COLUMNS FROM usuarios');
            console.log('\n=== COLUNAS USUARIOS ===');
            console.log(cols.map(c => c.Field).join(', '));
            
            const [count] = await pool.query('SELECT COUNT(*) as total FROM usuarios');
            console.log('Total usuários:', count[0].total);
        }
        
    } catch(e) {
        console.log('ERRO:', e.message);
    }
    
    await pool.end();
})();
