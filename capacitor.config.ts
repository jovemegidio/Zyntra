import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.zyntra.erp',
  appName: 'Zyntra',
  webDir: 'public',
  
  server: {
    // App de producao: abre a mesma versao web completa do Zyntra.
    // Para desenvolvimento local, troque temporariamente para seu IP.
    url: 'https://aluforce.api.br',
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'aluforce.api.br',
      '*.aluforce.api.br',
      'zyntra.com.br',
      '*.zyntra.com.br',
      'aluforce.com.br',
      '*.aluforce.com.br'
    ]
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      launchFadeOutDuration: 500,
      backgroundColor: '#0f172a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
      overlaysWebView: false
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#6366f1'
    },
    Camera: {
      presentationStyle: 'fullscreen'
    },
    Haptics: {
      selectionStartDuration: 10,
      notificationSuccessDuration: 30,
      notificationWarningDuration: 30,
      notificationErrorDuration: 40,
      impactLightDuration: 10,
      impactMediumDuration: 20,
      impactHeavyDuration: 30,
    }
  },

  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: true,
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
    preferredContentMode: 'mobile',
    backgroundColor: '#0f172a',
    scheme: 'zyntra'
  },

  android: {
    backgroundColor: '#0f172a',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
