"""Bounded structured vocabulary parsing. This module never calls AI."""
import csv
import hashlib
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from html.parser import HTMLParser
from pathlib import PurePosixPath
from services.upload_policy import MAX_FILE_BYTES

MAX_DATABASE_BYTES = 100 * 1024 * 1024
MAX_ROWS = 10000
MAX_COLUMNS = 64
MAX_CELL = 20000


class ImportValidationError(ValueError):
    pass


class _TextOnly(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        elif tag in ('br', 'p', 'div') and not self.hidden:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain_text(value):
    parser = _TextOnly()
    parser.feed(str(value or ''))
    result = ''.join(parser.parts)
    result = re.sub(r'\[sound:[^\]]+\]', '', result)
    result = re.sub(r'\{\{c\d+::(.*?)(?:::.*?)?\}\}', r'\1', result, flags=re.S)
    return result.strip()


def _finish(rows, columns, numbers, warnings, digest, has_header=False):
    if len(rows) > MAX_ROWS:
        raise ImportValidationError(f'At most {MAX_ROWS} rows can be imported at once.')
    if len(columns) > MAX_COLUMNS:
        raise ImportValidationError(f'At most {MAX_COLUMNS} columns are supported.')
    invalid = []
    for index, row in enumerate(rows):
        if len(row) != len(columns):
            invalid.append({'row': numbers[index], 'message': f'Expected {len(columns)} columns; found {len(row)}. Map available fields or omit this row.'})
        if any(len(cell) > MAX_CELL for cell in row):
            raise ImportValidationError(f'Row {numbers[index]} contains a field longer than {MAX_CELL} characters.')
    return {'import_id': digest, 'columns': columns, 'rows': rows, 'row_numbers': numbers,
            'warnings': warnings, 'invalid_rows': invalid, 'has_header': has_header,
            'count': len(rows)}


def parse_file(data, filename, delimiter=None, has_header=None):
    if not isinstance(data, bytes) or not data:
        raise ImportValidationError('Choose a non-empty file.')
    if len(data) > MAX_FILE_BYTES:
        raise ImportValidationError('File size exceeds 50 MiB (52,428,800 bytes).')
    digest = hashlib.sha256(data).hexdigest()
    suffix = PurePosixPath(filename.lower()).suffix
    if suffix == '.apkg':
        return _parse_apkg(data, digest)
    if suffix not in ('.csv', '.tsv', '.txt'):
        raise ImportValidationError('Supported files: CSV, TSV, Anki TXT and APKG.')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise ImportValidationError('Save the text file as UTF-8 (BOM is supported).') from exc
    if '\x00' in text:
        raise ImportValidationError('The file is not a plain-text vocabulary list.')
    warnings, metadata = [], {}
    # Anki exports put directives before the first data record.
    lines = text.splitlines(keepends=True)
    directive_lines = 0
    while lines and lines[0].startswith('#'):
        line = lines.pop(0).strip()[1:]
        directive_lines += 1
        if ':' in line:
            key, value = line.split(':', 1)
            metadata[key.lower()] = value
    text = ''.join(lines)
    separators = {'tab': '\t', 'comma': ',', 'semicolon': ';', 'space': ' ', 'pipe': '|', 'colon': ':'}
    if delimiter == '\\t':
        delimiter = '\t'
    delimiter = delimiter or separators.get(metadata.get('separator', '').lower())
    if delimiter is not None and delimiter not in (',', '\t', ';', '|', ' ', ':'):
        raise ImportValidationError('Choose a supported delimiter.')
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:65536], delimiters=',\t;|').delimiter
        except csv.Error:
            delimiter = '\t' if suffix in ('.tsv', '.txt') else ','
    try:
        reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=True)
        rows, numbers = [], []
        previous_line = 0
        for row in reader:
            first_line = previous_line + 1 + directive_lines
            previous_line = reader.line_num
            if not any(cell.strip() for cell in row):
                continue
            if len(rows) >= MAX_ROWS + 1:
                raise ImportValidationError(f'At most {MAX_ROWS} rows can be imported at once.')
            if len(row) > MAX_COLUMNS:
                raise ImportValidationError(f'At most {MAX_COLUMNS} columns are supported.')
            rows.append([plain_text(cell) if metadata.get('html', '').lower() == 'true' else cell.strip() for cell in row])
            numbers.append(first_line)
    except csv.Error as exc:
        raise ImportValidationError(f'Invalid quoted field near line {reader.line_num}: {exc}') from exc
    if not rows:
        raise ImportValidationError('No vocabulary rows were found.')
    aliases = {'word', 'term', 'front', 'expression', 'vocabulary', 'translation', 'back', 'definition', 'meaning', 'example', 'examples', 'tags', 'source', 'deck', 'pos', 'language', 'lang', 'collocations', '词语', '单词', '翻译'}
    if has_header is None:
        has_header = any(cell.lower() in aliases for cell in rows[0])
        if 'columns' in metadata:
            has_header = False
    if has_header:
        columns = rows.pop(0)
        numbers.pop(0)
    elif 'columns' in metadata:
        columns = metadata['columns'].split('\t')
    else:
        columns = [f'Column {index + 1}' for index in range(max(len(row) for row in rows))]
    if not columns:
        raise ImportValidationError('The file contains no columns.')
    if not rows:
        raise ImportValidationError('The file has a header but no data rows.')
    if metadata:
        warnings.append('Anki export directives detected. Scheduling and media are not imported.')
    return _finish(rows, columns, numbers, warnings, digest, bool(has_header))


