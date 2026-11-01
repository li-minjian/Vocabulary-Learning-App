# ADR 003 — Article storage and browser typing ownership

Status: Accepted / implemented. Date: 2026-11-01.

Context: Existing article import carries text through route state; typing needs
recoverable articles and progress. Input must not depend on per-key/word requests,
and copy accuracy must remain distinct from active recall (VOCA-RQ-001/002/007).

Decision: Reuse existing user-owned `imported_text` for whole articles. Add
authenticated list/get/create APIs, with deterministic content IDs for safe create
retries. Keep pure typing input/metrics in the browser and versioned progress in
user/article localStorage. Derive Statistics' copy summary from those owners.

Rationale: No new database/schema or duplicate article store is necessary. Source
fingerprints reject stale progress. Unicode code-point spans unify article selection,
character rendering and backend phrase matches. Idle time is not counted indefinitely.

Alternatives: A separate article text area undermines the requested experience.
Server keystroke persistence adds latency and unnecessary writes. Updating SRS on
correct transcription incorrectly treats copying as recall.

Consequences: Articles use existing RLS; deployed schema remains separately
unverified. Progress is browser-local/latest attempt, not cross-device history.
Saved vocabulary retains context text rather than a new article-word relationship.

Implementation: `backend/routes/articles.py`, `frontend/src/lib/typingEngine.ts`,
`app/components/ArticleTypingSurface.tsx`, `app/screens/TypingPractice.tsx`.
