# Acceptance evidence — StateWork 0.1.0

Local verification on **2026-09-08**, Windows 11 (`10.0.26200`), AMD Ryzen 9 7950X. Primary runtime Node **25.4.0**; backend suite also checked on **24.13.0**. This is a developer foundation and usable personal local organizer. It is not a claim of hosted enterprise readiness or universal accessibility.

## Passed

### Wall calendar and daily planning — 2026-09-09

- `npm run check`: **76 unit/backend tests passed**, with strict types, package boundaries, formatting, generated contracts and production build on Windows/Node 25.4.0.
- Full integration suite: **68 passed, 16 explicitly skipped** across Chromium, Firefox and WebKit. New coverage includes reader-only planning, one-click capacity, prerequisites, explicit progress, completion, reload, keyboard dates, phone reflow and WebGL-unavailable fallback. The final exhausted-estimate accounting regression and the complete Chromium calendar workflow passed. Final phone/settings polish was rechecked by all calendar scenarios: **11 passed, 4 explicitly skipped** across the same engines.
- Real desktop rays selected the rear-wall time controls, held the actual suggested folder and opened the screen view. IWER controller rays reached the wall station, changed remaining time, held the suggested file and exited VR into screen actions. Both physical-wall scenarios also passed with Chromium software rendering. Stereo emulation was visually inspected; physical headset qualification remains pending.
- Pure tests cover deadline-free dependency order, chosen/urgent prerequisite chains, defers, 4-hour weekdays, late starts, long/unknown estimates, explicit progress, completed allocations across reload/undo, real midnight/DST/leap/month boundaries, overnight and overlapping bookings, impossible/past fixed slots and a 10,000-task accounting check.
- Clean package installation passed for the SDK, SQLite adapter, server, CLI and MCP. The live local office was restarted after a private online backup; workspace revisions and record counts stayed unchanged, and its new plan endpoint responded successfully.
- Hosted traces exposed the shared browser fixture exceeding the normal 600-request/minute budget and a WebKit page startup using over 20 seconds of a 30-second test. The isolated test host now has its own explicit budget, the reader scenario has a bounded 60-second startup allowance, and the import workflow verifies that its dialog closed and the imported workspace is actually selected. Firefox/WebKit targeted checks passed locally.
- The authenticated read-only plan endpoint validates options and its complete response contract, allows a reader, rejects unauthorized/unknown workspaces, and leaves state and events unchanged.
- Fictional screenshots: `docs/images/calendar-wall.png` and `docs/images/calendar-xr-emulated.png`. Calendar controls were moved above the grid after visual inspection found that furniture obscured the original lower controls. Personal records and desktop launcher files remain ignored.

See [calendar behavior, API and limits](CALENDAR.md). This provides day-level suggestions; it does not create appointments, infer completion, synchronize calendars or establish headset comfort.

### Detective board and room navigation — 2026-09-09

- `npm run check`: **62 unit/backend/protocol tests**, strict types, package boundaries, formatting, contracts and production build passed on the Windows/Node 25.4.0 environment above. Subsequent focused graph checks, types, formatting and builds passed after the last routing and tracking refinements.
- Full browser regression: **57 passed, 12 explicitly skipped** across Chromium, Firefox and WebKit. The four new detective-board scenarios passed on all three engines; the two new physical room/controller scenarios run in Chromium. After final arrow-routing polish, the twelve board checks passed again.
- A pure 10,000-record dependency chain retained every record and edge through bounded group drill-down. Converging paths count distinct impact once; available leads distinguish direct unlocking from wider unfinished reach. Tests cover stable positions, filters, archives, removed remembered records, twelve-pin limits, ranked groups and workspace memory isolation.
- Routing checks examine every ordered pair among 32 cards and reject segments crossing unrelated cards. Incoming/outgoing ports and gutter lanes are separated to avoid misleading adjacent arrows.
- A **1,020-record / 20-project / 1,999-link** fictional workspace passed real browser import, complete coverage, group drill-down, cross-project requirements, source links, pinning, archived/completed counts and workspace switching. This verifies functional coverage, not a company workload or latency guarantee.
- Reader-role browser tests permit investigation/pins while disabling work mutations; no command request is sent. Existing backend permission and identity tests remain authoritative. Phone keyboard/focus/reflow and WebGL-unavailable board scenarios reported no axe violations for the tested WCAG A/AA tags.
- Actual desktop rays selected a wall card and its physical pin control. Keyboard movement, full rotations, furniture bounds, input-focus/blur stops, movement pause and desk/board stations passed. Pure layout tests cover normalized diagonals, dead zones, snap rearming and an adjoining-room boundary.
- IWER exercised standard thumbstick movement, one snap per tilt, the physical wall station, card selection after rig movement, a held file during one-controller movement, tracking/visibility recovery requiring neutral input, and the physical Screen view exit. Both navigation scenarios also passed Chromium software rendering (`--use-angle=swiftshader`). The final controller scenario used stereo output; both eye images were inspected.
- Fictional captures are in `docs/images/detective-company.png`, `docs/images/detective-wall.png` and `docs/images/detective-xr-emulated.png`. The first two show the latest card routing; the stereo capture records the controller/navigation verification before that final routing-only polish. Personal records and local launcher files remain ignored.

