"""Bounded, local Poppler extraction; no model or OCR calls."""
import os
import re
import resource
import shutil
import subprocess
import tempfile
from pathlib import Path
from services.upload_policy import UploadError

MAX_PAGES = 200
MAX_TEXT = 100_000


def _limits():
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    if os.uname().sysname == 'Linux':
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))


def extract_pdf(path):
    if not shutil.which('pdfinfo') or not shutil.which('pdftotext'):
        raise UploadError('Local PDF extraction is unavailable on this server.', 503)
    try:
        info = subprocess.run(['pdfinfo', str(path)], capture_output=True, text=True,
                              timeout=15, preexec_fn=_limits)
        pages = re.search(r'^Pages:\s+(\d+)', info.stdout, re.M)
        if info.returncode or not pages:
            raise UploadError('PDF is damaged, encrypted or unsupported.')
        count = int(pages.group(1))
        if count > MAX_PAGES:
            raise UploadError('PDF exceeds the safe processing limit of 200 pages. Split the document.', 422)
        with tempfile.TemporaryDirectory(prefix='voca-pdf-') as directory:
            output = Path(directory) / 'text.txt'
            result = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', '-f', '1', '-l', str(count),
                                     str(path), str(output)], capture_output=True, timeout=45, preexec_fn=_limits)
            if result.returncode or not output.exists():
                raise UploadError('PDF extraction exceeded its resource budget or the PDF is unsupported.', 422)
            text = output.read_text(encoding='utf-8').replace('\f', '\n\n').strip()
            if len(text) > MAX_TEXT:
                raise UploadError('Extracted article exceeds 100,000 characters. Split the document.', 422)
            usable = sum(character.isalnum() for character in text) >= 10
            return {'text': text if usable else '', 'pages': count, 'needs_ocr': not usable,
                    'method': 'local', 'warnings': ['Complex columns and tables may need reading-order correction.'] if usable else
                    ['No usable text layer was found. OCR or AI extraction requires an explicit action.']}
    except subprocess.TimeoutExpired as error:
        raise UploadError('PDF processing timed out. Split or simplify the document.', 422) from error
