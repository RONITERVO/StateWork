# Fictional CAD verification fixture

This is original synthetic work for evaluating a native SOLIDWORKS workflow. Use a new private output directory. Nothing is to be submitted or uploaded. Do not use a supplied finished model or another worker's generating script.

## Part

Create `verification-block.SLDPRT`, an editable rectangular solid **20 × 10 × 10 mm**. Sketch the 20 × 10 rectangle on the Front plane, with its lower-left corner coincident with the origin and its edges horizontal/vertical. Use meaningful driving dimensions and relations so the sketch is fully defined. Extrude it normally by 10 mm. No fillets, holes, draft, imported body or fixed-all sketch relations are required. Use millimetre document units and record the actual template used. No material or manufacturing tolerance is specified.

Save, close and reopen the part. Measure its three edge extents and volume. In a separate disposable editability copy, change the 20 mm driving dimension to 25 mm and verify that the part rebuilds to 25 × 10 × 10 mm. Preserve the 20 mm original candidate unchanged.

## Assembly

Create `verification-pair.SLDASM` with exactly two instances of the original block. Align their orientations and corresponding Y and Z origins. Fix the first component at the assembly origin. Constrain the second component with meaningful native assembly relationships and a configuration-specific X translation:

| Configuration | Second component X translation | Intended result       |
| ------------- | -----------------------------: | --------------------- |
| Separated     |                          25 mm | 5 mm face-to-face gap |
| Overlap       |                          18 mm | 2 mm overlap along X  |

This intentional overlap is a detector test, not a usable engineering design. Keep both instances unsuppressed and resolved in both configurations. Verify actual component transforms and the gap/overlap. Run one explicit interference-object calculation per configuration with the options recorded, including whether coincident faces count as interference. Do not use a second calculating API as a progress poll. Preserve unexpected or null results and diagnose them using the installed contract instead of turning them into a zero count. Invoke documented cleanup after a returned operation when the manager is usable. No repeated calculation on unchanged geometry is requested.

## Drawing and package

Create `verification-block.SLDDRW` with native associated orthographic views, a readable isometric view and geometry-associated 20, 10 and 10 mm dimensions. Include the part name, units and actual scale. Keep unspecified material, tolerance and approval fields blank or clearly unspecified. Export a readable PDF with the same views and dimensions.

Create a portable ZIP containing the original part, assembly with both configurations, native drawing and drawing PDF. Keep the disposable editability test outside this ZIP. Extract the package into a separate private directory and open its files in SOLIDWORKS with no identically named candidate documents already open. Check that all CAD references resolve within the extraction; report load/save warning bitmasks separately from feature/rebuild checks. Do not recalculate interference just because the unchanged files were copied.

## Evidence and independent acceptance

Preserve exact attempts and call start/return/error records, source and output hashes, application identity, native sketch/feature status, measured geometry, configuration/mate state, interference results and cleanup, saved-file checks, portable references and a short preview. Record real failures and fixes. A timeout or cancelled call is an unknown/failed verification, not a passing result.

The reviewer derives expected values from this brief before reading candidate-generation code. Independent arithmetic provides:

| Check                        | Expected value |
| ---------------------------- | -------------: |
| Original part volume         |      2,000 mm³ |
| Disposable 25 mm part volume |      2,500 mm³ |
| Separated interference pairs |              0 |
| Overlap interference pairs   |              1 |
| Overlap volume               |        200 mm³ |

Compare native measurements at a declared numerical precision; the brief does not prescribe a manufacturing tolerance. Confirm editable driving dimensions and associated drawing dimensions in the actual files. Freeze the candidate before independent review; review any changed version separately. Report each result as observed pass, fail or unresolved, without claiming that this small fixture proves arbitrary CAD competence.
