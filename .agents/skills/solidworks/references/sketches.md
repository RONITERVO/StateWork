# Sketches and dimensions

Read when creating or editing sketch geometry, dimensions and relations. Working code: [cookbook.md](cookbook.md) (sketch recipes). Call details: [api-quick-reference.md](api-quick-reference.md).

## Checklist

- Convert every model point to sketch coordinates through `ISketch.ModelToSketchTransform` (`Cad.ToSketch`); sketch axes and signs differ per plane and face.
- Create entities with `AddToDB` on and display off (`Cad.Exact`), restored in `finally`; create slots with inference and automatic relations off as well (`Cad.Slot`).
- Every dimension you add must come back driving (`DrivenState` 2) and measure a nonzero distance; express zero offsets as relations.
- Read the constrained status before closing (3 = fully defined). Report intended remaining freedom instead of fixing geometry.
- After trims, fillets or other solver edits, re-read the source-driving values and confirm the contour is still connected and closed.

## Reading source dimensions

Establish the sketch plane, origin/datums, construction entities, open/closed contours and required dimensions from the original. Differentiate diameter, radius, doubled linear dimensions, perpendicular offsets and projected distances. Read angle orientation and the endpoints actually dimensioned. Parentheses or reference styling may indicate a driven measurement rather than a rounded driving value; confirm the source meaning.

Compare the actual dimension witnesses, not just the printed number. A slot dimension between arc centers differs from its overall length by one slot width. When dated briefs intentionally describe different variants, preserve separately named models or configurations and state which source each satisfies. Do not combine conflicting dimensions into a result claimed to satisfy both. If the required choice remains unresolved, expose that decision in review.

Verify native tolerance and fit properties, including hole/shaft fits, rather than adding their names as unrelated notes. Keep driven/reference measurements derived from geometry where required. Do not overconstrain a system by forcing a rounded reference value; compare its calculated value and displayed precision separately.

## Relations, constraint status and contours

Use native dimensions and meaningful coincidence, tangent, parallel, perpendicular, concentric, symmetric and equal relations. Check the supported relation names in the installed API and verify the relation actually exists afterward. A method returning without throwing does not prove an entity was selected or a relation added. Inspect constraint status and remaining degrees of freedom; do not make everything fixed merely to obtain a fully defined label.

Check native contour connectivity and closure after trims, splits, merges or sketch patterns. Matching endpoint coordinates and a fully defined status do not establish that the intended profile is connected. Reacquire sketch entities after topology changes, then verify the intended shared vertices, relations and open endpoints before using the profile in a feature.

Re-read source-driving values and their witnesses after solver-driven edits such as sketch fillets. A fully defined result can retain the correct witnesses while a dimension value has changed. Determine which changed before deleting a dimension or replacing its references. For doubled dimensions, verify the actual system value and native diameter semantics after saving and reopening; a display getter need not echo the creation method's dimension-type argument.

## Exact creation without snapping

If sketch creation fails or shifts geometry through snapping or inference, inspect the active sketch before retrying. `ISketchManager.AddToDB` can create exact entities without UI inference; always restore its original value in a `finally` path afterward, then add the intended relations and verify coordinates and constraint status. On non-Front planes (`Top`, `Right`, tilted reference planes), read `ISketch.ModelToSketchTransform` rather than guessing sketch-axis signs. When tracing calibrated reference sketch pictures, keep them in a dedicated folder, capture alignment verification overlays while visible, and hide them at completion when required. Resume an observed empty sketch or correct the actual partial instead of blindly creating another feature.

Several slots can share one sketch: `Cad.Slot` works only on the segments its own call created (centre arcs and centre line), and keeps "Input dimension value" off while the slot's dimensions are added. To sketch on an existing face, use `Cad.PlanarFaceAt(axis, coordinate, outwardSign)`. `PlanarFace`'s offset is measured along the given normal, so the face at Y = 48 facing -Y is `PlanarFace(0, -1, 0, -48)`. A wrong sign throws and lists the offsets that do exist.

