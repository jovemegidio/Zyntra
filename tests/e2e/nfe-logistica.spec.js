const { test, expect } = require('@playwright/test');

function mockLogisticaApis(page) {
  let transportadoras = [
    { id: 1, nome: 'Trans Rápida', cnpj: '12.345.678/0001-90', telefone: '(11) 99999-1111', email: 'contato@transrapida.com', contato: 'Carlos' }
  ];

  page.route('**/js/auth-unified.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.AuthUnified = window.AuthUnified || {};'
    });
  });

  page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dados: { nome: 'Usuário Teste' } })
    });
  });

  page.route('**/api/logistica/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dashboard: {
          aguardando: 1,
          em_separacao: 1,
          em_expedicao: 1,
          em_transporte: 1,
          entregues: 1
        }
      })
    });
  });

  page.route('**/api/logistica/pedidos', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pedidos: [
          {
            id: 1,
            nfe: 'NFE-1001',
            pedido: 'PED-1001',
            cliente: 'Cliente Teste',
            cidade: 'São Paulo',
            uf: 'SP',
            transportadora_id: 1,
            transportadora: 'Trans Rápida',
            prioridade: 'media',
            status: 'aguardando',
            previsao: '2026-03-05'
          }
        ]
      })
    });
  });

  page.route('**/api/logistica/pedidos/*/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  page.route('**/api/logistica/expedicao', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  page.route('**/api/logistica/transportadoras', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transportadoras })
      });
      return;
    }

    if (method === 'POST') {
      const data = route.request().postDataJSON();
      const nextId = transportadoras.length ? Math.max(...transportadoras.map(t => t.id)) + 1 : 1;
      transportadoras.push({ id: nextId, ...data });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: nextId }) });
      return;
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'method_not_allowed' }) });
  });

  page.route('**/api/logistica/transportadoras/*', async (route) => {
    const method = route.request().method();
    const match = route.request().url().match(/transportadoras\/(\d+)/);
    const id = match ? Number(match[1]) : 0;

    if (method === 'PUT') {
      const data = route.request().postDataJSON();
      transportadoras = transportadoras.map((item) => (item.id === id ? { ...item, ...data } : item));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (method === 'DELETE') {
      transportadoras = transportadoras.filter((item) => item.id !== id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'method_not_allowed' }) });
  });
}

test.describe('NFe Logística', () => {
  test.beforeEach(async ({ page }) => {
    mockLogisticaApis(page);

    await page.addInitScript(() => {
      window.__alerts = [];
      window.alert = (msg) => window.__alerts.push(String(msg));
      window.confirm = () => true;
      window.prompt = () => '2';
      window.open = () => ({ document: { write: () => {} } });
      window.URL.createObjectURL = () => 'blob:mock';
    });
  });

  test('deve carregar e acionar os botões principais sem erro', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/modules/NFe/logistica.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#pedidosTableBody tr')).toHaveCount(1);

    await page.getByRole('button', { name: /Filtrar/i }).click();
    await page.getByRole('button', { name: /Limpar/i }).click();
    await page.getByRole('button', { name: /Nova Expedição/i }).click();
    await expect(page.locator('#modalExpedicao')).toHaveClass(/active/);
    await page.getByRole('button', { name: /Cancelar/i }).click();
    await expect(page.locator('#modalExpedicao')).not.toHaveClass(/active/);

    await page.getByRole('button', { name: /Transportadoras/i }).click();
    await expect(page.locator('#modalTransportadoras')).toHaveClass(/active/);
    await page.getByRole('button', { name: /^Fechar$/i }).click();
    await expect(page.locator('#modalTransportadoras')).not.toHaveClass(/active/);

    await page.getByRole('button', { name: /Exportar/i }).click();

    await page.locator('button[title="Detalhes"]').first().click();
    await page.locator('button[title="Atualizar Status"]').first().click();
    await page.locator('button[title="Imprimir Etiqueta"]').first().click();

    expect(errors).toEqual([]);
  });

  test('deve executar ciclo de funções por 20 iterações', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/modules/NFe/logistica.html');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        document.getElementById('filtroBusca').value = i % 2 === 0 ? 'NFE' : '';
        renderizarPedidos();
        limparFiltros();
        abrirModalExpedicao();
        fecharModalExpedicao();
        abrirModalTransportadoras();
        mostrarFormTransportadora();
        document.getElementById('transpNome').value = `Trans ${i}`;
        document.getElementById('transpCNPJ').value = `00.000.000/000${i}`;
        document.getElementById('transpTelefone').value = `(11) 90000-00${String(i).padStart(2, '0')}`;
        document.getElementById('transpEmail').value = `trans${i}@teste.com`;
        document.getElementById('transpContato').value = `Contato ${i}`;
        await salvarTransportadora();
        fecharModalTransportadoras();

        atualizarStatus(1);
        verDetalhes(1);
        imprimirEtiqueta(1);
        exportarExcel();
      }

      return {
        pedidos: document.querySelectorAll('#pedidosTableBody tr').length,
        alerts: Array.isArray(window.__alerts) ? window.__alerts.length : 0
      };
    });

    expect(result.pedidos).toBeGreaterThan(0);
    expect(result.alerts).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
