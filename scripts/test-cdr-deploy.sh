#!/bin/bash
# Test CDR endpoints after deploy
echo "=== Testando CDR Deploy ==="

# Login
LOGIN_JSON='{"email":"douglas@aluforce.ind.br","password":"alu0103"}'
LOGIN_RESP=$(curl -s -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON")
TOKEN=$(echo "$LOGIN_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token","ERRO"))' 2>/dev/null)

if [ "$TOKEN" = "ERRO" ] || [ -z "$TOKEN" ]; then
    echo "ERRO: Falha no login"
    echo "Resp: $LOGIN_RESP"
    exit 1
fi
echo "Login OK"

# Test status
echo ""
echo "=== /ligacoes/status ==="
curl -s http://localhost:3000/api/vendas/ligacoes/status \
  -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print(json.dumps(d, indent=2, ensure_ascii=False))
' 2>/dev/null | head -20

# Test dispositivos (ramais with names)
echo ""
echo "=== /ligacoes/dispositivos ==="
curl -s http://localhost:3000/api/vendas/ligacoes/dispositivos \
  -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print(json.dumps(d, indent=2, ensure_ascii=False))
' 2>/dev/null | head -30

# Test CDR (first 3 records to check nomeOperador)
echo ""
DI=$(date +%Y-%m-%d)
echo "=== /ligacoes/cdr (primeiros 3 - data: $DI) ==="
curl -s "http://localhost:3000/api/vendas/ligacoes/cdr?dataInicio=$DI&dataFim=$DI" \
  -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("Total registros:", d.get("total", "?"))
recs = d.get("registros", d.get("data", []))
for r in recs[:3]:
    print(f"  Ramal: {r.get(chr(114)+chr(97)+chr(109)+chr(97)+chr(108),chr(63))} | Operador: {r.get(chr(110)+chr(111)+chr(109)+chr(101)+chr(79)+chr(112)+chr(101)+chr(114)+chr(97)+chr(100)+chr(111)+chr(114),chr(78)+chr(47)+chr(65))} | Destino: {r.get(chr(100)+chr(101)+chr(115)+chr(116)+chr(105)+chr(110)+chr(111),chr(63))}")
' 2>/dev/null

echo ""
echo "=== Teste completo ==="
