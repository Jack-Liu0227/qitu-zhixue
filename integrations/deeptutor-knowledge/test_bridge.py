"""Adapter integration test; deterministic fixture vectors are NEVER used by production."""
import ast
import asyncio
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest


# 硬禁面：一旦加载即失败。这三类分别对应「第二可写权威源」「代码执行」「上游 HTTP/admin 面」。
HARD_FORBIDDEN_PREFIXES = (
    "deeptutor.services.skill",
    "deeptutor.services.sandbox",
    "deeptutor.api",
)

# 上游 RAG 服务的 import 链会**间接**加载下列 tools 模块。本适配器从不调用它们，
# 也无法在不改动 pinned 上游源码的前提下阻止模块级 import，因此改为钉死清单：
# 上游升级若让加载面增长，本测试立即失败。
PINNED_UPSTREAM_TOOLS_MODULES = frozenset({
    "deeptutor.tools",
    "deeptutor.tools.builtin",
    "deeptutor.tools.builtin_specs",
    "deeptutor.tools.prompting",
    "deeptutor.tools.question_bank",
})


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
    @classmethod
    def setUpClass(cls):
        cls.source = Path(__file__).parents[2] / "services" / "knowledge" / "source"
        os.environ["QITU_DEEPTUTOR_SOURCE"] = str(cls.source)
        # 生产路径由 knowledge-engine.service.ts 传 PYTHONPATH；测试必须自足，
        # 否则缺环境变量时表现为 ModuleNotFoundError（Error）而不是明确的 skip，
        # 容易被误读成代码缺陷。
        source_path = str(cls.source)
        if source_path not in sys.path:
            sys.path.insert(0, source_path)

    def test_bridge_import_surface_is_static_and_allowlisted(self):
        source = Path(__file__).with_name("bridge.py").read_text(encoding="utf-8")
        forbidden = (
            "deeptutor.services.skill",
            "deeptutor.tools",
            "deeptutor.services.sandbox",
            "deeptutor.api",
        )
        for module in forbidden:
            self.assertNotIn(module, source)
        tree = ast.parse(source)
        imports = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names if alias.name.startswith("deeptutor."))
            elif isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("deeptutor."):
                imports.add(node.module)
        self.assertEqual(
            imports,
            {
                "deeptutor.services.embedding.config",
                "deeptutor.services.embedding",
                "deeptutor.services.rag.service",
                "deeptutor.services.rag.pipelines.llamaindex.config",
            },
        )

    @unittest.skipUnless(
        (Path(__file__).parents[2] / "services" / "knowledge" / "source" / "deeptutor").is_dir(),
        "DeepTutor source is not installed under services/knowledge/source",
    )
    def test_real_bridge_does_not_import_out_of_scope_modules(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), EmbeddingFixture)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory(prefix="qitu-knowledge-boundary-") as data:
                os.environ["QITU_KNOWLEDGE_DATA"] = data
                os.environ["QITU_DEEPTUTOR_SOURCE"] = str(self.source)
                spec = importlib.util.spec_from_file_location("bridge_boundary", Path(__file__).with_name("bridge.py"))
                bridge = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(bridge)
                forbidden = HARD_FORBIDDEN_PREFIXES
                request = {"embedding": {"model": "fixture", "api_key": "test-only", "binding": "openai", "base_url": f"http://127.0.0.1:{server.server_port}/v1/embeddings", "dim": 32}, "kbId": "boundary-kb", "versionId": "boundary-version", "operation": "check"}
                result = asyncio.run(bridge.run(request))
                self.assertTrue(result["ok"], result)
                # 顺序无关：直接断言 sys.modules 的绝对状态。**不要**预先 del sys.modules——
                # 前一个用例已缓存 RAG import 链时，预先删除会让本测试假绿。
                loaded = set(sys.modules)
                for prefix in forbidden:
                    hits = sorted(name for name in loaded if name == prefix or name.startswith(prefix + "."))
                    self.assertEqual(hits, [], f"硬禁模块被加载：{prefix}")
                observed_tools = sorted(
                    name for name in loaded if name == "deeptutor.tools" or name.startswith("deeptutor.tools.")
                )
                unexpected = [name for name in observed_tools if name not in PINNED_UPSTREAM_TOOLS_MODULES]
                self.assertEqual(unexpected, [], "deeptutor.tools 间接加载面超出已钉清单")
        finally:
            server.shutdown()
            server.server_close()

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
            server.server_close()


if __name__ == "__main__":
    unittest.main()
