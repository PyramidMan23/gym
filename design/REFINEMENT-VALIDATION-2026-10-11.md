# Gym w72 refinement validation

Mark explicitly approved implementation, a full sweep, testing and deployment on 2026-10-11. Implementation used Sol 6.1 workers with a coordinating integration/release review. This is a refinement of the incumbent Gym design.

## Delivered behavior

- Edit sets and persistent operation-based Undo in an active workout, with exact removed-row restoration and isolation across duplicate exercises, reordering and profiles. Historical changes remain a draft until Save.
- Quick workout alongside preset sessions, a direct shortcut, and Recent/Favourites in the exercise picker. Existing workouts are protected from accidental replacement.
- Overview, Trends and Records share Monday-based local weeks and calendar months. Totals, selected days, tables and source workouts reconcile on completed working sets. Warm-ups, unweighted reps and timed holds are disclosed separately.
- One or two real observations are visible without invented trend claims. Exercise and bodyweight charts have exact readouts, keyboard selection, scrubbers and tables. Table selection retains keyboard focus and open details.
- All-time bests are grouped by exercise, with per-load details deferred until opened. Period records are distinct from baselines and previous-session improvements. Every record links to its actual source set.
- Narrow-phone logger spacing, readable labels, restrained metric hierarchy, and dark/light contrast improvements preserve the existing amber/teal identity and navigation.
- w71's previously unreleased cold-open update behavior is included deliberately, guarded against active/paused workouts, locked profiles and first-run naming. The build, service-worker cache and deployed stylesheet lists agree.

## Automated and rendered evidence

- Domain suite: 336 tests passed, including local calendar/DST boundaries, source provenance, warm-up exclusion, historical edits, repeated exercise rows, tied timestamps, PR baselines and update safety.
- Existing browser-flow: passed, including offline reload, resume, profiles/PIN, keyboard, drag reorder, rest/RIR, warm-ups, historical edit and 320/390/500 responsive flows.
- Stress suite: 68 checks passed, zero page errors.
- Layout suite: passed at 320/360/390/430 across four screens and first-run, profiles, filters, settings, picker, keypad, confirmation and receipt overlays.
- Broad contrast sweep: 5,534 rendered elements checked across both colour modes, zero failures. Focused Progress and logging suites also audit their new states.
- Focused logging: 14 checks covering Charlie's six-to-three correction, successive Undo, reload, flags, later edits, duplicate/reordered exercises, profiles, old all-time bests and historical drafts.
- Focused Progress: calendar context, chart/table reconciliation, sparse observations, typed metrics, source navigation, repeated keyboard/table use, whole-month marks, both themes and 320/390/768 layouts.
- Large-history browser fixture: 1,000 sessions with six lifts produce 6,012 underlying records, but only six groups and 12 initial record rows. Measured renders were below 100 ms on the test machine; this is an observation, not a device performance guarantee.
- Source syntax and whitespace checks passed. The Impeccable detector was run once; new undersized labels were corrected. Incumbent aesthetic warnings (amber shadows, existing kickers/rails) were not treated as permission to redesign the app.

Screenshots and complete test/review logs are local, ignored QA evidence under `artifacts/design-qa/surfaces/refinement/` and `refinement-review/`. They contain synthetic fixtures, not customer history. Existing harness expectations were updated where the approved behavior changed (PR baselines, the new Quick workout row, typed labels and lazy Progress panes); failure invariants were retained.

## Independent review and boundaries

Claude reviewed the core separately from the UI/release integration. The tied-timestamp finding was confirmed and fixed with equal-timestamp batch comparisons and three regressions. Undated legacy detector calls retain their documented compare-all compatibility; missing dates cannot establish historical chronology. Rejecting corrupted/non-finite or negative load values is intentional.

The UI/release review found no confirmed correctness, data-loss, security or production-breakage blocker. Root verified each concern against current source:

- Confirmed redundant PR rebuilds during a Records paint: changed to share one freshly rebuilt history between the period-record and history renderers. No persistent cache is introduced; historical edits cannot leave a stale ledger. Standalone searches still rebuild fresh.
- Confirmed stable `_logId` fields persist in saved sets: harmless storage overhead, retained for this release. The operation journal itself is removed on finish. Backup round-trips preserve these fields.
- Speculative chart/scrubber point mismatch: not reproduced; both paths select the same evidence/window and source-provenance regressions pass. No current bug established.
- Uncalled legacy renderers: confirmed cleanup opportunity, outside this bounded refinement; no live caller relies on the removed hosts.

Final post-review deltas were the verified ledger reuse, equal-timestamp grouping, text-size/endpoint-label corrections and test synchronization. No release is considered live merely because this validation file exists.

Physical iPhone/Safari/Android testing and Charlie's uncoached real-use acceptance have not been performed. No personal history was modified, no outbound messages were sent, and no origin/storage migration was introduced. Users on w70 must accept the initial Update ready prompt; later guarded cold-open updates use the new behavior.

Deployment receipt: `TheSolvaGroup/04_Operations/02_Reports-and-Audits/2026-10-11-gym-refinement.md`. The receipt records the actual commit, backup, both-origin asset hashes and any unresolved limits.
