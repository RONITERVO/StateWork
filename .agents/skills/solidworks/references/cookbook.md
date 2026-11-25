# Cookbook: working code for common tasks

Each recipe is C# for a job body compiled with [`scripts/lib/SwKit.cs`](../scripts/lib/SwKit.cs) and run with `scripts/sw-job.ps1` (see [automation.md](automation.md#c-jobs-with-swkit)). The recipes come from three smoke tests. [`smoke-tray.cs`](../scripts/examples/smoke-tray.cs) builds a shelled part with configurations, edits it and assembles it. [`smoke-features.cs`](../scripts/examples/smoke-features.cs) covers multibody parts, interior walls, two-sided cuts, multi-slot sketches, concentric mates and view capture. [`smoke-topdown.cs`](../scripts/examples/smoke-topdown.cs) builds a part in the context of an assembly. All three passed end to end on SOLIDWORKS 2025 (33.5); read them for complete sequences. The drawing recipes come from a full course rebuild (parts, assemblies, drawings with BOMs) on the same version. Every kit member is listed in [swkit-api.md](swkit-api.md).

SwKit methods take millimetres and model coordinates, check every native return, and throw `CadException` with the step name. `cad.Doc` is the current document. `cad.App`, `cad.MathUtil` and the raw interop types are available whenever the kit lacks a call; see [api-quick-reference.md](api-quick-reference.md).

The compiler is C# 5. Do not use string interpolation, `?.`, `nameof`, `out var`, tuples or expression-bodied members.

## Job skeleton

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;
using SwKit;

namespace SwKitJob
{
    public static class Job
    {
        public static object Run(Cad cad, IDictionary<string, object> args)
        {
            string outDir = Cad.ArgString(args, "outDir");  // args come from the args JSON; never cast directly
            double wall = Cad.ArgDouble(args, "wall", 2.0);  // integers arrive as Int32, decimals as Double
            Dictionary<string, object> result = new Dictionary<string, object>();
            List<string> failures = new List<string>();      // spec checks that did not pass
            // ... one stage of work ...
            result["failures"] = failures;
            result["passed"] = failures.Count == 0;
            return result;                                   // printed as JSON in the job output
        }
    }
}
```

Keep one stage per job: build a part, edit it, assemble, or export. Return measured values, not constants from the script.

## New part, units and default planes

```csharp
IModelDoc2 part = cad.NewDocument("Part", true);    // default template, MMGS units
IFeature[] planes = cad.DefaultPlanes();             // Front (XY), Top (XZ), Right (YZ), whatever their names are
IFeature front = planes[0], top = planes[1], right = planes[2];
cad.SetEquation("Height", "20mm");                   // global variables first, so features can use them
```

A boss grows along +Z from Front, +Y from Top and +X from Right.

## Fully defined profile on a plane

```csharp
int status;
cad.OpenSketch(front);
ISketchLine[] l = cad.Polygon(new double[] { 0, 0, 0 }, new double[] { 80, 0, 0 },
                              new double[] { 80, 50, 0 }, new double[] { 0, 50, 0 });   // model mm
