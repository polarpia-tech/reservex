import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ScreenHeaderTitle } from '@/components/ScreenHeaderTitle';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.textPrimary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tabs.Screen
        name="reservations"
        options={{
          title: t('nav.reservations'),
          // Phase 07: this tab's content became a nested Stack (app/(tabs)/
          // reservations/), same reason as tables/settings below -- the
          // outer Tab header must stay hidden so the Stack can own its own
          // per-screen headers without a double-header render.
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tables"
        options={{
          title: t('nav.tables'),
          // This tab's content is a nested Stack (app/(tabs)/tables/), which
          // renders its own headers per screen -- see the comment in
          // settings/_layout.tsx for why the OUTER tab header must be
          // hidden here (otherwise both the Tabs header and the Stack's own
          // header would render at once).
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: t('nav.ai'),
          headerTitle: () => <ScreenHeaderTitle title={t('nav.ai')} />,
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          // See the tables tab above and settings/_layout.tsx: Settings is
          // also a nested Stack now (since Phase 05), so the outer tab
          // header must stay hidden here too -- fixed in this phase
          // (Phase 06) before the same double-header issue would have
          // compounded across more tabs.
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
