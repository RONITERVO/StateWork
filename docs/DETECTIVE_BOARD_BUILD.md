# Detective board and room movement

Objective: an automatic detective board on the office's right wall that helps a person understand a large branching work graph, recover context without relying on memory, identify useful actions and follow connected work. Add controller-thumbstick and WASD navigation around the whole room, with an extensible room layout.

## Completion requirements

1. An actual furnished cork-and-thread board on the right wall, reachable and interactive in desktop WebGL and WebXR. It derives connections from the complete authorized workspace, including retained completed and archived records, rather than the six visible task cards.
2. A legible whole-work overview with explicit coverage counts, status distributions, cross-project dependencies and visible dense-group counts. No silent truncation or fabricated links. Every aggregate can be opened, every record retrieved.
3. Focused upstream requirements and downstream impact, clear connection direction, root blockers and immediately useful unblock actions. Distinguish direct unlocking from broader dependency impact; do not imply a schedule, critical path, assignment or requirement absent from the data.
4. Context support: persistent per-workspace pins and last investigation, visible breadcrumbs/back/overview, selected-record facts and linked source/actions. Explicitly account for finished and archived work. Stable layout between status changes.
5. A generous full-screen board with zoom, pan, fit, search and keyboard/touch alternatives, plus a comparable in-room investigation flow. Color is reinforced with symbols and brief labels. Work writes keep existing SDK permissions, versions, retry receipts and provenance.
6. WASD movement, full look around the room, and standard XR thumbstick movement with turning. Prevent walking through room walls and major furniture; reset and board/desk access remain available. Stop on lost focus, input disconnect, hidden sessions and exit; typing in forms must never move the camera.
7. A separate layout/navigation seam supports future rooms/floors without pretending a full office floor exists today. Movement is optional; seated and one-handed board controls remain useful.
8. Verify graph coverage, aggregation, large-graph cost, direction/impact, saved-state recovery, permissions and navigation with meaningful tests. Inspect the actual right-wall board and full overview, and exercise real browser/XR input paths. Clearly separate emulation from unperformed headset testing.
9. Publish a reviewed implementation and evidence on a new PR from merged PR #2; keep personal work and local launchers out of Git. Leave the merge to the user.

## Design evidence

The overview/zoom/filter/details approach follows [Shneiderman's information visualization work](https://www.cs.umd.edu/~ben/about.html). XR input uses the [W3C XR standard mapping](https://www.w3.org/TR/webxr-gamepads-module-1/), including primary thumbstick axes 2 and 3. These references guide interaction design; they are not evidence of usability or headset comfort for this application.

## Verified implementation

- PR #2 was verified merged at `22c9e2f`. Branch `feat/detective-board` starts from that merged state.
- The physical right-wall board and full-screen investigation now share the complete graph, lossless groups, requirements, downstream reach, ranked leads and per-workspace memory. Every record remains inspectable, including archived and completed records.
- A separate layout module supplies collision bounds, clear stations and an adjoining-room seam. Desktop WASD/full turns and standard XR stick movement use the same rules; pause, one-controller operation and focus/tracking recovery are implemented.
- Verification includes 62 unit/backend checks, 57 passing browser checks (12 explicit engine skips), a 10,000-record model, a 1,020-record browser case and two software-rendered navigation scenarios. Physical rays, controller frames and both stereo views were exercised and inspected. [Detailed evidence](ACCEPTANCE.md).
- [User and developer guide](DETECTIVE_BOARD.md) records controls, local memory, exact count meanings, extension seams and unperformed physical headset qualification. Publication uses a new pull request; the user performs the merge.
