"""Exercise canonical package regeneration in disposable workspaces."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CanonicalSkillTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='qitu-canonical-skills-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.assertTrue(self.root.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
        shutil.copytree(ROOT / '.agents/skills', self.root / '.agents/skills')
        shutil.copy2(ROOT / '.agents/skill-lifecycle.json', self.root / '.agents/skill-lifecycle.json')
        (self.root / 'tooling').mkdir()
        for name in ('adapt_skills.py', 'skills_lifecycle.py', 'skill-adaptations.json'):
            shutil.copy2(ROOT / 'tooling' / name, self.root / 'tooling' / name)
        for folder in ('DeepTutor/deeptutor/skills', 'OpenMAIC/skills'):
            for source in (ROOT / folder).rglob('SKILL.md'):
                target = self.root / source.relative_to(ROOT)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)

    def run_tool(self, name, *args, success=True):
        result = subprocess.run([sys.executable, str(self.root / 'tooling' / name), *args],
                                cwd=self.root, capture_output=True, text=True, encoding='utf-8')
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes()
                for path in (self.root / '.agents').rglob('*') if path.is_file()}

    def test_regeneration_preserves_core_changes_updates_methods_and_is_idempotent(self):
        skill_id = 'pbl-understanding-coach'
        path = self.root / '.agents/skills' / skill_id / 'SKILL.md'
        path.write_text(path.read_text(encoding='utf-8').replace('## Method', 'CORE_METHOD_REVIEWED\n\n## Method'), encoding='utf-8')
        rules_path = self.root / 'tooling/skill-adaptations.json'
        rules = json.loads(rules_path.read_text(encoding='utf-8'))
        rules['feynman-learning']['method'].append('ADAPTED_METHOD_REVIEWED')
        rules_path.write_text(json.dumps(rules), encoding='utf-8')
        before = json.loads((self.root / '.agents/skill-lifecycle.json').read_text(encoding='utf-8'))
        self.run_tool('adapt_skills.py')
        first = self.snapshot()
        self.run_tool('adapt_skills.py')
        self.assertEqual(first, self.snapshot())
        self.assertEqual(path.read_text(encoding='utf-8').count('CORE_METHOD_REVIEWED'), 1)
        self.assertIn('ADAPTED_METHOD_REVIEWED', (path.parent / 'references/adapted-methods.md').read_text(encoding='utf-8'))
        after = json.loads((self.root / '.agents/skill-lifecycle.json').read_text(encoding='utf-8'))
        old = next(item for item in before['adaptations'] if item['id'] == skill_id)
        new = next(item for item in after['adaptations'] if item['id'] == skill_id)
        self.assertNotEqual(old['packageDigest'], new['packageDigest'])
        self.assertEqual({p.parent.name for p in (self.root / '.agents/skills').glob('*/SKILL.md')},
                         {p.parent.name for p in (ROOT / '.agents/skills').glob('*/SKILL.md')})
        self.run_tool('skills_lifecycle.py', 'verify')

    def test_catalog_verification_rejects_an_alias_directory_and_stale_resource_digest(self):
        directory = self.root / '.agents/skills'
        shutil.copytree(directory / 'pbl-source-literacy', directory / 'copied-source-coach')
        self.run_tool('skills_lifecycle.py', 'verify', success=False)
        copied = (directory / 'copied-source-coach').resolve()
        self.assertTrue(copied.is_relative_to(self.root.resolve()))
        shutil.rmtree(copied)
        resource = directory / 'pbl-source-literacy/references/adapted-methods.md'
        resource.write_text(resource.read_text(encoding='utf-8') + '\nUNREVIEWED_CHANGE\n', encoding='utf-8')
        self.run_tool('skills_lifecycle.py', 'verify', success=False)


if __name__ == '__main__':
    unittest.main()
