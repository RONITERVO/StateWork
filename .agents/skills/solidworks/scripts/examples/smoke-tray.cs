// Smoke test and worked example for SwKit (run with scripts/jobs/run-csharp-job.ps1).
// Also exercises the editing helpers: rollback/insert, reorder, equation delete, EdgeAt, configuration checks, interference pairs.
//
// Builds an open-top tray 80 x 50 x 20 mm with:
//   global variables Wall and Height, a native Shell, a floor hole + linear pattern,
//   corner fillets, an equation-driven slot cut, a perforated wall (Fill Pattern),
//   two configurations (W2 / W3) that differ only in the Wall variable,
// then a two-component assembly with plane mates and an interference count.
// Every geometric result is compared with a value computed from the specification.
//
// args: outDir (absolute folder for the saved files; created if missing)
// Saves SwKitSmoke_Tray.SLDPRT/.step/.stl and SwKitSmoke_Stack.SLDASM, then closes both documents.
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
        const double L = 80, W = 50, H = 20, HoleD = 5, FilletR = 3, SlotLen = 20, SlotW = 4, PerfD = 2;

        public static object Run(Cad cad, IDictionary<string, object> args)
        {
            string outDir = Cad.ArgString(args, "outDir");
            Directory.CreateDirectory(outDir);
            Dictionary<string, object> result = new Dictionary<string, object>();
            List<string> failures = new List<string>();
            int status;

            IModelDoc2 part = cad.NewDocument("Part", true);
            IFeature[] planes = cad.DefaultPlanes();
            IFeature front = planes[0], top = planes[1], right = planes[2];
            // Read names now: feature handles taken before a new document's first SaveAs can disconnect afterwards.
            string frontName = front.Name, topName = top.Name, rightName = right.Name;
            cad.SetEquation("Wall", "2mm");
            cad.SetEquation("Height", "20mm");

            // 1. Outline on the Front plane (model XY), corner on the origin, extruded +Z by Height.
            cad.OpenSketch(front);
            ISketchLine[] outline = cad.Polygon(new double[] { 0, 0, 0 }, new double[] { L, 0, 0 }, new double[] { L, W, 0 }, new double[] { 0, W, 0 });
            cad.Relate("sgCOINCIDENT", outline[0].GetStartPoint2(), "origin");
            cad.Dim(null, cad.ToSketch(L / 2, -8, 0), outline[0]);
            cad.Dim(null, cad.ToSketch(-8, W / 2, 0), outline[3]);
            IFeature outlineSketch = cad.CloseSketch("OutlineSketch", out status);
            result["outlineSketchStatus"] = status;
            cad.Extrude(outlineSketch, "Block", H, false, false, 0);
            cad.SetEquation("D1@Block", "\"Height\"");
            IFeature rim = cad.OffsetPlane(front, "RimPlane", H, false);
            cad.SetEquation("D1@RimPlane", "\"Height\"");

            // 2. Shell open at the top face, wall = Wall.
            cad.Shell(new IFace2[] { cad.PlanarFace(0, 0, 1, H) }, 2, "Shell");
            cad.SetEquation("D1@Shell", "\"Wall\"");

            // 3. Floor hole sketched on the outside floor face (normal -Z), cut into the body, patterned along X.
            cad.OpenSketch(cad.PlanarFace(0, 0, -1, 0));
            ISketchArc hole = cad.Circle(20, 25, 0, HoleD);
            cad.Dim(null, cad.ToSketch(26, 31, 0), hole);
            cad.Locate(cad.Center(hole), 0, 20, 6);
            cad.Locate(cad.Center(hole), 1, 25, 6);
            IFeature holeSketch = cad.CloseSketch("FloorHoleSketch", out status);
            result["holeSketchStatus"] = status;
            IFeature holeCut = cad.Cut(holeSketch, "FloorHole", 0, null);
            string spacingDim;
            cad.LinearPattern(holeCut, right, 4, 15, "FloorHoles", out spacingDim);
            result["patternSpacingDimension"] = spacingDim;
            if (spacingDim == null) failures.Add("pattern spacing dimension not found");
            else cad.SetEquation(spacingDim + "@FloorHoles", "15mm");

            // 4. Fillets on the four vertical outside edges.
            double[][] corners = { new double[] { 0, 0 }, new double[] { L, 0 }, new double[] { L, W }, new double[] { 0, W } };
            IEdge[] verticals = corners.Select(c => cad.EdgeBetween(new double[] { c[0], c[1], 0 }, new double[] { c[0], c[1], H })).ToArray();
            cad.Fillet(verticals, FilletR, "CornerFillets");

            // 5. Slot through the Y=0 wall, blind depth driven by Wall (a through-all cut would also pierce the Y=50 wall).
            cad.OpenSketch(cad.PlanarFace(0, -1, 0, 0));
            ISketchPoint[] slotCentres = cad.Slot(new double[] { 30, 0, 10 }, new double[] { 30 + SlotLen, 0, 10 }, SlotW);
            cad.Locate(slotCentres[0], 0, 30, 5);
            cad.Locate(slotCentres[0], 2, 10, 5);
            IFeature slotSketch = cad.CloseSketch("SlotSketch", out status);
            result["slotSketchStatus"] = status;
            cad.Cut(slotSketch, "WallSlot", 2.5, null);
            cad.SetEquation("D1@WallSlot", "\"Wall\" + 0.5mm");

            // 6. Perforated field in the Y=W wall: seed hole at the boundary centroid, native Fill Pattern.
            cad.OpenSketch(cad.PlanarFace(0, 1, 0, W));
            ISketchLine[] frame = cad.Polygon(new double[] { 20, W, 6 }, new double[] { 60, W, 6 }, new double[] { 60, W, 16 }, new double[] { 20, W, 16 });
            cad.Dim(null, cad.ToSketch(40, W, 3), frame[0]);                     // 40 long
            cad.Dim(null, cad.ToSketch(64, W, 11), frame[1]);                    // 10 high
            cad.Locate(frame[0].GetStartPoint2() as ISketchPoint, 0, 20, 3);     // corner at X 20
            cad.Locate(frame[0].GetStartPoint2() as ISketchPoint, 2, 6, 3);      // and Z 6
            IFeature boundary = cad.CloseSketch("PerfBoundary", out status);
            result["boundarySketchStatus"] = status;
            cad.OpenSketch(cad.PlanarFace(0, 1, 0, W));
            ISketchArc seed = cad.Circle(40, W, 11, PerfD);
            cad.Dim(null, cad.ToSketch(43, W, 14), seed);
            cad.Locate(cad.Center(seed), 0, 40, 4);
            cad.Locate(cad.Center(seed), 2, 11, 4);
            IFeature seedSketch = cad.CloseSketch("PerfSeedSketch", out status);
            IFeature seedCut = cad.Cut(seedSketch, "PerfSeed", 2.5, null);
            cad.SetEquation("D1@PerfSeed", "\"Wall\" + 0.5mm");
            IFeature fill = cad.FillPattern(seedCut, boundary, cad.EdgeAlong(0, 50), 3.0, 0.3, "PerfField");
            string pitchDim = cad.FindDimension(fill, 3.0);
            result["fillPitchDimension"] = pitchDim;

            // 7. Configurations: W2 keeps Wall = 2 mm, W3 sets Wall = 3 mm only in that configuration.
            cad.RenameActiveConfiguration("W2");
            cad.UseConfiguration("W3");
            cad.SetEquationThisConfiguration("Wall", "3mm");
            Dictionary<string, object> configs = new Dictionary<string, object>();
            foreach (string config in new string[] { "W3", "W2" })
            {
                cad.UseConfiguration(config);
                cad.Rebuild();
                double wall = cad.EquationValue("Wall");
                int perfHoles = CountHoles(cad, PerfD / 2, 1);
                double expected = ExpectedVolume(wall, perfHoles);
                double actual = cad.VolumeMm3();
                List<string> errors = cad.FeatureErrors();
                configs[config] = new Dictionary<string, object> {
                    { "wall", wall }, { "perfHoles", perfHoles }, { "floorHoles", CountHoles(cad, HoleD / 2, 2) },
                    { "volumeMm3", Math.Round(actual, 3) }, { "expectedMm3", Math.Round(expected, 3) },
                    { "bodies", cad.Bodies().Count }, { "extentsMm", cad.ExtentsMm(cad.Bodies()[0]).Select(v => Math.Round(v, 3)).ToArray() },
                    { "featureErrors", errors } };
                if (Math.Abs(actual - expected) > 0.5) failures.Add(config + " volume " + actual + " != expected " + expected);
                if (errors.Count > 0) failures.Add(config + " feature errors: " + string.Join(", ", errors));
                if (perfHoles < 10) failures.Add(config + " fill pattern made only " + perfHoles + " holes");
            }
            result["configurations"] = configs;

            // 7b. Editing an existing model: configuration guard, insert during rollback, reorder, equation delete,
            //     an edge whose end points moved (fillets), and a per-configuration report.
            cad.UseConfiguration("W2");
            result["suppressingNewItems"] = cad.ConfigurationsSuppressingNewItems();
            cad.AllowNewItemsInAllConfigurations();
            cad.RollBackBefore("Shell");
            // Handles taken earlier (front, top, right) can be disconnected after configuration switches and rollback.
            cad.OffsetPlane(cad.DefaultPlanes()[0], "MidPlane", H / 2, false);
            cad.RollForward();
            cad.MoveBefore("MidPlane", "Block");
            List<string> order = cad.Features(null).Select(f => f.Name).ToList();
            if (order.IndexOf("MidPlane") > order.IndexOf("Block")) failures.Add("MidPlane was not moved before Block");
            List<string> partly = cad.PartlySuppressedFeatures();
            result["partlySuppressed"] = partly;
            if (partly.Count > 0) failures.Add("features suppressed in some configurations: " + string.Join("; ", partly.ToArray()));
            cad.SetEquation("SmokeTemp", "1mm");
            cad.DeleteEquation("SmokeTemp");
            if (cad.EquationIndex("SmokeTemp") >= 0) failures.Add("DeleteEquation left the equation");
            IEdge rimEdge = cad.EdgeAt(L / 2, 0, H, 0);                 // outer top edge, shortened by the corner fillets
            double[] ra = (double[])((IVertex)rimEdge.GetStartVertex()).GetPoint(), rb = (double[])((IVertex)rimEdge.GetEndVertex()).GetPoint();
            double rimLength = Math.Abs(ra[0] - rb[0]) / Cad.Mm;
            result["rimEdgeLengthMm"] = Math.Round(rimLength, 4);
            if (Math.Abs(rimLength - (L - 2 * FilletR)) > 1e-4) failures.Add("EdgeAt found an edge of length " + rimLength);
            Dictionary<string, object> report = cad.ConfigurationReport();
            result["configurationReport"] = report;
            foreach (string config in new string[] { "W2", "W3" })
            {
                Dictionary<string, object> row = (Dictionary<string, object>)report[config];
                double expectedVolume = (double)((Dictionary<string, object>)configs[config])["expectedMm3"];
                if (((List<string>)row["errors"]).Count > 0 || (int)row["bodies"] != 1 || (int)row["suppressedFeatures"] != 0
                    || Math.Abs((double)row["volumeMm3"] - expectedVolume) > 0.5)
                    failures.Add(config + " configuration report differs: " + row["volumeMm3"] + " / " + expectedVolume);
            }
            if (cad.Doc.ConfigurationManager.ActiveConfiguration.Name != "W2") failures.Add("ConfigurationReport did not restore W2");

            // 8. Save, export STEP and STL (active configuration W2), compare the STL volume.
            string partPath = Path.Combine(outDir, "SwKitSmoke_Tray.SLDPRT");
            cad.SaveAs(partPath);
            cad.Export(Path.Combine(outDir, "SwKitSmoke_Tray.step"));
            List<string> stls = cad.ExportBodiesStl(outDir, "SwKitSmoke_Tray");
            double stlVolume = Cad.StlVolumeMm3(stls[0]), cadVolume = cad.VolumeMm3();
            result["stlVolumeMm3"] = Math.Round(stlVolume, 3);
            if (Math.Abs(stlVolume - cadVolume) / cadVolume > 0.002) failures.Add("STL volume differs from CAD by more than 0.2 %");

            // 9. Assembly: second tray stacked on the first by three plane mates; no volumetric interference expected.
            IModelDoc2 assembly = cad.NewDocument("Assembly", true);
            IComponent2 lower = cad.AddComponent(assembly, partPath, 0, 0, 0);
            IComponent2 upper = cad.AddComponent(assembly, partPath, 5, 5, H + 5);
            cad.Fix(assembly, lower, true);
            cad.Fix(assembly, upper, false);
            cad.MatePlanes(assembly, upper, frontName, lower, "RimPlane");
            cad.MatePlanes(assembly, upper, topName, lower, topName);
            cad.MatePlanes(assembly, upper, rightName, lower, rightName);
            assembly.EditRebuild3();
            double[] t = (double[])upper.Transform2.ArrayData;
            result["upperTranslationMm"] = new double[] { Math.Round(t[9] / Cad.Mm, 4), Math.Round(t[10] / Cad.Mm, 4), Math.Round(t[11] / Cad.Mm, 4) };
            result["upperConstrainedStatus"] = upper.GetConstrainedStatus();
            result["mateErrors"] = cad.MateErrors(assembly);
            int interferences = cad.InterferenceCount(assembly);
            result["interferences"] = interferences;
            List<string> pairs = cad.InterferencePairs(assembly);
            result["interferencePairs"] = pairs;
            if (pairs.Count != interferences) failures.Add("InterferencePairs (" + pairs.Count + ") disagrees with InterferenceCount (" + interferences + ")");
            if (Math.Abs(t[11] / Cad.Mm - H) > 1e-6 || Math.Abs(t[9]) > 1e-9 || Math.Abs(t[10]) > 1e-9) failures.Add("upper tray not stacked at Z = H");
            if (interferences != 0) failures.Add("unexpected interference");
            if (cad.MateErrors(assembly).Count > 0) failures.Add("mate errors");
            string assemblyPath = Path.Combine(outDir, "SwKitSmoke_Stack.SLDASM");
            cad.Doc = assembly;
            cad.SaveAs(assemblyPath);

            cad.Close(assembly, false);
            cad.Doc = part;
            cad.Close(part, false);
            result["files"] = new string[] { partPath, assemblyPath, Path.Combine(outDir, "SwKitSmoke_Tray.step"), stls[0] };
            result["failures"] = failures;
            result["passed"] = failures.Count == 0;
            return result;
        }

        /// Solid volume from the specification: block - cavity - corner fillets - floor holes - slot - perforations.
        static double ExpectedVolume(double wall, int perfHoles)
        {
            double block = L * W * H;
            double cavity = (L - 2 * wall) * (W - 2 * wall) * (H - wall);
            double fillets = 4 * (FilletR * FilletR - Math.PI * FilletR * FilletR / 4) * H;
            double floorHoles = 4 * Math.PI * HoleD * HoleD / 4 * wall;
            double slot = (SlotLen * SlotW + Math.PI * SlotW * SlotW / 4) * wall;
            double perforations = perfHoles * Math.PI * PerfD * PerfD / 4 * wall;
            return block - cavity - fillets - floorHoles - slot - perforations;
        }

        /// Unique hole axes of the given radius running along model axis (0=X, 1=Y, 2=Z). Cylindrical faces can be split,
        /// so faces are grouped by axis position instead of counted.
        static int CountHoles(Cad cad, double radiusMm, int axis)
        {
            HashSet<string> axes = new HashSet<string>();
            foreach (IBody2 body in cad.Bodies())
            {
                foreach (object o in (object[])body.GetFaces())
                {
                    ISurface s = (ISurface)((IFace2)o).GetSurface();
                    if (!s.IsCylinder()) continue;
                    double[] p = (double[])s.CylinderParams;
                    if (Math.Abs(p[6] / Cad.Mm - radiusMm) > 1e-6 || Math.Abs(Math.Abs(p[3 + axis]) - 1) > 1e-6) continue;
                    double[] position = new double[3];
                    for (int i = 0; i < 3; i++) position[i] = i == axis ? 0 : Math.Round(p[i] / Cad.Mm, 3);
                    axes.Add(position[0] + "," + position[1] + "," + position[2]);
                }
            }
            return axes.Count;
        }
    }
}
