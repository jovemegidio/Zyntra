#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ROOT = process.cwd();
const DEFAULT_DATE = '2026-05-23';
const DEFAULT_OUT_DIR = path.join('auditorias', 'analise-modulos');
const MAX_JS_CHECKS_PER_MODULE = 80;

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
  'Claude Relatorio',
  'Fotos Colaboradores - Atualizada',
  'backup-vps-20260323',
  'backup-auditoria-20260327-233238',
  'modules/Financeiro_backup_20260319',
];

const MODULES = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    url: '/dashboard',
    roots: ['public/dashboard-v2', 'public/index.html', 'public/dashboard.js', 'public/dashboard.css', 'routes/dashboard-api.js', 'routes/api-hub-stats.js', 'routes/api-avisos.js', 'api/dashboard-executivo.js'],
    expectedPages: ['index.html'],
    expectedApiHints: ['dashboard', 'hub-stats', 'avisos'],
    integrationHints: ['compras', 'vendas', 'faturamento', 'financeiro', 'pcp', 'rh', 'logistica'],
  },
  {
    key: 'vendas',
    name: 'Vendas',
    url: '/Vendas/index.html',
    roots: ['modules/Vendas', 'routes/vendas-routes.js', 'routes/vendas-extended.js', 'modules/_shared/integracoes/vendas-faturamento.js', 'modules/_shared/integracoes/vendas-financeiro.js'],
    expectedPages: ['index.html', 'pedidos.html', 'clientes.html', 'relatorios.html'],
    expectedApiHints: ['pedidos', 'clientes', 'vendas', 'comissoes'],
    integrationHints: ['faturamento', 'financeiro', 'estoque', 'pcp'],
  },
  {
    key: 'faturamento',
    name: 'Faturamento',
    url: '/Faturamento',
    roots: ['modules/Faturamento', 'routes/documentos-fiscais.js', 'routes/api-fiscal-config.js', 'routes/api-nf-entrada.js', 'routes/danfe-renderer.js'],
    expectedPages: ['index.html', 'emitir.html', 'consultar.html', 'danfe.html', 'relatorios.html'],
    expectedApiHints: ['pedidos-aprovados', 'gerar-nfe', 'nfes', 'danfe', 'sefaz'],
    integrationHints: ['vendas', 'financeiro', 'estoque', 'nfe', 'sefaz'],
  },
  {
    key: 'financeiro',
    name: 'Financeiro',
    url: '/Financeiro',
    roots: ['modules/Financeiro', 'routes/financeiro-routes.js', 'routes/financeiro-core.js', 'routes/financeiro-extended.js', 'routes/integracao-bancaria.js', 'api/conciliacao-bancaria.js', 'src/routes/financeiro.js'],
    expectedPages: ['index.html', 'contas-receber.html', 'contas-pagar.html', 'fluxo-caixa.html', 'conciliacao.html', 'relatorios.html'],
    expectedApiHints: ['contas-receber', 'contas-pagar', 'fluxo-caixa', 'conciliacao', 'bancos'],
    integrationHints: ['vendas', 'compras', 'faturamento', 'bancaria'],
  },
  {
    key: 'pcp',
    name: 'PCP',
    url: '/PCP/index.html',
    roots: ['modules/PCP', 'routes/pcp-routes.js', 'routes/pcp', 'api/mrp-api.js', 'modules/_shared/integracoes/pcp-vendas.js'],
    expectedPages: ['index.html', 'ordens-producao.html', 'apontamentos.html', 'relatorios-apontamentos.html'],
    expectedApiHints: ['ordens', 'apontamentos', 'materiais', 'mrp', 'producao'],
    integrationHints: ['vendas', 'compras', 'estoque', 'faturamento'],
  },
  {
    key: 'compras',
    name: 'Compras',
    url: '/Compras/index.html',
    roots: ['modules/Compras', 'routes/compras-routes.js', 'routes/compras-extended.js', 'api/integracao-compras-financeiro.js', 'src/routes/compras.js'],
    expectedPages: ['index.html', 'pedidos.html', 'fornecedores.html', 'cotacoes.html', 'recebimento.html', 'relatorios.html'],
    expectedApiHints: ['pedidos', 'fornecedores', 'cotacoes', 'recebimento', 'requisicoes'],
    integrationHints: ['financeiro', 'estoque', 'pcp'],
  },
  {
    key: 'estoque',
    name: 'Estoque',
    url: '/dashboard-v2/estoque.html',
    roots: ['public/dashboard-v2/estoque.html', 'modules/Compras/gestao-estoque.html', 'modules/Compras/gestao-estoque.js', 'modules/Compras/api/estoque.js', 'routes/api-produtos.js', 'api/mrp-api.js'],
    expectedPages: ['estoque.html', 'gestao-estoque.html'],
    expectedApiHints: ['produtos', 'estoque', 'movimentacoes', 'inventario'],
    integrationHints: ['compras', 'vendas', 'pcp', 'faturamento'],
  },
  {
    key: 'rh',
    name: 'RH',
    url: '/RH/areaadm',
    roots: ['modules/RH', 'routes/rh-routes.js', 'routes/rh-extras.js', 'routes/rh-treinamentos.js', 'routes/rh-requisicoes-compra.js', 'api/ponto-routes.js', 'api/esocial.js', 'src/routes/rh_apis_completas.js'],
    expectedPages: ['areaadm.html', 'funcionario.html', 'gestao-holerites.html', 'treinamentos.html', 'pages/dashboard.html', 'pages/funcionarios.html'],
    expectedApiHints: ['funcionarios', 'holerites', 'ponto', 'treinamentos', 'esocial'],
    integrationHints: ['compras', 'financeiro', 'controlid'],
  },
  {
    key: 'admin',
    name: 'Admin',
    url: '/admin',
    roots: ['modules/Admin', 'public/admin', 'routes/auth-rbac.js', 'routes/companySettings.js', 'routes/audit-api.js', 'api/permissoes.js', 'src/routes/apiAdmin.js'],
    expectedPages: ['usuarios.html', 'permissoes.html', 'treinamentos.html'],
    expectedApiHints: ['usuarios', 'permissoes', 'empresa-config', 'audit'],
    integrationHints: ['rbac', 'auth', 'empresa', 'permissoes'],
  },
  {
    key: 'relatorios',
    name: 'Relatorios',
    url: '/relatorios',
    roots: ['api/relatorios-gerenciais.js', 'public/templates/relatorio-template.html', 'modules/Vendas/public/relatorios.html', 'modules/Financeiro/relatorios.html', 'modules/Compras/relatorios.html', 'modules/Faturamento/public/relatorios.html', 'modules/RH/public/pages/relatorios.html'],
    expectedPages: ['relatorios.html', 'relatorio-template.html'],
    expectedApiHints: ['relatorios', 'export', 'pdf', 'excel', 'csv'],
    integrationHints: ['vendas', 'financeiro', 'compras', 'rh', 'faturamento'],
  },
  {
    key: 'nfe',
    name: 'NFe',
    url: '/NFe',
    roots: ['modules/NFe', 'routes/nfe-routes.js', 'routes/nfe-api.js', 'src/nfe', 'modules/Faturamento/services'],
    expectedPages: ['index.html', 'emitir.html', 'consultar.html', 'danfe.html', 'eventos.html', 'inutilizacao.html'],
    expectedApiHints: ['nfe', 'sefaz', 'certificado', 'danfe', 'inutilizacao'],
    integrationHints: ['faturamento', 'sefaz', 'certificado', 'xml'],
  },
  {
    key: 'crm',
    name: 'CRM',
    url: '/Vendas/prospeccao',
    roots: ['modules/Vendas/public/prospeccao.html', 'modules/Vendas/public/clientes.html', 'routes/vendas-routes.js', 'routes/api-clientes.js', 'public/js/vendas-completo.js'],
    expectedPages: ['prospeccao.html', 'clientes.html'],
    expectedApiHints: ['clientes', 'prospeccao', 'crm', 'leads'],
    integrationHints: ['vendas', 'clientes', 'comercial'],
  },
  {
    key: 'logistica',
    name: 'Logistica',
    url: '/Logistica',
    roots: ['modules/Logistica', 'routes/logistica-routes.js', 'modules/Faturamento/public/logistica.html', 'modules/NFe/logistica.html'],
    expectedPages: ['index.html', 'logistica.html'],
    expectedApiHints: ['logistica', 'transportadoras', 'expedicao', 'entregas'],
    integrationHints: ['faturamento', 'nfe', 'vendas', 'transportadora'],
  },
];

