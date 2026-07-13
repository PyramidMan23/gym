# Duck Gym Product Design Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn Duck Gym into a polished, motivating, low-friction mobile workout app built around navy/electric-blue activity rings, rapid workout logging, and clear weekly progress.

**Architecture:** Keep the existing offline-first, dependency-free structure: semantic screen shells in `index.html`, design tokens and responsive components in `styles.css`, rendering/interactions/persistence in `app.js`, tested domain calculations in `core.js`, and the Revo-tailored catalogue in `exercises.js`. Design work should improve hierarchy and flow without introducing a framework or breaking `duckGymV2` browser data.

**Tech Stack:** HTML5, CSS custom properties/SVG, vanilla JavaScript, LocalStorage, service worker/PWA manifest, Node built-in test runner, headless Chrome.

---

## 1. Product principles

1. **Logging speed beats feature density.** A user mid-set should understand the next action in under two seconds.
2. **Today is the motivational home.** Weekly rings communicate momentum; routines and Resume Workout remain immediately accessible.
3. **Numbers before decoration.** Every visual progress element must include an exact value and goal.
4. **One primary action per state.** Start, Resume, Finish, or Save should always dominate the current screen.
5. **Offline and private by default.** Every workout mutation persists locally; no account is required.
6. **Welcoming, not aggressive.** Use premium navy and electric blue with warm neutral surfaces rather than black/red bodybuilding clichés.
7. **Progress without guilt.** Empty and missed-goal states should encourage the next action rather than punish the user.

## 2. Information architecture

### Primary navigation

Keep four persistent destinations:

1. **Today** — activity rings, Resume Workout, routines, latest session.
2. **Train** — templates, saved routines, empty workout.
3. **Library** — searchable Revo-matched and custom exercises.
4. **Progress** — weekly consistency, totals, PRs, session history.

Settings remain in the header overflow button. Do not add a fifth navigation item.

### Critical user journeys

- First launch → understand value → start template/empty workout.
- Returning launch with active session → Resume Workout.
- Routine → active workout → enter weight/reps → complete set → rest → finish → summary.
- Today rings → inspect/edit goals.
- Library → search/filter exercise → add custom exercise.
- Progress → inspect trend → open historical workout.
- Settings → export/import backup → install app.

## 3. Visual direction

### Colour tokens

Retain and formalize these tokens in `styles.css`:

```css
:root {
  --paper: #f4f0e6;
  --surface: #fffdf8;
  --surface-2: #e9e4d8;
  --ink: #101c33;
  --muted: #687386;
  --line: #ddd7ca;
  --blue: #1677ff;
  --navy: #0b1f3a;
  --blue-soft: #dceaff;
  --sky: #8ed8ff;
  --ring-workouts: #2f8fff;
  --ring-sets: #65c4ff;
  --ring-volume: #d7a53f;
  --danger: #aa463c;
}
```

Rules:
- Navy is reserved for high-value focus surfaces: activity rings, resume state, timer/status overlays.
- Electric blue is the primary action and selected-state colour.
- Amber is reserved for volume/progress, not warnings.
- Red appears only for destructive actions.
- Never communicate state through colour alone.

### Typography

- **Manrope 800:** hero titles, key numbers, screen headings.
- **DM Sans 500–700:** labels, body copy, controls.
- Use system-font fallbacks so the app remains readable offline.
- Minimum mobile body text: 14px; labels: 10px only when uppercase with generous tracking.
- Avoid excessive all-caps outside kickers and compact metric labels.

### Shape and depth

- Cards: 18–26px radii.
- Inputs/buttons: 12–15px radii.
- Touch controls: minimum 44×44px.
- Use one restrained shadow family; do not stack gradients, glow, blur, and shadow on the same element.
- Use generous blank space rather than separator-heavy layouts.

## 4. Screen specifications

### Today

**Hierarchy:**
1. Date and encouraging greeting.
2. Resume Workout card, when an active session exists.
3. Activity rings.
4. Quick-start routines.
5. Latest workout.

**Activity card:**
- Outer ring: weekly workouts.
- Middle ring: completed sets.
- Inner ring: training volume.
- Centre: combined weekly percentage.
- Right legend: exact value/goal for every ring.
- Bottom: Monday–Sunday training markers.
- Overflow button opens weekly-goal controls.
- At 100%+, close the ring but preserve the true number in the legend.
- Empty state should show tracks and default goals, not an empty white card.

**Acceptance criteria:**
- Resume Workout appears before rings when present.
- All seven weekdays fit at 320px width.
- Rings remain distinguishable in grayscale through position and labels.
- Screen-reader label states all three values.

### Train

