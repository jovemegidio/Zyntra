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
        // Verificar contas
        const [receberPagas] = await pool.query("SELECT COUNT(*) as total FROM contas_receber WHERE status = 'pago'");
        const [pagarPagas] = await pool.query("SELECT COUNT(*) as total FROM contas_pagar WHERE status = 'pago'");
        
        // Verificar tabela movimentacoes_bancarias
        const [tables] = await pool.query("SHOW TABLES LIKE 'movimentacoes_bancarias'");
        let movimentacoes = 0;
        if (tables.length > 0) {
            const [movs] = await pool.query("SELECT COUNT(*) as total FROM movimentacoes_bancarias");
            movimentacoes = movs[0].total;
        }
        
        console.log('=== STATUS DAS MOVIMENTAÇÕES ===');
        console.log(`Contas Receber pagas: ${receberPagas[0].total}`);
        console.log(`Contas Pagar pagas: ${pagarPagas[0].total}`);
        console.log(`Movimentações bancárias: ${movimentacoes}`);
        console.log(`Tabela movimentacoes_bancarias existe: ${tables.length > 0 ? 'SIM' : 'NÁO'}`);
        
        // Mostrar últimas contas receber (qualquer status)
        const [ultimasReceber] = await pool.query("SELECT id, descricao, valor, status, vencimento FROM contas_receber ORDER BY id DESC LIMIT 5");
        console.log('\n=== ÚLTIMAS CONTAS A RECEBER ===');
        ultimasReceber.forEach(c => console.log(`  ID ${c.id}: ${c.descricao?.substring(0, 40)} | R$ ${c.valor} | ${c.status}`));
        
        // Mostrar últimas contas pagar (qualquer status)
        const [ultimasPagar] = await pool.query("SELECT id, descricao, valor, status, vencimento FROM contas_pagar ORDER BY id DESC LIMIT 5");
        console.log('\n=== ÚLTIMAS CONTAS A PAGAR ===');
        ultimasPagar.forEach(c => console.log(`  ID ${c.id}: ${c.descricao?.substring(0, 40)} | R$ ${c.valor} | ${c.status}`));
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await pool.end();
    }
}

verificar();