**Physical headset testing remains unperformed.** The board, movement and room-extension seam are functional developer features; emulation does not establish headset comfort, sustained frame rate, eye comfort or universal accessibility. [Controls, graph semantics and extension limits](DETECTIVE_BOARD.md). Hosted results are recorded in the pull request checks.

### Interactive office — 2026-09-09

- `npm run check`: **51 tests passed**, plus strict types, package boundaries, formatting, contracts and production build on Windows/Node 25.4.0.
- Final full browser suite: **43 passed, 8 explicitly skipped** across Chromium, Firefox and WebKit. Three actual WebGL/VR office scenarios and the denied-XR case run in Chromium; the other engines exercise browser work, keyboard, reflow and accessibility. All three engines also passed an explicit WebGL-unavailable case: readable fallback text, no axe violations and a successful completion write.
- Real mouse rays opened a cabinet, picked its physical folder and used the wooden stamp to finish both prerequisites, earn two keys, unlock the dependent file and complete it. Reset and reload retained the correct records and revisions.
- Repeated pickup → X-ray → Quick View → file-all cycles stayed within the initial GPU geometry/texture counts (allowing only a small hover-geometry tolerance). A 390-pixel held-folder screenshot was inspected. These checks do not establish target-headset frame rate.
- Unit/geometry checks cover 606 records including archives, complete trace traversal, every prerequisite key, waived keys, revocation, SDK completion gates, actual grip-parent transforms, hidden-file ray rejection, off-sheet retrieval, all key pages and disposal events. Overlay picking follows what is drawn through cabinets. X-ray avoids Three.js eye-reserved layers 1 and 2.
- IWER 2.3.0 emulated a Quest session with actual WebXR frames: enter, controller ray pickup, grip attachment, squeeze release, X-ray, stereo rendering, disconnection, hidden-session recovery and exit. The stereo image was inspected in both eyes. IWER is injected only by tests and is absent from the product bundle.
- A controller ray excludes its own held object so it can still reach desk controls. The one-controller held-file/X-ray scenario also passed with Chromium configured for software rendering through `--use-angle=swiftshader`.
- The desktop idle-frame optimization passed `npm run check` and all three office browser scenarios again. Actual motion keeps the loop running; settled scenes request only two frames. The repeated-interaction scenario ran in 15.4 seconds versus 49.3 seconds earlier on this machine; these are test wall times, not headset frame-rate measurements.
- Static furniture batching and cached shadows reduce rendering cost; moving files, keys, drawers and recentering invalidate shadows. XR emulation waits for actual frames between pose updates, button presses and releases, including controller reconnection. Its functional checks use a 960 × 720 browser viewport to limit CPU-only CI rasterization cost; full-size desktop and earlier stereo captures remain separate visual evidence. Final hosted results are recorded in the PR checks.
- Fictional desktop and emulated stereo captures are in `docs/images/office-dependencies.png` and `docs/images/office-xr-emulated.png`. No school records, personal workspace snapshots, credentials or local shortcut paths are included.

**Physical headset testing remains unperformed.** This is working desktop software and a software-tested PC VR developer preview, not a hardware performance/comfort certification. See [office controls and extension seams](SPATIAL.md).

### Spatial addition — 2026-09-08

Verified locally on the Windows/Node 25.4.0 environment above:

- `npm run check`: 43 unit/backend/protocol tests, strict types, package boundaries, formatting, generated contracts and production build passed.
- Spatial browser suite: **25 passed, 2 explicitly skipped** across Chromium, Firefox and WebKit. The simulated denied-XR-request case runs in Chromium only; its other two engine variants are skipped. These counts do not represent headset tests.
- Browser evidence covers fill-in setup, dependencies, status/undo, resource links, persistence, workspace switching, export, stale writers, two lost command responses, lost setup responses, a lost refresh after a committed create, and retry from inside an editor. Failed workspace switches retain the old command target and selection.
- axe reported no violations for the tested default Spatial DOM view. Keyboard dialog focus, 390-pixel reflow, next-step-first ordering and silent defaults passed in all three engines. Actual browser inspection confirmed that tapping a step on a phone brings its requirement/actions panel into view.
- The twelve existing Classic view browser scenarios passed across all three engines during this change. No external browser requests were observed in the local-only checks. `npm audit --omit=dev` reported zero known runtime vulnerabilities for the installed lockfile at verification time.
- Local package smoke verification passed for SDK, SQLite, HTTP host, CLI and MCP. The new renderer has no dependency in those backend packages.

The desktop screenshot in `docs/images/spatial-desktop.png` contains only fictional starter work. The private data directory and local credentials are excluded from the commit and release source allowlist.

**No physical headset was available for validation.** Stereo rendering, target-device frame timing, real controller/hand behavior, tracking loss and sustained comfort remain unverified. The desktop preview and simulated permission failure do not establish those properties. [The Spatial guide](SPATIAL.md) records the required hardware matrix and the separate HTTPS host needed for standalone devices. Hosted CI results are recorded in repository Actions.

### Original foundation

