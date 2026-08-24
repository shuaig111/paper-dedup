"""本地静态服务器 + DeepSeek API 代理（Python 3.8+，零第三方依赖）
与 server.js 功能一致，作为 Node 不存在时的备选。
  python server.py          仅本机访问
  python server.py --lan    局域网访问（自动打印局域网网址）
"""
import http.server
import json
import os
import socket
import sys
import urllib.parse
import urllib.request
import webbrowser

PORT = int(os.environ.get("PORT", "8642"))
ROOT = os.path.dirname(os.path.abspath(__file__))
LAN = "--lan" in sys.argv

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".md": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


def lan_addresses():
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        out.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return out


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        import urllib.parse
        rel = urllib.parse.unquote(self.path.split("?")[0])
        if rel == "/":
            rel = "/index.html"
        target = os.path.normpath(os.path.join(ROOT, rel.lstrip("/")))
        if not target.startswith(ROOT):
            self._send(403, b"Forbidden", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(target):
            self._send(404, b"404 Not Found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(target)[1].lower()
        with open(target, "rb") as f:
            data = f.read()
        self._send(200, data, MIME.get(ext, "application/octet-stream"))

    def do_POST(self):
        if not self.path.startswith("/api/"):
            self._send(405, b"Method Not Allowed", "text/plain; charset=utf-8")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self._send(400, json.dumps({"error": "bad json"}).encode())
            return
        key = payload.get("key", "")
        if not key:
            self._send(400, json.dumps({"error": "missing api key"}).encode())
            return

        def do_fetch(url, headers, data):
            req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=600) as resp:
                    out = resp.read()
                    self.send_response(resp.status)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(out)))
                    self.end_headers()
                    self.wfile.write(out)
            except urllib.error.HTTPError as e:
                out = e.read()
                self.send_response(e.code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)
            except Exception as e:
                self._send(502, json.dumps({"error": "proxy failed: %s" % e}).encode())

        if self.path.startswith("/api/chat-anthropic"):
            do_fetch(
                "https://api.anthropic.com/v1/messages",
                {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
                payload.get("payload", {}),
            )
        elif self.path.startswith("/api/chat-gemini"):
            model = payload.get("model", "")
            if not model:
                self._send(400, json.dumps({"error": "missing model"}).encode())
                return
            url = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s" % (
                urllib.parse.quote(model), urllib.parse.quote(key))
            do_fetch(url, {"Content-Type": "application/json"}, payload.get("payload", {}))
        elif self.path.startswith("/api/chat"):
            base_url = str(payload.get("baseUrl", "https://api.deepseek.com")).rstrip("/")
            do_fetch(
                base_url + "/chat/completions",
                {"Content-Type": "application/json", "Authorization": "Bearer " + key},
                payload.get("payload", {}),
            )
        elif self.path.startswith("/api/parse-doc"):
            self._send(400, json.dumps({"error": "Python 版不支持 .doc 解析，请使用 node server.js"}).encode())
        else:
            self._send(404, json.dumps({"error": "not found"}).encode())


if __name__ == "__main__":
    host = "0.0.0.0" if LAN else "127.0.0.1"
    url = "http://127.0.0.1:%d" % PORT
    print("论文降重助手已启动: %s （按 Ctrl+C 停止）" % url)
    if LAN:
        for ip in lan_addresses():
            print("  局域网访问: http://%s:%d" % (ip, PORT))
        print("  首次运行如弹出 Windows 防火墙提示，请选择“允许访问”")
    else:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    server = http.server.ThreadingHTTPServer((host, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
