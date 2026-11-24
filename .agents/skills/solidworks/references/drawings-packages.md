# Drawings and portable files

## Native drawings

Inspect the assignment and source drawing for the required sheets, views, sections/details, scale, dimensions, fits, finish notes, labels and bills of materials. Use the requested templates when available, preserving their original files and recording which template created each output. Do not invent material, mass, tolerances or an author identity that the source/user has not established.

Check a drawing template's actual sheet-format path after creating and reopening a document. A template can exist while still pointing at its author's unavailable format folder. Repair links in working copies and verify the matching sheet size and orientation. Preserve supplied drafting standards, custom unit systems, layers and title-block properties; a part's unit setting need not be the correct setting for its drawing. Change persistent template folders or defaults only within an authorized setup task; ordinary modeling can use an explicit template path without rewriting the user's defaults.

Use native views linked to the intended model/configuration and geometry-associated dimensions. A typed dimension list beside an undimensioned model view is not an equivalent drawing. Check dimension types and symbols, value overrides, dangling annotations, section direction, arrow placement and view references. Show the sections needed to expose internal geometry; do not use a plausible-looking exterior as evidence of a hidden feature.

If a symbol returns after a prefix-only API edit, inspect the actual dimension editor before repeating the call. In the native dimension text field, preserve the live `<DIM>` placeholder when removing an incorrect symbol. Accept the edit, then verify the measured value, visible value setting, absence of a value override and retained geometry associations after rebuilding and reopening. The editor may automatically reposition nearby dimensions; inspect their spacing again.

A stored source display-dimension reference can stop resolving after reopening while its underlying model parameter remains intact. Before rebinding, verify the unchanged source file/configuration, the original feature identity, and a unique current carrier whose native parameter is the same object as the drawing dimension. Check its value, type and associations. Preserve the failed reference and recovery evidence; matching displayed text or a dimension name alone is insufficient.

Replace template placeholders with factual values or leave unspecified fields blank. Hide construction overlays where they obscure the drawing. Label individual view scales when they differ from the sheet. Inspect exported sheets at readable size for clipping, overlaps and ambiguous radius/diameter leaders. Check the PDF/export and the reopened native drawing separately; clean PDF output does not establish intact native associations.

Where an assembly list is required, verify actual components and quantities, item numbers, balloons and configurations against the assembly. Do not count a stale table as evidence that referenced parts are present.

Recheck sheet scale after inserting views: automatic scaling can change the sheet despite a view being linked to it. Restore the required sheet scale and verify the view, sheet and printed scale together. A display-mode setter can return false when the requested mode already applies; inspect the actual mode and precision setting before repeating it.

Read native BOM objects and membership deliberately. A saved table reference can resolve directly to `IBomTableAnnotation` instead of `IAnnotation`, and tables can belong to the sheet view. Inspect the returned interface and existing tables before inserting a replacement. Component getters can include suppressed occurrences even when the displayed quantity excludes them. Preserve the raw inventory, compare active occurrence identities with the intended configuration, and verify the displayed quantity separately. Keep distinct configurations separate when the specification requires them.

## Neutral exports

For per-body STL output from a multibody part, hide the other bodies with `IBody2.HideBody` before `SaveAs`; only visible bodies are exported. Set the STL binary, quality and `swSTLDontTranslateToPositive` preferences explicitly, and restore them in `finally`. Keeping model coordinates makes later print orientation reproducible. Unhide every body afterwards. Compare each mesh's enclosed volume with that body's mass-property volume: a difference well above about 0.2 % points to the wrong body or a coarse mesh. For configuration families, activate and rebuild each configuration before its export and name the outputs by configuration.

To export only the product from an assembly that also contains reference envelopes or layout components, suppress those components in the active configuration and export. Restore their suppression in `finally`, and repeat per configuration. Hidden components are not a reliable exclusion.

## Save and package

Save the required editable parts, assemblies and drawings plus requested exports. Keep full original quality. Inspect returned save status and warning flags. Do not save over source examples or previously reviewed artifacts merely to simplify filenames.

Before a native packaging call, preserve recoverable byte copies of the candidate and its dependencies, and verify their hashes. A read-only document open is not sufficient proof that packaging cannot write a source file. Check source identities afterward as well as package outputs. If a source changes, retain the actual changed bytes and failed preservation check; a historical hash alone cannot recover the earlier file. Revalidate the resulting native models and references before granting a new acceptance.

Use the requested packaging workflow. For SOLIDWORKS Pack & Go, inspect the actual document list and options, including drawings when required. Keep drafts and unrelated models out of the delivery folder. Validate each package save status and the resulting archive members. Record prepackage and packaged identities separately: rewriting file references can legitimately change assembly/drawing bytes.

Compare that list with every required resolved dependency before saving. Toolbox-marked hardware can be excluded by the current packaging options; inspect `IncludeToolboxComponents` when expected hardware is absent. A successful save of an incomplete list is not a complete package.

Pack and Go can report success for every listed document while leaving a nested subassembly out of `GetDocumentNames`. The packaged parent then keeps that child's original absolute path. Afterwards, audit every packaged file with `ISldWorks.GetDocumentDependencies2(path, traverse, false, false)`. With `SearchFlag = false` it returns the stored paths. With `true` it applies the search rules and can report a same-folder copy while the stored path still points at the original. Copy any omitted file into place and repair the stored link with `ReplaceReferencedDocument` while the referencing document is closed. Re-audit, then open each packaged top level with no same-named originals loaded and check every component path and mate.

To relocate several top-level documents into a mirrored folder tree in one pass, insert all of them into a temporary assembly. Pack that assembly once, with `SetDocumentSaveToNames` mapped by root prefix and the temporary assembly itself mapped to scratch, then discard it. Separate runs that share dependencies would pack them repeatedly. Inserting documents into the temporary assembly can mark otherwise unchanged originals dirty; resolve that before closing them. Copy non-CAD files separately and update any absolute paths recorded in text deliverables.

Extract into a new private folder. Confirm ZIP integrity and a complete native dependency set. Close only job-owned candidate documents first, then open the extracted assembly and drawings without another same-named model already loaded. Inspect resolved component and drawing paths: a successful open can otherwise borrow an already open original and conceal a missing packaged file.

Compare extracted members with archive bytes and verify the required models/views. Do not rerun expensive geometry calculations solely because a byte-identical part was copied. Recheck geometry when packaging, reference resolution or a model/configuration change leaves a material question. Record the native packaging command/returned statuses as execution evidence; saved artifacts alone do not prove which command produced them.
