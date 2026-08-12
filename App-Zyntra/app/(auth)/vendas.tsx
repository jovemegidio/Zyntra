import { useState } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { vendasApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { Card, SectionLabel, ScreenHeader, KPICard, StatusPill, IconSearch, BotaoErpWeb } from '@/components/ui';
import type { Pedido } from '@/types';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString('pt-BR');
}

function statusPedido(status?: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'aprovado':
      return { label: 'Aprovado', color: Colors.green, bg: Colors.greenDim };
    case 'faturado':
      return { label: 'Faturado', color: Colors.accent, bg: Colors.accentDim };
    case 'entregue':
      return { label: 'Entregue', color: Colors.teal, bg: Colors.tealDim };
    case 'cancelado':
      return { label: 'Cancelado', color: Colors.red, bg: Colors.redDim };
    case 'orcamento':
    default:
      return { label: 'Em analise', color: Colors.yellow, bg: Colors.yellowDim };
  }
}

export default function VendasScreen() {
  useTheme();
  const [busca, setBusca] = useState('');

  const {
    data: pedidosRaw,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Pedido[]>({
    queryKey: ['vendas', 'pedidos'],
    queryFn: async () => {
      const res = await vendasApi.getPedidos({ limit: 30 });
      return Array.isArray(res) ? res : [];
    },
    retry: 1,
  });

  const {
    data: metasData,
    isLoading: metasLoading,
    refetch: refetchMetas,
  } = useQuery({
    queryKey: ['vendas', 'metas'],
    queryFn: () => vendasApi.getMetas(),
    retry: 1,
  });

  const {
    data: funilData,
    isLoading: funilLoading,
    refetch: refetchFunil,
  } = useQuery({
    queryKey: ['vendas', 'funil'],
    queryFn: () => vendasApi.getFunil(),
    retry: 1,
  });

  const pedidos = (pedidosRaw ?? []).filter(
    (p) =>
      !busca ||
      p.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) ||
      String(p.numero ?? p.id).includes(busca)
  );

  const funil = Array.isArray(funilData) ? funilData : (funilData as any)?.data ?? [];
  const metas = Array.isArray(metasData) ? metasData : (metasData as any)?.data ?? [];

  const handleRefresh = () => {
    refetch();
    refetchMetas();
    refetchFunil();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Vendas"
        onBack={() => router.back()}
        right={<BotaoErpWeb modulo="vendas" />}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      >
        {/* Metas */}
        {!metasLoading && metas.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {metas.slice(0, 2).map((m: any, i: number) => (
              <KPICard
                key={i}
                title={m.vendedor_nome ?? `Meta ${i + 1}`}
                value={`${Math.round(m.percentual ?? 0)}%`}
                sub={`${fmtCurrency(m.realizado)} / ${fmtCurrency(m.meta_valor)}`}
                color={Colors.green}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        )}

        {/* Funil de Vendas */}
        {!funilLoading && funil.length > 0 && (
          <View>
            <SectionLabel text="Funil de Vendas" />
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {funil.map((f: any, i: number) => {
                const maxVal = funil[0]?.quantidade ?? 1;
                return (
                  <View
                    key={i}
                    style={{
                      padding: 10,
                      paddingHorizontal: 14,
                      borderBottomWidth: i < funil.length - 1 ? 1 : 0,
                      borderBottomColor: Colors.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                      <Text style={{ fontSize: 12, color: Colors.textSoft }}>{f.etapa ?? f.label}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.accent }}>
                        {f.quantidade ?? 0}
                      </Text>
                    </View>
                    <View style={{ height: 5, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                      <View
                        style={{
                          width: `${((f.quantidade ?? 0) / maxVal) * 100}%`,
                          height: '100%',
                          backgroundColor: Colors.accent,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* Pedidos */}
        <View>
          <SectionLabel text="Pedidos Recentes" />
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: Colors.surface,
              borderRadius: 11,
              padding: 10,
              paddingHorizontal: 12,
              gap: 8,
              marginBottom: 10,
              borderWidth: 1,
              borderColor: Colors.border,
              alignItems: 'center',
            }}
          >
            <IconSearch size={16} color={Colors.muted} />
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar pedido ou cliente..."
              placeholderTextColor={Colors.muted}
              style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
            />
          </View>

          {isLoading ? (
            <View style={{ height: 100, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : pedidos.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>
                {busca ? 'Nenhum pedido encontrado' : 'Nenhum pedido cadastrado'}
              </Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {pedidos.slice(0, 20).map((p, i) => {
                const st = statusPedido(p.status);
                return (
                  <View
                    key={p.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 12,
                      paddingHorizontal: 14,
                      borderBottomWidth: i < Math.min(pedidos.length, 20) - 1 ? 1 : 0,
                      borderBottomColor: Colors.border,
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                        #{p.numero ?? p.id} — {p.cliente_nome ?? 'Cliente'}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 2 }}>
                        {fmtDate(p.data_criacao)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>
                        {fmtCurrency(p.valor_total)}
                      </Text>
                      <StatusPill label={st.label} color={st.color} bg={st.bg} />
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
