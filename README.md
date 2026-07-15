# Gym

A fast, private, mobile-first workout builder and gym log. Forked from [duck-gym](https://github.com/duckthetiler-max/duck-gym) by @duckthetiler-max and rebranded — customise the exercise catalogue in `exercises.js` for your own gym's equipment.

## Open it

### Quick local use
Open `index.html` in a modern browser. Workout logging and browser storage work directly from the file.

### Installable/offline PWA
Run a local server from this folder:

```bash
python -m http.server 4173
```

Then open `http://localhost:4173`. Use **Settings → Install Gym** (or the browser install option). Service-worker offline caching requires HTTP/HTTPS and does not activate on `file://`.

## Product features

- Three concentric weekly activity rings for workouts, completed sets and training volume
- Adjustable weekly goals with motivational start, momentum, near-complete and completed states
- Fast reusable routines and starter templates
- Resumable active workouts persisted after every change
- Sets, repetitions, weight, notes and previous-performance hints
- Automatic configurable rest timer
- Live duration, set count and training volume
- Weight/e1RM personal-record detection
- Eight-week consistency chart and workout history
- Searchable Revo Langwarrin-tailored exercise/equipment library
- Custom exercises
- Versioned local data model with migration from the original Duck Gym keys
- JSON backup export/import
- Installable PWA with offline app-shell caching
- Reduced-motion support, keyboard focus states and 44px+ touch targets

## Privacy

Data remains in browser storage on the current device unless manually exported. There is no account, analytics tracker or remote database.

## Tests

Keep the local HTTP server running, then execute both suites:

```bash
node --test tests/core.test.js
node tests/browser-flow.mjs
```

The domain suite covers volume, session creation, previous performance, PRs, summaries, weekly statistics, migration, goal normalization, ring messaging, completed-set states and backup validation.

The zero-dependency Chrome flow uses a temporary profile and verifies:

- clean start → quick workout → exercise/set logging
- local persistence and reload/resume
- workout completion, history, PRs and volume
- 320px, 390px and 500px layouts without horizontal overflow
- reduced-motion detection
- service-worker control and an offline reload with saved data intact

Responsive screenshots are written to `artifacts/design-qa/`. The test never touches the browser profile or workout data used by the live app.

## Source structure

- `index.html` — semantic application shell
- `styles.css` — responsive design system
- `app.js` — screens, interactions and persistence
- `core.js` — tested workout-domain logic
- `exercises.js` — Revo Langwarrin-tailored catalogue
- `manifest.webmanifest`, `sw.js`, `icon.svg` — installability/offline support
- `tests/core.test.js` — Node domain test suite
- `tests/browser-flow.mjs` — zero-dependency Chrome workflow, responsive and offline test
- `artifacts/design-qa/` — generated responsive QA screenshots
