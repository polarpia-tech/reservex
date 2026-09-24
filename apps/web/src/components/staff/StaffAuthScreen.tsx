'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase';
import { buttonStyle, cardStyle } from '@/lib/ui';

const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' };

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 16,
  padding: '12px 14px',
  borderRadius: 'var(--radius-md, 10px)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  width: '100%',
};

/**
 * Login/sign-up for the web staff dashboard (2026-09). Sign-up is new here
 * -- the original /staff page (Phase 24, push notifications only) was
 * deliberately login-only, since back then a staff account only ever came
 * from the mobile app's own (auth)/signup.tsx or an owner invite. Now that
 * this same route is also the ONLY way an iPhone/iPad-only restaurant can
 * onboard (no iOS build exists yet -- see the mobile app's own signup
 * screen), a brand-new owner needs to be able to create their account here
 * too. Same call as the mobile screen: plain supabase.auth.signUp(), no
 * custom backend -- see that screen's own comment on why. Email
 * confirmation is disabled for this Supabase project, so a successful
 * sign-up normally signs the caller in immediately (data.session set); the
 * "check your email" branch is a fallback in case that setting ever
 * changes, not the expected path today.
 */
export function StaffAuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Οι κωδικοί δεν ταιριάζουν.');
      return;
    }
    if (password.length < 6) {
      setError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
      return;
    }

    setBusy(true);
    const client = getSupabaseBrowserClient();
    if (mode === 'login') {
      const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (signInError) setError(mapAuthError(signInError.message));
      return;
    }

    const { data, error: signUpError } = await client.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (signUpError) {
      setError(mapAuthError(signUpError.message));
      return;
    }
    if (!data.session) {
      setNotice('Ελέγξτε το email σας για να επιβεβαιώσετε τον λογαριασμό, μετά συνδεθείτε.');
      setMode('login');
    }
    // If data.session is set, the parent page's onAuthStateChange listener
    // picks it up automatically -- nothing else to do here.
  }

  const pageStyle: CSSProperties = {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(20px, 5vw, 48px)',
    gap: 'var(--space-lg, 20px)',
  };

  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 380, width: '100%' }}>
        <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>ReservX — Προσωπικό</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 16, fontSize: 14 }}>
          {mode === 'login'
            ? 'Σύνδεση με τον λογαριασμό σου (owner/manager) για να διαχειριστείς το εστιατόριο.'
            : 'Δημιούργησε λογαριασμό ιδιοκτήτη για το εστιατόριό σου.'}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => { setMode('login'); setError(null); setNotice(null); }}
            style={{ ...buttonStyle(mode === 'login' ? 'primary' : 'ghost'), flex: 1, fontSize: 13, padding: '8px 10px', minHeight: 36 }}
          >
            Σύνδεση
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
            style={{ ...buttonStyle(mode === 'signup' ? 'primary' : 'ghost'), flex: 1, fontSize: 13, padding: '8px 10px', minHeight: 36 }}
          >
            Εγγραφή (νέο εστιατόριο)
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={fieldStyle}>
            <label htmlFor="staff-email" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Email</label>
            <input id="staff-email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="staff-password" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Κωδικός</label>
            <input
              id="staff-password"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </div>
          {mode === 'signup' ? (
            <div style={fieldStyle}>
              <label htmlFor="staff-password-confirm" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Επιβεβαίωση κωδικού</label>
              <input
                id="staff-password-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
          ) : null}
          {error ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p> : null}
          {notice ? <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{notice}</p> : null}
          <button type="submit" disabled={busy} style={buttonStyle('primary', { disabled: busy, fullWidth: true })}>
            {busy ? 'Ένα λεπτό...' : mode === 'login' ? 'Σύνδεση' : 'Δημιουργία λογαριασμού'}
          </button>
        </form>
      </div>
    </div>
  );
}

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Λάθος email ή κωδικός.';
  if (lower.includes('user already registered')) return 'Υπάρχει ήδη λογαριασμός με αυτό το email — δοκίμασε "Σύνδεση".';
  if (lower.includes('password')) return 'Ο κωδικός δεν πληροί τις απαιτήσεις (τουλάχιστον 6 χαρακτήρες).';
  if (lower.includes('email')) return 'Μη έγκυρο email.';
  return 'Κάτι πήγε στραβά. Δοκίμασε ξανά.';
}
