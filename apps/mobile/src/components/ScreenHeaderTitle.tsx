import { typeScale } from '@reservex/ui';
import { StyleSheet, Text, View } from 'react-native';

import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Replaces the plain string `title` on a screen's header with two lines:
 * the restaurant's own name (small, muted, uppercase) sitting above the
 * screen's title (same size/weight React Navigation's default header title
 * would use). Requested explicitly so staff always see, at a glance, which
 * restaurant's data they're looking at -- this app is single-tenant per
 * signed-in staff member today (see useMyRestaurant's MVP note), but a
 * second location is one Supabase row away, and the header should not lie
 * about that by omission.
 *
 * Deliberately used only on the 4 main tab-root screens (reservations,
 * tables, settings, ai) -- not on every pushed sub-screen -- since those
 * already read as "inside" a section the user just opened from one of
 * these roots, and repeating the restaurant name on every single screen
 * would be visual noise rather than useful orientation.
 *
 * If the restaurant membership hasn't loaded yet (or genuinely doesn't
 * exist), this quietly falls back to rendering just the screen title --
 * exactly what every screen already showed before this component existed --
 * rather than showing an empty line or a loading placeholder.
 */
export function ScreenHeaderTitle({ title }: { title: string }) {
  const theme = useTheme();
  const { membership } = useMyRestaurant();
  const restaurantName = membership?.restaurant.name;

  return (
    <View style={styles.container}>
      {restaurantName ? (
        <Text style={[styles.restaurantName, { color: theme.textMuted }]} numberOfLines={1}>
          {restaurantName}
        </Text>
      ) : null}
      <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start', gap: 1 },
  restaurantName: {
    ...typeScale.label,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: {
    ...typeScale.h3,
  },
});
