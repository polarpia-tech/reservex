import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import AdminGate from '@/components/AdminGate';

import './globals.css';

export const metadata: Metadata = {
  title: 'ReservX Admin',
  description: 'ReservX internal platform administration.',
};

// This app is deliberately EN-only -- it is ReservX's own internal ops
// tool (platform admins managing organizations/restaurants/subscriptions/
// feature flags across every tenant), not a restaurant-staff or
// customer-facing surface. The DE/EN/EL/TR MVP language requirement in the
// project brief applies to those two audiences specifically; see the
// Phase 13 README section for this scope decision spelled out explicitly.
// No locale routing here at all (contrast apps/web's app/[locale]/...).

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AdminGate>{children}</AdminGate>
      </body>
    </html>
  );
}
