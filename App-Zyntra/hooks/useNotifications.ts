import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { loadSettings } from '../lib/settings';
import { pushApi, tokenStorage } from '../lib/api';

// Apresentação das notificações respeita as preferências do usuário
// definidas em Configurações (chave-mestra + som).
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const settings = await loadSettings();
    return {
      shouldShowBanner: settings.notifPush,
      shouldShowList: settings.notifPush,
      shouldPlaySound: settings.notifPush && settings.notifSom,
      shouldSetBadge: settings.notifPush,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    };
  },
});

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export function useNotifications() {
  const router = useRouter();
  const [expoPushToken, setExpoPushToken] = useState<string | undefined>();
  const [notification, setNotification] = useState<Notifications.Notification | undefined>();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    registerForPushNotificationsAsync().then(async (token) => {
      setExpoPushToken(token);
      if (token) {
        try {
          await pushApi.register(token, Platform.OS as 'ios' | 'android' | 'web');
          await tokenStorage.setPushToken(token);
        } catch (error) {
          console.warn('[Push] Não foi possível registrar este dispositivo:', error);
        }
      }
    });

    // Listen for incoming notifications
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      setNotification(notification);
    });

    // Listen for user tapping on notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      // Handle navigation based on notification data
      handleNotificationResponse(data || {});
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response.notification.request.content.data || {});
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [router]);

  const handleNotificationResponse = (data: Record<string, unknown>) => {
    // Handle navigation based on notification type
    const { moduleId } = data as { type?: string; moduleId?: string; itemId?: string };
    const modules = new Set(['financeiro', 'vendas', 'rh', 'pcp', 'logistica', 'faturamento', 'compras']);
    if (moduleId && modules.has(moduleId)) {
      router.push(`/(auth)/${moduleId}` as never);
      return;
    }
    router.push('/(auth)/notificacoes' as never);
  };

  const scheduleLocalNotification = async (notification: PushNotification, trigger?: Notifications.NotificationTriggerInput) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sound: true,
      },
      trigger: trigger || null, // null = immediate
    });
  };

  const cancelAllNotifications = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
  };

  const getBadgeCount = async () => {
    return await Notifications.getBadgeCountAsync();
  };

  const setBadgeCount = async (count: number) => {
    await Notifications.setBadgeCountAsync(count);
  };

  return {
    expoPushToken,
    notification,
    scheduleLocalNotification,
    cancelAllNotifications,
    getBadgeCount,
    setBadgeCount,
  };
}

/**
 * Garante a permissão de notificações. Deve ser chamada quando o usuário
 * ativa "Notificações push" em Configurações — momento ideal para solicitar
 * (em vez de pedir no primeiro launch). Retorna `true` se concedida.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

async function registerForPushNotificationsAsync(): Promise<string | undefined> {
  let token: string | undefined;

  const settings = await loadSettings();
  if (!settings.notifPush) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: settings.notifVibracao ? [0, 250, 250, 250] : [0],
      lightColor: '#3B82F6',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }

    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (projectId) {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      }
    } catch (e) {
      console.log('Error getting push token:', e);
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}
