;;/**
 * Profile Manager - Enhanced Profile Modal with Avatar Upload
 * Manages user profile editing and avatar uploads
 */

(function() {
    'use strict';

    const ProfileManager = {
        modal: null,
        form: null,
        currentUser: null,
        hasUnsavedChanges: false,

        init() {
            this.modal = document.getElementById('profile-modal');
            this.form = document.getElementById('profile-form');
            
            if (!this.modal || !this.form) {
                console.error('Profile modal elements not found');
                return;
            }

            this.setupEventListeners();
            this.setupAvatarUpload();
        },

        setupEventListeners() {
            // Open modal button
            const openBtn = document.getElementById('open-profile');
            if (openBtn) {
                openBtn.addEventListener('click', () => this.openModal());
            }

            // Close modal buttons
            const closeBtn = document.getElementById('profile-modal-close');
            const cancelBtn = document.getElementById('profile-cancel');
            
            if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
            if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());

            // Click outside to close
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });

            // Save button
            const saveBtn = document.getElementById('profile-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => this.saveProfile());
            }

            // Change password button
            const changePwdBtn = document.getElementById('profile-change-password');
            if (changePwdBtn) {
                changePwdBtn.addEventListener('click', () => this.openChangePasswordModal());
            }

            // Track changes
            this.form.addEventListener('input', () => {
                this.hasUnsavedChanges = true;
            });

            // Prevent accidental close with unsaved changes
            window.addEventListener('beforeunload', (e) => {
                if (this.hasUnsavedChanges) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        },

        setupAvatarUpload() {
            const avatarInput = document.getElementById('profile-avatar-input');
            const avatarBtn = document.getElementById('profile-avatar-btn');
            const avatarPreview = document.querySelector('.profile-avatar-preview');

            if (!avatarInput || !avatarBtn) return;

            // Click button to open file picker
            avatarBtn.addEventListener('click', () => {
                avatarInput.click();
            });

            // Click preview to open file picker
            if (avatarPreview) {
                avatarPreview.addEventListener('click', () => {
                    avatarInput.click();
                });
            }

            // Handle file selection
            avatarInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleAvatarUpload(file);
                }
            });

            // Drag and drop support
            if (avatarPreview) {
                avatarPreview.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    avatarPreview.style.opacity = '0.7';
                });

                avatarPreview.addEventListener('dragleave', () => {
                    avatarPreview.style.opacity = '1';
                });

                avatarPreview.addEventListener('drop', (e) => {
                    e.preventDefault();
                    avatarPreview.style.opacity = '1';
                    
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                        this.handleAvatarUpload(file);
                    }
                });
            }
        },

        async handleAvatarUpload(file) {
            // Validate file type
            const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!validTypes.includes(file.type)) {
                this.showMessage('Formato de arquivo inválido. Use JPG, PNG, GIF ou WEBP.', 'error');
                return;
            }

            // Validate file size (2MB max)
            const maxSize = 2 * 1024 * 1024; // 2MB
            if (file.size > maxSize) {
                this.showMessage('Arquivo muito grande. O tamanho máximo é 2MB.', 'error');
                return;
            }

            // Preview image immediately
            const reader = new FileReader();
            reader.onload = (e) => {
                const avatarImg = document.getElementById('profile-avatar-img');
                if (avatarImg) {
                    avatarImg.src = e.target.result;
                }
                
                // Update header avatar immediately with preview
                this.updateHeaderAvatar(e.target.result);
            };
            reader.readAsDataURL(file);

            // Upload to server
            await this.uploadAvatar(file);
        },

        async uploadAvatar(file) {
            const formData = new FormData();
            formData.append('avatar', file);

            try {
                this.setLoading(true);

                // Get token from localStorage or cookies
                const token = localStorage.getItem('authToken') || localStorage.getItem('token');

                const response = await fetch('/api/upload-avatar', {
                    method: 'POST',
                    headers: token ? {
                        'Authorization': `Bearer ${token}`
                    } : {},
                    credentials: 'include', // Include cookies
                    body: formData
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Erro ao fazer upload do avatar');
                }

                this.showMessage('Avatar atualizado com sucesso!', 'success');
                
                // Update header avatar with server URL
                if (data.avatarUrl) {
                    this.updateHeaderAvatar(data.avatarUrl);
                    
                    // Update localStorage userData with new avatar
                    try {
                        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
                        userData.avatar = data.avatarUrl;
                        localStorage.setItem('userData', JSON.stringify(userData));
                    } catch (e) {
                        console.error('Erro ao atualizar userData:', e);
                    }
                }
                
                this.hasUnsavedChanges = false;

            } catch (error) {
                console.error('Avatar upload error:', error);
                this.showMessage(error.message || 'Erro ao fazer upload do avatar', 'error');
            } finally {
                this.setLoading(false);
            }
        },

        updateHeaderAvatar(avatarUrl) {
            console.log('[AVATAR] Atualizando avatar em todo o sistema:', avatarUrl);
            
            // 1. Update avatar in header dropdown
            const headerAvatar = document.querySelector('.user-avatar-header');
            if (headerAvatar) {
                let img = headerAvatar.querySelector('img');
                if (img) {
                    img.src = avatarUrl;
                } else {
                    headerAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                }
            }
            
            // 2. Update dropdown avatar button (no header)
            const dropdownAvatars = document.querySelectorAll('#user-dropdown-btn img, .dropdown-avatar img, .header-avatar img, .user-btn img');
            dropdownAvatars.forEach(img => {
                if (img) img.src = avatarUrl;
            });
            
            // 3. Update iniciais/fallback - esconder e mostrar imagem
            const userInitials = document.querySelectorAll('.user-initial, .user-initials, #user-initial, #userInitials');
            userInitials.forEach(el => {
                if (el) el.style.display = 'none';
            });
            
            // 4. Update avatar em saudações do dashboard
            const greetingAvatars = document.querySelectorAll('.greeting-avatar img, .welcome-avatar img, #userAvatarLarge img, .user-avatar-large img');
            greetingAvatars.forEach(img => {
                if (img) img.src = avatarUrl;
            });
            
            // 5. Update container de avatar grande (saudação)
            const avatarLargeContainers = document.querySelectorAll('#userAvatarLarge, .user-avatar-large');
            avatarLargeContainers.forEach(container => {
                if (container && !container.querySelector('img')) {
                    container.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                }
            });
            
            // 6. Update all avatar instances on the page
            const allAvatars = document.querySelectorAll('.user-profile-avatar, .user-avatar, .avatar-circle, .profile-avatar');
            allAvatars.forEach(avatar => {
                if (avatar.tagName === 'IMG') {
                    avatar.src = avatarUrl;
                } else {
                    const img = avatar.querySelector('img');
                    if (img) img.src = avatarUrl;
                }
            });
            
            // 7. Update user photo elements
            const userPhotos = document.querySelectorAll('#user-photo, .user-photo');
            userPhotos.forEach(photo => {
                if (photo.tagName === 'IMG') {
                    photo.src = avatarUrl;
                    photo.style.display = 'block';
                }
            });
            
            // 8. Dispatch custom event para outros scripts atualizarem
            window.dispatchEvent(new CustomEvent('avatar-updated', { detail: { avatarUrl } }));
            
            console.log('[AVATAR] Todos os avatares atualizados!');
        },

        async openModal() {
            await this.loadUserData();
            this.modal.setAttribute('aria-hidden', 'false');
            this.modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        },

        closeModal() {
            if (this.hasUnsavedChanges) {
                const confirm = window.confirm('Você tem alterações não salvas. Deseja descartar?');
                if (!confirm) return;
            }

            this.modal.setAttribute('aria-hidden', 'true');
            this.modal.style.display = 'none';
            document.body.style.overflow = '';
            this.hasUnsavedChanges = false;
            this.clearMessages();
        },

        async loadUserData() {
            try {
                this.setLoading(true);

                // Get token from localStorage or use cookie authentication
                const token = localStorage.getItem('authToken') || localStorage.getItem('token');

                const response = await fetch('/api/me', {
                    headers: token ? {
                        'Authorization': `Bearer ${token}`
                    } : {},
                    credentials: 'include' // Include cookies for authentication
                });

                if (!response.ok) {
                    throw new Error('Erro ao carregar dados do usuário');
                }

                const user = await response.json();
                this.currentUser = user;
                this.populateForm(user);

            } catch (error) {
                console.error('Load user error:', error);
                this.showMessage('Erro ao carregar dados do usuário', 'error');
            } finally {
                this.setLoading(false);
            }
        },

        populateForm(user) {
            // Set avatar
            const avatarImg = document.getElementById('profile-avatar-img');
            if (avatarImg && user.avatar) {
                avatarImg.src = user.avatar || "/avatars/default.webp";
            }

            // Set fields
            this.setFieldValue('profile-email', user.email);
            this.setFieldValue('profile-nome', user.nome || user.nome_completo);
            this.setFieldValue('profile-apelido', user.apelido);
            this.setFieldValue('profile-telefone', user.telefone);
            this.setFieldValue('profile-data-nascimento', user.data_nascimento);
            this.setFieldValue('profile-departamento', user.departamento || this.getDepartmentFromRole(user.role));
            this.setFieldValue('profile-bio', user.bio);

            this.hasUnsavedChanges = false;
        },

        setFieldValue(fieldId, value) {
            const field = document.getElementById(fieldId);
            if (field && value !== null && value !== undefined) {
                field.value = value;
            }
        },

        getDepartmentFromRole(role) {
            const departments = {
                'vendas': 'Vendas',
                'pcp': 'PCP',
                'crm': 'CRM',
                'financeiro': 'Financeiro',
                'rh': 'RH',
                'nfe': 'Nota Fiscal Eletrônica',
                'admin': 'Administração',
                'ti': 'Tecnologia da Informação'
            };
            return departments[role] || 'Não definido';
        },

        async saveProfile() {
            try {
                this.setLoading(true);
                this.clearMessages();

                const formData = {
                    nome: document.getElementById('profile-nome').value,
                    apelido: document.getElementById('profile-apelido').value,
                    telefone: document.getElementById('profile-telefone').value,
                    data_nascimento: document.getElementById('profile-data-nascimento').value,
                    bio: document.getElementById('profile-bio').value
                };

                // Validate
                if (!formData.nome || formData.nome.trim() === '') {
                    this.showMessage('O nome completo é obrigatório', 'error');
                    return;
                }

                // Get token from localStorage or use cookie authentication
                const token = localStorage.getItem('authToken') || localStorage.getItem('token');

                const response = await fetch('/api/me', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    credentials: 'include', // Include cookies for authentication
                    body: JSON.stringify(formData)
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Erro ao salvar perfil');
                }

                this.showMessage('Perfil atualizado com sucesso!', 'success');
                this.hasUnsavedChanges = false;

                // Update userData in localStorage (merge with existing data to preserve all fields)
                try {
                    const existingData = JSON.parse(localStorage.getItem('userData') || '{}');
                    const updatedData = Object.assign({}, existingData, data.user || {});
                    localStorage.setItem('userData', JSON.stringify(updatedData));
                } catch (e) {
                    console.error('Erro ao atualizar localStorage:', e);
                }

                // Update header greeting with apelido or nome
                this.updateHeaderGreeting(data.user);

                // Update avatar in header if it changed
                if (data.user.avatar && data.user.avatar !== this.currentUser?.avatar) {
                    this.updateHeaderAvatar(data.user.avatar);
                }

                // Close modal after 1.5s
                setTimeout(() => {
                    this.closeModal();
                }, 1500);

            } catch (error) {
                console.error('Save profile error:', error);
                this.showMessage(error.message || 'Erro ao salvar perfil', 'error');
            } finally {
                this.setLoading(false);
            }
        },

        updateHeaderGreeting(user) {
            // Atualizar saudação no header usando apelido se disponível, caso contrário nome
            const greetingElements = document.querySelectorAll('.user-profile .user-link, .greeting h1');
            
            // Determinar nome para saudação
            let nomeSaudacao = '';
            if (user.apelido && user.apelido.trim() !== '') {
                nomeSaudacao = user.apelido.trim();
            } else if (user.nome) {
                // Usar primeiro + último nome se nome completo for longo
                const partes = user.nome.split(/\s+/).filter(Boolean);
                if (partes.length > 2) {
                    nomeSaudacao = `${partes[0]} ${partes[partes.length - 1]}`;
                } else {
                    nomeSaudacao = user.nome;
                }
            }

            console.log('[ProfileManager] Atualizando saudação para:', nomeSaudacao);

            // Atualizar todos os elementos de saudação
            greetingElements.forEach(el => {
                if (el.classList.contains('user-link')) {
                    el.textContent = `Olá, ${nomeSaudacao || 'Usuário'}`;
                } else if (el.tagName === 'H1') {
                    el.textContent = `Olá, ${nomeSaudacao || 'Usuário'}`;
                }
            });

            // Atualizar dropdown user name se existir
            const userNameDropdown = document.querySelector('.user-info-header .user-name');
            if (userNameDropdown) {
                userNameDropdown.textContent = nomeSaudacao || user.nome || 'Usuário';
            }
            
            // Atualizar saudação premium do painel de controle
            const userDisplayName = document.getElementById('user-display-name');
            if (userDisplayName) {
                userDisplayName.textContent = nomeSaudacao || 'Usuário';
            }
            
            // Atualizar saudação baseada na hora
            const greetingTextEl = document.getElementById('greeting-text');
            if (greetingTextEl) {
                const hour = new Date().getHours();
                let greetingText = 'Olá';
                if (hour >= 5 && hour < 12) greetingText = 'Bom dia';
                else if (hour >= 12 && hour < 18) greetingText = 'Boa tarde';
                else greetingText = 'Boa noite';
                greetingTextEl.textContent = greetingText;
            }
        },

        openChangePasswordModal() {
            // This would open a separate password change modal
            // For now, we'll show an alert
            alert('Funcionalidade de alteração de senha será implementada em breve.');
        },

        setLoading(isLoading) {
            if (isLoading) {
                this.form.classList.add('profile-form-loading');
            } else {
                this.form.classList.remove('profile-form-loading');
            }
        },

        showMessage(message, type = 'success') {
            this.clearMessages();

            const messageEl = document.createElement('div');
            messageEl.className = `profile-message profile-message-${type}`;
            
            const icon = type === 'success' ? 
                '<i class="fas fa-check-circle"></i>' : 
                '<i class="fas fa-exclamation-circle"></i>';
            
            messageEl.innerHTML = `${icon} ${message}`;
            
            this.form.insertBefore(messageEl, this.form.firstChild);

            // Auto-remove after 5s
            setTimeout(() => {
                messageEl.remove();
            }, 5000);
        },

        clearMessages() {
            const messages = this.form.querySelectorAll('.profile-message');
            messages.forEach(msg => msg.remove());
        }
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ProfileManager.init());
    } else {
        ProfileManager.init();
    }

    // Export to window
    window.ProfileManager = ProfileManager;

})();
