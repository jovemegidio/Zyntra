/**
 * Zyntra iOS Native Bridge
 * Ponte entre a web app e APIs nativas iOS via Capacitor
 * 
 * Inclua este script no HTML: <script src="/js/ios-native-bridge.js"></script>
 * Inicializa automaticamente quando detecta ambiente Capacitor/iOS
 */

(function() {
  'use strict';

  // Detectar se estamos rodando dentro do Capacitor
  const isCapacitor = typeof window.Capacitor !== 'undefined';
  const isIOS = isCapacitor && window.Capacitor.getPlatform() === 'ios';
  const isAndroid = isCapacitor && window.Capacitor.getPlatform() === 'android';
  const isNativeApp = isCapacitor && window.Capacitor.isNativePlatform();

  if (!isNativeApp) {
    console.log('[Zyntra] Rodando no browser, bridge nativo desabilitado');
    // Expor métodos stub para compatibilidade
    window.ZyntraApp = { isNative: false, platform: 'web' };
    return;
  }

  console.log(`[Zyntra] App nativo detectado: ${window.Capacitor.getPlatform()}`);

  // ── Imports Capacitor ──
  const { Capacitor, registerPlugin } = window.Capacitor;
  const { Plugins } = Capacitor;

  // Lazy-load plugins
  let StatusBar, SplashScreen, App, Keyboard, Haptics, 
      PushNotifications, LocalNotifications, Camera,
      Network, Filesystem, Share, Browser, Device, Toast;

  async function loadPlugins() {
    try {
      const modules = await Promise.allSettled([
        import('@capacitor/status-bar').catch(() => null),
        import('@capacitor/splash-screen').catch(() => null),
        import('@capacitor/app').catch(() => null),
        import('@capacitor/keyboard').catch(() => null),
        import('@capacitor/haptics').catch(() => null),
        import('@capacitor/push-notifications').catch(() => null),
        import('@capacitor/local-notifications').catch(() => null),
        import('@capacitor/camera').catch(() => null),
        import('@capacitor/network').catch(() => null),
        import('@capacitor/filesystem').catch(() => null),
        import('@capacitor/share').catch(() => null),
        import('@capacitor/browser').catch(() => null),
        import('@capacitor/device').catch(() => null),
        import('@capacitor/toast').catch(() => null),
      ]);

      const get = (idx) => modules[idx]?.status === 'fulfilled' ? modules[idx].value : null;

      StatusBar = get(0)?.StatusBar;
      SplashScreen = get(1)?.SplashScreen;
      App = get(2)?.App;
      Keyboard = get(3)?.Keyboard;
      Haptics = get(4)?.Haptics;
      PushNotifications = get(5)?.PushNotifications;
      LocalNotifications = get(6)?.LocalNotifications;
      Camera = get(7)?.Camera;
      Network = get(8)?.Network;
      Filesystem = get(9)?.Filesystem;
      Share = get(10)?.Share;
      Browser = get(11)?.Browser;
      Device = get(12)?.Device;
      Toast = get(13)?.Toast;
    } catch(e) {
      console.warn('[Zyntra] Fallback: usando Plugins globais', e);
      StatusBar = Plugins.StatusBar;
      SplashScreen = Plugins.SplashScreen;
      App = Plugins.App;
      Keyboard = Plugins.Keyboard;
      Haptics = Plugins.Haptics;
      PushNotifications = Plugins.PushNotifications;
      LocalNotifications = Plugins.LocalNotifications;
      Camera = Plugins.Camera;
      Network = Plugins.Network;
      Filesystem = Plugins.Filesystem;
      Share = Plugins.Share;
      Browser = Plugins.Browser;
      Device = Plugins.Device;
      Toast = Plugins.Toast;
    }
  }

  // ══════════════════════════════════════════════
  // STATUS BAR
  // ══════════════════════════════════════════════
  async function setupStatusBar() {
    if (!StatusBar) return;
    try {
      await StatusBar.setStyle({ style: 'DARK' });
      if (isIOS) {
        await StatusBar.setOverlaysWebView({ overlay: false });
      }
      if (isAndroid) {
        await StatusBar.setBackgroundColor({ color: '#0f172a' });
      }
    } catch(e) {
      console.warn('[Zyntra] StatusBar error:', e);
    }
  }

  // ══════════════════════════════════════════════
  // APP LIFECYCLE
  // ══════════════════════════════════════════════
  function setupAppLifecycle() {
    if (!App) return;

    // Voltar (Android back button / iOS swipe back)
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        // Confirmar saída
        showIOSAlert(
          'Sair do Zyntra?',
          'Deseja realmente fechar o aplicativo?',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Sair', style: 'destructive', handler: () => App.exitApp() }
          ]
        );
      }
    });

    // App voltou ao foreground
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        console.log('[Zyntra] App retomado');
        document.dispatchEvent(new CustomEvent('zyntra:app-resumed'));
        // Revalidar sessão
        checkSessionOnResume();
      } else {
        console.log('[Zyntra] App em background');
        document.dispatchEvent(new CustomEvent('zyntra:app-paused'));
      }
    });

    // Deep link
    App.addListener('appUrlOpen', ({ url }) => {
      console.log('[Zyntra] Deep link:', url);
      const path = new URL(url).pathname;
      if (path) {
        window.location.href = path;
      }
    });
  }

  async function checkSessionOnResume() {
    try {
      if (!token) return;

      const res = await fetch('/api/verify-token', {
        credentials: 'include'
      });
      if (!res.ok) {
        localStorage.removeItem('token');
        localStorage.removeItem('authToken');
        window.location.href = '/login.html';
      }
    } catch(e) {
      // Offline, manter sessão
    }
  }

  // ══════════════════════════════════════════════
  // KEYBOARD
  // ══════════════════════════════════════════════
  function setupKeyboard() {
    if (!Keyboard) return;

    Keyboard.addListener('keyboardWillShow', (info) => {
      document.body.classList.add('keyboard-visible');
      document.body.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      
      // Scroll para o input ativo
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        setTimeout(() => {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    });

    Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.remove('keyboard-visible');
      document.body.style.removeProperty('--keyboard-height');
    });
  }

  // ══════════════════════════════════════════════
  // HAPTICS
  // ══════════════════════════════════════════════
  const haptic = {
    async impact(style = 'Medium') {
      if (!Haptics) return;
      try {
        await Haptics.impact({ style });
      } catch(e) { /* silently fail */ }
    },
    async notification(type = 'Success') {
      if (!Haptics) return;
      try {
        await Haptics.notification({ type });
      } catch(e) {}
    },
    async selection() {
      if (!Haptics) return;
      try {
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
        await Haptics.selectionEnd();
      } catch(e) {}
    }
  };

  // ══════════════════════════════════════════════
  // PUSH NOTIFICATIONS
  // ══════════════════════════════════════════════
  async function setupPushNotifications() {
    if (!PushNotifications) return;

    try {
      const permStatus = await PushNotifications.checkPermissions();
      
      if (permStatus.receive === 'prompt') {
        const result = await PushNotifications.requestPermissions();
        if (result.receive !== 'granted') {
          console.log('[Zyntra] Push notifications negadas');
          return;
        }
      }

      if (permStatus.receive === 'denied') {
        console.log('[Zyntra] Push notifications bloqueadas');
        return;
      }

      await PushNotifications.register();

      // Token recebido
      PushNotifications.addListener('registration', async (token) => {
        console.log('[Zyntra] Push token:', token.value);
        // Enviar token ao servidor
        try {
          if (authToken) {
            await fetch('/api/push/register', { credentials: 'include', method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                token: token.value,
                platform: Capacitor.getPlatform()
              })
            });
          }
        } catch(e) {
          console.warn('[Zyntra] Erro ao registrar push token:', e);
        }
      });

      // Erro no registro
      PushNotifications.addListener('registrationError', (error) => {
        console.error('[Zyntra] Push registration error:', error);
      });

      // Notificação recebida em foreground
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[Zyntra] Push recebido:', notification);
        haptic.notification('Success');
        showIOSToast({
          title: notification.title,
          body: notification.body,
          icon: 'fa-bell',
          color: '#6366f1'
        });
      });

      // Notificação clicada
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data;
        if (data?.url) {
          window.location.href = data.url;
        } else if (data?.module) {
          window.location.href = `/modules/${data.module}/`;
        }
      });

    } catch(e) {
      console.warn('[Zyntra] Push setup error:', e);
    }
  }

  // ══════════════════════════════════════════════
  // NETWORK
  // ══════════════════════════════════════════════
  function setupNetworkMonitoring() {
    if (!Network) return;

    Network.addListener('networkStatusChange', (status) => {
      console.log('[Zyntra] Network:', status.connected ? 'online' : 'offline');
      
      if (!status.connected) {
        showIOSToast({
          title: 'Sem Conexão',
          body: 'Você está offline. Alguns recursos podem estar indisponíveis.',
          icon: 'fa-wifi-slash',
          color: '#FF9500'
        });
        document.body.classList.add('offline-mode');
      } else {
        document.body.classList.remove('offline-mode');
        showIOSToast({
          title: 'Conectado',
          body: 'Conexão restabelecida.',
          icon: 'fa-wifi',
          color: '#34C759'
        });
      }
      
      document.dispatchEvent(new CustomEvent('zyntra:network-change', { detail: status }));
    });
  }

  // ══════════════════════════════════════════════
  // CÂMERA (para scan de documentos, etc)
  // ══════════════════════════════════════════════
  async function takePhoto(options = {}) {
    if (!Camera) throw new Error('Câmera não disponível');
    
    const defaults = {
      quality: 90,
      allowEditing: false,
      resultType: 'base64', // 'uri' | 'base64' | 'dataUrl'
      source: 'CAMERA', // 'CAMERA' | 'PHOTOS' | 'PROMPT'
      width: 1920,
      height: 1080,
      correctOrientation: true,
    };
    
    return await Camera.getPhoto({ ...defaults, ...options });
  }

  // ══════════════════════════════════════════════
  // SHARE NATIVO
  // ══════════════════════════════════════════════
  async function shareNative(options) {
    if (!Share) {
      // Fallback para Web Share API
      if (navigator.share) {
        return navigator.share(options);
      }
      throw new Error('Compartilhamento não disponível');
    }
    return await Share.share(options);
  }

  // ══════════════════════════════════════════════
  // IOS UI COMPONENTS
  // ══════════════════════════════════════════════

  /** Tab Bar nativa iOS */
  function createIOSTabBar() {
    const existing = document.getElementById('ios-tab-bar');
    if (existing) return;

    const tabBar = document.createElement('nav');
    tabBar.id = 'ios-tab-bar';
    tabBar.className = 'tab-bar';
    tabBar.innerHTML = `
      <a href="/" class="tab-item ${isActive('/')}" data-haptic>
        <i class="fas fa-house"></i>
        <span>Início</span>
      </a>
      <a href="/Vendas/" class="tab-item ${isActive('/Vendas')}" data-haptic>
        <i class="fas fa-cart-shopping"></i>
        <span>Vendas</span>
      </a>
      <a href="/Financeiro/" class="tab-item ${isActive('/Financeiro')}" data-haptic>
        <i class="fas fa-wallet"></i>
        <span>Financeiro</span>
      </a>
      <a href="/PCP/" class="tab-item ${isActive('/PCP')}" data-haptic>
        <i class="fas fa-industry"></i>
        <span>PCP</span>
      </a>
      <a href="#more" class="tab-item" data-haptic id="tab-more">
        <i class="fas fa-ellipsis"></i>
        <span>Mais</span>
      </a>
    `;
    document.body.appendChild(tabBar);

    // "Mais" menu
    document.getElementById('tab-more')?.addEventListener('click', (e) => {
      e.preventDefault();
      haptic.impact('Light');
      showMoreMenu();
    });

    // Haptic feedback em todos os tabs
    tabBar.querySelectorAll('[data-haptic]').forEach(el => {
      el.addEventListener('click', () => haptic.selection());
    });
  }

  function isActive(path) {
    const current = window.location.pathname;
    if (path === '/') return current === '/' || current === '/index.html' ? 'active' : '';
    return current.includes(path) ? 'active' : '';
  }

  function showMoreMenu() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999;
      backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
    `;

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div style="padding: 0 16px 16px;">
        <div class="section-header">Módulos</div>
        <div style="background:var(--ios-bg-grouped-secondary); border-radius:12px; overflow:hidden;">
          ${moreMenuItem('Compras', 'fa-truck', '/Compras/')}
          ${moreMenuItem('NFe / Faturamento', 'fa-file-invoice', '/NFe/')}
          ${moreMenuItem('RH', 'fa-users', '/RH/')}
          ${moreMenuItem('Logística', 'fa-route', '/modules/Logistica/')}
          ${moreMenuItem('Chat', 'fa-comments', '/chat/')}
        </div>
        <div class="section-header" style="margin-top:8px;">Sistema</div>
        <div style="background:var(--ios-bg-grouped-secondary); border-radius:12px; overflow:hidden;">
          ${moreMenuItem('Configurações', 'fa-gear', '#settings')}
          ${moreMenuItem('Ajuda', 'fa-circle-question', '/ajuda/')}
          ${moreMenuItem('Sair', 'fa-arrow-right-from-bracket', '#logout', true)}
        </div>
      </div>
    `;
    sheet.style.zIndex = '10000';

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        sheet.remove();
      }
    });

    sheet.querySelectorAll('.more-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        haptic.impact('Light');
        const href = item.dataset.href;
        overlay.remove();
        sheet.remove();
        if (href === '#logout') {
          localStorage.clear();
          window.location.href = '/login.html';
        } else if (href === '#settings') {
          document.dispatchEvent(new CustomEvent('zyntra:open-settings'));
        } else {
          window.location.href = href;
        }
      });
    });

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
  }

  function moreMenuItem(label, icon, href, destructive = false) {
    return `
      <div class="more-menu-item" data-href="${href}" style="
        padding: 12px 16px;
        display: flex; align-items: center; gap: 12px;
        border-bottom: 0.5px solid var(--ios-separator);
        cursor: pointer;
        color: ${destructive ? 'var(--ios-red)' : 'var(--ios-label)'};
        font-size: 17px;
      ">
        <i class="fas ${icon}" style="width:24px; text-align:center; font-size:18px; 
           color: ${destructive ? 'var(--ios-red)' : 'var(--ios-blue)'}"></i>
        <span style="flex:1">${label}</span>
        <i class="fas fa-chevron-right" style="font-size:13px; color:var(--ios-gray);"></i>
      </div>
    `;
  }

  /** Alert nativo estilo iOS */
  function showIOSAlert(title, message, actions = []) {
    if (actions.length === 0) {
      actions = [{ text: 'OK', style: 'bold' }];
    }

    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:9999;
      backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
    `;

    const alert = document.createElement('div');
    alert.className = 'ios-alert';

    alert.innerHTML = `
      <div class="alert-title">${title}</div>
      ${message ? `<div class="alert-message">${message}</div>` : ''}
      <div class="alert-actions">
        ${actions.map(a => `
          <button class="alert-action ${a.style || ''}" 
                  data-action="${a.text}">${a.text}</button>
        `).join('')}
      </div>
    `;

    alert.querySelectorAll('.alert-action').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        haptic.impact('Light');
        backdrop.remove();
        alert.remove();
        if (actions[idx]?.handler) {
          actions[idx].handler();
        }
      });
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(alert);
    haptic.notification('Warning');
  }

  /** Toast/Banner estilo iOS */
  function showIOSToast({ title, body, icon = 'fa-bell', color = '#6366f1', duration = 4000 }) {
    const toast = document.createElement('div');
    toast.className = 'ios-toast';
    toast.innerHTML = `
      <div class="toast-icon" style="background:${color}20; color:${color}">
        <i class="fas ${icon}"></i>
      </div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${body ? `<div class="toast-body">${body}</div>` : ''}
      </div>
    `;
    toast.style.zIndex = '10001';
    document.body.appendChild(toast);

    // Swipe to dismiss
    let startY = 0;
    toast.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    toast.addEventListener('touchmove', (e) => {
      const diff = e.touches[0].clientY - startY;
      if (diff < -20) {
        toast.style.transition = 'transform 0.3s ease';
        toast.style.transform = 'translateY(-120%)';
        setTimeout(() => toast.remove(), 300);
      }
    }, { passive: true });

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        toast.style.transform = 'translateY(-120%)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  // ══════════════════════════════════════════════
  // PULL TO REFRESH
  // ══════════════════════════════════════════════
  function setupPullToRefresh() {
    let startY = 0;
    let pulling = false;
    const threshold = 80;

    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    document.body.appendChild(indicator);

    document.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const diff = e.touches[0].clientY - startY;
      if (diff > 0 && diff < 150) {
        indicator.classList.toggle('visible', diff > 30);
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!pulling) return;
      pulling = false;
      indicator.classList.remove('visible');
      const diff = parseInt(indicator.style.transform?.match(/\d+/)?.[0] || 0);
      if (diff > threshold) {
        haptic.impact('Medium');
        window.location.reload();
      }
    });
  }

  // ══════════════════════════════════════════════
  // BIOMETRIC AUTH
  // ══════════════════════════════════════════════
  async function authenticateWithBiometrics() {
    // Usado no login como alternativa
    if (!isNativeApp) return { verified: false };
    
    try {
      // Tentar Web Authentication API como fallback
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          timeout: 60000,
          rpId: window.location.hostname,
          userVerification: 'required'
        }
      });
      return { verified: !!credential };
    } catch(e) {
      return { verified: false, error: e.message };
    }
  }

  // ══════════════════════════════════════════════
  // ENHANCED SCROLLING
  // ══════════════════════════════════════════════
  function setupEnhancedScrolling() {
    // Rubber-band effect nas listas
    document.querySelectorAll('.scroll-container, .list-container, table').forEach(el => {
      el.style.webkitOverflowScrolling = 'touch';
      el.style.overscrollBehavior = 'contain';
    });

    // Large Title collapse effect
    let lastScroll = 0;
    const header = document.querySelector('.header, #main-header, .top-bar');
    if (header) {
      window.addEventListener('scroll', () => {
        const currentScroll = window.scrollY;
        if (currentScroll > 40) {
          header.classList.add('scrolled');
          header.style.background = 'rgba(15, 23, 42, 0.92)';
        } else {
          header.classList.remove('scrolled');
          header.style.background = 'rgba(15, 23, 42, 0.72)';
        }
        lastScroll = currentScroll;
      }, { passive: true });
    }
  }

  // ══════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════
  async function init() {
    // Adicionar classe iOS ao body
    document.body.classList.add('ios-app');
    if (isIOS) document.body.classList.add('platform-ios');
    if (isAndroid) document.body.classList.add('platform-android');

    // Carregar CSS nativo iOS
    if (!document.querySelector('link[href*="ios-native.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/css/ios-native.css';
      document.head.appendChild(link);
    }

    // Meta viewport otimizado para iOS
    let viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      );
    }

    // Carregar plugins
    await loadPlugins();

    // Setup componentes
    setupStatusBar();
    setupAppLifecycle();
    setupKeyboard();
    setupNetworkMonitoring();
    setupPullToRefresh();
    setupEnhancedScrolling();

    // Push notifications (após login)
    if (token) {
      setupPushNotifications();
    }

    // Tab bar (apenas em páginas logadas, não na tela de login)
    const isLoginPage = window.location.pathname.includes('login');
    if (!isLoginPage && token) {
      createIOSTabBar();
    }

    // Esconder splash screen
    if (SplashScreen) {
      setTimeout(() => {
        SplashScreen.hide({ fadeOutDuration: 500 });
      }, 500);
    }

    console.log('[Zyntra] iOS Bridge inicializado com sucesso');
  }

  // ══════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════
  window.ZyntraApp = {
    isNative: true,
    isIOS,
    isAndroid,
    platform: Capacitor.getPlatform(),

    // Haptics
    haptic,

    // Câmera
    takePhoto,

    // Share
    share: shareNative,

    // Biometria
    authenticateWithBiometrics,

    // UI
    showAlert: showIOSAlert,
    showToast: showIOSToast,

    // Push
    setupPushNotifications,

    // Info
    async getDeviceInfo() {
      if (!Device) return null;
      return await Device.getInfo();
    },

    // Network
    async getNetworkStatus() {
      if (!Network) return { connected: navigator.onLine };
      return await Network.getStatus();
    }
  };

  // Inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
