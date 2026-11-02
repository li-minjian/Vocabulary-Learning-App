"""Package, install and verify the pinned dictionary snapshot; never invoked at startup."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import sqlite3
import tempfile
import urllib.request
import sys
import zstandard


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_database(path, manifest):
    if Path(path).stat().st_size != manifest['database_bytes']:
        raise ValueError('Dictionary database size mismatch')
    if sha256(path) != manifest['database_sha256']:
        raise ValueError('Dictionary database SHA-256 mismatch')
    with sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Dictionary SQLite integrity check failed')
        indexes = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        if 'entries_lookup' not in indexes:
            raise ValueError('Dictionary lookup index is missing')
        metadata = json.loads(connection.execute("SELECT value FROM metadata WHERE key='sources'").fetchone()[0])
        for language, source in [('English', 'ECDICT'), ('German', 'Kaikki / Wiktionary')]:
            count = connection.execute('SELECT count(*) FROM entries WHERE language=?', (language,)).fetchone()[0]
            if count != manifest['counts'][source] or metadata[source]['sha256'] != manifest['sources'][source]['sha256']:
                raise ValueError('Dictionary count or source metadata mismatch: ' + language)
            if not connection.execute('SELECT 1 FROM forms WHERE language=? LIMIT 1', (language,)).fetchone():
                raise ValueError('Dictionary form index is missing: ' + language)


def package(database, snapshot_manifest, output, lockfile, version='2026-11-01.1'):
    snapshot = json.loads(Path(snapshot_manifest).read_text())
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+', version):
        raise ValueError('Version must use YYYY-MM-DD.revision')
    manifest = {**snapshot, 'version': version, 'format': 'voca-dictionary-sqlite-zstd-v1',
                'database_bytes': Path(database).stat().st_size, 'artifact_filename': f'voca-dictionary-{version}.sqlite3.zst',
                'distribution': 'Private GCS immutable versioned object; publication requires infrastructure approval.'}
    verify_database(database, manifest)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    artifact = output / manifest['artifact_filename']
    with Path(database).open('rb') as source, artifact.open('wb') as target:
        zstandard.ZstdCompressor(level=9, write_checksum=True, threads=0).copy_stream(source, target)
    manifest['artifact_sha256'] = sha256(artifact)
    manifest['artifact_bytes'] = artifact.stat().st_size
    Path(lockfile).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    shutil.copyfile(lockfile, output / 'dictionary.lock.json')
    return {'version': version, 'artifact_sha256': manifest['artifact_sha256'], 'artifact_bytes': manifest['artifact_bytes']}


def install(url, lockfile, destination, allow_local_http=False, access_token_file=None):
    manifest = json.loads(Path(lockfile).read_text())
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dictionary-build-') as directory:
        compressed, database = Path(directory) / 'artifact.zst', Path(directory) / 'dictionary.sqlite3'
        if url.startswith('gs://'):
            from google.cloud import storage
            credentials = None
            if access_token_file:
                from google.oauth2.credentials import Credentials
                credentials = Credentials(token=Path(access_token_file).read_text().strip())
            bucket, name = url[5:].split('/', 1)
            client = storage.Client(project=os.getenv('GOOGLE_CLOUD_PROJECT'), credentials=credentials)
            blob = client.bucket(bucket).blob(name)
            blob.reload()
            if blob.size != manifest['artifact_bytes']:
                raise ValueError('Dictionary artifact size mismatch')
            blob.download_to_filename(str(compressed), checksum='auto', if_generation_match=blob.generation)
        elif url.startswith('https://') or (allow_local_http and url.startswith(('http://127.0.0.1:', 'http://host.docker.internal:'))):
            with urllib.request.urlopen(url, timeout=60) as response, compressed.open('wb') as target:
                size = 0
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > manifest['artifact_bytes']:
                        raise ValueError('Dictionary artifact exceeds the pinned size')
                    target.write(block)
        else:
            raise ValueError('A private gs:// artifact URL or HTTPS URL is required')
        if compressed.stat().st_size != manifest['artifact_bytes'] or sha256(compressed) != manifest['artifact_sha256']:
            raise ValueError('Dictionary artifact SHA-256/size mismatch')
        with compressed.open('rb') as source, zstandard.ZstdDecompressor().stream_reader(source) as reader, database.open('wb') as target:
            size = 0
            while block := reader.read(1024 * 1024):
                size += len(block)
                if size > manifest['database_bytes']:
                    raise ValueError('Dictionary database exceeds the pinned size')
                target.write(block)
        verify_database(database, manifest)
        shutil.copyfile(database, destination / 'dictionary.sqlite3')
        shutil.copyfile(lockfile, destination / 'dictionary.lock.json')
        (destination / 'dictionary.sqlite3').chmod(0o444)
        (destination / 'dictionary.lock.json').chmod(0o444)
        return {'version': manifest['version'], 'verified': True, 'counts': manifest['counts']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    pack = sub.add_parser('package')
    pack.add_argument('--database', required=True)
    pack.add_argument('--snapshot-manifest', required=True)
    pack.add_argument('--output', required=True)
    pack.add_argument('--lockfile', required=True)
    pack.add_argument('--version', default='2026-11-01.1')
    fetch = sub.add_parser('install')
    fetch.add_argument('--url', required=True)
    fetch.add_argument('--lockfile', required=True)
    fetch.add_argument('--destination', required=True)
    fetch.add_argument('--allow-local-http', action='store_true')
    fetch.add_argument('--access-token-file', help='BuildKit-mounted short-lived OAuth token; never stored in the image')
    arguments = vars(parser.parse_args())
    command = arguments.pop('command')
    try:
        result = package(**arguments) if command == 'package' else install(**arguments)
        print(json.dumps(result))
    except Exception as error:
        detail = str(error) if type(error) is ValueError else type(error).__name__
        print('Dictionary artifact verification failed: ' + detail, file=sys.stderr)
        raise SystemExit(1)
