const http = require('http');
const d = JSON.stringify({email:'qafinanceiro@aluforce.ind.br', password:'Teste@123'});
const r = http.request({hostname:'localhost',port:3000,path:'/api/login',method:'POST',
  headers:{'Content-Type':'application/json','Content-Length':d.length}
}, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(b);
      if (j.token) {
        // Test vencidas route
        const opts = {hostname:'localhost',port:3000,method:'GET',
          headers:{'Authorization':'Bearer '+j.token}};
        
        const routes = [
          '/api/financeiro/contas-pagar/vencidas',
          '/api/financeiro/contas-pagar/vencendo',
          '/api/financeiro/contas-pagar/estatisticas',
          '/api/financeiro/contas-pagar/resumo',
          '/api/financeiro/contas-receber/vencidas',
          '/api/financeiro/contas-receber/inadimplentes',
          '/api/financeiro/contas-receber/estatisticas',
          '/api/financeiro/contas-receber/resumo',
          '/api/financeiro/alertas',
          '/api/financeiro/relatorios/dre?ano=2025',
          '/api/financeiro/relatorios/lucratividade?periodo=mensal',
          '/api/financeiro/fornecedores',
          '/api/financeiro/clientes',
        ];
        
        let done = 0;
        routes.forEach(path => {
          const req2 = http.request({...opts, path}, res2 => {
            let b2 = '';
            res2.on('data', c => b2 += c);
            res2.on('end', () => {
              const status = res2.statusCode;
              const ok = status === 200 ? 'OK' : 'FAIL';
              let detail = '';
              try { const j2 = JSON.parse(b2); detail = j2.message || j2.error || ''; } catch(e) {}
              console.log(`${ok} [${status}] ${path} ${detail}`);
              done++;
              if (done === routes.length) console.log('\nDONE: ' + done + ' routes tested');
            });
          });
          req2.on('error', e => { console.log('ERR ' + path + ' ' + e.message); done++; });
          req2.end();
        });
      } else {
        console.log('LOGIN FAILED:', b.substring(0, 200));
      }
    } catch(e) { console.log('PARSE ERROR:', b.substring(0, 200)); }
  });
});
r.write(d);
r.end();
