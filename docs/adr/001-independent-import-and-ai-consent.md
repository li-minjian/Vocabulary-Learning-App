# ADR 001 — Independent import workflows and explicit AI

Status: Accepted / implemented. Date: 2026-11-01.

Context: Article Import calls AI for extraction. File Import accepts supplied
structured vocabulary and must not inherit article-page enrichment effects.
VOCA-RQ-005, VOCA-RQ-008–012 and the two Notion PRDs require zero implicit AI.

Decision: Give File Import its own route/blueprint/service. Share existing
Vocabulary and Collection models. Dictionary lookup has no AI fallback. Put AI
requests behind clear click handlers; remove Article Step 3's mount-time enrichment.

Rationale: A miss, blank translation or malformed input does not imply consent.
An independent path makes the rule testable at both HTTP and provider boundaries.

Alternative: Reusing article Steps 1–3 would inherit unsuitable extraction and
enrichment semantics. A shared workflow framework is unnecessary for two flows.

Consequences: Users can save blank meanings. Article extraction and enrichment
remain available explicitly. Tests must assert zero requests before AI actions.

Implementation: `frontend/src/app/screens/FileImport.tsx`, `ImportStep3.tsx`,
`components/DictionaryPanel.tsx`; `backend/routes/file_import.py`, `dictionary.py`.
Evidence: unit/API zero-model tests and Playwright intercepted requests.
