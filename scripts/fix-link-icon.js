/**
 * Script para corrigir tags <link rel="icon"> mal posicionadas
 * Remove tags que estão dentro de <header>, <main> ou outros elementos inválidos
 * 
 * Uso: node scripts/fix-link-icon.js
 */

const fs = require('fs');
const path = require('path');

// Diretórios a processar (exclui backups)
const dirsToProcess = [
    'modules',
    'public',
    'Ajuda - Aluforce'
];

// Padrão a procurar: <link rel="icon"...> que não está no início de uma linha (dentro de outros elementos)
const patterns = [
    /(<header[^>]*>)\s*<link\s+rel="icon"[^>]*>/gi,
    /(<main[^>]*>)\s*<link\s+rel="icon"[^>]*>/gi,
    /(<topbar[^>]*>)\s*<link\s+rel="icon"[^>]*>/gi,
    /(<div[^>]*class="header"[^>]*>)\s*<link\s+rel="icon"[^>]*>/gi,
];

let filesFixed = 0;
let errorsFound = 0;

function processFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalContent = content;
        let modified = false;

        // Aplicar cada padrão
        for (const pattern of patterns) {
            if (pattern.test(content)) {
                content = content.replace(pattern, '$1');
                modified = true;
            }
        }

        // Também remover o padrão específico visto nos arquivos
        const specificPattern = /<header class="header">\s*<link rel="icon" type="image\/x-icon" href="\/favicon\.ico">/gi;
        if (specificPattern.test(content)) {
            content = content.replace(specificPattern, '<header class="header">');
            modified = true;
        }

        // Remover qualquer <link rel="icon"> que esteja após <header>
        const headerLinkPattern = /(<header[^>]*>)\s*<link\s+rel="icon"[^>]*>\n?/gi;
        if (headerLinkPattern.test(content)) {
            content = content.replace(headerLinkPattern, '$1\n');
            modified = true;
        }

        if (modified) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Corrigido: ${filePath}`);
            filesFixed++;
        }
    } catch (error) {
        console.error(`❌ Erro em ${filePath}: ${error.message}`);
        errorsFound++;
    }
}

function processDirectory(dirPath) {
    try {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                // Ignorar backups
                if (item === 'backups' || item === 'node_modules' || item === '.git') {
                    continue;
                }
                processDirectory(fullPath);
            } else if (item.endsWith('.html')) {
                processFile(fullPath);
            }
        }
    } catch (error) {
        console.error(`Erro ao processar diretório ${dirPath}: ${error.message}`);
    }
}

// Processar diretórios
const basePath = path.resolve(__dirname, '..');

console.log('🔧 Iniciando correção de tags <link rel="icon"> mal posicionadas...\n');

for (const dir of dirsToProcess) {
    const fullPath = path.join(basePath, dir);
    if (fs.existsSync(fullPath)) {
        console.log(`📁 Processando: ${dir}`);
        processDirectory(fullPath);
    }
}

console.log(`\n📊 Resumo:`);
console.log(`   Arquivos corrigidos: ${filesFixed}`);
console.log(`   Erros encontrados: ${errorsFound}`);
console.log('\n✅ Processo finalizado!');
