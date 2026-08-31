'use client';

import { isPlatformAdmin, isPlatformSuperAdmin } from '@reservex/core';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import { AdminSessionContext } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

const NAV_LINKS = [
  { href: '/organizations', label: 'Organizations' },
  { href: '/feature-flags', label: 'Feature flags' },
  { href: '/admins', label: 'Admins' },
];

/**
 * Wraps the whole app (see app/layout.tsx) with a single combined gate --
 * deliberately not a separate /login route + per-page redirects, since
 * there is nothing else in this app that would ever link to a standalone
 * login page, and one gate is simpler to reason about. Three states:
 *
 *   1. No Supabase session -> inline email/password login/signup form.
 *      Signing up here only creates an ordinary auth.users row -- it does
 *      NOT grant platform admin access. There is no self-service "become
 *      an admin" path by design (see migration 0020's header comment and
 *      the Phase 13 README): an existing super_admin has to grant access
 *      via admin_grant_platform_admin (Admins page), or the very first
 *      admin is provisioned by a manual DB insert.
 *   2. Session exists but is_platform_admin() is false -> "not authorized"
 *      screen with a sign-out button. No further UI is reachable.
 *   3. Session exists and is_platform_admin() is true -> the nav bar +
 *      children render, with session/isSuperAdmin available to any
 *      descendant via useAdminSession(). Pages that need super_admin-only
 *      actions (granting/revoking other admins) check isSuperAdmin
 *      themselves and hide those controls otherwise -- the RPCs enforce
 *      the same check server-side regardless, this is just UI polish.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAdminChecked(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const client = getSupabaseBrowserClient();
    let cancelled = false;
    void Promise.all([isPlatformAdmin(client), isPlatformSuperAdmin(client)]).then(([admin, superAdmin]) => {
      if (cancelled) return;
      setIsAdmin(admin);
      setIsSuperAdmin(superAdmin);
      setAdminChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    const client = getSupabaseBrowserClient();
    const { error } = mode === 'login' ? await client.auth.signInWithPassword({ email, password }) : await client.auth.signUp({ email, password });
    setAuthBusy(false);
    if (error) setAuthError(error.message);
  }

  async function handleSignOut() {
    await getSupabaseBrowserClient().auth.signOut();
    setAdminChecked(false);
    setIsAdmin(false);
    setIsSuperAdmin(false);
  }

  if (!sessionLoaded) return null;

  if (!session) {
    return (
      <div style={centeredWrapStyle}>
        <h1 style={{ fontSize: 20, marginBottom: 'var(--space-lg)' }}>ReservX Admin</h1>
        <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
          <TabButton active={mode === 'login'} onClick={() => setMode('login')} label="Log in" />
          <TabButton active={mode === 'signup'} onClick={() => setMode('signup')} label="Sign up" />
        </div>
        <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={inputStyle} />
          </Field>
          {authError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{authError}</p>}
          <button type="submit" disabled={authBusy} style={primaryButtonStyle}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        {mode === 'signup' && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 'var(--space-md)' }}>
            Creating an account does not grant platform admin access by itself -- an existing super_admin still has to grant it.
          </p>
        )}
      </div>
    );
  }

  if (!adminChecked) return null;

  if (!isAdmin) {
    return (
      <div style={centeredWrapStyle}>
        <h1 style={{ fontSize: 20, marginBottom: 'var(--space-md)' }}>Not authorized</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          {session.user.email} is not a ReservX platform admin. If you believe this is a mistake, ask an existing super_admin to grant you access.
        </p>
        <button type="button" onClick={handleSignOut} style={{ ...secondaryButtonStyle, marginTop: 'var(--space-lg)' }}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <AdminSessionContext.Provider value={{ session, isSuperAdmin, signOut: handleSignOut }}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <nav
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            padding: 'var(--space-xl)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-xs)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 'var(--space-lg)', color: 'var(--accent)' }}>ReservX Admin</div>
          {NAV_LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                  textDecoration: 'none',
                  fontWeight: active ? 700 : 400,
                  background: active ? 'var(--surface-elevated)' : 'transparent',
                  color: 'var(--text-primary)',
                }}
              >
                {link.label}
              </Link>
            );
          })}
          <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <span>
              {session.user.email}
              {isSuperAdmin ? ' (super_admin)' : ''}
            </span>
            <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
              Sign out
            </button>
          </div>
        </nav>
        <main style={{ flex: 1, padding: 'var(--space-2xl)', overflowX: 'auto' }}>{children}</main>
      </div>
    </AdminSessionContext.Provider>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 0',
        fontWeight: active ? 700 : 400,
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid var(--border)',
        cursor: 'pointer',
        color: 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' }}>
      {label}
      {children}
    </label>
  );
}

const centeredWrapStyle: CSSProperties = { maxWidth: 360, margin: '80px auto', padding: 'var(--space-2xl)' };

export const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 14,
  color: 'var(--text-primary)',
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 10px',
};

export const primaryButtonStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--surface)',
  border: 'none',
  borderRadius: 'var(--radius-full)',
  padding: '10px 18px',
  fontWeight: 600,
  cursor: 'pointer',
};

export const secondaryButtonStyle: CSSProperties = {
  background: 'none',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-full)',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

export const dangerButtonStyle: CSSProperties = {
  background: 'none',
  color: 'var(--danger)',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-full)',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
