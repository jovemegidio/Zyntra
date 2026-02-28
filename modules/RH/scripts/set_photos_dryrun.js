// Dry-run script: report which photo files match target names and which funcionarios rows would be updated.
// Usage: node scripts/set_photos_dryrun.js
const mysql = require('mysql2')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

const names = ['clemerson', 'thaina', 'ronaldo']
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'fotos')
const placeholder = '/Interativo-Aluforce.jpg'

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '@dminalu',
  database: process.env.DB_NAME || 'aluforce_vendas',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306
})

function listFiles () {
  if (!fs.existsSync(uploadsDir)) return []
  return fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'))
}

function findPhoto (name, files) {
  const lower = name.toLowerCase()
  const match = files.find(f => f.toLowerCase().includes(lower))
  return match ? ('/uploads/fotos/' + match) : null
}

async function run () {
  try {
    db.connect(err => { if (err) { console.error('DB connect error', err); process.exit(1) } })
    const files = listFiles()
    console.log('Fotos encontradas em uploads:', files.length)
    for (const name of names) {
      const photo = findPhoto(name, files) || placeholder
      console.log('=== NAME:', name, '=> candidate file:', photo, '===')
      const [rows] = await new Promise((res, rej) => db.query('SELECT id, nome_completo, foto_perfil_url FROM funcionarios WHERE LOWER(nome_completo) LIKE ? LIMIT 50', [`%${name}%`], (e, r) => e ? rej(e) : res([r])))
      if (!rows || rows.length === 0) {
        console.log(`Nenhum funcionário encontrado com termo '${name}'.`)
        continue
      }
      console.log(`Encontrados ${rows.length} linhas que correspondem ao termo '${name}':`)
      rows.forEach(r => {
        const willUpdate = (!r.foto_perfil_url || r.foto_perfil_url !== photo)
        console.log(` - id=${r.id} nome='${r.nome_completo.replace(/\s+/g, ' ')}' current='${r.foto_perfil_url || ''}' wouldUpdate=${willUpdate}`)
      })
    }
    console.log('Dry-run concluído. Nenhuma alteração foi feita.')
  } catch (e) {
    console.error('Erro durante dry-run:', e)
  } finally {
    db.end()
  }
}

run()
