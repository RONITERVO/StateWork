# Changelog

## Unreleased — Wall calendar and daily planning

- Added a large rear-wall calendar with a viewing station, month/week context, selected-day recommendations, real appointment/deadline markers and matching desktop/VR ray controls.
- Added keyboard/phone controls, a four-hour weekday default, one-click time-left overrides, private defers and chosen priorities, progress logging and completion-aware daily capacity.
- Added a pure dependency-aware planner to core and an authenticated read-only SDK/HTTP plan operation with complete OpenAPI response schemas. No deadlines or completion records are invented.
- Covered local midnight/DST, overlaps, fixed-slot conflicts, long work, missing estimates, read-only roles, reload/undo, large graphs and actual controller interaction.

## Unreleased — Detective board and room navigation

- Added a right-wall cork-and-thread investigation board over the complete workspace, with lossless project/group drill-down, archived/completed evidence and explicit coverage.
- Added upstream requirements, downstream impact, exact unblock counts, persistent per-workspace pins, investigation memory, sources and full-screen search/zoom/pan/keyboard/touch controls.
- Added WASD and standard XR thumbstick locomotion, 45° snap turns, one-controller and seated stations, movement pause, furniture/wall collision and focus/tracking recovery.
- Separated room layout and navigation rules for future connected rooms. The local backend, command history and permissions remain shared by every view.
- Added large-graph, routing, memory, browser-role, physical ray and emulated controller tests. Physical headset qualification remains pending.

## Unreleased — Interactive office

- Replaced the floating work arc with an original furnished 1980s office: drawers, folder racks, held files, brass keys, completion stamp, desk light and next-step telephone.
- Added dependency X-ray, reachable Quick View, return navigation, pins, file-all, complete cabinet/sheet/key paging and phone equivalents. Keys and locks derive from real prerequisite records, including cancellation, archive and reopening rules.
- Added controller grip attachment, near/ray grabs, release physics, tracking-loss recovery, in-room comfort controls and layered X-ray picking.
- Added geometry/key/visibility/disposal tests and real WebGL/Quest-runtime emulation checks. IWER is test-only. Hardware comfort and performance remain unqualified.

## Unreleased — Spatial developer preview

- Added `/spatial/`: editable project setup, one next step, shape/word/color states, prerequisite and resource navigation, status actions with undo, search, pagination and export through the existing local SDK.
- Added Three.js/WebXR stationary work arc, either-controller target-ray selection, relationship/notes paging, recenter, explicit exit and DOM fallback. Sound is optional and silent on every visit.
- Added interrupted-save recovery, stale-write handling, browser checks and a documented hardware validation boundary. Real headset testing and standalone hosting remain pending.
- The backend remains local-first and independent of Three.js. Private user work is excluded from source and release archives.

## 0.1.0 — 2026-09-08

Initial local developer foundation: pure work graph, strict versioned SDK, transactional SQLite adapter, durable command retries and audit events, workspace roles, full backup and portable snapshots, local HTTP/OpenAPI host, typed client, CLI, real stdio MCP server, perception profiles and adapter negotiation, six reference views and developer examples.

Personal-first and local-only. No hosted services, remote identity, sync, recurring reminders, calendar connectors or physical assistive-device drivers. See the acceptance record for actual verification.
