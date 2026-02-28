// config/database.js
// Configuração centralizada do banco de dados com retry logic e health checks

const mysql = require('mysql2/promise');

class DatabaseConnection {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this.reconnectInterval = null;
        this.config = {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'aluforce_vendas',
            port: parseInt(process.env.DB_PORT) || 3306,
            waitForConnections: true,
            connectionLimit: parseInt(process.env.DB_CONN_LIMIT) || 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000,
            connectTimeout: 10000,
            timezone: '+00:00'
        };
    }

    async initialize() {
        try {
            this.pool = mysql.createPool(this.config);
            
            // Test connection
            await this.pool.query('SELECT 1');
            this.isConnected = true;
            
            console.log(`✅ Database connected: ${this.config.database}@${this.config.host}:${this.config.port}`);
            
            // Setup connection monitoring
            this.setupHealthCheck();
            
            return this.pool;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            this.isConnected = false;
            
            // Setup retry mechanism
            this.setupReconnect();
            
            throw error;
        }
    }

    setupHealthCheck() {
        // Check connection health every 30 seconds
        setInterval(async () => {
            try {
                await this.pool.query('SELECT 1');
                if (!this.isConnected) {
                    console.log('✅ Database connection restored');
                    this.isConnected = true;
                }
            } catch (error) {
                if (this.isConnected) {
                    console.error('⚠️ Database connection lost');
                    this.isConnected = false;
                }
            }
        }, 30000);
    }

    setupReconnect() {
        if (this.reconnectInterval) return;
        
        console.log('⏱️ Will attempt to reconnect to database every 10 seconds...');
        
        this.reconnectInterval = setInterval(async () => {
            try {
                if (!this.pool) {
                    this.pool = mysql.createPool(this.config);
                }
                
                await this.pool.query('SELECT 1');
                this.isConnected = true;
                
                console.log('✅ Database reconnection successful');
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
                
                this.setupHealthCheck();
            } catch (error) {
                // Silent retry
            }
        }, 10000);
    }

    getPool() {
        return this.pool;
    }

    isAvailable() {
        return this.isConnected;
    }

    async close() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
        }
        
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            console.log('Database connection closed');
        }
    }
}

module.exports = new DatabaseConnection();
