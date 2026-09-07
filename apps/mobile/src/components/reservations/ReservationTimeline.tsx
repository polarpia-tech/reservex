import type { ReservationWithTables, RestaurantTable, TableZone } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { toneFor } from '@/components/ui/StatusPill';
import { useTheme } from '@/theme/ThemeProvider';

const HOUR_WIDTH = 72;
const ROW_HEIGHT = 52;
const LABEL_COLUMN_WIDTH = 88;
/** Defensive cap so one bad/very-late ends_at can never blow up the render width -- see this file's header comment. */
const MAX_SPAN_HOURS = 20;

/**
 * Phase 5 of the Live Availability upgrade: a per-table, hourly Gantt-style
 * view of the selected day's reservations -- the reservations tab's
 * sibling to the tables tab's new TableMapView. Deliberately built from
 * plain Views with percentage-free, pixel-based absolute positioning
 * (HOUR_WIDTH * hours-from-range-start) rather than a charting/gesture
 * library, matching Phase 4 dashboard.tsx's "no charting library exists
 * yet in this app" reasoning -- still true as of this phase (re-checked).
 *
 * Time math is anchored on `dayStart` (the exact same local-midnight Date
 * the parent screen already computes for its fetchReservations() range
 * query), not on each reservation's own local hour -- this is what makes a
 * reservation that runs past midnight (e.g. 23:00-01:00) position and size
 * correctly instead of wrapping to a negative offset. Same "device
 * timezone == restaurant timezone" MVP simplification the day-agenda list
 * already uses (reservations/index.tsx), not a new one introduced here.
 *
 * Rows are every ACTIVE table (not just tables with a reservation today) --
 * ordered by zone then label, matching the Tables tab's own ordering, so a
 * host can also see at a glance which tables are free all day. A
 * reservation covering more than one table (a combination) renders its
 * block on EVERY table row it's assigned to, mirroring how
 * `reservation_tables` actually models it in the database -- not
 * collapsed onto a single "primary" table.
 */
export interface ReservationTimelineProps {
  dayStart: Date;
  reservations: ReservationWithTables[];
  tables: RestaurantTable[];
  zones: TableZone[];
  onPressReservation: (reservationId: string) => void;
  isToday: boolean;
}

