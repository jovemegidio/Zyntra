import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Image,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { rhApi, foiEnfileirado, periodoDoMes } from '@/lib/api';
import { Colors, getAvatarUrl } from '@/lib/constants';
import { Card, SectionLabel, ScreenHeader, StatusPill, Badge, IconPlus, BotaoErpWeb } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import type { Funcionario } from '@/types';

// ─── ícones ───────────────────────────────────────────────────
function IconClock({ size = 18, color = Colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
      <Path d="M12 7v5l3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconDoc({ size = 18, color = Colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="2" width="16" height="20" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="M8 7h8M8 11h8M8 15h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}
function IconUpload({ size = 18, color = Colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M17 8l-5-5-5 5M12 3v12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconRequest({ size = 18, color = Colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={color} strokeWidth="1.8" />
      <Path d="M14 2v6h6M12 18v-6M9 15h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconSun({ size = 16, color = Colors.yellow }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="4" stroke={color} strokeWidth="1.8" />
      <Path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}
function IconCheck({ size = 14, color = Colors.green }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 6 9 17l-5-5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconMoney({ size = 18, color = Colors.teal }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="6" width="20" height="12" rx="2" stroke={color} strokeWidth="1.8" />
      <Circle cx="12" cy="12" r="2" stroke={color} strokeWidth="1.8" />
    </Svg>
  );
}

// ─── utilitários ─────────────────────────────────────────────
function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function statusFuncionario(status?: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'ativo':    return { label: 'Presente', color: Colors.green,  bg: Colors.greenDim  };
    case 'ferias':   return { label: 'Férias',    color: Colors.accent, bg: Colors.accentDim };
    case 'afastado': return { label: 'Afastado',  color: Colors.orange, bg: Colors.orangeDim };
    case 'inativo':  return { label: 'Inativo',   color: Colors.red,    bg: Colors.redDim    };
    default:         return { label: status ?? 'Ativo', color: Colors.green, bg: Colors.greenDim };
  }
}

function statusTag(status?: string) {
  if (status === 'aprovada' || status === 'aprovado') return { color: Colors.green,  bg: Colors.greenDim,  label: 'Aprovada' };
  if (status === 'negada'   || status === 'negado')   return { color: Colors.red,    bg: Colors.redDim,    label: 'Negada'   };
  return                                                     { color: Colors.yellow, bg: Colors.yellowDim, label: 'Pendente' };
}

// ─── Modal de atestado ────────────────────────────────────────
function AtestadoModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [arquivo, setArquivo] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [obs, setObs] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (arquivo) {
        fd.append('arquivo', { uri: arquivo.uri, name: arquivo.name, type: arquivo.type } as any);
      }
      fd.append('data_inicio', dataInicio);
      fd.append('data_fim', dataFim);
      fd.append('observacoes', obs);
      return rhApi.enviarAtestado(fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rh', 'atestados'] });
      Alert.alert('Enviado!', 'Atestado enviado para análise do RH.');
      setArquivo(null); setDataInicio(''); setDataFim(''); setObs('');
      onClose();
    },
    onError: () => Alert.alert('Erro', 'Não foi possível enviar o atestado. Tente novamente.'),
  });

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setArquivo({ uri: asset.uri, name: asset.name ?? 'atestado', type: asset.mimeType ?? 'application/octet-stream' });
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar o arquivo.');
    }
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permissão necessária', 'Permita acesso à galeria.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setArquivo({ uri: a.uri, name: a.fileName ?? 'atestado.jpg', type: a.mimeType ?? 'image/jpeg' });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>Enviar Atestado</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ fontSize: 15, color: Colors.accent, fontWeight: '600' }}>Cancelar</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>Arquivo do atestado *</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={pickDocument} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                <IconDoc size={16} color={Colors.accent} />
                <Text style={{ fontSize: 13, color: Colors.accent, fontWeight: '600' }}>PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pickImage} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                <IconUpload size={16} color={Colors.accent} />
                <Text style={{ fontSize: 13, color: Colors.accent, fontWeight: '600' }}>Foto</Text>
              </TouchableOpacity>
            </View>
            {arquivo && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: Colors.greenDim, borderRadius: 8 }}>
                <IconCheck size={14} color={Colors.green} />
                <Text style={{ flex: 1, fontSize: 12, color: Colors.green }} numberOfLines={1}>{arquivo.name}</Text>
                <TouchableOpacity onPress={() => setArquivo(null)}><Text style={{ fontSize: 12, color: Colors.red }}>Remover</Text></TouchableOpacity>
              </View>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>Período de afastamento *</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 11, color: Colors.muted }}>Data início</Text>
                <TextInput value={dataInicio} onChangeText={setDataInicio} placeholder="DD/MM/AAAA" placeholderTextColor={Colors.muted} keyboardType="numeric" style={{ height: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.card }} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 11, color: Colors.muted }}>Data fim</Text>
                <TextInput value={dataFim} onChangeText={setDataFim} placeholder="DD/MM/AAAA" placeholderTextColor={Colors.muted} keyboardType="numeric" style={{ height: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.card }} />
              </View>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>Observações</Text>
            <TextInput value={obs} onChangeText={setObs} placeholder="Descreva o motivo do afastamento..." placeholderTextColor={Colors.muted} multiline numberOfLines={3} style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: 9, padding: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.card, minHeight: 80, textAlignVertical: 'top' }} />
          </View>

          <TouchableOpacity
            onPress={() => mutation.mutate()}
            disabled={!arquivo || !dataInicio || mutation.isPending}
            style={{ height: 48, borderRadius: 10, backgroundColor: arquivo && dataInicio ? Colors.accent : Colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Enviar Atestado</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Modal de solicitação ─────────────────────────────────────
const TIPOS_SOLICITACAO = [
  { key: 'ferias',       label: 'Férias',         icon: '🌴' },
  { key: 'adiantamento', label: 'Adiantamento',   icon: '💵' },
  { key: 'documento',    label: 'Documento',      icon: '📄' },
  { key: 'folga',        label: 'Folga',          icon: '📅' },
  { key: 'outros',       label: 'Outros',         icon: '✏️' },
] as const;

type TipoSolicitacao = typeof TIPOS_SOLICITACAO[number]['key'];

function SolicitacaoModal({
  visible,
  onClose,
  initialTipo = 'ferias',
}: {
  visible: boolean;
  onClose: () => void;
  initialTipo?: TipoSolicitacao;
}) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoSolicitacao>(initialTipo);
  const [descricao, setDescricao] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    if (visible) setTipo(initialTipo);
  }, [visible, initialTipo]);

  const mutation = useMutation({
    mutationFn: () => rhApi.criarSolicitacao({ tipo, descricao, data_inicio: dataInicio || undefined, data_fim: dataFim || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rh', 'solicitacoes'] });
      Alert.alert('Enviada!', 'Solicitação enviada para o RH.');
      setDescricao(''); setDataInicio(''); setDataFim('');
      onClose();
    },
    onError: (erro) => {
      if (foiEnfileirado(erro)) {
        Alert.alert('Salva offline', 'Sem conexão agora. A solicitação foi guardada e sobe sozinha quando a rede voltar.');
        setDescricao(''); setDataInicio(''); setDataFim('');
        onClose();
        return;
      }
      Alert.alert('Erro', 'Não foi possível enviar a solicitação. Tente novamente.');
    },
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>Nova Solicitação</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ fontSize: 15, color: Colors.accent, fontWeight: '600' }}>Cancelar</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>Tipo de solicitação</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TIPOS_SOLICITACAO.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => setTipo(t.key)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: tipo === t.key ? Colors.accent : Colors.border, backgroundColor: tipo === t.key ? Colors.accentDim : Colors.card }}
                >
                  <Text style={{ fontSize: 14 }}>{t.icon}</Text>
                  <Text style={{ fontSize: 12.5, fontWeight: tipo === t.key ? '700' : '500', color: tipo === t.key ? Colors.accent : Colors.textSoft }}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {(tipo === 'ferias' || tipo === 'folga') && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>Período solicitado</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 11, color: Colors.muted }}>Início</Text>
                  <TextInput value={dataInicio} onChangeText={setDataInicio} placeholder="DD/MM/AAAA" placeholderTextColor={Colors.muted} keyboardType="numeric" style={{ height: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.card }} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 11, color: Colors.muted }}>Fim</Text>
                  <TextInput value={dataFim} onChangeText={setDataFim} placeholder="DD/MM/AAAA" placeholderTextColor={Colors.muted} keyboardType="numeric" style={{ height: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.card }} />
                </View>
              </View>
            </View>
          )}

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>Descrição / Justificativa</Text>
            <TextInput value={descricao} onChangeText={setDescricao} placeholder="Descreva sua solicitação..." placeholderTextColor={Colors.muted} multiline numberOfLines={4} style={{ borderWidth: 1, borderColor: Colors.border, borderRadius: 9, padding: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.card, minHeight: 100, textAlignVertical: 'top' }} />
          </View>

          <TouchableOpacity
            onPress={() => mutation.mutate()}
            disabled={!descricao.trim() || mutation.isPending}
            style={{ height: 48, borderRadius: 10, backgroundColor: descricao.trim() ? Colors.accent : Colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Enviar Solicitação</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Painel de ponto ──────────────────────────────────────────
function PontoPanel() {
  const queryClient = useQueryClient();

  const { data: pontoHoje, isLoading } = useQuery({
    queryKey: ['rh', 'ponto', 'hoje'],
    queryFn: () => rhApi.getPontoHoje(),
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: (tipo: 'entrada' | 'saida' | 'almoco_saida' | 'almoco_retorno') =>
      rhApi.registrarPonto(tipo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rh', 'ponto', 'hoje'] }),
    onError: (erro) =>
      Alert.alert(
        foiEnfileirado(erro) ? 'Batida salva offline' : 'Erro',
        foiEnfileirado(erro)
          ? 'Sem conexão agora. A batida foi guardada com o horário exato e sobe sozinha quando a rede voltar.'
          : 'Não foi possível registrar o ponto.'
      ),
  });

  // getPontoHoje retorna { data: Record<tipo, hora>, marcacoes }
  const ponto: Record<string, string | undefined> | null = pontoHoje?.data ?? null;
  const hora = (val?: string) =>
    val ? new Date(val).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';

  const acoes: Array<{ tipo: 'entrada' | 'saida' | 'almoco_saida' | 'almoco_retorno'; label: string; done: boolean; color: string }> = [
    { tipo: 'entrada',        label: 'Entrada',        done: !!ponto?.entrada,        color: Colors.green  },
    { tipo: 'almoco_saida',   label: 'Saída almoço',   done: !!ponto?.almoco_saida,   color: Colors.yellow },
    { tipo: 'almoco_retorno', label: 'Retorno almoço', done: !!ponto?.almoco_retorno, color: Colors.teal   },
    { tipo: 'saida',          label: 'Saída',          done: !!ponto?.saida,          color: Colors.red    },
  ];

  const horasMap: Record<string, string | undefined> = {
    entrada: ponto?.entrada, almoco_saida: ponto?.almoco_saida,
    almoco_retorno: ponto?.almoco_retorno, saida: ponto?.saida,
  };

  const proxima = acoes.find((a) => !a.done);

  return (
    <Card style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <IconClock size={16} color={Colors.accent} />
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: Colors.text }}>Ponto de Hoje</Text>
        </View>
        {ponto?.total_horas && (
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, backgroundColor: Colors.accentDim, borderRadius: 999 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.accent }}>{ponto.total_horas}</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {acoes.map((a) => (
              <View
                key={a.tipo}
                style={{ flex: 1, minWidth: '45%', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: a.done ? `${a.color}18` : Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: a.done ? `${a.color}40` : Colors.border }}
              >
                <Text style={{ fontSize: 10, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 }}>{a.label}</Text>
                <Text style={{ fontSize: 17, fontWeight: '700', color: a.done ? a.color : Colors.muted, marginTop: 2 }}>
                  {hora(horasMap[a.tipo])}
                </Text>
              </View>
            ))}
          </View>

          {proxima ? (
            <TouchableOpacity
              onPress={() => mutation.mutate(proxima.tipo)}
              disabled={mutation.isPending}
              style={{ height: 46, borderRadius: 10, backgroundColor: proxima.color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {mutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <IconClock size={16} color="#fff" />
                    <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#fff' }}>Registrar {proxima.label}</Text>
                  </>
              }
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, backgroundColor: Colors.greenDim, borderRadius: 10 }}>
              <IconCheck size={14} color={Colors.green} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.green }}>Ponto completo hoje</Text>
            </View>
          )}
        </>
      )}
    </Card>
  );
}

