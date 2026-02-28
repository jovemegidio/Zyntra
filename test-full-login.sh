#!/bin/bash
echo "=== 1. Testing SMTP connectivity ==="
timeout 10 bash -c 'echo "QUIT" | openssl s_client -connect mail.aluforce.ind.br:465 -quiet 2>&1 | head -5' || echo "SMTP TIMEOUT after 10s!"

echo ""
echo "=== 2. Testing login with valid user (reset password first) ==="
# Set a known test password for ti@aluforce.ind.br
HASH=$(node -e "const b=require('bcryptjs');b.hash('Aluforce2026',12).then(h=>console.log(h))")
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "UPDATE usuarios SET senha_hash='$HASH', password_hash='$HASH' WHERE email='ti@aluforce.ind.br'"

echo ""
echo "=== 3. Flushing PM2 logs ==="
pm2 flush aluforce-dashboard 2>/dev/null

echo ""
echo "=== 4. Attempting login (with timeout 60s) ==="
time timeout 60 curl -s -w '\nHTTP: %{http_code}\nTIME: %{time_total}s' \
  -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ti@aluforce.ind.br","password":"Aluforce2026"}'

echo ""
echo "=== 5. PM2 Logs ==="
sleep 2
pm2 logs aluforce-dashboard --lines 60 --nostream
