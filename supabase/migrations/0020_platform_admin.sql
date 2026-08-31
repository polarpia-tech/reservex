-- =============================================================================
-- 0020_platform_admin.sql
-- Phase 13: Admin πλατφόρμας -- ReservX's OWN internal team, not a
-- restaurant's staff and not a customer. Everything in this migration is a
-- brand-new concept: no earlier phase's schema anticipated a "platform
-- admin" (unlike Phase 09/10/12, which activated tables Phase 02 had
-- already reserved for them -- there is no platform_admins table waiting
-- from Phase 02, and feature_flags/feature_flag_overrides, which WAS
-- reserved back in 0010, has sat with SELECT-only RLS and zero writers
-- until now).
--
-- Three things happen here:
--   1. platform_admins + is_platform_admin()/is_platform_super_admin() --
--      the identity/authorization primitive everything else in this
--      migration is built on, same SECURITY DEFINER pattern as
--      is_restaurant_member()/is_org_owner() (0011).
--   2. Cross-tenant, privileged operations as SECURITY DEFINER SQL
--      functions, NOT Edge Functions -- following 0014's own precedent
--      (book_public_reservation's header comment): an Edge Function earns
--      its place when something needs an EXTERNAL network call (Stripe,
--      Twilio, Anthropic) or genuinely novel auth handling
--      (tryGetAuthenticatedUser). Suspending a restaurant, overriding a
--      subscription, and granting/revoking platform-admin access are none
--      of those -- pure, privileged Postgres writes, so they get pure,
--      privileged Postgres functions: one implementation, fully auditable,
--      no separate Deno service to deploy for something this schema can
--      already express safely.
--   3. restaurants.suspended_by_platform_at / suspension_reason --
--      DELIBERATELY separate from the pre-existing restaurants.is_active
--      (which is the OWNER's own "temporarily pause my restaurant" toggle,
--      not yet exposed in any UI but already writable by owner/manager
--      under restaurants_update). If platform suspension reused is_active,
--      a suspended restaurant's own owner could simply flip it back on --
--      so the new columns are locked out of authenticated/anon UPDATE at
--      the COLUMN privilege level (revoke, below), not just by RLS, and
--      can only ever be written by admin_suspend_restaurant/
--      admin_unsuspend_restaurant running as this migration's owner.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. platform_admins.
-- No self-service path exists anywhere for becoming a platform admin --
-- unlike a restaurant owner (Phase 04's bootstrap-restaurant, open to any
-- signed-up user), this is ReservX's own internal team boundary. The FIRST
-- platform admin in any environment is provisioned by whoever operates the
-- production database directly (a one-time manual insert, documented in
-- the README) -- exactly the same "someone has to be first" reality
-- Phase 04 solved for restaurant owners with an Edge Function, except here
-- there is deliberately no analogous self-service function, because
-- self-service is precisely the capability this boundary must NOT have.
-- ---------------------------------------------------------------------------
create type public.platform_admin_role as enum ('super_admin', 'support');

create table public.platform_admins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  role        public.platform_admin_role not null default 'support',
  is_active   boolean not null default true,
  granted_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.platform_admins is
  'ReservX''s own internal team, not a restaurant''s staff. No self-service signup -- the first row in any environment is inserted manually by whoever operates the database; every row after that is created by admin_grant_platform_admin(), callable only by an existing super_admin.';

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_user_id and pa.is_active
  );
$$;

create or replace function public.is_platform_super_admin(p_user_id uuid default auth.uid())
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_user_id and pa.is_active and pa.role = 'super_admin'
  );
$$;

comment on function public.is_platform_admin is
  'True if p_user_id (default: the caller) is an active platform admin, either role. Mirrors is_restaurant_member()''s SECURITY DEFINER shape -- avoids recursion when platform_admins itself has an RLS policy that calls this.';
