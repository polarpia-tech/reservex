import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Same pattern as settings/_layout.tsx: the outer Tabs.Screen for "tables"
 * (app/(tabs)/_layout.tsx) sets `headerShown: false` so this inner Stack is
 * the only thing that renders a header -- avoids the double-header bug
 * that Phase 05's settings stack had before this phase's fix.
 */
export default function TablesStackLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.textPrimary,
        contentStyle: { backgroundColor: theme.background },
      }}
    />
  );
}
