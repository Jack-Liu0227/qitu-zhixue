#!/usr/bin/env python3
"""Check the CSS/JS referenced by deployed Next.js pages, without logging in."""

import argparse
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.urls[attrs.get('href', '')] = 'css'
        elif tag == 'script' and attrs.get('src'):
            self.urls[attrs['src']] = 'js'


def check_page(base_url, route, timeout=15):
    page_url = urljoin(base_url.rstrip('/') + '/', route)
    with urlopen(page_url, timeout=timeout) as response:
        if response.status != 200 or response.headers.get_content_type() != 'text/html':
            raise ValueError(f'{route}: expected HTTP 200 HTML')
        # An auth redirect can conceal broken assets on the intended route.
        if urlsplit(response.url).path.rstrip('/') != urlsplit(page_url).path.rstrip('/'):
            raise ValueError(f'{route}: unexpected redirect')
        parser = Assets()
        parser.feed(response.read().decode('utf-8'))
    if 'css' not in parser.urls.values() or 'js' not in parser.urls.values():
        raise ValueError(f'{route}: missing stylesheet or script references')
    for href, kind in parser.urls.items():
        asset_url = urljoin(page_url, href)
        if urlsplit(asset_url).netloc != urlsplit(page_url).netloc:
            raise ValueError(f'{route}: unexpected external asset')
        with urlopen(asset_url, timeout=timeout) as response:
            content_type = response.headers.get_content_type()
            allowed = {'text/css'} if kind == 'css' else {'application/javascript', 'text/javascript'}
            if response.status != 200 or content_type not in allowed or not response.read(1):
                raise ValueError(f'{href}: expected nonempty HTTP 200 {kind}, got {response.status} {content_type}')
    return len(parser.urls)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1')
    parser.add_argument('--route', action='append', dest='routes')
    args = parser.parse_args()
    failures = 0
    for route in args.routes or ['/parent', '/parent/login', '/parent/progress', '/parent/messages']:
        try:
            count = check_page(args.base_url, route)
            print(f'PASS {route}: {count} stylesheet/script references')
        except Exception as exc:
            failures += 1
            print(f'FAIL {route}: {exc}', file=sys.stderr)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
