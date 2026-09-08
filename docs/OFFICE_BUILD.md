# Interactive office goal

User objective: a polished game-like 1980s office, close in interaction feel to Job Simulator: filing cabinets and folders, task-earned keys unlocking cabinets/folders, holding folders, dependency X-ray, relevant files hovering in quick view, organized work and useful interaction tricks.

This replaces the floating-panel-only spatial presentation. The complete objective remains active until the actual room and interaction flows are implemented and inspected. A green backend test suite alone does not prove this experience.

## Acceptance requirements

1. A furnished first-person 1980s office: wood/laminate desk, metal cabinets with operable drawers, folders with readable labels, CRT/keyboard/phone, lighting/materials and original props. The rendered scene must read as an office rather than a dashboard with a background.
2. Work graph → organized filing: project cabinets, item folders, stable item IDs, complete retrieval across pages, completed records retained. Physical layout is presentation, not a second database.
3. Earned keys derive from finished prerequisite records. Folders and project cabinets display their actual locks. Multiple prerequisites require all corresponding keys. Reopening a requirement revokes its key; visual manipulation cannot bypass SDK rules.
4. Desktop and WebXR pickup, held-object inspection, release/return and recoverability. Actual grip-space attachment in XR, controller ray and near selection, one-handed alternatives, untimed controls.
5. Holding a folder and selecting Dependencies enables an X-ray view that reveals the relevant folders/cabinets and dependency paths, including files behind closed drawers or outside the current cabinet page. Restore ordinary rendering when dismissed.
6. Quick View brings relevant folders into a reachable forward arrangement with navigation and return-to-file. It must not move the user's head/camera in VR or duplicate work records.
7. Useful tactile interactions: drawer movement, completion stamp/key feedback, key tray, file-all/reset; optional sound and visual equivalents. No mandatory sound, dragging, throwing or timed action.
8. Usable desktop/phone fallback and clear first-open directions. Readable labels, no orphaned items, no camera/motion surprises, appropriate performance and resource disposal.
9. Meaningful tests for keys/locks, physical state/selection, X-ray reachability, quick view and backend write invariants; inspect actual rendered room and exercise interactions. Record simulator vs physical headset evidence honestly.
10. Review/publish the completed source on a new PR without personal data; leave merge to the user. Do not call the goal complete merely because a PR or passing tests exist.

## Art and interaction reference

The user's [Steam reference](https://store.steampowered.com/app/448280/Job_Simulator/) and [Owlchemy office screenshots](https://jobsimulatorgame.com/press/) were inspected as references. The implementation uses original geometry, textures and wording. Owlchemy's [accessibility notes](https://owlchemylabs.com/accessibility-statement) reinforce seated and one-handed alternatives. Three.js [WebXRManager](https://threejs.org/docs/pages/WebXRManager.html) distinguishes target-ray and grip spaces for pointing and holding.

## Current checkpoint

- PR #1 verified merged; new branch `feat/interactive-office` starts at `origin/main` (`e09d9e3`).
- Existing local/SQLite privacy and mutation safeguards remain required.
- The floating-panel renderer has been replaced by the interactive office. Original furniture, materials, lighting, drawers, folder racks, key tray, stamp, telephone and lamp render in actual WebGL.
- The complete catalog and key/lock rules are tested against the real SDK. Every work item, archived record, cabinet sheet and key page remains retrievable.
- Desktop ray interaction, held folders, X-ray, Quick View, completion stamps, key earning and persistence passed real browser tests. Geometry tests check grip parenting, hidden-file rejection, backend gates and disposal.
- IWER Quest sessions exercise real WebXR frame/input paths, including grip release, tracking loss, session visibility and exit. Actual stereo captures revealed and verified the fix for eye-reserved layer conflicts. This is emulation; physical headset qualification remains explicitly unperformed.
- Full browser suite: 40 passed, 8 engine-specific skips. Current unit/backend suite: 51 passed. Follow-up runs passed the corrected stereo/one-controller behavior and accessibility controls on all three browser engines.
- Screenshots were inspected for folder labels, dependency visibility, both stereo eyes, narrow-screen fit and complete desk controls. The acceptance record distinguishes those observations from hardware claims.
- Source, screenshots and documentation are published in [PR #2](https://github.com/RONITERVO/StateWork/pull/2); merge remains the user's action. The local desktop launcher and personal data remain ignored. The persistent local office was opened with the existing work records, and the desktop launcher passed its startup health check.