comment on function public.is_platform_super_admin is
  'True if p_user_id (default: the caller) is an active platform admin with role=super_admin specifically. Only super_admins may grant/revoke OTHER platform admins (see admin_grant_platform_admin/admin_revoke_platform_admin) -- every other admin_* function below accepts either role.';

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default -- caught
-- as a real, live bug in Phase 12 (evaluate_reservation_cancellation_refund)
-- by that phase's own verification script. Explicit revoke-then-grant on
-- every function in this migration from here on, learned from that.
revoke all on function public.is_platform_admin(uuid) from public;
revoke all on function public.is_platform_super_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_platform_super_admin(uuid) to authenticated;

alter table public.platform_admins enable row level security;

-- Any active admin can see the full roster (small, internal team,
-- transparency has more value than secrecy here) -- only a super_admin can
-- change it, enforced by the with check just below AND, independently, by
-- admin_grant_platform_admin/admin_revoke_platform_admin's own internal
-- checks (defense in depth: even if this policy were ever loosened by
-- mistake, the functions that actually perform the write still gate on
-- is_platform_super_admin() themselves).
create policy platform_admins_select on public.platform_admins for select
  using (is_platform_admin(auth.uid()));

-- No direct INSERT/UPDATE/DELETE policy at all -- every write goes through
-- admin_grant_platform_admin/admin_revoke_platform_admin below, which is
-- how the last-super-admin lockout guard and the audit_logs entry are
-- actually enforced. A bare RLS write policy here could not enforce either.

-- ---------------------------------------------------------------------------
-- 2. Restaurant suspension. See header comment for why this is separate
-- from is_active.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists suspended_by_platform_at timestamptz,
  add column if not exists suspension_reason text;

comment on column public.restaurants.suspended_by_platform_at is
  'Set only by admin_suspend_restaurant() (platform team), never by the restaurant''s own owner/manager -- see this migration''s header comment. NULL means not suspended.';
comment on column public.restaurants.suspension_reason is
  'Free-text reason shown to the restaurant''s own staff (via their existing audit log) and to platform admins. Not shown publicly.';

-- A plain `revoke update (col) on restaurants from authenticated` does NOT
-- narrow the pre-existing table-level UPDATE grant (`grant ... on all
-- tables in schema public to authenticated, anon`, applied automatically to
-- every table via ALTER DEFAULT PRIVILEGES at CREATE TABLE time -- see
-- local_dev_shim.sql and, in real Supabase, the platform's own default
-- grants) -- PostgreSQL privilege checks are table-level-OR-column-level,
-- and a table-level grant already authorizes every column regardless of
-- any column-level revoke layered on top. Confirmed the hard way: an
-- ad-hoc `revoke update (suspended_by_platform_at) ...` here was tried
-- first and the restaurant's own owner could still write it directly
-- (verified, then removed). A BEFORE UPDATE trigger is the correct
-- mechanism -- current_user reflects the SECURITY DEFINER function's OWNER
-- while admin_suspend_restaurant/admin_unsuspend_restaurant run (same
-- reason every SECURITY DEFINER function in this project bypasses RLS),
-- and reflects the real connecting role (authenticated/anon) for any
-- direct client write, so the trigger can tell the two apart reliably.
create or replace function public.protect_restaurant_suspension_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.suspended_by_platform_at is distinct from old.suspended_by_platform_at
          or new.suspension_reason is distinct from old.suspension_reason) then
    raise exception 'PLATFORM_MANAGED_COLUMN: suspended_by_platform_at/suspension_reason can only be changed by admin_suspend_restaurant()/admin_unsuspend_restaurant()';
  end if;
  return new;
end;
$$;

create trigger trg_restaurants_protect_suspension_columns
  before update on public.restaurants
  for each row execute function public.protect_restaurant_suspension_columns();

comment on function public.protect_restaurant_suspension_columns is
  'Blocks authenticated/anon from changing suspended_by_platform_at/suspension_reason via a direct table UPDATE, no matter what RLS would otherwise allow on the row -- these two columns are platform-managed only. Silently allows the same UPDATE through when current_user is the admin_suspend_restaurant/admin_unsuspend_restaurant functions'' SECURITY DEFINER owner.';

