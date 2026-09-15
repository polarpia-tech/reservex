import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — ReservX',
  description: 'How ReservX collects, uses, and protects data.',
};

// Deliberately NOT under app/[locale]/ and NOT run through the
// dictionary/t() i18n system: every other page's locale keys are enforced
// to exist identically in all 4 languages by
// packages/i18n/scripts/check-locale-parity.mjs, and legal text is exactly
// the kind of content that should never be auto/machine-translated into a
// parity script just to satisfy that check -- a mistranslated privacy
// policy is a real liability, not a cosmetic bug. A single authoritative
// English version at a stable, locale-independent URL (what Google Play's
// Data safety / Play Console listing form and Apple's App Privacy section
// both just want: one URL) is the standard, honest approach most apps take
// for legal documents even when the product itself is multilingual.
//
// Content below describes what this codebase ACTUALLY does, as of Phase 12
// (Stripe live-tested) / the Schema.org follow-up -- cross-checked against
// the real integrations wired up this session (Supabase, Stripe, Resend,
// Twilio (SMS deferred/inactive), Anthropic) rather than written generically.
// The contact name/email below are placeholders using the account this was
// built for -- confirm or change them before relying on this page for a
// real Play Store / App Store submission.
export default function PrivacyPolicyPage() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(32px, 6vw, 64px) clamp(20px, 5vw, 32px) 96px', color: 'var(--text-primary)', lineHeight: 1.7 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 40px)', marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 40 }}>Last updated: September 2026</p>

      <p>
        ReservX (&ldquo;ReservX&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a restaurant reservation and table-management platform. This page
        explains what information we collect through our website, staff mobile app, and public booking pages, why we collect it, and who we share
        it with. It applies to restaurant staff who use the ReservX apps to manage their business, and to guests who book a table through a
        restaurant&apos;s public ReservX page.
      </p>

      <h2 style={sectionHeadingStyle}>Who we are</h2>
      <p>
        ReservX is operated by Pavlos. If you have a question about this policy or about your data, contact{' '}
        <a href="mailto:polarpia@gmail.com" style={{ color: 'var(--accent)' }}>
          polarpia@gmail.com
        </a>
        .
      </p>

      <h2 style={sectionHeadingStyle}>Information we collect</h2>
      <p>We collect different information depending on how you use ReservX:</p>
      <p>
        <strong>Restaurant staff accounts.</strong> When a restaurant signs up, staff accounts are created with an email address and password
        (authentication is handled by our database provider, Supabase; we never see or store your password in plain text), plus the restaurant
        profile details staff choose to add — name, address, phone number, opening hours, logo, and similar business information.
      </p>
      <p>
        <strong>Guests booking a table.</strong> When someone books a table — signed in or as a guest — we collect the name, email address, phone
        number, and party size needed to hold and confirm that reservation, along with the date and time requested. If a restaurant requires a
        deposit to secure the booking, the guest also goes through a card-payment step (see &ldquo;Payments&rdquo; below).
      </p>
      <p>
        <strong>Communications.</strong> To confirm, remind, or update someone about a reservation, we send transactional emails (and, for
        restaurants that enable it, SMS text messages) to the email address or phone number provided at booking time.
      </p>
      <p>
        <strong>AI assistant conversations.</strong> Restaurant staff can use an AI assistant inside the app to help with day-to-day tasks (for
        example, summarizing the day&apos;s reservations). Messages sent to the assistant, and the restaurant data needed to answer them, are sent
        to our AI provider to generate a response (see &ldquo;Third parties we work with&rdquo; below); we do not use this data to train any AI
        model.
      </p>
      <p>
        <strong>Notifications.</strong> If you opt in to browser or app notifications (for example, a waitlist alert when a table opens up), we
        store the minimum technical identifier needed to deliver that notification to your device.
      </p>
      <p>
        <strong>Usage data.</strong> Like most web services, our hosting and analytics infrastructure automatically logs basic technical
        information (such as IP address and browser type) for security and reliability purposes.
      </p>

      <h2 style={sectionHeadingStyle}>Payments</h2>
      <p>
        Card payments (for deposits or platform subscription billing) are processed entirely by Stripe. ReservX never receives or stores your
        card number, expiry date, or CVC — Stripe handles that directly, and we only keep a reference to the payment (its status and amount) so
        staff can see whether a deposit was taken.
      </p>

      <h2 style={sectionHeadingStyle}>Third parties we work with</h2>
      <p>We rely on the following service providers (&ldquo;processors&rdquo;) to run ReservX. Each only receives the data it needs to do its job:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Supabase</strong> — database, authentication, and file storage for the whole platform.
        </li>
        <li>
          <strong>Stripe</strong> — payment processing for deposits and subscription billing.
        </li>
        <li>
          <strong>Resend</strong> — delivery of transactional emails (booking confirmations, reminders, cancellations).
        </li>
        <li>
          <strong>Twilio</strong> — delivery of transactional SMS messages, for restaurants that have this enabled.
        </li>
        <li>
          <strong>Anthropic</strong> — powers the optional AI assistant feature described above.
        </li>
        <li>
          <strong>Vercel</strong> — hosts our website and public booking pages.
        </li>
      </ul>
      <p>We do not sell personal data, and we do not share it with anyone for their own marketing purposes.</p>

      <h2 style={sectionHeadingStyle}>How long we keep data</h2>
      <p>
        We keep reservation and account data for as long as the restaurant&apos;s account is active, so staff can see booking history and guests
        can be recognized on a return visit. You can ask us to delete your personal data at any time by contacting us at the email above; we&apos;ll
        remove it unless we&apos;re required to keep it for a legitimate reason (for example, financial records Stripe or tax law requires us to
        retain).
      </p>

      <h2 style={sectionHeadingStyle}>Your choices</h2>
      <p>
        You can ask to see, correct, or delete the personal data we hold about you, and you can withdraw consent for optional features (like SMS
        or push notifications) at any time. Contact us at the email above to make any of these requests.
      </p>

      <h2 style={sectionHeadingStyle}>Children</h2>
      <p>ReservX is not directed at children, and we do not knowingly collect personal data from anyone under 16.</p>

      <h2 style={sectionHeadingStyle}>Changes to this policy</h2>
      <p>If this policy changes in a meaningful way, we&apos;ll update the date at the top of this page.</p>
    </div>
  );
}

const sectionHeadingStyle = { fontSize: 20, fontWeight: 600, marginTop: 36, marginBottom: 8 } as const;
