import { View, Text, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { faturamentoApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { Card, SectionLabel, ScreenHeader, KPICard, StatusPill } from '@/components/ui';
import type { NotaFiscal } from '@/types';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleDateString('pt-BR');
}

function statusNFe(status?: string): { label: string; color: string; bg: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'autorizada':    return { label: 'Autorizada',     color: Colors.green,  bg: Colors.greenDim  };
    case 'cancelada':     return { label: 'Cancelada',      color: Colors.red,    bg: Colors.redDim    };
    case 'rejeitada':     return { label: 'Rejeitada',      color: Colors.red,    bg: Colors.redDim    };
    case 'processando':   return { label: 'Processando',    color: Colors.yellow, bg: Colors.yellowDim };
    case 'validada':      return { label: 'Validada',       color: Colors.accent, bg: Colors.accentDim };
    case 'denegada':      return { label: 'Denegada',       color: Colors.orange, bg: Colors.orangeDim };
    default:              return { label: status ?? 'Rascunho', color: Colors.muted, bg: Colors.surface };
  }
}

export default function FaturamentoScreen() {
  const {
    data: resumoData,
    isLoading: resumoLoading,
    refetch: refetchResumo,
    isRefetching,
  } = useQuery({
    queryKey: ['faturamento', 'resumo'],
    queryFn: () => faturamentoApi.getResumo(),
    retry: 1,
  });

  const {
    data: notasRaw,
    isLoading: notasLoading,
    refetch: refetchNotas,
  } = useQuery<NotaFiscal[]>({
    queryKey: ['faturamento', 'notas'],
    queryFn: async () => {
      const res = await faturamentoApi.getNotas({ limit: 20 } as any);
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
    retry: 1,
  });

  const resumo = (resumoData as any) ?? {};
  const notas  = notasRaw ?? [];

  const totalHoje       = resumo.total_hoje       ?? resumo.notas_hoje       ?? notas.length;
  const valorFaturado   = resumo.valor_total       ?? resumo.faturamento      ?? 0;
  const notasAutorizadas = resumo.autorizadas      ?? notas.filter((n) => n.status === 'autorizada').length;

  const handleRefresh = () => { refetchResumo(); refetchNotas(); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Faturamento"
        onBack={() => router.back()}
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
        {resumoLoading ? (
          <View style={{ height: 80, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <KPICard
              title="NF-e hoje"
              value={String(totalHoje)}
              color={Colors.red}
              style={{ flex: 1 }}
            />
            <KPICard
              title="Total faturado"
              value={fmtCurrency(valorFaturado)}
              color={Colors.orange}
              style={{ flex: 1 }}
            />
          </View>
        )}

        {/* Resumo rápido */}
        {!resumoLoading && (notasAutorizadas > 0 || resumo.canceladas > 0) && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { label: 'Autorizadas', value: String(notasAutorizadas), color: Colors.green },
              { label: 'Canceladas',  value: String(resumo.canceladas ?? notas.filter((n) => n.status === 'cancelada').length), color: Colors.red },
              { label: 'Pendentes',   value: String(resumo.pendentes  ?? notas.filter((n) => !['autorizada', 'cancelada'].includes(n.status ?? '')).length), color: Colors.yellow },
            ].map((k, i) => (
              <Card key={i} style={{ flex: 1, padding: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 9, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  {k.label}
                </Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: k.color }}>{k.value}</Text>
              </Card>
            ))}
          </View>
        )}

        {/* NF-e Emitidas */}
        <View>
          <SectionLabel text="NF-e Emitidas" />
          {notasLoading ? (
            <View style={{ height: 100, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : notas.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma nota fiscal emitida</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {notas.slice(0, 20).map((n, i) => {
                const st = statusNFe(n.status);
                const dest = (n as any).destinatario_nome ?? (n as any).destinatario ?? `Nota #${n.id}`;
                const num  = n.numero ? `NF-${n.numero}` : `NF #${n.id}`;
                return (
                  <View
                    key={n.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 11,
                      paddingHorizontal: 14,
                      borderBottomWidth: i < Math.min(notas.length, 20) - 1 ? 1 : 0,
                      borderBottomColor: Colors.border,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>{num}</Text>
                      <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }} numberOfLines={1}>{dest}</Text>
                      {(n as any).data_emissao ? (
                        <Text style={{ fontSize: 10, color: Colors.muted }}>{fmtDate((n as any).data_emissao)}</Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>
                        {fmtCurrency((n as any).valor_total ?? (n as any).valor)}
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
