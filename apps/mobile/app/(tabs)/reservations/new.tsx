import {
  bookReservation,
  fetchAvailableTableCombinations,
  fetchAvailableTables,
  fetchTableZones,
  parseBookReservationErrorCode,
  type AvailableTable,
  type AvailableTableCombination,
} from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * date + time are plain "YYYY-MM-DD" / "HH:MM" text fields, parsed with the
 * DEVICE's local timezone (new Date(`${date}T${time}`)) -- exactly the same
 * pattern opening-hours.tsx and the special-hours date field already use.
 * This is a deliberate MVP simplification: it assumes whoever is booking is
 * physically at the restaurant (same timezone as the restaurant's own
 * `timezone` column), which holds for a host or manager on shift but would
 * need a real IANA-aware conversion (e.g. via a date library) before this
 * screen could ever be used for remote/cross-timezone administration.
 * Documented in the Phase 07 README section, not silently assumed.
 */
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

export default function NewReservationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const restaurant = membership?.restaurant;
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();

  const zonesQuery = useQuery({
    queryKey: ['table-zones', restaurantId],
    queryFn: () => fetchTableZones(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [date, setDate] = useState(() => toISODateString(new Date()));
  const [time, setTime] = useState('20:00');
  const [durationMinutes, setDurationMinutes] = useState(() => String(restaurant?.defaultReservationDurationMin ?? 90));
  const [partySize, setPartySize] = useState('2');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const [availability, setAvailability] = useState<{ tables: AvailableTable[]; combinations: AvailableTableCombination[] } | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<string[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function computeTimes(): { startsAt: string; endsAt: string } | null {
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
    const duration = Number.parseInt(durationMinutes, 10);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const start = toInstant(date, time);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + duration * 60_000);
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  }

  const checkAvailabilityMutation = useMutation({
    mutationFn: async () => {
      const times = computeTimes();
      const size = Number.parseInt(partySize, 10);
      if (!times || !restaurantId || !Number.isFinite(size) || size <= 0) {
        throw new Error('INVALID_PARTY_SIZE');
      }
      const [tables, combinations] = await Promise.all([
        fetchAvailableTables(supabase, { restaurantId, startsAt: times.startsAt, endsAt: times.endsAt, partySize: size, zoneId, includeVip: true }),
        fetchAvailableTableCombinations(supabase, { restaurantId, startsAt: times.startsAt, endsAt: times.endsAt, partySize: size }),
      ]);
      return { tables, combinations };
    },
    onSuccess: (result) => {
      setFormError(null);
      setAvailability(result);
      setSelectedTableIds(null);
    },
    onError: () => setFormError(t('reservations.errors.INVALID_PARTY_SIZE')),
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      const times = computeTimes();
      const size = Number.parseInt(partySize, 10);
      if (!times || !restaurantId) throw new Error('INVALID_TIME_RANGE');
      return bookReservation(supabase, {
        restaurantId,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        partySize: size,
        zonePreferenceId: zoneId,
        guestName: guestName.trim() || null,
        guestPhone: guestPhone.trim() || null,
        guestEmail: guestEmail.trim() || null,
        specialRequests: specialRequests.trim() || null,
        internalNotes: internalNotes.trim() || null,
        tableIds: selectedTableIds,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reservations', restaurantId] });
      router.back();
    },
    onError: (err) => setFormError(t(`reservations.errors.${parseBookReservationErrorCode(err) ?? 'generic'}`)),
  });

  const zones = zonesQuery.data ?? [];
  const canSubmit = Boolean(guestName.trim() || guestPhone.trim()) && DATE_PATTERN.test(date) && TIME_PATTERN.test(time);

  return (
    <>
      <Stack.Screen options={{ title: t('reservations.newReservation') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <View style={styles.row}>
            <View style={styles.half}>
              <TextField label={t('reservations.date')} placeholder="2026-09-05" value={date} onChangeText={setDate} />
            </View>
            <View style={styles.half}>
              <TextField label={t('reservations.time')} placeholder="20:00" value={time} onChangeText={setTime} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.half}>
              <TextField label={t('reservations.duration')} keyboardType="number-pad" value={durationMinutes} onChangeText={setDurationMinutes} />
            </View>
            <View style={styles.half}>
              <TextField label={t('reservations.partySize')} keyboardType="number-pad" value={partySize} onChangeText={setPartySize} />
            </View>
          </View>

          {zones.length > 0 ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('reservations.zonePreference')}</Text>
              <View style={styles.grid}>
                <Chip label={t('reservations.anyZone')} active={zoneId === null} onPress={() => setZoneId(null)} />
                {zones.map((zone) => (
                  <Chip key={zone.id} label={zone.name} active={zoneId === zone.id} onPress={() => setZoneId(zone.id)} />
                ))}
              </View>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t('reservations.guestDetails')}</Text>
          <TextField label={t('reservations.guestName')} value={guestName} onChangeText={setGuestName} />
          <TextField label={t('reservations.guestPhone')} keyboardType="phone-pad" value={guestPhone} onChangeText={setGuestPhone} />
          <TextField label={t('reservations.guestEmail')} keyboardType="email-address" autoCapitalize="none" value={guestEmail} onChangeText={setGuestEmail} />
          <TextField label={t('reservations.specialRequests')} value={specialRequests} onChangeText={setSpecialRequests} multiline />
          <TextField label={t('reservations.internalNotes')} value={internalNotes} onChangeText={setInternalNotes} multiline />

          <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing.lg }]}>{t('reservations.suggestedTables')}</Text>
          <Button
            label={t('reservations.pickTableManually')}
            variant="neutral"
            onPress={() => checkAvailabilityMutation.mutate()}
            loading={checkAvailabilityMutation.isPending}
          />

          {availability ? (
            <Card style={{ gap: spacing.sm }}>
              <Pressable accessibilityRole="button" onPress={() => setSelectedTableIds(null)}>
                <View style={[styles.optionRow, { borderColor: selectedTableIds === null ? theme.accent : theme.border }]}>
                  <Text style={{ color: theme.textPrimary }}>{t('reservations.autoAssign')}</Text>
                </View>
              </Pressable>
              {availability.tables.map((table) => {
                const active = selectedTableIds?.length === 1 && selectedTableIds[0] === table.tableId;
                return (
                  <Pressable key={table.tableId} accessibilityRole="button" onPress={() => setSelectedTableIds([table.tableId])}>
                    <View style={[styles.optionRow, { borderColor: active ? theme.accent : theme.border }]}>
                      <Text style={{ color: theme.textPrimary }}>
                        {table.label} ({table.capacityMin}–{table.capacityMax}){table.isVip ? ' · VIP' : ''}
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
                      <Text style={{ color: theme.textPrimary }}>
                        {t('reservations.combination')}: {combo.name} ({combo.combinedCapacityMin}–{combo.combinedCapacityMax})
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {availability.tables.length === 0 && availability.combinations.length === 0 ? (
                <Text style={{ color: theme.danger }}>{t('reservations.noAvailability')}</Text>
              ) : null}
            </Card>
          ) : null}

          {formError ? <Text style={[styles.errorText, { color: theme.danger }]}>{formError}</Text> : null}

          <Button label={t('reservations.confirmBooking')} onPress={() => bookMutation.mutate()} loading={bookMutation.isPending} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.accent : theme.surface, borderColor: active ? theme.accent : theme.border }]}
    >
      <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  optionRow: { padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
