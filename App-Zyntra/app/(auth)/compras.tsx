import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { comprasApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { Card, SectionLabel, ScreenHeader, StatusPill, IconSearch, BotaoErpWeb } from '@/components/ui';
import type { PedidoCompra, Fornecedor } from '@/types';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleDateString('pt-BR');
}

function statusCompra(status?: string): { label: string; color: string; bg: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'aprovado':  return { label: 'Aprovado',  color: Colors.green,  bg: Colors.greenDim  };
    case 'recebido':  return { label: 'Recebido',  color: Colors.teal,   bg: Colors.tealDim   };
    case 'cancelado': return { label: 'Cancelado', color: Colors.red,    bg: Colors.redDim    };
    case 'parcial':   return { label: 'Parcial',   color: Colors.purple, bg: Colors.purpleDim };
    case 'enviado':   return { label: 'Enviado',   color: Colors.accent, bg: Colors.accentDim };
    default:          return { label: status ?? 'Pendente', color: Colors.yellow, bg: Colors.yellowDim };
  }
}

export default function ComprasScreen() {
  const [busca, setBusca] = useState('');

  const {
    data: dashboardData,
    isLoading: dashLoading,
  } = useQuery({
    queryKey: ['compras', 'dashboard'],
    queryFn: () => comprasApi.getDashboard(),
    retry: 1,
  });

  const {
    data: pedidosRaw,
    isLoading: pedidosLoading,
    refetch: refetchPedidos,
    isRefetching,
  } = useQuery<PedidoCompra[]>({
    queryKey: ['compras', 'pedidos'],
    queryFn: async () => {
      const res = await comprasApi.getPedidos({ limit: 30 } as any);
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
    retry: 1,
  });

  const {
    data: fornecedoresRaw,
    isLoading: fornLoading,
    refetch: refetchForn,
  } = useQuery<Fornecedor[]>({
    queryKey: ['compras', 'fornecedores'],
    queryFn: async () => {
      const res = await comprasApi.getFornecedores();
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
    retry: 1,
  });

  const dash = (dashboardData as any) ?? {};
  const pedidos = (pedidosRaw ?? []).filter(
    (p) =>
      !busca ||
      (p.fornecedor_nome ?? (p as any).fornecedor)?.toLowerCase().includes(busca.toLowerCase()) ||
      String(p.numero ?? p.id).includes(busca)
  );
  const fornecedores = (fornecedoresRaw ?? []).slice(0, 5);

  const handleRefresh = () => { refetchPedidos(); refetchForn(); };

  const kpis = [
    { label: 'PC Abertos',  value: String(dash.pedidos_abertos   ?? dash.abertos   ?? '--'), color: Colors.orange },
    { label: 'Aprovados',   value: String(dash.pedidos_aprovados  ?? dash.aprovados  ?? '--'), color: Colors.green  },
    { label: 'Aguardando',  value: String(dash.pedidos_pendentes  ?? dash.pendentes  ?? '--'), color: Colors.yellow },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Compras"
        onBack={() => router.back()}
        right={<BotaoErpWeb modulo="compras" />}
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
        {/* KPIs */}
        {dashLoading ? (
          <View style={{ height: 72, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {kpis.map((k, i) => (
              <Card key={i} style={{ flex: 1, padding: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 9, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  {k.label}
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: k.color }}>{k.value}</Text>
              </Card>
            ))}
          </View>
        )}

        {/* Pedidos de Compra */}
        <View>
          <SectionLabel text="Pedidos de Compra" />
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
              placeholder="Buscar pedido ou fornecedor..."
              placeholderTextColor={Colors.muted}
              style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
            />
          </View>

          {pedidosLoading ? (
            <View style={{ height: 100, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : pedidos.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>
                {busca ? 'Nenhum pedido encontrado' : 'Nenhum pedido de compra'}
              </Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {pedidos.slice(0, 20).map((p, i) => {
                const st = statusCompra(p.status);
                const forn = (p as any).fornecedor_nome ?? (p as any).fornecedor ?? `Fornecedor #${(p as any).fornecedor_id ?? ''}`;
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
                        {p.numero ? `PC-${p.numero}` : `PC #${p.id}`}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }}>{forn}</Text>
                      <Text style={{ fontSize: 10, color: Colors.muted }}>{fmtDate((p as any).data_criacao ?? (p as any).created_at)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>
                        {fmtCurrency((p as any).valor_total ?? (p as any).valor)}
                      </Text>
                      <StatusPill label={st.label} color={st.color} bg={st.bg} />
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        {/* Principais Fornecedores */}
        <View>
          <SectionLabel text="Principais Fornecedores" />
          {fornLoading ? (
            <View style={{ height: 80, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} size="small" />
            </View>
          ) : fornecedores.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhum fornecedor cadastrado</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {fornecedores.map((f, i) => (
                <View
                  key={f.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 12,
                    paddingHorizontal: 14,
                    borderBottomWidth: i < fornecedores.length - 1 ? 1 : 0,
                    borderBottomColor: Colors.border,
                  }}
                >
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                      {(f as any).nome_fantasia ?? (f as any).razao_social ?? `Fornecedor #${f.id}`}
                    </Text>
                    <Text style={{ fontSize: 11, color: Colors.muted }}>
                      {(f as any).categoria ?? (f as any).segmento ?? (f as any).cidade ?? ''}
                    </Text>
                  </View>
                  {(f as any).cnpj ? (
                    <Text style={{ fontSize: 11, color: Colors.muted }}>{(f as any).cnpj}</Text>
                  ) : null}
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
