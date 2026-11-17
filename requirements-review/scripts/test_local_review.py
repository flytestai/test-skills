import copy
import json
import tempfile
import unittest
from pathlib import Path
from local_review import VERSION, check_snapshot, export, prepare, render
from validate_review import validate


class LocalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'requirement.md'
        self.source.write_text('# Orders\n## Submit\nShow success after submit.\n<script>alert(1)</script>', encoding='utf-8')
        self.output = self.root / 'run'
        prepare(self.source, self.output)
        self.data = json.loads((self.output / 'review.json').read_text(encoding='utf-8'))

    def tearDown(self):
        self.temp.cleanup()

    def reviewed(self):
        self.data['run'].update(status='reviewed', model='test-fixture', scope='fixture only')
        for row in self.data['rubric']:
            row.update(status='met', reason='Fixture evidence', evidence=[{'block_id': 'b3', 'quote': 'Show success after submit.'}])
        return self.data

    def test_prepare_keeps_heading_hierarchy(self):
        self.assertIn('Orders / Submit', self.data['modules'].values())
        self.assertEqual(self.data['run']['status'], 'prepared')

    def test_draft_cannot_export(self):
        with self.assertRaisesRegex(ValueError, 'not completed'):
            export(self.output, self.source)

    def test_export_and_escaping(self):
        self.reviewed()
        (self.output / 'review.json').write_text(json.dumps(self.data), encoding='utf-8')
        result = export(self.output, self.source)
        self.assertEqual(result['score'], 100)
        document = (self.output / 'report.html').read_text(encoding='utf-8')
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', document)
        self.assertNotIn('<script>alert(1)</script>', document)
        self.assertEqual(json.loads((self.output / 'result.json').read_text())['score'], 100)

    def test_modified_source_rejected(self):
        self.reviewed()
        self.source.write_text('changed', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Source changed'):
            check_snapshot(self.output, self.source, self.data)

    def test_modified_block_rejected(self):
        self.reviewed()['blocks'][0]['text'] = 'invented'
        with self.assertRaisesRegex(ValueError, 'evidence changed'):
            check_snapshot(self.output, self.source, self.data)

    def test_missing_image_inventory_rejected(self):
        self.reviewed()['images'].append({'id': 'fake'})
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            check_snapshot(self.output, self.source, self.data)

    def test_existing_output_preserved(self):
        with self.assertRaisesRegex(ValueError, 'already exists'):
            prepare(self.source, self.output)

    def test_pending_criterion_preserves_other_scores(self):
        self.reviewed()['rubric'][0].update(status='uncertain', evidence=[])
        result = validate(self.data)
        self.assertEqual((result['score'], result['status']), (100, 'provisional'))

    def test_word_order_and_images(self):
        try:
            from docx import Document
            from PIL import Image
        except ImportError:
            self.skipTest('Optional DOCX/Pillow parser unavailable')
        source = self.root / 'requirement.docx'
        doc = Document()
        doc.add_heading('Orders', 1)
        doc.add_paragraph('Submit an order')
        doc.add_table(rows=1, cols=1).cell(0, 0).text = 'Show confirmation'
        picture = self.root / 'picture.png'
        Image.new('RGB', (80, 40), 'blue').save(picture)
        doc.add_picture(str(picture))
        doc.save(source)
        output = self.root / 'word-run'
        result = prepare(source, output)
        self.assertEqual(result['images'], 1)
        data = json.loads((output / 'source.json').read_text(encoding='utf-8'))
        self.assertEqual([b['text'] for b in data['blocks']], ['Orders', 'Submit an order', 'Show confirmation'])
        asset = output / data['images'][0]['path']
        asset.write_bytes(b'tampered')
        data['run'] = {'status': 'reviewed', 'model': 'fixture', 'scope': 'fixture', 'instruction_version': VERSION}
        with self.assertRaisesRegex(ValueError, 'asset changed'):
            check_snapshot(output, source, data)

    def test_pdf_pages(self):
        try:
            import pymupdf
        except ImportError:
            self.skipTest('Optional PyMuPDF unavailable')
        source = self.root / 'requirement.pdf'
        with pymupdf.open() as doc:
            doc.new_page().insert_text((40, 40), 'Orders: show confirmation')
            doc.set_toc([[1, 'Orders', 1]])
            doc.save(source)
        output = self.root / 'pdf-run'
        result = prepare(source, output)
        self.assertEqual(result['images'], 1)
        data = json.loads((output / 'source.json').read_text(encoding='utf-8'))
        self.assertIn('Orders: show confirmation', data['blocks'][0]['text'])
        self.assertIn('Orders', data['modules'].values())


if __name__ == '__main__':
    unittest.main()
