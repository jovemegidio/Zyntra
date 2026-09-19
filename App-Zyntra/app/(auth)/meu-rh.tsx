import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rhApi, foiEnfileirado, periodoDoMes } from '@/lib/api';
import { Colors } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { Card, SectionLabel, ScreenHeader, StatusPill, Row } from '@/components/ui';

/**
 * Portal do colaborador — espelha `/RH/funcionario.html` da web.
 *
 * Todas as rotas usadas aqui são self-service no backend (estão na
 * `rhSelfServicePrefixes` de `routes/rh-routes.js`, ou vivem em `rh-extras.js`,
 * que exige só login). Nenhuma delas depende da área `rh`, então funcionam para
 * qualquer colaborador — inclusive numa sessão aberta por CPF.
 *
 * O PDF do holerite abre no portal web dentro do app: o arquivo é um binário
 * atrás de sessão e o middleware de auth só aceita header ou cookie — uma URL
 * com token na query não autenticaria. O WebView de `sistema.tsx` troca o Bearer
 * por um cookie httpOnly, então lá o download funciona igual ao navegador.
 */

type Secao = 'holerites' | 'dados' | 'ponto' | 'beneficios';

const SECOES: Array<{ chave: Secao; rotulo: string }> = [
  { chave: 'holerites', rotulo: 'Holerites' },
  { chave: 'dados', rotulo: 'Meus dados' },
  { chave: 'ponto', rotulo: 'Espelho' },
  { chave: 'beneficios', rotulo: 'Benefícios' },
];

