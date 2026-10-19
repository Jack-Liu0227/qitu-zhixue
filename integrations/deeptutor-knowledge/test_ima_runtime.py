"""Exercise the actual DeepTutor client with a controlled HTTP transport."""
import asyncio
import json
import unittest
from unittest.mock import patch
import httpx
import engine_runtime
from deeptutor.services.rag.pipelines.ima.transport import ImaTransport


class ImaDiscoveryTests(unittest.TestCase):
    def request(self, operation="list_bases", **extra):
        return {"provider": "ima", "operation": operation,
                "config": {"server_url": "https://ima.qq.com", "apiKey": "fixture-secret", "clientId": "fixture-client"}, **extra}

    def test_discovery_pages_through_official_client_without_echoing_credentials(self):
        calls = []
        async def post(wire, method, body, **kwargs):
            calls.append((method, body))
            if method == "search_knowledge_base":
                return {"info_list": [{"id": "official-id", "name": "物理"}], "next_cursor": "page-2", "is_end": False}
            return {"infos": {"official-id": {"description": "教材", "apiKey": "never-return"}}}
        with patch.object(ImaTransport, "post", post):
            receipt = asyncio.run(engine_runtime.run(self.request(cursor="page-1", limit=20)))
        self.assertTrue(receipt["ok"])
        self.assertEqual(receipt["manifest"]["knowledgeBases"], [{"id": "official-id", "name": "物理", "description": "教材"}])
        self.assertEqual(calls[0], ("search_knowledge_base", {"query": "", "cursor": "page-1", "limit": 20}))
        self.assertEqual(receipt["manifest"]["nextCursor"], "page-2")
        self.assertFalse(receipt["manifest"]["isEnd"])
        self.assertNotIn("secret", json.dumps(receipt))
        self.assertNotIn("never-return", json.dumps(receipt))

    def test_selected_openapi_id_wins_over_engine_default_and_client_id_is_rejected(self):
        seen = []
        async def post(wire, method, body, **kwargs):
            seen.append(body)
            return {"infos": {"selected": {"name": "选定教材"}}}
        request = self.request("connect", externalRef={"remoteKnowledgeBaseId": "selected"})
        request["config"]["remoteKnowledgeBaseId"] = "old-default"
        with patch.object(ImaTransport, "post", post):
            receipt = asyncio.run(engine_runtime.run(request))
            self.assertTrue(receipt["ok"])
            self.assertEqual(seen, [{"ids": ["selected"]}])
            request["externalRef"]["remoteKnowledgeBaseId"] = "fixture-client"
            self.assertEqual(asyncio.run(engine_runtime.run(request))["errorCode"], "IMA_KB_ID_IS_CLIENT_ID")
            request["externalRef"]["remoteKnowledgeBaseId"] = "internal-page-id"
            self.assertEqual(asyncio.run(engine_runtime.run(request))["errorCode"], "REMOTE_RESOURCE_NOT_FOUND")

    def test_actual_http_envelope_maps_credential_rate_and_gateway_errors(self):
        original = httpx.AsyncClient
        cases = [(200, {"retcode": 20004, "errmsg": "fixture-secret"}, "IMA_CREDENTIALS_REJECTED"),
                 (200, {"code": 200002, "msg": "fixture-secret"}, "IMA_CREDENTIALS_REJECTED"),
                 (429, {}, "IMA_RATE_LIMITED"), (502, {"code": 0}, "IMA_UPSTREAM_INVALID_RESPONSE")]
        for status, body, code in cases:
            def respond(request):
                self.assertEqual(request.headers["ima-openapi-clientid"], "fixture-client")
                self.assertEqual(request.headers["ima-openapi-apikey"], "fixture-secret")
                return httpx.Response(status, json=body)
            def factory(**kwargs):
                return original(**{**kwargs, "transport": httpx.MockTransport(respond)})
            with patch.object(httpx, "AsyncClient", factory):
                receipt = asyncio.run(engine_runtime.run(self.request()))
            self.assertEqual(receipt["errorCode"], code)
            self.assertNotIn("fixture-secret", json.dumps(receipt))

    def test_documents_operation_reaches_client_instead_of_rejected_whitelist(self):
        async def post(wire, method, body, **kwargs):
            self.assertEqual(method, "get_knowledge_list")
            return {"info_list": [{"media_id": "doc-1", "title": "教材.pdf"}], "is_end": True}
        with patch.object(ImaTransport, "post", post):
            result = asyncio.run(engine_runtime.run(self.request("documents", externalRef={"remoteKnowledgeBaseId": "selected"})))
        self.assertTrue(result["ok"])
        self.assertEqual(result["manifest"]["items"][0]["id"], "doc-1")


if __name__ == "__main__":
    unittest.main()
