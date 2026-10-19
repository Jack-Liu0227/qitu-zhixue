"""Read a native DeepTutor index in place, using its original probe/search implementation."""
import os
import hashlib
import base64
from itertools import islice
from pathlib import Path


def directory_request(root, data):
    """Read only the requested jailed source directory; indexes are never exposed."""
    folder = (root / str(data.get('folderId') or '')).resolve(strict=True)
    if not folder.is_relative_to(root) or not folder.is_dir():
        return {'ok': False, 'errorCode': 'LINKED_PATH_NOT_ALLOWED'}
    entries = sorted(islice(folder.iterdir(), 1001), key=lambda p: p.name.casefold())
    if len(entries) > 1000:
        return {'ok': False, 'errorCode': 'SOURCE_SYNC_BUDGET_EXCEEDED'}
    entries = [p for p in entries if not p.is_symlink() and not p.name.startswith('.')]
    def identifier(p):
        return hashlib.sha256(str(p.relative_to(root)).encode()).hexdigest()
    if data['operation'] in {'read_document', 'read_original'}:
        selected = next((p for p in entries if p.is_file() and identifier(p) == data.get('documentId')), None)
        limit = (20 if data['operation'] == 'read_original' else 10) * 1024 * 1024
        if selected is None or selected.stat().st_size > limit:
            return {'ok': False, 'errorCode': 'SOURCE_DOCUMENT_UNAVAILABLE'}
        if data['operation'] == 'read_original':
            body = selected.read_bytes()
            if not body.startswith(b'%PDF-'):
                return {'ok': False, 'errorCode': 'SOURCE_ORIGINAL_UNAVAILABLE'}
            return {'ok': True, 'manifest': {'body': base64.b64encode(body).decode('ascii'), 'mimeType': 'application/pdf'}}
        from deeptutor.utils.document_extractor import extract_text_from_path
        return {'ok': True, 'manifest': {'content': extract_text_from_path(selected, max_chars=100000)}}
    offset = max(0, int(data.get('cursor') or '0'))
    files = [p for p in entries if p.is_file()]
    page = files[offset:offset+50]
    return {'ok': True, 'manifest': {
        'items': [{'id': identifier(p), 'title': p.name, 'origin': {'byteSize': p.stat().st_size}} for p in page],
        'folders': [{'id': str(p.relative_to(root)), 'name': p.name} for p in entries if p.is_dir()],
        'nextCursor': str(offset+50) if len(files)>offset+50 else '', 'isEnd': len(files)<=offset+50}}


async def linked_request(data, service_class):
    reference = data.get("externalRef") or {}
    if not reference.get("externalPath"):
        return None
    path = Path(reference["externalPath"]).resolve(strict=True)
    raw_roots = os.getenv("QITU_KNOWLEDGE_LINK_ROOTS") or os.getenv("QITU_KNOWLEDGE_DATA", "")
    roots = [Path(value).resolve() for value in raw_roots.split(os.pathsep) if value]
    if not path.is_dir() or not roots or not any(path.is_relative_to(root) for root in roots):
        return {"ok": False, "errorCode": "LINKED_PATH_NOT_ALLOWED"}
    if data['operation'] in {'documents', 'read_document', 'read_original'}:
        raw = path / 'raw'
        return directory_request(raw.resolve(), data) if raw.is_dir() else {'ok': True, 'manifest': {'items': [], 'folders': [], 'isEnd': True}}
    from deeptutor.services.rag.linked_kb import probe_linked_folder
    probe = probe_linked_folder(str(path), data["provider"])
    if not probe.ok or probe.embedding.compatible is not True:
        return {"ok": False, "errorCode": "LINKED_INDEX_NOT_READY" if not probe.ok else "EMBEDDING_SIGNATURE_MISMATCH"}
    if data["operation"] == "link_probe":
        return {"ok": True, "manifest": {"version": probe.version, "docCount": probe.doc_count or 0}}
    if data["operation"] != "search":
        return {"ok": False, "errorCode": "LINKED_READ_ONLY"}
    service = service_class(kb_base_dir=str(path.parent), provider=data["provider"])
    found = await service_class.search.__wrapped__(service, data["query"], path.name,
        top_k=min(8, max(1, data.get("topK", 5))))
    if found.get("error_type"):
        return {"ok": False, "errorCode": "LINKED_INDEX_NOT_READY"}
    items = [{"title": Path(str(item.get("source", "文档"))).name,
              "text": str(item.get("text", item.get("content", "")))[:24000],
              "score": item.get("score")} for item in found.get("sources", [])[:8]]
    return {"ok": True, "manifest": {"items": items}}
