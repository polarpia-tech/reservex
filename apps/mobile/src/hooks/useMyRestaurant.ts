import type { MyRestaurantMembership } from '@reservex/core';
import type { UseQueryResult } from '@tanstack/react-query';

import { useMyRestaurants } from './useMyRestaurants';

export interface UseMyRestaurantResult extends Omit<UseQueryResult<MyRestaurantMembership[]>, 'data'> {
  membership: MyRestaurantMembership | undefined;
  isOwnerOrManager: boolean;
}

/**
 * Convenience wrapper around useMyRestaurants() for every Phase 05+ screen
 * that manages "the" restaurant -- profile, opening hours, staff. Single
 * location per account is an explicit MVP assumption (see settings screens
 * and the README "Phase 05" note): restaurants[0] is treated as THE
 * restaurant. Multi-location switching UI is out of scope until that's
 * actually needed (blueprint Part 09, "after MVP" list).
 */
export function useMyRestaurant(): UseMyRestaurantResult {
  const query = useMyRestaurants();
  const membership = query.data?.[0];
  const isOwnerOrManager = membership?.role === 'owner' || membership?.role === 'manager';
  return { ...query, membership, isOwnerOrManager };
}