export function ReservationTimeline({ dayStart, reservations, tables, zones, onPressReservation, isToday }: ReservationTimelineProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const orderedTables = useMemo(() => {
    const sortOrderByZoneId = new Map(zones.map((z) => [z.id, z.sortOrder]));
    return [...tables].sort((a, b) => {
      const zoneOrderA = a.zoneId ? (sortOrderByZoneId.get(a.zoneId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const zoneOrderB = b.zoneId ? (sortOrderByZoneId.get(b.zoneId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      if (zoneOrderA !== zoneOrderB) return zoneOrderA - zoneOrderB;
      return a.label.localeCompare(b.label);
    });
  }, [tables, zones]);

  const { startHour, endHour } = useMemo(() => computeHourRange(dayStart, reservations), [dayStart, reservations]);
  const totalHours = endHour - startHour;
  const contentWidth = totalHours * HOUR_WIDTH;

  const nowOffsetMinutes = isToday ? (Date.now() - dayStart.getTime()) / 60000 : null;
  const nowLeft =
    nowOffsetMinutes !== null && nowOffsetMinutes >= startHour * 60 && nowOffsetMinutes <= endHour * 60
      ? ((nowOffsetMinutes - startHour * 60) / 60) * HOUR_WIDTH
      : null;

  if (orderedTables.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={{ color: theme.textMuted }}>{t('reservations.timeline.noTables')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Fixed label column -- not part of the horizontal ScrollView, so it stays put while the timeline scrolls. */}
      <View style={{ width: LABEL_COLUMN_WIDTH }}>
        <View style={styles.rulerSpacer} />
        {orderedTables.map((table) => (
          <View key={table.id} style={[styles.labelCell, { borderColor: theme.border }]}>
            <Text style={[styles.labelText, { color: theme.textPrimary }]} numberOfLines={1}>
              {table.label}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: contentWidth }}>
        <View style={{ width: contentWidth }}>
          {/* Hour ruler */}
          <View style={[styles.ruler, { borderColor: theme.border }]}>
            {Array.from({ length: totalHours + 1 }, (_, i) => startHour + i).map((hour) => (
              <View key={hour} style={[styles.rulerTick, { left: (hour - startHour) * HOUR_WIDTH }]}>
                <Text style={[styles.rulerLabel, { color: theme.textMuted }]}>{String(hour % 24).padStart(2, '0')}:00</Text>
              </View>
            ))}
          </View>

          {/* Table rows with vertical hour gridlines */}
          <View>
            {Array.from({ length: totalHours + 1 }, (_, i) => startHour + i).map((hour) => (
              <View
                key={hour}
                style={[
                  styles.gridline,
                  { left: (hour - startHour) * HOUR_WIDTH, height: orderedTables.length * ROW_HEIGHT, backgroundColor: theme.border },
                ]}
              />
            ))}

            {orderedTables.map((table, rowIndex) => (
              <View key={table.id} style={[styles.row, { top: rowIndex * ROW_HEIGHT, borderColor: theme.border }]}>
                {reservations
                  .filter((reservation) => reservation.tables.some((tt) => tt.tableId === table.id))
                  .map((reservation) => {
                    const block = blockGeometry(dayStart, startHour, reservation);
                    if (!block) return null;
                    const tone = toneFor(reservation.status, theme);
                    return (
                      <Pressable
                        key={reservation.id}
                        accessibilityRole="button"
                        onPress={() => onPressReservation(reservation.id)}
                        style={[styles.block, { left: block.left, width: block.width, backgroundColor: `${tone}33`, borderColor: tone }]}
                      >
                        <Text style={[styles.blockText, { color: tone }]} numberOfLines={1}>
                          {reservation.guestName ?? t('reservations.guestName')}
                        </Text>
                        <Text style={[styles.blockSubtext, { color: tone }]} numberOfLines={1}>
                          {new Date(reservation.startsAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            ))}
          </View>

          {nowLeft !== null ? (
            <View pointerEvents="none" style={[styles.nowLine, { left: nowLeft, height: orderedTables.length * ROW_HEIGHT, backgroundColor: theme.danger }]}>
              <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/** Rounds out one hour before the earliest reservation and one hour after the latest, clamped to [0, 24] and to MAX_SPAN_HOURS; falls back to a sensible default dinner-service window when the day has no reservations at all. */
function computeHourRange(dayStart: Date, reservations: ReservationWithTables[]): { startHour: number; endHour: number } {
  if (reservations.length === 0) return { startHour: 12, endHour: 23 };

  let minMinutes = Infinity;
  let maxMinutes = -Infinity;
  for (const reservation of reservations) {
    const startMinutes = (new Date(reservation.startsAt).getTime() - dayStart.getTime()) / 60000;
    const endMinutes = (new Date(reservation.endsAt).getTime() - dayStart.getTime()) / 60000;
    minMinutes = Math.min(minMinutes, startMinutes);
    maxMinutes = Math.max(maxMinutes, endMinutes);
  }

  let startHour = Math.max(0, Math.floor(minMinutes / 60) - 1);
  let endHour = Math.ceil(maxMinutes / 60) + 1;
  if (endHour - startHour > MAX_SPAN_HOURS) endHour = startHour + MAX_SPAN_HOURS;
  if (endHour <= startHour) endHour = startHour + 1;
  return { startHour, endHour };
}

function blockGeometry(dayStart: Date, startHour: number, reservation: ReservationWithTables): { left: number; width: number } | null {
  const startMinutes = (new Date(reservation.startsAt).getTime() - dayStart.getTime()) / 60000;
  const endMinutes = (new Date(reservation.endsAt).getTime() - dayStart.getTime()) / 60000;
  const rangeStartMinutes = startHour * 60;
  const left = ((startMinutes - rangeStartMinutes) / 60) * HOUR_WIDTH;
  const width = Math.max(((endMinutes - startMinutes) / 60) * HOUR_WIDTH, 36);
  return { left, width };
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row' },
  emptyWrap: { padding: spacing.lg, alignItems: 'center' },
  rulerSpacer: { height: 28 },
  labelCell: { height: ROW_HEIGHT, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingRight: spacing.sm },
  labelText: { fontSize: typeScale.caption.size, fontWeight: '700' },
  ruler: { height: 28, borderBottomWidth: StyleSheet.hairlineWidth },
  rulerTick: { position: 'absolute', top: 0 },
  rulerLabel: { fontSize: typeScale.label.size, marginLeft: 2 },
  gridline: { position: 'absolute', top: 0, width: StyleSheet.hairlineWidth },
  row: { position: 'absolute', left: 0, right: 0, height: ROW_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth },
  block: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  blockText: { fontSize: typeScale.caption.size, fontWeight: '700' },
  blockSubtext: { fontSize: 10 },
  nowLine: { position: 'absolute', top: 28, width: 2 },
  nowDot: { position: 'absolute', top: -4, left: -3, width: 8, height: 8, borderRadius: 4 },
});
