import { fetchMyNotificationPreferences, setNotificationPreference } from '@reservex/core';
import { spacing } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Only the 'in_app' channel is exposed here -- it's the only channel this
 * platform can actually deliver on right now (see the Phase 09 README).
 * Toggling push/email/sms/whatsapp preferences here would imply a working
 * dispatcher behind them that doesn't exist yet; that UI is deferred until
 * a real provider is wired up, rather than shipped as something that looks
 * functional but silently does nothing.
 *
 * Absence of a staff_notification_preferences row means "on" (the
 * platform default -- see should_notify_staff() in 0016), so every switch
 * here defaults to true until the staff member explicitly turns one off.
 */
const EVENT_TYPES = ['new_reservation', 'cancellation', 'no_show', 'reschedule'] as const;

export default function NotificationPreferencesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuth();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const queryKey = ['notification-preferences', restaurantId, user?.id];
  const preferencesQuery = useQuery({
    queryKey,
    queryFn: () => fetchMyNotificationPreferences(supabase, restaurantId!, user!.id),
    enabled: Boolean(restaurantId && user?.id),
  });

  const toggleMutation = useMutation({
    mutationFn: (args: { eventType: string; isEnabled: boolean }) =>
      setNotificationPreference(supabase, restaurantId!, user!.id, args.eventType, 'in_app', args.isEnabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  function isEnabled(eventType: string): boolean {
    const row = preferencesQuery.data?.find((p) => p.eventType === eventType && p.channel === 'in_app');
    return row?.isEnabled ?? true;
  }

  return (
    <>
      <Stack.Screen options={{ title: t('notifications.preferencesTitle') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textMuted }}>{t('notifications.preferencesSubtitle')}</Text>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {EVENT_TYPES.map((eventType, index) => (
            <View
              key={eventType}
              style={[styles.row, { borderColor: theme.border, borderBottomWidth: index === EVENT_TYPES.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
            >
              <Text style={{ color: theme.textPrimary, flex: 1 }}>{t(`notifications.eventTypes.${eventType}`)}</Text>
              <Switch
                value={isEnabled(eventType)}
                onValueChange={(next) => toggleMutation.mutate({ eventType, isEnabled: next })}
                trackColor={{ true: theme.accent }}
              />
            </View>
          ))}
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
});
