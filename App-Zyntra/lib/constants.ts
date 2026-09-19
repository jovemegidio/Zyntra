import Constants from 'expo-constants';
import type { Module } from '@/types';

// API Configuration — URL via variável de ambiente (nunca hardcoded)
// Domínio canônico = zyntraerp.com.br (aluforce.api.br responde 301 → quebra POST de login no axios).
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://zyntraerp.com.br/api';
export const API_TIMEOUT = 30000;

// Trevo Autopeças — sistema separado (modules/Trevo/server.js), fora do grupo Aluforce/Energy/
// Eletric/Cobal (login por usuário+senha, sem RH/PCP). Login dedicado em (public)/trevo-login.
export const TREVO_API_BASE_URL = 'https://trevo.zyntraerp.com.br/api';

// Cor primária da tela de login (espelha o token --primary da login.html web)
export const LOGIN_PRIMARY = '#2a3170';

// Colors - Zyntra Design System (modo claro — espelha o login web)
export const Colors = {
  // Fundos
  bg: '#f3f5f9',
  surface: '#eaecf3',
  card: '#ffffff',
  card2: '#f0f2f7',
  // Bordas
  border: '#dbe0ea',
  borderLight: '#e8ecf3',
  // Primária — azul-marinho corporativo
  accent: '#19295e',
  accentDim: 'rgba(25,41,94,0.10)',
  accentGlow: 'rgba(25,41,94,0.06)',
  // Textos
  text: '#18213a',
  textSoft: '#344060',
  muted: '#60708c',
  mutedLight: '#8898b4',
  // Status
  green: '#16a34a',
  greenDim: 'rgba(22,163,74,0.12)',
  red: '#dc2626',
  redDim: 'rgba(220,38,38,0.10)',
  yellow: '#d97706',
  yellowDim: 'rgba(217,119,6,0.12)',
  purple: '#7c3aed',
  purpleDim: 'rgba(124,58,237,0.12)',
  teal: '#0d9488',
  tealDim: 'rgba(13,148,136,0.12)',
  orange: '#ea580c',
  orangeDim: 'rgba(234,88,12,0.12)',
};

// Modules Configuration
export const MODULES: Module[] = [
  {
    id: 'financeiro',
    label: 'Financeiro',
    color: Colors.accent,
    dim: Colors.accentDim,
    description: 'Contas, DRE, Fluxo de Caixa',
    area: 'financeiro',
  },
  {
    id: 'vendas',
    label: 'Vendas',
    color: Colors.green,
    dim: Colors.greenDim,
    description: 'Pedidos, Funil, Metas',
    area: 'vendas',
  },
  {
    id: 'crm',
    label: 'CRM',
    color: Colors.purple,
    dim: Colors.purpleDim,
    description: 'Funil, tarefas, oportunidades',
    area: 'vendas',
  },
  {
    id: 'rh',
    label: 'RH',
    color: Colors.purple,
    dim: Colors.purpleDim,
    description: 'Colaboradores, Ponto',
    area: 'rh',
  },
  {
    id: 'pcp',
    label: 'PCP',
    color: Colors.yellow,
    dim: Colors.yellowDim,
    description: 'Ordens de Producao',
    area: 'pcp',
  },
  {
    id: 'logistica',
    label: 'Logistica',
    color: Colors.teal,
    dim: Colors.tealDim,
    description: 'Entregas, Rotas',
    area: 'logistica',
  },
  {
    id: 'faturamento',
    label: 'Faturamento',
    color: Colors.red,
    dim: Colors.redDim,
    description: 'NF-e, Faturas',
    area: 'nfe',
  },
  {
    id: 'tarefas',
    label: 'Tarefas',
    color: Colors.teal,
    dim: Colors.tealDim,
    description: 'Quadro da equipe',
    area: '',
  },
  {
    id: 'compras',
    label: 'Compras',
    color: Colors.orange,
    dim: Colors.orangeDim,
    description: 'PC, Fornecedores',
    area: 'compras',
  },
];

// Gating de módulos por áreas permitidas (espelha o menu do web):
// admin vê tudo; sem dados de áreas não esconde nada (fail-open, como o web);
// compara tanto m.area ('nfe') quanto m.id ('faturamento') porque o backend
// usa os dois nomes dependendo da origem (login vs /auth/me).
/**
 * Sessão aberta por CPF só enxerga o RH (claim `escopo` no JWT — ver
 * `utils/login-scope.js` no backend). O servidor já devolve `areas: ['rh']` e
 * `is_admin: false` nesse caso, mas o escopo é conferido aqui em separado porque
 * um módulo SEM área (Tarefas) passaria pelo teste de áreas e apareceria na tela.
 */
