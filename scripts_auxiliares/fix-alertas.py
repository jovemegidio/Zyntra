#!/usr/bin/env python3
"""Replace the carregarAlertasSistema function with interactive version"""
import re

filepath = r"g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2\modules\PCP\index.html"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the old function block
old_start = '        // ============================================\n        // ALERTAS DO SISTEMA\n        // ============================================\n        async function carregarAlertasSistema()'
old_end_marker = "        // Gerar"

start_idx = content.find(old_start)
if start_idx == -1:
    print("ERROR: Could not find start marker")
    exit(1)

end_idx = content.find(old_end_marker, start_idx)
if end_idx == -1:
    print("ERROR: Could not find end marker")
    exit(1)

# Find the blank line before "// Gerar"
# The function ends with "        }\n\n"
# We want to keep the "\n" before "// Gerar"
old_block = content[start_idx:end_idx]
print(f"Found old block: {len(old_block)} chars, starts at position {start_idx}")
print(f"First 100 chars: {repr(old_block[:100])}")
print(f"Last 100 chars: {repr(old_block[-100:])}")

new_block = '''        // ============================================
        // ALERTAS DO SISTEMA - Interativo com expandir/navegar
        // ============================================
        let alertasExpandidos = {};

        async function carregarAlertasSistema() {
            const container = document.getElementById('alerts-container');
            const badge = document.getElementById('alerts-count');

            if (!container) return;

            // Mostrar loading
            container.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <div class="loading-spinner" style="margin: 0 auto;"></div>
                    <p style="margin-top: 8px; color: var(--gray-500); font-size: 13px;">Carregando alertas...</p>
                </div>
            `;

            try {
                const token = localStorage.getItem('authToken') || localStorage.getItem('token');
                const headers = { 'Content-Type': 'application/json' };
                if (token && token !== 'unified-session-active') {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch('/api/pcp/alertas', {
                    credentials: 'include',
                    headers: headers
                });

                if (response.ok) {
                    const data = await response.json();
                    const alertas = data.alertas || [];

                    // Atualizar badge
                    if (badge) {
                        badge.textContent = alertas.length;
                        badge.style.display = alertas.length > 0 ? 'inline-flex' : 'none';
                        badge.className = `badge ${data.totalCriticos > 0 ? 'badge-danger' : 'badge-warning'}`;
                    }

                    // Renderizar alertas
                    if (alertas.length === 0) {
                        container.innerHTML = `
                            <div class="empty-state">
                                <div class="empty-state-icon">
                                    <i class="fas fa-check-circle"></i>
                                </div>
                                <h4 class="empty-state-title">Tudo certo!</h4>
                                <p class="empty-state-desc">N\\u00e3o h\\u00e1 alertas no momento.</p>
                            </div>
                        `;
                        return;
                    }

                    // Guardar dados para expandir
                    window._alertasData = alertas;

                    container.innerHTML = alertas.map((alerta, idx) => {
                        const hasItens = alerta.itens && alerta.itens.length > 0;
                        const hasNav = alerta.navegarPara;
                        const isEstoque = alerta.itens && alerta.itens[0] && alerta.itens[0].estoque !== undefined;
                        const isOrdem = alerta.itens && alerta.itens[0] && alerta.itens[0].data !== undefined;

                        // Gerar tabela de itens
                        let itensHTML = '';
                        if (hasItens) {
                            if (isEstoque) {
                                itensHTML = `
                                    <div id="alerta-itens-${idx}" class="alerta-itens-panel" style="display: none; margin-top: 8px; max-height: 250px; overflow-y: auto; border-top: 1px solid ${alerta.cor}30;">
                                        <table style="width: 100%; font-size: 11px; border-collapse: collapse; margin-top: 6px;">
                                            <thead>
                                                <tr style="background: ${alerta.cor}10; text-align: left;">
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600;">C\\u00f3digo</th>
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600;">Produto</th>
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600; text-align: right;">Estoque</th>
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600; text-align: right;">M\\u00edn.</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${alerta.itens.map(item => `
                                                    <tr style="border-bottom: 1px solid var(--gray-200);">
                                                        <td style="padding: 4px 8px; color: var(--gray-600); font-family: monospace; font-size: 10px;">${item.codigo || '-'}</td>
                                                        <td style="padding: 4px 8px; color: var(--gray-800); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.nome}">${item.nome}</td>
                                                        <td style="padding: 4px 8px; text-align: right; font-weight: 600; color: ${parseFloat(item.estoque) <= 0 ? '#ef4444' : '#f59e0b'};">${parseFloat(item.estoque).toLocaleString('pt-BR')} ${item.unidade || ''}</td>
                                                        <td style="padding: 4px 8px; text-align: right; color: var(--gray-500);">${parseFloat(item.minimo).toLocaleString('pt-BR')}</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                `;
                            } else if (isOrdem) {
                                itensHTML = `
                                    <div id="alerta-itens-${idx}" class="alerta-itens-panel" style="display: none; margin-top: 8px; max-height: 250px; overflow-y: auto; border-top: 1px solid ${alerta.cor}30;">
                                        <table style="width: 100%; font-size: 11px; border-collapse: collapse; margin-top: 6px;">
                                            <thead>
                                                <tr style="background: ${alerta.cor}10; text-align: left;">
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600;">OP</th>
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600;">Produto</th>
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600;">Cliente</th>
                                                    <th style="padding: 5px 8px; color: var(--gray-700); font-weight: 600;">Data</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${alerta.itens.map(item => `
                                                    <tr style="border-bottom: 1px solid var(--gray-200);">
                                                        <td style="padding: 4px 8px; color: var(--primary-600); font-weight: 600; font-size: 10px;">${item.codigo}</td>
                                                        <td style="padding: 4px 8px; color: var(--gray-800); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.nome}">${item.nome}</td>
                                                        <td style="padding: 4px 8px; color: var(--gray-600); max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.info || '-'}</td>
                                                        <td style="padding: 4px 8px; color: var(--gray-500); font-size: 10px;">${item.data ? new Date(item.data).toLocaleDateString('pt-BR') : '-'}</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                `;
                            }
                        }

                        return `
                            <div class="alert-item" style="
                                border-radius: 8px;
                                margin-bottom: 8px;
                                background: ${alerta.tipo === 'critico' ? 'rgba(239, 68, 68, 0.06)' : 'rgba(245, 158, 11, 0.06)'};
                                border-left: 3px solid ${alerta.cor};
                                transition: all 0.2s ease;
                                overflow: hidden;
                            ">
                                <div onclick="toggleAlertaDetalhe(${idx})" style="
                                    display: flex;
                                    align-items: flex-start;
                                    gap: 12px;
                                    padding: 12px;
                                    cursor: pointer;
                                    transition: background 0.15s;
                                " onmouseover="this.style.background='${alerta.tipo === 'critico' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)'}'"
                                   onmouseout="this.style.background='transparent'">
                                    <div style="
                                        width: 36px;
                                        height: 36px;
                                        border-radius: 50%;
                                        background: ${alerta.cor}20;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        flex-shrink: 0;
                                    ">
                                        <i class="fas ${alerta.icone}" style="color: ${alerta.cor}; font-size: 14px;"></i>
                                    </div>
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; color: var(--gray-800); font-size: 13px; margin-bottom: 2px; display: flex; align-items: center; gap: 6px;">
                                            ${alerta.titulo}
                                            <span style="
                                                background: ${alerta.cor};
                                                color: white;
                                                padding: 2px 6px;
                                                border-radius: 10px;
                                                font-size: 10px;
                                            ">${alerta.total}</span>
                                        </div>
                                        <div style="color: var(--gray-600); font-size: 12px; margin-bottom: 4px;">
                                            ${alerta.descricao}
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                                            <span style="color: var(--gray-400); font-size: 11px;">
                                                <i class="fas fa-chevron-down" id="alerta-chevron-${idx}" style="transition: transform 0.2s;"></i>
                                                Clique para ver detalhes
                                            </span>
                                            ${hasNav ? `
                                                <button onclick="event.stopPropagation(); navigateTo('${alerta.navegarPara}')" style="
                                                    background: ${alerta.cor};
                                                    color: white;
                                                    border: none;
                                                    padding: 2px 8px;
                                                    border-radius: 4px;
                                                    font-size: 10px;
                                                    cursor: pointer;
                                                    display: flex;
                                                    align-items: center;
                                                    gap: 4px;
                                                    transition: opacity 0.2s;
                                                " onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                                                    <i class="fas fa-arrow-right"></i> Ir para ${alerta.navegarPara === 'estoque' ? 'Estoque' : alerta.navegarPara === 'ordens' ? 'Ordens' : alerta.navegarPara === 'materiais' ? 'Materiais' : alerta.navegarPara}
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                                ${itensHTML}
                            </div>
                        `;
                    }).join('');

                } else {
                    console.warn('Erro ao carregar alertas:', response.status);
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon" style="color: var(--gray-400);">
                                <i class="fas fa-exclamation-triangle"></i>
                            </div>
                            <h4 class="empty-state-title">Erro ao carregar</h4>
                            <p class="empty-state-desc">N\\u00e3o foi poss\\u00edvel carregar os alertas.</p>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('Erro ao carregar alertas:', error);
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <h4 class="empty-state-title">Tudo certo!</h4>
                        <p class="empty-state-desc">N\\u00e3o h\\u00e1 alertas no momento.</p>
                    </div>
                `;
            }
        }

        // Toggle expandir/colapsar detalhes do alerta
        function toggleAlertaDetalhe(idx) {
            const panel = document.getElementById(`alerta-itens-${idx}`);
            const chevron = document.getElementById(`alerta-chevron-${idx}`);
            if (!panel) return;

            const isOpen = panel.style.display !== 'none';
            panel.style.display = isOpen ? 'none' : 'block';
            if (chevron) {
                chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
            }
        }

'''

# Fix the unicode escapes in new_block - convert \uXXXX to actual chars
new_block = new_block.replace('\\u00e3', '\u00e3')  # ã
new_block = new_block.replace('\\u00e1', '\u00e1')  # á
new_block = new_block.replace('\\u00ed', '\u00ed')  # í
new_block = new_block.replace('\\u00f3', '\u00f3')  # ó
new_block = new_block.replace('\\u00ee', '\u00ee')  # î
new_block = new_block.replace('\\u00edn', '\u00edn')  # ín (already handled)

content = content[:start_idx] + new_block + content[end_idx:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: File updated!")
print(f"Replaced {len(old_block)} chars with {len(new_block)} chars")

# Verify
with open(filepath, 'r', encoding='utf-8') as f:
    verify = f.read()
count = verify.count('toggleAlertaDetalhe')
print(f"Verification: toggleAlertaDetalhe appears {count} times")
