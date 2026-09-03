import { fetchReservations } from '@reservex/core';
import { radii, spacing } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Day agenda view -- the reservation-engine equivalent of the tables tab's
 * floor view: the screen a host actually keeps open during service. Date
 * range is [local midnight, next local midnight), which relies on the same
 * "device timezone == restaurant timezone" MVP simplification documented in
 * new.tsx and the Phase 07 README section (staff work on-site).
 */
export default function ReservationsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;

  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));

  const range = useMemo(() => {
    const from = selectedDate;
    const to = addDays(selectedDate, 1);
    return { fromInclusive: from.toISOString(), toExclusive: to.toISOString() };
  }, [selectedDate]);

  const reservationsQuery = useQuery({
    queryKey: ['reservations', restaurantId, range.fromInclusive],
    queryFn: () => fetchReservations(supabase, restaurantId!, range),
    enabled: Boolean(restaurantId),
  });

  const dateLabel = selectedDate.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' });
  const isToday = selectedDate.getTime() === startOfDay(new Date()).getTime();

  return (
    <>
      <Stack.Screen
        options={{
          title: t('reservations.title'),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Link href="/(tabs)/reservations/waitlist" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel={t('waitlist.title')} style={styles.headerIcon}>
                  <Ionicons name="time-outline" color={theme.textPrimary} size={22} />
                </Pressable>
              </Link>
              <Link href="/(tabs)/reservations/new" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel={t('reservations.newReservation')} style={styles.headerIcon}>
                  <Ionicons name="add" color={theme.textPrimary} size={26} />
                </Pressable>
              </Link>
            </View>
          ),
        }}
      />
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.dateNav, { borderColor: theme.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('reservations.previousDay')} onPress={() => setSelectedDate((d) => addDays(d, -1))}>
            <Ionicons name="chevron-back" color={theme.textPrimary} size={22} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSelectedDate(startOfDay(new Date()))} style={styles.dateLabelWrap}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{isToday ? t('reservations.today') : dateLabel}</Text>
            {!isToday ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>{dateLabel}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('reservations.nextDay')} onPress={() => setSelectedDate((d) => addDays(d, 1))}>
            <Ionicons name="chevron-forward" color={theme.textPrimary} size={22} />
          </Pressable>
        </View>

        <FlatList
          data={reservationsQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={!reservationsQuery.isLoading ? <EmptyState icon="calendar-outline" label={t('reservations.noReservations')} /> : null}
          renderItem={({ item }) => {
            const time = new Date(item.startsAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
            const tableLabel =
              item.tables.length === 0
                ? t('reservations.noTablesAssigned')
                : item.tables.length === 1
                  ? item.tables[0].label
                  : `${t('reservations.combination')}: ${item.tables.map((tt) => tt.label).join(' + ')}`;
            return (
              <Pressable accessibilityRole="button" onPress={() => router.push(`/(tabs)/reservations/${item.id}`)}>
                <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <View style={styles.timeCol}>
                    <Text style={{ color: theme.textPrimary, fontWeight: '700' }}>{time}</Text>
                  </View>
                  <View style={styles.infoCol}>
                    <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{item.guestName ?? t('reservations.guestName')}</Text>
                    <Text style={{ color: theme.textMuted, marginTop: 2 }}>
                      {t('reservations.partySize')}: {item.partySize} Â· {tableLabel}
                    </Text>
                  </View>
                  <StatusPill status={item.status} label={t(`reservations.status.${item.status}`)} />
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: spacing.md },
  headerIcon: { padding: spacing.xs },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dateLabelWrap: { alignItems: 'center' },
  listContent: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['4xl'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeCol: { width: 56 },
  infoCol: { flex: 1 },
});