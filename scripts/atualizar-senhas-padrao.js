/**
 * Script para atualizar todas as senhas dos usuários para senha padrão
 * Data: 12/01/2026
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '@dminalu',
    database: process.env.DB_NAME || 'aluforce_vendas'
};

async function atualizarSenhas() {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        console.log('🔐 Atualizando senhas de todos os usuários para: alu0103\n');
        
        // Hash da senha padrão
        const senhaPadrao = 'alu0103';
        const senhaHash = await bcrypt.hash(senhaPadrao, 10);
        
        console.log('📝 Hash gerado:', senhaHash.substring(0, 20) + '...');
        
        // Buscar todos os usuários da tabela usuarios
        const [usuarios] = await connection.execute(
            'SELECT id, email, nome FROM usuarios ORDER BY id'
        );
        
        console.log(`\n👥 Total de usuários encontrados: ${usuarios.length}\n`);
        
        // Atualizar senha_hash e password_hash de todos os usuários
        const [result] = await connection.execute(
            'UPDATE usuarios SET senha_hash = ?, password_hash = ?',
            [senhaHash, senhaHash]
        );
        
        console.log(`✅ ${result.affectedRows} senhas atualizadas com sucesso!\n`);
        
        // Listar usuários atualizados
        console.log('📋 Usuários com senha atualizada:');
        console.log('─'.repeat(60));
        
        usuarios.forEach((user, index) => {
            const email = user.email || 'sem-email';
            const nome = user.nome || 'Sem nome';
            console.log(`${(index + 1).toString().padStart(2)}. ${email.padEnd(35)} - ${nome}`);
        });
        
        console.log('─'.repeat(60));
        console.log(`\n🔑 Nova senha para todos: alu0103`);
        console.log('✅ Atualização concluída!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        await connection.end();
    }
}

atualizarSenhas();