function parseArgs(argv) {
  const opts = {
    module: 'all',
    outDir: DEFAULT_OUT_DIR,
    date: DEFAULT_DATE,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--module=')) opts.module = arg.split('=')[1].toLowerCase();
    if (arg.startsWith('--out-dir=')) opts.outDir = arg.split('=').slice(1).join('=');
    if (arg.startsWith('--date=')) opts.date = arg.split('=')[1];
    if (arg === '--verbose') opts.verbose = true;
  }

  return opts;
}

function normalizeRel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function absPath(relPath) {
  return path.resolve(ROOT, relPath);
}

function isIgnored(relPath) {
  const lower = relPath.replace(/\\/g, '/').toLowerCase();
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
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    files.push(dir);
    return files;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const rel = normalizeRel(fullPath);
    if (isIgnored(rel)) continue;

    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }

  return files;
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return '';
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function has(content, patterns) {
  const lower = content.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(content);
    return lower.includes(String(pattern).toLowerCase());
  });
}

function countRegex(content, regex) {
  return (content.match(regex) || []).length;
}

function severityWeight(severity) {
  return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[severity] || 0;
}

function issue(severity, category, title, evidence, recommendation, files = []) {
  return { severity, category, title, evidence, recommendation, files };
}

function statusFromScore(score) {
  if (score >= 95) return 'excellent';
  if (score >= 85) return 'good';
  if (score >= 70) return 'acceptable';
  return 'insufficient';
}

