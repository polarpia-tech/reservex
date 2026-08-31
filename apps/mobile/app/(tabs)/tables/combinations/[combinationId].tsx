import { deleteTableCombination, fetchTableCombinations, fetchTables, updateTableCombination } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

export default function EditTableCombinationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { combinationId } = useLocalSearchParams<{ combinationId: string }>();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const combinationsQuery = useQuery({
    queryKey: ['table-combinations', restaurantId],
    queryFn: () => fetchTableCombinations(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () => fetchTables(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const combination = combinationsQuery.data?.find((c) => c.id === combinationId);
  const tables = (tablesQuery.data ?? []).filter((tb) => tb.isActive);

  const [name, setName] = useState('');
  const [capacityMin, setCapacityMin] = useState('');
  const [capacityMax, setCapacityMax] = useState('');
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!combination) return;
    setName(combination.name);
    setCapacityMin(String(combination.combinedCapacityMin));
    setCapacityMax(String(combination.combinedCapacityMax));
    setSelectedTableIds(combination.tableIds);
  }, [combination]);

  function toggleTable(tableId: string) {
    setSelectedTableIds((prev) => (prev.includes(tableId) ? prev.filter((id) => id !== tableId) : [...prev, tableId]));
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const min = Number.parseInt(capacityMin, 10) || 1;
      const max = Number.parseInt(capacityMax, 10) || min;
      return updateTableCombination(supabase, combinationId, {
        name: name.trim(),
        combinedCapacityMin: min,
        combinedCapacityMax: Math.max(max, min),
        tableIds: selectedTableIds,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['table-combinations', restaurantId] });
      router.back();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) => updateTableCombination(supabase, combinationId, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['table-combinations', restaurantId] });
      router.back();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTableCombination(supabase, combinationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['table-combinations', restaurantId] });
      router.back();
    },
  });

  function handleSave() {
    setValidationError(null);
    if (selectedTableIds.length < 2) {
      setValidationError(t('tables.combinations.needAtLeastTwo'));
      return;
    }
    saveMutation.mutate();
  }

  function confirmDelete() {
    Alert.alert(t('tables.combinations.deleteConfirmTitle'), t('tables.combinations.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  }

  if (!combination) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: combination.name }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField label={t('tables.combinations.name')} value={name} onChangeText={setName} />
          <View style={styles.row}>
            <View style={styles.half}>
              <TextField label={t('tables.capacityMin')} keyboardType="number-pad" value={capacityMin} onChangeText={setCapacityMin} />
            </View>
            <View style={styles.half}>
              <TextField label={t('tables.capacityMax')} keyboardType="number-pad" value={capacityMax} onChangeText={setCapacityMax} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('tables.combinations.selectTables')}</Text>
            <View style={styles.grid}>
              {tables.map((tb) => {
                const active = selectedTableIds.includes(tb.id);
                return (
                  <Pressable
                    key={tb.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => toggleTable(tb.id)}
                    style={[styles.chip, { backgroundColor: active ? theme.accent : theme.surface, borderColor: active ? theme.accent : theme.border }]}
                  >
                    <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600' }}>{tb.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {validationError ? <Text style={[styles.errorText, { color: theme.danger }]}>{validationError}</Text> : null}
          <Button label={t('common.save')} onPress={handleSave} loading={saveMutation.isPending} disabled={!name.trim()} />

          <View style={styles.dangerSection}>
            {combination.isActive ? (
              <Button label={t('tables.combinations.deactivate')} variant="neutral" onPress={() => toggleActiveMutation.mutate(false)} loading={toggleActiveMutation.isPending} />
            ) : (
              <Button label={t('tables.combinations.reactivate')} onPress={() => toggleActiveMutation.mutate(true)} loading={toggleActiveMutation.isPending} />
            )}
            <Button label={t('common.delete')} variant="neutral" onPress={confirmDelete} loading={deleteMutation.isPending} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
  dangerSection: { gap: spacing.sm, marginTop: spacing.lg },
});
