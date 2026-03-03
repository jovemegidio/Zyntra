#!/usr/bin/env node
// scripts/lgpd-decrypt-check.js - Verify encrypted data can be decrypted
// Usage: node scripts/lgpd-decrypt-check.js [--table TABLE]

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { decryptPII } = require('../lgpd-crypto');

const PII_MAP = {
    funcionarios: ['cpf', 'salario'],
    clientes: ['cpf', 'cnpj', 'cnpj_cpf'],
};

async function check() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'aluforce',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'aluforce_vendas',
    });

    let ok = 0, fail = 0;
    
    for (const [table, columns] of Object.entries(PII_MAP)) {
        for (const col of columns) {
            try {
                const [rows] = await pool.query(
                    `SELECT id, \`${col}\` FROM \`${table}\` WHERE \`${col}\` LIKE 'ENC:%' LIMIT 5`
                );
                for (const row of rows) {
                    try {
                        const decrypted = decryptPII(row[col]);
                        console.log(`[OK] ${table}.${col} id=${row.id}: ENC:... -> ${decrypted.substring(0,6)}***`);
                        ok++;
                    } catch(e) {
                        console.log(`[FAIL] ${table}.${col} id=${row.id}: ${e.message}`);
                        fail++;
                    }
                }
            } catch(e) {
                // Table/column may not exist
            }
        }
    }
    
    console.log(`\nOK: ${ok}, FAIL: ${fail}`);
    await pool.end();
}

check().catch(console.error);
