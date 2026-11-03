"""Deterministic interpretation of extracted fields. No templates/AI are executed."""
import re

CLOZE = re.compile(r'\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}', re.S)
# Names are one signal; numeric values, sentence shape and template sides can
# override them. Positions are never a semantic signal.
NAMES = {
    'word': {'word', 'term', 'expression', 'vocabulary', 'lexeme', '单词', '词语'},
    'translation': {'translation', 'meaning', '译文', '翻译'},
    'definition': {'definition', 'gloss', 'notes', 'explanation', '解释'},
    'examples': {'example', 'examples', 'sentence', 'context', 'usage', '例句'},
    'question': {'question', 'prompt', 'task', '问题', '题目'},
    'answer': {'answer', 'solution', 'correct answer', '答案'},
    'explanation': {'explanation', 'rationale', '解析'},
    'instruction': {'rubric', 'instruction', 'instructions'},
    'choices': {'choices', 'options', 'alternatives'},
    'identifier': {'id', 'index', 'number', 'sequence', 'sort field', 'guid', 'nid'},
    'metadata': {'category', 'unit', 'chapter', 'topic'},
    'media': {'image', 'audio', 'sound', 'picture', 'media'},
    'transcript': {'audiotext', 'audio text', 'transcript'},
    'language': {'language', 'lang', '语言'},
    'collocations': {'collocation', 'collocations', 'phrases', '搭配'},
    'source': {'source', 'source deck', 'deck'},
    'tags': {'tags', 'anki tags'},
    'pos': {'pos', 'part of speech'},
    'ipa': {'ipa', 'pronunciation', 'phonetic'},
}
TARGETS = ('word', 'translation', 'definition', 'examples', 'language', 'collocations', 'tags', 'source', 'pos', 'ipa')


def cloze_text(value):
    """Preserve answers/hints while providing a safe all-blanks note preview.

    This is a note-level text interpretation, not Anki JS or card scheduling.
    Multiple native cards still correspond to exactly one source note.
    """
    matches = list(CLOZE.finditer(value))
    if not matches or re.search(r'\{\{c\d+::', CLOZE.sub('', value)):
        return None
    return {'prompt': CLOZE.sub(lambda m: '[' + (m[3] or '…') + ']', value),
            'answer': '; '.join(dict.fromkeys(m[2] for m in matches)),
            'completed': CLOZE.sub(lambda m: m[2], value),
            'indices': sorted({int(m[1]) for m in matches})}


def template_references(text, names):
    references = []
    for token in re.findall(r'\{\{([^{}]+)\}\}', text):
        if token.startswith(('#', '/', '^')) or token == 'FrontSide':
            continue
        parts = token.split(':')
        if parts[-1] in names:
            reference = {'field': parts[-1], 'filters': [part for part in parts[:-1] if part]}
            if reference not in references:
                references.append(reference)
    return references


def template_structure(model, names):
    templates = model.get('tmpls') or []
    if not isinstance(templates, list) or len(templates) > 32:
        raise ValueError('Unsupported Anki template metadata.')
    result = []
    for template in templates:
        if not isinstance(template, dict):
            raise ValueError('Unsupported Anki template metadata.')
        front, back = template.get('qfmt', ''), template.get('afmt', '')
        if any(not isinstance(v, str) or len(v) > 20000 for v in (front, back)):
            raise ValueError('Anki templates exceed the safe text budget.')
        result.append({'name': str(template.get('name') or 'Card')[:200],
                       'front': template_references(front, names), 'back': template_references(back, names),
                       'scripted': bool(re.search(r'<script\b', front + back, re.I)),
                       'media': bool(re.search(r'<(?:img|audio|video)\b', front + back, re.I))})
    return result


def _sample_indices(size, count=40):
    return sorted({round(i * (size - 1) / (min(size, count) - 1)) for i in range(min(size, count))}) if size > 1 else [0]


def _script(value):
    if re.search(r'[\u3400-\u9fff]', value): return 'Han'
    if re.search(r'[\u3040-\u30ff]', value): return 'Japanese'
    if re.search(r'[\u0400-\u04ff]', value): return 'Cyrillic'
    if re.search(r'[A-Za-z\u00c0-\u024f]', value): return 'Latin'
    return ''


