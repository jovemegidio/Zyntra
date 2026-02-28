const mysql = require('mysql2/promise');

async function cadastrar() {
    const pool = mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });
    
    const materiais = [
        ['MP-PE-001', 'PE - Polietileno', 'PE', null, 'KG', 500000, 10000, 8.50],
        ['MP-AL-001', 'Aluminio Liga 1350', 'ALUMINIO', null, 'KG', 250000, 50000, 12.80],
        ['MP-CORDA-001', 'Corda de Polipropileno 8mm', 'OUTROS', null, 'M', 10000, 2000, 1.50],
        ['MP-CORDA-002', 'Cordinha de Nylon 4mm', 'OUTROS', null, 'M', 5000, 1000, 0.80],
        ['MP-PIG-PRT', 'Pigmento Preto MB', 'PIGMENTO', 'PRETO', 'KG', 1000, 200, 45.00],
        ['MP-PIG-CZA', 'Pigmento Cinza MB', 'PIGMENTO', 'CINZA', 'KG', 800, 150, 48.00],
        ['MP-PIG-VRM', 'Pigmento Vermelho MB', 'PIGMENTO', 'VERMELHO', 'KG', 600, 100, 52.00],
        ['MP-PIG-AZL', 'Pigmento Azul MB', 'PIGMENTO', 'AZUL', 'KG', 500, 100, 55.00],
        ['MP-COBRE-001', 'Cobre Eletrolitico', 'COBRE', null, 'KG', 50000, 10000, 65.00]
    ];
    
    console.log('=== CADASTRANDO MATERIAIS ===\n');
    
    for (const m of materiais) {
        try {
            await pool.query(
                'INSERT INTO estoque_materias_primas (codigo, nome, tipo, cor, unidade, quantidade_atual, quantidade_minima, preco_medio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                m
            );
            console.log('✅ Cadastrado: ' + m[1]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') {
                console.log('⚠️ Já existe: ' + m[1]);
            } else {
                console.log('❌ Erro em ' + m[1] + ': ' + e.message);
            }
        }
    }
    
    const [total] = await pool.query('SELECT COUNT(*) as total FROM estoque_materias_primas WHERE ativo = 1');
    console.log('\n📊 Total de materiais cadastrados: ' + total[0].total);
    
    await pool.end();
}

cadastrar().catch(console.error);
