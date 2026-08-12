import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { dashboardApi } from '@/lib/api';
import { Colors, MODULES, getAvatarUrl, canAccessModule } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { Card, KPICard, SectionLabel, IconBell, IconSettings, ModuleIcon } from '@/components/ui';
import type { DashboardKPIs, Atividade } from '@/types';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function getUserInitials(nome?: string | null) {
  if (!nome) return 'AD';
  return nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function safeTime(value?: string | null) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function UserAvatar({ avatar, foto, nome, size = 38 }: { avatar?: string; foto?: string; nome?: string; size?: number }) {
  const url = getAvatarUrl(avatar || foto);
  const initials = getUserInitials(nome);
  const radius = size * 0.28;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: Colors.surface }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: '#fff' }}>{initials}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  useTheme();

  const {
    data: kpisData,
    isLoading: kpisLoading,
    refetch: refetchKPIs,
    isRefetching: kpisRefetching,
  } = useQuery<DashboardKPIs>({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => dashboardApi.getKPIs(),
    retry: 1,
  });

  const {
    data: alertasData,
    isLoading: alertasLoading,
    refetch: refetchAlertas,
  } = useQuery({
    queryKey: ['dashboard', 'alertas'],
    queryFn: () => dashboardApi.getAlertas(),
    retry: 1,
  });

  const {
    data: atividadesData,
    isLoading: atividadesLoading,
    refetch: refetchAtividades,
  } = useQuery<Atividade[]>({
    queryKey: ['dashboard', 'atividades'],
    queryFn: () => dashboardApi.getAtividades(8),
    retry: 1,
  });

  const isRefreshing = kpisRefetching;

  const handleRefresh = () => {
    refetchKPIs();
    refetchAlertas();
    refetchAtividades();
  };

  const kpis = kpisData
    ? [
        {
          title: 'Faturamento',
          value: kpisData.vendas?.valor ?? 'R$ --',
          change: kpisData.vendas?.trend,
          up: kpisData.vendas?.trendUp ?? true,
          color: Colors.accent,
          spark: kpisData.vendas?.chart,
        },
        {
          title: 'Pedidos Abertos',
          value: String(kpisData.pedidosAbertos ?? '--'),
          color: Colors.green,
          spark: undefined,
        },
        {
          title: 'A Receber Hoje',
          value: kpisData.aReceber ?? 'R$ --',
          color: Colors.yellow,
          spark: undefined,
        },
        {
          title: 'Ordens Ativas',
          value: String((kpisData as any).ordensAtivas ?? kpisData.ordensProducao ?? '--'),
          color: Colors.orange,
          spark: undefined,
        },
      ]
    : [];

  const atividades: Atividade[] = atividadesData ?? [];

  const alertas = (alertasData as any[]) ?? [];

  // Módulos visíveis conforme áreas permitidas do usuário (espelha o menu web)
  const modulos = MODULES.filter((m) => canAccessModule(m, user));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 12, color: Colors.muted, marginBottom: 2 }}>{getGreeting()},</Text>
            <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>
              {user?.apelido ?? user?.nome?.split(' ')[0] ?? 'Bem-vindo'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.push('/configuracoes')}
              style={{
                width: 38,
                height: 38,
                backgroundColor: Colors.card,
                borderWidth: 1,
                borderColor: Colors.border,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconSettings size={18} color={Colors.mutedLight} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(auth)/notificacoes')}
              style={{
                width: 38,
                height: 38,
                backgroundColor: Colors.card,
                borderWidth: 1,
                borderColor: Colors.border,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconBell size={18} color={Colors.mutedLight} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(auth)/perfil')}>
              <UserAvatar avatar={user?.avatar} foto={user?.foto} nome={user?.nome} size={38} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      >
        {/* KPIs */}
        <View>
          <SectionLabel text="Visao Geral" />
          {kpisLoading ? (
            <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {kpis.map((k, i) => (
                <KPICard key={i} {...k} style={{ width: '48.5%' }} />
              ))}
            </View>
          )}
        </View>

        {/* Alertas */}
        {alertas.length > 0 && (
          <View>
            <SectionLabel text="Alertas" />
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {alertas.slice(0, 4).map((a: any, i: number) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: 12,
                    paddingHorizontal: 14,
                    borderBottomWidth: i < Math.min(alertas.length, 4) - 1 ? 1 : 0,
                    borderBottomColor: Colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      marginTop: 5,
                      backgroundColor:
                        a.tipo === 'danger'
                          ? Colors.red
                          : a.tipo === 'warning'
                          ? Colors.yellow
                          : Colors.accent,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>{a.titulo}</Text>
                    {a.mensagem ? (
                      <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 2 }}>{a.mensagem}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Modulos rapidos */}
        <View>
          <SectionLabel text="Modulos" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {modulos.map((m) => (
              <TouchableOpacity
                key={m.id}
                onPress={() => router.push(`/(auth)/${m.id}` as any)}
                style={{
                  width: '23%',
                  backgroundColor: Colors.card,
                  borderWidth: 1,
                  borderColor: Colors.border,
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 4,
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    backgroundColor: m.dim,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ModuleIcon id={m.id} size={18} color={m.color} />
                </View>
                <Text
                  style={{
                    fontSize: 9.5,
                    fontWeight: '600',
                    color: Colors.mutedLight,
                    textAlign: 'center',
                    lineHeight: 12,
                  }}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Atividade recente */}
        <View>
          <SectionLabel text="Atividade Recente" />
          {atividadesLoading ? (
            <View style={{ height: 80, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} size="small" />
            </View>
          ) : atividades.length === 0 ? (
            <Card style={{ padding: 18, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma atividade recente</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {atividades.map((a, i) => (
                <View
                  key={a.id ?? i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 11,
                    paddingHorizontal: 14,
                    borderBottomWidth: i < atividades.length - 1 ? 1 : 0,
                    borderBottomColor: Colors.border,
                  }}
                >
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.accent }} />
                  <Text style={{ flex: 1, fontSize: 12.5, color: Colors.textSoft, lineHeight: 18 }}>
                    {a.descricao ?? (a as any).titulo ?? 'Atividade registrada'}
                  </Text>
                  <Text style={{ fontSize: 11, color: Colors.muted }}>
                    {safeTime(a.data)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
