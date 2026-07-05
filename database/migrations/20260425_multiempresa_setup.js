/**
 * Migration: Setup multiempresa — Labor Eletric, Labor Energy, Aluforce
 * Data: 2026-04-25
 */
'use strict';

async function ensureColumn(pool, table, column, definition) {
    try {
        const [rows] = await pool.query(
            `SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?
             LIMIT 1`,
            [table, column]
        );
        if (!rows.length) {
            await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
            console.log(`[MULTIEMPRESA] Coluna criada: ${table}.${column}`);
        }
    } catch (err) {
        console.warn(`[MULTIEMPRESA] Coluna ${table}.${column}: ${err.message}`);
    }
}

async function runMultiempresaSetup(pool) {
    console.log('[MULTIEMPRESA] Iniciando setup multiempresa...');

    await ensureColumn(pool, 'usuarios', 'empresa_id', 'INT NULL DEFAULT 1');
    await ensureColumn(pool, 'usuarios', 'empresa_default_id', 'INT NULL DEFAULT NULL');
    await ensureColumn(pool, 'nfe_configuracoes', 'empresa_id', 'INT NOT NULL DEFAULT 1');
    await ensureColumn(pool, 'nfe_configuracoes', 'serie', 'INT NOT NULL DEFAULT 1');
    await ensureColumn(pool, 'nfe_configuracoes', 'ultimo_numero', 'INT NOT NULL DEFAULT 0');
    await ensureColumn(pool, 'nfe_configuracoes', 'ambiente', "VARCHAR(20) NOT NULL DEFAULT 'homologacao'");
    await ensureColumn(pool, 'nfe_configuracoes', 'regime_tributario', "VARCHAR(10) NOT NULL DEFAULT '1'");
    await ensureColumn(pool, 'nfe_configuracoes', 'ativo', 'TINYINT(1) NOT NULL DEFAULT 1');

    try {
        await pool.query('UPDATE usuarios SET empresa_default_id = COALESCE(empresa_default_id, empresa_id, 1) WHERE empresa_default_id IS NULL');
    } catch (err) {
        console.warn('[MULTIEMPRESA] empresa_default_id sync: ' + err.message);
    }

    // 1. Garantir que as 3 empresas existam em `empresas`
    const empresasDef = [
        { id: 1, cnpj: process.env.ALUFORCE_CNPJ || '00.000.000/0000-00', razao_social: process.env.ALUFORCE_RAZAO || 'ALUFORCE INDUSTRIA E COMERCIO LTDA', nome_fantasia: 'Aluforce' },
        { id: 2, cnpj: process.env.LABOR_ELETRIC_CNPJ || '11.111.111/0000-00', razao_social: process.env.LABOR_ELETRIC_RAZAO || 'LABOR ELETRIC LTDA', nome_fantasia: 'Labor Eletric' },
        { id: 3, cnpj: process.env.LABOR_ENERGY_CNPJ || '22.222.222/0000-00', razao_social: process.env.LABOR_ENERGY_RAZAO || 'LABOR ENERGY LTDA', nome_fantasia: 'Labor Energy' }
    ];

    for (const emp of empresasDef) {
        try {
            const [existing] = await pool.query('SELECT id FROM empresas WHERE id = ?', [emp.id]);
            if (!existing.length) {
                await pool.query(
                    'INSERT INTO empresas (id, cnpj, razao_social, nome_fantasia, created_at) VALUES (?, ?, ?, ?, NOW())',
                    [emp.id, emp.cnpj, emp.razao_social, emp.nome_fantasia]
                );
                console.log('[MULTIEMPRESA] Empresa criada: ' + emp.nome_fantasia);
            }
        } catch (err) {
            console.warn('[MULTIEMPRESA] Empresa ' + emp.nome_fantasia + ': ' + err.message);
        }
    }

    // 2. Configuracoes NF-e por empresa
    for (const emp of empresasDef) {
        try {
            const [existing] = await pool.query('SELECT id FROM nfe_configuracoes WHERE empresa_id = ? LIMIT 1', [emp.id]);
            if (!existing.length) {
                await pool.query(
                    "INSERT INTO nfe_configuracoes (empresa_id, serie, ultimo_numero, ambiente, regime_tributario, ativo) VALUES (?, 1, 0, 'homologacao', '1', 1)",
                    [emp.id]
                );
                console.log('[MULTIEMPRESA] Config NF-e criada: ' + emp.nome_fantasia);
            }
        } catch (err) {
            console.warn('[MULTIEMPRESA] NF-e config ' + emp.nome_fantasia + ': ' + err.message);
        }
    }

    // 3. Sincronizar usuarios_empresas
    try {
        await pool.query('SELECT 1 FROM usuarios_empresas LIMIT 1');

        // Garantir registro padrao para todos os usuarios
        await pool.query(`
            INSERT IGNORE INTO usuarios_empresas (usuario_id, empresa_id, role, is_admin, is_default, ativo)
            SELECT u.id, u.empresa_id, COALESCE(u.role, 'operator'), COALESCE(u.is_admin, 0), 1, 1
            FROM usuarios u WHERE u.empresa_id IS NOT NULL AND u.empresa_id > 0
        `);

        // Labor Eletric (2) -> Labor Energy (3)
        const [eletricUsers] = await pool.query("SELECT id, role, is_admin FROM usuarios WHERE empresa_id = 2 AND status != 'demitido'");
        for (const u of eletricUsers) {
            await pool.query(
                "INSERT IGNORE INTO usuarios_empresas (usuario_id, empresa_id, role, is_admin, is_default, ativo) VALUES (?, 3, ?, ?, 0, 1)",
                [u.id, u.role || 'operator', u.is_admin || 0]
            ).catch(() => {});
        }

        // Labor Energy (3) -> Labor Eletric (2)
        const [energyUsers] = await pool.query("SELECT id, role, is_admin FROM usuarios WHERE empresa_id = 3 AND status != 'demitido'");
        for (const u of energyUsers) {
            await pool.query(
                "INSERT IGNORE INTO usuarios_empresas (usuario_id, empresa_id, role, is_admin, is_default, ativo) VALUES (?, 2, ?, ?, 0, 1)",
                [u.id, u.role || 'operator', u.is_admin || 0]
            ).catch(() => {});
        }

        console.log('[MULTIEMPRESA] Usuarios sincronizados entre Labor Eletric <-> Labor Energy');
    } catch (err) {
        console.warn('[MULTIEMPRESA] Sync usuarios_empresas: ' + err.message);
    }

    // 4. Admin padrao para Labor Eletric e Labor Energy se nao existirem
    const bcrypt = require('bcryptjs');
    const defaultAdmins = [
        { email: 'admin@laboreletric.com.br', empresa_id: 2, nome: 'Admin Labor Eletric' },
        { email: 'admin@energy.com.br',       empresa_id: 3, nome: 'Admin Labor Energy' }
    ];
    for (const admin of defaultAdmins) {
        try {
            const [existing] = await pool.query('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [admin.email]);
            if (!existing.length) {
                const [[src]] = await pool.query("SELECT senha_hash FROM usuarios WHERE email LIKE 'admin@%' AND empresa_id = 1 LIMIT 1").catch(() => [[null]]);
                const hash = src?.senha_hash || await bcrypt.hash('Admin@2026!', 12);
                await pool.query(
                    "INSERT INTO usuarios (nome, email, senha_hash, password_hash, role, empresa_id, is_admin, status, created_at) VALUES (?, ?, ?, ?, 'admin', ?, 1, 'ativo', NOW())",
                    [admin.nome, admin.email, hash, hash, admin.empresa_id]
                );
                console.log('[MULTIEMPRESA] Admin criado: ' + admin.email);
            }
        } catch (err) {
            console.warn('[MULTIEMPRESA] Admin ' + admin.email + ': ' + err.message);
        }
    }

    console.log('[MULTIEMPRESA] Setup concluido.');
}

module.exports = { runMultiempresaSetup };
