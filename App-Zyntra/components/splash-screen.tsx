import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { APP_VERSION } from '@/lib/constants';

// ─── Paleta do splash (variante escura — espelha o ícone do app) ───
const SPLASH = {
  bgTop: '#0b1020',
  bgBottom: '#090c14',
  light: '#eef2f9',
  lightDim: '#c3cbdc',
  blue: '#3b82f6',
  muted: '#6b7894',
  ring: 'rgba(59,130,246,0.14)',
};

export function SplashScreen() {
  // valores animados
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const wordTranslate = useRef(new Animated.Value(14)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // entrada do logo
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 6,
        tension: 70,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // pulsação sutil do glow atrás do logo
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // leve subida do logo ao entrar
    Animated.timing(wordTranslate, {
      toValue: 0,
      duration: 600,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // tagline
    Animated.timing(taglineOpacity, {
      toValue: 1,
      duration: 500,
      delay: 640,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // footer
    Animated.timing(footerOpacity, {
      toValue: 1,
      duration: 600,
      delay: 800,
      useNativeDriver: true,
    }).start();

    // barra de progresso
    Animated.timing(progress, {
      toValue: 1,
      duration: 2000,
      delay: 500,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, []);

  const glowScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });
  const glowOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 180],
  });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.center}>
        {/* glow pulsante atrás do logo */}
        <Animated.View
          style={[
            styles.glow,
            { opacity: glowOpacity, transform: [{ scale: glowScale }] },
          ]}
        />

        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }, { translateY: wordTranslate }],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={require('@/assets/logos/zyntra-branco.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Logo Zyntra"
          />
        </Animated.View>

        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
          Gestão Empresarial Integrada
        </Animated.Text>

        {/* barra de progresso */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: barWidth }]} />
        </View>
      </View>

      {/* rodapé */}
      <Animated.View style={[styles.footer, { opacity: footerOpacity }]}>
        <Text style={styles.footerBrand}>Aluforce · Grupo Labor</Text>
        <Text style={styles.footerVersion}>Versão {APP_VERSION}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SPLASH.bgBottom,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: SPLASH.ring,
    top: '50%',
    marginTop: -240,
  },
  logo: {
    width: 300,
    height: 116,
  },
  tagline: {
    marginTop: 10,
    fontSize: 12.5,
    fontWeight: '500',
    color: SPLASH.lightDim,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  progressTrack: {
    marginTop: 40,
    width: 180,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 3,
    backgroundColor: SPLASH.blue,
  },
  footer: {
    position: 'absolute',
    bottom: 44,
    alignItems: 'center',
  },
  footerBrand: {
    fontSize: 12,
    fontWeight: '600',
    color: SPLASH.lightDim,
    letterSpacing: 0.5,
  },
  footerVersion: {
    marginTop: 4,
    fontSize: 11,
    color: SPLASH.muted,
    letterSpacing: 0.5,
  },
});
