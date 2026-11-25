// Third smoke test for SwKit: a part built top-down, in the context of an assembly.
//
// Block 40 x 30 x 20 below the Top plane (fixed in a new assembly). A new virtual part on the assembly Top plane
// (NewPartInContext), a D10 circle sketched on the new part's own Front Plane, extruded 10 mm through the assembly
// (InContextFeature), back to the assembly (EndEditInContext), saved as its own file (SaveVirtualPart). Checks: the
// empty Sketch1 left by InsertNewVirtualPart is gone, the peg volume is pi * 5^2 * 10, the peg stands on the block
// (no interference), the component took the file name, and every document closes.
//
// args: outDir (string)
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
            string outDir = Cad.ArgString(args, "outDir");
            Directory.CreateDirectory(outDir);

            // Block below the Top plane: Y -20 .. 0.
            cad.NewDocument("Part", true);
            cad.OpenSketch(cad.DefaultPlanes()[1]);
            double[] a = cad.ToSketch(-20, 0, -15), b = cad.ToSketch(20, 0, 15);
            cad.Exact(() => cad.Doc.SketchManager.CreateCornerRectangle(a[0], a[1], 0, b[0], b[1], 0));
            IFeature blockSketch = cad.CloseSketch("Block_sketch", out status);
            cad.Extrude(blockSketch, "Block", 20, false, false, 0);
            double[] box = cad.ExtentsMm(cad.Bodies()[0]);
            if (box[4] > 1e-6)
            {
                cad.Delete(cad.Feature("Block"));
                cad.Extrude(cad.Feature("Block_sketch"), "Block", 20, true, false, 0);
                box = cad.ExtentsMm(cad.Bodies()[0]);
            }
            if (Math.Abs(box[1] + 20) > 1e-6 || Math.Abs(box[4]) > 1e-6) failures.Add("block is not at Y -20 .. 0");
            string blockPath = Path.Combine(outDir, "SwKitSmoke_TopDownBlock.SLDPRT");
            cad.SaveAs(blockPath);

            IModelDoc2 asm = cad.NewDocument("Assembly", true);
            IComponent2 blockComp = cad.AddComponent(asm, blockPath, 0, 0, 0);
            cad.Fix(asm, blockComp, true);
            string asmPath = Path.Combine(outDir, "SwKitSmoke_TopDown.SLDASM");
            cad.SaveAs(asmPath);

            // New part in context on the assembly Top plane.
            IComponent2 peg = cad.NewPartInContext(asm, cad.DefaultPlanes()[1]);
            IModelDoc2 pegDoc = (IModelDoc2)peg.GetModelDoc2();
            result["editTarget"] = ((IModelDoc2)((IAssemblyDoc)asm).GetEditTarget()).GetTitle();
            cad.OpenSketch(peg.FeatureByName("Front Plane"));
            cad.Exact(() => asm.SketchManager.CreateCircleByRadius(0, 0, 0, 5 * Cad.Mm));
            IFeature pegSketch = cad.CloseSketch("Peg_sketch", out status);
            cad.Extrude(cad.InContextFeature(peg, pegSketch), "Peg", 10, false, false, 0);
            cad.EndEditInContext(asm);
            if (!asm.IsEditingSelf()) failures.Add("still editing in context");
            asm.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, 0, 0);

            string pegPath = Path.Combine(outDir, "SwKitSmoke_TopDownPeg.SLDPRT");
            cad.SaveVirtualPart(peg, pegPath);
            asm.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, 0, 0);
            result["pegComponent"] = peg.Name2;
            if (!peg.Name2.StartsWith("SwKitSmoke_TopDownPeg", StringComparison.OrdinalIgnoreCase)) failures.Add("component did not take the file name");

            List<string> sketches = new List<string>();
            IFeature f = (IFeature)pegDoc.FirstFeature();
            while (f != null)
            {
                if (f.GetTypeName2() == "ProfileFeature") sketches.Add(f.Name);
                f = (IFeature)f.GetNextFeature();
            }
            result["pegSketches"] = sketches;
            if (sketches.Count != 1 || sketches[0] != "Peg_sketch") failures.Add("peg part sketches: " + string.Join(", ", sketches));
            IMassProperty mass = (IMassProperty)pegDoc.Extension.CreateMassProperty();
            double volume = mass.Volume * 1e9;
            result["pegVolumeMm3"] = Math.Round(volume, 3);
            if (Math.Abs(volume - Math.PI * 25 * 10) > 0.01) failures.Add("peg volume " + volume);
            int clashes = cad.InterferenceCount(asm);
            result["interference"] = clashes;
            if (clashes != 0) failures.Add("peg extruded into the block (in-context extrude direction changed?)");
            result["mateErrors"] = cad.MateErrors(asm);

            // The interference calculation leaves the assembly marked modified: save the job's own files, then close.
            result["savedAfterChecks"] = cad.SaveDirtyUnder(outDir).Select(Path.GetFileName).ToArray();
            List<string> closed = cad.CloseDocumentsUnder(outDir, false);
            result["closed"] = closed.Select(Path.GetFileName).ToArray();
            if (closed.Count != 3) failures.Add("closed " + closed.Count + " documents, expected 3");
            result["failures"] = failures;
            result["passed"] = failures.Count == 0;
            return result;
        }
    }
}
