'use client';

import type { Session } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

export interface AdminSessionValue {
  session: Session;
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
}

// Populated by <AdminGate> (src/components/AdminGate.tsx) once the caller
// is confirmed to be an active platform admin -- see that file for the
// three-state gate (no session / session-but-not-admin / admin) this
// context sits behind. Every page under app/ is a descendant of AdminGate
// (wired in app/layout.tsx), so useAdminSession() should never actually
// hit the "outside AdminGate" error below in practice.
export const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function useAdminSession(): AdminSessionValue {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('useAdminSession() called outside <AdminGate>.');
  return value;
}
