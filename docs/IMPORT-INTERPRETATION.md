# File interpretation and live preview

This documents the PR #11 vocabulary-conversion contract. The subsequent
[Exercise learning domain](EXERCISES.md) adds independent Save as Exercises,
persistence, practice and review; exercise groups are no longer limited to preview.

The existing `/import/files` workflow now reads structure, suggests an interpretation,
and displays editable learning cards before any vocabulary is saved. Secure 50 MiB
uploads, generation checks, parser subprocess budgets, authentication, Collection
ownership, duplicate handling and 100-row verified writes are reused unchanged.
No AI calls, new upload service, schema, RLS or authentication changes are involved.

## Source evidence and supported meaning

A private read of the original Exercises APKG on 2026-11-03 selected its actual
`collection.anki21`, rather than the compatibility placeholder `collection.anki2`.
It contains one note type, “English Grammar In Use Exercises”, type 1, 545 notes,
545 native cards and 23 deck definitions. Every Question contains cloze markup.
Id is a numeric identifier; Category/Unit provide context; Rubric is an instruction;
Choices supplies hints/options; answers are embedded in Question. Image/Audio and
AudioText are optional media/transcript fields. There is no separate Explanation
field. Front/back templates reference these fields and use custom JavaScript.
No private question, answer, deck name, template code or source binary is published.

The previous flattening discarded note-type/template provenance and stripped
cloze markers before interpretation. Name aliases alone could neither recover the
question/answer relationship nor distinguish choices from translations.

VOCA now provides a safe text interpretation: cloze question, correct answer(s),
completed text, instructions, available explanation, context and source deck.
It does not run Anki JavaScript, load remote resources, replay media, reproduce
Anki grading or import scheduling. Multiple native cards remain one source note;
combined cloze blanks are a note-level preview, not separate imported words.

## Ownership and contract

- `services/file_parser.py` owns bounded archive/SQLite extraction, safe text,
  original cloze markers, note/deck relationships, note-type field order and
  front/back template references. Templates are summarized, never executed or
  sent as executable HTML. Existing flattened rows remain available, augmented
  by groups and aligned note provenance.
- `services/import_semantics.py` is the single classifier. It combines names,
  native template sides/filters, sampled values across the file, length/sentence
  shape, writing systems, numeric patterns and explicit cloze markers. Suggestions
  contain a role, rule confidence, reason and sampled evidence. Ambiguous required
  mappings stay unresolved; unrelated confident suggestions remain intact.
- `groups` carries independent fields, row numbers, native card count, template
  metadata and analysis per note type. Derived cloze columns retain an origin
  pointer. `provenance` identifies the source note/group without duplicating notes
  for each card. Technical IDs are shown only in Advanced/report data.
- `lib/importMapping.ts:projectRow` owns the frontend projection used by both the
  live vocabulary card and the request. It uses backend-provided canonical column
  pointers instead of implementing another cloze interpreter/classifier.
- `file_import_service` validates ownership/content/conversion, derives stable
  import IDs, preserves existing SRS and verifies saved critical fields and
  collection_id. Source-note provenance travels through requests and reports and
  contributes to deterministic IDs. Full native Anki notes/templates are not
  stored in a new persistence model.

CSV/TSV/TXT use the same preview and value analysis, with their own format parsing.
Ordinary Word/Translation/Example headers map automatically. Native front/back
references plus short terms and a different-script back support custom cards;
same-script term/definition pairs are suggested as notes instead of assuming a
translation. Low-evidence content requires a focused correction.

## Interaction and confirmation

Upload → automatic summary → example cards → optional pencil controls → Collection
→ normalized final preview → explicit import. Text delimiter/header options are
collapsed and hidden for APKG. Card controls update locally without another upload
or parsing pass. Samples span the file and include missing/unusually long content.
Groups have independent mappings and inclusion. Unmapped source fields are listed;
Advanced exposes source text, confidence evidence, references, IDs and row numbers.

Exercise, cloze, question-answer and sentence translation groups default to preview
only. Explicit conversion consent enables a proposed vocabulary card, whose Word
still requires a deliberate meaningful source choice. Answer is never silently
assigned to Word. The server also rejects exercise conversion without confirmation;
raw/nested cloze cannot be silently stripped into vocabulary. Full exercise import
needs a separate product/persistence model and is not part of this release.

Pending/failed Collection creation blocks confirmation; a valid returned UUID
becomes the destination. No silent Library-root fallback. Mapping, inclusion,
language, duplicate-policy or Collection changes invalidate confirmation. An
in-flight stale preview response is ignored. Final cards display the normalized
server preview produced by the same preparation function used by commit. The
frozen payload remains identical across 100-row batches. Parse/preview do not
write vocabulary. Users see invalid/skipped/failed statuses, not HTTP-200 success
claims. No production library reset or automatic original-file reimport occurs.

## Boundaries

This is deterministic, explainable recognition, not comprehensive Anki compatibility.
Writing-system/sentence heuristics can be uncertain; the preview and confirmation
remain necessary. Modern protobuf-only template configuration is not decoded;
when unavailable, the UI states that template metadata is unavailable. Nested or
multiple cloze fields and custom scripts cannot be faithfully replayed. Original
text remains visible, and unsupported raw cloze conversion is rejected. Source
media, scheduling, full exercise behavior and per-native-card persistence are out
of scope. Existing archive, 100 MiB SQLite, 10,000-row, 64-source-column and result
size/CPU/memory limits still apply; derived columns do not expand those budgets.

## Tests and private fixture use

`tests/unit/test_import_semantics.py` covers standard/custom/mixed note types,
cloze/hints, native multiple cards, sentence translation, HTML/script exclusion,
CSV/TSV/TXT, ambiguity, numeric IDs, malformed templates, optional private source
checks and real isolated SQLite persistence/consent/retry tests. The shared test
SQLite adapter models the existing per-user unique tag constraint; this creates no
production index or migration. `semantic-import.spec.ts` uses generated synthetic
APKGs, never personal file content, for public screenshots and browser tests.

Private original check (no private text in assertions/output):

```bash
cd backend
VOCA_PRIVATE_APKG=/private/path/Exercises.apkg .venv/bin/python -m unittest discover \
  -s tests/unit -p 'test_import_semantics.py' -q
```

The Import Hub keeps its existing layout; its two controls are prominent actions,
without the Ready badge. Vocabulary management replaces duplicate Import Text
buttons; the selection toolbar appears only when entries are selected, and a
selection-reset message appears only after an actual selected-filter change.
