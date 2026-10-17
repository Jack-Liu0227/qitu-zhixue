"""Run with the deployed Qitu Python runtime and pinned source; no fake parser."""
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
import zipfile


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items(): z.writestr(name, text)
    return buffer.getvalue()


def fixtures():
    docx = archive({'[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文动能：速度两倍，动能四倍。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格中的质量数据 2kg</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'})
    xlsx = archive({'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="实验" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c t="inlineStr"><is><t>速度实验数据</t></is></c><c><v>42</v></c></row></sheetData></worksheet>'})
    pptx = archive({'ppt/slides/slide1.xml': '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>力与运动幻灯片</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'})
    epub = archive({'mimetype': 'application/epub+zip', 'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', 'book.opf': '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>', 'one.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>电子书第一章：机械能。</p></body></html>'})
    import fitz
    pdf = fitz.open(); p = pdf.new_page(); p.insert_text((72, 72), 'Kinetic energy is proportional to velocity squared.'); pdf_bytes = pdf.tobytes(); pdf.close()
    return {'physics.docx': (docx, '动能四倍'), 'experiment.xlsx': (xlsx, '42'), 'slides.pptx': (pptx, '力与运动'), 'book.epub': (epub, '机械能'), 'physics.pdf': (pdf_bytes, 'velocity squared')}


class ExtractionTests(unittest.TestCase):
    def parse(self, name, data):
        result = subprocess.run([os.sys.executable, str(Path(__file__).with_name('extract_upload.py'))], input=json.dumps({'fileName': name, 'base64': base64.b64encode(data).decode()}), capture_output=True, text=True, timeout=65)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_real_pdf_office_epub(self):
        for name, (data, expected) in fixtures().items():
            with self.subTest(name=name):
                result = self.parse(name, data)
                self.assertTrue(result['ok'], result)
                self.assertIn(expected, result['content'])
                if name.endswith('docx'): self.assertIn('质量数据', result['content'])

    def test_text_formats_and_html_no_script(self):
        for extension in ['txt', 'md', 'csv', 'json', 'yaml', 'xml', 'tex']:
            with self.subTest(extension=extension):
                result = self.parse('资料.' + extension, '中文实验资料'.encode())
                self.assertTrue(result['ok'], result); self.assertIn('中文', result['content'])
        result = self.parse('web.html', '<html><script>SECRET_SCRIPT</script><p>网页正文</p></html>'.encode())
        self.assertTrue(result['ok'], result); self.assertIn('网页正文', result['content']); self.assertNotIn('SECRET_SCRIPT', result['content'])

    def test_empty_scanned_encrypted_and_corrupt_rejected(self):
        import fitz
        pdf = fitz.open(); pdf.new_page(); empty = pdf.tobytes(); pdf.close()
        self.assertEqual(self.parse('scan.pdf', empty)['errorCode'], 'DOCUMENT_NO_TEXT')
        from pypdf import PdfWriter
        writer = PdfWriter(); writer.add_blank_page(width=100, height=100); writer.encrypt('secret'); data = io.BytesIO(); writer.write(data)
        self.assertEqual(self.parse('locked.pdf', data.getvalue())['errorCode'], 'DOCUMENT_ENCRYPTED')
        self.assertFalse(self.parse('fake.docx', b'not a document')['ok'])
        self.assertFalse(self.parse('fake.pdf', b'not a PDF')['ok'])
        self.assertFalse(self.parse('fake.txt', b'\x00\x01binary')['ok'])

    def test_limits_no_silent_truncation(self):
        self.assertEqual(self.parse('bomb.docx', archive({'word/document.xml': 'x' * (2 * 1024 * 1024)}))['errorCode'], 'ARCHIVE_LIMIT')
        self.assertEqual(self.parse('large.txt', b'x' * (5 * 1024 * 1024 + 1))['errorCode'], 'EXTRACTED_TEXT_LIMIT')


if __name__ == '__main__': unittest.main(verbosity=2)
