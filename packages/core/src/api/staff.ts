import type { SupabaseClient } from '@supabase/supabase-js';

import type { StaffMember, StaffRole, UUID } from '../types/database';

interface StaffDirectoryRow {
  restaurant_user_id: string;
  user_id: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  invited_at: string;
  joined_at: string | null;
}

function mapStaffRow(row: StaffDirectoryRow): StaffMember {
  return {
    restaurantUserId: row.restaurant_user_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
  };
}

/**
 * The staff roster, WITH email addresses, for one restaurant. Calls the
 * `get_restaurant_staff` Postgres function (migration 0012) via `.rpc(...)`
 * instead of a normal `.from('restaurant_users').select(...)` -- plain
 * table access cannot join to `auth.users` (Supabase does not expose that
 * schema to the client at all), so a SECURITY DEFINER function is the
 * correct place for this, not an Edge Function round-trip for a single
 * read. See the migration file for the full reasoning and
 * scripts/verify_phase05_staff_directory.sql for the tenant-isolation proof.
 */
export async function fetchRestaurantStaff(client: SupabaseClient, restaurantId: UUID): Promise<StaffMember[]> {
  const { data, error } = await client.rpc('get_restaurant_staff', { p_restaurant_id: restaurantId });
  if (error) throw error;
  return ((data ?? []) as StaffDirectoryRow[]).map(mapStaffRow);
}

/**
 * Changes an existing staff member's role. A plain client-side UPDATE,
 * allowed by the `restaurant_users_write` RLS policy (0011) for
 * owner/manager only -- no Edge Function needed, unlike inviting a
 * brand-new person (see inviteStaffMember below).
 */
export async function updateStaffRole(client: SupabaseClient, restaurantUserId: UUID, role: StaffRole): Promise<void> {
  const { error } = await client.from('restaurant_users').update({ role }).eq('id', restaurantUserId);
  if (error) throw error;
}

/**
 * Deactivates (or reactivates) a staff member. Soft, reversible, and never
 * deletes the row -- audit history (who was staff when) stays intact. Also
 * a plain owner/manager-gated client-side UPDATE under RLS.
 */
export async function setStaffActive(client: SupabaseClient, restaurantUserId: UUID, isActive: boolean): Promise<void> {
  const { error } = await client.from('restaurant_users').update({ is_active: isActive }).eq('id', restaurantUserId);
  if (error) throw error;
}

export interface InviteStaffMemberInput {
  restaurantId: UUID;
  email: string;
  role: Exclude<StaffRole, 'owner'>;
}

/**
 * Invites someone (existing account or brand new) as staff. MUST go through
 * the `invite-staff-member` Edge Function (service role) -- creating a new
 * person's `auth.users` account requires Supabase's admin API, which is
 * never available to a plain client. See supabase/functions/invite-staff-member
 * for the full authorization + business-rule logic (written in Phase 04,
 * wired up to a real screen for the first time in Phase 05).
 */
export async function inviteStaffMember(client: SupabaseClient, input: InviteStaffMemberInput): Promise<void> {
  const { error } = await client.functions.invoke('invite-staff-member', {
    body: { restaurantId: input.restaurantId, email: input.email, role: input.role },
  });
  if (error) {
    // supabase-js wraps any non-2xx Edge Function response in a generic
    // FunctionsHttpError ("Edge Function returned a non-2xx status code") --
    // the actual { error: "..." } message our function returns (e.g. "You
    // do not have permission...", "already active staff") lives in the raw
    // Response on `error.context`, not in error.message. Surface the real
    // reason when we can parse it; fall back to the generic error otherwise.
    const context = (error as { context?: Response }).context;
    let parsedMessage: string | undefined;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.json()) as { error?: string };
        parsedMessage = body?.error;
      } catch {
        // Response body wasn't JSON (or was already consumed) -- fall through.
      }
    }
    throw new Error(parsedMessage ?? error.message);
  }
}
