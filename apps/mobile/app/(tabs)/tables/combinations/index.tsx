import { fetchTableCombinations, fetchTables } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * table_combinations (migration 0003) define which physical tables may be
 * merged into one bookable unit for a large party -- this is the screen
 * that finally gives owner/manager a way to define them, so the Phase 07
 * reservation engine's combination fallback (0013's
 * get_available_table_combinations) actually has something to offer beyond
 * the demo data the verification script inserts by hand.
 */
export default function TableCombinationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;

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

  const tables = tablesQuery.data ?? [];
  const labelFor = (tableId: string) => tables.find((tb) => tb.id === tableId)?.label ?? '?';

  return (
    <>
      <Stack.Screen options={{ title: t('tables.combinations.title') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {!isOwnerOrManager ? (
          <Text style={[styles.notice, { color: theme.textMuted, backgroundColor: theme.surface }]}>{t('restaurantProfile.readOnlyNotice')}</Text>
        ) : null}

        {(combinationsQuery.data ?? []).length === 0 ? <Text style={{ color: theme.textMuted }}>{t('tables.combinations.noCombinations')}</Text> : null}

        {(combinationsQuery.data ?? []).map((combo) => (
          <Link key={combo.id} href={`/(tabs)/tables/combinations/${combo.id}`} asChild>
            <Pressable accessibilityRole="button" disabled={!isOwnerOrManager}>
              <Card style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>
                    {combo.name}
                    {!combo.isActive ? ` (${t('tables.combinations.deactivate')})` : ''}
                  </Text>
                  <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>
                    {combo.tableIds.map(labelFor).join(' + ')} · {combo.combinedCapacityMin}–{combo.combinedCapacityMax}
                  </Text>
                </View>
                {isOwnerOrManager ? <Ionicons name="chevron-forward" color={theme.textMuted} size={20} /> : null}
              </Card>
            </Pressable>
          </Link>
        ))}

        {isOwnerOrManager ? (
          <Button label={t('tables.combinations.add')} variant="neutral" onPress={() => router.push('/(tabs)/tables/combinations/new')} />
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  notice: { ...typeScale.caption, padding: spacing.md, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
