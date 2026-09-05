import { radii } from '@reservex/ui';
import { useEffect } from 'react';
import type { DimensionValue, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { durations, easings, useReduceMotion } from '@/animation';
import { useTheme } from '@/theme/ThemeProvider';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Item 12 of the animation brief: skeleton loading placeholders instead of
 * bare "Loading..." text. A single shimmering block, reused everywhere a
 * loading state needs a shape -- deliberately a slow, subtle OPACITY pulse
 * rather than a moving gradient sweep: a sweep reads as busier and this
 * app's brief explicitly warns against over-animating a screen people look
 * at dozens of times a shift. Falls back to a static block (no animation at
 * all) under Reduce Motion, same as every other animation in this app.
 */
export function Skeleton({ width = '100%', height = 16, borderRadius = radii.sm, style }: SkeletonProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(reduceMotion ? 0.5 : 0.35);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.5;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: durations.long, easing: easings.standard }),
        withTiming(0.35, { duration: durations.long, easing: easings.standard }),
      ),
      -1,
      true,
    );
  }, [reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: theme.border }, animatedStyle, style]}
    />
  );
}
