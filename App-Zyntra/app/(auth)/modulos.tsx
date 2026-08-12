import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { Colors, MODULES, canAccessModule } from '@/lib/constants';
import { ModuleIcon } from '@/components/ui';

export default function ModulosScreen() {
  const { user } = useAuth();
  const modulos = MODULES.filter((m) => canAccessModule(m, user));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>
          Modulos
        </Text>
        <Text style={{ fontSize: 13, color: Colors.muted, marginTop: 2 }}>
          Plataforma ERP Zyntra
        </Text>
      </View>

      {/* Modules Grid */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingTop: 8 }}>
        <TouchableOpacity
          onPress={() => router.push('/(auth)/sistema' as any)}
          activeOpacity={0.8}
          style={{ backgroundColor: Colors.accent, borderRadius: 18, padding: 18, marginBottom: 12 }}
        >
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>ERP completo</Text>
          <Text style={{ color: '#EAF2FF', marginTop: 4, lineHeight: 19 }}>
            Todos os módulos, configurações e recursos administrativos conforme suas permissões.
          </Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {modulos.map((m) => (
            <TouchableOpacity
              key={m.id}
              onPress={() => router.push(`/(auth)/${m.id}` as any)}
              activeOpacity={0.7}
              style={{
                width: '48%',
                backgroundColor: Colors.card,
                borderWidth: 1,
                borderColor: Colors.border,
                borderRadius: 18,
                padding: 20,
                paddingHorizontal: 16,
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 13,
                  backgroundColor: m.dim,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ModuleIcon id={m.id} size={22} color={m.color} />
              </View>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>{m.label}</Text>
                <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 2 }}>{m.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bottom spacing */}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
