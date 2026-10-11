# Gym refinement plan

11 October 2026. Proposed implementation, following Charlie's feedback and Mark's request for a restrained, polished improvement. Planning and inspection only; application code and live deployments are unchanged.

## Direction

Help someone holding a phone between sets log quickly, correct mistakes, and understand whether training is progressing. Keep the current amber and teal identity, dark and light themes, cards, workout cockpit, and four main navigation tabs. Refine the existing interface rather than replace it.

Use the Apple question as a decision test: is the next action apparent, can a mistake be reversed, does each number explain itself, and can detail be revealed without crowding the first screen? Apple references: [Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo) and [Charts](https://developer.apple.com/design/human-interface-guidelines/charts). The specific proposals below are our application of those principles.

## Current state and evidence

- Both public origins serve `w70-20260902-presence-firstrun` as of this review. The local branch `gym-v2-redesign-20260803` and its remote are at `e5c1fee`, w71. Remote main remains w70. W71 changes the update mechanism; it is not a visual redesign and has not been released.
- Local `styles.css`, `index.html`, and `core.js` match the live VPS files after line-ending normalization. Local app.js differs from remote main in the w71 service-worker update logic. The rendered local UI is therefore a useful design reference for the live interface.
- Reviewed the local first-run, Today, Train, active workout, exercise options, Progress Week/Trends/Records and Library at 390 by 844. Populated historical charts were inspected in source, not through Charlie's data. His installed build, personal history, and physical-phone behavior remain unverified.
- Charlie's supplied messages describe accidentally adding six bench sets when he performed three, being unable to delete extras, and difficulty finding a workout where exercises are added as he goes. These are user feedback, not independent authorization to send messages or modify his records.
- Four modified QA screenshots already existed in the checkout. Preserve them and do not include them as this task's work.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Active set removal is missing | `app.js` setMarkup and addSet; workout and exercise-options UI. Removal exists only in removeHistorySet for finished sessions. | A common logging mistake cannot be corrected where it happens. |
| Quick workout depends on plan state | renderPlanHero shows the empty-session action only when no plan is installed. renderWorkouts lists presets without a permanent quick-workout entry. | Installing a plan makes the alternative harder to find. |
| Time windows differ by module | renderWeekPane, renderStrength, renderBodyweight and caliProgress use different horizons; no shared period control. | Nearby numbers can describe different spans without making that obvious. |
| A PR label has two meanings | setMarkup labels a set PR when it beats the previous session's top set; detectPRs compares historical bests. | An improvement since last time can look like an all-time record. |
| Partial periods are compared with full periods | Core.weeklyRecap compares this week to date against all of last week. deltaChip gives increases a positive colour. | Early-week figures can look worse simply because the week is unfinished; more volume is not automatically better. |
| Chart values are difficult to inspect | chartSvg emits static paths and circles; week bars have no selection interaction. | Users cannot readily read a point or open the workout supporting it. |
| Some useful features are hidden | styles.css hides the Goals board, detailed muscle board and consistency chart in Progress. | Reuse the existing logic selectively rather than rebuilding or exposing every old module. |
| Timed lifts need correct metric routing | Core.exerciseTrend returns seconds and zero e1rm for timed exercises, but renderStrength plots e1rm without filtering timed candidates. | A sufficiently logged hold can enter a kilograms strength chart incorrectly. |
| Empty states dominate Trends | The reviewed fresh profile shows four large no-data sections. Week shows repeated zero/no-change comparisons. | A new user gets little guidance and a long screen of missing information. |

## Pass 1 Make logging forgiving

### Remove sets and undo

Add a visible **Edit sets** action in each exercise header. In edit mode, replace each completion control with a clearly labelled, accessible remove control; keep the weight and reps columns aligned. The existing number-tap side tagging keeps its meaning. Do not make swipe or long-press the only way to delete.

Removing a row updates the set numbering, totals, current row and remaining-set count immediately, saves the active session, and offers **Set removed · Undo**. Support successive removals and undo within the current session. Keep an accessible Undo action available in edit mode rather than relying solely on a brief toast. The final row can be removed while keeping the exercise and its Add set action.

An undo restores the actual removed row, including weight, reps/seconds, done state, warm-up/drop flags, RIR and side tag. It must restore only that removal, not overwrite sets logged afterward. Identify the session and exercise instance reliably; duplicate exercise rows, reordering, profile switching, finishing, and discarding must not redirect an undo into another workout. Reconcile rest-timer references without restarting a rest or firing a fresh PR celebration. Give manually added sets an immediate Undo affordance too.

Keep historical editing as a draft with Save and Cancel. Use compatible removal affordances there, preserve original workout ids/timestamps, and retain the existing chronological PR rebuild and sync behavior.

**Acceptance:** Charlie's six-to-three scenario works without finishing the workout; any row can be removed; Undo restores its exact contents; removal survives reload; no other exercise/session/profile changes; deleting the last row leaves a usable empty exercise. Test completed, blank, warm-up, drop, timed, duplicate-exercise and reordered cases.

### A permanent quick workout

Place **Quick workout** as a permanent first row in the Sessions area alongside the presets, with the subtitle **Start empty. Add exercises as you go.** It remains visible with or without an installed plan and under every goal filter. Keep it out of the preset count. Also place a compact **Quick workout** shortcut directly below the plan hero so it is reachable without scrolling through routines.

Use the existing startQuickWorkout path. One tap from Train starts an empty session; open the exercise picker immediately, with Recent and Favourites easy to reach. Cancelling the picker leaves a clear Add exercise action. An existing workout must be resumed or handled through the existing protection flow, never silently replaced. Keep Save as routine available after an improvised session.

**Acceptance:** test no plan, installed plan, many routines, active workout, narrowed preset filter, and a fresh profile. Each entry starts the same flow; none duplicates the session or loses an active workout.

## Pass 2 Make Progress understandable

Keep three destinations: **Overview · Trends · Records**. Overview replaces the word Week so it still makes sense when a month is selected.

### One period model

Use one compact period control for **Week / Month**, an explicit date range, previous/next arrows, and a return-to-current action. Preserve the selected period when moving between the three sections. Add Year only if longer histories justify it after the first two views are verified; it is not necessary for Charlie's fixes.

Centralize calendar boundaries and aggregation in core.js. Use local-calendar weeks beginning Monday and calendar months, with end-exclusive boundaries. Do not add fixed 24-hour milliseconds across daylight-saving changes. All date-filtered summaries, charts and history rows use the same window and eligibility rules.

For an unfinished period, either compare the equivalent elapsed part of the previous period and label it, or suppress the delta when comparison is not defensible. Closed periods compare complete periods. Use **No previous data**, not a fabricated percentage or repeated no-change chips. More volume is a neutral change unless there is a defensible goal context.

### Overview

Lead with sessions and completed working sets, followed by training volume and duration. Give volume its plain explanation, **load × reps**, and preserve the distinction between external load and existing estimated bodyweight contributions. Holds remain seconds, unweighted repetition work remains reps, and absent body mass never becomes invented kilograms.

Show one main activity chart with a compact metric selector for working sets, sessions or volume. Use daily bars for the selected week/month. A selected bar reveals its full date, exact value and matching sessions below. A table/list view provides the same information without requiring chart interaction. The headline, bars and table must reconcile.

Keep the sets-per-muscle summary, sorted and readable. Reveal direct/assisting contributions on tap, reusing the existing muscle ledger. Restore only a compact goal summary with a details action; do not bring back every hidden module as a card.

### Trends

Move the exercise selector above the graph. Use **Best set** as the readable companion to **Estimated 1RM** (estimated one-repetition maximum), with the latter labelled as an estimate. Show load and reps for the underlying set; do not present an estimated maximum as a weight actually lifted.

Route timed exercises to best hold in seconds, and unweighted repetition work to reps; never graph these as zero kilograms. Keep distinct records for comparable metrics and disclose added load. Bodyweight stays a separate measured series.

Tap, keyboard-select or scrub a chart to reveal date, exact metric and the source session. Under it, offer a compact table: **Date / Best set / Estimated 1RM** for loaded lifts, with suitable columns for holds or bodyweight work. Allow opening the workout from the row.

Show one logged observation as a point and two as two observations, while reserving trend judgments until enough comparable evidence exists. This deliberately revises the current three-session blank-screen gate without pretending that one observation establishes progress. Do not interpolate unlogged sessions or smooth lines into invented measurements.

### Records and history

Separate **All-time bests** from **Records earned in the selected period**. All-time bests remain explicitly labelled and do not silently become period bests when the date control changes. History is grouped by date/month and filtered by the selected period, with an obvious All history route and exercise search.

Give every record its type, result and date: heaviest load, estimated 1RM, rep best at a stated load, or hold time. Link the result to the actual set/session. Values originating from different sets must not be combined into a fictitious performance. First logs establish a baseline; subsequent improvements can earn a record.

Make logger, receipt, record list and edited-history results agree. A row that only beats the previous workout says **Better than last time**; reserve **PR** for a genuine historical best under the same evidence rules. Test the case where an older all-time best exceeds both the last session and today's set.

**Acceptance:** no data, one/two/many observations, all-unweighted history, holds, repeated exercise rows, warm-ups, incomplete/zero-rep sets, a midweek view, month/year boundaries, DST, edited old records and removed records. Independently recompute the headline from the displayed table's underlying sessions.

## Pass 3 Focused visual refinement

- Keep the current visual system. Align section headings, units, numbers, row heights and dividers; use tabular numerals for values. Improve faint text and small chart labels in both themes.
- In the logger, emphasize the next set and its weight/reps fields. Reduce competing highlights around metadata and secondary actions while retaining the current workout identity.
- Make picker search, Recent/Favourites and **Add to workout** easy to find. Keep the Library's existing catalogue and search; improve its empty-state route into Browse all.
- Keep one clear action in each empty state and compress sections with no data. Preserve access to bodyweight and balance without implying that missing side tags are measured symmetry.
- Keep chart axes, units, date labels and selection readouts consistent. Use bars for period totals and points/lines for measurements over time; retain zero baselines for bars.
- Provide at least 44px touch targets, keyboard focus, screen-reader labels and chart data alternatives. Colour is supported by words/shapes, particularly for PRs and comparisons.
- Check bottom navigation, return-to-workout banner, number pad, rest timer, Undo and sheets together so they cannot obscure each other's actions. Respect reduced motion and avoid new tab-transition effects.

## Implementation and release order

1. Work on an isolated local branch based on the verified live commit, or explicitly reconcile the already-built w71 first. Do not silently include its update behavior. Preserve existing QA-image changes.
2. Implement the two logging fixes first in app.js, index.html and narrowly scoped styles. Reuse existing session creation and persistence. Add focused domain and browser regressions for the failure paths above.
3. Add the period/metric helpers in core.js and test their calendar and evidence rules before connecting the Overview, Trends and Records renderers. Reuse chart and history foundations rather than introducing a new framework or chart dependency.
4. Apply the visual pass once the interactions and numbers are stable. Capture populated and empty states at 320, 390 and wider layouts in both themes; validate touch/keyboard paths, large text, reduced motion, offline reload, resume and historical edits.
5. Run the relevant existing Node and browser suites, contrast/layout checks, and a cold cross-review before any nontrivial release. Treat screenshots and automated checks as evidence about those conditions, not physical-phone acceptance.
6. Present the local result for Mark to review. Deploy only on an explicit deployment instruction, using the existing deploy.sh process for both origins, with backup, coordinated receipt, matching build/cache ids and asset verification. Do not clear users' storage or redirect an installed origin.
7. The final real-use check is Charlie removing accidental sets and starting an improvised workout without being coached through the interface. His confirmation is still needed after release; it has not occurred in this review.

## Boundaries

No navigation overhaul, new branding, backend/storage migration, workout prescription changes, automatic side tagging, or revival of parked biomechanics/weekly-assessment work. No modifications to Charlie's history. No sends, commits, pushes or deployment have been performed for this planning task.

## Implementation update 2026-10-11

Mark subsequently explicitly approved building, testing and deploying the full refinement. Work is isolated in `C:\Users\markh\Claude-Workspace\gym-refinement-20261011` on `codex/gym-refinement-20261011`; the original checkout and its existing QA screenshot changes are preserved.

The release implements the logging correction flow, permanent Quick workout routes, Recent/Favourites picker, shared calendar periods, sourced charts/tables, typed records and history refinement above. The existing visual identity and four-tab navigation remain. Records render only when selected, group by exercise and defer per-load detail; dense monthly charts show the whole month with a precise scrubber and table. Tables preserve disclosure and keyboard focus after selection.

The previously unreleased w71 update behavior was reconciled explicitly: an update waiting more than 24 hours can apply on a cold idle open only when no active/paused workout, profile lock or first-run naming flow exists. Existing w70 installations still need to accept the initial Update ready prompt. No storage migration or origin redirect is introduced.

Release candidate: `w72-20261011-refinement`. Validation and deployment evidence are recorded in `design/REFINEMENT-VALIDATION-2026-10-11.md` and the dated Solva operations receipt. The planning-only boundaries above describe the earlier planning phase; this update records the later implementation/deployment authorization.
