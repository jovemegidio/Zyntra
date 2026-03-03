/**
 * Script para adicionar suporte mobile (menu hambúrguer, responsividade) em todas as páginas de Vendas
 */

const fs = require('fs');
const path = require('path');

const vendasPagesDir = path.join(__dirname, '..', 'modules', 'Vendas', 'public');

// Scripts e CSS que precisam ser adicionados
const cssToAdd = [
    '<link rel="stylesheet" href="/css/responsive-global.css?v=20260111">',
    '<link rel="stylesheet" href="/css/modules-responsive.css?v=20260111">',
    '<link rel="stylesheet" href="/css/modal-responsive.css?v=20260111">'
];

const scriptsToAdd = [
    '<script src="/js/mobile-menu.js?v=20260111"></script>',
    '<script src="/js/mobile-responsive.js?v=20260111"></script>',
    '<script src="/js/responsive-mobile.js?v=20260111"></script>'
];

// Arquivos HTML de vendas para atualizar
const targetFiles = [
    'index.html',
    'dashboard.html',
    'dashboard-admin.html',
    'clientes.html',
    'estoque.html',
    'kanban.html',
    'pedidos.html',
    'relatorios.html',
    'comissoes.html'
];

function processFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⏭️ Arquivo não encontrado: ${filePath}`);
        return false;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // Adicionar CSS no <head> se não existir
    cssToAdd.forEach(css => {
        // Extrair nome do arquivo do CSS
        const cssMatch = css.match(/href="([^"]+)"/);
        if (cssMatch) {
            const cssName = path.basename(cssMatch[1].split('?')[0]);
            if (!content.includes(cssName)) {
                // Adicionar antes do </head>
                content = content.replace('</head>', `    ${css}\n</head>`);
                modified = true;
                console.log(`  ✅ CSS adicionado: ${cssName}`);
            }
        }
    });

    // Adicionar scripts antes do </body> se não existir
    scriptsToAdd.forEach(script => {
        // Extrair nome do arquivo do script
        const scriptMatch = script.match(/src="([^"]+)"/);
        if (scriptMatch) {
            const scriptName = path.basename(scriptMatch[1].split('?')[0]);
            if (!content.includes(scriptName)) {
                // Adicionar antes do </body>
                content = content.replace('</body>', `    ${script}\n</body>`);
                modified = true;
                console.log(`  ✅ Script adicionado: ${scriptName}`);
            }
        }
    });

    // Verificar se tem botão de menu mobile no header
    if (!content.includes('mobile-menu-btn') && !content.includes('menu-toggle-btn')) {
        // Adicionar botão hambúrguer no início do header
        // Procurar padrões comuns de header
        const headerPatterns = [
            { search: /<div class="header-left">/g, replace: '<div class="header-left">\n            <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu"><i class="fas fa-bars"></i></button>' },
            { search: /<header class="header">/g, replace: '<header class="header">\n        <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu"><i class="fas fa-bars"></i></button>' },
            { search: /<div class="topbar-left">/g, replace: '<div class="topbar-left">\n            <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu"><i class="fas fa-bars"></i></button>' }
        ];

        for (const pattern of headerPatterns) {
            if (pattern.search.test(content)) {
                content = content.replace(pattern.search, pattern.replace);
                modified = true;
                console.log(`  ✅ Botão hambúrguer adicionado no header`);
                break;
            }
        }
    }

    // Verificar se tem overlay para o mobile menu
    if (!content.includes('mobile-overlay') && !content.includes('sidebar-overlay')) {
        // Adicionar overlay antes do </body>
        const overlayHtml = `    <div id="mobile-overlay" class="mobile-overlay"></div>\n`;
        content = content.replace('</body>', overlayHtml + '</body>');
        modified = true;
        console.log(`  ✅ Overlay mobile adicionado`);
    }

    if (modified) {
        fs.writeFileSync(filePath, content, 'utf-8');
        return true;
    }

    return false;
}

console.log('📱 Adicionando suporte mobile às páginas de Vendas...\n');

let modifiedCount = 0;

targetFiles.forEach(fileName => {
    const filePath = path.join(vendasPagesDir, fileName);
    console.log(`📄 Processando: ${fileName}`);
    if (processFile(filePath)) {
        modifiedCount++;
    } else {
        console.log(`  ⏭️ Nenhuma alteração necessária`);
    }
});

console.log(`\n✅ ${modifiedCount} arquivos modificados`);
