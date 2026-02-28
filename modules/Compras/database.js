/**
 * DATABASE HANDLER - MÓDULO DE COMPRAS
 * Conexão MySQL (unificado com o banco principal)
 * 
 * ATUALIZADO: 17/01/2026 - Removido SQLite, usando apenas MySQL
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

let mysqlPool;

/**
 * Inicializar pool MySQL
 */
async function initMySQLPool() {
    if (mysqlPool) {
        console.log('⏭️  Pool MySQL já inicializado para módulo Compras');
        return mysqlPool;
    }

    try {
        mysqlPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'railway',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 50,
            charset: 'utf8mb4',
            enableKeepAlive: true,
            keepAliveInitialDelay: 30000,
            connectTimeout: 60000
        });

        // Testar conexão
        const conn = await mysqlPool.getConnection();
        console.log('✅ Pool MySQL inicializado para módulo Compras');
        conn.release();

        // Garantir que as tabelas existam
        await createTablesIfNotExist();

        return mysqlPool;
    } catch (error) {
        console.error('❌ Erro ao criar pool MySQL:', error);
        throw error;
    }
}

/**
 * Criar tabelas se não existirem
 */
async function createTablesIfNotExist() {
    const tables = [
        // Tabela de Fornecedores (usa a tabela existente 'fornecedores' do sistema)
        // Não criar, já existe no banco principal

        // Tabela de Requisições de Compra
        `CREATE TABLE IF NOT EXISTS requisicoes_compras (
            id INT AUTO_INCREMENT PRIMARY KEY,
            numero VARCHAR(20) NOT NULL,
            solicitante VARCHAR(100),
            departamento VARCHAR(100),
            data_requisicao DATE,
            status ENUM('pendente', 'aprovada', 'rejeitada', 'em_cotacao', 'concluida') DEFAULT 'pendente',
            prioridade ENUM('baixa', 'media', 'alta', 'urgente') DEFAULT 'media',
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Tabela de Itens da Requisição
        `CREATE TABLE IF NOT EXISTS itens_requisicao (
            id INT AUTO_INCREMENT PRIMARY KEY,
            requisicao_id INT NOT NULL,
            descricao VARCHAR(255) NOT NULL,
            quantidade DECIMAL(15,4) DEFAULT 0,
            unidade VARCHAR(20),
            observacao TEXT,
            status ENUM('pendente', 'cotado', 'comprado') DEFAULT 'pendente',
            FOREIGN KEY (requisicao_id) REFERENCES requisicoes_compras(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Tabela de Cotações
        `CREATE TABLE IF NOT EXISTS cotacoes_compras (
            id INT AUTO_INCREMENT PRIMARY KEY,
            requisicao_id INT,
            fornecedor_id INT,
            numero VARCHAR(20),
            data_cotacao DATE,
            validade DATE,
            valor_total DECIMAL(15,2) DEFAULT 0,
            status ENUM('aberta', 'enviada', 'recebida', 'aprovada', 'rejeitada') DEFAULT 'aberta',
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Tabela de Pedidos de Compra
        `CREATE TABLE IF NOT EXISTS pedidos_compras (
            id INT AUTO_INCREMENT PRIMARY KEY,
            numero VARCHAR(20) NOT NULL,
            cotacao_id INT,
            fornecedor_id INT,
            requisicao_id INT,
            data_pedido DATE,
            data_entrega_prevista DATE,
            valor_total DECIMAL(15,2) DEFAULT 0,
            status ENUM('pendente', 'aprovado', 'enviado', 'em_transito', 'recebido', 'cancelado') DEFAULT 'pendente',
            forma_pagamento VARCHAR(100),
            condicao_pagamento VARCHAR(100),
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Tabela de Itens do Pedido
        `CREATE TABLE IF NOT EXISTS itens_pedido_compras (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NOT NULL,
            descricao VARCHAR(255) NOT NULL,
            quantidade DECIMAL(15,4) DEFAULT 0,
            quantidade_recebida DECIMAL(15,4) DEFAULT 0,
            unidade VARCHAR(20),
            preco_unitario DECIMAL(15,4) DEFAULT 0,
            preco_total DECIMAL(15,2) DEFAULT 0,
            FOREIGN KEY (pedido_id) REFERENCES pedidos_compras(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Tabela de Recebimentos
        `CREATE TABLE IF NOT EXISTS recebimentos_compras (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NOT NULL,
            data_recebimento DATETIME,
            nota_fiscal VARCHAR(50),
            recebido_por VARCHAR(100),
            status ENUM('parcial', 'completo') DEFAULT 'parcial',
            observacoes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos_compras(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ];

    for (const sql of tables) {
        try {
            await mysqlPool.query(sql);
        } catch (err) {
            // Ignorar erros de tabela já existente
            if (err.code !== 'ER_TABLE_EXISTS_ERROR') {
                console.warn('⚠️ Aviso ao criar tabela:', err.message);
            }
        }
    }
}

/**
 * Obter pool MySQL
 */
function getDatabase() {
    if (!mysqlPool) {
        throw new Error('MySQL pool não inicializado. Chame initMySQLPool() primeiro.');
    }
    return mysqlPool;
}

/**
 * Executar query SELECT (retorna array de resultados)
 */
async function query(sql, params = []) {
    const pool = getDatabase();
    const [rows] = await pool.query(sql, params);
    return rows;
}

/**
 * Executar INSERT/UPDATE/DELETE (retorna info de resultado)
 */
async function run(sql, params = []) {
    const pool = getDatabase();
    const [result] = await pool.query(sql, params);
    return { 
        id: result.insertId, 
        changes: result.affectedRows,
        insertId: result.insertId,
        affectedRows: result.affectedRows
    };
}

/**
 * Obter uma única linha
 */
async function get(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] || null;
}

/**
 * Fechar conexão (para compatibilidade)
 */
async function close() {
    if (mysqlPool) {
        await mysqlPool.end();
        mysqlPool = null;
        console.log('📦 Pool MySQL do módulo Compras fechado');
    }
}

/**
 * initDatabase - Mantido para compatibilidade
 * Agora apenas inicializa MySQL
 */
async function initDatabase() {
    return initMySQLPool();
}

module.exports = {
    initDatabase,
    initMySQLPool,
    getDatabase,
    query,
    run,
    get,
    close,
    getDB: () => mysqlPool,  // Compatibilidade
    getMySQLPool: () => mysqlPool
};
