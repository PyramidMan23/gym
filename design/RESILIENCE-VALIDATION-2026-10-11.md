# Gym w73 resilience and long-term progress

Mark explicitly approved all six follow-on improvements, Sol 6.1 implementation assistance, broad testing and deployment on 2026-10-11. This continues the existing Gym design and w72 refinement.

## Scope

1. Exercise and measured bodyweight trends offer rolling 3-month, 6-month and year windows. Overview and Records retain their local-calendar Week/Month context. Sparse observations remain visible without inventing a trend.
2. Rest deadlines survive refresh/reopen and belong to a stable exercise instance, workout and profile. Expired timers are consumed quietly on boot; paused, removed and finished workouts cannot retain a running timer.
3. Removed exercises have persistent, exact Undo. Deleted workouts move to Recently deleted in Settings and remain recoverable, including through downloaded backups. Restoring rebuilds records and requeues cloud backup.
4. Progress choices and per-exercise rest durations are saved per profile, including an explicit zero-second rest. Opening Progress starts at the current date, not an old frozen date window.
5. Today, workout metrics, receipts and Progress use the same completed working-set definition. Warm-ups remain logged and visible separately. Week dots use local calendar dates across daylight-saving boundaries.
6. Browser interruption/reload/offline/profile tests cover the available environment. Mark selected Android for the physical-device check below; physical acceptance is pending.

All-history/search renders 30 initial rows and reveals more on request. Date formatters are reused, while fresh history and PR calculations prevent stale results after editing or restoring. No customer history was used in fixtures or modified on the live origins.

## Android acceptance check

Use the installed app on the same origin as your existing history. Accept Update ready outside an active workout, then confirm Settings shows `w73-20261011-resilience`.

- Start Quick workout from Train, add an exercise, log a set and start rest. Lock the phone for 20 seconds, reopen and confirm the remaining time has advanced correctly.
- Switch to another app and back, then refresh during rest. Confirm the set and remaining rest survive. Let a rest expire while closed; reopening must not repeat an old alert.
- During a workout, take an incoming call and return. Confirm the session, set values and timer still match. Android may suspend browser audio in the background; an alarm while locked is not guaranteed.
- Go offline, log a set, remove an accidental set and Undo. Reopen offline, confirm the workout remains, then reconnect.
- Remove an exercise and Undo after refresh. Finish the session, delete it from history, then restore it from Settings > Recently deleted. Confirm its source sets and records return.
- Switch profiles and back. Confirm Progress choices and rest preferences remain with their own profile.

Report any failure with the action, phone/browser version and screenshot. These are manual acceptance steps, not claims that a physical phone was tested remotely.

## Validation and release status

- Domain suite: 356 tests passed, including calendar boundaries, typed work totals, backup round trips, profile guards and in-flight cloud delete/restore races.
- Full browser flow passed after integration: offline reload, resume, profile/PIN, keyboard, drag reorder, rest/RIR, warm-ups, history editing and responsive views.
- Stress: 68 checks, zero page errors. Layout: four screens and nine overlays at 320/360/390/430 pixels. Broad contrast: 5,541 rendered elements across both themes, zero failures.
- Logging resilience: ten groups passed, including timer refresh/pause/expiry/profile isolation, exact exercise Undo, explicit zero rest, superset routing, deleted-workout restore/PR recalculation, backup/import and history editor totals. Captured browser errors/exceptions: zero. Prior logging refinement's 14 checks also pass.
- Progress resilience: nine groups passed, including 3/6/12-month boundaries and sparse observations, chart/scrubber/table provenance, real profile switches and reloads, bounded history/search, unknown/mixed durations, both themes at 320/390/768 and 130% text. Prior focused Progress suite also passes.
- Cross-surface metrics: Today/live/receipt/Progress/muscle drilldowns reconcile; warm-up-only work stays separate, weighted holds never become kilogram volume, mixed loaded/unloaded reps remain visible, missing duration stays unknown. Offline reload, both-theme layouts and magnified Today layout pass with no page errors.
- Large-history evidence: 1,000 workouts initially render 30 rows, with keyboard-accessible expansion. Measured renders were under 100 ms on this test machine; this is not an Android-device guarantee. The 6,012-record fixture renders six exercise groups and 12 record rows; no date formatters are constructed during search.
- Rendered review covered long-range charts, enlarged labels, missing/mixed duration cards, exercise rest/Undo and recovery sheets. Chart left padding was increased to prevent enlarged y-axis labels clipping on 320-pixel screens. The Impeccable detector ran once; incumbent visual-identity warnings were retained within the requested refinement scope.

Evidence is local and ignored under `artifacts/design-qa/surfaces/resilience/`, `resilience-progress/` and `resilience-review/`. Fixtures are synthetic. The original checkout's existing screenshot changes remain untouched.

## Independent review adjudication

Claude reviewed domain, UI and follow-up sync/integration changes separately. Root verified findings against current code and ran the tests independently; the reviewers were read-only.

- Confirmed: invalid optional rest metadata should not block recovery of valid workout history. Invalid timers now drop; valid timers normalize; malformed workout/recovery structure still rejects before persistence.
- Rejected recommendation: silently discard malformed deleted workouts. Recently deleted is recoverable workout data; explicit import rejection preserves the current profile and source backup rather than silently losing entries. This is intentional validation, not a regression.
- No current defect: leading-zero metric regex difference. The producer emits canonical numeric keys; unsupported inputs cannot be generated by the app.
- Confirmed: zero rest skipped next-set progression. Zero rest now advances immediately with no timer, including superset handoff; regression tests cover both paths.
- No defect: Undo after an absolute rest deadline has expired consumes that expired timer quietly. Restarting elapsed rest would invent extra rest time. Exercise/sets restore exactly.
- Confirmed minor churn: a no-rest workout re-entered rest restoration on every render. The call now requires persisted rest state. Bodyweight range copy now names the selected trend range consistently.
- Confirmed bounded cleanup/status improvements: deletion revisions are held only during an in-flight flush and cleared once it settles. Returned status refreshes after any follow-up upload. A promise returned by `finally` is awaited (the review's claim that connect could proceed before it completed was false); its old resolution value was the actual issue and is fixed.
- Existing limitation retained: remote deletion, including late orphan cleanup, is best-effort. Offline/auth failures can leave a Drive copy; local deletion/recovery remain durable. No new cloud history download or silent data migration was introduced.

Integration testing also found and fixed goal/preference loss on import, mixed loaded/unloaded rep breakdowns, timed holds incorrectly counted as kilograms in collapsed rows, missing history durations shown as one minute, and all-unknown Progress duration shown as zero.

Deployment is recorded in `TheSolvaGroup/04_Operations/02_Reports-and-Audits/2026-10-11-gym-resilience.md` after live verification. Physical Android lock-screen, incoming-call and real-workout acceptance remain pending.
