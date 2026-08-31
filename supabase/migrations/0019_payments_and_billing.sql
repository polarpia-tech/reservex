-- =============================================================================
-- 0019_payments_and_billing.sql
-- Phase 12: Payments. Deposits/no-show protection for guest reservations,
-- and the platform's own subscription billing. Stripe is the provider
-- (blueprint, Part 05: PaymentIntents with manual capture -- authorize now,
-- capture only if actually needed, e.g. a no-show). No card data is ever
-- stored here; only Stripe reference ids, exactly as 0007 already commented.
--
-- Several real gaps in 0007's original design surfaced while working out
-- HOW this would actually be called from an Edge Function (not while
-- reading the schema in the abstract) -- each is fixed here, not silently
-- worked around:
--
-- 1. `payment_status` had no state for "authorized, awaiting a capture-or-
--    void decision" -- exactly what a manual-capture PaymentIntent sits in
--    between the guest completing card entry and staff later deciding to
--    charge (no-show) or release the hold (reservation completed/edited
--    normally, no charge needed). Added `requires_capture`.
-- 2. `payments` had no link back to the deposit_policies row that produced
--    it, and no snapshot of the cancellation window that applied. Without
--    this, refund eligibility on a LATER cancellation would have to re-read
--    whatever the policy says TODAY -- which is wrong if the restaurant
--    edited or deactivated that policy in the meantime. Added
--    `deposit_policy_id` (traceability) and `cancellation_window_hours_
--    snapshot` (the actual number this payment was created under, frozen
--    at creation time, same pattern reservations.buffer_minutes already
--    uses for turnover buffer).
-- 3. `deposit_policies.calculation_type = 'percentage'` has no defined base
--    to take a percentage OF -- this product has no menu/order-total
--    concept anywhere in the schema. Added `percentage_base_amount_cents`
--    (an estimated spend-per-person the restaurant sets explicitly), so
--    "20% deposit" has an unambiguous, restaurant-controlled meaning:
--    percentage% of (percentage_base_amount_cents * party_size).
-- 4. `subscription_plans` had no Stripe Price reference -- added
--    `provider_price_id`, and seeded the four plan rows from the blueprint's
--    own pricing table (Part 11) so this is real reference data from day
--    one, not left for a later admin screen to populate.
-- 5. `deposit_policies` was staff-only readable (is_restaurant_member).
--    A guest browsing the public site needs to see "this booking requires
--    a €20 deposit, refundable up to 24h before" BEFORE they book --
--    cancellation/deposit terms are exactly the kind of trust-critical
--    information Part 12 of the blueprint calls out. Added a public read
--    policy for active policies, same shape as 0014's public restaurant
--    read policies.
-- =============================================================================

alter type public.payment_status add value if not exists 'requires_capture';

alter table public.payments
  add column if not exists deposit_policy_id uuid references public.deposit_policies(id) on delete set null,
  add column if not exists cancellation_window_hours_snapshot int;

comment on column public.payments.deposit_policy_id is
  'Which deposit_policies row produced this payment, if any -- for traceability. NOT the source of truth for refund eligibility once the payment exists; see cancellation_window_hours_snapshot.';
comment on column public.payments.cancellation_window_hours_snapshot is
  'The deposit_policies.cancellation_window_hours value AT THE TIME this payment was created, frozen so a later edit to (or deactivation of) the policy never silently rewrites the refund terms a guest already agreed to.';

alter table public.deposit_policies
  add column if not exists percentage_base_amount_cents int check (percentage_base_amount_cents >= 0);

alter table public.deposit_policies drop constraint if exists deposit_policy_amount_present;
alter table public.deposit_policies add constraint deposit_policy_amount_present check (
  (calculation_type = 'percentage' and percentage is not null and percentage_base_amount_cents is not null)
  or (calculation_type in ('fixed', 'per_person') and amount_cents is not null)
);

