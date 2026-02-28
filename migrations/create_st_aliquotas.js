/**
 * Migration: Criar tabela st_aliquotas_fornecedor
 * Armazena alíquotas de ST (Substituição Tributária) por fornecedor, estado e regime tributário
 * 
 * Uso: node migrations/create_st_aliquotas.js
 */
'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'aluforce',
        password: process.env.DB_PASSWORD || 'Aluforce2026VpsDB',
        database: process.env.DB_NAME || 'aluforce_vendas',
        waitForConnections: true,
        connectionLimit: 2
    });

    console.log('🔄 Criando tabela st_aliquotas_fornecedor...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS st_aliquotas_fornecedor (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fornecedor VARCHAR(100) NOT NULL COMMENT 'Nome do fornecedor (ex: LABOR ENERGY)',
            uf_destino CHAR(2) NOT NULL COMMENT 'UF destino (ex: SP, MG, RJ)',
            regime_tributario ENUM('simples_nacional', 'lucro_presumido', 'lucro_presumido_ipi', 'lucro_real') NOT NULL COMMENT 'Regime tributário do destinatário',
            aliquota_st DECIMAL(6,2) NOT NULL COMMENT 'Alíquota ST em percentual (ex: 17.48)',
            descricao_regime VARCHAR(100) DEFAULT NULL COMMENT 'Descrição legível (ex: ST Revenda - Simples Nacional)',
            ncm VARCHAR(8) DEFAULT NULL COMMENT 'NCM específico (NULL = aplica a todos do fornecedor)',
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            observacao TEXT DEFAULT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            UNIQUE KEY uk_fornecedor_uf_regime_ncm (fornecedor, uf_destino, regime_tributario, ncm),
            KEY idx_fornecedor (fornecedor),
            KEY idx_uf_destino (uf_destino),
            KEY idx_regime (regime_tributario)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
          COMMENT='Alíquotas de Substituição Tributária por fornecedor/estado/regime'
    `);

    console.log('✅ Tabela st_aliquotas_fornecedor criada');

    // ========================================
    // Inserir dados da LABOR ENERGY
    // ========================================
    console.log('🔄 Inserindo dados da LABOR ENERGY...');

    const dados = [
        // ST REVENDA - SIMPLES NACIONAL
        ['LABOR ENERGY', 'DF', 'simples_nacional', 17.48, 'ST Revenda - Simples Nacional'],
        ['LABOR ENERGY', 'MG', 'simples_nacional', 20.20, 'ST Revenda - Simples Nacional'],
        ['LABOR ENERGY', 'PE', 'simples_nacional', 13.20, 'ST Revenda - Simples Nacional'],
        ['LABOR ENERGY', 'PR', 'simples_nacional', 14.52, 'ST Revenda - Simples Nacional'],
        ['LABOR ENERGY', 'RJ', 'simples_nacional', 19.02, 'ST Revenda - Simples Nacional'],
        ['LABOR ENERGY', 'SP', 'simples_nacional',  7.74, 'ST Revenda - Simples Nacional'],

        // ST REVENDA - LUCRO PRESUMIDO
        ['LABOR ENERGY', 'AP', 'lucro_presumido', 20.76, 'ST Revenda - Lucro Presumido'],
        ['LABOR ENERGY', 'DF', 'lucro_presumido', 24.62, 'ST Revenda - Lucro Presumido'],
        ['LABOR ENERGY', 'MG', 'lucro_presumido', 15.04, 'ST Revenda - Lucro Presumido'],
        ['LABOR ENERGY', 'PE', 'lucro_presumido', 26.81, 'ST Revenda - Lucro Presumido'],
        ['LABOR ENERGY', 'PR', 'lucro_presumido', 16.99, 'ST Revenda - Lucro Presumido'],
        ['LABOR ENERGY', 'RJ', 'lucro_presumido', 22.12, 'ST Revenda - Lucro Presumido'],
        ['LABOR ENERGY', 'SP', 'lucro_presumido',  7.74, 'ST Revenda - Lucro Presumido'],

        // ST REVENDA - LUCRO PRESUMIDO COM IPI
        ['LABOR ENERGY', 'AP', 'lucro_presumido_ipi', 27.15, 'ST Revenda - Lucro Presumido c/ IPI'],
        ['LABOR ENERGY', 'DF', 'lucro_presumido_ipi', 31.20, 'ST Revenda - Lucro Presumido c/ IPI'],
        ['LABOR ENERGY', 'MG', 'lucro_presumido_ipi', 21.40, 'ST Revenda - Lucro Presumido c/ IPI'],
        ['LABOR ENERGY', 'PE', 'lucro_presumido_ipi', 33.50, 'ST Revenda - Lucro Presumido c/ IPI'],
        ['LABOR ENERGY', 'PR', 'lucro_presumido_ipi', 23.44, 'ST Revenda - Lucro Presumido c/ IPI'],
        ['LABOR ENERGY', 'RJ', 'lucro_presumido_ipi', 28.83, 'ST Revenda - Lucro Presumido c/ IPI'],
        ['LABOR ENERGY', 'SP', 'lucro_presumido_ipi', 14.03, 'ST Revenda - Lucro Presumido c/ IPI'],
    ];

    const sql = `INSERT INTO st_aliquotas_fornecedor 
                 (fornecedor, uf_destino, regime_tributario, aliquota_st, descricao_regime) 
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE aliquota_st = VALUES(aliquota_st), descricao_regime = VALUES(descricao_regime), ativo = 1`;

    let inseridos = 0;
    for (const row of dados) {
        await pool.query(sql, row);
        inseridos++;
    }

    console.log(`✅ ${inseridos} alíquotas ST da LABOR ENERGY inseridas`);

    // Verificar
    const [count] = await pool.query('SELECT COUNT(*) as total FROM st_aliquotas_fornecedor');
    console.log(`📊 Total de registros na tabela: ${count[0].total}`);

    const [resumo] = await pool.query(`
        SELECT fornecedor, regime_tributario, COUNT(*) as estados, 
               MIN(aliquota_st) as min_aliq, MAX(aliquota_st) as max_aliq
        FROM st_aliquotas_fornecedor 
        WHERE ativo = 1
        GROUP BY fornecedor, regime_tributario
        ORDER BY fornecedor, regime_tributario
    `);
    console.table(resumo);

    await pool.end();
    console.log('🏁 Migration concluída com sucesso!');
}

migrate().catch(err => {
    console.error('❌ Erro na migration:', err.message);
    process.exit(1);
});
