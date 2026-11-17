# Local Execution

Run from the skill directory or use absolute script paths. Python 3.10+ is required.

```sh
python scripts/local_review.py prepare requirements.docx ./review-run
# Agent reads source.json and image assets, then completes review.json.
python scripts/local_review.py export ./review-run --source requirements.docx
python -m unittest discover -s scripts -p "test_*.py"
```

No server, model API or login is used. The initial draft is not a completed review. Set run.status to reviewed only after actual review, and record model (or human reviewer), instruction_version and scope. Keep pending_checks for unfinished stages. Export refuses a prepared draft.

## Inputs

- UTF-8 .txt/.md: standard library; Markdown headings form module paths.
- .docx: optional python-docx; native Heading styles and ordinary tables in source order. Embedded image occurrences are inventoried. Text boxes, formulas, nested tables, headers and floating layout may require manual inspection using Agent document tools. Extraction is not Word layout rendering.
- .pdf: optional PyMuPDF; page text and local page images. Bookmarks supply headings where available, otherwise page locators. Scanned pages need Agent vision or authorized local OCR. Do not infer that a scan is an empty requirement.
- Legacy .doc, encrypted and unsupported files fail explicitly; convert locally using authorized tools if needed.
- Limits: 50 MiB source, 300 PDF pages, 500 image occurrences, 20 million pixels per page, 200 MiB expanded DOCX and 10,000 ZIP members. These are operational safeguards, not inferred product requirements.

If a parser is missing, use an available local tool or request its installation. No automatic pip, online conversion or external relationship fetching.

## Images and Checkpoints

Set an image to verified only after viewing it. Add review_note explaining readability and critical numbers checked. Keep unreadable images needs_confirmation. Extracted text and image bytes are immutable. Visual-only evidence may append blocks with id beginning visual-, image_id, module_id, locator and a literal transcription in text. These are reviewer-derived, not extracted source. Cite image_id and bbox to permit original-region inspection. The script cannot prove transcriptions correct.

Save review.json after each module; prepare refuses to overwrite any directory. Resume only against the same source hash, instruction version and model. This is a local checkpoint, not a hidden background task.

Every extraction warning must remain in pending_checks unless run.warning_resolutions maps that exact warning to a concrete description of the local verification performed. Merely deleting a warning cannot establish full coverage. source.json is the trusted local extraction manifest: protect it from edits along with the original document. Hash checking detects ordinary source/asset changes; it is not a signature against an attacker who can rewrite all local artifacts.

## Output

report.html is a self-contained offline file: scores, source blocks, images, evidence links, dimension filtering and 10/20/50 findings per page. result.json is the identical canonical score. Document content is escaped, never executed. No remote fonts/scripts or TestX frontend dependency.
