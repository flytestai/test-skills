# Review Interchange Contract v1

UTF-8 JSON. Source IDs are supplied by the extraction layer, not invented by the reviewer. Hash the original bytes with SHA-256; re-review after source changes. Text offsets use Python Unicode code-point indices, start inclusive/end exclusive; adapters to JavaScript must convert to UTF-16 offsets. PDF pages are 1-based. Image bounding boxes are normalized [left, top, right, bottom]. A page number alone is not a precise issue anchor.

Required shape (illustration only, not a completed report):

```json
{
  "schema_version": "1.0",
  "source": {"sha256": "64 lowercase hex characters", "name": "requirements.pdf"},
  "blocks": [{"id": "b1", "module_id": "m1", "locator": "page 2 / Orders / Submit", "text": "Exact extracted source text"}],
  "images": [{"id": "img1", "status": "verified"}],
  "findings": [{
    "id": "f1", "module_id": "m1", "title": "Specific business question",
    "status": "clarification", "kind": "ambiguity", "priority": "medium",
    "description": "What is unclear and its user-visible impact",
    "suggestion": "Ask for the missing business decision, not an invented answer",
    "affected_dimensions": ["clarity"],
    "evidence": [{"block_id": "b1", "quote": "Exact extracted source text"}],
    "verification": {"premises_supported": true, "already_answered": false, "changes_product_rule": false, "within_scope": true}
  }],
  "rubric": [{"criterion_id": "clarity.meaning", "status": "partial", "reason": "Grounded reasoning", "evidence": [{"block_id": "b1", "quote": "Exact extracted source text"}], "issue_ids": ["f1"]}],
  "reference_scores": {},
  "pending_checks": []
}
```

All arrays may be empty except rubric: include every criterion exactly once. Images require status verified or needs_confirmation. Reference scores are optional objects keyed by dimension, with value (0..100), model and run_id; use only actual successful model responses from this source snapshot, never placeholders. Preserve raw responses in protected audit storage. Evidence may include image_id and bbox when grounded in a verified image transcription; visual-only reasoning still requires human/vision validation of the original region. The validator checks references/coordinates, not pixels or meaning.

## Criteria

Each line has four equally weighted criteria. Context determines applicability, not keyword presence.

- completeness: scope (business scope), flow (roles/main flow), behavior (inputs/visible outcomes), acceptance (acceptance evidence).
- consistency: terms (terms), rules (values/rules), visual (text/visual meaning), cross_reference (cross-section consistency).
- testability: outcome (observable outcome), conditions (reproducible trigger), boundary (applicable limits), failure (applicable failure outcome).
- feasibility: dependencies (business dependencies), limits (compatible scale constraints), safety (business authorization), delivery (compatible scope/delivery constraints, not a demand for project schedules).
- clarity: meaning (concepts), trigger (conditions/actions), measurement (business metrics), references (traceable references).
- logic: state (state transitions), branches (branches), calculation (applicable calculations/examples), permissions (permission/flow relationships).

## Decisions and Scores

confirmed requires supported premises, not already answered, within scope and no prescribed new product rule. A contradiction needs two evidence references to different locations. clarification is an unresolved business question, not a confirmed defect; suggestion is optional. A model cannot turn uncertainty into certainty simply by setting flags: independently inspect the cited context.

met=100; partial=50 with a grounded confirmed/clarification issue for the same business point; unmet=0 with a confirmed issue. uncertain means not assessable, never zero. not_applicable requires a source-backed business reason, excluded from denominator. Round halves upward once per dimension, then take the rounded equal mean of available dimensions.

Incomplete dimension: retain an actual model reference score if available and label model_reference; otherwise use known criteria only, label verified_subset. No known items/reference means null, not a default grade. Fully inapplicable dimensions remain excluded. Any uncertain items, reference/subset scores, unverified images or pending checks makes the result provisional. Expose coverage, denominator and source alongside numbers. Never count defects twice or deduct by raw problem count. Rating/pass thresholds are a separate business policy; do not invent a pass threshold.

Model-reference scores and checklist scores have different evidential strength. Do not silently call provisional scores final, compare them as identical measures or conceal a change of scoring policy. Calibrate reference scores on a human-reviewed corpus before using them for release decisions.
