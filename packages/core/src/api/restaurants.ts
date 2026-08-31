import type { SupabaseClient } from '@supabase/supabase-js';

import type { Restaurant, RestaurantType, StaffRole, UUID } from '../types/database';

export interface MyRestaurantMembership {
  restaurantUserId: UUID;
  role: StaffRole;
  restaurant: Restaurant;
}

/**
 * Raw shape as it comes back from Postgres (snake_case) before mapping to
 * our camelCase types. Exported (along with mapRestaurantRow below) so
 * api/publicBooking.ts can reuse it for the public restaurant-profile
 * lookup -- it's the exact same table/columns, just reached through a
 * different (anon-friendly) RLS policy, so there is no reason to duplicate
 * this mapping.
 */
export interface RestaurantRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  restaurant_type: RestaurantType;
  description: string | null;
  description_i18n: Record<string, string> | null;
  logo_url: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  country_code: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  timezone: string;
  default_locale: string;
  supported_locales: string[];
  seating_capacity_total: number | null;
  min_party_size: number;
  max_party_size: number;
  default_reservation_duration_min: number;
  default_turnover_buffer_min: number;
  booking_window_min_hours: number;
  booking_window_max_days: number;
  is_active: boolean;
}

export function mapRestaurantRow(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    restaurantType: row.restaurant_type,
    description: row.description,
    descriptionI18n: row.description_i18n ?? {},
    logoUrl: row.logo_url,
    addressLine: row.address_line,
    city: row.city,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.website_url,
    timezone: row.timezone,
    defaultLocale: row.default_locale,
    supportedLocales: row.supported_locales,
    seatingCapacityTotal: row.seating_capacity_total,
    minPartySize: row.min_party_size,
    maxPartySize: row.max_party_size,
    defaultReservationDurationMin: row.default_reservation_duration_min,
    defaultTurnoverBufferMin: row.default_turnover_buffer_min,
    bookingWindowMinHours: row.booking_window_min_hours,
    bookingWindowMaxDays: row.booking_window_max_days,
    isActive: row.is_active,
  };
}

/**
 * Every restaurant the given user is an active staff member of, with their
 * role at each. This is the query that decides, on every app launch,
 * whether someone lands on onboarding ("create your first restaurant") or
 * straight into the reservations screen -- see src/navigation/useProtectedRoute.ts
 * in the mobile app.
 */
export async function fetchMyRestaurants(client: SupabaseClient, userId: UUID): Promise<MyRestaurantMembership[]> {
  const { data, error } = await client
    .from('restaurant_users')
    .select('id, role, restaurant:restaurants(*)')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) throw error;

  return (data ?? [])
    .filter((row): row is typeof row & { restaurant: RestaurantRow } => row.restaurant !== null)
    .map((row) => ({
      restaurantUserId: row.id as UUID,
      role: row.role as StaffRole,
      restaurant: mapRestaurantRow(row.restaurant as unknown as RestaurantRow),
    }));
}

/**
 * The subset of `restaurants` columns exposed for owner/manager editing in
 * Phase 05. Deliberately excludes: logo_url / cover_image_url / gallery_image_urls
 * (needs Supabase Storage buckets + policies, not set up yet -- a later
 * phase), social_links (structured jsonb editor, not worth building before
 * there is a customer-facing surface that reads it), and description_i18n
 * (per-language editing makes more sense once Phase 08's customer booking
 * experience actually displays it to guests in their own language -- see
 * README "Phase 05" for the full reasoning). `description` here is the
 * plain, single-language text staff see internally, not customer-facing copy.
 */
export interface RestaurantProfileUpdate {
  name?: string;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  addressLine?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  seatingCapacityTotal?: number | null;
  minPartySize?: number;
  maxPartySize?: number;
  defaultReservationDurationMin?: number;
  defaultTurnoverBufferMin?: number;
  bookingWindowMinHours?: number;
  bookingWindowMaxDays?: number;
}

/**
 * Updates a restaurant's profile directly as the signed-in user (NOT via an
 * Edge Function) -- this is a plain client-side UPDATE, allowed by the
 * `restaurants_update` RLS policy (0011) for owner/manager only. Unlike
 * restaurant CREATION (see bootstrap-restaurant Edge Function, Phase 04),
 * there is no chicken-and-egg problem here: the caller is already an
 * established owner/manager of an existing restaurant, so RLS can enforce
 * this rule on its own without any service-role step.
 */
export async function updateRestaurant(
  client: SupabaseClient,
  restaurantId: UUID,
  patch: RestaurantProfileUpdate,
): Promise<Restaurant> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.phone !== undefined) payload.phone = patch.phone;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.websiteUrl !== undefined) payload.website_url = patch.websiteUrl;
  if (patch.addressLine !== undefined) payload.address_line = patch.addressLine;
  if (patch.city !== undefined) payload.city = patch.city;
  if (patch.postalCode !== undefined) payload.postal_code = patch.postalCode;
  if (patch.countryCode !== undefined) payload.country_code = patch.countryCode;
  if (patch.seatingCapacityTotal !== undefined) payload.seating_capacity_total = patch.seatingCapacityTotal;
  if (patch.minPartySize !== undefined) payload.min_party_size = patch.minPartySize;
  if (patch.maxPartySize !== undefined) payload.max_party_size = patch.maxPartySize;
  if (patch.defaultReservationDurationMin !== undefined) {
    payload.default_reservation_duration_min = patch.defaultReservationDurationMin;
  }
  if (patch.defaultTurnoverBufferMin !== undefined) payload.default_turnover_buffer_min = patch.defaultTurnoverBufferMin;
  if (patch.bookingWindowMinHours !== undefined) payload.booking_window_min_hours = patch.bookingWindowMinHours;
  if (patch.bookingWindowMaxDays !== undefined) payload.booking_window_max_days = patch.bookingWindowMaxDays;

  const { data, error } = await client.from('restaurants').update(payload).eq('id', restaurantId).select('*').single();
  if (error) throw error;
  return mapRestaurantRow(data as RestaurantRow);
}
