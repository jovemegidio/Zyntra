import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { Colors } from '@/lib/constants';
import { tokenStorage } from '@/lib/api';

export default function SistemaScreen() {
  const { path } = useLocalSearchParams<{ path?: string }>();
  const web = useRef<WebView>(null);
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> }>();
  const [origin, setOrigin] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [error, setError] = useState('');
  const renovando = useRef(false);

  const load = async () => {
    setError('');
    const [token, apiBase] = await Promise.all([tokenStorage.getToken(), tokenStorage.getApiBase()]);
    if (!token) return router.replace('/(public)/login' as never);
    const site = apiBase.replace(/\/api\/?$/, '');
    const target = typeof path === 'string' ? path : '/index.html';
    setOrigin(site);
    setSource({
      uri: `${site}/api/mobile/web-session?path=${encodeURIComponent(target)}&t=${Date.now()}`,
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  // Se a sessão do WebView cair, o ERP web devolve a tela de login dele — que não
  // é a do app. Em vez de mostrá-la, renovamos a sessão com o token do aplicativo.
  const ehTelaDeLoginWeb = (url: string) =>
    /\/login(\.html)?(\?|#|$)/i.test(url) || /\/labor-(eletric|energy)\/login/i.test(url);

  useEffect(() => { load(); }, [path]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { web.current?.goBack(); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  if (!source) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg }}><ActivityIndicator color={Colors.accent} /></View>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
        <TouchableOpacity onPress={() => router.back()}><Text style={{ color: Colors.accent, fontWeight: '700' }}>Fechar</Text></TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', color: Colors.text, fontWeight: '800' }}>Zyntra ERP</Text>
        <TouchableOpacity onPress={() => web.current?.reload()}><Text style={{ color: Colors.accent, fontWeight: '700' }}>Atualizar</Text></TouchableOpacity>
      </View>
      {error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Text style={{ color: Colors.text, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
          <TouchableOpacity onPress={load} style={{ backgroundColor: Colors.accent, padding: 14, borderRadius: 12 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Tentar novamente</Text></TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={web}
          source={source}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => <ActivityIndicator style={{ position: 'absolute', inset: 0 }} color={Colors.accent} />}
          onNavigationStateChange={(nav: WebViewNavigation) => {
            setCanGoBack(nav.canGoBack);
            if (nav.loading || !ehTelaDeLoginWeb(nav.url)) {
              if (!nav.loading) renovando.current = false;
              return;
            }
            if (renovando.current) {
              // Já renovamos uma vez e caiu no login de novo: o token do app morreu.
              return router.replace('/(public)/login' as never);
            }
            renovando.current = true;
            load();
          }}
          onShouldStartLoadWithRequest={(request) => {
            if (request.url.startsWith(origin + '/') || request.url === origin || request.url === 'about:blank') return true;
            if (request.url.startsWith('https://') || request.url.startsWith('mailto:') || request.url.startsWith('tel:')) Linking.openURL(request.url).catch(() => {});
            return false;
          }}
          onError={() => setError('Não foi possível conectar ao Zyntra. Verifique sua internet e tente novamente.')}
          onHttpError={(event) => {
            const { statusCode, url } = event.nativeEvent;
            if (statusCode === 401 && url.includes('/api/mobile/web-session')) {
              return router.replace('/(public)/login' as never);
            }
            if (statusCode >= 500) setError('O servidor está temporariamente indisponível.');
          }}
        />
      )}
    </SafeAreaView>
  );
}
