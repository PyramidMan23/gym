# Redesign port — Claude Code brief

Apply the Gym v2 redesign to this repo. You have two reference files:

- `design/HANDOFF.md` — the port plan: token diff for both colour schemes, a screen-by-screen table mapping each change to the exact `app.js` function or `styles.css` rule, and the commit order.
- `design/Gym v2.dc.html` — a working prototype of the finished design. It is the **visual and behavioural spec**, not code to lift. It has seeded demo data and its own tiny React-ish runtime; the real values must keep coming from `core.js`.

Read both fully before you write anything.

## Hard rules — violating any of these means the work is wrong

1. **Do not modify `core.js`.** If a change seems to need new domain logic, add a new pure function with its own node test rather than editing existing behaviour.
2. **Preserve every contract:** element ids, `onclick` handler names, `data-view` attributes, and anything `tests/browser-flow.mjs` selects. The redesign is CSS + markup + render-function output, not an architecture change.
3. **Keep both colour schemes token-paired.** Every colour goes through a `:root` variable with a `prefers-color-scheme: light` override. No hardcoded hex outside the token block.
4. **44px minimum touch targets, everywhere, including inside sheets.** The visual glyph may be smaller; the tappable area may not. This is verified by measurement, not by eye.
5. **Reduced motion:** every animation must be `transform`/`opacity` only and must fall under the existing global `prefers-reduced-motion` kill-switch.
6. **No colour-only signals.** Every state carries a shape or a word too (done = tick + amber fill, prefilled = italic + muted, paused = the word PAUSED). The owner is colour-blind.
7. **Do not invent data.** Loads, targets and history come from the lifter's own logged sets. Skipped inputs mean conservative targets, never progression.

## Work in these six commits, in order

Run `node --test tests/*.test.js` and `node tests/browser-flow.mjs` after each. Do not start the next commit until the previous one is green.

1. **Tokens + nav.** Paste the two-scheme `:root` block from HANDOFF.md into `styles.css`. The bottom nav needs no change — the prototype already matches the tab bar in the current `styles.css`.
2. **Today.** One charge ring replaces the three arc gauges in `renderActivityRings()` (outer arc = sessions + volume, inner = completed sets, centre = the average as one number, tap opens `openRingGoals()`). Coach/ramp card becomes the "up next" card with exercise chips. Desk Reset + last session collapse into one grouped list.
3. **Workout cockpit.** The largest diff — do it alone. Lit current-exercise card, finished exercises collapsing to a done row, the last→target strip with its delta chip, 52px set values with units, the single NOW row, 52px done circles, the RIR row (0–4+ **and Skip**, and the card must not collapse until RIR is answered or skipped), the `why?` evidence sheet, the full-width rest pill with countdown ring, the exercise "•••" options sheet (swap / remove-with-confirm), long-press drag reorder, and the minimise chevron that returns to Today with the session alive.
4. **Train reorder + Library grouping.** Train's order becomes plan hero → routines → filtered session list → plan shelf; no grid of cards. Routine and plan rows open detail sheets, and plan days expand to reveal their exercises.
5. **Progress segments + calisthenics.** Split into Week / Trends / Records segments (same modules, one group visible at a time, DOM order within each unchanged). Add the calisthenics ledger in Trends: max-set reps with a previous-best tick, hold times, and the next-unlock line. This needs a new `Core.caliProgress(history)` — a read over existing data (`timed:true` sets for holds, vest load logged as weight, rep counts per set), no schema change.
6. **Settings restyle.** Same fields; segmented controls for rest timer and bar weight, switches for the toggles, sync block unchanged, build id in the footer.

Also, outside the CSS: rename `lg18` to `Tibialis Raise (DL)` in `exercises.js` (keep the id, so history and PRs carry over), and add the `'skip'` RIR sentinel to the progression rules — skip means the next target repeats verbatim, never progresses.

## Verify before you call it done

- Both test suites green.
- No horizontal scroll on any screen: `scrollWidth - clientWidth === 0` for the scroll container on every view. Watch for oversized decorative elements — a 460px glow inside a 390px scroller is what caused this bug in the prototype.
- Measure every `<button>` on every screen **and inside every sheet**; none under 44px.
- Contrast: check muted text against the surface it actually lands on, not the flat card colour. The stylesheet documents `#6B7178` at 3.25:1 and `#7E858C` at 4.29:1 as failures — stay at or above `#868D94`.
- Walk the full session flow in a real browser after busting the service-worker cache: start a session → log sets → answer RIR → skip rest → finish → confirm the receipt commits to history and the charge ring moves.
- Check light mode by toggling the OS scheme, not just the dark default.

## When you are unsure

Prefer the smallest change that satisfies the spec, and leave a `TODO(design):` comment with your question rather than inventing behaviour. If a step turns out to need a change to `core.js` or an id rename, stop and write down why instead of doing it.
