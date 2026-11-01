import csv
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask
from routes.dictionary import dictionary_bp
from scripts.install_dictionary import build_dictionary
from services.dictionary_service import DictionaryResolver, _lookup_cached


class DictionaryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        directory = Path(self.directory.name)
        self.database = directory / "dictionary.sqlite3"
        self.csv = directory / "source.csv"
        self.german = directory / "source.jsonl"
        with self.csv.open("w", newline="", encoding="utf-8") as output:
            writer = csv.DictWriter(output, fieldnames=["word", "phonetic", "definition", "translation", "pos", "exchange"])
            writer.writeheader()
            for row in [
                {"word": "run", "phonetic": "rʌn", "definition": "move quickly\\noperate", "translation": "跑；运行", "pos": "verb", "exchange": "p:ran/i:running"},
                {"word": "take", "definition": "get into one's possession", "translation": "拿", "exchange": "p:took/d:taken"},
                {"word": "take off", "definition": "depart from the ground", "translation": "起飞", "pos": "verb"},
                {"word": "take off again", "definition": "test longer phrase", "translation": "再次起飞", "pos": "phrase"},
            ]:
                writer.writerow(row)
        self.german.write_text(json.dumps({"word": "Haus", "lang_code": "de", "pos": "noun",
                                          "senses": [{"glosses": ["house", "building"]}],
                                          "forms": [{"form": "Häuser"}], "sounds": [{"ipa": "haʊ̯s"}]}), encoding="utf-8")
        self.manifest = build_dictionary(self.database, self.csv, self.german)
        self.resolver = DictionaryResolver(self.database)
        _lookup_cached.cache_clear()

    def tearDown(self):
        self.directory.cleanup()

    def test_unicode_senses_pronunciation_and_attribution(self):
        result = self.resolver.lookup("‘RUN!’", "en")
        self.assertTrue(result["found"])
        self.assertEqual(result["translation"], "跑；运行")
        self.assertEqual(result["definitions"], ["move quickly", "operate"])
        self.assertEqual(result["ipa"], "rʌn")
        self.assertEqual(result["sources"][0]["name"], "ECDICT")
        self.assertEqual(len(self.manifest["sources"]["ECDICT"]["sha256"]), 64)

    def test_dataset_inflections_english_and_german(self):
        for query, language, lemma in [("ran", "English", "run"), ("taken", "English", "take"), ("Häuser", "German", "Haus")]:
            with self.subTest(query=query):
                result = self.resolver.lookup(query, language)
                self.assertTrue(result["found"])
                self.assertEqual(result["lemma"], lemma)
                self.assertEqual(result["resolution"], "form")

    def test_miss_and_cache_do_not_mutate_shared_entries(self):
        self.assertFalse(self.resolver.lookup("run")["cached"])
        cached = self.resolver.lookup("run")
        self.assertTrue(cached["cached"])
        cached["definitions"].clear()
        self.assertTrue(self.resolver.lookup("run")["definitions"])
        missing = self.resolver.lookup("xyz-not-a-word-123")
        self.assertFalse(missing["found"])
        self.assertEqual(missing["message"], "Not found in local dictionary")

    def test_phrase_positions_longest_match_and_punctuation(self):
        text = "We take off again, then take off."
        matches = self.resolver.phrase_spans(text)
        self.assertEqual([match["text"] for match in matches], ["take off again", "take off"])
        for match in matches:
            self.assertEqual(text[match["start"]:match["end"]], match["text"])
        self.assertFalse(self.resolver.phrase_spans("take, off"))
        self.assertTrue(self.resolver.lookup("take off")["found"])

    def test_no_dictionary_does_not_create_a_database(self):
        path = Path(self.directory.name) / "missing.sqlite3"
        result = DictionaryResolver(path).lookup("word")
        self.assertFalse(result["installed"])
        self.assertFalse(path.exists())

    def test_invalid_inputs(self):
        for query in ["", " " * 10, 42, "a" * 201]:
            with self.assertRaises(ValueError):
                self.resolver.lookup(query)
        with self.assertRaises(ValueError):
            self.resolver.lookup("word", "French")
        with self.assertRaises(ValueError):
            self.resolver.phrase_spans("a" * 20001)

    def test_endpoints_zero_ai_zero_network_for_hits_misses_forms_and_phrases(self):
        application = Flask(__name__)
        application.register_blueprint(dictionary_bp, url_prefix="/api/dictionary")
        provider = MagicMock()
        with patch("routes.dictionary.resolver", self.resolver), \
             patch.dict("sys.modules", {"services.ai_service": provider}), \
             patch("socket.create_connection", side_effect=AssertionError("Unexpected outbound network")) as network, \
             patch("urllib.request.urlopen", side_effect=AssertionError("Unexpected outbound HTTP")) as http:
            client = application.test_client()
            for query in ["run", "ran", "unknown-xyz", "take off"]:
                response = client.get("/api/dictionary", query_string={"q": query})
                self.assertEqual(response.status_code, 200)
            response = client.post("/api/dictionary/phrases", json={"text": "take off again"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(client.get("/api/dictionary?q=").status_code, 400)
            self.assertEqual(client.post("/api/dictionary/phrases", json=[]).status_code, 400)
            provider.enrich_word.assert_not_called()
            provider.bulk_enrich_words.assert_not_called()
            network.assert_not_called()
            http.assert_not_called()

    def test_immutable_runtime_and_corrupt_database_error(self):
        before = self.database.read_bytes()
        self.resolver.lookup("run")
        self.resolver.lookup("not-here")
        self.assertEqual(before, self.database.read_bytes())
        bad = Path(self.directory.name) / "broken.sqlite3"
        bad.write_text("broken")
        application = Flask(__name__)
        application.register_blueprint(dictionary_bp, url_prefix="/api/dictionary")
        with patch("routes.dictionary.resolver", DictionaryResolver(bad)):
            self.assertEqual(application.test_client().get("/api/dictionary?q=run").status_code, 503)


if __name__ == "__main__":
    unittest.main()