export function sessaoRestritaAoRh(
  user?: { escopo?: string | null } | null
): boolean {
  return String(user?.escopo || '').toLowerCase() === 'rh';
}

export function canAccessModule(
  m: Module,
  user?: { is_admin?: boolean | number; areas?: string[]; escopo?: string | null } | null
): boolean {
  // O escopo vem antes de tudo, inclusive de admin: numa sessão por CPF o
  // servidor rebaixa is_admin para false de propósito, e o app tem de acompanhar.
  if (sessaoRestritaAoRh(user)) return m.area === 'rh' || m.id === 'rh';
  // Módulo sem área é de todo usuário autenticado (Tarefas: o router do backend
  // só exige login). Sem isto o app esconderia uma tela que o servidor libera.
  if (!m.area) return true;
  if (!user) return true;
  if (user.is_admin) return true;
  const areas = user.areas ?? [];
  if (!areas.length) return true;
  return areas.includes(m.area) || areas.includes(m.id);
}

// Status Colors Mapping
export const STATUS_COLORS = {
  aprovado: { color: Colors.green, bg: Colors.greenDim },
  analise: { color: Colors.yellow, bg: Colors.yellowDim },
  cancelado: { color: Colors.red, bg: Colors.redDim },
  entregue: { color: Colors.teal, bg: Colors.tealDim },
  vencendo: { color: Colors.yellow, bg: Colors.yellowDim },
  a_vencer: { color: Colors.green, bg: Colors.greenDim },
  vencida: { color: Colors.red, bg: Colors.redDim },
  paga: { color: Colors.green, bg: Colors.greenDim },
  presente: { color: Colors.green, bg: Colors.greenDim },
  ausente: { color: Colors.red, bg: Colors.redDim },
  ferias: { color: Colors.accent, bg: Colors.accentDim },
  rota: { color: Colors.teal, bg: Colors.tealDim },
  homeoffice: { color: Colors.accent, bg: Colors.accentDim },
  producao: { color: Colors.yellow, bg: Colors.yellowDim },
  concluida: { color: Colors.green, bg: Colors.greenDim },
  iniciando: { color: Colors.accent, bg: Colors.accentDim },
  aguardando: { color: Colors.muted, bg: Colors.surface },
  autorizada: { color: Colors.green, bg: Colors.greenDim },
  processando: { color: Colors.yellow, bg: Colors.yellowDim },
  rejeitada: { color: Colors.red, bg: Colors.redDim },
  aprovacao: { color: Colors.yellow, bg: Colors.yellowDim },
  recebido: { color: Colors.teal, bg: Colors.tealDim },
} as const;

// Logos das empresas (require estático para Metro bundler)
export const Logos = {
  aluforceAzul:  require('../assets/logos/aluforce-azul.png'),
  aluforceWhite: require('../assets/logos/aluforce-branco.png'),
  laborAzul:     require('../assets/logos/labor-azul.png'),
  laborWhite:    require('../assets/logos/labor-branco.png'),
  energyAzul:    require('../assets/logos/energy-azul.png'),
  energyWhite:   require('../assets/logos/energy-branco.png'),
  cobalAzul:     require('../assets/logos/cobal-azul.png'),
  cobalWhite:    require('../assets/logos/cobal-branco.png'),
};

// ── Configuração das empresas — espelha o <script> da login.html web ──────────
// 'cobal' adicionado em 12/09/2026 — a empresa nunca tinha sido cadastrada aqui, então
// todo login com @cobalcondutores.com.br caía no fallback (Aluforce) tanto na marca
// exibida quanto no backend de fato chamado (ver apiBaseForEmail logo abaixo).
export type CompanyId = 'aluforce' | 'laborEletric' | 'laborEnergy' | 'cobal';

export interface CompanyBrand {
  name: string;
  logo: any;        // logo branca (para barra de marcas sobre fundo escuro)
  padded?: boolean; // logo com muito espaço transparente interno (Labor Eletric)
}

