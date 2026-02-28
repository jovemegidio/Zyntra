/**
 * ALUFORCE Service Manager
 * Gerenciador de serviço com sincronização de banco de dados em tempo real
 * 
 * Este script:
 * 1. Inicia o servidor principal
 * 2. Sincroniza Railway (principal) com banco Local (backup) em tempo real
 * 3. Monitora conexões e reinicia automaticamente se necessário
 */

require('dotenv').config();
const { spawn, exec } = require('child_process');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
    // Intervalo de sincronização (em milissegundos)
    SYNC_INTERVAL: 30000, // 30 segundos
    
    // Banco Railway (Principal)
    railway: {
        host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
        port: parseInt(process.env.DB_PORT) || 19396,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
        database: process.env.DB_NAME || 'railway',
        connectTimeout: 30000,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0
    },
    
    // Banco Local (Backup)
    local: {
        host: '127.0.0.1',
        port: 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD, // SEGURANÇA: Credencial via env var
        database: 'aluforce_backup',
        connectTimeout: 30000,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0
    },
    
    // Tabelas críticas para sincronização em tempo real
    tabelasCriticas: [
        'usuarios',
        'pedidos',
        'pedido_itens',
        'contas_pagar',
        'contas_receber',
        'movimentacoes_estoque',
        'funcionarios',
        'folha_pagamento'
    ],
    
    // Todas as tabelas para sync completo
    todasTabelas: [
        'usuarios',
        'empresas',
        'clientes',
        'fornecedores',
        'transportadoras',
        'produtos',
        'pedidos',
        'pedido_itens',
        'contas_pagar',
        'contas_receber',
        'contas_bancarias',
        'categorias_financeiras',
        'movimentacoes_estoque',
        'nfe_emitidas',
        'funcionarios',
        'departamentos',
        'cargos',
        'folha_pagamento',
        'notificacoes',
        'auditoria',
        'materiais',
        'ordens_producao',
        'pedidos_compra',
        'requisicoes_compra',
        'cotacoes_compra'
    ]
};

// ============================================
// VARIÁVEIS GLOBAIS
// ============================================
let railwayPool = null;
let localPool = null;
let serverProcess = null;
let syncRunning = false;
let lastSyncTime = null;
let syncErrors = [];

// ============================================
// LOGGER
// ============================================
const log = {
    info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${new Date().toLocaleTimeString()} - ${msg}`),
    success: (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${new Date().toLocaleTimeString()} - ${msg}`),
    warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${new Date().toLocaleTimeString()} - ${msg}`),
    error: (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${new Date().toLocaleTimeString()} - ${msg}`),
    sync: (msg) => console.log(`\x1b[35m[SYNC]\x1b[0m ${new Date().toLocaleTimeString()} - ${msg}`)
};

// ============================================
// CONEXÕES DE BANCO
// ============================================
async function conectarRailway() {
    try {
        if (railwayPool) {
            await railwayPool.end();
        }
        
        railwayPool = mysql.createPool(CONFIG.railway);
        
        // Testar conexão
        const conn = await railwayPool.getConnection();
        await conn.ping();
        conn.release();
        
        log.success('Conectado ao Railway (Principal)');
        return true;
    } catch (error) {
        log.error(`Falha ao conectar Railway: ${error.message}`);
        return false;
    }
}

async function conectarLocal() {
    try {
        if (localPool) {
            await localPool.end();
        }
        
        // Primeiro, criar o banco se não existir
        const tempConn = await mysql.createConnection({
            host: CONFIG.local.host,
            port: CONFIG.local.port,
            user: CONFIG.local.user,
            password: CONFIG.local.password
        });
        
        await tempConn.query(`CREATE DATABASE IF NOT EXISTS ${CONFIG.local.database}`);
        await tempConn.end();
        
        localPool = mysql.createPool(CONFIG.local);
        
        // Testar conexão
        const conn = await localPool.getConnection();
        await conn.ping();
        conn.release();
        
        log.success('Conectado ao Banco Local (Backup)');
        return true;
    } catch (error) {
        log.warn(`Banco Local não disponível: ${error.message}`);
        log.warn('A sincronização local está desabilitada. O sistema continuará apenas com Railway.');
        return false;
    }
}

