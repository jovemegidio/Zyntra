/**
 * ═══════════════════════════════════════════════════════════════
 * ALUFORCE ERP — Complete RBAC Migration
 * Migra permissões granulares (ações) para tabela permissoes_acoes
 * Elimina dependência de hardcoded fallback
 * ═══════════════════════════════════════════════════════════════
 *
 * Run: node database/migrations/complete-rbac-migration.js
 * Safe to re-run — uses INSERT IGNORE
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function completeRbacMigration(pool) {
    console.log('[RBAC-MIGRATION] ═══ Starting Complete RBAC Migration ═══');

    // ── Step 1: Create permissoes_acoes table ────────────────
    console.log('[RBAC-MIGRATION] Step 1: Creating permissoes_acoes table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS permissoes_acoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            modulo VARCHAR(50) NOT NULL,
            acao VARCHAR(100) NOT NULL,
            permitido TINYINT(1) DEFAULT 1,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY idx_usuario_modulo_acao (usuario_id, modulo, acao),
            INDEX idx_usuario_modulo (usuario_id, modulo),
            INDEX idx_modulo_acao (modulo, acao)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[RBAC-MIGRATION] ✅ Table permissoes_acoes ready');

    // ── Step 2: Ensure permissoes_modulos exists with all columns ─
    console.log('[RBAC-MIGRATION] Step 2: Verifying permissoes_modulos...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS permissoes_modulos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            modulo VARCHAR(50) NOT NULL,
            visualizar TINYINT(1) DEFAULT 1,
            editar TINYINT(1) DEFAULT 0,
            criar TINYINT(1) DEFAULT 0,
            excluir TINYINT(1) DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY idx_usuario_modulo (usuario_id, modulo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── Step 3: Load hardcoded permissions ──────────────────
    console.log('[RBAC-MIGRATION] Step 3: Loading hardcoded permissions map...');
    let permModule;
    try {
        permModule = require('../../src/permissions-server');
    } catch (e) {
        console.error('[RBAC-MIGRATION] Cannot load permissions-server.js:', e.message);
        return { modulesSeeded: 0, actionsSeeded: 0, errors: 0 };
    }

    const MODULE_ACTIONS = permModule.MODULE_ACTIONS || {};
    const userPermissions = permModule.userPermissions || {};

    console.log(`[RBAC-MIGRATION] Found ${Object.keys(MODULE_ACTIONS).length} modules with actions`);
    console.log(`[RBAC-MIGRATION] Found ${Object.keys(userPermissions).length} hardcoded user entries`);

    // ── Step 4: Build name→userId map ───────────────────────
    console.log('[RBAC-MIGRATION] Step 4: Building user lookup map...');
    let allUsers = [];
    try {
        const [funcs] = await pool.query(
            "SELECT id, LOWER(TRIM(SUBSTRING_INDEX(COALESCE(nome_completo, nome, email), ' ', 1))) as first_name, email, 'funcionarios' as source FROM funcionarios"
        );
        allUsers = allUsers.concat(funcs);
    } catch (e) { /* table may not exist */ }

    try {
        const [users] = await pool.query(
            "SELECT id, LOWER(TRIM(SUBSTRING_INDEX(COALESCE(nome, email), ' ', 1))) as first_name, email, 'usuarios' as source FROM usuarios"
        );
        allUsers = allUsers.concat(users);
    } catch (e) { /* table may not exist */ }

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
        if (u.email) {
            const emailPrefix = u.email.split('@')[0].split('.')[0].toLowerCase();
            if (!nameToId.has(emailPrefix)) {
                nameToId.set(emailPrefix, u.id);
            }
        }
    }
    console.log(`[RBAC-MIGRATION] Mapped ${nameToId.size} user names to IDs`);

    // ── Step 5: Seed permissoes_modulos (module-level) ──────
    console.log('[RBAC-MIGRATION] Step 5: Seeding module-level permissions...');
    let modulesSeeded = 0, actionsSeeded = 0, errors = 0, skipped = 0;

    for (const [userName, data] of Object.entries(userPermissions)) {
        const normalizedName = userName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        const userId = nameToId.get(normalizedName);
        if (!userId) { skipped++; continue; }

        const areas = data.areas || [];
        const isAdmin = data.isAdmin === true;

        // Module-level permissions
        for (const modulo of areas) {
            try {
                await pool.query(
                    `INSERT IGNORE INTO permissoes_modulos
                     (usuario_id, modulo, visualizar, editar, criar, excluir)
                     VALUES (?, ?, 1, ?, ?, ?)`,
                    [userId, modulo, isAdmin ? 1 : 0, isAdmin ? 1 : 0, isAdmin ? 1 : 0]
                );
                modulesSeeded++;
            } catch (e) { errors++; }
        }

        // Action-level permissions
        const userPerms = data.permissions || {};
        if (userPerms === '*') {
            // Admin: grant ALL actions in ALL modules
            for (const [modulo, actions] of Object.entries(MODULE_ACTIONS)) {
                for (const action of Object.keys(actions)) {
                    try {
                        await pool.query(
                            `INSERT IGNORE INTO permissoes_acoes
                             (usuario_id, modulo, acao, permitido)
                             VALUES (?, ?, ?, 1)`,
                            [userId, modulo, action]
                        );
                        actionsSeeded++;
                    } catch (e) { errors++; }
                }
            }
        } else if (typeof userPerms === 'object') {
            // Non-admin: grant specific actions per module
            for (const [modulo, actions] of Object.entries(userPerms)) {
                const actionList = Array.isArray(actions) ? actions : Object.keys(actions);
                for (const action of actionList) {
                    try {
                        await pool.query(
                            `INSERT IGNORE INTO permissoes_acoes
                             (usuario_id, modulo, acao, permitido)
                             VALUES (?, ?, ?, 1)`,
                            [userId, modulo, action]
                        );
                        actionsSeeded++;
                    } catch (e) { errors++; }
                }
            }
        }
    }

    console.log(`[RBAC-MIGRATION] ═══ Migration Complete ═══`);
    console.log(`[RBAC-MIGRATION] Modules seeded: ${modulesSeeded}`);
    console.log(`[RBAC-MIGRATION] Actions seeded: ${actionsSeeded}`);
    console.log(`[RBAC-MIGRATION] Skipped (no DB user): ${skipped}`);
    console.log(`[RBAC-MIGRATION] Errors: ${errors}`);

    return { modulesSeeded, actionsSeeded, skipped, errors };
}

// ── Standalone runner ────────────────────────────────────────
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
    completeRbacMigration(pool)
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { completeRbacMigration };
