import { createEvent, deleteEvent, fetchEvents, updateEvent, type RestaurantEvent } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
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
 * Owner/manager/reservation_manager only (events_write RLS, unchanged since
 * Phase 02). One flat add + list + toggle-active + delete screen, same
 * reasoning as deposit-policies.tsx: a small single-restaurant config list.
 *
 * `events` itself is not new (Phase 02) -- what's new in Phase 21 is that a
 * non-private, active event created here now actually shows up on the
 * restaurant's public page (events_public_select, migration 0042). This
 * screen is the first UI to create/edit events at all.
 *
 * Dates are entered as plain "YYYY-MM-DD HH:mm" text (parsed to an ISO
 * string on submit) rather than a native date picker -- no date-picker
 * dependency exists anywhere else in this app yet, and every other
 * timestamp-ish input in the codebase (opening hours, special hours) is
 * likewise a plain text/number field, so this keeps the same level of
 * simplicity rather than introducing a new native module.
 */
export default function EventsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const eventsQuery = useQuery({
    queryKey: ['events', restaurantId],
    queryFn: () => fetchEvents(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [capacity, setCapacity] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['events', restaurantId] });

  function parseDateTime(value: string): Date | null {
    // Accepts "YYYY-MM-DD HH:mm" (space or "T" separator); relies on the
    // device's local timezone for the wall-clock -> instant conversion,
    // same as every other plain-text time input in this app.
    const normalized = value.trim().replace(' ', 'T');
    const parsed = new Date(normalized.length === 16 ? `${normalized}:00` : normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const start = parseDateTime(startsAt);
      const end = parseDateTime(endsAt);
      if (!start || !end) throw new Error('INVALID_DATE_FORMAT');
      if (end <= start) throw new Error('INVALID_DATES');
      return createEvent(supabase, restaurantId!, {
        name: name.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        isPrivate,
        capacity: capacity.trim() ? Number(capacity) : null,
      });
    },
    onSuccess: () => {
      setName('');
      setStartsAt('');
      setEndsAt('');
      setIsPrivate(false);
      setCapacity('');
      setValidationError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : '';
      setValidationError(code === 'INVALID_DATES' ? t('events.invalidDates') : t('events.invalidDateFormat'));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (event: RestaurantEvent) => updateEvent(supabase, event.id, { isActive: !event.isActive }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => deleteEvent(supabase, eventId),
    onSuccess: invalidate,
  });

  function confirmDelete(event: RestaurantEvent) {
    Alert.alert(t('events.deleteConfirmTitle'), t('events.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteMutation.mutate(event.id) },
    ]);
  }

  function formatRange(event: RestaurantEvent): string {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    const sameDay = start.toDateString() === end.toDateString();
    const dateOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    return sameDay
      ? `${start.toLocaleDateString(undefined, dateOpts)} · ${start.toLocaleTimeString(undefined, timeOpts)}–${end.toLocaleTimeString(undefined, timeOpts)}`
      : `${start.toLocaleDateString(undefined, dateOpts)} → ${end.toLocaleDateString(undefined, dateOpts)}`;
  }

  const canSubmit = isOwnerOrManager && name.trim().length > 0 && startsAt.trim().length > 0 && endsAt.trim().length > 0 && Boolean(restaurantId);

  return (
    <>
      <Stack.Screen options={{ title: t('events.title') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textMuted }}>{t('events.subtitle')}</Text>

        {(eventsQuery.data ?? []).length === 0 && !eventsQuery.isLoading ? (
          <Text style={{ color: theme.textMuted }}>{t('events.noEvents')}</Text>
        ) : null}

        {(eventsQuery.data ?? []).map((event) => (
          <Card key={event.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>
                {event.name}
                {event.isPrivate ? ` · ${t('events.privateBadge')}` : ''}
              </Text>
              <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>{formatRange(event)}</Text>
            </View>
            {isOwnerOrManager ? (
              <>
                <Switch value={event.isActive} onValueChange={() => toggleMutation.mutate(event)} trackColor={{ true: theme.accent }} />
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmDelete(event)}>
                  <Ionicons name="trash-outline" color={theme.danger} size={20} />
                </Pressable>
              </>
            ) : null}
          </Card>
        ))}

        {isOwnerOrManager ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('events.addEvent')}</Text>
            <TextField label={t('events.name')} placeholder={t('events.namePlaceholder')} value={name} onChangeText={setName} />
            <View style={styles.row2}>
              <View style={styles.half}>
                <TextField label={t('events.startsAt')} placeholder={t('events.dateTimeHint')} value={startsAt} onChangeText={setStartsAt} />
              </View>
              <View style={styles.half}>
                <TextField label={t('events.endsAt')} placeholder={t('events.dateTimeHint')} value={endsAt} onChangeText={setEndsAt} />
              </View>
            </View>
            <TextField label={t('events.capacity')} keyboardType="number-pad" value={capacity} onChangeText={setCapacity} />

            <View style={styles.switchRow}>
              <Text style={{ color: theme.textPrimary, flex: 1 }}>{t('events.isPrivate')}</Text>
              <Switch value={isPrivate} onValueChange={setIsPrivate} trackColor={{ true: theme.accent }} />
            </View>

            {validationError ? <Text style={{ color: theme.danger }}>{validationError}</Text> : null}
            <Button label={t('events.addEvent')} onPress={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!canSubmit} />
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
