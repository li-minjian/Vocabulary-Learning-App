"""Import into existing user-owned vocabulary without AI or SRS updates.

UUIDs make interrupted attempts recoverable without a new import-jobs table.
Words and relation writes are separate PostgREST transactions; failures are
reported per row and the same import_id can repair an incomplete attempt.
"""
import json
import re
import uuid
from services.file_parser import ImportValidationError, MAX_ROWS, MAX_CELL, plain_text
from services.vocabulary_queries import list_user_words


def normalized_word(value):
    return ' '.join(value.casefold().split())


def _string(value, field, limit=MAX_CELL):
    if value is None:
        return ''
    if not isinstance(value, str):
        raise ImportValidationError(f'{field} must be text.')
    if len(value) > limit:
        raise ImportValidationError(f'{field} exceeds {limit} characters.')
    return plain_text(value)


def validate_payload(payload):
    if not isinstance(payload, dict):
        raise ImportValidationError('Send an import object.')
    rows = payload.get('rows')
    if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
        raise ImportValidationError(f'Provide between 1 and {MAX_ROWS} mapped rows.')
    language = _string(payload.get('language', 'English'), 'language', 50).strip()
    if not language:
        raise ImportValidationError('Choose a language.')
    collection_id = payload.get('collection_id') or None
    if collection_id:
        try:
            collection_id = str(uuid.UUID(str(collection_id)))
        except ValueError as exc:
            raise ImportValidationError('Choose a valid destination collection.') from exc
    conflict = payload.get('conflict', 'skip')
    if conflict not in ('skip', 'keep_both'):
        raise ImportValidationError('Choose skip or keep_both for duplicates.')
    import_id = payload.get('import_id')
    if not isinstance(import_id, str) or not 8 <= len(import_id) <= 128:
        raise ImportValidationError('A stable import_id of 8–128 characters is required for safe retries.')
    return rows, language, collection_id, conflict, import_id


def _prepare_rows(rows, default_language):
    prepared, errors, seen_rows = [], [], set()
    for index, row in enumerate(rows):
        row_number = row.get('row', index + 1) if isinstance(row, dict) else index + 1
        report_row = row_number if isinstance(row_number, int) and not isinstance(row_number, bool) and row_number > 0 else index + 1
        try:
            if not isinstance(row, dict):
                raise ImportValidationError('Row must be an object.')
            if not isinstance(row_number, int) or isinstance(row_number, bool) or row_number < 1 or row_number in seen_rows:
                raise ImportValidationError('Row numbers must be positive and unique.')
            seen_rows.add(row_number)
            word = _string(row.get('word'), 'word', 500)
            if not word:
                raise ImportValidationError('Word is missing.')
            values = {key: _string(row.get(key), key) for key in ('translation', 'definition', 'pos', 'source', 'ipa')}
            language = ' '.join((_string(row.get('language'), 'language', 50) or default_language).split())
            collocations = row.get('collocations') or []
            if isinstance(collocations, str):
                collocations = re.split(r'[;|\n]+', _string(collocations, 'collocations'))
            if not isinstance(collocations, list) or len(collocations) > 100:
                raise ImportValidationError('Use at most 100 collocations per word.')
            collocations = list(dict.fromkeys(_string(phrase, 'collocation', 500) for phrase in collocations if phrase))
            tags = row.get('tags') or []
            if isinstance(tags, str):
                tags = re.split(r'[,;|\s]+', tags.strip())
            if not isinstance(tags, list) or len(tags) > 100:
                raise ImportValidationError('Use at most 100 tags per word.')
            tags = list(dict.fromkeys(_string(tag, 'tag', 100) for tag in tags if tag))
            examples = row.get('examples') or []
            if isinstance(examples, str):
                examples = [{'sentence': examples}]
            if not isinstance(examples, list) or len(examples) > 20:
                raise ImportValidationError('Use at most 20 examples per word.')
            examples = [{'sentence': _string(ex.get('sentence') if isinstance(ex, dict) else ex, 'example'),
                         'translation': _string(ex.get('translation', '') if isinstance(ex, dict) else '', 'example translation')}
                        for ex in examples]
            prepared.append({'row': row_number, 'word': word, 'language': language, 'collocations': collocations, **values, 'tags': tags,
                             'examples': [ex for ex in examples if ex['sentence']]})
        except ImportValidationError as exc:
            errors.append({'row': report_row, 'status': 'invalid', 'message': str(exc)})
    return prepared, errors


