#!/bin/bash
# Test admin login to verify no regression
echo "=== Testing Admin (douglas) ==="
RESP=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"douglas@aluforce.ind.br","password":"alu0103"}')
echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
u = d.get('user', {})
print('User:', u.get('nome'))
print('is_admin:', u.get('is_admin'))
print('areas:', u.get('areas', []))
print('Login OK:', d.get('success'))
" 2>/dev/null

echo ""
echo "=== Testing Comercial (augusto) ==="
RESP2=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"augusto.ladeira@aluforce.ind.br","password":"alu0103"}')
echo "$RESP2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
u = d.get('user', {})
print('User:', u.get('nome'))
print('is_admin:', u.get('is_admin'))
print('areas:', u.get('areas', []))
print('Login OK:', d.get('success'))
" 2>/dev/null
