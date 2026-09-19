import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tarefasApi, foiEnfileirado, type StatusTarefa } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import {
  Card,
  ScreenHeader,
  StatusPill,
  Button,
  IconSearch,
  IconPlus,
  IconClose,
  BotaoErpWeb,
} from '@/components/ui';

type FiltroPrevisto = 'todos' | 'hoje' | 'semana' | 'atrasadas';

const FILTROS: Array<{ valor: FiltroPrevisto; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todas' },
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'atrasadas', rotulo: 'Atrasadas' },
];

function corStatus(status?: string) {
  switch (status) {
    case 'realizada':
      return { color: Colors.green, bg: Colors.greenDim, label: 'Realizada' };
    case 'em_execucao':
      return { color: Colors.yellow, bg: Colors.yellowDim, label: 'Em execucao' };
    case 'cancelada':
      return { color: Colors.red, bg: Colors.redDim, label: 'Cancelada' };
    default:
      return { color: Colors.muted, bg: Colors.surface, label: 'Pendente' };
  }
}

function corPrioridade(prioridade?: string) {
  switch (prioridade) {
    case 'alta':
      return { color: Colors.red, bg: Colors.redDim, label: 'Alta' };
    case 'baixa':
      return { color: Colors.muted, bg: Colors.surface, label: 'Baixa' };
    default:
      return { color: Colors.yellow, bg: Colors.yellowDim, label: 'Media' };
  }
}

function fmtDate(valor?: string | null) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toLocaleDateString('pt-BR');
}

function estaAtrasada(t: any): boolean {
  if (!t?.previsao) return false;
  if (t.status === 'realizada' || t.status === 'cancelada') return false;
  const prazo = new Date(t.previsao);
  return !Number.isNaN(prazo.getTime()) && prazo.setHours(23, 59, 59, 999) < Date.now();
}

/** Próximo status no ciclo — um toque só, que é o que se faz com uma mão no celular. */
function proximoStatus(atual?: string): StatusTarefa {
  if (atual === 'pendente') return 'em_execucao';
  if (atual === 'em_execucao') return 'realizada';
  return 'pendente';
}

export default function TarefasScreen() {
  useTheme();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [previsto, setPrevisto] = useState<FiltroPrevisto>('todos');
  const [novaAberta, setNovaAberta] = useState(false);

  const lista = useQuery({
    queryKey: ['tarefas', previsto, busca],
    queryFn: () =>
      tarefasApi.listar({
        previsto,
        q: busca || undefined,
        limit: 100,
      }),
    retry: 1,
  });

  const mudar = useMutation({
    mutationFn: ({ id, status }: { id: number; status: StatusTarefa }) =>
      tarefasApi.mudarStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tarefas'] }),
    onError: (erro) => {
      if (foiEnfileirado(erro)) {
        Alert.alert('Salvo offline', 'Sem conexão agora. A mudança sobe assim que a rede voltar.');
        return;
      }
      Alert.alert('Erro', 'Não foi possível atualizar a tarefa.');
    },
  });

  const tarefas = lista.data?.tarefas ?? [];
  const counts = lista.data?.counts ?? {};
  const atrasadas = tarefas.filter(estaAtrasada);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Tarefas"
        onBack={() => router.back()}
        right={<BotaoErpWeb modulo="tarefas" />}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={lista.isRefetching}
            onRefresh={() => lista.refetch()}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      >
        {/* Contadores */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              ['Pendentes', counts.pendente ?? 0, Colors.muted],
              ['Em execucao', counts.em_execucao ?? 0, Colors.yellow],
              ['Realizadas', counts.realizada ?? 0, Colors.green],
            ] as const
          ).map(([rotulo, valor, cor]) => (
            <Card key={rotulo} style={{ flex: 1, paddingVertical: 12 }}>
              <Text style={{ fontSize: 19, fontWeight: '800', color: cor }}>{valor}</Text>
              <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 2 }}>{rotulo}</Text>
            </Card>
          ))}
        </View>

        {atrasadas.length > 0 && previsto !== 'atrasadas' && (
          <TouchableOpacity
            onPress={() => setPrevisto('atrasadas')}
            activeOpacity={0.8}
            style={{ backgroundColor: Colors.redDim, borderRadius: 12, padding: 12 }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.red }}>
              {atrasadas.length} tarefa{atrasadas.length > 1 ? 's' : ''} atrasada
              {atrasadas.length > 1 ? 's' : ''} — toque para ver
            </Text>
          </TouchableOpacity>
        )}

        {/* Busca */}
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
          }}
        >
          <IconSearch size={17} color={Colors.muted} />
          <TextInput
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar tarefa..."
            placeholderTextColor={Colors.muted}
            style={{ flex: 1, fontSize: 14, color: Colors.text }}
          />
        </View>

        {/* Filtros de prazo */}
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {FILTROS.map((f) => {
            const ativo = previsto === f.valor;
            return (
              <TouchableOpacity
                key={f.valor}
                onPress={() => setPrevisto(f.valor)}
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: ativo ? Colors.accent : Colors.card,
                  borderWidth: 1,
                  borderColor: ativo ? Colors.accent : Colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: ativo ? '#fff' : Colors.textSoft,
                  }}
                >
                  {f.rotulo}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {lista.isLoading && (
          <View style={{ paddingVertical: 26 }}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        )}

        {!lista.isLoading && tarefas.length === 0 && (
          <Card>
            <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
              Nenhuma tarefa neste filtro.
            </Text>
          </Card>
        )}

        {tarefas.map((t: any) => {
          const st = corStatus(t.status);
          const prio = corPrioridade(t.prioridade);
          const prazo = fmtDate(t.previsao);
          const atrasada = estaAtrasada(t);
          const salvando = mudar.isPending && mudar.variables?.id === t.id;
          return (
            <Card key={t.id}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: Colors.text,
                  textDecorationLine: t.status === 'realizada' ? 'line-through' : 'none',
                }}
              >
                {t.descricao}
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  marginTop: 8,
                  flexWrap: 'wrap',
                }}
              >
                <StatusPill label={st.label} color={st.color} bg={st.bg} />
                <StatusPill label={prio.label} color={prio.color} bg={prio.bg} />
                {t.origem ? (
                  <Text style={{ fontSize: 11, color: Colors.mutedLight }}>{t.origem}</Text>
                ) : null}
                {prazo ? (
                  <Text
                    style={{
                      fontSize: 11.5,
                      color: atrasada ? Colors.red : Colors.muted,
                      fontWeight: atrasada ? '700' : '400',
                    }}
                  >
                    {atrasada ? 'Venceu ' : 'Prazo '}
                    {prazo}
                  </Text>
                ) : null}
              </View>

              {t.status !== 'realizada' && t.status !== 'cancelada' && (
                <TouchableOpacity
                  onPress={() => mudar.mutate({ id: t.id, status: proximoStatus(t.status) })}
                  disabled={salvando}
                  activeOpacity={0.8}
                  style={{
                    marginTop: 11,
                    height: 38,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: Colors.accentDim,
                    borderWidth: 1,
                    borderColor: Colors.accent + '55',
                  }}
                >
                  {salvando ? (
                    <ActivityIndicator size="small" color={Colors.accent} />
                  ) : (
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: Colors.accent }}>
                      {t.status === 'pendente' ? 'Iniciar' : 'Concluir'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </Card>
          );
        })}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Botão flutuante de nova tarefa */}
      <TouchableOpacity
        onPress={() => setNovaAberta(true)}
        activeOpacity={0.85}
        style={{
          position: 'absolute',
          right: 18,
          bottom: 22,
          width: 54,
          height: 54,
          borderRadius: 27,
          backgroundColor: Colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.2,
          shadowRadius: 7,
          elevation: 6,
        }}
      >
        <IconPlus size={24} color="#fff" />
      </TouchableOpacity>

      <ModalNovaTarefa
        visible={novaAberta}
        onClose={() => setNovaAberta(false)}
        onCriada={() => queryClient.invalidateQueries({ queryKey: ['tarefas'] })}
      />
    </SafeAreaView>
  );
}

