const chokidar = require('chokidar');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURAÇÕES DO SERVIDOR
// ============================================
const CONFIG = {
    server: '31.97.64.102',
    usuario: 'root',
    senha: 'Aluforce@2026#Vps',
    remoteDir: '/var/www/aluforce',
    localDir: '/home/derick/GoogleDrive/Outros/Sistema - ALUFORCE - V.2',
    pscpPath: 'scp',
    plinkPath: 'ssh',
    useSshpass: true
};

// Pastas e arquivos a monitorar
const WATCH_PATHS = [
    'server.js',
    'modules/**/*',
    'public/**/*',
    'js/**/*',
    'routes/**/*',
    'api/**/*',
    'config/**/*',
    'middleware/**/*'
];

// Ignorar arquivos temporários e caches
const IGNORE_PATTERNS = [
    '**/*.tmp',
    '**/*.log',
    '**/node_modules/**',
    '**/.git/**',
    '**/uploads/**',
    '**/temp/**',
    '**/*.swp',
    '**/*~'
];

let syncQueue = new Set();
let syncTimer = null;
let issyncing = false;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   ALUFORCE - SINCRONIZAÇÃO EM TEMPO REAL COM VPS         ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');
console.log(`📂 Monitorando: ${CONFIG.localDir}`);
console.log(`🌐 Servidor: ${CONFIG.usuario}@${CONFIG.server}`);
console.log(`📍 Destino: ${CONFIG.remoteDir}\n`);
console.log('⏳ Inicializando monitoramento...\n');

// Função para enviar arquivo para o servidor
function sendFile(relativePath) {
    return new Promise((resolve, reject) => {
        const localPath = path.join(CONFIG.localDir, relativePath);
        const remotePath = `${CONFIG.remoteDir}/${relativePath.replace(/\\/g, '/')}`;
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
        
        // Criar diretório remoto se não existir
        const mkdirCmd = `${CONFIG.useSshpass ? `sshpass -p '${CONFIG.senha}' ` : ''}${CONFIG.plinkPath} -o StrictHostKeyChecking=no ${CONFIG.usuario}@${CONFIG.server} "mkdir -p ${remoteDir}"`;
        
        exec(mkdirCmd, (err) => {
            if (err) {
                console.error(`❌ Erro ao criar diretório: ${remoteDir}`);
                return reject(err);
            }
            
            // Enviar arquivo
            const pscpCmd = `${CONFIG.useSshpass ? `sshpass -p '${CONFIG.senha}' ` : ''}${CONFIG.pscpPath} -o StrictHostKeyChecking=no "${localPath}" ${CONFIG.usuario}@${CONFIG.server}:"${remotePath}"`;
            
            exec(pscpCmd, (err, stdout, stderr) => {
                if (err) {
                    console.error(`❌ Erro ao enviar ${relativePath}: ${err.message}`);
                    return reject(err);
                }
                resolve();
            });
        });
    });
}

// Função para sincronizar arquivos em lote
async function syncFiles() {
    if (issyncing || syncQueue.size === 0) return;
    
    issyncing = true;
    const files = Array.from(syncQueue);
    syncQueue.clear();
    
    console.log(`\n🔄 Sincronizando ${files.length} arquivo(s)...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const file of files) {
        try {
            await sendFile(file);
            console.log(`✅ ${file}`);
            successCount++;
        } catch (error) {
            console.error(`❌ ${file}`);
            errorCount++;
        }
    }
    
    console.log(`\n📊 Resultado: ${successCount} enviado(s), ${errorCount} erro(s)`);
    
    // Verificar se precisa reiniciar o servidor
    const needsRestart = files.some(f => 
        f === 'server.js' || 
        f.startsWith('routes/') || 
        f.startsWith('api/') || 
        f.startsWith('modules/') ||
        f.startsWith('middleware/')
    );
    
    if (needsRestart) {
        console.log('\n🔄 Reiniciando servidor...');
        const restartCmd = `${CONFIG.useSshpass ? `sshpass -p '${CONFIG.senha}' ` : ''}${CONFIG.plinkPath} -o StrictHostKeyChecking=no ${CONFIG.usuario}@${CONFIG.server} "pm2 restart aluforce-vendas || pm2 restart aluforce"`;
        
        exec(restartCmd, (err, stdout) => {
            if (err) {
                console.error('❌ Erro ao reiniciar servidor:', err.message);
            } else {
                console.log('✅ Servidor reiniciado com sucesso!');
            }
            issyncing = false;
        });
    } else {
        issyncing = false;
    }
    
    console.log('\n👀 Monitorando alterações...\n');
}

// Função para adicionar arquivo à fila de sincronização
function queueSync(relativePath) {
    syncQueue.add(relativePath);
    
    // Debounce: espera 2 segundos antes de sincronizar
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncFiles();
    }, 2000);
}

// Inicializar watcher
const watcher = chokidar.watch(WATCH_PATHS, {
    cwd: CONFIG.localDir,
    persistent: true,
    ignoreInitial: true,
    ignored: IGNORE_PATTERNS,
    awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
    }
});

// Eventos do watcher
watcher
    .on('ready', () => {
        console.log('✅ Monitoramento ativo!\n');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log('💡 Dica: Salve qualquer arquivo e ele será enviado automaticamente!\n');
    })
    .on('add', filePath => {
        console.log(`📝 Novo arquivo detectado: ${filePath}`);
        queueSync(filePath);
    })
    .on('change', filePath => {
        console.log(`📝 Arquivo modificado: ${filePath}`);
        queueSync(filePath);
    })
    .on('unlink', filePath => {
        console.log(`🗑️  Arquivo removido: ${filePath}`);
        // Enviar comando para remover no servidor
        const remotePath = `${CONFIG.remoteDir}/${filePath.replace(/\\/g, '/')}`;
        const removeCmd = `${CONFIG.useSshpass ? `sshpass -p '${CONFIG.senha}' ` : ''}${CONFIG.plinkPath} -o StrictHostKeyChecking=no ${CONFIG.usuario}@${CONFIG.server} "rm -f ${remotePath}"`;
        
        exec(removeCmd, (err) => {
            if (err) {
                console.error(`❌ Erro ao remover ${filePath} do servidor`);
            } else {
                console.log(`✅ ${filePath} removido do servidor`);
            }
        });
    })
    .on('error', error => {
        console.error('❌ Erro no monitoramento:', error);
    });

// Tratamento de erros
process.on('SIGINT', () => {
    console.log('\n\n🛑 Encerrando sincronização...');
    watcher.close();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não tratado:', error);
});
