const mysql = require('mysql2/promise');

(async () => {
    try {
        const db = await mysql.createPool({
            host: 'localhost',
            user: 'aluforce',
            password: 'Aluforce2026VpsDB',
            database: 'aluforce_vendas'
        });

        const [r1] = await db.query('SELECT COUNT(*) as total FROM produtos');
        console.log('Total Produtos:', r1[0].total);

        const [r2] = await db.query("SELECT COUNT(*) as total FROM ordens_producao WHERE status IN ('ativa','em_producao','Em Produção','em_andamento','A Fazer','pendente')");
        console.log('Ordens em Produção:', r2[0].total);

        const [r3] = await db.query('SELECT COUNT(*) as total FROM produtos WHERE (estoque_atual < estoque_minimo OR quantidade_estoque < estoque_minimo) AND estoque_minimo > 0 AND (ativo = 1 OR ativo IS NULL)');
        console.log('Estoque Baixo:', r3[0].total);

        const [r4] = await db.query('SELECT COUNT(*) as total FROM materiais');
        console.log('Total Materiais:', r4[0].total);

        process.exit(0);
    } catch (err) {
        console.error('ERRO:', err.message);
        process.exit(1);
    }
})();