function scoreFromIssues(issues) {
  const penalty = issues.reduce((sum, item) => {
    return sum + ({ CRITICAL: 24, HIGH: 14, MEDIUM: 7, LOW: 3 }[item.severity] || 0);
  }, 0);
  return Math.max(0, 100 - penalty);
}

function collectModuleFiles(moduleConfig) {
  const files = [];
  const missingRoots = [];

  for (const root of moduleConfig.roots) {
    const full = absPath(root);
    if (!fs.existsSync(full)) {
      missingRoots.push(root);
      continue;
    }
    walk(full, files);
  }

  return {
    files: Array.from(new Set(files)).filter((file) => !isIgnored(normalizeRel(file))),
    missingRoots,
  };
}

function extractEndpoints(files) {
  const endpoints = [];
  const routeRegex = /\b(?:router|app)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.js') continue;
    const rel = normalizeRel(file);
    const content = readText(file);
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      endpoints.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: rel,
      });
    }
  }

  return endpoints;
}

function extractFrontendApiCalls(files) {
  const calls = [];
  const fetchRegex = /\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.js', '.html'].includes(ext)) continue;
    const rel = normalizeRel(file);
    const content = readText(file);
    let match;
    while ((match = fetchRegex.exec(content)) !== null) {
      calls.push({ url: match[1], file: rel });
    }
  }

  return calls;
}

function checkJsSyntax(files) {
  const jsFiles = files
    .filter((file) => path.extname(file).toLowerCase() === '.js')
    .slice(0, MAX_JS_CHECKS_PER_MODULE);

  const failures = [];
  for (const file of jsFiles) {
    try {
      childProcess.execFileSync(process.execPath, ['--check', file], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: ROOT,
        timeout: 10000,
      });
    } catch (err) {
      const message = Buffer.concat([
        err.stdout || Buffer.alloc(0),
        err.stderr || Buffer.alloc(0),
      ]).toString('utf8').trim().split('\n').slice(0, 5).join('\n');
      failures.push({ file: normalizeRel(file), message });
    }
  }
  return failures;
}

