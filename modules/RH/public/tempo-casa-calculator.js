/* =================================================
   SCRIPT PARA CALCULAR TEMPO DE CASA DOS FUNCIONÁRIOS
   ================================================= */

// Dados simulados de funcionários com datas de admissáo reais
const funcionariosData = [
    {
        nome: "Andreia Silva",
        cargo: "Gerente RH", 
        dataAdmissao: "2016-07-15", // 8 anos e 3 meses
        avatar: "Interativo-Aluforce.jpg"
    },
    {
        nome: "Douglas Santos", 
        cargo: "Desenvolvedor",
        dataAdmissao: "2018-03-10", // 6 anos e 7 meses
        avatar: "Interativo-Aluforce.jpg"
    },
    {
        nome: "Helton Costa",
        cargo: "Designer", 
        dataAdmissao: "2019-08-22", // 5 anos e 2 meses
        avatar: "Interativo-Aluforce.jpg"
    },
    {
        nome: "Maria Santos",
        cargo: "Analista Financeiro",
        dataAdmissao: "2020-01-15", // 4 anos e 9 meses
        avatar: "Interativo-Aluforce.jpg"
    },
    {
        nome: "Joáo Silva",
        cargo: "Coordenador de Vendas", 
        dataAdmissao: "2021-05-03", // 3 anos e 5 meses
        avatar: "Interativo-Aluforce.jpg"
    }
];

