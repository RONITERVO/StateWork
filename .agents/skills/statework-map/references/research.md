# Research and traceability

Keep private artifacts in the chosen data directory or a separate private session directory. The skill's own directory and the public repository must contain no account details, source content, access keys or real-work proof.

## Ledger

Save `research.json` with this format. This is an agent-maintained record, not a questionnaire for the user. Add entries while researching, not after building the final map.

```json
{
  "format": "statework.map-research",
  "version": 1,
  "scope": "The user's stated outcome and boundaries",
  "sources": [
    {
      "id": "index-1",
      "locator": "The exact source location",
      "status": "inspected",
      "captureId": "captured-index-1",
      "enumerationComplete": true,
      "children": ["assignment-1"],
      "reason": "All sections and pages inspected; one assignment found."
    },
    {
      "id": "assignment-1",
      "locator": "The linked assignment location",
      "status": "blocked",
      "captureId": null,
      "enumerationComplete": false,
      "children": [],
      "reason": "Sign-in required; ask the user to open this course."
    }
  ],
  "requirements": [
    {
      "id": "requirement-1",
      "sourceId": "index-1",
      "location": "Assignments, row 1",
      "quote": "Complete the assigned model.",
      "disposition": "deferred",
      "itemIds": ["model-task"],
      "reason": "Assignment exists in the map; exact geometry remains inaccessible."
    }
  ]
}
```

Source statuses: `inspected`, `blocked`, `excluded`. `enumerationComplete` means the full relevant source/index was inspected, including pagination, not that the linked children were all read. Exclusion needs an applicable scope reason. Each discovered child gets its own entry, including unread children. An attachment or diagram carrying independent requirements is a child too.

Requirement dispositions: `mapped`, `excluded`, `deferred`, `unresolved`. Record source location and a short exact quote supporting existence or classification. Map each required deliverable separately when it has a separate result/submission/check. A broad “complete course” item does not account for each assignment. A deferred requirement still gets a visible item or recovery action where possible. Distinguish optional work from required work explicitly, with evidence for the selection rule.

Also append private `trace.jsonl` entries as actions happen:

```json
{
  "at": "2026-01-01T10:00:00Z",
  "action": "source.open",
  "locator": "source location",
  "result": "inspected",
  "evidence": "raw/page-001.html",
  "next": ["assignment-1"]
}
```

Use actual timestamps and paths. Record failed searches, pagination bounds, expired links, source versions, download failures, permissions, decisions and map writes. Tool-generated logs are stronger than self-reported summaries; preserve them when available. A log is useful provenance, not a tamper-proof or perfectly isolated execution attestation.

## Resolve evidence, not memory

- Start with authoritative enrollment/contract/project records. Follow linked work areas and check the relevant user's completion/assessment records. Search related threads and later corrections. Read whole relevant messages, not just snippets.
- Capture each source with its actual locator and scope. Label an excerpt as an excerpt. Text extraction that omits a dimensioned drawing is not complete coverage. Inspect the original visually and store it as an asset before claiming the geometry is available.
- Verify downloads before calling them originals: inspect content type, file signature, nonzero size and the opened document. A successful HTTP response may be a sign-in page saved with a PDF filename. When a browser can read pages but cannot export authenticated files, check another available authorized download/browser tool before asking the person to fetch many files manually. A single sign-in in a capable browser may unlock the whole branch. Stop retrying an unsupported API once its limitation is established; preserve the failed response separately from the requested original.
- Preserve whether a statement came from an official record, a user confirmation or an agent inference. Attendance, assignment submission, accepted assessment and certificate completion are different states.
- For conflicting totals, deadlines or requirements, record both observations, applicability and a resolution route. Do not treat the newest timestamp as automatic authority when it describes a different course or cohort.
- For missing access, check whether the current authorized account already works before asking. Research public instructions or linked alternatives only when they actually cover the same work. A similar online tutorial does not replace the assigned specification.
- Minimize prompts. “May I read the selected course area?” is better than asking the worker to copy all assignments. Do not ask for enrollment permission when you can inspect the content without enrolling. Joining, submitting or contacting someone still needs applicable authorization.
- Do not perform a graded quiz or task to discover its contents. Use the available description, preview or authorized read-only source and record the access limit.

Stop expanding when every discovered in-scope branch has an evidenced disposition, the authoritative scope has been reconciled, and no unexplained links or pagination remain. If a source is inaccessible, the map may be useful but its scope is not fully verified; state that limit and leave the recovery visible.
