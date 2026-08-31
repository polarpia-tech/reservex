# ReservX — μονόρεπο

Αυτό το repo καλύπτει τη Φάση 02 (βάση δεδομένων, φάκελος `supabase/`), τη
Φάση 03 (θεμέλια project, φάκελοι `apps/` και `packages/`), τη Φάση 04
(αυθεντικοποίηση), τη Φάση 05 (διαχείριση εστιατορίου), τη Φάση 06
(διαχείριση τραπεζιών), τη Φάση 07 (μηχανή κρατήσεων), τη Φάση 08 (εμπειρία
πελάτη — δημόσιο booking site), τη Φάση 09 (ειδοποιήσεις), τη Φάση 10 (AI
Gateway), τη Φάση 11 (ετοιμότητα φωνής) και τη Φάση 12 (πληρωμές &
συνδρομές πλατφόρμας). Δες την ενότητα "Φάση 12" πιο κάτω για τα νεότερα.

## Φάση 02: Βάση Δεδομένων

Αυτός ο φάκελος περιέχει το πλήρες σχήμα PostgreSQL/Supabase για το ReservX,
όπως περιγράφεται στο Product & Technical Blueprint (Φάση 01). Όλα τα
migrations παρακάτω **έχουν πράγματι εκτελεστεί** σε τοπικό PostgreSQL 16 και
**έχουν επαληθευτεί** με πραγματικά ερωτήματα (`scripts/verify_schema.sql`) —
δεν είναι απλώς σχέδιο σε χαρτί.

## Δομή

```
supabase/
  migrations/
    0001_extensions_and_helpers.sql   -- επεκτάσεις Postgres + updated_at trigger
    0002_identity_and_tenancy.sql     -- organizations, restaurants, restaurant_users
    0003_floor_plan.sql               -- zones, tables, table_combinations
    0004_availability_and_events.sql  -- opening_hours, special_hours, events
    0005_customers.sql                -- customers, restaurant_customers (CRM)
    0006_reservations.sql             -- reservations, reservation_tables (ΚΡΙΣΙΜΟ), waitlist
    0007_payments_and_subscriptions.sql
    0008_notifications.sql
    0009_ai.sql                       -- ai_conversations, ai_messages, ai_actions
    0010_governance.sql               -- audit_logs, feature_flags
    0011_row_level_security.sql       -- multi-tenant απομόνωση (RLS)
  seed.sql                            -- demo δεδομένα: 2 εστιατόρια, 2 οργανισμοί
scripts/
  local_dev_shim.sql                  -- ΜΟΝΟ για τοπικό PostgreSQL (βλ. παρακάτω)
  verify_schema.sql                   -- 7 δοκιμές που αποδεικνύουν ότι δουλεύει
```

## Πώς να το τρέξεις στο δικό σου Supabase project

