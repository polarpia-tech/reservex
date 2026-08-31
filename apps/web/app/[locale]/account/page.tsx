'use client';

import {
  ensureMyCustomerProfile,
  fetchMyNotificationsAsCustomer,
  fetchMyReservationsAsCustomer,
  markNotificationRead,
  updateReservationStatus,
  type MyReservation,
  type Notification,
} from '@reservex/core';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatDateTimeInTimeZone } from '@/lib/timezone';

const STATUS_KEY: Record<string, string> = {
  pending: 'reservations.status.pending',
  confirmed: 'reservations.status.confirmed',
  seated: 'reservations.status.seated',
  completed: 'reservations.status.completed',
  cancelled: 'reservations.status.cancelled',
  no_show: 'reservations.status.no_show',
};

const CANCELLABLE_STATUSES = new Set(['pending', 'confirmed']);

/**
 * Customer login/signup + "my reservations" + self-cancel, all in one page.
 * Fully client-side: this is the one place in the web app that needs the
 * browser's own Supabase auth session end to end (signUp/signInWithPassword
 * are called directly here, same established pattern as the mobile app's
 * staff auth screens -- see api/customerAccount.ts's file comment for why
 * that's not wrapped in @reservex/core).
 *
 * Deliberately NOT built in Phase 08 (see the README): self-service
 * reschedule (only cancel), password reset flow (exists for staff on
 * mobile; a customer with a forgotten password has to be handled as a
 * follow-up), and email confirmation UX beyond Supabase's default.
 */
export default function AccountPage({ params }: { params: { locale: string } }) {
  if (!isSupportedLocale(params.locale)) return null;
  const locale: SupportedLocale = params.locale;
  const dict = getDictionary(locale);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [reservationsLoaded, setReservationsLoaded] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const client = getSupabaseBrowserClient();
    void ensureMyCustomerProfile(client).then((profile) => {
      setFullName(profile.fullName ?? '');
      setPhone(profile.phone ?? '');
      setMarketingOptIn(profile.marketingOptIn);
    });
    void fetchMyReservationsAsCustomer(client).then((rows) => {
      setReservations(rows);
      setReservationsLoaded(true);
    });
    void fetchMyNotificationsAsCustomer(client).then((rows) => {
      setNotifications(rows);
      setNotificationsLoaded(true);
    });
  }, [session]);

  async function handleMarkNotificationRead(notificationId: string) {
    const client = getSupabaseBrowserClient();
    await markNotificationRead(client, notificationId);
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, status: 'read' } : n)));
  }

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    const client = getSupabaseBrowserClient();
    const { error } = mode === 'login' ? await client.auth.signInWithPassword({ email, password }) : await client.auth.signUp({ email, password });
    setAuthBusy(false);
    if (error) setAuthError(error.message);
  }

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileSaved(false);
    const client = getSupabaseBrowserClient();
    await ensureMyCustomerProfile(client, { fullName: fullName || null, phone: phone || null, marketingOptIn });
    setProfileSaved(true);
  }

  async function handleCancel(reservationId: string) {
    setCancellingId(reservationId);
    const client = getSupabaseBrowserClient();
    try {
      await updateReservationStatus(client, reservationId, 'cancelled');
      setReservations((prev) => prev.map((r) => (r.id === reservationId ? { ...r, status: 'cancelled' } : r)));
    } finally {
      setCancellingId(null);
    }
  }

  async function handleSignOut() {
    await getSupabaseBrowserClient().auth.signOut();
    setReservations([]);
    setReservationsLoaded(false);
  }

  if (!sessionLoaded) return null;

  if (!session) {
    return (
      <div style={{ maxWidth: 360, margin: '0 auto', padding: 'var(--space-2xl)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
          <TabButton active={mode === 'login'} onClick={() => setMode('login')} label={t(dict, 'public.account.loginTab')} />
          <TabButton active={mode === 'signup'} onClick={() => setMode('signup')} label={t(dict, 'public.account.signUpTab')} />
        </div>
        <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <Field label={t(dict, 'auth.email')}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          </Field>
          <Field label={t(dict, 'auth.password')}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={inputStyle} />
          </Field>
          {authError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{authError}</p>}
          <button type="submit" disabled={authBusy} style={primaryButtonStyle}>
            {mode === 'login' ? t(dict, 'auth.login') : t(dict, 'auth.createAccount')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-2xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{t(dict, 'public.account.title')}</h1>
        <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
          {t(dict, 'public.account.signOut')}
        </button>
      </div>

      <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
          <Field label={t(dict, 'public.account.fullName')}>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={t(dict, 'public.account.phone')}>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
          {t(dict, 'public.account.marketingOptIn')}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <button type="submit" style={primaryButtonStyle}>
            {t(dict, 'public.account.saveProfile')}
          </button>
          {profileSaved && <span style={{ color: 'var(--success)', fontSize: 13 }}>{t(dict, 'public.account.profileSaved')}</span>}
        </div>
      </form>

      <section>
        <h2 style={{ fontSize: 18 }}>{t(dict, 'public.account.myReservationsTitle')}</h2>
        {reservationsLoaded && reservations.length === 0 && <p style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.account.noReservations')}</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {reservations.map((reservation) => (
            <li
              key={reservation.id}
              style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', background: 'var(--surface)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{reservation.restaurantName ?? '—'}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    {/* Shown in the VISITOR's own local time here (unlike the booking
                        confirmation screen, which deliberately uses the restaurant's
                        timezone) -- this list has no restaurant timezone to hand without
                        an extra join, and a customer reviewing their own history is best
                        served by their own clock anyway. */}
                    {new Date(reservation.startsAt).toLocaleString(locale)}
                  </div>
                  <div style={{ fontSize: 13 }}>{t(dict, STATUS_KEY[reservation.status] ?? 'reservations.status.pending')} · {reservation.partySize}</div>
                </div>
                {CANCELLABLE_STATUSES.has(reservation.status) && (
                  <button type="button" onClick={() => handleCancel(reservation.id)} disabled={cancellingId === reservation.id} style={secondaryButtonStyle}>
                    {t(dict, 'public.account.cancelButton')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>{t(dict, 'public.account.notificationsTitle')}</h2>
        {notificationsLoaded && notifications.length === 0 && <p style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.account.noNotifications')}</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {notifications.map((notification) => {
            const isUnread = notification.status !== 'read';
            return (
              <li
                key={notification.id}
                onClick={() => isUnread && handleMarkNotificationRead(notification.id)}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-md)',
                  background: isUnread ? 'var(--surface-elevated)' : 'var(--surface)',
                  fontSize: 13,
                  cursor: isUnread ? 'pointer' : 'default',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--space-md)',
                }}
              >
                <span style={{ fontWeight: isUnread ? 700 : 400 }}>{t(dict, `notifications.templates.${notification.templateCode}`)}</span>
                <span style={{ color: 'var(--text-muted)' }}>{new Date(notification.createdAt).toLocaleString(locale)}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 14,
  color: 'var(--text-primary)',
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 10px',
};

const primaryButtonStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--surface)',
  border: 'none',
  borderRadius: 'var(--radius-full)',
  padding: '10px 18px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  background: 'none',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-full)',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
