// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AiToolName } from '../../../packages/ai/src/types.ts';

/**
 * The Edge Function-side half of every tool: given the two clients and the
 * caller's id, `authorize()` implements steps 2-3 of the blueprint's 5-step
 * pipeline (Authorization, Validation) and throws on failure; `summarize()`
 * produces the plain-language confirmation text shown to the human before
 * anything happens; `run()` implements step 4-5 (Business rules, DB
 * operation) and is the ONLY place that actually writes data.
 *
 * `authorize()` is called twice for any tool with requiresConfirmation=true:
 * once when the AI first proposes it (to fail fast and to build the
 * confirmation summary) and again, from scratch, at confirm-time -- nothing
 * from the first call is trusted at execution time, since real time has
 * passed and the caller's role/membership could have changed in between.
 */
export interface ToolContext {
  callerClient: SupabaseClient;
  adminClient: SupabaseClient;
  callerId: string;
}

export class AuthorizationError extends Error {}
export class ValidationError extends Error {}

export interface ToolExecutor {
  authorize(ctx: ToolContext, input: Record<string, any>): Promise<void>;
  summarize(input: Record<string, any>): string;
  run(ctx: ToolContext, input: Record<string, any>): Promise<Record<string, any>>;
}

async function isRestaurantMember(client: SupabaseClient, restaurantId: string): Promise<boolean> {
  const { data, error } = await client.rpc('is_restaurant_member', { target_restaurant_id: restaurantId });
  if (error) throw error;
  return Boolean(data);
}

async function hasOwnerOrManagerRole(client: SupabaseClient, restaurantId: string): Promise<boolean> {
  const { data, error } = await client.rpc('has_restaurant_role', {
    target_restaurant_id: restaurantId,
    allowed_roles: ['owner', 'manager'],
  });
  if (error) throw error;
  return Boolean(data);
}

