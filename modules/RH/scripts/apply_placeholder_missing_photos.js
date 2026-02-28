// Aplicação: define placeholder para todos os funcionarios sem foto_perfil_url
// Usage: node scripts/apply_placeholder_missing_photos.js
const mysql = require('mysql2')
require('dotenv').config()

const placeholder = '/Interativo-Aluforce.jpg'

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '@dminalu',
  database: process.env.DB_NAME || 'aluforce_vendas',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306
})

async function run () {
  db.connect(err => { if (err) { console.error('DB connect error', err); process.exit(1) } })
  try {
    const [rows] = await new Promise((res, rej) => db.query("SELECT id, nome_completo, foto_perfil_url FROM funcionarios WHERE foto_perfil_url IS NULL OR foto_perfil_url = ''", (e, r) => e ? rej(e) : res([r])))
    if (!rows || rows.length === 0) {
      console.log('Nenhum registro para atualizar.')
      return
    }
    console.log('Registros a atualizar:', rows.length)
    const ids = rows.map(r => r.id)
    // perform bulk update
    await new Promise((res, rej) => db.query('UPDATE funcionarios SET foto_perfil_url = ?, foto_thumb_url = ? WHERE foto_perfil_url IS NULL OR foto_perfil_url = ""', [placeholder, placeholder], (e, r) => e ? rej(e) : res(r)))
    console.log('Atualização aplicada. IDs atualizados (exemplo):', ids.join(', '))
  } catch (e) {
    console.error('Erro durante update:', e)
  } finally {
    db.end()
  }
}

run()
