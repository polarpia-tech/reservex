import type { SupabaseClient } from '@supabase/supabase-js';

import { mapRestaurantRow, type RestaurantRow } from './restaurants';
import type { ISODate, ISODateTime, Reservation, ReservationSource, ReservationStatus, Restaurant } from '../types/database';

// ---------------------------------------------------------------------------
// The anonymous/customer-facing side of Phase 08: browsing a restaurant's
// public profile and booking a table, backed entirely by migration 0014
// (restaurants_public_select / opening_hours_public_select /
// special_hours_public_select RLS policies + the book_public_reservation
// SECURITY DEFINER function).
//
// Deliberately NOT duplicated here: fetching opening hours and special
// hours. fetchOpeningHours()/fetchSpecialHours() in api/openingHours.ts
// already work unchanged for an anon caller looking at an active
// restaurant -- 0014 only widened the RLS policy on those same tables, it
// did not change their shape or add a new endpoint -- so the web app should
// just call those two existing functions directly. This file only adds
// what's genuinely new: looking a restaurant up by its public slug (staff
// screens never need that -- they already have the id), and the booking
// call itself.
// ---------------------------------------------------------------------------

/**
 * Every restaurant visible under restaurants_public_select (0014) -- active,
 * non-deleted -- for the public directory/browse page. Ordered by name
 * since there is no other meaningful default ordering yet (no geolocation
 * or popularity ranking built in this phase -- see the Phase 08 README for
 * what's deliberately out of scope).
 */
export async function fetchPublicRestaurantDirectory(client: SupabaseClient): Promise<Restaurant[]> {
  const { data, error } = await client.from('restaurants').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data as RestaurantRow[]).map(mapRestaurantRow);
}

/**
 * A restaurant's public profile by slug, for the "/r/[slug]" page. Returns
 * null (not a thrown error) when the slug doesn't exist OR the restaurant
 * is inactive/deleted -- restaurants_public_select (0014) makes those two
 * cases indistinguishable on purpose, and the web app should render the
 * same "not found" page either way rather than leaking which one it was.
 */
export async function fetchPublicRestaurant(client: SupabaseClient, slug: string): Promise<Restaurant | null> {
  const { data, error } = await client.from('restaurants').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRestaurantRow(data as RestaurantRow);
}

// ---------------------------------------------------------------------------
// book_public_reservation() wrapper. See migration 0014 for the full
// validation order this function enforces server-side (party size ->
// booking window -> open-at-that-time -> guest details -> rate guard ->
// the same book_reservation() allocation engine from Phase 07).
// ---------------------------------------------------------------------------
export interface BookPublicReservationInput {
  restaurantSlug: string;
  startsAt: ISODateTime;
  partySize: number;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  specialRequests?: string | null;
}

/**
 * The additional error codes book_public_reservation() can raise, on top of
 * RESTAURANT_NOT_FOUND / NO_AVAILABILITY / DOUBLE_BOOKED / INVALID_PARTY_SIZE
 * already covered by parseBookReservationErrorCode() in api/reservations.ts
 * (book_public_reservation delegates to the same book_reservation() engine
 * for the actual allocation, so those codes can still surface here too).
 */
export type BookPublicReservationErrorCode =
  | 'PARTY_SIZE_OUT_OF_RANGE'
  | 'OUTSIDE_BOOKING_WINDOW'
  | 'RESTAURANT_CLOSED'
  | 'GUEST_DETAILS_REQUIRED'
  | 'RATE_LIMITED';

const PUBLIC_ERROR_CODES: readonly string[] = [
  'PARTY_SIZE_OUT_OF_RANGE',
  'OUTSIDE_BOOKING_WINDOW',
  'RESTAURANT_CLOSED',
  'GUEST_DETAILS_REQUIRED',
  'RATE_LIMITED',
  // also raised by book_public_reservation itself, or by the underlying
  // book_reservation() engine it delegates to -- kept in the same parser so
  // the UI has exactly one place to map any of these to a translated string.
  'RESTAURANT_NOT_FOUND',
  'NO_AVAILABILITY',
  'DOUBLE_BOOKED',
];

