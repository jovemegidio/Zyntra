import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { notificacoesApi } from '@/lib/api';
import { Colors, MODULES } from '@/lib/constants';
import { Badge, ModuleIcon } from '@/components/ui';

// ─── helpers ─────────────────────────────────────────────────
function getModuleLabel(moduleId?: string) {
  if (!moduleId) return 'Sistema';
  const mod = MODULES.find((m) => m.id === moduleId);
  return mod?.label ?? moduleId.charAt(0).toUpperCase() + moduleId.slice(1);
}

function getModuleColor(moduleId?: string) {
  const mod = MODULES.find((m) => m.id === moduleId);
  return mod?.color ?? Colors.muted;
}

function tipoColor(tipo?: string) {
  switch (tipo) {
    case 'error':   case 'danger':  return Colors.red;
    case 'warning':                 return Colors.yellow;
    case 'success':                 return Colors.green;
    default:                        return Colors.accent;
  }
}

function fmtTime(dateStr?: string) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1)   return 'Agora';
    if (min < 60)  return `${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch { return ''; }
}

// ─── tipos locais ────────────────────────────────────────────
interface Alerta {
  id?: string | number;
  modulo?: string;
  tipo?: string;
  titulo: string;
  mensagem?: string;
  link?: string;
}

interface Notificacao {
  id: number;
  tipo?: string;
  titulo: string;
  mensagem?: string;
  lida: boolean | number;
  referencia_tipo?: string;
  created_at?: string;
}

// ─── item de alerta (vem de /dashboard/alertas) ──────────────
function AlertaItem({ item }: { item: Alerta }) {
  const color = tipoColor(item.tipo);
  const modColor = getModuleColor(item.modulo);
  return (
    <View
      style={{
        backgroundColor: Colors.card,
        borderWidth: 1,
        borderColor: Colors.border,
        borderRadius: 14,
        padding: 13,
        paddingHorizontal: 14,
        flexDirection: 'row',
        gap: 12,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: color + '18',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ModuleIcon id={item.modulo ?? 'sistema'} size={17} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>{item.titulo}</Text>
        {item.mensagem ? (
          <Text style={{ fontSize: 12, color: Colors.muted, lineHeight: 17, marginTop: 2 }}>{item.mensagem}</Text>
        ) : null}
        <View style={{ marginTop: 5 }}>
          <Badge
            label={getModuleLabel(item.modulo)}
            color={modColor}
            bg={modColor + '18'}
          />
        </View>
      </View>
    </View>
  );
}

// ─── item de notificação pessoal ──────────────────────────────
function NotifItem({ item, onRead }: { item: Notificacao; onRead: () => void }) {
  const unread = !item.lida;
  const color = tipoColor(item.tipo);
  const modColor = getModuleColor(item.referencia_tipo);
  return (
    <TouchableOpacity
      onPress={onRead}
      activeOpacity={0.7}
      style={{
        backgroundColor: unread ? Colors.card2 : Colors.card,
        borderWidth: 1,
        borderColor: unread ? Colors.borderLight : Colors.border,
        borderRadius: 14,
        padding: 13, paddingHorizontal: 14,
        flexDirection: 'row',
        gap: 12,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: color + '18',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ModuleIcon id={item.referencia_tipo ?? 'sistema'} size={17} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.text, flex: 1 }}>{item.titulo}</Text>
          <Text style={{ fontSize: 11, color: Colors.muted, marginLeft: 8 }}>{fmtTime(item.created_at)}</Text>
        </View>
        {item.mensagem ? (
          <Text style={{ fontSize: 12, color: Colors.muted, lineHeight: 17 }}>{item.mensagem}</Text>
        ) : null}
        <View style={{ marginTop: 5 }}>
          <Badge
            label={getModuleLabel(item.referencia_tipo)}
            color={modColor}
            bg={modColor + '18'}
          />
        </View>
      </View>
      {unread && (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent, marginTop: 4 }} />
      )}
    </TouchableOpacity>
  );
}

// ─── tela principal ───────────────────────────────────────────
export default function NotificacoesScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Alertas do sistema (contas vencidas, pedidos, etc.) — usa /dashboard/alertas com auth
  const {
    data: alertas = [],
    isLoading: alertasLoading,
    refetch: refetchAlertas,
    isRefetching: alertasRefetching,
  } = useQuery<Alerta[]>({
    queryKey: ['notificacoes', 'alertas'],
    queryFn: () => notificacoesApi.getAlertas(),
    retry: 1,
  });

  // Notificações pessoais do usuário — passa usuario_id explicitamente
  const {
    data: notifs = [],
    isLoading: notifsLoading,
    refetch: refetchNotifs,
    isRefetching: notifsRefetching,
  } = useQuery<Notificacao[]>({
    queryKey: ['notificacoes', 'pessoais', user?.id],
    queryFn: () => notificacoesApi.getAll({ limit: 30, usuario_id: user?.id }),
    enabled: !!user?.id,
    retry: 1,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificacoesApi.markAsRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notificacoes', 'pessoais'] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificacoesApi.markAllAsRead(user?.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notificacoes', 'pessoais'] }),
  });

  const isRefreshing = alertasRefetching || notifsRefetching;
  const handleRefresh = () => { refetchAlertas(); refetchNotifs(); };

  const unreadCount = notifs.filter((n) => !n.lida).length;
  const hasAlertas = alertas.length > 0;
  const hasNotifs = notifs.length > 0;
  const isLoading = alertasLoading || notifsLoading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>
            Notificacoes
          </Text>
          <Text style={{ fontSize: 13, color: Colors.muted, marginTop: 2 }}>
            {unreadCount > 0 ? `${unreadCount} nao lidas` : alertas.length > 0 ? `${alertas.length} alerta(s)` : 'Sem pendencias'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            style={{
              borderWidth: 1, borderColor: Colors.border,
              borderRadius: 9, paddingVertical: 6, paddingHorizontal: 12,
            }}
          >
            <Text style={{ fontSize: 12, color: Colors.accent, fontWeight: '500' }}>Marcar lidas</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingTop: 4 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.accent} colors={[Colors.accent]} />
          }
        >
          {/* Alertas do sistema */}
          {hasAlertas && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                Alertas do sistema
              </Text>
              {alertas.map((a, i) => (
                <AlertaItem key={a.id ?? i} item={a} />
              ))}
            </View>
          )}

          {/* Notificações pessoais */}
          {hasNotifs ? (
            <View>
              {hasAlertas && (
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  Suas notificacoes
                </Text>
              )}
              {notifs.map((n) => (
                <NotifItem
                  key={n.id}
                  item={n}
                  onRead={() => !n.lida && markReadMutation.mutate(n.id)}
                />
              ))}
            </View>
          ) : !hasAlertas ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.text }}>Tudo em dia!</Text>
              <Text style={{ fontSize: 13, color: Colors.muted, marginTop: 4 }}>Nenhuma notificacao pendente</Text>
            </View>
          ) : null}

          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
