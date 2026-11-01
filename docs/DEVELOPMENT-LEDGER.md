# VOCA development ledger

Date: 2026-11-01. Scope: web platform upgrade, no production deployment/merge.
Branch: `codex/voca-platform-upgrade`. Baseline:
`30f343f8494e7066c1defd374810017c4ac9da5e` (remote `main` and Vercel production).

## Repository protection

The configured path had been renamed to `AI-Vocabulary-Learning-App`. The original
checkout is on `planning/iphone-mobile-app`, ten mobile-only commits ahead of main,
with 24 modified tracked files and additional untracked work. Web/backend tracked
code at its HEAD matches main; its uncommitted Login/auth changes are unrelated.
Those changes were left in place, not included in this branch. A local tracked
binary diff and full status inventory were saved under
`/private/tmp/voca-upgrade-recovery/`; original untracked files remain untouched.
A separate non-hardlinked clone at the configured workspace path isolates this work.
No checkout/reset/stash/clean or history rewrite was applied to the original.

## Requirement coverage

| Requirement | Implementation/evidence | Status |
| --- | --- | --- |
| RQ-001 inline typing | Pure Unicode engine; real keyboard correction, resume/restart, paragraphs, long-source scroll | Implemented; local tests pass |
| RQ-002 sidebar and expressions | Responsive dictionary sidebar, current word, phrase positions/selection | Implemented; fixture browser pass |
| RQ-003 click lookup | Installed dictionary hit and save to Vocabulary; no lost position | Implemented; fixture browser pass |
| RQ-004 local resolver | 770,611 English + 371,793 German source records; exact/form/suffix/cache/provenance | Implemented; installed-data and unit checks pass |
| RQ-005 explicit AI | No automatic fallback; click-only Ask AI; Article Step3 mount enrichment removed | Provider assertions + intercepted request checks pass |
| RQ-006 forms/collocations | Dataset inflections and longest span matches; forms/phrase/cache tests | Implemented; tests pass |
| RQ-007 integration | Existing imported_text, Vocabulary/Collections/Review; separate local typing Statistics | Implemented; fixture persistence and regression pass |
| RQ-008 CSV/TSV/TXT | BOM, Unicode, quoting/multiline, directives, headers/delimiters | 24 import tests include format cases |
| RQ-009 mapping/selection | Language, collocations, examples, tags, notes and other fields; selected rows | Implemented; fixture browser pass |
| RQ-010 duplicates | Skip/keep-both; safe retry, no user/SRS overwrite | Unit/API tests pass; concurrent-distinct-job uniqueness not guaranteed |
| RQ-011 collections/batches | Ownership check, batch<=100, 1,001-row retry test, per-row failure/repair | Implemented; fixture browser + unit tests pass |
| RQ-012 APKG | Legacy/modern zstd notes/decks; safe ZIP/SQLite/plain HTML | Generated-format fixtures pass; no universal deck/media/scheduling claim |
| Living architecture | ARCHITECTURE.md, 4 ADRs, AGENTS navigation | Updated against inspected source |
| Figma recovery | 16 screens +4 states preserved as native recovery sections | Recovery complete; fidelity pass ongoing separately |
| Live production auth/RLS/persistence | Dedicated test credentials unavailable; schema metadata request unauthorized | Blocked/unverified; production untouched |

## Verification executed

- `cd backend && .venv/bin/python -m unittest discover -s tests/unit -v`:
  **35 passed** (articles/auth gate 3, dictionary 8, import 24).
- `cd frontend && npm test`: **7 passed** (Unicode, correction/mistake history,
  fast input, punctuation/newlines, bounds, corrupt/stale progress).
- `npm run typecheck`: **passed** across application and tests.
- `npm run build`: **passed**; existing large-bundle and mixed static/dynamic API
  import warnings remain. No build failure is hidden.
- `npm run test:e2e`: **6 passed** in system Chrome with real React/Flask routes,
  loopback-only auth/storage doubles and the actual installed dictionary.
  Coverage: unauthenticated protection; upload/mapping/collection/duplicates/invalid
  rows/results; keyboard errors/backspace/paragraph/completion/resume/restart;
  dictionary provenance/save/dedup; no per-keystroke requests; zero AI before explicit
  Ask AI; mobile upload/library/article overflow; CRUD, collection reload, SRS,
  JSON/CSV exports; 16-screen gallery; long-article fast input and caret scrolling.
- Python compilation: **passed** for backend routes/services/installer and launcher.
- `git diff --check`: **passed**.
- `npm audit fix` after compatible Vite6/Router7/Supabase2 updates: **0 advisories**;
  final `npm audit --omit=dev`: **0 advisories**.
- Secret scan: changed/new text reviewed; only deliberately public local fixture
  password matched the assignment pattern. No real credentials/env files included.
- Read-only public Supabase auth settings: **HTTP200** for existing frontend/backend
  config. OpenAPI schema request: **HTTP401**, so live schema remains unverified.

Test evidence is local/fixture evidence. Tests do not establish deployed RLS, Google
OAuth or production data integrity. Existing live E2E scripts need dedicated
`E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`; no personal JWT was requested.

## Defects found and repaired

- File Import blueprint incorrectly rejected unauthenticated OPTIONS preflight;
  actual browser upload exposed it, and a regression test now covers it.
- Existing Review multiple-choice placeholder branch called `.slice()` on the
  numeric return of `.push()`, fixed without changing scheduling semantics.
- Existing Supabase UUID/type/date/example rendering inconsistencies prevented
  TypeScript checks; corrected the contracts and safe rendering.
- Word Detail and Collection Detail depended on navigation state after refresh;
  route IDs now load persisted details, covered by direct-route fixture screenshots.
- Historical Import Hub fabricated recent imports; replaced with actual article
  library navigation rather than inventing import history.

## Visual evidence

Playwright generated 16 existing-screen gallery images and new-feature desktop/
mobile screenshots under `frontend/test-results/`. Screens are actual rendered
React using explicitly synthetic test data, not live authenticated user captures.
Representative durable captures:

- [Typing and local dictionary](qa/typing-dictionary-desktop.png)
- [Field mapping and row selection](qa/file-import-mapping-desktop.png)
- [Mobile file upload](qa/file-import-mobile.png)

See `FIGMA-QA.md` for Figma node links, structural evidence and comparison limits.
Exact production pixel fidelity and target-folder placement must remain unverified
where tools/evidence cannot establish them.

## Limits and acceptance boundary

- No production deploy, migration, RLS/auth change, env modification or main merge.
- Browser-local latest-attempt typing progress; no cross-device history.
- Skip or keep-both conflicts; no selective overwrite, Anki media or scheduling.
- Existing Statistics' historical recall charts/accuracy include placeholders; new
  copy metrics are measured and explicitly separate.
- Current dictionary has substantial storage and upstream license/provenance
  constraints documented in DICTIONARY.md. New clones must run its installer.
- Live authenticated Supabase and complete live Figma pixel comparisons are not
  completed without dedicated credentials; do not label the whole assignment Verified.

## Checkpoints

Implementation checkpoint: pending Git commit/push after reviewed staged diff.
Final QA/Figma/Notion checkpoint: pending. Commit IDs are recorded by the final
follow-up documentation checkpoint, rather than embedding a commit's own hash.
