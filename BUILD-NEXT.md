# Gym — BUILD-NEXT master prompt
**Council-ratified plan (Fable × Codex 5.6, 2026-07-20).** Decision note: `MarkOS/brain/decisions/2026-07-20-council-gym-billion-dollar-roadmap.md`. This file is the single source of truth for the next build phase. Paste the relevant wave to the engine doing the work.

## 0. Non-negotiables (violating any = the build is wrong)
1. **The daily loop is king.** Logging a set must never gain a tap or lose speed. Every feature is judged against "does log-fast survive?"
2. **Safety rules are controllers, not charts.** Pain signals must alter what the app prescribes.
3. **No manufactured confidence.** Skipped inputs (RIR, check-ins) mean conservative targets, never progression.
4. **Preserve contracts:** `core.js` pure + tested, all element ids/onclicks/test selectors, reduced-motion kill-switch, 44px targets, CVD-safe (no blue/purple-only signals), both color schemes token-paired.
5. **Liquid glass = chrome only** (nav/header/sheets/pills). Content cards stay solid sculpted surfaces. Motion only at semantic moments: progression reveal, set complete, PR, warning, receipt.
6. Every wave ends: all node suites + `tests/browser-flow.mjs` green, both-scheme contrast pass, Codex adversarial verify, commit+push.

## Wave 0 — Deploy + release truth (BLOCKING — nothing else ships first)
- Deploy to the **sandbox VPS** (45.32.242.242) behind HTTPS (subdomain + certbot, e.g. `gym.thesolvagroup.com`), systemd static serve or nginx root. **NEVER a dealer box.**
- **Release truth system:**
  - Build id (short git SHA + date) baked into `sw.js` CACHE and shown in Settings footer.
  - SW update detection: on `updatefound`/waiting worker, show an "Update ready — tap to refresh" pill; tapping calls `skipWaiting` + reload. No more stale builds.
  - `/health` (or `version.json`) endpoint the app pings to surface "you are N builds behind".
  - Rollback: previous release dir kept on the box; one-command swap.
- Gate: phone installs the PWA from the HTTPS URL, shows the build id, and picks up a trivial test push via the update pill. Also fix (or confirm fixed by the current build) the blank coach-slot bug Mark reported.

## Wave 1 — The progression loop (the product)
- **"Last time → target today"** strip on every workout exercise: last session's top confirmed set → today's target (weight × reps), computed conservatively (double-progression: fill reps to top of range at same load, then +1 step of load; step from the existing per-profile weight step).
- **Final-set RIR:** ONE optional tap on the last set of each exercise (chips 0–4+ / skip). Skipped RIR ⇒ next target = repeat/conservative. RIR 3–4+ ⇒ eligible for load bump; RIR 0–1 ⇒ hold or step down.
- **Inline "why this target":** a tap on the target opens a small sheet: the evidence (last sets, RIR, pain state, rule applied). One sentence, honest.
- **Pain escalation rules (controllers):**
  - Pre-session pain ≥7 ⇒ **block** the prescription for pain-adjacent exercises: offer pain-free alternative + "if severe or persistent, get it assessed" copy.
  - Pre-session pain rising 3 sessions running ⇒ forced step-down; receipt states why.
  - Existing flare step-down logic remains; all of it surfaces on the receipt, never silently.
- **Receipt upgrade:** ends with "Next session:" prescription block (per exercise: target or hold reason). This is the engagement anchor — make it the app's most beautiful moment (existing cinematic pass extends: staggered lines, count-ups, PR flare; motion at THIS moment, not everywhere).
- Core: all progression/RIR/pain rules are pure functions in `core.js` with a dedicated node test suite (happy path + every guard).

## Wave 2 — Evidence surfaces (consumers of the proven loop)
- **Exercise detail sheet** (tap a lift anywhere): e1RM trend (existing chart), weekly volume, best-set rep records (heaviest at 1..10 reps), recent sessions, active cue. Lean — one screen, no tabs.
- **L/R imbalance board**: from existing per-set side tags (`cycleSide`); per-exercise L vs R volume/top-set comparison; flag >10% persistent gaps; feeds the biomechanics work. Empty-state explains how to tag sides.
- **Weekly recap** card (Progress top, Sunday+): sets/volume/PRs vs last week, muscle-balance summary, pain trajectory, imbalance flags. Gated: needs ≥3 sessions or 7 days of data — otherwise an honest "accumulating" state showing progress toward unlock.
- Motion: View Transitions API (feature-detected, reduced-motion-gated) for sheet/detail morphs only.

