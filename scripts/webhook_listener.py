#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer


HOST = os.environ.get("WEBHOOK_HOST", "127.0.0.1")
PORT = int(os.environ.get("WEBHOOK_PORT", "9001"))
WEBHOOK_PATH = os.environ.get("WEBHOOK_PATH", "/github-webhook")
DEPLOY_SCRIPT = os.environ.get(
    "DEPLOY_SCRIPT", "/www/wwwroot/glowing-winner/deploy.sh"
)
WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
TARGET_REF = os.environ.get("WEBHOOK_TARGET_REF", "refs/heads/main")


class GitHubWebhookHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def do_POST(self) -> None:
        if self.path != WEBHOOK_PATH:
            self._send(404, "not found")
            return

        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length)

        signature = self.headers.get("X-Hub-Signature-256", "")
        if not WEBHOOK_SECRET:
            self._send(500, "server secret not configured")
            return

        expected = "sha256=" + hmac.new(
            WEBHOOK_SECRET.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(expected, signature):
            self._send(403, "invalid signature")
            return

        event = self.headers.get("X-GitHub-Event", "")
        if event != "push":
            self._send(200, "ignored: not push event")
            return

        try:
            data = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, "invalid json")
            return

        if data.get("ref") != TARGET_REF:
            self._send(200, "ignored: not target branch")
            return

        result = subprocess.run(
            [DEPLOY_SCRIPT], capture_output=True, text=True, check=False
        )
        if result.returncode != 0:
            self._send(500, f"deploy failed\n{result.stdout}\n{result.stderr}")
            return

        self._send(200, "deploy success")

    def log_message(self, fmt: str, *args) -> None:
        return


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), GitHubWebhookHandler)
    print(f"GitHub webhook listener started at http://{HOST}:{PORT}{WEBHOOK_PATH}")
    server.serve_forever()
