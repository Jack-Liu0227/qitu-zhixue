#!/usr/bin/env python3
"""Check usage/plan layout, local Markdown links and archive coverage without writes."""

import argparse
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit


ARCHIVE = Path('Plan/archive/pre-20261018')
USAGE_DIRECTORIES = {'aboutus', 'admin', 'student', 'teacher', 'parent', 'company', 'sdk', 'assets'}
PLAN_FILENAME = re.compile(r'(^release[-.]|[-](?:plan|report|implementation|verification|audit|design)(?:[-.]|$)|-release-)')
PLAN_HEADING = re.compile(r'^#{1,6} .*?(?:未决事项|实施计划|分阶段实施|发布回执)\s*$', re.MULTILINE)


def layout_issues(root):
    issues = []
    if 'Plan' not in {p.name for p in root.iterdir() if p.is_dir()}:
        issues.append('Plan: missing case-sensitive plan directory')
    if not (root / 'Plan/README.md').is_file():
        issues.append('Plan/README.md: missing plan index')
    for path in sorted((root / 'docs').rglob('*')):
        relative = path.relative_to(root / 'docs')
        location = path.relative_to(root).as_posix()
        if path.is_dir() and len(relative.parts) == 1 and path.name not in USAGE_DIRECTORIES:
            issues.append(f'{location}: docs is for usage guides; move planning/evidence directories to Plan/')
        if path.is_file() and path.suffix == '.md' and path.name != 'learning-plan.md' and PLAN_FILENAME.search(path.name):
            issues.append(f'{location}: planning/report filename belongs in Plan/')
        if path.is_file() and path.suffix == '.md':
            body = mask_code(path.read_text(encoding='utf-8-sig'))
            if PLAN_HEADING.search(body):
                issues.append(f'{location}: planning/release sections belong in Plan/')
    return issues


def mask_code(text):
    """Keep offsets stable so diagnostics point to the original Markdown lines."""
    lines = text.splitlines(keepends=True)
    fence = None
    for index, line in enumerate(lines):
        match = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        was_fenced = fence is not None
        if match:
            marker = match[1]
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence) and not match[2].strip():
                fence = None
        if was_fenced or fence is not None:
            lines[index] = re.sub(r'[^\r\n]', ' ', line)
    return re.sub(r'(`+)([^\n]*?)\1', lambda m: ' ' * len(m[0]), ''.join(lines))


def destination(raw):
    raw = raw.strip()
    if raw.startswith('<'):
        return raw[1:raw.find('>')] if '>' in raw else raw
    return re.sub(r'\\([() ])', r'\1', re.split(r'\s+[\'\"]', raw, maxsplit=1)[0])


def extract_links(text):
    text = mask_code(text)
    links = []
    for match in re.finditer(r'!?\[[^\]\n]*\]\(', text):
        start = match.end()
        depth = 1
        angle = False
        index = start
        while index < len(text) and text[index] != '\n':
            char = text[index]
            if char == '\\':
                index += 2
                continue
            if char == '<':
                angle = True
            elif char == '>':
                angle = False
            elif not angle and char == '(':
                depth += 1
            elif not angle and char == ')':
                depth -= 1
                if depth == 0:
                    links.append((text.count('\n', 0, match.start()) + 1, destination(text[start:index])))
                    break
            index += 1
    for match in re.finditer(r'^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)', text, re.MULTILINE):
        links.append((text.count('\n', 0, match.start()) + 1, destination(match[1])))
    return links


def local_target(root, document, href):
    if not href or href.startswith('#'):
        return None
    parsed = urlsplit(href)
    if parsed.scheme:
        if parsed.scheme.lower() == 'file' or re.match(r'^[A-Za-z]:', href):
            raise ValueError('nonportable local file URL')
        return None
    if parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    target = (root / path.lstrip('/') if path.startswith('/') else document.parent / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError('local target leaves the repository')
    return target


def validate(root):
    root = Path(root).resolve()
    docs = root / 'docs'
    plans = root / 'Plan'
    archive = root / ARCHIVE
    index = archive / 'README.md'
    if not docs.is_dir():
        return ['docs: missing documentation directory'], 0, 0
    issues = layout_issues(root)
    documents = list(docs.rglob('*.md'))
    for document in plans.rglob('*.md'):
        relative = document.relative_to(plans)
        # Validate archive entry indexes, while preserving historical snapshot bodies.
        if relative.parts[0] != 'archive' or (document.name == 'README.md' and len(relative.parts) <= 3):
            documents.append(document)
    documents.extend(root / name for name in ('README.md', 'AGENTS.md', 'CONTRIBUTING.md') if (root / name).is_file())
    documents = sorted(documents)
    covered = {index}
    link_count = 0
    for document in documents:
        name = document.relative_to(root).as_posix()
        for line, href in extract_links(document.read_text(encoding='utf-8-sig')):
            location = f'{name}:{line}'
            try:
                target = local_target(root, document, href)
            except ValueError as exc:
                issues.append(f'{location}: {exc}: {href}')
                continue
            if target is None:
                continue
            link_count += 1
            relative = target.relative_to(root).as_posix()
            if relative.startswith('docs/screenshots/') or relative == 'docs/screenshots':
                issues.append(f'{location}: retired screenshot reference: {href}')
            if not target.exists():
                issues.append(f'{location}: missing local target: {href}')
            if document == index and target.is_relative_to(archive):
                if target.is_dir():
                    covered.update(p for p in target.rglob('*') if p.is_file())
                else:
                    covered.add(target)
    if not index.is_file():
        issues.append(f'{ARCHIVE.as_posix()}/README.md: missing archive index')
    for document in sorted(archive.rglob('*')):
        if document.is_file() and document not in covered:
            issues.append(f'{ARCHIVE.as_posix()}/README.md: unindexed archive entry: {document.relative_to(archive).as_posix()}')
    return issues, len(documents), link_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    issues, documents, links = validate(args.root)
    for issue in issues:
        print(f'FAIL {issue}')
    print(f'{"FAIL" if issues else "PASS"}: {documents} current/index documents, {links} local links, {len(issues)} issues')
    print('Scope: docs/ usage layout, Plan/ current Markdown, root guides and archive indexes; historical bodies, remote URLs and anchors are not validated.')
    return 1 if issues else 0


if __name__ == '__main__':
    raise SystemExit(main())
