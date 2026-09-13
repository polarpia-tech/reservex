import type { SupabaseClient } from '@supabase/supabase-js';

import type { ISODateTime, RestaurantEvent, UUID } from '../types/database';

// ---------------------------------------------------------------------------
// events (staff-side CRUD, existing since Phase 02) + the new public read
// added by migration 0042 (Phase 21). The table itself is unchanged by this
// phase -- only a new events_public_select RLS policy was added, so the
// SAME fetch function below works for a staff caller (existing
// events_select policy, unaffected) and for an anon/public caller
// (fetchPublicEvents applies the extra client-side filtering a public page
// actually wants -- upcoming only, ordered chronologically -- on top of
// whatever events_public_select already restricts server-side).
// ---------------------------------------------------------------------------

export interface EventRow {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  description_i18n: Record<string, string> | null;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  min_party_size: number | null;
  max_party_size: number | null;
  is_private: boolean;
  booking_opens_at: string | null;
  booking_closes_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function mapEventRow(row: EventRow): RestaurantEvent {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    descriptionI18n: row.description_i18n ?? {},
    coverImageUrl: row.cover_image_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    minPartySize: row.min_party_size,
    maxPartySize: row.max_party_size,
    isPrivate: row.is_private,
    bookingOpensAt: row.booking_opens_at,
    bookingClosesAt: row.booking_closes_at,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Staff view: every non-deleted event for the restaurant, including
 * private/inactive/past ones (owner/manager/reservation_manager need to see
 * and edit those too) -- gated by the pre-existing events_select policy,
 * untouched by 0042. Ordered soonest-first.
 */
export async function fetchEvents(client: SupabaseClient, restaurantId: UUID): Promise<RestaurantEvent[]> {
  const { data, error } = await client
    .from('events')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .is('deleted_at', null)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data as EventRow[]).map(mapEventRow);
}

/**
 * Public view for a restaurant's own page: only what events_public_select
 * (0042) already lets an anon caller see -- active, non-deleted,
 * non-private, restaurant active -- further narrowed here to events that
 * haven't ended yet, since a public page has no reason to advertise a past
 * event. Pass a client authenticated as anon (or no auth at all); a staff
 * client would also get this same result plus more from fetchEvents()
 * above, so this function has no real reason to be called with one.
 */
export async function fetchPublicEvents(client: SupabaseClient, restaurantId: UUID): Promise<RestaurantEvent[]> {
  const { data, error } = await client
    .from('events')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data as EventRow[]).map(mapEventRow);
}

export interface EventInput {
  name: string;
  description?: string | null;
  descriptionI18n?: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  coverImageUrl?: string | null;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  capacity?: number | null;
  minPartySize?: number | null;
  maxPartySize?: number | null;
  isPrivate?: boolean;
  bookingOpensAt?: ISODateTime | null;
  bookingClosesAt?: ISODateTime | null;
  isActive?: boolean;
}

/**
 * Plain sequential insert, same reasoning as createTableCombination in
 * tableCombinations.ts: owner/manager/reservation_manager-only write (0011,
 * unchanged by 0042), no concurrency hazard to guard against here the way
 * there is for reservations, so no need for a SECURITY DEFINER function.
 */
export async function createEvent(client: SupabaseClient, restaurantId: UUID, input: EventInput): Promise<UUID> {
  const { data, error } = await client
    .from('events')
    .insert({
      restaurant_id: restaurantId,
      name: input.name,
      description: input.description ?? null,
      description_i18n: input.descriptionI18n ?? {},
      cover_image_url: input.coverImageUrl ?? null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      capacity: input.capacity ?? null,
      min_party_size: input.minPartySize ?? null,
      max_party_size: input.maxPartySize ?? null,
      is_private: input.isPrivate ?? false,
      booking_opens_at: input.bookingOpensAt ?? null,
      booking_closes_at: input.bookingClosesAt ?? null,
      is_active: input.isActive ?? true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface EventUpdate {
  name?: string;
  description?: string | null;
  descriptionI18n?: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  coverImageUrl?: string | null;
  startsAt?: ISODateTime;
  endsAt?: ISODateTime;
  capacity?: number | null;
  minPartySize?: number | null;
  maxPartySize?: number | null;
  isPrivate?: boolean;
  bookingOpensAt?: ISODateTime | null;
  bookingClosesAt?: ISODateTime | null;
  isActive?: boolean;
}

export async function updateEvent(client: SupabaseClient, eventId: UUID, patch: EventUpdate): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.descriptionI18n !== undefined) row.description_i18n = patch.descriptionI18n;
  if (patch.coverImageUrl !== undefined) row.cover_image_url = patch.coverImageUrl;
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
  if (patch.capacity !== undefined) row.capacity = patch.capacity;
  if (patch.minPartySize !== undefined) row.min_party_size = patch.minPartySize;
  if (patch.maxPartySize !== undefined) row.max_party_size = patch.maxPartySize;
  if (patch.isPrivate !== undefined) row.is_private = patch.isPrivate;
  if (patch.bookingOpensAt !== undefined) row.booking_opens_at = patch.bookingOpensAt;
  if (patch.bookingClosesAt !== undefined) row.booking_closes_at = patch.bookingClosesAt;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (Object.keys(row).length === 0) return;

  const { error } = await client.from('events').update(row).eq('id', eventId);
  if (error) throw error;
}

/** Soft delete -- same pattern as deleteTable() in tables.ts: sets deleted_at, never a hard DELETE (keeps history, and fetchEvents()'s `is('deleted_at', null)` filter hides it immediately). */
export async function deleteEvent(client: SupabaseClient, eventId: UUID): Promise<void> {
  const { error } = await client.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', eventId);
  if (error) throw error;
}
