/**
 * Sistema de Backgrounds Automáticos
 * Troca automática de fundos com transição suave
 * Versão: 2026.02.14 - WebP otimizado (94% menor)
 */

(function() {
    'use strict';

    const CACHE_VERSION = '20260214';
    
    // Configurações de tempo (em milissegundos)
    const AUTO_CHANGE_INTERVAL = 60000; // 60 segundos - mais tempo para apreciar cada fundo
    const TRANSITION_DURATION = 3000; // 3 segundos - transição suave mas não muito lenta
    
    const BACKGROUNDS = [
        { id: 'image-1', name: 'Edifício', class: 'bg-image-1', url: '/Fundos/Fundos (1).webp?v=' + CACHE_VERSION },
        { id: 'image-2', name: 'Suculenta', class: 'bg-image-2', url: '/Fundos/Fundos (2).webp?v=' + CACHE_VERSION },
        { id: 'image-3', name: 'Girafa', class: 'bg-image-3', url: '/Fundos/Fundos (3).webp?v=' + CACHE_VERSION },
        { id: 'image-4', name: 'Pier', class: 'bg-image-4', url: '/Fundos/Fundos (4).webp?v=' + CACHE_VERSION },
        { id: 'image-5', name: 'Luminária', class: 'bg-image-5', url: '/Fundos/Fundos (5).webp?v=' + CACHE_VERSION },
        { id: 'image-6', name: 'Horizonte', class: 'bg-image-6', url: '/Fundos/Fundos (6).webp?v=' + CACHE_VERSION },
        { id: 'image-7', name: 'Planta', class: 'bg-image-7', url: '/Fundos/Fundos (7).webp?v=' + CACHE_VERSION },
        { id: 'image-8', name: 'Montanhas', class: 'bg-image-8', url: '/Fundos/Fundos (8).webp?v=' + CACHE_VERSION },
        { id: 'image-9', name: 'Via Láctea', class: 'bg-image-9', url: '/Fundos/Fundos (9).webp?v=' + CACHE_VERSION },
        { id: 'image-10', name: 'Ponte', class: 'bg-image-10', url: '/Fundos/Fundos (10).webp?v=' + CACHE_VERSION },
        { id: 'image-11', name: 'Estrelas', class: 'bg-image-11', url: '/Fundos/Fundos (11).webp?v=' + CACHE_VERSION },
        { id: 'image-12', name: 'Flores 1', class: 'bg-image-12', url: '/Fundos/Fundos (12).webp?v=' + CACHE_VERSION },
        { id: 'image-13', name: 'Flores 2', class: 'bg-image-13', url: '/Fundos/Fundos (13).webp?v=' + CACHE_VERSION },
        // Novos fundos - Adicionados em 2026-01-18 - Convertidos para WebP
        { id: 'image-14', name: 'Paisagem 1', class: 'bg-image-14', url: '/Fundos/Fundos (14).webp?v=' + CACHE_VERSION },
        { id: 'image-15', name: 'Paisagem 2', class: 'bg-image-15', url: '/Fundos/Fundos (15).webp?v=' + CACHE_VERSION },
        { id: 'image-16', name: 'Paisagem 3', class: 'bg-image-16', url: '/Fundos/Fundos (16).webp?v=' + CACHE_VERSION },
        { id: 'image-17', name: 'Paisagem 4', class: 'bg-image-17', url: '/Fundos/Fundos (17).webp?v=' + CACHE_VERSION },
        { id: 'image-18', name: 'Paisagem 5', class: 'bg-image-18', url: '/Fundos/Fundos (18).webp?v=' + CACHE_VERSION },
        { id: 'image-19', name: 'Paisagem 6', class: 'bg-image-19', url: '/Fundos/Fundos (19).webp?v=' + CACHE_VERSION },
        { id: 'image-20', name: 'Paisagem 7', class: 'bg-image-20', url: '/Fundos/Fundos (20).webp?v=' + CACHE_VERSION },
        { id: 'image-21', name: 'Paisagem 8', class: 'bg-image-21', url: '/Fundos/Fundos (21).webp?v=' + CACHE_VERSION },
        { id: 'image-22', name: 'Paisagem 9', class: 'bg-image-22', url: '/Fundos/Fundos (22).webp?v=' + CACHE_VERSION },
        { id: 'image-23', name: 'Paisagem 10', class: 'bg-image-23', url: '/Fundos/Fundos (23).webp?v=' + CACHE_VERSION },
        { id: 'image-24', name: 'Paisagem 11', class: 'bg-image-24', url: '/Fundos/Fundos (24).webp?v=' + CACHE_VERSION },
        { id: 'image-25', name: 'Paisagem 12', class: 'bg-image-25', url: '/Fundos/Fundos (25).webp?v=' + CACHE_VERSION },
        { id: 'image-26', name: 'Paisagem 13', class: 'bg-image-26', url: '/Fundos/Fundos (26).webp?v=' + CACHE_VERSION }
    ];

    let currentIndex = 0;
    let backgroundElement = null;
    let nextBackgroundElement = null;
    let autoChangeTimer = null;
    let isInitialized = false;
    let isTransitioning = false;
    let preloadedImages = new Set(); // Track which images are already loaded

    /**
     * Inicializa o sistema de backgrounds automáticos
     */
    function init() {
        if (isInitialized) return;
        
        // Criar elementos de background (dois para transição suave)
        createBackgroundElements();
        
        // Carregar preferência ou iniciar aleatório
        if (!loadPreferredBackground()) {
            currentIndex = Math.floor(Math.random() * BACKGROUNDS.length);
        }
        
        // Pré-carregar APENAS o fundo atual + próximo (não todos 26!)
        preloadImage(currentIndex).then(() => {
            applyBackground(currentIndex, false);
            // Depois que o primeiro carregou, pré-carregar o próximo
            const nextIdx = (currentIndex + 1) % BACKGROUNDS.length;
            preloadImage(nextIdx);
        });
        
        // Iniciar troca automática
        startAutoChange();
        
        // Pausar quando a aba não estiver visível
        setupVisibilityHandler();
        
        isInitialized = true;
    }

    /**
     * Pré-carrega UMA imagem e retorna Promise
     */
    function preloadImage(index) {
        return new Promise((resolve) => {
            const bg = BACKGROUNDS[index];
            if (!bg || preloadedImages.has(index)) {
                resolve();
                return;
            }
            const img = new Image();
            img.onload = () => {
                preloadedImages.add(index);
                resolve();
            };
            img.onerror = () => resolve(); // não bloquear se falhar
            img.src = bg.url;
        });
    }

    /**
     * Pré-carrega os próximos N fundos em background (idle time)
     */
    function preloadAhead(fromIndex, count) {
        if (typeof requestIdleCallback === 'function') {
            let loaded = 0;
            function loadNext() {
                if (loaded >= count) return;
                const idx = (fromIndex + loaded + 1) % BACKGROUNDS.length;
                preloadImage(idx).then(() => {
                    loaded++;
                    if (loaded < count) {
                        requestIdleCallback(loadNext);
                    }
                });
            }
            requestIdleCallback(loadNext);
        } else {
            // Fallback: carregar 3 próximos com delay de 2s entre cada
            for (let i = 1; i <= Math.min(count, 3); i++) {
                const idx = (fromIndex + i) % BACKGROUNDS.length;
                setTimeout(() => preloadImage(idx), i * 2000);
            }
        }
    }

    /**
     * Cria os elementos de background para transição
     */
    function createBackgroundElements() {
        // Elemento principal de background
        backgroundElement = document.createElement('div');
        backgroundElement.className = 'dashboard-background';
        backgroundElement.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -2;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            transition: opacity ${TRANSITION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 1;
        `;
        
        // Elemento secundário para transição suave (crossfade)
        nextBackgroundElement = document.createElement('div');
        nextBackgroundElement.className = 'dashboard-background-next';
        nextBackgroundElement.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -3;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            transition: opacity ${TRANSITION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 0;
        `;
        
        document.body.insertBefore(nextBackgroundElement, document.body.firstChild);
        document.body.insertBefore(backgroundElement, document.body.firstChild);
    }

    /**
     * Aplica um background com transição suave
     */
    function applyBackground(index, animate = true) {
        if (isTransitioning && animate) return;
        
        const bg = BACKGROUNDS[index];
        if (!bg) return;
        
        if (animate) {
            isTransitioning = true;
            
            // Preparar próximo background no elemento secundário
            nextBackgroundElement.className = 'dashboard-background-next';
            nextBackgroundElement.classList.add(bg.class);
            nextBackgroundElement.style.opacity = '0';
            nextBackgroundElement.style.zIndex = '-1';
            
            // Aguardar um frame para garantir que o estilo foi aplicado
            requestAnimationFrame(() => {
                // Fade in do próximo background
                nextBackgroundElement.style.opacity = '1';
                
                // Fade out do background atual
                backgroundElement.style.opacity = '0';
                
                // Atualizar contraste sincronizado com a transição do fundo
                // Inicia com 30% da transição para suavizar junto com o fundo
                setTimeout(() => {
                    detectAndApplyContrast(bg.id);
                }, TRANSITION_DURATION * 0.30);
                
                // Após a transição, trocar os elementos
                setTimeout(() => {
                    // Trocar classes
                    backgroundElement.className = 'dashboard-background';
                    backgroundElement.classList.add(bg.class);
                    backgroundElement.style.opacity = '1';
                    backgroundElement.style.zIndex = '-2';
                    
                    // Resetar elemento secundário
                    nextBackgroundElement.style.opacity = '0';
                    nextBackgroundElement.style.zIndex = '-3';
                    nextBackgroundElement.className = 'dashboard-background-next';
                    
                    isTransitioning = false;
                }, TRANSITION_DURATION);
            });
        } else {
            // Aplicação direta sem animação (inicial)
            backgroundElement.className = 'dashboard-background';
            backgroundElement.classList.add(bg.class);
            detectAndApplyContrast(bg.id);
        }
        
        currentIndex = index;
    }

    /**
     * Avança para o próximo background (pré-carrega antes de transicionar)
     */
    function nextBackground() {
        const nextIndex = (currentIndex + 1) % BACKGROUNDS.length;
        // Garantir que a imagem já está carregada antes de transicionar
        preloadImage(nextIndex).then(() => {
            applyBackground(nextIndex, true);
            // Pré-carregar os próximos 2 em idle time
            preloadAhead(nextIndex, 2);
        });
    }

    /**
     * Inicia a troca automática de backgrounds
     */
    function startAutoChange() {
        if (autoChangeTimer) {
            clearInterval(autoChangeTimer);
        }
        
        autoChangeTimer = setInterval(() => {
            if (!document.hidden && !isTransitioning) {
                nextBackground();
            }
        }, AUTO_CHANGE_INTERVAL);
    }

    /**
     * Para a troca automática
     */
    function stopAutoChange() {
        if (autoChangeTimer) {
            clearInterval(autoChangeTimer);
            autoChangeTimer = null;
        }
    }

    /**
     * Configura handler de visibilidade da aba
     */
    function setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopAutoChange();
            } else {
                startAutoChange();
            }
        });
    }

    /**
     * Detecta se o background é escuro e aplica contraste adequado
     */
    function detectAndApplyContrast(bgId) {
        // Fundos escuros (precisam de cards claros) - bg-contrast-light
        const darkBackgrounds = [
            'image-1',  // Edifício - escuro
            'image-4',  // Pier - escuro
            'image-6',  // Horizonte - escuro
            'image-8',  // Montanhas - pode ser escuro
            'image-9',  // Via Láctea - escuro
            'image-10', // Ponte - escuro
            'image-11'  // Estrelas - escuro
        ];
        
        // Fundos claros (precisam de cards escuros) - bg-contrast-dark
        const lightBackgrounds = [
            'image-2',  // Suculenta - claro
            'image-3',  // Girafa - claro
            'image-5',  // Luminária - claro
            'image-7',  // Planta - claro
            'image-12', // Flores 1 - claro
            'image-13'  // Flores 2 - claro
        ];

        const isDark = darkBackgrounds.includes(bgId);
        const isLight = lightBackgrounds.includes(bgId);
        const dashboardArea = document.getElementById('dashboard-area');

        if (dashboardArea) {
            if (isDark) {
                // Fundo escuro = cards claros
                dashboardArea.classList.add('bg-contrast-light');
                dashboardArea.classList.remove('bg-contrast-dark');
            } else if (isLight) {
                // Fundo claro = cards escuros
                dashboardArea.classList.add('bg-contrast-dark');
                dashboardArea.classList.remove('bg-contrast-light');
            } else {
                // Default: tratar como escuro
                dashboardArea.classList.add('bg-contrast-light');
                dashboardArea.classList.remove('bg-contrast-dark');
            }
        }
    }

    /**
     * Seleciona um fundo específico pelo índice ou id
     * @param {number|string} indexOrId - Índice numérico ou id do fundo (ex: 'image-1')
     * @param {boolean} animate - Se deve animar a transição (default: true)
     */
    function selectBackground(indexOrId, animate = true) {
        let index;
        
        if (typeof indexOrId === 'number') {
            index = indexOrId;
        } else if (typeof indexOrId === 'string') {
            // Buscar pelo id
            index = BACKGROUNDS.findIndex(bg => bg.id === indexOrId);
            if (index === -1) {
                console.warn(`Background '${indexOrId}' não encontrado`);
                return false;
            }
        } else {
            console.warn('selectBackground: parmetro inválido');
            return false;
        }
        
        if (index < 0 || index >= BACKGROUNDS.length) {
            console.warn(`Índice de background inválido: ${index}`);
            return false;
        }
        
        // Para a troca automática quando o usuário seleciona manualmente
        stopAutoChange();
        
        // Pré-carregar e aplicar o fundo com transição suave
        preloadImage(index).then(() => {
            applyBackground(index, animate);
        });
        
        // Salva a preferência do usuário
        localStorage.setItem('preferred_background', BACKGROUNDS[index].id);
        
        return true;
    }

    /**
     * Carrega o fundo preferido do usuário (se houver)
     */
    function loadPreferredBackground() {
        const preferred = localStorage.getItem('preferred_background');
        if (preferred) {
            const index = BACKGROUNDS.findIndex(bg => bg.id === preferred);
            if (index !== -1) {
                currentIndex = index;
                return true;
            }
        }
        return false;
    }

    /**
     * Limpa a preferência e volta ao modo automático
     */
    function clearPreference() {
        localStorage.removeItem('preferred_background');
        startAutoChange();
        console.log('🔄 Modo automático de backgrounds ativado');
    }

    /**
     * API pública
     */
    window.BackgroundManager = {
        init,
        nextBackground,
        selectBackground,
        startAutoChange,
        stopAutoChange,
        clearPreference,
        loadPreferredBackground,
        getCurrentBackground: () => BACKGROUNDS[currentIndex],
        getCurrentIndex: () => currentIndex,
        getAvailableBackgrounds: () => [...BACKGROUNDS]
    };

    // Auto-inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
