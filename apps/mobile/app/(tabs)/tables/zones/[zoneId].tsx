import { deleteTableZone, fetchTableZones, updateTableZone, type TableZoneType } from '@reservex/core';
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

const ZONE_TYPES: TableZoneType[] = [
  'indoor', 'outdoor', 'terrace', 'garden', 'bar', 'vip', 'private_room', 'smoking', 'non_smoking', 'event',
];

export default function EditZoneScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const zonesQuery = useQuery({
    queryKey: ['table-zones', restaurantId],
    queryFn: () => fetchTableZones(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const zone = zonesQuery.data?.find((z) => z.id === zoneId);

  const [name, setName] = useState('');
  const [zoneType, setZoneType] = useState<TableZoneType>('indoor');

  useEffect(() => {
    if (zone) {
      setName(zone.name);
      setZoneType(zone.zoneType);
    }
  }, [zone]);

  const saveMutation = useMutation({
    mutationFn: () => updateTableZone(supabase, zoneId, { name: name.trim(), zoneType }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['table-zones', restaurantId] });
      router.back();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTableZone(supabase, zoneId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['table-zones', restaurantId] });
      await queryClient.invalidateQueries({ queryKey: ['tables', restaurantId] });
      router.back();
    },
  });

  function confirmDelete() {
    Alert.alert(t('tables.deleteZoneConfirmTitle'), t('tables.deleteZoneConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('tables.deleteZone'), style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  }

  if (!zone) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('tables.editZone') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField label={t('tables.zoneName')} value={name} onChangeText={setName} />

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t('tables.zoneType')}</Text>
            <View style={styles.grid}>
              {ZONE_TYPES.map((type) => {
                const active = type === zoneType;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setZoneType(type)}
                    style={[styles.chip, { backgroundColor: active ? theme.accent : theme.surface, borderColor: active ? theme.accent : theme.border }]}
                  >
                    <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600' }}>{t(`zoneTypes.${type}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {saveMutation.isError ? <Text style={[styles.errorText, { color: theme.danger }]}>{t('common.error')}</Text> : null}

          <Button label={t('common.save')} onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!name.trim()} />
          <Button label={t('tables.deleteZone')} variant="neutral" onPress={confirmDelete} loading={deleteMutation.isPending} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