- Primary button: Start Empty Workout.
- Starter templates appear before saved routines only for users with no routines; afterward, prioritize saved routines.
- Routine cards show name, exercise count, and estimated set count.
- Separate Start and More actions with 44px targets.
- Routine builder uses a bottom sheet: name → exercise selection → ordered list → save.
- Avoid exposing advanced programming options until the core logging flow is proven.

### Active workout

**Sticky top bar:** elapsed time, workout title, Finish.

**Live summary:** completed sets, current volume, exercise count.

**Exercise card:**
- Exercise name and equipment.
- Previous-performance strip.
- Compact columns: set number, kg, reps, complete.
- Completion button is the strongest control in each row.
- Add Set remains inside the exercise card.
- Exercise menu supports notes, remove, and future reordering.

**Behavior:**
- Save after every input and completion change.
- Completed set triggers rest timer.
- Rest timer is visible but does not obscure logging controls.
- Finish requires confirmation only when there are zero completed sets.
- Successful finish shows a short summary with duration, sets, volume, and PRs.

### Library

- Sticky search field.
- Horizontal muscle/equipment filters.
- Show result count.
- Exercise rows show exercise, muscle group, and equipment.
- Use plus action when selecting exercises; use row tap for details only if a details screen is implemented.
- Clearly label recovery/non-lifting items.
- Custom exercise form requires name, category, equipment, and optional notes.

### Progress

- Top metrics: weekly workouts, weekly sets, weekly volume.
- Eight-week chart uses exact values via accessible labels/tooltips.
- PR section distinguishes weight PR from estimated-1RM PR.
- History cards show date, duration, completed sets, volume, and PR count.
- Empty state links directly to Train.
- Avoid adding social feeds, rankings, or arbitrary readiness scores.

### Settings and data

- Weekly activity goals.
- Default rest duration.
- Install Duck Gym.
- Export backup.
- Import backup.
- Destructive Clear All Data section visually separated at bottom.
- Explain local-only privacy in plain language.

## 5. Responsive behavior

### 320–390px

- Single-column layout.
- Activity card may stack rings above legend below 350px.
- Routine/template cards use one column.
- Set grid remains usable without horizontal scrolling.
- Bottom navigation respects safe-area insets.

### 391–649px

- Rings and legend sit side by side.
- Two-column template grid.
- Sheets fill width and anchor to bottom.

### 650px+

- App content max-width stays 760px; do not turn it into a desktop dashboard.
- Three-column templates are allowed.
- Sheets remain centred within app width.
- Preserve mobile interaction patterns because desktop is secondary.

## 6. Motion and feedback

- Ring fills animate once on first render, under 800ms.
- Set completion uses a brief colour/fill transition, not confetti.
- Buttons use subtle 0.98 pressed scale.
- Toasts confirm save/delete/import actions.
- `prefers-reduced-motion: reduce` disables ring, sheet, toast, and button motion.
- No perpetual animation.

## 7. Accessibility requirements

- Maintain visible `:focus-visible` outlines.
- All icon-only controls require `aria-label`.
- Dialogs need clear headings, close controls, and logical focus order.
- Progress SVGs must expose exact text through the containing `role="img"` label.
- Use native buttons, inputs, selects, and dialogs where possible.
- Validate at 200% browser zoom.
- Confirm contrast for blue/white, navy/secondary text, muted text/cream, and amber/navy.
- Never rely solely on ring colour or checkmark colour.

## 8. Implementation tasks

### Task 1: Document design tokens and component states

**Objective:** Make the visual language explicit and prevent inconsistent one-off colours.

**Files:**
- Modify: `styles.css:3-8`
- Modify: `README.md`

**Steps:**
1. Group tokens into surfaces, text, brand, semantic, rings, shadows, radii, and sizing.
2. Replace any remaining literal brand colours in component rules with tokens.
3. Add a concise Design System section to `README.md`.
4. Search for obsolete palette values.

**Verification:**

```bash
rg "#24664c|#164c38|green" styles.css index.html manifest.webmanifest icon.svg
```

Expected: no obsolete green identity values.

### Task 2: Add tested activity-goal normalization

**Objective:** Ensure old or corrupt saved preferences cannot produce `0 / 0` rings.

**Files:**
- Modify: `tests/core.test.js`
- Modify: `core.js`
- Modify: `app.js`

**Steps:**
1. Add failing tests for missing, zero, negative, and string-form goals.
2. Run `node --test tests/core.test.js`; expect the new tests to fail.
3. Add `normalizeActivityGoals(preferences)` to `core.js`.
4. Call it during read/migration and before ring rendering.
5. Run tests; expect all to pass.

### Task 3: Refine Today empty, active, and complete states

**Objective:** Make the rings emotionally useful across all weekly states.

