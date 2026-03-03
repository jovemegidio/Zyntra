#!/usr/bin/env node
require('dotenv').config({ path: '/var/www/aluforce/.env' });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const HMAC_SECRET = process.env.PII_ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!HMAC_SECRET) { console.error('NO KEY!'); process.exit(1); }

let lgpdCrypto;
try { lgpdCrypto = require('/var/www/aluforce/lgpd-crypto'); } catch(e) {
  try { lgpdCrypto = require('/var/www/aluforce/src/lgpd-crypto'); } catch(e2) { lgpdCrypto = null; }
}

function hmacHash(val) {
  const norm = val.replace(/[.\-\/\s]/g, "");
  return crypto.createHmac('sha256', HMAC_SECRET).update(norm).digest('hex');
}

function maskDoc(val) {
  const d = val.replace(/\D/g, "");
  if (d.length === 11) return '***.' + d.substring(3,6) + '.' + d.substring(6,9) + '-**';
  if (d.length === 14) return d.substring(0,2) + '.***.***/****-' + d.substring(12);
  return null;
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'aluforce',
    password: process.env.DB_PASSWORD || 'Aluforce2026VpsDB',
    database: process.env.DB_NAME || 'aluforce_vendas',
    connectionLimit: 5
  });

  const tables = [
    { table: 'clientes', field: 'cnpj_cpf', hashCol: 'cnpj_cpf_hash', maskCol: 'cnpj_cpf_mask' },
    { table: 'contatos', field: 'cnpj_cpf', hashCol: 'cnpj_cpf_hash' },
    { table: 'fornecedores', field: 'cnpj', hashCol: 'cnpj_hash' },
    { table: 'representantes', field: 'cnpj_cpf', hashCol: 'cnpj_cpf_hash' },
    { table: 'transportadoras', field: 'cnpj_cpf', hashCol: 'cnpj_cpf_hash' },
    { table: 'possiveis_clientes', field: 'cnpj_cpf', hashCol: 'cnpj_cpf_hash' },
    { table: 'funcionarios', field: 'cpf', hashCol: 'cpf_hash' },
  ];

  let grandTotal = 0;
  for (const t of tables) {
    try {
      const [cols] = await pool.query("SHOW COLUMNS FROM " + t.table + " LIKE ?", [t.hashCol]);
      if (cols.length === 0) { console.log("  " + t.table + ": hash col missing"); continue; }

      const [rows] = await pool.query("SELECT id, " + t.field + " as val FROM " + t.table + " WHERE " + t.field + " IS NOT NULL AND " + t.field + " != \"\"");
      let ok = 0, errs = 0;
      for (const row of rows) {
        let plain = row.val;
        if (plain && plain.startsWith('ENC:') && lgpdCrypto && lgpdCrypto.decryptPII) {
          try { plain = lgpdCrypto.decryptPII(plain); } catch(e) { errs++; continue; }
        }
        if (!plain || plain.startsWith('ENC:')) continue;
        const hash = hmacHash(plain);
        const mask = t.maskCol ? maskDoc(plain) : null;
        if (t.maskCol) {
          await pool.query("UPDATE " + t.table + " SET " + t.hashCol + " = ?, " + t.maskCol + " = ? WHERE id = ?", [hash, mask, row.id]);
        } else {
          await pool.query("UPDATE " + t.table + " SET " + t.hashCol + " = ? WHERE id = ?", [hash, row.id]);
        }
        ok++;
      }
      console.log("  " + t.table + ": " + ok + "/" + rows.length + " hashed" + (errs > 0 ? " (" + errs + " errs)" : ""));
      grandTotal += ok;
    } catch(e) { console.error("  ERR " + t.table + ": " + e.message); }
  }
  console.log("\nTOTAL: " + grandTotal + " blind indexes populated");
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });