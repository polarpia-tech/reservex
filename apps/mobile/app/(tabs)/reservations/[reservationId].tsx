import {
  captureNoShowDeposit,
  fetchAvailableTableCombinations,
  fetchAvailableTables,
  fetchPaymentsForReservation,
  fetchReservation,
  fetchTableZones,
  parseBookReservationErrorCode,
  refundDeposit,
  rescheduleReservation,
  updateReservationStatus,
  type AvailableTable,
  type AvailableTableCombination,
  type Payment,
  type ReservationStatus,
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
// Same device-local-time simplification as reservations/new.tsx -- see that file's comment.
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

const TERMINAL_STATUSES: ReservationStatus[] = ['completed', 'cancelled', 'no_show'];

export default function ReservationDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const reservationQuery = useQuery({
    queryKey: ['reservation', reservationId],
    queryFn: () => fetchReservation(supabase, reservationId),
  });
  const zonesQuery = useQuery({
    queryKey: ['table-zones', restaurantId],
    queryFn: () => fetchTableZones(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  // Plain RLS read (payments_select, 0011) -- empty array for the vast
  // majority of reservations that never involved a deposit at all, which is
  // fine, the Payments card below just doesn't render for those.
  const paymentsQuery = useQuery({
    queryKey: ['payments', reservationId],
    queryFn: () => fetchPaymentsForReservation(supabase, reservationId),
    enabled: Boolean(reservationId),
  });

  const reservation = reservationQuery.data;

  const [cancellationReason, setCancellationReason] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [partySize, setPartySize] = useState('2');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ tables: AvailableTable[]; combinations: AvailableTableCombination[] } | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<string[] | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!reservation) return;
    const start = new Date(reservation.startsAt);
    const end = new Date(reservation.endsAt);
    setDate(toISODateString(start));
    setTime(toHHMM(start));
    setDurationMinutes(String(Math.round((end.getTime() - start.getTime()) / 60_000)));
    setPartySize(String(reservation.partySize));
    setZoneId(reservation.zonePreferenceId);
  }, [reservation]);

  const statusMutation = useMutation({
    mutationFn: (status: ReservationStatus) => updateReservationStatus(supabase, reservationId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reservation', reservationId] });
      await queryClient.invalidateQueries({ queryKey: ['reservations', restaurantId] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => updateReservationStatus(supabase, reservationId, 'cancelled', { cancellationReason: cancellationReason.trim() || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reservation', reservationId] });
      await queryClient.invalidateQueries({ queryKey: ['reservations', restaurantId] });
      router.back();
    },
  });

  // Phase 12: money actually moving is always a deliberate, separate staff
  // action behind an explicit confirmation dialog -- never a side effect of
  // marking no_show/cancelled, and never automatic. See captureNoShowDeposit
  // / refundDeposit in create-deposit-payment-intent's Edge Function
  // siblings for the server-side rules each of these enforces.
  const capturePaymentsQueryKey = ['payments', reservationId];
  const captureNoShowMutation = useMutation({
    mutationFn: () => captureNoShowDeposit(supabase, reservationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: capturePaymentsQueryKey }),
  });
  const refundMutation = useMutation({
    mutationFn: () => refundDeposit(supabase, reservationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: capturePaymentsQueryKey }),
  });

  function confirmCaptureNoShow() {
    Alert.alert(t('payments.captureNoShowConfirmTitle'), t('payments.captureNoShowConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('payments.captureNoShow'), style: 'destructive', onPress: () => captureNoShowMutation.mutate() },
    ]);
  }

  function confirmResolveCancellation() {
    Alert.alert(t('payments.resolveCancellationConfirmTitle'), t('payments.resolveCancellationConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('payments.resolveCancellation'), style: 'destructive', onPress: () => refundMutation.mutate() },
    ]);
  }

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
      const size = Number.parseInt(partySize, 10);
      if (!times || !restaurantId || !Number.isFinite(size) || size <= 0) throw new Error('INVALID_PARTY_SIZE');
      const [tables, combinations] = await Promise.all([
        fetchAvailableTables(supabase, {
          restaurantId,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          partySize: size,
          zoneId,
          includeVip: true,
          excludeReservationId: reservationId,
        }),
        fetchAvailableTableCombinations(supabase, { restaurantId, startsAt: times.startsAt, endsAt: times.endsAt, partySize: size, excludeReservationId: reservationId }),
      ]);
      return { tables, combinations };
    },
    onSuccess: (result) => {
      setEditError(null);
      setAvailability(result);
      setSelectedTableIds(null);
    },
    onError: () => setEditError(t('reservations.errors.INVALID_PARTY_SIZE')),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const times = computeTimes();
      const size = Number.parseInt(partySize, 10);
      if (!times || !restaurantId) throw new Error('INVALID_TIME_RANGE');
      return rescheduleReservation(supabase, reservationId, {
        restaurantId,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        partySize: size,
        zonePreferenceId: zoneId,
        tableIds: selectedTableIds,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reservation', reservationId] });
      await queryClient.invalidateQueries({ queryKey: ['reservations', restaurantId] });
      setIsEditing(false);
      setAvailability(null);
    },
    onError: (err) => setEditError(t(`reservations.errors.${parseBookReservationErrorCode(err) ?? 'generic'}`)),
  });

  function confirmCancel() {
    Alert.alert(t('reservations.cancelTitle'), t('reservations.cancelBody'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('reservations.actions.cancel'), style: 'destructive', onPress: () => cancelMutation.mutate() },
    ]);
  }

  if (!reservation) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  const isTerminal = TERMINAL_STATUSES.includes(reservation.status);
  const zones = zonesQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: reservation.guestName ?? t('reservations.title') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <StatusPill status={reservation.status} label={t(`reservations.status.${reservation.status}`)} />
            <Text style={{ color: theme.textMuted }}>
              {new Date(reservation.startsAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>
          </View>

          <Card style={{ gap: spacing.xs }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('reservations.partySize')}: {reservation.partySize}</Text>
            {reservation.guestPhone ? <Text style={{ color: theme.textMuted }}>{t('reservations.guestPhone')}: {reservation.guestPhone}</Text> : null}
            {reservation.guestEmail ? <Text style={{ color: theme.textMuted }}>{t('reservations.guestEmail')}: {reservation.guestEmail}</Text> : null}
            {reservation.specialRequests ? <Text style={{ color: theme.textMuted }}>{reservation.specialRequests}</Text> : null}
            {reservation.internalNotes ? <Text style={{ color: theme.warning }}>{reservation.internalNotes}</Text> : null}
          </Card>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('reservations.assignedTables')}</Text>
            <Text style={{ color: theme.textPrimary }}>
              {reservation.tables.length === 0 ? t('reservations.noTablesAssigned') : reservation.tables.map((tb) => tb.label).join(' + ')}
            </Text>
          </View>

          {(paymentsQuery.data ?? []).length > 0 ? (
            <Card style={{ gap: spacing.sm }}>
              <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('payments.title')}</Text>
              {(paymentsQuery.data ?? []).map((payment: Payment) => (
                <View key={payment.id} style={styles.paymentRow}>
                  <Text style={{ color: theme.textPrimary }}>{t(`payments.type.${payment.paymentType}`)}</Text>
                  <Text style={{ color: theme.textMuted }}>
                    {(payment.amountCents / 100).toFixed(2)} {payment.currency} · {t(`payments.status.${payment.status}`)}
                  </Text>
                </View>
              ))}
              {reservation.status === 'no_show' && (paymentsQuery.data ?? []).some((p) => p.status === 'requires_capture') ? (
                <Button label={t('payments.captureNoShow')} variant="neutral" onPress={confirmCaptureNoShow} loading={captureNoShowMutation.isPending} />
              ) : null}
              {reservation.status === 'cancelled' &&
              (paymentsQuery.data ?? []).some((p) => p.status === 'requires_capture' || p.status === 'succeeded') ? (
                <Button label={t('payments.resolveCancellation')} variant="neutral" onPress={confirmResolveCancellation} loading={refundMutation.isPending} />
              ) : null}
            </Card>
          ) : null}

          {!isTerminal ? (
            <View style={styles.actionsRow}>
              {reservation.status === 'pending' ? (
                <Button label={t('reservations.actions.confirm')} onPress={() => statusMutation.mutate('confirmed')} loading={statusMutation.isPending} />
              ) : null}
              {reservation.status === 'confirmed' ? (
                <>
                  <Button label={t('reservations.actions.seat')} onPress={() => statusMutation.mutate('seated')} loading={statusMutation.isPending} />
                  <Button label={t('reservations.markNoShow')} variant="neutral" onPress={() => statusMutation.mutate('no_show')} loading={statusMutation.isPending} />
                </>
              ) : null}
              {reservation.status === 'seated' ? (
                <Button label={t('reservations.actions.complete')} onPress={() => statusMutation.mutate('completed')} loading={statusMutation.isPending} />
              ) : null}
            </View>
          ) : null}

          {!isTerminal ? (
            <Button label={isEditing ? t('common.cancel') : t('reservations.actions.edit')} variant="neutral" onPress={() => setIsEditing((v) => !v)} />
          ) : null}

          {isEditing ? (
            <Card style={{ gap: spacing.md }}>
              <View style={styles.row}>
                <View style={styles.half}>
                  <TextField label={t('reservations.date')} value={date} onChangeText={setDate} />
                </View>
                <View style={styles.half}>
                  <TextField label={t('reservations.time')} value={time} onChangeText={setTime} />
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
                <View style={styles.grid}>
                  <Chip label={t('reservations.anyZone')} active={zoneId === null} onPress={() => setZoneId(null)} />
                  {zones.map((zone) => (
                    <Chip key={zone.id} label={zone.name} active={zoneId === zone.id} onPress={() => setZoneId(zone.id)} />
                  ))}
                </View>
              ) : null}

              <Button
                label={t('reservations.reassignTables')}
                variant="neutral"
                onPress={() => checkAvailabilityMutation.mutate()}
                loading={checkAvailabilityMutation.isPending}
              />

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
                          <Text style={{ color: theme.textPrimary }}>
                            {t('reservations.combination')}: {combo.name}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {availability.tables.length === 0 && availability.combinations.length === 0 ? (
                    <Text style={{ color: theme.danger }}>{t('reservations.noAvailability')}</Text>
                  ) : null}
                </View>
              ) : null}

              {editError ? <Text style={[styles.errorText, { color: theme.danger }]}>{editError}</Text> : null}
              <Button label={t('common.save')} onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} />
            </Card>
          ) : null}

          {!isTerminal ? (
            <View style={styles.dangerSection}>
              <TextField label={t('reservations.cancellationReason')} placeholder={t('reservations.cancellationReasonPlaceholder')} value={cancellationReason} onChangeText={setCancellationReason} />
              <Button label={t('reservations.actions.cancel')} variant="neutral" onPress={confirmCancel} loading={cancelMutation.isPending} />
            </View>
          ) : null}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  actionsRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  optionRow: { padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  dangerSection: { gap: spacing.sm, marginTop: spacing.lg },
});
