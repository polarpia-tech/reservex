import { spacing, typeScale } from '@reservex/ui';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';
import { mapSupabaseAuthError } from '@/utils/authErrors';

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(mapSupabaseAuthError(signInError.message, t));
      return;
    }
    // useProtectedRoute (in the root layout) takes it from here: it will
    // send them to onboarding or straight into the app depending on
    // whether they already have a restaurant.
    router.replace('/');
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* apps/mobile/assets/icon.png already exists for the OS app icon --
            this is the first time it's rendered INSIDE the app itself,
            rather than only ever appearing on the home screen. */}
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <Text style={[styles.appName, { color: theme.accent }]}>{t('common.appName')}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('auth.welcomeBack')}</Text>

        <TextField
          label={t('auth.email')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          label={t('auth.password')}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}

        <Button label={t('auth.login')} onPress={handleLogin} loading={loading} disabled={!email || !password} />

        <Link href="/(auth)/forgot-password" style={[styles.linkCentered, { color: theme.textMuted }]}>
          {t('auth.forgotPassword')}
        </Link>

        <View style={styles.footerRow}>
          <Text style={{ color: theme.textMuted }}>{t('auth.dontHaveAccount')} </Text>
          <Link href="/(auth)/signup" style={{ color: theme.accent, fontWeight: '600' }}>
            {t('auth.signUp')}
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing['2xl'], gap: spacing.lg },
  logo: { width: 64, height: 64, borderRadius: 16, alignSelf: 'center' },
  appName: { ...typeScale.label, textAlign: 'center', letterSpacing: 1.5, textTransform: 'uppercase' },
  title: { ...typeScale.h1, textAlign: 'center', marginBottom: spacing.md },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  linkCentered: { ...typeScale.caption, textAlign: 'center' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
});