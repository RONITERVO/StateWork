# Verify without repeating a stalled calculation

## Saved-state evidence

Record document units, required sketch/feature state, body/component counts, source-critical dimensions, external references and open/save/rebuild flags. Decode warnings with the installed version's enums; they are bitmasks, and load warnings differ from save warnings. A read-only-open warning and a regeneration warning can appear together.

Interpret auxiliary outputs only when their API contract makes them meaningful. For `IFeature.GetErrorCode2`, inspect `IsWarning` only when the returned feature code is nonzero; that Boolean alone cannot turn a zero feature code into a failure. Preserve raw observations while keeping interpreted results separate.

Save, close and reopen the candidate in SOLIDWORKS. Keep the original return flags. A successful rebuild or a clean feature tree does not prove the next reopen will be warning-free. `Extension.NeedsRebuild2`, configuration `NeedsRebuild`/`IsDirty` and `GetSaveFlag` describe different state; report disagreements rather than picking the most favorable signal. Verify all configurations that the task actually requires. Consult the installed documentation before using all-configuration rebuild/save operations.

Use an independent source-derived check for critical geometry. Sketch constraints, actual native fits, sectioned solids, measured placements and reopened references supply different evidence. A hash establishes file identity, not geometric correctness. An inspection that triggers in-memory recalculation can set a save flag; do not save a frozen review candidate or describe that recalculation as a repair of the saved bytes.

For flexible subassemblies, record occurrence constraint states as well as the document's rebuild flags. A saved assembly can reopen with `swNoSolution` even when its document flags are clear. Do not accept that status automatically. If diagnosis justifies a solver refresh, record one bounded rebuild, compare component transforms before and after, and recheck constraints, mates and bodies. A successful in-memory solve qualifies that inspection; it does not erase the original reopen failure or prove that the saved file no longer needs a refresh. Preserve the qualification with the deliverable and verify each required key or linkage motion separately.

Where body or annotation-attachment order is unspecified, match entities through verified native identity and preserve multiplicity. Persistent-reference bytes can change across saves; retain the raw values, resolve them in the correct document context and use the documented native equality methods. Changed or indeterminate identity remains unresolved. After restoring a driver, verify required dimensions, constraints, topology and body validity, and report remaining centroid or area differences against the specification. Treat null metadata as unavailable even when separate geometric evidence passes.

Require every file-identity read to succeed and return an actual digest before comparing identities. Two failed reads producing null do not establish preservation. If an open native file prevents a hash read, use an appropriate read-sharing mode or close only the owned document after handling unsaved work; preserve the failed attempt and record the successful replacement evidence separately.

When an assembly saves without errors but remains dirty or reopens needing regeneration, inspect the save and configuration flags of its referenced documents too. A full hierarchy rebuild can dirty dependent parts; saving only the top-level assembly may leave those changes unsaved. If diagnosis supports saving dependencies together, preserve recoverable copies, verify that every resolved reference belongs to the owned working set, and use the documented `swSaveAsOptions_SaveReferenced` option. Then verify the saved hierarchy by closing and reopening it; configuration rebuild/save marks alone do not establish that the warning is resolved.

## Explicit interference calculation

Keep interference detection out of generic open-document or metadata probes. Use the current installed `InterferenceDetectionManager` interface when suitable, with options chosen deliberately and recorded. Do not assume an older API is obsolete merely because it failed in one installation; verify its documented status and preserve the actual failure.

Both `GetInterferences()` and `GetInterferenceCount()` are documented calculation operations. Do not call the second as a progress poll or automatically call both for the same geometry. Use one successful count-only calculation when the count is sufficient, or retrieve the interference objects once and inspect their result. Preserve a null or unexpected return shape explicitly; do not coerce it to an empty array and claim zero. Consult the installed contract for the empty-result representation before interpreting it. Obtain additional detail only when it is needed.

Several interference objects can belong to the same component pair. Preserve each object's identity, volume and bounds; report unique pairs separately from the returned object count. A touching pair need not produce a volumetric interference object. If only the result reader or classification was wrong, correct the interpretation from the retained results instead of repeating the unchanged calculation.

Log the exact call/options and start time before it runs; log its actual return, result count, duration and app process identity afterward. Use the documented `Done()` cleanup in a `finally` path after a returned calculation when the manager remains usable. `Done()` is not a documented guarantee that another blocked thread can be interrupted safely. Restore changed options/preferences and release the manager.

If a returned calculation leaves the document marked modified, retain its result and inspect the separate save, configuration-dirty and rebuild flags. Record any failed post-check as a failure even when the calculation itself returned a valid count. When the inspection was the only in-memory change to an owned frozen review candidate, close without saving and verify the unchanged bytes and clean reopened model. Do not repeat the calculation solely to obtain a clean save flag.

Run the check once for the candidate's meaningful geometry state and once where independent acceptance requires it. A new source geometry, configuration, component transform or unresolved interference question can justify another calculation. Reopening a drawing, calculating a hash or copying unchanged files does not by itself justify repeating it. Validate a reusable detector on known separated and overlapping fictional solids before relying on a universal zero-result claim.

## Nonreturning call or crash

A blank progress bar, dialog disappearance, chime or closed helper does not identify the result. Stop issuing additional native calls while the operation's outcome is unknown. Inspect the current app/window and the job log. Let a responsive, justified long calculation continue within a bounded deadline; do not restart it as a polling strategy.

If cancellation is available in the observed dialog and appropriate for the job, use that control through computer use, then inspect the outcome. Terminating only the identified helper process may recover the controller but does not prove that SOLIDWORKS stopped. Do not kill the CAD application, discard unrelated unsaved work or silently relaunch it. If a crash is suspected, inspect a narrowly scoped local application event record and current process identity; preserve the event time, fault module and exception, without claiming a causal stack trace you do not have.

After a crash, treat the in-flight operation as failed/unknown. Preserve surviving files and autosave candidates. Reestablish actual application/license/document state before recovery. Inspect and reopen the last saved checkpoint; compare hashes and source geometry as needed before continuing. A later successful check can verify the later candidate, but does not turn the earlier crash into a successful attempt.

Ask the user for the smallest necessary action when recovery would require handling their unrelated unsaved documents, unavailable access or an uncertain destructive choice. Continue independent source work while waiting. Never hide a remaining warning, repeat a known crashing path without a justified change, or mark cancelled verification as passed.
