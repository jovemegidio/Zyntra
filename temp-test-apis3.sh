#!/bin/bash
RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa","senha":"Qa@2024!"}')

echo "Login: ${RESPONSE:0:100}"

TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "Trying alt login..."
  RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@aluforce.com.br","senha":"Admin@2024!"}')
  echo "Login2: ${RESPONSE:0:100}"
  TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
fi

if [ -z "$TOKEN" ]; then
  echo "Cannot get token - testing routes without auth"
  # Just check if routes return 401 (route exists) vs 404 (route missing)
  for ROUTE in "/api/vendas/regioes" "/api/configuracoes/condicoes-pagamento" "/api/produtos/unidades-medida" "/api/configuracoes/familias" "/api/configuracoes/caracteristicas" "/api/configuracoes/vendedores" "/api/produtos/ncm" "/api/produtos/tabelas-preco" "/api/servicos/sla"; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${ROUTE}")
    if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
      echo "  $ROUTE => OK (route exists, $CODE)"
    elif [ "$CODE" = "200" ]; then
      echo "  $ROUTE => OK ($CODE)"
    else
      echo "  $ROUTE => FAIL ($CODE)"
    fi
  done
  echo "DONE"
  exit 0
fi

echo "Token OK: ${TOKEN:0:30}..."

for ROUTE in "/api/vendas/regioes" "/api/configuracoes/condicoes-pagamento" "/api/produtos/unidades-medida" "/api/configuracoes/familias" "/api/configuracoes/caracteristicas" "/api/configuracoes/vendedores" "/api/produtos/ncm" "/api/produtos/tabelas-preco" "/api/servicos/sla"; do
  RESP=$(curl -s "http://localhost:3000${ROUTE}" -H "Authorization: Bearer $TOKEN")
  echo "  $ROUTE => $(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); items=d.get('data',d) if isinstance(d,dict) else d; print(f'OK - {len(items)} items')" 2>/dev/null || echo "Response: ${RESP:0:80}")"
done
echo "DONE"
