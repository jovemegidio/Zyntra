import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as SecureStore from './secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { authApi, pushApi, trevoApi, setUnauthorizedHandler, tokenStorage } from './api';
import { setCurrentApiBase } from './constants';
import type { User, AuthState } from '@/types';

interface LoginCredentials {
  email: string;
  password: string;
  /**
   * Token do Turnstile. Opcional no tipo porque o login por biometria reusa as
   * credenciais salvas, que nunca guardam captcha — o token é de uso único e
   * expira em minutos, então salvá-lo não faria sentido.
   */
  captchaResposta?: string;
}

interface LoginResponse {
  success: boolean;
  deviceId?: string;
  redirectTo?: string;
  forcePasswordChange?: boolean;
  user?: User;
  token?: string;
  refreshToken?: string;
  message?: string;
}

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<LoginResponse>;
  /** Login da Trevo Autopeças — backend/API separados, sem e-mail/captcha/CPF. */
  loginTrevo: (usuario: string, senha: string, lembrar?: boolean) => Promise<LoginResponse>;
  loginWithBiometrics: (captchaResposta?: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  checkBiometrics: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_KEY = 'zyntra_user';
const BIOMETRIC_ENABLED_KEY = 'zyntra_biometric_enabled';
const CREDENTIALS_KEY = 'zyntra_saved_credentials';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Check for existing session on mount
  useEffect(() => {
    checkAuth();
    setUnauthorizedHandler(() => {
      setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
    });
    return () => setUnauthorizedHandler(undefined);
  }, []);

  const checkAuth = async () => {
    try {
      // Restaura a base de API da empresa da sessão salva ANTES de qualquer leitura de
      // avatar/etc — sem isso, reabrir o app logado numa conta de Energy/Eletric/Cobal
      // mostrava a foto (e qualquer outro asset resolvido por getAvatarUrl) apontando
      // para o domínio da Aluforce até o próximo login. As chamadas via axios já se
      // corrigiam sozinhas (o interceptor em api.ts lê a base salva a cada requisição);
      // isto cobre o caminho síncrono que ele não alcança.
      const apiBase = await tokenStorage.getApiBase();
      setCurrentApiBase(apiBase);

      // First check for stored user data
      const userData = await tokenStorage.getUserData();
      const token = await tokenStorage.getToken();

      if (userData && token) {
        setState({
          user: userData as User,
          token,
          isAuthenticated: true,
          isLoading: false,
        });

        // Refresh em background. Sessão da Trevo: GET /me só devolve {usuario, nome} —
        // não tem /auth/me nem refresh token; validar por aqui já confirma que a sessão
        // ainda é válida (senão o interceptor 401 força logout mais abaixo na cadeia).
        try {
          if ((userData as User).company === 'trevo') {
            const me = await trevoApi.getMe();
            if (me?.nome) {
              const freshUser: User = { ...(userData as User), nome: me.nome };
              await tokenStorage.setUserData(freshUser);
              setState((prev) => ({ ...prev, user: freshUser }));
            }
          } else {
            const profile = await authApi.getProfile();
            // Aceita resposta direta {id, nome, ...} OU wrapper {success, user}
            const freshUser: User | null =
              profile?.id ? (profile as User) :
              profile?.user?.id ? (profile.user as User) :
              null;
            if (freshUser) {
              await tokenStorage.setUserData(freshUser);
              setState(prev => ({ ...prev, user: freshUser }));
            }
          }
        } catch {
          const remainingToken = await tokenStorage.getToken();
          if (!remainingToken) {
            setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
          }
        }
      } else {
        await tokenStorage.clearTokens();
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Auth check error:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const login = useCallback(async (credentials: LoginCredentials): Promise<LoginResponse> => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const response = await authApi.login(credentials);

      if (response.success && response.user) {
        const user = response.user as User;

        // Store user data
        await tokenStorage.setUserData(user);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));

        // Save credentials for biometric login (encrypted)
        const biometricEnabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        if (biometricEnabled === 'true') {
          // Sem o captcha: token de uso único, já consumido neste login.
          await SecureStore.setItemAsync(
            CREDENTIALS_KEY,
            JSON.stringify({ email: credentials.email, password: credentials.password })
          );
        }

        setState({
          user,
          token: response.token || null,
          isAuthenticated: true,
          isLoading: false,
        });

        return response;
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return response;
      }
    } catch (error: any) {
      setState((prev) => ({ ...prev, isLoading: false }));

      // Extract error message from API response
      const message = error.response?.data?.message || 'Erro ao fazer login';
      throw new Error(message);
    }
  }, []);

  const loginTrevo = useCallback(
    async (usuario: string, senha: string, lembrar?: boolean): Promise<LoginResponse> => {
      setState((prev) => ({ ...prev, isLoading: true }));
      try {
        const response = await trevoApi.login(usuario, senha, lembrar);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(response.user));

        setState({
          user: response.user,
          token: response.token || null,
          isAuthenticated: true,
          isLoading: false,
        });

        return response;
      } catch (error: any) {
        setState((prev) => ({ ...prev, isLoading: false }));
        const message = error.response?.data?.message || 'Usuário ou senha inválidos';
        throw new Error(message);
      }
    },
    []
  );

  const refreshUser = useCallback(async () => {
    try {
      const profile = await authApi.getProfile();
      const freshUser: User | null =
        profile?.id ? (profile as User) :
        profile?.user?.id ? (profile.user as User) :
        null;
      if (freshUser) {
        await tokenStorage.setUserData(freshUser);
        setState(prev => ({ ...prev, user: freshUser }));
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  }, []);

  const checkBiometrics = useCallback(async (): Promise<boolean> => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      const hasCredentials = await SecureStore.getItemAsync(CREDENTIALS_KEY);

      return compatible && enrolled && enabled === 'true' && !!hasCredentials;
    } catch {
      return false;
    }
  }, []);

  const loginWithBiometrics = useCallback(async (captchaResposta?: string): Promise<LoginResponse> => {
    const canUseBiometrics = await checkBiometrics();
    if (!canUseBiometrics) {
      throw new Error('Biometria nao disponivel ou nao configurada');
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Autentique-se para acessar o Zyntra',
      fallbackLabel: 'Usar senha',
      disableDeviceFallback: false,
    });

    if (!result.success) {
      throw new Error('Autenticacao biometrica falhou');
    }

    // Retrieve saved credentials and login
    const credentialsJson = await SecureStore.getItemAsync(CREDENTIALS_KEY);
    if (!credentialsJson) {
      throw new Error('Credenciais não encontradas. Faça login manualmente.');
    }

    // O captcha vale para o login biométrico também: o servidor exige o desafio em
    // TODA tentativa (`CAPTCHA_LOGIN=always`), e a credencial salva não tem token.
    // Quem passa o token é a tela, que já mantém o widget resolvido.
    const credentials = JSON.parse(credentialsJson) as LoginCredentials;
    return login({ ...credentials, captchaResposta });
  }, [checkBiometrics, login]);

  const logout = useCallback(async () => {
    // Sessão da Trevo nunca registra push (backend não tem /push/register) e
    // encerra em /logout, não /auth/logout.
    const isTrevo = state.user?.company === 'trevo';

    if (!isTrevo) {
      const pushToken = await tokenStorage.getPushToken();
      if (pushToken) {
        try {
          await pushApi.unregister(pushToken);
        } catch {
          // O logout local não deve depender da disponibilidade do serviço push.
        }
      }
    }
    try {
      await (isTrevo ? trevoApi.logout() : authApi.logout());
    } catch {
      // Continue logout even if API fails
    }

    await tokenStorage.clearTokens();
    await tokenStorage.clearPushToken();
    await SecureStore.deleteItemAsync(USER_KEY);
    // Keep credentials for biometric login, but clear everything else

    setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, [state.user]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        loginTrevo,
        loginWithBiometrics,
        logout,
        checkBiometrics,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper to enable/disable biometrics
export async function setBiometricsEnabled(enabled: boolean) {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');

  // If disabling, also clear saved credentials
  if (!enabled) {
    await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
  }
}

export async function getBiometricsEnabled(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return value === 'true';
}

// Save credentials for biometric login
export async function saveCredentialsForBiometrics(credentials: LoginCredentials) {
  // Guarda só e-mail e senha: o token do captcha é de uso único e expira em
  // minutos, então persistir seria guardar lixo — e o reenvio de um token já
  // consumido é recusado pela Cloudflare.
  const { email, password } = credentials;
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify({ email, password }));
  await setBiometricsEnabled(true);
}

// Clear saved credentials
export async function clearSavedCredentials() {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
  await setBiometricsEnabled(false);
}
