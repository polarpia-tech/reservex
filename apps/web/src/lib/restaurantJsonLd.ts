import type { OpeningHours, Restaurant, RestaurantType } from '@reservex/core';

/**
 * Schema.org (JSON-LD) structured data for a restaurant's public profile
 * page (`/[locale]/r/[slug]`). Purely additive SEO markup -- invisible to
 * a human visitor, read by search engines (Google's rich-result eligibility
 * for restaurants/local businesses, and general knowledge-panel data) --
 * see this file's own README note (Phase 12 follow-up) for why this is
 * NOT the same thing as a "Reserve a table" button inside Google's search
 * results: that requires a business-side "Reserve with Google" partnership,
 * a real Google Business Profile relationship, not something structured
 * data alone can turn on. This markup still helps: it is the same
 * vocabulary Google (and every other consumer -- Bing, voice assistants,
 * WhatsApp/Slack link unfurls) uses to understand "this page is a
 * restaurant with this name/address/phone/hours", independent of any
 * partnership.
 *
 * Same "real data only, no invented content" principle the rest of this
 * page already follows (see RestaurantProfilePage's own hero comment):
 * every field below is either omitted or taken directly from what the
 * restaurant actually has on file. No `aggregateRating` (no ratings/
 * reviews table exists in this schema yet), no `priceRange` (no price-tier
 * field exists), no `servesCuisine` (restaurant_type is a venue-type enum,
 * not a cuisine -- see restaurantType.ts; putting a venue type in a
 * cuisine field would misrepresent it to search engines).
 */

const RESTAURANT_TYPE_SCHEMA_TYPE: Record<string, string> = {
  restaurant: 'Restaurant',
  cafe: 'CafeOrCoffeeShop',
  bar: 'BarOrPub',
  club: 'NightClub',
  // beach_venue / hotel_venue / event_venue have no dedicated schema.org
  // type -- FoodEstablishment (the shared parent type of Restaurant/
  // CafeOrCoffeeShop/BarOrPub etc.) is the honest fallback: still
  // correctly categorizes this as a place that serves food, without
  // claiming a more specific type this app has no basis for.
  beach_venue: 'FoodEstablishment',
  hotel_venue: 'FoodEstablishment',
  event_venue: 'FoodEstablishment',
};

function restaurantSchemaType(type: RestaurantType | string): string {
  return RESTAURANT_TYPE_SCHEMA_TYPE[type] ?? 'FoodEstablishment';
}

// schema.org's own canonical dayOfWeek values are URLs under this base --
// index matches OpeningHours.dayOfWeek (0 = Sunday ... 6 = Saturday, same
// as JS Date#getDay(), per that field's own doc comment in database.ts).
const SCHEMA_DAY_OF_WEEK = [
  'https://schema.org/Sunday',
  'https://schema.org/Monday',
  'https://schema.org/Tuesday',
  'https://schema.org/Wednesday',
  'https://schema.org/Thursday',
  'https://schema.org/Friday',
  'https://schema.org/Saturday',
];

// "HH:MM:SS" -> "HH:MM" (schema.org's OpeningHoursSpecification wants an
// xsd:time value; the leading "HH:MM" is what every consumer actually
// parses, and keeping the seconds adds nothing).
function toSchemaTime(value: string): string {
  return value.slice(0, 5);
}

export interface RestaurantJsonLdInput {
  restaurant: Restaurant;
  openingHours: OpeningHours[];
  /** Absolute URL of the restaurant's public profile page. */
  pageUrl: string;
}

/**
 * Builds the JSON-LD object for a restaurant's public profile page. Returns
 * a plain object -- the caller serializes it (JSON.stringify) into a
 * `<script type="application/ld+json">` tag.
 */
export function buildRestaurantJsonLd({ restaurant, openingHours, pageUrl }: RestaurantJsonLdInput): Record<string, unknown> {
  const address =
    restaurant.addressLine || restaurant.city || restaurant.postalCode || restaurant.countryCode
      ? {
          '@type': 'PostalAddress',
          ...(restaurant.addressLine ? { streetAddress: restaurant.addressLine } : {}),
          ...(restaurant.city ? { addressLocality: restaurant.city } : {}),
          ...(restaurant.postalCode ? { postalCode: restaurant.postalCode } : {}),
          ...(restaurant.countryCode ? { addressCountry: restaurant.countryCode } : {}),
        }
      : undefined;

  // Closed days simply have no spec entry -- an absent day means "no
  // published hours that day" to schema.org consumers, which is accurate
  // (distinct from "open 24h", which this app has no way to express yet
  // since opensAt/closesAt are always required, non-null times).
  const openingHoursSpecification = openingHours
    .filter((oh) => !oh.isClosed)
    .map((oh) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAY_OF_WEEK[oh.dayOfWeek],
      opens: toSchemaTime(oh.opensAt),
      closes: toSchemaTime(oh.closesAt),
    }));

  return {
    '@context': 'https://schema.org',
    '@type': restaurantSchemaType(restaurant.restaurantType),
    name: restaurant.name,
    url: pageUrl,
    ...(restaurant.description ? { description: restaurant.description } : {}),
    ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
    ...(restaurant.websiteUrl ? { sameAs: [restaurant.websiteUrl] } : {}),
    ...(restaurant.logoUrl ? { image: [restaurant.logoUrl] } : {}),
    ...(address ? { address } : {}),
    ...(openingHoursSpecification.length > 0 ? { openingHoursSpecification } : {}),
  };
}
