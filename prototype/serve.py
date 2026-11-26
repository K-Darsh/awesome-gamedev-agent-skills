#!/usr/bin/env python3
"""Static dev server for the Neon Coast prototype.

Why not `python3 -m http.server`: that one handles a single request at a time. The game loads
21 ES modules in parallel, so a stalled socket can leave the page half-booted with no error in the
console. This server is threaded, serves modules with the right MIME type, and disables caching so a
reload always picks up edited files.

Usage: python3 serve.py [port] [--bind 0.0.0.0] [--directory .]
"""
from __future__ import annotations

import argparse
import functools
import http.server
import sys
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Threaded static server for the prototype")
    parser.add_argument("port", nargs="?", type=int, default=8123)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parent))
    args = parser.parse_args(argv)

    handler = functools.partial(Handler, directory=args.directory)
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        httpd.daemon_threads = True
        print(f"Neon Coast on http://{args.bind}:{args.port} (root {args.directory})", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("stopped", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
