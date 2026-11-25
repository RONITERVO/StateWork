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
// - Feature/face/edge/body handles can disconnect (RPC_E_DISCONNECTED) after a new document's first save, an export,
//   a configuration switch or a rollback: look them up again afterwards.
// - Configured models: a configuration can silently suppress features added while another one is active; see
//   ConfigurationsSuppressingNewItems / PartlySuppressedFeatures / ConfigurationReport.
using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace SwKit
{
    public sealed class CadException : Exception
    {
        public CadException(string message) : base(message) { }
    }

    /// <summary>Answers SOLIDWORKS message boxes while it is alive (using (cad.AnswerDialogs(...)) { ... }). A native call
    /// that raises a modal prompt (derived-part units, rebuild questions, replace-file confirmations) otherwise blocks the
    /// job until its timeout. A background timer polls the visible dialog windows of the SOLIDWORKS process every 300 ms;
    /// a dialog whose text contains a rule's fragment (case-insensitive) gets that rule's button clicked. Any other dialog is
    /// left alone and recorded in Unanswered, so the job log shows what blocked it. Message text is read from Static
    /// controls, or through UI Automation for TaskDialogs (SOLIDWORKS 2025 prompts are TaskDialogs whose text Win32 cannot
    /// read). The timer only uses Win32/UI Automation window calls, never the SOLIDWORKS API.</summary>
    public sealed class DialogAnswerer : IDisposable
    {
        delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int max);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        const uint BM_CLICK = 0x00F5;

        readonly uint processId;
        readonly List<KeyValuePair<string, string>> rules = new List<KeyValuePair<string, string>>();
        readonly System.Threading.Timer timer;
        readonly object gate = new object();
        readonly HashSet<IntPtr> seen = new HashSet<IntPtr>();
        public readonly List<string> Answered = new List<string>();
        public readonly List<string> Unanswered = new List<string>();

        internal DialogAnswerer(int solidworksProcessId, string[] fragmentButtonPairs)
        {
            if (fragmentButtonPairs.Length % 2 != 0) throw new CadException("AnswerDialogs takes (text fragment, button) pairs");
            processId = (uint)solidworksProcessId;
            for (int i = 0; i < fragmentButtonPairs.Length; i += 2)
                rules.Add(new KeyValuePair<string, string>(fragmentButtonPairs[i], fragmentButtonPairs[i + 1]));
            timer = new System.Threading.Timer(Poll, null, 300, 300);
        }

        static string Text(IntPtr hWnd)
        {
            System.Text.StringBuilder sb = new System.Text.StringBuilder(2048);
            GetWindowText(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }

        readonly Dictionary<IntPtr, string> automationText = new Dictionary<IntPtr, string>();

        /// <summary>Names of the dialog's UI Automation descendants (TaskDialog message, instruction, buttons).</summary>
        string AutomationText(IntPtr hWnd)
        {
            string cached;
            if (automationText.TryGetValue(hWnd, out cached)) return cached;
            List<string> names = new List<string>();
            try
            {
                System.Windows.Automation.AutomationElement root = System.Windows.Automation.AutomationElement.FromHandle(hWnd);
                foreach (System.Windows.Automation.AutomationElement e in root.FindAll(System.Windows.Automation.TreeScope.Descendants,
                    System.Windows.Automation.Condition.TrueCondition))
                {
                    string n = e.Current.Name;
                    if (!string.IsNullOrEmpty(n) && !names.Contains(n)) names.Add(n);
                }
            }
            catch (Exception) { }
            string joined = string.Join(" ", names);
            if (joined.Length > 0) automationText[hWnd] = joined;
            return joined;
        }

        static string ClassOf(IntPtr hWnd)
        {
            System.Text.StringBuilder sb = new System.Text.StringBuilder(256);
            GetClassName(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }

        void Poll(object state)
        {
            if (!System.Threading.Monitor.TryEnter(gate)) return;
            try
            {
                List<IntPtr> dialogs = new List<IntPtr>();
                EnumWindows(delegate(IntPtr hWnd, IntPtr l)
                {
                    uint pid;
                    GetWindowThreadProcessId(hWnd, out pid);
                    if (pid == processId && IsWindowVisible(hWnd) && ClassOf(hWnd) == "#32770") dialogs.Add(hWnd);
                    return true;
                }, IntPtr.Zero);
                foreach (IntPtr dialog in dialogs)
                {
                    List<string> texts = new List<string>();
                    Dictionary<string, IntPtr> buttons = new Dictionary<string, IntPtr>(StringComparer.OrdinalIgnoreCase);
                    EnumChildWindows(dialog, delegate(IntPtr child, IntPtr l)
                    {
                        string cls = ClassOf(child);
                        string caption = Text(child);
                        if (cls == "Button") buttons[caption.Replace("&", "")] = child;
                        else if (caption.Length > 0) texts.Add(caption);
                        return true;
                    }, IntPtr.Zero);
                    if (texts.Count == 0) texts.Add(AutomationText(dialog));   // TaskDialog: the message lives in a DirectUIHWND
                    string body = Text(dialog) + ": " + string.Join(" ", texts);
                    bool handled = false;
                    foreach (KeyValuePair<string, string> rule in rules)
                    {
                        IntPtr button;
                        if (body.IndexOf(rule.Key, StringComparison.OrdinalIgnoreCase) < 0 || !buttons.TryGetValue(rule.Value, out button)) continue;
                        SendMessage(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
                        lock (Answered) Answered.Add(rule.Value + " <- " + body);
                        handled = true;
                        break;
                    }
                    if (!handled && seen.Add(dialog))
                        lock (Unanswered) Unanswered.Add(body + " [" + string.Join("/", buttons.Keys) + "]");
                }
            }
            catch (Exception) { }
            finally { System.Threading.Monitor.Exit(gate); }
        }

        public void Dispose()
        {
            timer.Dispose();
            lock (gate) { }
        }
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
            string line = DateTime.UtcNow.ToString("HH:mm:ss.fff") + " " + message;
            Log.Add(line);
            Step(message);
        }

        /// <summary>File that every Note and kit step is appended to as it starts (the runner sets it to progress.log in
        /// the run directory). When a job times out, its last line names the call that did not return.</summary>
        public string ProgressPath;

        /// <summary>Records the step about to run in ProgressPath only (not in Log).</summary>
        public void Step(string message)
        {
            if (string.IsNullOrEmpty(ProgressPath)) return;
            try { File.AppendAllText(ProgressPath, DateTime.UtcNow.ToString("HH:mm:ss.fff") + " " + message + "\r\n"); }   // System.Environment clashes with the interop type
            catch (IOException) { }
        }

        // ------------------------------------------------------------------ job arguments

        // Job arguments come from JSON through Windows PowerShell: integers arrive as Int32/Int64, decimals as Double
        // (run-csharp-job.ps1 converts Decimal), booleans as Boolean, arrays as object[]. A direct cast such as
        // (double)args["wall"] compiles but throws InvalidCastException for 2 (an Int32). Read arguments through these.
        public static string ArgString(IDictionary<string, object> args, string key)
        {
            return Convert.ToString(Arg(args, key), CultureInfo.InvariantCulture);
        }

        public static double ArgDouble(IDictionary<string, object> args, string key)
        {
            return Convert.ToDouble(Arg(args, key), CultureInfo.InvariantCulture);
        }

        public static double ArgDouble(IDictionary<string, object> args, string key, double fallback)
        {
            return args.ContainsKey(key) && args[key] != null ? ArgDouble(args, key) : fallback;
        }

        public static int ArgInt(IDictionary<string, object> args, string key)
        {
            return Convert.ToInt32(Arg(args, key), CultureInfo.InvariantCulture);
        }

        public static bool ArgBool(IDictionary<string, object> args, string key)
        {
            return Convert.ToBoolean(Arg(args, key), CultureInfo.InvariantCulture);
        }

        public static bool ArgBool(IDictionary<string, object> args, string key, bool fallback)
        {
            return args.ContainsKey(key) && args[key] != null ? ArgBool(args, key) : fallback;
        }

        static object Arg(IDictionary<string, object> args, string key)
        {
            object value;
            if (args == null || !args.TryGetValue(key, out value) || value == null) throw new CadException("Missing job argument: " + key);
            return value;
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

        /// <summary>New part, assembly or drawing from an explicit template file (a course or company template);
        /// becomes Doc. MMGS units when millimetres is true (ignored for drawings).</summary>
        public IModelDoc2 NewDocumentFrom(string templatePath, bool millimetres)
        {
            if (!File.Exists(templatePath)) throw new CadException("Template not found: " + templatePath);
            IModelDoc2 doc = (IModelDoc2)App.NewDocument(templatePath, 0, 0, 0);
            if (doc == null) throw new CadException("NewDocument(" + templatePath + ") returned null");
            Doc = doc;
            if (millimetres && doc.GetType() != (int)swDocumentTypes_e.swDocDRAWING)
                doc.Extension.SetUserPreferenceInteger((int)swUserPreferenceIntegerValue_e.swUnitSystem, 0, (int)swUnitSystem_e.swUnitSystem_MMGS);
            Note("new from " + Path.GetFileName(templatePath) + ": " + doc.GetTitle());
            return doc;
        }

        /// <summary>Returns the already open document or opens it silently; becomes Doc.</summary>
        public IModelDoc2 Open(string path, string configuration)
        {
            IModelDoc2 open = (IModelDoc2)App.GetOpenDocumentByName(path);
            if (open != null)
            {
                Doc = open;
                // An already open document keeps its active configuration unless it is switched explicitly.
                if (!string.IsNullOrEmpty(configuration) && open.ConfigurationManager.ActiveConfiguration.Name != configuration)
                    UseConfiguration(configuration);
                return open;
            }
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
            // Close by full path: a part and an assembly with the same base name share the title ("Kamera"), and
            // CloseDoc(title) then closes whichever SOLIDWORKS finds first.
            string path = doc.GetPathName();
            App.CloseDoc(string.IsNullOrEmpty(path) ? doc.GetTitle() : path);
            if (!string.IsNullOrEmpty(path) && OpenDocumentsUnder(Path.GetDirectoryName(path)).Any(d =>
                    string.Equals(d.GetPathName(), path, StringComparison.OrdinalIgnoreCase)))
                throw new CadException("CloseDoc did not close " + path + " - a part or subassembly stays loaded while an open " +
                    "assembly or drawing references it: close the top-level document instead (that releases its components, and " +
                    "their IModelDoc2 handles then throw RPC_E_DISCONNECTED)");
            if (Doc == doc) Doc = null;
        }

        /// <summary>Paths of open documents with unsaved changes. Switching assembly configurations marks referenced parts
        /// dirty without any edit, so decide per folder what to save and what is only rebuild state.</summary>
        public List<string> DirtyDocuments()
        {
            List<string> dirty = new List<string>();
            IModelDoc2 d = (IModelDoc2)App.GetFirstDocument();
            while (d != null)
            {
                if (d.GetSaveFlag()) dirty.Add(d.GetPathName());
                d = (IModelDoc2)d.GetNext();
            }
            return dirty;
        }

        /// <summary>Closes every open document stored under folder, re-reading the document list after each close (closing an
        /// assembly can close its parts, which would disconnect a pre-built list). Refuses a document with unsaved changes
        /// unless discardChanges is true. Returns the closed paths.</summary>
        public List<string> CloseDocumentsUnder(string folder, bool discardChanges)
        {
            List<string> initial = OpenDocumentsUnder(folder).Select(x => x.GetPathName()).ToList();
            List<string> closed = new List<string>();
            for (int pass = 0; pass < 3; pass++)
            {
                // Drawings, then assemblies, then parts: a part still referenced by an open assembly does not close.
                List<IModelDoc2> docs = OpenDocumentsUnder(folder).OrderBy(x => x.GetType() == (int)swDocumentTypes_e.swDocDRAWING ? 0
                    : x.GetType() == (int)swDocumentTypes_e.swDocASSEMBLY ? 1 : 2).ToList();
                if (docs.Count == 0) break;
                foreach (IModelDoc2 doc in docs)
                {
                    string path, title;
                    try { path = doc.GetPathName(); title = doc.GetTitle(); }
                    catch (System.Runtime.InteropServices.COMException) { continue; }   // closed together with an assembly
                    if (App.GetOpenDocumentByName(path) == null) { closed.Add(path); continue; }
                    if (doc.GetSaveFlag() && !discardChanges) throw new CadException("Refusing to close unsaved document " + path);
                    App.CloseDoc(string.IsNullOrEmpty(path) ? title : path);   // by path: same-named part/assembly share a title
                    if (App.GetOpenDocumentByName(path) == null)
                    {
                        closed.Add(path);
                        if (Doc == doc) Doc = null;
                    }
                }
            }
            List<string> left = OpenDocumentsUnder(folder).Select(x => x.GetPathName()).ToList();
            if (left.Count > 0) throw new CadException("Still open after closing: " + string.Join(", ", left.ToArray()));
            return initial.Distinct(StringComparer.OrdinalIgnoreCase).ToList();   // everything that was open there is now closed
        }

        List<IModelDoc2> OpenDocumentsUnder(string folder)
        {
            string root = Path.GetFullPath(folder).TrimEnd('\\') + "\\";
            List<IModelDoc2> found = new List<IModelDoc2>();
            IModelDoc2 d = (IModelDoc2)App.GetFirstDocument();
            while (d != null)
            {
                string p = null;
                try { p = d.GetPathName(); } catch (System.Runtime.InteropServices.COMException) { p = null; }
                if (p != null && p.StartsWith(root, StringComparison.OrdinalIgnoreCase)) found.Add(d);
                d = (IModelDoc2)d.GetNext();
            }
            return found;
        }

        /// <summary>Saves every dirty document stored under folder (the job's own files) and returns their paths.</summary>
        public List<string> SaveDirtyUnder(string folder)
        {
            string root = Path.GetFullPath(folder).TrimEnd('\\') + "\\";
            List<string> saved = new List<string>();
            IModelDoc2 d = (IModelDoc2)App.GetFirstDocument();
            while (d != null)
            {
                string p = d.GetPathName();
                if (d.GetSaveFlag() && p.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                {
                    int errors = 0, warnings = 0;
                    if (!d.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, ref errors, ref warnings) || errors != 0)
                        throw new CadException("Save failed: " + p + " (errors " + errors + ")");
                    saved.Add(p);
                }
                d = (IModelDoc2)d.GetNext();
            }
            return saved;
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
                if (!body.GetExtremePoint(-dirs[i][0], -dirs[i][1], -dirs[i][2], out x, out y, out z))
                    throw new CadException("GetExtremePoint failed on body " + body.Name);
                box[i] = new double[] { x, y, z }[i] / Mm;
                if (!body.GetExtremePoint(dirs[i][0], dirs[i][1], dirs[i][2], out x, out y, out z))
                    throw new CadException("GetExtremePoint failed on body " + body.Name);
                box[i + 3] = new double[] { x, y, z }[i] / Mm;
            }
            return box;
        }

        /// <summary>Largest planar face whose outward normal is (nx, ny, nz) and whose plane lies at offsetMm measured ALONG that
        /// normal: the dot product of a point on the plane with the unit normal. For axis normals that is the coordinate times
        /// the normal's sign, so the face at Y = +48 facing -Y is PlanarFace(0, -1, 0, -48). PlanarFaceAt avoids the sign.
        /// Tolerance 1 um. On failure the message lists the offsets of the faces that do have this normal.</summary>
        public IFace2 PlanarFace(double nx, double ny, double nz, double offsetMm)
        {
            double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            if (len < 1e-12) throw new CadException("PlanarFace: zero normal");
            nx /= len; ny /= len; nz /= len;
            IFace2 best = null;
            List<double> seen = new List<double>();
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
                    if (!seen.Any(v => Math.Abs(v - along / Mm) < 1e-3)) seen.Add(Math.Round(along / Mm, 4));
                    if (Math.Abs(along - offsetMm * Mm) > 1e-6) continue;
                    if (best == null || face.GetArea() > best.GetArea()) best = face;
                }
            }
            if (best == null)
                throw new CadException("No planar face with normal (" + nx + "," + ny + "," + nz + ") at " + offsetMm + " mm along the normal; faces with this normal lie at "
                    + (seen.Count == 0 ? "none" : string.Join(", ", seen.OrderBy(v => v).Select(v => v.ToString(CultureInfo.InvariantCulture)).ToArray())) + " mm");
            return best;
        }

        /// <summary>Planar face lying at coordinateMm on model axis (0=X, 1=Y, 2=Z) whose outward normal points along +axis
        /// (outwardSign +1) or -axis (-1). PlanarFaceAt(1, 48, -1) is the face at Y = 48 facing -Y.</summary>
        public IFace2 PlanarFaceAt(int axis, double coordinateMm, int outwardSign)
        {
            if (axis < 0 || axis > 2 || (outwardSign != 1 && outwardSign != -1)) throw new CadException("PlanarFaceAt: axis 0..2 and sign +/-1");
            double[] n = new double[3];
            n[axis] = outwardSign;
            return PlanarFace(n[0], n[1], n[2], outwardSign * coordinateMm);
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
            return Math.Abs(pointM[0] - mm[0] * Mm) < 1e-6 && Math.Abs(pointM[1] - mm[1] * Mm) < 1e-6 && Math.Abs(pointM[2] - mm[2] * Mm) < 1e-6;
        }

        /// <summary>Straight edge running along the model axis (0=X, 1=Y, 2=Z) that passes through the model point (mm).
        /// Unlike EdgeBetween it still finds an edge after earlier fillets or chamfers have moved its end points.</summary>
        public IEdge EdgeAt(double xMm, double yMm, double zMm, int axis)
        {
            double[] target = { xMm * Mm, yMm * Mm, zMm * Mm };
            foreach (IBody2 body in Bodies())
            {
                foreach (object o in (object[])body.GetEdges())
                {
                    IEdge e = (IEdge)o;
                    ICurve c = (ICurve)e.GetCurve();
                    if (c == null || !c.IsLine()) continue;
                    double[] line = (double[])c.LineParams;
                    if (Math.Abs(Math.Abs(line[3 + axis]) - 1) > 1e-6) continue;
                    double[] q = (double[])e.GetClosestPointOn(target[0], target[1], target[2]);
                    if (q == null) continue;
                    double dx = q[0] - target[0], dy = q[1] - target[1], dz = q[2] - target[2];
                    if (Math.Sqrt(dx * dx + dy * dy + dz * dz) < 1e-6) return e;
                }
            }
            throw new CadException("No edge along axis " + axis + " through (" + xMm + ", " + yMm + ", " + zMm + ")");
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
                    for (int i = 0; i < 3; i++) if (i != axis && Math.Abs(p[i] - q[i]) > 1e-6) parallel = false;
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
            if (sketch.Is3D()) Doc.SketchManager.Insert3DSketch(true);   // InsertSketch does not close a 3D sketch
            else Doc.SketchManager.InsertSketch(true);
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

        /// <summary>Selects sketch segments, sketch points, entities or the string "origin", in order. While a part is edited
        /// in an assembly, ISketchPoint.Select4 returns true and selects nothing: picks are then verified by the selection count
        /// and a sketch point is picked by its assembly position (SelectByID2 "SKETCHPOINT").</summary>
        public void Pick(params object[] items)
        {
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            // Only while a component is edited in an assembly: there ISketchPoint.Select4 reports success and selects nothing.
            // Elsewhere the count is not checked - a point coincident with an already selected one (before a merge) does not
            // raise the count although the merge then works.
            IAssemblyDoc asm = Doc as IAssemblyDoc;
            bool inContext = asm != null && asm.GetEditTargetComponent() != null;
            for (int i = 0; i < items.Length; i++)
            {
                object item = items[i];
                bool ok;
                if (item is string && (string)item == "origin")
                    ok = Doc.Extension.SelectByID2("Point1@Origin", "EXTSKETCHPOINT", 0, 0, 0, i > 0, 0, null, 0);
                else if (item is ISketchSegment) ok = ((ISketchSegment)item).Select4(i > 0, null);
                else if (item is ISketchPoint)
                {
                    ok = ((ISketchPoint)item).Select4(i > 0, null);
                    if (ok && inContext && sm.GetSelectedObjectCount2(-1) <= i) ok = SelectSketchPointAt((ISketchPoint)item, i > 0);
                }
                else if (item is IEntity) ok = ((IEntity)item).Select4(i > 0, null);
                else if (item is IFeature) ok = ((IFeature)item).Select2(i > 0, 0);
                else ok = false;
                if (!ok) throw new CadException("Selection " + i + " failed");
                if (inContext && sm.GetSelectedObjectCount2(-1) <= i)
                    throw new CadException("Selection " + i + " (" + item.GetType().Name + ") reported success but selected nothing in context");
            }
        }

        /// <summary>Selects a sketch point by position in the active document: the sketch point is mapped to model space and,
        /// while a component is edited in an assembly, through that component's transform. Used by Pick as the in-context fallback.</summary>
        public bool SelectSketchPointAt(ISketchPoint point, bool append)
        {
            ISketch sketch = (ISketch)point.GetSketch();
            MathTransform toModel = (MathTransform)((MathTransform)sketch.ModelToSketchTransform).Inverse();
            MathPoint p = (MathPoint)((MathPoint)MathUtil.CreatePoint(new[] { point.X, point.Y, point.Z })).MultiplyTransform(toModel);
            IAssemblyDoc asm = Doc as IAssemblyDoc;
            IComponent2 target = asm == null ? null : (IComponent2)asm.GetEditTargetComponent();
            if (target != null) p = (MathPoint)p.MultiplyTransform((MathTransform)target.Transform2);
            double[] xyz = (double[])p.ArrayData;
            return Doc.Extension.SelectByID2("", "SKETCHPOINT", xyz[0], xyz[1], xyz[2], append, 0, null, 0);
        }

        /// <summary>Adds a sketch relation such as sgHORIZONTAL2D, sgVERTICAL2D, sgCOINCIDENT, sgSAMELENGTH, sgMERGEPOINTS, sgVERTICALPOINTS2D.</summary>
        public void Relate(string relation, params object[] items)
        {
            Step("relate " + relation);
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            int all = (int)swSketchRelationFilterType_e.swAll;
            int before = sketch == null ? -1 : ((ISketchRelationManager)sketch.RelationManager).GetRelationsCount(all);
            // While a part is edited in an assembly, picking sketch points is unreliable (Select4 selects nothing and two
            // coincident points cannot be told apart by position): relate sketch entities directly, without a selection.
            IAssemblyDoc asm = Doc as IAssemblyDoc;
            if (sketch != null && asm != null && asm.GetEditTargetComponent() != null
                && items.All(o => o is ISketchSegment || o is ISketchPoint))
            {
                string name;
                if (relation == "sgMERGEPOINTS") name = "MERGEPOINTS";
                else if (!RelationTypes.TryGetValue(relation, out name)) name = null;
                if (name != null)
                {
                    swConstraintType_e type = (swConstraintType_e)Enum.Parse(typeof(swConstraintType_e), "swConstraintType_" + name);
                    // typed arrays: an object[] of sketch entities faults the server (RPC_E_SERVERFAULT)
                    object entities = items.All(o => o is ISketchPoint) ? (object)items.Cast<SketchPoint>().ToArray()
                        : items.All(o => o is ISketchSegment) ? (object)items.Cast<SketchSegment>().ToArray() : (object)items;
                    object made = null;
                    ISketchRelationManager rm = (ISketchRelationManager)sketch.RelationManager;
                    try { made = rm.AddRelation(entities, (int)type); }
                    catch (System.Runtime.InteropServices.COMException e) { Step("AddRelation " + type + " failed (" + e.Message + ")"); }
                    if (made != null) return;
                    if (relation == "sgMERGEPOINTS")
                    {
                        // MERGEPOINTS is refused here; a coincident relation joins the two end points just the same.
                        // Selecting them instead is no option: both sit at one position.
                        try { made = rm.AddRelation(entities, (int)swConstraintType_e.swConstraintType_COINCIDENT); }
                        catch (System.Runtime.InteropServices.COMException e) { Step("AddRelation COINCIDENT failed (" + e.Message + ")"); }
                        if (made != null) return;
                        // Both are refused in an in-context 3D sketch (AddRelation returns nothing) and the two points cannot
                        // be told apart by a pick. The ends stay coincident by position, which sweep paths accept.
                        Step("sgMERGEPOINTS refused in context: end points left coincident by position");
                        return;
                    }
                    if (RelationExists(sketch, relation, items)) { Step("relation " + relation + " already present"); return; }
                    Step("AddRelation " + type + " returned nothing, falling back to a selection");
                }
            }
            Pick(items);
            Doc.SketchAddConstraints(relation);   // returns nothing: a relation that does not apply is dropped silently
            Doc.ClearSelection2(true);
            if (sketch == null || relation == "sgMERGEPOINTS") return;   // merging joins points instead of adding a relation
            int after = ((ISketchRelationManager)sketch.RelationManager).GetRelationsCount(all);
            if (after > before) return;
            if (RelationExists(sketch, relation, items)) { Step("relation " + relation + " already present"); return; }
            throw new CadException("Relation " + relation + " was not added (wrong entity types or order, " +
                "or a 2D name in a 3D sketch: use sgALONGX3D-style names there)");
        }

        // sg names of SketchAddConstraints -> swConstraintType_e names, for recognising an existing equivalent relation
        // (merging end points of tangent-continuous geometry, for example, adds the tangencies by itself).
        static readonly Dictionary<string, string> RelationTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { "sgTANGENT", "TANGENT" }, { "sgCOINCIDENT", "COINCIDENT" }, { "sgPARALLEL", "PARALLEL" }, { "sgPERPENDICULAR", "PERPENDICULAR" },
            { "sgHORIZONTAL2D", "HORIZONTAL" }, { "sgVERTICAL2D", "VERTICAL" }, { "sgSAMELENGTH", "SAMELENGTH" }, { "sgATMIDDLE", "ATMIDDLE" },
            { "sgALONGX3D", "ALONGX" }, { "sgALONGY3D", "ALONGY" }, { "sgALONGZ3D", "ALONGZ" }, { "sgCONCENTRIC", "CONCENTRIC" },
            { "sgCOLINEAR", "COLINEAR" }, { "sgHORIZONTALPOINTS2D", "HORIZPOINTS" }, { "sgVERTICALPOINTS2D", "VERTPOINTS" },
            { "sgFIXED", "FIXED" }, { "sgSYMMETRIC", "SYMMETRIC" }, { "sgCORADIAL", "CORADIAL" } };

        static string EntityKey(object o)
        {
            ISketchSegment s = o as ISketchSegment;
            if (s != null) { int[] id = (int[])s.GetID(); return "s" + s.GetType() + "_" + id[0] + "_" + id[1]; }   // IDs repeat across types
            ISketchPoint p = o as ISketchPoint;
            if (p != null) { int[] id = (int[])p.GetID(); return "p" + id[0] + "_" + id[1]; }
            return null;
        }

        /// <summary>True when the sketch already has a relation of this kind between all the given sketch entities.</summary>
        static bool RelationExists(ISketch sketch, string relation, object[] items)
        {
            string type;
            if (!RelationTypes.TryGetValue(relation, out type)) return false;
            List<string> wanted = items.Select(EntityKey).Where(k => k != null).ToList();
            if (wanted.Count == 0) return false;
            object[] relations = (object[])((ISketchRelationManager)sketch.RelationManager).GetRelations((int)swSketchRelationFilterType_e.swAll) ?? new object[0];
            foreach (object o in relations)
            {
                ISketchRelation r = (ISketchRelation)o;
                if (((swConstraintType_e)r.GetRelationType()).ToString() != "swConstraintType_" + type) continue;
                HashSet<string> keys = new HashSet<string>(((object[])r.GetEntities() ?? new object[0]).Select(EntityKey).Where(k => k != null));
                if (wanted.All(keys.Contains)) return true;
            }
            return false;
        }

        /// <summary>Adds a driving dimension (kind "h", "v" or null for length/diameter/distance) with its text at atM (sketch metres).
        /// Returns the dimension; throws if it came back driven (reference), which would silently ignore values and equations.</summary>
        public IDimension Dim(string kind, double[] atM, params object[] items)
        {
            return DimAt(kind, atM[0], atM[1], 0, items);
        }

        /// <summary>Dimension in a 3D sketch: the text goes at a model point (mm). kind null gives a length,
        /// diameter, distance or angle (two lines); a line and a plane give their distance.</summary>
        public IDimension Dim3D(double[] atMm, params object[] items)
        {
            return DimAt(null, atMm[0] * Mm, atMm[1] * Mm, atMm[2] * Mm, items);
        }

        private IDimension DimAt(string kind, double x, double y, double z, object[] items)
        {
            Step("dimension " + (kind ?? "") + " with " + items.Length + " picks");
            Pick(items);
            // With "Input dimension value" on, AddDimension2 opens the modal Modify box and blocks the call until a
            // person answers it. Switch the user option off for the call only.
            int inputToggle = (int)swUserPreferenceToggle_e.swInputDimValOnCreate;
            bool inputWas = App.GetUserPreferenceToggle(inputToggle);
            object made;
            try
            {
                App.SetUserPreferenceToggle(inputToggle, false);
                made = kind == "h" ? Doc.AddHorizontalDimension2(x, y, z)
                    : kind == "v" ? Doc.AddVerticalDimension2(x, y, z)
                    : Doc.AddDimension2(x, y, z);
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
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null) throw new CadException("Slot: no open sketch");
            HashSet<string> before = new HashSet<string>(SegmentKeys(sketch));
            int inputToggle = (int)swUserPreferenceToggle_e.swInputDimValOnCreate;
            bool inputWas = App.GetUserPreferenceToggle(inputToggle);
            object slot;
            try
            {
                App.SetUserPreferenceToggle(inputToggle, false);   // the slot's own dimensions must not open the Modify box
                slot = NoInference(() => Doc.SketchManager.CreateSketchSlot(
                    (int)swSketchSlotCreationType_e.swSketchSlotCreationType_line, (int)swSketchSlotLengthType_e.swSketchSlotLengthType_CenterCenter,
                    widthMm * Mm, a[0], a[1], 0, b[0], b[1], 0, 0, 0, 0, 1, true));
            }
            finally
            {
                App.SetUserPreferenceToggle(inputToggle, inputWas);
            }
            if (slot == null) throw new CadException("Slot was not created");
            // Only the segments this call created: other slots, arcs or construction lines in the sketch are left alone.
            List<ISketchPoint> centres = new List<ISketchPoint>();
            ISketchSegment centreLine = null;
            foreach (object o in (object[])sketch.GetSketchSegments())
            {
                ISketchSegment seg = (ISketchSegment)o;
                if (before.Contains(SegmentKey(seg))) continue;
                if (seg.GetType() == (int)swSketchSegments_e.swSketchARC) centres.Add((ISketchPoint)((ISketchArc)seg).GetCenterPoint2());
                if (seg.GetType() == (int)swSketchSegments_e.swSketchLINE && seg.ConstructionGeometry) centreLine = seg;
            }
            if (centres.Count < 2) throw new CadException("Slot: expected two new end arcs, found " + centres.Count);
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

        static string SegmentKey(ISketchSegment s)
        {
            int[] id = (int[])s.GetID();
            return s.GetType() + ":" + string.Join(".", id.Select(v => v.ToString(CultureInfo.InvariantCulture)).ToArray());
        }

        static IEnumerable<string> SegmentKeys(ISketch sketch)
        {
            object[] segs = (object[])sketch.GetSketchSegments();
            if (segs == null) return new string[0];
            return segs.Select(o => SegmentKey((ISketchSegment)o)).ToArray();
        }

        // ------------------------------------------------------------------ features


        // ---------------------------------------------------------------- drawings
        // Sheet positions and sizes are millimetres from the sheet's lower left corner; view outlines include the
        // margin SOLIDWORKS draws around the geometry.

        /// <summary>The current document as a drawing (throws when it is not one).</summary>
        public IDrawingDoc Drawing
        {
            get
            {
                IDrawingDoc d = Doc as IDrawingDoc;
                if (d == null) throw new CadException("The current document is not a drawing");
                return d;
            }
        }

        public ISheet CurrentSheet { get { return (ISheet)Drawing.GetCurrentSheet(); } }

        /// <summary>Sheet width and height in mm.</summary>
        public double[] SheetSizeMm()
        {
            double[] p = (double[])CurrentSheet.GetProperties2();
            return new double[] { p[5] * 1000, p[6] * 1000 };
        }

        /// <summary>True for first-angle projection (ISO/European): the top view goes below the front view.</summary>
        public bool FirstAngle { get { return ((double[])CurrentSheet.GetProperties2())[4] != 0; } }

        /// <summary>New drawing from a template. Templates often name their sheet-format file by the author's absolute path
        /// (a network share); when that file is missing and sheetFormatPath is given, the sheet is set up again with the
        /// local format at the same size, scale and projection, so the title block resolves on any machine.</summary>
        public IDrawingDoc NewDrawing(string templatePath, string sheetFormatPath)
        {
            NewDocumentFrom(templatePath, false);
            ISheet sheet = CurrentSheet;
            string format = sheet.GetTemplateName();
            if (!string.IsNullOrEmpty(sheetFormatPath) && (string.IsNullOrEmpty(format) || !File.Exists(format)))
            {
                if (!File.Exists(sheetFormatPath)) throw new CadException("Sheet format not found: " + sheetFormatPath);
                double[] p = (double[])sheet.GetProperties2();
                bool ok = Drawing.SetupSheet6(sheet.GetName(), (int)p[0], (int)swDwgTemplates_e.swDwgTemplateCustom, p[2], p[3], p[4] != 0,
                    sheetFormatPath, p[5], p[6], "Default", true, 0, 0, 0, 0, 0, 0);
                if (!ok) throw new CadException("SetupSheet6 failed for " + sheetFormatPath);
                Doc.EditRebuild3();
                Note("sheet format relinked: " + format + " -> " + sheetFormatPath);
            }
            return Drawing;
        }

        /// <summary>Named model view ("*Front", "*Top", "*Right", "*Isometric", ...) of a saved part or assembly, centred at
        /// (x, y) mm on the sheet.</summary>
        public IView ModelView(string modelPath, string orientation, double xMm, double yMm)
        {
            Step("model view " + orientation);
            IView v = (IView)Drawing.CreateDrawViewFromModelView3(modelPath, orientation, xMm * Mm, yMm * Mm, 0);
            if (v == null) throw new CadException("Model view " + orientation + " of " + modelPath + " was not created (saved model? orientation name?)");
            return v;
        }

        /// <summary>Projection of parent placed towards (x, y) mm; it stays aligned with its parent.</summary>
        public IView ProjectedView(IView parent, double xMm, double yMm)
        {
            Step("projected view of " + parent.GetName2());
            Doc.ClearSelection2(true);
            if (!Doc.Extension.SelectByID2(parent.GetName2(), "DRAWINGVIEW", 0, 0, 0, false, 0, null, 0))
                throw new CadException("Parent view " + parent.GetName2() + " was not selected");
            IView v = (IView)Drawing.CreateUnfoldedViewAt3(xMm * Mm, yMm * Mm, 0, false);
            Doc.ClearSelection2(true);
            if (v == null) throw new CadException("Projected view of " + parent.GetName2() + " was not created");
            return v;
        }

        /// <summary>View outline [x1, y1, x2, y2] in sheet mm.</summary>
        public double[] OutlineMm(IView view)
        {
            return ((double[])view.GetOutline()).Select(v => v * 1000).ToArray();
        }

        /// <summary>Moves a view so its outline centre lands at (x, y) mm. A projected view only moves along its projection.</summary>
        public void CentreView(IView view, double xMm, double yMm)
        {
            double[] o = OutlineMm(view);
            double[] p = (double[])view.Position;
            double dx = xMm - (o[0] + o[2]) / 2, dy = yMm - (o[1] + o[3]) / 2;
            view.Position = new double[] { p[0] + dx * Mm, p[1] + dy * Mm };
        }

        /// <summary>Views of the current sheet in creation order (the sheet itself excluded).</summary>
        public List<IView> SheetViews()
        {
            object[] views = (object[])CurrentSheet.GetViews() ?? new object[0];
            return views.Select(v => (IView)v).ToList();
        }

        /// <summary>Rectangle [x1, y1, x2, y2] mm around the sheet format's property-linked notes in the lower part of the
        /// sheet (the title block), padded by 6 mm. Null when the format has none there.</summary>
        public double[] TitleBlockMm()
        {
            double height = SheetSizeMm()[1];
            double[] b = { double.MaxValue, double.MaxValue, double.MinValue, double.MinValue };
            object[] notes = (object[])((IView)Drawing.GetFirstView()).GetNotes() ?? new object[0];
            foreach (object o in notes)
            {
                INote n = (INote)o;
                if (!(n.PropertyLinkedText ?? "").Contains("$PRP")) continue;
                double[] p = (double[])n.GetTextPoint2();
                if (p[1] * 1000 > height * 0.35) continue;
                b[0] = Math.Min(b[0], p[0] * 1000); b[1] = Math.Min(b[1], p[1] * 1000);
                b[2] = Math.Max(b[2], p[0] * 1000); b[3] = Math.Max(b[3], p[1] * 1000);
            }
            if (b[0] == double.MaxValue) return null;
            return new double[] { b[0] - 6, b[1] - 6, b[2] + 6, b[3] + 8 };
        }

        /// <summary>Sheet box [x0, y0, x1, y1] mm of a table from its anchor position and row/column sizes.</summary>
        public static double[] TableBoxMm(ITableAnnotation table)
        {
            double[] p = ((IAnnotation)table.GetAnnotation()).GetPosition() as double[];
            if (p == null) return null;
            double w = 0, h = 0;
            for (int c = 0; c < table.ColumnCount; c++) w += table.GetColumnWidth(c) * 1000;
            for (int r = 0; r < table.RowCount; r++) h += table.GetRowHeight(r) * 1000;
            double x = p[0] * 1000, y = p[1] * 1000;
            switch (table.AnchorType)
            {
                case (int)swBOMConfigurationAnchorType_e.swBOMConfigurationAnchor_TopRight: return new[] { x - w, y - h, x, y };
                case (int)swBOMConfigurationAnchorType_e.swBOMConfigurationAnchor_BottomLeft: return new[] { x, y, x + w, y + h };
                case (int)swBOMConfigurationAnchorType_e.swBOMConfigurationAnchor_BottomRight: return new[] { x - w, y, x, y + h };
                default: return new[] { x, y - h, x + w, y };
            }
        }

        /// <summary>Text height (mm) of every cell of a table, e.g. 2.5 for a compact BOM.</summary>
        public void SetTableTextHeight(ITableAnnotation table, double heightMm)
        {
            ITextFormat format = (ITextFormat)table.GetTextFormat();
            format.CharHeight = heightMm * Mm;
            if (!table.SetTextFormat(false, (TextFormat)format)) throw new CadException("Table text format was not applied");
        }

        /// <summary>Sets every row of a table to heightMm (rows keep the template's height when the text gets smaller;
        /// wrapped cells need the extra height, so widen columns first).</summary>
        public void SetTableRowHeights(ITableAnnotation table, double heightMm)
        {
            for (int r = 0; r < table.RowCount; r++)
                table.SetRowHeight(r, heightMm * Mm, (int)swTableRowColSizeChangeBehavior_e.swTableRowColChange_TableSizeCanChange);
        }

        static bool Overlap(double[] a, double[] b)
        {
            return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
        }

        /// <summary>Layout problems of the current sheet: views outside the sheet, overlapping each other or the title block.
        /// Empty lists mean a clean layout.</summary>
        public Dictionary<string, object> DrawingLayout()
        {
            double[] size = SheetSizeMm();
            double[] block = TitleBlockMm();
            Dictionary<string, double[]> outlines = SheetViews().ToDictionary(v => v.GetName2(), v => OutlineMm(v));
            List<string> outside = outlines.Where(kv => kv.Value[0] < 0 || kv.Value[1] < 0 || kv.Value[2] > size[0] || kv.Value[3] > size[1]).Select(kv => kv.Key).ToList();
            List<string> overlapping = new List<string>();
            List<string> names = outlines.Keys.ToList();
            for (int i = 0; i < names.Count; i++)
                for (int j = i + 1; j < names.Count; j++)
                    if (Overlap(outlines[names[i]], outlines[names[j]])) overlapping.Add(names[i] + " / " + names[j]);
            List<string> onBlock = block == null ? new List<string>() : outlines.Where(kv => Overlap(kv.Value, block)).Select(kv => kv.Key).ToList();
            // Annotations of the model views (balloons, dimensions, notes) must sit inside the 10 mm drawing border; tables
            // (BOM, revision) inside it and off the title block. Views alone do not catch a BOM grown into the title block.
            const double border = 10;
            foreach (IView v in SheetViews())
                foreach (IAnnotation a in ((object[])v.GetAnnotations() ?? new object[0]).Cast<IAnnotation>())
                {
                    double[] p = a.GetPosition() as double[];
                    if (p == null) continue;
                    double x = p[0] * 1000, y = p[1] * 1000;
                    if (x < border || y < border || x > size[0] - border || y > size[1] - border)
                        outside.Add(v.GetName2() + " annotation (type " + a.GetType() + ") at " + Math.Round(x) + "," + Math.Round(y));
                }
            List<IView> allViews = new List<IView>();
            for (IView v = (IView)Drawing.GetFirstView(); v != null; v = (IView)v.GetNextView()) allViews.Add(v);
            foreach (IView v in allViews)
                foreach (ITableAnnotation t in ((object[])v.GetTableAnnotations() ?? new object[0]).Cast<ITableAnnotation>())
                {
                    double[] box = TableBoxMm(t);
                    if (box == null) continue;
                    string name = "table " + t.Type + " " + string.Join(",", box.Select(c => Math.Round(c)));
                    if (box[0] < border || box[1] < border || box[2] > size[0] - border || box[3] > size[1] - border) outside.Add(name);
                    if (block != null && Overlap(box, block)) onBlock.Add(name);
                }
            return new Dictionary<string, object> {
                { "outside", outside }, { "overlapping", overlapping }, { "onTitleBlock", onBlock },
                { "titleBlockMm", block == null ? null : block.Select(v => Math.Round(v)).ToArray() } };
        }

        static bool LayoutClean(Dictionary<string, object> layout)
        {
            return ((List<string>)layout["outside"]).Count == 0 && ((List<string>)layout["overlapping"]).Count == 0 && ((List<string>)layout["onTitleBlock"]).Count == 0;
        }

        /// <summary>Front view plus its projections below (top view in first angle) and beside it, and optionally an
        /// isometric view, at the largest ISO scale (10:1 ... 1:50) where all views fit the sheet with gapMm between them
        /// and clear of the title block. Orthographic views show hidden lines removed, the isometric shaded with edges.
        /// Returns front, below, beside[, iso]; throws when no scale fits.</summary>
        public List<IView> StandardViews(string modelPath, string frontOrientation, bool withBelow, bool withBeside, bool isometric, double gapMm)
        {
            double[] size = SheetSizeMm();
            CurrentSheet.SetScale(1, 1, false, false);
            IView front = ModelView(modelPath, frontOrientation ?? "*Front", size[0] * 0.25, size[1] * 0.6);
            IView below = withBelow ? ProjectedView(front, size[0] * 0.25, size[1] * 0.6 - 80) : null;
            IView beside = withBeside ? ProjectedView(front, size[0] * 0.25 + 100, size[1] * 0.6) : null;
            IView iso = isometric ? ModelView(modelPath, "*Isometric", size[0] * 0.8, size[1] * 0.7) : null;
            List<IView> views = new List<IView> { front, below, beside, iso }.Where(v => v != null).ToList();
            foreach (IView v in views)
                v.SetDisplayMode4(false, v == iso ? (int)swDisplayMode_e.swSHADED_EDGES : (int)swDisplayMode_e.swHIDDEN, false, true, false);
            double[] block = TitleBlockMm() ?? new double[] { size[0], 0, size[0], 0 };
            double[][] scales = { new double[] { 10, 1 }, new double[] { 5, 1 }, new double[] { 2, 1 }, new double[] { 1, 1 }, new double[] { 1, 2 },
                new double[] { 1, 5 }, new double[] { 1, 10 }, new double[] { 1, 20 }, new double[] { 1, 50 } };
            double left = 22, top = size[1] - 12, right = size[0] - 12;
            foreach (double[] s in scales)
            {
                CurrentSheet.SetScale(s[0], s[1], false, false);
                foreach (IView v in views) v.UseSheetScale = 1;
                Doc.EditRebuild3();
                double[] f = OutlineMm(front);
                double fw = f[2] - f[0], fh = f[3] - f[1];
                double fx = left + gapMm / 2 + fw / 2, fy = top - gapMm / 2 - fh / 2;
                CentreView(front, fx, fy);
                double rightEdge = fx + fw / 2, lowEdge = fy - fh / 2;
                if (beside != null)
                {
                    double[] o = OutlineMm(beside);
                    CentreView(beside, rightEdge + gapMm + (o[2] - o[0]) / 2, fy);
                    rightEdge = rightEdge + gapMm + (o[2] - o[0]);
                }
                if (below != null)
                {
                    double[] o = OutlineMm(below);
                    CentreView(below, fx, lowEdge - gapMm - (o[3] - o[1]) / 2);
                }
                Doc.EditRebuild3();
                if (iso == null)
                {
                    if (LayoutClean(DrawingLayout())) { Note("standard views at scale " + s[0] + ":" + s[1]); return views; }
                    continue;
                }
                // Isometric: top right corner, else beside the lower view, else right-aligned above the title block; at the
                // sheet scale first, then at half of it (a smaller pictorial view is normal practice).
                foreach (bool half in new[] { false, true })
                {
                    if (half)
                    {
                        iso.UseSheetScale = 0;
                        iso.ScaleRatio = new double[] { s[0], s[1] * 2 };
                        Doc.EditRebuild3();
                    }
                    double[] io = OutlineMm(iso);
                    double iw = io[2] - io[0], ih = io[3] - io[1];
                    List<double[]> spots = new List<double[]> { new[] { right - iw / 2, top - ih / 2 } };
                    if (below != null)
                    {
                        double[] bo = OutlineMm(below);
                        spots.Add(new[] { bo[2] + gapMm + iw / 2, (bo[1] + bo[3]) / 2 });
                        spots.Add(new[] { Math.Max(bo[2] + gapMm + iw / 2, right - iw / 2), Math.Max(block[3] + 4 + ih / 2, (bo[1] + bo[3]) / 2) });
                    }
                    spots.Add(new[] { right - iw / 2, block[3] + 4 + ih / 2 });
                    foreach (double[] spot in spots)
                    {
                        CentreView(iso, spot[0], spot[1]);
                        Doc.EditRebuild3();
                        if (LayoutClean(DrawingLayout()))
                        {
                            Note("standard views at scale " + s[0] + ":" + s[1] + (half ? ", isometric " + s[0] + ":" + (s[1] * 2) : ""));
                            return views;
                        }
                    }
                }
                iso.UseSheetScale = 1;
            }
            throw new CadException("No scale from 10:1 to 1:50 fits the views on the sheet: " + Newtonsoft(DrawingLayout()));
        }

        static string Newtonsoft(Dictionary<string, object> map)
        {
            return string.Join("; ", map.Select(kv => kv.Key + "=" + (kv.Value is IEnumerable<string> ? string.Join(",", (IEnumerable<string>)kv.Value) : Convert.ToString(kv.Value))));
        }

        /// <summary>Inserts the model's dimensions marked for drawing into all views (no duplicates). Returns how many arrived.</summary>
        public int InsertModelDimensions()
        {
            Step("insert model dimensions");
            object[] list = null;
            int frame = App.FrameState;
            try
            {
                for (int attempt = 0; attempt < 2 && (list == null || list.Length == 0); attempt++)
                {
                    // With the SOLIDWORKS window minimized, views created in this session receive no model dimensions
                    // (the call returns nothing). Restoring the frame for the call fixes it; it is minimized again after.
                    if (attempt > 0)
                    {
                        if (frame == (int)swWindowState_e.swWindowMinimized) App.FrameState = (int)swWindowState_e.swWindowNormal;
                        Doc.ForceRebuild3(false);
                    }
                    list = Drawing.InsertModelAnnotations3((int)swImportModelItemsSource_e.swImportModelItemsFromEntireModel,
                        (int)swInsertAnnotation_e.swInsertDimensionsMarkedForDrawing, true, false, false, false) as object[];
                    Doc.ClearSelection2(true);
                }
            }
            finally
            {
                if (App.FrameState != frame) App.FrameState = frame;
            }
            return list == null ? 0 : list.Length;
        }

        /// <summary>Dimensions shown in a view: "name=value" in mm (or degrees), reference ones marked.</summary>
        public List<string> ViewDimensions(IView view)
        {
            List<string> found = new List<string>();
            object[] dims = (object[])view.GetDisplayDimensions() ?? new object[0];
            foreach (object o in dims)
            {
                IDimension d = (IDimension)((IDisplayDimension)o).GetDimension2(0);
                bool angle = d.GetType() == (int)swDimensionParamType_e.swDimensionParamTypeDoubleAngular;
                found.Add(d.FullName + "=" + Math.Round(d.SystemValue * (angle ? 180 / Math.PI : 1000), 3) + (((IDisplayDimension)o).IsReferenceDim() ? " (ref)" : ""));
            }
            return found;
        }


        /// <summary>Display dimensions of a view keyed by full dimension name.</summary>
        public Dictionary<string, IDisplayDimension> ViewDisplayDimensions(IView view)
        {
            Dictionary<string, IDisplayDimension> found = new Dictionary<string, IDisplayDimension>();
            object[] dims = (object[])view.GetDisplayDimensions() ?? new object[0];
            foreach (object o in dims)
            {
                IDisplayDimension dd = (IDisplayDimension)o;
                string name = ((IDimension)dd.GetDimension2(0)).FullName;
                if (!found.ContainsKey(name)) found[name] = dd;
            }
            return found;
        }

        /// <summary>Inserts the model dimensions marked for drawing that can show in this one view (dimensions already
        /// shown elsewhere are skipped). Insert view by view in priority order to choose where each dimension lands.</summary>
        public int InsertModelDimensionsInto(IView view)
        {
            Step("insert model dimensions into " + view.GetName2());
            object[] list = null;
            int frame = App.FrameState;
            try
            {
                for (int attempt = 0; attempt < 2 && (list == null || list.Length == 0); attempt++)
                {
                    if (attempt > 0)
                    {
                        if (frame == (int)swWindowState_e.swWindowMinimized) App.FrameState = (int)swWindowState_e.swWindowNormal;
                        Doc.ForceRebuild3(false);
                    }
                    Doc.ClearSelection2(true);
                    if (!Doc.Extension.SelectByID2(view.GetName2(), "DRAWINGVIEW", 0, 0, 0, false, 0, null, 0))
                        throw new CadException("View " + view.GetName2() + " was not selected");
                    list = Drawing.InsertModelAnnotations3((int)swImportModelItemsSource_e.swImportModelItemsFromEntireModel,
                        (int)swInsertAnnotation_e.swInsertDimensionsMarkedForDrawing, false, true, false, false) as object[];
                    Doc.ClearSelection2(true);
                }
            }
            finally
            {
                if (App.FrameState != frame) App.FrameState = frame;
            }
            return list == null ? 0 : list.Length;
        }

        /// <summary>Sheet point (mm) -> coordinates (metres) in the view's own sketch. An activated drawing view sketches in
        /// its model space (origin at the model origin, model lengths), not in sheet coordinates, so section lines and
        /// detail circles given in sheet mm must be converted.</summary>
        public double[] SheetToViewSketch(IView view, double xMm, double yMm)
        {
            ISketch sketch = (ISketch)view.GetSketch();
            IMathTransform toSketch = (IMathTransform)sketch.ModelToSketchTransform;
            IMathPoint p = (IMathPoint)MathUtil.CreatePoint(new double[] { xMm * Mm, yMm * Mm, 0 });
            double[] s = (double[])((IMathPoint)p.MultiplyTransform((MathTransform)toSketch)).ArrayData;
            return new[] { s[0], s[1] };
        }

        /// <summary>Section view of parent cut along the sheet line a-b (sheet mm), placed at (x, y) sheet mm. flip
        /// reverses the viewing direction. Surface bodies are not cut.</summary>
        public IView SectionView(IView parent, double[] aMm, double[] bMm, string label, double xMm, double yMm, bool flip, bool aligned = true,
            bool partial = false, double depthMm = 0)
        {
            Step("section view " + label + " of " + parent.GetName2());
            Doc.ClearSelection2(true);
            Drawing.ActivateView(parent.GetName2());
            double[] a = SheetToViewSketch(parent, aMm[0], aMm[1]), b = SheetToViewSketch(parent, bMm[0], bMm[1]);
            ISketchSegment line = Exact(() => (ISketchSegment)Doc.SketchManager.CreateLine(a[0], a[1], 0, b[0], b[1], 0));
            if (line == null) throw new CadException("Section line was not created in " + parent.GetName2());
            Doc.ClearSelection2(true);
            line.Select4(false, null);
            int options = (flip ? (int)swCreateSectionViewAtOptions_e.swCreateSectionView_ChangeDirection : 0)
                | (aligned ? 0 : (int)swCreateSectionViewAtOptions_e.swCreateSectionView_NotAligned)
                | (partial ? (int)swCreateSectionViewAtOptions_e.swCreateSectionView_Partial : 0);
            IView v = (IView)Drawing.CreateSectionViewAt5(xMm * Mm, yMm * Mm, 0, label, options, null, depthMm * Mm);
            Doc.ClearSelection2(true);
            if (v == null) throw new CadException("Section view " + label + " was not created");
            Doc.ForceRebuild3(false);   // a detail of a fresh section view is empty until the section is computed
            return v;
        }

        /// <summary>Detail view of parent: circle at (cx, cy) sheet mm with radius r mm, shown at scale num:den at (x, y).</summary>
        public IView DetailView(IView parent, double cxMm, double cyMm, double rMm, string label, double num, double den, double xMm, double yMm)
        {
            Step("detail view " + label + " of " + parent.GetName2());
            Doc.ClearSelection2(true);
            Drawing.ActivateView(parent.GetName2());
            double[] c = SheetToViewSketch(parent, cxMm, cyMm), rim = SheetToViewSketch(parent, cxMm + rMm, cyMm);
            double r = Math.Sqrt((rim[0] - c[0]) * (rim[0] - c[0]) + (rim[1] - c[1]) * (rim[1] - c[1]));
            ISketchSegment circle = Exact(() => (ISketchSegment)Doc.SketchManager.CreateCircleByRadius(c[0], c[1], 0, r));
            if (circle == null) throw new CadException("Detail circle was not created in " + parent.GetName2());
            Doc.ClearSelection2(true);
            circle.Select4(false, null);
            IView v = (IView)Drawing.CreateDetailViewAt4(xMm * Mm, yMm * Mm, 0, (int)swDetViewStyle_e.swDetViewSTANDARD, num, den, label,
                (int)swDetCircleShowType_e.swDetCircleCIRCLE, true, false, false, 5);
            Doc.ClearSelection2(true);
            if (v == null) throw new CadException("Detail view " + label + " was not created");
            Doc.ForceRebuild3(false);
            return v;
        }


        /// <summary>Removes a dimension from a drawing view (the model keeps it).</summary>
        public void DeleteDimension(IDisplayDimension dd)
        {
            Doc.ClearSelection2(true);
            if (!((IAnnotation)dd.GetAnnotation()).Select3(false, null)) throw new CadException("Dimension was not selected for deletion");
            Doc.EditDelete();
            Doc.ClearSelection2(true);
        }

        /// <summary>After InsertModelDimensions: keeps each model dimension only in the first view of priority that shows it,
        /// deletes every dimension in the views of clear (isometric views), and deletes dimensions whose short name
        /// ("D1@Sweep1") is in drop. Returns "view: name=value" for the dimensions kept.</summary>
        public List<string> TidyDimensions(List<IView> priority, List<IView> clear, string[] drop)
        {
            HashSet<string> seen = new HashSet<string>();
            HashSet<string> dropped = new HashSet<string>(drop ?? new string[0], StringComparer.OrdinalIgnoreCase);
            List<string> kept = new List<string>();
            foreach (IView v in clear ?? new List<IView>())
                foreach (IDisplayDimension dd in ViewDisplayDimensions(v).Values) DeleteDimension(dd);
            foreach (IView v in priority)
                foreach (KeyValuePair<string, IDisplayDimension> kv in ViewDisplayDimensions(v))
                {
                    string[] parts = kv.Key.Split('@');
                    string shortName = parts.Length > 1 ? parts[0] + "@" + parts[1] : kv.Key;
                    if (dropped.Contains(shortName) || seen.Contains(kv.Key)) { DeleteDimension(kv.Value); continue; }
                    seen.Add(kv.Key);
                    IDimension d = (IDimension)kv.Value.GetDimension2(0);
                    bool angle = d.GetType() == (int)swDimensionParamType_e.swDimensionParamTypeDoubleAngular;
                    kept.Add(v.GetName2() + ": " + shortName + "=" + Math.Round(d.SystemValue * (angle ? 180 / Math.PI : 1000), 3));
                }
            return kept;
        }

        /// <summary>Moves a dimension's text to (x, y) sheet mm; for an angle this also sets the arc radius.</summary>
        public void MoveDimension(IDisplayDimension dd, double xMm, double yMm)
        {
            if (!((IAnnotation)dd.GetAnnotation()).SetPosition2(xMm * Mm, yMm * Mm, 0)) throw new CadException("Dimension text was not moved");
        }

        /// <summary>Note on the sheet with its text at (x, y) sheet mm.</summary>
        public INote AddNote(string text, double xMm, double yMm)
        {
            Drawing.ActivateSheet(CurrentSheet.GetName());
            Doc.ClearSelection2(true);
            INote note = (INote)Doc.InsertNote(text);
            if (note == null) throw new CadException("Note was not inserted");
            ((IAnnotation)note.GetAnnotation()).SetPosition2(xMm * Mm, yMm * Mm, 0);
            Doc.ClearSelection2(true);
            return note;
        }

        /// <summary>Model point (mm) to sheet mm in a view.</summary>
        public double[] ToSheetMm(IView view, double xMm, double yMm, double zMm)
        {
            MathPoint p = (MathPoint)MathUtil.CreatePoint(new double[] { xMm * Mm, yMm * Mm, zMm * Mm });
            double[] a = (double[])((MathPoint)p.MultiplyTransform((MathTransform)view.ModelToViewTransform)).ArrayData;
            return new double[] { a[0] * 1000, a[1] * 1000 };
        }

        /// <summary>Edges visible in a view (part views; for an assembly pass the component).</summary>
        public List<IEdge> ViewEdges(IView view, IComponent2 component)
        {
            object[] items = (object[])view.GetVisibleEntities2((Component2)component, (int)swViewEntityType_e.swViewEntityType_Edge) ?? new object[0];
            return items.Select(o => (IEdge)o).ToList();
        }

        /// <summary>Visible straight edge of a view whose two end points (model mm) satisfy the given coordinates
        /// (NaN = any), or a circular edge of the given radius when radiusMm > 0. Null when none matches.</summary>
        public IEdge ViewEdge(IView view, double xMm, double yMm, double zMm, double radiusMm)
        {
            foreach (IEdge e in ViewEdges(view, null))
            {
                ICurve c = (ICurve)e.GetCurve();
                if (radiusMm > 0)
                {
                    if (c.IsCircle() && Math.Abs(((double[])c.CircleParams)[6] * 1000 - radiusMm) < 1e-3) return e;
                    continue;
                }
                if (!c.IsLine()) continue;
                IVertex a = (IVertex)e.GetStartVertex(), b = (IVertex)e.GetEndVertex();
                if (a == null || b == null) continue;
                double[] pa = ((double[])a.GetPoint()).Select(v => v * 1000).ToArray(), pb = ((double[])b.GetPoint()).Select(v => v * 1000).ToArray();
                double[] want = { xMm, yMm, zMm };
                bool ok = true;
                for (int i = 0; i < 3; i++)
                    if (!double.IsNaN(want[i]) && (Math.Abs(pa[i] - want[i]) > 1e-3 || Math.Abs(pb[i] - want[i]) > 1e-3)) ok = false;
                if (ok) return e;
            }
            return null;
        }

        /// <summary>Reference dimension in a view between one or two entities (edges, vertices, sketch segments) with its
        /// text at (x, y) sheet mm. kind "h"/"v" for horizontal/vertical on the sheet, null for length/diameter/distance/angle.</summary>
        public IDisplayDimension RefDim(IView view, object[] entities, double xMm, double yMm, string kind)
        {
            Step("reference dimension in " + view.GetName2());
            Doc.ClearSelection2(true);
            ISelectData data = (ISelectData)((ISelectionMgr)Doc.SelectionManager).CreateSelectData();
            data.View = (View)view;
            for (int i = 0; i < entities.Length; i++)
            {
                object e = entities[i];
                bool ok = e is IEntity ? ((IEntity)e).Select4(i > 0, (SelectData)data)
                    : e is ISketchSegment ? ((ISketchSegment)e).Select4(i > 0, (SelectData)data)
                    : e is ISketchPoint ? ((ISketchPoint)e).Select4(i > 0, (SelectData)data) : false;
                if (!ok) throw new CadException("Reference dimension: entity " + i + " was not selected in " + view.GetName2());
            }
            object made = kind == "h" ? Doc.AddHorizontalDimension2(xMm * Mm, yMm * Mm, 0)
                : kind == "v" ? Doc.AddVerticalDimension2(xMm * Mm, yMm * Mm, 0) : Doc.AddDimension2(xMm * Mm, yMm * Mm, 0);
            Doc.ClearSelection2(true);
            if (made == null) throw new CadException("Reference dimension was not created in " + view.GetName2());
            IDisplayDimension dd = (IDisplayDimension)made;
            dd.ShowParenthesis = false;
            return dd;
        }

        /// <summary>Sets a text custom property (file level when configuration is "") on a part, assembly or drawing.</summary>
        public void SetProperty(IModelDoc2 doc, string name, string value, string configuration)
        {
            SetPropertyIn((ICustomPropertyManager)doc.Extension.get_CustomPropertyManager(configuration ?? ""), name, value);
            if (!string.IsNullOrEmpty(configuration)) return;
            // A configuration-specific property of the same name wins in BOMs and $PRPSHEET title blocks (starter files often
            // carry empty ones), so a file-level value alone can print blank: keep any such copies in step.
            foreach (string cfg in (string[])doc.GetConfigurationNames() ?? new string[0])
            {
                ICustomPropertyManager cm = (ICustomPropertyManager)doc.Extension.get_CustomPropertyManager(cfg);
                object names = cm.GetNames();
                if (names != null && ((string[])names).Any(n => string.Equals(n, name, StringComparison.OrdinalIgnoreCase)))
                    SetPropertyIn(cm, name, value);
            }
        }

        // Add3(Replace) returns 1 (generic failure) for some pre-existing properties of older files and leaves the old value:
        // fall back to Set2, then delete + add, and verify the stored text.
        static void SetPropertyIn(ICustomPropertyManager m, string name, string value)
        {
            int r = m.Add3(name, (int)swCustomInfoType_e.swCustomInfoText, value, (int)swCustomPropertyAddOption_e.swCustomPropertyReplaceValue);
            if (r == 0 && StoredValue(m, name) == value) return;
            m.Set2(name, value);
            if (StoredValue(m, name) == value) return;
            m.Delete2(name);
            r = m.Add3(name, (int)swCustomInfoType_e.swCustomInfoText, value, (int)swCustomPropertyAddOption_e.swCustomPropertyReplaceValue);
            if (StoredValue(m, name) != value)
                throw new CadException("Custom property " + name + " was not set (Add3 code " + r + ", stored '" + StoredValue(m, name) + "')");
        }

        static string StoredValue(ICustomPropertyManager m, string name)
        {
            string val, resolved;
            bool wasResolved, linked;
            m.Get6(name, false, out val, out resolved, out wasResolved, out linked);
            return val;
        }

        /// <summary>Title block fields after a rebuild: linked text -> shown text, for property-linked sheet-format notes.</summary>
        public Dictionary<string, string> TitleBlockText()
        {
            Doc.ForceRebuild3(false);
            Dictionary<string, string> fields = new Dictionary<string, string>();
            object[] notes = (object[])((IView)Drawing.GetFirstView()).GetNotes() ?? new object[0];
            foreach (object o in notes)
            {
                INote n = (INote)o;
                string linked = n.PropertyLinkedText ?? "";
                if (linked.Contains("$PRP") && !fields.ContainsKey(linked)) fields[linked] = n.GetText();
            }
            return fields;
        }

        /// <summary>Bill of materials (parts only, standard template unless one is given) anchored by its top left corner at
        /// (x, y) sheet mm on an assembly view. Returns the table rows, header first.</summary>
        public List<string[]> Bom(IView view, double xMm, double yMm, string templatePath)
        {
            return TableCells((ITableAnnotation)BomTable(view, xMm, yMm, templatePath));
        }

        /// <summary>Bill of materials like Bom, returning the annotation for further edits (AddBomPropertyColumn,
        /// TableCells).</summary>
        public IBomTableAnnotation BomTable(IView view, double xMm, double yMm, string templatePath)
        {
            return BomTable(view, xMm, yMm, templatePath, swBomType_e.swBomType_PartsOnly);
        }

        /// <summary>BomTable with a BOM type: swBomType_TopLevelOnly lists subassemblies as single rows (large purchased or
        /// starter subassemblies), swBomType_Indented lists them with their parts.</summary>
        public IBomTableAnnotation BomTable(IView view, double xMm, double yMm, string templatePath, swBomType_e bomType)
        {
            Step("bill of materials (" + bomType + ")");
            string template = templatePath;
            if (string.IsNullOrEmpty(template))
                template = Path.Combine(App.GetExecutablePath(), "lang", App.GetCurrentLanguage(), "bom-standard.sldbomtbt");
            IBomTableAnnotation bom = (IBomTableAnnotation)view.InsertBomTable4(false, xMm * Mm, yMm * Mm,
                (int)swBOMConfigurationAnchorType_e.swBOMConfigurationAnchor_TopLeft, (int)bomType,
                view.ReferencedConfiguration, template, false,
                bomType == swBomType_e.swBomType_Indented ? (int)swNumberingType_e.swNumberingType_Detailed : (int)swNumberingType_e.swNumberingType_None, false);
            if (bom == null) throw new CadException("No bill of materials (template " + template + ")");
            return bom;
        }

        /// <summary>Appends a BOM column filled from a component custom property (e.g. "Material", or a property whose
        /// value is the linked expression "SW-Material@Part.SLDPRT"). Returns the new column index.</summary>
        public int AddBomPropertyColumn(IBomTableAnnotation bom, string title, string property)
        {
            ITableAnnotation table = (ITableAnnotation)bom;
            int index = table.ColumnCount;
            if (!table.InsertColumn2((int)swTableItemInsertPosition_e.swTableItemInsertPosition_Last, 0, title,
                    (int)swInsertTableColumnWidthStyle_e.swInsertColumn_DefaultWidth))
                throw new CadException("BOM column " + title + " was not inserted");
            if (!bom.SetColumnCustomProperty(index, property))
                throw new CadException("BOM column " + title + ": property " + property + " was not linked");
            table.set_Text(0, index, title);
            return index;
        }

        public static List<string[]> TableCells(ITableAnnotation table)
        {
            List<string[]> rows = new List<string[]>();
            for (int r = 0; r < table.RowCount; r++)
            {
                string[] row = new string[table.ColumnCount];
                for (int c = 0; c < table.ColumnCount; c++) row[c] = table.get_Text(r, c);
                rows.Add(row);
            }
            return rows;
        }

        /// <summary>Balloons on every component of an assembly view (one per BOM item). Returns their texts.</summary>
        public List<string> AutoBalloons(IView view)
        {
            Step("auto balloons");
            IAutoBalloonOptions options = (IAutoBalloonOptions)Drawing.CreateAutoBalloonOptions();
            options.ItemOrder = (int)swBalloonItemNumbersOrder_e.swBalloonItemNumbers_FollowAssemblyOrder;
            Doc.ClearSelection2(true);
            if (!Doc.Extension.SelectByID2(view.GetName2(), "DRAWINGVIEW", 0, 0, 0, false, 0, null, 0))
                throw new CadException("View " + view.GetName2() + " was not selected for balloons");
            object made = Drawing.AutoBalloon5((AutoBalloonOptions)options);
            Doc.ClearSelection2(true);
            object[] notes = made as object[];
            if (notes == null) throw new CadException("No balloons were made in " + view.GetName2());
            return notes.Select(n => ((INote)n).GetText()).ToList();
        }

        /// <summary>One BOM balloon on a component visible in an assembly view (component Name2 such as "Kamera_Linssi-1"
        /// or its prefix "Kamera_Linssi"), placed at (x, y) sheet mm. Use it for items AutoBalloons leaves out (components
        /// hidden behind others in that view). Returns the balloon text (item number).</summary>
        public string Balloon(IView view, string component, double xMm, double yMm)
        {
            Step("balloon " + component + " in " + view.GetName2());
            object[] comps = (object[])view.GetVisibleComponents() ?? new object[0];
            // Section views name components by path ("Draw1-SectionAssembly-1-1/Kamera-1/Kamera_Runko-1"): match the last part.
            IComponent2 comp = comps.Cast<IComponent2>().FirstOrDefault(c =>
            {
                string leaf = c.Name2.Substring(c.Name2.LastIndexOf('/') + 1);
                return leaf == component || leaf.StartsWith(component + "-");
            });
            if (comp == null) throw new CadException(component + " is not visible in " + view.GetName2() + " (visible: "
                + string.Join(", ", comps.Cast<IComponent2>().Select(c => c.Name2)) + ")");
            object[] edges = (object[])view.GetVisibleEntities2((Component2)comp, (int)swViewEntityType_e.swViewEntityType_Edge) ?? new object[0];
            if (edges.Length == 0) throw new CadException(component + " has no visible edge in " + view.GetName2());
            Doc.ClearSelection2(true);
            if (!view.SelectEntity(edges[0], false)) throw new CadException(component + ": edge not selected in " + view.GetName2());
            IBalloonOptions options = (IBalloonOptions)Doc.Extension.CreateBalloonOptions();
            options.Style = (int)swBalloonStyle_e.swBS_Circular;
            options.Size = (int)swBalloonFit_e.swBF_2Chars;
            options.UpperTextContent = (int)swBalloonTextContent_e.swBalloonTextItemNumber;
            INote note = (INote)Doc.Extension.InsertBOMBalloon2((BalloonOptions)options);
            Doc.ClearSelection2(true);
            if (note == null) throw new CadException("No balloon for " + component);
            ((IAnnotation)note.GetAnnotation()).SetPosition2(xMm * Mm, yMm * Mm, 0);
            return note.GetText();
        }

        /// <summary>Sets table column widths in mm (index order; null/0 keeps a column).</summary>
        public void SetTableColumnWidths(ITableAnnotation table, double[] widthsMm)
        {
            for (int c = 0; c < widthsMm.Length && c < table.ColumnCount; c++)
                if (widthsMm[c] > 0) table.SetColumnWidth(c, widthsMm[c] * Mm, (int)swTableRowColSizeChangeBehavior_e.swTableRowColChange_TableSizeCanChange);
        }

        /// <summary>Mass in kg for title blocks: sets the model's mass unit to kilograms (3 decimals) and links its custom
        /// property "Mass" to SW-Mass. The course sheet formats print $PRPSHEET:"Mass" followed by "kg".</summary>
        public void LinkMassKg(IModelDoc2 model)
        {
            IModelDocExtension ext = model.Extension;
            ext.SetUserPreferenceInteger((int)swUserPreferenceIntegerValue_e.swUnitSystem, 0, (int)swUnitSystem_e.swUnitSystem_Custom);
            ext.SetUserPreferenceInteger((int)swUserPreferenceIntegerValue_e.swUnitsMassPropMass, 0, (int)swUnitsMassPropMass_e.swUnitsMassPropMass_Kilograms);
            ext.SetUserPreferenceInteger((int)swUserPreferenceIntegerValue_e.swUnitsMassPropDecimalPlaces, 0, 3);
            SetProperty(model, "Mass", "\"SW-Mass@" + Path.GetFileName(model.GetPathName()) + "\"", "");
        }

        /// <summary>Saves the drawing (.SLDDRW) and exports it as PDF; checks both files exist.</summary>
        public void SaveDrawing(string drawingPath, string pdfPath)
        {
            Drawing.ActivateSheet(CurrentSheet.GetName());
            SaveAs(drawingPath);
            if (!string.IsNullOrEmpty(pdfPath)) Export(pdfPath);
            if (Doc.GetSaveFlag()) SaveAs(drawingPath);
        }

        /// <summary>Views (name, type, scale, dimension count), layout problems, rebuild errors and save state of the drawing.</summary>
        public Dictionary<string, object> DrawingReport()
        {
            List<object> views = new List<object>();
            foreach (IView v in SheetViews())
                views.Add(new object[] { v.GetName2(), v.Type, Math.Round(v.ScaleDecimal, 4), ((object[])v.GetDisplayDimensions() ?? new object[0]).Length });
            IView active = (IView)Drawing.ActiveDrawingView;
            return new Dictionary<string, object> {
                { "views", views }, { "layout", DrawingLayout() }, { "sheetScale", ((double[])CurrentSheet.GetProperties2()).Skip(2).Take(2).ToArray() },
                { "activeView", active == null ? null : active.GetName2() }, { "path", Doc.GetPathName() }, { "unsaved", Doc.GetSaveFlag() },
                { "rebuildErrors", Doc.Extension.GetWhatsWrongCount() } };
        }

        // ---------------------------------------------------------------- 3D sketches

        /// <summary>Opens an empty 3D sketch (model coordinates, no plane). Close it with CloseSketch.</summary>
        public ISketch Open3DSketch()
        {
            if (Doc.SketchManager.ActiveSketch != null) throw new CadException("A sketch is already open");
            Doc.ClearSelection2(true);
            Doc.SketchManager.Insert3DSketch(true);
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null || !sketch.Is3D()) throw new CadException("No 3D sketch opened (is the document active?)");
            return sketch;
        }

        /// <summary>Straight line between model points (mm) in the open 3D sketch, placed exactly (no snapping or automatic
        /// relations). Join shared end points with Relate("sgMERGEPOINTS", ...) and orient with sgALONGX3D/sgALONGY3D/
        /// sgALONGZ3D or sgPARALLELYZ3D/sgPARALLELZX3D.</summary>
        public ISketchLine Line3D(double[] aMm, double[] bMm, bool construction)
        {
            ISketchLine line = Exact(() => (ISketchLine)Doc.SketchManager.CreateLine(aMm[0] * Mm, aMm[1] * Mm, aMm[2] * Mm, bMm[0] * Mm, bMm[1] * Mm, bMm[2] * Mm));
            if (line == null) throw new CadException("3D line was not created");
            if (construction) ((ISketchSegment)line).ConstructionGeometry = true;
            return line;
        }

        /// <summary>Open polyline through model points (mm) in a 3D sketch, end points merged. Returns the lines in order.</summary>
        public ISketchLine[] Polyline3D(params double[][] pointsMm)
        {
            ISketchLine[] lines = new ISketchLine[pointsMm.Length - 1];
            for (int i = 0; i < lines.Length; i++) lines[i] = Line3D(pointsMm[i], pointsMm[i + 1], false);
            for (int i = 0; i + 1 < lines.Length; i++) Relate("sgMERGEPOINTS", lines[i].GetEndPoint2(), lines[i + 1].GetStartPoint2());
            return lines;
        }

        /// <summary>Arc through three model points (mm): start, end and a point on the arc between them. Works in 3D sketches
        /// (the three points fix the arc's plane) and in 2D sketches.</summary>
        public ISketchArc Arc3Points(double[] startMm, double[] endMm, double[] midMm)
        {
            double[] s = SketchCoordinates(startMm), e = SketchCoordinates(endMm), m = SketchCoordinates(midMm);
            ISketchArc arc = Exact(() => (ISketchArc)Doc.SketchManager.Create3PointArc(s[0], s[1], s[2], e[0], e[1], e[2], m[0], m[1], m[2]));
            if (arc == null) throw new CadException("3-point arc was not created");
            return arc;
        }

        /// <summary>The open sketch's point (end point, centre) at a model point (mm), after merges and fillets have
        /// replaced the original objects. Throws when none lies within 1 micrometre.</summary>
        public ISketchPoint SketchPointAt(double xMm, double yMm, double zMm)
        {
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null) throw new CadException("SketchPointAt: no open sketch");
            double[] s = SketchCoordinates(new double[] { xMm, yMm, zMm });
            object[] points = (object[])sketch.GetSketchPoints2() ?? new object[0];
            foreach (object o in points)
            {
                ISketchPoint p = (ISketchPoint)o;
                if (Math.Abs(p.X - s[0]) < 1e-6 && Math.Abs(p.Y - s[1]) < 1e-6 && Math.Abs(p.Z - s[2]) < 1e-6) return p;
            }
            throw new CadException("No sketch point at (" + xMm + ", " + yMm + ", " + zMm + ") mm among " + points.Length);
        }

        /// <summary>Model point (mm) to the open sketch's own coordinates (metres, 3 values; a 3D sketch uses model space).</summary>
        public double[] SketchCoordinates(double[] modelMm)
        {
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            MathTransform t = (MathTransform)sketch.ModelToSketchTransform;
            MathPoint p = (MathPoint)MathUtil.CreatePoint(new double[] { modelMm[0] * Mm, modelMm[1] * Mm, modelMm[2] * Mm });
            if (t != null) p = (MathPoint)p.MultiplyTransform(t);
            return (double[])p.ArrayData;
        }

        /// <summary>Sketch fillet at a corner point of the open 2D or 3D sketch; the corner is kept as a virtual sharp so
        /// dimensions and relations on it survive. Returns the new arc. Add its radius with Dim or Dim3D.</summary>
        public ISketchSegment SketchFillet(ISketchPoint corner, double radiusMm)
        {
            int keep = (int)swConstrainedCornerAction_e.swConstrainedCornerKeepGeometry;
            Pick(corner);
            ISketchSegment arc = (ISketchSegment)Doc.SketchManager.CreateFillet(radiusMm * Mm, keep);
            Doc.ClearSelection2(true);
            if (arc == null)
            {
                // A sketch edited in the context of an assembly ignores a selected corner point; two selected lines work.
                List<ISketchSegment> lines = SegmentsAt(corner);
                if (lines.Count == 2)
                {
                    Step("fillet R" + radiusMm + ": corner point refused, retrying with the two lines");
                    Pick(lines[0], lines[1]);
                    arc = (ISketchSegment)Doc.SketchManager.CreateFillet(radiusMm * Mm, keep);
                    Doc.ClearSelection2(true);
                }
            }
            if (arc == null) throw new CadException("Sketch fillet R" + radiusMm + " was not created (both legs must be longer " +
                "than the tangent length; in an in-context 3D sketch use FilletedPolyline3D)");
            return arc;
        }

        /// <summary>Sketch lines of the open sketch that start or end at the given point (within 1 micrometre).</summary>
        public List<ISketchSegment> SegmentsAt(ISketchPoint point)
        {
            List<ISketchSegment> found = new List<ISketchSegment>();
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null) return found;
            foreach (object o in (object[])sketch.GetSketchSegments() ?? new object[0])
            {
                ISketchLine line = o as ISketchLine;
                if (line == null) continue;
                foreach (ISketchPoint end in new[] { (ISketchPoint)line.GetStartPoint2(), (ISketchPoint)line.GetEndPoint2() })
                {
                    double d = Math.Sqrt(Math.Pow(end.X - point.X, 2) + Math.Pow(end.Y - point.Y, 2) + Math.Pow(end.Z - point.Z, 2));
                    if (d < 1e-6) { found.Add((ISketchSegment)line); break; }
                }
            }
            return found;
        }

        /// <summary>Open 3D path through model points (mm) with every inner corner rounded by an exact tangent arc of
        /// radiusMm, built from lines and 3-point arcs with merged end points and tangent relations. Use it for pipe and
        /// wire routes, especially in a 3D sketch edited in the context of an assembly where CreateFillet can refuse.
        /// Throws when two neighbouring arcs would overlap. Returns the segments in path order.</summary>
        public List<ISketchSegment> FilletedPolyline3D(double radiusMm, params double[][] pointsMm)
        {
            int n = pointsMm.Length;
            if (n < 2) throw new CadException("FilletedPolyline3D needs at least two points");
            double[][] tIn = new double[n][], tOut = new double[n][], mid = new double[n][];
            double[] used = new double[n];
            for (int i = 1; i < n - 1; i++)
            {
                double[] a = Unit(VSub(pointsMm[i - 1], pointsMm[i])), b = Unit(VSub(pointsMm[i + 1], pointsMm[i]));
                double cos = Math.Max(-1, Math.Min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
                double theta = Math.Acos(cos);                       // angle between the two legs at the corner
                if (theta > Math.PI - 1e-6) continue;                // straight through: no arc
                double t = radiusMm / Math.Tan(theta / 2);
                used[i] = t;
                double[] bis = Unit(new[] { a[0] + b[0], a[1] + b[1], a[2] + b[2] });
                double c = radiusMm / Math.Sin(theta / 2);
                tIn[i] = VAdd(pointsMm[i], VScale(a, t));
                tOut[i] = VAdd(pointsMm[i], VScale(b, t));
                mid[i] = VAdd(pointsMm[i], VScale(bis, c - radiusMm));
            }
            for (int i = 0; i + 1 < n; i++)
            {
                double leg = VNorm(VSub(pointsMm[i + 1], pointsMm[i]));
                if (used[i] + used[i + 1] > leg + 1e-6)
                    throw new CadException("FilletedPolyline3D: leg " + i + " (" + Math.Round(leg, 2) + " mm) is shorter than its two tangent lengths (" +
                        Math.Round(used[i] + used[i + 1], 2) + " mm) at R" + radiusMm);
            }
            List<ISketchSegment> segs = new List<ISketchSegment>();
            double[] start = pointsMm[0];
            for (int i = 1; i < n; i++)
            {
                double[] end = (i < n - 1 && tIn[i] != null) ? tIn[i] : pointsMm[i];
                if (VNorm(VSub(end, start)) > 1e-6) segs.Add((ISketchSegment)Line3D(start, end, false));
                if (i < n - 1 && tIn[i] != null)
                {
                    segs.Add((ISketchSegment)Arc3Points(tIn[i], tOut[i], mid[i]));
                    start = tOut[i];
                }
                else start = pointsMm[i];
            }
            for (int i = 0; i + 1 < segs.Count; i++)
            {
                Relate("sgMERGEPOINTS", EndPointOf(segs[i]), StartPointOf(segs[i + 1]));
                if (segs[i] is ISketchArc || segs[i + 1] is ISketchArc)
                {
                    try { Relate("sgTANGENT", segs[i], segs[i + 1]); }
                    catch (CadException) { Step("tangent relation " + i + " not added (geometry is tangent by construction)"); }
                }
            }
            return segs;
        }

        ISketchPoint StartPointOf(ISketchSegment s)
        {
            return s is ISketchArc ? (ISketchPoint)((ISketchArc)s).GetStartPoint2() : (ISketchPoint)((ISketchLine)s).GetStartPoint2();
        }

        ISketchPoint EndPointOf(ISketchSegment s)
        {
            return s is ISketchArc ? (ISketchPoint)((ISketchArc)s).GetEndPoint2() : (ISketchPoint)((ISketchLine)s).GetEndPoint2();
        }

        static double[] VSub(double[] a, double[] b) { return new[] { a[0] - b[0], a[1] - b[1], a[2] - b[2] }; }
        static double[] VAdd(double[] a, double[] b) { return new[] { a[0] + b[0], a[1] + b[1], a[2] + b[2] }; }
        static double[] VScale(double[] a, double k) { return new[] { a[0] * k, a[1] * k, a[2] * k }; }
        static double VNorm(double[] a) { return Math.Sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }

        /// <summary>3D sketch plane (Sketch > Plane inside the open 3D sketch) through the given references, each with a
        /// swConstraintType_e relation (COINCIDENT = 9, PARALLEL = 7, PERPENDICULAR = 8). The ANGLE relation crashes
        /// the call on 2025 (RPC_E_SERVERFAULT): put an angle on the sketch geometry and make the plane coincident with it.</summary>
        public void SketchPlane3D(object first, int relation1, object second, int relation2)
        {
            Pick(first, second);
            bool made = Doc.SketchManager.CreateSketchPlane(relation1, relation2, 0);
            Doc.ClearSelection2(true);
            if (!made) throw new CadException("3D sketch plane was not created");
        }


        /// <summary>Swept boss of a closed profile sketch along a path sketch (2D or 3D). The profile should lie on a
        /// plane through the path's start point, normal to the path there.</summary>
        public IFeature Sweep(IFeature profileSketch, IFeature pathSketch, string name)
        {
            Doc.ClearSelection2(true);
            if (!profileSketch.Select2(false, 1)) throw new CadException(name + ": profile not selected");   // mark 1 = profile
            if (!pathSketch.Select2(true, 4)) throw new CadException(name + ": path not selected");           // mark 4 = path
            object made = Doc.FeatureManager.InsertProtrusionSwept4(false, false, (int)swTwistControlType_e.swTwistControlFollowPath,
                false, false, 0, 0, false, 0, 0, 0, 0, true, false, true, 0, true, false, 0, (int)swSweepDirection_e.swSweepDirection1);
            return Checked(made, name);
        }


        /// <summary>Spline through model points (mm) in the open 2D or 3D sketch, placed exactly. A 2-point spline is fully
        /// defined by its end points; tangent relations at the ends then shape it without adding freedom.</summary>
        public ISketchSegment Spline(params double[][] pointsMm)
        {
            double[] flat = pointsMm.SelectMany(p => SketchCoordinates(p)).ToArray();
            ISketchSegment s = Exact(() => (ISketchSegment)Doc.SketchManager.CreateSpline2(flat, false));
            if (s == null) throw new CadException("Spline was not created");
            return s;
        }

        /// <summary>Composite curve feature from sketch segments or edges (a closed or open chain): the API counterpart of
        /// a SelectionManager group, usable as a loft profile, guide curve or sweep path.</summary>
        public IFeature CompositeCurve(object[] segments, string name)
        {
            Doc.ClearSelection2(true);
            for (int i = 0; i < segments.Length; i++)
            {
                object o = segments[i];
                bool ok = o is ISketchSegment ? ((ISketchSegment)o).Select4(i > 0, null) : ((IEntity)o).Select4(i > 0, null);
                if (!ok) throw new CadException(name + ": curve " + i + " not selected");
            }
            if (!Doc.InsertCompositeCurve()) throw new CadException(name + ": composite curve was not created");
            Doc.ClearSelection2(true);
            IFeature last = Features(null).LastOrDefault();
            if (last == null || last.GetTypeName2() != "CompositeCurve") throw new CadException(name + ": no composite curve feature found");
            return Checked(last, name);
        }

        /// <summary>Surface loft through profiles with guide curves, each given as a chain of segments of one (closed) 2D or 3D
        /// sketch, as the SelectionManager's Select Group does in the UI. Loft accepts sketch contours, not loose segments,
        /// and a 3D sketch splits its contours wherever three curves meet (a guide ending on a profile), so each chain is
        /// covered by the contours made of its segments and these are selected together as one selection group
        /// (SetNextSelectionGroupId), with mark 1 for profiles and 2 for guides. Returns the loft feature.</summary>
        public IFeature LoftSurfaceFromGroups(List<object[]> profiles, List<object[]> guides, string name)
        {
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            List<string> how = new List<string>();
            int group = 1;
            foreach (List<object[]> set in new[] { profiles, guides })
            {
                int mark = set == profiles ? 1 : 2;
                foreach (object[] chain in set)
                {
                    HashSet<string> wanted = new HashSet<string>(chain.Select(EntityKey));
                    ISketch sketch = (ISketch)((ISketchSegment)chain[0]).GetSketch();
                    List<ISketchContour> all = ((object[])sketch.GetSketchContours() ?? new object[0]).Select(o => (ISketchContour)o).ToList();
                    List<ISketchContour> parts = all.Where(c => ((object[])c.GetSketchSegments() ?? new object[0]).Select(EntityKey).All(wanted.Contains)).ToList();
                    HashSet<string> covered = new HashSet<string>(parts.SelectMany(c => ((object[])c.GetSketchSegments()).Select(EntityKey)));
                    if (!covered.SetEquals(wanted))
                    {
                        string found = string.Join("; ", all.Select(c => (c.IsClosed() ? "closed " : "open ") + string.Join("+",
                            ((object[])c.GetSketchSegments() ?? new object[0]).Select(s => ((swSketchSegments_e)((ISketchSegment)s).GetType()).ToString().Replace("swSketch", "")))));
                        throw new CadException(name + ": the sketch contours do not cover exactly the " + chain.Length + " given segments; contours: " + found);
                    }
                    foreach (ISketchContour c in parts)
                    {
                        SelectData data = (SelectData)sm.CreateSelectData();
                        data.Mark = mark;
                        Doc.SetNextSelectionGroupId(group);
                        if (!c.Select2(true, data)) throw new CadException(name + ": contour of group " + group + " not selected");
                    }
                    how.Add((mark == 1 ? "profile " : "guide ") + group + ": " + parts.Count + " contour(s)");
                    group++;
                }
            }
            Note(name + ": " + string.Join(", ", how));
            Doc.InsertLoftRefSurface2(false, false, false, 1, 0, 0);
            Doc.ClearSelection2(true);
            IFeature last = Features(null).LastOrDefault();
            if (last == null || last.GetTypeName2() == "3DProfileFeature" || last.GetTypeName2() == "ProfileFeature")
                throw new CadException(name + ": no lofted surface was created (" + string.Join(", ", how) + ")");
            return Checked(last, name);
        }

        /// <summary>Convert Entities: projects sketch segments or model edges into the open sketch (On Edge relations keep them
        /// linked). Use it to turn loops of a 3D sketch into closed 2D profiles.</summary>
        public void ConvertEntities(params object[] items)
        {
            Pick(items);
            bool ok = Doc.SketchManager.SketchUseEdge3(false, false);
            Doc.ClearSelection2(true);
            if (!ok) throw new CadException("Convert Entities failed for " + items.Length + " item(s)");
        }

        /// <summary>Surface loft through profile sketches (each a closed loop) with guide curves. A guide may be a sketch feature,
        /// a sketch segment (its own contour in its sketch is selected) or an edge. Profiles get mark 1, guides mark 2.</summary>
        public IFeature LoftSurface(List<IFeature> profileSketches, List<object> guides, string name)
        {
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            foreach (IFeature p in profileSketches) if (!p.Select2(true, 1)) throw new CadException(name + ": profile " + p.Name + " not selected");
            foreach (object g in guides)
            {
                SelectData data = (SelectData)sm.CreateSelectData();
                data.Mark = 2;
                bool ok;
                if (g is IFeature) ok = ((IFeature)g).Select2(true, 2);
                else if (g is ISketchSegment)
                {
                    string key = EntityKey(g);
                    ISketch sketch = (ISketch)((ISketchSegment)g).GetSketch();
                    ISketchContour c = ((object[])sketch.GetSketchContours() ?? new object[0]).Select(o => (ISketchContour)o)
                        .FirstOrDefault(k => ((object[])k.GetSketchSegments() ?? new object[0]).Select(EntityKey).SequenceEqual(new[] { key }));
                    ok = c != null ? c.Select2(true, data) : ((ISketchSegment)g).Select4(true, data);
                }
                else ok = ((IEntity)g).Select4(true, data);
                if (!ok) throw new CadException(name + ": guide not selected");
            }
            int before = Features(null).Count;
            Doc.InsertLoftRefSurface2(false, false, false, 1, 0, 0);
            Doc.ClearSelection2(true);
            List<IFeature> after = Features(null);
            if (after.Count <= before) throw new CadException(name + ": no lofted surface was created");
            return Checked(after.Last(), name);
        }

        /// <summary>Every point of the open sketch at a model point (mm): end points of different entities until merged.</summary>
        public List<ISketchPoint> SketchPointsAt(double xMm, double yMm, double zMm)
        {
            ISketch sketch = (ISketch)Doc.GetActiveSketch2();
            if (sketch == null) throw new CadException("SketchPointsAt: no open sketch");
            double[] s = SketchCoordinates(new double[] { xMm, yMm, zMm });
            object[] points = (object[])sketch.GetSketchPoints2() ?? new object[0];
            return points.Select(o => (ISketchPoint)o).Where(p => Math.Abs(p.X - s[0]) < 1e-6 && Math.Abs(p.Y - s[1]) < 1e-6 && Math.Abs(p.Z - s[2]) < 1e-6).ToList();
        }

        /// <summary>Merges all sketch points at each given model point (mm) into one, joining the entities that end there.</summary>
        public void MergePointsAt(params double[][] pointsMm)
        {
            foreach (double[] p in pointsMm)
            {
                List<ISketchPoint> here = SketchPointsAt(p[0], p[1], p[2]);
                int guard = 0;
                while (here.Count > 1 && guard++ < 20)
                {
                    // Some points cannot merge (an ellipse's axis point lying on an end point, for example): try the
                    // other pairs and stop when no merge reduces the count, instead of looping forever.
                    bool merged = false;
                    for (int i = 0; i < here.Count && !merged; i++)
                        for (int j = i + 1; j < here.Count && !merged; j++)
                        {
                            Relate("sgMERGEPOINTS", here[i], here[j]);
                            List<ISketchPoint> now = SketchPointsAt(p[0], p[1], p[2]);
                            if (now.Count < here.Count) { here = now; merged = true; }
                        }
                    if (!merged) { Step("points at " + string.Join(",", p) + " left unmerged: " + here.Count); break; }
                }
            }
        }

        /// <summary>Swept boss with the circular-profile option (no profile sketch) along a path sketch. thinMm > 0
        /// makes a tube of that wall: inside the diameter when thinInward, else outside.</summary>
        public IFeature SweepCircle(IFeature pathSketch, double diameterMm, double thinMm, bool thinInward, string name)
        {
            Doc.ClearSelection2(true);
            if (!pathSketch.Select2(false, 4)) throw new CadException(name + ": path not selected");   // mark 4 = path
            bool thin = thinMm > 0;
            object made = Doc.FeatureManager.InsertProtrusionSwept4(false, false, (int)swTwistControlType_e.swTwistControlFollowPath,
                false, false, 0, 0, thin, thin ? thinMm * Mm : 0, 0,
                thinInward ? (int)swThinWallType_e.swThinWallOppDirection : (int)swThinWallType_e.swThinWallOneDirection,
                0, true, false, true, 0, true, true, diameterMm * Mm, (int)swSweepDirection_e.swSweepDirection1);
            return Checked(made, name);
        }


        /// <summary>Boss from a sketch. depth2Mm with both=true extrudes the second direction; reverse flips direction 1.</summary>
        public IFeature Extrude(IFeature sketch, string name, double depthMm, bool reverse, bool both, double depth2Mm)
        {
            return Extrude(sketch, name, depthMm, reverse, both, depth2Mm, true);
        }

        /// <summary>Extrude with an explicit merge choice. merge=false makes a separate solid body (reference envelopes,
        /// keep-out volumes, multibody parts); merge=true joins every body the new solid touches.</summary>
        public IFeature Extrude(IFeature sketch, string name, double depthMm, bool reverse, bool both, double depth2Mm, bool merge)
        {
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            object f = Doc.FeatureManager.FeatureExtrusion3(!both, false, reverse,
                (int)swEndConditions_e.swEndCondBlind, (int)swEndConditions_e.swEndCondBlind, depthMm * Mm, depth2Mm * Mm,
                false, false, false, false, 0, 0, false, false, false, false, merge, merge, merge,
                (int)swStartConditions_e.swStartSketchPlane, 0, false);
            return Checked(f, name);
        }

        /// <summary>Blind boss of depthMm from a sketch toward a model point (mm): the direction along the sketch normal
        /// whose side holds towardMm. For sketches on reference planes whose normal sign is not obvious (a plane through a
        /// line, perpendicular to an edge, or at an angle), where Extrude(reverse) would be a guess. Verified: the solid
        /// must reach depthMm from the sketch plane toward the point, else the direction is flipped once.</summary>
        public IFeature ExtrudeToward(IFeature sketch, string name, double depthMm, double[] towardMm)
        {
            ISketch sk = (ISketch)sketch.GetSpecificFeature2();
            MathTransform toModel = (MathTransform)((MathTransform)sk.ModelToSketchTransform).Inverse();
            double[] o = (double[])((MathPoint)((MathPoint)MathUtil.CreatePoint(new double[] { 0, 0, 0 })).MultiplyTransform(toModel)).ArrayData;
            double[] n = (double[])((MathVector)((MathVector)MathUtil.CreateVector(new double[] { 0, 0, 1 })).MultiplyTransform(toModel)).ArrayData;
            double len = Math.Sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
            for (int i = 0; i < 3; i++) n[i] /= len;
            double along = (towardMm[0] * Mm - o[0]) * n[0] + (towardMm[1] * Mm - o[1]) * n[1] + (towardMm[2] * Mm - o[2]) * n[2];
            if (Math.Abs(along) < 1e-9) throw new CadException(name + ": the toward point lies on the sketch plane");
            bool reverse = along < 0;
            for (int attempt = 0; attempt < 2; attempt++)
            {
                double s = reverse ? -1 : 1;
                double[] dir = { s * n[0], s * n[1], s * n[2] };
                double planeAlong = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
                IFeature f = Extrude(sketch, name, depthMm, reverse, false, 0);
                double reach = double.MinValue;
                foreach (IBody2 b in Bodies())
                {
                    double x, y, z;
                    if (b.GetExtremePoint(dir[0], dir[1], dir[2], out x, out y, out z))
                        reach = Math.Max(reach, x * dir[0] + y * dir[1] + z * dir[2]);
                }
                if (reach >= planeAlong + depthMm * Mm * 0.999) return f;
                Step(name + ": extrusion went away from the toward point, flipping");
                Delete(f);
                sketch = Feature(sketch.Name);
                reverse = !reverse;
            }
            throw new CadException(name + ": neither direction reached " + depthMm + " mm toward the point");
        }

        /// <summary>Cut from a sketch; depthMm &lt;= 0 means through all. alongNormal true/false cuts that way and fails if nothing
        /// was removed. alongNormal null tries BOTH directions: it keeps the only one that removes material and throws when
        /// both do (a sketch inside or between walls), so a wrong wall is never cut silently. Then pass the direction, or
        /// use CutExpecting with the volume the cut should remove. The cut applies to every body it reaches.</summary>
        public IFeature Cut(IFeature sketch, string name, double depthMm, bool? alongNormal)
        {
            if (alongNormal.HasValue)
            {
                double before = VolumeMm3();
                IFeature f = TryCut(sketch, depthMm, alongNormal.Value);
                if (f == null) throw new CadException(name + ": cut failed in the requested direction");
                if (VolumeMm3() > before - 1e-6)
                {
                    Delete(f);
                    throw new CadException(name + ": cut removed no material in the requested direction");
                }
                return Checked(f, name);
            }
            double[] removed = TrialCuts(sketch, depthMm);
            // Only floating-point noise is ignored. A small but real removal on the other side usually means the sketch plane
            // lies a few micrometres inside a face that is not exactly planar (swept or lofted B-spline faces): cutting from
            // there leaves a skin over the cut on that side. Cut from a plane inside the body with CutThroughBoth, or start
            // the sketch clearly outside the face.
            bool first = removed[0] > 1e-4, second = removed[1] > 1e-4;
            if (first && second)
                throw new CadException(name + ": material on both sides of the sketch (removes " + Math.Round(removed[0], 3) + " mm3 along the normal, "
                    + Math.Round(removed[1], 3) + " mm3 against it); pass alongNormal or use CutExpecting. A tiny amount on one side is a skin: " +
                    "the face is not exactly on the sketch plane, so cut with CutThroughBoth from inside the body instead");
            if (!first && !second) throw new CadException(name + ": cut removed no material in either direction");
            return Checked(TryCut(sketch, depthMm, first), name);
        }



        /// <summary>Through-all cut in both directions from a sketch plane inside the body (a mid-plane): the clean way to make
        /// a hole through a part whose outer faces are not exactly planar. Checks that material was removed.</summary>
        public IFeature CutThroughBoth(IFeature sketch, string name)
        {
            Doc.EditRebuild3();
            double before = VolumeMm3();
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            int all = (int)swEndConditions_e.swEndCondThroughAll;
            IFeature f = (IFeature)Doc.FeatureManager.FeatureCut4(false, false, false, all, all, 0.01, 0.01,
                false, false, false, false, 0, 0, false, false, false, false, false, true, true, true, true, false,
                (int)swStartConditions_e.swStartSketchPlane, 0, false, false);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (VolumeMm3() > before - 1e-6) throw new CadException(name + ": cut removed no material");
            return made;
        }

        /// <summary>Blind (depthMm > 0) or through-all cut with a draft: inward narrows the cut with depth (a countersink
        /// cone from a circle on the face), outward widens it. Direction as in Cut: alongNormal true cuts along the sketch
        /// normal. Checks that material was removed.</summary>
        public IFeature CutDrafted(IFeature sketch, string name, double depthMm, bool alongNormal, double draftDeg, bool outward)
        {
            Doc.EditRebuild3();
            double before = VolumeMm3();
            int end = depthMm > 0 ? (int)swEndConditions_e.swEndCondBlind : (int)swEndConditions_e.swEndCondThroughAll;
            double depth = depthMm > 0 ? depthMm * Mm : 0.01;
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            IFeature f = (IFeature)Doc.FeatureManager.FeatureCut4(true, false, alongNormal, end, end, depth, depth,
                true, false, outward, false, draftDeg * Math.PI / 180, 0, false, false, false, false, false, true, true, true, true, false,
                (int)swStartConditions_e.swStartSketchPlane, 0, false, false);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (VolumeMm3() > before - 1e-6) throw new CadException(name + ": drafted cut removed no material (wrong direction?)");
            return made;
        }

        /// <summary>Boss extrusion with a draft angle (inward tapers the walls toward the far end), blind depth, along the
        /// sketch normal unless reverse.</summary>
        public IFeature ExtrudeDrafted(IFeature sketch, string name, double depthMm, bool reverse, double draftDeg, bool outward)
        {
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            object f = Doc.FeatureManager.FeatureExtrusion3(true, false, reverse, (int)swEndConditions_e.swEndCondBlind, 0, depthMm * Mm, 0,
                true, false, outward, false, draftDeg * Math.PI / 180, 0, false, false, false, false, true, true, true,
                (int)swStartConditions_e.swStartSketchPlane, 0, false);
            return Checked(f, name);
        }

        /// <summary>Cut whose direction is chosen by the material it must remove: tries both directions and keeps the one whose
        /// removed volume is expectedRemovedMm3 within toleranceMm3. Use for holes through a specific wall or tab.</summary>
        public IFeature CutExpecting(IFeature sketch, string name, double depthMm, double expectedRemovedMm3, double toleranceMm3)
        {
            double[] removed = TrialCuts(sketch, depthMm);
            for (int k = 0; k < 2; k++)
                if (Math.Abs(removed[k] - expectedRemovedMm3) <= toleranceMm3) return Checked(TryCut(sketch, depthMm, k == 0), name);
            throw new CadException(name + ": neither direction removes " + expectedRemovedMm3 + " mm3 (along the normal " + Math.Round(removed[0], 3)
                + ", against it " + Math.Round(removed[1], 3) + ")");
        }

        double[] TrialCuts(IFeature sketch, double depthMm)
        {
            double[] removed = new double[2];
            double before = VolumeMm3();
            for (int k = 0; k < 2; k++)
            {
                IFeature f = TryCut(sketch, depthMm, k == 0);
                if (f == null) continue;
                removed[k] = before - VolumeMm3();
                Delete(f);
            }
            return removed;
        }

        IFeature TryCut(IFeature sketch, double depthMm, bool dir)
        {
            int end = depthMm > 0 ? (int)swEndConditions_e.swEndCondBlind : (int)swEndConditions_e.swEndCondThroughAll;
            double depth = depthMm > 0 ? depthMm * Mm : 0.01;
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException("cut sketch not selected");
            IFeature f = (IFeature)Doc.FeatureManager.FeatureCut4(true, false, dir, end, end, depth, depth,
                false, false, false, false, 0, 0, false, false, false, false, false, true, true, true, true, false,
                (int)swStartConditions_e.swStartSketchPlane, 0, false, false);
            Doc.ClearSelection2(true);
            if (f == null) return null;
            bool isWarning;
            int code = f.GetErrorCode2(out isWarning);
            if (code != 0 && !isWarning)
            {
                Delete(f);
                return null;
            }
            return f;
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


        /// <summary>Edges of a body whose two faces meet at more than minAngleDeg: the edges a fillet or chamfer can take.
        /// Excludes the smooth seams between tangent faces (sweep segments, faces split at tangent joins), which fail
        /// when selected for a fillet.</summary>
        public List<IEdge> SharpEdges(IBody2 body, double minAngleDeg)
        {
            List<IEdge> sharp = new List<IEdge>();
            foreach (object o in (object[])body.GetEdges() ?? new object[0])
            {
                IEdge edge = (IEdge)o;
                object[] faces = (object[])edge.GetTwoAdjacentFaces2();
                if (faces == null || faces.Length < 2 || faces[0] == null || faces[1] == null) { sharp.Add(edge); continue; }
                ICurveParamData range = (ICurveParamData)edge.GetCurveParams3();
                double[] at = (double[])((ICurve)edge.GetCurve()).Evaluate2((range.UMinValue + range.UMaxValue) / 2, 0);
                double[][] normals = faces.Select(f =>
                {
                    double[] ev = (double[])((ISurface)((IFace2)f).GetSurface()).EvaluateAtPoint(at[0], at[1], at[2]);
                    return ev == null ? null : new double[] { ev[3], ev[4], ev[5] };
                }).ToArray();
                if (normals[0] == null || normals[1] == null) { sharp.Add(edge); continue; }
                double dot = normals[0].Zip(normals[1], (a, b) => a * b).Sum();
                double len = Math.Sqrt(normals[0].Sum(v => v * v) * normals[1].Sum(v => v * v));
                double angle = Math.Acos(Math.Min(1, Math.Abs(dot) / len)) * 180 / Math.PI;
                if (angle > minAngleDeg) sharp.Add(edge);
            }
            return sharp;
        }

        /// <summary>One line per face of a body: index, surface kind, area, bounding box and (planar faces) the outward
        /// normal. Use it to find faces on non-prismatic bodies (sweeps, revolves, drafted extrudes) before picking them
        /// with FaceAt or by index.</summary>
        public List<Dictionary<string, object>> FaceReport(IBody2 body)
        {
            List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
            object[] faces = (object[])body.GetFaces() ?? new object[0];
            for (int i = 0; i < faces.Length; i++)
            {
                IFace2 face = (IFace2)faces[i];
                ISurface surface = (ISurface)face.GetSurface();
                double[] box = (double[])face.GetBox();
                Dictionary<string, object> row = new Dictionary<string, object>();
                row["index"] = i;
                row["kind"] = SurfaceKind(surface.Identity());
                row["areaMm2"] = Math.Round(face.GetArea() * 1e6, 1);
                row["boxMm"] = box.Select(v => Math.Round(v * 1000, 2)).ToArray();
                if (surface.IsPlane())
                {
                    double[] n = (double[])face.Normal;
                    row["normal"] = n.Select(v => Math.Round(v, 4)).ToArray();
                }
                row["edges"] = face.GetEdgeCount();
                rows.Add(row);
            }
            return rows;
        }

        static string SurfaceKind(int identity)
        {
            switch (identity)
            {
                case 4001: return "plane";
                case 4002: return "cylinder";
                case 4003: return "cone";
                case 4004: return "sphere";
                case 4005: return "torus";
                case 4006: return "bspline";
                case 4007: return "blend";
                case 4008: return "offset";
                case 4009: return "extrusion";
                case 4010: return "revolution";
                default: return "type" + identity;
            }
        }

        /// <summary>The face of the body nearest to a model point (mm), any surface type. Throws when the nearest face is
        /// farther than toleranceMm, so a wrong guess fails loudly instead of selecting a neighbouring face.</summary>
        public IFace2 FaceAt(IBody2 body, double xMm, double yMm, double zMm, double toleranceMm)
        {
            IFace2 best = null;
            double bestDistance = double.MaxValue;
            foreach (object o in (object[])body.GetFaces() ?? new object[0])
            {
                IFace2 face = (IFace2)o;
                double[] p = (double[])face.GetClosestPointOn(xMm / 1000, yMm / 1000, zMm / 1000);
                if (p == null) continue;
                double d = Math.Sqrt(Math.Pow(p[0] * 1000 - xMm, 2) + Math.Pow(p[1] * 1000 - yMm, 2) + Math.Pow(p[2] * 1000 - zMm, 2));
                if (d < bestDistance) { bestDistance = d; best = face; }
            }
            if (best == null || bestDistance > toleranceMm)
                throw new CadException(string.Format(CultureInfo.InvariantCulture,
                    "No face within {0} mm of ({1}, {2}, {3}); nearest is {4:0.###} mm away", toleranceMm, xMm, yMm, zMm, bestDistance));
            return best;
        }

        /// <summary>All edges bounding the given faces, without duplicates. With excludeShared, edges that lie between two
        /// of the given faces are left out: the outer boundary of a face group (for example the front of a body split by a
        /// parting line), which is what a fillet around that group needs.</summary>
        public List<IEdge> FaceEdges(IEnumerable<IFace2> faces, bool excludeShared)
        {
            List<IFace2> group = faces.ToList();
            List<IEdge> edges = new List<IEdge>();
            foreach (IFace2 face in group)
            {
                foreach (object o in (object[])face.GetEdges() ?? new object[0])
                {
                    IEdge edge = (IEdge)o;
                    if (edges.Any(e => SameEntity(e, edge))) continue;
                    if (excludeShared)
                    {
                        object[] adjacent = (object[])edge.GetTwoAdjacentFaces2() ?? new object[0];
                        int inside = adjacent.Count(a => a != null && group.Any(g => SameEntity(g, a)));
                        if (inside >= 2) continue;
                    }
                    edges.Add(edge);
                }
            }
            return edges;
        }

        /// <summary>Length of a model edge in mm.</summary>
        public double EdgeLengthMm(IEdge edge)
        {
            ICurveParamData range = (ICurveParamData)edge.GetCurveParams3();
            return ((ICurve)edge.GetCurve()).GetLength3(range.UMinValue, range.UMaxValue) * 1000;
        }

        /// <summary>Edges shared by two faces (where they meet).</summary>
        public List<IEdge> SharedEdges(IFace2 a, IFace2 b)
        {
            List<IEdge> shared = new List<IEdge>();
            foreach (object o in (object[])a.GetEdges() ?? new object[0])
            {
                object[] adjacent = (object[])((IEdge)o).GetTwoAdjacentFaces2() ?? new object[0];
                if (adjacent.Any(f => SameEntity(f, b))) shared.Add((IEdge)o);
            }
            return shared;
        }

        /// <summary>Faces next to a face (sharing at least one edge).</summary>
        public List<IFace2> AdjacentFaces(IFace2 face)
        {
            List<IFace2> found = new List<IFace2>();
            foreach (object o in (object[])face.GetEdges() ?? new object[0])
                foreach (object f in (object[])((IEdge)o).GetTwoAdjacentFaces2() ?? new object[0])
                    if (f != null && !SameEntity(f, face) && !found.Any(g => SameEntity(g, f))) found.Add((IFace2)f);
            return found;
        }

        /// <summary>Offset Entities in the open sketch: offsets model edges, faces (their loops) or sketch segments by
        /// offsetMm with the offset dimension. SOLIDWORKS picks the side from the sign, which depends on the loop direction,
        /// so both sides are made and the one whose total length is shorter (inward) or longer (outward) is kept.
        /// Returns the new segments.</summary>
        public List<ISketchSegment> OffsetEntities(object[] items, double offsetMm, bool inward)
        {
            ISketch sketch = Doc.SketchManager.ActiveSketch;
            if (sketch == null) throw new CadException("OffsetEntities: no sketch is open");
            if (items.Any(i => !(i is ISketchSegment)))
            {
                // Offset of model edges fails when they are not planar or not parallel to the sketch plane (edges of
                // drafted, filleted or curved faces). Convert Entities projects them; the projection is offset and kept
                // as construction geometry, like the "construction base geometry" option in the PropertyManager.
                List<object> before = ((object[])sketch.GetSketchSegments() ?? new object[0]).ToList();
                try
                {
                    List<ISketchSegment> direct = OffsetEntitiesOf(sketch, items, offsetMm, inward);
                    return direct;
                }
                catch (CadException)
                {
                    ConvertEntities(items);
                    List<ISketchSegment> projected = ((object[])sketch.GetSketchSegments() ?? new object[0])
                        .Where(o => !before.Any(b => SameEntity(b, o))).Cast<ISketchSegment>().ToList();
                    if (projected.Count == 0) throw new CadException("OffsetEntities: Convert Entities projected nothing");
                    List<ISketchSegment> offset = OffsetEntitiesOf(sketch, projected.Cast<object>().ToArray(), offsetMm, inward);
                    foreach (ISketchSegment s in projected) s.ConstructionGeometry = true;
                    return offset;
                }
            }
            return OffsetEntitiesOf(sketch, items, offsetMm, inward);
        }

        List<ISketchSegment> OffsetEntitiesOf(ISketch sketch, object[] items, double offsetMm, bool inward)
        {
            List<ISketchSegment> plus = OffsetOnce(sketch, items, offsetMm);
            List<ISketchSegment> minus;
            try
            {
                minus = OffsetOnce(sketch, items, -offsetMm);
            }
            catch (CadException)
            {
                DeleteSegments(plus);
                throw;
            }
            double plusLength = plus.Sum(s => s.GetLength()), minusLength = minus.Sum(s => s.GetLength());
            bool keepPlus = inward ? plusLength < minusLength : plusLength > minusLength;
            List<ISketchSegment> keep = keepPlus ? plus : minus, drop = keepPlus ? minus : plus;
            DeleteSegments(drop);
            Step(string.Format(CultureInfo.InvariantCulture, "offset {0} items by {1} mm {2}: {3} segments", items.Length, offsetMm,
                inward ? "inward" : "outward", keep.Count));
            return keep;
        }

        void DeleteSegments(List<ISketchSegment> segments)
        {
            if (segments.Count == 0) return;
            Doc.ClearSelection2(true);
            for (int i = 0; i < segments.Count; i++) segments[i].Select4(i > 0, null);
            bool ok = Doc.Extension.DeleteSelection2((int)swDeleteSelectionOptions_e.swDelete_Absorbed);
            Doc.ClearSelection2(true);
            if (!ok) throw new CadException("Could not delete " + segments.Count + " sketch segment(s)");
        }

        List<ISketchSegment> OffsetOnce(ISketch sketch, object[] items, double offsetMm)
        {
            List<object> before = ((object[])sketch.GetSketchSegments() ?? new object[0]).ToList();
            Doc.ClearSelection2(true);
            for (int i = 0; i < items.Length; i++)
            {
                bool selected = items[i] is ISketchSegment ? ((ISketchSegment)items[i]).Select4(i > 0, null) : ((IEntity)items[i]).Select4(i > 0, null);
                if (!selected) throw new CadException("OffsetEntities: item " + i + " was not selected");
            }
            bool ok = Doc.SketchManager.SketchOffset2(offsetMm * Mm, false, false, (int)swSkOffsetCapEndType_e.swSkOffsetNoCaps,
                (int)swSkOffsetMakeConstructionType_e.swSkOffsetDontMakeConstruction, true);
            Doc.ClearSelection2(true);
            if (!ok) throw new CadException("OffsetEntities: SketchOffset2 failed for " + offsetMm + " mm (offset larger than a radius in the loop?)");
            List<ISketchSegment> made = new List<ISketchSegment>();
            foreach (object o in (object[])sketch.GetSketchSegments() ?? new object[0])
                if (!before.Any(b => SameEntity(b, o))) made.Add((ISketchSegment)o);
            if (made.Count == 0) throw new CadException("OffsetEntities: no segments were created");
            return made;
        }

        /// <summary>Cut from a mid-plane sketch in both directions: depth1Mm along the sketch normal and depth2Mm against
        /// it (0 = through all). Use it where a feature crosses the sketch plane, for example an opening in a wall that
        /// bulges through the plane, when through-all would also cut the far side. Checks that material was removed.</summary>
        public IFeature CutBothDirections(IFeature sketch, string name, double depth1Mm, double depth2Mm)
        {
            Doc.EditRebuild3();
            double before = VolumeMm3();
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            int end1 = depth1Mm > 0 ? (int)swEndConditions_e.swEndCondBlind : (int)swEndConditions_e.swEndCondThroughAll;
            int end2 = depth2Mm > 0 ? (int)swEndConditions_e.swEndCondBlind : (int)swEndConditions_e.swEndCondThroughAll;
            IFeature f = (IFeature)Doc.FeatureManager.FeatureCut4(false, false, false, end1, end2,
                depth1Mm > 0 ? depth1Mm * Mm : 0.01, depth2Mm > 0 ? depth2Mm * Mm : 0.01,
                false, false, false, false, 0, 0, false, false, false, false, false, true, true, true, true, false,
                (int)swStartConditions_e.swStartSketchPlane, 0, false, false);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (VolumeMm3() > before - 1e-6) throw new CadException(name + ": cut removed no material");
            return made;
        }

        // ------------------------------------------------------------------ DXF/DWG import

        /// <summary>Imports a DXF/DWG file as a sketch on a plane (Insert > DXF/DWG, 2D sketch, millimetres) and returns
        /// the sketch feature. The import keeps the file's own origin: move the entities afterwards (SketchSegmentsIn +
        /// MoveSketchEntities) to put a view on the part origin.</summary>
        public IFeature InsertDxf(object plane, string path, bool addConstraints, string name)
        {
            if (!File.Exists(path)) throw new CadException("DXF/DWG file not found: " + path);
            IImportDxfDwgData data = (IImportDxfDwgData)App.GetImportFileData(path);
            if (data == null) throw new CadException("GetImportFileData returned nothing for " + path);
            data.set_ImportMethod("", (int)swImportDxfDwg_ImportMethod_e.swImportDxfDwg_ImportToExistingPart);
            data.set_LengthUnit("", (int)swLengthUnit_e.swMM);
            data.set_AddSketchConstraints("", addConstraints);
            data.SetMergePoints("", true, 1e-6);
            Doc.ClearSelection2(true);
            bool selected = plane is IFeature ? ((IFeature)plane).Select2(false, 0) : ((IEntity)plane).Select4(false, null);
            if (!selected) throw new CadException("InsertDxf: plane was not selected");
            IFeature f = Doc.FeatureManager.InsertDwgOrDxfFile2(path, data);
            Doc.ClearSelection2(true);
            if (f == null) throw new CadException("InsertDwgOrDxfFile2 failed for " + path);
            if (name != null) f.Name = name;
            Step("imported " + Path.GetFileName(path) + " as " + f.Name);
            return f;
        }

        /// <summary>Segments of a sketch lying entirely inside a box in that sketch's own coordinates (mm). Use it to
        /// pick one view out of an imported multi-view drawing.</summary>
        public List<ISketchSegment> SketchSegmentsIn(IFeature sketchFeature, double minXMm, double minYMm, double maxXMm, double maxYMm)
        {
            ISketch sketch = (ISketch)sketchFeature.GetSpecificFeature2();
            List<ISketchSegment> inside = new List<ISketchSegment>();
            foreach (object o in (object[])sketch.GetSketchSegments() ?? new object[0])
            {
                double[] box = SegmentBoxMm((ISketchSegment)o);
                if (box[0] >= minXMm - 1e-6 && box[1] >= minYMm - 1e-6 && box[2] <= maxXMm + 1e-6 && box[3] <= maxYMm + 1e-6)
                    inside.Add((ISketchSegment)o);
            }
            return inside;
        }

        /// <summary>Bounding box {minX, minY, maxX, maxY} of a sketch segment in sketch coordinates (mm), from its end
        /// points and, for arcs, the circle's extreme points that lie on the arc.</summary>
        public double[] SegmentBoxMm(ISketchSegment segment)
        {
            List<double[]> pts = new List<double[]>();
            if (segment is ISketchLine)
            {
                ISketchLine l = (ISketchLine)segment;
                ISketchPoint a = (ISketchPoint)l.GetStartPoint2(), b = (ISketchPoint)l.GetEndPoint2();
                pts.Add(new[] { a.X, a.Y });
                pts.Add(new[] { b.X, b.Y });
            }
            else if (segment is ISketchArc)
            {
                ISketchArc arc = (ISketchArc)segment;
                ISketchPoint a = (ISketchPoint)arc.GetStartPoint2(), b = (ISketchPoint)arc.GetEndPoint2(), c = (ISketchPoint)arc.GetCenterPoint2();
                double r = arc.GetRadius();
                pts.Add(new[] { a.X, a.Y });
                pts.Add(new[] { b.X, b.Y });
                bool full = Math.Abs(a.X - b.X) < 1e-12 && Math.Abs(a.Y - b.Y) < 1e-12;
                double start = Math.Atan2(a.Y - c.Y, a.X - c.X), end = Math.Atan2(b.Y - c.Y, b.X - c.X);
                if (arc.GetRotationDir() < 0) { double t = start; start = end; end = t; }
                for (int k = 0; k < 4; k++)
                {
                    double ang = k * Math.PI / 2;
                    double sweep = end - start; while (sweep <= 0) sweep += 2 * Math.PI;
                    double rel = ang - start; while (rel < 0) rel += 2 * Math.PI;
                    if (full || rel <= sweep) pts.Add(new[] { c.X + r * Math.Cos(ang), c.Y + r * Math.Sin(ang) });
                }
            }
            else
            {
                // Splines and ellipses: sample the curve. Segments without a curve (imported text strokes, points)
                // get a NaN box, which no box test accepts.
                ICurve curve = (ICurve)segment.GetCurve();
                if (curve == null) return new[] { double.NaN, double.NaN, double.NaN, double.NaN };
                double s0, s1; bool closed, periodic;
                curve.GetEndParams(out s0, out s1, out closed, out periodic);
                for (int k = 0; k <= 24; k++)
                {
                    double[] p = (double[])curve.Evaluate2(s0 + (s1 - s0) * k / 24, 0);
                    if (p != null) pts.Add(new[] { p[0], p[1] });
                }
                if (pts.Count == 0) return new[] { double.NaN, double.NaN, double.NaN, double.NaN };
            }
            return new[] { pts.Min(p => p[0]) * 1000, pts.Min(p => p[1]) * 1000, pts.Max(p => p[0]) * 1000, pts.Max(p => p[1]) * 1000 };
        }

        /// <summary>Moves sketch segments in the open sketch by (dx, dy) sketch mm (Move Entities, relations kept).</summary>
        public void MoveSketchEntities(List<ISketchSegment> segments, double dxMm, double dyMm)
        {
            if (segments.Count == 0) return;
            Doc.ClearSelection2(true);
            for (int i = 0; i < segments.Count; i++)
                if (!segments[i].Select4(i > 0, null)) throw new CadException("MoveSketchEntities: segment " + i + " not selected");
            double[] before = SegmentBoxMm(segments[0]);
            Doc.Extension.MoveOrCopy(false, 1, true, 0, 0, 0, dxMm * Mm, dyMm * Mm, 0);
            Doc.ClearSelection2(true);
            double[] after = SegmentBoxMm(segments[0]);
            if (Math.Abs(after[0] - before[0] - dxMm) > 1e-3 || Math.Abs(after[1] - before[1] - dyMm) > 1e-3)
                throw new CadException(string.Format(CultureInfo.InvariantCulture,
                    "MoveSketchEntities moved by ({0:0.###}, {1:0.###}) instead of ({2}, {3})", after[0] - before[0], after[1] - before[1], dxMm, dyMm));
        }

        /// <summary>Mirrors sketch segments of the open sketch about a sketch axis through the sketch origin (aboutY: the
        /// vertical axis x = 0, otherwise the horizontal axis y = 0) and deletes the originals. Turns a view drawn from the
        /// left into the view from the right, as the 2D to 3D tool's "Left" does.</summary>
        public List<ISketchSegment> MirrorSketchEntities(List<ISketchSegment> segments, bool aboutY)
        {
            ISketch sketch = Doc.SketchManager.ActiveSketch;
            if (sketch == null) throw new CadException("MirrorSketchEntities: no sketch is open");
            double[][] boxes = segments.Select(SegmentBoxMm).ToArray();
            double reach = boxes.Max(b => b.Select(Math.Abs).Max()) + 10;
            bool add = Doc.SketchManager.AddToDB;
            Doc.SketchManager.AddToDB = true;
            ISketchSegment axis;
            try
            {
                axis = aboutY ? (ISketchSegment)Doc.SketchManager.CreateCenterLine(0, -reach * Mm, 0, 0, reach * Mm, 0)
                              : (ISketchSegment)Doc.SketchManager.CreateCenterLine(-reach * Mm, 0, 0, reach * Mm, 0, 0);
            }
            finally
            {
                Doc.SketchManager.AddToDB = add;
            }
            if (axis == null) throw new CadException("MirrorSketchEntities: centreline was not created");
            List<object> before = ((object[])sketch.GetSketchSegments() ?? new object[0]).ToList();
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            SelectData one = (SelectData)sm.CreateSelectData();
            one.Mark = 1;
            SelectData two = (SelectData)sm.CreateSelectData();
            two.Mark = 2;
            foreach (ISketchSegment s in segments) s.Select4(true, one);
            axis.Select4(true, two);
            Doc.SketchMirror();
            Doc.ClearSelection2(true);
            List<ISketchSegment> mirrored = ((object[])sketch.GetSketchSegments() ?? new object[0])
                .Where(o => !before.Any(b => SameEntity(b, o))).Cast<ISketchSegment>().ToList();
            if (mirrored.Count != segments.Count)
                throw new CadException("MirrorSketchEntities: made " + mirrored.Count + " copies of " + segments.Count + " segments");
            DeleteSegments(segments);
            DeleteSegments(new List<ISketchSegment> { axis });
            Step("mirrored " + mirrored.Count + " segments about the sketch " + (aboutY ? "y" : "x") + " axis");
            return mirrored;
        }

        /// <summary>Opens an existing sketch for editing.</summary>
        public ISketch EditSketch(IFeature sketchFeature)
        {
            if (Doc.SketchManager.ActiveSketch != null) throw new CadException("EditSketch: a sketch is already open");
            Doc.ClearSelection2(true);
            if (!Doc.Extension.SelectByID2(sketchFeature.Name, "SKETCH", 0, 0, 0, false, 0, null, 0) && !sketchFeature.Select2(false, 0))
                throw new CadException("EditSketch: " + sketchFeature.Name + " not selected");
            Doc.EditSketch();
            ISketch active = Doc.SketchManager.ActiveSketch;
            if (active == null)
            {
                // IModelDoc2.EditSketch does nothing for some sketches (imported DXF sketches); InsertSketch with the
                // sketch selected opens it the same way the "Edit Sketch" command does.
                Doc.ClearSelection2(true);
                Doc.Extension.SelectByID2(sketchFeature.Name, "SKETCH", 0, 0, 0, false, 0, null, 0);
                Doc.SketchManager.InsertSketch(true);
                active = Doc.SketchManager.ActiveSketch;
            }
            Doc.ClearSelection2(true);
            if (active == null) throw new CadException("EditSketch: " + sketchFeature.Name + " did not open");
            return active;
        }

        /// <summary>Deletes every segment of the open sketch except the given ones (keeps one view of an import).</summary>
        public int KeepOnlySegments(List<ISketchSegment> keep)
        {
            ISketch sketch = Doc.SketchManager.ActiveSketch;
            if (sketch == null) throw new CadException("KeepOnlySegments: no sketch is open");
            List<ISketchSegment> drop = ((object[])sketch.GetSketchSegments() ?? new object[0]).Cast<ISketchSegment>()
                .Where(s => !keep.Any(k => SameEntity(k, s))).ToList();
            DeleteSegments(drop);
            return drop.Count;
        }

        /// <summary>Extrudes chosen regions of a sketch (Selected Contours), each picked by a model point (mm) inside it.
        /// Both directions end at vertices (Up To Vertex, for example corners of another view of an imported drawing):
        /// pass the two model points; with null vertices the extrusion is mid-plane depthMm instead.</summary>
        public IFeature ExtrudeRegions(IFeature sketch, List<double[]> regionPointsMm, string name, double[] vertex1Mm, double[] vertex2Mm, double depthMm)
        {
            Doc.EditRebuild3();
            double before = Bodies().Count == 0 ? 0 : VolumeMm3();
            Doc.ClearSelection2(true);
            ISelectionMgr selection = (ISelectionMgr)Doc.SelectionManager;
            foreach (double[] p in regionPointsMm)
            {
                SelectData profile = (SelectData)selection.CreateSelectData();
                profile.Mark = 0;
                if (!SketchRegionAt(sketch, p[0], p[1], p[2]).Select2(true, profile))
                    throw new CadException(name + ": sketch region at (" + string.Join(", ", p) + ") was not selected");
            }
            bool toVertex = vertex1Mm != null && vertex2Mm != null;
            if (toVertex)
            {
                if (!Doc.Extension.SelectByID2("", "EXTSKETCHPOINT", vertex1Mm[0] * Mm, vertex1Mm[1] * Mm, vertex1Mm[2] * Mm, true, 1, null, 0)
                    && !Doc.Extension.SelectByID2("", "VERTEX", vertex1Mm[0] * Mm, vertex1Mm[1] * Mm, vertex1Mm[2] * Mm, true, 1, null, 0))
                    throw new CadException(name + ": no vertex at (" + string.Join(", ", vertex1Mm) + ")");
                if (!Doc.Extension.SelectByID2("", "EXTSKETCHPOINT", vertex2Mm[0] * Mm, vertex2Mm[1] * Mm, vertex2Mm[2] * Mm, true, 2, null, 0)
                    && !Doc.Extension.SelectByID2("", "VERTEX", vertex2Mm[0] * Mm, vertex2Mm[1] * Mm, vertex2Mm[2] * Mm, true, 2, null, 0))
                    throw new CadException(name + ": no vertex at (" + string.Join(", ", vertex2Mm) + ")");
            }
            int end1 = toVertex ? (int)swEndConditions_e.swEndCondUpToVertex : (int)swEndConditions_e.swEndCondMidPlane;
            int end2 = toVertex ? (int)swEndConditions_e.swEndCondUpToVertex : (int)swEndConditions_e.swEndCondBlind;
            IFeature f = (IFeature)Doc.FeatureManager.FeatureExtrusion3(!toVertex, false, false, end1, end2,
                toVertex ? 0.01 : depthMm * Mm, 0.01, false, false, false, false, 0, 0, false, false, false, false, true, true, true,
                (int)swStartConditions_e.swStartSketchPlane, 0, false);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (VolumeMm3() <= before + 1e-6) throw new CadException(name + ": extrusion added no material");
            return made;
        }

        /// <summary>Copies sketch segments (of any sketch, open or not) into a new sketch on a plane with Copy/Paste and
        /// leaves that sketch open. Use it to split an imported DXF/DWG sketch, which the API cannot open for editing
        /// (EditSketch silently does nothing on DXF import sketches), into one sketch per view. Paste drops the copies
        /// at an arbitrary offset: place them with MoveSegmentsTo.</summary>
        public List<ISketchSegment> CopySegmentsToNewSketch(List<ISketchSegment> source, object plane)
        {
            if (Doc.SketchManager.ActiveSketch != null) throw new CadException("CopySegmentsToNewSketch: close the open sketch first");
            Doc.ClearSelection2(true);
            for (int i = 0; i < source.Count; i++)
                if (!source[i].Select4(i > 0, null)) throw new CadException("CopySegmentsToNewSketch: segment " + i + " not selected");
            Doc.EditCopy();
            Doc.ClearSelection2(true);
            ISketch sketch = OpenSketch(plane);
            Doc.Paste();
            Doc.ClearSelection2(true);
            List<ISketchSegment> pasted = ((object[])sketch.GetSketchSegments() ?? new object[0]).Cast<ISketchSegment>().ToList();
            if (pasted.Count != source.Count)
                throw new CadException("CopySegmentsToNewSketch: pasted " + pasted.Count + " of " + source.Count + " segments");
            Step("pasted " + pasted.Count + " segments into a new sketch");
            return pasted;
        }

        /// <summary>Bounding box {minX, minY, maxX, maxY} of segments in their sketch's coordinates (mm).</summary>
        public double[] SegmentsBoxMm(IEnumerable<ISketchSegment> segments)
        {
            double[][] boxes = segments.Select(SegmentBoxMm).Where(b => !double.IsNaN(b[0])).ToArray();
            return new[] { boxes.Min(b => b[0]), boxes.Min(b => b[1]), boxes.Max(b => b[2]), boxes.Max(b => b[3]) };
        }

        /// <summary>Moves segments of the open sketch so that their bounding box fits the model-space box spanned by two
        /// opposite corners (mm) on the sketch plane, for example a view onto the part origin. Checks the size matches.</summary>
        public void MoveSegmentsTo(List<ISketchSegment> segments, double[] cornerAMm, double[] cornerBMm)
        {
            double[] a = ToSketch(cornerAMm[0], cornerAMm[1], cornerAMm[2]), b = ToSketch(cornerBMm[0], cornerBMm[1], cornerBMm[2]);
            double minX = Math.Min(a[0], b[0]) * 1000, minY = Math.Min(a[1], b[1]) * 1000;
            double width = Math.Abs(a[0] - b[0]) * 1000, height = Math.Abs(a[1] - b[1]) * 1000;
            double[] box = SegmentsBoxMm(segments);
            if (Math.Abs(box[2] - box[0] - width) > 1e-3 || Math.Abs(box[3] - box[1] - height) > 1e-3)
                throw new CadException(string.Format(CultureInfo.InvariantCulture,
                    "MoveSegmentsTo: segments span {0:0.###} x {1:0.###} mm but the target is {2:0.###} x {3:0.###} mm",
                    box[2] - box[0], box[3] - box[1], width, height));
            MoveSketchEntities(segments, minX - box[0], minY - box[1]);
        }


        /// <summary>The region of a sketch (closed area, as Selected Contours offers it) containing a model point (mm).
        /// SelectByID2("SKETCHREGION") does not find regions of a closed sketch reliably; this tests each region's loops.</summary>
        public ISketchRegion SketchRegionAt(IFeature sketchFeature, double xMm, double yMm, double zMm)
        {
            ISketch sketch = (ISketch)sketchFeature.GetSpecificFeature2();
            object[] regions = (object[])sketch.GetSketchRegions() ?? new object[0];
            // Fast path: a region's loop carries a temporary planar face; the point lies in the region when the face's
            // closest point is the point itself (one call per region).
            ISketchRegion best = null;
            double bestDistance = double.MaxValue;
            bool facesAvailable = true;
            foreach (object o in regions)
            {
                ILoop2 first = ((ISketchRegion)o).GetFirstLoop();
                IFace2 face = first == null ? null : (IFace2)first.GetFace();
                double[] q = face == null ? null : (double[])face.GetClosestPointOn(xMm * Mm, yMm * Mm, zMm * Mm);
                if (q == null) { facesAvailable = false; break; }
                double d = Math.Sqrt(Math.Pow(q[0] - xMm * Mm, 2) + Math.Pow(q[1] - yMm * Mm, 2) + Math.Pow(q[2] - zMm * Mm, 2)) * 1000;
                if (d < bestDistance) { bestDistance = d; best = (ISketchRegion)o; }
            }
            if (facesAvailable && best != null && bestDistance < 1e-4) return best;
            MathTransform toSketch = (MathTransform)sketch.ModelToSketchTransform;
            double[] p = (double[])((MathPoint)((MathPoint)MathUtil.CreatePoint(new double[] { xMm * Mm, yMm * Mm, zMm * Mm })).MultiplyTransform(toSketch)).ArrayData;
            foreach (object o in facesAvailable ? new object[0] : regions)
            {
                ISketchRegion region = (ISketchRegion)o;
                bool inside = false, inHole = false;
                ILoop2 loop = region.GetFirstLoop();
                while (loop != null)
                {
                    int crossings = 0;
                    foreach (object e in (object[])loop.GetEdges() ?? new object[0])
                    {
                        foreach (double[][] chord in RegionEdgeChords((IEdge)e, toSketch))
                        {
                            double[] a = chord[0], b = chord[1];
                            if ((a[1] > p[1]) != (b[1] > p[1]))
                            {
                                double xCross = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                                if (xCross > p[0]) crossings++;
                            }
                        }
                    }
                    bool inLoop = crossings % 2 == 1;
                    if (loop.IsOuter()) inside = inLoop;
                    else if (inLoop) inHole = true;
                    loop = (ILoop2)loop.GetNext();
                }
                if (inside && !inHole) return region;
            }
            throw new CadException(string.Format(CultureInfo.InvariantCulture, "{0}: no closed region contains ({1}, {2}, {3}); the sketch has {4} region(s)",
                sketchFeature.Name, xMm, yMm, zMm, regions.Length));
        }


        // Sketch-region edges: GetCurveParams3 ranges are shifted (a line evaluates one length past its end), so the end
        // points and parameters of GetCurveParams2 are used; samples that do not reproduce the end points fall back to
        // the chord. Closed edges (ellipses, circles) are sampled all round.
        List<double[][]> RegionEdgeChords(IEdge edge, MathTransform toSketch)
        {
            double[] cp = (double[])edge.GetCurveParams2();
            ICurve curve = (ICurve)edge.GetCurve();
            Func<double[], double[]> sk = m => (double[])((MathPoint)((MathPoint)MathUtil.CreatePoint(new double[] { m[0], m[1], m[2] })).MultiplyTransform(toSketch)).ArrayData;
            double[] start = { cp[0], cp[1], cp[2] }, end = { cp[3], cp[4], cp[5] };
            List<double[]> pts = new List<double[]>();
            bool line = curve.IsLine();
            if (!line)
            {
                const int n = 48;
                for (int k = 0; k <= n; k++)
                    pts.Add((double[])curve.Evaluate2(cp[6] + (cp[7] - cp[6]) * k / n, 0));
                Func<double[], double[], double> dist = (u, v) => Math.Sqrt(Math.Pow(u[0] - v[0], 2) + Math.Pow(u[1] - v[1], 2) + Math.Pow(u[2] - v[2], 2));
                if (dist(pts[0], start) > 1e-6 || dist(pts[n], end) > 1e-6) pts.Clear();
            }
            if (pts.Count == 0) pts = new List<double[]> { start, end };
            List<double[][]> chords = new List<double[][]>();
            for (int k = 1; k < pts.Count; k++) chords.Add(new[] { sk(pts[k - 1]), sk(pts[k]) });
            return chords;
        }

        /// <summary>True when a model point (mm) lies in a sketch region (its loop's temporary face).</summary>
        public bool RegionContains(ISketchRegion region, double xMm, double yMm, double zMm)
        {
            ILoop2 first = region.GetFirstLoop();
            IFace2 face = first == null ? null : (IFace2)first.GetFace();
            if (face == null) throw new CadException("RegionContains: the region has no face");
            double[] q = (double[])face.GetClosestPointOn(xMm * Mm, yMm * Mm, zMm * Mm);
            return q != null && Math.Sqrt(Math.Pow(q[0] - xMm * Mm, 2) + Math.Pow(q[1] - yMm * Mm, 2) + Math.Pow(q[2] - zMm * Mm, 2)) * 1000 < 1e-4;
        }

        /// <summary>The sketch's regions except those containing any of the model points (mm). IsSame does not compare
        /// sketch regions reliably, so exclusion goes by position.</summary>
        public List<ISketchRegion> SketchRegionsExcept(IFeature sketchFeature, params double[][] pointsMm)
        {
            return SketchRegions(sketchFeature).Where(r => !pointsMm.Any(p => RegionContains(r, p[0], p[1], p[2]))).ToList();
        }

        /// <summary>Area of a sketch region in mm² (from its loop's temporary face; inner loops are not subtracted).</summary>
        public double RegionAreaMm2(ISketchRegion region)
        {
            ILoop2 first = region.GetFirstLoop();
            IFace2 face = first == null ? null : (IFace2)first.GetFace();
            return face == null ? double.NaN : face.GetArea() * 1e6;
        }

        /// <summary>Mid-plane extrusion of sketch regions: totalMm split evenly on both sides of the sketch plane.</summary>
        public IFeature ExtrudeRegionListMid(IFeature sketch, List<ISketchRegion> regions, string name, double totalMm)
        {
            Doc.EditRebuild3();
            double before = Bodies().Count == 0 ? 0 : VolumeMm3();
            Doc.ClearSelection2(true);
            ISelectionMgr selection = (ISelectionMgr)Doc.SelectionManager;
            foreach (ISketchRegion region in regions)
            {
                SelectData profile = (SelectData)selection.CreateSelectData();
                profile.Mark = 0;
                if (!region.Select2(true, profile)) throw new CadException(name + ": a sketch region was not selected");
            }
            IFeature f = (IFeature)Doc.FeatureManager.FeatureExtrusion3(true, false, false, (int)swEndConditions_e.swEndCondMidPlane, 0,
                totalMm * Mm, 0.01, false, false, false, false, 0, 0, false, false, false, false, true, true, true,
                (int)swStartConditions_e.swStartSketchPlane, 0, false);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (VolumeMm3() <= before + 1e-6) throw new CadException(name + ": extrusion added no material");
            return made;
        }

        /// <summary>All closed regions of a sketch (what Selected Contours can pick).</summary>
        public List<ISketchRegion> SketchRegions(IFeature sketchFeature)
        {
            ISketch sketch = (ISketch)sketchFeature.GetSpecificFeature2();
            return ((object[])sketch.GetSketchRegions() ?? new object[0]).Cast<ISketchRegion>().ToList();
        }

        /// <summary>Blind extrusion (depthMm along the sketch normal, or against it with reverse) of a list of sketch regions
        /// (Selected Contours). Use with SketchRegions/SketchRegionAt for sketches whose regions are many or nested (logos,
        /// blocks, imported drawings). Checks material was added.</summary>
        public IFeature ExtrudeRegionList(IFeature sketch, List<ISketchRegion> regions, string name, double depthMm, bool reverse)
        {
            return ExtrudeRegionList(sketch, regions, name, depthMm, reverse, 0);
        }

        /// <summary>As above, starting startOffsetMm from the sketch plane (in the extrusion direction): material that
        /// begins inside the part, for example the web between two grooves, without a cut.</summary>
        public IFeature ExtrudeRegionList(IFeature sketch, List<ISketchRegion> regions, string name, double depthMm, bool reverse, double startOffsetMm)
        {
            Doc.EditRebuild3();
            double before = Bodies().Count == 0 ? 0 : VolumeMm3();
            Doc.ClearSelection2(true);
            ISelectionMgr selection = (ISelectionMgr)Doc.SelectionManager;
            foreach (ISketchRegion region in regions)
            {
                SelectData profile = (SelectData)selection.CreateSelectData();
                profile.Mark = 0;
                if (!region.Select2(true, profile)) throw new CadException(name + ": a sketch region was not selected");
            }
            IFeature f = (IFeature)Doc.FeatureManager.FeatureExtrusion3(true, false, reverse, (int)swEndConditions_e.swEndCondBlind, 0,
                depthMm * Mm, 0.01, false, false, false, false, 0, 0, false, false, false, false, true, true, true,
                startOffsetMm > 0 ? (int)swStartConditions_e.swStartOffset : (int)swStartConditions_e.swStartSketchPlane, startOffsetMm * Mm, reverse);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (VolumeMm3() <= before + 1e-6) throw new CadException(name + ": extrusion added no material");
            return made;
        }

        /// <summary>Make Block from segments of the open sketch with the insertion point at (x, y) sketch mm; names the
        /// block definition and, with savePath, saves it as a .SLDBLK file for reuse (Insert Block, Design Library).</summary>
        public ISketchBlockDefinition MakeBlock(List<ISketchSegment> segments, double xMm, double yMm, string name, string savePath)
        {
            if (Doc.SketchManager.ActiveSketch == null) throw new CadException("MakeBlock: no sketch is open");
            Doc.ClearSelection2(true);
            for (int i = 0; i < segments.Count; i++)
                if (!segments[i].Select4(i > 0, null)) throw new CadException("MakeBlock: segment " + i + " not selected");
            MathPoint insertion = (MathPoint)MathUtil.CreatePoint(new double[] { xMm * Mm, yMm * Mm, 0 });
            ISketchBlockDefinition def = Doc.SketchManager.MakeSketchBlockFromSelected(insertion);
            Doc.ClearSelection2(true);
            if (def == null) throw new CadException("MakeBlock: no block was made from " + segments.Count + " segments");
            IFeature f = (IFeature)def.GetFeature();
            if (f != null && name != null) f.Name = name;
            if (savePath != null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(savePath));
                if (!def.Save(savePath) || !File.Exists(savePath)) throw new CadException("MakeBlock: block was not saved to " + savePath);
            }
            Step("block " + (name ?? "?") + " from " + segments.Count + " segments" + (savePath != null ? ", saved " + savePath : ""));
            return def;
        }


        /// <summary>Reference axis where two planes meet (Top + Right gives the Z axis); for circular patterns.</summary>
        public IFeature AxisFromPlanes(IFeature planeA, IFeature planeB, string name)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            if (!planeA.Select2(false, 0) || !planeB.Select2(true, 0)) throw new CadException(name + ": planes not selected");
            bool ok = Doc.InsertAxis2(true);
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (!ok || all.Count == before || all[all.Count - 1].GetTypeName2() != "RefAxis") throw new CadException(name + ": axis was not created");
            IFeature axis = all[all.Count - 1];
            axis.Name = name;
            return axis;
        }

        /// <summary>Equal-spaced circular pattern of features through 360 degrees about an axis (reference axis feature,
        /// straight edge or cylindrical face). count includes the seed. Checks that the volume changed.</summary>
        public IFeature CircularPattern(IEnumerable<IFeature> seeds, object axis, int count, string name)
        {
            Doc.EditRebuild3();
            double before = VolumeMm3();
            Doc.ClearSelection2(true);
            ISelectionMgr selection = (ISelectionMgr)Doc.SelectionManager;
            SelectData axisMark = (SelectData)selection.CreateSelectData();
            axisMark.Mark = 1;
            bool axisSelected = axis is IFeature ? ((IFeature)axis).Select2(false, 1) : ((IEntity)axis).Select4(false, axisMark);
            if (!axisSelected) throw new CadException(name + ": axis not selected");
            foreach (IFeature seed in seeds)
                if (!seed.Select2(true, 4)) throw new CadException(name + ": seed " + seed.Name + " not selected");
            IFeature f = (IFeature)Doc.FeatureManager.FeatureCircularPattern5(count, 2 * Math.PI, false, "", false, true, false, false,
                false, false, 0, 0, "", false);
            Doc.ClearSelection2(true);
            IFeature made = Checked(f, name);
            Doc.EditRebuild3();
            if (Math.Abs(VolumeMm3() - before) < 1e-6) throw new CadException(name + ": the pattern changed nothing");
            return made;
        }


        // ------------------------------------------------------------------ surfaces

        /// <summary>Projected curve, sketch on sketch: the 3D curve where the extrusions of two sketches on different
        /// planes meet (for example a top-view outline and a side-view profile).</summary>
        public IFeature ProjectedCurve(IFeature sketchA, IFeature sketchB, string name)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            if (!sketchA.Select2(false, 0) || !sketchB.Select2(true, 0)) throw new CadException(name + ": sketches not selected");
            Doc.InsertProjectedSketch2(0);
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (all.Count == before) throw new CadException(name + ": projected curve was not created (do the sketches' extrusions meet?)");
            return Checked(all[all.Count - 1], name);
        }

        /// <summary>Planar surface bounded by a closed sketch or a set of coplanar edges.</summary>
        public IFeature PlanarSurface(object[] boundary, string name)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            for (int i = 0; i < boundary.Length; i++)
            {
                SelectData data = (SelectData)sm.CreateSelectData();
                data.Mark = 1;
                bool ok = boundary[i] is IFeature ? ((IFeature)boundary[i]).Select2(true, 1) : ((IEntity)boundary[i]).Select4(true, data);
                if (!ok) throw new CadException(name + ": boundary " + i + " not selected");
            }
            bool made = Doc.InsertPlanarRefSurface();
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (!made || all.Count == before) throw new CadException(name + ": planar surface was not created (boundary not closed or not planar?)");
            return Checked(all[all.Count - 1], name);
        }

        /// <summary>Fill surface over a closed loop of edges; tangent = true keeps it tangent to the faces at the edges.</summary>
        public IFeature FillSurface(IEnumerable<IEdge> boundary, bool tangent, string name)
        {
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            foreach (IEdge e in boundary)
            {
                SelectData data = (SelectData)sm.CreateSelectData();
                data.Mark = tangent ? 513 : 257;
                if (!((IEntity)e).Select4(true, data)) throw new CadException(name + ": boundary edge not selected");
            }
            IFeature f = Doc.FeatureManager.InsertFillSurface2(2, 0, null, null, null, null);
            Doc.ClearSelection2(true);
            return Checked(f, name);
        }

        /// <summary>Knit surface bodies; formSolid closes a watertight set into a solid body.</summary>
        public IFeature Knit(IEnumerable<IBody2> sheets, bool formSolid, string name)
        {
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            foreach (IBody2 b in sheets)
            {
                SelectData data = (SelectData)sm.CreateSelectData();
                data.Mark = 1;
                if (!b.Select2(true, data)) throw new CadException(name + ": surface body not selected");
            }
            IFeature f = Doc.FeatureManager.InsertSewRefSurface(false, formSolid, true, 0.0001, 0.0001);
            Doc.ClearSelection2(true);
            return Checked(f, name);
        }

        /// <summary>Volume of one body in mm3.</summary>
        public static double BodyVolumeMm3(IBody2 body)
        {
            double[] props = (double[])body.GetMassProperties(1000);
            return props[3] * 1e9;
        }

        /// <summary>Thickens a surface face into a new solid body (merge off). side: 0 = side one, 1 = side two,
        /// 2 = both sides. With both sides the thickness applies to EACH side (0.5 gives a 1.0 slab).</summary>
        public IFeature Thicken(IFace2 face, double thicknessMm, int side, bool merge, string name)
        {
            Doc.ClearSelection2(true);
            SelectData data = (SelectData)((ISelectionMgr)Doc.SelectionManager).CreateSelectData();
            data.Mark = 1;   // the surface must carry mark 1
            if (!((IEntity)face).Select4(false, data)) throw new CadException(name + ": face not selected");
            object made = Doc.FeatureManager.FeatureBossThicken(thicknessMm * Mm, side, 0, false, merge, false, true);
            Doc.ClearSelection2(true);
            return Checked(made, name);
        }

        /// <summary>Combine bodies: SWBODYADD / SWBODYINTERSECT take only tools (main null); SWBODYCUT needs the main body.
        /// Passing the bodies directly returns null for intersect on 2025, so selection marks are tried as well
        /// (main = 1, tools = 2).</summary>
        public IFeature CombineBodies(swBodyOperationType_e operation, IBody2 main, IList<IBody2> tools, string name)
        {
            Doc.ClearSelection2(true);
            object made = Doc.FeatureManager.InsertCombineFeature((int)operation, (Body2)main, tools.Cast<object>().ToArray());
            if (made == null)
            {
                ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
                if (main != null)
                {
                    SelectData m1 = (SelectData)sm.CreateSelectData();
                    m1.Mark = 1;
                    if (!main.Select2(true, m1)) throw new CadException(name + ": main body not selected");
                }
                foreach (IBody2 b in tools)
                {
                    SelectData m2 = (SelectData)sm.CreateSelectData();
                    m2.Mark = 2;
                    if (!b.Select2(true, m2)) throw new CadException(name + ": tool body not selected");
                }
                made = Doc.FeatureManager.InsertCombineFeature((int)operation, null, new object[0]);
            }
            Doc.ClearSelection2(true);
            return Checked(made, name);
        }

        /// <summary>Answer SOLIDWORKS message boxes raised by the calls inside the using block: pairs of (text fragment,
        /// button caption), e.g. AnswerDialogs("different units of measurement", "Yes"). Read Answered/Unanswered afterwards
        /// for the job result. Prefer settings that avoid the prompt; use this when no such setting exists.</summary>
        public DialogAnswerer AnswerDialogs(params string[] fragmentButtonPairs)
        {
            return new DialogAnswerer(App.GetProcessID(), fragmentButtonPairs);
        }

        /// <summary>Move/Copy Body: a copy of body rotated by deg about the global x, y or z axis through originMm. On 2025 the
        /// RotAngleX/Y/Z arguments of InsertMoveCopyBody2 do not reach the matching axes (an angle passed as RotAngleZ is
        /// stored as TransformX, a rotation about X - a planar part tilts out of plane instead of turning about its pivot),
        /// so the stored definition is read back and corrected with ModifyDefinition. Returns the new body.</summary>
        public IBody2 CopyBodyRotated(IBody2 body, char axis, double deg, double[] originMm, string name)
        {
            double a = deg * Math.PI / 180;
            double[] want = { axis == 'x' ? a : 0, axis == 'y' ? a : 0, axis == 'z' ? a : 0 };
            Doc.ClearSelection2(true);
            if (!body.Select2(false, MarkData(1))) throw new CadException(name + ": body not selected");
            List<string> before = Bodies().Select(b => b.Name).ToList();
            IFeature f = (IFeature)Doc.FeatureManager.InsertMoveCopyBody2(0, 0, 0, 0, originMm[0] * Mm, originMm[1] * Mm, originMm[2] * Mm,
                want[0], want[1], want[2], true, 1);
            Doc.ClearSelection2(true);
            Checked(f, name);
            Func<IMoveCopyBodyFeatureData, bool> matches = d => Math.Abs(d.TransformX - want[0]) < 1e-9 && Math.Abs(d.TransformY - want[1]) < 1e-9
                && Math.Abs(d.TransformZ - want[2]) < 1e-9;
            IMoveCopyBodyFeatureData data = (IMoveCopyBodyFeatureData)f.GetDefinition();
            if (Math.Abs(deg) > 1e-9 && !matches(data))
            {
                data.AccessSelections((ModelDoc2)Doc, null);
                data.TransformX = want[0];
                data.TransformY = want[1];
                data.TransformZ = want[2];
                bool ok = f.ModifyDefinition(data, (ModelDoc2)Doc, null);
                if (!ok) data.ReleaseSelectionAccess();
                data = (IMoveCopyBodyFeatureData)f.GetDefinition();
                if (!ok || !matches(data))
                    throw new CadException(name + ": rotation stored as " + data.TransformX + "/" + data.TransformY + "/" + data.TransformZ + " rad, wanted " + string.Join("/", want));
                Note(name + ": rotation axis corrected in the feature definition");
            }
            Doc.EditRebuild3();
            IBody2 made = Bodies().FirstOrDefault(b => !before.Contains(b.Name));
            if (made == null) throw new CadException(name + ": no copied body");
            return made;
        }

        /// <summary>Insert into New Part (right-click a body > Insert into New Part): saves one body of the active part as
        /// a new part file linked to it (Stock feature), so later edits of the multibody master flow into the new part.
        /// The new part opens; it is saved and its document returned. templatePath overrides the default part template.</summary>
        public IModelDoc2 InsertIntoNewPart(IBody2 body, string path, string templatePath)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            IModelDoc2 master = Doc;
            master.ClearSelection2(true);
            if (!body.Select2(false, null)) throw new CadException("InsertIntoNewPart: body " + body.Name + " not selected");
            int errors, warnings;
            bool ok;
            using (DialogAnswerer answers = AnswerDialogs("different units of measurement", "Yes"))
            {
                ok = ((IPartDoc)master).SaveToFile3(path, (int)swSaveAsOptions_e.swSaveAsOptions_Silent, 0,
                    !string.IsNullOrEmpty(templatePath), templatePath ?? "", out errors, out warnings);
                foreach (string a in answers.Answered) Note("InsertIntoNewPart: answered " + a);
            }
            master.ClearSelection2(true);
            if (!ok || !File.Exists(path)) throw new CadException("InsertIntoNewPart: " + path + " not written (errors " + errors + ", warnings " + warnings + ")");
            IModelDoc2 made = (IModelDoc2)App.GetOpenDocumentByName(path);
            if (made == null)
            {
                int e = 0, w = 0;
                made = (IModelDoc2)App.OpenDoc6(path, (int)swDocumentTypes_e.swDocPART, (int)swOpenDocOptions_e.swOpenDocOptions_Silent, "", ref e, ref w);
            }
            if (made == null) throw new CadException("InsertIntoNewPart: " + path + " could not be opened");
            made.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, 0, 0);
            Step("insert into new part " + body.Name + " -> " + path);
            return made;
        }

        /// <summary>Body-Delete/Keep feature: keep = false deletes the given bodies (solid or surface), keep = true keeps
        /// only them. Use it to drop construction surfaces before Save Bodies.</summary>
        public IFeature DeleteBodies(IEnumerable<IBody2> bodies, bool keep, string name)
        {
            Doc.ClearSelection2(true);
            bool first = true;
            foreach (IBody2 b in bodies)
            {
                if (!b.Select2(!first, null)) throw new CadException(name + ": body " + b.Name + " not selected");
                first = false;
            }
            if (first) throw new CadException(name + ": no bodies given");
            object made = Doc.FeatureManager.InsertDeleteBody2(keep);
            Doc.ClearSelection2(true);
            return Checked(made, name);
        }

        /// <summary>Save Bodies (Insert > Features > Save Bodies): writes each solid body to its own part file and, when
        /// assemblyPath is not empty, an assembly that places every saved part at the original origin (fixed). The
        /// multibody part keeps its bodies (consume = false) unless consume is true. Pass the bodies as a typed Body2[]
        /// (an object[] returns null and only creates an empty assembly). Each derived part asks "template has different
        /// units ... change the unit of measure of the derived part?" when the default part template's units differ from
        /// the part's; that prompt is answered Yes (keep this part's units). Hidden bodies are skipped silently by SOLIDWORKS,
        /// so they are shown first. Returns the written paths; the new documents
        /// stay open (close them with Close/CloseDocumentsUnder). Throws when a body was skipped.</summary>
        public List<string> SaveBodies(IList<IBody2> bodies, IList<string> partPaths, string assemblyPath, bool consume, string name)
        {
            if (bodies.Count != partPaths.Count) throw new CadException(name + ": " + bodies.Count + " bodies but " + partPaths.Count + " paths");
            foreach (string p in partPaths) Directory.CreateDirectory(Path.GetDirectoryName(p));
            foreach (IBody2 b in bodies.Where(b => !b.Visible))
            {
                Note(name + ": showing hidden body " + b.Name + " (Save Bodies skips hidden bodies)");
                b.HideBody(false);
            }
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            using (DialogAnswerer answers = AnswerDialogs("different units of measurement", "Yes"))
            {
                Doc.FeatureManager.CreateSaveBodyFeature(bodies.Cast<Body2>().ToArray(), partPaths.ToArray(), assemblyPath ?? "", consume, false);
                foreach (string a in answers.Answered) Note(name + ": answered " + a);
                if (answers.Unanswered.Count > 0) Note(name + ": unanswered dialogs " + string.Join(" | ", answers.Unanswered));
            }
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (all.Count == before) throw new CadException(name + ": Save Bodies feature was not created");
            Checked(all[all.Count - 1], name);
            List<string> missing = partPaths.Where(p => !File.Exists(p)).ToList();
            if (missing.Count > 0) throw new CadException(name + ": not written: " + string.Join(", ", missing.Select(Path.GetFileName)));
            List<string> written = partPaths.ToList();
            if (!string.IsNullOrEmpty(assemblyPath))
            {
                if (!File.Exists(assemblyPath)) throw new CadException(name + ": assembly not written: " + assemblyPath);
                written.Add(assemblyPath);
            }
            return written;
        }

        /// <summary>Assign a library material to the active part (all configurations) and read it back. Database is
        /// "SOLIDWORKS Materials" for the standard library; an empty name removes the material.</summary>
        public string SetMaterial(string material, string database)
        {
            IPartDoc partDoc = Doc as IPartDoc;
            if (partDoc == null) throw new CadException("SetMaterial: the active document is not a part");
            string db = string.IsNullOrEmpty(database) ? "SOLIDWORKS Materials" : database;
            partDoc.SetMaterialPropertyName2("", db, material ?? "");
            string readDb;
            string readBack = partDoc.GetMaterialPropertyName2("", out readDb);
            if ((material ?? "") != (readBack ?? "")) throw new CadException("SetMaterial: '" + material + "' was not applied (got '" + readBack + "')");
            return readBack;
        }

        /// <summary>Mirror solid bodies about a plane (feature) or planar face; merge joins the copies to the originals.</summary>
        public IFeature MirrorBodies(object plane, IEnumerable<IBody2> bodies, bool merge, string name)
        {
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            bool ok = plane is IFeature ? ((IFeature)plane).Select2(false, 2) : ((IEntity)plane).Select4(false, MarkData(2));
            if (!ok) throw new CadException(name + ": mirror plane not selected");
            foreach (IBody2 b in bodies)
                if (!b.Select2(true, MarkData(256))) throw new CadException(name + ": body not selected");
            object made = Doc.FeatureManager.InsertMirrorFeature2(true, false, merge, false, 0);
            Doc.ClearSelection2(true);
            return Checked(made, name);
        }

        /// <summary>Mirror features about a plane (feature) or planar face. Mirrored bosses merge like the seed; use this
        /// rather than MirrorBodies when the seed feature merged into a body that also holds other geometry.</summary>
        public IFeature MirrorFeatures(object plane, IEnumerable<IFeature> features, string name)
        {
            Doc.ClearSelection2(true);
            bool ok = plane is IFeature ? ((IFeature)plane).Select2(false, 2) : ((IEntity)plane).Select4(false, MarkData(2));
            if (!ok) throw new CadException(name + ": mirror plane not selected");
            foreach (IFeature f in features)
                if (!f.Select2(true, 1)) throw new CadException(name + ": feature " + f.Name + " not selected");
            object made = Doc.FeatureManager.InsertMirrorFeature2(false, false, false, false, 0);
            Doc.ClearSelection2(true);
            return Checked(made, name);
        }

        /// <summary>Sweep with guide curves: profile sketch (mark 1), path sketch/curve/edge (mark 4) and guide curves
        /// (sketches or sketch segments, mark 2). The profile should be pierced to the guides.</summary>
        public IFeature SweepWithGuides(IFeature profileSketch, object path, IEnumerable<object> guides, bool merge, string name)
        {
            Doc.ClearSelection2(true);
            if (!profileSketch.Select2(false, 1)) throw new CadException(name + ": profile not selected");
            if (!SelectMarked(path, 4)) throw new CadException(name + ": path not selected");
            foreach (object g in guides)
                if (!SelectMarked(g, 2)) throw new CadException(name + ": guide curve not selected");
            object made = Doc.FeatureManager.InsertProtrusionSwept4(false, false, (int)swTwistControlType_e.swTwistControlFollowPath,
                false, false, 0, 0, false, 0, 0, 0, 0, merge, false, true, 0, true, false, 0, (int)swSweepDirection_e.swSweepDirection1);
            Doc.ClearSelection2(true);
            return Checked(made, name);
        }

        bool SelectMarked(object item, int mark)
        {
            if (item is IFeature) return ((IFeature)item).Select2(true, mark);
            if (item is ISketchSegment) return ((ISketchSegment)item).Select4(true, MarkData(mark));
            if (item is IEntity) return ((IEntity)item).Select4(true, MarkData(mark));
            return false;
        }

        /// <summary>Projected curve "sketch on faces": projects a sketch along its normal onto faces (reverse flips the
        /// direction, needed when the faces surround the sketch plane).</summary>
        public IFeature ProjectOnFaces(IFeature sketch, IEnumerable<IFace2> faces, bool reverse, string name)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            foreach (IFace2 f in faces)
                if (!((IEntity)f).Select4(true, null)) throw new CadException(name + ": face not selected");
            Doc.InsertProjectedSketch2(reverse ? 1 : 0);
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (all.Count == before) throw new CadException(name + ": projected curve was not created");
            return Checked(all[all.Count - 1], name);
        }

        /// <summary>Helix from a sketch with one circle. def: swHelixDefinedBy_e; reversed runs it against the sketch normal.</summary>
        public IFeature Helix(IFeature circleSketch, swHelixDefinedBy_e def, double heightMm, double pitchMm, double revolutions,
            double startAngleDeg, bool clockwise, bool reversed, string name)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            if (!circleSketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            Doc.InsertHelix(reversed, clockwise, false, false, (int)def, heightMm * Mm, pitchMm * Mm, revolutions, 0, startAngleDeg * Math.PI / 180);
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (all.Count == before) throw new CadException(name + ": helix was not created");
            return Checked(all[all.Count - 1], name);
        }

        /// <summary>Start and end points (mm) of a reference curve feature (helix, projected or composite curve):
        /// [x0, y0, z0, x1, y1, z1] over its first and last segments.</summary>
        public double[] CurveEndsMm(IFeature curveFeature)
        {
            IReferenceCurve rc = (IReferenceCurve)curveFeature.GetSpecificFeature2();
            object[] segs = (object[])rc.GetSegments() ?? new object[0];
            if (segs.Length == 0) throw new CadException(curveFeature.Name + ": curve has no segments");
            double[] a = (double[])((IEdge)segs[0]).GetCurveParams2(), b = (double[])((IEdge)segs[segs.Length - 1]).GetCurveParams2();
            return new[] { a[0] * 1000, a[1] * 1000, a[2] * 1000, b[3] * 1000, b[4] * 1000, b[5] * 1000 };
        }

        SelectData MarkData(int mark)
        {
            SelectData data = (SelectData)((ISelectionMgr)Doc.SelectionManager).CreateSelectData();
            data.Mark = mark;
            return data;
        }

        /// <summary>Surface bodies of the part (sheet bodies), hidden ones included like Bodies().</summary>
        public List<IBody2> SheetBodies()
        {
            return ((object[])((IPartDoc)Doc).GetBodies2((int)swBodyType_e.swSheetBody, false) ?? new object[0]).Cast<IBody2>().ToList();
        }

        /// <summary>Mirror copies of sketch segments in the open sketch about a construction line (originals kept).</summary>
        public List<ISketchSegment> MirrorCopy(List<ISketchSegment> segments, ISketchSegment axis)
        {
            ISketch sketch = Doc.SketchManager.ActiveSketch;
            List<object> before = ((object[])sketch.GetSketchSegments() ?? new object[0]).ToList();
            Doc.ClearSelection2(true);
            ISelectionMgr sm = (ISelectionMgr)Doc.SelectionManager;
            SelectData one = (SelectData)sm.CreateSelectData();
            one.Mark = 1;
            SelectData two = (SelectData)sm.CreateSelectData();
            two.Mark = 2;
            foreach (ISketchSegment s in segments) s.Select4(true, one);
            axis.Select4(true, two);
            Doc.SketchMirror();
            Doc.ClearSelection2(true);
            List<ISketchSegment> made = ((object[])sketch.GetSketchSegments() ?? new object[0]).Where(o => !before.Any(b => SameEntity(b, o))).Cast<ISketchSegment>().ToList();
            if (made.Count != segments.Count) throw new CadException("MirrorCopy: made " + made.Count + " of " + segments.Count);
            return made;
        }


        /// <summary>Surface extrusion of a sketch, both directions (depth2Mm = 0 for one direction).</summary>
        public IFeature SurfaceExtrude(IFeature sketch, string name, double depth1Mm, double depth2Mm)
        {
            int before = Features(null).Count;
            Doc.ClearSelection2(true);
            if (!sketch.Select2(false, 0)) throw new CadException(name + ": sketch not selected");
            bool both = depth2Mm > 0;
            Doc.FeatureManager.FeatureExtruRefSurface3(!both, false, (int)swStartConditions_e.swStartSketchPlane, 0,
                (int)swEndConditions_e.swEndCondBlind, (int)swEndConditions_e.swEndCondBlind, depth1Mm * Mm, both ? depth2Mm * Mm : 0.01,
                false, false, false, false, 0, 0, false, false, false, false, false, false, false, false);
            Doc.ClearSelection2(true);
            List<IFeature> all = Features(null);
            if (all.Count == before) throw new CadException(name + ": surface extrusion was not created");
            return Checked(all[all.Count - 1], name);
        }

        /// <summary>Cut with Surface: tries both sides and keeps the first whose result satisfies keep (for example "the
        /// bottom is still at Y = 0"); the surface body is hidden afterwards.</summary>
        public IFeature CutWithSurface(IFeature surface, string name, Func<bool> keep)
        {
            foreach (bool flip in new[] { false, true })
            {
                Doc.ClearSelection2(true);
                surface.Select2(false, 0);
                int err;
                IFeature cut = (IFeature)Doc.FeatureManager.InsertCutSurface(flip, 0, false, true, null, out err);
                Doc.ClearSelection2(true);
                if (cut == null) continue;
                Doc.EditRebuild3();
                if (Bodies().Count > 0 && keep()) return Checked(cut, name);
                Delete(cut);
            }
            throw new CadException(name + ": neither side of the cut met the check");
        }


        bool SameEntity(object a, object b)
        {
            return a != null && b != null && App.IsSame(a, b) == (int)swObjectEquality.swObjectSame;
        }

        /// <summary>Equal-distance 45 degree chamfer on edges.</summary>
        public IFeature Chamfer(IEdge[] edges, double distanceMm, string name)
        {
            // Equal distance has no side to pick. The angle-distance type can apply itself to the wrong side of a hole rim
            // and fill the bore into a cone (the volume grows); the result is checked for removed material either way.
            Doc.EditRebuild3();
            double before = VolumeMm3();
            int[][] attempts = {
                new[] { (int)swFeatureChamferOption_e.swFeatureChamferTangentPropagation, (int)swChamferType_e.swChamferEqualDistance },
                new[] { (int)swFeatureChamferOption_e.swFeatureChamferTangentPropagation, (int)swChamferType_e.swChamferAngleDistance },
                new[] { (int)swFeatureChamferOption_e.swFeatureChamferTangentPropagation | (int)swFeatureChamferOption_e.swFeatureChamferFlipDirection,
                        (int)swChamferType_e.swChamferAngleDistance } };
            List<string> tried = new List<string>();
            // Deleting a failed attempt invalidates the edge objects: keep persistent references and resolve them per attempt.
            List<object> keys = edges.Select(e => Doc.Extension.GetPersistReference3(e)).ToList();
            foreach (int[] attempt in attempts)
            {
                Doc.ClearSelection2(true);
                for (int i = 0; i < keys.Count; i++)
                {
                    int status;
                    object edge = Doc.Extension.GetObjectByPersistReference3(keys[i], out status);
                    if (edge == null || !((IEntity)edge).Select4(i > 0, null)) throw new CadException(name + ": edge " + i + " not selected (reference status " + status + ")");
                }
                IFeature f = (IFeature)Doc.FeatureManager.InsertFeatureChamfer(attempt[0], attempt[1], distanceMm * Mm, Math.PI / 4, 0, 0, 0, 0);
                Doc.ClearSelection2(true);
                if (f == null) { tried.Add("type " + attempt[1] + " options " + attempt[0] + ": null"); continue; }
                Doc.EditRebuild3();
                double change = VolumeMm3() - before;
                if (change < -1e-6) return Checked(f, name);
                tried.Add("type " + attempt[1] + " options " + attempt[0] + ": volume change " + Math.Round(change, 3) + " mm3");
                Delete(f);
                Doc.EditRebuild3();
            }
            throw new CadException(name + ": no chamfer removed material (" + string.Join("; ", tried) + ")");
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
                if (f.GetErrorCode2(out isWarning) != 0 && !isWarning) { Delete(f); continue; }
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
                if (a >= 0 && b > a && string.Equals(text.Substring(a + 1, b - a - 1), lhs, StringComparison.OrdinalIgnoreCase)) return i;
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
            int storedIndex = EquationIndex(lhs);
            if (storedIndex < 0) throw new CadException("Equation missing after write: " + text);
            string stored = Equations().Equation[storedIndex];
            if (NormalizeEquation(stored) != NormalizeEquation(text))
                throw new CadException("Equation not stored as written: " + stored + " (wrote " + text + ")");
        }

        /// <summary>Spacing, case and trailing-zero insensitive form ("2.0mm" == "2mm", "iif" == "IIF") for the read-back check.</summary>
        static string NormalizeEquation(string s)
        {
            string t = s.Replace(" ", "").ToLowerInvariant();
            t = Regex.Replace(t, @"(\d+\.\d*?)0+(?!\d)", "$1");
            t = Regex.Replace(t, @"(\d)\.(?!\d)", "$1");
            return t;
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

        // ------------------------------------------------------------------ editing existing models

        /// <summary>Moves the rollback bar to just before the named feature; new features are inserted there.
        /// Always pair with RollForward() (in finally when the job may fail midway).</summary>
        public void RollBackBefore(string featureName)
        {
            Feature(featureName);
            if (!Doc.FeatureManager.EditRollback((int)swMoveRollbackBarTo_e.swMoveRollbackBarToBeforeFeature, featureName))
                throw new CadException("Rollback before " + featureName + " failed");
            Note("rolled back before " + featureName);
        }

        public void RollForward()
        {
            if (!Doc.FeatureManager.EditRollback((int)swMoveRollbackBarTo_e.swMoveRollbackBarToEnd, ""))
                throw new CadException("Roll forward failed");
            Note("rolled forward");
        }

        /// <summary>Moves a feature (with its absorbed sketch) before another feature. An absorbed sketch cannot be moved
        /// on its own: pass the feature that consumes it.</summary>
        public void MoveBefore(string featureName, string beforeFeature)
        {
            Feature(featureName);
            Feature(beforeFeature);
            if (!Doc.Extension.ReorderFeature(featureName, beforeFeature, (int)swMoveLocation_e.swMoveBefore))
                throw new CadException("Reorder failed: " + featureName + " before " + beforeFeature
                    + " (absorbed sketches move with the feature that uses them; parents must stay before children)");
            Note("moved " + featureName + " before " + beforeFeature);
        }

        /// <summary>Deletes the equation "lhs" if present. IEquationMgr.Delete's return value does not reliably report
        /// success, so the result is checked by looking the equation up again.</summary>
        public void DeleteEquation(string lhs)
        {
            int index = EquationIndex(lhs);
            if (index < 0) return;
            Equations().Delete(index);
            if (EquationIndex(lhs) >= 0) throw new CadException("Equation not deleted: " + lhs);
        }

        /// <summary>Configurations with "suppress new features" (or, in assemblies, "suppress new components") switched on.
        /// Anything added while another configuration is active is silently suppressed there: no error, no warning.</summary>
        public List<string> ConfigurationsSuppressingNewItems()
        {
            List<string> found = new List<string>();
            foreach (string name in (string[])Doc.GetConfigurationNames())
            {
                IConfiguration c = (IConfiguration)Doc.GetConfigurationByName(name);
                if (c.SuppressNewFeatures) found.Add(name + ": new features");
                if (Doc is IAssemblyDoc && c.SuppressNewComponentModels) found.Add(name + ": new components");
            }
            return found;
        }

        /// <summary>Switches "suppress new features/components" off in every configuration (a document change; it is saved
        /// with the model). Call before adding features to a configured model, or unsuppress afterwards.</summary>
        public void AllowNewItemsInAllConfigurations()
        {
            foreach (string name in (string[])Doc.GetConfigurationNames())
            {
                IConfiguration c = (IConfiguration)Doc.GetConfigurationByName(name);
                if (c.SuppressNewFeatures) c.SuppressNewFeatures = false;
                if (Doc is IAssemblyDoc && c.SuppressNewComponentModels) c.SuppressNewComponentModels = false;
            }
        }

        /// <summary>Features suppressed in some but not all configurations, as "Feature: Config1, Config2". Deliberate
        /// variants appear here too; anything you just added should not.</summary>
        public List<string> PartlySuppressedFeatures()
        {
            string[] configs = (string[])Doc.GetConfigurationNames();
            List<string> found = new List<string>();
            foreach (IFeature f in Features(null))
            {
                bool[] s = (bool[])f.IsSuppressed2((int)swInConfigurationOpts_e.swSpecifyConfiguration, configs);
                if (s == null || !s.Any(x => x) || s.All(x => x)) continue;
                List<string> where = new List<string>();
                for (int i = 0; i < configs.Length; i++) if (s[i]) where.Add(configs[i]);
                found.Add(f.Name + ": " + string.Join(", ", where.ToArray()));
            }
            return found;
        }

        /// <summary>Rebuilds every configuration and reports feature errors, suppressed-feature count and, for parts,
        /// solid body count and volume (mm3). The originally active configuration is restored.</summary>
        public Dictionary<string, object> ConfigurationReport()
        {
            Dictionary<string, object> report = new Dictionary<string, object>();
            string active = Doc.ConfigurationManager.ActiveConfiguration.Name;
            try
            {
                foreach (string name in (string[])Doc.GetConfigurationNames())
                {
                    UseConfiguration(name);
                    Doc.ForceRebuild3(false);
                    int suppressed = 0;
                    foreach (IFeature f in Features(null))
                    {
                        bool[] s = (bool[])f.IsSuppressed2((int)swInConfigurationOpts_e.swThisConfiguration, null);
                        if (s != null && s.Length > 0 && s[0]) suppressed++;
                    }
                    Dictionary<string, object> row = new Dictionary<string, object>();
                    row["errors"] = FeatureErrors();
                    row["suppressedFeatures"] = suppressed;
                    if (Doc is IPartDoc)
                    {
                        row["bodies"] = Bodies().Count;
                        row["volumeMm3"] = Math.Round(VolumeMm3(), 3);
                    }
                    report[name] = row;
                }
            }
            finally
            {
                UseConfiguration(active);
                Doc.ForceRebuild3(false);
            }
            return report;
        }

        // ------------------------------------------------------------------ assemblies

        /// <summary>Inserts an open part/assembly file (opened silently first) with its origin at (x, y, z) mm and no rotation.</summary>
        public IComponent2 AddComponent(IModelDoc2 assembly, string path, double xMm, double yMm, double zMm, string configuration)
        {
            IComponent2 c = AddComponent(assembly, path, xMm, yMm, zMm);
            if (!string.IsNullOrEmpty(configuration))
            {
                c.ReferencedConfiguration = configuration;
                assembly.EditRebuild3();
                if (c.ReferencedConfiguration != configuration) throw new CadException("Component did not take configuration " + configuration);
            }
            return c;
        }

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

        // ------------------------------------------------------------------ top-down (parts built in the assembly)

        /// <summary>Top-down: inserts a new virtual part whose Front Plane lies on planeOrFace (an assembly plane feature, or a
        /// planar face in assembly context), enters in-context editing of it and deletes the empty sketch that
        /// InsertNewVirtualPart leaves in the part. Doc stays the assembly. Sketch on the component's own planes
        /// (component.FeatureByName("Front Plane")) with OpenSketch, hand sketches to feature calls through InContextFeature,
        /// then EndEditInContext and SaveVirtualPart.</summary>
        public IComponent2 NewPartInContext(IModelDoc2 assembly, object planeOrFace)
        {
            Step("new part in context");
            Activate(assembly);
            Doc = assembly;
            // A plane must be passed as the RefPlane object: an IFeature returns 6 (NotAFaceOrPlane).
            object target = planeOrFace is IFeature ? ((IFeature)planeOrFace).GetSpecificFeature2() : planeOrFace;
            assembly.ClearSelection2(true);
            Component2 created;
            int status = ((IAssemblyDoc)assembly).InsertNewVirtualPart(target, out created);
            if (status != (int)swInsertNewPartErrorCode_e.swInsertNewPartError_NoError || created == null)
                throw new CadException("InsertNewVirtualPart returned " + status + " (6 = not a face or plane)");
            IComponent2 component = created;
            // The call neither enters edit mode nor opens a sketch, but leaves an empty Sketch1 in the part.
            EditInContext(assembly, component);
            IModelDoc2 part = (IModelDoc2)component.GetModelDoc2();
            List<string> empty = new List<string>();
            IFeature f = (IFeature)part.FirstFeature();
            while (f != null)
            {
                if (f.GetTypeName2() == "ProfileFeature")
                {
                    object[] segments = (object[])((ISketch)f.GetSpecificFeature2()).GetSketchSegments();
                    if (segments == null || segments.Length == 0) empty.Add(f.Name);
                }
                f = (IFeature)f.GetNextFeature();
            }
            foreach (string name in empty)
            {
                IFeature inAssembly = (IFeature)component.FeatureByName(name);
                assembly.ClearSelection2(true);
                if (inAssembly == null || !inAssembly.Select2(false, 0) || !assembly.Extension.DeleteSelection2(0))
                    throw new CadException("Could not delete the empty sketch " + name + " of the new part");
            }
            assembly.ClearSelection2(true);
            Note("new part " + component.Name2 + " in context" + (empty.Count > 0 ? ", deleted empty " + string.Join(", ", empty) : ""));
            return component;
        }

        /// <summary>Edits a component's part in the assembly (Edit Part) and verifies that it became the edit target.
        /// While editing: sketch points do not select with Select4 (Pick falls back to SelectSketchPointAt), relations go
        /// through Relate, layout-sketch entities select only as EXTSKETCHSEGMENT/EXTSKETCHPOINT, and AddDimension2 takes its
        /// text position in assembly coordinates.</summary>
        public void EditInContext(IModelDoc2 assembly, IComponent2 component)
        {
            Step("edit in context " + component.Name2);
            Doc = assembly;
            assembly.ClearSelection2(true);
            if (!component.Select4(false, null, false)) throw new CadException("Component " + component.Name2 + " was not selected");
            int information = 0;
            int status = ((IAssemblyDoc)assembly).EditPart2(true, false, ref information);
            assembly.ClearSelection2(true);
            IModelDoc2 target = ((IAssemblyDoc)assembly).GetEditTarget() as IModelDoc2;
            IModelDoc2 part = (IModelDoc2)component.GetModelDoc2();
            bool same = target != null && part != null && (target.GetPathName() == part.GetPathName()) && target.GetTitle() == part.GetTitle();
            if (!same) throw new CadException("EditPart2 did not enter " + component.Name2 + " (status " + status + ", information " + information + ")");
        }

        /// <summary>Leaves in-context editing and returns to editing the assembly itself. Close any open sketch first.</summary>
        public void EndEditInContext(IModelDoc2 assembly)
        {
            if (assembly.SketchManager.ActiveSketch != null) throw new CadException("A sketch is still open: CloseSketch before EndEditInContext");
            ((IAssemblyDoc)assembly).EditAssembly();
            Doc = assembly;
            if (!assembly.IsEditingSelf()) throw new CadException("EditAssembly did not return to the assembly");
            Step("edit assembly");
        }

        /// <summary>The assembly-context counterpart of a feature of the part being edited in context. CloseSketch returns
        /// the part-level feature, which selects nothing in the assembly (the feature call then returns null): pass
        /// InContextFeature(component, sketch) to Extrude, ExtrudeToward, Sweep ... while Doc is the assembly. Volume-based
        /// direction checks (Cut with alongNormal null) measure part bodies, so give cuts in context an explicit direction.</summary>
        public IFeature InContextFeature(IComponent2 component, IFeature partFeature)
        {
            IFeature f = (IFeature)component.FeatureByName(partFeature.Name);
            if (f == null) throw new CadException("Feature " + partFeature.Name + " not found in component " + component.Name2);
            return f;
        }

        /// <summary>Saves a virtual (in-assembly) part to its own file (the component takes the file name). Leave in-context
        /// editing first and keep the assembly saved.</summary>
        public void SaveVirtualPart(IComponent2 component, string path)
        {
            Step("save virtual part " + path);
            if (!component.IsVirtual) throw new CadException(component.Name2 + " is not a virtual component");
            if (File.Exists(path)) throw new CadException("File exists already: " + path);
            if (!component.SaveVirtualComponent(path)) throw new CadException("SaveVirtualComponent failed: " + path);
            if (!File.Exists(path)) throw new CadException("SaveVirtualComponent returned true but wrote no file: " + path);
            Note("saved virtual part " + path + " as " + component.Name2);
        }

        /// <summary>Coincident mate between two named reference planes of two components (closest alignment).</summary>
        public IFeature MatePlanes(IModelDoc2 assembly, IComponent2 a, string planeA, IComponent2 b, string planeB)
        {
            IFeature fa = (IFeature)a.FeatureByName(planeA), fb = (IFeature)b.FeatureByName(planeB);
            if (fa == null || fb == null) throw new CadException("Mate plane missing: " + planeA + " / " + planeB);
            return Mate(assembly, swMateType_e.swMateCOINCIDENT, swMateAlign_e.swMateAlignCLOSEST, 0, fa, fb);
        }

        /// <summary>Any two-entity mate (COINCIDENT, CONCENTRIC, PARALLEL, PERPENDICULAR, DISTANCE, ...). Entities must be in
        /// assembly context: component features (IComponent2.FeatureByName) or faces/edges mapped with InComponent. distanceMm
        /// is used by DISTANCE mates. Throws with the AddMate5 error code when the mate is not created.</summary>
        public IFeature Mate(IModelDoc2 assembly, swMateType_e type, swMateAlign_e align, double distanceMm, object a, object b)
        {
            assembly.ClearSelection2(true);
            SelectData mark = (SelectData)((ISelectionMgr)assembly.SelectionManager).CreateSelectData();
            mark.Mark = 1;
            try
            {
                if (!SelectForMate(a, false, mark) || !SelectForMate(b, true, mark)) throw new CadException("Mate selection failed (" + type + ")");
            }
            catch (System.Runtime.InteropServices.COMException e)
            {
                if ((uint)e.ErrorCode != 0x80010108) throw;
                throw new CadException("Mate " + type + ": a face/edge handle expired (RPC_E_DISCONNECTED). Entities taken before an " +
                    "assembly change (inserting a component, adding a mate, rebuilding) are invalid: fetch them again right before each Mate.");
            }
            int error;
            double d = distanceMm * Mm;
            object mate = ((IAssemblyDoc)assembly).AddMate5((int)type, (int)align, false, d, d, d, 0, 0, 0, 0, 0, false, false, 0, out error);
            assembly.ClearSelection2(true);
            if (mate == null || error != (int)swAddMateError_e.swAddMateError_NoError)
                throw new CadException("Mate " + type + " failed, error " + error);
            return (IFeature)mate;
        }

        static bool SelectForMate(object item, bool append, SelectData mark)
        {
            if (item is IFeature) return ((IFeature)item).Select2(append, 1);
            if (item is IEntity) return ((IEntity)item).Select4(append, mark);
            return false;
        }

        /// <summary>Maps a face, edge, vertex or feature taken from a part document to the given component in the assembly.
        /// The part document must be showing the configuration the component references (GetCorrespondingEntity returns
        /// nothing across configurations); ComponentFaces avoids the mapping altogether.</summary>
        public object InComponent(IComponent2 component, object partEntity)
        {
            object mapped = component.GetCorrespondingEntity(partEntity);
            if (mapped == null)
            {
                IModelDoc2 model = (IModelDoc2)component.GetModelDoc2();
                string shown = model == null ? "?" : model.ConfigurationManager.ActiveConfiguration.Name;
                throw new CadException("Entity has no counterpart in component " + component.Name2 + " (component uses configuration '"
                    + component.ReferencedConfiguration + "', the part shows '" + shown + "'; activate that configuration in the part first, or use ComponentFaces)");
            }
            return mapped;
        }

        /// <summary>Faces of a component's solid bodies in assembly context (selectable for mates without mapping). Surface
        /// parameters of these faces are in the component's own part coordinates.</summary>
        public List<IFace2> ComponentFaces(IComponent2 component)
        {
            List<IFace2> faces = new List<IFace2>();
            object info;
            object[] bodies = (object[])component.GetBodies3((int)swBodyType_e.swSolidBody, out info);
            if (bodies == null) return faces;
            foreach (object b in bodies)
            {
                object[] fs = (object[])((IBody2)b).GetFaces();
                if (fs != null) foreach (object f in fs) faces.Add((IFace2)f);
            }
            return faces;
        }

        /// <summary>Face hit by a ray from a model/assembly point (mm) along dir (any length), in the document's own context
        /// (an assembly returns the component face, ready for mates). Use it to pick faces that assembly features created
        /// (Hole Wizard holes, assembly cuts), which part documents and ComponentFaces do not contain.</summary>
        public IFace2 FaceByRay(IModelDoc2 doc, double[] fromMm, double[] dir)
        {
            doc.ClearSelection2(true);
            double n = Math.Sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
            bool hit = doc.Extension.SelectByRay(fromMm[0] * Mm, fromMm[1] * Mm, fromMm[2] * Mm, dir[0] / n, dir[1] / n, dir[2] / n, 0.0002,
                (int)swSelectType_e.swSelFACES, false, 0, 0);
            IFace2 face = hit ? ((ISelectionMgr)doc.SelectionManager).GetSelectedObject6(1, -1) as IFace2 : null;
            doc.ClearSelection2(true);
            if (face == null) throw new CadException("No face along the ray from " + string.Join(", ", fromMm.Select(v => Math.Round(v, 3))) + " mm");
            return face;
        }

        /// <summary>Hole Wizard holes at the points where rays from fromMm along dir first hit a face (all rays should land on
        /// the same face). HoleWizard5 places only the FIRST pre-selected point even when several are selected, so the
        /// remaining positions are added to the hole's placement sketch (AddHolePositions) and the count is verified.
        /// Works in a part and as an assembly feature (it cuts every component it reaches; not propagated to the parts).
        /// type/standard/fastener are swWzdGeneralHoleTypes_e / swWzdHoleStandards_e / swWzdHoleStandardFastenerTypes_e, e.g.
        /// swWzdCounterSink + swStandardISO + swStandardISOSocketCTSKFlatHead + "M6". diameterMm &lt;= 0 takes the standard's
        /// normal-fit size; countersink/counterbore sizes come from the standard.</summary>
        public IFeature HoleWizardAt(swWzdGeneralHoleTypes_e type, swWzdHoleStandards_e standard, swWzdHoleStandardFastenerTypes_e fastener,
            string size, double diameterMm, double depthMm, double[][] fromMm, double[] dir, string name)
        {
            return HoleWizardAt(type, standard, fastener, size, swEndConditions_e.swEndCondBlind, diameterMm, depthMm, null, false, fromMm, dir, name);
        }

        /// <summary>Full form: end condition (Blind, ThroughAll, UpToNext...), the 12 type-specific HoleWizard5 values in API
        /// units (metres/radians, -1 = standard default; null = all defaults; see the HoleWizard5 remarks, e.g. a bottoming
        /// tapped hole: {threadDepthM, -1, -1, -1, -1, -1, (int)swCosmeticThreadWithCallout, (int)swEndThreadTypeBLIND, -1, -1, -1, -1})
        /// and propagateToParts for an assembly feature that should also create the hole in each part it cuts (as Hole Series
        /// does). A size string the standard does not know (e.g. "M5" where the table says "M5x0.8") fails with a null feature.</summary>
        public IFeature HoleWizardAt(swWzdGeneralHoleTypes_e type, swWzdHoleStandards_e standard, swWzdHoleStandardFastenerTypes_e fastener,
            string size, swEndConditions_e end, double diameterMm, double depthMm, double[] values, bool propagateToParts,
            double[][] fromMm, double[] dir, string name)
        {
            double[] v = values ?? new double[] { -1, -1, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1 };
            if (v.Length != 12) throw new CadException(name + ": HoleWizard5 takes exactly 12 values");
            Doc.ClearSelection2(true);
            double n = Math.Sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
            List<double[]> hits = new List<double[]>();
            ISelectionMgr sel = (ISelectionMgr)Doc.SelectionManager;
            foreach (double[] p in fromMm)
            {
                bool hit = Doc.Extension.SelectByRay(p[0] * Mm, p[1] * Mm, p[2] * Mm, dir[0] / n, dir[1] / n, dir[2] / n, 0.0005,
                    (int)swSelectType_e.swSelFACES, hits.Count > 0, 0, 0);
                if (!hit) throw new CadException(name + ": the ray from " + string.Join(", ", p) + " mm hit no face");
                double[] at = (double[])sel.GetSelectionPoint2(sel.GetSelectedObjectCount2(-1), -1);
                hits.Add(at.Select(c => c * 1000).ToArray());
            }
            // HoleWizard5 uses only the first selected position; the others go into the placement sketch afterwards.
            Doc.ClearSelection2(true);
            Doc.Extension.SelectByRay(fromMm[0][0] * Mm, fromMm[0][1] * Mm, fromMm[0][2] * Mm, dir[0] / n, dir[1] / n, dir[2] / n, 0.0005,
                (int)swSelectType_e.swSelFACES, false, 0, 0);
            bool assembly = Doc.GetType() == (int)swDocumentTypes_e.swDocASSEMBLY;
            bool tap = type == swWzdGeneralHoleTypes_e.swWzdTap || type == swWzdGeneralHoleTypes_e.swWzdPipeTap;
            object made = Doc.FeatureManager.HoleWizard5((int)type, (int)standard, (int)fastener, size, (short)end,
                diameterMm > 0 ? diameterMm * Mm : -1, depthMm * Mm, tap ? -1 : 0, v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], "",
                false, !assembly, true, assembly, assembly, propagateToParts);
            Doc.ClearSelection2(true);
            IFeature hole = Checked(made, name);
            if (hits.Count > 1) AddHolePositions(hole, hits.Skip(1).ToArray());
            return hole;
        }

        /// <summary>Placement sketch (first sketch sub-feature) of a Hole Wizard / Advanced Hole feature.</summary>
        public IFeature HolePlacementSketch(IFeature hole)
        {
            IFeature sub = (IFeature)hole.GetFirstSubFeature();
            while (sub != null && sub.GetTypeName2() != "ProfileFeature") sub = (IFeature)sub.GetNextSubFeature();
            if (sub == null) throw new CadException(hole.Name + ": no placement sketch");
            return sub;
        }

        /// <summary>Adds hole centres at model/assembly points (mm, on the placement face) to an existing Hole Wizard feature,
        /// rebuilds and verifies the number of hole centres in its placement sketch. Returns that count.</summary>
        public int AddHolePositions(IFeature hole, params double[][] pointsMm)
        {
            IFeature sketchFeature = HolePlacementSketch(hole);
            ISketch sketch = (ISketch)sketchFeature.GetSpecificFeature2();
            int before = ((object[])sketch.GetSketchPoints2() ?? new object[0]).Length;
            Doc.ClearSelection2(true);
            if (!sketchFeature.Select2(false, 0)) throw new CadException(hole.Name + ": placement sketch not selectable");
            Doc.EditSketch();
            if (Doc.GetActiveSketch2() == null) throw new CadException(hole.Name + ": placement sketch did not open");
            foreach (double[] p in pointsMm)
            {
                double[] s = ToSketch(p[0], p[1], p[2]);
                object point = Exact(() => (object)Doc.SketchManager.CreatePoint(s[0], s[1], 0));
                if (point == null) throw new CadException(hole.Name + ": hole centre not created at " + string.Join(", ", p));
            }
            Doc.SketchManager.InsertSketch(true);
            Doc.ForceRebuild3(false);
            int after = ((object[])((ISketch)HolePlacementSketch(hole).GetSpecificFeature2()).GetSketchPoints2() ?? new object[0]).Length;
            if (after != before + pointsMm.Length)
                throw new CadException(hole.Name + ": placement sketch has " + after + " points, expected " + (before + pointsMm.Length));
            return after;
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

        /// <summary>Interfering component pairs with their volume, sorted: "A-1 x B-1 : 12.5 mm3". Use this instead of a
        /// bare count when reference envelopes are expected to overlap, so new clashes are not hidden among known ones.</summary>
        public List<string> InterferencePairs(IModelDoc2 assembly)
        {
            IInterferenceDetectionMgr mgr = (IInterferenceDetectionMgr)((IAssemblyDoc)assembly).InterferenceDetectionManager;
            List<string> pairs = new List<string>();
            try
            {
                mgr.TreatCoincidenceAsInterference = false;
                mgr.TreatSubAssembliesAsComponents = false;
                object[] found = (object[])mgr.GetInterferences();
                if (found != null)
                {
                    foreach (object o in found)
                    {
                        IInterference it = (IInterference)o;
                        string[] names = ((object[])it.Components).Select(c => ((IComponent2)c).Name2.Split('/').Last()).OrderBy(n => n).ToArray();
                        pairs.Add(string.Join(" x ", names) + " : " + Math.Round(it.Volume * 1e9, 1) + " mm3");
                    }
                }
            }
            finally
            {
                mgr.Done();
            }
            pairs.Sort();
            return pairs;
        }

        /// <summary>InterferencePairs with where each clash is: "A-1 x B-1 : 12.5 mm3 @ x..x, y..y, z..z" (assembly mm, box of
        /// the interference body). Use it to see which leg of a route or which feature collides before changing geometry.</summary>
        public List<string> InterferenceDetails(IModelDoc2 assembly)
        {
            IInterferenceDetectionMgr mgr = (IInterferenceDetectionMgr)((IAssemblyDoc)assembly).InterferenceDetectionManager;
            List<string> pairs = new List<string>();
            try
            {
                mgr.TreatCoincidenceAsInterference = false;
                mgr.TreatSubAssembliesAsComponents = false;
                object[] found = (object[])mgr.GetInterferences();
                foreach (object o in found ?? new object[0])
                {
                    IInterference it = (IInterference)o;
                    string[] names = ((object[])it.Components).Select(c => ((IComponent2)c).Name2.Split('/').Last()).OrderBy(n => n).ToArray();
                    string where = "";
                    IBody2 body = it.GetInterferenceBody() as IBody2;
                    if (body != null)
                    {
                        double[] b = ((double[])body.GetBodyBox()).Select(v => Math.Round(v * 1000, 1)).ToArray();
                        where = " @ x " + b[0] + ".." + b[3] + ", y " + b[1] + ".." + b[4] + ", z " + b[2] + ".." + b[5];
                    }
                    pairs.Add(string.Join(" x ", names) + " : " + Math.Round(it.Volume * 1e9, 1) + " mm3" + where);
                }
            }
            finally
            {
                mgr.Done();
            }
            pairs.Sort();
            return pairs;
        }

        // ------------------------------------------------------------------ previews

        /// <summary>Saves the active view of Doc as an image (png/jpg by extension) looking along -towardViewer with screen-up
        /// close to up (model directions). Shaded with edges; planes, sketches and origins hidden; view settings restored.
        /// The image is a viewport capture at window size, not a render.</summary>
        public void CaptureView(string path, double[] towardViewer, double[] up)
        {
            double[] z = Unit(towardViewer);
            double dot = up[0] * z[0] + up[1] * z[1] + up[2] * z[2];
            double[] y = Unit(new double[] { up[0] - dot * z[0], up[1] - dot * z[1], up[2] - dot * z[2] });
            double[] x = { y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0] };
            IModelView view = (IModelView)Doc.ActiveView;
            if (view == null) throw new CadException("CaptureView: the document has no view (Activate it first)");
            int hideTypes = (int)swUserPreferenceToggle_e.swViewDisplayHideAllTypes, noOption = (int)swUserPreferenceOption_e.swDetailingNoOptionSpecified;
            bool hideWas = Doc.Extension.GetUserPreferenceToggle(hideTypes, noOption);
            int modeWas = view.DisplayMode;
            try
            {
                Doc.Extension.SetUserPreferenceToggle(hideTypes, noOption, true);
                view.DisplayMode = (int)swViewDisplayMode_e.swViewDisplayMode_ShadedWithEdges;
                double[] arr = { x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2], 0, 0, 0, 1, 0, 0, 0 };
                view.Orientation3 = (MathTransform)MathUtil.CreateTransform(arr);
                Doc.ViewZoomtofit2();
                Doc.GraphicsRedraw2();
                Export(path);
            }
            finally
            {
                Doc.Extension.SetUserPreferenceToggle(hideTypes, noOption, hideWas);
                view.DisplayMode = modeWas;
            }
        }

        /// <summary>Saves a named view in the model looking along -towardViewer with screen-up close to up (model directions),
        /// for drawings of models whose 'up' is not +Y: use the name as the orientation of ModelView/StandardViews
        /// (CreateDrawViewFromModelView3 accepts named views). Returns the name.</summary>
        public string SaveNamedView(string name, double[] towardViewer, double[] up)
        {
            double[] z = Unit(towardViewer);
            double dot = up[0] * z[0] + up[1] * z[1] + up[2] * z[2];
            double[] y = Unit(new double[] { up[0] - dot * z[0], up[1] - dot * z[1], up[2] - dot * z[2] });
            double[] x = { y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0] };
            IModelView view = (IModelView)Doc.ActiveView;
            if (view == null) throw new CadException("SaveNamedView: the document has no view (Activate it first)");
            double[] arr = { x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2], 0, 0, 0, 1, 0, 0, 0 };
            view.Orientation3 = (MathTransform)MathUtil.CreateTransform(arr);
            Doc.ViewZoomtofit2();
            Doc.DeleteNamedView(name);
            Doc.NameView(name);   // void: verify by the list of view names
            object names = Doc.GetModelViewNames();
            if (!(names is string[]) || !((string[])names).Contains(name)) throw new CadException("SaveNamedView: view " + name + " was not saved");
            Step("named view " + name);
            return name;
        }

        static double[] Unit(double[] v)
        {
            double l = Math.Sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
            if (l < 1e-12) throw new CadException("zero direction");
            return new double[] { v[0] / l, v[1] / l, v[2] / l };
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
            // File names carry the body name (body order is not stable across rebuilds); duplicates get an index.
            List<string> names = new List<string>();
            foreach (IBody2 b in Bodies())
            {
                string safe = Regex.Replace(b.Name ?? "body", @"[^A-Za-z0-9_\-]+", "_");
                string unique = safe;
                for (int k = 2; names.Contains(unique); k++) unique = safe + "_" + k;
                names.Add(unique);
            }
            try
            {
                foreach (int k in toggles) App.SetUserPreferenceToggle(k, true);
                App.SetUserPreferenceIntegerValue(quality, (int)swSTLQuality_e.swSTLQuality_Fine);
                for (int i = 0; i < count; i++)
                {
                    // Body handles do not survive an export (RPC_E_DISCONNECTED): fetch them again for every step.
                    List<IBody2> bodies = Bodies();
                    for (int j = 0; j < bodies.Count; j++) bodies[j].HideBody(j != i);
                    string path = Path.Combine(folder, prefix + (count > 1 ? "_" + names[i] : "") + ".stl");
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
            if (data.Length < 84) throw new CadException("Not a binary STL (too short): " + path);
            int n = BitConverter.ToInt32(data, 80);
            if ((long)data.Length != 84L + 50L * n) throw new CadException("Not a binary STL (size does not match " + n + " triangles): " + path);
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
