# Zyntra / Aluforce ERP — Guia para Codex

## Deploy para VPS

**Método padrão:** usar `deploy-vps.ps1` (nunca git push direto como deploy).

```powershell
# Arquivos específicos:
.\deploy-vps.ps1 "public\js\auth-unified.js" "public\css\global-header-sidebar.css"

# Sem argumentos — envia arquivos .js/.html/.css/.json modificados nas últimas 2h:
.\deploy-vps.ps1
```

O script usa chave SSH `~/.ssh/id_ed25519_vps` (já registrada na VPS).
Após o envio, reinicia o PM2 automaticamente.

### Após o deploy para /var/www/aluforce, sincronizar para as instâncias Labor:

```bash
# Via SSH (plink):
cp /var/www/aluforce/middleware/zyntra-branding.js /var/www/labor-energy/middleware/zyntra-branding.js
cp /var/www/aluforce/middleware/zyntra-branding.js /var/www/labor-eletric/middleware/zyntra-branding.js
pm2 restart labor-energy-demo --update-env
pm2 restart labor-eletric-demo --update-env
```

### Credenciais VPS

- Host: `31.97.64.102` — usuário `root`
- Processos PM2: `aluforce-v2-production`, `labor-energy-demo`, `labor-eletric-demo`
- Diretórios: `/var/www/aluforce`, `/var/www/labor-energy`, `/var/www/labor-eletric`

## Estrutura de branding

O arquivo `middleware/zyntra-branding.js` controla o branding multi-marca:
- `BRAND=labor-energy` → usa `labor-energy-logo.png`, cores verdes
- `BRAND=labor-eletric` → usa `labor-eletric-logo.png`, cores laranja
- `BRAND=zyntra` → usa `zyntra-branco.png`, cores roxas

Logos ficam em `public/images/`. Para atualizar o logo de uma marca, substituir o arquivo correspondente e fazer deploy.

## Git

O GitHub Actions (CI/CD) está com ESLint falhando — **não é usado para deploy**.
Todo deploy é feito manualmente via `deploy-vps.ps1`.
