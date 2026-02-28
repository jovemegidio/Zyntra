/**
 * Script para padronizar TODAS as sidebars do módulo RH
 * Referência: modules/RH/public/pages/gestao-ponto.html
 * 
 * - pages/ level: links relativos diretos (ferias.html, ../areaadm.html, etc.)
 * - public/ level: links com prefixo pages/ (pages/ferias.html, areaadm.html, etc.)
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'modules', 'RH');

// ── Build sidebar HTML ────────────────────────────────────────────────
function buildSidebar(navLinks, bottomLinks, activeHref, baseIndent = '') {
    const i1 = baseIndent;
    const i2 = baseIndent + '    ';
    const i3 = baseIndent + '        ';
    
    let html = `${i1}<aside class="sidebar" id="mobile-sidebar">\n`;
    html += `${i2}<a href="/dashboard" class="sidebar-logo" title="Voltar ao Painel de Controle"><i class="fas fa-home"></i></a>\n`;
    html += `${i2}<nav class="sidebar-nav">\n`;
    
    for (const link of navLinks) {
        const cls = link.href === activeHref ? 'sidebar-btn active' : 'sidebar-btn';
        html += `${i3}<a href="${link.href}" class="${cls}" title="${link.title}"><i class="fas ${link.icon}"></i></a>\n`;
    }
    
    html += `${i2}</nav>\n`;
    html += `${i2}<div class="sidebar-bottom">\n`;
    
    for (const link of bottomLinks) {
        const cls = link.href === activeHref ? 'sidebar-btn active' : 'sidebar-btn';
        html += `${i3}<a href="${link.href}" class="${cls}" title="${link.title}"><i class="fas ${link.icon}"></i></a>\n`;
    }
    
    html += `${i2}</div>\n`;
    html += `${i1}</aside>`;
    
    return html;
}

// ── Sidebar templates ─────────────────────────────────────────────────

// For files in modules/RH/public/pages/
function makePagesSidebar(activeHref, baseIndent) {
    const nav = [
        { href: '../areaadm.html',          title: 'Dashboard RH',              icon: 'fa-chart-pie' },
        { href: 'funcionarios.html',        title: 'Funcionários',              icon: 'fa-users' },
        { href: '../gestao-holerites.html', title: 'Gestão de Holerites',       icon: 'fa-file-invoice-dollar' },
        { href: 'gestao-ponto.html',        title: 'Gestão do Ponto',           icon: 'fa-clock' },
        { href: 'importar-ponto.html',      title: 'Importar Ponto (Control iD)', icon: 'fa-upload' },
        { href: 'ferias.html',              title: 'Férias',                    icon: 'fa-umbrella-beach' },
        { href: 'folha.html',               title: 'Folha de Pagamento',        icon: 'fa-money-bill-wave' },
        { href: 'beneficios.html',          title: 'Benefícios',               icon: 'fa-gift' },
        { href: 'calendario-rh.html',       title: 'Calendário RH',            icon: 'fa-calendar-alt' },
    ];
    const bottom = [
        { href: 'avaliacoes.html',          title: 'Avaliações',               icon: 'fa-star' },
        { href: '../funcionario.html',      title: 'Portal do Funcionário',    icon: 'fa-user' },
    ];
    return buildSidebar(nav, bottom, activeHref, baseIndent);
}

// For files in modules/RH/public/
function makePublicSidebar(activeHref, baseIndent) {
    const nav = [
        { href: 'areaadm.html',              title: 'Dashboard RH',              icon: 'fa-chart-pie' },
        { href: 'pages/funcionarios.html',    title: 'Funcionários',              icon: 'fa-users' },
        { href: 'gestao-holerites.html',      title: 'Gestão de Holerites',       icon: 'fa-file-invoice-dollar' },
        { href: 'pages/gestao-ponto.html',    title: 'Gestão do Ponto',           icon: 'fa-clock' },
        { href: 'pages/importar-ponto.html',  title: 'Importar Ponto (Control iD)', icon: 'fa-upload' },
        { href: 'pages/ferias.html',          title: 'Férias',                    icon: 'fa-umbrella-beach' },
        { href: 'pages/folha.html',           title: 'Folha de Pagamento',        icon: 'fa-money-bill-wave' },
        { href: 'pages/beneficios.html',      title: 'Benefícios',               icon: 'fa-gift' },
        { href: 'pages/calendario-rh.html',   title: 'Calendário RH',            icon: 'fa-calendar-alt' },
    ];
    const bottom = [
        { href: 'pages/avaliacoes.html',      title: 'Avaliações',               icon: 'fa-star' },
        { href: 'funcionario.html',           title: 'Portal do Funcionário',    icon: 'fa-user' },
    ];
    return buildSidebar(nav, bottom, activeHref, baseIndent);
}

// ── File → active href mapping ────────────────────────────────────────

// pages/ level files (skip gestao-ponto.html — it's the reference)
const pagesFiles = {
    'holerites.html':           null,
    'manual-colaborador.html':  null,
    'importar-ponto.html':      'importar-ponto.html',
    'meus-holerites.html':      null,
    'gestao-solicitacoes.html': null,
    'ponto.html':               'gestao-ponto.html',
    'funcionarios.html':        'funcionarios.html',
    'folha.html':               'folha.html',
    'espelho-ponto.html':       null,
    'ferias.html':              'ferias.html',
    'enviar-atestado.html':     null,
    'avaliacoes.html':          'avaliacoes.html',
    'calendario-rh.html':       'calendario-rh.html',
    'dados-cadastrais.html':    null,
    'dashboard.html':           '../areaadm.html',
    'beneficios.html':          'beneficios.html',
};

// public/ level files (skip index.html — redirect page)
const publicFiles = {
    'funcionario.html':      'funcionario.html',
    'treinamentos.html':     null,
    'areaadm.html':          'areaadm.html',
    'gestao-holerites.html': 'gestao-holerites.html',
    'solicitacoes.html':     null,
    'dados-pessoais.html':   null,
};

// ── Process files ─────────────────────────────────────────────────────

const sidebarRegex = /([ \t]*)<aside\s+class="sidebar"[^>]*>[\s\S]*?<\/aside>/;

function processFile(filePath, sidebarFactory, activeHref) {
    const name = path.basename(filePath);
    
    if (!fs.existsSync(filePath)) {
        return `SKIP: ${name} (arquivo não encontrado)`;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(sidebarRegex);
    
    if (!match) {
        return `SKIP: ${name} (nenhuma sidebar encontrada)`;
    }
    
    const baseIndent = match[1] || '';  // preserve original indentation
    const newSidebar = sidebarFactory(activeHref, baseIndent);
    content = content.replace(sidebarRegex, newSidebar);
    fs.writeFileSync(filePath, content, 'utf8');
    
    return `OK: ${name} (active: ${activeHref || 'nenhum'})`;
}

const results = [];

console.log('=== Padronização de Sidebars RH ===\n');

// pages/ level
console.log('--- pages/ level ---');
for (const [file, activeHref] of Object.entries(pagesFiles)) {
    const filePath = path.join(BASE, 'public', 'pages', file);
    const result = processFile(filePath, makePagesSidebar, activeHref);
    results.push(result);
    console.log(result);
}

// public/ level
console.log('\n--- public/ level ---');
for (const [file, activeHref] of Object.entries(publicFiles)) {
    const filePath = path.join(BASE, 'public', file);
    const result = processFile(filePath, makePublicSidebar, activeHref);
    results.push(result);
    console.log(result);
}

const okCount = results.filter(r => r.startsWith('OK')).length;
const skipCount = results.filter(r => r.startsWith('SKIP')).length;
console.log(`\n=== Resultado: ${okCount} atualizados, ${skipCount} pulados de ${results.length} total ===`);
