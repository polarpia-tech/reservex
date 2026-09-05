import AsyncStorage from '@react-native-async-storage/async-storage';
import { palette, spacing } from '@reservex/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { durations, easings, useReduceMotion } from '@/animation';

const SEEN_INTRO_STORAGE_KEY = '@reservex/splash-intro-seen';

const RING_SIZE = 88;
const RING_BORDER = 14;
const DOT_SIZE = 40;

/**
 * Item 1 of the animation brief (splash intro), placed last in the project
 * on purpose -- the most creative, highest-risk single piece, built once
 * the rest of the app's motion language already existed to build on.
 *
 * A pure VISUAL overlay rendered on top of the already-mounting navigator
 * (see app/_layout.tsx) -- the real screen underneath keeps resolving its
 * own data (auth session, restaurant membership) the entire time this is
 * showing, so nothing here adds a single millisecond of real loading time.
 * That was the explicit rule the original splash-screen comment in
 * app/_layout.tsx laid out ("never trade startup performance for a flashy
 * animation") and this keeps following it.
 *
 * Reuses the app's actual mark (the two concentric ember rings from
 * assets/icon.png / assets/splash.png) rather than inventing a new one --
 * built from plain Views since it is simple geometry, so there is nothing
 * to load or decode before the animation can start. The background is
 * hardcoded to palette.ink900 (not the current theme, which can be light)
 * because that is the exact color app.json's native splash screen uses --
 * matching it exactly avoids a visible colour jump the moment this overlay
 * takes over from the native splash.
 *
 * "Smart" behaviour: the FULL sequence (ring, then dot, then the wordmark
 * rising in, a short hold, then a fade) plays once per install -- tracked
 * with a single AsyncStorage flag, the same mechanism already used for the
 * Supabase session. Every later launch gets a much shorter version (ring
 * and dot together, no wordmark, quick fade) -- a staff member opening this
 * app dozens of times a shift should not sit through a multi-second intro
 * every time.
 *
 * Honest limitation: there is no reliable, dependency-free way to detect
 * "this is a low-end device" in this project today (that would need e.g.
 * expo-device, which isn't installed) -- so this does not scale itself down
 * for slower hardware. What it DOES respect is Reduce Motion: with that on,
 * every animation here is skipped and the mark/wordmark simply appear at
 * their end state for a brief, fixed hold before the real app shows.
 */
export function SplashIntro({ onFinish }: { onFinish: () => void }) {
  const reduceMotion = useReduceMotion();
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(SEEN_INTRO_STORAGE_KEY).then((value) => {
      if (!mounted) return;
      setIsFirstLaunch(value === null);
      void AsyncStorage.setItem(SEEN_INTRO_STORAGE_KEY, 'true');
    });
    return () => {
      mounted = false;
    };
  }, []);

  const ringOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const ringScale = useSharedValue(reduceMotion ? 1 : 0.6);
  const dotOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const dotScale = useSharedValue(reduceMotion ? 1 : 0.4);
  const wordmarkOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const wordmarkTranslateY = useSharedValue(reduceMotion ? 0 : 8);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    // Both branches below read isFirstLaunch, so wait until AsyncStorage
    // has answered before starting anything.
    if (isFirstLaunch === null) return;

    function fadeOutAndFinish(afterDelayMs: number, fadeDurationMs: number) {
      overlayOpacity.value = withDelay(
        afterDelayMs,
        withTiming(0, { duration: fadeDurationMs, easing: easings.standard }, (finished) => {
          'worklet';
          if (finished) runOnJS(onFinish)();
        }),
      );
    }

    if (reduceMotion) {
      ringOpacity.value = 1;
      ringScale.value = 1;
      dotOpacity.value = 1;
      dotScale.value = 1;
      wordmarkOpacity.value = 1;
      wordmarkTranslateY.value = 0;
      fadeOutAndFinish(400, durations.medium);
      return;
    }

    if (isFirstLaunch) {
      ringOpacity.value = withTiming(1, { duration: durations.medium, easing: easings.decelerate });
      ringScale.value = withTiming(1, { duration: durations.medium, easing: easings.decelerate });
      dotOpacity.value = withDelay(180, withTiming(1, { duration: durations.short, easing: easings.decelerate }));
      dotScale.value = withDelay(180, withTiming(1, { duration: durations.short, easing: easings.decelerate }));
      wordmarkOpacity.value = withDelay(420, withTiming(1, { duration: durations.medium, easing: easings.decelerate }));
      wordmarkTranslateY.value = withDelay(420, withTiming(0, { duration: durations.medium, easing: easings.decelerate }));
      fadeOutAndFinish(2000, durations.long);
    } else {
      ringOpacity.value = withTiming(1, { duration: durations.short, easing: easings.decelerate });
      ringScale.value = withTiming(1, { duration: durations.short, easing: easings.decelerate });
      dotOpacity.value = withTiming(1, { duration: durations.short, easing: easings.decelerate });
      dotScale.value = withTiming(1, { duration: durations.short, easing: easings.decelerate });
      fadeOutAndFinish(500, durations.medium);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstLaunch, reduceMotion]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value, transform: [{ scale: ringScale.value }] }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value, transform: [{ scale: dotScale.value }] }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkTranslateY.value }],
  }));

  return (
    <Animated.View style={[styles.overlay, overlayStyle]}>
      <Animated.View style={[styles.ring, ringStyle]}>
        <Animated.View style={[styles.dot, dotStyle]} />
      </Animated.View>
      <Animated.View style={wordmarkStyle}>
        <Text style={styles.wordmark}>ReservX</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.ink900,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_BORDER,
    borderColor: palette.emberDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: palette.emberDark,
  },
  wordmark: {
    color: '#F2F3F5',
    fontFamily: 'PlusJakartaSans_ExtraBold',
    fontSize: 24,
    letterSpacing: 0.5,
  },
});
