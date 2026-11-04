"""User-scoped, bounded vocabulary deletion and private recoverable snapshots.

No SQL/schema changes or service-role access. Children are deleted explicitly;
we do not depend on the historical migration's ON DELETE behavior.
"""
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
from services.upload_service import get_upload_service

CHILDREN = ('examples', 'collocations', 'synonyms', 'word_tags', 'vocabulary_attempts')
PRESERVED = ('collections', 'imported_text', 'tags')
BATCH = 200
PHRASE = 'DELETE ALL VOCABULARY'


class ManagementError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def ids(values):
    if not isinstance(values, list) or not 1 <= len(values) <= BATCH:
        raise ManagementError(f'Supply 1–{BATCH} word IDs per batch.')
    try:
        result = [str(uuid.UUID(value)) for value in values if isinstance(value, str)]
    except ValueError as error:
        raise ManagementError('Every word ID must be a UUID.') from error
    if len(result) != len(values) or len(set(result)) != len(result):
        raise ManagementError('Word IDs must be unique UUIDs.')
    return result


def read_rows(client, user, table, word_ids=None):
    rows, start = [], 0
    while True:
        query = client.table(table).select('*').eq('user_id', user)
        if word_ids is not None:
            query = query.in_('id' if table == 'words' else 'word_id', word_ids)
        order = 'word_id' if table == 'word_tags' else 'id'
        query = query.order(order)
        if table == 'word_tags':
            query = query.order('tag_id')
        page = query.range(start, start + 999).execute().data or []
        if not page:
            return rows
        rows.extend(page)
        if len(rows) > 250000:
            raise ManagementError('Library exceeds the safe backup budget. Contact support.', 413)
        start += len(page)


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def snapshot(client, user):
    tables = {name: read_rows(client, user, name) for name in ('words', *CHILDREN, *PRESERVED)}
    owned = {row['id'] for row in tables['words']}
    if any(row.get('word_id') not in owned for name in CHILDREN for row in tables[name]):
        raise ManagementError('Word relation ownership is inconsistent. No deletion is allowed.', 409)
    if any(row.get('user_id') != user for rows in tables.values() for row in rows):
        raise ManagementError('Backup ownership verification failed.', 409)
    return tables


class BackupStore:
    """Durable private GCS prefix, outside the temporary-upload lifecycle."""
    def __init__(self):
        self.store = get_upload_service().store
        if hasattr(self.store, 'bucket'):
            for rule in self.store.bucket.lifecycle_rules:
                if rule.get('action', {}).get('type') == 'Delete':
                    prefixes = rule.get('condition', {}).get('matchesPrefix', [])
                    if not prefixes or any('voca/backups/'.startswith(prefix) or prefix.startswith('voca/backups/') for prefix in prefixes):
                        raise ManagementError('Private backup storage has an incompatible expiry policy.', 503)

    def key(self, user, operation, suffix='json'):
        try:
            operation = str(uuid.UUID(operation))
        except (ValueError, TypeError, AttributeError) as error:
            raise ManagementError('Invalid backup identifier.') from error
        owner = hashlib.sha256(user.encode()).hexdigest()[:32]
        return f'voca/backups/{owner}/{operation}.{suffix}'

    def put(self, user, operation, value):
        key, data = self.key(user, operation), encoded(value)
        if len(data) > 100 * 1024 * 1024:
            raise ManagementError('Backup exceeds the 100 MiB safety budget.', 413)
        if hasattr(self.store, 'bucket'):
            self.store.bucket.blob(key).upload_from_string(data, content_type='application/json', if_generation_match=0)
        else:
            path = self.store.path(key)
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with path.open('xb') as output:
                os.chmod(path, 0o600)
                output.write(data)
        if encoded(self.get(user, operation)) != data:
            raise ManagementError('Stored backup integrity could not be verified.', 503)
        return ('gs://' + self.store.bucket.name + '/' + key) if hasattr(self.store, 'bucket') else str(self.store.path(key))

    def get(self, user, operation):
        key = self.key(user, operation)
        try:
            data = self.store.bucket.blob(key).download_as_bytes() if hasattr(self.store, 'bucket') else self.store.path(key).read_bytes()
            value = json.loads(data)
        except Exception as error:
            raise ManagementError('Private backup is unavailable. No deletion performed.', 503) from error
        if value.get('user_id') != user or value.get('sha256') != digest(value.get('tables')):
            raise ManagementError('Backup ownership or checksum is invalid.', 409)
        return value

    @contextmanager
    def lock(self, user):
        # Shared across instances. A crashed request leaves a lock requiring operator
        # inspection/removal; never expire a live destructive operation automatically.
        key = self.key(user, str(uuid.UUID(int=0)), 'lock')
        blob, path, generation = None, None, None
        try:
            if hasattr(self.store, 'bucket'):
                blob = self.store.bucket.blob(key)
                blob.upload_from_string(b'locked', if_generation_match=0)
                generation = blob.generation
            else:
                path = self.store.path(key)
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with path.open('xb'):
                    pass
        except Exception as error:
            raise ManagementError('Another vocabulary operation is pending. Retry after it finishes; contact support if it remains locked.', 409) from error
        try:
            yield
        finally:
            if blob:
                blob.delete(if_generation_match=generation)
            elif path:
                path.unlink(missing_ok=True)


