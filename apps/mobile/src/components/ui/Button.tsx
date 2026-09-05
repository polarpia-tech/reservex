import { radii, spacing, typeScale } from '@reservex/ui';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { durations, easings, scale as scaleTokens, springs, useReduceMotion } from '@/animation';
import { useTheme } from '@/theme/ThemeProvider';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  /** "accent" = ember (primary restaurant action). "ai" = pulse (an AI-originated action, e.g. "confirm what the assistant proposed"). */
  variant?: 'accent' | 'ai' | 'neutral';
  loading?: boolean;
  /**
   * A slow, continuous, very subtle scale loop (item 10 of the animation
   * brief: "breathing" reserved for important CTAs only, never every
   * button). Pass this only on the one or two buttons per screen that most
   * want the user's attention -- e.g. "confirm booking". Automatically
   * pauses while the button is pressed, disabled, or loading, and is
   * skipped entirely when Reduce Motion is on.
   */
  breathing?: boolean;
}

/**
 * The one button component every screen should use. Two accent variants on
 * purpose: `accent` for ordinary actions, `ai` reserved for actions the AI
 * proposed -- so a user always knows, from color alone, whether they are
 * confirming their own action or the assistant's suggestion.
 *
 * Press feedback (item 9 of the animation brief) is a small Reanimated scale
 * bounce (spring down on press-in, spring back on press-out) layered on top
 * of the original opacity dim -- both read their timing from the central
 * ./animation tokens. Under Reduce Motion, the scale never moves and only
 * the (instant, non-animated) opacity swap remains, exactly like before this
 * component had any animation at all.
 */
export function Button({
  label,
  variant = 'accent',
  loading = false,
  breathing = false,
  disabled,
  onPressIn,
  onPressOut,
  ...pressableProps
}: ButtonProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const isDisabled = disabled || loading;
  const backgroundColor =
    variant === 'neutral' ? theme.surfaceElevated : variant === 'ai' ? theme.ai : theme.accent;
  const textColor = variant === 'neutral' ? theme.textPrimary : '#0B0C10';

  const scale = useSharedValue(1);
  const opacity = useSharedValue(isDisabled ? 0.5 : 1);

  // Keeps the disabled/enabled opacity in sync even when it changes for
  // reasons other than a press (e.g. the form becomes valid while the
  // button isn't being touched at all).
  useEffect(() => {
    const target = isDisabled ? 0.5 : 1;
    opacity.value = reduceMotion ? target : withTiming(target, { duration: durations.instant, easing: easings.standard });
  }, [isDisabled, reduceMotion, opacity]);

  // The breathing loop itself. Only depends on the props/state that should
  // start or stop it -- a press is handled separately in the handlers below
  // so it doesn't fight with this effect.
  useEffect(() => {
    if (reduceMotion || !breathing || isDisabled) {
      cancelAnimation(scale);
      scale.value = reduceMotion ? 1 : withTiming(1, { duration: durations.instant, easing: easings.standard });
      return;
    }
    scale.value = withRepeat(
      withSequence(
        withTiming(scaleTokens.breatheUp, { duration: durations.long, easing: easings.standard }),
        withTiming(1, { duration: durations.long, easing: easings.standard }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [breathing, reduceMotion, isDisabled, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPressIn={(event) => {
        if (!reduceMotion) {
          cancelAnimation(scale);
          opacity.value = withTiming(0.85, { duration: durations.instant, easing: easings.standard });
          scale.value = withSpring(scaleTokens.pressedDown, springs.snappy);
        } else {
          opacity.value = 0.85;
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduceMotion) {
          opacity.value = withTiming(1, { duration: durations.instant, easing: easings.standard });
          if (breathing) {
            // Spring back to rest, then hand off to the breathing loop --
            // written inline (not as a separate helper) so Reanimated's
            // babel plugin can worklet-ize this callback correctly.
            scale.value = withSpring(1, springs.snappy, (finished) => {
              'worklet';
              if (finished) {
                scale.value = withRepeat(
                  withSequence(
                    withTiming(scaleTokens.breatheUp, { duration: durations.long, easing: easings.standard }),
                    withTiming(1, { duration: durations.long, easing: easings.standard }),
                  ),
                  -1,
                  true,
                );
              }
            });
          } else {
            scale.value = withSpring(1, springs.snappy);
          }
        } else {
          opacity.value = isDisabled ? 0.5 : 1;
        }
        onPressOut?.(event);
      }}
      style={[styles.base, { backgroundColor }, animatedStyle]}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: spacing['2xl'],
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typeScale.bodyStrong.size,
    fontWeight: typeScale.bodyStrong.weight as '600',
  },
});
