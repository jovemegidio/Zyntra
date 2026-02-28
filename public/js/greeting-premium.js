/**
 * ALUFORCE - Premium Greeting System
 * Versão: 2025-12-16
 * 
 * Saudação inteligente com:
 * - Data completa em português
 * - Hora em tempo real
 * - Saudação contextual (Bom dia/Boa tarde/Boa noite)
 * - Mensagens motivacionais aleatórias
 */

(function() {
    'use strict';
    
    // Mensagens motivacionais por período do dia
    const messages = {
        madrugada: [
            "Trabalhando até tarde? Lembre-se de descansar!",
            "A dedicação faz a diferença. Cuide-se!",
            "Noite produtiva pela frente?",
            "Grandes conquistas exigem grandes esforços."
        ],
        manha: [
            "Pronto para mais um dia produtivo?",
            "Novos desafios aguardam. Vamos lá!",
            "Que seu dia seja repleto de conquistas!",
            "Energia renovada para grandes realizações!",
            "Um ótimo dia de trabalho começa agora!",
            "Café tomado? Vamos começar!",
            "Hoje é um novo dia de oportunidades."
        ],
        tarde: [
            "Continue com o excelente trabalho!",
            "A tarde é perfeita para finalizar projetos.",
            "Mantenha o foco, você está indo bem!",
            "Metade do dia, dobro de energia!",
            "Produtividade em alta. Continue assim!",
            "Hora de acelerar e entregar resultados!"
        ],
        noite: [
            "Finalizando o expediente com chave de ouro?",
            "Ótimo trabalho hoje! Hora de organizar.",
            "Revisando as conquistas do dia?",
            "Prepare-se para encerrar bem o dia!",
            "Missão do dia quase cumprida!"
        ]
    };
    
    // Nomes dos dias e meses em português
    const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    
    /**
     * Obtém dados da saudação baseado na hora atual
     */
    function getGreetingData() {
        const hora = new Date().getHours();
        let periodo, saudacao;
        
        if (hora >= 5 && hora < 12) {
            periodo = 'manha';
            saudacao = 'Bom dia,';
        } else if (hora >= 12 && hora < 18) {
            periodo = 'tarde';
            saudacao = 'Boa tarde,';
        } else if (hora >= 18 && hora < 24) {
            periodo = 'noite';
            saudacao = 'Boa noite,';
        } else {
            periodo = 'madrugada';
            saudacao = 'Olá,';
        }
        
        const msgs = messages[periodo];
        const mensagem = msgs[Math.floor(Math.random() * msgs.length)];
        
        return { periodo, saudacao, mensagem };
    }
    
    /**
     * Formata a data em português
     */
    function formatDate(date) {
        const diaSemana = dias[date.getDay()];
        const dia = date.getDate();
        const mes = meses[date.getMonth()];
        const ano = date.getFullYear();
        
        return `${diaSemana}, ${dia} de ${mes} de ${ano}`;
    }
    
    /**
     * Formata a hora
     */
    function formatTime(date) {
        return date.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit'
        });
    }
    
    /**
     * Inicializa a saudação premium
     */
    window.initPremiumGreeting = function() {
        const dateEl = document.getElementById('current-date');
        const timeEl = document.getElementById('current-time');
        const timeLabelEl = document.getElementById('greeting-time-label');
        const messageEl = document.getElementById('greeting-message');
        
        let lastPeriodo = null;
        
        function updateGreeting(forceMessage = false) {
            const now = new Date();
            const { periodo, saudacao, mensagem } = getGreetingData();
            
            // Atualiza data
            if (dateEl) {
                dateEl.textContent = formatDate(now);
            }
            
            // Atualiza hora
            if (timeEl) {
                timeEl.textContent = formatTime(now);
            }
            
            // Atualiza saudação
            if (timeLabelEl) {
                timeLabelEl.textContent = saudacao;
            }
            
            // Atualiza mensagem apenas se mudou o período ou é forçado
            if (messageEl && (forceMessage || periodo !== lastPeriodo)) {
                messageEl.textContent = mensagem;
                lastPeriodo = periodo;
            }
        }
        
        // Atualização inicial
        updateGreeting(true);
        
        // Atualiza o relógio a cada segundo para maior precisão
        setInterval(function() {
            const now = new Date();
            if (timeEl) {
                timeEl.textContent = formatTime(now);
            }
            
            // Verifica se mudou o período
            const { periodo } = getGreetingData();
            if (periodo !== lastPeriodo) {
                updateGreeting(true);
            }
        }, 1000);
        
        console.log('✅ Premium Greeting inicializado');
    };
    
    // Auto-inicializa quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            if (document.getElementById('greeting-time-label')) {
                initPremiumGreeting();
            }
        });
    } else {
        if (document.getElementById('greeting-time-label')) {
            initPremiumGreeting();
        }
    }
})();
