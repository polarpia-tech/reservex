import { redirect } from 'next/navigation';

// No dashboard/landing content of its own -- Organizations is the natural
// default screen for this app. This redirect runs before AdminGate's
// client-side auth check does anything with it; the target route is
// gated the same as every other page (see app/layout.tsx).
export default function RootPage() {
  redirect('/organizations');
}
