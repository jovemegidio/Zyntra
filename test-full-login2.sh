#!/bin/bash
echo "=== 1. Setting test password ==="
cd /var/www/aluforce
HASH=$(node -e "const b=require('bcryptjs');b.hash('Aluforce2026',12).then(h=>console.log(h))")
echo "Hash: $HASH"
mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "UPDATE usuarios SET senha_hash='$HASH', password_hash='$HASH' WHERE email='ti@aluforce.ind.br'"

echo ""
echo "=== 2. Flushing PM2 logs ==="
pm2 flush aluforce-dashboard 2>/dev/null

echo ""
echo "=== 3. Login attempt (timeout 90s) ==="
time timeout 90 curl -s -w '\nHTTP: %{http_code}\nTIME: %{time_total}s' \
  -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ti@aluforce.ind.br","password":"Aluforce2026"}'

echo ""
echo "=== 4. PM2 Error Logs ==="
sleep 2
pm2 logs aluforce-dashboard --lines 60 --nostream --err

echo ""
echo "=== 5. PM2 Output Logs ==="
pm2 logs aluforce-dashboard --lines 60 --nostream --out
