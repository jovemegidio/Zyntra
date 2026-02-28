/**
 * DATABASE HANDLER - MÓDULO DE COMPRAS
 * Gerenciamento de conexáo SQLite + MySQL
 */

const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const path = require('path');

const DB_PATH = path.join(__dirname, 'compras.db');

let db;
let mysqlPool;

/**
 * Inicializar pool MySQL (para APIs que usam sintaxe MySQL)
 */
async function initMySQLPool() {
    try {
        mysqlPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'aluforce',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: 'utf8mb4'
        });
        console.log('✅ Pool MySQL inicializado para módulo Compras');
        return mysqlPool;
    } catch (error) {
        console.error('❌ Erro ao criar pool MySQL:', error);
        throw error;
    }
}

/**
 * Obter conexáo MySQL (compatibilidade com APIs existentes)
 */
function getDatabase() {
    if (!mysqlPool) {
        throw new Error('MySQL pool náo inicializado. Chame initMySQLPool() primeiro.');
    }
    return mysqlPool;
}

/**
 * Inicializar banco de dados SQLite
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌ Erro ao conectar ao banco:', err);
                reject(err);
            } else {
                console.log('✅ Conectado ao banco de dados de Compras (SQLite)');
                createTables()
                    .then(() => resolve(db))
                    .catch(reject);
            }
        });
    });
}

/**
 * Criar tabelas se náo existirem
 */
function createTables() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Tabela de Fornecedores
            db.run(`
                CREATE TABLE IF NOT EXISTS fornecedores (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    razao_social TEXT NOT NULL,
                    nome_fantasia TEXT,
                    cnpj TEXT UNIQUE NOT NULL,
                    ie TEXT,
                    endereco TEXT,
                    cidade TEXT,
                    estado TEXT,
                    cep TEXT,
                    telefone TEXT,
                    email TEXT,
                    contato_principal TEXT,
                    condicoes_pagamento TEXT,
                    prazo_entrega_padrao INTEGER DEFAULT 0,
                    observacoes TEXT,
                    ativo INTEGER DEFAULT 1,
                    data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela fornecedores:', err);
            });

            // Tabela de Pedidos de Compra
            db.run(`
                CREATE TABLE IF NOT EXISTS pedidos_compra (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero_pedido TEXT UNIQUE NOT NULL,
                    fornecedor_id INTEGER NOT NULL,
                    data_pedido DATE NOT NULL,
                    data_entrega_prevista DATE,
                    data_entrega_real DATE,
                    status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'aprovado', 'parcial', 'recebido', 'cancelado')),
                    valor_total REAL NOT NULL DEFAULT 0,
                    desconto REAL DEFAULT 0,
                    frete REAL DEFAULT 0,
                    valor_final REAL NOT NULL DEFAULT 0,
                    observacoes TEXT,
                    usuario_solicitante_id INTEGER,
                    usuario_aprovador_id INTEGER,
                    data_aprovacao DATETIME,
                    motivo_cancelamento TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id)
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela pedidos_compra:', err);
            });

            // Tabela de Itens do Pedido
            db.run(`
                CREATE TABLE IF NOT EXISTS itens_pedido (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id INTEGER NOT NULL,
                    produto_id INTEGER,
                    codigo_produto TEXT,
                    descricao TEXT NOT NULL,
                    quantidade REAL NOT NULL,
                    unidade TEXT DEFAULT 'UN',
                    preco_unitario REAL NOT NULL,
                    preco_total REAL NOT NULL,
                    quantidade_recebida REAL DEFAULT 0,
                    observacoes TEXT,
                    FOREIGN KEY (pedido_id) REFERENCES pedidos_compra(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela itens_pedido:', err);
            });

            // Tabela de Cotações
            db.run(`
                CREATE TABLE IF NOT EXISTS cotacoes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero_cotacao TEXT UNIQUE NOT NULL,
                    descricao TEXT NOT NULL,
                    data_solicitacao DATE NOT NULL,
                    data_limite DATE,
                    status TEXT DEFAULT 'aberta' CHECK(status IN ('aberta', 'em_analise', 'concluida', 'cancelada')),
                    usuario_solicitante_id INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela cotacoes:', err);
            });

            // Tabela de Propostas de Cotaçáo
            db.run(`
                CREATE TABLE IF NOT EXISTS propostas_cotacao (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cotacao_id INTEGER NOT NULL,
                    fornecedor_id INTEGER NOT NULL,
                    valor_total REAL NOT NULL,
                    prazo_entrega INTEGER,
                    condicoes_pagamento TEXT,
                    observacoes TEXT,
                    selecionada INTEGER DEFAULT 0,
                    data_proposta DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (cotacao_id) REFERENCES cotacoes(id) ON DELETE CASCADE,
                    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id)
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela propostas_cotacao:', err);
            });

            // Tabela de Histórico de Preços
            db.run(`
                CREATE TABLE IF NOT EXISTS historico_precos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    fornecedor_id INTEGER NOT NULL,
                    produto_id INTEGER,
                    codigo_produto TEXT,
                    descricao TEXT NOT NULL,
                    preco_unitario REAL NOT NULL,
                    quantidade REAL,
                    pedido_id INTEGER,
                    data_compra DATE NOT NULL,
                    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id),
                    FOREIGN KEY (pedido_id) REFERENCES pedidos_compra(id)
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela historico_precos:', err);
            });

            // Tabela de Histórico de Aprovações
            db.run(`
                CREATE TABLE IF NOT EXISTS historico_aprovacoes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id INTEGER NOT NULL,
                    usuario_id INTEGER NOT NULL,
                    acao TEXT NOT NULL CHECK(acao IN ('aprovado', 'rejeitado', 'solicitado')),
                    observacoes TEXT,
                    data_acao DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (pedido_id) REFERENCES pedidos_compra(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) console.error('Erro ao criar tabela historico_aprovacoes:', err);
                else {
                    console.log('✅ Todas as tabelas criadas com sucesso');
                    resolve();
                }
            });
        });
    });
}

/**
 * Executar query com promise
 */
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

/**
 * Executar insert/update/delete
 */
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

/**
 * Obter uma única linha
 */
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

/**
 * Fechar conexáo
 */
function close() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) reject(err);
                else {
                    console.log('📦 Conexáo com banco de dados fechada');
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    initDatabase,
    initMySQLPool,
    getDatabase,
    query,
    run,
    get,
    close,
    getDB: () => db,
    getMySQLPool: () => mysqlPool
};
