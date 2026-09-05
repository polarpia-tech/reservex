import type { SupabaseClient } from '@supabase/supabase-js';

import type { ISODate, ISODateTime, UUID, WaitlistEntry, WaitlistStatus } from '../types/database';
import { bookReservation, type BookReservationInput } from './reservations';

interface WaitlistEntryRow {
  id: string;
  restaurant_id: string;
  customer_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  party_size: number;
  requested_date: string;
  requested_time_range: string; // raw Postgres tstzrange literal, e.g. ["2026-09-05 19:00:00+00","2026-09-05 21:00:00+00")
  zone_preference_id: string | null;
  status: WaitlistStatus;
  priority_score: number;
  notified_at: string | null;
  expires_at: string | null;
  converted_reservation_id: string | null;
}

/**
 * Postgres sends a tstzrange over the wire as a plain string, e.g.
 * `["2026-09-05 19:00:00+00","2026-09-05 21:00:00+00")`. PostgREST doesn't
 * parse it into a structured type for us, so we do it by hand here -- once,
 * in one place, rather than every screen re-deriving it.
 */
function parseTstzRange(raw: string): { from: ISODateTime; to: ISODateTime } {
  const match = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(raw.trim());
  if (!match) throw new Error(`Could not parse tstzrange: ${raw}`);
  // noUncheckedIndexedAccess (tsconfig.base.json) types match[1]/match[2] as
  // `string | undefined` on every index access, even here where `match` was
  // just confirmed non-null: the regex above has exactly two (non-optional)
  // capture groups, so whenever the overall match succeeds both are always
  // real strings -- the `!` asserts that guarantee to the type checker.
  return { from: parsePostgresTimestamp(match[1]!), to: parsePostgresTimestamp(match[2]!) };
}

/**
 * Confirmed via a temporary diagnostic against the real backend: Postgres
 * sends each timestamp inside the range as e.g. "2026-09-05 17:00:00+00" --
 * a space-separated date/time with a bare, colon-less UTC offset. Passing
 * that string straight to `new Date(...)` (the previous implementation)
 * works in V8 (Node, Chrome), which leniently accepts this legacy format as
 * a non-standard extension -- but Hermes, the JS engine this app actually
 * runs on in production, does not, and throws "Date value out of bounds".
 *
 * This parses the string by hand into its numeric parts and builds the
 * instant with `Date.UTC(...)`, which every JS engine (including Hermes)
 * implements identically per spec -- no reliance on any engine's string
 * parser, lenient or otherwise. Handles a fractional-seconds component and
 * both colon-less ("+00") and full ("+05:30") offsets, since Postgres can
 * emit either depending on the session's configured timezone.
 */
function parsePostgresTimestamp(raw: string): ISODateTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$/.exec(
    raw.trim(),
  );
  if (!match) throw new Error(`Could not parse Postgres timestamp: ${raw}`);
  const [, year, month, day, hour, minute, second, fraction, offsetHours, offsetMinutes] = match;
  const milliseconds = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  );
  const offsetHoursNum = Number(offsetHours);
  const offsetMinutesNum = Number(offsetMinutes ?? 0);
  const totalOffsetMinutes = offsetHoursNum * 60 + (offsetHoursNum < 0 ? -offsetMinutesNum : offsetMinutesNum);
  return new Date(utcMillis - totalOffsetMinutes * 60_000).toISOString();
}

function toTstzRangeLiteral(from: ISODateTime, to: ISODateTime): string {
  return `[${from},${to})`;
}

function mapWaitlistRow(row: WaitlistEntryRow): WaitlistEntry {
  const { from, to } = parseTstzRange(row.requested_time_range);
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    customerId: row.customer_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    partySize: row.party_size,
    requestedDate: row.requested_date,
    requestedFrom: from,
    requestedTo: to,
    zonePreferenceId: row.zone_preference_id,
    status: row.status,
    priorityScore: row.priority_score,
    notifiedAt: row.notified_at,
    expiresAt: row.expires_at,
    convertedReservationId: row.converted_reservation_id,
  };
}

export async function fetchWaitlist(client: SupabaseClient, restaurantId: UUID, statuses?: WaitlistStatus[]): Promise<WaitlistEntry[]> {
  let query = client
    .from('waitlist_entries')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('requested_date', { ascending: true })
    .order('priority_score', { ascending: false });
  if (statuses && statuses.length > 0) {
    query = query.in('status', statuses);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as WaitlistEntryRow[]).map(mapWaitlistRow);
}

export async function fetchWaitlistEntry(client: SupabaseClient, waitlistEntryId: UUID): Promise<WaitlistEntry> {
  const { data, error } = await client.from('waitlist_entries').select('*').eq('id', waitlistEntryId).single();
  if (error) throw error;
  return mapWaitlistRow(data as WaitlistEntryRow);
}

export interface CreateWaitlistEntryInput {
  restaurantId: UUID;
  customerId?: UUID | null;
  guestName?: string | null;
  guestPhone?: string | null;
  partySize: number;
  requestedDate: ISODate;
  requestedFrom: ISODateTime;
  requestedTo: ISODateTime;
  zonePreferenceId?: UUID | null;
}

export async function createWaitlistEntry(client: SupabaseClient, input: CreateWaitlistEntryInput): Promise<WaitlistEntry> {
  const { data, error } = await client
    .from('waitlist_entries')
    .insert({
      restaurant_id: input.restaurantId,
      customer_id: input.customerId ?? null,
      guest_name: input.guestName ?? null,
      guest_phone: input.guestPhone ?? null,
      party_size: input.partySize,
      requested_date: input.requestedDate,
      requested_time_range: toTstzRangeLiteral(input.requestedFrom, input.requestedTo),
      zone_preference_id: input.zonePreferenceId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapWaitlistRow(data as WaitlistEntryRow);
}

export async function updateWaitlistEntryStatus(client: SupabaseClient, waitlistEntryId: UUID, status: WaitlistStatus): Promise<void> {
  const { error } = await client.from('waitlist_entries').update({ status }).eq('id', waitlistEntryId);
  if (error) throw error;
}

/**
 * Turns a waiting guest into an actual reservation. This is two separate
 * statements (book, then mark the waitlist entry converted), not one atomic
 * DB function like book_reservation itself -- deliberately: the waitlist
 * entry isn't a safety-critical row (nothing double-books if it's briefly
 * inconsistent), so the extra complexity of pushing this into SQL isn't
 * worth it. If the first call succeeds and the second one fails (e.g. a
 * dropped connection), the reservation still exists correctly; the host
 * just needs to mark the waitlist entry booked by hand, which the waitlist
 * screen lets them do at any time via updateWaitlistEntryStatus.
 */
export async function convertWaitlistEntryToReservation(
  client: SupabaseClient,
  waitlistEntryId: UUID,
  booking: BookReservationInput,
): Promise<void> {
  const reservation = await bookReservation(client, booking);
  const { error } = await client
    .from('waitlist_entries')
    .update({ status: 'booked', converted_reservation_id: reservation.id })
    .eq('id', waitlistEntryId);
  if (error) throw error;
}
