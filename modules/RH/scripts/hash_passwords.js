#!/usr/bin/env node
require('dotenv').config()
const mysql = require('mysql2/promise')
const bcrypt = require('bcrypt')

// Configurações via env ou defaults
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '@dminalu',
  database: process.env.DB_NAME || 'aluforce_vendas',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
}

const DRY_RUN = process.argv.includes('--dry-run')

function looksHashed (value) {
  if (!value || typeof value !== 'string') return false
  // bcrypt hashes usually start with $2a$ or $2b$ or $2y$
  return value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$')
}

async function run () {
  console.log(`DB: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}  dry-run=${DRY_RUN}`)
  const conn = await mysql.createConnection(DB_CONFIG)
  try {
    const [rows] = await conn.execute('SELECT id, email, senha FROM funcionarios')
    console.log(`Registros lidos: ${rows.length}`)

    let toUpdate = []
    for (const r of rows) {
      const senha = r.senha
      if (!senha) {
        console.log(`id=${r.id} email=${r.email} -> sem senha (ignorando)`)
        continue
      }
      if (looksHashed(senha)) {
        // já está em hash bcrypt
        continue
      }
      toUpdate.push(r)
    }

    console.log(`Senhas plaintext detectadas: ${toUpdate.length}`)
    if (toUpdate.length === 0) {
      console.log('Nada a fazer. Saindo.')
      return
    }

    if (DRY_RUN) {
      for (const r of toUpdate) {
        console.log(`[dry-run] id=${r.id} email=${r.email} senha_orig=${r.senha}`)
      }
      console.log('Dry-run completo. Nenhuma alteração aplicada.')
      return
    }

    // Executar atualizações
    for (const r of toUpdate) {
      try {
        const hashed = await bcrypt.hash(r.senha, 10)
        await conn.execute('UPDATE funcionarios SET senha = ? WHERE id = ?', [hashed, r.id])
        console.log(`id=${r.id} email=${r.email} -> atualizado`)
      } catch (err) {
        console.error(`Erro ao atualizar id=${r.id}:`, err.message || err)
      }
    }

    console.log('Migração completa. Revise os logs para possíveis erros.')
  } finally {
    await conn.end()
  }
}

run().catch(err => {
  console.error('Erro na migração:', err && err.message ? err.message : err)
  process.exit(1)
})
