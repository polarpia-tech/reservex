/**
 * Phase 14: shown by public/sw.js when a page navigation fails outright
 * (no connection) and there is no cached version to fall back to for the
 * page the visitor was trying to reach. Deliberately locale-neutral
 * plain English/minimal text, not wired into the app/[locale] dictionary
 * system -- this page must work from a service worker's own offline
 * cache with zero network calls, including no ability to know which
 * locale the visitor had last selected. A short, universally-parseable
 * message beats guessing a language, or forcing a fetch to find out.
 */
export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-md)',
        padding: 'var(--space-2xl)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 22, margin: 0 }}>You&apos;re offline</h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: 320, margin: 0 }}>
        ReservX needs a connection to show real-time availability. Please check your connection and try again.
      </p>
    </div>
  );
}
