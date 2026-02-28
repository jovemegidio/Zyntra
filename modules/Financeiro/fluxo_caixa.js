// ===== FLUXO DE CAIXA - ALUFORCE =====
let períodoSelecionado = '7dias';
let dataInicio = null;
let dataFim = null;
let dadosFluxo = [];
let chartFluxo = null;

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async function() {
    try {
        configurarDatasIniciais();
        await carregarDadosFluxo();
        renderizarGrafico();
        renderizarTabela();
        atualizarResumo();
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
    }
});

// ===== CONFIGURAÇÃO INICIAL =====
function configurarDatasIniciais() {
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje);
    seteDiasAtras.setDate(hoje.getDate() - 7);
    
    dataInicio = seteDiasAtras;
    dataFim = hoje;
    
    document.getElementById('data-inicio').value = formatarDataInput(dataInicio);
    document.getElementById('data-fim').value = formatarDataInput(dataFim);
}

function selecionarPeriodo(período, evt) {
    períodoSelecionado = período;
    
    // Atualizar botões
    document.querySelectorAll('.período-btn').forEach(btn => btn.classList.remove('active'));
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }
    
    // Calcular datas
    const hoje = new Date();
    dataFim = hoje;
    
    const dias = {
        '7dias': 7,
        '15dias': 15,
        '30dias': 30,
        '60dias': 60,
        '90dias': 90
    }[período];
    
    dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() - dias);
    
    document.getElementById('data-inicio').value = formatarDataInput(dataInicio);
    document.getElementById('data-fim').value = formatarDataInput(dataFim);
    
    carregarDadosFluxo();
}

function aplicarPeriodoCustomizado() {
    const inicio = document.getElementById('data-inicio').value;
    const fim = document.getElementById('data-fim').value;
    
    if (!inicio || !fim) {
        mostrarAlerta('Selecione as datas de início e fim', 'error');
        return;
    }
    
    dataInicio = new Date(inicio);
    dataFim = new Date(fim);
    
    // Desmarcar botões de período
    document.querySelectorAll('.período-btn').forEach(btn => btn.classList.remove('active'));
    
    carregarDadosFluxo();
}

// ===== CARREGAR DADOS =====
async function carregarDadosFluxo() {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/financeiro/fluxo-caixa?inicio=${formatarDataISO ? formatarDataISO(dataInicio) : dataInicio.toISOString().split('T')[0]}&fim=${formatarDataISO ? formatarDataISO(dataFim) : dataFim.toISOString().split('T')[0]}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Erro ao carregar fluxo de caixa');
        dadosFluxo = await response.json();
        
        // Se a API retornou array vazio, não há dados
        if (!Array.isArray(dadosFluxo)) dadosFluxo = [];
        
        renderizarGrafico();
        renderizarTabela();
        atualizarResumo();
        
    } catch (error) {
        console.error('❌ Erro ao carregar fluxo de caixa:', error);
        dadosFluxo = [];
        renderizarGrafico();
        renderizarTabela();
        atualizarResumo();
    }
}

// ===== RENDERIZAÇÃO =====
function renderizarGrafico() {
    const ctx = document.getElementById('chart-fluxo');
    
    if (chartFluxo) {
        chartFluxo.destroy();
    }
    
    const labels = dadosFluxo.map(d => formatarDataCurta(d.data));
    const entradas = dadosFluxo.map(d => d.entradas);
    const saidas = dadosFluxo.map(d => d.saidas);
    const saldoAcumulado = dadosFluxo.map(d => d.saldo_acumulado);
    
    chartFluxo = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Entradas',
                    data: entradas,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Saídas',
                    data: saidas,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Saldo Acumulado',
                    data: saldoAcumulado,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 3,
                    fill: false,
                    tension: 0.4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: {
                            size: 13,
                            weight: 600
                        },
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += 'R$ ' + formatarMoeda(context.parsed.y);
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + formatarMoedaCurta(value);
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + formatarMoedaCurta(value);
                        }
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

