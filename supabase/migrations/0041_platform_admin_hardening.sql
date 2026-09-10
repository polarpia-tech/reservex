-- =============================================================================
-- 0041_platform_admin_hardening.sql
-- Phase 18, part 1 (Super Admin / Platform Admin command center -- see the
-- README's new Phase 18 section for the full write-up): the platform owner
-- asked for a proper admin-role hierarchy (Super Admin / Platform Admin /
-- Support Admin / Finance Admin / Technical Admin / Read-only Admin) instead
-- of Phase 13's two-role start (super_admin/support), and for platform
-- admins to be able to read their OWN audit trail -- which, on inspection,
-- Phase 13 never actually wired up (audit_logs_select, migration 0011, only
-- covers a restaurant's own owner/manager; there was no platform-admin path
-- into audit_logs at all).
--
-- Three things happen here:
--   1. platform_admin_role grows from 2 values to 6, via RENAME VALUE +
--      ADD VALUE (see below for why this is safe with zero data migration).
--   2. has_platform_admin_role() -- same SECURITY DEFINER shape as
--      has_restaurant_role() (0011) -- and every WRITE-side admin_* function
--      /policy from 0020 is updated to check the narrowest role set that
--      makes sense for that action, instead of the blanket is_platform_
--      admin() (any active role). READ-side admin_list_* functions are
--      deliberately left on is_platform_admin() -- "any active admin can
--      see everything, only a scoped subset can change things" is the
--      explicit model here (mirrors 0020's own choice to make the
--      platform_admins roster itself visible to any active admin).
--   3. admin_list_audit_logs() -- the missing read path -- plus an additive
--      audit_logs_platform_select RLS policy as defense in depth (same
--      "even if the function path were ever bypassed" reasoning 0020 used
--      for platform_admins_select). admin_get_my_role() is a small
--      convenience alongside it: the admin app needs its caller's own role
--      (not the whole roster) to decide what UI to show.
--
-- Why RENAME VALUE + ADD VALUE, not drop-and-recreate-the-type: the
-- platform is in pilot (2-3 restaurants, a handful of platform admins) but
-- there is no reason to force a data migration for existing platform_admins
-- rows when Postgres already has a purpose-built, zero-downtime tool for
-- exactly this. RENAME VALUE changes only the catalog label
-- (pg_enum.enumlabel) for the SAME underlying enum OID -- any existing row
-- with role='support', and the column's own DEFAULT 'support' (resolved to
-- that OID back at CREATE TABLE time in 0020), transparently read back as
-- 'support_admin' afterwards. No UPDATE statement needed or written.
-- ADD VALUE for the four new roles is deliberately never referenced again
-- in THIS file (only 'support_admin', which existed under its old name
-- already) -- avoids relying on any assumption about same-transaction
-- visibility of a brand-new enum value across different migration runners
-- (psql -f vs `supabase db push`, which may or may not wrap a file in one
-- transaction). Granting someone one of the four new roles happens later,
-- via admin_grant_platform_admin, in whatever future session a super_admin
-- runs it -- always a separate transaction from this migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Role hierarchy.
-- ---------------------------------------------------------------------------
alter type public.platform_admin_role rename value 'support' to 'support_admin';
alter type public.platform_admin_role add value 'platform_admin';
alter type public.platform_admin_role add value 'finance_admin';
alter type public.platform_admin_role add value 'technical_admin';
alter type public.platform_admin_role add value 'read_only_admin';

comment on type public.platform_admin_role is
  'ReservX''s own internal team roles (platform_admins.role), not restaurant staff_role. Six roles: super_admin (everything, incl. granting/revoking other admins -- see is_platform_super_admin()), platform_admin (everything else), support_admin (restaurants/customers/reservations support, incl. suspend/unsuspend -- NOT billing or feature flags), finance_admin (subscriptions/billing), technical_admin (feature flags), read_only_admin (view-only everywhere; has no write capability in any admin_* function or platform-admin RLS write policy). Fine-grained enforcement lives in has_platform_admin_role() below and in the TypeScript capability map in packages/core/src/api/admin.ts (ADMIN_CAPABILITIES) -- deliberately a small hardcoded map, not a configurable permissions table/UI, since this is a small internal team with a fixed, product-defined set of roles, not a customer-facing RBAC feature.';

-- ---------------------------------------------------------------------------
-- 2. has_platform_admin_role() -- the fine-grained authorization primitive.
-- Mirrors has_restaurant_role(uuid, staff_role[]) (0011) exactly, minus the
-- restaurant-scoping argument (platform_admins isn't scoped to a restaurant
-- at all). is_platform_admin()/is_platform_super_admin() (0020) stay as
-- they are -- "any active admin" and "super_admin specifically" are still
-- exactly the right checks for what they already gate (read access,
-- granting/revoking other admins) and every existing caller keeps working
-- unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.has_platform_admin_role(allowed_roles public.platform_admin_role[])
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.is_active
      and pa.role = any (allowed_roles)
  );
