import type { SupabaseClient } from '@supabase/supabase-js';

import type { ISODate, UUID } from '../types/database';

// ---------------------------------------------------------------------------
// Phase 4 of the Live Availability upgrade: a real-time owner/staff dashboard
// on the mobile app (today's stats, occupancy, hourly breakdown, peak hour).
// See supabase/migrations/0026_owner_dashboard_stats.sql for the full
// rationale -- in short: no new tables or Realtime publication changes were
// needed, because staff already has full RLS read access to reservations/
// tables for their own restaurant, and Phase 3's restaurant_availability_
// versions heartbeat (0025) already fires on every state change this
// dashboard cares about. subscribeToRestaurantDashboard() below reuses that
// exact same heartbeat table as its "something changed, re-fetch" signal --
// it is the owner-facing sibling of subscribeToAvailabilityChanges() in
// publicBooking.ts, just under its own channel name.
// ---------------------------------------------------------------------------

export interface RestaurantDashboardStats {
  localDate: ISODate;
  reservationsTotal: number;
  coversTotal: number;
  noShowsCount: number;
  cancellationsCount: number;
  occupiedTablesCount: number;
  activeTablesCount: number;
  occupancyPercent: number;
  peakHourLocal: number | null;
  peakHourCovers: number | null;
}

interface RestaurantDashboardStatsRow {
  local_date: string;
  reservations_total: number;
  covers_total: number;
  no_shows_count: number;
  cancellations_count: number;
  occupied_tables_count: number;
  active_tables_count: number;
  occupancy_percent: number;
  peak_hour_local: number | null;
  peak_hour_covers: number | null;
}

function mapDashboardStatsRow(row: RestaurantDashboardStatsRow): RestaurantDashboardStats {
  return {
    localDate: row.local_date,
    reservationsTotal: row.reservations_total,
    coversTotal: row.covers_total,
    noShowsCount: row.no_shows_count,
    cancellationsCount: row.cancellations_count,
    occupiedTablesCount: row.occupied_tables_count,
    activeTablesCount: row.active_tables_count,
    occupancyPercent: Number(row.occupancy_percent),
    peakHourLocal: row.peak_hour_local,
    peakHourCovers: row.peak_hour_covers,
  };
}

/**
 * One row of today's (or localDate's) aggregate stats for the dashboard's
 * stat cards + occupancy bar + peak-hour insight. Throws if the caller
 * isn't an active member of this restaurant (see the migration's RLS/guard
 * reasoning) -- same "let it throw, don't silently return zeros" choice as
 * every other RPC wrapper in this file.
 */
export async function fetchRestaurantDashboardStats(
  client: SupabaseClient,
  restaurantId: UUID,
  localDate?: ISODate,
): Promise<RestaurantDashboardStats> {
  const { data, error } = await client.rpc('get_restaurant_dashboard_stats', {
    p_restaurant_id: restaurantId,
    p_local_date: localDate ?? null,
  });
  if (error) throw error;
  const rows = data as unknown as RestaurantDashboardStatsRow[];
  if (!rows[0]) throw new Error('get_restaurant_dashboard_stats returned no row');
  return mapDashboardStatsRow(rows[0]);
}

export interface RestaurantDashboardHourlySlot {
  hourLocal: number;
  reservationsCount: number;
  coversCount: number;
}

interface RestaurantDashboardHourlyRow {
  hour_local: number;
  reservations_count: number;
  covers_count: number;
}

/**
 * Sparse -- only hours with at least one qualifying reservation come back.
 * The dashboard screen fills in the gaps when it draws the bar chart.
 */
export async function fetchRestaurantDashboardHourly(
  client: SupabaseClient,
  restaurantId: UUID,
  localDate?: ISODate,
): Promise<RestaurantDashboardHourlySlot[]> {
  const { data, error } = await client.rpc('get_restaurant_dashboard_hourly', {
    p_restaurant_id: restaurantId,
    p_local_date: localDate ?? null,
  });
  if (error) throw error;
  return (data as unknown as RestaurantDashboardHourlyRow[]).map((row) => ({
    hourLocal: row.hour_local,
    reservationsCount: row.reservations_count,
    coversCount: row.covers_count,
  }));
}

/**
 * Subscribe to the same restaurant_availability_versions heartbeat Phase 3
 * uses (see publicBooking.ts's subscribeToAvailabilityChanges), under its
 * own channel name so this and the customer-facing subscription never
 * collide if somehow both were ever open in the same client instance.
 * onChange fires with no payload -- the caller re-fetches its own stats/
 * hourly queries (this dashboard does it via React Query cache
 * invalidation, matching the rest of the mobile app's data-fetching
 * pattern).
 */
export function subscribeToRestaurantDashboard(client: SupabaseClient, restaurantId: string, onChange: () => void): () => void {
  const channel = client
    .channel(`restaurant-dashboard-${restaurantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'restaurant_availability_versions',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
