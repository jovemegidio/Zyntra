import { useMemo, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { lightColors as C } from '@/lib/theme';

/**
 * Cloudflare Turnstile dentro do app.
 *
 * POR QUE ISTO EXISTE: o backend exige captcha em TODO login
 * (`CAPTCHA_LOGIN=always` nas 3 instâncias — conferido em /api/captcha/status), e
 * `utils/captcha.js` aplica a política num ponto único, de propósito, para não
 * existir rota alternativa que autentique sem o desafio. O app não tinha onde
 * resolvê-lo, então toda tentativa de login voltava `CAPTCHA_REQUIRED` e não havia
 * como entrar — nem com a senha certa.
 *
 * Turnstile é um widget web; não há SDK nativo. O caminho suportado é uma WebView
 * pequena que carrega o widget e devolve o token por `postMessage`.
 *
 * O `baseUrl` NÃO é decorativo: o Turnstile valida a origem contra os domínios
 * cadastrados na sitekey. Sem ele o documento fica em `about:blank` e a Cloudflare
 * recusa o desafio.
 */

const ALTURA = 76;

export interface CaptchaTurnstileProps {
  siteKey: string;
  /** Origem apresentada à Cloudflare — precisa ser um domínio válido da sitekey. */
  baseUrl: string;
  onToken: (token: string) => void;
  onErro?: (motivo: string) => void;
}

function montarHtml(siteKey: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #w{display:flex;justify-content:center;align-items:center;height:${ALTURA}px}
</style>
<script>
  function avisar(o){
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  // Render explícito: com o render automático não há gancho confiável para saber
  // que o script terminou de carregar antes de chamar turnstile.render.
  window.aoCarregarTurnstile = function () {
    try {
      window.turnstile.render('#w', {
        sitekey: ${JSON.stringify(siteKey)},
        language: 'pt-BR',
        theme: 'light',
        callback: function (t) { avisar({ tipo: 'ok', token: t }); },
        'error-callback': function (c) { avisar({ tipo: 'erro', motivo: String(c || 'falha') }); },
        'expired-callback': function () { avisar({ tipo: 'expirado' }); },
        'timeout-callback': function () { avisar({ tipo: 'expirado' }); }
      });
    } catch (e) {
      avisar({ tipo: 'erro', motivo: String(e) });
    }
  };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=aoCarregarTurnstile&render=explicit" async defer></script>
</head>
<body><div id="w"></div></body>
</html>`;
}

export function CaptchaTurnstile({ siteKey, baseUrl, onToken, onErro }: CaptchaTurnstileProps) {
  const [carregando, setCarregando] = useState(true);
  const html = useMemo(() => montarHtml(siteKey), [siteKey]);

  return (
    <View style={{ height: ALTURA, justifyContent: 'center' }}>
      {carregando && (
        <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={C.muted} />
          <Text style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            Carregando verificacao de seguranca...
          </Text>
        </View>
      )}
      <WebView
        source={{ html, baseUrl }}
        // Fundo branco em vez de transparente: o cartão do login já é branco, e
        // WebView transparente no Android exige camada de software, que atrapalha a
        // animação do widget. Assim não há flash nem perda de aceleração.
        style={{ height: ALTURA, backgroundColor: C.card }}
        containerStyle={{ height: ALTURA }}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        onLoadEnd={() => setCarregando(false)}
        onError={() => {
          setCarregando(false);
          onErro?.('Nao foi possivel carregar a verificacao de seguranca.');
        }}
        onMessage={(evento) => {
          let dados: { tipo?: string; token?: string; motivo?: string } = {};
          try {
            dados = JSON.parse(evento.nativeEvent.data);
          } catch {
            return;
          }
          if (dados.tipo === 'ok' && dados.token) onToken(dados.token);
          else if (dados.tipo === 'expirado') onErro?.('A verificacao expirou. Tente novamente.');
          else if (dados.tipo === 'erro') onErro?.('Falha na verificacao de seguranca.');
        }}
      />
    </View>
  );
}
