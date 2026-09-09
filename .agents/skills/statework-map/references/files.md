# Keep the files the work needs

Build a private file inventory alongside the research ledger. For each original, record its exact locator, SHA-256, byte size, task IDs, source context and disposition: `input`, `instruction`, `reference`, `history`, `optional`, `incidental` or `uncertain`. Record why the file belongs and where it is used. A task's existing reference is a useful signal, not proof the reference was authored correctly.

Inspect page context and the file itself before excluding it. A website logo, portrait, banner or course navigation thumbnail is usually incidental; a drawing, assembly screenshot, interface instruction or embedded figure can carry essential information even when it includes logos. A filename, image extension, small size or absence from the current packet is insufficient grounds for removal. Keep uncertain material until its role is resolved.

Store one byte copy per digest; preserve distinct source locators, versions and task relationships. Identical filenames do not establish identical bytes. A shared book or template can support several tasks without being downloaded or shown repeatedly at every step. Attach common instructions at the applicable project scope, and link only the relevant file/page/section at each action. Optional tutorials stay available as references without becoming mandatory inputs.

When repairing an existing map, first preserve a complete recoverable package or database backup. Keep prior execution evidence and source provenance. An exclusion report should name each removed file identity, its source context and reason, affected references and recovery location. Revise affected current instructions and remove their review when the input route changes; do not pretend old checks validate a changed route. Frozen evaluation proof must remain unchanged. A cleaned new workspace may preserve the original for comparison; make its identity and limitations clear.

Use the current app's reversible `asset.archive` command after revising any current packet that still uses an incidental file. Supply the file ID, `archived:true` and an evidenced reason in a normal revision-checked command request. `archived:false` restores it. Archiving preserves bytes and history and still consumes storage; distinguish a cleaner active file list from freed disk space. Do not directly delete database rows or original blobs. Shared course files should be linked to the applicable course/project so descendant tasks can find them; a generic research-recovery task is not a useful permanent file location.

Use `asset.relink` with the file ID, researched `taskIds` and a reason to correct organizational placement without replacing the original. Preserve source-specific aliases when identical bytes were found in different contexts. Review explicit packet references separately: moving a file does not automatically rewrite a mistaken instruction or establish that the file is required.

## Capacity and portable transfer

Inspect the installed host's `storage` CLI command or `connection.storageInfo(workspaceId)`. Current source supports 128 MiB per file and a default 2 GiB of unique stored bytes per workspace. The trusted local host may set `STATEWORK_WORKSPACE_FILE_LIMIT_BYTES`; choose a disk budget intentionally. Earlier 0.2 installations may still enforce 64 MiB/file and 256 MiB/workspace. Read installed contracts before selecting a method.

Inline JSON bundles remain limited to 64 MiB/file and 256 MiB in total. A larger collection must use a portable directory package, which transfers original bytes one file at a time and avoids one enormous base64 JSON string:

```text
node <app>/packages/tools/dist/cli.js storage <workspace-id>
node <app>/packages/tools/dist/cli.js package-export <workspace-id> <new-private-directory>
node <app>/packages/tools/dist/cli.js package-import <private-directory> <new-workspace-id> "Work and files"
```

Keep `manifest.json` with its `blobs` directory. The package contains private work and originals, without credentials. Verify a round-trip import and matching digests. The skill auditor accepts `--package <directory>` instead of `--bundle <file>`; package audits use a fresh temporary database rather than loading every original into a single string. File availability does not prove that its contents were inspected.

Do not shrink originals merely to satisfy the old JSON transfer limit. For a file above the installed per-file bound, keep the original in recoverable storage and use a suitable adapter or an inspected task-specific derivative. Record the original digest, locator and exact page/member lineage. A derivative is sufficient only when it preserves every requirement needed for the task; never label it the complete original. Keep a storage blocker when an essential input remains unavailable. Splitting connected work across workspaces loses dependencies and is not a storage fix.