-- ---------------------------------------------------------------------------
-- 3. Public-facing checks (0014) now also respect suspension. is_active
-- alone used to be the full gate; suspension is an ADDITIONAL, independent
-- gate a restaurant's own owner cannot lift.
-- ---------------------------------------------------------------------------
drop policy if exists restaurants_public_select on public.restaurants;
create policy restaurants_public_select on public.restaurants for select
  using (deleted_at is null and is_active and suspended_by_platform_at is null);

drop policy if exists opening_hours_public_select on public.opening_hours;
create policy opening_hours_public_select on public.opening_hours for select
  using (exists (
    select 1 from public.restaurants r
    where r.id = opening_hours.restaurant_id and r.deleted_at is null and r.is_active and r.suspended_by_platform_at is null
  ));

drop policy if exists special_hours_public_select on public.special_hours;
create policy special_hours_public_select on public.special_hours for select
  using (exists (
    select 1 from public.restaurants r
    where r.id = special_hours.restaurant_id and r.deleted_at is null and r.is_active and r.suspended_by_platform_at is null
  ));

comment on policy restaurants_public_select on public.restaurants is
  'Phase 08, updated Phase 13: anyone (anon included) may read an active, NOT platform-suspended restaurant''s public profile. OR''d with restaurants_select (0011), which still covers staff reading their own restaurant even while inactive or suspended -- they should still be able to see why.';

-- is_restaurant_open_at (0014): SECURITY INVOKER function reading
-- restaurants directly -- update its own restaurant lookup to match, since
-- it does not go through the RLS policy just patched above.
create or replace function public.is_restaurant_open_at(p_restaurant_id uuid, p_instant timestamptz)
returns boolean
language plpgsql
stable
as $$
declare
  v_tz          text;
  v_local_ts    timestamp;
  v_local_date  date;
  v_local_dow   smallint;
  v_local_time  time;
  v_special     public.special_hours%rowtype;
begin
  select timezone into v_tz from public.restaurants
  where id = p_restaurant_id and deleted_at is null and is_active and suspended_by_platform_at is null;
  if not found then
    return false;
  end if;

  v_local_ts   := p_instant at time zone v_tz;
  v_local_date := v_local_ts::date;
  v_local_dow  := extract(dow from v_local_ts);
  v_local_time := v_local_ts::time;

  select * into v_special from public.special_hours where restaurant_id = p_restaurant_id and date = v_local_date;
  if found then
    if v_special.is_closed or v_special.opens_at is null or v_special.closes_at is null then
      return false;
    end if;
    if v_special.closes_at > v_special.opens_at then
      return v_local_time >= v_special.opens_at and v_local_time < v_special.closes_at;
    else
      return v_local_time >= v_special.opens_at;
    end if;
  end if;

  return exists (
    select 1 from public.opening_hours oh
    where oh.restaurant_id = p_restaurant_id and oh.day_of_week = v_local_dow and not oh.is_closed
      and (
        (oh.closes_at > oh.opens_at and v_local_time >= oh.opens_at and v_local_time < oh.closes_at)
        or (oh.closes_at <= oh.opens_at and v_local_time >= oh.opens_at)
      )
  ) or exists (
    select 1 from public.opening_hours oh
    where oh.restaurant_id = p_restaurant_id and oh.day_of_week = ((v_local_dow + 6) % 7) and not oh.is_closed
      and oh.closes_at <= oh.opens_at and v_local_time < oh.closes_at
  );
end;
$$;

comment on function public.is_restaurant_open_at is
  'Is this restaurant open at this UTC instant, in ITS OWN local timezone? Updated in Phase 13 to also require suspended_by_platform_at is null. Public/anon-callable -- used by book_public_reservation and available for a website "open now" indicator.';

-- book_public_reservation (0014): same fix, same reasoning -- its own
-- restaurant lookup, not the RLS policy, is what actually gates a booking.
create or replace function public.book_public_reservation(
  p_restaurant_slug text,
  p_starts_at timestamptz,
  p_party_size int,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email citext default null,
  p_special_requests text default null
)
returns public.reservations
security definer
set search_path = public
language plpgsql
as $$
declare
  v_restaurant      public.restaurants%rowtype;
  v_customer_id     uuid;
  v_customer_name   text;
  v_customer_phone  text;
  v_customer_email  citext;
  v_ends_at         timestamptz;
  v_recent_count    int;
  v_reservation     public.reservations%rowtype;
