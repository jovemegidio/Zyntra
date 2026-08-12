import type { Module } from '@/types';

// API Configuration — URL via variável de ambiente (nunca hardcoded)
// Domínio canônico = zyntraerp.com.br (aluforce.api.br responde 301 → quebra POST de login no axios).
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://zyntraerp.com.br/api';
export const API_TIMEOUT = 30000;

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
export function canAccessModule(
  m: Module,
  user?: { is_admin?: boolean | number; areas?: string[] } | null
): boolean {
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
};

// ── Configuração das empresas — espelha o <script> da login.html web ──────────
export type CompanyId = 'aluforce' | 'laborEletric' | 'laborEnergy';

export interface CompanyBrand {
  name: string;
  logo: any;        // logo branca (para barra de marcas sobre fundo escuro)
  padded?: boolean; // logo com muito espaço transparente interno (Labor Eletric)
}

export interface CompanyConfig {
  id: CompanyId | 'neutral';
  name: string;
  emailDomains: string[];
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
    headline: 'Portal interno da Labor Energy',
    description: 'Ambiente corporativo de uso exclusivo dos colaboradores da Labor Energy.',
    logoDark: Logos.energyAzul,
    brands: [{ name: 'Labor Energy', logo: Logos.energyWhite }],
    primary: '#27AE60',
    accent: '#58D68D',
  },
};

export const NEUTRAL_COMPANY: CompanyConfig = {
  id: 'neutral',
  name: 'Grupo Corporativo',
  emailDomains: [],
  headline: 'Portal interno do grupo',
  description: 'Ambiente corporativo unificado. Informe seu e-mail corporativo para acessar o portal da sua empresa.',
  logoDark: Logos.aluforceAzul,
  brands: [
    { name: 'Aluforce', logo: Logos.aluforceWhite },
    { name: 'Labor Eletric', logo: Logos.laborWhite, padded: true },
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

// Converte caminho relativo de avatar (/avatars/Foo.webp) em URL absoluta
export function getAvatarUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  // Remove sufixo /api da base para servir arquivos estáticos
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
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
  rh: '/RH/index.html',
  pcp: '/PCP/index.html',
  logistica: '/Logistica/index.html',
  faturamento: '/Faturamento/index.html',
  compras: '/Compras/index.html',
};

// App Info
export const APP_VERSION = '1.1.0';
export const APP_NAME = 'Zyntra';
export const COMPANY_NAME = 'Aluforce';
