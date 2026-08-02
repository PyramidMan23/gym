# Gym v2 → handoff to the live app

Design: **Instrument** (option 1a) with the **charge ring** from 1b. Dark scheme first. Prototype: `Gym v2.dc.html`. Faithful copy of the current build for reference: `Gym - Current.dc.html`.

The redesign is a **CSS + markup change**. It needs no change to `core.js`, `sync.js`, `coach.js`, `profiles.js` or `exercises.js`, and it keeps every id / `onclick` / test selector in `index.html`, so `tests/browser-flow.mjs` keeps passing.

## 1. Token diff (`styles.css` `:root`)

v2 ships **both schemes and follows the system** (`prefers-color-scheme`, `color-scheme: light dark`). Every colour in the prototype is a token, so porting is a `:root` swap — no per-component edits. Dark values first, light in the media query.

Only these change. Everything downstream inherits.

| Token | Now (dark) | v2 (dark) | Why |
| --- | --- | --- | --- |
| `--page` | `#0D0E10` | `#0B0C0D` | deeper base so one warm light source reads |
| `--card-bg` | `linear-gradient(180deg,#1D2228,#171B20 60%,#131619)` | `linear-gradient(180deg,#1a1d20,#141618)` | flatter, less "box" |
| `--card-hair` | `rgba(255,255,255,.16)` | `rgba(255,255,255,.07)` | hairlines, not borders |
| `--group-bg` | *new* | `rgba(255,255,255,.035)` | grouped inset list surface |
| `--hair` | `rgba(255,255,255,.10)` | `rgba(255,255,255,.06)` | |
| `--taupe` | `#8A9097` | `#8A9097` | unchanged |
| `--faint` | `#868D94` | `#7d848b` secondary / `#6b7279` tertiary / `#5f666d` disabled | 3-step quiet scale (all ≥4.5:1 on the new surfaces) |
| `--amber` | `#FF8A3D` | `#FF8A3D` | unchanged — identity kept |
| `--amber-soft` | `#FFB070` | `#FFB070` | unchanged |
| `--teal` | `#2EC5E0` | `#2EC5E0` | unchanged, still the "confirmed / tolerated / safe" signal |
| `--radius` | `16px` | `22px` cards · `20px` groups · `16px` buttons · `15px` controls · `13px` chips | |
| `--nav-radius` | `26px` | `22px` | |
| `--shadow` | 3-layer | `0 18px 40px -20px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.08)` | one soft cast + top light |

Light scheme: the prototype's paired light values (page `#F4F0E7`, card `#FFFFFF`→`#FBF7EF`, ink `#211C17`, muted `#665F54`, amber `#E06E1F`, accent text `#9A480A`, teal `#0B6E77`, danger `#AA463C`) match `styles.css`'s existing light `:root`. Two rules make the swap work: **overlay tints are an RGB token** (`--w: 255,255,255` dark / `20,15,8` light) so every `rgba(var(--w),.06)` hairline flips polarity, and **gradient stops use a separate token from accent text** (`--soft` stays light — `#EF8A3D` — while `--acc` goes dark — `#9A480A`) so amber CTAs keep light-to-dark shading while amber *text* stays legible on cream. Shadow alphas are authored for dark (.85–.95), so light uses a near-surface warm tint (`--sh: 224,214,194`) instead of black.

**Naming:** long catalogue labels are abbreviated so exercise titles stay on one line — "Tibialis Raise (Double-Leg)" → **"Tibialis Raise (DL)"** (use SL for single-leg). Change it in `exercises.js`; ids are untouched, so history and PRs carry over.

## 2. Structural changes, screen by screen

