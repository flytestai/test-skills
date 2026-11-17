import unittest
from validate_review import CRITERIA, validate


def fixture(status='met'):
    ref = {'block_id': 'b1', 'quote': 'Show success after submit.'}
    return {'schema_version': '1.0', 'source': {'sha256': 'a' * 64, 'name': 'req.txt'},
            'blocks': [{'id': 'b1', 'text': ref['quote'], 'module_id': 'm1', 'locator': 'Submit'}],
            'images': [], 'findings': [], 'rubric': [
                {'criterion_id': d + '.' + k, 'status': status, 'reason': 'Fixture assessment', 'evidence': [ref], 'issue_ids': []}
                for d, keys in CRITERIA.items() for k in keys.split()]}


class ContractTests(unittest.TestCase):
    def test_complete(self):
        self.assertEqual(validate(fixture())['score'], 100)

    def test_unknown_is_not_zero(self):
        self.assertIsNone(validate(fixture('uncertain'))['score'])

    def test_image_pending_does_not_clear_score(self):
        data = fixture()
        data['images'] = [{'id': 'i1', 'status': 'needs_confirmation'}]
        result = validate(data)
        self.assertEqual((result['score'], result['status']), (100, 'provisional'))

    def test_duplicates_rejected(self):
        data = fixture()
        data['rubric'][0] = data['rubric'][1]
        with self.assertRaises(ValueError):
            validate(data)

    def test_fake_quote_rejected(self):
        data = fixture()
        data['rubric'][0]['evidence'] = [{'block_id': 'b1', 'quote': 'Invented text'}]
        with self.assertRaises(ValueError):
            validate(data)

    def test_penalty_without_issue_rejected(self):
        with self.assertRaises(ValueError):
            validate(fixture('unmet'))

    def test_reference_zero_is_real(self):
        data = fixture('uncertain')
        data['reference_scores'] = {'clarity': {'value': 0, 'model': 'fixture-model', 'run_id': 'run1'}}
        self.assertEqual(validate(data)['score'], 0)

    def test_not_applicable_is_excluded(self):
        result = validate(fixture('not_applicable'))
        self.assertIsNone(result['score'])
        self.assertTrue(all(d['applicable'] == 0 for d in result['dimensions'].values()))


if __name__ == '__main__':
    unittest.main()
