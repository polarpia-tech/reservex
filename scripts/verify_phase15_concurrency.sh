#!/usr/bin/env bash
# =============================================================================
# verify_phase15_concurrency.sh
#
# Phase 07's own verify script (Test G) proved the EXCLUDE constraint blocks
# double-booking, but only by manually forcing an INSERT that bypasses
# book_reservation() -- a single connection, sequential, deliberately
# artificial bypass. It never proved what actually matters in production:
# two REAL, SEPARATE database connections calling book_reservation() for the
# exact same table at the exact same instant. That's a genuinely different
# and stronger claim (Postgres's EXCLUDE constraint is safe under real
# concurrent transactions by design, but "tested, not assumed" -- see the
# project's own standing rule -- means proving it, not citing the
# documentation).
#
# This launches two independent `psql` processes in the background (real OS
# processes, real separate connections, started within milliseconds of each
# other) that both try to book the SAME table (T1 -- Athens, capacity 2, the
# only table that fits a party of 2) for the SAME time slot. Exactly one must
# succeed; the other must fail -- with EITHER NO_AVAILABILITY (the pre-check
# SELECT-based availability filter caught it) OR DOUBLE_BOOKED (the EXCLUDE
# constraint caught it at INSERT time, after both transactions' pre-checks
# had ALREADY both seen the table as free -- a classic check-then-act race
# window). A real run of this exact scenario observed DOUBLE_BOOKED, not
# NO_AVAILABILITY: under genuine concurrency, both transactions'
# availability pre-check can run before either one commits, so both see the
# table as free and both attempt the INSERT -- it is specifically the
# EXCLUDE constraint, not the pre-check, that then catches the loser. That
# is exactly the point Phase 07's own verify script's Test G comment makes
# ("the EXCLUDE constraint -- not just the SQL availability filter -- is
# what actually prevents double-booking"), now proven under real
# concurrency instead of a single-connection manual bypass. Either error is
# an acceptable, correct outcome here; two successful bookings, or a raw
# unhandled constraint-violation crash, would not be. Afterwards
# reservation_tables must show T1 held exactly once for that slot, never
# twice.
#
# Run after migrations (through 0020) + seed.sql. Requires PGDATABASE (or
# edit DB_NAME below) to point at a local Postgres with the `postgres`
# superuser role reachable via `sudo -u postgres psql` in this sandbox, or
# via a plain TCP `psql` connection (PGHOST/PGUSER/PGPASSWORD) in CI -- see
# the PSQL dual-mode switch below, same convention as
# run_all_verifications.sh and every other verify_phaseNN script in this
# project.
# =============================================================================
set -uo pipefail

DB_NAME="${DB_NAME:-reservex_test}"
SLOT_DATE="current_date + interval '5 days'"
ATHENS_OWNER="11111111-1111-1111-1111-111111111111"
ATHENS_RESTAURANT="bbbbbbbb-0000-0000-0000-000000000001"

# Phase 17: same dual-mode switch as run_all_verifications.sh (its own
# comment explains the two environments this now runs in -- this sandbox
# vs. GitHub Actions' postgres:16 service container).
if [ -n "${PGHOST:-}" ]; then
  PSQL=(psql)
else
  PSQL=(sudo -u postgres psql)
fi

TMP_A=$(mktemp)
TMP_B=$(mktemp)
trap 'rm -f "$TMP_A" "$TMP_B"' EXIT

# Idempotency: this script can be run repeatedly against the same seeded
# database (e.g. as part of run_all_verifications.sh). Clean up any
# reservation this script itself created on a PRIOR run for this exact
# guest name before racing again, so a second run doesn't spuriously see
# "already booked" and mistake a stale leftover for a real double-booking
# failure.
"${PSQL[@]}" -d "$DB_NAME" -qtAc "
  delete from public.reservations
  where restaurant_id = '${ATHENS_RESTAURANT}' and guest_name = 'Concurrency Test Guest';
" >/dev/null

BOOK_SQL="
set role authenticated;
select set_config('request.jwt.claim.sub', '${ATHENS_OWNER}', false);
select 'RESULT:' || id::text from public.book_reservation(
  p_restaurant_id => '${ATHENS_RESTAURANT}',
  p_starts_at     => (${SLOT_DATE} + time '12:30') at time zone 'Europe/Athens',
  p_ends_at       => (${SLOT_DATE} + time '14:00') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_guest_name    => 'Concurrency Test Guest'
);
"

