/**
 * Script para verificar e substituir pedidos de clientes teste
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
    console.log('🔄 Iniciando análise de pedidos...\n');
    
    console.log('Conectando ao banco:', process.env.DB_HOST, ':', process.env.DB_PORT);
    
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        // 1. Verificar estrutura de clientes
        console.log('\n📋 Verificando tabela clientes...');
        const [clienteCols] = await pool.query('DESCRIBE clientes');
        const colNames = clienteCols.map(c => c.Field);
        console.log('   Colunas:', colNames.slice(0, 8).join(', '), '...');
        
        // 2. Buscar clientes com "teste" no nome
        console.log('\n📋 Buscando clientes "teste"...');
        const [clientesTeste] = await pool.query(`
            SELECT id, razao_social, nome_fantasia 
            FROM clientes 
            WHERE razao_social LIKE '%teste%' 
               OR nome_fantasia LIKE '%teste%'
            LIMIT 10
        `);
        console.log(`   ✅ ${clientesTeste.length} clientes teste encontrados`);
        clientesTeste.forEach(c => {
            console.log(`      - ID: ${c.id}, Nome: ${c.razao_social || c.nome_fantasia}`);
        });
        
        if (clientesTeste.length === 0) {
            console.log('\n✅ Nenhum cliente "teste" encontrado no banco!');
            pool.end();
            return;
        }
        
        // 3. Buscar pedidos desses clientes
        const clienteIds = clientesTeste.map(c => c.id);
        console.log('\n📋 Buscando pedidos desses clientes...');
        const [pedidos] = await pool.query(`
            SELECT p.id, p.cliente_id, p.vendedor_id, p.valor, p.status,
                   c.razao_social, c.nome_fantasia
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.cliente_id IN (?)
            LIMIT 50
        `, [clienteIds]);
        console.log(`   ✅ ${pedidos.length} pedidos encontrados de clientes teste`);
        
        if (pedidos.length === 0) {
            console.log('\n✅ Nenhum pedido de cliente teste encontrado!');
            pool.end();
            return;
        }
        
        // 4. Buscar clientes reais para substituição
        console.log('\n📋 Buscando clientes reais para substituição...');
        const [clientesReais] = await pool.query(`
            SELECT id, razao_social, nome_fantasia
            FROM clientes
            WHERE razao_social NOT LIKE '%teste%'
              AND nome_fantasia NOT LIKE '%teste%'
              AND (razao_social IS NOT NULL OR nome_fantasia IS NOT NULL)
            ORDER BY RAND()
            LIMIT 200
        `);
        console.log(`   ✅ ${clientesReais.length} clientes reais disponíveis`);
        
        // 5. Substituir pedidos
        console.log('\n🔄 Substituindo pedidos...');
        
        const clienteUsage = new Map();
        let clienteIdx = 0;
        let updated = 0;
        
        for (const pedido of pedidos) {
            // Encontrar cliente com menos de 2 pedidos
            let novoCliente = null;
            let attempts = 0;
            
            while (attempts < clientesReais.length) {
                const candidato = clientesReais[clienteIdx % clientesReais.length];
                const usage = clienteUsage.get(candidato.id) || 0;
                
                if (usage < 2) {
                    novoCliente = candidato;
                    clienteUsage.set(candidato.id, usage + 1);
                    clienteIdx++;
                    break;
                }
                
                clienteIdx++;
                attempts++;
            }
            
            if (!novoCliente) {
                clienteUsage.clear();
                novoCliente = clientesReais[0];
                clienteUsage.set(novoCliente.id, 1);
            }
            
            const nomeAntigo = pedido.razao_social || pedido.nome_fantasia || `ID: ${pedido.cliente_id}`;
            const nomeNovo = novoCliente.razao_social || novoCliente.nome_fantasia;
            
            await pool.query('UPDATE pedidos SET cliente_id = ? WHERE id = ?', [novoCliente.id, pedido.id]);
            updated++;
            
            console.log(`   ✅ Pedido #${pedido.id}: "${nomeAntigo}" → "${nomeNovo}"`);
        }
        
        console.log(`\n✅ ${updated} pedidos atualizados com sucesso!`);
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        console.error(error.stack);
    } finally {
        pool.end();
    }
}

main();
