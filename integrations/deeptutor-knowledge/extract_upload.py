"""Bounded, text-only reuse of the pinned DeepTutor document extractors."""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
from pathlib import Path
import re
import resource
import sys
import zipfile

PIN = "6cf793bd868ba5ecbe64722936d4be8fab5a01df"
MAX_BYTES = 100 * 1024 * 1024
MAX_TEXT_BYTES = 5 * 1024 * 1024
EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".epub", ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".html", ".htm", ".rst", ".tex"}


def extract(request):
    source = Path(os.environ["QITU_DEEPTUTOR_SOURCE"]).resolve()
    if (source / "QITU_PIN").read_text().strip() != PIN:
        return {"ok": False, "errorCode": "UPSTREAM_VERSION_MISMATCH"}
    sys.path.insert(0, str(source))
    from deeptutor.utils import document_extractor as upstream

    name = request["fileName"]
    ext = Path(name).suffix.lower()
    if ext not in EXTENSIONS:
        return {"ok": False, "errorCode": "FILE_TYPE_UNSUPPORTED"}
    data = base64.b64decode(request["base64"], validate=True)
    if not data or len(data) > MAX_BYTES:
        return {"ok": False, "errorCode": "FILE_SIZE_LIMIT"}
    if ext in {".docx", ".xlsx", ".pptx", ".epub"}:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 5000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024 or any(e.file_size > 30 * 1024 * 1024 or (e.file_size > 1024 * 1024 and e.file_size / max(e.compress_size, 1) > 200) for e in entries):
                return {"ok": False, "errorCode": "ARCHIVE_LIMIT"}
            if any(e.flag_bits & 1 for e in entries):
                return {"ok": False, "errorCode": "DOCUMENT_ENCRYPTED"}
    # Use upstream's text-only paths; image markers must not count as document text.
    upstream.fitz = None
    upstream.DocxDocument = None
    upstream.PptxPresentation = None
    upstream.extract_docx_rich = lambda _: None
    upstream.extract_pptx_rich = lambda _: None
    page_count = None
    if ext == ".pdf":
        from pypdf import PdfReader
        pdf = PdfReader(io.BytesIO(data))
        if pdf.is_encrypted:
            return {"ok": False, "errorCode": "DOCUMENT_ENCRYPTED"}
        page_count = len(pdf.pages)
        if page_count > 500:
            return {"ok": False, "errorCode": "DOCUMENT_PAGE_LIMIT"}
    if ext in {".html", ".htm"}:
        from html.parser import HTMLParser
        class TextHTML(HTMLParser):
            def __init__(self):
                super().__init__(); self.parts = []; self.hidden = 0
            def handle_starttag(self, tag, attrs):
                if tag in {"script", "style"}: self.hidden += 1
                if tag in {"p", "div", "br", "li", "tr", "h1", "h2", "h3"}: self.parts.append("\n")
            def handle_endtag(self, tag):
                if tag in {"script", "style"} and self.hidden: self.hidden -= 1
            def handle_data(self, text):
                if not self.hidden: self.parts.append(text)
        parser = TextHTML(); parser.feed(upstream._extract_text_like(data, name))
        text = "".join(parser.parts)
    else:
        text = upstream.extract_text_from_bytes(name, data, max_bytes=MAX_BYTES, max_chars=None)
    if "\x00" in text or sum(ord(c) < 32 and c not in "\n\t\r" for c in text) > max(2, len(text) // 100):
        return {"ok": False, "errorCode": "DOCUMENT_CORRUPT"}
    meaningful = re.sub(r"^--- (?:Page \d+|Slide \d+|Sheet: .*?) ---\s*$", "", text, flags=re.M).strip()
    if not meaningful:
        return {"ok": False, "errorCode": "DOCUMENT_NO_TEXT"}
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        return {"ok": False, "errorCode": "EXTRACTED_TEXT_LIMIT"}
    return {"ok": True, "content": text.strip(), "parser": "deeptutor-text-only", "upstreamCommit": PIN, "pageCount": page_count}


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
        request = json.loads(sys.stdin.read(140 * 1024 * 1024))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = extract(request)
    except ImportError:
        result = {"ok": False, "errorCode": "PARSER_DEPENDENCY_MISSING"}
    except Exception as error:
        code = "DOCUMENT_NO_TEXT" if type(error).__name__ == "EmptyDocumentError" else "DOCUMENT_CORRUPT"
        result = {"ok": False, "errorCode": code}
    print(json.dumps(result, ensure_ascii=False))