echo "=== Phase 15 concurrency test: two REAL concurrent connections racing for the same table+slot ==="
echo ""

# Launched back-to-back with no synchronization delay between them -- both
# `psql` processes start, connect, and begin their transaction within
# milliseconds of each other, which is what makes this a genuine race rather
# than two sequential calls dressed up to look like one.
"${PSQL[@]}" -d "$DB_NAME" -v ON_ERROR_STOP=0 -qtAc "$BOOK_SQL" >"$TMP_A" 2>&1 &
PID_A=$!
"${PSQL[@]}" -d "$DB_NAME" -v ON_ERROR_STOP=0 -qtAc "$BOOK_SQL" >"$TMP_B" 2>&1 &
PID_B=$!
wait "$PID_A"
wait "$PID_B"

echo "--- connection A result ---"
cat "$TMP_A"
echo "--- connection B result ---"
cat "$TMP_B"
echo ""

A_OK=0
B_OK=0
grep -qE '^RESULT:[0-9a-f-]{36}$' "$TMP_A" && A_OK=1
grep -qE '^RESULT:[0-9a-f-]{36}$' "$TMP_B" && B_OK=1
A_REJECTED=0
B_REJECTED=0
grep -qE "NO_AVAILABILITY|DOUBLE_BOOKED" "$TMP_A" && A_REJECTED=1
grep -qE "NO_AVAILABILITY|DOUBLE_BOOKED" "$TMP_B" && B_REJECTED=1

FAIL=0

if [ "$((A_OK + B_OK))" -eq 1 ]; then
  echo "OK   exactly one of the two concurrent bookings succeeded (expected: 1, got: $((A_OK + B_OK)))"
else
  echo "FAIL expected EXACTLY ONE booking to succeed, got: $((A_OK + B_OK))"
  FAIL=1
fi

if [ "$((A_REJECTED + B_REJECTED))" -eq 1 ]; then
  echo "OK   the losing connection failed with a clean NO_AVAILABILITY/DOUBLE_BOOKED error, not a raw constraint-violation crash"
  if grep -q "DOUBLE_BOOKED" "$TMP_A" "$TMP_B" 2>/dev/null; then
    echo "NOTE the loser was caught by the EXCLUDE constraint (DOUBLE_BOOKED), not the pre-check -- both transactions'"
    echo "     availability pre-checks ran before either committed and both saw the table as free. This is expected"
    echo "     under real concurrency and is exactly why the EXCLUDE constraint exists as the real backstop, not just"
    echo "     the SELECT-based availability filter (see Phase 07's Test G)."
  fi
else
  echo "FAIL expected exactly one connection to fail with NO_AVAILABILITY/DOUBLE_BOOKED, got: $((A_REJECTED + B_REJECTED))"
  FAIL=1
fi

echo ""
echo "=== double-checking the database itself: T1 held exactly once for this slot ==="
HOLD_COUNT=$("${PSQL[@]}" -d "$DB_NAME" -qtAc "
  select count(*) from public.reservation_tables rt
  join public.reservations r on r.id = rt.reservation_id
  where rt.table_id = 'dddddddd-0000-0000-0000-000000000001'
    and r.starts_at = ((${SLOT_DATE} + time '12:30') at time zone 'Europe/Athens')
    and r.status not in ('cancelled');
")
HOLD_COUNT=$(echo "$HOLD_COUNT" | tr -d '[:space:]')
if [ "$HOLD_COUNT" = "1" ]; then
  echo "OK   reservation_tables shows T1 held exactly once for this slot (no double allocation slipped through)"
else
  echo "FAIL expected exactly 1 hold row for T1 at this slot, found: $HOLD_COUNT"
  FAIL=1
fi

echo ""
echo "=== CLEANUP ==="
"${PSQL[@]}" -d "$DB_NAME" -qtAc "
  delete from public.reservations
  where restaurant_id = '${ATHENS_RESTAURANT}' and guest_name = 'Concurrency Test Guest';
" >/dev/null
echo "done."

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "OK: real concurrent double-booking attempt was correctly resolved to exactly one winner."
  exit 0
else
  echo "FAILED: concurrency guarantee did not hold as expected."
  exit 1
fi
