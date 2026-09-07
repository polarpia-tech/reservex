import { fetchOwnerConfigurableFlags, setOwnerFeatureFlag } from '@reservex/core';
import { spacing } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Phase 6 of the Live Availability upgrade: the owner-facing settings
 * screen for the feature_flags an owner/manager is allowed to self-toggle
 * (feature_flags.is_owner_configurable, migration 0028) -- as of this
 * phase, that's exactly one: 'live_availability' (Phase 3's public
 * per-time-slot table availability widget on the booking page). This
 * screen is deliberately built to grow: every future Live-Availability-
 * epic flag (waitlist_public, live_occupancy, last_minute_alerts,
 * popularity_indicator -- all seeded already in 0023, all still
 * platform-admin-only today) gets its own row here automatically, the day
 * its own phase marks it is_owner_configurable = true. No UI change will
 * be needed then -- fetchOwnerConfigurableFlags() already returns
 * whatever the database currently allows.
 *
 * Same Switch/Card/row shape as notifications/preferences.tsx, this
 * project's existing precedent for "a list of on/off toggles" -- reused
 * deliberately rather than inventing a second toggle-row style.
 */
export default function LiveFeaturesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const organizationId = membership?.restaurant.organizationId;
  const queryClient = useQueryClient();

  const queryKey = ['owner-feature-flags', restaurantId];
  const flagsQuery = useQuery({
    queryKey,
    queryFn: () => fetchOwnerConfigurableFlags(supabase, restaurantId!, organizationId!),
    enabled: Boolean(restaurantId && organizationId),
  });

  const toggleMutation = useMutation({
    mutationFn: (args: { flagId: string; isEnabled: boolean }) => setOwnerFeatureFlag(supabase, restaurantId!, args.flagId, args.isEnabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const flags = flagsQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('settings.liveFeatures') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textMuted }}>{t('settings.liveFeaturesSubtitle')}</Text>

        {flagsQuery.isLoading ? (
          <Card style={{ gap: spacing.md }}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="100%" height={12} />
          </Card>
        ) : flags.length === 0 ? (
          <EmptyState icon="flash-outline" label={t('settings.liveFeaturesEmpty')} />
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {flags.map((entry, index) => {
              const loading = toggleMutation.isPending && toggleMutation.variables?.flagId === entry.flag.id;
              return (
                <View
                  key={entry.flag.id}
                  style={[styles.row, { borderColor: theme.border, borderBottomWidth: index === flags.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
                >
                  <View style={{ flex: 1, marginRight: spacing.md }}>
                    <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t(`settings.liveFeaturesFlags.${entry.flag.key}.label`)}</Text>
                    <Text style={{ color: theme.textMuted, marginTop: 2 }}>{t(`settings.liveFeaturesFlags.${entry.flag.key}.description`)}</Text>
                  </View>
                  <Switch
                    value={entry.isEnabled}
                    disabled={loading}
                    onValueChange={(next) => toggleMutation.mutate({ flagId: entry.flag.id, isEnabled: next })}
                    trackColor={{ true: theme.accent }}
                  />
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
});
