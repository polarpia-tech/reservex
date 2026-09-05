import type { ReactNode } from 'react';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { durations, useReduceMotion } from '@/animation';

/**
 * Item 15 of the animation brief: list rows should arrive staggered, not
 * all at once. Reanimated's `entering` prop on Animated.View plays once per
 * mounted element (keyed by React's own reconciliation) -- so a row that is
 * merely re-rendered (a query refetch returning the same items) does NOT
 * replay this; only a row newly mounted (the list's first load, or a
 * genuinely new item appearing) does. `index` staggers each row's start so
 * they cascade in rather than popping in together; capped at 8 so a long
 * list's last few rows don't wait an unreasonably long time to appear.
 */
export function AnimatedListItem({ index, children }: { index: number; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInUp.delay(Math.min(index, 8) * 40).duration(durations.short)}
    >
      {children}
    </Animated.View>
  );
}