function renderizarTabela() {
    const tabela = document.getElementById('tabela-fluxo');
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    // Filtrar apenas o período selecionado
    const dadosPeriodo = dadosFluxo.filter(d => {
        const data = new Date(d.data);
        return data >= dataInicio && data <= dataFim;
    });
    
    if (!dadosPeriodo || dadosPeriodo.length === 0) {
        tabela.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 60px 20px; color: #64748b;">
                    <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
                    Nenhum dado disponível para o período selecionado
                </td>
            </tr>
        `;
        return;
    }
    
    const html = `
        <thead>
            <tr>
                <th>Data</th>
                <th class="text-right">Entradas</th>
                <th class="text-right">Saídas</th>
                <th class="text-right">Saldo do Dia</th>
                <th class="text-right">Saldo Acumulado</th>
            </tr>
        </thead>
        <tbody>
            ${dadosPeriodo.map(item => {
                const data = new Date(item.data);
                const isPast = data < hoje;
                const isFuture = data > hoje;
                const isToday = data.getTime() === hoje.getTime();
                
                return `
                    <tr class="${isPast ? 'período-passado' : isFuture ? 'período-futuro' : ''}">
                        <td>
                            <div class="data-destaque">
                                ${formatarData(data)}
                                ${isToday ? '<span style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">HOJE</span>' : ''}
                                ${isFuture ? '<span style="background: #f59e0b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">PREVISÃO</span>' : ''}
                            </div>
                            <small style="color: #64748b;">${getDiaSemana(data)}</small>
                        </td>
                        <td class="text-right valor-positivo">
                            + R$ ${formatarMoeda(item.entradas)}
                        </td>
                        <td class="text-right valor-negativo">
                            - R$ ${formatarMoeda(item.saidas)}
                        </td>
                        <td class="text-right ${item.saldo >= 0 ? 'valor-positivo' : 'valor-negativo'}">
                            ${item.saldo >= 0 ? '+' : '-'} R$ ${formatarMoeda(Math.abs(item.saldo))}
                        </td>
                        <td class="text-right">
                            <span class="saldo-acumulado ${item.saldo_acumulado >= 0 ? 'valor-positivo' : 'valor-negativo'}">
                                R$ ${formatarMoeda(Math.abs(item.saldo_acumulado))}
                            </span>
                        </td>
                    </tr>
                `;
            }).join('')}
        </tbody>
        <tfoot style="background: #f9fafb; font-weight: 700;">
            <tr>
                <td>TOTAL DO PERÍODO</td>
                <td class="text-right valor-positivo">
                    + R$ ${formatarMoeda(dadosPeriodo.reduce((sum, d) => sum + d.entradas, 0))}
                </td>
                <td class="text-right valor-negativo">
                    - R$ ${formatarMoeda(dadosPeriodo.reduce((sum, d) => sum + d.saidas, 0))}
                </td>
                <td class="text-right ${dadosPeriodo.reduce((sum, d) => sum + d.saldo, 0) >= 0 ? 'valor-positivo' : 'valor-negativo'}">
                    R$ ${formatarMoeda(Math.abs(dadosPeriodo.reduce((sum, d) => sum + d.saldo, 0)))}
                </td>
                <td class="text-right"></td>
            </tr>
        </tfoot>
    `;
    
    tabela.innerHTML = html;
}

function atualizarResumo() {
    const hoje = new Date();
    const dadosPeriodo = dadosFluxo.filter(d => {
        const data = new Date(d.data);
        return data >= dataInicio && data <= dataFim;
    });
    
    const totalEntradas = dadosPeriodo.reduce((sum, d) => sum + d.entradas, 0);
    const totalSaidas = dadosPeriodo.reduce((sum, d) => sum + d.saidas, 0);
    const saldoPeriodo = totalEntradas - totalSaidas;
    
    const qtdEntradas = dadosPeriodo.filter(d => d.entradas > 0).length;
    const qtdSaidas = dadosPeriodo.filter(d => d.saidas > 0).length;
    
    // Projeção próximos 30 dias
    const dataProjecao = new Date(hoje);
    dataProjecao.setDate(hoje.getDate() + 30);
    
    const dadosProjecao = dadosFluxo.filter(d => {
        const data = new Date(d.data);
        return data > hoje && data <= dataProjecao;
    });
    
    const projecao30dias = dadosProjecao.reduce((sum, d) => sum + d.saldo, 0);
    
    // Atualizar UI
    document.getElementById('total-entradas').textContent = 'R$ ' + formatarMoeda(totalEntradas);
    document.getElementById('qtd-entradas').textContent = `${qtdEntradas} lançamento${qtdEntradas !== 1 ? 's' : ''}`;
    
    document.getElementById('total-saidas').textContent = 'R$ ' + formatarMoeda(totalSaidas);
    document.getElementById('qtd-saidas').textContent = `${qtdSaidas} lançamento${qtdSaidas !== 1 ? 's' : ''}`;
    
    document.getElementById('saldo-período').textContent = 'R$ ' + formatarMoeda(Math.abs(saldoPeriodo));
    document.getElementById('variacao-período').textContent = saldoPeriodo >= 0 ? 'Positivo' : 'Negativo';
    
    document.getElementById('projecao-30dias').textContent = 'R$ ' + formatarMoeda(Math.abs(projecao30dias));
}

// ===== EXPORTAÇÃO =====
function exportarExcel() {
    mostrarAlerta('Funcionalidade de exportação para Excel em desenvolvimento', 'info');
    // TODO: Implementar exportação real
}

function exportarPDF() {
    mostrarAlerta('Funcionalidade de exportação para PDF em desenvolvimento', 'info');
    // TODO: Implementar exportação real
}

// ===== UTILIDADES =====
function formatarData(data) {
    return new Date(data).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatarDataCurta(data) {
    return new Date(data).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit'
    });
}

function formatarDataInput(data) {
    const d = new Date(data);
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function formatarDataISO(data) {
    return data.toISOString().split('T')[0];
}

function getDiaSemana(data) {
    const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    return dias[new Date(data).getDay()];
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

function formatarMoedaCurta(valor) {
    if (valor >= 1000000) {
        return (valor / 1000000).toFixed(1) + 'M';
    } else if (valor >= 1000) {
        return (valor / 1000).toFixed(1) + 'K';
    }
    return valor.toFixed(0);
}

function mostrarAlerta(mensagem, tipo = 'info') {
    const alertaExistente = document.querySelector('.alert');
    if (alertaExistente) alertaExistente.remove();
    
    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo}`;
    alerta.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${tipo === 'success' ? '#10b981' : tipo === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.15);
        z-index: 10000;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 12px;
        animation: slideIn 0.3s ease;
    `;
    
    const icon = tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'exclamation-circle' : 'info-circle';
    alerta.innerHTML = `<i class="fas fa-${icon}"></i> ${mensagem}`;
    
    document.body.appendChild(alerta);
    
    setTimeout(() => {
        alerta.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => alerta.remove(), 300);
    }, 4000);
}

// Adicionar animações CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
