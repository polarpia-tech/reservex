-- =============================================================================
-- 0007_payments_and_subscriptions.sql
-- Purpose: (a) restaurant-side money -- deposit policies and payments taken
-- from guests, and (b) platform-side money -- what each organization pays us.
-- No card data is ever stored here: only references to a payment provider
-- (Stripe) via provider_payment_id.
-- =============================================================================

create type public.deposit_applies_to as enum ('all', 'event', 'vip', 'party_size_threshold');
create type public.deposit_calc_type as enum ('fixed', 'per_person', 'percentage');

create table public.deposit_policies (
  id                        uuid primary key default gen_random_uuid(),
  restaurant_id             uuid not null references public.restaurants(id) on delete cascade,
  name                      text not null,
  applies_to                public.deposit_applies_to not null default 'all',
  calculation_type          public.deposit_calc_type not null default 'fixed',
  amount_cents              int check (amount_cents >= 0),        -- used for 'fixed' and 'per_person'
  percentage                numeric(5,2) check (percentage between 0 and 100), -- used for 'percentage'
  party_size_threshold      int,                                  -- used when applies_to = 'party_size_threshold'
  cancellation_window_hours int not null default 24,
  refund_policy_text        text,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint deposit_policy_amount_present check (
    (calculation_type = 'percentage' and percentage is not null)
    or (calculation_type in ('fixed', 'per_person') and amount_cents is not null)
  )
);

create trigger trg_deposit_policies_updated_at
  before update on public.deposit_policies
  for each row execute function public.set_updated_at();

create index idx_deposit_policies_restaurant on public.deposit_policies(restaurant_id) where is_active;

-- Now that deposit_policies exists, wire it onto events (created in 0004).
alter table public.events
  add column deposit_policy_id uuid references public.deposit_policies(id) on delete set null;

-- ---------------------------------------------------------------------------
-- payments: money moved for a reservation/event (deposit, no-show charge,
-- refund). Provider-agnostic shape; today's implementation is Stripe.
-- ---------------------------------------------------------------------------
create type public.payment_type as enum ('deposit', 'no_show_charge', 'refund', 'event_ticket');
create type public.payment_status as enum (
  'requires_action', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled'
);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  reservation_id      uuid references public.reservations(id) on delete set null,
  customer_id         uuid references public.customers(id) on delete set null,
  provider            text not null default 'stripe',
  provider_payment_id text,                 -- e.g. Stripe PaymentIntent id -- never a card number
  payment_type        public.payment_type not null,
  status              public.payment_status not null default 'requires_action',
  amount_cents        int not null check (amount_cents >= 0),
  currency            char(3) not null default 'EUR',
  failure_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create index idx_payments_restaurant on public.payments(restaurant_id);
create index idx_payments_reservation on public.payments(reservation_id);
create unique index uidx_payments_provider_ref on public.payments(provider, provider_payment_id) where provider_payment_id is not null;

comment on table public.payments is
  'A record of money moved via an external provider. We store only the provider reference, never card data (PCI scope stays with the provider).';

-- ---------------------------------------------------------------------------
-- subscription_plans / subscriptions: what an ORGANIZATION pays the
-- platform. Plan limits live in one jsonb column so new limits can be added
-- without a migration -- see Part 11 of the product blueprint for the
-- actual Starter/Professional/Business/Enterprise numbers.
-- ---------------------------------------------------------------------------
create type public.billing_interval as enum ('monthly', 'yearly');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'paused');

create table public.subscription_plans (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,     -- 'starter' | 'professional' | 'business' | 'enterprise'
  name              text not null,
  price_cents       int not null check (price_cents >= 0),
  billing_interval  public.billing_interval not null default 'monthly',
  currency          char(3) not null default 'EUR',
  -- e.g. {"max_restaurants":1,"max_tables":20,"max_staff":5,"ai_actions_included":300,"ai_voice_minutes_included":0}
  limits            jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_subscription_plans_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  plan_id                 uuid not null references public.subscription_plans(id),
  status                  public.subscription_status not null default 'trialing',
  provider_subscription_id text,             -- Stripe subscription id
  trial_ends_at           timestamptz,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index idx_subscriptions_org on public.subscriptions(organization_id);
create unique index uidx_subscriptions_active_per_org
  on public.subscriptions(organization_id)
  where status in ('trialing', 'active', 'past_due');

comment on index uidx_subscriptions_active_per_org is
  'An organization may only have one non-terminal subscription at a time.';
