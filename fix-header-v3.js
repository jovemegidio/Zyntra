/**
 * Fix header brand separator v3 - Fix visibility of separators
 * The × and — characters are already in place, but the opacity is too low
 */

const fs = require('fs');
const path = require('path');

const BASE = '/var/www/aluforce';

function findHtmlFiles(dir) {
    const files = [];
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const full = path.join(dir, item);
            try {
                const stat = fs.statSync(full);
                if (stat.isFile() && item.endsWith('.html')) {
                    files.push(full);
                } else if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                    files.push(...findHtmlFiles(full));
                }
            } catch(e) {}
        }
    } catch(e) {}
    return files;
}

const DIRS = [
    'modules/Vendas/public',
    'modules/Compras/public',
    'modules/Financeiro/public',
    'modules/PCP/public',
    'modules/RH/public',
    'modules/Faturamento/public',
    'modules/NFe/public',
    'modules/CTE/public',
    'dashboard-modern',
    'public',
    'ajuda'
];

let allFiles = [];
for (const dir of DIRS) {
    allFiles.push(...findHtmlFiles(path.join(BASE, dir)));
}
allFiles = [...new Set(allFiles)];

console.log(`Found ${allFiles.length} HTML files\n`);

let fixedCount = 0;

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    // =========================================================================
    // The v1 script already changed | to × and │ to —
    // But they kept the old low-visibility inline styles
    // Now fix: make the × brighter (0.2 → 0.5) and — visible (0.18 → 0.5)
    // =========================================================================

    // Fix 1: The × between Aluforce and Zyntra - it has opacity 0.2 and pipe font style
    // Pattern: <span style="color:rgba(255,255,255,0.2);font-weight:300;font-size:18px;user-select:none;">×</span>
    content = content.replace(
        /<span\s+style="color:rgba\(255,255,255,0\.2\);font-weight:300;font-size:18px;user-select:none;">\u00D7<\/span>/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:15px;user-select:none;">\u00D7</span>'
    );

    // Fix 2: The — between Zyntra and page-title - it has opacity 0.18 and old style
    // Pattern: <span style="color:rgba(255,255,255,0.18);font-weight:200;font-size:16px;user-select:none;margin:0 2px;">—</span>
    content = content.replace(
        /<span\s+style="color:rgba\(255,255,255,0\.18\);font-weight:200;font-size:16px;user-select:none;margin:0 2px;">\u2014<\/span>/g,
        '<span style="color:rgba(255,255,255,0.45);font-weight:300;font-size:14px;user-select:none;margin:0 6px;">\u2014</span>'
    );

    // Fix 3: Some pages might still have the old pipe | between logos
    // Pattern: <span style="color:rgba(255,255,255,0.2);font-weight:300;font-size:18px;user-select:none;">|</span>
    content = content.replace(
        /<span\s+style="color:rgba\(255,255,255,0\.2\);font-weight:300;font-size:18px;user-select:none;">\|<\/span>/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:15px;user-select:none;">\u00D7</span>'
    );

    // Fix 4: Some pages have slightly different style format (no semi-colons, different order)
    // Catch-all for any span before zyntra with "|" inside and low opacity
    content = content.replace(
        /<span\s+style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)[^"]*">\|<\/span>/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:15px;user-select:none;">\u00D7</span>'
    );

    // Fix 5: Catch any remaining old-style separators with box drawing │ (U+2502)
    content = content.replace(
        /<span\s+style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.18\)[^"]*">\u2502<\/span>/g,
        '<span style="color:rgba(255,255,255,0.45);font-weight:300;font-size:14px;user-select:none;margin:0 6px;">\u2014</span>'
    );

    // Fix 6: Faturamento had opacity 0.3 for the dash-pagename merged span
    content = content.replace(
        /<span\s+style="color:rgba\(255,255,255,0\.3\);font-size:12px;margin-left:4px;">\u2014\s*/g,
        '<span style="color:rgba(255,255,255,0.45);font-weight:300;font-size:14px;user-select:none;margin:0 6px;">\u2014 '
    );

    // Fix 7: Also handle the pipe between Aluforce/Zyntra in Faturamento (0.2 but different format)
    content = content.replace(
        /<span\s+style="color:rgba\(255,255,255,0\.2\);font-weight:300;font-size:18px;">\|<\/span>/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:15px;user-select:none;">\u00D7</span>'
    );
    content = content.replace(
        /<span\s+style="color:rgba\(255,255,255,0\.2\);font-weight:300;font-size:18px;">\u00D7<\/span>/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:15px;user-select:none;">\u00D7</span>'
    );

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        fixedCount++;
        console.log(`  ✅ ${file.replace(BASE + '/', '')}`);
    }
}

console.log(`\n✨ Fixed visibility in ${fixedCount} files`);
