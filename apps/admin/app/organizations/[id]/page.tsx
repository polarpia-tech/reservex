'use client';

import {
  fetchAdminOrganizations,
  fetchAdminRestaurants,
  fetchOrganizationSubscriptionHistory,
  fetchSubscriptionPlans,
  setOrganizationSubscription,
  suspendRestaurant,
  unsuspendRestaurant,
  type AdminOrganizationSummary,
  type AdminRestaurantSummary,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@reservex/core';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';

import { inputStyle, primaryButtonStyle, secondaryButtonStyle } from '@/components/AdminGate';
import { useAdminSession } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'cancelled', 'paused'];

/**
 * Single-organization detail screen: its restaurants (with suspend/
 * unsuspend), and its subscription (manual override form + full history).
 *
 * There is no admin_get_organization(id) RPC -- admin_list_organizations()
 * returns every organization with no id filter (see its own comment in
 * migration 0020: this is a small, cross-tenant admin listing, not
 * per-tenant data that needed a scoped read). Rather than add a second RPC
 * just to fetch one row, this page re-uses the list call and finds the
 * matching row client-side -- an acceptable cost at the platform's current
 * size (2-3 pilot restaurants), same judgment call as the client-side
 * search on the Organizations list page.
 */
export default function OrganizationDetailPage({ params }: { params: { id: string } }) {
  useAdminSession();
  const organizationId = params.id;

  const [organization, setOrganization] = useState<AdminOrganizationSummary | null>(null);
  const [orgLoaded, setOrgLoaded] = useState(false);

  const [restaurants, setRestaurants] = useState<AdminRestaurantSummary[]>([]);
  const [restaurantsLoaded, setRestaurantsLoaded] = useState(false);
  const [busyRestaurantId, setBusyRestaurantId] = useState<string | null>(null);

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [history, setHistory] = useState<Subscription[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [planCode, setPlanCode] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus>('active');
  const [trialEndsAt, setTrialEndsAt] = useState('');
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState('');
  const [reason, setReason] = useState('');
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    fetchAdminOrganizations(client)
      .then((orgs) => setOrganization(orgs.find((o) => o.organizationId === organizationId) ?? null))
      .catch((e: Error) => setError(e.message))
      .finally(() => setOrgLoaded(true));

    fetchAdminRestaurants(client, organizationId)
      .then(setRestaurants)
      .catch((e: Error) => setError(e.message))
      .finally(() => setRestaurantsLoaded(true));

    void fetchSubscriptionPlans(client).then(setPlans);
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  function refreshHistory() {
    const client = getSupabaseBrowserClient();
    setHistoryLoaded(false);
    fetchOrganizationSubscriptionHistory(client, organizationId)
      .then(setHistory)
      .catch((e: Error) => setError(e.message))
      .finally(() => setHistoryLoaded(true));
  }

  async function handleSuspend(restaurantId: string) {
    const reasonText = window.prompt('Reason for suspending this restaurant (required, shown to no one but platform admins):');
    if (reasonText === null) return;
    if (!reasonText.trim()) {
      window.alert('A reason is required.');
      return;
    }
    setBusyRestaurantId(restaurantId);
    try {
      const client = getSupabaseBrowserClient();
      await suspendRestaurant(client, restaurantId, reasonText.trim());
      setRestaurants((prev) =>
        prev.map((r) => (r.restaurantId === restaurantId ? { ...r, suspendedByPlatformAt: new Date().toISOString(), suspensionReason: reasonText.trim() } : r)),
      );
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusyRestaurantId(null);
    }
  }

  async function handleUnsuspend(restaurantId: string) {
    setBusyRestaurantId(restaurantId);
    try {
      const client = getSupabaseBrowserClient();
      await unsuspendRestaurant(client, restaurantId);
      setRestaurants((prev) => prev.map((r) => (r.restaurantId === restaurantId ? { ...r, suspendedByPlatformAt: null, suspensionReason: null } : r)));
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusyRestaurantId(null);
    }
  }

  async function handleSetSubscription(event: FormEvent) {
    event.preventDefault();
    setSubscriptionError(null);
    setSubscriptionBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      await setOrganizationSubscription(client, {
        organizationId,
        planCode,
        status,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd).toISOString() : null,
        reason: reason.trim() || null,
      });
      setReason('');
      refreshHistory();
      fetchAdminOrganizations(client).then((orgs) => setOrganization(orgs.find((o) => o.organizationId === organizationId) ?? null));
    } catch (e) {
      setSubscriptionError((e as Error).message);
    } finally {
      setSubscriptionBusy(false);
    }
  }

  if (!orgLoaded) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)', maxWidth: 900 }}>
      <div>
        <Link href="/organizations" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
          ← Organizations
        </Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 0' }}>{organization?.organizationName ?? 'Unknown organization'}</h1>
        {organization && <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 14 }}>{organization.ownerEmail}</p>}
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <section>
        <h2 style={sectionTitleStyle}>Restaurants</h2>
        {restaurantsLoaded && restaurants.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No restaurants.</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {restaurants.map((restaurant) => {
            const suspended = Boolean(restaurant.suspendedByPlatformAt);
            return (
              <li key={restaurant.restaurantId} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {restaurant.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>({restaurant.restaurantType})</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {restaurant.city ?? '—'} · {restaurant.slug}
                    </div>
                    {suspended && (
                      <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}>
                        Suspended by platform: {restaurant.suspensionReason}
                      </div>
                    )}
                    {!suspended && !restaurant.isActive && (
                      <div style={{ color: 'var(--warning)', fontSize: 13, marginTop: 4 }}>Paused by owner (not a platform suspension)</div>
                    )}
                  </div>
                  {suspended ? (
                    <button type="button" onClick={() => handleUnsuspend(restaurant.restaurantId)} disabled={busyRestaurantId === restaurant.restaurantId} style={secondaryButtonStyle}>
                      Unsuspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSuspend(restaurant.restaurantId)}
                      disabled={busyRestaurantId === restaurant.restaurantId}
                      style={{ ...secondaryButtonStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    >
                      Suspend
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 style={sectionTitleStyle}>Set subscription</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          Manual override -- no Stripe involved. Retires any existing active subscription and starts a new one. Use this for pilot restaurants, comped
          plans, or correcting a broken Stripe state; a reason is recommended (goes into the audit log).
        </p>
        <form onSubmit={handleSetSubscription} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: 420 }}>
          <label style={fieldLabelStyle}>
            Plan
            <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} required style={inputStyle}>
              <option value="" disabled>
                Select a plan...
              </option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.code}>
                  {plan.name} ({plan.code})
                </option>
              ))}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)} style={inputStyle}>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Trial ends at (optional)
            <input type="date" value={trialEndsAt} onChange={(e) => setTrialEndsAt(e.target.value)} style={inputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            Current period end (optional)
            <input type="date" value={currentPeriodEnd} onChange={(e) => setCurrentPeriodEnd(e.target.value)} style={inputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            Reason (recorded in the audit log)
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
          </label>
          {subscriptionError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{subscriptionError}</p>}
          <button type="submit" disabled={subscriptionBusy || !planCode} style={primaryButtonStyle}>
            Apply subscription
          </button>
        </form>
      </section>

      <section>
        <h2 style={sectionTitleStyle}>Subscription history</h2>
        {historyLoaded && history.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No subscriptions yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {history.map((sub) => (
            <li key={sub.id} style={{ ...cardStyle, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <span style={{ fontWeight: 600 }}>{sub.status}</span>{' '}
                <span style={{ color: 'var(--text-muted)' }}>{plans.find((p) => p.id === sub.planId)?.name ?? sub.planId}</span>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {sub.currentPeriodEnd ? `until ${new Date(sub.currentPeriodEnd).toLocaleDateString()}` : sub.trialEndsAt ? `trial until ${new Date(sub.trialEndsAt).toLocaleDateString()}` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const sectionTitleStyle: CSSProperties = { fontSize: 16, marginBottom: 'var(--space-sm)' };

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-lg)',
  background: 'var(--surface)',
};

const fieldLabelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' };
