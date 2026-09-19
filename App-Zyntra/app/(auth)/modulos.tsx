import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import {
  Colors, MODULES, canAccessModule,
  MODULOS_WEB, podeAcessarModuloWeb, sessaoRestritaAoRh, type ModuloWeb,
} from '@/lib/constants';
import { ModuleIcon } from '@/components/ui';

const GRUPOS: ModuloWeb['grupo'][] = ['Operação', 'Comercial', 'Fiscal', 'Gestão'];

export default function ModulosScreen() {
  const { user } = useAuth();
  const modulos = MODULES.filter((m) => canAccessModule(m, user));
  const web = MODULOS_WEB.filter((m) => podeAcessarModuloWeb(m, user));
  // Sessao por CPF nao pode chegar ao painel inteiro pelo WebView.
  const restrita = sessaoRestritaAoRh(user);

  const abrirWeb = (path: string) =>
    router.push({ pathname: '/(auth)/sistema', params: { path } } as any);

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
        {!restrita && (
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
        )}
        {/* Portal do colaborador — autoatendimento, aberto a TODO usuário: as
            rotas por trás são self-service no backend e não exigem a área `rh`.
            É também a única coisa que uma sessão por CPF alcança. */}
        <TouchableOpacity
          onPress={() => router.push('/(auth)/meu-rh' as any)}
          activeOpacity={0.8}
          style={{
            backgroundColor: Colors.card,
            borderWidth: 1,
            borderColor: Colors.border,
            borderRadius: 18,
            padding: 16,
            marginBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              backgroundColor: Colors.purpleDim,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ModuleIcon id="rh" size={22} color={Colors.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>
              Meu RH
            </Text>
            <Text style={{ fontSize: 11.5, color: Colors.muted, marginTop: 2, lineHeight: 16 }}>
              Holerites, espelho de ponto, beneficios e meus dados
            </Text>
          </View>
          <Text style={{ fontSize: 18, color: Colors.muted }}>›</Text>
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

        {/* Sistema completo: cada módulo do ERP web, aberto direto no caminho certo.
            As telas nativas acima cobrem 7 módulos; o ERP tem ~360 telas em 15. */}
        <View style={{ marginTop: 24, marginBottom: 4 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.text }}>
            Sistema completo
          </Text>
          <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 2, lineHeight: 17 }}>
            Todas as telas do ERP web, abertas dentro do aplicativo com a sua sessão.
          </Text>
        </View>

        {GRUPOS.map((grupo) => {
          const doGrupo = web.filter((m) => m.grupo === grupo);
          if (!doGrupo.length) return null;
          return (
            <View key={grupo} style={{ marginTop: 16 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: Colors.muted,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {grupo}
              </Text>
              <View
                style={{
                  backgroundColor: Colors.card,
                  borderWidth: 1,
                  borderColor: Colors.border,
                  borderRadius: 14,
                  overflow: 'hidden',
                }}
              >
                {doGrupo.map((m, i) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => abrirWeb(m.path)}
                    activeOpacity={0.6}
                    style={{
                      paddingVertical: 13,
                      paddingHorizontal: 15,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: Colors.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14.5, fontWeight: '700', color: Colors.text }}>
                        {m.label}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: Colors.muted, marginTop: 1 }}>
                        {m.descricao}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 18, color: Colors.muted }}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}

        {/* Bottom spacing */}
        <View style={{ height: 28 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
