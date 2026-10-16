"""Verify the deployment check catches HTML-200/resource-failure regressions."""

import importlib.util
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location('assets', Path(__file__).with_name('check-frontend-assets.py'))
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class Handler(BaseHTTPRequestHandler):
    css_status = 200
    css_type = 'text/css'

    def do_GET(self):
        is_css = self.path == '/parent/_next/static/site.css'
        self.send_response(self.css_status if is_css else 200)
        self.send_header('Content-Type', self.css_type if is_css else 'application/javascript' if self.path.endswith('.js') else 'text/html')
        self.end_headers()
        self.wfile.write(b'body{}' if is_css else b'console.log(1)' if self.path.endswith('.js') else b'<link rel="stylesheet" href="/parent/_next/static/site.css"><script src="/parent/_next/static/app.js"></script>')

    def log_message(self, *_):
        pass


class AssetChecks(unittest.TestCase):
    def test_page_and_assets(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for status, content_type, success in [(200, 'text/css', True), (400, 'text/html', False), (404, 'text/plain', False), (200, 'text/html', False)]:
                with self.subTest(status=status, content_type=content_type):
                    Handler.css_status, Handler.css_type = status, content_type
                    if success:
                        self.assertEqual(assets.check_page(f'http://127.0.0.1:{server.server_port}', '/parent'), 2)
                    else:
                        with self.assertRaises(Exception):
                            assets.check_page(f'http://127.0.0.1:{server.server_port}', '/parent')
        finally:
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