Not every creation call honors `AddToDB`. `ISketchManager.CreateSketchSlot` can still infer against nearby or projected geometry and move a slot center (observed: a center moved 1 mm onto an unrelated reference-plane line). The location dimensions added afterwards then come back driven. Around such calls, also turn off the `swSketchInference` and `swSketchAutomaticRelations` user toggles and restore them in `finally`. Then read the arc centers back in model coordinates and add the relation that automatic relations would otherwise supply, such as a vertical centerline. Confirm the constraint status.

## 3D sketches, imports and blocks

- 3D sketches: `Open3DSketch`, `Line3D`, `Polyline3D`, `Arc3Points`, `SketchPlane3D`, `Dim3D` (text at a model point), closed with `CloseSketch`. `CreateFillet` in a 3D sketch edited in context ignores a selected corner point; `SketchFillet` retries with the two lines meeting there. For pipe routes use `FilletedPolyline3D(radius, points)`: exact tangent arcs and lines, ready for `SweepCircle` (with `thinMm` for a tube).
- `SketchAddConstraints` returns nothing, and a relation such as `sgPARALLELYZ3D` on a lone line is dropped silently: `Relate` checks that the relation count grew and accepts an identical existing relation.
- Sketch segment wrappers are not comparable with `==`/`!=`: the same segment fetched twice compares unequal. Compare geometry or IDs.
- `EditRebuild3` inside an open sketch closes the sketch.
- `CreateEllipticalArc` always runs counter-clockwise in sketch space: choose start and end by sketch x to get the intended half.
- `SketchOffset2` on non-planar model edges (drafted or filleted faces) returns false; `OffsetEntities` converts those edges first and offsets the converted loop.
- DXF/DWG: `InsertDxf` imports onto a plane. The import sketch cannot be opened for editing (EditSketch, InsertSketch and RunCommand silently do nothing): copy its segments into normal sketches (`CopySegmentsToNewSketch`, `KeepOnlySegments`, `MoveSegmentsTo`). Hidden lines import as construction geometry; section arrows and symbols import as tiny closed regions, so filter regions by area (`SketchRegions`, `RegionAreaMm2`). `SelectByID2` with `SKETCHREGION` misses regions of planes seen edge-on; use the kit's region helpers.
- Blocks (`MakeBlock`): the definition origin is the bounding-box centre and `InstancePosition` the insertion point; block point coordinates are definition coordinates. Merge block points with `sgMERGEPOINTS` (`sgCOINCIDENT` fails) and use `sgSAMELENGTH` for equal length. A sketch made only of block instances exposes regions but no contours, so extrude it by regions; overlapping block outlines split into own and overlap regions. Setting `ISketchBlockInstance.Angle` through the API read back 0 here; drive a block mechanism from the UI or by relations.

## Dimensions that do not drive

After adding a dimension, read `IDimension.DrivenState`. A dimension placed on already-constrained geometry is driven (reference). Setting its value or attaching an equation to it is accepted without error but changes nothing. Remove the unintended relation or recreate the entity cleanly instead of layering equations on a driven value.

A dimension needs a nonzero measured distance. `AddHorizontalDimension2` between vertically aligned points, or `AddVerticalDimension2` between horizontally aligned points, returns null. Express a zero offset as a relation instead: `sgVERTICALPOINTS2D` or `sgHORIZONTALPOINTS2D` with the origin or the other point, or a coincident relation.

When the user option **Input dimension value** (`swInputDimValOnCreate`) is on, `AddDimension2` and its horizontal/vertical variants open the modal Modify box. The API call then blocks until a person answers it, and a bounded job only times out. Turn the toggle off just for the call and restore it in `finally` (`Cad.Dim` does this). If a job is already blocked on that box, follow the recovery in [automation.md](automation.md#c-jobs-with-swkit).
