-- =============================================================================
-- 0009_ai.sql
-- Purpose: the AI layer's own memory -- conversations, individual messages
-- (including tool calls), and a durable, auditable record of every action
-- the AI proposed and/or executed. This is what makes the AI Gateway
-- reviewable: nothing it does is invisible.
-- =============================================================================

create type public.ai_channel as enum ('staff_chat', 'customer_chat', 'voice', 'whatsapp');
create type public.ai_message_role as enum ('user', 'assistant', 'tool');
create type public.ai_action_status as enum ('proposed', 'confirmed', 'executed', 'rejected', 'failed');

-- ---------------------------------------------------------------------------
-- ai_conversations
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid references public.restaurants(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,   -- set for staff_chat
  customer_id    uuid references public.customers(id) on delete set null, -- set for customer_chat/voice/whatsapp
  channel        public.ai_channel not null default 'staff_chat',
  locale         text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),

  constraint ai_conversations_one_party check (
    (channel = 'staff_chat' and user_id is not null)
    or
    (channel in ('customer_chat', 'voice', 'whatsapp'))
  )
);

create index idx_ai_conversations_restaurant on public.ai_conversations(restaurant_id);
create index idx_ai_conversations_user on public.ai_conversations(user_id);
create index idx_ai_conversations_customer on public.ai_conversations(customer_id);

-- ---------------------------------------------------------------------------
-- ai_messages: the transcript, including tool calls/results.
-- ---------------------------------------------------------------------------
create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  role             public.ai_message_role not null,
  content          text,
  tool_name        text,           -- set when role = 'tool' (or assistant requested a tool call)
  tool_input       jsonb,
  tool_output      jsonb,
  created_at       timestamptz not null default now()
);

create index idx_ai_messages_conversation on public.ai_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- ai_actions: one row per controlled tool call the AI made, independent of
-- the message transcript, so "show me every destructive action the AI took
-- this month" is a simple, fast query rather than a jsonb scan over messages.
-- ---------------------------------------------------------------------------
create table public.ai_actions (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid references public.ai_conversations(id) on delete set null,
  restaurant_id          uuid references public.restaurants(id) on delete cascade,
  tool_name              text not null,          -- e.g. 'createReservation', 'cancelReservation'
  input                  jsonb not null default '{}'::jsonb,
  requires_confirmation  boolean not null default false,
  status                 public.ai_action_status not null default 'proposed',
  confirmed_by_user_id   uuid references auth.users(id) on delete set null,
  confirmed_at           timestamptz,
  executed_at            timestamptz,
  result                 jsonb,
  error_message          text,
  created_at             timestamptz not null default now()
);

create index idx_ai_actions_restaurant on public.ai_actions(restaurant_id, created_at desc);
create index idx_ai_actions_conversation on public.ai_actions(conversation_id);
create index idx_ai_actions_pending_confirmation
  on public.ai_actions(restaurant_id)
  where status = 'proposed' and requires_confirmation;

comment on table public.ai_actions is
  'Every controlled tool call the AI Gateway made, whether read-only or destructive. requires_confirmation + status trace the confirm-before-execute flow described in the blueprint.';
