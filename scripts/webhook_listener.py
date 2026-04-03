#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer


HOST = "127.0.0.1"
PORT = 9001
DEPLOY_SCRIPT = "/www/wwwroot/glowing-winner/deploy.sh"
WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
DEPLOY_LOG = os.environ.get(
    "DEPLOY_LOG_PATH", "/www/wwwroot/glowing-winner/logs/webhook-deploy.log"
)


class GitHubWebhookHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def _trigger_deploy_async(self) -> None:
        log_dir = os.path.dirname(DEPLOY_LOG)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        with open(DEPLOY_LOG, "a", encoding="utf-8") as log_file:
            log_file.write(
                f"\n[{datetime.now(timezone.utc).isoformat()}] webhook accepted, starting deploy\n"
            )
            log_file.flush()
            subprocess.Popen(
                [DEPLOY_SCRIPT],
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )

    def do_POST(self) -> None:
        if self.path != "/github-webhook":
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

        if data.get("ref") != "refs/heads/main":
            self._send(200, "ignored: not main branch")
            return

        try:
            self._trigger_deploy_async()
        except OSError as exc:
            self._send(500, f"failed to queue deploy: {exc}")
            return

        self._send(202, "deploy queued")

    def log_message(self, fmt: str, *args) -> None:
        return


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), GitHubWebhookHandler)
    print(f"GitHub webhook listener started at http://{HOST}:{PORT}/github-webhook")
    server.serve_forever()
