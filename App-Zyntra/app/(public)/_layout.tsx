import { Stack } from 'expo-router';
import { lightColors as C } from '@/lib/theme';

// As telas públicas usam a paleta CLARA fixa, não o tema do aparelho — o cartão do
// login tem fundo branco fixo e o texto sumiria nele em modo escuro. Ver lib/theme.tsx.
export default function PublicLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="recuperar-senha" />
      <Stack.Screen name="trevo-login" />
    </Stack>
  );
}
