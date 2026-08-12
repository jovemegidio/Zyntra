import { View, Text, ScrollView, TouchableOpacity, Alert, Image, RefreshControl, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { Colors, MODULES, APP_VERSION, COMPANY_NAME, getAvatarUrl, canAccessModule } from '@/lib/constants';
import { Card, SectionLabel, Row, Badge, Button, IconChevron, IconSettings } from '@/components/ui';
import type { User } from '@/types';

function getUserInitials(nome?: string | null) {
  if (!nome) return 'AD';
  return nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function getRoleBadge(role?: string, is_admin?: number | boolean) {
  if (is_admin) return { label: 'Super Admin', color: Colors.accent, bg: Colors.accentDim };
  switch (role) {
    case 'admin':    return { label: 'Admin',       color: Colors.accent,  bg: Colors.accentDim };
    case 'gestor':   return { label: 'Gestor',      color: Colors.purple,  bg: Colors.purpleDim };
    case 'vendedor': return { label: 'Vendedor',    color: Colors.green,   bg: Colors.greenDim  };
    case 'consultoria': return { label: 'Consultoria', color: Colors.teal, bg: Colors.tealDim  };
    default:         return { label: 'Colaborador', color: Colors.muted,   bg: Colors.surface   };
  }
}

function fmtLastLogin(dt?: string | null) {
  if (!dt) return null;
  try {
    return new Date(dt).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

export default function PerfilScreen() {
  const { user: authUser, logout } = useAuth();

  // Busca perfil fresco da API a cada abertura da tela
  const { data: freshUser, isLoading, refetch, isRefetching } = useQuery<User>({
    queryKey: ['perfil', 'me'],
    queryFn: async () => {
      const res = await authApi.getProfile();
      // /me retorna o user diretamente
      return (res?.id ? res : res?.user) as User;
    },
    enabled: !!authUser,
    retry: 1,
  });

  // Usa dados frescos se disponível, senão usa os do contexto
  const user: User | null = freshUser ?? authUser;
  const avatarUrl = getAvatarUrl(user?.avatar || user?.foto);
  const badge = getRoleBadge(user?.role, user?.is_admin);
  const modulosAcesso = MODULES.filter((m) => canAccessModule(m, user));

  const handleLogout = () => {
    Alert.alert('Sair da conta', 'Tem certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair', style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(public)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>
          Perfil
        </Text>
      </View>

      {isLoading && !user ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 14 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={Colors.accent}
              colors={[Colors.accent]}
            />
          }
        >
          {/* ── Avatar + dados ── */}
          <Card style={{ padding: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {/* Foto do usuário */}
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={{
                  width: 60, height: 60, borderRadius: 16,
                  backgroundColor: Colors.surface,
                  borderWidth: 2, borderColor: Colors.border,
                }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  width: 60, height: 60, borderRadius: 16,
                  backgroundColor: Colors.accent,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: Colors.accentDim,
                }}
              >
                <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff' }}>
                  {getUserInitials(user?.nome)}
                </Text>
              </View>
            )}

            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.text }}>
                {user?.nome ?? 'Carregando...'}
              </Text>
              <Text style={{ fontSize: 13, color: Colors.muted, marginTop: 2 }}>
                {user?.email ?? ''}
              </Text>
              <View style={{ marginTop: 6 }}>
                <Badge label={badge.label} color={badge.color} bg={badge.bg} />
              </View>
            </View>
            <IconChevron size={14} color={Colors.muted} />
          </Card>

          {/* ── Configuracoes do sistema ── */}
          <TouchableOpacity onPress={() => router.push('/configuracoes')} activeOpacity={0.7}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingHorizontal: 16 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.accentDim, alignItems: 'center', justifyContent: 'center' }}>
                  <IconSettings size={18} color={Colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '600', color: Colors.text }}>Configuracoes do sistema</Text>
                  <Text style={{ fontSize: 11.5, color: Colors.muted, marginTop: 1 }}>Tema, notificacoes, seguranca e mais</Text>
                </View>
                <IconChevron size={14} color={Colors.muted} />
              </View>
            </Card>
          </TouchableOpacity>

          {/* ── Conta ── */}
          <View>
            <SectionLabel text="Conta" />
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <Row label="Empresa"    value={COMPANY_NAME} />
              {user?.setor     ? <Row label="Setor / Depto."  value={user.setor} /> : null}
              {user?.telefone  ? <Row label="Telefone"        value={user.telefone} /> : null}
              {user?.ultimo_login ? (
                <Row label="Último acesso" value={fmtLastLogin(user.ultimo_login) ?? '--'} />
              ) : null}
              <Row label="Versão do app" value={APP_VERSION} />
              <Row
                label="Alterar senha"
                onPress={() => Alert.alert('Alterar senha', 'Acesse a versão web do Zyntra para alterar sua senha.')}
                right={<IconChevron size={13} color={Colors.muted} />}
                last
              />
            </Card>
          </View>

          {/* ── Bio ── */}
          {user?.bio ? (
            <View>
              <SectionLabel text="Bio" />
              <Card>
                <Text style={{ fontSize: 13.5, color: Colors.textSoft, lineHeight: 20 }}>{user.bio}</Text>
              </Card>
            </View>
          ) : null}

          {/* ── Módulos ── */}
          {modulosAcesso.length > 0 && (
            <View>
              <SectionLabel text="Acesso a Modulos" />
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {modulosAcesso.map((m, i) => (
                  <View
                    key={m.id}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      padding: 13, paddingHorizontal: 16,
                      borderBottomWidth: i < modulosAcesso.length - 1 ? 1 : 0,
                      borderBottomColor: Colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 14, color: Colors.textSoft }}>{m.label}</Text>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
                  </View>
                ))}
              </Card>
            </View>
          )}

          <Button variant="danger" onPress={handleLogout}>Sair da conta</Button>

          <Text style={{ textAlign: 'center', fontSize: 11, color: Colors.muted, paddingBottom: 4 }}>
            © 2026 Zyntra — Agencia do Japa
          </Text>
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
