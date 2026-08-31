import { fetchMyRestaurants, type MyRestaurantMembership } from '@reservex/core';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/services/supabase';

/**
 * Which restaurant(s) the signed-in user is active staff at. This single
 * query result drives the top-level routing decision in
 * src/navigation/useProtectedRoute.ts: zero restaurants means "send them to
 * onboarding", one or more means "send them into the app".
 */
export function useMyRestaurants(): UseQueryResult<MyRestaurantMembership[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-restaurants', user?.id],
    queryFn: () => fetchMyRestaurants(supabase, user!.id),
    enabled: Boolean(user),
  });
}
