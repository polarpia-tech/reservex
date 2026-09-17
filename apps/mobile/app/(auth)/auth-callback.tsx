import { spacing, typeScale } from '@reservex/ui';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Target of the Google sign-in redirect (see src/services/googleAuth.ts --
 * `Linking.createURL('auth-callback')` builds `reservex:///auth-callback`).
 * Lives inside the (auth) group deliberately -- see below.
 *
 * This screen does NOT do the actual sign-in work: `signInWithGoogle()` is
 * already awaiting the redirect via `WebBrowser.openAuthSessionAsync` and
 * handles the token exchange itself as soon as the OS delivers that URL
 * back to the app. But Android delivers the SAME deep link to expo-router's
 * own linking listener at the same time, which would otherwise navigate
 * here regardless -- so this just gives that navigation a real, on-brand
 * loading screen instead of a 404 flash.
 *
 * Placement matters: this MUST live in the (auth) group, not at the app
 * root. useProtectedRoute (src/navigation/useProtectedRoute.ts) redirects
 * to /(auth)/login the instant it sees a route outside all three groups
 * with no session yet -- and right after this deep link lands, there IS
 * a moment with no session yet, because setSession() (awaited inside
 * signInWithGoogle(), back in the login/signup screen) hasn't resolved.
 * A root-level route would get redirected straight back to login for a
 * frame before the real session flips it on to (tabs) -- an ugly flash
 * back through the login screen. Being inside (auth) satisfies
 * useProtectedRoute's "already in the auth group" check, so it just waits
 * quietly here until hasSession flips true and sends the user on directly.
 */
export default function AuthCallback() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={theme.accent} />
      <Text style={[styles.label, { color: theme.textMuted }]}>{t('auth.completingSignIn')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  label: { ...typeScale.caption },
});
