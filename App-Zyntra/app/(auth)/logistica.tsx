import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { logisticaApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { Card, SectionLabel, ScreenHeader, StatusPill, IconFilter } from '@/components/ui';
import type { Entrega } from '@/types';

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleDateString('pt-BR');
}

function statusEntrega(status?: string): { label: string; color: string; bg: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'entregue':   return { label: 'Concluída',  color: Colors.green,  bg: Colors.greenDim  };
    case 'em_rota':
    case 'em_transporte': return { label: 'Em rota', color: Colors.yellow, bg: Colors.yellowDim };
    case 'em_expedicao': return { label: 'Em expedição', color: Colors.accent, bg: Colors.accentDim };
    case 'em_separacao': return { label: 'Em separação', color: Colors.orange, bg: Colors.orangeDim };
    case 'aguardando_separacao': return { label: 'Aguardando separação', color: Colors.muted, bg: Colors.surface };
    case 'cancelada':  return { label: 'Cancelada',  color: Colors.red,    bg: Colors.redDim    };
    default:           return { label: 'Aguardando', color: Colors.muted,  bg: Colors.surface   };
  }
}

export default function LogisticaScreen() {
  const [statusFilter, setStatusFilter] = useState<'todos' | 'em_transporte' | 'entregue'>('todos');
  const {
    data: dashboardData,
    isLoading: dashLoading,
  } = useQuery({
    queryKey: ['logistica', 'dashboard'],
    queryFn: () => logisticaApi.getDashboard(),
    retry: 1,
  });

  const {
    data: entregasRaw,
    isLoading: entregasLoading,
    refetch,
    isRefetching,
  } = useQuery<Entrega[]>({
    queryKey: ['logistica', 'entregas'],
    queryFn: async () => {
      const res = await logisticaApi.getEntregas();
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
    retry: 1,
  });

  const dash = (dashboardData as any) ?? {};
  const entregas = entregasRaw ?? [];

  const entregues  = entregas.filter((e) => e.status === 'entregue').length;
  const emRota     = entregas.filter((e) => ['em_rota', 'em_transporte'].includes(e.status)).length;
  const total      = entregas.length;
  const entregasFiltradas = statusFilter === 'todos'
    ? entregas
    : entregas.filter((entrega) => entrega.status === statusFilter);

  const kpis = [
    { label: 'Entregas',   value: String(dash.total_entregas ?? total), color: Colors.teal },
    { label: 'Em rota',    value: String(dash.em_rota ?? dash.em_transporte ?? emRota), color: Colors.yellow },
    { label: 'Concluídas', value: String(dash.entregues       ?? entregues ?? '--'), color: Colors.green  },
  ];

  const handleRefresh = () => { refetch(); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Logística"
        onBack={() => router.back()}
        right={
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Filtrar entregas por status"
            onPress={() => setStatusFilter((current) => current === 'todos' ? 'em_transporte' : current === 'em_transporte' ? 'entregue' : 'todos')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
            <IconFilter size={18} color={Colors.accent} />
            <Text style={{ fontSize: 11, color: Colors.accent, fontWeight: '600' }}>
              {statusFilter === 'todos' ? 'Todos' : statusFilter === 'em_transporte' ? 'Em rota' : 'Concluídas'}
            </Text>
          </TouchableOpacity>
        }
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
                <Text style={{ fontSize: 22, fontWeight: '700', color: k.color }}>{k.value}</Text>
              </Card>
            ))}
          </View>
        )}

        {/* Entregas do Dia */}
        <View>
          <SectionLabel text="Entregas do Dia" />
          {entregasLoading ? (
            <View style={{ height: 100, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : entregasFiltradas.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma entrega para este filtro</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {entregasFiltradas.slice(0, 15).map((e, i) => {
                const st = statusEntrega(e.status);
                const destino = e.cidade_uf || e.endereco_entrega || e.cliente || e.destinatario;
                return (
                  <View
                    key={e.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 12,
                      paddingHorizontal: 14,
                      borderBottomWidth: i < Math.min(entregasFiltradas.length, 15) - 1 ? 1 : 0,
                      borderBottomColor: Colors.border,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                        {e.nfe_numero && e.nfe_numero !== '-' ? `NF-e ${e.nfe_numero}` : `Pedido ${e.pedido_id ?? e.id}`}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }} numberOfLines={1}>
                        {destino}{e.transportadora ? ` · ${e.transportadora}` : ''}
                      </Text>
                      {e.previsao ? (
                        <Text style={{ fontSize: 10, color: Colors.muted }}>Previsão: {fmtDate(e.previsao)}</Text>
                      ) : null}
                    </View>
                    <StatusPill label={st.label} color={st.color} bg={st.bg} />
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
