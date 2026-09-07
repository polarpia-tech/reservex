import type { RestaurantTable, TableStatus, TableZone } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { toneFor } from '@/components/ui/StatusPill';
import { useTheme } from '@/theme/ThemeProvider';

import { TableStatusPicker } from './TableStatusPicker';

/**
 * Phase 5 of the Live Availability upgrade: the "auto-arranged grid" visual
 * table map -- a simpler, lower-risk sibling of tables/index.tsx's existing
 * list view, not a literal drag-positioned floor plan. The DB has carried
 * floor-plan canvas coordinates on `tables` (pos_x/pos_y/width/height/
 * rotation_deg, migration 0003) since day one, but no restaurant using this
 * app has ever had them set -- no screen has ever written them -- so a map
 * that actually respected those coordinates would render every table
 * stacked at the same (null) position for every real restaurant today.
 * Building a real drag-to-arrange editor is a materially bigger feature
 * (new gesture/SVG dependencies, a position-persistence UI, multi-user
 * edit conflicts) that this phase deliberately defers; what ships here is
 * genuinely useful today: tables grouped by zone (same grouping as the
 * list) rendered as shape-aware, status-colored tiles in a wrapped grid,
 * so a host can scan the floor's state at a glance instead of reading a
 * list top to bottom. `shape` (round/square/rectangle) IS real, staff-set
 * data (set via the existing Add/Edit Table form) and is honoured here via
 * each tile's border radius.
 *
 * Deliberately reuses the exact same `tables`/`table-zones` queries,
 * `expandedTableId` selection state and `updateTable` status-change
 * mutation as the list view (owned by the parent screen, tables/index.tsx)
 * -- this component is a pure alternate renderer, never its own data
 * source, so List and Map can never show different data or drift out of
 * sync with each other.
 */
export interface TableMapViewProps {
  zones: TableZone[];
  tables: RestaurantTable[];
  expandedTableId: string | null;
  onToggleTable: (tableId: string) => void;
  onChangeStatus: (tableId: string, status: TableStatus) => void;
  statusLoadingTableId: string | null;
}

export function TableMapView({ zones, tables, expandedTableId, onToggleTable, onChangeStatus, statusLoadingTableId }: TableMapViewProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const zoneById = new Map<string, TableZone>(zones.map((z) => [z.id, z]));
  const unzonedTables = tables.filter((table) => !table.zoneId || !zoneById.has(table.zoneId));

  const sections: { key: string; title: string; zoneTables: RestaurantTable[] }[] = [
    ...zones
      .map((zone) => ({ key: zone.id, title: zone.name, zoneTables: tables.filter((table) => table.zoneId === zone.id) }))
      .filter((section) => section.zoneTables.length > 0),
  ];
  if (unzonedTables.length > 0) {
    sections.push({ key: 'unzoned', title: t('tables.unzoned'), zoneTables: unzonedTables });
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {sections.map((section) => {
        const expandedInThisSection = section.zoneTables.find((table) => table.id === expandedTableId);
        return (
          <View key={section.key} style={styles.zoneSection}>
            <Text style={[styles.zoneTitle, { color: theme.textMuted }]}>{section.title}</Text>
            <View style={styles.grid}>
              {section.zoneTables.map((table) => (
                <TableTile
                  key={table.id}
                  table={table}
                  selected={table.id === expandedTableId}
                  onPress={() => onToggleTable(table.id)}
                />
              ))}
            </View>
            {expandedInThisSection ? (
              <Card style={styles.pickerCard}>
                <View style={styles.pickerHeaderRow}>
                  <Text style={{ color: theme.textPrimary, fontWeight: '700' }}>{expandedInThisSection.label}</Text>
                  <Text style={[styles.changeStatusLabel, { color: theme.textMuted }]}>{t('tables.changeStatus')}</Text>
                </View>
                {statusLoadingTableId === expandedInThisSection.id ? (
                  <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
                ) : (
                  <TableStatusPicker value={expandedInThisSection.status} onChange={(status) => onChangeStatus(expandedInThisSection.id, status)} />
                )}
              </Card>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function TableTile({ table, selected, onPress }: { table: RestaurantTable; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = toneFor(table.status, theme);

  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={styles.tileWrap}>
      <View
        style={[
          styles.tile,
          shapeStyleFor(table.shape),
          {
            backgroundColor: `${tone}1A`,
            borderColor: selected ? theme.accent : tone,
            borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.tileTopRow}>
          <Text style={[styles.tileLabel, { color: theme.textPrimary }]} numberOfLines={1}>
            {table.label}
          </Text>
          {table.isVip ? <Ionicons name="star" color={theme.accent} size={12} /> : null}
        </View>
        <Text style={[styles.tileCapacity, { color: theme.textMuted }]}>
          {table.capacityMin}–{table.capacityMax}
        </Text>
        <Text style={[styles.tileStatus, { color: tone }]} numberOfLines={1}>
          {t(`tables.status.${table.status}`)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Shape is real staff-set data (0003) -- rectangle stays wider than tall via flexBasis below, round/square both use the fixed square tile but differ in corner radius so a round table visually reads as round. */
function shapeStyleFor(shape: RestaurantTable['shape']): { borderRadius: number } {
  switch (shape) {
    case 'round':
      return { borderRadius: radii.xl };
    case 'rectangle':
      return { borderRadius: radii.sm };
    case 'square':
    default:
      return { borderRadius: radii.md };
  }
}

const styles = StyleSheet.create({
  zoneSection: { gap: spacing.sm },
  zoneTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tileWrap: { width: '30%', minWidth: 92 },
  tile: { aspectRatio: 1, padding: spacing.sm, justifyContent: 'space-between' },
  tileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  tileLabel: { fontSize: typeScale.bodyStrong.size, fontWeight: typeScale.bodyStrong.weight, flexShrink: 1 },
  tileCapacity: { fontSize: typeScale.caption.size },
  tileStatus: { fontSize: typeScale.label.size, fontWeight: typeScale.label.weight },
  pickerCard: { gap: spacing.xs },
  pickerHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  changeStatusLabel: { ...typeScale.caption },
});
