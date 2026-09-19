import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Colors } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { IconHome, IconGrid, IconBell, IconUser } from '@/components/ui';
import { useNotifications } from '@/hooks/useNotifications';
import { OfflineBanner } from '@/components/offline-banner';

/** Altura da tab bar — o banner offline flutua logo acima dela. */
const ALTURA_TABBAR = 70;

export default function AuthLayout() {
  useTheme();
  useNotifications();

  return (
    <View style={{ flex: 1 }}>
      <TabsAutenticadas />
      {/* Fora do <Tabs> e posicionado por cima: dentro dele o banner iria parar
          abaixo da tab bar, no rodapé, onde ninguém olha. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: ALTURA_TABBAR }}>
        <OfflineBanner />
      </View>
    </View>
  );
}

function TabsAutenticadas() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: 10,
          paddingTop: 10,
          height: ALTURA_TABBAR,
          shadowColor: '#1e2a42',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.muted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginTop: 3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <IconHome size={22} color={focused ? Colors.accent : Colors.muted} />
              {focused && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: -12,
                    width: 20,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: Colors.accent,
                  }}
                />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="modulos"
        options={{
          title: 'Modulos',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <IconGrid size={22} color={focused ? Colors.accent : Colors.muted} />
              {focused && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: -12,
                    width: 20,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: Colors.accent,
                  }}
                />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="notificacoes"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <IconBell size={22} color={focused ? Colors.accent : Colors.muted} />
              {focused && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: -12,
                    width: 20,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: Colors.accent,
                  }}
                />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <IconUser size={22} color={focused ? Colors.accent : Colors.muted} />
              {focused && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: -12,
                    width: 20,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: Colors.accent,
                  }}
                />
              )}
            </View>
          ),
        }}
      />
      {/* Telas de módulo — ocultas na tab bar */}
      <Tabs.Screen name="financeiro"  options={{ href: null }} />
      <Tabs.Screen name="vendas"      options={{ href: null }} />
      <Tabs.Screen name="crm"         options={{ href: null }} />
      <Tabs.Screen name="rh"          options={{ href: null }} />
      <Tabs.Screen name="meu-rh"      options={{ href: null }} />
      <Tabs.Screen name="pcp"         options={{ href: null }} />
      <Tabs.Screen name="logistica"   options={{ href: null }} />
      <Tabs.Screen name="faturamento" options={{ href: null }} />
      <Tabs.Screen name="compras"     options={{ href: null }} />
      <Tabs.Screen name="tarefas"     options={{ href: null }} />
      <Tabs.Screen name="sistema"     options={{ href: null }} />
    </Tabs>
  );
}
