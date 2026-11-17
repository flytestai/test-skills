"""Local document preparation and offline reporting; no network/model calls."""
import argparse
import base64
import hashlib
import html
import json
import re
import sys
import zipfile
from pathlib import Path
from validate_review import CRITERIA, require, validate

VERSION = 'standalone-2.0'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


def prepare(source, output):
    require(source.is_file() and source.stat().st_size <= 50 * 1024**2, 'Missing source or source exceeds 50 MiB')
    require(not output.exists(), 'Output already exists; choose a fresh directory')
    suffix = source.suffix.lower()
    require(suffix in ('.txt', '.md', '.docx', '.pdf'), 'Unsupported format; use PDF, DOCX, UTF-8 text or Markdown')
    # Import before creating output so a missing optional parser is recoverable.
    if suffix == '.docx':
        from docx import Document
        from docx.oxml.ns import qn
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        with zipfile.ZipFile(source) as archive:
            require(len(archive.infolist()) <= 10000 and sum(i.file_size for i in archive.infolist()) <= 200 * 1024**2, 'DOCX expansion limit exceeded')
    if suffix == '.pdf':
        import pymupdf
    output.mkdir(parents=True)
    assets = output / 'assets'
    assets.mkdir()
    blocks, images, warnings, modules = [], [], [], {}
    heading = ['Document']

    def module():
        title = ' / '.join(heading)
        mid = 'm-' + hashlib.sha256(title.encode()).hexdigest()[:12]
        modules[mid] = title
        return mid

    def block(text, locator):
        if text.strip():
            blocks.append({'id': 'b' + str(len(blocks) + 1), 'module_id': module(), 'locator': locator, 'text': text})

    def image(payload, extension, locator):
        require(len(images) < 500, 'Image occurrence limit exceeded')
        require(extension.lower() in ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'), 'Unsupported embedded image; convert locally to PNG')
        iid = 'img' + str(len(images) + 1)
        relative = 'assets/' + iid + extension.lower()
        (output / relative).write_bytes(payload)
        images.append({'id': iid, 'module_id': module(), 'locator': locator, 'path': relative,
                       'sha256': hashlib.sha256(payload).hexdigest(), 'status': 'needs_confirmation'})

    if suffix in ('.txt', '.md'):
        text = source.read_text(encoding='utf-8-sig')
        for line_no, line in enumerate(text.splitlines(), 1):
            match = re.match(r'^(#{1,6})\s+(.+)$', line) if suffix == '.md' else None
            if match:
                heading[:] = heading[:len(match[1]) - 1] + [match[2]]
            block(line, 'line ' + str(line_no) + ' / ' + ' / '.join(heading))
        if suffix == '.md' and re.search(r'!\[.*?\]\(', text):
            warnings.append('Markdown image links were not fetched. Add authorized local image evidence before a full visual review.')
    elif suffix == '.docx':
        doc = Document(source)
        warnings.append('DOCX layout/text boxes/headers/formulas/nested tables require visual verification; embedded media inventory does not prove layout fidelity.')
        seen = set()
        for position, element in enumerate(doc.element.body, 1):
            if element.tag == qn('w:p'):
                paragraph = Paragraph(element, doc)
                match = re.match(r'Heading (\d+)', paragraph.style.name or '')
                if match:
                    heading[:] = heading[:int(match[1]) - 1] + [paragraph.text or 'Untitled heading']
                block(paragraph.text, 'paragraph ' + str(position) + ' / ' + ' / '.join(heading))
            elif element.tag == qn('w:tbl'):
                table = Table(element, doc)
                for index, row in enumerate(table.rows, 1):
                    block(' | '.join(cell.text for cell in row.cells), 'table ' + str(position) + ' row ' + str(index))
            for node in element.iter(qn('a:blip')):
                rid = node.get(qn('r:embed'))
                if rid and rid in doc.part.related_parts:
                    part = doc.part.related_parts[rid]
                    image(part.blob, Path(str(part.partname)).suffix, 'element ' + str(position))
                    seen.add(str(part.partname))
        for part in doc.part.package.parts:
            if str(part.partname).startswith('/word/media/') and str(part.partname) not in seen:
                heading[:] = ['Unlocated embedded media']
                image(part.blob, Path(str(part.partname)).suffix, 'unlocated media; inspect document layout')
    else:
        with pymupdf.open(source) as doc:
            require(not doc.needs_pass and len(doc) <= 300, 'Encrypted PDF or PDF exceeds 300 pages')
            bookmarks = {row[2]: row[1] for row in doc.get_toc()}
            active_title = None
            warnings.append('PDF bookmarks/page locators are not guaranteed to reproduce every heading. Agent must inspect page images.')
            for index, page in enumerate(doc, 1):
                if index in bookmarks:
                    active_title = bookmarks[index]
                heading[:] = [active_title or 'Page ' + str(index)]
                block(page.get_text(), 'page ' + str(index) + ' / ' + ' / '.join(heading))
                require(page.rect.width * page.rect.height * 2.25 <= 20_000_000, 'PDF page pixel limit exceeded')
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
                image(pixmap.tobytes('png'), '.png', 'page ' + str(index))
    manifest = {'schema_version': '1.0', 'source': {'name': source.name, 'sha256': digest(source)},
                'extraction_version': VERSION, 'blocks': blocks, 'images': images, 'modules': modules, 'warnings': warnings}
    write_json(output / 'source.json', manifest)
    draft = {**manifest, 'run': {'status': 'prepared', 'model': '', 'scope': '', 'instruction_version': VERSION},
             'findings': [], 'rubric': [{'criterion_id': d + '.' + key, 'status': 'uncertain', 'reason': 'Not reviewed yet', 'evidence': [], 'issue_ids': []}
                                       for d, keys in CRITERIA.items() for key in keys.split()],
             'reference_scores': {}, 'pending_checks': warnings[:]}
    write_json(output / 'review.json', draft)
    return {'directory': str(output), 'blocks': len(blocks), 'images': len(images), 'warnings': warnings}


def check_snapshot(root, source, data):
    manifest = json.loads((root / 'source.json').read_text(encoding='utf-8'))
    require(data['source'] == manifest['source'] and digest(source) == manifest['source']['sha256'], 'Source changed; start a new review')
    require(data.get('modules') == manifest['modules'], 'Module inventory changed')
    original = {b['id']: b for b in manifest['blocks']}
    current = {b['id']: b for b in data['blocks']}
    require(all(current.get(key) == value for key, value in original.items()), 'Extracted evidence changed')
    require(len(data['images']) == len(manifest['images']), 'Image inventory changed')
    images = {i['id']: i for i in data['images']}
    for initial in manifest['images']:
        row = images.get(initial['id'], {})
        require(all(row.get(k) == v for k, v in initial.items() if k != 'status'), 'Image identity changed')
        path = (root / initial['path']).resolve()
        require(path.is_relative_to(root.resolve()) and digest(path) == initial['sha256'], 'Image asset changed')
        if row.get('status') == 'verified':
            require(isinstance(row.get('review_note'), str) and bool(row['review_note'].strip()), 'Verified image needs a review note')
    for row in data['blocks']:
        if row['id'] not in original:
            require(row['id'].startswith('visual-') and row.get('image_id') in images, 'Only image transcriptions may extend evidence')
            require(images[row['image_id']]['status'] == 'verified' and row['module_id'] == images[row['image_id']]['module_id'], 'Visual block lacks verified image/module')
    run = data.get('run', {})
    require(run.get('status') == 'reviewed' and run.get('instruction_version') == VERSION and all(isinstance(run.get(k), str) and run[k].strip() for k in ('model', 'scope')), 'Review not completed or run metadata missing')
    resolutions = run.get('warning_resolutions', {})
    require(isinstance(resolutions, dict), 'Invalid warning resolutions')
    for warning in manifest['warnings']:
        if not isinstance(resolutions.get(warning), str) or not resolutions[warning].strip():
            require(warning in data.get('pending_checks', []), 'Extraction warning needs resolution or pending check')


def render(data, score, root):
    escape = lambda value: html.escape(str(value), quote=True)
    findings = []
    for row in data['findings']:
        refs = ''.join('<li><a href="#' + escape(ref['block_id']) + '">' + escape(ref['quote']) + '</a></li>' for ref in row['evidence'])
        label = {'confirmed': '已确认问题', 'clarification': '待澄清', 'suggestion': '可选建议'}[row['status']]
        findings.append('<article data-dims="' + escape(' '.join(row['affected_dimensions'])) + '"><h3>' + escape(row['title']) + '</h3><p>' + escape(label + ' / ' + row['priority']) + '</p><p>' + escape(row['description']) + '</p><p>' + escape(row['suggestion']) + '</p><ul>' + refs + '</ul></article>')
    blocks = ''.join('<section id="' + escape(b['id']) + '"><h3>' + escape(b['locator']) + '</h3><pre>' + escape(b['text']) + '</pre></section>' for b in data['blocks'])
    pictures = []
    for row in data['images']:
        path = root / row['path']
        mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'}.get(path.suffix, 'application/octet-stream')
        pictures.append('<figure><figcaption>' + escape(row['locator'] + ' / ' + row['status']) + '</figcaption><img alt="source evidence" src="data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode() + '"></figure>')
    dimensions = ''.join('<li>' + escape(d) + ': ' + escape(v['score'] if v['score'] is not None else '--') + ' / 100 (' + escape(v['source']) + ', ' + str(v['evaluated']) + '/' + str(v['applicable']) + ')</li>' for d, v in score['dimensions'].items())
    options = ''.join('<option>' + d + '</option>' for d in CRITERIA)
    return '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>需求评审报告</title><style>
body{font:15px/1.65 system-ui,sans-serif;color:#172338;margin:24px auto;padding:0 20px;max-width:1100px}h1{font-size:26px}h2{font-size:21px}article,section{border-top:1px solid #ccd6e1;padding:16px 0}article p,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:inherit}img{max-width:100%;max-height:800px;object-fit:contain}a{color:#0867cd}button,select{padding:7px;margin:4px}section:target{background:#e5f3ff}header{border-bottom:3px solid #0877db}figure{margin:12px 0}[hidden]{display:none!important}</style><header><h1>需求评审报告 / ''' + escape(data['source']['name']) + '</h1><h2 id="total">' + escape(score['score'] if score['score'] is not None else '--') + ' / 100 · ' + escape(score['status']) + '</h2><p>确认问题 ' + str(score['confirmed_count']) + ' · 待澄清 ' + str(score['clarification_count']) + '</p></header><ul>' + dimensions + '</ul><h2>评审限制与待确认</h2><pre>' + escape('\n'.join(str(x) for x in data.get('pending_checks', []))) + '</pre><h2>发现的问题</h2><label>维度 <select id="dimension"><option value="">全部</option>' + options + '</select></label><label>每页 <select id="size"><option>10</option><option>20</option><option>50</option></select></label><div id="findings">' + ''.join(findings) + '</div><button id="prev">上一页</button><span id="pages"></span><button id="next">下一页</button><h2>原文证据</h2>' + blocks + '<h2>图像证据</h2>' + ''.join(pictures) + '''<script>
const rows=[...document.querySelectorAll('article')];let page=0;
const dim=document.getElementById('dimension'),size=document.getElementById('size');
function draw(){const filtered=rows.filter(r=>!dim.value||r.dataset.dims.split(' ').includes(dim.value));const count=Math.max(1,Math.ceil(filtered.length/Number(size.value)));page=Math.max(0,Math.min(page,count-1));rows.forEach(r=>r.hidden=true);filtered.slice(page*Number(size.value),(page+1)*Number(size.value)).forEach(r=>r.hidden=false);document.getElementById('pages').textContent=`${page+1} / ${count} · ${filtered.length}`;document.getElementById('prev').disabled=page===0;document.getElementById('next').disabled=page===count-1}
dim.onchange=size.onchange=()=>{page=0;draw()};document.getElementById('prev').onclick=()=>{page--;draw()};document.getElementById('next').onclick=()=>{page++;draw()};draw();</script></html>'''


def export(root, source):
    data = json.loads((root / 'review.json').read_text(encoding='utf-8'))
    check_snapshot(root, source, data)
    result = validate(data)
    require(not (root / 'result.json').exists() and not (root / 'report.html').exists(), 'Report already exists; preserve prior export')
    document = render(data, result, root)
    write_json(root / 'result.json', result)
    with (root / 'report.html').open('x', encoding='utf-8') as stream:
        stream.write(document)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p = sub.add_parser('export')
    p.add_argument('output', type=Path)
    p.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    try:
        value = prepare(args.source, args.output) if args.command == 'prepare' else export(args.output, args.source)
        print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError, ImportError, zipfile.BadZipFile) as error:
        parser.exit(1, 'Local review failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
