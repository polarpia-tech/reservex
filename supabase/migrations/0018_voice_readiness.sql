-- =============================================================================
-- 0018_voice_readiness.sql
-- Phase 11: Voice -- interface/readiness ONLY, per the blueprint (Part 05:
-- "the AIProvider interface extends with STT/TTS... when we decide to build
-- a real phone receptionist, we plug the SAME AI Gateway into a phone line
-- instead of building a second reservation system"). This migration adds
-- the two small, genuinely useful pieces of schema a future phone/voice
-- integration will need -- nothing that pretends to be a working phone
-- receptionist.
--
-- Why a phone call is architecturally different from every previous
-- channel: staff_chat has an authenticated staff JWT (RLS applies
-- normally). customer_chat/the public booking site (Phase 08) at least has
-- a web session or an explicit form submission. An inbound phone call has
-- NEITHER -- the only "credential" is the caller's phone number, which is
-- trivially spoofable and was never an identity Postgres RLS can reason
-- about. This is why, like Phase 08's book_public_reservation and Phase
-- 10's ai-gateway, any real voice integration MUST run as an Edge Function
-- with a service-role client and its own hand-rolled authorization -- there
-- is no RLS policy shape that could safely let an anonymous phone caller
-- read or write anything directly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- restaurants.ai_voice_phone_number: the number a future Twilio (or
-- similar) integration would route to this restaurant's AI Gateway.
-- Deliberately a SEPARATE column from the existing `phone` (that is the
-- restaurant's own public contact number, answered by humans, and stays
-- untouched) -- a restaurant might pilot the AI receptionist on a second,
-- dedicated line without changing the number customers already know, or
-- may never enable it at all (hence nullable).
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists ai_voice_phone_number text;

create unique index if not exists uidx_restaurants_ai_voice_phone_number
  on public.restaurants(ai_voice_phone_number)
  where ai_voice_phone_number is not null;

comment on column public.restaurants.ai_voice_phone_number is
  'E.164 phone number (e.g. +49301234567) a future voice/phone AI integration would route inbound calls from, resolving which restaurant/tenant is being called. NULL = voice not enabled for this restaurant. Separate from the public-facing `phone` column on purpose -- see this migration''s header comment.';

-- ---------------------------------------------------------------------------
-- ai_conversations.caller_phone: records the inbound caller's number for
-- voice/whatsapp conversations, independent of whether it could be matched
-- to an existing customers row. Needed because customer_id can stay null
-- for a first-time caller (exactly like guest_* columns on reservations for
-- a first-time web booker, Phase 08) -- without this column, a voice
-- conversation from an unrecognized number would have no identity trace at
-- all, which is unacceptable for an audit trail.
-- ---------------------------------------------------------------------------
alter table public.ai_conversations
  add column if not exists caller_phone text;

comment on column public.ai_conversations.caller_phone is
  'The inbound phone number for voice/whatsapp channels (E.164), independent of whether it matched an existing customers row via find_customer_by_phone(). NULL for staff_chat/customer_chat, where identity comes from user_id/customer_id instead.';

-- ---------------------------------------------------------------------------
-- find_customer_by_phone: resolves an existing customer of THIS restaurant
-- from a raw phone number. SECURITY DEFINER because, as explained above, an
-- anonymous caller has no auth.uid() for owns_customer()/is_restaurant_
-- member() to check against -- there is no RLS-shaped way to do this.
--
-- Deliberately NOT granted to anon/authenticated (see the explicit revoke
-- below, which undoes Postgres' default "PUBLIC gets EXECUTE" grant). This
-- is not the same kind of helper as is_restaurant_member()/owns_customer()
-- (0011), which only ever return a boolean and are safe for any client to
-- indirectly trigger via an RLS policy. This function returns a customer_id
-- keyed by an arbitrary phone number string -- if any signed-in client
-- could call it directly, they could probe a restaurant's customer list by
-- phone number one guess at a time. Only the service-role client of a
-- future voice/whatsapp Edge Function is meant to call this.
-- ---------------------------------------------------------------------------
create or replace function public.find_customer_by_phone(p_restaurant_id uuid, p_phone text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select c.id
  from public.customers c
  join public.restaurant_customers rc on rc.customer_id = c.id
  where rc.restaurant_id = p_restaurant_id
    and c.phone = p_phone
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function public.find_customer_by_phone(uuid, text) from public;

comment on function public.find_customer_by_phone is
  'Resolves an existing customer of p_restaurant_id from a raw phone number. SECURITY DEFINER (no RLS identity exists for an anonymous phone caller) but deliberately NOT granted to anon/authenticated -- only a service-role client may call this, or any authenticated client could probe a restaurant''s customers by phone number. See this migration''s header comment.';
