import { Stack } from 'expo-router';

import { pushScreenOptions } from '@/navigation/screenTransitions';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuthLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
        ...pushScreenOptions,
      }}
    />
  );
}
