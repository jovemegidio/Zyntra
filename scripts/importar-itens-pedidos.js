/**
 * Script para importar os ITENS dos pedidos do Excel (1316 Pedidos2.xlsx)
 * Os pedidos já foram importados, agora precisamos inserir os itens individuais
 */

require('dotenv').config();
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

// Usando banco local
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '@dminalu',
    database: 'aluforce_vendas',
    charset: 'utf8mb4'
};

async function importarItens() {
    const pool = await mysql.createPool(dbConfig);
    
    try {
        console.log('🚀 Iniciando importação de ITENS dos pedidos...\n');
        
        // Ler arquivo Excel
        const filePath = 'ordens-emitidas/Pedidos/1316 Pedidos2.xlsx';
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        // Mostrar cabeçalhos para referência
        console.log('📋 Cabeçalhos do Excel (linha 6):');
        const headers = data[5];
        headers.forEach((h, i) => console.log(`  [${i}] ${h}`));
        
        // Dados começam na linha 6 (índice 6)
        const linhasData = data.slice(6);
        
        console.log(`\n📊 Total de linhas de dados: ${linhasData.length}`);
        
        // Buscar todos os clientes
        const [clientes] = await pool.query(`
            SELECT id, razao_social, nome_fantasia, cnpj_cpf 
            FROM clientes
        `);
        console.log(`👥 Clientes no banco: ${clientes.length}`);
        
        // Mapa de clientes por nome
        const clientesPorNome = new Map();
        clientes.forEach(c => {
            const nomeFantasia = (c.nome_fantasia || '').toUpperCase().trim();
            const razaoSocial = (c.razao_social || '').toUpperCase().trim();
            if (nomeFantasia) clientesPorNome.set(nomeFantasia, c);
            if (razaoSocial) clientesPorNome.set(razaoSocial, c);
        });
        
        // Buscar pedidos existentes
        const [pedidos] = await pool.query(`
            SELECT id, cliente_id, valor, descricao 
            FROM pedidos 
            WHERE status = 'orcamento'
        `);
        console.log(`📦 Pedidos no status orçamento: ${pedidos.length}`);
        
        // Mapa de pedidos por cliente_id
        const pedidosPorCliente = new Map();
        pedidos.forEach(p => {
            if (!pedidosPorCliente.has(p.cliente_id)) {
                pedidosPorCliente.set(p.cliente_id, []);
            }
            pedidosPorCliente.get(p.cliente_id).push(p);
        });
        
        // Buscar produtos existentes para fazer match
        const [produtos] = await pool.query(`
            SELECT id, codigo, descricao 
            FROM produtos
        `);
        console.log(`🏷️ Produtos no banco: ${produtos.length}`);
        
        // Mapa de produtos por código e descrição
        const produtosPorCodigo = new Map();
        const produtosPorDescricao = new Map();
        produtos.forEach(p => {
            if (p.codigo) produtosPorCodigo.set(p.codigo.toUpperCase().trim(), p);
            if (p.descricao) produtosPorDescricao.set(p.descricao.toUpperCase().trim(), p);
        });
        
        // Limpar itens existentes dos pedidos que vamos importar
        console.log('\n🧹 Limpando itens antigos dos pedidos em orçamento...');
        const pedidoIds = pedidos.map(p => p.id);
        if (pedidoIds.length > 0) {
            await pool.query(
                `DELETE FROM pedido_itens WHERE pedido_id IN (?)`,
                [pedidoIds]
            );
        }
        
        let itensInseridos = 0;
        let clientesNaoEncontrados = new Set();
        let erros = 0;
        
        // Processar cada linha do Excel
        for (const row of linhasData) {
            const clienteNomeOriginal = (row[0] || '').toString().trim();
            if (!clienteNomeOriginal || clienteNomeOriginal === '' || 
                clienteNomeOriginal === 'Total Geral' || clienteNomeOriginal === 'Total geral') {
                continue;
            }
            
            // Extrair nome do cliente (pode ter CNPJ na frente)
            let nomeCliente = clienteNomeOriginal;
            const cnpjMatch = clienteNomeOriginal.match(/^[\d\.\/\-]+\s+(.+)$/);
            if (cnpjMatch) {
                nomeCliente = cnpjMatch[1];
            }
            
            // Dados da linha
            // [0] Cliente
            // [1] Previsão Faturamento
            // [2] Código ou descrição
            // [3] Descrição do produto
            // [4] ? 
            // [5] Quantidade
            // [6] Total Mercadoria
            // [7] Desconto
            // [8] ICMS ST
            // [9] Frete
            // [10] Outras Despesas
            // [11] Seguro
            // [12] IPI
            // [13] Total NF
            // [14] ICMS
            // [15] PIS
            // [16] COFINS
            
            const codigoProduto = (row[2] || '').toString().trim();
            const descricaoProduto = (row[3] || row[2] || '').toString().trim();
            const quantidade = parseFloat(row[5]) || 0;
            const totalMercadoria = parseFloat(row[6]) || 0;
            const desconto = parseFloat(row[7]) || 0;
            const icmsST = parseFloat(row[8]) || 0;
            const frete = parseFloat(row[9]) || 0;
            const ipi = parseFloat(row[12]) || 0;
            const icms = parseFloat(row[14]) || 0;
            const pis = parseFloat(row[15]) || 0;
            const cofins = parseFloat(row[16]) || 0;
            
            // Pular linhas sem produto
            if (!descricaoProduto || quantidade === 0) {
                continue;
            }
            
            // Encontrar cliente
            let cliente = clientesPorNome.get(nomeCliente.toUpperCase());
            if (!cliente) {
                // Tentar busca parcial
                for (const [nome, c] of clientesPorNome) {
                    if (nome.includes(nomeCliente.toUpperCase()) || 
                        nomeCliente.toUpperCase().includes(nome)) {
                        cliente = c;
                        break;
                    }
                }
            }
            
            if (!cliente) {
                clientesNaoEncontrados.add(nomeCliente);
                continue;
            }
            
            // Encontrar pedido do cliente
            const pedidosDoCliente = pedidosPorCliente.get(cliente.id);
            if (!pedidosDoCliente || pedidosDoCliente.length === 0) {
                console.log(`⚠️ Nenhum pedido encontrado para cliente ${nomeCliente} (ID: ${cliente.id})`);
                continue;
            }
            
            // Usar o primeiro pedido do cliente (ou o mais recente)
            const pedido = pedidosDoCliente[0];
            
            // Tentar encontrar produto pelo código ou descrição
            let produto = null;
            if (codigoProduto) {
                produto = produtosPorCodigo.get(codigoProduto.toUpperCase());
            }
            if (!produto && descricaoProduto) {
                produto = produtosPorDescricao.get(descricaoProduto.toUpperCase());
                // Busca parcial
                if (!produto) {
                    for (const [desc, p] of produtosPorDescricao) {
                        if (desc.includes(descricaoProduto.toUpperCase()) || 
                            descricaoProduto.toUpperCase().includes(desc)) {
                            produto = p;
                            break;
                        }
                    }
                }
            }
            
            // Calcular preço unitário
            const precoUnitario = quantidade > 0 ? totalMercadoria / quantidade : 0;
            const subtotal = totalMercadoria;
            
            // Calcular percentuais de impostos
            const icmsPercent = totalMercadoria > 0 ? (icms / totalMercadoria) * 100 : 0;
            const pisPercent = totalMercadoria > 0 ? (pis / totalMercadoria) * 100 : 0;
            const cofinsPercent = totalMercadoria > 0 ? (cofins / totalMercadoria) * 100 : 0;
            
            try {
                // Inserir item
                await pool.query(`
                    INSERT INTO pedido_itens (
                        pedido_id, produto_id, codigo, descricao, quantidade,
                        unidade, preco_unitario, desconto, subtotal,
                        icms_percent, icms_value, pis_percent, pis_value,
                        cofins_percent, cofins_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    pedido.id,
                    produto ? produto.id : null,
                    codigoProduto || (produto ? produto.codigo : ''),
                    descricaoProduto,
                    quantidade,
                    'UN',
                    precoUnitario,
                    desconto,
                    subtotal,
                    icmsPercent,
                    icms,
                    pisPercent,
                    pis,
                    cofinsPercent,
                    cofins
                ]);
                
                itensInseridos++;
            } catch (err) {
                console.error(`❌ Erro ao inserir item: ${err.message}`);
                erros++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMO DA IMPORTAÇÁO DE ITENS:');
        console.log('='.repeat(60));
        console.log(`✅ Itens inseridos: ${itensInseridos}`);
        console.log(`❌ Erros: ${erros}`);
        console.log(`⚠️ Clientes não encontrados: ${clientesNaoEncontrados.size}`);
        
        if (clientesNaoEncontrados.size > 0) {
            console.log('\nClientes não encontrados:');
            [...clientesNaoEncontrados].slice(0, 10).forEach(c => console.log(`  - ${c}`));
        }
        
        // Verificar quantidade de itens por pedido
        console.log('\n📦 Verificando itens por pedido (amostra):');
        const [verificacao] = await pool.query(`
            SELECT p.id, c.nome_fantasia, p.valor,
                   COUNT(pi.id) as qtd_itens,
                   SUM(pi.subtotal) as total_itens
            FROM pedidos p
            JOIN clientes c ON c.id = p.cliente_id
            LEFT JOIN pedido_itens pi ON pi.pedido_id = p.id
            WHERE p.status = 'orcamento'
            GROUP BY p.id
            ORDER BY qtd_itens DESC
            LIMIT 10
        `);
        console.table(verificacao.map(v => ({
            Pedido: v.id,
            Cliente: v.nome_fantasia?.substring(0, 30),
            Valor: v.valor,
            Itens: v.qtd_itens,
            TotalItens: v.total_itens
        })));
        
    } catch (error) {
        console.error('❌ Erro geral:', error);
    } finally {
        await pool.end();
    }
}

importarItens();
