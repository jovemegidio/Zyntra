// Script idempotente para atribuir/atualizar foto_perfil_url de funcionários por nome
// Usage: node scripts/set_photos.js
// Observação: exige que as credenciais DB no projeto (env) estejam corretas.

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

function findPhoto (name) {
  if (!fs.existsSync(uploadsDir)) return null
  const files = fs.readdirSync(uploadsDir)
  const lower = name.toLowerCase()
  const match = files.find(f => f.toLowerCase().includes(lower))
  return match ? ('/uploads/fotos/' + match) : null
}

async function run () {
  db.connect((err) => { if (err) { console.error('DB connect error', err); process.exit(1) } })
  for (const name of names) {
    const photo = findPhoto(name) || placeholder
    try {
      const [rows] = await new Promise((res, rej) => db.query('SELECT id, nome_completo, foto_perfil_url FROM funcionarios WHERE LOWER(nome_completo) LIKE ? LIMIT 10', [`%${name}%`], (e, r) => e ? rej(e) : res([r])))
      if (!rows || rows.length === 0) {
        console.log(`Nenhum funcionário encontrado com termo '${name}'.`)
        continue
      }
      for (const row of rows) {
        // update only if different
        if (!row.foto_perfil_url || row.foto_perfil_url !== photo) {
          await new Promise((res, rej) => db.query('UPDATE funcionarios SET foto_perfil_url = ? WHERE id = ?', [photo, row.id], (e, r) => e ? rej(e) : res(r)))
          console.log(`Atualizada foto de ${row.nome_completo} (id=${row.id}) -> ${photo}`)
        } else {
          console.log(`Foto já configurada para ${row.nome_completo} (id=${row.id}).`)
        }
      }
    } catch (e) {
      console.error('Erro ao atualizar para', name, e)
    }
  }
  db.end()
}

run().catch(e => { console.error(e); process.exit(1) })
