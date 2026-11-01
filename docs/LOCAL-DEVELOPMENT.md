# Local development and acceptance

This feature checkout is `/Users/min/Desktop/playground/AI Vocabulary Learning App`.
The original configured checkout, including uncommitted mobile/auth work, remains
at `/Users/min/Desktop/playground/AI-Vocabulary-Learning-App`. No secret files were
copied, edited or committed. The launcher can read existing configuration into each
child process without changing either checkout's environment files.

From the feature checkout, run these in **two terminals**:

```bash
cd "/Users/min/Desktop/playground/AI Vocabulary Learning App"
backend/.venv/bin/python scripts/dev.py backend \
  --config-root "/Users/min/Desktop/playground/AI-Vocabulary-Learning-App"
```

```bash
cd "/Users/min/Desktop/playground/AI Vocabulary Learning App"
backend/.venv/bin/python scripts/dev.py frontend \
  --config-root "/Users/min/Desktop/playground/AI-Vocabulary-Learning-App"
```

Open [local VOCA](http://localhost:5173). Backend health:
[health](http://127.0.0.1:5001/api/health). Use existing normal login. Actual account
data uses the configured Supabase installation; production deployment/schema/RLS
are unchanged. The local installed dictionary is already present in this checkout.

A fresh clone installs dependencies and dictionaries:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
python3 backend/scripts/install_dictionary.py --download
```

Use an existing configuration root or approved local config. Do not copy secrets
into source or VITE-prefixed test-password variables. No personal JWT is needed.

Automated isolated verification:

```bash
cd "/Users/min/Desktop/playground/AI Vocabulary Learning App/backend"
.venv/bin/python -m unittest discover -s tests/unit -v
cd ../frontend
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright starts loopback fixture servers and system Chrome itself. Stop normal
local servers on port 5173 first. Fixture auth/data live only in test processes;
no real Supabase account or model is contacted. Screenshots under
`frontend/test-results/` are fixture UI evidence, not production account captures.

Acceptance checklist:

- Sign in normally; open Dashboard, Vocabulary and Collections.
- Import CSV/TSV/Anki TXT/APKG via **Import → File & List Import**; check mapping,
  Unicode, selected rows, collection, duplicates, results and retry.
- Open **Reading & Typing**, save an article, type in the original text, correct a
  mistake, pause/reload/resume and restart. Check copy metrics separately from SRS.
- Click a word/phrase; inspect source, local meanings/forms, save Vocabulary and
  verify Review. Unknown meanings show a local miss. Only **Ask AI** requests AI.
- Article Import still supports explicit AI analysis and optional explicit enrichment.
  **Save for Reading & Typing** avoids AI analysis.
- Inspect Statistics' separate browser-local typing summary and mobile layouts.

Live Google login, deployed schema/RLS, real authenticated data persistence and full
Figma pixel comparison remain unverified without a dedicated test account. This is
an external verification gap, not a claim that fixture tests prove production behavior.
