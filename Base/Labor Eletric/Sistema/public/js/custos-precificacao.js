// ============================================
// CUSTOS & PRECIFICAÇÃO — Módulo Standalone
// Extraído do PCP para uso no Configurações do Sistema
// ============================================
(function() {
    'use strict';

    let _cpCache = null;
    let _cpParâmetros = null;
    let _cpActiveTab = 'parâmetros';
    let _cpFiltroCategoria = 'todos';
    let _cpFiltroSearch = '';
    let _cpSimProduto = null;
    let _cpEstado = 'SP';
    let _cpTipoCliente = 'revenda';
    let _cpIsRepresentante = false;
    let _cpFreteOpcao = 'FOB';

    window.abrirCustosPrecificacao = async function() {
        // Fechar modal de configurações se estiver aberto
        if (typeof fecharModalConfig === 'function') fecharModalConfig();
        if (typeof toggleConfiguracoes === 'function') { try { toggleConfiguracoes(); } catch(e) {} }

        let modal = document.getElementById('modal-custos-prec');
        if (modal) { modal.style.display = 'flex'; document.body.classList.add('modal-open'); return; }

        modal = document.createElement('div');
        modal.id = 'modal-custos-prec';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);';
        modal.innerHTML = `
            <div style="background:#f8fafc;border-radius:16px;width:96%;max-width:1200px;max-height:93vh;display:flex;flex-direction:column;box-shadow:0 25px 50px rgba(0,0,0,0.25);overflow:hidden;">
                <!-- HEADER -->
                <div style="padding:18px 28px;background:linear-gradient(135deg,#6d28d9 0%,#7c3aed 50%,#8b5cf6 100%);display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:14px;">
                        <div style="width:44px;height:44px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);">
                            <i class="fas fa-sitemap" style="font-size:20px;color:white;"></i>
                        </div>
                        <div>
                            <h2 class="modal-title" style="margin:0;font-size:18px;font-weight:700;color:white;">Custos & Precificação</h2>
                            <span style="font-size:12px;color:rgba(255,255,255,0.8);">Árvore de Produto — Parâmetros de Custo</span>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div id="cp-notification" style="display:none;padding:6px 14px;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);border-radius:8px;color:#10b981;font-size:12px;font-weight:600;">
                            <i class="fas fa-check-circle" style="margin-right:4px;"></i><span id="cp-notif-text"></span>
                        </div>
                        <button onclick="fecharCustosPrec()" style="background:rgba(255,255,255,0.15);border:none;width:36px;height:36px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-times" style="color:white;font-size:16px;"></i>
                        </button>
                    </div>
                </div>
                <!-- TABS -->
                <div style="display:flex;border-bottom:2px solid #e5e7eb;background:white;">
                    <button id="cp-tab-parâmetros" onclick="cpSwitchTab('parâmetros')" style="flex:1;padding:12px 20px;border:none;background:transparent;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
                        <i class="fas fa-sliders-h" style="margin-right:6px;"></i>Parâmetros
                    </button>
                    <button id="cp-tab-previa" onclick="cpSwitchTab('previa')" style="flex:1;padding:12px 20px;border:none;background:transparent;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
                        <i class="fas fa-table" style="margin-right:6px;"></i>Prévia de Preços
                    </button>
                    <button id="cp-tab-simulador" onclick="cpSwitchTab('simulador')" style="flex:1;padding:12px 20px;border:none;background:transparent;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
                        <i class="fas fa-calculator" style="margin-right:6px;"></i>Simulador
                    </button>
                </div>
                <!-- CONTENT -->
                <div id="cp-content" style="flex:1;overflow:auto;padding:0;">
                    <div style="text-align:center;padding:60px;"><i class="fas fa-spinner fa-spin" style="font-size:32px;color:#7c3aed;"></i><p style="color:#6b7280;margin-top:12px;">Carregando dados...</p></div>
                </div>
                <!-- FOOTER -->
                <div id="cp-footer" style="padding:12px 28px;border-top:1px solid #e5e7eb;background:white;display:flex;justify-content:space-between;align-items:center;">
                    <span id="cp-footer-info" style="font-size:12px;color:#9ca3af;"></span>
                    <div style="display:flex;gap:10px;">
                        <div style="position:relative;display:inline-block;" id="cp-pdf-dropdown-wrap">
                            <button onclick="document.getElementById('cp-pdf-menu').style.display=document.getElementById('cp-pdf-menu').style.display==='block'?'none':'block'" style="padding:8px 18px;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;"><i class="fas fa-file-pdf" style="margin-right:6px;color:#dc2626;"></i>Exportar PDF <i class="fas fa-caret-down" style="margin-left:4px;"></i></button>
                            <div id="cp-pdf-menu" style="display:none;position:absolute;bottom:42px;left:0;background:white;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);min-width:260px;z-index:999;padding:6px 0;">
                                <div style="padding:8px 16px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Tipo de Relatório</div>
                                <button onclick="cpExportarPDF('completo');document.getElementById('cp-pdf-menu').style.display='none'" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#1e293b;text-align:left;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'"><i class="fas fa-table" style="color:#7c3aed;width:18px;"></i> Tabela Completa</button>
                                <button onclick="cpExportarPDF('por_categoria');document.getElementById('cp-pdf-menu').style.display='none'" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#1e293b;text-align:left;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'"><i class="fas fa-layer-group" style="color:#ea580c;width:18px;"></i> Por Categoria</button>
                                <button onclick="cpExportarPDF('por_estado');document.getElementById('cp-pdf-menu').style.display='none'" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#1e293b;text-align:left;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'"><i class="fas fa-map-marked-alt" style="color:#0ea5e9;width:18px;"></i> Comparativo por Estado</button>
                                <button onclick="cpExportarPDF('por_produto');document.getElementById('cp-pdf-menu').style.display='none'" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#1e293b;text-align:left;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'"><i class="fas fa-barcode" style="color:#059669;width:18px;"></i> Ficha por Produto</button>
                            </div>
                        </div>
                        <button onclick="cpSalvarParâmetros()" style="padding:8px 18px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;"><i class="fas fa-save" style="margin-right:6px;"></i>Salvar Parâmetros</button>
                        <button onclick="cpAplicarPrecos()" style="padding:8px 18px;background:linear-gradient(135deg,#ea580c,#f97316);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;"><i class="fas fa-tags" style="margin-right:6px;"></i>Aplicar Preços aos Produtos</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
        document.title = 'Aluforce: Custos & Precificação';
        // Close on backdrop click
        modal.addEventListener('click', function(e) { if (e.target === modal) fecharCustosPrec(); });
        await cpCarregarDados();
    };

    window.fecharCustosPrec = function() {
        const modal = document.getElementById('modal-custos-prec');
        if (modal) { modal.style.display = 'none'; document.body.classList.remove('modal-open'); }
    };

    function cpShowNotif(msg) {
        const el = document.getElementById('cp-notification');
        const txt = document.getElementById('cp-notif-text');
        if (el && txt) { txt.textContent = msg; el.style.display = 'inline-flex'; setTimeout(() => { el.style.display = 'none'; }, 4000); }
    }

    async function cpCarregarDados() {
        try {
            const resp = await fetch('/api/pcp/arvore-produto');
            if (!resp.ok) throw new Error('Erro ' + resp.status);
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'Erro ao carregar');
            _cpParâmetros = data.parametros || data.parâmetros || data.config || {};
            if (_cpParâmetros.estado_selecionado) _cpEstado = _cpParâmetros.estado_selecionado;
            if (_cpParâmetros.tipo_cliente) _cpTipoCliente = _cpParâmetros.tipo_cliente;
            if (_cpParâmetros.is_representante !== undefined) _cpIsRepresentante = _cpParâmetros.is_representante;
            if (_cpParâmetros.frete_selecionado) _cpFreteOpcao = _cpParâmetros.frete_selecionado;
            _cpCache = data.products;
            cpRecalcularTodos();
            cpSwitchTab(_cpActiveTab);
            document.getElementById('cp-footer-info').innerHTML = '<i class="fas fa-cube" style="margin-right:4px;"></i>' + _cpCache.length + ' produtos no sistema';
        } catch (err) {
            console.error('Erro cpCarregarDados:', err);
            document.getElementById('cp-content').innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;"><i class="fas fa-exclamation-triangle" style="font-size:24px;"></i><p>Erro: ' + err.message + '</p></div>';
        }
    }

    function cpCalcProduto(p, params) {
        const pr = params.precos_kg;
        const mk = params.markup_pct;
        const desp = params.despesas;
        const kg = p.kg_m;
        let cmp = 0;
        const matCosts = {};
        Object.keys(pr).forEach(mat => {
            const w = kg[mat] || 0;
            const cost = w * pr[mat];
            matCosts[mat] = cost;
            cmp += cost;
        });
        const preco = cmp * (1 + mk / 100);
        const mb = preco - cmp;
        const mb_pct = preco > 0 ? (mb / preco) * 100 : 0;
        const despTotal = {};
        let sumDesp = 0;
        Object.keys(desp).forEach(d => {
            const val = preco * desp[d] / 100;
            despTotal[d] = val;
            sumDesp += val;
        });
        const ml = preco - cmp - sumDesp;
        const ml_pct = preco > 0 ? (ml / preco) * 100 : 0;
        return { cmp, preco, mb, mb_pct, matCosts, despTotal, sumDesp, ml, ml_pct };
    }

    function cpRecalcularTodos() {
        if (!_cpCache || !_cpParâmetros) return;
        _cpCache.forEach(p => {
            const r = cpCalcProduto(p, _cpParâmetros);
            p._cmp = r.cmp; p._preco = r.preco; p._mb = r.mb; p._mb_pct = r.mb_pct;
            p._ml = r.ml; p._ml_pct = r.ml_pct; p._matCosts = r.matCosts; p._despTotal = r.despTotal;
        });
        cpShowNotif(_cpCache.length + ' produtos atualizados!');
        if (_cpActiveTab === 'previa') cpRenderPrevia();
        if (_cpActiveTab === 'simulador' && _cpSimProduto) cpRenderSimulador();
    }

    window.cpSwitchTab = function(tab) {
        _cpActiveTab = tab;
        ['parâmetros', 'previa', 'simulador'].forEach(t => {
            const btn = document.getElementById('cp-tab-' + t);
            if (btn) {
                btn.style.color = t === tab ? '#7c3aed' : '#6b7280';
                btn.style.borderBottomColor = t === tab ? '#7c3aed' : 'transparent';
                btn.style.background = t === tab ? '#faf5ff' : 'transparent';
            }
        });
        if (tab === 'parâmetros') cpRenderParâmetros();
        else if (tab === 'previa') cpRenderPrevia();
        else if (tab === 'simulador') cpRenderSimulador();
    };

    // === TAB 1: PARÂMETROS ===
    function cpRenderParâmetros() {
        if (!_cpParâmetros) return;
        const pr = _cpParâmetros.precos_kg;
        const mk = _cpParâmetros.markup_pct;
        const desp = _cpParâmetros.despesas;
        const totDesp = Object.values(desp).reduce((a, b) => a + b, 0);
        const mb_pct_calc = (1 - 1 / (1 + mk / 100)) * 100;
        const ml_pct_calc = mb_pct_calc - totDesp;
        const matNames = { AL: 'Alumínio', PE: 'Polietileno (PE)', XLPE: 'XLPE', XLPE_AT: 'XLPE / Alta Tensão', HEPR: 'HEPR (Borracha)', PVC: 'PVC', MB_UV: 'Masterbatch UV' };
        const matIcons = { AL: '⬜', PE: '🔵', XLPE: '🟣', XLPE_AT: '🟡', HEPR: '🔴', PVC: '🟢', MB_UV: '⚪' };
        const icmsEstados = _cpParâmetros.icms_estados || {};
        const freteOpcoes = _cpParâmetros.frete_opcoes || _cpParâmetros['frete_opções'] || { FOB: 0, CIF_SUDESTE: 6, CIF_SUL: 6, CIF_CENTRO_OESTE: 7, CIF_NE_NO: 9 };
        const comNormal = _cpParâmetros.comissao_normal || 1.0;
        const comRepres = _cpParâmetros.comissao_representante || 4.0;
        const freteNames = { FOB: 'FOB 0%', CIF_SUDESTE: 'CIF Sudeste 6%', CIF_SUL: 'CIF Sul 6%', CIF_CENTRO_OESTE: 'CIF Centro-Oeste 7%', CIF_NE_NO: 'CIF NE/NO 9%' };
        let estadoOpts = Object.keys(icmsEstados).sort().map(uf => { const d = icmsEstados[uf] || {}; return '<option value="' + uf + '" ' + (uf === _cpEstado ? 'selected' : '') + '>' + uf + ' — ICMS ' + (d.icms || 12) + '% | DIFAL ' + (d.difal || 0) + '%</option>'; }).join('');

        let matInputs = '';
        Object.keys(pr).forEach(mat => {
            matInputs += `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:14px;width:22px;text-align:center;">${matIcons[mat] || '⚪'}</span>
                <span style="flex:1;font-size:13px;color:#374151;font-weight:500;">${matNames[mat] || mat}</span>
                <div style="display:flex;align-items:center;gap:4px;">
                    <span style="font-size:11px;color:#9ca3af;">R$</span>
                    <input type="number" step="0.01" value="${pr[mat].toFixed(2)}" data-mat="${mat}" onchange="cpUpdatePrecoKg(this)" style="width:80px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;font-weight:600;text-align:right;font-family:monospace;" />
                    <span style="font-size:11px;color:#9ca3af;">/Kg</span>
                </div>
            </div>`;
        });

        const despOrder = ['bobina', 'comissao', 'custo_fixo', 'financeira', 'icms', 'difal', 'pis_cofins', 'icms_st', 'redespacho', 'frete'];
        const despLabels = { bobina: 'Bobina', comissao: (_cpIsRepresentante ? 'Comissão (Representante)' : 'Comissão'), custo_fixo: 'Custo Fixo', financeira: 'Desp. Financeira', icms: 'ICMS (' + _cpEstado + ')', difal: 'DIFAL (' + _cpEstado + ')', pis_cofins: 'PIS/COFINS', icms_st: 'ICMS-ST', redespacho: 'Redespacho', frete: 'Frete' };
        const despIcons = { bobina: 'fa-circle-notch', comissao: 'fa-handshake', custo_fixo: 'fa-building', financeira: 'fa-credit-card', icms: 'fa-landmark', difal: 'fa-balance-scale', pis_cofins: 'fa-file-invoice-dollar', icms_st: 'fa-file-contract', redespacho: 'fa-shipping-fast', frete: 'fa-truck' };
        const autoFields = ['icms', 'difal', 'icms_st', 'comissao', 'frete'];
        let despInputs = '';
        despOrder.forEach(d => {
            if (desp[d] === undefined) return;
            const isAuto = autoFields.includes(d);
            despInputs += `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f3f4f6;">
                <i class="fas ${despIcons[d] || 'fa-percent'}" style="color:#7c3aed;font-size:12px;width:18px;text-align:center;"></i>
                <span style="flex:1;font-size:13px;color:#374151;font-weight:500;">${despLabels[d] || d}${isAuto ? ' <span style="font-size:9px;color:#3b82f6;font-weight:600;">⚙ auto</span>' : ''}</span>
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="number" step="0.01" value="${desp[d].toFixed(2)}" data-desp="${d}" onchange="cpUpdateDespesa(this)" style="width:68px;padding:6px 8px;border:1px solid ${isAuto ? '#93c5fd' : '#e5e7eb'};border-radius:6px;font-size:13px;font-weight:600;text-align:right;font-family:monospace;background:${isAuto ? '#eff6ff' : 'white'};" />
                    <span style="font-size:11px;color:#9ca3af;">%</span>
                </div>
            </div>`;
        });

        document.getElementById('cp-content').innerHTML = `
        <div style="padding:16px 28px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">
                <div>
                    <label style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;"><i class="fas fa-map-marked-alt" style="margin-right:4px;color:#6366f1;"></i>Estado de Destino</label>
                    <select onchange="cpUpdateEstado(this.value)" style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;font-weight:600;background:white;">${estadoOpts}</select>
                </div>
                <div>
                    <label style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;"><i class="fas fa-users" style="margin-right:4px;color:#059669;"></i>Tipo de Cliente</label>
                    <div style="display:flex;gap:4px;">
                        <button onclick="cpUpdateTipoCliente('revenda')" style="flex:1;padding:7px 6px;border:1.5px solid ${_cpTipoCliente === 'revenda' ? '#3b82f6' : '#d1d5db'};background:${_cpTipoCliente === 'revenda' ? '#eff6ff' : 'white'};border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:${_cpTipoCliente === 'revenda' ? '#1e40af' : '#6b7280'};"><i class="fas fa-store" style="margin-right:3px;"></i>Revenda</button>
                        <button onclick="cpUpdateTipoCliente('consumidor_final')" style="flex:1;padding:7px 6px;border:1.5px solid ${_cpTipoCliente === 'consumidor_final' ? '#059669' : '#d1d5db'};background:${_cpTipoCliente === 'consumidor_final' ? '#ecfdf5' : 'white'};border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:${_cpTipoCliente === 'consumidor_final' ? '#059669' : '#6b7280'};"><i class="fas fa-user" style="margin-right:3px;"></i>Cons. Final</button>
                    </div>
                </div>
                <div>
                    <label style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;"><i class="fas fa-handshake" style="margin-right:4px;color:#f59e0b;"></i>Comissão</label>
                    <div style="display:flex;gap:4px;">
                        <button onclick="cpUpdateRepresentante(false)" style="flex:1;padding:7px 6px;border:1.5px solid ${!_cpIsRepresentante ? '#f59e0b' : '#d1d5db'};background:${!_cpIsRepresentante ? '#fef3c7' : 'white'};border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:${!_cpIsRepresentante ? '#92400e' : '#6b7280'};">Vendedor ${comNormal}%</button>
                        <button onclick="cpUpdateRepresentante(true)" style="flex:1;padding:7px 6px;border:1.5px solid ${_cpIsRepresentante ? '#dc2626' : '#d1d5db'};background:${_cpIsRepresentante ? '#fef2f2' : 'white'};border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:${_cpIsRepresentante ? '#dc2626' : '#6b7280'};">Repr. ${comRepres}%</button>
                    </div>
                </div>
                <div>
                    <label style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;"><i class="fas fa-truck" style="margin-right:4px;color:#0ea5e9;"></i>Frete</label>
                    <select onchange="cpUpdateFreteOpcao(this.value)" style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;font-weight:600;background:white;">${Object.keys(freteOpcoes).map(k => '<option value="' + k + '" ' + (k === _cpFreteOpcao ? 'selected' : '') + '>' + (freteNames[k] || k) + '</option>').join('')}</select>
                </div>
            </div>
        </div>
        <div style="padding:24px 28px;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
            <div>
                <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                    <div style="padding:14px 18px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-bottom:1px solid #f59e0b30;">
                        <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">
                            <i class="fas fa-flask" style="margin-right:6px;"></i>Preços de Matéria-Prima (R$/Kg)
                        </div>
                    </div>
                    <div style="padding:10px 18px;">${matInputs}</div>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                    <div style="padding:14px 18px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);border-bottom:1px solid #3b82f630;">
                        <div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">
                            <i class="fas fa-percentage" style="margin-right:6px;"></i>Markup sobre CMP
                        </div>
                    </div>
                    <div style="padding:14px 18px;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                            <input type="number" step="0.5" value="${mk.toFixed(2)}" id="cp-markup-input" onchange="cpUpdateMarkup(this)" style="width:90px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:16px;font-weight:700;text-align:center;font-family:monospace;color:#1e40af;" />
                            <span style="font-size:14px;font-weight:600;color:#6b7280;">%</span>
                        </div>
                        <div style="font-size:11px;color:#6b7280;background:#f8fafc;padding:8px 12px;border-radius:6px;border-left:3px solid #3b82f6;">
                            <b>Preço Sugerido</b> = CMP × (1 + Markup/100)
                        </div>
                    </div>
                </div>
                <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;flex:1;">
                    <div style="padding:14px 18px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);border-bottom:1px solid #ec489930;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:11px;font-weight:700;color:#9d174d;text-transform:uppercase;letter-spacing:0.5px;">
                                <i class="fas fa-receipt" style="margin-right:6px;"></i>Despesas (% sobre preço)
                            </span>
                            <span style="font-size:11px;color:#9d174d;font-weight:600;">Total: ${totDesp.toFixed(2)}%</span>
                        </div>
                    </div>
                    <div style="padding:8px 18px;">${despInputs}</div>
                </div>
            </div>
        </div>
        <div style="margin:0 28px 20px;padding:14px 20px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-radius:10px;border:1px solid #10b98130;display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:13px;color:#065f46;">
                <b>ML</b> = Preço − (CMP + Σ Despesas) &nbsp;→&nbsp; <b>ML% atual: <span style="font-size:16px;color:#059669;">${ml_pct_calc.toFixed(2)}%</span></b>
            </div>
            <div style="font-size:12px;color:#6b7280;">
                MB%: <b>${mb_pct_calc.toFixed(2)}%</b> &nbsp;|&nbsp; Despesas: <b>${totDesp.toFixed(2)}%</b> &nbsp;|&nbsp;
                <span style="color:#6366f1;"><b>${_cpEstado}</b> · ${_cpTipoCliente === 'revenda' ? 'Revenda' : 'Cons. Final'} · ${_cpIsRepresentante ? 'Repr.' : 'Vend.'} · ${freteNames[_cpFreteOpcao] || _cpFreteOpcao}</span>
            </div>
        </div>`;
    }

    // === AUTO-SAVE DEBOUNCE ===
    let _cpAutoSaveTimer = null;
    function cpAutoSave() {
        if (_cpAutoSaveTimer) clearTimeout(_cpAutoSaveTimer);
        _cpAutoSaveTimer = setTimeout(function() {
            if (typeof window.cpSalvarParâmetros === 'function') window.cpSalvarParâmetros();
        }, 1500);
    }

    window.cpUpdatePrecoKg = function(input) {
        const mat = input.dataset.mat;
        const val = parseFloat(input.value);
        if (!isNaN(val) && val >= 0 && _cpParâmetros) {
            _cpParâmetros.precos_kg[mat] = val;
            cpRecalcularTodos();
            cpRenderParâmetros();
            cpAutoSave();
        }
    };
    window.cpUpdateMarkup = function(input) {
        const val = parseFloat(input.value);
        if (!isNaN(val) && val >= 0 && _cpParâmetros) {
            _cpParâmetros.markup_pct = val;
            cpRecalcularTodos();
            cpRenderParâmetros();
            cpAutoSave();
        }
    };
    window.cpUpdateDespesa = function(input) {
        const d = input.dataset.desp;
        const val = parseFloat(input.value);
        if (!isNaN(val) && val >= 0 && _cpParâmetros) {
            _cpParâmetros.despesas[d] = val;
            cpRecalcularTodos();
            cpRenderParâmetros();
            cpAutoSave();
        }
    };

    window.cpUpdateEstado = function(uf) {
        _cpEstado = uf;
        _cpParâmetros.estado_selecionado = uf;
        const icmsEstados = _cpParâmetros.icms_estados || {};
        const stData = icmsEstados[uf];
        if (stData) {
            _cpParâmetros.despesas.icms = stData.icms || 12;
            _cpParâmetros.despesas.difal = _cpTipoCliente === 'consumidor_final' ? (stData.difal || 0) : 0;
            _cpParâmetros.despesas.icms_st = _cpTipoCliente === 'revenda' ? (stData.st || 0) : 0;
        }
        cpRecalcularTodos();
        cpRenderParâmetros();
        cpAutoSave();
    };

    window.cpUpdateTipoCliente = function(tipo) {
        _cpTipoCliente = tipo;
        _cpParâmetros.tipo_cliente = tipo;
        const icmsEstados = _cpParâmetros.icms_estados || {};
        const stData = icmsEstados[_cpEstado];
        if (stData) {
            _cpParâmetros.despesas.icms = stData.icms || 12;
            _cpParâmetros.despesas.difal = tipo === 'consumidor_final' ? (stData.difal || 0) : 0;
            _cpParâmetros.despesas.icms_st = tipo === 'revenda' ? (stData.st || 0) : 0;
        }
        cpRecalcularTodos();
        cpRenderParâmetros();
        cpAutoSave();
    };

    window.cpUpdateRepresentante = function(isRepr) {
        _cpIsRepresentante = isRepr;
        _cpParâmetros.is_representante = isRepr;
        const comNormal = _cpParâmetros.comissao_normal || 1.0;
        const comRepr = _cpParâmetros.comissao_representante || 4.0;
        _cpParâmetros.despesas.comissao = isRepr ? comRepr : comNormal;
        cpRecalcularTodos();
        cpRenderParâmetros();
        cpAutoSave();
    };

    window.cpUpdateFreteOpcao = function(opcao) {
        _cpFreteOpcao = opcao;
        _cpParâmetros.frete_selecionado = opcao;
        const freteOpcoes = _cpParâmetros.frete_opcoes || _cpParâmetros['frete_opções'] || { FOB: 0, CIF_SUDESTE: 6, CIF_SUL: 6, CIF_CENTRO_OESTE: 7, CIF_NE_NO: 9 };
        if (freteOpcoes[opcao] !== undefined) {
            _cpParâmetros.despesas.frete = freteOpcoes[opcao];
        }
        cpRecalcularTodos();
        cpRenderParâmetros();
        cpAutoSave();
    };

    // === TAB 2: PRÉVIA DE PREÇOS ===
    function cpRenderPrevia() {
        if (!_cpCache) return;
        const filtered = cpGetFilteredProducts();
        const cats = {};
        _cpCache.forEach(p => { cats[p.categoria] = (cats[p.categoria] || 0) + 1; });

        let catOptions = '<option value="todos">Todos (' + _cpCache.length + ')</option>';
        Object.keys(cats).sort().forEach(c => {
            catOptions += '<option value="' + c + '"' + (c === _cpFiltroCategoria ? ' selected' : '') + '>' + c + ' (' + cats[c] + ')</option>';
        });

        let tbody = '';
        filtered.forEach((p, idx) => {
            const bgColor = idx % 2 === 0 ? 'white' : '#fafbfc';
            const mlColor = p._ml_pct >= 20 ? '#059669' : p._ml_pct >= 15 ? '#ca8a04' : '#dc2626';
            tbody += `<tr style="background:${bgColor};" onmouseover="this.style.background='#f0f0ff'" onmouseout="this.style.background='${bgColor}'">
                <td style="padding:8px 12px;font-weight:600;color:#7c3aed;font-size:12px;">${p.codigo}</td>
                <td style="padding:8px 12px;font-size:12px;color:#374151;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.descricao}">${p.descricao}</td>
                <td style="padding:8px 12px;text-align:right;font-family:monospace;font-size:12px;font-weight:600;color:#ea580c;">R$ ${p._cmp.toFixed(4)}</td>
                <td style="padding:8px 12px;text-align:right;font-family:monospace;font-size:12px;font-weight:700;color:#1e40af;">R$ ${p._preco.toFixed(4)}</td>
                <td style="padding:8px 12px;text-align:center;font-size:12px;font-weight:600;color:#059669;">${p._mb_pct.toFixed(2)}%</td>
                <td style="padding:8px 12px;text-align:right;font-family:monospace;font-size:12px;font-weight:600;color:${mlColor};">R$ ${p._ml.toFixed(4)}</td>
                <td style="padding:8px 12px;text-align:center;"><span style="background:${mlColor}15;color:${mlColor};font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;">${p._ml_pct.toFixed(2)}%</span></td>
                <td style="padding:8px 10px;text-align:center;">
                    <button onclick="_cpSimProdutoClick('${p.codigo}')" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:10px;color:#6b7280;" title="Simular"><i class="fas fa-calculator"></i></button>
                </td>
            </tr>`;
        });

        document.getElementById('cp-content').innerHTML = `
        <div style="padding:12px 28px;display:flex;gap:12px;align-items:center;border-bottom:1px solid #f3f4f6;background:white;">
            <select id="cp-previa-cat" onchange="cpFilterCategoria(this.value)" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:white;min-width:180px;">${catOptions}</select>
            <div style="position:relative;flex:1;">
                <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:12px;"></i>
                <input type="text" id="cp-previa-search" value="${_cpFiltroSearch}" oninput="cpFilterSearch(this.value)" placeholder="Buscar por código ou descrição..." style="width:100%;padding:8px 12px 8px 32px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;box-sizing:border-box;" />
            </div>
        </div>
        <div style="flex:1;overflow:auto;">
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f8fafc;position:sticky;top:0;z-index:2;">
                        <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Código</th>
                        <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Descrição</th>
                        <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">CMP (R$/M)</th>
                        <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Preço Sug. (R$/M)</th>
                        <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">MB %</th>
                        <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">ML (R$/M)</th>
                        <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">ML %</th>
                        <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;width:50px;"></th>
                    </tr>
                </thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>
        <div style="padding:8px 28px;background:#fafbfc;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
            <i class="fas fa-info-circle" style="margin-right:4px;"></i>${filtered.length} produtos com composição
        </div>`;
    }

    window._cpSimProdutoClick = function(codigo) {
        _cpSimProduto = _cpCache.find(x => x.codigo === codigo);
        cpSwitchTab('simulador');
    };
    window.cpFilterCategoria = function(val) { _cpFiltroCategoria = val; cpRenderPrevia(); };
    window.cpFilterSearch = function(val) { _cpFiltroSearch = val; cpRenderPrevia(); };

    function cpGetFilteredProducts() {
        if (!_cpCache) return [];
        let list = [..._cpCache];
        if (_cpFiltroCategoria !== 'todos') list = list.filter(p => p.categoria === _cpFiltroCategoria);
        if (_cpFiltroSearch) {
            const s = _cpFiltroSearch.toLowerCase();
            list = list.filter(p => p.codigo.toLowerCase().includes(s) || (p.descricao || '').toLowerCase().includes(s));
        }
        return list;
    }

    // === TAB 3: SIMULADOR ===
    function cpRenderSimulador() {
        if (!_cpCache || !_cpParâmetros) return;
        let options = '<option value="">— Selecione um produto —</option>';
        const cats = {};
        _cpCache.forEach(p => {
            if (!cats[p.categoria]) cats[p.categoria] = [];
            cats[p.categoria].push(p);
        });
        Object.keys(cats).sort().forEach(cat => {
            options += '<optgroup label="' + cat + '">';
            cats[cat].forEach(p => {
                const sel = _cpSimProduto && _cpSimProduto.codigo === p.codigo ? ' selected' : '';
                options += '<option value="' + p.codigo + '"' + sel + '>' + p.codigo + ' — ' + (p.descricao || '').substring(0, 50) + '</option>';
            });
            options += '</optgroup>';
        });

        let detail = '';
        if (_cpSimProduto) {
            const p = _cpSimProduto;
            const r = cpCalcProduto(p, _cpParâmetros);
            const matNames = { AL: 'Alumínio', PE: 'PE', XLPE: 'XLPE', XLPE_AT: 'XLPE/AT', HEPR: 'HEPR', PVC: 'PVC', MB_UV: 'Masterbatch UV' };
            const matColors = { AL: '#9ca3af', PE: '#3b82f6', XLPE: '#8b5cf6', XLPE_AT: '#f59e0b', HEPR: '#ef4444', PVC: '#22c55e', MB_UV: '#ec4899' };

            let matRows = '';
            Object.keys(r.matCosts).forEach(mat => {
                if (r.matCosts[mat] > 0) {
                    const kgm = p.kg_m[mat] || 0;
                    const prkg = _cpParâmetros.precos_kg[mat];
                    const pct = r.cmp > 0 ? (r.matCosts[mat] / r.cmp * 100) : 0;
                    matRows += `<tr>
                        <td style="padding:6px 10px;font-size:12px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${matColors[mat] || '#6b7280'};margin-right:6px;"></span>${matNames[mat] || mat}</td>
                        <td style="padding:6px 10px;text-align:right;font-family:monospace;font-size:12px;">${kgm.toFixed(6)}</td>
                        <td style="padding:6px 10px;text-align:center;color:#9ca3af;">×</td>
                        <td style="padding:6px 10px;text-align:right;font-family:monospace;font-size:12px;">R$ ${prkg.toFixed(2)}</td>
                        <td style="padding:6px 10px;text-align:center;color:#9ca3af;">=</td>
                        <td style="padding:6px 10px;text-align:right;font-family:monospace;font-size:12px;font-weight:600;">R$ ${r.matCosts[mat].toFixed(4)}</td>
                        <td style="padding:6px 10px;text-align:right;font-size:11px;color:#9ca3af;">${pct.toFixed(1)}%</td>
                    </tr>`;
                }
            });

            const despNames = { bobina: 'Bobina', comissao: 'Comissão', custo_fixo: 'Custo Fixo', financeira: 'Financeira', icms: 'ICMS', difal: 'DIFAL', pis_cofins: 'PIS/COFINS', icms_st: 'ICMS-ST', redespacho: 'Redespacho', frete: 'Frete' };
            const despIcons = { bobina: 'fa-circle-notch', comissao: 'fa-handshake', custo_fixo: 'fa-building', financeira: 'fa-credit-card', icms: 'fa-landmark', difal: 'fa-balance-scale', pis_cofins: 'fa-file-invoice-dollar', icms_st: 'fa-file-contract', redespacho: 'fa-shipping-fast', frete: 'fa-truck' };
            let despRows = '';
            Object.keys(r.despTotal).forEach(d => {
                const pct = _cpParâmetros.despesas[d];
                despRows += `<tr>
                    <td style="padding:5px 10px;font-size:12px;"><i class="fas ${despIcons[d] || 'fa-minus'}" style="color:#7c3aed;margin-right:6px;font-size:10px;"></i>${despNames[d] || d}</td>
                    <td style="padding:5px 10px;text-align:right;font-size:12px;color:#6b7280;">${pct.toFixed(2)}%</td>
                    <td style="padding:5px 10px;text-align:right;font-family:monospace;font-size:12px;font-weight:600;color:#7c3aed;">R$ ${r.despTotal[d].toFixed(4)}</td>
                </tr>`;
            });

            detail = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px;">
                <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                    <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
                        <div style="font-size:12px;font-weight:700;color:#374151;"><i class="fas fa-sitemap" style="color:#3b82f6;margin-right:6px;"></i>Composição de Materiais — CMP</div>
                    </div>
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">
                            <th style="padding:6px 10px;text-align:left;font-size:10px;color:#9ca3af;font-weight:600;">Material</th>
                            <th style="padding:6px 10px;text-align:right;font-size:10px;color:#9ca3af;font-weight:600;">Kg/Metro</th>
                            <th style="padding:6px 10px;text-align:center;font-size:10px;"></th>
                            <th style="padding:6px 10px;text-align:right;font-size:10px;color:#9ca3af;font-weight:600;">R$/Kg</th>
                            <th style="padding:6px 10px;text-align:center;font-size:10px;"></th>
                            <th style="padding:6px 10px;text-align:right;font-size:10px;color:#9ca3af;font-weight:600;">R$/Metro</th>
                            <th style="padding:6px 10px;text-align:right;font-size:10px;color:#9ca3af;font-weight:600;">%</th>
                        </tr></thead>
                        <tbody>${matRows}</tbody>
                        <tfoot><tr style="border-top:2px solid #e5e7eb;background:#fef3c7;">
                            <td colspan="5" style="padding:8px 10px;font-size:12px;font-weight:700;color:#92400e;"><i class="fas fa-equals" style="margin-right:4px;"></i>CMP Total</td>
                            <td style="padding:8px 10px;text-align:right;font-family:monospace;font-size:13px;font-weight:800;color:#ea580c;">R$ ${r.cmp.toFixed(4)}</td>
                            <td style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;">100%</td>
                        </tr></tfoot>
                    </table>
                </div>
                <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                    <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
                        <div style="font-size:12px;font-weight:700;color:#374151;"><i class="fas fa-calculator" style="color:#059669;margin-right:6px;"></i>Formação de Preço</div>
                    </div>
                    <div style="padding:12px 16px;">
                        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #e5e7eb;">
                            <span style="font-size:12px;color:#374151;"><i class="fas fa-box" style="color:#ea580c;margin-right:6px;"></i>Custo MP (CMP)</span>
                            <span style="font-family:monospace;font-size:12px;font-weight:600;color:#ea580c;">R$ ${r.cmp.toFixed(4)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:12px;color:#374151;"><i class="fas fa-plus-circle" style="color:#3b82f6;margin-right:6px;"></i>Markup (${_cpParâmetros.markup_pct}%)</span>
                            <span style="font-family:monospace;font-size:12px;font-weight:600;color:#3b82f6;">R$ ${r.mb.toFixed(4)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:8px 12px;margin:6px 0;background:#eff6ff;border-radius:8px;">
                            <span style="font-size:13px;font-weight:700;color:#1e40af;"><i class="fas fa-tag" style="margin-right:6px;"></i>Preço Sugerido</span>
                            <span style="font-family:monospace;font-size:15px;font-weight:800;color:#1e40af;">R$ ${r.preco.toFixed(4)}</span>
                        </div>
                        <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;margin:8px 0 4px;">Despesas:</div>
                        <table style="width:100%;border-collapse:collapse;">${despRows}
                            <tr style="border-top:1px solid #e5e7eb;">
                                <td style="padding:6px 10px;font-size:12px;font-weight:600;">Total Despesas</td>
                                <td style="padding:6px 10px;text-align:right;font-size:12px;font-weight:600;">${Object.values(_cpParâmetros.despesas).reduce((a, b) => a + b, 0).toFixed(2)}%</td>
                                <td style="padding:6px 10px;text-align:right;font-family:monospace;font-size:12px;font-weight:700;color:#dc2626;">R$ ${r.sumDesp.toFixed(4)}</td>
                            </tr>
                        </table>
                        <div style="display:flex;justify-content:space-between;padding:10px 12px;margin:8px 0 0;background:${r.ml_pct >= 15 ? '#ecfdf5' : '#fef2f2'};border-radius:8px;border:1px solid ${r.ml_pct >= 15 ? '#10b98130' : '#ef444430'};">
                            <div>
                                <div style="font-size:13px;font-weight:700;color:${r.ml_pct >= 15 ? '#059669' : '#dc2626'};"><i class="fas fa-chart-line" style="margin-right:6px;"></i>Margem Líquida</div>
                                <div style="font-size:10px;color:#6b7280;margin-top:2px;">ML% = MB% − Σ Despesas%</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-family:monospace;font-size:16px;font-weight:800;color:${r.ml_pct >= 15 ? '#059669' : '#dc2626'};">R$ ${r.ml.toFixed(4)}</div>
                                <div style="font-size:14px;font-weight:700;color:${r.ml_pct >= 15 ? '#059669' : '#dc2626'};">${r.ml_pct.toFixed(2)}%</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div style="margin-top:16px;background:white;border-radius:12px;border:1px solid #e5e7eb;padding:16px 20px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;"><i class="fas fa-sliders-h" style="color:#7c3aed;margin-right:6px;"></i>Simulação Rápida — Variar Markup</div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">
                    ${[60, 70, 80, 85, 90, 95, 100, 110, 120, 130].map(m => {
                        const simParams = JSON.parse(JSON.stringify(_cpParâmetros));
                        simParams.markup_pct = m;
                        const sr = cpCalcProduto(p, simParams);
                        const isCurrent = m === _cpParâmetros.markup_pct;
                        return '<div style="text-align:center;padding:8px;border-radius:8px;' + (isCurrent ? 'background:#7c3aed;color:white;' : 'background:#f8fafc;border:1px solid #e5e7eb;') + '">' +
                            '<div style="font-size:10px;font-weight:600;' + (isCurrent ? 'color:rgba(255,255,255,0.8);' : 'color:#9ca3af;') + '">MK ' + m + '%</div>' +
                            '<div style="font-size:12px;font-weight:700;font-family:monospace;margin-top:2px;">R$ ' + sr.preco.toFixed(2) + '</div>' +
                            '<div style="font-size:10px;font-weight:600;margin-top:1px;' + (sr.ml_pct >= 15 ? (isCurrent ? 'color:#a7f3d0;' : 'color:#059669;') : (isCurrent ? 'color:#fca5a5;' : 'color:#dc2626;')) + '">ML ' + sr.ml_pct.toFixed(1) + '%</div>' +
                            '</div>';
                    }).join('')}
                </div>
            </div>
            <div style="margin-top:16px;background:white;border-radius:12px;border:1px solid #e5e7eb;padding:16px 20px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;"><i class="fas fa-map-marked-alt" style="color:#2563eb;margin-right:6px;"></i>Preço por Estado — Comparativo de Impostos</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">
                    ${(() => {
                        const icos = _cpParâmetros.icms_estados || {};
                        const estados = Object.keys(icos).sort();
                        return estados.map(uf => {
                            const stParams = JSON.parse(JSON.stringify(_cpParâmetros));
                            stParams.despesas.icms = icos[uf].icms || 12;
                            stParams.despesas.difal = _cpTipoCliente === 'consumidor_final' ? (icos[uf].difal || 0) : 0;
                            stParams.despesas.icms_st = _cpTipoCliente === 'revenda' ? (icos[uf].st || 0) : 0;
                            const sr = cpCalcProduto(p, stParams);
                            const isCurrent = uf === _cpEstado;
                            const totalImp = (icos[uf].icms || 0) + (_cpTipoCliente === 'consumidor_final' ? (icos[uf].difal || 0) : 0) + (icos[uf].st || 0);
                            return '<div style="text-align:center;padding:8px 6px;border-radius:8px;' + (isCurrent ? 'background:#2563eb;color:white;box-shadow:0 2px 8px rgba(37,99,235,0.3);' : 'background:#f8fafc;border:1px solid #e5e7eb;') + 'cursor:pointer;" onclick="cpUpdateEstado(\'' + uf + '\');cpRenderSimulador()" title="ICMS: ' + (icos[uf].icms||0) + '% | DIFAL: ' + (icos[uf].difal||0) + '% | ST: ' + (icos[uf].st||0) + '%">' +
                                '<div style="font-size:13px;font-weight:800;' + (isCurrent ? '' : 'color:#1e40af;') + '">' + uf + '</div>' +
                                '<div style="font-size:11px;font-weight:700;font-family:monospace;margin-top:2px;">R$ ' + sr.preco.toFixed(2) + '</div>' +
                                '<div style="font-size:9px;font-weight:600;margin-top:1px;' + (isCurrent ? 'color:rgba(255,255,255,0.8);' : 'color:#6b7280;') + '">Imp: ' + totalImp.toFixed(1) + '%</div>' +
                                '<div style="font-size:9px;font-weight:600;' + (sr.ml_pct >= 15 ? (isCurrent ? 'color:#a7f3d0;' : 'color:#059669;') : (isCurrent ? 'color:#fca5a5;' : 'color:#dc2626;')) + '">ML ' + sr.ml_pct.toFixed(1) + '%</div>' +
                                '</div>';
                        }).join('');
                    })()}
                </div>
                <div style="margin-top:8px;font-size:10px;color:#9ca3af;text-align:center;"><i class="fas fa-info-circle" style="margin-right:4px;"></i>Clique em um estado para atualizar os impostos.</div>
            </div>
            <div style="margin-top:16px;background:white;border-radius:12px;border:1px solid #e5e7eb;padding:16px 20px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:4px;"><i class="fas fa-store" style="color:#059669;margin-right:6px;"></i>Comparativo de Canais de Venda</div>
                <div style="font-size:11px;color:#9ca3af;margin-bottom:12px;">Mesmo produto — como o preço e margem variam por tipo de cliente e canal de venda</div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
                    ${(() => {
                        const icos = _cpParâmetros.icms_estados || {};
                        const uf = _cpEstado;
                        const stData = icos[uf] || {};
                        const canais = [
                            { label: 'Revenda', sublabel: 'Vendedor Interno', tipo: 'revenda', repr: false, icon: 'fas fa-user-tie', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
                            { label: 'Revenda', sublabel: 'Representante', tipo: 'revenda', repr: true, icon: 'fas fa-handshake', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
                            { label: 'Consumidor Final', sublabel: 'Vendedor Interno', tipo: 'consumidor_final', repr: false, icon: 'fas fa-user', color: '#059669', bg: '#f0fdf4', border: '#bbf7d0' },
                            { label: 'Consumidor Final', sublabel: 'Representante', tipo: 'consumidor_final', repr: true, icon: 'fas fa-users', color: '#d97706', bg: '#fffbeb', border: '#fde68a' }
                        ];
                        const isCurrent = (c) => c.tipo === _cpTipoCliente && c.repr === _cpIsRepresentante;
                        return canais.map(canal => {
                            const canalParams = JSON.parse(JSON.stringify(_cpParâmetros));
                            canalParams.despesas.icms = stData.icms || 12;
                            canalParams.despesas.difal = canal.tipo === 'consumidor_final' ? (stData.difal || 0) : 0;
                            canalParams.despesas.icms_st = canal.tipo === 'revenda' ? (stData.st || 0) : 0;
                            const comNormal = _cpParâmetros.comissao_normal || 1.0;
                            const comRepr = _cpParâmetros.comissao_representante || 4.0;
                            canalParams.despesas.comissao = canal.repr ? comRepr : comNormal;
                            const sr = cpCalcProduto(p, canalParams);
                            const highlight = isCurrent(canal);
                            const totalDesp = Object.values(canalParams.despesas).reduce((a,b) => a+b, 0);
                            return `<div onclick="cpUpdateTipoCliente('${canal.tipo}');cpUpdateRepresentante(${canal.repr});cpRenderSimulador()" style="cursor:pointer;border-radius:10px;padding:12px;background:${highlight ? canal.color : canal.bg};border:2px solid ${highlight ? canal.color : canal.border};box-shadow:${highlight ? '0 4px 12px rgba(0,0,0,0.15)' : 'none'};">
                                <div style="font-size:10px;font-weight:700;color:${highlight ? 'rgba(255,255,255,0.85)' : '#6b7280'};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;"><i class="${canal.icon}" style="margin-right:4px;"></i>${canal.sublabel}</div>
                                <div style="font-size:11px;font-weight:700;color:${highlight ? 'white' : canal.color};margin-bottom:8px;">${canal.label}</div>
                                <div style="font-size:16px;font-weight:800;font-family:monospace;color:${highlight ? 'white' : '#1e293b'};">R$ ${sr.preco.toFixed(2)}</div>
                                <div style="font-size:10px;font-weight:600;margin-top:4px;color:${sr.ml_pct >= 15 ? (highlight ? '#a7f3d0' : '#059669') : (highlight ? '#fca5a5' : '#dc2626')};">ML ${sr.ml_pct.toFixed(1)}%</div>
                                <div style="margin-top:8px;padding-top:8px;border-top:1px solid ${highlight ? 'rgba(255,255,255,0.2)' : '#e5e7eb'};font-size:9px;color:${highlight ? 'rgba(255,255,255,0.7)' : '#9ca3af'};">
                                    DIFAL: ${(canalParams.despesas.difal||0).toFixed(1)}% &nbsp;|&nbsp; ST: ${(canalParams.despesas.icms_st||0).toFixed(1)}%<br>
                                    Com: ${canalParams.despesas.comissao.toFixed(1)}% &nbsp;|&nbsp; Total desp: ${totalDesp.toFixed(1)}%
                                </div>
                            </div>`;
                        }).join('');
                    })()}
                </div>
                <div style="margin-top:8px;font-size:10px;color:#9ca3af;text-align:center;"><i class="fas fa-mouse-pointer" style="margin-right:4px;"></i>Clique em um canal para ativá-lo. Estado atual: <strong>${_cpEstado}</strong></div>
            </div>`;
        }

        document.getElementById('cp-content').innerHTML = `
        <div style="padding:20px 28px;">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:4px;">
                <select id="cp-sim-select" onchange="cpSelectSimProduto(this.value)" style="flex:1;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;background:white;">${options}</select>
            </div>
            ${_cpSimProduto ? '<div style="margin-top:4px;padding:8px 14px;background:#faf5ff;border-radius:8px;border:1px solid #e9d5ff;font-size:12px;color:#6d28d9;"><i class="fas fa-info-circle" style="margin-right:6px;"></i><b>' + _cpSimProduto.codigo + '</b> — ' + (_cpSimProduto.descricao || '') + '  |  Cores: ' + (_cpSimProduto.cores || '—') + '</div>' : '<div style="text-align:center;padding:60px;color:#9ca3af;"><i class="fas fa-calculator" style="font-size:40px;margin-bottom:12px;display:block;opacity:0.4;"></i><p>Selecione um produto para simular a formação de preço</p></div>'}
            ${detail}
        </div>`;
    }
    // Expose for simulador inline calls
    window.cpRenderSimulador = cpRenderSimulador;

    window.cpSelectSimProduto = function(codigo) {
        if (!codigo) { _cpSimProduto = null; }
        else { _cpSimProduto = _cpCache.find(p => p.codigo === codigo); }
        cpRenderSimulador();
    };

    // === APLICAR PRECOS ===
    window.cpAplicarPrecos = async function() {
        if (!_cpCache || !_cpParâmetros) return;
        const total = _cpCache.length;
        const msg = 'Aplicar preço sugerido (R$/metro) calculado a ' + total + ' produtos no banco de dados?\n\nIsso irá atualizar o campo Preço de Venda de todos os produtos.';
        let confirma = false;
        if (typeof ConfirmDialog !== 'undefined' && ConfirmDialog.show) {
            confirma = await ConfirmDialog.show({ message: msg, danger: 'Esta ação é irreversível.', title: 'Aplicar Preços', confirmText: 'Sim, Aplicar' });
        } else {
            confirma = confirm(msg);
        }
        if (!confirma) return;
        try {
            const precos = _cpCache.map(p => ({ codigo: p.codigo, preco_venda: parseFloat(p._preco.toFixed(4)) }));
            const resp = await fetch('/api/pcp/arvore-produto/aplicar-precos', {
                credentials: 'include', method: 'POST',
                headers: cpGetHeaders(),
                body: JSON.stringify({ precos })
            });
            if (!resp.ok) throw new Error('Erro ' + resp.status);
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'Erro');
            cpShowNotif(data.atualizados + ' produtos atualizados no banco!');
            if (typeof showNotification === 'function') showNotification(data.atualizados + ' produtos tiveram o preço de venda atualizado com sucesso!', 'success');
        } catch (err) {
            console.error('Erro ao aplicar preços:', err);
            if (typeof showNotification === 'function') showNotification('Erro ao aplicar preços: ' + err.message, 'error');
        }
    };

    // === HELPER: headers com auth + CSRF ===
    function cpGetHeaders() {
        const h = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        if (token) h['Authorization'] = 'Bearer ' + token;
        const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
        if (csrfMatch) h['X-CSRF-Token'] = decodeURIComponent(csrfMatch[1]);
        return h;
    }

    // === SALVAR PARÂMETROS ===
    window.cpSalvarParâmetros = async function() {
        if (!_cpParâmetros) return;
        try {
            const resp = await fetch('/api/pcp/arvore-produto/parametros', {
                credentials: 'include', method: 'PUT',
                headers: cpGetHeaders(),
                body: JSON.stringify(_cpParâmetros)
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.message || errData.error || 'Erro ' + resp.status);
            }
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'Erro');
            cpShowNotif('Parâmetros salvos com sucesso!');
            if (typeof showNotification === 'function') showNotification('Parâmetros de custos salvos com sucesso!', 'success');
        } catch (err) {
            console.error('Erro ao salvar parâmetros:', err);
            if (typeof showNotification === 'function') showNotification('Erro ao salvar: ' + err.message, 'error');
        }
    };

    // === PDF EXPORT ===
    window.cpExportarPDF = function(modo) {
        if (!_cpCache || !_cpParâmetros) return;
        modo = modo || 'completo';

        if (modo === 'por_estado') { cpExportarPDF_PorEstado(); return; }
        if (modo === 'por_produto') { cpExportarPDF_PorProduto(); return; }

        const products = cpGetFilteredProducts();
        const mk = _cpParâmetros.markup_pct;
        const desp = _cpParâmetros.despesas;
        const totDesp = Object.values(desp).reduce((a, b) => a + b, 0);
        const mb_pct = (1 - 1 / (1 + mk / 100)) * 100;
        const ml_pct = mb_pct - totDesp;
        const dataHora = new Date().toLocaleString('pt-BR');
        const freteNames = { FOB: 'FOB', CIF_SUDESTE: 'CIF Sudeste', CIF_SUL: 'CIF Sul', CIF_CENTRO_OESTE: 'CIF Centro-Oeste', CIF_NE_NO: 'CIF NE/NO' };
        const despLabels = { bobina: 'Bobina', comissao: 'Comissão', custo_fixo: 'Custo Fixo', financeira: 'Financeira', icms: 'ICMS', difal: 'DIFAL', pis_cofins: 'PIS/COFINS', icms_st: 'ICMS-ST', redespacho: 'Redespacho', frete: 'Frete' };

        const cats = {};
        products.forEach(p => { if (!cats[p.categoria]) cats[p.categoria] = []; cats[p.categoria].push(p); });

        const modoTitulos = { completo: 'Tabela Completa', por_categoria: 'Relatório por Categoria' };
        const pageBreakCat = modo === 'por_categoria' ? 'page-break-before:always;' : '';

        let tablesHTML = '';
        Object.keys(cats).sort().forEach((cat, catIdx) => {
            const prods = cats[cat];
            let rows = prods.map((p, i) => `
                <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'};">
                    <td style="padding:5px 8px;font-weight:600;color:#1e40af;">${p.codigo}</td>
                    <td style="padding:5px 8px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.descricao}</td>
                    <td style="padding:5px 8px;text-align:center;color:#6b7280;">${p.cores || '—'}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:monospace;font-weight:600;color:#ea580c;">R$ ${p._cmp.toFixed(4)}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:monospace;font-weight:700;color:#1e40af;">R$ ${p._preco.toFixed(4)}</td>
                    <td style="padding:5px 8px;text-align:center;font-weight:600;color:#059669;">${p._mb_pct.toFixed(2)}%</td>
                    <td style="padding:5px 8px;text-align:right;font-family:monospace;font-weight:600;color:${p._ml_pct >= 15 ? '#059669' : '#dc2626'};">R$ ${p._ml.toFixed(4)}</td>
                    <td style="padding:5px 8px;text-align:center;"><span style="background:${p._ml_pct >= 15 ? '#ecfdf5' : '#fef2f2'};color:${p._ml_pct >= 15 ? '#059669' : '#dc2626'};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${p._ml_pct.toFixed(2)}%</span></td>
                </tr>`).join('');
            tablesHTML += `
            <div style="margin-bottom:18px;page-break-inside:avoid;${catIdx > 0 ? pageBreakCat : ''}">
                <div style="background:#1e293b;color:white;padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-radius:4px 4px 0 0;">
                    ${cat} <span style="font-weight:400;opacity:0.7;">(${prods.length} produtos)</span>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #e5e7eb;">
                    <thead>
                        <tr style="background:#f1f5f9;">
                            <th style="padding:5px 8px;text-align:left;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">Código</th>
                            <th style="padding:5px 8px;text-align:left;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">Descrição</th>
                            <th style="padding:5px 8px;text-align:center;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">Cores</th>
                            <th style="padding:5px 8px;text-align:right;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">CMP (R$/m)</th>
                            <th style="padding:5px 8px;text-align:right;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">Preço (R$/m)</th>
                            <th style="padding:5px 8px;text-align:center;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">MB%</th>
                            <th style="padding:5px 8px;text-align:right;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">ML (R$/m)</th>
                            <th style="padding:5px 8px;text-align:center;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;">ML%</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        });

        let despRows = Object.keys(desp).filter(d => desp[d] > 0).map(d => `<tr><td style="padding:3px 8px;font-size:10px;">${despLabels[d] || d}</td><td style="padding:3px 8px;text-align:right;font-family:monospace;font-size:10px;font-weight:600;">${desp[d].toFixed(2)}%</td></tr>`).join('');

        const pdfHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Custos e Precificação - ALUFORCE</title>
        <style>
            @page { size: A4 landscape; margin: 15mm 12mm; }
            @media print { body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } .no-print { display:none !important; } }
            body { font-family: 'Segoe UI', Arial, sans-serif; color:#1e293b; margin:0; padding:0; font-size:11px; }
        </style></head><body>
        <button class="no-print" onclick="window.print()" style="position:fixed;top:12px;right:12px;z-index:999;background:#1e293b;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">🖨️ Imprimir / Salvar PDF</button>
        <div style="background:linear-gradient(135deg,#1e293b,#334155);color:white;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:16px;"><img src="/images/Logo Monocromatico - Branco - Aluforce.png" alt="ALUFORCE" style="height:38px;object-fit:contain;" onerror="this.style.display='none'"><div><h1 style="margin:0;font-size:18px;">ALUFORCE</h1><div style="font-size:11px;opacity:0.8;">Cabos de Alumínio e Condutores Elétricos</div></div></div>
            <div style="text-align:right;"><div style="font-size:14px;font-weight:700;">CUSTOS & PRECIFICAÇÃO</div><div style="font-size:10px;opacity:0.7;">${modoTitulos[modo] || 'Tabela de Preços'} — ${dataHora}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;padding:12px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
            <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;"><div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Markup</div><div style="font-size:13px;font-weight:700;">${mk.toFixed(1)}%</div></div>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;"><div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Estado / Tipo</div><div style="font-size:13px;font-weight:700;">${_cpEstado} · ${_cpTipoCliente === 'revenda' ? 'Revenda' : 'Cons. Final'}</div></div>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;"><div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Comissão / Frete</div><div style="font-size:13px;font-weight:700;">${_cpIsRepresentante ? 'Representante' : 'Vendedor'} · ${freteNames[_cpFreteOpcao] || _cpFreteOpcao}</div></div>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;"><div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Margens</div><div style="font-size:13px;font-weight:700;color:#059669;">MB ${mb_pct.toFixed(1)}% · ML ${ml_pct.toFixed(1)}%</div></div>
        </div>
        <div style="padding:16px 24px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;"><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Resumo</div><div style="font-size:11px;"><b>${products.length}</b> produtos · <b>${Object.keys(cats).length}</b> categorias</div></div>
                <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;"><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Despesas</div><table style="width:100%;border-collapse:collapse;">${despRows}<tr style="border-top:1px solid #e2e8f0;font-weight:700;"><td style="padding:3px 8px;font-size:10px;">TOTAL</td><td style="padding:3px 8px;text-align:right;font-family:monospace;font-size:10px;">${totDesp.toFixed(2)}%</td></tr></table></div>
            </div>
            ${tablesHTML}
        </div>
        <div style="border-top:2px solid #1e293b;padding:10px 24px;display:flex;justify-content:space-between;font-size:9px;color:#64748b;"><div><b>ALUFORCE</b> — Cabos de Alumínio</div><div>${dataHora} · <b>CONFIDENCIAL — USO INTERNO</b></div></div>
        </body></html>`;

        const pdfWin = window.open('', '_blank');
        if (!pdfWin) { if (typeof showNotification === 'function') showNotification('Popup bloqueado!', 'error'); return; }
        pdfWin.document.write(pdfHTML);
        pdfWin.document.close();
        if (typeof showNotification === 'function') showNotification('PDF gerado com sucesso!', 'success');
    };

    function cpExportarPDF_PorEstado() {
        if (!_cpCache || !_cpParâmetros) return;
        const products = cpGetFilteredProducts();
        const icmsEstados = _cpParâmetros.icms_estados || {};
        const estados = Object.keys(icmsEstados).sort();
        if (!estados.length) { if (typeof showNotification === 'function') showNotification('Nenhum estado configurado.', 'error'); return; }
        const mk = _cpParâmetros.markup_pct;
        const baseDespesas = { ...(_cpParâmetros.despesas) };
        const dataHora = new Date().toLocaleString('pt-BR');

        const resultados = products.map(p => {
            const porEstado = {};
            estados.forEach(uf => {
                const stData = icmsEstados[uf] || {};
                const despMod = { ...baseDespesas, icms: stData.icms || 12, difal: _cpTipoCliente === 'consumidor_final' ? (stData.difal || 0) : 0, icms_st: _cpTipoCliente === 'revenda' ? (stData.st || 0) : 0 };
                const paramsMod = { ..._cpParâmetros, despesas: despMod };
                porEstado[uf] = cpCalcProduto(p, paramsMod);
            });
            return { codigo: p.codigo, descricao: p.descricao, categoria: p.categoria, porEstado };
        });

        const cats = {};
        resultados.forEach(r => { if (!cats[r.categoria]) cats[r.categoria] = []; cats[r.categoria].push(r); });

        const maxCols = Math.min(estados.length, 8);
        const estadoChunks = [];
        for (let i = 0; i < estados.length; i += maxCols) estadoChunks.push(estados.slice(i, i + maxCols));

        let tablesHTML = '';
        estadoChunks.forEach((chunk, ci) => {
            Object.keys(cats).sort().forEach((cat, catIdx) => {
                const prods = cats[cat];
                const ths = chunk.map(uf => `<th style="padding:4px 6px;text-align:right;font-weight:700;color:#374151;border-bottom:2px solid #cbd5e1;font-size:9px;">${uf}<br><span style="font-weight:400;color:#9ca3af;">ICMS ${(icmsEstados[uf]||{}).icms||12}%</span></th>`).join('');
                let rows = prods.map((r, i) => {
                    const tds = chunk.map(uf => {
                        const v = r.porEstado[uf];
                        const mlColor = v.ml_pct >= 15 ? '#059669' : '#dc2626';
                        return `<td style="padding:4px 6px;text-align:right;font-family:monospace;font-size:9px;background:${i%2===0?'#fff':'#f8fafc'};"><span style="font-weight:700;color:#1e40af;">R$ ${v.preco.toFixed(4)}</span><br><span style="color:${mlColor};font-size:8px;">${v.ml_pct.toFixed(1)}% ML</span></td>`;
                    }).join('');
                    return `<tr style="background:${i%2===0?'#fff':'#f8fafc'};"><td style="padding:4px 6px;font-weight:600;color:#1e40af;font-size:9px;">${r.codigo}</td><td style="padding:4px 6px;font-size:9px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.descricao}</td><td style="padding:4px 6px;text-align:right;font-family:monospace;font-weight:600;color:#ea580c;font-size:9px;">R$ ${r.porEstado[chunk[0]].cmp.toFixed(4)}</td>${tds}</tr>`;
                }).join('');
                tablesHTML += `<div style="margin-bottom:14px;page-break-inside:avoid;${catIdx > 0 || ci > 0 ? 'page-break-before:always;' : ''}"><div style="background:#1e293b;color:white;padding:5px 12px;font-size:11px;font-weight:700;text-transform:uppercase;border-radius:4px 4px 0 0;">${cat} (${prods.length})</div><table style="width:100%;border-collapse:collapse;font-size:9px;border:1px solid #e5e7eb;"><thead><tr style="background:#f1f5f9;"><th style="padding:4px 6px;text-align:left;font-weight:700;border-bottom:2px solid #cbd5e1;font-size:9px;">Código</th><th style="padding:4px 6px;text-align:left;font-weight:700;border-bottom:2px solid #cbd5e1;font-size:9px;">Descrição</th><th style="padding:4px 6px;text-align:right;font-weight:700;border-bottom:2px solid #cbd5e1;font-size:9px;">CMP</th>${ths}</tr></thead><tbody>${rows}</tbody></table></div>`;
            });
        });

        const pdfHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comparativo por Estado - ALUFORCE</title><style>@page{size:A4 landscape;margin:12mm 10mm;}@media print{body{-webkit-print-color-adjust:exact!important;}.no-print{display:none!important;}}body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;margin:0;font-size:10px;}</style></head><body>
        <button class="no-print" onclick="window.print()" style="position:fixed;top:12px;right:12px;z-index:999;background:#1e293b;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">🖨️ Imprimir / Salvar PDF</button>
        <div style="background:linear-gradient(135deg,#1e293b,#334155);color:white;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;"><div><h1 style="margin:0;font-size:16px;">ALUFORCE</h1><div style="font-size:10px;opacity:0.8;">Comparativo por Estado</div></div><div style="text-align:right;font-size:9px;opacity:0.7;">${estados.length} estados · Mk ${mk.toFixed(1)}% · ${dataHora}</div></div>
        <div style="padding:12px 20px;">${tablesHTML}</div>
        <div style="border-top:2px solid #1e293b;padding:8px 20px;display:flex;justify-content:space-between;font-size:8px;color:#64748b;"><b>ALUFORCE</b><span>${dataHora} · CONFIDENCIAL</span></div>
        </body></html>`;
        const pdfWin = window.open('', '_blank');
        if (!pdfWin) return;
        pdfWin.document.write(pdfHTML);
        pdfWin.document.close();
        if (typeof showNotification === 'function') showNotification('PDF comparativo por estado gerado!', 'success');
    }

    function cpExportarPDF_PorProduto() {
        if (!_cpCache || !_cpParâmetros) return;
        const products = cpGetFilteredProducts();
        if (!products.length) return;
        const mk = _cpParâmetros.markup_pct;
        const desp = _cpParâmetros.despesas;
        const pr = _cpParâmetros.precos_kg;
        const dataHora = new Date().toLocaleString('pt-BR');
        const matNames = { AL: 'Alumínio', PE: 'Polietileno (PE)', XLPE: 'XLPE', XLPE_AT: 'XLPE/AT', HEPR: 'HEPR (Borracha)', PVC: 'PVC', MB_UV: 'Masterbatch UV' };
        const despLabels = { bobina: 'Bobina', comissao: 'Comissão', custo_fixo: 'Custo Fixo', financeira: 'Financeira', icms: 'ICMS', difal: 'DIFAL', pis_cofins: 'PIS/COFINS', icms_st: 'ICMS-ST', redespacho: 'Redespacho', frete: 'Frete' };

        let fichasHTML = '';
        products.forEach((p, idx) => {
            const r = cpCalcProduto(p, _cpParâmetros);
            let matRows = '';
            Object.keys(p.kg_m || {}).forEach(mat => {
                const w = p.kg_m[mat] || 0;
                if (w <= 0) return;
                matRows += `<tr><td style="padding:4px 8px;font-size:10px;">${matNames[mat]||mat}</td><td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:10px;">${w.toFixed(4)} kg/m</td><td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:10px;">R$ ${(pr[mat]||0).toFixed(2)}/kg</td><td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600;font-size:10px;color:#ea580c;">R$ ${(r.matCosts[mat]||0).toFixed(4)}/m</td></tr>`;
            });
            let despRows = '';
            Object.keys(r.despTotal).forEach(d => {
                if (r.despTotal[d] <= 0) return;
                despRows += `<tr><td style="padding:3px 8px;font-size:10px;">${despLabels[d]||d}</td><td style="padding:3px 8px;text-align:right;font-family:monospace;font-size:10px;">${(desp[d]||0).toFixed(2)}%</td><td style="padding:3px 8px;text-align:right;font-family:monospace;font-weight:600;font-size:10px;">R$ ${r.despTotal[d].toFixed(4)}</td></tr>`;
            });
            const mlColor = r.ml_pct >= 20 ? '#059669' : r.ml_pct >= 15 ? '#ca8a04' : '#dc2626';
            fichasHTML += `<div style="page-break-inside:avoid;${idx > 0 ? 'page-break-before:always;' : ''}margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;padding:12px 16px;display:flex;justify-content:space-between;"><div><span style="font-size:16px;font-weight:800;">${p.codigo}</span><span style="margin-left:8px;font-size:11px;opacity:0.85;">${p.cores ? '· ' + p.cores : ''}</span></div><div style="font-size:9px;background:rgba(255,255,255,0.2);padding:3px 10px;border-radius:12px;">${p.categoria}</div></div>
                <div style="padding:10px 16px;background:#faf5ff;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:500;">${p.descricao}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
                    <div style="padding:12px 16px;border-right:1px solid #f3f4f6;"><div style="font-size:9px;font-weight:700;color:#7c3aed;text-transform:uppercase;margin-bottom:8px;">Composição de Materiais</div><table style="width:100%;border-collapse:collapse;"><tbody>${matRows}<tr style="border-top:2px solid #e5e7eb;font-weight:700;"><td style="padding:4px 8px;font-size:10px;" colspan="3">TOTAL (CMP)</td><td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:11px;color:#ea580c;">R$ ${r.cmp.toFixed(4)}/m</td></tr></tbody></table></div>
                    <div style="padding:12px 16px;"><div style="font-size:9px;font-weight:700;color:#7c3aed;text-transform:uppercase;margin-bottom:8px;">Despesas sobre Preço</div><table style="width:100%;border-collapse:collapse;"><tbody>${despRows}<tr style="border-top:2px solid #e5e7eb;font-weight:700;"><td style="padding:3px 8px;font-size:10px;">TOTAL</td><td style="padding:3px 8px;text-align:right;font-size:10px;">${Object.values(desp).reduce((a,b)=>a+b,0).toFixed(2)}%</td><td style="padding:3px 8px;text-align:right;font-size:10px;">R$ ${r.sumDesp.toFixed(4)}</td></tr></tbody></table></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#e2e8f0;border-top:1px solid #e2e8f0;">
                    <div style="background:white;padding:10px;text-align:center;"><div style="font-size:8px;color:#6b7280;text-transform:uppercase;font-weight:700;">CMP</div><div style="font-size:14px;font-weight:800;color:#ea580c;font-family:monospace;">R$ ${r.cmp.toFixed(4)}</div></div>
                    <div style="background:white;padding:10px;text-align:center;"><div style="font-size:8px;color:#6b7280;text-transform:uppercase;font-weight:700;">Preço Sugerido</div><div style="font-size:14px;font-weight:800;color:#1e40af;font-family:monospace;">R$ ${r.preco.toFixed(4)}</div></div>
                    <div style="background:white;padding:10px;text-align:center;"><div style="font-size:8px;color:#6b7280;text-transform:uppercase;font-weight:700;">Margem Bruta</div><div style="font-size:14px;font-weight:800;color:#059669;">${r.mb_pct.toFixed(2)}%</div></div>
                    <div style="background:white;padding:10px;text-align:center;"><div style="font-size:8px;color:#6b7280;text-transform:uppercase;font-weight:700;">ML (R$/m)</div><div style="font-size:14px;font-weight:800;color:${mlColor};font-family:monospace;">R$ ${r.ml.toFixed(4)}</div></div>
                    <div style="background:${mlColor}10;padding:10px;text-align:center;"><div style="font-size:8px;color:#6b7280;text-transform:uppercase;font-weight:700;">Margem Líquida</div><div style="font-size:14px;font-weight:800;color:${mlColor};">${r.ml_pct.toFixed(2)}%</div></div>
                </div>
            </div>`;
        });

        const pdfHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ficha por Produto - ALUFORCE</title><style>@page{size:A4 portrait;margin:12mm;}@media print{body{-webkit-print-color-adjust:exact!important;}.no-print{display:none!important;}}body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;margin:0;font-size:11px;}</style></head><body>
        <button class="no-print" onclick="window.print()" style="position:fixed;top:12px;right:12px;z-index:999;background:#1e293b;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">🖨️ Imprimir / Salvar PDF</button>
        <div style="background:linear-gradient(135deg,#1e293b,#334155);color:white;padding:14px 20px;display:flex;justify-content:space-between;"><div><h1 style="margin:0;font-size:16px;">ALUFORCE</h1><div style="font-size:10px;opacity:0.8;">Ficha por Produto</div></div><div style="text-align:right;font-size:9px;opacity:0.7;">${products.length} produtos · Mk ${mk.toFixed(1)}% · ${dataHora}</div></div>
        <div style="padding:16px 20px;">${fichasHTML}</div>
        <div style="border-top:2px solid #1e293b;padding:8px 20px;display:flex;justify-content:space-between;font-size:8px;color:#64748b;"><b>ALUFORCE</b><span>${dataHora} · CONFIDENCIAL</span></div>
        </body></html>`;
        const pdfWin = window.open('', '_blank');
        if (!pdfWin) return;
        pdfWin.document.write(pdfHTML);
        pdfWin.document.close();
        if (typeof showNotification === 'function') showNotification('PDF fichas por produto gerado!', 'success');
    }

    console.log('✅ Módulo Custos & Precificação carregado (standalone)');
})();
