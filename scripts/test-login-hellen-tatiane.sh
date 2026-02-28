#!/bin/bash
# Test login for Hellen and Tatiane
echo "=== Testing Hellen ==="
RESP=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"hellen.nascimento@aluforce.ind.br","password":"alu0103"}')
echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"

echo ""
echo "=== Testing Tatiane ==="
RESP2=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tatiane.sousa@aluforce.ind.br","password":"alu0103"}')
echo "$RESP2" | python3 -m json.tool 2>/dev/null || echo "$RESP2"

echo ""
echo "=== Testing Hellen /api/me ==="
TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  curl -s http://localhost:3000/api/me -H "Authorization: Bearer $TOKEN" -b "authToken=$TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('areas:', d.get('areas',[])); print('permissoes:', d.get('permissoes',[]))" 2>/dev/null
else
  echo "No token - trying /api/me with cookie"
fi
