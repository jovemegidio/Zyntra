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

## APK de homologação

O perfil `preview` do `eas.json` gera APK instalável:

```powershell
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

Também é possível executar `build-apk.ps1`. O build exige uma conta Expo com acesso ao projeto EAS configurado em `app.json`.

## ERP completo (WebView)

O card "ERP completo" em Módulos abre `app/(auth)/sistema.tsx`, que carrega o ERP web dentro do app.
O fluxo troca o Bearer token do aplicativo por um cookie `authToken` HttpOnly em
`GET /api/mobile/web-session?path=...` (`routes/mobile-app.js`) — o token nunca é exposto ao
JavaScript das páginas. O cookie dura o tempo restante do próprio JWT (máx. 8 h) e o `path` é
validado contra uma allowlist de prefixos no backend.

Se a sessão web cair, a tela detecta a ida para o login web e renova a sessão sozinha; caindo de
novo, manda o usuário para o login do aplicativo.

Cada tela de módulo tem no header o atalho **ERP web**, que abre o módulo correspondente já no
caminho certo (`CAMINHOS_ERP_WEB` em `lib/constants.ts`). Os caminhos usam `/index.html` explícito —
`/Vendas` responde 302 e o menu do web não marca o item como ativo — e precisam bater com a
allowlist de `routes/mobile-app.js`; fora dela a sessão cai em `/index.html`.

## Notificações

Em um dispositivo físico, o app registra o Expo Push Token em `/api/push/register`. Ao tocar em uma notificação com `data.moduleId`, abre o módulo correspondente; notificações sem destino válido abrem a central de alertas.

O backend disponibiliza `/api/push/send` apenas para administradores e mantém os dispositivos separados por empresa.
