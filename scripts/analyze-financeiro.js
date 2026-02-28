/**
 * Script para analisar e corrigir dados do módulo Financeiro
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
    console.log('🔍 Analisando dados do módulo Financeiro...\n');
    
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
        // 1. Verificar estrutura e dados de contas_pagar
        console.log('📋 CONTAS A PAGAR');
        console.log('─'.repeat(50));
        
        const [cpTotal] = await pool.query('SELECT COUNT(*) as total FROM contas_pagar');
        console.log('Total de registros:', cpTotal[0].total);
        
        const [cpValores] = await pool.query(`
            SELECT 
                SUM(valor) as total_valor,
                SUM(CASE WHEN status = 'vencido' OR status = 'Vencido' THEN valor ELSE 0 END) as total_vencido,
                SUM(CASE WHEN status = 'pendente' OR status = 'Pendente' THEN valor ELSE 0 END) as total_pendente,
                SUM(CASE WHEN status = 'pago' OR status = 'Pago' THEN valor ELSE 0 END) as total_pago,
                COUNT(CASE WHEN status = 'vencido' OR status = 'Vencido' THEN 1 END) as qtd_vencidos
            FROM contas_pagar
        `);
        console.log('Total valor:', cpValores[0].total_valor);
        console.log('Total vencido:', cpValores[0].total_vencido);
        console.log('Total pendente:', cpValores[0].total_pendente);
        console.log('Total pago:', cpValores[0].total_pago);
        console.log('Qtd vencidos:', cpValores[0].qtd_vencidos);
        
        // Verificar amostra de dados
        const [cpAmostra] = await pool.query('SELECT id, descricao, valor, vencimento, data_vencimento, status FROM contas_pagar LIMIT 5');
        console.log('\nAmostra:');
        cpAmostra.forEach(c => {
            console.log(`  ID: ${c.id}, Valor: R$ ${c.valor}, Status: ${c.status}, Venc: ${c.vencimento || c.data_vencimento}`);
        });

        // 2. Verificar estrutura e dados de contas_receber
        console.log('\n\n📋 CONTAS A RECEBER');
        console.log('─'.repeat(50));
        
        const [crTotal] = await pool.query('SELECT COUNT(*) as total FROM contas_receber');
        console.log('Total de registros:', crTotal[0].total);
        
        const [crCols] = await pool.query('DESCRIBE contas_receber');
        console.log('Colunas:', crCols.map(c => c.Field).join(', '));
        
        const [crValores] = await pool.query(`
            SELECT 
                SUM(valor) as total_valor,
                SUM(CASE WHEN status = 'vencido' OR status = 'Vencido' THEN valor ELSE 0 END) as total_vencido,
                SUM(CASE WHEN status = 'pendente' OR status = 'Pendente' THEN valor ELSE 0 END) as total_pendente,
                SUM(CASE WHEN status = 'recebido' OR status = 'Recebido' OR status = 'pago' THEN valor ELSE 0 END) as total_recebido
            FROM contas_receber
        `);
        console.log('Total valor:', crValores[0].total_valor);
        console.log('Total vencido:', crValores[0].total_vencido);
        console.log('Total pendente:', crValores[0].total_pendente);
        console.log('Total recebido:', crValores[0].total_recebido);
        
        // 3. Verificar se há problemas de dados
        console.log('\n\n🔧 DIAGNÓSTICO');
        console.log('─'.repeat(50));
        
        // Verificar valores NULL ou zero
        const [cpNulos] = await pool.query('SELECT COUNT(*) as total FROM contas_pagar WHERE valor IS NULL OR valor = 0');
        const [crNulos] = await pool.query('SELECT COUNT(*) as total FROM contas_receber WHERE valor IS NULL OR valor = 0');
        
        console.log('Contas a pagar com valor NULL/0:', cpNulos[0].total);
        console.log('Contas a receber com valor NULL/0:', crNulos[0].total);
        
        // Verificar status únicos
        const [cpStatus] = await pool.query('SELECT DISTINCT status, COUNT(*) as qtd FROM contas_pagar GROUP BY status');
        console.log('\nStatus em contas_pagar:');
        cpStatus.forEach(s => console.log(`  ${s.status || 'NULL'}: ${s.qtd}`));
        
        const [crStatus] = await pool.query('SELECT DISTINCT status, COUNT(*) as qtd FROM contas_receber GROUP BY status');
        console.log('\nStatus em contas_receber:');
        crStatus.forEach(s => console.log(`  ${s.status || 'NULL'}: ${s.qtd}`));
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
    } finally {
        pool.end();
    }
}

main();
