/**
 * Dependency-free IANA timezone conversion helpers for the public booking
 * form.
 *
 * Why this exists (and why the mobile app doesn't need it): the Phase 07
 * host-facing mobile app assumes the device's own timezone IS the
 * restaurant's timezone -- a reasonable simplification, since restaurant
 * staff are physically at the restaurant. Phase 08's customer is booking
 * from their own browser, which could be anywhere; when they type "19:00"
 * on a restaurant's page, they mean 19:00 IN THAT RESTAURANT'S TIMEZONE
 * (restaurants.timezone), not 19:00 in whatever timezone their own device
 * happens to be set to. Getting this wrong silently books the wrong hour
 * for a guest travelling across timezones, so it's worth the extra rigor
 * here even though it adds a bit of code.
 *
 * Deliberately no date-fns-tz / luxon / moment-timezone dependency: the
 * browser's own `Intl` API already knows every IANA timezone's UTC offset
 * (including DST rules) for any given instant -- this file is the standard
 * "format the same instant twice, diff the wall-clock, done" technique,
 * not a hand-rolled reimplementation of timezone *rules* themselves.
 */

/**
 * For a given actual instant, how far ahead of UTC is `timeZone`'s wall
 * clock, in milliseconds? (Positive east of UTC, e.g. Europe/Athens in
 * summer is +10800000 = +3h.)
 */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  // Some engines report midnight as hour "24" under hourCycle: 'h23' --
  // normalize it back to 0 rather than let Date.UTC silently roll it into
  // the next day, which would throw the offset off by exactly 24h.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtcMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtcMs - instant.getTime();
}

/**
 * Converts a customer-typed local date+time (a wall clock reading IN
 * `timeZone`, e.g. "2026-09-15" + "19:00" in "Europe/Athens") into the
 * correct UTC instant.
 *
 * Known limitation (documented, not silently ignored -- see the Phase 08
 * README): this is a single-pass calculation. For the one hour of the year
 * a clock is set BACK (an ambiguous local time occurring twice) or the one
 * hour it's set FORWARD (a local time that never occurs at all), the
 * result can be off by exactly the DST delta. This is the same limitation
 * the popular date-fns-tz library has by default; a booking form is not
 * the place that most needs the extra complexity of resolving that
 * ambiguity, so it isn't built here.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuessMs), timeZone);
  return new Date(utcGuessMs - offsetMs);
}

/** Formats a UTC instant as a wall-clock "HH:MM" string in `timeZone` -- used to show opening hours and a booking confirmation in the restaurant's own local time, regardless of the visitor's browser timezone. */
export function formatTimeInTimeZone(instant: Date | string, timeZone: string, locale: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** Formats a UTC instant as a full local date + time in `timeZone`, e.g. for the "you're booked" confirmation screen. */
export function formatDateTimeInTimeZone(instant: Date | string, timeZone: string, locale: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** "HH:MM:SS" (as stored in opening_hours) -> "HH:MM" for display. */
export function truncateToHm(time: string): string {
  return time.slice(0, 5);
}
