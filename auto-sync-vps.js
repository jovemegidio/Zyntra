/**
 * AUTO SYNC VPS - Sincronização Automática com Servidor
 * Monitora alterações nos arquivos e envia automaticamente para o VPS
 * 
 * Versão: 1.0.0
 * Data: 25/01/2026
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

// ==================== CONFIGURAÇÕES ====================
const CONFIG = {
    // Servidor VPS
    server: {
        host: '31.97.64.102',
        user: 'root',
        password: 'Aluforce@2026#Vps',
        remotePath: '/var/www/aluforce'
    },
    
    // Caminhos locais
    local: {
        basePath: process.cwd()
    },
    
    // Arquivos/pastas para ignorar
    ignore: [
        '**/node_modules/**',
        '**/backups/**',
        '**/.git/**',
        '**/logs/**',
        '**/*.log',
        '**/*.bak',
        '**/package-lock.json',
        '**/auto-sync-vps.js',
        '**/sync-config.json',
        '**/.env',
        '**/ecosystem*.config.js'
    ],
    
    // Extensões permitidas
    allowedExtensions: [
        '.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', 
        '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf',
        '.py', '.sh', '.bat', '.md', '.txt'
    ],
    
    // Delay antes de sincronizar (para evitar múltiplos uploads)
    debounceDelay: 1000, // ms
    
    // Mostrar notificações
    verbose: true
};

// ==================== VARIÁVEIS GLOBAIS ====================
let syncQueue = new Map();
let syncTimeout = null;
let stats = {
    uploaded: 0,
    failed: 0,
    startTime: new Date()
};

// ==================== FUNÇÕES UTILITÁRIAS ====================

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const icons = {
        info: '📁',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        sync: '🔄',
        watch: '👁️'
    };
    console.log(`[${timestamp}] ${icons[type] || '•'} ${message}`);
}

function getRelativePath(filePath) {
    return path.relative(CONFIG.local.basePath, filePath).replace(/\\/g, '/');
}

function getRemotePath(filePath) {
    const relativePath = getRelativePath(filePath);
    return `${CONFIG.server.remotePath}/${relativePath}`;
}

function shouldSync(filePath) {
    // Verificar extensão
    const ext = path.extname(filePath).toLowerCase();
    if (CONFIG.allowedExtensions.length > 0 && !CONFIG.allowedExtensions.includes(ext)) {
        return false;
    }
    
    // Verificar se é arquivo ignorado
    const relativePath = getRelativePath(filePath);
    for (const pattern of CONFIG.ignore) {
        const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
        if (regex.test(relativePath)) {
            return false;
        }
    }
    
    return true;
}

// ==================== SINCRONIZAÇÃO ====================

function uploadFile(localPath) {
    return new Promise((resolve, reject) => {
        const remotePath = getRemotePath(localPath);
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
        const relativePath = getRelativePath(localPath);
        
        // Criar diretório remoto se não existir
        const mkdirCmd = `echo y | "C:\\Program Files\\PuTTY\\plink.exe" -pw "${CONFIG.server.password}" ${CONFIG.server.user}@${CONFIG.server.host} "mkdir -p ${remoteDir}"`;
        
        exec(mkdirCmd, { windowsHide: true }, (mkdirErr) => {
            // Ignorar erro de mkdir (pode já existir)
            
            // Upload do arquivo
            const scpCmd = `"C:\\Program Files\\PuTTY\\pscp.exe" -pw "${CONFIG.server.password}" -q "${localPath}" ${CONFIG.server.user}@${CONFIG.server.host}:${remotePath}`;
            
            exec(scpCmd, { windowsHide: true }, (err, stdout, stderr) => {
                if (err) {
                    log(`Falha ao enviar: ${relativePath}`, 'error');
                    stats.failed++;
                    reject(err);
                } else {
                    log(`Sincronizado: ${relativePath}`, 'success');
                    stats.uploaded++;
                    resolve();
                }
            });
        });
    });
}

