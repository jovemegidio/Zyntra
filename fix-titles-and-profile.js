/**
 * Fix Script: 
 * 1. Revert ALL <title> tags from "Aluforce × Zyntra - X" back to "Aluforce: X"
 * 2. Remove user-profile-loader.js injected INSIDE template literals (print windows)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/var/www/aluforce';

// Find all HTML files
const allHtml = execSync(`find ${ROOT}/modules ${ROOT}/public ${ROOT}/Login-Page-main ${ROOT}/dashboard-modern ${ROOT}/ajuda -name '*.html' 2>/dev/null`)
    .toString().trim().split('\n').filter(Boolean);

console.log(`Found ${allHtml.length} HTML files to scan`);

let titleFixed = 0;
let profileFixed = 0;
let filesModified = 0;

for (const file of allHtml) {
    let content;
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch(e) { continue; }
    
    let modified = false;
    const rel = file.replace(ROOT + '/', '');
    
    // =========================================================================
    // FIX 1: Revert <title>Aluforce × Zyntra - X</title> to <title>Aluforce: X</title>
    // The × is U+00D7 (MULTIPLICATION SIGN)
    // =========================================================================
    const titleRegex = /<title>Aluforce\s*\u00d7\s*Zyntra\s*-\s*(.+?)<\/title>/gi;
    let match;
    let newContent = content;
    
    while ((match = titleRegex.exec(content)) !== null) {
        const original = match[0];
        const pageName = match[1].trim();
        const replacement = `<title>Aluforce: ${pageName}</title>`;
        newContent = newContent.replace(original, replacement);
        titleFixed++;
        modified = true;
    }
    content = newContent;
    
    // Also handle cases inside template literals like: <title>Aluforce × Zyntra - ${titulo}</title>
    const titleRegex2 = /(<title>)Aluforce\s*\u00d7\s*Zyntra\s*-\s*(\$\{[^}]+\})(<\/title>)/gi;
    while ((match = titleRegex2.exec(newContent)) !== null) {
        const original = match[0];
        const expr = match[2];
        const replacement = `<title>Aluforce: ${expr}</title>`;
        content = content.replace(original, replacement);
        titleFixed++;
        modified = true;
    }
    
    // =========================================================================
    // FIX 2: Remove user-profile-loader.js injected inside template literals
    // Pattern: inside a document.write() or string that has <\/script> nearby
    // The bad injection looks like:
    //   <\/scr` + `ipt>
    //   <script src="/_shared/user-profile-loader.js"></script>
    //   </body>
    //           </html>
    //       `);
    // The script tag should NOT be there - it's inside a print template
    // =========================================================================
    
    // Check if file has user-profile-loader INSIDE a template literal context
    // We look for the pattern: <\/scr` + `ipt>\n followed by profile-loader before `);
    const badPattern = /(<\/scr`\s*\+\s*`ipt>[\s\r\n]*)\n<script src="\/_shared\/user-profile-loader\.js"><\/script>\n/g;
    if (badPattern.test(content)) {
        content = content.replace(badPattern, '$1\n');
        profileFixed++;
        modified = true;
    }
    
    // Alternative pattern - direct injection near closing of template
    const badPattern2 = /(<\/scr`\s*\+\s*`ipt>\s*)\r?\n<script src="\/_shared\/user-profile-loader\.js"><\/script>\r?\n/g;
    if (badPattern2.test(content)) {
        content = content.replace(badPattern2, '$1\n');
        profileFixed++;
        modified = true;
    }
    
    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        filesModified++;
        console.log(`  ✅ ${rel}`);
    }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Files modified: ${filesModified}`);
console.log(`Title tags reverted: ${titleFixed}`);
console.log(`Profile-loader in templates removed: ${profileFixed}`);
