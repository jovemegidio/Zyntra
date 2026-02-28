const fs = require('fs');

const files = [
    '/var/www/aluforce/modules/Vendas/public/index.html',
    '/var/www/aluforce/modules/Vendas/public/index_utf8.html'
];

for (const f of files) {
    let c = fs.readFileSync(f, 'utf8');
    const before = c.length;
    
    // Check what's around the profile-loader
    const idx = c.indexOf('<script src="/_shared/user-profile-loader.js"></script>');
    if (idx === -1) {
        console.log(f + ': NOT FOUND');
        continue;
    }
    
    // Look at context: 200 chars before and after
    const context = c.substring(idx - 100, idx + 100);
    
    // Check if it's inside a template literal context
    // Look for <\/scr before and `); after
    const beforeCtx = c.substring(Math.max(0, idx - 200), idx);
    const afterCtx = c.substring(idx, idx + 200);
    
    const insideTemplate = beforeCtx.includes('<\\/scr') || afterCtx.includes('`);');
    console.log(f + ':');
    console.log('  Position: ' + idx);
    console.log('  Inside template: ' + insideTemplate);
    console.log('  Before (last 60): ' + JSON.stringify(beforeCtx.slice(-60)));
    console.log('  After (first 80): ' + JSON.stringify(afterCtx.substring(0, 80)));
    
    if (insideTemplate) {
        // Remove the entire line including the newline before and after
        const lineStart = c.lastIndexOf('\n', idx - 1);
        const lineEnd = c.indexOf('\n', idx);
        if (lineStart !== -1 && lineEnd !== -1) {
            c = c.substring(0, lineStart) + c.substring(lineEnd);
            fs.writeFileSync(f, c, 'utf8');
            console.log('  FIXED! Removed ' + (before - c.length) + ' bytes');
        }
    }
}
