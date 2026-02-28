/**
 * Script de Sincronização Forçada - Railway -> Local
 * Recria tabelas com estrutura incompatível e copia todos os dados
 */

const mysql = require('mysql2/promise');

async function forceSync() {
    console.log('=== SINCRONIZAÇÁO FORÇADA: Railway -> Local ===\n');
    
    const railway = await mysql.createConnection({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    const local = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '@dminalu',
        database: 'aluforce_vendas'
    });
    
    await local.query('SET FOREIGN_KEY_CHECKS = 0');
    
    // Tabelas que precisam sincronizar estrutura
    const tablesToSync = ['audit_logs', 'auditoria_config', 'estoque_saldos'];
    
    for (const table of tablesToSync) {
        try {
            console.log(`\n--- ${table} ---`);
            
            // Obter estrutura do Railway
            const [createStmt] = await railway.query(`SHOW CREATE TABLE ${table}`);
            const createSQL = createStmt[0]['Create Table'];
            
            // Backup e drop da tabela local
            try {
                await local.query(`DROP TABLE IF EXISTS ${table}_bkp`);
                await local.query(`RENAME TABLE ${table} TO ${table}_bkp`);
                console.log(`  Backup criado: ${table}_bkp`);
            } catch (e) {
                // Tabela pode não existir
            }
            
            // Criar tabela com estrutura do Railway
            await local.query(createSQL);
            console.log(`  Tabela recriada com estrutura do Railway`);
            
            // Obter metadados das colunas
            const [localCols] = await local.query(`SHOW COLUMNS FROM ${table}`);
            const generatedCols = localCols
                .filter(c => c.Extra && c.Extra.includes('GENERATED'))
                .map(c => c.Field);
            const jsonCols = localCols
                .filter(c => c.Type.toLowerCase() === 'json')
                .map(c => c.Field);
            console.log(`  Colunas GENERATED ignoradas: ${generatedCols.join(', ') || 'nenhuma'}`);
            console.log(`  Colunas JSON: ${jsonCols.join(', ') || 'nenhuma'}`);
            
            // Copiar dados
            const [rows] = await railway.query(`SELECT * FROM ${table}`);
            console.log(`  Copiando ${rows.length} registros...`);
            
            let copied = 0;
            for (const row of rows) {
                try {
                    // Filtrar colunas GENERATED
                    const columns = Object.keys(row).filter(c => !generatedCols.includes(c));
                    const values = columns.map(c => {
                        const val = row[c];
                        // Converter arrays/objetos para JSON string para colunas JSON
                        if (jsonCols.includes(c) && val !== null && typeof val === 'object') {
                            return JSON.stringify(val);
                        }
                        return val;
                    });
                    const placeholders = columns.map(() => '?').join(',');
                    const columnNames = columns.map(c => `\`${c}\``).join(',');
                    
                    await local.query(
                        `INSERT INTO ${table} (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    copied++;
                } catch (e) {
                    // Ignorar erros de inserção individual
                }
            }
            
            console.log(`  ✓ ${copied}/${rows.length} registros copiados`);
            
        } catch (e) {
            console.log(`  ERRO: ${e.message}`);
        }
    }
    
    await local.query('SET FOREIGN_KEY_CHECKS = 1');
    
    // Verificação final
    console.log('\n=== VERIFICAÇÁO FINAL ===\n');
    console.log('Tabela'.padEnd(25) + 'Railway'.padStart(10) + 'Local'.padStart(10));
    console.log('-'.repeat(45));
    
    for (const table of tablesToSync) {
        try {
            const [[rwCount]] = await railway.query(`SELECT COUNT(*) as c FROM ${table}`);
            const [[localCount]] = await local.query(`SELECT COUNT(*) as c FROM ${table}`);
            console.log(table.padEnd(25) + String(rwCount.c).padStart(10) + String(localCount.c).padStart(10));
        } catch (e) {
            console.log(table.padEnd(25) + 'ERRO'.padStart(10));
        }
    }
    
    console.log('\n✓ Sincronização concluída!');
    
    await railway.end();
    await local.end();
}

forceSync().catch(e => {
    console.error('ERRO FATAL:', e.message);
    process.exit(1);
});
