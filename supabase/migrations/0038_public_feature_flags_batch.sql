-- =============================================================================
-- 0038_public_feature_flags_batch.sql
-- Purpose: fix a real, reproducible production bug found this window on the
-- restaurant public page (app/[locale]/r/[slug]/page.tsx). That page
-- resolves 4 feature flags via is_feature_enabled_for_restaurant (0024),
-- one HTTP round trip per flag, alongside 2 more round trips for opening
-- hours and special hours -- 6 outbound Supabase requests in one server
-- render.
--
-- Confirmed live (not assumed): whichever flag check is the 6th cumulative
-- request in that one render comes back with the WRONG answer (false when
-- every underlying row -- restaurant, flag, override -- was hand-verified
-- correct in the SQL editor). Proven by deliberately reordering the 4 flag
-- checks twice:
--   * Original order: popularity_indicator was 6th -> came back false.
--     live_availability/waitlist_public/last_minute_alerts (2nd-5th) -> true.
--   * popularity_indicator moved to be called FIRST among the 4 (3rd
--     overall) -> came back true. last_minute_alerts, now pushed to 6th
--     overall, came back false instead.
-- This isolates the bug to something in the request/connection layer
-- between the Next.js server and Supabase's REST API that misbehaves on the
-- 6th+ request of one invocation (most likely a connection-pool/keep-alive
-- limit in Vercel's Node runtime or an intermediate proxy) -- not this
-- schema, not RLS, not any one flag's data. See PRs #8-#11 on
-- polarpia-tech/reservex for the full diagnostic trail.
--
-- Rather than chase that infra-layer bug further (out of reach from this
-- schema), the fix is architectural: resolve ALL of a restaurant's flags in
-- ONE HTTP round trip instead of one per flag. This both sidesteps the bug
-- (cuts the page's own Supabase request count from 6 to 3, comfortably
-- clear of wherever the real limit sits) and is a straightforward
-- performance win regardless.
--
-- Deliberately implemented as a thin loop over the EXISTING
-- is_feature_enabled_for_restaurant (0024) rather than re-implementing its
-- restaurant/flag/override resolution logic here a second time -- one
-- resolution algorithm, defined once, called either singly or in bulk. This
-- function does not replace 0024's; that one stays in place for any caller
-- that only ever needs a single flag.
-- =============================================================================

create or replace function public.get_public_feature_flags_for_restaurant(p_restaurant_slug text, p_flag_keys text[])
returns jsonb
security definer
set search_path = public
language plpgsql
stable
as $$
declare
  v_key    text;
  v_result jsonb := '{}'::jsonb;
begin
  if p_restaurant_slug is null or p_flag_keys is null then
    return v_result;
  end if;

  foreach v_key in array p_flag_keys loop
    v_result := v_result || jsonb_build_object(v_key, public.is_feature_enabled_for_restaurant(p_restaurant_slug, v_key));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.get_public_feature_flags_for_restaurant(text, text[]) from public;

grant execute on function public.get_public_feature_flags_for_restaurant(text, text[]) to anon, authenticated;

comment on function public.get_public_feature_flags_for_restaurant is
  'Public/anon-callable. Resolves MULTIPLE feature flags for one restaurant in a single round trip -- calls is_feature_enabled_for_restaurant (0024) once per key internally and returns a jsonb object {flag_key: boolean, ...}. Added specifically to fix a confirmed production bug where the 6th+ sequential/concurrent Supabase request within one server render returned a wrong answer for whichever flag landed in that position; batching keeps a page''s total flag-check request count at 1 regardless of how many flags it needs. Unknown restaurant slug or flag keys resolve to false for that key (via 0024''s own never-raises guarantee), never an error.';