function moeda(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function competenciaDe(h: any): string {
  if (h?.competencia) return String(h.competencia);
  if (h?.mes_referencia) return String(h.mes_referencia);
  if (h?.mes && h?.ano) return `${String(h.mes).padStart(2, '0')}/${h.ano}`;
  return '--';
}

export default function MeuRhScreen() {
  useTheme();
  const queryClient = useQueryClient();
  const [secao, setSecao] = useState<Secao>('holerites');

  const holerites = useQuery({
    queryKey: ['rh', 'holerites', 'meus'],
    queryFn: () => rhApi.getMeusHolerites(),
    retry: 1,
  });

  const dados = useQuery({
    queryKey: ['rh', 'meus-dados'],
    queryFn: () => rhApi.getMeusDados(),
    retry: 1,
    enabled: secao === 'dados',
  });

  const hoje = new Date();
  const espelho = useQuery({
    queryKey: ['rh', 'espelho-ponto', hoje.getFullYear(), hoje.getMonth() + 1],
    queryFn: () => rhApi.getEspelhoPonto(periodoDoMes(hoje.getFullYear(), hoje.getMonth() + 1)),
    retry: 1,
    enabled: secao === 'ponto',
  });

  const beneficios = useQuery({
    queryKey: ['rh', 'beneficios'],
    queryFn: () => rhApi.getBeneficios(),
    retry: 1,
    enabled: secao === 'beneficios',
  });

  const confirmar = useMutation({
    mutationFn: (id: number) => rhApi.confirmarHolerite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rh', 'holerites'] });
      Alert.alert('Confirmado', 'Recebimento do holerite registrado.');
    },
    onError: (erro) => {
      if (foiEnfileirado(erro)) {
        Alert.alert('Salvo offline', 'Sem conexão agora. A confirmação sobe quando a rede voltar.');
        return;
      }
      Alert.alert('Erro', 'Não foi possível confirmar o recebimento.');
    },
  });

  const abrirPortalWeb = (caminho = '/RH/funcionario.html') =>
    router.push({ pathname: '/(auth)/sistema', params: { path: caminho } } as any);

  const lista = holerites.data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScreenHeader title="Portal do colaborador" onBack={() => router.back()} />

      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 6 }}>
        {SECOES.map((s) => {
          const ativa = secao === s.chave;
          return (
            <TouchableOpacity
              key={s.chave}
              onPress={() => setSecao(s.chave)}
              activeOpacity={0.85}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 9,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: ativa ? Colors.accent : Colors.card,
                borderWidth: 1,
                borderColor: ativa ? Colors.accent : Colors.border,
              }}
            >
              <Text
                style={{ fontSize: 11.5, fontWeight: '700', color: ativa ? '#fff' : Colors.textSoft }}
              >
                {s.rotulo}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={holerites.isRefetching}
            onRefresh={() => {
              holerites.refetch();
              dados.refetch();
              espelho.refetch();
              beneficios.refetch();
            }}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      >
        {/* ── Holerites ── */}
        {secao === 'holerites' && (
          <View style={{ gap: 10 }}>
            {holerites.isLoading && <ActivityIndicator color={Colors.accent} />}

            {!holerites.isLoading && lista.length === 0 && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 }}>
                  Nenhum holerite publicado para voce ainda.{'\n'}
                  Se voce recebe holerite e nada aparece aqui, sua conta de acesso pode nao estar
                  vinculada a ficha de funcionario — fale com o RH.
                </Text>
              </Card>
            )}

            {lista.map((h: any) => {
              const confirmado = !!(h.visualizado || h.confirmado || h.status === 'confirmado');
              const salvando = confirmar.isPending && confirmar.variables === h.id;
              return (
                <Card key={h.id}>
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>
                        {competenciaDe(h)}
                      </Text>
                      {h.valor_liquido != null && (
                        <Text style={{ fontSize: 12.5, color: Colors.muted, marginTop: 2 }}>
                          Liquido {moeda(h.valor_liquido)}
                        </Text>
                      )}
                    </View>
                    <StatusPill
                      label={confirmado ? 'Confirmado' : 'Novo'}
                      color={confirmado ? Colors.green : Colors.yellow}
                      bg={confirmado ? Colors.greenDim : Colors.yellowDim}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      onPress={() => abrirPortalWeb()}
                      activeOpacity={0.85}
                      style={{
                        flex: 1,
                        height: 38,
                        borderRadius: 9,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: Colors.accentDim,
                        borderWidth: 1,
                        borderColor: Colors.accent + '55',
                      }}
                    >
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: Colors.accent }}>
                        Abrir PDF
                      </Text>
                    </TouchableOpacity>

                    {!confirmado && (
                      <TouchableOpacity
                        onPress={() => confirmar.mutate(h.id)}
                        disabled={salvando}
                        activeOpacity={0.85}
                        style={{
                          flex: 1,
                          height: 38,
                          borderRadius: 9,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: Colors.card2,
                          borderWidth: 1,
                          borderColor: Colors.border,
                        }}
                      >
                        {salvando ? (
                          <ActivityIndicator size="small" color={Colors.muted} />
                        ) : (
                          <Text style={{ fontSize: 12.5, fontWeight: '700', color: Colors.textSoft }}>
                            Confirmar recebimento
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* ── Meus dados ── */}
        {secao === 'dados' && (
          <View>
            {dados.isLoading && <ActivityIndicator color={Colors.accent} />}
            {!dados.isLoading && !dados.data && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
                  Nao foi possivel carregar sua ficha.
                </Text>
              </Card>
            )}
            {dados.data && (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <Row label="Nome" value={dados.data.nome ?? '--'} />
                <Row label="Cargo" value={dados.data.cargo ?? '--'} />
                <Row label="Setor" value={dados.data.departamento ?? dados.data.setor ?? '--'} />
                <Row label="Admissao" value={dados.data.data_admissao ?? '--'} />
                <Row label="E-mail" value={dados.data.email ?? '--'} />
                <Row label="Telefone" value={dados.data.telefone ?? '--'} last />
              </Card>
            )}
          </View>
        )}

        {/* ── Espelho de ponto ── */}
        {secao === 'ponto' && (
          <View style={{ gap: 8 }}>
            {espelho.isLoading && <ActivityIndicator color={Colors.accent} />}
            {!espelho.isLoading && espelho.data?.vinculado === false && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
                  {espelho.data?.message ?? 'Você não está vinculado a um cadastro de funcionário.'}
                </Text>
              </Card>
            )}
            {!espelho.isLoading && espelho.data?.vinculado !== false && (espelho.data?.dias.length ?? 0) === 0 && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
                  Sem marcações no período.
                </Text>
              </Card>
            )}
            {(espelho.data?.dias ?? []).slice(0, 45).map((d, i) => (
              <Card key={d.data ?? i} style={{ paddingVertical: 11 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '600', color: Colors.text }}>
                    {d.data} · {d.dia}
                  </Text>
                  <Text style={{ fontSize: 12.5, color: Colors.muted }}>
                    {[d.entrada, d.saidaAlmoco, d.retornoAlmoco, d.saida]
                      .filter((h) => h && h !== '-')
                      .join('  ·  ') || '--'}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* ── Benefícios ── */}
        {secao === 'beneficios' && (
          <View style={{ gap: 8 }}>
            {beneficios.isLoading && <ActivityIndicator color={Colors.accent} />}
            {!beneficios.isLoading && (beneficios.data?.length ?? 0) === 0 && (
              <Card>
                <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center' }}>
                  Nenhum beneficio cadastrado.
                </Text>
              </Card>
            )}
            {(beneficios.data ?? []).map((b: any, i: number) => (
              <Card key={b.id ?? i}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>
                  {b.nome ?? '--'}
                </Text>
                {b.fornecedor ? (
                  <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 2 }}>{b.fornecedor}</Text>
                ) : null}
                {b.descricao ? (
                  <Text style={{ fontSize: 12.5, color: Colors.textSoft, marginTop: 6, lineHeight: 18 }}>
                    {b.descricao}
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>
        )}

        <TouchableOpacity onPress={() => abrirPortalWeb()} activeOpacity={0.8} style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 12.5, color: Colors.accent, textAlign: 'center', fontWeight: '600' }}>
            Abrir portal completo do RH
          </Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
