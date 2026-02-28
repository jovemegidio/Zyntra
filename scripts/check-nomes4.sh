#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"douglas@aluforce.ind.br","password":"alu0103"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token","ERRO"))' 2>/dev/null)

URL="http://localhost:3000/api/vendas/ligacoes/cdr?dataInicio=2026-02-23&dataFim=2026-02-23"
RESP=$(curl -s --max-time 120 "$URL" -H "Authorization: Bearer $TOKEN" 2>/dev/null)

# Show first bytes hex
echo "First 50 chars:"
echo "$RESP" | head -c 200

echo ""
echo "---"
# Find first { 
echo "Looking for JSON start..."
echo "$RESP" | python3 -c '
import sys
raw = sys.stdin.read()
print(f"Length: {len(raw)}")
print(f"First 10 bytes hex: {raw[:10].encode().hex()}")
idx = raw.find("{")
print(f"First {{ at position: {idx}")
if idx >= 0:
    print(f"Before {{: repr={repr(raw[:idx])}")
    import json
    try:
        d = json.loads(raw[idx:])
        recs = d.get("registros", d.get("data", []))
        print(f"Records: {len(recs)}")
        if recs:
            print(f"Keys: {list(recs[0].keys())}")
            for r in recs[:3]:
                print(f"  {r.get(\"ramal\",\"?\"):15s} | {r.get(\"nomeOperador\",\"N/A\"):20s} | {r.get(\"destino\",\"?\")}")
    except Exception as e:
        print(f"Parse error: {e}")
' 2>/dev/null
