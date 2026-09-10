'use client';

import {
  fetchAdminOrganizations,
  fetchAdminRestaurants,
  fetchAuditLogs,
  fetchFeatureFlags,
  fetchPlatformAdmins,
  PLATFORM_ADMIN_ROLE_LABELS,
  type AdminOrganizationSummary,
  type AdminRestaurantSummary,
  type AuditLogEntry,
  type FeatureFlag,
  type PlatformAdmin,
} from '@reservex/core';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { useAdminSession } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

const RECENT_ACTIVITY_LIMIT = 8;

/**
 * Phase 19: the actual home screen -- app/page.tsx used to just redirect
 * straight to /organizations (no dashboard content of its own, per that
 * file's old comment). This replaces the redirect with a real platform
 * overview, built entirely from RPCs/reads that already existed before
 * this phase (admin_list_organizations, admin_list_restaurants,
 * admin_list_platform_admins, feature_flags_select, admin_list_audit_logs
 * from 0041) -- no new migration, no new privileged surface. Every number
 * here is derived client-side from those four lists; at the platform's
 * current pilot size (2-3 organizations) that is simpler and cheaper than
 * a dedicated aggregate RPC, and it stays trivially consistent with the
 * Organizations/Restaurants/Admins/Feature flags pages, which fetch the
 * exact same data. Revisit with a real admin_get_dashboard_summary() RPC
 * if the roster grows large enough that fetching full lists client-side
 * becomes slow.
 *
 * View-only, like every other page in this app except the explicit
 * suspend/subscription/grant actions -- available to every active admin
 * role, including read_only_admin, consistent with Phase 18's "view stays
 * universal" design for the audit log.
 */
export default function DashboardPage() {
  useAdminSession(); // ensures this only renders inside the authorized gate

  const [organizations, setOrganizations] = useState<AdminOrganizationSummary[]>([]);
  const [restaurants, setRestaurants] = useState<AdminRestaurantSummary[]>([]);
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    Promise.all([
      fetchAdminOrganizations(client),
      fetchAdminRestaurants(client, null),
      fetchPlatformAdmins(client),
      fetchFeatureFlags(client),
      fetchAuditLogs(client, { limit: RECENT_ACTIVITY_LIMIT }),
    ])
      .then(([orgs, rests, adminRoster, flagList, activity]) => {
        setOrganizations(orgs);
        setRestaurants(rests);
        setAdmins(adminRoster);
        setFlags(flagList);
        setRecentActivity(activity);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  if (error) {
    return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  }

  if (!loaded) {
    return <p style={{ color: 'var(--text-muted)' }}>Loading platform overview...</p>;
  }

  const suspendedRestaurants = restaurants.filter((r) => r.suspendedByPlatformAt !== null);
  const activeAdmins = admins.filter((a) => a.isActive);
  const adminsByRole = new Map<string, number>();
  for (const admin of activeAdmins) {
    adminsByRole.set(admin.role, (adminsByRole.get(admin.role) ?? 0) + 1);
  }

  const subscriptionCounts = new Map<string, number>();
  for (const org of organizations) {
    const key = org.subscriptionStatus ?? 'no subscription';
    subscriptionCounts.set(key, (subscriptionCounts.get(key) ?? 0) + 1);
  }

  const enabledFlagCount = flags.filter((f) => f.isEnabledDefault).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
      <div>
        <h1 style={{ fontSize: 22, margin: 0 }}>Platform overview</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>ReservX, across every organization and restaurant.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-lg)' }}>
        <StatCard label="Organizations" value={organizations.length} href="/organizations" />
        <StatCard
          label="Restaurants"
          value={restaurants.length}
          href="/organizations"
          sub={suspendedRestaurants.length > 0 ? `${suspendedRestaurants.length} suspended` : 'none suspended'}
          subTone={suspendedRestaurants.length > 0 ? 'danger' : 'muted'}
        />
        <StatCard label="Active admins" value={activeAdmins.length} href="/admins" />
        <StatCard label="Feature flags" value={flags.length} href="/feature-flags" sub={`${enabledFlagCount} enabled by default`} subTone="muted" />
      </div>

      <Card title="Subscriptions by status">
        {subscriptionCounts.size === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No organizations yet.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            {[...subscriptionCounts.entries()].map(([status, count]) => (
              <div key={status} style={pillStyle}>
                <SubscriptionDot status={status} />
                <span style={{ textTransform: 'capitalize' }}>{status}</span>
                <span style={{ color: 'var(--text-muted)' }}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-lg)' }}>
        <Card title="Suspended restaurants">
          {suspendedRestaurants.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No restaurants are currently suspended.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {suspendedRestaurants.map((r) => (
                <li key={r.restaurantId}>
                  <Link href={`/organizations/${r.organizationId}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
                    {r.name}
                  </Link>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 2 }}>
                    {r.suspensionReason ?? 'no reason recorded'}
                    {r.suspendedByPlatformAt ? ` · ${new Date(r.suspendedByPlatformAt).toLocaleDateString()}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" action={<Link href="/audit-log" style={{ color: 'var(--accent)', fontSize: 12.5, textDecoration: 'none' }}>View full log →</Link>}>
          {recentActivity.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No audit log activity yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {recentActivity.map((entry) => (
                <li key={entry.id}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600 }}>{entry.action}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                    {entry.actorType === 'user' ? entry.actorEmail ?? 'unknown user' : entry.actorType}
                    {entry.restaurantName ? ` · ${entry.restaurantName}` : entry.organizationName ? ` · ${entry.organizationName}` : ''}
                    {' · '}
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {activeAdmins.length > 0 && (
        <Card title="Admin roster by role">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            {[...adminsByRole.entries()].map(([role, count]) => (
              <div key={role} style={pillStyle}>
                <span>{PLATFORM_ADMIN_ROLE_LABELS[role as keyof typeof PLATFORM_ADMIN_ROLE_LABELS] ?? role}</span>
                <span style={{ color: 'var(--text-muted)' }}>{count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  sub,
  subTone,
}: {
  label: string;
  value: number;
  href: string;
  sub?: string;
  subTone?: 'muted' | 'danger';
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={statCardStyle}>
        <div style={{ color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6 }}>{value}</div>
        {sub && <div style={{ fontSize: 12.5, marginTop: 4, color: subTone === 'danger' ? 'var(--danger)' : 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </Link>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function SubscriptionDot({ status }: { status: string }) {
  const color =
    status === 'active' || status === 'trialing'
      ? 'var(--success)'
      : status === 'past_due'
        ? 'var(--warning)'
        : status === 'no subscription'
          ? 'var(--text-muted)'
          : 'var(--danger)';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />;
}

const statCardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-lg)',
  background: 'var(--surface)',
};

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-lg)',
  background: 'var(--surface)',
};

const pillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-full)',
  padding: '6px 14px',
  fontSize: 13,
  background: 'var(--surface-elevated)',
};
