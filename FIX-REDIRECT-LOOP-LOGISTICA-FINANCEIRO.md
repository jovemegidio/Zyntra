# Correção — `ERR_TOO_MANY_REDIRECTS` em Logística e Financeiro

**Data:** 2026-05-24
**Sintoma:** Clicar nos módulos **Logística** e **Financeiro** no painel do `aluforce.api.br` resulta em página de erro do Chrome:
> Esta página não está funcionando. Redirecionamento em excesso por aluforce.api.br. — `ERR_TOO_MANY_REDIRECTS`

---

## 1. Diagnóstico

### Como reproduzi

Com um cookie `authToken` válido apontando para a VPS:

```bash
$ curl -sI -H "Cookie: authToken=<JWT>" https://aluforce.api.br/Logistica
HTTP/1.1 302 Found
Location: /Logistica          ← redirect para si mesmo

$ curl -sI -H "Cookie: authToken=<JWT>" https://aluforce.api.br/Financeiro
HTTP/1.1 302 Found
Location: /Financeiro         ← redirect para si mesmo
```

`/Logistica/index.html` e `/Financeiro/index.html` (com `index.html` explícito) retornam **200 OK**. O loop só ocorre quando a URL é a "raiz canônica" do módulo (sem `/index.html`).

Sub-rotas internas do módulo (sidebar do Logística usa `<a href="/Logistica">`, e há URLs em cache/bookmarks sem `/index.html`) caem nesse caso e travam a navegação.

### Causa raiz

No arquivo `/var/www/aluforce/server.js` da VPS, linhas **1300–1305**, existem apelidos em minúsculas para os módulos:

```js
app.get('/rh',         authenticatePage, (req, res) => res.redirect('/RH'));
app.get('/pcp',        authenticatePage, (req, res) => res.redirect('/PCP/index.html'));
app.get('/vendas',     authenticatePage, (req, res) => res.redirect('/Vendas'));
app.get('/compras',    authenticatePage, (req, res) => res.redirect('/Compras'));
app.get('/logistica',  authenticatePage, (req, res) => res.redirect('/Logistica'));   // ← loop
app.get('/financeiro', authenticatePage, (req, res) => res.redirect('/Financeiro'));  // ← loop
```

O Express, por **padrão**, usa roteamento **case-insensitive** (`case sensitive routing` é `false`). Isso significa que a rota declarada como `'/logistica'` também é acionada por requisições a `/Logistica` (maiúsculo).

Fluxo do bug:

1. Navegador requisita `GET /Logistica`.
2. A rota `app.get('/logistica', …)` casa (case-insensitive) e responde `302 Location: /Logistica`.
3. Navegador segue o `Location`. Novo `GET /Logistica`.
4. Volta ao passo 2 → **loop infinito** → Chrome interrompe após ~20 redirects com `ERR_TOO_MANY_REDIRECTS`.

### Por que PCP e Faturamento funcionam?

- `/pcp` redireciona para `/PCP/index.html` (caminho **diferente** da própria rota). A segunda requisição cai em `app.get('/PCP/*.html', …)`, que serve o arquivo → fim.
- `/Faturamento` (linha 1872) redireciona para `/Faturamento/index.html`, mesma lógica → não há colisão case-insensitive consigo mesmo.

### Por que Vendas, Compras e RH também estão afetados (apesar do usuário só ter relatado Logística e Financeiro)

Validei com `curl`:

| URL                | Status | `Location`     | Loop? |
| ------------------ | :----: | -------------- | :---: |
| `/Vendas`          |  302   | `/Vendas`      | SIM   |
| `/Compras`         |  302   | `/Compras`     | SIM   |
| `/RH`              |  302   | `/RH`          | SIM   |
| `/Logistica`       |  302   | `/Logistica`   | SIM   |
| `/Financeiro`      |  302   | `/Financeiro`  | SIM   |
| `/PCP`             |  302   | `/PCP/index.html`         | não |
| `/Faturamento`     |  302   | `/Faturamento/index.html` | não |

Os tiles do painel (`public/index.html` linhas 2409–2434) já apontam para `/Modulo/index.html`, então o clique inicial **não** dispara o loop — por isso o problema parecia atingir só dois módulos. Mas o loop ocorre sempre que:

- O sidebar interno do módulo tem `<a href="/Logistica">` (como em `modules/Logistica/public/index.html` linha 31).
- O usuário tem URL antiga em favoritos/histórico sem `/index.html`.
- Algum script de navegação (auth-unified, base-path injector) remove o `/index.html`.

---

## 2. Correção

Editar `/var/www/aluforce/server.js`, linhas **1300–1305**, fazendo cada apelido lowercase apontar para um caminho **diferente** da própria rota — o mesmo padrão que já funciona em `/pcp` e `/Faturamento`.

### Patch (diff)

```diff
--- a/server.js
+++ b/server.js
@@ -1300,6 +1300,6 @@
-app.get('/rh',         authenticatePage, (req, res) => res.redirect('/RH'));
+app.get('/rh',         authenticatePage, (req, res) => res.redirect('/RH/areaadm.html'));
 app.get('/pcp',        authenticatePage, (req, res) => res.redirect('/PCP/index.html'));
-app.get('/vendas',     authenticatePage, (req, res) => res.redirect('/Vendas'));
-app.get('/compras',    authenticatePage, (req, res) => res.redirect('/Compras'));
-app.get('/logistica',  authenticatePage, (req, res) => res.redirect('/Logistica'));
-app.get('/financeiro', authenticatePage, (req, res) => res.redirect('/Financeiro'));
+app.get('/vendas',     authenticatePage, (req, res) => res.redirect('/Vendas/index.html'));
+app.get('/compras',    authenticatePage, (req, res) => res.redirect('/Compras/index.html'));
+app.get('/logistica',  authenticatePage, (req, res) => res.redirect('/Logistica/index.html'));
+app.get('/financeiro', authenticatePage, (req, res) => res.redirect('/Financeiro/index.html'));
```

