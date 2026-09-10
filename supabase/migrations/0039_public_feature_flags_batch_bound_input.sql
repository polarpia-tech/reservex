-- =============================================================================
-- 0039_public_feature_flags_batch_bound_input.sql
-- Purpose: security-hardening follow-up to 0038, flagged by automated PR
-- review on PR #12 (chatgpt-codex-connector) before this ever reached
-- production -- and correct: get_public_feature_flags_for_restaurant is
-- anon-callable and security definer, and 0038's version looped over
-- `p_flag_keys` with no size or dedup check at all. A hostile caller could
-- pass an array of thousands of (possibly duplicate) keys and force that
-- many internal is_feature_enabled_for_restaurant resolutions per HTTP
-- request -- unbounded SECURITY DEFINER work from a single anonymous call,
-- which is exactly the kind of amplification this schema's existing public
-- RPCs (book_public_reservation 0014, get_public_availability_summary 0023,
-- is_feature_enabled_for_restaurant itself 0024) are deliberately narrow to
-- avoid.
--
-- Today's only real caller (the restaurant public page) only ever asks for
-- 4 fixed keys, so there is no legitimate use case this narrows away.
--
-- Fix: dedupe the input and cap it at 20 keys (5x today's real usage, room
-- to grow without ever inviting an unbounded-array attack) before looping.
-- Extra keys past the cap are silently dropped rather than erroring --
-- matching 0024's own "never raises" contract, since an unrecognized key
-- resolves to false anyway and this is a purely defensive cap, not a
-- feature limit callers are expected to hit.
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
  v_keys   text[];
  v_result jsonb := '{}'::jsonb;
begin
  if p_restaurant_slug is null or p_flag_keys is null then
    return v_result;
  end if;

  -- Dedupe first (so repeated keys never cost more than one resolution
  -- each), then cap at 20 distinct keys -- bounds this function's internal
  -- work to at most 20 calls to is_feature_enabled_for_restaurant no
  -- matter how large or repetitive the caller's input array is.
  select array_agg(k) into v_keys
  from (
    select distinct k
    from unnest(p_flag_keys) as k
    limit 20
  ) deduped(k);

  if v_keys is null then
    return v_result;
  end if;

  foreach v_key in array v_keys loop
    v_result := v_result || jsonb_build_object(v_key, public.is_feature_enabled_for_restaurant(p_restaurant_slug, v_key));
  end loop;

  return v_result;
end;
$$;

-- Grants are unaffected by create-or-replace of an existing function
-- (Postgres keeps prior grants on the same signature), but restating them
-- explicitly here keeps this migration self-contained and independently
-- auditable, matching 0037/0038's own convention.
revoke all on function public.get_public_feature_flags_for_restaurant(text, text[]) from public;

grant execute on function public.get_public_feature_flags_for_restaurant(text, text[]) to anon, authenticated;

comment on function public.get_public_feature_flags_for_restaurant is
  'Public/anon-callable. Resolves MULTIPLE feature flags for one restaurant in a single round trip -- calls is_feature_enabled_for_restaurant (0024) once per key internally and returns a jsonb object {flag_key: boolean, ...}. Input keys are deduplicated and capped at 20 (0039) so an anonymous caller cannot force unbounded SECURITY DEFINER work with a large/repetitive p_flag_keys array. Added to fix a confirmed production bug where the 6th+ sequential/concurrent Supabase request within one server render returned a wrong answer for whichever flag landed in that position; batching keeps a page''s total flag-check request count at 1 regardless of how many flags it needs. Unknown restaurant slug or flag keys resolve to false for that key (via 0024''s own never-raises guarantee), never an error.';
