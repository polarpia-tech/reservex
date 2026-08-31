'use client';

import {
  createFeatureFlag,
  deleteFeatureFlag,
  deleteFeatureFlagOverride,
  fetchFeatureFlagOverrides,
  fetchFeatureFlags,
  setFeatureFlagOverride,
  updateFeatureFlag,
  type FeatureFlag,
  type FeatureFlagOverride,
} from '@reservex/core';
import { useEffect, useState, type FormEvent } from 'react';

import { inputStyle, primaryButtonStyle, secondaryButtonStyle, dangerButtonStyle } from '@/components/AdminGate';
import { useAdminSession } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * feature_flags / feature_flag_overrides existed since Phase 02 (migration
 * 0010) with SELECT-only RLS -- Phase 13 adds the write policies
 * (feature_flags_platform_write, feature_flag_overrides_platform_*, see
 * migration 0020). Plain RLS CRUD, not SECURITY DEFINER functions: flags
 * are non-monetary, fully reversible, and touch no auth.users data, so
 * there is nothing here that needs the extra ceremony of an RPC with its
 * own audit-log write.
 *
 * Override targeting (organization_id XOR restaurant_id, enforced by a DB
 * CHECK constraint) is a raw UUID text field rather than an
 * organization/restaurant picker -- this is a rare, low-volume admin
 * action (targeted rollouts/kill-switches), and building a cross-tenant
 * search picker for it is not worth it yet. The Organizations page is one
 * click away for looking up an id.
 */
export default function FeatureFlagsPage() {
  useAdminSession();

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overrides, setOverrides] = useState<FeatureFlagOverride[]>([]);
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [overrideOrgId, setOverrideOrgId] = useState('');
  const [overrideRestaurantId, setOverrideRestaurantId] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(true);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  function refreshFlags() {
    const client = getSupabaseBrowserClient();
    fetchFeatureFlags(client)
      .then(setFlags)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }

  useEffect(refreshFlags, []);

  useEffect(() => {
    if (!selectedFlagId) {
      setOverrides([]);
      return;
    }
    const client = getSupabaseBrowserClient();
    void fetchFeatureFlagOverrides(client, selectedFlagId).then(setOverrides);
  }, [selectedFlagId]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreateBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      await createFeatureFlag(client, { key: newKey.trim(), description: newDescription.trim() || null });
      setNewKey('');
      setNewDescription('');
      refreshFlags();
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleToggleDefault(flag: FeatureFlag) {
    const client = getSupabaseBrowserClient();
    const updated = await updateFeatureFlag(client, flag.id, { isEnabledDefault: !flag.isEnabledDefault });
    setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  async function handleDeleteFlag(flagId: string) {
    if (!window.confirm('Delete this flag? All of its overrides go with it.')) return;
    const client = getSupabaseBrowserClient();
    await deleteFeatureFlag(client, flagId);
    setFlags((prev) => prev.filter((f) => f.id !== flagId));
    if (selectedFlagId === flagId) setSelectedFlagId(null);
  }

  async function handleCreateOverride(event: FormEvent) {
    event.preventDefault();
    if (!selectedFlagId) return;
    setOverrideError(null);
    if (Boolean(overrideOrgId.trim()) === Boolean(overrideRestaurantId.trim())) {
      setOverrideError('Set exactly one of organization id / restaurant id.');
      return;
    }
    setOverrideBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      const created = await setFeatureFlagOverride(client, {
        flagId: selectedFlagId,
        organizationId: overrideOrgId.trim() || null,
        restaurantId: overrideRestaurantId.trim() || null,
        isEnabled: overrideEnabled,
      });
      setOverrides((prev) => [created, ...prev]);
      setOverrideOrgId('');
      setOverrideRestaurantId('');
    } catch (e) {
      setOverrideError((e as Error).message);
    } finally {
      setOverrideBusy(false);
    }
  }

  async function handleDeleteOverride(overrideId: string) {
    const client = getSupabaseBrowserClient();
    await deleteFeatureFlagOverride(client, overrideId);
    setOverrides((prev) => prev.filter((o) => o.id !== overrideId));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)', maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Feature flags</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' }}>
          Key
          <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. ai_waitlist_v2" required style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
          Description
          <input type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} style={inputStyle} />
        </label>
        <button type="submit" disabled={createBusy || !newKey.trim()} style={primaryButtonStyle}>
          Add flag
        </button>
      </form>
      {createError && <p style={{ color: 'var(--danger)', fontSize: 14 }}>{createError}</p>}

      {loaded && flags.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No feature flags yet.</p>}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {flags.map((flag) => (
          <li
            key={flag.id}
            style={{
              border: selectedFlagId === flag.id ? '1px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-lg)',
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{flag.key}</div>
                {flag.description && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{flag.description}</div>}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>rollout: {flag.rolloutPercentage}%</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                <button type="button" onClick={() => handleToggleDefault(flag)} style={secondaryButtonStyle}>
                  default: {flag.isEnabledDefault ? 'on' : 'off'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFlagId(selectedFlagId === flag.id ? null : flag.id)}
                  style={secondaryButtonStyle}
                >
                  {selectedFlagId === flag.id ? 'Hide overrides' : 'Overrides'}
                </button>
                <button type="button" onClick={() => handleDeleteFlag(flag.id)} style={dangerButtonStyle}>
                  Delete
                </button>
              </div>
            </div>

            {selectedFlagId === flag.id && (
              <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-lg)' }}>
                <form onSubmit={handleCreateOverride} style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                    Organization id
                    <input type="text" value={overrideOrgId} onChange={(e) => setOverrideOrgId(e.target.value)} style={{ ...inputStyle, width: 220 }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                    Restaurant id
                    <input
                      type="text"
                      value={overrideRestaurantId}
                      onChange={(e) => setOverrideRestaurantId(e.target.value)}
                      style={{ ...inputStyle, width: 220 }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={overrideEnabled} onChange={(e) => setOverrideEnabled(e.target.checked)} />
                    enabled
                  </label>
                  <button type="submit" disabled={overrideBusy} style={secondaryButtonStyle}>
                    Add override
                  </button>
                </form>
                {overrideError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{overrideError}</p>}

                <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {overrides.map((override) => (
                    <li key={override.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>
                        {override.organizationId ? `org:${override.organizationId}` : `restaurant:${override.restaurantId}`} →{' '}
                        <strong>{override.isEnabled ? 'on' : 'off'}</strong>
                      </span>
                      <button type="button" onClick={() => handleDeleteOverride(override.id)} style={{ ...dangerButtonStyle, padding: '2px 10px' }}>
                        Remove
                      </button>
                    </li>
                  ))}
                  {overrides.length === 0 && <li style={{ color: 'var(--text-muted)', fontSize: 13 }}>No overrides for this flag.</li>}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
