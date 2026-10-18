"""Exercise documentation checks against disposable, non-sensitive fixtures."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location('docs_validator', Path(__file__).with_name('validate-docs.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class DocumentationChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.write('docs/README.md', '[Archive](archive/pre-20261018/README.md)\n')
        self.write('docs/archive/pre-20261018/README.md', '[Plan](plan/)\n')
        self.write('docs/archive/pre-20261018/plan/old.md', '[Historical](missing-old.md)\n')

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')

    def issues(self):
        return validator.validate(self.root)[0]

    def test_valid_archive_and_historical_snapshot_exclusion(self):
        self.assertEqual(self.issues(), [])

    def test_missing_current_link_has_line_number(self):
        self.write('docs/current.md', '# Title\n\n[Moved](missing.md)\n')
        self.assertTrue(any('docs/current.md:3: missing local target' in issue for issue in self.issues()))

    def test_nested_parentheses_and_encoded_paths(self):
        self.write('apps/example/(protected)/page.tsx', '')
        self.write('docs/with space.md', '# Heading\n')
        self.write('docs/current.md', '[Route](../apps/example/(protected)/page.tsx#L1)\n[Space](with%20space.md "Title")\n')
        self.assertEqual(self.issues(), [])

    def test_code_examples_and_external_urls_are_not_local_links(self):
        self.write('docs/current.md', '```md\n[Example](missing.md)\n````\n`[Inline](missing.md)`\n[Web](https://example.invalid/not-fetched)\n[Anchor](#heading)\n')
        self.assertEqual(self.issues(), [])

    def test_reference_definition_is_checked(self):
        self.write('docs/current.md', '[Read][guide]\n\n[guide]: missing.md\n')
        self.assertTrue(any('docs/current.md:3: missing local target' in issue for issue in self.issues()))

    def test_retired_screenshot_is_rejected_even_if_file_exists(self):
        self.write('docs/screenshots/old.png', '')
        self.write('docs/current.md', '![Old](screenshots/old.png)\n')
        self.assertTrue(any('retired screenshot reference' in issue for issue in self.issues()))

    def test_unindexed_archive_entry_is_not_silently_ignored(self):
        self.write('docs/archive/pre-20261018/forgotten.md', '# Old\n')
        self.assertTrue(any('unindexed archive entry: forgotten.md' in issue for issue in self.issues()))

    def test_archive_index_links_are_checked(self):
        self.write('docs/archive/pre-20261018/README.md', '[Missing](missing.md)\n[Plan](plan/)\n')
        self.assertTrue(any('README.md:1: missing local target' in issue for issue in self.issues()))

    def test_missing_archive_index_is_rejected(self):
        (self.root / 'docs/archive/pre-20261018/README.md').unlink()
        self.assertTrue(any('missing archive index' in issue for issue in self.issues()))

    def test_file_url_and_outside_root_are_rejected(self):
        self.write('docs/current.md', '[Local](file:///C:/obsolete.md)\n[Outside](../../outside.md)\n')
        self.assertTrue(any('nonportable local file URL' in issue for issue in self.issues()))
        self.assertTrue(any('leaves the repository' in issue for issue in self.issues()))

    def test_angle_destination_and_utf8_bom(self):
        self.write('docs/with space.md', '# Target\n')
        self.write('docs/current.md', '\ufeff[Read](<with space.md> "Title")\n')
        self.assertEqual(self.issues(), [])


if __name__ == '__main__':
    unittest.main()
