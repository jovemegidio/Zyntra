/**
 * ALUFORCE - Login Page v2.0
 * Modern glassmorphism login with animated backgrounds
 * All backend integration preserved from v1
 */
document.addEventListener('DOMContentLoaded', () => {
  // ==================== DOM ELEMENTS ====================
  const loginForm = document.getElementById('login-form');
  const errorMessageDiv = document.getElementById('error-message');
  const submitBtn = document.getElementById('login-submit-btn');
  const passwordToggle = document.getElementById('password-toggle');
  const passwordInput = document.getElementById('password');
  const emailInput = document.getElementById('email');
  const avatarContainer = document.getElementById('avatar-container');
  const avatarBox = document.getElementById('avatar-box');
  const avatarIcon = document.getElementById('avatar-icon');
  const greetingEl = document.getElementById('login-greeting');
  const subtitleEl = document.getElementById('login-subtitle');
  const loginContent = document.getElementById('login-content');
  const eyeOpen = document.getElementById('eye-open');
  const eyeOff = document.getElementById('eye-off');

  // ==================== MOUNT ANIMATION ====================
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (loginContent) loginContent.classList.add('mounted');
    }, 100);
  });

  // ==================== ANIMATED BACKGROUND ====================
  const bgGradient = document.getElementById('bg-gradient');
  const themeDots = document.querySelectorAll('.theme-dot');
  let currentTheme = 0;
  const themeCount = 4;

  // Orb color variations for each theme
  const orbColors = [
    { orb1: 'hsla(234, 80%, 55%, 0.15)', orb2: 'hsla(280, 80%, 55%, 0.10)' },
    { orb1: 'hsla(210, 80%, 55%, 0.15)', orb2: 'hsla(190, 80%, 55%, 0.10)' },
    { orb1: 'hsla(270, 80%, 55%, 0.15)', orb2: 'hsla(300, 80%, 55%, 0.10)' },
    { orb1: 'hsla(215, 50%, 55%, 0.15)', orb2: 'hsla(234, 80%, 55%, 0.10)' },
  ];

  function setTheme(index) {
    currentTheme = index;
    // Update gradient overlay
    if (bgGradient) {
      bgGradient.className = `bg-gradient-overlay theme-${index}`;
    }
    // Update orb colors
    const orb1 = document.getElementById('bg-orb-1');
    const orb2 = document.getElementById('bg-orb-2');
    if (orb1) orb1.style.background = orbColors[index].orb1;
    if (orb2) orb2.style.background = orbColors[index].orb2;
    // Update dots
    themeDots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
  }

  // Auto-cycle themes every 5 seconds
  let themeInterval = setInterval(() => {
    setTheme((currentTheme + 1) % themeCount);
  }, 5000);

  // Manual theme selection
  themeDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.theme);
      setTheme(idx);
      // Reset interval
      clearInterval(themeInterval);
      themeInterval = setInterval(() => {
        setTheme((currentTheme + 1) % themeCount);
      }, 5000);
    });
  });

  // ==================== FLOATING PARTICLES ====================
  const particlesContainer = document.getElementById('particles');
  if (particlesContainer) {
    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.top = `${Math.random() * 100}%`;
      particle.style.animationDelay = `${Math.random() * 6}s`;
      particle.style.animationDuration = `${6 + Math.random() * 4}s`;
      particlesContainer.appendChild(particle);
    }
  }

  // ==================== SSO: SUPORTE A REDIRECIONAMENTO ====================
  const urlParams = new URLSearchParams(window.location.search);
  const returnTo = urlParams.get('returnTo');
  if (returnTo) {
    console.log('[LOGIN/SSO] 🔄 ReturnTo detectado:', decodeURIComponent(returnTo));
  }

  // Limpeza preventiva ao abrir a tela de login
  try { if (window.AluforceAuth && typeof AluforceAuth.clearAuth === 'function') AluforceAuth.clearAuth(); } catch {}
  try { ['chatSupportUser','chatSupportConversations','chatSupportTickets','chatUser','supportTickets','chatVoiceEnabled'].forEach(k => localStorage.removeItem(k)); } catch {}

  if (!loginForm) return;

  // ==================== TERMINATED ACCOUNT MODAL ====================
  function showTerminatedAccountModal(message) {
    const existingModal = document.getElementById('terminated-account-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'terminated-account-modal';
    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;animation:fadeIn 0.3s ease;">
        <div style="background:linear-gradient(135deg,hsl(222,47%,10%) 0%,hsl(222,47%,14%) 100%);border:1px solid hsl(210,40%,98%,0.08);border-radius:1.25rem;padding:2.5rem;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:slideUp 0.4s ease;">
          <div style="width:80px;height:80px;background:linear-gradient(135deg,hsl(0,84%,60%),hsl(0,84%,45%));border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 20px hsla(0,84%,60%,0.4);">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>
          </div>
          <h2 style="color:hsl(210,40%,98%);margin:0 0 15px;font-size:1.5rem;font-weight:600;">Acesso Negado</h2>
          <p style="color:hsl(0,84%,70%);font-size:1rem;margin:0 0 15px;font-weight:500;">${message}</p>
          <p style="color:hsl(215,20%,65%);font-size:0.875rem;margin:0 0 25px;line-height:1.5;">Se você acredita que isso é um erro, entre em contato com o departamento de Recursos Humanos.</p>
          <div style="margin-bottom:20px;">
            <a href="mailto:rh@aluforce.ind.br" style="display:inline-flex;align-items:center;gap:8px;background:hsl(234,89%,64%);color:white;padding:12px 24px;border-radius:0.75rem;text-decoration:none;font-weight:500;transition:all 0.3s ease;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Contatar RH
            </a>
          </div>
          <button onclick="this.closest('#terminated-account-modal').remove()" style="background:transparent;border:1px solid hsl(222,30%,30%);color:hsl(215,20%,65%);padding:10px 30px;border-radius:0.75rem;cursor:pointer;font-size:0.875rem;transition:all 0.3s ease;font-family:inherit;">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('div').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) modal.remove();
    });
    const handleEsc = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', handleEsc); } };
    document.addEventListener('keydown', handleEsc);
  }

  // ==================== API HELPER ====================
  function apiFetch(path, options = {}) {
    return fetch(path, options);
  }

  // ==================== AVATAR SYSTEM ====================
  const avatarNameMap = {
    'ti': 'TI.webp', 'tialuforce': 'TI.webp', 'admin': 'admin.webp',
    'andreia': 'Andreia.webp', 'douglas': 'Douglas.webp',
    'marcia': 'Marcia.jpg', 'fabiano': 'Fabiano.jpg', 'fabiola': 'Fabiola.jpg',
    'renata': 'Renata.jpg', 'augusto': 'Augusto.webp', 'thiago.scarcella': 'Thiago.webp',
    'eldir': null, 'hellen': null,
    'guilherme': 'Guilherme.webp', 'thiago': 'Thiago.webp',
    'clemerson': 'Clemerson.webp', 'clemerson.silva': 'Clemerson.webp', 'clemerson.leandro': 'Clemerson.webp', 'pcp': 'Clemerson.webp',
    'rh': 'Rh.webp', 'recursos humanos': 'Rh.webp', 'recursoshumanos': 'Rh.webp',
    'isabela': 'Isabela.webp', 'thaina': 'Thaina.webp',
    'nicolas': 'NicolasDaniel.webp', 'nicolasdaniel': 'NicolasDaniel.webp',
    'joao': 'joao.svg', 'maria': 'maria.svg',
    'antonio': 'Antonio.webp', 'fernando': 'Fernando.webp',
    'mauricio': 'mauricio.svg', 'mauricio.torrolho': 'mauricio.svg',
    'jamerson': 'jamerson.svg', 'jamerson.ribeiro': 'jamerson.svg',
    'jamesson': 'jamerson.svg', 'jamesson.ribeiro': 'jamerson.svg',
    'diego': 'diego.svg', 'diego.lucena': 'diego.svg'
  };

  const avatarColors = {
    'ana': '#2E7D32', 'bruno': '#1565C0', 'christian': '#00838F',
    'clayton': '#00695C', 'leonardo': '#558B2F', 'ramon': '#4527A0',
    'robson': '#0277BD', 'ronaldo': '#1976D2', 'willian': '#303F9F',
    'eldir': '#EF6C00', 'hellen': '#F57C00',
    'default': '#1A2A4B'
  };

  async function fetchUserPhotoFromAPI(email) {
    try {
      const response = await fetch(`/api/usuarios/foto/${encodeURIComponent(email)}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data.success && data.foto) return { foto: data.foto, nome: data.nome || null, apelido: data.apelido || null };
      if (data.success && data.nome) return { foto: null, nome: data.nome, apelido: data.apelido || null };
      if (data.success) return { foto: null, nome: data.nome || null, apelido: data.apelido || null };
      return null;
    } catch (error) {
      return null;
    }
  }

  function getUserAvatar(username, fullUsername = null) {
    const userLower = username.toLowerCase();
    const fullLower = (fullUsername || username).toLowerCase();
    const nameVariations = [
      userLower, fullLower,
      userLower.charAt(0).toUpperCase() + userLower.slice(1),
      fullLower.replace('.', ''),
      `user-${userLower}`,
    ];
    for (const variation of nameVariations) {
      const mapped = avatarNameMap[variation];
      if (mapped !== undefined) {
        if (mapped === null) return null;
        return `avatars/${mapped}`;
      }
    }
    const capitalizedName = userLower.charAt(0).toUpperCase() + userLower.slice(1);
    return `avatars/${capitalizedName}.webp`;
  }

  function adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  // ==================== DYNAMIC AVATAR & GREETING ====================
  if (emailInput && avatarBox) {
    let avatarTimeout;

    emailInput.addEventListener('input', () => {
      clearTimeout(avatarTimeout);
      const email = emailInput.value.trim().toLowerCase();
      const emailParts = email.split('@');
      const fullUsername = emailParts[0] || '';
      const firstName = fullUsername.split('.')[0] || '';

      // Update greeting dynamically - use fullUsername for length check (handles short names like "ti", "rh")
      if (fullUsername.length >= 2) {
        const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        if (greetingEl) greetingEl.textContent = `Olá, ${displayName}`;
        if (subtitleEl) subtitleEl.textContent = 'Digite sua senha para continuar';
        if (avatarContainer) avatarContainer.classList.add('has-email');
      } else if (fullUsername.length === 0) {
        if (greetingEl) greetingEl.textContent = 'Bem-vindo de volta';
        if (subtitleEl) subtitleEl.textContent = 'Entre na sua conta para continuar';
        if (avatarContainer) avatarContainer.classList.remove('has-email');
      }

      if (email.length === 0) {
        resetAvatar();
        return;
      }

      avatarTimeout = setTimeout(() => {
        if (email.length >= 3) showUserAvatar(email);
      }, 300);
    });

    emailInput.addEventListener('blur', () => {
      const email = emailInput.value.trim().toLowerCase();
      if (email.includes('@')) showUserAvatar(email);
    });
  }

  async function showUserAvatar(email) {
    const emailParts = email.toLowerCase().split('@');
    const fullUsername = emailParts[0];
    const firstName = fullUsername.split('.')[0];

    // Try API first
    const result = await fetchUserPhotoFromAPI(email);

    // Update greeting with apelido or real name from DB
    if (result && (result.apelido || result.nome)) {
      let displayName;
      if (result.apelido) {
        // Usar apelido se disponível
        displayName = result.apelido;
      } else {
        // Fallback: primeiro nome
        const realFirstName = result.nome.split(' ')[0];
        displayName = realFirstName.charAt(0).toUpperCase() + realFirstName.slice(1).toLowerCase();
      }
      if (greetingEl) greetingEl.textContent = `Olá, ${displayName}`;
      if (subtitleEl) subtitleEl.textContent = 'Digite sua senha para continuar';
    }

    if (result && result.foto) {
      setAvatarImage(result.foto, firstName, emailParts[1]);
      return;
    }

    // Fallback: local avatars
    const dominiosPermitidos = ['aluforce', 'lumiereassesoria', 'lumiereassessoria'];
    const domainMatch = emailParts[1] && dominiosPermitidos.some(d => emailParts[1].includes(d));

    if (domainMatch) {
      const avatarPath = getUserAvatar(firstName, fullUsername);
      if (avatarPath) {
        setAvatarImage(avatarPath, firstName, emailParts[1]);
      } else {
        setAvatarInitials(firstName);
      }
    } else {
      setAvatarUser();
    }
  }

  function setAvatarImage(src, firstName, domain) {
    if (!avatarBox) return;
    const img = document.createElement('img');
    img.src = src;
    img.alt = firstName || 'Avatar';
    img.onload = () => {
      avatarBox.innerHTML = '';
      avatarBox.appendChild(img);
    };
    img.onerror = () => {
      const dominiosPermitidos = ['aluforce', 'lumiereassesoria', 'lumiereassessoria'];
      const domainMatch = domain && dominiosPermitidos.some(d => domain.includes(d));
      if (domainMatch) {
        setAvatarInitials(firstName);
      } else {
        setAvatarUser();
      }
    };
  }

  function setAvatarInitials(firstName) {
    if (!avatarBox) return;
    const initials = (firstName || 'U').substring(0, 2).toUpperCase();
    const color = avatarColors[firstName?.toLowerCase()] || avatarColors['default'];
    avatarBox.innerHTML = `
      <div class="avatar-initials" style="background:linear-gradient(135deg, ${color} 0%, ${adjustColor(color, -20)} 100%);">
        ${initials}
      </div>
    `;
  }

  function setAvatarUser() {
    if (!avatarBox) return;
    avatarBox.innerHTML = `
      <div class="avatar-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
    `;
  }

  function resetAvatar() {
    if (!avatarBox) return;
    avatarBox.innerHTML = `
      <div class="avatar-icon" id="avatar-icon">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
    `;
    if (avatarContainer) avatarContainer.classList.remove('has-email');
  }

  // ==================== PASSWORD TOGGLE ====================
  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
      const isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      if (eyeOpen) eyeOpen.style.display = isPassword ? 'none' : 'block';
      if (eyeOff) eyeOff.style.display = isPassword ? 'block' : 'none';
      passwordToggle.setAttribute('title', isPassword ? 'Ocultar senha' : 'Mostrar senha');
    });
  }

  // ==================== FORGOT PASSWORD MODAL ====================
  const forgotPasswordModal = document.getElementById('forgot-password-modal');
  const forgotPasswordLink = document.getElementById('forgot-password');
  const modalClose = document.getElementById('modal-close');
  let currentStep = 1;
  let userVerificationData = {};

  if (forgotPasswordLink && forgotPasswordModal) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      openForgotPasswordModal();
    });
  }

  function openForgotPasswordModal() {
    const email = emailInput ? emailInput.value.trim() : '';
    const verifyEmailInput = document.getElementById('verify-email');
    if (verifyEmailInput && email) verifyEmailInput.value = email;
    forgotPasswordModal.classList.add('show');
    document.body.style.overflow = 'hidden';
    resetModal();
  }

  function closeForgotPasswordModal() {
    forgotPasswordModal.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(() => resetModal(), 300);
  }

  function resetModal() {
    currentStep = 1;
    showStep(1);
    clearModalInputs();
  }

  function clearModalInputs() {
    const inputs = forgotPasswordModal.querySelectorAll('input, select');
    inputs.forEach(input => {
      if (input.id !== 'verify-email') input.value = '';
    });
  }

  if (modalClose) modalClose.addEventListener('click', closeForgotPasswordModal);

  forgotPasswordModal?.addEventListener('click', (e) => {
    if (e.target === forgotPasswordModal) closeForgotPasswordModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && forgotPasswordModal?.classList.contains('show')) closeForgotPasswordModal();
  });

  function showStep(step) {
    for (let i = 1; i <= 3; i++) {
      const stepEl = document.getElementById(`step-${i}`);
      const dotEl = document.getElementById(`step-dot-${i}`);
      if (stepEl) stepEl.classList.remove('active');
      if (dotEl) dotEl.classList.remove('active');
    }
    const activeStep = document.getElementById(`step-${step}`);
    const activeDot = document.getElementById(`step-dot-${step}`);
    if (activeStep) activeStep.classList.add('active');
    if (activeDot) activeDot.classList.add('active');
    currentStep = step;
  }

  // Step 1: Verify Email
  const nextStep1 = document.getElementById('next-step-1');
  const cancelStep1 = document.getElementById('cancel-step-1');

  nextStep1?.addEventListener('click', async () => {
    const email = document.getElementById('verify-email')?.value.trim();
    if (!email || !email.includes('@')) {
      showModalMessage('Por favor, digite um email válido.', 'error');
      return;
    }
    nextStep1.disabled = true;
    const originalHTML = nextStep1.innerHTML;
    nextStep1.innerHTML = '<svg class="spinner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Enviando...';

    try {
      const response = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      let data = {};
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { data = await response.json(); } catch (e) { data = { message: 'Resposta inválida do servidor.' }; }
      } else {
        const text = await response.text();
        data = { message: text || `Erro (${response.status})` };
      }
      if (response.ok || data.success) {
        showModalMessage('✅ Link de recuperação enviado! Verifique seu email para continuar.', 'success');
        setTimeout(() => closeForgotPasswordModal(), 3000);
      } else {
        showModalMessage(data.message || 'Erro ao enviar email de recuperação.', 'error');
      }
    } catch (error) {
      console.error('Erro ao solicitar recuperação:', error);
      showModalMessage('Erro de conexão. Tente novamente.', 'error');
    } finally {
      nextStep1.disabled = false;
      nextStep1.innerHTML = originalHTML;
    }
  });

  cancelStep1?.addEventListener('click', closeForgotPasswordModal);

  // Step 2: Verify Data
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
    nextStep2.textContent = 'Verificando...';

    try {
      const response = await apiFetch('/api/auth/verify-user-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userVerificationData.userId, name, department })
      });
      let data = {};
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { data = await response.json(); } catch (e) { data = { message: 'Resposta inválida do servidor.' }; }
      } else {
        const text = await response.text();
        data = { message: text || `Erro (${response.status})` };
      }
      if (response.ok) {
        userVerificationData.name = name;
        userVerificationData.department = department;
        showStep(3);
      } else {
        showModalMessage(data.message || 'Dados não conferem com nossos registros.', 'error');
      }
    } catch (error) {
      showModalMessage('Erro de conexão. Tente novamente.', 'error');
    } finally {
      nextStep2.disabled = false;
      nextStep2.textContent = 'Verificar →';
    }
  });

  backStep2?.addEventListener('click', () => showStep(1));

  // Step 3: Change Password
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const changePasswordBtn = document.getElementById('change-password');
  const backStep3 = document.getElementById('back-step-3');

  newPasswordInput?.addEventListener('input', (e) => checkPasswordStrength(e.target.value));

  function checkPasswordStrength(password) {
    const strengthBar = document.querySelector('.password-strength');
    const strengthText = document.querySelector('.strength-text');
    if (!strengthBar || !strengthText) return;

    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    strengthBar.className = 'password-strength';
    let message = '';
    if (strength <= 2) { strengthBar.classList.add('strength-weak'); message = 'Senha fraca'; }
    else if (strength === 3) { strengthBar.classList.add('strength-fair'); message = 'Senha razoável'; }
    else if (strength === 4) { strengthBar.classList.add('strength-good'); message = 'Senha boa'; }
    else { strengthBar.classList.add('strength-strong'); message = 'Senha forte'; }
    strengthText.textContent = message;
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
    const originalHTML = changePasswordBtn.innerHTML;
    changePasswordBtn.innerHTML = '<svg class="spinner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Alterando...';

    try {
      const response = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userVerificationData.userId, email: userVerificationData.email, newPassword })
      });
      let data = {};
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { data = await response.json(); } catch (e) { data = {}; }
      } else {
        const text = await response.text();
        data = { message: text || `Erro (${response.status})` };
      }
      if (response.ok) {
        showModalMessage('Senha alterada com sucesso!', 'success');
        setTimeout(() => {
          closeForgotPasswordModal();
          if (emailInput) emailInput.value = userVerificationData.email;
          showMessage('Senha alterada! Faça login com sua nova senha.', 'success');
        }, 2000);
      } else {
        showModalMessage(data.message || 'Erro ao alterar senha.', 'error');
      }
    } catch (error) {
      showModalMessage('Erro de conexão. Tente novamente.', 'error');
    } finally {
      changePasswordBtn.disabled = false;
      changePasswordBtn.innerHTML = originalHTML;
    }
  });

  backStep3?.addEventListener('click', () => showStep(2));

  function showModalMessage(message, type = 'error') {
    const existingMessage = forgotPasswordModal.querySelector('.modal-message');
    if (existingMessage) existingMessage.remove();
    const messageDiv = document.createElement('div');
    messageDiv.className = `modal-message ${type === 'success' ? 'success-message' : 'error-message'}`;
    messageDiv.textContent = message;
    const header = forgotPasswordModal.querySelector('.modal-header');
    if (header) header.insertAdjacentElement('afterend', messageDiv);
    setTimeout(() => messageDiv?.remove(), 5000);
  }

  function showMessage(message, type = 'error') {
    if (!errorMessageDiv) return;
    errorMessageDiv.className = `login-message visible ${type}`;
    errorMessageDiv.textContent = message;
    setTimeout(() => errorMessageDiv.classList.remove('visible'), 5000);
  }

  // ==================== REMEMBER ME ====================
  const rememberCheckbox = document.getElementById('remember-me');

  async function checkRememberToken() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('logout') || urlParams.has('switch') || urlParams.has('force')) {
        console.log('[LOGIN/REMEMBER] ⏭️ Auto-login ignorado');
        try {
          await fetch('/api/auth/remove-remember-token', { method: 'POST', credentials: 'include' });
        } catch (e) {}
        return;
      }
      const response = await fetch('/api/auth/validate-remember-token', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        const userName = data.user?.nome || data.user?.email || 'Usuário';
        showRememberBanner(userName, data.user?.email);
      }
    } catch (error) {}
  }

  function showRememberBanner(userName, userEmail) {
    const existing = document.getElementById('remember-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'remember-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(135deg,hsl(234,89%,64%),hsl(234,89%,50%));color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 24px rgba(0,0,0,0.3);font-family:inherit;backdrop-filter:blur(12px);';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:24px;">👤</span>
        <div>
          <div style="font-weight:600;font-size:15px;">Continuar como ${userName}?</div>
          <div style="font-size:12px;opacity:0.85;">${userEmail || ''}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="remember-continue" style="background:#fff;color:hsl(234,89%,50%);border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Continuar</button>
        <button id="remember-switch" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:8px 20px;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;">Outra conta</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('remember-continue').addEventListener('click', () => {
      window.location.href = '/dashboard';
    });

    document.getElementById('remember-switch').addEventListener('click', async () => {
      banner.remove();
      try {
        await fetch('/api/auth/remove-remember-token', { method: 'POST', credentials: 'include' });
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      } catch (e) {}
      ['token', 'authToken', 'userData', 'user', 'userName', 'userEmail', 'userRole', 'deviceId'].forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      if (emailInput) emailInput.focus();
    });
  }

  checkRememberToken();

  if (rememberCheckbox) {
    rememberCheckbox.addEventListener('change', async () => {
      if (!rememberCheckbox.checked) {
        try {
          await apiFetch('/api/auth/remove-remember-token', { method: 'POST', credentials: 'include' });
        } catch (error) {}
      }
    });
  }

  // ==================== LOADING STATE ====================
  function setLoading(loading) {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('loading', loading);
  }

  function setSuccess() {
    if (!submitBtn) return;
    submitBtn.classList.remove('loading');
    submitBtn.classList.add('success');
  }

  // ==================== FORM SUBMIT ====================
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn && submitBtn.disabled) return;

    // Clear errors
    if (errorMessageDiv) {
      errorMessageDiv.classList.remove('visible');
      errorMessageDiv.textContent = '';
    }
    document.querySelectorAll('.field-error').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.form-input').forEach(el => el.classList.remove('has-error'));

    setLoading(true);

    const username = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
      if (!username) {
        const emailError = document.getElementById('email-error');
        if (emailError) { emailError.querySelector('span').textContent = 'Email é obrigatório'; emailError.style.display = 'flex'; }
        emailInput?.classList.add('has-error');
        emailInput?.focus();
      }
      if (!password) {
        const passError = document.getElementById('password-error');
        if (passError) { passError.querySelector('span').textContent = 'Senha é obrigatória'; passError.style.display = 'flex'; }
        passwordInput?.classList.add('has-error');
        if (username) passwordInput?.focus();
      }
      setLoading(false);
      return;
    }

    try {
      // LIMPEZA COMPLETA ANTES DO LOGIN
      console.log('[LOGIN] 🧹 Limpando dados de sessão anteriores...');
      try {
        ['token', 'authToken', 'userData', 'user', 'user_data', 'userName',
         'chatSupportUser', 'chatSupportConversations', 'chatSupportTickets',
         'chatUser', 'supportTickets', 'chatVoiceEnabled', 'preferred_background',
         'currentUser', 'loggedUser', 'userInfo', 'userProfile', 'deviceId', 'sessionId'
        ].forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch (e) {}

      // Remove remember token com timeout de 3s para não travar
      try {
        const abortCtrl = new AbortController();
        const timeoutId = setTimeout(() => abortCtrl.abort(), 3000);
        await fetch('/api/auth/remove-remember-token', { method: 'POST', credentials: 'include', signal: abortCtrl.signal });
        clearTimeout(timeoutId);
      } catch (e) {
        console.warn('[LOGIN] remove-remember-token ignorado:', e.message);
      }

      try { if (window.AluforceAuth && typeof AluforceAuth.clearAuth === 'function') AluforceAuth.clearAuth(); } catch {}

      console.log('[LOGIN] 📡 Enviando credenciais para /api/login...');
      // API LOGIN CALL
      const response = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: username, password })
      });

      console.log('[LOGIN] 📡 Resposta recebida:', response.status);
      let data = {};
      try { data = await response.json(); } catch (e) { console.warn('[LOGIN] Erro ao parsear JSON:', e.message); data = {}; }
      console.log('[LOGIN] 📦 Dados:', JSON.stringify(data).substring(0, 200));

      if (!response.ok) {
        if (data && data.code === 'ACCOUNT_TERMINATED') {
          showTerminatedAccountModal(data.message || 'Seu vínculo com a empresa foi encerrado.');
          setLoading(false);
          return;
        }
        const msg = (data && data.message) ? data.message : `Erro de autenticação (${response.status})`;
        throw new Error(msg);
      }

      // ═══════════════════════════════════════════════════════════
      // 🔐 2FA - Se o servidor pedir verificação de dois fatores
      // ═══════════════════════════════════════════════════════════
      if (data && data.requires2FA) {
        console.log('[LOGIN] 🔐 2FA requerido - exibindo modal...');
        setLoading(false);
        show2FAModal(data.pendingToken, data.maskedEmail);
        console.log('[LOGIN] 🔐 Modal 2FA exibido com sucesso');
        return; // Para aqui - o modal 2FA continua o fluxo
      }

      // ═══════════════════════════════════════════════════════════
      // 🔑 TROCA OBRIGATÓRIA - Senha temporária (esqueci-senha)
      // ═══════════════════════════════════════════════════════════
      if (data && data.forcePasswordChange) {
        console.log('[LOGIN] 🔑 Senha temporária detectada - exibindo modal de troca...');
        setLoading(false);
        showForceChangePasswordModal(data.token, data.user, data.deviceId, data.redirectTo);
        return; // Para aqui - o modal de troca continua o fluxo
      }

      // Cleanup and save fresh data
      try {
        ['token', 'authToken', 'userData', 'user', 'user_data', 'userName',
         'chatSupportUser', 'chatSupportConversations', 'chatSupportTickets',
         'chatUser', 'supportTickets', 'chatVoiceEnabled', 'preferred_background',
         'currentUser', 'loggedUser', 'deviceId', 'sessionId'
        ].forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch (e) {}

      if (data.token) {
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('token', data.token);
        sessionStorage.setItem('tabAuthToken', data.token);
      }

      if (data.deviceId) {
        sessionStorage.setItem('deviceId', data.deviceId);
      }

      if (data.user) {
        const userDataJson = JSON.stringify(data.user);
        localStorage.setItem('userData', userDataJson);
        sessionStorage.setItem('tabUserData', userDataJson);
        localStorage.setItem('userEmail', data.user.email || '');
        localStorage.setItem('userRole', data.user.role || '');
        localStorage.setItem('userName', data.user.nome || data.user.name || '');
      }

      // Show success state
      setSuccess();

      // Handle redirect
      if (data && data.redirectTo) {
        let redirectTo = data.redirectTo;
        try {
          const parsed = new URL(redirectTo, window.location.origin);
          redirectTo = parsed.pathname + parsed.search + parsed.hash;
        } catch (e) {}
        if (redirectTo === '/index.html' || redirectTo === '/index.html/') redirectTo = '/dashboard';

        // Remember me token
        if (rememberCheckbox && rememberCheckbox.checked && data.user) {
          try {
            await apiFetch('/api/auth/create-remember-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ userId: data.user.id, email: data.user.email })
            });
          } catch (e) {}
        }

        await new Promise(r => setTimeout(r, 100));

        // Preload
        try {
          const linkCSS = document.createElement('link'); linkCSS.rel = 'prefetch'; linkCSS.href = '/css/skeleton-loader.css'; document.head.appendChild(linkCSS);
          const linkJS = document.createElement('link'); linkJS.rel = 'prefetch'; linkJS.href = '/js/performance-utils.js'; document.head.appendChild(linkJS);
        } catch(e) {}

        try {
          const meResp = await apiFetch('/api/me', {
            credentials: 'include',
            headers: { 'Authorization': 'Bearer ' + data.token }
          });
          if (meResp.ok) {
            const userData = await meResp.json();
            const freshJson = JSON.stringify(userData);
            localStorage.setItem('userData', freshJson);
            sessionStorage.setItem('tabUserData', freshJson);

            let finalRedirect = redirectTo;
            if (returnTo) {
              const decodedReturn = decodeURIComponent(returnTo);
              if (decodedReturn.startsWith('/') && !decodedReturn.startsWith('//')) {
                finalRedirect = decodedReturn;
              }
            }
            window.location.href = finalRedirect;
            return;
          } else {
            throw new Error('Sessão não confirmada.');
          }
        } catch (e) {
          throw new Error('Falha ao verificar sessão: ' + e.message);
        }
      }

      // No redirect suggested - verify session
      if (rememberCheckbox && rememberCheckbox.checked && data.user) {
        try {
          await apiFetch('/api/auth/create-remember-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userId: data.user.id, email: data.user.email })
          });
        } catch (e) {}
      }

      try {
        const meResp = await apiFetch('/api/me', {
          credentials: 'include',
          headers: { 'Authorization': 'Bearer ' + data.token }
        });
        if (meResp.ok) {
          const userData = await meResp.json();
          const freshJson = JSON.stringify(userData);
          localStorage.setItem('userData', freshJson);
          sessionStorage.setItem('tabUserData', freshJson);

          let finalRedirect = '/dashboard';
          if (returnTo) {
            const decodedReturn = decodeURIComponent(returnTo);
            if (decodedReturn.startsWith('/') && !decodedReturn.startsWith('//')) finalRedirect = decodedReturn;
          }
          window.location.href = finalRedirect;
        } else {
          throw new Error('Falha ao autenticar sessão.');
        }
      } catch (e) {
        throw new Error('Falha ao autenticar sessão. Tente novamente.');
      }
    } catch (error) {
      console.error('[LOGIN] ❌ Erro no login:', error);
      submitBtn?.classList.remove('success');
      const msg = error && error.message ? error.message : 'Erro ao efetuar login';
      showMessage(msg, 'error');
      emailInput?.focus();
    } finally {
      console.log('[LOGIN] 🏁 finally - setLoading(false)');
      setLoading(false);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔐 2FA - SISTEMA DE VERIFICAÇÃO DE DOIS FATORES
  // ═══════════════════════════════════════════════════════════════════════════

  let twoFA_pendingToken = null;
  let twoFA_countdownInterval = null;

  function show2FAModal(pendingToken, maskedEmail) {
    twoFA_pendingToken = pendingToken;

    const modal = document.getElementById('modal-2fa');
    const emailDisplay = document.getElementById('twofa-email-display');
    const errorDiv = document.getElementById('twofa-error');
    const successDiv = document.getElementById('twofa-success');
    const digits = document.querySelectorAll('.twofa-digit');
    const verifyBtn = document.getElementById('twofa-verify-btn');

    // Reset state
    if (emailDisplay) emailDisplay.textContent = maskedEmail || '***@aluforce.ind.br';
    if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.textContent = ''; }
    if (successDiv) { successDiv.style.display = 'none'; successDiv.textContent = ''; }
    digits.forEach(d => { d.value = ''; d.classList.remove('has-value', 'error'); });
    if (verifyBtn) verifyBtn.disabled = true;

    // Show modal - MUST add .show class for opacity/visibility (CSS .modal-overlay hides by default)
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('show');
      modal.style.opacity = '1';
      modal.style.visibility = 'visible';
    }

    // Focus first digit
    setTimeout(() => { if (digits[0]) digits[0].focus(); }, 200);

    // Start countdown
    startCountdown(5 * 60);
  }

  function hide2FAModal() {
    const modal = document.getElementById('modal-2fa');
    if (modal) {
      modal.classList.remove('show');
      modal.style.opacity = '0';
      modal.style.visibility = 'hidden';
      setTimeout(() => { if (modal) modal.style.display = 'none'; }, 300);
    }
    twoFA_pendingToken = null;
    if (twoFA_countdownInterval) { clearInterval(twoFA_countdownInterval); twoFA_countdownInterval = null; }
  }

  function startCountdown(seconds) {
    if (twoFA_countdownInterval) clearInterval(twoFA_countdownInterval);
    let remaining = seconds;
    const countdownEl = document.getElementById('twofa-countdown');
    const timerEl = document.getElementById('twofa-timer');

    function update() {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      if (countdownEl) countdownEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      if (remaining <= 0) {
        clearInterval(twoFA_countdownInterval);
        if (timerEl) timerEl.innerHTML = '<span style="color:#dc2626;">⚠️ Código expirado. Clique em "Reenviar código".</span>';
      }
      remaining--;
    }
    update();
    twoFA_countdownInterval = setInterval(update, 1000);
  }

  // ─── Digit input handling ──────────────────────────────────────
  const digitInputs = document.querySelectorAll('.twofa-digit');
  const verifyButton = document.getElementById('twofa-verify-btn');

  digitInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.substring(0, 1);

      if (val) {
        e.target.classList.add('has-value');
        e.target.classList.remove('error');
        // Move to next
        if (index < 5 && digitInputs[index + 1]) {
          digitInputs[index + 1].focus();
        }
      } else {
        e.target.classList.remove('has-value');
      }

      // Check if all digits filled
      checkAllDigitsFilled();
    });

    input.addEventListener('keydown', (e) => {
      // Backspace: clear and move back
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        digitInputs[index - 1].value = '';
        digitInputs[index - 1].classList.remove('has-value');
        digitInputs[index - 1].focus();
        checkAllDigitsFilled();
      }
      // Enter: submit if all filled
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!verifyButton.disabled) verify2FACode();
      }
      // Arrow keys
      if (e.key === 'ArrowLeft' && index > 0) digitInputs[index - 1].focus();
      if (e.key === 'ArrowRight' && index < 5) digitInputs[index + 1].focus();
    });

    // Handle paste
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').substring(0, 6);
      if (pasteData.length >= 1) {
        for (let i = 0; i < 6; i++) {
          if (digitInputs[i] && pasteData[i]) {
            digitInputs[i].value = pasteData[i];
            digitInputs[i].classList.add('has-value');
          }
        }
        const focusIndex = Math.min(pasteData.length, 5);
        digitInputs[focusIndex].focus();
        checkAllDigitsFilled();
      }
    });

    input.addEventListener('focus', () => { input.select(); });
  });

  function checkAllDigitsFilled() {
    const code = getCodeFromDigits();
    if (verifyButton) verifyButton.disabled = (code.length !== 6);
  }

  function getCodeFromDigits() {
    let code = '';
    digitInputs.forEach(d => { code += d.value; });
    return code;
  }

  // ─── Verify button ────────────────────────────────────────────
  if (verifyButton) {
    verifyButton.addEventListener('click', () => verify2FACode());
  }

  async function verify2FACode() {
    const code = getCodeFromDigits();
    if (code.length !== 6 || !twoFA_pendingToken) return;

    const errorDiv = document.getElementById('twofa-error');
    const successDiv = document.getElementById('twofa-success');
    if (errorDiv) errorDiv.style.display = 'none';
    if (successDiv) successDiv.style.display = 'none';

    // Disable button and show loading
    if (verifyButton) {
      verifyButton.disabled = true;
      verifyButton.innerHTML = '<svg class="spinner-icon" style="animation:spin 0.8s linear infinite;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Verificando...';
    }

    try {
      const rememberDevice = document.getElementById('twofa-remember-device');
      const response = await apiFetch('/api/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pendingToken: twoFA_pendingToken,
          code: code,
          rememberDevice: rememberDevice ? rememberDevice.checked : false
        })
      });

      let data = {};
      try { data = await response.json(); } catch (e) { data = {}; }

      if (!response.ok) {
        // Show error
        if (errorDiv) {
          errorDiv.textContent = data.message || 'Código inválido.';
          errorDiv.style.display = 'block';
        }
        // Shake the digits
        digitInputs.forEach(d => {
          d.classList.add('error');
          setTimeout(() => d.classList.remove('error'), 500);
        });

        // If expired, redirect back to login
        if (data.expired) {
          setTimeout(() => { hide2FAModal(); }, 2000);
        }

        // Re-enable button
        resetVerifyButton();
        return;
      }

      // ✅ 2FA SUCCESS — Show success, then process login data
      if (successDiv) {
        successDiv.innerHTML = '✅ Código verificado com sucesso! Redirecionando...';
        successDiv.style.display = 'block';
      }
      if (verifyButton) {
        verifyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Verificado!';
        verifyButton.style.background = 'linear-gradient(135deg, #16a34a, #15803d)';
      }

      // Process the login data (same as normal login flow)
      try {
        ['token', 'authToken', 'userData', 'user', 'user_data', 'userName',
         'chatSupportUser', 'chatSupportConversations', 'chatSupportTickets',
         'chatUser', 'supportTickets', 'chatVoiceEnabled', 'preferred_background',
         'currentUser', 'loggedUser', 'deviceId', 'sessionId'
        ].forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch (e) {}

      if (data.token) {
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('token', data.token);
        sessionStorage.setItem('tabAuthToken', data.token);
      }
      if (data.deviceId) {
        sessionStorage.setItem('deviceId', data.deviceId);
      }
      if (data.user) {
        const userDataJson = JSON.stringify(data.user);
        localStorage.setItem('userData', userDataJson);
        sessionStorage.setItem('tabUserData', userDataJson);
        localStorage.setItem('userEmail', data.user.email || '');
        localStorage.setItem('userRole', data.user.role || '');
        localStorage.setItem('userName', data.user.nome || data.user.name || '');
      }

      // Handle redirect
      setTimeout(() => {
        let redirectTo = (data.redirectTo || '/dashboard');
        try {
          const parsed = new URL(redirectTo, window.location.origin);
          redirectTo = parsed.pathname + parsed.search + parsed.hash;
        } catch (e) {}
        if (redirectTo === '/index.html' || redirectTo === '/index.html/') redirectTo = '/dashboard';

        // Remember me
        const rememberCheckbox = document.getElementById('remember-me');
        if (rememberCheckbox && rememberCheckbox.checked && data.user) {
          apiFetch('/api/auth/create-remember-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userId: data.user.id, email: data.user.email })
          }).catch(() => {});
        }

        // Fetch /api/me for fresh data
        apiFetch('/api/me', {
          credentials: 'include',
          headers: { 'Authorization': 'Bearer ' + data.token }
        }).then(r => r.ok ? r.json() : Promise.reject()).then(userData => {
          const freshJson = JSON.stringify(userData);
          localStorage.setItem('userData', freshJson);
          sessionStorage.setItem('tabUserData', freshJson);

          const returnTo = new URLSearchParams(window.location.search).get('returnTo');
          let finalRedirect = redirectTo;
          if (returnTo) {
            const decoded = decodeURIComponent(returnTo);
            if (decoded.startsWith('/') && !decoded.startsWith('//')) finalRedirect = decoded;
          }
          window.location.href = finalRedirect;
        }).catch(() => {
          window.location.href = redirectTo;
        });
      }, 800);

    } catch (error) {
      if (errorDiv) {
        errorDiv.textContent = 'Erro de conexão. Tente novamente.';
        errorDiv.style.display = 'block';
      }
      resetVerifyButton();
    }
  }

  function resetVerifyButton() {
    if (verifyButton) {
      verifyButton.disabled = (getCodeFromDigits().length !== 6);
      verifyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 12l2 2 4-4"/><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Verificar Código';
      verifyButton.style.background = 'linear-gradient(135deg, #1a73e8, #0d47a1)';
    }
  }

  // ─── Resend button ────────────────────────────────────────────
  const resendBtn = document.getElementById('twofa-resend-btn');
  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (!twoFA_pendingToken) return;

      const errorDiv = document.getElementById('twofa-error');
      const successDiv = document.getElementById('twofa-success');
      if (errorDiv) errorDiv.style.display = 'none';

      resendBtn.disabled = true;
      resendBtn.textContent = 'Enviando...';

      try {
        const response = await apiFetch('/api/resend-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pendingToken: twoFA_pendingToken })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          if (successDiv) {
            successDiv.textContent = '✅ Novo código enviado com sucesso!';
            successDiv.style.display = 'block';
            setTimeout(() => { successDiv.style.display = 'none'; }, 3000);
          }
          // Reset digits
          digitInputs.forEach(d => { d.value = ''; d.classList.remove('has-value'); });
          if (digitInputs[0]) digitInputs[0].focus();
          checkAllDigitsFilled();
          // Restart countdown
          startCountdown(5 * 60);
        } else {
          if (data.expired) {
            hide2FAModal();
            showMessage('Sessão expirada. Faça login novamente.', 'error');
          } else if (errorDiv) {
            errorDiv.textContent = data.message || 'Erro ao reenviar código.';
            errorDiv.style.display = 'block';
          }
        }
      } catch (e) {
        if (errorDiv) {
          errorDiv.textContent = 'Erro de conexão. Tente novamente.';
          errorDiv.style.display = 'block';
        }
      }

      // Cooldown 30s
      let cooldown = 30;
      resendBtn.textContent = `Reenviar em ${cooldown}s`;
      const cooldownInterval = setInterval(() => {
        cooldown--;
        resendBtn.textContent = `Reenviar em ${cooldown}s`;
        if (cooldown <= 0) {
          clearInterval(cooldownInterval);
          resendBtn.textContent = 'Reenviar código';
          resendBtn.disabled = false;
        }
      }, 1000);
    });
  }

  // ─── Cancel button ────────────────────────────────────────────
  const cancelBtn = document.getElementById('twofa-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      hide2FAModal();
      emailInput?.focus();
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 🔑 MODAL DE TROCA OBRIGATÓRIA DE SENHA TEMPORÁRIA
  // ════════════════════════════════════════════════════════════════════
  function showForceChangePasswordModal(authToken, userData, deviceId, redirectTo) {
    const modal = document.getElementById('modal-force-password');
    if (!modal) { console.error('[FORCE-PW] Modal não encontrado'); return; }

    modal.style.display = 'flex';
    setTimeout(() => { modal.style.opacity = '1'; }, 10);

    const newPwInput = document.getElementById('force-new-password');
    const confirmPwInput = document.getElementById('force-confirm-password');
    const changeBtn = document.getElementById('force-change-btn');
    const errorDiv = document.getElementById('force-pw-error');
    const successDiv = document.getElementById('force-pw-success');
    const strengthBar = document.getElementById('force-pw-strength-bar');
    const strengthText = document.getElementById('force-pw-strength-text');
    const togglePw1 = document.getElementById('force-toggle-pw1');
    const togglePw2 = document.getElementById('force-toggle-pw2');

    // Reset state
    if (newPwInput) newPwInput.value = '';
    if (confirmPwInput) confirmPwInput.value = '';
    if (errorDiv) errorDiv.style.display = 'none';
    if (successDiv) successDiv.style.display = 'none';
    if (strengthBar) { strengthBar.style.width = '0%'; strengthBar.style.background = ''; }
    if (strengthText) strengthText.textContent = 'Digite uma senha forte';

    // Focus
    setTimeout(() => { if (newPwInput) newPwInput.focus(); }, 300);

    // Toggle password visibility
    function setupToggle(btn, input) {
      if (!btn || !input) return;
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', () => {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        newBtn.innerHTML = isPassword
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      });
    }
    setupToggle(togglePw1, newPwInput);
    setupToggle(togglePw2, confirmPwInput);

    // Password strength checker
    function updateStrength(password) {
      if (!strengthBar || !strengthText) return;
      let strength = 0;
      if (password.length >= 8) strength++;
      if (/[a-z]/.test(password)) strength++;
      if (/[A-Z]/.test(password)) strength++;
      if (/[0-9]/.test(password)) strength++;
      if (/[^A-Za-z0-9]/.test(password)) strength++;

      const colors = ['', 'hsl(0,84%,60%)', 'hsl(0,84%,60%)', 'hsl(38,92%,50%)', 'hsl(234,89%,64%)', 'hsl(142,76%,45%)'];
      const widths = ['0%', '20%', '40%', '60%', '80%', '100%'];
      const labels = ['Digite uma senha forte', 'Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'];

      strengthBar.style.width = widths[strength] || '0%';
      strengthBar.style.background = colors[strength] || '';
      strengthText.textContent = labels[strength] || '';
    }

    // Input focus/blur styling
    function addInputStyle(input) {
      if (!input) return;
      input.addEventListener('focus', () => {
        input.style.borderColor = 'hsl(234,89%,64%)';
        input.style.boxShadow = '0 0 0 3px hsla(234,89%,64%,0.2)';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = 'hsl(210,40%,98%,0.12)';
        input.style.boxShadow = 'none';
      });
    }
    addInputStyle(newPwInput);
    addInputStyle(confirmPwInput);

    // Password strength on input
    if (newPwInput) {
      const newInput = newPwInput;
      newInput.addEventListener('input', () => updateStrength(newInput.value));
    }

    // Submit handler (clone button to remove old listeners)
    if (changeBtn) {
      const newChangeBtn = changeBtn.cloneNode(true);
      changeBtn.parentNode.replaceChild(newChangeBtn, changeBtn);

      newChangeBtn.addEventListener('click', async () => {
        const newPassword = document.getElementById('force-new-password')?.value;
        const confirmPassword = document.getElementById('force-confirm-password')?.value;
        const errDiv = document.getElementById('force-pw-error');
        const sucDiv = document.getElementById('force-pw-success');

        // Validações
        if (!newPassword || !confirmPassword) {
          if (errDiv) { errDiv.textContent = 'Preencha ambos os campos de senha.'; errDiv.style.display = 'block'; }
          return;
        }
        if (newPassword.length < 6) {
          if (errDiv) { errDiv.textContent = 'A senha deve ter pelo menos 6 caracteres.'; errDiv.style.display = 'block'; }
          return;
        }
        if (newPassword !== confirmPassword) {
          if (errDiv) { errDiv.textContent = 'As senhas não coincidem.'; errDiv.style.display = 'block'; }
          return;
        }

        if (errDiv) errDiv.style.display = 'none';

        // Loading state
        newChangeBtn.disabled = true;
        const originalHTML = newChangeBtn.innerHTML;
        newChangeBtn.innerHTML = '<svg class="spinner-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Alterando...';

        try {
          const response = await apiFetch('/api/auth/force-change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token: authToken, newPassword })
          });

          const result = await response.json();

          if (response.ok && result.success) {
            if (sucDiv) { sucDiv.textContent = '✅ Senha alterada com sucesso! Redirecionando...'; sucDiv.style.display = 'block'; }
            newChangeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Senha Alterada!';
            newChangeBtn.style.background = 'linear-gradient(135deg, hsl(142,76%,45%), hsl(142,76%,36%))';
            newChangeBtn.style.boxShadow = '0 4px 16px hsla(142,76%,45%,0.3)';

            // Salvar dados do login e redirecionar
            setTimeout(() => {
              try {
                ['token', 'authToken', 'userData', 'user', 'user_data', 'userName',
                 'chatSupportUser', 'chatSupportConversations', 'chatSupportTickets',
                 'chatUser', 'supportTickets', 'chatVoiceEnabled', 'preferred_background',
                 'currentUser', 'loggedUser', 'deviceId', 'sessionId'
                ].forEach(k => localStorage.removeItem(k));
                sessionStorage.clear();
              } catch (e) {}

              if (authToken) {
                localStorage.setItem('authToken', authToken);
                localStorage.setItem('token', authToken);
                sessionStorage.setItem('tabAuthToken', authToken);
              }
              if (deviceId) {
                sessionStorage.setItem('deviceId', deviceId);
              }
              if (userData) {
                const userDataJson = JSON.stringify(userData);
                localStorage.setItem('userData', userDataJson);
                sessionStorage.setItem('tabUserData', userDataJson);
                localStorage.setItem('userEmail', userData.email || '');
                localStorage.setItem('userRole', userData.role || '');
                localStorage.setItem('userName', userData.nome || userData.name || '');
              }

              // Redirecionar
              let finalRedirect = redirectTo || '/dashboard';
              try {
                const parsed = new URL(finalRedirect, window.location.origin);
                finalRedirect = parsed.pathname + parsed.search + parsed.hash;
              } catch (e) {}
              if (finalRedirect === '/index.html' || finalRedirect === '/index.html/') finalRedirect = '/dashboard';
              window.location.href = finalRedirect;
            }, 1500);

          } else {
            if (errDiv) { errDiv.textContent = result.message || 'Erro ao alterar senha.'; errDiv.style.display = 'block'; }
            newChangeBtn.disabled = false;
            newChangeBtn.innerHTML = originalHTML;
          }
        } catch (error) {
          console.error('[FORCE-PW] Erro:', error);
          if (errDiv) { errDiv.textContent = 'Erro de conexão. Tente novamente.'; errDiv.style.display = 'block'; }
          newChangeBtn.disabled = false;
          newChangeBtn.innerHTML = originalHTML;
        }
      });
    }

    // Enter key support
    if (confirmPwInput) {
      confirmPwInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const btn = document.getElementById('force-change-btn');
          if (btn && !btn.disabled) btn.click();
        }
      });
    }
    if (newPwInput) {
      newPwInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const cInput = document.getElementById('force-confirm-password');
          if (cInput) cInput.focus();
        }
      });
    }

    console.log('[FORCE-PW] 🔑 Modal de troca obrigatória exibido');
  }

});
