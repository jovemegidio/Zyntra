/*
 * Esteira de faturamento do módulo Faturamento.
 *
 * Lista os pedidos parados em "Aguardando Faturamento" / "Faturar" e permite
 * faturá-los sem passar pelo Kanban de Vendas. O fluxo de faturamento é o mesmo
 * de Vendas (modules/Vendas/public/js/vendas-audit-fixes.js): escolha do tipo
 * (Normal / Meia Nota) -> conferência do ESPELHO da NF-e -> envio ao SEFAZ.
 * Reaproveita os mesmos endpoints já homologados de /api/vendas para não criar
 * um segundo caminho de emissão fiscal.
 */
(function () {
    'use strict';

    var MODAL_ID = 'modal-escolha-faturamento-fat';
    var ctxFaturamento = null;   // { id, valor, cliente, tipo, pct } do pedido em foco
    var pedidosCache = [];
    var carregando = false;
    var paginaPedidos = 1;
    var LIMITE_PAGINA = 15;

    // ── Utilitários ────────────────────────────────────────────
    function notify(msg, type) {
        if (typeof window._fat_toast === 'function') return window._fat_toast(msg, type);
        if (typeof window.showNotification === 'function') return window.showNotification(msg, type);
        if (type === 'error' || type === 'warning') { window.alert(msg); return; }
        return undefined;
    }

    function moeda(valor) {
        var n = parseFloat(valor) || 0;
        return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function data(valor) {
        if (!valor) return '-';
        // "AAAA-MM-DD" (DATE) é lido como meia-noite LOCAL: new Date() o trataria como UTC
        // e a previsão de 30/09 apareceria como 29/09 no fuso de Brasília.
        var s = String(valor);
        var d = /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10 ? new Date(s + 'T00:00:00') : new Date(valor);
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
    }

    // Escapa antes de interpolar em innerHTML — nome de cliente é dado do usuário.
    function esc(txt) {
        return String(txt == null ? '' : txt).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── Faixa de status da SEFAZ (rejeitada/autorizada/processando) ─────────────
    // Lê o retorno já gravado em `nfes` (sefaz_motivo, sefaz_codigo_status) — o mesmo
    // dado que a emissão grava na hora, de forma síncrona (ver services/nfe-emitter.service.js).
    // Não existe atraso de minutos/horas no back-end; o que faltava era exibir esse dado aqui.
    var BADGE_STATUS_CFG = {
        rejeitada: { bg: '#fef2f2', cor: '#991b1b', borda: '#fecaca', icone: 'fa-circle-xmark' },
        autorizada: { bg: '#f0fdf4', cor: '#166534', borda: '#bbf7d0', icone: 'fa-circle-check' },
        cancelada: { bg: '#f3f4f6', cor: '#374151', borda: '#d1d5db', icone: 'fa-ban' },
        processando: { bg: '#fffbeb', cor: '#92400e', borda: '#fde68a', icone: 'fa-hourglass-half' }
    };

    function renderBadgeStatus(nfe) {
        var modal = document.getElementById(MODAL_ID);
        var el = modal && modal.querySelector('#fat-status-badge');
        if (!el) return;
        var status = String((nfe && nfe.status) || '').trim().toLowerCase();
        var cfg = BADGE_STATUS_CFG[status];
        if (!nfe || !cfg) { el.style.display = 'none'; el.innerHTML = ''; return; }

        var texto;
        if (status === 'rejeitada') {
            texto = 'Rejeitada pela SEFAZ'
                + (nfe.sefaz_codigo_status ? ' (código ' + esc(nfe.sefaz_codigo_status) + ')' : '')
                + ': ' + esc(nfe.sefaz_motivo || 'motivo não informado pela SEFAZ.');
        } else if (status === 'autorizada') {
            texto = 'Autorizada pela SEFAZ'
                + (nfe.numero ? ' — NF nº ' + esc(nfe.numero) : '')
                + (nfe.protocolo_autorizacao ? ' • protocolo ' + esc(nfe.protocolo_autorizacao) : '');
        } else if (status === 'cancelada') {
            texto = 'NF-e cancelada.';
        } else {
            texto = 'Envio em processamento — aguardando retorno da SEFAZ.';
        }

        el.style.display = 'block';
        el.style.background = cfg.bg;
        el.style.color = cfg.cor;
        el.style.borderBottom = '1px solid ' + cfg.borda;
        el.innerHTML = '<i class="fas ' + cfg.icone + '"></i>&nbsp; ' + texto;
    }

    // Busca o status atual da NF-e avulsa/rascunho e atualiza a faixa. Exposta em `window`
    // porque `enviarSEFAZ` (index.html.inline.js) roda em outro arquivo e precisa refletir
    // o resultado do envio no modal assim que a SEFAZ responde, sem esperar o operador
    // fechar e reabrir nada.
    window.atualizarBadgeRascunhoFaturamento = function (nfeId) {
        if (!ctxFaturamento || String(ctxFaturamento.nfeId) !== String(nfeId)) return;
        fetch('/api/faturamento/nfes/' + encodeURIComponent(nfeId), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (j) { renderBadgeStatus(j && j.data); })
            .catch(function () { /* mantém a faixa como estava — sem dado novo, sem regressão */ });
    };

    function statusInfo(status) {
        var s = String(status || '').trim().toLowerCase();
        if (s === 'faturar') return { classe: 'processando', label: 'Faturar' };
        return { classe: 'pendente', label: 'Aguardando Faturamento' };
    }

    function encontrarPedido(id) {
        return pedidosCache.find(function (p) { return String(p.id) === String(id); }) || null;
    }

    // ── Carregamento da lista ──────────────────────────────────
    function carregarPedidos() {
        var tbody = document.getElementById('pedidosFaturarList');
        if (!tbody || carregando) return;
        carregando = true;
        paginaPedidos = 1;

        var filtro = document.getElementById('filtroPedidoStatus');
        var status = filtro ? filtro.value : '';
        var url = '/api/faturamento/pedidos-para-faturar' + (status ? '?status=' + encodeURIComponent(status) : '');

        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando pedidos...</p></div></td></tr>';

        fetch(url, { credentials: 'include' })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
            })
            .then(function (r) {
                carregando = false;
                if (!r.ok || !r.data || r.data.success === false) {
                    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Não foi possível carregar</h3><p>' + esc((r.data && r.data.message) || ('HTTP ' + r.status)) + '</p></div></td></tr>';
                    atualizarContador(0, 0, false);
                    return;
                }
                pedidosCache = r.data.data || [];
                popularVendedores();
                renderizar();
                atualizarContador(pedidosCache.length, r.data.total || pedidosCache.length, !!r.data.truncado);
            })
            .catch(function (err) {
                carregando = false;
                console.error('[faturamento/pedidos] erro ao carregar:', err);
                tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Erro de conexão</h3><p>Não foi possível carregar os pedidos.</p></div></td></tr>';
                atualizarContador(0, 0, false);
            });
    }

    function atualizarContador(exibidos, total, truncado) {
        var badge = document.getElementById('pedidosFaturarCount');
        if (!badge) return;
        badge.textContent = truncado ? (exibidos + ' de ' + total) : String(total);
        badge.title = truncado
            ? 'Exibindo os ' + exibidos + ' pedidos mais recentes de um total de ' + total + '. Use o filtro de status para reduzir a lista.'
            : total + ' pedido(s) aguardando faturamento';
    }

    // ── Organização da fila (abas por etapa, vendedor, ordenação, espera) ─────
    // Tudo no cliente: a API já devolve a esteira inteira (limite de 500 pedidos).
    var etapaSel = '';
    var DIA = 24 * 60 * 60 * 1000;
    function hoje0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    function dataLocal(v) {
        if (!v) return null;
        var s = String(v).slice(0, 10);
        var d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    // Espera do pedido: com Previsão de Faturamento, conta a partir dela (atrasado se já
    // passou); sem previsão, conta desde a criação do pedido.
    function espera(p) {
        var prev = dataLocal(p.previsao_faturamento || p.data_previsao);
        var h = hoje0();
        if (prev) {
            var dif = Math.round((prev - h) / DIA);
            if (dif < 0) return { classe: 'atraso', texto: 'atrasado ' + (-dif) + (dif === -1 ? ' dia' : ' dias'), atrasado: true, dias: -dif, ref: prev };
            return { classe: dif <= 2 ? 'atencao' : 'ok', texto: dif === 0 ? 'previsto para hoje' : 'previsto em ' + dif + (dif === 1 ? ' dia' : ' dias'), atrasado: false, dias: 0, ref: prev };
        }
        var criado = dataLocal(p.created_at);
        var dias = criado ? Math.max(0, Math.round((h - new Date(criado.getFullYear(), criado.getMonth(), criado.getDate())) / DIA)) : 0;
        return { classe: dias > 30 ? 'atraso' : dias > 7 ? 'atencao' : 'ok', texto: 'há ' + dias + (dias === 1 ? ' dia' : ' dias'), atrasado: dias > 30, dias: dias, ref: criado };
    }
    function ehAguardando(p) { return String(p.status || '').trim().toLowerCase() !== 'faturar'; }

    function filtroBase() {
        var campo = document.getElementById('filtroPedidoBusca');
        var q = campo ? campo.value.trim().toLowerCase() : '';
        var vend = (document.getElementById('pfVendedor') || {}).value || '';
        return pedidosCache.filter(function (p) {
            if (vend && (p.vendedor || '(sem vendedor)') !== vend) return false;
            if (!q) return true;
            return [p.id, p.numero_pedido, p.cliente, p.vendedor, p.transportadora].join(' ').toLowerCase().indexOf(q) !== -1;
        });
    }

    // Filtro textual + etapa + vendedor, já ordenado.
    function pedidosFiltrados() {
        var lista = filtroBase().filter(function (p) {
            if (etapaSel === 'faturar') return !ehAguardando(p);
            if (etapaSel === 'aguardando-faturamento') return ehAguardando(p);
            if (etapaSel === 'atrasados') return espera(p).atrasado;
            return true;
        });
        var ordem = (document.getElementById('pfOrdem') || {}).value || 'fila';
        var chave = function (p) { var e = espera(p); return e.ref ? e.ref.getTime() : Infinity; };
        lista.sort(function (a, b) {
            if (ordem === 'valor') return (Number(b.valor) || 0) - (Number(a.valor) || 0);
            if (ordem === 'cliente') return String(a.cliente || '').localeCompare(String(b.cliente || ''), 'pt-BR');
            if (ordem === 'recentes') return (dataLocal(b.created_at) || 0) - (dataLocal(a.created_at) || 0);
            // Fila: atrasados primeiro, depois pela data de referência mais antiga.
            var ea = espera(a), eb = espera(b);
            if (ea.atrasado !== eb.atrasado) return ea.atrasado ? -1 : 1;
            return chave(a) - chave(b);
        });
        return lista;
    }

    function renderAbas() {
        var box = document.getElementById('pfAbas');
        if (!box) return;
        var base = filtroBase();
        var n = {
            '': base.length,
            'aguardando-faturamento': base.filter(ehAguardando).length,
            'faturar': base.filter(function (p) { return !ehAguardando(p); }).length,
            'atrasados': base.filter(function (p) { return espera(p).atrasado; }).length
        };
        var abas = [['', 'Todos'], ['aguardando-faturamento', 'Aguardando Faturamento'], ['faturar', 'Faturar'], ['atrasados', 'Atrasados']];
        box.innerHTML = abas.map(function (a) {
            return '<button type="button" role="tab" class="pf-aba' + (a[0] === 'atrasados' ? ' atrasados' : '') + '" data-pf-aba="' + a[0] + '" aria-selected="' + (etapaSel === a[0]) + '">'
                + (a[0] === 'atrasados' ? '<i class="fas fa-exclamation-circle"></i> ' : '') + a[1] + ' <span class="n">' + n[a[0]] + '</span></button>';
        }).join('');
    }

    function renderResumo(lista) {
        var box = document.getElementById('pfResumo');
        if (!box) return;
        var total = lista.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
        var atrasados = lista.filter(function (p) { return espera(p).atrasado; }).length;
        box.innerHTML = '<span><strong>' + lista.length + '</strong> pedido(s)</span>'
            + '<span>Total <strong>' + moeda(total) + '</strong></span>'
            + (atrasados ? '<span style="color:#b91c1c"><strong>' + atrasados + '</strong> atrasado(s)</span>' : '');
    }

    function popularVendedores() {
        var sel = document.getElementById('pfVendedor');
        if (!sel) return;
        var atual = sel.value;
        var nomes = {};
        pedidosCache.forEach(function (p) { var v = p.vendedor || '(sem vendedor)'; nomes[v] = (nomes[v] || 0) + 1; });
        sel.innerHTML = '<option value="">Todos os vendedores</option>' + Object.keys(nomes).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); })
            .map(function (v) { return '<option value="' + esc(v) + '"' + (v === atual ? ' selected' : '') + '>' + esc(v) + ' (' + nomes[v] + ')</option>'; }).join('');
    }

    function renderizar() {
        var tbody = document.getElementById('pedidosFaturarList');
        if (!tbody) return;
        var lista = pedidosFiltrados();
        renderAbas();
        renderResumo(lista);

        if (!lista.length) {
            var campo = document.getElementById('filtroPedidoBusca');
            var temBusca = (campo && campo.value.trim()) || etapaSel || ((document.getElementById('pfVendedor') || {}).value);
            tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-check-circle"></i><h3>'
                + (temBusca ? 'Nenhum pedido corresponde aos filtros' : 'Nenhum pedido aguardando faturamento')
                + '</h3><p>' + (temBusca ? 'Ajuste a busca, a aba de etapa ou o vendedor.' :'Os pedidos aprovados em Vendas aparecem aqui quando entram na etapa de faturamento.') + '</p></div></td></tr>';
            atualizarPaginacao(0);
            return;
        }

        var totalPaginas = Math.max(1, Math.ceil(lista.length / LIMITE_PAGINA));
        paginaPedidos = Math.min(Math.max(paginaPedidos, 1), totalPaginas);
        var inicio = (paginaPedidos - 1) * LIMITE_PAGINA;
        var pagina = lista.slice(inicio, inicio + LIMITE_PAGINA);

        tbody.innerHTML = pagina.map(function (p) {
            var st = statusInfo(p.status);
            var ident = p.numero_pedido ? esc(p.numero_pedido) : ('#' + p.id);
            var e = espera(p);
            var sub = [p.condicao_pagamento, p.transportadora].filter(Boolean).map(esc).join(' · ');
            return ''
                + '<tr class="' + (ehAguardando(p) ? 'pf-etapa-aguardando' : 'pf-etapa-faturar') + '">'
                + '  <td><span class="code">' + ident + '</span></td>'
                + '  <td>' + esc(p.cliente || '-') + (sub ? '<span class="pf-sub">' + sub + '</span>' : '') + '</td>'
                + '  <td>' + esc(p.vendedor || '-') + '</td>'
                + '  <td><strong>' + moeda(p.valor) + '</strong></td>'
                + '  <td>' + (p.total_itens || 0) + '</td>'
                + '  <td>' + ((p.previsao_faturamento || p.data_previsao) ? '<span title="Previsão de faturamento">' + data(p.previsao_faturamento || p.data_previsao) + '</span>' : '<span class="pf-sub" title="Sem previsão de faturamento no pedido">criado ' + data(p.created_at) + '</span>')
                + '<br><span class="pf-espera ' + e.classe + '">' + e.texto + '</span></td>'
                + '  <td><span class="badge ' + st.classe + '">' + st.label + '</span></td>'
                + '  <td>'
                + '    <div style="display:flex;gap:6px;align-items:center;">'
                + '      <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" data-faturar="' + p.id + '" title="Faturar o pedido ' + ident + '"><i class="fas fa-file-invoice-dollar"></i> Faturar</button>'
                // Ficha do pedido: o que o VENDEDOR preencheu (observacao, parcelas,
                // condicao). O olho ao lado mostra a NF-e; sao coisas diferentes.
                + '      <button class="action-btn view" data-ficha="' + p.id + '" title="Ver pedido/orcamento preenchido " aria-label="Ver pedido "><i class="fas fa-clipboard-list"></i></button>'
                + '      <button class="action-btn view" data-espelho="' + p.id + '" title="Ver espelho da NF-e do pedido ' + ident + '" aria-label="Ver espelho da NF-e do pedido ' + ident + '"><i class="fas fa-eye"></i></button>'
                + '      <button class="action-btn success" data-etiqueta="' + p.id + '" title="Imprimir etiqueta de expedição do pedido ' + ident + '" aria-label="Imprimir etiqueta de expedição do pedido ' + ident + '"><i class="fas fa-tag"></i></button>'
                + '      <button class="action-btn" data-calculadora="' + p.id + '" title="Calculadora de impostos do pedido ' + ident + '" aria-label="Calculadora de impostos do pedido ' + ident + '"><i class="fas fa-calculator"></i></button>'
                + '    </div>'
                + '  </td>'
                + '</tr>';
        }).join('');
        atualizarPaginacao(lista.length);
    }

    function atualizarPaginacao(total) {
        var rodape = document.getElementById('pedidosFaturarPaginacao');
        var info = document.getElementById('pedidosFaturarPaginacaoInfo');
        var anterior = document.getElementById('pedidosFaturarAnterior');
        var proxima = document.getElementById('pedidosFaturarProxima');
        if (!rodape || !info || !anterior || !proxima) return;
        if (!total) {
            rodape.style.display = 'none';
            return;
        }
        var totalPaginas = Math.max(1, Math.ceil(total / LIMITE_PAGINA));
        var primeiro = (paginaPedidos - 1) * LIMITE_PAGINA + 1;
        var ultimo = Math.min(paginaPedidos * LIMITE_PAGINA, total);
        rodape.style.display = 'flex';
        info.textContent = 'Mostrando ' + primeiro + '–' + ultimo + ' de ' + total.toLocaleString('pt-BR')
            + ' · Página ' + paginaPedidos + ' de ' + totalPaginas;
        anterior.disabled = paginaPedidos <= 1;
        proxima.disabled = paginaPedidos >= totalPaginas;
    }

    function alterarPagina(delta) {
        var total = pedidosFiltrados().length;
        var totalPaginas = Math.max(1, Math.ceil(total / LIMITE_PAGINA));
        var novaPagina = paginaPedidos + Number(delta || 0);
        if (novaPagina < 1 || novaPagina > totalPaginas) return;
        paginaPedidos = novaPagina;
        renderizar();
        var tabela = document.getElementById('pedidosFaturarList');
        if (tabela && tabela.closest('.card')) tabela.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ── Modal de faturamento (mesmo fluxo do Kanban de Vendas) ──
    function show(modal) { modal.classList.add('active'); modal.style.display = 'flex'; modal.style.pointerEvents = 'auto'; }
    function hide(modal) { modal.classList.remove('active'); modal.style.display = 'none'; }

    function fecharModal() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) hide(modal);
        ctxFaturamento = null;
    }

    // Compacto nos passos de escolha; tela cheia no espelho (o DANFE precisa de espaço).
    function redimensionarModal(expandido) {
        var content = document.getElementById('fat-modal-content');
        if (!content) return;
        if (expandido) {
            content.style.maxWidth = 'none'; content.style.width = 'calc(100vw - 32px)';
            content.style.maxHeight = 'none'; content.style.height = 'calc(100dvh - 32px)';
            content.style.borderRadius = '12px';
        } else {
            content.style.maxWidth = '560px'; content.style.width = '95%';
            content.style.maxHeight = '92vh'; content.style.height = '';
            content.style.borderRadius = '16px';
        }
    }

    function mostrarPasso(passo) {
        var p1 = document.getElementById('fat-passo-escolha');
        var p2 = document.getElementById('fat-passo-meianota');
        var p3 = document.getElementById('fat-passo-espelho');
        if (p1) p1.style.display = passo === 2 ? 'none' : 'block';
        if (p2) p2.style.display = passo === 2 ? 'block' : 'none';
        if (p3) p3.style.display = 'none';
        redimensionarModal(false);
    }

    function setFooterMode(mode) {
        var modal = document.getElementById(MODAL_ID);
        if (!modal) return;
        var show_ = function (sel, on) { var el = modal.querySelector(sel); if (el) el.style.display = on ? '' : 'none'; };
        show_('#fat-btn-confirmar-meianota', mode === 'meianota');
        show_('#fat-btn-conferir', mode === 'espelho' && !(ctxFaturamento && ctxFaturamento.avulsa));
        show_('#fat-btn-espelho-aba', mode === 'espelho');
        show_('#fat-btn-editar', mode === 'espelho');
        show_('#fat-btn-reemitir', mode === 'espelho');
        show_('#fat-btn-enviar-sefaz', mode === 'espelho');
    }

    function setBusy(busy) {
        var modal = document.getElementById(MODAL_ID);
        if (!modal) return;
        modal.querySelectorAll('button').forEach(function (b) { b.disabled = !!busy; });
        modal.style.cursor = busy ? 'progress' : '';
    }

    function atualizarValorMeiaNota() {
        var input = document.getElementById('fat-pct-input');
        var saida = document.getElementById('fat-valor-parcial');
        if (!input || !saida || !ctxFaturamento) return;
        var pct = parseFloat(input.value) || 0;
        saida.textContent = moeda((parseFloat(ctxFaturamento.valor) || 0) * pct / 100);
    }

    function serializarItensParciais(itens) {
        return (itens || []).map(function (item) {
            return Number(item.produto_id) + ':' + Number(item.quantidade);
        }).join(',');
    }

    function espelhoUrl(id, tipo, pct, itens) {
        var qs = 'tipo=' + encodeURIComponent(tipo || 'normal');
        if (tipo === 'parcial') qs += '&pct=' + encodeURIComponent(pct || 50);
        if (tipo === 'itens' && itens && itens.length) {
            qs += '&itens=' + encodeURIComponent(serializarItensParciais(itens));
        }
        qs += '&_t=' + Date.now();
        return '/api/vendas/pedidos/' + encodeURIComponent(id) + '/espelho-nfe?' + qs;
    }

    function carregarEspelho() {
        var iframe = document.getElementById('fat-espelho-iframe');
        if (!iframe || !ctxFaturamento) return;
        iframe.src = ctxFaturamento.avulsa
            ? '/api/faturamento/nfes/' + encodeURIComponent(ctxFaturamento.nfeId) + '/espelho?_t=' + Date.now()
            : espelhoUrl(ctxFaturamento.id, ctxFaturamento.tipo, ctxFaturamento.pct, ctxFaturamento.itens);
    }

    // ── Conferência antes de emitir (estilo "Conferindo o Pedido" do Omie) ──────────────
    // Junta num só lugar o que já existe: o checklist do Editar NF-e, a prévia do XML
    // (gerada pelo mesmo emissor, com rollback, + schema + cadastro na SEFAZ) e a validade
    // do certificado. Nada é gravado; "Enviar ao SEFAZ" só libera sem bloqueio.
    var CONF_ID = 'fat-conferencia-modal';
    function abrirConferencia(pedidoId) {
        var antigo = document.getElementById(CONF_ID);
        if (antigo) antigo.remove();
        var ov = document.createElement('div');
        ov.id = CONF_ID;
        ov.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
        ov.innerHTML = '<div style="background:#fff;border-radius:14px;width:min(980px,100%);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#f5f3ff;border-bottom:1px solid #e9e5ff;">'
            + '<strong style="color:#5b21b6;font-size:16px;"><i class="fas fa-clipboard-check"></i> Conferindo o Pedido de Venda Nº ' + esc(pedidoId) + '</strong>'
            + '<button type="button" data-conf="fechar" style="background:none;border:none;font-size:14px;color:#5b21b6;cursor:pointer;">Fechar ✕</button></div>'
            + '<div id="conf-corpo" style="overflow:auto;padding:18px 22px;flex:1;"><p style="color:#6b7280;"><i class="fas fa-spinner fa-spin"></i> Gerando a prévia do XML e conferindo o pedido (consulta o cadastro na SEFAZ)…</p></div>'
            + '<div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;padding:12px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;">'
            + '<button type="button" data-conf="refazer" style="margin-right:auto;padding:9px 14px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;"><i class="fas fa-sync-alt"></i> Conferir de novo</button>'
            + '<button type="button" data-conf="danfe" style="padding:9px 14px;border:1px solid #2563eb;background:#fff;color:#1d4ed8;border-radius:8px;cursor:pointer;"><i class="fas fa-search"></i> Ver como vai ficar o DANFE</button>'
            + '<button type="button" data-conf="editar" style="padding:9px 14px;border:1px solid #f59e0b;background:#fff;color:#b45309;border-radius:8px;cursor:pointer;"><i class="fas fa-pen"></i> Corrigir no Editar NF-e</button>'
            + '<button type="button" data-conf="enviar" disabled style="padding:9px 16px;border:none;background:linear-gradient(135deg,#16a34a,#059669);color:#fff;border-radius:8px;cursor:pointer;opacity:.5;"><i class="fas fa-paper-plane"></i> Enviar ao SEFAZ</button>'
            + '</div></div>';
        document.body.appendChild(ov);
        var fechar = function () { ov.remove(); };
        ov.addEventListener('click', function (e) {
            if (e.target === ov) { fechar(); return; }
            var b = e.target.closest('[data-conf],[data-conf-tab]');
            if (!b) return;
            var tab = b.getAttribute('data-conf-tab');
            if (tab) {
                ov.querySelectorAll('[data-conf-tab]').forEach(function (t) { var on = t === b; t.style.borderBottomColor = on ? '#7c3aed' : 'transparent'; t.style.color = on ? '#5b21b6' : '#6b7280'; });
                ov.querySelectorAll('[data-conf-painel]').forEach(function (p) { p.style.display = p.getAttribute('data-conf-painel') === tab ? '' : 'none'; });
                return;
            }
            var acao = b.getAttribute('data-conf');
            if (acao === 'fechar' || acao === 'danfe') fechar();
            if (acao === 'refazer') { fechar(); abrirConferencia(pedidoId); }
            if (acao === 'editar') { fechar(); var be = document.getElementById('fat-btn-editar'); if (be) be.click(); }
            if (acao === 'enviar' && !b.disabled) { fechar(); var bs = document.getElementById('fat-btn-enviar-sefaz'); if (bs) bs.click(); }
        });

        var jsonOuNada = function (url) {
            return fetch(url, { credentials: 'include', cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        };
        var htmlOuNada = function (url) {
            return fetch(url, { credentials: 'include', cache: 'no-store' })
                .then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; });
        };
        var base = '/api/vendas/pedidos/' + encodeURIComponent(pedidoId);
        Promise.all([
            jsonOuNada(base + '/validar-xml?sefaz=1'),
            htmlOuNada(base + '/espelho-nfe-edit'),
            jsonOuNada('/api/faturamento/configuracao/certificado/validade')
        ]).then(function (res) {
            if (!document.body.contains(ov)) return;
            renderConferencia(ov, res[0], res[1], res[2]);
        });
    }

    function renderConferencia(ov, vx, htmlEdit, cert) {
        var corpo = ov.querySelector('#conf-corpo');
        var grupos = { empresa: [], certificado: [], cliente: [], itens: [], transporte: [], impostos: [], totais: [], parcelas: [] };
        var add = function (g, nivel, texto) { grupos[g].push({ nivel: nivel, texto: texto }); };

        // 1) Checklist do Editar NF-e (as mesmas regras que a SEFAZ rejeita).
        if (htmlEdit) {
            var doc = new DOMParser().parseFromString(htmlEdit, 'text/html');
            doc.querySelectorAll('#checklist-emissao li').forEach(function (li) {
                var ir = li.querySelector('[data-ir-aba]');
                var aba = ir ? ir.getAttribute('data-ir-aba') : '';
                var g = { dados: 'cliente', itens: 'itens', transporte: 'transporte', impostos: 'impostos' }[aba] || 'impostos';
                var t = li.querySelector('.tx') || li;
                add(g, li.classList.contains('bloqueia') ? 'bloqueia' : 'atencao', (t.textContent || '').replace(/\s+/g, ' ').trim());
            });
        } else add('impostos', 'atencao', 'Não foi possível carregar o checklist do Editar NF-e.');

        // 2) Prévia do XML: gerada pelo emissor real, validada no schema e no cadastro SEFAZ.
        var r = (vx && vx.resumo) || null;
        if (!vx) add('impostos', 'bloqueia', 'Não foi possível gerar a prévia do XML. Tente "Conferir de novo".');
        else {
            if (vx.semCertificado) add('certificado', 'bloqueia', 'Certificado digital não carregado neste servidor.');
            (vx.erros || []).forEach(function (e) {
                var et = String(e.etapa || '');
                var msg = String(e.mensagem || '');
                var g = /cadastro/.test(et) ? 'cliente' : /transporte/.test(et) ? 'transporte' : /itens/.test(et) ? 'itens'
                    : /emitente/i.test(msg) ? 'empresa' : 'impostos';
                if (e.codigo === 'ESPELHO_FISCAL_DIVERGENTE') msg = 'Os impostos gravados no pedido não batem com o cálculo dos itens — use "Recalcular pelos itens" no Editar NF-e.' + msg.replace(/^[^:]*:/, '');
                add(g, 'bloqueia', msg);
            });
            (vx.avisos || []).forEach(function (a) { add(/certificado/i.test(a) ? 'certificado' : 'impostos', 'atencao', String(a)); });
            if (r) (r.conferencia || []).forEach(function (c) { add(c.campo === 'parcelas' ? 'parcelas' : 'totais', 'bloqueia', c.mensagem); });
            if (r) (r.tributos || []).forEach(function (c) { add('impostos', c.nivel, c.texto); });
        }
        // 3) Certificado.
        if (cert && cert.success !== false) {
            var dias = cert.diasRestantes != null ? cert.diasRestantes : cert.dias_restantes;
            var venc = cert.validade || cert.dataValidade || cert.validTo || cert.notAfter;
            if (cert.valido === false || cert.expirado === true || (dias != null && Number(dias) < 0))
                add('certificado', 'bloqueia', 'Certificado digital vencido' + (venc ? ' em ' + new Date(venc).toLocaleDateString('pt-BR') : '') + '.');
            else if (dias != null && Number(dias) <= 15) add('certificado', 'atencao', 'Certificado vence em ' + dias + ' dia(s).');
        }

        var nBloq = 0, nAt = 0;
        Object.keys(grupos).forEach(function (k) { grupos[k].forEach(function (i) { if (i.nivel === 'bloqueia') nBloq++; else if (i.nivel === 'atencao') nAt++; }); });
        var secao = function (titulo, g, okTxt) {
            var lista = grupos[g];
            var cor = lista.some(function (i) { return i.nivel === 'bloqueia'; }) ? '#dc2626' : lista.some(function (i) { return i.nivel === 'atencao'; }) ? '#b45309' : '#15803d';
            var h = '<div style="margin:0 0 14px;"><div style="font-size:19px;color:' + cor + ';">' + titulo + '</div>';
            if (!lista.length) h += '<div style="color:#15803d;margin-left:4px;">✓ ' + okTxt + '</div>';
            lista.forEach(function (i) {
                h += '<div style="margin:4px 0 0 4px;color:' + (i.nivel === 'bloqueia' ? '#b91c1c' : i.nivel === 'ok' ? '#15803d' : '#92400e') + ';white-space:pre-line;">' + (i.nivel === 'bloqueia' ? '✖ ' : i.nivel === 'ok' ? '✓ ' : '! ') + esc(i.texto) + '</div>';
            });
            return h + '</div>';
        };
        var m = function (v) { return moeda(Number(v) || 0); };
        var ambiente = r ? (r.tpAmb === '1' ? 'Produção' : r.tpAmb === '2' ? 'Homologação' : '—') : '—';
        var destino = r ? ((r.idDest === '2' ? 'Fora do Estado' : 'Dentro do Estado') + ' (' + esc(r.ufEmit || '') + ' ▸ ' + esc(r.ufDest || '') + ')') : '—';
        var frete = r ? ({ '0': 'Frete por conta do emitente (CIF)', '1': 'Frete por conta do destinatário (FOB)', '2': 'Frete por conta de terceiros', '3': 'Transporte próprio do emitente', '4': 'Transporte próprio do destinatário', '9': 'Sem frete' }[r.modFrete] || 'Frete ' + esc(r.modFrete || '')) : '—';
        var cab = '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">'
            + '<div style="flex:1;min-width:220px;"><div style="font-size:12px;color:#6b7280;">Trata-se de uma venda para o cliente</div><div style="font-size:18px;color:#111827;">' + esc((r && r.xNomeDest) || (ctxFaturamento && ctxFaturamento.cliente) || '') + '</div></div>'
            + '<div style="font-size:13px;color:#374151;line-height:1.7;">Ambiente da NF-e ▸ <strong>' + ambiente + '</strong><br>' + destino
            + '<br>Com ' + (r ? r.nItens : '?') + ' itens ▸ no total de <strong>' + (r ? m(r.vNF) : '—') + '</strong><br>' + frete + '</div></div>';
        var status = nBloq
            ? '<div style="padding:10px 14px;border-radius:10px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;margin-bottom:14px;"><strong>' + nBloq + ' problema(s) impedem a emissão ou geram rejeição/valor errado.</strong> Corrija no Editar NF-e e confira de novo.</div>'
            : '<div style="padding:10px 14px;border-radius:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;margin-bottom:14px;"><strong>Tudo certo para emitir.</strong>' + (nAt ? ' Há ' + nAt + ' aviso(s) para conferir.' : '') + '</div>';
        var tabs = '<div style="display:flex;gap:4px;border-bottom:1px solid #e5e7eb;margin-bottom:14px;">'
            + ['Resultados', 'Impostos por item', 'Totais', 'Parcelas'].map(function (t, i) {
                return '<button type="button" data-conf-tab="' + t + '" style="padding:8px 14px;border:none;border-bottom:2px solid ' + (i ? 'transparent' : '#7c3aed') + ';background:none;cursor:pointer;color:' + (i ? '#6b7280' : '#5b21b6') + ';">' + t + '</button>';
            }).join('') + '</div>';
        var resultados = secao('Dados da Minha Empresa', 'empresa', 'OK') + secao('Certificado Digital', 'certificado', 'Está OK e dentro da validade')
            + secao('Informações do Cliente', 'cliente', 'Tudo certo') + secao('Itens do Pedido de Venda', 'itens', 'OK')
            + secao('Transporte', 'transporte', 'OK') + secao('CFOPs, Impostos e "Demais Complicações"', 'impostos', 'Sem problemas')
            + secao('Totais (nota × pedido)', 'totais', 'Batem com o pedido') + secao('Parcelas', 'parcelas', 'OK');
        var linhaT = function (rot, v) { return '<tr><td style="padding:6px 10px;color:#374151;">' + rot + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;">' + m(v) + '</td></tr>'; };
        var totais = r ? '<table style="width:100%;max-width:520px;border-collapse:collapse;font-size:14px;">'
            + linhaT('Produtos', r.vProd) + linhaT('Desconto', r.vDesc) + linhaT('Frete', r.vFrete) + linhaT('Seguro', r.vSeg) + linhaT('Outras despesas', r.vOutro)
            + linhaT('Base ICMS', r.vBC) + linhaT('ICMS', r.vICMS) + linhaT('Base ICMS-ST', r.vBCST) + linhaT('ICMS-ST', r.vST) + linhaT('FCP-ST', r.vFCPST)
            + linhaT('IPI', r.vIPI) + linhaT('PIS', r.vPIS) + linhaT('COFINS', r.vCOFINS) + linhaT('DIFAL (UF destino)', r.vICMSUFDest)
            + '<tr style="border-top:2px solid #111827;font-weight:700;"><td style="padding:8px 10px;">Total da NF-e</td><td style="padding:8px 10px;text-align:right;">' + m(r.vNF) + '</td></tr></table>'
            + '<p style="font-size:12px;color:#6b7280;">CFOP: ' + esc((r.cfops || []).join(', ')) + ' · ' + (r.csosn && r.csosn.length ? 'CSOSN ' + esc(r.csosn.join(', ')) : 'CST ' + esc((r.cst || []).join(', '))) + ' · Natureza: ' + esc(r.natOp || '') + '</p>'
            : '<p style="color:#6b7280;">A prévia do XML não foi gerada — veja os problemas em Resultados.</p>';
        var parcelas = r && r.dup && r.dup.length
            ? '<table style="width:100%;max-width:520px;border-collapse:collapse;font-size:14px;"><tr style="color:#6b7280;"><th style="text-align:left;padding:6px 10px;">Parcela</th><th style="text-align:left;padding:6px 10px;">Vencimento</th><th style="text-align:right;padding:6px 10px;">Valor</th></tr>'
              + r.dup.map(function (d) { return '<tr><td style="padding:6px 10px;">' + esc(d.nDup) + '</td><td style="padding:6px 10px;">' + esc(String(d.dVenc || '').split('-').reverse().join('/')) + '</td><td style="padding:6px 10px;text-align:right;">' + m(d.vDup) + '</td></tr>'; }).join('')
              + '</table>'
            : '<p style="color:#6b7280;">A nota sai sem duplicatas (pagamento à vista ou sem parcelas no pedido).</p>';
        var th = function (t) { return '<th style="padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid #e5e7eb;">' + t + '</th>'; };
        var td = function (v, pct) { return '<td style="padding:6px 8px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">' + (pct ? (Number(v) || 0).toLocaleString('pt-BR') + '%' : m(v)) + '</td>'; };
        var impostosItem = r && r.itens && r.itens.length
            ? '<table style="width:100%;border-collapse:collapse;font-size:12.5px;"><tr style="color:#6b7280;background:#f9fafb;"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">Item</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">NCM / CFOP / CST</th>'
              + th('Produtos') + th('Desc.') + th('Base ICMS') + th('% ICMS') + th('ICMS') + th('MVA') + th('Base ST') + th('% ST') + th('ICMS-ST') + th('IPI') + th('PIS') + th('COFINS') + '</tr>'
              + r.itens.map(function (it) {
                  return '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:6px 8px;"><strong>' + esc(it.codigo) + '</strong><div style="color:#6b7280;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(it.descricao || '') + '</div></td>'
                      + '<td style="padding:6px 8px;white-space:nowrap;">' + esc(it.ncm || '') + '<br>' + esc(it.cfop || '') + ' · ' + esc(it.cst || '') + (it.cest ? '<br>CEST ' + esc(it.cest) : '') + '</td>'
                      + td(it.vProd) + td(it.vDesc) + td(it.vBC) + td(it.pICMS, 1) + td(it.vICMS) + td(it.pMVAST, 1) + td(it.vBCST) + td(it.pICMSST, 1) + td(it.vICMSST)
                      + td(it.vIPI) + td(it.vPIS) + td(it.vCOFINS) + '</tr>';
              }).join('') + '</table>'
            : '<p style="color:#6b7280;">A prévia do XML não foi gerada — veja os problemas em Resultados.</p>';
        corpo.innerHTML = cab + tabs + status
            + '<div data-conf-painel="Resultados">' + resultados + '</div>'
            + '<div data-conf-painel="Impostos por item" style="display:none;overflow-x:auto;">' + impostosItem + '</div>'
            + '<div data-conf-painel="Totais" style="display:none;">' + totais + '</div>'
            + '<div data-conf-painel="Parcelas" style="display:none;">' + parcelas + '</div>';
        var bEnv = ov.querySelector('[data-conf="enviar"]');
        bEnv.disabled = nBloq > 0;
        bEnv.style.opacity = nBloq > 0 ? '.5' : '1';
        bEnv.title = nBloq > 0 ? 'Corrija os problemas marcados com ✖ antes de enviar.' : '';
    }

    function mostrarEspelho() {
        ensureModal();
        var p1 = document.getElementById('fat-passo-escolha');
        var p2 = document.getElementById('fat-passo-meianota');
        var p3 = document.getElementById('fat-passo-espelho');
        if (p1) p1.style.display = 'none';
        if (p2) p2.style.display = 'none';
        if (p3) p3.style.display = 'flex';
        redimensionarModal(true);
        setFooterMode('espelho');
        carregarEspelho();
        carregarSaldo(ctxFaturamento && ctxFaturamento.id);
    }

    // Após faturar: a esteira, a listagem de NF-e e os cards precisam refletir o novo estado.
    function recarregarTudo() {
        carregarPedidos();
        if (typeof window.carregarNFes === 'function') { try { window.carregarNFes(); } catch (_) {} }
        if (typeof window.carregarEstatisticas === 'function') { try { window.carregarEstatisticas(); } catch (_) {} }
        if (typeof window.carregarPedidosAprovados === 'function') { try { window.carregarPedidosAprovados(); } catch (_) {} }
    }

    // ── Saldo a faturar ────────────────────────────────────────
    // Depois de uma meia nota (F9 de 10%, por exemplo), o resto do pedido continua em aberto
    // e é cobrado à parte. Esta barra mostra quanto já saiu em nota, quanto sobrou, e abre o
    // espelho do saldo — um papel de COBRANÇA, sem impostos e sem valor fiscal.
    //
    // O saldo vem do backend (`GET /pedidos/:id/faturamentos`), que usa a mesma conta do
    // services/faturamento-parcial.service.js. Calcular aqui daria um número que o servidor
    // recusaria na hora de faturar.
    var SALDO_BAR_ID = 'fat-saldo-bar';

    function fmtBRL(v) {
        return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    function fmtPct(v) {
        var n = Number(v) || 0;
        return (Math.round(n * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    }

    // Monta o conteúdo da barra. Três estados: sem saldo, saldo em aberto e saldo já enviado
    // ao Contas a Receber — o terceiro existe para o botão não ser oferecido duas vezes.
    function montarBarraSaldo(d) {
        var html = '<span><strong>Já faturado:</strong> ' + fmtPct(d.percentual_faturado) + '% &nbsp;' + fmtBRL(d.valor_faturado) + '</span>'
            + '<span><strong>Saldo a cobrar:</strong> ' + fmtPct(d.percentual_restante) + '% &nbsp;' + fmtBRL(d.valor_restante) + '</span>';

        if (!d.espelho_saldo_url) {
            return html + '<span style="margin-left:auto;font-weight:700;">Pedido 100% faturado</span>';
        }

        html += '<button type="button" data-saldo-espelho style="margin-left:auto;padding:6px 12px;border:1px solid #b45309;background:#fff;color:#b45309;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">'
            + '<i class="fas fa-file-invoice"></i> Espelho do saldo (sem impostos)</button>';

        if (d.saldo_contas_receber) {
            html += '<span style="width:100%;margin-top:6px;padding-top:6px;border-top:1px dashed #fcd34d;color:#166534;">'
                + '<i class="fas fa-check-circle"></i> No Contas a Receber: <strong>' + escapar(d.saldo_contas_receber.descricao) + '</strong>'
                + ' — título #' + d.saldo_contas_receber.id + ' · ' + fmtBRL(d.saldo_contas_receber.valor) + '</span>';
        } else {
            // A descrição gravada é montada no servidor no padrão da planilha
            // (`F9 - 4300 - Cliente`); aqui só se escolhe o vencimento.
            html += '<span style="width:100%;margin-top:6px;padding-top:6px;border-top:1px dashed #fcd34d;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
                + '<label style="font-weight:600;">Vencimento:</label>'
                + '<input type="date" data-saldo-venc style="padding:5px 8px;border:1px solid #d1d5db;border-radius:7px;font-size:12px;" />'
                + '<button type="button" data-saldo-enviar style="padding:6px 12px;border:0;background:linear-gradient(135deg,#16a34a,#059669);color:#fff;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">'
                + '<i class="fas fa-arrow-right"></i> Enviar ao Contas a Receber</button>'
                + '<span data-saldo-msg style="color:#92400e;"></span></span>';
        }
        return html;
    }

    function escapar(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function ligarAcoesSaldo(bar, d, pedidoId) {
        var btnEspelho = bar.querySelector('[data-saldo-espelho]');
        if (btnEspelho) btnEspelho.addEventListener('click', function () { window.open(d.espelho_saldo_url, '_blank'); });

        var btnEnviar = bar.querySelector('[data-saldo-enviar]');
        if (!btnEnviar) return;
        btnEnviar.addEventListener('click', function () {
            var venc = bar.querySelector('[data-saldo-venc]');
            var msg = bar.querySelector('[data-saldo-msg]');
            btnEnviar.disabled = true;
            if (msg) msg.textContent = 'Enviando...';
            fetch('/api/vendas/pedidos/' + encodeURIComponent(pedidoId) + '/saldo-contas-receber', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vencimento: (venc && venc.value) || undefined })
            })
                .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
                .then(function (r) {
                    btnEnviar.disabled = false;
                    if (!r.ok || !r.j.success) {
                        if (msg) msg.textContent = '';
                        notify(r.j.message || 'Não foi possível enviar o saldo ao Contas a Receber.', 'error');
                        // Já enviado por outra aba/sessão: recarrega para mostrar o título.
                        if (r.j.code === 'SALDO_JA_ENVIADO') carregarSaldo(pedidoId);
                        return;
                    }
                    notify(r.j.message + ' ' + r.j.descricao, 'success');
                    carregarSaldo(pedidoId);
                })
                .catch(function () {
                    btnEnviar.disabled = false;
                    if (msg) msg.textContent = '';
                    notify('Erro de conexão ao enviar o saldo ao Contas a Receber.', 'error');
                });
        });
    }

    function carregarSaldo(pedidoId) {
        var bar = document.getElementById(SALDO_BAR_ID);
        if (!bar || !pedidoId) return;
        bar.style.display = 'none';
        bar.innerHTML = '';
        fetch('/api/vendas/pedidos/' + encodeURIComponent(pedidoId) + '/faturamentos', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                // Pedido nunca faturado parcialmente: não há saldo a explicar, a barra só
                // ocuparia espaço na conferência do espelho.
                if (!d || !d.success || !(d.percentual_faturado > 0)) return;
                bar.innerHTML = montarBarraSaldo(d);
                bar.style.display = 'flex';
                ligarAcoesSaldo(bar, d, pedidoId);
            })
            .catch(function () { /* o saldo é informação acessória: nunca atrapalha o faturamento */ });
    }

    // ── Download automático do XML ─────────────────────────────
    // Assim que a nota é autorizada o XML vai para o computador sozinho, em vez de obrigar a
    // pessoa a procurar cada nota na listagem e baixar uma a uma.
    //
    // fetch + blob, e não um <a href> direto: a rota exige o cookie de sessão, e quando não há
    // XML ela responde JSON — com link direto o navegador abriria esse erro numa aba, em vez
    // de avisar aqui. E o clique do botão já é gesto do usuário, então o download não é
    // bloqueado pelo navegador.
    function nomeDoCabecalho(resp) {
        var cd = resp.headers.get('Content-Disposition') || '';
        var m = cd.match(/filename="?([^";]+)"?/i);
        return m ? m[1] : null;
    }

    function salvarArquivo(blob, nome) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revogar na hora interrompe o download em alguns navegadores.
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function baixarXmlAutomatico(nfeId) {
        // Sem id: faturamento sem NF-e formal, ou emissão que não chegou a ser autorizada.
        if (!nfeId) return;
        fetch('/api/faturamento/nfes/' + encodeURIComponent(nfeId) + '/xml', { credentials: 'include' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('sem XML');
                var nome = nomeDoCabecalho(resp) || ('NFe_' + nfeId + '.xml');
                return resp.blob().then(function (b) {
                    salvarArquivo(b, nome);
                    notify('XML ' + nome + ' baixado.', 'success');
                });
            })
            .catch(function () {
                notify('Nota emitida, mas o XML ainda não está disponível — baixe pela listagem.', 'warning');
            });
    }

    // Aceite da tela "Confirmar envio à SEFAZ": o servidor grava no log de não repúdio junto
    // com usuário, categoria e horário (que ele mesmo determina). Só é chamado depois do "Sim".
    var CONFIRMACAO_ENVIO = { aceite: true, origem: 'modal-confirmar-envio' };

    // ── Ação: Faturamento Normal (100%) ────────────────────────
    function executarNormal() {
        if (!ctxFaturamento) return;
        var id = ctxFaturamento.id;
        setBusy(true);
        fetch('/api/vendas/pedidos/' + id + '/faturar', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gerarNFe: true, confirmacaoEnvio: CONFIRMACAO_ENVIO })
        }).then(function (resp) {
            return resp.json().catch(function () { return {}; }).then(function (d) { return { ok: resp.ok, data: d }; });
        }).then(function (r) {
            setBusy(false);
            if (r.ok) {
                fecharModal();
                var nf = r.data.nf_numero || r.data.nf || '';
                notify('Pedido faturado (100%)!' + (nf ? ' NF ' + nf : ''), 'success');
                baixarXmlAutomatico(r.data.nfe_data && r.data.nfe_data.nfe_id);
                recarregarTudo();
            } else {
                var pendente = r.data && r.data.nfe_pendente;
                notify((r.data && r.data.message) || 'Não foi possível faturar o pedido.', 'error');
                // O backend pode ter criado um rascunho rejeitado antes de receber a
                // resposta da SEFAZ. Abrir a conferência permite corrigir e reenviar sem
                // gerar outra numeração nem induzir o operador a repetir o faturamento.
                if (pendente && pendente.nfe_id) {
                    fecharModal();
                    abrirRascunho(pendente.nfe_id);
                }
                // Sempre: o servidor pode ter movido o pedido (faturado, com NF-e rejeitada)
                // mesmo devolvendo erro. Sem recarregar, a esteira seguia mostrando o pedido
                // antigo, e quem clicava de novo tentava faturar um pedido que já tinha nota.
                recarregarTudo();
            }
        }).catch(function (err) {
            setBusy(false);
            console.error('[faturamento] erro normal:', err);
            notify('Erro de conexão ao faturar o pedido.', 'error');
            // A requisição pode ter chegado ao servidor antes da queda: confere o estado real.
            recarregarTudo();
        });
    }

    // ── Ação: Meia Nota (parcial) ──────────────────────────────
    function executarMeiaNota(percentual) {
        if (!ctxFaturamento) return;
        var pct = parseFloat(percentual);
        if (!pct || pct <= 0 || pct >= 100) { notify('Informe um percentual válido entre 1% e 99%.', 'warning'); return; }
        var id = ctxFaturamento.id;
        var idempotencyKey = (window.crypto && typeof window.crypto.randomUUID === 'function')
            ? window.crypto.randomUUID()
            : 'meia-nota-' + id + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
        setBusy(true);
        fetch('/api/vendas/pedidos/' + id + '/faturamento-parcial', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify({
                tipo_faturamento: 'parcial_50',
                percentual: pct,
                gerarNFe: true,
                confirmacaoEnvio: CONFIRMACAO_ENVIO,
                gerarFinanceiro: true,
                idempotency_key: idempotencyKey,
                observacoes: 'Faturamento meia nota (' + pct + '%) via módulo Faturamento'
            })
        }).then(function (resp) {
            return resp.json().catch(function () { return {}; }).then(function (d) { return { ok: resp.ok, data: d }; });
        }).then(function (r) {
            setBusy(false);
            if (r.ok && r.data && r.data.success !== false) {
                fecharModal();
                notify('Faturamento meia nota de ' + pct + '% realizado!', 'success');
                baixarXmlAutomatico(r.data.dados && r.data.dados.nfe_id);
                recarregarTudo();
            } else {
                notify((r.data && r.data.message) || 'Não foi possível gerar o faturamento parcial.', 'error');
                recarregarTudo(); // o servidor pode ter gravado o parcial mesmo devolvendo erro
            }
        }).catch(function (err) {
            setBusy(false);
            console.error('[faturamento] erro meia nota:', err);
            notify('Erro de conexão ao faturar meia nota.', 'error');
            recarregarTudo();
        });
    }

    function executarParcialItens() {
        if (!ctxFaturamento || !Array.isArray(ctxFaturamento.itens) || !ctxFaturamento.itens.length) return;
        var id = ctxFaturamento.id;
        var chave = 'fatparc-' + id + '-' + Date.now();
        setBusy(true);
        fetch('/api/vendas/pedidos/' + encodeURIComponent(id) + '/faturamento-parcial', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
            body: JSON.stringify({
                itens_faturar: ctxFaturamento.itens,
                gerarNFe: true,
                confirmacaoEnvio: CONFIRMACAO_ENVIO,
                gerarFinanceiro: ctxFaturamento.gerarFinanceiro !== false,
                observacoes: ctxFaturamento.observacoes || '',
                idempotency_key: chave
            })
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok || j.success === false) throw new Error(j.message || 'Não foi possível faturar os itens.');
                return j;
            });
        }).then(function (j) {
            setBusy(false);
            fecharModal();
            notify(j.message || 'Faturamento parcial realizado. O saldo permaneceu no pedido.', 'success');
            baixarXmlAutomatico(j.dados && j.dados.nfe_id);
            recarregarTudo();
        }).catch(function (e) {
            setBusy(false);
            notify(e.message || 'Erro de conexão ao faturar os itens.', 'error');
            recarregarTudo(); // o servidor pode ter processado antes do erro chegar aqui
        });
    }

    // ── Ação: Faturamento Parcial por quantidade ───────────────
    // É diferente do F9: aqui a quantidade física dos itens é fracionada, a NF-e e
    // o estoque abrangem somente a entrega escolhida e o saldo permanece no pedido.
    function abrirFaturamentoParcialQuantidade() {
        if (!ctxFaturamento) return;
        var pedidoId = ctxFaturamento.id;
        var modalEscolha = document.getElementById(MODAL_ID);
        var antigo = document.getElementById('fat-modal-parcial-itens');
        if (antigo) antigo.remove();

        var overlay = document.createElement('div');
        overlay.id = 'fat-modal-parcial-itens';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1000001;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:18px;';
        overlay.innerHTML = '<div style="width:min(980px,100%);max-height:94vh;background:#fff;border-radius:14px;box-shadow:0 25px 55px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;">'
            + '<div style="padding:17px 20px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
            + '<div><strong style="font-size:17px;">Faturamento Parcial</strong><div style="font-size:12px;color:#ccfbf1;margin-top:2px;">Selecione as quantidades desta entrega. O restante continuará no mesmo pedido.</div></div>'
            + '<button type="button" data-fechar aria-label="Fechar" style="border:0;background:rgba(255,255,255,.16);color:#fff;width:34px;height:34px;border-radius:8px;font-size:20px;cursor:pointer;">&times;</button></div>'
            + '<div style="padding:18px;overflow:auto;flex:1;min-height:0;">'
            + '<div data-resumo style="margin-bottom:12px;color:#475569;font-size:13px;">Carregando saldo dos itens…</div>'
            + '<div style="overflow:auto;border:1px solid #e2e8f0;border-radius:10px;"><table style="width:100%;border-collapse:collapse;min-width:760px;font-size:12.5px;">'
            + '<thead style="background:#f8fafc;"><tr><th style="padding:9px;text-align:left;">Código</th><th style="padding:9px;text-align:left;">Descrição</th><th style="padding:9px;text-align:right;">Pedido</th><th style="padding:9px;text-align:right;">Já faturado</th><th style="padding:9px;text-align:right;">Saldo</th><th style="padding:9px;text-align:right;">Unitário</th><th style="padding:9px;text-align:right;">Faturar agora</th></tr></thead>'
            + '<tbody data-itens><tr><td colspan="7" style="padding:28px;text-align:center;color:#94a3b8;">Carregando…</td></tr></tbody></table></div>'
            + '<div data-total style="margin-top:12px;padding:10px 12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;color:#115e59;font-size:13px;">Selecione pelo menos uma quantidade.</div>'
            + '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:13px;color:#334155;"><label><input type="checkbox" data-nfe checked> Emitir NF-e desta entrega</label><label><input type="checkbox" data-financeiro checked> Gerar financeiro</label></div>'
            + '<label style="display:block;margin-top:12px;font-size:13px;color:#475569;">Observações<textarea data-observacoes rows="2" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:8px;border:1px solid #cbd5e1;border-radius:7px;resize:vertical;"></textarea></label>'
            + '</div><div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:flex-end;gap:10px;">'
            + '<button type="button" data-cancelar style="padding:9px 16px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer;">Cancelar</button>'
            + '<button type="button" data-confirmar disabled style="padding:9px 16px;border:0;background:#0f766e;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;opacity:.55;"><i class="fas fa-file-invoice"></i> Faturar itens selecionados</button>'
            + '</div></div>';
        document.body.appendChild(overlay);
        if (modalEscolha) hide(modalEscolha);

        var fechar = function () { overlay.remove(); if (modalEscolha && ctxFaturamento) show(modalEscolha); };
        overlay.querySelector('[data-fechar]').addEventListener('click', fechar);
        overlay.querySelector('[data-cancelar]').addEventListener('click', fechar);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) fechar(); });

        var saldo = null;
        function moeda(v) { return fmtBRL(v); }
        function qtd(v) { return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }); }
        function selecionados() {
            return Array.from(overlay.querySelectorAll('[data-qtd]')).map(function (input) {
                return { produto_id: Number(input.dataset.produto), quantidade: Number(String(input.value).replace(',', '.')) || 0 };
            }).filter(function (i) { return i.produto_id > 0 && i.quantidade > 0; });
        }
        function recalcular() {
            if (!saldo) return;
            var mapa = new Map((saldo.itens || []).map(function (i) { return [Number(i.produto_id), i]; }));
            var total = 0, invalido = false;
            selecionados().forEach(function (s) {
                var item = mapa.get(s.produto_id);
                if (!item || s.quantidade > Number(item.quantidade_saldo) + 0.0001) invalido = true;
                else total += s.quantidade * Number(item.valor_unitario || 0);
            });
            var confirmar = overlay.querySelector('[data-confirmar]');
            confirmar.disabled = invalido || total <= 0;
            confirmar.style.opacity = confirmar.disabled ? '.55' : '1';
            overlay.querySelector('[data-total]').innerHTML = invalido
                ? '<strong style="color:#b91c1c;">Quantidade superior ao saldo disponível.</strong>'
                : (total > 0 ? '<strong>Valor desta entrega:</strong> ' + moeda(total) : 'Selecione pelo menos uma quantidade.');
        }

        fetch('/api/vendas/pedidos/' + encodeURIComponent(pedidoId) + '/saldo-itens', { credentials: 'include' })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.success === false) throw new Error(j.message || 'Erro ao carregar saldo.'); return j; }); })
            .then(function (d) {
                saldo = d;
                overlay.querySelector('[data-resumo]').innerHTML = '<strong>Pedido:</strong> ' + moeda(d.valor_total) + ' &nbsp;·&nbsp; <strong>Já faturado:</strong> ' + moeda(d.valor_faturado) + ' &nbsp;·&nbsp; <strong>Em aberto:</strong> ' + moeda(d.valor_saldo);
                overlay.querySelector('[data-itens]').innerHTML = (d.itens || []).map(function (i) {
                    var bloqueado = !i.faturavel || Number(i.quantidade_saldo) <= 0;
                    return '<tr style="border-top:1px solid #f1f5f9;' + (bloqueado ? 'opacity:.55;' : '') + '"><td style="padding:9px;">' + escapar(i.codigo || '—') + '</td><td style="padding:9px;">' + escapar(i.descricao || '—') + '</td><td style="padding:9px;text-align:right;">' + qtd(i.quantidade) + '</td><td style="padding:9px;text-align:right;">' + qtd(i.quantidade_faturada) + '</td><td style="padding:9px;text-align:right;font-weight:700;">' + qtd(i.quantidade_saldo) + '</td><td style="padding:9px;text-align:right;">' + moeda(i.valor_unitario) + '</td><td style="padding:9px;text-align:right;"><input data-qtd data-produto="' + Number(i.produto_id || 0) + '" type="number" min="0" max="' + Number(i.quantidade_saldo || 0) + '" step="any" ' + (bloqueado ? 'disabled' : '') + ' style="width:110px;padding:6px;border:1px solid #cbd5e1;border-radius:6px;text-align:right;"></td></tr>';
                }).join('') || '<tr><td colspan="7" style="padding:28px;text-align:center;">Pedido sem itens faturáveis.</td></tr>';
                overlay.querySelectorAll('[data-qtd]').forEach(function (i) { i.addEventListener('input', recalcular); });
            }).catch(function (e) {
                overlay.querySelector('[data-itens]').innerHTML = '<tr><td colspan="7" style="padding:28px;text-align:center;color:#b91c1c;">' + escapar(e.message) + '</td></tr>';
            });

        overlay.querySelector('[data-confirmar]').addEventListener('click', function () {
            var botao = this, itens = selecionados();
            if (!itens.length || botao.disabled) return;
            if (!overlay.querySelector('[data-nfe]').checked) {
                notify('Para conferir o espelho e transmitir, mantenha a emissão de NF-e selecionada.', 'warning');
                return;
            }
            ctxFaturamento.tipo = 'itens';
            ctxFaturamento.itens = itens;
            ctxFaturamento.gerarFinanceiro = overlay.querySelector('[data-financeiro]').checked;
            ctxFaturamento.observacoes = overlay.querySelector('[data-observacoes]').value || '';
            overlay.remove();
            if (modalEscolha) show(modalEscolha);
            mostrarEspelho();
        });
    }

    // ── Construção do modal (uma única vez) ────────────────────
    function ensureModal() {
        var existing = document.getElementById(MODAL_ID);
        if (existing) return existing;

        var btnBase = 'padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;border:none;';
        var optBase = 'width:100%;text-align:left;padding:16px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start;';

        var html = ''
            + '<div class="modal-overlay" id="' + MODAL_ID + '" style="display:none;z-index:1000000;position:fixed;inset:0;background:rgba(15,23,42,.55);align-items:center;justify-content:center;">'
            + '  <div class="modal-content" id="fat-modal-content" style="max-width:560px;width:95%;max-height:92vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;">'
            // O header é pintado INLINE de ponta a ponta de propósito. `modal-standard-compat.css`
            // (seção 7) aplica `.modal-content .modal-header { background: linear-gradient(#0f172a,
            // #1e293b); color:#fff }` — mas a cor inline do <h3> (#111827) vencia a folha, e o
            // título "Faturar Pedido" ficava preto sobre azul-marinho, invisível. Como este modal é
            // injetado por JS em páginas com folhas diferentes, declarar fundo E texto aqui é o que
            // garante contraste em qualquer host, sem depender de !important.
            + '    <div class="modal-header" style="padding:18px 24px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-bottom:none;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-shrink:0;">'
            + '      <div style="display:flex;align-items:center;gap:12px;min-width:0;">'
            + '        <div style="width:38px;height:38px;flex-shrink:0;background:rgba(255,255,255,.14);border-radius:10px;display:flex;align-items:center;justify-content:center;">'
            + '          <i class="fas fa-file-invoice-dollar" style="font-size:17px;color:#93c5fd;"></i>'
            + '        </div>'
            + '        <div style="min-width:0;">'
            + '          <h3 style="margin:0;font-size:17px;font-weight:700;color:#ffffff;line-height:1.25;">Faturar Pedido</h3>'
            // O subtítulo carrega nº do pedido, cliente e valor — nome longo não pode empurrar o X.
            + '          <p id="fat-subtitulo" style="margin:3px 0 0;font-size:12.5px;color:#cbd5e1;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></p>'
            + '        </div>'
            + '      </div>'
            + '      <button type="button" id="fat-btn-fechar" aria-label="Fechar" style="flex-shrink:0;width:32px;height:32px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.15);border-radius:8px;font-size:20px;line-height:1;color:rgba(255,255,255,.85);cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>'
            + '    </div>'
            // Faixa de status da SEFAZ — some por padrão. Só existe pra que rejeitada/autorizada
            // apareçam NA HORA, dentro do próprio modal: antes disso o único aviso era um toast
            // passageiro (executarNormal/enviarSEFAZ), e reabrir um rascunho rejeitado mais tarde
            // (pela esteira, minutos ou dias depois) não mostrava motivo nenhum — só os botões de
            // novo, como se nada tivesse acontecido.
            + '    <div id="fat-status-badge" style="display:none;padding:11px 24px;font-size:13px;font-weight:600;flex-shrink:0;"></div>'
            + '    <div class="modal-body" style="padding:24px;overflow:auto;flex:1 1 auto;min-height:0;">'
            // Passo 1 — escolha do tipo
            + '      <div id="fat-passo-escolha">'
            + '        <button type="button" id="fat-opt-normal" style="' + optBase + '">'
            + '          <i class="fas fa-file-invoice" style="color:#16a34a;font-size:20px;margin-top:2px;"></i>'
            + '          <span><strong style="display:block;color:#111827;font-size:14px;">Faturamento Normal</strong>'
            + '          <span style="color:#6b7280;font-size:13px;">NF-e de 100% do valor do pedido.</span></span>'
            + '        </button>'
            + '        <button type="button" id="fat-opt-parcial-itens" style="' + optBase + '">'
            + '          <i class="fas fa-truck-ramp-box" style="color:#0f766e;font-size:20px;margin-top:2px;"></i>'
            + '          <span><strong style="display:block;color:#111827;font-size:14px;">Faturamento Parcial</strong>'
            + '          <span style="color:#6b7280;font-size:13px;">NF-e somente das quantidades entregues; o saldo permanece no pedido.</span></span>'
            + '        </button>'
            + '        <button type="button" id="fat-opt-meianota" style="' + optBase + '">'
            + '          <i class="fas fa-percentage" style="color:#2563eb;font-size:20px;margin-top:2px;"></i>'
            + '          <span><strong style="display:block;color:#111827;font-size:14px;">F9</strong>'
            + '          <span style="color:#6b7280;font-size:13px;">NF-e de parte do valor; o restante segue em recibo.</span></span>'
            + '        </button>'
            + '        <button type="button" id="fat-opt-nao-agora" style="' + optBase + 'margin-bottom:0;">'
            + '          <i class="fas fa-clock" style="color:#9ca3af;font-size:20px;margin-top:2px;"></i>'
            + '          <span><strong style="display:block;color:#111827;font-size:14px;">Não faturar agora</strong>'
            + '          <span style="color:#6b7280;font-size:13px;">Mantém o pedido aguardando faturamento.</span></span>'
            + '        </button>'
            + '      </div>'
            // Passo 2 — percentual da meia nota
            + '      <div id="fat-passo-meianota" style="display:none;">'
            + '        <button type="button" id="fat-voltar" style="background:none;border:none;color:#2563eb;font-size:13px;cursor:pointer;padding:0;margin-bottom:12px;"><i class="fas fa-arrow-left"></i> Voltar</button>'
            + '        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">Valor total: <strong id="fat-valor-total">R$ 0,00</strong></p>'
            + '        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;" id="fat-presets">'
            + '          <button type="button" data-pct="10" style="flex:1;min-width:56px;padding:10px 0;border:1px solid #d1d5db;background:#fff;border-radius:10px;font-weight:600;cursor:pointer;">10%</button>'
            + '          <button type="button" data-pct="20" style="flex:1;min-width:56px;padding:10px 0;border:1px solid #d1d5db;background:#fff;border-radius:10px;font-weight:600;cursor:pointer;">20%</button>'
            + '          <button type="button" data-pct="30" style="flex:1;min-width:56px;padding:10px 0;border:1px solid #d1d5db;background:#fff;border-radius:10px;font-weight:600;cursor:pointer;">30%</button>'
            + '          <button type="button" data-pct="40" style="flex:1;min-width:56px;padding:10px 0;border:1px solid #d1d5db;background:#fff;border-radius:10px;font-weight:600;cursor:pointer;">40%</button>'
            + '          <button type="button" data-pct="50" style="flex:1;min-width:56px;padding:10px 0;border:1px solid #d1d5db;background:#fff;border-radius:10px;font-weight:600;cursor:pointer;">50%</button>'
            + '        </div>'
            + '        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">'
            + '          <label style="font-size:13px;color:#374151;">Percentual:</label>'
            + '          <input type="number" id="fat-pct-input" min="1" max="99" value="50" style="width:90px;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;text-align:center;font-weight:600;"> %'
            + '          <span style="margin-left:auto;font-size:13px;color:#6b7280;">NF: <strong id="fat-valor-parcial" style="color:#2563eb;">R$ 0,00</strong></span>'
            + '        </div>'
            + '      </div>'
            // Passo 3 — espelho da NF-e
            + '      <div id="fat-passo-espelho" style="display:none;height:100%;flex-direction:column;">'
            + '        <button type="button" id="fat-espelho-voltar" style="background:none;border:none;color:#2563eb;font-size:13px;cursor:pointer;padding:0;margin-bottom:12px;flex-shrink:0;"><i class="fas fa-arrow-left"></i> Voltar</button>'
            + '        <p style="margin:0 0 10px;color:#111827;font-size:14px;font-weight:600;flex-shrink:0;"><i class="fas fa-eye" style="color:#2563eb;"></i> Espelho da NF-e — confira os dados antes de enviar ao SEFAZ</p>'
            + '        <div id="fat-saldo-bar" style="display:none;flex-shrink:0;margin:0 0 10px;padding:10px 12px;border:1px solid #fde68a;background:#fffbeb;border-radius:10px;font-size:12.5px;color:#92400e;align-items:center;gap:14px;flex-wrap:wrap;"></div>'
            + '        <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#f8fafc;flex:1 1 auto;min-height:0;">'
            + '          <iframe id="fat-espelho-iframe" title="Espelho da NF-e" style="width:100%;height:100%;min-height:68vh;border:0;background:#fff;display:block;"></iframe>'
            + '        </div>'
            + '        <p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Está tudo certo? Clique em <strong>Enviar ao SEFAZ</strong>. Caso contrário, use <strong>Editar informações</strong> para corrigir o pedido e depois <strong>Re-emitir</strong> o espelho.</p>'
            + '      </div>'
            + '    </div>'
            + '    <div class="modal-footer" style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap;flex-shrink:0;">'
            + '      <button type="button" id="fat-btn-conferir" title="Confere empresa, certificado, cliente, itens, impostos, totais e parcelas antes de enviar ao SEFAZ" style="' + btnBase + 'margin-right:auto;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;display:none;"><i class="fas fa-clipboard-check"></i> Conferir</button>'
            + '      <button type="button" id="fat-btn-cancelar" style="' + btnBase + 'border:1px solid #d1d5db;background:#fff;color:#374151;">Cancelar</button>'
            + '      <button type="button" id="fat-btn-confirmar-meianota" style="' + btnBase + 'background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;display:none;"><i class="fas fa-eye"></i> Conferir Espelho</button>'
            + '      <button type="button" id="fat-btn-espelho-aba" title="Abre o mesmo espelho numa nova aba, em tela cheia, para conferência" style="' + btnBase + 'border:1px solid #64748b;background:#fff;color:#334155;display:none;"><i class="fas fa-up-right-from-square"></i> Abrir espelho em nova aba</button>'
            + '      <button type="button" id="fat-btn-editar" style="' + btnBase + 'border:1px solid #f59e0b;background:#fff;color:#b45309;display:none;"><i class="fas fa-pen"></i> Editar informações</button>'
            + '      <button type="button" id="fat-btn-reemitir" style="' + btnBase + 'border:1px solid #2563eb;background:#fff;color:#1d4ed8;display:none;"><i class="fas fa-sync-alt"></i> Re-emitir</button>'
            + '      <button type="button" id="fat-btn-enviar-sefaz" style="' + btnBase + 'background:linear-gradient(135deg,#16a34a,#059669);color:#fff;display:none;"><i class="fas fa-paper-plane"></i> Enviar ao SEFAZ</button>'
            + '    </div>'
            + '  </div>'
            + '</div>';

        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var modal = tmp.firstElementChild;
        document.body.appendChild(modal);

        modal.querySelector('#fat-btn-fechar').addEventListener('click', fecharModal);
        modal.querySelector('#fat-btn-cancelar').addEventListener('click', fecharModal);
        modal.querySelector('#fat-opt-nao-agora').addEventListener('click', fecharModal);
        modal.addEventListener('click', function (e) { if (e.target === modal) fecharModal(); });

        modal.querySelector('#fat-opt-normal').addEventListener('click', function () {
            if (ctxFaturamento) { ctxFaturamento.tipo = 'normal'; ctxFaturamento.pct = 100; }
            mostrarEspelho();
        });
        modal.querySelector('#fat-opt-parcial-itens').addEventListener('click', abrirFaturamentoParcialQuantidade);
        modal.querySelector('#fat-opt-meianota').addEventListener('click', function () {
            mostrarPasso(2);
            setFooterMode('meianota');
            atualizarValorMeiaNota();
        });
        modal.querySelector('#fat-voltar').addEventListener('click', function () {
            mostrarPasso(1);
            setFooterMode('escolha');
        });
        modal.querySelector('#fat-presets').addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-pct]');
            if (!btn) return;
            modal.querySelector('#fat-pct-input').value = btn.getAttribute('data-pct');
            atualizarValorMeiaNota();
        });
        modal.querySelector('#fat-pct-input').addEventListener('input', atualizarValorMeiaNota);
        modal.querySelector('#fat-btn-confirmar-meianota').addEventListener('click', function () {
            var pct = parseFloat(modal.querySelector('#fat-pct-input').value);
            if (!pct || pct <= 0 || pct >= 100) { notify('Informe um percentual válido entre 1% e 99%.', 'warning'); return; }
            if (ctxFaturamento) { ctxFaturamento.tipo = 'parcial'; ctxFaturamento.pct = pct; }
            mostrarEspelho();
        });

        modal.querySelector('#fat-espelho-voltar').addEventListener('click', function () {
            if (ctxFaturamento && ctxFaturamento.tipo === 'parcial') { mostrarPasso(2); setFooterMode('meianota'); }
            else { mostrarPasso(1); setFooterMode('escolha'); }
        });
        modal.querySelector('#fat-btn-reemitir').addEventListener('click', carregarEspelho);
        modal.querySelector('#fat-btn-conferir').addEventListener('click', function () {
            if (ctxFaturamento && ctxFaturamento.id) abrirConferencia(ctxFaturamento.id);
        });
        // Mesmo espelho do iframe (mesmo tipo/percentual/itens), em aba própria para conferir
        // em tela cheia, imprimir ou comparar lado a lado com o pedido.
        modal.querySelector('#fat-btn-espelho-aba').addEventListener('click', function () {
            if (!ctxFaturamento) return;
            var url = ctxFaturamento.avulsa
                ? '/api/faturamento/nfes/' + encodeURIComponent(ctxFaturamento.nfeId) + '/espelho?_t=' + Date.now()
                : espelhoUrl(ctxFaturamento.id, ctxFaturamento.tipo, ctxFaturamento.pct, ctxFaturamento.itens);
            var aba = window.open(url, '_blank');
            if (!aba) notify('O navegador bloqueou a nova aba. Libere pop-ups para este site e tente de novo.', 'warning');
        });

        // Abre o editor de NF-e em JANELA PRÓPRIA (public/js/editor-nfe-modal.js), por cima
        // deste modal. Antes o editor era carregado no MESMO iframe do espelho, o que empilhava
        // dois cabeçalhos e dois rodapés de ação dentro do modal de faturamento e espremia a
        // aba "Itens" (que pede ~1560 px) na largura interna dele.
        modal.querySelector('#fat-btn-editar').addEventListener('click', function () {
            if (ctxFaturamento && ctxFaturamento.avulsa) {
                if (typeof window.abrirModalEditarNFe === 'function') {
                    window.abrirModalEditarNFe(ctxFaturamento.nfeId, 'nfe');
                } else notify('Editor da NF-e não está disponível. Recarregue a página.', 'error');
                return;
            }
            var id = ctxFaturamento && ctxFaturamento.id;
            if (!id) return;
            if (!window.ZyntraEditorNFe) {
                // Sem o componente carregado, o comportamento antigo ainda é melhor que nada.
                var iframe = document.getElementById('fat-espelho-iframe');
                var qsFb = ctxFaturamento.tipo === 'parcial'
                    ? '?tipo=parcial&pct=' + encodeURIComponent(ctxFaturamento.pct || 50)
                    : (ctxFaturamento.tipo === 'itens'
                        ? '?tipo=itens&itens=' + encodeURIComponent(serializarItensParciais(ctxFaturamento.itens)) : '');
                if (iframe) iframe.src = '/api/vendas/pedidos/' + encodeURIComponent(id) + '/espelho-nfe-edit' + qsFb;
                return;
            }
            window.ZyntraEditorNFe.abrir(id, {
                // Mesmo tipo/percentual do espelho: em meia nota o editor precisa abrir com os
                // valores proporcionais, não com os cheios do pedido.
                tipo: ctxFaturamento.tipo,
                pct: ctxFaturamento.pct,
                itens: ctxFaturamento.itens,
                onSalvo: function () {
                    carregarEspelho();
                    notify('NF-e atualizada! Confira o espelho.', 'success');
                }
            });
        });

        modal.querySelector('#fat-btn-enviar-sefaz').addEventListener('click', async function () {
            if (!ctxFaturamento) return;
            // Duplo clique abria duas confirmações e, confirmadas, duas transmissões.
            if (document.querySelector('[data-fat-confirmacao]')) return;
            // Confirmação explícita antes de transmitir: a NF-e autorizada não volta atrás
            // (só cancelamento em 24h). O modal diz QUAL nota, de qual pedido e de quanto.
            if (!(await confirmarEnvioSefaz(ctxFaturamento))) return;
            if (ctxFaturamento.avulsa) {
                // Devolução/remessa/NF-e avulsa: já confirmada acima com número e detalhes —
                // enviarSEFAZ pula a pergunta genérica dela.
                if (typeof window.enviarSEFAZ === 'function') window.enviarSEFAZ(ctxFaturamento.nfeId, { confirmado: true });
                else notify('Ação de envio à SEFAZ indisponível. Recarregue a página.', 'error');
            } else if (ctxFaturamento.tipo === 'parcial') executarMeiaNota(ctxFaturamento.pct);
            else if (ctxFaturamento.tipo === 'itens') executarParcialItens();
            else executarNormal();
        });

        return modal;
    }

    // ── Confirmação "Enviar ao SEFAZ" ───────────────────────────
    function confirmarEnvioSefaz(ctx) {
        return new Promise(function (resolve) {
            var pedido = ctx.avulsa ? null : (encontrarPedido(ctx.id) || {});
            var overlay = document.createElement('div');
            overlay.setAttribute('data-fat-confirmacao', '1');
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'fat-conf-tit');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px';
            var tipoTxt = ctx.avulsa ? 'NF-e avulsa'
                : ctx.tipo === 'parcial' ? 'Meia nota — ' + (ctx.pct || 50) + '% do pedido'
                : ctx.tipo === 'itens' ? 'Faturamento parcial por itens'
                : 'Faturamento integral';
            var valorBase = pedido ? (Number(pedido.valor) || 0) : 0;
            var valorTxt = pedido
                ? (ctx.tipo === 'parcial' ? moeda(valorBase * (Number(ctx.pct) || 50) / 100) + ' <span style="color:#64748b;font-weight:400">(de ' + moeda(valorBase) + ')</span>'
                    : ctx.tipo === 'itens' ? 'conforme os itens selecionados' : moeda(valorBase))
                : '—';
            var ident = pedido ? (pedido.numero_pedido ? esc(pedido.numero_pedido) : '#' + esc(ctx.id)) : '';
            overlay.innerHTML = ''
                + '<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden;font-family:inherit">'
                + '  <div style="padding:18px 22px;border-bottom:1px solid #e5e7eb;display:flex;gap:12px;align-items:center">'
                + '    <span style="width:38px;height:38px;border-radius:10px;background:#dcfce7;color:#15803d;display:inline-flex;align-items:center;justify-content:center"><i class="fas fa-paper-plane"></i></span>'
                + '    <h3 id="fat-conf-tit" style="margin:0;font-size:16px;color:#0f172a">Confirmar envio à SEFAZ</h3>'
                + '  </div>'
                + '  <div style="padding:18px 22px;font-size:14px;color:#1f2937;line-height:1.55">'
                + '    <p style="margin:0 0 14px">Você deseja faturar a nota <strong id="fat-conf-num">nº …</strong> na SEFAZ?</p>'
                + '    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">'
                + (pedido ? '<span style="color:#64748b">Pedido</span><strong>' + ident + '</strong><span style="color:#64748b">Cliente</span><span>' + esc(pedido.cliente || '-') + '</span>'
                    : '<span style="color:#64748b">Destinatário</span><span id="fat-conf-dest">…</span>')
                + '      <span style="color:#64748b">' + (pedido ? 'Tipo' : 'Operação') + '</span><span id="fat-conf-tipo">' + tipoTxt + '</span>'
                + '      <span style="color:#64748b">Valor</span><strong id="fat-conf-valor">' + valorTxt + '</strong>'
                + '    </div>'
                + '    <div id="fat-conf-pend"></div>'
                + '    <p style="margin:12px 0 0;font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px">Depois de autorizada, a nota só pode ser desfeita por cancelamento (até 24 h). Confira o espelho antes de enviar.</p>'
                + '  </div>'
                + '  <div style="padding:14px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px">'
                + '    <button type="button" data-conf="nao" style="padding:10px 18px;border-radius:10px;border:1px solid #d1d5db;background:#fff;color:#374151;font-weight:600;cursor:pointer">Cancelar</button>'
                + '    <button type="button" data-conf="sim" style="padding:10px 18px;border-radius:10px;border:0;background:linear-gradient(135deg,#16a34a,#059669);color:#fff;font-weight:600;cursor:pointer"><i class="fas fa-paper-plane"></i> Sim, enviar ao SEFAZ</button>'
                + '  </div>'
                + '</div>';
            document.body.appendChild(overlay);
            var fechar = function (ok) {
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(ok);
            };
            var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); fechar(false); } };
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) return fechar(false);
                var b = e.target.closest('[data-conf]');
                if (b) fechar(b.getAttribute('data-conf') === 'sim');
            });
            overlay.querySelector('[data-conf="sim"]').focus();

            // Pendências do checklist de emissão (o mesmo do Editar NF-e): quem confirma vê o
            // que a conferência apontou — cenário não salvo, CFOP × ST, cadastro, volumes.
            if (!ctx.avulsa) {
                fetch('/api/vendas/pedidos/' + encodeURIComponent(ctx.id) + '/espelho-nfe-edit', { credentials: 'include' })
                    .then(function (r) { return r.ok ? r.text() : ''; })
                    .then(function (html) {
                        if (!html || !overlay.isConnected) return;
                        var doc = new DOMParser().parseFromString(html, 'text/html');
                        var itens = doc.querySelectorAll('#checklist-emissao li');
                        if (!itens.length) return;
                        var bloq = 0;
                        var lis = Array.prototype.map.call(itens, function (li) {
                            var b = li.classList.contains('bloqueia'); if (b) bloq++;
                            var tx = (li.querySelector('.tx') || li).textContent.replace(/\s+/g, ' ').trim();
                            return '<li style="margin:3px 0"><span style="color:' + (b ? '#dc2626' : '#d97706') + ';font-weight:700">' + (b ? '✖' : '!') + '</span> ' + esc(tx) + '</li>';
                        }).join('');
                        var box = overlay.querySelector('#fat-conf-pend');
                        if (box) box.innerHTML = '<div style="margin-top:12px;font-size:12px;border-radius:8px;padding:8px 10px;'
                            + (bloq ? 'background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d' : 'background:#fffbeb;border:1px solid #fde68a;color:#78350f') + '">'
                            + '<strong>' + itens.length + ' pendência(s) na conferência' + (bloq ? ' — ' + bloq + ' pode(m) gerar rejeição' : '') + ':</strong>'
                            + '<ul style="margin:6px 0 0;padding-left:4px;list-style:none">' + lis + '</ul>'
                            + (bloq ? '<div style="margin-top:6px">Recomendado: <strong>Cancelar</strong> e corrigir em <strong>Editar informações</strong>.</div>' : '')
                            + '</div>';
                        if (bloq) {
                            var sim = overlay.querySelector('[data-conf="sim"]');
                            if (sim) sim.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar mesmo assim';
                            var nao = overlay.querySelector('[data-conf="nao"]');
                            if (nao) nao.focus();
                        }
                    })
                    .catch(function () { /* sem checklist: segue a confirmação normal */ });
            }

            // Número: nota avulsa já tem o seu; pedido mostra o PRÓXIMO da série (previsão —
            // o número é reservado de forma atômica só no envio).
            var numEl = overlay.querySelector('#fat-conf-num');
            var url = ctx.avulsa ? '/api/faturamento/nfes/' + encodeURIComponent(ctx.nfeId) : '/api/vendas/nfe/proximo-numero';
            fetch(url, { credentials: 'include' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    var d = ctx.avulsa ? (j && j.data) || {} : j || {};
                    if (ctx.avulsa) {
                        // Devolução/remessa: operação, destinatário e valor vêm da própria nota.
                        var dest = overlay.querySelector('#fat-conf-dest');
                        var tipo = overlay.querySelector('#fat-conf-tipo');
                        var valor = overlay.querySelector('#fat-conf-valor');
                        if (dest) dest.textContent = d.destinatario_nome || d.cliente_nome || d.destinatario || '-';
                        if (tipo && d.natureza_operacao) tipo.textContent = d.natureza_operacao;
                        if (valor) valor.textContent = moeda(d.valor_total != null ? d.valor_total : d.valor);
                    }
                    if (d.numero) numEl.innerHTML = 'nº ' + esc(d.numero) + ' (série ' + esc(d.serie || 1) + ')'
                        + (ctx.avulsa ? '' : ' <span style="font-weight:400;color:#64748b;font-size:12px">— próximo da série</span>');
                    else numEl.textContent = 'deste pedido';
                })
                .catch(function () { numEl.textContent = 'deste pedido'; });
        });
    }

    // ── Abertura ───────────────────────────────────────────────
    function abrirFaturamento(id) {
        var pedido = encontrarPedido(id) || {};
        var valor = parseFloat(pedido.valor) || 0;
        if (valor <= 0) {
            // O pedido pode não estar na esteira "aguardando-faturamento/faturar" — é o caso
            // do modal "Nova NF-e a partir de Pedido", cujo seletor lista pedidos em
            // "aprovado" (/pedidos-aprovados), um estágio ANTES da esteira
            // (/pedidos-para-faturar). Repetir só a segunda busca (bug antigo) nunca achava
            // um pedido "aprovado" e sempre falhava com "Pedido sem valor ou sem itens" —
            // por isso as duas fontes são consultadas em paralelo antes de desistir.
            Promise.all([
                fetch('/api/faturamento/pedidos-para-faturar', { credentials: 'include' })
                    .then(function (r) { return r.json(); }).catch(function () { return {}; }),
                fetch('/api/faturamento/pedidos-aprovados', { credentials: 'include' })
                    .then(function (r) { return r.json(); }).catch(function () { return {}; })
            ])
                .then(function (resultados) {
                    var todos = (resultados[0].data || []).concat(resultados[1].data || []);
                    var encontrado = todos.find(function (p) { return String(p.id) === String(id); });
                    if (!encontrado || !(Number(encontrado.valor) > 0)) throw new Error('Pedido sem valor ou sem itens.');
                    if (!encontrarPedido(id)) pedidosCache.push(encontrado);
                    abrirFaturamento(id);
                })
                .catch(function (e) { notify(e.message || 'Não foi possível carregar o pedido.', 'warning'); });
            return;
        }

        var modal = ensureModal();
        ctxFaturamento = { id: id, valor: valor, cliente: pedido.cliente || '', tipo: 'normal', pct: 100 };
        renderBadgeStatus(null);
        var titulo = modal.querySelector('.modal-header h3');
        if (titulo) titulo.textContent = 'Faturar Pedido';

        var ident = pedido.numero_pedido || ('Nº ' + id);
        var sub = modal.querySelector('#fat-subtitulo');
        if (sub) {
            sub.textContent = ident + (ctxFaturamento.cliente ? ' • ' + ctxFaturamento.cliente : '') + ' • ' + moeda(valor);
            // O subtítulo trunca com reticências para não empurrar o X; o texto completo
            // continua acessível no tooltip.
            sub.title = sub.textContent;
        }
        var totalEl = modal.querySelector('#fat-valor-total');
        if (totalEl) totalEl.textContent = moeda(valor);

        mostrarPasso(1);
        setFooterMode('escolha');
        atualizarValorMeiaNota();
        show(modal);
    }

    function abrirRascunho(nfeId) {
        var id = String(nfeId || '').trim();
        if (!id) return;
        var modal = ensureModal();
        ctxFaturamento = { avulsa: true, nfeId: id, id: null, tipo: 'avulsa', pct: 100 };
        var titulo = modal.querySelector('.modal-header h3');
        var sub = modal.querySelector('#fat-subtitulo');
        if (titulo) titulo.textContent = 'Faturar Pedido — Conferência da NF-e avulsa';
        if (sub) sub.textContent = 'Rascunho NF-e #' + id + ' • confira, edite e envie à SEFAZ';
        renderBadgeStatus(null);
        window.atualizarBadgeRascunhoFaturamento(id);
        show(modal);
        mostrarEspelho();
    }

    // Espelho isolado (sem faturar) — abre a prévia normal em nova aba.
    function verEspelho(id) {
        window.open(espelhoUrl(id, 'normal', 100), '_blank');
    }

    // Etiqueta de expedição — a etiqueta E o painel de conferência (lote/pesos) vivem em
    // /_shared/etiqueta.js, compartilhados com a Logística. `conferir` abre o painel e só então
    // imprime; `imprimir` continua disponível para quem quiser pular a conferência.
    // `origem` distingue pedido da esteira (pedido) de nota já emitida (nfe).
    function imprimirEtiqueta(id, origem) {
        if (!window.ZyntraEtiqueta || typeof window.ZyntraEtiqueta.conferir !== 'function') {
            notify('Módulo de etiqueta não carregado. Recarregue a página (Ctrl+F5).', 'error');
            return;
        }
        fetch('/api/faturamento/etiqueta-dados?origem=' + encodeURIComponent(origem || 'pedido') + '&id=' + encodeURIComponent(id), { credentials: 'include' })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; });
            })
            .then(function (r) {
                if (!r.ok || !r.data || r.data.success === false) {
                    notify((r.data && r.data.message) || 'Não foi possível montar a etiqueta.', 'error');
                    return;
                }
                var d = r.data.data || {};
                d.modulo = 'FATURAMENTO';
                window.ZyntraEtiqueta.conferir(d);
            })
            .catch(function (err) {
                console.error('[faturamento/etiqueta] erro:', err);
                notify('Erro de conexão ao gerar a etiqueta.', 'error');
            });
    }

    // ── Ligações da tela ───────────────────────────────────────
    function init() {
        var tbody = document.getElementById('pedidosFaturarList');
        if (!tbody) return; // tela sem a seção de esteira

        // Delegação: a tabela é re-renderizada a cada carga.
        tbody.addEventListener('click', function (e) {
            var btnFaturar = e.target.closest('[data-faturar]');
            if (btnFaturar) { abrirFaturamento(btnFaturar.getAttribute('data-faturar')); return; }
            var btnFicha = e.target.closest('[data-ficha]');
            if (btnFicha) {
                if (window.ZyntraFichaPedido) window.ZyntraFichaPedido.abrir(btnFicha.getAttribute('data-ficha'));
                else notify('Componente da ficha nao carregado. Recarregue a pagina (Ctrl+F5).', 'error');
                return;
            }
            var btnEspelho = e.target.closest('[data-espelho]');
            if (btnEspelho) { verEspelho(btnEspelho.getAttribute('data-espelho')); return; }
            var btnEtiqueta = e.target.closest('[data-etiqueta]');
            if (btnEtiqueta) { imprimirEtiqueta(btnEtiqueta.getAttribute('data-etiqueta'), 'pedido'); return; }
            var btnCalculadora = e.target.closest('[data-calculadora]');
            if (btnCalculadora) {
                if (typeof window.abrirCalculadoraImpostos === 'function') window.abrirCalculadoraImpostos(btnCalculadora.getAttribute('data-calculadora'));
                else notify('Calculadora de impostos não carregada. Recarregue a página (Ctrl+F5).', 'error');
            }
        });

        var filtroStatus = document.getElementById('filtroPedidoStatus');
        if (filtroStatus) filtroStatus.addEventListener('change', carregarPedidos);

        var abas = document.getElementById('pfAbas');
        if (abas) abas.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-pf-aba]');
            if (!b) return;
            etapaSel = b.getAttribute('data-pf-aba') || '';
            paginaPedidos = 1;
            renderizar();
        });
        ['pfVendedor', 'pfOrdem'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function () { paginaPedidos = 1; renderizar(); });
        });

        var busca = document.getElementById('filtroPedidoBusca');
        if (busca) {
            var timer;
            busca.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(renderizar, 250);
                paginaPedidos = 1;
            });
        }

        var btnAtualizar = document.getElementById('btnAtualizarPedidosFaturar');
        if (btnAtualizar) btnAtualizar.addEventListener('click', carregarPedidos);

        var btnAnterior = document.getElementById('pedidosFaturarAnterior');
        if (btnAnterior) btnAnterior.addEventListener('click', function () { alterarPagina(-1); });
        var btnProxima = document.getElementById('pedidosFaturarProxima');
        if (btnProxima) btnProxima.addEventListener('click', function () { alterarPagina(1); });

        carregarPedidos();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.FaturamentoPedidos = {
        carregar: carregarPedidos,
        abrir: abrirFaturamento,
        abrirRascunho: abrirRascunho,
        espelho: verEspelho,
        etiqueta: imprimirEtiqueta
    };
    // Usado pelo botão de etiqueta da listagem de NF-e (inline no index.html).
    window.imprimirEtiquetaFaturamento = imprimirEtiqueta;
})();
