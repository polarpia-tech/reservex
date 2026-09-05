import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AvailableTable,
  AvailableTableCombination,
  ISODateTime,
  Reservation,
  ReservationSource,
  ReservationStatus,
  ReservationTableAssignment,
  ReservationWithTables,
  UUID,
} from '../types/database';

// ---------------------------------------------------------------------------
// Row shapes as PostgREST actually returns them (snake_case), including the
// nested reservation_tables -> tables embed used by fetchReservations().
// ---------------------------------------------------------------------------
interface ReservationRow {
  id: string;
  restaurant_id: string;
  customer_id: string | null;
  event_id: string | null;
  status: ReservationStatus;
  source: ReservationSource;
  party_size: number;
  starts_at: string;
  ends_at: string;
  buffer_minutes: number;
  zone_preference_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  created_by_user_id: string | null;
  created_by_ai: boolean;
  confirmed_at: string | null;
  seated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  no_show_marked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReservationWithTablesRow extends ReservationRow {
  reservation_tables: { table_id: string; tables: { label: string } | null }[] | null;
}

function mapReservationRow(row: ReservationRow): Reservation {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    customerId: row.customer_id,
    eventId: row.event_id,
    status: row.status,
    source: row.source,
    partySize: row.party_size,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    bufferMinutes: row.buffer_minutes,
    zonePreferenceId: row.zone_preference_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    guestEmail: row.guest_email,
    specialRequests: row.special_requests,
    internalNotes: row.internal_notes,
    createdByUserId: row.created_by_user_id,
    createdByAi: row.created_by_ai,
    confirmedAt: row.confirmed_at,
    seatedAt: row.seated_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    noShowMarkedAt: row.no_show_marked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReservationWithTablesRow(row: ReservationWithTablesRow): ReservationWithTables {
  const tables: ReservationTableAssignment[] = (row.reservation_tables ?? [])
    .filter((rt) => rt.tables !== null)
    .map((rt) => ({ tableId: rt.table_id, label: rt.tables!.label }));
  return { ...mapReservationRow(row), tables };
}

const RESERVATION_WITH_TABLES_SELECT = '*, reservation_tables(table_id, tables(label))';

/**
 * Reservations in [fromInclusive, toExclusive) for the agenda/day view,
 * newest-start-time-first isn't useful here -- ordered chronologically so a
 * host reads the day top to bottom the way it will actually happen.
 */
export async function fetchReservations(
  client: SupabaseClient,
  restaurantId: UUID,
  range: { fromInclusive: ISODateTime; toExclusive: ISODateTime },
): Promise<ReservationWithTables[]> {
  const { data, error } = await client
    .from('reservations')
    .select(RESERVATION_WITH_TABLES_SELECT)
    .eq('restaurant_id', restaurantId)
    .gte('starts_at', range.fromInclusive)
    .lt('starts_at', range.toExclusive)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data as unknown as ReservationWithTablesRow[]).map(mapReservationWithTablesRow);
}

export async function fetchReservation(client: SupabaseClient, reservationId: UUID): Promise<ReservationWithTables> {
  const { data, error } = await client
    .from('reservations')
    .select(RESERVATION_WITH_TABLES_SELECT)
    .eq('id', reservationId)
    .single();
  if (error) throw error;
  return mapReservationWithTablesRow(data as unknown as ReservationWithTablesRow);
}

// ---------------------------------------------------------------------------
// Availability lookups -- thin wrappers around the read-only SQL functions
// from 0013. Used by the "new reservation" screen to show a host what's
// free before they commit, and to power a manual table picker.
// ---------------------------------------------------------------------------
export interface AvailabilityQuery {
  restaurantId: UUID;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  partySize: number;
  zoneId?: UUID | null;
  excludeReservationId?: UUID | null;
  includeVip?: boolean;
}

export async function fetchAvailableTables(client: SupabaseClient, query: AvailabilityQuery): Promise<AvailableTable[]> {
  const { data, error } = await client.rpc('get_available_tables', {
    p_restaurant_id: query.restaurantId,
    p_starts_at: query.startsAt,
    p_ends_at: query.endsAt,
    p_party_size: query.partySize,
    p_zone_id: query.zoneId ?? null,
    p_exclude_reservation_id: query.excludeReservationId ?? null,
    p_include_vip: query.includeVip ?? false,
  });
  if (error) throw error;
  return (data as { table_id: string; label: string; zone_id: string | null; capacity_min: number; capacity_max: number; is_vip: boolean }[]).map(
    (r) => ({ tableId: r.table_id, label: r.label, zoneId: r.zone_id, capacityMin: r.capacity_min, capacityMax: r.capacity_max, isVip: r.is_vip }),
  );
}

export async function fetchAvailableTableCombinations(
  client: SupabaseClient,
  query: Omit<AvailabilityQuery, 'zoneId' | 'includeVip'>,
): Promise<AvailableTableCombination[]> {
  const { data, error } = await client.rpc('get_available_table_combinations', {
    p_restaurant_id: query.restaurantId,
    p_starts_at: query.startsAt,
    p_ends_at: query.endsAt,
    p_party_size: query.partySize,
    p_exclude_reservation_id: query.excludeReservationId ?? null,
  });
  if (error) throw error;
  return (
    data as { combination_id: string; name: string; combined_capacity_min: number; combined_capacity_max: number; table_ids: string[] }[]
  ).map((r) => ({
    combinationId: r.combination_id,
    name: r.name,
    combinedCapacityMin: r.combined_capacity_min,
    combinedCapacityMax: r.combined_capacity_max,
    tableIds: r.table_ids,
  }));
}

// ---------------------------------------------------------------------------
// book_reservation() wrapper -- one function, two call shapes: create a new
// reservation, or reschedule an existing one when reservationId is passed.
// See 0013's comment for the full allocation-order explanation; this is
// just the client-side plumbing to call it and turn its error codes into
// something the UI can map to a translated message.
// ---------------------------------------------------------------------------
export interface BookReservationInput {
  restaurantId: UUID;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  partySize: number;
  source?: ReservationSource;
  customerId?: UUID | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  specialRequests?: string | null;
  internalNotes?: string | null;
  zonePreferenceId?: UUID | null;
  bufferMinutes?: number | null;
  /** Manual table choice -- skips smart allocation entirely. Leave undefined/null to let the engine pick. */
  tableIds?: UUID[] | null;
}

/** The reservation-engine error codes raised by 0013's book_reservation(). Kept in one place so the UI's error-message mapping and this list can never silently drift apart. */
export type BookReservationErrorCode =
  | 'INVALID_TIME_RANGE'
  | 'INVALID_PARTY_SIZE'
  | 'RESTAURANT_NOT_FOUND'
  | 'RESERVATION_NOT_FOUND'
  | 'NO_AVAILABILITY'
  | 'DOUBLE_BOOKED';

const KNOWN_ERROR_CODES: readonly string[] = [
  'INVALID_TIME_RANGE',
  'INVALID_PARTY_SIZE',
  'RESTAURANT_NOT_FOUND',
  'RESERVATION_NOT_FOUND',
  'NO_AVAILABILITY',
  'DOUBLE_BOOKED',
];

/**
 * Pulls a known engine error code out of a raw Postgres error message, if
 * there is one. Returns null for anything else (e.g. an RLS denial), so the
 * caller can fall back to a generic error message rather than mis-labeling
 * it.
 *
 * Bug fixed here: this used to only check `error instanceof Error` (or a
 * plain string), which never matched -- supabase-js's `.rpc()` error is a
 * PLAIN OBJECT shaped like `{ message, details, hint, code }` (a
 * PostgrestError-shaped object, not an actual `Error` instance), so
 * `error instanceof Error` was always false and this silently fell through
 * to the empty-string branch. Every book_reservation() failure (including
 * NO_AVAILABILITY, DOUBLE_BOOKED, etc.) therefore always showed the generic
 * "could not save" message instead of its real, specific one. Fixed by also
 * accepting any object with a string `message` property.
 */
export function parseBookReservationErrorCode(error: unknown): BookReservationErrorCode | null {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '';
  const match = KNOWN_ERROR_CODES.find((code) => message.includes(code));
  return (match as BookReservationErrorCode | undefined) ?? null;
}

async function callBookReservation(
  client: SupabaseClient,
  input: BookReservationInput,
  reservationId: UUID | null,
): Promise<Reservation> {
  const { data, error } = await client
    .rpc('book_reservation', {
      p_restaurant_id: input.restaurantId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_party_size: input.partySize,
      p_source: input.source ?? 'admin',
      p_customer_id: input.customerId ?? null,
      p_guest_name: input.guestName ?? null,
      p_guest_phone: input.guestPhone ?? null,
      p_guest_email: input.guestEmail ?? null,
      p_special_requests: input.specialRequests ?? null,
      p_internal_notes: input.internalNotes ?? null,
      p_zone_preference_id: input.zonePreferenceId ?? null,
      p_buffer_minutes: input.bufferMinutes ?? null,
      p_table_ids: input.tableIds && input.tableIds.length > 0 ? input.tableIds : null,
      p_reservation_id: reservationId,
    });
  // No .single() here on purpose: book_reservation is declared `returns
  // public.reservations` (a single row type, not `setof`/`table(...)`), so
  // PostgREST already serves the RPC response as one JSON object rather
  // than an array -- unlike get_available_tables/get_available_table_
  // combinations above, which ARE set-returning and do come back as arrays.
  // Adding .single()'s "vnd.pgrst.object+json" Accept header on top of an
  // already-scalar response is a real Supabase/PostgREST behavior this
  // sandbox has no way to execute against a live PostgREST server to
  // double-check, so this is deliberately the more conservative, verifiable
  // reading rather than an assumption -- flagged in the Phase 07 README as
  // one of the small number of things to smoke-test first against a real
  // Supabase project.
  if (error) throw error;
  return mapReservationRow(data as unknown as ReservationRow);
}

export function bookReservation(client: SupabaseClient, input: BookReservationInput): Promise<Reservation> {
  return callBookReservation(client, input, null);
}

/** Reschedule (new time/party size, and optionally new tables) or manually reassign the tables of an existing reservation -- same engine call, existing id supplied. */
export function rescheduleReservation(client: SupabaseClient, reservationId: UUID, input: BookReservationInput): Promise<Reservation> {
  return callBookReservation(client, input, reservationId);
}

// ---------------------------------------------------------------------------
// Plain status updates. No dedicated SQL function needed for these -- the
// reservations_staff_write RLS policy (0011) already allows any active
// staff member to update a reservation, and the trg_reservations_status_
// timestamps + trg_reservations_propagate triggers (0006 + 0013) take care
// of stamping timestamps and freeing/re-blocking the table automatically.
// ---------------------------------------------------------------------------
export async function updateReservationStatus(
  client: SupabaseClient,
  reservationId: UUID,
  status: ReservationStatus,
  options?: { cancellationReason?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'cancelled' && options?.cancellationReason !== undefined) {
    patch.cancellation_reason = options.cancellationReason;
  }
  const { error } = await client.from('reservations').update(patch).eq('id', reservationId);
  if (error) throw error;
}
