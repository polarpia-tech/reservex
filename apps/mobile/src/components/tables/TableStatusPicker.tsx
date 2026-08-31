import type { TableStatus } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

const ALL_STATUSES: TableStatus[] = ['available', 'reserved', 'seated', 'occupied', 'cleaning', 'blocked', 'out_of_service'];

export interface TableStatusPickerProps {
  value: TableStatus;
  onChange: (status: TableStatus) => void;
}

/**
 * Inline quick-status chips for the floor view. Every active staff member
 * may use this (not just owner/manager) -- it maps directly to
 * `updateTable(tableId, { status })`, allowed by the `tables_update` RLS
 * policy for any restaurant member, verified in
 * scripts/verify_phase06_floor_plan.sql (Test E).
 */
export function TableStatusPicker({ value, onChange }: TableStatusPickerProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.grid}>
      {ALL_STATUSES.map((status) => {
        const active = status === value;
        return (
          <Pressable
            key={status}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(status)}
            style={[
              styles.chip,
              { backgroundColor: active ? theme.accent : theme.surfaceElevated, borderColor: active ? theme.accent : theme.border },
            ]}
          >
            <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600', fontSize: 12 }}>
              {t(`tables.status.${status}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
});