// Funçáo para calcular tempo de casa
function calcularTempoCasa(dataAdmissao) {
    const hoje = new Date();
    const admissao = new Date(dataAdmissao);
    
    let anos = hoje.getFullYear() - admissao.getFullYear();
    let meses = hoje.getMonth() - admissao.getMonth();
    
    if (meses < 0) {
        anos--;
        meses += 12;
    }
    
    // Ajustar se o dia ainda náo passou no mês atual
    if (hoje.getDate() < admissao.getDate()) {
        meses--;
        if (meses < 0) {
            anos--;
            meses += 12;
        }
    }
    
    if (anos > 0 && meses > 0) {
        return `${anos} ${anos === 1 ? 'ano' : 'anos'} e ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    } else if (anos > 0) {
        return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
    } else if (meses > 0) {
        return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    } else {
        return 'Menos de 1 mês';
    }
}

// Funçáo para ordenar funcionários por tempo de casa (mais antigos primeiro)
function ordenarPorTempoCasa(funcionarios) {
    return funcionarios.sort((a, b) => {
        const dataA = new Date(a.dataAdmissao);
        const dataB = new Date(b.dataAdmissao);
        return dataA - dataB; // Mais antigos primeiro
    });
}

// Funçáo para atualizar o card de colaboradores com mais tempo de casa
function atualizarColaboradoresTempoCasa() {
    console.log('📊 Atualizando colaboradores com mais tempo de casa...');
    
    const funcionariosOrdenados = ordenarPorTempoCasa([...funcionariosData]);
    const top3 = funcionariosOrdenados.slice(0, 3);
    
    // Atualizar o card detalhado
    const cardBody = document.querySelector('.content-card .card-body');
    if (cardBody && cardBody.querySelector('.collaborator-item')) {
        const items = cardBody.querySelectorAll('.collaborator-item');
        
        items.forEach((item, index) => {
            if (top3[index]) {
                const funcionario = top3[index];
                const tempoCasa = calcularTempoCasa(funcionario.dataAdmissao);
                
                // Atualizar nome
                const nameElement = item.querySelector('.collaborator-name');
                if (nameElement) nameElement.textContent = funcionario.nome;
                
                // Atualizar cargo
                const roleElement = item.querySelector('.collaborator-role');
                if (roleElement) roleElement.textContent = funcionario.cargo;
                
                // Atualizar tempo de casa
                const timeElement = item.querySelector('.collaborator-time');
                if (timeElement) {
                    timeElement.textContent = tempoCasa;
                    
                    // Adicionar classe especial para o primeiro colocado
                    if (index === 0) {
                        timeElement.style.background = 'linear-gradient(135deg, #ffd700, #ffed4a)';
                        timeElement.style.color = '#92400e';
                    } else if (index === 1) {
                        timeElement.style.background = 'linear-gradient(135deg, #c0c0c0, #e5e7eb)';
                        timeElement.style.color = '#374151';
                    } else if (index === 2) {
                        timeElement.style.background = 'linear-gradient(135deg, #cd7f32, #d97706)';
                        timeElement.style.color = 'white';
                    }
                }
                
                // Atualizar avatar
                const avatarImg = item.querySelector('.collaborator-avatar img');
                if (avatarImg) {
                    avatarImg.alt = funcionario.nome;
                    avatarImg.src = funcionario.avatar;
                }
                
                console.log(`✅ ${funcionario.nome}: ${tempoCasa}`);
            }
        });
    }
    
    // Atualizar o card simples também
    const simpleCard = document.querySelector('.card-body');
    if (simpleCard && simpleCard.innerHTML.includes('fa-crown')) {
        const paragraphs = simpleCard.querySelectorAll('p');
        const medals = ['<i class="fas fa-crown" style="color: #ffd700"></i>', '<i class="fas fa-award" style="color: #c0c0c0"></i>', '<i class="fas fa-star" style="color: #cd7f32"></i>'];
        
        paragraphs.forEach((p, index) => {
            if (top3[index]) {
                const funcionario = top3[index];
                const tempoCasa = calcularTempoCasa(funcionario.dataAdmissao);
                p.innerHTML = `${medals[index]} ${funcionario.nome} - ${funcionario.cargo} (${tempoCasa})`;
            }
        });
    }
    
    console.log('🎉 Colaboradores com mais tempo de casa atualizados!');
}

// Funçáo para buscar dados reais do servidor (se disponível)
async function buscarDadosFuncionarios() {
    try {
        console.log('🔄 Tentando buscar dados reais dos funcionários...');
        
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/funcionarios', {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (response.ok) {
            const funcionarios = await response.json();
            
            // Filtrar funcionários com data de admissáo
            const funcionariosComData = funcionarios.filter(f => f.data_admissao || f.dataAdmissao);
            
            if (funcionariosComData.length > 0) {
                console.log(`✅ Encontrados ${funcionariosComData.length} funcionários com data de admissáo`);
                
                // Converter para o formato esperado
                const funcionariosFormatados = funcionariosComData.map(f => ({
                    nome: f.nome_completo || f.nome,
                    cargo: f.cargo || 'Funcionário',
                    dataAdmissao: f.data_admissao || f.dataAdmissao,
                    avatar: f.foto_url || f.avatar || 'Interativo-Aluforce.jpg'
                }));
                
                // Substituir dados simulados pelos reais
                funcionariosData.length = 0;
                funcionariosData.push(...funcionariosFormatados);
                
                // Atualizar interface
                atualizarColaboradoresTempoCasa();
                return true;
            }
        }
    } catch (error) {
        console.log('ℹ️ Dados do servidor náo disponíveis, usando dados simulados');
    }
    
    return false;
}

// Funçáo de inicializaçáo
function inicializarTempoCasa() {
    console.log('🚀 Inicializando sistema de tempo de casa...');
    
    // Tentar buscar dados reais primeiro
    buscarDadosFuncionarios().then(sucessoReal => {
        if (!sucessoReal) {
            // Se náo conseguir dados reais, usar simulados
            console.log('📋 Usando dados simulados para demonstraçáo');
            atualizarColaboradoresTempoCasa();
        }
    });
}

// Executar quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarTempoCasa);
} else {
    inicializarTempoCasa();
}

// Atualizar a cada 5 minutos (para casos onde a página fica aberta muito tempo)
setInterval(() => {
    atualizarColaboradoresTempoCasa();
}, 300000); // 5 minutos

// Funçáo global para atualizaçáo manual
window.atualizarTempoCasa = function() {
    console.log('🔄 Atualizaçáo manual solicitada...');
    inicializarTempoCasa();
};

console.log('📊 Script de tempo de casa carregado com sucesso!');