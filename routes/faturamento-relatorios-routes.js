/**
 * Relatórios de Faturamento — /api/faturamento-relatorios/*
 * =========================================================
 * `modules/Faturamento/public/relatorios.html` tinha a mesma doença da tela de
 * NF-e, em grau maior: dos 17 cards, 5 eram de **Ordem de Serviço** e 5 de
 * **Contratos** — telas de outro produto. `ordens_servico` não existe em nenhuma
 * das 3 bases, e `contratos` e `nfes` estão zeradas nas 3. Os 3 endpoints que a
 * tela chamava (`/api/faturamento/nfes`, `/api/faturamento/contratos`,
 * `/api/logistica/pedidos`) respondiam 200 com lista vazia, então a tela pintava
 * "Nenhum registro encontrado" — e os outros 6 cards caíam num placeholder
 * "Relatório em Desenvolvimento". Nada ali era defeito de SQL: era catálogo sem
 * fonte possível.
 *
 * O lastro real do faturamento destas empresas (conferido em 12/08/2026) não
 * está em `nfes` — nenhuma nota foi emitida PELO ERP —, está nos títulos, que
 * carregam o número da nota que os originou:
 *
 *   | base           | títulos c/ NF | NFs distintas | clientes | valor          |
 *   |----------------|--------------:|--------------:|---------:|---------------:|
 *   | aluforce       | 1.864         | 433           | 203      | R$ 7.831.574,91|
 *   | labor-energy   |   456         | 183           | 105      | R$ 4.955.972,82|
 *   | labor-eletric  |    99         |  45           |  27      | R$   607.819,83|
 *
 * São exatamente os 2.419 títulos / R$ 13.395.367,56 da conciliação do Contas a
 * Receber, e `data_emissao` está 100% preenchida — dá para faturar por período,
 * por cliente, por vendedor e por nota sem estimar nada.
 *
 * Lente diferente da do Financeiro sobre a mesma tabela, de propósito: o
 * Financeiro olha o título (aging, portador, liquidação); aqui se olha a NOTA
 * (o que foi faturado, para quem, quando). Por isso quase tudo agrupa por
 * `nota_fiscal`, e não por título.
 *
 * Mesmo envelope tipado das centrais de RH, Vendas e NF-e (titulo/subtitulo/
 * campos/resumo/colunas/linhas/totais/vazio).
 *
 * Arquivo NOVO — idêntico nas 3 instâncias. Criado em 12/08/2026.
 */

'use strict';

