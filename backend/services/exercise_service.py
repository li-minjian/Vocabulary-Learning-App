"""User-scoped exercise persistence, imports and study lifecycle."""
import uuid
import logging
from collections import Counter
from datetime import datetime, timezone
from services.file_parser import ImportValidationError
from services.import_semantics import interpret_note, content_hash, check_answer, public_question, text
NAMESPACE = uuid.UUID('c153d4f2-e126-4bee-b343-ec9e87a93b11')

class ExerciseError(ValueError):

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

def uid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError):
        raise ExerciseError('Invalid identifier.')

def one(db, table, user, id):
    rows = db.table(table).select('*').eq('user_id', user).eq('id', uid(id)).execute().data
    if not rows:
        raise ExerciseError('Item not found.', 404)
    return rows[0]

def pages(db, table, user, configure=lambda q: q, limit=10000):
    items = []
    while len(items) < limit:
        chunk = configure(db.table(table).select('*').eq('user_id', user)).order('id').range(len(items), min(len(items) + 499, limit - 1)).execute().data
        items.extend(chunk)
        if not chunk:
            break
    if len(items) == limit and configure(db.table(table).select('id').eq('user_id', user)).order('id').range(limit, limit).execute().data:
        raise ExerciseError('This view exceeds its record limit. Narrow the set or filter first.')
    return items

def list_sets(db, user):
    return db.rpc('exercise_set_summaries', {}).execute().data

def create_set(db, user, data):
    title = text(data.get('title', ''), 200)
    if not title:
        raise ExerciseError('Give your Exercise Set a title.')
    collection = data.get('collection_id')
    if collection:
        one(db, 'collections', user, collection)
    id = uid(data.get('id'))
    row = {'id': id, 'user_id': user, 'title': title, 'collection_id': collection or None, 'source_filename': text(data.get('source_filename', ''), 255), 'source_digest': text(data.get('source_digest', ''), 160)}
    db.table('exercise_sets').upsert([row], on_conflict='id', ignore_duplicates=True).execute()
    saved = one(db, 'exercise_sets', user, id)
    if any((saved.get(key) != row[key] for key in ('title', 'collection_id', 'source_digest'))):
        raise ExerciseError('Set destination changed. Reload before importing.', 409)
    return saved

def prepare_import(db, user, data):
    if not isinstance(data, dict) or not isinstance(data.get('notes'), list) or (not 1 <= len(data['notes']) <= 10000):
        raise ExerciseError('Provide 1–10,000 source notes.')
    documents = []
    for note in data['notes']:
        documents.extend(interpret_note(note))
    if len(documents) > 10000:
        raise ExerciseError('At most 10,000 study cards are supported per import.')
    existing = {r['source_key']: r for r in pages(db, 'exercises', user, limit=20000)}
    results = []
    seen = set()
    for position, doc in enumerate(documents):
        old = existing.get(doc['source_key'])
        digest = content_hash(doc)
        status = 'unsupported' if doc['unsupported'] else 'unchanged' if old and old['content_hash'] == digest else 'conflict' if old else 'ready'
        if doc['source_key'] in seen:
            status = 'unsupported'
            doc['unsupported'].append('Repeated source card identity.')
        seen.add(doc['source_key'])
        results.append({'id': str(uuid.uuid5(NAMESPACE, user + ':' + doc['source_key'])), 'position': position, 'status': status, 'document': doc, 'content_hash': digest, 'existing_set_id': old['set_id'] if old else None})
    return {'items': results, 'counts': dict(Counter((r['status'] for r in results))), 'notes': len(data['notes']), 'cards': len(results)}

def commit_import(db, user, data):
    set = one(db, 'exercise_sets', user, data.get('set_id'))
    items = data.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ExerciseError('Commit 1–100 exercises per batch.')
    if any(isinstance(item,dict) and isinstance(item.get('document'),dict) and item['document'].get('source',{}).get('has_media') for item in items) and data.get('allow_text_only_media') is not True:
        raise ExerciseError('Confirm that text is sufficient for cards with unsupported source media before saving.')
    results = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('document'), dict):
            raise ExerciseError('Invalid exercise document.')
        doc = item['document']
        source = doc.get('source', {})
        if not isinstance(source, dict) or type(item.get('position')) != int or (not 0 <= item['position'] < 10000):
            raise ExerciseError('Invalid exercise source position.')
        note = {**doc, 'question': doc.get('original_question', ''), 'answer': doc.get('answer_source', ''), 'source': {**source, 'cards': [{'id': source.get('card_id', ''), 'ordinal': source.get('ordinal'), 'deck': doc.get('source_deck', '')}]}, 'position': source.get('position', 0), 'source_digest': data.get('source_digest', '')}
        canonical = interpret_note(note)[0]
        if canonical != doc:
            raise ExerciseError('Exercise preview changed or was invalid. Analyze it again.', 409)
        if doc['unsupported']:
            results.append({'source_key': doc['source_key'], 'status': 'unsupported'})
            continue
        id = str(uuid.uuid5(NAMESPACE, user + ':' + doc['source_key']))
        digest = content_hash(doc)
        old = db.table('exercises').select('*').eq('user_id', user).eq('id', id).execute().data
        if old:
            results.append({'id': id, 'status': 'unchanged' if old[0]['content_hash'] == digest else 'conflict', 'set_id': old[0]['set_id']})
            continue
        row = {'id': id, 'user_id': user, 'set_id': set['id'], 'source_key': doc['source_key'], 'content_hash': digest, 'document': doc, 'position': int(item.get('position', 0)), 'category': doc['category'], 'unit': doc['unit'], 'source_deck': doc['source_deck']}
        try:
            db.table('exercises').upsert([row], on_conflict='id', ignore_duplicates=True).execute()
            saved = one(db, 'exercises', user, id)
            verified = all((saved.get(key) == row[key] for key in ('set_id', 'content_hash', 'document', 'source_key', 'position')))
            results.append({'id': id, 'status': 'imported' if verified else 'failed', 'set_id': saved['set_id']})
        except Exception as error:
            logging.getLogger(__name__).warning('exercise_item_persistence_unverified error_class=%s',type(error).__name__)
            results.append({'id': id, 'status': 'failed'})
    return {'items': results, 'counts': dict(Counter((r['status'] for r in results)))}

