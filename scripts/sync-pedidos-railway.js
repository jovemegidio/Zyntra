/**
 * Sincronizar pedidos do Local para Railway
 */

const mysql = require('mysql2/promise');

const railwayConfig = {
    host: 'interchange.proxy.rlwy.net',
    port: 19396,
    user: 'root',
    password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
    database: 'railway',
    charset: 'utf8mb4'
};

const localConfig = {
    host: 'localhost',
    user: 'root',
    password: '@dminalu',
    database: 'aluforce_vendas',
    charset: 'utf8mb4'
};

async function sincronizar() {
    const local = await mysql.createConnection(localConfig);
    const railway = await mysql.createConnection(railwayConfig);
    
    try {
        console.log('🚀 Sincronizando pedidos do Local para Railway...\n');
        
        // Buscar pedidos locais em orçamento
        const [pedidosLocal] = await local.query(`
            SELECT id, vendedor_id, data_prevista, cenario_fiscal_id
            FROM pedidos 
            WHERE status = 'orcamento'
        `);
        console.log(`📦 Pedidos a sincronizar: ${pedidosLocal.length}`);
        
        let atualizados = 0;
        
        for (const pedido of pedidosLocal) {
            try {
                await railway.query(`
                    UPDATE pedidos 
                    SET vendedor_id = ?,
                        data_prevista = ?,
                        cenario_fiscal_id = ?
                    WHERE id = ?
                `, [
                    pedido.vendedor_id,
                    pedido.data_prevista,
                    pedido.cenario_fiscal_id || 1,
                    pedido.id
                ]);
                atualizados++;
            } catch (err) {
                console.error(`Erro pedido ${pedido.id}:`, err.message);
            }
        }
        
        console.log(`\n✅ Pedidos atualizados no Railway: ${atualizados}`);
        
        // Verificar
        const [verificar] = await railway.query(`
            SELECT COUNT(*) as total FROM pedidos 
            WHERE status = 'orcamento' AND vendedor_id IS NOT NULL
        `);
        console.log(`👤 Pedidos com vendedor no Railway: ${verificar[0].total}`);
        
    } finally {
        await local.end();
        await railway.end();
    }
}

sincronizar();
