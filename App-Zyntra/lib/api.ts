import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from './secure-store';
import { API_BASE_URL, API_TIMEOUT, TREVO_API_BASE_URL, apiBaseForEmail, setCurrentApiBase } from './constants';
import * as fila from './offline-queue';
import type { ItemFila, MetodoEscrita } from './offline-queue';
import type { EspelhoPontoDia, EspelhoPontoResponse, User } from '@/types';

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

/**
 * `data_inicio`/`data_fim` (1º ao último dia do mês) para GET /rh/espelho-ponto.
 * Trunca no dia de hoje quando o mês pedido é o atual (não há ponto no futuro).
 */
export function periodoDoMes(ano: number, mes: number): { data_inicio: string; data_fim: string } {
  const inicio = new Date(ano, mes - 1, 1);
  const ultimoDia = new Date(ano, mes, 0);
  const hoje = new Date();
  const fim = ultimoDia > hoje ? hoje : ultimoDia;
  return { data_inicio: inicio.toISOString().slice(0, 10), data_fim: fim.toISOString().slice(0, 10) };
}

/** Nomes de batida legíveis, para o rótulo da fila offline. */
const ROTULO_PONTO: Record<string, string> = {
  entrada: 'entrada',
  saida: 'saída',
  almoco_saida: 'saída para almoço',
  almoco_retorno: 'retorno do almoço',
};

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

// ============================================================
// FILA OFFLINE — ver lib/offline-queue.ts
// ============================================================

// Campos que o app pendura no config do axios para controlar a fila. Declarados
// no próprio tipo do axios para que `api.post(url, dados, { rotuloOffline })`
// seja verificado pelo TypeScript em vez de precisar de cast em cada chamada.
declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Rótulo curto mostrado ao usuário no banner ("Ponto — entrada"). */
    rotuloOffline?: string;
    /** Impede o enfileiramento (login, logout: refazer na mão é o certo). */
    semFila?: boolean;
    /** true quando a própria fila está reenviando — não enfileirar de novo. */
    _daFila?: boolean;
    /** Chave de idempotência desta escrita, criada na PRIMEIRA tentativa. */
    _chaveIdem?: string;
  }
}

type ConfigComFila = InternalAxiosRequestConfig & { _retry?: boolean };

