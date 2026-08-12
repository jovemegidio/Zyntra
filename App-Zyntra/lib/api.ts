import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from './secure-store';
import { API_BASE_URL, API_TIMEOUT } from './constants';

// Create axios instance — withCredentials removido: mobile usa Bearer token, não cookie
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

function unwrapData<T>(payload: any, fallback: T): T {
  if (payload == null) return fallback;
  if (payload.data != null) return payload.data as T;
  if (payload.result != null) return payload.result as T;
  if (payload.rows != null) return payload.rows as T;
  return payload as T;
}

function asArray<T = any>(payload: any): T[] {
  const data = unwrapData<any>(payload, []);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

function safeNumber(value: any, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function moneyBR(value: any): string {
  if (typeof value === 'string' && value.trim()) return value;
  return `R$ ${safeNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Token storage keys
const TOKEN_KEY = 'zyntra_auth_token';
const REFRESH_TOKEN_KEY = 'zyntra_refresh_token';
const DEVICE_ID_KEY = 'zyntra_device_id';
const USER_DATA_KEY = 'zyntra_user_data';
const API_BASE_KEY = 'zyntra_api_base_url';
const PUSH_TOKEN_KEY = 'zyntra_expo_push_token';

let unauthorizedHandler: (() => void) | undefined;
export function setUnauthorizedHandler(handler?: () => void) {
  unauthorizedHandler = handler;
}

function apiBaseForEmail(email: string): string {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  if (['labor.com.br', 'laboreletric.com.br'].includes(domain)) return 'https://eletric.zyntraerp.com.br/api';
  if (['laborenergy.com.br', 'energy.com.br'].includes(domain)) return 'https://energy.zyntraerp.com.br/api';
  return 'https://zyntraerp.com.br/api';
}

// Token management
export const tokenStorage = {
  async getToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  async setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },

  async setRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },

  async getDeviceId(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(DEVICE_ID_KEY);
    } catch {
      return null;
    }
  },

  async setDeviceId(deviceId: string): Promise<void> {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  },

  async getApiBase(): Promise<string> {
    return (await SecureStore.getItemAsync(API_BASE_KEY)) || API_BASE_URL;
  },

  async getPushToken(): Promise<string | null> {
    return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  },

  async setPushToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  },

  async clearPushToken(): Promise<void> {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  },

  async getUserData(): Promise<any | null> {
    try {
      const data = await SecureStore.getItemAsync(USER_DATA_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async setUserData(user: any): Promise<void> {
    await SecureStore.setItemAsync(USER_DATA_KEY, JSON.stringify(user));
  },

  async clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_DATA_KEY);
  },
};

// Request interceptor - add auth token
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const savedBase = await SecureStore.getItemAsync(API_BASE_KEY);
    if (savedBase) config.baseURL = savedBase;
    const token = await tokenStorage.getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle 401 - try refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken) {
          const baseUrl = (await SecureStore.getItemAsync(API_BASE_KEY)) || API_BASE_URL;
          const response = await axios.post(`${baseUrl}/auth/refresh`, {
            refreshToken,
          });

          // Backend (post-exports-routes) retorna { success, accessToken, expiresIn, user };
          // formatos antigos retornavam { token, refreshToken } — aceita ambos.
          const newToken = response.data.accessToken || response.data.token;
          const newRefreshToken = response.data.refreshToken;
          if (!newToken) throw new Error('Refresh não retornou token');

          await tokenStorage.setToken(newToken);
          if (newRefreshToken) await tokenStorage.setRefreshToken(newRefreshToken);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed - clear tokens
        await tokenStorage.clearTokens();
        unauthorizedHandler?.();
        throw refreshError;
      }
      await tokenStorage.clearTokens();
      unauthorizedHandler?.();
    }

    return Promise.reject(error);
  }
);

// ============================================================
// AUTH API - /api/login, /api/logout, /api/me
// Based on routes/auth-rbac.js
// ============================================================
export const authApi = {
  /**
   * Login - POST /api/auth/login
   * Usa auth-rbac.js que retorna token no body (mobile-safe).
   * /api/login retorna token apenas via httpOnly cookie — inacessível no mobile.
   */
  login: async (credentials: { email: string; password: string }) => {
    const companyBase = apiBaseForEmail(credentials.email);
    await SecureStore.setItemAsync(API_BASE_KEY, companyBase);
    api.defaults.baseURL = companyBase;
    const response = await api.post('/auth/login', credentials);

    if (response.data.success) {
      if (response.data.user)         await tokenStorage.setUserData(response.data.user);
      if (response.data.deviceId)     await tokenStorage.setDeviceId(response.data.deviceId);
      if (response.data.token)        await tokenStorage.setToken(response.data.token);
      if (response.data.refreshToken) await tokenStorage.setRefreshToken(response.data.refreshToken);
    }

    return response.data;
  },

  /** Logout - POST /api/auth/logout */
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      await tokenStorage.clearTokens();
    }
  },

  /** Perfil do usuário autenticado - GET /api/auth/me */
  getProfile: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  /** Refresh token - POST /api/auth/refresh */
  refreshToken: async (refreshToken: string) => {
    const response = await api.post('/auth/refresh', { refreshToken });
    return response.data;
  },

  /**
   * Preview do colaborador (saudação no login) - GET /api/public/usuarios/preview
   * Endpoint público: retorna { success, nome, apelido, cargo, foto, email } sem expor senha.
   * Aceita email OU cpf (apenas dígitos). Para CPF, o campo `email` da resposta
   * é usado para autenticar no endpoint mobile-safe (/auth/login só aceita email).
   */
  previewUser: async (params: { email?: string; cpf?: string }) => {
    try {
      const query: Record<string, string> = {};
      if (params.email) query.email = params.email.toLowerCase().trim();
      if (params.cpf) query.cpf = params.cpf.replace(/\D/g, '');
      const response = await api.get('/public/usuarios/preview', { params: query });
      return response.data?.success ? response.data : null;
    } catch {
      return null;
    }
  },

  /**
   * Recuperar senha - POST /api/auth/forgot-password (auth-section-routes.js)
   * Backend envia e-mail com link de reset e sempre responde sucesso
   * (não revela se o e-mail existe).
   */
  requestPasswordReset: async (email: string) => {
    try {
      const response = await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      return { success: true, ...response.data };
    } catch {
      // Resposta silenciosa por segurança — mesmo texto do backend
      return {
        success: true,
        message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.',
      };
    }
  },
};

// ============================================================
// DASHBOARD API - /api/dashboard/*
// Based on routes/dashboard-api.js
// ============================================================
export const dashboardApi = {
  /**
   * Get executive KPIs - GET /api/dashboard/kpis
   * Returns: { vendas, pedidosAbertos, aReceber, ordensProducao }
   */
  getKPIs: async () => {
    try {
      const response = await api.get('/dashboard/kpis');
      const data = unwrapData<any>(response.data, {});
      const vendas = data.vendas ?? data.faturamento ?? data.sales ?? {};
      return {
        vendas: {
          valor: moneyBR(vendas.valor ?? vendas.total ?? data.faturamento_total ?? data.receita_total),
          trend: String(vendas.trend ?? vendas.variacao ?? data.trend ?? ''),
          trendUp: vendas.trendUp ?? vendas.trend_up ?? true,
          chart: Array.isArray(vendas.chart) ? vendas.chart.map((n: any) => safeNumber(n)) : [],
        },
        pedidosAbertos: safeNumber(data.pedidosAbertos ?? data.pedidos_abertos ?? data.pedidosPendentes ?? data.pedidos_pendentes),
        aReceber: moneyBR(data.aReceber ?? data.a_receber ?? data.contas_receber ?? data.receber_hoje),
        ordensProducao: safeNumber(data.ordensProducao ?? data.ordens_producao ?? data.ordensAtivas ?? data.ordens_ativas),
        ordensAtivas: safeNumber(data.ordensAtivas ?? data.ordens_ativas ?? data.ordensProducao ?? data.ordens_producao),
      };
    } catch {
      return {
        vendas: { valor: 'R$ 0,00', trend: '', trendUp: true, chart: [] },
        pedidosAbertos: 0,
        aReceber: 'R$ 0,00',
        ordensProducao: 0,
        ordensAtivas: 0,
      };
    }
  },

  /**
   * Alertas do sistema - GET /api/notificacoes/alertas
   * (/dashboard/alerts retorna só contadores; /notificacoes/alertas já entrega
   *  itens prontos { tipo, titulo, mensagem, modulo } que a tela renderiza)
   */
  getAlertas: async () => {
    try {
      const response = await api.get('/notificacoes/alertas');
      const d = response.data;
      return Array.isArray(d) ? d : d?.alertas ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Atividades recentes - GET /api/dashboard/atividade-recente
   * Backend retorna { icon, color, text, modulo, ts } — normaliza para { descricao, data }.
   * Entradas placeholder (ts null) são descartadas.
   */
  getAtividades: async (limit = 10) => {
    try {
      const response = await api.get('/dashboard/atividade-recente');
      return asArray<any>(response.data)
        .filter((a) => a?.ts != null)
        .slice(0, limit)
        .map((a) => ({
          descricao: a.text ?? a.descricao ?? '',
          data: a.ts ?? a.data ?? null,
          modulo: a.modulo,
          color: a.color,
        }));
    } catch {
      return [];
    }
  },

  /**
   * Fluxo financeiro (gráfico) - GET /api/dashboard/fluxo-financeiro
   */
  getCharts: async (periodo = 'mes') => {
    const response = await api.get('/dashboard/fluxo-financeiro', { params: { periodo } });
    return response.data;
  },
};

// ============================================================
// FINANCEIRO API - /api/financeiro/*
// Based on routes/financeiro-routes.js
// ============================================================
export const financeiroApi = {
  /**
   * Dashboard financeiro - GET /api/financeiro/dashboard
   * Returns: { faturamento_total, contas_receber, contas_pagar, saldo_total }
   */
  getDashboard: async () => {
    try {
      const response = await api.get('/financeiro/dashboard');
      const data = unwrapData<any>(response.data, {});
      return {
        faturamento_total: safeNumber(data.faturamento_total ?? data.faturamentoTotal ?? data.faturamento),
        contas_receber: safeNumber(data.contas_receber ?? data.contasReceber ?? data.a_receber),
        contas_pagar: safeNumber(data.contas_pagar ?? data.contasPagar ?? data.a_pagar),
        saldo_total: safeNumber(data.saldo_total ?? data.saldoTotal ?? data.saldo),
      };
    } catch {
      return { faturamento_total: 0, contas_receber: 0, contas_pagar: 0, saldo_total: 0 };
    }
  },

  /**
   * Fluxo de caixa - GET /api/financeiro/fluxo-caixa
   */
  getFluxoCaixa: async (params?: { dataInicio?: string; dataFim?: string }) => {
    const response = await api.get('/financeiro/fluxo-caixa', { params });
    return response.data;
  },

  /**
   * Contas a receber - GET /api/financeiro/contas-receber
   */
  getContasReceber: async (params?: { status?: string; busca?: string }) => {
    try {
      const response = await api.get('/financeiro/contas-receber', { params });
      return asArray(response.data);
    } catch {
      return [];
    }
  },

  /**
   * Contas a pagar - GET /api/financeiro/contas-pagar
   */
  getContasPagar: async (params?: { status?: string; busca?: string }) => {
    try {
      const response = await api.get('/financeiro/contas-pagar', { params });
      return asArray(response.data);
    } catch {
      return [];
    }
  },

  /**
   * DRE - GET /api/financeiro/dre
   */
  getDRE: async (params?: { mes?: number; ano?: number }) => {
    const response = await api.get('/financeiro/dre', { params });
    return response.data;
  },

  /**
   * Conciliação bancária - GET /api/financeiro/conciliacao
   */
  getConciliacao: async () => {
    const response = await api.get('/financeiro/conciliacao');
    return response.data;
  },
};

// ============================================================
// VENDAS/CRM API - /api/vendas/*
// Based on routes/vendas-routes.js
// ============================================================
export const vendasApi = {
  /**
   * Listar pedidos - GET /api/vendas/pedidos
   */
  getPedidos: async (params?: {
    busca?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) => {
    try {
      const response = await api.get('/vendas/pedidos', { params });
      return asArray(response.data);
    } catch {
      return [];
    }
  },

  /**
   * Detalhes do pedido - GET /api/vendas/pedidos/:id
   */
  getPedido: async (id: number) => {
    const response = await api.get(`/vendas/pedidos/${id}`);
    return response.data;
  },

  /**
   * Funil de vendas (pipeline CRM) - GET /api/crm/funil
   * Backend retorna { success, funil: [{ etapa, qtd, valor }], totais } —
   * normaliza para { etapa, quantidade, valor } que a tela renderiza.
   */
  getFunil: async () => {
    try {
      const response = await api.get('/crm/funil');
      const d = response.data;
      const etapas = Array.isArray(d) ? d : d?.funil ?? d?.data ?? [];
      return etapas.map((f: any) => ({
        etapa: f.etapa ?? f.label,
        quantidade: safeNumber(f.quantidade ?? f.qtd),
        valor: safeNumber(f.valor),
      }));
    } catch {
      return [];
    }
  },

  /**
   * Metas de vendas - GET /api/vendas/metas
   */
  getMetas: async () => {
    try {
      const response = await api.get('/vendas/metas');
      return asArray(response.data);
    } catch {
      return [];
    }
  },

  /**
   * Clientes - GET /api/clientes
   */
  getClientes: async (params?: { busca?: string; page?: number }) => {
    const response = await api.get('/clientes', { params });
    return response.data;
  },

  /**
   * Cliente por ID - GET /api/clientes/:id
   */
  getCliente: async (id: number) => {
    const response = await api.get(`/clientes/${id}`);
    return response.data;
  },
};

// ============================================================
// RH API - /api/rh/*
// Based on routes/rh-routes.js
// ============================================================
export const rhApi = {
  /**
   * Dados do usuário logado - GET /api/rh/me
   */
  getMe: async () => {
    const response = await api.get('/rh/me');
    return response.data;
  },

  /**
   * Listar funcionários - GET /api/rh/funcionarios
   */
  getFuncionarios: async (params?: { busca?: string; setor?: string }) => {
    const response = await api.get('/rh/funcionarios', { params });
    return response.data;
  },

  /**
   * Funcionário por ID - GET /api/rh/funcionarios/:id
   */
  getFuncionario: async (id: number) => {
    const response = await api.get(`/rh/funcionarios/${id}`);
    return response.data;
  },

  /**
   * Aniversariantes do mês - GET /api/rh/funcionarios/aniversariantes
   */
  getAniversariantes: async () => {
    const response = await api.get('/rh/funcionarios/aniversariantes');
    return response.data;
  },

  /**
   * Meu último holerite - GET /api/rh/holerites/meu-ultimo
   */
  getMeuUltimoHolerite: async () => {
    const response = await api.get('/rh/holerites/meu-ultimo');
    return response.data;
  },

  /**
   * Minhas férias - GET /api/rh/ferias/minhas
   */
  getMinhasFerias: async () => {
    const meResponse = await api.get('/rh/me');
    const me = unwrapData<any>(meResponse.data, meResponse.data);
    const funcionarioId = me?.funcionario_id ?? me?.id;
    if (!funcionarioId) return [];
    const response = await api.get(`/rh/ferias/minhas/${funcionarioId}`);
    return response.data;
  },

  /**
   * Saldo de férias - GET /api/rh/ferias/saldo/:funcionarioId
   */
  getSaldoFerias: async (funcionarioId: number) => {
    const response = await api.get(`/rh/ferias/saldo/${funcionarioId}`);
    return response.data;
  },

  /**
   * Registrar ponto - POST /api/rh/ponto
   */
  registrarPonto: async (tipo: 'entrada' | 'saida' | 'almoco_saida' | 'almoco_retorno') => {
    const response = await api.post('/rh/ponto/marcacoes', {
      tipo,
      data: todayISO(),
      hora: new Date().toTimeString().slice(0, 8),
      origem: 'app',
    });
    return response.data;
  },

  /**
   * Meu ponto hoje - GET /api/rh/ponto/hoje
   */
  getPontoHoje: async () => {
    const date = todayISO();
    const response = await api.get('/rh/ponto/marcacoes', {
      params: { data_inicio: date, data_fim: date },
    });
    const marcacoes = asArray<any>(response.data?.marcacoes ?? response.data);
    const ponto: Record<string, string> = {};
    for (const m of marcacoes) {
      if (m?.tipo) ponto[m.tipo] = m.hora ?? m.created_at ?? m.data_hora;
    }
    return { data: ponto, marcacoes };
  },

  /**
   * Meu histórico de ponto - GET /api/rh/ponto/historico
   */
  getHistoricoPonto: async (params?: { mes?: number; ano?: number }) => {
    const response = await api.get('/rh/ponto/marcacoes', { params });
    return response.data;
  },

  /**
   * Enviar atestado médico - POST /api/rh/atestados (multipart/form-data)
   * Campos: arquivo (file), data_inicio, data_fim, tipo, observacoes
   */
  enviarAtestado: async (formData: FormData) => {
    const response = await api.post('/rh/atestados', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Meus atestados - GET /api/rh/atestados/meus
   */
  getMeusAtestados: async () => {
    const response = await api.get('/rh/meus-atestados');
    return response.data;
  },

  /**
   * Minhas solicitações - GET /api/rh/solicitacoes/minhas
   */
  getMinhasSolicitacoes: async () => {
    const response = await api.get('/rh/solicitacoes');
    return response.data;
  },

  /**
   * Criar solicitação - POST /api/rh/solicitacoes
   * Tipos: ferias, adiantamento, documento, folga, outros
   */
  criarSolicitacao: async (dados: {
    tipo: 'ferias' | 'adiantamento' | 'documento' | 'folga' | 'outros';
    descricao: string;
    data_inicio?: string;
    data_fim?: string;
  }) => {
    const response = await api.post('/rh/solicitacoes', dados);
    return response.data;
  },
};

// ============================================================
// PCP API - /api/pcp/*
// Based on routes/pcp-routes.js
// ============================================================
export const pcpApi = {
  /**
   * Dashboard PCP - GET /api/pcp/dashboard
   */
  getDashboard: async () => {
    const response = await api.get('/pcp/dashboard');
    return response.data;
  },

  /**
   * Ordens de produção - GET /api/pcp/ordens
   */
  getOrdens: async (params?: { status?: string; busca?: string }) => {
    const response = await api.get('/pcp/ordens', { params });
    return response.data;
  },

  /**
   * Ordem por ID - GET /api/pcp/ordens/:id
   */
  getOrdem: async (id: number) => {
    const response = await api.get(`/pcp/ordens/${id}`);
    return response.data;
  },

  /**
   * Eficiência - GET /api/pcp/eficiencia
   */
  getEficiencia: async () => {
    const response = await api.get('/pcp/eficiencia');
    return response.data;
  },

  /**
   * Setores - GET /api/pcp/setores
   */
  getSetores: async () => {
    const response = await api.get('/pcp/setores');
    return response.data;
  },

  // ── Apontamentos de Produção ────────────────────────────────

  /** OPs disponíveis para apontamento - GET /api/pcp/apontamentos/ordens */
  getOrdensParaApontamento: async (status?: string) => {
    const response = await api.get('/pcp/apontamentos/ordens', { params: { status } });
    const d = response.data;
    return Array.isArray(d) ? d : d?.data ?? [];
  },

  /** Estatísticas do dia - GET /api/pcp/apontamentos/stats */
  getApontamentosStats: async () => {
    const response = await api.get('/pcp/apontamentos/stats');
    return response.data;
  },

  /** Meus apontamentos - GET /api/pcp/apontamentos/meus */
  getMeusApontamentos: async () => {
    const response = await api.get('/pcp/apontamentos/meus');
    const d = response.data;
    return Array.isArray(d) ? d : d?.data ?? [];
  },

  /**
   * Registrar apontamento - POST /api/pcp/apontamentos/chao
   * (anti-duplicidade + suporte a colunas extras)
   */
  registrarApontamento: async (dados: {
    tipo_atividade: string;
    nome_atividade: string;
    hora_inicio: string;
    hora_fim: string;
    duracao_segundos: number;
    ordem_producao_id?: number | null;
    produto_descricao?: string;
    quantidade_produzida?: number;
    quantidade_refugo?: number;
    maquina?: string;
    turno?: string;
    observacoes?: string;
  }) => {
    const response = await api.post('/pcp/apontamentos/chao', dados);
    return response.data;
  },
};

// ============================================================
// LOGISTICA API - /api/logistica/*
// Based on routes/logistica-routes.js
// ============================================================
export const logisticaApi = {
  /**
   * Dashboard logística - GET /api/logistica/dashboard
   */
  getDashboard: async () => {
    const response = await api.get('/logistica/dashboard');
    return response.data;
  },

  /**
   * Entregas - GET /api/logistica/entregas
   */
  getEntregas: async (params?: { status?: string; data?: string }) => {
    const response = await api.get('/logistica/pedidos', { params });
    return response.data;
  },

};

// ============================================================
// FATURAMENTO/NF-e API - /api/nfe/*
// Based on routes/nfe-routes.js
// ============================================================
export const faturamentoApi = {
  /**
   * Listar notas fiscais - GET /api/nfe/notas
   */
  getNotas: async (params?: { status?: string; busca?: string; page?: number }) => {
    const response = await api.get('/nfe/notas', { params });
    return asArray(response.data);
  },

  /**
   * Nota por ID - GET /api/nfe/notas/:id
   */
  getNota: async (id: number) => {
    const response = await api.get(`/nfe/notas/${id}`);
    return response.data;
  },

  /**
   * Resumo de faturamento - GET /api/nfe/resumo
   */
  getResumo: async (params?: { mes?: number; ano?: number }) => {
    const response = await api.get('/nfe/dashboard', { params });
    return response.data;
  },

  /**
   * DANFE (PDF) - GET /api/nfe/danfe/:id
   */
  getDanfe: async (id: number) => {
    const response = await api.get(`/nfe/danfe/${id}`, { responseType: 'blob' });
    return response.data;
  },
};

// ============================================================
// COMPRAS API - /api/compras/*
// Based on routes/compras-routes.js
// ============================================================
export const comprasApi = {
  /**
   * Dashboard compras - GET /api/compras/dashboard
   */
  getDashboard: async () => {
    const response = await api.get('/compras/dashboard');
    return response.data;
  },

  /**
   * Pedidos de compra - GET /api/compras/pedidos
   */
  getPedidos: async (params?: { status?: string; busca?: string }) => {
    const response = await api.get('/compras/pedidos', { params });
    return response.data;
  },

  /**
   * Pedido por ID - GET /api/compras/pedidos/:id
   */
  getPedido: async (id: number) => {
    const response = await api.get(`/compras/pedidos/${id}`);
    return response.data;
  },

  /**
   * Fornecedores - GET /api/fornecedores
   */
  getFornecedores: async (params?: { busca?: string }) => {
    const response = await api.get('/fornecedores', { params });
    return response.data;
  },

  /**
   * Fornecedor por ID - GET /api/fornecedores/:id
   */
  getFornecedor: async (id: number) => {
    const response = await api.get(`/fornecedores/${id}`);
    return response.data;
  },
};

// ============================================================
// NOTIFICACOES API - /api/notificacoes/*
// ============================================================
export const notificacoesApi = {
  /**
   * Listar notificações - GET /api/notificacoes
   * Endpoint público — filtra por usuario_id (req.user não é definido sem auth middleware).
   * Passa usuario_id explicitamente na query.
   */
  getAll: async (params?: { page?: number; limit?: number; usuario_id?: number }) => {
    const response = await api.get('/notificacoes', {
      params: { limite: params?.limit ?? 30, ...params },
    });
    const d = response.data;
    // Backend retorna { success, data: [] }
    return Array.isArray(d) ? d : d?.data ?? [];
  },

  /**
   * Não lidas - GET /api/notificacoes/nao-lidas
   */
  getNaoLidas: async (usuario_id?: number) => {
    const response = await api.get('/notificacoes/nao-lidas', { params: { usuario_id } });
    const d = response.data;
    return d?.count ?? d?.total ?? 0;
  },

  /** Alertas automáticos do sistema - GET /api/notificacoes/alertas */
  getAlertas: async () => {
    try {
      const response = await api.get('/notificacoes/alertas');
      const d = response.data;
      return Array.isArray(d) ? d : d?.alertas ?? d?.data ?? [];
    } catch {
      return [];
    }
  },

  /** Marcar como lida - PATCH /api/notificacoes/:id/lida */
  markAsRead: async (id: number) => {
    const response = await api.put(`/notificacoes/${id}/lida`);
    return response.data;
  },

  /** Marcar todas como lidas - PATCH /api/notificacoes/marcar-todas-lidas */
  markAllAsRead: async (usuario_id?: number) => {
    const response = await api.put('/notificacoes/marcar-todas-lidas', { usuario_id });
    return response.data;
  },
};

export const pushApi = {
  register: async (token: string, platform: 'ios' | 'android' | 'web') => {
    const response = await api.post('/push/register', { token, platform });
    return response.data;
  },
  unregister: async (token: string) => {
    const response = await api.delete('/push/unregister', { data: { token } });
    return response.data;
  },
};

// ============================================================
// PRODUTOS API - /api/produtos/*
// ============================================================
export const produtosApi = {
  /**
   * Listar produtos - GET /api/produtos
   */
  getAll: async (params?: { busca?: string; categoria?: string; page?: number }) => {
    const response = await api.get('/produtos', { params });
    return response.data;
  },

  /**
   * Produto por ID - GET /api/produtos/:id
   */
  get: async (id: number) => {
    const response = await api.get(`/produtos/${id}`);
    return response.data;
  },

  /**
   * Estoque - GET /api/produtos/:id/estoque
   */
  getEstoque: async (id: number) => {
    const response = await api.get(`/produtos/${id}/estoque`);
    return response.data;
  },
};
