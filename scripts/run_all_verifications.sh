#!/usr/bin/env bash
# =============================================================================
# run_all_verifications.sh
#
# Phase 15's other real deliverable: every phase from 04 onward has ended
# with the same manual ritual, repeated by hand each time -- drop/recreate
# the local database, apply local_dev_shim.sql, apply every migration in
# order, apply seed.sql, then re-run every verify_phaseNN_*.sql/.mjs script
# to catch regressions before trusting a new one. This script is that
# ritual, written down once instead of re-typed every phase -- exactly the
# kind of thing "Testing -- συνεχές (ongoing)" in the blueprint means.
#
# Honesty note on what "pass" means here, because it differs by script:
#   - The SQL scripts for phases 04-13 and Phase 15's own
#     verify_phase15_testing.sql are EYEBALL-VERIFIED by design, a
#     convention set from Phase 04 onward: they run with
#     `\set ON_ERROR_STOP off` and print an expected outcome (which is
#     often itself "ERROR: SOME_CODE") right after each assertion, e.g.
#     "(expected: ERROR -- new row violates row-level security policy)".
#     psql's own process exit code cannot tell an intended RLS-rejection
#     ERROR apart from a genuine regression -- both look identical to the
#     shell. This script does NOT pretend otherwise: it saves full output
#     to logs/ and tells you to read it, it does not claim a pass/fail
#     verdict for these files. (Cross-checked once, by hand, when each
#     phase shipped -- see this project's README for that phase.)
#   - The .mjs scripts (verify_phase11/12/14/16_ai_cost) and
#     verify_phase15_concurrency.sh DO use real exit codes and an explicit
#     final OK:/FAILED: line -- for those, this script reports a real
#     pass/fail.
#
# Run from the repo root. Requires a local Postgres 16 reachable via
# `sudo -u postgres psql` (same convention as every verify_phaseNN script),
# and Node.js for the .mjs scripts.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_NAME="${DB_NAME:-reservex_test}"
LOG_DIR="${LOG_DIR:-/tmp/reservex_verify_logs}"
mkdir -p "$LOG_DIR"

# Phase 17: this script now runs in two places -- this sandbox (a local
# Postgres reachable only as the `postgres` OS user, no TCP password, hence
# `sudo -u postgres psql`) AND GitHub Actions' ci.yml (a `postgres:16`
# service container reachable over TCP with a password, no `sudo` and no
# `postgres` OS user to switch to at all). `psql` itself already reads
# PGHOST/PGPORT/PGUSER/PGPASSWORD from the environment, so the only thing
# that actually differs is whether the invocation is prefixed with `sudo -u
# postgres`. PGHOST is unset in this sandbox and IS set by ci.yml (see that
# workflow's `env:` block) -- used here purely as the signal for which mode
# to run in, not because its value is otherwise read directly.
if [ -n "${PGHOST:-}" ]; then
  PSQL=(psql)
else
  PSQL=(sudo -u postgres psql)
fi

FAIL_COUNT=0
EYEBALL_COUNT=0

echo "=== 1/3: fresh database rebuild ($DB_NAME) ==="
"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB_NAME;" > "$LOG_DIR/00_rebuild.log" 2>&1
"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME;" >> "$LOG_DIR/00_rebuild.log" 2>&1
"${PSQL[@]}" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f scripts/local_dev_shim.sql >> "$LOG_DIR/00_rebuild.log" 2>&1 || { echo "FAIL local_dev_shim.sql -- see $LOG_DIR/00_rebuild.log"; exit 1; }
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f" >> "$LOG_DIR/00_rebuild.log" 2>&1 || { echo "FAIL migration $f -- see $LOG_DIR/00_rebuild.log"; exit 1; }
done
"${PSQL[@]}" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f supabase/seed.sql >> "$LOG_DIR/00_rebuild.log" 2>&1 || { echo "FAIL seed.sql -- see $LOG_DIR/00_rebuild.log"; exit 1; }
echo "OK   $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations + seed applied cleanly"

echo ""
echo "=== 2/3: SQL verify scripts (eyeball-verified by design -- see header) ==="
for f in scripts/verify_phase*.sql scripts/verify_schema.sql; do
  name="$(basename "$f")"
  "${PSQL[@]}" -d "$DB_NAME" -v ON_ERROR_STOP=0 -f "$f" > "$LOG_DIR/$name.log" 2>&1
  echo "RAN  $name -> $LOG_DIR/$name.log (review for anything NOT matching its own inline 'expected:' comment)"
  EYEBALL_COUNT=$((EYEBALL_COUNT + 1))
done

echo ""
echo "=== 3/3: scripts with real pass/fail exit codes ==="
run_checked() {
  local label="$1"; shift
  if "$@" > "$LOG_DIR/${label}.log" 2>&1; then
    echo "OK   $label"
  else
    echo "FAIL $label -- see $LOG_DIR/${label}.log"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}
run_checked "verify_ts_syntax.mjs" node scripts/verify_ts_syntax.mjs
run_checked "check-locale-parity.mjs" node packages/i18n/scripts/check-locale-parity.mjs
run_checked "verify_phase11_voice_readiness.mjs" node scripts/verify_phase11_voice_readiness.mjs
run_checked "verify_phase12_payments_billing.mjs" node scripts/verify_phase12_payments_billing.mjs
run_checked "verify_phase14_web_pwa.mjs" node scripts/verify_phase14_web_pwa.mjs
DB_NAME="$DB_NAME" run_checked "verify_phase15_concurrency.sh" scripts/verify_phase15_concurrency.sh
run_checked "verify_phase16_ai_cost.mjs" node scripts/verify_phase16_ai_cost.mjs
run_checked "verify_phase17_deployment.mjs" node scripts/verify_phase17_deployment.mjs

# verify_phase16_optimization.sql is (like Phase 15's own SQL scripts and
# every SQL script since Phase 04) eyeball-verified by design -- it prints
# an "(expected: ...)" comment after each assertion, including several
# EXPECTED errors (permission denied, NO_AVAILABILITY), so it belongs with
# the eyeball-verified batch above, not this exit-code-checked section.
# Already covered by the `scripts/verify_phase*.sql` glob in step 2/3.

echo ""
echo "=== Summary ==="
echo "$EYEBALL_COUNT SQL script(s) ran -- logs in $LOG_DIR, read them (no automated verdict, see header note)."
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "OK: all $((8)) exit-code-checked scripts passed."
  exit 0
else
  echo "FAILED: $FAIL_COUNT exit-code-checked script(s) failed -- see logs above."
  exit 1
fi
