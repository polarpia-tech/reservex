import type { RestaurantType } from '@reservex/core';

/**
 * Phase 20 part 2: the restaurant-type -> translation-key map used to show
 * a "cuisine/venue type" chip. Originally a local const only inside the
 * directory page; pulled out here once the restaurant profile page's new
 * hero also needed it, so there is exactly one place that maps a
 * RestaurantType to its dictionary key instead of two copies drifting
 * apart if a new type is ever added.
 */
export const RESTAURANT_TYPE_LABEL_KEY: Record<string, string> = {
  restaurant: 'restaurantTypes.restaurant',
  cafe: 'restaurantTypes.cafe',
  bar: 'restaurantTypes.bar',
  club: 'restaurantTypes.club',
  beach_venue: 'restaurantTypes.beach_venue',
  hotel_venue: 'restaurantTypes.hotel_venue',
  event_venue: 'restaurantTypes.event_venue',
};

export function restaurantTypeLabelKey(type: RestaurantType | string): string {
  return RESTAURANT_TYPE_LABEL_KEY[type] ?? 'restaurantTypes.restaurant';
}
