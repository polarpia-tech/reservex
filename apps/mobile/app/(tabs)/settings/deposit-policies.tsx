import {
  createDepositPolicy,
  deleteDepositPolicy,
  fetchDepositPolicies,
  updateDepositPolicy,
  type DepositPolicy,
  type DepositAppliesTo,
  type DepositCalcType,
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

const APPLIES_TO: DepositAppliesTo[] = ['all', 'event', 'vip', 'party_size_threshold'];
const CALC_TYPES: DepositCalcType[] = ['fixed', 'per_person', 'percentage'];

/**
 * Owner/manager only (deposit_policies_write RLS, 0011 -- unchanged since
 * Phase 02, this screen is the first UI to actually exercise it). One flat
 * add + list + toggle-active + delete screen, same reasoning as
 * reminder-rules.tsx: a small single-restaurant config list, not complex
 * enough to earn its own multi-screen stack.
 *
 * Money actually moving (creating/capturing/refunding a deposit) never
 * happens from this screen -- it only configures the RULES. See
 * reservations/[reservationId].tsx for where captureNoShowDeposit /
 * refundDeposit are actually invoked, each behind an explicit confirmation.
 */
export default function DepositPoliciesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const policiesQuery = useQuery({
    queryKey: ['deposit-policies', restaurantId],
    queryFn: () => fetchDepositPolicies(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<DepositAppliesTo>('all');
  const [calculationType, setCalculationType] = useState<DepositCalcType>('fixed');
  const [amountCents, setAmountCents] = useState('2000');
  const [percentage, setPercentage] = useState('20');
  const [percentageBaseAmountCents, setPercentageBaseAmountCents] = useState('4000');
  const [partySizeThreshold, setPartySizeThreshold] = useState('6');
  const [cancellationWindowHours, setCancellationWindowHours] = useState('24');
  const [refundPolicyText, setRefundPolicyText] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['deposit-policies', restaurantId] });

  const createMutation = useMutation({
    mutationFn: () =>
      createDepositPolicy(supabase, {
        restaurantId: restaurantId!,
        name: name.trim(),
        appliesTo,
        calculationType,
        amountCents: calculationType === 'fixed' || calculationType === 'per_person' ? Number(amountCents) : null,
        percentage: calculationType === 'percentage' ? Number(percentage) : null,
        percentageBaseAmountCents: calculationType === 'percentage' ? Number(percentageBaseAmountCents) : null,
        partySizeThreshold: appliesTo === 'party_size_threshold' ? Number(partySizeThreshold) : null,
        cancellationWindowHours: Number(cancellationWindowHours),
        refundPolicyText: refundPolicyText.trim() || null,
        isActive: true,
      }),
    onSuccess: () => {
      setName('');
      setRefundPolicyText('');
      invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (policy: DepositPolicy) => updateDepositPolicy(supabase, policy.id, { isActive: !policy.isActive }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (policyId: string) => deleteDepositPolicy(supabase, policyId),
    onSuccess: invalidate,
  });

  function confirmDelete(policy: DepositPolicy) {
    Alert.alert(t('payments.deletePolicyConfirmTitle'), t('payments.deletePolicyConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteMutation.mutate(policy.id) },
    ]);
  }

  const amountValid = calculationType !== 'percentage' ? /^\d+$/.test(amountCents) && Number(amountCents) > 0 : true;
  const percentageValid =
    calculationType === 'percentage'
      ? /^\d+(\.\d+)?$/.test(percentage) && Number(percentage) > 0 && /^\d+$/.test(percentageBaseAmountCents) && Number(percentageBaseAmountCents) > 0
      : true;
  const thresholdValid = appliesTo === 'party_size_threshold' ? /^\d+$/.test(partySizeThreshold) && Number(partySizeThreshold) > 0 : true;
  const windowValid = /^\d+$/.test(cancellationWindowHours) && Number(cancellationWindowHours) >= 0;
  const canSubmit = isOwnerOrManager && name.trim().length > 0 && amountValid && percentageValid && thresholdValid && windowValid && Boolean(restaurantId);

  return (
    <>
      <Stack.Screen options={{ title: t('payments.policiesTitle') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textMuted }}>{t('payments.policiesSubtitle')}</Text>

        {(policiesQuery.data ?? []).length === 0 && !policiesQuery.isLoading ? (
          <Text style={{ color: theme.textMuted }}>{t('payments.noPolicies')}</Text>
        ) : null}

        {(policiesQuery.data ?? []).map((policy) => (
          <Card key={policy.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{policy.name}</Text>
              <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>
                {t(`payments.appliesTo.${policy.appliesTo}`)} · {t(`payments.calculationType.${policy.calculationType}`)}
                {policy.calculationType === 'percentage'
                  ? ` (${policy.percentage}%)`
                  : policy.amountCents != null
                    ? ` (${(policy.amountCents / 100).toFixed(2)})`
                    : ''}
              </Text>
            </View>
            {isOwnerOrManager ? (
              <>
                <Switch value={policy.isActive} onValueChange={() => toggleMutation.mutate(policy)} trackColor={{ true: theme.accent }} />
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmDelete(policy)}>
                  <Ionicons name="trash-outline" color={theme.danger} size={20} />
                </Pressable>
              </>
            ) : null}
          </Card>
        ))}

        {isOwnerOrManager ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('payments.addPolicy')}</Text>
            <TextField label={t('payments.policyName')} placeholder={t('payments.policyNamePlaceholder')} value={name} onChangeText={setName} />

            <View style={styles.chipRow}>
              {APPLIES_TO.map((option) => {
                const active = option === appliesTo;
                return (
                  <Chip key={option} label={t(`payments.appliesTo.${option}`)} active={active} onPress={() => setAppliesTo(option)} />
                );
              })}
            </View>
            {appliesTo === 'party_size_threshold' ? (
              <TextField
                label={t('payments.partySizeThreshold')}
                keyboardType="number-pad"
                value={partySizeThreshold}
                onChangeText={setPartySizeThreshold}
              />
            ) : null}

            <View style={styles.chipRow}>
              {CALC_TYPES.map((option) => {
                const active = option === calculationType;
                return (
                  <Chip key={option} label={t(`payments.calculationType.${option}`)} active={active} onPress={() => setCalculationType(option)} />
                );
              })}
            </View>
            {calculationType === 'fixed' || calculationType === 'per_person' ? (
              <TextField label={t('payments.amountCents')} keyboardType="number-pad" value={amountCents} onChangeText={setAmountCents} />
            ) : (
              <>
                <TextField label={t('payments.percentage')} keyboardType="decimal-pad" value={percentage} onChangeText={setPercentage} />
                <TextField
                  label={t('payments.percentageBaseAmountCents')}
                  keyboardType="number-pad"
                  value={percentageBaseAmountCents}
                  onChangeText={setPercentageBaseAmountCents}
                />
              </>
            )}

            <TextField
              label={t('payments.cancellationWindowHours')}
              keyboardType="number-pad"
              value={cancellationWindowHours}
              onChangeText={setCancellationWindowHours}
            />
            <TextField
              label={t('payments.refundPolicyText')}
              placeholder={t('payments.refundPolicyTextPlaceholder')}
              value={refundPolicyText}
              onChangeText={setRefundPolicyText}
            />

            <Button label={t('payments.addPolicy')} onPress={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!canSubmit} />
          </Card>
        ) : null}
      </ScrollView>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
});
