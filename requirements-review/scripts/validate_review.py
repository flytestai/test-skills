"""Validate the portable review contract and print its canonical scoring result."""
import json
import math
import re
import sys
from pathlib import Path

CRITERIA = {
    'completeness': 'scope flow behavior acceptance',
    'consistency': 'terms rules visual cross_reference',
    'testability': 'outcome conditions boundary failure',
    'feasibility': 'dependencies limits safety delivery',
    'clarity': 'meaning trigger measurement references',
    'logic': 'state branches calculation permissions',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def keyed(rows, label):
    require(isinstance(rows, list), label + ' must be an array')
    require(all(isinstance(row, dict) and nonempty(row.get('id')) for row in rows), label + ' requires IDs')
    result = {row['id']: row for row in rows}
    require(len(result) == len(rows), label + ' has duplicate IDs')
    return result


def validate(data):
    require(isinstance(data, dict) and data.get('schema_version') == '1.0', 'Unsupported schema')
    source = data['source']
    require(nonempty(source.get('name')) and re.fullmatch('[0-9a-f]{64}', source.get('sha256', '')), 'Invalid source identity')
    blocks = keyed(data['blocks'], 'blocks')
    images = keyed(data['images'], 'images')
    findings = keyed(data['findings'], 'findings')
    for row in blocks.values():
        require(all(nonempty(row.get(k)) for k in ('text', 'module_id', 'locator')), 'Block lacks source locator/text')
    for row in images.values():
        require(row.get('status') in ('verified', 'needs_confirmation'), 'Invalid image status')

    def evidence(refs, allow_empty=False):
        require(isinstance(refs, list) and (allow_empty or refs), 'Evidence required')
        for ref in refs:
            block = blocks.get(ref.get('block_id'))
            require(block is not None and nonempty(ref.get('quote')) and ref['quote'] in block['text'], 'Quote does not match source')
            if 'image_id' in ref:
                require(ref['image_id'] in images and images[ref['image_id']]['status'] == 'verified', 'Visual evidence not verified')
                require(block.get('image_id', ref['image_id']) == ref['image_id'], 'Visual transcription image mismatch')
                box = ref.get('bbox', [])
                require(isinstance(box, list) and len(box) == 4 and all(number(x) and 0 <= x <= 1 for x in box), 'Invalid image coordinates')
                require(box[0] < box[2] and box[1] < box[3], 'Empty image region')
            require(not block.get('image_id') or ref.get('image_id') == block['image_id'], 'Visual transcription requires image citation')

    for row in findings.values():
        require(row.get('status') in ('confirmed', 'clarification', 'suggestion'), 'Invalid finding status')
        require(row.get('kind') in ('contradiction', 'ambiguity', 'missing', 'improvement'), 'Invalid finding kind')
        require(row.get('priority') in ('high', 'medium', 'low'), 'Invalid priority')
        require(all(nonempty(row.get(k)) for k in ('title', 'description', 'suggestion', 'module_id')), 'Incomplete finding')
        dims = row.get('affected_dimensions')
        require(isinstance(dims, list) and dims and all(d in CRITERIA for d in dims), 'Invalid dimensions')
        evidence(row.get('evidence'))
        require(any(blocks[ref['block_id']]['module_id'] == row['module_id'] for ref in row['evidence']), 'Module anchor mismatch')
        check = row.get('verification', {})
        expected = {'premises_supported': True, 'already_answered': False, 'changes_product_rule': False, 'within_scope': True}
        require(all(check.get(k) is v for k, v in expected.items()), 'Finding has not passed contextual verification')
        if row['kind'] == 'contradiction':
            require(len({(r['block_id'], r['quote']) for r in row['evidence']}) >= 2, 'Contradiction needs two locations')

    rows = data['rubric']
    require(isinstance(rows, list) and all(isinstance(r, dict) for r in rows), 'Invalid rubric')
    expected = {d + '.' + key for d, keys in CRITERIA.items() for key in keys.split()}
    require(len(rows) == len(expected) and {r.get('criterion_id') for r in rows} == expected, 'Missing or duplicate criteria')
    for row in rows:
        status = row.get('status')
        require(status in ('met', 'partial', 'unmet', 'uncertain', 'not_applicable'), 'Invalid criterion status')
        require(nonempty(row.get('reason')), 'Criterion requires reason')
        evidence(row.get('evidence'), allow_empty=status == 'uncertain')
        ids = row.get('issue_ids')
        require(isinstance(ids, list) and all(isinstance(i, str) and i in findings for i in ids), 'Unknown finding link')
        if status in ('partial', 'unmet'):
            allowed = ('confirmed',) if status == 'unmet' else ('confirmed', 'clarification')
            dimension = row['criterion_id'].split('.')[0]
            anchors = {r['block_id'] for r in row['evidence']}
            require(any(findings[i]['status'] in allowed and dimension in findings[i]['affected_dimensions'] and anchors.intersection(r['block_id'] for r in findings[i]['evidence']) for i in ids), 'Score penalty lacks matching grounded finding')

    references = data.get('reference_scores', {})
    require(isinstance(references, dict) and all(k in CRITERIA for k in references), 'Invalid reference dimensions')
    for ref in references.values():
        require(isinstance(ref, dict) and number(ref.get('value')) and 0 <= ref['value'] <= 100 and nonempty(ref.get('model')) and nonempty(ref.get('run_id')), 'Reference score lacks valid provenance')
    pending = data.get('pending_checks', [])
    require(isinstance(pending, list), 'Invalid pending checks')
    details, scores = {}, {}
    provisional = bool(pending) or any(i['status'] != 'verified' for i in images.values())
    points = {'met': 100, 'partial': 50, 'unmet': 0}
    for dim in CRITERIA:
        applicable = [r for r in rows if r['criterion_id'].startswith(dim + '.') and r['status'] != 'not_applicable']
        known = [r for r in applicable if r['status'] in points]
        incomplete = len(known) != len(applicable)
        score, origin = None, 'not_applicable' if not applicable else 'unavailable'
        if incomplete and dim in references:
            score, origin = references[dim]['value'], 'model_reference'
        elif known:
            score = sum(points[r['status']] for r in known) / len(known)
            origin = 'verified_subset' if incomplete else 'verified_checklist'
        if score is not None:
            scores[dim] = math.floor(score + 0.5)
        provisional = provisional or incomplete
        details[dim] = {'score': scores.get(dim), 'source': origin, 'evaluated': len(known), 'applicable': len(applicable)}
    return {'policy_version': 'portable_coverage_v1', 'score': math.floor(sum(scores.values()) / len(scores) + 0.5) if scores else None,
            'status': 'unavailable' if not scores else 'provisional' if provisional else 'complete',
            'dimensions': details, 'confirmed_count': sum(f['status'] == 'confirmed' for f in findings.values()),
            'clarification_count': sum(f['status'] == 'clarification' for f in findings.values())}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2, 'Usage: validate_review.py review.json')
        result = validate(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
        print('Invalid review: ' + str(error), file=sys.stderr)
        sys.exit(1)
