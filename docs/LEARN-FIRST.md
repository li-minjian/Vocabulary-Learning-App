# Learn-first VOCA

Implemented 2026-11-04. Production release evidence is recorded separately in
`docs/qa/learn-first-release-2026-11-04.json`; implementation alone does not prove
an authenticated production write path.

## Navigation and ownership

The same responsive navigation renders **Dashboard → Import → Learn → Library →
Statistics → Settings**. `lib/navigation.ts` classifies session routes before
content routes: `/exercises/session/:id`, `/review/*` and `/practice/*` belong to
Learn; exercise/word/Collection management belongs to Library.

- Import acquires content; parsing, mapping, consent and persistence stay in their
  existing services. No new AI calls or import backend.
- Learn selects a method and configuration; selecting controls performs reads only.
- Library manages Vocabulary, Exercises and Articles. Its `type` and `collection`
  query parameters survive tab changes, refresh and browser history.
- Statistics aggregates actual domain data in PostgreSQL. Historical daily
  vocabulary activity before receipts, duration and mastery snapshots are
  unavailable; the previous fabricated activity/accuracy charts were removed.

Vocabulary and Exercise Set collection IDs remain authoritative. All/Unassigned
and owned Collections share one selector. Articles have no Collection membership;
that control is disabled, explained and retained when switching back to other tabs.
Manage Collections uses existing CRUD; renaming now has a visible control.
Deleting a Collection retains the existing vocabulary guard and detaches Exercise
Sets through the existing FK, preserving their exercises and attempts.

## Learn methods

- Reading & Typing selects an existing article, shows browser-local progress and
  opens the unchanged typing engine/dictionary. Article capture stays at `/practice`
  and uses the secure 50 MiB uploader. The shared article list is reused there and
  in Library. Saving an article opens Learn with its ID selected.
- Exercises selects Collection, Set, Category, Unit, source deck, All/New and a
  size of 1–200. It calls the existing session/answer/rating APIs; server sessions
  can resume on another device. Library keeps browsing/management and contextual
  Learn links, rather than a competing practice configuration form.
- Review selects Mixed/Vocabulary/Exercises and a total size of 1–200. Vocabulary
  formats are hidden for Exercises Only. Database aggregation gives uncapped,
  owner-scoped counts. The compatibility checkbox separately includes eligible
  unscheduled vocabulary, including new words.
- Vocabulary Recall uses the existing flashcard/multiple-choice/spelling UI.
  Receipts record voluntary practice; **mastery, review_count and next_review are
  unchanged**. A meaningful practice receipt makes a word no longer New.

Deep links include `method=exercises&set=ID&unit=Unit+1`,
`method=review&scope=exercises`, `method=typing&article=ID` and
`method=vocabulary&collection=ID`. Explicit URL context wins over the optional
remembered method. Unavailable owned content blocks Start; changing Collection
clears dependent exercise filters. Session recovery uses the saved session's
settings and never silently substitutes another Collection.

## New, due and SRS

| Domain | New | Scheduled due | Voluntary practice |
| --- | --- | --- | --- |
| Vocabulary | review_count is zero and no practice/review receipt | review_count > 0 and next_review <= now; previously reviewed legacy null timestamps stay eligible | receipt only, no SRS mutation |
| Exercises | total_attempts = 0 (skips excluded) | total_attempts > 0 and next_review <= now; studied legacy null timestamps stay eligible | existing explicit answer + rating updates the exercise schedule |

Unreviewed vocabulary with a null/arrived timestamp is shown separately as
**unscheduled**, including new words; it remains available through Review's
explicit compatibility checkbox (on by default). No historical row is rewritten.
545 newly imported exercises therefore mean Total 545, New 545, Due 0.

Vocabulary review keeps its prior policy: Again now; Hard/Good/Easy 1/3/5 days ×
new review_count. The atomic receipt RPC is its single scheduling owner. Exercise
SRS remains the existing `record_exercise_attempt` RPC: Again 10 minutes, otherwise
1/3/5 days × attempts; Skip is not meaningful study. UTC timestamptz comparisons
use database now(); calendar statistics use the browser's IANA time zone.

