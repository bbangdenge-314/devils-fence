import functools, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class Q(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def serve(root, port):
    httpd = ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Q, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
