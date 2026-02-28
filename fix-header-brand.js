/**
 * Fix header brand separator across ALL pages
 * Pattern: Aluforce [×] Zyntra [—] Page Name
 * 
 * Problem: The separator between Zyntra logo and page name is nearly invisible
 * (box drawing char │ with 0.18 opacity or inconsistent patterns)
 * 
 * Solution: Standardize to visible "×" between brands and "—" before page name
 */

const fs = require('fs');
const path = require('path');

const BASE = '/var/www/aluforce';
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
    'ajuda',
    'ajuda/artigos',
    'ajuda/colecoes'
];

let totalFixed = 0;
let filesFixed = [];

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
                } else if (stat.isDirectory() && !item.startsWith('.') && !item.startsWith('node_modules')) {
                    files.push(...findHtmlFiles(full));
                }
            } catch(e) {}
        }
    } catch(e) {}
    return files;
}

function fixHeaderBrand(content, filePath) {
    let modified = false;
    let original = content;

    // ============================================
    // FIX 1: Inline-styled separators (Vendas, Compras pattern)
    // Pattern: <span style="...opacity...">|</span> between Aluforce and Zyntra
    // Then: <span style="...opacity...">│</span> between Zyntra and page-title
    // ============================================

    // Replace the pipe "|" between Aluforce logo and Zyntra logo with "×"
    // Make it more visible: color rgba(255,255,255,0.5) instead of 0.2
    content = content.replace(
        /(<img[^>]*Aluforce[^>]*>)\s*<span\s+style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)[^"]*"[^>]*>\|<\/span>\s*(<img[^>]*zyntra[^>]*>)/gi,
        '$1\n                        <span style="color:rgba(255,255,255,0.45);font-weight:300;font-size:16px;user-select:none;">×</span>\n                        $2'
    );

    // Replace the box-drawing separator "│" between Zyntra and page-title with "—"
    // Make it clearly visible
    content = content.replace(
        /(<img[^>]*zyntra[^>]*>)\s*<span\s+style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.18\)[^"]*>[│\|]<\/span>\s*(<span\s+class="page-title")/gi,
        '$1\n                        <span style="color:rgba(255,255,255,0.4);font-weight:300;font-size:14px;user-select:none;margin:0 4px;">—</span>\n                        $2'
    );

    // ============================================
    // FIX 2: Class-based separators (Financeiro pattern)
    // <span class="header-separator">|</span> → ×
    // <span class="header-dash">—</span> → — (keep but ensure visible)
    // ============================================
    content = content.replace(
        /<span\s+class="header-separator">\|<\/span>/gi,
        '<span class="header-separator">×</span>'
    );

    // ============================================
    // FIX 3: Faturamento pattern (dash merged with page name)
    // <span style="...">— Faturamento</span> → separate dash + page-title span
    // ============================================
    content = content.replace(
        /(<img[^>]*zyntra[^>]*>)\s*<span\s+style="[^"]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.[23]\)[^"]*">[\u2014\u2013\-—–]\s*([^<]+)<\/span>/gi,
        (match, imgTag, pageName) => {
            return `${imgTag}\n                        <span style="color:rgba(255,255,255,0.4);font-weight:300;font-size:14px;user-select:none;margin:0 4px;">—</span>\n                        <span class="page-title" style="font-size:13px;font-weight:500;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">${pageName.trim()}</span>`;
        }
    );

    // ============================================
    // FIX 4: Any remaining invisible separators between zyntra and page-title
    // Generic catch-all for other patterns
    // ============================================
    
    // Catch any remaining box-drawing or invisible characters between zyntra logo and page-title
    content = content.replace(
        /(<img[^>]*zyntra[^>]*>)\s*<span[^>]*style="[^"]*"[^>]*>[\u2502\u2503\u2500\u2501│┃─━\|]*<\/span>\s*(<span[^>]*class="page-title")/gi,
        '$1\n                        <span style="color:rgba(255,255,255,0.4);font-weight:300;font-size:14px;user-select:none;margin:0 4px;">—</span>\n                        $2'
    );

    // ============================================
    // FIX 5: Ensure header-separator CSS exists (for Financeiro-style pages)
    // Add CSS rules if header-separator class is used but not styled
    // ============================================
    if (content.includes('header-separator') && !content.includes('.header-separator')) {
        const styleInsert = `
        .header-separator {
            color: rgba(255,255,255,0.45);
            font-weight: 300;
            font-size: 16px;
            user-select: none;
        }
        .header-dash {
            color: rgba(255,255,255,0.4);
            font-weight: 300;
            font-size: 14px;
            user-select: none;
            margin: 0 4px;
        }`;
        content = content.replace('</style>', styleInsert + '\n        </style>');
    }

    // ============================================
    // FIX 6: Fix <title> tags - standardize to "Aluforce × Zyntra - Page Name"
    // Only for app pages (not library/doc files)
    // ============================================
    
    // Map of title patterns to standardized names
    const titleMap = {
        'Consulta de Estoque': 'Estoque',
        'Consultar Estoque': 'Estoque',
        'Consulta Estoque': 'Estoque',
    };
    
    content = content.replace(/<title>(Aluforce|ALUFORCE)\s*[:|\-–—]\s*(.+?)<\/title>/gi, (match, brand, pageName) => {
        let name = pageName.trim();
        // Remove "Consulta de" prefixes etc
        if (titleMap[name]) name = titleMap[name];
        return `<title>Aluforce × Zyntra - ${name}</title>`;
    });

    // Also fix "ALUFORCE:" patterns
    content = content.replace(/<title>(ALUFORCE|Aluforce)\s*:\s*(.+?)<\/title>/gi, (match, brand, pageName) => {
        let name = pageName.trim();
        if (titleMap[name]) name = titleMap[name];
        return `<title>Aluforce × Zyntra - ${name}</title>`;
    });

    // Fix patterns like "Dashboard Financeiro - Aluforce"
    content = content.replace(/<title>(.+?)\s*[-–—]\s*(Aluforce|ALUFORCE)\s*(Financeiro|ERP|NFe|Vendas|Compras)?<\/title>/gi, (match, pageName, brand, suffix) => {
        let name = pageName.trim();
        if (suffix) name = name + ' ' + suffix;
        return `<title>Aluforce × Zyntra - ${name}</title>`;
    });

    // Fix "Aluforce - Something" pattern
    content = content.replace(/<title>(ALUFORCE|Aluforce)\s*[-–—]\s*(.+?)<\/title>/gi, (match, brand, pageName) => {
        let name = pageName.trim();
        return `<title>Aluforce × Zyntra - ${name}</title>`;
    });

    // Fix standalone "Aluforce ERP" or similar
    content = content.replace(/<title>(ALUFORCE|Aluforce)\s+ERP<\/title>/gi, '<title>Aluforce × Zyntra - ERP</title>');

    // Fix remaining patterns with module-specific titles
    // "Something - Aluforce" pattern (Contas a Pagar - Aluforce Financeiro)  
    content = content.replace(/<title>(.+?)\s*[-–—]\s*Aluforce\s*(Financeiro|NFe|Vendas|Compras)?<\/title>/gi, (match, pageName, suffix) => {
        let name = pageName.trim();
        return `<title>Aluforce × Zyntra - ${name}</title>`;
    });

    if (content !== original) {
        modified = true;
    }

    return { content, modified };
}

// Main execution
console.log('🔧 Fixing header brand separators across all pages...\n');

let allFiles = [];
for (const dir of DIRS) {
    const fullDir = path.join(BASE, dir);
    allFiles.push(...findHtmlFiles(fullDir));
}

// Remove duplicates
allFiles = [...new Set(allFiles)];

console.log(`📄 Found ${allFiles.length} HTML files to check\n`);

for (const file of allFiles) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const { content: fixed, modified } = fixHeaderBrand(content, file);
        
        if (modified) {
            fs.writeFileSync(file, fixed, 'utf8');
            const rel = file.replace(BASE + '/', '');
            filesFixed.push(rel);
            totalFixed++;
            console.log(`  ✅ ${rel}`);
        }
    } catch(e) {
        console.error(`  ❌ Error: ${file}: ${e.message}`);
    }
}

console.log(`\n✨ Fixed ${totalFixed} files:`);
filesFixed.forEach(f => console.log(`   - ${f}`));
console.log('\nDone!');
