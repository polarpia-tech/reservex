import { createOffer, deleteOffer, fetchOffers, isOfferCurrentlyValid, updateOffer, type Offer } from '@reservex/core';
import { spacing } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Owner/manager/reservation_manager only (offers_write RLS, migration
 * 0042). One flat add + list + toggle-active + delete screen, same pattern
 * as deposit-policies.tsx and events.tsx -- `offers` is a brand-new table
 * in Phase 20, this is its only management UI.
 *
 * validFrom/validUntil are both optional, plain "YYYY-MM-DD HH:mm" text
 * (same reasoning as events.tsx: no date-picker dependency exists anywhere
 * else in this app yet). Leaving both blank makes a standing/evergreen
 * offer -- isOfferCurrentlyValid() (packages/core) treats a missing bound
 * as "no bound on that side", not as "always invalid".
 */
export default function OffersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const offersQuery = useQuery({
    queryKey: ['offers', restaurantId],
    queryFn: () => fetchOffers(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['offers', restaurantId] });

  /** Returns null only for a genuinely invalid, non-empty string -- call only when `value.trim()` is non-empty; an empty field means "no bound" and should never reach this function. */
  function parseDateTime(value: string): Date | null {
    const normalized = value.trim().replace(' ', 'T');
    const parsed = new Date(normalized.length === 16 ? `${normalized}:00` : normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const createMutation = useMutation({
    mutationFn: () => {
      let from: Date | null = null;
      let until: Date | null = null;
      if (validFrom.trim()) {
        from = parseDateTime(validFrom);
        if (!from) throw new Error('INVALID_DATE_FORMAT');
      }
      if (validUntil.trim()) {
        until = parseDateTime(validUntil);
        if (!until) throw new Error('INVALID_DATE_FORMAT');
      }
      if (from && until && until <= from) throw new Error('INVALID_DATES');
      return createOffer(supabase, restaurantId!, {
        title: title.trim(),
        description: description.trim() || null,
        validFrom: from ? from.toISOString() : null,
        validUntil: until ? until.toISOString() : null,
      });
    },
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setValidFrom('');
      setValidUntil('');
      setValidationError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : '';
      setValidationError(code === 'INVALID_DATES' ? t('offers.invalidDates') : t('offers.invalidDateFormat'));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (offer: Offer) => updateOffer(supabase, offer.id, { isActive: !offer.isActive }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (offerId: string) => deleteOffer(supabase, offerId),
    onSuccess: invalidate,
  });

  function confirmDelete(offer: Offer) {
    Alert.alert(t('offers.deleteConfirmTitle'), t('offers.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteMutation.mutate(offer.id) },
    ]);
  }

  function formatWindow(offer: Offer): string | null {
    if (!offer.validFrom && !offer.validUntil) return null;
    const dateOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
    const from = offer.validFrom ? new Date(offer.validFrom).toLocaleDateString(undefined, dateOpts) : null;
    const until = offer.validUntil ? new Date(offer.validUntil).toLocaleDateString(undefined, dateOpts) : null;
    if (from && until) return `${from} → ${until}`;
    if (from) return `${from} →`;
    return `→ ${until}`;
  }

  const canSubmit = isOwnerOrManager && title.trim().length > 0 && Boolean(restaurantId);

  return (
    <>
      <Stack.Screen options={{ title: t('offers.title') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textMuted }}>{t('offers.subtitle')}</Text>

        {(offersQuery.data ?? []).length === 0 && !offersQuery.isLoading ? (
          <Text style={{ color: theme.textMuted }}>{t('offers.noOffers')}</Text>
        ) : null}

        {(offersQuery.data ?? []).map((offer) => {
          const window = formatWindow(offer);
          const expired = offer.isActive && !isOfferCurrentlyValid(offer);
          return (
            <Card key={offer.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{offer.title}</Text>
                {window || expired ? (
                  <Text style={{ color: expired ? theme.danger : theme.textMuted, marginTop: spacing.xs }}>
                    {[window, expired ? t('offers.deactivate') : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              {isOwnerOrManager ? (
                <>
                  <Switch value={offer.isActive} onValueChange={() => toggleMutation.mutate(offer)} trackColor={{ true: theme.accent }} />
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmDelete(offer)}>
                    <Ionicons name="trash-outline" color={theme.danger} size={20} />
                  </Pressable>
                </>
              ) : null}
            </Card>
          );
        })}

        {isOwnerOrManager ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('offers.addOffer')}</Text>
            <TextField label={t('offers.offerTitle')} placeholder={t('offers.offerTitlePlaceholder')} value={title} onChangeText={setTitle} />
            <TextField
              label={t('offers.descriptionLabel')}
              placeholder={t('offers.descriptionPlaceholder')}
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <View style={styles.row2}>
              <View style={styles.half}>
                <TextField label={t('offers.validFrom')} placeholder={t('events.dateTimeHint')} value={validFrom} onChangeText={setValidFrom} />
              </View>
              <View style={styles.half}>
                <TextField label={t('offers.validUntil')} placeholder={t('events.dateTimeHint')} value={validUntil} onChangeText={setValidUntil} />
              </View>
            </View>

            {validationError ? <Text style={{ color: theme.danger }}>{validationError}</Text> : null}
            <Button label={t('offers.addOffer')} onPress={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!canSubmit} />
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  row2: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
});
