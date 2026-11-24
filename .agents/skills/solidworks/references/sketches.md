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

Not every creation call honors `AddToDB`. `ISketchManager.CreateSketchSlot` can still infer against nearby or projected geometry and move a slot center (observed: a center moved 1 mm onto an unrelated reference-plane line). The location dimensions added afterwards then come back driven. Around such calls, also turn off the `swSketchInference` and `swSketchAutomaticRelations` user toggles and restore them in `finally`. Then read the arc centers back in model coordinates and add the relation that automatic relations would otherwise supply, such as a vertical centerline. Confirm the constraint status.

## Dimensions that do not drive

After adding a dimension, read `IDimension.DrivenState`. A dimension placed on already-constrained geometry is driven (reference). Setting its value or attaching an equation to it is accepted without error but changes nothing. Remove the unintended relation or recreate the entity cleanly instead of layering equations on a driven value.

A dimension needs a nonzero measured distance. `AddHorizontalDimension2` between vertically aligned points, or `AddVerticalDimension2` between horizontally aligned points, returns null. Express a zero offset as a relation instead: `sgVERTICALPOINTS2D` or `sgHORIZONTALPOINTS2D` with the origin or the other point, or a coincident relation.

When the user option **Input dimension value** (`swInputDimValOnCreate`) is on, `AddDimension2` and its horizontal/vertical variants open the modal Modify box. The API call then blocks until a person answers it, and a bounded job only times out. Turn the toggle off just for the call and restore it in `finally` (`Cad.Dim` does this). If a job is already blocked on that box, follow the recovery in [automation.md](automation.md#c-jobs-with-swkit).
