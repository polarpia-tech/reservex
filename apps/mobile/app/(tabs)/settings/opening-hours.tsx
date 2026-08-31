import {
  deleteSpecialHours,
  fetchOpeningHours,
  fetchSpecialHours,
  replaceOpeningHours,
  upsertSpecialHours,
  type OpeningHoursShiftInput,
} from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface ShiftDraft {
  key: string;
  label: string;
  opensAt: string; // "HH:MM"
  closesAt: string; // "HH:MM"
}

interface DayDraft {
  dayOfWeek: number;
  isClosed: boolean;
  shifts: ShiftDraft[];
}

let shiftKeySeq = 0;
function newShiftKey() {
  shiftKeySeq += 1;
  return `shift-${shiftKeySeq}`;
}

function emptyWeek(): DayDraft[] {
  return DAYS.map((dayOfWeek) => ({ dayOfWeek, isClosed: false, shifts: [] }));
}

function toHHMM(time: string): string {
  return time.slice(0, 5); // "14:30:00" -> "14:30"
}

/**
 * Weekly hours + one-off exceptions in one screen -- they're the same
 * product concept (when is this restaurant open) and the same DB migration
 * (0004), so splitting them into two screens would just add a navigation
 * hop for no real benefit. Owner/manager only, enforced by RLS
 * (opening_hours_write / special_hours_write, 0011) exactly like the
 * restaurant profile screen.
 */
