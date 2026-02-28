const mysql = require('mysql2/promise');

(async () => {
  const names = [
    'Ana Paula Ferreira do Nascimento',
    'Ariel da Silva Leandro',
    'Augusto Ladeira dos Santos',
    'Antônio Egidio Neto',
    'Bruno Felipe de Freitas',
    'Christian Alves dos Santos',
    'Clayton Rodrigo Costa',
    'Clemerson Leandro da Silva',
    'Eldir Tolentino de Deus Junior',
    'Fabiano Marques de Oliveira',
    'Fabíola de Souza Santos',
    'Felipe Simões Pereira dos Santos',
    'Flávio dos Reis Bezerra',
    'Guilherme Dantas Bastos',
    'Isabela Ramos de Oliveira',
    'Leonardo da Silva Freitas',
    'Lucas de Souza Cachoeira',
    'Márcia Oliveira do Nascimento Scarcella',
    'Marcos Alexandre de Lima Oliveira Filho',
    'Ramon de Oliveira Lima',
    'Regina da Silva Ballotti',
    'Renata Maria Batista do Nascimento',
    'Robson Gonçalves',
    'Ronaldo Santana',
    'Sergio Ricardo Martins Belizário',
    'Thainá Cabral Freitas',
    'Thiago de Oliveira Scarcella',
    'Willian Cardoso Xavier Silva'
  ]

  // bcrypt hash for 'admin123' generated earlier
  const PASS_HASH = '$2b$10$cQVTCJvLai9f8Df.UPSxMev0A3y0Y81Q/cZnPNajQ0mldCvA/2a56'

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '@dminalu',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
  })

  function normalize (str) {
    return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z\s]/g, '').trim()
  }

  function emailFromName (name) {
    const n = normalize(name).toLowerCase().split(/\s+/).filter(Boolean)
    if (n.length === 0) return null
    const first = n[0]
    const last = n[n.length - 1]
    let base = `${first}.${last}`
    base = base.replace(/[^a-z0-9.]/g, '')
    return `${base}@aluforce.ind.br`
  }

  function randomCpf () {
    // simple random 11-digit string (not validating check digits)
    let s = ''
    for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10)
    return s
  }

  function randomRg () {
    let s = ''
    for (let i = 0; i < 9; i++) s += Math.floor(Math.random() * 10)
    return s
  }

  function randomPhone () {
    // brazilian style 10 or 11 digits
    const len = Math.random() > 0.5 ? 11 : 10
    let s = ''
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10)
    return s
  }

  function randomDate (startYear = 1970, endYear = 2000) {
    const start = new Date(`${startYear}-01-01`).getTime()
    const end = new Date(`${endYear}-12-31`).getTime()
    const ts = start + Math.floor(Math.random() * (end - start))
    const d = new Date(ts)
    return d.toISOString().substring(0, 10)
  }

  function randomAdmissionDate () {
    const start = new Date('2015-01-01').getTime()
    const end = Date.now()
    const ts = start + Math.floor(Math.random() * (end - start))
    return new Date(ts).toISOString().substring(0, 10)
  }

  try {
    for (const rawName of names) {
      // Skip names that already exist by exact nome_completo OR matching Augusto as requested
      const existsRows = await db.execute('SELECT id, nome_completo, email FROM funcionarios WHERE nome_completo = ? LIMIT 1', [rawName])
      const [rows] = existsRows
      if (rows && rows.length > 0) {
        console.log(`SKIP (already exists): ${rawName}`)
        continue
      }

      // If name contains 'Augusto' skip (user requested example exclude)
      if (/augusto/i.test(rawName)) {
        console.log(`SKIP (explicit exclude Augusto): ${rawName}`)
        continue
      }

      let email = emailFromName(rawName)
      // ensure unique email
      let counter = 0
      while (true) {
        const [r] = await db.execute('SELECT id FROM funcionarios WHERE email = ? LIMIT 1', [email])
        if (r && r.length > 0) {
          counter++
          const base = email.split('@')[0]
          email = `${base}${counter}@aluforce.ind.br`
        } else break
      }

      const cpf = randomCpf()
      const rg = randomRg()
      const telefone = randomPhone()
      const data_nascimento = randomDate(1970, 2000)
      const data_admissao = randomAdmissionDate()

      const insertSql = `INSERT INTO funcionarios (
        email, senha, role, nome_completo, cargo, departamento, cpf, rg,
        telefone, estado_civil, data_nascimento, dependentes, foto_perfil_url, status,
        nacionalidade, naturalidade, filiacao_mae, filiacao_pai, dados_conjuge,
        zona_eleitoral, seção_eleitoral, ctps_numero, ctps_serie,
        banco, agencia, conta_corrente, data_admissao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

      const params = [
        email,
        PASS_HASH,
        'funcionario',
        rawName,
        null,
        null,
        cpf,
        rg,
        telefone,
        'Solteiro(a)',
        data_nascimento,
        0,
        null,
        'Ativo',
        null, null, null, null, null,
        null, null, null, null,
        null, null, null,
        data_admissao
      ]

      try {
        const [res] = await db.execute(insertSql, params)
        console.log(`INSERTED: ${rawName} -> ${email} (id=${res.insertId})`)
      } catch (err) {
        console.error(`ERROR inserting ${rawName}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Fatal error:', err)
  } finally {
    await db.end()
  }

  console.log('Done seeding users.')
})()
