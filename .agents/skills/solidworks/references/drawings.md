# Drawings

Read when native drawings are required: sheets, views, sections, dimensions, title blocks, BOMs and balloons. Exports and packaging: [files-exports.md](files-exports.md).

## Checklist

- Use the requested template and verify its sheet-format path, size and orientation after reopening.
- Use native views of the intended model/configuration and geometry-associated dimensions; a typed list is not a drawing.
- Recheck sheet and view scales after inserting views.
- Verify BOM rows against the actual active occurrences of the intended configuration.
- Check the exported PDF and the reopened native drawing separately.
- Run `cad.DrawingReport()` after layout: its `layout` lists (`outside`, `overlapping`, `onTitleBlock`) must be empty, and `rebuildErrors` 0.
- Look at the PDF rendered to an image at readable size (for example `pdftoppm -r 90 -png`): long title-block text overflows its cell, and auto-placed balloons and dimensions collide with other views.

## Requirements and templates

Inspect the assignment and source drawing for the required sheets, views, sections/details, scale, dimensions, fits, finish notes, labels and bills of materials. Use the requested templates when available, preserving their original files and recording which template created each output. Do not invent material, mass, tolerances or an author identity that the source/user has not established.

Check a drawing template's actual sheet-format path after creating and reopening a document. A template can exist while still pointing at its author's unavailable format folder. Repair links in working copies and verify the matching sheet size and orientation. Preserve supplied drafting standards, custom unit systems, layers and title-block properties; a part's unit setting need not be the correct setting for its drawing. Change persistent template folders or defaults only within an authorized setup task; ordinary modeling can use an explicit template path without rewriting the user's defaults.

## Views and dimensions

Use native views linked to the intended model/configuration and geometry-associated dimensions. A typed dimension list beside an undimensioned model view is not an equivalent drawing. Check dimension types and symbols, value overrides, dangling annotations, section direction, arrow placement and view references. Show the sections needed to expose internal geometry; do not use a plausible-looking exterior as evidence of a hidden feature.

If a symbol returns after a prefix-only API edit, inspect the actual dimension editor before repeating the call. In the native dimension text field, preserve the live `<DIM>` placeholder when removing an incorrect symbol. Accept the edit, then verify the measured value, visible value setting, absence of a value override and retained geometry associations after rebuilding and reopening. The editor may automatically reposition nearby dimensions; inspect their spacing again.

A stored source display-dimension reference can stop resolving after reopening while its underlying model parameter remains intact. Before rebinding, verify the unchanged source file/configuration, the original feature identity, and a unique current carrier whose native parameter is the same object as the drawing dimension. Check its value, type and associations. Preserve the failed reference and recovery evidence; matching displayed text or a dimension name alone is insufficient.

Recheck sheet scale after inserting views: automatic scaling can change the sheet despite a view being linked to it. Restore the required sheet scale and verify the view, sheet and printed scale together. A display-mode setter can return false when the requested mode already applies; inspect the actual mode and precision setting before repeating it.

## Drawing jobs with the kit

The kit covers the usual pipeline; names are in [swkit-api.md](swkit-api.md#drawings):

1. `cad.NewDrawing(template, sheetFormat)` creates the drawing and relinks the sheet format when the template still points at its author's folder (course templates point at a network share). It logs the relink; check `TitleBlockText()` afterwards.
2. Views: `StandardViews(model, "*Front", below, beside, iso, gapMm)` picks the largest scale from 10:1 to 1:50 whose views, iso view and gaps clear the title block. For your own layout use `ModelView`, `ProjectedView`, `SectionView`, `DetailView`, `CentreView` and `OutlineMm`.
3. The first model view on a fresh template auto-scales the SHEET (a 100 mm part came out at 1:2). After creating views, set `cad.CurrentSheet.SetScale(n, d, false, false)` and `view.UseSheetScale = 1`, rebuild, and only then measure `OutlineMm` and place things relative to it.
4. Dimensions: `InsertModelDimensions()` for all views, or `InsertModelDimensionsInto(view)` view by view in priority order to decide where each lands. A sketch dimension only appears in a view parallel to its sketch plane (a profile sketched on Front shows in the front view, not in a section cut through the Right plane). `TidyDimensions(priority, clear, drop)` keeps each dimension once, clears iso views and drops listed names (`"D1@Sketch1"`). `MoveDimension(dd, x, y)` places text in sheet mm; compute positions from the view outline and the model origin. With the SOLIDWORKS window minimized, insertion returns nothing for new views; the kit restores the frame for the call.
5. Sections and details: `SectionView(parent, a, b, label, x, y, flip)` takes the cut line in sheet mm and converts it through the parent view's sketch transform (an activated view sketches in model space; an unconverted line misses the model and gives an unhatched side view). Keep the section line ends clear of dimension rows, the arrows and labels sit there. Hatch follows the material: Glass gets the glass pattern, and a 2 mm wall at 1:1 shows almost no hatch lines. Partial and depth-limited sections were not reliable through the API; check the view is not empty.
6. Title block: write model custom properties with `SetProperty` (it verifies with `Get6`; `Add3` can return 1 and keep the old value for properties that already exist) and read the result with `TitleBlockText()`. A configuration-specific property of the same name wins over the file-level one in BOMs and `$PRPSHEET` notes; the kit updates both. Some templates link both Mass and Weight; blank the one you do not use. `LinkMassKg` links the mass.
7. BOM and balloons: `BomTable(view, x, y, template, swBomType_e)` (parts only, top level or indented), `AddBomPropertyColumn` (for example Material), `SetTableColumnWidths`, `SetTableTextHeight`, `SetTableRowHeights`, `TableBoxMm`. `AutoBalloons(view)` balloons every visible component; `Balloon(view, component, x, y)` adds one for an item hidden in that view (section-view components have path-like names, the kit matches the leaf). Auto-placed balloons can land outside the frame or on another view: move them inside and recheck the layout.
8. `SaveDrawing(slddrw, pdf)` saves both and checks the files exist; then `DrawingReport()`.

A view of a non-active assembly configuration shows a single-configuration in-context part as it was last rebuilt. Make one drawing per configuration that matters, or describe the configurations in notes, and say which configuration each view shows.

## Title block and exported sheets

Replace template placeholders with factual values or leave unspecified fields blank. Hide construction overlays where they obscure the drawing. Label individual view scales when they differ from the sheet. Inspect exported sheets at readable size for clipping, overlaps and ambiguous radius/diameter leaders. Check the PDF/export and the reopened native drawing separately; clean PDF output does not establish intact native associations.

## Bills of materials and balloons

Where an assembly list is required, verify actual components and quantities, item numbers, balloons and configurations against the assembly. Do not count a stale table as evidence that referenced parts are present.

Read native BOM objects and membership deliberately. A saved table reference can resolve directly to `IBomTableAnnotation` instead of `IAnnotation`, and tables can belong to the sheet view. Inspect the returned interface and existing tables before inserting a replacement. Component getters can include suppressed occurrences even when the displayed quantity excludes them. Preserve the raw inventory, compare active occurrence identities with the intended configuration, and verify the displayed quantity separately. Keep distinct configurations separate when the specification requires them.
