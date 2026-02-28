const mysql = require('mysql2/promise')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
require('dotenv').config();

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '@dminalu',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306
  })

  try {
    // add column if not exists (compatible check)
    const [cols] = await connection.execute("SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'funcionarios' AND COLUMN_NAME = 'foto_thumb_url'", [process.env.DB_NAME || 'aluforce_vendas'])
    if (!cols || cols[0].cnt === 0) {
      await connection.execute('ALTER TABLE funcionarios ADD COLUMN foto_thumb_url VARCHAR(255) DEFAULT NULL')
      console.log('Coluna foto_thumb_url criada.')
    } else {
      console.log('Coluna foto_thumb_url já existe.')
    }

    // fetch all funcionários with foto_perfil_url set
    const [rows] = await connection.execute('SELECT id, foto_perfil_url FROM funcionarios WHERE foto_perfil_url IS NOT NULL AND foto_perfil_url != ""')
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'fotos')

    for (const r of rows) {
      try {
        const url = r.foto_perfil_url
        // expect urls like /uploads/fotos/filename.ext
        if (!url) continue
        const fileName = url.split('/').pop()
        const filePath = path.join(uploadDir, fileName)
        if (!fs.existsSync(filePath)) {
          console.log(`Arquivo não encontrado para id=${r.id}: ${filePath}`)
          continue
        }
        const ext = path.extname(fileName)
        const base = path.basename(fileName, ext)
        const thumbName = `${base}-thumb${ext}`
        const thumbPath = path.join(uploadDir, thumbName)
        if (fs.existsSync(thumbPath)) {
          // already exists, update DB if missing
          const thumbUrl = `/uploads/fotos/${thumbName}`
          await connection.execute('UPDATE funcionarios SET foto_thumb_url = ? WHERE id = ?', [thumbUrl, r.id])
          console.log(`Thumb exists, updated DB for id=${r.id}`)
          continue
        }
        // create thumbnail
        await sharp(filePath).resize(200, 200, { fit: 'cover' }).toFile(thumbPath)
        const thumbUrl = `/uploads/fotos/${thumbName}`
        await connection.execute('UPDATE funcionarios SET foto_thumb_url = ? WHERE id = ?', [thumbUrl, r.id])
        console.log(`Generated thumb for id=${r.id}`)
      } catch (e) {
        console.error('Erro ao processar id=', r.id, e.message)
      }
    }

    console.log('Processo concluído.')
    process.exit(0)
  } catch (err) {
    console.error('Erro durante a migração:', err && err.message ? err.message : err)
    process.exit(2)
  } finally {
    await connection.end()
  }
})()
