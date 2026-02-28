#!/usr/bin/env node
/**
 * apply_migration_conditional.js
 * Idempotent migration: checks INFORMATION_SCHEMA and adds missing columns to `funcionarios`.
 * Usage: node scripts/apply_migration_conditional.js [--dry-run]
 */
const mysql = require('mysql2/promise')

const DRY = process.argv.includes('--dry-run')

const DB_HOST = process.env.DB_HOST || 'localhost'
const DB_USER = process.env.DB_USER || 'root'
const DB_PASS = process.env.DB_PASS || ''
const DB_NAME = process.env.DB_NAME || 'aluforce_vendas'
const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306

const columns = {
  nacionalidade: 'VARCHAR(80)',
  naturalidade: 'VARCHAR(80)',
  filiacao_mae: 'VARCHAR(150)',
  filiacao_pai: 'VARCHAR(150)',
  dados_conjuge: 'TEXT',
  zona_eleitoral: 'VARCHAR(60)',
  seção_eleitoral: 'VARCHAR(60)',
  ctps_numero: 'VARCHAR(60)',
  ctps_serie: 'VARCHAR(60)',
  banco: 'VARCHAR(100)',
  agencia: 'VARCHAR(60)',
  conta_corrente: 'VARCHAR(100)'
}

async function main () {
  console.log(`Connecting to ${DB_HOST}:${DB_PORT} / ${DB_NAME} as ${DB_USER}`)
  const conn = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASS, database: DB_NAME, port: DB_PORT })
  try {
    for (const [col, type] of Object.entries(columns)) {
      const [rows] = await conn.execute(
        'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = \'funcionarios\' AND COLUMN_NAME = ?',
        [DB_NAME, col]
      )
      const exists = rows[0] && rows[0].cnt && rows[0].cnt > 0
      if (exists) {
        console.log(`- column ${col} already exists`)
        continue
      }
      const sql = `ALTER TABLE funcionarios ADD COLUMN \`${col}\` ${type} NULL`
      if (DRY) {
        console.log(`[dry-run] would run: ${sql}`)
      } else {
        console.log(`Adding column ${col} ${type}...`)
        await conn.execute(sql)
        console.log(`-> added ${col}`)
      }
    }
    console.log('Migration script finished.')
  } catch (err) {
    console.error('Migration failed:', err && err.message ? err.message : err)
    process.exitCode = 2
  } finally {
    try { await conn.end() } catch (e) {}
  }
}

main()
