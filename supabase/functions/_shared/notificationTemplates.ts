// deno-lint-ignore-file no-explicit-any
/**
 * notificationTemplates.ts
 * =========================
 * Phase 22. Transactional email/SMS copy for the four template_codes that
 * ever reach an email/sms channel (see 0016_notifications_automation.sql):
 * reservation_confirmed, reservation_cancelled, reservation_rescheduled,
 * reservation_reminder. Every other template_code this project queues
 * (reservation_created, no_show_recorded) is staff-only and always
 * in_app -- 0016's own trigger never queues them for email/sms, so they
 * have no entry here on purpose; an unknown template_code is treated as a
 * configuration error by the caller (dispatch-notifications), not
 * silently sent with placeholder text.
 *
 * Four locales, matching packages/i18n's own locale set (el/en/de/tr) --
 * these are server-side transactional strings, deliberately separate from
 * that package (which ships to client bundles); duplicting the four short
 * phrases needed here is simpler and safer than adding a runtime
 * dependency from a Deno Edge Function on a workspace package built for
 * React/React Native.
 */

export type SupportedLocale = 'el' | 'en' | 'de' | 'tr';

const INTL_LOCALE: Record<SupportedLocale, string> = {
  el: 'el-GR',
  en: 'en-US',
  de: 'de-DE',
  tr: 'tr-TR',
};

export function normalizeLocale(locale: string | null | undefined): SupportedLocale {
  if (locale === 'el' || locale === 'en' || locale === 'de' || locale === 'tr') return locale;
  return 'en';
}

function formatDateTime(iso: string, locale: SupportedLocale, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    // Bad/unknown IANA timezone on the restaurant row, or an unparseable
    // date -- fall back to the raw ISO string rather than throwing and
    // failing the whole dispatch for what is, at worst, a cosmetic issue.
    return iso;
  }
}

