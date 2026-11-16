#!/usr/bin/env python3
"""Serve the real site with synthetic-only JSON, without fetching providers."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import argparse

FIXTURES = Path(__file__).resolve().parent
SITE = FIXTURES.parents[2] / 'site'


class SyntheticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def translate_path(self, path):
        name = urlsplit(path).path
        if name.startswith('/data/'):
            # Unknown/malformed names resolve to a missing fixture, never real data.
            filename = name.removeprefix('/data/')
            if filename in {file.name for file in FIXTURES.glob('*.json')}:
                return str(FIXTURES / filename)
            return str(FIXTURES / 'unavailable.json')
        return super().translate_path(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    print(f'Synthetic fixtures only: http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer.request_queue_size = 64
    ThreadingHTTPServer(('127.0.0.1', args.port), SyntheticHandler).serve_forever()
