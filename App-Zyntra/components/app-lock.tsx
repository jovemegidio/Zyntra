import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Text, TouchableOpacity, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { loadSettings } from '@/lib/settings';
import { Colors } from '@/lib/constants';

export function AppLock() {
  const { isAuthenticated, logout } = useAuth();
  const appState = useRef(AppState.currentState);
  const leftForeground = useRef(false);
  const authenticating = useRef(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    setBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear Zyntra',
        fallbackLabel: 'Usar bloqueio do dispositivo',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
    } finally {
      setBusy(false);
      authenticating.current = false;
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appState.current === 'active' && nextState !== 'active') leftForeground.current = true;
      if (nextState === 'active' && leftForeground.current && isAuthenticated) {
        leftForeground.current = false;
        const settings = await loadSettings();
        if (settings.appLock) {
          setLocked(true);
          setTimeout(unlock, 150);
        }
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) setLocked(false);
  }, [isAuthenticated]);

  const leaveAccount = async () => {
    await logout();
    setLocked(false);
    router.replace('/(public)/login');
  };

  return (
    <Modal visible={locked} animationType="fade" transparent={false} statusBarTranslucent={false}>
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: Colors.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Text style={{ fontSize: 32 }}>🔒</Text>
        </View>
        <Text style={{ color: Colors.text, fontSize: 22, fontWeight: '700' }}>Zyntra bloqueado</Text>
        <Text style={{ color: Colors.muted, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 26 }}>
          Confirme sua identidade para voltar ao sistema.
        </Text>
        <TouchableOpacity
          onPress={unlock}
          disabled={busy}
          style={{ minWidth: 210, height: 48, borderRadius: 12, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Desbloquear</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={leaveAccount} disabled={busy} style={{ marginTop: 18, padding: 10 }}>
          <Text style={{ color: Colors.red, fontSize: 14, fontWeight: '600' }}>Sair desta conta</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