def interpret(group, rows):
    sampled = [rows[i] for i in _sample_indices(len(rows))]
    front = {ref['field'] for t in group['templates'] for ref in t['front']}
    back = {ref['field'] for t in group['templates'] for ref in t['back']} - front
    fields = []
    for spec in group['fields']:
        values = [row[spec['column']] for row in sampled if spec['column'] < len(row) and row[spec['column']].strip()]
        name = spec['name'].strip().lower()
        role, confidence, reason = 'unresolved', .25, 'No reliable role yet; inspect the displayed examples.'
        numeric = bool(values) and all(re.fullmatch(r'[+-]?\d+(?:[.,]\d+)?', value) for value in values)
        if spec.get('derived'):
            role, confidence, reason = spec['derived'], 1., 'Extracted from explicit cloze answer markers; original field is preserved.'
        elif numeric:
            role, confidence, reason = 'identifier', .98, 'Sampled values are numeric IDs or indexes; excluded by default.'
        elif any(CLOZE.search(value) for value in values):
            role, confidence, reason = 'cloze_text', .99, 'Contains explicit cloze blanks and their answers.'
        else:
            roles = [key for key, aliases in NAMES.items() if name in aliases]
            # Explanation has its own source role; it may later map to notes.
            if roles:
                role = 'explanation' if 'explanation' in roles else roles[0]
                confidence, reason = .94, 'Field name and sampled content support this role.'
            elif name.startswith('anki tags (metadata)'):
                role, confidence, reason = 'tags', 1., 'Anki note tags, separate from custom fields.'
            elif name.startswith('source deck (metadata)'):
                role, confidence, reason = 'source', 1., 'Deck membership from native card relationships.'
            elif name in ('front', 'back') or spec['name'] in front | back:
                role = 'front' if name == 'front' or spec['name'] in front else 'back'
                confidence, reason = .7, 'Referenced on this side of the native card template.'
        fields.append({**spec, 'role': role, 'confidence': confidence, 'reason': reason,
                       'evidence': {'sampled_nonempty': len(values), 'sample_size': len(sampled),
                                    'mean_words': round(sum(len(v.split()) for v in values) / max(1, len(values)), 1),
                                    'scripts': sorted({_script(v) for v in values} - {''}),
                                    'front_reference': spec['name'] in front, 'back_reference': spec['name'] in back}})
    def field(role):
        matches = [item for item in fields if item['role'] == role]
        return matches[0] if len(matches) == 1 else None
    kind, confidence, reason = 'unresolved', .4, 'Confirm the meaningful field on the card before saving.'
    cloze_fields = [item for item in fields if item['role'] == 'cloze_text']
    if cloze_fields or group.get('model_type') == 1:
        kind = 'grammar_exercise' if re.search(r'grammar|grammatik|语法', group['name'], re.I) or field('instruction') else 'cloze_exercise'
        confidence, reason = .99, 'Answers are embedded in cloze text; options are hints, not translations.'
        if len(cloze_fields) > 1:
            confidence, reason = .65, 'Multiple cloze fields need a focused source check; no single question/answer was inferred.'
    elif field('question') or field('answer'):
        kind, confidence, reason = 'question_answer', .93, 'Explicit question/answer fields describe an exercise.'
    elif field('word'):
        word = field('word')
        if word['evidence']['mean_words'] <= 6:
            kind, confidence, reason = 'vocabulary', .95, 'A short word/phrase field is supported by the content.'
        else:
            kind, confidence, reason = 'translation_cards', .8, 'The word-labelled field contains sentences; check conversion into vocabulary.'
    elif field('front') and field('back'):
        a, b = field('front'), field('back')
        differing_scripts = a['evidence']['scripts'] and b['evidence']['scripts'] and set(a['evidence']['scripts']).isdisjoint(b['evidence']['scripts'])
        if a['evidence']['mean_words'] <= 6 and differing_scripts:
            a.update(role='word', confidence=.85, reason='Short front plus a different-script back supports a vocabulary/translation pair.')
            b.update(role='translation', confidence=.85, reason='Back translation uses a different writing system.')
            kind, confidence, reason = 'vocabulary', .85, 'Template sides and content jointly support vocabulary.'
        elif a['evidence']['mean_words'] <= 2 and b['evidence']['mean_words'] >= 3:
            a.update(role='word', confidence=.82, reason='A short front term and sentence-length back support a word with a definition.')
            b.update(role='definition', confidence=.8, reason='Sentence-length back text is suggested as notes, not an unverified translation.')
            kind, confidence, reason = 'vocabulary', .8, 'A term plus definition is supported by template sides and content.'
        elif differing_scripts:
            kind, confidence, reason = 'translation_cards', .85, 'Sentence-length front/back text uses different writing systems.'
        else:
            kind, confidence, reason = 'question_answer', .7, 'Front/back are known, but a word/translation interpretation is not established.'
    mapping = {key: '' for key in TARGETS}
    for key in TARGETS:
        item = field(key)
        if item and item['confidence'] >= .8:
            mapping[key] = str(item['column'])
    if kind != 'vocabulary':
        mapping['word'] = mapping['translation'] = ''
        if field('completed'): mapping['examples'] = str(field('completed')['column'])
    if not mapping['definition'] and field('explanation'):
        mapping['definition'] = str(field('explanation')['column'])
    source_mapping = {}
    for key, alternatives in {'question': ('prompt', 'question', 'cloze_text', 'word', 'front'), 'answer': ('cloze_answer', 'answer', 'translation', 'back'),
                              'explanation': ('explanation', 'definition'), 'choices': ('choices',), 'instruction': ('instruction',),
                              'source': ('source',), 'completed': ('completed',), 'transcript': ('transcript',), 'tags': ('tags',)}.items():
        for role in alternatives:
            if field(role) and field(role)['evidence']['sampled_nonempty']:
                source_mapping[key] = field(role)['column']; break
    for key,aliases in {'category':('category',),'unit':('unit','chapter')}.items():
        matches=[item for item in fields if item['name'].strip().lower() in aliases]
        if len(matches)==1:source_mapping[key]=matches[0]['column']
    samples = set(_sample_indices(len(rows), 7))
    important = [int(mapping['word'])] if mapping['word'] else [source_mapping.get('question', group['fields'][0]['column'])]
    missing = [i for i, row in enumerate(rows) if any(c >= len(row) or not row[c] for c in important)]
    optional = [int(mapping[key]) for key in ('translation', 'definition', 'examples') if mapping[key]]
    gaps = [i for i, row in enumerate(rows) if any(c >= len(row) or not row[c] for c in optional)]
    long = [i for i, row in enumerate(rows) if any(c < len(row) and len(row[c]) > 250 for c in important)]
    samples.update((missing[:1] + missing[-1:] + gaps[:1] + gaps[-1:] + long[:1]))
    return {'kind': kind, 'confidence': confidence, 'reason': reason, 'fields': fields, 'mapping': mapping,
            'source_mapping': source_mapping, 'sample_rows': [group['row_numbers'][i] for i in sorted(samples)],
            'unresolved': [f['name'] for f in fields if f['role'] == 'unresolved' or (f['role'] in TARGETS and sum(other['role'] == f['role'] for other in fields) > 1)]}


