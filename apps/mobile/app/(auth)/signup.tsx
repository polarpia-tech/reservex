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

const MIN_PASSWORD_LENGTH = 8;

export default function SignupScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSignUp() {
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.errors.passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.errors.passwordsDontMatch'));
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signUpError) {
      setError(mapSupabaseAuthError(signUpError.message, t));
      return;
    }

    if (data.session) {
      // Email confirmation is disabled for this Supabase project -- the
      // user is signed in immediately. useProtectedRoute sends them to
      // onboarding since they have zero restaurants yet.
      router.replace('/');
    } else {
      // Email confirmation is required (the default Supabase setting).
      // There is no session until they click the link in their inbox.
      setAwaitingConfirmation(true);
    }
  }

  if (awaitingConfirmation) {
    return (
      <View style={[styles.content, { justifyContent: 'center' }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('auth.checkYourEmailTitle')}</Text>
        <Text style={{ color: theme.textMuted, textAlign: 'center' }}>{t('auth.checkYourEmailBody')}</Text>
        <Link href="/(auth)/login" style={[styles.linkCentered, { color: theme.accent, marginTop: spacing.lg }]}>
          {t('auth.backToLogin')}
        </Link>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('auth.createAccount')}</Text>

        <TextField
          label={t('auth.email')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextField label={t('auth.password')} secureTextEntry value={password} onChangeText={setPassword} />
        <TextField
          label={t('auth.confirmPassword')}
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />

        {error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}

        <Button
          label={t('auth.signUp')}
          onPress={handleSignUp}
          loading={loading}
          disabled={!email || !password || !confirmPassword}
        />

        <View style={styles.footerRow}>
          <Text style={{ color: theme.textMuted }}>{t('auth.alreadyHaveAccount')} </Text>
          <Link href="/(auth)/login" style={{ color: theme.accent, fontWeight: '600' }}>
            {t('auth.login')}
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing['2xl'], gap: spacing.lg },
  logo: { width: 64, height: 64, borderRadius: 16, alignSelf: 'center' },
  title: { ...typeScale.h1, textAlign: 'center', marginBottom: spacing.md },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  linkCentered: { ...typeScale.caption, textAlign: 'center' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
});