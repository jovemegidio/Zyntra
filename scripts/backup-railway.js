/**
 * Script de Backup do Banco Railway
 * Faz dump completo de todas as tabelas para SQL
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
    port: process.env.DB_PORT || 19396,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
    database: process.env.DB_NAME || 'railway'
};

async function backup() {
    const dataAtual = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(__dirname, '..', 'backups');
    const dumpFile = path.join(backupDir, `aluforce_railway_dump_${dataAtual}.sql`);
    
    console.log('🔄 Iniciando backup do banco Railway...');
    console.log(`📁 Destino: ${dumpFile}\n`);
    
    const pool = await mysql.createPool(DB_CONFIG);
    
    let sql = `-- =============================================
-- ALUFORCE V2.0 - Backup Completo do Banco Railway
-- Data: ${new Date().toLocaleString('pt-BR')}
-- Host: ${DB_CONFIG.host}:${DB_CONFIG.port}
-- Database: ${DB_CONFIG.database}
-- =============================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;

`;
    
    // Listar todas as tabelas
    const [tables] = await pool.query('SHOW TABLES');
    const tableKey = `Tables_in_${DB_CONFIG.database}`;
    
    console.log(`📊 Total de tabelas: ${tables.length}\n`);
    
    let processed = 0;
    for (const tableRow of tables) {
        const tableName = tableRow[tableKey];
        processed++;
        process.stdout.write(`\r⏳ Processando: ${tableName} (${processed}/${tables.length})`);
        
        // Obter CREATE TABLE
        const [[createTable]] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``);
        sql += `-- =============================================\n`;
        sql += `-- Tabela: ${tableName}\n`;
        sql += `-- =============================================\n\n`;
        sql += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
        sql += createTable['Create Table'] + ';\n\n';
        
        // Obter dados
        const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
        
        if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const columnNames = columns.map(c => `\`${c}\``).join(', ');
            
            // Inserir em lotes de 100
            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                const values = batch.map(row => {
                    const vals = columns.map(col => {
                        const val = row[col];
                        if (val === null) return 'NULL';
                        if (typeof val === 'number') return val;
                        if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                        return `'${String(val).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
                    });
                    return `(${vals.join(', ')})`;
                }).join(',\n');
                
                sql += `INSERT INTO \`${tableName}\` (${columnNames}) VALUES\n${values};\n\n`;
            }
        }
    }
    
    sql += `
SET FOREIGN_KEY_CHECKS = 1;
COMMIT;

-- =============================================
-- Fim do Backup
-- =============================================
`;
    
    // Salvar arquivo
    fs.writeFileSync(dumpFile, sql, 'utf8');
    
    const stats = fs.statSync(dumpFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`\n\n✅ Backup concluído!`);
    console.log(`📁 Arquivo: ${dumpFile}`);
    console.log(`📊 Tamanho: ${sizeMB} MB`);
    console.log(`📋 Tabelas: ${tables.length}`);
    
    await pool.end();
}

backup().catch(err => {
    console.error('❌ Erro no backup:', err);
    process.exit(1);
});
