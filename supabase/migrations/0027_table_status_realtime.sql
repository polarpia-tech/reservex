-- =============================================================================
-- 0027_table_status_realtime.sql
-- Purpose: Phase 5 of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- the mobile app's new visual table map (see
-- apps/mobile/src/components/tables/TableMapView.tsx) and reservation
-- timeline (apps/mobile/src/components/reservations/ReservationTimeline.tsx)
-- both need to live-update the instant *any* staff member changes a
-- table's status, not just when a reservation is booked/rescheduled/
-- cancelled.
--
-- Gap this closes: 0025's heartbeat trigger (trg_reservation_tables_bump_
-- availability) fires only on INSERT/UPDATE/DELETE of `reservation_tables`
-- -- it was never meant to, and does not, cover a direct UPDATE of
-- `tables.status` (e.g. a host tapping "Cleaning" or "Occupied" on the
-- floor view, via updateTable() in packages/core/src/api/tables.ts). That
-- is, in practice, one of the single most frequent writes in the whole
-- app during service -- every walk-in seated, every table bussed -- and
-- today it produces no realtime signal at all. A floor map subscribed
-- only to the existing heartbeat would correctly live-update when a
-- reservation changes, but would NOT live-update when a colleague at
-- another terminal marks a table occupied/cleaning/blocked, which is
-- exactly the scenario a "visual table map" exists to solve.
--
-- Fix: reuse 0025's existing bump_restaurant_availability_version()
-- function and restaurant_availability_versions heartbeat table verbatim
-- -- no new table, no new Realtime publication entry, no new RLS policy.
-- Same "narrowest safe surface" + "add only what's genuinely needed"
-- reasoning as every prior migration in this upgrade (see 0025's header).
-- The only new object is the trigger below.
--
-- Scoped narrowly on purpose:
--   - `after update OF status` -- never fires for a label/capacity/zone/
--     shape/VIP edit, which the floor map and timeline don't care about
--     and which would just be a wasted heartbeat bump (section 38,
--     "PERFORMANCE": avoid unnecessary work, not just avoid polling).
--   - `when (old.status is distinct from new.status)` -- belt-and-braces
--     alongside `update of status`: guards against a driver/tool that
--     issues `update tables set status = status, other_col = ...` (still
--     technically an "update of status" in Postgres's trigger-column
--     sense even though the value didn't change), so a genuine no-op
--     write never bumps the heartbeat either.
--   - AFTER, not BEFORE -- identical reasoning to 0025: this must never be
--     able to block or fail the status change it's reacting to.
-- =============================================================================

create trigger trg_tables_bump_availability
  after update of status on public.tables
  for each row
  when (old.status is distinct from new.status)
  execute function public.bump_restaurant_availability_version();

comment on trigger trg_tables_bump_availability on public.tables is
  'Phase 5 of the Live Availability upgrade. Bumps the same restaurant_availability_versions heartbeat (0025) whenever a table''s status actually changes, so the mobile floor map and reservation timeline live-update on direct status edits, not just on reservation/reservation_tables changes.';
