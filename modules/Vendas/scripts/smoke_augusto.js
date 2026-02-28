// Script de smoke que tenta logar e criar/editar/apagar um pedido contra servidor local
// Uso: node scripts/smoke_augusto.js

const fetch = require('node-fetch');

(async () => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  try {
    // login
    const login = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.SMOKE_USER_EMAIL || 'augusto.ladeira@aluforce.ind.br', password: process.env.SMOKE_USER_PASSWORD || 'SuaSenhaAqui' })
    });
    if (!login.ok) return console.error('Login falhou', await login.text());
    const loginData = await login.json();
    const token = loginData.token;
    console.log('Login ok, token obtido');

    // criar
    const create = await fetch(base + '/api/vendas/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ empresa_id: 1, valor: 123.45 })
    });
    if (!create.ok) return console.error('Criação falhou', await create.text());
    const createData = await create.json();
    console.log('Pedido criado id=', createData.insertedId || createData.insertId);

    // editar
    const id = createData.insertedId || createData.insertId;
    const edit = await fetch(base + `/api/vendas/pedidos/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ empresa_id: 1, valor: 200 })
    });
    console.log('Editar status:', edit.status);

    // apagar
    const del = await fetch(base + `/api/vendas/pedidos/${id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    console.log('Delete status:', del.status);

  } catch (err) {
    console.error('Erro no smoke:', err.message);
  }
})();
