-- =============================================================================
-- 0021_optimization.sql
-- Phase 16 ("Βελτιστοποίηση" per the blueprint: performance, security, AI
-- cost) is -- like Phase 15 -- not a new feature. It is a cross-cutting
-- hardening pass over everything migrations 0001-0020 already shipped.
--
--   SECTION A (security): PostgreSQL grants EXECUTE on every newly-created
--   function to PUBLIC by default. Migrations 0011 onward (is_platform_admin
--   etc., see 0020's own header comment) established the discipline of an
--   explicit `revoke all ... from public` before the real `grant execute
--   ... to <role>` -- but that discipline started late. Every function
--   created before that habit stuck (migrations 0005-0018, roughly) still
--   has the PUBLIC EXECUTE default sitting on it, undetected until this
--   phase's audit (a `has_function_privilege('public', ...)` sweep over all
--   305 functions in the public schema). PUBLIC EXECUTE does not, by
--   itself, let an unauthenticated caller read data it shouldn't -- every
--   affected function is SECURITY DEFINER with its own internal
--   is_restaurant_member()/is_platform_admin() check, or SECURITY INVOKER
--   sitting behind RLS -- but it is real, avoidable attack surface (a stray
--   `anon` role or a future PUBLIC-inheriting role could call these
--   functions at all, when today only `authenticated` ever legitimately
--   does) and it is inconsistent with the project's own stated discipline.
--   Closing it here, function by function, cross-referenced against every
--   real caller in packages/core/src/api/*.ts, supabase/functions/*/
--   index.ts, and supabase/functions/ai-gateway/tools.ts (see README) so
--   that nothing legitimate breaks -- verified empirically afterwards by
--   re-running the FULL existing regression suite
--   (scripts/run_all_verifications.sh), not just this phase's own new
--   script, because privilege grants are exactly the kind of change that
--   can silently break something three phases away.
--
--   SECTION B (performance): PostgreSQL does NOT automatically index a
--   foreign-key column (unlike some other databases) -- a well-known, easy
--   to miss hygiene gap. An audit query (pg_constraint/pg_attribute/
--   pg_index) found 17 FK columns across this schema with no covering
--   index at all, meaning every JOIN or WHERE on that column (audit log
--   lookups by organization_id, payment lookups by customer_id, etc.) falls
--   back to a sequential scan as the table grows. All 17 are added here --
--   cheap, zero-risk, standard hygiene, not cherry-picked to a subset.
--
-- Run after migrations through 0020 + seed.sql.
-- =============================================================================