## Wave 3 — Depth
- Bodyweight log + trend (Settings-adjacent quick add; chart on Progress).
- Pain/check-in trend chart (data exists since the check-in loop).
- Recap intelligence: "chest volume down 40% two weeks running", "left leg gap closing".
- Richer detail analytics (rep-range distribution per muscle: strength vs hypertrophy zones).

## Verify ritual (every wave)
```
node --test tests/*.test.js
python -m http.server 4173   # then:
node tests/browser-flow.mjs
```
Live-verify new interactions in a real browser **after busting SW caches** (`caches.delete` + unregister — stale-SW false-verify bit twice on 2026-07-20). Codex adversarial diff review before every push.

---

## 2026-08-05 — Whole-app review, Claude + Codex 5.6 (Mark's ask: more intuitive, easier, prettier, more functional)

Measured at 390x844 on the LIVE build w62, not estimated.
Scroll heights: Today 1310px · Train 1171px · **Library 18,805px** · Progress 649-961px. Viewport 844px.
Catalogue 255 exercises; a real lifter in this fixture had ever performed **3** of them.

### CONFIRMED LIVE BUG (measured, not inferred)
**The rest pill covers the reps-in-reserve chips by 50px.** Rest pill occupies y=762-830; the
`.rir-chips` block occupies y=780-874. Finishing your last set starts the timer AND asks "how many
reps left in the tank" at the same moment, and the timer sits on top of the answer. RIR is the input
the entire double-progression engine runs on, so the app is occluding the one control that feeds it.
Fix candidates: lift the RIR block above the pill's reserved space, or defer the pill until RIR is
answered. Not fixed yet - reported to Mark 2026-08-05.

### Agreed by both engines, ranked
1. **Library defaults to YOUR exercises.** 18,805px of alphabetical catalogue where 3 entries matter.
   Lead with recent + favourites + everything in your routines; put all 255 behind "Browse all".
   Also: names and equipment truncate mid-word ("Assisted Pistol Sq...", "band o..."). (S/M)
2. **The Today ring is 348px for one abstract number.** "30% WEEK CHARGED" blends sessions, sets and
   volume into a figure nobody can act on, and eats 27% of the page. Replace with a compact status
   line ("1 of 3 sessions - 8 of 30 sets") plus the one action: Start <next routine>. (M)
3. **Exercise memory inside the cockpit.** Last 3 exposures, best comparable set, previous notes and
   a "note for next time" field, per exercise, while training. Changes decisions at the moment they
   are made rather than adding another chart. (M)
4. **Warm-up sets + plates per side, inline.** Both are arithmetic the lifter currently does in their
   head every session. The plate calculator exists but is not on the set row. (M)
5. **A real rest-day state.** When nothing is due, say so and offer recovery, rather than filling the
   screen with manufactured urgency. (S/M)
6. **One dominant action per screen.** Today currently competes: ring, deload advisory, coach card,
   Desk Reset, goal strip. (M)

### DISPUTED - Codex is wrong here, and it is worth recording why
Codex proposed: *"Remove the preview-on-card/start-on-play distinction: tapping the main card should
start; use an explicit Preview link."* **Rejected.** That is a direct reversal of what Mark reported
on 2026-08-05 in his own words: he kept starting workouts while trying to see what was in them and
then had to hunt through the app to delete them. Codex was reviewing the structure without that
history. Preview-on-tap stays; the gate is mutation-proven in browser-flow.

### Not adopted
Codex's closing note on pairing colour with labels/shape is already satisfied: every state in this
app carries a word or a glyph, and `contrast-guard.mjs` verifies 989 elements across both schemes on
every run. Worth re-checking any NEW state, not a standing gap.
