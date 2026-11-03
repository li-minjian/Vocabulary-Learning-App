# Exercise import, practice and review

Exercises are a separate learning domain. Existing vocabulary, vocabulary reviews,
Reading & Typing and secure 50 MiB GCS uploads keep their current owners.

## Ownership and persistence

The additive migration `20261103000000_exercises.sql` creates:

- `exercise_sets`: owner, title, source filename/digest and optional Collection.
- `exercises`: one study card, native source identity, structured text document,
  content hash, source order/category/unit/deck and current progress.
- `exercise_attempts`: submitted answers, server feedback, reveal flag, explicit
  rating and timestamps; unique per exercise/session for safe retries.
- `exercise_sessions`: bounded (1–200) exercise ID snapshot, filters, position and
  active/finished/ended state, allowing another browser/device to resume.

Composite `(id,user_id)` foreign keys prevent cross-owner set, exercise and attempt
relationships. All four tables have owner-scoped RLS for SELECT/INSERT/UPDATE/DELETE.
The existing per-request JWT client and explicit owner predicates remain in use.
No service-role client or auth bypass is introduced. The invoker-rights
`record_exercise_attempt` function locks the session and exercise, records an answer
once, updates progress, and advances/rates once in one transaction. Anonymous access
and function execution are revoked. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

`file_parser` preserves native card IDs, ordinals and individual deck relationships.
`import_semantics` remains the single owner of structured cloze interpretation and
answer normalization. `exercise_service` validates destinations, verifies saved
content, reconciles duplicates, owns queues and submits checked results to the atomic
transaction. The frontend projection remains in `importMapping`, not a second parser.

## Import and supported meaning

In `/import/files`, exercise groups offer **Save as Exercises**, independently of the
explicit optional conversion into Vocabulary. Existing source-card mapping controls
feed the exercise preview. Each cloze variant blanks only its own index; repeated
blanks at that index remain distinct inputs with separate expected answers and hints.
Other indices display their completed context, as native cloze variants do. Native
card identities determine granularity; a note can produce several study cards.

Preview reports notes, source cards, new study cards, unchanged records, conflicts and
unsupported source rows. Select an existing set or name a new one; a new set uses the
selected Collection. Existing sets retain their Collection (shown explicitly).
The set is created only on confirmation. Commits freeze the checked documents into
100-item batches, use owner/native-note/card UUID identities, and verify exact saved
content and destination. Lost responses reconcile on retry. Unchanged imports preserve
attempts/SRS; changed content is reported as a conflict and is never overwritten.
Unsupported items are excluded and identified. Successful saving opens the set with
actual result counts and a prominent practice action.

No Anki scheduling is imported. Media and scripts are not executed or loaded. All
source text is rendered as React text, not HTML. Raw source and provenance remain in
the exercise document; numeric Id never becomes a Vocabulary word.

### Verified private acceptance case

The original Exercises APKG was read privately using its actual `collection.anki21`.
It has 545 notes/cards, one grammar type, and yields **545 structured study cards**
with no unsupported cloze records in the verified source. Of these, 502 have one
blank and 43 have multiple blanks. All 545 were saved to a real isolated PostgreSQL
DB in bounded batches and every resulting document was compared to its source
projection. Question, expected answers, Rubric, Choices, Category/Unit, tags, source
deck and native note/card identities survive. There is no independent Explanation
field; none is fabricated. Fifty cards disclose source media warnings. Saving these cards requires explicit
confirmation that their text is sufficient; the API also enforces this consent. The original is never committed, included in
public screenshots or automatically imported into production.

## Library, practice and review

`/exercises` shows sets, separate counts, practiced/due numbers and last activity.
`/exercises/:setId` supports browsing/pagination, category/unit/deck filters, details,
attempt history, rename and confirmed deletion. Collection pages show independent
Vocabulary/Exercise counts and links to the sets. Deleting a Collection detaches the
set without deleting exercises. Deleting a set/item cascades its attempts, never
Vocabulary. Sessions referencing a removed item explain that the session must end;
submitted results for remaining exercises remain saved.

Start a new/all/due queue with 1–200 items. Cloze answers use separate labeled inputs;
Enter checks where appropriate. Expected answers, completed text and explanations
are absent from the practice response until check/reveal. Checking immediately saves
the answer and feedback; refreshing before rating restores them. Users choose
Again/Hard/Good/Easy explicitly to schedule and move on. Pause resumes the same saved
session; completed exercises can be revisited read-only. End/restart and result
summaries preserve submitted answers. Accuracy includes auto-checked responses only;
revealed/self-assessed and skipped responses never become automatically correct.

Answer matching applies Unicode NFC, case folding, trimming and repeated-whitespace
normalization. Punctuation, accents and word order remain significant. No semantic/AI
synonym grading. Explicit JSON arrays in an exported Answer field represent accepted
alternatives; slash-separated text is not guessed to do so. Multiple choice is enabled
only for a source JSON string-array of distinct options containing the declared answer(s).
Unstructured Choices remain optional text hints. Question/answer cards whose grading
is uncertain use reveal and self-assess.

The small exercise scheduler follows the existing vocabulary interval convention:
Hard/Good/Easy = 1/3/5 days × attempts; Again = 10 minutes. This transaction does not
change vocabulary scheduling. Skipping does not add a practice attempt or mark a new
item due. Attempt history and session position persist server-side across devices.

## Limits and unsupported Anki features

This is not full Anki replay. Nested/malformed cloze, missing answers and ambiguous
native ordinals are explicitly held for review. Multiple non-cloze templates need
card-side interpretation and are not silently cloned into misleading cards. Modern
protobuf-only template metadata, custom JavaScript grading/layout, media playback and
Anki scheduling remain unsupported. Standard cloze native variants and mapped single
question/answer cards are supported; uncertain grading has a self-assessment path.

Existing archive/SQLite/process budgets remain; at most 32 variants per note, 10,000
study items per import and 100 per commit. Controls are capped at 12 MiB, study text
20,000 characters per field, 64 answers of at most 2,000 characters. Library reads are
paged and bounded; exceeding a view limit reports an error rather than false counts.

## Verification and release procedure

Tests use a separate local PostgreSQL with real RLS/constraints/transactions; the
HTTP/browser fixture replaces only external Auth/PostgREST dependencies locally.
It is never imported by production. The private original is opt-in:

```sh
cd backend
VOCA_EXERCISE_POSTGRES=1 VOCA_PRIVATE_APKG=/private/path/Exercises.apkg \
  .venv/bin/python -m unittest discover -s tests/unit -p test_exercises.py -q
```

`tests/utils/exercise_db.py` targets the named disposable local DB; use
`VOCA_EXERCISE_TEST_DSN` only for an isolated test database. Browser E2E uses generated
synthetic APKGs and real Flask/exercise/PostgreSQL operations. No private questions
appear in screenshot artifacts. Production acceptance must use non-destructive checks
or a dedicated identity; the user performs the final original-file import.

Before production migration, the live public schema was inspected. A private schema
SQL backup was restored successfully to a fresh local DB (9 tables, 31 policies),
with hashes recorded privately. Automatic review rejected a broad business-data
export; no business rows were exported. Existing table counts and words content digest
are recorded for before/after comparison. The migration only adds new objects and
is compatible with the old application. Do not replay the historical initial schema.
Apply this file alone, stage backend at zero traffic, verify auth/health/contracts,
then promote and release frontend. Rollback switches to the previous backend and
Vercel deployment; retain the additive exercise tables and user study data.
