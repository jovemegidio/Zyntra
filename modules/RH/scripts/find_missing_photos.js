// Dry-run: listar funcionários sem foto e sugerir arquivos candidatos por correspondência de nome
// Usage: node scripts/find_missing_photos.js
const mysql = require('mysql2')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

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

function candidatesForName (name, files) {
  const parts = (name || '').toLowerCase().replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean)
  const matches = new Set()
  for (const f of files) {
    const lf = f.toLowerCase()
    for (const p of parts) {
      if (p.length < 3) continue // avoid tiny fragments
      if (lf.includes(p)) { matches.add('/uploads/fotos/' + f); break }
    }
  }
  return Array.from(matches)
}

async function run () {
  try {
    db.connect(err => { if (err) { console.error('DB connect error', err); process.exit(1) } })
    const files = listFiles()
    console.log('Fotos em uploads:', files.length)

    // get all funcionarios without foto_perfil_url or empty string
    const [rows] = await new Promise((res, rej) => db.query("SELECT id, nome_completo, foto_perfil_url, foto_thumb_url FROM funcionarios WHERE foto_perfil_url IS NULL OR foto_perfil_url = '' LIMIT 1000", (e, r) => e ? rej(e) : res([r])))
    if (!rows || rows.length === 0) {
      console.log('Nenhum funcionário sem foto_perfil_url encontrado.')
      return
    }
    console.log('Funcionários sem foto_perfil_url encontrados:', rows.length)
    const report = []
    for (const r of rows) {
      const name = r.nome_completo || ''
      const cands = candidatesForName(name, files)
      report.push({ id: r.id, nome: name, current: r.foto_perfil_url || '', candidates: cands.length ? cands : [placeholder] })
      console.log(`- id=${r.id} nome='${name}' candidates=${cands.length} ${cands.length ? cands.join(', ') : placeholder}`)
    }

    console.log('Dry-run concluído. Não foram aplicadas alterações.')
    // write JSON report to disk for review
    const outPath = path.join(__dirname, 'missing_photos_report.json')
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log('Relatório salvo em:', outPath)
  } catch (e) {
    console.error('Erro:', e)
  } finally {
    db.end()
  }
}

run()
