# BurnLog: first-draft notes (cache tag `?v=fit1`)

Workout tracker built for phones first (tested at 390 px on an Android Chrome profile), with a two-column layout on desktop.
Vanilla HTML/CSS/JS with no build step. Chart.js 4.4.4 UMD is vendored at `vendor/chart.umd.min.js` (MIT, no CDN).

## Layout
```
index.html               app shell (all assets carry ?v=fit1)
css/app.css              dark, sporty UI
js/db.js                 GENERATED exercise database (do not hand-edit)
js/calc.js               exercise index + calorie math + speed→MET lookup
js/parser.js             rule-based free-text parser
js/store.js              storage layer (adapter pattern, localStorage today)
js/charts.js             aggregation + Chart.js rendering, totals, streaks
js/sample.js             demo-data generator (Settings → Load sample data)
js/app.js                UI controller, AI-parser hook
manifest.webmanifest, icons/   installable on Android ("Add to Home screen")
data/                    source PDF, pdftotext output, parsed JSON (source copy only)
tools/                   parse_compendium.py, build_db.py, parser_test.js (node), verify.py (headless Chromium)
screenshots/             verification screenshots
```
To rebuild the DB: `python3 tools/parse_compendium.py && python3 tools/build_db.py`.

## Data source
- **2024 Adult Compendium of Physical Activities** (Herrmann SD, Willis EA, Ainsworth BE, et al. *J Sport Health Sci* 2024;13:6–12).
  I downloaded the official PDF from pacompendium.com (`1_2024-adult-compendium_1_2024.pdf`, linked from /adult-compendium/), converted it with `pdftotext -layout`,
  and parsed it with `tools/parse_compendium.py`. Lines that wrap in the PDF are re-joined.
- The parse produced **1,111 activities in 22 Major Headings** (Sports 156, Occupation 149, Walking 93, Water 87, Conditioning 86, Home 78, Running 66,
  Lawn & Garden 54, Winter 52, Bicycling 44, and others). Each one keeps its official 5-digit code, MET value and description.
- **95 BurnLog presets** sit on top. Each preset is a friendly name, such as "Push-ups", "Running" or "Pickleball", plus synonyms, and points at one Compendium code. Its MET comes from that code.
  Presets also say how the activity is logged: by distance, by reps, or by duration.
  The picker therefore lists **1,206 entries**: 1,111 Compendium activities plus 95 presets.
- The Compendium has no pickleball code. The preset uses 15500 "Paddleball, casual".

## Calorie formula
- **Default (gross):** `kcal = MET × body mass (kg) × duration (h)`. This is the standard Compendium estimate and includes resting burn.
- **Optional (net):** `kcal = (MET − 1) × kg × h`. It leaves out what you would burn at rest anyway. Switch it in Settings → Calorie formula.
- Each entry stores the weight and formula used when it was logged. Changing your profile weight later does not rewrite history.
- The 2024 Compendium also describes "corrected METs" that use a personal resting metabolic rate (from height, age and sex). This is **not implemented**.
  Height, age and sex are collected and stored so it can be added later.

### Speed-matched METs (run / walk / ride / swim)
If you give both distance and time, BurnLog works out your speed and picks the Compendium row for that speed band:
- Running: 12028 (4 mph) … 12050 (6–6.3 mph, 9.3) … 12135 (14 mph, 23.0). Below 4 mph it uses the walking table.
- Walking: 17151 … 17231. Cycling: 01018 … 01060. Swimming crawl by yd/min: 18292, 18290, 18280, 18294.
- Distance with no time: BurnLog assumes a default speed and says so in the UI. Defaults are run 6 mph, walk 3 mph, bike 12 mph, hike 2.5 mph, swim 40 yd/min.
- Time with no distance: BurnLog uses the general code (running 12150 = 8.0, walking 17190, cycling 01014, hiking 17080).

