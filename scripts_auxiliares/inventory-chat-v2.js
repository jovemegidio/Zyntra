const fs = require('fs');
const path = require('path');

const base = 'g:/.shortcut-targets-by-id/1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN/Sistema - ALUFORCE - V.2';
const outFile = path.join(base, 'scripts_auxiliares', 'chat-inv-result.txt');
const lines = [];

function log(msg) { lines.push(msg); }

try {
    const excludePatterns = ['node_modules','_backup','_backups','backups','.git','android','Login-Page','Zyntra','chat/public','chat\\public','emails-sge','templates/','ajuda/','dashboard-modern','build/','importar-ponto_backup','importar-ponto_new'];
    
    function shouldExclude(relPath) {
        const r = relPath.replace(/\\/g,'/');
        return excludePatterns.some(p => r.includes(p));
    }
    
    function walk(dir, depth) {
        let results = [];
        if (depth > 6) return results;
        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                if (item.startsWith('_') && dir === base) continue;
                if (item === 'desktop.ini') continue;
                const full = path.join(dir, item);
                const rel = path.relative(base, full);
                if (shouldExclude(rel)) continue;
                try {
                    const stat = fs.statSync(full);
                    if (stat.isDirectory()) results = results.concat(walk(full, depth+1));
                    else if (item.endsWith('.html')) results.push(full);
                } catch(e) {}
            }
        } catch(e) { log('ERR walk: ' + e.message); }
        return results;
    }
    
    log('Starting walk from: ' + base);
    log('Exists: ' + fs.existsSync(base));
    
    const all = walk(base, 0);
    log('Found: ' + all.length + ' HTML files');
    
    const withChat = [];
    const withoutChat = [];
    
    for (const f of all) {
        try {
            const c = fs.readFileSync(f, 'utf8');
            if (c.includes('widget.js')) withChat.push(f);
            else withoutChat.push(f);
        } catch(e) { log('ERR read: ' + f + ' ' + e.message); }
    }
    
    log('');
    log('Total: ' + all.length + ' | Com Chat: ' + withChat.length + ' | Sem Chat: ' + withoutChat.length);
    log('');
    log('=== COM Chat ===');
    withChat.forEach(f => log('  ' + path.relative(base, f).replace(/\\/g, '/')));
    log('');
    log('=== SEM Chat ===');
    withoutChat.forEach(f => log('  ' + path.relative(base, f).replace(/\\/g, '/')));
    
} catch(e) {
    log('FATAL: ' + e.message + '\n' + e.stack);
}

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