function ModalNovaTarefa({
  visible,
  onClose,
  onCriada,
}: {
  visible: boolean;
  onClose: () => void;
  onCriada: () => void;
}) {
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState<'baixa' | 'media' | 'alta'>('media');
  const [observacoes, setObservacoes] = useState('');

  const limpar = () => {
    setDescricao('');
    setObservacoes('');
    setPrioridade('media');
  };

  const criar = useMutation({
    mutationFn: () =>
      tarefasApi.criar({ descricao: descricao.trim(), prioridade, observacoes: observacoes.trim() }),
    onSuccess: () => {
      onCriada();
      limpar();
      onClose();
      Alert.alert('Criada!', 'Tarefa adicionada ao quadro.');
    },
    onError: (erro) => {
      if (foiEnfileirado(erro)) {
        onCriada();
        limpar();
        onClose();
        Alert.alert(
          'Salva offline',
          'Sem conexão agora. A tarefa foi guardada e sobe sozinha quando a rede voltar.'
        );
        return;
      }
      Alert.alert('Erro', 'Não foi possível criar a tarefa.');
    },
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: Colors.border,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>Nova tarefa</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <IconClose size={20} color={Colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: Colors.textSoft }}>
                Descricao
              </Text>
              <TextInput
                value={descricao}
                onChangeText={setDescricao}
                placeholder="O que precisa ser feito?"
                placeholderTextColor={Colors.muted}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: Colors.border,
                  borderRadius: 9,
                  padding: 12,
                  fontSize: 14,
                  color: Colors.text,
                  backgroundColor: Colors.card,
                  minHeight: 76,
                  textAlignVertical: 'top',
                }}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: Colors.textSoft }}>
                Prioridade
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['baixa', 'media', 'alta'] as const).map((p) => {
                  const ativo = prioridade === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPrioridade(p)}
                      activeOpacity={0.85}
                      style={{
                        flex: 1,
                        height: 40,
                        borderRadius: 9,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: ativo ? Colors.accent : Colors.card,
                        borderWidth: 1,
                        borderColor: ativo ? Colors.accent : Colors.border,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12.5,
                          fontWeight: '700',
                          color: ativo ? '#fff' : Colors.textSoft,
                          textTransform: 'capitalize',
                        }}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: Colors.textSoft }}>
                Observacoes (opcional)
              </Text>
              <TextInput
                value={observacoes}
                onChangeText={setObservacoes}
                placeholder="Detalhes, contexto..."
                placeholderTextColor={Colors.muted}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: Colors.border,
                  borderRadius: 9,
                  padding: 12,
                  fontSize: 14,
                  color: Colors.text,
                  backgroundColor: Colors.card,
                  minHeight: 76,
                  textAlignVertical: 'top',
                }}
              />
            </View>

            <Button
              onPress={() => criar.mutate()}
              loading={criar.isPending}
              disabled={!descricao.trim() || criar.isPending}
            >
              Criar tarefa
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
