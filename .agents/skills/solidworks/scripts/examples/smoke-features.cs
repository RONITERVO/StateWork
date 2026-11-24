// Second smoke test for SwKit: the traps a multibody, multi-slot or assembly job hits after the simple tray.
//
// Part: 60 x 40 x 30 block with two pockets (leaving an interior wall X 25..35), a hole drilled from a plane INSIDE
// that wall (material on both sides: Cut(null) must refuse, CutExpecting must pick the 3 mm side), two slots in one
// sketch through the front wall, and a separate 10 mm cube (Extrude merge:false). Two configurations.
// Assembly: the part inserted in configuration "Alt", plus a D4 pin mated concentric into the hole; a view capture.
// Also checks numeric job arguments, equation read-back normalisation and case-insensitive lookup, PlanarFaceAt and
// the error text of a wrong-sign PlanarFace, Open() switching the configuration of an already open document, and
// STL files named by body.
//
// args: outDir (string), wallMm (decimal, e.g. 2.5), count (integer, e.g. 2), flag (boolean)
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
            Dictionary<string, object> result = new Dictionary<string, object>();
            List<string> failures = new List<string>();
            int status;

            // 0. Job arguments: numbers arrive as Int32 / Double, read through the converters.
            string outDir = Cad.ArgString(args, "outDir");
            Directory.CreateDirectory(outDir);
            double wallArg = Cad.ArgDouble(args, "wallMm");
            int countArg = Cad.ArgInt(args, "count");
            bool flagArg = Cad.ArgBool(args, "flag");
            result["argTypes"] = args["wallMm"].GetType().Name + "/" + args["count"].GetType().Name + "/" + args["flag"].GetType().Name;
            if (Math.Abs(wallArg - 2.5) > 1e-12 || countArg != 2 || !flagArg) failures.Add("job arguments read wrongly");
            if (Math.Abs(Cad.ArgDouble(args, "count") - 2) > 1e-12) failures.Add("ArgDouble of an integer argument failed");
            if (Math.Abs(Cad.ArgDouble(args, "missing", 7.5) - 7.5) > 1e-12) failures.Add("ArgDouble fallback failed");

            IModelDoc2 part = cad.NewDocument("Part", true);
            IFeature[] planes = cad.DefaultPlanes();
            cad.SetEquation("Wall", "2.0mm");                       // SOLIDWORKS may store 2mm; the read-back must accept it
            if (cad.EquationIndex("wall") < 0) failures.Add("EquationIndex is case-sensitive");

            // 1. Block 60 x 40 x 30
            cad.OpenSketch(planes[0]);
            ISketchLine[] o = cad.Polygon(new double[] { 0, 0, 0 }, new double[] { 60, 0, 0 }, new double[] { 60, 40, 0 }, new double[] { 0, 40, 0 });
            cad.Relate("sgCOINCIDENT", o[0].GetStartPoint2(), "origin");
            cad.Dim(null, cad.ToSketch(30, -6, 0), o[0]);
            cad.Dim(null, cad.ToSketch(-6, 20, 0), o[3]);
            IFeature os = cad.CloseSketch("BlockSketch", out status);
            cad.Extrude(os, "Block", 30, false, false, 0);
            double v0 = cad.VolumeMm3();

            // 2. Two pockets from the top face leave an interior wall X 25..35
            cad.OpenSketch(cad.PlanarFaceAt(2, 30, +1));
            foreach (double x0 in new double[] { 5, 35 })
            {
                ISketchLine[] r = cad.Polygon(new double[] { x0, 5, 30 }, new double[] { x0 + 20, 5, 30 }, new double[] { x0 + 20, 35, 30 }, new double[] { x0, 35, 30 });
                cad.Locate((ISketchPoint)r[0].GetStartPoint2(), 0, x0, -3);
                cad.Locate((ISketchPoint)r[0].GetStartPoint2(), 1, 5, -3);
                cad.Locate((ISketchPoint)r[2].GetStartPoint2(), 0, x0 + 20, 3);
                cad.Locate((ISketchPoint)r[2].GetStartPoint2(), 1, 35, 3);
            }
            IFeature ps = cad.CloseSketch("PocketSketch", out status);
            result["pocketSketchStatus"] = status;
            cad.Cut(ps, "Pockets", 25, null);
            double v1 = cad.VolumeMm3();
            if (Math.Abs((v0 - v1) - 2 * 20 * 30 * 25) > 1e-3) failures.Add("pocket volume " + (v0 - v1));

            // 3. Interior wall faces: PlanarFaceAt and the wrong-sign message
            IFace2 wallFace = cad.PlanarFaceAt(0, 25, -1);
            result["wallFaceAreaMm2"] = Math.Round(wallFace.GetArea() / (Cad.Mm * Cad.Mm), 3);
            if (Math.Abs(wallFace.GetArea() / (Cad.Mm * Cad.Mm) - 30 * 25) > 1e-3) failures.Add("PlanarFaceAt found the wrong face");
            string wrongSign = null;
            try { cad.PlanarFace(-1, 0, 0, 25); } catch (CadException e) { wrongSign = e.Message; }
            result["wrongSignMessage"] = wrongSign;
            if (wrongSign == null || !wrongSign.Contains("-25")) failures.Add("PlanarFace wrong-sign message does not list -25");

            // 4. Hole sketched on a plane inside the wall (X 28): Cut(null) must refuse, CutExpecting must take the 3 mm side
            IFeature holePlane = cad.OffsetPlane(cad.DefaultPlanes()[2], "HolePlane", 28, false);
            cad.OpenSketch(holePlane);
            ISketchArc hole = cad.Circle(28, 20, 15, 4);
            cad.Dim(null, cad.ToSketch(28, 24, 19), hole);
            cad.Locate(cad.Center(hole), 1, 20, 4);
            cad.Locate(cad.Center(hole), 2, 15, 4);
            IFeature hs = cad.CloseSketch("HoleSketch", out status);
            string refused = null;
            try { cad.Cut(hs, "Ambiguous", 8, null); } catch (CadException e) { refused = e.Message; }
            result["ambiguousCutMessage"] = refused;
            if (refused == null || !refused.Contains("both sides")) failures.Add("Cut(null) did not refuse a two-sided cut");
            if (Math.Abs(cad.VolumeMm3() - v1) > 1e-6) failures.Add("refused cut left material removed");
            double expectedHole = Math.PI * 2 * 2 * 3;
            cad.CutExpecting(hs, "WallHole", 8, expectedHole, 0.5);
            double v2 = cad.VolumeMm3();
            result["holeRemovedMm3"] = Math.Round(v1 - v2, 3);
            if (Math.Abs((v1 - v2) - expectedHole) > 1e-3) failures.Add("CutExpecting removed " + (v1 - v2));

            // 5. Two slots in ONE sketch through the front wall (Y 0..5)
            cad.OpenSketch(cad.PlanarFaceAt(1, 0, -1));
            foreach (double sx in new double[] { 15, 45 })
            {
                ISketchPoint[] c = cad.Slot(new double[] { sx, 0, 10 }, new double[] { sx, 0, 20 }, 4);
                cad.Locate(c[0], 0, sx, 4);
                cad.Locate(c[0], 2, 10, 4);
            }
            ISketch slotSketch = (ISketch)part.GetActiveSketch2();
            int verticalCentreLines = 0;
            foreach (object so in (object[])slotSketch.GetSketchSegments())
            {
                ISketchSegment seg = (ISketchSegment)so;
                if (!(seg is ISketchLine) || !seg.ConstructionGeometry) continue;
                ISketchPoint a = (ISketchPoint)((ISketchLine)seg).GetStartPoint2(), b = (ISketchPoint)((ISketchLine)seg).GetEndPoint2();
                if (Math.Abs(a.X - b.X) < 1e-9 || Math.Abs(a.Y - b.Y) < 1e-9) verticalCentreLines++;
            }
            IFeature ss = cad.CloseSketch("SlotSketch", out status);
            result["slotSketchStatus"] = status;
            result["axisAlignedCentreLines"] = verticalCentreLines;
            if (status != 3) failures.Add("two-slot sketch not fully defined: " + status);
            if (verticalCentreLines != 2) failures.Add("slot centre lines constrained: " + verticalCentreLines);
            cad.Cut(ss, "Slots", 5, null);
            double v3 = cad.VolumeMm3();
            double expectedSlots = 2 * (4 * 10 + Math.PI * 2 * 2) * 5;
            if (Math.Abs((v2 - v3) - expectedSlots) > 1e-3) failures.Add("slots removed " + (v2 - v3) + " expected " + expectedSlots);

            // 6. Separate body
            cad.OpenSketch(cad.DefaultPlanes()[0]);
            ISketchLine[] q = cad.Polygon(new double[] { 70, 0, 0 }, new double[] { 80, 0, 0 }, new double[] { 80, 10, 0 }, new double[] { 70, 10, 0 });
            cad.Locate((ISketchPoint)q[0].GetStartPoint2(), 0, 70, -3);
            cad.Relate("sgHORIZONTALPOINTS2D", q[0].GetStartPoint2(), "origin");
            cad.Dim(null, cad.ToSketch(75, -4, 0), q[0]);
            cad.Dim(null, cad.ToSketch(84, 5, 0), q[1]);
            IFeature cs = cad.CloseSketch("CubeSketch", out status);
            cad.Extrude(cs, "Cube", 10, false, false, 0, false);
            result["bodies"] = cad.Bodies().Count;
            if (cad.Bodies().Count != 2) failures.Add("merge:false did not make a second body");
            double expectedTotal = 60 * 40 * 30 - 2 * 20 * 30 * 25 - expectedHole - expectedSlots + 1000;
            result["volumeMm3"] = Math.Round(cad.VolumeMm3(), 3);
            if (Math.Abs(cad.VolumeMm3() - expectedTotal) > 1e-3) failures.Add("total volume " + cad.VolumeMm3() + " expected " + expectedTotal);

            // 7. Configurations, save, STL per body named by body
            cad.RenameActiveConfiguration("Base");
            cad.AllowNewItemsInAllConfigurations();
            cad.UseConfiguration("Alt");
            cad.SetEquationThisConfiguration("Wall", "3mm");
            cad.UseConfiguration("Base");
            string partPath = Path.Combine(outDir, "SwKitSmoke_Features.SLDPRT");
            cad.SaveAs(partPath);
            List<string> stls = cad.ExportBodiesStl(outDir, "SwKitSmoke_Features");
            Dictionary<string, double> bodyVolumes = cad.Bodies().ToDictionary(b => b.Name, b => ((double[])b.GetMassProperties(1.0))[3] * 1e9);
            List<string> stlCheck = new List<string>();
            foreach (string f in stls)
            {
                string body = bodyVolumes.Keys.FirstOrDefault(n => Path.GetFileNameWithoutExtension(f).EndsWith("_" + n));
                if (body == null) { failures.Add("STL file not named by a body: " + Path.GetFileName(f)); continue; }
                double sv = Cad.StlVolumeMm3(f);
                stlCheck.Add(Path.GetFileName(f) + " " + Math.Round(sv, 2) + "/" + Math.Round(bodyVolumes[body], 2));
                if (Math.Abs(sv - bodyVolumes[body]) / bodyVolumes[body] > 0.002) failures.Add("STL volume off for " + body);
            }
            result["stl"] = stlCheck;

            // 8. Open() on an already open document switches the configuration
            cad.Open(partPath, "Alt");
            result["configAfterOpen"] = cad.Doc.ConfigurationManager.ActiveConfiguration.Name;
            if (cad.Doc.ConfigurationManager.ActiveConfiguration.Name != "Alt") failures.Add("Open did not switch to Alt");
            cad.UseConfiguration("Base");

            // 9. Pin part
            IModelDoc2 pin = cad.NewDocument("Part", true);
            cad.OpenSketch(cad.DefaultPlanes()[0]);
            ISketchArc pc = cad.Circle(0, 0, 0, 4);
            cad.Dim(null, cad.ToSketch(3, 3, 0), pc);
            cad.Relate("sgCOINCIDENT", cad.Center(pc), "origin");
            IFeature pinSketch = cad.CloseSketch("PinSketch", out status);
            cad.Extrude(pinSketch, "Pin", 20, false, false, 0);
            string pinPath = Path.Combine(outDir, "SwKitSmoke_Pin.SLDPRT");
            cad.SaveAs(pinPath);

            // 10. Assembly: part in configuration Alt, pin concentric with the wall hole
            IModelDoc2 asm = cad.NewDocument("Assembly", true);
            IComponent2 block = cad.AddComponent(asm, partPath, 0, 0, 0, "Alt");
            result["blockConfiguration"] = block.ReferencedConfiguration;
            cad.Fix(asm, block, true);
            IComponent2 pinComp = cad.AddComponent(asm, pinPath, 100, 100, 100);
            cad.Fix(asm, pinComp, false);
            // Pin face: mapped from the pin part (one configuration). Hole face: taken from the component in assembly context,
            // because the block component uses configuration Alt while the part window shows Base.
            cad.Doc = pin;
            IFace2 pinFace = ((object[])cad.Bodies()[0].GetFaces()).Cast<IFace2>().FirstOrDefault(f => ((ISurface)f.GetSurface()).IsCylinder());
            cad.Doc = asm;
            IFace2 holeFace = null;
            foreach (IFace2 f in cad.ComponentFaces(block))
            {
                ISurface s = (ISurface)f.GetSurface();
                if (!s.IsCylinder()) continue;
                double[] cp = (double[])s.CylinderParams;
                if (Math.Abs(cp[6] / Cad.Mm - 2) < 1e-6 && Math.Abs(Math.Abs(cp[3]) - 1) < 1e-6) holeFace = f;
            }
            if (pinFace == null || holeFace == null) throw new CadException("pin or hole face not found");
            cad.Doc = asm;
            cad.Mate(asm, swMateType_e.swMateCONCENTRIC, swMateAlign_e.swMateAlignCLOSEST, 0,
                cad.InComponent(pinComp, pinFace), holeFace);
            asm.EditRebuild3();
            MathTransform t = pinComp.Transform2;
            double[] p0 = (double[])((MathPoint)((MathPoint)cad.MathUtil.CreatePoint(new double[] { 0, 0, 0 })).MultiplyTransform(t)).ArrayData;
            double[] p1 = (double[])((MathPoint)((MathPoint)cad.MathUtil.CreatePoint(new double[] { 0, 0, 0.01 })).MultiplyTransform(t)).ArrayData;
            result["pinAxisPointMm"] = new double[] { Math.Round(p0[0] / Cad.Mm, 4), Math.Round(p0[1] / Cad.Mm, 4), Math.Round(p0[2] / Cad.Mm, 4) };
            result["pinAxisDir"] = new double[] { Math.Round((p1[0] - p0[0]) / 0.01, 6), Math.Round((p1[1] - p0[1]) / 0.01, 6), Math.Round((p1[2] - p0[2]) / 0.01, 6) };
            if (Math.Abs(p0[1] / Cad.Mm - 20) > 1e-4 || Math.Abs(p0[2] / Cad.Mm - 15) > 1e-4 || Math.Abs(Math.Abs((p1[0] - p0[0]) / 0.01) - 1) > 1e-6)
                failures.Add("pin is not concentric with the X-axis hole at Y 20, Z 15");
            result["mateErrors"] = cad.MateErrors(asm);
            if (block.ReferencedConfiguration != "Alt") failures.Add("block not in configuration Alt");
            result["interferencePairs"] = cad.InterferencePairs(asm);
            string assemblyPath = Path.Combine(outDir, "SwKitSmoke_Pinned.SLDASM");
            cad.SaveAs(assemblyPath);
            string preview = Path.Combine(outDir, "SwKitSmoke_Pinned.png");
            cad.CaptureView(preview, new double[] { 1, 1, 1 }, new double[] { 0, 0, 1 });
            result["previewBytes"] = new FileInfo(preview).Length;
            if (new FileInfo(preview).Length < 1000) failures.Add("preview image missing or empty");

            cad.Doc = asm;
            if (asm.GetSaveFlag()) cad.SaveAs(assemblyPath);
            cad.Doc = part;
            if (part.GetSaveFlag()) cad.SaveAs(partPath);
            List<string> closedDocs = cad.CloseDocumentsUnder(outDir, false);
            result["closed"] = closedDocs.Select(Path.GetFileName).ToArray();
            if (closedDocs.Count != 3) failures.Add("CloseDocumentsUnder reported " + closedDocs.Count + " documents, expected 3");
            IModelDoc2 still = (IModelDoc2)cad.App.GetFirstDocument();
            while (still != null)
            {
                if (still.GetPathName().StartsWith(outDir, StringComparison.OrdinalIgnoreCase)) failures.Add("still open: " + still.GetPathName());
                still = (IModelDoc2)still.GetNext();
            }
            result["failures"] = failures;
            result["passed"] = failures.Count == 0;
            return result;
        }
    }
}
