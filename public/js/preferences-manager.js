/**
 * Preferences Manager
 * Gerencia preferências do usuário (tamanho fonte, tema, etc.)
 */

(function() {
    'use strict';

    const PreferencesManager = {
        modal: null,
        preferences: {
            darkMode: false,
            fontSize: 'medium',
            autoContrast: true,
            desktopNotifications: true,
            notificationSound: true,
            language: 'pt-BR',
            autoUpdate: true,
            animations: true,
            cache: true
        },

        init() {
            this.modal = document.getElementById('preferences-modal');
            
            if (!this.modal) {
                console.error('Preferences modal not found');
                return;
            }

            this.loadPreferences();
            this.setupEventListeners();
            this.setupSearchFilter();
            this.applyPreferences();
        },

        setupSearchFilter() {
            const searchInput = document.getElementById('pref-search');
            if (!searchInput) return;

            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase().trim();
                const items = this.modal.querySelectorAll('.settings-item');
                const sections = this.modal.querySelectorAll('.settings-section');

                if (!searchTerm) {
                    // Mostrar todos
                    items.forEach(item => item.style.display = '');
                    sections.forEach(section => section.style.display = '');
                    return;
                }

                // Filtrar items
                items.forEach(item => {
                    const label = item.querySelector('.settings-item-label')?.textContent.toLowerCase() || '';
                    const desc = item.querySelector('.settings-item-description')?.textContent.toLowerCase() || '';
                    const matches = label.includes(searchTerm) || desc.includes(searchTerm);
                    item.style.display = matches ? '' : 'none';
                });

                // Esconder seções vazias
                sections.forEach(section => {
                    const visibleItems = section.querySelectorAll('.settings-item:not([style*="display: none"])');
                    section.style.display = visibleItems.length > 0 ? '' : 'none';
                });
            });
        },

        setupEventListeners() {
            // Open button (novo botão no dropdown)
            const preferencesOption = document.getElementById('preferences-option');
            if (preferencesOption) {
                preferencesOption.addEventListener('click', () => {
                    this.openModal();
                    // Fechar dropdown
                    const dropdown = document.getElementById('user-dropdown');
                    if (dropdown) dropdown.classList.remove('show');
                });
            }

            // Close button
            const closeBtn = document.getElementById('preferences-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeModal());
            }

            // Click outside to close
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });

            // ESC to close
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.modal.getAttribute('aria-hidden') === 'false') {
                    this.closeModal();
                }
            });

            // Save button (optional - auto save enabled)
            const saveBtn = document.getElementById('preferences-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => this.savePreferences());
            }

            // Reset button
            const resetBtn = document.getElementById('preferences-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => this.resetToDefaults());
            }

            // Track changes with auto-save
            this.setupChangeListeners();
        },

        setupChangeListeners() {
            // Dark mode
            const darkModeToggle = document.getElementById('setting-dark-mode');
            if (darkModeToggle) {
                darkModeToggle.addEventListener('change', (e) => {
                    this.preferences.darkMode = e.target.checked;
                    this.autoSave();
                });
            }

            // Font size
            const fontSizeSelect = document.getElementById('setting-font-size');
            if (fontSizeSelect) {
                fontSizeSelect.addEventListener('change', (e) => {
                    this.preferences.fontSize = e.target.value;
                    this.applyFontSize(e.target.value);
                    this.autoSave();
                });
            }

            // Auto contrast
            const autoContrastToggle = document.getElementById('setting-auto-contrast');
            if (autoContrastToggle) {
                autoContrastToggle.addEventListener('change', (e) => {
                    this.preferences.autoContrast = e.target.checked;
                    this.autoSave();
                });
            }

            // Desktop notifications
            const desktopNotifToggle = document.getElementById('setting-desktop-notifications');
            if (desktopNotifToggle) {
                desktopNotifToggle.addEventListener('change', (e) => {
                    this.preferences.desktopNotifications = e.target.checked;
                    this.autoSave();
                });
            }

            // Notification sound
            const notifSoundToggle = document.getElementById('setting-notification-sound');
            if (notifSoundToggle) {
                notifSoundToggle.addEventListener('change', (e) => {
                    this.preferences.notificationSound = e.target.checked;
                    this.autoSave();
                });
            }

            // Language
            const languageSelect = document.getElementById('setting-language');
            if (languageSelect) {
                languageSelect.addEventListener('change', (e) => {
                    this.preferences.language = e.target.value;
                    this.autoSave();
                });
            }

            // Auto update
            const autoUpdateToggle = document.getElementById('setting-auto-update');
            if (autoUpdateToggle) {
                autoUpdateToggle.addEventListener('change', (e) => {
                    this.preferences.autoUpdate = e.target.checked;
                    this.autoSave();
                });
            }

            // Animations
            const animationsToggle = document.getElementById('setting-animations');
            if (animationsToggle) {
                animationsToggle.addEventListener('change', (e) => {
                    this.preferences.animations = e.target.checked;
                    this.applyAnimations(e.target.checked);
                    this.autoSave();
                });
            }

            // Cache
            const cacheToggle = document.getElementById('setting-cache');
            if (cacheToggle) {
                cacheToggle.addEventListener('change', (e) => {
                    this.preferences.cache = e.target.checked;
                    this.autoSave();
                });
            }
        },

        autoSave() {
            // Auto-save silencioso
            localStorage.setItem('user-preferences', JSON.stringify(this.preferences));
            this.applyPreferences();
        },

        loadPreferences() {
            const saved = localStorage.getItem('user-preferences');
            if (saved) {
                try {
                    this.preferences = { ...this.preferences, ...JSON.parse(saved) };
                } catch (e) {
                    console.error('Error loading preferences:', e);
                }
            }
        },

        savePreferences() {
            localStorage.setItem('user-preferences', JSON.stringify(this.preferences));
            this.applyPreferences();
            this.showNotification('Preferências salvas com sucesso!', 'success');
            
            setTimeout(() => {
                this.closeModal();
            }, 1000);
        },

        applyPreferences() {
            // Apply dark mode
            if (this.preferences.darkMode) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }

            // Apply font size
            this.applyFontSize(this.preferences.fontSize);

            // Apply animations
            this.applyAnimations(this.preferences.animations);

            // Update UI
            this.updateUI();
        },

        applyFontSize(size) {
            const body = document.body;
            body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
            body.classList.add(`font-${size}`);
        },

        applyAnimations(enabled) {
            if (enabled) {
                document.body.classList.remove('no-animations');
            } else {
                document.body.classList.add('no-animations');
            }
        },

        updateUI() {
            // Update dark mode toggle
            const darkModeToggle = document.getElementById('setting-dark-mode');
            if (darkModeToggle) {
                darkModeToggle.checked = this.preferences.darkMode;
            }

            // Update font size select
            const fontSizeSelect = document.getElementById('setting-font-size');
            if (fontSizeSelect) {
                fontSizeSelect.value = this.preferences.fontSize;
            }

            // Update auto contrast
            const autoContrastToggle = document.getElementById('setting-auto-contrast');
            if (autoContrastToggle) {
                autoContrastToggle.checked = this.preferences.autoContrast;
            }

            // Update desktop notifications
            const desktopNotifToggle = document.getElementById('setting-desktop-notifications');
            if (desktopNotifToggle) {
                desktopNotifToggle.checked = this.preferences.desktopNotifications;
            }

            // Update notification sound
            const notifSoundToggle = document.getElementById('setting-notification-sound');
            if (notifSoundToggle) {
                notifSoundToggle.checked = this.preferences.notificationSound;
            }

            // Update language
            const languageSelect = document.getElementById('setting-language');
            if (languageSelect) {
                languageSelect.value = this.preferences.language;
            }

            // Update auto update
            const autoUpdateToggle = document.getElementById('setting-auto-update');
            if (autoUpdateToggle) {
                autoUpdateToggle.checked = this.preferences.autoUpdate;
            }

            // Update animations
            const animationsToggle = document.getElementById('setting-animations');
            if (animationsToggle) {
                animationsToggle.checked = this.preferences.animations;
            }

            // Update cache
            const cacheToggle = document.getElementById('setting-cache');
            if (cacheToggle) {
                cacheToggle.checked = this.preferences.cache;
            }
        },

        resetToDefaults() {
            if (!confirm('Deseja realmente restaurar todas as configurações padrão?')) {
                return;
            }

            this.preferences = {
                darkMode: false,
                fontSize: 'medium',
                autoContrast: true,
                desktopNotifications: true,
                notificationSound: true,
                language: 'pt-BR',
                autoUpdate: true,
                animations: true,
                cache: true
            };

            this.savePreferences();
            this.showNotification('Preferências restauradas!', 'success');
        },

        openModal() {
            this.updateUI();
            this.modal.setAttribute('aria-hidden', 'false');
            this.modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        },

        closeModal() {
            this.modal.setAttribute('aria-hidden', 'true');
            this.modal.style.display = 'none';
            document.body.style.overflow = '';
        },

        showNotification(message, type = 'success') {
            // Usar sistema de notificações existente
            if (window.showNotification) {
                window.showNotification(message, type);
            } else {
                console.log(`[${type}] ${message}`);
            }
        }
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => PreferencesManager.init());
    } else {
        PreferencesManager.init();
    }

    // Export to window
    window.PreferencesManager = PreferencesManager;

})();
