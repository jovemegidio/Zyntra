// =============================================================================
// TESTE COMPLETO: Criar Pedido -> Estoque -> Cancelar -> Estorno
// Vendedor: Ronaldo Torres (id:54) | Produto: TRN10C (estoque:600)
// =============================================================================
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const http = require('http');

const DB = { host:'localhost', user:'aluforce', password:'Aluforce2026VpsDB', database:'aluforce_vendas' };
const JWT_SECRET = process.env.JWT_SECRET || 'e1c084f3afad7116058bba8444655d9b328145b8ae72385da0499bf8b71c3324';

// Gerar token JWT admin valido
const adminToken = jwt.sign({
    id: 1, nome: 'Admin Teste', email: 'ti@aluforce.ind.br', role: 'admin', is_admin: true
}, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '1h' });

let conn;

function log(label, data) {
    console.log('\n' + '='.repeat(60));
    console.log('  ' + label);
    console.log('='.repeat(60));
    if (data !== undefined) console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function query(sql, params) {
    const [rows] = await conn.query(sql, params || []);
    return rows;
}

function apiCall(method, path, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: 'localhost', port: 3000,
            path: '/api/vendas' + path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + adminToken
            }
        };
        if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

        const req = http.request(opts, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch(e) { resolve({ status: res.statusCode, data: body }); }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function getEstoque(codigo) {
    const rows = await query('SELECT id, codigo, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ?', [codigo]);
    return rows.length > 0 ? {
        atual: parseFloat(rows[0].estoque_atual),
        cancelado: parseFloat(rows[0].estoque_cancelado || 0)
    } : null;
}

(async () => {
    try {
        conn = await mysql.createConnection(DB);
        console.log('\n>> Conectado ao banco aluforce_vendas\n');

        const PRODUTO = 'TRN10C';
        const QTD_TESTE = 5;

        // ==================================================================
        // PASSO 1: Estoque inicial
        // ==================================================================
        const estoqueInicial = await getEstoque(PRODUTO);
        log('PASSO 1 - ESTOQUE INICIAL', { produto: PRODUTO, estoque: estoqueInicial.atual, cancelado: estoqueInicial.cancelado });

        // ==================================================================
        // PASSO 2: Criar pedido DIRETAMENTE no banco (evita conflito de rotas)
        // ==================================================================
        log('PASSO 2 - CRIANDO NOVO PEDIDO (via DB)', 'Vendedor: Ronaldo Torres (id:54), Qtd: ' + QTD_TESTE);

        // Criar pedido
        const insertResult = await query(
            "INSERT INTO pedidos (empresa_id, vendedor_id, valor, descricao, status, condicao_pagamento, created_at) VALUES (1, 54, ?, 'Teste automatizado estorno estoque', 'orcamento', 'A Vista', NOW())",
            [QTD_TESTE * 100]
        );
        const pedidoId = insertResult.insertId;
        
        // Criar itens do pedido
        await query(
            "INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, unidade, preco_unitario) VALUES (?, ?, 'Trincheira 10mm Teste', ?, 'M', 100)",
            [pedidoId, PRODUTO, QTD_TESTE]
        );
        
        console.log('>> Pedido criado: #' + pedidoId);

        const estoqueAposCriacao = await getEstoque(PRODUTO);
        log('PASSO 2.1 - ESTOQUE APOS CRIACAO (orcamento)', {
            antes: estoqueInicial.atual,
            depois: estoqueAposCriacao.atual,
            mudou: estoqueAposCriacao.atual !== estoqueInicial.atual ? 'SIM' : 'NAO (correto)'
        });

        // ==================================================================
        // PASSO 3: Mover para analise-credito
        // ==================================================================
        log('PASSO 3 - STATUS -> ANALISE-CREDITO');
        const resp2 = await apiCall('PUT', '/pedidos/' + pedidoId + '/status', { status: 'analise-credito' });
        console.log('>> Resposta: ' + resp2.status + ' - ' + (resp2.data.message || ''));

        const estoqueAposAnalise = await getEstoque(PRODUTO);
        log('PASSO 3.1 - ESTOQUE APOS ANALISE-CREDITO', {
            antes: estoqueAposCriacao.atual,
            depois: estoqueAposAnalise.atual,
            mudou: estoqueAposAnalise.atual !== estoqueAposCriacao.atual ? 'SIM' : 'NAO'
        });

        // ==================================================================
        // PASSO 4: Mover para pedido-aprovado (AQUI o estoque DEVE BAIXAR)
        // A rota vendas-routes.js faz baixarEstoqueAutomatico neste status
        // ==================================================================
        log('PASSO 4 - STATUS -> PEDIDO-APROVADO (deve baixar estoque)');
        const resp3 = await apiCall('PUT', '/pedidos/' + pedidoId + '/status', { status: 'pedido-aprovado', forceTransition: true });
        console.log('>> Resposta: ' + resp3.status + ' - ' + (resp3.data.message || ''));
        if (resp3.data.estoque_baixado) console.log('>> Estoque baixado automaticamente!');
        if (resp3.data.movimentacoes_estoque) console.log('>> Movimentacoes: ' + JSON.stringify(resp3.data.movimentacoes_estoque));

        const estoqueAposAprovado = await getEstoque(PRODUTO);
        log('PASSO 4.1 - ESTOQUE APOS PEDIDO-APROVADO', {
            antes: estoqueAposAnalise.atual,
            depois: estoqueAposAprovado.atual,
            diferenca: estoqueAposAnalise.atual - estoqueAposAprovado.atual,
            baixou: estoqueAposAprovado.atual < estoqueAposAnalise.atual ? 'SIM - Baixa de ' + (estoqueAposAnalise.atual - estoqueAposAprovado.atual) : 'NAO'
        });

        // Verificar movimentacoes de saida registradas
        var movs = await query(
            "SELECT id, codigo_material, tipo_movimento, origem, quantidade, documento_tipo FROM estoque_movimentacoes WHERE documento_id = ? ORDER BY id DESC LIMIT 5",
            [pedidoId]
        );
        log('PASSO 4.2 - MOVIMENTACOES REGISTRADAS', movs);

        // ==================================================================
        // PASSO 5: CANCELAR PEDIDO (deve retornar estoque!)
        // ==================================================================
        log('PASSO 5 - CANCELANDO PEDIDO #' + pedidoId + ' (a partir de pedido-aprovado)');
        const respCancel = await apiCall('PUT', '/pedidos/' + pedidoId + '/status', { status: 'cancelado', forceTransition: true });
        log('PASSO 5.1 - RESPOSTA DA API', respCancel.data);

        const estoqueAposCancel = await getEstoque(PRODUTO);
        log('PASSO 5.2 - ESTOQUE APOS CANCELAMENTO', {
            estoque_inicial: estoqueInicial.atual,
            estoque_apos_aprovado: estoqueAposAprovado.atual,
            estoque_atual_apos_cancel: estoqueAposCancel.atual,
            estoque_cancelado: estoqueAposCancel.cancelado,
            cancelado_aumentou: estoqueAposCancel.cancelado > estoqueAposAprovado.cancelado,
            nao_somou_no_geral: estoqueAposCancel.atual === estoqueAposAprovado.atual
        });

        // Verificar movimentacoes de estorno
        var movsEstorno = await query(
            "SELECT id, codigo_material, tipo_movimento, origem, quantidade, documento_tipo FROM estoque_movimentacoes WHERE documento_id = ? AND tipo_movimento = 'entrada' ORDER BY id DESC LIMIT 5",
            [pedidoId]
        );
        log('PASSO 5.3 - MOVIMENTACOES DE ESTORNO', movsEstorno);

        // ==================================================================
        // RESUMO FINAL
        // ==================================================================
        const T1 = estoqueAposCriacao.atual === estoqueInicial.atual;
        const T2 = estoqueAposAprovado.atual < estoqueInicial.atual;
        const T3 = estoqueAposCancel.cancelado > 0;  // Cancelado deve ter valor
        const T4 = estoqueAposCancel.atual === estoqueAposAprovado.atual; // NAO voltou ao estoque_atual
        const T5 = movsEstorno.length > 0;

        console.log('\n');
        console.log('+' + '-'.repeat(62) + '+');
        console.log('|        RESUMO FINAL DO TESTE DE ESTOQUE CANCELADO              |');
        console.log('+' + '-'.repeat(62) + '+');
        console.log('| Produto:    ' + PRODUTO + '                                            |');
        console.log('| Pedido #:   ' + String(pedidoId).padEnd(49) + '|');
        console.log('| Vendedor:   Ronaldo Torres (id:54)                           |');
        console.log('| Qtd teste:  ' + String(QTD_TESTE).padEnd(49) + '|');
        console.log('+' + '-'.repeat(62) + '+');
        console.log('| Estoque inicial:          ' + String(estoqueInicial.atual).padEnd(36) + '|');
        console.log('| Apos criacao (orcamento):  ' + String(estoqueAposCriacao.atual).padEnd(35) + '|');
        console.log('| Apos pedido-aprovado:      ' + String(estoqueAposAprovado.atual).padEnd(34) + '|');
        console.log('| Apos cancel - atual:       ' + String(estoqueAposCancel.atual).padEnd(34) + '|');
        console.log('| Apos cancel - cancelado:   ' + String(estoqueAposCancel.cancelado).padEnd(34) + '|');
        console.log('+' + '-'.repeat(62) + '+');
        console.log('| [' + (T1 ? 'PASS' : 'FAIL') + '] Criacao NAO altera estoque             ' + (T1 ? 'OK' : 'FALHOU') + '     |');
        console.log('| [' + (T2 ? 'PASS' : 'FAIL') + '] Aprovacao BAIXA estoque_atual          ' + (T2 ? 'OK' : 'FALHOU') + '     |');
        console.log('| [' + (T3 ? 'PASS' : 'FAIL') + '] Cancelamento vai p/ estoque_cancelado  ' + (T3 ? 'OK' : 'FALHOU') + '     |');
        console.log('| [' + (T4 ? 'PASS' : 'FAIL') + '] NAO soma no estoque geral (atual)     ' + (T4 ? 'OK' : 'FALHOU') + '     |');
        console.log('| [' + (T5 ? 'PASS' : 'FAIL') + '] Movimentacao de estorno registrada     ' + (T5 ? 'OK' : 'FALHOU') + '     |');
        console.log('+' + '-'.repeat(62) + '+');

        var allPassed = T1 && T2 && T3 && T4 && T5;
        console.log('| RESULTADO: ' + (allPassed ? 'TODOS OS TESTES PASSARAM!' : 'ALGUM TESTE FALHOU!') + '                        |');
        console.log('+' + '-'.repeat(58) + '+');

        // ==================================================================
        // LIMPEZA
        // ==================================================================
        console.log('\n>> Limpando dados de teste...');
        await query("DELETE FROM estoque_movimentacoes WHERE documento_id = ? AND documento_tipo IN ('pedido','pedido_cancelado')", [pedidoId]);
        await query('DELETE FROM pedido_itens WHERE pedido_id = ?', [pedidoId]);
        await query('DELETE FROM pedidos WHERE id = ?', [pedidoId]);
        // Restaurar estoque original
        await query('UPDATE produtos SET estoque_atual = ?, estoque_cancelado = ? WHERE codigo = ?', [estoqueInicial.atual, estoqueInicial.cancelado, PRODUTO]);
        console.log('>> Estoque restaurado para ' + estoqueInicial.atual + ' (cancelado: ' + estoqueInicial.cancelado + ')');
        console.log('>> Pedido #' + pedidoId + ' removido');
        console.log('>> Limpeza concluida!\n');

        await conn.end();
        process.exit(allPassed ? 0 : 1);
    } catch (err) {
        console.error('\nERRO FATAL:', err.message);
        console.error(err.stack);
        if (conn) await conn.end();
        process.exit(1);
    }
})();
