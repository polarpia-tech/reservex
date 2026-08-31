import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Customer,
  Notification,
  NotificationRecipientType,
  NotificationStatus,
  Reservation,
  ReservationSource,
  ReservationStatus,
} from '../types/database';

// ---------------------------------------------------------------------------
// The signed-in-customer side of Phase 08: "my reservations" across every
// restaurant they've booked with, and the customers-row profile behind it.
//
// Deliberately NOT here: supabase.auth.signUp / signInWithPassword /
// signOut wrappers. The mobile app's own staff auth screens
// (apps/mobile/app/(auth)/*.tsx) call `supabase.auth.*` directly rather
// than through packages/core, and the web app's customer login/signup
// follows the same established pattern -- there is nothing
// restaurant-specific or RLS-specific about calling Supabase Auth itself,
// so wrapping it here would just be an extra indirection with no payoff.
// What IS specific to this app, and does belong here, is the lazy
// customers-row bookkeeping and the cross-restaurant reservations query.
// ---------------------------------------------------------------------------

interface CustomerRow {
  id: string;
  auth_user_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_locale: string;
  marketing_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

function mapCustomerRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    preferredLocale: row.preferred_locale,
    marketingOptIn: row.marketing_opt_in,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Looks up the signed-in user's own customers row, or null if they've never
 * had one created (e.g. they just signed up and haven't booked yet, and
 * haven't visited the account/profile page before either). Relies on the
 * customers_select RLS policy (0005/0011, unaffected by 0014) -- owns_customer(id).
 */
export async function fetchMyCustomerProfile(client: SupabaseClient): Promise<Customer | null> {
  const { data, error } = await client.from('customers').select('*').maybeSingle();
  if (error) throw error;
  return data ? mapCustomerRow(data as CustomerRow) : null;
}

export interface CustomerProfileInput {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredLocale?: string;
  marketingOptIn?: boolean;
}

/**
 * Creates the signed-in user's customers row if one doesn't exist yet, or
 * patches it if it does. This is the same lazy-creation book_public_reservation
 * (0014) already does internally the moment a signed-in customer's first
 * booking is placed -- exposed here as a standalone call so the web app's
 * account/profile page can create or edit that row directly, WITHOUT
 * requiring the user to have booked a table first (e.g. "create your
 * account and set your name/phone before you ever book anything").
 *
 * Both the insert and the update go through the hardened customers_insert /
 * customers_update RLS policies from 0014: auth_user_id is always forced to
 * the caller's own auth.uid() here, so there is no way to call this in a
 * way that claims or reassigns someone else's row.
 */
export async function ensureMyCustomerProfile(client: SupabaseClient, patch?: CustomerProfileInput): Promise<Customer> {
  const existing = await fetchMyCustomerProfile(client);

  if (existing) {
    if (!patch) return existing;
    const payload: Record<string, unknown> = {};
    if (patch.fullName !== undefined) payload.full_name = patch.fullName;
    if (patch.email !== undefined) payload.email = patch.email;
    if (patch.phone !== undefined) payload.phone = patch.phone;
    if (patch.preferredLocale !== undefined) payload.preferred_locale = patch.preferredLocale;
    if (patch.marketingOptIn !== undefined) payload.marketing_opt_in = patch.marketingOptIn;
    if (Object.keys(payload).length === 0) return existing;
    const { data, error } = await client.from('customers').update(payload).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return mapCustomerRow(data as CustomerRow);
  }

  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('ensureMyCustomerProfile: no signed-in user (call this only after auth.signIn/signUp).');

  const { data, error } = await client
    .from('customers')
    .insert({
      auth_user_id: user.id,
      full_name: patch?.fullName ?? null,
      email: patch?.email ?? user.email ?? null,
      phone: patch?.phone ?? null,
      preferred_locale: patch?.preferredLocale ?? 'en',
      marketing_opt_in: patch?.marketingOptIn ?? false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapCustomerRow(data as CustomerRow);
}

// ---------------------------------------------------------------------------
// "My reservations" -- cross-restaurant history for the signed-in customer.
// ---------------------------------------------------------------------------
interface ReservationWithRestaurantRow {
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
  // Embedded via restaurants_public_select (0014) -- null for a reservation
  // at a restaurant that has since gone inactive/deleted, since RLS then
  // hides that nested row. The reservation itself is still returned; only
  // its restaurant name/slug become unavailable to display.
  restaurants: { name: string; slug: string } | null;
}

export interface MyReservation extends Reservation {
  restaurantName: string | null;
  restaurantSlug: string | null;
}

function mapReservationWithRestaurantRow(row: ReservationWithRestaurantRow): MyReservation {
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
    restaurantName: row.restaurants?.name ?? null,
    restaurantSlug: row.restaurants?.slug ?? null,
  };
}

/**
 * Every reservation the signed-in customer has ever made, across every
 * restaurant, newest-first. Relies on reservations_select's
 * `owns_customer(customer_id)` clause (0011) -- unchanged by Phase 08,
 * since that grant already existed; 0014 only added the ability for a
 * customer to CREATE a reservation this way (via book_public_reservation)
 * and to CANCEL one (reservations_customer_cancel), not the ability to read
 * their own history, which was already there.
 */
export async function fetchMyReservationsAsCustomer(client: SupabaseClient): Promise<MyReservation[]> {
  const profile = await fetchMyCustomerProfile(client);
  if (!profile) return [];

  const { data, error } = await client
    .from('reservations')
    .select('*, restaurants(name, slug)')
    .eq('customer_id', profile.id)
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as ReservationWithRestaurantRow[]).map(mapReservationWithRestaurantRow);
}

// ---------------------------------------------------------------------------
// Phase 09: the customer's own in-app notification inbox -- the same
// public.notifications table api/notifications.ts's fetchMyStaffNotifications
// reads, filtered the other way (recipient_customer_id instead of
// recipient_user_id). Kept in this file rather than notifications.ts
// because it needs the same "look up my own customers row first" step
// every other customer-identity function here already does.
// ---------------------------------------------------------------------------
interface NotificationRowLite {
  id: string;
  restaurant_id: string | null;
  recipient_type: NotificationRecipientType;
  recipient_customer_id: string | null;
  recipient_user_id: string | null;
  channel: string;
  template_code: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  reservation_id: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  created_at: string;
}

function mapNotificationRowLite(row: NotificationRowLite): Notification {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    recipientType: row.recipient_type,
    recipientCustomerId: row.recipient_customer_id,
    recipientUserId: row.recipient_user_id,
    channel: row.channel as Notification['channel'],
    templateCode: row.template_code,
    payload: row.payload ?? {},
    status: row.status,
    reservationId: row.reservation_id,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/** The signed-in customer's own in-app inbox, newest first. Empty array (not an error) if they have no customers row yet -- same "nothing to show" shape as fetchMyReservationsAsCustomer above. */
export async function fetchMyNotificationsAsCustomer(client: SupabaseClient): Promise<Notification[]> {
  const profile = await fetchMyCustomerProfile(client);
  if (!profile) return [];

  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('recipient_customer_id', profile.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as NotificationRowLite[]).map(mapNotificationRowLite);
}
