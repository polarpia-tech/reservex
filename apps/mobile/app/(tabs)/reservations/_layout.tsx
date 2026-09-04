import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Same pattern as tables/_layout.tsx and settings/_layout.tsx: the outer
 * Tab already hides its own header for this tab (see tabs/_layout.tsx), so
 * this inner Stack is the only thing that renders a header -- each screen
 * in this folder still sets its own `title` via
 * <Stack.Screen options={{title:...}} />, but the DARK theme colors (which
 * this file was previously missing entirely, leaving every header here on
 * React Navigation's default white background) come from screenOptions
 * here, exactly like the tables/ and settings/ folders since Phase 06.
 */
export default function ReservationsLayout() {
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