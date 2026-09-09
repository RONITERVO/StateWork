# StateWork Office

A personal 1980s office for a real work graph. Projects become metal filing cabinets; work becomes manila folders. Finish a prerequisite to earn its brass key. Pick up a blocked file, reveal its dependencies through the furniture, and bring related files into Quick View.

The room uses original procedural artwork and shares the SQLite database, validated commands, permissions and history with every other StateWork view. This is a **local PC VR developer preview**. Desktop rendering and Quest runtime emulation are tested; physical headset comfort and performance still need device testing.

## Just fill in

Use Node 24.13+ in the 24.x line, or Node 25.

```sh
npm ci
npm run build
npm start
```

Open **[your office](http://127.0.0.1:4180/spatial/)**. Choose **Create your space**, edit the example or choose **Blank**, and create it. There are no accounts, API keys, external assets or AI services to configure. Setup validates and imports the complete workspace atomically.

The unchanged fictional example links references and tool access → first pass → review → delivery. Editing the starting steps makes them independent. Use **Add prerequisite** to link your actual requirements: accounts, software, a person, a contact, approval or a smaller task. Titles never silently create requirements.

## Work at your desk

| Do this                                           | What happens                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Click the telephone marked **Next step**          | Your next actionable task comes to your hand; it makes no call                               |
| Click the CRT                                     | Pick up the selected folder                                                                  |
| Open a cabinet drawer                             | Its files rise into a small rack; click one to hold it                                       |
| **Dependencies / X-ray**                          | Reveal upstream requirements and direct dependents through the room, with connecting paths   |
| **Quick View**                                    | Bring related files forward; one per page on a narrow phone, up to five on desktop and in VR |
| Click a related file                              | Hold that actual record; **Back to folder** returns along your navigation history            |
| **Use keys** or select a lock                     | Unlatch when every prerequisite key is earned; otherwise reveal what is missing              |
| Click the **Done** stamp or **Finish step**       | Request completion through the SDK; requirements, permissions and versions are checked again |
| **Put down**                                      | Release onto the desk/floor with bounded drop motion                                         |
| **Pin file**                                      | Keep up to four files beside the desk                                                        |
| **File all**                                      | Return objects, close drawers and clear X-ray; work and history stay as recorded             |
| Click the desk lamp                               | Toggle its warm light                                                                        |
| **Full screen**, look buttons or right-mouse look | Inspect the room on desktop; none is required to operate work                                |

**Next step** follows the first ready recommendation in the [daily calendar plan](CALENDAR.md). The default is four focused hours on weekdays, with one-click remaining-time controls. Opening late does not change deadlines or claim completion. The same direction appears as a prominent browser card, before the room on a phone.

Browser controls include search, filters, Start, Finish, Undo, editing, direct resource links and export. Cabinet controls and additional related-file/key pages have keyboard and touch equivalents. **Classic views** provides schedules, archive/restore, snapshot import, adjustable text and high contrast.

## Filing and keys

The rear wall holds a [large calendar](CALENDAR.md); **Calendar on wall** moves to its station. The right wall holds a complete-work **Detective board**, with project groups, requirements, downstream impact, unblock leads and persistent memory pins. See [the board and movement guide](DETECTIVE_BOARD.md) for controls, coverage and extension points.

- Every item has one folder, including projects and archived records. Its nearest containing project supplies the cabinet; uncontained records go in **Unfiled / inbox**. Nested projects have their own cabinets.
- Three cabinets form a bank, with twelve folders per cabinet sheet. Paging reaches the complete catalog, independently of search and the six-card browser page.
- A completed prerequisite supplies one key for every dependent. Cancelled prerequisites have explicitly waived keys, matching existing backend rules. An archived unfinished prerequisite still needs a key.
- Every direct prerequisite is required. Possessing or moving a mesh cannot complete a task. Reopening a prerequisite revokes its key and corresponding latch. The SDK prevents reopening beneath already completed dependent work.
- X-ray retains a complete trace index and renders a bounded page of off-bank files. Page controls reach every related record. Quick View relocates the same folder objects without creating work copies.
- Drawer positions, loose files, pins, latches and navigation history are temporary presentation state. Reloading tidies the room; the database retains work and events. Keys are recomputed from those records.

## Enter VR

Connect a headset to the PC running StateWork. Open the loopback address in a browser/runtime exposing `immersive-vr`. **Enter VR** enables when the browser reports support. Permission denial leaves desktop controls usable.

| VR input                                                  | Behavior                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Either controller's ray + trigger/select                  | Pick folders, keys, drawers, locks, stamp or labeled controls                                         |
| Squeeze near a folder or key                              | Pick it up in that controller's grip space; distant targets also support ray pickup                   |
| Release squeeze                                           | Put the object down; keys return to the tray                                                          |
| Trigger pickup + **Put down**                             | Untimed alternative without holding a grip button                                                     |
| **Dependencies**, then **Quick View**                     | Reveal requirements and arrange related files within roughly one meter of the reference head position |
| File-index clipboard                                      | Follow relationships, page notes, or leave VR to open the browser editor/resource link                |
| **Recenter**, **Text size**, **Sound**, **Exit VR** board | Controls stay inside the room; the headset's system exit also works                                   |

The renderer uses `local` reference space and places the room relative to current head height and horizontal facing. It makes no floor-height assumption. Optional locomotion uses the left thumbstick; the right stick snap-turns. With one controller, its stick moves and wall buttons turn. Desk/board stations remain available while free movement is paused. Desktop uses WASD, Q/E and right-drag. Tracking loss, a hidden session and exit return held objects safely and require neutral input before walking resumes. There is no dwell activation or mandatory two-handed interaction.

Quick View stays in room coordinates: recenter after changing seat or position. Original neutral controller grips avoid remote model downloads. Hand tracking, gaze input, haptic drivers and standalone hosting are extension opportunities, not supplied device integrations.

## Sound and reading

Each visit starts silent. **Sound** enables short, locally synthesized interaction/save cues with visible messages. There is no music, microphone or speech service, and no task depends on hearing. **Text size** enlarges room labels; full records remain available through browser controls. Reduced-motion preference disables drawer/stamp animation; no dragging or throwing is required.

## Local data and standalone devices

The server binds to the PC's loopback interface. A standalone headset's `localhost` is that headset, so it cannot reach the PC through the same address. This repository supplies source, not a hosted work service. Standalone/company deployment needs a separately authenticated HTTPS host and device identity; the local bootstrap must remain private. See [security](../SECURITY.md) and [the host extension seam](ARCHITECTURE.md).

## Build a different room

Vite builds `packages/reference/spatial/index.html` beside Classic views. Three.js loads only when a workspace opens. Backend packages have no Three.js dependency.

| File under `packages/reference/src/spatial` | Responsibility                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `model.ts`                                  | Editable starter, next-step choice, safe resources and state marks             |
| `office-model.ts`                           | Complete catalog, keys, dependency traversal and pure presentation transitions |
| `office-art.ts`                             | Original furniture, materials, textures and paper labels                       |
| `office-world.ts`                           | Drawers, held objects, locks, physical layout, Quick View and X-ray            |
| `office-scene.ts`                           | WebGL passes, ray picking, camera, WebXR lifecycle and controller input        |
| `scene.ts`                                  | Stable scene/type exports                                                      |
| `main.ts`                                   | WorkClient, setup/edit forms, DOM alternatives, retries, conflicts and export  |
| `office.css`                                | Responsive controls and full-screen layout                                     |

`SpatialScene` accepts a `SpatialView` and emits stable action IDs. `OfficeSession` only changes presentation. Mutations use `WorkClient`; the server checks legality and identity again. Uncertain saves retain the exact request ID/body. Stale writes refresh instead of overwriting. Failed workspace switches retain the old command target.

The optional `statework.spatial/resource` extension accepts `{ "url": "https://example.com/resource" }`. Only explicit HTTP(S) links without embedded credentials become actions. Unknown extensions survive edits/exports. Metadata never executes code or loads scene assets. Preferences use browser keys `statework.spatial.*`; shared work contains no sensory assumptions or camera poses.

## Verification

[Acceptance evidence](ACCEPTANCE.md) distinguishes checks from hardware qualification. `tests/office.test.ts` checks complete records, keys/revocation, backend gates, grip attachment, visibility, Quick View, paging and disposal with real Three geometry. `tests/browser/office.spec.ts` performs real WebGL ray picks and stamp writes, repeated resource checks, phone rendering and an IWER Quest session. Wider browser suites exercise persistence, retries, conflicts, keyboard access, axe and Classic views.

IWER is **test-only** and never loads in the product. Desktop rendering pauses when the room settles; VR uses the headset frame loop. X-ray draws a second layer after clearing depth so furniture cannot hide files while folder covers still occlude their own paper correctly. Picking follows the same layer priority.

Before advertising physical device support, record headset/browser/runtime versions, both-controller behavior, seated/standing reach, stereo alignment, sustained frame timing, thermal behavior, text clarity and comfort with actual users. Emulation cannot establish those measurements.

References: [Three.js WebXRManager](https://threejs.org/docs/pages/WebXRManager.html), [IWER runtime/control API](https://meta-quest.github.io/immersive-web-emulation-runtime/getting-started.html), and [Owlchemy accessibility](https://owlchemylabs.com/accessibility-statement). The user's [Job Simulator reference](https://store.steampowered.com/app/448280/Job_Simulator/) informed the physical-office direction; no game assets or branding are included.
