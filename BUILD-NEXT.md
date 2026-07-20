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
