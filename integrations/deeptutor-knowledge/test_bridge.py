"""Adapter integration test; deterministic fixture vectors are NEVER used by production."""
import asyncio
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest


class EmbeddingFixture(BaseHTTPRequestHandler):
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["content-length"])))
        inputs = request["input"]
        if isinstance(inputs, str):
            inputs = [inputs]
        data = [{"object": "embedding", "index": i, "embedding": [float(x + 1) / 256 for x in hashlib.sha256(text.encode()).digest()]} for i, text in enumerate(inputs)]
        body = json.dumps({"object": "list", "data": data, "model": "fixture", "usage": {"prompt_tokens": 0, "total_tokens": 0}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class BridgeIntegration(unittest.TestCase):
    def test_original_pipeline_build_search_and_membership_filter(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), EmbeddingFixture)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory(prefix="qitu-knowledge-fixture-") as data:
                os.environ["QITU_KNOWLEDGE_DATA"] = data
                spec = importlib.util.spec_from_file_location("bridge", Path(__file__).with_name("bridge.py"))
                bridge = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(bridge)
                request = {"embedding": {"model": "fixture", "api_key": "test-only", "binding": "openai", "base_url": f"http://127.0.0.1:{server.server_port}/v1/embeddings", "dim": 32}, "config": {"retrieval_profile": "vector"}, "kbId": "test-kb", "versionId": "test-version"}
                result = asyncio.run(bridge.run({**request, "operation": "build", "members": [{"id": "material-one", "content": "Test material about conservation of energy. Energy is conserved in isolated systems."}], "testQuery": "conservation of energy"}))
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["manifest"]["documents"], 1)
                result = asyncio.run(bridge.run({**request, "operation": "search", "query": "energy", "allowedMemberIds": ["material-one"]}))
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["hits"][0]["memberId"], "material-one")
                self.assertNotIn(data, json.dumps(result))
                result = asyncio.run(bridge.run({**request, "operation": "search", "query": "energy", "allowedMemberIds": []}))
                self.assertEqual(result["hits"], [])
                self.assertFalse((Path.cwd() / "data" / "knowledge_bases" / "test-kb").exists())
        finally:
            server.shutdown()


if __name__ == "__main__":
    unittest.main()
