/**
 * Atualiza versão do cache-bust dos arquivos que já tinham chat widget
 * De v=20260214 para v=20260218
 */
const fs = require('fs');
const path = require('path');

const base = 'g:/.shortcut-targets-by-id/1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN/Sistema - ALUFORCE - V.2';

const files = [
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

let updated = 0;
for (const rel of files) {
    const f = path.join(base, rel);
    try {
        let c = fs.readFileSync(f, 'utf8');
        if (c.includes('v=20260214')) {
            c = c.replace(/widget\.css\?v=\d+/g, 'widget.css?v=20260218');
            c = c.replace(/widget\.js\?v=\d+/g, 'widget.js?v=20260218');
            fs.writeFileSync(f, c, 'utf8');
            updated++;
            console.log('UPDATED: ' + rel);
        } else {
            console.log('SKIP (already current): ' + rel);
        }
    } catch(e) {
        console.log('ERROR: ' + rel + ' - ' + e.message);
    }
}
console.log('\nUpdated: ' + updated + ' of ' + files.length);
