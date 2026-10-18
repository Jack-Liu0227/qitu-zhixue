"""Wire-level tests use DeepTutor's real HTTP client against a local fixture."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
import engine_runtime as runtime


class EngineRuntimeTests(unittest.TestCase):
    def test_only_page_reads_from_authorized_members_are_evidence(self):
        payload = json.dumps({"doc_name":"member-one.pdf","content":[{"page":3,"text":"Actual page text"}]})
        self.assertEqual(runtime.page_hits(payload,{"member-one"})[0]["locator"]["page"],3)
        self.assertEqual(runtime.page_hits(payload,{"another-member"}),[])
        self.assertEqual(runtime.page_hits('Generated answer',{"member-one"}),[])
        self.assertEqual(runtime.page_hits('{"success":false}',{"member-one"}),[])
        documents = {"member-one.pdf":"owned-doc"}
        self.assertTrue(runtime.page_arguments_allowed({"doc_id":"owned-doc","pages":[1]},documents))
        self.assertFalse(runtime.page_arguments_allowed({"doc_id":"foreign-doc"},documents))
        self.assertFalse(runtime.page_arguments_allowed({},documents))
        self.assertFalse(runtime.page_arguments_allowed({"doc_ids":["owned-doc","foreign-doc"]},documents))

    def test_extended_bridge_keeps_admin_and_execution_surfaces_out(self):
        import ast
        source = Path(runtime.__file__).read_text()
        tree = ast.parse(source)
        for node in ast.walk(tree):
            names = [node.module or ""] if isinstance(node,ast.ImportFrom) else [a.name for a in node.names] if isinstance(node,ast.Import) else []
            for name in names:
                if name.startswith('deeptutor.'):
                    self.assertTrue(name.startswith(('deeptutor.services.rag.', 'deeptutor.services.embedding', 'deeptutor.services.llm.config', 'deeptutor.services.config', 'deeptutor.services.model_selection.runtime', 'deeptutor.capabilities.marginnote4.store')),name)
        for name in ('deeptutor.api', 'deeptutor.services.skill', 'deeptutor.services.sandbox'):
            self.assertNotIn(name,source)

    def test_original_marginnote_store_checks_pairing_and_reads_synced_notes(self):
        from deeptutor.capabilities.marginnote4.store import MarginNoteStore
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'notes.db'
            store = MarginNoteStore(path)
            device, _ = store.pair_device(device_name='fixture',device_kind='macos')
            request = {"provider":"marginnote","operation":"check","config":{"databasePath":str(path),"deviceId":device.device_id}}
            with patch.dict(os.environ,{"QITU_KNOWLEDGE_FOLDER_ROOTS":folder}):
                self.assertTrue(asyncio.run(runtime.remote(request))["ok"])
                store.revoke_device(device.device_id)
                self.assertFalse(asyncio.run(runtime.remote(request))["ok"])

    def test_private_hosts_require_explicit_allowlist(self):
        with patch.dict(os.environ, {"QITU_KNOWLEDGE_REMOTE_ORIGINS": ""}):
            with self.assertRaisesRegex(ValueError, "REMOTE_URL_NOT_ALLOWED"):
                runtime.safe_url("http://127.0.0.1:1234")
            with self.assertRaisesRegex(ValueError, "REMOTE_URL_INVALID"):
                runtime.safe_url("https://user:secret@example.com")

    def test_vault_path_is_confined_to_allowlist(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as other:
            with patch.dict(os.environ, {"QITU_KNOWLEDGE_FOLDER_ROOTS": root}):
                self.assertEqual(runtime.allowed_path(root), Path(root))
                with self.assertRaises(ValueError): runtime.allowed_path(other)

    def test_real_lightrag_sdk_checks_auth_and_retrieves_context(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                calls.append((self.path, self.headers.get("X-API-Key")))
                data = {"core_version":"test","auth_configured":True} if self.path == "/auth-status" else {"busy":False}
                self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers();self.wfile.write(json.dumps(data).encode())
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self.assert_context(body)
                calls.append((self.path, body))
                self.send_response(200);self.end_headers();self.wfile.write(b'{"response":"grounded evidence","references":[]}')
            @staticmethod
            def assert_context(body):
                assert body["only_need_context"] is True
                assert body["mode"] == "hybrid"
        server = ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            with patch.dict(os.environ,{"QITU_KNOWLEDGE_REMOTE_ORIGINS":origin,"QITU_LIGHTRAG_SERVER_API_KEY":"fixture-key"}):
                request={"provider":"lightrag-server","config":{"server_url":origin,"mode":"hybrid"},"operation":"check"}
                self.assertTrue(asyncio.run(runtime.remote(request))["ok"])
                request.update(operation="search",query="question")
                self.assertEqual(asyncio.run(runtime.remote(request))["manifest"]["content"],"grounded evidence")
                self.assertTrue(all(key=="fixture-key" for path,key in calls if path!="/query"))
        finally:server.shutdown();server.server_close();thread.join()

    def test_ima_uses_edited_credentials_and_original_document_parser(self):
        from deeptutor.services.rag.pipelines.ima.transport import ImaTransport, build_headers
        calls = []
        async def post(wire, method, body, **kwargs):
            headers = build_headers(wire.config)
            assert headers["ima-openapi-clientid"] == "edited-client"
            assert headers["ima-openapi-apikey"] == "edited-key"
            calls.append((method, body))
            if method == "search_knowledge_base": return {"knowledge_bases": [], "is_end": True}
            if method == "get_knowledge_base": return {"infos": {"known-kb": {"name": "Fixture"}}}
            return {"info_list": [{"media_id": "doc-1", "title": "Fixture", "highlight_content": "grounded snippet"}], "is_end": True}
        request = {"provider":"ima", "operation":"check", "config":{}, "credentials":{"clientId":"edited-client","apiKey":"edited-key"}}
        with patch.object(ImaTransport, "post", post):
            self.assertTrue(asyncio.run(runtime.remote(request))["ok"])
            request.update(operation="connect", externalRef={"remoteKnowledgeBaseId":"unknown-kb"})
            self.assertEqual(asyncio.run(runtime.remote(request))["errorCode"], "REMOTE_RESOURCE_NOT_FOUND")
            request.update(operation="search", remoteKnowledgeBaseId="known-kb", externalRef={}, query="question")
            found = asyncio.run(runtime.remote(request))
            self.assertEqual(found["manifest"]["items"][0]["media_id"],"doc-1")
            self.assertEqual(found["manifest"]["items"][0]["highlight_content"],"grounded snippet")
            self.assertEqual(calls[-1][1]["knowledge_base_id"], "known-kb")

    def test_weknora_edited_key_reaches_real_rest_client(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                calls.append((self.path, self.headers.get("X-API-Key")))
                self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers()
                self.wfile.write(b'{"data":[{"id":"kb-1","name":"Fixture"}]}')
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                assert body == {"knowledge_base_id":"kb-1", "query":"question"}
                calls.append((self.path, self.headers.get("X-API-Key")))
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"data":[{"content":"grounded snippet"}]}')
        server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        origin=f"http://127.0.0.1:{server.server_port}"
        try:
            with patch.dict(os.environ,{"QITU_KNOWLEDGE_REMOTE_ORIGINS":origin,"QITU_WEKNORA_API_KEY":"old-key"}):
                request={"provider":"weknora","operation":"search","config":{"server_url":origin,"remoteKnowledgeBaseId":"kb-1"},"query":"question","credentials":{"apiKey":"edited-key"}}
                self.assertEqual(asyncio.run(runtime.remote(request))["manifest"]["items"][0]["content"],"grounded snippet")
                self.assertTrue(all(key=="edited-key" for _,key in calls))
                self.assertEqual(calls[-1][0],"/api/v1/knowledge-search?resource_urls=handle")
        finally: server.shutdown();server.server_close();thread.join()


if __name__ == "__main__": unittest.main()
