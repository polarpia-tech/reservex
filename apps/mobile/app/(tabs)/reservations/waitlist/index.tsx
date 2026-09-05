import { fetchWaitlist } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { AnimatedListItem } from '@/components/ui/AnimatedListItem';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Plain CRUD list -- no automatic "a table just freed up, notify this
 * guest" logic here. That needs the notification system (Phase 09), so
 * matching a freed table to a waiting guest is, for now, something a host
 * does by eye from this list and the reservations tab, then taps
 * "Convert to reservation" by hand. Honestly simple rather than fake-smart.
 */
export default function WaitlistScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;

  const waitlistQuery = useQuery({
    queryKey: ['waitlist', restaurantId],
    queryFn: () => fetchWaitlist(supabase, restaurantId!, ['waiting', 'notified']),
    enabled: Boolean(restaurantId),
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: t('waitlist.title'),
          headerRight: () => (
            <Link href="/(tabs)/reservations/waitlist/new" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel={t('waitlist.addEntry')} style={{ padding: spacing.xs }}>
                <Ionicons name="add" color={theme.textPrimary} size={26} />
              </Pressable>
            </Link>
          ),
        }}
      />
      {waitlistQuery.isLoading ? (
        <View style={[styles.content, { backgroundColor: theme.background }]}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.skeletonInfo}>
                <Skeleton width="50%" height={14} />
                <Skeleton width="80%" height={12} />
              </View>
              <Skeleton width={64} height={22} borderRadius={radii.full} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          style={{ backgroundColor: theme.background }}
          data={waitlistQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<EmptyState icon="hourglass-outline" label={t('waitlist.noEntries')} />}
          renderItem={({ item, index }) => {
            const from = new Date(item.requestedFrom).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
            const to = new Date(item.requestedTo).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
            return (
              <AnimatedListItem index={index}>
                <Pressable accessibilityRole="button" onPress={() => router.push(`/(tabs)/reservations/waitlist/${item.id}`)}>
                  <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{item.guestName ?? t('waitlist.guestName')}</Text>
                      <Text style={{ color: theme.textMuted, marginTop: 2 }}>
                        {item.requestedDate} · {from}–{to} · {t('reservations.partySize')}: {item.partySize}
                      </Text>
                    </View>
                    <StatusPill status={item.status} label={t(`waitlist.status.${item.status}`)} />
                  </View>
                </Pressable>
              </AnimatedListItem>
            );
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['4xl'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  skeletonInfo: { flex: 1, gap: spacing.xs },
});
