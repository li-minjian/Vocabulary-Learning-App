"""Generate only synthetic APKG fixtures for the local browser tests."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'unit'))
from test_import_semantics import package, model

root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
vocab=model('Synthetic vocabulary',['Word','Translation','Example','Definition','Alternative'],'{{Word}}','{{Translation}}{{Example}}')
vocab['tmpls'][0]['qfmt']+='<script>fetch("https://bad.invalid/tracker")</script>'
notes=[(101,1,['abandon','放弃','He abandoned the plan.','To leave a plan behind.','discard']),(102,1,['curious','好奇的','Curious people ask questions.','Interested in learning.','wonder'])]
(root/'vocabulary.apkg').write_bytes(package({'1':vocab},notes))
grammar=model('Synthetic grammar',['Id','Rubric','Question','Choices','Explanation'],'{{Rubric}}{{cloze:Question}}{{hint:Choices}}','{{cloze:Question}}{{Explanation}}',1)
grammar_notes=[(201,2,['123','Choose a preposition.','She is interested {{c1::in}} learning German.','on / in / at','interested in + doing']),(202,2,['124','Complete both blanks.','{{c1::One}} plus {{c2::two}} makes three.','one / two','A synthetic example.'])]
(root/'grammar.apkg').write_bytes(package({'2':grammar},grammar_notes,[(201,1),(202,1),(202,1)]))
(root/'mixed.apkg').write_bytes(package({'1':vocab,'2':grammar},notes+grammar_notes,[(101,1),(102,1),(201,1),(202,1),(202,1)]))
(root/'large.csv').write_text('Word,Translation,Example\n'+'\n'.join(f'batch-semantic-{i},翻译{i},Example {i}.' for i in range(151)))