function localAssetExists(pageFile, assetRef) {
  if (!assetRef || assetRef.startsWith('#')) return true;
  if (/^(https?:|mailto:|tel:|data:|javascript:|about:)/i.test(assetRef)) return true;
  if (assetRef.includes('{{') || assetRef.includes('${') || assetRef.includes('<%')) return true;
  const rawRef = assetRef.split('?')[0].split('#')[0];
  let cleanRef = rawRef;
  try {
    cleanRef = decodeURIComponent(rawRef);
  } catch (err) {
    cleanRef = rawRef;
  }
  if (!cleanRef || cleanRef === '/') return true;

  if (cleanRef === '/socket.io/socket.io.js' || cleanRef.startsWith('/api/')) return true;

  const staticExts = new Set([
    '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.json', '.map',
  ]);
  const ext = path.extname(cleanRef).toLowerCase();
  if (!staticExts.has(ext)) return true;

  const mountedCandidates = [
    ['/images/', 'public/images'],
    ['/image/', 'public/image'],
    ['/assets/', 'assets'],
    ['/css/', 'public/css'],
    ['/js/', 'public/js'],
    ['/fonts/', 'public/fonts'],
    ['/icons/', 'public/icons'],
    ['/chat-teams/', 'public/chat-teams'],
    ['/Vendas/js/', 'modules/Vendas/public/js'],
    ['/Vendas/css/', 'modules/Vendas/public/css'],
    ['/Vendas/images/', 'modules/Vendas/public/images'],
    ['/Vendas/assets/', 'modules/Vendas/public/assets'],
    ['/Faturamento/', 'modules/Faturamento/public'],
    ['/Financeiro/js/', 'modules/Financeiro/js'],
    ['/Financeiro/css/', 'modules/Financeiro/css'],
    ['/Financeiro/', 'modules/Financeiro/public'],
    ['/Logistica/css/', 'modules/Logistica/css'],
    ['/Logistica/', 'modules/Logistica/public'],
    ['/Compras/', 'modules/Compras'],
    ['/PCP/', 'modules/PCP'],
    ['/NFe/', 'modules/NFe'],
    ['/RH/', 'modules/RH/public'],
    ['/RecursosHumanos/', 'modules/RH/public'],
    ['/_shared/', 'modules/_shared'],
    ['/modules/', 'modules'],
  ];

  if (cleanRef.startsWith('/')) {
    const candidates = [path.join(ROOT, 'public', cleanRef), path.join(ROOT, cleanRef.replace(/^\/+/, ''))];
    for (const [mount, target] of mountedCandidates) {
      if (cleanRef.startsWith(mount)) {
        candidates.push(path.join(ROOT, target, cleanRef.slice(mount.length)));
      }
    }
    return candidates.some((candidate) => fs.existsSync(candidate));
  }

  const directCandidate = path.resolve(path.dirname(pageFile), cleanRef);
  if (fs.existsSync(directCandidate)) return true;

  const relPage = normalizeRel(pageFile);
  const modulePublicFallbacks = [
    ['modules/Financeiro/public/', 'modules/Financeiro'],
    ['modules/Faturamento/public/', 'modules/Faturamento/public'],
    ['modules/Vendas/public/', 'modules/Vendas/public'],
    ['modules/RH/public/', 'modules/RH/public'],
    ['modules/Compras/', 'modules/Compras'],
  ];

  for (const [prefix, base] of modulePublicFallbacks) {
    if (relPage.startsWith(prefix)) {
      const fallback = path.join(ROOT, base, cleanRef);
      if (fs.existsSync(fallback)) return true;
      if (cleanRef.startsWith('css/')) {
        const moduleRootCss = path.join(ROOT, base.replace(/\/public$/, ''), cleanRef);
        if (fs.existsSync(moduleRootCss)) return true;
      }
      if (cleanRef.startsWith('js/')) {
        const moduleRootJs = path.join(ROOT, base.replace(/\/public$/, ''), cleanRef);
        if (fs.existsSync(moduleRootJs)) return true;
      }
    }
  }

  return false;
}

