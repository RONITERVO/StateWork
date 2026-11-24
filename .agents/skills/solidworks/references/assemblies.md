# Assemblies

Read when inserting components, mating, patterning, testing motion, building exploded views or checking clearances. Working code: [cookbook.md](cookbook.md) (assembly recipe). Interference procedure: [verification-recovery.md](verification-recovery.md).

## Checklist

- Open component files before inserting them, place each near its final pose, and read back transforms after solving.
- Pick mate entities by type and transformed geometry, and verify alignment, side and distance after the solve.
- Check mate errors, suppression and component constrained status in every required configuration.
- Measure critical clearances; volumetric interference and contact are different observations.
- Treat exploded views, motion and in-context references as separately verified states.

## Inputs and placement

Determine component counts, configuration choices, placement, intended motion and mate requirements. Reuse exact verified inputs through working copies or a portable dependency set. Do not edit a previously reviewed dependency in place. Verify transforms and seating against the specification; convenient lock mates are appropriate only when the required result permits a static arrangement.

An assembly can already hold an insertion source in memory without a separate visible part window. Verify the resident source's identity and available configurations, and use an access method documented for that document state before deciding to reopen it.

Reacquire the exact selection immediately before operations such as `FixComponent`; assigning a component transform can invalidate an earlier selection. Read back its fixed state and transform. Choose mates for the actual entity types: native reference-axis pairs can use a coincident mate to align their lines while retaining rotation; do not assume every coaxial relationship accepts a concentric mate.

## Mates

For planar seating, distinguish the physical face normal from the underlying surface normal. Verify which material sides meet after solving, and recheck earlier mates whose alignment the solver may have changed.

For concentric mates, derive alignment from the actual native cylinder directions transformed into the intended assembly pose. An axis direction chosen for a geometric search can have the opposite sign. For distance mates, verify both the distance and its side (`IDistanceMateFeatureData.FlipDimension`). If a check catches a flipped part or opposite-side placement, preserve the partial assembly, correct the existing mate, and verify the affected transforms before continuing.

## Component patterns

For component patterns, verify the created feature's direction, instance positions, spacing and configuration policy. A setter or missing getter on an uncommitted definition does not establish the saved result. Follow the documented selection marks during creation; if a setting such as `ForceUseSeedConfiguration` was not retained, modify the existing feature and verify it again. Use selection access when the operation requires it, release it appropriately, and observe any rollback or dirty-state effect rather than assuming every inspection is passive.

## Motion

Verify independent movement by comparing the target and all other affected component transforms after the solve. Moving a nested component can move its parent and siblings. If a relative drag reaches the wrong pose, inspect the coordinate frame and the installed `IDragOperator` contract; an absolute root-coordinate target with deliberate transform and drag modes can resolve that ambiguity. Read back the final pose even when the drag reports success or correction. Test the required motion, restore the starting arrangement and distinguish sampled positions from a continuous swept-path check.

## Configurations and occurrence context

For part-document measurements, confirm the actual active configuration. For solid or surface part occurrences, verify `IComponent2.ReferencedConfiguration` and inspect `GetBodies3` in that occurrence's context; the shared part document's active configuration does not describe every occurrence. A configuration activation request may return false when that configuration is already active; inspect its identity before deciding the outcome. For every required configuration, check mate suppression, configuration-specific driving values, component resolution and transforms. An error-free mate can still be suppressed, and editing a mate definition can affect more than the currently intended configuration.

Map faces, edges and vertices with the documented entity-mapping API, and features with their applicable mapping API. Testing only whether an object implements `IEntity` is insufficient: a reference-axis feature can implement it too. If a source face token does not resolve for an occurrence's configuration, inspect that occurrence's bodies. A unique match against reviewed surface geometry and trimmed area can identify the intended face; reject ambiguous matches, verify the selected component owner and retain the actual assembly-context identity for subsequent checks.

## Clearance, contact and interference

Use dimensions, sections or native measurements to check critical clearances and interfaces. Interference detection is an explicit verification operation, not a generic session-health probe; follow the bounded calculation guidance in [verification-recovery.md](verification-recovery.md). Coincident contact and volumetric overlap are different observations, and the chosen detection options belong in the evidence.

A nominal stack height or matching body envelope does not establish contact with the neighboring trimmed surfaces. Where seating matters, measure the actual occurrence pair, retain the closest-point witnesses, and inspect overlap separately. If the specification permits a simplified contact or slight penetration, identify its exact scope and measured extent rather than treating every overlap as acceptable.

## Exploded views

Verify an exploded presentation through its actual step members, distances, transforms and a visible preview. `CreateExplodedView` can generate steps immediately; inspect the result before adding your own. A successful creation call, named view or nonempty step list does not establish the intended layout. An autogenerated spacing step can move components even when its reported scalar distance is zero and its overall transform is identity. Inspect its spacing settings and actual component positions in the expanded and collapsed states. Preserve the original candidate, correct only the identified step in a new candidate, and verify the separated view and restored assembled state after saving and reopening. Do not repeat view creation merely because the first view lacks useful separation.

Do not assume a native exploded view uses `PresentationTransform`. In a verified native explode, that property can be null while `Transform2` and both forms of `GetTotalTransform` report the expanded positions. Record a collapsed baseline before editing, compare the expanded state with the intended offsets, then collapse and compare against the original baseline. A transform getter alone does not establish which display state was measured.

When reusing a subassembly explode, verify the native reuse step and nested component membership, directions and distances. Reused steps can receive new names; compare their content with the source steps. If `GetComponents` returns null, inspect the documented indexed `GetComponent` and `GetComponentName` accessors with `GetNumOfComponents`. Preserve repeated members when they belong to multiple steps; a unique-component count alone cannot verify the reused sequence.

## Top-down, in-context and mirrored components

In top-down and in-context assemblies, manage external references and circular rebuild loops deliberately. When decoupling a working copy (`SaveAs Copy` plus `BreakAllExternalFileReferences2`), break external references on the dependent parts before deleting driving assembly-level features (`Hole`, `Fillet`, `Cavity`) so derived geometry remains intact; then confirm zero unintended external references and verify live kinematic motion. When an in-context component or assembly `Cavity` is driven by another component's position across configurations, rebuild and verify geometry, cavities and clearances in every required configuration rather than only `Default`. For `MirrorComponent`, distinguish reoriented mirrored instances from newly created opposite-hand derived part files, and verify both the mirror orientation index and persisted derived files on disk.
