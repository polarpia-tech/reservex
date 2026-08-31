import { Stack } from 'expo-router';

/**
 * Plain Stack, no header override here -- the outer Tab already hides its
 * own header for this tab (see tabs/_layout.tsx), so every screen in this
 * folder owns its header via its own <Stack.Screen options={{title:...}} />,
 * exactly like the tables/ and settings/ folders since Phase 06.
 */
export default function ReservationsLayout() {
  return <Stack />;
}
