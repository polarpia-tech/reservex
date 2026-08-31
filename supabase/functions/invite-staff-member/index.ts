// deno-lint-ignore-file no-explicit-any
import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts';

/**
 * invite-staff-member
 * ====================
 * Invites an existing OR brand-new person as staff at a restaurant the
 * caller already owns/manages.
 *
 * Important scope note (read before wiring this up to a screen): as of
 * Phase 04, NO UI calls this function yet -- there is no "Staff" management
 * screen in the app (that is Phase 05/06 work). This function exists now as
 * a verified backend building block, not as a finished end-to-end feature.
 * Do not describe staff invitations as "working" in the product until a
 * real screen invokes this and the result has been tested against a live
 * Supabase project.
 *
 * Why this needs the service role at all, when
 * scripts/verify_phase04_bootstrap.sql (Test F) proved an existing
 * owner/manager CAN insert a `restaurant_users` row directly under RLS:
 * that test invited someone who ALREADY has an `auth.users` account. Most
 * real invitations are for someone who has never signed up. Creating that
 * person's auth account (or looking it up if `auth.admin.inviteUserByEmail`
 * reports it already exists) requires Supabase's admin API, which is only
 * available with the service role. The `restaurant_users` insert itself
 * piggybacks on the same admin client for simplicity, but does NOT
 * structurally need to -- it re-implements, in this function, the exact
 * authorization check RLS already enforces (owner/manager of this
 * restaurant), because a service-role client bypasses RLS entirely and
 * therefore MUST re-check authorization itself.
 */

const INVITABLE_ROLES = ['manager', 'reservation_manager', 'host', 'staff'];
// Deliberately excludes 'owner': transferring/adding ownership is a more
// sensitive action that deserves its own explicit, separately-confirmed
// flow later, not a side effect of an everyday staff invite.

interface InviteRequestBody {
  restaurantId?: string;
  email?: string;
  role?: string;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    // 1. Authentication
    const caller = await getAuthenticatedUser(req);

    // 2. Validation
    const body = (await req.json().catch(() => ({}))) as InviteRequestBody;
    const restaurantId = body.restaurantId?.trim();
    const email = body.email?.trim().toLowerCase();
    const role = body.role;

    if (!restaurantId) return jsonError('restaurantId is required.', 400);
    if (!email || !email.includes('@')) return jsonError('A valid email is required.', 400);
    if (!role || !INVITABLE_ROLES.includes(role)) return jsonError('Invalid role.', 400);

    const admin = createAdminClient();

    // 3. Authorization: caller must be an ACTIVE owner/manager of THIS
    // restaurant. Must be checked explicitly here -- the service role
    // client below bypasses RLS, so nothing else enforces this.
    const { data: callerMembership } = await admin
      .from('restaurant_users')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', caller.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!callerMembership || !['owner', 'manager'].includes(callerMembership.role)) {
      return jsonError('You do not have permission to invite staff to this restaurant.', 403);
    }

    const { data: restaurant } = await admin.from('restaurants').select('id').eq('id', restaurantId).maybeSingle();
    if (!restaurant) return jsonError('Restaurant not found.', 404);

    // 4. Business rules + the one step that genuinely requires the admin
    // API: find-or-create the invitee's auth account.
    let invitedUserId: string;
    const { data: inviteResult, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);

    if (inviteError) {
      const alreadyRegistered = inviteError.message.toLowerCase().includes('already');
      if (!alreadyRegistered) {
        console.error('invite-staff-member: inviteUserByEmail failed', inviteError);
        return jsonError('Could not send invitation email.', 500);
      }
      // Expected, common case: this person already has an account (maybe
      // staff at another restaurant). Look them up instead of failing.
      const { data: existingUsers, error: lookupError } = await admin.auth.admin.listUsers();
      const existing = existingUsers?.users.find((candidate: any) => candidate.email?.toLowerCase() === email);
      if (lookupError || !existing) return jsonError('Could not find or invite that user.', 500);
      invitedUserId = existing.id;
    } else if (inviteResult?.user) {
      invitedUserId = inviteResult.user.id;
    } else {
      return jsonError('Could not send invitation email.', 500);
    }

    const { data: existingMembership } = await admin
      .from('restaurant_users')
      .select('id, is_active')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', invitedUserId)
      .maybeSingle();

    if (existingMembership?.is_active) {
      return jsonError('This person is already active staff at this restaurant.', 409);
    }

    // 5. DB operation
    if (existingMembership) {
      const { error: updateError } = await admin
        .from('restaurant_users')
        .update({ role, is_active: true, invited_at: new Date().toISOString() })
        .eq('id', existingMembership.id);
      if (updateError) {
        console.error('invite-staff-member: membership update failed', updateError);
        return jsonError('Could not update staff membership.', 500);
      }
    } else {
      const { error: insertError } = await admin.from('restaurant_users').insert({
        restaurant_id: restaurantId,
        user_id: invitedUserId,
        role,
      });
      if (insertError) {
        console.error('invite-staff-member: membership insert failed', insertError);
        return jsonError('Could not create staff membership.', 500);
      }
    }

    await admin.from('audit_logs').insert({
      restaurant_id: restaurantId,
      actor_type: 'user',
      actor_user_id: caller.id,
      action: 'restaurant_user.invited',
      entity_type: 'restaurant_user',
      entity_id: invitedUserId,
      after_data: { email, role },
    });

    return jsonResponse({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    console.error('invite-staff-member: unexpected error', err);
    return jsonError('Unexpected server error.', 500);
  }
});
