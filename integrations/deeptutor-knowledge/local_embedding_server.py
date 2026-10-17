"""Private CPU embedding endpoint for Qitu. No chat or text generation API."""
from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading

from fastembed import TextEmbedding

MODEL = "BAAI/bge-small-zh-v1.5"
MODEL_ID = "bge-small-zh-v1.5"
MAX_BYTES = 512 * 1024


def main():
    token = os.environ["QITU_LOCAL_EMBEDDING_TOKEN"]
    if len(token) < 32:
        raise ValueError("Local embedding token must be configured")
    model = TextEmbedding(
        model_name=MODEL,
        cache_dir=os.environ["QITU_LOCAL_EMBEDDING_CACHE"],
        threads=2,
        providers=["CPUExecutionProvider"],
        local_files_only=True,
    )
    # Prove model loading before systemd's process can serve health.
    if len(next(model.embed(["中文向量预检"]))) != 512:
        raise ValueError("Unexpected embedding dimensions")
    lock = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def authenticated(self):
            return hmac.compare_digest(self.headers.get("authorization", ""), "Bearer " + token)

        def do_GET(self):
            if not self.authenticated():
                return self.send_json(401, {"error": {"code": "UNAUTHORIZED"}})
            if self.path == "/v1/models":
                return self.send_json(200, {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "qitu-local", "dimensions": 512, "capability": "embedding"}]})
            if self.path == "/health":
                return self.send_json(200, {"status": "ready", "model": MODEL_ID, "dimensions": 512})
            self.send_json(404, {"error": {"code": "NOT_FOUND"}})

        def do_POST(self):
            if not self.authenticated():
                return self.send_json(401, {"error": {"code": "UNAUTHORIZED"}})
            if self.path != "/v1/embeddings":
                return self.send_json(404, {"error": {"code": "NOT_FOUND"}})
            try:
                length = int(self.headers.get("content-length", "0"))
                if length < 1 or length > MAX_BYTES:
                    return self.send_json(413, {"error": {"code": "PAYLOAD_LIMIT"}})
                request = json.loads(self.rfile.read(length))
                texts = request.get("input")
                if isinstance(texts, str):
                    texts = [texts]
                if request.get("model") != MODEL_ID or not isinstance(texts, list) or not 1 <= len(texts) <= 32 or any(not isinstance(t, str) or not t.strip() or len(t) > 20000 for t in texts):
                    return self.send_json(400, {"error": {"code": "INVALID_EMBEDDING_INPUT"}})
                if not lock.acquire(timeout=20):
                    return self.send_json(429, {"error": {"code": "EMBEDDING_BUSY"}})
                try:
                    vectors = [value.tolist() for value in model.embed(texts, batch_size=8)]
                finally:
                    lock.release()
                self.send_json(200, {"object": "list", "model": MODEL_ID, "data": [{"object": "embedding", "index": i, "embedding": vector} for i, vector in enumerate(vectors)]})
            except Exception:
                self.send_json(500, {"error": {"code": "EMBEDDING_FAILED"}})

        def log_message(self, *_):
            # No request data, authorization header or raw model error in logs.
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 4115), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
