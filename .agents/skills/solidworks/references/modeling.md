# Preserve geometry and design intent

## Sketches and dimensions

Establish the sketch plane, origin/datums, construction entities, open/closed contours and required dimensions from the original. Differentiate diameter, radius, doubled linear dimensions, perpendicular offsets and projected distances. Read angle orientation and the endpoints actually dimensioned. Parentheses or reference styling may indicate a driven measurement rather than a rounded driving value; confirm the source meaning.

Compare the actual dimension witnesses, not just the printed number. A slot dimension between arc centers differs from its overall length by one slot width. When dated briefs intentionally describe different variants, preserve separately named models or configurations and state which source each satisfies. Do not combine conflicting dimensions into a result claimed to satisfy both. If the required choice remains unresolved, expose that decision in review.

Use native dimensions and meaningful coincidence, tangent, parallel, perpendicular, concentric, symmetric and equal relations. Check the supported relation names in the installed API and verify the relation actually exists afterward. A method returning without throwing does not prove an entity was selected or a relation added. Inspect constraint status and remaining degrees of freedom; do not make everything fixed merely to obtain a fully defined label.

Check native contour connectivity and closure after trims, splits, merges or sketch patterns. Matching endpoint coordinates and a fully defined status do not establish that the intended profile is connected. Reacquire sketch entities after topology changes, then verify the intended shared vertices, relations and open endpoints before using the profile in a feature.

Verify native tolerance and fit properties, including hole/shaft fits, rather than adding their names as unrelated notes. Keep driven/reference measurements derived from geometry where required. Do not overconstrain a system by forcing a rounded reference value; compare its calculated value and displayed precision separately.

## Features and edits

Create the required native features and preserve source-required construction order. When modifying a supplied model, inspect existing features, references and configurations before choosing what to edit. If an exercise requires editing the original extrusion or changing a sketch plane, adding a visually equivalent replacement feature can violate the method requirement.

Validate selections, start/end conditions, direction and actual material removed after each consequential feature. A through-all cut may pierce an opposite wall that the source section leaves intact. Blind depth, D-shaped openings, tangent blends and chamfers must be checked in useful sections or measured geometry. Feature or face names can change after edits; reacquire references rather than relying on stale object handles or assumed face indices.

Check body count and native body validity as well as the feature tree's errors/suppressions. Fillet/chamfer success may depend on feature order; use a justified sequence, preserve failed attempts and inspect the resulting surfaces. A saved file with no feature error can still contain the wrong geometry.

## Assemblies

Determine component counts, configuration choices, placement, intended motion and mate requirements. Reuse exact verified inputs through working copies or a portable dependency set. Do not edit a previously reviewed dependency in place. Verify transforms and seating against the specification; convenient lock mates are appropriate only when the required result permits a static arrangement.

Use dimensions, sections or native measurements to check critical clearances and interfaces. Interference detection is an explicit verification operation, not a generic session-health probe; follow the bounded calculation guidance in [verification-recovery.md](verification-recovery.md). Coincident contact and volumetric overlap are different observations, and the chosen detection options belong in the evidence.
