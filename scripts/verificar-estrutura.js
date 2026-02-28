const mysql = require('mysql2/promise');

async function verificar() {
    const pool = await mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway',
        port: 19396
    });

    try {
        // Ver estrutura da tabela
        const [columns] = await pool.query("DESCRIBE movimentacoes_bancarias");
        console.log('=== ESTRUTURA DA TABELA ===');
        columns.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));
        
        // Ver algumas movimentações
        const [movs] = await pool.query("SELECT * FROM movimentacoes_bancarias ORDER BY id DESC LIMIT 5");
        console.log('\n=== ÚLTIMAS 5 MOVIMENTAÇÕES ===');
        movs.forEach(m => {
            console.log(`  ID ${m.id}: ${m.descricao?.substring(0, 40)} | ${m.tipo} | R$ ${m.valor}`);
            console.log(`    -> conta_id: ${m.conta_id}, banco_id: ${m.banco_id}, data: ${m.data}`);
        });
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await pool.end();
    }
}

verificar();
