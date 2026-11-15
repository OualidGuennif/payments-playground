"""A local stand-in for an aeion-framework 1.1.9 service: each route answers what a test sets, and
every request is remembered with its gateway header. No network beyond 127.0.0.1, no install."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
from urllib.parse import parse_qsl, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude/hooks"))
import aeion_settings  # noqa: E402


def problem(status, code, detail):
    """An RFC 9457 problem document as the service sends it."""
    return status, {"type": "about:blank", "title": code, "status": status, "code": code, "detail": detail}, {}


class Service:
    def __init__(self):
        self.routes, self.seen = {}, []
        self.set("/health/ready", 200, {"status": "ready", "mode": "sandbox", "version": aeion_settings.TESTED})
        service = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parts = urlsplit(self.path)
                service.seen.append((self.path, self.headers.get("Authorization")))
                answer = service.routes.get(parts.path)
                status, body, headers = (answer(dict(parse_qsl(parts.query))) if answer
                                         else problem(404, "NOT_FOUND", f"no route {parts.path}"))
                if isinstance(body, str):
                    raw, kind = body.encode(), "text/plain"
                else:
                    raw = json.dumps(body).encode()
                    kind = "application/problem+json" if status >= 400 else "application/json"
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(raw)))
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def set(self, path, status, body, headers=None):
        """Every request to path gets this answer."""
        self.routes[path] = lambda query: (status, body, headers or {})

    def route(self, path, answer):
        """Requests to path are answered by answer(query) -> (status, body, headers)."""
        self.routes[path] = answer

    def close(self):
        self.server.shutdown()
        self.server.server_close()
