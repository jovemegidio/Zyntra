import { Platform } from 'react-native';
import * as ExpoSecureStore from 'expo-secure-store';

/**
 * Adaptador de armazenamento seguro com fallback para web.
 *
 * - Nativo (iOS/Android): usa expo-secure-store (Keychain / Keystore).
 * - Web (preview no navegador): expo-secure-store NÃO é suportado e lança
 *   erro, o que quebrava o fluxo de login silenciosamente. Aqui usamos
 *   localStorage como fallback para permitir testar o app no navegador.
 *
 * A API espelha a do expo-secure-store (getItemAsync/setItemAsync/deleteItemAsync).
 */

const isWeb = Platform.OS === 'web';

function webGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (isWeb) return webGet(key);
  return ExpoSecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignora indisponibilidade de localStorage (ex.: modo privado)
    }
    return;
  }
  await ExpoSecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignora
    }
    return;
  }
  await ExpoSecureStore.deleteItemAsync(key);
}
