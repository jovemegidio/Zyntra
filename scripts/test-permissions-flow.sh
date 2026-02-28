#!/bin/bash
# Simula o fluxo completo: login → verifica areas retornadas → verifica /api/me
echo "=== TESTE COMPLETO: Fluxo de Permissões ==="

echo ""
echo "--- 1. Login Hellen ---"
RESP=$(curl -s -c /tmp/cookies_hellen.txt -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"hellen.nascimento@aluforce.ind.br","password":"alu0103"}')

# Extrair dados
TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
AREAS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('areas',[]))" 2>/dev/null)
IS_ADMIN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('is_admin',0))" 2>/dev/null)
echo "Login areas: $AREAS"
echo "is_admin: $IS_ADMIN"

echo ""
echo "--- 2. /api/me Hellen ---"
ME=$(curl -s http://localhost:3000/api/me \
  -H "Authorization: Bearer $TOKEN" \
  -b "authToken=$TOKEN")
ME_AREAS=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('areas',[]))" 2>/dev/null)
ME_PERMS=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('permissoes',[]))" 2>/dev/null)
ME_ADMIN=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('is_admin',0))" 2>/dev/null)
echo "/api/me areas: $ME_AREAS"
echo "/api/me permissoes: $ME_PERMS"
echo "/api/me is_admin: $ME_ADMIN"

echo ""
echo "--- 3. Login Tatiane ---"
RESP2=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tatiane.sousa@aluforce.ind.br","password":"alu0103"}')
TOKEN2=$(echo "$RESP2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
AREAS2=$(echo "$RESP2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('areas',[]))" 2>/dev/null)
echo "Login areas: $AREAS2"

echo ""
echo "--- 4. /api/me Tatiane ---"
ME2=$(curl -s http://localhost:3000/api/me \
  -H "Authorization: Bearer $TOKEN2" \
  -b "authToken=$TOKEN2")
ME2_AREAS=$(echo "$ME2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('areas',[]))" 2>/dev/null)
echo "/api/me areas: $ME2_AREAS"

echo ""
echo "--- 5. Login Admin (Douglas) - deve ter todas as areas ---"
RESP3=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"douglas@aluforce.ind.br","password":"alu0103"}')
AREAS3=$(echo "$RESP3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('areas',[]))" 2>/dev/null)
IS_ADMIN3=$(echo "$RESP3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('is_admin',0))" 2>/dev/null)
echo "Login areas: $AREAS3"
echo "is_admin: $IS_ADMIN3"

echo ""
echo "=== RESULTADO ESPERADO ==="
echo "Hellen:  areas=['financeiro', 'rh'] → Cards: Financeiro + RH"
echo "Tatiane: areas=['financeiro', 'rh'] → Cards: Financeiro + RH"
echo "Douglas: is_admin=1 → Cards: TODOS (6)"
