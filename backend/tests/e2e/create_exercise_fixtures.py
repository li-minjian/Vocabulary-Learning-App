"""Public, synthetic native-card fixtures. No personal APKG contents."""
import io, json, sqlite3, sys, tempfile, zipfile
from pathlib import Path
root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)

def package(name, mid, fields, notes, cards, kind=1):
    with tempfile.TemporaryDirectory() as folder:
        p = Path(folder) / 'db'
        c = sqlite3.connect(p)
        c.executescript('create table col(models text,decks text);create table notes(id integer,mid integer,flds text,tags text);create table cards(id integer,nid integer,did integer,ord integer);')
        m = {'name': name, 'type': kind, 'flds': [{'name': f} for f in fields], 'tmpls': [{'name': 'Card', 'qfmt': '{{Rubric}}{{cloze:Question}}' if kind == 1 else '{{Question}}', 'afmt': '{{cloze:Question}}' if kind == 1 else '{{Answer}}{{Explanation}}'}]}
        c.execute('insert into col values(?,?)', (json.dumps({str(mid): m}), json.dumps({'1': {'name': 'Synthetic exercises'}})))
        c.executemany('insert into notes values(?,?,?,?)', [(id, mid, '\x1f'.join(values), 'synthetic') for id, values in notes])
        c.executemany('insert into cards values(?,?,1,?)', cards)
        c.commit()
        c.close()
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr('collection.anki2', p.read_bytes())
        return out.getvalue()
fields = ['Id', 'Rubric', 'Question', 'Choices', 'Explanation', 'Category', 'Unit']
(root / 'grammar.apkg').write_bytes(package('Synthetic grammar exercises', 700, fields, [(701, ['1', 'Choose a preposition', 'She is interested {{c1::in}} learning German.', 'on / in / at', 'interested in + doing', 'Prepositions', 'Unit 1']), (702, ['2', 'Fill both blanks', '{{c1::One}} plus {{c2::two}} makes three.', 'one / two', '', 'Numbers', 'Unit 2'])], [(710, 701, 0), (711, 702, 0), (712, 702, 1)]))
(root / 'variants.apkg').write_bytes(package('Synthetic cloze exercises', 800, fields, [(801, ['1', 'Complete the active blanks', '{{c1::One}} plus {{c2::two}} equals {{c1::three}}.<img src="https://bad.invalid/example.png">', '', '', 'Numbers', 'Unit 2'])], [(810, 801, 0), (811, 801, 1)]))
(root / 'qa.apkg').write_bytes(package('Synthetic question answers', 900, ['Question', 'Answer', 'Explanation'], [(901, ['Describe a greeting.', 'Hello', 'A source explanation'])], [(910, 901, 0)], 0))
