/**
 * LOGISTICA ROUTES - Extracted from server.js (Lines 2565-2812)
 * @module routes/logistica-routes
 */
const express = require('express');

module.exports = function createLogisticaRoutes(deps) {
    const { pool, authenticateToken, authorizeArea } = deps;
    const router = express.Router();
    const FinanceiroReactiveService = require('../services/financeiro-reactive.service');
    const financeiroReactive = new FinanceiroReactiveService(pool);
    router.use(authenticateToken);
    // Logística é sub-módulo de NFe — usa mesma permissão para acesso
    router.use(authorizeArea('nfe'));
    // ===================== ROTAS LOGÍSTICA =====================
    
    // Dashboard da Logística - Contadores por status
    router.get('/dashboard', async (req, res, next) => {
        try {
            // Sprint E2E-S2 (E4-HIGH-06): Separar pendente de aguardando_separacao no dashboard
            // HOTFIX Pipeline E2E: Incluir status 'entregue' para que pedidos entregues não sumam do dashboard
            // (quando status_logistica='entregue', o status principal muda para 'entregue')
            // BUG-024: incluir 'aguardando' no filtro para alinhar com listagem
            const [[aguardando]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo', 'entregue')
                AND (status_logistica IS NULL OR status_logistica IN ('pendente', 'aguardando', ''))
            `);

            const [[aguardandoSep]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo', 'entregue') AND status_logistica = 'aguardando_separacao'
            `);
    
            const [[separacao]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo', 'entregue') AND status_logistica = 'em_separacao'
            `);
    
            const [[expedicao]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo', 'entregue') AND status_logistica = 'em_expedicao'
            `);
    
            const [[transporte]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo', 'entregue') AND status_logistica = 'em_transporte'
            `);
    
            const [[entregues]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo', 'entregue') AND status_logistica = 'entregue'
            `);
    
            const result = {
                pendente: aguardando?.total || 0,
                aguardando_separacao: aguardandoSep?.total || 0,
                em_separacao: separacao?.total || 0,
                em_expedicao: expedicao?.total || 0,
                em_transporte: transporte?.total || 0,
                entregues: entregues?.total || 0
            };
            res.json(result);
        } catch (error) {
            console.error('[LOGISTICA/DASHBOARD] Erro:', error);
            res.json({
                pendente: 0,
                aguardando_separacao: 0,
                em_separacao: 0,
                em_expedicao: 0,
                em_transporte: 0,
                entregues: 0
            });
        }
    });
    
    // Listar pedidos em logística (sem autenticação)
    router.get('/pedidos', async (req, res, next) => {
        try {
            const { status, transportadora, nfe, data_inicio, data_fim, limit = 100 } = req.query;
    
            let query = `
                SELECT
                    p.id,
                    p.id as pedido_id,
                    p.valor,
                    p.descricao,
                    p.status,
                    p.status_logistica,
                    p.prioridade,
                    p.created_at,
                    p.faturado_em,
                    p.data_prevista,
                    p.prazo_entrega,
                    p.observacao,
                    p.frete,
                    p.nf,
                    p.numero_nf,
                    p.nfe_id,
                    nfe_tab.numero as nfe_numero_real,
                    p.transportadora_id,
                    p.endereco_entrega,
                    c.nome as cliente_nome,
                    c.nome_fantasia as cliente_fantasia,
                    c.cidade as cliente_cidade,
                    c.estado as cliente_uf,
                    c.endereco as cliente_endereco,
                    p.cliente_nome as pedido_cliente_nome,
                    e.nome_fantasia as empresa_nome,
                    e.razao_social as empresa_razao,
                    t.nome_fantasia as transportadora_nome,
                    t.razao_social as transportadora_razao
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                LEFT JOIN nfes nfe_tab ON nfe_tab.id = p.nfe_id
                WHERE p.status IN ('faturado', 'recibo', 'entregue')
            `;
    
            const params = [];
    
            // Sprint E2E-S2 (E4-HIGH-06): Tratar filtros separadamente
            if (status && status !== '' && status !== 'todos') {
                if (status === 'pendente') {
                    query += ' AND (p.status_logistica IS NULL OR p.status_logistica = "pendente" OR p.status_logistica = "")';
                } else {
                    query += ' AND p.status_logistica = ?';
                    params.push(status);
                }
            }
    
            if (nfe && nfe !== '') {
                query += ' AND p.id = ?';
                params.push(nfe);
            }
    
            if (data_inicio) {
                query += ' AND DATE(p.created_at) >= ?';
                params.push(data_inicio);
            }
    
            if (data_fim) {
                query += ' AND DATE(p.created_at) <= ?';
                params.push(data_fim);
            }
    
            query += ' ORDER BY p.prioridade DESC, p.created_at DESC LIMIT ?';
            params.push(parseInt(limit));
    
            const [rows] = await pool.query(query, params);
    
            // Formatar dados para o frontend
            const pedidos = rows.map(row => ({
                id: row.id,
                pedido_id: row.pedido_id,
                nfe_numero: row.nfe_numero_real || row.nf || row.numero_nf || '-',
                cliente: row.cliente_fantasia || row.cliente_nome || row.pedido_cliente_nome || row.empresa_nome || row.empresa_razao || 'Cliente não informado',
                // Sprint 3 (F-05 fix): Priorizar endereco_entrega do pedido sobre endereço cadastral
                endereco_entrega: row.endereco_entrega || null,
                cidade_uf: row.cliente_cidade && row.cliente_uf ? `${row.cliente_cidade}/${row.cliente_uf}` : '-',
                transportadora: row.transportadora_nome || row.transportadora_razao || 'Não definida',
                transportadora_id: row.transportadora_id || null,
                status: row.status_logistica || 'pendente',
                previsao: row.data_prevista || row.prazo_entrega || '-',
                prioridade: row.prioridade || 'normal',
                valor: row.valor,
                frete: row.frete || null,
                descricao: row.descricao || null,
                data_pedido: row.created_at || null,
                data_faturamento: row.faturado_em || null,
                observacao: row.observacao
            }));
    
            res.json(pedidos);
        } catch (error) {
            console.error('[LOGISTICA/PEDIDOS] Erro:', error);
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.', pedidos: [] });
        }
    });
    
    // Atualizar status de logística de um pedido
    router.put('/pedidos/:id/status', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status_logistica, observacao } = req.body;
    
            const validStatuses = ['pendente', 'aguardando_separacao', 'em_separacao', 'em_expedicao', 'em_transporte', 'entregue'];

            if (!validStatuses.includes(status_logistica)) {
                return res.status(400).json({
                    message: 'Status inválido',
                    valid: validStatuses
                });
            }

            // LOG-01: buscar pedido para verificar transportadora antes de avançar
            const [pedCheck] = await pool.query(
                'SELECT id, transportadora_id FROM pedidos WHERE id = ?', [id]
            );
            if (!pedCheck.length) {
                return res.status(404).json({ error: 'Pedido não encontrado.' });
            }
            const statusQueExigemTransportadora = ['em_expedicao', 'em_transporte', 'entregue'];
            if (statusQueExigemTransportadora.includes(status_logistica) && !pedCheck[0].transportadora_id) {
                return res.status(400).json({
                    error: 'Transportadora obrigatória',
                    message: `Não é possível avançar para "${status_logistica}" sem definir a transportadora.`
                });
            }

            await pool.query(
                'UPDATE pedidos SET status_logistica = ?, observacao = CONCAT(COALESCE(observacao, ""), ?) WHERE id = ?',
                [status_logistica, observacao ? `\n[LOG] ${new Date().toLocaleString('pt-BR')}: ${observacao}` : '', id]
            );
    
            // Se status for 'entregue', atualizar também o status principal
            if (status_logistica === 'entregue') {
                await pool.query('UPDATE pedidos SET status = "entregue" WHERE id = ?', [id]);
                // INTEGRAÇÃO REATIVA: notificar financeiro da entrega
                try {
                    await financeiroReactive.onPedidoEntregue(id, req.user?.email || 'logistica');
                } catch (intErr) {
                    console.error('[LOGISTICA→FINANCEIRO] Erro ao notificar entrega:', intErr.message);
                }
            }
    
            res.json({ message: 'Status atualizado com sucesso', status: status_logistica });
        } catch (error) {
            console.error('[LOGISTICA/STATUS] Erro:', error);
            next(error);
        }
    });
    
    // Atribuir transportadora a um pedido
    router.put('/pedidos/:id/transportadora', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { transportadora_id, previsao_entrega } = req.body;
    
            await pool.query(
                'UPDATE pedidos SET transportadora_id = ?, data_prevista = ? WHERE id = ?',
                [transportadora_id, previsao_entrega, id]
            );
    
            res.json({ message: 'Transportadora atribuída com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORA] Erro:', error);
            next(error);
        }
    });
    
    // Listar transportadoras disponíveis
    router.get('/transportadoras', async (req, res, next) => {
        try {
            let _dec = (v) => v;
            try {
                const lgpdCrypto = require('../lgpd-crypto');
                if (lgpdCrypto && lgpdCrypto.decryptPII) {
                    _dec = lgpdCrypto.decryptPII;
                }
            } catch(e) { /* LGPD crypto não disponível, retorna dados sem decrypt */ }
            const [rows] = await pool.query(`
                SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, telefone, email,
                       cidade, estado, endereco, cep, contato,
                       api_rastreamento_url, api_rastreamento_token, codigo_integracao
                FROM transportadoras
                ORDER BY nome_fantasia, razao_social
            `);
            const resultado = rows.map(r => ({
                ...r,
                cnpj_cpf: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || '')
            }));
            res.json(resultado);
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS] Erro:', error);
            res.json([]);
        }
    });

    // Cadastrar nova transportadora
    router.post('/transportadoras', async (req, res, next) => {
        try {
            const { razao_social, fantasia, cnpj, telefone, email, endereco, cidade, estado, cep, contato } = req.body;

            if (!razao_social || razao_social.trim() === '') {
                return res.status(400).json({ error: 'Razão Social é obrigatória' });
            }

            let _enc = (v) => v;
            try {
                const lgpdCrypto = require('../lgpd-crypto');
                if (lgpdCrypto && lgpdCrypto.encryptPII) {
                    _enc = lgpdCrypto.encryptPII;
                }
            } catch(e) { /* LGPD crypto não disponível */ }

            const [result] = await pool.query(`
                INSERT INTO transportadoras (razao_social, nome_fantasia, cnpj_cpf, telefone, email, endereco, cidade, estado, cep, contato)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                razao_social.trim(),
                (fantasia || '').trim(),
                _enc((cnpj || '').trim()),
                (telefone || '').trim(),
                (email || '').trim(),
                (endereco || '').trim(),
                (cidade || '').trim(),
                (estado || '').trim(),
                (cep || '').trim(),
                (contato || '').trim()
            ]);

            res.json({ success: true, message: 'Transportadora cadastrada com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS/POST] Erro:', error);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Transportadora com este CNPJ já existe' });
            }
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Atualizar transportadora
    router.put('/transportadoras/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { razao_social, fantasia, cnpj, telefone, email, endereco, cidade, estado, cep, contato } = req.body;

            if (!razao_social || razao_social.trim() === '') {
                return res.status(400).json({ error: 'Razão Social é obrigatória' });
            }

            const [existing] = await pool.query('SELECT id FROM transportadoras WHERE id = ?', [id]);
            if (!existing.length) return res.status(404).json({ error: 'Transportadora não encontrada' });

            await pool.query(`
                UPDATE transportadoras SET
                    razao_social = ?, nome_fantasia = ?, cnpj_cpf = ?,
                    telefone = ?, email = ?, endereco = ?,
                    cidade = ?, estado = ?, cep = ?, contato = ?
                WHERE id = ?
            `, [
                razao_social.trim(), (fantasia || '').trim(), (cnpj || '').trim(),
                (telefone || '').trim(), (email || '').trim(), (endereco || '').trim(),
                (cidade || '').trim(), (estado || '').trim(), (cep || '').trim(),
                (contato || '').trim(), id
            ]);

            res.json({ success: true, message: 'Transportadora atualizada com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS/PUT] Erro:', error);
            next(error);
        }
    });

    // Excluir transportadora
    router.delete('/transportadoras/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [existing] = await pool.query('SELECT id FROM transportadoras WHERE id = ?', [id]);
            if (!existing.length) return res.status(404).json({ error: 'Transportadora não encontrada' });

            // Desvincular pedidos antes de excluir
            await pool.query('UPDATE pedidos SET transportadora_id = NULL WHERE transportadora_id = ?', [id]);
            await pool.query('DELETE FROM transportadoras WHERE id = ?', [id]);

            res.json({ success: true, message: 'Transportadora excluída com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS/DELETE] Erro:', error);
            next(error);
        }
    });

    // ===================== EXPEDIÇÃO =====================

    // Criar nova expedição (manual)
    router.post('/expedicao', async (req, res, next) => {
        try {
            const { nfe, pedido_id, pedido: pedidoBody, cliente, transportadora_id, status, previsao, prioridade, observacoes } = req.body;
            const pedido = pedido_id || pedidoBody;

            // Se for baseado em um pedido existente, atualizar
            if (pedido) {
                // LOG-02: buscar dados do pedido + cliente para auto-popular endereço e prazo
                const [pedRows] = await pool.query(`
                    SELECT p.id, p.endereco_entrega, p.data_prevista, p.prazo_entrega,
                           c.endereco as cli_endereco, c.cidade as cli_cidade, c.estado as cli_uf
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.id = ? AND p.empresa_id = ?
                `, [pedido, req.user.empresa_id]);
                if (!pedRows.length) {
                    return res.status(404).json({ error: 'Pedido não encontrado.' });
                }
                const pedData = pedRows[0];

                // Validar FK — transportadora deve existir
                if (transportadora_id) {
                    const [transp] = await pool.query('SELECT id FROM transportadoras WHERE id = ? AND (status IS NULL OR status != "inativa")', [transportadora_id]);
                    if (!transp.length) {
                        return res.status(400).json({ error: 'Transportadora não encontrada ou inativa.' });
                    }
                }

                // LOG-01: Aviso ao criar expedição sem transportadora
                const aviso = (!transportadora_id)
                    ? 'Expedição criada sem transportadora definida — atribua uma antes de avançar para em_expedicao.'
                    : null;

                // LOG-02: usar previsão e endereço do pedido como fallback
                const previsaoFinal = previsao || pedData.data_prevista || pedData.prazo_entrega || null;
                const enderecoFinal = pedData.endereco_entrega
                    || (pedData.cli_endereco
                        ? `${pedData.cli_endereco}${pedData.cli_cidade ? ', ' + pedData.cli_cidade : ''}${pedData.cli_uf ? '/' + pedData.cli_uf : ''}`
                        : null);

                await pool.query(`
                    UPDATE pedidos SET
                        status_logistica = ?,
                        transportadora_id = ?,
                        data_prevista = COALESCE(?, data_prevista),
                        endereco_entrega = COALESCE(endereco_entrega, ?),
                        prioridade = ?,
                        observacao = CONCAT(COALESCE(observacao, ''), ?)
                    WHERE id = ? AND empresa_id = ?
                `, [status || 'pendente', transportadora_id, previsaoFinal, enderecoFinal, prioridade, observacoes ? `\n[EXP] ${observacoes}` : '', pedido, req.user.empresa_id]);

                const responseBody = { success: true, message: 'Expedição criada com sucesso', pedido_id: pedido };
                if (aviso) responseBody.aviso = aviso;
                return res.json(responseBody);
            }

            // LOG001: Criar expedição standalone (sem pedido ou NF-e vinculados)
            try {
                const [expResult] = await pool.query(
                    `INSERT INTO expedicoes (cliente, transportadora_id, status, previsao, prioridade, observacoes, empresa_id, criado_por)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [cliente || null, transportadora_id || null, status || 'pendente', previsao || null,
                     prioridade || 'normal', observacoes || null, req.user.empresa_id, req.user.id]
                );
                return res.json({ success: true, message: 'Expedição criada com sucesso', id: expResult.insertId });
            } catch (expErr) {
                console.error('[LOGISTICA/EXPEDICAO] Erro ao criar expedição standalone:', expErr.message);
                return res.status(400).json({ success: false, message: 'Pedido ou NF-e é obrigatório para criar expedição' });
            }
        } catch (error) {
            console.error('[LOGISTICA/EXPEDICAO] Erro:', error);
            next(error);
        }
    });

    // ===================== COTAÇÃO DE FRETE =====================

    // Cotar frete com base nas tabelas de preço das transportadoras
    router.post('/cotacao-frete', async (req, res) => {
        try {
            const { uf_destino, cidade_destino, cep_destino, peso, valor_nf, cubagem, transportadora_id } = req.body;

            if (!uf_destino) {
                return res.status(400).json({ error: 'UF de destino é obrigatória' });
            }

            // Buscar tabelas de frete ativas (filtrar por transportadora se informada)
            let tabelaQuery = `
                SELECT ft.*, t.nome_fantasia as transportadora_nome, t.razao_social as transportadora_razao
                FROM frete_tabelas ft
                JOIN transportadoras t ON ft.transportadora_id = t.id
                WHERE ft.ativa = TRUE
                AND (ft.vigencia_inicio <= CURDATE())
                AND (ft.vigencia_fim IS NULL OR ft.vigencia_fim >= CURDATE())
            `;
            const tabelaParams = [];

            if (transportadora_id) {
                tabelaQuery += ' AND ft.transportadora_id = ?';
                tabelaParams.push(transportadora_id);
            }

            tabelaQuery += ' ORDER BY ft.padrao DESC, ft.nome';

            const [tabelas] = await pool.query(tabelaQuery, tabelaParams);

            if (!tabelas.length) {
                return res.json({
                    success: true,
                    cotacoes: [],
                    mensagem: 'Nenhuma tabela de frete ativa encontrada. Cadastre tabelas de preço nas transportadoras.'
                });
            }

            const cotacoes = [];

            for (const tabela of tabelas) {
                // Buscar faixas que atendem ao destino
                let faixaQuery = `
                    SELECT * FROM frete_faixas
                    WHERE tabela_id = ?
                    AND uf_destino = ?
                `;
                const faixaParams = [tabela.id, uf_destino];

                // Filtro por cidade (se specified na faixa)
                if (cidade_destino) {
                    faixaQuery += ' AND (cidade_destino IS NULL OR cidade_destino = "" OR cidade_destino = ?)';
                    faixaParams.push(cidade_destino);
                }

                // Filtro por CEP
                if (cep_destino) {
                    const cepLimpo = cep_destino.replace(/\D/g, '');
                    faixaQuery += ' AND (cep_destino_inicio IS NULL OR cep_destino_inicio = "" OR ? BETWEEN REPLACE(cep_destino_inicio, "-", "") AND REPLACE(cep_destino_fim, "-", ""))';
                    faixaParams.push(cepLimpo);
                }

                faixaQuery += ' ORDER BY preco_frete ASC';

                const [faixas] = await pool.query(faixaQuery, faixaParams);

                for (const faixa of faixas) {
                    let aplicavel = true;
                    let freteFinal = Number(faixa.preco_frete) || 0;
                    let detalhes = [];

                    // Verificar faixa de peso
                    if (peso && tabela.tipo_calculo !== 'valor') {
                        const pesoNum = Number(peso);
                        if (faixa.peso_final && (pesoNum < Number(faixa.peso_inicial) || pesoNum > Number(faixa.peso_final))) {
                            aplicavel = false;
                        }
                        // Peso adicional
                        if (aplicavel && faixa.preco_por_kg_adicional && pesoNum > Number(faixa.peso_inicial)) {
                            const kgAdicional = pesoNum - Number(faixa.peso_inicial);
                            const adicional = kgAdicional * Number(faixa.preco_por_kg_adicional);
                            freteFinal += adicional;
                            detalhes.push(`+R$ ${adicional.toFixed(2)} (${kgAdicional.toFixed(1)}kg adicional)`);
                        }
                    }

                    // Verificar faixa de valor
                    if (valor_nf && tabela.tipo_calculo !== 'peso') {
                        const valorNum = Number(valor_nf);
                        if (faixa.valor_final && (valorNum < Number(faixa.valor_inicial) || valorNum > Number(faixa.valor_final))) {
                            aplicavel = false;
                        }
                    }

                    // Verificar faixa de cubagem
                    if (cubagem && tabela.tipo_calculo === 'cubagem') {
                        const cubNum = Number(cubagem);
                        if (faixa.cubagem_final && (cubNum < Number(faixa.cubagem_inicial) || cubNum > Number(faixa.cubagem_final))) {
                            aplicavel = false;
                        }
                    }

                    if (!aplicavel) continue;

                    // Adicionar ad valorem (% sobre valor)
                    if (tabela.percentual_ad_valorem && valor_nf) {
                        const adValorem = Number(valor_nf) * Number(tabela.percentual_ad_valorem) / 100;
                        freteFinal += adValorem;
                        detalhes.push(`+R$ ${adValorem.toFixed(2)} (ad valorem ${tabela.percentual_ad_valorem}%)`);
                    }

                    // Adicionar taxa de despacho
                    if (tabela.taxa_despacho) {
                        freteFinal += Number(tabela.taxa_despacho);
                        detalhes.push(`+R$ ${Number(tabela.taxa_despacho).toFixed(2)} (taxa despacho)`);
                    }

                    // Aplicar valor mínimo
                    if (tabela.valor_minimo && freteFinal < Number(tabela.valor_minimo)) {
                        freteFinal = Number(tabela.valor_minimo);
                        detalhes.push(`Valor mínimo aplicado: R$ ${Number(tabela.valor_minimo).toFixed(2)}`);
                    }

                    cotacoes.push({
                        transportadora_id: tabela.transportadora_id,
                        transportadora: tabela.transportadora_nome || tabela.transportadora_razao,
                        tabela_nome: tabela.nome,
                        tipo_calculo: tabela.tipo_calculo,
                        valor_frete: Math.round(freteFinal * 100) / 100,
                        prazo_dias: faixa.prazo_entrega_dias || 0,
                        prazo_horas: faixa.prazo_entrega_horas || 0,
                        detalhes: detalhes,
                        faixa_id: faixa.id
                    });
                }
            }

            // Ordenar por valor
            cotacoes.sort((a, b) => a.valor_frete - b.valor_frete);

            res.json({
                success: true,
                cotacoes: cotacoes,
                total_opcoes: cotacoes.length,
                parametros: { uf_destino, cidade_destino, cep_destino, peso, valor_nf, cubagem }
            });

        } catch (error) {
            console.error('[LOGISTICA/COTACAO-FRETE] Erro:', error);
            res.status(500).json({ error: 'Erro ao calcular cotação de frete' });
        }
    });

    // Listar tabelas de frete
    router.get('/frete/tabelas', async (req, res) => {
        try {
            const { transportadora_id, ativa } = req.query;
            let query = `
                SELECT ft.*, t.nome_fantasia as transportadora_nome, t.razao_social as transportadora_razao
                FROM frete_tabelas ft
                JOIN transportadoras t ON ft.transportadora_id = t.id
                WHERE 1=1
            `;
            const params = [];

            if (transportadora_id) {
                query += ' AND ft.transportadora_id = ?';
                params.push(transportadora_id);
            }
            if (ativa !== undefined) {
                query += ' AND ft.ativa = ?';
                params.push(ativa === 'true' || ativa === '1' ? 1 : 0);
            }

            query += ' ORDER BY ft.transportadora_id, ft.nome';
            const [tabelas] = await pool.query(query, params);
            res.json({ success: true, data: tabelas });
        } catch (error) {
            console.error('[LOGISTICA/FRETE/TABELAS] Erro:', error);
            res.status(500).json({ error: 'Erro ao listar tabelas de frete' });
        }
    });

    // Criar tabela de frete
    router.post('/frete/tabelas', async (req, res) => {
        try {
            const { transportadora_id, nome, descricao, tipo_calculo, valor_minimo, percentual_ad_valorem, taxa_despacho, vigencia_inicio, vigencia_fim, padrao } = req.body;

            if (!transportadora_id || !nome || !vigencia_inicio) {
                return res.status(400).json({ error: 'Transportadora, nome e data de vigência são obrigatórios' });
            }

            const [result] = await pool.query(`
                INSERT INTO frete_tabelas (transportadora_id, nome, descricao, tipo_calculo, valor_minimo, percentual_ad_valorem, taxa_despacho, vigencia_inicio, vigencia_fim, padrao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [transportadora_id, nome, descricao, tipo_calculo || 'peso', valor_minimo || 0, percentual_ad_valorem || 0, taxa_despacho || 0, vigencia_inicio, vigencia_fim || null, padrao || false]);

            res.json({ success: true, id: result.insertId, message: 'Tabela de frete criada com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/FRETE/TABELAS/POST] Erro:', error);
            res.status(500).json({ error: 'Erro ao criar tabela de frete' });
        }
    });

    // Listar faixas de uma tabela de frete
    router.get('/frete/tabelas/:id/faixas', async (req, res) => {
        try {
            const [faixas] = await pool.query('SELECT * FROM frete_faixas WHERE tabela_id = ? ORDER BY uf_destino, peso_inicial, valor_inicial', [req.params.id]);
            res.json({ success: true, data: faixas });
        } catch (error) {
            console.error('[LOGISTICA/FRETE/FAIXAS] Erro:', error);
            res.status(500).json({ error: 'Erro ao listar faixas de frete' });
        }
    });

    // Criar faixa de frete
    router.post('/frete/tabelas/:id/faixas', async (req, res) => {
        try {
            const tabela_id = req.params.id;
            const { uf_origem, cidade_origem, cep_origem_inicio, cep_origem_fim, uf_destino, cidade_destino, cep_destino_inicio, cep_destino_fim, peso_inicial, peso_final, valor_inicial, valor_final, cubagem_inicial, cubagem_final, preco_frete, preco_por_kg_adicional, prazo_entrega_dias, prazo_entrega_horas } = req.body;

            if (!uf_destino || preco_frete === undefined) {
                return res.status(400).json({ error: 'UF destino e preço do frete são obrigatórios' });
            }

            const [result] = await pool.query(`
                INSERT INTO frete_faixas (tabela_id, uf_origem, cidade_origem, cep_origem_inicio, cep_origem_fim, uf_destino, cidade_destino, cep_destino_inicio, cep_destino_fim, peso_inicial, peso_final, valor_inicial, valor_final, cubagem_inicial, cubagem_final, preco_frete, preco_por_kg_adicional, prazo_entrega_dias, prazo_entrega_horas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [tabela_id, uf_origem || null, cidade_origem || null, cep_origem_inicio || null, cep_origem_fim || null, uf_destino, cidade_destino || null, cep_destino_inicio || null, cep_destino_fim || null, peso_inicial || 0, peso_final || null, valor_inicial || 0, valor_final || null, cubagem_inicial || 0, cubagem_final || null, preco_frete, preco_por_kg_adicional || 0, prazo_entrega_dias || 0, prazo_entrega_horas || 0]);

            res.json({ success: true, id: result.insertId, message: 'Faixa de frete criada com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/FRETE/FAIXAS/POST] Erro:', error);
            res.status(500).json({ error: 'Erro ao criar faixa de frete' });
        }
    });

    // Rastreamento - buscar eventos de um pedido (com coordenadas geográficas)
    router.get('/pedidos/:id/rastreamento', async (req, res) => {
        try {
            const { id } = req.params;

            // Tentar buscar da tabela rastreamentos (via volumes)
            let eventos = [];
            try {
                const [rows] = await pool.query(`
                    SELECT r.*, v.codigo_rastreio, v.nfe_id,
                           t.nome_fantasia as transportadora_nome
                    FROM rastreamentos r
                    LEFT JOIN volumes v ON r.volume_id = v.id
                    LEFT JOIN transportadoras t ON r.transportadora_id = t.id
                    WHERE v.pedido_venda_id = ? OR v.nfe_id IN (
                        SELECT n.id FROM nfes n
                        JOIN pedidos p ON p.id = n.pedido_venda_id
                        WHERE p.id = ?
                    )
                    ORDER BY r.data_ocorrencia DESC
                `, [id, id]);
                eventos = rows.map(r => ({
                    id: r.id,
                    pedido_id: id,
                    data_evento: r.data_ocorrencia,
                    descricao: r.descricao_ocorrencia,
                    detalhes: r.descricao_detalhada,
                    status: r.codigo_ocorrencia,
                    cidade: r.cidade,
                    uf: r.uf,
                    unidade: r.unidade_rastreio,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    recebedor: r.recebedor_nome,
                    recebedor_doc: r.recebedor_documento,
                    foto_url: r.foto_url,
                    transportadora: r.transportadora_nome,
                    codigo_rastreio: r.codigo_rastreio
                }));
            } catch (e) {
                // Tabela pode não existir ainda
            }

            // Se não houver rastreamentos dedicados, gerar a partir do histórico do pedido
            if (!eventos.length) {
                const [[pedido]] = await pool.query(`
                    SELECT p.*, c.nome as cliente_nome, c.cidade as cliente_cidade, c.estado as cliente_uf
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.id = ?
                `, [id]);

                if (!pedido) {
                    return res.status(404).json({ error: 'Pedido não encontrado' });
                }

                const statusMap = {
                    'pendente': { desc: 'Pedido aguardando processamento', icon: 'clock' },
                    'aguardando_separacao': { desc: 'Aguardando separação no estoque', icon: 'boxes' },
                    'em_separacao': { desc: 'Mercadoria sendo separada', icon: 'dolly' },
                    'em_expedicao': { desc: 'Em expedição, preparando envio', icon: 'box-open' },
                    'em_transporte': { desc: 'Mercadoria em trânsito', icon: 'truck' },
                    'entregue': { desc: 'Entregue ao destinatário', icon: 'check-circle' }
                };

                const statusAtual = pedido.status_logistica || 'pendente';
                const info = statusMap[statusAtual] || statusMap['pendente'];

                eventos = [{
                    id: 0,
                    pedido_id: id,
                    data_evento: pedido.updated_at || pedido.created_at,
                    descricao: info.desc,
                    status: statusAtual,
                    cidade: pedido.cliente_cidade,
                    uf: pedido.cliente_uf,
                    latitude: null,
                    longitude: null
                }];
            }

            res.json({
                success: true,
                pedido_id: id,
                eventos: eventos
            });
        } catch (error) {
            console.error('[LOGISTICA/RASTREAMENTO] Erro:', error);
            res.status(500).json({ error: 'Erro ao buscar rastreamento' });
        }
    });

    // Adicionar evento de rastreamento manualmente
    router.post('/pedidos/:id/rastreamento', async (req, res) => {
        try {
            const { id } = req.params;
            const { descricao, cidade, uf, latitude, longitude, unidade_rastreio } = req.body;

            if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });

            // Buscar ou criar volume vinculado ao pedido
            let volumeId;
            const [volumes] = await pool.query(
                'SELECT id FROM volumes WHERE pedido_venda_id = ? LIMIT 1', [id]
            );
            if (volumes.length) {
                volumeId = volumes[0].id;
            } else {
                const [vResult] = await pool.query(
                    'INSERT INTO volumes (pedido_venda_id, numero_volume, quantidade, especie) VALUES (?, 1, 1, ?)',
                    [id, 'CAIXA']
                );
                volumeId = vResult.insertId;
            }

            // Buscar transportadora do pedido
            const [[pedido]] = await pool.query('SELECT transportadora_id FROM pedidos WHERE id = ?', [id]);

            await pool.query(`
                INSERT INTO rastreamentos (volume_id, transportadora_id, data_ocorrencia, descricao_ocorrencia, cidade, uf, latitude, longitude, unidade_rastreio)
                VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?)
            `, [volumeId, pedido?.transportadora_id || null, descricao, cidade || null, uf || null, latitude || null, longitude || null, unidade_rastreio || null]);

            res.json({ success: true, message: 'Evento de rastreamento registrado' });
        } catch (error) {
            console.error('[LOGISTICA/RASTREAMENTO/POST] Erro:', error);
            res.status(500).json({ error: 'Erro ao registrar rastreamento' });
        }
    });

    // ===================== INTEGRAÇÃO API TRANSPORTADORAS =====================

    // Consultar rastreamento via API da transportadora
    router.post('/rastreamento/consultar-api', async (req, res) => {
        try {
            const { pedido_id, codigo_rastreio } = req.body;

            if (!pedido_id && !codigo_rastreio) {
                return res.status(400).json({ error: 'Informe pedido_id ou código de rastreio' });
            }

            // Buscar dados do pedido e transportadora
            let transportadora, codigoRastreio = codigo_rastreio;
            if (pedido_id) {
                const [[pedido]] = await pool.query(`
                    SELECT p.transportadora_id, v.codigo_rastreio
                    FROM pedidos p
                    LEFT JOIN volumes v ON v.pedido_venda_id = p.id
                    WHERE p.id = ?
                `, [pedido_id]);

                if (!pedido || !pedido.transportadora_id) {
                    return res.status(400).json({ error: 'Pedido sem transportadora atribuída' });
                }
                if (!codigoRastreio) codigoRastreio = pedido.codigo_rastreio;

                const [[t]] = await pool.query(
                    'SELECT * FROM transportadoras WHERE id = ?', [pedido.transportadora_id]
                );
                transportadora = t;
            }

            if (!transportadora || !transportadora.api_rastreamento_url) {
                return res.json({
                    success: false,
                    mensagem: 'Transportadora sem API de rastreamento configurada. Configure a URL e Token na aba Transportadoras.',
                    eventos: []
                });
            }

            // Chamar API da transportadora
            const https = require('https');
            const http = require('http');
            const url = new URL(transportadora.api_rastreamento_url.replace('{codigo}', codigoRastreio || ''));
            const client = url.protocol === 'https:' ? https : http;

            const headers = { 'Accept': 'application/json' };
            if (transportadora.api_rastreamento_token) {
                headers['Authorization'] = `Bearer ${transportadora.api_rastreamento_token}`;
            }

            const apiResponse = await new Promise((resolve, reject) => {
                const request = client.get(url.toString(), { headers, timeout: 10000 }, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => {
                        try { resolve({ status: response.statusCode, data: JSON.parse(data) }); }
                        catch (e) { resolve({ status: response.statusCode, data: data }); }
                    });
                });
                request.on('error', reject);
                request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
            });

            res.json({
                success: true,
                transportadora: transportadora.nome_fantasia || transportadora.razao_social,
                codigo_rastreio: codigoRastreio,
                api_response: apiResponse.data,
                status_code: apiResponse.status
            });
        } catch (error) {
            console.error('[LOGISTICA/RASTREAMENTO/API] Erro:', error);
            res.status(500).json({ error: 'Erro ao consultar API da transportadora: ' + error.message });
        }
    });

    // Atualizar config de API da transportadora
    router.put('/transportadoras/:id/api-config', async (req, res) => {
        try {
            const { id } = req.params;
            const { api_rastreamento_url, api_rastreamento_token, codigo_integracao } = req.body;

            await pool.query(`
                UPDATE transportadoras SET
                    api_rastreamento_url = ?,
                    api_rastreamento_token = ?,
                    codigo_integracao = ?
                WHERE id = ?
            `, [api_rastreamento_url || null, api_rastreamento_token || null, codigo_integracao || null, id]);

            res.json({ success: true, message: 'Configuração da API atualizada' });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS/API-CONFIG] Erro:', error);
            res.status(500).json({ error: 'Erro ao atualizar configuração' });
        }
    });

    // ===================== CT-e (CONHECIMENTO DE TRANSPORTE) =====================

    // Listar CT-es
    router.get('/ctes', async (req, res) => {
        try {
            const { status, transportadora_id, data_inicio, data_fim, limit = 100 } = req.query;
            let query = `
                SELECT c.*, t.nome_fantasia as transportadora_nome, t.razao_social as transportadora_razao
                FROM ctes c
                LEFT JOIN transportadoras t ON c.transportadora_id = t.id
                WHERE 1=1
            `;
            const params = [];

            if (status) { query += ' AND c.status = ?'; params.push(status); }
            if (transportadora_id) { query += ' AND c.transportadora_id = ?'; params.push(transportadora_id); }
            if (data_inicio) { query += ' AND DATE(c.data_emissao) >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND DATE(c.data_emissao) <= ?'; params.push(data_fim); }

            query += ' ORDER BY c.data_emissao DESC LIMIT ?';
            params.push(parseInt(limit));

            const [rows] = await pool.query(query, params);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[LOGISTICA/CTES] Erro:', error);
            res.status(500).json({ error: 'Erro ao listar CT-es' });
        }
    });

    // Buscar CT-e por ID
    router.get('/ctes/:id', async (req, res) => {
        try {
            const [[cte]] = await pool.query(`
                SELECT c.*, t.nome_fantasia as transportadora_nome, t.razao_social as transportadora_razao
                FROM ctes c
                LEFT JOIN transportadoras t ON c.transportadora_id = t.id
                WHERE c.id = ?
            `, [req.params.id]);

            if (!cte) return res.status(404).json({ error: 'CT-e não encontrado' });
            res.json({ success: true, data: cte });
        } catch (error) {
            console.error('[LOGISTICA/CTES/:id] Erro:', error);
            res.status(500).json({ error: 'Erro ao buscar CT-e' });
        }
    });

    // Criar CT-e
    router.post('/ctes', async (req, res) => {
        try {
            const {
                transportadora_id, tipo_cte, tipo_servico, tomador_tipo, nfe_id,
                remetente_nome, remetente_cnpj_cpf, remetente_ie, remetente_endereco, remetente_municipio, remetente_uf,
                destinatario_nome, destinatario_cnpj_cpf, destinatario_ie, destinatario_endereco, destinatario_municipio, destinatario_uf,
                valor_carga, valor_frete, valor_receber, produto_predominante, peso_bruto, quantidade_volumes,
                municipio_origem, uf_origem, municipio_destino, uf_destino, modal, rntrc
            } = req.body;

            if (!transportadora_id || !valor_frete) {
                return res.status(400).json({ error: 'Transportadora e valor do frete são obrigatórios' });
            }

            // Gerar número sequencial
            const [[lastCte]] = await pool.query('SELECT MAX(numero) as ultimo FROM ctes WHERE serie = 1');
            const numero = (lastCte?.ultimo || 0) + 1;

            const [result] = await pool.query(`
                INSERT INTO ctes (numero, serie, transportadora_id, tipo_cte, tipo_servico, tomador_tipo, nfe_id,
                    remetente_nome, remetente_cnpj_cpf, remetente_ie, remetente_endereco, remetente_municipio, remetente_uf,
                    destinatario_nome, destinatario_cnpj_cpf, destinatario_ie, destinatario_endereco, destinatario_municipio, destinatario_uf,
                    data_emissao, valor_carga, valor_frete, valor_receber, produto_predominante, peso_bruto, quantidade_volumes,
                    municipio_origem, uf_origem, municipio_destino, uf_destino, modal, rntrc, status, usuario_id)
                VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'digitacao', ?)
            `, [
                numero, transportadora_id, tipo_cte || '0', tipo_servico || '0', tomador_tipo || '3', nfe_id || null,
                remetente_nome || null, remetente_cnpj_cpf || null, remetente_ie || null, remetente_endereco || null, remetente_municipio || null, remetente_uf || null,
                destinatario_nome || null, destinatario_cnpj_cpf || null, destinatario_ie || null, destinatario_endereco || null, destinatario_municipio || null, destinatario_uf || null,
                valor_carga || 0, valor_frete, valor_receber || valor_frete, produto_predominante || null, peso_bruto || 0, quantidade_volumes || 0,
                municipio_origem || null, uf_origem || null, municipio_destino || null, uf_destino || null, modal || '01', rntrc || null, req.user?.id || null
            ]);

            res.json({ success: true, id: result.insertId, numero, message: 'CT-e criado com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/CTES/POST] Erro:', error);
            res.status(500).json({ error: 'Erro ao criar CT-e' });
        }
    });

    // Atualizar CT-e
    router.put('/ctes/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const {
                transportadora_id, tipo_cte, tipo_servico, tomador_tipo, nfe_id,
                remetente_nome, remetente_cnpj_cpf, remetente_endereco, remetente_municipio, remetente_uf,
                destinatario_nome, destinatario_cnpj_cpf, destinatario_endereco, destinatario_municipio, destinatario_uf,
                valor_carga, valor_frete, valor_receber, produto_predominante, peso_bruto, quantidade_volumes,
                municipio_origem, uf_origem, municipio_destino, uf_destino
            } = req.body;

            const [[existing]] = await pool.query('SELECT id, status FROM ctes WHERE id = ?', [id]);
            if (!existing) return res.status(404).json({ error: 'CT-e não encontrado' });
            if (existing.status !== 'digitacao') return res.status(400).json({ error: 'Só é permitido editar CT-e em digitação' });

            await pool.query(`
                UPDATE ctes SET
                    transportadora_id = COALESCE(?, transportadora_id),
                    tipo_cte = COALESCE(?, tipo_cte), tipo_servico = COALESCE(?, tipo_servico),
                    tomador_tipo = COALESCE(?, tomador_tipo), nfe_id = ?,
                    remetente_nome = ?, remetente_cnpj_cpf = ?, remetente_endereco = ?, remetente_municipio = ?, remetente_uf = ?,
                    destinatario_nome = ?, destinatario_cnpj_cpf = ?, destinatario_endereco = ?, destinatario_municipio = ?, destinatario_uf = ?,
                    valor_carga = ?, valor_frete = ?, valor_receber = ?,
                    produto_predominante = ?, peso_bruto = ?, quantidade_volumes = ?,
                    municipio_origem = ?, uf_origem = ?, municipio_destino = ?, uf_destino = ?
                WHERE id = ?
            `, [
                transportadora_id, tipo_cte, tipo_servico, tomador_tipo, nfe_id || null,
                remetente_nome || null, remetente_cnpj_cpf || null, remetente_endereco || null, remetente_municipio || null, remetente_uf || null,
                destinatario_nome || null, destinatario_cnpj_cpf || null, destinatario_endereco || null, destinatario_municipio || null, destinatario_uf || null,
                valor_carga || 0, valor_frete || 0, valor_receber || 0,
                produto_predominante || null, peso_bruto || 0, quantidade_volumes || 0,
                municipio_origem || null, uf_origem || null, municipio_destino || null, uf_destino || null, id
            ]);

            res.json({ success: true, message: 'CT-e atualizado com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/CTES/PUT] Erro:', error);
            res.status(500).json({ error: 'Erro ao atualizar CT-e' });
        }
    });

    // Excluir CT-e
    router.delete('/ctes/:id', async (req, res) => {
        try {
            const [[existing]] = await pool.query('SELECT id, status FROM ctes WHERE id = ?', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'CT-e não encontrado' });
            if (existing.status !== 'digitacao') return res.status(400).json({ error: 'Só é permitido excluir CT-e em digitação' });

            await pool.query('DELETE FROM ctes WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'CT-e excluído com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/CTES/DELETE] Erro:', error);
            res.status(500).json({ error: 'Erro ao excluir CT-e' });
        }
    });

    // ===================== MDF-e (MANIFESTO DE DOCUMENTOS FISCAIS) =====================

    // Listar MDF-es
    router.get('/mdfes', async (req, res) => {
        try {
            const { status, transportadora_id, data_inicio, data_fim, limit = 100 } = req.query;
            let query = `
                SELECT m.*, t.nome_fantasia as transportadora_nome, t.razao_social as transportadora_razao,
                       (SELECT COUNT(*) FROM mdfe_documentos md WHERE md.mdfe_id = m.id) as total_documentos
                FROM mdfes m
                LEFT JOIN transportadoras t ON m.transportadora_id = t.id
                WHERE 1=1
            `;
            const params = [];

            if (status) { query += ' AND m.status = ?'; params.push(status); }
            if (transportadora_id) { query += ' AND m.transportadora_id = ?'; params.push(transportadora_id); }
            if (data_inicio) { query += ' AND DATE(m.data_emissao) >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND DATE(m.data_emissao) <= ?'; params.push(data_fim); }

            query += ' ORDER BY m.data_emissao DESC LIMIT ?';
            params.push(parseInt(limit));

            const [rows] = await pool.query(query, params);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[LOGISTICA/MDFES] Erro:', error);
            res.status(500).json({ error: 'Erro ao listar MDF-es' });
        }
    });

    // Buscar MDF-e por ID com documentos e percursos
    router.get('/mdfes/:id', async (req, res) => {
        try {
            const [[mdfe]] = await pool.query(`
                SELECT m.*, t.nome_fantasia as transportadora_nome, t.razao_social as transportadora_razao
                FROM mdfes m
                LEFT JOIN transportadoras t ON m.transportadora_id = t.id
                WHERE m.id = ?
            `, [req.params.id]);

            if (!mdfe) return res.status(404).json({ error: 'MDF-e não encontrado' });

            const [documentos] = await pool.query('SELECT * FROM mdfe_documentos WHERE mdfe_id = ? ORDER BY ordem', [req.params.id]);
            const [percursos] = await pool.query('SELECT * FROM mdfe_percursos WHERE mdfe_id = ? ORDER BY ordem', [req.params.id]);

            res.json({ success: true, data: { ...mdfe, documentos, percursos } });
        } catch (error) {
            console.error('[LOGISTICA/MDFES/:id] Erro:', error);
            res.status(500).json({ error: 'Erro ao buscar MDF-e' });
        }
    });

    // Criar MDF-e
    router.post('/mdfes', async (req, res) => {
        try {
            const {
                transportadora_id, uf_inicio, uf_fim, condutor_nome, condutor_cpf,
                veiculo_placa, veiculo_uf, veiculo_rntrc, veiculo_tipo_rodado, veiculo_tipo_carroceria,
                reboque_placa, reboque_uf, peso_bruto, valor_carga,
                documentos, percursos
            } = req.body;

            if (!transportadora_id || !uf_inicio || !uf_fim) {
                return res.status(400).json({ error: 'Transportadora, UF início e UF fim são obrigatórios' });
            }

            const [[lastMdfe]] = await pool.query('SELECT MAX(numero) as ultimo FROM mdfes WHERE serie = 1');
            const numero = (lastMdfe?.ultimo || 0) + 1;

            const [result] = await pool.query(`
                INSERT INTO mdfes (numero, serie, transportadora_id, uf_inicio, uf_fim, data_emissao,
                    condutor_nome, condutor_cpf, veiculo_placa, veiculo_uf, veiculo_rntrc,
                    veiculo_tipo_rodado, veiculo_tipo_carroceria, reboque_placa, reboque_uf,
                    peso_bruto, valor_carga, quantidade_ctes, quantidade_nfes, status, usuario_id)
                VALUES (?, 1, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'digitacao', ?)
            `, [
                numero, transportadora_id, uf_inicio, uf_fim,
                condutor_nome || null, condutor_cpf || null,
                veiculo_placa || null, veiculo_uf || null, veiculo_rntrc || null,
                veiculo_tipo_rodado || '01', veiculo_tipo_carroceria || '00',
                reboque_placa || null, reboque_uf || null,
                peso_bruto || 0, valor_carga || 0, req.user?.id || null
            ]);

            const mdfeId = result.insertId;
            let qtdCtes = 0, qtdNfes = 0;

            // Inserir documentos vinculados
            if (documentos && Array.isArray(documentos)) {
                for (let i = 0; i < documentos.length; i++) {
                    const doc = documentos[i];
                    await pool.query(
                        'INSERT INTO mdfe_documentos (mdfe_id, tipo_documento, chave_acesso, ordem) VALUES (?, ?, ?, ?)',
                        [mdfeId, doc.tipo || 'nfe', doc.chave_acesso, i + 1]
                    );
                    if (doc.tipo === 'cte') qtdCtes++; else qtdNfes++;
                }
            }

            // Inserir percursos
            if (percursos && Array.isArray(percursos)) {
                for (let i = 0; i < percursos.length; i++) {
                    await pool.query(
                        'INSERT INTO mdfe_percursos (mdfe_id, uf, ordem) VALUES (?, ?, ?)',
                        [mdfeId, percursos[i], i + 1]
                    );
                }
            }

            // Atualizar contadores
            await pool.query('UPDATE mdfes SET quantidade_ctes = ?, quantidade_nfes = ? WHERE id = ?', [qtdCtes, qtdNfes, mdfeId]);

            res.json({ success: true, id: mdfeId, numero, message: 'MDF-e criado com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/MDFES/POST] Erro:', error);
            res.status(500).json({ error: 'Erro ao criar MDF-e' });
        }
    });

    // Encerrar MDF-e
    router.put('/mdfes/:id/encerrar', async (req, res) => {
        try {
            const { id } = req.params;
            const { uf_encerramento, municipio_encerramento } = req.body;

            const [[existing]] = await pool.query('SELECT id, status FROM mdfes WHERE id = ?', [id]);
            if (!existing) return res.status(404).json({ error: 'MDF-e não encontrado' });
            if (existing.status !== 'autorizado') return res.status(400).json({ error: 'Só é permitido encerrar MDF-e autorizado' });

            await pool.query(`
                UPDATE mdfes SET status = 'encerrado', data_encerramento = NOW(),
                    uf_encerramento = ?, municipio_encerramento = ?
                WHERE id = ?
            `, [uf_encerramento || null, municipio_encerramento || null, id]);

            res.json({ success: true, message: 'MDF-e encerrado com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/MDFES/ENCERRAR] Erro:', error);
            res.status(500).json({ error: 'Erro ao encerrar MDF-e' });
        }
    });

    // Cancelar MDF-e
    router.put('/mdfes/:id/cancelar', async (req, res) => {
        try {
            const { id } = req.params;
            const [[existing]] = await pool.query('SELECT id, status FROM mdfes WHERE id = ?', [id]);
            if (!existing) return res.status(404).json({ error: 'MDF-e não encontrado' });
            if (!['digitacao', 'autorizado'].includes(existing.status)) {
                return res.status(400).json({ error: 'Só é permitido cancelar MDF-e em digitação ou autorizado' });
            }

            await pool.query('UPDATE mdfes SET status = ? WHERE id = ?', ['cancelado', id]);
            res.json({ success: true, message: 'MDF-e cancelado com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/MDFES/CANCELAR] Erro:', error);
            res.status(500).json({ error: 'Erro ao cancelar MDF-e' });
        }
    });

    // Excluir MDF-e
    router.delete('/mdfes/:id', async (req, res) => {
        try {
            const [[existing]] = await pool.query('SELECT id, status FROM mdfes WHERE id = ?', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'MDF-e não encontrado' });
            if (existing.status !== 'digitacao') return res.status(400).json({ error: 'Só é permitido excluir MDF-e em digitação' });

            await pool.query('DELETE FROM mdfes WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'MDF-e excluído com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/MDFES/DELETE] Erro:', error);
            res.status(500).json({ error: 'Erro ao excluir MDF-e' });
        }
    });

    return router;
};

