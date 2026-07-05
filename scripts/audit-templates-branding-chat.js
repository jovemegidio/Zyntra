#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join('auditorias', 'templates-branding-chat');
const DEFAULT_DATE = '2026-05-23';

const AUDIT_ROOTS = [
  'public',
  'modules',
  'routes',
  'server',
  'src',
  'api',
  'chat',
  'database',
];

const IGNORE_PARTS = [
  '.git',
  '.venv',
  '.venvv',
  'node_modules',
  'node_modules_broken',
  'node_modules_corrupt',
  'node_modules_partial',
  'dist',
  'dist-electron',
  'uploads',
  'storage',
  'logs',
  'test-results',
  '_Zyntra_Legacy',
  'Base',
  'backup-vps-20260323',
  'backup-auditoria-20260327-233238',
  'modules/Financeiro_backup_20260319',
  'public/Ajuda-Aluforce',
  'modules/RH/public_backup',
  'modules/Compras/backup-pre-css-standard',
];

const PAGE_EXTENSIONS = new Set(['.html', '.ejs', '.hbs']);
const SOURCE_EXTENSIONS = new Set(['.js', '.css', '.html', '.ejs', '.hbs']);

function parseArgs(argv) {
  const opts = {
    scope: 'all',
    outDir: DEFAULT_OUT_DIR,
    date: DEFAULT_DATE,
    verbose: false,
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--scope=')) opts.scope = arg.split('=')[1] || opts.scope;
    if (arg.startsWith('--out-dir=')) opts.outDir = arg.split('=').slice(1).join('=') || opts.outDir;
    if (arg.startsWith('--date=')) opts.date = arg.split('=')[1] || opts.date;
    if (arg === '--verbose') opts.verbose = true;
  });

  if (!['all', 'templates', 'branding', 'chat'].includes(opts.scope)) {
    throw new Error(`Invalid scope: ${opts.scope}`);
  }

  return opts;
}

function normalizeRel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function isIgnored(relPath) {
  const lower = relPath.toLowerCase();
  const segments = lower.split('/');
  if (segments.some((segment) => (
    segment.includes('backup') ||
    segment.includes('broken') ||
    segment.includes('corrupt') ||
    segment.includes('partial') ||
    segment === 'screenshots'
  ))) {
    return true;
  }

  return IGNORE_PARTS.some((part) => {
    const normalized = part.replace(/\\/g, '/').toLowerCase();
    return lower === normalized || lower.startsWith(`${normalized}/`) || lower.includes(`/${normalized}/`);
  });
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const rel = normalizeRel(fullPath);
    if (isIgnored(rel)) continue;

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function collectFiles() {
  const files = [];

  for (const root of AUDIT_ROOTS) {
    walk(path.join(ROOT, root), files);
  }

  if (fs.existsSync(path.join(ROOT, 'server.js'))) files.push(path.join(ROOT, 'server.js'));
  return Array.from(new Set(files));
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return '';
  }
}

function has(content, patterns) {
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(content);
    return content.toLowerCase().includes(String(pattern).toLowerCase());
  });
}

function countMatches(content, regex) {
  return (content.match(regex) || []).length;
}

function scoreFromChecks(checks) {
  const total = checks.length;
  const ok = checks.filter((check) => check.ok).length;
  return total === 0 ? 100 : Math.round((ok / total) * 100);
}

function statusFromScore(score) {
  if (score >= 95) return 'OK';
  if (score >= 85) return 'BOM';
  if (score >= 70) return 'ATENCAO';
  return 'FALHA';
}

function makeIssue(file, area, severity, message, check) {
  return { file, area, severity, message, check };
}

function isDocumentTemplate(rel) {
  const lower = rel.toLowerCase();
  const name = path.basename(lower);
  return (
    lower.includes('/templates/') ||
    name.includes('template') ||
    name.includes('danfe') ||
    name.includes('orcamento') ||
    name.includes('orcamentos') ||
    name.includes('pedido') ||
    name.includes('pedidos') ||
    name.includes('relatorio') ||
    name.includes('relatorios') ||
    name.includes('ordem') ||
    name.includes('ordens')
  );
}