def enrich(result, groups=None, provenance=None):
    """One source row per note, with independent mappings per note type."""
    if groups is None:
        groups = [{'id': 'table', 'name': 'Structured list', 'fields': [{'name': name, 'column': i} for i, name in enumerate(result['columns'])],
                   'row_numbers': result['row_numbers'], 'templates': [], 'native_cards': 0}]
    result['provenance'] = provenance or [{} for _ in result['rows']]
    positions = {number: i for i, number in enumerate(result['row_numbers'])}
    derived_columns = {}
    for group in groups:
        local_rows = [result['rows'][positions[n]] for n in group['row_numbers']]
        cloze_fields = [field for field in group['fields'] if any(field['column'] < len(row) and CLOZE.search(row[field['column']]) for row in local_rows)]
        if len(cloze_fields) == 1:
            origin = cloze_fields[0]['column']
            for label, role, prop in [('Cloze question', 'prompt', 'prompt'), ('Cloze answer', 'cloze_answer', 'answer'), ('Completed text', 'completed', 'completed')]:
                if role not in derived_columns:
                    name = label
                    while name in result['columns']: name += ' (derived)'
                    derived_columns[role] = len(result['columns']); result['columns'].append(name)
                    for row in result['rows']:
                        row.extend([''] * (derived_columns[role] + 1 - len(row)))
                column = derived_columns[role]
                group['fields'].append({'name': result['columns'][column], 'column': column, 'derived': role, 'from_column': origin})
                for row in local_rows:
                    parts = cloze_text(row[origin])
                    row[column] = parts[prop] if parts else (row[origin] if prop != 'answer' else '')
        for field in cloze_fields:
            if len(cloze_fields) == 1 and 'completed' in derived_columns:
                field['canonical_column'] = derived_columns['completed']
        group['warnings'] = ['Several cloze fields are present. Their raw text remains available; combined template behavior is not reproduced.'] if len(cloze_fields) > 1 else []
        if cloze_fields and any(re.search(r'\{\{c\d+::', row[cloze_fields[0]['column']]) and cloze_text(row[cloze_fields[0]['column']]) is None for row in local_rows):
            group['warnings'].append('Some cloze syntax is nested or unsupported. Its raw text is retained for preview; raw cloze cannot be converted into vocabulary.')
        if any(template['scripted'] for template in group['templates']):
            group['warnings'].append('Native card scripts are not executed. This preview interprets the extracted text, not the scripted Anki layout.')
        group['count'] = len(local_rows)
        group['analysis'] = interpret(group, local_rows)
    result['groups'] = groups
    return result