## Mixed Review and recovery

Mixed Review is one sequential workflow: vocabulary, then an existing server
exercise session, then a shared result page. When both domains are available,
vocabulary receives up to half the configured total (rounded up), leaving room
for exercises. If vocabulary is scarce, exercises use the remaining capacity.
A size of one can include only one item. A single available domain works alone.

Only a small versioned, per-user browser checkpoint stores queue IDs,
configuration, exercise-session ID and phase. It does not copy content or own SRS.
Vocabulary receipts and exercise attempts stay on the server. Stable session/word
identities and a word row lock make response-loss/concurrent retries update SRS
once. Queue restoration is one bounded owner-scoped request (not one request per
word). Missing/deleted queue content produces an explicit error.

Vocabulary queues and the mixed sequence resume in the **same browser**. Exercise
answers, position and pending rating resume from the server. Typing retains its
existing per-user/per-article browser state. No cross-device typing or complete
mixed-workflow synchronization is claimed.

Results query persisted records after saving. Objective correct/incorrect answers,
revealed/self-assessed cards, Again/Hard and skipped exercises are distinct.
Flashcard ratings are not objective correctness; the first spelling/choice
response determines objective results. Multiple Choice needs distinct alternatives;
a single available word explicitly falls back to Flashcard. There is no combined
accuracy across typing, vocabulary self-assessment and exercise checking.

## Additive data change and release order

`20261104000000_learning.sql` adds one vocabulary receipt table, owner RLS,
atomic review/practice receipt RPC, scoped queue/count functions and grouped
Exercise Set summaries. Existing tables, auth and RLS are retained. The existing
private vocabulary backup/restore includes the new child records; older backup
manifests restore with an empty new receipt table only when no conflicting new
history exists. Receipts cannot be updated; explicit owner content deletion and
verified recovery remain possible.

Before production migration: capture a fresh schema-only backup and old-table
counts/digests; restore that schema plus the migration in an isolated local DB.
No production business rows are exported or replayed. Apply only the additive
migration, compare old-table digests, deploy backend to a no-traffic revision,
check health/auth/compatibility, promote backend, then merge/deploy frontend.
Never replay `initial_schema.sql`; no automatic startup migration.

Code rollback uses the prior Cloud Run revision and Vercel deployment recorded in
the release JSON. Keep additive receipts/functions in place; rolling back code
must not drop new learning history. No destructive down migration is required.

## Verification

Run backend tests with `PYTHONPATH=backend`. Real SQL tests opt in with
`VOCA_LEARN_POSTGRES=1`, `VOCA_EXERCISE_POSTGRES=1` and the guarded disposable
loopback `VOCA_EXERCISE_TEST_DSN`. The adapter rejects remote/non-test database
names. `tests/e2e/seed_learning.py` creates only public synthetic fixtures.
Playwright uses an isolated local auth service; it is not a production bypass.
No original APKG is reimported into production and no user progress is changed for
acceptance testing.

Automated coverage includes responsive navigation, contextual settings,
Collection persistence/unavailable scopes, typing resume/dictionary, exercise
answers/rating/reload, all review scopes, mixed results, vocabulary formats,
response-loss retry, 545 new exercises, >100 due words, UTC/local-calendar
boundaries, RLS isolation, receipt backup/restore and existing import/upload tests.
Exact results, production read-only evidence and remaining acceptance gaps belong
in the release record. No dedicated production identity is available; do not
claim authenticated production learning writes were tested.

Antigravity was not invoked: the connected SQL, code and browser checks provided
direct evidence, and delegating another overlapping audit would add coordination
without reducing this focused integration work. No new dependencies were added.

Existing bounds remain: 1–200 items/session, up to 200 listed saved articles,
up to 10,000 exercises per set view/import. These are not total due-count caps.