module.exports = function createFaturamentoRelatoriosRoutes(deps) {
    const express = require('express');
    const router = express.Router();
    const pool = deps.pool;
    const authenticateToken = deps.authenticateToken;
    const autorizar = deps.authorizeArea ? deps.authorizeArea('faturamento') : (q, s, n) => n();

    const num = v => Number(v) || 0;
    const iso = d => d.toISOString().slice(0, 10);

    function periodo(req) {
        const hoje = new Date();
        const doze = new Date(hoje.getTime() - 365 * 86400000);
        const re = /^\d{4}-\d{2}-\d{2}$/;
        const a = re.test(String(req.query.data_inicio || '')) ? req.query.data_inicio : iso(doze);
        const b = re.test(String(req.query.data_fim || '')) ? req.query.data_fim : iso(hoje);
        const [de, ate] = a <= b ? [a, b] : [b, a];
        const br = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
        return { de, ate, rotulo: `${br(de)} a ${br(ate)}` };
    }

    /**
     * Filtros de vendedor e cliente — aqui por NOME, não por id.
     *
     * Não é preferência: é o que o dado permite. A fonte destes relatórios é
     * `contas_receber`, onde o vendedor só existe como texto (não há vendedor_id)
     * e `cliente_id` está preenchido em 20% dos títulos faturados na aluforce,
     * 9% na energy e 0% na eletric (medido em 31/08/2026). Filtrar por id
     * devolveria quase nada — e nada na Eletric. Os relatórios de VENDAS são o
     * oposto: lá `pedidos.cliente_id` está em 100%, e é por id que se filtra.
     */
    function filtroVendedor(req, params) {
        const nome = String(req.query.vendedor || '').trim();
        if (!nome) return '';
        params.push(nome);
        return ` AND TRIM(COALESCE(vendedor,'')) = ?`;
    }

    function filtroCliente(req, params) {
        const nome = String(req.query.cliente || '').trim();
        if (!nome) return '';
        params.push(nome);
        return ` AND TRIM(COALESCE(cliente_nome,'')) = ?`;
    }

    /** Rótulos do cabeçalho para os filtros ativos — relatório impresso tem de dizer o recorte. */
    function rotulosFiltro(req) {
        const lista = [];
        const v = String(req.query.vendedor || '').trim();
        const c = String(req.query.cliente || '').trim();
        if (v) lista.push({ label: 'Vendedor', valor: v });
        if (c) lista.push({ label: 'Cliente', valor: c });
        return lista;
    }

    function filtrosDetalhadosTitulo(req, params) {
        let sql = '';
        const nota = String(req.query.nota || '').trim();
        const situacao = String(req.query.situacao_titulo || '').trim();
        const tipo = String(req.query.tipo_documento || '').trim();
        const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
        const minimoTexto = String(req.query.valor_min || '').trim(), maximoTexto = String(req.query.valor_max || '').trim();
        const minimo = Number(minimoTexto), maximo = Number(maximoTexto);
        if (nota) { sql += ' AND nota_fiscal LIKE ?'; params.push(`%${nota}%`); }
        if (situacao) { sql += ' AND TRIM(COALESCE(situacao,\'\'))=?'; params.push(situacao); }
        if (tipo) { sql += ' AND TRIM(COALESCE(tipo_documento,\'\'))=?'; params.push(tipo); }
        if (cnpj) { sql += " AND REPLACE(REPLACE(REPLACE(COALESCE(cnpj_cliente,''),'.',''),'/',''),'-','') LIKE ?"; params.push(`%${cnpj}%`); }
        if (minimoTexto && Number.isFinite(minimo)) { sql += ' AND COALESCE(valor,0)>=?'; params.push(minimo); }
        if (maximoTexto && Number.isFinite(maximo)) { sql += ' AND COALESCE(valor,0)<=?'; params.push(maximo); }
        return sql;
    }

    function rotulosDetalhados(req) {
        const map = [['nota','Nota'],['situacao_titulo','Situação'],['tipo_documento','Tipo de documento'],['cnpj','CNPJ'],['valor_min','Valor mínimo'],['valor_max','Valor máximo']];
        return map.filter(([key]) => String(req.query[key] || '').trim()).map(([key,label]) => ({ label, valor: String(req.query[key]).trim() }));
    }

    // Título faturado = tem número de nota e não foi apagado. `deleted_at` existe
    // nas 3 bases e precisa entrar: título excluído continua na tabela.
    const FATURADO = `contas_receber
         WHERE deleted_at IS NULL
           AND nota_fiscal IS NOT NULL AND TRIM(nota_fiscal) <> ''`;

    // CANCELADA fica FORA do faturamento realizado — nota cancelada não é receita.
    // Mas nunca some calada: todo relatório que exclui mostra o excluído no resumo.
    const NAO_CANCELADA = `AND UPPER(TRIM(COALESCE(situacao,''))) <> 'CANCELADA'`;

    // A importação legada da aluforce ('importacao_excel', 2.777 títulos) gravou o TIPO
    // da nota ("NF"/"F9") na coluna `nota_fiscal` — nenhuma tem número. Agrupar por nota
    // sem excluí-la cria um "grupo NF" com 1.935 parcelas e R$ 12,2 mi, maior que qualquer
    // nota real. O escopo bom é o que a conciliação do CR fecha, mais os títulos nativos.
    const SEM_IMPORTACAO_LEGADA = `AND COALESCE(origem_integracao,'') <> 'importacao_excel'`;

    // Em aberto: o campo `a_receber` é a fonte de verdade (ver a conciliação do CR);
    // na ausência dele, cai para valor - recebido.
    const EM_ABERTO = `GREATEST(COALESCE(a_receber, COALESCE(valor,0) - COALESCE(valor_recebido,0)), 0)`;

    async function canceladasNoPeriodo(de, ate) {
        const [[c]] = await pool.query(`
            SELECT COUNT(DISTINCT nota_fiscal) AS notas, ROUND(SUM(COALESCE(valor,0)),2) AS valor
              FROM ${FATURADO}
               AND UPPER(TRIM(COALESCE(situacao,''))) = 'CANCELADA'
               AND DATE(data_emissao) BETWEEN ? AND ?`, [de, ate]);
        return { notas: num(c.notas), valor: num(c.valor) };
    }

    const REGISTRO = {};
    const relatorio = (id, handler) => { REGISTRO[id] = handler; };

    // ==================================================================
    // FATURAMENTO REALIZADO
    // ==================================================================

    relatorio('faturamento-por-periodo', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        let filtros = '';
        const operacao = String(req.query.operacao || '').trim();
        const situacao = String(req.query.situacao || '').trim();
        const nota = String(req.query.nota || '').trim();
        const clienteNfe = String(req.query.cliente_texto || '').trim();
        const cnpjNfe = String(req.query.cnpj || '').replace(/\D/g, '');
        const uf = String(req.query.uf || '').trim().toUpperCase();
        const cfop = String(req.query.cfop || '').trim();
        const valorMinTexto=String(req.query.valor_min||'').trim(),valorMaxTexto=String(req.query.valor_max||'').trim();
        const valorMin = Number(valorMinTexto), valorMax = Number(valorMaxTexto);
        const vendedorNome = String(req.query.vendedor || '').trim();
        if (operacao) { filtros += ' AND TRIM(COALESCE(natureza_operacao,\'\'))=?'; params.push(operacao); }
        if (situacao) { filtros += ' AND LOWER(TRIM(COALESCE(status,\'\')))=LOWER(?)'; params.push(situacao); }
        // `nfes` não tem coluna de vendedor — vem do pedido de origem. EXISTS em vez de JOIN:
        // a query abaixo não usa alias em nenhuma coluna (é só `FROM nfes`), e `pedidos` tem
        // colunas com o MESMO NOME (status, cliente_id...) — um JOIN sem alias em tudo mais
        // tornaria essas colunas ambíguas e quebraria o resto do filtro. EXISTS não exige isso.
        if (vendedorNome) {
            filtros += ' AND EXISTS (SELECT 1 FROM pedidos pv WHERE pv.id = nfes.pedido_id AND TRIM(COALESCE(pv.vendedor_nome,\'\'))=?)';
            params.push(vendedorNome);
        }
        if (nota) { filtros += ' AND (CAST(numero AS CHAR) LIKE ? OR chave_acesso LIKE ?)'; params.push(`%${nota}%`, `%${nota}%`); }
        if (clienteNfe) { filtros += ' AND destinatario_nome LIKE ?'; params.push(`%${clienteNfe}%`); }
        if (cnpjNfe) { filtros += " AND REPLACE(REPLACE(REPLACE(COALESCE(destinatario_cnpj_cpf,''),'.',''),'/',''),'-','') LIKE ?"; params.push(`%${cnpjNfe}%`); }
        if (uf) { filtros += ' AND destinatario_uf=?'; params.push(uf); }
        if (cfop) { filtros += ' AND CAST(cfop AS CHAR) LIKE ?'; params.push(`%${cfop}%`); }
        if (valorMinTexto && Number.isFinite(valorMin)) { filtros += ' AND COALESCE(valor_total,0)>=?'; params.push(valorMin); }
        if (valorMaxTexto && Number.isFinite(valorMax)) { filtros += ' AND COALESCE(valor_total,0)<=?'; params.push(valorMax); }

        // Agrupamento das linhas: por dia (padrão, comportamento de sempre), por semana
        // (segunda a domingo) ou por mês. Pedido de 22/09/2026 — antes só existia por dia,
        // e um mês inteiro virava 20-30 linhas em vez de 1 (mês) ou 4-5 (semana).
        const granularidade = ['semana', 'mes'].includes(String(req.query.granularidade || '').trim().toLowerCase())
            ? String(req.query.granularidade).trim().toLowerCase() : 'dia';
        let grupoChaveExpr, grupoLabelSelect;
        if (granularidade === 'mes') {
            grupoChaveExpr = "DATE_FORMAT(data_emissao, '%Y-%m-01')";
            // MAX(): sql_mode=only_full_group_by rejeita referenciar `data_emissao` numa
            // expressão diferente da do GROUP BY (mesmo funcionalmente dependente, o MySQL não
            // prova isso sozinho); MAX/MIN sobre um valor igual em toda a linha do grupo não
            // muda o resultado e satisfaz a validação.
            grupoLabelSelect = 'MAX(YEAR(data_emissao)) AS grupo_ano, MAX(MONTH(data_emissao)) AS grupo_mes, NULL AS periodo_label_sql';
        } else if (granularidade === 'semana') {
            // Semana começando na segunda: WEEKDAY() é 0=segunda..6=domingo, então subtrair
            // WEEKDAY() dias de qualquer data da semana sempre cai na segunda-feira dela.
            grupoChaveExpr = 'DATE(DATE_SUB(data_emissao, INTERVAL WEEKDAY(data_emissao) DAY))';
            grupoLabelSelect = `NULL AS grupo_ano, NULL AS grupo_mes,
                       MAX(CONCAT(DATE_FORMAT(DATE_SUB(data_emissao, INTERVAL WEEKDAY(data_emissao) DAY), '%d/%m'), ' a ',
                              DATE_FORMAT(DATE_ADD(DATE_SUB(data_emissao, INTERVAL WEEKDAY(data_emissao) DAY), INTERVAL 6 DAY), '%d/%m/%Y'))) AS periodo_label_sql`;
        } else {
            grupoChaveExpr = 'DATE(data_emissao)';
            grupoLabelSelect = 'NULL AS grupo_ano, NULL AS grupo_mes, NULL AS periodo_label_sql';
        }

        const [linhasRaw] = await pool.query(`
            SELECT ${grupoChaveExpr} AS grupo_chave, ${grupoLabelSelect},
                   GROUP_CONCAT(DISTINCT CAST(numero AS CHAR) ORDER BY CAST(numero AS UNSIGNED) SEPARATOR ', ') notas,
                   COUNT(*) qtd_notas,
                   ROUND(SUM(COALESCE(valor_produtos,0)),2) total_mercadoria,
                   ROUND(SUM(COALESCE(valor_desconto,0)),2) desconto,
                   ROUND(SUM(COALESCE(valor_icms_st,0)),2) valor_icms_st,
                   ROUND(SUM(COALESCE(valor_frete,0)),2) frete,
                   0 seguro, 0 outras_despesas,
                   ROUND(SUM(COALESCE(valor_ipi,0)),2) valor_ipi,
                   ROUND(SUM(COALESCE(valor_total,0)),2) total_nota,
                   ROUND(SUM(COALESCE(valor_pis,0)+COALESCE(valor_cofins,0)),2) impostos_federais,
                   ROUND(SUM(COALESCE(valor_icms,0)+COALESCE(valor_fcp,0)+COALESCE(valor_fcp_st,0)),2) impostos_estaduais,
                   0 impostos_municipais,
                   ROUND(SUM(COALESCE(valor_icms,0)),2) valor_icms,
                   ROUND(SUM(COALESCE(valor_pis,0)),2) valor_pis,
                   ROUND(SUM(COALESCE(valor_cofins,0)),2) valor_cofins,
                   ROUND(SUM(COALESCE(valor_fcp,0)),2) valor_fcp,
                   ROUND(SUM(COALESCE(valor_fcp_st,0)),2) valor_fcp_st,
                   0 valor_icms_desonerado
              FROM nfes
             WHERE DATE(data_emissao) BETWEEN ? AND ?${filtros}
             GROUP BY ${grupoChaveExpr} ORDER BY ${grupoChaveExpr}`, params);

        // Rótulo do período: dia usa a própria data (o front formata via tipo:'data', igual
        // sempre foi). Mês monta o nome em JS a partir de ANO/MÊS como INTEIROS — nunca por
        // string de data — porque este arquivo já foi mordido por deslocamento de fuso ao
        // reconstruir datas via `new Date("AAAA-MM-DD")` (ver comentários de fmtData acima);
        // `new Date(ano, mes-1, 1)` não sofre disso, é construído por componentes, sem parse.
        const linhas = linhasRaw.map((l) => {
            let periodo_label = null;
            if (granularidade === 'mes') {
                const nomeMes = new Date(Number(l.grupo_ano), Number(l.grupo_mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
                periodo_label = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) + '/' + l.grupo_ano;
            } else if (granularidade === 'semana') {
                periodo_label = l.periodo_label_sql;
            }
            const linha = { ...l, periodo_label };
            if (granularidade === 'dia') linha.data_emissao = l.grupo_chave;
            delete linha.grupo_chave; delete linha.grupo_ano; delete linha.grupo_mes; delete linha.periodo_label_sql;
            return linha;
        });

        const total = linhas.reduce((s, l) => s + num(l.total_nota), 0);
        const notas = linhas.reduce((s, l) => s + num(l.qtd_notas), 0);
        const ROTULO_GRANULARIDADE = { dia: 'Dia', semana: 'Semana', mes: 'Mês' };
        const colunaPeriodo = granularidade === 'dia'
            ? { chave: 'data_emissao', label: 'Data de emissão', tipo: 'data' }
            : { chave: 'periodo_label', label: ROTULO_GRANULARIDADE[granularidade] };
        return {
            titulo: 'Faturamento por Período',
            subtitulo: 'Notas fiscais e tributos consolidados por data de emissão',
            referencia: `Período: ${p.rotulo}`,
            campos: [
                { label: 'Período', valor: p.rotulo },
                { label: 'Agrupado por', valor: ROTULO_GRANULARIDADE[granularidade] },
                { label: 'Operação', valor: operacao || 'Todas' },
                { label: 'Situação', valor: situacao || 'Todas' },
                { label: 'Vendedor', valor: vendedorNome || 'Todos' },
                ...rotulosDetalhados(req),
                ...(clienteNfe ? [{ label:'Cliente contém', valor:clienteNfe }] : []),
                ...(uf ? [{ label:'UF', valor:uf }] : []),
                ...(cfop ? [{ label:'CFOP', valor:cfop }] : []),
                { label: 'Base', valor: 'NF-e emitidas pelo ERP' }
            ],
            resumo: [
                { label: 'Notas faturadas', valor: notas },
                { label: 'Valor faturado', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Ticket médio', valor: notas ? total / notas : 0, tipo: 'moeda' },
                { label: 'ICMS', valor: linhas.reduce((s,l)=>s+num(l.valor_icms),0), tipo: 'moeda' }
            ],
            colunas: [
                colunaPeriodo,
                // Sem `tipo`: a lista de números ("912, 913, 915") é texto, não um numero só —
                // pedido de 22/09/2026, antes mostrava só a contagem (COUNT), sem detalhar quais.
                { chave: 'notas', label: 'Notas' },
                { chave: 'total_mercadoria', label: 'Total de mercadoria', tipo: 'moeda' },
                { chave: 'desconto', label: 'Desconto', tipo: 'moeda' },
                { chave: 'valor_icms_st', label: 'Valor do ICMS ST', tipo: 'moeda' },
                { chave: 'frete', label: 'Frete', tipo: 'moeda' },
                { chave: 'seguro', label: 'Seguro', tipo: 'moeda' },
                { chave: 'outras_despesas', label: 'Outras despesas acessórias', tipo: 'moeda' },
                { chave: 'valor_ipi', label: 'Valor do IPI', tipo: 'moeda' },
                { chave: 'total_nota', label: 'Total da nota fiscal', tipo: 'moeda' },
                { chave: 'impostos_federais', label: 'Impostos federais', tipo: 'moeda' },
                { chave: 'impostos_estaduais', label: 'Impostos estaduais', tipo: 'moeda' },
                { chave: 'impostos_municipais', label: 'Impostos municipais', tipo: 'moeda' },
                { chave: 'valor_icms', label: 'Valor do ICMS', tipo: 'moeda' },
                { chave: 'valor_pis', label: 'Valor do PIS', tipo: 'moeda' },
                { chave: 'valor_cofins', label: 'Valor do COFINS', tipo: 'moeda' },
                { chave: 'valor_fcp', label: 'Valor do FCP do ICMS', tipo: 'moeda' },
                { chave: 'valor_fcp_st', label: 'Valor do FCP do ICMS ST', tipo: 'moeda' },
                { chave: 'valor_icms_desonerado', label: 'Valor do ICMS desonerado', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total faturado', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhuma nota faturada no período.'
        };
    });

    relatorio('faturamento-por-cliente', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        const [linhas] = await pool.query(`
            SELECT COALESCE(NULLIF(TRIM(cliente_nome),''), CONCAT('Cliente #', cliente_id), '(sem cliente)') AS cliente,
                   COUNT(DISTINCT nota_fiscal) AS notas,
                   COUNT(*) AS titulos,
                   ROUND(SUM(COALESCE(valor,0)), 2) AS valor,
                   ROUND(SUM(COALESCE(valor,0)) / NULLIF(COUNT(DISTINCT nota_fiscal),0), 2) AS ticket,
                   MAX(DATE(data_emissao)) AS ultima
              FROM ${FATURADO} ${NAO_CANCELADA}
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd}
             GROUP BY cliente
             ORDER BY valor DESC LIMIT 300`, params);

        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        linhas.forEach(l => { l.participacao = total ? (num(l.valor) / total) * 100 : 0; });
        return {
            titulo: 'Faturamento por Cliente',
            subtitulo: 'Quem mais foi faturado no período',
            referencia: `Período: ${p.rotulo}`,
            campos: [{ label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req)],
            resumo: [
                { label: 'Clientes faturados', valor: linhas.length },
                { label: 'Valor faturado', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Maior cliente', valor: linhas.length ? linhas[0].cliente : '—' },
                { label: 'Top 10 representa', valor: total ? (linhas.slice(0, 10).reduce((s, l) => s + num(l.valor), 0) / total) * 100 : 0, tipo: 'percentual' }
            ],
            colunas: [
                { chave: 'cliente', label: 'Cliente' },
                { chave: 'notas', label: 'Notas', tipo: 'numero' },
                { chave: 'titulos', label: 'Títulos', tipo: 'numero' },
                { chave: 'ticket', label: 'Ticket médio', tipo: 'moeda' },
                { chave: 'ultima', label: 'Última nota', tipo: 'data' },
                { chave: 'participacao', label: 'Participação', tipo: 'percentual' },
                { chave: 'valor', label: 'Faturado', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total faturado', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhum cliente faturado no período.'
        };
    });

    relatorio('notas-fiscais-faturadas', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        // Uma nota vira várias parcelas (a maior aqui tem 14), então a linha é a
        // NOTA e as parcelas viram contagem — senão o mesmo faturamento aparece
        // repetido e o total infla.
        const [linhas] = await pool.query(`
            SELECT nota_fiscal,
                   MAX(COALESCE(NULLIF(TRIM(cliente_nome),''), '(sem cliente)')) AS cliente,
                   MAX(DATE(data_emissao)) AS emissao,
                   COUNT(*) AS parcelas,
                   MAX(COALESCE(NULLIF(TRIM(situacao),''), '—')) AS situacao,
                   ROUND(SUM(COALESCE(valor,0)), 2) AS valor,
                   ROUND(SUM(COALESCE(valor_recebido,0)), 2) AS recebido,
                   ROUND(SUM(${EM_ABERTO}), 2) AS aberto
              FROM ${FATURADO} ${NAO_CANCELADA}
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd}
             GROUP BY nota_fiscal
             ORDER BY emissao DESC, nota_fiscal DESC LIMIT 500`, params);

        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        const recebido = linhas.reduce((s, l) => s + num(l.recebido), 0);
        return {
            titulo: 'Notas Fiscais Faturadas',
            subtitulo: 'Uma linha por nota, com as parcelas consolidadas',
            referencia: `Período: ${p.rotulo}`,
            campos: [
                { label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Limite', valor: 'As 500 notas mais recentes do período' }
            ],
            resumo: [
                { label: 'Notas', valor: linhas.length },
                { label: 'Valor faturado', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Já recebido', valor: recebido, tipo: 'moeda' },
                { label: 'Em aberto', valor: linhas.reduce((s, l) => s + num(l.aberto), 0), tipo: 'moeda' }
            ],
            colunas: [
                { chave: 'nota_fiscal', label: 'Nota' },
                { chave: 'cliente', label: 'Cliente' },
                { chave: 'emissao', label: 'Emissão', tipo: 'data' },
                { chave: 'parcelas', label: 'Parcelas', tipo: 'numero' },
                { chave: 'situacao', label: 'Situação', tipo: 'badge' },
                { chave: 'recebido', label: 'Recebido', tipo: 'moeda' },
                { chave: 'aberto', label: 'Em aberto', tipo: 'moeda' },
                { chave: 'valor', label: 'Valor', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total das notas listadas', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhuma nota fiscal faturada no período.'
        };
    });

    relatorio('faturamento-por-vendedor', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        const [linhas] = await pool.query(`
            SELECT COALESCE(NULLIF(TRIM(vendedor),''), '(sem vendedor)') AS vendedor,
                   COUNT(DISTINCT nota_fiscal) AS notas,
                   COUNT(DISTINCT COALESCE(NULLIF(TRIM(cliente_nome),''), cliente_id)) AS clientes,
                   ROUND(SUM(COALESCE(valor,0)), 2) AS valor,
                   ROUND(SUM(COALESCE(valor,0)) / NULLIF(COUNT(DISTINCT nota_fiscal),0), 2) AS ticket
              FROM ${FATURADO} ${NAO_CANCELADA}
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd}
             GROUP BY COALESCE(NULLIF(TRIM(vendedor),''), '(sem vendedor)')
             ORDER BY valor DESC`, params);

        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        linhas.forEach(l => { l.participacao = total ? (num(l.valor) / total) * 100 : 0; });
        const semVendedor = linhas.find(l => l.vendedor === '(sem vendedor)');
        return {
            titulo: 'Faturamento por Vendedor',
            subtitulo: 'Nota faturada atribuída ao vendedor do título',
            referencia: `Período: ${p.rotulo}`,
            campos: [
                { label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Sem vendedor', valor: semVendedor ? `${semVendedor.notas} nota(s) sem vendedor no título` : 'Todas as notas têm vendedor' }
            ],
            resumo: [
                { label: 'Vendedores', valor: linhas.filter(l => l.vendedor !== '(sem vendedor)').length },
                { label: 'Valor faturado', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Maior vendedor', valor: linhas.length ? linhas[0].vendedor : '—' }
            ],
            colunas: [
                { chave: 'vendedor', label: 'Vendedor' },
                { chave: 'notas', label: 'Notas', tipo: 'numero' },
                { chave: 'clientes', label: 'Clientes', tipo: 'numero' },
                { chave: 'ticket', label: 'Ticket médio', tipo: 'moeda' },
                { chave: 'participacao', label: 'Participação', tipo: 'percentual' },
                { chave: 'valor', label: 'Faturado', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total faturado', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhuma nota faturada no período.'
        };
    });

    // ==================================================================
    // RECEBIMENTO DO QUE FOI FATURADO
    // ==================================================================

    relatorio('situacao-do-faturado', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        // Aqui a CANCELADA ENTRA: o objetivo é justamente mostrar o destino de
        // tudo que foi faturado, inclusive o que foi cancelado.
        const [linhas] = await pool.query(`
            SELECT COALESCE(NULLIF(TRIM(situacao),''), '(sem situação)') AS situacao,
                   COUNT(DISTINCT nota_fiscal) AS notas,
                   COUNT(*) AS titulos,
                   ROUND(SUM(COALESCE(valor,0)), 2) AS valor,
                   ROUND(SUM(COALESCE(valor_recebido,0)), 2) AS recebido,
                   ROUND(SUM(${EM_ABERTO}), 2) AS aberto
              FROM ${FATURADO}
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd}
             GROUP BY COALESCE(NULLIF(TRIM(situacao),''), '(sem situação)')
             ORDER BY valor DESC`, params);

        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        linhas.forEach(l => { l.pct_recebido = num(l.valor) ? (num(l.recebido) / num(l.valor)) * 100 : 0; });
        const recebido = linhas.reduce((s, l) => s + num(l.recebido), 0);
        return {
            titulo: 'Situação do Faturado',
            subtitulo: 'Para onde foi cada nota faturada — carteira, operado, cartório, cancelada',
            referencia: `Período: ${p.rotulo}`,
            campos: [
                { label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Canceladas', valor: 'Incluídas neste relatório, por ser o mapa de destino' }
            ],
            resumo: [
                { label: 'Faturado no período', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Recebido', valor: recebido, tipo: 'moeda' },
                { label: 'Em aberto', valor: linhas.reduce((s, l) => s + num(l.aberto), 0), tipo: 'moeda' },
                { label: '% recebido', valor: total ? (recebido / total) * 100 : 0, tipo: 'percentual' }
            ],
            colunas: [
                { chave: 'situacao', label: 'Situação', tipo: 'badge' },
                { chave: 'notas', label: 'Notas', tipo: 'numero' },
                { chave: 'titulos', label: 'Títulos', tipo: 'numero' },
                { chave: 'recebido', label: 'Recebido', tipo: 'moeda' },
                { chave: 'aberto', label: 'Em aberto', tipo: 'moeda' },
                { chave: 'pct_recebido', label: '% recebido', tipo: 'percentual' },
                { chave: 'valor', label: 'Faturado', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total faturado', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhuma nota faturada no período.'
        };
    });

    relatorio('inadimplencia-por-cliente', async (req) => {
        // Posição de HOJE: vencido e ainda em aberto. Não usa o filtro de período
        // — inadimplência é foto do agora, não recorte de emissão. Vendedor e
        // cliente, porém, valem: "quem o Fulano deixou vencer" é a pergunta real.
        const params = [];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        const [linhas] = await pool.query(`
            SELECT COALESCE(NULLIF(TRIM(cliente_nome),''), CONCAT('Cliente #', cliente_id), '(sem cliente)') AS cliente,
                   COUNT(*) AS titulos,
                   COUNT(DISTINCT nota_fiscal) AS notas,
                   ROUND(SUM(${EM_ABERTO}), 2) AS vencido,
                   MAX(DATEDIFF(CURDATE(), DATE(data_vencimento))) AS atraso_max,
                   MIN(DATE(data_vencimento)) AS mais_antigo
              FROM ${FATURADO} ${NAO_CANCELADA}
               AND data_vencimento IS NOT NULL
               AND DATE(data_vencimento) < CURDATE()
               AND ${EM_ABERTO} > 0.005${fv}${fc}${fd}
             GROUP BY cliente
             ORDER BY vencido DESC LIMIT 300`, params);

        const total = linhas.reduce((s, l) => s + num(l.vencido), 0);
        const faixa = d => d > 180 ? 'Acima de 180 dias' : d > 90 ? '91 a 180 dias' : d > 30 ? '31 a 90 dias' : 'Até 30 dias';
        linhas.forEach(l => { l.faixa = faixa(num(l.atraso_max)); });
        return {
            titulo: 'Inadimplência por Cliente',
            subtitulo: 'Notas faturadas vencidas e ainda em aberto — posição de hoje',
            referencia: `Posição em ${new Date().toLocaleDateString('pt-BR')}`,
            campos: [
                { label: 'Posição', valor: new Date().toLocaleDateString('pt-BR') },
                // Este relatório não tem linha de "Período" (é foto de hoje), então os
                // rótulos dos filtros entram aqui — senão o PDF sairia recortado por
                // vendedor sem dizer por qual.
                ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Critério', valor: 'Vencimento anterior a hoje e saldo a receber maior que zero' }
            ],
            resumo: [
                { label: 'Clientes inadimplentes', valor: linhas.length },
                { label: 'Total vencido', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Títulos', valor: linhas.reduce((s, l) => s + num(l.titulos), 0) },
                { label: 'Maior atraso', valor: linhas.reduce((m, l) => Math.max(m, num(l.atraso_max)), 0) + ' dias' }
            ],
            colunas: [
                { chave: 'cliente', label: 'Cliente' },
                { chave: 'notas', label: 'Notas', tipo: 'numero' },
                { chave: 'titulos', label: 'Títulos', tipo: 'numero' },
                { chave: 'mais_antigo', label: 'Vencimento mais antigo', tipo: 'data' },
                { chave: 'atraso_max', label: 'Atraso (dias)', tipo: 'numero' },
                { chave: 'faixa', label: 'Faixa', tipo: 'badge' },
                { chave: 'vencido', label: 'Vencido', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total vencido em aberto', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhum título faturado vencido em aberto.'
        };
    });

    // ==================================================================
    // A FATURAR (pipeline)
    // ==================================================================

    relatorio('pedidos-a-faturar', async (req) => {
        // Posição atual da carteira: pedido vivo que ainda não virou nota.
        const params = [];
        const cond = [];
        const vendedor = String(req.query.vendedor || '').trim();
        const cliente = String(req.query.cliente || '').trim();
        const status = String(req.query.status_pedido || '').trim();
        const pedido = String(req.query.pedido || '').trim();
        const minimoTexto=String(req.query.valor_min||'').trim(),maximoTexto=String(req.query.valor_max||'').trim();
        const diasMinTexto=String(req.query.dias_min||'').trim(),diasMaxTexto=String(req.query.dias_max||'').trim();
        if (vendedor) { cond.push("TRIM(COALESCE(p.vendedor_nome,'')) = ?"); params.push(vendedor); }
        if (cliente) { cond.push("TRIM(COALESCE(p.cliente_nome,'')) = ?"); params.push(cliente); }
        if (status) { cond.push("LOWER(TRIM(COALESCE(p.status,''))) = LOWER(?)"); params.push(status); }
        if (pedido) { cond.push("(CAST(p.id AS CHAR) LIKE ? OR p.numero_pedido LIKE ?)"); params.push(`%${pedido}%`,`%${pedido}%`); }
        if (minimoTexto && Number.isFinite(Number(minimoTexto))) { cond.push('COALESCE(p.valor,0)>=?'); params.push(Number(minimoTexto)); }
        if (maximoTexto && Number.isFinite(Number(maximoTexto))) { cond.push('COALESCE(p.valor,0)<=?'); params.push(Number(maximoTexto)); }
        if (diasMinTexto && Number.isFinite(Number(diasMinTexto))) { cond.push('DATEDIFF(CURDATE(),DATE(COALESCE(p.data_aprovacao,p.created_at)))>=?'); params.push(Number(diasMinTexto)); }
        if (diasMaxTexto && Number.isFinite(Number(diasMaxTexto))) { cond.push('DATEDIFF(CURDATE(),DATE(COALESCE(p.data_aprovacao,p.created_at)))<=?'); params.push(Number(diasMaxTexto)); }
        const [linhas] = await pool.query(`
            SELECT p.id,
                   COALESCE(NULLIF(TRIM(p.numero_pedido),''), CONCAT('#', p.id)) AS pedido,
                   COALESCE(NULLIF(TRIM(p.cliente_nome),''), '(sem cliente)') AS cliente,
                   COALESCE(
                       NULLIF(CASE WHEN LOWER(TRIM(COALESCE(p.vendedor_nome, ''))) = 'mel'
                                   THEN 'Melissa Navarro'
                                   ELSE TRIM(p.vendedor_nome) END, ''),
                       '—'
                   ) AS vendedor,
                   COALESCE(NULLIF(TRIM(p.status),''), '—') AS status,
                   DATE(COALESCE(p.data_aprovacao, p.created_at)) AS desde,
                   DATEDIFF(CURDATE(), DATE(COALESCE(p.data_aprovacao, p.created_at))) AS dias,
                   ROUND(COALESCE(p.valor,0), 2) AS valor
              FROM pedidos p
             WHERE p.data_faturamento IS NULL
               AND LOWER(COALESCE(p.status,'')) NOT IN ('excluido','excluído','cancelado','cancelada','orcamento','orçamento','rascunho')
               ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
             ORDER BY dias DESC, valor DESC LIMIT 300`, params);

        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        return {
            titulo: 'Pedidos a Faturar',
            subtitulo: 'Carteira aprovada que ainda não virou nota fiscal — posição de hoje',
            referencia: `Posição em ${new Date().toLocaleDateString('pt-BR')}`,
            campos: [
                { label: 'Posição', valor: new Date().toLocaleDateString('pt-BR') },
                ...(vendedor ? [{ label: 'Vendedor', valor: vendedor }] : []),
                ...(cliente ? [{ label: 'Cliente', valor: cliente }] : []),
                ...(status ? [{ label: 'Status', valor: status }] : []),
                ...(pedido ? [{ label: 'Pedido', valor: pedido }] : []), ...rotulosDetalhados(req),
                { label: 'Critério', valor: 'Pedido sem data de faturamento, fora de excluído/cancelado/orçamento' }
            ],
            resumo: [
                { label: 'Pedidos a faturar', valor: linhas.length },
                { label: 'Valor na carteira', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Espera média', valor: linhas.length ? Math.round(linhas.reduce((s, l) => s + num(l.dias), 0) / linhas.length) + ' dias' : '—' },
                { label: 'Mais antigo', valor: linhas.length ? num(linhas[0].dias) + ' dias' : '—' }
            ],
            colunas: [
                { chave: 'pedido', label: 'Pedido' },
                { chave: 'cliente', label: 'Cliente' },
                { chave: 'vendedor', label: 'Vendedor' },
                { chave: 'status', label: 'Status', tipo: 'badge' },
                { chave: 'desde', label: 'Desde', tipo: 'data' },
                { chave: 'dias', label: 'Dias parado', tipo: 'numero' },
                { chave: 'valor', label: 'Valor', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total a faturar', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhum pedido aguardando faturamento.'
        };
    });

    // ==================================================================
    // CATÁLOGO E ROTAS
    // ==================================================================

    // ==================================================================
    // RELAÇÃO DE NOTAS — emitidas, recebidas e canceladas
    // ==================================================================

    relatorio('notas-emitidas', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        // A linha é a NOTA, não o título: uma nota vira até 14 parcelas e agrupar
        // errado multiplica o faturamento pelo número de parcelas.
        const [linhas] = await pool.query(`
            SELECT nota_fiscal,
                   MAX(COALESCE(NULLIF(TRIM(cliente_nome),''), '(sem cliente)')) AS cliente,
                   MAX(COALESCE(NULLIF(TRIM(cnpj_cliente),''), '—')) AS cnpj,
                   MAX(DATE(data_emissao)) AS emissao,
                   MAX(COALESCE(NULLIF(TRIM(nf_referencia),''), 'NF')) AS tipo,
                   COUNT(*) AS parcelas,
                   ROUND(SUM(COALESCE(valor,0)), 2) AS valor
              FROM ${FATURADO} ${NAO_CANCELADA}
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd} ${SEM_IMPORTACAO_LEGADA}
             GROUP BY nota_fiscal
             ORDER BY emissao DESC, nota_fiscal DESC LIMIT 1000`, params);
        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        return {
            titulo: 'Notas Emitidas',
            subtitulo: 'Relação das notas emitidas no período, uma linha por nota',
            referencia: `Período: ${p.rotulo}`,
            campos: [{ label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Fonte', valor: 'Títulos do Contas a Receber (a nota que os originou)' }],
            resumo: [
                { label: 'Notas emitidas', valor: linhas.length, tipo: 'numero' },
                { label: 'Valor emitido', valor: total, tipo: 'moeda' },
                { label: 'Ticket médio', valor: linhas.length ? total / linhas.length : 0, tipo: 'moeda' }
            ],
            colunas: [
                { chave: 'nota_fiscal', label: 'Nota' },
                { chave: 'tipo', label: 'Tipo' },
                { chave: 'cliente', label: 'Cliente' },
                { chave: 'cnpj', label: 'CNPJ' },
                { chave: 'emissao', label: 'Emissão', tipo: 'data' },
                { chave: 'parcelas', label: 'Parcelas', tipo: 'numero' },
                { chave: 'valor', label: 'Valor', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total emitido', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhuma nota emitida no período.'
        };
    });

    relatorio('notas-recebidas', async (req) => {
        const p = periodo(req);
        // Três documentos distintos, com colunas distintas — a UNION normaliza para o
        // mesmo formato de linha. Cada bloco cai em silêncio se a tabela não existir
        // na instância (a Cobal é mais nova e não tem todas).
        const blocos = [
            { t: 'nf_entrada', sql: `SELECT 'NF-e' AS especie, numero_nfe AS numero,
                        COALESCE(NULLIF(TRIM(emitente_razao),''),'(sem emitente)') AS emitente,
                        COALESCE(NULLIF(TRIM(emitente_cnpj),''),'—') AS cnpj,
                        DATE(data_emissao) AS emissao, COALESCE(valor_total,0) AS valor,
                        COALESCE(NULLIF(TRIM(status),''),'—') AS situacao
                   FROM nf_entrada WHERE DATE(data_emissao) BETWEEN ? AND ?` },
            { t: 'cte_entrada', sql: `SELECT 'CT-e' AS especie, numero AS numero,
                        COALESCE(NULLIF(TRIM(emitente_razao),''),'(sem emitente)') AS emitente,
                        COALESCE(NULLIF(TRIM(emitente_cnpj),''),'—') AS cnpj,
                        DATE(data_emissao) AS emissao, COALESCE(valor_total,0) AS valor,
                        COALESCE(NULLIF(TRIM(status),''),'—') AS situacao
                   FROM cte_entrada WHERE DATE(data_emissao) BETWEEN ? AND ?` },
            { t: 'nfse_entrada', sql: `SELECT 'NFS-e' AS especie, numero AS numero,
                        COALESCE(NULLIF(TRIM(prestador_razao),''),'(sem prestador)') AS emitente,
                        COALESCE(NULLIF(TRIM(prestador_cnpj),''),'—') AS cnpj,
                        DATE(data_emissao) AS emissao, COALESCE(valor_servico,0) AS valor,
                        COALESCE(NULLIF(TRIM(status),''),'—') AS situacao
                   FROM nfse_entrada WHERE DATE(data_emissao) BETWEEN ? AND ?` }
        ];
        let linhas = [];
        const porEspecie = {};
        for (const b of blocos) {
            try {
                const [rows] = await pool.query(b.sql, [p.de, p.ate]);
                linhas = linhas.concat(rows);
                porEspecie[rows[0] ? rows[0].especie : b.t] = rows.length;
            } catch (err) {
                if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
            }
        }
        linhas.sort((a, b) => String(b.emissao || '').localeCompare(String(a.emissao || '')));
        const especie=String(req.query.especie||'').trim().toLowerCase(),documento=String(req.query.nota||'').trim().toLowerCase();
        const emitente=String(req.query.emitente||'').trim().toLowerCase(),cnpj=String(req.query.cnpj||'').replace(/\D/g,'');
        const situacao=String(req.query.situacao_titulo||'').trim().toLowerCase();
        const minimo=String(req.query.valor_min||'').trim(),maximo=String(req.query.valor_max||'').trim();
        linhas=linhas.filter(l=>(!especie||String(l.especie||'').toLowerCase()===especie)&&(!documento||String(l.numero||'').toLowerCase().includes(documento))&&(!emitente||String(l.emitente||'').toLowerCase().includes(emitente))&&(!cnpj||String(l.cnpj||'').replace(/\D/g,'').includes(cnpj))&&(!situacao||String(l.situacao||'').toLowerCase()===situacao)&&(!minimo||num(l.valor)>=Number(minimo))&&(!maximo||num(l.valor)<=Number(maximo)));
        linhas = linhas.slice(0, 1000);
        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        return {
            titulo: 'Notas Recebidas',
            subtitulo: 'NF-e, CT-e e NFS-e recebidas de terceiros',
            referencia: `Período: ${p.rotulo}`,
            campos: [{ label: 'Período', valor: p.rotulo },
                ...(especie?[{label:'Espécie',valor:especie.toUpperCase()}]:[]), ...(emitente?[{label:'Emitente contém',valor:emitente}]:[]), ...rotulosDetalhados(req),
                { label: 'Espécies', valor: Object.entries(porEspecie).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—' },
                { label: 'Limite', valor: 'Os 1.000 documentos mais recentes do período' }],
            resumo: [
                { label: 'Documentos', valor: linhas.length, tipo: 'numero' },
                { label: 'Valor recebido', valor: total, tipo: 'moeda' },
                { label: 'Emitentes', valor: new Set(linhas.map(l => l.cnpj)).size, tipo: 'numero' }
            ],
            colunas: [
                { chave: 'especie', label: 'Espécie' },
                { chave: 'numero', label: 'Número' },
                { chave: 'emitente', label: 'Emitente' },
                { chave: 'cnpj', label: 'CNPJ' },
                { chave: 'emissao', label: 'Emissão', tipo: 'data' },
                { chave: 'situacao', label: 'Situação' },
                { chave: 'valor', label: 'Valor', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total recebido', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhum documento recebido no período.'
        };
    });

    relatorio('notas-canceladas', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        // O cancelamento vive em duas colunas: status e liquidado_situacao. Uma nota
        // conta como cancelada quando TODOS os seus títulos estão cancelados — nota com
        // parcela viva foi cancelada só em parte e entra como "parcial".
        const [linhas] = await pool.query(`
            SELECT nota_fiscal,
                   MAX(COALESCE(NULLIF(TRIM(cliente_nome),''), '(sem cliente)')) AS cliente,
                   MAX(COALESCE(NULLIF(TRIM(cnpj_cliente),''), '—')) AS cnpj,
                   MAX(DATE(data_emissao)) AS emissao,
                   COUNT(*) AS parcelas,
                   SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'cancelada'
                             OR UPPER(COALESCE(liquidado_situacao,'')) = 'CANCELADA' THEN 1 ELSE 0 END) AS canceladas,
                   ROUND(SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'cancelada'
                             OR UPPER(COALESCE(liquidado_situacao,'')) = 'CANCELADA'
                             THEN COALESCE(valor,0) ELSE 0 END), 2) AS valor
              FROM contas_receber
             WHERE deleted_at IS NULL AND COALESCE(NULLIF(TRIM(nota_fiscal),''),'') <> ''
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd} ${SEM_IMPORTACAO_LEGADA}
             GROUP BY nota_fiscal
            HAVING canceladas > 0
             ORDER BY emissao DESC, nota_fiscal DESC LIMIT 1000`, params);
        linhas.forEach(l => { l.abrangencia = Number(l.canceladas) >= Number(l.parcelas) ? 'Total' : 'Parcial'; });
        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        const integrais = linhas.filter(l => l.abrangencia === 'Total').length;
        return {
            titulo: 'Notas Canceladas',
            subtitulo: 'Notas com título cancelado, e se o cancelamento foi total ou parcial',
            referencia: `Período: ${p.rotulo}`,
            campos: [{ label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Critério', valor: "status = 'cancelada' ou LIQUIDADO = 'CANCELADA'" }],
            resumo: [
                { label: 'Notas com cancelamento', valor: linhas.length, tipo: 'numero' },
                { label: 'Canceladas por inteiro', valor: integrais, tipo: 'numero' },
                { label: 'Valor cancelado', valor: total, tipo: 'moeda' }
            ],
            colunas: [
                { chave: 'nota_fiscal', label: 'Nota' },
                { chave: 'cliente', label: 'Cliente' },
                { chave: 'cnpj', label: 'CNPJ' },
                { chave: 'emissao', label: 'Emissão', tipo: 'data' },
                { chave: 'parcelas', label: 'Parcelas', tipo: 'numero' },
                { chave: 'canceladas', label: 'Canceladas', tipo: 'numero' },
                { chave: 'abrangencia', label: 'Abrangência' },
                { chave: 'valor', label: 'Valor cancelado', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total cancelado', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhuma nota cancelada no período.'
        };
    });

    // "F9" e "NF" (sem número) marcam título faturado sem nota real identificável —
    // majoritariamente a importação legada do Excel (ver SEM_IMPORTACAO_LEGADA acima),
    // mas o critério olha o VALOR do campo, não a origem: se algum título novo repetir
    // a mesma convenção, entra no mesmo balde sem precisar mexer neste relatório.
    // "F9" é como a empresa chama a venda faturada só parcialmente ("meia nota") —
    // este relatório existe para mostrar o tamanho desse valor, não para escondê-lo.
    relatorio('notas-por-documentacao', async (req) => {
        const p = periodo(req);
        const params = [p.de, p.ate];
        const fv = filtroVendedor(req, params);
        const fc = filtroCliente(req, params);
        const fd = filtrosDetalhadosTitulo(req, params);
        const CLASSIFICACAO = `CASE
                   WHEN UPPER(TRIM(COALESCE(nota_fiscal,''))) = 'F9' THEN 'F9 (Meia Nota)'
                   WHEN UPPER(TRIM(COALESCE(nota_fiscal,''))) = 'NF' THEN 'NF (tipo genérico, sem número)'
                   ELSE 'Nota com número'
               END`;
        const [linhas] = await pool.query(`
            SELECT ${CLASSIFICACAO} AS classificacao,
                   COUNT(*) AS titulos,
                   COUNT(DISTINCT COALESCE(NULLIF(TRIM(cliente_nome),''), cliente_id)) AS clientes,
                   ROUND(SUM(COALESCE(valor,0)), 2) AS valor
              FROM ${FATURADO} ${NAO_CANCELADA}
               AND DATE(data_emissao) BETWEEN ? AND ?${fv}${fc}${fd}
             GROUP BY ${CLASSIFICACAO}
             ORDER BY valor DESC`, params);

        const total = linhas.reduce((s, l) => s + num(l.valor), 0);
        linhas.forEach(l => { l.participacao = total ? (num(l.valor) / total) * 100 : 0; });
        const f9 = linhas.find(l => l.classificacao === 'F9 (Meia Nota)');
        const documentado = linhas.find(l => l.classificacao === 'Nota com número');
        return {
            titulo: 'Notas por Documentação',
            subtitulo: 'Quanto do faturado tem número de nota real e quanto está como F9 (meia nota)',
            referencia: `Período: ${p.rotulo}`,
            campos: [
                { label: 'Período', valor: p.rotulo }, ...rotulosFiltro(req), ...rotulosDetalhados(req),
                { label: 'Critério', valor: "Classifica pelo valor do campo 'nota_fiscal': número real, ou marcador 'F9'/'NF'" }
            ],
            resumo: [
                { label: 'Valor total faturado', valor: total, tipo: 'moeda', tom: 'destaque' },
                { label: 'Com número de nota', valor: documentado ? num(documentado.valor) : 0, tipo: 'moeda' },
                { label: 'F9 (Meia Nota)', valor: f9 ? num(f9.valor) : 0, tipo: 'moeda' },
                { label: '% em F9', valor: total && f9 ? (num(f9.valor) / total) * 100 : 0, tipo: 'percentual' }
            ],
            colunas: [
                { chave: 'classificacao', label: 'Classificação', tipo: 'badge' },
                { chave: 'titulos', label: 'Títulos', tipo: 'numero' },
                { chave: 'clientes', label: 'Clientes', tipo: 'numero' },
                { chave: 'participacao', label: 'Participação', tipo: 'percentual' },
                { chave: 'valor', label: 'Valor', tipo: 'moeda' }
            ],
            linhas,
            totais: [{ label: 'Total faturado', valor: total, tipo: 'moeda', destaque: true }],
            vazio: 'Nenhum título faturado no período.'
        };
    });

    const CATALOGO = [
        {
            id: 'realizado', nome: 'Faturamento Realizado', icone: 'fa-file-invoice-dollar', cor: 'blue',
            relatorios: [
                { id: 'faturamento-por-periodo', nome: 'Faturamento por Período', desc: 'Notas e tributos por data de emissão.', icone: 'fa-calendar-days', filtros: ['periodo', 'granularidade', 'operacao', 'situacao', 'vendedor', 'nota', 'cliente_texto', 'cnpj', 'uf', 'cfop', 'valor'] },
                { id: 'faturamento-por-cliente', nome: 'Faturamento por Cliente', desc: 'Ranking de quem mais foi faturado e a participação de cada um.', icone: 'fa-users', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] },
                { id: 'notas-fiscais-faturadas', nome: 'Notas Fiscais Faturadas', desc: 'Uma linha por nota, com parcelas, recebido e saldo.', icone: 'fa-receipt', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] },
                { id: 'faturamento-por-vendedor', nome: 'Faturamento por Vendedor', desc: 'Quanto cada vendedor faturou no período.', icone: 'fa-user-tie', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] }
            ]
        },
        {
            id: 'recebimento', nome: 'Recebimento do Faturado', icone: 'fa-hand-holding-dollar', cor: 'teal',
            relatorios: [
                { id: 'situacao-do-faturado', nome: 'Situação do Faturado', desc: 'Destino de cada nota: carteira, operado, jurídico, cancelada.', icone: 'fa-chart-pie', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] },
                { id: 'inadimplencia-por-cliente', nome: 'Inadimplência por Cliente', desc: 'Vencido e em aberto por cliente, com faixa de atraso.', icone: 'fa-triangle-exclamation', filtros: ['vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] }
            ]
        },
        {
            id: 'notas', nome: 'Relação de Notas', icone: 'fa-file-lines', cor: 'amber',
            relatorios: [
                { id: 'notas-emitidas', nome: 'Notas Emitidas', desc: 'Relação das notas emitidas, uma linha por nota.', icone: 'fa-file-export', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] },
                { id: 'notas-recebidas', nome: 'Notas Recebidas', desc: 'NF-e, CT-e e NFS-e recebidas de terceiros.', icone: 'fa-file-import', filtros: ['periodo', 'especie', 'nota', 'emitente', 'cnpj', 'situacao_titulo', 'valor'] },
                { id: 'notas-canceladas', nome: 'Notas Canceladas', desc: 'Notas com título cancelado, total ou parcialmente.', icone: 'fa-file-circle-xmark', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'tipo_documento', 'cnpj', 'valor'] },
                { id: 'notas-por-documentacao', nome: 'Notas por Documentação', desc: 'Quanto tem número de nota real e quanto está como F9 (meia nota).', icone: 'fa-file-circle-question', filtros: ['periodo', 'vendedor', 'cliente', 'nota', 'situacao_titulo', 'tipo_documento', 'cnpj', 'valor'] }
            ]
        },
        {
            id: 'pipeline', nome: 'A Faturar', icone: 'fa-clock', cor: 'purple',
            relatorios: [
                { id: 'pedidos-a-faturar', nome: 'Pedidos a Faturar', desc: 'Carteira aprovada que ainda não virou nota, e há quantos dias espera.', icone: 'fa-cart-flatbed', filtros: ['vendedor', 'cliente', 'status_pedido', 'pedido', 'valor', 'dias'] }
            ]
        }
    ];

    // Vendedores que aparecem em título faturado. Sai da própria `contas_receber`
    // (e não de `usuarios`) porque é lá que o nome do vendedor do faturamento vive.
    router.get('/vendedores', authenticateToken, autorizar, async (req, res) => {
        try {
            if (String(req.query.origem || '') === 'pedidos') {
                const [linhas] = await pool.query(`
                    SELECT TRIM(vendedor_nome) AS nome, COUNT(*) AS pedidos
                      FROM pedidos
                     WHERE data_faturamento IS NULL AND TRIM(COALESCE(vendedor_nome,'')) <> ''
                       AND LOWER(COALESCE(status,'')) NOT IN ('excluido','excluído','cancelado','cancelada','orcamento','orçamento','rascunho')
                     GROUP BY TRIM(vendedor_nome) ORDER BY nome`);
                return res.json({ ok: true, vendedores: linhas });
            }
            const [linhas] = await pool.query(`
                SELECT TRIM(vendedor) AS nome,
                       COUNT(DISTINCT nota_fiscal) AS notas
                  FROM ${FATURADO} ${NAO_CANCELADA}
                   AND TRIM(COALESCE(vendedor,'')) <> ''
                 GROUP BY TRIM(vendedor)
                 ORDER BY nome`);
            res.json({ ok: true, vendedores: linhas });
        } catch (err) {
            console.error('[FAT/RELATORIOS] vendedores:', err.message);
            res.json({ ok: true, vendedores: [] });
        }
    });

    // Clientes faturados. Com `?vendedor=` devolve SÓ os daquele vendedor — é a
    // cascata pedida: escolher o vendedor deve reduzir a lista de clientes à
    // carteira dele, em vez de oferecer a base inteira.
    router.get('/clientes', authenticateToken, autorizar, async (req, res) => {
        try {
            if (String(req.query.origem || '') === 'pedidos') {
                const params = [];
                const vendedor = String(req.query.vendedor || '').trim();
                const fv = vendedor ? " AND TRIM(COALESCE(vendedor_nome,'')) = ?" : '';
                if (vendedor) params.push(vendedor);
                const [linhas] = await pool.query(`
                    SELECT TRIM(cliente_nome) AS nome, COUNT(*) AS pedidos
                      FROM pedidos
                     WHERE data_faturamento IS NULL AND TRIM(COALESCE(cliente_nome,'')) <> ''
                       AND LOWER(COALESCE(status,'')) NOT IN ('excluido','excluído','cancelado','cancelada','orcamento','orçamento','rascunho')${fv}
                     GROUP BY TRIM(cliente_nome) ORDER BY nome`, params);
                return res.json({ ok: true, clientes: linhas });
            }
            const params = [];
            const fv = filtroVendedor(req, params);
            const [linhas] = await pool.query(`
                SELECT TRIM(cliente_nome) AS nome,
                       COUNT(DISTINCT nota_fiscal) AS notas
                  FROM ${FATURADO} ${NAO_CANCELADA}
                   AND TRIM(COALESCE(cliente_nome,'')) <> ''${fv}
                 GROUP BY TRIM(cliente_nome)
                 ORDER BY nome`, params);
            res.json({ ok: true, clientes: linhas });
        } catch (err) {
            console.error('[FAT/RELATORIOS] clientes:', err.message);
            res.json({ ok: true, clientes: [] });
        }
    });

    // Opções reais da carteira ainda não faturada. Não fixa nomes de status no navegador:
    // cada instância pode ter etapas próprias e o filtro precisa refletir exatamente a base.
    router.get('/status-pedidos', authenticateToken, autorizar, async (req, res) => {
        try {
            const [linhas] = await pool.query(`
                SELECT TRIM(status) AS nome, COUNT(*) AS pedidos
                  FROM pedidos
                 WHERE data_faturamento IS NULL
                   AND TRIM(COALESCE(status,'')) <> ''
                   AND LOWER(status) NOT IN ('excluido','excluído','cancelado','cancelada','orcamento','orçamento','rascunho')
                 GROUP BY TRIM(status) ORDER BY nome`);
            res.json({ ok: true, status: linhas });
        } catch (err) {
            console.error('[FAT/RELATORIOS] status-pedidos:', err.message);
            res.json({ ok: true, status: [] });
        }
    });

    router.get('/operacoes', authenticateToken, autorizar, async (_req, res) => {
        try {
            const [linhas] = await pool.query(`SELECT TRIM(natureza_operacao) nome, COUNT(*) notas FROM nfes
                WHERE TRIM(COALESCE(natureza_operacao,''))<>'' GROUP BY TRIM(natureza_operacao) ORDER BY nome`);
            res.json({ ok: true, operacoes: linhas });
        } catch (err) { res.json({ ok: true, operacoes: [] }); }
    });

    router.get('/situacoes', authenticateToken, autorizar, async (_req, res) => {
        try {
            const [linhas] = await pool.query(`SELECT TRIM(status) nome, COUNT(*) notas FROM nfes
                WHERE TRIM(COALESCE(status,''))<>'' GROUP BY TRIM(status) ORDER BY nome`);
            res.json({ ok: true, situacoes: linhas });
        } catch (err) { res.json({ ok: true, situacoes: [] }); }
    });

    router.get('/', authenticateToken, autorizar, (req, res) => {
        res.json({ ok: true, categorias: CATALOGO });
    });

    router.get('/:id', authenticateToken, autorizar, async (req, res) => {
        const handler = REGISTRO[req.params.id];
        if (!handler) return res.status(404).json({ ok: false, message: 'Relatório não encontrado.' });
        try {
            const dados = await handler(req);
            res.json({ ok: true, gerado_em: new Date().toISOString(), ...dados });
        } catch (err) {
            console.error(`[FATURAMENTO/RELATORIOS] ${req.params.id}:`, err.message);
            res.status(500).json({ ok: false, message: 'Falha ao gerar o relatório.', detalhe: err.message });
        }
    });

    return router;
};
