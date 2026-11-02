import json
import os
from pathlib import Path
import sqlite3
from services.dictionary_service import DEFAULT_DATABASE


def dictionary_health(database=None, manifest_path=None):
    database = Path(database or DEFAULT_DATABASE)
    local_lock = Path(__file__).resolve().parents[1] / 'dictionary.lock.json'
    lock = Path(manifest_path or os.getenv('DICTIONARY_MANIFEST', str(local_lock)))
    try:
        manifest = json.loads(lock.read_text())
        if database.stat().st_size != manifest['database_bytes']:
            raise ValueError('size')
        with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as connection:
            indexes = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='index'")}
            if 'entries_lookup' not in indexes:
                raise ValueError('index')
            for language in ('English', 'German'):
                if not connection.execute('SELECT 1 FROM entries WHERE language=? LIMIT 1', (language,)).fetchone():
                    raise ValueError('language')
                if not connection.execute('SELECT 1 FROM forms WHERE language=? LIMIT 1', (language,)).fetchone():
                    raise ValueError('forms')
            metadata = json.loads(connection.execute("SELECT value FROM metadata WHERE key='sources'").fetchone()[0])
            if any(metadata[name]['sha256'] != source['sha256'] for name, source in manifest['sources'].items()):
                raise ValueError('metadata')
        return {'ready': True, 'version': manifest['version'], 'languages': ['English', 'German'],
                'expected_records': manifest['counts'], 'artifact_sha256': manifest['artifact_sha256']}
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        return {'ready': False, 'message': 'Pinned dictionary is missing, corrupt or has incompatible metadata.'}
