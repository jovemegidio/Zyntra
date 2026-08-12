import { useEffect, useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

interface BiometricsState {
  isAvailable: boolean;
  isEnrolled: boolean;
  biometricType: BiometricType;
  isLoading: boolean;
}

export function useBiometrics() {
  const [state, setState] = useState<BiometricsState>({
    isAvailable: false,
    isEnrolled: false,
    biometricType: 'none',
    isLoading: true,
  });

  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

      let biometricType: BiometricType = 'none';
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricType = 'facial';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricType = 'fingerprint';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        biometricType = 'iris';
      }

      setState({
        isAvailable: hasHardware,
        isEnrolled,
        biometricType,
        isLoading: false,
      });
    } catch (error) {
      console.error('Error checking biometrics:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const authenticate = useCallback(async (options?: { promptMessage?: string; fallbackLabel?: string }) => {
    if (!state.isAvailable || !state.isEnrolled) {
      return { success: false, error: 'Biometria nao disponivel' };
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: options?.promptMessage || 'Autentique-se para continuar',
        fallbackLabel: options?.fallbackLabel || 'Usar senha',
        disableDeviceFallback: false,
        cancelLabel: 'Cancelar',
      });

      if (result.success) {
        return { success: true };
      }

      return {
        success: false,
        error: result.error === 'user_cancel' ? 'Cancelado pelo usuario' : 'Autenticacao falhou',
      };
    } catch (error) {
      return { success: false, error: 'Erro na autenticacao' };
    }
  }, [state.isAvailable, state.isEnrolled]);

  const getBiometricLabel = useCallback(() => {
    switch (state.biometricType) {
      case 'facial':
        return 'Face ID';
      case 'fingerprint':
        return 'Touch ID';
      case 'iris':
        return 'Iris';
      default:
        return 'Biometria';
    }
  }, [state.biometricType]);

  return {
    ...state,
    authenticate,
    getBiometricLabel,
    refresh: checkBiometrics,
  };
}