comment on column public.deposit_policies.percentage_base_amount_cents is
  'Only used when calculation_type = ''percentage''. This product has no menu/order-total concept, so "20% deposit" has no natural base to apply to -- the restaurant sets an explicit estimated spend-per-person here instead. Deposit = percentage% of (this * party_size). Required (see deposit_policy_amount_present) whenever calculation_type = ''percentage''.';

alter table public.subscription_plans
  add column if not exists provider_price_id text;

comment on column public.subscription_plans.provider_price_id is
  'The Stripe Price id billed for this plan. NULL for the Enterprise placeholder row (custom/negotiated pricing, never a self-serve Stripe Price).';

-- ---------------------------------------------------------------------------
-- Seed the four plans from the blueprint's own pricing table (Part 11) --
-- this is reference data every environment needs, not demo data, so it
-- lives in a migration rather than supabase/seed.sql. provider_price_id is
-- left null everywhere: no real Stripe account exists to create Price
-- objects against in this sandbox (see this migration's own README section
-- for the full disclosure) -- populating real ids is a one-time manual step
-- the first time this runs against a real Stripe account.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, price_cents, billing_interval, currency, limits, is_active)
values
  ('starter', 'Starter', 5900, 'monthly', 'EUR',
   '{"max_restaurants":1,"max_tables":30,"max_staff":8,"ai_actions_included":0,"ai_voice_minutes_included":0,"deposits_enabled":false}'::jsonb, true),
  ('professional', 'Professional', 14900, 'monthly', 'EUR',
   '{"max_restaurants":1,"max_tables":60,"max_staff":20,"ai_actions_included":300,"ai_voice_minutes_included":0,"deposits_enabled":false}'::jsonb, true),
  ('business', 'Business', 29900, 'monthly', 'EUR',
   '{"max_restaurants":null,"max_tables":null,"max_staff":null,"ai_actions_included":1000,"ai_voice_minutes_included":0,"deposits_enabled":true,"per_location":true}'::jsonb, true),
  ('enterprise', 'Enterprise', 0, 'monthly', 'EUR',
   '{"max_restaurants":null,"max_tables":null,"max_staff":null,"ai_actions_included":null,"ai_voice_minutes_included":null,"deposits_enabled":true,"contact_sales":true}'::jsonb, true)
on conflict (code) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  limits = excluded.limits;

comment on table public.subscription_plans is
  'Reference data, seeded by 0019 from the blueprint''s own pricing table (Part 11). `limits` numbers are this project''s own starting point, explicitly meant to be tuned once real usage data exists -- not independently verified against any external benchmark. price_cents=0 on the enterprise row means "contact sales", not "free" (see limits.contact_sales).';

-- ---------------------------------------------------------------------------
-- Public read access to ACTIVE deposit policies -- a guest must be able to
-- see deposit/cancellation terms before booking. Same shape as 0014's
-- public restaurant/opening_hours read policies: anon and authenticated
-- both allowed, is_active filters out anything the restaurant turned off.
-- ---------------------------------------------------------------------------
create policy deposit_policies_public_select on public.deposit_policies for select
  using (is_active);

