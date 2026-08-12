import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  RefreshControl, ActivityIndicator, Alert, Modal, FlatList, useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pcpApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Colors } from '@/lib/constants';
import { Card, SectionLabel, ScreenHeader, StatusPill, KPICard } from '@/components/ui';
import Svg, { Path, Circle } from 'react-native-svg';

// ─── tipos ────────────────────────────────────────────────────
interface OrdemProducao {
  id: number;
  codigo?: string;
  produto_nome?: string;
  quantidade?: number;
  unidade?: string;
  status?: string;
  prioridade?: string;
  data_prevista?: string;
  progresso?: number;
  responsavel?: string;
}

interface Apontamento {
  id: number;
  tipo_atividade: string;
  nome_atividade: string;
  operador?: string;
  hora_inicio?: string;
  hora_fim?: string;
  duracao_segundos?: number;
  quantidade_produzida?: number;
  quantidade_refugo?: number;
  ordem_producao_id?: number;
  produto_descricao?: string;
  maquina?: string;
  turno?: string;
  observacoes?: string;
  created_at?: string;
}

// ─── utils ────────────────────────────────────────────────────
function fmtDuracao(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}min`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function fmtHora(iso?: string) {
  if (!iso) return '--:--';
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '--:--'; }
}

function fmtClock(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function dataExtenso(d: Date) {
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function statusOP(s?: string): { label: string; color: string; bg: string } {
  const l = (s ?? '').toLowerCase();
  if (l.includes('conclu') || l.includes('finaliz')) return { label: 'Concluída', color: Colors.green, bg: Colors.greenDim };
  if (l.includes('em_prod') || l.includes('producao') || l.includes('ativa'))
    return { label: 'Em Produção', color: Colors.yellow, bg: Colors.yellowDim };
  if (l.includes('cancel')) return { label: 'Cancelada', color: Colors.red, bg: Colors.redDim };
  return { label: s ?? 'Pendente', color: Colors.muted, bg: Colors.surface };
}

// ─── ícones ──────────────────────────────────────────────────
function IconPlay({ size = 20, color = '#fff' }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M5 3l14 9-14 9V3z" /></Svg>;
}
function IconStop({ size = 20, color = '#fff' }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M5 5h14v14H5z" /></Svg>;
}
function IconCheck({ size = 18, color = '#fff' }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function IconClock({ size = 16, color = '#60708c' }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" /><Path d="M12 7v5l3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></Svg>;
}

// ─── biblioteca de ícones (stroke 24x24) ─────────────────────
const STROKE_ICONS: Record<string, string[]> = {
  tools: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  ],
  alert: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  food: ['M6 2v20', 'M4 2v6a2 2 0 0 0 4 0V2', 'M17 2c-2 0-3 2.2-3 5.5S15 12 17 12v10'],
  box: ['M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.3 7 12 12l8.7-5', 'M12 22V12'],
  bolt: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  gear: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
  xcircle: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M15 9l-6 6', 'M9 9l6 6'],
  swap: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
  refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
  recycle: ['M1 4v6h6', 'M23 20v-6h-6', 'M20.49 9A9 9 0 0 0 5.64 5.64L1 10', 'M3.51 15a9 9 0 0 0 14.85 3.36L23 14'],
  unlink: [
    'M18.84 12.25 20.56 10.54a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M5.17 11.75 3.46 13.46a5 5 0 0 0 7.07 7.07l1.71-1.71',
    'M8 2v2', 'M2 8h2', 'M16 22v-2', 'M22 16h-2',
  ],
  power: ['M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10'],
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
};

function ActIcon({ name, size = 22, color = Colors.text }: { name: string; size?: number; color?: string }) {
  if (name === 'play') {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M5 3l14 9-14 9V3z" /></Svg>;
  }
  if (name === 'pause') {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M6 4h4v16H6z" /><Path d="M14 4h4v16h-4z" /></Svg>;
  }
  const paths = STROKE_ICONS[name] ?? STROKE_ICONS.gear;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {paths.map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

// ─── catálogo de apontamentos (espelha relatorios/apontamentos do PCP) ─
interface ApontTipo {
  code: string;
  nome: string;
  color: string;
  bg: string;
  icon: string;
  produz?: boolean;
}
const APONTAMENTOS: ApontTipo[] = [
  { code: 'ST',  nome: 'Setup',              color: Colors.purple, bg: Colors.purpleDim, icon: 'tools' },
  { code: '1',   nome: 'Início Produção',    color: Colors.green,  bg: Colors.greenDim,  icon: 'play', produz: true },
  { code: '1A',  nome: 'Produção Irregular', color: Colors.orange, bg: Colors.orangeDim, icon: 'alert', produz: true },
  { code: 'PR',  nome: 'Parada Refeição',    color: Colors.yellow, bg: Colors.yellowDim, icon: 'food' },
  { code: 'PM',  nome: 'Parada Manutenção',  color: Colors.red,    bg: Colors.redDim,    icon: 'pause' },
  { code: 'FM',  nome: 'Falta Mat. Prima',   color: Colors.orange, bg: Colors.orangeDim, icon: 'box' },
  { code: 'ME',  nome: 'Manut. Elétrica',    color: Colors.yellow, bg: Colors.yellowDim, icon: 'bolt' },
  { code: 'MM',  nome: 'Manut. Mecânica',    color: Colors.accent, bg: Colors.accentDim, icon: 'gear' },
  { code: 'PCM', nome: 'Parada Corretiva',   color: Colors.red,    bg: Colors.redDim,    icon: 'xcircle' },
  { code: 'TT',  nome: 'Troca de Turno',     color: Colors.accent, bg: Colors.accentDim, icon: 'swap' },
  { code: 'MP',  nome: 'Manut. Preventiva',  color: Colors.green,  bg: Colors.greenDim,  icon: 'shield' },
  { code: 'MC',  nome: 'Manut. Corretiva',   color: Colors.red,    bg: Colors.redDim,    icon: 'tools' },
  { code: 'TB',  nome: 'Troca Bobina',       color: Colors.teal,   bg: Colors.tealDim,   icon: 'refresh' },
  { code: 'TM',  nome: 'Troca Material',     color: Colors.purple, bg: Colors.purpleDim, icon: 'recycle' },
  { code: 'QL',  nome: 'Quebra de Lance',    color: Colors.red,    bg: Colors.redDim,    icon: 'unlink' },
  { code: 'QE',  nome: 'Queda Energia',      color: Colors.muted,  bg: Colors.surface,   icon: 'power' },
  { code: 'AM',  nome: 'Aquec. Máquina',     color: Colors.orange, bg: Colors.orangeDim, icon: 'flame' },
];
const apontByCode = (code?: string) => APONTAMENTOS.find((a) => a.code === code);

// fundo escuro do cronômetro (espelha o ícone/splash da marca)
const TIMER_BG = '#0e1730';

// ─── modal seleção de OP ─────────────────────────────────────
function OPPickerModal({
  visible, ordens, onSelect, onClose,
}: {
  visible: boolean;
  ordens: OrdemProducao[];
  onSelect: (op: OrdemProducao | null) => void;
  onClose: () => void;
}) {
  const [busca, setBusca] = useState('');
  const filtered = ordens.filter(
    (o) =>
      !busca ||
      o.codigo?.toLowerCase().includes(busca.toLowerCase()) ||
      o.produto_nome?.toLowerCase().includes(busca.toLowerCase())
  );
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>Selecionar OP</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ fontSize: 15, color: Colors.accent, fontWeight: '500' }}>Cancelar</Text>
          </TouchableOpacity>
        </View>
        <View style={{ padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, height: 42, gap: 8 }}>
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar OP ou produto..."
              placeholderTextColor={Colors.muted}
              style={{ flex: 1, fontSize: 14, color: Colors.text, padding: 0 }}
              autoFocus
            />
          </View>
        </View>
        <TouchableOpacity
          onPress={() => { onSelect(null); onClose(); }}
          style={{ marginHorizontal: 12, marginBottom: 8, padding: 14, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border }}
        >
          <Text style={{ fontSize: 14, color: Colors.muted, fontStyle: 'italic' }}>Sem OP vinculada</Text>
        </TouchableOpacity>
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
          renderItem={({ item }) => {
            const st = statusOP(item.status);
            return (
              <TouchableOpacity
                onPress={() => { onSelect(item); onClose(); }}
                style={{ padding: 14, marginBottom: 8, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>{item.codigo ?? `OP #${item.id}`}</Text>
                  <StatusPill label={st.label} color={st.color} bg={st.bg} />
                </View>
                <Text style={{ fontSize: 13, color: Colors.textSoft, marginTop: 3 }}>{item.produto_nome}</Text>
                {item.quantidade ? (
                  <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 2 }}>Qtd: {item.quantidade} {item.unidade ?? ''}</Text>
                ) : null}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={{ paddingVertical: 32, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: Colors.muted }}>Nenhuma OP encontrada</Text>
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── aba: novo apontamento ────────────────────────────────────
function NovoApontamento({ ordens }: { ordens: OrdemProducao[] }) {
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();

  const [ativo, setAtivo] = useState<ApontTipo | null>(null);
  const [inicio, setInicio] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [opSelecionada, setOpSelecionada] = useState<OrdemProducao | null>(null);
  const [showOpModal, setShowOpModal] = useState(false);
  const [qtdProd, setQtdProd] = useState('');
  const [qtdRefugo, setQtdRefugo] = useState('');
  const [obs, setObs] = useState('');
  const [feito, setFeito] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const rodando = !!ativo && !!inicio;

  useEffect(() => {
    if (rodando) {
      timer.current = setInterval(() => setElapsed((p) => p + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [rodando]);

  // grade responsiva (mais colunas em tablet/paisagem)
  const hPad = 14;
  const gap = 8;
  const cols = width >= 1024 ? 6 : width >= 680 ? 5 : 4;
  const tileW = Math.floor((width - hPad * 2 - gap * (cols - 1)) / cols);

  const reset = useCallback(() => {
    setAtivo(null); setInicio(null); setElapsed(0);
    setQtdProd(''); setQtdRefugo(''); setObs(''); setOpSelecionada(null);
  }, []);

  const mutation = useMutation({
    mutationFn: pcpApi.registrarApontamento,
    onSuccess: (data, vars) => {
      if (data?.success !== false) {
        const code = apontByCode(vars.tipo_atividade)?.code ?? vars.tipo_atividade;
        setFeito(`Apontamento ${code} registrado!`);
        setTimeout(() => setFeito(null), 4000);
        Alert.alert('Apontamento registrado!', `${vars.nome_atividade} salvo com sucesso.`);
        queryClient.invalidateQueries({ queryKey: ['pcp', 'meus-apontamentos'] });
        queryClient.invalidateQueries({ queryKey: ['pcp', 'stats'] });
        reset();
      } else {
        Alert.alert('Erro', data?.message ?? 'Não foi possível salvar o apontamento.');
      }
    },
    onError: () => Alert.alert('Erro', 'Falha na conexão. Tente novamente.'),
  });

  const iniciar = (a: ApontTipo) => {
    if (rodando) return;
    setFeito(null);
    setAtivo(a);
    setInicio(new Date());
    setElapsed(0);
  };

  const pararRegistrar = () => {
    if (!ativo || !inicio) return;
    const fim = new Date();
    const durSeg = Math.round((fim.getTime() - inicio.getTime()) / 1000);
    mutation.mutate({
      tipo_atividade: ativo.code,
      nome_atividade: ativo.nome,
      hora_inicio: inicio.toISOString(),
      hora_fim: fim.toISOString(),
      duracao_segundos: durSeg,
      ordem_producao_id: opSelecionada?.id ?? null,
      produto_descricao: opSelecionada?.produto_nome,
      quantidade_produzida: qtdProd ? Number(qtdProd) : 0,
      quantidade_refugo: qtdRefugo ? Number(qtdRefugo) : 0,
      observacoes: obs || undefined,
    });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: hPad, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
      {/* cabeçalho */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconClock size={18} color={Colors.accent} />
          <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.text }}>Registro de Tempo</Text>
        </View>
        <Text style={{ fontSize: 11.5, color: Colors.muted, fontWeight: '500', textTransform: 'capitalize' }}>
          {dataExtenso(new Date())}
        </Text>
      </View>

      {/* cronômetro */}
      <View style={{ backgroundColor: TIMER_BG, borderRadius: 18, padding: 24, alignItems: 'center', gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: rodando ? (ativo?.color ?? Colors.green) : 'rgba(255,255,255,0.45)' }} />
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: rodando ? '#fff' : 'rgba(255,255,255,0.6)' }}>
            {rodando ? 'EM ANDAMENTO' : 'AGUARDANDO'}
          </Text>
        </View>
        <Text style={{ fontSize: 52, fontWeight: '800', color: '#fff', letterSpacing: 1, fontVariant: ['tabular-nums'] }}>
          {fmtClock(elapsed)}
        </Text>
        {rodando && ativo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <ActIcon name={ativo.icon} size={14} color="#fff" />
            </View>
            <Text style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.85)', fontWeight: '600' }}>{ativo.nome} • {ativo.code}</Text>
          </View>
        ) : (
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Toque em uma atividade para iniciar</Text>
        )}

        {rodando && (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <TouchableOpacity onPress={reset} style={{ paddingHorizontal: 18, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.85)' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={pararRegistrar} disabled={mutation.isPending} style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.green }}>
              {mutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <IconStop size={16} color="#fff" />}
              <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#fff' }}>Parar e registrar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {feito && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.greenDim, borderRadius: 10, padding: 12 }}>
          <IconCheck size={16} color={Colors.green} />
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: Colors.green }}>{feito}</Text>
        </View>
      )}

      {/* detalhes opcionais (em andamento) */}
      {rodando && ativo && (
        <View style={{ gap: 12 }}>
          <SectionLabel text="Detalhes (opcional)" />
          <TouchableOpacity
            onPress={() => setShowOpModal(true)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: opSelecionada ? ativo.color : Colors.border }}
          >
            {opSelecionada ? (
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.text }}>{opSelecionada.codigo ?? `OP #${opSelecionada.id}`}</Text>
                <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 1 }}>{opSelecionada.produto_nome}</Text>
              </View>
            ) : (
              <Text style={{ fontSize: 14, color: Colors.muted }}>Vincular Ordem de Produção...</Text>
            )}
            <Text style={{ fontSize: 20, color: Colors.muted }}>›</Text>
          </TouchableOpacity>

          {ativo.produz && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { label: 'Produzido', value: qtdProd, setter: setQtdProd, color: Colors.green },
                { label: 'Refugo', value: qtdRefugo, setter: setQtdRefugo, color: Colors.red },
              ].map((f) => (
                <View key={f.label} style={{ flex: 1, gap: 5 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '500', color: Colors.text }}>{f.label}</Text>
                  <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 12, height: 46, justifyContent: 'center' }}>
                    <TextInput value={f.value} onChangeText={f.setter} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.muted} style={{ fontSize: 16, color: f.color, fontWeight: '600', padding: 0 }} />
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ backgroundColor: Colors.card, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, padding: 12 }}>
            <TextInput value={obs} onChangeText={setObs} placeholder="Observações..." placeholderTextColor={Colors.muted} multiline style={{ fontSize: 14, color: Colors.text, minHeight: 56, textAlignVertical: 'top', padding: 0 }} />
          </View>
        </View>
      )}

      {/* grade de apontamentos */}
      <View>
        <SectionLabel text="Selecione o Apontamento" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {APONTAMENTOS.map((a) => {
            const isActive = ativo?.code === a.code;
            const disabled = rodando && !isActive;
            return (
              <TouchableOpacity
                key={a.code}
                onPress={() => iniciar(a)}
                disabled={rodando}
                activeOpacity={0.7}
                style={{
                  width: tileW,
                  paddingVertical: 12,
                  paddingHorizontal: 4,
                  borderRadius: 14,
                  alignItems: 'center',
                  gap: 7,
                  backgroundColor: isActive ? a.bg : Colors.card,
                  borderWidth: 1.5,
                  borderColor: isActive ? a.color : Colors.border,
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: a.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <ActIcon name={a.icon} size={20} color={a.color} />
                </View>
                <Text numberOfLines={2} style={{ fontSize: 10.5, fontWeight: '600', color: Colors.text, textAlign: 'center', lineHeight: 13 }}>{a.nome}</Text>
                <Text style={{ fontSize: 10, fontWeight: '800', color: Colors.muted, letterSpacing: 0.5 }}>{a.code}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <OPPickerModal
        visible={showOpModal}
        ordens={ordens}
        onSelect={setOpSelecionada}
        onClose={() => setShowOpModal(false)}
      />
    </ScrollView>
  );
}

// ─── aba: histórico ───────────────────────────────────────────
function MeusApontamentos() {
  const { data = [], isLoading, refetch, isRefetching } = useQuery<Apontamento[]>({
    queryKey: ['pcp', 'meus-apontamentos'],
    queryFn: pcpApi.getMeusApontamentos,
    retry: 1,
  });

  const tipoConfig = (id?: string) => {
    const a = apontByCode(id);
    return a
      ? { color: a.color, label: `${a.nome} • ${a.code}` }
      : { color: Colors.muted, label: id ?? 'Atividade' };
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 14, gap: 10 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.accent} colors={[Colors.accent]} />}
    >
      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={Colors.accent} /></View>
      ) : data.length === 0 ? (
        <View style={{ paddingVertical: 48, alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.text }}>Sem apontamentos</Text>
          <Text style={{ fontSize: 13, color: Colors.muted, marginTop: 4 }}>Use a aba "Apontar" para registrar</Text>
        </View>
      ) : (
        data.map((a) => {
          const tc = tipoConfig(a.tipo_atividade);
          return (
            <Card key={a.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tc.color }} />
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>{tc.label}</Text>
                </View>
                {a.duracao_segundos ? (
                  <Text style={{ fontSize: 12, color: Colors.muted }}>{fmtDuracao(a.duracao_segundos)}</Text>
                ) : null}
              </View>
              {a.produto_descricao || a.ordem_producao_id ? (
                <Text style={{ fontSize: 13, color: Colors.textSoft }}>
                  {a.produto_descricao ?? `OP #${a.ordem_producao_id}`}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Text style={{ fontSize: 12, color: Colors.muted }}>
                  {fmtHora(a.hora_inicio)} → {fmtHora(a.hora_fim)}
                </Text>
                {a.quantidade_produzida ? (
                  <Text style={{ fontSize: 12, color: Colors.green, fontWeight: '600' }}>
                    Prod: {a.quantidade_produzida}
                  </Text>
                ) : null}
                {a.quantidade_refugo ? (
                  <Text style={{ fontSize: 12, color: Colors.red, fontWeight: '600' }}>
                    Ref: {a.quantidade_refugo}
                  </Text>
                ) : null}
              </View>
              {a.maquina ? <Text style={{ fontSize: 11, color: Colors.muted }}>Máq: {a.maquina}</Text> : null}
              {a.observacoes ? <Text style={{ fontSize: 12, color: Colors.muted, fontStyle: 'italic' }}>{a.observacoes}</Text> : null}
            </Card>
          );
        })
      )}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

// ─── tela principal ───────────────────────────────────────────
type TabId = 'ordens' | 'apontar' | 'historico';

export default function PCPScreen() {
  const [tab, setTab] = useState<TabId>('ordens');
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin || user?.role === 'admin' || user?.role === 'gestor';

  const {
    data: ordens = [], isLoading: ordensLoading, refetch: refetchOrdens, isRefetching: ordensRefetching,
  } = useQuery<OrdemProducao[]>({
    queryKey: ['pcp', 'ordens-apontamento'],
    queryFn: () => pcpApi.getOrdensParaApontamento(),
    retry: 1,
  });

  const { data: stats } = useQuery({
    queryKey: ['pcp', 'stats'],
    queryFn: pcpApi.getApontamentosStats,
    retry: 1,
  });

  const TABS: { id: TabId; label: string }[] = [
    { id: 'ordens',    label: 'Ordens' },
    { id: 'apontar',   label: 'Apontar' },
    { id: 'historico', label: 'Histórico' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader title="PCP — Apontamentos" onBack={() => router.back()} />

      {/* KPIs — visíveis apenas para administradores/gestores */}
      {isAdmin && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10 }}>
          <KPICard
            title="Hoje"
            value={String((stats as any)?.apontamentos_hoje ?? '--')}
            sub="apontamentos"
            color={Colors.accent}
            style={{ flex: 1 }}
          />
          <KPICard
            title="OPs Ativas"
            value={String(ordens.length)}
            color={Colors.yellow}
            style={{ flex: 1 }}
          />
          <KPICard
            title="Produzido"
            value={String((stats as any)?.quantidade_total ?? '--')}
            sub={(stats as any)?.unidade ?? 'un'}
            color={Colors.green}
            style={{ flex: 1 }}
          />
        </View>
      )}

      {/* Tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: 14, backgroundColor: Colors.surface, borderRadius: 10, padding: 3, gap: 3, marginBottom: 4 }}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            onPress={() => setTab(t.id)}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center',
              backgroundColor: tab === t.id ? Colors.card : 'transparent',
              shadowColor: tab === t.id ? '#000' : 'transparent',
              shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3,
              elevation: tab === t.id ? 1 : 0,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: tab === t.id ? Colors.accent : Colors.muted }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Conteúdo */}
      {tab === 'ordens' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, gap: 10 }}
          refreshControl={<RefreshControl refreshing={ordensRefetching} onRefresh={refetchOrdens} tintColor={Colors.accent} colors={[Colors.accent]} />}
        >
          {ordensLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={Colors.accent} /></View>
          ) : ordens.length === 0 ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.text }}>Nenhuma OP ativa</Text>
              <Text style={{ fontSize: 13, color: Colors.muted, marginTop: 4 }}>Todas as ordens estão concluídas</Text>
            </View>
          ) : (
            ordens.map((o) => {
              const st = statusOP(o.status);
              const prog = o.progresso ?? 0;
              return (
                <Card key={o.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>{o.codigo ?? `OP #${o.id}`}</Text>
                      <Text style={{ fontSize: 13, color: Colors.textSoft, marginTop: 2 }}>{o.produto_nome}</Text>
                    </View>
                    <StatusPill label={st.label} color={st.color} bg={st.bg} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1, height: 6, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.min(prog, 100)}%`, height: '100%', backgroundColor: st.color, borderRadius: 4 }} />
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: st.color, width: 34, textAlign: 'right' }}>{prog}%</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                    {o.quantidade ? <Text style={{ fontSize: 11, color: Colors.muted }}>Qtd: {o.quantidade} {o.unidade ?? ''}</Text> : null}
                    {o.data_prevista ? <Text style={{ fontSize: 11, color: Colors.muted }}>Prazo: {new Date(o.data_prevista).toLocaleDateString('pt-BR')}</Text> : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => setTab('apontar')}
                    style={{ marginTop: 10, paddingVertical: 8, backgroundColor: Colors.accentDim, borderRadius: 8, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.accent }}>Apontar nesta OP</Text>
                  </TouchableOpacity>
                </Card>
              );
            })
          )}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}

      {tab === 'apontar' && <NovoApontamento ordens={ordens} />}
      {tab === 'historico' && <MeusApontamentos />}
    </SafeAreaView>
  );
}
