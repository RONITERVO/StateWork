# Photorealistic rendering in SOLIDWORKS Visualize

Use the installed desktop SOLIDWORKS Visualize application (or a verified Visualize add-in render pipeline) when photorealistic renders are required. Do not substitute SOLIDWORKS shaded viewport screenshots for requested ray-traced output.

## Engine, device and focus checks

Confirm the licensed edition (Standard vs Professional), active render engine (`3DS Stellar Physically Correct` vs `AMD Radeon ProRender`) and selected render devices under `Tools > Options > 3D Viewport` before styling a scene.

On multi-GPU hosts, leaving a low-VRAM integrated GPU checked alongside a discrete CUDA GPU can stall Stellar Accurate mode at zero passes with `Renderer busy`. Leaving `Realtime Options > Auto Pause` enabled can likewise pause rendering whenever another window holds focus during automation. Deselect interfering integrated GPUs, disable `Auto Pause` while running unattended renders (restoring user preferences afterward when appropriate) and verify actual pass advancement and denoised output with a small test render before building full production scenes. If GPU kernels fail to advance on a specific driver/architecture, switch deliberately to CPU Stellar rendering and record the actual device used.

Inspect add-in interfaces before scripting exports or renders from SOLIDWORKS. `SolidWorks.Visualize.Interfaces` exposes `IVisualizeAddin`, `IVisualizeAddinManager` and `IRenderOptions`, while interactive export methods such as `ExportSimple` and `ExportAdvanced` live on the concrete add-in implementation outside those typed interfaces. Confirm live behavior in the installed release rather than assuming every exposed method works unattended.

## Preparing CAD geometry and materials

Assign real materials or distinct body appearances in SOLIDWORKS before import so Visualize generates clean material groups, or import with `Component/Part/Body` grouping when individual bodies need separate styling.

For transparent vessels containing liquids (glass pitchers, bottles, drinking glasses), model the outer vessel and inner liquid as separate solid bodies and offset the liquid inward (typically `0.2`–`0.5 mm`) from the inner glass wall and bottom. Coplanar glass-liquid faces produce severe ray-tracing striping artifacts. Add small fillets (`~0.2`–`0.6 mm`) to glass rims and sharp steps so edges catch realistic specular highlights instead of razor-sharp CG lines.

## Decals and visual contrast

Use images with a clean alpha channel (such as transparent PNGs) for logos and labels, and choose geometry-appropriate mapping (`Cylindrical` on curved vessels, `Planar` on flat faces). Visually inspect the rendered viewport before final output to verify left-to-right orientation, undistorted aspect ratio, absence of opaque rectangular borders and absence of unintended back-wall double projection.

Check foreground-to-background contrast on transparent subjects: a dark logo placed over dark-tinted glass, dark liquid and a dark backdrop loses legibility. Pair dark graphics with clear glass, bright/transmissive liquid or a light studio gradient backdrop so text and emblems remain crisp.

## Studio framing, output and project hygiene

Set an explicit camera aspect ratio (`16:9` for Full HD) and a natural product-photography focal length (`~70`–`85 mm`) to avoid wide-angle distortion. Replace square default CAD backplates with aspect-matched studio plates so border bands do not frame the render. Enable `Ground Shadow Catcher` and `Snap to Floor` so objects rest grounded with natural contact shadows and controlled floor reflection.

Prefer built-in output presets (such as `Full HD` for `1920 x 1080` PNG with Denoiser enabled) adjusted for the required print resolution (e.g., `300 ppi`) and pass count, and stage output to a stable local folder before moving files into the review directory when localized OS folder pickers are fragile. Reopen every rendered image to verify pixel dimensions, DPI, exposure, reflections, noise cleanliness and readability. Switch the viewport back to `Preview` mode before saving `.svpj` project files so reopening stays responsive.
