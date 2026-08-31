import {
  createReminderRule,
  deleteReminderRule,
  fetchReminderRules,
  updateReminderRule,
  type NotificationChannel,
  type ReminderRule,
} from '@reservex/core';
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

// 'in_app' deliberately excluded -- see reminder_rules_channel_not_in_app
// (migration 0016): an in-app row is marked delivered the instant it's
// queued, which would make an "in-app reminder" show up at booking time,
// not before arrival. Only channels a real dispatcher could eventually
// delay-deliver make sense here.
const REMINDER_CHANNELS: NotificationChannel[] = ['push', 'email', 'sms', 'whatsapp'];

/**
 * Owner/manager only (reminder_rules_write RLS, 0011). One flat screen for
 * add + list + toggle-active + delete -- same reasoning as the opening
 * hours screen: this is a small, single-restaurant config list, not
 * complex enough to earn its own multi-screen stack.
 */
export default function ReminderRulesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    queryKey: ['reminder-rules', restaurantId],
    queryFn: () => fetchReminderRules(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [name, setName] = useState('');
  const [minutesBeforeStart, setMinutesBeforeStart] = useState('120');
  const [channel, setChannel] = useState<NotificationChannel>('push');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['reminder-rules', restaurantId] });

  const createMutation = useMutation({
    mutationFn: () =>
      createReminderRule(supabase, restaurantId!, {
        name: name.trim(),
        minutesBeforeStart: Number(minutesBeforeStart),
        channel,
        isActive: true,
      }),
    onSuccess: () => {
      setName('');
      setMinutesBeforeStart('120');
      invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (rule: ReminderRule) => updateReminderRule(supabase, rule.id, { isActive: !rule.isActive }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteReminderRule(supabase, ruleId),
    onSuccess: invalidate,
  });

  function confirmDelete(rule: ReminderRule) {
    Alert.alert(t('notifications.deleteRuleConfirmTitle'), t('notifications.deleteRuleConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteMutation.mutate(rule.id) },
    ]);
  }

  const minutesValid = /^\d+$/.test(minutesBeforeStart) && Number(minutesBeforeStart) > 0;
  const canSubmit = isOwnerOrManager && name.trim().length > 0 && minutesValid && Boolean(restaurantId);

  return (
    <>
      <Stack.Screen options={{ title: t('notifications.reminderRulesTitle') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textMuted }}>{t('notifications.reminderRulesSubtitle')}</Text>

        {(rulesQuery.data ?? []).length === 0 && !rulesQuery.isLoading ? (
          <Text style={{ color: theme.textMuted }}>{t('notifications.noReminderRules')}</Text>
        ) : null}

        {(rulesQuery.data ?? []).map((rule) => (
          <Card key={rule.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{rule.name}</Text>
              <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>
                {t('notifications.minutesBeforeStart')}: {rule.minutesBeforeStart} · {t(`notifications.channels.${rule.channel}`)}
              </Text>
            </View>
            {isOwnerOrManager ? (
              <>
                <Switch value={rule.isActive} onValueChange={() => toggleMutation.mutate(rule)} trackColor={{ true: theme.accent }} />
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmDelete(rule)}>
                  <Ionicons name="trash-outline" color={theme.danger} size={20} />
                </Pressable>
              </>
            ) : null}
          </Card>
        ))}

        {isOwnerOrManager ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('notifications.addReminderRule')}</Text>
            <TextField label={t('notifications.ruleName')} placeholder={t('notifications.ruleNamePlaceholder')} value={name} onChangeText={setName} />
            <TextField
              label={t('notifications.minutesBeforeStart')}
              value={minutesBeforeStart}
              onChangeText={setMinutesBeforeStart}
              keyboardType="number-pad"
            />
            <View style={styles.chipRow}>
              {REMINDER_CHANNELS.map((c) => {
                const active = c === channel;
                return (
                  <Pressable
                    key={c}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setChannel(c)}
                    style={[styles.chip, { backgroundColor: active ? theme.accent : theme.surface, borderColor: active ? theme.accent : theme.border }]}
                  >
                    <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600' }}>{t(`notifications.channels.${c}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label={t('notifications.addReminderRule')} onPress={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!canSubmit} />
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
});
