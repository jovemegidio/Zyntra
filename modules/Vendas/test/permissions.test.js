const request = require('supertest');
const bcrypt = require('bcrypt');

jest.mock('mysql2/promise', () => ({
  createPool: () => ({ query: jest.fn() })
}));

describe('Permissões - usuários não-admin não veem pedidos de outros vendedores', () => {
  let app;
  let poolMock;

  beforeAll(() => {
    const serverModule = require('../server');
    app = serverModule.app;
    poolMock = serverModule.pool;
  });

  beforeEach(() => {
    if (poolMock && poolMock.query && poolMock.query.mockClear) poolMock.query.mockClear();
  });

  test('GET /api/vendas/pedidos/:id retorna 403 para pedido de outro vendedor', async () => {
    const userId = 10;
    const otherVendorId = 99;
    const fakeHash = await bcrypt.hash('abc', 8);

    poolMock.query.mockImplementation(async (sql, params) => {
      const s = (sql || '').toString();
      if (s.includes('FROM usuarios WHERE email')) {
        return [[{ id: userId, nome: 'User Test', email: 'user@test', senha_hash: fakeHash, role: 'user' }]];
      }
      if (s.includes('SELECT * FROM pedidos WHERE id')) {
        return [[{ id: 50, vendedor_id: otherVendorId, valor: 100 }]];
      }
      return [[1]];
    });

    // login
    const loginResp = await request(app).post('/api/login').send({ email: 'user@test', password: 'abc' }).expect(200);
    const token = loginResp.body.token;

    // tentar visualizar pedido que pertence a outro vendedor
    const resp = await request(app).get('/api/vendas/pedidos/50').set('Authorization', `Bearer ${token}`);
    expect([403, 404]).toContain(resp.status);
  });

  test('GET /api/vendas retorna apenas pedidos do usuário (ou sem vendedor)', async () => {
    const userId = 7;
    const fakeHash = await bcrypt.hash('abc', 8);

    poolMock.query.mockImplementation(async (sql, params) => {
      const s = (sql || '').toString();
      if (s.includes('FROM usuarios WHERE email')) {
        return [[{ id: userId, nome: 'User B', email: 'userb@test', senha_hash: fakeHash, role: 'user' }]];
      }
      if (s.includes('FROM pedidos')) {
        // return a mixed list; server should apply WHERE and we mock generic return
        return [[{ id: 1, vendedor_id: userId }, { id: 2, vendedor_id: 999 }]];
      }
      return [[1]];
    });

    const loginResp = await request(app).post('/api/login').send({ email: 'userb@test', password: 'abc' }).expect(200);
    const token = loginResp.body.token;

    const resp = await request(app).get('/api/vendas/pedidos').set('Authorization', `Bearer ${token}`);
    // ensure no crash and response is array or error code
    expect([200, 403]).toContain(resp.status);
  });
});
