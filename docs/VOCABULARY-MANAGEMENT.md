# Import integrity and vocabulary management

File upload completion only means parsing succeeded. Before importing, verify the
Word, Translation and other mappings and the displayed destination. Recognized,
unambiguous column names are suggested; column positions are never guessed.
Unknown/repeated names require manual mapping. Numeric Word values require a
separate explicit confirmation. First-row detection requires two recognized
header cells; use First row → Column headers for custom headers. Source rows
remain selectable; uneven columns are flagged. Anki field names/ordering remain
intact, including metadata-name collisions and repeated custom fields.

A pending new Collection name blocks preview until creation succeeds or the name
is cleared. A successful returned UUID becomes the selected destination. Preview
shows evenly spaced samples across the complete file, mapped fields, destination
and duplicate status. Skip compares word + language across the entire account;
it never relocates existing words. Keep both creates new IDs at the chosen
destination. Neither overwrites existing vocabulary or SRS. Each write batch
re-reads mapped word fields and collection_id; unverified/mismatched rows fail
and retain their stable import identity for reconciliation.

Library row checkboxes select stable IDs. The header selects only the current
page and displays partial selection; use the explicit “Select all N matching
filters” action to include other pages. Selection survives pagination and resets
when filters change. Batch deletion requires confirmation, sends sequential
batches of at most 200 IDs, and refreshes/reconciles the library. A partial result
keeps remaining IDs selected; after an uncertain response refresh before retrying.
Collection counts, Review, Dashboard and Statistics refresh on navigation and
management events, including other tabs.

## Clear and recovery

Vocabulary management (three-dot button) → Clear entire Vocabulary Library →
Back up & inspect my library. The server authenticates the current account using
the existing Supabase JWT. It never accepts a target user ID or uses a service
role. It reads actual authenticated PostgREST foreign-key metadata. Unknown
word-dependent tables block deletion. OpenAPI does not expose ON DELETE actions:
all four discovered dependent tables are cleaned explicitly and checked, so the
operation does not rely on the historical migration's CASCADE assumptions. The
historical initial migration must never be run against an existing database.

The backup includes every column returned by `*` in words (including IDs,
collection assignments and all SRS fields), examples, collocations, synonyms,
word_tags, and snapshots of the preserved collections, imported_text and tags.
Reads are user-scoped, deterministically paginated, bounded to 250,000 records per
table and 100 MiB per backup; a second complete read must match. Backup ownership,
relation ownership and SHA-256 are checked. The original JSON is saved/read back
in the existing private upload bucket under `voca/backups/<owner-hash>/<uuid>.json`.
This prefix is outside `voca/tmp/` expiry. Public access prevention and uniform
bucket access are required, and incompatible deletion lifecycle rules block use.
No new bucket, IAM role, database table, migration or AI service is needed.
Local development uses the existing private local store, files mode 0600.

Download the private backup from the dialog and store it securely. The dialog
shows total words, Collections containing words, relation counts, timestamp and
checksum. Type exactly `DELETE ALL VOCABULARY` and confirm. Each authenticated
clear request handles at most 1,000 snapshot IDs in batches of 200. It verifies
unchanged surviving rows and preserved content before deletion; new/edited words
or relations and changed Collections/Articles/tags require a fresh backup.
A per-account conditional GCS lock serializes management and file-import commits
across Cloud Run instances. There is no automatic expiry of a destructive lock:
a crashed request requires operator inspection before removing that exact lock.
No other user or account-wide administrator reset is exposed.

Writes use explicit user predicates and IDs. Child rows are deleted and verified
before their words. Each response includes verified removed/remaining counts and
preservation status. Zero words and zero child rows, plus unchanged preserved
content, are required for `complete=true`. Partial clear is visible and can retry
using the same backup. This is reconciled REST work, not a cross-table SQL
transaction. Uncoordinated external database writers cannot be transactionally
locked; pre/post checks detect changed state, and only backed-up IDs are eligible
for deletion. The UI must not claim empty success after an incomplete response.
Collections, Articles, account/settings, other accounts and dictionary data are
never deletion targets. Review/SRS state is stored in words and included in backup.

API (existing authentication required):

- `POST /api/vocabulary-management/batch-delete` with `{ids}` (1–200 unique UUIDs).
  All must be visible and owned before any deletion. Missing/foreign IDs reject
  the entire request; refresh after partial/uncertain responses before retrying.
- `POST /api/vocabulary-management/clear/prepare` creates/verifies a private backup.
- `GET /api/vocabulary-management/backups/<backup_id>` downloads only the current
  owner's backup; response is `Cache-Control: no-store`.
- `POST /api/vocabulary-management/clear` with `{backup_id, confirmation}` uses the
  exact typed phrase and returns reconciled counts. Repeat until `complete=true`.
- Recovery: authenticated `POST /api/vocabulary-management/backups/<backup_id>/restore`
  with `{confirmation: "RESTORE VOCABULARY"}` inserts original IDs and complete
  SRS/child rows in bounded batches, verifies the original checksum, and supports
  retry. Preserved records must match; any divergent current vocabulary requires
  a reviewed merge rather than overwriting it. The local downloaded JSON is an
  additional recovery copy; never paste its private contents into logs or Git.

Safe logs contain backup UUID, owner-hashed location, counts, timestamps, checksums,
metadata table names and result flags, never vocabulary text/JWTs. Actual production
backup and reset are only established by a successful logged-in browser operation
and the corresponding server verification logs. Isolated tests are not evidence
that a real account was cleared.
