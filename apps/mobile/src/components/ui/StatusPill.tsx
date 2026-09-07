import type { ReservationStatus, TableStatus, WaitlistStatus } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

type Status = ReservationStatus | TableStatus | WaitlistStatus;

/**
 * Encodes status as COLOR, not just text -- so a busy host scanning a list
 * during service reads state at a glance, per the design system's "a UI is
 * scanned, not read" principle.
 *
 * Phase 5 of the Live Availability upgrade extended this: 'seated' (both a
 * table and a reservation status), 'occupied' (table) and 'completed'
 * (reservation) previously fell through to the `default` branch below --
 * i.e. rendered the same flat grey as a genuinely unrecognized status,
 * indistinguishable from each other in the existing Tables/Reservations
 * list screens too, not just in the new map/timeline this phase adds. That
 * was a real, pre-existing gap (not something this phase introduced) --
 * fixed here rather than duplicated locally in the new map/timeline
 * components, since it improves the existing list screens as a side
 * effect at zero risk (purely additive cases; every previously-handled
 * status keeps its exact previous color). theme.accent ("ember") is used
 * for these -- "currently in progress" is a distinct semantic from
 * success/warning/danger, and accent is this app's reservation/table
 * domain color (never theme.ai, the AI-only "pulse" hue -- see
 * packages/ui/src/tokens.ts's own header comment on that rule).
 */
export function toneFor(status: Status, theme: ReturnType<typeof useTheme>): string {
  switch (status) {
    case 'confirmed':
    case 'available':
    case 'booked':
    case 'completed':
      return theme.success;
    case 'seated':
    case 'occupied':
      return theme.accent;
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
