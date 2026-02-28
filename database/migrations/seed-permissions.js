/**
 * AUDIT-FIX HIGH-002: Seed permissoes_modulos from hardcoded map
 * 
 * This migration reads the hardcoded userPermissions map from
 * src/permissions-server.js and inserts matching rows into the
 * permissoes_modulos table, keyed by usuario_id (matched via first name).
 * 
 * Run: node database/migrations/seed-permissions.js
 * Safe to re-run — uses INSERT IGNORE to avoid duplicates.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function seedPermissions(pool) {
    console.log('[SEED-PERM] Starting permission migration from hardcoded map...');

    // Import the hardcoded map
    let permModule;
    try {
        permModule = require('../../src/permissions-server');
    } catch (e) {
        console.error('[SEED-PERM] Cannot load permissions-server.js:', e.message);
        return { seeded: 0, skipped: 0, errors: 0 };
    }

    // Get the raw userPermissions object
    const userPermissions = permModule.userPermissions || {};
    const entries = Object.entries(userPermissions);
    console.log(`[SEED-PERM] Found ${entries.length} hardcoded user entries`);

    // Fetch all users from both tables (funcionarios + usuarios)
    let allUsers = [];
    try {
        const [funcs] = await pool.query(
            "SELECT id, LOWER(TRIM(SUBSTRING_INDEX(COALESCE(nome_completo, nome, email), ' ', 1))) as first_name, email, 'funcionarios' as source FROM funcionarios"
        );
        allUsers = allUsers.concat(funcs);
    } catch (e) { console.log('[SEED-PERM] funcionarios table:', e.message); }

    try {
        const [users] = await pool.query(
            "SELECT id, LOWER(TRIM(SUBSTRING_INDEX(COALESCE(nome, email), ' ', 1))) as first_name, email, 'usuarios' as source FROM usuarios"
        );
        allUsers = allUsers.concat(users);
    } catch (e) { console.log('[SEED-PERM] usuarios table:', e.message); }

    console.log(`[SEED-PERM] Found ${allUsers.length} users in DB`);

    // Build name→id map (prefer funcionarios over usuarios for same name)
    const nameToId = new Map();
    for (const u of allUsers) {
        const normalized = u.first_name
            ?.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
        if (normalized && !nameToId.has(normalized)) {
            nameToId.set(normalized, u.id);
        }
        // Also try email prefix
        if (u.email) {
            const emailPrefix = u.email.split('@')[0].split('.')[0].toLowerCase();
            if (!nameToId.has(emailPrefix)) {
                nameToId.set(emailPrefix, u.id);
            }
        }
    }

    // Ensure unique constraint exists (safe to re-run)
    try {
        await pool.query(
            'ALTER TABLE permissoes_modulos ADD UNIQUE INDEX idx_usuario_modulo (usuario_id, modulo)'
        );
        console.log('[SEED-PERM] Added unique index on (usuario_id, modulo)');
    } catch (e) { /* already exists - ER_DUP_KEYNAME */ }

    let seeded = 0, skipped = 0, errors = 0;

    for (const [userName, data] of entries) {
        const normalizedName = userName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        const userId = nameToId.get(normalizedName);
        if (!userId) {
            console.log(`[SEED-PERM] SKIP: No DB user found for "${userName}"`);
            skipped++;
            continue;
        }

        const areas = data.areas || [];
        const isAdmin = data.isAdmin === true;

        for (const modulo of areas) {
            try {
                await pool.query(
                    `INSERT IGNORE INTO permissoes_modulos
                     (usuario_id, modulo, visualizar, editar, criar, excluir)
                     VALUES (?, ?, 1, ?, ?, ?)`,
                    [
                        userId,
                        modulo,
                        isAdmin || ['admin_total', 'supervisor_vendas', 'financeiro_pagar', 'financeiro_receber', 'compras_comprador', 'producao_gerente', 'rh_admin'].includes(data.profile) ? 1 : 0,
                        isAdmin || ['admin_total', 'supervisor_vendas', 'compras_comprador', 'producao_gerente', 'rh_admin'].includes(data.profile) ? 1 : 0,
                        isAdmin ? 1 : 0
                    ]
                );
                seeded++;
            } catch (e) {
                console.error(`[SEED-PERM] Error for ${userName}/${modulo}:`, e.message);
                errors++;
            }
        }
    }

    console.log(`[SEED-PERM] Done: seeded=${seeded}, skipped=${skipped}, errors=${errors}`);
    return { seeded, skipped, errors };
}

// Allow running standalone
if (require.main === module) {
    const mysql = require('mysql2/promise');
    const DB_CONFIG = {
        host: process.env.DB_HOST || '31.97.64.102',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'aluforce_vendas',
        port: parseInt(process.env.DB_PORT) || 3306
    };
    const pool = mysql.createPool(DB_CONFIG);
    seedPermissions(pool).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { seedPermissions };
