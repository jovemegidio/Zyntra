/**
 * Script de Atualização de Estoque - Aluforce Cabos
 * Data: 02 de Março de 2026
 * Fonte: Lista de Estoque - Aluforce Cabos - 02 de Mar.xlsx
 * 
 * Este script:
 * 1. Lê os dados atuais do banco (tabela materiais)
 * 2. Compara com os dados da planilha
 * 3. Atualiza quantidades existentes
 * 4. Insere novos materiais que não existem
 * 5. Gera log detalhado das alterações
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
// Tentar também .env do diretório raiz
require('dotenv').config();

// ====================================================
// DADOS DO ESTOQUE - 02/03/2026
// Extraídos da planilha: Lista de Estoque - Aluforce Cabos - 02 de Mar.xlsx
// Agrupados por código (soma de todas as bobinas)
// ====================================================
const estoqueAtualizado = [
    { codigo: 'CET2.15', descricao: 'CB DE POTÊNCIA 2x1,5mm² 0,6/1KV NBR 7286 AL/HEPR', quantidade: 3420, unidade: 'M', bobinas: 9 },
    { codigo: 'CET2.25', descricao: 'CB DE POTÊNCIA 2x2,5mm² 0,6/1KV NBR 7286 AL/HEPR', quantidade: 70, unidade: 'M', bobinas: 1 },
    { codigo: 'CET2.40', descricao: 'CB DE POTÊNCIA 2x4,0mm² 0,6/1KV NBR 7286 AL/HEPR', quantidade: 390, unidade: 'M', bobinas: 2 },
    { codigo: 'CET3.25', descricao: 'CB DE POTÊNCIA 3x2,5mm² 0,6/1KV NBR 7286 AL/HEPR', quantidade: 1090, unidade: 'M', bobinas: 3 },
    { codigo: 'CET4.15', descricao: 'CB DE POTÊNCIA 4x1,5mm² 0,6/1KV NBR 7286 AL/HEPR', quantidade: 5810, unidade: 'M', bobinas: 7 },
    { codigo: 'CET8.15', descricao: 'CB DE POTÊNCIA 8x1,5mm² 0,6/1KV NBR 7286 AL/HEPR', quantidade: 130, unidade: 'M', bobinas: 1 },
    { codigo: 'CORDA 185', descricao: 'FILAMENTO 19x2,85mm 36,78kg.', quantidade: 109, unidade: 'M', bobinas: 1 },
    { codigo: 'CORDA 95', descricao: 'FILAMENTO 7x3,40mm 16kg.', quantidade: 90, unidade: 'M', bobinas: 1 },
    { codigo: 'DUI10', descricao: 'CB DUPLEX 10mm² NEUTRO ISOLADO', quantidade: 500, unidade: 'M', bobinas: 1 },
    { codigo: 'DUI16', descricao: 'CB DUPLEX 16mm² NEUTRO ISOLADO', quantidade: 590, unidade: 'M', bobinas: 4 },
    { codigo: 'DUI25', descricao: 'CB DUPLEX 25mm² NEUTRO ISOLADO', quantidade: 230, unidade: 'M', bobinas: 2 },
    { codigo: 'DUI35', descricao: 'CB DUPLEX 35mm² NEUTRO ISOLADO', quantidade: 70, unidade: 'M', bobinas: 1 },
    { codigo: 'DUN10', descricao: 'CB DUPLEX 10mm² NEUTRO NÚ', quantidade: 790, unidade: 'M', bobinas: 6 },
    { codigo: 'DUN16', descricao: 'CB DUPLEX 16mm² NEUTRO NÚ', quantidade: 417, unidade: 'M', bobinas: 4 },
    { codigo: 'DUN25', descricao: 'CB DUPLEX 25mm² NEUTRO NÚ', quantidade: 220, unidade: 'M', bobinas: 2 },
    { codigo: 'DUN35', descricao: 'CB DUPLEX 35mm² NEUTRO NÚ', quantidade: 300, unidade: 'M', bobinas: 3 },
    { codigo: 'PRO150', descricao: 'CB PROTEGIDO 150mm² 15KV NBR 11873', quantidade: 300, unidade: 'M', bobinas: 1 },
    { codigo: 'PRO185', descricao: 'CABO PROTEGIDO 185mm 15kv', quantidade: 210, unidade: 'M', bobinas: 2 },
    { codigo: 'PRO50', descricao: 'CB PROTEGIDO 50mm² 15KV NBR 11873', quantidade: 270, unidade: 'M', bobinas: 1 },
    { codigo: 'QDN10', descricao: 'CB QUAD 10mm² NEUTRO NÚ', quantidade: 230, unidade: 'M', bobinas: 3 },
    { codigo: 'QDN16', descricao: 'CB QUAD 16mm² NEUTRO NÚ', quantidade: 230, unidade: 'M', bobinas: 3 },
    { codigo: 'QDN35', descricao: 'CB QUAD 35mm² NEUTRO NÚ', quantidade: 50, unidade: 'M', bobinas: 1 },
    { codigo: 'TRI25', descricao: 'CB TRIPLEX 25mm² NEUTRO ISOLADO', quantidade: 130, unidade: 'M', bobinas: 1 },
    { codigo: 'TRN10', descricao: 'CB TRIPLEX 10mm² NEUTRO NÚ', quantidade: 300, unidade: 'M', bobinas: 3 },
    { codigo: 'TRN16', descricao: 'CB TRIPLEX 16mm² NEUTRO NÚ', quantidade: 210, unidade: 'M', bobinas: 3 },
    { codigo: 'TRN35', descricao: 'CB TRIPLEX 35mm² NEUTRO NÚ', quantidade: 90, unidade: 'M', bobinas: 2 },
    { codigo: 'UN10', descricao: 'CB DE POTÊNCIA 10mm 0,6/1KV NBR 7285', quantidade: 7419, unidade: 'M', bobinas: 20 },
    { codigo: 'UN120', descricao: 'CB DE POTÊNCIA 120mm² 0,6/1KV NBR 7285', quantidade: 210, unidade: 'M', bobinas: 1 },
    { codigo: 'UN16', descricao: 'CB DE POTÊNCIA 16mm 0,6/1KV NBR 7285', quantidade: 5384, unidade: 'M', bobinas: 16 },
    { codigo: 'UN185', descricao: 'CB DE POTÊNCIA 185mm² 0,6/1KV NBR 7285', quantidade: 375, unidade: 'M', bobinas: 2 },
    { codigo: 'UN240', descricao: 'CB DE POTÊNCIA 240mm² 0,6/1KV NBR 7285', quantidade: 128, unidade: 'M', bobinas: 2 },
    { codigo: 'UN25', descricao: 'CB DE POTÊNCIA 25mm 0,6/1KV NBR 7285', quantidade: 1322, unidade: 'M', bobinas: 4 },
    { codigo: 'UN35', descricao: 'CB DE POTÊNCIA 35mm 0,6/1KV NBR 7285', quantidade: 3712, unidade: 'M', bobinas: 16 },
    { codigo: 'UN50', descricao: 'CB DE POTÊNCIA 50mm² 0,6/1KV NBR 7285', quantidade: 844, unidade: 'M', bobinas: 6 },
    { codigo: 'UN70', descricao: 'CB DE POTÊNCIA 70mm² 0,6/1KV NBR 7285', quantidade: 120, unidade: 'M', bobinas: 2 },
    { codigo: 'UN95', descricao: 'CB DE POTÊNCIA 95mm² 0,6/1KV NBR 7285', quantidade: 96, unidade: 'M', bobinas: 1 },
];

async function atualizarEstoque() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
            database: process.env.DB_NAME || 'aluforce_vendas',
            port: parseInt(process.env.DB_PORT) || 3306,
            waitForConnections: true,
            connectionLimit: 5,
        });

        console.log('🔌 Conectando ao banco de dados...');
        const [testConn] = await pool.query('SELECT 1 as ok');
        console.log('✅ Conexão OK!\n');

        // 1. Verificar se as tabelas existem
        console.log('📋 Verificando tabelas...');
        const [tables] = await pool.query("SHOW TABLES LIKE 'materiais'");
        const [tablesProd] = await pool.query("SHOW TABLES LIKE 'produtos'");
        console.log(`   Tabela materiais: ${tables.length > 0 ? '✅ Existe' : '❌ Não existe'}`);
        console.log(`   Tabela produtos: ${tablesProd.length > 0 ? '✅ Existe' : '❌ Não existe'}`);

        // 2. Ver colunas das tabelas
        if (tables.length > 0) {
            const [cols] = await pool.query('SHOW COLUMNS FROM materiais');
            console.log('\n📊 Colunas da tabela materiais:');
            cols.forEach(c => console.log(`   - ${c.Field} (${c.Type}) ${c.Key === 'PRI' ? '🔑' : ''}`));
        }

        if (tablesProd.length > 0) {
            const [cols] = await pool.query('SHOW COLUMNS FROM produtos');
            console.log('\n📊 Colunas da tabela produtos:');
            cols.forEach(c => console.log(`   - ${c.Field} (${c.Type}) ${c.Key === 'PRI' ? '🔑' : ''}`));
        }

        // 3. Buscar materiais atuais
        let materiaisAtuais = [];
        if (tables.length > 0) {
            const [rows] = await pool.query('SELECT * FROM materiais ORDER BY codigo_material ASC');
            materiaisAtuais = rows;
            console.log(`\n📦 Materiais no banco: ${materiaisAtuais.length}`);
        }

        // 4. Buscar produtos atuais
        let produtosAtuais = [];
        if (tablesProd.length > 0) {
            const [rows] = await pool.query('SELECT * FROM produtos ORDER BY codigo ASC');
            produtosAtuais = rows;
            console.log(`📦 Produtos no banco: ${produtosAtuais.length}`);
        }

        // 5. Criar mapa de materiais existentes por código
        const materiaisMap = {};
        materiaisAtuais.forEach(m => {
            const cod = (m.codigo_material || '').trim().toUpperCase();
            if (cod) materiaisMap[cod] = m;
        });

        // 6. Criar mapa de produtos existentes por código
        const produtosMap = {};
        produtosAtuais.forEach(p => {
            const cod = (p.codigo || '').trim().toUpperCase();
            if (cod) produtosMap[cod] = p;
        });

        console.log('\n' + '='.repeat(80));
        console.log('📋 ATUALIZAÇÃO DE ESTOQUE - 02/03/2026');
        console.log('='.repeat(80));

        let atualizados = 0;
        let inseridos = 0;
        let semAlteracao = 0;
        const alteracoes = [];

        for (const item of estoqueAtualizado) {
            const codUpper = item.codigo.trim().toUpperCase();

            // Tentar encontrar na tabela materiais
            const materialExistente = materiaisMap[codUpper];
            // Tentar encontrar na tabela produtos
            const produtoExistente = produtosMap[codUpper];

            if (materialExistente) {
                const estoqueAnterior = parseFloat(materialExistente.quantidade_estoque) || 0;
                const estoqueNovo = item.quantidade;

                if (estoqueAnterior !== estoqueNovo) {
                    // Atualizar quantidade na tabela materiais
                    await pool.query(
                        'UPDATE materiais SET quantidade_estoque = ? WHERE id = ?',
                        [estoqueNovo, materialExistente.id]
                    );
                    const diff = estoqueNovo - estoqueAnterior;
                    const sinal = diff > 0 ? '+' : '';
                    console.log(`   ✏️  [MATERIAL] ${item.codigo}: ${estoqueAnterior} → ${estoqueNovo} (${sinal}${diff})`);
                    alteracoes.push({
                        tabela: 'materiais',
                        tipo: 'atualizado',
                        codigo: item.codigo,
                        descricao: item.descricao,
                        anterior: estoqueAnterior,
                        novo: estoqueNovo,
                        diff: diff
                    });
                    atualizados++;
                } else {
                    console.log(`   ✅ [MATERIAL] ${item.codigo}: ${estoqueNovo} (sem alteração)`);
                    semAlteracao++;
                }
            } else if (produtoExistente) {
                const estoqueAnterior = parseFloat(produtoExistente.estoque_atual || produtoExistente.quantidade_estoque || 0);
                const estoqueNovo = item.quantidade;

                if (estoqueAnterior !== estoqueNovo) {
                    // Atualizar na tabela produtos
                    const colEstoque = produtosAtuais.some(p => 'estoque_atual' in p) ? 'estoque_atual' : 'quantidade_estoque';
                    await pool.query(
                        `UPDATE produtos SET ${colEstoque} = ? WHERE id = ?`,
                        [estoqueNovo, produtoExistente.id]
                    );
                    const diff = estoqueNovo - estoqueAnterior;
                    const sinal = diff > 0 ? '+' : '';
                    console.log(`   ✏️  [PRODUTO] ${item.codigo}: ${estoqueAnterior} → ${estoqueNovo} (${sinal}${diff})`);
                    alteracoes.push({
                        tabela: 'produtos',
                        tipo: 'atualizado',
                        codigo: item.codigo,
                        descricao: item.descricao,
                        anterior: estoqueAnterior,
                        novo: estoqueNovo,
                        diff: diff
                    });
                    atualizados++;
                } else {
                    console.log(`   ✅ [PRODUTO] ${item.codigo}: ${estoqueNovo} (sem alteração)`);
                    semAlteracao++;
                }
            } else {
                // Material/Produto não existe - inserir na tabela materiais
                if (tables.length > 0) {
                    await pool.query(
                        'INSERT INTO materiais (codigo_material, descricao, unidade_medida, quantidade_estoque) VALUES (?, ?, ?, ?)',
                        [item.codigo, item.descricao, item.unidade, item.quantidade]
                    );
                    console.log(`   🆕 [NOVO] ${item.codigo}: ${item.descricao} - QTD: ${item.quantidade}`);
                    alteracoes.push({
                        tabela: 'materiais',
                        tipo: 'inserido',
                        codigo: item.codigo,
                        descricao: item.descricao,
                        anterior: 0,
                        novo: item.quantidade,
                        diff: item.quantidade
                    });
                    inseridos++;
                }
            }
        }

        // Resumo
        console.log('\n' + '='.repeat(80));
        console.log('📊 RESUMO DA ATUALIZAÇÃO');
        console.log('='.repeat(80));
        console.log(`   📅 Data: 02/03/2026`);
        console.log(`   📄 Fonte: Lista de Estoque - Aluforce Cabos - 02 de Mar.xlsx`);
        console.log(`   📦 Total de itens na planilha: ${estoqueAtualizado.length}`);
        console.log(`   ✏️  Atualizados: ${atualizados}`);
        console.log(`   🆕 Novos inseridos: ${inseridos}`);
        console.log(`   ✅ Sem alteração: ${semAlteracao}`);
        console.log('='.repeat(80));

        if (alteracoes.length > 0) {
            console.log('\n📋 DETALHES DAS ALTERAÇÕES:');
            console.log('-'.repeat(80));
            console.log(`${'Código'.padEnd(14)} | ${'Tipo'.padEnd(12)} | ${'Anterior'.padStart(10)} | ${'Novo'.padStart(10)} | ${'Diferença'.padStart(10)}`);
            console.log('-'.repeat(80));
            alteracoes.forEach(a => {
                const sinal = a.diff > 0 ? '+' : '';
                console.log(`${a.codigo.padEnd(14)} | ${a.tipo.padEnd(12)} | ${String(a.anterior).padStart(10)} | ${String(a.novo).padStart(10)} | ${(sinal + a.diff).padStart(10)}`);
            });
        }

        console.log('\n✅ Atualização de estoque concluída com sucesso!');

    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('   → Verifique se o MySQL está rodando');
        }
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('   → Credenciais inválidas');
        }
    } finally {
        if (pool) await pool.end();
    }
}

atualizarEstoque();
