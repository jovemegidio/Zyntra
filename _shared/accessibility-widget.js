/**
 * ALUFORCE - Widget de Acessibilidade
 * Adiciona controles de acessibilidade no cabeçalho do sistema
 * Versão: 1.0.0 - 2026-02-24
 */
(function() {
    'use strict';

    // Guard: evitar duplicação se o script for carregado mais de uma vez
    if (window.__a11yWidgetLoaded) return;
    window.__a11yWidgetLoaded = true;

    // Configurações salvas no localStorage
    const STORAGE_KEY = 'aluforce_a11y_settings';
    
    function getSettings() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch(e) {
            return {};
        }
    }
    
    function saveSettings(settings) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    // Aplicar configurações salvas
    function applySettings() {
        const s = getSettings();
        const html = document.documentElement;
        
        // Tamanho da fonte
        if (s.fontSize) {
            html.style.fontSize = s.fontSize + '%';
        }
        
        // Alto contraste
        if (s.highContrast) {
            document.body.classList.add('a11y-high-contrast');
        }
        
        // Escala de cinza
        if (s.grayscale) {
            document.body.classList.add('a11y-grayscale');
        }
        
        // Espaçamento de texto
        if (s.textSpacing) {
            document.body.classList.add('a11y-text-spacing');
        }
        
        // Cursor grande
        if (s.bigCursor) {
            document.body.classList.add('a11y-big-cursor');
        }
        
        // Destaque de links
        if (s.highlightLinks) {
            document.body.classList.add('a11y-highlight-links');
        }
    }

    // Criar estilos CSS do widget
    function createStyles() {
        const style = document.createElement('style');
        style.id = 'a11y-widget-styles';
        style.textContent = `
            /* Widget de Acessibilidade - Botão no Header */
            .a11y-header-btn {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border-radius: 8px;
                border: none;
                background: rgba(255,255,255,0.1);
                color: white;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 16px;
            }
            .a11y-header-btn:hover {
                background: rgba(255,255,255,0.2);
                transform: scale(1.05);
            }
            .a11y-header-btn.active {
                background: rgba(255,255,255,0.25);
                box-shadow: 0 0 0 2px rgba(255,255,255,0.3);
            }

            /* Painel de Acessibilidade */
            .a11y-panel {
                display: none;
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                width: 320px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.15), 0 2px 10px rgba(0,0,0,0.08);
                z-index: 99999;
                overflow: hidden;
                animation: a11ySlideDown 0.2s ease;
            }
            .a11y-panel.open {
                display: block;
            }
            @keyframes a11ySlideDown {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .a11y-panel-header {
                background: linear-gradient(135deg, #f97316, #ea580c);
                color: white;
                padding: 14px 18px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .a11y-panel-header h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .a11y-panel-close {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                border-radius: 4px;
                transition: background 0.2s;
            }
            .a11y-panel-close:hover {
                background: rgba(255,255,255,0.2);
            }

            .a11y-panel-body {
                padding: 12px 16px;
                max-height: 400px;
                overflow-y: auto;
            }

            .a11y-option {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 12px;
                border-radius: 8px;
                margin-bottom: 4px;
                transition: background 0.15s;
                cursor: pointer;
            }
            .a11y-option:hover {
                background: #f8f9fa;
            }
            .a11y-option-label {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
                color: #333;
            }
            .a11y-option-icon {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                flex-shrink: 0;
            }

            /* Toggle Switch */
            .a11y-toggle {
                width: 40px;
                height: 22px;
                border-radius: 11px;
                background: #ddd;
                position: relative;
                cursor: pointer;
                transition: background 0.3s;
                flex-shrink: 0;
            }
            .a11y-toggle.active {
                background: #f97316;
            }
            .a11y-toggle::after {
                content: '';
                position: absolute;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: white;
                top: 2px;
                left: 2px;
                transition: transform 0.3s;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            }
            .a11y-toggle.active::after {
                transform: translateX(18px);
            }

            /* Controle de tamanho de fonte */
            .a11y-font-control {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                margin-bottom: 8px;
            }
            .a11y-font-btn {
                width: 32px;
                height: 32px;
                border-radius: 6px;
                border: 1px solid #ddd;
                background: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                font-weight: 600;
                color: #333;
                transition: all 0.2s;
            }
            .a11y-font-btn:hover {
                border-color: #f97316;
                color: #f97316;
                background: #fff7ed;
            }
            .a11y-font-value {
                font-size: 13px;
                color: #666;
                min-width: 40px;
                text-align: center;
            }

            .a11y-reset-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                width: 100%;
                padding: 10px;
                border: 1px solid #e5e5e5;
                border-radius: 8px;
                background: white;
                color: #666;
                font-size: 12px;
                cursor: pointer;
                margin-top: 8px;
                transition: all 0.2s;
            }
            .a11y-reset-btn:hover {
                border-color: #f97316;
                color: #f97316;
                background: #fff7ed;
            }

            .a11y-section-label {
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #999;
                padding: 8px 12px 4px;
                font-weight: 600;
            }

            /* Classes de acessibilidade aplicadas ao body */
            .a11y-high-contrast {
                filter: contrast(1.4) !important;
            }
            .a11y-grayscale {
                filter: grayscale(1) !important;
            }
            .a11y-high-contrast.a11y-grayscale {
                filter: contrast(1.4) grayscale(1) !important;
            }
            .a11y-text-spacing {
                letter-spacing: 0.05em !important;
                word-spacing: 0.1em !important;
            }
            .a11y-text-spacing * {
                letter-spacing: inherit !important;
                word-spacing: inherit !important;
            }
            .a11y-big-cursor, .a11y-big-cursor * {
                cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M5 2l20 14h-12l7 12-4 2-7-12-4 10z' fill='%23000' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E") 4 4, auto !important;
            }
            .a11y-highlight-links a {
                outline: 2px solid #f97316 !important;
                outline-offset: 2px !important;
                text-decoration: underline !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Criar o botão e painel no header
    function createWidget() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) {
            console.warn('[A11Y Widget] .header-right não encontrado');
            return;
        }

        // Container do widget
        const container = document.createElement('div');
        container.style.position = 'relative';
        container.style.display = 'flex';
        container.style.alignItems = 'center';

        // Botão no header
        const btn = document.createElement('button');
        btn.className = 'a11y-header-btn header-btn';
        btn.title = 'Acessibilidade';
        btn.innerHTML = '<i class="fas fa-universal-access"></i>';
        btn.setAttribute('aria-label', 'Abrir menu de acessibilidade');
        
        // Painel
        const panel = document.createElement('div');
        panel.className = 'a11y-panel';
        panel.innerHTML = `
            <div class="a11y-panel-header">
                <h3><i class="fas fa-universal-access"></i> Acessibilidade</h3>
                <button class="a11y-panel-close" title="Fechar"><i class="fas fa-times"></i></button>
            </div>
            <div class="a11y-panel-body">
                <div class="a11y-section-label">Tamanho do Texto</div>
                <div class="a11y-font-control">
                    <button class="a11y-font-btn" data-action="decrease" title="Diminuir fonte">A-</button>
                    <span class="a11y-font-value" id="a11y-font-display">100%</span>
                    <button class="a11y-font-btn" data-action="increase" title="Aumentar fonte">A+</button>
                    <button class="a11y-font-btn" data-action="reset-font" title="Resetar fonte" style="margin-left:4px;">
                        <i class="fas fa-undo" style="font-size:11px;"></i>
                    </button>
                </div>

                <div class="a11y-section-label">Opções Visuais</div>
                
                <div class="a11y-option" data-setting="highContrast">
                    <div class="a11y-option-label">
                        <div class="a11y-option-icon" style="background:#fef3c7;color:#d97706;">
                            <i class="fas fa-adjust"></i>
                        </div>
                        <span>Alto Contraste</span>
                    </div>
                    <div class="a11y-toggle" id="a11y-toggle-highContrast"></div>
                </div>
                
                <div class="a11y-option" data-setting="grayscale">
                    <div class="a11y-option-label">
                        <div class="a11y-option-icon" style="background:#f3f4f6;color:#6b7280;">
                            <i class="fas fa-palette"></i>
                        </div>
                        <span>Escala de Cinza</span>
                    </div>
                    <div class="a11y-toggle" id="a11y-toggle-grayscale"></div>
                </div>
                
                <div class="a11y-option" data-setting="textSpacing">
                    <div class="a11y-option-label">
                        <div class="a11y-option-icon" style="background:#ede9fe;color:#7c3aed;">
                            <i class="fas fa-text-width"></i>
                        </div>
                        <span>Espaçamento de Texto</span>
                    </div>
                    <div class="a11y-toggle" id="a11y-toggle-textSpacing"></div>
                </div>

                <div class="a11y-option" data-setting="bigCursor">
                    <div class="a11y-option-label">
                        <div class="a11y-option-icon" style="background:#fce7f3;color:#db2777;">
                            <i class="fas fa-mouse-pointer"></i>
                        </div>
                        <span>Cursor Grande</span>
                    </div>
                    <div class="a11y-toggle" id="a11y-toggle-bigCursor"></div>
                </div>

                <div class="a11y-option" data-setting="highlightLinks">
                    <div class="a11y-option-label">
                        <div class="a11y-option-icon" style="background:#dbeafe;color:#2563eb;">
                            <i class="fas fa-link"></i>
                        </div>
                        <span>Destacar Links</span>
                    </div>
                    <div class="a11y-toggle" id="a11y-toggle-highlightLinks"></div>
                </div>

                <button class="a11y-reset-btn" id="a11y-reset-all">
                    <i class="fas fa-undo"></i> Restaurar Padrão
                </button>
            </div>
        `;

        container.appendChild(btn);
        container.appendChild(panel);

        // Inserir antes do greeting do usuário
        const userGreeting = headerRight.querySelector('.user-greeting');
        if (userGreeting) {
            headerRight.insertBefore(container, userGreeting);
        } else {
            headerRight.appendChild(container);
        }

        // Event listeners
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = panel.classList.contains('open');
            panel.classList.toggle('open');
            btn.classList.toggle('active');
            if (!isOpen) syncToggles();
        });

        panel.querySelector('.a11y-panel-close').addEventListener('click', function() {
            panel.classList.remove('open');
            btn.classList.remove('active');
        });

        // Fechar ao clicar fora
        document.addEventListener('click', function(e) {
            if (!container.contains(e.target)) {
                panel.classList.remove('open');
                btn.classList.remove('active');
            }
        });

        // Toggles de opções
        panel.querySelectorAll('.a11y-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                const setting = this.dataset.setting;
                const toggle = this.querySelector('.a11y-toggle');
                const s = getSettings();
                s[setting] = !s[setting];
                saveSettings(s);
                toggle.classList.toggle('active', s[setting]);
                
                // Aplicar/remover classe
                const classMap = {
                    highContrast: 'a11y-high-contrast',
                    grayscale: 'a11y-grayscale',
                    textSpacing: 'a11y-text-spacing',
                    bigCursor: 'a11y-big-cursor',
                    highlightLinks: 'a11y-highlight-links'
                };
                if (classMap[setting]) {
                    document.body.classList.toggle(classMap[setting], s[setting]);
                }
            });
        });

        // Controle de fonte
        panel.querySelectorAll('.a11y-font-btn').forEach(function(fontBtn) {
            fontBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const action = this.dataset.action;
                const s = getSettings();
                let size = s.fontSize || 100;
                
                if (action === 'increase' && size < 150) size += 10;
                else if (action === 'decrease' && size > 70) size -= 10;
                else if (action === 'reset-font') size = 100;
                
                s.fontSize = size;
                saveSettings(s);
                document.documentElement.style.fontSize = size + '%';
                document.getElementById('a11y-font-display').textContent = size + '%';
            });
        });

        // Reset total
        panel.querySelector('#a11y-reset-all').addEventListener('click', function() {
            localStorage.removeItem(STORAGE_KEY);
            document.documentElement.style.fontSize = '';
            document.body.classList.remove('a11y-high-contrast', 'a11y-grayscale', 'a11y-text-spacing', 'a11y-big-cursor', 'a11y-highlight-links');
            syncToggles();
            document.getElementById('a11y-font-display').textContent = '100%';
        });

        function syncToggles() {
            const s = getSettings();
            ['highContrast', 'grayscale', 'textSpacing', 'bigCursor', 'highlightLinks'].forEach(function(key) {
                const el = document.getElementById('a11y-toggle-' + key);
                if (el) el.classList.toggle('active', !!s[key]);
            });
            const fontDisplay = document.getElementById('a11y-font-display');
            if (fontDisplay) fontDisplay.textContent = (s.fontSize || 100) + '%';
        }
    }

    // Inicializar
    function init() {
        createStyles();
        applySettings();
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createWidget);
        } else {
            createWidget();
        }
    }

    init();
})();
