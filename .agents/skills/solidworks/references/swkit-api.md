# SwKit API index (generated)

Generated from `scripts/lib/SwKit.cs` by `scripts/kit-index.ps1`; do not edit by hand. Regenerate after changing the kit
(`powershell.exe -NoProfile -File scripts/kit-index.ps1`); `-Check` exits 1 when this file is stale and the offline suite
runs it. Lengths are millimetres and angles degrees unless a name says otherwise. Search this file for a verb (Extrude,
Section, Mate, Bom ...) before writing raw API, then read the full `///` summary in SwKit.cs. 235 members.

## CadException

- `CadException: CadException(string message) : base(message)`

## DialogAnswerer

- `DialogAnswerer: List<string> Answered = new List<string>()`
- `DialogAnswerer: List<string> Unanswered = new List<string>()`
- `DialogAnswerer: void Dispose()`

## Session and logging

- `const double Mm`
- `ISldWorks App`
- `IMathUtility MathUtil`
- `List<string> Log = new List<string>()`
- `IModelDoc2 Doc`
- `Cad(object application)`
- `void Note(string message)`
- `string ProgressPath` - File that every Note and kit step is appended to as it starts (the runner sets it to progress.log in the run directory). When a job times out, its last line names the call that did not return.
- `void Step(string message)` - Records the step about to run in ProgressPath only (not in Log).

## Job arguments

- `string ArgString(IDictionary<string, object> args, string key)`
- `double ArgDouble(IDictionary<string, object> args, string key)`
- `double ArgDouble(IDictionary<string, object> args, string key, double fallback)`
- `int ArgInt(IDictionary<string, object> args, string key)`
- `bool ArgBool(IDictionary<string, object> args, string key)`
- `bool ArgBool(IDictionary<string, object> args, string key, bool fallback)`

## Documents

