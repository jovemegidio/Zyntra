/**
 * Fix header brand separator v2 - Direct byte-level replacement
 * Fixes the separator between Zyntra logo and page name
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
    // STRATEGY: Find ALL <span> elements that contain ONLY box-drawing or pipe
    // characters and are near "zyntra" text. Replace their content.
    // =========================================================================

    // Pattern 1: Any span with inline style containing ONLY │ ┃ | ─ — – chars
    // This catches the invisible separator between zyntra and page-title
    // The box drawing char U+2502 (│) appears as 3 bytes: E2 94 82
    
    // Replace pipe | between Aluforce and Zyntra (the first separator)
    // Match: span with color rgba(255,255,255,0.2) containing "|"
    content = content.replace(
        /(<span[^>]*style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)[^"]*"[^>]*>)\|(<\/span>)/g,
        '$1\u00D7$2' // × symbol
    );

    // Replace box-drawing │ (U+2502) in any span near page-title
    // This is the invisible separator before the page name
    content = content.replace(
        /(<span[^>]*style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.18\)[^"]*>)\u2502(<\/span>)/g,
        (match, before, after) => {
            // Replace the entire span with a visible dash
            return '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:14px;user-select:none;margin:0 6px;">\u2014</span>';
        }
    );

    // Also catch the span with 0.2 opacity (some pages use this for the second separator too)  
    content = content.replace(
        /(<span[^>]*style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)[^"]*>)\u2502(<\/span>)/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:14px;user-select:none;margin:0 6px;">\u2014</span>'
    );

    // Fix the × character visibility - make it brighter
    content = content.replace(
        /(<span[^>]*style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)[^"]*>)\u00D7(<\/span>)/g,
        '<span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:16px;user-select:none;">\u00D7</span>'
    );

    // Fix Faturamento pattern: <span style="...">— Something</span> → separate dash + page-title
    content = content.replace(
        /(<img[^>]*zyntra[^>]*>)\s*<span\s+style="color:rgba\(255,255,255,0\.3\);font-size:12px;margin-left:4px;">[\u2014\u2013\-\u2015]\s*([^<]+)<\/span>/g,
        (match, img, pageName) => {
            return `${img}
                        <span style="color:rgba(255,255,255,0.5);font-weight:300;font-size:14px;user-select:none;margin:0 6px;">\u2014</span>
                        <span class="page-title" style="font-size:13px;font-weight:500;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">${pageName.trim()}</span>`;
        }
    );

    // Fix class-based separators (Financeiro pattern)
    content = content.replace(
        /<span\s+class="header-separator">\|<\/span>/g,
        '<span class="header-separator">\u00D7</span>'
    );
    content = content.replace(
        /<span\s+class="header-separator">\u00D7<\/span>/g,
        '<span class="header-separator">\u00D7</span>'
    );

    // Fix the header-dash to be visible
    content = content.replace(
        /<span\s+class="header-dash">[\u2014\u2013\-\u2502\u2015—–│]+<\/span>/g,
        '<span class="header-dash">\u2014</span>'
    );

    // Ensure CSS for header-separator and header-dash if they exist in page
    if (content.includes('class="header-separator"') && content.includes('.header-separator')) {
        content = content.replace(
            /\.header-separator\s*\{[^}]*\}/g,
            `.header-separator {
            color: rgba(255,255,255,0.5);
            font-weight: 300;
            font-size: 16px;
            user-select: none;
            margin: 0 2px;
        }`
        );
    }
    if (content.includes('class="header-dash"') && content.includes('.header-dash')) {
        content = content.replace(
            /\.header-dash\s*\{[^}]*\}/g,
            `.header-dash {
            color: rgba(255,255,255,0.5);
            font-weight: 300;
            font-size: 14px;
            user-select: none;
            margin: 0 6px;
        }`
        );
    }

    // Also handle pages where header-brand uses classes but CSS is missing
    if (content.includes('class="header-separator"') && !content.includes('.header-separator')) {
        // Add CSS before </style>
        const cssAdd = `
        .header-separator {
            color: rgba(255,255,255,0.5);
            font-weight: 300;
            font-size: 16px;
            user-select: none;
        }
        .header-dash {
            color: rgba(255,255,255,0.5);
            font-weight: 300;
            font-size: 14px;
            user-select: none;
            margin: 0 6px;
        }`;
        // Insert before last </style>
        const lastStyleIdx = content.lastIndexOf('</style>');
        if (lastStyleIdx > -1) {
            content = content.slice(0, lastStyleIdx) + cssAdd + '\n        ' + content.slice(lastStyleIdx);
        }
    }

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        fixedCount++;
        console.log(`  ✅ ${file.replace(BASE + '/', '')}`);
    }
}

console.log(`\n✨ Fixed separators in ${fixedCount} files`);
