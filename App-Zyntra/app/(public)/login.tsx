import { useState, useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  TextInput,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth, saveCredentialsForBiometrics } from '@/lib/auth';
import { authApi } from '@/lib/api';
import {
  Colors,
  LOGIN_PRIMARY,
  COMPANIES,
  NEUTRAL_COMPANY,
  detectCompanyByEmail,
  getAvatarUrl,
  type CompanyConfig,
} from '@/lib/constants';
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { User } from '@/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── tipos ────────────────────────────────────────────────────
type TabType = 'email' | 'cpf';

interface PreviewData {
  nome?: string;
  apelido?: string;
  cargo?: string;
  departamento?: string;
  foto?: string;
  email?: string;
}

// ─── overlay de boas-vindas ───────────────────────────────────
function WelcomeOverlay({ user, visible, tint = LOGIN_PRIMARY }: { user: User | null; visible: boolean; tint?: string }) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(bgOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const displayName = user?.apelido || user?.nome?.split(' ')[0] || 'Colaborador';
  const avatarUrl = getAvatarUrl(user?.avatar || user?.foto);
  const initials = (user?.nome || displayName || 'C').split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        width: SCREEN_W, height: SCREEN_H,
        backgroundColor: 'rgba(10,16,32,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: bgOpacity,
        zIndex: 999,
      }}
    >
      <Animated.View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 20,
          paddingVertical: 36,
          paddingHorizontal: 28,
          alignItems: 'center',
          gap: 16,
          width: Math.min(SCREEN_W * 0.82, 340),
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.3,
          shadowRadius: 24,
          elevation: 20,
          transform: [{ scale }],
          opacity,
        }}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: 86, height: 86, borderRadius: 22, backgroundColor: Colors.surface }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: 86, height: 86, borderRadius: 22,
              backgroundColor: tint,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 30, fontWeight: '700', color: '#fff' }}>{initials}</Text>
          </View>
        )}

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 13, color: Colors.muted, fontWeight: '600' }}>{greeting}</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: Colors.text, letterSpacing: 0, textAlign: 'center' }}>
            Ola, {displayName}
          </Text>
        </View>

        <View
          style={{
            paddingVertical: 6,
            paddingHorizontal: 16,
            backgroundColor: Colors.greenDim,
            borderRadius: 999,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.green }}>
            Acesso liberado
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─── utilitários ─────────────────────────────────────────────
function formatCpf(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

const isCompleteEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const onlyDigits = (v: string) => v.replace(/\D/g, '');

// ─── icons inline ────────────────────────────────────────────
function IconMail({ size = 16, color = '#60708c' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="4" width="20" height="16" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function IconUser({ size = 16, color = '#60708c' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="7" r="4" stroke={color} strokeWidth="1.8" />
      <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function IconLock({ size = 16, color = '#60708c' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="11" width="18" height="11" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function IconEye({ open = true, size = 16, color = '#60708c' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {open ? (
        <>
          <Path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" stroke={color} strokeWidth="1.8" />
          <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.8" />
        </>
      ) : (
        <>
          <Path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

function IconShield({ size = 13, color = '#19295e' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" stroke={color} strokeWidth="1.8" />
    </Svg>
  );
}

function IconArrow({ size = 16, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14M12 5l7 7-7 7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconAlert({ size = 18, color = '#dc2626' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" />
      <Path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function IconCheck({ size = 13, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 6 9 17l-5-5" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ─── componente de campo ──────────────────────────────────────
interface FieldInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef?: React.RefObject<TextInput | null>;
  keyboardType?: TextInput['props']['keyboardType'];
  returnKeyType?: TextInput['props']['returnKeyType'];
  onSubmitEditing?: () => void;
  secure?: boolean;
  showPass?: boolean;
  onTogglePass?: () => void;
  leftIcon: React.ReactNode;
  rightSlot?: React.ReactNode;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  tint?: string;
}

function FieldInput({
  value, onChange, placeholder, keyboardType = 'default',
  returnKeyType = 'next', onSubmitEditing,
  secure = false, showPass, onTogglePass, inputRef,
  leftIcon, rightSlot, focused, onFocus, onBlur,
  tint = LOGIN_PRIMARY,
}: FieldInputProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 46,
        backgroundColor: Colors.card,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: focused ? tint : Colors.border,
        paddingHorizontal: 12,
        gap: 10,
        shadowColor: focused ? tint : 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: focused ? 0.12 : 0,
        shadowRadius: 8,
        elevation: focused ? 2 : 0,
      }}
    >
      {leftIcon}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.muted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        secureTextEntry={secure && !showPass}
        onFocus={onFocus}
        onBlur={onBlur}
        returnKeyType={returnKeyType}
        blurOnSubmit={false}
        onSubmitEditing={onSubmitEditing}
        editable={true}
        contextMenuHidden={false}
        selectTextOnFocus={false}
        style={{ flex: 1, minHeight: 44, fontSize: 15, color: Colors.text, padding: 0, zIndex: 2 }}
        autoCorrect={false}
      />
      {secure && onTogglePass && (
        <TouchableOpacity onPress={onTogglePass} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <IconEye open={!!showPass} size={17} color={Colors.muted} />
        </TouchableOpacity>
      )}
      {rightSlot}
    </View>
  );
}

// Fundo (SVG de tela cheia) — memoizado para NÃO re-renderizar a cada tecla
// digitada (evita lag/flicker); só re-renderiza quando a empresa detectada muda.
const LoginBackground = memo(function LoginBackground({
  primary = LOGIN_PRIMARY,
  accent = '#16b6c8',
}: { primary?: string; accent?: string }) {
  return (
    <Svg width={SCREEN_W} height={SCREEN_H} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1b2350" stopOpacity="1" />
          <Stop offset="0.5" stopColor="#0d1117" stopOpacity="1" />
          <Stop offset="1" stopColor="#0a1330" stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={SCREEN_W} height={SCREEN_H} fill="url(#bg)" />
      <Circle cx={SCREEN_W * 0.18} cy={SCREEN_H * 0.16} r={SCREEN_W * 0.5} fill={primary} opacity={0.18} />
      <Circle cx={SCREEN_W * 0.9} cy={SCREEN_H * 0.7} r={SCREEN_W * 0.45} fill={accent} opacity={0.1} />
    </Svg>
  );
});

// ─── tela principal ───────────────────────────────────────────
export default function LoginScreen() {
  const { login, loginWithBiometrics, checkBiometrics, isLoading, user } = useAuth();

  const [tab, setTab] = useState<TabType>('email');
  const [field, setField] = useState('');
  const [senha, setSenha] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [focusedField, setFocusedField] = useState<'id' | 'pw' | null>(null);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [company, setCompany] = useState<CompanyConfig>(NEUTRAL_COMPANY);
  const [welcomeUser, setWelcomeUser] = useState<User | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [searching, setSearching] = useState(false);

  const logoOpacity = useRef(new Animated.Value(1)).current;
  const idInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewReqId = useRef(0);

  useEffect(() => {
    checkBiometrics().then(setCanUseBiometrics);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, []);

  const fadeLogo = () => {
    Animated.sequence([
      Animated.timing(logoOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  // Busca o colaborador (saudação + detecção de empresa) com debounce
  const schedulePreview = (rawValue: string) => {
    const value = tab === 'cpf' ? rawValue : rawValue.trim().toLowerCase();
    const complete = tab === 'email'
      ? isCompleteEmail(value)
      : onlyDigits(value).length === 11;

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!complete) { setSearching(false); return; }

    setSearching(true);
    const reqId = ++previewReqId.current;
    searchTimer.current = setTimeout(async () => {
      const found = await authApi.previewUser(
        tab === 'email' ? { email: value } : { cpf: value }
      );
      if (reqId !== previewReqId.current) return;
      setSearching(false);
      if (!found) { setPreview(null); return; }
      setPreview(found as PreviewData);
      // detecta empresa pelo e-mail retornado (útil no modo CPF)
      if (found.email) {
        const id = detectCompanyByEmail(found.email);
        if (id) { setCompany(COMPANIES[id]); fadeLogo(); }
      }
    }, 450);
  };

  const handleFieldChange = (value: string) => {
    setErrorMsg(null);
    setPreview(null);
    const formatted = tab === 'cpf' ? formatCpf(value) : value;
    setField(formatted);

    if (tab === 'email') {
      const detected = detectCompanyByEmail(value);
      const next = detected ? COMPANIES[detected] : NEUTRAL_COMPANY;
      if (next.id !== company.id) { fadeLogo(); setCompany(next); }
    }
    schedulePreview(formatted);
  };

  const handleTabChange = (t: TabType) => {
    if (t === tab) return;
    setTab(t);
    setField('');
    setPreview(null);
    setErrorMsg(null);
    setSearching(false);
    setCompany(NEUTRAL_COMPANY);
  };

  // Resolve o e-mail para autenticar: no modo CPF usamos o preview (que devolve o e-mail),
  // pois o endpoint mobile-safe /auth/login só aceita e-mail.
  const resolveEmail = async (): Promise<string | null> => {
    if (tab === 'email') return field.trim().toLowerCase();
    if (preview?.email) return preview.email.toLowerCase();
    const found = await authApi.previewUser({ cpf: field });
    return found?.email ? String(found.email).toLowerCase() : null;
  };

  const handleLogin = async () => {
    setErrorMsg(null);
    if (!field.trim() || !senha.trim()) {
      setErrorMsg('Informe ' + (tab === 'cpf' ? 'o CPF' : 'o e-mail') + ' e a senha para continuar.');
      return;
    }

    setSubmitting(true);
    try {
      const email = await resolveEmail();
      if (!email) {
        setSubmitting(false);
        setErrorMsg('CPF nao encontrado. Verifique os dados ou entre com o e-mail corporativo.');
        return;
      }

      const credentials = { email, password: senha };
      const response = await login(credentials);

      if (response.success) {
        // "Manter-me conectado": habilita biometria neste dispositivo (se houver hardware)
        if (remember) {
          try {
            const hasHw = await LocalAuthentication.hasHardwareAsync();
            const enrolled = await LocalAuthentication.isEnrolledAsync();
            if (hasHw && enrolled) await saveCredentialsForBiometrics(credentials);
          } catch { /* opcional — não bloqueia o login */ }
        }
        setSuccess(true);
        setWelcomeUser((response.user as User) ?? (preview ? (preview as unknown as User) : null));
        setTimeout(() => router.replace('/(auth)'), 2200);
      } else {
        setSubmitting(false);
        setErrorMsg(response.message || 'Nao foi possivel entrar. Verifique suas credenciais.');
      }
    } catch (error: any) {
      setSubmitting(false);
      setErrorMsg(error?.message || 'Nao foi possivel entrar. Verifique suas credenciais.');
    }
  };

  const handleBiometricLogin = async () => {
    setErrorMsg(null);
    try {
      const response = await loginWithBiometrics();
      setWelcomeUser((response.user as User) || user);
      setSuccess(true);
      setTimeout(() => router.replace('/(auth)'), 2200);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Falha na autenticacao biometrica.');
    }
  };

  const busy = isLoading || submitting;
  // Cor primária dinâmica: acompanha a empresa detectada pelo e-mail (espelha o web)
  const primary = company.primary ?? LOGIN_PRIMARY;
  const idIconColor = focusedField === 'id' ? primary : Colors.muted;
  const previewName = preview?.nome || preview?.apelido || preview?.email;
  const previewAvatar = getAvatarUrl(preview?.foto);

  return (
    <View style={{ flex: 1, backgroundColor: '#0d1117' }}>
      {/* Fundo escuro com gradiente (memoizado — não re-renderiza ao digitar) */}
      <LoginBackground primary={primary} accent={company.accent} />

      <WelcomeOverlay user={welcomeUser} visible={success} tint={primary} />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 22, paddingVertical: 28 }}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Marca (logos brancas sobre fundo escuro) ── */}
            <Animated.View style={{ opacity: logoOpacity, alignItems: 'center', marginBottom: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                {company.brands.map((b, i) => (
                  <View key={b.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    {i > 0 && <View style={{ width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.2)' }} />}
                    <Image
                      source={b.logo}
                      style={{ height: b.padded ? 40 : 26, width: b.padded ? 96 : 84 }}
                      resizeMode="contain"
                    />
                  </View>
                ))}
              </View>
              <Text style={{ fontSize: 13, color: 'rgba(223,231,245,0.75)', textAlign: 'center' }}>
                {company.headline}
              </Text>
            </Animated.View>

            {/* ── Card do formulário ── */}
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.97)',
                borderRadius: 18,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.3)',
                padding: 20,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 18 },
                shadowOpacity: 0.32,
                shadowRadius: 40,
                elevation: 12,
                gap: 16,
              }}
            >
              {/* Badge */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 }}>
                <IconShield size={13} color={primary} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.muted }}>
                  Acesso restrito a colaboradores
                </Text>
              </View>

              {/* Título */}
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 22, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 }}>
                  Acesso ao sistema
                </Text>
                <Text style={{ fontSize: 13, color: Colors.muted, lineHeight: 19 }}>
                  Use suas credenciais corporativas para acessar o portal interno —{' '}
                  <Text style={{ color: Colors.text, fontWeight: '600' }}>{company.name}</Text>.
                </Text>
              </View>

              {/* Erro inline */}
              {errorMsg && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(220,38,38,0.24)', backgroundColor: 'rgba(254,242,242,0.95)' }}>
                  <IconAlert size={18} color={Colors.red} />
                  <Text style={{ flex: 1, fontSize: 13, color: '#991b1b', lineHeight: 18 }}>{errorMsg}</Text>
                </View>
              )}

              {/* Tabs E-mail / CPF */}
              <View style={{ flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 8, padding: 3, gap: 3 }}>
                {(['email', 'cpf'] as TabType[]).map((t) => {
                  const active = tab === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() => handleTabChange(t)}
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        paddingVertical: 8, borderRadius: 6,
                        backgroundColor: active ? Colors.card : 'transparent',
                        shadowColor: active ? '#000' : 'transparent',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: active ? 0.08 : 0,
                        shadowRadius: 3,
                        elevation: active ? 1 : 0,
                      }}
                    >
                      {t === 'email'
                        ? <IconMail size={14} color={active ? primary : Colors.muted} />
                        : <IconUser size={14} color={active ? primary : Colors.muted} />}
                      <Text style={{ fontSize: 13.5, fontWeight: '500', color: active ? Colors.text : Colors.muted }}>
                        {t === 'email' ? 'E-mail' : 'CPF'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Campo identificação */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '500', color: Colors.text }}>
                  {tab === 'email' ? 'E-mail corporativo' : 'CPF'}
                </Text>
                <FieldInput
                  value={field}
                  onChange={handleFieldChange}
                  placeholder={tab === 'email' ? 'voce@empresa.com.br' : '000.000.000-00'}
                  inputRef={idInputRef}
                  keyboardType={tab === 'email' ? 'email-address' : 'numeric'}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  leftIcon={tab === 'email' ? <IconMail size={16} color={idIconColor} /> : <IconUser size={16} color={idIconColor} />}
                  rightSlot={searching ? <ActivityIndicator size="small" color={Colors.muted} /> : undefined}
                  focused={focusedField === 'id'}
                  onFocus={() => setFocusedField('id')}
                  onBlur={() => setFocusedField(null)}
                  tint={primary}
                />
              </View>

              {/* Saudação (preview do colaborador) */}
              {previewName && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card2 }}>
                  {previewAvatar ? (
                    <Image source={{ uri: previewAvatar }} style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: Colors.surface }} resizeMode="cover" />
                  ) : (
                    <View style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                        {(preview?.nome || 'C').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: Colors.muted }}>Olá, bem-vindo(a) de volta</Text>
                    <Text style={{ fontSize: 13.5, fontWeight: '600', color: Colors.text }} numberOfLines={1}>{previewName}</Text>
                    {!!(preview?.cargo || preview?.departamento) && (
                      <Text style={{ fontSize: 11.5, color: Colors.muted }} numberOfLines={1}>
                        {preview?.cargo || preview?.departamento}
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* Campo senha */}
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '500', color: Colors.text }}>Senha</Text>
                  <TouchableOpacity onPress={() => router.push('/(public)/recuperar-senha')}>
                    <Text style={{ fontSize: 12.5, fontWeight: '500', color: primary }}>Esqueceu a senha?</Text>
                  </TouchableOpacity>
                </View>
                <FieldInput
                  value={senha}
                  onChange={(v) => { setErrorMsg(null); setSenha(v); }}
                  placeholder="Digite sua senha"
                  inputRef={passwordInputRef}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  secure
                  showPass={showPass}
                  onTogglePass={() => setShowPass((p) => !p)}
                  leftIcon={<IconLock size={16} color={focusedField === 'pw' ? primary : Colors.muted} />}
                  focused={focusedField === 'pw'}
                  onFocus={() => setFocusedField('pw')}
                  onBlur={() => setFocusedField(null)}
                  tint={primary}
                />
              </View>

              {/* Manter conectado */}
              <TouchableOpacity
                onPress={() => setRemember((r) => !r)}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
              >
                <View
                  style={{
                    width: 19, height: 19, borderRadius: 5,
                    borderWidth: 1.5,
                    borderColor: remember ? primary : Colors.border,
                    backgroundColor: remember ? primary : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {remember && <IconCheck size={12} color="#fff" />}
                </View>
                <Text style={{ fontSize: 13, color: Colors.muted }}>Manter-me conectado neste dispositivo</Text>
              </TouchableOpacity>

              {/* Botão entrar */}
              <TouchableOpacity
                onPress={handleLogin}
                disabled={busy || success}
                activeOpacity={0.88}
                style={{
                  height: 48, borderRadius: 9,
                  backgroundColor: success ? Colors.green : primary,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: busy || success ? 0.85 : 1,
                  shadowColor: primary,
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.22,
                  shadowRadius: 10,
                  elevation: 4,
                }}
              >
                <Text style={{ fontSize: 15.5, fontWeight: '700', color: '#fff', letterSpacing: 0.1 }}>
                  {busy ? 'Entrando...' : success ? 'Acesso liberado!' : 'Entrar'}
                </Text>
                {!busy && !success && <IconArrow size={16} color="#fff" />}
              </TouchableOpacity>

              {/* Biometria */}
              {canUseBiometrics && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
                    <Text style={{ fontSize: 11.5, color: Colors.muted }}>ou acesse com</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
                  </View>
                  <TouchableOpacity
                    onPress={handleBiometricLogin}
                    activeOpacity={0.8}
                    style={{ height: 44, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '500', color: Colors.textSoft }}>
                      Face ID / Touch ID
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Suporte */}
            <Text style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(223,231,245,0.7)', marginTop: 22, lineHeight: 19 }}>
              Sem acesso ou esqueceu suas credenciais?{'\n'}
              <Text style={{ color: '#fff', fontWeight: '600' }}>Abra um chamado no suporte de TI</Text>
            </Text>

            <Text style={{ textAlign: 'center', fontSize: 11, color: 'rgba(223,231,245,0.45)', marginTop: 16 }}>
              © 2026 {company.name} · Sistema interno · Uso autorizado
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
