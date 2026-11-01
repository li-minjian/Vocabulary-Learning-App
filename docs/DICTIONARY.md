# Local dictionary

Implemented in `backend/services/dictionary_service.py`, exposed through authenticated
`GET /api/dictionary?q=...&language=English|German` and
`POST /api/dictionary/phrases` (`text`, `language`). Ordinary lookup never requests AI
or downloads data. A miss returns `found: false`, `Not found in local dictionary`.
The separate **Ask AI** click in `DictionaryPanel` uses the existing explicit AI API.

## Dataset decision — 2026-11-01

| Source | Useful coverage | Decision and constraints |
| --- | --- | --- |
| [ECDICT](https://github.com/skywind3000/ECDICT) | English headwords, Chinese translations, English definitions, IPA, explicit irregular/inflected forms, multiword entries | Installed full public base CSV. Upstream repository declares MIT; its README describes aggregation from several historical dictionaries. Attribution retained; upstream quality/provenance is imperfect. This is a personal-use installation, not a claim that every historical source has been independently rights-cleared. |
| [Kaikki German / Wiktionary](https://kaikki.org/dictionary/German/) | German headwords and inflections, English glosses, IPA, related expressions | Installed complete German export from English Wiktionary. Chinese translations only where the export supplies them; no automatic translation. Attribution and [Wiktionary licenses](https://en.wiktionary.org/wiki/Wiktionary:Copyrights) retained (CC BY-SA / GFDL; current CC BY-SA 4.0). |
| [Open English WordNet](https://en-word.net/downloads) | Structured English senses and lexical relations; current 2025 JSON archive about 9.5 MB compressed | Evaluated; not installed. ECDICT already supplies English glosses/Chinese translations; adding a third sense owner is unnecessary for this milestone. [CC BY 4.0 plus Princeton attribution](https://github.com/globalwordnet/english-wordnet/blob/main/LICENSE.md). No German or Chinese translation coverage claimed. |

The index is disposable derived data, separate from Supabase user vocabulary and SRS.
Installation never changes user data or Supabase schema. SQLite is used only as the
installed dictionary's indexed file format, not as a second application database.

## Install and reproduce

Python standard library only; run from the project root:

```bash
python3 backend/scripts/install_dictionary.py --download
```

This is an explicit maintenance command with network access. The web server does
not run it. Downloads reuse existing source files; remove/rename those files yourself
when deliberately refreshing the snapshots. Build a new index without network access:

```bash
python3 backend/scripts/install_dictionary.py \
  --ecdict backend/data/dictionary/ecdict.csv \
  --kaikki backend/data/dictionary/german.jsonl.gz
```

Index path: `backend/data/dictionary/dictionary.sqlite3`. Source files, index, and
generated manifest should be ignored by Git. Each successful install validates SQLite
integrity, atomically replaces the derived index, and writes
`dictionary.manifest.json` with source URLs, SHA-256 hashes and record counts. A failed
build leaves the prior index intact. Runtime connections use SQLite `mode=ro` and close
after each uncached query. Missing/corrupt installations show a clear miss/error.

The verified local installation contains **770,611 English records** and **371,793
German records**, including separate senses/word forms. These are record counts,
not distinct headword or accuracy measurements. Snapshot hashes:

- ECDICT CSV: `d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`
- German JSONL.gz: `e16ea346863a1d0bc9e0533f83015b3847ec8b0a065ad2620b76a19bb005b520`

Upstream download URLs change over time; retain the source files and compare these
hashes to reproduce this exact snapshot. No claim of immutable upstream releases.

## Resolution, phrases, cache

1. Bounded in-memory cache (2,048 entries), keyed by normalized query, language,
   dictionary path and file revision. Cache is process-local and contains public
   dictionary results only; it contains no user vocabulary, article context or AI output.
2. Indexed exact lookup, including multiword expressions.
3. Dataset-derived inflection/lemma mapping (including German forms).
4. Conservative English suffix candidates only when they resolve to installed entries.
5. Clear local miss. No remote or AI fallback.

Lookups expose lemma, pronunciation, part of speech, available translations, multiple
definitions, related expressions and source licenses. Phrase lookup considers 2–5-token
ngrams up to 20,000 characters, returns precise spans, and selects longer overlapping
phrases first. Punctuation between words prevents a false phrase match. API positions
count Unicode code points, matching the typing renderer's `Array.from(text)` indexing.
`findDictionaryPhrases` preserves those offsets. There is no per-keystroke dictionary requirement.

`DictionaryPanel` keeps typing ownership outside the panel, cancels obsolete local
requests, labels AI output, and checks existing words before saving. Saving appends a
new Vocabulary item with context; it never edits an existing item's translations or
SRS. The existing words API has no unique word/language constraint, so a concurrent
save from multiple clients can still race. Existing vocabulary API pagination behavior
also limits the frontend duplicate precheck; do not infer a database uniqueness guarantee.

## Verification

From `backend` with project Python dependencies installed:

```bash
python -m unittest discover -s tests/unit -p test_dictionary.py -v
```

Eight tests cover multiple senses/Unicode/attribution, English irregular and German
umlaut forms, exact phrases and longest spans, cache isolation, immutable runtime,
missing/corrupt installation, API validation, and actual dictionary requests with
outbound networking blocked and AI provider call counters asserted zero. Root E2E
verification additionally owns authentication and browser consent interaction evidence.
