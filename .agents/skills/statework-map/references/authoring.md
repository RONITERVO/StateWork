# Author the installed StateWork contract

Use installed schemas for exact fields. This reference describes 0.2. The usual order is items → relations → originals → source captures → packets → review → observation. Adding or changing context after packet review may make that review stale.

## Items and relationships

Create `project` containers for meaningful work areas, `task` items for deliverables and recovery actions, `event` items for real appointments, and `note` items for non-actionable records. Avoid a task per paragraph or a single task hiding many independent deliverables.

`contains` runs from parent to child. `depends_on` runs from the task to the prerequisite it needs. Link ordering constraints only where supported; sorting an index does not prove a dependency. Dates, units, priority and estimates must retain their basis. Do not convert every missing estimate into an invented deadline.

Use `inbox` for unresolved draft work, `ready` for an actionable task, `active` for evidenced ongoing work, and `done` only for evidenced completion. `cancelled` is not successful completion. Keep past events and finished work; do not recreate or fabricate packet checks to imitate a historical activity.

The following inert extension conventions support the skill's audit. They preserve provenance; they do not create new app behavior:

```json
{
  "statework.map/scope": {
    "classification": "required",
    "reason": "Required by the applicable brief",
    "sourceIds": ["brief"]
  },
  "statework.map/evidence": {
    "claims": [
      {
        "field": "status",
        "sourceId": "completion-record",
        "quote": "Accepted",
        "location": "Assignment status",
        "basis": "official"
      }
    ]
  }
}
```

Classifications: `required`, `chosen`, `optional`, `unresolved`. Evidence basis: `official`, `user-attested`, `inferred`. Keep unresolved or optional branches out of a falsely required route. Capture a user confirmation as a dated `note` source, quoted accurately, before citing it. Status `done` needs evidence for status, not merely a citation to the assignment description.

## Commands and sources

Each command request is `{schemaVersion:1, requestId, expectedRevision, commands:[...]}`. Read the current revision; retain the exact request when retrying transport uncertainty. Refresh and reconsider on conflict. Use bounded batches rather than one enormous request.

`source.capture` accepts `{id, taskIds, title, locator, content, kind, coverage, replaces}`; kind is `page|file|email|note`, coverage is `complete|excerpt|unreadable`. Attach original bytes with `connection.attach`/HTTP/file tools, then use the asset's actual ID in `source.assetId` and step references. Metadata registration alone does not store the file.

Capture at the narrowest relevant task/project scope. Attaching unrelated or incomplete material to the workspace root can make every descendant packet depend on its gaps. Preserve shared policy at a common ancestor only when it applies to those descendants.

Inventory original file sizes and unique bytes before bulk attachment. Check the installed version's limits; 0.2 allows 64 MiB per file and 256 MiB of unique files per workspace. Preserve oversized originals privately. A task-specific page or archive-member extract can be an input only after inspecting that it contains every requirement needed for that task; record the original locator, digest and page/member lineage, and identify the extract as a derivative. Never call it the whole original or silently omit required content. If an essential input cannot be stored, keep the affected work blocked with a storage recovery action. Do not silently split connected work across workspaces and lose dependencies to evade the limit.

## Packets

With the local SDK, start from `blankPacket(state, taskId, packetId)`. Set `contextKey` to `packetContext(state, taskId).procedureKey` for connected execution. Use the current `work_instructions` context or installed schema when authoring through MCP/HTTP.

Set `execution` to:

```json
{
  "version": 1,
  "coverage": {
    "inputs": "unknown",
    "procedure": "unknown",
    "acceptance": "unknown",
    "note": "What has been checked and what is missing"
  },
  "completion": { "anyOf": ["accepted-finish"] },
  "outputs": []
}
```

Each step has `id`, `title`, `instruction`, `expected`, `ifBlocked`, `minutes` (or null), `actionUrl`, `requires`, `citations`. Connected fields include `after`, `phase`, `references`, `when`, `decision`, `evidenceRequired`. Use explicit `after:[]` for independent actions. A missing `after` retains sequential ordering. Phase is `prepare|work|verify|deliver`.

References contain `id,label,kind,targetId,url,location,page,seconds,essential,purpose`. Kind is `source|asset|external`; purpose is `instruction|input|example`. Use null for an inapplicable page, seconds or external targetId. Cite exact quotes with `{sourceId,quote,location}` from actual captures. Keep the current screen label short and put exact detail in `instruction` and linked references.

Requirements contain `id,label,detail,kind,itemId,url,check,confirmed,citations` and optionally `scope`. Kind is `task|account|software|person|material|information`. A manual worker requirement starts unconfirmed. Put requirement IDs in the affected step's `requires`; an unassigned requirement applies to every step. Do not make an output, the task itself or its enclosing project a prerequisite. Access to the submission portal belongs on delivery if earlier modeling can proceed offline.

Use `{stepId,optionId}` for a conditional step and `{prompt,options:[{id,label}]}` on its decision. Finish alternatives belong in `execution.completion.anyOf`. Outputs contain `{id,label,description,stepId,required}`. Define exact formats, destination and checks from the specification; preserve unknown acceptance rules as blockers.

Questions contain `{id,question,resolve,url,answer,citations}`. Leave an unknown answer empty and give a concrete research/recovery route. Excerpts trigger coverage questions; resolve them only after inspecting what was omitted. A captured author note may explain a proposed method but cannot prove a missing source's contents.

An inaccessible delivery source is not just an account prerequisite when its required procedure or acceptance remains unknown. Keep a visible source-review question/recovery; confirming access does not answer it. Packet coverage is global: if local preparation is fully specified but delivery is not, use separate preparation and delivery tasks/packets with a supported dependency so preparation can remain actionable. Review only the inspected scope. Exact future UI coordinates are not inherently required when the source already establishes an unambiguous action and outcome, but do not mark acknowledged missing procedure or acceptance knowledge as checked.

Save with `packet.save` and the actual previous packet ID (or null). Review with `packet.review` only after semantic coverage is checked and issues resolved. A mapping-only session must not manufacture `packet.check` results. For genuine historical completion, store the sourced item status and history instead of simulated execution.

## Persistence and presentation

Export a `statework.bundle` including files for handoff and audit. A snapshot alone loses original bytes. Verify round-trip import into a new temporary workspace and inspect handoffs there. Keep private source material local unless sharing that content was explicitly requested.

Use saved views for required/chosen work, blockers and completed history. Verify their queries against the actual observation. Presentation preferences and planner settings may be client settings rather than workspace data; configure only supported controls and confirm the result in the UI. Let a person open the current task, inspect the exact source and follow a recovery link with minimal typing.
