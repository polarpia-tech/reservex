import { fetchTableZones, fetchTables, updateTable, type RestaurantTable, type TableStatus, type TableZone } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { TableStatusPicker } from '@/components/tables/TableStatusPicker';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The floor view: this phase's real, non-placeholder replacement for the
 * "Phase 06" PhaseNotice stub. Grouped by zone, every active staff member
 * (not just owner/manager) can tap a table to change its status -- that is
 * genuinely enforced by RLS, not just a UI convention (see
 * scripts/verify_phase06_floor_plan.sql). Structural changes (add/edit/
 * delete a table or zone) live behind the "manage" header button, shown
 * only to owner/manager.
 */
export default function FloorViewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

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

  const [expandedTableId, setExpandedTableId] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ tableId, status }: { tableId: string; status: TableStatus }) => updateTable(supabase, tableId, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData<RestaurantTable[]>(['tables', restaurantId], (prev) =>
        (prev ?? []).map((table) => (table.id === updated.id ? updated : table)),
      );
      setExpandedTableId(null);
    },
  });

  const zones = zonesQuery.data ?? [];
  const tables = (tablesQuery.data ?? []).filter((table) => table.isActive);
  const zoneById = new Map<string, TableZone>(zones.map((z) => [z.id, z]));
  const unzonedTables = tables.filter((table) => !table.zoneId || !zoneById.has(table.zoneId));

  return (
    <>
      <Stack.Screen
        options={{
          title: t('tables.title'),
          headerRight: isOwnerOrManager
            ? () => (
                <Link href="/(tabs)/tables/manage" asChild>
                  <Pressable accessibilityRole="button" hitSlop={8}>
                    <Ionicons name="construct-outline" color={theme.accent} size={22} />
                  </Pressable>
                </Link>
              )
            : undefined,
        }}
      />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {tablesQuery.isLoading ? <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text> : null}
        {!tablesQuery.isLoading && tables.length === 0 ? <EmptyState icon="grid-outline" label={t('tables.noTables')} /> : null}

        {zones.map((zone) => {
          const zoneTables = tables.filter((table) => table.zoneId === zone.id);
          if (zoneTables.length === 0) return null;
          return (
            <View key={zone.id} style={styles.zoneSection}>
              <Text style={[styles.zoneTitle, { color: theme.textMuted }]}>{zone.name}</Text>
              {zoneTables.map((table) => (
                <TableRow
                  key={table.id}
                  table={table}
                  expanded={expandedTableId === table.id}
                  onToggle={() => setExpandedTableId((cur) => (cur === table.id ? null : table.id))}
                  onChangeStatus={(status) => statusMutation.mutate({ tableId: table.id, status })}
                  loading={statusMutation.isPending && statusMutation.variables?.tableId === table.id}
                />
              ))}
            </View>
          );
        })}

        {unzonedTables.length > 0 ? (
          <View style={styles.zoneSection}>
            <Text style={[styles.zoneTitle, { color: theme.textMuted }]}>{t('tables.unzoned')}</Text>
            {unzonedTables.map((table) => (
              <TableRow
                key={table.id}
                table={table}
                expanded={expandedTableId === table.id}
                onToggle={() => setExpandedTableId((cur) => (cur === table.id ? null : table.id))}
                onChangeStatus={(status) => statusMutation.mutate({ tableId: table.id, status })}
                loading={statusMutation.isPending && statusMutation.variables?.tableId === table.id}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function TableRow({
  table,
  expanded,
  onToggle,
  onChangeStatus,
  loading,
}: {
  table: RestaurantTable;
  expanded: boolean;
  onToggle: () => void;
  onChangeStatus: (status: TableStatus) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onToggle}>
      <Card style={{ gap: spacing.sm }}>
        <View style={styles.tableHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '700' }}>{table.label}</Text>
            {table.isVip ? <Ionicons name="star" color={theme.accent} size={14} /> : null}
            <Text style={{ color: theme.textMuted }}>
              {table.capacityMin}–{table.capacityMax} {t('tables.capacity').toLowerCase()}
            </Text>
          </View>
          <StatusPill status={table.status} label={t(`tables.status.${table.status}`)} />
        </View>
        {expanded ? (
          <View style={[styles.expanded, { borderColor: theme.border }]}>
            <Text style={[styles.changeStatusLabel, { color: theme.textMuted }]}>{t('tables.changeStatus')}</Text>
            {loading ? (
              <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
            ) : (
              <TableStatusPicker value={table.status} onChange={onChangeStatus} />
            )}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  zoneSection: { gap: spacing.sm },
  zoneTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expanded: { paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
  changeStatusLabel: { ...typeScale.caption },
});