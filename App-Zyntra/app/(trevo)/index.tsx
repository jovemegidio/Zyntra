import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { trevoApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { Card, KPICard, SectionLabel, IconLogout } from '@/components/ui';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

interface TrevoDashboard {
  vendas_hoje: number;
  faturamento_hoje: number;
  vendas_mes: number;
  faturamento_mes: number;
  faturamento_mes_anterior: number;
  total_produtos: number;
  total_clientes: number;
  valor_estoque: number;
  abaixo_minimo: Array<{ id: number; sku?: string; descricao: string; estoque: number; estoque_minimo: number }>;
  abaixo_minimo_total: number;
  ultimas_vendas: Array<{ id: number; cliente_nome?: string; total: number; status: string; data: string }>;
}

function statusVenda(status?: string): { label: string; color: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'cancelada': return { label: 'Cancelada', color: Colors.red };
    case 'finalizada':
    case 'concluida':  return { label: 'Concluída', color: Colors.green };
    default:           return { label: status || 'Em aberto', color: Colors.yellow };
  }
}

export default function TrevoPainelScreen() {
  const { user, logout } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useQuery<TrevoDashboard>({
    queryKey: ['trevo', 'dashboard'],
    queryFn: () => trevoApi.getDashboard(),
    retry: 1,
  });

  const handleLogout = () => {
    Alert.alert('Sair da conta', 'Tem certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(public)/login');
        },
      },
    ]);
  };

  const variacaoMes =
    data && data.faturamento_mes_anterior > 0
      ? ((data.faturamento_mes - data.faturamento_mes_anterior) / data.faturamento_mes_anterior) * 100
      : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ fontSize: 12, color: Colors.muted, marginBottom: 2 }}>Trevo Autopeças</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>
            {user?.nome?.split(' ')[0] ?? 'Painel'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            width: 38, height: 38, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
            borderRadius: 11, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconLogout size={18} color={Colors.mutedLight} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.accent} colors={[Colors.accent]} />}
      >
        {isLoading ? (
          <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <>
            <View>
              <SectionLabel text="Visão Geral" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <KPICard title="Faturamento hoje" value={fmtCurrency(data?.faturamento_hoje)} color={Colors.accent} style={{ width: '48.5%' }} />
                <KPICard title="Vendas hoje" value={String(data?.vendas_hoje ?? 0)} color={Colors.green} style={{ width: '48.5%' }} />
                <KPICard
                  title="Faturamento do mês"
                  value={fmtCurrency(data?.faturamento_mes)}
                  change={variacaoMes != null ? `${variacaoMes >= 0 ? '+' : ''}${variacaoMes.toFixed(1)}%` : undefined}
                  up={variacaoMes != null ? variacaoMes >= 0 : undefined}
                  color={Colors.orange}
                  style={{ width: '48.5%' }}
                />
                <KPICard title="Vendas no mês" value={String(data?.vendas_mes ?? 0)} color={Colors.yellow} style={{ width: '48.5%' }} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { label: 'Produtos', value: String(data?.total_produtos ?? 0) },
                { label: 'Clientes', value: String(data?.total_clientes ?? 0) },
                { label: 'Estoque', value: fmtCurrency(data?.valor_estoque) },
              ].map((k, i) => (
                <Card key={i} style={{ flex: 1, padding: 12, alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    {k.label}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>{k.value}</Text>
                </Card>
              ))}
            </View>

            {(data?.abaixo_minimo?.length ?? 0) > 0 && (
              <View>
                <SectionLabel text="Estoque abaixo do mínimo" />
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {data!.abaixo_minimo.map((p, i) => (
                    <View
                      key={p.id}
                      style={{
                        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                        padding: 11, paddingHorizontal: 14,
                        borderBottomWidth: i < data!.abaixo_minimo.length - 1 ? 1 : 0, borderBottomColor: Colors.border,
                      }}
                    >
                      <Text style={{ flex: 1, fontSize: 13, color: Colors.text }} numberOfLines={1}>{p.descricao}</Text>
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: Colors.red }}>
                        {p.estoque} / {p.estoque_minimo}
                      </Text>
                    </View>
                  ))}
                </Card>
              </View>
            )}

            <View>
              <SectionLabel text="Últimas Vendas" />
              {(data?.ultimas_vendas?.length ?? 0) === 0 ? (
                <Card style={{ padding: 16, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma venda registrada</Text>
                </Card>
              ) : (
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {data!.ultimas_vendas.map((v, i) => {
                    const st = statusVenda(v.status);
                    return (
                      <View
                        key={v.id}
                        style={{
                          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                          padding: 11, paddingHorizontal: 14,
                          borderBottomWidth: i < data!.ultimas_vendas.length - 1 ? 1 : 0, borderBottomColor: Colors.border,
                        }}
                      >
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }} numberOfLines={1}>
                            {v.cliente_nome ?? `Venda #${v.id}`}
                          </Text>
                          <Text style={{ fontSize: 11, color: st.color }}>{st.label}</Text>
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>{fmtCurrency(v.total)}</Text>
                      </View>
                    );
                  })}
                </Card>
              )}
            </View>
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
