const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = '/var/www/aluforce';

// Find ALL html files with user-profile-loader
const output = execSync(`grep -rn 'user-profile-loader' ${ROOT}/modules ${ROOT}/public ${ROOT}/Login-Page-main ${ROOT}/dashboard-modern ${ROOT}/ajuda --include='*.html' 2>/dev/null || true`).toString();

const lines = output.trim().split('\n').filter(Boolean);
console.log('Total profile-loader references: ' + lines.length);

let badRemoved = 0;
let filesFixed = 0;
const processed = new Set();

for (const line of lines) {
    const match = line.match(/^(.+?):(\d+):/);
    if (!match) continue;
    
    const file = match[1];
    const lineNum = parseInt(match[2]);
    
    if (processed.has(file + ':' + lineNum)) continue;
    processed.add(file + ':' + lineNum);
    
    let content = fs.readFileSync(file, 'utf8');
    const allLines = content.split('\n');
    const lineIdx = lineNum - 1;
    const theLine = allLines[lineIdx] || '';
    
    // Check if this profile-loader is inside a JS string/template context
    // Indicators:
    // 1. The line contains html += or part of a string concatenation
    // 2. Previous lines have document.write, innerHTML, template literal, etc.
    // 3. The line is inside a backtick template that's being written to a window
    
    const prevLines = allLines.slice(Math.max(0, lineIdx - 5), lineIdx).join('\n');
    const nextLines = allLines.slice(lineIdx + 1, lineIdx + 5).join('\n');
    
    const isInsideStringContext = 
        theLine.includes("html +=") ||
        theLine.includes("html+=") ||
        (prevLines.includes('<\\/scr') && nextLines.includes('`);')) ||
        (prevLines.includes('document.write') && !theLine.trim().startsWith('<script')) ||
        (prevLines.includes("html += '") && nextLines.includes("';"));
    
    if (isInsideStringContext) {
        const rel = file.replace(ROOT + '/', '');
        console.log('  BAD: ' + rel + ':' + lineNum + ' (inside string context)');
        
        // Remove this line
        allLines.splice(lineIdx, 1);
        content = allLines.join('\n');
        fs.writeFileSync(file, content, 'utf8');
        badRemoved++;
        filesFixed++;
    }
}

console.log('\nRemoved ' + badRemoved + ' bad injections from ' + filesFixed + ' files');

// Final verification
const remaining = execSync(`grep -rn 'user-profile-loader' ${ROOT}/modules ${ROOT}/public --include='*.html' 2>/dev/null | wc -l || true`).toString().trim();
console.log('Remaining profile-loader references: ' + remaining);
