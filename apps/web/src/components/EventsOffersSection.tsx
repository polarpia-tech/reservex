import type { Offer, RestaurantEvent } from '@reservex/core';
import { isOfferCurrentlyValid } from '@reservex/core';
import type { ReactNode } from 'react';

import { CalendarIcon, TagIcon } from '@/components/icons';
import { getDictionary, interpolate, t, type SupportedLocale } from '@/lib/dictionary';

/**
 * Phase 21 (migration 0042): public-facing events and offers on a
 * restaurant's own page. Both lists are already narrowed to exactly what
 * an anonymous visitor should see by the API layer -- fetchPublicEvents()
 * (upcoming, active, non-private, restaurant active) and
 * fetchPublicOffers() (active + currently within its own validity window)
 * -- so this component is pure presentation, same division of
 * responsibility as OpeningHoursList.
 *
 * Deliberately renders nothing (not even an empty-state message) when both
 * lists are empty -- unlike the owner-facing mobile screens, a public page
 * has no reason to tell a visitor "no events yet"; it should just not show
 * the section at all, same as e.g. a restaurant with no special_hours
 * upcoming shows no special-hours block.
 */
export function EventsOffersSection({
  locale,
  events,
  offers,
}: {
  locale: SupportedLocale;
  events: RestaurantEvent[];
  offers: Offer[];
}) {
  const dict = getDictionary(locale);
  const currentOffers = offers.filter((offer) => isOfferCurrentlyValid(offer));

  if (events.length === 0 && currentOffers.length === 0) return null;

  const dateOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)', marginBottom: 'clamp(32px, 5vw, 56px)' }}>
      {events.length > 0 && (
        <section>
          <SectionHeading icon={<CalendarIcon size={18} style={{ color: 'var(--accent)' }} />} title={t(dict, 'public.restaurant.eventsTitle')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {events.map((event) => {
              const start = new Date(event.startsAt);
              const end = new Date(event.endsAt);
              const sameDay = start.toDateString() === end.toDateString();
              const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
              const when = sameDay
                ? `${start.toLocaleDateString(locale, dateOpts)} · ${start.toLocaleTimeString(locale, timeOpts)}–${end.toLocaleTimeString(locale, timeOpts)}`
                : `${start.toLocaleDateString(locale, dateOpts)} → ${end.toLocaleDateString(locale, dateOpts)}`;
              return (
                <Card key={event.id}>
                  <div style={{ fontWeight: 600, fontSize: 15.5 }}>{event.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{when}</div>
                  {event.description && (
                    <p style={{ marginTop: 'var(--space-sm)', fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>{event.description}</p>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {currentOffers.length > 0 && (
        <section>
          <SectionHeading icon={<TagIcon size={18} style={{ color: 'var(--accent)' }} />} title={t(dict, 'public.restaurant.offersTitle')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {currentOffers.map((offer) => {
              const validityLabel = offer.validUntil
                ? interpolate(t(dict, 'public.restaurant.offerValidUntil'), { date: new Date(offer.validUntil).toLocaleDateString(locale, dateOpts) })
                : offer.validFrom
                  ? interpolate(t(dict, 'public.restaurant.offerValidFrom'), { date: new Date(offer.validFrom).toLocaleDateString(locale, dateOpts) })
                  : null;
              return (
                <Card key={offer.id}>
                  <div style={{ fontWeight: 600, fontSize: 15.5 }}>{offer.title}</div>
                  {validityLabel && <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{validityLabel}</div>}
                  {offer.description && (
                    <p style={{ marginTop: 'var(--space-sm)', fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>{offer.description}</p>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 19,
        letterSpacing: '-0.01em',
        margin: '0 0 var(--space-lg)',
      }}
    >
      {icon}
      {title}
    </h2>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: 'var(--space-lg)',
      }}
    >
      {children}
    </div>
  );
}