def verify_schema(client, user):
    """Validate live FK relationships using the ordinary authenticated Data API.

    The complete pg_constraint/trigger audit is recorded at deployment in
    docs/qa/vocabulary-fk-audit-2026-11-02.json. Schema changes require re-audit.
    Supabase's OpenAPI root requires admin credentials; do not give this runtime
    a service-role key just to enumerate metadata. Child cleanup stays explicit.
    """
    try:
        client.table('words').select('id,examples(word_id),collocations(word_id),synonyms(word_id),word_tags(word_id),vocabulary_attempts(word_id)').eq('user_id', user).range(0, 0).execute()
    except Exception as error:
        raise ManagementError('Live vocabulary relationships could not be verified. No deletion allowed.', 409) from error
    return sorted(CHILDREN)


def prepare_clear(client, user, store):
    with store.lock(user):
        schema = verify_schema(client, user)
        tables = snapshot(client, user)
        # A stable second read prevents a snapshot assembled across changing pages.
        if digest(snapshot(client, user)) != digest(tables):
            raise ManagementError('Library changed during backup. Retry after other edits/imports finish.', 409)
        operation = str(uuid.uuid4())
        backup = {'version': 1, 'id': operation, 'user_id': user,
                  'created_at': datetime.now(timezone.utc).isoformat(), 'schema_word_dependents': schema, 'tables': tables, 'sha256': digest(tables)}
        location = store.put(user, operation, backup)
        result = {'backup_id': operation, 'created_at': backup['created_at'], 'sha256': backup['sha256'],
                  'location': location, 'verified': True, 'counts': {name: len(rows) for name, rows in tables.items()},
                  'schema_word_dependents': schema,
                  'collections_with_words': len({row['collection_id'] for row in tables['words'] if row.get('collection_id')})}
        return result


def delete_owned(client, user, word_ids):
    """Caller has established ownership; reconcile even an uncertain write."""
    try:
        for table in CHILDREN:
            client.table(table).delete().eq('user_id', user).in_('word_id', word_ids).execute()
            if read_rows(client, user, table, word_ids):
                raise ManagementError('Dependent vocabulary data deletion is incomplete.', 409)
        client.table('words').delete().eq('user_id', user).in_('id', word_ids).execute()
    except Exception:
        # The response below tells the caller exactly what remains; never claim an
        # unconfirmed network write succeeded. No per-word uncontrolled requests.
        pass
    remaining = read_rows(client, user, 'words', word_ids)
    orphan_counts = {table: len(read_rows(client, user, table, word_ids)) for table in CHILDREN}
    return {'deleted': len(word_ids) - len(remaining), 'remaining_ids': [row['id'] for row in remaining],
            'relations_remaining': orphan_counts,
            'complete': not remaining and not any(orphan_counts.values())}


