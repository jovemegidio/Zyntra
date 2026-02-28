/**
 * Script para importar pedidos do Excel (1316 Pedidos2.xlsx) para o banco
 * Atualiza pedidos existentes ou cria novos baseado no cliente
 */

require('dotenv').config();
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

// Configuração do banco
const dbConfig = {
    host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 19396,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
    database: process.env.DB_NAME || 'railway',
    charset: 'utf8mb4'
};

async function importarPedidos() {
    const pool = await mysql.createPool(dbConfig);
    
    try {
        console.log('🚀 Iniciando importação de pedidos...\n');
        
        // Ler arquivo Excel
        const filePath = 'ordens-emitidas/Pedidos/1316 Pedidos2.xlsx';
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        // Cabeçalhos estão na linha 5 (índice 5)
        const headers = data[5];
        
        // Dados começam na linha 6
        const pedidosData = data.slice(6);
        
        console.log(`📊 Total de linhas no Excel: ${pedidosData.length}`);
        
        // Buscar todos os clientes para fazer o match por nome
        const [clientes] = await pool.query(`
            SELECT id, razao_social, nome_fantasia, cnpj_cpf 
            FROM clientes
        `);
        console.log(`👥 Total de clientes no banco: ${clientes.length}`);
        
        // Criar mapa de clientes por nome
        const clientesPorNome = new Map();
        clientes.forEach(c => {
            const nome = (c.nome_fantasia || c.razao_social || '').toUpperCase().trim();
            if (nome) {
                clientesPorNome.set(nome, c);
            }
        });
        
        let criados = 0;
        let atualizados = 0;
        let clientesNaoEncontrados = [];
        let erros = 0;
        
        // Agrupar por cliente (somar totais)
        const pedidosPorCliente = new Map();
        
        for (const row of pedidosData) {
            const clienteNome = (row[0] || '').toString().trim();
            if (!clienteNome || clienteNome === '' || clienteNome === 'Total Geral') continue;
            
            const previsaoFaturamento = row[1];
            const produtoDescricao = row[3] || row[2] || '';
            const quantidade = parseFloat(row[5]) || 0;
            const totalMercadoria = parseFloat(row[6]) || 0;
            const desconto = parseFloat(row[7]) || 0;
            const icmsST = parseFloat(row[8]) || 0;
            const frete = parseFloat(row[9]) || 0;
            const totalNF = parseFloat(row[13]) || totalMercadoria;
            const icms = parseFloat(row[14]) || 0;
            const pis = parseFloat(row[15]) || 0;
            const cofins = parseFloat(row[16]) || 0;
            const ipi = parseFloat(row[12]) || 0;
            
            // Extrair nome do cliente (sem CNPJ se tiver)
            let nomeCliente = clienteNome;
            const cnpjMatch = clienteNome.match(/^[\d\.\/\-]+\s+(.+)$/);
            if (cnpjMatch) {
                nomeCliente = cnpjMatch[1];
            }
            
            if (!pedidosPorCliente.has(nomeCliente)) {
                pedidosPorCliente.set(nomeCliente, {
                    cliente_nome: nomeCliente,
                    cliente_original: clienteNome,
                    previsao: previsaoFaturamento,
                    produtos: [],
                    total: 0,
                    desconto: 0,
                    frete: 0,
                    icms: 0,
                    icms_st: 0,
                    pis: 0,
                    cofins: 0,
                    ipi: 0,
                    quantidade: 0
                });
            }
            
            const pedido = pedidosPorCliente.get(nomeCliente);
            
            if (produtoDescricao) {
                pedido.produtos.push({
                    descricao: produtoDescricao,
                    quantidade: quantidade,
                    valor: totalMercadoria
                });
            }
            
            pedido.total += totalMercadoria;
            pedido.desconto += desconto;
            pedido.frete += frete;
            pedido.icms += icms;
            pedido.icms_st += icmsST;
            pedido.pis += pis;
            pedido.cofins += cofins;
            pedido.ipi += ipi;
            pedido.quantidade += quantidade;
            
            if (previsaoFaturamento && !pedido.previsao) {
                pedido.previsao = previsaoFaturamento;
            }
        }
        
        console.log(`\n📦 Pedidos únicos por cliente: ${pedidosPorCliente.size}\n`);
        
        // Processar cada pedido agrupado
        for (const [nomeCliente, pedido] of pedidosPorCliente) {
            try {
                // Procurar cliente no banco
                let cliente = clientesPorNome.get(nomeCliente.toUpperCase());
                
                // Se não encontrou, tentar busca parcial
                if (!cliente) {
                    for (const [nome, c] of clientesPorNome) {
                        if (nome.includes(nomeCliente.toUpperCase()) || 
                            nomeCliente.toUpperCase().includes(nome)) {
                            cliente = c;
                            break;
                        }
                    }
                }
                
                if (!cliente) {
                    clientesNaoEncontrados.push(nomeCliente);
                    continue;
                }
                
                // Preparar dados do pedido
                const valor = pedido.total;
                const descricao = pedido.produtos.length > 0 
                    ? pedido.produtos.map(p => `${p.quantidade}x ${p.descricao}`).join('; ')
                    : `Pedido de ${nomeCliente}`;
                
                // Converter data de previsão
                let dataPrevista = null;
                if (pedido.previsao) {
                    if (typeof pedido.previsao === 'number') {
                        const d = new Date((pedido.previsao - 25569) * 86400 * 1000);
                        dataPrevista = d.toISOString().split('T')[0];
                    } else if (typeof pedido.previsao === 'string') {
                        const partes = pedido.previsao.split('/');
                        if (partes.length === 3) {
                            dataPrevista = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
                        }
                    }
                }
                
                // Verificar se já existe pedido para este cliente com valor similar
                const [existentes] = await pool.query(`
                    SELECT id, valor, status FROM pedidos 
                    WHERE cliente_id = ? 
                    AND ABS(valor - ?) < 1
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [cliente.id, valor]);
                
                const produtosPreview = JSON.stringify(pedido.produtos.slice(0, 5));
                
                if (existentes.length > 0) {
                    // Atualizar pedido existente
                    await pool.query(`
                        UPDATE pedidos SET
                            valor = ?,
                            descricao = ?,
                            frete = ?,
                            total_icms = ?,
                            total_icms_st = ?,
                            total_pis = ?,
                            total_cofins = ?,
                            total_ipi = ?,
                            produtos_preview = ?,
                            data_prevista = COALESCE(?, data_prevista)
                        WHERE id = ?
                    `, [
                        valor,
                        descricao.substring(0, 500),
                        pedido.frete,
                        pedido.icms,
                        pedido.icms_st,
                        pedido.pis,
                        pedido.cofins,
                        pedido.ipi,
                        produtosPreview,
                        dataPrevista,
                        existentes[0].id
                    ]);
                    atualizados++;
                    console.log(`🔄 Atualizado: ${nomeCliente} - R$ ${valor.toFixed(2)}`);
                } else {
                    // Criar novo pedido
                    await pool.query(`
                        INSERT INTO pedidos (
                            cliente_id, valor, descricao, status, empresa_id,
                            frete, total_icms, total_icms_st, total_pis, 
                            total_cofins, total_ipi, produtos_preview, data_prevista,
                            created_at
                        ) VALUES (?, ?, ?, 'orcamento', 1, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    `, [
                        cliente.id,
                        valor,
                        descricao.substring(0, 500),
                        pedido.frete,
                        pedido.icms,
                        pedido.icms_st,
                        pedido.pis,
                        pedido.cofins,
                        pedido.ipi,
                        produtosPreview,
                        dataPrevista
                    ]);
                    criados++;
                    console.log(`✅ Criado: ${nomeCliente} - R$ ${valor.toFixed(2)}`);
                }
                
            } catch (err) {
                console.error(`❌ Erro processando ${nomeCliente}:`, err.message);
                erros++;
            }
        }
        
        console.log('\n========================================');
        console.log('📊 RESUMO DA IMPORTAÇÁO');
        console.log('========================================');
        console.log(`✅ Pedidos criados: ${criados}`);
        console.log(`🔄 Pedidos atualizados: ${atualizados}`);
        console.log(`❌ Erros: ${erros}`);
        console.log(`⚠️  Clientes não encontrados: ${clientesNaoEncontrados.length}`);
        
        if (clientesNaoEncontrados.length > 0) {
            console.log('\n📋 Clientes não encontrados no banco:');
            clientesNaoEncontrados.slice(0, 20).forEach(c => console.log(`   - ${c}`));
            if (clientesNaoEncontrados.length > 20) {
                console.log(`   ... e mais ${clientesNaoEncontrados.length - 20}`);
            }
        }
        
        // Mostrar total de pedidos no Kanban
        const [totalPedidos] = await pool.query(`
            SELECT status, COUNT(*) as qtd, SUM(valor) as total 
            FROM pedidos 
            GROUP BY status 
            ORDER BY qtd DESC
        `);
        
        console.log('\n📊 PEDIDOS NO KANBAN:');
        console.log('----------------------------------------');
        totalPedidos.forEach(p => {
            console.log(`   ${p.status}: ${p.qtd} pedidos - R$ ${(p.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
        });
        
    } catch (error) {
        console.error('Erro geral:', error);
    } finally {
        await pool.end();
    }
}

// Executar
importarPedidos();
