import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Notification,
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
  PushToken,
  PushTokenPlatform,
  ReminderRule,
  StaffNotificationPreference,
  StaffWebPushSubscription,
  UUID,
  WebPushSubscriptionJSON,
} from '../types/database';

// ---------------------------------------------------------------------------
// Phase 09: the staff-facing side of notifications (migration 0016) --
// the in-app inbox, reminder rule management, and per-event notification
// preferences. The customer-facing inbox equivalent
// (fetchMyNotificationsAsCustomer) lives in api/customerAccount.ts instead,
// next to the rest of that file's customer-identity helpers.
//
// IMPORTANT: there is NO createNotification()/sendNotification() function
// here, on purpose. queue_notification() (0016) is SECURITY DEFINER and is
// the only thing that ever inserts into public.notifications -- it is
// called exclusively from the reservations trigger (new/cancelled/no-show/
// rescheduled) and from schedule_reservation_reminders(). No client-side
// code path should ever construct a notification directly; there isn't
// even an RLS grant that would let it.
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  restaurant_id: string | null;
  recipient_type: NotificationRecipientType;
  recipient_customer_id: string | null;
  recipient_user_id: string | null;
  channel: NotificationChannel;
  template_code: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  reservation_id: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  created_at: string;
}

function mapNotificationRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    recipientType: row.recipient_type,
    recipientCustomerId: row.recipient_customer_id,
    recipientUserId: row.recipient_user_id,
    channel: row.channel,
    templateCode: row.template_code,
    payload: row.payload ?? {},
    status: row.status,
    reservationId: row.reservation_id,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/**
 * A staff member's own in-app inbox -- every notification queued for them,
 * across whichever restaurant(s) they belong to, newest first. Relies on
 * notifications_select (0011): `recipient_user_id = auth.uid()` -- one of
 * three OR'd clauses on that policy, the other two being the customer
 * equivalent and `is_restaurant_member` (which is why a colleague's
 * notification is also visible to any staff member of the same
 * restaurant -- see 0016's README note on why the inbox nonetheless only
 * lets a recipient mark THEIR OWN row read). This query only ever returns
 * rows where recipientUserId IS this user, whatever else RLS would allow
 * them to see.
 */
export async function fetchMyStaffNotifications(client: SupabaseClient, userId: UUID): Promise<Notification[]> {
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as NotificationRow[]).map(mapNotificationRow);
}

/**
 * Flips one notification to status='read'. Works for a staff recipient or
 * a customer recipient alike -- notifications_recipient_mark_read (0016)
 * covers both in one policy. Deliberately the only status transition this
 * function (or any client) can ever make: the policy's WITH CHECK rejects
 * anything but 'read'.
 */
export async function markNotificationRead(client: SupabaseClient, notificationId: UUID): Promise<void> {
  const { error } = await client.from('notifications').update({ status: 'read' }).eq('id', notificationId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// staff_notification_preferences -- who on staff wants to hear about what,
// on which channel. Absence of a row = platform default (currently: ON for
// 'in_app' -- see should_notify_staff() in 0016).
// ---------------------------------------------------------------------------
interface StaffNotificationPreferenceRow {
  id: string;
  restaurant_id: string;
  user_id: string;
  event_type: string;
  channel: NotificationChannel;
  is_enabled: boolean;
}

function mapPreferenceRow(row: StaffNotificationPreferenceRow): StaffNotificationPreference {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    userId: row.user_id,
    eventType: row.event_type,
    channel: row.channel,
    isEnabled: row.is_enabled,
  };
}

/** Every explicit preference row a staff member has set for one restaurant -- an EMPTY result does not mean "notifications off", it means every event type is still at the platform default (on). */
export async function fetchMyNotificationPreferences(client: SupabaseClient, restaurantId: UUID, userId: UUID): Promise<StaffNotificationPreference[]> {
  const { data, error } = await client
    .from('staff_notification_preferences')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId);
  if (error) throw error;
  return (data as StaffNotificationPreferenceRow[]).map(mapPreferenceRow);
}

