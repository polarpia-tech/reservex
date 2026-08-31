import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * The bare "/" route. This screen is deliberately NOT a <Redirect> to a
 * fixed destination anymore (that was the Phase 03 placeholder, before
 * authentication existed). Where the user actually belongs -- login,
 * onboarding, or the reservations tab -- now depends on session and
 * restaurant-membership state that isn't known synchronously on first
 * render, so this just shows a brief loading state and lets
 * useProtectedRoute (in the root layout) do the one real redirect once
 * that state has resolved. If this spinner is ever visible for more than a
 * moment, that's a bug in the redirect logic, not a "home screen".
 */
export default function Index() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}
