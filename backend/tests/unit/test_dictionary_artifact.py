import io
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch, MagicMock

import test_dictionary as fixtures
from scripts.dictionary_artifact import install, package, sha256, verify_database
from services.dictionary_health import dictionary_health


class ArtifactTests(unittest.TestCase):
    setUp = fixtures.DictionaryTest.setUp
    tearDown = fixtures.DictionaryTest.tearDown

    def pack(self):
        root = Path(self.directory.name)
        source = root / 'snapshot.json'
        source.write_text(json.dumps(self.manifest))
        lock = root / 'dictionary.lock.json'
        package(self.database, source, root / 'artifacts', lock)
        manifest = json.loads(lock.read_text())
        return lock, manifest, root / 'artifacts' / manifest['artifact_filename']

    def test_deterministic_package_verified_install_readonly_and_health(self):
        lock, manifest, artifact = self.pack()
        before = artifact.read_bytes()
        self.pack()
        self.assertEqual(before, artifact.read_bytes())
        with patch('urllib.request.urlopen', return_value=io.BytesIO(before)):
            destination = Path(self.directory.name) / 'installed'
            self.assertTrue(install('https://fixture.example/dictionary.zst', lock, destination)['verified'])
        installed = destination / 'dictionary.sqlite3'
        self.assertEqual(sha256(installed), manifest['database_sha256'])
        self.assertEqual(installed.stat().st_mode & 0o222, 0)
        self.assertTrue(dictionary_health(installed, lock)['ready'])
        self.assertNotIn(str(destination), json.dumps(dictionary_health(installed, lock)))

    def test_invalid_artifact_checksum_size_and_unapproved_transport_fail(self):
        lock, manifest, artifact = self.pack()
        corrupted = bytearray(artifact.read_bytes()); corrupted[0] ^= 1
        for content in (bytes(corrupted), artifact.read_bytes() + b'x', b'bad'):
            with self.subTest(size=len(content)), patch('urllib.request.urlopen', return_value=io.BytesIO(content)), self.assertRaises(ValueError):
                install('https://fixture.example/dictionary.zst', lock, Path(self.directory.name) / 'bad')
        with self.assertRaises(ValueError):
            install('http://fixture.example/dictionary.zst', lock, Path(self.directory.name) / 'bad')

    def test_metadata_counts_indexes_and_missing_health_fail(self):
        lock, manifest, _ = self.pack()
        manifest['counts']['ECDICT'] += 1
        with self.assertRaises(ValueError): verify_database(self.database, manifest)
        manifest['counts']['ECDICT'] -= 1
        with sqlite3.connect(self.database) as connection: connection.execute('DROP INDEX entries_lookup')
        manifest['database_sha256'] = sha256(self.database)
        with self.assertRaises(ValueError): verify_database(self.database, manifest)
        self.assertFalse(dictionary_health(self.database, lock)['ready'])
        self.assertFalse(dictionary_health(Path(self.directory.name)/'absent', lock)['ready'])

    def test_private_gcs_install_uses_short_lived_token_and_pinned_generation(self):
        lock, manifest, artifact = self.pack()
        token = Path(self.directory.name)/'build-token'; token.write_text('public-fixture-token')
        client = MagicMock(); blob = client.bucket.return_value.blob.return_value
        blob.size = manifest['artifact_bytes']; blob.generation = 42
        def download(target, **kwargs): Path(target).write_bytes(artifact.read_bytes())
        blob.download_to_filename.side_effect = download
        with patch('google.cloud.storage.Client', return_value=client) as factory, patch.dict('os.environ', {'GOOGLE_CLOUD_PROJECT':'fixture-project'}):
            install('gs://fixture/dictionary/pinned.zst', lock, Path(self.directory.name)/'gcs', access_token_file=token)
        self.assertEqual(factory.call_args.kwargs['credentials'].token, 'public-fixture-token')
        self.assertEqual(factory.call_args.kwargs['project'], 'fixture-project')
        self.assertEqual(blob.download_to_filename.call_args.kwargs['if_generation_match'], 42)
