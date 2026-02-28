/**
 * Script para atualizar os pedidos importados com:
 * - Vendedor padrão
 * - Data de previsão de faturamento (do Excel)
 * - Cenário fiscal padrão
 */

require('dotenv').config();
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

const localConfig = {
    host: 'localhost',
    user: 'root',
    password: '@dminalu',
    database: 'aluforce_vendas',
    charset: 'utf8mb4'
};

async function atualizarPedidos() {
    const pool = await mysql.createPool(localConfig);
    
    try {
        console.log('🚀 Atualizando dados dos pedidos importados...\n');
        
        // Ler Excel para pegar as datas de previsão
        const filePath = 'ordens-emitidas/Pedidos/1316 Pedidos2.xlsx';
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        // Criar mapa de previsões por cliente
        const previsoesPorCliente = new Map();
        const linhasData = data.slice(6);
        
        for (const row of linhasData) {
            const clienteNome = (row[0] || '').toString().trim();
            const previsao = row[1]; // Coluna "Previsão de Faturamento (completa)"
            
            if (clienteNome && !clienteNome.toLowerCase().includes('total')) {
                // Extrair nome (remover CNPJ se tiver)
                let nome = clienteNome;
                const cnpjMatch = clienteNome.match(/^[\d\.\/\-]+\s+(.+)$/);
                if (cnpjMatch) nome = cnpjMatch[1];
                
                // Converter data
                let dataPrevista = null;
                if (previsao) {
                    if (typeof previsao === 'number') {
                        // Excel date serial number
                        const d = new Date((previsao - 25569) * 86400 * 1000);
                        dataPrevista = d.toISOString().split('T')[0];
                    } else if (typeof previsao === 'string' && previsao.includes('/')) {
                        const partes = previsao.split('/');
                        if (partes.length === 3) {
                            dataPrevista = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
                        }
                    }
                }
                
                if (dataPrevista) {
                    previsoesPorCliente.set(nome.toUpperCase(), dataPrevista);
                }
            }
        }
        
        console.log(`📅 Previsões encontradas: ${previsoesPorCliente.size}`);
        
        // Buscar um vendedor padrão
        const [vendedores] = await pool.query(`
            SELECT id, nome FROM usuarios 
            WHERE role IN ('admin', 'vendedor') 
            AND is_admin = 1
            LIMIT 1
        `);
        
        let vendedorPadraoId = null;
        if (vendedores.length > 0) {
            vendedorPadraoId = vendedores[0].id;
            console.log(`👤 Vendedor padrão: ${vendedores[0].nome} (ID: ${vendedorPadraoId})`);
        } else {
            // Criar vendedor padrão se não existir
            console.log('⚠️ Nenhum vendedor encontrado, buscando qualquer usuário admin...');
            const [admins] = await pool.query(`SELECT id, nome FROM usuarios WHERE is_admin = 1 LIMIT 1`);
            if (admins.length > 0) {
                vendedorPadraoId = admins[0].id;
                console.log(`👤 Usando admin como vendedor: ${admins[0].nome} (ID: ${vendedorPadraoId})`);
            }
        }
        
        // Buscar pedidos em orçamento que precisam de atualização
        const [pedidos] = await pool.query(`
            SELECT p.id, p.cliente_id, c.nome_fantasia, c.razao_social,
                   p.vendedor_id, p.data_prevista, p.cenario_fiscal_id
            FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            WHERE p.status = 'orcamento'
        `);
        
        console.log(`📦 Pedidos a atualizar: ${pedidos.length}`);
        
        let atualizados = 0;
        let comVendedor = 0;
        let comPrevisao = 0;
        
        for (const pedido of pedidos) {
            const updates = [];
            const params = [];
            
            // Atualizar vendedor se não tiver
            if (!pedido.vendedor_id && vendedorPadraoId) {
                updates.push('vendedor_id = ?');
                params.push(vendedorPadraoId);
                comVendedor++;
            }
            
            // Atualizar data prevista se não tiver
            if (!pedido.data_prevista) {
                const nomeCliente = (pedido.nome_fantasia || pedido.razao_social || '').toUpperCase();
                
                // Buscar previsão
                let previsao = previsoesPorCliente.get(nomeCliente);
                
                // Busca parcial
                if (!previsao) {
                    for (const [nome, data] of previsoesPorCliente) {
                        if (nomeCliente.includes(nome) || nome.includes(nomeCliente)) {
                            previsao = data;
                            break;
                        }
                    }
                }
                
                if (previsao) {
                    updates.push('data_prevista = ?');
                    params.push(previsao);
                    comPrevisao++;
                }
            }
            
            // Atualizar cenário fiscal se não tiver
            if (!pedido.cenario_fiscal_id) {
                updates.push('cenario_fiscal_id = 1');
            }
            
            // Aplicar atualizações
            if (updates.length > 0) {
                params.push(pedido.id);
                await pool.query(
                    `UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`,
                    params
                );
                atualizados++;
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 RESUMO DAS ATUALIZAÇÕES:');
        console.log('='.repeat(50));
        console.log(`✅ Pedidos atualizados: ${atualizados}`);
        console.log(`👤 Com vendedor: ${comVendedor}`);
        console.log(`📅 Com previsão: ${comPrevisao}`);
        
        // Verificar resultado
        console.log('\n📋 Amostra de pedidos atualizados:');
        const [amostra] = await pool.query(`
            SELECT p.id, 
                   SUBSTRING(c.nome_fantasia, 1, 25) as cliente,
                   u.nome as vendedor,
                   DATE_FORMAT(p.data_prevista, '%d/%m/%Y') as previsao,
                   p.valor
            FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            LEFT JOIN usuarios u ON u.id = p.vendedor_id
            WHERE p.status = 'orcamento'
            LIMIT 10
        `);
        console.table(amostra);
        
    } finally {
        await pool.end();
    }
}

atualizarPedidos();
