/**
 * Script para corrigir áreas de acesso dos supervisores Renata e Augusto
 * Problema: Cards dos módulos Vendas e RH não aparecem para eles
 */

const mysql = require('mysql2/promise');

async function fixSupervisorAreas() {
    let connection;
    
    try {
        // Carregar variáveis de ambiente
        require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
        
        // Usar configuração do .env - Railway
        const config = {
            host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
            port: parseInt(process.env.DB_PORT) || 19396,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'railway',
            connectTimeout: 30000
        };
        
        console.log(`🔌 Conectando ao banco: ${config.host}:${config.port}/${config.database}`);
        
        try {
            connection = await mysql.createConnection(config);
            console.log(`✅ Conectado ao banco Railway!`);
        } catch (e) {
            console.error(`❌ Erro de conexão:`, e.message);
            throw e;
        }

        console.log('📝 Corrigindo áreas de acesso dos supervisores...\n');

        // Áreas de acesso para supervisores - incluindo RH e Vendas
        const areas = JSON.stringify(['rh', 'vendas']);
        
        // Permissões completas de vendas
        const permissoesVendas = JSON.stringify({
            visualizar: true,
            criar: true,
            editar: true,
            excluir: true,
            aprovar: true,
            dashboard: true
        });

        // Supervisores que precisam de acesso a RH e Vendas
        const supervisores = [
            { email: 'renata@aluforce.ind.br', nome: 'Renata' },
            { email: 'augusto@aluforce.ind.br', nome: 'Augusto' }
        ];

        // Primeiro, verificar a estrutura da tabela
        console.log('🔍 Verificando estrutura da tabela...');
        const [columns] = await connection.execute(`SHOW COLUMNS FROM usuarios`);
        const columnNames = columns.map(c => c.Field);
        console.log('Colunas encontradas:', columnNames.join(', '));

        const hasAreasColumn = columnNames.includes('areas');
        const hasPermissoesVendas = columnNames.includes('permissoes_vendas');
        
        console.log(`\n📊 Estrutura:`);
        console.log(`   - Coluna 'areas': ${hasAreasColumn ? '✅ Existe' : '❌ Não existe'}`);
        console.log(`   - Coluna 'permissoes_vendas': ${hasPermissoesVendas ? '✅ Existe' : '❌ Não existe'}`);

        // Se a coluna areas não existe, criar
        if (!hasAreasColumn) {
            console.log('\n⚠️ Criando coluna "areas"...');
            await connection.execute(`ALTER TABLE usuarios ADD COLUMN areas TEXT DEFAULT NULL`);
            console.log('✅ Coluna "areas" criada!');
        }

        // Atualizar cada supervisor
        for (const supervisor of supervisores) {
            console.log(`\n🔧 Processando ${supervisor.nome}...`);
            
            // Buscar usuário atual
            const [users] = await connection.execute(
                `SELECT id, nome, email, login, areas, permissoes_vendas, is_admin 
                 FROM usuarios 
                 WHERE email = ? OR email LIKE ? OR login = ?`,
                [supervisor.email, `%${supervisor.nome.toLowerCase()}%`, supervisor.nome.toLowerCase()]
            );

            if (users.length === 0) {
                console.log(`   ⚠️ Usuário ${supervisor.nome} não encontrado`);
                continue;
            }

            const user = users[0];
            console.log(`   📋 Encontrado: ID ${user.id}, Nome: ${user.nome}, Email: ${user.email || user.login}`);
            console.log(`   📋 Áreas atuais: ${user.areas || '(vazio)'}`);
            console.log(`   📋 Permissões Vendas: ${user.permissoes_vendas ? '✅' : '❌'}`);

            // Construir query de atualização
            let updateQuery = `UPDATE usuarios SET areas = ?`;
            let params = [areas];

            if (hasPermissoesVendas) {
                updateQuery += `, permissoes_vendas = ?`;
                params.push(permissoesVendas);
            }

            updateQuery += ` WHERE id = ?`;
            params.push(user.id);

            const [result] = await connection.execute(updateQuery, params);

            if (result.affectedRows > 0) {
                console.log(`   ✅ Atualizado com sucesso!`);
                console.log(`   📋 Novas áreas: ${areas}`);
            } else {
                console.log(`   ❌ Falha ao atualizar`);
            }
        }

        // Verificar resultado final
        console.log('\n📊 Status final dos supervisores:');
        const [finalStatus] = await connection.execute(
            `SELECT id, nome, email, login, areas, 
                    CASE WHEN permissoes_vendas IS NOT NULL THEN '✅' ELSE '❌' END as vendas_perm
             FROM usuarios 
             WHERE email LIKE '%renata%' 
                OR email LIKE '%augusto%' 
                OR login LIKE '%renata%' 
                OR login LIKE '%augusto%'
                OR nome LIKE '%Renata%'
                OR nome LIKE '%Augusto%'`
        );

        console.log('\nID\tNome\t\t\tÁreas\t\t\tVendas Perm');
        console.log('─'.repeat(70));
        finalStatus.forEach(u => {
            const name = (u.nome || u.login || '').padEnd(20).substring(0, 20);
            const areasDisplay = (u.areas || '(vazio)').padEnd(25).substring(0, 25);
            console.log(`${u.id}\t${name}\t${areasDisplay}\t${u.vendas_perm}`);
        });

        await connection.end();
        console.log('\n✅ Correção de permissões concluída!');
        console.log('📌 Os supervisores Renata e Augusto agora devem ver os módulos RH e Vendas.');

    } catch (error) {
        console.error('❌ Erro:', error.message);
        if (error.code) console.error('   Código:', error.code);
        if (connection) await connection.end();
        process.exit(1);
    }
}

fixSupervisorAreas();
