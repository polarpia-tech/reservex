-- =============================================================================
-- 0011_row_level_security.sql
-- Purpose: tenant isolation. From here on, NOTHING is readable or writable
-- across restaurant boundaries through the normal (anon/authenticated)
-- Postgres roles -- only through Edge Functions running as the service role,
-- which apply their own authorization + business rules before touching data.
--
-- Pattern: every policy is expressed through a small set of SECURITY DEFINER
-- helper functions, so the actual access rule is defined once and reused,
-- instead of copy-pasted (and silently drifting) across 20 policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER + fixed search_path so they run with
-- the migration owner's privileges (bypassing RLS on the tables they check),
-- which is what avoids infinite recursion when restaurant_users itself has
-- an RLS policy that calls is_restaurant_member().
-- ---------------------------------------------------------------------------
create or replace function public.is_restaurant_member(target_restaurant_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.restaurant_users ru
    where ru.restaurant_id = target_restaurant_id
      and ru.user_id = auth.uid()
      and ru.is_active
  );
$$;

create or replace function public.has_restaurant_role(target_restaurant_id uuid, allowed_roles public.staff_role[])
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.restaurant_users ru
    where ru.restaurant_id = target_restaurant_id
      and ru.user_id = auth.uid()
      and ru.is_active
      and ru.role = any (allowed_roles)
  );
$$;

create or replace function public.is_org_owner(target_organization_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_organization_id
      and o.owner_user_id = auth.uid()
  );
$$;

create or replace function public.owns_customer(target_customer_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.customers c
    where c.id = target_customer_id
      and c.auth_user_id = auth.uid()
  );
$$;

comment on function public.is_restaurant_member(uuid) is
  'True if the current auth.uid() is an active staff member of the given restaurant, any role.';
comment on function public.has_restaurant_role(uuid, public.staff_role[]) is
  'True if the current auth.uid() is an active staff member of the given restaurant with one of the given roles.';

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;

create policy organizations_select on public.organizations for select
  using (
    is_org_owner(id)
    or exists (select 1 from public.restaurants r where r.organization_id = organizations.id and is_restaurant_member(r.id))
  );

create policy organizations_insert on public.organizations for insert
  with check (owner_user_id = auth.uid());

create policy organizations_update on public.organizations for update
  using (is_org_owner(id));

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------
alter table public.restaurants enable row level security;

create policy restaurants_select on public.restaurants for select
  using (is_restaurant_member(id) or is_org_owner(organization_id));

create policy restaurants_insert on public.restaurants for insert
  with check (is_org_owner(organization_id));

create policy restaurants_update on public.restaurants for update
  using (has_restaurant_role(id, array['owner', 'manager']::public.staff_role[]) or is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- restaurant_users
-- ---------------------------------------------------------------------------
alter table public.restaurant_users enable row level security;

create policy restaurant_users_select on public.restaurant_users for select
  using (is_restaurant_member(restaurant_id));

create policy restaurant_users_write on public.restaurant_users for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

-- ---------------------------------------------------------------------------
-- Floor plan: table_zones, tables, table_combinations, table_combination_members
-- ---------------------------------------------------------------------------
alter table public.table_zones enable row level security;
create policy table_zones_select on public.table_zones for select using (is_restaurant_member(restaurant_id));
create policy table_zones_write on public.table_zones for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.tables enable row level security;
create policy tables_select on public.tables for select using (is_restaurant_member(restaurant_id));
-- Structural changes (create/remove a table) are owner/manager only.
create policy tables_insert on public.tables for insert
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));
create policy tables_delete on public.tables for delete
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));
-- Status changes (seat/clean/block a table) are everyday work for any active staff member.
create policy tables_update on public.tables for update
  using (is_restaurant_member(restaurant_id));

alter table public.table_combinations enable row level security;
create policy table_combinations_select on public.table_combinations for select using (is_restaurant_member(restaurant_id));
create policy table_combinations_write on public.table_combinations for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.table_combination_members enable row level security;
create policy table_combination_members_all on public.table_combination_members for all
  using (exists (
    select 1 from public.table_combinations tc
    where tc.id = table_combination_members.combination_id and is_restaurant_member(tc.restaurant_id)
  ))
  with check (exists (
    select 1 from public.table_combinations tc
    where tc.id = table_combination_members.combination_id
      and has_restaurant_role(tc.restaurant_id, array['owner', 'manager']::public.staff_role[])
  ));

-- ---------------------------------------------------------------------------
-- Availability & events
-- ---------------------------------------------------------------------------
alter table public.opening_hours enable row level security;
create policy opening_hours_select on public.opening_hours for select using (is_restaurant_member(restaurant_id));
create policy opening_hours_write on public.opening_hours for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.special_hours enable row level security;
create policy special_hours_select on public.special_hours for select using (is_restaurant_member(restaurant_id));
create policy special_hours_write on public.special_hours for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.events enable row level security;
create policy events_select on public.events for select using (is_restaurant_member(restaurant_id));
create policy events_write on public.events for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager', 'reservation_manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager', 'reservation_manager']::public.staff_role[]));

-- ---------------------------------------------------------------------------
-- Customers & CRM
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;

