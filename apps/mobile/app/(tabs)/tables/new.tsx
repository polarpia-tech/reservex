import { createTable, fetchTableZones, type TableShape } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const SHAPES: TableShape[] = ['round', 'square', 'rectangle'];

export default function NewTableScreen() {
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

  const [label, setLabel] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [capacityMin, setCapacityMin] = useState('2');
  const [capacityMax, setCapacityMax] = useState('4');
  const [shape, setShape] = useState<TableShape>('square');
  const [isVip, setIsVip] = useState(false);
  const [isCombinable, setIsCombinable] = useState(true);

  const mutation = useMutation({
    mutationFn: () => {
      if (!restaurantId) throw new Error('No restaurant loaded.');
      const min = Number.parseInt(capacityMin, 10) || 1;
      const max = Number.parseInt(capacityMax, 10) || min;
      return createTable(supabase, restaurantId, {
        zoneId,
        label: label.trim(),
        capacityMin: min,
        capacityMax: Math.max(max, min),
        isVip,
        isCombinable,
        shape,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tables', restaurantId] });
      router.back();
    },
  });

  const zones = zonesQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('tables.addTable') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField label={t('tables.label')} placeholder={t('tables.labelPlaceholder')} value={label} onChangeText={setLabel} />

          {zones.length > 0 ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('tables.zones')}</Text>
              <View style={styles.grid}>
                <ZoneChip label={t('tables.unzoned')} active={zoneId === null} onPress={() => setZoneId(null)} />
                {zones.map((zone) => (
                  <ZoneChip key={zone.id} label={zone.name} active={zoneId === zone.id} onPress={() => setZoneId(zone.id)} />
                ))}
              </View>
            </View>
          ) : null}

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
                <ZoneChip key={s} label={t(`tableShapes.${s}`)} active={shape === s} onPress={() => setShape(s)} />
              ))}
            </View>
          </View>

          <SwitchRow label={t('tables.isVip')} value={isVip} onValueChange={setIsVip} />
          <SwitchRow label={t('tables.isCombinable')} value={isCombinable} onValueChange={setIsCombinable} />

          {mutation.isError ? <Text style={[styles.errorText, { color: theme.danger }]}>{t('common.error')}</Text> : null}

          <Button label={t('common.save')} onPress={() => mutation.mutate()} loading={mutation.isPending} disabled={!label.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function ZoneChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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

function SwitchRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <Text style={{ color: theme.textPrimary }}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.accent, false: theme.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