| Area                         | Actual evidence                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build and package boundaries | `npm run check`: strict library/reference type checks, 36 tests, formatting, core/SDK/reference import and host-boundary checks, generated contracts, production build                                  |
| Deterministic domain         | Input immutability, repeated-result equality, stable navigation/order, dependency and containment cycles, single parent, duplicate IDs, completion and reopening rules                                  |
| Atomicity and concurrency    | Failed batches leave no items/events/receipts; staged SQLite callback failure rolls back; two SQLite connections reject stale writers                                                                   |
| Durability                   | SQLite close/reopen retains state and retry receipts; exact retries add no event; online backup restores state and authentication hashes                                                                |
| Permissions                  | Reader rejection, actor/workspace isolation, strict input rejection of actor/role fields, permission revocation before retries, token revocation                                                        |
| Validation                   | Real leap dates, invalid dates/zones/intervals, unknown fields, cyclic/deep JSON, namespaced extensions, duplicate/broken imported graphs, optional-undefined normalization                             |
| HTTP and schema              | Local authentication, Host/origin/bootstrap checks, bounded/malformed inputs, API loop, full response validation, resolved OpenAPI references                                                           |
| MCP                          | Actual subprocess transport: discovery, create, observe, mutation, exact retry, conflict and resource discovery                                                                                         |
| Node compatibility           | All 36 backend/protocol tests passed on Node 24.13.0 and 25.4.0                                                                                                                                         |
| Browser workflows            | 12 scenarios passed across Chromium, Firefox and WebKit: creation/editing/completion, persistence, all six views, export/import, saved queries, archive/restore, escaped text and dependency navigation |
| Keyboard and reflow          | Skip link, search shortcut, dialog Escape, focus/navigation, 375 px viewport in all six views; 200% text scale reflow in list/board/timeline/focus/text                                                 |
| Automated accessibility      | axe WCAG 2 A/AA, 2.1 AA, 2.2 AA tags: no reported violations in the six default desktop views on the three tested browser engines                                                                       |
| Local-only browser behavior  | Browser tests observed no requests outside the local server; no external fonts, scripts or data services                                                                                                |
| Examples                     | Headless dependency loop and perception negotiation/fallback ran successfully                                                                                                                           |
| Dependency audit             | `npm audit --omit=dev`: no known vulnerabilities reported for the installed runtime dependency set at verification time                                                                                 |

The WebKit run uncovered a skipped anchor in its default keyboard behavior. The reference skip link and map anchors now have explicit zero tab stops. Desktop list/map and mobile/large-text screenshots were inspected locally; generated evidence is under `artifacts/screenshots/`. Playwright HTML/trace output is under `playwright-report/` and `test-results/` and is ignored by Git.

## Performance sample

`node scripts/benchmark.mjs` measured a 1,000-item / 999-dependency workspace in in-memory SQLite on the machine above. Twenty actionable-observation samples: **1.67 ms median**, **3.16 ms p95**; seeding items and edges took **118.07 ms**. These are local measurements, not a latency guarantee. They do not include disk durability, network latency, another device, or a concurrent company workload. The script writes its complete environment and result to `artifacts/benchmark.json`.

## Release verification

Five npm tarballs were installed together into a fresh temporary project. SDK imports, SQLite creation, HTTP host creation, CLI help and real MCP discovery all passed without workspace symlinks. A clean source copy containing no dependencies or build output passed `npm ci` and the complete `npm run check` (36 tests plus production build).

The source archive, five tarballs and SHA-256 checksums are in `artifacts/release/0.1.0/`. Final visual adjustments were followed by the keyboard/accessibility/reflow scenarios on all three browser engines again (3/3 passed). Full `npm audit` also reported zero known vulnerabilities for the installed dependency set. These results were recorded before the initial GitHub push; see repository Actions for subsequent hosted CI results. The npm packages remain unpublished.

## Limits to carry forward

- Personal-first, loopback-only host. No cloud accounts, SSO, hosted collaboration, device synchronization or CRDT merge.
- SQLite stores a complete bounded workspace snapshot on each transaction. The 10,000-item/30,000-edge limits are guards, not tested latency promises at those maxima. Events and retry receipts grow until the owner manages storage.
- No calendar integration, recurrence, notification daemon, attachment storage, capacity planner, natural-language scheduling or native mobile application. The server must be running to use the browser API.
- English reference UI/text summaries. Locale preferences and custom channels are extension contracts, not implemented localization or proof of every sensory/motor pathway.
- Local speech depends on an installed local browser voice and was not assessed for voice quality. No native speech input, XR hardware, braille driver, haptic device or switch scanning was exercised. The tactile example emits data only.
- Actual NVDA/JAWS/VoiceOver, magnifier, switch, gaze, braille, haptic and XR usability testing with people remains needed. Automated checks and keyboard tests are narrower evidence.
- The reference relationship map renders up to 30 items per page and includes a textual connection list. At larger text sizes use the textual connection list or text/list views; the SVG is a visual overview, not the sole navigation path.
- Data is not encrypted by this application. The local OS account/filesystem is trusted. See SECURITY.md and DATA.md for backup and identity boundaries.
