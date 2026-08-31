import { createTableZone, type TableZoneType } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const ZONE_TYPES: TableZoneType[] = [
  'indoor', 'outdoor', 'terrace', 'garden', 'bar', 'vip', 'private_room', 'smoking', 'non_smoking', 'event',
];

export default function NewZoneScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [zoneType, setZoneType] = useState<TableZoneType>('indoor');

  const mutation = useMutation({
    mutationFn: () => {
      if (!membership) throw new Error('No restaurant loaded.');
      return createTableZone(supabase, membership.restaurant.id, { name: name.trim(), zoneType });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['table-zones', membership?.restaurant.id] });
      router.back();
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t('tables.addZone') }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
          <TextField
            label={t('tables.zoneName')}
            placeholder={t('tables.zoneNamePlaceholder')}
            value={name}
            onChangeText={setName}
          />

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

          {mutation.isError ? <Text style={[styles.errorText, { color: theme.danger }]}>{t('common.error')}</Text> : null}

          <Button label={t('common.save')} onPress={() => mutation.mutate()} loading={mutation.isPending} disabled={!name.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  field: { gap: spacing.sm },
  fieldLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
  errorText: { ...typeScale.caption, textAlign: 'center' },
});
