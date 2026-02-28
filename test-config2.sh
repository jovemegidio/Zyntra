#!/bin/bash
echo '{"email":"isabela@aluforce.com.br","senha":"123456"}' > /tmp/login.json
RESP=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d @/tmp/login.json)
TOKEN=$(echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("token",""))')
echo "TOKEN_LEN: ${#TOKEN}"
echo "--- EMPRESA ---"
curl -s -w '\nHTTP:%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/configuracoes/empresa | head -c 400
echo ""
echo "--- IMPOSTOS ---"
curl -s -w '\nHTTP:%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/configuracoes/impostos | head -c 400