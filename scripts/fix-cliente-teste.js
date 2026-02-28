/**
 * Script para substituir pedidos de "Cliente Teste" por clientes aleatórios reais
 * Distribui 2 pedidos por empresa e entre diferentes vendedores
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
    console.log('🔄 Iniciando substituição de pedidos de Cliente Teste...\n');
    
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
        port: parseInt(process.env.DB_PORT || '19396'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: process.env.DB_NAME || 'railway',
        charset: 'utf8mb4'
    });

    try {
        // 1. Buscar todos os clientes reais (excluindo "teste")
        console.log('📋 Buscando clientes reais...');
        const [clientes] = await pool.query(`
            SELECT id, razao_social, nome_fantasia, cnpj_cpf, email, telefone
            FROM clientes
            WHERE (razao_social NOT LIKE '%teste%' OR razao_social IS NULL)
              AND (nome_fantasia NOT LIKE '%teste%' OR nome_fantasia IS NULL)
            ORDER BY RAND()
            LIMIT 500
        `);
        
        console.log(`   ✅ ${clientes.length} clientes reais encontrados\n`);
        
        if (clientes.length === 0) {
            console.log('❌ Nenhum cliente real encontrado no banco!');
            process.exit(1);
        }
        
        // 2. Buscar pedidos de "Cliente Teste"
        console.log('📋 Buscando pedidos de "Cliente Teste"...');
        const [pedidosTeste] = await pool.query(`
            SELECT id, cliente_id, cliente_nome, vendedor_id
            FROM pedidos
            WHERE cliente_nome LIKE '%Cliente Teste%' OR cliente_nome LIKE '%teste%'
            ORDER BY id
        `);
        
        console.log(`   ✅ ${pedidosTeste.length} pedidos de teste encontrados\n`);
        
        if (pedidosTeste.length === 0) {
            console.log('✅ Nenhum pedido de "Cliente Teste" encontrado!');
            pool.end();
            return;
        }
        
        // 3. Buscar vendedores ativos
        console.log('📋 Buscando vendedores ativos...');
        const [vendedores] = await pool.query(`
            SELECT id, nome, email
            FROM usuarios
            WHERE (role = 'vendedor' OR role = 'comercial' OR permissoes_vendas IS NOT NULL)
              AND (status IS NULL OR status != 'inativo')
            ORDER BY RAND()
        `);
        
        console.log(`   ✅ ${vendedores.length} vendedores encontrados\n`);
        
        // 4. Preparar mapeamento de clientes (máximo 2 pedidos por cliente)
        const clienteUsage = new Map(); // cliente_id -> quantidade de pedidos
        let clienteIndex = 0;
        let vendedorIndex = 0;
        
        console.log('🔄 Substituindo pedidos...\n');
        
        for (const pedido of pedidosTeste) {
            // Encontrar próximo cliente com menos de 2 pedidos
            let cliente = null;
            let attempts = 0;
            
            while (attempts < clientes.length) {
                const candidato = clientes[clienteIndex % clientes.length];
                const usage = clienteUsage.get(candidato.id) || 0;
                
                if (usage < 2) {
                    cliente = candidato;
                    clienteUsage.set(candidato.id, usage + 1);
                    break;
                }
                
                clienteIndex++;
                attempts++;
            }
            
            if (!cliente) {
                // Se todos os clientes já têm 2 pedidos, resetar contagem
                clienteUsage.clear();
                cliente = clientes[clienteIndex % clientes.length];
                clienteUsage.set(cliente.id, 1);
            }
            
            clienteIndex++;
            
            // Selecionar vendedor rotacionando
            const vendedor = vendedores.length > 0 
                ? vendedores[vendedorIndex % vendedores.length] 
                : null;
            vendedorIndex++;
            
            // Nome do cliente
            const clienteNome = cliente.nome_fantasia || cliente.razao_social || `Cliente ${cliente.id}`;
            
            // Atualizar pedido
            await pool.query(`
                UPDATE pedidos SET
                    cliente_id = ?,
                    cliente_nome = ?,
                    cliente_cnpj = ?,
                    cliente_email = ?,
                    cliente_telefone = ?
                    ${vendedor ? ', vendedor_id = ?, vendedor_nome = ?' : ''}
                WHERE id = ?
            `, vendedor 
                ? [cliente.id, clienteNome, cliente.cnpj_cpf, cliente.email, cliente.telefone, vendedor.id, vendedor.nome, pedido.id]
                : [cliente.id, clienteNome, cliente.cnpj_cpf, cliente.email, cliente.telefone, pedido.id]
            );
            
            console.log(`   ✅ Pedido #${pedido.id}: "${pedido.cliente_nome}" → "${clienteNome}"${vendedor ? ` (${vendedor.nome})` : ''}`);
        }
        
        console.log(`\n✅ ${pedidosTeste.length} pedidos atualizados com sucesso!`);
        
    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        pool.end();
    }
}

main();
