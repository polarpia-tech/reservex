import {
  fetchRestaurantDashboardHourly,
  fetchRestaurantDashboardStats,
  subscribeToRestaurantDashboard,
  type RestaurantDashboardHourlySlot,
} from '@reservex/core';
import { radii, spacing, typeScale, type ThemeColors } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeaderTitle } from '@/components/ScreenHeaderTitle';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Phase 4 of the Live Availability upgrade: the owner/staff live dashboard.
 * Genuine Supabase Realtime, not polling -- see subscribeToRestaurantDashboard()
 * in @reservex/core for why this reuses Phase 3's restaurant_availability_
 * versions heartbeat instead of needing any new table, trigger or Realtime
 * publication change (see 0026's migration header for the full reasoning).
 *
 * Every number on this screen comes straight from
 * get_restaurant_dashboard_stats() / get_restaurant_dashboard_hourly()
 * (0026) -- nothing here is simulated or hardcoded. A brand-new restaurant
 * with zero reservations today genuinely renders zeros and the empty state
 * below, not sample/placeholder data.
 *
 * "Insights" further down is deliberately plain arithmetic phrased as a
 * sentence (peak hour, occupancy level) -- it is NOT an AI/ML feature and
 * never calls the ai-gateway. See ai.tsx for the actual AI assistant.
 *
 * No charting library exists yet in this app (checked before writing this --
 * apps/mobile has no victory-native/react-native-svg/etc.), so the occupancy
 * indicator and hourly chart below are hand-rolled from plain Views rather
 * than pulling in a new native dependency for one screen.
 */
export default function DashboardScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ['owner-dashboard-stats', restaurantId],
    queryFn: () => fetchRestaurantDashboardStats(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const hourlyQuery = useQuery({
    queryKey: ['owner-dashboard-hourly', restaurantId],
    queryFn: () => fetchRestaurantDashboardHourly(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  // Separate effect from the two queries above, same reasoning as
  // BookingForm.tsx's Phase 3 realtime effect on the web app: this never
  // touches statsQuery/hourlyQuery's own isLoading, so a realtime-triggered
  // background refresh never flashes a skeleton over numbers staff is
  // already looking at.
  useEffect(() => {
    if (!restaurantId) return;
    const unsubscribe = subscribeToRestaurantDashboard(supabase, restaurantId, () => {
      void queryClient.invalidateQueries({ queryKey: ['owner-dashboard-stats', restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ['owner-dashboard-hourly', restaurantId] });
    });
    return unsubscribe;
  }, [restaurantId, queryClient]);

  const stats = statsQuery.data;
  const hourly = hourlyQuery.data ?? [];

  const maxHourlyCovers = useMemo(() => hourly.reduce((max, slot) => Math.max(max, slot.coversCount), 0), [hourly]);

  const todayLabel = new Date().toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' });

  const isLoading = statsQuery.isLoading || hourlyQuery.isLoading;
  const isError = statsQuery.isError || hourlyQuery.isError;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.dateLabel, { color: theme.textMuted }]}>{todayLabel}</Text>

        {isLoading ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={180} />
            <Skeleton height={140} />
            <Skeleton height={180} />
          </View>
        ) : isError ? (
          <EmptyState icon="alert-circle-outline" label={t('dashboard.loadError')} />
        ) : stats ? (
          <>
            <View style={styles.statGrid}>
              <StatCard label={t('dashboard.reservationsLabel')} value={stats.reservationsTotal} icon="calendar-outline" theme={theme} />
              <StatCard label={t('dashboard.coversLabel')} value={stats.coversTotal} icon="people-outline" theme={theme} />
              <StatCard
                label={t('dashboard.noShowsLabel')}
                value={stats.noShowsCount}
                icon="close-circle-outline"
                theme={theme}
                warn={stats.noShowsCount > 0}
              />
              <StatCard
                label={t('dashboard.cancellationsLabel')}
                value={stats.cancellationsCount}
                icon="ban-outline"
                theme={theme}
                warn={stats.cancellationsCount > 0}
              />
            </View>

            <Card style={styles.cardGap}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{t('dashboard.occupancyTitle')}</Text>
              <Text style={[styles.occupancyPercent, { color: theme.accent }]}>{stats.occupancyPercent}%</Text>
              <View style={[styles.occupancyTrack, { backgroundColor: theme.border }]}>
                <View
                  style={[
                    styles.occupancyFill,
                    { width: `${Math.max(0, Math.min(100, stats.occupancyPercent))}%`, backgroundColor: theme.accent },
                  ]}
                />
              </View>
              <Text style={{ color: theme.textMuted, fontSize: typeScale.caption.size }}>
                {t('dashboard.occupancyTablesLabel', { occupied: stats.occupiedTablesCount, active: stats.activeTablesCount })}
              </Text>
            </Card>

            <Card style={styles.cardGap}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{t('dashboard.hourlyTitle')}</Text>
              {hourly.length === 0 ? (
                <Text style={{ color: theme.textMuted, fontSize: typeScale.body.size }}>{t('dashboard.emptyToday')}</Text>
              ) : (
                <View style={styles.hourlyChart}>
                  {hourly.map((slot: RestaurantDashboardHourlySlot) => {
                    const barHeightPercent = maxHourlyCovers > 0 ? Math.max(6, (slot.coversCount / maxHourlyCovers) * 100) : 6;
                    return (
                      <View key={slot.hourLocal} style={styles.hourlyBarColumn}>
                        <Text style={[styles.hourlyBarValue, { color: theme.textMuted }]}>{slot.coversCount}</Text>
                        <View style={styles.hourlyBarTrack}>
                          <View style={[styles.hourlyBar, { height: `${barHeightPercent}%`, backgroundColor: theme.accent }]} />
                        </View>
                        <Text style={[styles.hourlyBarLabel, { color: theme.textMuted }]}>{String(slot.hourLocal).padStart(2, '0')}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>

            <Card style={styles.cardGap}>
              <View style={styles.insightsHeader}>
                <Ionicons name="bulb-outline" size={18} color={theme.textPrimary} />
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{t('dashboard.insightsTitle')}</Text>
              </View>
              {stats.peakHourLocal !== null ? (
                <Text style={{ color: theme.textPrimary, fontSize: typeScale.body.size }}>
                  {t('dashboard.insightPeakHour', {
                    hour: String(stats.peakHourLocal).padStart(2, '0'),
                    covers: stats.peakHourCovers ?? 0,
                  })}
                </Text>
              ) : null}
              <Text style={{ color: theme.textPrimary, fontSize: typeScale.body.size }}>
                {stats.occupancyPercent >= 80
                  ? t('dashboard.insightHighOccupancy', { percent: stats.occupancyPercent })
                  : t('dashboard.insightLowOccupancy', { percent: stats.occupancyPercent })}
              </Text>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
  theme,
  warn,
}: {
  label: string;
  value: number;
  icon: IoniconName;
  theme: ThemeColors;
  warn?: boolean;
}) {
  return (
    <Card style={styles.statCard}>
      <Ionicons name={icon} size={20} color={warn ? theme.danger : theme.accent} />
      <Text style={[styles.statValue, { color: warn ? theme.danger : theme.textPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  dateLabel: { fontSize: typeScale.label.size, fontWeight: typeScale.label.weight, textTransform: 'capitalize' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: { width: '47%', alignItems: 'flex-start', gap: spacing.xs },
  statValue: { fontSize: typeScale.h1.size, fontWeight: typeScale.h1.weight },
  statLabel: { fontSize: typeScale.label.size, fontWeight: typeScale.label.weight },
  cardGap: { gap: spacing.sm },
  cardTitle: { fontSize: typeScale.h3.size, fontWeight: typeScale.h3.weight },
  occupancyPercent: { fontSize: typeScale.display.size, fontWeight: typeScale.display.weight },
  occupancyTrack: { height: 10, borderRadius: radii.sm, overflow: 'hidden' },
  occupancyFill: { height: '100%', borderRadius: radii.sm },
  hourlyChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140 },
  hourlyBarColumn: { flex: 1, alignItems: 'center', gap: spacing.xs, height: '100%', justifyContent: 'flex-end' },
  hourlyBarValue: { fontSize: typeScale.label.size },
  hourlyBarTrack: { width: 14, flex: 1, justifyContent: 'flex-end' },
  hourlyBar: { width: '100%', borderRadius: radii.sm },
  hourlyBarLabel: { fontSize: typeScale.label.size },
  insightsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
