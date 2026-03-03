#!/bin/bash
# Login
RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"qa","senha":"Qa@2024"}')

echo "Login response: ${RESPONSE:0:80}"

TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
echo "Token: ${TOKEN:0:30}..."

if [ -z "$TOKEN" ]; then
  echo "FAILED to get token"
  exit 1
fi

echo "=== REGIOES ==="
curl -s http://localhost:3000/api/vendas/regioes -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== CONDICOES ==="
curl -s http://localhost:3000/api/configuracoes/condicoes-pagamento -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== UNIDADES ==="
curl -s http://localhost:3000/api/produtos/unidades-medida -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== FAMILIAS ==="
curl -s http://localhost:3000/api/configuracoes/familias -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== CARACTERISTICAS ==="
curl -s http://localhost:3000/api/configuracoes/caracteristicas -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== VENDEDORES ==="
curl -s http://localhost:3000/api/configuracoes/vendedores -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== NCM ==="
curl -s http://localhost:3000/api/produtos/ncm -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== TABELAS PRECO ==="
curl -s http://localhost:3000/api/produtos/tabelas-preco -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "=== SLA ==="
curl -s http://localhost:3000/api/servicos/sla -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK - {len(d.get(\"data\",d))} items' if isinstance(d,dict) or isinstance(d,list) else d)" 2>/dev/null || echo "ERROR"

echo "DONE"