begin
  select * into v_restaurant
  from public.restaurants
  where slug = p_restaurant_slug and deleted_at is null and is_active and suspended_by_platform_at is null;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  if p_party_size is null or p_party_size < v_restaurant.min_party_size or p_party_size > v_restaurant.max_party_size then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE';
  end if;

  if p_starts_at < now() + make_interval(hours => v_restaurant.booking_window_min_hours)
     or p_starts_at > now() + make_interval(days => v_restaurant.booking_window_max_days) then
    raise exception 'OUTSIDE_BOOKING_WINDOW';
  end if;

  if not public.is_restaurant_open_at(v_restaurant.id, p_starts_at) then
    raise exception 'RESTAURANT_CLOSED';
  end if;

  if auth.uid() is not null then
    select id, full_name, phone, email into v_customer_id, v_customer_name, v_customer_phone, v_customer_email
    from public.customers where auth_user_id = auth.uid();

    if v_customer_id is null then
      insert into public.customers (auth_user_id, full_name, email, phone)
      values (auth.uid(), p_guest_name, p_guest_email, p_guest_phone)
      returning id into v_customer_id;
    else
      p_guest_name  := coalesce(p_guest_name, v_customer_name);
      p_guest_phone := coalesce(p_guest_phone, v_customer_phone);
      p_guest_email := coalesce(p_guest_email, v_customer_email);
    end if;

    if p_guest_email is null then
      select email into p_guest_email from auth.users where id = auth.uid();
    end if;
  end if;

  if p_guest_name is null or trim(p_guest_name) = '' or (p_guest_phone is null and p_guest_email is null) then
    raise exception 'GUEST_DETAILS_REQUIRED';
  end if;

  select count(*) into v_recent_count
  from public.reservations
  where source = 'web'
    and created_at > now() - interval '15 minutes'
    and ((p_guest_phone is not null and guest_phone = p_guest_phone) or (p_guest_email is not null and guest_email = p_guest_email));
  if v_recent_count >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_restaurant.default_reservation_duration_min);

  v_reservation := public.book_reservation(
    p_restaurant_id      => v_restaurant.id,
    p_starts_at          => p_starts_at,
    p_ends_at            => v_ends_at,
    p_party_size         => p_party_size,
    p_source             => 'web',
    p_customer_id        => v_customer_id,
    p_guest_name         => p_guest_name,
    p_guest_phone        => p_guest_phone,
    p_guest_email        => p_guest_email,
    p_special_requests   => p_special_requests
  );

  insert into public.audit_logs (restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id, after_data)
  values (
    v_restaurant.id,
    (case when auth.uid() is not null then 'user' else 'system' end)::public.audit_actor_type,
    auth.uid(),
    'reservation.created_public',
    'reservation',
    v_reservation.id,
    jsonb_build_object('party_size', p_party_size, 'starts_at', p_starts_at, 'source', 'web')
  );

  return v_reservation;
end;
$$;

comment on function public.book_public_reservation is
  'The public booking entry point. Updated in Phase 13 to also require suspended_by_platform_at is null, alongside the pre-existing is_active check. See 0014 for the full original design comment.';

-- ---------------------------------------------------------------------------
-- 4. admin_suspend_restaurant / admin_unsuspend_restaurant.
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspend_restaurant(p_restaurant_id uuid, p_reason text)
returns public.restaurants
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.restaurants
  set suspended_by_platform_at = now(), suspension_reason = p_reason
  where id = p_restaurant_id
  returning * into v_restaurant;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  insert into public.audit_logs (organization_id, restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id, after_data)
  values (v_restaurant.organization_id, v_restaurant.id, 'user', auth.uid(), 'restaurant.suspended_by_platform', 'restaurant', v_restaurant.id,
          jsonb_build_object('reason', p_reason));

  return v_restaurant;
