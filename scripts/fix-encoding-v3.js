/**
 * Script para corrigir problemas de encoding em arquivos HTML
 * ALUFORCE ERP - Correcao em lote
 * Data: 2026-01-18
 */

const fs = require('fs');
const path = require('path');

// Mapeamento de mojibake para caracteres corretos (usando escape strings)
const encodingMap = {
    '\u00C3\u00A1': '\u00E1', // a agudo
    '\u00C3\u00A9': '\u00E9', // e agudo
    '\u00C3\u00AD': '\u00ED', // i agudo
    '\u00C3\u00B3': '\u00F3', // o agudo
    '\u00C3\u00BA': '\u00FA', // u agudo
    '\u00C3\u00A2': '\u00E2', // a circunflexo
    '\u00C3\u00AA': '\u00EA', // e circunflexo
    '\u00C3\u00AE': '\u00EE', // i circunflexo
    '\u00C3\u00B4': '\u00F4', // o circunflexo
    '\u00C3\u00BB': '\u00FB', // u circunflexo
    '\u00C3\u00A3': '\u00E3', // a til
    '\u00C3\u00B5': '\u00F5', // o til
    '\u00C3\u00A7': '\u00E7', // c cedilha
    '\u00C3\u00A0': '\u00E0', // a crase
    '\u00C3\u00A8': '\u00E8', // e crase
    '\u00C3\u00AC': '\u00EC', // i crase
    '\u00C3\u00B2': '\u00F2', // o crase
    '\u00C3\u00B9': '\u00F9', // u crase
    '\u00C3\u00BC': '\u00FC', // u trema
    '\u00C3\u0081': '\u00C1', // A agudo
    '\u00C3\u0089': '\u00C9', // E agudo
    '\u00C3\u008D': '\u00CD', // I agudo
    '\u00C3\u0093': '\u00D3', // O agudo
    '\u00C3\u009A': '\u00DA', // U agudo
    '\u00C3\u0082': '\u00C2', // A circunflexo
    '\u00C3\u008A': '\u00CA', // E circunflexo
    '\u00C3\u0094': '\u00D4', // O circunflexo
    '\u00C3\u0083': '\u00C3', // A til
    '\u00C3\u0095': '\u00D5', // O til
    '\u00C3\u0087': '\u00C7', // C cedilha
};

// Diretorios a excluir
const excludeDirs = ['node_modules', 'backups', '_archive', 'dist-electron', '.git'];

let stats = { total: 0, fixed: 0, errors: 0 };

function fixEncoding(content) {
    let fixed = content;
    let hasChanges = false;
    
    for (const [bad, good] of Object.entries(encodingMap)) {
        if (fixed.includes(bad)) {
            fixed = fixed.split(bad).join(good);
            hasChanges = true;
        }
    }
    
    return { fixed, hasChanges };
}

function processFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const { fixed, hasChanges } = fixEncoding(content);
        
        if (hasChanges) {
            fs.writeFileSync(filePath, fixed, 'utf8');
            console.log('FIXED: ' + path.basename(filePath));
            stats.fixed++;
        }
        stats.total++;
    } catch (error) {
        console.error('ERROR: ' + filePath + ' - ' + error.message);
        stats.errors++;
    }
}

function walkDir(dir) {
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            
            if (item.isDirectory()) {
                if (!excludeDirs.includes(item.name)) {
                    walkDir(fullPath);
                }
            } else if (item.isFile() && item.name.endsWith('.html')) {
                processFile(fullPath);
            }
        }
    } catch (error) {
        // skip
    }
}

console.log('========================================');
console.log(' CORRECAO DE ENCODING - ALUFORCE ERP');
console.log('========================================');

const basePath = path.resolve(__dirname, '..');
console.log('Diretorio: ' + basePath);
console.log('Processando arquivos HTML...\n');

walkDir(basePath);

console.log('\n========================================');
console.log(' RESULTADO');
console.log('========================================');
console.log('Total: ' + stats.total);
console.log('Corrigidos: ' + stats.fixed);
console.log('Erros: ' + stats.errors);
console.log('\nConcluido!');
