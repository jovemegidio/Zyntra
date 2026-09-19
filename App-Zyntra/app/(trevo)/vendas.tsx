import { useState } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { trevoApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { Card, SectionLabel, IconSearch, StatusPill } from '@/components/ui';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleDateString('pt-BR');
}

function statusVenda(status?: string): { label: string; color: string; bg: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'cancelada': return { label: 'Cancelada', color: Colors.red, bg: Colors.redDim };
    case 'concluida': return { label: 'Concluída', color: Colors.green, bg: Colors.greenDim };
    default:          return { label: status || 'Aberta', color: Colors.yellow, bg: Colors.yellowDim };
  }
}

interface TrevoVenda {
  id: number;
  cliente_nome?: string;
  placa?: string;
  veiculo_descricao?: string;
  total: number;
  status: string;
  data: string;
}

export default function TrevoVendasScreen() {
  const [busca, setBusca] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery<TrevoVenda[]>({
    queryKey: ['trevo', 'vendas'],
    queryFn: () => trevoApi.getVendas({ limite: 200 }),
    retry: 1,
  });

  const vendas = (data ?? []).filter((v) => {
    if (!busca) return true;
    const alvo = busca.toLowerCase();
    return (
      v.cliente_nome?.toLowerCase().includes(alvo) ||
      v.placa?.toLowerCase().includes(alvo) ||
      String(v.id).includes(alvo)
    );
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>Vendas</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.accent} colors={[Colors.accent]} />}
      >
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: Colors.surface, borderRadius: 11, padding: 10, paddingHorizontal: 12,
            borderWidth: 1, borderColor: Colors.border,
          }}
        >
          <IconSearch size={16} color={Colors.muted} />
          <TextInput
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar por cliente, placa ou nº..."
            placeholderTextColor={Colors.muted}
            style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
          />
        </View>

        <View>
          <SectionLabel text={`${vendas.length} venda(s)`} />
          {isLoading ? (
            <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : vendas.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma venda encontrada</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {vendas.map((v, i) => {
                const st = statusVenda(v.status);
                return (
                  <View
                    key={v.id}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      padding: 11, paddingHorizontal: 14,
                      borderBottomWidth: i < vendas.length - 1 ? 1 : 0, borderBottomColor: Colors.border,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }} numberOfLines={1}>
                        {v.cliente_nome ?? `Venda #${v.id}`}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted }} numberOfLines={1}>
                        {[v.placa, v.veiculo_descricao].filter(Boolean).join(' · ') || fmtDate(v.data)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>{fmtCurrency(v.total)}</Text>
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
