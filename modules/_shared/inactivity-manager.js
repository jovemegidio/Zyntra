/**
 * 🕐 SISTEMA DE GERENCIAMENTO DE INATIVIDADE
 * Monitora atividade do usuário e redireciona automaticamente para login após período de inatividade
 * 
 * @author Sistema Aluforce v2.0
 * @date 24/11/2025
 * 
 * CONFIGURAÇÕES:
 * - WARNING_TIME: Tempo até mostrar aviso (padrão: 14 minutos)
 * - LOGOUT_TIME: Tempo até logout automático (padrão: 15 minutos)
 * - COUNTDOWN_TIME: Tempo de contagem regressiva no popup (padrão: 60 segundos)
 */

(function() {
    'use strict';

    // ==========================================
    // CONFIGURAÇÕES
    // ==========================================
    const CONFIG = {
        WARNING_TIME: 14 * 60 * 1000,      // 14 minutos em ms
        LOGOUT_TIME: 15 * 60 * 1000,        // 15 minutos em ms
        COUNTDOWN_TIME: 60,                 // 60 segundos de contagem regressiva
        CHECK_INTERVAL: 1000,               // Verifica a cada 1 segundo
        EVENTS_TO_TRACK: ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
    };

    // ==========================================
    // VARIÁVEIS GLOBAIS
    // ==========================================
    let lastActivityTime = Date.now();
    let warningTimer = null;
    let logoutTimer = null;
    let countdownInterval = null;
    let isWarningShown = false;
    let countdownSeconds = CONFIG.COUNTDOWN_TIME;

    // ==========================================
    // CRIAR POPUP DE AVISO
    // ==========================================
    function createWarningModal() {
        // Verificar se já existe
        if (document.getElementById('inactivity-warning-modal')) {
            return;
        }

        const modalHTML = `
            <div id="inactivity-warning-modal" style="
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 999999;
                justify-content: center;
                align-items: center;
                animation: fadeIn 0.3s ease-in-out;
            ">
                <div style="
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    max-width: 500px;
                    width: 90%;
                    animation: slideInDown 0.3s ease-out;
                    overflow: hidden;
                ">
                    <!-- Header -->
                    <div style="
                        background: linear-gradient(135deg, #f59e0b 0%, #dc2626 100%);
                        color: white;
                        padding: 24px;
                        display: flex;
                        align-items: center;
                        gap: 16px;
                    ">
                        <i class="fas fa-exclamation-triangle" style="font-size: 32px;"></i>
                        <div>
                            <h3 style="margin: 0; font-size: 20px; font-weight: 600;">
                                Sessão Inativa
                            </h3>
                            <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">
                                Detectamos inatividade na sua sessão
                            </p>
                        </div>
                    </div>

                    <!-- Body -->
                    <div style="padding: 32px;">
                        <!-- Ícone Central -->
                        <div style="text-align: center; margin-bottom: 24px;">
                            <div style="
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                width: 80px;
                                height: 80px;
                                background: linear-gradient(135deg, #fef3c7 0%, #fee2e2 100%);
                                border-radius: 50%;
                                margin-bottom: 16px;
                            ">
                                <i class="fas fa-clock" style="font-size: 40px; color: #dc2626;"></i>
                            </div>
                        </div>

                        <!-- Mensagem -->
                        <p style="
                            text-align: center;
                            font-size: 16px;
                            color: #374151;
                            margin: 0 0 24px 0;
                            line-height: 1.6;
                        ">
                            Você será desconectado automaticamente em:
                        </p>

                        <!-- Contador -->
                        <div style="
                            text-align: center;
                            background: linear-gradient(135deg, #fef3c7 0%, #fee2e2 100%);
                            padding: 20px;
                            border-radius: 12px;
                            margin-bottom: 24px;
                        ">
                            <div id="inactivity-countdown" style="
                                font-size: 48px;
                                font-weight: 700;
                                color: #dc2626;
                                font-family: 'Courier New', monospace;
                            ">
                                01:00
                            </div>
                            <div style="
                                font-size: 14px;
                                color: #6b7280;
                                margin-top: 8px;
                                font-weight: 500;
                            ">
                                minutos
                            </div>
                        </div>

                        <!-- Informação -->
                        <div style="
                            background: #f3f4f6;
                            padding: 16px;
                            border-radius: 8px;
                            border-left: 4px solid #3b82f6;
                            margin-bottom: 24px;
                        ">
                            <p style="
                                margin: 0;
                                font-size: 14px;
                                color: #4b5563;
                                line-height: 1.5;
                            ">
                                <i class="fas fa-info-circle" style="color: #3b82f6; margin-right: 8px;"></i>
                                <strong>Quer continuar trabalhando?</strong><br>
                                Clique em "Continuar Sessão" ou movimente o mouse.
                            </p>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="
                        background: #f9fafb;
                        padding: 20px 32px;
                        display: flex;
                        gap: 12px;
                        justify-content: flex-end;
                        border-top: 1px solid #e5e7eb;
                    ">
                        <button id="inactivity-logout-btn" style="
                            background: white;
                            color: #6b7280;
                            border: 2px solid #e5e7eb;
                            padding: 12px 24px;
                            border-radius: 8px;
                            font-size: 15px;
                            font-weight: 500;
                            cursor: pointer;
                            transition: all 0.2s;
                        " 
                        onmouseover="this.style.borderColor='#dc2626'; this.style.color='#dc2626'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(220, 38, 38, 0.2)'"
                        onmouseout="this.style.borderColor='#e5e7eb'; this.style.color='#6b7280'; this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                            <i class="fas fa-sign-out-alt"></i> Sair Agora
                        </button>
                        <button id="inactivity-continue-btn" style="
                            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                            color: white;
                            border: none;
                            padding: 12px 32px;
                            border-radius: 8px;
                            font-size: 15px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.2s;
                            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                        "
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(16, 185, 129, 0.4)'"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(16, 185, 129, 0.3)'">
                            <i class="fas fa-check-circle"></i> Continuar Sessão
                        </button>
                    </div>
                </div>
            </div>

            <style>
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideInDown {
                    from { 
                        transform: translateY(-30px);
                        opacity: 0;
                    }
                    to { 
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
                #inactivity-countdown {
                    animation: pulse 1s ease-in-out infinite;
                }
            </style>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Adicionar event listeners
        document.getElementById('inactivity-continue-btn').addEventListener('click', continueSession);
        document.getElementById('inactivity-logout-btn').addEventListener('click', performLogout);
    }

    // ==========================================
    // MOSTRAR AVISO
    // ==========================================
    function showWarning() {
        if (isWarningShown) return;
        
        isWarningShown = true;
        countdownSeconds = CONFIG.COUNTDOWN_TIME;
        
        const modal = document.getElementById('inactivity-warning-modal');
        if (modal) {
            modal.style.display = 'flex';
            startCountdown();
            
            console.log('⚠️ [Inatividade] Popup de aviso exibido');
        }
    }

    // ==========================================
    // ESCONDER AVISO
    // ==========================================
    function hideWarning() {
        isWarningShown = false;
        
        const modal = document.getElementById('inactivity-warning-modal');
        if (modal) {
            modal.style.display = 'none';
            stopCountdown();
        }
    }

    // ==========================================
    // CONTAGEM REGRESSIVA
    // ==========================================
    function startCountdown() {
        stopCountdown(); // Limpar contador anterior se existir
        
        countdownInterval = setInterval(() => {
            countdownSeconds--;
            
            const minutes = Math.floor(countdownSeconds / 60);
            const seconds = countdownSeconds % 60;
            const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            const countdownEl = document.getElementById('inactivity-countdown');
            if (countdownEl) {
                countdownEl.textContent = display;
                
                // Mudar cor quando crítico (< 10 segundos)
                if (countdownSeconds <= 10) {
                    countdownEl.style.color = '#dc2626';
                    countdownEl.style.animation = 'pulse 0.5s ease-in-out infinite';
                }
            }
            
            // Logout automático quando chegar a zero
            if (countdownSeconds <= 0) {
                stopCountdown();
                performLogout();
            }
        }, 1000);
    }

    function stopCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    // ==========================================
    // ATUALIZAR ATIVIDADE
    // ==========================================
    function updateActivity() {
        lastActivityTime = Date.now();
        
        // Se o popup estava visível, esconder e resetar timers
        if (isWarningShown) {
            hideWarning();
            resetTimers();
            console.log('✅ [Inatividade] Atividade detectada - sessão continuada');
        }
    }

    // ==========================================
    // CONTINUAR SESSÁO
    // ==========================================
    function continueSession() {
        console.log('✅ [Inatividade] Usuário optou por continuar a sessão');
        hideWarning();
        updateActivity();
        resetTimers();
    }

    // ==========================================
    // REALIZAR LOGOUT
    // ==========================================
    function performLogout() {
        console.log('🚪 [Inatividade] Logout automático por inatividade');
        
        stopCountdown();
        
        // Limpar sessão
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.clear();
        
        // Redirecionar para login
        window.location.href = '/login.html';
    }

    // ==========================================
    // RESETAR TIMERS
    // ==========================================
    function resetTimers() {
        if (warningTimer) {
            clearTimeout(warningTimer);
        }
        if (logoutTimer) {
            clearTimeout(logoutTimer);
        }
        
        // Timer para mostrar aviso
        warningTimer = setTimeout(() => {
            showWarning();
        }, CONFIG.WARNING_TIME);
        
        // Timer para logout (caso não responda ao aviso)
        logoutTimer = setTimeout(() => {
            performLogout();
        }, CONFIG.LOGOUT_TIME);
    }

    // ==========================================
    // VERIFICAR INATIVIDADE
    // ==========================================
    function checkInactivity() {
        const now = Date.now();
        const inactiveTime = now - lastActivityTime;
        
        // Se passou do tempo de aviso e ainda não mostrou popup
        if (inactiveTime >= CONFIG.WARNING_TIME && !isWarningShown) {
            showWarning();
        }
        
        // Se passou do tempo total de logout
        if (inactiveTime >= CONFIG.LOGOUT_TIME) {
            performLogout();
        }
    }

    // ==========================================
    // INICIALIZAR SISTEMA
    // ==========================================
    function initInactivityManager() {
        console.log('🕐 [Inatividade] Sistema inicializado');
        console.log(`   ⏰ Aviso após: ${CONFIG.WARNING_TIME / 60000} minutos`);
        console.log(`   🚪 Logout após: ${CONFIG.LOGOUT_TIME / 60000} minutos`);
        
        // Criar modal
        createWarningModal();
        
        // Registrar eventos de atividade
        CONFIG.EVENTS_TO_TRACK.forEach(event => {
            document.addEventListener(event, updateActivity, true);
        });
        
        // Iniciar timers
        resetTimers();
        
        // Verificação periódica (backup)
        setInterval(checkInactivity, CONFIG.CHECK_INTERVAL);
    }

    // ==========================================
    // EXPORTAR PARA TESTES/DEBUG
    // ==========================================
    window.InactivityManager = {
        init: initInactivityManager,
        showWarning: showWarning,
        hideWarning: hideWarning,
        continueSession: continueSession,
        performLogout: performLogout,
        getLastActivity: () => lastActivityTime,
        getConfig: () => CONFIG
    };

    // ==========================================
    // AUTO-INICIALIZAR
    // ==========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInactivityManager);
    } else {
        initInactivityManager();
    }

})();