### Versão final do bloco

```js
// Aliases lowercase para módulos — destino DIFERENTE da própria rota
// (Express usa case-insensitive routing por padrão; redirect para o mesmo
// path-base causa loop infinito → ERR_TOO_MANY_REDIRECTS)
app.get('/rh',         authenticatePage, (req, res) => res.redirect('/RH/areaadm.html'));
app.get('/pcp',        authenticatePage, (req, res) => res.redirect('/PCP/index.html'));
app.get('/vendas',     authenticatePage, (req, res) => res.redirect('/Vendas/index.html'));
app.get('/compras',    authenticatePage, (req, res) => res.redirect('/Compras/index.html'));
app.get('/logistica',  authenticatePage, (req, res) => res.redirect('/Logistica/index.html'));
app.get('/financeiro', authenticatePage, (req, res) => res.redirect('/Financeiro/index.html'));
```

### Alternativa (não recomendada agora)

Habilitar roteamento case-sensitive globalmente no Express:

```js
app.set('case sensitive routing', true);
```

Resolve a causa raiz, mas é uma mudança global que pode quebrar outras rotas que dependem do match case-insensitive em outro lugar do sistema. **Não usar sem auditoria completa.** A correção pontual acima é segura e cirúrgica.

---

## 3. Deploy

Pelo padrão do projeto (`CLAUDE.md` — usar `deploy-vps.ps1`):

```powershell
# 1) Aplicar o patch acima no server.js local
# 2) Deploy:
.\deploy-vps.ps1 "server.js"

# 3) Replicar para as instâncias Labor (se o mesmo bloco existir lá):
#    via plink/ssh:
#      cp /var/www/aluforce/server.js /var/www/labor-energy/server.js   # NÃO fazer cópia bruta
#                                                                          se os arquivos divergem
#    O recomendado é aplicar o MESMO patch manualmente em:
#      /var/www/labor-energy/server.js
#      /var/www/labor-eletric/server.js
#    e reiniciar:
#      pm2 restart labor-energy-demo --update-env
#      pm2 restart labor-eletric-demo --update-env
```

O `deploy-vps.ps1` já reinicia `aluforce-v2-production` automaticamente após o envio.

---

## 4. Verificação pós-deploy

Após o restart do PM2, validar:

```bash
# Gerar um JWT de teste (na VPS):
ssh root@31.97.64.102 'cd /var/www/aluforce && node -e "
  const j=require(\"jsonwebtoken\");
  console.log(j.sign(
    {id:1,nome:\"TI\",email:\"ti@aluforce.ind.br\",role:\"admin\",is_admin:1,empresa_id:1,deviceId:\"t\",type:\"access\"},
    process.env.JWT_SECRET,
    {algorithm:\"HS256\",audience:\"aluforce\",expiresIn:\"5m\"}
  ))
"'

# Testar (deve responder 302 com Location para a página .html canônica;
# seguindo o redirect, a resposta final é 200 OK):
TOKEN="<jwt-gerado>"
for url in /Logistica /Financeiro /Vendas /Compras /RH /logistica /financeiro; do
  echo -n "$url -> "
  curl -sI -H "Cookie: authToken=$TOKEN" "https://aluforce.api.br$url" \
    | grep -iE '^http|^location' | tr '\n' ' '
  echo
done
```

Resultado esperado:

```
/Logistica   -> HTTP/1.1 302 Found  Location: /Logistica/index.html
/Financeiro  -> HTTP/1.1 302 Found  Location: /Financeiro/index.html
/Vendas      -> HTTP/1.1 302 Found  Location: /Vendas/index.html
/Compras     -> HTTP/1.1 302 Found  Location: /Compras/index.html
/RH          -> HTTP/1.1 302 Found  Location: /RH/areaadm.html
/logistica   -> HTTP/1.1 302 Found  Location: /Logistica/index.html
/financeiro  -> HTTP/1.1 302 Found  Location: /Financeiro/index.html
```

Como o Express usa roteamento case-insensitive por padrão, as variantes
em maiúsculas (`/Logistica`, `/Financeiro`, etc.) também acionam o alias
lowercase e retornam `302` para o caminho `.html` canônico. Seguindo o
redirect (`curl -sIL`), todas as rotas acima devem finalizar em
`HTTP/1.1 200 OK` após **exatamente 1 redirect**. Qualquer redirect para
o próprio caminho base indica regressão do bug.

E pelo navegador:

1. Login em `https://aluforce.api.br`.
2. Clicar nos tiles **Logística** e **Financeiro** — ambos devem abrir o módulo normalmente (sem loop).
3. Confirmar que dentro do módulo Logística o clique no logo da sidebar (`<a href="/Logistica">`) também não loopa.

---

## 5. Observações para o futuro

- Esse padrão de "alias lowercase redireciona para versão maiúscula da mesma rota" **é sempre um loop** sob o default do Express. Qualquer novo módulo (`/abc → /Abc`) precisa redirecionar para um path diferente (`/abc → /Abc/index.html` ou `/abc/dashboard`).
- O bug é silencioso até alguém clicar em link interno sem `/index.html` — não aparece em testes superficiais que sempre incluem o sufixo.
- A presença de rotas como `app.get('/Logistica', …)` (linha 1858) que servem o HTML diretamente **mascara** o bug em testes manuais com `/Logistica/index.html`, mas não cobre a URL canônica `/Logistica` quando o alias lowercase a intercepta primeiro.
