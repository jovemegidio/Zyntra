#!/bin/bash
# Quick check nomeOperador in CDR
LOGIN_JSON='{"email":"douglas@aluforce.ind.br","password":"alu0103"}'
TOKEN=$(curl -s -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' -d "$LOGIN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token","ERRO"))' 2>/dev/null)
curl -s "http://localhost:3000/api/vendas/ligacoes/cdr?dataInicio=2026-02-23&dataFim=2026-02-23" \
  -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
recs = d.get("registros", d.get("data", []))
for r in recs[:5]:
    ramal = r.get("ramal", "?")
    op = r.get("nomeOperador", "N/A")
    dest = r.get("destino", "?")
    print("Ramal:", ramal, "| Operador:", op, "| Destino:", dest)
' 2>/dev/null
