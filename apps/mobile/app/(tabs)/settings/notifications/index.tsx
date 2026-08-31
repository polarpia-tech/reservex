import { fetchMyStaffNotifications, markNotificationRead, type Notification } from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The in-app inbox -- every notification queued for THIS user, across
 * every restaurant they belong to (fetchMyStaffNotifications filters by
 * recipient_user_id, not by the currently-active restaurant). New in
 * Phase 09: this table (public.notifications, Phase 02) sat unused by any
 * screen until migration 0016 started actually writing to it on
 * new/cancelled/no-show/rescheduled reservations -- see the README.
 *
 * "Unread" here means status is anything other than 'read' (queued/sent/
 * delivered all count as unread) -- an in_app row is created as
 * 'delivered' already (see 0016's queue_notification()), since the inbox
 * IS the delivery mechanism for that channel; there is no separate
 * "sent" step to wait for.
 */
export default function NotificationsInboxScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuth();
  const { isOwnerOrManager } = useMyRestaurant();
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ['my-notifications', user?.id],
    queryFn: () => fetchMyStaffNotifications(supabase, user!.id),
    enabled: Boolean(user?.id),
  });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(supabase, notificationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-notifications', user?.id] }),
  });

  return (
    <>
      <Stack.Screen options={{ title: t('notifications.inboxTitle') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {isOwnerOrManager ? (
          <View style={styles.linkRow}>
            <Link href="/(tabs)/settings/notifications/preferences" style={[styles.link, { color: theme.accent }]}>
              {t('notifications.preferencesTitle')}
            </Link>
            <Link href="/(tabs)/settings/notifications/reminder-rules" style={[styles.link, { color: theme.accent }]}>
              {t('notifications.reminderRulesTitle')}
            </Link>
          </View>
        ) : (
          <Link href="/(tabs)/settings/notifications/preferences" style={[styles.link, { color: theme.accent }]}>
            {t('notifications.preferencesTitle')}
          </Link>
        )}

        {inboxQuery.isLoading ? <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text> : null}
        {inboxQuery.data?.length === 0 ? <Text style={{ color: theme.textMuted }}>{t('notifications.noNotifications')}</Text> : null}

        {(inboxQuery.data ?? []).map((notification: Notification) => {
          const isUnread = notification.status !== 'read';
          return (
            <Pressable
              key={notification.id}
              accessibilityRole="button"
              onPress={() => isUnread && markReadMutation.mutate(notification.id)}
            >
              <Card style={styles.row}>
                {isUnread ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : <View style={styles.dotPlaceholder} />}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.textPrimary, fontWeight: isUnread ? '700' : '400' }}>
                    {t(`notifications.templates.${notification.templateCode}`, notification.templateCode)}
                  </Text>
                  <Text style={{ color: theme.textMuted, marginTop: spacing.xs, fontSize: typeScale.caption.size }}>
                    {new Date(notification.createdAt).toLocaleString()}
                  </Text>
                </View>
                {isUnread ? <Ionicons name="checkmark-circle-outline" color={theme.textMuted} size={20} /> : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  linkRow: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.sm },
  link: { fontSize: typeScale.label.size, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotPlaceholder: { width: 8, height: 8, borderRadius: radii.full },
});
