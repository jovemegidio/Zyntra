import { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { trevoApi } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { Card, SectionLabel, IconSearch } from '@/components/ui';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

interface TrevoProduto {
  id: number;
  sku: string;
  descricao: string;
  marca?: string;
  categoria?: string;
  preco_venda: number;
  estoque: number;
  estoque_minimo: number;
  ativo: boolean;
}

export default function TrevoProdutosScreen() {
  const [busca, setBusca] = useState('');
  const [soAbaixoMinimo, setSoAbaixoMinimo] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery<TrevoProduto[]>({
    queryKey: ['trevo', 'produtos', busca, soAbaixoMinimo],
    queryFn: () =>
      trevoApi.getProdutos({
        busca: busca || undefined,
        abaixo_minimo: soAbaixoMinimo ? '1' : undefined,
      }),
    retry: 1,
  });

  const produtos = data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>Produtos</Text>
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
            placeholder="Buscar por SKU, descrição, marca..."
            placeholderTextColor={Colors.muted}
            style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
          />
        </View>

        <TouchableOpacity
          onPress={() => setSoAbaixoMinimo((v) => !v)}
          style={{
            alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
            backgroundColor: soAbaixoMinimo ? Colors.redDim : Colors.surface,
            borderWidth: 1, borderColor: soAbaixoMinimo ? Colors.red : Colors.border,
          }}
        >
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: soAbaixoMinimo ? Colors.red : Colors.mutedLight }}>
            Abaixo do mínimo
          </Text>
        </TouchableOpacity>

        <View>
          <SectionLabel text={`${produtos.length} produto(s)`} />
          {isLoading ? (
            <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : produtos.length === 0 ? (
            <Card style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhum produto encontrado</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {produtos.map((p, i) => {
                const baixo = p.estoque <= p.estoque_minimo;
                return (
                  <View
                    key={p.id}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      padding: 11, paddingHorizontal: 14,
                      borderBottomWidth: i < produtos.length - 1 ? 1 : 0, borderBottomColor: Colors.border,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }} numberOfLines={1}>{p.descricao}</Text>
                      <Text style={{ fontSize: 11, color: Colors.muted }} numberOfLines={1}>
                        {[p.sku, p.marca].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>{fmtCurrency(p.preco_venda)}</Text>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: baixo ? Colors.red : Colors.muted }}>
                        Estoque: {p.estoque}
                      </Text>
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
