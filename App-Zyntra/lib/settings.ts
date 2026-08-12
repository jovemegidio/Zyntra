import * as SecureStore from './secure-store';

// ════════════════════════════════════════════════════════════════
// PREFERÊNCIAS DO SISTEMA — persistidas em SecureStore (Keychain /
// Keystore no nativo, localStorage no web). Espelha o "modal de
// configurações" do ERP web, adaptado para o app mobile.
// ════════════════════════════════════════════════════════════════

export interface AppSettings {
  // Notificações
  notifPush: boolean;        // chave-mestra de notificações push
  notifSom: boolean;         // tocar som ao notificar
  notifVibracao: boolean;    // vibrar ao notificar
  notifFinanceiro: boolean;  // alertas de contas / fluxo de caixa
  notifVendas: boolean;      // pedidos, metas, funil
  notifProducao: boolean;    // PCP / ordens de produção
  notifRh: boolean;          // RH / ponto / holerite
  notifLogistica: boolean;   // entregas / rotas

  // Segurança
  appLock: boolean;          // exigir biometria ao reabrir o app

  // Dados
  wifiOnly: boolean;         // sincronizar somente em Wi-Fi
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifPush: true,
  notifSom: true,
  notifVibracao: true,
  notifFinanceiro: true,
  notifVendas: true,
  notifProducao: true,
  notifRh: true,
  notifLogistica: true,
  appLock: false,
  wifiOnly: false,
};

const SETTINGS_KEY = 'zyntra_app_settings';

/** Carrega as preferências, mesclando com os defaults (tolerante a chaves novas). */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persiste o objeto completo de preferências. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Falha silenciosa — não bloquear a UI por erro de armazenamento.
  }
}

/** Restaura todas as preferências para o padrão de fábrica. */
export async function resetSettings(): Promise<AppSettings> {
  await saveSettings(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}
