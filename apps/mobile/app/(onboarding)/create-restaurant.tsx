import { radii, spacing, typeScale } from '@reservex/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const RESTAURANT_TYPES = ['restaurant', 'cafe', 'bar', 'club', 'beach_venue', 'hotel_venue', 'event_venue'] as const;
type RestaurantTypeOption = (typeof RESTAURANT_TYPES)[number];

/**
 * Reached only when useProtectedRoute (root layout) decides the signed-in
 * user has zero active restaurant memberships. Creation is NOT a direct
 * client-side insert into `restaurants`/`restaurant_users` -- it calls the
 * `bootstrap-restaurant` Edge Function (supabase/functions/bootstrap-restaurant).
 *
 * Why: a brand-new user CAN create their own `organizations` and
 * `restaurants` rows directly under RLS (they own both), but CANNOT insert
 * their own first `restaurant_users` "owner" row directly -- that policy
 * requires already being owner/manager of the restaurant, which is exactly
 * what they are trying to become. This was proven empirically in
 * scripts/verify_phase04_bootstrap.sql (Test C fails under RLS, Test D
 * succeeds as service role). Rather than special-case that one policy, the
 * whole bootstrap sequence (organization + restaurant + owner membership +
 * audit log) runs atomically-ish server-side, consistent with the project's
 * "sensitive multi-step writes go through Edge Functions" rule.
 */
export default function CreateRestaurantScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [type, setType] = useState<RestaurantTypeOption>('restaurant');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-detected, not asked -- the restaurant's authoritative clock
  // (blueprint, "timezones") defaults to wherever the owner is signing up
  // from. They can correct it later in Restaurant Settings (Phase 05).
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    setLoading(true);

    const { error: invokeError } = await supabase.functions.invoke('bootstrap-restaurant', {
      body: { restaurantName: name.trim(), restaurantType: type, timezone },
    });

    setLoading(false);

    if (invokeError) {
      setError(t('auth.errors.generic'));
      return;
    }

    if (user) {
      await queryClient.invalidateQueries({ queryKey: ['my-restaurants', user.id] });
    }
    // No explicit navigation here on purpose: invalidating the query makes
    // useMyRestaurants() refetch, which flips hasRestaurant to true, which
    // useProtectedRoute (root layout) picks up and redirects into (tabs) --
    // a single source of truth for "where does the user belong right now"
    // instead of two places deciding it.
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('onboarding.title')}</Text>
        <Text style={{ color: theme.textMuted, textAlign: 'center' }}>{t('onboarding.subtitle')}</Text>

        <TextField
          label={t('onboarding.restaurantNameLabel')}
          placeholder={t('onboarding.restaurantNamePlaceholder')}
          value={name}
          onChangeText={setName}
        />

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('onboarding.restaurantTypeLabel')}</Text>
          <View style={styles.typeGrid}>
            {RESTAURANT_TYPES.map((option) => {
              const active = option === type;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setType(option)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: active ? theme.accent : theme.surface,
                      borderColor: active ? theme.accent : theme.border,
                    },
                  ]}
                >
                  <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600' }}>
                    {t(`restaurantTypes.${option}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('onboarding.timezoneLabel')}</Text>
          <Text style={{ color: theme.textPrimary }}>{timezone}</Text>
        </View>

        {error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}

        <Button
          label={loading ? t('onboarding.creating') : t('onboarding.createButton')}
          onPress={handleCreate}
          loading={loading}
          disabled={!name.trim()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing['2xl'], gap: spacing.lg },
  title: { ...typeScale.h1, textAlign: 'center' },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