def prepare_import(client, user_id, payload):
    rows, language, collection_id, conflict, import_id = validate_payload(payload)
    if collection_id:
        target = client.table('collections').select('id').eq('id', collection_id).eq('user_id', user_id).execute().data
        if not target:
            raise ImportValidationError('Destination collection is unavailable or belongs to another user.')
    prepared, errors = _prepare_rows(rows, language)
    existing = list_user_words(client, user_id, 'id,word,language')
    existing_ids = {str(item['id']) for item in existing}
    known = {(normalized_word(str(item.get('language') or '')), normalized_word(item.get('word', ''))): item['id'] for item in existing}
    seen = set()
    candidates, skipped = [], []
    for row in prepared:
        identity = json.dumps([user_id, import_id, row['language'], collection_id, row], sort_keys=True, ensure_ascii=False)
        row['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, identity))
        key = (normalized_word(row['language']), normalized_word(row['word']))
        # Own UUIDs represent a prior interrupted attempt and must repair relations.
        row['resuming'] = row['id'] in existing_ids
        if not row['resuming'] and conflict == 'skip' and (key in known or key in seen):
            skipped.append({'row': row['row'], 'status': 'skipped', 'word': row['word'], 'message': 'Duplicate word and language; existing vocabulary and review history are preserved.'})
        else:
            row['duplicate'] = key in known or key in seen
            candidates.append(row)
            seen.add(key)
    return {'candidates': candidates, 'invalid': errors, 'skipped': skipped,
            'language': language, 'collection_id': collection_id, 'import_id': import_id}


def preview_import(client, user_id, payload):
    plan = prepare_import(client, user_id, payload)
    return {'ready': len(plan['candidates']), 'skipped': len(plan['skipped']), 'invalid': len(plan['invalid']),
            'duplicates': sum(row['duplicate'] for row in plan['candidates']) + len(plan['skipped']),
            'rows': sorted([{**row, 'status': 'ready'} for row in plan['candidates']] + plan['skipped'] + plan['invalid'], key=lambda row: row['row'])}


def _save_relations(client, user_id, row):
    word_id = row['id']
    if row['examples']:
        values = [{**example, 'id': str(uuid.uuid5(uuid.UUID(word_id), f'example:{index}')),
                   'word_id': word_id, 'user_id': user_id} for index, example in enumerate(row['examples'])]
        client.table('examples').upsert(values, on_conflict='id', ignore_duplicates=True).execute()
    if row['collocations']:
        values = [{'id': str(uuid.uuid5(uuid.UUID(word_id), f'collocation:{index}')),
                   'word_id': word_id, 'user_id': user_id, 'phrase': phrase}
                  for index, phrase in enumerate(row['collocations'])]
        client.table('collocations').upsert(values, on_conflict='id', ignore_duplicates=True).execute()
    if row['tags']:
        # Fetch after insert because INSERT ... DO NOTHING does not return existing tags.
        values = [{'name': tag, 'user_id': user_id} for tag in row['tags']]
        client.table('tags').upsert(values, on_conflict='name,user_id', ignore_duplicates=True).execute()
        tags = client.table('tags').select('id,name').eq('user_id', user_id).in_('name', row['tags']).execute().data or []
        if len(tags) != len(row['tags']):
            raise RuntimeError('Some tag records were not persisted.')
        client.table('word_tags').upsert([{'word_id': word_id, 'tag_id': tag['id'], 'user_id': user_id} for tag in tags],
                                       on_conflict='word_id,tag_id', ignore_duplicates=True).execute()


def commit_import(client, user_id, payload):
    plan = prepare_import(client, user_id, payload)
    results = plan['skipped'] + plan['invalid']
    candidates = plan['candidates']
    for start in range(0, len(candidates), 100):
        batch = candidates[start:start + 100]
        inserts = []
        for row in batch:
            values = {key: row[key] for key in ('word', 'translation', 'definition', 'pos', 'source')}
            if row['ipa']:
                values['ipa'] = row['ipa']
            inserts.append({**values, 'id': row['id'], 'user_id': user_id,
                            'language': row['language'], 'collection_id': plan['collection_id']})
        try:
            client.table('words').upsert(inserts, on_conflict='id', ignore_duplicates=True).execute()
        except Exception:
            # Never retry an uncertain network write with new IDs. Reconcile below.
            pass
        try:
            saved = client.table('words').select('id').eq('user_id', user_id).in_('id', [row['id'] for row in batch]).execute().data or []
            saved_ids = {str(item['id']) for item in saved}
        except Exception:
            saved_ids = set()
        for row in batch:
            if row['id'] not in saved_ids:
                results.append({'row': row['row'], 'word': row['word'], 'status': 'failed',
                                'message': 'Word persistence was not confirmed. Retry this import with the same import ID.'})
                continue
            try:
                _save_relations(client, user_id, row)
                results.append({'row': row['row'], 'word': row['word'], 'id': row['id'],
                                'status': 'resumed' if row['resuming'] else 'imported'})
            except Exception:
                results.append({'row': row['row'], 'word': row['word'], 'id': row['id'], 'status': 'failed',
                                'word_saved': True, 'message': 'Word saved; examples, collocations or tags are incomplete. Retry with the same import ID to repair them.'})
    results.sort(key=lambda row: row['row'])
    return {'import_id': plan['import_id'], 'imported': sum(row['status'] == 'imported' for row in results),
            'resumed': sum(row['status'] == 'resumed' for row in results),
            'skipped': len(plan['skipped']), 'invalid': len(plan['invalid']),
            'failed': sum(row['status'] == 'failed' for row in results), 'rows': results}
