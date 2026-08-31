import { deleteTable, fetchTableZones, fetchTables, updateTable, type TableShape } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const SHAPES: TableShape[] = ['round', 'square', 'rectangle'];

/**
 * Structural edit for one table -- label, zone, capacity, shape, VIP/
 * combinable flags -- plus deactivate/reactivate and delete. Status
 * (available/seated/cleaning/...) is deliberately NOT edited here: that's
 * the floor view's job (app/(tabs)/tables/index.tsx), used by every staff
 * member during service, not this owner/manager-only management screen.
 */
export default function EditTableScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { tableId } = useLocalSearchParams<{ tableId: string }>();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () => fetchTables(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const zonesQuery = useQuery({
    queryKey: ['table-zones', restaurantId],
    queryFn: () => fetchTableZones(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const table = tablesQuery.data?.find((t2) => t2.id === tableId);

  const [label, setLabel] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [capacityMin, setCapacityMin] = useState('');
  const [capacityMax, setCapacityMax] = useState('');
  const [shape, setShape] = useState<TableShape>('square');
  const [isVip, setIsVip] = useState(false);
  const [isCombinable, setIsCombinable] = useState(true);

  useEffect(() => {
    if (!table) return;
    setLabel(table.label);
    setZoneId(table.zoneId);
    setCapacityMin(String(table.capacityMin));
    setCapacityMax(String(table.capacityMax));
    setShape(table.shape);
    setIsVip(table.isVip);
    setIsCombinable(table.isCombinable);
  }, [table]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const min = Number.parseInt(capacityMin, 10) || 1;
      const max = Number.parseInt(capacityMax, 10) || min;
      return updateTable(supabase, tableId, {
        label: label.trim(),
        zoneId,
        capacityMin: min,
        capacityMax: Math.max(max, min),
        shape,
        isVip,
        isCombinable,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tables', restaurantId] });
      router.back();
    },
  });

  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) => updateTable(supabase, tableId, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tables', restaurantId] });
      router.back();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTable(supabase, tableId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tables', restaurantId] });
      router.back();
    },
  });

  function confirmDelete() {
    Alert.alert(t('tables.deleteTableConfirmTitle'), t('tables.deleteTableConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('tables.deleteTable'), style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  }

  const zones = zonesQuery.data ?? [];

  if (!table) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: table.label }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField label={t('tables.label')} value={label} onChangeText={setLabel} />

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('tables.zones')}</Text>
            <View style={styles.grid}>
              <Chip label={t('tables.unzoned')} active={zoneId === null} onPress={() => setZoneId(null)} />
              {zones.map((zone) => (
                <Chip key={zone.id} label={zone.name} active={zoneId === zone.id} onPress={() => setZoneId(zone.id)} />
              ))}
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.half}>
              <TextField label={t('tables.capacityMin')} keyboardType="number-pad" value={capacityMin} onChangeText={setCapacityMin} />
            </View>
            <View style={styles.half}>
              <TextField label={t('tables.capacityMax')} keyboardType="number-pad" value={capacityMax} onChangeText={setCapacityMax} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('tables.shape')}</Text>
            <View style={styles.grid}>
              {SHAPES.map((s) => (
                <Chip key={s} label={t(`tableShapes.${s}`)} active={shape === s} onPress={() => setShape(s)} />
              ))}
            </View>
          </View>

          <View style={styles.switchRow}>
            <Text style={{ color: theme.textPrimary }}>{t('tables.isVip')}</Text>
            <Switch value={isVip} onValueChange={setIsVip} trackColor={{ true: theme.accent, false: theme.border }} />
          </View>
          <View style={styles.switchRow}>
            <Text style={{ color: theme.textPrimary }}>{t('tables.isCombinable')}</Text>
            <Switch value={isCombinable} onValueChange={setIsCombinable} trackColor={{ true: theme.accent, false: theme.border }} />
          </View>

          {saveMutation.isError ? <Text style={[styles.errorText, { color: theme.danger }]}>{t('common.error')}</Text> : null}
          {saveMutation.isSuccess ? <Text style={{ color: theme.success, textAlign: 'center' }}>{t('tables.saved')}</Text> : null}

          <Button label={t('common.save')} onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!label.trim()} />

          <View style={styles.dangerSection}>
            {table.isActive ? (
              <Button
                label={t('tables.deactivateTable')}
                variant="neutral"
                onPress={() => activeMutation.mutate(false)}
                loading={activeMutation.isPending}
              />
            ) : (
              <Button label={t('tables.reactivateTable')} onPress={() => activeMutation.mutate(true)} loading={activeMutation.isPending} />
            )}
            <Button label={t('tables.deleteTable')} variant="neutral" onPress={confirmDelete} loading={deleteMutation.isPending} />
          </View>
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
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  dangerSection: { gap: spacing.sm, marginTop: spacing.lg },
});
