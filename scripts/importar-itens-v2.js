/**
 * Script para importar itens dos pedidos do Excel
 * Corrigido para fazer match correto entre clientes do Excel e pedidos do banco
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
        console.log('🚀 Importando ITENS dos pedidos...\n');
        
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
        
        // Criar índices para busca rápida de pedidos
        const pedidosPorClienteId = new Map();
        const pedidosPorNome = new Map();
        
        pedidos.forEach(p => {
            pedidosPorClienteId.set(p.cliente_id, p);
            
            const nomeFantasia = (p.nome_fantasia || '').toUpperCase().trim();
            const razaoSocial = (p.razao_social || '').toUpperCase().trim();
            
            // Mapear por nome fantasia
            if (nomeFantasia) {
                pedidosPorNome.set(nomeFantasia, p);
                // Também mapear por partes do nome
                const partes = nomeFantasia.split(/\s+/);
                if (partes.length > 1) {
                    pedidosPorNome.set(partes.slice(0, 2).join(' '), p);
                }
            }
            
            // Mapear por razão social
            if (razaoSocial) {
                pedidosPorNome.set(razaoSocial, p);
                const partes = razaoSocial.split(/\s+/);
                if (partes.length > 1) {
                    pedidosPorNome.set(partes.slice(0, 2).join(' '), p);
                }
            }
        });
        
        console.log(`📋 Índices de busca criados: ${pedidosPorNome.size} nomes mapeados`);
        
        // Buscar produtos
        const [produtos] = await local.query(`SELECT id, codigo, descricao FROM produtos`);
        const produtosPorCodigo = new Map();
        produtos.forEach(p => {
            if (p.codigo) produtosPorCodigo.set(p.codigo.toUpperCase().trim(), p);
        });
        console.log(`🏷️ Produtos no banco: ${produtos.length}`);
        
        // Limpar TODOS os itens dos pedidos em orçamento
        console.log('\n🧹 Limpando itens antigos...');
        const pedidoIds = pedidos.map(p => p.id);
        if (pedidoIds.length > 0) {
            const [deleted] = await local.query(`DELETE FROM pedido_itens WHERE pedido_id IN (?)`, [pedidoIds]);
            console.log(`   Removidos: ${deleted.affectedRows} itens`);
        }
        
        let itensInseridos = 0;
        let pedidosProcessados = new Set();
        let clientesNaoEncontrados = new Set();
        let erros = 0;
        
        // Função para normalizar nome do cliente
        function normalizarNome(nome) {
            return nome
                .toUpperCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
                .replace(/[^\w\s]/g, ' ') // Remove pontuação
                .replace(/\s+/g, ' ')
                .trim();
        }
        
        // Função para encontrar pedido pelo nome do cliente
        function encontrarPedido(nomeCliente) {
            const nomeNormalizado = normalizarNome(nomeCliente);
            
            // Busca direta
            let pedido = pedidosPorNome.get(nomeNormalizado);
            if (pedido) return pedido;
            
            // Busca parcial - verificar se o nome do Excel contém algum nome do banco
            for (const [nome, p] of pedidosPorNome) {
                const nomeNorm = normalizarNome(nome);
                if (nomeNormalizado.includes(nomeNorm) || nomeNorm.includes(nomeNormalizado)) {
                    return p;
                }
            }
            
            // Busca por primeiras palavras
            const palavras = nomeNormalizado.split(/\s+/);
            if (palavras.length >= 2) {
                const primeiraspalavras = palavras.slice(0, 2).join(' ');
                pedido = pedidosPorNome.get(primeiraspalavras);
                if (pedido) return pedido;
                
                // Buscar em todos os nomes
                for (const [nome, p] of pedidosPorNome) {
                    if (normalizarNome(nome).startsWith(primeiraspalavras)) {
                        return p;
                    }
                }
            }
            
            return null;
        }
        
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
            
            // Dados da linha - Colunas do Excel:
            // [0] Cliente (Nome Fantasia)
            // [2] Descrição do Produto (completa)
            // [3] Descrição do Produto
            // [5] Quantidade
            // [6] Total de Mercadoria
            // [7] Desconto
            // [14] Valor do ICMS
            // [15] Valor do PIS
            // [16] Valor do COFINS
            
            const descricaoCompleta = (row[2] || '').toString().trim();
            const descricaoProduto = (row[3] || descricaoCompleta || '').toString().trim();
            const quantidade = parseFloat(row[5]) || 0;
            const totalMercadoria = parseFloat(row[6]) || 0;
            const desconto = parseFloat(row[7]) || 0;
            const icms = parseFloat(row[14]) || 0;
            const pis = parseFloat(row[15]) || 0;
            const cofins = parseFloat(row[16]) || 0;
            
            // Pular linhas sem produto ou quantidade
            if (!descricaoProduto || quantidade === 0) {
                continue;
            }
            
            // Encontrar pedido do cliente
            const pedido = encontrarPedido(nomeCliente);
            
            if (!pedido) {
                clientesNaoEncontrados.add(nomeCliente);
                continue;
            }
            
            // Extrair código do produto da descrição (formato: CODIGO - DESCRIÇÁO ou similar)
            let codigoProduto = '';
            let descFinal = descricaoProduto;
            
            // Tentar extrair código do início da descrição
            const codigoMatch = descricaoProduto.match(/^([A-Z0-9\-\/]+)\s*[\-:]\s*(.+)$/i);
            if (codigoMatch) {
                codigoProduto = codigoMatch[1].trim();
                descFinal = codigoMatch[2].trim();
            }
            
            // Tentar encontrar produto pelo código
            let produto = null;
            if (codigoProduto) {
                produto = produtosPorCodigo.get(codigoProduto.toUpperCase());
            }
            
            const precoUnitario = quantidade > 0 ? totalMercadoria / quantidade : 0;
            const subtotal = totalMercadoria;
            
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
                pedidosProcessados.add(pedido.id);
            } catch (err) {
                console.error(`❌ Erro ao inserir item para pedido ${pedido.id}: ${err.message}`);
                erros++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMO DA IMPORTAÇÁO DE ITENS:');
        console.log('='.repeat(60));
        console.log(`✅ Itens inseridos: ${itensInseridos}`);
        console.log(`📦 Pedidos com itens: ${pedidosProcessados.size}`);
        console.log(`⚠️ Clientes não encontrados: ${clientesNaoEncontrados.size}`);
        console.log(`❌ Erros: ${erros}`);
        
        if (clientesNaoEncontrados.size > 0) {
            console.log('\nClientes não encontrados:');
            [...clientesNaoEncontrados].slice(0, 20).forEach(c => console.log(`  - ${c}`));
        }
        
        // Verificação final
        console.log('\n📦 Pedidos com mais itens (amostra):');
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
            ORDER BY qtd_itens DESC
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

importarItens();
