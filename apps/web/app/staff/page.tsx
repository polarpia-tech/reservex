'use client';

import { fetchMyRestaurants, type MyRestaurantMembership } from '@reservex/core';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type CSSProperties } from 'react';

import { CreateRestaurantForm } from '@/components/staff/CreateRestaurantForm';
import { HelpPanel } from '@/components/staff/HelpPanel';
import { OpeningHoursTab } from '@/components/staff/OpeningHoursTab';
import { ReservationsTab } from '@/components/staff/ReservationsTab';
import { SettingsTab } from '@/components/staff/SettingsTab';
import { StaffAuthScreen } from '@/components/staff/StaffAuthScreen';
import { TablesTab } from '@/components/staff/TablesTab';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type TabKey = 'reservations' | 'hours' | 'tables' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'reservations', label: 'Κρατήσεις' },
  { key: 'hours', label: 'Ωράριο' },
  { key: 'tables', label: 'Τραπέζια' },
  { key: 'settings', label: 'Ρυθμίσεις' },
];

/**
 * Web staff dashboard shell, built 2026-09 so an iPhone/iPad-only
 * restaurant (no iOS build of apps/mobile exists yet -- see that app's own
 * README/eas.json) can run its whole front-of-house workflow from Safari:
 * sign in or sign up, create the restaurant if it doesn't exist yet, then
 * manage reservations/hours/tables/settings. Every tab below is a thin UI
 * over @reservex/core functions the mobile app already uses in production
 * -- this route adds no new backend behaviour, only a second UI for staff
 * who cannot install the Android-only APK.
 *
 * Three-state gate, same shape as the original /staff page's session gate
 * plus one more level (restaurant membership):
 *   1. no session -> StaffAuthScreen (login or sign-up)
 *   2. session but no active restaurant membership -> CreateRestaurantForm
 *   3. session + membership -> the tabbed dashboard
 * Deliberately picks memberships[0] when a user belongs to more than one
 * restaurant -- multi-restaurant switching is a real feature some owners
 * will eventually want, but every restaurant onboarded today has exactly
 * one owner with exactly one restaurant, so building a switcher now would
 * be speculative scope on a same-day deadline.
 */
export default function StaffDashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [memberships, setMemberships] = useState<MyRestaurantMembership[] | null>(null);
  const [membershipsError, setMembershipsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('reservations');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setMemberships(null); // force a re-fetch of memberships for the new session
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const client = getSupabaseBrowserClient();
    setMembershipsError(null);
    fetchMyRestaurants(client, session.user.id)
      .then(setMemberships)
      .catch(() => setMembershipsError('Δεν φορτώθηκαν τα στοιχεία του εστιατορίου. Δοκίμασε ανανέωση της σελίδας.'));
  }, [session]);

  function refetchMemberships() {
    if (!session) return;
    const client = getSupabaseBrowserClient();
    setMemberships(null);
    fetchMyRestaurants(client, session.user.id)
      .then(setMemberships)
      .catch(() => setMembershipsError('Δεν φορτώθηκαν τα στοιχεία του εστιατορίου. Δοκίμασε ανανέωση της σελίδας.'));
  }

  const pageStyle: CSSProperties = { minHeight: '100dvh', display: 'flex', flexDirection: 'column' };

  if (!sessionLoaded) {
    return <div style={pageStyle} />;
  }

  if (!session) {
    return <StaffAuthScreen />;
  }

  if (memberships === null) {
    return (
      <div style={{ ...pageStyle, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {membershipsError ? <p style={{ color: 'var(--danger)', fontSize: 14 }}>{membershipsError}</p> : <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Φόρτωση...</p>}
      </div>
    );
  }

  const membership = memberships[0];

  if (!membership) {
    return <CreateRestaurantForm onCreated={refetchMemberships} />;
  }

  const client = getSupabaseBrowserClient();
  const restaurant = membership.restaurant;

  return (
    <div style={pageStyle}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px clamp(16px, 4vw, 28px)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{restaurant.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>ReservX — Προσωπικό</span>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          aria-label="Βοήθεια"
          style={{
            fontFamily: 'var(--font-family)',
            fontSize: 15,
            fontWeight: 700,
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ?
        </button>
      </header>

      <nav
        style={{
          display: 'flex',
          gap: 4,
          padding: '10px clamp(16px, 4vw, 28px) 0',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          background: 'var(--surface)',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              fontFamily: 'var(--font-family)',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '10px 14px',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
              background: 'none',
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ flex: 1, padding: 'clamp(16px, 4vw, 28px)', maxWidth: 720, width: '100%', margin: '0 auto' }}>
        {activeTab === 'reservations' ? <ReservationsTab client={client} restaurant={restaurant} /> : null}
        {activeTab === 'hours' ? <OpeningHoursTab client={client} restaurant={restaurant} /> : null}
        {activeTab === 'tables' ? <TablesTab client={client} restaurant={restaurant} /> : null}
        {activeTab === 'settings' ? <SettingsTab client={client} restaurant={restaurant} session={session} onProfileUpdated={refetchMemberships} /> : null}
      </main>

      {showHelp ? <HelpPanel restaurant={restaurant} onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
}
