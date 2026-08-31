import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

/**
 * Three possible destinations, decided centrally here rather than scattered
 * across screens:
 *   1. no session             -> (auth) group (login/signup/forgot-password)
 *   2. session, no restaurant -> (onboarding) group (create-restaurant)
 *   3. session + restaurant   -> (tabs) group (the actual app)
 *
 * This mirrors the Expo Router team's own recommended pattern: redirect
 * from an effect keyed on the current route segments, rather than trying to
 * gate rendering per-screen. Every branch also fires from the bare "/"
 * route (app/index.tsx), which renders nothing but a spinner and relies
 * entirely on this hook to send the user somewhere real -- see the comment
 * there for why app/index.tsx must NOT redirect on its own.
 */
export function useProtectedRoute(params: { hasSession: boolean; hasRestaurant: boolean; isResolving: boolean }) {
  const { hasSession, hasRestaurant, isResolving } = params;
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isResolving) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';
    const inTabsGroup = segments[0] === '(tabs)';

    if (!hasSession && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (hasSession && !hasRestaurant && !inOnboardingGroup) {
      router.replace('/(onboarding)/create-restaurant');
    } else if (hasSession && hasRestaurant && !inTabsGroup) {
      router.replace('/(tabs)/reservations');
    }
  }, [hasSession, hasRestaurant, isResolving, segments, router]);
}
