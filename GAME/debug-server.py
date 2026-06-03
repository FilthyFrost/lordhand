#!/usr/bin/env python3
"""
带DEBUG日志收集功能的HTTP服务器
游戏通过 POST /debug-log 发送日志
日志保存在 debug-output.json
"""
import http.server
import json
import os
import time

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'debug-output.json')

class DebugHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/debug-log':
            content_length = int(self.headers['Content-Length'])
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                data['server_time'] = time.time()
                # Append to log file
                logs = []
                if os.path.exists(LOG_FILE):
                    try:
                        with open(LOG_FILE) as f:
                            logs = json.load(f)
                    except:
                        logs = []
                # Keep last 60 entries (1 minute of data at 1/sec)
                logs.append(data)
                logs = logs[-60:]
                with open(LOG_FILE, 'w') as f:
                    json.dump(logs, f, indent=2)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress access logs for cleaner output
        if '/debug-log' not in args[0]:
            super().log_message(format, *args)

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('', 8080), DebugHandler)
    print(f'Debug server running on http://localhost:8080')
    print(f'Logs will be saved to: {LOG_FILE}')
    server.serve_forever()