1. Εγκατέστησε το [Supabase CLI](https://supabase.com/docs/guides/cli) αν δεν το έχεις.
2. `supabase init` μέσα σε ένα νέο project (ή αντίγραψε τον φάκελο `supabase/`
   μέσα στο δικό σου project έτσι όπως είναι).
3. `supabase link --project-ref <το-project-ref-σου>`
4. `supabase db push` — εφαρμόζει όλα τα migrations με τη σειρά.
5. (Προαιρετικά, μόνο για δοκιμαστικό project) `supabase db reset` — εφαρμόζει
   migrations **και** το `seed.sql`.

Το Supabase παρέχει ήδη το schema `auth` (auth.users, auth.uid()) — **μην**
αντιγράψεις το `scripts/local_dev_shim.sql` σε πραγματικό Supabase project,
θα συγκρουστεί με ό,τι ήδη υπάρχει. Αυτό το αρχείο υπάρχει αποκλειστικά για
να μπορέσουμε να δοκιμάσουμε τα migrations σε απλό, τοπικό PostgreSQL χωρίς
να στήσουμε ολόκληρο το Supabase stack.

## Πώς να το τρέξεις τοπικά (χωρίς Supabase, μόνο psql) — αυτό έκανα εγώ

```bash
createdb reservex_test
psql -d reservex_test -f supabase/migrations/0001_extensions_and_helpers.sql
psql -d reservex_test -f scripts/local_dev_shim.sql      # <-- shim, ΜΟΝΟ εδώ
psql -d reservex_test -f supabase/migrations/0002_identity_and_tenancy.sql
# ... συνέχισε με τη σειρά μέχρι το 0011 ...
psql -d reservex_test -f supabase/seed.sql
psql -d reservex_test -f scripts/verify_schema.sql
```

## Τι αποδεικνύει το `verify_schema.sql`

| # | Τι ελέγχει | Αποτέλεσμα όταν το έτρεξα |
|---|---|---|
| 1 | Δύο επικαλυπτόμενες κρατήσεις στο ίδιο τραπέζι | ✅ Η βάση αρνήθηκε το insert (exclusion constraint) |
| 2 | Δύο μη-επικαλυπτόμενες κρατήσεις στο ίδιο τραπέζι | ✅ Έγιναν δεκτές |
| 3 | Ακύρωση κράτησης ελευθερώνει το τραπέζι για το ίδιο slot | ✅ Επιβεβαιώθηκε |
| 4 | Ιδιοκτήτης Μονάχου βλέπει 0 κρατήσεις της Αθήνας | ✅ 0 γραμμές |
| 5 | Ιδιοκτήτης Αθήνας βλέπει την κράτηση της Αθήνας | ✅ 1 γραμμή |
| 6 | Πελάτης βλέπει μόνο τη δική του κράτηση, καμία εσωτερική σημείωση CRM | ✅ 1 / 0 |
| 7 | Ιδιοκτήτης Μονάχου δεν μπορεί να μετονομάσει το εστιατόριο της Αθήνας | ✅ UPDATE 0, όνομα αναλλοίωτο |

## Γνωστά σημεία προσοχής (όχι bugs, αλλά αποφάσεις που πρέπει να ξέρεις)

- Οι πολιτικές RLS ελέγχουν συμμετοχή μέσω `restaurant_users` σε κάθε
  query (μέσω των συναρτήσεων `is_restaurant_member` / `has_restaurant_role`).
  Αυτό είναι πιο ευέλικτο από custom JWT claims (υποστηρίζει χρήστη με πρόσβαση
  σε πολλά εστιατόρια) αλλά σημαίνει ένα επιπλέον index lookup ανά query — σε
  κλίμακα εκατοντάδων εστιατορίων είναι αμελητέο, το αναφέρω για πληρότητα.
- Οι πίνακες `payments`, `ai_actions`, `subscriptions` δεν έχουν INSERT/UPDATE
  policy για τον ρόλο `authenticated` — αυτό είναι σκόπιμο. Γράφονται μόνο
  από Edge Functions με το service role, ποτέ απευθείας από client.
- Το soft-delete (`deleted_at`) σε `restaurants`, `tables`, `customers`,
  `events` σημαίνει ότι κάθε μελλοντικό query πρέπει να θυμάται
  `where deleted_at is null` — θα το βάλουμε σε views/helpers στη Φάση 03.
- Ο χρόνος buffer (`reservations.buffer_minutes`) αποθηκεύεται σαν "φωτογραφία"
  τη στιγμή της κράτησης, ώστε μια μελλοντική αλλαγή στις ρυθμίσεις του
  εστιατορίου να μην ξαναγράφει αναδρομικά παλιές κρατήσεις.

## Φάση 03: Θεμέλια Project

```
package.json, pnpm-workspace.yaml, turbo.json   -- monorepo (pnpm + Turborepo)
tsconfig.base.json                              -- κοινές TS ρυθμίσεις

apps/
  mobile/          -- Expo Router app (TypeScript), 4 tabs, i18n, design tokens
  web/             -- Next.js App Router (μελλοντικό booking site/widget/admin)

packages/
  ui/              -- design tokens (χρώματα, τυπογραφία, spacing) -- ΜΙΑ πηγή αλήθειας
  i18n/            -- i18next + 4 γλώσσες MVP (de, en, el, tr)
  core/            -- TS types που αντικατοπτρίζουν το schema της Φάσης 02, Supabase client factory

scripts/
  generate-css-tokens.mjs   -- παράγει apps/web/app/theme-tokens.css ΑΠΟ packages/ui/src/tokens.ts
  verify_ts_syntax.mjs      -- συντακτικός έλεγχος όλων των .ts/.tsx αρχείων
```

### Η οπτική ταυτότητα που διάλεξα

Σκούρο, "futuristic" υπόβαθρο (όχι το κλισέ ζεστό/κρεμ "εστιατορίου") με
ΔΥΟ accent χρώματα που σημαίνουν κάτι συγκεκριμένο, όχι διακοσμητικό:
**Ember** (πορτοκαλί-κοραλί, `#FF7A45`) για ό,τι ανήκει στον κόσμο των
κρατήσεων/εστιατορίου, και **Pulse** (βιολετί, `#7C5CFF`) αποκλειστικά για
οτιδήποτε προέρχεται από το AI. Ο κανόνας: αν κάτι το πρότεινε ή το έκανε ο
ψηφιακός βοηθός, φοράει Pulse — πουθενά αλλού. Αυτό βλέπεις ήδη στην καρτέλα
"AI" της mobile εφαρμογής. Μία γραμματοσειρά (Plus Jakarta Sans) σε όλη την
εφαρμογή, σκόπιμα — μία λιγότερη γραμματοσειρά σημαίνει ταχύτερο cold start.

### Τι είναι πραγματικά λειτουργικό αυτή τη στιγμή

- Η οθόνη **Ρυθμίσεις → Γλώσσα** είναι η μόνη πλήρως λειτουργική οθόνη (όχι
  προσωρινή): αλλάζει πραγματικά τη γλώσσα σε όλη την εφαρμογή μέσω i18next.
- Οι υπόλοιπες οθόνες (Κρατήσεις, Τραπέζια, AI) δηλώνουν ρητά ότι είναι
  προσωρινές placeholder οθόνες με ένδειξη σε ποια φάση θα χτιστούν — καμία
  ψεύτικη λειτουργικότητα, σύμφωνα με τον κανόνα που έθεσες.
- Το design system (`packages/ui`) είναι η ΜΟΝΑΔΙΚΗ πηγή αλήθειας για χρώματα:
  το `apps/web/app/theme-tokens.css` παράγεται αυτόματα από το
  `packages/ui/src/tokens.ts`, δεν αντιγράφεται με το χέρι.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση σε αυτό το sandbox:
- Και τα 4 αρχεία γλώσσας (`de/en/el/tr`) έχουν **ακριβώς τα ίδια keys** —
  δοκιμάστηκε με `node packages/i18n/scripts/check-locale-parity.mjs`.
- Και τα 23 αρχεία `.ts`/`.tsx` σε `apps/` και `packages/` περνούν συντακτικό
  έλεγχο TypeScript χωρίς κανένα σφάλμα — δοκιμάστηκε με
  `node scripts/verify_ts_syntax.mjs`.
- Όλα τα `package.json`/`tsconfig.json`/`app.json` είναι έγκυρο JSON.
- Το CSS των design tokens παράγεται πραγματικά από το TypeScript αρχείο,
  όχι hand-copy.

⚠️ **Δεν μπόρεσα να κάνω εδώ** (και γιατί): αυτό το sandbox δεν έχει δικαίωμα
πρόσβασης στο npm registry, οπότε δεν μπόρεσα να τρέξω πραγματικό
`pnpm install` ή πλήρες `tsc` type-check ενάντια στους αληθινούς τύπους του
Expo/React Native/Next.js/Supabase. Ό,τι είδες παραπάνω είναι συντακτικός
έλεγχος (πιάνει τυπογραφικά λάθη, ανοιχτές παρενθέσεις/JSX), όχι πλήρης
type-check. **Το πρώτο πράγμα που πρέπει να κάνεις** στον δικό σου υπολογιστή:

```bash
cd reservex
pnpm install       # πραγματικό install, με πρόσβαση στο registry
pnpm typecheck     # πλήρης έλεγχος τύπων σε όλο το monorepo
pnpm dev:mobile    # ανοίγει το Expo app (χρειάζεται Expo Go ή simulator)
pnpm dev:web       # ανοίγει το Next.js app στο http://localhost:3000
```

Αντίγραψε τα `.env.example` σε `.env.local` σε κάθε app και βάλε το URL/anon
key του πραγματικού Supabase project σου (από τη Φάση 02) πριν τρέξεις.

### Γνωστά σημεία προσοχής

- Τα εικονίδια/splash (`apps/mobile/assets/*.png`) είναι **προσωρινά
  placeholders** που έφτιαξα προγραμματιστικά (ένα απλό σχήμα σε ember πάνω
  σε σκούρο φόντο) — δεν είναι το τελικό brand mark. Αντικατέστησέ τα πριν
  το πρώτο πραγματικό build για κατάστημα εφαρμογών.
- Οι εκδόσεις πακέτων στα `package.json` (Expo SDK 51, Next 14.2, κ.λπ.)
  είναι λογικές, τρέχουσες επιλογές, αλλά δεν επιβεβαιώθηκαν εδώ έναντι του
  npm registry. Ένα `npx expo install --check` στο `apps/mobile` μετά το
  πρώτο install θα ευθυγραμμίσει αυτόματα οτιδήποτε χρειάζεται προσαρμογή
  για την τρέχουσα έκδοση του Expo SDK.
- Το animated splash screen της αρχικής σου περιγραφής (κινηματογραφικό,
  με τραπέζια/φωτισμό) **δεν** χτίστηκε ακόμα — μπήκε ρητά σκόπιμα ένα απλό,
  στατικό, on-brand splash τώρα, με σχόλιο στον κώδικα που εξηγεί γιατί
  (προτεραιότητα στην ταχύτητα εκκίνησης). Το πλήρες animated concept είναι
  ένα εύλογο polish item αφού υπάρχουν πραγματικές οθόνες μετά το splash.

## Φάση 04: Αυθεντικοποίηση

```
apps/mobile/
  src/services/supabase.ts          -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: session persistence με AsyncStorage
  src/providers/AuthProvider.tsx    -- ποιος είναι συνδεδεμένος, παντού στην εφαρμογή
  src/providers/QueryProvider.tsx   -- TanStack Query client (server state)
  src/hooks/useMyRestaurants.ts     -- σε ποια εστιατόρια έχει πρόσβαση ο χρήστης
  src/navigation/useProtectedRoute.ts -- ΚΕΝΤΡΙΚΗ λογική redirect: (auth) / (onboarding) / (tabs)
  src/utils/authErrors.ts           -- μεταφράζει τα English error strings του Supabase Auth
  src/components/ui/TextField.tsx   -- το ένα text input που χρησιμοποιεί όλη η εφαρμογή
  app/(auth)/{login,signup,forgot-password,update-password}.tsx
  app/(onboarding)/create-restaurant.tsx
  app/_layout.tsx                   -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: QueryProvider + AuthProvider + guard
  app/index.tsx                     -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: δεν κάνει πια δικό του redirect (βλ. παρακάτω)
  app/(tabs)/settings.tsx           -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: πραγματικά στοιχεία χρήστη + λειτουργικό logout

packages/core/src/api/restaurants.ts -- fetchMyRestaurants() -- query σε restaurant_users + restaurants
packages/core/src/api/supabaseClient.ts -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: injectable auth storage (AsyncStorage στο RN)
packages/i18n/src/locales/*.json     -- +38 νέα keys ανά γλώσσα (auth, onboarding, restaurantTypes, roles)

supabase/functions/
  _shared/cors.ts, _shared/supabaseAdmin.ts
  bootstrap-restaurant/index.ts      -- ΝΕΟ: δημιουργεί το πρώτο εστιατόριο ενός owner
  invite-staff-member/index.ts       -- ΝΕΟ: προσκαλεί προσωπικό (backend-only προς το παρόν)

scripts/verify_phase04_bootstrap.sql -- ΝΕΟ: αποδεικνύει το "chicken-and-egg" RLS πρόβλημα
```

### Τι χτίστηκε

**Οθόνες αυθεντικοποίησης (mobile):** login, εγγραφή, "ξέχασα τον κωδικό" και
η οθόνη που δέχεται τον deep link του email reset (`reservex://(auth)/update-password`)
για να ορίσει νέο κωδικό. Όλα καλούν απευθείας το Supabase Auth
(`signInWithPassword`, `signUp`, `resetPasswordForEmail`, `updateUser`) — δεν
υπάρχει custom backend για αυτά, το Supabase Auth είναι αρκετό. Κάθε μήνυμα
λάθους περνάει από `mapSupabaseAuthError()` ώστε ο χρήστης να μη δει ποτέ ένα
ακατέργαστο English string σε γερμανικό/ελληνικό/τουρκικό UI.

**Session persistence:** το Supabase SDK περιμένει από προεπιλογή
`window.localStorage`, που δεν υπάρχει στο React Native. Χωρίς αυτό, κάθε
επανεκκίνηση της εφαρμογής θα ανάγκαζε νέο login. Το `packages/core` δέχεται
τώρα ένα προαιρετικό `storage` (πλατφόρμα-αγνωστικό interface) και το
`apps/mobile` το συνδέει με `@react-native-async-storage/async-storage` —
το `packages/core` παραμένει καθαρό, το web app θα συνεχίσει να χρησιμοποιεί
το δικό του `localStorage` του browser.

**Onboarding + δημιουργία εστιατορίου:** μετά το πρώτο login/signup, αν ο
χρήστης δεν έχει ακόμα κανένα εστιατόριο, οδηγείται σε μία οθόνη με όνομα,
τύπο (restaurant/cafe/bar/club/beach_venue/hotel_venue/event_venue) και
αυτόματα εντοπισμένη ζώνη ώρας (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

**Route guard (`useProtectedRoute`):** μία κεντρική λογική αποφασίζει πού
ανήκει ο χρήστης — `(auth)` αν δεν είναι συνδεδεμένος, `(onboarding)` αν
είναι συνδεδεμένος αλλά δεν έχει εστιατόριο, `(tabs)` αν έχει και τα δύο.
Καμία οθόνη δεν αποφασίζει μόνη της να κάνει redirect.

**Settings:** δείχνει πλέον πραγματικό email, ρόλο (owner/manager/κ.λπ.) και
όνομα εστιατορίου από τη βάση, και το κουμπί "Αποσύνδεση" καλεί πραγματικά
το `supabase.auth.signOut()`.

### Σημαντική αρχιτεκτονική απόφαση: γιατί η δημιουργία εστιατορίου ΔΕΝ είναι απλό INSERT

Αυτό είναι το πιο σημαντικό εύρημα της φάσης και αξίζει εξήγηση πριν προχωρήσουμε,
όπως ζήτησες.

Στη Φάση 02 το RLS policy `restaurant_users_write` λέει: "μπορείς να γράψεις
γραμμή στο `restaurant_users` ΜΟΝΟ αν είσαι ήδη owner/manager αυτού του
εστιατορίου". Αυτό είναι σωστό για την καθημερινή χρήση (ένας manager
προσκαλεί προσωπικό) αλλά δημιουργεί ένα "chicken-and-egg" πρόβλημα στο
onboarding: ένας ΝΕΟΣ χρήστης μπορεί να δημιουργήσει το δικό του
`organizations` και `restaurants` row απευθείας (το RLS το επιτρέπει, αφού
ορίζει τον εαυτό του ως owner), αλλά ΔΕΝ μπορεί να εισάγει τη δική του πρώτη
γραμμή "owner" στο `restaurant_users` — γιατί αυτό το policy απαιτεί να είναι
ΗΔΗ owner/manager του εστιατορίου, πράγμα που είναι ακριβώς αυτό που
προσπαθεί να γίνει.

Το απέδειξα πραγματικά (όχι θεωρητικά) με το `scripts/verify_phase04_bootstrap.sql`,
τρέχοντάς το σε τοπικό PostgreSQL: το Test C (απευθείας insert ως ο ίδιος ο
νέος χρήστης) αποτυγχάνει με RLS violation όπως αναμενόταν, το Test D (το
ίδιο insert αλλά ως `postgres` — προσομοίωση service role) πετυχαίνει. Το
Test F απέδειξε επίσης κάτι χρήσιμο: ένας ΥΠΑΡΧΩΝ owner ΜΠΟΡΕΙ να προσκαλέσει
νέο προσωπικό απευθείας υπό RLS χωρίς service role — το πρόβλημα υπάρχει
μόνο για την πρώτη, self-referential εγγραφή.

**Η λύση:** το `bootstrap-restaurant` Edge Function τρέχει με service role
(bypass RLS) και κάνει τα τρία insert (organization + restaurant +
restaurant_users owner) σε σειρά, με rollback αν κάποιο βήμα αποτύχει, και
γράφει audit log entry. Θα μπορούσαμε εναλλακτικά να προσθέσουμε ένα ειδικό
"bootstrap" policy στο RLS, αλλά προτίμησα να μην πειράξω migrations που
έχουν ήδη εφαρμοστεί στη Φάση 02, και να μείνω συνεπής με τον κανόνα
"ευαίσθητες, πολυβηματικές εγγραφές περνάνε από Edge Function" που ήδη
ισχύει για πληρωμές και AI actions.

**Τι ΔΕΝ χτίστηκε ακόμα από αυτό:** το `invite-staff-member` Edge Function
είναι γραμμένο και ακολουθεί το ίδιο pattern (Authentication → Authorization
→ Validation → Business rules → DB operation + audit log), αλλά **καμία
οθόνη δεν το καλεί ακόμα** — δεν υπάρχει UI διαχείρισης προσωπικού (αυτό
είναι δουλειά της Φάσης 05/06). Είναι έτοιμο ως backend building block, όχι
ως ολοκληρωμένο feature. Μην το παρουσιάσεις σαν "λειτουργεί" μέχρι να
υπάρχει πραγματική οθόνη που να το καλεί και να έχει δοκιμαστεί σε πραγματικό
Supabase project.

### Δεύτερο εύρημα: race condition στο αρχικό redirect

Στην αρχική εκδοχή του `app/index.tsx` (Φάση 03) υπήρχε ένα άνευ όρων
`<Redirect href="/(tabs)/reservations" />`. Με το route guard της Φάσης 04
αυτό θα δημιουργούσε race condition: στο πρώτο render, πριν προλάβει να
τρέξει το `useProtectedRoute` (τρέχει σε `useEffect`, άρα ΜΕΤΑ το render),
το `index.tsx` θα είχε ήδη στείλει τον χρήστη στις καρτέλες — ακόμα και αν
δεν είναι καν συνδεδεμένος. Το διόρθωσα κάνοντας το `index.tsx` να δείχνει
απλώς ένα spinner και αφήνοντας το `useProtectedRoute` να είναι η ΜΟΝΑΔΙΚΗ
πηγή απόφασης redirect, σε όλες τις περιπτώσεις (πρόσθεσα και τον έλεγχο
`inTabsGroup` που έλειπε, ώστε να καλύπτεται και η ρίζα `/`).

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση σε αυτό το sandbox:
- `scripts/verify_phase04_bootstrap.sql` έτρεξε σε τοπικό PostgreSQL 16 και
  απέδειξε το RLS gap (Test C αποτυγχάνει όπως αναμενόταν) ΚΑΙ ότι η λύση
  δουλεύει (Test D πετυχαίνει, Test E δείχνει ότι ο χρήστης βλέπει πλέον το
  εστιατόριό του, Test F επιβεβαιώνει ότι οι προσκλήσεις υπαρχόντων χρηστών
  δεν χρειάζονται service role για το insert στο `restaurant_users`).
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 93 keys —
  `node packages/i18n/scripts/check-locale-parity.mjs`.
- 41 αρχεία `.ts`/`.tsx` σε `apps/`, `packages/` ΚΑΙ `supabase/functions/`
  περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα —
  `node scripts/verify_ts_syntax.mjs`.
- Όλα τα `package.json` παραμένουν έγκυρο JSON.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ** (και γιατί):
- Τα δύο Edge Functions (`bootstrap-restaurant`, `invite-staff-member`)
  **δεν** έχουν τρέξει ποτέ σε πραγματικό Deno runtime — αυτό το sandbox δεν
  έχει Deno ούτε Supabase CLI εγκατεστημένα. Ο έλεγχος που έγινε είναι μόνο
  συντακτικός (TypeScript grammar), όχι πραγματική εκτέλεση ή type-check
  ενάντια στους τύπους του `@supabase/supabase-js`. Το πρώτο πραγματικό τεστ
  πρέπει να γίνει με `supabase functions serve` σε δικό σου μηχάνημα.
- Καμία από τις οθόνες login/signup/forgot-password/update-password δεν έχει
  δοκιμαστεί ενάντια σε πραγματικό Supabase project (χρειάζεται πραγματικό
  URL/anon key από τη Φάση 02 σου).
- Το deep link του password reset (`reservex://(auth)/update-password`)
  **πρέπει** να προστεθεί χειροκίνητα στο Supabase Dashboard, στο
  Authentication → URL Configuration → Redirect URLs, αλλιώς το Supabase θα
  απορρίψει το redirect.

### Γνωστά σημεία προσοχής

- Το CORS στο `supabase/functions/_shared/cors.ts` είναι ανοιχτό (`*`) γιατί
  προς το παρόν μόνο η mobile εφαρμογή καλεί αυτά τα functions (μέσω SDK, όχι
  browser — άρα δεν υπόκειται καν σε CORS). Πρέπει να περιοριστεί σε
  συγκεκριμένο origin πριν το web widget/admin (Φάση 08+) τα καλέσει από
  browser.
- Τα emails του Supabase Auth (επιβεβαίωση εγγραφής, reset κωδικού) είναι
  στα αγγλικά με το προεπιλεγμένο template — ΔΕΝ ακολουθούν ακόμα το δικό μας
  σύστημα i18n (de/en/el/tr). Αυτό χρειάζεται custom email templates στο
  Supabase Dashboard, θέμα για αργότερη φάση.
- Δεν προστέθηκε επιπλέον rate limiting πάνω από ό,τι κάνει ήδη το Supabase
  Auth από προεπιλογή στις οθόνες login/signup — να το επανεξετάσουμε στη
  φάση ασφάλειας/σκληρύνσεως.
- Πρέπει να αποφασίσεις στο Supabase Dashboard αν θέλεις email confirmation
  υποχρεωτικό στο signup ή όχι — το `signup.tsx` χειρίζεται σωστά και τις
  δύο περιπτώσεις (ελέγχει αν επιστράφηκε ενεργό session ή όχι), αλλά η
  ρύθμιση αυτή καθαυτή γίνεται στο dashboard, όχι στον κώδικα.

## Φάση 05: Διαχείριση Εστιατορίου

```
supabase/migrations/0012_staff_directory.sql -- ΝΕΟ: get_restaurant_staff() RPC
scripts/verify_phase05_staff_directory.sql   -- ΝΕΟ: αποδεικνύει tenant isolation του RPC

packages/core/src/api/
  restaurants.ts       -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: +πεδία προφίλ, updateRestaurant()
  openingHours.ts       -- ΝΕΟ: εβδομαδιαίο ωράριο + εξαιρέσεις
  staff.ts               -- ΝΕΟ: ρόστερ προσωπικού, αλλαγή ρόλου, (απ)ενεργοποίηση, πρόσκληση
packages/i18n/src/locales/*.json -- +82 νέα keys ανά γλώσσα (175 σύνολο)

apps/mobile/
  src/hooks/useMyRestaurant.ts          -- ΝΕΟ: "το" εστιατόριο + έλεγχος owner/manager
  src/components/staff/RolePicker.tsx   -- ΝΕΟ: επιλογέας ρόλου (πρόσκληση + αλλαγή ρόλου)
  app/(tabs)/settings.tsx  →  app/(tabs)/settings/  -- ΕΓΙΝΕ φάκελος με δικό του Stack:
    index.tsx              -- hub, τα "Εστιατόριο"/"Προσωπικό" γίνονται πλοηγήσιμα
    restaurant-profile.tsx -- προφίλ εστιατορίου (όνομα, επικοινωνία, διεύθυνση, χωρητικότητα)
    opening-hours.tsx      -- εβδομαδιαίο ωράριο + εξαιρέσεις/ειδικές ημερομηνίες
    roles-reference.tsx    -- επεξήγηση των 5 ρόλων (μόνο ενημερωτικό, καμία επεξεργασία)
    staff/index.tsx        -- ρόστερ προσωπικού με emails
    staff/invite.tsx        -- πρόσκληση νέου μέλους (καλεί το invite-staff-member function)
    staff/[restaurantUserId].tsx -- αλλαγή ρόλου / (απ)ενεργοποίηση συγκεκριμένου ατόμου
```

### Τι χτίστηκε

**Προφίλ εστιατορίου:** owner/manager μπορούν να επεξεργαστούν όνομα, περιγραφή
(εσωτερική, για το προσωπικό — όχι ακόμα η πολύγλωσση περιγραφή για πελάτες,
βλέπε παρακάτω γιατί), στοιχεία επικοινωνίας, διεύθυνση, χωρητικότητα,
ελάχιστο/μέγιστο πάρτι, διάρκεια κράτησης, buffer, και παράθυρο κράτησης
(πόσο νωρίς/αργά μπορεί να κλείσει κράτηση ένας πελάτης). Είναι απευθείας
client-side UPDATE, όχι Edge Function — το επιτρέπει το ήδη υπάρχον RLS
policy `restaurants_update` (Φάση 02) σε owner/manager, χωρίς κανένα νέο
"chicken-and-egg" πρόβλημα αυτή τη φορά, αφού ο χρήστης είναι ήδη
καθιερωμένος owner/manager υπάρχοντος εστιατορίου.

**Ωράριο λειτουργίας:** εβδομαδιαίο πρόγραμμα (βάρδιες ανά ημέρα, π.χ.
μεσημέρι/βράδυ ξεχωριστά, ή "κλειστά") και ξεχωριστές εξαιρέσεις για
συγκεκριμένες ημερομηνίες (αργίες, ιδιωτικές εκδηλώσεις). Το εβδομαδιαίο
πρόγραμμα αποθηκεύεται με πλήρη αντικατάσταση (delete όλων + insert των νέων)
σε ένα κλήση — σκόπιμη απλή σχεδίαση, εξηγείται στο σχόλιο του
`replaceOpeningHours()`.

**Προσωπικό:** λίστα με emails (βλέπε παρακάτω γιατί χρειάστηκε νέα
συνάρτηση βάσης δεδομένων για αυτό), πρόσκληση νέου μέλους (χρησιμοποιεί
επιτέλους το `invite-staff-member` Edge Function που γράφτηκε στη Φάση 04
αλλά δεν είχε ακόμα οθόνη), αλλαγή ρόλου και (απ)ενεργοποίηση υπάρχοντος
μέλους (soft — δεν διαγράφεται ποτέ η γραμμή, κρατάει ιστορικό).

**Ρόλοι — τι εξηγεί η οθόνη "Roles explained":** ΔΕΝ χτίστηκε custom
permission editor. Η στήλη `permission_overrides` (jsonb) στο
`restaurant_users` παραμένει ως "καταπακτή" για μελλοντικά fine-grained
δικαιώματα, αλλά ένα πλήρες custom RBAC UI τώρα, για ένα MVP με 5 σταθερούς
ρόλους, θα ήταν ακριβώς το "overengineering" που απαγορεύει το αρχικό
prompt. Η οθόνη είναι απλώς ενημερωτική.

### Σημαντική αρχιτεκτονική απόφαση: πώς δείχνουμε emails προσωπικού χωρίς να εκθέσουμε το `auth.users`

Το `restaurant_users` κρατάει μόνο `user_id` (uuid) — το email ζει στο
`auth.users`, το οποίο το Supabase **δεν εκθέτει ποτέ** στο PostgREST API,
για κανέναν ρόλο. Δεν υπάρχει RLS policy που θα μπορούσε να δώσει πρόσβαση
σε ένα schema που απλά δεν είναι εκτεθειμένο. Η λύση δεν είναι Edge
Function (θα ήταν υπερβολικό round-trip για ένα απλό read) αλλά μια
SECURITY DEFINER συνάρτηση SQL μέσα στη ίδια τη βάση — `get_restaurant_staff()`
(migration 0012) — που ΜΠΟΡΕΙ να δει το `auth.users` (είναι το ίδιο
Postgres) και καλείται μέσω `supabase.rpc(...)` αντί για `.from(...)`.

Επειδή μια SECURITY DEFINER συνάρτηση παρακάμπτει εντελώς το RLS, έπρεπε να
ξαναγράψω τον έλεγχο εξουσιοδότησης ΜΕΣΑ στη συνάρτηση (`is_restaurant_member()`,
τον ίδιο έλεγχο που κάνει ήδη το policy `restaurant_users_select`). Το
απέδειξα με το `scripts/verify_phase05_staff_directory.sql`: ένας owner στην
Αθήνα βλέπει το δικό του προσωπικό (Test A) αλλά παίρνει **μηδέν** γραμμές
αν ζητήσει το προσωπικό του Μονάχου (Test B) — tenant isolation επιβεβαιωμένο,
όχι απλώς υποτιθέμενο.

### Τι ΔΕΝ χτίστηκε (σκόπιμα, με εξήγηση)

- **Ανέβασμα λογότυπου/φωτογραφιών** (`logo_url`, `cover_image_url`,
  `gallery_image_urls`): χρειάζεται Supabase Storage buckets + policies, που
  δεν έχουν ρυθμιστεί ακόμα. Δεν βάζω fake "upload" κουμπί που δεν κάνει
  τίποτα — προτιμώ να λείπει εντελώς μέχρι να χτιστεί σωστά.
- **Πολύγλωσση περιγραφή** (`description_i18n`, τα 4 MVP locales): το πεδίο
  `description` που επεξεργάζεσαι τώρα είναι απλό, μονόγλωσσο, για εσωτερική
  χρήση του προσωπικού. Ένας editor 4 γλωσσών έχει νόημα όταν υπάρξει
  πραγματικός καταναλωτής αυτού του περιεχομένου — η εμπειρία πελάτη
  (Φάση 08) που θα δείχνει την περιγραφή σε επισκέπτες στη δική τους
  γλώσσα. Να το χτίσουμε τώρα θα ήταν πρόωρη επένδυση.
- **Δομημένος editor social links**: ίδια λογική, δεν υπάρχει ακόμα
  δημόσια σελίδα που να τα δείχνει.
- **Fine-grained δικαιώματα ανά ρόλο**: όπως εξηγείται παραπάνω, η οθόνη
  "Roles explained" λέει ρητά στον χρήστη ότι το σύστημα σήμερα ξεχωρίζει
  μόνο owner/manager από "οποιοδήποτε ενεργό μέλος προσωπικού" — ΔΕΝ
  ξεχωρίζει ακόμα reservation_manager από host από staff στο επίπεδο RLS.
  Αυτό είναι έντιμη αποκάλυψη, όχι bug: η στήλη `permission_overrides`
  υπάρχει ήδη ως προετοιμασία γι' αυτό.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase05_staff_directory.sql` έτρεξε σε τοπικό PostgreSQL
  16 (πάνω στο ήδη υπάρχον migration set + seed.sql): 5 τεστ, όλα με το
  αναμενόμενο αποτέλεσμα (owner Αθήνας βλέπει 2/0/2/0/1 γραμμές στα
  αντίστοιχα σενάρια — δες το script για λεπτομέρειες).
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 175 keys.
- 52 αρχεία `.ts`/`.tsx` σε `apps/`, `packages/` και `supabase/functions/`
  περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ** (ίδιος περιορισμός sandbox όπως στις
προηγούμενες φάσεις): καμία από τις νέες οθόνες δεν έχει τρέξει σε
πραγματικό Expo app ενάντια σε πραγματικό Supabase project — μόνο
συντακτικός έλεγχος TypeScript, όχι πλήρες `tsc` type-check (δεν υπάρχει
πρόσβαση στο npm registry εδώ) και όχι οπτικός/λειτουργικός έλεγχος σε
πραγματική συσκευή. Το πρώτο πραγματικό τεστ πρέπει να γίνει μετά από
`pnpm install` στο δικό σου μηχάνημα, με ήδη εφαρμοσμένο το migration
`0012_staff_directory.sql`.

### Γνωστά σημεία προσοχής

- Η υπόθεση "μία τοποθεσία ανά λογαριασμό" (`useMyRestaurant()` παίρνει
  πάντα το `restaurants[0]`) παραμένει ρητή MVP απόφαση — multi-location
  switching UI είναι μεταγενέστερο, μετά το MVP, item στο blueprint.
- Η ώρα ανοίγματος/κλεισίματος εισάγεται ως απλό κείμενο "HH:MM" (π.χ.
  "19:00"), όχι με native time picker — δεν πρόσθεσα νέο εξωτερικό πακέτο
  (π.χ. `@react-native-community/datetimepicker`) που δεν θα μπορούσα να
  επαληθεύσω ότι εγκαθίσταται σωστά σε αυτό το sandbox. Λειτουργικά σωστό,
  αλλά αξίζει αναβάθμιση UX σε αργότερη φάση.
- Η απενεργοποίηση προσωπικού είναι soft (`is_active = false`) — η γραμμή
  παραμένει, το ιστορικό διατηρείται, το άτομο απλώς χάνει άμεσα πρόσβαση.

## Φάση 06: Διαχείριση Τραπεζιών

```
scripts/verify_phase06_floor_plan.sql -- ΝΕΟ: αποδεικνύει RLS σε ζώνες/τραπέζια

packages/core/src/api/tables.ts -- ΝΕΟ: ζώνες + τραπέζια (CRUD, αλλαγή status)
packages/core/src/types/database.ts -- ΤΡΟΠΟΠΟΙΗΘΗΚΕ: +shape/isCombinable/isActive
packages/i18n/src/locales/*.json -- +42 νέα keys ανά γλώσσα (217 σύνολο)

apps/mobile/
  src/components/tables/TableStatusPicker.tsx -- ΝΕΟ: γρήγορη αλλαγή κατάστασης
  app/(tabs)/tables.tsx  →  app/(tabs)/tables/  -- ΕΓΙΝΕ φάκελος με δικό του Stack:
    index.tsx        -- floor view: τραπέζια ανά ζώνη, tap για αλλαγή κατάστασης
    manage.tsx        -- διαχείριση ζωνών & τραπεζιών (owner/manager)
    zones/new.tsx, zones/[zoneId].tsx -- δημιουργία/επεξεργασία/διαγραφή ζώνης
    new.tsx, [tableId].tsx            -- δημιουργία/επεξεργασία/(απ)ενεργοποίηση/διαγραφή τραπεζιού
```

### Τι χτίστηκε

**Floor view (η βασική οθόνη της καρτέλας "Τραπέζια"):** τραπέζια ομαδοποιημένα
ανά ζώνη, με χρωματιστό status pill. Οποιοδήποτε ενεργό μέλος προσωπικού —
όχι μόνο owner/manager — μπορεί να πατήσει ένα τραπέζι και να αλλάξει την
κατάσταση (διαθέσιμο/κρατημένο/κάθισαν/κατειλημμένο/καθαρισμός/μπλοκαρισμένο/
εκτός λειτουργίας) απευθείας. Αυτό είναι πραγματικά επιβεβαιωμένο δικαίωμα
στη βάση δεδομένων (`tables_update` policy), όχι απλώς κάτι που επιτρέπει
το UI — δες Test E στο νέο verification script.

**Διαχείριση ζωνών & τραπεζιών** (μόνο owner/manager, πίσω από ένα εικονίδιο
στο floor view): δημιουργία/μετονομασία/διαγραφή ζωνών (10 τύποι ζώνης —
εσωτερικό, βεράντα, VIP, κ.λπ.), δημιουργία/επεξεργασία τραπεζιών (ετικέτα,
ζώνη, ελάχιστη/μέγιστη χωρητικότητα, σχήμα, VIP, "συνδυάσιμο"), και
(απ)ενεργοποίηση ή διαγραφή τραπεζιού.

### Σημαντικές αρχιτεκτονικές αποφάσεις

**Διόρθωση διπλού header πριν επεκταθεί το πρόβλημα:** Όταν έφτιαξα τη Φάση
05, το `settings/` έγινε nested Stack μέσα σε tab, αλλά ξέχασα να κρύψω το
header του ΕΞΩΤΕΡΙΚΟΥ tab — αυτό σημαίνει πως θα εμφανίζονταν (ή θα
μπορούσαν να εμφανιστούν) δύο header ταυτόχρονα. Το βρήκα πριν αναπαράγω το
ίδιο πρόβλημα στα "Τραπέζια" (που χρειάζονται ακριβώς το ίδιο nested-Stack
pattern) και το διόρθωσα και στα δύο: το εξωτερικό tab (`app/(tabs)/_layout.tsx`)
τώρα βάζει `headerShown:false` και για τα δύο tabs, και το εσωτερικό Stack
είναι ο ΜΟΝΑΔΙΚΟΣ που δείχνει header, με κάθε οθόνη να ορίζει τον δικό της
τίτλο. Δεν μπόρεσα να το δω οπτικά (δεν τρέχει το app εδώ) αλλά είναι το
τεκμηριωμένο, συνιστώμενο pattern του Expo Router για ακριβώς αυτή την
περίπτωση.

**"Delete" τραπεζιού είναι soft, όχι πραγματικό SQL DELETE:** Η στήλη
`reservation_tables.table_id` έχει `on delete restrict` — δηλαδή ένα
πραγματικό DELETE θα απέτυχε τη στιγμή που ένα τραπέζι έχει έστω μία
κράτηση στο ιστορικό του (δηλαδή, στην πράξη, τα περισσότερα τραπέζια μετά
την πρώτη μέρα λειτουργίας). Το `deleteTable()` κάνει αντ' αυτού UPDATE στο
`deleted_at`, ίδιο pattern με `restaurants`/`customers`/`events` αλλού στο
schema — το τραπέζι εξαφανίζεται από κάθε προβολή αλλά η ιστορική κράτηση
παραμένει έγκυρη.

**Γνωστό κενό (ίδιας κατηγορίας με της Φάσης 05):** το `tables_update` RLS
policy επιτρέπει σε ΚΑΘΕ ενεργό μέλος προσωπικού — όχι μόνο owner/manager —
να αλλάξει ΟΠΟΙΟΔΗΠΟΤΕ πεδίο ενός τραπεζιού, όχι μόνο το status. Το app
κρύβει τα πεδία δομής (ετικέτα, χωρητικότητα, ζώνη) από μη-owner/manager στο
UI, αλλά αυτό είναι σύμβαση UI, όχι κανόνας βάσης δεδομένων — ακριβώς όπως
είχε ήδη αποκαλυφθεί ρητά στη Φάση 05 για τους ρόλους γενικότερα.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Drag-and-drop floor plan editor**: το πρωτότυπο brief το λέει ρητά —
  "απλή floor view πρώτα, drag-and-drop αργότερα". Οι στήλες `pos_x`,
  `pos_y`, `width`, `height`, `rotation_deg` υπάρχουν ήδη στο schema
  (Φάση 02) για αυτό, αλλά δεν εκτίθενται πουθενά ακόμα.
- **Table combinations** (συνδυασμός τραπεζιών για μεγάλα πάρτι): υπάρχουν
  ήδη οι πίνακες `table_combinations`/`table_combination_members` στο
  schema, αλλά είναι ουσιαστικά θέμα της μηχανής κρατήσεων (Smart Table
  Allocation, Φάση 07), όχι της διαχείρισης τραπεζιών αυτής καθαυτής — δεν
  έχει νόημα να χτιστεί UI για αυτό πριν υπάρχει reservation engine που να
  το χρησιμοποιεί.
- Ζώνες: δεν πρόσθεσα (απ)ενεργοποίηση ζώνης (η στήλη `is_active` υπάρχει
  στο schema αλλά δεν εκτίθεται στο UI ακόμα) — μόνο μετονομασία/αλλαγή
  τύπου/διαγραφή. Λιγότερες ενέργειες, λιγότερη σύγχυση, για μια οντότητα
  που δεν έχει δικό της ιστορικό όπως τα τραπέζια.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase06_floor_plan.sql` σε τοπικό PostgreSQL 16: 7 τεστ,
  όλα με το αναμενόμενο αποτέλεσμα — owner δημιουργεί ζώνη/τραπέζι στο δικό
  του εστιατόριο (A, B), μπλοκάρεται σε ζώνη/τραπέζι άλλου εστιατορίου
  (C, D), ένας απλός "host" ΜΠΟΡΕΙ να αλλάξει status τραπεζιού (E) αλλά ΔΕΝ
  μπορεί να δημιουργήσει τραπέζι ή να μετονομάσει ζώνη (F, G).
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 217 keys.
- 60 αρχεία `.ts`/`.tsx` περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ** (ίδιος περιορισμός sandbox): καμία
οθόνη δεν έτρεξε σε πραγματικό Expo/Supabase — ειδικά η διόρθωση του διπλού
header είναι κάτι που ΠΡΕΠΕΙ να ελεγχθεί οπτικά στο δικό σου μηχάνημα πρώτο
πράγμα, αφού είναι αλλαγή navigation που δεν μπορεί να επαληθευτεί με
συντακτικό έλεγχο.

## Φάση 07: Μηχανή Κρατήσεων

Η πιο σύνθετη φάση μέχρι στιγμής: αυτή είναι η καρδιά ολόκληρης της
πλατφόρμας — διαθεσιμότητα, έξυπνη ανάθεση τραπεζιού, δημιουργία/τροποποίηση/
ακύρωση κράτησης, λίστα αναμονής, και η πραγματική, επαληθευμένη εγγύηση
της βάσης δεδομένων ότι δύο κρατήσεις δεν μπορούν ποτέ να "συγκρουστούν" στο
ίδιο τραπέζι, ακόμα και υπό ταυτόχρονα αιτήματα.

```
supabase/migrations/0013_reservation_engine.sql -- ΝΕΟ: το ίδιο το engine
scripts/verify_phase07_reservation_engine.sql   -- ΝΕΟ: 11 τεστ σε πραγματική PostgreSQL

packages/core/src/api/reservations.ts        -- ΝΕΟ: book/reschedule/status/availability
packages/core/src/api/waitlist.ts            -- ΝΕΟ: λίστα αναμονής + μετατροπή σε κράτηση
packages/core/src/api/tableCombinations.ts   -- ΝΕΟ: διαχείριση συνδυασμών τραπεζιών
packages/core/src/types/database.ts          -- ΕΠΕΚΤΑΘΗΚΕ: Reservation, WaitlistEntry,
                                                 AvailableTable, TableCombination, κ.λπ.
packages/i18n/src/locales/*.json             -- +74 νέα keys ανά γλώσσα (291 σύνολο)

apps/mobile/
  app/(tabs)/reservations.tsx  →  app/(tabs)/reservations/  -- ΕΓΙΝΕ φάκελος με δικό του Stack:
    index.tsx              -- ημερήσια ατζέντα κρατήσεων, με πλοήγηση ημέρας
    new.tsx                 -- νέα κράτηση: ημερομηνία/ώρα/διάρκεια/άτομα, προτεινόμενα
                              τραπέζια, χειροκίνητη επιλογή τραπεζιού/συνδυασμού
    [reservationId].tsx     -- λεπτομέρειες, αλλαγή κατάστασης, επεξεργασία/αναπρογραμματισμός,
                              επανα-ανάθεση τραπεζιού, ακύρωση με αιτιολογία
    waitlist/index.tsx, waitlist/new.tsx, waitlist/[waitlistId].tsx -- λίστα αναμονής
  app/(tabs)/tables/combinations/  -- ΝΕΟ: διαχείριση συνδυασμών τραπεζιών (owner/manager)
```

### Τι χτίστηκε

**Η ίδια η μηχανή κρατήσεων, ως καθαρή λογική βάσης δεδομένων** (migration
0013, όχι Edge Function): τρεις συναρτήσεις PostgreSQL —
`get_available_tables` (ποια μεμονωμένα τραπέζια χωράνε τον αριθμό ατόμων
και είναι ελεύθερα), `get_available_table_combinations` (ποιοι
προκαθορισμένοι συνδυασμοί τραπεζιών χωράνε και είναι εξ ολοκλήρου
ελεύθεροι), και `book_reservation` — η μία, ατομική συνάρτηση που είτε
δημιουργεί καινούρια κράτηση είτε αναπρογραμματίζει μια υπάρχουσα, με την
ίδια λογική έξυπνης ανάθεσης και στις δύο περιπτώσεις. Όλες οι συναρτήσεις
είναι `SECURITY INVOKER` (όχι `SECURITY DEFINER` όπως η `get_restaurant_staff`
της Φάσης 05) — τρέχουν με τα δικαιώματα του καλούντος χρήστη, οπότε η
απομόνωση πολλαπλών ενοικιαστών (multi-tenant isolation) ισχύει αυτόματα
μέσω των ΙΔΙΩΝ RLS πολιτικών της Φάσης 02, χωρίς να χρειάζεται να
ξαναγραφτεί ο έλεγχος δικαιωμάτων μέσα στη συνάρτηση.

**Σειρά έξυπνης ανάθεσης τραπεζιού** όταν το προσωπικό δεν διαλέγει τραπέζι
με το χέρι: (1) το καλύτερο μεμονωμένο τραπέζι στην προτιμώμενη ζώνη (αυτό
με τη λιγότερη "χαμένη" χωρητικότητα), (2) το καλύτερο μεμονωμένο τραπέζι σε
οποιαδήποτε ζώνη, (3) ένας προκαθορισμένος συνδυασμός τραπεζιών, (4) αν
τίποτα δεν χωράει: καθαρό σφάλμα `NO_AVAILABILITY`, ποτέ σιωπηλή αποτυχία.
Τα τραπέζια VIP εξαιρούνται ρητά από την αυτόματη ανάθεση (`is_vip=true`) —
πρόκειται για προϊοντική απόφαση, όχι τεχνικό περιορισμό: ένα τραπέζι VIP
δεν πρέπει να "καεί" αυτόματα στον πρώτο τυχαίο πελάτη· το προσωπικό μπορεί
πάντα να το αναθέσει σκόπιμα περνώντας το χειροκίνητα.

**Η πραγματική εγγύηση κατά διπλής κράτησης δεν είναι ο έλεγχος
διαθεσιμότητας** — είναι ο περιορισμός `EXCLUDE` της Φάσης 02 πάνω στο
`reservation_tables`. Το test G του verification script το αποδεικνύει
ρητά: παρακάμπτοντας την έξυπνη ανάθεση και επιβάλλοντας χειροκίνητα ένα
ήδη-κρατημένο τραπέζι, η ίδια η PostgreSQL απορρίπτει το INSERT με
`exclusion_violation`, το οποίο η `book_reservation` μετατρέπει σε καθαρό
σφάλμα `DOUBLE_BOOKED`. Αυτό σημαίνει πως ακόμα και αν δύο μέλη προσωπικού
πατήσουν "Κράτηση" ταυτόχρονα για το ίδιο τραπέζι, μόνο το ένα θα πετύχει —
εγγυημένο από τη βάση δεδομένων, όχι από τον έλεγχο της εφαρμογής.

**Αυτόματη σήμανση χρονικών στιγμών κατάστασης**: ένα νέο trigger
(`reservations_set_status_timestamps`) γεμίζει αυτόματα τα
`confirmed_at`/`seated_at`/`completed_at`/`cancelled_at`/`no_show_marked_at`
τη στιγμή που αλλάζει το `status` — έτσι καμία οθόνη (ούτε η μελλοντική
στρώση AI) δεν χρειάζεται να το θυμάται να το κάνει με το χέρι. Ο
υπάρχων trigger της Φάσης 02 (`trg_reservations_propagate`) αναλαμβάνει ήδη
να ελευθερώσει/ξανα-μπλοκάρει το τραπέζι όταν αλλάζει το status — το test J
του verification script αποδεικνύει και τα δύο μαζί: μετά από "seated" το
τραπέζι παραμένει μπλοκαρισμένο, μετά από "completed" ελευθερώνεται πραγματικά
(επαληθεύτηκε καλώντας ξανά το `get_available_tables` στο ίδιο slot).

**Διαχείριση συνδυασμών τραπεζιών** (νέα οθόνη, owner/manager μόνο): οι
πίνακες `table_combinations`/`table_combination_members` υπήρχαν στο schema
από τη Φάση 02 αλλά καμία οθόνη δεν τους χρησιμοποιούσε — τώρα μπορεί
κάποιος να ορίσει ποια τραπέζια συνδυάζονται (π.χ. "T1+T2" για πάρτι
6-8 ατόμων), κάτι που η `get_available_table_combinations` χρησιμοποιεί
απευθείας.

**Ημερήσια ατζέντα κρατήσεων + λίστα αναμονής**: η καρτέλα "Κρατήσεις" έγινε
πλήρης οθόνη εργασίας — πλοήγηση ημέρα-ημέρα, δημιουργία κράτησης με
προεπισκόπηση διαθεσιμότητας πριν την επιβεβαίωση, λεπτομέρειες/αλλαγή
κατάστασης/ακύρωση/αναπρογραμματισμός, και ξεχωριστή λίστα αναμονής με
χειροκίνητη μετατροπή σε κράτηση όταν ελευθερωθεί τραπέζι.

### Σημαντικές αρχιτεκτονικές αποφάσεις

**Γιατί PostgreSQL function και όχι Edge Function**: το σχόλιο πάνω από τις
RLS πολιτικές κρατήσεων (Φάση 02) έλεγε ρητά ότι η κράτηση χρειάζεται
"trusted, server-side" λογική. Αντί για Edge Function με service role,
διάλεξα μία `SECURITY INVOKER` συνάρτηση PostgreSQL: μία κλήση συνάρτησης
= ένα transaction, οπότε ο έλεγχος διαθεσιμότητας και η εγγραφή δεν
μπορούν ποτέ να "σπάσουν" σε δύο ξεχωριστά βήματα που ένα ταυτόχρονο
αίτημα θα μπορούσε να παρεμβληθεί ανάμεσά τους. Επιπλέον, επειδή είναι
`SECURITY INVOKER` (όχι `DEFINER`), δεν χρειάστηκε να ξαναγραφτεί ο έλεγχος
"is_restaurant_member" μέσα στη συνάρτηση — το RLS το κάνει ήδη, όπως σε
κάθε άλλο client-side query. Η ροή κράτησης από ανώνυμο πελάτη (χωρίς
λογαριασμό προσωπικού, π.χ. δημόσιο widget) ΔΕΝ χτίστηκε εδώ — χρειάζεται
πραγματικά Edge Function με service role αφού δεν υπάρχει sesion
προσωπικού να χρησιμοποιήσει το RLS. Αυτό μένει ρητά για τη Φάση 08
(Customer Experience).

**Απλοποίηση ζώνης ώρας (timezone), τεκμηριωμένη**: οι οθόνες
ημερομηνίας/ώρας (`new.tsx`, `[reservationId].tsx`, `waitlist/*`) παίρνουν
"YYYY-MM-DD" + "HH:MM" ως απλά πεδία κειμένου και τα μετατρέπουν σε UTC
χρησιμοποιώντας τη ζώνη ώρας ΤΗΣ ΣΥΣΚΕΥΗΣ (`new Date(...)`), όχι τη ζώνη
ώρας του εστιατορίου (`restaurants.timezone`, IANA). Αυτό δουλεύει σωστά
μόνο όταν το προσωπικό βρίσκεται επιτόπου στο εστιατόριο (ίδια ζώνη ώρας) —
ισχύει για MVP όπου host/manager δουλεύουν από το κατάστημα, αλλά ΘΑ σπάσει
αν κάποιος διαχειρίζεται απομακρυσμένα εστιατόριο σε άλλη ζώνη ώρας (π.χ.
manager στη Γερμανία διαχειρίζεται κατάστημα στην Ελλάδα). Διορθώνεται
εύκολα αργότερα προσθέτοντας μια βιβλιοθήκη ζωνών ώρας (π.χ. date-fns-tz) —
δεν το πρόσθεσα τώρα για να μην προσθέσω dependency πριν χρειαστεί
πραγματικά.

**Party-size και ωράριο λειτουργίας: προειδοποίηση, όχι hard block**: η
`book_reservation` ΔΕΝ επιβάλλει τα `restaurants.min_party_size` /
`max_party_size` ούτε ελέγχει αν το εστιατόριο είναι ανοιχτό εκείνη την
ώρα (`opening_hours`/`special_hours`). Σκόπιμη επιλογή: το προσωπικό έχει
τον τελικό λόγο (π.χ. VIP εξαίρεση, private event εκτός ωραρίου) — αυτοί οι
έλεγχοι θα γίνουν ΑΥΣΤΗΡΟΙ μόνο στη Φάση 08, στο δημόσιο, μη επιβλεπόμενο
booking flow όπου δεν υπάρχει άνθρωπος να κρίνει την εξαίρεση.

**waitlist → κράτηση: δύο ξεχωριστά βήματα, όχι ένα atomic transaction**: η
`convertWaitlistEntryToReservation` καλεί πρώτα `bookReservation` και μετά
ενημερώνει την εγγραφή αναμονής. Δεν είναι ίδιου ρίσκου με τη διπλή
κράτηση τραπεζιού — αν το δεύτερο βήμα αποτύχει, η κράτηση παραμένει
έγκυρη και το προσωπικό μπορεί να σημάνει την αναμονή "booked" με το χέρι.
Δεν άξιζε η πολυπλοκότητα μιας ακόμα SQL συνάρτησης για κάτι που δεν είναι
safety-critical.

**`.single()` ΔΕΝ χρησιμοποιείται στην κλήση της `book_reservation`**: η
συνάρτηση επιστρέφει `public.reservations` (μονή γραμμή, όχι `setof`), οπότε
η PostgREST ήδη επιστρέφει ένα JSON object, όχι array — προσθέτοντας
`.single()` θα πρόσθετε μια συμπεριφορά (`Accept: vnd.pgrst.object+json`)
που δεν μπόρεσα να δοκιμάσω σε πραγματικό PostgREST εδώ (δεν υπάρχει
τέτοιος server στο sandbox). Το σχόλιο μέσα στο `reservations.ts` το
εξηγεί και το σημειώνω εδώ ξανά: πρώτο πράγμα για δοκιμή σε πραγματικό
Supabase project.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Δημόσιο, ανώνυμο booking flow** (πελάτης χωρίς λογαριασμό προσωπικού) —
  Φάση 08, χρειάζεται Edge Function με service role.
- **Αυτόματη ειδοποίηση όταν ελευθερωθεί τραπέζι για κάποιον στη λίστα
  αναμονής** — χρειάζεται το σύστημα ειδοποιήσεων (Φάση 09). Προς το παρόν
  το προσωπικό κοιτάει τη λίστα αναμονής με το μάτι και μετατρέπει χειροκίνητα.
  Τίμια απλό, όχι ψεύτικα έξυπνο.
- **Booking flow με events** (κρατήσεις δεμένες σε συγκεκριμένο event, π.χ.
  πρωτοχρονιά) — η στήλη `reservations.event_id` υπάρχει στο schema αλλά
  δεν εκτίθεται ακόμα σε καμία οθόνη· ξεχωριστό, μεγαλύτερο θέμα.
- **Επιβολή ωραρίου λειτουργίας / ορίων party size** στο `book_reservation`
  (βλ. παραπάνω, "Σημαντικές αρχιτεκτονικές αποφάσεις").
- **Πραγματική μετατροπή ζώνης ώρας (IANA)** για τα πεδία ημερομηνίας/ώρας
  (βλ. παραπάνω).

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase07_reservation_engine.sql` σε τοπικό PostgreSQL 16:
  11 τεστ (A–K), όλα με το αναμενόμενο αποτέλεσμα — tenant isolation σε
  select ΚΑΙ σε write μέσα από τη συνάρτηση (A, I), αυτόματη ανάθεση
  μεμονωμένου τραπεζιού (B), σωστή αποτυχία `NO_AVAILABILITY` όταν δεν
  χωράει τίποτα (C), εξαίρεση VIP τραπεζιού από αυτόματη ανάθεση (D),
  fallback σε συνδυασμό τραπεζιών (E) και σωστή αποτυχία όταν ο συνδυασμός
  είναι ήδη κρατημένος (F), το `EXCLUDE` constraint να αποτρέπει πραγματικά
  διπλή κράτηση όταν παρακάμπτεται η έξυπνη ανάθεση (G), επιτυχής
  αναπρογραμματισμός (H), αυτόματη σήμανση timestamp + ελευθέρωση τραπεζιού
  στις αλλαγές κατάστασης (J), και ότι ένας απλός "host" μπορεί επίσης να
  κάνει κράτηση (K), όπως προβλέπει η πολιτική RLS.
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 291 keys.
- 72 αρχεία `.ts`/`.tsx` περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ** (ίδιος περιορισμός sandbox — δεν
υπάρχει Supabase CLI, Deno runtime, ή πραγματικός PostgREST server, μόνο
απευθείας psql σε τοπική PostgreSQL):
- Καμία από τις νέες οθόνες δεν έτρεξε σε πραγματικό Expo/Supabase. Η
  σωστή λειτουργία του UI (φόρμες, πλοήγηση, availability preview) πρέπει
  να ελεγχθεί οπτικά στο δικό σου μηχάνημα.
- Η συμπεριφορά της PostgREST όταν καλείται η `book_reservation` μέσω
  `supabase-js` `.rpc()` — συγκεκριμένα αν το response είναι πράγματι ένα
  JSON object (όχι array) όπως αναμένω, και αν τα uuid[]/citext παραμέτροι
  περνάνε σωστά μέσω του PostgREST. Το σχήμα της συνάρτησης είναι σωστό SQL
  (επαληθεύτηκε με απευθείας κλήση από psql), αλλά η διαδρομή μέσω
  PostgREST/HTTP δεν δοκιμάστηκε.
- Η απλοποίηση ζώνης ώρας (device timezone = restaurant timezone) δεν έχει
  δοκιμαστεί με πραγματικό χρήστη σε διαφορετική ζώνη από το εστιατόριο.

## Φάση 08: Εμπειρία Πελάτη

Το δημόσιο, ανώνυμο booking site — αυτό που η Φάση 07 ρητά άφησε έξω. Ένας
επισκέπτης χωρίς κανέναν λογαριασμό μπορεί τώρα να βρει ένα εστιατόριο, να
δει το ωράριό του και να κλείσει τραπέζι απευθείας, χωρίς κανένα μέλος
προσωπικού να μεσολαβήσει. Ένας πελάτης μπορεί προαιρετικά να φτιάξει
λογαριασμό για να βλέπει το ιστορικό κρατήσεών του σε ΟΛΑ τα εστιατόρια που
έχει κλείσει τραπέζι, και να ακυρώσει μόνος του.

```
supabase/migrations/0014_public_customer_access.sql -- ΝΕΟ: RLS δημόσιας ανάγνωσης,
                                                         διόρθωση RLS customers, self-cancel
                                                         πελάτη, is_restaurant_open_at(),
                                                         book_public_reservation()
supabase/migrations/0015_fix_reservation_tables_propagation.sql -- ΝΕΟ: διόρθωση bug
                                                         (βλ. παρακάτω)
scripts/verify_phase08_public_booking.sql            -- ΝΕΟ: 11 τεστ (A–K) σε πραγματική PostgreSQL
scripts/local_dev_shim.sql                            -- ΕΠΕΚΤΑΘΗΚΕ: προστέθηκε ρόλος "anon"

packages/core/src/api/publicBooking.ts       -- ΝΕΟ: directory, προφίλ εστιατορίου, booking
packages/core/src/api/customerAccount.ts     -- ΝΕΟ: προφίλ πελάτη, "οι κρατήσεις μου"
packages/core/src/api/restaurants.ts         -- mapRestaurantRow/RestaurantRow έγιναν exported
packages/core/src/api/supabaseClient.ts      -- ΕΠΕΚΤΑΘΗΚΕ: προαιρετικό persistSession:false
packages/core/src/types/database.ts          -- ΝΕΟ: τύπος Customer
packages/i18n/src/locales/*.json             -- +2 νέα keys ανά γλώσσα (349 σύνολο) — namespace "public"

apps/web/
  app/page.tsx                    -- ΝΕΟ: ανίχνευση γλώσσας + redirect σε /{locale}
  app/[locale]/layout.tsx         -- ΝΕΟ: επικύρωση locale, header, language switcher
  app/[locale]/page.tsx           -- ΝΕΟ: κατάλογος εστιατορίων (Server Component)
  app/[locale]/r/[slug]/page.tsx  -- ΝΕΟ: δημόσιο προφίλ εστιατορίου + ωράριο
  app/[locale]/account/page.tsx   -- ΝΕΟ: login/signup πελάτη, προφίλ, ιστορικό, ακύρωση
  src/components/BookingForm.tsx  -- ΝΕΟ: η ίδια η φόρμα κράτησης (Client Component)
  src/components/LocaleSwitcher.tsx -- ΝΕΟ
  src/lib/supabase.ts             -- ΝΕΟ: browser Supabase client
  src/lib/supabaseServer.ts       -- ΝΕΟ: anonymous server-side client για Server Components
  src/lib/timezone.ts             -- ΝΕΟ: μετατροπή ζώνης ώρας πελάτη↔εστιατορίου
  src/lib/dictionary.ts           -- ΝΕΟ: ελαφρύ i18n για Server Components (χωρίς πλήρες i18next)
```

### Τι χτίστηκε

**Το δημόσιο booking flow ως μία `SECURITY DEFINER` συνάρτηση PostgreSQL
(`book_public_reservation`), όχι Edge Function**: η Φάση 07 άφησε ρητά
ανοιχτό αυτό το ερώτημα ("χρειάζεται πραγματικά Edge Function με service
role αφού δεν υπάρχει session προσωπικού"). Αντ' αυτού, η `book_public_
reservation` είναι `SECURITY DEFINER` και καλεί εσωτερικά την ήδη υπάρχουσα
`SECURITY INVOKER` `book_reservation()` της Φάσης 07 για την πραγματική
ανάθεση τραπεζιού. Επειδή μια `SECURITY INVOKER` συνάρτηση που καλείται ΜΕΣΑ
από μια `SECURITY DEFINER` συνάρτηση τρέχει ως ο ΤΡΕΧΩΝ χρήστης (δηλαδή ήδη
ο owner της definer, λόγω του εξωτερικού πλαισίου), πετυχαίνουμε την ίδια
εγγύηση παράκαμψης RLS που θα έδινε μια Edge Function με service role, χωρίς
να χρειαστεί ξεχωριστό Deno service, CORS, ή διαχείριση service-role key.
Λιγότερη υποδομή, ίδια ασφάλεια.

**Το `is_restaurant_open_at()`**: ελέγχει αν ένα εστιατόριο είναι πραγματικά
ανοιχτό μια δεδομένη χρονική στιγμή, λαμβάνοντας υπόψη τόσο τις εξαιρέσεις
(`special_hours`) όσο και το κανονικό εβδομαδιαίο πρόγραμμα
(`opening_hours`), ΣΥΜΠΕΡΙΛΑΜΒΑΝΟΜΕΝΗΣ της περίπτωσης βάρδιας που διασχίζει
τα μεσάνυχτα (π.χ. μπαρ ανοιχτό 22:00–02:00). Χρησιμοποιεί το εγγενές
`AT TIME ZONE` της PostgreSQL για σωστό υπολογισμό της τοπικής ώρας-τοίχου
βάσει IANA ζώνης ώρας — προτιμήθηκε ρητά από χειροκίνητο υπολογισμό σε
JS/Deno, γιατί επαληθεύεται άμεσα με psql.

**Το ίδιο το `book_public_reservation`**: επικυρώνει, με αυτή τη σειρά,
party size εντός ορίων (`PARTY_SIZE_OUT_OF_RANGE` — αυτό που η Φάση 07
ρητά ΔΕΝ επέβαλλε), booking window (`OUTSIDE_BOOKING_WINDOW`), αν το
εστιατόριο είναι ανοιχτό (`RESTAURANT_CLOSED`), στοιχεία επισκέπτη
(`GUEST_DETAILS_REQUIRED` — όνομα ΚΑΙ (τηλέφωνο Ή email)), και έναν βασικό
anti-spam έλεγχο ρυθμού (βλ. παρακάτω). Μετά καλεί την `book_reservation`
της Φάσης 07 για την πραγματική ανάθεση τραπεζιού — άρα `NO_AVAILABILITY`/
`DOUBLE_BOOKED`/`RESTAURANT_NOT_FOUND` μπορούν επίσης να προκύψουν εδώ.
Αναγνωρίζει ταυτότητα: αν υπάρχει συνδεδεμένος χρήστης (`auth.uid()`),
ψάχνει (ή δημιουργεί lazy) τη γραμμή `customers` του και συμπληρώνει
όνομα/τηλέφωνο/email από το προφίλ του αν ο επισκέπτης δεν τα ξαναέγραψε.

**Βασικός anti-spam έλεγχος ρυθμού**: μέγιστο 3 κρατήσεις με προέλευση
`web` ανά τηλέφωνο/email σε 15 λεπτά, καθολικά σε όλα τα εστιατόρια. Αυτό
είναι ΠΡΑΓΜΑΤΙΚΟΣ αλλά ρητά ΜΕΡΙΚΟΣ μετριασμός — δεν αντικαθιστά rate
limiting σε επίπεδο IP/δικτύου, το οποίο ΔΕΝ έχει χτιστεί (βλ. "Τι ΔΕΝ
χτίστηκε").

**Δημόσια RLS ανάγνωσης, στενά καθορισμένη**: `restaurants`, `opening_hours`,
`special_hours` γίνονται ορατά σε `anon` ΜΟΝΟ για ενεργά, μη διαγραμμένα
εστιατόρια. Ρητά ΔΕΝ εκτέθηκαν `tables`/`table_zones`/`reservation_tables`/
`table_combinations` — ο υπολογισμός διαθεσιμότητας για δημόσια κράτηση
γίνεται εξ ολοκλήρου ΜΕΣΑ στην `SECURITY DEFINER` συνάρτηση, στον server,
οπότε δεν χρειάζεται ο πελάτης να έχει απευθείας πρόσβαση στο floor plan.
Αυτό επίσης αποτρέπει τη διαρροή ευαίσθητων εμπορικά στοιχείων πληρότητας
σε ανώνυμους scrapers.

**Ακύρωση από τον ίδιο τον πελάτη**: νέα, στενά καθορισμένη RLS πολιτική
(`reservations_customer_cancel`) επιτρέπει σε έναν συνδεδεμένο πελάτη να
αλλάξει ΜΟΝΟ το status της ΔΙΚΗΣ του κράτησης σε `cancelled` (και μόνο αν
δεν είναι ήδη σε τελική κατάσταση) — καμία άλλη αλλαγή δεν επιτρέπεται.

**Δημόσιο booking site σε Next.js** (`apps/web`): κατάλογος εστιατορίων,
δημόσιο προφίλ με ωράριο, ενσωματωμένη φόρμα κράτησης, και σελίδα
λογαριασμού πελάτη (login/signup, προφίλ, ιστορικό κρατήσεων, ακύρωση) —
όλα σε 4 γλώσσες (DE/EN/EL/TR) με ξεχωριστό μεταφραστικό namespace `public.*`.

### Σημαντικές αρχιτεκτονικές αποφάσεις

**Πραγματικό bug που βρέθηκε ΚΑΙ διορθώθηκε κατά τον έλεγχο — όχι απλά
τεκμηριωμένο, πραγματικά διορθωμένο**: το test J του verification script
αποκάλυψε ότι όταν ένας πελάτης ακύρωνε μόνος του την κράτησή του, το
`reservation_tables.blocks_availability` ΔΕΝ γύριζε ποτέ σε `false` — το
τραπέζι έμενε "μπλοκαρισμένο" για πάντα, παρόλο που η ίδια η κράτηση
σωστά σημειωνόταν `cancelled`. Αιτία: το trigger `reservations_propagate_
to_tables` (Φάση 02) είναι απλή `SECURITY INVOKER` συνάρτηση· όταν έτρεχε
λόγω αλλαγής status ΑΠΟ ΠΡΟΣΩΠΙΚΟ, το εσωτερικό του UPDATE στο
`reservation_tables` περνούσε κανονικά από RLS επειδή το προσωπικό είναι
`is_restaurant_member`. Όταν όμως το ίδιο trigger έτρεχε λόγω αλλαγής status
ΑΠΟ ΠΕΛΑΤΗ (μέσω της νέας `reservations_customer_cancel`), το εσωτερικό
UPDATE έτρεχε ΩΣ ο πελάτης — ο οποίος δεν έχει ΚΑΜΙΑ πρόσβαση RLS στο
`reservation_tables` (παραμένει staff-only, σκόπιμα) — οπότε το RLS το
σιωπηλά φιλτράρει σε 0 γραμμές, χωρίς σφάλμα. Διορθώθηκε με νέα migration
(0015): το trigger έγινε `SECURITY DEFINER`, ίδιο μοτίβο με τη
`get_restaurant_staff` της Φάσης 05 και την ίδια τη `book_public_
reservation` εδώ — πρόκειται για εσωτερική λογιστική συνέπειας που πρέπει
να ισχύει ΑΝΕΞΑΡΤΗΤΑ από το ποιος άλλαξε την κράτηση. Χωρίς αυτή τη
διόρθωση, κάθε αυτο-ακύρωση πελάτη θα άφηνε το τραπέζι "κλειδωμένο" ώστε
κανείς άλλος να μην μπορεί να το κλείσει — ένα πραγματικά σοβαρό bug
διαθεσιμότητας που η ίδια η επαλήθευση (όχι ο χρήστης) το εντόπισε.

**Ο επισκέπτης-χωρίς-λογαριασμό ΔΕΝ μπορεί να ξαναδιαβάσει τη δική του
κράτηση**: καμία RLS πολιτική δεν το επιτρέπει (επαληθεύτηκε ρητά στο
test C). Αυτό καθόρισε άμεσα το σχέδιο του `BookingForm.tsx`: η οθόνη
επιβεβαίωσης χτίζεται ΑΠΟΚΛΕΙΣΤΙΚΑ από την ίδια την απάντηση της κλήσης
`book_public_reservation`, ποτέ από επόμενο fetch — είναι η ΜΟΝΗ ευκαιρία
να δει ο επισκέπτης τα στοιχεία της κράτησής του.

**Ζώνη ώρας: πιο αυστηρή λύση εδώ απ' ό,τι στη Φάση 07**, σκόπιμα. Η Φάση 07
δέχτηκε "συσκευή προσωπικού = ζώνη ώρας εστιατορίου" γιατί το προσωπικό
είναι επιτόπου. Εδώ ο πελάτης μπορεί να είναι ΟΠΟΥΔΗΠΟΤΕ — οπότε το
`apps/web/src/lib/timezone.ts` μετατρέπει ρητά την τοπική ημερομηνία/ώρα
που πληκτρολογεί ο πελάτης ΣΤΗ ΖΩΝΗ ΩΡΑΣ ΤΟΥ ΕΣΤΙΑΤΟΡΙΟΥ (όχι του browser
του) σε UTC, χρησιμοποιώντας το εγγενές `Intl`/`toLocaleString` του
browser (τεχνική "μορφοποίησε δύο φορές, βρες τη διαφορά" — καμία νέα
εξάρτηση όπως date-fns-tz). Γνωστός, τεκμηριωμένος περιορισμός: μονο-περασμα
υπολογισμός, οπότε η μία ώρα του χρόνου με αμφίσημη ή ανύπαρκτη τοπική ώρα
(αλλαγή θερινής ώρας) μπορεί να αποκλίνει κατά το delta της αλλαγής — ίδιος
περιορισμός με την default συμπεριφορά του δημοφιλούς date-fns-tz.

**`app/layout.tsx` (root) παραμένει `lang="en"` στατικό**: το Next.js App
Router απαιτεί το ΠΡΑΓΜΑΤΙΚΟ root layout να ορίζει `<html>/<body>`, και αυτό
το segment βρίσκεται ΠΑΝΩ από το `[locale]` param — άρα δεν έχει πρόσβαση σε
αυτό. Κάθε ορατό string σε κάθε σελίδα σερβίρεται σωστά στη σωστή γλώσσα
μέσω του dictionary· επηρεάζεται μόνο το attribute `<html lang>` που
βλέπουν screen readers και μηχανές αναζήτησης. Τεκμηριωμένος περιορισμός,
όχι bug — η εναλλακτική (middleware.ts + μετακίνηση του `<html>` μέσα στο
`[locale]` segment) θα πρόσθετε πολυπλοκότητα χωρίς πραγματικό όφελος σε
αυτό το στάδιο.

**Ελαφρύ dictionary αντί για πλήρες i18next στα Server Components**: τα
Server Components (κατάλογος, προφίλ εστιατορίου) τρέχουν μία φορά στον
server ανά αίτημα, χωρίς client-side αλλαγή γλώσσας — οπότε το
`src/lib/dictionary.ts` είναι απλή αντικειμενική αναζήτηση (dot-path) πάνω
στο ήδη υπάρχον JSON του `@reservex/i18n`, όχι το πλήρες i18next runtime
(interpolation engine, React hooks) που χρησιμοποιεί η εφαρμογή κινητού.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Πλήρης αναπρογραμματισμός από τον πελάτη** — μόνο ακύρωση χτίστηκε εδώ.
  Reschedule χρειάζεται UI για επιλογή νέου slot με προεπισκόπηση
  διαθεσιμότητας, μεγαλύτερο θέμα για επόμενη φάση.
- **Booking flow δεμένο σε event** (`reservations.event_id`) — παραμένει
  εκτός scope, όπως και στη Φάση 07.
- **Ενσωματώσιμο booking widget** (iframe/script για το site ενός
  εστιατορίου) — ξεχωριστό, μεγαλύτερο θέμα (χρειάζεται δικό του CORS/
  embedding σχέδιο).
- **Πλήρες rate limiting σε επίπεδο IP/δικτύου** — μόνο ο βασικός έλεγχος
  ανά τηλέφωνο/email χτίστηκε (βλ. παραπάνω). Πραγματικό gap πριν production.
- **Cookie-based "θυμήσου τη γλώσσα μου"** — η `/` πάντα ανιχνεύει από
  Accept-Language ξανά, δεν θυμάται προηγούμενη επιλογή του επισκέπτη.
- **Reset password ροή για πελάτη** — υπάρχει για προσωπικό στο κινητό, όχι
  ακόμα εδώ.
- **Αναζήτηση/φιλτράρισμα στον κατάλογο εστιατορίων** — τίμια απλή λίστα,
  λογικό με λίγα pilot εστιατόρια· αξίζει τη δουλειά μόνο όταν υπάρχουν
  αρκετά εστιατόρια ώστε να έχει νόημα.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase08_public_booking.sql` σε τοπική PostgreSQL 16:
  11 τεστ (A–K), όλα με το αναμενόμενο αποτέλεσμα — δημόσια ανάγνωση
  ενεργού εστιατορίου (A) χωρίς διαρροή floor plan (B), πλήρες guest
  booking end-to-end με ρητή απόδειξη ότι ο επισκέπτης δεν μπορεί να το
  ξαναδιαβάσει (C), απόρριψη εκτός ορίων party size (D), booking window
  (E) και κλειστό εστιατόριο (F), απαίτηση στοιχείων επισκέπτη (G), rate
  guard να ενεργοποιείται στην 4η προσπάθεια ΠΡΙΝ καν ελεγχθεί
  διαθεσιμότητα (H), η διόρθωση RLS `customers` να μπλοκάρει spoofing
  `auth_user_id` σε insert ΚΑΙ update (I), σωστή συμπλήρωση προφίλ
  συνδεδεμένου πελάτη + απομόνωση μεταξύ πελατών + self-cancel-μόνο (J,
  συμπεριλαμβανομένης της επιβεβαίωσης ότι το 0015 πραγματικά ελευθερώνει
  το τραπέζι μετά την ακύρωση), και ότι ανενεργό εστιατόριο ποτέ δεν
  διαρρέει σε `anon` (K).
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 349 keys.
- 84 αρχεία `.ts`/`.tsx` περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα
  (72 πριν τη Φάση 08 + οι νέες σελίδες/components/API modules εδώ).

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ** (ίδιος περιορισμός sandbox — χωρίς
πρόσβαση δικτύου σε npm registry, άρα χωρίς πραγματικό `pnpm install` των
Next.js/React/Supabase πακέτων, και χωρίς Supabase CLI/PostgREST server):
- Καμία σελίδα του `apps/web` δεν έτρεξε πραγματικά σε browser — ο
  συντακτικός έλεγχος TypeScript αποδεικνύει ότι ο κώδικας είναι έγκυρος,
  ΟΧΙ ότι αποδίδει σωστά οπτικά, ότι το routing του Next.js δουλεύει όπως
  αναμένεται, ή ότι το `next build` περνάει καθαρά.
- Η ίδια η κλήση `book_public_reservation` μέσω `supabase-js` `.rpc()` από
  πραγματικό browser — η SQL πλευρά επαληθεύτηκε πλήρως με απευθείας psql,
  αλλά η διαδρομή HTTP/PostgREST όχι, ίδιος περιορισμός με τη Φάση 07.
- Η μετατροπή ζώνης ώρας (`zonedTimeToUtc`) δεν δοκιμάστηκε με πραγματικό
  browser `Intl` implementation ή με πραγματικό επισκέπτη σε διαφορετική
  ζώνη ώρας από το εστιατόριο.
- Το `next build`/`next lint` δεν έτρεξαν καθόλου (απαιτούν `pnpm install`
  που δεν είναι δυνατό εδώ) — μόνο ο ανεξάρτητος συντακτικός έλεγχος TS.

## Φάση 09: Ειδοποιήσεις

Το schema ειδοποιήσεων της Φάσης 02 (`notifications`, `staff_notification_
preferences`, `reminder_rules`) υπήρχε από την αρχή αλλά ήταν ουσιαστικά
νεκρό — καμία οθόνη, καμία συνάρτηση δεν έγραφε ποτέ σε αυτό. Αυτή η φάση
το ενεργοποιεί: πραγματικά, αυτόματα queue-αρισμένες ειδοποιήσεις όταν
συμβαίνει κάτι πραγματικό (νέα κράτηση, ακύρωση, no-show,
αναπρογραμματισμός), και ένα γνήσια λειτουργικό inbox εντός εφαρμογής, τόσο
για προσωπικό (κινητό) όσο και για πελάτες (web).

```
supabase/migrations/0016_notifications_automation.sql -- ΝΕΟ: queue_notification(),
  should_notify_staff(), schedule_reservation_reminders(), trigger στις κρατήσεις,
  νέες τιμές enum (in_app, guest), νέα στήλη reservation_id, νέα RLS policy mark-as-read
scripts/verify_phase09_notifications.sql -- ΝΕΟ: 11 τεστ (A–K) σε πραγματική PostgreSQL

packages/core/src/api/notifications.ts       -- ΝΕΟ: inbox προσωπικού, προτιμήσεις,
                                                 reminder rules CRUD
packages/core/src/api/customerAccount.ts     -- ΕΠΕΚΤΑΘΗΚΕ: fetchMyNotificationsAsCustomer
packages/core/src/api/restaurants.ts         -- (αμετάβλητο εδώ, απλά για αναφορά exports)
packages/core/src/types/database.ts          -- ΝΕΟ: Notification, NotificationRecipientType,
                                                 NotificationStatus, StaffNotificationPreference,
                                                 ReminderRule· NotificationChannel += 'in_app'
packages/i18n/src/locales/*.json             -- +37 νέα keys ανά γλώσσα (386 σύνολο) --
                                                 namespace "notifications", +settings/public.account keys

apps/mobile/app/(tabs)/settings/
  index.tsx                        -- "Ειδοποιήσεις" έγινε πραγματικό NavRow (ήταν stub)
  notifications/index.tsx          -- ΝΕΟ: inbox (unread dot, mark-as-read)
  notifications/preferences.tsx    -- ΝΕΟ: toggle ανά τύπο συμβάντος (μόνο κανάλι in_app)
  notifications/reminder-rules.tsx -- ΝΕΟ: CRUD κανόνων υπενθύμισης (owner/manager)

apps/web/app/[locale]/account/page.tsx -- ΕΠΕΚΤΑΘΗΚΕ: ενότητα "Ειδοποιήσεις" (inbox πελάτη)
```

### Τι χτίστηκε

**`queue_notification()` -- ο ΜΟΝΟΣ δρόμος εγγραφής στο `notifications`**:
SECURITY DEFINER συνάρτηση, γιατί ο πίνακας `notifications` δεν είχε ΠΟΤΕ
insert RLS policy για κανέναν ρόλο πελάτη (μόνο η υπάρχουσα `notifications_
select` από τη Φάση 02) — ακριβώς όπως έλεγε το αρχικό σχόλιο του πίνακα
("a background worker picks up..."). Κάθε trigger αυτής της φάσης περνάει
από αυτήν αντί να κάνει insert απευθείας.

**Το κανάλι `in_app` είναι το μοναδικό που παραδίδεται πραγματικά**: μια
γραμμή `in_app` σημειώνεται `delivered` τη στιγμή που δημιουργείται — τα
εισερχόμενα διαβάζουν ακριβώς αυτόν τον πίνακα, χωρίς ξεχωριστό βήμα
παράδοσης. Οι γραμμές `push`/`email`/`sms`/`whatsapp` παραμένουν `queued`
ακριβώς όπως θα μπορούσαν από τη Φάση 02 — δεν υπάρχει πραγματικός
dispatcher (βλ. "Τι ΔΕΝ χτίστηκε").

**Το trigger `trg_reservations_notify`** (AFTER INSERT OR UPDATE στο
`reservations`) καλύπτει και τους δύο δρόμους δημιουργίας κράτησης
(`book_reservation` της Φάσης 07 ΚΑΙ `book_public_reservation` της Φάσης
08, αφού και οι δύο καταλήγουν στον ίδιο πίνακα): νέα κράτηση ειδοποιεί το
ΥΠΟΛΟΙΠΟ προσωπικό (όχι όποιον τη δημιούργησε, χάρη στο `created_by_user_
id`) και επιβεβαιώνει στον πελάτη/guest· ακύρωση ειδοποιεί όλο το ενεργό
προσωπικό + τον πελάτη, ΚΑΙ αποσύρει οποιαδήποτε υπενθύμιση είχε ήδη
προγραμματιστεί για αυτήν την κράτηση· no-show ειδοποιεί μόνο το
προσωπικό, ποτέ τον πελάτη· αναπρογραμματισμός (αλλαγή ώρας/ατόμων χωρίς
αλλαγή status -- έτσι δουλεύει η `book_reservation` για reschedule)
επαναϋπολογίζει τις υπενθυμίσεις από την ΝΕΑ ώρα και ειδοποιεί προσωπικό +
πελάτη.

**`schedule_reservation_reminders()`**: διαβάζει τους ενεργούς `reminder_
rules` του εστιατορίου, υπολογίζει `starts_at - minutes_before_start` για
κάθε κανόνα, και αγνοεί σιωπηλά όποιον κανόνα η ώρα εκκίνησής του είναι
ήδη στο παρελθόν (π.χ. κανόνας "24 ώρες πριν" σε κράτηση που έγινε
αυθημερόν). Πάντα διαγράφει πρώτα τις ΔΙΚΕΣ ΤΗΣ ήδη-προγραμματισμένες
υπενθυμίσεις πριν ξαναϋπολογίσει — έτσι είναι ασφαλές να καλείται ξανά σε
κάθε αναπρογραμματισμό χωρίς να αφήνει "διπλές" ή ξεπερασμένες υπενθυμίσεις.

**Πραγματικό, τεκμηριωμένο κενό σχήματος που διορθώθηκε**: το `check`
constraint του `notifications` (Φάση 02) απαιτούσε είτε `recipient_
customer_id` είτε `recipient_user_id` -- καμία επιλογή για έναν guest ΧΩΡΙΣ
κανένα λογαριασμό, μια έννοια που δεν υπήρχε πριν τη Φάση 08. Προστέθηκε
νέα τιμή enum `guest` και χαλάρωσε το constraint ώστε και οι δύο στήλες να
μπορούν να είναι null όταν `recipient_type='guest'` -- τα στοιχεία
επικοινωνίας ταξιδεύουν μέσα στο `payload` αντί να δείχνουν σε καμία γραμμή.

**Real πραγματικό bug που αποτράπηκε ΠΡΙΝ χτιστεί, όχι μετά**: κατά τον
σχεδιασμό της οθόνης κανόνων υπενθύμισης παρατηρήθηκε ότι το κανάλι
`in_app` δεν έχει νόημα για μια υπενθύμιση -- η `queue_notification()`
σημειώνει μια γραμμή `in_app` ως `delivered` ΤΗ ΣΤΙΓΜΗ που δημιουργείται,
ανεξαρτήτως `scheduled_for`, οπότε μια "υπενθύμιση εντός εφαρμογής" θα
εμφανιζόταν στα εισερχόμενα την ΩΡΑ ΤΗΣ ΚΡΑΤΗΣΗΣ, όχι πριν την άφιξη --
ακριβώς το αντίθετο από τον σκοπό της. Προστέθηκε `check` constraint
(`reminder_rules_channel_not_in_app`) που το εμποδίζει ρητά στη βάση, όχι
μόνο στο UI.

**In-app inbox και για τους δύο κόσμους**: το κινητό (προσωπικό) διαβάζει
`recipient_user_id = auth.uid()`, το web (πελάτης) διαβάζει `recipient_
customer_id = <δικό του customers.id>` -- ίδιος πίνακας, ίδιο RLS
(`notifications_select`, Φάση 02), δύο ξεχωριστές, στενές queries.

**Νέα RLS policy `notifications_recipient_mark_read`**: επιτρέπει ΜΟΝΟ στον
παραλήπτη να αλλάξει τη ΔΙΚΗ ΤΟΥ γραμμή σε `status='read'` -- τίποτα άλλο.
Το test I το αποδεικνύει ρητά: ένα μέλος προσωπικού ΒΛΕΠΕΙ τις ειδοποιήσεις
συναδέλφων του (χάρη στο προϋπάρχον `is_restaurant_member` της SELECT
πολιτικής) αλλά ΔΕΝ μπορεί να τις σημειώσει ως αναγνωσμένες -- το UPDATE
απλά επηρεάζει 0 γραμμές.

### Σημαντικές αρχιτεκτονικές αποφάσεις

**Ασυμμετρία στο "ποιος εξαιρείται" -- τεκμηριωμένη, όχι παράβλεψη**: μόνο
η ειδοποίηση "νέα κράτηση" εξαιρεί ρητά όποιον τη δημιούργησε
(`created_by_user_id` υπάρχει στη γραμμή). Ακύρωση/no-show/αναπρογραμματισμός
ΔΕΝ έχουν αντίστοιχη στήλη "ποιος το άλλαξε τελευταία" -- το `reservations`
καταγράφει μόνο τον αρχικό δημιουργό -- οπότε αυτές ειδοποιούν ΟΛΟ το
ενεργό προσωπικό, ακόμα κι αν ο ίδιος που έκανε την αλλαγή είναι μέσα στη
λίστα. Θα μπορούσε να προστεθεί μια στήλη `last_changed_by_user_id` για να
διορθωθεί αργότερα -- δεν άξιζε τώρα μια νέα στήλη + backfill λογική για
ένα καθαρά cosmetic ζήτημα "μην ειδοποιήσεις τον εαυτό σου".

**Ο πελάτης ειδοποιείται για τη ΔΙΚΗ ΤΟΥ ακύρωση, ακόμα κι αν την έκανε ο
ίδιος**: σκόπιμο -- λειτουργεί σαν απόδειξη/επιβεβαίωση ("η ακύρωσή σου
καταγράφηκε"), όχι σαν ενοχλητική επανάληψη κάτι που ήδη ξέρει.

**Καμία πραγματική αποστολή push/email/SMS δεν χτίστηκε**: αυτό το sandbox
δεν έχει δικτυακή πρόσβαση σε πραγματικό push provider (Expo Push/FCM/
APNs) ή email API, ούτε Deno runtime για να τρέξει ένα πραγματικό Edge
Function dispatcher. Το να χτιστεί ένα "dispatcher" Edge Function χωρίς
τρόπο να δοκιμαστεί θα σήμαινε να παρουσιαστεί μη επαληθευμένος κώδικας ως
δουλεμένος -- αντίθετο στην αρχή "καμία ψεύτικη λειτουργικότητα". Ό,τι
χτίστηκε (η ουρά, το in-app inbox) είναι πραγματικό και επαληθευμένο· ό,τι
δεν χτίστηκε είναι ρητά καταγεγραμμένο, όχι κρυμμένο.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Πραγματικός dispatcher push/email/SMS/WhatsApp** -- χρειάζεται πραγματικό
  provider (Expo Push, FCM/APNs, SendGrid/Postmark/Resend κ.λπ.) με
  δικτυακή πρόσβαση που δεν υπάρχει σε αυτό το sandbox. Οι γραμμές μένουν
  ειλικρινά `queued`.
- **Πίνακας push device tokens** -- δεν υπάρχει ακόμα στο schema· θα
  χρειαστεί μαζί με τον πραγματικό push dispatcher.
- **Στήλη "ποιος το άλλαξε τελευταία"** στο `reservations` (βλ. παραπάνω
  ασυμμετρία).
- **Toggle προτιμήσεων για κανάλια εκτός `in_app`** στο UI -- θα υπονοούσε
  λειτουργικό dispatcher πίσω τους που δεν υπάρχει.
- **Push notification badge/κόκκινος αριθμός** στο tab bar του κινητού --
  θα χρειαζόταν πραγματικές push ειδοποιήσεις για να έχει νόημα πέρα από
  αισθητική.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase09_notifications.sql` σε ολόκληρη ΚΑΙΝΟΥΡΙΑ τοπική
  PostgreSQL 16 (rebuild από την 0001 μέχρι την 0016 + seed, όχι πάνω σε
  παλιά κατάσταση): 11 τεστ (A–K) -- νέα κράτηση ειδοποιεί ΜΟΝΟ τον άλλο
  υπάλληλο (A), ρητό opt-out σεβαστό (B), κανόνας υπενθύμισης πυροδοτεί ΚΑΙ
  κανόνας με ήδη περασμένη ώρα αγνοείται σιωπηλά (C/D), guest booking
  queue-άρει σωστά email επιβεβαίωση + καμία υπενθύμιση όταν ο μόνος
  ενεργός κανόνας είναι push-only (E), ακύρωση ειδοποιεί ΚΑΙ αποσύρει
  υπενθύμιση (F), no-show ειδοποιεί προσωπικό ΠΟΤΕ πελάτη (G),
  αναπρογραμματισμός επαναϋπολογίζει σωστά από τη ΝΕΑ ώρα (H), mark-as-read
  RLS -- μόνο η δική σου γραμμή, μόνο σε `read`, ποτέ αλλού (I), πλήρης
  απομόνωση πελατών στο inbox (J), και ότι το `queue_notification()`
  πράγματι είναι ο μοναδικός δρόμος εγγραφής (K).
- Κατά την πρώτη εκτέλεση εντοπίστηκαν ΚΑΙ διορθώθηκαν: (1) το ίδιο `CASE`-
  cast bug που είχε ξαναδεί στη Φάση 08 (audit_logs) -- τώρα στο
  `queue_notification()`'s status column· (2) μόλυνση test-session λόγω
  `set_config(..., is_local=false)` που επιβίωνε ανάμεσα σε "different
  identity" blocks, κάνοντας ένα anon guest booking να φαίνεται σαν
  συνδεδεμένος χρήστης -- διορθώθηκε καθαρίζοντας ρητά το claim πριν το
  Test E· (3) μια λάθος προσδοκία στο ίδιο το test script (περίμενε 2
  ειδοποιημένους υπαλλήλους, αγνοώντας ότι ο ένας είχε ήδη κάνει opt-out σε
  προηγούμενο test) -- διορθώθηκε το σχόλιο του test, όχι ο κώδικας.
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 386 keys.
- 88 αρχεία `.ts`/`.tsx` περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα.
- Επαληθεύτηκε ΚΑΙ ότι η 0016 δεν έσπασε τίποτα από τις προηγούμενες
  φάσεις: τα `verify_phase07_reservation_engine.sql` και `verify_phase08_
  public_booking.sql` ξανατρέχτηκαν πάνω στην ΙΔΙΑ βάση μετά την 0016 και
  πέρασαν όπως πριν.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ** (ίδιος περιορισμός sandbox):
- Καμία από τις νέες οθόνες (κινητό ή web) δεν έτρεξε πραγματικά -- μόνο
  συντακτικός έλεγχος TypeScript.
- Καμία πραγματική αποστολή push/email/SMS -- δεν χτίστηκε καν, βλ. "Τι ΔΕΝ
  χτίστηκε".
- Η συμπεριφορά μέσω πραγματικού PostgREST/`supabase-js` `.rpc()`/`.from()`
  για τις νέες queries -- ίδιος περιορισμός με κάθε προηγούμενη φάση.

## Φάση 10: AI Gateway

Η Φάση 10 χτίζει το επίπεδο AI που το σχήμα της Φάσης 02 (`ai_conversations`/
`ai_messages`/`ai_actions`, migration `0009_ai.sql`) περίμενε αδρανές από
τότε -- ακριβώς όπως το σχήμα ειδοποιήσεων περίμενε μέχρι τη Φάση 09. Η
βασική αρχή, ρητά από το blueprint: το AI ΔΕΝ αγγίζει ποτέ τη βάση απευθείας.
Μιλάει σε ένα κλειστό σύνολο εργαλείων (tools), κάθε ένα εκτελείται μέσα από
ένα Edge Function με πλήρη έλεγχο εξουσιοδότησης ΠΡΙΝ από κάθε ενέργεια, και
κάθε κλήση καταγράφεται πλήρως στο `ai_actions`.

### Τι χτίστηκε

- **`packages/ai`** (νέο πακέτο του monorepo): ο ορισμός των 8 εργαλείων
  (`findAvailability`, `getReservation`, `getAnalytics`, `createReservation`,
  `modifyReservation`, `cancelReservation`, `bulkCancelReservations`,
  `updateRestaurantSettings`) με risk tier (low/medium/high) και
  `requiresConfirmation` ακριβώς όπως τα ορίζει το blueprint· η αφαίρεση
  `AIProvider` (chat/transcribe/speak)· η υλοποίηση `AnthropicProvider` με
  απλό `fetch` προς το Anthropic Messages API (όχι το SDK -- εξηγείται
  παρακάτω γιατί)· και μια απλή ευρετική `selectModel()` για τη στρατηγική
  "μικρό μοντέλο για απλά ερωτήματα, μεγάλο για πολύπλοκα/tool-chains" που
  προτείνει το blueprint.
- **`supabase/functions/ai-gateway`** (νέο Edge Function, Deno, service
  role): ο ίδιος ο AI Gateway. Δύο ενέργειες -- `chat` (ένας γύρος
  συνομιλίας: φορτώνει ιστορικό, καλεί το `AIProvider`, αν το μοντέλο ζητήσει
  εργαλείο τρέχει authorize+summarize, εκτελεί αμέσως τα read-only εργαλεία ή
  απλώς προτείνει τα υπόλοιπα) και `confirm`/`reject` (ο άνθρωπος εγκρίνει ή
  απορρίπτει μια πρόταση -- η `confirm` ΞΑΝΑτρέχει το authorize από την αρχή,
  δεν εμπιστεύεται τίποτα από τη στιγμή της πρότασης). Κάθε εργαλείο
  (`supabase/functions/ai-gateway/tools.ts`) υλοποιεί τα ίδια 5 βήματα του
  blueprint: Authentication (μία φορά, στην είσοδο) → Authorization →
  Validation → Business rules → DB operation.
- **`supabase/migrations/0017_ai_gateway.sql`**: μία και μοναδική νέα
  συνάρτηση, `get_reservation_analytics()` (SECURITY INVOKER, με ρητό έλεγχο
  `is_restaurant_member()` πριν τρέξει τίποτα) -- τίποτα άλλο δεν χρειαζόταν
  αλλαγή στη βάση, γιατί όλα τα υπόλοιπα εργαλεία είναι λεπτά wrappers πάνω
  σε ήδη υπάρχουσες, ήδη επαληθευμένες συναρτήσεις/RLS policies των Φάσεων
  04-09 (`book_reservation`, `get_available_tables`/`_combinations`, η απλή
  `UPDATE reservations` για ακύρωση, η `UPDATE restaurants` για ρυθμίσεις).
- **`packages/core/src/api/ai.ts`**: `sendAiChatMessage()`,
  `confirmAiAction()`, `rejectAiAction()` (καλούν το Edge Function),
  `fetchAiConversationMessages()`/`fetchMyAiConversations()` (απλά RLS-scoped
  reads, χωρίς Edge Function).
- **`apps/mobile/app/(tabs)/ai.tsx`**: αντικαταστάθηκε πλήρως το placeholder
  της Φάσης 03 με πραγματική οθόνη συνομιλίας -- λίστα μηνυμάτων, input
  πλέον editable, και μια κάρτα επιβεβαίωσης (χρώμα "pulse", το ίδιο
  `variant="ai"` του `Button` που υπήρχε έτοιμο από τη Φάση 03 ακριβώς για
  αυτή τη χρήση) όποτε το μοντέλο προτείνει κάτι που χρειάζεται έγκριση.
- Νέα `ai.*` i18n keys και στις 4 γλώσσες (398 keys συνολικά, parity
  επαληθευμένη).

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Το φαινομενικό "RLS κενό" στο `ai_conversations_insert` δεν διορθώθηκε
  -- αποδείχτηκε ότι δεν χρειάζεται διόρθωση.** Το policy
  (`with check (user_id = auth.uid())`) δεν μπορεί ποτέ να ικανοποιηθεί για
  `customer_chat`/`voice`/`whatsapp` (εκεί το `user_id` είναι πάντα null,
  από τον ίδιο τον constraint του πίνακα). Αυτό αρχικά έμοιαζε με bug προς
  διόρθωση. Αλλά ελέγχοντας τα υπόλοιπα RLS policies βρέθηκε ότι το
  `ai_messages` δεν έχει ΚΑΝΕΝΑ insert policy, για ΚΑΝΕΝΑ ρόλο, σε καμία
  κατάσταση -- άρα ακόμα και μια αμιγώς `staff_chat` συνομιλία (όπου το
  insert στο `ai_conversations` ΘΑ περνούσε) δεν μπορεί ποτέ να ολοκληρωθεί
  από τον client μόνο του, αφού δεν μπορεί να γραφτεί ούτε ένα μήνυμα. Το
  `verify_phase10_ai_gateway.sql` (Test D) το αποδεικνύει ρητά. Άρα η μόνη
  συνεπής αρχιτεκτονική είναι αυτή που ούτως ή άλλως επέβαλλε το `ai_actions`
  (καμία insert policy καθόλου): κάθε γραφή σε `ai_conversations`/
  `ai_messages`/`ai_actions`, για ΚΑΘΕ κανάλι, γίνεται από το service-role
  client του Edge Function. Το policy στο `ai_conversations_insert` έμεινε
  ως έχει (δεν κάνει κακό, ίσως χρησιμεύσει αργότερα) αλλά είναι ουσιαστικά
  αχρησιμοποίητο από αυτή την αρχιτεκτονική.
- **`AnthropicProvider` με απλό `fetch`, όχι το `@anthropic-ai/sdk`.** Το
  αρχείο αυτό εισάγεται απευθείας (relative import, όχι npm dependency) από
  το Deno Edge Function -- το `fetch` είναι το ένα πράγμα που σίγουρα
  υπάρχει αμετάβλητο και στο Deno και στο Node, ενώ ένα πραγματικό npm
  dependency θα ήταν αδύνατο να εγκατασταθεί ΚΑΙ να επαληθευτεί σε αυτό το
  sandbox (καμία πρόσβαση δικτύου στο npm registry ή στο api.anthropic.com).
- **`get_reservation_analytics` είναι SECURITY INVOKER, όχι SECURITY
  DEFINER**, σε αντίθεση με τα Edge Functions -- εδώ δεν υπάρχει το γνωστό
  "chicken-and-egg" πρόβλημα RLS (ο καλών ήδη μπορεί να δει τις δικές του
  κρατήσεις), οπότε δεν χρειάζεται bypass. Ο ρητός έλεγχος
  `is_restaurant_member()` πριν το aggregate query υπάρχει μόνο για να δώσει
  καθαρό `NOT_AUTHORIZED` αντί για ένα παραπλανητικό "μηδέν κρατήσεις" σε
  όποιον δεν είναι μέλος.
- **`updateRestaurantSettings` δέχεται ρητή allow-list πεδίων**
  (`RESTAURANT_SETTINGS_FIELDS` στο `ai-gateway/tools.ts`, ίδια λίστα με το
  `updateRestaurant()` του Phase 05) -- το AI δεν μπορεί ποτέ να γράψει σε
  στήλη έξω από αυτή τη λίστα, όσο κι αν το μοντέλο "αποφασίσει" να βάλει
  κάτι άλλο στο `patch`. Αυτό είναι το validation βήμα του pipeline να
  εφαρμόζεται κυριολεκτικά σε επίπεδο στήλης, όχι μόνο σε επίπεδο τιμής.
- **Scope αυτής της φάσης: μόνο `staff_chat`.** Τα κανάλια `customer_chat`/
  `voice`/`whatsapp` παραμένουν έτοιμα στο σχήμα αλλά χωρίς κανένα executor
  path ή UI -- ένα AI chat για πελάτες είναι ξεχωριστό προϊοντικό θέμα (rate
  limiting, ταυτότητα ανώνυμου guest, escalation σε άνθρωπο) και σκόπιμα δεν
  χτίστηκε εδώ.
- **Ακολουθήθηκε ξανά το pattern Edge Function + service role** από τις
  Φάσεις 04 (`bootstrap-restaurant`), 05-ish (`invite-staff-member`): κάθε
  φορά που ένα RLS policy structurally δεν αφήνει περιθώριο σε πλήρες
  client-side flow, η λύση είναι Edge Function με το δικό του explicit
  authorization check -- όχι εξασθένιση του RLS.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Καμία πραγματική κλήση σε ζωντανό Anthropic endpoint.** Δεν υπάρχει
  πρόσβαση δικτύου στο `api.anthropic.com` σε αυτό το sandbox, ούτε
  `ANTHROPIC_API_KEY`. Ο κώδικας του `AnthropicProvider` είναι πραγματικός
  και ελέγξιμος (ακολουθεί την τεκμηριωμένη μορφή του Messages API), αλλά
  ΔΕΝ έχει τρέξει ποτέ πραγματικά.
- **Φωνή (STT/TTS).** Ρητά "architecture-ready, όχι χτισμένη" -- το
  `VoiceNotImplementedError` πετάγεται αν κάποιος καλέσει `transcribe()`/
  `speak()`. Ένας phone AI receptionist έχει μηδενική ανοχή σε λάθος και η
  τεχνολογία φωνής δεν θεωρείται ακόμα αρκετά αξιόπιστη για μη αναστρέψιμες
  ενέργειες -- ακριβώς η λογική του blueprint.
- **UI για ιστορικό συνομιλιών (λίστα προηγούμενων chats).**
  `fetchMyAiConversations()` υπάρχει στο `packages/core` αλλά καμία οθόνη
  δεν το καλεί ακόμα -- η τρέχουσα οθόνη κρατά μία συνομιλία τη φορά.
- **Deployment του Edge Function σε πραγματικό Supabase project.** Ίδιος
  περιορισμός με κάθε προηγούμενο Edge Function αυτού του project.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase10_ai_gateway.sql` σε ολόκληρη ΚΑΙΝΟΥΡΙΑ τοπική
  PostgreSQL 16 (rebuild από την 0001 μέχρι την 0017 + seed): το
  `get_reservation_analytics()` δίνει σωστά aggregates σε μέλος του
  εστιατορίου και ρητό `NOT_AUTHORIZED` σε μη-μέλος αντί για παραπλανητικό
  μηδέν (A), απορρίπτει άκυρο date range (B), το `ai_conversations_insert`
  επιτρέπει `staff_chat` με το δικό σου `user_id` αλλά απορρίπτει
  `customer_chat` με null `user_id` (C), το `ai_messages` δεν έχει ΚΑΝΕΝΑ
  insert policy ακόμα και για τη δική σου συνομιλία (D), το `ai_actions`
  δεν έχει κανένα insert policy καθόλου (E), το πλήρες κύκλωμα proposed →
  executed με `confirmed_by_user_id`/`confirmed_at`/`executed_at`/`result`
  όλα σωστά συμπληρωμένα (F), ο constraint `ai_conversations_one_party`
  παραμένει ενεργός (G), και η ορατότητα RLS -- συνάδελφος στο ίδιο
  εστιατόριο βλέπει τη συνομιλία, προσωπικό άλλου εστιατορίου όχι (H).
- Επαληθεύτηκε ΚΑΙ ότι η 0017 δεν έσπασε τίποτα: τα
  `verify_phase07_reservation_engine.sql`, `verify_phase08_public_
  booking.sql` και `verify_phase09_notifications.sql` ξανατρέχτηκαν πάνω
  στην ΙΔΙΑ βάση μετά την 0017 και πέρασαν όπως πριν.
- Και τα 4 αρχεία γλώσσας έχουν ακριβώς τα ίδια 398 keys.
- 96 αρχεία `.ts`/`.tsx` (συμπεριλαμβανομένων του νέου `packages/ai` και του
  `supabase/functions/ai-gateway`) περνούν συντακτικό έλεγχο TypeScript
  χωρίς σφάλμα.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ο πραγματικός βρόχος chat/tool-calling του `ai-gateway` Edge Function --
  απαιτεί runtime Deno (δεν υπάρχει εδώ) ΚΑΙ πρόσβαση δικτύου σε ζωντανό
  Anthropic endpoint (δεν υπάρχει εδώ). Αυτό είναι το μεγαλύτερο άλυτο
  κομμάτι αυτής της φάσης, και δεν παρουσιάζεται πουθενά ως "λειτουργικό".
- Η νέα οθόνη `ai.tsx` δεν έτρεξε ποτέ πραγματικά -- μόνο συντακτικός
  έλεγχος TypeScript.
- Η συμπεριφορά μέσω πραγματικού PostgREST/`supabase-js` `.rpc()`/`.from()`
  για τα νέα RPCs/tables -- ίδιος περιορισμός με κάθε προηγούμενη φάση.

## Φάση 11: Ετοιμότητα Φωνής

Η Φάση 11, όπως ρητά την περιγράφει το blueprint, είναι σκόπιμα μικρή:
**"μόνο abstraction/interface — όχι πλήρης υλοποίηση"**. Δεν χτίστηκε
τηλεφωνικός AI receptionist. Χτίστηκε το κομμάτι υποδομής που κάνει δυνατό
να τον χτίσουμε αργότερα χωρίς να ξαναγράψουμε το reservation engine ή το
AI Gateway — μαζί με ένα "call-answering σκελετό" που θα μπορούσε ένα
πραγματικό τηλεφωνικό νούμερο να δείχνει σε αυτόν σήμερα, με απόλυτη
ασφάλεια, χωρίς να προσποιείται ότι κάνει κρατήσεις μέσω τηλεφώνου.

### Τι χτίστηκε

- **`supabase/migrations/0018_voice_readiness.sql`**: δύο νέες στήλες και
  μία νέα συνάρτηση. `restaurants.ai_voice_phone_number` (μοναδικό όταν
  οριστεί, ξεχωριστό από το ήδη υπάρχον `phone` — αυτό είναι το δημόσιο
  τηλέφωνο του εστιατορίου, το άλλο θα ήταν η αποκλειστική γραμμή ενός
  μελλοντικού AI receptionist). `ai_conversations.caller_phone` — ώστε μια
  κλήση από άγνωστο αριθμό να έχει ΚΑΙ ΠΑΛΙ ίχνος στο audit trail, ακριβώς
  όπως τα `guest_*` πεδία των κρατήσεων στη Φάση 08 κάλυπταν τον πρώτης
  φοράς επισκέπτη χωρίς λογαριασμό. `find_customer_by_phone()` — SECURITY
  DEFINER (μια τηλεφωνική κλήση δεν έχει καθόλου ταυτότητα RLS να
  ελεγχθεί), αλλά με ρητό `revoke` από `anon`/`authenticated`.
- **`packages/ai/src/voice.ts`**: καθαρές, χωρίς δίκτυο συναρτήσεις --
  `buildSayOnlyTwiml()`/`buildGatherSpeechTwiml()` (παράγουν το XML που θα
  απαντούσε ένα Twilio Voice webhook), `parseTwilioSpeechWebhook()`
  (ερμηνεύει τα πεδία που στέλνει το Twilio), και `verifyTwilioSignature()`
  (ο δημόσια τεκμηριωμένος αλγόριθμος υπογραφής του Twilio, HMAC-SHA1).
- **`supabase/functions/voice-webhook`**: το Edge Function-σκελετός. Ελέγχει
  την υπογραφή Twilio, βρίσκει ποιο εστιατόριο αντιστοιχεί στον
  κληθέντα αριθμό, προσπαθεί να αναγνωρίσει τον καλούντα από το τηλέφωνό
  του, καταγράφει μια πλήρη `ai_conversations`/`ai_messages` γραμμή, και
  απαντά με ένα σύντομο, ειλικρινές μήνυμα ("η τηλεφωνική κράτηση δεν είναι
  ακόμα διαθέσιμη") στη γλώσσα του εστιατορίου -- ΔΕΝ προσπαθεί καμία
  συνομιλία AI.
- **`scripts/verify_phase11_voice_readiness.mjs`** (νέο είδος verification
  script για αυτό το project): τρέχει πραγματικά, όχι μόνο συντακτικά, το
  `packages/ai/src/voice.ts` -- transpile με το ήδη υπάρχον TypeScript
  compiler και δυναμικό `import()`, όχι αντιγραφή της λογικής σε ξεχωριστό
  test αρχείο. 17 ελέγχοι, όλοι πέρασαν.
- **`scripts/verify_phase11_voice_readiness.sql`**: επαληθεύει το νέο SQL
  κομμάτι σε πραγματική βάση.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Μια τηλεφωνική κλήση δεν έχει καμία ταυτότητα που το RLS να μπορεί να
  ελέγξει.** Το `staff_chat` έχει authenticated JWT. Το δημόσιο booking site
  της Φάσης 08 έχει τουλάχιστον web session/explicit φόρμα. Μια εισερχόμενη
  κλήση έχει μόνο τον αριθμό του καλούντα -- ένα trivially spoofable
  "διαπιστευτήριο". Άρα, ακριβώς όπως το `book_public_reservation` (Φάση 08)
  και το `ai-gateway` (Φάση 10), οποιαδήποτε πραγματική ενσωμάτωση φωνής
  ΠΡΕΠΕΙ να τρέχει ως Edge Function με service role και δικό της explicit
  authorization -- δεν υπάρχει σχήμα RLS policy που να μπορεί να το κάνει
  ασφαλές.
- **`find_customer_by_phone()` ρητά ΔΕΝ έχει grant σε κανέναν client
  ρόλο.** Σε αντίθεση με τα `is_restaurant_member()`/`owns_customer()` της
  Φάσης 02 (επιστρέφουν μόνο boolean, ασφαλή να τα πυροδοτεί έμμεσα
  οποιοσδήποτε client μέσω RLS policy), αυτή η συνάρτηση επιστρέφει
  `customer_id` με βάση έναν αυθαίρετο αριθμό τηλεφώνου -- αν ήταν
  προσβάσιμη απευθείας, θα επέτρεπε σε οποιονδήποτε συνδεδεμένο χρήστη να
  "δοκιμάσει" αριθμούς τηλεφώνου έναν-έναν και να μάθει ποιοι είναι πελάτες
  ενός εστιατορίου. Το `scripts/verify_phase11_voice_readiness.sql` (Test C)
  το αποδεικνύει ρητά, όχι απλώς διαβάζοντας τον κώδικα.
- **Το `voice-webhook` απαντά ΠΑΝΤΑ με ειλικρινές "δεν είναι ακόμα
  διαθέσιμο", ποτέ δεν προσπαθεί κράτηση μέσω AI.** Αυτό είναι επίτηδες, όχι
  τεχνικός περιορισμός: ένας καλών που μιλάει σε AI έχει μηδενική ανοχή σε
  λάθος (βλ. blueprint, Μέρος 05) -- δεν υπάρχει "κάρτα επιβεβαίωσης" σε μια
  τηλεφωνική γραμμή όπως υπάρχει στο `ai.tsx`. Η δυνατότητα ΝΑ δείξει κάποιος
  ένα νούμερο σε αυτό το endpoint σήμερα υπάρχει (ασφαλής, ελεγμένη
  υπογραφή, σωστό tenant routing), αλλά ο πραγματικός βρόχος συνομιλίας
  είναι σκόπιμα ξεχωριστή, μεταγενέστερη απόφαση.
- **Δεν προστέθηκε στήλη `call_sid`.** Το `voice-webhook` δεν συσχετίζει
  πολλαπλούς γύρους της ΙΔΙΑΣ κλήσης σε μία συνομιλία -- επειδή σήμερα
  υπάρχει μόνο ένας γύρος (ένα μήνυμα, τέλος). Μια μελλοντική φάση που θα
  προσθέσει πραγματικό `<Gather>` πολλαπλών γύρων θα χρειαστεί αυτή τη
  συσχέτιση -- προστέθηκε το σχόλιο, όχι η στήλη, γιατί δεν χρησιμεύει σε
  τίποτα ακόμα.
- **STT/TTS για WhatsApp voice notes είναι διαφορετικό πρόβλημα από
  STT/TTS για Twilio Voice, και δεν μπερδεύτηκαν.** Το Twilio Voice δίνει
  ήδη κείμενο δωρεάν μέσω `<Gather input="speech">` (το ίδιο το Twilio κάνει
  το STT) και μιλάει μέσω `<Say>` (το ίδιο το Twilio κάνει το TTS) -- δεν
  χρειάζεται δικός μας provider για τηλεφωνικές κλήσεις. Το
  `AIProvider.transcribe()`/`speak()` που χτίστηκε στη Φάση 10 (ρίχνει
  `VoiceNotImplementedError`) παραμένει το σωστό σημείο επέκτασης για ΑΛΛΑ
  κανάλια που δίνουν raw audio (π.χ. φωνητικά μηνύματα WhatsApp) -- δεν
  χτίστηκε εδώ γιατί δεν υπάρχει ακόμα κανένα τέτοιο κανάλι σε λειτουργία.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Κανένας πραγματικός τηλεφωνικός AI receptionist.** Ρητά το ζητούμενο
  αυτής της φάσης, όχι παράλειψη.
- **Κανένα πραγματικό Twilio account, αριθμός τηλεφώνου, ή webhook
  configuration.** Δεν υπάρχει δίκτυο σε αυτό το sandbox προς το Twilio.
- **Καμία συσχέτιση πολλαπλών γύρων μιας κλήσης** (βλ. παραπάνω, `call_sid`).
- **Κανένας δικός μας STT/TTS provider** -- ούτε χρειάζεται ακόμα, βλ.
  παραπάνω.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase11_voice_readiness.mjs`: 17 έλεγχοι που εκτελούν
  ΠΡΑΓΜΑΤΙΚΑ (όχι μόνο συντακτικά) το `packages/ai/src/voice.ts` --
  σωστό XML/escaping στο TwiML, σωστό parsing του Twilio webhook (και ρητό
  error σε λείπον πεδίο), και η επαλήθευση υπογραφής Twilio
  cross-checked ενάντια σε ανεξάρτητη υλοποίηση HMAC-SHA1 του ίδιου του
  Node.js (`crypto.createHmac`) -- αποδέχεται τη σωστή υπογραφή, απορρίπτει
  λάθος token, πειραγμένα δεδομένα, και απόν header.
- `scripts/verify_phase11_voice_readiness.sql` σε ολόκληρη ΚΑΙΝΟΥΡΙΑ τοπική
  PostgreSQL 16 (rebuild από την 0001 μέχρι την 0018 + seed): μοναδικότητα
  του `ai_voice_phone_number` (A), το `find_customer_by_phone()` λύνει
  σωστά εντός ενοικιαστή, δίνει null σε άγνωστο αριθμό, και δίνει null όταν
  ο πελάτης υπάρχει αλλά σε ΑΛΛΟ εστιατόριο -- καμία διαρροή μεταξύ
  ενοικιαστών (B), το `find_customer_by_phone()` όντως απορρίπτεται και για
  `authenticated` και για `anon` (C), και το `caller_phone` αποθηκεύεται
  ανεξάρτητα από `customer_id` (D).
- Επαληθεύτηκε ΚΑΙ ότι η 0018 δεν έσπασε τίποτα: τα `verify_phase07_
  reservation_engine.sql`, `verify_phase08_public_booking.sql`, `verify_
  phase09_notifications.sql` και `verify_phase10_ai_gateway.sql`
  ξανατρέχτηκαν πάνω στην ΙΔΙΑ βάση μετά την 0018 και πέρασαν όπως πριν.
- 98 αρχεία `.ts`/`.tsx` (συμπεριλαμβανομένου του νέου `voice.ts` και του
  `supabase/functions/voice-webhook`) περνούν συντακτικό έλεγχο TypeScript
  χωρίς σφάλμα.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ότι το `verifyTwilioSignature()` παράγει την ΙΔΙΑ υπογραφή που θα
  παρήγαγαν οι πραγματικοί servers του Twilio για μια πραγματική κλήση --
  ελέγχθηκε μόνο εσωτερική συνέπεια/ανεξάρτητη διασταύρωση αλγορίθμου, όχι
  σε πραγματικό Twilio request. Βλ. το header comment του
  `packages/ai/src/voice.ts` για την ακριβή διατύπωση αυτού του ορίου.
- Deployment του `voice-webhook` σε πραγματικό Supabase project, ή
  οποιαδήποτε πραγματική κλήση Twilio -- κανένα δίκτυο, κανένας λογαριασμός.

## Φάση 12: Πληρωμές & Συνδρομές Πλατφόρμας

Η Φάση 12 χτίζει το χρηματικό επίπεδο του ReservX: προκαταβολές/deposits
για κρατήσεις πελατών (προστασία από no-show, blueprint Μέρος 05), και τη
δική της συνδρομή της πλατφόρμας (4 πλάνα, blueprint Μέρος 11). Ο
πάροχος είναι το Stripe, μέσω PaymentIntents με **manual capture**
("authorize now, capture later") -- ακριβώς όπως το περιγράφει το
blueprint: η κάρτα του πελάτη κρατείται δεσμευμένη, χρεώνεται ΜΟΝΟ αν
χρειαστεί (no-show), ποτέ αυτόματα. Καμία στιγμή δεν αποθηκεύεται αριθμός
κάρτας πουθενά σε αυτό το σύστημα -- μόνο reference ids του Stripe.

### Τι χτίστηκε

- **`supabase/migrations/0019_payments_and_billing.sql`**: διορθώνει πέντε
  πραγματικά κενά που βρέθηκαν στο αρχικό σχήμα της Φάσης 02 (0007) μόλις
  δοκιμάστηκε να κληθεί από πραγματικό Edge Function -- δες το δικό του
  header comment για την πλήρη λίστα. Συνοπτικά: νέα τιμή enum
  `requires_capture` (η κατάσταση "εγκρίθηκε στην κάρτα, δεν έχει
  χρεωθεί ακόμα"), `payments.deposit_policy_id` +
  `cancellation_window_hours_snapshot` (ΠΑΓΩΜΕΝΟ αντίγραφο του παραθύρου
  ακύρωσης τη στιγμή που δημιουργήθηκε η πληρωμή -- μια μεταγενέστερη
  αλλαγή της πολιτικής δεν ξαναγράφει αναδρομικά τους όρους που είχε δει ο
  πελάτης), `deposit_policies.percentage_base_amount_cents` (αφού αυτό το
  προϊόν δεν έχει καθόλου έννοια μενού/λογαριασμού, ένα ποσοστιαίο deposit
  χρειάζεται μια ρητή, οριζόμενη-από-το-εστιατόριο εκτιμώμενη δαπάνη ανά
  άτομο για να έχει νόημα), `subscription_plans.provider_price_id` (Stripe
  Price reference), και νέο δημόσιο RLS policy πάνω στο `deposit_policies`
  (ένας επισκέπτης πρέπει να βλέπει τους όρους προκαταβολής/ακύρωσης ΠΡΙΝ
  κλείσει κράτηση). Επίσης σπέρνει τα 4 πλάνα συνδρομής (Starter/
  Professional/Business/Enterprise) από τον πίνακα τιμολόγησης του
  blueprint (Μέρος 11) ως πραγματικά reference data, όχι demo δεδομένα.
- **`compute_deposit_amount()`** (SECURITY INVOKER, `anon` + `authenticated`):
  ποια πολιτική προκαταβολής (αν υπάρχει) ισχύει για μια υποψήφια κράτηση
  και πόσο κοστίζει, με σειρά προτεραιότητας `event > vip >
  party_size_threshold > all` όταν παραπάνω από μία θα μπορούσαν να
  ισχύουν ταυτόχρονα. Granted και σε `anon` -- το δημόσιο booking site
  πρέπει να δείξει "αυτή η κράτηση χρειάζεται προκαταβολή €X" ΠΡΙΝ ο
  επισκέπτης δεσμευτεί.
- **`evaluate_reservation_cancellation_refund()`** (SECURITY INVOKER,
  μόνο `authenticated`): αν η ακύρωση μιας κράτησης ΤΩΡΑ θα ήταν εντός ή
  εκτός του παραθύρου δωρεάν ακύρωσης, χρησιμοποιώντας το ΠΑΓΩΜΕΝΟ
  snapshot πάνω στην ίδια την πληρωμή -- ποτέ την τρέχουσα τιμή της
  πολιτικής. Το `scripts/verify_phase12_payments_billing.sql` (Test B) το
  αποδεικνύει ρητά, αλλάζοντας την πολιτική ΜΕΤΑ τη δημιουργία της
  πληρωμής και επιβεβαιώνοντας ότι η απάντηση δεν άλλαξε.
- **`packages/payments/`** (νέο package): `stripeClient.ts` -- κλήσεις στο
  Stripe REST API με απλό `fetch` (όχι το επίσημο SDK, ίδια λογική με το
  `packages/ai`'s AnthropicProvider) για PaymentIntent create/capture/
  cancel/refund και Checkout Session create. `stripeSignature.ts` --
  καθαρή, χωρίς δίκτυο επαλήθευση της υπογραφής webhook του Stripe
  (HMAC-SHA256, hex, timing-safe σύγκριση, ανοχή χρονικής σφραγίδας για
  προστασία από replay).
- **Πέντε νέα Edge Functions**: `create-deposit-payment-intent` (φτιάχνει
  το PaymentIntent -- εξυπηρετεί ΚΑΙ συνδεδεμένους χρήστες ΚΑΙ πλήρως
  ανώνυμους επισκέπτες μέσω νέου `tryGetAuthenticatedUser()` helper, αφού
  μια κράτηση επισκέπτη δεν έχει τρόπο να αυθεντικοποιηθεί αργότερα -- η
  προκαταβολή ΠΡΕΠΕΙ να συλλεχθεί στο ίδιο round-trip με την κράτηση),
  `capture-noshow-deposit` (χρεώνει μια ήδη-δεσμευμένη προκαταβολή ως
  τέλος no-show -- ΠΑΝΤΑ ρητή ενέργεια προσωπικού, ΠΟΤΕ αυτόματη),
  `refund-deposit` (μετά από ακύρωση: επιστροφή ή χρέωση τέλους ακύρωσης
  ανάλογα με το `evaluate_reservation_cancellation_refund`),
  `create-subscription-checkout` (owner-only, Stripe-hosted Checkout για
  να ξεκινήσει μια πληρωμένη συνδρομή), και `stripe-webhook` (το ΜΟΝΟ
  σημείο που το Stripe μιλάει πίσω σε εμάς -- κρατά `payments`/
  `subscriptions` συγχρονισμένα με ό,τι πραγματικά συνέβη στο Stripe).
- **`bootstrap-restaurant`** (τροποποίηση): μετά την επιτυχή δημιουργία
  του πρώτου εστιατορίου ενός owner, ξεκινά αυτόματα τη 14ήμερη δωρεάν
  δοκιμή (πλάνο Starter, χωρίς κάρτα -- ακριβώς όπως το λέει η σελίδα
  τιμολόγησης του blueprint) -- best-effort, ποτέ δεν ακυρώνει μια
  επιτυχημένη εγγραφή αν αυτό το βήμα αποτύχει.
- **`packages/core/src/api/payments.ts`**: CRUD για `deposit_policies`
  (απευθείας μέσω RLS -- ήδη επέτρεπε owner/manager writes από τη Φάση
  02), read-only wrapper για το `compute_deposit_amount`, RLS reads για
  `payments`/`subscription_plans`/`subscriptions`, και
  `invokeFunction()`-based wrappers για τα τέσσερα Edge Functions που
  κινούν πραγματικά χρήματα.
- **Mobile UI**: νέα οθόνη `settings/deposit-policies.tsx` (owner/manager
  CRUD πολιτικών προκαταβολής, ίδιο μοτίβο με το `reminder-rules.tsx` της
  Φάσης 09) και ενσωμάτωση στην οθόνη λεπτομερειών κράτησης
  (`reservations/[reservationId].tsx`): κάρτα "Πληρωμές" που δείχνει τις
  πληρωμές της κράτησης, με κουμπί "χρέωση προκαταβολής no-show" (μόνο
  όταν η κράτηση είναι ήδη `no_show`) και κουμπί "διευθέτηση προκαταβολής"
  (μόνο όταν είναι ήδη `cancelled`) -- και τα δύο πίσω από ρητό διάλογο
  επιβεβαίωσης, ποτέ αυτόματα.
- **Web UI**: το δημόσιο booking form (`BookingForm.tsx`) τώρα δείχνει ένα
  "χρειάζεται προκαταβολή €X" πριν την υποβολή (μέσω `quoteDepositAmount`),
  και μετά από επιτυχή κράτηση εμφανίζει ένα πραγματικό βήμα πληρωμής
  Stripe Elements (`DepositPaymentStep.tsx`, με `@stripe/react-stripe-js`)
  -- ο επισκέπτης μπορεί να πληρώσει αμέσως ή να το αφήσει για αργότερα.
- **`scripts/verify_phase12_payments_billing.sql`** και **`.mjs`**: δες
  παρακάτω.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **`tryGetAuthenticatedUser()` -- ένα Edge Function που εξυπηρετεί ΚΑΙ
  συνδεδεμένους ΚΑΙ ανώνυμους χρήστες στο ίδιο endpoint.** Νέο μοτίβο για
  αυτό το project. Το `create-deposit-payment-intent` επιστρέφει `null`
  αντί να πετάξει σφάλμα όταν δεν υπάρχει authenticated session, και μετά
  εφαρμόζει ρητό, στενό κανόνα εξουσιοδότησης: ένας ανώνυμος καλών
  επιτρέπεται ΜΟΝΟ αν η κράτηση δεν έχει καθόλου `customer_id` (δηλαδή
  ήταν πράγματι μια κράτηση επισκέπτη).
- **Manual capture παντού, ποτέ αυτόματη χρέωση.** Το PaymentIntent
  δημιουργείται με `capture_method: 'manual'` -- η κάρτα εγκρίνεται
  (`requires_capture`) αλλά δεν χρεώνεται μέχρι ένα ρητό, ξεχωριστό βήμα
  προσωπικού (`capture-noshow-deposit`) ή αυτόματη λογική ακύρωσης
  (`refund-deposit`, βασισμένη στην ίδια την πολιτική, όχι σε ανθρώπινη
  υποκειμενική κρίση). Αυτό επεκτείνει την ίδια αρχή "καμία καταστροφική
  ενέργεια χωρίς ρητή επιβεβαίωση" που ίσχυε ήδη για το AI (Φάση 10) και
  στο UX του προσωπικού.
- **Το snapshot του παραθύρου ακύρωσης πάνω στην ΠΛΗΡΩΜΗ, όχι στην
  πολιτική.** Χωρίς αυτό, μια μεταγενέστερη αλλαγή πολιτικής θα άλλαζε
  αναδρομικά τους όρους που είχε ήδη αποδεχτεί ένας πελάτης όταν πλήρωσε.
  Ίδια λογική με το `buffer_minutes` των κρατήσεων.
- **Ποσοστιαίο deposit χρειάζεται μια ρητή βάση, αφού δεν υπάρχει
  μενού/λογαριασμός σε αυτό το σχήμα.** Το `percentage_base_amount_cents`
  είναι μια εκτιμώμενη δαπάνη ανά άτομο που ορίζει το ίδιο το εστιατόριο --
  ρητό, ελεγχόμενο από αυτό, όχι ένα άπιαστο "ποσοστό του τίποτα".
- **Ένα, μη τεκμηριωμένο κενό ασφαλείας βρέθηκε ΚΑΙ διορθώθηκε κατά τη
  γραφή του verification script, όχι απλώς κατά τη σχεδίαση.** Το
  `evaluate_reservation_cancellation_refund()` είχε `grant execute ... to
  authenticated` αλλά ΚΑΝΕΝΑ ρητό `revoke ... from public` -- και η
  PostgreSQL δίνει αυτόματα EXECUTE σε `PUBLIC` σε κάθε νέα συνάρτηση, οπότε
  το grant ήταν στην πράξη άχρηστο: ο ρόλος `anon` θα μπορούσε ήδη να την
  καλέσει (χωρίς όμως να δει πραγματικά δεδομένα -- το RLS στο
  `payments`/`reservations` γυρνούσε ούτως ή άλλως μηδέν γραμμές, αφού
  `owns_customer()`/`is_restaurant_member()` χρειάζονται `auth.uid()`). Το
  Test D4 του `verify_phase12_payments_billing.sql` το έπιασε ζωντανά --
  περίμενε `ERROR: permission denied` και πήρε `0 rows` αντί για σφάλμα.
  Διορθώθηκε με ρητό `revoke all ... from public` πριν το grant, ίδιο
  μοτίβο με το `find_customer_by_phone()` της Φάσης 11. Δεν υπήρξε ποτέ
  πραγματική διαρροή δεδομένων (το RLS backstop δούλευε σωστά), αλλά το
  σχόλιο του κώδικα ("least privilege") έλεγε κάτι που δεν ίσχυε στην
  πράξη -- άξιζε διόρθωση. Η ίδια γενική παρατήρηση ισχύει πιθανώς και για
  μερικές παλαιότερες SECURITY INVOKER συναρτήσεις (`get_restaurant_staff`
  κ.ά., Φάσεις 05/07/10) που επίσης βασίζονται μόνο στο RLS backstop χωρίς
  ρητό revoke -- καμία από αυτές δεν αποδείχτηκε εκμεταλλεύσιμη, αλλά μια
  αφιερωμένη διαδρομή σκλήρυνσης (hardening pass) σε όλες τις SQL
  συναρτήσεις θα ήταν μια λογική μελλοντική εργασία, όχι επείγουσα.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Κανένας πραγματικός λογαριασμός Stripe, κλειδιά δοκιμής, ή δίκτυο προς
  το Stripe.** Όλος ο κώδικας ενσωμάτωσης (StripeClient, τα 5 Edge
  Functions, το Stripe Elements UI) είναι πραγματικός, αλλά ΔΕΝ δοκιμάστηκε
  ποτέ ενάντια σε πραγματικό Stripe API -- δεν υπάρχει δίκτυο προς το
  Stripe σε αυτό το sandbox.
- **Κανένας πίνακας `invoices`.** Σκόπιμη απόφαση εμβέλειας MVP -- το ίδιο
  το Stripe Billing Portal/invoicing καλύπτει αυτή την ανάγκη χωρίς να
  χρειάζεται να ξαναχτιστεί εδώ.
- **Καμία διαχειριστική οθόνη χρέωσης (admin billing UI).** Ρητά δουλειά
  της Φάσης 13 ("Admin πλατφόρμας"), όχι παράλειψη αυτής της φάσης.
  `create-subscription-checkout` υπάρχει ήδη ως το backend της, απλά δεν
  υπάρχει ακόμα οθόνη να το καλέσει εκτός testing.
- **Κανένα multi-currency.** Το `restaurants` δεν έχει καθόλου στήλη
  νομίσματος -- η υπόθεση EUR-only είναι ρητή σε όλο τον κώδικα αυτής της
  φάσης (`payments.currency` έχει default `'EUR'`), όχι κρυφή παράλειψη.
- **Καμία αυτόματη ακύρωση απλήρωτης κράτησης.** Αν ένας επισκέπτης πατήσει
  "θα πληρώσω αργότερα" στο βήμα προκαταβολής, η κράτηση παραμένει ενεργή
  -- δεν υπάρχει ακόμα αυτόματος μηχανισμός που να την ακυρώνει αν η
  προκαταβολή δεν έρθει μέχρι μια προθεσμία. Το προσωπικό βλέπει την
  κατάσταση `requires_action`/`requires_capture` στην κάρτα "Πληρωμές" και
  αποφασίζει χειροκίνητα.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase12_payments_billing.sql`, σε ολόκληρη ΚΑΙΝΟΥΡΙΑ
  τοπική PostgreSQL 16 (πλήρες rebuild από την 0001 μέχρι την 0019 +
  seed): `compute_deposit_amount` σε 7 σενάρια (fixed/per_person/
  percentage, πλήρης σειρά προτεραιότητας event>vip>party_size_threshold>
  all, ανενεργή πολιτική, καμία πολιτική), `evaluate_reservation_
  cancellation_refund` σε 3 σενάρια (εκτός παραθύρου, εντός παραθύρου,
  φιλτράρισμα σε deposit-only/capturable-or-succeeded-only -- με ρητή
  απόδειξη ότι χρησιμοποιεί το ΠΑΓΩΜΕΝΟ snapshot και όχι την επεξεργασμένη
  πολιτική), write-block του `payments`/`subscriptions`/
  `subscription_plans` για τον ρόλο `authenticated` απευθείας (3
  σενάρια), το `deposit_policies_public_select` επιτρέπει ανάγνωση ΜΟΝΟ
  ενεργών πολιτικών στον `anon` ενώ παραμένει read-only, και το
  `uidx_subscriptions_active_per_org` (μόνο μία μη-τερματική συνδρομή ανά
  οργανισμό -- ακριβώς η παραδοχή που χρειάζεται το trial-to-paid μονοπάτι
  του `stripe-webhook`). Βρήκε ΚΑΙ διόρθωσε ένα πραγματικό κενό στο grant
  (δες παραπάνω).
- `scripts/verify_phase12_payments_billing.mjs`: 10 έλεγχοι που εκτελούν
  ΠΡΑΓΜΑΤΙΚΑ (όχι μόνο συντακτικά) το `packages/payments/src/
  stripeSignature.ts` -- αποδέχεται υπογραφή cross-checked ενάντια σε
  ανεξάρτητη υλοποίηση HMAC-SHA256 του ίδιου του Node.js
  (`crypto.createHmac`), απορρίπτει πειραγμένο σώμα, λάθος secret,
  παλιά χρονική σφραγίδα (replay protection), απόν/κατεστραμμένο header,
  και δέχεται σωστά περισσότερες από μία υπογραφές `v1` (secret rotation).
- Επαληθεύτηκε ΚΑΙ ότι η 0019 δεν έσπασε τίποτα: όλα τα προηγούμενα
  `verify_phaseNN_*.sql` (04 έως 11) ξανατρέχτηκαν πάνω στην ΙΔΙΑ βάση
  μετά την 0019 και πέρασαν όπως πριν.
- 110 αρχεία `.ts`/`.tsx` (συμπεριλαμβανομένου του νέου `packages/
  payments`, των 5 νέων Edge Functions, και του νέου web/mobile UI)
  περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα.
- Και οι 4 γλώσσες (de/en/el/tr) έχουν πανομοιότυπο σύνολο i18n keys μετά
  την προσθήκη των `payments.*` και `public.booking.deposit.*` ενοτήτων
  (`packages/i18n/scripts/check-locale-parity.mjs`).

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ότι οποιοδήποτε από τα 5 Edge Functions ή το Stripe Elements UI
  δουλεύει πράγματι ενάντια σε πραγματικό Stripe API -- κανένα δίκτυο,
  κανένας λογαριασμός δοκιμής σε αυτό το sandbox. Ο κώδικας είναι
  πραγματικός (πραγματικό Stripe REST API σχήμα, πραγματικές βιβλιοθήκες
  `@stripe/stripe-js`/`@stripe/react-stripe-js`), αλλά ποτέ δεν εκτελέστηκε
  end-to-end.
- Ότι το `stripe-webhook` χειρίζεται σωστά ΚΑΘΕ πραγματικό event type
  και edge case που θα έστελνε το πραγματικό Stripe -- δοκιμάστηκε μόνο η
  υπογραφή (πραγματικά, βλ. πάνω) και η δική του λογική state-transition
  ενάντια σε χειροποίητα, συντακτικά έγκυρα αντικείμενα event.
- `@stripe/stripe-js`/`@stripe/react-stripe-js` δεν έχουν πράγματι
  εγκατασταθεί (`npm install`) σε αυτό το sandbox -- προστέθηκαν στο
  `apps/web/package.json`, ο κώδικας που τα χρησιμοποιεί περνάει
  συντακτικό έλεγχο, αλλά δεν επαληθεύτηκε build/typecheck με τα
  πραγματικά πακέτα εγκατεστημένα.

## Φάση 13: Admin Πλατφόρμας

Η Φάση 13 χτίζει το εσωτερικό εργαλείο διαχείρισης του ίδιου του ReservX
(όχι του εστιατορίου) -- μια νέα, ξεχωριστή ομάδα "platform admin" που
βλέπει ΟΛΟΥΣ τους organizations/restaurants της πλατφόρμας, μπορεί να
αναστείλει ένα εστιατόριο, να ορίσει χειροκίνητα τη συνδρομή ενός
organization, και να διαχειριστεί feature flags -- ξεχωριστό ρόλο τόσο από
το προσωπικό εστιατορίου (Φάση 04) όσο και από τον πελάτη (Φάση 08). Το
blueprint έδινε μόνο μία γραμμή περιγραφής ("Διαχείριση εστιατορίων,
συνδρομών, feature flags") -- όλη η αρχιτεκτονική απόφαση παρακάτω ήταν
δική μου, με πλήρη εξουσιοδότηση σχεδίασης.

### Τι χτίστηκε

- **`supabase/migrations/0020_platform_admin.sql`**: νέος πίνακας
  `platform_admins` (user_id, `platform_admin_role` enum
  `super_admin`/`support`, `is_active`, `granted_by`) -- **καμία δυνατότητα
  self-service εγγραφής**, μόνο SELECT RLS policy, καμία write policy
  καθόλου (κάθε write περνάει από SECURITY DEFINER function). Δύο νέες
  στήλες στο `restaurants`: `suspended_by_platform_at`/`suspension_reason`,
  σκόπιμα ΞΕΧΩΡΙΣΤΕΣ από το ήδη υπάρχον `is_active` (το δικό του "pause"
  toggle του owner) -- ένα ανασταλμένο από την πλατφόρμα εστιατόριο δεν
  πρέπει να μπορεί να αυτο-επανενεργοποιηθεί από τον ίδιο του τον owner.
  Ξαναχτίστηκαν τα public RLS policies (`restaurants_public_select` κ.ά.)
  και οι `is_restaurant_open_at()`/`book_public_reservation()` ώστε ένα
  ανασταλμένο εστιατόριο να εξαφανίζεται εντελώς από το δημόσιο directory
  και να μη δέχεται νέες κρατήσεις. Τα `feature_flags`/
  `feature_flag_overrides` (dormant από τη Φάση 02, migration 0010, με
  read-only RLS από τότε) αποκτούν επιτέλους write policies εδώ
  (`is_platform_admin()`-gated) -- το ίδιο μοτίβο "dormant πίνακας από τη
  Φάση 02 ενεργοποιείται σε μεταγενέστερη φάση" όπως το `notifications`
  (Φάση 09) και το `ai_conversations` (Φάση 10).
- **SQL functions (όλες SECURITY DEFINER, καμία νέα Edge Function -- δες
  παρακάτω γιατί)**: `is_platform_admin()`/`is_platform_super_admin()`,
  `admin_suspend_restaurant()`/`admin_unsuspend_restaurant()` (με
  υποχρεωτικό λόγο αναστολής, audit log), `admin_set_subscription()`
  (χειροκίνητη υπερίσχυση συνδρομής, χωρίς Stripe -- ρετιράρει την
  προηγούμενη μη-τερματική συνδρομή πρώτα, ίδια σειρά με το
  `stripe-webhook` της Φάσης 12), `admin_grant_platform_admin()`/
  `admin_revoke_platform_admin()` (μόνο `super_admin`, με guard που
  αρνείται να ανακαλέσει τον ΤΕΛΕΥΤΑΙΟ ενεργό super_admin -- προστασία από
  μη αναστρέψιμο κλείδωμα της πλατφόρμας), και τέσσερις `admin_list_*`
  read functions (organizations/restaurants/subscription history/platform
  admins), όλες με ρητό `raise exception 'NOT_AUTHORIZED'` αντί για σιωπηλό
  φιλτράρισμα -- ίδιο μοτίβο με το `get_reservation_analytics` της Φάσης
  10. Κάθε συνάρτηση έχει ρητό `revoke all ... from public` πριν το
  `grant ... to authenticated` (μάθημα από ένα πραγματικό κενό που βρέθηκε
  στη Φάση 12, εφαρμοσμένο εδώ συστηματικά σε ΚΑΘΕ νέα συνάρτηση).
- **`packages/core/src/api/admin.ts`** (νέο αρχείο): λεπτά, typed wrappers
  γύρω από όλες τις παραπάνω RPCs, plus απλό RLS CRUD για τα feature flags/
  overrides.
- **`apps/admin`** (νέα Next.js εφαρμογή, App Router, θύρα 3001): αυτόνομο
  εσωτερικό εργαλείο, ξεχωριστό από το `apps/web`. Client-side auth μόνο
  (browser session μέσω `@reservex/core`'s `createSupabaseClient`, ίδιο
  μοτίβο με το `apps/web`) -- κανένα service-role key πουθενά, κάθε
  προνομιούχα ενέργεια περνάει από μια SECURITY DEFINER function που
  ελέγχει η ίδια το `is_platform_admin()`. Ένα ενιαίο `AdminGate` component
  (`src/components/AdminGate.tsx`) τυλίγει όλη την εφαρμογή στο root layout
  με τρεις καταστάσεις: χωρίς session -> inline login/signup, με session
  αλλά όχι admin -> "Not authorized", admin -> nav bar (Organizations/
  Feature flags/Admins) + το περιεχόμενο. Σελίδες: `organizations/page.tsx`
  (λίστα με client-side αναζήτηση), `organizations/[id]/page.tsx`
  (εστιατόρια με suspend/unsuspend, φόρμα χειροκίνητης συνδρομής +
  ιστορικό), `feature-flags/page.tsx` (CRUD flags + overrides ανά
  organization/restaurant), `admins/page.tsx` (ρόστερ + grant/revoke,
  κρυμμένο για μη-super_admin). Οπτική ταυτότητα: ίδια CSS custom
  properties με το `apps/web`, με το `--accent` αλλαγμένο σε βιολετί
  (`#6A4CFF`/`#7C5CFF`, το ίδιο violet που χρησιμοποιεί το AI system στο
  υπόλοιπο προϊόν) αντί για το πορτοκαλί του booking flow -- σκόπιμο,
  μικρό οπτικό σήμα ώστε ένα screenshot από το admin να μην μπερδευτεί με
  το ίδιο το προϊόν.
- **`scripts/verify_phase13_platform_admin.sql`**: δες παρακάτω.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Καμία νέα Edge Function.** Κάθε ενέργεια αυτής της φάσης είναι μια
  καθαρή, προνομιούχα εγγραφή στην PostgreSQL χωρίς κανένα εξωτερικό
  network call (αντίθετα με τη Φάση 12, όπου το Stripe χρειαζόταν
  πραγματικό HTTP). Η αρχή "SECURITY DEFINER function αντί για Edge
  Function όποτε δεν χρειάζεται εξωτερικό δίκτυο" προϋπήρχε ήδη ρητά στο
  header comment του `book_public_reservation()` (Φάση 08, migration
  0014) -- η Φάση 13 απλά την εφάρμοσε συστηματικά, μηδέν νέα Edge
  Functions.
- **Πραγματικό, εμπειρικά επιβεβαιωμένο εύρημα PostgreSQL: το
  column-level `REVOKE` ΔΕΝ στενεύει ένα προϋπάρχον table-level `GRANT`.**
  Η πρώτη προσπάθεια προστασίας των στηλών `suspended_by_platform_at`/
  `suspension_reason` ήταν `revoke update (στήλη) ... from authenticated,
  anon`. Δοκιμάστηκε χειροκίνητα ενάντια στην τοπική βάση: ο ίδιος ο owner
  του εστιατορίου μπόρεσε ΝΑ ΓΡΑΨΕΙ απευθείας στη στήλη παρά το revoke
  (`UPDATE 1`, όχι σφάλμα) -- επειδή το `local_dev_shim.sql` (που
  αντικατοπτρίζει την πραγματική συμπεριφορά default privileges του
  Supabase) έχει ήδη ένα ευρύ table-level `GRANT UPDATE ON ALL TABLES`, και
  η PostgreSQL δεν το στενεύει με μεταγενέστερο column-level revoke. Η
  σωστή, ανθεκτική λύση ήταν ένα `BEFORE UPDATE` trigger
  (`protect_restaurant_suspension_columns()`) που ελέγχει `current_user`
  (το οποίο αντικατοπτρίζει τον OWNER της SECURITY DEFINER function κατά
  την προνομιούχα εκτέλεση, όχι τον συνδεδεμένο ρόλο) σε συνδυασμό με `IS
  DISTINCT FROM` ώστε να μπλοκάρει μόνο πραγματικές αλλαγές τιμής. Η
  εμπειρική δοκιμή ξανατρέχτηκε μετά τη διόρθωση και επιβεβαίωσε: το ίδιο
  UPDATE τώρα αποτυγχάνει σωστά με `PLATFORM_MANAGED_COLUMN`, ενώ ένα
  update σε άσχετη στήλη (`description`) στην ίδια γραμμή συνεχίζει να
  δουλεύει κανονικά. Τεκμηριωμένο εκτενώς μέσα στο ίδιο το migration.
- **Μινιμαλιστικό μοντέλο ρόλων: μόνο `super_admin`/`support`, με ΜΙΑ
  μοναδική διαφορά προνομίων.** Η μόνη ενέργεια που δεν επιτρέπεται σε
  `support` είναι το grant/revoke άλλων platform admins (privilege-
  escalation boundary) -- κάθε άλλη ενέργεια (αναστολή εστιατορίου, ορισμός
  συνδρομής) είναι διαθέσιμη και στους δύο ρόλους, ρητά για να αποφευχθεί
  υπερμηχανική (overengineered) λεπτομερής άδεια χωρίς πραγματική ανάγκη
  στο MVP.
- **Καμία self-service εγγραφή platform admin, καμία πρόσκληση μέσω
  email.** Το `admin_grant_platform_admin()` αναζητά το email σε
  `auth.users` και πετάει `USER_NOT_FOUND` αν δεν υπάρχει ήδη λογαριασμός
  -- το άτομο πρέπει πρώτα να εγγραφεί κανονικά (tab "Sign up" στο
  `apps/admin`), και μετά ένας υπάρχων `super_admin` του δίνει πρόσβαση. Ο
  πρώτος admin της πλατφόρμας μπαίνει με χειροκίνητο DB insert -- σκόπιμο
  όριο ασφαλείας, όχι παράλειψη.
- **`apps/admin` είναι EN-only, ρητή απόφαση εμβέλειας.** Η απαίτηση
  DE/EN/EL/TR MVP αφορά ρητά το προσωπικό εστιατορίου και τον πελάτη
  (Φάσεις 04/08) -- αυτό το εργαλείο είναι εσωτερικό ops tool του ίδιου
  του ReservX, όχι εστιατόριο-facing ή πελάτη-facing, οπότε δεν εμπίπτει
  σε αυτή την απαίτηση. Καμία σύνδεση με `@reservex/i18n`.
- **Ενιαίο `AdminGate` αντί για ξεχωριστό route `/login` + redirects ανά
  σελίδα.** Δεν υπάρχει τίποτα άλλο σε αυτή την εφαρμογή που θα συνέδεε σε
  ξεχωριστή σελίδα login -- ένα ενιαίο gate στο root layout είναι
  απλούστερο να συλλογιστεί κανείς παρά route-based auth guards, χωρίς
  απώλεια λειτουργικότητας.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Καμία νέα Edge Function** -- εξηγήθηκε παραπάνω, όχι παράλειψη.
- **Κανένα organization/restaurant picker στα feature flag overrides.** Το
  πεδίο στόχευσης (`organization_id` XOR `restaurant_id`) είναι raw UUID
  text input -- σπάνια, χαμηλού όγκου ενέργεια (targeted rollout/kill-
  switch), δεν αξίζει ακόμα ένα cross-tenant search picker. Η σελίδα
  Organizations είναι ένα κλικ μακριά για να βρεθεί ένα id.
- **Κανένα server-side pagination/αναζήτηση στο `admin_list_organizations`/
  `admin_list_restaurants`.** Client-side φιλτράρισμα μόνο -- αποδεκτό στο
  τρέχον μέγεθος της πλατφόρμας (2-3 pilot εστιατόρια). Θα χρειαστεί
  επανεξέταση αν το ρόστερ μεγαλώσει σημαντικά.
- **Κανένα password-reset flow στο `apps/admin`.** Ούτε αυτό υπήρχε ρητά
  ζητημένο -- το staff app (mobile) έχει ήδη ένα από τη Φάση 04, αλλά αυτό
  το εσωτερικό εργαλείο δεν το χρειάστηκε ακόμα (πολύ μικρή, γνωστή ομάδα).
- **Κανένα admin billing UI πέρα από το χειροκίνητο override συνδρομής.**
  Το `admin_set_subscription()` καλύπτει τη ρητή ανάγκη του blueprint
  ("διαχείριση συνδρομών") -- ένα πλήρες προβολή τιμολογίων/Stripe
  Billing Portal integration δεν ζητήθηκε.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase13_platform_admin.sql`, σε ολόκληρη ΚΑΙΝΟΥΡΙΑ
  τοπική PostgreSQL 16 (πλήρες rebuild από την 0001 μέχρι την 0020 + seed),
  5 ενότητες (~21 έλεγχοι): grant/revoke platform admin (με το guard
  τελευταίου super_admin), αναστολή/άρση αναστολής εστιατορίου
  (συμπεριλαμβανομένης της εμπειρικής απόδειξης του column-protection
  trigger -- βλ. παραπάνω), εξαφάνιση ανασταλμένου εστιατορίου από το
  δημόσιο directory + άρνηση νέων κρατήσεων μέσω `book_public_
  reservation()`, χειροκίνητη υπερίσχυση συνδρομής (με ρετίρισμα της
  προηγούμενης), και feature flags/overrides (write επιτρέπεται μόνο σε
  platform admin, read παραμένει ανοιχτό σε κάθε συνδεδεμένο χρήστη όπως
  ήταν ήδη από τη Φάση 02).
- Ξανατρέχτηκε ΟΛΗ η σουίτα παλαιότερων `verify_phaseNN_*.sql` (04 έως 12)
  πάνω στην ΙΔΙΑ βάση μετά την 0020 -- μηδέν regressions.
- 120 αρχεία `.ts`/`.tsx` (συμπεριλαμβανομένου ολόκληρου του νέου
  `apps/admin`) περνούν συντακτικό έλεγχο TypeScript χωρίς σφάλμα.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ότι το `apps/admin` πράγματι κάνει build/τρέχει σε πραγματικό browser --
  κανένα `npm install`/`next dev` εκτελέστηκε σε αυτό το sandbox (δεν
  υπάρχει δίκτυο για το npm registry εδώ), μόνο συντακτικός έλεγχος
  TypeScript/JSX. Ο κώδικας ακολουθεί ακριβώς το ίδιο, ήδη δοκιμασμένο
  μοτίβο του `apps/web` (ίδιο `getSupabaseBrowserClient()`, ίδιο σχήμα
  auth state), αλλά αυτό δεν αντικαθιστά ένα πραγματικό `pnpm install &&
  pnpm dev`.
- Ότι το `admin_grant_platform_admin()`/`admin_set_subscription()` κ.λπ.
  συμπεριφέρονται σωστά σε πραγματικό production-scale Supabase project
  (π.χ. auth.users lookup με πραγματικό RLS στο auth schema) -- δοκιμάστηκε
  μόνο στην τοπική βάση με χειροποίητα test δεδομένα.

## Φάση 14: Web / PWA

Το blueprint όριζε τη Φάση 14 ως "Δημόσια booking σελίδα, widget, PWA
βελτιστοποίηση" -- αλλά η ίδια η δημόσια booking σελίδα (κατάλογος,
προφίλ εστιατορίου, φόρμα κράτησης, λογαριασμός πελάτη) είχε ήδη χτιστεί
πλήρως στη Φάση 08. Αυτή η φάση καλύπτει τα δύο κομμάτια που έμειναν ρητά
εκτός τότε: ένα **booking widget** για ενσωμάτωση σε τρίτο site, και
**πραγματική βελτιστοποίηση PWA** (μέχρι τώρα δεν υπήρχε καθόλου --
κανένα manifest, καμία εικόνα εφαρμογής, κανένα service worker). Καμία
νέα migration -- όλη η δουλειά είναι σε επίπεδο εφαρμογής (`apps/web`),
πάνω σε ήδη υπάρχουσες, ήδη επαληθευμένες public RLS πολιτικές/functions
της Φάσης 08.

### Τι χτίστηκε

- **`app/widget/[locale]/[slug]/page.tsx`** (νέο route, εκτός του
  `app/[locale]/...` δέντρου): μια «γυμνή» εκδοχή της σελίδας
  εστιατορίου -- όνομα, ωράριο, φόρμα κράτησης -- χωρίς κανένα από το
  chrome του site (header, nav, locale switcher, σύνδεσμος λογαριασμού),
  έτοιμη να μπει σε `<iframe>` στο site ενός εστιατορίου. Καμία δεύτερη
  υλοποίηση της λογικής κράτησης: το ίδιο `BookingForm` και το ίδιο νέο
  κοινό component `OpeningHoursList` (εξαγμένο από τη σελίδα προφίλ της
  Φάσης 08, όχι αντιγραμμένο) τροφοδοτούν και τις δύο σελίδες.
- **`WidgetResizeReporter.tsx`**: μικρό client component που στέλνει το
  πραγματικό ύψος περιεχομένου του widget στο parent παράθυρο μέσω
  `postMessage` (ResizeObserver πάνω στο `<body>`) -- έτσι το site που το
  ενσωματώνει μπορεί να αλλάξει δυναμικά το ύψος του `<iframe>` καθώς η
  φόρμα μεγαλώνει/μικραίνει. Ένα σκόπιμα απλό, χωρίς dependency μοτίβο
  (τυπικό για embeddable widgets) αντί για ένα δημοσιευμένο JS SDK/bundle
  -- δεν χρειάζεται pipeline bundling/CDN hosting για κάτι τόσο μικρό.
- **`app/manifest.ts`**: πραγματικό Web App Manifest (Next.js το σερβίρει
  αυτόματα στο `/manifest.webmanifest` και το συνδέει αυτόματα σε κάθε
  σελίδα). `display: "standalone"`, `theme_color`/`background_color` από
  το ίδιο design system, δύο εικόνες (192/512).
- **`public/icons/`, `app/icon.png`, `app/apple-icon.png`**: πραγματικά,
  λειτουργικά PNG εικονίδια -- ένα μονόγραμμα "R" σε φόντο του χρώματος
  Ember (`#E85D2C`), παραγμένο εδώ με ImageMagick. **Λειτουργικό
  placeholder, όχι τελικό branding** -- χρειάζεται πραγματικό pass
  σχεδίασης πριν από πραγματική κυκλοφορία, ρητά δηλωμένο εδώ και στο ίδιο
  το `manifest.ts`, όχι σιωπηλή παράλειψη.
- **`public/sw.js`**: χειρόγραφο service worker (καμία εξάρτηση
  `next-pwa`/workbox -- δεν υπάρχει δίκτυο σε αυτό το sandbox για να
  επαληθευτεί ότι ένα τέτοιο plugin πράγματι εγκαθίσταται/χτίζεται σωστά
  πάνω στο webpack config του Next.js 14, οπότε ένα απλό, διαφανές αρχείο
  ήταν η πιο έντιμη επιλογή). Cache-first ΜΟΝΟ για τα immutable,
  content-hashed `_next/static/**` assets· κάθε πλοήγηση σελίδας είναι
  **πάντα network-first** -- η cache είναι αποκλειστικά fallback για
  αποτυχημένο αίτημα, ποτέ προτιμότερη από ζωντανή απάντηση, ώστε ένας
  επισκέπτης με σύνδεση να βλέπει πάντα την πραγματική διαθεσιμότητα, ποτέ
  μπαγιάτικη cached σελίδα.
- **`app/offline/page.tsx`**: φιλική οθόνη "είστε εκτός σύνδεσης" αντί για
  το προεπιλεγμένο σφάλμα του browser, όταν μια πλοήγηση αποτύχει εντελώς.
  Σκόπιμα εκτός του συστήματος μεταφράσεων (μόνιμα στα αγγλικά) -- πρέπει
  να δουλεύει από την cache του service worker με μηδέν δικτυακές κλήσεις,
  άρα δεν έχει τρόπο να μάθει ποια γλώσσα είχε επιλέξει ο επισκέπτης.
- **`app/layout.tsx`**: πρόσθεσε `viewport.themeColor` (light/dark, ίδια
  τιμή με το `--accent`), `appleWebApp` metadata (καλύπτει ό,τι το
  manifest δεν καλύπτει αξιόπιστα στο iOS Safari, σχετικό όσο δεν υπάρχει
  ακόμα λογαριασμός Apple Developer), και εγγραφή του service worker
  μέσω του νέου `ServiceWorkerRegister.tsx`.
- **`scripts/verify_phase14_web_pwa.mjs`**: δες παρακάτω.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Iframe embed αντί για δημοσιευμένο JS SDK/bundle για το widget.** Ένα
  `<iframe src="https://.../widget/en/my-restaurant">` είναι ό,τι χρειάζεται
  ένας ιδιοκτήτης εστιατορίου να επικολλήσει στο site του -- καμία ανάγκη
  για CORS, DOM manipulation στο host page, build pipeline (rollup/webpack
  UMD bundle), CDN hosting, ή versioning ενός δημοσιευμένου πακέτου.
  Απλούστερο, ασφαλέστερο (sandboxed by design), και αρκετό για το MVP.
- **Καμία απαγόρευση framing στο `app/widget/...`.** Δεν υπάρχει πουθενά
  σε αυτή την εφαρμογή `X-Frame-Options`/`Content-Security-Policy:
  frame-ancestors` -- αυτό είναι που κάνει το embedding δυνατό εξαρχής, και
  είναι εντάξει εδώ επειδή αυτό το route δείχνει ΜΟΝΟ δημόσια δεδομένα (τα
  ήδη public RLS policies της Φάσης 08) -- δεν υπάρχει τίποτα ευαίσθητο να
  προστατευτεί από framing.
- **Χειρόγραφο service worker αντί για `next-pwa`/workbox.** Καμία νέα
  npm εξάρτηση δεν μπορεί να επαληθευτεί ότι πράγματι εγκαθίσταται/χτίζεται
  σε αυτό το sandbox (κανένα δίκτυο προς το npm registry) -- ένα μικρό,
  διαφανές αρχείο που διαβάζεται top-to-bottom ήταν πιο έντιμη επιλογή από
  ένα plugin που δεν μπορεί να δοκιμαστεί end-to-end.
- **Ειλικρινές όριο του τι κάνει πραγματικά το PWA: καμία "κράτηση
  offline".** Οι δημόσιες σελίδες είναι server-rendered ανά αίτημα πάνω σε
  ζωντανά, συνεχώς μεταβαλλόμενα δεδομένα (διαθεσιμότητα τραπεζιού,
  ωράριο) -- δεν υπάρχει, και δεν προσποιείται ότι υπάρχει, καμία
  δυνατότητα πραγματικής κράτησης χωρίς σύνδεση. Αυτό που πραγματικά
  προσφέρει το service worker: δυνατότητα εγκατάστασης (installability),
  γρηγορότερη επαναφόρτωση στατικών assets, και μια φιλική οθόνη offline
  αντί για το προεπιλεγμένο σφάλμα του browser.
- **Placeholder εικονίδια, ρητά δηλωμένα ως τέτοια.** Ένα λειτουργικό
  μονόγραμμα "R" αντί για πραγματικό λογότυπο -- κάνει το manifest/PWA
  πραγματικά έγκυρο και εγκαταστάσιμο σήμερα, αλλά χρειάζεται αντικατάσταση
  με πραγματικά brand assets πριν από πραγματική κυκλοφορία. Καμία
  "maskable" παραλλαγή εικονιδίου (safe-zone padding) -- δεν αξίζει την
  πολυπλοκότητα πριν υπάρξει πραγματικό artwork να βασιστεί πάνω του, και
  δεν είναι απαραίτητη για τη βασική δυνατότητα εγκατάστασης.
- **`OpeningHoursList` εξήχθη ως κοινό component.** Η σελίδα προφίλ
  (Φάση 08) και το νέο widget δείχνουν ακριβώς το ίδιο block ωραρίου --
  εξαγωγή αντί για αντιγραφή, ώστε μια μελλοντική αλλαγή (π.χ. προσθήκη
  timezone label) να μη χρειαστεί να γίνει σε δύο σημεία.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Καμία δημόσια booking σελίδα από την αρχή** -- ήδη χτισμένη πλήρως στη
  Φάση 08, δεν ήταν δουλειά αυτής της φάσης να ξαναχτιστεί.
- **Κανένα δημοσιευμένο JS widget SDK/bundle.** Μόνο το iframe embed --
  εξηγήθηκε παραπάνω, σκόπιμη απόφαση απλότητας, όχι παράλειψη λόγω
  έλλειψης χρόνου.
- **Καμία "maskable" εικόνα, κανένα πραγματικό brand asset.** Εξηγήθηκε
  παραπάνω.
- **Κανένα offline booking/queueing μηχανισμό** (π.χ. "στείλε την κράτηση
  όταν επανέλθει η σύνδεση"). Θα χρειαζόταν IndexedDB + background sync +
  προσεκτικό χειρισμό race conditions με τη διαθεσιμότητα -- πολύ πάνω από
  ό,τι χρειάζεται το MVP, και θα έδινε στον χρήστη μια ψευδή αίσθηση
  βεβαιότητας για κάτι που δεν έχει καν επιβεβαιωθεί από τον server.
- **Καμία push notification μέσω του service worker.** Οι ειδοποιήσεις
  παραμένουν ό,τι ήταν ήδη από τη Φάση 09 (in-app queue) -- web push θα
  ήταν μια λογική μελλοντική επέκταση πάνω σε αυτό το ίδιο service worker,
  όχι δουλειά αυτής της φάσης.
- **Καμία αλλαγή στο `apps/mobile`.** Η Expo εφαρμογή έχει το δικό της,
  ήδη υπάρχον installability story (native app store / EAS build) -- το
  PWA αφορά αποκλειστικά το `apps/web`.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase14_web_pwa.mjs`: μεταγλωττίζει ΚΑΙ εκτελεί
  πραγματικά (όχι μόνο συντακτικός έλεγχος) το `app/manifest.ts` μέσω του
  ίδιου του TypeScript compiler, επιβεβαιώνει τα υποχρεωτικά πεδία,
  και διαβάζει τις πραγματικές διαστάσεις κάθε PNG εικονιδίου απευθείας
  από το δικό του IHDR chunk (χωρίς βιβλιοθήκη εικόνας) για να επιβεβαιώσει
  ότι ταιριάζουν με τα δηλωμένα `sizes` του manifest. Επίσης επιβεβαιώνει
  ότι κάθε URL στο `PRECACHE_URLS` του `sw.js` αντιστοιχεί σε πραγματικό
  αρχείο/route στο δίσκο (θα έπιανε ένα typo που θα έκανε το
  `cache.addAll()` να πετάξει σφάλμα σε πραγματικό browser).
- 126 αρχεία `.ts`/`.tsx` περνούν συντακτικό έλεγχο TypeScript χωρίς
  σφάλμα (`verify_ts_syntax.mjs`).
- Και οι 4 γλώσσες (de/en/el/tr) έχουν πανομοιότυπο σύνολο i18n keys μετά
  την προσθήκη της ενότητας `public.widget.*` (452 keys η καθεμία,
  `check-locale-parity.mjs`).
- Τα εικονίδια ανοίχτηκαν και εξετάστηκαν οπτικά (όχι μόνο ελέγχθηκε ότι
  υπάρχουν ως αρχεία) -- ευανάγνωστο μονόγραμμα, καθαρό φόντο, σωστές
  διαστάσεις.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ότι το manifest/service worker πράγματι εμφανίζουν το prompt "Install
  ReservX" σε πραγματικό Chrome/Edge/Android, ή ότι το "Add to Home
  Screen" δουλεύει σωστά σε πραγματικό iOS Safari -- κανένας πραγματικός
  browser/συσκευή διαθέσιμη σε αυτό το sandbox για δοκιμή. Ο κώδικας
  ακολουθεί την τεκμηριωμένη προδιαγραφή Web App Manifest/Service Worker
  ακριβώς, αλλά αυτό δεν αντικαθιστά ένα πραγματικό Lighthouse audit ή
  δοκιμή σε πραγματική συσκευή.
- Ότι το `<iframe>` embed πράγματι λειτουργεί ενσωματωμένο σε πραγματικό
  τρίτο site (postMessage resize, φόρτωση εντός iframe) -- δοκιμάστηκε
  μόνο ο κώδικας μεμονωμένα, όχι σε πραγματικό cross-origin embedding
  σενάριο.
- Ότι το `next build`/`next dev` πράγματι τρέχει με τα νέα αρχεία --
  ίδιος γνωστός περιορισμός με κάθε προηγούμενη φάση: κανένα `npm install`
  εκτελέστηκε εδώ (χωρίς δίκτυο προς το npm registry).

## Φάση 15: Testing

Το blueprint όριζε τη Φάση 15 ως "RLS, conflicts, AI permissions, payments"
-- σκόπιμα σημειωμένη "συνεχές" (ongoing), όχι εφάπαξ. Δεν είναι νέο
feature: κάθε πίνακας/function που αγγίζει είχε ήδη χτιστεί και το δικό του
`verify_phaseNN_*.sql` από πριν. Αυτό που πρόσθεσε η Φάση 15 είναι ο
**cross-cutting έλεγχος** που κανένα per-feature script δεν έκανε ποτέ:
συστηματική επιβεβαίωση ότι ΚΑΘΕ πίνακας έχει RLS ενεργό (όχι μόνο όσοι
έτυχε να ελεγχθούν σε κάποια φάση), κλείσιμο συγκεκριμένων κενών
cross-tenant απομόνωσης που ποτέ δεν είχαν ρητά επιβεβαιωθεί πουθενά, μια
πραγματική δοκιμή ταυτόχρονης πρόσβασης (όχι μόνο sequential), και μία
ενοποιημένη εντολή για να ξανατρέξουν όλα τα προηγούμενα scripts μαζί.

### Τι χτίστηκε

- **`scripts/verify_phase15_testing.sql`** (νέο, 5 ενότητες):
  - **A1**: αυτοματοποιημένος έλεγχος -- ΚΑΘΕ `public.*` πίνακας έχει RLS
    ενεργό, ερώτημα πάνω στο `pg_class.relrowsecurity` και όχι χειροκίνητη
    επιθεώρηση. Αν μια μελλοντική migration ξεχάσει να ενεργοποιήσει RLS σε
    νέο πίνακα, αυτό το script θα το πιάσει αμέσως, όχι κάποια στιγμή
    αργότερα.
  - **A2-A5**: cross-tenant SELECT απομόνωση σε `tables`/`table_zones`,
    `notifications`, `payments`, και `subscriptions` -- σε κάθε περίπτωση ο
    Munich manager/owner βλέπει μηδέν γραμμές του Athens (και το `subscriptions`
    ελέγχεται ρητά ως organization-scoped, όχι restaurant-scoped). Κανένα από
    αυτά τα τέσσερα δεν είχε ελεγχθεί ρητά με αυτόν τον τρόπο σε καμία
    προηγούμενη φάση -- επιβεβαιώθηκε ψάχνοντας με grep σε κάθε υπάρχον
    `verify_phaseNN` script πριν γραφτεί αυτό.
  - **C1-C3 (AI permissions)**: ένα μέλος προσωπικού δεν μπορεί να
    self-approve μια προτεινόμενη AI ενέργεια γράφοντας απευθείας στο
    `ai_actions` (καμία UPDATE policy δεν υπάρχει καθόλου -- μόνο το
    Edge Function, μέσω re-run `authorize()`, μπορεί να το μεταβάλει), δεν
    μπορεί να εισάγει νέα γραμμή απευθείας ως ήδη "executed" (παρακάμπτοντας
    το propose βήμα), και προσωπικό ΑΛΛΟΥ εστιατορίου δεν βλέπει καθόλου την
    προτεινόμενη ενέργεια.
  - **D1 (payments)**: το `uidx_payments_provider_ref` unique constraint
    πράγματι απορρίπτει μια διπλή εγγραφή (provider, provider_payment_id) --
    αποδεδειγμένο δοκιμάζοντάς το πραγματικά, όχι συμπερασμένο από το σχήμα.
    Αυτό είναι ο μηχανισμός που κάνει ένα replayed Stripe webhook event
    ασφαλές.
- **`scripts/verify_phase15_concurrency.sh`** (νέο, bash -- όχι .sql, αφού
  χρειάζεται πραγματικά ΔΥΟ ξεχωριστές OS διεργασίες/συνδέσεις): ξεκινά δύο
  ανεξάρτητες `psql` διεργασίες στο background, με μηδέν καθυστέρηση
  συγχρονισμού μεταξύ τους, που ΚΑΙ οι δύο προσπαθούν να κλείσουν το ΙΔΙΟ
  τραπέζι (T1, Athens, χωρητικότητα 2) για το ΙΔΙΟ ραντεβού. Δες παρακάτω για
  το πραγματικό εύρημα.
- **`scripts/run_all_verifications.sh`** (νέο): ενοποιεί το τελετουργικό που
  επαναλάμβανα χειροκίνητα σε ΚΑΘΕ προηγούμενη φάση (drop/create database,
  shim, 20 migrations με τη σειρά, seed, μετά κάθε verify script) σε μία
  εντολή. Ξεχωρίζει ρητά δύο κατηγορίες scripts: αυτά με πραγματικό exit
  code (τα `.mjs` και το νέο concurrency `.sh`) αναφέρονται με πραγματικό
  pass/fail· τα SQL scripts των Φάσεων 04-13+15 είναι **εξ σχεδιασμού
  eyeball-verified** (τρέχουν με `ON_ERROR_STOP off` και τυπώνουν ένα
  αναμενόμενο αποτέλεσμα -- συχνά το ίδιο ένα "ERROR" -- δίπλα σε κάθε
  assertion, από τη Φάση 04) -- ο κώδικας εξόδου της `psql` δεν μπορεί να
  ξεχωρίσει ένα σκόπιμο RLS-rejection error από πραγματικό regression, οπότε
  το script αποθηκεύει πλήρες output σε log αρχεία και λέει ρητά "διάβασέ
  το", αντί να προσποιείται αυτοματοποιημένη επαλήθευση που δεν έχει.

### Το πραγματικό εύρημα της δοκιμής ταυτόχρονης πρόσβασης

Η Φάση 07 είχε ήδη αποδείξει ότι το EXCLUDE constraint μπλοκάρει
διπλοκρατήσεις, αλλά μόνο πιέζοντάς το χειροκίνητα σε ΜΙΑ σύνδεση,
sequential (Test G). Αυτό δεν αποδεικνύει το ίδιο πράγμα με δύο πραγματικές,
ταυτόχρονες συνδέσεις. Το `verify_phase15_concurrency.sh` έτρεξε αυτό το
πραγματικό σενάριο επανειλημμένα, και το αποτέλεσμα ήταν συνεπές αλλά **όχι
αυτό που θα περίμενε κανείς διαισθητικά**: ο χαμένος πάντα απορρίπτεται με
`DOUBLE_BOOKED` (το EXCLUDE constraint στο επίπεδο INSERT), όχι με
`NO_AVAILABILITY` (το SELECT-based φίλτρο διαθεσιμότητας πριν το insert).
Αυτό συμβαίνει επειδή, υπό πραγματική ταυτοχρονία, ΚΑΙ οι δύο συναλλαγές
προλαβαίνουν να εκτελέσουν το δικό τους availability pre-check ΠΡΙΝ κάποια
από τις δύο κάνει commit -- άρα και οι δύο βλέπουν το τραπέζι ελεύθερο και
προσπαθούν και οι δύο το INSERT. Το EXCLUDE constraint, όχι το pre-check
query, είναι αυτό που πραγματικά πιάνει τον χαμένο. Είναι ακριβώς αυτό που
έλεγε το σχόλιο του Test G της Φάσης 07 ("το EXCLUDE constraint -- όχι μόνο
το SQL availability filter -- είναι αυτό που πραγματικά αποτρέπει
διπλοκράτηση"), τώρα αποδεδειγμένο κάτω από πραγματική ταυτοχρονία αντί για
χειροκίνητο bypass μίας σύνδεσης.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Eyeball-verified SQL scripts παραμένουν eyeball-verified -- δεν
  προσποιήθηκα ψευδή αυτοματοποίηση.** Θα ήταν εύκολο να γράψω έναν
  "master runner" που διαβάζει το exit code της `psql` και λέει OK/FAIL --
  αλλά αυτό θα ήταν ΛΑΘΟΣ για τα scripts των Φάσεων 04-13, που σκόπιμα
  περιμένουν ΚΑΙ επιτυχίες ΚΑΙ αναμενόμενα σφάλματα στο ίδιο run. Καλύτερα
  ένα ειλικρινές "διάβασέ το" παρά μια ψευδής πράσινη ένδειξη.
- **Cross-tenant gaps εντοπίστηκαν με grep, όχι με μάντεμα.** Πριν γραφτεί
  το `verify_phase15_testing.sql`, έψαξα με grep κάθε υπάρχον
  `verify_phaseNN` script για λέξεις-κλειδιά cross-tenant/"other
  restaurant" -- βρέθηκε ότι οι Φάσεις 05, 07, 08, 10, 11 το είχαν ήδη
  ελέγξει ρητά, αλλά οι Φάσεις 06, 09, 12 όχι. Αυτά τα τρία κενά είναι
  ακριβώς αυτά που καλύπτουν οι ενότητες A2-A4.
- **`ai_actions` επαληθεύτηκε ρητά χωρίς καμία write policy -- default
  deny, όχι μια πολιτική που τυχαίνει να είναι αυστηρή.** Η Φάση 10 είχε
  ήδη δοκιμάσει ότι ένα INSERT μιας *proposed* γραμμής απορρίπτεται· η
  Φάση 15 προσθέτει το πιο συγκεκριμένο σενάριο ενός staff member που
  προσπαθεί να self-approve μια ΗΔΗ υπάρχουσα προτεινόμενη ενέργεια (η
  πραγματική απειλή -- παράκαμψη του confirm flow, όχι απλώς εισαγωγή
  δεδομένων).

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Κανένα load/performance testing.** Αυτό είναι ρητά αντικείμενο της
  Φάσης 16 (Βελτιστοποίηση) στο blueprint, όχι της Φάσης 15.
- **Καμία δοκιμή ενάντια σε πραγματικό Stripe/Anthropic/Twilio API.** Ίδιος
  γνωστός περιορισμός με κάθε προηγούμενη φάση -- κανένα δίκτυο σε αυτό το
  sandbox. Το `uidx_payments_provider_ref` αποδεικνύει ότι ο μηχανισμός
  idempotency θα δούλευε, όχι ότι ένα πραγματικό Stripe webhook event
  δοκιμάστηκε end-to-end.
- **Κανένα penetration test / fuzzing.** Οι δοκιμές εδώ είναι στοχευμένες,
  adversarial-by-hand σενάρια πάνω σε γνωστά όρια (RLS, confirm flow,
  unique constraints) -- όχι αυτοματοποιημένη ανακάλυψη άγνωστων
  ευπαθειών.
- **Καμία δοκιμή concurrency πέρα από την κράτηση τραπεζιού.** Θα ήταν
  λογικό follow-up (π.χ. ταυτόχρονη διπλή χρέωση deposit, ταυτόχρονο
  grant/revoke platform admin) αλλά ξεπερνά το εύρος αυτής της φάσης.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `scripts/verify_phase15_testing.sql`: όλες οι 9 ενότητες (A1-A5, C1-C3,
  D1) πέρασαν σε ολόκληρη ΚΑΙΝΟΥΡΙΑ τοπική PostgreSQL 16 (πλήρες rebuild
  0001-0020 + seed).
- `scripts/verify_phase15_concurrency.sh`: έτρεξε επανειλημμένα (3+ φορές)
  με πραγματικές, ξεχωριστές διεργασίες `psql` -- συνεπές αποτέλεσμα κάθε
  φορά (ένας νικητής, ένας DOUBLE_BOOKED, μηδέν διπλή κατοχή στο
  `reservation_tables`). Έγινε idempotent (καθαρίζει πριν και μετά) ώστε να
  μπορεί να ξανατρέξει χωρίς πλήρες rebuild ενδιάμεσα.
- `scripts/run_all_verifications.sh`: έτρεξε end-to-end πραγματικά --
  rebuild, 12 SQL scripts, 6 exit-code-checked scripts, όλα OK.
- Ξανατρέχτηκε ολόκληρη η προηγούμενη σουίτα (Φάσεις 04-14) μέσα από αυτό
  το ενοποιημένο runner -- μηδέν regressions.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ότι τα eyeball-verified SQL scripts (04-13, 15) δεν έχουν κανένα
  regression -- διαβάστηκαν τα logs τους σε αυτή τη φάση, αλλά αυτό είναι
  ανθρώπινη επιθεώρηση, όχι αυτοματοποιημένη απόδειξη, όπως εξηγείται
  παραπάνω.
- Ότι η ταυτοχρονία συμπεριφέρεται το ίδιο σε πραγματικό production
  Supabase/PgBouncer setup (connection pooling, πραγματικό network
  latency) όσο σε δύο τοπικές `psql` διεργασίες στο ίδιο μηχάνημα.

## Φάση 16: Βελτιστοποίηση

Το blueprint όριζε τη Φάση 16 σε τρεις διαστάσεις: performance, ασφάλεια,
κόστος AI. Όπως η Φάση 15, δεν είναι νέο feature -- είναι ένα cross-cutting
πέρασμα πάνω από όσα ήδη χτίστηκαν στις Φάσεις 0001-0020, με τη μορφή ενός
νέου migration (`0021_optimization.sql`) και δύο στοχευμένων αλλαγών κώδικα.

### Τι χτίστηκε

- **`supabase/migrations/0021_optimization.sql`** (νέο, δύο ενότητες):
  - **Ενότητα Α (ασφάλεια)**: η PostgreSQL δίνει `EXECUTE` στο `PUBLIC` σε
    ΚΑΘΕ νέα function από default. Η πειθαρχία "explicit revoke-then-grant"
    ξεκίνησε ρητά από τη Φάση 12/13 (`0020`'s δικό του σχόλιο), αλλά ΚΑΘΕ
    function που χτίστηκε πριν από αυτό (Φάσεις 04-11, δηλαδή migrations
    0005-0018 περίπου) είχε ακόμα μείνει PUBLIC-executable, χωρίς ποτέ να
    εντοπιστεί. Ένα audit πάνω σε όλες τις 305 functions του public schema
    (`has_function_privilege('public', ...)`) βρήκε 20 τέτοιες. Καμία από
    αυτές δεν επέτρεπε ΠΡΑΓΜΑΤΙΚΗ διαρροή δεδομένων από μόνη της (όλες είναι
    είτε SECURITY DEFINER με δικό τους εσωτερικό `is_restaurant_member()`/
    `is_platform_admin()` έλεγχο, είτε SECURITY INVOKER πίσω από RLS) --
    αλλά ήταν πραγματική, αποφεύξιμη επιφάνεια επίθεσης, ασυνεπής με τη
    δηλωμένη πειθαρχία του project. Έκλεισε function-by-function, με
    ρητή διασταύρωση κάθε πραγματικού caller σε `packages/core/src/api/*.ts`,
    `supabase/functions/*/index.ts`, και `ai-gateway/tools.ts`.
  - **Ενότητα Β (performance)**: η PostgreSQL ΔΕΝ δημιουργεί αυτόματα index
    σε στήλη foreign key (σε αντίθεση με άλλες βάσεις) -- ένα γνωστό, εύκολο
    να ξεφύγει κενό υγιεινής. Ένα audit query (`pg_constraint`/
    `pg_attribute`/`pg_index`) βρήκε 17 τέτοια κενά σε ολόκληρο το σχήμα
    (π.χ. `audit_logs.organization_id`, `payments.customer_id`,
    `reservations.zone_preference_id`). Προστέθηκαν και τα 17 -- φθηνό,
    μηδενικού ρίσκου, χωρίς επιλεκτική υποομάδα.
- **`scripts/verify_phase16_optimization.sql`** (νέο, eyeball-verified όπως
  κάθε SQL script από τη Φάση 04): αυτοματοποιημένο sweep ότι το `PUBLIC` δεν
  έχει πλέον `EXECUTE` σε καμία από τις 20 functions, θετικά τεστ ότι οι 7
  functions που ΠΡΕΠΕΙ να μείνουν anon-callable πραγματικά ακόμα δουλεύουν
  end-to-end (η ίδια ερώτηση με το Test A του `verify_phase08` -- ακριβώς
  αυτή που έπιασε το πραγματικό regression, δες παρακάτω), αρνητικά τεστ ότι
  functions που σκόπιμα ΔΕΝ φαρδύνθηκαν σε anon παραμένουν κλειστές, και ένα
  `EXPLAIN` που αποδεικνύει ότι ο planner πραγματικά επιλέγει ένα από τα νέα
  17 indexes (`idx_audit_logs_organization_id`), όχι απλώς ότι το index
  υπάρχει.
- **`scripts/verify_phase16_ai_cost.mjs`** (νέο, πραγματική εκτέλεση --
  transpile μέσω `ts.transpileModule` + πραγματική κλήση του
  `AnthropicProvider.chat()` με mocked `global.fetch` που καταγράφει το
  πραγματικό αίτημα): επιβεβαιώνει ότι το `system` στέλνεται ως array από
  content blocks με `cache_control`, ότι ΜΟΝΟ το τελευταίο tool definition
  φέρει `cache_control` (όχι όλα), και ότι το `messages` array ΔΕΝ φέρει
  `cache_control` καθόλου (αλλάζει κάθε γύρο, δεν θα ωφελούσε ποτέ να
  cache-αριστεί). Για το `loadHistory()` του `ai-gateway/index.ts` (Deno-only
  imports, δεν μπορεί να εκτελεστεί σε αυτό το sandbox χωρίς Deno runtime) ο
  έλεγχος είναι δομικός στο πηγαίο κώδικα -- ασθενέστερη απόδειξη από
  πραγματική εκτέλεση, δηλωμένη ρητά ως τέτοια.
- **AI-cost κώδικας**:
  - `supabase/functions/ai-gateway/index.ts`'s `loadHistory()`: πριν, ΚΑΝΕΝΑ
    όριο -- κάθε γύρος μιας συνομιλίας ξαναέστελνε ΟΛΟΚΛΗΡΟ το ιστορικό στο
    μοντέλο, οπότε το κόστος ανά γύρο μεγάλωνε απεριόριστα με το μήκος της
    συνομιλίας. Προστέθηκε `MAX_HISTORY_MESSAGES = 20`: το ερώτημα τώρα
    φέρνει τα πιο πρόσφατα 20 μηνύματα (`order by created_at descending,
    limit 20`) και τα αντιστρέφει σε χρονολογική σειρά πριν επιστρέψει.
    Ρητή, έντιμη ανταλλαγή -- μια συνομιλία που ξεπερνά τα 20 μηνύματα χάνει
    τα πρώτα της γυρίσματα από το context του μοντέλου, όχι κρυφή απώλεια.
  - `packages/ai/src/providers/anthropic.ts`: προστέθηκε Anthropic prompt
    caching (`cache_control: {type: 'ephemeral'}`) στο system prompt block
    ΚΑΙ στο τελευταίο tool definition -- το documented μηχανισμό της
    Messages API. Το system prompt + τα tool schemas είναι 100% στατικά σε
    ΚΑΘΕ γύρο, ΚΑΘΕ συνομιλίας, ΚΑΘΕ εστιατορίου· πριν αυτή την αλλαγή
    ξαναδιαβάζονταν από την αρχή κάθε φορά.

### Ένα πραγματικό regression που εντοπίστηκε ΚΑΤΑ τη διάρκεια αυτής της φάσης

Η πρώτη προσπάθεια της Ενότητας Α περιόρισε τα
`is_restaurant_member`/`has_restaurant_role`/`is_org_owner`/`owns_customer`
σε `authenticated`-only, με βάση αποκλειστικά το ποιος τα καλεί απευθείας
(`grep` σε κάθε `.rpc()`/`callerClient` call) -- φαινομενικά σωστό. Το
ξανατρέξιμο ολόκληρης της σουίτας `run_all_verifications.sh` (η καθιερωμένη
"tested, not assumed" πειθαρχία, όχι μόνο το νέο script αυτής της φάσης)
έπιασε αμέσως το πρόβλημα: το Test A του `verify_phase08_public_booking.sql`
(anon διαβάζει το δημόσιο προφίλ του Ταβέρνα Ιθάκη) απέτυχε με "permission
denied for function is_restaurant_member" αντί για το αναμενόμενο
αποτέλεσμα.

Η αιτία: αυτές οι τέσσερις functions χρησιμοποιούνται ΜΕΣΑ σε permissive RLS
policies (π.χ. `restaurants_select`) που συνδυάζονται με OR δίπλα στη δική
του public-facing policy κάθε πίνακα (`restaurants_public_select`). Η
PostgreSQL αξιολογεί ΟΛΕΣ τις εφαρμόσιμες permissive policies για τον ρόλο
που κάνει το ερώτημα -- όχι μόνο αυτή που θα έδινε πρόσβαση -- και η
αξιολόγηση μιας function που ο caller δεν έχει `EXECUTE` πάνω της πετάει
σκληρό σφάλμα για ΟΛΟΚΛΗΡΗ την εντολή, δεν προσπερνά απλώς εκείνη τη μία
policy. Άρα το `anon` χρειάζεται `EXECUTE` σε αυτές τις τέσσερις functions
ΑΚΟΜΑ ΚΙ ΑΝ ποτέ κανένας πραγματικός καλεί τες απευθείας -- επειδή είναι
predicate μέσα σε RLS πάνω σε πίνακες που το `anon` κι αλλιώς μπορεί να
αγγίξει (μέσω `restaurants_public_select` κ.ά.). Η τελική έκδοση του
migration δίνει σε αυτές τις τέσσερις `anon, authenticated` (ίδιο μοτίβο με
το προϋπάρχον `book_public_reservation`/`is_restaurant_open_at`), ενώ οι
υπόλοιπες 5 functions που ΔΕΝ εμφανίζονται ποτέ μέσα σε RLS predicate
(`book_reservation`, `get_available_tables`,
`get_available_table_combinations`, `get_reservation_analytics`,
`get_restaurant_staff`) παρέμειναν σωστά `authenticated`-only.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Το regression παραπάνω επιβεβαιώνει, δεν αντικρούει, τη μεθοδολογία
  "tested, not assumed".** Το caller-grep ΜΟΝΟ ΤΟΥ θα είχε δώσει μια εσφαλμένη
  αλλά εύλογη migration. Αυτό που την έπιασε ήταν το ξανατρέξιμο ΟΛΟΚΛΗΡΗΣ
  της προηγούμενης σουίτας μετά από κάθε αλλαγή -- ακριβώς η πειθαρχία που
  η Φάση 15 έχτισε ως εργαλείο.
- **Τα trigger functions (`set_updated_at`, `reservations_notify_on_change`
  κ.λπ.) δεν πήραν ΚΑΝΕΝΑ grant, ούτε σε `authenticated`.** Η PostgreSQL
  εκτελεί ένα trigger ως ο owner του πίνακα, ανεξάρτητα από ποιος έκανε το
  triggering statement -- δεν χρειάζεται καθόλου grant σε client role.
- **`is_restaurant_open_at`/`book_public_reservation`/
  `compute_deposit_amount` κράτησαν το ήδη υπάρχον `anon, authenticated`
  grant τους αμετάβλητο -- προστέθηκε μόνο το ρητό `revoke ... from public`
  για συνέπεια/υγιεινή, όχι αλλαγή στην πραγματική πρόσβαση.**
- **`MAX_HISTORY_MESSAGES = 20` είναι σημείο εκκίνησης, όχι tuned σταθερά.**
  Αρκετό για σύντομες, transactional ανταλλαγές (π.χ. "κλείσε μου τραπέζι
  για 4") -- εύκολο να ανέβει αργότερα αν πραγματική χρήση δείξει ότι
  χρειάζονται μεγαλύτερες συνομιλίες. Καμία σύνοψη ή διατήρηση των παλιών
  μηνυμάτων που πέφτουν έξω από το όριο σήμερα.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Καμία πραγματική επαλήθευση prompt caching έναντι live Anthropic API.**
  Ίδιος γνωστός περιορισμός με κάθε προηγούμενη φάση -- κανένα δίκτυο σε
  αυτό το sandbox, κανένα `ANTHROPIC_API_KEY`. Το
  `verify_phase16_ai_cost.mjs` αποδεικνύει το ΑΙΤΗΜΑ που στέλνεται είναι
  σωστά διαμορφωμένο σύμφωνα με το documented μηχανισμό της Anthropic --
  όχι ότι το πραγματικό cache-hit ποσοστό ή η μείωση κόστους 70-80% που
  αναφέρει το blueprint επαληθεύτηκε.
  Δες `packages/ai/src/provider.ts`'s δικό του honesty comment για το ίδιο.
- **Κανένα load/stress testing σε πραγματική κλίμακα.** Το `EXPLAIN` στο
  `verify_phase16_optimization.sql` δείχνει ότι ο planner επιλέγει τα νέα
  indexes πάνω στο μικρό seeded dataset -- δεν αποδεικνύει συμπεριφορά σε
  production όγκο δεδομένων.
- **Καμία σύνοψη (summarization) του ιστορικού συνομιλίας πέρα από τα 20
  μηνύματα.** Το `MAX_HISTORY_MESSAGES` όριο σήμερα απλώς κόβει τα παλιά
  μηνύματα, δεν τα συμπυκνώνει σε περίληψη -- λογικό follow-up αν
  χρειαστεί μεγαλύτερο πραγματικό context σε βάθος χρόνου.
- **Κανένα connection pooling / query-level caching (π.χ. Redis) πέρα από
  το Anthropic prompt caching.** Εκτός εύρους της Φάσης 16 όπως ορίστηκε
  στο blueprint.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- `0021_optimization.sql`: εφαρμόστηκε καθαρά σε πλήρες rebuild
  (migrations 0001-0021 + seed).
- `scripts/verify_phase16_optimization.sql`: όλες οι 7 ενότητες πέρασαν --
  automated sweep (0 PUBLIC-executable, 7 anon-executable), θετικά +
  αρνητικά end-to-end τεστ, EXPLAIN που επιβεβαιώνει πραγματική χρήση index.
- `scripts/verify_phase16_ai_cost.mjs`: πραγματική εκτέλεση του
  `AnthropicProvider.chat()` με μοναδικό fetch mock -- 12/12 checks OK.
- **Ολόκληρη η προηγούμενη σουίτα (Φάσεις 04-15) ξανατρέχτηκε ΔΥΟ φορές**
  μέσα από `run_all_verifications.sh` κατά τη διάρκεια αυτής της φάσης: μία
  φορά με το αρχικό (λανθασμένο) migration που έπιασε το regression, και
  μία ξανά μετά τη διόρθωση -- μηδέν regressions στη δεύτερη φορά.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Το πραγματικό ποσοστό μείωσης κόστους AI (το blueprint αναφέρει 70-80%) --
  απαιτεί live API key και πραγματική κίνηση, όχι διαθέσιμο σε αυτό το
  sandbox.
- Συμπεριφορά των νέων indexes σε production όγκο δεδομένων (millions of
  rows) αντί για το μικρό seeded dataset.
- Ότι κανένα ΑΛΛΟ, ανεντόπιστο PUBLIC-EXECUTE κενό δεν παραμένει έξω από
  τις 20 functions που ελέγχθηκαν ρητά εδώ -- το audit κάλυψε όλες τις 305
  functions του public schema όταν τρέχτηκε, αλλά μια μελλοντική migration
  θα μπορούσε να ξαναεισάγει το ίδιο default χωρίς να το προσέξει κανείς αν
  δεν ξανατρέξει το `verify_phase16_optimization.sql`'s A1 sweep.

## Φάση 17: Deployment

Το blueprint όριζε τη Φάση 17 ελάχιστα -- "Production release, CI/CD,
monitoring" -- χωρίς λεπτομερές sub-spec αλλού στο έγγραφο (σε αντίθεση με
προηγούμενες φάσεις). Σημαντική διαπίστωση πριν χτιστεί οτιδήποτε: αυτό το
project ΔΕΝ είχε ποτέ git repository μέσα σε αυτό το sandbox -- 16 φάσεις
χτίστηκαν και επαληθεύτηκαν πάνω σε flat αρχεία, χωρίς version control.
Χωρίς αυτό, "CI/CD" δεν σημαίνει τίποτα (προϋποθέτει git + remote). Οπότε η
πρώτη ενέργεια της Φάσης 17 ήταν να αρχικοποιηθεί πραγματικό git repository
με ένα πρώτο commit ("baseline snapshot: Phases 01-16"). Το υπόλοιπο της
φάσης χτίστηκε πάνω σε αυτό: πραγματικά GitHub Actions workflows, ένα
health-check endpoint, config για το Supabase CLI, και ένα πλήρες deployment
runbook -- με τον ίδιο περιορισμό κάθε προηγούμενης φάσης: κανένα δίκτυο σε
αυτό το sandbox για να γίνει πραγματικό `git push`/`supabase link`/deploy σε
ζωντανό λογαριασμό, οπότε τίποτα από αυτά δεν έχει εκτελεστεί σε πραγματικό
runner ή production περιβάλλον.

### Τι χτίστηκε

- **Πραγματικό git repository** (`git init` + πρώτο commit, branch
  `main`). Χωρίς αυτό δεν υπάρχει καμία έννοια "push to main" για να
  ενεργοποιήσει CI/CD.
- **`.github/workflows/ci.yml`** (νέο): τρέχει σε κάθε push/PR, τρία jobs:
  - `lint-typecheck`: `turbo run lint`/`typecheck` σε όλο το monorepo.
  - `db-verify`: το ΙΔΙΟ `scripts/run_all_verifications.sh` που το project
    τρέχει χειροκίνητα από τη Φάση 15, τώρα πάνω σε `postgres:16` service
    container αντί για την τοπική εγκατάσταση αυτού του sandbox. Τα logs
    των eyeball-verified SQL scripts ανεβαίνουν ως build artifact για
    ανθρώπινη επιθεώρηση, όχι σιωπηλή εμπιστοσύνη.
  - `build`: πραγματικό `next build` για `apps/web` και `apps/admin`.
    Σκόπιμα ΔΕΝ περιλαμβάνει το `apps/mobile` (Expo/EAS builds χρειάζονται
    λογαριασμό, native toolchain, εκτός απλού CI) -- το δικό του
    `typecheck` καλύπτεται στο πρώτο job.
- **`.github/workflows/deploy.yml`** (νέο): ενεργοποιείται ΜΟΝΟ αφού το CI
  περάσει στο `main` (`workflow_run`, όχι δεύτερο ανεξάρτητο trigger) --
  ένα deploy δεν μπορεί ποτέ να τρέξει πάνω σε κώδικα που δεν πέρασε
  lint/typecheck/db-verify/build. Εφαρμόζει migrations (`supabase db push`)
  και κάνει deploy όλα τα Edge Functions (`supabase functions deploy`).
  Σκόπιμα ΔΕΝ ξαναθέτει τα secrets των Edge Functions σε κάθε deploy (δες
  παρακάτω).
- **`scripts/run_all_verifications.sh` / `scripts/verify_phase15_concurrency.sh`
  ενημερώθηκαν** για dual-mode λειτουργία: το ίδιο script τρέχει είτε
  τοπικά σε αυτό το sandbox (`sudo -u postgres psql`) είτε σε CI πάνω σε
  TCP-συνδεδεμένο `postgres:16` container (απλό `psql` που διαβάζει
  PGHOST/PGUSER/PGPASSWORD) -- η παρουσία του `PGHOST` env var είναι το
  σήμα αλλαγής mode. Καμία διπλή λογική σε δύο μέρη, το ίδιο ακριβώς
  script.
- **`apps/web/app/api/health/route.ts`** (νέο): πραγματικό, testable
  health-check endpoint -- κάνει μία φθηνή, πραγματική ερώτηση στη βάση
  (`select id from restaurants ... head:true`, πάνω στην ήδη υπάρχουσα
  δημόσια RLS policy της Φάσης 08) και επιστρέφει 200/503. Το μοναδικό
  κομμάτι "monitoring" που μπορεί να χτιστεί ΚΑΙ να δοκιμαστεί πραγματικά
  σε αυτό το sandbox χωρίς ζωντανό λογαριασμό.
- **`supabase/config.toml`** (νέο): config για το Supabase CLI (project
  ref placeholder, ρυθμίσεις ανά Edge Function). Σημαντικό: `verify_jwt =
  false` ρητά μόνο για `stripe-webhook`/`voice-webhook` -- οι δύο functions
  που καλούνται από εξωτερικό πάροχο (Stripe, Twilio) χωρίς Supabase
  session, με δική τους ανεξάρτητη επαλήθευση υπογραφής. Λάθος κατεύθυνση
  σε αυτό είναι πραγματικό, γνωστό Supabase πρόβλημα -- είτε απορρίπτει
  ΚΑΘΕ πραγματικό webhook με 401 πριν καν φτάσει στον δικό του έλεγχο,
  είτε ανοίγει μια function σε ανώνυμη κλήση ένα επίπεδο πριν τον δικό της
  εσωτερικό έλεγχο.
- **`scripts/verify_phase17_deployment.mjs`** (νέο, πραγματική εκτέλεση):
  YAML syntax και των δύο workflows (μέσω πραγματικού parser, PyYAML),
  TOML syntax του `config.toml` (μέσω `tomllib`), αυτοματοποιημένη
  αντιστοίχιση ΚΑΘΕ φακέλου function στο `supabase/functions/` με το δικό
  του `[functions.X]` block, επιβεβαίωση ότι ΜΟΝΟ οι δύο webhook functions
  έχουν `verify_jwt = false`, και -- το πιο χρήσιμο εύρημα -- αυτόματος
  έλεγχος ότι ΚΑΘΕ env var που πραγματικά διαβάζεται από τον κώδικα
  (grep σε `Deno.env.get()`/`process.env.` σε όλο το repo) τεκμηριώνεται
  κάπου σε `.env.example`.
- **`.env.example` (root) ενημερώθηκε**: το `verify_phase17_deployment.mjs`
  βρήκε ότι `TWILIO_AUTH_TOKEN`, `ANTHROPIC_MODEL_SMALL`,
  `ANTHROPIC_MODEL_LARGE` διαβάζονται πραγματικά από κώδικα (Φάσεις 10, 11)
  αλλά ΔΕΝ ήταν τεκμηριωμένα πουθενά -- πραγματικό, μικρό αλλά πραγματικό
  κενό τεκμηρίωσης, διορθώθηκε. Προστέθηκε επίσης πίνακας με τα GitHub
  repository secrets που χρειάζεται το `deploy.yml`.

### Deployment runbook (πρώτη πραγματική παραγωγική έναρξη)

1. **Δημιουργία πραγματικού GitHub repository** και `git push` του commit
   ιστορικού που ξεκίνησε αυτή η φάση (`git remote add origin ...`, `git
   push -u origin main`) -- δεν έγινε εδώ, χρειάζεται πραγματικό λογαριασμό
   εκτός αυτού του sandbox.
2. **Supabase**: δημιουργία νέου production project. Ενημέρωση του
   `project_id` στο `supabase/config.toml` με το πραγματικό project ref.
   Εφαρμογή migrations με `supabase db push` (ή αφήνοντας το `deploy.yml`
   να το κάνει στο πρώτο πραγματικό merge σε `main`) -- ΠΟΤΕ το
   `supabase/seed.sql`: περιέχει fake demo δεδομένα με hardcoded UUIDs
   (Αθήνα/Μόναχο), σωστό μόνο για local dev/CI. Πραγματικά εστιατόρια
   (τα 2-3 pilot) εγγράφονται μέσω του πραγματικού `bootstrap-restaurant`
   flow (Φάση 04), όχι seed data.
3. **Edge Function secrets**, μία φορά, χειροκίνητα: `supabase secrets set
   ANTHROPIC_API_KEY=... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=...
   TWILIO_AUTH_TOKEN=...`. Σκόπιμα ΕΚΤΟΣ του `deploy.yml` -- δες το δικό
   του header comment για το γιατί (θα ήταν τρόπος να αποθηκευτεί μια
   ξεπερασμένη τιμή στο GitHub Actions history και να αντικαταστήσει
   σιωπηλά μια χειροκίνητα ανανεωμένη μυστική τιμή).
4. **GitHub repository secrets** (Settings -> Secrets and variables ->
   Actions, ιδανικά κάτω από ένα "production" environment με required
   reviewers): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
   `SUPABASE_DB_PASSWORD` -- πλήρης λίστα και πού βρίσκεται η κάθε τιμή
   στο `.env.example`.
5. **Vercel**: δύο ξεχωριστά Vercel projects, ένα ανά Next.js app
   (`apps/web`, `apps/admin`), συνδεδεμένα στο ίδιο GitHub repo μέσω του
   ΔΙΚΟΥ ΤΟΥ native GitHub integration του Vercel -- ΟΧΙ ένα ξεχωριστό
   βήμα μέσα στο `ci.yml`/`deploy.yml`. Σκόπιμη επιλογή: το Vercel ήδη
   κάνει build+deploy+preview-per-PR+custom-domain+SSL αυτόματα μόλις
   συνδεθεί το repo -- αναδημιουργία αυτού μέσα σε GitHub Actions θα ήταν
   διπλή συντήρηση για μηδενικό πραγματικό όφελος. Env vars (per project,
   Vercel dashboard): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, και για το `apps/web` επιπλέον
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
6. **Custom domain + SSL**: Vercel dashboard, ανά project -- αυτόματο
   μόλις προστεθεί το domain, καμία επιπλέον ρύθμιση.
7. **apps/mobile**: παραμένει εκτός production deploy pipeline -- δεν
   υπάρχει λογαριασμός Apple Developer ακόμα (γνωστός περιορισμός από την
   αρχή του project), οπότε το Web/PWA (Φάση 14) είναι η πραγματική
   παραγωγική επιφάνεια για τώρα. Ένα πραγματικό EAS Build/Submit pipeline
   είναι λογικό follow-up μόλις υπάρξει λογαριασμός.

### Backup / rollback στρατηγική

Καμία migration σε αυτό το project (0001-0021) δεν έχει το αντίστοιχο
"down" της -- forward-only, ίδια σύμβαση με το πώς γράφτηκαν εξαρχής. Αυτό
σημαίνει ότι ένα πραγματικό production rollback ΔΕΝ είναι "τρέξε την
αντίστροφη migration" (δεν υπάρχει) -- είναι restore από πραγματικό Supabase
backup (Point-in-Time Recovery σε paid tier, ή το πιο πρόσφατο daily backup
στο free tier). Αυτό είναι ρητή, έντιμη αρχιτεκτονική παραδοχή, όχι κρυφό
κενό: μια κακή migration σε production σημαίνει πραγματική απώλεια δεδομένων
μεταξύ του backup point και της αποκατάστασης, όχι στιγμιαία αναίρεση. Για
τα 2-3 pilot εστιατόρια, αυτό είναι αποδεκτό ρίσκο σε αυτή την κλίμακα --
θα άξιζε επανεξέταση (π.χ. γραπτές down-migrations, staging environment πριν
από κάθε production deploy) πριν από μεγαλύτερη κλίμακα.

### Σημαντικές αρχιτεκτονικές αποφάσεις

- **Vercel's native GitHub integration αντί για custom deploy step στο
  GitHub Actions για τα Next.js apps.** Λιγότερος κώδικας να συντηρείται,
  ίδιο αποτέλεσμα, και το Vercel ήδη λύνει preview deployments ανά PR
  δωρεάν -- κάτι που θα έπρεπε να ξαναχτιστεί χειροκίνητα αλλιώς.
- **Το `deploy.yml` δεν ξαναθέτει secrets σε κάθε τρέξιμο.** Θα ήταν
  εύκολο (και λάθος) να προστεθεί ένα `supabase secrets set` βήμα "για να
  είναι πάντα ενημερωμένο" -- αυτό θα σήμαινε ότι η πραγματική μυστική
  τιμή πρέπει ούτως ή άλλως να ζει σαν GitHub secret, και ένα deploy θα
  μπορούσε σιωπηλά να αντικαταστήσει μια χειροκίνητα rotated τιμή με μια
  παλιά.
- **`run_all_verifications.sh`/`verify_phase15_concurrency.sh` έγιναν
  dual-mode αντί να γραφτεί ξεχωριστή λογική στο YAML.** Η εναλλακτική
  (να ξαναγραφτούν όλα τα βήματα rebuild+verify απευθείας μέσα στο
  `ci.yml`) θα σήμαινε δύο μέρη να μένουν συγχρονισμένα χειροκίνητα κάθε
  φορά που προστίθεται νέο verify script -- ήδη ξέχασα να το κάνω αυτό
  κάποια στιγμή σε προηγούμενη φάση, δεν άξιζε το ρίσκο ξανά.
- **`verify_phase17_deployment.mjs`'s env-var cross-check είναι το πιο
  αξιόλογο εύρημα της φάσης**: ένα πραγματικό, μικρό κενό τεκμηρίωσης
  (3 env vars) που ΔΕΝ θα είχε προσεχθεί με απλή ανθρώπινη ανάγνωση --
  ακριβώς το είδος ελέγχου που αξίζει να είναι αυτοματοποιημένο, όχι μια
  φορά σωστό.

### Τι ΔΕΝ χτίστηκε (σκόπιμα)

- **Κανένα πραγματικό deploy.** Ούτε ένα `git push` σε πραγματικό remote,
  ούτε ένα `supabase link`, ούτε ένα Vercel project -- κανένα δίκτυο σε
  αυτό το sandbox. Ό,τι χτίστηκε είναι πραγματικός, reviewable κώδικας
  στο σχήμα που περιμένει το κάθε εργαλείο, ποτέ εκτελεσμένος έξω από
  αυτό το sandbox.
- **Κανένα Sentry / error tracking.** Θα χρειαζόταν πραγματικό DSN/
  λογαριασμό. Το `/api/health` endpoint είναι το μόνο πραγματικό,
  testable κομμάτι monitoring που χτίστηκε εδώ· Sentry, Vercel
  Analytics/Speed Insights, το ενσωματωμένο dashboard του Supabase, και
  τα δικά τους dashboards Stripe/Twilio μένουν τεκμηριωμένα ως το επόμενο
  βήμα, όχι wired up.
- **Κανένα staging environment.** Το project έχει μόνο "local sandbox" και
  "production" σήμερα -- ένα ενδιάμεσο staging Supabase project/Vercel
  preview environment θα ήταν λογικό επόμενο βήμα πριν το πρώτο πραγματικό
  production deploy, ειδικά δεδομένης της "forward-only migrations, καμία
  αυτόματη rollback" πραγματικότητας παραπάνω.
- **Κανένα EAS Build/Submit για apps/mobile.** Χρειάζεται λογαριασμό Apple
  Developer, ρητά εκτός εύρους μέχρι να υπάρξει (γνωστός περιορισμός από
  την αρχή του project).
- **Κανένα rate limiting/WAF σε επίπεδο πλατφόρμας (π.χ. Cloudflare).** Το
  project έχει ήδη εφαρμοσμένο application-level rate limiting στο
  `book_public_reservation` (Φάση 08) -- ένα CDN/WAF layer είναι
  ορθογώνιο, πιθανό follow-up.

### Τι επαληθεύτηκε πραγματικά εδώ (και τι όχι)

✅ Επαληθεύτηκε με πραγματική εκτέλεση:
- Πραγματικό `git init` + commit -- υπαρκτό, ελεγμένο ιστορικό.
- `scripts/verify_phase17_deployment.mjs`: 21 checks πέρασαν -- πραγματικό
  YAML/TOML parsing (όχι regex), αντιστοίχιση κάθε function σε
  `config.toml`, σωστό `verify_jwt` και στις 9 functions, και το
  env-var-πληρότητας εύρημα.
- `.github/workflows/ci.yml`/`deploy.yml`: valid YAML, δομημένα σύμφωνα
  με τη δημόσια τεκμηρίωση GitHub Actions/Supabase CLI/Vercel -- ΔΕΝ
  εκτελέστηκαν σε πραγματικό runner.
- `apps/web/app/api/health/route.ts`: περνάει το ίδιο syntax check με
  κάθε άλλο αρχείο του project (127 αρχεία συνολικά τώρα).
- **Ολόκληρη η προηγούμενη σουίτα (Φάσεις 04-16) ξανατρέχτηκε** μέσα από
  το ενημερωμένο, dual-mode `run_all_verifications.sh` -- μηδέν
  regressions, 8/8 exit-code-checked scripts OK.

⚠️ **Δεν μπόρεσα να επαληθεύσω εδώ**:
- Ότι το `ci.yml`/`deploy.yml` πραγματικά τρέχουν επιτυχώς σε πραγματικό
  GitHub Actions runner -- απαιτεί πραγματικό repository + push, εκτός
  αυτού του sandbox.
- Ότι το `supabase db push`/`supabase functions deploy` πραγματικά
  δουλεύουν έναντι ζωντανού production project -- απαιτεί πραγματικό
  λογαριασμό Supabase + access token.
- Ότι το `/api/health` endpoint επιστρέφει σωστά αποτελέσματα έναντι
  ζωντανής βάσης -- η λογική ελέγχθηκε (syntax + επισκόπηση), όχι
  εκτελέστηκε έναντι πραγματικού Supabase project.
- Ότι το Vercel native integration συμπεριφέρεται όπως τεκμηριώνεται εδώ
  σε πραγματικό deploy -- βασισμένο σε δημόσια τεκμηρίωση Vercel, όχι σε
  πραγματική δοκιμή.