// ============================================
// SINCRONIZAÇÍO EM TEMPO REAL
// ============================================
async function sincronizarTabela(tabela) {
    if (!railwayPool || !localPool) return false;
    
    try {
        // Verificar se tabela existe no Railway
        const [existsRailway] = await railwayPool.query(`SHOW TABLES LIKE '${tabela}'`);
        if (existsRailway.length === 0) {
            return 0; // Tabela não existe
        }
        
        // Obter estrutura do Railway
        const [createStmt] = await railwayPool.query(`SHOW CREATE TABLE ${tabela}`);
        const createSQL = createStmt[0]['Create Table'];
        
        // Obter dados do Railway
        const [railwayData] = await railwayPool.query(`SELECT * FROM ${tabela}`);
        
        // Recriar tabela no local com mesma estrutura
        await localPool.query(`SET FOREIGN_KEY_CHECKS = 0`);
        await localPool.query(`DROP TABLE IF EXISTS ${tabela}`);
        await localPool.query(createSQL);
        
        // Inserir dados
        if (railwayData.length > 0) {
            const colunas = Object.keys(railwayData[0]);
            const placeholders = colunas.map(() => '?').join(', ');
            const insertSQL = `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${placeholders})`;
            
            for (const row of railwayData) {
                try {
                    const valores = colunas.map(col => row[col]);
                    await localPool.query(insertSQL, valores);
                } catch (insertErr) {
                    // Ignorar erros de inserção individual
                }
            }
        }
        
        await localPool.query(`SET FOREIGN_KEY_CHECKS = 1`);
        
        return railwayData.length;
    } catch (error) {
        // Log silencioso para não poluir console
        if (!error.message.includes("doesn't exist")) {
            log.error(`Erro ao sincronizar ${tabela}: ${error.message}`);
        }
        return false;
    }
}

async function sincronizacaoCompleta() {
    if (syncRunning) {
        log.warn('Sincronização já em andamento, pulando...');
        return;
    }
    
    if (!localPool) {
        return; // Banco local não disponível
    }
    
    syncRunning = true;
    const inicio = Date.now();
    let tabelasSincronizadas = 0;
    let registrosTotais = 0;
    
    log.sync('Iniciando sincronização completa...');
    
    try {
        for (const tabela of CONFIG.todasTabelas) {
            const registros = await sincronizarTabela(tabela);
            if (registros !== false) {
                tabelasSincronizadas++;
                registrosTotais += registros;
            }
        }
        
        const duracao = ((Date.now() - inicio) / 1000).toFixed(2);
        lastSyncTime = new Date();
        
        log.success(`Sincronização completa: ${tabelasSincronizadas} tabelas, ${registrosTotais} registros em ${duracao}s`);
        
        // Salvar log de sincronização
        await salvarLogSync(tabelasSincronizadas, registrosTotais, duracao);
        
    } catch (error) {
        log.error(`Erro na sincronização: ${error.message}`);
        syncErrors.push({ time: new Date(), error: error.message });
    } finally {
        syncRunning = false;
    }
}

async function sincronizacaoRapida() {
    if (syncRunning || !localPool) return;
    
    syncRunning = true;
    
    try {
        for (const tabela of CONFIG.tabelasCriticas) {
            await sincronizarTabela(tabela);
        }
        lastSyncTime = new Date();
    } catch (error) {
        log.error(`Erro na sincronização rápida: ${error.message}`);
    } finally {
        syncRunning = false;
    }
}

async function salvarLogSync(tabelas, registros, duracao) {
    try {
        const logPath = path.join(__dirname, 'logs', 'sync.log');
        const logDir = path.dirname(logPath);
        
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logEntry = `[${new Date().toISOString()}] Sync: ${tabelas} tabelas, ${registros} registros, ${duracao}s\n`;
        fs.appendFileSync(logPath, logEntry);
    } catch (e) {
        // Ignorar erros de log
    }
}