create policy customers_select on public.customers for select
  using (
    owns_customer(id)
    or exists (
      select 1 from public.restaurant_customers rc
      where rc.customer_id = customers.id and is_restaurant_member(rc.restaurant_id)
    )
  );

-- Any authenticated actor (a signed-up guest, or staff typing in a walk-in)
-- may create a bare identity row; it carries no sensitive data by itself.
create policy customers_insert on public.customers for insert
  with check (auth.uid() is not null);

create policy customers_update on public.customers for update
  using (owns_customer(id));

alter table public.restaurant_customers enable row level security;
-- Deliberately NO policy granting customers visibility into their own CRM
-- record: notes/tags/VIP status are restaurant-internal.
create policy restaurant_customers_all on public.restaurant_customers for all
  using (is_restaurant_member(restaurant_id))
  with check (is_restaurant_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- Reservations & waitlist
--
-- Direct table writes here are for STAFF use (host/manager screens). The
-- customer-facing booking flow always goes through an Edge Function running
-- as the service role, because creating a reservation requires availability
-- checks and smart table allocation that must run trusted, server-side --
-- never as a client-trusted RLS-only insert.
-- ---------------------------------------------------------------------------
alter table public.reservations enable row level security;

create policy reservations_select on public.reservations for select
  using (is_restaurant_member(restaurant_id) or (customer_id is not null and owns_customer(customer_id)));

create policy reservations_staff_write on public.reservations for all
  using (is_restaurant_member(restaurant_id))
  with check (is_restaurant_member(restaurant_id));

alter table public.reservation_tables enable row level security;
create policy reservation_tables_all on public.reservation_tables for all
  using (is_restaurant_member(restaurant_id))
  with check (is_restaurant_member(restaurant_id));

alter table public.waitlist_entries enable row level security;
create policy waitlist_select on public.waitlist_entries for select
  using (is_restaurant_member(restaurant_id) or (customer_id is not null and owns_customer(customer_id)));
create policy waitlist_staff_write on public.waitlist_entries for all
  using (is_restaurant_member(restaurant_id))
  with check (is_restaurant_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- Payments, deposits & subscriptions
-- Only SELECT policies exist for the authenticated role: money actually
-- moves only via Edge Functions + provider webhooks running as service role.
-- ---------------------------------------------------------------------------
alter table public.deposit_policies enable row level security;
create policy deposit_policies_select on public.deposit_policies for select using (is_restaurant_member(restaurant_id));
create policy deposit_policies_write on public.deposit_policies for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.payments enable row level security;
create policy payments_select on public.payments for select
  using (is_restaurant_member(restaurant_id) or (customer_id is not null and owns_customer(customer_id)));

alter table public.subscription_plans enable row level security;
create policy subscription_plans_select on public.subscription_plans for select using (true);

alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select using (is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select
  using (
    (recipient_user_id is not null and recipient_user_id = auth.uid())
    or (recipient_customer_id is not null and owns_customer(recipient_customer_id))
    or is_restaurant_member(restaurant_id)
  );

alter table public.staff_notification_preferences enable row level security;
create policy staff_notification_preferences_all on public.staff_notification_preferences for all
  using (user_id = auth.uid() or has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (user_id = auth.uid() or has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.reminder_rules enable row level security;
create policy reminder_rules_select on public.reminder_rules for select using (is_restaurant_member(restaurant_id));
create policy reminder_rules_write on public.reminder_rules for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

-- ---------------------------------------------------------------------------
-- AI layer
-- ai_actions has NO write policy for the authenticated role at all: only the
-- AI Gateway (service role) may record a proposed/executed action, per the
-- "AI must not have unrestricted database access" rule in the blueprint.
-- ---------------------------------------------------------------------------
alter table public.ai_conversations enable row level security;
create policy ai_conversations_select on public.ai_conversations for select
  using (
    (user_id is not null and user_id = auth.uid())
    or (customer_id is not null and owns_customer(customer_id))
    or (restaurant_id is not null and is_restaurant_member(restaurant_id))
  );
create policy ai_conversations_insert on public.ai_conversations for insert
  with check (user_id = auth.uid());

alter table public.ai_messages enable row level security;
create policy ai_messages_select on public.ai_messages for select
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and (
        (c.user_id is not null and c.user_id = auth.uid())
        or (c.customer_id is not null and owns_customer(c.customer_id))
        or (c.restaurant_id is not null and is_restaurant_member(c.restaurant_id))
      )
  ));

alter table public.ai_actions enable row level security;
create policy ai_actions_select on public.ai_actions for select
  using (restaurant_id is not null and is_restaurant_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- Governance: audit_logs (owner/manager only -- it contains sensitive
-- before/after diffs) and feature_flags (read-only for everyone signed in).
-- ---------------------------------------------------------------------------
alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select
  using (restaurant_id is not null and has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

alter table public.feature_flags enable row level security;
create policy feature_flags_select on public.feature_flags for select using (auth.uid() is not null);

alter table public.feature_flag_overrides enable row level security;
create policy feature_flag_overrides_select on public.feature_flag_overrides for select
  using (
    (organization_id is not null and is_org_owner(organization_id))
    or (restaurant_id is not null and is_restaurant_member(restaurant_id))
  );