def batch_delete(client, user, values, store):
    word_ids = ids(values)
    with store.lock(user):
        verify_schema(client, user)
        owned = read_rows(client, user, 'words', word_ids)
        if {row['id'] for row in owned} != set(word_ids):
            raise ManagementError('Selection includes unavailable or foreign-owned words. Refresh the library before retrying.', 409)
        return delete_owned(client, user, word_ids)


def clear_batch(client, user, operation, phrase, store):
    if phrase != PHRASE:
        raise ManagementError('Type DELETE ALL VOCABULARY to confirm.')
    with store.lock(user):
        backup = store.get(user, operation)
        if verify_schema(client, user) != backup['schema_word_dependents']:
            raise ManagementError('Live vocabulary dependencies changed after backup.', 409)
        original = backup['tables']
        current = snapshot(client, user)
        if any(digest(current[table]) != digest(original[table]) for table in PRESERVED):
            raise ManagementError('Collections, Articles or tags changed. Create a fresh backup before continuing.', 409)
        originals = {row['id']: row for row in original['words']}
        if any(row['id'] not in originals or row != originals[row['id']] for row in current['words']):
            raise ManagementError('Vocabulary changed after backup. No new or edited words were deleted. Create a fresh backup.', 409)
        # Reject new/edited child data, while allowing missing children from a
        # partially completed batch to be reconciled on retry.
        for table in CHILDREN:
            allowed = {encoded(row) for row in original[table]}
            if any(encoded(row) not in allowed for row in current[table]):
                raise ManagementError('Vocabulary learning data changed. Create a fresh backup.', 409)
        word_ids = [row['id'] for row in current['words'][:1000]]
        part = {'complete': True}
        for start in range(0, len(word_ids), BATCH):
            part = delete_owned(client, user, word_ids[start:start + BATCH])
            if not part['complete']:
                break
        after = snapshot(client, user)
        preserved = all(digest(after[t]) == digest(original[t]) for t in PRESERVED)
        remaining = len(after['words'])
        return {'backup_id': operation, 'removed': len(original['words']) - remaining, 'remaining': remaining,
                'complete': remaining == 0 and preserved and part['complete'] and not any(after[t] for t in CHILDREN),
                'batch_complete': part['complete'], 'preserved': preserved,
                'preserved_counts': {t: len(after[t]) for t in PRESERVED}, 'sha256': backup['sha256']}


def restore_backup(client, user, operation, phrase, store):
    if phrase != 'RESTORE VOCABULARY':
        raise ManagementError('Type RESTORE VOCABULARY to confirm recovery.')
    with store.lock(user):
        backup = store.get(user, operation)
        tables = {**backup['tables'], 'vocabulary_attempts': backup['tables'].get('vocabulary_attempts', [])}
        current = snapshot(client, user)
        # Restore exact original IDs/SRS without overwriting edits or moving words.
        for table in PRESERVED:
            if digest(current[table]) != digest(tables[table]):
                raise ManagementError('Preserved records changed; recovery needs a reviewed merge.', 409)
        for table in ('words', *CHILDREN):
            expected = {encoded(row) for row in tables[table]}
            if any(encoded(row) not in expected for row in current[table]):
                raise ManagementError('Current vocabulary differs from the backup. No records overwritten.', 409)
            for start in range(0, len(tables[table]), BATCH):
                client.table(table).upsert(tables[table][start:start+BATCH],
                    on_conflict='word_id,tag_id' if table == 'word_tags' else 'id', ignore_duplicates=True).execute()
        restored = snapshot(client, user)
        if digest(restored) != digest(tables):
            raise ManagementError('Recovery is incomplete. Retry this same backup; original IDs are preserved.', 409)
        return {'restored': len(restored['words']), 'verified': True, 'sha256': backup['sha256']}
