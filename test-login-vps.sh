#!/bin/bash
pm2 flush aluforce-dashboard 2>/dev/null
echo '{"email":"ti@aluforce.ind.br","password":"123456"}' > /tmp/test-login.json
echo "=== Payload ==="
cat /tmp/test-login.json
echo ""
echo "=== Sending login request ==="
time curl -s -w '\nHTTP: %{http_code}\nTIME: %{time_total}s' \
  -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d @/tmp/test-login.json
echo ""
echo "=== PM2 Logs ==="
sleep 1
pm2 logs aluforce-dashboard --lines 40 --nostream
