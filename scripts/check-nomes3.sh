#!/bin/bash
# Check nomeOperador in CDR records - v3
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"douglas@aluforce.ind.br","password":"alu0103"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token","ERRO"))' 2>/dev/null)

echo "Token: ${TOKEN:0:20}..."

# Use a variable for the URL to avoid & issues
URL="http://localhost:3000/api/vendas/ligacoes/cdr?dataInicio=2026-02-23&dataFim=2026-02-23"
echo "Fetching CDR data (may take 30-60s for Puppeteer)..."

RESP=$(curl -s --max-time 120 "$URL" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
RESP_LEN=${#RESP}
echo "Response length: $RESP_LEN chars"

if [ $RESP_LEN -gt 10 ]; then
    echo "$RESP" | python3 << 'PYEOF'
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception as e:
    print(f"Parse error: {e}")
    print("Raw (first 300):", raw[:300])
    sys.exit(1)

if "error" in d or "message" in d:
    print("API Error:", d.get("message", d.get("error", "unknown")))
    sys.exit(1)

recs = d.get("registros", d.get("data", []))
print(f"Total records: {len(recs)}")
if recs:
    print(f"Record keys: {list(recs[0].keys())}")
    print()
    for r in recs[:5]:
        ramal = r.get("ramal", "?")
        op = r.get("nomeOperador", "N/A")
        dest = r.get("destino", "?")
        dur = r.get("duracao", "?")
        print(f"  {ramal:15s} | {op:20s} | {dest:20s} | {dur}")
PYEOF
else
    echo "Empty response!"
fi
