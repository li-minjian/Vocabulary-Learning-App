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
                              'source': ('source',), 'completed': ('completed',), 'transcript': ('transcript',)}.items():
        for role in alternatives:
            if field(role) and field(role)['evidence']['sampled_nonempty']:
                source_mapping[key] = field(role)['column']; break
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
