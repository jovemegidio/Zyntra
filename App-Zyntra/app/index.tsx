import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { SplashScreen } from '@/components/splash-screen';

// Tempo mínimo de exibição do splash (ms) para a animação ser apreciada
const MIN_SPLASH_DURATION = 2600;

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const [minTimePassed, setMinTimePassed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimePassed(true), MIN_SPLASH_DURATION);
    return () => clearTimeout(timer);
  }, []);

  // Mantém o splash até o auth resolver E o tempo mínimo passar
  if (isLoading || !minTimePassed) {
    return <SplashScreen />;
  }

  if (isAuthenticated) {
    return <Redirect href="/(auth)" />;
  }

  return <Redirect href="/(public)/login" />;
}
