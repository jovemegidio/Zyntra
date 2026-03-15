(function () {
  'use strict';

  const ADMIN_ROLES = new Set(['admin', 'administrador', 'superadmin', 'rh', 'diretoria', 'ti', 'analista de t.i', 'financeiro']);
  const MANAGER_ROLES = new Set(['gestor', 'gerente', 'coordenador', 'supervisor', 'lider', 'lideranca', 'líder', 'liderança']);

  const avatarNameMap = {
    clemerson: '/avatars/Clemerson.webp',
    isabela: '/avatars/Isabela.webp',
    thaina: '/avatars/Thaina.webp',
    thiago: '/avatars/Thiago.webp',
    nicolas: '/avatars/NicolasDaniel.webp',
    nicolasdaniel: '/avatars/NicolasDaniel.webp',
    rh: '/avatars/Rh.webp',
    admin: '/avatars/admin.webp',
    ti: '/avatars/TI.webp',
    tialuforce: '/avatars/TI.webp',
    antonio: '/avatars/Antonio.webp',
    antonio2: '/avatars/Antonio.webp',
    andreia: '/avatars/Andreia.webp',
    guilherme: '/avatars/Guilherme.webp',
    marcelo: '/avatars/Marcelo.webp',
    financeiro: '/avatars/Financeiro.webp',
    douglas: '/avatars/Douglas.webp',
    hellen: '/avatars/Hellen.webp',
    helen: '/avatars/Hellen.webp'
  };

  let cachedUser = null;

  function normalizeText(value) {
    if (!value) return '';
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function getAuthHeaders(extraHeaders) {
    return Object.assign(
      {
      },
      extraHeaders || {}
    );
  }

  async function getCurrentUser(forceReload) {
    if (cachedUser && !forceReload) return cachedUser;
    const resp = await fetch('/api/me', {
      headers: getAuthHeaders(),
      credentials: 'include'
    });
    if (!resp.ok) throw new Error('Nao foi possivel carregar usuario');
    const user = await resp.json();
    cachedUser = user;
    return user;
  }

  function isAdminUser(user) {
    const role = normalizeText(user && user.role);
    return ADMIN_ROLES.has(role);
  }

  function isManagerUser(user) {
    if (isAdminUser(user)) return true;
    const role = normalizeText(user && user.role);
    if (MANAGER_ROLES.has(role)) return true;
    const cargo = normalizeText(user && user.cargo);
    return MANAGER_ROLES.has(cargo);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
  }

  function getAvatarFromEmail(email, nome) {
    if (!email) return null;
    const username = normalizeText(email.split('@')[0].split('.')[0]);
    if (avatarNameMap[username]) return avatarNameMap[username];
    if (nome) {
      const firstName = normalizeText(nome.split(' ')[0]);
      if (avatarNameMap[firstName]) return avatarNameMap[firstName];
    }
    return null;
  }

  function updateHeaderUser(user) {
    const greetingTextEl = document.getElementById('greeting-text');
    if (greetingTextEl) {
      const hour = new Date().getHours();
      let greeting = 'Bom dia';
      if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
      else if (hour >= 18 || hour < 5) greeting = 'Boa noite';
      greetingTextEl.textContent = greeting;
    }

    const userName = user.apelido || user.nome || 'Usuario';
    const firstName = user.apelido || (user.nome ? user.nome.split(' ')[0] : 'Usuario');
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.textContent = firstName;

    let avatar = user.avatar && user.avatar !== '/avatars/default.webp' ? user.avatar : null;
    if (!avatar) avatar = getAvatarFromEmail(user.email, userName);

    const userPhotoEl = document.getElementById('user-photo');
    const userInitialEl = document.getElementById('user-initials');
    if (avatar && userPhotoEl) {
      userPhotoEl.src = avatar;
      userPhotoEl.classList.add('visible');
      userPhotoEl.style.display = 'block';
      if (userInitialEl) userInitialEl.style.display = 'none';
    } else if (userInitialEl) {
      userInitialEl.textContent = firstName.charAt(0).toUpperCase();
      userInitialEl.style.display = 'flex';
      if (userPhotoEl) userPhotoEl.style.display = 'none';
    }
  }

  function toggleMobileSidebar() {
    const sidebar = document.getElementById('mobile-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  }

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    if (!toast || !toastMessage) return;

    toast.className = `toast toast-${type || 'info'}`;
    toastMessage.textContent = message;
    toast.classList.add('show');

    window.setTimeout(function () {
      toast.classList.remove('show');
    }, 3500);
  }

  async function ensureRole(config) {
    const options = config || {};
    const user = await getCurrentUser();

    if (options.adminOnly && !isAdminUser(user)) {
      throw new Error('Acesso restrito a administradores de RH.');
    }

    if (options.managerOrAdmin && !isManagerUser(user)) {
      throw new Error('Acesso restrito a gestores e administradores.');
    }

    return user;
  }

  window.rhUiCommon = {
    escapeHtml,
    getAuthHeaders,
    getCurrentUser,
    isAdminUser,
    isManagerUser,
    updateHeaderUser,
    toggleMobileSidebar,
    showToast,
    ensureRole
  };
})();
