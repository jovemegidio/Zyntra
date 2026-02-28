/**
 * Migration: Criar tabela de administradores do sistema
 * Remove admins hardcoded e move para banco de dados
 * 
 * Executar: node migrations/001-admin-config.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306
};

async function runMigration() {
    let connection;
    
    try {
        console.log('🔄 Iniciando migração: Configuração de Administradores');
        console.log('═'.repeat(60));
        
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ Conectado ao banco de dados');
        
        // 1. Criar tabela de configuração de admins
        console.log('\n1️⃣ Criando tabela system_admins...');
        
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS system_admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                email VARCHAR(255) NOT NULL,
                granted_by INT NULL,
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason VARCHAR(255) NULL,
                is_active TINYINT(1) DEFAULT 1,
                UNIQUE KEY uk_admin_email (email),
                FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                FOREIGN KEY (granted_by) REFERENCES usuarios(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Administradores do sistema - substitui lista hardcoded'
        `);
        console.log('   ✅ Tabela system_admins criada');
        
        // 2. Migrar admins existentes (do campo role='admin')
        console.log('\n2️⃣ Migrando administradores existentes...');
        
        const [existingAdmins] = await connection.execute(`
            SELECT id, email, nome FROM usuarios WHERE role = 'admin' OR is_admin = 1
        `);
        
        console.log(`   📋 Encontrados ${existingAdmins.length} administradores existentes`);
        
        for (const admin of existingAdmins) {
            try {
                await connection.execute(`
                    INSERT IGNORE INTO system_admins (user_id, email, reason)
                    VALUES (?, ?, 'Migrado automaticamente - era role=admin')
                `, [admin.id, admin.email]);
                console.log(`   ✅ Migrado: ${admin.nome} (${admin.email})`);
            } catch (err) {
                console.log(`   ⚠️ Já existe: ${admin.email}`);
            }
        }
        
        // 3. Adicionar admins da lista hardcoded que ainda não estão
        console.log('\n3️⃣ Verificando admins da lista hardcoded...');
        
        const hardcodedAdmins = [
            'andreia.lopes@aluforce.ind.br',
            'douglas.moreira@aluforce.ind.br',
            'ti@aluforce.ind.br',
            'simplesadmin@aluforce.ind.br'
        ];
        
        for (const email of hardcodedAdmins) {
            const [users] = await connection.execute(
                'SELECT id FROM usuarios WHERE email = ?', 
                [email]
            );
            
            if (users.length > 0) {
                try {
                    await connection.execute(`
                        INSERT IGNORE INTO system_admins (user_id, email, reason)
                        VALUES (?, ?, 'Lista hardcoded original')
                    `, [users[0].id, email]);
                    console.log(`   ✅ Adicionado: ${email}`);
                } catch (err) {
                    console.log(`   ⚠️ Já existe: ${email}`);
                }
            } else {
                console.log(`   ⚠️ Usuário não encontrado: ${email}`);
            }
        }
        
        // 4. Criar view para facilitar consultas
        console.log('\n4️⃣ Criando view v_system_admins...');
        
        await connection.execute(`
            CREATE OR REPLACE VIEW v_system_admins AS
            SELECT 
                sa.id as admin_id,
                u.id as user_id,
                u.nome,
                u.email,
                u.role,
                sa.granted_at,
                sa.reason,
                sa.is_active
            FROM system_admins sa
            INNER JOIN usuarios u ON sa.user_id = u.id
            WHERE sa.is_active = 1
        `);
        console.log('   ✅ View v_system_admins criada');
        
        // 5. Mostrar resultado final
        console.log('\n5️⃣ Administradores configurados:');
        console.log('─'.repeat(60));
        
        const [finalAdmins] = await connection.execute(`
            SELECT nome, email, granted_at, reason 
            FROM v_system_admins 
            ORDER BY granted_at
        `);
        
        finalAdmins.forEach((admin, i) => {
            console.log(`   ${i + 1}. ${admin.nome} <${admin.email}>`);
            console.log(`      Motivo: ${admin.reason}`);
        });
        
        console.log('\n═'.repeat(60));
        console.log('✅ Migração concluída com sucesso!');
        console.log('\n📝 PRÓXIMOS PASSOS:');
        console.log('   1. Atualize middleware/auth.js para usar checkAdminFromDB()');
        console.log('   2. Remova a lista hardcoded de adminEmails');
        console.log('   3. Use a API /api/admin/admins para gerenciar');
        
    } catch (error) {
        console.error('❌ Erro na migração:', error.message);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    runMigration()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { runMigration };
