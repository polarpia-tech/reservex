import { inviteStaffMember, type StaffRole } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { RolePicker } from '@/components/staff/RolePicker';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The first real UI caller of the `invite-staff-member` Edge Function
 * (written in Phase 04, wired up here for the first time). Only reachable
 * from the staff list's header button, which itself only renders for
 * owner/manager -- but the Edge Function re-checks that authorization
 * itself regardless (see its own comments), so this screen being reachable
 * at all is not the security boundary.
 */
export default function InviteStaffScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'owner'>>('staff');
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!membership) throw new Error('No restaurant loaded.');
      return inviteStaffMember(supabase, { restaurantId: membership.restaurant.id, email: email.trim().toLowerCase(), role });
    },
    onSuccess: async () => {
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: ['restaurant-staff', membership?.restaurant.id] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('already active staff')) {
        setErrorMessage(t('staff.errors.alreadyStaff'));
      } else if (message.toLowerCase().includes('permission')) {
        setErrorMessage(t('staff.errors.noPermission'));
      } else {
        setErrorMessage(t('staff.errors.generic'));
      }
    },
  });

  if (sent) {
    return (
      <ScrollView contentContainerStyle={[styles.content, { justifyContent: 'center', flexGrow: 1 }]} style={{ backgroundColor: theme.background }}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('staff.inviteSentTitle')}</Text>
        <Text style={{ color: theme.textMuted, textAlign: 'center' }}>{t('staff.inviteSentBody')}</Text>
        <Button label={t('staff.backToStaff')} onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('staff.inviteTitle') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField
            label={t('staff.email')}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('staff.role')}</Text>
          <RolePicker value={role} onChange={setRole} />

          {errorMessage ? <Text style={[styles.errorText, { color: theme.danger }]}>{errorMessage}</Text> : null}

          <Button
            label={t('staff.sendInvite')}
            onPress={() => {
              setErrorMessage(null);
              mutation.mutate();
            }}
            loading={mutation.isPending}
            disabled={!email.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typeScale.h1, textAlign: 'center' },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
