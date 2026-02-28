/**
 * Inventário de todos os HTMLs do sistema ALUFORCE
 * Verifica quais já possuem o Chat Widget BOB AI
 */
const fs = require('fs');
const path = require('path');
const base = path.resolve('g:/.shortcut-targets-by-id/1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN/Sistema - ALUFORCE - V.2');

const excludePatterns = [
    'node_modules', '_backup', '_backups', 'backups',
    '.git', 'android', 'Login-Page', 'Zyntra',
    'chat/public', 'chat\\public',
    'emails-sge', 'templates', 'ajuda',
    'dashboard-modern', 'build',
    'importar-ponto_backup', 'importar-ponto_new',
    'desktop.ini'
];

function shouldExclude(relPath) {
    return excludePatterns.some(p => relPath.includes(p));
}

function walk(dir) {
    let results = [];
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            if (item.startsWith('_') && dir === base) continue;
            const full = path.join(dir, item);
            const rel = path.relative(base, full).replace(/\\/g, '/');
            if (shouldExclude(rel)) continue;
            try {
                const stat = fs.statSync(full);
                if (stat.isDirectory()) results = results.concat(walk(full));
                else if (item.endsWith('.html')) results.push(full);
            } catch(e) {}
        }
    } catch(e) {}
    return results;
}

const all = walk(base);
const withChat = [];
const withoutChat = [];

for (const f of all) {
    const c = fs.readFileSync(f, 'utf8');
    if (c.includes('widget.js')) withChat.push(f);
    else withoutChat.push(f);
}

console.log(`Total: ${all.length} | Com Chat: ${withChat.length} | Sem Chat: ${withoutChat.length}`);
console.log('');
console.log('=== COM Chat ===');
withChat.forEach(f => console.log('  ' + path.relative(base, f).replace(/\\/g, '/')));
console.log('');
console.log('=== SEM Chat ===');
withoutChat.forEach(f => console.log('  ' + path.relative(base, f).replace(/\\/g, '/')));
