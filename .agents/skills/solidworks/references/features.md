# Features, bodies and materials

Read when creating or editing features (extrude, cut, shell, fillet, chamfer, patterns, lofts, multibody operations) or assigning materials. Working code: [cookbook.md](cookbook.md). Call details: [api-quick-reference.md](api-quick-reference.md).

## Checklist

- Check every creation result for null and `GetErrorCode2`, then name the feature (`Cad.Checked`). A returned feature is not proof of the intended geometry.
- After each consequential feature, verify direction, end condition and the material actually added or removed (volume change, extents, sections).
- Find faces and edges again by geometry after every feature; handles, names and indices go stale.
- Check body count and body validity (`IBody2.Check3`) as well as feature errors.
- Prefer one coherent native feature (Shell, Fill Pattern, pattern) over many hand-built pieces when it expresses the design intent.

## Creating and editing features

Create the required native features and preserve source-required construction order. When modifying a supplied model, inspect existing features, references and configurations before choosing what to edit. If an exercise requires editing the original extrusion or changing a sketch plane, adding a visually equivalent replacement feature can violate the method requirement.

Validate selections, start/end conditions, direction and actual material removed after each consequential feature. A through-all cut may pierce an opposite wall that the source section leaves intact. Blind depth, D-shaped openings, tangent blends and chamfers must be checked in useful sections or measured geometry. Feature or face names can change after edits; reacquire references rather than relying on stale object handles or assumed face indices.

`FeatureCut4` toward a side with no material returns null and changes nothing. Retrying the opposite direction is acceptable only with a check of the material actually removed, such as volume or a probe point, because a cut in the unintended direction also succeeds wherever material exists. An offset `InsertRefPlane` with the flip option (256) places the plane on the opposite side of its reference. Read the plane's actual position back before sketching on it or driving its offset from an equation.

Locate a face using its actual trimmed boundaries and component transform. The origin of an underlying cylindrical surface can lie outside the bounded face; it does not establish a hole's height, flange location or assembly orientation.

## Bodies, validity and identity

Check body count and native body validity as well as the feature tree's errors/suppressions. Fillet/chamfer success may depend on feature order; use a justified sequence, preserve failed attempts and inspect the resulting surfaces. A saved file with no feature error can still contain the wrong geometry.

`IFeature.GetTypeName2` can return `ICE` for both later boss-extrudes and cut-extrudes. Classify a feature by its definition interface or its observed material change, not by the type name alone. Solid-body names are not stable either: a later upstream edit can rename a body after its final feature even after you named it. Reidentify bodies by geometry, such as bounds, before per-body exports or checks.

COM handles to features, faces, edges and bodies can disconnect (`RPC_E_DISCONNECTED`, 0x80010108) after the first `SaveAs` of a new document and after exports. The document handle itself stayed valid. Read names and other values you need before saving, and look entities up again afterwards. Do not reuse plane or body handles across a save.

## Shells, perforation fields and patterns

For constant-wall enclosures, one native `Shell` is more robust and editable than separate cavity and plate features. Use `IModelDoc2.InsertFeatureShell` with the open faces preselected. It returns nothing, so take the last feature, check its type and error code, and drive its thickness dimension from the wall parameter. Shell walls end in the plane of each removed face. On a wall inclined at angle θ to that plane, the opening's inner edge is offset by `T / sin θ` (`T·√2` at 45°). Size mating panels and their clearances from the measured inner edge, not from the outer profile line.

For perforation fields, the native Fill Pattern works through `CreateDefinition(swFmFillPattern)` → `IFillPatternFeatureData` → `CreateFeature`. Select the seed feature (mark 4), a straight model edge as the direction (mark 1) and the boundary sketch (mark 16384) together. Then set the complete definition, not only the layout type. A seed placed at the boundary's centroid sat exactly on a grid position; verify against neighboring instances if you place it elsewhere. Driving the pitch dimension of the fill feature from a parameter keeps the field editable. The same boundary, seed position, direction edge and pitch in two parts produced coincident hole grids. Verify that kind of alignment by comparing unique hole-axis positions in both parts; counting cylindrical faces can overstate the holes. Use a blind seed depth when bosses or ribs sit behind the perforated wall.

## Lofts and surfaces

For lofts, inspect profile order and connector correspondence. `ILoftFeatureData.PickPoints` contains connector chains, each containing native `MathPoint` objects; read their `ArrayData` instead of treating the outer array as one numeric point per profile. Preserve already-correct connectors. At a tangent join, check the direction and body validity: an apparently smooth, error-free feature can double back into its neighbor. Diagnose returned fault codes and affected faces before changing the tangent direction; do not assume a universal reverse setting. For complex surfacing, prefer robust native paths (`Surface-Sweep` with pierced profile endpoints and guide curves, `Surface-Fill` with `G1` tangent boundaries, `Surface-Knit` with `Create Solid`) over crash-prone legacy raw loft/net-blend API calls; when a single 3D sketch holds multiple closed and open loops for a loft, select them through `SelectionManager` contour groups or native UI selection.

## Multibody workflows

In multibody modeling and split-to-assembly workflows (`Save Bodies`), keep an explicit copy of any tool body (`Body-Move/Copy`) before `Combine (Subtract)` consumes it, and order `Shell` deliberately relative to embossed or recessed surface features so interior walls stay clean.

## Materials and mass

For material assignment, distinguish the database path supplied to `SetMaterialPropertyName2` from the database name returned by `GetMaterialPropertyName2`; the latter may omit `.sldmat`. Resolve the name to a unique intended installed database and retain its path/hash. Verify the actual material, density, mass and override state separately from visual appearance. When assigning body-level materials (`IBody2.SetMaterialProperty`), do not suppress exceptions or assume a visual color override (`MaterialPropertyValues2`) persisted a material; read `GetMaterialPropertyName` back on each body after saving and reopening. A returned naming difference alone does not justify reconstructing correct geometry.

When a small cut fails a volume comparison, establish the calculation accuracy before changing correct geometry or widening the tolerance. Compare both source and result using `IMassProperty2` at the appropriate accuracy with explicit units and recalculation results. Coarse body mass properties can obscure small removed volumes. Preserve the failed comparison and distinguish calculation error from a geometric discrepancy.
