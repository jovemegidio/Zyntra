#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"isabela@aluforce.com.br","senha":"123456"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["token"])')
echo "TOKEN obtained: ${#TOKEN} chars"
echo "--- EMPRESA ---"
curl -s -w '\nHTTP:%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/configuracoes/empresa | head -c 300
echo ""
echo "--- IMPOSTOS ---"
curl -s -w '\nHTTP:%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/configuracoes/impostos | head -c 300
echo ""
