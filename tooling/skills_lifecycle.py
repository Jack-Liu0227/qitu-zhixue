"""Audit and verify source-backed Qitu skill adaptations. Never modifies live data."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / '.agents/skill-lifecycle.json'
SOURCE_ROOTS = ('DeepTutor/deeptutor/skills', 'OpenMAIC/skills')


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit() -> dict:
    return {
        'sourceSkills': [str(p.relative_to(ROOT)).replace('\\', '/')
                         for folder in SOURCE_ROOTS
                         for p in sorted((ROOT / folder).rglob('SKILL.md'))],
        'owners': {
            'template': 'templates/teaching-bundle.compiler',
            'team': 'platform-registry/teaching-team-capture.service',
            'assistant': 'platform-registry/platform-registry.service',
            'lesson': 'ai-tutor/tutor-lesson-activity',
            'answer': 'ai-tutor/tutor-quiz.store',
            'evidence': 'works/works-learning-evidence.service',
            'profileAndGrowth': 'growth/growth-projection-owner.service',
        },
    }


def verify() -> dict:
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    source_paths = set(audit()['sourceSkills'])
    mapped = {item['source'] for item in manifest['adaptations']}
    assert mapped == source_paths, {'missing': sorted(source_paths - mapped), 'extra': sorted(mapped - source_paths)}
    catalog = {}
    for path in sorted((ROOT / '.agents/skills').glob('*/SKILL.md')):
        content = path.read_text(encoding='utf-8')
        metadata = dict(line.split(':', 1) for line in content.split('---', 2)[1].splitlines() if ':' in line and not line.startswith('#'))
        skill_id = metadata['name'].strip()
        assert skill_id == path.parent.name and skill_id not in catalog, str(path)
        assert not re.search(r'-v\d+$', skill_id), f'Duplicate version-suffixed package: {skill_id}'
        assert 'supersedes' not in metadata, skill_id
        assert metadata['runtime'].strip() in ('admin', 'teaching'), skill_id
        for resource in metadata.get('references', '').split(','):
            if not resource.strip():
                continue
            target = (path.parent / resource.strip()).resolve()
            assert target.is_relative_to(path.parent.resolve()) and target.is_file(), str(target)
        catalog[skill_id] = metadata['runtime'].strip()
    ids = set()
    for item in manifest['adaptations'] + manifest['nativeSkills']:
        skill_id = item['id']
        ids.add(skill_id)
        path = ROOT / '.agents/skills' / skill_id / 'SKILL.md'
        content = path.read_text(encoding='utf-8')
        assert f'name: {skill_id}\n' in content, skill_id
        assert f'runtime: {item["runtime"]}\n' in content, skill_id
        assert 'status: published\n' in content, skill_id
        assert 'supersedes' not in item, skill_id
        assert skill_id in catalog, skill_id
        assert item['digest'] == hashlib.sha256(content.encode('utf-8')).hexdigest(), skill_id
        package = json.dumps({'source': content, 'resources': [{'path': resource,
            'content': (path.parent / resource).read_text(encoding='utf-8')} for resource in item['resources']]}, ensure_ascii=False, separators=(',', ':'))
        assert item['packageDigest'] == hashlib.sha256(package.encode('utf-8')).hexdigest(), skill_id
        if 'source' in item:
            assert item['sourceDigest'] == digest(ROOT / item['source']), item['source']
    return {'verifiedSkills': len(ids), 'mappedSources': len(mapped), 'catalogSkills': len(catalog),
            'teachingSkills': list(catalog.values()).count('teaching'),
            'adminSkills': list(catalog.values()).count('admin'), 'scope': 'source_only'}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('audit', 'verify', 'report'))
    args = parser.parse_args()
    result = audit() if args.command == 'audit' else verify()
    if args.command == 'report':
        result.update({'publication': 'local_source_metadata', 'liveConfiguration': 'not_probed', 'liveRequest': 'not_probed'})
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
