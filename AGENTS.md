# AGENTS.md

## Project Agent Workflow

This repository uses reusable AI-agent skills for safer development.

Start by reading `docs/ARCHITECTURE.md`, then relevant PRDs and `docs/adr/`.
It is the living navigation reference; current verified source and Git state remain authoritative.

For bug fixing, regressions, unfinished UI behavior, API issues, database relationship bugs, and deployment issues, use:

- `docs/skills/test-fix-verify-report.md`

For authenticated automated tests, use:

- `docs/skills/e2e-test-auth.md`

Before committing AI-generated changes, use:

- `docs/skills/pre-commit-audit.md`

---

## Default Development Rule

Do not blindly edit code.

Default workflow:

1. Investigate
2. Report root cause and minimal fix plan
3. Apply smallest safe fix after approval
4. Verify
5. Report
6. Commit only after explicit approval

---

## Global Safety Rules

- Do not run `rm -rf`.
- Do not run `git reset --hard`.
- Do not run `git clean`.
- Do not run `sudo`.
- Do not run destructive database commands.
- Do not ask for personal JWT tokens.
- Do not print tokens, passwords, service keys, database URLs, or client secrets.
- Do not modify `.env` files unless explicitly approved.
- Do not install dependencies without asking first.
- Do not change database schema, RLS, auth, or deployment config without explicit approval.
- Do not commit or push without explicit approval.

---

## Short Invocation Prompts

### Bug Fix

```text
Use docs/skills/test-fix-verify-report.md.

Issue:
[describe issue]

Start with Phase 1 only.
Do not modify code before reporting root cause and minimal fix plan.
```

### Authenticated E2E Test

```text
Use docs/skills/e2e-test-auth.md.

Run an authenticated E2E test with the dedicated test account from local environment variables.
Do not ask for personal JWT.
Do not print secrets.
Use isolated test data and clean it up safely.
```

### Pre-Commit Audit

```text
Use docs/skills/pre-commit-audit.md.

Do not modify code, stage, commit, or push.
Inspect the current diff, run safe checks, scan for secrets, and report whether it is safe to commit.
```