### Rep-based moves (labelled as an estimate in the UI)
Reps are turned into active time: `time = reps × sets × seconds-per-rep`. That time then goes through the same MET formula.
Seconds per rep is editable in the Log form. Defaults and the MET code each move uses:
push-ups 2 s (02022, 3.8) · sit-ups 2.5 s (02022) · crunches 2 s (02024, 2.8) · burpees 4 s (02020, 7.5) · squats 3 s (02056, 3.0) ·
pull-ups / chin-ups 3 s (02020) · jumping jacks 1 s (02020) · lunges 3 s (02022) · mountain climbers 1 s (02020) · KB swings 2 s (02058, 9.8) ·
bench press / curls / rows / shoulder press 3 s (02054, 3.5) · deadlift / barbell squat 4 s (02052, 5.0).
This counts working time only, not rest between sets. To log a whole gym session, use the duration-based "Weight training" instead.

### Sample calculation (180 lb, running 6 mph for 30 min)
180 lb = 81.65 kg. 6.0 mph falls in Compendium **12050, "Running, 6-6.3 mph (10 min/mile)", MET 9.3**.
Gross: 9.3 × 81.65 × 0.5 h = **379.7 kcal** (shown as 380). Net: 8.3 × 81.65 × 0.5 = 338.8 kcal.

## Quick-add parser (`js/parser.js`)
Rule-based. The steps are:
1. **Normalize the text.** Word numbers ("twenty five"), "a/an hour", "half an hour", "hour and a half", fractions, "1h30" and "2h15",
   "28 min 30 sec", clock times (h:mm:ss and mm:ss), "1,000", "half marathon" / "marathon", "10,000 steps" / "8k steps" (about 2,000 steps per mile).
2. **Split into clauses** on `, ; and then plus & +`.
3. **Find activities.** About 600 synonyms are matched longest first, on word boundaries ("ran", "biked", "push ups", "ping pong", "mowed the lawn" and so on).
   If no synonym matches, a fuzzy search over all 1,206 entries runs. It is accepted only when every content word matches (for example "curling" → 15170). Otherwise the clause goes to **Couldn't match**.
4. **Pull out quantities:** sets×reps ("3x10", "3 sets of 12"), reps, durations, distances (mi/km/k/m/yd/laps), and loads ("185 lb", noted but not used in the math).
5. **Attach quantities to activities.** A count right before an activity belongs to it ("20 squats"). A unit quantity after an activity belongs to that activity ("ran 3 miles").
   An activity with no amount copies the previous one's amount ("10 push-ups and sit-ups"). "yesterday" dates the entry to the day before.
6. **Show the result** as confirm chips (name, details, kcal, assumptions) with Add / Edit / ✕ buttons and "Add all".
   Unmatched text gets a red chip with suggestions and "Browse all…".

**AI hook:** `BurnLog.registerParser(async (text, ctx) => ({ items: [...] }) | null, 'label')`. Registered parsers run before the rule-based one.
Returning null falls back to the rules. Items use the same shape as `BLParser.parse()`. Settings shows which parser is in use.

## Storage (`js/store.js`)
- Keys: `burnlog.v1.meta | profile | settings | entries`. Every read and write goes through an async adapter (`read / write / remove / keys`).
  To move to a shared backend, implement a `RemoteAdapter` and call `BLStore.setAdapter()`.
- Records include `id` (UUID), `createdAt`, `updatedAt` and `deviceId`. Deletes are **soft-delete tombstones** (`deletedAt`), and Undo clears them.
- Import merges records by id; when both copies exist, the newer `updatedAt` wins. That is the same rule a sync server would use.
- Export: `burnlog-export-YYYY-MM-DD.json` containing `{app, schema, profile, settings, entries}`.

## What's stubbed / not done yet
- No backend, accounts or sync. Data lives in localStorage on one device. Tombstones are never compacted.
- AI parser: the hook exists, but no model is connected.
- No service worker or offline cache yet. The manifest and icons exist, so it can be added to the home screen, but it needs a network connection to the host.
- Corrected (RMR-personalized) METs are not implemented. Height, age and sex are stored but not used.
- Bar weight in lifting moves is noted but does not change calories.
- Import only merges; there is no "replace" option in the UI (the store supports `importAll(data, 'replace')`).
- The history list shows the latest 60 days that match the filters (narrow the filters to see more). There is no pagination.
- Week buckets start on Monday and there is no setting for it yet.
