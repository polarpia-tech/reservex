-- Migration 0031: fix claim_waitlist_matches_for_restaurant's EXECUTE grant
-- =============================================================================
-- Phase 6, Part 2b follow-up. Migration 0030 added an internal,
-- service-role-only function (claim_waitlist_matches_for_restaurant) and
-- tried to lock it down with this project's usual `revoke all on function
-- ... from public;` pattern (established in 0021's "security hardening"
-- section). A production verification run right after 0030 shipped --
-- has_function_privilege() checked directly against the live database, not
-- just locally -- showed this did NOT work: both anon and authenticated
-- could still execute the function.
--
-- Root cause, confirmed via `select * from pg_default_acl where
-- defaclnamespace = 'public'::regnamespace`: this Supabase project has
-- ALTER DEFAULT PRIVILEGES configured at the platform level (for both the
-- `postgres` and `supabase_admin` roles) granting EXECUTE ON FUNCTIONS
-- directly to anon, authenticated, and service_role. That means every new
-- function created by a migration (which runs as `postgres`) is granted
-- EXECUTE straight to anon/authenticated the instant it's created -- NOT
-- via the PUBLIC pseudo-role. `revoke ... from public` only ever removes
-- the PUBLIC pseudo-role's own grant (which, on this project, was never
-- even the mechanism in play); it does nothing to a grant already made
-- directly to a named role. To actually lock a function down here, the
-- direct grant to anon/authenticated has to be revoked explicitly, by name.
--
-- IMPORTANT, for future migrations: this was caught by a real
-- has_function_privilege() check run against production, not assumed to
-- work because the SQL matched 0021's own established pattern. Local
-- testing (scripts/local_dev_shim.sql) does not set up this same
-- default-privileges rule, so this specific class of bug is invisible
-- locally and can only be confirmed against the real hosted database.
-- This also means every other "revoke ... from public, no replacement
-- grant" function from migration 0021 (queue_notification,
-- reservations_notify_on_change, should_notify_staff,
-- schedule_reservation_reminders, and siblings) needs the exact same
-- production has_function_privilege() check before anyone can trust it's
-- actually locked down. Not fixed here -- tracked separately as a
-- dedicated follow-up audit, to keep this migration scoped to unblocking
-- Part 2b's own new function.
--
-- postgres and service_role keep EXECUTE untouched: service_role is
-- exactly what the notify-waitlist Edge Function's admin client
-- (createAdminClient, using SUPABASE_SERVICE_ROLE_KEY) uses to call this
-- function.
-- =============================================================================

revoke all on function public.claim_waitlist_matches_for_restaurant(uuid) from public, anon, authenticated;

comment on function public.claim_waitlist_matches_for_restaurant is
  'Internal only, service-role-only. Migration 0030''s revoke-from-public alone was NOT sufficient on this project (see migration 0031''s header comment) -- this project''s default privileges grant EXECUTE directly to anon/authenticated on every new function, independent of PUBLIC. Migration 0031 explicitly revokes EXECUTE from anon and authenticated by name, verified against production via has_function_privilege(). Called by the notify-waitlist Edge Function (via its service_role admin client) whenever a restaurant''s availability heartbeat (restaurant_availability_versions, 0025) changes. Atomically finds every ''waiting'', push-subscribed, not-yet-claimed entry whose exact desired slot is NOW available, and marks it ''notified'' in the same statement (FOR UPDATE SKIP LOCKED) so two near-simultaneous triggers can never double-claim (and therefore double-push) the same entry. Returns exactly what the Edge Function needs to actually send the push -- nothing else.';
