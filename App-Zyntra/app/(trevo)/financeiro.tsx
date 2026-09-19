import { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
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

function statusConta(status?: string): { label: string; color: string; bg: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'paga':      return { label: 'Paga',      color: Colors.green,  bg: Colors.greenDim  };
    case 'parcial':   return { label: 'Parcial',   color: Colors.accent, bg: Colors.accentDim };
    case 'cancelada': return { label: 'Cancelada', color: Colors.muted,  bg: Colors.surface   };
    default:          return { label: 'Pendente',  color: Colors.yellow, bg: Colors.yellowDim };
  }
}

interface TrevoConta {
  id: number;
  codigo?: string;
  fornecedor_nome?: string;
  cliente_nome?: string;
  descricao: string;
  data_vencimento: string;
  valor_original: number;
  valor_pago: number;
  status: string;
}

type Aba = 'pagar' | 'receber';

export default function TrevoFinanceiroScreen() {
  const [aba, setAba] = useState<Aba>('pagar');
  const [busca, setBusca] = useState('');
  const [emAberto, setEmAberto] = useState(true);

  const { data, isLoading, refetch, isRefetching } = useQuery<TrevoConta[]>({
    queryKey: ['trevo', 'financeiro', aba, busca, emAberto],
    queryFn: () => {
      const params = { busca: busca || undefined, em_aberto: emAberto ? ('1' as const) : undefined };
      return aba === 'pagar' ? trevoApi.getContasPagar(params) : trevoApi.getContasReceber(params);
    },
    retry: 1,
  });

  const contas = data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>Financeiro</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 6 }}>
        {([
          { chave: 'pagar' as Aba, rotulo: 'A Pagar' },
          { chave: 'receber' as Aba, rotulo: 'A Receber' },
        ]).map((s) => {
          const ativa = aba === s.chave;
          return (
            <TouchableOpacity
              key={s.chave}
              onPress={() => setAba(s.chave)}
              activeOpacity={0.85}
              style={{
                flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
                backgroundColor: ativa ? Colors.accent : Colors.card,
                borderWidth: 1, borderColor: ativa ? Colors.accent : Colors.border,
              }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: ativa ? '#fff' : Colors.textSoft }}>{s.rotulo}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 12 }}
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
            placeholder={aba === 'pagar' ? 'Buscar fornecedor, descrição...' : 'Buscar cliente, descrição...'}
            placeholderTextColor={Colors.muted}
            style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
          />
        </View>

        <TouchableOpacity
          onPress={() => setEmAberto((v) => !v)}
          style={{
            alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
            backgroundColor: emAberto ? Colors.accentDim : Colors.surface,
            borderWidth: 1, borderColor: emAberto ? Colors.accent : Colors.border,
          }}
        >
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: emAberto ? Colors.accent : Colors.mutedLight }}>
            Só em aberto
          </Text>
        </TouchableOpacity>

        <View>
          <SectionLabel text={`${contas.length} conta(s)`} />
          {isLoading ? (
            <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : contas.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma conta encontrada</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {contas.map((c, i) => {
                const st = statusConta(c.status);
                return (
                  <View
                    key={c.id}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      padding: 11, paddingHorizontal: 14,
                      borderBottomWidth: i < contas.length - 1 ? 1 : 0, borderBottomColor: Colors.border,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }} numberOfLines={1}>
                        {(aba === 'pagar' ? c.fornecedor_nome : c.cliente_nome) ?? c.descricao}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted }} numberOfLines={1}>
                        {c.descricao} · Vence {fmtDate(c.data_vencimento)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>{fmtCurrency(c.valor_original)}</Text>
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