export interface ReservationNotificationPayload {
  reservationId?: string;
  startsAt?: string;
  partySize?: number;
  guestName?: string | null;
  cancellationReason?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const EMAIL_COPY: Record<SupportedLocale, {
  greeting: (name: string) => string;
  confirmedSubject: string;
  confirmedLine: (when: string, size: number) => string;
  cancelledSubject: string;
  cancelledLine: (when: string) => string;
  cancelledReason: (reason: string) => string;
  rescheduledSubject: string;
  rescheduledLine: (when: string, size: number) => string;
  reminderSubject: string;
  reminderLine: (when: string, size: number) => string;
  signOff: string;
}> = {
  en: {
    greeting: (name) => (name ? `Hi ${name},` : 'Hi,'),
    confirmedSubject: 'Your reservation is confirmed',
    confirmedLine: (when, size) => `You're booked for ${size} on ${when}. See you then!`,
    cancelledSubject: 'Your reservation was cancelled',
    cancelledLine: (when) => `Your reservation for ${when} has been cancelled.`,
    cancelledReason: (reason) => `Reason: ${reason}`,
    rescheduledSubject: 'Your reservation was updated',
    rescheduledLine: (when, size) => `Your reservation is now for ${size} on ${when}.`,
    reminderSubject: 'Reminder: your reservation is coming up',
    reminderLine: (when, size) => `Just a reminder -- your table for ${size} is on ${when}.`,
    signOff: 'See you soon.',
  },
  el: {
    greeting: (name) => (name ? `Γεια σου ${name},` : 'Γεια σου,'),
    confirmedSubject: 'Η κράτησή σου επιβεβαιώθηκε',
    confirmedLine: (when, size) => `Η κράτησή σου για ${size} άτομα στις ${when} επιβεβαιώθηκε. Τα λέμε τότε!`,
    cancelledSubject: 'Η κράτησή σου ακυρώθηκε',
    cancelledLine: (when) => `Η κράτησή σου για ${when} ακυρώθηκε.`,
    cancelledReason: (reason) => `Λόγος: ${reason}`,
    rescheduledSubject: 'Η κράτησή σου ενημερώθηκε',
    rescheduledLine: (when, size) => `Η κράτησή σου είναι πλέον για ${size} άτομα στις ${when}.`,
    reminderSubject: 'Υπενθύμιση: η κράτησή σου πλησιάζει',
    reminderLine: (when, size) => `Μια υπενθύμιση -- το τραπέζι σου για ${size} άτομα είναι στις ${when}.`,
    signOff: 'Τα λέμε σύντομα.',
  },
  de: {
    greeting: (name) => (name ? `Hallo ${name},` : 'Hallo,'),
    confirmedSubject: 'Ihre Reservierung ist bestätigt',
    confirmedLine: (when, size) => `Ihr Tisch für ${size} Personen am ${when} ist bestätigt. Bis dahin!`,
    cancelledSubject: 'Ihre Reservierung wurde storniert',
    cancelledLine: (when) => `Ihre Reservierung für ${when} wurde storniert.`,
    cancelledReason: (reason) => `Grund: ${reason}`,
    rescheduledSubject: 'Ihre Reservierung wurde geändert',
    rescheduledLine: (when, size) => `Ihre Reservierung ist jetzt für ${size} Personen am ${when}.`,
    reminderSubject: 'Erinnerung: Ihre Reservierung steht bevor',
    reminderLine: (when, size) => `Kurze Erinnerung -- Ihr Tisch für ${size} Personen ist am ${when}.`,
    signOff: 'Bis bald.',
  },
  tr: {
    greeting: (name) => (name ? `Merhaba ${name},` : 'Merhaba,'),
    confirmedSubject: 'Rezervasyonunuz onaylandı',
    confirmedLine: (when, size) => `${size} kişilik masanız ${when} tarihinde onaylandı. Görüşmek üzere!`,
    cancelledSubject: 'Rezervasyonunuz iptal edildi',
    cancelledLine: (when) => `${when} tarihli rezervasyonunuz iptal edildi.`,
    cancelledReason: (reason) => `Sebep: ${reason}`,
    rescheduledSubject: 'Rezervasyonunuz güncellendi',
    rescheduledLine: (when, size) => `Rezervasyonunuz artık ${size} kişilik, ${when} tarihinde.`,
    reminderSubject: 'Hatırlatma: rezervasyonunuza az kaldı',
    reminderLine: (when, size) => `Küçük bir hatırlatma -- ${size} kişilik masanız ${when} tarihinde.`,
    signOff: 'Yakında görüşmek üzere.',
  },
};

const SMS_COPY: Record<SupportedLocale, {
  confirmed: (restaurant: string, when: string, size: number) => string;
  cancelled: (restaurant: string, when: string) => string;
  rescheduled: (restaurant: string, when: string, size: number) => string;
  reminder: (restaurant: string, when: string, size: number) => string;
}> = {
  en: {
    confirmed: (r, when, size) => `${r}: your reservation for ${size} on ${when} is confirmed.`,
    cancelled: (r, when) => `${r}: your reservation for ${when} has been cancelled.`,
    rescheduled: (r, when, size) => `${r}: your reservation is now for ${size} on ${when}.`,
    reminder: (r, when, size) => `${r}: reminder -- your table for ${size} is on ${when}.`,
  },
  el: {
    confirmed: (r, when, size) => `${r}: η κράτησή σου για ${size} άτομα στις ${when} επιβεβαιώθηκε.`,
    cancelled: (r, when) => `${r}: η κράτησή σου για ${when} ακυρώθηκε.`,
    rescheduled: (r, when, size) => `${r}: η κράτησή σου είναι πλέον για ${size} άτομα στις ${when}.`,
    reminder: (r, when, size) => `${r}: υπενθύμιση -- το τραπέζι σου για ${size} άτομα είναι στις ${when}.`,
  },
  de: {
    confirmed: (r, when, size) => `${r}: Ihre Reservierung für ${size} Personen am ${when} ist bestätigt.`,
    cancelled: (r, when) => `${r}: Ihre Reservierung für ${when} wurde storniert.`,
    rescheduled: (r, when, size) => `${r}: Ihre Reservierung ist jetzt für ${size} Personen am ${when}.`,
    reminder: (r, when, size) => `${r}: Erinnerung -- Ihr Tisch für ${size} Personen ist am ${when}.`,
  },
  tr: {
    confirmed: (r, when, size) => `${r}: ${size} kişilik rezervasyonunuz ${when} tarihinde onaylandı.`,
    cancelled: (r, when) => `${r}: ${when} tarihli rezervasyonunuz iptal edildi.`,
    rescheduled: (r, when, size) => `${r}: rezervasyonunuz artık ${size} kişilik, ${when} tarihinde.`,
    reminder: (r, when, size) => `${r}: hatırlatma -- ${size} kişilik masanız ${when} tarihinde.`,
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the email for one template_code. Throws for any template_code
 * this dispatcher does not know how to render (see this file's header) --
 * the caller treats that as a hard failure for that row rather than a
 * silent skip, so a queued row with a template_code this file doesn't
 * cover is visible (it lands in error_message) instead of vanishing.
 */
export function renderEmail(
  templateCode: string,
  localeRaw: string | null | undefined,
  restaurantName: string,
  timezone: string,
  payload: ReservationNotificationPayload,
): RenderedEmail {
  const locale = normalizeLocale(localeRaw);
  const copy = EMAIL_COPY[locale];
  const name = payload.guestName ?? '';
  const when = payload.startsAt ? formatDateTime(payload.startsAt, locale, timezone) : '';
  const size = payload.partySize ?? 0;

  let subject: string;
  let bodyLine: string;
  let extraLine = '';

  switch (templateCode) {
    case 'reservation_confirmed':
      subject = copy.confirmedSubject;
      bodyLine = copy.confirmedLine(when, size);
      break;
    case 'reservation_cancelled':
      subject = copy.cancelledSubject;
      bodyLine = copy.cancelledLine(when);
      if (payload.cancellationReason) extraLine = copy.cancelledReason(payload.cancellationReason);
      break;
    case 'reservation_rescheduled':
      subject = copy.rescheduledSubject;
      bodyLine = copy.rescheduledLine(when, size);
      break;
    case 'reservation_reminder':
      subject = copy.reminderSubject;
      bodyLine = copy.reminderLine(when, size);
      break;
    default:
      throw new Error(`renderEmail: no email template for template_code "${templateCode}"`);
  }

  const fullSubject = `${restaurantName} -- ${subject}`;
  const text = [copy.greeting(name), bodyLine, extraLine, copy.signOff].filter(Boolean).join('\n\n');
  const html = `<!doctype html><html><body style="font-family:sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
<p>${escapeHtml(copy.greeting(name))}</p>
<p>${escapeHtml(bodyLine)}</p>
${extraLine ? `<p>${escapeHtml(extraLine)}</p>` : ''}
<p>${escapeHtml(copy.signOff)}</p>
<p style="color:#888;font-size:13px">${escapeHtml(restaurantName)}</p>
</body></html>`;

  return { subject: fullSubject, html, text };
}

/** Renders the SMS body for one template_code. Same unknown-code contract as renderEmail. */
export function renderSms(
  templateCode: string,
  localeRaw: string | null | undefined,
  restaurantName: string,
  timezone: string,
  payload: ReservationNotificationPayload,
): string {
  const locale = normalizeLocale(localeRaw);
  const copy = SMS_COPY[locale];
  const when = payload.startsAt ? formatDateTime(payload.startsAt, locale, timezone) : '';
  const size = payload.partySize ?? 0;

  switch (templateCode) {
    case 'reservation_confirmed':
      return copy.confirmed(restaurantName, when, size);
    case 'reservation_cancelled':
      return copy.cancelled(restaurantName, when);
    case 'reservation_rescheduled':
      return copy.rescheduled(restaurantName, when, size);
    case 'reservation_reminder':
      return copy.reminder(restaurantName, when, size);
    default:
      throw new Error(`renderSms: no SMS template for template_code "${templateCode}"`);
  }
}