/** Looks up which restaurant a reservation belongs to, using the admin client -- needed because we must learn this BEFORE we know whether the caller is even allowed to see the row via RLS. */
async function reservationRestaurantId(adminClient: SupabaseClient, reservationId: string): Promise<string> {
  const { data, error } = await adminClient.from('reservations').select('restaurant_id').eq('id', reservationId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ValidationError('RESERVATION_NOT_FOUND');
  return (data as { restaurant_id: string }).restaurant_id;
}

// ---------------------------------------------------------------------------
// Low risk / read-only
// ---------------------------------------------------------------------------

const findAvailability: ToolExecutor = {
  async authorize(ctx, input) {
    if (!(await isRestaurantMember(ctx.callerClient, input.restaurantId))) {
      throw new AuthorizationError('Not a member of this restaurant.');
    }
  },
  summarize(input) {
    return `Checking availability for ${input.partySize} guests between ${input.startsAt} and ${input.endsAt}.`;
  },
  async run(ctx, input) {
    const { data: singleTables, error: e1 } = await ctx.callerClient.rpc('get_available_tables', {
      p_restaurant_id: input.restaurantId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_party_size: input.partySize,
      p_zone_id: null,
      p_exclude_reservation_id: null,
      p_include_vip: false,
    });
    if (e1) throw e1;

    let combinations: unknown[] = [];
    if (!singleTables || singleTables.length === 0) {
      const { data, error: e2 } = await ctx.callerClient.rpc('get_available_table_combinations', {
        p_restaurant_id: input.restaurantId,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_party_size: input.partySize,
        p_exclude_reservation_id: null,
      });
      if (e2) throw e2;
      combinations = data ?? [];
    }
    return { singleTables: singleTables ?? [], combinations };
  },
};

const getReservation: ToolExecutor = {
  async authorize(ctx, input) {
    const restaurantId = await reservationRestaurantId(ctx.adminClient, input.reservationId);
    if (!(await isRestaurantMember(ctx.callerClient, restaurantId))) {
      throw new AuthorizationError("Not a member of this reservation's restaurant.");
    }
  },
  summarize(input) {
    return `Looking up reservation ${input.reservationId}.`;
  },
  async run(ctx, input) {
    const { data, error } = await ctx.callerClient
      .from('reservations')
      .select('*, reservation_tables(table_id, tables(label))')
      .eq('id', input.reservationId)
      .single();
    if (error) throw error;
    return data as Record<string, any>;
  },
};

const getAnalytics: ToolExecutor = {
  async authorize(ctx, input) {
    if (!(await isRestaurantMember(ctx.callerClient, input.restaurantId))) {
      throw new AuthorizationError('Not a member of this restaurant.');
    }
  },
  summarize(input) {
    return `Analytics for ${input.restaurantId} from ${input.dateFrom} to ${input.dateTo}.`;
  },
  async run(ctx, input) {
    const { data, error } = await ctx.callerClient.rpc('get_reservation_analytics', {
      p_restaurant_id: input.restaurantId,
      p_date_from: input.dateFrom,
      p_date_to: input.dateTo,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) ?? {};
  },
};

// ---------------------------------------------------------------------------
// Medium risk -- single-record writes, always confirmed
// ---------------------------------------------------------------------------

const createReservation: ToolExecutor = {
  async authorize(ctx, input) {
    if (!(await isRestaurantMember(ctx.callerClient, input.restaurantId))) {
      throw new AuthorizationError('Not a member of this restaurant.');
    }
  },
  summarize(input) {
    const who = input.guestName ?? (input.customerId ? `customer ${input.customerId}` : 'a guest');
    return `Create a reservation for ${who}, party of ${input.partySize}, ${input.startsAt} - ${input.endsAt}.`;
  },
  async run(ctx, input) {
    const { data, error } = await ctx.callerClient.rpc('book_reservation', {
      p_restaurant_id: input.restaurantId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_party_size: input.partySize,
      p_source: 'admin',
      p_customer_id: input.customerId ?? null,
      p_guest_name: input.guestName ?? null,
      p_guest_phone: input.guestPhone ?? null,
      p_guest_email: null,
      p_special_requests: input.specialRequests ?? null,
      p_internal_notes: null,
      p_zone_preference_id: null,
      p_buffer_minutes: null,
      p_table_ids: null,
      p_reservation_id: null,
    });
    if (error) throw error;
    return data as Record<string, any>;
  },
};

const modifyReservation: ToolExecutor = {
  async authorize(ctx, input) {
    const restaurantId = await reservationRestaurantId(ctx.adminClient, input.reservationId);
    if (!(await isRestaurantMember(ctx.callerClient, restaurantId))) {
      throw new AuthorizationError("Not a member of this reservation's restaurant.");
    }
  },
  summarize(input) {
    return `Reschedule reservation ${input.reservationId} to ${input.startsAt} - ${input.endsAt}, party of ${input.partySize}.`;
  },
  async run(ctx, input) {
    // book_reservation's reschedule path hard-sets starts_at/ends_at/party_size
    // /zone_preference_id (no coalesce for those) -- so we must load the
    // current row first for restaurant_id and zone_preference_id, exactly
    // like the mobile "reschedule" screen implicitly does by re-submitting
    // the whole form (see packages/core rescheduleReservation).
    const { data: current, error: fetchError } = await ctx.adminClient
      .from('reservations')
      .select('restaurant_id, zone_preference_id')
      .eq('id', input.reservationId)
      .single();
    if (fetchError) throw fetchError;

    const { data, error } = await ctx.callerClient.rpc('book_reservation', {
      p_restaurant_id: (current as any).restaurant_id,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_party_size: input.partySize,
      p_source: 'admin',
      p_customer_id: null,
      p_guest_name: null,
      p_guest_phone: null,
      p_guest_email: null,
      p_special_requests: null,
      p_internal_notes: null,
      p_zone_preference_id: (current as any).zone_preference_id,
      p_buffer_minutes: null,
      p_table_ids: null,
      p_reservation_id: input.reservationId,
    });
    if (error) throw error;
    return data as Record<string, any>;
  },
};

const cancelReservation: ToolExecutor = {
  async authorize(ctx, input) {
    const restaurantId = await reservationRestaurantId(ctx.adminClient, input.reservationId);
    if (!(await isRestaurantMember(ctx.callerClient, restaurantId))) {
      throw new AuthorizationError("Not a member of this reservation's restaurant.");
    }
  },
  summarize(input) {
    return `Cancel reservation ${input.reservationId}${input.reason ? ` (reason: ${input.reason})` : ''}.`;
  },
  async run(ctx, input) {
    const patch: Record<string, any> = { status: 'cancelled' };
    if (input.reason !== undefined) patch.cancellation_reason = input.reason;
    const { data, error } = await ctx.callerClient.from('reservations').update(patch).eq('id', input.reservationId).select().single();
    if (error) throw error;
    return data as Record<string, any>;
  },
};

// ---------------------------------------------------------------------------
// High risk -- multi-record or restaurant-wide writes
// ---------------------------------------------------------------------------

const bulkCancelReservations: ToolExecutor = {
  async authorize(ctx, input) {
    const ids: string[] = input.reservationIds ?? [];
    if (ids.length === 0) throw new ValidationError('reservationIds must not be empty.');
    // Fail closed: every single reservation must belong to a restaurant the
    // caller is a member of, or the whole bulk action is refused up front.
    for (const id of ids) {
      const restaurantId = await reservationRestaurantId(ctx.adminClient, id);
      if (!(await isRestaurantMember(ctx.callerClient, restaurantId))) {
        throw new AuthorizationError(`Not a member of the restaurant for reservation ${id}.`);
      }
    }
  },
  summarize(input) {
    const count = (input.reservationIds ?? []).length;
    return `Cancel ${count} reservation(s)${input.reason ? ` (reason: ${input.reason})` : ''}. This cannot be undone from this chat.`;
  },
  async run(ctx, input) {
    const ids: string[] = input.reservationIds;
    const patch: Record<string, any> = { status: 'cancelled' };
    if (input.reason !== undefined) patch.cancellation_reason = input.reason;
    const failedIds: string[] = [];
    let cancelledCount = 0;
    for (const id of ids) {
      const { error } = await ctx.callerClient.from('reservations').update(patch).eq('id', id);
      if (error) failedIds.push(id);
      else cancelledCount++;
    }
    return { cancelledCount, failedIds };
  },
};

// Same allow-list of writable columns as packages/core's updateRestaurant --
// duplicated here rather than imported (this function does not import
// packages/core, see this folder's index.ts header comment) so the AI can
// NEVER write a column outside this explicit list, no matter what a model
// decides to put in the tool call's `patch` object.
const RESTAURANT_SETTINGS_FIELDS: Record<string, string> = {
  name: 'name',
  description: 'description',
  phone: 'phone',
  email: 'email',
  websiteUrl: 'website_url',
  addressLine: 'address_line',
  city: 'city',
  postalCode: 'postal_code',
  countryCode: 'country_code',
  seatingCapacityTotal: 'seating_capacity_total',
  minPartySize: 'min_party_size',
  maxPartySize: 'max_party_size',
  defaultReservationDurationMin: 'default_reservation_duration_min',
  defaultTurnoverBufferMin: 'default_turnover_buffer_min',
  bookingWindowMinHours: 'booking_window_min_hours',
  bookingWindowMaxDays: 'booking_window_max_days',
};

function mapRestaurantPatch(patch: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    const column = RESTAURANT_SETTINGS_FIELDS[key];
    if (!column) throw new ValidationError(`Unknown or disallowed settings field: ${key}`);
    mapped[column] = value;
  }
  if (Object.keys(mapped).length === 0) throw new ValidationError('patch must contain at least one recognized field.');
  return mapped;
}

const updateRestaurantSettings: ToolExecutor = {
  async authorize(ctx, input) {
    mapRestaurantPatch(input.patch); // validate field names up front, before the confirmation is even shown
    if (!(await hasOwnerOrManagerRole(ctx.callerClient, input.restaurantId))) {
      throw new AuthorizationError('Only an owner or manager may change restaurant settings.');
    }
  },
  summarize(input) {
    const fields = Object.keys(input.patch ?? {}).join(', ');
    return `Update restaurant settings: ${fields}.`;
  },
  async run(ctx, input) {
    const mapped = mapRestaurantPatch(input.patch);
    const { data, error } = await ctx.callerClient.from('restaurants').update(mapped).eq('id', input.restaurantId).select().single();
    if (error) throw error;
    return data as Record<string, any>;
  },
};

export const TOOL_EXECUTORS: Record<AiToolName, ToolExecutor> = {
  findAvailability,
  getReservation,
  getAnalytics,
  createReservation,
  modifyReservation,
  cancelReservation,
  bulkCancelReservations,
  updateRestaurantSettings,
};
