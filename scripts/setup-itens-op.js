const mysql = require('mysql2/promise');

async function setup() {
    const pool = mysql.createPool({
        host: 'interchange.proxy.rlwy.net',
        port: 19396,
        user: 'root',
        password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: 'railway'
    });

    // Adicionar colunas extras na tabela itens
    try {
        await pool.query(`ALTER TABLE itens_ordem_producao ADD COLUMN estoque_disponivel DECIMAL(15,2) DEFAULT 0`);
        console.log('Coluna estoque_disponivel adicionada');
    } catch(e) { console.log('estoque_disponivel já existe'); }
    
    try {
        await pool.query(`ALTER TABLE itens_ordem_producao ADD COLUMN local_estoque VARCHAR(100)`);
        console.log('Coluna local_estoque adicionada');
    } catch(e) { console.log('local_estoque já existe'); }
    
    try {
        await pool.query(`ALTER TABLE itens_ordem_producao ADD COLUMN tipo_item VARCHAR(50) DEFAULT 'MATERIA_PRIMA'`);
        console.log('Coluna tipo_item adicionada');
    } catch(e) { console.log('tipo_item já existe'); }
    
    try {
        await pool.query(`ALTER TABLE itens_ordem_producao ADD COLUMN custo_unitario DECIMAL(15,4) DEFAULT 0`);
        console.log('Coluna custo_unitario adicionada');
    } catch(e) { console.log('custo_unitario já existe'); }

    // Inserir itens de exemplo
    const itens = [
        [1, 'PROD001', 'CABO BIMETALICO 16MM 7 VIAS', 30000, 'UN', 0, 'ALMOXARIFADO', 'PRODUTO_ACABADO', 2.50],
        [1, 'MP001', 'Matéria-prima 1', 15000, 'UN', 1000, 'DEPÓSITO A', 'MATERIA_PRIMA', 0.85],
        [1, 'MP002', 'Matéria-prima 2', 9000, 'UN', 500, 'DEPÓSITO B', 'MATERIA_PRIMA', 1.20],
        [1, 'COMP01', 'Componente 1', 30000, 'UN', 200, 'PRODUÇÁO', 'COMPONENTE', 0.45],
        [1, 'EMB001', 'Embalagem', 3000, 'UN', 5000, 'EXPEDIÇÁO', 'EMBALAGEM', 0.30]
    ];

    for (const item of itens) {
        try {
            await pool.query(`
                INSERT INTO itens_ordem_producao 
                (ordem_producao_id, codigo_material, descricao_material, quantidade_necessaria, unidade_medida, estoque_disponivel, local_estoque, tipo_item, custo_unitario) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, item);
            console.log('✅ Adicionado:', item[2]);
        } catch(e) {
            console.log('⚠️ Erro:', item[2], e.message);
        }
    }

    // Adicionar coluna pedido_vinculado na tabela ordens_producao
    try {
        await pool.query(`ALTER TABLE ordens_producao ADD COLUMN pedido_vinculado_id INT`);
        console.log('Coluna pedido_vinculado_id adicionada');
    } catch(e) { console.log('pedido_vinculado_id já existe'); }
    
    try {
        await pool.query(`ALTER TABLE ordens_producao ADD COLUMN cliente_nome VARCHAR(200)`);
        console.log('Coluna cliente_nome adicionada');
    } catch(e) { console.log('cliente_nome já existe'); }

    // Verificar itens
    const [itensDb] = await pool.query('SELECT * FROM itens_ordem_producao WHERE ordem_producao_id = 1');
    console.log('\n📦 Itens da OP-1:', itensDb.length);
    itensDb.forEach(i => console.log(`  - ${i.codigo_material}: ${i.descricao_material}`));

    await pool.end();
}

setup().catch(console.error);