/** Rótulo de fallback, quando a chamada não informou um. */
function rotuloPadrao(config: InternalAxiosRequestConfig): string {
  const url = String(config.url || '').replace(/^\//, '');
  return url ? `Envio para ${url}` : 'Envio pendente';
}

/**
 * Erro de rede = requisição saiu e não voltou resposta nenhuma. Um 500 tem
 * `response` e NÃO é falta de rede: repetir um 500 automaticamente é insistir
 * num bug do servidor. Timeout entra porque no celular é quase sempre sinal
 * ruim, não servidor lento.
 */
function ehErroDeRede(error: AxiosError): boolean {
  if (error.response) return false;
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;
  if (error.code === 'ERR_NETWORK' || error.code === 'ERR_CANCELED') return error.code !== 'ERR_CANCELED';
  return Boolean(error.request);
}

/** Marca posta no erro quando a escrita foi salva na fila em vez de perdida. */
export interface ErroEnfileirado extends AxiosError {
  enfileirado?: boolean;
  itemFila?: ItemFila;
}

/** A tela usa isto para dizer "salvo, vai quando a rede voltar" em vez de "erro". */
export function foiEnfileirado(erro: unknown): boolean {
  return Boolean((erro as ErroEnfileirado)?.enfileirado);
}

// Request interceptor - add auth token
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const savedBase = await SecureStore.getItemAsync(API_BASE_KEY);
    if (savedBase) config.baseURL = savedBase;
    const token = await tokenStorage.getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Chave de idempotência em TODA escrita, já na primeira tentativa. Se a rede
    // cair depois de o servidor gravar, o reenvio leva a mesma chave e o
    // middleware do backend devolve a resposta original em vez de gravar de novo.
    const comFila = config as ConfigComFila;
    if (config.headers && fila.podeEnfileirar(config.method, config.data) && !comFila.semFila) {
      if (!comFila._chaveIdem) comFila._chaveIdem = fila.novaChaveIdempotencia();
      config.headers['X-Idempotency-Key'] = comFila._chaveIdem;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors and token refresh
api.interceptors.response.use(
  (response) => {
    // Resposta boa = a rede voltou. É o gatilho mais barato que existe para
    // drenar a fila: não precisa de NetInfo nem de timer, e acontece
    // naturalmente assim que o usuário abre qualquer tela que carrega dados.
    const config = response.config as ConfigComFila;
    if (!config?._daFila) void drenarFilaSeHouver();
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as ConfigComFila;

    // Sem resposta do servidor numa escrita: guarda em vez de perder.
    if (
      originalRequest &&
      !originalRequest._daFila &&
      !originalRequest.semFila &&
      ehErroDeRede(error) &&
      fila.podeEnfileirar(originalRequest.method, originalRequest.data)
    ) {
      try {
        const item = await fila.enfileirar({
          id: originalRequest._chaveIdem || fila.novaChaveIdempotencia(),
          metodo: String(originalRequest.method).toLowerCase() as MetodoEscrita,
          url: String(originalRequest.url || ''),
          dados: desserializarCorpo(originalRequest.data),
          rotulo: originalRequest.rotuloOffline || rotuloPadrao(originalRequest),
        });
        if (item) {
          const marcado = error as ErroEnfileirado;
          marcado.enfileirado = true;
          marcado.itemFila = item;
        }
      } catch {
        // Falha ao gravar na fila não pode virar um segundo erro por cima do
        // erro de rede: o usuário recebe o original e tenta de novo.
      }
      return Promise.reject(error);
    }

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

/**
 * No handler de erro o axios já serializou o corpo para string. Guardar a
 * string crua faria o reenvio mandar JSON dentro de JSON (`"{\"tipo\":...}"`),
 * que o servidor recebe como texto e rejeita.
 */
function desserializarCorpo(dados: unknown): unknown {
  if (typeof dados !== 'string') return dados;
  try {
    return JSON.parse(dados);
  } catch {
    return dados;
  }
}

/** Classifica a resposta de um reenvio para a fila decidir o que fazer. */
function classificarFalha(error: AxiosError): fila.ResultadoEnvio {
  if (ehErroDeRede(error)) return { ok: false, semRede: true };

  const status = error.response?.status ?? 0;
  // 4xx é o servidor dizendo que a requisição está errada — repetir não conserta.
  // 408 (timeout) e 429 (excesso) são as exceções: valem nova tentativa depois.
  const definitivo = status >= 400 && status < 500 && status !== 408 && status !== 429;
  const corpo = error.response?.data as { message?: string } | undefined;
  return {
    ok: false,
    definitivo,
    erro: corpo?.message || error.message || `Erro ${status}`,
  };
}

/**
 * Reenvia a fila inteira. `_daFila` evita que uma falha aqui reenfileire o item
 * (ele já está na fila) e que um sucesso dispare outro dreno recursivo.
 */
export async function enviarFilaOffline(): Promise<fila.ResumoSincronizacao> {
  return fila.sincronizar(async (item) => {
    try {
      await api.request({
        method: item.metodo,
        url: item.url,
        data: item.dados,
        // A MESMA chave da tentativa original: é isso que faz o servidor
        // reconhecer o reenvio e devolver a resposta de antes em vez de gravar
        // um segundo registro.
        headers: { 'X-Idempotency-Key': item.id },
        _daFila: true,
      });
      return { ok: true };
    } catch (error) {
      return classificarFalha(error as AxiosError);
    }
  });
}

let drenoAgendado = false;

/**
 * Dreno oportunista, chamado a cada resposta bem-sucedida. Só roda se houver
 * fila, e coalesce as chamadas: uma tela que dispara seis requisições em
 * paralelo não pode disparar seis drenos.
 */
export async function drenarFilaSeHouver(): Promise<void> {
  if (drenoAgendado) return;
  drenoAgendado = true;
  try {
    if (await fila.contarPendentes()) await enviarFilaOffline();
  } catch {
    // dreno é best-effort: nunca pode quebrar a requisição que o disparou
  } finally {
    drenoAgendado = false;
  }
}

export { fila as filaOffline };

/**
 * Aponta o axios para o backend da empresa detectada PELO E-MAIL DIGITADO, antes do
 * login em si.
 *
 * Até 12/09/2026 só `authApi.login` trocava a base (e só no momento do envio do
 * formulário). Duas chamadas que acontecem ANTES disso, enquanto a pessoa ainda
 * digita — `previewUser` (saudação com nome/foto) e `getCaptchaStatus` (chave do
 * Cloudflare Turnstile) — continuavam batendo sempre na base com que o axios foi
 * criado (Aluforce, num app recém-instalado). Resultado prático para Energy/
 * Eletric/Cobal num aparelho novo:
 *   - a saudação nunca aparecia (o preview consultava o cadastro de outra empresa);
 *   - pior, o captcha carregava a site key do CLOUDFLARE DA ALUFORCE — como o
 *     Turnstile valida a site key contra o domínio de origem, o token gerado não
 *     validava no /auth/login da empresa certa, e o login travava com erro de
 *     captcha sem explicação plausível para quem está tentando entrar.
 *
 * Não persiste em SecureStore — é só um palpite de sessão enquanto o e-mail não
 * foi confirmado por um login bem-sucedido. A persistência de verdade continua
 * acontecendo dentro de `authApi.login`.
 */
export function apontarBackendParaEmail(email: string): string {
  const base = apiBaseForEmail(email);
  api.defaults.baseURL = base;
  setCurrentApiBase(base);
  return base;
}

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
  /**
   * Política de captcha do servidor - GET /api/captcha/status
   *
   * Em produção as 3 instâncias respondem `modo: "always"` com Cloudflare
   * Turnstile: sem `captchaResposta` o login volta 400/CAPTCHA_REQUIRED, com senha
   * certa ou errada. Por isso a tela consulta isto antes de deixar enviar.
   */
  getCaptchaStatus: async (): Promise<{
    obrigatorio: boolean;
    provedor: string;
    siteKey?: string;
    modo?: string;
  } | null> => {
    try {
      const response = await api.get('/captcha/status', { timeout: 10000 });
      const d = response.data;
      if (!d?.success) return null;
      return {
        obrigatorio: !!d.obrigatorio,
        provedor: String(d.provedor || ''),
        siteKey: d.siteKey || undefined,
        modo: d.modo,
      };
    } catch {
      // Sem resposta, a tela deixa tentar: quem decide de verdade é o servidor,
      // e travar o login por causa de uma sonda que falhou seria pior.
      return null;
    }
  },

  /**
   * Login - POST /api/auth/login
   *
   * `captchaResposta` é o nome que o backend espera TAMBÉM para provedor externo:
   * `utils/captcha.js` → `validar()` manda `entrada.resposta` para o siteverify da
   * Cloudflare. O campo `captchaToken` só é usado pelo desafio interno (imagem SVG).
   */
  login: async (credentials: {
    email: string;
    password: string;
    captchaResposta?: string;
    /**
     * CPF (só dígitos) quando o usuário entrou pela aba CPF.
     *
     * Vai JUNTO com o e-mail, e não no lugar dele, porque os dois têm papéis
     * diferentes: o e-mail (resolvido pelo preview) escolhe a INSTÂNCIA para onde
     * a requisição vai; o CPF é o que autentica e é o que faz o servidor carimbar
     * `escopo: 'rh'` no token. Mandar só o e-mail — como o app fazia — abria uma
     * sessão PLENA, mais acesso do que o mesmo CPF tem na web.
     */
    cpf?: string;
  }) => {
    const companyBase = apiBaseForEmail(credentials.email);
    await SecureStore.setItemAsync(API_BASE_KEY, companyBase);
    api.defaults.baseURL = companyBase;
    setCurrentApiBase(companyBase); // getAvatarUrl (síncrona) passa a resolver a foto certa já neste login
    const response = await api.post('/auth/login', credentials, { semFila: true });

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
      await api.post('/auth/logout', undefined, { semFila: true });
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
      const response = await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() }, { semFila: true });
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
   * Minha ficha - GET /api/rh/meus-dados
   * Self-scoped no backend (resolve usuarios.funcionario_id → e-mail → nome).
   * `/api/me` NÃO serve: devolve a conta de acesso, sem cargo/setor/admissão.
   */
  getMeusDados: async () => {
    const response = await api.get('/rh/meus-dados');
    return unwrapData<any>(response.data, response.data);
  },

  /**
   * Meus holerites - GET /api/rh/holerites/meus
   * Lista completa por competência. O app mostrava só `/meu-ultimo`.
   */
  getMeusHolerites: async () => {
    const response = await api.get('/rh/holerites/meus');
    return asArray<any>(response.data);
  },

  /**
   * Confirmar recebimento - PUT /api/rh/holerites/:id/confirmar
   * Equivale ao aceite do portal web; o handler confere o dono.
   */
  confirmarHolerite: async (id: number) => {
    const response = await api.put(`/rh/holerites/${id}/confirmar`, {}, {
      rotuloOffline: `Confirmação de holerite #${id}`,
    });
    return response.data;
  },

  /**
   * Detalhe do holerite - GET /api/rh/holerites/:id
   * Traz as verbas (proventos/descontos) para mostrar o demonstrativo na tela.
   */
  getHolerite: async (id: number) => {
    const response = await api.get(`/rh/holerites/${id}`);
    const d = response.data;
    return {
      holerite: d?.holerite ?? d?.data ?? d,
      itens: asArray<any>(d?.itens ?? d?.verbas ?? d?.lancamentos),
    };
  },

  /** Benefícios da empresa - GET /api/rh/beneficios */
  getBeneficios: async () => {
    const response = await api.get('/rh/beneficios');
    return asArray<any>(response.data);
  },

  /**
   * Espelho de ponto - GET /api/rh/espelho-ponto
   * Vive em `routes/rh-extras.js`, que exige só login (não a área `rh`).
   * A rota aceita `data_inicio`/`data_fim` (não `mes`/`ano`) e devolve o array de dias
   * em `registros` — quem chama calcula o período do mês desejado.
   */
  getEspelhoPonto: async (params: {
    data_inicio: string;
    data_fim: string;
  }): Promise<EspelhoPontoResponse> => {
    const response = await api.get('/rh/espelho-ponto', { params });
    const d = response.data;
    return {
      vinculado: d?.vinculado !== false,
      funcionario: d?.funcionario,
      periodo: d?.periodo ?? null,
      resumo: d?.resumo ?? null,
      dias: asArray<EspelhoPontoDia>(d?.registros),
      message: d?.message,
    };
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
    // `data`/`hora` são calculados AQUI, não no servidor: se a batida for para a
    // fila e só subir horas depois, o horário que vale é o do momento em que o
    // usuário bateu — não o do reenvio.
    const response = await api.post(
      '/rh/ponto/marcacoes',
      {
        tipo,
        data: todayISO(),
        hora: new Date().toTimeString().slice(0, 8),
        origem: 'app',
      },
      { rotuloOffline: `Ponto — ${ROTULO_PONTO[tipo] ?? tipo}` }
    );
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
    const response = await api.post('/rh/solicitacoes', dados, {
      rotuloOffline: `Solicitação de RH — ${dados.tipo}`,
    });
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
    const response = await api.post('/pcp/apontamentos/chao', dados, {
      rotuloOffline: `Apontamento — ${dados.nome_atividade || dados.tipo_atividade}`,
    });
    return response.data;
  },
};

// ============================================================
// CRM API - /api/crm/*
// Based on routes/crm-routes.js
//
// O router inteiro é protegido por authorizeArea('vendas'): usuário sem a área
// recebe 403, não lista vazia. A tela é escondida pelo mesmo gate (MODULES).
// ============================================================
export const crmApi = {
  /**
   * Funil + totais - GET /api/crm/funil
   * → { funil: [{etapa,nome,cor,qtd,valor,valor_ponderado}], totais: {...}, etapas: [...] }
   */
  getFunil: async () => {
    const response = await api.get('/crm/funil');
    const d = response.data ?? {};
    return {
      funil: asArray<any>(d.funil),
      etapas: asArray<any>(d.etapas),
      totais: (d.totais ?? {}) as {
        pipeline?: number;
        ganho?: number;
        perdido?: number;
        ponderado?: number;
        abertas?: number;
        ganhas?: number;
        perdidas?: number;
        taxa_conversao?: number;
      },
    };
  },

  /** Oportunidades - GET /api/crm/oportunidades */
  getOportunidades: async (params?: {
    etapa?: string;
    status?: string;
    temperatura?: string;
    q?: string;
  }) => {
    const response = await api.get('/crm/oportunidades', { params });
    return asArray<any>(response.data);
  },

  /**
   * Tarefas - GET /api/crm/tarefas
   * `minhas=1` filtra pelo usuário da sessão; `hoje`/`vencidas` são os recortes
   * que interessam no celular.
   */
  getTarefas: async (params?: {
    minhas?: '1';
    concluida?: 0 | 1;
    hoje?: '1';
    vencidas?: '1';
  }) => {
    const response = await api.get('/crm/tarefas', { params });
    return asArray<any>(response.data);
  },

  /** Concluir/reabrir tarefa - PATCH /api/crm/tarefas/:id/concluir */
  concluirTarefa: async (id: number, concluida: boolean) => {
    const response = await api.patch(
      `/crm/tarefas/${id}/concluir`,
      { concluida: concluida ? 1 : 0 },
      { rotuloOffline: `Tarefa ${concluida ? 'concluída' : 'reaberta'} (#${id})` }
    );
    return response.data;
  },

  /** Nova tarefa - POST /api/crm/tarefas */
  criarTarefa: async (dados: {
    titulo: string;
    descricao?: string;
    tipo?: string;
    data_prevista?: string;
    prioridade?: 'baixa' | 'media' | 'alta';
    oportunidade_id?: number | null;
  }) => {
    const response = await api.post('/crm/tarefas', dados, {
      rotuloOffline: `Tarefa — ${dados.titulo}`,
    });
    return response.data;
  },
};

// ============================================================
// TAREFAS API - /api/tarefas/*
// Based on routes/tarefas-routes.js (tabela painel_tarefas)
//
// Só exige login — não tem área própria, é o quadro do painel. Por isso a tela
// nativa entra sem `area` no catálogo de MODULES.
// ============================================================
export type StatusTarefa = 'pendente' | 'em_execucao' | 'realizada' | 'cancelada';

export const tarefasApi = {
  /**
   * Lista + contadores - GET /api/tarefas
   * → { tarefas: [...], counts: {total,pendente,em_execucao,realizada}, origens: [...] }
   */
  listar: async (params?: {
    status?: StatusTarefa | 'todos';
    origem?: string;
    q?: string;
    previsto?: 'todos' | 'hoje' | 'semana' | 'mes' | 'atrasadas';
    limit?: number;
  }) => {
    const response = await api.get('/tarefas', { params });
    const d = response.data ?? {};
    return {
      tarefas: asArray<any>(d.tarefas),
      counts: (d.counts ?? {}) as {
        total?: number;
        pendente?: number;
        em_execucao?: number;
        realizada?: number;
      },
      origens: asArray<string>(d.origens),
    };
  },

  /** Nova tarefa - POST /api/tarefas */
  criar: async (dados: {
    descricao: string;
    prioridade?: 'baixa' | 'media' | 'alta';
    previsao?: string | null;
    observacoes?: string;
    tipo?: string;
  }) => {
    const response = await api.post(
      '/tarefas',
      { ...dados, origem: 'App' },
      { rotuloOffline: `Tarefa — ${dados.descricao.slice(0, 40)}` }
    );
    return response.data;
  },

  /** Mudar status - PUT /api/tarefas/:id */
  mudarStatus: async (id: number, status: StatusTarefa) => {
    const response = await api.put(
      `/tarefas/${id}`,
      { status },
      { rotuloOffline: `Tarefa #${id} → ${status.replace('_', ' ')}` }
    );
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

  /**
   * Alertas de movimentação - GET /api/notificacoes-movimentacoes/pendentes
   *
   * Consultar esta rota também DISPARA a detecção no servidor (pedido aprovado,
   * pedido faturado para o vendedor, holerite publicado, resumo do dia a
   * pagar/receber). O servidor também roda um passe a cada 5 min por conta
   * própria — é ele que faz o push chegar com o app fechado —, mas chamar aqui
   * garante que abrir a tela mostra o que acabou de acontecer.
   */
  getMovimentacoes: async () => {
    try {
      const response = await api.get('/notificacoes-movimentacoes/pendentes');
      return asArray<any>(response.data?.pendentes);
    } catch {
      // Instância ainda sem o módulo: a tela continua com as outras fontes.
      return [];
    }
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
    const response = await api.post('/push/register', { token, platform }, { semFila: true });
    return response.data;
  },
  unregister: async (token: string) => {
    const response = await api.delete('/push/unregister', { data: { token }, semFila: true });
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

// ============================================================
// TREVO API — sistema separado (modules/Trevo/server.js), fora do grupo
// Aluforce/Energy/Eletric/Cobal. Login por usuário+senha (não e-mail de domínio
// corporativo), sem RH/PCP — ERP de loja de autopeças (vendas, estoque, financeiro).
// Reaproveita a mesma instância `api` (Bearer + baseURL dinâmica); só o login e os
// paths batem com o formato próprio do backend da Trevo (sem prefixo /auth).
// ============================================================
export const trevoApi = {
  /** Login - POST /login (no host da Trevo). Guarda token + um User sintético. */
  login: async (
    usuario: string,
    senha: string,
    lembrar?: boolean
  ): Promise<{ success: true; user: User; token?: string }> => {
    await SecureStore.setItemAsync(API_BASE_KEY, TREVO_API_BASE_URL);
    api.defaults.baseURL = TREVO_API_BASE_URL;
    setCurrentApiBase(TREVO_API_BASE_URL);
    const response = await api.post('/login', { usuario, senha, lembrar }, { semFila: true });
    const d = response.data;
    const user: User = {
      id: Number(d.id) || 0,
      nome: d.nome,
      email: d.usuario,
      role: 'usuario',
      is_admin: false,
      areas: [],
      company: 'trevo',
    };
    if (d.token) await tokenStorage.setToken(d.token);
    await tokenStorage.setUserData(user);
    return { success: true, user, token: d.token };
  },

  /** GET /me — usado para validar/atualizar a sessão ao reabrir o app. */
  getMe: async () => {
    const response = await api.get('/me');
    return response.data as { usuario: string; nome: string };
  },

  /** POST /logout */
  logout: async () => {
    try {
      await api.post('/logout', undefined, { semFila: true });
    } finally {
      await tokenStorage.clearTokens();
    }
  },

  /** Resumo para o Painel - GET /dashboard */
  getDashboard: async () => {
    const response = await api.get('/dashboard');
    return response.data;
  },

  /** GET /vendas */
  getVendas: async (params?: { busca?: string; status?: string; limite?: number }) => {
    const response = await api.get('/vendas', { params });
    return asArray<any>(response.data);
  },

  /** GET /produtos */
  getProdutos: async (params?: {
    busca?: string;
    ativos?: '1';
    abaixo_minimo?: '1';
    categoria?: string;
  }) => {
    const response = await api.get('/produtos', { params });
    return asArray<any>(response.data);
  },

  /** GET /fornecedores */
  getFornecedores: async (params?: { busca?: string }) => {
    const response = await api.get('/fornecedores', { params });
    return asArray<any>(response.data);
  },

  /** GET /contas-pagar */
  getContasPagar: async (params?: {
    status?: string;
    categoria?: string;
    fornecedor_id?: number;
    em_aberto?: '1';
    de?: string;
    ate?: string;
    busca?: string;
  }) => {
    const response = await api.get('/contas-pagar', { params });
    return asArray<any>(response.data);
  },

  /** GET /contas-receber */
  getContasReceber: async (params?: {
    status?: string;
    categoria?: string;
    cliente_id?: number;
    em_aberto?: '1';
    de?: string;
    ate?: string;
    busca?: string;
  }) => {
    const response = await api.get('/contas-receber', { params });
    return asArray<any>(response.data);
  },
};
