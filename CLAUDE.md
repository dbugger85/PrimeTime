# PrimeTime

A phone-first web page that rates finished football, tennis and F1 events for how exciting they were (0–10), without spoiling the result. It also gives skip tips ("Skip the first half", "Start from set 3", "Watch the start, then skip to lap 30") and shows which Norwegian streaming services carry each event.

- **Live:** https://dbugger85.github.io/PrimeTime/
- **Repo:** https://github.com/dbugger85/PrimeTime (public, branch `main`). The failed 2026 Next.js attempt is kept on branch `old-nextjs`.
- **Owner:** a beginner "vibe coder" in Norway. Explain things in plain language. `PLAN.md` holds the original plan and the owner's decisions.

## Commands

```sh
npm test              # unit tests: scoring, page logic, spoiler guard (no install needed)
npm run build         # fetch + score everything into docs/data/events.json (takes minutes the first time)
npm run build -- f1   # only one sport: football | tennis | f1
npm start             # serve docs/ at http://localhost:8000
npm install && npm run e2e   # browser test in headless Chromium (/usr/bin/chromium); screenshots in test/screenshots/
```

Run `npm test` and `npm run e2e` after changes, and look at the screenshots after UI changes.

## How it runs

The GitHub Actions workflow `.github/workflows/update.yml` runs every 3 hours, on every push to `main`, and by hand. It does the following:
1. Runs the unit tests, then `npm run build`, then the tests again. `test/spoilers.test.mjs` checks the new `events.json`.
2. Commits `docs/data/events.json`, `docs/data/reasons.json` and `data/state.json` as "primetime-bot".
3. Publishes `docs/` to GitHub Pages. The Pages source is "GitHub Actions".

There's no server and there are no API keys. **Don't commit `docs/data/*.json` or `data/state.json` from a local build,** because the bot owns them and a local commit can conflict with its push. Discard local changes with `git checkout docs/data data`.

## Data sources (all free, no keys, unofficial, so they could change)

