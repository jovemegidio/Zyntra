import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Svg, { Path, Circle, Rect, Polyline, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '@/lib/constants';

// ═══════════════════════════════════════════════════════════════
// CARD COMPONENT
// ═══════════════════════════════════════════════════════════════
interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export function Card({ children, style, onPress }: CardProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={[styles.card, style]}
    >
      {children}
    </Wrapper>
  );
}

// ═══════════════════════════════════════════════════════════════
// BUTTON COMPONENT
// ═══════════════════════════════════════════════════════════════
interface ButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
}: ButtonProps) {
  const getVariantStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.buttonSecondary;
      case 'danger':
        return styles.buttonDanger;
      case 'ghost':
        return styles.buttonGhost;
      default:
        return styles.buttonPrimary;
    }
  };

  const getTextStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.buttonTextSecondary;
      case 'ghost':
        return styles.buttonTextGhost;
      default:
        return styles.buttonTextPrimary;
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[styles.button, getVariantStyle(), disabled && styles.buttonDisabled, style]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={[styles.buttonText, getTextStyle(), textStyle]}>{children}</Text>
      )}
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════
// INPUT COMPONENT
// ═══════════════════════════════════════════════════════════════
interface InputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  style?: ViewStyle;
  rightElement?: React.ReactNode;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'none',
  style,
  rightElement,
}: InputProps) {
  return (
    <View style={[styles.inputContainer, style]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.input, rightElement ? { paddingRight: 48 } : undefined]}
      />
      {rightElement && <View style={styles.inputRight}>{rightElement}</View>}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// BADGE COMPONENT
// ═══════════════════════════════════════════════════════════════
interface BadgeProps {
  label: string;
  color: string;
  bg: string;
  size?: number;
}

export function Badge({ label, color, bg, size = 11 }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color, fontSize: size }]}>{label}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATUS PILL COMPONENT
// ═══════════════════════════════════════════════════════════════
interface StatusPillProps {
  label: string;
  color: string;
  bg: string;
}

export function StatusPill({ label, color, bg }: StatusPillProps) {
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color }]}>{label}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECTION LABEL COMPONENT
// ═══════════════════════════════════════════════════════════════
interface SectionLabelProps {
  text: string;
}

export function SectionLabel({ text }: SectionLabelProps) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

// ═══════════════════════════════════════════════════════════════
// ROW COMPONENT
// ═══════════════════════════════════════════════════════════════
interface RowProps {
  label: string;
  value?: string;
  valueColor?: string;
  sub?: string;
  last?: boolean;
  onPress?: () => void;
  right?: React.ReactNode;
}

export function Row({ label, value, valueColor, sub, last, onPress, right }: RowProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, !last && styles.rowBorder]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      <View style={styles.rowRight}>
        {value && (
          <Text style={[styles.rowValue, valueColor && { color: valueColor }]}>{value}</Text>
        )}
        {right}
        {onPress && <IconChevron size={13} color={Colors.muted} />}
      </View>
    </Wrapper>
  );
}

// ═══════════════════════════════════════════════════════════════
// SPARKLINE COMPONENT
// ═══════════════════════════════════════════════════════════════
interface SparkLineProps {
  data: number[];
  color: string;
  height?: number;
  width?: number;
}

