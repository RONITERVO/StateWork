# StateWork Spatial

**Your work, within reach.** Fill in a project, see what is ready, and follow its prerequisites. A stationary WebXR view and ordinary browser controls share the same SQLite database, SDK commands and history.

This is a **developer preview for local PC VR**. Desktop workflows are tested; physical headset usability and performance are not yet verified. It is ready to fork and build on, with that boundary stated explicitly.

## Just fill in

Use Node 24.13+ (24.x) or 25, as described in the main README.

```sh
npm ci
npm run build
npm start
```

Open **[StateWork Spatial](http://127.0.0.1:4180/spatial/)**. Choose **Create your space**, edit the example or select **Blank**, and create it. No account, API key, external assets or AI service is needed. Setup validates a complete snapshot in memory and imports it as one workspace, so a failed setup cannot leave half a project behind.

The original fictional example links references and tool access to a first pass, then review and delivery. Editing its steps starts them independently: task wording never silently creates requirements. Add real dependencies with **Add prerequisite**. Existing workspaces can be selected from the menu.

## Everyday controls

| Intent | Control |
| --- | --- |
| Find a direction | Next-step card: active work first, then date and priority; unfinished prerequisites and future scheduled starts are excluded |
| Start late | Open the app; dates and completion stay as recorded until you explicitly edit them |
| Unblock work | **Needs first → prerequisite → Open resource**; an account, tool, contact or smaller task is ordinary linked work |
| Record a small action | **Add step** or **Edit**: title, minutes, due date, notes/microsteps, direct resource link |
| Record progress | **Start**, **Finish**, **Undo last status**; backend version and dependency checks still apply |
| See past work | **Finished** includes done and cancelled tasks; records remain in the database |
| Navigate | Six cards per page, search, project/child/related links and a labeled DOM index |
| Move data | **Export**; restore as a new workspace with **Classic views → Import a snapshot** |
| Edit schedules or archive | **Classic views** opens the same workspace; durable history is available through the SDK/API |

Ready can still show future scheduled tasks for inspection. A project does not auto-complete when its children finish. An archived unfinished prerequisite still blocks completion and can be followed from its dependent step.

## Enter VR

Connect a headset to the computer running StateWork. Open the loopback address in a browser/runtime that exposes `immersive-vr`. **Enter VR** enables after `navigator.xr.isSessionSupported` succeeds. Refresh or a device-change event rechecks availability. Permission denial leaves the work buttons usable.

| Input | Behavior |
| --- | --- |
| Either controller's target ray + select/trigger | Select a card or enabled action; no thumbstick movement, dragging or timed selection |
| Start / Finish / Reopen | The same versioned SDK command as the DOM button |
| Needs / Unlocks / Project / Step / Related | Navigate the same stable item ID |
| Links | Page through every relationship, two at a time |
| Notes | Page through long notes without a reading timer |
| Link ↗ / Edit ↗ | Leave immersion and focus the browser link or open the editor; an external site needs a browser click |
| Page arrows | Navigate the current filter without moving the viewer |
| Recenter | Put the arc in front of the current head position and horizontal facing direction |
| Exit VR | End the session; the headset's system exit remains available |

The scene uses an eye-relative `local` space, with work about 2.5 meters away. It makes no floor-height assumption and has no camera locomotion, automatic rotation or dwell activation. Select events use the standard target ray rather than a hard-coded gamepad button index. Hand tracking, eye tracking, haptic drivers and standalone headset compatibility are not claimed.

**Comfort** offers larger VR text and recentering before entry. Short names work best in the 3D overview; full titles remain in the browser editor. Keyboard and touch controls have a next-action-first layout at 390 pixels. Every state has a symbol and word as well as color. Classic views provide text scaling and high contrast. Actual assistive technology and headset testing with people remains necessary.

## Optional audio

Every visit starts **silent**. Enabling sound plays a sample; subsequent successful saves have a brief local synthesized cue and a visible message. The same control mutes it. There is no music, microphone, speech service or network request. No task depends on hearing. Game-playing habits are not used to infer sensory or input preferences.

## Local and standalone devices

The server binds to the PC's loopback interface and protects browser bootstrap with Host and same-origin checks. A standalone headset's `localhost` is the headset itself. It cannot reach the PC by opening its own localhost address. Publishing this repository does not publish a person's work or provide a hosted service.

Standalone/company use needs a separately designed authenticated HTTPS host, origin handling and device identity. Do not expose the local bootstrap or bearer token through an unauthenticated tunnel, change the bind address to `0.0.0.0`, disable browser security, or put credentials in source. See [the security boundary](../SECURITY.md) and [host extension seam](ARCHITECTURE.md). Remote hosting and cross-device sync are outside this release.

## Build your layer

Vite builds `packages/reference/spatial/index.html` alongside the existing client. Three.js loads only when a spatial workspace opens; no backend package depends on it.

| File under `packages/reference/src/spatial` | Responsibility |
| --- | --- |
| `model.ts` | Starter snapshot, next-step suggestion, safe links and state marks; semantics come from SDK observations |
| `main.ts` | Same-origin connection, forms, DOM alternatives, explicit save/retry/conflict states, export and local preferences |
| `scene.ts` | Original Three.js geometry/textures, picking, WebXR lifecycle, recenter and disposal |
| `tokens.css` | DOM color tokens |

`SpatialScene` accepts a `SpatialView` and emits stable action IDs. It has no database connection and does not decide which work can be completed. Replace geometry and controls without changing semantics. The server checks commands again; enabled flags are affordances, not authorization.

The optional resource extension is inert JSON:

```json
{
  "statework.spatial/resource": {
    "url": "https://example.com/your-resource"
  }
}
```

Only explicit HTTP(S) URLs without embedded credentials become links. Unknown namespaces survive edits and export unchanged. Metadata never executes code or loads assets. Keep credentials out of extensions and snapshots.

Preferences use browser keys `statework.spatial.*`; shared work contains no camera positions or sensory assumptions. Audio is session-only. All work mutations use `WorkClient`. An uncertain retry keeps the exact request ID and body. Conflicts refresh for review rather than overwriting. A failed workspace switch keeps the previously loaded workspace as the command target.

## Verification boundary

See [the acceptance record](ACCEPTANCE.md) for executed checks. Desktop rendering is on demand; immersion uses the headset animation loop. Geometry and textures are disposed on view changes and close. These are implementation choices, not measured headset performance claims.

The following hardware matrix is deliberately **unverified**:

| Check before advertising device support | Record |
| --- | --- |
| Entry, exit, permission recovery | Headset, browser/runtime versions, connection type |
| Both controllers, tracking loss/reconnection | Selection accuracy, absent controller behavior, accidental repeat activation |
| Seated and standing | Recenter from different heights/facing directions; comfortable reach and readability |
| Stereo and sustained rendering | Binocular alignment, text clarity, actual frame timing, thermal behavior, memory after repeated sessions |
| Interaction with people | Keyboard/touch/headset usability; audio audibility/mute; color-independent recognition |

Tests in `tests/spatial.test.ts` cover semantic consistency, permissions, bounds, time behavior, URLs and ray selection. `tests/browser/spatial.spec.ts` covers real HTTP workflows, persistence, mobile/accessibility, interrupted saves, stale writes and a simulated denied XR request. A simulated request does not validate stereoscopic rendering or headset comfort.

Implementation references: [Three.js WebXR guide](https://threejs.org/manual/en/webxr-basics.html), [controller selection guide](https://threejs.org/manual/en/webxr-point-to-select.html), [WebXR session API](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/requestSession), and the installed Three.js 0.185.1 source. Secure contexts and user-triggered session requests are platform requirements; device support is detected at runtime.
