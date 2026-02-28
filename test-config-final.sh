#!/bin/bash
cd /var/www/aluforce
TOKEN=$(node -e 'const jwt=require("jsonwebtoken"); const token=jwt.sign({id:1,nome:"Ana Paula",email:"ana.nascimento@aluforce.ind.br",is_admin:0}, process.env.JWT_SECRET || "e1c084f3afad7116058bba8444655d9b328145b8ae72385da0499bf8b71c3324", {expiresIn:"1h"}); console.log(token)')
echo "TOKEN_LEN: ${#TOKEN}"
echo "--- EMPRESA ---"
curl -s -w '\nHTTP:%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/configuracoes/empresa | head -c 400
echo ""
echo "--- IMPOSTOS ---"
curl -s -w '\nHTTP:%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/configuracoes/impostos | head -c 400
echo ""