export default function OpeningHoursScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const weeklyQuery = useQuery({
    queryKey: ['opening-hours', restaurantId],
    queryFn: () => fetchOpeningHours(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const specialQuery = useQuery({
    queryKey: ['special-hours', restaurantId],
    queryFn: () => fetchSpecialHours(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [week, setWeek] = useState<DayDraft[]>(emptyWeek());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!weeklyQuery.data) return;
    const byDay = emptyWeek();
    for (const row of weeklyQuery.data) {
      const day = byDay[row.dayOfWeek];
      if (!day) continue;
      if (row.isClosed) {
        day.isClosed = true;
      } else {
        day.shifts.push({ key: newShiftKey(), label: row.label ?? '', opensAt: toHHMM(row.opensAt), closesAt: toHHMM(row.closesAt) });
      }
    }
    setWeek(byDay);
  }, [weeklyQuery.data]);

  const saveWeekMutation = useMutation({
    mutationFn: (shifts: OpeningHoursShiftInput[]) => replaceOpeningHours(supabase, restaurantId!, shifts),
    onSuccess: (data) => {
      queryClient.setQueryData(['opening-hours', restaurantId], data);
      setSavedNotice(true);
    },
  });

  function updateDay(dayOfWeek: number, patch: Partial<DayDraft>) {
    setSavedNotice(false);
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  function updateShift(dayOfWeek: number, key: string, patch: Partial<ShiftDraft>) {
    setSavedNotice(false);
    setWeek((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, shifts: d.shifts.map((s) => (s.key === key ? { ...s, ...patch } : s)) } : d)),
    );
  }

  function addShift(dayOfWeek: number) {
    setWeek((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, shifts: [...d.shifts, { key: newShiftKey(), label: '', opensAt: '', closesAt: '' }] } : d)),
    );
  }

  function removeShift(dayOfWeek: number, key: string) {
    setSavedNotice(false);
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, shifts: d.shifts.filter((s) => s.key !== key) } : d)));
  }

  function handleSaveWeek() {
    setValidationError(null);
    const shifts: OpeningHoursShiftInput[] = [];

    for (const day of week) {
      if (day.isClosed) {
        shifts.push({ dayOfWeek: day.dayOfWeek, label: null, opensAt: '00:00:00', closesAt: '00:00:00', isClosed: true });
        continue;
      }
      for (const shift of day.shifts) {
        if (!shift.opensAt.trim() && !shift.closesAt.trim()) continue; // skip a blank, never-filled-in row
        if (!TIME_PATTERN.test(shift.opensAt) || !TIME_PATTERN.test(shift.closesAt)) {
          setValidationError(t('common.error'));
          return;
        }
        shifts.push({
          dayOfWeek: day.dayOfWeek,
          label: shift.label.trim() || null,
          opensAt: `${shift.opensAt}:00`,
          closesAt: `${shift.closesAt}:00`,
          isClosed: false,
        });
      }
    }

    saveWeekMutation.mutate(shifts);
  }

  // ---- special_hours (exceptions) ----------------------------------------
  const [addingException, setAddingException] = useState(false);
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');

  const upsertExceptionMutation = useMutation({
    mutationFn: () =>
      upsertSpecialHours(supabase, restaurantId!, {
        date: exceptionDate.trim(),
        opensAt: null,
        closesAt: null,
        isClosed: true,
        reason: exceptionReason.trim() || null,
      }),
    onSuccess: async () => {
      setAddingException(false);
      setExceptionDate('');
      setExceptionReason('');
      await queryClient.invalidateQueries({ queryKey: ['special-hours', restaurantId] });
    },
  });

  const deleteExceptionMutation = useMutation({
    mutationFn: (id: string) => deleteSpecialHours(supabase, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['special-hours', restaurantId] });
    },
  });

  if (!membership) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('openingHours.title') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {!isOwnerOrManager ? (
          <Text style={[styles.notice, { color: theme.textMuted, backgroundColor: theme.surface }]}>
            {t('restaurantProfile.readOnlyNotice')}
          </Text>
        ) : null}

        <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t('openingHours.weeklyTitle')}</Text>
        {week.map((day) => (
          <Card key={day.dayOfWeek} style={{ gap: spacing.md }}>
            <View style={styles.dayHeader}>
              <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t(`openingHours.days.${day.dayOfWeek}`)}</Text>
              <View style={styles.closedRow}>
                <Text style={{ color: theme.textMuted }}>{t('openingHours.closedToggle')}</Text>
                <Switch
                  value={day.isClosed}
                  onValueChange={(v) => updateDay(day.dayOfWeek, { isClosed: v })}
                  disabled={!isOwnerOrManager}
                  trackColor={{ true: theme.accent, false: theme.border }}
                />
              </View>
            </View>

            {!day.isClosed &&
              day.shifts.map((shift) => (
                <View key={shift.key} style={[styles.shiftRow, { borderColor: theme.border }]}>
                  <View style={styles.shiftTimes}>
                    <View style={styles.timeInput}>
                      <TextField
                        label={t('openingHours.opensAt')}
                        placeholder="12:00"
                        value={shift.opensAt}
                        onChangeText={(v) => updateShift(day.dayOfWeek, shift.key, { opensAt: v })}
                        editable={isOwnerOrManager}
                      />
                    </View>
                    <View style={styles.timeInput}>
                      <TextField
                        label={t('openingHours.closesAt')}
                        placeholder="16:00"
                        value={shift.closesAt}
                        onChangeText={(v) => updateShift(day.dayOfWeek, shift.key, { closesAt: v })}
                        editable={isOwnerOrManager}
                      />
                    </View>
                  </View>
                  <TextField
                    label={t('openingHours.shiftLabel')}
                    placeholder={t('openingHours.shiftLabelPlaceholder')}
                    value={shift.label}
                    onChangeText={(v) => updateShift(day.dayOfWeek, shift.key, { label: v })}
                    editable={isOwnerOrManager}
                  />
                  {isOwnerOrManager ? (
                    <Pressable accessibilityRole="button" onPress={() => removeShift(day.dayOfWeek, shift.key)} style={styles.removeShift}>
                      <Ionicons name="trash-outline" color={theme.danger} size={18} />
                      <Text style={{ color: theme.danger }}>{t('openingHours.removeShift')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

            {!day.isClosed && isOwnerOrManager ? (
              <Button label={t('openingHours.addShift')} variant="neutral" onPress={() => addShift(day.dayOfWeek)} />
            ) : null}
          </Card>
        ))}

        {validationError ? <Text style={[styles.errorText, { color: theme.danger }]}>{validationError}</Text> : null}
        {savedNotice && saveWeekMutation.isSuccess ? (
          <Text style={[styles.savedText, { color: theme.success }]}>{t('openingHours.saved')}</Text>
        ) : null}
        {isOwnerOrManager ? (
          <Button label={t('openingHours.saveButton')} onPress={handleSaveWeek} loading={saveWeekMutation.isPending} />
        ) : null}

        <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>
          {t('openingHours.specialTitle')}
        </Text>
        <Text style={{ color: theme.textMuted }}>{t('openingHours.specialSubtitle')}</Text>

        {(specialQuery.data ?? []).length === 0 && !addingException ? (
          <Text style={{ color: theme.textMuted }}>{t('openingHours.noExceptions')}</Text>
        ) : null}

        {(specialQuery.data ?? []).map((exception) => (
          <Card key={exception.id} style={styles.exceptionRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{exception.date}</Text>
              {exception.reason ? <Text style={{ color: theme.textMuted }}>{exception.reason}</Text> : null}
            </View>
            {isOwnerOrManager ? (
              <Pressable accessibilityRole="button" onPress={() => deleteExceptionMutation.mutate(exception.id)}>
                <Ionicons name="trash-outline" color={theme.danger} size={20} />
              </Pressable>
            ) : null}
          </Card>
        ))}

        {isOwnerOrManager && addingException ? (
          <Card style={{ gap: spacing.md }}>
            <TextField label={t('openingHours.date')} placeholder="2026-12-25" value={exceptionDate} onChangeText={setExceptionDate} />
            <TextField
              label={t('openingHours.reason')}
              placeholder={t('openingHours.reasonPlaceholder')}
              value={exceptionReason}
              onChangeText={setExceptionReason}
            />
            <Button
              label={t('common.save')}
              onPress={() => upsertExceptionMutation.mutate()}
              loading={upsertExceptionMutation.isPending}
              disabled={!exceptionDate.trim()}
            />
          </Card>
        ) : isOwnerOrManager ? (
          <Button label={t('openingHours.addException')} variant="neutral" onPress={() => setAddingException(true)} />
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  sectionTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  notice: { ...typeScale.caption, padding: spacing.md, borderRadius: 12 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shiftRow: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  shiftTimes: { flexDirection: 'row', gap: spacing.sm },
  timeInput: { flex: 1 },
  removeShift: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  exceptionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  savedText: { ...typeScale.caption, textAlign: 'center' },
});
