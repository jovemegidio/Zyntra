document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const errorMessageDiv = document.getElementById('error-message');
  const submitBtn = document.getElementById('login-submit-btn');
  const passwordToggle = document.getElementById('password-toggle');
  const passwordInput = document.getElementById('password');
  const emailInput = document.getElementById('email');
  const userAvatar = document.getElementById('user-avatar');

  if (!loginForm) return;

  // Funcionalidade de avatar dinâmico baseado no email (busca dinâmica)
  if (emailInput && userAvatar) {
    let avatarTimeout;
    let usersCache = null;
    
    // Carregar usuários do sistema dinamicamente
    async function loadUsers() {
      if (usersCache) return usersCache;
      
      try {
        const response = await fetch('/api/pcp/users-list', {
          method: 'GET',
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          usersCache = data.users || [];
          console.log('?? Usuários carregados:', usersCache.length);
        } else {
          console.warn('?? não foi possível carregar lista de usuários');
          usersCache = [];
        }
      } catch (error) {
        console.warn('?? Erro ao carregar usuários:', error);
        usersCache = [];
      }
      
      return usersCache;
    }
    
    emailInput.addEventListener('input', () => {
      clearTimeout(avatarTimeout);
      const input = emailInput.value.trim();
      
      // Remove o avatar se o campo estiver vazio
      if (input.length === 0) {
        hideUserAvatar();
        // Restaurar placeholder original
        emailInput.setAttribute('placeholder', 'seuemail@aluforce.ind.br');
        return;
      }
      
      // Mostra o avatar mais cedo para melhor UX
      avatarTimeout = setTimeout(() => {
        if (input.length >= 3) {
          showUserAvatar(input);
        }
      }, 300);
    });

    emailInput.addEventListener('blur', () => {
      const input = emailInput.value.trim();
      if (input.length >= 3) {
        showUserAvatar(input);
      }
    });
    
    // Carregar usuários no início
    loadUsers();
  }

  async function showUserAvatar(input) {
    // Carregar usuários se ainda não carregou
    const users = await loadUsers();
    
    const inputLower = input.toLowerCase().trim();
    let user = null;
    
    // 1. Procura por email exato
    user = users.find(u => u.email && u.email.toLowerCase() === inputLower);
    
    // 2. Se não encontrou por email, procura por nome (parcial ou completo)
    if (!user) {
      user = users.find(u => {
        if (!u.nome) return false;
        const nomeLower = u.nome.toLowerCase();
        const primeiroNome = nomeLower.split(' ')[0];
        
        // Verifica se o input é exatamente o primeiro nome ou nome completo
        return primeiroNome === inputLower || nomeLower === inputLower;
      });
    }
    
    // 3. Se não encontrou por nome exato, procura por nome que contenha o input
    if (!user && inputLower.length >= 3) {
      user = users.find(u => {
        if (!u.nome) return false;
        const nomeLower = u.nome.toLowerCase();
        return nomeLower.includes(inputLower) || inputLower.includes(nomeLower);
      });
    }
    
    // 4. Se não encontrou usuário, verifica se o input contém padrões de email conhecidos
    if (!user && input.includes('@')) {
      user = users.find(u => {
        if (!u.email) return false;
        const userEmailPart = u.email.split('@')[0].toLowerCase();
        const inputEmailPart = input.split('@')[0].toLowerCase();
        return userEmailPart === inputEmailPart;
      });
    }
    
    // 5. Mapeamento direto para nomes específicos (fallback para casos não encontrados)
    const nomesMapeados = {
      'guilherme': 'guilherme@aluforce.ind.br',
      'andreia': 'andreia@aluforce.ind.br', 
      'thiago': 'thiago@aluforce.ind.br',
      'douglas': 'douglas@aluforce.ind.br',
      'clemerson': 'clemerson.silva@aluforce.ind.br',
      'ti': 'ti@aluforce.ind.br'
    };
    
    if (!user && nomesMapeados[inputLower]) {
      user = users.find(u => u.email && u.email.toLowerCase() === nomesMapeados[inputLower]);
    }
    
    if (user) {
      // Usuário encontrado no sistema
      const avatarUrl = obterURLAvatar(user);
      const userName = user.nome || 'Usuário';
      
      console.log(`?? Avatar encontrado para: ${userName} (input: "${input}")`);
      
      if (user.foto_url || avatarUrl.includes('.jpg')) {
        // Tentar mostrar foto
        userAvatar.innerHTML = `<img src="${avatarUrl}" alt="${userName}" onerror="window.showFallbackAvatar('${userName}', '${user.email}')">`;
      } else {
        // Mostrar iniciais
        const initials = obterIniciais(userName);
        const cor = gerarCorAvatar(userName);
        userAvatar.innerHTML = `<div class="avatar-placeholder" style="background: ${cor};">${initials}</div>`;
      }
      
      // Adicionar informações do usuário como atributos
      userAvatar.setAttribute('data-user-name', userName);
      userAvatar.setAttribute('data-user-email', user.email);
      userAvatar.setAttribute('data-user-role', user.role || 'user');
      
      // Se o usuário digitou apenas o nome, sugerir o email completo via placeholder
      if (!input.includes('@') && user.email) {
        emailInput.setAttribute('placeholder', user.email);
      }
      
    } else if (input.includes('@aluforce')) {
      // Email da Aluforce mas não reconhecido - mostra iniciais do email
      const name = input.split('@')[0];
      const initials = name.substring(0, 2).toUpperCase();
      const cor = gerarCorAvatar(name);
      userAvatar.innerHTML = `<div class="avatar-placeholder" style="background: ${cor};">${initials}</div>`;
      
      console.log(`?? Email Aluforce não cadastrado: ${input}`);
      
    } else if (input.includes('@')) {
      // Email externo - mostra ícone genérico
      userAvatar.innerHTML = `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`;
      
      console.log(`?? Email externo: ${input}`);
      
    } else if (inputLower.length >= 3) {
      // Nome digitado mas não encontrado - mostra iniciais baseadas no input
      const initials = input.substring(0, 2).toUpperCase();
      const cor = gerarCorAvatar(input);
      userAvatar.innerHTML = `<div class="avatar-placeholder" style="background: ${cor};">${initials}</div>`;
      
      console.log(`? Nome não encontrado: ${input}`);
    } else {
      // Input muito curto - não mostra avatar
      hideUserAvatar();
      return;
    }
    
    userAvatar.classList.add('show');
    
    // Adiciona classe ao formulário para ajustar espaçamentos
    const loginForm = document.querySelector('.login-form');
    if (loginForm) {
      loginForm.classList.add('has-avatar');
    }
  }
  
  // Função para obter URL do avatar
  function obterURLAvatar(user) {
    if (user.foto_url) {
      return user.foto_url;
    }
    
    // Tentar encontrar avatar por nome
    const nomeSimplificado = user.nome ? 
        user.nome.toLowerCase()
            .replace(/\s+/g, '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') : 'default';
    
    return `/avatars/${nomeSimplificado}.jpg`;
  }
  
  // Função para obter iniciais do nome
  function obterIniciais(nome) {
    if (!nome) return 'U';
    
    const palavras = nome.trim().split(' ');
    if (palavras.length === 1) {
        return palavras[0].substring(0, 2).toUpperCase();
    }
    
    return (palavras[0].charAt(0) + palavras[palavras.length - 1].charAt(0)).toUpperCase();
  }
  
  // Função para gerar cor do avatar baseada no nome
  function gerarCorAvatar(nome) {
    if (!nome) return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    
    const cores = [
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
        'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
        'linear-gradient(135deg, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)',
        'linear-gradient(135deg, #a8caba 0%, #5d4e75 100%)',
        'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
        'linear-gradient(135deg, #fdbb2d 0%, #22c1c3 100%)'
    ];
    
    // Usar código hash do nome para selecionar cor consistente
    let hash = 0;
    for (let i = 0; i < nome.length; i++) {
        const char = nome.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    const index = Math.abs(hash) % cores.length;
    return cores[index];
  }

  // Função para esconder avatar
  function hideUserAvatar() {
    if (userAvatar) {
      userAvatar.classList.remove('show');
      const loginForm = document.querySelector('.login-form');
      if (loginForm) {
        loginForm.classList.remove('has-avatar');
      }
    }
  }
  
  // Função para autocomplete inteligente
  function setupSmartAutocomplete() {
    if (!emailInput) return;
    
    emailInput.addEventListener('keydown', (e) => {
      // Se o usuário pressionar Tab e tiver um placeholder sugerido
      if (e.key === 'Tab') {
        const placeholder = emailInput.getAttribute('placeholder');
        const currentValue = emailInput.value.trim();
        
        // Se o placeholder não é o padrão e o valor atual está contido no placeholder
        if (placeholder && 
            placeholder !== 'seuemail@aluforce.ind.br' && 
            placeholder.toLowerCase().includes(currentValue.toLowerCase()) &&
            currentValue.length >= 3) {
          
          e.preventDefault();
          emailInput.value = placeholder;
          showUserAvatar(placeholder);
          
          // Destacar o texto adicionado
          const start = currentValue.length;
          emailInput.setSelectionRange(start, placeholder.length);
        }
      }
      
      // Se pressionar Enter com nome incompleto, tentar autocompletar
      if (e.key === 'Enter') {
        const currentValue = emailInput.value.trim();
        const placeholder = emailInput.getAttribute('placeholder');
        
        if (placeholder && 
            placeholder !== 'seuemail@aluforce.ind.br' && 
            !currentValue.includes('@') &&
            currentValue.length >= 3) {
          
          e.preventDefault();
          emailInput.value = placeholder;
          showUserAvatar(placeholder);
        }
      }
    });
  }
  
  // Configurar autocomplete
  setupSmartAutocomplete();

  // Fallback para quando a imagem não carrega
  window.showFallbackAvatar = function(name, email) {
    const initials = obterIniciais(name);
    const cor = gerarCorAvatar(name);
    userAvatar.innerHTML = `<div class="avatar-placeholder" style="background: ${cor};">${initials}</div>`;
    
    console.log(`?? Avatar não encontrado para ${name} (${email}), usando iniciais: ${initials}`);
  };

  // Funcionalidade de mostrar/ocultar senha
  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      
      // Atualiza o ícone
      if (type === 'text') {
        passwordToggle.classList.remove('fa-eye');
        passwordToggle.classList.add('fa-eye-slash');
        passwordToggle.setAttribute('title', 'Ocultar senha');
      } else {
        passwordToggle.classList.remove('fa-eye-slash');
        passwordToggle.classList.add('fa-eye');
        passwordToggle.setAttribute('title', 'Mostrar senha');
      }
    });
  }

  // ================================
  // MODAL DE RECUPERAÇÃO DE SENHA
  // ================================
  
  const forgotPasswordModal = document.getElementById('forgot-password-modal');
  const forgotPasswordLink = document.getElementById('forgot-password');
  const modalClose = document.getElementById('modal-close');
  
  let currentStep = 1;
  let userVerificationData = {};

  // Funcionalidade "Esqueceu a senha?"
  if (forgotPasswordLink && forgotPasswordModal) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      openForgotPasswordModal();
    });
  }

  // Abrir modal
  function openForgotPasswordModal() {
    const email = emailInput ? emailInput.value.trim() : '';
    
    // Pre-preenche email se já digitado
    const verifyEmailInput = document.getElementById('verify-email');
    if (verifyEmailInput && email) {
      verifyEmailInput.value = email;
    }
    
    forgotPasswordModal.classList.add('show');
    document.body.style.overflow = 'hidden';
    resetModal();
  }

  // Fechar modal
  function closeForgotPasswordModal() {
    forgotPasswordModal.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(() => resetModal(), 300);
  }

  // Reset modal para step 1
  function resetModal() {
    currentStep = 1;
    showStep(1);
    clearModalInputs();
  }

  // Limpar inputs do modal
  function clearModalInputs() {
    const inputs = forgotPasswordModal.querySelectorAll('input, select');
    inputs.forEach(input => {
      if (input.id !== 'verify-email') { // Mantém email se já preenchido
        input.value = '';
      }
    });
  }

  // Eventos de fechar modal
  if (modalClose) {
    modalClose.addEventListener('click', closeForgotPasswordModal);
  }

  // Fechar modal clicando fora
  forgotPasswordModal?.addEventListener('click', (e) => {
    if (e.target === forgotPasswordModal) {
      closeForgotPasswordModal();
    }
  });

  // Fechar modal com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && forgotPasswordModal?.classList.contains('show')) {
      closeForgotPasswordModal();
    }
  });

  // Mostrar step específico
  function showStep(step) {
    // Esconder todos os steps
    for (let i = 1; i <= 3; i++) {
      const stepEl = document.getElementById(`step-${i}`);
      const dotEl = document.getElementById(`step-dot-${i}`);
      
      if (stepEl) stepEl.classList.remove('active');
      if (dotEl) dotEl.classList.remove('active');
    }
    
    // Mostrar step atual
    const activeStep = document.getElementById(`step-${step}`);
    const activeDot = document.getElementById(`step-dot-${step}`);
    
    if (activeStep) activeStep.classList.add('active');
    if (activeDot) activeDot.classList.add('active');
    
    currentStep = step;
  }

  // ================================
  // STEP 1: Verificar Email
  // ================================
  
  const nextStep1 = document.getElementById('next-step-1');
  const cancelStep1 = document.getElementById('cancel-step-1');
  
  nextStep1?.addEventListener('click', async () => {
    const email = document.getElementById('verify-email')?.value.trim();
    
    if (!email || !email.includes('@')) {
      showModalMessage('Por favor, digite um email válido.', 'error');
      return;
    }
    
    nextStep1.disabled = true;
    nextStep1.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
    
    try {
      // Verificar se email existe no sistema
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        userVerificationData.email = email;
        userVerificationData.userId = data.userId;
        userVerificationData.resetToken = data.resetToken;
        showStep(2);
      } else {
        showModalMessage(data.message || 'Email não encontrado no sistema.', 'error');
      }
    } catch (error) {
      console.error('Erro ao verificar email:', error);
      showModalMessage('Erro de Conexão. Tente novamente.', 'error');
    } finally {
      nextStep1.disabled = false;
      nextStep1.innerHTML = '<i class="fas fa-arrow-right"></i> Próximo';
    }
  });
  
  cancelStep1?.addEventListener('click', closeForgotPasswordModal);

  // ================================
  // STEP 2: Verificar Dados
  // ================================
  
  const nextStep2 = document.getElementById('next-step-2');
  const backStep2 = document.getElementById('back-step-2');
  
  nextStep2?.addEventListener('click', async () => {
    const name = document.getElementById('verify-name')?.value.trim();
    const department = document.getElementById('verify-department')?.value;
    
    if (!name || !department) {
      showModalMessage('Por favor, preencha todos os campos.', 'error');
      return;
    }
    
    nextStep2.disabled = true;
    nextStep2.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
    
    try {
      // Verificar dados do usuário
      const response = await fetch('/api/auth/verify-user-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: userVerificationData.userId,
          name,
          department,
          resetToken: userVerificationData.resetToken
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        userVerificationData.name = name;
        userVerificationData.department = department;
        if (data.resetToken) userVerificationData.resetToken = data.resetToken;
        showStep(3);
      } else {
        showModalMessage(data.message || 'Dados não conferem com nossos registros.', 'error');
      }
    } catch (error) {
      console.error('Erro ao verificar dados:', error);
      showModalMessage('Erro de Conexão. Tente novamente.', 'error');
    } finally {
      nextStep2.disabled = false;
      nextStep2.innerHTML = '<i class="fas fa-arrow-right"></i> Verificar';
    }
  });
  
  backStep2?.addEventListener('click', () => showStep(1));

  // ================================
  // STEP 3: Nova Senha
  // ================================
  
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const changePasswordBtn = document.getElementById('change-password');
  const backStep3 = document.getElementById('back-step-3');
  
  // Verificador de força da senha
  newPasswordInput?.addEventListener('input', (e) => {
    checkPasswordStrength(e.target.value);
  });
  
  function checkPasswordStrength(password) {
    const strengthBar = document.querySelector('.password-strength');
    const strengthText = document.querySelector('.strength-text');
    
    if (!strengthBar || !strengthText) return;
    
    let strength = 0;
    let message = '';
    
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    strengthBar.className = 'password-strength';
    
    if (strength <= 2) {
      strengthBar.classList.add('strength-weak');
      message = 'Senha fraca';
    } else if (strength === 3) {
      strengthBar.classList.add('strength-fair');
      message = 'Senha razoável';
    } else if (strength === 4) {
      strengthBar.classList.add('strength-good');
      message = 'Senha boa';
    } else {
      strengthBar.classList.add('strength-strong');
      message = 'Senha forte';
    }
    
    strengthText.textContent = message;
    strengthText.style.color = getStrengthColor(strength);
  }
  
  function getStrengthColor(strength) {
    if (strength <= 2) return '#ef4444';
    if (strength === 3) return '#f59e0b';
    if (strength === 4) return '#3b82f6';
    return '#22c55e';
  }
  
  changePasswordBtn?.addEventListener('click', async () => {
    const newPassword = newPasswordInput?.value;
    const confirmPassword = confirmPasswordInput?.value;
    
    if (!newPassword || !confirmPassword) {
      showModalMessage('Por favor, preencha ambos os campos de senha.', 'error');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      showModalMessage('As senhas não coincidem.', 'error');
      return;
    }
    
    if (newPassword.length < 6) {
      showModalMessage('A senha deve ter pelo menos 6 caracteres.', 'error');
      return;
    }
    
    changePasswordBtn.disabled = true;
    changePasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Alterando...';
    
    try {
      // Alterar senha no banco
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userVerificationData.userId,
          email: userVerificationData.email,
          newPassword: newPassword,
          resetToken: userVerificationData.resetToken
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        showModalMessage('Senha alterada com sucesso!', 'success');
        setTimeout(() => {
          closeForgotPasswordModal();
          // Pre-preenche o email no login
          if (emailInput) {
            emailInput.value = userVerificationData.email;
          }
          showMessage('Senha alterada! Faça login com sua nova senha.', 'success');
        }, 2000);
      } else {
        showModalMessage(data.message || 'Erro ao alterar senha.', 'error');
      }
    } catch (error) {
      console.error('Erro ao alterar senha:', error);
      showModalMessage('Erro de Conexão. Tente novamente.', 'error');
    } finally {
      changePasswordBtn.disabled = false;
      changePasswordBtn.innerHTML = '<i class="fas fa-check"></i> Alterar Senha';
    }
  });
  
  backStep3?.addEventListener('click', () => showStep(2));
  
  // Função para mostrar mensagens no modal
  function showModalMessage(message, type = 'error') {
    // Remove mensagem anterior
    const existingMessage = forgotPasswordModal.querySelector('.modal-message');
    if (existingMessage) {
      existingMessage.remove();
    }
    
    // Cria nova mensagem
    const messageDiv = document.createElement('div');
    messageDiv.className = `modal-message ${type === 'success' ? 'success-message' : 'error-message'} visible`;
    messageDiv.textContent = message;
    
    // Adiciona após o cabeçalho
    const header = forgotPasswordModal.querySelector('.modal-header');
    if (header) {
      header.insertAdjacentElement('afterend', messageDiv);
    }
    
    // Remove após 5 segundos
    setTimeout(() => {
      messageDiv?.remove();
    }, 5000);
  }

  // Função auxiliar para mostrar mensagens
  function showMessage(message, type = 'error') {
    const messageDiv = errorMessageDiv;
    if (!messageDiv) return;
    
    messageDiv.className = type === 'success' ? 'success-message visible' : 'error-message visible';
    messageDiv.textContent = message;
    
    // Remove a mensagem após 5 segundos
    setTimeout(() => {
      messageDiv.classList.remove('visible');
    }, 5000);
  }

  // Funcionalidade "Lembrar-me" (salva no localStorage)
  const rememberCheckbox = document.getElementById('remember-me');
  if (rememberCheckbox && emailInput) {
    // Carrega email salvo se existir
    const savedEmail = localStorage.getItem('rememberedEmail');
    if (savedEmail) {
      emailInput.value = savedEmail;
      rememberCheckbox.checked = true;
      // Mostra o avatar para o email carregado
      setTimeout(() => showUserAvatar(savedEmail.toLowerCase()), 100);
    }
    
    // Salva/remove email baseado no checkbox
    rememberCheckbox.addEventListener('change', () => {
      if (rememberCheckbox.checked) {
        const email = emailInput.value.trim();
        if (email) {
          localStorage.setItem('rememberedEmail', email);
        }
      } else {
        localStorage.removeItem('rememberedEmail');
      }
    });
  }

  // Toggle loading state on the submit button (shows spinner, hides text)
  function setLoading(loading) {
  if (!submitBtn) return;
  submitBtn.disabled = loading;
  submitBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  // Toggle the loading class; CSS controls spinner visibility and layout
  submitBtn.classList.toggle('loading', loading);
  // Ensure the visible text is still present for screen readers
  const textEl = submitBtn.querySelector('.btn-text');
  if (textEl) textEl.setAttribute('aria-hidden', loading ? 'true' : 'false');
  // Avoid inline style manipulation so CSS can manage layout and animation
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn && submitBtn.disabled) return; // prevent double submit

    if (errorMessageDiv) {
      errorMessageDiv.classList.remove('visible');
      errorMessageDiv.textContent = '';
      errorMessageDiv.setAttribute('aria-live', 'polite');
    }

    setLoading(true);

    const usernameEl = document.getElementById('email');
    const passwordEl = document.getElementById('password');
    const username = usernameEl ? usernameEl.value.trim() : '';
    const password = passwordEl ? passwordEl.value : '';

    if (!username || !password) {
      if (errorMessageDiv) {
        errorMessageDiv.textContent = 'Preencha email e senha.';
        errorMessageDiv.classList.add('visible');
      }
      // focus the first missing field for faster correction
      if (!username && usernameEl) usernameEl.focus();
      else if (!password && passwordEl) passwordEl.focus();
      setLoading(false);
      return;
    }

    try {
      // Use the PCP login endpoint which sets an HttpOnly session cookie
      const response = await fetch('/api/pcp/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: username, password })
      });

      // Try to parse JSON safely
      let data = {};
      try { data = await response.json(); } catch (e) { data = {}; }

      if (!response.ok) {
        // server provided message preferred
        const msg = (data && data.message) ? data.message : `Erro de autenticAção (${response.status})`;
        throw new Error(msg);
      }

      // Login bem-sucedido: salvar dados do usuário no localStorage
      if (data.userData) {
        const user = data.userData;
        const nomeCompleto = user.nome || user.nome_completo || user.name || 'Usuário';
        const firstName = nomeCompleto.split(' ')[0].toLowerCase();
        
        // Determinar URL do avatar
        const avatarMap = {
          'douglas': '/avatars/douglas.webp',
          'andreia': '/avatars/andreia.webp',
          'ti': '/avatars/ti.webp',
          'clemerson': '/avatars/clemerson.webp',
          'thiago': '/avatars/thiago.webp',
          'guilherme': '/avatars/guilherme.webp',
          'junior': '/avatars/junior.webp',
          'hellen': '/avatars/hellen.webp',
          'antonio': '/avatars/antonio.webp',
          'egidio': '/avatars/egidio.webp'
        };
        
        let fotoUrl = user.foto_perfil_url || user.avatar || user.foto || avatarMap[firstName] || '/avatars/default.webp';
        
        // Salvar no localStorage
        localStorage.setItem('userData', JSON.stringify({
          id: user.id,
          nome: nomeCompleto,
          email: user.email,
          avatar: fotoUrl,
          setor: user.departamento || user.setor || 'PCP'
        }));
        
        console.log('?? Dados do usuário salvos:', nomeCompleto, 'Avatar:', fotoUrl);
      }

      // Redireciona para a área principal (dashboard)
      window.location.href = window.__withBasePath ? window.__withBasePath('/dashboard') : '/dashboard';
    } catch (error) {
      if (errorMessageDiv) {
        const msg = error && error.message ? error.message : 'Erro ao efetuar login';
        errorMessageDiv.textContent = msg;
        errorMessageDiv.classList.add('visible');
        // focus the email field so user can retry quickly
        const tryFocus = document.getElementById('email') || document.getElementById('username');
        if (tryFocus) tryFocus.focus();
      }
      console.debug('[login] error', error);
    } finally {
      setLoading(false);
    }
  });
});