-- ---------------------------------------------------------------------------
-- compute_deposit_amount: which policy (if any) applies to a prospective
-- reservation, and how much it comes to. SECURITY INVOKER -- relies on the
-- caller's own read access to deposit_policies (staff via is_restaurant_
-- member, or anyone via the new public policy above), same reasoning 0013's
-- functions already use for availability lookups.
--
-- Specificity order when multiple active policies could apply: event >
-- vip > party_size_threshold > all. A restaurant is expected to keep at
-- most one ACTIVE policy per applies_to value in practice, but nothing in
-- the schema enforces that -- this order is what breaks a tie
-- deterministically rather than picking arbitrarily.
-- ---------------------------------------------------------------------------
create or replace function public.compute_deposit_amount(
  p_restaurant_id uuid,
  p_party_size    int,
  p_is_vip        boolean default false,
  p_event_id      uuid default null
)
returns table (policy_id uuid, amount_cents int)
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_policy public.deposit_policies%rowtype;
begin
  select * into v_policy
  from public.deposit_policies dp
  where dp.restaurant_id = p_restaurant_id
    and dp.is_active
    and (
      (dp.applies_to = 'event' and p_event_id is not null and exists (
        select 1 from public.events e where e.id = p_event_id and e.deposit_policy_id = dp.id
      ))
      or (dp.applies_to = 'vip' and p_is_vip)
      or (dp.applies_to = 'party_size_threshold' and dp.party_size_threshold is not null and p_party_size >= dp.party_size_threshold)
      or (dp.applies_to = 'all')
    )
  order by
    case dp.applies_to
      when 'event' then 1
      when 'vip' then 2
      when 'party_size_threshold' then 3
      when 'all' then 4
    end
  limit 1;

  if not found then
    return; -- no applicable policy: zero rows, meaning "no deposit required"
  end if;

  policy_id := v_policy.id;
  amount_cents := case v_policy.calculation_type
    when 'fixed' then v_policy.amount_cents
    when 'per_person' then v_policy.amount_cents * p_party_size
    when 'percentage' then round(v_policy.percentage_base_amount_cents * p_party_size * v_policy.percentage / 100.0)
  end;
  return next;
end;
$$;

grant execute on function public.compute_deposit_amount(uuid, int, boolean, uuid) to authenticated, anon;

comment on function public.compute_deposit_amount is
  'Which deposit_policies row (if any) applies to a prospective reservation, and the resulting amount_cents. Zero rows returned means no deposit required. Granted to anon too -- the public booking site must be able to show a deposit requirement BEFORE the guest commits, and to the create-deposit-payment-intent Edge Function so it never trusts a client-supplied amount.';

-- ---------------------------------------------------------------------------
-- evaluate_reservation_cancellation_refund: for each deposit-type payment on
-- a reservation that is still capturable or already captured, whether
-- cancelling THIS reservation RIGHT NOW would be refund-eligible, using the
-- window snapshot frozen on the payment itself (see this migration's header
-- comment, point 2) -- never the policy's CURRENT setting.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_reservation_cancellation_refund(p_reservation_id uuid)
returns table (payment_id uuid, payment_status public.payment_status, amount_cents int, refund_eligible boolean)
language sql
security invoker
set search_path = public
stable
as $$
  select
    p.id,
    p.status,
    p.amount_cents,
    (r.starts_at - make_interval(hours => coalesce(p.cancellation_window_hours_snapshot, 24))) > now()
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.reservation_id = p_reservation_id
    and p.payment_type = 'deposit'
    and p.status in ('requires_capture', 'succeeded');
$$;

-- authenticated only (not anon, unlike compute_deposit_amount above): RLS on
-- payments/reservations would return zero rows for anon anyway (owns_customer/
-- is_restaurant_member both require auth.uid()), so there is nothing a bare
-- guest could ever see through this -- but PostgreSQL grants EXECUTE on a
-- newly created function to PUBLIC by default, which would silently make
-- the "authenticated only" grant below a no-op (anon inherits from PUBLIC
-- too) -- caught by scripts/verify_phase12_payments_billing.sql's Test D4,
-- which found this function callable by anon before this REVOKE was added.
-- Explicit revoke first, same pattern 0018's find_customer_by_phone uses.
revoke all on function public.evaluate_reservation_cancellation_refund(uuid) from public;
grant execute on function public.evaluate_reservation_cancellation_refund(uuid) to authenticated;

comment on function public.evaluate_reservation_cancellation_refund is
  'For each deposit payment still capturable or already captured on this reservation: is cancelling it RIGHT NOW inside or outside the cancellation window frozen on the payment at creation time. Read-only decision support -- refund-deposit (Edge Function) is what actually calls Stripe and updates status.';
