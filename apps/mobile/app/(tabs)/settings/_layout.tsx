import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Turns "Settings" from a single flat screen (Phase 03/04) into a small
 * stack: the hub (index.tsx) plus pushed sub-screens for restaurant profile,
 * opening hours, staff and the roles reference -- all Phase 05 additions.
 * The bottom tab bar (app/(tabs)/_layout.tsx) still shows one "Settings"
 * tab; Expo Router resolves it to this stack's `index` route automatically.
 *
 * The OUTER Tabs.Screen for "settings" sets `headerShown: false` (Phase 06
 * fix) so this INNER Stack is the only thing that ever renders a header --
 * nesting a Stack inside a Tab without doing that would show two headers
 * stacked on top of each other. That means `index` (the hub) now needs its
 * own header too (it sets `title` itself, in index.tsx), unlike the earlier
 * Phase 05 version of this file which hid the header on `index` to
 * compensate for a header the outer tab was ALSO still showing.
 */
export default function SettingsStackLayout() {
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
