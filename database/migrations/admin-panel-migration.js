/**
 * ============================================================
 * MIGRATION: Admin Panel — Tabelas necessárias para /admin/usuarios.html
 * ============================================================
 * Cria tabelas: usuario_roles, modulos, role_modulos, log_acessos
 * Adiciona colunas: is_admin, areas em usuarios; nivel em roles
 * Seed: módulos do sistema
 */

async function adminPanelMigration(pool) {
    console.log('[ADMIN-MIGRATION] 🔄 Iniciando migração do painel admin...');

    // 1. Adicionar coluna is_admin à tabela usuarios (se não existir)
    try {
        const [cols1] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'is_admin'
        `);
        if (cols1.length === 0) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN is_admin TINYINT(1) DEFAULT 0`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna is_admin adicionada à tabela usuarios');
            // Setar is_admin=1 para usuários com role='admin'
            await pool.query(`UPDATE usuarios SET is_admin = 1 WHERE role = 'admin'`);
            console.log('[ADMIN-MIGRATION] ✅ is_admin=1 definido para usuários admin');
        } else {
            console.log('[ADMIN-MIGRATION] ℹ️ Coluna is_admin já existe');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar is_admin:', err.message);
    }

    // 2. Adicionar coluna areas à tabela usuarios (se não existir)
    try {
        const [cols2] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'areas'
        `);
        if (cols2.length === 0) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN areas TEXT DEFAULT NULL`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna areas adicionada à tabela usuarios');
        } else {
            console.log('[ADMIN-MIGRATION] ℹ️ Coluna areas já existe');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar areas:', err.message);
    }

    // 3. Adicionar coluna nivel à tabela roles (se não existir)
    try {
        const [cols3] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'nivel'
        `);
        if (cols3.length === 0) {
            await pool.query(`ALTER TABLE roles ADD COLUMN nivel INT DEFAULT 0`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna nivel adicionada à tabela roles');
            // Setar niveis padrão
            await pool.query(`UPDATE roles SET nivel = 100 WHERE name = 'admin'`);
            await pool.query(`UPDATE roles SET nivel = 50 WHERE name IN ('financeiro', 'vendas', 'rh')`);
        } else {
            console.log('[ADMIN-MIGRATION] ℹ️ Coluna nivel já existe');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar nivel:', err.message);
    }

    // 4. Adicionar coluna nome à tabela roles (se não existir) — auth-rbac.js usa r.nome
    try {
        const [cols4] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'nome'
        `);
        if (cols4.length === 0) {
            await pool.query(`ALTER TABLE roles ADD COLUMN nome VARCHAR(100) DEFAULT NULL`);
            // Copiar name para nome
            await pool.query(`UPDATE roles SET nome = name WHERE nome IS NULL`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna nome adicionada à tabela roles');
        } else {
            console.log('[ADMIN-MIGRATION] ℹ️ Coluna nome já existe em roles');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar nome a roles:', err.message);
    }

    // 5. Criar tabela usuario_roles
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuario_roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT NOT NULL,
                role_id INT NOT NULL,
                atribuido_por INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_usuario_role (usuario_id, role_id),
                INDEX idx_usuario (usuario_id),
                INDEX idx_role (role_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[ADMIN-MIGRATION] ✅ Tabela usuario_roles criada/verificada');
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao criar usuario_roles:', err.message);
    }

    // 6. Criar tabela modulos
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS modulos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                descricao TEXT,
                icone VARCHAR(100) DEFAULT 'fa-cube',
                ordem INT DEFAULT 0,
                ativo TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_codigo (codigo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[ADMIN-MIGRATION] ✅ Tabela modulos criada/verificada');

        // Seed módulos do sistema
        const modulos = [
            ['Dashboard', 'dashboard', 'Painel principal do sistema', 'fa-tachometer-alt', 1],
            ['Vendas', 'vendas', 'Módulo de vendas e CRM', 'fa-shopping-cart', 2],
            ['Compras', 'compras', 'Módulo de compras e fornecedores', 'fa-truck', 3],
            ['Financeiro', 'financeiro', 'Módulo financeiro e contas', 'fa-dollar-sign', 4],
            ['PCP', 'pcp', 'Planejamento e Controle de Produção', 'fa-industry', 5],
            ['RH', 'rh', 'Recursos Humanos', 'fa-users', 6],
            ['Logística', 'logistica', 'Logística e expedição', 'fa-boxes', 7],
            ['NF-e', 'nfe', 'Nota Fiscal Eletrônica', 'fa-file-invoice', 8],
            ['Faturamento', 'faturamento', 'Faturamento e notas', 'fa-receipt', 9],
            ['Administração', 'admin', 'Administração do sistema', 'fa-cog', 10],
            ['Ajuda', 'ajuda', 'Central de ajuda e suporte', 'fa-question-circle', 11],
            ['Chat', 'chat', 'Chat interno', 'fa-comments', 12],
            ['Integrações', 'integracoes', 'Integrações externas', 'fa-plug', 13]
        ];

        for (const [nome, codigo, descricao, icone, ordem] of modulos) {
            await pool.query(`
                INSERT IGNORE INTO modulos (nome, codigo, descricao, icone, ordem) 
                VALUES (?, ?, ?, ?, ?)
            `, [nome, codigo, descricao, icone, ordem]);
        }
        console.log('[ADMIN-MIGRATION] ✅ Módulos do sistema inseridos/verificados');
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao criar modulos:', err.message);
    }

    // 7. Criar tabela role_modulos
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS role_modulos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                role_id INT NOT NULL,
                modulo_id INT NOT NULL,
                pode_visualizar TINYINT(1) DEFAULT 1,
                pode_criar TINYINT(1) DEFAULT 0,
                pode_editar TINYINT(1) DEFAULT 0,
                pode_excluir TINYINT(1) DEFAULT 0,
                pode_aprovar TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_role_modulo (role_id, modulo_id),
                INDEX idx_role (role_id),
                INDEX idx_modulo (modulo_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[ADMIN-MIGRATION] ✅ Tabela role_modulos criada/verificada');
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao criar role_modulos:', err.message);
    }

    // 8. Criar tabela log_acessos
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS log_acessos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT,
                acao VARCHAR(100) DEFAULT 'login',
                modulo VARCHAR(100) DEFAULT NULL,
                ip VARCHAR(45),
                user_agent TEXT,
                detalhes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_usuario (usuario_id),
                INDEX idx_acao (acao),
                INDEX idx_modulo (modulo),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[ADMIN-MIGRATION] ✅ Tabela log_acessos criada/verificada');
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao criar log_acessos:', err.message);
    }

    // 9. Adicionar coluna avatar à tabela usuarios (se não existir) — admin/users retorna avatar
    try {
        const [cols5] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'avatar'
        `);
        if (cols5.length === 0) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN avatar VARCHAR(255) DEFAULT NULL`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna avatar adicionada à tabela usuarios');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar avatar:', err.message);
    }

    // 10. Adicionar coluna departamento à tabela usuarios (se não existir)
    try {
        const [cols6] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'departamento'
        `);
        if (cols6.length === 0) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN departamento VARCHAR(100) DEFAULT NULL`);
            // Copiar setor para departamento
            try {
                await pool.query(`UPDATE usuarios SET departamento = setor WHERE departamento IS NULL AND setor IS NOT NULL`);
            } catch(e) {}
            console.log('[ADMIN-MIGRATION] ✅ Coluna departamento adicionada à tabela usuarios');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar departamento:', err.message);
    }

    // 11. Adicionar coluna ultimo_login à tabela usuarios (se não existir)
    try {
        const [cols7] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'ultimo_login'
        `);
        if (cols7.length === 0) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN ultimo_login DATETIME DEFAULT NULL`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna ultimo_login adicionada à tabela usuarios');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar ultimo_login:', err.message);
    }

    // 12. Adicionar coluna created_at à tabela usuarios (se não existir)
    try {
        const [cols8] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'created_at'
        `);
        if (cols8.length === 0) {
            await pool.query(`ALTER TABLE usuarios ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            console.log('[ADMIN-MIGRATION] ✅ Coluna created_at adicionada à tabela usuarios');
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao adicionar created_at:', err.message);
    }

    console.log('[ADMIN-MIGRATION] ✅ Migração do painel admin concluída!');

    // 13. Seed role_modulos — permissões padrão de cada perfil
    try {
        const [existingRM] = await pool.query('SELECT COUNT(*) as total FROM role_modulos');
        if (existingRM[0].total < 15) { // Só faz seed se tiver poucos dados
            // Buscar roles e modulos por código
            const [allRoles] = await pool.query('SELECT id, codigo FROM roles');
            const [allModulos] = await pool.query('SELECT id, codigo FROM modulos');
            const roleMap = {};
            allRoles.forEach(r => roleMap[r.codigo] = r.id);
            const modMap = {};
            allModulos.forEach(m => modMap[m.codigo] = m.id);

            // Definir permissões: { roleCodigo: [{ modulo, visualizar, criar, editar, excluir, aprovar }] }
            const permissoes = {
                'super_admin': Object.keys(modMap).map(m => ({ modulo: m, v:1, c:1, e:1, x:1, a:1 })),
                'admin': Object.keys(modMap).map(m => ({ modulo: m, v:1, c:1, e:1, x:1, a:1 })),
                'gerente': ['dashboard','vendas','compras','financeiro','pcp','rh','nfe','logistica','faturamento','estoque'].map(m => ({ modulo: m, v:1, c:1, e:1, x:0, a:1 })),
                'supervisor': ['dashboard','vendas','compras','financeiro','pcp','nfe','estoque'].map(m => ({ modulo: m, v:1, c:1, e:1, x:0, a:0 })),
                'operador_pcp': [
                    { modulo: 'pcp', v:1, c:1, e:1, x:0, a:0 },
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 },
                    { modulo: 'estoque', v:1, c:0, e:0, x:0, a:0 }
                ],
                'vendedor': [
                    { modulo: 'vendas', v:1, c:1, e:1, x:0, a:0 },
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 },
                    { modulo: 'nfe', v:1, c:0, e:0, x:0, a:0 }
                ],
                'comprador': [
                    { modulo: 'compras', v:1, c:1, e:1, x:0, a:0 },
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 },
                    { modulo: 'estoque', v:1, c:0, e:0, x:0, a:0 }
                ],
                'financeiro': [
                    { modulo: 'financeiro', v:1, c:1, e:1, x:0, a:1 },
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 },
                    { modulo: 'faturamento', v:1, c:1, e:1, x:0, a:0 },
                    { modulo: 'nfe', v:1, c:1, e:0, x:0, a:0 }
                ],
                'rh': [
                    { modulo: 'rh', v:1, c:1, e:1, x:0, a:0 },
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 }
                ],
                'producao': [
                    { modulo: 'pcp', v:1, c:1, e:1, x:0, a:0 },
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 }
                ],
                'consulta': [
                    { modulo: 'dashboard', v:1, c:0, e:0, x:0, a:0 },
                    { modulo: 'vendas', v:1, c:0, e:0, x:0, a:0 },
                    { modulo: 'financeiro', v:1, c:0, e:0, x:0, a:0 }
                ]
            };

            let seeded = 0;
            for (const [roleCodigo, perms] of Object.entries(permissoes)) {
                const roleId = roleMap[roleCodigo];
                if (!roleId) continue;
                for (const p of perms) {
                    const modId = modMap[p.modulo];
                    if (!modId) continue;
                    try {
                        await pool.query(`
                            INSERT IGNORE INTO role_modulos (role_id, modulo_id, pode_visualizar, pode_criar, pode_editar, pode_excluir, pode_aprovar)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [roleId, modId, p.v, p.c, p.e, p.x, p.a]);
                        seeded++;
                    } catch (e) {
                        // IGNORE duplicates
                    }
                }
            }
            console.log(`[ADMIN-MIGRATION] ✅ Seed role_modulos: ${seeded} permissões configuradas`);
        } else {
            console.log(`[ADMIN-MIGRATION] ℹ️ role_modulos já tem ${existingRM[0].total} registros`);
        }
    } catch (err) {
        console.warn('[ADMIN-MIGRATION] ⚠️ Erro ao seed role_modulos:', err.message);
    }
}

module.exports = { adminPanelMigration };
