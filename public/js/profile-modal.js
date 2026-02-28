/**
 * Profile Modal - Gerenciamento de Perfil do Usuário
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('[ProfileModal] Inicializando...');
    
    const profileModal = document.getElementById('profile-modal');
    const profileForm = document.getElementById('profile-form');
    const closeBtn = document.getElementById('profile-modal-close');
    const cancelBtn = document.getElementById('profile-cancel');
    const saveBtn = document.getElementById('profile-save');
    
    // Campos do formulário
    const emailInput = document.getElementById('profile-email');
    const nomeInput = document.getElementById('profile-nome');
    const apelidoInput = document.getElementById('profile-apelido');
    const telefoneInput = document.getElementById('profile-telefone');
    const dataNascimentoInput = document.getElementById('profile-data-nascimento');
    const departamentoInput = document.getElementById('profile-departamento');
    const bioTextarea = document.getElementById('profile-bio');
    const avatarImg = document.getElementById('profile-avatar-img');
    
    // Armazena dados do usuário
    let currentUserData = null;
    
    // Função para abrir modal
    function openModal() {
        if (!profileModal) return;
        profileModal.setAttribute('aria-hidden', 'false');
        profileModal.style.display = 'flex';
        loadUserData();
        console.log('[ProfileModal] Modal aberto');
    }
    
    // Função para fechar modal
    function closeModal() {
        if (!profileModal) return;
        profileModal.setAttribute('aria-hidden', 'true');
        profileModal.style.display = 'none';
        console.log('[ProfileModal] Modal fechado');
    }
    
    // Função para carregar dados do usuário
    async function loadUserData() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (!response.ok) throw new Error('Falha ao carregar dados');
            
            currentUserData = await response.json();
            console.log('[ProfileModal] Dados carregados:', currentUserData);
            
            // Preencher formulário
            if (emailInput) emailInput.value = currentUserData.email || '';
            if (nomeInput) nomeInput.value = currentUserData.nome || '';
            if (apelidoInput) apelidoInput.value = currentUserData.apelido || '';
            if (telefoneInput) telefoneInput.value = currentUserData.telefone || '';
            if (departamentoInput) departamentoInput.value = currentUserData.departamento || '';
            if (bioTextarea) bioTextarea.value = currentUserData.bio || '';
            
            // Data de nascimento (formato YYYY-MM-DD para input date)
            if (dataNascimentoInput && currentUserData.data_nascimento) {
                const date = new Date(currentUserData.data_nascimento);
                const dateStr = date.toISOString().split('T')[0];
                dataNascimentoInput.value = dateStr;
            }
            
            // Avatar
            if (avatarImg) {
                const avatarUrl = currentUserData.avatar || '/avatars/default.webp';
                avatarImg.src = avatarUrl;
            }
            
        } catch (error) {
            console.error('[ProfileModal] Erro ao carregar dados:', error);
            alert('Erro ao carregar dados do perfil. Tente novamente.');
        }
    }
    
    // Função para salvar alterações
    async function saveChanges() {
        if (!currentUserData) return;
        
        try {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
            
            const data = {
                nome: nomeInput.value.trim(),
                apelido: apelidoInput.value.trim(),
                telefone: telefoneInput.value.trim(),
                data_nascimento: dataNascimentoInput.value || null,
                bio: bioTextarea.value.trim()
            };
            
            console.log('[ProfileModal] Enviando dados:', data);
            
            const response = await fetch('/api/me', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Erro ao salvar');
            }
            
            const result = await response.json();
            console.log('[ProfileModal] ✅ Salvo com sucesso:', result);
            
            // Atualizar dados armazenados
            currentUserData = result.user;
            
            // Atualizar saudação no header se apelido foi alterado
            const apelido = result.user.apelido;
            const nome = result.user.nome;
            const nomeExibicao = apelido || (nome ? nome.split(' ')[0] : 'Usuário');
            
            const greetingTitle = document.querySelector('.greeting-title');
            if (greetingTitle) {
                greetingTitle.textContent = `Olá, ${nomeExibicao}!`;
            }
            
            // Salvar no localStorage para persistência
            localStorage.setItem('userData', JSON.stringify(result.user));
            
            // Feedback visual
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Salvo!';
            setTimeout(() => {
                closeModal();
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
                saveBtn.disabled = false;
            }, 1500);
            
        } catch (error) {
            console.error('[ProfileModal] ❌ Erro ao salvar:', error);
            alert('Erro ao salvar alterações: ' + error.message);
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
            saveBtn.disabled = false;
        }
    }
    
    // Event Listeners
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeModal);
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', saveChanges);
    }
    
    // Fechar ao clicar fora
    if (profileModal) {
        profileModal.addEventListener('click', function(e) {
            if (e.target === profileModal) {
                closeModal();
            }
        });
    }
    
    // Máscara de telefone
    if (telefoneInput) {
        telefoneInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);
            
            if (value.length <= 10) {
                // (00) 0000-0000
                value = value.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
            } else {
                // (00) 00000-0000
                value = value.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
            }
            
            e.target.value = value;
        });
    }
    
    // Expor função global para abrir modal
    window.openProfileModal = openModal;
    
    console.log('[ProfileModal] ✅ Inicializado');
});
