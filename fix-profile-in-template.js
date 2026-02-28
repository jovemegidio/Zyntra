const fs = require('fs');

const files = [
    '/var/www/aluforce/modules/Vendas/public/pedidos.html',
    '/var/www/aluforce/modules/Vendas/public/index.html',
    '/var/www/aluforce/modules/Vendas/public/index_utf8.html'
];

let fixed = 0;
for (const f of files) {
    let c = fs.readFileSync(f, 'utf8');
    const before = c.length;
    
    // The injected line pattern - it's a standalone <script> tag on its own line
    // that appears INSIDE a template literal (between <\/scr`+`ipt> and </body>)
    // It might have LF only (no CR) while rest of file is CRLF
    
    // Pattern 1: LF-only line inside CRLF file
    c = c.replace(/\n<script src="\/_shared\/user-profile-loader\.js"><\/script>\n/g, '\n');
    
    // Pattern 2: CRLF line  
    c = c.replace(/\r\n<script src="\/_shared\/user-profile-loader\.js"><\/script>\r?\n/g, '\r\n');
    
    const after = c.length;
    if (before !== after) {
        fs.writeFileSync(f, c, 'utf8');
        fixed++;
        console.log('Fixed: ' + f + ' (removed ' + (before - after) + ' bytes)');
    } else {
        console.log('No change: ' + f);
    }
}

// Verify pedidos.html is now clean
const pedidos = fs.readFileSync(files[0], 'utf8');
const lines = pedidos.split('\n');
console.log('\nPedidos.html verification:');
console.log('  Total lines: ' + lines.length);
console.log('  Has profile-loader in template: ' + pedidos.includes('<script src="/_shared/user-profile-loader.js"></script>\n</body>'));

// Check line ~3256 area
for (let i = 3248; i < 3260 && i < lines.length; i++) {
    console.log('  L' + (i+1) + ': ' + lines[i].trim().substring(0, 80));
}

console.log('\nTotal fixed: ' + fixed);
