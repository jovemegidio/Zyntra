/**
 * ALUFORCE - Sincronização Automática com Servidor VPS
 * Monitora alterações e envia automaticamente para o servidor
 * 
 * Para executar: node sync-automatico.js
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
    SERVER: '31.97.64.102',
    USUARIO: 'root',
    SENHA: 'Aluforce@2026#Vps',
    REMOTE_DIR: '/var/www/aluforce',
    LOCAL_DIR: __dirname,
    PUTTY_PATH: 'C:\\Program Files\\PuTTY',
    
    // Pastas para monitorar
    WATCH_FOLDERS: [
        'modules',
        'public',
        'js',
        'routes',
        'api',
        'services',
        'middleware',
        'templates',
        'css'
    ],
    
    // Extensões para monitorar
    WATCH_EXTENSIONS: ['.js', '.html', '.css', '.json', '.ejs'],
    
    // Arquivos/pastas para ignorar
    IGNORE_PATTERNS: [
        'node_modules',
        '.git',
        '*.log',
        '*.bak',
        'package-lock.json'
    ],
    
    // Delay para agrupar múltiplas alterações (ms)
    DEBOUNCE_DELAY: 1000
};

// ============================================
// VARIÁVEIS DE CONTROLE
// ============================================
let pendingFiles = new Set();
let debounceTimer = null;
let isUploading = false;
let uploadQueue = [];

// Cores para console
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

function logSuccess(message) { log('✓ ' + message, 'green'); }
function logInfo(message) { log('→ ' + message, 'blue'); }
function logWarning(message) { log('⚠ ' + message, 'yellow'); }
function logError(message) { log('✗ ' + message, 'red'); }

// ============================================
// FUNÇÕES DE UPLOAD
// ============================================
function shouldIgnore(filePath) {
    const relativePath = path.relative(CONFIG.LOCAL_DIR, filePath);
    
    for (const pattern of CONFIG.IGNORE_PATTERNS) {
        if (pattern.startsWith('*')) {
            const ext = pattern.substring(1);
            if (filePath.endsWith(ext)) return true;
        } else if (relativePath.includes(pattern)) {
            return true;
        }
    }
    
    // Verificar extensão
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !CONFIG.WATCH_EXTENSIONS.includes(ext)) {
        return true;
    }
    
    return false;
}

function getRemotePath(localPath) {
    const relativePath = path.relative(CONFIG.LOCAL_DIR, localPath);
    return CONFIG.REMOTE_DIR + '/' + relativePath.replace(/\\/g, '/');
}

function uploadFile(localPath) {
    return new Promise((resolve, reject) => {
        const remotePath = getRemotePath(localPath);
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
        
        // Comando para criar diretório remoto se não existir e enviar arquivo
        const pscpPath = path.join(CONFIG.PUTTY_PATH, 'pscp.exe');
        const plinkPath = path.join(CONFIG.PUTTY_PATH, 'plink.exe');
        
        // Primeiro, garantir que o diretório existe
        const mkdirCmd = `echo y | "${plinkPath}" -pw "${CONFIG.SENHA}" ${CONFIG.USUARIO}@${CONFIG.SERVER} "mkdir -p ${remoteDir}" 2>nul`;
        
        exec(mkdirCmd, { shell: true }, (err) => {
            // Ignorar erro do mkdir (pode já existir)
            
            // Agora enviar o arquivo
            const uploadCmd = `"${pscpPath}" -pw "${CONFIG.SENHA}" -q "${localPath}" ${CONFIG.USUARIO}@${CONFIG.SERVER}:${remotePath}`;
            
            exec(uploadCmd, { shell: true }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(`Erro ao enviar ${path.basename(localPath)}: ${stderr}`));
                } else {
                    resolve(remotePath);
                }
            });
        });
    });
}

async function processUploadQueue() {
    if (isUploading || pendingFiles.size === 0) return;
    
    isUploading = true;
    const files = Array.from(pendingFiles);
    pendingFiles.clear();
    
    console.log('');
    log('═══════════════════════════════════════════════════', 'cyan');
    logInfo(`Sincronizando ${files.length} arquivo(s)...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const filePath of files) {
        try {
            const relativePath = path.relative(CONFIG.LOCAL_DIR, filePath);
            const remotePath = await uploadFile(filePath);
            logSuccess(`${relativePath}`);
            successCount++;
        } catch (error) {
            logError(error.message);
            errorCount++;
        }
    }
    
    log('───────────────────────────────────────────────────', 'cyan');
    if (errorCount === 0) {
        logSuccess(`${successCount} arquivo(s) sincronizado(s) com sucesso!`);
    } else {
        logWarning(`${successCount} sucesso, ${errorCount} erro(s)`);
    }
    log('═══════════════════════════════════════════════════', 'cyan');
    console.log('');
    
    isUploading = false;
    
    // Verificar se há mais arquivos na fila
    if (pendingFiles.size > 0) {
        processUploadQueue();
    }
}

function queueFile(filePath) {
    if (shouldIgnore(filePath)) return;
    
    // Verificar se o arquivo existe (pode ter sido deletado)
    if (!fs.existsSync(filePath)) return;
    
    pendingFiles.add(filePath);
    
    // Debounce para agrupar múltiplas alterações
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    
    debounceTimer = setTimeout(() => {
        processUploadQueue();
    }, CONFIG.DEBOUNCE_DELAY);
}

// ============================================
// WATCHER
// ============================================
function watchFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        logWarning(`Pasta não encontrada: ${folderPath}`);
        return;
    }
    
    const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        
        const fullPath = path.join(folderPath, filename);
        
        if (eventType === 'change' || eventType === 'rename') {
            // Pequeno delay para garantir que o arquivo foi salvo completamente
            setTimeout(() => {
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                    const relativePath = path.relative(CONFIG.LOCAL_DIR, fullPath);
                    logInfo(`Alteração detectada: ${relativePath}`);
                    queueFile(fullPath);
                }
            }, 100);
        }
    });
    
    watcher.on('error', (error) => {
        logError(`Erro no watcher: ${error.message}`);
    });
    
    return watcher;
}

// ============================================
// INICIALIZAÇÃO
// ============================================
function showBanner() {
    console.clear();
    console.log(colors.cyan);
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     ALUFORCE - SINCRONIZAÇÃO AUTOMÁTICA EM TEMPO REAL     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(colors.reset);
    console.log('');
    logInfo(`Servidor: ${CONFIG.USUARIO}@${CONFIG.SERVER}`);
    logInfo(`Destino:  ${CONFIG.REMOTE_DIR}`);
    logInfo(`Origem:   ${CONFIG.LOCAL_DIR}`);
    console.log('');
    log('Monitorando pastas:', 'yellow');
    CONFIG.WATCH_FOLDERS.forEach(folder => {
        console.log(`   📁 ${folder}`);
    });
    console.log('');
    log('Pressione Ctrl+C para parar', 'yellow');
    console.log('');
    log('═══════════════════════════════════════════════════', 'green');
    logSuccess('Sincronização automática ATIVA!');
    log('═══════════════════════════════════════════════════', 'green');
    console.log('');
    logInfo('Aguardando alterações...');
    console.log('');
}

async function testConnection() {
    return new Promise((resolve) => {
        const plinkPath = path.join(CONFIG.PUTTY_PATH, 'plink.exe');
        const testCmd = `echo y | "${plinkPath}" -pw "${CONFIG.SENHA}" ${CONFIG.USUARIO}@${CONFIG.SERVER} "echo OK" 2>nul`;
        
        exec(testCmd, { shell: true, timeout: 10000 }, (err, stdout) => {
            resolve(stdout.includes('OK'));
        });
    });
}

async function main() {
    showBanner();
    
    // Testar conexão
    logInfo('Testando conexão com o servidor...');
    const connected = await testConnection();
    
    if (!connected) {
        logError('Não foi possível conectar ao servidor!');
        logWarning('Verifique se o PuTTY está instalado e as credenciais estão corretas.');
        process.exit(1);
    }
    
    logSuccess('Conexão com servidor OK!');
    console.log('');
    
    // Iniciar watchers
    const watchers = [];
    
    for (const folder of CONFIG.WATCH_FOLDERS) {
        const folderPath = path.join(CONFIG.LOCAL_DIR, folder);
        const watcher = watchFolder(folderPath);
        if (watcher) {
            watchers.push(watcher);
            logSuccess(`Monitorando: ${folder}`);
        }
    }
    
    // Também monitorar arquivos na raiz (server.js, etc)
    const rootWatcher = fs.watch(CONFIG.LOCAL_DIR, (eventType, filename) => {
        if (!filename) return;
        
        const fullPath = path.join(CONFIG.LOCAL_DIR, filename);
        const ext = path.extname(filename).toLowerCase();
        
        // Apenas arquivos com extensões monitoradas
        if (CONFIG.WATCH_EXTENSIONS.includes(ext)) {
            setTimeout(() => {
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                    logInfo(`Alteração detectada: ${filename}`);
                    queueFile(fullPath);
                }
            }, 100);
        }
    });
    
    watchers.push(rootWatcher);
    logSuccess('Monitorando: arquivos raiz (.js, .html, etc)');
    
    console.log('');
    log('───────────────────────────────────────────────────', 'cyan');
    logSuccess('Sistema pronto! Alterações serão enviadas automaticamente.');
    log('───────────────────────────────────────────────────', 'cyan');
    console.log('');
    
    // Tratamento de encerramento
    process.on('SIGINT', () => {
        console.log('');
        logWarning('Encerrando sincronização...');
        watchers.forEach(w => w.close());
        process.exit(0);
    });
}

main().catch(error => {
    logError(`Erro fatal: ${error.message}`);
    process.exit(1);
});