function isAppPage(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (!PAGE_EXTENSIONS.has(ext)) return false;
  if (isIgnored(rel)) return false;
  const lower = rel.toLowerCase();
  if (lower.includes('/templates/')) return false;
  if (lower.includes('/_not-found/')) return false;
  if (lower.includes('/artigos/') || lower.includes('/colecoes/')) return false;
  return lower.startsWith('public/') || lower.startsWith('modules/') || lower.startsWith('routes/');
}

function classifyTemplate(rel, content) {
  const lower = `${rel}\n${content}`.toLowerCase();
  if (lower.includes('danfe') || lower.includes('nota fiscal')) return 'DANFE';
  if (lower.includes('orcamento') || lower.includes('orçamento')) return 'ORCAMENTO';
  if (lower.includes('pedido')) return 'PEDIDO';
  if (lower.includes('ordem de producao') || lower.includes('ordem de produção')) return 'ORDEM_PRODUCAO';
  if (lower.includes('relatorio') || lower.includes('relatório')) return 'RELATORIO';
  return 'DOCUMENTO';
}

function auditTemplates(files) {
  const htmlFiles = files
    .filter((file) => PAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => ({ file, rel: normalizeRel(file), content: readText(file) }))
    .filter(({ rel }) => isDocumentTemplate(rel));

  const results = [];
  const issues = [];

  for (const item of htmlFiles) {
    const type = classifyTemplate(item.rel, item.content);
    const checks = [
      {
        id: 'logo',
        label: 'Logo ou marca no cabecalho',
        ok: has(item.content, [
          /<img[^>]+(?:logo|zyntra|aluforce|labor|empresa)/i,
          /class=["'][^"']*logo/i,
          'Logo Monocromatico',
          'zyntra-logo',
          'aluforce-logo',
        ]),
        severity: 'ALTA',
      },
      {
        id: 'company',
        label: 'Dados ou nome da empresa',
        ok: has(item.content, ['Aluforce', 'Zyntra', 'Labor Energy', 'Labor Eletric', 'empresa', 'razao', 'cnpj']),
        severity: 'ALTA',
      },
      {
        id: 'title',
        label: 'Titulo do documento',
        ok: has(item.content, [/<h1[\s>]/i, /<h2[\s>]/i, /<title[\s>]/i, 'DANFE', 'ORCAMENTO', 'PEDIDO', 'RELATORIO', 'ORDEM']),
        severity: 'ALTA',
      },
      {
        id: 'date',
        label: 'Campo de data/emissao',
        ok: has(item.content, ['data', 'emissao', 'emissão', 'createdAt', 'new Date', 'toLocaleDateString']),
        severity: 'MEDIA',
      },
      {
        id: 'table',
        label: 'Tabela ou lista estruturada de itens',
        ok: has(item.content, [/<table[\s>]/i, '<thead', '<tbody', 'grid-template-columns', 'itens', 'produtos']),
        severity: ['ORCAMENTO', 'PEDIDO', 'DANFE', 'RELATORIO', 'ORDEM_PRODUCAO'].includes(type) ? 'ALTA' : 'BAIXA',
      },
      {
        id: 'totals',
        label: 'Totalizadores ou resumo',
        ok: has(item.content, ['subtotal', 'total', 'valor_total', 'valor total', 'totais']),
        severity: ['ORCAMENTO', 'PEDIDO', 'DANFE'].includes(type) ? 'ALTA' : 'MEDIA',
      },
      {
        id: 'footer',
        label: 'Rodape/assinatura/observacoes',
        ok: has(item.content, [/<footer[\s>]/i, 'rodape', 'rodapé', 'assinatura', 'observacoes', 'observações']),
        severity: 'MEDIA',
      },
      {
        id: 'css',
        label: 'CSS inline ou stylesheet',
        ok: has(item.content, [/<style[\s>]/i, /rel=["']stylesheet["']/i, '.css']),
        severity: 'MEDIA',
      },
      {
        id: 'print',
        label: 'Regra de impressao/PDF',
        ok: has(item.content, ['@media print', 'page-break', 'break-inside', 'print']),
        severity: ['ORCAMENTO', 'PEDIDO', 'DANFE', 'RELATORIO', 'ORDEM_PRODUCAO'].includes(type) ? 'MEDIA' : 'BAIXA',
      },
    ];

    const score = scoreFromChecks(checks);
    const status = statusFromScore(score);
    const failed = checks.filter((check) => !check.ok);

    failed.forEach((check) => {
      issues.push(makeIssue(item.rel, 'templates', check.severity, `${check.label} nao identificado`, check.id));
    });

    results.push({
      file: item.rel,
      type,
      score,
      status,
      checks: checks.map(({ id, label, ok, severity }) => ({ id, label, ok, severity })),
    });
  }

  return {
    total: results.length,
    compliant: results.filter((item) => item.status === 'OK' || item.status === 'BOM').length,
    nonCompliant: results.filter((item) => item.status === 'FALHA').length,
    attention: results.filter((item) => item.status === 'ATENCAO').length,
    score: scoreFromChecks(results.map((item) => ({ ok: item.status === 'OK' || item.status === 'BOM' }))),
    results,
    issues,
  };
}

function auditBranding(files) {
  const pages = files
    .filter((file) => isAppPage(normalizeRel(file)))
    .map((file) => ({ file, rel: normalizeRel(file), content: readText(file) }));

  const results = [];
  const issues = [];

  for (const page of pages) {
    const checks = [
      {
        id: 'logo',
        label: 'Logo ou imagem de marca',
        ok: has(page.content, [
          /<img[^>]+(?:logo|zyntra|aluforce|labor)/i,
          'logo-section',
          'header-logo',
          'zyntra-logo',
          'aluforce-logo',
          'Logo Monocromatico',
        ]),
        severity: 'ALTA',
      },
      {
        id: 'brand_name',
        label: 'Nome de marca/sistema/empresa',
        ok: has(page.content, ['Zyntra', 'Aluforce', 'Labor Energy', 'Labor Eletric', 'ERP', 'Sistema']),
        severity: 'ALTA',
      },
      {
        id: 'header',
        label: 'Header/topbar/navbar',
        ok: has(page.content, ['topbar', '<header', 'navbar', 'header-logo', 'dashboard-header', 'app-header']),
        severity: 'MEDIA',
      },
      {
        id: 'sidebar',
        label: 'Sidebar/menu principal',
        ok: has(page.content, ['sidebar', 'side-menu', 'menu-toggle', 'nav-link', 'navigation', 'Navegacao']),
        severity: 'MEDIA',
      },
      {
        id: 'colors',
        label: 'Paleta ou variaveis visuais',
        ok: has(page.content, ['--primary', '--brand', '#', 'gradient', 'background:', 'color:', 'aluforce']),
        severity: 'MEDIA',
      },
      {
        id: 'title',
        label: 'Titulo da pagina',
        ok: has(page.content, [/<title[\s>]/i, /<h1[\s>]/i, 'page-title', 'module-title']),
        severity: 'MEDIA',
      },
      {
        id: 'user_actions',
        label: 'Area de usuario/acoes',
        ok: has(page.content, ['user-menu', 'avatar', 'logout', 'notific', 'perfil', 'Sair']),
        severity: 'BAIXA',
      },
    ];

    const score = scoreFromChecks(checks);
    const status = statusFromScore(score);

    checks.filter((check) => !check.ok).forEach((check) => {
      issues.push(makeIssue(page.rel, 'branding', check.severity, `${check.label} nao identificado`, check.id));
    });

    results.push({
      file: page.rel,
      score,
      status,
      checks: checks.map(({ id, label, ok, severity }) => ({ id, label, ok, severity })),
    });
  }

  return {
    total: results.length,
    compliant: results.filter((item) => item.status === 'OK' || item.status === 'BOM').length,
    nonCompliant: results.filter((item) => item.status === 'FALHA').length,
    attention: results.filter((item) => item.status === 'ATENCAO').length,
    score: scoreFromChecks(results.map((item) => ({ ok: item.status === 'OK' || item.status === 'BOM' }))),
    results,
    issues,
  };
}

function auditChat(files) {
  const pages = files
    .filter((file) => isAppPage(normalizeRel(file)))
    .map((file) => ({ file, rel: normalizeRel(file), content: readText(file) }));

  const widgetJsPath = path.join(ROOT, 'public', 'chat-teams', 'chat-widget.js');
  const widgetCssPath = path.join(ROOT, 'public', 'chat-teams', 'chat-widget.css');
  const widgetJs = readText(widgetJsPath);
  const backendFiles = files
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => ({ rel: normalizeRel(file), content: readText(file) }))
    .filter((item) => has(item.content, ['/api/chat', 'chat:', 'socket.io', 'chat_messages', 'chat_conversations']));

  const globalChecks = [
    {
      id: 'widget_js',
      label: 'Widget JS existe',
      ok: fs.existsSync(widgetJsPath),
      severity: 'CRITICA',
    },
    {
      id: 'widget_css',
      label: 'Widget CSS existe',
      ok: fs.existsSync(widgetCssPath),
      severity: 'ALTA',
    },
    {
      id: 'fab',
      label: 'Botao flutuante do chat no widget',
      ok: has(widgetJs, ['ct-fab', 'Zyntra Chat']),
      severity: 'CRITICA',
    },
    {
      id: 'panel',
      label: 'Janela/painel do chat no widget',
      ok: has(widgetJs, ['ct-panel', 'ct-messages', 'ct-input']),
      severity: 'CRITICA',
    },
    {
      id: 'send',
      label: 'Entrada e envio de mensagem',
      ok: has(widgetJs, ['ct-btn-send', 'textarea', 'keydown', 'Enter']),
      severity: 'ALTA',
    },
    {
      id: 'realtime',
      label: 'Integracao realtime/socket',
      ok: has(widgetJs, ['socket.emit', 'io(', 'typing', 'chat:']),
      severity: 'ALTA',
    },
    {
      id: 'backend',
      label: 'Backend/tabelas de chat encontrados',
      ok: backendFiles.length > 0,
      severity: 'ALTA',
    },
  ];

  const results = [];
  const issues = [];

  for (const page of pages) {
    const hasDirectChat = has(page.content, ['chat-widget.js', 'chat-teams', 'ct-fab', 'ct-panel']);
    const hasSharedHint = has(page.content, ['header-sidebar', 'layout-template', 'shared', 'auth-unified']);
    const checks = [
      {
        id: 'chat_script',
        label: 'Referencia estatica ao widget de chat',
        ok: hasDirectChat,
        severity: 'ALTA',
      },
      {
        id: 'layout_hint',
        label: 'Layout compartilhado ou camada comum',
        ok: hasSharedHint || hasDirectChat,
        severity: 'MEDIA',
      },
      {
        id: 'auth_context',
        label: 'Contexto de autenticacao para abrir chat',
        ok: has(page.content, ['auth', 'token', 'userData', 'AluforceAuth', 'sessionStorage', 'localStorage']),
        severity: 'MEDIA',
      },
    ];

    const score = scoreFromChecks(checks);
    const status = statusFromScore(score);

    checks.filter((check) => !check.ok).forEach((check) => {
      issues.push(makeIssue(page.rel, 'chat', check.severity, `${check.label} nao identificado`, check.id));
    });

    results.push({
      file: page.rel,
      chatReference: hasDirectChat,
      sharedLayoutHint: hasSharedHint,
      score,
      status,
      checks: checks.map(({ id, label, ok, severity }) => ({ id, label, ok, severity })),
    });
  }

  globalChecks.filter((check) => !check.ok).forEach((check) => {
    issues.push(makeIssue('global', 'chat', check.severity, `${check.label} nao identificado`, check.id));
  });

  return {
    total: results.length,
    pagesWithStaticChat: results.filter((item) => item.chatReference).length,
    pagesWithSharedLayoutHint: results.filter((item) => item.sharedLayoutHint).length,
    globalScore: scoreFromChecks(globalChecks),
    score: scoreFromChecks(results.map((item) => ({ ok: item.chatReference }))),
    results,
    globalChecks: globalChecks.map(({ id, label, ok, severity }) => ({ id, label, ok, severity })),
    backendEvidence: backendFiles.slice(0, 30).map((item) => item.rel),
    issues,
  };
}

function buildMatrix(templates, branding, chat) {
  const templateMap = new Map(templates.results.map((item) => [item.file, item]));
  const chatMap = new Map(chat.results.map((item) => [item.file, item]));

  return branding.results.map((page) => {
    const tpl = templateMap.get(page.file);
    const ch = chatMap.get(page.file);
    return {
      modulo: page.file.split('/')[0] || '-',
      pagina: page.file,
      template: tpl ? tpl.status : 'N/A',
      branding: page.status,
      chat: ch ? (ch.chatReference ? 'OK' : 'FALHA') : 'N/A',
      status: page.status === 'FALHA' || (ch && !ch.chatReference) ? 'FALHA' : page.status,
    };
  });
}

function severityWeight(severity) {
  return { CRITICA: 4, ALTA: 3, MEDIA: 2, BAIXA: 1 }[severity] || 0;
}

function buildMarkdown(report) {
  const lines = [];
  const allIssues = [...report.templates.issues, ...report.branding.issues, ...report.chat.issues]
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
    .slice(0, 80);

  lines.push('# Relatorio de Auditoria - Templates, Branding e Chat');
  lines.push('');
  lines.push(`**Data:** ${report.date}`);
  lines.push('**Escopo:** Auditoria estatica local de templates, branding e chat');
  lines.push('**Sistema:** Zyntra ERP Multi-Company');
  lines.push('');
  lines.push('## Sumario executivo');
  lines.push('');
  lines.push(`Foram auditados ${report.templates.total} templates/documentos, ${report.branding.total} paginas de aplicacao e ${report.chat.total} paginas para cobertura estatica do chat. O score geral calculado foi ${report.qualityScore}%.`);
  lines.push('');
  lines.push('## Metricas');
  lines.push('');
  lines.push('| Area | Total | OK/Bom | Atencao | Falha | Score |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  lines.push(`| Templates | ${report.templates.total} | ${report.templates.compliant} | ${report.templates.attention} | ${report.templates.nonCompliant} | ${report.templates.score}% |`);
  lines.push(`| Branding | ${report.branding.total} | ${report.branding.compliant} | ${report.branding.attention} | ${report.branding.nonCompliant} | ${report.branding.score}% |`);
  lines.push(`| Chat estatico | ${report.chat.total} | ${report.chat.pagesWithStaticChat} com script direto | ${report.chat.pagesWithSharedLayoutHint} com hint de layout | ${report.chat.total - report.chat.pagesWithStaticChat} sem script direto | ${report.chat.score}% |`);
  lines.push(`| Chat global | ${report.chat.globalChecks.length} checks | ${report.chat.globalChecks.filter((c) => c.ok).length} | - | ${report.chat.globalChecks.filter((c) => !c.ok).length} | ${report.chat.globalScore}% |`);
  lines.push('');
  lines.push('## Checks globais do chat');
  lines.push('');
  lines.push('| Check | Status | Severidade |');
  lines.push('|---|---|---|');
  report.chat.globalChecks.forEach((check) => {
    lines.push(`| ${check.label} | ${check.ok ? 'OK' : 'FALHA'} | ${check.severity} |`);
  });
  lines.push('');
  lines.push('## Principais nao conformidades');
  lines.push('');
  if (allIssues.length === 0) {
    lines.push('Nenhuma nao conformidade identificada pelos checks estaticos.');
  } else {
    lines.push('| Severidade | Area | Arquivo | Achado |');
    lines.push('|---|---|---|---|');
    allIssues.forEach((issue) => {
      lines.push(`| ${issue.severity} | ${issue.area} | ${issue.file} | ${issue.message} |`);
    });
  }
  lines.push('');
  lines.push('## Amostra da matriz');
  lines.push('');
  lines.push('| Pagina | Template | Branding | Chat | Status |');
  lines.push('|---|---|---|---|---|');
  report.matrix.slice(0, 60).forEach((row) => {
    lines.push(`| ${row.pagina} | ${row.template} | ${row.branding} | ${row.chat} | ${row.status} |`);
  });
  lines.push('');
  lines.push('## Observacoes');
  lines.push('');
  lines.push('- Esta auditoria e estatica: ela valida arquivos, referencias e padroes, mas nao substitui um teste Playwright com servidor e login reais.');
  lines.push('- Paginas sem referencia direta ao `chat-widget.js` foram marcadas como falha de cobertura estatica mesmo que o servidor possa injetar o widget em runtime.');
  lines.push('- Backups, node_modules, uploads, logs e artigos de ajuda foram excluidos para reduzir ruido.');
  lines.push('');
  lines.push('## Arquivos gerados');
  lines.push('');
  lines.push('- `audit-full-report.json`');
  lines.push('- `audit-templates-report.json`');
  lines.push('- `audit-branding-report.json`');
  lines.push('- `audit-chat-report.json`');
  lines.push('- `audit-validation-matrix.json`');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function runAudit(options = {}) {
  const opts = {
    scope: 'all',
    outDir: DEFAULT_OUT_DIR,
    date: DEFAULT_DATE,
    verbose: false,
    ...options,
  };

  const outDirAbs = path.resolve(ROOT, opts.outDir);
  ensureDir(outDirAbs);

  const files = collectFiles();
  const templates = opts.scope === 'all' || opts.scope === 'templates'
    ? auditTemplates(files)
    : { total: 0, compliant: 0, nonCompliant: 0, attention: 0, score: 0, results: [], issues: [] };
  const branding = opts.scope === 'all' || opts.scope === 'branding'
    ? auditBranding(files)
    : { total: 0, compliant: 0, nonCompliant: 0, attention: 0, score: 0, results: [], issues: [] };
  const chat = opts.scope === 'all' || opts.scope === 'chat'
    ? auditChat(files)
    : { total: 0, pagesWithStaticChat: 0, pagesWithSharedLayoutHint: 0, globalScore: 0, score: 0, results: [], globalChecks: [], backendEvidence: [], issues: [] };

  const matrix = opts.scope === 'all' ? buildMatrix(templates, branding, chat) : [];
  const scoreParts = [templates.score, branding.score, chat.score, chat.globalScore].filter((score) => Number.isFinite(score) && score > 0);
  const qualityScore = scoreParts.length ? Math.round(scoreParts.reduce((sum, score) => sum + score, 0) / scoreParts.length) : 0;

  const report = {
    date: opts.date,
    generatedAt: new Date().toISOString(),
    scope: opts.scope,
    root: ROOT,
    qualityScore,
    templates,
    branding,
    chat,
    matrix,
  };

  if (opts.scope === 'all' || opts.scope === 'templates') {
    writeJson(path.join(outDirAbs, 'audit-templates-report.json'), templates);
  }
  if (opts.scope === 'all' || opts.scope === 'branding') {
    writeJson(path.join(outDirAbs, 'audit-branding-report.json'), branding);
  }
  if (opts.scope === 'all' || opts.scope === 'chat') {
    writeJson(path.join(outDirAbs, 'audit-chat-report.json'), chat);
  }
  if (opts.scope === 'all') {
    writeJson(path.join(outDirAbs, 'audit-validation-matrix.json'), matrix);
    writeJson(path.join(outDirAbs, 'audit-full-report.json'), report);
    fs.writeFileSync(
      path.join(outDirAbs, `RELATORIO-AUDITORIA-TEMPLATES-BRANDING-CHAT-${opts.date}.md`),
      buildMarkdown(report),
      'utf8',
    );
  }

  if (opts.verbose || require.main === module) {
    console.log(`Scope: ${opts.scope}`);
    console.log(`Templates: ${templates.total} auditados, score ${templates.score}%`);
    console.log(`Branding: ${branding.total} paginas, score ${branding.score}%`);
    console.log(`Chat: ${chat.pagesWithStaticChat}/${chat.total} paginas com script direto, score ${chat.score}%`);
    console.log(`Score geral: ${qualityScore}%`);
    console.log(`Relatorios: ${path.relative(ROOT, outDirAbs)}`);
  }

  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await runAudit(opts);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runAudit,
  auditTemplates,
  auditBranding,
  auditChat,
};
