import { createWaitlistEntry, fetchTableZones } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
// Same device-local-time simplification as reservations/new.tsx.
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

export default function NewWaitlistEntryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const zonesQuery = useQuery({
    queryKey: ['table-zones', restaurantId],
    queryFn: () => fetchTableZones(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [date, setDate] = useState(() => toISODateString(new Date()));
  const [fromTime, setFromTime] = useState('19:00');
  const [toTime, setToTime] = useState('21:00');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const size = Number.parseInt(partySize, 10) || 1;
      const from = toInstant(date, fromTime);
      const to = toInstant(date, toTime);
      return createWaitlistEntry(supabase, {
        restaurantId: restaurantId!,
        guestName: guestName.trim() || null,
        guestPhone: guestPhone.trim() || null,
        partySize: size,
        requestedDate: date,
        requestedFrom: from.toISOString(),
        requestedTo: to.toISOString(),
        zonePreferenceId: zoneId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['waitlist', restaurantId] });
      router.back();
    },
    // This screen previously had NO onError at all: a failed save (of any
    // kind -- not just the invalid-time-range case below) silently did
    // nothing, which is exactly the bug report that led here. The database
    // only rejects genuinely malformed input at this point (RLS already
    // covers permissions the same way as every other write in this app),
    // so there's no specific error code worth parsing out -- one generic,
    // translated message is the honest, correct fix.
    onError: () => setValidationError(t('waitlist.errors.generic')),
  });

  function handleSubmit() {
    setValidationError(null);
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(fromTime) || !TIME_PATTERN.test(toTime)) {
      setValidationError(t('common.error'));
      return;
    }
    // Catches, before ever reaching the server, exactly the failure this
    // screen was reported for: requested "from" >= "to" makes an empty or
    // backwards time range, which Postgres's tstzrange type rejects
    // outright (error 22000, "range lower bound must be less than or equal
    // to range upper bound") -- confirmed via a temporary diagnostic log
    // against the real backend before this fix was written. Checking it
    // here means the host sees an immediate, specific, in-place message
    // instead of a round trip to the server for something we can already
    // tell is wrong.
    if (toInstant(date, fromTime).getTime() >= toInstant(date, toTime).getTime()) {
      setValidationError(t('waitlist.errors.invalidTimeRange'));
      return;
    }
    mutation.mutate();
  }

  const zones = zonesQuery.data ?? [];
  const canSubmit = Boolean(guestName.trim() || guestPhone.trim());

  return (
    <>
      <Stack.Screen options={{ title: t('waitlist.addEntry') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField label={t('waitlist.guestName')} value={guestName} onChangeText={setGuestName} />
          <TextField label={t('waitlist.guestPhone')} keyboardType="phone-pad" value={guestPhone} onChangeText={setGuestPhone} />
          <TextField label={t('waitlist.partySize')} keyboardType="number-pad" value={partySize} onChangeText={setPartySize} />
          <TextField label={t('waitlist.requestedDate')} placeholder="2026-09-05" value={date} onChangeText={setDate} />
          <View style={styles.row}>
            <View style={styles.half}>
              <TextField label={t('waitlist.requestedFrom')} placeholder="19:00" value={fromTime} onChangeText={setFromTime} />
            </View>
            <View style={styles.half}>
              <TextField label={t('waitlist.requestedTo')} placeholder="21:00" value={toTime} onChangeText={setToTime} />
            </View>
          </View>

          {zones.length > 0 ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('waitlist.zonePreference')}</Text>
              <View style={styles.grid}>
                <Chip label={t('reservations.anyZone')} active={zoneId === null} onPress={() => setZoneId(null)} />
                {zones.map((zone) => (
                  <Chip key={zone.id} label={zone.name} active={zoneId === zone.id} onPress={() => setZoneId(zone.id)} />
                ))}
              </View>
            </View>
          ) : null}

          {validationError ? <Text style={[styles.errorText, { color: theme.danger }]}>{validationError}</Text> : null}
          <Button label={t('common.save')} onPress={handleSubmit} loading={mutation.isPending} disabled={!canSubmit} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