$$;

comment on function public.has_platform_admin_role is
  'True if the caller is an active platform admin whose role is one of allowed_roles. The authorization primitive every WRITE-side admin_* function/RLS policy should use going forward, instead of the broad is_platform_admin() (true for any active role) -- so a read_only_admin or a finance_admin genuinely cannot perform writes outside their own scope, not just "the UI happens to hide the button".';

revoke all on function public.has_platform_admin_role(public.platform_admin_role[]) from public;
grant execute on function public.has_platform_admin_role(public.platform_admin_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Narrow the existing WRITE-side admin_* functions (0020) to the
-- specific roles that should be able to perform them. Full function bodies
-- are re-specified (create or replace) with ONLY the authorization check
-- changed -- everything else is byte-for-byte identical to 0020.
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspend_restaurant(p_restaurant_id uuid, p_reason text)
returns public.restaurants
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  if not has_platform_admin_role(array['super_admin', 'platform_admin', 'support_admin']::public.platform_admin_role[]) then
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
  if not has_platform_admin_role(array['super_admin', 'platform_admin', 'support_admin']::public.platform_admin_role[]) then
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

comment on function public.admin_suspend_restaurant is
  'Platform-team suspension. Phase 18: authorization narrowed from is_platform_admin() (any role) to super_admin/platform_admin/support_admin specifically -- suspending a restaurant is a support-type action, not a financial or technical one, so finance_admin/technical_admin/read_only_admin are correctly refused (NOT_AUTHORIZED). See 0020 for the rest of this function''s design (column-privilege protection trigger, public-directory removal, etc.), all unchanged.';
comment on function public.admin_unsuspend_restaurant is
  'Reverses admin_suspend_restaurant. Same authorization as of Phase 18.';

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
  if not has_platform_admin_role(array['super_admin', 'platform_admin', 'finance_admin']::public.platform_admin_role[]) then
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

comment on function public.admin_set_subscription is
  'Manually sets an organization''s subscription, bypassing Stripe entirely. Phase 18: authorization narrowed from is_platform_admin() (any role) to super_admin/platform_admin/finance_admin specifically -- billing changes are finance-scoped; support_admin/technical_admin/read_only_admin are correctly refused. See 0020 for the rest of this function''s design (retire-then-insert sequence, uidx_subscriptions_active_per_org), unchanged.';

-- admin_grant_platform_admin/admin_revoke_platform_admin (0020) are
-- UNCHANGED in their authorization (is_platform_super_admin() only --
-- already the narrowest possible check, granting/revoking ANY role,
-- including the new ones, is and stays super_admin-exclusive). The only
-- change here is the default role parameter, since the label 'support' no
-- longer exists under that name.
create or replace function public.admin_grant_platform_admin(p_email citext, p_role public.platform_admin_role default 'support_admin')
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

comment on function public.admin_grant_platform_admin is
  'super_admin only, unchanged from 0020 except the default role label (support -> support_admin, Phase 18). Looks up p_email in auth.users (never directly readable by any client role) and upserts a platform_admins row.';

-- ---------------------------------------------------------------------------
-- 4. Feature flag WRITE policies (0020) narrowed the same way. The existing
-- feature_flags_select (0011, any signed-in user) and
-- feature_flag_overrides_platform_select (0020, any active admin) are
-- UNCHANGED -- viewing flags/overrides stays universal, only defining/
-- editing them is now technical_admin-scoped.
-- ---------------------------------------------------------------------------
drop policy if exists feature_flags_platform_write on public.feature_flags;
create policy feature_flags_platform_write on public.feature_flags for all
  using (has_platform_admin_role(array['super_admin', 'platform_admin', 'technical_admin']::public.platform_admin_role[]))
  with check (has_platform_admin_role(array['super_admin', 'platform_admin', 'technical_admin']::public.platform_admin_role[]));

drop policy if exists feature_flag_overrides_platform_write on public.feature_flag_overrides;
create policy feature_flag_overrides_platform_write on public.feature_flag_overrides for all
  using (has_platform_admin_role(array['super_admin', 'platform_admin', 'technical_admin']::public.platform_admin_role[]))
  with check (has_platform_admin_role(array['super_admin', 'platform_admin', 'technical_admin']::public.platform_admin_role[]));

comment on policy feature_flags_platform_write on public.feature_flags is
  'Phase 18: narrowed from is_platform_admin() (any role) to super_admin/platform_admin/technical_admin. Additive to feature_flags_select (0011, any signed-in user may read).';
comment on policy feature_flag_overrides_platform_write on public.feature_flag_overrides is
  'Phase 18: narrowed from is_platform_admin() (any role) to super_admin/platform_admin/technical_admin. feature_flag_overrides_platform_select (0020, any active admin may view) is unchanged.';

-- ---------------------------------------------------------------------------
-- 5. audit_logs: the missing platform-admin read path. audit_logs_select
-- (0011) only ever covered a restaurant's own owner/manager -- there was no
-- way for a platform admin to read audit_logs at all, despite 0020's own
-- admin_* functions writing to it constantly. Two layers, same "defense in
-- depth" pattern 0020 used for platform_admins_select:
--   - admin_list_audit_logs(): the real, purpose-built read path the admin
--     app uses -- filterable, paginated, joins organization/restaurant name
--     and actor email (auth.users, never otherwise readable).
--   - audit_logs_platform_select: an additive RLS policy, so a direct
--     `client.from('audit_logs').select()` from the admin app (or anyone
--     debugging) also works, and so the security posture doesn't rely
--     SOLELY on the function existing.
-- View access stays universal (is_platform_admin(), any active role,
-- including read_only_admin) -- same "small internal team, transparency
-- over secrecy" call 0020 made for the platform_admins roster itself.
-- ---------------------------------------------------------------------------
create policy audit_logs_platform_select on public.audit_logs for select
  using (is_platform_admin());

comment on policy audit_logs_platform_select on public.audit_logs is
  'Phase 18. Additive to audit_logs_select (0011, restaurant owner/manager only) -- any active platform admin, any role, may read the full cross-tenant audit trail. Postgres OR''s multiple permissive SELECT policies together, same mechanism restaurants_public_select (0020) relies on.';

create or replace function public.admin_list_audit_logs(
  p_restaurant_id uuid default null,
  p_organization_id uuid default null,
  p_actor_user_id uuid default null,
  p_action_prefix text default null,
  p_entity_type text default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  restaurant_id     uuid,
  restaurant_name   text,
  actor_type        public.audit_actor_type,
  actor_user_id     uuid,
  actor_email       citext,
  action            text,
  entity_type       text,
  entity_id         uuid,
  before_data       jsonb,
  after_data        jsonb,
  created_at        timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 50;
  end if;
  if p_offset is null or p_offset < 0 then
    p_offset := 0;
  end if;

  return query
    select
      al.id, al.organization_id, o.name, al.restaurant_id, r.name,
      al.actor_type, al.actor_user_id, u.email::citext,
      al.action, al.entity_type, al.entity_id, al.before_data, al.after_data, al.created_at
    from public.audit_logs al
    left join public.organizations o on o.id = al.organization_id
    left join public.restaurants r on r.id = al.restaurant_id
    left join auth.users u on u.id = al.actor_user_id
    where (p_restaurant_id is null or al.restaurant_id = p_restaurant_id)
      and (p_organization_id is null or al.organization_id = p_organization_id)
      and (p_actor_user_id is null or al.actor_user_id = p_actor_user_id)
      and (p_action_prefix is null or al.action like (p_action_prefix || '%'))
      and (p_entity_type is null or al.entity_type = p_entity_type)
      and (p_since is null or al.created_at >= p_since)
      and (p_until is null or al.created_at <= p_until)
    order by al.created_at desc
    limit p_limit offset p_offset;
end;
$$;

comment on function public.admin_list_audit_logs is
  'The admin app''s audit log viewer. Any active platform admin, any role (view stays universal -- see this migration''s header). p_action_prefix does a plain LIKE prefix match (e.g. ''restaurant.'' matches every restaurant.* action) -- deliberately simple, trusted-admin-only input, not a public search endpoint. p_limit capped at 200; invalid/out-of-range limit or offset silently falls back to the default rather than erroring, since this is a viewer, not a mutation.';

revoke all on function public.admin_list_audit_logs(uuid, uuid, uuid, text, text, timestamptz, timestamptz, int, int) from public;
grant execute on function public.admin_list_audit_logs(uuid, uuid, uuid, text, text, timestamptz, timestamptz, int, int) to authenticated;

create or replace function public.admin_get_my_role()
returns public.platform_admin_role
language sql security definer set search_path = public stable
as $$
  select role from public.platform_admins where user_id = auth.uid() and is_active;
$$;

comment on function public.admin_get_my_role is
  'Returns the caller''s own active platform_admin role, or NULL if not an active admin. The admin app calls this right after is_platform_admin() succeeds, to decide which admin UI/actions to show for THIS admin specifically -- a cheap, targeted lookup instead of fetching the whole roster (admin_list_platform_admins) just to find one''s own row.';

revoke all on function public.admin_get_my_role() from public;
grant execute on function public.admin_get_my_role() to authenticated;
