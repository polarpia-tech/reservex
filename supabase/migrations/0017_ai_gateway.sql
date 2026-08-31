-- =============================================================================
-- 0017_ai_gateway.sql
-- Phase 10: AI Gateway.
--
-- Almost nothing new is needed in the database for this phase, and that is
-- the point: the AI Gateway is designed to be a thin, fully-audited caller
-- of functionality that Phases 04-09 already built and already verified
-- (book_reservation, get_available_tables/combinations, updateReservation
-- status, updateRestaurant, queue_notification's triggers, etc). The tool
-- layer lives in supabase/functions/ai-gateway (Deno, service role) and
-- packages/ai (shared tool schemas + provider abstraction), not in SQL.
--
-- The one genuinely new piece of business logic is get_reservation_analytics
-- below, backing the getAnalytics() tool -- there was no existing reporting
-- query anywhere in the schema to reuse.
--
-- A design decision worth recording here, because it looked like a bug during
-- investigation and turned out not to be one: 0011's `ai_conversations_insert`
-- policy (`with check (user_id = auth.uid())`) can never be satisfied for a
-- customer_chat/voice/whatsapp conversation, because those rows have
-- user_id = null by the table's own `ai_conversations_one_party` constraint.
-- This is NOT being patched here. `ai_messages` has no client insert policy
-- at all (for ANY channel), and `ai_actions` has no client insert policy at
-- all either -- so even a staff_chat conversation can never be written
-- end-to-end by a direct client call; the message and action rows are always
-- missing. The only coherent way to run this feature was already forced by
-- the schema: every ai_conversations/ai_messages/ai_actions row is written
-- by the ai-gateway Edge Function's service-role client, which re-implements
-- its own authorization check per call (same pattern as bootstrap-restaurant
-- and invite-staff-member). The existing `ai_conversations_insert` policy is
-- left in place, unused by this architecture, rather than removed -- it is
-- harmless and costs nothing to keep for a possible future direct-client
-- staff_chat path.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_reservation_analytics: backs the getAnalytics() AI tool (and is a
-- perfectly normal, directly callable RPC for any future non-AI reporting
-- screen too). SECURITY INVOKER on purpose -- unlike book_public_reservation
-- or the Edge Functions, there is no chicken-and-egg RLS problem here: the
-- caller must already be able to read this restaurant's reservations, and
-- the query only ever aggregates rows the caller's own RLS already lets them
-- see. is_restaurant_member() is checked explicitly first anyway, so a
-- non-member gets a clear NOT_AUTHORIZED error instead of a silent all-zero
-- result that could be misread as "this restaurant had zero reservations".
-- ---------------------------------------------------------------------------
create or replace function public.get_reservation_analytics(
  p_restaurant_id uuid,
  p_date_from     date,
  p_date_to       date
)
returns table (
  total_reservations  bigint,
  confirmed_count     bigint,
  cancelled_count     bigint,
  no_show_count       bigint,
  completed_count     bigint,
  no_show_rate        numeric,
  avg_party_size      numeric,
  total_covers        bigint
)
language plpgsql
security invoker
set search_path = public
stable
as $$
begin
  if p_date_to < p_date_from then
    raise exception 'INVALID_DATE_RANGE';
  end if;
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
  select
    count(*)::bigint as total_reservations,
    count(*) filter (where r.status = 'confirmed')::bigint as confirmed_count,
    count(*) filter (where r.status = 'cancelled')::bigint as cancelled_count,
    count(*) filter (where r.status = 'no_show')::bigint as no_show_count,
    count(*) filter (where r.status = 'completed')::bigint as completed_count,
    case when count(*) filter (where r.status in ('completed', 'no_show')) = 0 then 0
      else round(
        100.0 * count(*) filter (where r.status = 'no_show')
        / count(*) filter (where r.status in ('completed', 'no_show')), 1
      )
    end as no_show_rate,
    coalesce(round(avg(r.party_size), 1), 0) as avg_party_size,
    coalesce(sum(r.party_size) filter (where r.status in ('completed', 'confirmed')), 0)::bigint as total_covers
  from public.reservations r
  where r.restaurant_id = p_restaurant_id
    and r.starts_at >= p_date_from::timestamptz
    and r.starts_at < (p_date_to + 1)::timestamptz;
end;
$$;

grant execute on function public.get_reservation_analytics(uuid, date, date) to authenticated;

comment on function public.get_reservation_analytics is
  'Read-only reservation aggregates for a date range. Backs the AI Gateway''s getAnalytics() tool. SECURITY INVOKER: relies on the caller''s own RLS visibility into reservations, with an explicit is_restaurant_member() check first so a non-member gets NOT_AUTHORIZED rather than a misleading all-zero result.';
