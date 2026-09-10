# Preserve geometry and design intent

## Sketches and dimensions

Establish the sketch plane, origin/datums, construction entities, open/closed contours and required dimensions from the original. Differentiate diameter, radius, doubled linear dimensions, perpendicular offsets and projected distances. Read angle orientation and the endpoints actually dimensioned. Parentheses or reference styling may indicate a driven measurement rather than a rounded driving value; confirm the source meaning.

Compare the actual dimension witnesses, not just the printed number. A slot dimension between arc centers differs from its overall length by one slot width. When dated briefs intentionally describe different variants, preserve separately named models or configurations and state which source each satisfies. Do not combine conflicting dimensions into a result claimed to satisfy both. If the required choice remains unresolved, expose that decision in review.

Use native dimensions and meaningful coincidence, tangent, parallel, perpendicular, concentric, symmetric and equal relations. Check the supported relation names in the installed API and verify the relation actually exists afterward. A method returning without throwing does not prove an entity was selected or a relation added. Inspect constraint status and remaining degrees of freedom; do not make everything fixed merely to obtain a fully defined label.

Check native contour connectivity and closure after trims, splits, merges or sketch patterns. Matching endpoint coordinates and a fully defined status do not establish that the intended profile is connected. Reacquire sketch entities after topology changes, then verify the intended shared vertices, relations and open endpoints before using the profile in a feature.

Re-read source-driving values and their witnesses after solver-driven edits such as sketch fillets. A fully defined result can retain the correct witnesses while a dimension value has changed. Determine which changed before deleting a dimension or replacing its references. For doubled dimensions, verify the actual system value and native diameter semantics after saving and reopening; a display getter need not echo the creation method's dimension-type argument.

Verify native tolerance and fit properties, including hole/shaft fits, rather than adding their names as unrelated notes. Keep driven/reference measurements derived from geometry where required. Do not overconstrain a system by forcing a rounded reference value; compare its calculated value and displayed precision separately.

## Features and edits

Create the required native features and preserve source-required construction order. When modifying a supplied model, inspect existing features, references and configurations before choosing what to edit. If an exercise requires editing the original extrusion or changing a sketch plane, adding a visually equivalent replacement feature can violate the method requirement.

Validate selections, start/end conditions, direction and actual material removed after each consequential feature. A through-all cut may pierce an opposite wall that the source section leaves intact. Blind depth, D-shaped openings, tangent blends and chamfers must be checked in useful sections or measured geometry. Feature or face names can change after edits; reacquire references rather than relying on stale object handles or assumed face indices.

Locate a face using its actual trimmed boundaries and component transform. The origin of an underlying cylindrical surface can lie outside the bounded face; it does not establish a hole's height, flange location or assembly orientation.

Check body count and native body validity as well as the feature tree's errors/suppressions. Fillet/chamfer success may depend on feature order; use a justified sequence, preserve failed attempts and inspect the resulting surfaces. A saved file with no feature error can still contain the wrong geometry.

For lofts, inspect profile order and connector correspondence. `ILoftFeatureData.PickPoints` contains connector chains, each containing native `MathPoint` objects; read their `ArrayData` instead of treating the outer array as one numeric point per profile. Preserve already-correct connectors. At a tangent join, check the direction and body validity: an apparently smooth, error-free feature can double back into its neighbor. Diagnose returned fault codes and affected faces before changing the tangent direction; do not assume a universal reverse setting.

For material assignment, distinguish the database path supplied to `SetMaterialPropertyName2` from the database name returned by `GetMaterialPropertyName2`; the latter may omit `.sldmat`. Resolve the name to a unique intended installed database and retain its path/hash. Verify the actual material, density, mass and override state separately from visual appearance. A returned naming difference alone does not justify reconstructing correct geometry.

## Assemblies

Determine component counts, configuration choices, placement, intended motion and mate requirements. Reuse exact verified inputs through working copies or a portable dependency set. Do not edit a previously reviewed dependency in place. Verify transforms and seating against the specification; convenient lock mates are appropriate only when the required result permits a static arrangement.

An assembly can already hold an insertion source in memory without a separate visible part window. Verify the resident source's identity and available configurations, and use an access method documented for that document state before deciding to reopen it.

For part-document measurements, confirm the actual active configuration. For solid or surface part occurrences, verify `IComponent2.ReferencedConfiguration` and inspect `GetBodies3` in that occurrence's context; the shared part document's active configuration does not describe every occurrence. A configuration activation request may return false when that configuration is already active; inspect its identity before deciding the outcome. For every required configuration, check mate suppression, configuration-specific driving values, component resolution and transforms. An error-free mate can still be suppressed, and editing a mate definition can affect more than the currently intended configuration.

Use dimensions, sections or native measurements to check critical clearances and interfaces. Interference detection is an explicit verification operation, not a generic session-health probe; follow the bounded calculation guidance in [verification-recovery.md](verification-recovery.md). Coincident contact and volumetric overlap are different observations, and the chosen detection options belong in the evidence.

Verify an exploded presentation through its actual step members, distances, transforms and a visible preview. A successful creation call, named view or nonempty step list does not establish the intended layout. An autogenerated spacing step can move components even when its reported scalar distance is zero and its overall transform is identity. Inspect its spacing settings and actual component positions in the expanded and collapsed states. Preserve the original candidate, correct only the identified step in a new candidate, and verify the separated view and restored assembled state after saving and reopening. Do not repeat view creation merely because the first view lacks useful separation.
