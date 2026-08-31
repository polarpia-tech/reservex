'use client';

import { fetchAdminOrganizations, type AdminOrganizationSummary } from '@reservex/core';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { inputStyle } from '@/components/AdminGate';
import { useAdminSession } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * admin_list_organizations() -- every organization on the platform, one row
 * each, with owner email + current subscription. Client-side search only
 * (name/owner email substring match): the platform has 2-3 pilot
 * restaurants right now, and admin_list_organizations has no pagination or
 * server-side filter of its own -- adding one is not worth the complexity
 * yet. Revisit if/when the roster grows large enough that this becomes
 * slow.
 */
export default function OrganizationsPage() {
  useAdminSession(); // ensures this only renders inside the authorized gate

  const [organizations, setOrganizations] = useState<AdminOrganizationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    fetchAdminOrganizations(client)
      .then(setOrganizations)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return organizations;
    return organizations.filter(
      (org) => org.organizationName.toLowerCase().includes(needle) || org.ownerEmail.toLowerCase().includes(needle),
    );
  }, [organizations, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Organizations</h1>
        <input
          type="search"
          placeholder="Search by name or owner email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 280 }}
        />
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {loaded && filtered.length === 0 && !error && <p style={{ color: 'var(--text-muted)' }}>No organizations found.</p>}

      {filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <Th>Organization</Th>
              <Th>Owner</Th>
              <Th>Restaurants</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((org) => (
              <tr key={org.organizationId} style={{ borderBottom: '1px solid var(--border)' }}>
                <Td>
                  <Link href={`/organizations/${org.organizationId}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                    {org.organizationName}
                  </Link>
                </Td>
                <Td>{org.ownerEmail}</Td>
                <Td>{org.restaurantCount}</Td>
                <Td>{org.planCode ?? '—'}</Td>
                <Td>
                  <StatusBadge status={org.subscriptionStatus} />
                </Td>
                <Td>{new Date(org.createdAt).toLocaleDateString()}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminOrganizationSummary['subscriptionStatus'] }) {
  if (!status) return <span style={{ color: 'var(--text-muted)' }}>no subscription</span>;
  const color = status === 'active' || status === 'trialing' ? 'var(--success)' : status === 'past_due' ? 'var(--warning)' : 'var(--danger)';
  return <span style={{ color, fontWeight: 600 }}>{status}</span>;
}

function Th({ children }: { children: ReactNode }) {
  return <th style={{ padding: '8px 12px', fontWeight: 500 }}>{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td style={{ padding: '10px 12px' }}>{children}</td>;
}