-- =============================================================================
-- SECTION A: security hardening -- revoke the PUBLIC EXECUTE default,
-- re-grant only to the role(s) that actually, legitimately call each
-- function. Grouped by the resulting grant, not alphabetically, so the
-- intent of each group is visible in one place.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A1. authenticated-only: these are called exclusively from
-- packages/core/src/api/*.ts (staff/owner mobile+admin app, always an
-- authenticated Supabase session) or from an Edge Function's
-- ctx.callerClient.rpc() (also always authenticated -- confirmed via grep,
-- Edge Functions that need anon-callable behavior use their own
-- service-role client + explicit checks instead, e.g.
-- create-deposit-payment-intent) -- AND, critically, confirmed via
-- pg_policies to never appear inside ANY RLS policy's USING/WITH CHECK
-- expression (see A1b below for why that distinction matters).
-- ---------------------------------------------------------------------------
revoke all on function public.get_restaurant_staff(uuid) from public;
revoke all on function public.book_reservation(uuid, timestamptz, timestamptz, integer, reservation_source, uuid, text, text, citext, text, text, uuid, integer, uuid[], uuid) from public;
revoke all on function public.get_available_tables(uuid, timestamptz, timestamptz, integer, uuid, uuid, boolean) from public;
revoke all on function public.get_available_table_combinations(uuid, timestamptz, timestamptz, integer, uuid) from public;
revoke all on function public.get_reservation_analytics(uuid, date, date) from public;

grant execute on function public.get_restaurant_staff(uuid) to authenticated;
grant execute on function public.book_reservation(uuid, timestamptz, timestamptz, integer, reservation_source, uuid, text, text, citext, text, text, uuid, integer, uuid[], uuid) to authenticated;
grant execute on function public.get_available_tables(uuid, timestamptz, timestamptz, integer, uuid, uuid, boolean) to authenticated;
grant execute on function public.get_available_table_combinations(uuid, timestamptz, timestamptz, integer, uuid) to authenticated;
grant execute on function public.get_reservation_analytics(uuid, date, date) to authenticated;

comment on function public.get_restaurant_staff is
  'Phase 05. Phase 16: explicit revoke-then-grant to authenticated only -- was still PUBLIC-executable (the never-revoked Postgres default) despite every real caller being an authenticated staff/owner session. Only ever called from packages/core/src/api/staff.ts.';
comment on function public.book_reservation is
  'Phase 07. Phase 16: same PUBLIC-EXECUTE cleanup -- only ever called from packages/core/src/api/reservations.ts (staff booking) and internally by book_public_reservation, which is SECURITY DEFINER and unaffected by this grant.';
comment on function public.get_available_tables is
  'Phase 07. Phase 16: same PUBLIC-EXECUTE cleanup.';
comment on function public.get_available_table_combinations is
  'Phase 07. Phase 16: same PUBLIC-EXECUTE cleanup.';
comment on function public.get_reservation_analytics is
  'Phase 10. Phase 16: same PUBLIC-EXECUTE cleanup -- only ever called via ctx.callerClient.rpc() in ai-gateway/tools.ts, which is always an authenticated staff session; the function''s own internal NOT_AUTHORIZED check is unchanged, this only removes the redundant PUBLIC grant sitting alongside it.';

-- ---------------------------------------------------------------------------
-- A1b. anon + authenticated -- a genuine finding from actually testing this
-- migration (re-running the full scripts/run_all_verifications.sh suite,
-- not just this phase's own new script), NOT assumed from the caller-grep
-- alone. is_restaurant_member/has_restaurant_role/is_org_owner/
-- owns_customer looked authenticated-only by their real .rpc()/callerClient
-- callers -- but all four are also referenced INSIDE permissive RLS policy
-- USING/WITH CHECK expressions on tables anon can query at all
-- (restaurants_select, opening_hours_select, special_hours_write,
-- deposit_policies_select, etc., OR'd alongside each table's own
-- *_public_select policy). PostgreSQL evaluates every applicable permissive
-- policy for the querying role, not just the one that would grant access --
-- so when anon runs, say, `select * from restaurants where slug = ...`,
-- Postgres must evaluate BOTH restaurants_public_select's USING clause AND
-- restaurants_select's (which calls is_restaurant_member/is_org_owner), and
-- evaluating a function anon has no EXECUTE on raises a hard "permission
-- denied for function" error for the WHOLE statement -- it does not
-- silently skip that one policy and fall through to the other. Revoking
-- these four from anon (first attempt at this migration) broke every
-- anon-facing query on these tables, confirmed by re-running
-- verify_phase08_public_booking.sql and seeing "permission denied for
-- function is_restaurant_member" in place of the expected successful
-- (often zero-row) result. The fix is this broader grant: SECURITY
-- DEFINER already makes these four safe to expose to anon (they resolve to
-- false rather than leaking anything when auth.uid() is null), and being
-- an RLS policy predicate is a categorically different thing from being a
-- direct .rpc() entry point.
-- ---------------------------------------------------------------------------
revoke all on function public.is_restaurant_member(uuid) from public;
revoke all on function public.has_restaurant_role(uuid, staff_role[]) from public;
revoke all on function public.is_org_owner(uuid) from public;
revoke all on function public.owns_customer(uuid) from public;

grant execute on function public.is_restaurant_member(uuid) to anon, authenticated;
grant execute on function public.has_restaurant_role(uuid, staff_role[]) to anon, authenticated;
grant execute on function public.is_org_owner(uuid) to anon, authenticated;
grant execute on function public.owns_customer(uuid) to anon, authenticated;

comment on function public.is_restaurant_member is
  'Phase 04. Phase 16: explicit revoke-then-grant -- to anon AND authenticated, not authenticated-only, because this function is referenced inside restaurants_select/opening_hours_select/tables_select/etc.''s RLS predicates, OR''d alongside each table''s own anon-facing *_public_select policy. Postgres evaluates every permissive policy for the querying role regardless of which one would actually grant access, so anon needs EXECUTE here even though it always resolves to false for an anonymous caller -- see A1b above for the real regression this caused on the first attempt at this migration.';
comment on function public.has_restaurant_role is
  'Phase 04. Phase 16: same reasoning as is_restaurant_member -- see A1b.';
comment on function public.is_org_owner is
  'Phase 05. Phase 16: same reasoning as is_restaurant_member -- see A1b (referenced in restaurants_select/restaurants_update).';
comment on function public.owns_customer is
  'Phase 06. Phase 16: same reasoning as is_restaurant_member -- see A1b (referenced in customers_select/customers_update).';

-- ---------------------------------------------------------------------------
-- A2. anon + authenticated, kept deliberately -- these already had an
-- explicit grant to both roles (migration 0014, guest/public booking flow)
-- and PUBLIC EXECUTE alongside it was simply redundant, never a gap by
-- itself. Adding the explicit revoke anyway, for the same reason 0020's own
-- header comment gives: consistency, and so a future audit of this schema
-- finds zero PUBLIC-executable functions, not "zero minus these two,
-- intentionally".
-- ---------------------------------------------------------------------------
revoke all on function public.book_public_reservation(text, timestamptz, integer, text, text, citext, text) from public;
revoke all on function public.is_restaurant_open_at(uuid, timestamptz) from public;
revoke all on function public.compute_deposit_amount(uuid, integer, boolean, uuid) from public;

grant execute on function public.book_public_reservation(text, timestamptz, integer, text, text, citext, text) to anon, authenticated;
grant execute on function public.is_restaurant_open_at(uuid, timestamptz) to anon, authenticated;
grant execute on function public.compute_deposit_amount(uuid, integer, boolean, uuid) to anon, authenticated;

comment on function public.book_public_reservation is
  'Phase 08, updated Phase 13 (see 0020). Phase 16: adds the explicit revoke-from-public housekeeping -- the anon+authenticated grant itself is unchanged and intentional (guest booking).';
comment on function public.is_restaurant_open_at is
  'Phase 08/13 (see 0020). Phase 16: same housekeeping -- anon+authenticated grant kept, no direct external caller found today, but this is a deliberate public "is this restaurant open now" primitive per migration 0014, not dead code to remove access from.';
comment on function public.compute_deposit_amount is
  'Phase 12. Phase 16: same housekeeping -- anon grant is an intentional Phase 12 decision (a guest sees the deposit amount before creating an account), unchanged here.';

-- ---------------------------------------------------------------------------
-- A3. no external grant at all -- purely internal: trigger functions
-- (invoked by Postgres itself, never via a client .rpc() call) and
-- SECURITY DEFINER helpers only ever called FROM another SECURITY DEFINER
-- function (queue_notification, schedule_reservation_reminders --
-- confirmed via grep: zero direct .rpc('queue_notification', ...) or
-- .rpc('schedule_reservation_reminders', ...) callers anywhere in
-- packages/ or supabase/functions/). A trigger function needs no EXECUTE
-- grant to any client role at all -- Postgres invokes it as the table
-- owner regardless of who performed the triggering statement.
-- ---------------------------------------------------------------------------
revoke all on function public.queue_notification(uuid, notification_recipient_type, uuid, uuid, notification_channel, text, jsonb, uuid, timestamptz) from public;
revoke all on function public.reservations_notify_on_change() from public;
revoke all on function public.reservations_propagate_to_tables() from public;
revoke all on function public.should_notify_staff(uuid, uuid, text) from public;
revoke all on function public.schedule_reservation_reminders(uuid) from public;
revoke all on function public.reservation_tables_sync_from_reservation() from public;
revoke all on function public.reservations_set_status_timestamps() from public;
revoke all on function public.set_updated_at() from public;
revoke all on function public.protect_restaurant_suspension_columns() from public;

comment on function public.queue_notification is
  'Phase 09. Phase 16: revoked PUBLIC EXECUTE, no replacement grant -- SECURITY DEFINER helper only ever called from other SECURITY DEFINER functions and triggers (confirmed via grep: no direct .rpc() caller anywhere), never directly by a client role.';
comment on function public.reservations_notify_on_change is
  'Phase 09 trigger function. Phase 16: revoked PUBLIC EXECUTE -- triggers run as the table owner, never need a client-role grant.';
comment on function public.reservations_propagate_to_tables is
  'Phase 07 trigger function. Phase 16: same as reservations_notify_on_change.';
comment on function public.should_notify_staff is
  'Phase 09. Phase 16: revoked PUBLIC EXECUTE, no replacement grant -- internal helper, no direct client caller.';
comment on function public.schedule_reservation_reminders is
  'Phase 09. Phase 16: revoked PUBLIC EXECUTE, no replacement grant -- called only from within book_reservation/other SECURITY DEFINER paths, never directly by a client role.';
comment on function public.reservation_tables_sync_from_reservation is
  'Phase 07 trigger function. Phase 16: same as reservations_notify_on_change.';
comment on function public.reservations_set_status_timestamps is
  'Phase 07 trigger function. Phase 16: same as reservations_notify_on_change.';
comment on function public.set_updated_at is
  'Phase 02 trigger function (used by nearly every table in this schema). Phase 16: same as reservations_notify_on_change -- the most-shared function in this migration, so its PUBLIC EXECUTE was the broadest single gap closed here.';
comment on function public.protect_restaurant_suspension_columns is
  'Phase 13 trigger function (see 0020). Phase 16: same as reservations_notify_on_change.';

-- =============================================================================
-- SECTION B: performance -- foreign-key columns with no covering index.
-- PostgreSQL never auto-creates these (unlike MySQL/InnoDB). Found via an
-- audit query joining pg_constraint/pg_attribute/pg_index for every FK's
-- leading column; all 17 gaps found are added, not a cherry-picked subset.
-- `if not exists` throughout so this migration stays safely re-runnable.
-- =============================================================================
create index if not exists idx_ai_actions_confirmed_by_user_id on public.ai_actions(confirmed_by_user_id);
create index if not exists idx_audit_logs_organization_id on public.audit_logs(organization_id);
create index if not exists idx_events_deposit_policy_id on public.events(deposit_policy_id);
create index if not exists idx_feature_flag_overrides_organization_id on public.feature_flag_overrides(organization_id);
create index if not exists idx_feature_flag_overrides_restaurant_id on public.feature_flag_overrides(restaurant_id);
create index if not exists idx_payments_customer_id on public.payments(customer_id);
create index if not exists idx_payments_deposit_policy_id on public.payments(deposit_policy_id);
create index if not exists idx_platform_admins_granted_by on public.platform_admins(granted_by);
create index if not exists idx_reservation_tables_restaurant_id on public.reservation_tables(restaurant_id);
create index if not exists idx_reservations_created_by_user_id on public.reservations(created_by_user_id);
create index if not exists idx_reservations_zone_preference_id on public.reservations(zone_preference_id);
create index if not exists idx_staff_notification_preferences_user_id on public.staff_notification_preferences(user_id);
create index if not exists idx_subscriptions_plan_id on public.subscriptions(plan_id);
create index if not exists idx_table_combinations_restaurant_id on public.table_combinations(restaurant_id);
create index if not exists idx_waitlist_entries_converted_reservation_id on public.waitlist_entries(converted_reservation_id);
create index if not exists idx_waitlist_entries_customer_id on public.waitlist_entries(customer_id);
create index if not exists idx_waitlist_entries_zone_preference_id on public.waitlist_entries(zone_preference_id);

comment on index public.idx_ai_actions_confirmed_by_user_id is 'Phase 16: FK-index hygiene sweep -- no index previously existed on this FK column.';
comment on index public.idx_audit_logs_organization_id is 'Phase 16: FK-index hygiene sweep. audit_logs is append-only and grows without bound, making this one of the highest-value additions in this migration.';
comment on index public.idx_events_deposit_policy_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_feature_flag_overrides_organization_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_feature_flag_overrides_restaurant_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_payments_customer_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_payments_deposit_policy_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_platform_admins_granted_by is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_reservation_tables_restaurant_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_reservations_created_by_user_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_reservations_zone_preference_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_staff_notification_preferences_user_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_subscriptions_plan_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_table_combinations_restaurant_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_waitlist_entries_converted_reservation_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_waitlist_entries_customer_id is 'Phase 16: FK-index hygiene sweep.';
comment on index public.idx_waitlist_entries_zone_preference_id is 'Phase 16: FK-index hygiene sweep.';