cad.Relate("sgCOINCIDENT", l[0].GetStartPoint2(), "origin");
cad.Dim(null, cad.ToSketch(40, -8, 0), l[0]);          // 80, text below the edge
cad.Dim(null, cad.ToSketch(-8, 25, 0), l[3]);          // 50
IFeature outline = cad.CloseSketch("OutlineSketch", out status);   // expect 3 = fully defined
cad.Extrude(outline, "Block", 20, false, false, 0);
cad.SetEquation("D1@Block", "\"Height\"");            // extrusion depth follows the variable
```

`Polygon` joins the corners and adds horizontal/vertical relations to axis-aligned edges; you add the dimensions. `Dim` throws when the new dimension comes back driven.

## Holes on a face, located from the origin

```csharp
cad.OpenSketch(cad.PlanarFace(0, 0, -1, 0));          // outward normal -Z, lying at Z = 0
ISketchArc hole = cad.Circle(20, 25, 0, 5);           // centre (model mm), diameter
cad.Dim(null, cad.ToSketch(26, 31, 0), hole);         // diameter dimension
cad.Locate(cad.Center(hole), 0, 20, 6);               // X = 20 from the origin
cad.Locate(cad.Center(hole), 1, 25, 6);               // Y = 25 (a zero value becomes a relation)
IFeature holeSketch = cad.CloseSketch("HoleSketch", out status);
IFeature holeCut = cad.Cut(holeSketch, "FloorHole", 0, null);      // 0 = through all; null = find the side with material
```

A through-all cut continues through every wall in line. Use a blind depth driven by the wall parameter when another wall or a boss sits behind the face.

## Slot

```csharp
cad.OpenSketch(cad.PlanarFace(0, -1, 0, 0));
ISketchPoint[] c = cad.Slot(new double[] { 30, 0, 10 }, new double[] { 50, 0, 10 }, 4);   // centres, width
cad.Locate(c[0], 0, 30, 5);
cad.Locate(c[0], 2, 10, 5);                            // width and length dimensions come with the slot
IFeature slotSketch = cad.CloseSketch("SlotSketch", out status);
cad.Cut(slotSketch, "WallSlot", 2.5, null);
cad.SetEquation("D1@WallSlot", "\"Wall\" + 0.5mm");
```

## Offset plane, shell, fillet, chamfer

```csharp
IFeature rim = cad.OffsetPlane(front, "RimPlane", 20, false);        // flip=true puts it on the other side
cad.SetEquation("D1@RimPlane", "\"Height\"");
cad.Shell(new IFace2[] { cad.PlanarFace(0, 0, 1, 20) }, 2, "Shell"); // open the top face, 2 mm wall inward
cad.SetEquation("D1@Shell", "\"Wall\"");
IEdge e = cad.EdgeBetween(new double[] { 0, 0, 0 }, new double[] { 0, 0, 20 });
cad.Fillet(new IEdge[] { e }, 3, "CornerFillet");
// cad.Chamfer(edges, 1, "EdgeChamfer");               // equal-distance 45 degree chamfer
```

## Linear pattern with an editable spacing

```csharp
string spacing;
cad.LinearPattern(holeCut, right, 4, 15, "FloorHoles", out spacing);   // direction: Right plane normal (= X)
cad.SetEquation(spacing + "@FloorHoles", "15mm");                       // spacing is not always D1
```

## Perforation field (Fill Pattern)

```csharp
IFace2 wall = cad.PlanarFace(0, 1, 0, 50);
cad.OpenSketch(wall);
cad.Polygon(new double[] { 20, 50, 6 }, new double[] { 60, 50, 6 }, new double[] { 60, 50, 16 }, new double[] { 20, 50, 16 });
IFeature boundary = cad.CloseSketch("PerfBoundary", out status);
cad.OpenSketch(cad.PlanarFace(0, 1, 0, 50));
ISketchArc seed = cad.Circle(40, 50, 11, 2);           // seed at the boundary centroid
cad.Dim(null, cad.ToSketch(43, 50, 14), seed);
cad.Locate(cad.Center(seed), 0, 40, 4);
cad.Locate(cad.Center(seed), 2, 11, 4);
IFeature seedCut = cad.Cut(cad.CloseSketch("PerfSeedSketch", out status), "PerfSeed", 2.5, null);
IFeature field = cad.FillPattern(seedCut, boundary, cad.EdgeAlong(0, 50), 3.0, 0.3, "PerfField");  // pitch, margin
```

Count the holes by unique axis positions (see `CountHoles` in the smoke test), not by cylindrical faces.

## Equations and a configuration family

```csharp
cad.SetEquation("Wall", "2mm");                        // add or replace; stored text is read back
double wall = cad.EquationValue("Wall");
cad.RenameActiveConfiguration("W2");
cad.UseConfiguration("W3");                            // creates if missing, activates, verifies
cad.SetEquationThisConfiguration("Wall", "3mm");       // only W3 changes
foreach (string config in new string[] { "W3", "W2" })
{
    cad.UseConfiguration(config);
    cad.Rebuild();
    // measure here: cad.EquationValue("Wall"), cad.VolumeMm3(), cad.FeatureErrors(), cad.Bodies().Count
}
```

Make every dependent placement follow the variable through equations (`IIF(cond, a, b)` and `sqr()` work), then check each configuration with a geometric witness, not just the variable.

## Measure and compare with the specification

```csharp
double volume = cad.VolumeMm3();
double[] box = cad.ExtentsMm(cad.Bodies()[0]);         // exact min/max per axis
List<string> errors = cad.FeatureErrors();
double expected = 80 * 50 * 20 - 76 * 46 * 18;         // derived from the spec, not from the script's own inputs
if (Math.Abs(volume - expected) > 0.5) failures.Add("volume " + volume + " != " + expected);
```

## Save, STEP, STL per body

```csharp
string path = Path.Combine(outDir, "Tray.SLDPRT");
cad.SaveAs(path);                                      // throws on save errors
cad.Export(Path.Combine(outDir, "Tray.step"));         // by extension; the part keeps its path
List<string> stls = cad.ExportBodiesStl(outDir, "Tray");   // one file per body, model coordinates, prefs restored
double stlVolume = Cad.StlVolumeMm3(stls[0]);          // compare with cad.VolumeMm3(), within ~0.2 %
```

Export each configuration after activating and rebuilding it. After the first `SaveAs` of a new document, look up features, faces, edges and bodies again: earlier handles can be disconnected. Read plane names, for example, before saving.

## Assembly with plane mates and an interference check

```csharp
string frontName = front.Name, topName = top.Name, rightName = right.Name;   // read before the part's first save
IModelDoc2 asm = cad.NewDocument("Assembly", true);
IComponent2 lower = cad.AddComponent(asm, partPath, 0, 0, 0);       // opens the file silently first
IComponent2 upper = cad.AddComponent(asm, partPath, 5, 5, 25);      // near its final place
cad.Fix(asm, lower, true);
cad.Fix(asm, upper, false);
cad.MatePlanes(asm, upper, frontName, lower, "RimPlane");
cad.MatePlanes(asm, upper, topName, lower, topName);
cad.MatePlanes(asm, upper, rightName, lower, rightName);
asm.EditRebuild3();
double[] t = (double[])upper.Transform2.ArrayData;    // rotation 0..8, translation 9..11 (metres)
int constrained = upper.GetConstrainedStatus();       // 3 = fully defined
List<string> mateErrors = cad.MateErrors(asm);
int interferences = cad.InterferenceCount(asm);       // one explicit calculation, manager released
cad.Doc = asm;
cad.SaveAs(Path.Combine(outDir, "Stack.SLDASM"));
```

## Closing what the job created

```csharp
cad.Close(asm, false);     // refuses unsaved changes unless discardChanges is true
cad.Close(part, false);
```

Close only documents the job created or opened. Leave a failed job's documents open for inspection.

## Edit an existing model

Most real work changes a saved model rather than building one. The smoke test exercises these calls (section 7b); the HDPLEX PSU pass on a three-configuration case body used all of them.

```csharp
IModelDoc2 doc = cad.Open(path, "Gap10");
cad.Activate(doc);                                     // sketching needs a window
List<string> traps = cad.ConfigurationsSuppressingNewItems();   // e.g. "Gap4: new features"
cad.AllowNewItemsInAllConfigurations();               // or unsuppress afterwards; otherwise new features vanish there silently

