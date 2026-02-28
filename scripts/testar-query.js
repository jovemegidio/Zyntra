const mysql = require('mysql2/promise');

async function testar() {
    const pool = await mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway',
        port: 19396
    });

    try {
        const query = `
            SELECT 
                m.id,
                m.data,
                m.banco_id,
                COALESCE(b.nome, 'Conta Bancária') as banco_nome, 
                COALESCE(b.apelido, b.nome, 'Conta Bancária') as banco_apelido,
                COALESCE(m.cliente_fornecedor, m.categoria, 'Movimentação') as descricao,
                m.tipo,
                m.valor,
                m.saldo as saldo_apos,
                m.categoria,
                m.nota_fiscal,
                m.vendedor
            FROM movimentacoes_bancarias m
            LEFT JOIN bancos b ON m.banco_id = b.id
            ORDER BY m.data DESC, m.id DESC 
            LIMIT 10
        `;
        
        const [rows] = await pool.query(query);
        console.log('=== RESULTADO DA QUERY ===');
        console.log(`Total: ${rows.length} registros`);
        rows.forEach(r => {
            console.log(`\nID ${r.id}:`);
            console.log(`  Data: ${r.data}`);
            console.log(`  Banco: ${r.banco_nome} (ID: ${r.banco_id})`);
            console.log(`  Descrição: ${r.descricao}`);
            console.log(`  Tipo: ${r.tipo} | Valor: R$ ${r.valor}`);
        });
        
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await pool.end();
    }
}

testar();
