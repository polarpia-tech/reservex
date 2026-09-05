import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';

import { SplashIntro } from '@/components/SplashIntro';
import { useMyRestaurants } from '@/hooks/useMyRestaurants';
import { i18n } from '@/i18n';
import { rootModeScreenOptions } from '@/navigation/screenTransitions';
import { useProtectedRoute } from '@/navigation/useProtectedRoute';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

// Keep the native splash screen up until fonts are ready -- still true, and
// still with no JS work blocking it, per the blueprint's explicit call to
// never trade startup performance for a flashy animation. The richer
// animated sequence from the original brief is <SplashIntro> below: it
// takes over the INSTANT this native splash hides (same background color,
// no gap), and is a pure visual overlay on top of the real screen, which
// keeps resolving its own data underneath the whole time.
void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const theme = useTheme();
  const { session, isLoading: authLoading } = useAuth();
  const { data: restaurants, isLoading: restaurantsLoading, isFetched: restaurantsFetched } = useMyRestaurants();

  // "Resolving" covers two separate unknowns: (a) we don't yet know if
  // there's a session at all, or (b) we DO have a session but haven't heard
  // back yet whether it has any restaurant membership. Deciding a redirect
  // on either kind of stale data would bounce the user through the wrong
  // screen for a frame on every cold start -- so hold off until both are
  // settled.
  const isResolving = authLoading || (Boolean(session) && restaurantsLoading && !restaurantsFetched);

  useProtectedRoute({
    hasSession: Boolean(session),
    hasRestaurant: Boolean(restaurants && restaurants.length > 0),
    isResolving,
  });

  const [introDone, setIntroDone] = useState(false);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.textPrimary,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false, ...rootModeScreenOptions }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false, ...rootModeScreenOptions }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, ...rootModeScreenOptions }} />
      </Stack>
      {/*
        Rendered on top of the Stack above, not instead of it -- the real
        navigator (and useProtectedRoute's redirect above) keeps resolving
        underneath the whole time this is visible. See SplashIntro.tsx for
        why that matters and how the "first launch vs every launch after"
        behavior works.
      */}
      {!introDone ? <SplashIntro onFinish={() => setIntroDone(true)} /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans: PlusJakartaSans_400Regular,
    PlusJakartaSans_Medium: PlusJakartaSans_500Medium,
    PlusJakartaSans_SemiBold: PlusJakartaSans_600SemiBold,
    PlusJakartaSans_Bold: PlusJakartaSans_700Bold,
    PlusJakartaSans_ExtraBold: PlusJakartaSans_800ExtraBold,
    IBMPlexMono: IBMPlexMono_400Regular,
    IBMPlexMono_Medium: IBMPlexMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null; // native splash stays visible
  }

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </QueryProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
