// Script para listar usuários do módulo de vendas
const mysql = require('mysql2/promise');

async function listarUsuarios() {
    const pool = mysql.createPool({
        host: 'localhost',
        user: 'root',
        password: '@dminalu',
        database: 'aluforce_vendas'
    });

    try {
        const [rows] = await pool.query('SELECT id, nome, email, role, is_admin FROM usuarios ORDER BY nome');
        
        console.log('╔════════════════════════════════════════════════════════════════════════╗');
        console.log('║           USUÁRIOS DO MÓDULO DE VENDAS - ALUFORCE                      ║');
        console.log('╚════════════════════════════════════════════════════════════════════════╝');
        
        console.log('📧 Email para login: [qualquer email abaixo]');
        console.log('🔑 Senha padrão: aluvendas01');
        console.log('─────────────────────────────────────────────────────────────────────────');
        
        let admins = [];
        let vendedores = [];
        
        rows.forEach(u => {
            const isAdmin = u.is_admin === 1 || u.is_admin === true;
            const user = {
                id: u.id,
                nome: u.nome,
                email: u.email,
                tipo: isAdmin ? 'ADMIN' : 'VENDEDOR'
            };
            
            if (isAdmin) {
                admins.push(user);
            } else {
                vendedores.push(user);
            }
        });
        
        // Mostrar admins
        if (admins.length > 0) {
            console.log('👑 ADMINISTRADORES:');
            admins.forEach(u => {
                console.log(`   ${u.id.toString().padStart(3, ' ')} │ ${u.nome.padEnd(40, ' ')} │ ${u.email}`);
            });
            console.log('');
        }
        
        // Mostrar vendedores
        if (vendedores.length > 0) {
            console.log('👤 VENDEDORES:');
            vendedores.forEach(u => {
                console.log(`   ${u.id.toString().padStart(3, ' ')} │ ${u.nome.padEnd(40, ' ')} │ ${u.email}`);
            });
            console.log('');
        }
        
        console.log('─────────────────────────────────────────────────────────────────────────');
        console.log(`📊 Total: ${rows.length} usuários (${admins.length} admins, ${vendedores.length} vendedores)`);
        
        // Destacar usuários específicos mencionados
        const ariel = rows.find(u => u.email.toLowerCase().includes('ariel'));
        const thaina = rows.find(u => u.email.toLowerCase().includes('thaina'));
        
        if (ariel || thaina) {
            console.log('⭐ USUÁRIOS DESTACADOS PARA TESTE:');
            if (ariel) {
                console.log(`   ✓ Ariel: ${ariel.email} (${ariel.is_admin ? 'Admin' : 'Vendedor'})`);
            }
            if (thaina) {
                console.log(`   ✓ Thainá: ${thaina.email} (${thaina.is_admin ? 'Admin' : 'Vendedor'})`);
            }
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Erro ao consultar banco:', error.message);
    } finally {
        await pool.end();
    }
}

listarUsuarios();