function deleteRemoteFile(localPath) {
    return new Promise((resolve, reject) => {
        const remotePath = getRemotePath(localPath);
        const relativePath = getRelativePath(localPath);
        
        const cmd = `echo y | "C:\\Program Files\\PuTTY\\plink.exe" -pw "${CONFIG.server.password}" ${CONFIG.server.user}@${CONFIG.server.host} "rm -f ${remotePath}"`;
        
        exec(cmd, { windowsHide: true }, (err) => {
            if (err) {
                log(`Falha ao deletar remoto: ${relativePath}`, 'warning');
                reject(err);
            } else {
                log(`Deletado do servidor: ${relativePath}`, 'success');
                resolve();
            }
        });
    });
}

async function processQueue() {
    if (syncQueue.size === 0) return;
    
    const items = Array.from(syncQueue.entries());
    syncQueue.clear();
    
    log(`Processando ${items.length} arquivo(s)...`, 'sync');
    
    for (const [filePath, action] of items) {
        try {
            if (action === 'upload') {
                await uploadFile(filePath);
            } else if (action === 'delete') {
                await deleteRemoteFile(filePath);
            }
        } catch (err) {
            // Erro já logado na função
        }
    }
    
    log(`Fila processada. Total enviados: ${stats.uploaded} | Falhas: ${stats.failed}`, 'info');
}

function queueSync(filePath, action = 'upload') {
    if (!shouldSync(filePath)) return;
    
    syncQueue.set(filePath, action);
    
    // Debounce para agrupar múltiplas alterações
    if (syncTimeout) {
        clearTimeout(syncTimeout);
    }
    
    syncTimeout = setTimeout(() => {
        processQueue();
    }, CONFIG.debounceDelay);
}

// ==================== WATCHER ====================

function startWatcher() {
    log('Iniciando monitoramento de arquivos...', 'watch');
    log(`Pasta: ${CONFIG.local.basePath}`, 'info');
    log(`Servidor: ${CONFIG.server.user}@${CONFIG.server.host}:${CONFIG.server.remotePath}`, 'info');
    
    const watcher = chokidar.watch(CONFIG.local.basePath, {
        ignored: CONFIG.ignore,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 500,
            pollInterval: 100
        }
    });
    
    watcher
        .on('add', filePath => {
            log(`Novo arquivo: ${getRelativePath(filePath)}`, 'info');
            queueSync(filePath, 'upload');
        })
        .on('change', filePath => {
            log(`Modificado: ${getRelativePath(filePath)}`, 'info');
            queueSync(filePath, 'upload');
        })
        .on('unlink', filePath => {
            log(`Removido: ${getRelativePath(filePath)}`, 'warning');
            queueSync(filePath, 'delete');
        })
        .on('error', error => {
            log(`Erro no watcher: ${error}`, 'error');
        })
        .on('ready', () => {
            console.log('');
            console.log('╔═══════════════════════════════════════════════════════════╗');
            console.log('║        🚀 AUTO SYNC VPS - ATIVO E MONITORANDO            ║');
            console.log('╠═══════════════════════════════════════════════════════════╣');
            console.log('║  Qualquer alteração será enviada automaticamente para:   ║');
            console.log(`║  📡 ${CONFIG.server.host}:${CONFIG.server.remotePath.padEnd(35)}║`);
            console.log('║                                                           ║');
            console.log('║  Funciona com Live Share! Alterações de guests também    ║');
            console.log('║  serão sincronizadas automaticamente.                    ║');
            console.log('║                                                           ║');
            console.log('║  Pressione Ctrl+C para parar.                            ║');
            console.log('╚═══════════════════════════════════════════════════════════╝');
            console.log('');
        });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('');
        log('Encerrando sincronização...', 'warning');
        log(`Estatísticas da sessão:`, 'info');
        log(`  - Arquivos enviados: ${stats.uploaded}`, 'info');
        log(`  - Falhas: ${stats.failed}`, 'info');
        log(`  - Tempo de execução: ${Math.round((new Date() - stats.startTime) / 1000 / 60)} minutos`, 'info');
        watcher.close();
        process.exit(0);
    });
}

// ==================== INICIALIZAÇÃO ====================

// Verificar se chokidar está instalado
try {
    require.resolve('chokidar');
} catch (e) {
    console.log('');
    console.log('⚠️  Dependência não encontrada: chokidar');
    console.log('');
    console.log('Execute o comando abaixo para instalar:');
    console.log('');
    console.log('  npm install chokidar');
    console.log('');
    process.exit(1);
}

// Iniciar
startWatcher();