export interface CompanyConfig {
  id: CompanyId | 'neutral';
  name: string;
  emailDomains: string[];
  /**
   * Host da API desta empresa (sem protocolo nem /api). `undefined` = usa o
   * API_BASE_URL padrão (Aluforce) — é o caso da própria Aluforce e do estado
   * neutro. Existe para que `apiBaseForEmail` (logo abaixo) leia DAQUI em vez de
   * manter uma segunda lista de domínios em lib/api.ts: foi exatamente essa
   * duplicação — a Cobal cadastrada aqui em `emailDomains` mas ausente da lista
   * própria do api.ts — que fez todo login da Cobal cair silenciosamente no
   * backend da Aluforce.
   */
  apiHost?: string;
  headline: string;
  description: string;
  logoDark: any;    // logo azul (para o card claro do formulário)
  brands: CompanyBrand[];
  primary: string;  // cor primária da marca (espelha --primary da login.html web)
  accent: string;   // cor de acento da marca (espelha --accent da login.html web)
}

export const COMPANIES: Record<CompanyId, CompanyConfig> = {
  aluforce: {
    id: 'aluforce',
    name: 'Aluforce',
    emailDomains: ['aluforce.ind.br'],
    headline: 'Portal interno da Aluforce',
    description: 'Ambiente corporativo de uso exclusivo dos colaboradores da Aluforce — Cabos de Alumínio.',
    logoDark: Logos.aluforceAzul,
    brands: [{ name: 'Aluforce', logo: Logos.aluforceWhite }],
    primary: '#2a3170',
    accent: '#18b6c8',
  },
  laborEletric: {
    id: 'laborEletric',
    name: 'Labor Eletric',
    emailDomains: ['labor.com.br', 'laboreletric.com.br'],
    apiHost: 'eletric.zyntraerp.com.br',
    headline: 'Portal interno da Labor Eletric',
    description: 'Ambiente corporativo de uso exclusivo dos colaboradores da Labor Eletric.',
    logoDark: Logos.laborAzul,
    brands: [{ name: 'Labor Eletric', logo: Logos.laborWhite, padded: true }],
    primary: '#F39C12',
    accent: '#F8C471',
  },
  laborEnergy: {
    id: 'laborEnergy',
    name: 'Labor Energy',
    emailDomains: ['laborenergy.com.br', 'energy.com.br'],
    apiHost: 'energy.zyntraerp.com.br',
    headline: 'Portal interno da Labor Energy',
    description: 'Ambiente corporativo de uso exclusivo dos colaboradores da Labor Energy.',
    logoDark: Logos.energyAzul,
    brands: [{ name: 'Labor Energy', logo: Logos.energyWhite }],
    primary: '#27AE60',
    accent: '#58D68D',
  },
  // Cores, domínio de e-mail e host de API conferidos contra
  // middleware/zyntra-branding.js (BRAND=cobal) e contra os e-mails reais
  // cadastrados em produção (8 de 8 usuários com @ usam cobalcondutores.com.br) —
  // não é uma cor/domínio estimado.
  cobal: {
    id: 'cobal',
    name: 'Cobal',
    emailDomains: ['cobalcondutores.com.br'],
    apiHost: 'cobal.zyntraerp.com.br',
    headline: 'Portal interno da Cobal',
    description: 'Ambiente corporativo de uso exclusivo dos colaboradores da Cobal — Condutores Elétricos.',
    logoDark: Logos.cobalAzul,
    brands: [{ name: 'Cobal', logo: Logos.cobalWhite }],
    primary: '#0033B0',
    accent: '#2E6BE6',
  },
};

export const NEUTRAL_COMPANY: CompanyConfig = {
  id: 'neutral',
  name: 'Grupo Corporativo',
  emailDomains: [],
  headline: 'Portal interno do grupo',
  description: 'Ambiente corporativo unificado. Informe seu e-mail corporativo para acessar o portal da sua empresa.',
  logoDark: Logos.aluforceAzul,
  // Espelha a barra de marcas da login.html do web, onde a Labor Eletric foi retirada
  // do estado neutro — lá só aparecem Aluforce e Energy. A marca continua existindo
  // em COMPANIES.laborEletric: ela volta à tela assim que o e-mail identifica a empresa.
  brands: [
    { name: 'Aluforce', logo: Logos.aluforceWhite },
    { name: 'Energy', logo: Logos.energyWhite },
  ],
  primary: '#2a3170',
  accent: '#18b6c8',
};

// Detecta a empresa pelo domínio do e-mail (mesma regra da login.html)
export function detectCompanyByEmail(email: string): CompanyId | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return null;
  const found = (Object.keys(COMPANIES) as CompanyId[]).find((id) =>
    COMPANIES[id].emailDomains.includes(domain)
  );
  return found ?? null;
}

