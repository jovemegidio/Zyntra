/**
 * Script de Sincronização Unidirecional
 * Railway -> Local (aluforce_vendas)
 * Copia dados do Railway para o banco local
 */

const mysql = require('mysql2/promise');

async function syncRailwayToLocal() {
  console.log('=== SINCRONIZAÇÁO: Railway -> Local ===\n');
  
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
  
  // Tabelas para sincronizar (com diferenças identificadas)
  const tables = [
    'audit_logs', 'auditoria_config', 'estoque_saldos',
    'log_acessos', 'ordens_compra', 'pedidos_compra', 
    'pedidos_compra_itens', 'pedidos_importados'
  ];
  
  let stats = { copied: 0, errors: 0 };
  
  for (const table of tables) {
    try {
      // Obter chave primária
      const [pkResult] = await railway.query("SHOW KEYS FROM ?? WHERE Key_name = 'PRIMARY'", [table]).catch(() => [[]]);
      const pk = pkResult[0]?.Column_name || 'id';
      
      // Obter IDs de ambos os bancos
      const [rwRows] = await railway.query('SELECT ?? FROM ??', [pk, table]).catch(() => [[]]);
      const [localRows] = await local.query('SELECT ?? FROM ??', [pk, table]).catch(() => [[]]);
      
      const rwIds = rwRows.map(r => r[pk]);
      const localIds = localRows.map(r => r[pk]);
      
      // IDs que faltam no local (copiar do Railway)
      const missingInLocal = rwIds.filter(id => !localIds.includes(id));
      
      // Railway -> Local
      if (missingInLocal.length > 0) {
        console.log(table + ': copiando', missingInLocal.length, 'registros...');
        for (const id of missingInLocal) {
          try {
            const [[row]] = await railway.query('SELECT * FROM ?? WHERE ?? = ?', [table, pk, id]);
            if (row) {
              const cols = Object.keys(row);
              const vals = Object.values(row);
              const placeholders = cols.map(() => '?').join(', ');
              await local.query('INSERT IGNORE INTO ?? (' + cols.join(', ') + ') VALUES (' + placeholders + ')', [table, ...vals]);
              stats.copied++;
            }
          } catch (e) {
            stats.errors++;
          }
        }
        console.log('  ✓ Concluído');
      } else {
        console.log(table + ': já sincronizado ✓');
      }
    } catch (e) {
      console.log(table + ': ERRO -', e.message.substring(0, 50));
    }
  }
  
  await railway.end();
  await local.end();
  
  console.log('\n=== RESULTADO ===');
  console.log('Registros copiados para Local:', stats.copied);
  console.log('Erros:', stats.errors);
  console.log('\n✓ Sincronização concluída!');
}

syncRailwayToLocal().catch(e => console.error('ERROR:', e.message));
