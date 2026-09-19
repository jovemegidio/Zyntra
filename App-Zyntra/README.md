# Zyntra Mobile

Aplicativo móvel do Zyntra ERP, construído com Expo SDK 57 (React Native 0.86, React 19) e Expo Router.

## Ambiente

```powershell
npm ci
npx tsc --noEmit
npm start
```

> O `node_modules` corrompe quando a pasta é sincronizada pelo Google Drive (pacotes truncados,
> `package.json` de 0 byte). Mantenha o checkout de trabalho **fora** da pasta sincronizada — ou
> exclua `node_modules` da sincronização — antes de rodar `npm ci`, `expo` ou `tsc`.

A API padrão é `https://zyntraerp.com.br/api`. Após o login, o aplicativo seleciona automaticamente a instância da empresa pelo domínio do usuário:

- `@labor.com.br`: `https://eletric.zyntraerp.com.br/api`
- domínios Energy: `https://energy.zyntraerp.com.br/api`
- demais usuários: `https://zyntraerp.com.br/api`

## APK

Há dois caminhos. Os dois produzem o mesmo pacote `br.com.aluforce.zyntra`.

### 1. GitHub Actions (não exige conta Expo)

**Actions → "📦 Build APK Android" → Run workflow**, e o APK sai em *Artifacts*.

O runner `ubuntu-latest` já traz o Android SDK, então o build é `expo prebuild` +
`gradlew assembleRelease` — sem build na nuvem da Expo. Configure uma vez, em
*Settings → Secrets and variables → Actions*:

| Secret | Conteúdo |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | o arquivo `.keystore` inteiro em base64 |
| `ANDROID_KEYSTORE_PASSWORD` | senha do armazenamento |
| `ANDROID_KEY_ALIAS` | `zyntra` |
| `ANDROID_KEY_PASSWORD` | **a mesma** senha do armazenamento (ver abaixo) |

Sem esses secrets o build ainda roda, mas assina com a keystore de **debug** — serve
para testar, não para distribuir nem para atualizar um app já instalado. O workflow
avisa e a etapa "Conferir assinatura" falha se um build marcado como `release` sair
assinado em debug.

O `versionCode` vem do número da execução do workflow, que é monotônico: cada build
instala por cima do anterior. O `versionName` é o rótulo mostrado ao usuário e pode ser
passado no *Run workflow*; vazio, usa o do `app.json`.

> **Keystore PKCS12:** o `keytool` moderno gera PKCS12, formato em que a senha da chave
> é obrigatoriamente igual à do armazenamento — ele ignora um `-keypass` diferente com
> um aviso fácil de não ver. Por isso `ANDROID_KEY_PASSWORD` = `ANDROID_KEYSTORE_PASSWORD`.

> **Guarde a keystore.** Depois que o app for distribuído, só atualizações assinadas com
> a **mesma** chave são aceitas. Perdê-la obriga a republicar sob outro nome de pacote.

### Como a assinatura é ligada

`expo prebuild` **regera** a pasta `android/` a cada build (ela é gitignorada), e o
template do Expo aponta o `buildTypes.release` para a keystore de *debug*. Editar
`android/app/build.gradle` à mão não adiantaria — some no próximo prebuild.

Quem corrige isso é o config plugin [`plugins/with-release-signing.js`](plugins/with-release-signing.js),
registrado em `app.json`. Ele roda dentro do prebuild e injeta um `signingConfig release`
que lê 4 propriedades do Gradle (`ZYNTRA_STORE_FILE`, `ZYNTRA_STORE_PASSWORD`,
`ZYNTRA_KEY_ALIAS`, `ZYNTRA_KEY_PASSWORD`). Sem essas propriedades ele cai na keystore de
debug de propósito, para que `expo run:android` continue funcionando sem configuração.

### Build local no Windows

`react-native-screens` e `react-native-worklets` compilam C++ via prefab/CMake, então o
build precisa de **NDK 27.1.12297006** e **CMake 3.22.1** (versões que o plugin
`expo-root-project` resolve neste SDK 57 — não estão fixadas em nenhum arquivo; para
conferir, um init script que imprima `p.android.ndkVersion`). Sem eles o build morre em
`configureCMakeRelWithDebInfo` com `[CXX1428]`, e só depois de baixar ~3 GB de Gradle.

Mantenha o projeto num caminho **curto e REAL**. O CMake gera
`node_modules/<pkg>/android/build/intermediates/cxx/.../prefab_command.bat`, cujo caminho
absoluto passa dos 260 caracteres do `MAX_PATH` se o projeto estiver fundo — o arquivo até
é criado, mas o `CreateProcess` da JVM não é long-path aware e falha com
`CXX1428 … CreateProcess error=2`, mesmo com `LongPathsEnabled=1` no registro. No runner
Linux do GitHub Actions esse limite não existe.

