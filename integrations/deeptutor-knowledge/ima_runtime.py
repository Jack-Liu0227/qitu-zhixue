"""Read-only IMA connection flow, using DeepTutor's pinned official client.

Account credentials are independent from OpenAPI knowledge-base IDs. No upstream
exceptions, credentials or whole responses are exposed to the admin API.
"""
import httpx
import base64
from deeptutor.services.rag.pipelines.ima.client import ImaClient
from deeptutor.services.rag.pipelines.ima.config import ImaConfig
from deeptutor.services.rag.pipelines.ima.envelope import ImaAPIError, ImaAuthError, ImaRateLimitError


def failure(code, status="needs_setup"):
    return {"ok": False, "status": status, "errorCode": code}


async def ima_request(data):
    config = data.get("config", {})
    credentials = {k: config.get(k, "") for k in ("apiKey", "clientId")}
    credentials.update(data.get("credentials") or {})
    key, client_id = (str(credentials.get(k) or "").strip() for k in ("apiKey", "clientId"))
    external = data.get("externalRef") or {}
    url = external.get("serverUrl") or config.get("server_url") or "https://ima.qq.com"
    if url.rstrip("/") != "https://ima.qq.com":
        return failure("ENGINE_CLOUD_URL_UNSUPPORTED")
    if not key or not client_id:
        return failure("ENGINE_NEEDS_KEY", "needs_key")
    # The selected library always wins over a reusable engine default.
    remote_id = str(external.get("remoteKnowledgeBaseId") or data.get("remoteKnowledgeBaseId")
                    or config.get("remoteKnowledgeBaseId") or "").strip()
    op = data["operation"]
    client = ImaClient(ImaConfig(client_id=client_id, api_key=key, knowledge_base_id=remote_id), timeout=12)
    try:
        manifest = {}
        if op in {"list_bases", "check"}:
            found = await client.search_knowledge_bases(
                cursor=str(data.get("cursor") or ""), limit=int(data.get("limit", 20)))
            items = [{"id": str(b["id"]), "name": str(b["name"])[:160],
                      "description": str(b.get("description") or "")[:2000] or None}
                     for b in found.get("knowledge_bases", [])[:50]]
            manifest = {"knowledgeBases": items, "nextCursor": found.get("next_cursor", ""),
                        "isEnd": bool(found.get("is_end", True)), "accessibleBases": len(items)}
        elif op == "connect":
            if remote_id == client_id:
                return failure("IMA_KB_ID_IS_CLIENT_ID")
            if not remote_id:
                return failure("REMOTE_RESOURCE_NOT_FOUND")
            info = await client.get_knowledge_base()
            if not info:
                return failure("REMOTE_RESOURCE_NOT_FOUND")
            manifest = {"remoteKnowledgeBaseId": remote_id, "name": str(info.get("name") or "")[:160],
                        "credentialsOk": True}
        elif op == "search":
            from deeptutor.services.rag.pipelines.ima.sources import documents_to_sources
            from deeptutor.services.rag.pipelines.ima.pipeline import ImaPipeline
            page = await client.search_knowledge(str(data.get("query", ""))[:2000], limit=8)
            sources = documents_to_sources(page.documents)
            await ImaPipeline()._hydrate(client, sources)
            manifest = {"items": [s for s in sources if str(s.get("content") or "").strip()]}
        elif op == "documents":
            page = await client.get_knowledge_list(folder_id=str(data.get("folderId") or ""),
                cursor=str(data.get("cursor") or ""), limit=50)
            manifest = {"items": [{"id": d.media_id, "title": d.title, "origin": {}} for d in page.documents],
                        "folders": [{"id": f.folder_id, "name": f.name} for f in page.folders],
                        "nextCursor": page.next_cursor, "isEnd": page.is_end}
        elif op in {"read_document", "read_original"}:
            from deeptutor.services.rag.pipelines.ima.media import extract_text
            media = await client.get_media_content(str(data.get("documentId") or ""))
            is_pdf = bool(media and media.data.startswith(b"%PDF-"))
            if op == "read_original":
                if not is_pdf:
                    return failure("SOURCE_ORIGINAL_UNAVAILABLE")
                manifest = {"body": base64.b64encode(media.data).decode("ascii"),
                            "mimeType": "application/pdf"}
                return {"ok": True, "status": "ready", "manifest": manifest}
            text = await extract_text(media, max_chars=100000) if media else ""
            if not text and not is_pdf:
                return failure("SOURCE_DOCUMENT_UNAVAILABLE")
            manifest = {"content": text, "origin": {"mimeType": "application/pdf" if is_pdf else "text/plain"}}
        else:
            return failure("ENGINE_OPERATION_INVALID")
        return {"ok": True, "status": "ready", "manifest": manifest}
    except ImaAuthError:
        return failure("IMA_CREDENTIALS_REJECTED", "needs_key")
    except ImaRateLimitError:
        return failure("IMA_RATE_LIMITED", "unavailable")
    except httpx.TimeoutException:
        return failure("IMA_TIMEOUT", "unreachable")
    except httpx.RequestError:
        return failure("IMA_UNREACHABLE", "unreachable")
    except ImaAPIError:
        return failure("IMA_UPSTREAM_INVALID_RESPONSE", "unavailable")
