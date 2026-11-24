// SwKit: typed helpers for SOLIDWORKS jobs.
//
// Compiled together with a job body by scripts/jobs/run-csharp-job.ps1 (live) or
// scripts/compile-check.ps1 (offline). Windows PowerShell 5.1 Add-Type uses the
// .NET Framework C# 5 compiler: no string interpolation, "?.", nameof, "out var",
// expression-bodied members or tuples in this file or in job bodies.
//
// Conventions
// - Public methods take millimetres and degrees; SOLIDWORKS takes metres and radians.
// - Every native call that can return null/false is checked; failures throw CadException
//   with the step name, so a job stops at the first wrong state instead of building on it.
// - Geometry is found by type and position (planes, faces, edges), never by display name
//   or index. Features this kit creates are named by the caller.
// - Preferences changed here (AddToDB, inference, STL options) are restored in finally.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace SwKit
{
    public sealed class CadException : Exception
    {
        public CadException(string message) : base(message) { }
    }

    public sealed class Cad
    {
        public const double Mm = 0.001;
        public readonly ISldWorks App;
        public readonly IMathUtility MathUtil;
        public readonly List<string> Log = new List<string>();
        public IModelDoc2 Doc;

        public Cad(object application)
        {
            App = (ISldWorks)application;
            MathUtil = (IMathUtility)App.GetMathUtility();
        }

        public void Note(string message)
        {
            Log.Add(DateTime.UtcNow.ToString("HH:mm:ss.fff") + " " + message);
        }

        // ------------------------------------------------------------------ documents

        public string Template(string kind)
        {
            swUserPreferenceStringValue_e pref = kind == "Part" ? swUserPreferenceStringValue_e.swDefaultTemplatePart
                : kind == "Assembly" ? swUserPreferenceStringValue_e.swDefaultTemplateAssembly
                : swUserPreferenceStringValue_e.swDefaultTemplateDrawing;
            string path = App.GetUserPreferenceStringValue((int)pref);
            if (!string.IsNullOrEmpty(path) && File.Exists(path)) return path;
            string pattern = kind == "Part" ? "*.prtdot" : kind == "Assembly" ? "*.asmdot" : "*.drwdot";
            string folders = App.GetUserPreferenceStringValue((int)swUserPreferenceStringValue_e.swFileLocationsDocumentTemplates) ?? "";
            foreach (string folder in folders.Split(';'))
            {
                if (folder.Length == 0 || !Directory.Exists(folder)) continue;
                string hit = Directory.GetFiles(folder, pattern).OrderBy(f => f).FirstOrDefault();
                if (hit != null) return hit;
            }
            throw new CadException("No " + kind + " template found in the default or template folders");
        }

        /// <summary>New part ("Part") or assembly ("Assembly"); becomes Doc. MMGS units when millimetres is true.</summary>
        public IModelDoc2 NewDocument(string kind, bool millimetres)
        {
            IModelDoc2 doc = (IModelDoc2)App.NewDocument(Template(kind), 0, 0, 0);
            if (doc == null) throw new CadException("NewDocument(" + kind + ") returned null");
            Doc = doc;
            if (millimetres)
                doc.Extension.SetUserPreferenceInteger((int)swUserPreferenceIntegerValue_e.swUnitSystem, 0, (int)swUnitSystem_e.swUnitSystem_MMGS);
            Note("new " + kind + ": " + doc.GetTitle());
            return doc;
        }

        /// <summary>Returns the already open document or opens it silently; becomes Doc.</summary>
        public IModelDoc2 Open(string path, string configuration)
        {
            IModelDoc2 open = (IModelDoc2)App.GetOpenDocumentByName(path);
            if (open != null) { Doc = open; return open; }
            IDocumentSpecification spec = (IDocumentSpecification)App.GetOpenDocSpec(path);
            spec.Silent = true;
            if (!string.IsNullOrEmpty(configuration)) spec.ConfigurationName = configuration;
            IModelDoc2 doc = (IModelDoc2)App.OpenDoc7(spec);
            if (doc == null) throw new CadException("Open failed: " + path + " (error " + spec.Error + ", warning " + spec.Warning + ")");
            Doc = doc;
            Note("opened " + path);
            return doc;
        }

        /// <summary>Gives the document a window; required before sketching in it.</summary>
        public void Activate(IModelDoc2 doc)
        {
            int errors = 0;
            App.ActivateDoc3(doc.GetTitle(), false, (int)swRebuildOnActivation_e.swDontRebuildActiveDoc, ref errors);
            Doc = doc;
            if (doc.SketchManager.ActiveSketch != null) doc.SketchManager.InsertSketch(true);
        }

        /// <summary>Saves (or exports by extension). After the first SaveAs of a new document, feature, face, edge and body
        /// handles taken earlier can be disconnected (RPC_E_DISCONNECTED): look them up again afterwards.</summary>
        public void SaveAs(string path)
        {
            int errors = 0, warnings = 0;
            Doc.ClearSelection2(true);
            bool ok = Doc.Extension.SaveAs3(path, (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                (int)swSaveAsOptions_e.swSaveAsOptions_Silent, null, null, ref errors, ref warnings);
            if (!ok || errors != 0) throw new CadException("SaveAs failed: " + path + " (errors " + errors + ", warnings " + warnings + ")");
            Note("saved " + path + (warnings != 0 ? " warnings=" + warnings : ""));
        }

        /// <summary>Export by extension (.step, .x_t, .pdf ...). The document keeps its own path.</summary>
        public void Export(string path)
        {
            SaveAs(path);
            if (!File.Exists(path)) throw new CadException("Export reported success but no file exists: " + path);
        }

        /// <summary>Closes a document this job created or opened. Refuses unsaved changes unless discard is true.</summary>
        public void Close(IModelDoc2 doc, bool discardChanges)
        {
            if (doc.GetSaveFlag() && !discardChanges) throw new CadException("Refusing to close unsaved document " + doc.GetTitle());
            App.CloseDoc(doc.GetTitle());
            if (Doc == doc) Doc = null;
        }

        // ------------------------------------------------------------------ features and lookup

        public List<IFeature> Features(string typeName)
        {
            List<IFeature> found = new List<IFeature>();
            IFeature f = (IFeature)Doc.FirstFeature();
            while (f != null)
            {
                if (typeName == null || f.GetTypeName2() == typeName) found.Add(f);
                f = (IFeature)f.GetNextFeature();
            }
            return found;
        }

        public IFeature Feature(string name)
        {
            IFeature f = null;
            if (Doc is IPartDoc) f = (IFeature)((IPartDoc)Doc).FeatureByName(name);
            else if (Doc is IAssemblyDoc) f = (IFeature)((IAssemblyDoc)Doc).FeatureByName(name);
            if (f == null) throw new CadException("Feature not found: " + name);
            return f;
        }

        /// <summary>Front, Top and Right planes in template order, independent of their (localised) names.</summary>
        public IFeature[] DefaultPlanes()
        {
            List<IFeature> planes = Features("RefPlane");
            if (planes.Count < 3) throw new CadException("Default planes not found");
            return new IFeature[] { planes[0], planes[1], planes[2] };
        }

        /// <summary>Fails on null or on a non-warning error code, then names the feature.</summary>
        public IFeature Checked(object created, string name)
        {
            IFeature f = created as IFeature;
            if (f == null) throw new CadException(name + ": creation returned null");
            bool isWarning;
            int code = f.GetErrorCode2(out isWarning);
            if (code != 0 && !isWarning) throw new CadException(name + ": feature error code " + code);
            f.Name = name;
            Doc.ClearSelection2(true);
            Note("feature " + name + (code != 0 ? " warning " + code : ""));
            return f;
        }

        public void Delete(IFeature feature)
        {
            Doc.ClearSelection2(true);
            feature.Select2(false, 0);
            Doc.Extension.DeleteSelection2(0);
            Doc.ClearSelection2(true);
        }

        public List<IBody2> Bodies()
        {
            List<IBody2> result = new List<IBody2>();
            object[] arr = null;
            if (Doc is IPartDoc) arr = (object[])((IPartDoc)Doc).GetBodies2((int)swBodyType_e.swSolidBody, false);
            if (arr != null) foreach (object b in arr) result.Add((IBody2)b);
            return result;
        }

        public double VolumeMm3()
        {
            IMassProperty mass = (IMassProperty)Doc.Extension.CreateMassProperty();
            if (mass == null) return 0.0;
            mass.UseSystemUnits = true;
            return mass.Volume * 1e9;
        }

        /// <summary>Exact extents [minX, minY, minZ, maxX, maxY, maxZ] in mm (GetBodyBox can be loose on curved bodies).</summary>
        public double[] ExtentsMm(IBody2 body)
        {
            double[] box = new double[6];
            double[][] dirs = { new double[] { 1, 0, 0 }, new double[] { 0, 1, 0 }, new double[] { 0, 0, 1 } };
            for (int i = 0; i < 3; i++)
            {
                double x, y, z;
                body.GetExtremePoint(-dirs[i][0], -dirs[i][1], -dirs[i][2], out x, out y, out z);
                box[i] = new double[] { x, y, z }[i] / Mm;
                body.GetExtremePoint(dirs[i][0], dirs[i][1], dirs[i][2], out x, out y, out z);
                box[i + 3] = new double[] { x, y, z }[i] / Mm;
            }
            return box;
        }

        /// <summary>Planar face with the given outward unit normal lying at offsetMm along that normal (largest if several).</summary>
        public IFace2 PlanarFace(double nx, double ny, double nz, double offsetMm)
        {
            IFace2 best = null;
            foreach (IBody2 body in Bodies())
            {
                foreach (object o in (object[])body.GetFaces())
                {
                    IFace2 face = (IFace2)o;
                    ISurface s = (ISurface)face.GetSurface();
                    if (!s.IsPlane()) continue;
                    double[] n = (double[])face.Normal;
                    if (Math.Abs(n[0] - nx) > 1e-6 || Math.Abs(n[1] - ny) > 1e-6 || Math.Abs(n[2] - nz) > 1e-6) continue;
                    double[] p = (double[])s.PlaneParams;
                    double along = p[3] * nx + p[4] * ny + p[5] * nz;
                    if (Math.Abs(along - offsetMm * Mm) > 1e-7) continue;
                    if (best == null || face.GetArea() > best.GetArea()) best = face;
                }
            }
            if (best == null) throw new CadException("No planar face with normal (" + nx + "," + ny + "," + nz + ") at " + offsetMm + " mm");
            return best;
        }

        /// <summary>Straight edge whose end points are a and b (mm, either order).</summary>
        public IEdge EdgeBetween(double[] aMm, double[] bMm)
        {
            foreach (IBody2 body in Bodies())
            {
                foreach (object o in (object[])body.GetEdges())
                {
                    IEdge e = (IEdge)o;
                    IVertex s = (IVertex)e.GetStartVertex(), t = (IVertex)e.GetEndVertex();
                    if (s == null || t == null) continue;
                    double[] p = (double[])s.GetPoint(), q = (double[])t.GetPoint();
                    if ((Near(p, aMm) && Near(q, bMm)) || (Near(p, bMm) && Near(q, aMm))) return e;
                }
            }
            throw new CadException("No edge between the given points");
        }

        static bool Near(double[] pointM, double[] mm)
        {
            return Math.Abs(pointM[0] - mm[0] * Mm) < 1e-7 && Math.Abs(pointM[1] - mm[1] * Mm) < 1e-7 && Math.Abs(pointM[2] - mm[2] * Mm) < 1e-7;
        }

        /// <summary>First straight edge parallel to the model axis (0=X, 1=Y, 2=Z) and at least minLengthMm long.</summary>
        public IEdge EdgeAlong(int axis, double minLengthMm)
        {
            foreach (IBody2 body in Bodies())
            {
                foreach (object o in (object[])body.GetEdges())
                {
                    IEdge e = (IEdge)o;
                    IVertex s = (IVertex)e.GetStartVertex(), t = (IVertex)e.GetEndVertex();
                    if (s == null || t == null) continue;
                    double[] p = (double[])s.GetPoint(), q = (double[])t.GetPoint();
                    bool parallel = true;
                    for (int i = 0; i < 3; i++) if (i != axis && Math.Abs(p[i] - q[i]) > 1e-7) parallel = false;
                    if (parallel && Math.Abs(p[axis] - q[axis]) >= minLengthMm * Mm) return e;
                }
            }
            throw new CadException("No straight edge along axis " + axis);
        }

        // ------------------------------------------------------------------ sketches

        /// <summary>Opens a sketch on a plane feature or planar face and returns it.</summary>
        public ISketch OpenSketch(object planeOrFace)
        {
            if (Doc.SketchManager.ActiveSketch != null) throw new CadException("A sketch is already open");
            Doc.ClearSelection2(true);
            bool selected = planeOrFace is IFeature ? ((IFeature)planeOrFace).Select2(false, 0) : ((IEntity)planeOrFace).Select4(false, null);
            if (!selected) throw new CadException("Sketch plane/face was not selected");
            Doc.SketchManager.InsertSketch(true);
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null) throw new CadException("No sketch opened (is the document active?)");
            return sketch;
        }

        /// <summary>Closes the open sketch, names it and returns (feature, constrained status: 2 under, 3 fully, 4 over defined).</summary>
        public IFeature CloseSketch(string name, out int constrainedStatus)
        {
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null) throw new CadException(name + ": no open sketch");
            constrainedStatus = sketch.GetConstrainedStatus();
            IFeature feature = (IFeature)sketch;
            Doc.SketchManager.InsertSketch(true);
            feature.Name = name;
            Note("sketch " + name + " status " + constrainedStatus);
            return feature;
        }

        /// <summary>Model point (mm) to coordinates of the open sketch (metres). Use for every entity: sketch axes vary by plane.</summary>
        public double[] ToSketch(double xMm, double yMm, double zMm)
        {
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            MathTransform t = (MathTransform)sketch.ModelToSketchTransform;
            MathPoint p = (MathPoint)MathUtil.CreatePoint(new double[] { xMm * Mm, yMm * Mm, zMm * Mm });
            double[] a = (double[])((MathPoint)p.MultiplyTransform(t)).ArrayData;
            return new double[] { a[0], a[1] };
        }

        /// <summary>"h" or "v": how the model axis (0=X, 1=Y, 2=Z) runs in the open sketch.</summary>
        public string AxisKind(int axis)
        {
            double[] a = ToSketch(0, 0, 0);
            double[] d = new double[3];
            d[axis] = 1000;
            double[] b = ToSketch(d[0], d[1], d[2]);
            return Math.Abs(b[0] - a[0]) > Math.Abs(b[1] - a[1]) ? "h" : "v";
        }

        /// <summary>Runs entity creation with AddToDB on and display off (no snapping, no auto relations); restores both.</summary>
        public T Exact<T>(Func<T> draw)
        {
            ISketchManager sm = Doc.SketchManager;
            bool addToDb = sm.AddToDB, display = sm.DisplayWhenAdded;
            try
            {
                sm.AddToDB = true;
                sm.DisplayWhenAdded = false;
                return draw();
            }
            finally
            {
                sm.DisplayWhenAdded = display;
                sm.AddToDB = addToDb;
            }
        }

        /// <summary>Exact() plus sketch inference and automatic relations off. Needed for CreateSketchSlot, which can still snap.</summary>
        public T NoInference<T>(Func<T> draw)
        {
            int[] keys = { (int)swUserPreferenceToggle_e.swSketchInference, (int)swUserPreferenceToggle_e.swSketchAutomaticRelations };
            bool[] old = keys.Select(k => App.GetUserPreferenceToggle(k)).ToArray();
            try
            {
                foreach (int k in keys) App.SetUserPreferenceToggle(k, false);
                return Exact(draw);
            }
            finally
            {
                for (int i = 0; i < keys.Length; i++) App.SetUserPreferenceToggle(keys[i], old[i]);
            }
        }

        /// <summary>Selects sketch segments, sketch points, entities or the string "origin", in order.</summary>
        public void Pick(params object[] items)
        {
            Doc.ClearSelection2(true);
            for (int i = 0; i < items.Length; i++)
            {
                object item = items[i];
                bool ok;
                if (item is string && (string)item == "origin")
                    ok = Doc.Extension.SelectByID2("Point1@Origin", "EXTSKETCHPOINT", 0, 0, 0, i > 0, 0, null, 0);
                else if (item is ISketchSegment) ok = ((ISketchSegment)item).Select4(i > 0, null);
                else if (item is ISketchPoint) ok = ((ISketchPoint)item).Select4(i > 0, null);
                else if (item is IEntity) ok = ((IEntity)item).Select4(i > 0, null);
                else if (item is IFeature) ok = ((IFeature)item).Select2(i > 0, 0);
                else ok = false;
                if (!ok) throw new CadException("Selection " + i + " failed");
            }
        }

        /// <summary>Adds a sketch relation such as sgHORIZONTAL2D, sgVERTICAL2D, sgCOINCIDENT, sgSAMELENGTH, sgMERGEPOINTS, sgVERTICALPOINTS2D.</summary>
        public void Relate(string relation, params object[] items)
        {
            Pick(items);
            Doc.SketchAddConstraints(relation);
            Doc.ClearSelection2(true);
        }

        /// <summary>Adds a driving dimension (kind "h", "v" or null for length/diameter/distance) with its text at atM (sketch metres).
        /// Returns the dimension; throws if it came back driven (reference), which would silently ignore values and equations.</summary>
        public IDimension Dim(string kind, double[] atM, params object[] items)
        {
            Pick(items);
            // With "Input dimension value" on, AddDimension2 opens the modal Modify box and blocks the call until a
            // person answers it. Switch the user option off for the call only.
            int inputToggle = (int)swUserPreferenceToggle_e.swInputDimValOnCreate;
            bool inputWas = App.GetUserPreferenceToggle(inputToggle);
            object made;
            try
            {
                App.SetUserPreferenceToggle(inputToggle, false);
                made = kind == "h" ? Doc.AddHorizontalDimension2(atM[0], atM[1], 0)
                    : kind == "v" ? Doc.AddVerticalDimension2(atM[0], atM[1], 0)
                    : Doc.AddDimension2(atM[0], atM[1], 0);
            }
            finally
            {
                App.SetUserPreferenceToggle(inputToggle, inputWas);
            }
            Doc.ClearSelection2(true);
            if (made == null) throw new CadException("Dimension was not created (zero length or bad selection?)");
            IDimension d = (IDimension)((IDisplayDimension)made).GetDimension2(0);
            if (d.DrivenState != (int)swDimensionDrivenState_e.swDimensionDriving)
                throw new CadException("Dimension " + d.FullName + " came back driven; something else already fixes that geometry");
            return d;
        }

        /// <summary>Short dimension name ("D3") for equations: "D3@SketchName".</summary>
        public static string ShortName(IDimension d)
        {
            return d.FullName.Split('@')[0];
        }

        /// <summary>Locates a sketch point from the origin along a model axis. A zero coordinate becomes a relation
        /// (zero-length dimensions fail); otherwise a driving dimension is returned.</summary>
        public IDimension Locate(ISketchPoint point, int axis, double valueMm, double textOffsetMm)
        {
            string kind = AxisKind(axis);
            if (Math.Abs(valueMm) < 1e-9)
            {
                Relate(kind == "h" ? "sgVERTICALPOINTS2D" : "sgHORIZONTALPOINTS2D", point, "origin");
                return null;
            }
            double[] at = new double[] { point.X + textOffsetMm * Mm, point.Y + textOffsetMm * Mm };
            return Dim(kind, at, point, "origin");
        }

        /// <summary>Closed polygon through model points (mm). Joins corners and adds horizontal/vertical relations to
        /// axis-aligned edges; positions are left to the caller's dimensions. Returns the lines in point order.</summary>
        public ISketchLine[] Polygon(params double[][] pointsMm)
        {
            int n = pointsMm.Length;
            double[][] s = pointsMm.Select(p => ToSketch(p[0], p[1], p[2])).ToArray();
            ISketchLine[] lines = Exact(() =>
            {
                ISketchLine[] made = new ISketchLine[n];
                for (int i = 0; i < n; i++)
                {
                    double[] a = s[i], b = s[(i + 1) % n];
                    made[i] = (ISketchLine)Doc.SketchManager.CreateLine(a[0], a[1], 0, b[0], b[1], 0);
                }
                return made;
            });
            for (int i = 0; i < n; i++) if (lines[i] == null) throw new CadException("Polygon line " + i + " was not created");
            for (int i = 0; i < n; i++)
                Relate("sgMERGEPOINTS", lines[i].GetEndPoint2(), lines[(i + 1) % n].GetStartPoint2());
            for (int i = 0; i < n; i++)
            {
                double[] a = s[i], b = s[(i + 1) % n];
                if (Math.Abs(a[1] - b[1]) < 1e-9) Relate("sgHORIZONTAL2D", lines[i]);
                else if (Math.Abs(a[0] - b[0]) < 1e-9) Relate("sgVERTICAL2D", lines[i]);
            }
            return lines;
        }

        /// <summary>Circle at a model point (mm) with a diameter in mm. Use Dim(null, ..., circle) for its diameter.</summary>
        public ISketchArc Circle(double xMm, double yMm, double zMm, double diameterMm)
        {
            double[] c = ToSketch(xMm, yMm, zMm);
            ISketchArc arc = Exact(() => (ISketchArc)Doc.SketchManager.CreateCircleByRadius(c[0], c[1], 0, diameterMm * Mm / 2));
            if (arc == null) throw new CadException("Circle was not created");
            return arc;
        }

        public ISketchPoint Center(ISketchArc arc)
        {
            return (ISketchPoint)arc.GetCenterPoint2();
        }

        /// <summary>Straight slot between two model centre points (mm) with its width and centre-to-centre length dimensions.
        /// Inference is switched off because CreateSketchSlot can snap even with AddToDB; the centre-line relation that
        /// automatic relations would add is added explicitly. Locate the first returned centre to fully define the slot.</summary>
        public ISketchPoint[] Slot(double[] aMm, double[] bMm, double widthMm)
        {
            double[] a = ToSketch(aMm[0], aMm[1], aMm[2]), b = ToSketch(bMm[0], bMm[1], bMm[2]);
            object slot = NoInference(() => Doc.SketchManager.CreateSketchSlot(
                (int)swSketchSlotCreationType_e.swSketchSlotCreationType_line, (int)swSketchSlotLengthType_e.swSketchSlotLengthType_CenterCenter,
                widthMm * Mm, a[0], a[1], 0, b[0], b[1], 0, 0, 0, 0, 1, true));
            if (slot == null) throw new CadException("Slot was not created");
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            List<ISketchPoint> centres = new List<ISketchPoint>();
            ISketchSegment centreLine = null;
            foreach (object o in (object[])sketch.GetSketchSegments())
            {
                ISketchSegment seg = (ISketchSegment)o;
                if (seg.GetType() == (int)swSketchSegments_e.swSketchARC) centres.Add((ISketchPoint)((ISketchArc)seg).GetCenterPoint2());
                if (seg.GetType() == (int)swSketchSegments_e.swSketchLINE && seg.ConstructionGeometry) centreLine = seg;
            }
            ISketchPoint ca = centres.OrderBy(p => Math.Abs(p.X - a[0]) + Math.Abs(p.Y - a[1])).First();
            ISketchPoint cb = centres.OrderBy(p => Math.Abs(p.X - b[0]) + Math.Abs(p.Y - b[1])).First();
            if (Math.Abs(ca.X - a[0]) > 1e-7 || Math.Abs(ca.Y - a[1]) > 1e-7) throw new CadException("Slot centre moved during creation");
            if (centreLine != null)
            {
                if (Math.Abs(a[1] - b[1]) < 1e-9) Relate("sgHORIZONTAL2D", centreLine);
                else if (Math.Abs(a[0] - b[0]) < 1e-9) Relate("sgVERTICAL2D", centreLine);
            }
            return new ISketchPoint[] { ca, cb };
        }

        // ------------------------------------------------------------------ features

        /// <summary>Boss from a sketch. depth2Mm with both=true extrudes the second direction; reverse flips direction 1.</summary>
        public IFeature Extrude(IFeature sketch, string name, double depthMm, bool reverse, bool both, double depth2Mm)
        {
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            object f = Doc.FeatureManager.FeatureExtrusion3(!both, false, reverse,
                (int)swEndConditions_e.swEndCondBlind, (int)swEndConditions_e.swEndCondBlind, depthMm * Mm, depth2Mm * Mm,
                false, false, false, false, 0, 0, false, false, false, false, true, true, true,
                (int)swStartConditions_e.swStartSketchPlane, 0, false);
            return Checked(f, name);
        }

        /// <summary>Cut from a sketch; depthMm &lt;= 0 means through all. alongNormal null tries both directions and keeps
        /// the one that actually removed material (a cut toward empty space returns null or removes nothing).</summary>
        public IFeature Cut(IFeature sketch, string name, double depthMm, bool? alongNormal)
        {
            int end = depthMm > 0 ? (int)swEndConditions_e.swEndCondBlind : (int)swEndConditions_e.swEndCondThroughAll;
            double depth = depthMm > 0 ? depthMm * Mm : 0.01;
            bool[] directions = alongNormal.HasValue ? new bool[] { alongNormal.Value } : new bool[] { true, false };
            double before = VolumeMm3();
            foreach (bool dir in directions)
            {
                Doc.ClearSelection2(true);
                if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
                IFeature f = (IFeature)Doc.FeatureManager.FeatureCut4(true, false, dir, end, end, depth, depth,
                    false, false, false, false, 0, 0, false, false, false, false, false, true, true, true, true, false,
                    (int)swStartConditions_e.swStartSketchPlane, 0, false, false);
                Doc.ClearSelection2(true);
                if (f == null) continue;
                bool isWarning;
                int code = f.GetErrorCode2(out isWarning);
                if ((code != 0 && !isWarning) || VolumeMm3() > before - 1e-6)
                {
                    Delete(f);
                    continue;
                }
                return Checked(f, name);
            }
            throw new CadException(name + ": cut removed no material in the tried direction(s)");
        }

        /// <summary>Plane parallel to a plane feature or planar face, offset in mm. flip puts it on the opposite side.</summary>
        public IFeature OffsetPlane(object reference, string name, double distanceMm, bool flip)
        {
            Pick(reference);
            int constraint = (int)swRefPlaneReferenceConstraints_e.swRefPlaneReferenceConstraint_Distance;
            if (flip) constraint |= (int)swRefPlaneReferenceConstraints_e.swRefPlaneReferenceConstraint_OptionFlip;
            object plane = Doc.FeatureManager.InsertRefPlane(constraint, Math.Abs(distanceMm) * Mm, 0, 0, 0, 0);
            return Checked(plane, name);
        }

        /// <summary>Constant-wall shell removing the given faces (wall grows inward).</summary>
        public IFeature Shell(IFace2[] openFaces, double thicknessMm, string name)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            for (int i = 0; i < openFaces.Length; i++)
                if (!((IEntity)openFaces[i]).Select4(i > 0, null)) throw new CadException(name + ": face " + i + " not selected");
            Doc.InsertFeatureShell(thicknessMm * Mm, false);
            List<IFeature> all = Features(null);
            if (all.Count == before || all[all.Count - 1].GetTypeName2() != "Shell") throw new CadException(name + ": shell was not created");
            return Checked(all[all.Count - 1], name);
        }

        /// <summary>Constant-radius fillet on edges.</summary>
        public IFeature Fillet(IEdge[] edges, double radiusMm, string name)
        {
            Doc.ClearSelection2(true);
            for (int i = 0; i < edges.Length; i++)
                if (!((IEntity)edges[i]).Select4(i > 0, null)) throw new CadException(name + ": edge " + i + " not selected");
            object f = Doc.FeatureManager.FeatureFillet3(195, radiusMm * Mm, 0, 0, 0, 0, 0, null, null, null, null, null, null, null);
            return Checked(f, name);
        }

        /// <summary>Equal-distance 45 degree chamfer on edges.</summary>
        public IFeature Chamfer(IEdge[] edges, double distanceMm, string name)
        {
            Doc.ClearSelection2(true);
            for (int i = 0; i < edges.Length; i++)
                if (!((IEntity)edges[i]).Select4(i > 0, null)) throw new CadException(name + ": edge " + i + " not selected");
            object f = Doc.FeatureManager.InsertFeatureChamfer(0, (int)swChamferType_e.swChamferAngleDistance, distanceMm * Mm, Math.PI / 4, 0, 0, 0, 0);
            return Checked(f, name);
        }

        /// <summary>One-direction linear pattern of a feature. direction is a plane feature (its normal) or a straight edge.
        /// Retries reversed when instances miss the body. Returns the pattern; its spacing dimension name is in spacingDimension.</summary>
        public IFeature LinearPattern(IFeature seed, object direction, int count, double spacingMm, string name, out string spacingDimension)
        {
            spacingDimension = null;
            foreach (bool reverse in new bool[] { false, true })
            {
                Doc.ClearSelection2(true);
                SelectData mark = (SelectData)((ISelectionMgr)Doc.SelectionManager).CreateSelectData();
                mark.Mark = 1;
                bool okDir = direction is IFeature ? ((IFeature)direction).Select2(false, 1) : ((IEntity)direction).Select4(false, mark);
                if (!okDir || !seed.Select2(true, 4)) throw new CadException(name + ": selection failed");
                IFeature f = (IFeature)Doc.FeatureManager.FeatureLinearPattern5(count, spacingMm * Mm, 1, 0, reverse, false, "NULL", "NULL",
                    false, false, false, false, false, false, true, true, false, false, 0, 0, false, false);
                Doc.ClearSelection2(true);
                if (f == null) continue;
                bool isWarning;
                if (f.GetErrorCode2(out isWarning) != 0) { Delete(f); continue; }
                Checked(f, name);
                spacingDimension = FindDimension(f, spacingMm);
                return f;
            }
            throw new CadException(name + ": linear pattern failed in both directions");
        }

        /// <summary>Name ("D3") of the feature's display dimension with the given value in mm, or null.</summary>
        public string FindDimension(IFeature feature, double valueMm)
        {
            IDisplayDimension shown = (IDisplayDimension)feature.GetFirstDisplayDimension();
            while (shown != null)
            {
                IDimension d = (IDimension)shown.GetDimension2(0);
                if (Math.Abs(d.SystemValue / Mm - valueMm) < 1e-6) return ShortName(d);
                shown = (IDisplayDimension)feature.GetNextDisplayDimension(shown);
            }
            return null;
        }

        /// <summary>Hex-perforation fill pattern of a seed cut inside a boundary sketch. Place the seed at the boundary centroid.</summary>
        public IFeature FillPattern(IFeature seed, IFeature boundarySketch, IEdge directionEdge, double pitchMm, double marginMm, string name)
        {
            Doc.ClearSelection2(true);
            SelectData dirMark = (SelectData)((ISelectionMgr)Doc.SelectionManager).CreateSelectData();
            dirMark.Mark = 1;
            if (!seed.Select2(false, 4) || !((IEntity)directionEdge).Select4(true, dirMark) || !boundarySketch.Select2(true, 16384))
                throw new CadException(name + ": selection failed");
            IFillPatternFeatureData data = (IFillPatternFeatureData)Doc.FeatureManager.CreateDefinition((int)swFeatureNameID_e.swFmFillPattern);
            data.FeaturesToPatternType = 0;
            data.GeometryPattern = false;
            data.PatternLayoutType = (int)swPatternLayoutType_e.swPatternLayoutPerforation;
            data.InstanceSpacing = pitchMm * Mm;
            data.LoopSpacing = pitchMm * Mm;
            data.StaggerAngle = Math.PI / 3;
            data.Rotation = 0;
            data.Margins = marginMm * Mm;
            data.LayoutSpacingType = 0;
            data.CreateSeedCutType = 0;
            data.CreateSeedCutPolygonSides = 0;
            data.PatternLayoutPolygonSides = 0;
            data.NoOfInstances = 10;
            data.Diameter = 0.004;
            data.Dimension = 0.004;
            data.Diagonal = 0.004;
            data.InnerRadius = 0.002;
            data.OuterRadius = 0.002;
            data.SeedCutFlipShapeDirection = false;
            object f = Doc.FeatureManager.CreateFeature(data);
            return Checked(f, name);
        }

        // ------------------------------------------------------------------ equations and configurations

        public IEquationMgr Equations()
        {
            IEquationMgr m = (IEquationMgr)Doc.GetEquationMgr();
            if (m == null) throw new CadException("No equation manager");
            return m;
        }

        /// <summary>Index of the equation whose left side is lhs (without quotes), or -1.</summary>
        public int EquationIndex(string lhs)
        {
            IEquationMgr m = Equations();
            for (int i = 0; i < m.GetCount(); i++)
            {
                string text = m.Equation[i];
                int a = text.IndexOf('"'), b = a >= 0 ? text.IndexOf('"', a + 1) : -1;
                if (a >= 0 && b > a && text.Substring(a + 1, b - a - 1) == lhs) return i;
            }
            return -1;
        }

        /// <summary>Adds or replaces "lhs" = rhs, e.g. SetEquation("Wall", "2mm") or SetEquation("D1@Boss", "\"Wall\" * 2").
        /// Sketch dimensions are owned by the sketch ("D2@SketchName"), feature dimensions by the feature.</summary>
        public void SetEquation(string lhs, string rhs)
        {
            string text = "\"" + lhs + "\" = " + rhs;
            int index = EquationIndex(lhs);
            IEquationMgr m = Equations();
            if (index < 0)
            {
                if (m.Add2(-1, text, true) < 0) throw new CadException("Equation rejected: " + text);
            }
            else
            {
                m.Equation[index] = text;
            }
            string stored = Equations().Equation[EquationIndex(lhs)];
            if (stored.Replace(" ", "") != text.Replace(" ", "")) throw new CadException("Equation not stored as written: " + stored);
        }

        public double EquationValue(string lhs)
        {
            int index = EquationIndex(lhs);
            if (index < 0) throw new CadException("No equation for " + lhs);
            return Equations().Value[index];
        }

        /// <summary>Gives a global variable a value in the active configuration only (configuration families).</summary>
        public void SetEquationThisConfiguration(string lhs, string rhs)
        {
            int index = EquationIndex(lhs);
            if (index < 0) throw new CadException("No equation for " + lhs);
            int rc = Equations().SetEquationAndConfigurationOption(index, "\"" + lhs + "\" = " + rhs,
                (int)swInConfigurationOpts_e.swThisConfiguration, null);
            if (rc < 0) throw new CadException("Configuration-specific equation failed for " + lhs);
        }

        /// <summary>Activates (creating if needed) a configuration of Doc. Re-fetch equation data after this call.</summary>
        public void UseConfiguration(string name)
        {
            string[] names = (string[])Doc.GetConfigurationNames();
            if (names == null || !names.Contains(name))
            {
                object made = Doc.AddConfiguration3(name, "", "", 0);
                if (made == null) throw new CadException("Configuration not created: " + name);
            }
            if (Doc.ConfigurationManager.ActiveConfiguration.Name != name) Doc.ShowConfiguration2(name);
            if (Doc.ConfigurationManager.ActiveConfiguration.Name != name) throw new CadException("Configuration not active: " + name);
        }

        /// <summary>Renames the active configuration (for example "Default" to the first variant's name).</summary>
        public void RenameActiveConfiguration(string name)
        {
            IConfiguration active = (IConfiguration)Doc.ConfigurationManager.ActiveConfiguration;
            if (active.Name != name) active.Name = name;
            if (Doc.ConfigurationManager.ActiveConfiguration.Name != name) throw new CadException("Configuration rename failed: " + name);
        }

        public void Rebuild()
        {
            Doc.EditRebuild3();
        }

        /// <summary>Features with a non-warning error code.</summary>
        public List<string> FeatureErrors()
        {
            List<string> errors = new List<string>();
            foreach (IFeature f in Features(null))
            {
                bool isWarning;
                int code = f.GetErrorCode2(out isWarning);
                if (code != 0 && !isWarning) errors.Add(f.Name + ":" + code);
            }
            return errors;
        }

        // ------------------------------------------------------------------ assemblies

        /// <summary>Inserts an open part/assembly file (opened silently first) with its origin at (x, y, z) mm and no rotation.</summary>
        public IComponent2 AddComponent(IModelDoc2 assembly, string path, double xMm, double yMm, double zMm)
        {
            Open(path, null);
            Activate(assembly);
            IComponent2 c = (IComponent2)((IAssemblyDoc)assembly).AddComponent5(path, 0, "", false, "", 0, 0, 0);
            if (c == null) throw new CadException("AddComponent5 failed: " + path);
            MoveComponent(c, xMm, yMm, zMm);
            Doc = assembly;
            return c;
        }

        /// <summary>Sets a component transform (translation only). Transform2 needs the MathTransform coclass.</summary>
        public void MoveComponent(IComponent2 c, double xMm, double yMm, double zMm)
        {
            double[] arr = { 1, 0, 0, 0, 1, 0, 0, 0, 1, xMm * Mm, yMm * Mm, zMm * Mm, 1, 0, 0, 0 };
            c.Transform2 = (MathTransform)MathUtil.CreateTransform(arr);
        }

        public void Fix(IModelDoc2 assembly, IComponent2 c, bool fix)
        {
            assembly.ClearSelection2(true);
            if (!c.Select4(false, null, false)) throw new CadException("Component not selected");
            if (fix) ((IAssemblyDoc)assembly).FixComponent(); else ((IAssemblyDoc)assembly).UnfixComponent();
            assembly.ClearSelection2(true);
        }

        /// <summary>Coincident mate between two named reference planes of two components (closest alignment).</summary>
        public IFeature MatePlanes(IModelDoc2 assembly, IComponent2 a, string planeA, IComponent2 b, string planeB)
        {
            IFeature fa = (IFeature)a.FeatureByName(planeA), fb = (IFeature)b.FeatureByName(planeB);
            if (fa == null || fb == null) throw new CadException("Mate plane missing: " + planeA + " / " + planeB);
            assembly.ClearSelection2(true);
            if (!fa.Select2(false, 1) || !fb.Select2(true, 1)) throw new CadException("Mate selection failed");
            int error;
            object mate = ((IAssemblyDoc)assembly).AddMate5((int)swMateType_e.swMateCOINCIDENT, (int)swMateAlign_e.swMateAlignCLOSEST,
                false, 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0, out error);
            assembly.ClearSelection2(true);
            if (mate == null || error != (int)swAddMateError_e.swAddMateError_NoError)
                throw new CadException("Mate failed " + planeA + "/" + planeB + " error " + error);
            return (IFeature)mate;
        }

        /// <summary>Mate features with errors (empty when all solve).</summary>
        public List<string> MateErrors(IModelDoc2 assembly)
        {
            List<string> errors = new List<string>();
            IFeature f = (IFeature)assembly.FirstFeature();
            while (f != null)
            {
                if (f.GetTypeName2() == "MateGroup")
                {
                    IFeature sub = (IFeature)f.GetFirstSubFeature();
                    while (sub != null)
                    {
                        bool isWarning;
                        if (sub.GetErrorCode2(out isWarning) != 0) errors.Add(sub.Name);
                        sub = (IFeature)sub.GetNextSubFeature();
                    }
                }
                f = (IFeature)f.GetNextFeature();
            }
            return errors;
        }

        /// <summary>One explicit interference calculation (coincident faces not counted). Always releases the manager.</summary>
        public int InterferenceCount(IModelDoc2 assembly)
        {
            IInterferenceDetectionMgr mgr = (IInterferenceDetectionMgr)((IAssemblyDoc)assembly).InterferenceDetectionManager;
            try
            {
                mgr.TreatCoincidenceAsInterference = false;
                return mgr.GetInterferenceCount();
            }
            finally
            {
                mgr.Done();
            }
        }

        // ------------------------------------------------------------------ exports

        /// <summary>One binary STL per solid body (other bodies hidden), in model coordinates; returns file paths.
        /// STL preferences are restored afterwards.</summary>
        public List<string> ExportBodiesStl(string folder, string prefix)
        {
            int[] toggles = { (int)swUserPreferenceToggle_e.swSTLBinaryFormat, (int)swUserPreferenceToggle_e.swSTLDontTranslateToPositive };
            bool[] oldToggles = toggles.Select(k => App.GetUserPreferenceToggle(k)).ToArray();
            int quality = (int)swUserPreferenceIntegerValue_e.swSTLQuality;
            int oldQuality = App.GetUserPreferenceIntegerValue(quality);
            List<string> files = new List<string>();
            int count = Bodies().Count;
            try
            {
                foreach (int k in toggles) App.SetUserPreferenceToggle(k, true);
                App.SetUserPreferenceIntegerValue(quality, (int)swSTLQuality_e.swSTLQuality_Fine);
                for (int i = 0; i < count; i++)
                {
                    // Body handles do not survive an export (RPC_E_DISCONNECTED): fetch them again for every step.
                    List<IBody2> bodies = Bodies();
                    for (int j = 0; j < bodies.Count; j++) bodies[j].HideBody(j != i);
                    string path = Path.Combine(folder, prefix + (count > 1 ? "_body" + (i + 1) : "") + ".stl");
                    Export(path);
                    files.Add(path);
                }
            }
            finally
            {
                foreach (IBody2 b in Bodies()) b.HideBody(false);
                for (int i = 0; i < toggles.Length; i++) App.SetUserPreferenceToggle(toggles[i], oldToggles[i]);
                App.SetUserPreferenceIntegerValue(quality, oldQuality);
            }
            return files;
        }

        /// <summary>Volume of a binary STL in mm3 (signed tetrahedra), for comparison with VolumeMm3 per body.</summary>
        public static double StlVolumeMm3(string path)
        {
            byte[] data = File.ReadAllBytes(path);
            int n = BitConverter.ToInt32(data, 80);
            double volume = 0;
            for (int t = 0; t < n; t++)
            {
                int o = 84 + t * 50 + 12;
                double[] v = new double[9];
                for (int k = 0; k < 9; k++) v[k] = BitConverter.ToSingle(data, o + 4 * k);
                volume += (v[0] * (v[4] * v[8] - v[5] * v[7]) - v[1] * (v[3] * v[8] - v[5] * v[6]) + v[2] * (v[3] * v[7] - v[4] * v[6])) / 6.0;
            }
            return volume;
        }
    }
}
