"""Private JSON/stdin adapter for pinned DeepTutor; no network listener."""
from __future__ import annotations
import asyncio
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys

PIN = "6cf793bd868ba5ecbe64722936d4be8fab5a01df"

def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", value):
        raise ValueError("INVALID_IDENTIFIER")
    return value

async def run(data):
    source = Path(os.environ["QITU_DEEPTUTOR_SOURCE"]).resolve()
    if (source / "QITU_PIN").read_text().strip() != PIN:
        return {"ok": False, "errorCode": "UPSTREAM_VERSION_MISMATCH"}
    root = Path(os.environ["QITU_KNOWLEDGE_DATA"]).resolve()
    # Upstream runtime settings must never default to the shared API cwd.
    workspace = root / safe_id(data.get("kbId", "preflight")) / safe_id(data.get("versionId", "check"))
    workspace.mkdir(parents=True, exist_ok=True)
    os.environ["DEEPTUTOR_HOME"] = str(workspace)
    from deeptutor.services.embedding.config import EmbeddingConfig, embedding_config_scope
    from deeptutor.services.embedding import get_embedding_client
    from deeptutor.services.rag.service import RAGService
    embedding = EmbeddingConfig(**data["embedding"])
    # One process per operation: upstream module settings cannot leak between tenants.
    import deeptutor.services.rag.pipelines.llamaindex.config as upstream_config
    settings = dict(data.get("config", {}))
    for local, upstream in {"vector_candidate_multiplier": "vector_top_k_multiplier", "bm25_candidate_multiplier": "bm25_top_k_multiplier", "image_description_timeout": "image_description_timeout_seconds"}.items():
        if local in settings:
            settings[upstream] = settings.pop(local)
    upstream_config._load_runtime_settings = lambda: settings
    with embedding_config_scope(embedding):
        from linked_runtime import linked_request
        linked = await linked_request(data, RAGService)
        if linked is not None:
            return linked
        if data["operation"] == "check":
            client = get_embedding_client(embedding)
            # Actual vector request; dependency import alone is insufficient.
            await client.embed(["知识引擎连接检查"])
            return {"ok": True}
        version = safe_id(data["versionId"])
        kb = safe_id(data["kbId"])
        workspace = root / kb / version
        workspace.mkdir(parents=True, exist_ok=True)
        service = RAGService(kb_base_dir=str(workspace), provider="llamaindex")
        kb_name = "kb_" + hashlib.sha256(kb.encode()).hexdigest()[:24]
        if data["operation"] == "build":
            materials = workspace / "materials"
            materials.mkdir(exist_ok=True)
            files = []
            for member in data["members"]:
                path = materials / (safe_id(member["id"]) + ".txt")
                path.write_text(member["content"], encoding="utf-8")
                files.append(str(path))
            if not files:
                return {"ok": False, "errorCode": "NO_ELIGIBLE_SOURCE"}
            ok = await RAGService.initialize.__wrapped__(service, kb_name, files)
            if not ok:
                return {"ok": False, "errorCode": "INDEX_BUILD_FAILED"}
            result = await RAGService.search.__wrapped__(service, data["testQuery"], kb_name, top_k=1)
            if result.get("error_type") or not result.get("sources"):
                return {"ok": False, "errorCode": "INDEX_VALIDATION_FAILED"}
            return {"ok": True, "manifest": {"documents": len(files), "upstreamCommit": PIN, "validated": True}}
        result = await RAGService.search.__wrapped__(service, data["query"], kb_name, top_k=min(8, max(1, data.get("topK", 5))))
        if result.get("error_type"):
            return {"ok": False, "errorCode": "PROJECT_KB_UNAVAILABLE"}
        hits = []
        for item in result.get("sources", []):
            member_id = Path(item.get("source", "")).stem
            if member_id not in data["allowedMemberIds"]:
                continue
            hits.append({"memberId": member_id, "text": str(item.get("text", item.get("content", "")))[:2400], "score": item.get("score"), "locator": None})
        return {"ok": True, "hits": hits}

if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(8 * 1024 * 1024))
        # Upstream diagnostics may include paths; keep stdout a bounded JSON protocol.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            response = asyncio.run(run(request))
    except ImportError:
        response = {"ok": False, "errorCode": "ENGINE_DEPENDENCY_MISSING"}
    except Exception:
        response = {"ok": False, "errorCode": "ENGINE_EXECUTION_FAILED"}
    print(json.dumps(response, ensure_ascii=False))
