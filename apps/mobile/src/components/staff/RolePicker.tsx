import type { StaffRole } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

const INVITABLE_ROLES: Exclude<StaffRole, 'owner'>[] = ['manager', 'reservation_manager', 'host', 'staff'];
// 'owner' excluded on purpose everywhere this picker is used: inviting or
// re-assigning ownership is a separate, more sensitive action this MVP does
// not build yet (see supabase/functions/invite-staff-member's own comment).

export interface RolePickerProps {
  value: Exclude<StaffRole, 'owner'>;
  onChange: (role: Exclude<StaffRole, 'owner'>) => void;
}

/** Single-select role chips, reused by the invite screen and the staff-detail (change role) screen. */
export function RolePicker({ value, onChange }: RolePickerProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.grid}>
      {INVITABLE_ROLES.map((role) => {
        const active = role === value;
        return (
          <Pressable
            key={role}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(role)}
            style={[
              styles.chip,
              { backgroundColor: active ? theme.accent : theme.surface, borderColor: active ? theme.accent : theme.border },
            ]}
          >
            <Text style={{ color: active ? '#0B0C10' : theme.textPrimary, fontWeight: '600' }}>
              {t(`roles.${role}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth },
});