function findBrokenStaticReferences(files) {
  const refs = [];
  const refRegex = /\b(?:src|href)\s*=\s*['"`]([^'"`]+)['"`]/g;

  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.html') continue;
    const content = readText(file);
    let match;
    while ((match = refRegex.exec(content)) !== null) {
      const ref = match[1];
      if (ref.startsWith('/api/') || ref.endsWith('.html') || ref.startsWith('/dashboard') || ref.startsWith('/Vendas') || ref.startsWith('/Financeiro')) continue;
      if (!localAssetExists(file, ref)) {
        refs.push({ file: normalizeRel(file), ref });
      }
    }
  }

  return refs.slice(0, 40);
}

function expectedPageMatches(files, expectedPages) {
  const rels = files.map(normalizeRel);
  return expectedPages.map((pageName) => {
    const normalized = pageName.toLowerCase();
    const found = rels.find((rel) => rel.toLowerCase().endsWith(normalized));
    return { expected: pageName, found: found || null };
  });
}

function analyzeModule(moduleConfig, allServerContent) {
  const collected = collectModuleFiles(moduleConfig);
  const files = collected.files;
  const relFiles = files.map(normalizeRel);
  const sourceText = files.map(readText).join('\n');
  const htmlFiles = files.filter((file) => path.extname(file).toLowerCase() === '.html');
  const jsFiles = files.filter((file) => path.extname(file).toLowerCase() === '.js');
  const cssFiles = files.filter((file) => path.extname(file).toLowerCase() === '.css');
  const endpoints = extractEndpoints(files);
  const frontendApiCalls = extractFrontendApiCalls(files);
  const syntaxFailures = checkJsSyntax(files);
  const brokenStaticRefs = findBrokenStaticReferences(files);
  const pageMatches = expectedPageMatches(files, moduleConfig.expectedPages);
  const issues = [];

  if (files.length === 0) {
    issues.push(issue(
      'CRITICAL',
      'estrutura',
      'Nenhum arquivo ativo encontrado para o modulo',
      `Roots avaliados: ${moduleConfig.roots.join(', ')}`,
      'Confirmar se o modulo foi movido, renomeado ou ainda nao implementado. Atualizar rotas e dashboard conforme a arquitetura atual.',
      moduleConfig.roots,
    ));
  }

  if (collected.missingRoots.length > 0) {
    const severity = collected.missingRoots.length === moduleConfig.roots.length ? 'HIGH' : 'LOW';
    issues.push(issue(
      severity,
      'estrutura',
      'Roots esperados ausentes',
      collected.missingRoots.join(', '),
      'Remover paths obsoletos da documentacao ou criar o diretorio/arquivo esperado se ele ainda fizer parte do produto.',
      collected.missingRoots,
    ));
  }

  const missingPages = pageMatches.filter((item) => !item.found);
  if (missingPages.length > 0) {
    issues.push(issue(
      missingPages.length >= Math.ceil(moduleConfig.expectedPages.length / 2) ? 'MEDIUM' : 'LOW',
      'frontend',
      'Paginas esperadas nao localizadas',
      missingPages.map((item) => item.expected).join(', '),
      'Validar se as paginas foram substituidas por rotas dinamicas. Se nao foram, restaurar ou criar as paginas/listagens faltantes.',
      relFiles.filter((rel) => rel.endsWith('.html')).slice(0, 8),
    ));
  }

  if (htmlFiles.length === 0) {
    issues.push(issue(
      'HIGH',
      'frontend',
      'Nenhuma pagina HTML localizada',
      'O modulo nao possui HTML direto nos roots auditados.',
      'Verificar se o modulo depende de bundle externo ou rota server-side. Documentar o entrypoint real e adicionar teste de carregamento.',
      moduleConfig.roots,
    ));
  }

  if (jsFiles.length === 0) {
    issues.push(issue(
      'MEDIUM',
      'frontend/backend',
      'Nenhum JavaScript localizado',
      'Sem arquivos .js nos roots do modulo.',
      'Confirmar se o modulo e puramente estatico. Caso contrario, adicionar scripts ou rotas correspondentes.',
      moduleConfig.roots,
    ));
  }

  if (syntaxFailures.length > 0) {
    issues.push(issue(
      'CRITICAL',
      'codigo',
      'Falhas de sintaxe em JavaScript',
      syntaxFailures.map((item) => `${item.file}: ${item.message}`).join('\n'),
      'Corrigir a sintaxe antes de qualquer teste funcional. Rode `node --check <arquivo>` para reproduzir cada falha.',
      syntaxFailures.map((item) => item.file),
    ));
  }

  if (endpoints.length === 0 && !['dashboard', 'relatorios'].includes(moduleConfig.key)) {
    issues.push(issue(
      'HIGH',
      'api',
      'Nenhum endpoint Express encontrado nos roots do modulo',
      'Regex router/app get/post/put/patch/delete nao encontrou rotas.',
      'Confirmar onde as APIs do modulo sao montadas. Se o modulo faz CRUD, criar ou referenciar rotas Express protegidas por auth.',
      relFiles.filter((rel) => rel.endsWith('.js')).slice(0, 8),
    ));
  }

  const missingApiHints = moduleConfig.expectedApiHints.filter((hint) => {
    return !has(sourceText, [hint]) && !endpoints.some((endpoint) => endpoint.path.toLowerCase().includes(hint.toLowerCase()));
  });
  if (missingApiHints.length > 0) {
    issues.push(issue(
      'MEDIUM',
      'api',
      'Hints de API/funcionalidade nao encontrados',
      missingApiHints.join(', '),
      'Conferir se os nomes mudaram. Se a funcionalidade for obrigatoria, adicionar endpoint, camada de service e teste de contrato.',
      relFiles.filter((rel) => rel.endsWith('.js')).slice(0, 10),
    ));
  }

  const hasAuth = has(sourceText, ['authenticateToken', 'requireAuth', 'ensureAuthenticated', 'requireAdmin', 'authorizeAction', 'checkPermission', 'requirePermission']);
  if (endpoints.length > 0 && !hasAuth) {
    issues.push(issue(
      'HIGH',
      'seguranca',
      'Rotas sem evidencia estatica de autenticacao/autorizacao',
      `${endpoints.length} endpoints encontrados, mas sem helpers de auth/permissao nos arquivos do modulo.`,
      'Adicionar middleware de autenticacao e permissao granular nas rotas sensiveis. Validar com usuario sem permissao.',
      endpoints.slice(0, 8).map((endpoint) => endpoint.file),
    ));
  }

  const hasDb = has(sourceText, ['pool.query', 'db.query', 'connection.query', 'mysql', 'sequelize', 'knex']);
  const crudLike = has(sourceText, ['insert into', 'update ', 'delete ', 'select ']) || endpoints.some((endpoint) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method));
  if (crudLike && !hasDb && !['dashboard'].includes(moduleConfig.key)) {
    issues.push(issue(
      'MEDIUM',
      'dados',
      'Fluxo CRUD sem evidencia clara de acesso a banco/service',
      'Foram encontrados endpoints ou termos CRUD, mas nao acesso direto a banco nos roots.',
      'Verificar se o acesso a dados esta em service externo. Se estiver, documentar a dependencia no modulo.',
      relFiles.filter((rel) => rel.endsWith('.js')).slice(0, 8),
    ));
  }

  if (brokenStaticRefs.length > 0) {
    issues.push(issue(
      'MEDIUM',
      'frontend',
      'Referencias estaticas possivelmente quebradas',
      brokenStaticRefs.map((item) => `${item.file} -> ${item.ref}`).join('\n'),
      'Corrigir paths relativos/absolutos ou garantir que o servidor exponha os assets no mesmo caminho.',
      brokenStaticRefs.map((item) => item.file),
    ));
  }

  const serverMountFound = has(allServerContent, [
    moduleConfig.url,
    moduleConfig.key,
    moduleConfig.name,
    `/${moduleConfig.name}`,
    `/${moduleConfig.key}`,
  ]);
  if (!serverMountFound && !['crm', 'relatorios'].includes(moduleConfig.key)) {
    issues.push(issue(
      'HIGH',
      'roteamento',
      'Sem evidencia de mount/rota no server.js',
      `Nao encontrei termos de montagem para ${moduleConfig.name} em server.js.`,
      'Confirmar que o modulo esta acessivel por rota Express/static. Adicionar mount ou atualizar dashboard para a rota real.',
      ['server.js'],
    ));
  }

  const integrationMissing = moduleConfig.integrationHints.filter((hint) => !has(sourceText, [hint]));
  if (integrationMissing.length >= Math.ceil(moduleConfig.integrationHints.length / 2)) {
    issues.push(issue(
      'LOW',
      'integracao',
      'Baixa evidencia estatica de integracoes esperadas',
      integrationMissing.join(', '),
      'Validar fluxos ponta a ponta entre modulos antes de considerar isso bug. Pode ser apenas nomenclatura diferente.',
      relFiles.slice(0, 10),
    ));
  }

  const todoCount = countRegex(sourceText, /\b(?:TODO|FIXME|HACK|XXX)\b/g);

  const score = scoreFromIssues(issues);
  const status = statusFromScore(score);

  return {
    key: moduleConfig.key,
    name: moduleConfig.name,
    url: moduleConfig.url,
    status,
    score,
    metrics: {
      files: files.length,
      html: htmlFiles.length,
      js: jsFiles.length,
      css: cssFiles.length,
      endpoints: endpoints.length,
      frontendApiCalls: frontendApiCalls.length,
      syntaxFailures: syntaxFailures.length,
      brokenStaticRefs: brokenStaticRefs.length,
      todoMarkers: todoCount,
    },
    expectedPages: pageMatches,
    endpoints: endpoints.slice(0, 100),
    frontendApiCalls: frontendApiCalls.slice(0, 100),
    syntaxFailures,
    brokenStaticRefs,
    missingRoots: collected.missingRoots,
    issues: issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)),
  };
}

function fixContent(moduleResult) {
  const lines = [];
  lines.push(`# FIX - ${moduleResult.name}`);
  lines.push('');
  lines.push('## Sumario');
  lines.push('');
  lines.push(`- Modulo: ${moduleResult.name}`);
  lines.push(`- URL esperada: ${moduleResult.url}`);
  lines.push(`- Score: ${moduleResult.score}%`);
  lines.push(`- Status: ${moduleResult.status}`);
  lines.push(`- Total de achados: ${moduleResult.issues.length}`);
  lines.push('');

  if (moduleResult.issues.length === 0) {
    lines.push('Nenhum achado gerou arquivo de correcao para este modulo.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('## Achados');
  lines.push('');
  moduleResult.issues.forEach((item, index) => {
    lines.push(`### ${index + 1}. [${item.severity}] ${item.title}`);
    lines.push('');
    lines.push(`**Categoria:** ${item.category}`);
    lines.push('');
    lines.push('**Evidencia:**');
    lines.push('');
    lines.push('```text');
    lines.push(item.evidence || 'Sem evidencia textual.');
    lines.push('```');
    lines.push('');
    lines.push('**Arquivos relacionados:**');
    lines.push('');
    if (item.files && item.files.length) {
      Array.from(new Set(item.files)).slice(0, 12).forEach((file) => lines.push(`- ${file}`));
    } else {
      lines.push('- Confirmar durante investigacao.');
    }
    lines.push('');
    lines.push('**Correcao sugerida:**');
    lines.push('');
    lines.push(item.recommendation);
    lines.push('');
    lines.push('**Como validar:**');
    lines.push('');
    lines.push(`1. Corrigir o ponto indicado em ${moduleResult.name}.`);
    lines.push('2. Rodar `node --check` nos JavaScripts alterados.');
    lines.push(`3. Reexecutar \`node scripts/analyze-module.js --module=${moduleResult.key}\`.`);
    lines.push('4. Quando houver servidor disponivel, testar o fluxo no navegador com usuario autenticado.');
    lines.push('');
  });

  lines.push('## Checklist final');
  lines.push('');
  lines.push('- [ ] Modulo carrega sem 404/500.');
  lines.push('- [ ] Sem erro de console no fluxo principal.');
  lines.push('- [ ] Rotas sensiveis exigem autenticacao/permissao.');
  lines.push('- [ ] CRUD principal testado.');
  lines.push('- [ ] Integracoes principais revalidadas.');
  lines.push('- [ ] Relatorio de analise atualizado.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function markdownReport(report) {
  const lines = [];
  const critical = report.modules.flatMap((mod) => mod.issues.filter((item) => item.severity === 'CRITICAL').map((item) => ({ module: mod.name, ...item })));
  const high = report.modules.flatMap((mod) => mod.issues.filter((item) => item.severity === 'HIGH').map((item) => ({ module: mod.name, ...item })));

  lines.push('# Relatorio de Analise Completa de Modulos');
  lines.push('');
  lines.push(`**Data:** ${report.date}`);
  lines.push('**Sistema:** Zyntra ERP v2.4.0');
  lines.push('**Modo:** Analise estatica local, sem servidor e sem banco');
  lines.push('');
  lines.push('## Sumario executivo');
  lines.push('');
  lines.push(`Foram analisados ${report.summary.totalModules} modulos. Score geral: ${report.summary.averageScore}%. Modulos em estado bom/excelente: ${report.summary.goodModules}. Modulos insuficientes: ${report.summary.insufficientModules}. Achados criticos: ${report.summary.criticalIssues}. Achados altos: ${report.summary.highIssues}.`);
  lines.push('');
  lines.push('## Resultado por modulo');
  lines.push('');
  lines.push('| Modulo | Score | Status | Arquivos | HTML | JS | Endpoints | Achados |');
  lines.push('|---|---:|---|---:|---:|---:|---:|---:|');
  report.modules.forEach((mod) => {
    lines.push(`| ${mod.name} | ${mod.score}% | ${mod.status} | ${mod.metrics.files} | ${mod.metrics.html} | ${mod.metrics.js} | ${mod.metrics.endpoints} | ${mod.issues.length} |`);
  });
  lines.push('');
  lines.push('## Achados criticos e altos');
  lines.push('');
  if (critical.length === 0 && high.length === 0) {
    lines.push('Nenhum achado CRITICAL/HIGH identificado pela analise estatica.');
  } else {
    lines.push('| Severidade | Modulo | Categoria | Achado |');
    lines.push('|---|---|---|---|');
    [...critical, ...high].forEach((item) => {
      lines.push(`| ${item.severity} | ${item.module} | ${item.category} | ${item.title} |`);
    });
  }
  lines.push('');
  lines.push('## Limitacoes');
  lines.push('');
  lines.push('- Esta execucao nao inicia o servidor, nao faz login e nao consulta banco de dados.');
  lines.push('- Falhas funcionais reais precisam de validacao dinamica com Playwright ou testes de API autenticados.');
  lines.push('- Alguns achados podem indicar nomenclatura diferente em vez de bug real; os arquivos `FIX-*.md` trazem o caminho de investigacao.');
  lines.push('');
  lines.push('## Artefatos');
  lines.push('');
  lines.push('- `analysis-results.json`');
  lines.push('- `RELATORIO-ANALISE-MODULOS-2026-05-23.md`');
  lines.push('- `fixes/FIX-*.md` quando houver achados');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function csvSummary(report) {
  const lines = ['modulo,score,status,arquivos,html,js,endpoints,achados,criticos,altos'];
  report.modules.forEach((mod) => {
    const critical = mod.issues.filter((item) => item.severity === 'CRITICAL').length;
    const high = mod.issues.filter((item) => item.severity === 'HIGH').length;
    lines.push([
      mod.name,
      mod.score,
      mod.status,
      mod.metrics.files,
      mod.metrics.html,
      mod.metrics.js,
      mod.metrics.endpoints,
      mod.issues.length,
      critical,
      high,
    ].join(','));
  });
  return `${lines.join('\n')}\n`;
}

async function analyzeAll(options = {}) {
  const opts = {
    module: 'all',
    outDir: DEFAULT_OUT_DIR,
    date: DEFAULT_DATE,
    verbose: false,
    ...options,
  };

  const outDir = absPath(opts.outDir);
  const fixesDir = path.join(outDir, 'fixes');
  ensureDir(outDir);
  ensureDir(fixesDir);
  fs.readdirSync(fixesDir)
    .filter((file) => /^FIX-.*\.md$/i.test(file))
    .forEach((file) => fs.unlinkSync(path.join(fixesDir, file)));

  const serverContent = readText(absPath('server.js'));
  const selectedModules = opts.module === 'all'
    ? MODULES
    : MODULES.filter((moduleConfig) => moduleConfig.key === opts.module || moduleConfig.name.toLowerCase() === opts.module);

  if (selectedModules.length === 0) {
    throw new Error(`Modulo nao reconhecido: ${opts.module}`);
  }

  const modules = selectedModules.map((moduleConfig) => analyzeModule(moduleConfig, serverContent));
  const allIssues = modules.flatMap((mod) => mod.issues);
  const averageScore = Math.round(modules.reduce((sum, mod) => sum + mod.score, 0) / modules.length);
  const report = {
    date: opts.date,
    generatedAt: new Date().toISOString(),
    mode: 'static',
    root: ROOT,
    summary: {
      totalModules: modules.length,
      averageScore,
      goodModules: modules.filter((mod) => ['excellent', 'good'].includes(mod.status)).length,
      acceptableModules: modules.filter((mod) => mod.status === 'acceptable').length,
      insufficientModules: modules.filter((mod) => mod.status === 'insufficient').length,
      totalIssues: allIssues.length,
      criticalIssues: allIssues.filter((item) => item.severity === 'CRITICAL').length,
      highIssues: allIssues.filter((item) => item.severity === 'HIGH').length,
      mediumIssues: allIssues.filter((item) => item.severity === 'MEDIUM').length,
      lowIssues: allIssues.filter((item) => item.severity === 'LOW').length,
    },
    modules,
  };

  writeJson(path.join(outDir, 'analysis-results.json'), report);
  fs.writeFileSync(path.join(outDir, `RELATORIO-ANALISE-MODULOS-${opts.date}.md`), markdownReport(report), 'utf8');
  fs.writeFileSync(path.join(outDir, 'modules-summary.csv'), csvSummary(report), 'utf8');

  modules.forEach((mod) => {
    if (mod.issues.length === 0) return;
    const fileName = `FIX-${mod.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}.md`;
    fs.writeFileSync(path.join(fixesDir, fileName), fixContent(mod), 'utf8');
  });

  if (opts.verbose || require.main === module) {
    console.log(`Modulos analisados: ${report.summary.totalModules}`);
    console.log(`Score geral: ${report.summary.averageScore}%`);
    console.log(`Achados: ${report.summary.totalIssues} total, ${report.summary.criticalIssues} critical, ${report.summary.highIssues} high`);
    console.log(`Relatorios: ${path.relative(ROOT, outDir)}`);
  }

  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await analyzeAll(opts);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  analyzeAll,
  MODULES,
};
