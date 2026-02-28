/**
 * Script para atualizar todas as páginas do módulo Compras
 * com o novo design SaaS Light
 * 
 * Execute com: node update-compras-pages.js
 */

const fs = require('fs');
const path = require('path');

const modulePath = __dirname;

// Lista de arquivos HTML a serem atualizados
const htmlFiles = [
    'cotacoes.html',
    'requisicoes.html',
    'gestao-estoque.html',
    'alcadas.html',
    'recebimento.html',
    'relatorios.html',
    'materiais.html'
];

// Novo head padrão (sem inline styles)
const newHeadTemplate = (title) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <title>ALUFORCE - ${title}</title>
    
    <!-- Fonts -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    
    <!-- Design System SaaS Light -->
    <link rel="stylesheet" href="css/compras-saas-light.css?v=20260112">
    
    <!-- CSS Globais -->
    <link rel="stylesheet" href="/css/popup-confirmacao.css">
    <link rel="stylesheet" href="/css/responsive-global.css?v=2026010601">
    <link rel="stylesheet" href="/css/responsive-complete.css?v=20260109">
    
    <!-- Scripts -->
    <script src="/js/anti-copy-protection.js"><\/script>
    <script src="/js/mobile-orientation.js?v=20260109" defer><\/script>
    <script src="/js/responsive-mobile.js?v=20260108" defer><\/script>
</head>`;

// Mapeamento de títulos
const titles = {
    'cotacoes.html': 'Cotações',
    'requisicoes.html': 'Requisições de Compra',
    'gestao-estoque.html': 'Gestão de Estoque',
    'alcadas.html': 'Alçadas de Aprovação',
    'recebimento.html': 'Recebimento',
    'relatorios.html': 'Relatórios de Compras',
    'materiais.html': 'Materiais'
};

function updateFile(filename) {
    const filePath = path.join(modulePath, filename);
    
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Arquivo não encontrado: ${filename}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Encontrar onde termina o </head>
    const headEndIndex = content.indexOf('</head>');
    if (headEndIndex === -1) {
        console.log(`⚠️  </head> não encontrado em: ${filename}`);
        return;
    }
    
    // Encontrar onde começa o <body>
    const bodyStartIndex = content.indexOf('<body>');
    if (bodyStartIndex === -1) {
        console.log(`⚠️  <body> não encontrado em: ${filename}`);
        return;
    }
    
    // Extrair o resto do documento após </head>
    const bodyContent = content.substring(bodyStartIndex);
    
    // Criar novo conteúdo
    const title = titles[filename] || filename.replace('.html', '');
    const newContent = newHeadTemplate(title) + '\n' + bodyContent;
    
    // Substituir referência ao modal-fix-global.js pelo novo modal-system.js
    const finalContent = newContent
        .replace(/\/js\/modal-fix-global\.js[^"']*/g, 'js/modal-system.js?v=20260112')
        .replace(/\/css\/modal-fix-global\.css[^"']*/g, 'css/compras-saas-light.css?v=20260112');
    
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    console.log(`✅ Atualizado: ${filename}`);
}

console.log('🚀 Iniciando atualização das páginas do módulo Compras...\n');

htmlFiles.forEach(updateFile);

console.log('\n✨ Atualização concluída!');
console.log('📝 Arquivos atualizados com o novo Design System SaaS Light');
