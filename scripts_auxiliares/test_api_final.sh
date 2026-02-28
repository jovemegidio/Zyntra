#!/bin/bash
# Test the /api/pcp/produtos/com-entrada endpoint

echo "=== Verificando deploy ==="
grep -n "produtos/:id" /var/www/aluforce/routes/pcp-routes.js | head -3
echo ""
grep -c "Filtrar apenas produtos com estoque" /var/www/aluforce/modules/PCP/pages/estoque.html
grep -c "Usar todos os produtos" /var/www/aluforce/modules/PCP/pages/estoque.html

echo ""
echo "=== Teste com JWT direto ==="
# Gerar token JWT inline via node
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || require('/var/www/aluforce/config/config.js').jwtSecret || 'aluforce-secret-key';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, secret, { expiresIn: '1h' });
console.log(token);
" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  # Try reading secret from .env
  SECRET=$(grep JWT_SECRET /var/www/aluforce/.env 2>/dev/null | cut -d= -f2)
  if [ -z "$SECRET" ]; then
    SECRET="aluforce-secret-key"
  fi
  TOKEN=$(node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({id:1,username:'admin',role:'admin'},'$SECRET',{expiresIn:'1h'}));" 2>/dev/null)
fi

echo "Token length: ${#TOKEN}"

if [ ${#TOKEN} -gt 10 ]; then
  echo ""
  echo "=== Chamando /api/pcp/produtos/com-entrada ==="
  RESULT=$(curl -s "http://localhost:3000/api/pcp/produtos/com-entrada?limit=10" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json")
  
  echo "$RESULT" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try {
        const j=JSON.parse(d);
        console.log('HTTP OK');
        console.log('Total:', j.total);
        console.log('Rows:', (j.rows||[]).length);
        console.log('Stats:', JSON.stringify(j.stats));
        if (j.rows && j.rows.length > 0) {
          console.log('Primeiro produto:', JSON.stringify({id:j.rows[0].id, nome:j.rows[0].nome||j.rows[0].descricao, estoque:j.rows[0].estoque_atual, bobinas:j.rows[0].total_bobinas}));
        }
      } catch(e) {
        console.log('Parse error:', e.message);
        console.log('Body:', d.substring(0,300));
      }
    });
  "
else
  echo "Falha ao gerar token"
fi

echo ""
echo "=== PM2 Logs (últimos com-entrada) ==="
pm2 logs aluforce-dashboard --lines 30 --nostream 2>&1 | grep -i "PRODUTOS_COM"
