import { spacing, typeScale } from '@reservex/ui';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSendResetLink() {
    setLoading(true);
    // Deep-links back into the app via the "reservex://" scheme declared in
    // app.json, to app/(auth)/update-password.tsx. Requires this exact URL
    // to also be added to the Supabase project's Auth > URL Configuration
    // "Redirect URLs" allow-list -- see README, "Auth deep links".
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: Linking.createURL('/(auth)/update-password'),
    });
    setLoading(false);
    // Deliberately the SAME message whether or not the address has an
    // account -- never reveal which emails are registered.
    setSent(true);
  }

  if (sent) {
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
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('auth.resetPasswordTitle')}</Text>
        <Text style={{ color: theme.textMuted, textAlign: 'center' }}>{t('auth.resetPasswordInstructions')}</Text>

        <TextField
          label={t('auth.email')}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Button label={t('auth.sendResetLink')} onPress={handleSendResetLink} loading={loading} disabled={!email} />

        <Link href="/(auth)/login" style={[styles.linkCentered, { color: theme.textMuted }]}>
          {t('auth.backToLogin')}
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing['2xl'], gap: spacing.lg },
  title: { ...typeScale.h1, textAlign: 'center' },
  linkCentered: { ...typeScale.caption, textAlign: 'center' },
});
