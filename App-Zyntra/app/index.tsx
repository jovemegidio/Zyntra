import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { lightColors as C } from '@/lib/theme';

/**
 * Porta de entrada: decide entre app e login, sem tela intermediária.
 *
 * Antes havia um splash em JS (`components/splash-screen.tsx`) segurado por um
 * tempo mínimo de 2,6 s — animação bonita que atrasava o login em quase três
 * segundos toda vez que o app abria. Foi removido a pedido.
 *
 * `isLoading` dura só o tempo de ler o token do SecureStore (milissegundos).
 * Durante ele pintamos um retângulo da cor de fundo em vez de `null`: sem isso o
 * primeiro frame é transparente e pisca branco antes da tela real.
 */
export default function Index() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(public)/login" />;
  }

  // Sessão da Trevo Autopeças: backend/telas separados do restante do grupo.
  return <Redirect href={user?.company === 'trevo' ? '/(trevo)' : '/(auth)'} />;
}