export function SparkLine({ data, color, height = 36, width = 90 }: SparkLineProps) {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 6) - 3}`)
    .join(' ');

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// KPI CARD COMPONENT
// ═══════════════════════════════════════════════════════════════
interface KPICardProps {
  title: string;
  value: string;
  sub?: string;
  change?: string;
  up?: boolean;
  color: string;
  spark?: number[];
  style?: ViewStyle;
}

export function KPICard({ title, value, sub, change, up, color, spark, style }: KPICardProps) {
  return (
    <Card style={[styles.kpiCard, style]}>
      <Text style={styles.kpiTitle}>{title}</Text>
      <View style={styles.kpiContent}>
        <View style={styles.kpiLeft}>
          <Text style={styles.kpiValue}>{value}</Text>
          {sub && <Text style={styles.kpiSub}>{sub}</Text>}
          {change && (
            <View style={styles.kpiChange}>
              {up ? (
                <IconTrendUp size={11} color={Colors.green} />
              ) : (
                <IconTrendDown size={11} color={Colors.red} />
              )}
              <Text style={[styles.kpiChangeText, { color: up ? Colors.green : Colors.red }]}>
                {change}
              </Text>
            </View>
          )}
        </View>
        {spark && <SparkLine data={spark} color={color} height={34} width={80} />}
      </View>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// SCREEN HEADER COMPONENT
// ═══════════════════════════════════════════════════════════════
interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  return (
    <View style={styles.screenHeader}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <IconBack size={18} color={Colors.accent} />
          <Text style={styles.backText}>Voltar</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSpacer} />
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// TOGGLE COMPONENT
// ═══════════════════════════════════════════════════════════════
interface ToggleProps {
  value: boolean;
  onToggle: () => void;
}

export function Toggle({ value, onToggle }: ToggleProps) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.8}
      style={[styles.toggle, value && styles.toggleActive]}
    >
      <View style={[styles.toggleThumb, value && styles.toggleThumbActive]} />
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════
interface IconProps {
  size?: number;
  color?: string;
}

export function IconHome({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12L12 3l9 9v9h-6v-5H9v5H3v-9z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconGrid({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="8" height="8" rx="2" stroke={color} strokeWidth="1.8" />
      <Rect x="13" y="3" width="8" height="8" rx="2" stroke={color} strokeWidth="1.8" />
      <Rect x="3" y="13" width="8" height="8" rx="2" stroke={color} strokeWidth="1.8" />
      <Rect x="13" y="13" width="8" height="8" rx="2" stroke={color} strokeWidth="1.8" />
    </Svg>
  );
}

export function IconBell({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 10c0-3.314 2.686-6 6-6s6 2.686 6 6v4l2 2H4l2-2v-4z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <Path d="M10 20h4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconUser({ size = 22, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.8" />
      <Path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconBack({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconChevron({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconSearch({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth="1.8" />
      <Path d="M16.5 16.5L21 21" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconPlus({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconFilter({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18M7 12h10M10 18h4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconTrendUp({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 17l6-6 4 4 8-8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconTrendDown({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 7l6 6 4-4 8 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconEye({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z" stroke={color} strokeWidth="1.7" />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.7" />
    </Svg>
  );
}

export function IconBiometric({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="11" width="8" height="10" rx="1.5" stroke={color} strokeWidth="1.7" />
      <Rect x="3" y="5" width="8" height="5" rx="1.5" stroke={color} strokeWidth="1.7" />
      <Rect x="13" y="5" width="8" height="16" rx="1.5" stroke={color} strokeWidth="1.7" />
    </Svg>
  );
}

export function IconSettings({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.7" />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconClose({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 6L6 18M6 6l12 12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconShield({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2l8 3.5v5.5c0 4.7-3.2 8.1-8 9.5-4.8-1.4-8-4.8-8-9.5V5.5L12 2z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <Path d="M9 12l2 2 4-4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconLock({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="11" width="16" height="10" rx="2" stroke={color} strokeWidth="1.7" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}

export function IconAppearance({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <Path d="M12 3a9 9 0 0 0 0 18V3z" fill={color} />
    </Svg>
  );
}

export function IconInfo({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <Path d="M12 16v-5M12 8h.01" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconTrash({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M10 11v6M14 11v6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}

export function IconRefresh({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21 4v6h-6" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 20v-6h6" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M19 9a8 8 0 0 0-13.5-3L3 8m0 7a8 8 0 0 0 13.5 3L21 14"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconGlobe({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <Path d="M3 12h18" stroke={color} strokeWidth="1.7" />
      <Path d="M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" stroke={color} strokeWidth="1.7" />
    </Svg>
  );
}

export function IconHelp({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <Path d="M9.6 9a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6M12 17h.01" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconLogout({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 17l5-5-5-5M21 12H9" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconDevice({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="7" y="2" width="10" height="20" rx="2.5" stroke={color} strokeWidth="1.7" />
      <Path d="M11 18h2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODULE ICONS
// ═══════════════════════════════════════════════════════════════
export function ModuleIcon({ id, size = 20, color }: { id: string; size?: number; color?: string }) {
  const icons: Record<string, React.ReactElement> = {
    financeiro: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
        <Path
          d="M12 7v1m0 8v1M9.5 9.5c0-1 1.1-1.5 2.5-1.5s2.5.7 2.5 1.8c0 1-1 1.7-2.5 1.7S9.5 12.2 9.5 13.2c0 1.1 1.1 1.8 2.5 1.8s2.5-.5 2.5-1.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </Svg>
    ),
    vendas: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M3 17l5-5 4 4 9-9" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M14 7h5v5" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    ),
    rh: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="9" cy="7" r="3.5" stroke={color} strokeWidth="1.7" />
        <Path d="M2 19c0-3.5 3.1-6 7-6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        <Circle cx="17" cy="8" r="2.5" stroke={color} strokeWidth="1.6" />
        <Path d="M22 19c0-2.8-2.2-5-5-5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      </Svg>
    ),
    pcp: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.8" />
        <Path
          d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </Svg>
    ),
    logistica: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="1" y="8" width="14" height="10" rx="2" stroke={color} strokeWidth="1.7" />
        <Path d="M15 12h4l3 4v2h-7V12z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
        <Circle cx="5.5" cy="19.5" r="1.5" stroke={color} strokeWidth="1.5" />
        <Circle cx="17.5" cy="19.5" r="1.5" stroke={color} strokeWidth="1.5" />
      </Svg>
    ),
    faturamento: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
          stroke={color}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <Path d="M14 2v6h6M9 13h6M9 17h4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </Svg>
    ),
    compras: (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6z"
          stroke={color}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <Path d="M3 6h18M16 10a4 4 0 0 1-8 0" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      </Svg>
    ),
  };

  return icons[id] || null;
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // Card
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },

  // Button
  button: {
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: Colors.accent,
  },
  buttonSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonDanger: {
    backgroundColor: Colors.redDim,
    borderWidth: 1,
    borderColor: `${Colors.red}44`,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    color: '#fff',
  },
  buttonTextSecondary: {
    color: Colors.textSoft,
  },
  buttonTextGhost: {
    color: Colors.accent,
  },

  // Input
  inputContainer: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 13,
    position: 'relative',
  },
  input: {
    padding: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: Colors.text,
  },
  inputRight: {
    position: 'absolute',
    right: 14,
    top: '50%',
    transform: [{ translateY: -9 }],
  },

  // Badge
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  badgeText: {
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Status Pill
  statusPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Section Label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingLeft: 2,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLeft: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 14,
    color: Colors.textSoft,
  },
  rowSub: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },

  // KPI Card
  kpiCard: {
    padding: 14,
  },
  kpiTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  kpiContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  kpiLeft: {
    flex: 1,
  },
  kpiValue: {
    fontSize: 21,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 24,
  },
  kpiSub: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
  kpiChange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  kpiChangeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Screen Header
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 50,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.accent,
  },
  headerSpacer: {
    width: 60,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  headerRight: {
    width: 60,
    alignItems: 'flex-end',
  },

  // Toggle
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.border,
    padding: 3,
  },
  toggleActive: {
    backgroundColor: Colors.accent,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleThumbActive: {
    transform: [{ translateX: 18 }],
  },
});
