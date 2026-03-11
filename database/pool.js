'use strict';

/**
 * Pool MySQL centralizado — ÚNICA FONTE de conexões do sistema.
 * Todos os módulos devem importar deste arquivo em vez de criar pools próprios.
 * 
 * Uso:
 *   const pool = require('../../database/pool');
 *   const [rows] = await pool.query('SELECT 1');
 */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

module.exports = pool;
