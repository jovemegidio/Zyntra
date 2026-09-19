import { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '@/lib/api';

import { lightColors as C } from '@/lib/theme';
import { Button, Input, ScreenHeader } from '@/components/ui';

export default function RecuperarSenhaScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) {
      Alert.alert('Erro', 'Digite seu e-mail');
      return;
    }

    setLoading(true);
    try {
      await authApi.requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch {
      // Sempre mostrar mensagem de sucesso por segurança (não revelar se e-mail existe)
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader title="Recuperar Senha" onBack={() => router.back()} />

      <View style={{ flex: 1, padding: 28, justifyContent: 'center' }}>
        {sent ? (
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: C.greenDim,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
              }}
            >
              <Text style={{ fontSize: 32 }}>✓</Text>
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 8, textAlign: 'center' }}>
              E-mail enviado!
            </Text>
            <Text style={{ fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 }}>
              Verifique sua caixa de entrada e siga as instrucoes para redefinir sua senha.
            </Text>
            <Button
              onPress={() => router.back()}
              style={{ marginTop: 32, width: '100%' }}
            >
              Voltar ao Login
            </Button>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 8 }}>
              Esqueceu sua senha?
            </Text>
            <Text style={{ fontSize: 14, color: C.muted, marginBottom: 32, lineHeight: 20 }}>
              Digite seu e-mail corporativo e enviaremos um link para redefinir sua senha.
            </Text>

            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="E-mail corporativo"
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ marginBottom: 16 }}
            />

            <Button onPress={handleSubmit} loading={loading}>
              Enviar Link
            </Button>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
