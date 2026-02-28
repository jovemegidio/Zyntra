#!/bin/bash
# Test script for new APIs
echo "=== Testing ALUFORCE v2.0 APIs ==="

# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aluforce.com.br","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Login falhou - tentando com outro user"
  TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"daniel@aluforce.com.br","password":"Aluforce@2026"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Login falhou com ambos os users"
  # Test without auth to confirm routes exist
  echo "--- Test sem auth (deve retornar 'token não fornecido') ---"
  for endpoint in /api/contabil/cfop /api/cte /api/nf-entrada /api/fornecedores /api/fiscal/regime; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000$endpoint)
    echo "$endpoint → HTTP $STATUS"
  done
  exit 0
fi

echo "✅ Token obtido: ${TOKEN:0:20}..."

# Test each new endpoint
echo ""
echo "=== FASE 1: Fiscal Config ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/fiscal/regime 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('Status:', d.get('success', d))" 2>/dev/null || echo "⚠️ /api/fiscal/regime: sem resposta JSON"

echo ""
echo "=== FASE 3: NF Entrada ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/nf-entrada)
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Total NFs:', d.get('total', len(d) if isinstance(d,list) else d))" 2>/dev/null || echo "Resp: $RESP" | head -100

echo ""
echo "=== FASE 3: Fornecedores ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/fornecedores)
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Fornecedores:', d.get('total', len(d) if isinstance(d,list) else d))" 2>/dev/null || echo "Resp: $RESP" | head -100

echo ""
echo "=== FASE 4: Contábil/CFOP ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/contabil/cfop)
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('CFOPs:', len(d) if isinstance(d,list) else d)" 2>/dev/null || echo "Resp: $RESP" | head -100

echo ""
echo "=== FASE 4: Dashboard Contábil ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/contabil/dashboard)
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Dashboard:', list(d.keys()) if isinstance(d,dict) else d)" 2>/dev/null || echo "Resp: $RESP" | head -100

echo ""
echo "=== FASE 5: CT-e ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/cte)
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('CT-es:', d.get('total', len(d) if isinstance(d,list) else d))" 2>/dev/null || echo "Resp: $RESP" | head -100

echo ""
echo "=== FASE 5: Veículos ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/cte/veiculos/lista)
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Veículos:', len(d) if isinstance(d,list) else d)" 2>/dev/null || echo "Resp: $RESP" | head -100

echo ""
echo "=== HEALTH CHECK ==="
curl -s http://localhost:3000/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('Status:', d['status'], '| DB:', d['database']['status'], '| Uptime:', d['uptime'], 's')" 2>/dev/null

echo ""
echo "✅ TESTE COMPLETO"
