# ADR 002 — Installed dictionary data and cache ownership

Status: Accepted / implemented. Date: 2026-11-01.

Context: VOCA-RQ-003/004/006 require reusable English/German lookup, forms,
phrases and available Chinese translations without automatic AI or a new service.

Decision: Install complete ECDICT CSV plus Kaikki German export into a generated
read-only SQLite dictionary index. Use a bounded revision-aware resolver cache,
then exact/form/suffix resolution and a clear miss. Keep installation explicit.

Rationale: ECDICT supplies English/Chinese fields; Kaikki adds German and forms.
The indexed file makes local queries practical without another user-data owner.
Source/license metadata travels with results. See `docs/DICTIONARY.md` for exact
sources, licensing caveats, counts/hashes and reproducible installation.

Alternatives: OEWN adds structured English senses but duplicates current coverage
and has no German/Chinese translations. Remote runtime lookups add availability
and privacy dependencies. Automatically asking AI violates the accepted boundary.

Consequences: Index/downloads are sizable and Git-ignored; fresh clones run the
installer. German Chinese translations are incomplete. Public lookup cache is
process-local and contains no personal context; explicit AI results stay in UI state.

Deployment addition, 2026-11-02: [ADR 005](005-build-time-dictionary-artifact.md)
pins the existing snapshot as a verified build-time artifact for clean containers.
The source installer remains an explicit maintenance/development tool; production
never downloads mutable upstream sources or rebuilds at startup.

Implementation: `backend/services/dictionary_service.py`,
`backend/scripts/install_dictionary.py`, `frontend/src/lib/dictionary.ts`.
