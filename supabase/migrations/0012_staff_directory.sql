-- =============================================================================
-- 0012_staff_directory.sql
-- Purpose: let staff see WHO their colleagues are (email address), for the
-- Phase 05 "Staff" screen -- without ever exposing auth.users to the client.
--
-- Why this needs a new function instead of a normal SELECT: `restaurant_users`
-- only stores `user_id` (a uuid). The email address lives in `auth.users`,
-- which Supabase deliberately does NOT expose through the client API
-- (PostgREST) at all, for any role, for anyone -- there is no RLS policy
-- that could grant access to a schema that isn't exposed in the first place.
-- That's the platform's own safety net against enumerating every user's
-- email, and this project must not work around it.
--
-- The correct, idiomatic Supabase pattern is a SECURITY DEFINER SQL function
-- that runs INSIDE Postgres (so it CAN see auth.users, same schema) and is
-- called via `supabase.rpc(...)` instead of `.from(...)`. It must re-check
-- authorization itself, exactly like the SECURITY DEFINER helpers in 0011,
-- because bypassing RLS is the whole point of security definer -- nothing
-- else will stop a member of Restaurant A from asking for Restaurant B's
-- staff list unless the function checks that itself. See
-- scripts/verify_phase05_staff_directory.sql for the tenant-isolation proof.
-- =============================================================================

create or replace function public.get_restaurant_staff(p_restaurant_id uuid)
returns table (
  restaurant_user_id uuid,
  user_id             uuid,
  email               text,
  role                public.staff_role,
  is_active           boolean,
  invited_at          timestamptz,
  joined_at           timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ru.id,
    ru.user_id,
    u.email::text,
    ru.role,
    ru.is_active,
    ru.invited_at,
    ru.joined_at
  from public.restaurant_users ru
  join auth.users u on u.id = ru.user_id
  where ru.restaurant_id = p_restaurant_id
    -- The authorization check: caller must themselves be an active member of
    -- THIS restaurant. Same rule as the restaurant_users_select RLS policy
    -- (0011) -- deliberately reused, not loosened, just because this reads
    -- through a function instead of a table.
    and public.is_restaurant_member(p_restaurant_id)
  order by
    case ru.role
      when 'owner' then 0
      when 'manager' then 1
      when 'reservation_manager' then 2
      when 'host' then 3
      else 4
    end,
    ru.invited_at;
$$;

comment on function public.get_restaurant_staff(uuid) is
  'Staff roster with email addresses for one restaurant. SECURITY DEFINER because auth.users is not exposed to PostgREST at all -- re-checks is_restaurant_member() itself since RLS does not apply inside a security definer function.';

-- PostgREST only allows calling functions the "authenticated" (or "anon")
-- role has been granted EXECUTE on -- this is the RPC equivalent of an RLS
-- policy. Any signed-in staff member of ANY restaurant may call this (the
-- function's own is_restaurant_member() check is what actually scopes the
-- result to zero rows for a restaurant they don't belong to).
grant execute on function public.get_restaurant_staff(uuid) to authenticated;
