"""Explicit opt-in extraction subprocess, bounded by its caller."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.ai_service import extract_uploaded_document

if __name__ == '__main__':
    text = extract_uploaded_document(sys.argv[1], sys.argv[2])
    if len(text) > 100000:
        raise ValueError('Extracted text exceeds article limit')
    Path(sys.argv[3]).write_text(json.dumps({'text': text}, ensure_ascii=False))
