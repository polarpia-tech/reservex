// deno-lint-ignore-file no-explicit-any
import { corsHeaders, handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts';

/**
 * bootstrap-restaurant
 * ====================
 * Creates a brand-new owner's very FIRST organization + restaurant +
 * `restaurant_users` "owner" row, atomically-ish, as the service role.
 *
 * Why this can't be three plain client-side inserts under RLS: a signed-up
 * user CAN insert their own `organizations` row (they set themselves as
 * owner_user_id) and their own `restaurants` row (is_org_owner() passes).
 * But the `restaurant_users_write` policy requires the caller to ALREADY be
 * owner/manager of that restaurant to insert a row into it -- which is
 * exactly the row that would make them owner in the first place. A brand
 * new restaurant has no rows in `restaurant_users` yet, so that check can
 * never pass for anyone, including the person who just created it. This is
 * proven empirically in scripts/verify_phase04_bootstrap.sql (Test C fails
 * under RLS; Test D, the same insert as service role, succeeds).
 *
 * Scope note: this function ALWAYS creates a brand-new organization. It is
 * the "create my first restaurant" onboarding path only. Adding a second
 * LOCATION to an organization a user already owns is a different, related,
 * and NOT YET BUILT flow (planned for Phase 05 multi-location support) --
 * it would reuse the existing organization_id instead of creating a new one.
 * Do not call this function for that case once it exists.
 */

const RESTAURANT_TYPES = ['restaurant', 'cafe', 'bar', 'club', 'beach_venue', 'hotel_venue', 'event_venue'];

interface BootstrapRequestBody {
  restaurantName?: string;
  restaurantType?: string;
  timezone?: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents so Greek/German/Turkish names still produce a readable ascii slug
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'restaurant';
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    // 1. Authentication
    const user = await getAuthenticatedUser(req);

    // 2. Validation
    const body = (await req.json().catch(() => ({}))) as BootstrapRequestBody;
    const restaurantName = body.restaurantName?.trim();
    const restaurantType = body.restaurantType;
    const timezone = body.timezone?.trim();

    if (!restaurantName || restaurantName.length < 2) {
      return jsonError('Restaurant name is required (at least 2 characters).', 400);
    }
    if (!restaurantType || !RESTAURANT_TYPES.includes(restaurantType)) {
      return jsonError('Invalid restaurant type.', 400);
    }
    if (!timezone) {
      return jsonError('Timezone is required.', 400);
    }

    // 3. Authorization: none beyond "is signed in" -- everyone is allowed to
    // bootstrap their own first restaurant. Every row created below belongs
    // to this same user.uid, so there is nothing else to check.
    const admin = createAdminClient();

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .insert({ name: restaurantName, owner_user_id: user.id })
      .select('id')
      .single();
    if (orgError || !org) {
      console.error('bootstrap-restaurant: organization insert failed', orgError);
      return jsonError('Could not create organization.', 500);
    }

    // 4. Business rules: restaurants.slug is globally unique (DB check
    // constraint). Retry with a short random suffix on collision instead of
    // failing the whole signup over a name clash with another tenant.
    const slugBase = slugify(restaurantName);
    let slug = slugBase;
    let attempt = 0;
    let slugIsUnique = false;
    while (!slugIsUnique) {
      const { data: existing } = await admin.from('restaurants').select('id').eq('slug', slug).maybeSingle();
      if (!existing) {
        slugIsUnique = true;
        break;
      }
      attempt += 1;
      if (attempt > 5) {
        await admin.from('organizations').delete().eq('id', org.id);
        return jsonError('Could not generate a unique restaurant identifier. Please try a different name.', 500);
      }
      slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
    }

    // 5. DB operation
    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .insert({
        organization_id: org.id,
        name: restaurantName,
        slug,
        restaurant_type: restaurantType,
        timezone,
      })
      .select('*')
      .single();

    if (restaurantError || !restaurant) {
      console.error('bootstrap-restaurant: restaurant insert failed', restaurantError);
      await admin.from('organizations').delete().eq('id', org.id);
      return jsonError('Could not create restaurant.', 500);
    }

    const { error: membershipError } = await admin.from('restaurant_users').insert({
      restaurant_id: restaurant.id,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    if (membershipError) {
      // Roll back so we never leave an orphaned restaurant nobody can see
      // or manage (RLS would hide it from everyone, including its creator).
      console.error('bootstrap-restaurant: owner membership insert failed', membershipError);
      await admin.from('restaurants').delete().eq('id', restaurant.id);
      await admin.from('organizations').delete().eq('id', org.id);
      return jsonError('Could not create owner membership.', 500);
    }

    // Phase 12 addition: start the organization's 14-day free trial, no
    // card required (blueprint, Part 11 pricing page). Deliberately no
    // Stripe call here at all -- see create-subscription-checkout's header
    // comment for why that only happens later, when the org actually
    // chooses to pay. Best-effort: a failure here should never block
    // someone from getting into the app they just signed up for, so it is
    // logged, not thrown -- an org with no subscription row is a follow-up
    // fix, a rolled-back signup is a much worse outcome.
    const { data: starterPlan } = await admin.from('subscription_plans').select('id').eq('code', 'starter').maybeSingle();
    if (starterPlan) {
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const { error: subscriptionError } = await admin.from('subscriptions').insert({
        organization_id: org.id,
        plan_id: starterPlan.id,
        status: 'trialing',
        trial_ends_at: trialEndsAt,
        current_period_start: new Date().toISOString(),
        current_period_end: trialEndsAt,
      });
      if (subscriptionError) {
        console.error('bootstrap-restaurant: trial subscription insert failed (non-fatal)', subscriptionError);
      }
    } else {
      console.error('bootstrap-restaurant: no "starter" subscription_plans row found -- skipping trial subscription creation.');
    }

    await admin.from('audit_logs').insert({
      organization_id: org.id,
      restaurant_id: restaurant.id,
      actor_type: 'user',
      actor_user_id: user.id,
      action: 'restaurant.bootstrapped',
      entity_type: 'restaurant',
      entity_id: restaurant.id,
      after_data: { name: restaurantName, restaurant_type: restaurantType, timezone },
    });

    return jsonResponse({ restaurant }, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    console.error('bootstrap-restaurant: unexpected error', err);
    return jsonError('Unexpected server error.', 500);
  }
});

// Keep a reference to corsHeaders so bundlers/linters don't flag the shared
// import as unused if a future edit removes jsonResponse/jsonError usage.
void corsHeaders;