> **`subst` NÃO serve como atalho aqui** (testado em 07/09/2026). Mapear
> `subst Z: <pasta funda>` e buildar de `Z:\` falha nos cinco
> `:*:generateCodegenSchemaFromJavaScript` com *"this and base files have different
> roots"*: o Node resolve o drive virtual de volta ao caminho real ao montar a
> configuração de autolinking, então o Gradle recebe `Z:\...` e `C:\Users\...` na mesma
> árvore e não consegue relativizar um contra o outro. Use uma pasta real curta
> (`C:\Users\<voce>\AppData\Local\Temp\zb`, por exemplo) e rode o `prebuild` **de dentro
> dela** — o `android/` grava caminhos absolutos, então prebuild feito de outra raiz
> contamina o build.

Outra armadilha de Windows: `local.properties` é um *Java properties file*, onde a barra
invertida é escape. `sdk.dir=C\:\Android\Sdk` vira `C:AndroidSdk` (o `\A` e o `\S` somem) e
o build morre em "A sintaxe do nome do arquivo … está incorreta" ao configurar `:app`.
Escreva `sdk.dir=C\:/Android/Sdk`.

### 2. EAS Cloud Build

O perfil `preview` do `eas.json` gera APK e a Expo gerencia a keystore:

```powershell
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

Também é possível executar `build-apk.ps1`. Exige conta Expo com acesso ao projeto EAS
configurado em `app.json` (`owner: antoniodevs`).

## ERP completo (WebView)

O card "ERP completo" em Módulos abre `app/(auth)/sistema.tsx`, que carrega o ERP web dentro do app.
O fluxo troca o Bearer token do aplicativo por um cookie `authToken` HttpOnly em
`GET /api/mobile/web-session?path=...` (`routes/mobile-app.js`) — o token nunca é exposto ao
JavaScript das páginas. O cookie dura o tempo restante do próprio JWT (máx. 8 h) e o `path` é
validado contra uma allowlist de prefixos no backend.

Se a sessão web cair, a tela detecta a ida para o login web e renova a sessão sozinha; caindo de
novo, manda o usuário para o login do aplicativo.

As telas nativas cobrem 9 módulos (Financeiro, Vendas, CRM, RH, PCP, Logística, Faturamento,
Compras e Tarefas) — são os atalhos do que se consulta e registra no celular. A paridade com
as ~360 telas do ERP web quem entrega é o WebView, e quem define o alcance dele é a
`ALLOWED_PREFIXES` de `routes/mobile-app.js`. Um módulo nativo novo precisa de entrada em
`MODULES` **e** em `CAMINHOS_ERP_WEB` (`lib/constants.ts`); há teste amarrando os dois, porque
um caminho fora da allowlist não dá erro — cai calado em `/index.html`.

Cada tela de módulo tem no header o atalho **ERP web**, que abre o módulo correspondente já no
caminho certo (`CAMINHOS_ERP_WEB` em `lib/constants.ts`). Os caminhos usam `/index.html` explícito —
`/Vendas` responde 302 e o menu do web não marca o item como ativo — e precisam bater com a
allowlist de `routes/mobile-app.js`; fora dela a sessão cai em `/index.html`.

## Modo offline (fila de escritas)

As quatro escritas de campo do app — batida de ponto, apontamento de chão de fábrica,
solicitação de RH e tarefas — acontecem exatamente onde o sinal cai. Sem fila, o POST
que sai na hora errada some e o usuário só vê "não foi possível registrar".

`lib/offline-queue.ts` guarda a escrita que falhou por rede e reenvia sozinha. O lado do
servidor **já existia**: `middleware/idempotency.js` está montado em
`app.use('/api', idempotency())` e devolve a resposta original (com
`X-Idempotency-Replay: true`) quando a mesma `X-Idempotency-Key` chega de novo.

Três detalhes que não são óbvios:

- **A chave nasce antes da primeira tentativa**, no interceptor de request de `lib/api.ts` —
  não no enfileiramento. O caso que duplica é a rede cair *depois* de o servidor gravar: se
  a chave só nascesse ao enfileirar, a tentativa original teria ido sem chave e o servidor
  não teria como ligar o reenvio à gravação já feita.
- **O formato da chave não é livre.** O middleware valida contra
  `/^[a-zA-Z0-9\-_]{8,64}$/` e responde 400 fora disso. Há teste amarrando os dois lados.
- **O dedup do servidor vale para POST** (é o default do middleware). As quatro escritas de
  campo são POST; os PUT/PATCH da fila são naturalmente idempotentes.

Multipart (atestado com arquivo) **não** entra na fila: o `FormData` não sobrevive a
`JSON.stringify` nem a um restart, e o URI apontaria para um cache que o Android pode ter
limpado — enfileirar gravaria um envio que falharia para sempre.

Não há `netinfo` nas dependências, então o reenvio é disparado por: volta ao foreground,
qualquer resposta bem-sucedida do axios, e o botão do banner. `components/offline-banner.tsx`
mostra o que está pendente logo acima da tab bar e some quando a fila esvazia.

## Notificações

Em um dispositivo físico, o app registra o Expo Push Token em `/api/push/register`. Ao tocar em uma notificação com `data.moduleId`, abre o módulo correspondente; notificações sem destino válido abrem a central de alertas.

O backend disponibiliza `/api/push/send` apenas para administradores e mantém os dispositivos separados por empresa.