/** Sets (creating or overwriting) one (event_type, channel) preference for the CALLING user only -- staff_notification_preferences_all's RLS (0011) lets anyone manage their own row, or an owner/manager manage anyone's. */
export async function setNotificationPreference(
  client: SupabaseClient,
  restaurantId: UUID,
  userId: UUID,
  eventType: string,
  channel: NotificationChannel,
  isEnabled: boolean,
): Promise<StaffNotificationPreference> {
  const { data, error } = await client
    .from('staff_notification_preferences')
    .upsert(
      { restaurant_id: restaurantId, user_id: userId, event_type: eventType, channel, is_enabled: isEnabled },
      { onConflict: 'restaurant_id,user_id,event_type,channel' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return mapPreferenceRow(data as StaffNotificationPreferenceRow);
}

// ---------------------------------------------------------------------------
// reminder_rules -- owner/manager only (reminder_rules_write, 0011).
// ---------------------------------------------------------------------------
interface ReminderRuleRow {
  id: string;
  restaurant_id: string;
  name: string;
  minutes_before_start: number;
  channel: NotificationChannel;
  is_active: boolean;
}

function mapReminderRuleRow(row: ReminderRuleRow): ReminderRule {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    minutesBeforeStart: row.minutes_before_start,
    channel: row.channel,
    isActive: row.is_active,
  };
}

export async function fetchReminderRules(client: SupabaseClient, restaurantId: UUID): Promise<ReminderRule[]> {
  const { data, error } = await client
    .from('reminder_rules')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('minutes_before_start', { ascending: true });
  if (error) throw error;
  return (data as ReminderRuleRow[]).map(mapReminderRuleRow);
}

export interface ReminderRuleInput {
  name: string;
  minutesBeforeStart: number;
  channel: NotificationChannel;
  isActive: boolean;
}

export async function createReminderRule(client: SupabaseClient, restaurantId: UUID, input: ReminderRuleInput): Promise<ReminderRule> {
  const { data, error } = await client
    .from('reminder_rules')
    .insert({
      restaurant_id: restaurantId,
      name: input.name,
      minutes_before_start: input.minutesBeforeStart,
      channel: input.channel,
      is_active: input.isActive,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapReminderRuleRow(data as ReminderRuleRow);
}

export async function updateReminderRule(client: SupabaseClient, ruleId: UUID, input: Partial<ReminderRuleInput>): Promise<ReminderRule> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.minutesBeforeStart !== undefined) payload.minutes_before_start = input.minutesBeforeStart;
  if (input.channel !== undefined) payload.channel = input.channel;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  const { data, error } = await client.from('reminder_rules').update(payload).eq('id', ruleId).select('*').single();
  if (error) throw error;
  return mapReminderRuleRow(data as ReminderRuleRow);
}

/**
 * Hard delete, same reasoning as deleteTableCombination (Phase 07): a
 * reminder rule is a pure scheduling config, not something reservation
 * history points back to (schedule_reservation_reminders reads
 * reminder_rules at booking time and copies what it needs -- name/channel/
 * minutes -- into each queued notification's own payload, so deleting the
 * rule afterward never orphans anything already queued).
 */
export async function deleteReminderRule(client: SupabaseClient, ruleId: UUID): Promise<void> {
  const { error } = await client.from('reminder_rules').delete().eq('id', ruleId);
  if (error) throw error;
}


// ---------------------------------------------------------------------------
// push_tokens (Phase 23, migration 0044) -- registering/removing THIS
// device's Expo push token for the signed-in staff member. Called from
// apps/mobile/src/services/pushNotifications.ts only; nothing else in the
// app should touch this table directly, same discipline as this file's own
// header note about queue_notification.
// ---------------------------------------------------------------------------
interface PushTokenRow {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: PushTokenPlatform;
  created_at: string;
  updated_at: string;
}

function mapPushTokenRow(row: PushTokenRow): PushToken {
  return {
    id: row.id,
    userId: row.user_id,
    expoPushToken: row.expo_push_token,
    platform: row.platform,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Registers (or refreshes) this device's push token for the CALLING user --
 * push_tokens_owner_all (0044) only ever lets a user write user_id =
 * auth.uid(), so userId here must be the signed-in user's own id.
 * onConflict on expo_push_token means calling this again with the SAME
 * token (e.g. every app foreground, to be safe) just bumps updated_at
 * instead of erroring or duplicating.
 */
export async function upsertPushToken(client: SupabaseClient, userId: UUID, expoPushToken: string, platform: PushTokenPlatform): Promise<PushToken> {
  const { data, error } = await client
    .from('push_tokens')
    .upsert({ user_id: userId, expo_push_token: expoPushToken, platform }, { onConflict: 'expo_push_token' })
    .select('*')
    .single();
  if (error) throw error;
  return mapPushTokenRow(data as PushTokenRow);
}

/** Removes THIS device's token, e.g. on sign-out -- so a shared/handed-down device stops being woken up for a user who is no longer signed in on it. Best-effort by design (see pushNotifications.ts): never let this block sign-out. */
export async function deletePushToken(client: SupabaseClient, expoPushToken: string): Promise<void> {
  const { error } = await client.from('push_tokens').delete().eq('expo_push_token', expoPushToken);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// staff_web_push_subscriptions (Phase 24, migration 0045) -- the iPhone/
// desktop counterpart to push_tokens above. Called from apps/web's /staff
// page (src/lib/webPush.ts's requestWebPushSubscription() gets the browser
// subscription; this just persists it) -- nothing else should touch this
// table directly, same discipline as push_tokens.
// ---------------------------------------------------------------------------
interface StaffWebPushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
  updated_at: string;
}

function mapStaffWebPushSubscriptionRow(row: StaffWebPushSubscriptionRow): StaffWebPushSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Registers (or refreshes) this browser installation's Web Push
 * subscription for the CALLING user -- staff_web_push_subscriptions_owner_all
 * (0045) only ever lets a user write user_id = auth.uid(), so userId here
 * must be the signed-in user's own id. onConflict on endpoint means
 * re-subscribing the same installation just bumps updated_at instead of
 * erroring or duplicating.
 */
export async function upsertStaffWebPushSubscription(
  client: SupabaseClient,
  userId: UUID,
  subscription: WebPushSubscriptionJSON,
): Promise<StaffWebPushSubscription> {
  const { data, error } = await client
    .from('staff_web_push_subscriptions')
    .upsert(
      { user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      { onConflict: 'endpoint' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return mapStaffWebPushSubscriptionRow(data as StaffWebPushSubscriptionRow);
}

/** Removes THIS installation's subscription, e.g. on sign-out. Best-effort by design, same as deletePushToken: never let this block sign-out. */
export async function deleteStaffWebPushSubscription(client: SupabaseClient, endpoint: string): Promise<void> {
  const { error } = await client.from('staff_web_push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}
