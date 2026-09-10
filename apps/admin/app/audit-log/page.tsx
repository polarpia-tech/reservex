'use client';

import { fetchAuditLogs, type AuditLogEntry, type AuditLogFilters } from '@reservex/core';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import { inputStyle, primaryButtonStyle, secondaryButtonStyle } from '@/components/AdminGate';
import { useAdminSession } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

const PAGE_SIZE = 50;

/**
 * Phase 18: the audit log viewer that was missing entirely -- admin_*
 * write functions (0020) have written to audit_logs since Phase 13, but
 * there was no platform-admin read path into it at all until migration
 * 0041 (admin_list_audit_logs, plus the additive audit_logs_platform_select
 * RLS policy). View access is universal -- any active admin, any role,
 * including read_only_admin -- consistent with the Admins page's own
 * roster (transparency over secrecy for a small internal team).
 *
 * Filters are plain text/date inputs, not pickers, same judgment call the
 * Feature flags page already made for org/restaurant ids: this is a
 * low-volume admin tool at the platform's current pilot size, and the
 * Organizations page is one click away for looking an id up. Offset-based
 * "Load more" pagination rather than a full pager, for the same reason.
 */
export default function AuditLogPage() {
  useAdminSession(); // ensures this only renders inside the authorized gate

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [restaurantId, setRestaurantId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [actionPrefix, setActionPrefix] = useState('');
  const [entityType, setEntityType] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  function buildFilters(offset: number): AuditLogFilters {
    return {
      restaurantId: restaurantId.trim() || null,
      organizationId: organizationId.trim() || null,
      actionPrefix: actionPrefix.trim() || null,
      entityType: entityType.trim() || null,
      since: since ? new Date(since).toISOString() : null,
      until: until ? new Date(until).toISOString() : null,
      limit: PAGE_SIZE,
      offset,
    };
  }

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setLoaded(false);
    try {
      const client = getSupabaseBrowserClient();
      const rows = await fetchAuditLogs(client, buildFilters(0));
      setEntries(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const client = getSupabaseBrowserClient();
      const rows = await fetchAuditLogs(client, buildFilters(entries.length));
      setEntries((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  // Initial load, unfiltered.
  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)', maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Audit log</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
        Every sensitive admin_* action (restaurant suspension, subscription overrides, admin grants/revokes, feature-flag changes) writes a row here.
        Append-only -- nothing shown here can be edited or deleted from this UI.
      </p>

      <form onSubmit={runSearch} style={filterRowStyle}>
        <FilterField label="Restaurant id">
          <input type="text" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} style={{ ...inputStyle, width: 220 }} />
        </FilterField>
        <FilterField label="Organization id">
          <input type="text" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} style={{ ...inputStyle, width: 220 }} />
        </FilterField>
        <FilterField label="Action prefix">
          <input type="text" value={actionPrefix} onChange={(e) => setActionPrefix(e.target.value)} placeholder="e.g. restaurant." style={{ ...inputStyle, width: 160 }} />
        </FilterField>
        <FilterField label="Entity type">
          <input type="text" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. reservation" style={{ ...inputStyle, width: 160 }} />
        </FilterField>
        <FilterField label="Since">
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={inputStyle} />
        </FilterField>
        <FilterField label="Until">
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={inputStyle} />
        </FilterField>
        <button type="submit" style={primaryButtonStyle}>
          Search
        </button>
      </form>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {loaded && entries.length === 0 && !error && <p style={{ color: 'var(--text-muted)' }}>No audit log entries match these filters.</p>}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {entries.map((entry) => {
          const expanded = expandedId === entry.id;
          const hasPayload = Boolean(entry.beforeData || entry.afterData);
          return (
            <li key={entry.id} style={entryCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 13 }}>{entry.action}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 2 }}>
                    {entry.entityType}
                    {entry.entityId ? ` · ${entry.entityId}` : ''}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 2 }}>
                    {entry.actorType === 'user' ? entry.actorEmail ?? 'unknown user' : entry.actorType}
                    {entry.restaurantName ? ` · ${entry.restaurantName}` : entry.organizationName ? ` · ${entry.organizationName}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                  {hasPayload && (
                    <button type="button" onClick={() => setExpandedId(expanded ? null : entry.id)} style={{ ...secondaryButtonStyle, marginTop: 6, fontSize: 12, padding: '4px 10px' }}>
                      {expanded ? 'Hide details' : 'Details'}
                    </button>
                  )}
                </div>
              </div>
              {expanded && hasPayload && (
                <div style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)', display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: entry.beforeData && entry.afterData ? '1fr 1fr' : '1fr' }}>
                  {entry.beforeData && <PayloadBlock label="Before" data={entry.beforeData} />}
                  {entry.afterData && <PayloadBlock label="After" data={entry.afterData} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore} style={{ ...secondaryButtonStyle, alignSelf: 'center' }}>
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
      {label}
      {children}
    </label>
  );
}

function PayloadBlock({ label, data }: { label: string; data: Record<string, unknown> }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

const filterRowStyle: CSSProperties = { display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' };

const entryCardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-md)',
  background: 'var(--surface)',
};

const preStyle: CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-sm)',
  overflowX: 'auto',
  maxHeight: 220,
  overflowY: 'auto',
};
