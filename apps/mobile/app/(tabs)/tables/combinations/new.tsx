import { createTableCombination, fetchTables } from '@reservex/core';
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

export default function NewTableCombinationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () => fetchTables(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const tables = (tablesQuery.data ?? []).filter((tb) => tb.isActive);

  const [name, setName] = useState('');
  const [capacityMin, setCapacityMin] = useState('6');
  const [capacityMax, setCapacityMax] = useState('10');
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  function toggleTable(tableId: string) {
    setSelectedTableIds((prev) => (prev.includes(tableId) ? prev.filter((id) => id !== tableId) : [...prev, tableId]));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const min = Number.parseInt(capacityMin, 10) || 1;
      const max = Number.parseInt(capacityMax, 10) || min;
      return createTableCombination(supabase, restaurantId!, {
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

  function handleSubmit() {
    setValidationError(null);
    if (selectedTableIds.length < 2) {
      setValidationError(t('tables.combinations.needAtLeastTwo'));
      return;
    }
    mutation.mutate();
  }

  return (
    <>
      <Stack.Screen options={{ title: t('tables.combinations.add') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField label={t('tables.combinations.name')} placeholder={t('tables.combinations.namePlaceholder')} value={name} onChangeText={setName} />
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
          <Button label={t('common.save')} onPress={handleSubmit} loading={mutation.isPending} disabled={!name.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