/**
 * Resolve a URL base da API a partir do e-mail digitado no login.
 *
 * Fonte única: antes disso, `lib/api.ts` mantinha sua PRÓPRIA lista de domínios,
 * separada desta. A Cobal foi cadastrada aqui (para a marca aparecer) mas nunca
 * naquela segunda lista — todo login com @cobalcondutores.com.br continuava
 * caindo no backend da Aluforce, com a marca da Cobal na tela mas os dados de
 * outra empresa por trás. Qualquer empresa nova só precisa de UMA entrada em
 * `COMPANIES`, com `apiHost`, para funcionar aqui e na tela de login.
 */
export function apiBaseForEmail(email: string): string {
  const id = detectCompanyByEmail(email);
  const host = id ? COMPANIES[id].apiHost : undefined;
  return host ? `https://${host}/api` : API_BASE_URL;
}

// Base de API efetivamente em uso — atualizada pelo lib/api.ts (login e restauração
// de sessão) sempre que a empresa ativa é resolvida. `getAvatarUrl` é síncrona (usada
// direto em `<Image source={{ uri }}>`), então não pode ler o SecureStore como o
// interceptor do axios faz; sem este cache, avatar de usuário de Energy/Eletric/Cobal
// apontava sempre para o domínio da Aluforce (API_BASE_URL) e a foto não carregava.
export let currentApiBase = API_BASE_URL;
export function setCurrentApiBase(url: string) {
  currentApiBase = url;
}

// Converte caminho relativo de avatar (/avatars/Foo.webp) em URL absoluta
export function getAvatarUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  // Remove sufixo /api da base para servir arquivos estáticos
  const base = currentApiBase.replace(/\/api\/?$/, '');
  return `${base}${path}`;
}

/**
 * Caminho de cada módulo no ERP web, para abrir na tela `sistema` (WebView).
 * As telas nativas cobrem o dia a dia; o que só existe no web (cadastros longos,
 * ações fiscais, relatórios) fica a um toque de distância em vez de virar
 * "tem que abrir no computador".
 *
 * `/index.html` é explícito de propósito: `/Vendas` responde 302 e o menu do web
 * não marca o item como ativo. Os prefixos aqui precisam bater com a allowlist de
 * `routes/mobile-app.js` no backend — fora dela, a sessão cai em /index.html.
 */
export const CAMINHOS_ERP_WEB: Record<string, string> = {
  financeiro: '/Financeiro/index.html',
  vendas: '/Vendas/index.html',
  crm: '/Vendas/crm.html',
  rh: '/RH/index.html',
  'meu-rh': '/RH/funcionario.html',
  pcp: '/PCP/index.html',
  logistica: '/Logistica/index.html',
  faturamento: '/Faturamento/index.html',
  compras: '/Compras/index.html',
  tarefas: '/Tarefas',
};

/**
 * TODOS os módulos do ERP web, para o app alcançar o sistema inteiro pelo WebView.
 *
 * As telas nativas (MODULES, acima) são atalhos para o que se consulta no celular —
 * cobrem 7 módulos. O ERP web tem ~360 telas em 15 módulos; é este catálogo que
 * torna o resto acessível, sem reescrever nada nativamente.
 *
 * `path` precisa estar na allowlist de `routes/mobile-app.js`: caminho fora dela não
 * dá erro, cai calado em `/index.html`. Os caminhos abaixo foram conferidos rota a
 * rota contra o servidor (302 = existe e é protegida). Atenção: vários módulos só
 * existem na forma NUA — `/Contador/index.html` é 404, `/Contador` é 302.
 */
export type ModuloWeb = {
  id: string;
  label: string;
  descricao: string;
  path: string;
  grupo: 'Operação' | 'Comercial' | 'Fiscal' | 'Gestão';
  /** área de permissão; vazio = todo usuário autenticado */
  area?: string;
};

