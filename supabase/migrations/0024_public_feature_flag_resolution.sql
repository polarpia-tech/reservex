-- =============================================================================
-- 0024_public_feature_flag_resolution.sql
-- Purpose: Phase 2 of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- the one missing piece needed before the public
-- web app can safely show ANY of the new opt-in capabilities: a way for an
-- ANONYMOUS visitor's browser to ask "is <flag> turned on for THIS
-- restaurant?".
--
-- Why this is needed at all: feature_flags_select (0011) only allows
-- `auth.uid() is not null` -- i.e. only a SIGNED-IN user may read the
-- feature_flags/feature_flag_overrides tables directly. A customer browsing
-- a restaurant's public page is very often NOT signed in, so without this
-- function the web app would have no way to find out whether
-- 'live_availability' (or any future flag) is enabled for that restaurant,
-- and Phase 1's get_public_availability_summary() RPC (0023) could never
-- actually be shown to a real visitor.
--
-- Why a narrow boolean RPC instead of just widening feature_flags_select to
-- `anon`: that would hand any anonymous caller the full flag catalogue
-- (every key/description on the platform, including ones still in private
-- beta for a handful of restaurants) AND every override row for every
-- organization/restaurant, which is more than a customer's browser needs
-- and more than we want casually crawlable. This function answers exactly
-- one question -- is this one flag on for this one restaurant -- and
-- nothing else, same "narrowest safe surface" reasoning as
-- book_public_reservation (0014) and get_public_availability_summary (0023).
--
-- Resolution order (first match wins), matching 0023's restaurant-owner-
-- write policy: a restaurant-scoped override beats an organization-scoped
-- override beats the flag's platform-wide default. This is the first place
-- in the codebase that actually RESOLVES an effective flag value (the admin
-- UI so far only lists raw rows) -- documented here since nothing else
-- defines this precedence yet. rollout_percentage is deliberately NOT
-- factored in: it is not enforced anywhere else in the app today (the admin
-- screen only displays it), so implementing percentage-bucketing logic for
-- the first time inside this one function would be inventing a rule the
-- rest of the platform doesn't follow -- left for a dedicated pass if/when
-- percentage rollouts are actually wired up everywhere.
-- =============================================================================

create or replace function public.is_feature_enabled_for_restaurant(p_restaurant_slug text, p_flag_key text)
returns boolean
security definer
set search_path = public
language plpgsql
stable
as $$
declare
  v_restaurant_id      uuid;
  v_organization_id    uuid;
  v_flag_id            uuid;
  v_default_enabled    boolean;
  v_override_enabled   boolean;
begin
  if p_restaurant_slug is null or p_flag_key is null then
    return false;
  end if;

  select id, organization_id into v_restaurant_id, v_organization_id
  from public.restaurants
  where slug = p_restaurant_slug and deleted_at is null and is_active;
  if not found then
    return false;
  end if;

  select id, is_enabled_default into v_flag_id, v_default_enabled
  from public.feature_flags
  where key = p_flag_key;
  if not found then
    return false;
  end if;

  select is_enabled into v_override_enabled
  from public.feature_flag_overrides
  where flag_id = v_flag_id and restaurant_id = v_restaurant_id;
  if found then
    return v_override_enabled;
  end if;

  select is_enabled into v_override_enabled
  from public.feature_flag_overrides
  where flag_id = v_flag_id and organization_id = v_organization_id;
  if found then
    return v_override_enabled;
  end if;

  return v_default_enabled;
end;
$$;

grant execute on function public.is_feature_enabled_for_restaurant(text, text) to anon, authenticated;

comment on function public.is_feature_enabled_for_restaurant is
  'Public/anon-callable. Resolves whether one feature flag is effectively ON for one restaurant: restaurant-scoped override > organization-scoped override > the flag''s platform-wide default. Returns false (never raises) for an unknown restaurant slug or flag key, so a UI gating check can never break a page. Does not expose flag catalogue contents or any override row -- just this one boolean.';
