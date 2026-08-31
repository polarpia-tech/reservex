import {
  convertWaitlistEntryToReservation,
  fetchAvailableTableCombinations,
  fetchAvailableTables,
  fetchWaitlistEntry,
  parseBookReservationErrorCode,
  updateWaitlistEntryStatus,
  type AvailableTable,
  type AvailableTableCombination,
} from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function toHHMM(date: Date): string {
  return date.toTimeString().slice(0, 5);
}
// Same device-local-time simplification as reservations/new.tsx.
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

export default function WaitlistEntryDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { waitlistId } = useLocalSearchParams<{ waitlistId: string }>();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const entryQuery = useQuery({
    queryKey: ['waitlist-entry', waitlistId],
    queryFn: () => fetchWaitlistEntry(supabase, waitlistId),
  });
  const entry = entryQuery.data;

  const [isConverting, setIsConverting] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [availability, setAvailability] = useState<{ tables: AvailableTable[]; combinations: AvailableTableCombination[] } | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<string[] | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    const from = new Date(entry.requestedFrom);
    setDate(toISODateString(from));
    setTime(toHHMM(from));
  }, [entry]);

  const cancelMutation = useMutation({
    mutationFn: () => updateWaitlistEntryStatus(supabase, waitlistId, 'cancelled'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['waitlist', restaurantId] });
      router.back();
    },
  });

  function computeTimes(): { startsAt: string; endsAt: string } | null {
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
    const duration = Number.parseInt(durationMinutes, 10);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const start = toInstant(date, time);
    if (Number.isNaN(start.getTime())) return null;
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + duration * 60_000).toISOString() };
  }

  const checkAvailabilityMutation = useMutation({
    mutationFn: async () => {
      const times = computeTimes();
      if (!times || !restaurantId || !entry) throw new Error('INVALID_PARTY_SIZE');
      const [tables, combinations] = await Promise.all([
        fetchAvailableTables(supabase, { restaurantId, startsAt: times.startsAt, endsAt: times.endsAt, partySize: entry.partySize, zoneId: entry.zonePreferenceId, includeVip: true }),
        fetchAvailableTableCombinations(supabase, { restaurantId, startsAt: times.startsAt, endsAt: times.endsAt, partySize: entry.partySize }),
      ]);
      return { tables, combinations };
    },
    onSuccess: (result) => {
      setConvertError(null);
      setAvailability(result);
      setSelectedTableIds(null);
    },
    onError: () => setConvertError(t('reservations.errors.INVALID_PARTY_SIZE')),
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const times = computeTimes();
      if (!times || !restaurantId || !entry) throw new Error('INVALID_TIME_RANGE');
      return convertWaitlistEntryToReservation(supabase, waitlistId, {
        restaurantId,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        partySize: entry.partySize,
        customerId: entry.customerId,
        guestName: entry.guestName,
        guestPhone: entry.guestPhone,
        zonePreferenceId: entry.zonePreferenceId,
        tableIds: selectedTableIds,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['waitlist', restaurantId] });
      await queryClient.invalidateQueries({ queryKey: ['reservations', restaurantId] });
      router.back();
    },
    onError: (err) => setConvertError(t(`reservations.errors.${parseBookReservationErrorCode(err) ?? 'generic'}`)),
  });

  function confirmCancel() {
    Alert.alert(t('waitlist.cancelConfirmTitle'), t('waitlist.cancelConfirmBody'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('waitlist.cancelEntry'), style: 'destructive', onPress: () => cancelMutation.mutate() },
    ]);
  }

  if (!entry) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  const canAct = entry.status === 'waiting' || entry.status === 'notified';

  return (
    <>
      <Stack.Screen options={{ title: entry.guestName ?? t('waitlist.title') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <StatusPill status={entry.status} label={t(`waitlist.status.${entry.status}`)} />
          </View>
          <Card style={{ gap: spacing.xs }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('reservations.partySize')}: {entry.partySize}</Text>
            {entry.guestPhone ? <Text style={{ color: theme.textMuted }}>{entry.guestPhone}</Text> : null}
            <Text style={{ color: theme.textMuted }}>
              {entry.requestedDate} ·{' '}
              {new Date(entry.requestedFrom).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}–
              {new Date(entry.requestedTo).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Card>

          {canAct ? (
            <Button label={isConverting ? t('common.cancel') : t('waitlist.convertToReservation')} onPress={() => setIsConverting((v) => !v)} />
          ) : null}

          {isConverting ? (
            <Card style={{ gap: spacing.md }}>
              <View style={styles.row}>
                <View style={styles.half}>
                  <TextField label={t('reservations.date')} value={date} onChangeText={setDate} />
                </View>
                <View style={styles.half}>
                  <TextField label={t('reservations.time')} value={time} onChangeText={setTime} />
                </View>
              </View>
              <TextField label={t('reservations.duration')} keyboardType="number-pad" value={durationMinutes} onChangeText={setDurationMinutes} />

              <Button label={t('reservations.pickTableManually')} variant="neutral" onPress={() => checkAvailabilityMutation.mutate()} loading={checkAvailabilityMutation.isPending} />

              {availability ? (
                <View style={{ gap: spacing.sm }}>
                  <Pressable accessibilityRole="button" onPress={() => setSelectedTableIds(null)}>
                    <View style={[styles.optionRow, { borderColor: selectedTableIds === null ? theme.accent : theme.border }]}>
                      <Text style={{ color: theme.textPrimary }}>{t('reservations.autoAssign')}</Text>
                    </View>
                  </Pressable>
                  {availability.tables.map((tb) => {
                    const active = selectedTableIds?.length === 1 && selectedTableIds[0] === tb.tableId;
                    return (
                      <Pressable key={tb.tableId} accessibilityRole="button" onPress={() => setSelectedTableIds([tb.tableId])}>
                        <View style={[styles.optionRow, { borderColor: active ? theme.accent : theme.border }]}>
                          <Text style={{ color: theme.textPrimary }}>
                            {tb.label} ({tb.capacityMin}–{tb.capacityMax}){tb.isVip ? ' · VIP' : ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {availability.combinations.map((combo) => {
                    const active = JSON.stringify(selectedTableIds) === JSON.stringify(combo.tableIds);
                    return (
                      <Pressable key={combo.combinationId} accessibilityRole="button" onPress={() => setSelectedTableIds(combo.tableIds)}>
                        <View style={[styles.optionRow, { borderColor: active ? theme.accent : theme.border }]}>
                          <Text style={{ color: theme.textPrimary }}>{t('reservations.combination')}: {combo.name}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {availability.tables.length === 0 && availability.combinations.length === 0 ? (
                    <Text style={{ color: theme.danger }}>{t('reservations.noAvailability')}</Text>
                  ) : null}
                </View>
              ) : null}

              {convertError ? <Text style={[styles.errorText, { color: theme.danger }]}>{convertError}</Text> : null}
              <Button label={t('reservations.confirmBooking')} onPress={() => convertMutation.mutate()} loading={convertMutation.isPending} />
            </Card>
          ) : null}

          {canAct ? <Button label={t('waitlist.cancelEntry')} variant="neutral" onPress={confirmCancel} loading={cancelMutation.isPending} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  optionRow: { padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