| Sport | Source | Used for |
|---|---|---|
| Football | ESPN `site.api.espn.com/apis/site/v2/sports/soccer/{comp}/scoreboard?dates=YYYYMMDD` and `/summary?event=ID` | Fixtures; goals, cards, penalties, VAR (`keyEvents`); every shot with its minute (`commentary`); shot totals (`boxscore`). Date ranges don't work, so it's one day per request |
| Tennis | ESPN `sports/tennis/atp/scoreboard?dates=` | During a Grand Slam, any day returns the whole tournament (men's and women's). Set scores and tiebreaks only, with no seeds or rankings |
| F1 | OpenF1 `api.openf1.org/v1/` | sessions, meetings, session_result, overtakes, race_control, position, laps (the winner's), pit, weather. Returns 429 quickly, so requests are 700 ms apart |

The competitions are in `src/competitions.mjs`. The owner chose them: the Premier League, Champions League, Eliteserien, Nations League, EURO qualifiers, World Cup qualifiers (UEFA), EURO, World Cup, the tennis Grand Slams (singles, main draw) and F1. Football is kept for 30 days; tennis and F1 for about a year.

`scripts/build.mjs` avoids re-fetching:
- An event already in `events.json` with the current `v` (`SCORING_VERSION`) is skipped.
- `data/state.json` lists football days and Slams that are complete.
- **Bump `SCORING_VERSION` in `src/scoring/common.mjs` whenever a formula changes.** The next build then re-scores everything.

## Upcoming and live events ("Coming up" view)

`events.json` also has an `upcoming` list: football for the next 14 days, F1 races for the next 60 days, and not-yet-finished Grand Slam singles matches while a Slam is on (the free data has no draws before that). It's rebuilt from scratch every run, and `status` is `upcoming` or `live`. These entries have **no** score, segments, advice or reasons (see `upcoming*` in `publish.mjs` and `checkUpcoming` in the spoiler test). A match drops out of `upcoming` once it's finished and scored, so ongoing matches show as LIVE until the next run after the final whistle.

## Spoiler rules (most important)

- `src/publish.mjs` is the only way data reaches the site. It copies a fixed set of fields: id, sport, comp, compName, start, score, segments, advice, services, v, plus teams / players+draw+round / circuit.
- `test/spoilers.test.mjs` fails on any other field, on anything that looks like a score (`2-1`), or on words like winner, comeback, late, penalty or safety car.
- **Heat strip lengths are fixed:** football 6 blocks (extra time folds into the last one), F1 10 equal slices, tennis none (the number of sets would leak). This way a strip can't reveal extra time, a shortened race or how many sets were played.
- **Skip advice** is `{code: 'full' | 'highlights' | 'skip', unit: 'min' | 'lap' | 'set', ranges: [[from, to], …]}`, with up to 3 skip windows anywhere in the event. `quietRuns()` in `src/scoring/common.mjs` finds runs of quiet slots. Each window ends a slot before the action, so you get some build-up. Higher scores need longer quiet runs before a skip is suggested, and 9+ is always "Watch it all". The text comes from `adviceText()` in `docs/logic.js`, and on football cards the windows are also shaded on the strip (`skipShades`).
- **Where skips are never allowed:** football is never skipped after 75' (5-minute slots, with stoppage time kept inside its own half). F1 always keeps laps 1–3 and the last 15% of the race. Tennis only names sets 1 (best-of-3) or 1–2 (best-of-5), because those are always played and are never the final set. These limits mean a tip can't hint at how the event ended.
- **Names:** tennis players are sorted alphabetically, because ESPN lists the winner second. Tennis names are hidden on the page by default, since seeing who plays a later round reveals earlier results. Tap to reveal.
- The owner accepted that skip tips reveal a little ("quiet until 45'"). There's a toggle to turn them off.
- **"⚠ Why this score?"** is a deliberate spoiler button the owner asked for. Each scorer returns `reasons` as `[points, label]` pairs, built with `tally()` in `common.mjs`. The build writes them to the separate `docs/data/reasons.json`, **never** into `events.json`. The page only downloads that file after the user accepts the warning dialog (`#spoiler-dlg`), and it opens only the tapped card, for this visit only. The e2e test checks the file isn't requested before then. Reason labels may name results and winners; that's their job.

## Scoring (`src/scoring/*.mjs`, pure functions, checked in `test/scoring.test.mjs`)

- **Football:** goals, the share of minutes within one goal, equalisers and lead changes, late goals, shots on target, red cards, penalties, goals ruled out by VAR ("Deleted After Review" in the commentary), shots off the woodwork, lots of corners (12+) or bookings (6+), extra time and shootouts. Segments are 15-minute blocks weighted by goals, disallowed goals, penalties, reds, VAR, woodwork and shots. Skip windows come from 5-minute slots with little action (quiet ≤ 0.45, about one shot on target).
- **Tennis:** number of sets compared with the maximum, how close each set was (a tiebreak or 7-5 counts as close), tiebreaks, comebacks and the round. Retirements score 1, and walkovers and qualifying are left out.
- **F1:** clean overtakes (not on lap 1, no car pitting within a lap, not reversed within 2 laps), lead changes (the same pit filter), SC/VSC/red flags, the P1–P2 gap, DNFs, rain and late action. The raw OpenF1 overtake counts are mostly pit shuffles and noise, so keep the filters in `factsFromRace`.
- Tests check the ordering against known matches: France 6–4 England (WC 2026) is high, Bournemouth 0–1 Liverpool is low, Britain 2025 is high, and Japan 2025 is low.

## Streaming rights

`src/rights/norway.json` maps competitions to services, each with a `validTo` date and a source link. It's kept by hand, because no free feed exists. The build prints a GitHub warning when an entry expires within 60 days. The service names and links are repeated in `SERVICES` in `docs/app.js`, so keep both in sync.

## Files

| Path | Purpose |
|---|---|
| `scripts/build.mjs` | Fetch → score → publish, plus state and pruning |
| `src/sources/*.mjs` | One file per data source. Each turns raw API data into plain "facts" |
| `src/scoring/*.mjs` | Facts → `{score, segments, advice}` |
| `src/publish.mjs` | The spoiler guard, and adds the streaming services |
| `docs/index.html`, `style.css`, `app.js` | The page, in vanilla JS. Colours are CSS variables: light in `:root`, dark repeated in the media query and in `:root[data-theme="dark"]` |
| `docs/logic.js` | Pure page logic (filters, tiers, advice text), unit-tested |
| `test/fixtures/` | Trimmed real API responses used by the tests |

Settings, "watched" marks and chosen services live in the browser's localStorage (`pt-prefs`, `pt-watched`).

## Adding a sport

Add `src/sources/<sport>.mjs` and `src/scoring/<sport>.mjs`, a `publish<Sport>` in `publish.mjs` with its extra fields, `ALLOWED` in `test/spoilers.test.mjs`, a builder in `scripts/build.mjs`, `KEEP_DAYS`, `SPORTS` / `titleOf` / `subtitleOf` in `docs/logic.js`, a tab in `index.html`, and a rights entry.
