const request = require('supertest');
const bcrypt = require('bcrypt');

jest.mock('mysql2/promise', () => ({
  createPool: () => ({ query: jest.fn() })
}));

describe('E2E smoke (mocked DB) - fluxo de Augusto: login -> criar -> editar -> apagar', () => {
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

  test('fluxo completo de criar, editar e apagar como vendedor atribuído', async () => {
    const userId = 42;
    const userEmail = 'augusto@local';
    const fakeHash = await bcrypt.hash('SenhaSegura1!', 10);

    // Implementação de mock baseada no SQL — simples switch por conteúdo
    poolMock.query.mockImplementation(async (sql, params) => {
      const s = (sql || '').toString();
      if (s.includes('FROM usuarios WHERE email')) {
        return [[{ id: userId, nome: 'Augusto Ladeira', email: userEmail, senha_hash: fakeHash, role: 'user' }]];
      }
      if (s.startsWith('INSERT INTO pedidos')) {
        return [{ insertId: 999 }];
      }
      if (s.startsWith('SELECT vendedor_id FROM pedidos WHERE id =')) {
        // when checking existing pedido for edit/delete, simulate vendedor_id = userId
        return [[{ vendedor_id: userId }]];
      }
      if (s.startsWith('UPDATE pedidos SET')) {
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('DELETE FROM pedidos WHERE id =')) {
        return [{ affectedRows: 1 }];
      }
      // fallback for other queries (dashboard/select 1)
      return [[1]];
    });

    // 1) login
    const loginResp = await request(app).post('/api/login').send({ email: userEmail, password: 'SenhaSegura1!' }).expect(200);
    expect(loginResp.body).toHaveProperty('token');
    const token = loginResp.body.token;

    // 2) criar pedido
    const createResp = await request(app)
      .post('/api/vendas/pedidos')
      .set('Authorization', `Bearer ${token}`)
      .send({ empresa_id: 1, valor: 1500 })
      .expect(201);
    expect(createResp.body).toHaveProperty('insertedId', 999);

    // 3) editar pedido (PUT) - server will check vendedor_id and allow
    const putResp = await request(app)
      .put('/api/vendas/pedidos/999')
      .set('Authorization', `Bearer ${token}`)
      .send({ empresa_id: 1, valor: 1600 })
      .expect(200);
    expect(putResp.body).toHaveProperty('message');

    // 4) apagar pedido
    const delResp = await request(app)
      .delete('/api/vendas/pedidos/999')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});
