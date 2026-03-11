# Zyntra SGE — Runbook de Produção

> Guia operacional para deploy, monitoramento, rollback e emergências.
> VPS: `31.97.64.102` · App: `/var/www/aluforce` · PM2: `aluforce-dashboard`

---

## 1. Pré-requisitos

| Item | Valor |
|------|-------|
| Node.js | 20.x LTS |
| MySQL | 8.x |
| Redis | 7.x |
| PM2 | >= 5.x |
| SO | Ubuntu 22.04 |
| Porta | 3000 (interna), 80/443 via Nginx |

---

## 2. Deploy Padrão

### 2.1 Via Script PowerShell (recomendado)
```powershell
# Deploy completo (VPS + Git)
.\deploy.ps1

# Somente VPS (sem git)
.\deploy.ps1 -SemGit

# Arquivos específicos
.\deploy.ps1 server.js routes/pcp-routes.js
```

### 2.2 Deploy Manual (SCP + SSH)
```bash
# 1. Upload de arquivos
scp -i ~/.ssh/id_rsa arquivo.js root@31.97.64.102:/var/www/aluforce/

# 2. Restart
ssh root@31.97.64.102 "cd /var/www/aluforce && pm2 restart aluforce-dashboard"

# 3. Validar
ssh root@31.97.64.102 "curl -s http://localhost:3000/status"
```

### 2.3 Checklist Pré-Deploy
- [ ] Testar localmente (`node server.js`)
- [ ] Verificar que nenhum `console.log` de debug remanesceu
- [ ] Confirmar que `.env` de produção tem todas as variáveis
- [ ] Verificar espaço em disco na VPS (`df -h`)

---

## 3. Monitoramento

### 3.1 PM2
```bash
pm2 list                          # Status dos processos
pm2 logs aluforce-dashboard       # Logs em tempo real
pm2 logs --lines 100              # Últimas 100 linhas
pm2 monit                         # Dashboard interativo (CPU/RAM)
pm2 show aluforce-dashboard       # Detalhes do processo
```

### 3.2 Health Check
```bash
curl -s http://localhost:3000/status | jq .
# Resposta esperada: { "status": "online", "uptime": ..., "version": "2.1.x" }
```

### 3.3 Recursos do Servidor
```bash
htop                              # CPU e memória em tempo real
df -h                             # Espaço em disco
free -h                           # Memória RAM
ss -tlnp | grep 3000              # Porta da app
redis-cli ping                    # Redis ativo
mysql -u root -e "SELECT 1"      # MySQL ativo
```

### 3.4 Logs (arquivos)
```bash
tail -f /var/www/aluforce/logs/out.log     # Stdout
tail -f /var/www/aluforce/logs/err.log     # Stderr
tail -f /var/www/aluforce/logs/combined.log # Todos
```

---

## 4. Rollback

### 4.1 Rollback Rápido (último deploy)
```bash
# Na VPS — restaurar backup
cd /var/www/aluforce
cp backups/server.js.bak server.js     # Exemplo para um arquivo
pm2 restart aluforce-dashboard
```

### 4.2 Rollback via Git
```bash
# Localmente — reverter commit
git log --oneline -5                   # Identificar commit
git revert <hash>                      # Criar commit de reversão
.\deploy.ps1                           # Deploy do revert
```

### 4.3 Pré-Backup (antes de cada deploy crítico)
```bash
# Na VPS
cd /var/www/aluforce
mkdir -p backups/$(date +%Y%m%d)
cp server.js backups/$(date +%Y%m%d)/
cp -r routes/ backups/$(date +%Y%m%d)/
cp -r modules/ backups/$(date +%Y%m%d)/
```

---

## 5. Procedimentos de Emergência

### 5.1 App Fora do Ar
```bash
# 1. Verificar status
pm2 list

# 2. Se não estiver rodando, reiniciar
pm2 restart aluforce-dashboard

# 3. Se restart falhar, verificar logs
pm2 logs aluforce-dashboard --lines 50

# 4. Se erro de dependência
cd /var/www/aluforce && npm install --production

# 5. Se porta ocupada
ss -tlnp | grep 3000
kill -9 <PID>
pm2 restart aluforce-dashboard
```

### 5.2 MySQL Fora do Ar
```bash
systemctl status mysql
systemctl restart mysql
mysql -u root -e "SHOW PROCESSLIST"    # Verificar conexões ativas
```

### 5.3 Redis Fora do Ar
```bash
systemctl status redis
systemctl restart redis
redis-cli ping                         # Deve retornar PONG
```

### 5.4 Memória Esgotada
```bash
free -h
pm2 restart aluforce-dashboard         # Libera memória do Node
# Se persistir:
sync; echo 3 > /proc/sys/vm/drop_caches
```

### 5.5 Disco Cheio
```bash
df -h
# Limpar logs antigos
find /var/www/aluforce/logs -name "*.log" -mtime +30 -delete
# Limpar uploads temporários
find /var/www/aluforce/uploads -mtime +7 -delete
# Limpar backups antigos
find /var/www/aluforce/backups -mtime +60 -delete
```

---

## 6. Variáveis de Ambiente (.env)

| Variável | Descrição | Obrigatória |
|----------|-----------|:-----------:|
| `NODE_ENV` | `production` | ✅ |
| `PORT` | Porta HTTP (3000) | ✅ |
| `DB_HOST` | Host MySQL | ✅ |
| `DB_USER` | Usuário MySQL | ✅ |
| `DB_PASS` / `DB_PASSWORD` | Senha MySQL | ✅ |
| `DB_NAME` | Nome do banco | ✅ |
| `JWT_SECRET` | Segredo JWT | ✅ |
| `REDIS_URL` | URL Redis (`redis://localhost:6379`) | ✅ |
| `SMTP_HOST` | Servidor SMTP | ❌ |
| `SMTP_USER` | Usuário SMTP | ❌ |
| `SMTP_PASS` | Senha SMTP | ❌ |

---

## 7. PM2 — Configuração de Produção

Arquivo: `ecosystem.config.js`

```javascript
// Limites importantes
max_memory_restart: '1G',       // Restart se exceder 1 GB
max_restarts: 10,               // Máx. 10 restarts automáticos
restart_delay: 3000,            // 3 seg entre restarts
wait_ready: true,               // Espera process.send('ready')
listen_timeout: 30000,          // 30 seg timeout para ready
```

### 7.1 Log Rotation (pm2-logrotate)
```bash
# Instalar
pm2 install pm2-logrotate

# Configurar
pm2 set pm2-logrotate:max_size 50M       # Rotacionar em 50 MB
pm2 set pm2-logrotate:retain 7           # Manter 7 arquivos
pm2 set pm2-logrotate:compress true      # Comprimir rotacionados
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # Diário à meia-noite
```

---

## 8. Nginx (Proxy Reverso)

Arquivo: `/etc/nginx/sites-available/aluforce`

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 9. Contatos e Escalação

| Nível | Ação | Tempo Máx. |
|-------|------|:----------:|
| L1 | Restart PM2, verificar logs | 5 min |
| L2 | Rollback, reiniciar MySQL/Redis | 15 min |
| L3 | Restaurar backup completo, escalar para dev | 30 min |

---

*Última atualização: Março 2026 — Sprint CRIT*
