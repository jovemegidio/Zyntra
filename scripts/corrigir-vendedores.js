/**
 * Script para verificar e corrigir vendedores
 * Vendedores corretos: Augusto, Renata, Márcia, Fabiano, Fabíola
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '@dminalu',
    database: process.env.DB_NAME || 'aluforce_vendas'
};

async function corrigirVendedores() {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        console.log('🔍 Verificando vendedores no banco...\n');
        
        // IDs dos vendedores corretos
        const vendedoresCorretos = [
            { id: 5, nome: 'Augusto' },
            { id: 12, nome: 'Fabiano' },
            { id: 13, nome: 'Fabíola' },
            { id: 22, nome: 'Márcia' },  // Ajustar ID se necessário
            { id: 38, nome: 'Renata' }   // Ajustar ID se necessário
        ];
        
        // Buscar todos os usuários que podem aparecer como vendedor
        const [usuarios] = await connection.execute(`
            SELECT id, nome, email, role, departamento 
            FROM usuarios 
            WHERE nome LIKE '%Augusto%' 
               OR nome LIKE '%Renata%' 
               OR nome LIKE '%Marcia%' 
               OR nome LIKE '%Márcia%' 
               OR nome LIKE '%Fabiano%' 
               OR nome LIKE '%Fabiola%' 
               OR nome LIKE '%Fabíola%' 
               OR nome LIKE '%Regina%'
            ORDER BY nome
        `);
        
        console.log('📋 Usuários encontrados:');
        console.log('─'.repeat(80));
        usuarios.forEach(u => {
            console.log(`ID: ${u.id.toString().padStart(2)} | ${u.nome.padEnd(40)} | Role: ${(u.role || 'null').padEnd(12)} | Dept: ${u.departamento || 'null'}`);
        });
        console.log('─'.repeat(80));
        
        // Identificar os IDs corretos dos vendedores
        const augusto = usuarios.find(u => u.nome.includes('Augusto'));
        const fabiano = usuarios.find(u => u.nome.includes('Fabiano'));
        const fabiola = usuarios.find(u => u.nome.includes('Fabíola') || u.nome.includes('Fabiola'));
        const marcia = usuarios.find(u => u.nome.includes('Márcia') || u.nome.includes('Marcia'));
        const renata = usuarios.find(u => u.nome.includes('Renata'));
        const regina = usuarios.find(u => u.nome.includes('Regina'));
        
        const idsVendedores = [
            augusto?.id,
            fabiano?.id,
            fabiola?.id,
            marcia?.id,
            renata?.id
        ].filter(Boolean);
        
        console.log(`\n✅ Vendedores corretos identificados: ${idsVendedores.join(', ')}`);
        
        // Atualizar role para 'comercial' nos vendedores corretos
        if (idsVendedores.length > 0) {
            const [result] = await connection.execute(`
                UPDATE usuarios 
                SET role = 'comercial', departamento = 'Comercial'
                WHERE id IN (${idsVendedores.join(',')})
            `);
            console.log(`✅ ${result.affectedRows} vendedores atualizados para role='comercial'`);
        }
        
        // Remover role de vendedor de Regina (se tiver)
        if (regina) {
            const [result2] = await connection.execute(`
                UPDATE usuarios 
                SET role = 'user',
                    departamento = 'Administrativo'
                WHERE id = ?
            `, [regina.id]);
            console.log(`✅ Regina Balotti (ID: ${regina.id}) removida da lista de vendedores`);
        }
        
        // Verificar resultado
        console.log('\n📋 Resultado final:');
        const [final] = await connection.execute(`
            SELECT id, nome, role, departamento 
            FROM usuarios 
            WHERE role = 'vendedor' OR departamento = 'Comercial'
            ORDER BY nome
        `);
        
        console.log('─'.repeat(60));
        final.forEach(u => {
            console.log(`ID: ${u.id.toString().padStart(2)} | ${u.nome.padEnd(40)} | ${u.role}`);
        });
        console.log('─'.repeat(60));
        
        console.log('\n✅ Correção concluída!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        await connection.end();
    }
}

corrigirVendedores();
