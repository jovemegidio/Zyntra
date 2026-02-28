#!/bin/bash
# Check nomeOperador in CDR records
LOGIN_JSON='{"email":"douglas@aluforce.ind.br","password":"alu0103"}'
TOKEN=$(curl -s -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token","ERRO"))' 2>/dev/null)
echo "Token: ${TOKEN:0:20}..."
RESP=$(curl -s --max-time 60 "http://localhost:3000/api/vendas/ligacoes/cdr?dataInicio=2026-02-23&dataFim=2026-02-23" -H "Authorization: Bearer $TOKEN")
echo "$RESP" | python3 << 'PYEOF'
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except:
    print("Parse error, raw:", raw[:200])
    sys.exit(1)
recs = d.get("registros", d.get("data", []))
print("Total:", len(recs))
if recs:
    print("Keys:", list(recs[0].keys()))
    for r in recs[:5]:
        print(f"  Ramal: {r.get('ramal','?'):15s} | Operador: {r.get('nomeOperador','N/A'):20s} | Destino: {r.get('destino','?')}")
else:
    print("No records")
    print("Response:", json.dumps(d, indent=2, ensure_ascii=False)[:500])
PYEOF