- `string Template(string kind)`
- `IModelDoc2 NewDocument(string kind, bool millimetres)` - New part ("Part") or assembly ("Assembly"); becomes Doc. MMGS units when millimetres is true.
- `IModelDoc2 NewDocumentFrom(string templatePath, bool millimetres)` - New part, assembly or drawing from an explicit template file (a course or company template); becomes Doc. MMGS units when millimetres is true (ignored for drawings).
- `IModelDoc2 Open(string path, string configuration)` - Returns the already open document or opens it silently; becomes Doc.
- `void Activate(IModelDoc2 doc)` - Gives the document a window; required before sketching in it.
- `void SaveAs(string path)` - Saves (or exports by extension). After the first SaveAs of a new document, feature, face, edge and body handles taken earlier can be disconnected (RPC_E_DISCONNECTED): look them up again afterwards.
- `void Export(string path)` - Export by extension (.step, .x_t, .pdf ...). The document keeps its own path.
- `void Close(IModelDoc2 doc, bool discardChanges)` - Closes a document this job created or opened. Refuses unsaved changes unless discard is true.
- `List<string> DirtyDocuments()` - Paths of open documents with unsaved changes. Switching assembly configurations marks referenced parts dirty without any edit, so decide per folder what to save and what is only rebuild state.
- `List<string> CloseDocumentsUnder(string folder, bool discardChanges)` - Closes every open document stored under folder, re-reading the document list after each close (closing an assembly can close its parts, which would disconnect a pre-built list). Refuses a document with unsaved changes unless discardChanges is true.
- `List<string> SaveDirtyUnder(string folder)` - Saves every dirty document stored under folder (the job's own files) and returns their paths.

## Features and lookup

- `List<IFeature> Features(string typeName)`
- `IFeature Feature(string name)`
- `IFeature[] DefaultPlanes()` - Front, Top and Right planes in template order, independent of their (localised) names.
- `IFeature Checked(object created, string name)` - Fails on null or on a non-warning error code, then names the feature.
- `void Delete(IFeature feature)`
- `List<IBody2> Bodies()`
- `double VolumeMm3()`
- `double[] ExtentsMm(IBody2 body)` - Exact extents [minX, minY, minZ, maxX, maxY, maxZ] in mm (GetBodyBox can be loose on curved bodies).
- `IFace2 PlanarFace(double nx, double ny, double nz, double offsetMm)` - Largest planar face whose outward normal is (nx, ny, nz) and whose plane lies at offsetMm measured ALONG that normal: the dot product of a point on the plane with the unit normal.
- `IFace2 PlanarFaceAt(int axis, double coordinateMm, int outwardSign)` - Planar face lying at coordinateMm on model axis (0=X, 1=Y, 2=Z) whose outward normal points along +axis (outwardSign +1) or -axis (-1). PlanarFaceAt(1, 48, -1) is the face at Y = 48 facing -Y.
- `IEdge EdgeBetween(double[] aMm, double[] bMm)` - Straight edge whose end points are a and b (mm, either order).
- `IEdge EdgeAt(double xMm, double yMm, double zMm, int axis)` - Straight edge running along the model axis (0=X, 1=Y, 2=Z) that passes through the model point (mm). Unlike EdgeBetween it still finds an edge after earlier fillets or chamfers have moved its end points.
- `IEdge EdgeAlong(int axis, double minLengthMm)` - First straight edge parallel to the model axis (0=X, 1=Y, 2=Z) and at least minLengthMm long.

## Sketches

- `ISketch OpenSketch(object planeOrFace)` - Opens a sketch on a plane feature or planar face and returns it.
- `IFeature CloseSketch(string name, out int constrainedStatus)` - Closes the open sketch, names it and returns (feature, constrained status: 2 under, 3 fully, 4 over defined).
- `double[] ToSketch(double xMm, double yMm, double zMm)` - Model point (mm) to coordinates of the open sketch (metres). Use for every entity: sketch axes vary by plane.
- `string AxisKind(int axis)` - "h" or "v": how the model axis (0=X, 1=Y, 2=Z) runs in the open sketch.
- `T Exact<T>(Func<T> draw)` - Runs entity creation with AddToDB on and display off (no snapping, no auto relations); restores both.
- `T NoInference<T>(Func<T> draw)` - Exact() plus sketch inference and automatic relations off. Needed for CreateSketchSlot, which can still snap.
- `void Pick(params object[] items)` - Selects sketch segments, sketch points, entities or the string "origin", in order.
- `bool SelectSketchPointAt(ISketchPoint point, bool append)` - Selects a sketch point by position in the active document: the sketch point is mapped to model space and, while a component is edited in an assembly, through that component's transform. Used by Pick as the in-context fallback.
- `void Relate(string relation, params object[] items)` - Adds a sketch relation such as sgHORIZONTAL2D, sgVERTICAL2D, sgCOINCIDENT, sgSAMELENGTH, sgMERGEPOINTS, sgVERTICALPOINTS2D.
- `IDimension Dim(string kind, double[] atM, params object[] items)` - Adds a driving dimension (kind "h", "v" or null for length/diameter/distance) with its text at atM (sketch metres). Returns the dimension; throws if it came back driven (reference), which would silently ignore values and equations.
- `IDimension Dim3D(double[] atMm, params object[] items)` - Dimension in a 3D sketch: the text goes at a model point (mm). kind null gives a length, diameter, distance or angle (two lines); a line and a plane give their distance.
- `string ShortName(IDimension d)` - Short dimension name ("D3") for equations: "D3@SketchName".
- `IDimension Locate(ISketchPoint point, int axis, double valueMm, double textOffsetMm)` - Locates a sketch point from the origin along a model axis. A zero coordinate becomes a relation (zero-length dimensions fail); otherwise a driving dimension is returned.
- `ISketchLine[] Polygon(params double[][] pointsMm)` - Closed polygon through model points (mm). Joins corners and adds horizontal/vertical relations to axis-aligned edges; positions are left to the caller's dimensions. Returns the lines in point order.
- `ISketchArc Circle(double xMm, double yMm, double zMm, double diameterMm)` - Circle at a model point (mm) with a diameter in mm. Use Dim(null, ..., circle) for its diameter.
- `ISketchPoint Center(ISketchArc arc)`
- `ISketchPoint[] Slot(double[] aMm, double[] bMm, double widthMm)` - Straight slot between two model centre points (mm) with its width and centre-to-centre length dimensions.

## Drawings

- `IDrawingDoc Drawing` - The current document as a drawing (throws when it is not one).
- `ISheet CurrentSheet`
- `double[] SheetSizeMm()` - Sheet width and height in mm.
- `bool FirstAngle` - True for first-angle projection (ISO/European): the top view goes below the front view.
- `IDrawingDoc NewDrawing(string templatePath, string sheetFormatPath)` - New drawing from a template. Templates often name their sheet-format file by the author's absolute path (a network share); when that file is missing and sheetFormatPath is given, the sheet is set up again with the local format at the same size, scale and proje ...
- `IView ModelView(string modelPath, string orientation, double xMm, double yMm)` - Named model view ("*Front", "*Top", "*Right", "*Isometric", ...) of a saved part or assembly, centred at (x, y) mm on the sheet.
- `IView ProjectedView(IView parent, double xMm, double yMm)` - Projection of parent placed towards (x, y) mm; it stays aligned with its parent.
- `double[] OutlineMm(IView view)` - View outline [x1, y1, x2, y2] in sheet mm.
- `void CentreView(IView view, double xMm, double yMm)` - Moves a view so its outline centre lands at (x, y) mm. A projected view only moves along its projection.
- `List<IView> SheetViews()` - Views of the current sheet in creation order (the sheet itself excluded).
- `double[] TitleBlockMm()` - Rectangle [x1, y1, x2, y2] mm around the sheet format's property-linked notes in the lower part of the sheet (the title block), padded by 6 mm. Null when the format has none there.
- `double[] TableBoxMm(ITableAnnotation table)` - Sheet box [x0, y0, x1, y1] mm of a table from its anchor position and row/column sizes.
- `void SetTableTextHeight(ITableAnnotation table, double heightMm)` - Text height (mm) of every cell of a table, e.g. 2.5 for a compact BOM.
- `void SetTableRowHeights(ITableAnnotation table, double heightMm)` - Sets every row of a table to heightMm (rows keep the template's height when the text gets smaller; wrapped cells need the extra height, so widen columns first).
- `Dictionary<string, object> DrawingLayout()` - Layout problems of the current sheet: views outside the sheet, overlapping each other or the title block. Empty lists mean a clean layout.
- `List<IView> StandardViews(string modelPath, string frontOrientation, bool withBelow, bool withBeside, bool isometric, double gapMm)` - Front view plus its projections below (top view in first angle) and beside it, and optionally an isometric view, at the largest ISO scale (10:1 ... 1:50) where all views fit the sheet with gapMm between them and clear of the title block.
- `int InsertModelDimensions()` - Inserts the model's dimensions marked for drawing into all views (no duplicates). Returns how many arrived.
- `List<string> ViewDimensions(IView view)` - Dimensions shown in a view: "name=value" in mm (or degrees), reference ones marked.
- `Dictionary<string, IDisplayDimension> ViewDisplayDimensions(IView view)` - Display dimensions of a view keyed by full dimension name.
- `int InsertModelDimensionsInto(IView view)` - Inserts the model dimensions marked for drawing that can show in this one view (dimensions already shown elsewhere are skipped). Insert view by view in priority order to choose where each dimension lands.
- `double[] SheetToViewSketch(IView view, double xMm, double yMm)` - Sheet point (mm) -> coordinates (metres) in the view's own sketch. An activated drawing view sketches in its model space (origin at the model origin, model lengths), not in sheet coordinates, so section lines and detail circles given in sheet mm must be conver ...
- `IView SectionView(IView parent, double[] aMm, double[] bMm, string label, double xMm, double yMm, bool flip, bool aligned = true, bool partial = false, double depthMm = 0)` - Section view of parent cut along the sheet line a-b (sheet mm), placed at (x, y) sheet mm. flip reverses the viewing direction. Surface bodies are not cut.
- `IView DetailView(IView parent, double cxMm, double cyMm, double rMm, string label, double num, double den, double xMm, double yMm)` - Detail view of parent: circle at (cx, cy) sheet mm with radius r mm, shown at scale num:den at (x, y).
- `void DeleteDimension(IDisplayDimension dd)` - Removes a dimension from a drawing view (the model keeps it).
- `List<string> TidyDimensions(List<IView> priority, List<IView> clear, string[] drop)` - After InsertModelDimensions: keeps each model dimension only in the first view of priority that shows it, deletes every dimension in the views of clear (isometric views), and deletes dimensions whose short name ("D1@Sweep1") is in drop.
- `void MoveDimension(IDisplayDimension dd, double xMm, double yMm)` - Moves a dimension's text to (x, y) sheet mm; for an angle this also sets the arc radius.
- `INote AddNote(string text, double xMm, double yMm)` - Note on the sheet with its text at (x, y) sheet mm.
- `double[] ToSheetMm(IView view, double xMm, double yMm, double zMm)` - Model point (mm) to sheet mm in a view.
- `List<IEdge> ViewEdges(IView view, IComponent2 component)` - Edges visible in a view (part views; for an assembly pass the component).
- `IEdge ViewEdge(IView view, double xMm, double yMm, double zMm, double radiusMm)` - Visible straight edge of a view whose two end points (model mm) satisfy the given coordinates (NaN = any), or a circular edge of the given radius when radiusMm > 0. Null when none matches.
- `IDisplayDimension RefDim(IView view, object[] entities, double xMm, double yMm, string kind)` - Reference dimension in a view between one or two entities (edges, vertices, sketch segments) with its text at (x, y) sheet mm. kind "h"/"v" for horizontal/vertical on the sheet, null for length/diameter/distance/angle.
- `void SetProperty(IModelDoc2 doc, string name, string value, string configuration)` - Sets a text custom property (file level when configuration is "") on a part, assembly or drawing.
- `Dictionary<string, string> TitleBlockText()` - Title block fields after a rebuild: linked text -> shown text, for property-linked sheet-format notes.
- `List<string[]> Bom(IView view, double xMm, double yMm, string templatePath)` - Bill of materials (parts only, standard template unless one is given) anchored by its top left corner at (x, y) sheet mm on an assembly view. Returns the table rows, header first.
- `IBomTableAnnotation BomTable(IView view, double xMm, double yMm, string templatePath)` - Bill of materials like Bom, returning the annotation for further edits (AddBomPropertyColumn, TableCells).
- `IBomTableAnnotation BomTable(IView view, double xMm, double yMm, string templatePath, swBomType_e bomType)` - BomTable with a BOM type: swBomType_TopLevelOnly lists subassemblies as single rows (large purchased or starter subassemblies), swBomType_Indented lists them with their parts.
- `int AddBomPropertyColumn(IBomTableAnnotation bom, string title, string property)` - Appends a BOM column filled from a component custom property (e.g. "Material", or a property whose value is the linked expression "SW-Material@Part.SLDPRT"). Returns the new column index.
- `List<string[]> TableCells(ITableAnnotation table)`
- `List<string> AutoBalloons(IView view)` - Balloons on every component of an assembly view (one per BOM item). Returns their texts.
- `string Balloon(IView view, string component, double xMm, double yMm)` - One BOM balloon on a component visible in an assembly view (component Name2 such as "Kamera_Linssi-1" or its prefix "Kamera_Linssi"), placed at (x, y) sheet mm. Use it for items AutoBalloons leaves out (components hidden behind others in that view).
- `void SetTableColumnWidths(ITableAnnotation table, double[] widthsMm)` - Sets table column widths in mm (index order; null/0 keeps a column).
- `void LinkMassKg(IModelDoc2 model)` - Mass in kg for title blocks: sets the model's mass unit to kilograms (3 decimals) and links its custom property "Mass" to SW-Mass. The course sheet formats print $PRPSHEET:"Mass" followed by "kg".
- `void SaveDrawing(string drawingPath, string pdfPath)` - Saves the drawing (.SLDDRW) and exports it as PDF; checks both files exist.
- `Dictionary<string, object> DrawingReport()` - Views (name, type, scale, dimension count), layout problems, rebuild errors and save state of the drawing.

## 3D sketches

- `ISketch Open3DSketch()` - Opens an empty 3D sketch (model coordinates, no plane). Close it with CloseSketch.
- `ISketchLine Line3D(double[] aMm, double[] bMm, bool construction)` - Straight line between model points (mm) in the open 3D sketch, placed exactly (no snapping or automatic relations). Join shared end points with Relate("sgMERGEPOINTS", ...) and orient with sgALONGX3D/sgALONGY3D/ sgALONGZ3D or sgPARALLELYZ3D/sgPARALLELZX3D.
- `ISketchLine[] Polyline3D(params double[][] pointsMm)` - Open polyline through model points (mm) in a 3D sketch, end points merged. Returns the lines in order.
- `ISketchArc Arc3Points(double[] startMm, double[] endMm, double[] midMm)` - Arc through three model points (mm): start, end and a point on the arc between them. Works in 3D sketches (the three points fix the arc's plane) and in 2D sketches.
- `ISketchPoint SketchPointAt(double xMm, double yMm, double zMm)` - The open sketch's point (end point, centre) at a model point (mm), after merges and fillets have replaced the original objects. Throws when none lies within 1 micrometre.
- `double[] SketchCoordinates(double[] modelMm)` - Model point (mm) to the open sketch's own coordinates (metres, 3 values; a 3D sketch uses model space).
- `ISketchSegment SketchFillet(ISketchPoint corner, double radiusMm)` - Sketch fillet at a corner point of the open 2D or 3D sketch; the corner is kept as a virtual sharp so dimensions and relations on it survive. Returns the new arc. Add its radius with Dim or Dim3D.
- `List<ISketchSegment> SegmentsAt(ISketchPoint point)` - Sketch lines of the open sketch that start or end at the given point (within 1 micrometre).
- `List<ISketchSegment> FilletedPolyline3D(double radiusMm, params double[][] pointsMm)` - Open 3D path through model points (mm) with every inner corner rounded by an exact tangent arc of radiusMm, built from lines and 3-point arcs with merged end points and tangent relations.
- `void SketchPlane3D(object first, int relation1, object second, int relation2)` - 3D sketch plane (Sketch > Plane inside the open 3D sketch) through the given references, each with a swConstraintType_e relation (COINCIDENT = 9, PARALLEL = 7, PERPENDICULAR = 8).
- `IFeature Sweep(IFeature profileSketch, IFeature pathSketch, string name)` - Swept boss of a closed profile sketch along a path sketch (2D or 3D). The profile should lie on a plane through the path's start point, normal to the path there.
- `ISketchSegment Spline(params double[][] pointsMm)` - Spline through model points (mm) in the open 2D or 3D sketch, placed exactly. A 2-point spline is fully defined by its end points; tangent relations at the ends then shape it without adding freedom.
- `IFeature CompositeCurve(object[] segments, string name)` - Composite curve feature from sketch segments or edges (a closed or open chain): the API counterpart of a SelectionManager group, usable as a loft profile, guide curve or sweep path.
- `IFeature LoftSurfaceFromGroups(List<object[]> profiles, List<object[]> guides, string name)` - Surface loft through profiles with guide curves, each given as a chain of segments of one (closed) 2D or 3D sketch, as the SelectionManager's Select Group does in the UI.
- `void ConvertEntities(params object[] items)` - Convert Entities: projects sketch segments or model edges into the open sketch (On Edge relations keep them linked). Use it to turn loops of a 3D sketch into closed 2D profiles.
- `IFeature LoftSurface(List<IFeature> profileSketches, List<object> guides, string name)` - Surface loft through profile sketches (each a closed loop) with guide curves. A guide may be a sketch feature, a sketch segment (its own contour in its sketch is selected) or an edge. Profiles get mark 1, guides mark 2.
- `List<ISketchPoint> SketchPointsAt(double xMm, double yMm, double zMm)` - Every point of the open sketch at a model point (mm): end points of different entities until merged.
- `void MergePointsAt(params double[][] pointsMm)` - Merges all sketch points at each given model point (mm) into one, joining the entities that end there.
- `IFeature SweepCircle(IFeature pathSketch, double diameterMm, double thinMm, bool thinInward, string name)` - Swept boss with the circular-profile option (no profile sketch) along a path sketch. thinMm > 0 makes a tube of that wall: inside the diameter when thinInward, else outside.
- `IFeature Extrude(IFeature sketch, string name, double depthMm, bool reverse, bool both, double depth2Mm)` - Boss from a sketch. depth2Mm with both=true extrudes the second direction; reverse flips direction 1.
- `IFeature Extrude(IFeature sketch, string name, double depthMm, bool reverse, bool both, double depth2Mm, bool merge)` - Extrude with an explicit merge choice. merge=false makes a separate solid body (reference envelopes, keep-out volumes, multibody parts); merge=true joins every body the new solid touches.
- `IFeature ExtrudeToward(IFeature sketch, string name, double depthMm, double[] towardMm)` - Blind boss of depthMm from a sketch toward a model point (mm): the direction along the sketch normal whose side holds towardMm.
- `IFeature Cut(IFeature sketch, string name, double depthMm, bool? alongNormal)` - Cut from a sketch; depthMm &lt;= 0 means through all. alongNormal true/false cuts that way and fails if nothing was removed.
- `IFeature CutThroughBoth(IFeature sketch, string name)` - Through-all cut in both directions from a sketch plane inside the body (a mid-plane): the clean way to make a hole through a part whose outer faces are not exactly planar. Checks that material was removed.
- `IFeature CutDrafted(IFeature sketch, string name, double depthMm, bool alongNormal, double draftDeg, bool outward)` - Blind (depthMm > 0) or through-all cut with a draft: inward narrows the cut with depth (a countersink cone from a circle on the face), outward widens it. Direction as in Cut: alongNormal true cuts along the sketch normal. Checks that material was removed.
- `IFeature ExtrudeDrafted(IFeature sketch, string name, double depthMm, bool reverse, double draftDeg, bool outward)` - Boss extrusion with a draft angle (inward tapers the walls toward the far end), blind depth, along the sketch normal unless reverse.
- `IFeature CutExpecting(IFeature sketch, string name, double depthMm, double expectedRemovedMm3, double toleranceMm3)` - Cut whose direction is chosen by the material it must remove: tries both directions and keeps the one whose removed volume is expectedRemovedMm3 within toleranceMm3. Use for holes through a specific wall or tab.
- `IFeature OffsetPlane(object reference, string name, double distanceMm, bool flip)` - Plane parallel to a plane feature or planar face, offset in mm. flip puts it on the opposite side.
- `IFeature Shell(IFace2[] openFaces, double thicknessMm, string name)` - Constant-wall shell removing the given faces (wall grows inward).
- `IFeature Fillet(IEdge[] edges, double radiusMm, string name)` - Constant-radius fillet on edges.
- `List<IEdge> SharpEdges(IBody2 body, double minAngleDeg)` - Edges of a body whose two faces meet at more than minAngleDeg: the edges a fillet or chamfer can take. Excludes the smooth seams between tangent faces (sweep segments, faces split at tangent joins), which fail when selected for a fillet.
- `List<Dictionary<string, object>> FaceReport(IBody2 body)` - One line per face of a body: index, surface kind, area, bounding box and (planar faces) the outward normal. Use it to find faces on non-prismatic bodies (sweeps, revolves, drafted extrudes) before picking them with FaceAt or by index.
- `IFace2 FaceAt(IBody2 body, double xMm, double yMm, double zMm, double toleranceMm)` - The face of the body nearest to a model point (mm), any surface type. Throws when the nearest face is farther than toleranceMm, so a wrong guess fails loudly instead of selecting a neighbouring face.
- `List<IEdge> FaceEdges(IEnumerable<IFace2> faces, bool excludeShared)` - All edges bounding the given faces, without duplicates. With excludeShared, edges that lie between two of the given faces are left out: the outer boundary of a face group (for example the front of a body split by a parting line), which is what a fillet around ...
- `double EdgeLengthMm(IEdge edge)` - Length of a model edge in mm.
- `List<IEdge> SharedEdges(IFace2 a, IFace2 b)` - Edges shared by two faces (where they meet).
- `List<IFace2> AdjacentFaces(IFace2 face)` - Faces next to a face (sharing at least one edge).
- `List<ISketchSegment> OffsetEntities(object[] items, double offsetMm, bool inward)` - Offset Entities in the open sketch: offsets model edges, faces (their loops) or sketch segments by offsetMm with the offset dimension.
- `IFeature CutBothDirections(IFeature sketch, string name, double depth1Mm, double depth2Mm)` - Cut from a mid-plane sketch in both directions: depth1Mm along the sketch normal and depth2Mm against it (0 = through all).

## DXF/DWG import

- `IFeature InsertDxf(object plane, string path, bool addConstraints, string name)` - Imports a DXF/DWG file as a sketch on a plane (Insert > DXF/DWG, 2D sketch, millimetres) and returns the sketch feature.
- `List<ISketchSegment> SketchSegmentsIn(IFeature sketchFeature, double minXMm, double minYMm, double maxXMm, double maxYMm)` - Segments of a sketch lying entirely inside a box in that sketch's own coordinates (mm). Use it to pick one view out of an imported multi-view drawing.
- `double[] SegmentBoxMm(ISketchSegment segment)` - Bounding box {minX, minY, maxX, maxY} of a sketch segment in sketch coordinates (mm), from its end points and, for arcs, the circle's extreme points that lie on the arc.
- `void MoveSketchEntities(List<ISketchSegment> segments, double dxMm, double dyMm)` - Moves sketch segments in the open sketch by (dx, dy) sketch mm (Move Entities, relations kept).
- `List<ISketchSegment> MirrorSketchEntities(List<ISketchSegment> segments, bool aboutY)` - Mirrors sketch segments of the open sketch about a sketch axis through the sketch origin (aboutY: the vertical axis x = 0, otherwise the horizontal axis y = 0) and deletes the originals.
- `ISketch EditSketch(IFeature sketchFeature)` - Opens an existing sketch for editing.
- `int KeepOnlySegments(List<ISketchSegment> keep)` - Deletes every segment of the open sketch except the given ones (keeps one view of an import).
- `IFeature ExtrudeRegions(IFeature sketch, List<double[]> regionPointsMm, string name, double[] vertex1Mm, double[] vertex2Mm, double depthMm)` - Extrudes chosen regions of a sketch (Selected Contours), each picked by a model point (mm) inside it.
- `List<ISketchSegment> CopySegmentsToNewSketch(List<ISketchSegment> source, object plane)` - Copies sketch segments (of any sketch, open or not) into a new sketch on a plane with Copy/Paste and leaves that sketch open.
- `double[] SegmentsBoxMm(IEnumerable<ISketchSegment> segments)` - Bounding box {minX, minY, maxX, maxY} of segments in their sketch's coordinates (mm).
- `void MoveSegmentsTo(List<ISketchSegment> segments, double[] cornerAMm, double[] cornerBMm)` - Moves segments of the open sketch so that their bounding box fits the model-space box spanned by two opposite corners (mm) on the sketch plane, for example a view onto the part origin. Checks the size matches.
- `ISketchRegion SketchRegionAt(IFeature sketchFeature, double xMm, double yMm, double zMm)` - The region of a sketch (closed area, as Selected Contours offers it) containing a model point (mm). SelectByID2("SKETCHREGION") does not find regions of a closed sketch reliably; this tests each region's loops.
- `bool RegionContains(ISketchRegion region, double xMm, double yMm, double zMm)` - True when a model point (mm) lies in a sketch region (its loop's temporary face).
- `List<ISketchRegion> SketchRegionsExcept(IFeature sketchFeature, params double[][] pointsMm)` - The sketch's regions except those containing any of the model points (mm). IsSame does not compare sketch regions reliably, so exclusion goes by position.
- `double RegionAreaMm2(ISketchRegion region)` - Area of a sketch region in mm² (from its loop's temporary face; inner loops are not subtracted).
- `IFeature ExtrudeRegionListMid(IFeature sketch, List<ISketchRegion> regions, string name, double totalMm)` - Mid-plane extrusion of sketch regions: totalMm split evenly on both sides of the sketch plane.
- `List<ISketchRegion> SketchRegions(IFeature sketchFeature)` - All closed regions of a sketch (what Selected Contours can pick).
- `IFeature ExtrudeRegionList(IFeature sketch, List<ISketchRegion> regions, string name, double depthMm, bool reverse)` - Blind extrusion (depthMm along the sketch normal, or against it with reverse) of a list of sketch regions (Selected Contours). Use with SketchRegions/SketchRegionAt for sketches whose regions are many or nested (logos, blocks, imported drawings).
- `IFeature ExtrudeRegionList(IFeature sketch, List<ISketchRegion> regions, string name, double depthMm, bool reverse, double startOffsetMm)` - As above, starting startOffsetMm from the sketch plane (in the extrusion direction): material that begins inside the part, for example the web between two grooves, without a cut.
- `ISketchBlockDefinition MakeBlock(List<ISketchSegment> segments, double xMm, double yMm, string name, string savePath)` - Make Block from segments of the open sketch with the insertion point at (x, y) sketch mm; names the block definition and, with savePath, saves it as a .SLDBLK file for reuse (Insert Block, Design Library).
- `IFeature AxisFromPlanes(IFeature planeA, IFeature planeB, string name)` - Reference axis where two planes meet (Top + Right gives the Z axis); for circular patterns.
- `IFeature CircularPattern(IEnumerable<IFeature> seeds, object axis, int count, string name)` - Equal-spaced circular pattern of features through 360 degrees about an axis (reference axis feature, straight edge or cylindrical face). count includes the seed. Checks that the volume changed.

## Surfaces

- `IFeature ProjectedCurve(IFeature sketchA, IFeature sketchB, string name)` - Projected curve, sketch on sketch: the 3D curve where the extrusions of two sketches on different planes meet (for example a top-view outline and a side-view profile).
- `IFeature PlanarSurface(object[] boundary, string name)` - Planar surface bounded by a closed sketch or a set of coplanar edges.
- `IFeature FillSurface(IEnumerable<IEdge> boundary, bool tangent, string name)` - Fill surface over a closed loop of edges; tangent = true keeps it tangent to the faces at the edges.
- `IFeature Knit(IEnumerable<IBody2> sheets, bool formSolid, string name)` - Knit surface bodies; formSolid closes a watertight set into a solid body.
- `double BodyVolumeMm3(IBody2 body)` - Volume of one body in mm3.
- `IFeature Thicken(IFace2 face, double thicknessMm, int side, bool merge, string name)` - Thickens a surface face into a new solid body (merge off). side: 0 = side one, 1 = side two, 2 = both sides. With both sides the thickness applies to EACH side (0.5 gives a 1.0 slab).
- `IFeature CombineBodies(swBodyOperationType_e operation, IBody2 main, IList<IBody2> tools, string name)` - Combine bodies: SWBODYADD / SWBODYINTERSECT take only tools (main null); SWBODYCUT needs the main body. Passing the bodies directly returns null for intersect on 2025, so selection marks are tried as well (main = 1, tools = 2).
- `DialogAnswerer AnswerDialogs(params string[] fragmentButtonPairs)` - Answer SOLIDWORKS message boxes raised by the calls inside the using block: pairs of (text fragment, button caption), e.g. AnswerDialogs("different units of measurement", "Yes"). Read Answered/Unanswered afterwards for the job result.
- `IBody2 CopyBodyRotated(IBody2 body, char axis, double deg, double[] originMm, string name)` - Move/Copy Body: a copy of body rotated by deg about the global x, y or z axis through originMm.
- `IModelDoc2 InsertIntoNewPart(IBody2 body, string path, string templatePath)` - Insert into New Part (right-click a body > Insert into New Part): saves one body of the active part as a new part file linked to it (Stock feature), so later edits of the multibody master flow into the new part.
- `IFeature DeleteBodies(IEnumerable<IBody2> bodies, bool keep, string name)` - Body-Delete/Keep feature: keep = false deletes the given bodies (solid or surface), keep = true keeps only them. Use it to drop construction surfaces before Save Bodies.
- `List<string> SaveBodies(IList<IBody2> bodies, IList<string> partPaths, string assemblyPath, bool consume, string name)` - Save Bodies (Insert > Features > Save Bodies): writes each solid body to its own part file and, when assemblyPath is not empty, an assembly that places every saved part at the original origin (fixed).
- `string SetMaterial(string material, string database)` - Assign a library material to the active part (all configurations) and read it back. Database is "SOLIDWORKS Materials" for the standard library; an empty name removes the material.
- `IFeature MirrorBodies(object plane, IEnumerable<IBody2> bodies, bool merge, string name)` - Mirror solid bodies about a plane (feature) or planar face; merge joins the copies to the originals.
- `IFeature MirrorFeatures(object plane, IEnumerable<IFeature> features, string name)` - Mirror features about a plane (feature) or planar face. Mirrored bosses merge like the seed; use this rather than MirrorBodies when the seed feature merged into a body that also holds other geometry.
- `IFeature SweepWithGuides(IFeature profileSketch, object path, IEnumerable<object> guides, bool merge, string name)` - Sweep with guide curves: profile sketch (mark 1), path sketch/curve/edge (mark 4) and guide curves (sketches or sketch segments, mark 2). The profile should be pierced to the guides.
- `IFeature ProjectOnFaces(IFeature sketch, IEnumerable<IFace2> faces, bool reverse, string name)` - Projected curve "sketch on faces": projects a sketch along its normal onto faces (reverse flips the direction, needed when the faces surround the sketch plane).
- `IFeature Helix(IFeature circleSketch, swHelixDefinedBy_e def, double heightMm, double pitchMm, double revolutions, double startAngleDeg, bool clockwise, bool reversed, string name)` - Helix from a sketch with one circle. def: swHelixDefinedBy_e; reversed runs it against the sketch normal.
- `double[] CurveEndsMm(IFeature curveFeature)` - Start and end points (mm) of a reference curve feature (helix, projected or composite curve): [x0, y0, z0, x1, y1, z1] over its first and last segments.
- `List<IBody2> SheetBodies()` - Surface bodies of the part (sheet bodies), hidden ones included like Bodies().
- `List<ISketchSegment> MirrorCopy(List<ISketchSegment> segments, ISketchSegment axis)` - Mirror copies of sketch segments in the open sketch about a construction line (originals kept).
- `IFeature SurfaceExtrude(IFeature sketch, string name, double depth1Mm, double depth2Mm)` - Surface extrusion of a sketch, both directions (depth2Mm = 0 for one direction).
- `IFeature CutWithSurface(IFeature surface, string name, Func<bool> keep)` - Cut with Surface: tries both sides and keeps the first whose result satisfies keep (for example "the bottom is still at Y = 0"); the surface body is hidden afterwards.
- `IFeature Chamfer(IEdge[] edges, double distanceMm, string name)` - Equal-distance 45 degree chamfer on edges.
- `IFeature LinearPattern(IFeature seed, object direction, int count, double spacingMm, string name, out string spacingDimension)` - One-direction linear pattern of a feature. direction is a plane feature (its normal) or a straight edge. Retries reversed when instances miss the body. Returns the pattern; its spacing dimension name is in spacingDimension.
- `string FindDimension(IFeature feature, double valueMm)` - Name ("D3") of the feature's display dimension with the given value in mm, or null.
- `IFeature FillPattern(IFeature seed, IFeature boundarySketch, IEdge directionEdge, double pitchMm, double marginMm, string name)` - Hex-perforation fill pattern of a seed cut inside a boundary sketch. Place the seed at the boundary centroid.

## Equations and configurations

- `IEquationMgr Equations()`
- `int EquationIndex(string lhs)` - Index of the equation whose left side is lhs (without quotes), or -1.
- `void SetEquation(string lhs, string rhs)` - Adds or replaces "lhs" = rhs, e.g. SetEquation("Wall", "2mm") or SetEquation("D1@Boss", "\"Wall\" \* 2"). Sketch dimensions are owned by the sketch ("D2@SketchName"), feature dimensions by the feature.
- `double EquationValue(string lhs)`
- `void SetEquationThisConfiguration(string lhs, string rhs)` - Gives a global variable a value in the active configuration only (configuration families).
- `void UseConfiguration(string name)` - Activates (creating if needed) a configuration of Doc. Re-fetch equation data after this call.
- `void RenameActiveConfiguration(string name)` - Renames the active configuration (for example "Default" to the first variant's name).
- `void Rebuild()`
- `List<string> FeatureErrors()` - Features with a non-warning error code.

## Editing existing models

- `void RollBackBefore(string featureName)` - Moves the rollback bar to just before the named feature; new features are inserted there. Always pair with RollForward() (in finally when the job may fail midway).
- `void RollForward()`
- `void MoveBefore(string featureName, string beforeFeature)` - Moves a feature (with its absorbed sketch) before another feature. An absorbed sketch cannot be moved on its own: pass the feature that consumes it.
- `void DeleteEquation(string lhs)` - Deletes the equation "lhs" if present. IEquationMgr.Delete's return value does not reliably report success, so the result is checked by looking the equation up again.
- `List<string> ConfigurationsSuppressingNewItems()` - Configurations with "suppress new features" (or, in assemblies, "suppress new components") switched on. Anything added while another configuration is active is silently suppressed there: no error, no warning.
- `void AllowNewItemsInAllConfigurations()` - Switches "suppress new features/components" off in every configuration (a document change; it is saved with the model). Call before adding features to a configured model, or unsuppress afterwards.
- `List<string> PartlySuppressedFeatures()` - Features suppressed in some but not all configurations, as "Feature: Config1, Config2". Deliberate variants appear here too; anything you just added should not.
- `Dictionary<string, object> ConfigurationReport()` - Rebuilds every configuration and reports feature errors, suppressed-feature count and, for parts, solid body count and volume (mm3). The originally active configuration is restored.

## Assemblies

- `IComponent2 AddComponent(IModelDoc2 assembly, string path, double xMm, double yMm, double zMm, string configuration)` - Inserts an open part/assembly file (opened silently first) with its origin at (x, y, z) mm and no rotation.
- `IComponent2 AddComponent(IModelDoc2 assembly, string path, double xMm, double yMm, double zMm)`
- `void MoveComponent(IComponent2 c, double xMm, double yMm, double zMm)` - Sets a component transform (translation only). Transform2 needs the MathTransform coclass.
- `void Fix(IModelDoc2 assembly, IComponent2 c, bool fix)`

## Top-down (parts built in the assembly)

- `IComponent2 NewPartInContext(IModelDoc2 assembly, object planeOrFace)` - Top-down: inserts a new virtual part whose Front Plane lies on planeOrFace (an assembly plane feature, or a planar face in assembly context), enters in-context editing of it and deletes the empty sketch that InsertNewVirtualPart leaves in the part.
- `void EditInContext(IModelDoc2 assembly, IComponent2 component)` - Edits a component's part in the assembly (Edit Part) and verifies that it became the edit target.
- `void EndEditInContext(IModelDoc2 assembly)` - Leaves in-context editing and returns to editing the assembly itself. Close any open sketch first.
- `IFeature InContextFeature(IComponent2 component, IFeature partFeature)` - The assembly-context counterpart of a feature of the part being edited in context.
- `void SaveVirtualPart(IComponent2 component, string path)` - Saves a virtual (in-assembly) part to its own file (the component takes the file name). Leave in-context editing first and keep the assembly saved.
- `IFeature MatePlanes(IModelDoc2 assembly, IComponent2 a, string planeA, IComponent2 b, string planeB)` - Coincident mate between two named reference planes of two components (closest alignment).
- `IFeature Mate(IModelDoc2 assembly, swMateType_e type, swMateAlign_e align, double distanceMm, object a, object b)` - Any two-entity mate (COINCIDENT, CONCENTRIC, PARALLEL, PERPENDICULAR, DISTANCE, ...). Entities must be in assembly context: component features (IComponent2.FeatureByName) or faces/edges mapped with InComponent. distanceMm is used by DISTANCE mates.
- `object InComponent(IComponent2 component, object partEntity)` - Maps a face, edge, vertex or feature taken from a part document to the given component in the assembly.
- `List<IFace2> ComponentFaces(IComponent2 component)` - Faces of a component's solid bodies in assembly context (selectable for mates without mapping). Surface parameters of these faces are in the component's own part coordinates.
- `IFace2 FaceByRay(IModelDoc2 doc, double[] fromMm, double[] dir)` - Face hit by a ray from a model/assembly point (mm) along dir (any length), in the document's own context (an assembly returns the component face, ready for mates).
- `IFeature HoleWizardAt(swWzdGeneralHoleTypes_e type, swWzdHoleStandards_e standard, swWzdHoleStandardFastenerTypes_e fastener, string size, double diameterMm, double depthMm, double[][] fromMm, double[] dir, string name)` - Hole Wizard holes at the points where rays from fromMm along dir first hit a face (all rays should land on the same face).
- `IFeature HoleWizardAt(swWzdGeneralHoleTypes_e type, swWzdHoleStandards_e standard, swWzdHoleStandardFastenerTypes_e fastener, string size, swEndConditions_e end, double diameterMm, double depthMm, double[] values, bool propagateToParts, double[][] fromMm, double[] dir, string name)` - Full form: end condition (Blind, ThroughAll, UpToNext...), the 12 type-specific HoleWizard5 values in API units (metres/radians, -1 = standard default; null = all defaults; see the HoleWizard5 remarks, e.g.
- `IFeature HolePlacementSketch(IFeature hole)` - Placement sketch (first sketch sub-feature) of a Hole Wizard / Advanced Hole feature.
- `int AddHolePositions(IFeature hole, params double[][] pointsMm)` - Adds hole centres at model/assembly points (mm, on the placement face) to an existing Hole Wizard feature, rebuilds and verifies the number of hole centres in its placement sketch. Returns that count.
- `List<string> MateErrors(IModelDoc2 assembly)` - Mate features with errors (empty when all solve).
- `int InterferenceCount(IModelDoc2 assembly)` - One explicit interference calculation (coincident faces not counted). Always releases the manager.
- `List<string> InterferencePairs(IModelDoc2 assembly)` - Interfering component pairs with their volume, sorted: "A-1 x B-1 : 12.5 mm3". Use this instead of a bare count when reference envelopes are expected to overlap, so new clashes are not hidden among known ones.
- `List<string> InterferenceDetails(IModelDoc2 assembly)` - InterferencePairs with where each clash is: "A-1 x B-1 : 12.5 mm3 @ x..x, y..y, z..z" (assembly mm, box of the interference body). Use it to see which leg of a route or which feature collides before changing geometry.

## Previews

- `void CaptureView(string path, double[] towardViewer, double[] up)` - Saves the active view of Doc as an image (png/jpg by extension) looking along -towardViewer with screen-up close to up (model directions). Shaded with edges; planes, sketches and origins hidden; view settings restored.
- `string SaveNamedView(string name, double[] towardViewer, double[] up)` - Saves a named view in the model looking along -towardViewer with screen-up close to up (model directions), for drawings of models whose 'up' is not +Y: use the name as the orientation of ModelView/StandardViews (CreateDrawViewFromModelView3 accepts named views ...

## Exports

- `List<string> ExportBodiesStl(string folder, string prefix)` - One binary STL per solid body (other bodies hidden), in model coordinates; returns file paths. STL preferences are restored afterwards.
- `double StlVolumeMm3(string path)` - Volume of a binary STL in mm3 (signed tetrahedra), for comparison with VolumeMm3 per body.
