import type { OpeningHours, SpecialHours } from '@reservex/core';

import { ClockIcon } from '@/components/icons';
import { getDictionary, t, type SupportedLocale } from '@/lib/dictionary';
import { truncateToHm } from '@/lib/timezone';

/**
 * The weekly opening-hours table + upcoming special-hours overrides.
 * Extracted from app/[locale]/r/[slug]/page.tsx (Phase 08) so
 * app/widget/[locale]/[slug]/page.tsx (Phase 14) can render an identical
 * block without copy-pasting it -- pure presentational, no data fetching
 * of its own, both pages fetch the same way and just pass the rows in.
 */
export function OpeningHoursList({
  locale,
  openingHours,
  specialHours,
}: {
  locale: SupportedLocale;
  openingHours: OpeningHours[];
  specialHours: SpecialHours[];
}) {
  const dict = getDictionary(locale);

  const hoursByDay = new Map<number, OpeningHours[]>();
  for (const shift of openingHours) {
    hoursByDay.set(shift.dayOfWeek, [...(hoursByDay.get(shift.dayOfWeek) ?? []), shift]);
  }

  const upcomingSpecialHours = specialHours.filter((s) => s.date >= new Date().toISOString().slice(0, 10)).slice(0, 5);

  return (
    <section>
      <h2
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 18,
          margin: '0 0 var(--space-md)',
        }}
      >
        <ClockIcon size={18} style={{ color: 'var(--accent)' }} />
        {t(dict, 'public.restaurant.openingHoursTitle')}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
          const shifts = (hoursByDay.get(dayOfWeek) ?? []).filter((s) => !s.isClosed);
          return (
            <div key={dayOfWeek} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text-muted)' }}>{t(dict, `openingHours.days.${dayOfWeek}`)}</span>
              <span>
                {shifts.length === 0
                  ? t(dict, 'public.restaurant.closedAllDay')
                  : shifts.map((s) => `${truncateToHm(s.opensAt)}â€“${truncateToHm(s.closesAt)}`).join(', ')}
              </span>
            </div>
          );
        })}
      </div>
      {upcomingSpecialHours.length > 0 && (
        <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {upcomingSpecialHours.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--warning)' }}>
              <span>
                {s.date}
                {s.reason ? ` â€” ${s.reason}` : ''}
              </span>
              <span>{s.isClosed ? t(dict, 'public.restaurant.closedAllDay') : s.opensAt && s.closesAt ? `${truncateToHm(s.opensAt)}â€“${truncateToHm(s.closesAt)}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}