export const MODULOS_WEB: ModuloWeb[] = [
  // Operação
  { id: 'web-vendas', label: 'Vendas', descricao: 'Kanban, pedidos, orçamentos', path: '/Vendas/index.html', grupo: 'Operação', area: 'vendas' },
  { id: 'web-compras', label: 'Compras', descricao: 'Pedidos, cotações, recebimento', path: '/Compras/index.html', grupo: 'Operação', area: 'compras' },
  { id: 'web-pcp', label: 'PCP', descricao: 'Ordens de produção, estoque', path: '/PCP/index.html', grupo: 'Operação', area: 'pcp' },
  { id: 'web-logistica', label: 'Logística', descricao: 'Expedição, fretes, rastreio', path: '/Logistica/index.html', grupo: 'Operação', area: 'logistica' },
  { id: 'web-qualidade', label: 'Qualidade', descricao: 'Não conformidades, inspeções', path: '/Qualidade', grupo: 'Operação', area: 'qualidade' },

  // Comercial
  { id: 'web-crm', label: 'CRM', descricao: 'Funil, contas, contatos, tarefas', path: '/Vendas/crm.html', grupo: 'Comercial', area: 'vendas' },
  { id: 'web-prospeccao', label: 'Prospecção', descricao: 'Captação de leads por CNPJ', path: '/Vendas/prospeccao.html', grupo: 'Comercial', area: 'vendas' },
  { id: 'web-clientes', label: 'Clientes', descricao: 'Cadastro e radar de clientes', path: '/Vendas/clientes.html', grupo: 'Comercial', area: 'vendas' },

  // Fiscal
  { id: 'web-faturamento', label: 'Faturamento', descricao: 'NF-e, esteira, notas', path: '/Faturamento/index.html', grupo: 'Fiscal', area: 'nfe' },
  { id: 'web-financeiro', label: 'Financeiro', descricao: 'A pagar, a receber, fluxo', path: '/Financeiro/index.html', grupo: 'Fiscal', area: 'financeiro' },
  { id: 'web-nfe', label: 'NF-e', descricao: 'Emissão e documentos fiscais', path: '/NFe', grupo: 'Fiscal', area: 'nfe' },
  { id: 'web-contador', label: 'Contador', descricao: 'Painel contábil e exportações', path: '/Contador', grupo: 'Fiscal', area: 'financeiro' },

  // Gestão
  { id: 'web-rh', label: 'RH', descricao: 'Folha, ponto, colaboradores', path: '/RH/index.html', grupo: 'Gestão', area: 'rh' },
  { id: 'web-relatorios', label: 'Relatórios', descricao: 'Relatórios de todos os módulos', path: '/relatorios', grupo: 'Gestão' },
  { id: 'web-tarefas', label: 'Tarefas', descricao: 'Quadro de tarefas da equipe', path: '/Tarefas', grupo: 'Gestão' },
  { id: 'web-empresas', label: 'Empresas', descricao: 'Troca de empresa e usuários', path: '/Empresas', grupo: 'Gestão' },
  { id: 'web-apps', label: 'Meus Aplicativos', descricao: 'Portal de aplicativos', path: '/apps', grupo: 'Gestão' },
  { id: 'web-chat', label: 'Chat', descricao: 'Mensagens internas', path: '/chat', grupo: 'Gestão' },
  { id: 'web-config', label: 'Configurações', descricao: 'Preferências e sistema', path: '/configuracoes', grupo: 'Gestão' },
  { id: 'web-painel', label: 'Painel completo', descricao: 'Dashboard do ERP web', path: '/index.html', grupo: 'Gestão' },
];

/** Mesmo gating do menu web: admin vê tudo; sem áreas conhecidas, não esconde nada. */
export function podeAcessarModuloWeb(
  m: ModuloWeb,
  user?: { is_admin?: boolean | number; areas?: string[]; escopo?: string | null } | null
): boolean {
  // Mesmo teto da sessão por CPF: o WebView não pode ser a porta dos fundos para
  // os módulos que a sessão restrita não alcança.
  if (sessaoRestritaAoRh(user)) return m.area === 'rh';
  if (!m.area || !user) return true;
  if (user.is_admin) return true;
  const areas = user.areas ?? [];
  if (!areas.length) return true;
  return areas.includes(m.area);
}

// App Info
//
// A versão vem do app.json (a mesma que vai no APK) em vez de ser digitada aqui:
// as duas ficaram divergentes — o app.json empacotava 2.0.0 enquanto estas três
// telas (perfil, configurações e splash) exibiam 1.1.0, então o número que o
// usuário lia ao abrir um chamado não era o número da build instalada.
export const APP_VERSION = Constants.expoConfig?.version ?? '2.0.0';

/** Número da build Android (`versionCode`), que é o que identifica a instalação. */
export const APP_BUILD = String(
  Constants.expoConfig?.android?.versionCode ?? ''
);

export const APP_NAME = 'Zyntra';
export const COMPANY_NAME = 'Aluforce';