// ─── Painel de espelho de ponto (mensal) ───────────────────────
const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function statusEspelhoTag(status?: string) {
  if (status === 'atraso') return { color: Colors.yellow, bg: Colors.yellowDim, label: 'Atraso' };
  if (status === 'falta') return { color: Colors.red, bg: Colors.redDim, label: 'Falta' };
  if (status === 'folga') return { color: Colors.teal, bg: Colors.tealDim, label: 'Folga' };
  return { color: Colors.green, bg: Colors.greenDim, label: 'Normal' };
}

function EspelhoPontoPanel() {
  const agora = new Date();
  const [ref, setRef] = useState({ ano: agora.getFullYear(), mes: agora.getMonth() + 1 });
  const ehMesAtual = ref.ano === agora.getFullYear() && ref.mes === agora.getMonth() + 1;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['rh', 'espelho', ref.ano, ref.mes],
    queryFn: () => rhApi.getEspelhoPonto(periodoDoMes(ref.ano, ref.mes)),
    retry: 1,
  });

  const mesAnterior = () =>
    setRef((r) => (r.mes === 1 ? { ano: r.ano - 1, mes: 12 } : { ano: r.ano, mes: r.mes - 1 }));
  const mesSeguinte = () => {
    if (ehMesAtual) return;
    setRef((r) => (r.mes === 12 ? { ano: r.ano + 1, mes: 1 } : { ano: r.ano, mes: r.mes + 1 }));
  };

  const dias = data?.dias ?? [];

  return (
    <Card style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={mesAnterior} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
          <Text style={{ fontSize: 20, color: Colors.accent, fontWeight: '700' }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: Colors.text }}>
          {NOMES_MES[ref.mes - 1]} {ref.ano}
        </Text>
        <TouchableOpacity
          onPress={mesSeguinte}
          disabled={ehMesAtual}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ padding: 4, opacity: ehMesAtual ? 0.3 : 1 }}
        >
          <Text style={{ fontSize: 20, color: Colors.accent, fontWeight: '700' }}>›</Text>
        </TouchableOpacity>
      </View>

      {isLoading || isFetching ? (
        <ActivityIndicator color={Colors.accent} />
      ) : data?.vinculado === false ? (
        <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', paddingVertical: 8 }}>
          {data?.message ?? 'Você não está vinculado a um cadastro de funcionário.'}
        </Text>
      ) : (
        <>
          {data?.resumo && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[
                { label: 'Dias trabalhados', value: String(data.resumo.dias_trabalhados) },
                { label: 'Horas', value: data.resumo.horas_trabalhadas },
                { label: 'Atrasos', value: String(data.resumo.atrasos) },
                { label: 'Faltas', value: String(data.resumo.faltas) },
              ].map((r, i) => (
                <View key={i} style={{ flex: 1, minWidth: '45%', backgroundColor: Colors.surface, borderRadius: 10, padding: 8, gap: 2 }}>
                  <Text style={{ fontSize: 9.5, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    {r.label}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>{r.value}</Text>
                </View>
              ))}
            </View>
          )}

          {dias.length === 0 ? (
            <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', paddingVertical: 4 }}>
              Nenhum registro no período
            </Text>
          ) : (
            <View style={{ gap: 2 }}>
              {dias.map((d, i) => {
                const st = statusEspelhoTag(d.status);
                return (
                  <View
                    key={d.data ?? i}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 7,
                      borderBottomWidth: i < dias.length - 1 ? 1 : 0,
                      borderBottomColor: Colors.border,
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 12.5, fontWeight: '600', color: Colors.text }}>
                        {d.data} · {d.dia}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted }}>
                        {[d.entrada, d.saidaAlmoco, d.retornoAlmoco, d.saida]
                          .filter((h) => h && h !== '-')
                          .join('  ·  ') || '--'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {d.horas && d.horas !== '-' && (
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: Colors.text }}>{d.horas}</Text>
                      )}
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: st.bg, borderRadius: 999 }}>
                        <Text style={{ fontSize: 10.5, fontWeight: '600', color: st.color }}>{st.label}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

// ─── Tela principal ───────────────────────────────────────────
export default function RHScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'gestor';
  const [atestadoModal, setAtestadoModal] = useState(false);
  const [solicitacaoModal, setSolicitacaoModal] = useState(false);
  const [solicitacaoTipo, setSolicitacaoTipo] = useState<TipoSolicitacao>('ferias');

  const {
    data: funcionariosRaw,
    isLoading: funcLoading,
    isError: funcError,
    refetch: refetchFunc,
    isRefetching,
  } = useQuery<Funcionario[]>({
    queryKey: ['rh', 'funcionarios'],
    queryFn: async () => {
      const res = await rhApi.getFuncionarios();
      return Array.isArray(res) ? res : res?.data ?? [];
    },
    retry: 1,
    enabled: isAdmin,
  });

  const { data: aniversariantesRaw, refetch: refetchAni } = useQuery({
    queryKey: ['rh', 'aniversariantes'],
    queryFn: async () => {
      const res = await rhApi.getAniversariantes();
      return Array.isArray(res) ? res : res?.data ?? [];
    },
    retry: 1,
    enabled: isAdmin,
  });

  const { data: holerite, refetch: refetchHolerite } = useQuery({
    queryKey: ['rh', 'holerite', 'ultimo'],
    queryFn: () => rhApi.getMeuUltimoHolerite(),
    retry: 1,
  });

  const { data: feriasData, refetch: refetchFerias } = useQuery({
    queryKey: ['rh', 'ferias', 'minhas'],
    queryFn: () => rhApi.getMinhasFerias(),
    retry: 1,
  });

  const { data: solicitacoesData, refetch: refetchSolicitacoes } = useQuery({
    queryKey: ['rh', 'solicitacoes', 'minhas'],
    queryFn: () => rhApi.getMinhasSolicitacoes(),
    retry: 1,
  });

  const { data: atestadosData, refetch: refetchAtestados } = useQuery({
    queryKey: ['rh', 'atestados', 'meus'],
    queryFn: () => rhApi.getMeusAtestados(),
    retry: 1,
  });

  const funcionarios: Funcionario[] = funcionariosRaw ?? [];
  const aniversariantes = Array.isArray(aniversariantesRaw) ? aniversariantesRaw : [];
  const solicitacoes: any[] = Array.isArray(solicitacoesData) ? solicitacoesData : solicitacoesData?.data ?? [];
  const atestados: any[]    = Array.isArray(atestadosData)    ? atestadosData    : atestadosData?.data   ?? [];
  const ferias = feriasData?.data ?? feriasData ?? null;
  const holData = holerite?.data ?? holerite ?? null;

  const handleRefresh = () => {
    refetchHolerite(); refetchFerias(); refetchSolicitacoes(); refetchAtestados();
    if (isAdmin) { refetchFunc(); refetchAni(); }
  };

  const avatarUrl = getAvatarUrl(user?.avatar || user?.foto);
  const displayName = user?.apelido || user?.nome?.split(' ')[0] || 'Colaborador';

  const openSolicitacao = (tipo: TipoSolicitacao = 'outros') => {
    setSolicitacaoTipo(tipo);
    setSolicitacaoModal(true);
  };

  const openHolerite = async () => {
    if (!holData?.arquivo_url) {
      Alert.alert('Holerite', 'Nenhum holerite disponivel para download no momento.');
      return;
    }

    const url = getAvatarUrl(holData.arquivo_url);
    if (!url) return;

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Erro', 'Nao foi possivel abrir o holerite.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader
        title="RH & Colaborador"
        onBack={() => router.back()}
        right={<BotaoErpWeb modulo="rh" />}
      />

      <AtestadoModal visible={atestadoModal} onClose={() => setAtestadoModal(false)} />
      <SolicitacaoModal visible={solicitacaoModal} initialTipo={solicitacaoTipo} onClose={() => setSolicitacaoModal(false)} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 14 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.accent} colors={[Colors.accent]} />}
      >
        {/* ── Perfil ── */}
        <Card style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: Colors.surface }} resizeMode="cover" />
            ) : (
              <View style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#fff' }}>{getInitials(user?.nome ?? 'C')}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.text }}>{displayName}</Text>
              <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 1 }}>
                {user?.setor ? `${user.setor}` : (user?.role ?? 'Colaborador')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(auth)/perfil')}>
              <Text style={{ fontSize: 12, color: Colors.accent, fontWeight: '600' }}>Perfil</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* ── Ações rápidas ── */}
        <View>
          <SectionLabel text="Minha Área" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { icon: <IconUpload size={20} color={Colors.orange} />, label: 'Atestado',  bg: Colors.orangeDim, onPress: () => setAtestadoModal(true) },
              { icon: <IconRequest size={20} color={Colors.purple} />, label: 'Solicitar', bg: Colors.purpleDim, onPress: () => openSolicitacao('outros') },
              { icon: <IconMoney size={20} color={Colors.teal} />,    label: 'Holerite',  bg: Colors.tealDim,   onPress: openHolerite },
              { icon: <IconSun size={20} color={Colors.yellow} />,    label: 'Férias',    bg: Colors.yellowDim, onPress: () => openSolicitacao('ferias') },
            ].map((item, i) => (
              <TouchableOpacity
                key={i}
                onPress={item.onPress}
                style={{ flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center', gap: 8 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center' }}>{item.icon}</View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.mutedLight, textAlign: 'center' }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Ponto ── */}
        <View>
          <SectionLabel text="Ponto Eletrônico" />
          <PontoPanel />
        </View>

        {/* ── Espelho de ponto ── */}
        <View>
          <SectionLabel text="Espelho de Ponto" />
          <EspelhoPontoPanel />
        </View>

        {/* ── Holerite ── */}
        <View>
          <SectionLabel text="Último Holerite" />
          <Card style={{ padding: 14 }}>
            {!holData ? (
              <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', paddingVertical: 8 }}>Nenhum holerite disponível</Text>
            ) : (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: Colors.muted }}>
                    {String(holData.mes ?? '--').padStart(2, '0')}/{holData.ano ?? '--'}
                  </Text>
                  {holData.arquivo_url && (
                    <TouchableOpacity onPress={openHolerite}><Text style={{ fontSize: 12, color: Colors.accent, fontWeight: '600' }}>Baixar PDF</Text></TouchableOpacity>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { label: 'Bruto',     value: `R$ ${Number(holData.salario_bruto  ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, color: Colors.text  },
                    { label: 'Descontos', value: `- R$ ${Number(holData.descontos     ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, color: Colors.red   },
                    { label: 'Líquido',   value: `R$ ${Number(holData.salario_liquido ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, color: Colors.green },
                  ].map((r, i) => (
                    <View key={i} style={{ flex: 1, backgroundColor: Colors.surface, borderRadius: 10, padding: 10, gap: 3 }}>
                      <Text style={{ fontSize: 9.5, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 }}>{r.label}</Text>
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: r.color }}>{r.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </Card>
        </View>

        {/* ── Férias ── */}
        <View>
          <SectionLabel text="Minhas Férias" />
          <Card style={{ padding: 14, gap: 10 }}>
            {!ferias || (Array.isArray(ferias) && ferias.length === 0) ? (
              <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', paddingVertical: 4 }}>Nenhuma férias registrada</Text>
            ) : (
              Array.isArray(ferias) && ferias.slice(0, 3).map((f: any, i: number) => {
                const st = statusTag(f.status);
                return (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: i < Math.min(ferias.length, 3) - 1 ? 1 : 0, borderBottomColor: Colors.border }}>
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                        {f.data_inicio ? new Date(f.data_inicio).toLocaleDateString('pt-BR') : '--'} → {f.data_fim ? new Date(f.data_fim).toLocaleDateString('pt-BR') : '--'}
                      </Text>
                      <Text style={{ fontSize: 11, color: Colors.muted }}>{f.dias_gozados ?? 0} dias</Text>
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: st.bg, borderRadius: 999 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: st.color }}>{st.label}</Text>
                    </View>
                  </View>
                );
              })
            )}
            <TouchableOpacity
              onPress={() => openSolicitacao('ferias')}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, backgroundColor: Colors.surface }}
            >
              <IconPlus size={14} color={Colors.accent} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.accent }}>Solicitar Férias</Text>
            </TouchableOpacity>
          </Card>
        </View>

        {/* ── Solicitações ── */}
        <View>
          <SectionLabel text="Minhas Solicitações" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {solicitacoes.length === 0 ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma solicitação enviada</Text>
              </View>
            ) : (
              solicitacoes.slice(0, 5).map((s: any, i: number) => {
                const st = statusTag(s.status);
                const tipoLabel = TIPOS_SOLICITACAO.find((t) => t.key === s.tipo)?.label ?? s.tipo;
                return (
                  <View key={s.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingHorizontal: 14, borderBottomWidth: i < Math.min(solicitacoes.length, 5) - 1 ? 1 : 0, borderBottomColor: Colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>{tipoLabel}</Text>
                      {s.descricao ? <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }} numberOfLines={1}>{s.descricao}</Text> : null}
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: st.bg, borderRadius: 999 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: st.color }}>{st.label}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </View>

        {/* ── Atestados ── */}
        <View>
          <SectionLabel text="Meus Atestados" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {atestados.length === 0 ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhum atestado enviado</Text>
              </View>
            ) : (
              atestados.slice(0, 5).map((a: any, i: number) => {
                const st = statusTag(a.status);
                return (
                  <View key={a.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingHorizontal: 14, borderBottomWidth: i < Math.min(atestados.length, 5) - 1 ? 1 : 0, borderBottomColor: Colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                        {a.data_inicio ? new Date(a.data_inicio).toLocaleDateString('pt-BR') : '--'}
                        {a.data_fim ? ` → ${new Date(a.data_fim).toLocaleDateString('pt-BR')}` : ''}
                      </Text>
                      {a.observacoes ? <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }} numberOfLines={1}>{a.observacoes}</Text> : null}
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: st.bg, borderRadius: 999 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: st.color }}>{st.label}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </View>

        {/* ── Admin: lista de colaboradores ── */}
        {isAdmin && (
          <>
            <View>
              <SectionLabel text="Colaboradores" />
              {funcLoading ? (
                <View style={{ height: 80, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={Colors.accent} size="small" /></View>
              ) : funcError ? (
                <Card style={{ padding: 16, alignItems: 'center' }}>
                  <Text style={{ color: Colors.red, fontSize: 13 }}>Falha ao carregar colaboradores</Text>
                  <TouchableOpacity onPress={() => refetchFunc()} style={{ marginTop: 8 }}><Text style={{ color: Colors.accent, fontSize: 12 }}>Tentar novamente</Text></TouchableOpacity>
                </Card>
              ) : funcionarios.length === 0 ? (
                <Card style={{ padding: 16, alignItems: 'center' }}><Text style={{ fontSize: 13, color: Colors.muted }}>Nenhum colaborador encontrado</Text></Card>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    {[
                      { label: 'Total',  value: String(funcionarios.length),                                   color: Colors.text   },
                      { label: 'Ativos', value: String(funcionarios.filter((f) => f.status === 'ativo').length), color: Colors.green  },
                      { label: 'Outros', value: String(funcionarios.filter((f) => f.status !== 'ativo').length), color: Colors.yellow },
                    ].map((c, i) => (
                      <Card key={i} style={{ flex: 1, padding: 12, alignItems: 'center' }}>
                        <Text style={{ fontSize: 9.5, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{c.label}</Text>
                        <Text style={{ fontSize: 20, fontWeight: '700', color: c.color }}>{c.value}</Text>
                      </Card>
                    ))}
                  </View>
                  <Card style={{ padding: 0, overflow: 'hidden' }}>
                    {funcionarios.slice(0, 10).map((c, i) => {
                      const st = statusFuncionario(c.status);
                      return (
                        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, paddingHorizontal: 14, borderBottomWidth: i < Math.min(funcionarios.length, 10) - 1 ? 1 : 0, borderBottomColor: Colors.border }}>
                          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.card2, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.accent }}>{getInitials(c.nome)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }} numberOfLines={1}>{c.nome}</Text>
                            <Text style={{ fontSize: 11, color: Colors.muted }}>{c.cargo ?? 'Colaborador'}{c.setor ? ` · ${c.setor}` : ''}</Text>
                          </View>
                          <StatusPill label={st.label} color={st.color} bg={st.bg} />
                        </View>
                      );
                    })}
                  </Card>
                </>
              )}
            </View>

            {aniversariantes.length > 0 && (
              <View>
                <SectionLabel text="Aniversários do Mês" />
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {aniversariantes.map((a: any, i: number) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 11, paddingHorizontal: 14, borderBottomWidth: i < aniversariantes.length - 1 ? 1 : 0, borderBottomColor: Colors.border }}>
                      <View>
                        <Text style={{ fontSize: 13, color: Colors.text, fontWeight: '500' }}>{a.nome}</Text>
                        <Text style={{ fontSize: 11, color: Colors.muted }}>{a.setor ?? a.cargo}</Text>
                      </View>
                      <Badge
                        label={a.data_nascimento ? new Date(a.data_nascimento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
                        color={Colors.purple}
                        bg={Colors.purpleDim}
                      />
                    </View>
                  ))}
                </Card>
              </View>
            )}
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