| Screen | Change | Files |
| --- | --- | --- |
| **Today** | Three arc gauges → **one charge ring**: outer arc = sessions + volume, inner = completed sets, centre = the average as one number. Tapping it opens the weekly-goal sheet (`openRingGoals()`, unchanged). Week ticks stay. | `renderActivityRings()` in `app.js` emits one `<svg>` instead of three `.arc-gauge`; `#activityRings` id kept |
| **Today** | Coach/ramp card → "UP NEXT" card: exercise **chips** instead of a bullet list, one full-width CTA. Desk Reset + last session collapse into one grouped list. | `renderCoach()`, `renderDeskReset()`, `historyCard()` |
| **Train** | The grid of boxes is gone. Order is now: plan hero → your routines (grouped list) → sessions (one filter rail + grouped list) → plans (horizontal shelf). | `renderTrain()`, `renderWorkouts()`; `.template-grid` rules retired |
| **Library** | Row list becomes a grouped inset list; muscle rail unchanged; the star column keeps its 44px target and filled/outline shape cue. | `renderCatalogue*()` |
| **Progress · calisthenics** | Ty trains bodyweight-first, and bodyweight strength does not progress in kilos, so it gets its own ledger in **Trends** beside the e1RM chart. Three parts: **max set · reps** (Pull-Up, Bar Dip +8 kg vest, Deficit Push-Up) as a milestone bar with the previous best rendered as a ghost fill behind the current one, so a rep gained is visible; **holds · seconds** (Dead Hang, L-Sit, Tuck Front Lever) on teal time bars against their next tier; and a **NEXT UNLOCK** line stating the rule that fires next ("3 more clean pull-up reps and the vest goes to +12 kg"). Header shows the block delta, e.g. "+9 reps this block". | new `Core.caliProgress(history)` reading rep counts, `sideTag`/vest load and timed-set seconds off existing sets — `timed:true` and vest logging already exist in `exercises.js` | — the same modules, one visible group at a time instead of a 3000px scroll. DOM order inside each segment is unchanged. | `renderProgress` region of `index.html` + a `progressTab` var |
| **Workout** | The screen you stare at for hours, so it carries the most life. Sticky header: clock + live volume + **session progress bar and "n sets left"**. Warm ambient bloom behind the top of the view. Each exercise is a **numbered card with its own progress bar and set counter**; the current exercise is lit (amber-tinted radial, amber border, elevation) and everything else recedes. A finished exercise **collapses to a calm done row** (tick + "3 sets · 1.6k kg · RIR 2", tap to reopen) — scroll shrinks as the session goes. Target strip is graphic: teal `Last · 60 kg × 8` with an amber **delta chip** (`+1 rep` / `+2.5 kg` / `hold`), then `TODAY 60 kg × 9` at 20px. Set rows: 52px values with inline units (number optically centred, unit hung outside it), the next-up row carries an amber rail + ring + `NOW` tag — **only ever one in the session** — done rows fill amber, a set that beats last time gets a `PR` tag and a brighter wash. Done button is a 52px circle with a gradient fill, glow and spring pop. Tapping a value opens the number pad (`openPad`, unchanged) — **first digit replaces the pre-filled value**, ± nudges by the weight step, entry is clamped (≤500 kg / ≤100 reps), and plate math only shows for barbell lifts ("per hand" for dumbbells, nothing for machines/bodyweight). | `renderWorkout()`, `workoutExerciseMarkup()`, `openPad()` |
| **Workout · reorder** | **Long-press any exercise header (or its grip) to reorder.** The whole list collapses to ~68px rows on pick-up so a 6-lift session is reorderable with a short drag; the lifted row anchors to the finger, neighbours slide out of the way, release commits and re-expands. Drag listeners live on `window` (the pressed node is replaced by the collapse re-render, so a card-level `pointerup` can be lost), and a >8px move before the 360ms threshold cancels the press so scrolling still works. Port note: this is a new `reorderSession(from,to)` on the session array — order is already persisted per session, so `saveState()` is the only extra call. | `renderWorkout()` + new pointer handlers; array move mirrors `tests/reorder.test.js` |
| **Workout · swap** | The ⇄ button on each exercise opens the picker in **swap mode** ("Replacing Barbell Bench Press · keeps 3 sets"): choosing a lift replaces that exercise in place, keeps the prescribed set count, and re-seeds the prefilled targets from the **new** lift's own confirmed history. | `openExercisePicker('workout')` gains a swap target; `pickExercise()` branches on it |
| **Rest** | Corner pill → **full-width pill with a countdown ring**, `+30s` and `Skip`. Same `startRest()` / `adjustRest()` / `skipRest()` contract, same `#restPill` id. | `startRest()` + `.rest-pill` rules |
| **Receipt** | Same lines, new type scale; PR block and "Next session" prescription unchanged. | `showReceipt()` |
| **Settings** | Same fields, restyled: rest timer + bar weight become segmented controls, checkboxes become 50×30 switches, sync block unchanged, build id in the footer. | `openSettings()` |
| **Workout · RIR** | The final-set RIR chips are 0–4+ **plus Skip**, and an exercise **cannot collapse until RIR is answered or skipped** — collapsing first made the tap unreachable (non-negotiable #3). Skip ⇒ the next target repeats verbatim; RIR ≤1 ⇒ hold; RIR ≥3 ⇒ one load step. The `why?` sheet states which rule fired. | `workoutExerciseMarkup()`, `core.js` progression rules (unchanged) |
| **Workout · exit** | A running session can be **minimised back to Today** (chevron in the header) and resumed from the "Session in progress" card — previously Discard was the only way out. Mirrors the source's `#returnChip`. | `navigate('today')` while `state.activeSession` lives |
| **Chrome** | No ambient blooms: the top "sun flare" and the bottom teal glow are both gone. Surfaces carry their own light (inset top-light + cast shadow) instead. | delete `body::before` / `body::after` in `styles.css` |
| **Nav** | **No change needed — v2 now matches the tab bar you pushed on 3 Aug** (`styles.css` SliceCo block): glass capsule at `left/right:14px`, `999px` radius, `blur(24px) saturate(180%)`, per-tab concentric pill that springs in (`inset:7px 3px`, `scale(.7)→1`, `320ms cubic-bezier(.34,1.56,.64,1)`), icon `scale(1.10)` + `stroke-width:2.2`, labels always visible and fade only, and the transform-only minimise on scroll-down (`scale(.80) translateY(6px)`, labels to 0, icons `translateY(7px)`). | none — already shipped |

## 3. Non-negotiables checked

- `core.js` untouched and still pure; all element ids, `onclick` names and test selectors preserved.
- Reduced-motion: every animation in the prototype is `transform`/`opacity` only and sits behind the existing global `@media(prefers-reduced-motion:reduce)` kill-switch.
- 44px+ targets everywhere — verified by measuring every `<button>` on Today, Train, Library, Progress, the active workout, and all nine sheets (pad, picker, swap, exercise options, why, settings, weekly goals, profiles, plan/routine/exercise detail): zero controls under 44px. Segments and switches keep their small visual (a 50×30 track, a 30px chip) inside a 44px tap area.
- No blue/purple-only signals; every state is shape + word + colour (done = tick + amber fill, prefilled = italic + muted, paused = the word PAUSED).
- Glass stays chrome-only (header, nav, sheets, rest pill); content cards are solid.

## 4. Suggested build order

1. Token block + nav indicator (one commit, visible everywhere, zero logic risk).
2. Today: charge ring + up-next card.
3. Workout cockpit + rest pill + pad.
4. Train reorder, Library grouping.
5. Progress segments.
6. Settings restyle.
