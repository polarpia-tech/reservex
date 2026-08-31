import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Notification,
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
  ReminderRule,
  StaffNotificationPreference,
  UUID,
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
