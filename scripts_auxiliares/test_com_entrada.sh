#!/bin/bash
echo "=== Testing login endpoints ==="
for path in "/login" "/api/login" "/auth/login" "/api/auth/login"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:3000${path}" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}')
  echo "POST $path -> $CODE"
done

echo ""
echo "=== Testing /api/pcp/produtos/com-entrada without auth ==="
curl -s -o /dev/null -w 'Status: %{http_code}\n' "http://localhost:3000/api/pcp/produtos/com-entrada?limit=3"

echo ""
echo "=== Getting token via /login ==="
RESP=$(curl -s -X POST "http://localhost:3000/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("token",""))' 2>/dev/null)
echo "Token length: ${#TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Login admin failed, trying andreia..."
  RESP=$(curl -s -X POST "http://localhost:3000/login" -H "Content-Type: application/json" -d '{"username":"andreia","password":"andreia123"}')
  TOKEN=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("token",""))' 2>/dev/null)
  echo "Token length: ${#TOKEN}"
fi

if [ -z "$TOKEN" ]; then
  echo "All logins failed. Testing API directly without token..."
  # Try MySQL direct to see if products exist
  echo ""
  echo "=== MySQL: count produtos with estoque > 0 ==="
  mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SELECT COUNT(*) as total FROM produtos WHERE (estoque_atual > 0 OR quantidade_estoque > 0) AND (status = 'ativo' OR status IS NULL);" 2>/dev/null
  echo ""
  echo "=== MySQL: sample produtos ==="
  mysql -u aluforce -pAluforce2026VpsDB aluforce_vendas -e "SELECT id, codigo, LEFT(descricao,40) as descricao, estoque_atual, quantidade_estoque, status FROM produtos WHERE (estoque_atual > 0 OR quantidade_estoque > 0) LIMIT 5;" 2>/dev/null
else
  echo ""
  echo "=== Testing API with token ==="
  RESULT=$(curl -s "http://localhost:3000/api/pcp/produtos/com-entrada?limit=5" -H "Authorization: Bearer $TOKEN")
  echo "$RESULT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("Total:", d.get("total",0), "Rows:", len(d.get("rows",[])), "Stats:", d.get("stats",{}))'
fi

echo ""
echo "=== PM2 Logs (com-entrada) ==="
pm2 logs aluforce-dashboard --lines 20 --nostream 2>&1 | grep -i "PRODUTOS_COM"
