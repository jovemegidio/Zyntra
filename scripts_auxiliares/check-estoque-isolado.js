// Script isolado para verificar dados
const mysql = require('mysql2/promise');

async function verificar() {
    const pool = await mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway',
        port: 19396
    });

    console.log('\n=== MOVIMENTAÇÕES DE ESTOQUE ===');
    try {
        const [movimentacoes] = await pool.query(`
            SELECT tipo, COUNT(*) as qtd, SUM(quantidade) as total_qtd 
            FROM movimentacoes_estoque 
            GROUP BY tipo
        `);
        console.log(movimentacoes.length === 0 ? 'Nenhuma movimentação' : movimentacoes);
    } catch (e) {
        console.log('Tabela não existe ou erro:', e.message);
    }

    console.log('\n=== PRODUTOS ATIVOS ===');
    const [produtosAtivos] = await pool.query(`
        SELECT COUNT(*) as total FROM produtos WHERE ativo = 1 OR ativo IS NULL
    `);
    console.log(produtosAtivos);

    console.log('\n=== AMOSTRA DE PRODUTOS ===');
    const [amostra] = await pool.query(`
        SELECT id, codigo, nome, quantidade_estoque, estoque_minimo, unidade_medida, categoria
        FROM produtos 
        LIMIT 5
    `);
    console.table(amostra);

    await pool.end();
}

verificar().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
