#!/usr/bin/env node
/**
 * Script para configurar roles de administradores
 * Administradores: Andreia, Douglas, TI
 * Demais: Colaboradores (role: user)
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuração do banco de dados
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306
};

// Administradores (por email)
const ADMINISTRADORES = [
    'andreia@aluforce.ind.br',
    'douglas@aluforce.ind.br',
    'ti@aluforce.ind.br'
];

async function configurarRoles() {
    let connection;
    
    try {
        console.log('' + '='.repeat(70));
        console.log('👑 CONFIGURAÇÁO DE ROLES - Sistema Aluforce v.2');
        console.log('='.repeat(70));
        console.log('📍 Conectando ao banco: ' + dbConfig.database + '@' + dbConfig.host);
        
        // Conectar ao banco
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conexão estabelecida');
        
        // Buscar todos os usuários
        console.log('👥 Buscando todos os usuários...');
        const [usuarios] = await connection.query(
            'SELECT id, nome, email, role FROM usuarios ORDER BY nome'
        );
        
        console.log(`📊 Total de usuários: ${usuarios.length}`);
        
        // Separar administradores e colaboradores
        let admins = [];
        let colaboradores = [];
        
        for (const user of usuarios) {
            const email = (user.email || '').toLowerCase();
            if (ADMINISTRADORES.includes(email)) {
                admins.push(user);
            } else {
                colaboradores.push(user);
            }
        }
        
        console.log('👑 ADMINISTRADORES IDENTIFICADOS (' + admins.length + '):');
        console.log('='.repeat(70));
        admins.forEach((user, index) => {
            console.log(`${index + 1}. [ID: ${user.id}] ${user.name || user.nome} (${user.email}) - Role atual: ${user.role || 'não definida'}`);
        });
        
        console.log('👤 COLABORADORES IDENTIFICADOS (' + colaboradores.length + '):');
        console.log('='.repeat(70));
        colaboradores.slice(0, 5).forEach((user, index) => {
            console.log(`${index + 1}. [ID: ${user.id}] ${user.nome} (${user.email}) - Role atual: ${user.role || 'não definida'}`);
        });
        if (colaboradores.length > 5) {
            console.log(`... e mais ${colaboradores.length - 5} colaboradores`);
        }
        
        console.log('🔄 Atualizando roles...');
        
        // Atualizar administradores para role = 'admin'
        let adminUpdates = 0;
        for (const user of admins) {
            try {
                await connection.query(
                    'UPDATE usuarios SET role = ?, is_admin = 1 WHERE id = ?',
                    ['admin', user.id]
                );
                console.log(`👑 [ID: ${user.id}] ${user.nome} → admin`);
                adminUpdates++;
            } catch (error) {
                console.log(`❌ [ID: ${user.id}] ${user.nome} - ERRO: ${error.message}`);
            }
        }
        
        // Atualizar colaboradores para role = 'user'
        let userUpdates = 0;
        for (const user of colaboradores) {
            try {
                await connection.query(
                    'UPDATE usuarios SET role = ?, is_admin = 0 WHERE id = ?',
                    ['user', user.id]
                );
                if (userUpdates < 5) {
                    console.log(`👤 [ID: ${user.id}] ${user.nome} → user`);
                }
                userUpdates++;
            } catch (error) {
                console.log(`❌ [ID: ${user.id}] ${user.nome} - ERRO: ${error.message}`);
            }
        }
        
        if (userUpdates > 5) {
            console.log(`👤 ... e mais ${userUpdates - 5} colaboradores atualizados`);
        }
        
        // Relatório final
        console.log('' + '='.repeat(70));
        console.log('📊 RELATÓRIO FINAL');
        console.log('='.repeat(70));
        console.log(`👑 Administradores configurados: ${adminUpdates}`);
        console.log(`👤 Colaboradores configurados: ${userUpdates}`);
        console.log(`✅ Total de atualizações: ${adminUpdates + userUpdates}`);
        console.log('='.repeat(70));
        
        // Verificar resultado
        console.log('🔍 Verificando configuração final...');
        
        const [verificacao] = await connection.query(
            "SELECT role, COUNT(*) as total FROM usuarios GROUP BY role ORDER BY role"
        );
        
        console.log('📋 Distribuição de roles:');
        verificacao.forEach(row => {
            const emoji = row.role === 'admin' ? '👑' : '👤';
            console.log(`  ${emoji} ${row.role}: ${row.total} usuários`);
        });
        
        // Listar administradores finais
        const [adminsFinais] = await connection.query(
            "SELECT id, nome, email FROM usuarios WHERE role = 'admin' ORDER BY nome"
        );
        
        console.log('👑 ADMINISTRADORES CONFIRMADOS:');
        console.log('='.repeat(70));
        adminsFinais.forEach((admin, index) => {
            console.log(`${index + 1}. ${admin.nome} (${admin.email})`);
        });
        console.log('='.repeat(70));
        
        console.log('✅ Configuração concluída com sucesso!');
        
    } catch (error) {
        console.error('❌ ERRO:', error.message);
        if (error.stack) {
            console.error('📋 Stack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Conexão com o banco encerrada');
        }
    }
}

// Executar script
configurarRoles()
    .then(() => {
        console.log('✅ Processo finalizado com sucesso');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
