import { spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { durations, useReduceMotion } from '@/animation';
import { useTheme } from '@/theme/ThemeProvider';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * A shared empty-state treatment: a muted icon above a line of muted text,
 * instead of bare centered text alone. Every list screen in this app
 * (reservations, waitlist, tables) previously rendered its "nothing here"
 * state as plain <Text>, which is what made an empty day feel unfinished
 * rather than intentionally empty -- this is the fix, factored out once so
 * every list gets the same treatment instead of re-inventing it per screen.
 *
 * Phase 5 of the animation brief adds a gentle fade-in on mount (this
 * component only ever mounts once a list is confirmed empty, so there is
 * nothing to over-animate -- it appears once per screen visit, not on every
 * re-render), skipped entirely under Reduce Motion.
 */
export function EmptyState({ icon, label }: { icon: IoniconName; label: string }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View style={styles.container} entering={reduceMotion ? undefined : FadeIn.duration(durations.medium)}>
      <Ionicons name={icon} size={36} color={theme.textMuted} style={styles.icon} />
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing['4xl'] },
  icon: { opacity: 0.5 },
  label: { ...typeScale.body, textAlign: 'center' },
});
