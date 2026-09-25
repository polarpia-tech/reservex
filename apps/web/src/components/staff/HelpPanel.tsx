'use client';
import type { Restaurant } from '@reservex/core';
import { useEffect, useState, type CSSProperties } from 'react';

import { bottomSheetOverlayStyle, bottomSheetStyle, buttonStyle } from '@/lib/ui';

const h3Style: CSSProperties = { fontSize: 14.5, fontWeight: 700, color: 'var(--accent)', marginTop: 18, marginBottom: 6 };
const pStyle: CSSProperties = { fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-primary)', margin: '0 0 6px' };
const liStyle: CSSProperties = { fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-primary)', marginBottom: 4 };
const noteStyle: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.5,
  color: 'var(--text-muted)',
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md, 10px)',
  padding: '10px 12px',
  margin: '6px 0 0',
};

/**
 * In-app quick-reference help, reachable from a "?" button in the header
 * (see app/staff/page.tsx). Same content as the printable staff guide
 * (make_staff_guide.py, handed to the first onboarded restaurant as a
 * PDF), condensed for on-screen reading -- but deliberately
 * restaurant-agnostic here: no restaurant name, no personal contact info,
 * since every restaurant that signs up through /staff opens this exact
 * same dashboard and should get generic, correct instructions rather than
 * text written for one specific owner. A PDF someone was sent once is easy
 * to lose; this is always one tap away.
 */
export function HelpPanel({ restaurant, onClose }: { restaurant: Restaurant; onClose: () => void }) {
  const [bookingLink, setBookingLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBookingLink(`${window.location.origin}/el/r/${restaurant.slug}`);
    }
  }, [restaurant.slug]);

  async function handleCopy() {
    if (!bookingLink) return;
    try {
      await navigator.clipboard.writeText(bookingLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser -- the link is still shown as plain
      // selectable text right above the button, so this never blocks the user from copying it.
    }
  }

  return (
    <div style={bottomSheetOverlayStyle} onClick={onClose}>
      <div style={{ ...bottomSheetStyle, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Βοήθεια</h2>
          <button type="button" onClick={onClose} style={{ ...buttonStyle('ghost'), padding: '6px 12px', minHeight: 32, fontSize: 13 }}>
            Κλείσιμο
          </button>
        </div>

        <p style={h3Style}>Κρατήσεις</p>
        <p style={pStyle}>
          Το tab «Κρατήσεις» δείχνει τις κρατήσεις της επιλεγμένης ημέρας. Πάτα <b>«Ήρθε»</b> όταν έρθει ο πελάτης,{' '}
          <b>«Ολοκληρώθηκε»</b> όταν φύγει, <b>«Δεν ήρθε»</b> αν δεν εμφανιστεί, ή <b>«Ακύρωση»</b> αν ακυρωθεί.
        </p>

        <p style={h3Style}>Τηλεφωνική / αυτοπρόσωπη κράτηση</p>
        <p style={pStyle}>
          Πάτα <b>«+ Νέα κράτηση»</b> στο tab Κρατήσεις, συμπλήρωσε ώρα και αριθμό ατόμων, πάτα{' '}
          <b>«Έλεγχος διαθεσιμότητας»</b> (ή άφησέ το σε αυτόματη ανάθεση), βάλε τα στοιχεία του πελάτη και καταχώρισέ την.
        </p>

        <p style={h3Style}>Ωράριο & Τραπέζια</p>
        <p style={pStyle}>
          Χωρίς σωστό ωράριο στο tab «Ωράριο», οι πελάτες δεν μπορούν να κλείσουν τραπέζι online. Στο tab «Τραπέζια»
          διαχειρίζεσαι τα τραπέζια που ελέγχει αυτόματα το σύστημα για διαθεσιμότητα.
        </p>

        <p style={h3Style}>Ειδοποιήσεις στο iPhone — σημαντικό</p>
        <p style={pStyle}>
          Για να έρχεται ειδοποίηση στην κορυφή της οθόνης για κάθε νέα κράτηση, το iPhone χρειάζεται τη σελίδα
          προσθεμένη στην Αρχική Οθόνη — δεν αρκεί μια απλή καρτέλα Safari:
        </p>
        <ol style={{ margin: '0 0 4px', paddingLeft: 18 }}>
          <li style={liStyle}>Άνοιξε αυτή τη σελίδα στο Safari (όχι Chrome).</li>
          <li style={liStyle}>Μοιράσου → «Προσθήκη στην Αρχική Οθόνη».</li>
          <li style={liStyle}>Άνοιξέ την ξανά από το νέο εικονίδιο στην Αρχική Οθόνη.</li>
          <li style={liStyle}>Στο tab «Ρυθμίσεις», πάτα «Ενεργοποίηση ειδοποιήσεων» και επίτρεψέ το.</li>
        </ol>
        <p style={noteStyle}>
          Από κανονική καρτέλα Safari (χωρίς το βήμα «Προσθήκη στην Αρχική Οθόνη»), οι ειδοποιήσεις δεν λειτουργούν
          καθόλου σε iPhone.
        </p>

        <p style={h3Style}>Ο σύνδεσμος κράτησης του μαγαζιού σου</p>
        <p style={pStyle}>Μοιράσου τον με τους πελάτες σου (ή φτιάξε από αυτόν ένα QR code):</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code
            style={{
              fontSize: 12.5,
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 9px',
              wordBreak: 'break-all',
            }}
          >
            {bookingLink ?? '…'}
          </code>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!bookingLink}
            style={{ ...buttonStyle('secondary', { disabled: !bookingLink }), padding: '6px 12px', minHeight: 32, fontSize: 12.5 }}
          >
            {copied ? 'Αντιγράφηκε' : 'Αντιγραφή'}
          </button>
        </div>
      </div>
    </div>
  );
}
