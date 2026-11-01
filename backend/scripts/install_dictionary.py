#!/usr/bin/env python3
"""Build VOCA's local dictionary index from public source data, using only stdlib.

python backend/scripts/install_dictionary.py --download
python backend/scripts/install_dictionary.py --ecdict path.csv --kaikki path.jsonl.gz
"""
import argparse
from contextlib import closing
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.dictionary_service import DEFAULT_DATABASE, normalize

ECDICT_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
KAIKKI_URL = "https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz"
SOURCES = {
    "ECDICT": {"name": "ECDICT", "url": "https://github.com/skywind3000/ECDICT",
               "license": "MIT (upstream repository)", "license_url": "https://github.com/skywind3000/ECDICT/blob/master/LICENSE"},
    "Kaikki / Wiktionary": {"name": "Kaikki / Wiktionary", "url": "https://kaikki.org/dictionary/German/",
                            "license": "CC BY-SA 4.0 / GFDL", "license_url": "https://en.wiktionary.org/wiki/Wiktionary:Copyrights"},
}


def source_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, destination):
    destination = Path(destination)
    if destination.is_file():
        return destination
    temporary = destination.with_name(destination.name + ".download")
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as output:
        size = 0
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            size += len(chunk)
            if size > 512 * 1024 * 1024:
                raise ValueError("Dictionary source download exceeds 512 MiB")
            output.write(chunk)
    temporary.replace(destination)
    return destination


def create_schema(connection):
    connection.executescript("""
        CREATE TABLE entries (id INTEGER PRIMARY KEY, language TEXT NOT NULL, key TEXT NOT NULL,
                              word TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE forms (language TEXT NOT NULL, key TEXT NOT NULL, lemma TEXT NOT NULL,
                            PRIMARY KEY(language,key,lemma)) WITHOUT ROWID;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)


def add_entry(connection, language, word, lemma, ipa, pos, translation, definitions, collocations, source):
    if not word or len(word) > 200:
        return False
    data = {"word": word, "lemma": lemma or word, "ipa": ipa or "", "pos": pos or "",
            "translation": translation or "", "definitions": definitions[:30],
            "collocations": collocations[:15], "source": SOURCES[source]}
    connection.execute("INSERT INTO entries(language,key,word,data) VALUES (?,?,?,?)",
                       (language, normalize(word), word, json.dumps(data, ensure_ascii=False)))
    return True


def add_form(connection, language, form, lemma):
    if form and lemma and len(form) <= 200 and normalize(form) != normalize(lemma):
        connection.execute("INSERT OR IGNORE INTO forms VALUES (?,?,?)", (language, normalize(form), normalize(lemma)))


def install_ecdict(connection, path):
    count = 0
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not {"word", "translation", "definition"}.issubset(reader.fieldnames or []):
            raise ValueError("Not an ECDICT CSV: word, translation, definition columns are required")
        for row in reader:
            exchanges = dict(item.split(":", 1) for item in row.get("exchange", "").split("/") if ":" in item)
            word = row["word"]
            lemma = exchanges.get("0", word)
            count += add_entry(connection, "English", word, lemma, row.get("phonetic"), row.get("pos"),
                               row.get("translation", "").replace("\\n", "\n"),
                               row.get("definition", "").replace("\\n", "\n").splitlines(), [], "ECDICT")
            for code, forms in exchanges.items():
                if code in {"p", "d", "i", "3", "r", "t", "s"}:
                    for form in forms.split("/"):
                        add_form(connection, "English", form, word)
            add_form(connection, "English", word, lemma)
    return count


def install_kaikki(connection, path):
    count = 0
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as source:
        for line in source:
            entry = json.loads(line)
            if entry.get("lang_code") != "de":
                continue
            word = entry.get("word", "")
            definitions, lemmas = [], []
            for sense in entry.get("senses", []):
                definitions.extend(sense.get("glosses", []))
                lemmas.extend(item["word"] for item in sense.get("form_of", []) if item.get("word"))
            lemma = lemmas[0] if lemmas else word
            sounds = [sound["ipa"] for sound in entry.get("sounds", []) if sound.get("ipa")]
            translations = [item.get("word", "") for item in entry.get("translations", []) if item.get("lang_code") == "zh"]
            phrases = [item["word"] for field in ("derived", "related", "forms") for item in entry.get(field, [])
                       if item.get("word") and " " in item["word"]]
            count += add_entry(connection, "German", word, lemma, sounds[0] if sounds else "", entry.get("pos"),
                               "; ".join(dict.fromkeys(translations)), definitions, list(dict.fromkeys(phrases)), "Kaikki / Wiktionary")
            for form in entry.get("forms", []):
                if isinstance(form.get("form"), str):
                    add_form(connection, "German", form["form"], word)
            for target in lemmas:
                add_form(connection, "German", word, target)
    return count


def build_dictionary(destination, ecdict=None, kaikki=None):
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix="dictionary-install-", suffix=".sqlite3", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    counts, sources = {}, {}
    try:
        with closing(sqlite3.connect(temporary)) as connection:
            create_schema(connection)
            for label, path, installer, url in (("ECDICT", ecdict, install_ecdict, ECDICT_URL),
                                               ("Kaikki / Wiktionary", kaikki, install_kaikki, KAIKKI_URL)):
                if path:
                    counts[label] = installer(connection, path)
                    sources[label] = {**SOURCES[label], "download_url": url, "sha256": source_hash(path), "records": counts[label]}
            connection.execute("CREATE INDEX entries_lookup ON entries(language,key)")
            connection.execute("INSERT INTO metadata VALUES ('sources', ?)", (json.dumps(sources, ensure_ascii=False),))
            connection.commit()
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Dictionary integrity check failed")
        manifest = {"installed_at": datetime.now(timezone.utc).isoformat(), "sources": sources,
                    "database_sha256": source_hash(temporary), "counts": counts}
        temporary.replace(destination)
        destination.with_suffix(".manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return manifest
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Explicitly download the public source datasets")
    parser.add_argument("--ecdict", type=Path)
    parser.add_argument("--kaikki", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_DATABASE)
    arguments = parser.parse_args()
    if arguments.download:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.ecdict = arguments.ecdict or download(ECDICT_URL, arguments.output.parent / "ecdict.csv")
        arguments.kaikki = arguments.kaikki or download(KAIKKI_URL, arguments.output.parent / "german.jsonl.gz")
    if not arguments.ecdict and not arguments.kaikki:
        parser.error("Provide --download or --ecdict and/or --kaikki source paths")
    manifest = build_dictionary(arguments.output, arguments.ecdict, arguments.kaikki)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
