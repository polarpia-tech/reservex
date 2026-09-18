import { deletePushToken, upsertPushToken } from '@reservex/core';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * Phase 23: real push notifications for staff (owner/manager/server) when
 * a new reservation comes in, even when nobody has the app open or the
 * shop's tablet is asleep -- see supabase/migrations/0044 for the
 * server/DB side and supabase/functions/dispatch-notifications for the
 * actual send. This file is the ONLY place in the mobile app that talks to
 * expo-notifications directly; everything else goes through the two
 * exported functions below.
 *
 * Foreground behavior: show the OS notification (banner/sound) even while
 * the app is open, not just in the background -- a busy server glancing
 * at another screen should still get the same buzz they'd get if the app
 * were closed. Must be registered at module scope (before any component
 * mounts) per expo-notifications' own contract.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Must match the `channelId` the dispatch-notifications Edge Function sets
 * on every push message it sends (see sendPush() there) -- Android ignores
 * sound/vibration passed directly on the message unless it also names a
 * channel that was created with those settings ahead of time. iOS has no
 * concept of channels; this is a no-op there.
 */
const ANDROID_CHANNEL_ID = 'reservations';

async function ensureAndroidChannelAsync(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Νέες κρατήσεις',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
}

/**
 * Requests OS notification permission if not already granted, and returns
 * this device's Expo push token -- or null if permission was denied, or
 * this is a simulator/emulator (Device.isDevice is false; simulators
 * cannot receive real remote push, per Expo's own docs). Never throws:
 * a permission denial or missing-project-id misconfiguration is reported
 * as "no token", left for the caller to simply skip registration for.
 */
async function getExpoPushTokenAsync(): Promise<string | null> {
  if (!Device.isDevice) return null;

  await ensureAndroidChannelAsync();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn('getExpoPushTokenAsync: no EAS projectId in app config, cannot obtain a push token.');
    return null;
  }

  try {
    const response = await Notifications.getExpoPushTokenAsync({ projectId });
    return response.data;
  } catch (err) {
    console.warn('getExpoPushTokenAsync: failed to obtain a push token', err);
    return null;
  }
}

/**
 * Call once a user is signed in (see app/_layout.tsx) -- requests
 * notification permission if needed and saves this device's token against
 * their account. Safe to call on every app foreground/session change: a
 * denied permission or a simulator just results in a harmless no-op, and
 * re-saving the SAME token for a device that already registered is an
 * upsert (0044's push_tokens_owner_all + unique(expo_push_token)), not a
 * duplicate.
 */
export async function syncPushTokenForCurrentUserAsync(userId: string): Promise<void> {
  const token = await getExpoPushTokenAsync();
  if (!token) return;

  try {
    await upsertPushToken(supabase, userId, token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch (err) {
    // Never let a push-registration failure surface as a user-facing error
    // -- the rest of the app works fine without it, this staff member just
    // won't get phone notifications until it succeeds on a later attempt.
    console.warn('syncPushTokenForCurrentUserAsync: failed to save push token', err);
  }
}

/**
 * Call right before signing out (see AuthProvider.signOut) -- removes THIS
 * device's token so a shared/handed-back device stops waking up for a
 * user who is no longer signed in on it. Deliberately swallows every
 * error: cleanup here is best-effort and must never block sign-out itself
 * (a stale token left behind after a failed delete is a minor annoyance,
 * not a security issue -- push_tokens_owner_all still means only THAT
 * user's client could ever have written it).
 */
export async function clearPushTokenForCurrentDeviceAsync(): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId || !Device.isDevice) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (data) await deletePushToken(supabase, data);
  } catch {
    // Best-effort only -- see doc comment above.
  }
}
