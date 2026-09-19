import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, foiEnfileirado } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import {
  Card,
  SectionLabel,
  ScreenHeader,
  KPICard,
  StatusPill,
  IconSearch,
  BotaoErpWeb,
} from '@/components/ui';

function fmtCurrency(value?: number | null) {
  if (value == null) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
}

/** Vencida = prazo no passado e ainda aberta. É o que o vendedor precisa ver primeiro. */
function estaVencida(tarefa: any): boolean {
  if (tarefa?.concluida) return false;
  if (!tarefa?.data_prevista) return false;
  const prazo = new Date(tarefa.data_prevista);
  return !Number.isNaN(prazo.getTime()) && prazo.getTime() < Date.now();
}

function corPrioridade(prioridade?: string) {
  switch (prioridade) {
    case 'alta':
      return { color: Colors.red, bg: Colors.redDim, label: 'Alta' };
    case 'baixa':
      return { color: Colors.muted, bg: Colors.surface, label: 'Baixa' };
    default:
      return { color: Colors.yellow, bg: Colors.yellowDim, label: 'Média' };
  }
}

function corTemperatura(temperatura?: string) {
  switch (String(temperatura || '').toLowerCase()) {
    case 'quente':
      return { color: Colors.red, bg: Colors.redDim, label: 'Quente' };
    case 'morno':
      return { color: Colors.yellow, bg: Colors.yellowDim, label: 'Morno' };
    case 'frio':
      return { color: Colors.teal, bg: Colors.tealDim, label: 'Frio' };
    default:
      return null;
  }
}

