/**
 * Config plugin — remove o LOGO da tela de abertura no Android.
 *
 * POR QUE UM PLUGIN, E NÃO EDITAR android/ OU app.json:
 * tirar o bloco `expo-splash-screen` do `app.json` NÃO basta. O pacote
 * `expo-splash-screen` continua nas dependências (o Expo Router o usa) e o seu
 * config plugin embutido roda de qualquer jeito no prebuild: ele gera um
 * `splashscreen_logo.png` em cada pasta `res/drawable-<densidade>` a partir do
 * ícone do app e aponta `Theme.App.SplashScreen` → `android:windowBackground` para
 * esse drawable. É esse desenho o "ícone que aparece antes do splash".
 * (Escrito assim de propósito: um `drawable-` seguido de asterisco e barra fecharia
 * este comentário de bloco no meio, e o arquivo inteiro vira erro de sintaxe.)
 *
 * E editar `android/app/src/main/res/values/styles.xml` à mão não adianta: a pasta
 * `android/` é gitignorada e regerada por `expo prebuild` a cada build.
 *
 * O QUE ELE FAZ:
 * troca o `windowBackground` do tema de abertura por uma COR sólida, e pinta essa
 * cor com o mesmo fundo da tela de login (#0d1117). Assim a abertura é um retângulo
 * escuro que emenda direto no login, sem logo e sem flash branco.
 *
 * LIMITE CONHECIDO (Android 12+): a partir do Android 12 o sistema desenha uma
 * splash própria com o ícone do launcher no cold start, pela SplashScreen API. Isso
 * é do SO e NÃO pode ser desligado por um app — só estilizado. Este plugin remove a
 * splash da aplicação; a piscada curta do ícone do sistema continua existindo em
 * aparelhos com Android 12 ou mais novo.
 */
const { withAndroidStyles, withAndroidColors } = require('expo/config-plugins');

/** Mesmo fundo da tela de login, para a abertura emendar sem corte de cor. */
const COR_ABERTURA = '#0d1117';

const NOME_COR = 'splashscreen_background';

function withNoSplash(config) {
  // 1) a cor de fundo da abertura
  config = withAndroidColors(config, (cfg) => {
    const recursos = cfg.modResults.resources;
    recursos.color = recursos.color || [];

    const existente = recursos.color.find((c) => c.$ && c.$.name === NOME_COR);
    if (existente) existente._ = COR_ABERTURA;
    else recursos.color.push({ $: { name: NOME_COR }, _: COR_ABERTURA });

    return cfg;
  });

  // 2) o tema deixa de apontar para o drawable do logo
  config = withAndroidStyles(config, (cfg) => {
    const estilos = cfg.modResults.resources.style || [];
    const abertura = estilos.find((s) => s.$ && s.$.name === 'Theme.App.SplashScreen');

    // Sem o tema não há o que corrigir: o expo-splash-screen pode ter saído do
    // projeto. Falhar aqui quebraria o build por um problema que não existe mais.
    if (!abertura) return cfg;

    abertura.item = (abertura.item || []).map((item) =>
      item.$ && item.$.name === 'android:windowBackground'
        ? { $: { name: 'android:windowBackground' }, _: `@color/${NOME_COR}` }
        : item
    );

    return cfg;
  });

  return config;
}

module.exports = withNoSplash;
