import { fetchTableZones, fetchTables } from '@reservex/core';
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
 * Structural management: create/edit/delete zones and tables. Only reachable
 * from the floor view's header icon, which only renders for owner/manager --
 * but this screen re-checks `isOwnerOrManager` itself and shows a plain
 * notice instead of the forms if somehow reached otherwise (e.g. a stale
 * deep link after a role change), consistent with every other Phase 05/06
 * screen's honesty about what's a UI convention vs a real RLS boundary
 * (`table_zones_write` IS owner/manager-only at the database level;
 * `tables_update` is not -- see packages/core/src/api/tables.ts).
 */
export default function ManageFloorPlanScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;

  const zonesQuery = useQuery({
    queryKey: ['table-zones', restaurantId],
    queryFn: () => fetchTableZones(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });
  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () => fetchTables(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const zones = zonesQuery.data ?? [];
  const tables = (tablesQuery.data ?? []).filter((table) => table.isActive);
  const zoneName = (zoneId: string | null) => zones.find((z) => z.id === zoneId)?.name ?? t('tables.unzoned');

  return (
    <>
      <Stack.Screen options={{ title: t('tables.manage') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {!isOwnerOrManager ? (
          <Text style={[styles.notice, { color: theme.textMuted, backgroundColor: theme.surface }]}>
            {t('restaurantProfile.readOnlyNotice')}
          </Text>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t('tables.manageZones')}</Text>
            {zones.length === 0 ? <Text style={{ color: theme.textMuted }}>{t('tables.noZones')}</Text> : null}
            {zones.map((zone) => (
              <Link key={zone.id} href={`/(tabs)/tables/zones/${zone.id}`} asChild>
                <Pressable accessibilityRole="button">
                  <Card style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{zone.name}</Text>
                      <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>{t(`zoneTypes.${zone.zoneType}`)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" color={theme.textMuted} size={20} />
                  </Card>
                </Pressable>
              </Link>
            ))}
            <Button label={t('tables.addZone')} variant="neutral" onPress={() => router.push('/(tabs)/tables/zones/new')} />

            <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>{t('tables.title')}</Text>
            {tables.length === 0 ? <Text style={{ color: theme.textMuted }}>{t('tables.noTables')}</Text> : null}
            {tables.map((table) => (
              <Link key={table.id} href={`/(tabs)/tables/${table.id}`} asChild>
                <Pressable accessibilityRole="button">
                  <Card style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{table.label}</Text>
                      <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>
                        {zoneName(table.zoneId)} · {table.capacityMin}–{table.capacityMax}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" color={theme.textMuted} size={20} />
                  </Card>
                </Pressable>
              </Link>
            ))}
            <Button label={t('tables.addTable')} variant="neutral" onPress={() => router.push('/(tabs)/tables/new')} />

            <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>{t('tables.combinations.title')}</Text>
            <Link href="/(tabs)/tables/combinations" asChild>
              <Pressable accessibilityRole="button">
                <Card style={styles.row}>
                  <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t('tables.combinations.manage')}</Text>
                  <Ionicons name="chevron-forward" color={theme.textMuted} size={20} />
                </Card>
              </Pressable>
            </Link>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  sectionTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  notice: { ...typeScale.caption, padding: spacing.md, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
