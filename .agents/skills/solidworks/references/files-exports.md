# Saving, exports and packaging

Read when saving deliverables, exporting STEP/STL/other neutral files, relocating a project or building a Pack and Go package. Working code: [cookbook.md](cookbook.md) (save and export recipes).

## Checklist

- Inspect SaveAs error and warning flags; never save over sources or reviewed artifacts.
- Export per configuration and per body deliberately; compare mesh volumes with CAD volumes.
- Exclude reference components by suppression, not by hiding.
- After Pack and Go or any relocation, audit stored reference paths of every file, then open the copy with no same-named originals loaded.
- Verify an extracted package independently of the working copies.

## Save

Save the required editable parts, assemblies and drawings plus requested exports. Keep full original quality. Inspect returned save status and warning flags. Do not save over source examples or previously reviewed artifacts merely to simplify filenames.

## Neutral exports

For per-body STL output from a multibody part, hide the other bodies with `IBody2.HideBody` before `SaveAs`; only visible bodies are exported. Set the STL binary, quality and `swSTLDontTranslateToPositive` preferences explicitly, and restore them in `finally`. Keeping model coordinates makes later print orientation reproducible. Unhide every body afterwards. Compare each mesh's enclosed volume with that body's mass-property volume: a difference well above about 0.2 % points to the wrong body or a coarse mesh. For configuration families, activate and rebuild each configuration before its export and name the outputs by configuration.

To export only the product from an assembly that also contains reference envelopes or layout components, suppress those components in the active configuration and export. Restore their suppression in `finally`, and repeat per configuration. Hidden components are not a reliable exclusion.

## Pack and Go and relocation

Before a native packaging call, preserve recoverable byte copies of the candidate and its dependencies, and verify their hashes. A read-only document open is not sufficient proof that packaging cannot write a source file. Check source identities afterward as well as package outputs. If a source changes, retain the actual changed bytes and failed preservation check; a historical hash alone cannot recover the earlier file. Revalidate the resulting native models and references before granting a new acceptance.

Use the requested packaging workflow. For SOLIDWORKS Pack & Go, inspect the actual document list and options, including drawings when required. Keep drafts and unrelated models out of the delivery folder. Validate each package save status and the resulting archive members. Record prepackage and packaged identities separately: rewriting file references can legitimately change assembly/drawing bytes.

Compare that list with every required resolved dependency before saving. Toolbox-marked hardware can be excluded by the current packaging options; inspect `IncludeToolboxComponents` when expected hardware is absent. A successful save of an incomplete list is not a complete package.

Pack and Go can report success for every listed document while leaving a nested subassembly out of `GetDocumentNames`. The packaged parent then keeps that child's original absolute path. Afterwards, audit every packaged file with `ISldWorks.GetDocumentDependencies2(path, traverse, false, false)`. With `SearchFlag = false` it returns the stored paths. With `true` it applies the search rules and can report a same-folder copy while the stored path still points at the original. Copy any omitted file into place and repair the stored link with `ReplaceReferencedDocument` while the referencing document is closed. Re-audit, then open each packaged top level with no same-named originals loaded and check every component path and mate.

To relocate several top-level documents into a mirrored folder tree in one pass, insert all of them into a temporary assembly. Pack that assembly once, with `SetDocumentSaveToNames` mapped by root prefix and the temporary assembly itself mapped to scratch, then discard it. Separate runs that share dependencies would pack them repeatedly. Inserting documents into the temporary assembly can mark otherwise unchanged originals dirty; resolve that before closing them. Copy non-CAD files separately and update any absolute paths recorded in text deliverables.

## Verify a package

Extract into a new private folder. Confirm ZIP integrity and a complete native dependency set. Close only job-owned candidate documents first, then open the extracted assembly and drawings without another same-named model already loaded. Inspect resolved component and drawing paths: a successful open can otherwise borrow an already open original and conceal a missing packaged file.

Compare extracted members with archive bytes and verify the required models/views. Do not rerun expensive geometry calculations solely because a byte-identical part was copied. Recheck geometry when packaging, reference resolution or a model/configuration change leaves a material question. Record the native packaging command/returned statuses as execution evidence; saved artifacts alone do not prove which command produced them.
