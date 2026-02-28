/**
 * Injeta Chat Widget BOB AI em TODAS as páginas HTML do sistema ALUFORCE
 * 
 * Adiciona:
 * - CSS no <head>: <link rel="stylesheet" href="/chat/widget.css?v=20260218">
 * - JS antes do </body>: <script src="/chat/widget.js?v=20260218" defer></script>
 * 
 * Pula:
 * - Arquivos que já possuem widget.js
 * - Arquivos sem </head> ou </body> (fragments, não são páginas completas)
 * - Demos/referências/testes obsoletos do PCP
 * - templates/_shared que são apenas templates de referência
 */
const fs = require('fs');
const path = require('path');

const base = 'g:/.shortcut-targets-by-id/1cwjbEHD82YI8KNdhYtxmMhyZezb1IsFN/Sistema - ALUFORCE - V.2';
const outFile = path.join(base, 'scripts_auxiliares', 'chat-inject-result.txt');
const lines = [];
function log(msg) { lines.push(msg); }

// Files to explicitly skip (demos, old references, non-app pages)
const skipFiles = new Set([
    'modules/PCP/sistema_funcional.html',
    'modules/PCP/login.html',
    'modules/PCP/INSTRUCOES_MODAL_NOVO.html',
    'modules/PCP/diagnostico_sistema.html',
    'modules/PCP/demonstracao_completa.html',
    'modules/PCP/limpar_cache.html',
    'modules/PCP/pcp_module_reference.html',
    'modules/PCP/catalogo_produtos_gtin_2025_10_06.html',
    'modules/PCP/sistema_corrigido_final.html',
    'modules/PCP/gerar_ordem_excel.html',
    'modules/PCP/modal-produto-enriquecido.html',
    'modules/PCP/index_new.html',
    'modules/PCP/PATCH_INDEX_HTML.html',
    'modules/PCP/modal-produto-rico.html',
    'modules/PCP/modal_nova_ordem_saas.html',
    'modules/RH/screenshots/sidebar_dump.html',
    'modules/_shared/aluforce-layout.html',
    'modules/_shared/demo-layout.html',
    'modules/_shared/header-sidebar.html',
    'modules/_shared/layout-template.html',
    'modules/_shared/header.html',
    'modules/_shared/sidebar.html',
    'modules/Compras/index-new.html',
    'modules/Vendas/public/preview_augusto.html',
    'modules/Consultoria/acesso.html',
    'public/print-manager/index.html',
    'public/template-editor/index.html',
    'public/limpar-sessao.html',
    'public/logout.html',
    'public/relatorio-final-rh.html',
    'public/setup-user-test.html',
    'public/configure-vendas.html',
    'public/limpar-hsts.html',
    'public/clear-session.html',
    'public/config-modals.html',
    'public/setup-user-ti.html',
    'public/config-modals-extended.html',
    'public/offline-settings.html',
    'public/modal-configuracoes-content.html',
    'public/modal-demo.html',
    'public/index-redirect-backup.html',
    'public-index-vps.html',
]);

const CSS_TAG = '    <!-- Chat Widget BOB AI -->\n    <link rel="stylesheet" href="/chat/widget.css?v=20260218">';
const JS_TAG  = '    <!-- Chat Widget BOB AI -->\n    <script src="/chat/widget.js?v=20260218" defer><\/script>';

const excludePatterns = ['node_modules','_backup','_backups','backups/','.git/','android','Login-Page','Zyntra','chat/public','chat\\public','emails-sge','templates/','ajuda/','dashboard-modern','build/','importar-ponto_backup','importar-ponto_new'];

function shouldExclude(relPath) {
    const r = relPath.replace(/\\/g,'/');
    return excludePatterns.some(p => r.includes(p));
}

function walk(dir, depth) {
    let results = [];
    if (depth > 6) return results;
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            if (item.startsWith('_') && dir === base) continue;
            if (item === 'desktop.ini') continue;
            const full = path.join(dir, item);
            const rel = path.relative(base, full);
            if (shouldExclude(rel)) continue;
            try {
                const stat = fs.statSync(full);
                if (stat.isDirectory()) results = results.concat(walk(full, depth+1));
                else if (item.endsWith('.html')) results.push(full);
            } catch(e) {}
        }
    } catch(e) {}
    return results;
}

const all = walk(base, 0);
let injected = 0;
let skippedAlready = 0;
let skippedExplicit = 0;
let skippedNoStructure = 0;
const injectedFiles = [];
const deployFiles = [];

for (const f of all) {
    const rel = path.relative(base, f).replace(/\\/g, '/');
    
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch(e) { continue; }
    
    // Already has chat
    if (content.includes('widget.js')) {
        skippedAlready++;
        continue;
    }
    
    // Explicitly skipped
    if (skipFiles.has(rel)) {
        skippedExplicit++;
        continue;
    }
    
    // Must be a full HTML page with </head> and </body>
    if (!content.includes('</head>') || !content.includes('</body>')) {
        skippedNoStructure++;
        log('SKIP (no structure): ' + rel);
        continue;
    }
    
    // Inject CSS before </head>
    if (!content.includes('widget.css')) {
        content = content.replace('</head>', CSS_TAG + '\n</head>');
    }
    
    // Inject JS before </body>
    content = content.replace('</body>', JS_TAG + '\n</body>');
    
    fs.writeFileSync(f, content, 'utf8');
    injected++;
    injectedFiles.push(rel);
    deployFiles.push(f);
    log('INJECTED: ' + rel);
}

log('');
log('=== RESUMO ===');
log('Total HTMLs: ' + all.length);
log('Ja tinham chat: ' + skippedAlready);
log('Pulados (demos/refs): ' + skippedExplicit);
log('Pulados (sem estrutura): ' + skippedNoStructure);
log('Injetados: ' + injected);
log('');
log('=== LISTA PARA DEPLOY ===');
injectedFiles.forEach(f => log(f));

// Also save deploy file list for batch SCP
const deployListFile = path.join(base, 'scripts_auxiliares', 'chat-deploy-list.txt');
fs.writeFileSync(deployListFile, injectedFiles.join('\n'), 'utf8');

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
