import { spacing, typeScale } from '@reservex/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Reached only via the deep link Supabase sends from resetPasswordForEmail
 * (see forgot-password.tsx). Opening that link makes Supabase establish a
 * short-lived recovery session automatically -- this screen doesn't need to
 * know the user's identity, it just calls updateUser() and relies on that
 * session being active, exactly like Supabase's own web password-reset flow.
 */
export default function UpdatePasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleUpdate() {
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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(t('auth.errors.generic'));
      return;
    }
    router.replace('/');
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('auth.resetPasswordTitle')}</Text>

        <TextField label={t('auth.password')} secureTextEntry value={password} onChangeText={setPassword} />
        <TextField
          label={t('auth.confirmPassword')}
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />

        {error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}

        <Button label={t('common.confirm')} onPress={handleUpdate} loading={loading} disabled={!password} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing['2xl'], gap: spacing.lg },
  title: { ...typeScale.h1, textAlign: 'center' },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
