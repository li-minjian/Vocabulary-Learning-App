"""Installed, read-only dictionaries. Lookup never imports an AI or HTTP client."""
from copy import deepcopy
from contextlib import closing
from functools import lru_cache
import json
from pathlib import Path
import re
import sqlite3
import unicodedata

DEFAULT_DATABASE = Path(__file__).resolve().parents[1] / "data/dictionary/dictionary.sqlite3"
LANGUAGES = {"english": "English", "en": "English", "german": "German", "de": "German"}


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).casefold().split())


def language_name(language):
    if not isinstance(language, str) or language.casefold() not in LANGUAGES:
        raise ValueError("Local dictionary supports English and German")
    return LANGUAGES[language.casefold()]


def _candidates(key, language):
    # Guesses are used only after dataset-supplied forms, and must hit a real entry.
    if language == "English":
        if key.endswith("ies"):
            yield key[:-3] + "y"
        for ending in ("ing", "ed", "es", "s", "er", "est"):
            if key.endswith(ending) and len(key) > len(ending) + 2:
                stem = key[:-len(ending)]
                yield stem
                yield stem + "e"
                if len(stem) > 2 and stem[-1] == stem[-2]:
                    yield stem[:-1]


def _read_entry(connection, key, language):
    rows = connection.execute(
        "SELECT data FROM entries WHERE language=? AND key=? ORDER BY id LIMIT 12",
        (language, key),
    ).fetchall()
    if not rows:
        return None
    entries = [json.loads(row[0]) for row in rows]
    result = entries[0]
    result["definitions"] = list(dict.fromkeys(d for e in entries for d in e.get("definitions", [])))[:30]
    result["sources"] = list({e["source"]["name"]: e["source"] for e in entries}.values())
    result["pos"] = ", ".join(dict.fromkeys(e.get("pos", "") for e in entries if e.get("pos")))
    result["collocations"] = list(dict.fromkeys(c for e in entries for c in e.get("collocations", [])))[:15]
    return result


@lru_cache(maxsize=2048)
def _lookup_cached(database, revision, key, language):
    # revision invalidates both hits and misses after an atomic dictionary install.
    with closing(sqlite3.connect(Path(database).as_uri() + "?mode=ro", uri=True)) as connection:
        entry = _read_entry(connection, key, language)
        resolution = "exact"
        if not entry:
            forms = connection.execute(
                "SELECT lemma FROM forms WHERE language=? AND key=? LIMIT 12", (language, key)
            ).fetchall()
            for form in forms:
                entry = _read_entry(connection, form[0], language)
                if entry:
                    resolution = "form"
                    break
        if not entry:
            for candidate in _candidates(key, language):
                entry = _read_entry(connection, candidate, language)
                if entry:
                    resolution = "suffix"
                    break
        if entry:
            if normalize(entry["lemma"]) != key:
                lemma_entry = _read_entry(connection, normalize(entry["lemma"]), language)
                if lemma_entry:
                    entry["definitions"] = list(dict.fromkeys(entry["definitions"] + lemma_entry["definitions"]))[:30]
                    if not entry["translation"]:
                        entry["translation"] = lemma_entry["translation"]
            phrase_key = normalize(entry["lemma"])
            phrases = connection.execute(
                "SELECT word FROM entries WHERE language=? AND key>=? AND key<? "
                "ORDER BY length(key), key LIMIT 12",
                (language, phrase_key + " ", phrase_key + " \uffff"),
            ).fetchall()
            entry["collocations"] = list(dict.fromkeys(entry["collocations"] + [p[0] for p in phrases]))[:15]
            return {**entry, "found": True, "resolution": resolution, "installed": True}
    return {"found": False, "installed": True, "resolution": "miss"}


class DictionaryResolver:
    def __init__(self, database=DEFAULT_DATABASE):
        self.database = Path(database).resolve()

    def lookup(self, query, language="English"):
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise ValueError("Query must contain between 1 and 200 characters")
        language = language_name(language)
        key = normalize(query)
        while key and unicodedata.category(key[0]).startswith("P"):
            key = key[1:]
        while key and unicodedata.category(key[-1]).startswith("P"):
            key = key[:-1]
        base = {"query": query, "language": language, "lemma": query, "word": query,
                "ipa": "", "pos": "", "translation": "", "definitions": [],
                "collocations": [], "sources": [], "source": None, "cached": False}
        if not self.database.is_file():
            return {**base, "found": False, "installed": False, "resolution": "miss",
                    "message": "Not found in local dictionary",
                    "notice": "Local dictionary is not installed. Run backend/scripts/install_dictionary.py."}
        stat = self.database.stat()
        before = _lookup_cached.cache_info().hits
        result = deepcopy(_lookup_cached(str(self.database), (stat.st_mtime_ns, stat.st_size), key, language))
        result = {**base, **result, "cached": _lookup_cached.cache_info().hits > before}
        if not result["found"]:
            result["message"] = "Not found in local dictionary"
        return result

    def phrase_spans(self, text, language="English"):
        """Longest dictionary phrases at precise Python/Unicode character offsets."""
        language = language_name(language)
        if not isinstance(text, str) or len(text) > 20000:
            raise ValueError("Text must be at most 20000 characters")
        if not self.database.is_file():
            return []
        tokens = list(re.finditer(r"[^\W_]+(?:['’\-][^\W_]+)*", text, re.UNICODE))
        candidates = {}
        for start in range(len(tokens)):
            for count in range(2, min(6, len(tokens) - start + 1)):
                selected = tokens[start:start + count]
                original = text[selected[0].start():selected[-1].end()]
                if any(not text[a.end():b.start()].isspace() for a, b in zip(selected, selected[1:])):
                    continue
                key = normalize(original)
                candidates.setdefault(key, []).append((selected[0].start(), selected[-1].end(), original))
        matches = []
        with closing(sqlite3.connect(self.database.as_uri() + "?mode=ro", uri=True)) as connection:
            keys = list(candidates)
            for offset in range(0, len(keys), 400):
                part = keys[offset:offset + 400]
                placeholders = ",".join("?" for _ in part)
                for row in connection.execute(
                    f"SELECT DISTINCT key FROM entries WHERE language=? AND key IN ({placeholders})", [language, *part]
                ):
                    matches.extend({"start": s, "end": e, "text": original} for s, e, original in candidates[row[0]])
        # Prefer longest span; each article position belongs to one phrase.
        selected = []
        for span in sorted(matches, key=lambda s: (-(s["end"] - s["start"]), s["start"])):
            if not any(span["start"] < old["end"] and span["end"] > old["start"] for old in selected):
                selected.append(span)
        return sorted(selected, key=lambda s: s["start"])


resolver = DictionaryResolver()