end;
$$;

create or replace function public.admin_unsuspend_restaurant(p_restaurant_id uuid)
returns public.restaurants
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.restaurants
  set suspended_by_platform_at = null, suspension_reason = null
  where id = p_restaurant_id
  returning * into v_restaurant;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  insert into public.audit_logs (organization_id, restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id)
  values (v_restaurant.organization_id, v_restaurant.id, 'user', auth.uid(), 'restaurant.unsuspended_by_platform', 'restaurant', v_restaurant.id);

  return v_restaurant;
end;
$$;

revoke all on function public.admin_suspend_restaurant(uuid, text) from public;
revoke all on function public.admin_unsuspend_restaurant(uuid) from public;
grant execute on function public.admin_suspend_restaurant(uuid, text) to authenticated;
grant execute on function public.admin_unsuspend_restaurant(uuid) to authenticated;

comment on function public.admin_suspend_restaurant is
  'Platform-team suspension -- removes the restaurant from the public directory/profile/booking (see the patched restaurants_public_select and book_public_reservation), independent of the restaurant''s own is_active toggle. is_platform_admin() checked INSIDE the function (either role, support included) -- not via RLS, since suspended_by_platform_at has no RLS write policy at all for authenticated/anon (column privilege revoked above).';
comment on function public.admin_unsuspend_restaurant is
  'Reverses admin_suspend_restaurant. Same authorization.';

