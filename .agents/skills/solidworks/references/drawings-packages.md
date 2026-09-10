# Drawings and portable files

## Native drawings

Inspect the assignment and source drawing for the required sheets, views, sections/details, scale, dimensions, fits, finish notes, labels and bills of materials. Use the requested templates when available, preserving their original files and recording which template created each output. Do not invent material, mass, tolerances or an author identity that the source/user has not established.

Check a drawing template's actual sheet-format path after creating and reopening a document. A template can exist while still pointing at its author's unavailable format folder. Repair links in working copies and verify the matching sheet size and orientation. Preserve supplied drafting standards, custom unit systems, layers and title-block properties; a part's unit setting need not be the correct setting for its drawing. Change persistent template folders or defaults only within an authorized setup task; ordinary modeling can use an explicit template path without rewriting the user's defaults.

Use native views linked to the intended model/configuration and geometry-associated dimensions. A typed dimension list beside an undimensioned model view is not an equivalent drawing. Check dimension-value overrides, dangling annotations, section direction, arrow placement and view references. Show the sections needed to expose internal geometry; do not use a plausible-looking exterior as evidence of a hidden feature.

Replace template placeholders with factual values or leave unspecified fields blank. Hide construction overlays where they obscure the drawing. Label individual view scales when they differ from the sheet. Inspect exported sheets at readable size for clipping, overlaps and ambiguous radius/diameter leaders. Check the PDF/export and the reopened native drawing separately; clean PDF output does not establish intact native associations.

Where an assembly list is required, verify actual components and quantities, item numbers, balloons and configurations against the assembly. Do not count a stale table as evidence that referenced parts are present.

## Save and package

Save the required editable parts, assemblies and drawings plus requested exports. Keep full original quality. Inspect returned save status and warning flags. Do not save over source examples or previously reviewed artifacts merely to simplify filenames.

Use the requested packaging workflow. For SOLIDWORKS Pack & Go, inspect the actual document list and options, including drawings when required. Keep drafts and unrelated models out of the delivery folder. Validate each package save status and the resulting archive members. Record prepackage and packaged identities separately: rewriting file references can legitimately change assembly/drawing bytes.

Extract into a new private folder. Confirm ZIP integrity and a complete native dependency set. Close only job-owned candidate documents first, then open the extracted assembly and drawings without another same-named model already loaded. Inspect resolved component and drawing paths: a successful open can otherwise borrow an already open original and conceal a missing packaged file.

Compare extracted members with archive bytes and verify the required models/views. Do not rerun expensive geometry calculations solely because a byte-identical part was copied. Recheck geometry when packaging, reference resolution or a model/configuration change leaves a material question. Record the native packaging command/returned statuses as execution evidence; saved artifacts alone do not prove which command produced them.
