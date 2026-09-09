# Wall calendar and daily recommendations

The user asked for a large useful calendar in the office, and an ordered recommendation plan per day even without deadlines. Default: four focused hours on weekdays; one-click reductions for late starts.

Completion requires:

1. A real large wall calendar, a clear viewing station and controller/desktop ray interaction, alongside the existing detective board.
2. Readable month/week context and a selected-day order of work, with a full-screen keyboard/touch alternative, brief states, shapes/colors and direct source/file actions.
3. Shared backend/SDK recommendation logic: dependency order, real deadlines and inherited urgency, priority, ongoing work, estimates, fixed appointments, available capacity and explicit unplaced work. No deadline is required; suggestions never become appointments or completion records by inference.
4. Editable daily capacity/workdays, one-click defer and next-choice controls, clear unknown-estimate/conditional labels, long-task progress and a smaller plan after a late start. Completed work must not endlessly refill today's capacity.
5. Correct local dates, DST, month/week boundaries, overnight bookings and overlaps. Real schedules/dates remain unchanged. Previously completed/archived records stay in the underlying work history.
6. Authenticated read-only plan access for developers, existing write permissions/versions/receipts for explicit progress or completion, and no private workspace data in publication.
7. Meaningful pure-planner, API, browser, physical-ray and XR-emulation checks, including deadline-free and larger graphs; inspect actual calendar renders. Distinguish emulation from unperformed hardware qualification.
8. Publish on a new PR from the merged detective-board work, with documentation and verification evidence, and leave the merge to the user.

Implementation starts from merged PR #3, commit `73852e2`, on `codex/wall-calendar`.

Verified implementation: shared pure/SDK/HTTP planner, physical wall/station, accessible month/week/day controls, local preferences and completed-allocation accounting, explicit versioned progress commands, source navigation and paged review. Unit/API, complete browser integration, software-rendered ray and IWER controller evidence is recorded in [ACCEPTANCE.md](ACCEPTANCE.md). [CALENDAR.md](CALENDAR.md) describes the public contract and limits. Publication is via a new pull request; merge remains a user action.
