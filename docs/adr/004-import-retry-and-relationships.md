# ADR 004 — Safe import retries without a new jobs schema

Status: Accepted / implemented. Date: 2026-11-01.

Context: Large imports write words and child relations across PostgREST requests.
Lost responses/partial failures must not duplicate words or reset personal/SRS data.
The existing schema has one collection per word and no normalized unique key.

Decision: Use stable import identity plus user/effective language/row data to derive
word UUIDs. Use insert-on-conflict-do-nothing, reconcile saved IDs, deterministic
child IDs and retry repairs. Batch at most 100 words. Check collection ownership.
Skip normalized word+language duplicates by default; explicit keep-both preserves
separate entries. Support selecting rows before confirmation.

Rationale: Existing entities can satisfy ordinary retries without a new job store
or production migration. Per-row statuses expose partial relation failures.

Alternatives: Sequential client createWord calls cannot safely reconcile uncertain
writes. Upserting existing word fields risks silent user/SRS overwrites. A normalized
uniqueness migration and transactional RPC are future schema choices requiring review.

Consequences: Multiple independent concurrent import IDs can race on semantic
duplicates; same-identity retries remain idempotent. No selective merge/overwrite,
media import or Anki scheduling migration is claimed. Relations are repairable,
not one atomic transaction. Malformed archives/HTML stay outside execution.

Implementation: `backend/services/file_import_service.py`, `file_parser.py`,
`frontend/src/app/screens/FileImport.tsx`; 1,001-row batch/retry regression test.
