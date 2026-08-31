'use client';

import { fetchPlatformAdmins, grantPlatformAdmin, revokePlatformAdmin, type PlatformAdmin, type PlatformAdminRole } from '@reservex/core';
import { useEffect, useState, type FormEvent } from 'react';

import { inputStyle, primaryButtonStyle, dangerButtonStyle } from '@/components/AdminGate';
import { useAdminSession } from '@/hooks/useAdminSession';
import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * The platform admin roster. Any active admin (either role) can see it --
 * admin_list_platform_admins() only requires is_platform_admin(). Granting
 * and revoking are super_admin-only, both server-side (admin_grant_
 * platform_admin/admin_revoke_platform_admin check is_platform_super_
 * admin() and raise NOT_AUTHORIZED otherwise) and hidden here for a
 * support admin, purely as UI polish.
 *
 * There is no invite-by-email flow: admin_grant_platform_admin looks up
 * auth.users by email and raises USER_NOT_FOUND if no account exists yet
 * -- the person has to sign up for an account first (the login screen's
 * "Sign up" tab), then a super_admin grants them access here.
 */
export default function AdminsPage() {
  const { isSuperAdmin } = useAdminSession();

  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [grantEmail, setGrantEmail] = useState('');
  const [grantRole, setGrantRole] = useState<PlatformAdminRole>('support');
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  function refresh() {
    const client = getSupabaseBrowserClient();
    fetchPlatformAdmins(client)
      .then(setAdmins)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }

  useEffect(refresh, []);

  async function handleGrant(event: FormEvent) {
    event.preventDefault();
    setGrantError(null);
    setGrantBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      await grantPlatformAdmin(client, grantEmail.trim(), grantRole);
      setGrantEmail('');
      setGrantRole('support');
      refresh();
    } catch (e) {
      setGrantError((e as Error).message);
    } finally {
      setGrantBusy(false);
    }
  }

  async function handleRevoke(userId: string) {
    if (!window.confirm('Revoke this admin\'s platform access?')) return;
    setRevokingUserId(userId);
    try {
      const client = getSupabaseBrowserClient();
      await revokePlatformAdmin(client, userId);
      setAdmins((prev) => prev.map((a) => (a.userId === userId ? { ...a, isActive: false } : a)));
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setRevokingUserId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)', maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Platform admins</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {isSuperAdmin && (
        <form onSubmit={handleGrant} style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' }}>
            Email (must already have an account)
            <input type="email" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} required style={{ ...inputStyle, width: 260 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' }}>
            Role
            <select value={grantRole} onChange={(e) => setGrantRole(e.target.value as PlatformAdminRole)} style={inputStyle}>
              <option value="support">support</option>
              <option value="super_admin">super_admin</option>
            </select>
          </label>
          <button type="submit" disabled={grantBusy || !grantEmail.trim()} style={primaryButtonStyle}>
            Grant access
          </button>
        </form>
      )}
      {grantError && <p style={{ color: 'var(--danger)', fontSize: 14 }}>{grantError}</p>}

      {loaded && admins.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No platform admins yet.</p>}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {admins.map((admin) => (
          <li
            key={admin.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-md)',
              background: 'var(--surface)',
              opacity: admin.isActive ? 1 : 0.55,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {admin.email} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>({admin.role})</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {admin.isActive ? 'active' : 'revoked'}
                {admin.grantedByEmail ? ` · granted by ${admin.grantedByEmail}` : ''}
              </div>
            </div>
            {isSuperAdmin && admin.isActive && (
              <button type="button" onClick={() => handleRevoke(admin.userId)} disabled={revokingUserId === admin.userId} style={dangerButtonStyle}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