cad.RollBackBefore("Shell");                          // new features are inserted at the rollback bar
IFeature[] planes = cad.DefaultPlanes();              // re-fetch handles after rollback or a configuration switch
// ... sketch + cad.Extrude(...) here ...
cad.RollForward();
cad.MoveBefore("BayWall", "CpuPanelBossSketch");      // move the consuming feature; its absorbed sketch moves with it

cad.DeleteEquation("D16@RearOpeningsSketch");         // before deleting the geometry it drives
IFeature sk = cad.Feature("RearOpeningsSketch");      // delete sketch entities: edit, select, delete, exit
sk.Select2(false, 0);
doc.EditSketch();
// select the segments found by model position (ModelToSketchTransform.Inverse()), then:
doc.Extension.DeleteSelection2((int)swDeleteSelectionOptions_e.swDelete_Absorbed);
doc.SketchManager.InsertSketch(true);

IFeature gp = cad.Feature("GussetPattern");           // change a definition value
ILinearPatternFeatureData gd = (ILinearPatternFeatureData)gp.GetDefinition();
gd.AccessSelections(doc, null);
gd.D1TotalInstances = 2;
gp.ModifyDefinition(gd, doc, null);

IEdge e = cad.EdgeAt(127.6, 0, 20, 0);                // edge through a point, along X; survives earlier fillets/chamfers
Dictionary<string, object> report = cad.ConfigurationReport();   // errors, bodies, suppressed features, volume per configuration
List<string> partly = cad.PartlySuppressedFeatures(); // nothing you just added may appear here
```

When an equation-driven dimension's index is unknown (two arcs share a radius variable), point one candidate at the new variable, rebuild, and keep it only if the intended arc changed; otherwise restore it and try the next. A feature that must attach to new geometry has to come after that geometry in the tree. Otherwise it rebuilds as a separate body, and cuts earlier in the tree (seats, pockets) never reach it. After every stage, check the body count in every configuration.

For assemblies: `cad.InterferencePairs(asm)` lists pairs with volumes, so new clashes stand out from known reference overlaps. Switching assembly configurations marks referenced parts dirty without edits. Use `cad.SaveDirtyUnder(ownFolder)` for the job's own files, and close reference-only documents without saving.

## Interior walls, cut direction and multi-slot sketches

```csharp
IFace2 wall = cad.PlanarFaceAt(0, 25, -1);           // face at X = 25 facing -X; PlanarFace(-1, 0, 0, -25) is the same
// PlanarFace's offset is measured along the normal; a wrong sign throws and lists the offsets that exist.
cad.Cut(sketch, "Hole", 8, null);                     // throws "material on both sides" inside or between walls
cad.CutExpecting(sketch, "WallHole", 8, Math.PI * 2 * 2 * 3, 0.5);   // keeps the direction that removes the expected volume
cad.OpenSketch(cad.PlanarFaceAt(1, 0, -1));
foreach (double x in new double[] { 15, 45 })        // several slots in one sketch: each Slot() only touches its own segments
{
    ISketchPoint[] c = cad.Slot(new double[] { x, 0, 10 }, new double[] { x, 0, 20 }, 4);
    cad.Locate(c[0], 0, x, 4);
    cad.Locate(c[0], 2, 10, 4);
}
cad.Extrude(cubeSketch, "Cube", 10, false, false, 0, false);   // merge:false = separate body
```

## Assembly mates beyond planes, view capture and cleanup

```csharp
IComponent2 block = cad.AddComponent(asm, partPath, 0, 0, 0, "Alt");   // inserted in configuration Alt (verified)
IFace2 hole = cad.ComponentFaces(block).First(f => ((ISurface)f.GetSurface()).IsCylinder());   // assembly context
object pinFace = cad.InComponent(pinComp, pinPartFace);   // part entity -> component; the part must show the component's configuration
cad.Mate(asm, swMateType_e.swMateCONCENTRIC, swMateAlign_e.swMateAlignCLOSEST, 0, pinFace, hole);
cad.CaptureView(Path.Combine(outDir, "preview.png"), new double[] { 1, 1, 1 }, new double[] { 0, 0, 1 });   // toward viewer, up
List<string> closed = cad.CloseDocumentsUnder(outDir, false);   // drawings, assemblies, then parts; throws if any stay open
```

## Part built in the assembly (top-down)

```csharp
IModelDoc2 asm = cad.Open(asmPath, "");
cad.Activate(asm);
IComponent2 part = cad.NewPartInContext(asm, cad.DefaultPlanes()[1]);   // its Front Plane lies on the assembly Top plane
cad.OpenSketch(part.FeatureByName("Front Plane"));
cad.ConvertEntities(cad.InComponent(otherComp, otherPartEdge));      // in-context reference to another component
cad.Exact(() => asm.SketchManager.CreateCircleByRadius(0, 0, 0, 5 * Cad.Mm));
IFeature sketch = cad.CloseSketch("Profile", out status);
cad.Extrude(cad.InContextFeature(part, sketch), "Boss", 10, false, false, 0);   // explicit direction in context
cad.EndEditInContext(asm);
asm.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, 0, 0);
cad.SaveVirtualPart(part, Path.Combine(outDir, "Peg.SLDPRT"));
```

Check the new part's volume and the interference afterwards; the traps (point selection, relations, layout blocks, cavities, mirrored parts) are in [assemblies.md](assemblies.md#top-down-parts-through-the-api).

## Part drawing with placed dimensions and a section

```csharp
IModelDoc2 part = cad.Open(partPath, "");
cad.SetProperty(part, "Description", "Drinking glass", "");          // title block fields are model properties
part.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, 0, 0);
cad.NewDrawing(templatePath, sheetFormatPath);                       // relinks a sheet format the template lost
IView front = cad.ModelView(partPath, "*Front", 95, 165);
cad.CurrentSheet.SetScale(1, 1, false, false);                       // the first view auto-scaled the sheet
front.UseSheetScale = 1;
cad.Doc.EditRebuild3();
double[] box = cad.OutlineMm(front);                                 // [x1, y1, x2, y2] sheet mm
double cx = (box[0] + box[2]) / 2, y0 = box[1];
cad.InsertModelDimensionsInto(front);
foreach (KeyValuePair<string, IDisplayDimension> kv in cad.ViewDisplayDimensions(front))
{
    if (kv.Key.StartsWith("D1@Profile@")) cad.DeleteDimension(kv.Value);   // construction length, not a product size
    else if (kv.Key.StartsWith("D3@Profile@")) cad.MoveDimension(kv.Value, cx + 22, y0 - 12);
}
IView section = cad.SectionView(front, new double[] { cx, y0 + 104 }, new double[] { cx, y0 - 4 }, "A", cx + 125, 165, false);
IView iso = cad.ModelView(partPath, "*Isometric", 350, 180);
iso.SetDisplayMode4(false, (int)swDisplayMode_e.swSHADED_EDGES, false, true, false);
cad.AddNote("Wall 2 mm, rim R0.9.", 25, 50);
cad.SaveDrawing(drawingPath, Path.ChangeExtension(drawingPath, ".pdf"));
Dictionary<string, object> report = cad.DrawingReport();             // layout lists must be empty
```

For a quick standard layout use `cad.StandardViews(partPath, "*Front", true, true, true, 18)`, then `InsertModelDimensions()` and `TidyDimensions(...)`.

## Assembly drawing with a BOM and balloons

```csharp
cad.SetProperty(partDoc, "Description", "Table top 800 x 500 x 30", "");   // BOM text comes from each part
cad.SetProperty(partDoc, "Material", "\"SW-Material@" + partFileName + "\"", "");
cad.LinkMassKg(asm);
cad.NewDrawing(templatePath, sheetFormatPath);
IView front = cad.ModelView(asmPath, "*Front", 110, 215);
IView top = cad.ProjectedView(front, 110, 130);
IView iso = cad.ModelView(asmPath, "*Isometric", 350, 238);
cad.CurrentSheet.SetScale(1, 5, false, false);
IBomTableAnnotation bom = cad.BomTable(front, 222, 110, "", swBomType_e.swBomType_PartsOnly);
cad.AddBomPropertyColumn(bom, "MATERIAL", "Material");
cad.SetTableColumnWidths((ITableAnnotation)bom, new double[] { 10, 50, 56, 8, 40 });
List<string> balloons = cad.AutoBalloons(iso);                       // one per BOM item visible in the view
cad.Balloon(top, "Glass", 300, 120);                                 // an item AutoBalloons could not reach
cad.SaveDrawing(drawingPath, Path.ChangeExtension(drawingPath, ".pdf"));
Dictionary<string, object> report = cad.DrawingReport();
```

Move balloons that land outside the frame or on another view, and check the BOM rows against the components of the configuration shown. `swBomType_TopLevelOnly` lists subassemblies as single rows.

## Restart a long session

```csharp
// Job 1: save and close the job's own files, then exit (refuses while anything is still open).
cad.SaveDirtyUnder(workFolder);
cad.CloseDocumentsUnder(workFolder, false);
if (cad.App.GetDocumentCount() != 0) throw new CadException("Documents still open");
cad.App.ExitApp();
```

Then relaunch SOLIDWORKS with its normal launcher, wait for the main window, and continue with the next job; it attaches to the new process. Do this when `Memory.Advice` in a job result asks for it.

## Raw API inside a job

When the kit has no helper, call the interop directly and route the result through `Checked`. The pattern is shown here; fill in the arguments from the installed API help:

```csharp
IModelDoc2 doc = cad.Doc;
cad.Pick(profileSketch, axisLine);                     // select inputs, in the order the call expects
object made = doc.FeatureManager.FeatureRevolve2(/* arguments from the API help */);
IFeature f = cad.Checked(made, "Revolve");             // same null/error/name handling as the kit
```

Before using an unfamiliar call, look up its exact signature and enums in the installed API help (`ApiHelpPaths` in the session probe). Then compile-check the body.
