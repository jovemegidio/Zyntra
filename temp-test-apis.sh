#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"qa","senha":"Qa@2024"}' | grep -o '"token":"[^"]*"' | head -1 | sed 's/"token":"//;s/"//')

echo "=== REGIOES ==="
curl -s http://localhost:3000/api/vendas/regioes -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== CONDICOES ==="
curl -s http://localhost:3000/api/configuracoes/condicoes-pagamento -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== UNIDADES ==="
curl -s http://localhost:3000/api/produtos/unidades-medida -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== FAMILIAS ==="
curl -s http://localhost:3000/api/configuracoes/familias -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== CARACTERISTICAS ==="
curl -s http://localhost:3000/api/configuracoes/caracteristicas -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== VENDEDORES ==="
curl -s http://localhost:3000/api/configuracoes/vendedores -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== NCM ==="
curl -s http://localhost:3000/api/produtos/ncm -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "=== TABELAS PRECO ==="
curl -s http://localhost:3000/api/produtos/tabelas-preco -H "Authorization: Bearer $TOKEN" | head -c 300
echo ""
echo "DONE"
