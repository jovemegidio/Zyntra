/**
 * Script para importar itens dos pedidos do Excel
 * O Excel é um resumo por cliente - cada linha = 1 item (resumo)
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

async function importarItens() {
    const local = await mysql.createPool(localConfig);
    
    try {
        console.log('🚀 Importando ITENS dos pedidos (1 item resumo por pedido)...\n');
        
        // Ler arquivo Excel
        const filePath = 'ordens-emitidas/Pedidos/1316 Pedidos2.xlsx';
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        // Dados começam na linha 6 (índice 6)
        const linhasData = data.slice(6);
        console.log(`📊 Linhas no Excel: ${linhasData.length}`);
        
        // Buscar TODOS os pedidos em orçamento com dados do cliente
        const [pedidos] = await local.query(`
            SELECT p.id, p.cliente_id, p.valor, p.status, p.descricao,
                   c.nome_fantasia, c.razao_social
            FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            WHERE p.status = 'orcamento'
        `);
        console.log(`📦 Pedidos em orçamento: ${pedidos.length}`);
        
        // Criar índices para busca de pedidos por nome do cliente
        const pedidosPorNome = new Map();
        
        pedidos.forEach(p => {
            // Normalizar e mapear por nome fantasia
            const nomeFantasia = normalizar(p.nome_fantasia || '');
            const razaoSocial = normalizar(p.razao_social || '');
            
            if (nomeFantasia) {
                pedidosPorNome.set(nomeFantasia, p);
                // Também primeiras palavras
                const palavras = nomeFantasia.split(/\s+/);
                if (palavras.length >= 2) {
                    pedidosPorNome.set(palavras.slice(0, 2).join(' '), p);
                    pedidosPorNome.set(palavras.slice(0, 3).join(' '), p);
                }
            }
            
            if (razaoSocial && razaoSocial !== nomeFantasia) {
                pedidosPorNome.set(razaoSocial, p);
                const palavras = razaoSocial.split(/\s+/);
                if (palavras.length >= 2) {
                    pedidosPorNome.set(palavras.slice(0, 2).join(' '), p);
                }
            }
        });
        
        console.log(`📋 Índices criados: ${pedidosPorNome.size} mapeamentos`);
        
        // Limpar TODOS os itens dos pedidos em orçamento
        console.log('\n🧹 Limpando itens antigos...');
        const pedidoIds = pedidos.map(p => p.id);
        if (pedidoIds.length > 0) {
            const [deleted] = await local.query(`DELETE FROM pedido_itens WHERE pedido_id IN (?)`, [pedidoIds]);
            console.log(`   Removidos: ${deleted.affectedRows} itens`);
        }
        
        let itensInseridos = 0;
        let pedidosProcessados = new Set();
        let clientesNaoEncontrados = [];
        let erros = 0;
        
        // Processar cada linha do Excel
        for (const row of linhasData) {
            const clienteNomeOriginal = (row[0] || '').toString().trim();
            if (!clienteNomeOriginal || clienteNomeOriginal === '' || 
                clienteNomeOriginal.toLowerCase().includes('total')) {
                continue;
            }
            
            // Extrair nome do cliente (remover CNPJ se presente)
            let nomeCliente = clienteNomeOriginal;
            const cnpjMatch = clienteNomeOriginal.match(/^[\d\.\/\-]+\s+(.+)$/);
            if (cnpjMatch) {
                nomeCliente = cnpjMatch[1];
            }
            
            // Dados da linha
            const descricaoCompleta = (row[2] || '').toString().trim();
            const descricaoProduto = (row[3] || '').toString().trim();
            const quantidade = parseFloat(row[5]) || 0;
            const totalMercadoria = parseFloat(row[6]) || 0;
            const desconto = parseFloat(row[7]) || 0;
            const icms = parseFloat(row[14]) || 0;
            const pis = parseFloat(row[15]) || 0;
            const cofins = parseFloat(row[16]) || 0;
            
            // Pular linhas sem quantidade ou valor
            if (quantidade === 0 || totalMercadoria === 0) {
                continue;
            }
            
            // Encontrar pedido do cliente
            const pedido = encontrarPedido(nomeCliente, pedidosPorNome);
            
            if (!pedido) {
                clientesNaoEncontrados.push({
                    nome: nomeCliente,
                    qtde: quantidade,
                    valor: totalMercadoria
                });
                continue;
            }
            
            // Definir descrição do item
            // Se tem descrição de produto usa ela, senão cria uma genérica
            let descricaoItem;
            let codigoProduto = '';
            
            if (descricaoCompleta) {
                // Extrair código se existir (formato: CODIGO - DESCRIÇÁO)
                const match = descricaoCompleta.match(/^([A-Z0-9]+)\s*-\s*(.+)$/i);
                if (match) {
                    codigoProduto = match[1].trim();
                    descricaoItem = descricaoCompleta;
                } else {
                    descricaoItem = descricaoCompleta;
                }
            } else if (descricaoProduto) {
                descricaoItem = descricaoProduto;
            } else {
                // Criar descrição genérica baseada na descrição do pedido
                descricaoItem = `Produtos diversos - ${quantidade} unidades`;
            }
            
            const precoUnitario = quantidade > 0 ? totalMercadoria / quantidade : 0;
            
            const icmsPercent = totalMercadoria > 0 ? (icms / totalMercadoria) * 100 : 0;
            const pisPercent = totalMercadoria > 0 ? (pis / totalMercadoria) * 100 : 0;
            const cofinsPercent = totalMercadoria > 0 ? (cofins / totalMercadoria) * 100 : 0;
            
            try {
                await local.query(`
                    INSERT INTO pedido_itens (
                        pedido_id, produto_id, codigo, descricao, quantidade,
                        unidade, preco_unitario, desconto, subtotal,
                        icms_percent, icms_value, pis_percent, pis_value,
                        cofins_percent, cofins_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    pedido.id,
                    null,  // produto_id - não temos
                    codigoProduto,
                    descricaoItem,
                    quantidade,
                    'UN',
                    precoUnitario,
                    desconto,
                    totalMercadoria,
                    icmsPercent,
                    icms,
                    pisPercent,
                    pis,
                    cofinsPercent,
                    cofins
                ]);
                
                itensInseridos++;
                pedidosProcessados.add(pedido.id);
            } catch (err) {
                console.error(`❌ Erro pedido ${pedido.id}: ${err.message}`);
                erros++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMO DA IMPORTAÇÁO DE ITENS:');
        console.log('='.repeat(60));
        console.log(`✅ Itens inseridos: ${itensInseridos}`);
        console.log(`📦 Pedidos com itens: ${pedidosProcessados.size}`);
        console.log(`⚠️ Clientes não encontrados: ${clientesNaoEncontrados.length}`);
        console.log(`❌ Erros: ${erros}`);
        
        if (clientesNaoEncontrados.length > 0) {
            console.log('\n⚠️ Clientes do Excel não encontrados nos pedidos:');
            clientesNaoEncontrados.slice(0, 15).forEach(c => 
                console.log(`  - ${c.nome} (${c.qtde} un, R$ ${c.valor.toFixed(2)})`));
            if (clientesNaoEncontrados.length > 15) {
                console.log(`  ... e mais ${clientesNaoEncontrados.length - 15}`);
            }
        }
        
        // Verificação final
        console.log('\n📦 Pedidos com itens (amostra):');
        const [verificacao] = await local.query(`
            SELECT p.id, 
                   SUBSTRING(c.nome_fantasia, 1, 35) as cliente,
                   ROUND(p.valor, 2) as valor_pedido,
                   COUNT(pi.id) as qtd_itens,
                   ROUND(COALESCE(SUM(pi.subtotal), 0), 2) as total_itens
            FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            LEFT JOIN pedido_itens pi ON pi.pedido_id = p.id
            WHERE p.status = 'orcamento'
            GROUP BY p.id
            HAVING qtd_itens > 0
            ORDER BY total_itens DESC
            LIMIT 15
        `);
        console.table(verificacao);
        
        // Total de itens
        const [totalItens] = await local.query(`SELECT COUNT(*) as total FROM pedido_itens`);
        console.log(`\n📊 Total de itens na tabela pedido_itens: ${totalItens[0].total}`);
        
        // Verificar pedidos sem itens
        const [semItens] = await local.query(`
            SELECT COUNT(*) as total 
            FROM pedidos p
            LEFT JOIN pedido_itens pi ON pi.pedido_id = p.id
            WHERE p.status = 'orcamento' AND pi.id IS NULL
        `);
        console.log(`⚠️ Pedidos em orçamento sem itens: ${semItens[0].total}`);
        
    } finally {
        await local.end();
    }
}

// Função para normalizar nome (remover acentos, pontuação, etc)
function normalizar(nome) {
    if (!nome) return '';
    return nome
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Função para encontrar pedido pelo nome do cliente
function encontrarPedido(nomeCliente, mapaPedidos) {
    const nomeNorm = normalizar(nomeCliente);
    
    // Busca direta
    let pedido = mapaPedidos.get(nomeNorm);
    if (pedido) return pedido;
    
    // Busca por primeiras palavras
    const palavras = nomeNorm.split(/\s+/);
    if (palavras.length >= 2) {
        pedido = mapaPedidos.get(palavras.slice(0, 2).join(' '));
        if (pedido) return pedido;
        
        pedido = mapaPedidos.get(palavras.slice(0, 3).join(' '));
        if (pedido) return pedido;
    }
    
    // Busca parcial
    for (const [nome, p] of mapaPedidos) {
        if (nomeNorm.includes(nome) || nome.includes(nomeNorm)) {
            return p;
        }
    }
    
    // Busca por similaridade (pelo menos 2 primeiras palavras iguais)
    for (const [nome, p] of mapaPedidos) {
        const palavrasNome = nome.split(/\s+/);
        if (palavras.length >= 2 && palavrasNome.length >= 2) {
            if (palavras[0] === palavrasNome[0] && palavras[1] === palavrasNome[1]) {
                return p;
            }
        }
    }
    
    return null;
}

importarItens();
