const mysql = require('mysql2/promise');
(async () => {
    const c = await mysql.createConnection({host:'localhost',user:'aluforce',password:'Aluforce2026VpsDB',database:'aluforce_vendas'});
    
    // Buscar vendedores específicos
    const [vendedores] = await c.query("SELECT id, nome, email, role, departamento FROM usuarios WHERE nome LIKE '%Vitor%' OR nome LIKE '%Ronaldo%' OR nome LIKE '%Torres%'");
    console.log('=== VENDEDORES BUSCADOS ===');
    console.log(JSON.stringify(vendedores, null, 2));
    
    // Todos comerciais
    const [comerciais] = await c.query("SELECT id, nome, email, role, departamento FROM usuarios WHERE (role = 'comercial' OR role = 'vendedor' OR departamento IN ('Comercial','Vendas')) AND (ativo = 1 OR ativo IS NULL) ORDER BY nome");
    console.log('\n=== TODOS COMERCIAIS ===');
    console.log(JSON.stringify(comerciais, null, 2));
    
    // Produtos com estoque
    const [produtos] = await c.query("SELECT id, codigo, descricao, estoque_atual, unidade_medida FROM produtos WHERE estoque_atual > 0 ORDER BY estoque_atual DESC LIMIT 5");
    console.log('\n=== PRODUTOS COM ESTOQUE ===');
    console.log(JSON.stringify(produtos, null, 2));
    
    // Empresas
    const [empresas] = await c.query("SELECT id, nome_fantasia, razao_social FROM empresas LIMIT 5");
    console.log('\n=== EMPRESAS ===');
    console.log(JSON.stringify(empresas, null, 2));
    
    // Verificar validação no server
    const [cols] = await c.query("SHOW COLUMNS FROM pedidos LIKE 'empresa_id'");
    console.log('\n=== COLUNA EMPRESA_ID ===');
    console.log(JSON.stringify(cols, null, 2));
    
    await c.end();
})();