export type PublicReservationErrorCode = BookPublicReservationErrorCode | 'RESTAURANT_NOT_FOUND' | 'NO_AVAILABILITY' | 'DOUBLE_BOOKED';

/**
 * Same pattern as parseBookReservationErrorCode() -- returns null for
 * anything unrecognized (e.g. a network error) so the caller can fall back
 * to a generic message.
 *
 * Same bug fixed here as in reservations.ts: this only checked
 * `error instanceof Error` (or a plain string), which never matches --
 * supabase-js's `.rpc()` error is a PLAIN OBJECT shaped like `{ message,
 * details, hint, code }`, not an actual `Error` instance, so this always
 * fell through to the empty-string branch and every specific error code
 * silently became the generic message.
 */
export function parsePublicReservationErrorCode(error: unknown): PublicReservationErrorCode | null {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '';
  const match = PUBLIC_ERROR_CODES.find((code) => message.includes(code));
  return (match as PublicReservationErrorCode | undefined) ?? null;
}

interface ReservationRowLite {
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

function mapReservationRowLite(row: ReservationRowLite): Reservation {
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

/**
 * Books a table as an anonymous guest OR a signed-in customer (the RPC
 * itself branches on auth.uid() -- see 0014). IMPORTANT, per the Phase 08
 * README: for an anonymous guest, this return value is the ONLY chance the
 * UI ever gets to show a confirmation with the reservation's details --
 * there is no RLS grant that lets a guest read their own booking back
 * afterward (proven by verify_phase08_public_booking.sql Test C), so the
 * booking-form component must render its confirmation screen straight from
 * this response, never from a follow-up fetch.
 */
export async function bookPublicReservation(client: SupabaseClient, input: BookPublicReservationInput): Promise<Reservation> {
  const { data, error } = await client.rpc('book_public_reservation', {
    p_restaurant_slug: input.restaurantSlug,
    p_starts_at: input.startsAt,
    p_party_size: input.partySize,
    p_guest_name: input.guestName ?? null,
    p_guest_phone: input.guestPhone ?? null,
    p_guest_email: input.guestEmail ?? null,
    p_special_requests: input.specialRequests ?? null,
  });
  // No .single() here -- same reasoning as callBookReservation() in
  // api/reservations.ts: book_public_reservation is declared `returns
  // public.reservations` (one row, not setof), so PostgREST already
  // serves it as a single JSON object.
  if (error) throw error;
  return mapReservationRowLite(data as unknown as ReservationRowLite);
}

// ---------------------------------------------------------------------------
// get_public_availability_summary() wrapper -- Phase 1 ("DB/RPC foundation")
// of the Live Availability upgrade, migration 0023. Anon-callable, returns
// ONLY aggregated counts/booleans per bookable time slot -- no table id, no
// guest data, nothing that identifies any individual booking. See that
// migration's header comment for the full reasoning (privacy + no-fake-
// scarcity by construction) and its one documented limitation (a shift that
// crosses midnight produces no slots yet).
//
// Deliberately NOT wired into any screen yet -- this is foundation only, so
// existing behaviour is completely unchanged until a later phase actually
// calls this from the web app's restaurant page.
// ---------------------------------------------------------------------------
export interface PublicAvailabilitySlot {
  slotStartsAt: ISODateTime;
  slotEndsAt: ISODateTime;
  availableTableCount: number;
  hasCombinableOption: boolean;
}

interface PublicAvailabilitySlotRow {
  slot_starts_at: string;
  slot_ends_at: string;
  available_table_count: number;
  has_combinable_option: boolean;
}

function mapPublicAvailabilitySlotRow(row: PublicAvailabilitySlotRow): PublicAvailabilitySlot {
  return {
    slotStartsAt: row.slot_starts_at,
    slotEndsAt: row.slot_ends_at,
    availableTableCount: row.available_table_count,
    hasCombinableOption: row.has_combinable_option,
  };
}

export interface FetchPublicAvailabilitySummaryInput {
  restaurantSlug: string;
  date: ISODate;
  partySize?: number;
  intervalMinutes?: number;
}

/** The error codes get_public_availability_summary() can raise (see migration 0023). */
export type PublicAvailabilitySummaryErrorCode = 'RESTAURANT_NOT_FOUND' | 'PARTY_SIZE_OUT_OF_RANGE' | 'INVALID_ARGUMENTS';

const PUBLIC_AVAILABILITY_ERROR_CODES: readonly PublicAvailabilitySummaryErrorCode[] = [
  'RESTAURANT_NOT_FOUND',
  'PARTY_SIZE_OUT_OF_RANGE',
  'INVALID_ARGUMENTS',
];

/** Same pattern as parsePublicReservationErrorCode() -- returns null for anything unrecognized. */
export function parsePublicAvailabilitySummaryErrorCode(error: unknown): PublicAvailabilitySummaryErrorCode | null {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '';
  return PUBLIC_AVAILABILITY_ERROR_CODES.find((code) => message.includes(code)) ?? null;
}

/**
 * Empty array means "closed that day" (no opening_hours/special_hours shift
 * covers it) -- not an error, and indistinguishable on purpose from a day
 * with a shift so short no slot fits, same "don't leak more than the
 * customer needs" spirit as fetchPublicRestaurant()'s not-found handling
 * above.
 */
export async function fetchPublicAvailabilitySummary(
  client: SupabaseClient,
  input: FetchPublicAvailabilitySummaryInput,
): Promise<PublicAvailabilitySlot[]> {
  const { data, error } = await client.rpc('get_public_availability_summary', {
    p_restaurant_slug: input.restaurantSlug,
    p_date: input.date,
    p_party_size: input.partySize ?? 2,
    p_interval_minutes: input.intervalMinutes ?? 30,
  });
  if (error) throw error;
  return (data as unknown as PublicAvailabilitySlotRow[]).map(mapPublicAvailabilitySlotRow);
}

// ---------------------------------------------------------------------------
// is_feature_enabled_for_restaurant() wrapper -- migration 0024. This is how
// an anonymous (or signed-in) visitor's browser finds out whether a given
// opt-in capability (e.g. 'live_availability') is turned on for the ONE
// restaurant they're looking at, without needing the `feature_flags_select`
// RLS policy's `auth.uid() is not null` requirement (0011) -- see that
// migration's header comment for why a narrow boolean RPC, not a widened
// table grant.
//
// Never throws: the underlying function returns false (not an error) for an
// unrecognized restaurant slug or flag key, and this wrapper additionally
// swallows any transport error into `false` too -- a feature-flag check is
// never allowed to break the page it's gating. Callers that need to
// distinguish "flag off" from "couldn't check" should not use this helper.
// ---------------------------------------------------------------------------
export async function fetchIsFeatureEnabledForRestaurant(client: SupabaseClient, restaurantSlug: string, flagKey: string): Promise<boolean> {
  const { data, error } = await client.rpc('is_feature_enabled_for_restaurant', {
    p_restaurant_slug: restaurantSlug,
    p_flag_key: flagKey,
  });
  if (error) return false;
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Phase 3 of the Live Availability upgrade (migration 0025): subscribe to
// restaurant_availability_versions via Supabase Realtime so the customer's
// browser learns the instant someone else's booking could have changed the
// picture it's showing -- without polling on a timer (spec section 38) and
// without exposing any guest/booking data (spec section 28; see 0025's own
// header comment for why this narrow heartbeat table exists at all instead
// of subscribing to reservations/reservation_tables directly).
//
// Deliberately fires onChange for EVERY row event on this table for the
// given restaurant, without inspecting the payload -- there is nothing in
// the row worth inspecting (no date, no table, no count), the caller is
// expected to just re-run its own existing fetch (e.g.
// fetchPublicAvailabilitySummary) for whatever date it currently has
// selected. Returns a plain unsubscribe function so a React effect's
// cleanup can call it directly.
// ---------------------------------------------------------------------------
export function subscribeToAvailabilityChanges(client: SupabaseClient, restaurantId: string, onChange: () => void): () => void {
  const channel = client
    .channel(`restaurant-availability-${restaurantId}`)
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
