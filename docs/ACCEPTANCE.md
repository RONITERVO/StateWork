# Acceptance evidence — StateWork 0.1.0

Local verification on **2026-09-08**, Windows 11 (`10.0.26200`), AMD Ryzen 9 7950X. Primary runtime Node **25.4.0**; backend suite also checked on **24.13.0**. This is a developer foundation and usable personal local organizer. It is not a claim of hosted enterprise readiness or universal accessibility.

## Passed

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

| Area | Actual evidence |
| --- | --- |
| Build and package boundaries | `npm run check`: strict library/reference type checks, 36 tests, formatting, core/SDK/reference import and host-boundary checks, generated contracts, production build |
| Deterministic domain | Input immutability, repeated-result equality, stable navigation/order, dependency and containment cycles, single parent, duplicate IDs, completion and reopening rules |
| Atomicity and concurrency | Failed batches leave no items/events/receipts; staged SQLite callback failure rolls back; two SQLite connections reject stale writers |
| Durability | SQLite close/reopen retains state and retry receipts; exact retries add no event; online backup restores state and authentication hashes |
| Permissions | Reader rejection, actor/workspace isolation, strict input rejection of actor/role fields, permission revocation before retries, token revocation |
| Validation | Real leap dates, invalid dates/zones/intervals, unknown fields, cyclic/deep JSON, namespaced extensions, duplicate/broken imported graphs, optional-undefined normalization |
| HTTP and schema | Local authentication, Host/origin/bootstrap checks, bounded/malformed inputs, API loop, full response validation, resolved OpenAPI references |
| MCP | Actual subprocess transport: discovery, create, observe, mutation, exact retry, conflict and resource discovery |
| Node compatibility | All 36 backend/protocol tests passed on Node 24.13.0 and 25.4.0 |
| Browser workflows | 12 scenarios passed across Chromium, Firefox and WebKit: creation/editing/completion, persistence, all six views, export/import, saved queries, archive/restore, escaped text and dependency navigation |
| Keyboard and reflow | Skip link, search shortcut, dialog Escape, focus/navigation, 375 px viewport in all six views; 200% text scale reflow in list/board/timeline/focus/text |
| Automated accessibility | axe WCAG 2 A/AA, 2.1 AA, 2.2 AA tags: no reported violations in the six default desktop views on the three tested browser engines |
| Local-only browser behavior | Browser tests observed no requests outside the local server; no external fonts, scripts or data services |
| Examples | Headless dependency loop and perception negotiation/fallback ran successfully |
| Dependency audit | `npm audit --omit=dev`: no known vulnerabilities reported for the installed runtime dependency set at verification time |

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
