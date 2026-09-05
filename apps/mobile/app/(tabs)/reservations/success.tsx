import { Ionicons } from '@expo/vector-icons';
import { radii, spacing, typeScale } from '@reservex/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { durations, easings, springs, useReduceMotion } from '@/animation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Item 8 of the animation brief: today, new.tsx's bookMutation.onSuccess
 * just called router.back() with no confirmation at all -- a real, existing
 * UX gap, not just a missing animation. This screen fills it. It is pushed
 * with router.replace (see new.tsx) so it takes new.tsx's place in the
 * stack -- dismissing it (the Done button, or the hardware/gesture back
 * action) returns straight to the day agenda, never back through the form.
 *
 * All the details shown here (restaurant name, date, time, party size, guest
 * name) come from the booking form's own state at the moment it submitted
 * successfully -- passed through as route params -- not a second fetch, so
 * there is nothing here that could show stale or placeholder data.
 */
export default function ReservationSuccessScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{
    restaurantName?: string;
    date?: string;
    time?: string;
    partySize?: string;
    guestName?: string;
  }>();

  const checkOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const checkScale = useSharedValue(reduceMotion ? 1 : 0);
  const detailsOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const detailsTranslateY = useSharedValue(reduceMotion ? 0 : 12);

  useEffect(() => {
    if (reduceMotion) return; // shared values already start at their end state
    checkOpacity.value = withTiming(1, { duration: durations.short, easing: easings.standard });
    checkScale.value = withSpring(1, springs.bouncy);
    detailsOpacity.value = withDelay(durations.short, withTiming(1, { duration: durations.medium, easing: easings.decelerate }));
    detailsTranslateY.value = withDelay(durations.short, withTiming(0, { duration: durations.medium, easing: easings.decelerate }));
    // Shared values are stable Reanimated refs; only reduceMotion should ever re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));
  const detailsStyle = useAnimatedStyle(() => ({
    opacity: detailsOpacity.value,
    transform: [{ translateY: detailsTranslateY.value }],
  }));

  const dateLabel = params.date
    ? new Date(`${params.date}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })
    : '';

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Animated.View style={[styles.checkCircle, { backgroundColor: theme.success }, checkStyle]}>
          <Ionicons name="checkmark" size={44} color={theme.background} />
        </Animated.View>

        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('reservations.success.title')}</Text>

        <Animated.View style={[styles.detailsWrap, detailsStyle]}>
          <Card style={styles.card}>
            <DetailRow label={t('reservations.success.restaurant')} value={params.restaurantName ?? ''} />
            <DetailRow label={t('reservations.date')} value={dateLabel} />
            <DetailRow label={t('reservations.time')} value={params.time ?? ''} />
            <DetailRow label={t('reservations.partySize')} value={params.partySize ?? ''} />
            {params.guestName ? <DetailRow label={t('reservations.guestName')} value={params.guestName} /> : null}
          </Card>
        </Animated.View>

        <View style={styles.footer}>
          <Button label={t('common.done')} onPress={() => router.back()} />
        </View>
      </View>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={{ color: theme.textMuted }}>{label}</Text>
      <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  checkCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typeScale.h2, textAlign: 'center' },
  detailsWrap: { width: '100%' },
  card: { gap: spacing.sm, borderRadius: radii.lg },
  footer: { width: '100%' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
});
