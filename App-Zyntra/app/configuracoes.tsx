import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, setBiometricsEnabled, getBiometricsEnabled } from '@/lib/auth';
import { useBiometrics } from '@/hooks/useBiometrics';
import { ensureNotificationPermission } from '@/hooks/useNotifications';
import { Colors, APP_VERSION, APP_NAME, COMPANY_NAME, getAvatarUrl } from '@/lib/constants';
import { useTheme, ThemeMode } from '@/lib/theme';
import { loadSettings, saveSettings, resetSettings, AppSettings, DEFAULT_SETTINGS } from '@/lib/settings';
import {
  Card,
  SectionLabel,
  Toggle,
  Badge,
  Button,
  IconChevron,
  IconClose,
  IconAppearance,
  IconBell,
  IconBiometric,
  IconShield,
  IconLock,
  IconDevice,
  IconRefresh,
  IconTrash,
  IconGlobe,
  IconInfo,
  IconHelp,
} from '@/components/ui';
import type { User } from '@/types';

const SITE_URL = 'https://zyntraerp.com.br';
const SUPORTE_EMAIL = 'suporte@zyntra.com.br';

function getUserInitials(nome?: string | null) {
  if (!nome) return 'AD';
  return nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function getRoleBadge(role?: string, is_admin?: number | boolean) {
  if (is_admin) return { label: 'Super Admin', color: Colors.accent, bg: Colors.accentDim };
  switch (role) {
    case 'admin':       return { label: 'Admin',       color: Colors.accent, bg: Colors.accentDim };
    case 'gestor':      return { label: 'Gestor',      color: Colors.purple, bg: Colors.purpleDim };
    case 'vendedor':    return { label: 'Vendedor',    color: Colors.green,  bg: Colors.greenDim  };
    case 'consultoria': return { label: 'Consultoria', color: Colors.teal,   bg: Colors.tealDim   };
    default:            return { label: 'Colaborador', color: Colors.muted,  bg: Colors.surface   };
  }
}

async function openLink(url: string) {
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert('Indisponível', 'Não foi possível abrir o link neste dispositivo.');
  } catch {
    Alert.alert('Indisponível', 'Não foi possível abrir o link neste dispositivo.');
  }
}

