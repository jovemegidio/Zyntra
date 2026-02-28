# ============================================================
# 🚀 GUIA DE DEPLOY - ALUFORCE v2.0
# ============================================================

## 📋 Pré-requisitos

- VPS com Ubuntu 22.04 LTS (Hostinger KVM 1 ou similar)
- Acesso SSH ao servidor
- Seu código no GitHub (ou pronto para enviar via FTP)

---

## 🔧 PASSO 1: Configurar o VPS

### Conectar via SSH (do seu Windows):

```powershell
ssh root@SEU_IP_DO_SERVIDOR
```

### Executar script de instalação:

```bash
# Baixar e executar script
curl -O https://raw.githubusercontent.com/SEU-USUARIO/aluforce/main/deploy/setup-vps.sh
bash setup-vps.sh
```

**OU copie manualmente o conteúdo do arquivo `setup-vps.sh`**

---

## 📤 PASSO 2: Enviar seu Código

### Opção A - Via Git (Recomendado):

```bash
cd /var/www/aluforce
git clone https://github.com/SEU-USUARIO/aluforce.git .
```

### Opção B - Via FileZilla/FTP:

1. Abra FileZilla
2. Conecte: `sftp://SEU_IP` | Usuário: `root` | Senha: `sua-senha`
3. Navegue para `/var/www/aluforce`
4. Envie todos os arquivos do projeto

### Opção C - Via SCP (do Windows PowerShell):

```powershell
scp -r "C:\Users\egidio\Music\Sistema - ALUFORCE - V.2\*" root@SEU_IP:/var/www/aluforce/
```

---

## ⚙️ PASSO 3: Configurar Ambiente

```bash
cd /var/www/aluforce

# Criar arquivo .env
cp deploy/.env.example .env
nano .env
```

**Edite o .env com suas credenciais reais:**
- DB_PASSWORD (senha do Railway)
- JWT_SECRET (gere uma nova)

---

## 📦 PASSO 4: Instalar e Iniciar

```bash
# Instalar dependências
npm install --production

# Iniciar com PM2
pm2 start server.js --name aluforce

# Salvar para reinício automático
pm2 save
pm2 startup
```

---

## ✅ PASSO 5: Testar

Acesse no navegador:
```
http://SEU_IP_DO_SERVIDOR
```

---

## 🔒 PASSO 6: SSL/HTTPS (Opcional - com domínio)

```bash
# Instalar Certbot
apt install certbot python3-certbot-nginx -y

# Gerar certificado
certbot --nginx -d seu-dominio.com.br
```

---

## 📊 Comandos Úteis

| Comando | Descrição |
|---------|-----------|
| `pm2 status` | Ver status da aplicação |
| `pm2 logs aluforce` | Ver logs em tempo real |
| `pm2 restart aluforce` | Reiniciar aplicação |
| `pm2 stop aluforce` | Parar aplicação |
| `nginx -t` | Testar config Nginx |
| `systemctl restart nginx` | Reiniciar Nginx |

---

## 🔄 Atualizar o Sistema

Quando fizer mudanças no código:

```bash
cd /var/www/aluforce
git pull  # se usar Git
npm install
pm2 restart aluforce
```

---

## ❓ Problemas Comuns

### Erro 502 Bad Gateway
```bash
pm2 logs aluforce  # verificar erros
pm2 restart aluforce
```

### Erro de conexão com banco
- Verifique se o IP do VPS está liberado no Railway
- Confirme as credenciais no .env

### Porta 3000 em uso
```bash
pm2 delete all
pm2 start server.js --name aluforce
```

---

## 📞 Suporte

Após o deploy, seu sistema estará acessível em:
- **Sem domínio:** `http://IP-DO-SERVIDOR`
- **Com domínio:** `https://seu-dominio.com.br`