**Files:**
- Modify: `app.js` in `renderToday()` and `renderActivityRings()`
- Modify: `styles.css` activity-card rules

**Steps:**
1. Add copy/state mapping for 0%, 1–49%, 50–99%, and 100%+.
2. Show a concise centre label and preserve exact legend values.
3. Add completion treatment that does not depend on animation.
4. Verify no active workout and active workout ordering.
5. Test at 320×800, 390×844, and 500×900.

### Task 4: Improve active-workout visual hierarchy

**Objective:** Make set entry and completion the fastest, clearest interaction.

**Files:**
- Modify: `app.js` active-workout render functions
- Modify: `styles.css` workout rules

**Steps:**
1. Audit every control for 44px touch size.
2. Strengthen completed-row state beyond button colour.
3. Keep previous-performance context visible but secondary.
4. Ensure long exercise names and 3-digit weights do not overflow.
5. Verify rest timer never covers Finish or set controls.

### Task 5: Add end-to-end browser flow checks

**Objective:** Protect the primary workout journey from design regressions.

**Files:**
- Create: `tests/browser-flow.mjs`
- Modify: `README.md`

**Steps:**
1. Start the app through `python -m http.server 4173 --bind 127.0.0.1`.
2. Automate: create routine → start → edit set → complete → finish.
3. Reload and verify history and ring changes persist.
4. Test Resume Workout after reload.
5. Test activity-goal editing and backup export/import.
6. Document the browser-test command.

### Task 6: Validate responsive and accessible states

**Objective:** Prove the design works on small phones and with accessibility settings.

**Files:**
- Modify as defects require: `styles.css`, `index.html`, `app.js`
- Save evidence: `artifacts/design-qa/`

**Steps:**
1. Render Today, Train, Library, Progress, active workout, and settings at 320×800.
2. Repeat at 390×844 and 500×900.
3. Test 200% zoom and long exercise/routine names.
4. Test keyboard-only navigation and visible focus.
5. Test reduced-motion emulation.
6. Record defects and fix only reproducible issues.

### Task 7: Final PWA and documentation pass

**Objective:** Ensure the finished design installs and updates reliably.

**Files:**
- Modify: `sw.js`
- Modify: `manifest.webmanifest`
- Modify: `README.md`

**Steps:**
1. Increment the cache version after all asset changes.
2. Verify manifest theme and icon match electric blue.
3. Install via browser and cold-launch offline.
4. Confirm an updated cache replaces old green assets.
5. Update README screenshots, launch instructions, architecture, privacy, and tests.

## 9. Validation checklist

### Automated

```bash
node --check app.js
node --check core.js
node --check exercises.js
node --check sw.js
node --test tests/core.test.js
```

Expected: syntax checks exit 0 and all tests pass.

### Functional

- Create, edit, duplicate, start, and delete a routine.
- Start empty workout and template workout.
- Add/remove exercise and set.
- Enter weight/reps, complete/uncomplete set.
- Verify previous performance.
- Verify rest timer and duration.
- Refresh mid-workout and Resume.
- Finish and verify history, PRs, metrics, and rings.
- Edit ring goals.
- Search/filter library and add custom exercise.
- Export/import backup.
- Install and cold-launch offline.

### Visual

- No green identity remains.
- Navy/electric-blue hierarchy is consistent.
- Three ring tracks remain distinguishable.
- No horizontal scrolling at supported widths.
- Bottom navigation never hides required content.
- Empty states contain a next action.
- Long names, large numbers, and 200% zoom do not clip.

## 10. Risks and tradeoffs

- **Volume goals can disadvantage bodyweight workouts.** Keep separate workout/set rings and consider future “effort points” only after real usage proves the need.
- **LocalStorage is device-specific.** Export/import is sufficient for the current private MVP; accounts/cloud sync are explicitly out of scope.
- **Remote fonts weaken strict offline fidelity.** System fallbacks are required; self-hosting fonts is optional later.
- **Rings can feel derivative.** Maintain Duck Gym’s distinct navy/cream card, weekly lifting metrics, typography, and restrained feedback rather than copying Apple Fitness styling.
- **Too many analytics increase guilt and clutter.** Add new metrics only when they change a training decision.

## 11. Definition of done

The design phase is complete when:

- Today communicates weekly progress and the next action in under two seconds.
- A routine workout can be started and the first set logged with minimal taps.
- Active sessions survive refresh and visibly resume.
- All core calculations and migrations pass automated tests.
- Primary flows pass browser automation.
- Every major screen passes mobile, zoom, keyboard, and reduced-motion QA.
- Installed/offline builds show the current navy/electric-blue identity.
- README accurately documents launch, privacy, architecture, backup, tests, and installability.
