import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from './secure-store';
import { Colors } from './constants';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'zyntra_theme_mode';

const lightColors = {
  bg: '#f3f5f9',
  surface: '#eaecf3',
  card: '#ffffff',
  card2: '#f0f2f7',
  border: '#dbe0ea',
  borderLight: '#e8ecf3',
  accent: '#19295e',
  accentDim: 'rgba(25,41,94,0.10)',
  accentGlow: 'rgba(25,41,94,0.06)',
  text: '#18213a',
  textSoft: '#344060',
  muted: '#60708c',
  mutedLight: '#8898b4',
  green: '#16a34a',
  greenDim: 'rgba(22,163,74,0.12)',
  red: '#dc2626',
  redDim: 'rgba(220,38,38,0.10)',
  yellow: '#d97706',
  yellowDim: 'rgba(217,119,6,0.12)',
  purple: '#7c3aed',
  purpleDim: 'rgba(124,58,237,0.12)',
  teal: '#0d9488',
  tealDim: 'rgba(13,148,136,0.12)',
  orange: '#ea580c',
  orangeDim: 'rgba(234,88,12,0.12)',
};

const darkColors = {
  bg: '#0f172a',
  surface: '#182235',
  card: '#111c2f',
  card2: '#17243a',
  border: '#26344c',
  borderLight: '#30415d',
  accent: '#8fb3ff',
  accentDim: 'rgba(143,179,255,0.16)',
  accentGlow: 'rgba(143,179,255,0.10)',
  text: '#eef4ff',
  textSoft: '#c9d6ea',
  muted: '#8fa1bb',
  mutedLight: '#a8b7cd',
  green: '#4ade80',
  greenDim: 'rgba(74,222,128,0.14)',
  red: '#fb7185',
  redDim: 'rgba(251,113,133,0.14)',
  yellow: '#fbbf24',
  yellowDim: 'rgba(251,191,36,0.15)',
  purple: '#c084fc',
  purpleDim: 'rgba(192,132,252,0.15)',
  teal: '#2dd4bf',
  tealDim: 'rgba(45,212,191,0.15)',
  orange: '#fb923c',
  orangeDim: 'rgba(251,146,60,0.15)',
};

function applyTheme(mode: ThemeMode) {
  Object.assign(Colors, mode === 'dark' ? darkColors : lightColors);
}

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  colors: typeof Colors;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(THEME_KEY).then((saved) => {
      const nextMode: ThemeMode = saved === 'dark' ? 'dark' : 'light';
      applyTheme(nextMode);
      if (mounted) setModeState(nextMode);
    });
    return () => { mounted = false; };
  }, []);

  const setMode = async (nextMode: ThemeMode) => {
    applyTheme(nextMode);
    setModeState(nextMode);
    await SecureStore.setItemAsync(THEME_KEY, nextMode);
  };

  const value = useMemo(() => ({ mode, setMode, colors: Colors }), [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
