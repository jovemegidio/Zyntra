/**
 * Script para sincronizar pedido_itens do Local para o Railway
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

async function sincronizarItens() {
    const local = await mysql.createConnection(localConfig);
    const railway = await mysql.createConnection(railwayConfig);
    
    try {
        console.log('🚀 Sincronizando ITENS do Local para Railway...\n');
        
        // Buscar itens locais
        const [itensLocal] = await local.query(`SELECT * FROM pedido_itens`);
        console.log(`📦 Itens no Local: ${itensLocal.length}`);
        
        // Buscar itens no Railway
        const [itensRailway] = await railway.query(`SELECT id FROM pedido_itens`);
        const idsRailway = new Set(itensRailway.map(i => i.id));
        console.log(`📦 Itens no Railway: ${itensRailway.length}`);
        
        // Limpar itens antigos do Railway para os pedidos em orçamento
        console.log('\n🧹 Limpando itens antigos no Railway...');
        const [pedidosOrcamento] = await railway.query(`SELECT id FROM pedidos WHERE status = 'orcamento'`);
        if (pedidosOrcamento.length > 0) {
            const ids = pedidosOrcamento.map(p => p.id);
            await railway.query(`DELETE FROM pedido_itens WHERE pedido_id IN (?)`, [ids]);
        }
        
        let inseridos = 0;
        let erros = 0;
        
        for (const item of itensLocal) {
            try {
                await railway.query(`
                    INSERT INTO pedido_itens (
                        id, pedido_id, produto_id, codigo, descricao, quantidade,
                        unidade, quantidade_parcial, local_estoque, preco_unitario, 
                        desconto, subtotal, icms_percent, icms_value, pis_percent, 
                        pis_value, cofins_percent, cofins_value, embalagem, lances
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        descricao = VALUES(descricao),
                        quantidade = VALUES(quantidade),
                        preco_unitario = VALUES(preco_unitario),
                        subtotal = VALUES(subtotal)
                `, [
                    item.id,
                    item.pedido_id,
                    item.produto_id,
                    item.codigo,
                    item.descricao,
                    item.quantidade,
                    item.unidade,
                    item.quantidade_parcial,
                    item.local_estoque,
                    item.preco_unitario,
                    item.desconto,
                    item.subtotal,
                    item.icms_percent,
                    item.icms_value,
                    item.pis_percent,
                    item.pis_value,
                    item.cofins_percent,
                    item.cofins_value,
                    item.embalagem,
                    item.lances
                ]);
                inseridos++;
            } catch (err) {
                console.error(`❌ Erro item ${item.id}: ${err.message}`);
                erros++;
            }
        }
        
        console.log(`\n✅ Itens sincronizados: ${inseridos}`);
        console.log(`❌ Erros: ${erros}`);
        
        // Verificar resultado
        const [verificar] = await railway.query(`SELECT COUNT(*) as total FROM pedido_itens`);
        console.log(`\n📊 Total de itens no Railway: ${verificar[0].total}`);
        
    } finally {
        await local.end();
        await railway.end();
    }
}

sincronizarItens();
