import { Stack } from 'expo-router';
import { Colors } from '@/lib/constants';

export default function PublicLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="recuperar-senha" />
    </Stack>
  );
}
