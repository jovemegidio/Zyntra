/**
 * ALUFORCE - Script para Aplicar Estilos Responsivos em Todas as Páginas
 * Este script adiciona os CSS e JS responsivos em todas as páginas HTML do sistema
 * Versão: 2.0 - Janeiro 2026
 */

const fs = require('fs');
const path = require('path');

const rootPath = path.join(__dirname, '..');

// Meta viewport otimizado para mobile
const mobileViewport = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

// Pastas a ignorar
const ignoreFolders = ['backups', 'node_modules', 'Applicativo', '.git', 'build', 'dist'];

// Contadores
let totalFiles = 0;
let modifiedFiles = 0;
let skippedFiles = 0;
let errorFiles = 0;

/**
 * Verificar se o arquivo é uma página válida (não template parcial)
 */
function isValidPage(content) {
    return content.includes('<html') || content.includes('<!DOCTYPE');
}

/**
 * Verificar se já tem os assets responsivos
 */
function hasResponsiveAssets(content) {
    return content.includes('responsive-complete.css') && 
           content.includes('mobile-orientation.js');
}

/**
 * Verificar se o arquivo precisa de atualização de viewport
 */
function needsViewportUpdate(content) {
    // Se já tem viewport otimizado, não precisa
    if (content.includes('viewport-fit=cover')) {
        return false;
    }
    // Se tem viewport básico, precisa atualizar
    return content.includes('name="viewport"') || content.includes("name='viewport'");
}

/**
 * Atualizar viewport para mobile
 */
function updateViewport(content) {
    if (content.includes('viewport-fit=cover')) {
        return content;
    }
    
    // Padrões de viewport para substituir
    const viewportPatterns = [
        /<meta\s+name=["']viewport["']\s+content=["'][^"']*["']\s*\/?>/gi,
        /<meta\s+content=["'][^"']*["']\s+name=["']viewport["']\s*\/?>/gi
    ];
    
    let newContent = content;
    let replaced = false;
    
    for (const pattern of viewportPatterns) {
        if (pattern.test(newContent) && !replaced) {
            newContent = newContent.replace(pattern, `<meta name="viewport" content="${mobileViewport}">`);
            replaced = true;
            break;
        }
    }
    
    return newContent;
}

/**
 * Adicionar assets responsivos antes de </head>
 */
function addResponsiveAssets(content) {
    const hasResponsiveCSS = content.includes('responsive-complete.css');
    const hasMobileOrientationJS = content.includes('mobile-orientation.js');
    const hasResponsiveMobileJS = content.includes('responsive-mobile.js');
    
    if (hasResponsiveCSS && hasMobileOrientationJS && hasResponsiveMobileJS) {
        return { content, modified: false };
    }
    
    let newContent = content;
    let modified = false;
    
    // Construir os assets a adicionar
    let assetsToAdd = '';
    
    if (!hasResponsiveCSS) {
        assetsToAdd += '\n    <link rel="stylesheet" href="/css/responsive-complete.css?v=20260109">';
        modified = true;
    }
    
    if (!hasResponsiveMobileJS) {
        assetsToAdd += '\n    <script src="/js/responsive-mobile.js?v=20260109" defer></script>';
        modified = true;
    }
    
    if (!hasMobileOrientationJS) {
        assetsToAdd += '\n    <script src="/js/mobile-orientation.js?v=20260109" defer></script>';
        modified = true;
    }
    
    if (modified && newContent.includes('</head>')) {
        newContent = newContent.replace('</head>', `${assetsToAdd}\n</head>`);
    }
    
    return { content: newContent, modified };
}

/**
 * Processar arquivo HTML
 */
function processFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Verificar se é uma página HTML válida
        if (!isValidPage(content)) {
            return false;
        }
        
        // Verificar se já está completamente atualizado
        if (hasResponsiveAssets(content) && content.includes('viewport-fit=cover')) {
            skippedFiles++;
            return false;
        }
        
        let modified = false;
        
        // Atualizar viewport
        const newContentViewport = updateViewport(content);
        if (newContentViewport !== content) {
            content = newContentViewport;
            modified = true;
        }
        
        // Adicionar assets responsivos
        const result = addResponsiveAssets(content);
        if (result.modified) {
            content = result.content;
            modified = true;
        }
        
        if (modified) {
            fs.writeFileSync(filePath, content, 'utf8');
            modifiedFiles++;
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error(`  ❌ Erro ao processar ${filePath}: ${error.message}`);
        errorFiles++;
        return false;
    }
}

/**
 * Percorrer diretório recursivamente
 */
function walkDirectory(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        // Ignorar pastas específicas
        if (stat.isDirectory()) {
            if (!ignoreFolders.includes(file)) {
                walkDirectory(filePath);
            }
            continue;
        }
        
        // Processar apenas arquivos HTML
        if (file.endsWith('.html')) {
            totalFiles++;
            const relativePath = path.relative(rootPath, filePath);
            
            if (processFile(filePath)) {
                console.log(`  ✅ Atualizado: ${relativePath}`);
            }
        }
    }
}

/**
 * Executar
 */
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  ALUFORCE - Aplicando Estilos Responsivos (v2.0)            ║');
console.log('║  Suporte: Portrait + Landscape em Mobile e Tablet           ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log('📂 Pasta raiz:', rootPath);
console.log('📁 Ignorando:', ignoreFolders.join(', '));
console.log('\n🔍 Procurando arquivos HTML...\n');

// Processar pastas específicas
const foldersToProcess = [
    'public',
    'modules'
];

for (const folder of foldersToProcess) {
    const folderPath = path.join(rootPath, folder);
    if (fs.existsSync(folderPath)) {
        console.log(`\n📁 Processando: ${folder}/`);
        walkDirectory(folderPath);
    }
}

console.log('\n' + '═'.repeat(60));
console.log('📊 RESUMO:');
console.log('═'.repeat(60));
console.log(`   📄 Total de arquivos HTML: ${totalFiles}`);
console.log(`   ✅ Arquivos atualizados:   ${modifiedFiles}`);
console.log(`   ⏭️  Já atualizados:        ${skippedFiles}`);
console.log(`   ❌ Erros:                  ${errorFiles}`);
console.log('═'.repeat(60));
console.log('\n✨ Todas as páginas agora suportam Portrait e Landscape!\n');
