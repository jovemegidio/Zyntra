/**
 * Deploy de TODOS os HTMLs com Chat Widget para VPS
 * Inclui os 102 recém-injetados + 10 que já tinham (versão atualizada)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = 'g:/.shortcut-targets-by-id/1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN/Sistema - ALUFORCE - V.2';
const vps = 'root@31.97.64.102';
const vpsBase = '/var/www/aluforce';
const outFile = path.join(base, 'scripts_auxiliares', 'deploy-chat-result.txt');
const lines = [];
function log(msg) { lines.push(msg); }

// Read deploy list (102 injected)
const deployList = fs.readFileSync(path.join(base, 'scripts_auxiliares', 'chat-deploy-list.txt'), 'utf8')
    .trim().split('\n').filter(Boolean);

// Add the 10 that already had chat (version updated)
const alreadyHadChat = [
    'modules/RH/index.html',
    'modules/Vendas/public/index.html',
    'modules/NFe/index.html',
    'modules/NFe/emitir.html',
    'modules/PCP/index.html',
    'modules/Financeiro/public/index.html',
    'modules/Compras/public/index.html',
    'modules/Compras/index.html',
    'public/index.html',
    'dashboard-emergent-index.html',
];

const allFiles = [...new Set([...deployList, ...alreadyHadChat])];
log('Total files to deploy: ' + allFiles.length);

let ok = 0, fail = 0;

for (const rel of allFiles) {
    const localPath = path.join(base, rel).replace(/\//g, '\\');
    const remotePath = `${vps}:${vpsBase}/${rel}`;
    
    try {
        execSync(`scp -o StrictHostKeyChecking=no "${localPath}" "${remotePath}"`, {
            timeout: 30000,
            stdio: 'pipe'
        });
        ok++;
        if (ok % 10 === 0) log(`Progress: ${ok}/${allFiles.length}`);
    } catch(e) {
        fail++;
        log(`FAIL: ${rel} - ${e.message.substring(0, 80)}`);
    }
}

log('');
log('=== DEPLOY CONCLUIDO ===');
log(`OK: ${ok} | FAIL: ${fail} | Total: ${allFiles.length}`);

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log(`OK: ${ok} | FAIL: ${fail} | Total: ${allFiles.length}`);
