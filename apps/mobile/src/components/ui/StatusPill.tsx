import type { ReservationStatus, TableStatus, WaitlistStatus } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

type Status = ReservationStatus | TableStatus | WaitlistStatus;

/**
 * Encodes status as COLOR, not just text -- so a busy host scanning a list
 * during service reads state at a glance, per the design system's "a UI is
 * scanned, not read" principle. Semantic colors only; never the accent hues.
 */
function toneFor(status: Status, theme: ReturnType<typeof useTheme>): string {
  switch (status) {
    case 'confirmed':
    case 'available':
    case 'booked':
      return theme.success;
    case 'pending':
    case 'reserved':
    case 'cleaning':
    case 'waiting':
    case 'notified':
      return theme.warning;
    case 'cancelled':
    case 'no_show':
    case 'blocked':
    case 'out_of_service':
    case 'expired':
      return theme.danger;
    default:
      return theme.textMuted;
  }
}

export function StatusPill({ status, label }: { status: Status; label: string }) {
  const theme = useTheme();
  const tone = toneFor(status, theme);
  return (
    <View style={[styles.pill, { backgroundColor: `${tone}22`, borderColor: tone }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.label, { color: tone }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: '600' },
});
