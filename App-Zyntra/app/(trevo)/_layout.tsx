import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Colors } from '@/lib/constants';
import { IconHome, ModuleIcon } from '@/components/ui';

/**
 * Grupo de rotas da Trevo Autopeças — sistema separado do restante do grupo
 * (Aluforce/Energy/Eletric/Cobal), sem RH/PCP. Deliberadamente à parte de
 * `(auth)/_layout.tsx`: não chama `useNotifications()` porque o backend da
 * Trevo não tem endpoint de push (`/push/register`).
 */
const ALTURA_TABBAR = 70;

function Indicador({ focused }: { focused: boolean }) {
  if (!focused) return null;
  return (
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
  );
}

export default function TrevoLayout() {
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
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2, marginTop: 3 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Painel',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <IconHome size={22} color={focused ? Colors.accent : Colors.muted} />
              <Indicador focused={focused} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="vendas"
        options={{
          title: 'Vendas',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <ModuleIcon id="vendas" size={22} color={focused ? Colors.accent : Colors.muted} />
              <Indicador focused={focused} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="produtos"
        options={{
          title: 'Produtos',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <ModuleIcon id="compras" size={22} color={focused ? Colors.accent : Colors.muted} />
              <Indicador focused={focused} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="financeiro"
        options={{
          title: 'Financeiro',
          tabBarIcon: ({ focused }) => (
            <View style={{ alignItems: 'center' }}>
              <ModuleIcon id="financeiro" size={22} color={focused ? Colors.accent : Colors.muted} />
              <Indicador focused={focused} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
