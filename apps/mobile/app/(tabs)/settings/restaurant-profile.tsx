import type { Restaurant, RestaurantProfileUpdate } from '@reservex/core';
import { updateRestaurant } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/** Local, string-based form state -- numeric fields are parsed only at save time, so the user can freely clear/retype a number without fighting a controlled numeric input. */
interface FormState {
  name: string;
  description: string;
  phone: string;
  email: string;
  websiteUrl: string;
  addressLine: string;
  city: string;
  postalCode: string;
  countryCode: string;
  seatingCapacityTotal: string;
  minPartySize: string;
  maxPartySize: string;
  defaultReservationDurationMin: string;
  defaultTurnoverBufferMin: string;
  bookingWindowMinHours: string;
  bookingWindowMaxDays: string;
}

function toFormState(restaurant: Restaurant): FormState {
  return {
    name: restaurant.name,
    description: restaurant.description ?? '',
    phone: restaurant.phone ?? '',
    email: restaurant.email ?? '',
    websiteUrl: restaurant.websiteUrl ?? '',
    addressLine: restaurant.addressLine ?? '',
    city: restaurant.city ?? '',
    postalCode: restaurant.postalCode ?? '',
    countryCode: restaurant.countryCode ?? '',
    seatingCapacityTotal: restaurant.seatingCapacityTotal != null ? String(restaurant.seatingCapacityTotal) : '',
    minPartySize: String(restaurant.minPartySize),
    maxPartySize: String(restaurant.maxPartySize),
    defaultReservationDurationMin: String(restaurant.defaultReservationDurationMin),
    defaultTurnoverBufferMin: String(restaurant.defaultTurnoverBufferMin),
    bookingWindowMinHours: String(restaurant.bookingWindowMinHours),
    bookingWindowMaxDays: String(restaurant.bookingWindowMaxDays),
  };
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Owner/manager-only edit screen. Enforcement is real, not just hidden UI:
 * `updateRestaurant` is a plain client-side UPDATE gated by the
 * `restaurants_update` RLS policy (0011) -- if someone without owner/manager
 * role ever reached this screen, the save would fail server-side regardless
 * of what the UI shows. The read-only banner below is a UX courtesy, not
 * the actual security boundary.
 */
export default function RestaurantProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuth();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState | null>(membership ? toFormState(membership.restaurant) : null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (membership) setForm(toFormState(membership.restaurant));
  }, [membership]);

  const mutation = useMutation({
    mutationFn: (patch: RestaurantProfileUpdate) => {
      if (!membership) throw new Error('No restaurant loaded.');
      return updateRestaurant(supabase, membership.restaurant.id, patch);
    },
    onSuccess: async () => {
      setSavedNotice(true);
      if (user) await queryClient.invalidateQueries({ queryKey: ['my-restaurants', user.id] });
    },
  });

  if (!membership || !form) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setSavedNotice(false);
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleSave() {
    if (!form || !membership) return;
    mutation.mutate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      websiteUrl: form.websiteUrl.trim() || null,
      addressLine: form.addressLine.trim() || null,
      city: form.city.trim() || null,
      postalCode: form.postalCode.trim() || null,
      countryCode: form.countryCode.trim() || null,
      seatingCapacityTotal: form.seatingCapacityTotal.trim() ? toInt(form.seatingCapacityTotal, 0) : null,
      minPartySize: toInt(form.minPartySize, membership.restaurant.minPartySize),
      maxPartySize: toInt(form.maxPartySize, membership.restaurant.maxPartySize),
      defaultReservationDurationMin: toInt(form.defaultReservationDurationMin, membership.restaurant.defaultReservationDurationMin),
      defaultTurnoverBufferMin: toInt(form.defaultTurnoverBufferMin, membership.restaurant.defaultTurnoverBufferMin),
      bookingWindowMinHours: toInt(form.bookingWindowMinHours, membership.restaurant.bookingWindowMinHours),
      bookingWindowMaxDays: toInt(form.bookingWindowMaxDays, membership.restaurant.bookingWindowMaxDays),
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: t('restaurantProfile.title') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          {!isOwnerOrManager ? (
            <Text style={[styles.notice, { color: theme.textMuted, backgroundColor: theme.surface }]}>
              {t('restaurantProfile.readOnlyNotice')}
            </Text>
          ) : null}

          <Section title={t('restaurantProfile.sectionBasic')}>
            <TextField
              label={t('restaurantProfile.name')}
              value={form.name}
              onChangeText={(v) => set('name', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.description')}
              placeholder={t('restaurantProfile.descriptionPlaceholder')}
              value={form.description}
              onChangeText={(v) => set('description', v)}
              editable={isOwnerOrManager}
              multiline
            />
          </Section>

          <Section title={t('restaurantProfile.sectionContact')}>
            <TextField
              label={t('restaurantProfile.phone')}
              keyboardType="phone-pad"
              value={form.phone}
              onChangeText={(v) => set('phone', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.email')}
              keyboardType="email-address"
              autoCapitalize="none"
              value={form.email}
              onChangeText={(v) => set('email', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.website')}
              autoCapitalize="none"
              keyboardType="url"
              value={form.websiteUrl}
              onChangeText={(v) => set('websiteUrl', v)}
              editable={isOwnerOrManager}
            />
          </Section>

          <Section title={t('restaurantProfile.sectionAddress')}>
            <TextField
              label={t('restaurantProfile.addressLine')}
              value={form.addressLine}
              onChangeText={(v) => set('addressLine', v)}
              editable={isOwnerOrManager}
            />
            <TextField label={t('restaurantProfile.city')} value={form.city} onChangeText={(v) => set('city', v)} editable={isOwnerOrManager} />
            <TextField
              label={t('restaurantProfile.postalCode')}
              value={form.postalCode}
              onChangeText={(v) => set('postalCode', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.countryCode')}
              autoCapitalize="characters"
              maxLength={2}
              value={form.countryCode}
              onChangeText={(v) => set('countryCode', v.toUpperCase())}
              editable={isOwnerOrManager}
            />
          </Section>

          <Section title={t('restaurantProfile.sectionCapacity')}>
            <TextField
              label={t('restaurantProfile.seatingCapacity')}
              keyboardType="number-pad"
              value={form.seatingCapacityTotal}
              onChangeText={(v) => set('seatingCapacityTotal', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.minPartySize')}
              keyboardType="number-pad"
              value={form.minPartySize}
              onChangeText={(v) => set('minPartySize', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.maxPartySize')}
              keyboardType="number-pad"
              value={form.maxPartySize}
              onChangeText={(v) => set('maxPartySize', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.reservationDuration')}
              keyboardType="number-pad"
              value={form.defaultReservationDurationMin}
              onChangeText={(v) => set('defaultReservationDurationMin', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.turnoverBuffer')}
              keyboardType="number-pad"
              value={form.defaultTurnoverBufferMin}
              onChangeText={(v) => set('defaultTurnoverBufferMin', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.bookingWindowMinHours')}
              keyboardType="number-pad"
              value={form.bookingWindowMinHours}
              onChangeText={(v) => set('bookingWindowMinHours', v)}
              editable={isOwnerOrManager}
            />
            <TextField
              label={t('restaurantProfile.bookingWindowMaxDays')}
              keyboardType="number-pad"
              value={form.bookingWindowMaxDays}
              onChangeText={(v) => set('bookingWindowMaxDays', v)}
              editable={isOwnerOrManager}
            />
          </Section>

          {mutation.isError ? (
            <Text style={[styles.errorText, { color: theme.danger }]}>{t('common.error')}</Text>
          ) : null}
          {savedNotice && mutation.isSuccess ? (
            <Text style={[styles.savedText, { color: theme.success }]}>{t('restaurantProfile.saved')}</Text>
          ) : null}

          {isOwnerOrManager ? (
            <Button
              label={t('restaurantProfile.saveButton')}
              onPress={handleSave}
              loading={mutation.isPending}
              disabled={!form.name.trim()}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{title}</Text>
      <View style={{ gap: spacing.md }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  section: { gap: spacing.sm },
  sectionTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  notice: { ...typeScale.caption, padding: spacing.md, borderRadius: 12 },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  savedText: { ...typeScale.caption, textAlign: 'center' },
});
