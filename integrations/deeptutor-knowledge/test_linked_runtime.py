import tempfile
import base64
import unittest
from pathlib import Path
from linked_runtime import directory_request


class LinkedDirectoryTests(unittest.TestCase):
    def test_browse_read_and_symlink_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'raw'
            root.mkdir()
            (root / 'physics.txt').write_text('速度两倍，动能四倍。', encoding='utf-8')
            (root / 'hidden-link.txt').symlink_to('/etc/passwd')
            page = directory_request(root, {'operation':'documents'})
            self.assertEqual([i['title'] for i in page['manifest']['items']], ['physics.txt'])
            item = page['manifest']['items'][0]
            read = directory_request(root, {'operation':'read_document','documentId':item['id']})
            self.assertIn('四倍', read['manifest']['content'])
            self.assertFalse(directory_request(root, {'operation':'read_document','documentId':'unknown'})['ok'])
            self.assertFalse(directory_request(root, {'operation':'documents','folderId':'..'})['ok'])

    def test_directory_budget_is_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i in range(1001): (root / str(i)).touch()
            self.assertFalse(directory_request(root, {'operation':'documents'})['ok'])

    def test_original_pdf_is_unchanged_and_symlinks_or_non_pdf_are_not_previewable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = b'%PDF-1.7\nfixture\n%%EOF'
            (root / 'physics.pdf').write_bytes(pdf)
            (root / 'note.txt').write_text('not a PDF')
            (root / 'alias.pdf').symlink_to(root / 'physics.pdf')
            page = directory_request(root, {'operation': 'documents'})
            items = {item['title']: item['id'] for item in page['manifest']['items']}
            result = directory_request(root, {'operation': 'read_original', 'documentId': items['physics.pdf']})
            self.assertEqual(base64.b64decode(result['manifest']['body']), pdf)
            self.assertFalse(directory_request(root, {'operation': 'read_original', 'documentId': items['note.txt']})['ok'])
            self.assertNotIn('alias.pdf', items)