def _parse_apkg(data, digest):
    warnings = ['Anki scheduling history and media are not imported. HTML is converted to plain text. Verify field mapping for custom note types.']
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
        if len(entries) > 20000:
            raise ImportValidationError('Archive contains too many entries.')
        for entry in entries:
            path = PurePosixPath(entry.filename.replace('\\', '/'))
            if path.is_absolute() or '..' in path.parts or re.match(r'^[A-Za-z]:', entry.filename):
                raise ImportValidationError('Unsafe archive path detected.')
            if entry.flag_bits & 1:
                raise ImportValidationError('Encrypted APKG archives are unsupported.')
            # Media is never opened/extracted. Its declared expansion cannot consume
            # processing memory; the one database we actually read is bounded below.
        names = {entry.filename for entry in entries}
        db_name = next((name for name in ('collection.anki21b', 'collection.anki21', 'collection.anki2') if name in names), None)
        if not db_name:
            raise ImportValidationError('No supported Anki collection database was found.')
        info = archive.getinfo(db_name)
        if info.file_size > MAX_DATABASE_BYTES:
            raise ImportValidationError('Anki database exceeds 100 MiB.')
        db_data = archive.read(db_name)
        if db_name.endswith('21b'):
            try:
                import zstandard
            except ImportError as exc:
                raise ImportValidationError('This modern APKG needs zstandard support on the server. Export from Anki with “Support older Anki versions” or use Anki TXT.') from exc
            try:
                with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(db_data)) as reader:
                    db_data = reader.read(MAX_DATABASE_BYTES + 1)
                if len(db_data) > MAX_DATABASE_BYTES:
                    raise ImportValidationError('Anki database expands beyond 100 MiB. Split the deck.')
            except zstandard.ZstdError as exc:
                raise ImportValidationError('Unable to read compressed Anki database; export with older-version support.') from exc
        if not db_data.startswith(b'SQLite format 3\x00'):
            raise ImportValidationError('The APKG collection is not a supported SQLite database.')
        # Only the selected database is materialized; archive paths are never extracted.
        with tempfile.TemporaryDirectory(prefix='voca-anki-') as directory:
            from pathlib import Path
            path = Path(directory) / 'collection.db'
            path.write_bytes(db_data)
            with sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True) as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.enable_load_extension(False)
                budget = [0]
                def progress():
                    budget[0] += 1
                    return int(budget[0] > 100000)
                conn.set_progress_handler(progress, 1000)
                tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if 'notes' not in tables:
                    raise ImportValidationError('This package has no supported notes table.')
                models, decks = {}, {}
                if 'col' in tables:
                    col = conn.execute('SELECT models, decks FROM col LIMIT 1').fetchone()
                    if col:
                        try:
                            models = json.loads(col[0] or '{}')
                            decks = json.loads(col[1] or '{}')
                        except (ValueError, TypeError):
                            warnings.append('Anki model metadata could not be read; generic field names are used.')
                if not isinstance(models, dict) or not isinstance(decks, dict):
                    raise ImportValidationError('Unsupported Anki model/deck metadata. Export as Anki TXT instead.')
                if not models and 'fields' in tables:
                    for ntid, order, name in conn.execute('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord LIMIT 64000'):
                        models.setdefault(str(ntid), {'flds': []})['flds'].append({'name': name, 'ord': order})
                if not decks and 'decks' in tables:
                    decks = {str(row[0]): {'name': row[1]} for row in conn.execute('SELECT id, name FROM decks LIMIT 10000')}
                if any(not isinstance(deck, dict) for deck in decks.values()):
                    raise ImportValidationError('Unsupported Anki deck metadata. Export as Anki TXT instead.')
                note_decks = {}
                if 'cards' in tables:
                    for nid, did in conn.execute('SELECT nid, MIN(did) FROM cards GROUP BY nid LIMIT 10001'):
                        note_decks[str(nid)] = plain_text(decks.get(str(did), {}).get('name', '')).replace('\x1f', '::')
                notes = conn.execute('SELECT id, mid, flds, tags FROM notes ORDER BY id LIMIT 10001').fetchall()
                if len(notes) > MAX_ROWS:
                    raise ImportValidationError(f'At most {MAX_ROWS} Anki notes can be imported at once.')
                columns, records = [], []
                for nid, mid, fields, tags in notes:
                    values = str(fields).split('\x1f')
                    model = models.get(str(mid), {})
                    if not isinstance(model, dict) or not isinstance(model.get('flds', []), list) or any(not isinstance(field, dict) for field in model.get('flds', [])):
                        raise ImportValidationError('Unsupported Anki field metadata. Export as Anki TXT instead.')
                    field_names = [field.get('name', f'Field {i + 1}') for i, field in enumerate(model.get('flds', []))]
                    if any(not isinstance(name, str) or len(name) > MAX_CELL for name in field_names):
                        raise ImportValidationError('Unsupported Anki column names.')
                    if len(field_names) != len(values):
                        field_names = [f'Field {i + 1}' for i in range(len(values))]
                    record = dict(zip(field_names, map(plain_text, values)))
                    record['Anki tags'] = plain_text(tags)
                    record['Source deck'] = note_decks.get(str(nid), '')
                    for name in record:
                        if name not in columns:
                            if len(columns) >= MAX_COLUMNS:
                                raise ImportValidationError(f'At most {MAX_COLUMNS} distinct Anki columns are supported.')
                            columns.append(name)
                    records.append(record)
                if not records:
                    raise ImportValidationError('The APKG contains no vocabulary notes.')
                rows = [[record.get(name, '') for name in columns] for record in records]
                return _finish(rows, columns, list(range(1, len(rows) + 1)), warnings, digest)
    except ImportValidationError:
        raise
    except (zipfile.BadZipFile, RuntimeError, sqlite3.Error, KeyError, OSError) as exc:
        raise ImportValidationError('The APKG is damaged or uses an unsupported collection format. Try an older-version APKG or Anki TXT export.') from exc