# Exercise practice semantics share this single interpreter.
import hashlib
import json
import unicodedata
from services.file_parser import ImportValidationError

def text(value, limit=20000):
    if not isinstance(value, str) or len(value) > limit:
        raise ImportValidationError('Exercise text exceeds its supported limit.')
    from services.file_parser import plain_text
    return plain_text(value, preserve_cloze=True).strip()

def normalize_answer(value):
    return ' '.join(unicodedata.normalize('NFC', value).split()).casefold()

def interpret_note(note):
    """One study item per native card/cloze variant; repeated blanks remain separate."""
    if not isinstance(note, dict):
        raise ImportValidationError('Invalid exercise source.')
    if type(note.get('position', 0)) != int or not 0 <= note.get('position', 0) < 10000:
        raise ImportValidationError('Invalid source row position.')
    source = note.get('source', {})
    if not isinstance(source, dict):
        raise ImportValidationError('Invalid source provenance.')
    question = text(note.get('question', ''))
    answer = text(note.get('answer', ''))
    base = {key: text(note.get(key, ''), 2000 if key in ('category', 'unit', 'source_deck', 'tags') else 20000) for key in ('instruction', 'choices', 'explanation', 'category', 'unit', 'source_deck', 'tags', 'transcript')}
    matches = list(CLOZE.finditer(question))
    unsupported = []
    if re.search('\\{\\{c\\d+::', CLOZE.sub('', question)):
        unsupported.append('Nested or malformed cloze syntax needs manual review.')
    if matches and answer:
        interpreted=cloze_text(question)
        if interpreted and answer!=interpreted['answer']:
            unsupported.append('The selected Answer source conflicts with explicit cloze markers. Restore the extracted answer or choose a question without cloze markup.')
    cards = source.get('cards', [])
    if not isinstance(cards, list) or len(cards) > 32:
        raise ImportValidationError('Too many card variants.')
    indices = sorted({int(m[1]) for m in matches})
    if not cards:
        cards = [{'id': '', 'ordinal': i - 1} for i in indices] if indices else [{'id': '', 'ordinal': 0}]
    output = []
    for variant, card in enumerate(cards):
        if not isinstance(card, dict):
            raise ImportValidationError('Invalid native card.')
        reasons = list(unsupported)
        ordinal = card.get('ordinal')
        if not matches and len(cards) > 1:
            reasons.append('Multiple non-cloze native templates require card-side review; this group is not imported automatically.')
        if matches:
            if ordinal is None:
                if len(indices) == 1:
                    active = indices[0]
                else:
                    active = indices[min(variant, len(indices) - 1)]
                    reasons.append('Native cloze ordinal unavailable; verify this card variant.')
            elif type(ordinal) is int and ordinal >= 0:
                active = ordinal + 1
            else:
                raise ImportValidationError('Invalid card ordinal.')
            if active not in indices:
                reasons.append('Native card has no corresponding cloze blank.')
            segments = []
            blanks = []
            offset = 0
            completed = ''
            prompt = ''
            for match in matches:
                before = question[offset:match.start()]
                segments.append({'text': before})
                completed += before + match[2]
                prompt += before
                if int(match[1]) == active:
                    index = len(blanks)
                    blanks.append({'index': index, 'cloze_index': active, 'expected': [match[2]], 'hint': match[3] or ''})
                    segments.append({'blank': index})
                    prompt += '_____'
                else:
                    segments.append({'text': match[2]})
                    prompt += match[2]
                offset = match.end()
            segments.append({'text': question[offset:]})
            completed += question[offset:]
            prompt += question[offset:]
            expected = [blank['expected'] for blank in blanks]
            mode = 'cloze'
        else:
            active = None
            segments = [{'text': question}]
            prompt = question
            completed = answer
            expected = [[answer]] if answer else []
            # Explicit JSON arrays in an Answer export field are accepted alternatives.
            # Slash-separated prose is never guessed to contain equivalent answers.
            if answer.startswith('['):
                try:
                    alternatives=json.loads(answer)
                    if isinstance(alternatives,list) and 1<=len(alternatives)<=20 and all(isinstance(v,str) and 0<len(v)<=2000 for v in alternatives):expected=[alternatives]
                except (ValueError,TypeError):pass
            blanks = []
            mode = 'self_assess'
        if not question:
            reasons.append('Question is empty.')
        if not matches and (not answer):
            reasons.append('No supported answer source; choose one before saving.')
        if source.get('has_media'):
            media_warning = 'Source contains media. Media is not imported; verify that this text is sufficient.'
        else:
            media_warning = ''
        base_variant = {**base, 'source_deck': text(card.get('deck', '')) or base['source_deck']}
        options = []
        if not matches and answer:
            try:
                choices = json.loads(base['choices'])
                if isinstance(choices, list) and 2 <= len(choices) <= 20 and all((isinstance(v, str) and 0 < len(v) <= 2000 for v in choices)) and (len(set(choices)) == len(choices)) and all(value in choices for value in expected[0]):
                    options = choices
                    mode = 'choice'
            except (ValueError, TypeError):
                pass
        document = {**base_variant, 'options': options, 'kind': str(note.get('kind', 'question_answer'))[:80], 'mode': mode, 'question': prompt, 'segments': segments, 'blanks': blanks, 'expected': expected, 'completed': completed, 'original_question': question, 'answer_source':answer, 'source': {'note_id': str(source.get('note_id', ''))[:100], 'group_id': str(source.get('group_id', ''))[:100], 'card_id': str(card.get('id', ''))[:100], 'ordinal': ordinal, 'cloze_index': active, 'position': note.get('position', 0), 'has_media': bool(source.get('has_media'))}, 'warnings': [media_warning] if media_warning else [], 'unsupported': reasons}
        native = ':'.join((document['source']['group_id'], document['source']['note_id'], document['source']['card_id'] or str(active if active is not None else variant)))
        source_key = 'anki:' + native if source.get('note_id') else 'list:' + str(note.get('source_digest', '')) + ':' + str(note.get('position', 0)) + ':' + str(variant)
        document['source_key'] = source_key
        output.append(document)
    return output

def content_hash(document):
    return hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def check_answer(document, answers, revealed=False):
    if not isinstance(answers, list) or len(answers) > 64 or any((not isinstance(a, str) or len(a) > 2000 for a in answers)):
        raise ImportValidationError('Provide at most 64 text answers (2,000 characters each).')
    expected = document['expected']
    correct = None
    if document['mode'] in ('cloze', 'choice') and (not revealed):
        correct = len(answers) == len(expected) and all((any((normalize_answer(a) == normalize_answer(v) for v in alternatives)) for a, alternatives in zip(answers, expected)))
    return {'correct': correct, 'expected': expected, 'completed': document['completed'], 'explanation': document['explanation'], 'warnings': document['warnings'], 'needs_self_assessment': correct is None}

def public_question(row):
    """Practice responses contain no expected answers/completed/source cloze text."""
    document = row['document']
    return {'id': row['id'], 'set_id': row['set_id'], 'category': row['category'], 'unit': row['unit'], 'source_deck': row['source_deck'], 'document': {key: document[key] for key in ('mode', 'question', 'segments', 'instruction', 'choices', 'options', 'warnings')}, 'hints': [blank['hint'] for blank in document['blanks']]}