export default function CrmScreen() {
  useTheme();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [aba, setAba] = useState<'tarefas' | 'oportunidades'>('tarefas');

  const funilQuery = useQuery({
    queryKey: ['crm', 'funil'],
    queryFn: () => crmApi.getFunil(),
    retry: 1,
  });

  // `minhas=1` porque no celular o que importa é a agenda de quem está segurando
  // o aparelho — o quadro da equipe inteira é tela de computador.
  const tarefasQuery = useQuery({
    queryKey: ['crm', 'tarefas', 'minhas'],
    queryFn: () => crmApi.getTarefas({ minhas: '1', concluida: 0 }),
    retry: 1,
  });

  const oportunidadesQuery = useQuery({
    queryKey: ['crm', 'oportunidades'],
    queryFn: () => crmApi.getOportunidades({ status: 'aberto' }),
    retry: 1,
  });

  const concluir = useMutation({
    mutationFn: ({ id, concluida }: { id: number; concluida: boolean }) =>
      crmApi.concluirTarefa(id, concluida),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm', 'tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['crm', 'funil'] });
    },
    onError: (erro) => {
      if (foiEnfileirado(erro)) {
        // A fila offline já guardou o PATCH; a lista volta ao normal e o item
        // sobe sozinho. Nada de "erro" para uma ação que não se perdeu.
        Alert.alert(
          'Salvo offline',
          'Sem conexão agora. A tarefa será marcada assim que a rede voltar.'
        );
        return;
      }
      Alert.alert('Erro', 'Não foi possível atualizar a tarefa.');
    },
  });

  const totais = funilQuery.data?.totais ?? {};
  const funil = funilQuery.data?.funil ?? [];
  const tarefas = tarefasQuery.data ?? [];
  const oportunidades = (oportunidadesQuery.data ?? []).filter(
    (o: any) =>
      !busca ||
      String(o.titulo || '').toLowerCase().includes(busca.toLowerCase()) ||
      String(o.cliente_nome || '').toLowerCase().includes(busca.toLowerCase())
  );

  const vencidas = tarefas.filter(estaVencida);
  const maiorEtapa = Math.max(1, ...funil.map((e: any) => Number(e.valor) || 0));

  const carregando =
    funilQuery.isLoading || tarefasQuery.isLoading || oportunidadesQuery.isLoading;

  const atualizar = () => {
    funilQuery.refetch();
    tarefasQuery.refetch();
    oportunidadesQuery.refetch();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader title="CRM" onBack={() => router.back()} right={<BotaoErpWeb modulo="crm" />} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={funilQuery.isRefetching || tarefasQuery.isRefetching}
            onRefresh={atualizar}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      >
        {carregando && (
          <View style={{ paddingVertical: 30 }}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        )}

        {/* KPIs do pipeline */}
        {!funilQuery.isLoading && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <KPICard
              title="Pipeline aberto"
              value={fmtCurrency(totais.pipeline)}
              sub={`${totais.abertas ?? 0} oportunidades`}
              color={Colors.accent}
              style={{ flex: 1 }}
            />
            <KPICard
              title="Conversao"
              value={`${totais.taxa_conversao ?? 0}%`}
              sub={`${totais.ganhas ?? 0} ganhas / ${totais.perdidas ?? 0} perdidas`}
              color={Colors.green}
              style={{ flex: 1 }}
            />
          </View>
        )}

        {/* Funil por etapa */}
        {funil.length > 0 && (
          <View>
            <SectionLabel text="Funil por etapa" />
            <Card>
              {funil.map((etapa: any, i: number) => {
                const valor = Number(etapa.valor) || 0;
                const largura = Math.max(3, (valor / maiorEtapa) * 100);
                return (
                  <View key={etapa.etapa ?? i} style={{ marginTop: i === 0 ? 0 : 12 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 5,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                        {etapa.nome ?? etapa.etapa}{' '}
                        <Text style={{ color: Colors.muted, fontWeight: '400' }}>
                          ({etapa.qtd ?? 0})
                        </Text>
                      </Text>
                      <Text style={{ fontSize: 12.5, color: Colors.textSoft, fontWeight: '600' }}>
                        {fmtCurrency(valor)}
                      </Text>
                    </View>
                    <View
                      style={{
                        height: 7,
                        borderRadius: 4,
                        backgroundColor: Colors.surface,
                        overflow: 'hidden',
                      }}
                    >
                      <View
                        style={{
                          width: `${largura}%`,
                          height: '100%',
                          borderRadius: 4,
                          backgroundColor: etapa.cor || Colors.accent,
                        }}
                      />
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* Abas */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              ['tarefas', `Minhas tarefas${tarefas.length ? ` (${tarefas.length})` : ''}`],
              ['oportunidades', 'Oportunidades'],
            ] as const
          ).map(([valor, rotulo]) => {
            const ativa = aba === valor;
            return (
              <TouchableOpacity
                key={valor}
                onPress={() => setAba(valor)}
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: ativa ? Colors.accent : Colors.card,
                  borderWidth: 1,
                  borderColor: ativa ? Colors.accent : Colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: '700',
                    color: ativa ? '#fff' : Colors.textSoft,
                  }}
                >
                  {rotulo}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {aba === 'tarefas' ? (
          <View>
            {vencidas.length > 0 && (
              <View
                style={{
                  backgroundColor: Colors.redDim,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.red }}>
                  {vencidas.length} tarefa{vencidas.length > 1 ? 's' : ''} vencida
                  {vencidas.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}

            {!tarefasQuery.isLoading && tarefas.length === 0 && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
                  Nenhuma tarefa aberta para voce.
                </Text>
              </Card>
            )}

            {tarefas.map((t: any) => {
              const prio = corPrioridade(t.prioridade);
              const prazo = fmtDate(t.data_prevista);
              const vencida = estaVencida(t);
              const salvando = concluir.isPending && concluir.variables?.id === t.id;
              return (
                <Card key={t.id} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
                    <TouchableOpacity
                      onPress={() => concluir.mutate({ id: t.id, concluida: true })}
                      disabled={salvando}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: salvando ? Colors.muted : Colors.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      {salvando ? <ActivityIndicator size="small" color={Colors.muted} /> : null}
                    </TouchableOpacity>

                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.text }}>
                        {t.titulo}
                      </Text>
                      {t.oportunidade_titulo ? (
                        <Text style={{ fontSize: 11.5, color: Colors.muted, marginTop: 2 }}>
                          {t.oportunidade_titulo}
                        </Text>
                      ) : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 7,
                          marginTop: 7,
                          flexWrap: 'wrap',
                        }}
                      >
                        <StatusPill label={prio.label} color={prio.color} bg={prio.bg} />
                        {prazo ? (
                          <Text
                            style={{
                              fontSize: 11.5,
                              color: vencida ? Colors.red : Colors.muted,
                              fontWeight: vencida ? '700' : '400',
                            }}
                          >
                            {vencida ? 'Venceu em ' : 'Prazo '}
                            {prazo}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                backgroundColor: Colors.card,
                borderWidth: 1,
                borderColor: Colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                height: 44,
                marginBottom: 10,
              }}
            >
              <IconSearch size={17} color={Colors.muted} />
              <TextInput
                value={busca}
                onChangeText={setBusca}
                placeholder="Buscar oportunidade ou cliente..."
                placeholderTextColor={Colors.muted}
                style={{ flex: 1, fontSize: 14, color: Colors.text }}
              />
            </View>

            {!oportunidadesQuery.isLoading && oportunidades.length === 0 && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
                  Nenhuma oportunidade aberta.
                </Text>
              </Card>
            )}

            {oportunidades.slice(0, 40).map((o: any) => {
              const temp = corTemperatura(o.temperatura);
              return (
                <Card key={o.id} style={{ marginBottom: 8 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.text }}>
                        {o.titulo || 'Sem titulo'}
                      </Text>
                      {o.cliente_nome ? (
                        <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 2 }}>
                          {o.cliente_nome}
                        </Text>
                      ) : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          gap: 7,
                          marginTop: 8,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <StatusPill
                          label={o.etapa ?? '--'}
                          color={Colors.accent}
                          bg={Colors.accentDim}
                        />
                        {temp ? (
                          <StatusPill label={temp.label} color={temp.color} bg={temp.bg} />
                        ) : null}
                        {o.probabilidade != null ? (
                          <Text style={{ fontSize: 11.5, color: Colors.muted }}>
                            {o.probabilidade}% de chance
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.green }}>
                      {fmtCurrency(Number(o.valor_estimado))}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
