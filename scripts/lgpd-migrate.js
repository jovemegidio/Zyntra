#!/usr/bin/env node
// scripts/lgpd-migrate.js - Encrypt existing PII data in database
// Usage: node scripts/lgpd-migrate.js [--dry-run] [--table TABLE_NAME]

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { encryptPII, decryptPII } = require('../lgpd-crypto');

// Tables and columns containing PII
const PII_MAP = {
    funcionarios:       ['cpf', 'salario'],
    clientes:           ['cpf', 'cnpj', 'cnpj_cpf'],
    clientes_financeiro:['cnpj_cpf'],
    contas_pagar:       ['cnpj_cpf'],
    contatos:           ['cnpj_cpf'],
    fornecedores:       ['cnpj'],
    fornecedores_financeiro: ['cnpj_cpf'],
    representantes:     ['cnpj_cpf'],
    transportadoras:    ['cnpj_cpf'],
    possiveis_clientes: ['cnpj_cpf'],
    rh_dependentes:     ['cpf'],
    rh_holerites:       ['salario_base', 'salario_liquido'],
    rh_rescisoes:       ['saldo_salario'],
    historico_salarial: ['salario_anterior', 'salario_novo'],
    rh_historico_promocoes: ['salario_anterior', 'salario_novo'],
    cargos_funcoes:     ['salario_base'],
    pix_cobrancas:      ['cliente_cpf_cnpj'],
};

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_TABLE = process.argv.find((a, i) => process.argv[i-1] === '--table');

async function migrate() {
    console.log('=== LGPD PII Encryption Migration ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
    if (ONLY_TABLE) console.log(`Table filter: ${ONLY_TABLE}`);
    console.log('');

    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'aluforce',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'aluforce_vendas',
        waitForConnections: true,
        connectionLimit: 5,
    });

    let totalEncrypted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    const tables = ONLY_TABLE ? { [ONLY_TABLE]: PII_MAP[ONLY_TABLE] } : PII_MAP;

    for (const [table, columns] of Object.entries(tables)) {
        if (!columns) {
            console.log(`[SKIP] Table ${table} not in PII map`);
            continue;
        }

        // Check if table exists
        try {
            const [tableCheck] = await pool.query(
                `SELECT COUNT(*) as cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
                [table]
            );
            if (!tableCheck[0].cnt) {
                console.log(`[SKIP] Table ${table} does not exist`);
                continue;
            }
        } catch(e) {
            console.log(`[ERROR] Checking table ${table}: ${e.message}`);
            continue;
        }

        // Get existing columns
        const [colInfo] = await pool.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
            [table]
        );
        const existingCols = colInfo.map(c => c.COLUMN_NAME);

        const validCols = columns.filter(c => existingCols.includes(c));
        if (validCols.length === 0) {
            console.log(`[SKIP] No valid PII columns in ${table}`);
            continue;
        }

        console.log(`\n[TABLE] ${table} -> columns: ${validCols.join(', ')}`);

        // Get primary key
        const [pkInfo] = await pool.query(
            `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY'`,
            [table]
        );
        const pk = pkInfo.length > 0 ? pkInfo[0].COLUMN_NAME : 'id';

        // Process in batches
        const BATCH_SIZE = 100;
        let offset = 0;
        let batchCount = 0;

        while (true) {
            const selectCols = [pk, ...validCols].join(', ');
            const [rows] = await pool.query(
                `SELECT ${selectCols} FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`
            );

            if (rows.length === 0) break;

            for (const row of rows) {
                const updates = {};
                let hasUpdate = false;

                for (const col of validCols) {
                    const val = row[col];
                    if (val === null || val === undefined || val === '') continue;
                    const strVal = String(val);
                    
                    // Skip if already encrypted
                    if (strVal.startsWith('ENC:')) {
                        totalSkipped++;
                        continue;
                    }

                    // Skip if it looks like a number (salary) - encrypt
                    try {
                        const encrypted = encryptPII(strVal);
                        if (encrypted && encrypted !== strVal) {
                            updates[col] = encrypted;
                            hasUpdate = true;
                        }
                    } catch(e) {
                        console.log(`  [ERROR] Encrypting ${table}.${col} id=${row[pk]}: ${e.message}`);
                        totalErrors++;
                    }
                }

                if (hasUpdate) {
                    if (DRY_RUN) {
                        const preview = Object.entries(updates).map(([k,v]) => 
                            `${k}: ${String(row[k]).substring(0,8)}... -> ENC:...`
                        ).join(', ');
                        console.log(`  [DRY] ${table} id=${row[pk]}: ${preview}`);
                    } else {
                        const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
                        const values = [...Object.values(updates), row[pk]];
                        try {
                            await pool.query(
                                `UPDATE \`${table}\` SET ${setClauses} WHERE \`${pk}\` = ?`,
                                values
                            );
                        } catch(e) {
                            console.log(`  [ERROR] Updating ${table} id=${row[pk]}: ${e.message}`);
                            totalErrors++;
                            continue;
                        }
                    }
                    totalEncrypted += Object.keys(updates).length;
                }
            }

            offset += BATCH_SIZE;
            batchCount++;
        }
        
        console.log(`  Processed ${offset} rows, ${batchCount} batches`);
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Fields encrypted: ${totalEncrypted}`);
    console.log(`Fields already encrypted (skipped): ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

    await pool.end();
    process.exit(totalErrors > 0 ? 1 : 0);
}

migrate().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});