// ============================================
// INICIAR SERVIDOR PRINCIPAL
// ============================================
function iniciarServidor() {
    log.info('Iniciando servidor ALUFORCE...');
    
    const serverPath = path.join(__dirname, 'server.js');
    
    serverProcess = spawn('node', [serverPath], {
        cwd: __dirname,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env }
    });
    
    serverProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
    });
    
    serverProcess.stderr.on('data', (data) => {
        process.stderr.write(data);
    });
    
    serverProcess.on('close', (code) => {
        log.warn(`Servidor encerrado com código ${code}`);
        
        // Reiniciar automaticamente após 5 segundos se não foi encerrado manualmente
        if (code !== 0) {
            log.info('Reiniciando servidor em 5 segundos...');
            setTimeout(() => {
                iniciarServidor();
            }, 5000);
        }
    });
    
    serverProcess.on('error', (error) => {
        log.error(`Erro no servidor: ${error.message}`);
    });
    
    log.success('Servidor iniciado com PID: ' + serverProcess.pid);
}

// ============================================
// API DE STATUS (via arquivo)
// ============================================
function atualizarStatus() {
    const status = {
        servidor: serverProcess ? 'online' : 'offline',
        pid: serverProcess?.pid || null,
        railwayConectado: !!railwayPool,
        localConectado: !!localPool,
        ultimaSync: lastSyncTime?.toISOString() || null,
        errosSync: syncErrors.slice(-5),
        uptime: process.uptime()
    };
    
    try {
        fs.writeFileSync(
            path.join(__dirname, 'logs', 'service-status.json'),
            JSON.stringify(status, null, 2)
        );
    } catch (e) {
        // Ignorar
    }
}

// ============================================
// MAIN
// ============================================
async function main() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║         ALUFORCE SERVICE MANAGER v2.0                        ║');
    console.log('║         Servidor + Sincronização em Tempo Real               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n');
    
    // 1. Conectar ao Railway (obrigatório)
    const railwayOk = await conectarRailway();
    if (!railwayOk) {
        log.error('Não foi possível conectar ao Railway. Verifique a conexão.');
        process.exit(1);
    }
    
    // 2. Conectar ao banco local (opcional)
    const localOk = await conectarLocal();
    
    // 3. Iniciar servidor principal
    iniciarServidor();
    
    // 4. Se banco local disponível, iniciar sincronização
    if (localOk) {
        // Sincronização inicial completa
        log.sync('Executando sincronização inicial...');
        await sincronizacaoCompleta();
        
        // Sincronização periódica
        setInterval(async () => {
            await sincronizacaoRapida();
        }, CONFIG.SYNC_INTERVAL);
        
        // Sincronização completa a cada 5 minutos
        setInterval(async () => {
            await sincronizacaoCompleta();
        }, 300000);
        
        log.info(`Sincronização configurada: rápida a cada ${CONFIG.SYNC_INTERVAL/1000}s, completa a cada 5min`);
    }
    
    // 5. Atualizar status periodicamente
    setInterval(atualizarStatus, 10000);
    
    // 6. Handlers de encerramento
    process.on('SIGINT', async () => {
        log.warn('Encerrando serviço...');
        
        if (serverProcess) {
            serverProcess.kill();
        }
        
        if (railwayPool) {
            await railwayPool.end();
        }
        
        if (localPool) {
            await localPool.end();
        }
        
        process.exit(0);
    });
    
    log.success('ALUFORCE Service Manager iniciado com sucesso!');
    log.info('Multi-dispositivos: ATIVO (sessões não são bloqueadas por dispositivo)');
    log.info('Pressione Ctrl+C para encerrar');
}

// Executar
main().catch(err => {
    log.error(`Erro fatal: ${err.message}`);
    process.exit(1);
});