-- ---------------------------------------------------------------------------
-- 5. admin_set_subscription -- manually set an organization's subscription
-- plan/status, with no Stripe involvement at all (e.g. comping a pilot
-- restaurant, per the product owner's real 2-3 pilot restaurants -- or
-- marking an org past_due/cancelled for offline non-payment). Mirrors
-- stripe-webhook's own upsertSubscriptionFromStripeObject retire-then-
-- insert sequence (Phase 12) so the SAME uidx_subscriptions_active_per_org
-- constraint is respected either way a subscription changes.
-- provider_subscription_id is left NULL on the new row -- a manually-set
-- subscription is never confused with one Stripe is tracking; if this org
-- later DOES go through Stripe checkout, stripe-webhook's own upsert logic
-- retires this row exactly the same way it retires any other.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_subscription(
  p_organization_id uuid,
  p_plan_code text,
  p_status public.subscription_status,
  p_trial_ends_at timestamptz default null,
  p_current_period_end timestamptz default null,
  p_reason text default null
)
returns public.subscriptions
language plpgsql security definer set search_path = public
as $$
declare
  v_plan_id uuid;
  v_before  jsonb;
  v_result  public.subscriptions%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select id into v_plan_id from public.subscription_plans where code = p_plan_code and is_active;
  if v_plan_id is null then
    raise exception 'UNKNOWN_PLAN';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  select to_jsonb(s) into v_before from public.subscriptions s
  where s.organization_id = p_organization_id and s.status in ('trialing', 'active', 'past_due')
  limit 1;

  update public.subscriptions
  set status = 'cancelled'
  where organization_id = p_organization_id and status in ('trialing', 'active', 'past_due');

  insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (p_organization_id, v_plan_id, p_status, p_trial_ends_at, now(), p_current_period_end)
  returning * into v_result;

  insert into public.audit_logs (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (p_organization_id, 'user', auth.uid(), 'subscription.set_by_platform', 'subscription', v_result.id,
          v_before, jsonb_build_object('plan_code', p_plan_code, 'status', p_status, 'reason', p_reason));

  return v_result;
end;
$$;

revoke all on function public.admin_set_subscription(uuid, text, public.subscription_status, timestamptz, timestamptz, text) from public;
grant execute on function public.admin_set_subscription(uuid, text, public.subscription_status, timestamptz, timestamptz, text) to authenticated;

comment on function public.admin_set_subscription is
  'Manually sets an organization''s subscription, bypassing Stripe entirely (provider_subscription_id stays null on the new row). Retires any existing non-terminal subscription first, same sequence Phase 12''s stripe-webhook upsert uses, so uidx_subscriptions_active_per_org (0007) is respected either way a subscription changes. is_platform_admin() only (either role) -- this is billing management, not privilege escalation, so it does not require super_admin.';

-- ---------------------------------------------------------------------------
-- 6. admin_grant_platform_admin / admin_revoke_platform_admin --
-- super_admin ONLY (the one real privilege-escalation boundary in this
-- migration). Resolves an email to a user_id via auth.users, which no
-- client role can ever read directly -- same reason get_restaurant_staff
-- (Phase 05) had to be SECURITY DEFINER.
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_platform_admin(p_email citext, p_role public.platform_admin_role default 'support')
returns public.platform_admins
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_result  public.platform_admins%rowtype;
begin
  if not is_platform_super_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.platform_admins (user_id, role, is_active, granted_by)
  values (v_user_id, p_role, true, auth.uid())
  on conflict (user_id) do update set role = excluded.role, is_active = true, granted_by = excluded.granted_by
  returning * into v_result;

  insert into public.audit_logs (actor_type, actor_user_id, action, entity_type, entity_id, after_data)
  values ('user', auth.uid(), 'platform_admin.granted', 'platform_admin', v_result.id, jsonb_build_object('user_id', v_user_id, 'role', p_role));

  return v_result;
end;
$$;

create or replace function public.admin_revoke_platform_admin(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_target public.platform_admins%rowtype;
  v_remaining_super_admins int;
begin
  if not is_platform_super_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_target from public.platform_admins where user_id = p_user_id;
  if not found or not v_target.is_active then
    raise exception 'ADMIN_NOT_FOUND';
  end if;

  if v_target.role = 'super_admin' then
    select count(*) into v_remaining_super_admins
    from public.platform_admins
    where role = 'super_admin' and is_active and user_id <> p_user_id;
    if v_remaining_super_admins = 0 then
      raise exception 'CANNOT_REVOKE_LAST_SUPER_ADMIN';
    end if;
  end if;

  update public.platform_admins set is_active = false where user_id = p_user_id;

  insert into public.audit_logs (actor_type, actor_user_id, action, entity_type, entity_id, before_data)
  values ('user', auth.uid(), 'platform_admin.revoked', 'platform_admin', v_target.id, jsonb_build_object('user_id', p_user_id, 'role', v_target.role));
end;
$$;

revoke all on function public.admin_grant_platform_admin(citext, public.platform_admin_role) from public;
revoke all on function public.admin_revoke_platform_admin(uuid) from public;
grant execute on function public.admin_grant_platform_admin(citext, public.platform_admin_role) to authenticated;
grant execute on function public.admin_revoke_platform_admin(uuid) to authenticated;

comment on function public.admin_grant_platform_admin is
  'super_admin only. Looks up p_email in auth.users (never directly readable by any client role) and upserts a platform_admins row -- re-activates + re-roles an existing (even previously revoked) row for the same user_id rather than erroring, since on conflict (user_id) is unique.';
comment on function public.admin_revoke_platform_admin is
  'super_admin only. Soft-revoke (is_active=false, row kept for audit history -- never deleted). Refuses to revoke the LAST active super_admin, which would permanently lock the platform out of its own admin tooling with no recovery path short of manual database access.';

-- ---------------------------------------------------------------------------
-- 7. Read functions for the admin app -- purpose-built, not raw table RLS,
-- so exactly the fields an admin dashboard needs (including auth.users
-- emails, never otherwise exposed) are returned, and nothing more. Same
-- precedent as get_restaurant_staff (Phase 05) / get_reservation_analytics
-- (Phase 10).
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_organizations()
returns table (
  organization_id     uuid,
  organization_name   text,
  owner_email         citext,
  billing_email       citext,
  restaurant_count    bigint,
  subscription_status public.subscription_status,
  plan_code           text,
  trial_ends_at       timestamptz,
  created_at          timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select
      o.id,
      o.name,
      u.email::citext,
      o.billing_email,
      (select count(*) from public.restaurants r where r.organization_id = o.id and r.deleted_at is null),
      s.status,
      sp.code,
      s.trial_ends_at,
      o.created_at
    from public.organizations o
    join auth.users u on u.id = o.owner_user_id
    left join public.subscriptions s on s.organization_id = o.id and s.status in ('trialing', 'active', 'past_due')
    left join public.subscription_plans sp on sp.id = s.plan_id
    order by o.created_at desc;
end;
$$;

create or replace function public.admin_list_restaurants(p_organization_id uuid default null)
returns table (
  restaurant_id             uuid,
  organization_id           uuid,
  name                      text,
  slug                      text,
  restaurant_type           public.restaurant_type,
  city                      text,
  country_code              char(2),
  is_active                 boolean,
  suspended_by_platform_at  timestamptz,
  suspension_reason         text,
  created_at                timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select r.id, r.organization_id, r.name, r.slug, r.restaurant_type, r.city, r.country_code,
           r.is_active, r.suspended_by_platform_at, r.suspension_reason, r.created_at
    from public.restaurants r
    where r.deleted_at is null
      and (p_organization_id is null or r.organization_id = p_organization_id)
    order by r.created_at desc;
end;
$$;

create or replace function public.admin_list_subscription_history(p_organization_id uuid)
returns setof public.subscriptions
language plpgsql security definer set search_path = public stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select s.* from public.subscriptions s
    where s.organization_id = p_organization_id
    order by s.created_at desc;
end;
$$;

create or replace function public.admin_list_platform_admins()
returns table (
  id               uuid,
  user_id          uuid,
  email            citext,
  role             public.platform_admin_role,
  is_active        boolean,
  granted_by_email citext,
  created_at       timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select pa.id, pa.user_id, u.email::citext, pa.role, pa.is_active, gb.email::citext, pa.created_at
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
    left join auth.users gb on gb.id = pa.granted_by
    order by pa.created_at asc;
end;
$$;

revoke all on function public.admin_list_organizations() from public;
revoke all on function public.admin_list_restaurants(uuid) from public;
revoke all on function public.admin_list_subscription_history(uuid) from public;
revoke all on function public.admin_list_platform_admins() from public;
grant execute on function public.admin_list_organizations() to authenticated;
grant execute on function public.admin_list_restaurants(uuid) to authenticated;
grant execute on function public.admin_list_subscription_history(uuid) to authenticated;
grant execute on function public.admin_list_platform_admins() to authenticated;

comment on function public.admin_list_organizations is
  'One-row-per-organization admin roster: owner email (via auth.users, never otherwise readable by any client role), current subscription plan/status, restaurant count. is_platform_admin() checked INSIDE the function body -- raises NOT_AUTHORIZED for anyone else, same as every admin_list_* function and every admin_* write function in this migration, rather than via a GRANT/RLS boundary, since these are read functions with no row-level table to attach RLS to.';

-- ---------------------------------------------------------------------------
-- 8. Feature flags (0010) -- SELECT-only since 0011, zero writers until now.
-- Plain additive RLS write policies (not SECURITY DEFINER functions): flags
-- are non-monetary, fully reversible, and touch no auth.users data, so the
-- extra ceremony of a dedicated function per write buys nothing here that
-- "is_platform_admin() in a with check" doesn't already give directly.
-- ---------------------------------------------------------------------------
create policy feature_flags_platform_write on public.feature_flags for all
  using (is_platform_admin())
  with check (is_platform_admin());

create policy feature_flag_overrides_platform_select on public.feature_flag_overrides for select
  using (is_platform_admin());

create policy feature_flag_overrides_platform_write on public.feature_flag_overrides for all
  using (is_platform_admin())
  with check (is_platform_admin());

comment on policy feature_flags_platform_write on public.feature_flags is
  'Additive to feature_flags_select (0011, any signed-in user may read). Defining/editing flags is platform-admin only (either role).';
comment on policy feature_flag_overrides_platform_select on public.feature_flag_overrides is
  'Additive to feature_flag_overrides_select (0011, scoped to the override''s own org owner/restaurant member) -- platform admins can see every org''s overrides, not just ones they belong to.';
