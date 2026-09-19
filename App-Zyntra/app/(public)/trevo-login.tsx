import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { lightColors as C } from '@/lib/theme';
import { Input, Button, IconBack, IconEye } from '@/components/ui';

/**
 * Login da Trevo Autopeças — sistema/API separados do restante do grupo
 * (Aluforce/Energy/Eletric/Cobal). Sem e-mail/captcha/CPF: o backend da Trevo
 * autentica por usuário+senha (`modules/Trevo/server.js`, POST /api/login).
 */
export default function TrevoLoginScreen() {
  const { loginTrevo } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!usuario.trim() || !senha) {
      setErrorMsg('Informe o usuário e a senha.');
      return;
    }
    setErrorMsg(null);
    setBusy(true);
    try {
      await loginTrevo(usuario.trim(), senha, lembrar);
      router.replace('/(trevo)');
    } catch (error: any) {
      setErrorMsg(error?.message || 'Usuário ou senha inválidos');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 18, alignSelf: 'flex-start' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <IconBack size={16} color={C.accent} />
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: C.accent }}>Voltar</Text>
          </TouchableOpacity>

          <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, letterSpacing: -0.3 }}>
            Trevo Autopeças
          </Text>
          <Text style={{ fontSize: 13.5, color: C.muted, marginTop: 4, marginBottom: 26 }}>
            Acesso separado do sistema Zyntra principal.
          </Text>

          <View
            style={{
              backgroundColor: C.card,
              borderRadius: 16,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            {errorMsg && (
              <View style={{ padding: 12, borderRadius: 9, backgroundColor: C.redDim }}>
                <Text style={{ fontSize: 12.5, color: C.red, lineHeight: 18 }}>{errorMsg}</Text>
              </View>
            )}

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '500', color: C.text }}>Usuário</Text>
              <Input
                value={usuario}
                onChangeText={(v) => { setErrorMsg(null); setUsuario(v); }}
                placeholder="seu e-mail de acesso"
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '500', color: C.text }}>Senha</Text>
              <Input
                value={senha}
                onChangeText={(v) => { setErrorMsg(null); setSenha(v); }}
                placeholder="Digite sua senha"
                secureTextEntry={!mostrarSenha}
                rightElement={
                  <TouchableOpacity onPress={() => setMostrarSenha((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <IconEye size={18} color={C.muted} />
                  </TouchableOpacity>
                }
              />
            </View>

            <TouchableOpacity
              onPress={() => setLembrar((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View
                style={{
                  width: 18, height: 18, borderRadius: 5, borderWidth: 1.5,
                  borderColor: lembrar ? C.accent : C.border,
                  backgroundColor: lembrar ? C.accent : 'transparent',
                }}
              />
              <Text style={{ fontSize: 12.5, color: C.textSoft }}>Manter conectado por 30 dias</Text>
            </TouchableOpacity>

            <Button onPress={handleLogin} disabled={busy} loading={busy}>
              {busy ? 'Entrando...' : 'Entrar'}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
