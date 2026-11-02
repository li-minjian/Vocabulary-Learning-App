"""One bounded local parser subprocess; not a background worker/service."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.file_parser import parse_file, ImportValidationError
from services.upload_policy import POLICY

if __name__ == '__main__':
    source, output, filename, raw_settings = sys.argv[1:]
    try:
        settings = json.loads(raw_settings)
        result = parse_file(Path(source).read_bytes(), filename, settings.get('delimiter'), settings.get('has_header'))
        size = 0
        with Path(output).open('w', encoding='utf-8') as stream:
            for chunk in json.JSONEncoder(ensure_ascii=False).iterencode(result):
                size += len(chunk.encode('utf-8'))
                if size > POLICY['max_result_bytes']:
                    raise ImportValidationError('Parsed preview exceeds 24 MiB. Split the vocabulary list.')
                stream.write(chunk)
    except (ImportValidationError, ValueError) as error:
        print(json.dumps({'message': str(error)}))
        raise SystemExit(2)
