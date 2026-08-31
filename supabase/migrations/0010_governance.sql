-- =============================================================================
-- 0010_governance.sql
-- Purpose: platform-wide accountability (audit_logs) and controlled rollout
-- of new/experimental functionality (feature_flags).
-- =============================================================================

create type public.audit_actor_type as enum ('user', 'ai', 'system');

-- ---------------------------------------------------------------------------
-- audit_logs: append-only. Nothing ever updates or deletes a row here.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete set null,
  restaurant_id    uuid references public.restaurants(id) on delete set null,
  actor_type       public.audit_actor_type not null,
  actor_user_id    uuid references auth.users(id) on delete set null,
  -- dot-namespaced, e.g. 'reservation.created', 'reservation.cancelled_bulk',
  -- 'payment.refunded', 'restaurant_user.role_changed', 'ai_action.executed'
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  before_data      jsonb,
  after_data       jsonb,
  created_at       timestamptz not null default now()
);

create index idx_audit_logs_restaurant on public.audit_logs(restaurant_id, created_at desc);
create index idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index idx_audit_logs_actor on public.audit_logs(actor_user_id);

comment on table public.audit_logs is
  'Append-only record of every sensitive operation, whichever of user/AI/system performed it. Never store secrets or full payment payloads here.';

-- ---------------------------------------------------------------------------
-- feature_flags: platform-level definition + default rollout.
-- feature_flag_overrides: per-organization or per-restaurant override.
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  id                   uuid primary key default gen_random_uuid(),
  key                  text not null unique,     -- e.g. 'ai_voice_assistant', 'waitlist_v2'
  description          text,
  is_enabled_default   boolean not null default false,
  rollout_percentage   smallint not null default 0 check (rollout_percentage between 0 and 100),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

create table public.feature_flag_overrides (
  id               uuid primary key default gen_random_uuid(),
  flag_id          uuid not null references public.feature_flags(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete cascade,
  restaurant_id    uuid references public.restaurants(id) on delete cascade,
  is_enabled       boolean not null,
  created_at       timestamptz not null default now(),

  constraint feature_flag_override_target check (
    (organization_id is not null and restaurant_id is null)
    or
    (organization_id is null and restaurant_id is not null)
  )
);

create unique index uidx_flag_override_org
  on public.feature_flag_overrides(flag_id, organization_id) where organization_id is not null;
create unique index uidx_flag_override_restaurant
  on public.feature_flag_overrides(flag_id, restaurant_id) where restaurant_id is not null;

comment on table public.feature_flag_overrides is
  'Per-organization or per-restaurant override of a flags default -- e.g. turning on a beta AI feature for one pilot restaurant only.';
