/**
 * Script para corrigir problemas de encoding em arquivos HTML
 * ALUFORCE ERP - Correção em lote
 * Data: 2026-01-18
 * 
 * Problema: Caracteres UTF-8 exibidos como mojibake (ex: "ó" ao invés de "ó")
 * Causa: Arquivos UTF-8 lidos como ISO-8859-1 e salvos novamente
 */

const fs = require('fs');
const path = require('path');

// Mapeamento de mojibake para caracteres corretos
const encodingMap = {
    'á': 'á',
    'é': 'é',
    'í': 'í',
    'ó': 'ó',
    'ú': 'ú',
    'â': 'â',
    'ê': 'ê',
    'î': 'î',
    'ô': 'ô',
    'û': 'û',
    'ã': 'ã',
    'õ': 'õ',
    'ç': 'ç',
    'Á€': 'À',
    'Á‰': 'É',
    'Á': 'Í',
    'Á"': 'Ó',
    'Áš': 'Ú',
    'Á‚': 'Â',
    'ÁŠ': 'Ê',
    'ÁŽ': 'Î',
    'Á"': 'Ô',
    'Á›': 'Û',
    'Áƒ': 'Á',
    'Á•': 'Õ',
    'Á‡': 'Ç',
    'Á¼': 'ü',
    'Á¤': 'ä',
    'Á¶': 'ö',
    'à': 'à',
    'è': 'è',
    'ì': 'ì',
    'ò': 'ò',
    'ù': 'ù',
    'Â ': ' ',
    '°': '°',
    'Â²': '²',
    'Â³': '³',
    'Â½': '½',
    'Â¼': '¼',
    'Â¾': '¾',
    'â€"': '–',
    'â€"': '—',
    'â€™': ''',
    'â€˜': ''',
    'â€œ': '"',
    'â€': '"',
    'â€¢': '•',
    'â€¦': '…',
    'Â«': '«',
    'Â»': '»',
    'Â®': '®',
    'Â©': '©',
    'â„¢': '™',
};

// Diretórios a excluir
const excludeDirs = ['node_modules', 'backups', '_archive', 'dist-electron', '.git'];

// Estatísticas
let stats = {
    total: 0,
    fixed: 0,
    errors: 0,
    skipped: 0
};

/**
 * Corrige o conteúdo com problemas de encoding
 */
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

/**
 * Verifica se o arquivo precisa de correção
 */
function needsFix(content) {
    return Object.keys(encodingMap).some(bad => content.includes(bad));
}

/**
 * Processa um arquivo HTML
 */
function processFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        if (needsFix(content)) {
            const { fixed, hasChanges } = fixEncoding(content);
            
            if (hasChanges) {
                fs.writeFileSync(filePath, fixed, 'utf8');
                console.log(`✅ Corrigido: ${path.basename(filePath)}`);
                stats.fixed++;
            }
        } else {
            stats.skipped++;
        }
        
        stats.total++;
    } catch (error) {
        console.error(`❌ Erro em ${filePath}: ${error.message}`);
        stats.errors++;
    }
}

/**
 * Percorre recursivamente um diretório
 */
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
        console.error(`❌ Erro ao ler diretório ${dir}: ${error.message}`);
    }
}

// Executar
console.log('========================================');
console.log(' CORREÇÁO DE ENCODING - ALUFORCE ERP');
console.log('========================================\n');

const basePath = __dirname.replace(/\\scripts$/, '');
console.log(`📂 Diretório base: ${basePath}\n`);
console.log('Processando arquivos HTML...\n');

walkDir(basePath);

console.log('\n========================================');
console.log(' RESULTADO DA CORREÇÁO');
console.log('========================================');
console.log(`📊 Total de arquivos: ${stats.total}`);
console.log(`✅ Arquivos corrigidos: ${stats.fixed}`);
console.log(`⏭️  Arquivos sem correção: ${stats.skipped}`);
console.log(`❌ Erros: ${stats.errors}`);
console.log('\n✨ Concluído!');