def set_detail(db, user, id, offset=0, limit=50, filters=None):
    set = one(db, 'exercise_sets', user, id)
    rows = pages(db, 'exercises', user, lambda q: q.eq('set_id', id), limit=10000)
    rows.sort(key=lambda r: (r['position'], r['id']))

    def values(key):
        return sorted({row[key] for row in rows if row[key]})
    categories, units, decks = (values('category'), values('unit'), values('source_deck'))
    for key, value in (filters or {}).items():
        if value:
            rows = [row for row in rows if row[key] == text(value, 2000)]
    return {'set': set, 'count': len(rows), 'categories': categories, 'units': units, 'decks': decks, 'items': [{**public_question(row), 'total_attempts': row.get('total_attempts', 0), 'correct_attempts': row.get('correct_attempts', 0), 'next_review': row.get('next_review'), 'last_practiced': row.get('last_practiced'), 'learning_state': row.get('learning_state', 'new')} for row in rows[offset:offset + limit]]}

def start_session(db, user, data):
    id = uid(data.get('id'))
    old = db.table('exercise_sessions').select('*').eq('user_id', user).eq('id', id).execute().data
    if old:
        return session_detail(db, user, id)
    set_id = data.get('set_id')
    mode = data.get('mode', 'all')
    limit = data.get('limit', 20)
    if type(limit) != int or not 1 <= limit <= 200 or mode not in ('new', 'due', 'all'):
        raise ExerciseError('Choose 1–200 exercises and a supported queue.')
    if set_id:
        one(db, 'exercise_sets', user, set_id)
    for key in ('category', 'unit', 'source_deck'):
        if data.get(key) is not None:
            text(data[key], 2000)

    ids = db.rpc('exercise_queue', {'p_collection': data.get('collection_id') or 'all', 'p_set': set_id or None,
        'p_mode': mode, 'p_limit': limit, 'p_category': data.get('category') or '',
        'p_unit': data.get('unit') or '', 'p_deck': data.get('source_deck') or ''}).execute().data
    if not ids:
        raise ExerciseError('No exercises match this queue.')
    db.table('exercise_sessions').upsert([{'id': id, 'user_id': user, 'exercise_ids': ids, 'config': {key: data.get(key) for key in ('collection_id', 'set_id', 'mode', 'limit', 'category', 'unit', 'source_deck')}}], on_conflict='id', ignore_duplicates=True).execute()
    return session_detail(db, user, id)

def session_detail(db, user, id):
    session = one(db, 'exercise_sessions', user, id)
    attempts = pages(db, 'exercise_attempts', user, lambda q: q.eq('session_id', id), limit=200)
    summary = {'attempted': sum((a.get('rating') != 'skip' for a in attempts)), 'correct': sum((a.get('correct') is True and a.get('rating') != 'skip' for a in attempts)), 'incorrect': sum((a.get('correct') is False and a.get('rating') != 'skip' for a in attempts)), 'skipped': sum((a.get('rating') == 'skip' for a in attempts)), 'self_assessed': sum((a.get('correct') is None and a.get('rating') != 'skip' for a in attempts)), 'needs_review': sum((a.get('rating') in ('again', 'hard') for a in attempts))}
    checked = summary['correct'] + summary['incorrect']
    summary['accuracy'] = round(summary['correct'] / checked * 100) if checked else None
    current = None
    attempt = None
    if session['status'] == 'active' and session['position'] < len(session['exercise_ids']):
        exercise_id = session['exercise_ids'][session['position']]
        rows = db.table('exercises').select('*').eq('user_id', user).eq('id', exercise_id).execute().data
        if rows:
            current = public_question(rows[0])
            attempt = next((a for a in attempts if a['exercise_id'] == exercise_id), None)
    return {'session': session, 'current': current, 'attempt': attempt, 'summary': summary}

def answer(db, user, session_id, data):
    session = one(db, 'exercise_sessions', user, session_id)
    exercise = one(db, 'exercises', user, data.get('exercise_id'))
    if exercise['id'] not in session['exercise_ids']:
        raise ExerciseError('Exercise is not in this session.', 404)
    revealed = data.get('revealed', False)
    if type(revealed) != bool:
        raise ExerciseError('Invalid reveal flag.')
    answers = data.get('answers', [])
    feedback = check_answer(exercise['document'], answers, revealed)
    result = db.rpc('record_exercise_attempt', {'p_session': session['id'], 'p_exercise': exercise['id'], 'p_action': 'answer', 'p_data': {'id': uid(data.get('id')), 'answers': answers, 'result': feedback, 'correct': feedback['correct'], 'revealed': revealed}}).execute().data
    return result

def rate(db, user, session_id, data):
    session = one(db, 'exercise_sessions', user, session_id)
    exercise = one(db, 'exercises', user, data.get('exercise_id'))
    if data.get('rating') not in ('again', 'hard', 'good', 'easy', 'skip'):
        raise ExerciseError('Choose Again, Hard, Good, Easy or Skip.')
    db.rpc('record_exercise_attempt', {'p_session': session['id'], 'p_exercise': exercise['id'], 'p_action': 'rate', 'p_data': {'rating': data['rating']}}).execute()
    return session_detail(db, user, session_id)
