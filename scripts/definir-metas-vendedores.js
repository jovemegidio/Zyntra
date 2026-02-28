/**
 * Script para definir metas para todos os vendedores
 * Janeiro 2026 - Meta: R$ 50.000 para cada vendedor
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

async function definirMetas() {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        console.log('🎯 Definindo metas para todos os vendedores...\n');
        
        // Período: Janeiro 2026 (formato 2026-01)
        const periodo = '2026-01';
        const valorMeta = 50000.00; // R$ 50.000 por vendedor
        const tipo = 'mensal';
        
        // Vendedores
        const vendedores = [
            { id: 5, nome: 'Augusto Ladeira dos Santos' },
            { id: 12, nome: 'Fabiano Marques de Oliveira' },
            { id: 13, nome: 'Fabíola de Souza Santos' },
            { id: 22, nome: 'Márcia do Nascimento Oliveira Scarcella' },
            { id: 38, nome: 'Renata Maria Batista do Nascimento' }
        ];
        
        console.log('📋 Inserindo metas:');
        console.log('─'.repeat(70));
        
        for (const vendedor of vendedores) {
            // Verificar se já existe meta para esse vendedor/período
            const [existing] = await connection.execute(
                'SELECT id FROM metas_vendas WHERE vendedor_id = ? AND periodo = ?',
                [vendedor.id, periodo]
            );
            
            if (existing.length > 0) {
                // Atualizar meta existente
                await connection.execute(
                    'UPDATE metas_vendas SET valor_meta = ? WHERE vendedor_id = ? AND periodo = ?',
                    [valorMeta, vendedor.id, periodo]
                );
                console.log(`🔄 ${vendedor.nome.padEnd(45)} | Meta atualizada: R$ ${valorMeta.toLocaleString('pt-BR')}`);
            } else {
                // Inserir nova meta
                await connection.execute(
                    'INSERT INTO metas_vendas (vendedor_id, periodo, tipo, valor_meta) VALUES (?, ?, ?, ?)',
                    [vendedor.id, periodo, tipo, valorMeta]
                );
                console.log(`✅ ${vendedor.nome.padEnd(45)} | Meta inserida: R$ ${valorMeta.toLocaleString('pt-BR')}`);
            }
        }
        
        console.log('─'.repeat(70));
        
        // Verificar metas inseridas
        const [metas] = await connection.execute(`
            SELECT mv.id, mv.vendedor_id, u.nome, mv.periodo, mv.valor_meta
            FROM metas_vendas mv
            JOIN usuarios u ON mv.vendedor_id = u.id
            WHERE mv.periodo = ?
            ORDER BY u.nome
        `, [periodo]);
        
        console.log('\n📊 Metas cadastradas para Janeiro/2026:');
        console.log('─'.repeat(80));
        
        let totalMetas = 0;
        metas.forEach(m => {
            totalMetas += parseFloat(m.valor_meta);
            console.log(`ID: ${m.id.toString().padStart(2)} | ${m.nome.padEnd(40)} | Meta: R$ ${parseFloat(m.valor_meta).toLocaleString('pt-BR').padStart(10)}`);
        });
        
        console.log('─'.repeat(80));
        console.log(`📈 Total de metas: R$ ${totalMetas.toLocaleString('pt-BR')}`);
        console.log('\n✅ Metas definidas com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        await connection.end();
    }
}

definirMetas();
