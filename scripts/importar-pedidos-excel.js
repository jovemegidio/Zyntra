/**
 * Script para importar pedidos do Excel para o banco de dados
 * Atualiza pedidos existentes ou cria novos
 */

require('dotenv').config();
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');
const path = require('path');

// Configuração do banco
const dbConfig = {
    host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 19396,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
    database: process.env.DB_NAME || 'railway',
    charset: 'utf8mb4'
};

async function analisarExcel(filePath) {
    console.log('\n📊 Analisando arquivo:', filePath);
    
    const workbook = XLSX.readFile(filePath);
    console.log('📑 Planilhas encontradas:', workbook.SheetNames);
    
    // Analisar cada planilha
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        console.log(`\n--- Planilha: ${sheetName} ---`);
        console.log(`Linhas: ${data.length}`);
        
        if (data.length > 0) {
            console.log('Cabeçalhos:', data[0]);
            if (data.length > 1) {
                console.log('Primeira linha de dados:', data[1]);
            }
        }
    }
    
    return workbook;
}

async function importarPedidos(filePath) {
    const pool = await mysql.createPool(dbConfig);
    
    try {
        console.log('\n🔄 Iniciando importação de pedidos...');
        
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const dados = XLSX.utils.sheet_to_json(sheet);
        
        console.log(`📊 Total de registros no Excel: ${dados.length}`);
        
        // Mostrar colunas disponíveis
        if (dados.length > 0) {
            console.log('\n📋 Colunas disponíveis:');
            Object.keys(dados[0]).forEach(col => console.log(`  - ${col}`));
        }
        
        let criados = 0;
        let atualizados = 0;
        let erros = 0;
        
        for (const row of dados) {
            try {
                // Mapear campos do Excel para campos do banco
                const pedido = mapearCampos(row);
                
                if (!pedido.numero_pedido && !pedido.codigo_cliente) {
                    continue; // Pular linhas vazias
                }
                
                // Verificar se pedido já existe
                const [existente] = await pool.query(
                    'SELECT id FROM pedidos WHERE numero_pedido = ? OR (cliente_id = ? AND data_pedido = ?)',
                    [pedido.numero_pedido, pedido.cliente_id, pedido.data_pedido]
                );
                
                if (existente.length > 0) {
                    // Atualizar pedido existente
                    await pool.query(`
                        UPDATE pedidos SET
                            cliente_id = COALESCE(?, cliente_id),
                            valor_total = COALESCE(?, valor_total),
                            status = COALESCE(?, status),
                            observacoes = COALESCE(?, observacoes),
                            updated_at = NOW()
                        WHERE id = ?
                    `, [pedido.cliente_id, pedido.valor_total, pedido.status, pedido.observacoes, existente[0].id]);
                    atualizados++;
                } else {
                    // Criar novo pedido
                    await pool.query(`
                        INSERT INTO pedidos (
                            numero_pedido, cliente_id, data_pedido, valor_total, 
                            status, observacoes, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
                    `, [
                        pedido.numero_pedido,
                        pedido.cliente_id,
                        pedido.data_pedido,
                        pedido.valor_total,
                        pedido.status || 'novo',
                        pedido.observacoes
                    ]);
                    criados++;
                }
            } catch (err) {
                console.error(`❌ Erro na linha:`, row, err.message);
                erros++;
            }
        }
        
        console.log('\n✅ Importação concluída!');
        console.log(`   📥 Criados: ${criados}`);
        console.log(`   🔄 Atualizados: ${atualizados}`);
        console.log(`   ❌ Erros: ${erros}`);
        
    } catch (error) {
        console.error('Erro na importação:', error);
    } finally {
        await pool.end();
    }
}

function mapearCampos(row) {
    // Função para normalizar nomes de colunas
    const normalizar = (obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key.toLowerCase().trim()] = value;
        }
        return result;
    };
    
    const r = normalizar(row);
    
    return {
        numero_pedido: r['número do pedido'] || r['numero_pedido'] || r['pedido'] || r['nº pedido'] || r['num pedido'],
        cliente_id: r['código do cliente'] || r['cliente_id'] || r['cod cliente'] || r['id cliente'],
        cliente_nome: r['cliente'] || r['nome cliente'] || r['razão social'],
        data_pedido: parseData(r['data do pedido'] || r['data_pedido'] || r['data']),
        valor_total: parseValor(r['valor total'] || r['valor_total'] || r['total'] || r['valor']),
        status: mapearStatus(r['etapa'] || r['status'] || r['situação']),
        observacoes: r['observações'] || r['observacoes'] || r['obs']
    };
}

function parseData(valor) {
    if (!valor) return new Date().toISOString().split('T')[0];
    
    if (typeof valor === 'number') {
        // Data do Excel (número de dias desde 1900)
        const data = new Date((valor - 25569) * 86400 * 1000);
        return data.toISOString().split('T')[0];
    }
    
    if (typeof valor === 'string') {
        // Tentar parsear string de data
        const partes = valor.split(/[\/\-]/);
        if (partes.length === 3) {
            if (partes[0].length === 4) {
                return `${partes[0]}-${partes[1].padStart(2, '0')}-${partes[2].padStart(2, '0')}`;
            } else {
                return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
            }
        }
    }
    
    return new Date().toISOString().split('T')[0];
}

function parseValor(valor) {
    if (!valor) return 0;
    if (typeof valor === 'number') return valor;
    
    // Remover R$, espaços e converter vírgula para ponto
    const limpo = String(valor)
        .replace(/[R$\s]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    
    return parseFloat(limpo) || 0;
}

function mapearStatus(etapa) {
    if (!etapa) return 'novo';
    
    const etapaLower = String(etapa).toLowerCase();
    
    const mapa = {
        'novo': 'novo',
        'em análise': 'em_analise',
        'em analise': 'em_analise',
        'aprovado': 'aprovado',
        'em produção': 'em_producao',
        'em producao': 'em_producao',
        'produção': 'em_producao',
        'producao': 'em_producao',
        'pronto': 'pronto_entrega',
        'pronto para entrega': 'pronto_entrega',
        'entregue': 'entregue',
        'finalizado': 'finalizado',
        'cancelado': 'cancelado',
        'faturado': 'faturado'
    };
    
    return mapa[etapaLower] || 'novo';
}

// Executar
const arquivo = process.argv[2] || path.join(__dirname, '..', 'ordens-emitidas', 'Pedidos', '1316 Pedidos2.xlsx');

console.log('🚀 Importador de Pedidos - ALUFORCE');
console.log('=====================================');

// Primeiro analisar a estrutura
analisarExcel(arquivo).then(() => {
    console.log('\n');
    // Descomentar para importar:
    // return importarPedidos(arquivo);
}).catch(console.error);
