# Cookbook: working code for common tasks

Each recipe is C# for a job body compiled with [`scripts/lib/SwKit.cs`](../scripts/lib/SwKit.cs) and run by `scripts/jobs/run-csharp-job.ps1` (see [automation.md](automation.md#c-jobs-with-swkit)). All of them come from the smoke test [`scripts/examples/smoke-tray.cs`](../scripts/examples/smoke-tray.cs). That test builds and checks a part with configurations and an assembly. It passed end to end on SOLIDWORKS 2025 (33.5); read it for the complete sequence.

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
            string outDir = (string)args["outDir"];          // args come from input.json "args"
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

## Raw API inside a job

When the kit has no helper, call the interop directly and route the result through `Checked`. The pattern is shown here; fill in the arguments from the installed API help:

```csharp
IModelDoc2 doc = cad.Doc;
cad.Pick(profileSketch, axisLine);                     // select inputs, in the order the call expects
object made = doc.FeatureManager.FeatureRevolve2(/* arguments from the API help */);
IFeature f = cad.Checked(made, "Revolve");             // same null/error/name handling as the kit
```

Before using an unfamiliar call, look up its exact signature and enums in the installed API help (`ApiHelpPaths` in the session probe). Then compile-check the body.
