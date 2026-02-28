/**
 * Cadastrar clientes faltantes e importar seus pedidos
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function cadastrarEImportar() {
    const pool = await mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    const clientesFaltantes = [
        'AM SOLUCOES E SERVICOS INTELIGENTES',
        'BARRA MANSA COMERCIO E REPRESENTACAO LTDA',
        'CIRCUITO DISTRIBUIDORA',
        'DISTRIBUIDORA KANAL LTDA',
        'ELETRICA JACUIPE',
        'GESSO & CIA',
        'MR.CABOS LTDA',
        'PAULA BEATRIZ CAETANO MAIA LTDA',
        'PRAVALUZ',
        'PRELUZ ELETRICIDADE E SERVICOS LTDA',
        'RCE ENGENHARIA E CONSULTORIA LTDA',
        'RELLUZ COMERCIO DE MATERIAIS DE CONSTRUCAO',
        'ROCHA MATERIAIS PARA CONSTRUCAO'
    ];
    
    console.log('📝 Cadastrando clientes faltantes...\n');
    
    for (const nome of clientesFaltantes) {
        try {
            const [result] = await pool.query(
                `INSERT INTO clientes (nome, razao_social, nome_fantasia, empresa_id, created_at) 
                 VALUES (?, ?, ?, 1, NOW())`,
                [nome, nome, nome]
            );
            console.log('✅ Cadastrado:', nome, '- ID:', result.insertId);
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                console.log('⚠️ Já existe:', nome);
            } else {
                console.log('❌ Erro:', nome, err.message);
            }
        }
    }
    
    console.log('\n✅ Clientes cadastrados!');
    await pool.end();
}

cadastrarEImportar();
