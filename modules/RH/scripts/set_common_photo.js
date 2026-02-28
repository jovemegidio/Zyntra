const mysql = require('mysql2/promise')
const fs = require('fs')
const path = require('path');

(async () => {
  const PHOTO_URL = '/Interativo-Aluforce.jpg'
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '@dminalu',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
  })

  try {
    // Ensure file exists in uploads, warn if not
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'fotos')
    const placeholderPath = path.join(uploadsDir, 'placeholder.png')
    if (!fs.existsSync(placeholderPath)) {
      console.warn('Aviso: placeholder.png não existe em', placeholderPath, 'O script apenas atualizará URLs no banco; carregue o ficheiro placeholder.png em public/uploads/fotos se quiser que as imagens apareçam.')
    }

    // Update all users to have same photo
    const [res] = await db.execute('UPDATE funcionarios SET foto_perfil_url = ? WHERE foto_perfil_url IS NULL OR foto_perfil_url = "" OR foto_perfil_url NOT LIKE "%uploads/fotos/%"', [PHOTO_URL])

    // Also set for any that do not point to the placeholder if you want ALL: uncomment below
    // const [res2] = await db.execute('UPDATE funcionarios SET foto_perfil_url = ?',[PHOTO_URL]);

    // Fetch all users and write report
    const [rows] = await db.execute('SELECT id, nome_completo, email, foto_perfil_url FROM funcionarios')
    const csv = ['id,nome_completo,email,foto_perfil_url']
    for (const r of rows) csv.push([r.id, `"${(r.nome_completo || '').replace(/"/g, '""')}",${r.email},${r.foto_perfil_url}`].join(','))
    fs.writeFileSync('scripts/set_common_photo_report.csv', csv.join(''))

    console.log('Atualizados registros (consulta de update):', res.affectedRows)
    console.log('Relatório escrito: scripts/set_common_photo_report.csv')
  } catch (err) {
    console.error('Erro:', err)
  } finally {
    await db.end()
  }
})()
