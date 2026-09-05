import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Reflects the OS-level "Reduce Motion" setting (iOS: Settings >
 * Accessibility > Motion; Android: Settings > Accessibility > Remove
 * animations), and stays live if the person toggles it while the app is
 * open -- not just whatever it was at launch.
 *
 * Every animation built from ./tokens should check this and, when true,
 * jump straight to the animation's end state instead of playing it. This
 * hook only reports the setting; it does not skip anything on its own.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value: boolean) => {
      setReduceMotion(value);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