// ── Linha de configuração com ícone à esquerda ──
function SettingRow({
  icon,
  label,
  sub,
  right,
  onPress,
  last,
  danger,
  disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const Wrapper: any = onPress && !disabled ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: Colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: Colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, color: danger ? Colors.red : Colors.textSoft, fontWeight: danger ? '600' : '400' }}>
          {label}
        </Text>
        {sub ? <Text style={{ fontSize: 11.5, color: Colors.muted, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {right ? <View pointerEvents={disabled ? 'none' : 'auto'}>{right}</View> : null}
      {onPress && !right ? <IconChevron size={13} color={Colors.muted} /> : null}
    </Wrapper>
  );
}

export default function ConfiguracoesScreen() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useTheme();
  const bio = useBiometrics();
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    getBiometricsEnabled().then(setBioOn);
  }, []);

  const u = user as User | null;
  const avatarUrl = getAvatarUrl(u?.avatar || u?.foto);
  const badge = getRoleBadge(u?.role, u?.is_admin);

  // Atualiza uma preferência e persiste imediatamente.
  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  // Ao ativar push, solicita a permissão do sistema no momento certo.
  const handleTogglePush = async () => {
    const next = !settings.notifPush;
    if (next) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        Alert.alert(
          'Permissao necessaria',
          'Para receber alertas, ative as notificacoes para o Zyntra nas configuracoes do seu dispositivo.'
        );
        return;
      }
    }
    update({ notifPush: next });
  };

  const handleBioToggle = async () => {
    const next = !bioOn;
    setBioOn(next);
    await setBiometricsEnabled(next);
    if (!next) update({ appLock: false });
  };

  const handleSync = () => {
    queryClient.invalidateQueries();
    Alert.alert('Sincronização', 'Seus dados estão sendo atualizados a partir do servidor.');
  };

  const handleClearCache = () => {
    Alert.alert('Limpar cache', 'Os dados em cache serão removidos. Os dados serão recarregados do servidor na próxima abertura.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Limpar',
        style: 'destructive',
        onPress: () => {
          queryClient.clear();
          Alert.alert('Pronto', 'Cache limpo com sucesso.');
        },
      },
    ]);
  };

  const handleReset = () => {
    Alert.alert('Restaurar padrões', 'Todas as preferências do app voltarão ao padrão de fábrica. Deseja continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Restaurar',
        style: 'destructive',
        onPress: async () => {
          const def = await resetSettings();
          setSettings(def);
          Alert.alert('Pronto', 'Preferências restauradas.');
        },
      },
    ]);
  };

  const handleChangePassword = () => {
    Alert.alert('Alterar senha', 'Por segurança, a alteração de senha é feita na versão web do Zyntra.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abrir web', onPress: () => openLink(SITE_URL) },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Sair da conta', 'Tem certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(public)/login');
        },
      },
    ]);
  };

  // Controle de tema segmentado
  const ThemeOption = ({ value, label }: { value: ThemeMode; label: string }) => {
    const active = mode === value;
    return (
      <TouchableOpacity
        onPress={() => setMode(value)}
        activeOpacity={0.85}
        style={{
          flex: 1,
          height: 42,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? Colors.accent : Colors.surface,
          borderWidth: 1,
          borderColor: active ? Colors.accent : Colors.border,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : Colors.textSoft }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const muted = Colors.mutedLight;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top', 'bottom']}>
      {/* ── Header do modal ── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 18,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>Configurações</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            backgroundColor: Colors.card,
            borderWidth: 1,
            borderColor: Colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconClose size={18} color={Colors.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 14 }} showsVerticalScrollIndicator={false}>
        {/* ── Conta ── */}
        <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={{ width: 54, height: 54, borderRadius: 15, backgroundColor: Colors.surface, borderWidth: 2, borderColor: Colors.border }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 15,
                backgroundColor: Colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: Colors.accentDim,
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#fff' }}>{getUserInitials(u?.nome)}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.text }}>{u?.nome ?? 'Usuário'}</Text>
            <Text style={{ fontSize: 12.5, color: Colors.muted, marginTop: 2 }}>{u?.email ?? ''}</Text>
            <View style={{ marginTop: 6, flexDirection: 'row' }}>
              <Badge label={badge.label} color={badge.color} bg={badge.bg} />
            </View>
          </View>
        </Card>

        {/* ── Aparência ── */}
        <View>
          <SectionLabel text="Aparencia" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <View style={{ padding: 14, paddingHorizontal: 16, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                  <IconAppearance size={18} color={muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, color: Colors.textSoft }}>Tema do app</Text>
                  <Text style={{ fontSize: 11.5, color: Colors.muted, marginTop: 1 }}>Escolha claro ou escuro</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ThemeOption value="light" label="Claro" />
                <ThemeOption value="dark" label="Escuro" />
              </View>
            </View>
          </Card>
        </View>

        {/* ── Notificações ── */}
        <View>
          <SectionLabel text="Notificacoes" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <SettingRow
              icon={<IconBell size={18} color={muted} />}
              label="Notificacoes push"
              sub="Receber alertas no dispositivo"
              right={<Toggle value={settings.notifPush} onToggle={handleTogglePush} />}
            />
            <SettingRow
              label="Som"
              sub="Tocar som ao notificar"
              right={<Toggle value={settings.notifSom} onToggle={() => update({ notifSom: !settings.notifSom })} />}
              disabled={!settings.notifPush}
            />
            <SettingRow
              label="Vibracao"
              sub="Vibrar ao notificar"
              right={<Toggle value={settings.notifVibracao} onToggle={() => update({ notifVibracao: !settings.notifVibracao })} />}
              disabled={!settings.notifPush}
              last
            />
          </Card>

          {settings.notifPush && (
            <>
              <View style={{ height: 10 }} />
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <SettingRow
                  label="Financeiro"
                  sub="Contas, fluxo de caixa"
                  right={<Toggle value={settings.notifFinanceiro} onToggle={() => update({ notifFinanceiro: !settings.notifFinanceiro })} />}
                />
                <SettingRow
                  label="Vendas"
                  sub="Pedidos, metas, funil"
                  right={<Toggle value={settings.notifVendas} onToggle={() => update({ notifVendas: !settings.notifVendas })} />}
                />
                <SettingRow
                  label="Producao (PCP)"
                  sub="Ordens de producao"
                  right={<Toggle value={settings.notifProducao} onToggle={() => update({ notifProducao: !settings.notifProducao })} />}
                />
                <SettingRow
                  label="RH"
                  sub="Ponto, holerite, ferias"
                  right={<Toggle value={settings.notifRh} onToggle={() => update({ notifRh: !settings.notifRh })} />}
                />
                <SettingRow
                  label="Logistica"
                  sub="Entregas e rotas"
                  right={<Toggle value={settings.notifLogistica} onToggle={() => update({ notifLogistica: !settings.notifLogistica })} />}
                  last
                />
              </Card>
            </>
          )}
        </View>

        {/* ── Segurança ── */}
        <View>
          <SectionLabel text="Seguranca" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {bio.isAvailable && (
              <SettingRow
                icon={<IconBiometric size={18} color={muted} />}
                label={bio.getBiometricLabel()}
                sub={bio.isEnrolled ? 'Login com biometria' : 'Cadastre a biometria no dispositivo'}
                right={<Toggle value={bioOn} onToggle={handleBioToggle} />}
                disabled={!bio.isEnrolled}
              />
            )}
            <SettingRow
              icon={<IconLock size={18} color={muted} />}
              label="Bloqueio automatico"
              sub="Exigir biometria ao reabrir o app"
              right={<Toggle value={settings.appLock} onToggle={() => update({ appLock: !settings.appLock })} />}
              disabled={!bioOn}
            />
            <SettingRow
              icon={<IconShield size={18} color={muted} />}
              label="Alterar senha"
              sub="Gerenciar sua senha de acesso"
              onPress={handleChangePassword}
            />
            <SettingRow
              icon={<IconDevice size={18} color={muted} />}
              label="Este dispositivo"
              sub={`${Platform.OS === 'ios' ? 'iOS' : 'Android'} • Sessao ativa`}
              last
            />
          </Card>
        </View>

        {/* ── Dados e Armazenamento ── */}
        <View>
          <SectionLabel text="Dados e armazenamento" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <SettingRow
              label="Sincronizar somente em Wi-Fi"
              sub="Economiza dados moveis"
              right={<Toggle value={settings.wifiOnly} onToggle={() => update({ wifiOnly: !settings.wifiOnly })} />}
            />
            <SettingRow
              icon={<IconRefresh size={18} color={muted} />}
              label="Sincronizar agora"
              sub="Atualizar dados do servidor"
              onPress={handleSync}
            />
            <SettingRow
              icon={<IconTrash size={18} color={muted} />}
              label="Limpar cache"
              sub="Remover dados temporarios"
              onPress={handleClearCache}
              last
            />
          </Card>
        </View>

        {/* ── Geral ── */}
        <View>
          <SectionLabel text="Geral" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <SettingRow icon={<IconGlobe size={18} color={muted} />} label="Idioma" right={<Text style={{ fontSize: 14, color: Colors.muted }}>Portugues (BR)</Text>} />
            <SettingRow label="Empresa" right={<Text style={{ fontSize: 14, color: Colors.muted }}>{COMPANY_NAME}</Text>} />
            <SettingRow
              label="Restaurar padroes"
              sub="Voltar preferencias ao padrao"
              onPress={handleReset}
              last
            />
          </Card>
        </View>

        {/* ── Sobre ── */}
        <View>
          <SectionLabel text="Sobre" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <SettingRow icon={<IconInfo size={18} color={muted} />} label="Versao do app" right={<Text style={{ fontSize: 14, color: Colors.muted }}>{APP_NAME} {APP_VERSION}</Text>} />
            <SettingRow icon={<IconHelp size={18} color={muted} />} label="Central de ajuda" sub="Fale com o suporte" onPress={() => openLink(`mailto:${SUPORTE_EMAIL}`)} />
            <SettingRow label="Termos de uso" onPress={() => openLink(`${SITE_URL}/termos-de-uso.html`)} />
            <SettingRow label="Politica de privacidade" onPress={() => openLink(`${SITE_URL}/politica-de-privacidade.html`)} last />
          </Card>
        </View>

        {/* ── Sair ── */}
        <Button variant="danger" onPress={handleLogout}>
          Sair da conta
        </Button>

        <Text style={{ textAlign: 'center', fontSize: 11, color: Colors.muted, paddingBottom: 4 }}>
          © 2026 {APP_NAME} — Agencia do Japa
        </Text>
        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
