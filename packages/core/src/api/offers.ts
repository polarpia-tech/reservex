import type { SupabaseClient } from '@supabase/supabase-js';

import type { ISODateTime, Offer, UUID } from '../types/database';

// ---------------------------------------------------------------------------
// offers: brand new in migration 0042 (Phase 20). Same shape of split as
// events.ts -- fetchOffers() for staff (offers_select, all non-deleted rows
// for the restaurant) and fetchPublicOffers() for the public page
// (offers_public_select already restricts server-side to active/non-deleted/
// restaurant-active; this adds the "is it within its own validity window
// right now" check, which RLS deliberately does NOT enforce -- see the
// Offer type's doc comment in types/database.ts).
// ---------------------------------------------------------------------------

export interface OfferRow {
  id: string;
  restaurant_id: string;
  title: string;
  title_i18n: Record<string, string> | null;
  description: string | null;
  description_i18n: Record<string, string> | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function mapOfferRow(row: OfferRow): Offer {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    title: row.title,
    titleI18n: row.title_i18n ?? {},
    description: row.description,
    descriptionI18n: row.description_i18n ?? {},
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Whether `offer` is within its own [validFrom, validUntil] window right
 * now. Either bound being null means "no bound on that side" (an evergreen
 * offer with both null is always currently valid). This is deliberately a
 * plain function over an already-fetched Offer, not a query filter -- so
 * the same fetched list can be used both to show "current" offers and,
 * e.g., a staff screen listing everything including future/expired ones.
 */
export function isOfferCurrentlyValid(offer: Offer, now: Date = new Date()): boolean {
  if (offer.validFrom && now < new Date(offer.validFrom)) return false;
  if (offer.validUntil && now > new Date(offer.validUntil)) return false;
  return true;
}

/**
 * Staff view: every non-deleted offer for the restaurant, active or not,
 * regardless of its validity window -- gated by offers_select
 * (is_restaurant_member). Ordered by creation, newest first.
 */
export async function fetchOffers(client: SupabaseClient, restaurantId: UUID): Promise<Offer[]> {
  const { data, error } = await client
    .from('offers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as OfferRow[]).map(mapOfferRow);
}

/**
 * Public view for a restaurant's own page: whatever offers_public_select
 * (0042) lets an anon caller see, further narrowed to offers currently
 * within their own validity window (isOfferCurrentlyValid) -- a public
 * visitor should never see "Expired Summer Deal" or a not-yet-started
 * future promotion advertised as if it applies today.
 */
export async function fetchPublicOffers(client: SupabaseClient, restaurantId: UUID): Promise<Offer[]> {
  const { data, error } = await client
    .from('offers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as OfferRow[]).map(mapOfferRow).filter((offer) => isOfferCurrentlyValid(offer));
}

export interface OfferInput {
  title: string;
  titleI18n?: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  description?: string | null;
  descriptionI18n?: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  validFrom?: ISODateTime | null;
  validUntil?: ISODateTime | null;
  isActive?: boolean;
}

/** Plain sequential insert, same reasoning as createEvent()/createTableCombination() -- owner/manager/reservation_manager-only write (offers_write), no concurrency hazard here. */
export async function createOffer(client: SupabaseClient, restaurantId: UUID, input: OfferInput): Promise<UUID> {
  const { data, error } = await client
    .from('offers')
    .insert({
      restaurant_id: restaurantId,
      title: input.title,
      title_i18n: input.titleI18n ?? {},
      description: input.description ?? null,
      description_i18n: input.descriptionI18n ?? {},
      valid_from: input.validFrom ?? null,
      valid_until: input.validUntil ?? null,
      is_active: input.isActive ?? true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface OfferUpdate {
  title?: string;
  titleI18n?: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  description?: string | null;
  descriptionI18n?: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  validFrom?: ISODateTime | null;
  validUntil?: ISODateTime | null;
  isActive?: boolean;
}

export async function updateOffer(client: SupabaseClient, offerId: UUID, patch: OfferUpdate): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.titleI18n !== undefined) row.title_i18n = patch.titleI18n;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.descriptionI18n !== undefined) row.description_i18n = patch.descriptionI18n;
  if (patch.validFrom !== undefined) row.valid_from = patch.validFrom;
  if (patch.validUntil !== undefined) row.valid_until = patch.validUntil;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (Object.keys(row).length === 0) return;

  const { error } = await client.from('offers').update(row).eq('id', offerId);
  if (error) throw error;
}

/** Soft delete -- same pattern as deleteEvent()/deleteTable(): sets deleted_at, never a hard DELETE. */
export async function deleteOffer(client: SupabaseClient, offerId: UUID): Promise<void> {
  const { error } = await client.from('offers').update({ deleted_at: new Date().toISOString() }).eq('id', offerId);
  if (error) throw error;
}
