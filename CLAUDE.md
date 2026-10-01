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

The GitHub Actions workflow `.github/workflows/update.yml` is triggered every 5 minutes (by cron-job.org, see "Outside trigger"), on every push to `main`, and by hand. It runs `scripts/auto.mjs`, which picks one of two scripts:
- **Full build** (`scripts/build.mjs`, `npm run build`): runs when `state.lastFull` is about 3 hours old, and on every push or manual run (`FULL=1`). It fetches everything and rebuilds the upcoming list.
- **Live check** (`scripts/live.mjs`, `npm run live`): runs otherwise. It only looks at upcoming events in their "in play" window, meaning from 10 minutes before the start until 4 h after (football) or 6 h after (F1 and tennis). It marks them live, scores them once finished, and moves them to replays. From 90 minutes before kick-off (`LINEUP_MINUTES`) it also asks ESPN for football line-ups, once per match and run, until both teams have them (see "Line-ups" below). With nothing on, it makes zero requests and changes nothing. To test it, `NOW=2026-09-25T21:00Z npm run live` pretends it's another time.
- Both scripts read and write the data files through `src/store.mjs`. Because it's all one workflow in one concurrency group, two runs never write at once. Publishing (the `deploy` job) only happens when the data or the code changed.
- The page re-fetches `events.json` every 5 minutes while it's open, and when you return to the tab.
- **Cache-busting:** before publishing, `scripts/stamp.mjs` adds `?v=<commit>` to `style.css`, `app.js` and the `logic.js` import in the published copy. GitHub Pages lets browsers cache files for 10 minutes, and a new `app.js` paired with a cached old `logic.js` once left the page stuck on "Loading…". If you add another JS module, add it to `stamp()`. A safety net in `index.html` replaces "Loading…" with a reload link if `window.primetimeStarted` isn't set within 8 seconds; `load()` sets it only after `bind()` and `renderControls()` have run, so a crash there still shows the link.
- **On the page:** the 5-minute refresh re-renders through `keepScroll()`, so the card you're looking at stays put when one above it comes or goes. Starring a favorite saves with `savePrefs({ keepPlace: true })`, so "Show more" isn't reset. `reasons.json`/`results.json` are fetched again if they don't know a tapped event yet (it was scored while the page was open). "Tomorrow" is worked out from today's noon, which is right across the clock changes. Sorting uses `Date.parse`, since the sources write times in different formats. Light-mode `--accent` is `#c2410c` (AA contrast for white on orange), `color-scheme` follows the theme, and stars and service pills are at least 32 px tall.

The job checks out the newest `main` (`ref: main`), not the commit that started the run. A push-started run once began from a commit made before the previous run's data save, and its own save clashed with it.

Each run does the following:
1. Runs the code unit tests, then `scripts/auto.mjs`, then all the tests. `test/spoilers.test.mjs` checks the new `events.json`.
2. Commits `docs/data/events.json`, `docs/data/reasons.json`, `docs/data/results.json` and `data/state.json` as "primetime-bot".
3. If anything changed, publishes `docs/` to GitHub Pages. The Pages source is "GitHub Actions".

Every request has a 30-second time limit and is retried on failure (`src/http.mjs`), because a server that hangs instead of failing would otherwise use up the whole 30-minute run. `warn` and `saver` (saving a scored event) are shared from `src/store.mjs`.

There's no server and there are no API keys. **Don't commit `docs/data/*.json`, `docs/cal/` or `data/state.json` from a local build,** because the bot owns them and a local commit can conflict with its push. Discard local changes with `git checkout docs/data data docs/cal` (and `git clean -fd docs/cal` for new files).

## Outside trigger (cron-job.org)

GitHub's built-in `schedule` never fired for this repo, even after disabling and re-enabling the workflow. So a free cron-job.org job starts the workflow **every 5 minutes** (since 1 October 2026; it was every 15 before):
- **Request:** `POST https://api.github.com/repos/dbugger85/PrimeTime/actions/workflows/update.yml/dispatches`
- **Body:** `{"ref":"main","inputs":{"mode":"auto"}}`
- **Headers:** `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
- **Token:** a fine-grained GitHub token limited to this repo, with only **Actions: Read and write**. It expires after at most a year, so renew it in GitHub settings and paste the new one into cron-job.org.
- A successful call returns HTTP 204.

- While a long full build runs (up to about 20 minutes), the 5-minute triggers queue up. GitHub keeps only the newest waiting run in the `update` concurrency group and marks the older ones **cancelled**. That's expected and harmless: nothing was skipped that the next run doesn't do.

The `schedule:` block stays as a backup. A manual "Run workflow" defaults to mode `full`.

## Data sources (all free, no keys, unofficial, so they could change)

| Sport | Source | Used for |
|---|---|---|
| Football | ESPN `site.api.espn.com/apis/site/v2/sports/soccer/{comp}/scoreboard?dates=YYYYMMDD` and `/summary?event=ID` | Fixtures; starting line-ups and formations (`rosters`, empty until about 75 minutes before kick-off); goals, cards, penalties, VAR (`keyEvents`); every shot with its minute (`commentary`); shot totals (`boxscore`); pre-match betting odds (`pickcenter`, DraftKings moneylines) for team strength. Date ranges don't work, so it's one day per request. **ESPN's "day" is the US Eastern day**, so a kick-off before about 05:00 UTC is listed under the day before: the live check also looks there for kick-offs before 06:00 UTC. `fetchDay` remembers each day for the rest of the run |
| Tennis | ESPN `sports/tennis/atp/scoreboard?dates=` | During a Grand Slam, any day returns the whole tournament (men's and women's). `SLAM_PROBES` tries the middle of each Slam first, then earlier days down to its usual first day, so it shows from day one. A Slam already in `state.slamsDone` (`<espn id>-<year>`) isn't downloaded at all (each is about 2 MB). Set scores and tiebreaks only, with no seeds or rankings |
| F1 | OpenF1 `api.openf1.org/v1/` | sessions, meetings, session_result, overtakes, race_control, position, laps (the winner's, or everyone's for qualifying), pit, weather. Returns 429 quickly, so requests are 700 ms apart |
| Biathlon | IBU `biathlonresults.com/modules/sportapi/api/` (unofficial JSON) | `Events?SeasonId=2526&Level=1` (World Cup, World Championships, Olympics), `Competitions?EventId=`, `Results?RaceId=` (misses per shooting), `AnalyticResults?RaceId=&TypeId=CRS1…/RNG1…` (lap and range times) |
| Alpine, cross-country | `fis-ski.com/DB/general/` **web pages** (HTML, no API): `calendar-results.html`, `event-details.html`, `results.html` | Finish times, alpine run times. No split times. Read at 1 page per second. |

**OpenF1 closes to free users while any F1 session is live** (practice, qualifying or the race), even for old races, and answers 401 "Live F1 session in progress". `getJson` marks that error `f1Live`. The build and the live check then log a calm note instead of a warning and try again next run. If a sport fails before listing anything, the build keeps that sport's previous "Coming up" entries. An F1 session that's over but has no result yet (or wasn't scored because time ran out) stays in "Coming up" as LIVE for up to a day, instead of vanishing. The owner doesn't need live updates during F1 races, so `liveF1` doesn't call OpenF1 for the first `F1_RACE_HOURS` (3) after the start; it just sets the LIVE badge by the clock.

The competitions are in `src/competitions.mjs`. The owner chose them: the Premier League, Champions League, Eliteserien, Nations League, EURO qualifiers, World Cup qualifiers (UEFA), EURO, World Cup, the tennis Grand Slams (singles, main draw) and F1. Football is kept for 30 days; tennis and F1 for about a year.

`scripts/build.mjs` avoids re-fetching:
- An event already in `events.json` with the current `v` (`SCORING_VERSION`) is skipped.
- `data/state.json` lists football days and Slams that are complete.
- **Each sport has its own version** (`SCORING_VERSIONS` in `src/scoring/common.mjs`, e.g. `"10.3fa2c1d0"`): a formula number from `FORMULA_VERSIONS` plus a fingerprint of that sport's weights. **Bump the sport's number whenever its formula changes.** A weight change re-scores that sport by itself. The versions are per sport because re-fetching a year of F1 is slow. `state.versions` remembers what the saved days and Slams were built with.
- **Time budget:** after 18 minutes (`BUDGET_MIN`; try `BUDGET_MIN=2 npm run build -- f1`) the build stops fetching, saves what's done, and continues at the next full build, because GitHub kills a run after 30 minutes and nothing gets saved. F1 is processed newest first.

## Upcoming and live events ("Coming up" view)

`events.json` also has an `upcoming` list: football for the next 14 days, F1 races for the next 60 days, and not-yet-finished Grand Slam singles matches while a Slam is on (the free data has no draws before that). It's rebuilt from scratch every run, and `status` is `upcoming` or `live`. These entries have **no** score, segments, advice or reasons (see `upcoming*` in `publish.mjs` and `checkUpcoming` in the spoiler test). A match drops out of `upcoming` once it's finished and scored, so ongoing matches show as LIVE until the next run after the final whistle.

## Line-ups (football)

Clubs announce their starting 11 about 75 minutes before kick-off, and ESPN's `summary` has them in `rosters` (`starter: true`) within minutes. X/Twitter was considered and rejected: its API costs money, scraping breaks its rules, and every club posts in a different format.
- `lineupsFromSummary()` in `espn-football.mjs` returns `[home, away]`, each `{ formation: '4-2-3-1', players: [[shirt, name, position], …] }`, or null until **both** teams have 11 starters. Players are sorted goalkeeper, defence, midfield, attacking midfield, attack, and left to right within each line (`lineOf`/`sideOf`), so the page can use the formation to space the lines. Each team also has a `bench: [[shirt, name], …]`, **sorted by shirt number**: after the match ESPN marks who came on (`subbedIn`), and its order might hint at that. Substitutions made during the match (who came on and when) never go into `events.json`, because they can give away an injury, a red card or a team chasing the game. They're in the result spoiler instead (see "⚠⚠ Show the result").
- `lineupFields()` in `publish.mjs` copies only the formation, the starters' shirt numbers, names and positions, and the bench's numbers and names (anything odd becomes `''`). No substitutions, cards or goals. `checkLineups` in the spoiler test checks the shape, and the text scans skip `lineups` (a formation looks like a score).
- **Where they're found:** the live check (from 90 minutes before), the full build for matches starting within 90 minutes (it keeps the ones the live check already found, because it rebuilds `upcoming` from scratch), and the summary that's fetched anyway when a match is scored. So replays have them too (the owner wanted that). Football version 11 re-fetched the older replays to fill them in.
- **On the page:** a "▸ Line-ups" button on upcoming, live and replay football cards, hidden until there are line-ups, closed by default, and remembered for this visit only (`lineupsOpen`, `fillLineups()` in `app.js`). Inside, each team's bench has its own "▸ Bench (12)" button (`benchOpen`, keyed `<id>:<team index>`), to keep the card short.
- The owner's cron-job.org job runs every 5 minutes, so line-ups appear up to about 5 minutes after ESPN has them (plus a minute or two to publish).

## Pre-match hints (football): forecast and what's at stake

One quiet grey line on upcoming football cards, only when there's something to say: "Title race · looks even on paper", "Could be lively", "Looks one-sided". The owner chose the wording (no question mark). The "Show pre-match hints" switch (`prefs.preHints`, under More filters) hides it, along with the stakes tag on replays. Text comes from `prematchLine()` in `docs/logic.js`.
- **Forecast** (`forecastOf()` in `src/prematch.mjs`): from the scoreboard odds that `fetchDay()` already gets (`scoreboardOdds()`: moneylines like "+170" plus the over/under goal line, so it needs no extra requests). If the gap in win chances is ≥ 50 points it's `one-sided`; else if the gap is < 40 and ≥ 3.2 goals are expected it's `lively`; else if the gap is < 15 it's `even`; otherwise nothing. **Upcoming only:** on a replay, "looked one-sided" would hint at an upset, so `checkEvent` rejects `forecast`. The owner agreed to publish these three codes, but raw odds are still never published.
- **Stakes** (`stakesFor()` in `src/prematch.mjs`, tables from `src/sources/espn-standings.mjs`, 1 request per competition per full build). Each competition has rules in `rulesFor()`: "finishing k-th or better counts", in priority order. Premier League: title 1, relegation 17 (last safe place), top-4, Europe 6. Eliteserien: title 1, relegation 13 (14th is the play-off), Europe 4. CL: top-8, play-offs 24. Nations League: top of the group, plus relegation in Leagues A–C. Qualifiers: top of the group, qualifying 2. **Leagues** (PL, Eliteserien and the CL table): a team is "in the race" if it's within 6 points (title, relegation) or 3 points (the rest) of the line, never more than it can still win, and, except for the title, within two places of the line. A title race or relegation battle needs one team in it; the other races need both, so mid-table matches stay unlabelled. Leagues need a third of the season played (the CL half). **Groups** (Nations League, qualifiers): almost every match in a group of 4 matters, so a label only appears in the last two rounds, for a head-to-head across the line within 3 points. Tournaments get none. A Fable review found the first version labelled almost every match. `test/scoring.test.mjs` now checks that at most 70% of possible Eliteserien pairings get a label (today about 60%, since the bottom of the table is tight). ESPN's standings have no season parameter, and the build logs which season it got: for the qualifiers that can be the last, finished campaign, which simply gives no labels.
- **Frozen at kick-off:** both are worked out only while the scoreboard says `pre`. After that, `upcomingEntry()` in `build.mjs` and the live check copy the old values, because the live odds and table follow the score. The stakes are copied onto the replay (`publishFootball(…, { stakes })`), where they're shown after the competition name. One small leak the owner accepted: a team's *next* match label reflects the table after its last match.
- **Score bonus** (the owner's choice): `titleRace` 0.5, `relegationBattle` 0.4 and `otherRace` 0.2 in `weights.mjs`, shown in "Why this score?" as "Title race before kick-off". It only applies to matches seen in "Coming up" before they started. The build takes `stakes` from the old event, the previous upcoming list, or `state.stakes` (`{ id: { code, start } }`, kept for 32 days), so a match that couldn't be scored straight away still gets its label.

## Calendar feeds

`src/calendar.mjs` writes `docs/cal/<team>.ics` (for example `bodo-glimt.ics`, via `teamSlug()` in `docs/logic.js`) for every football team seen in the last 120 days (`state.calTeams`), with its matches from the last 30 days and the next 14. Each match has its kick-off, a 2-hour length, the services as the location, and the competition plus stakes in the description. **No score, rating or forecast**, checked by `checkIcs` in the spoiler test. `DTSTAMP` is the kick-off time, so the files only change when a match changes. `saveData()` writes them on every save, and the workflow commits them with `mkdir -p docs/cal && git add -A docs/cal`, which also removes teams that have dropped out (without the `mkdir`, the step fails when the folder doesn't exist yet). Subscribe is hidden on Android, which has no `webcal://` handler.
- On the page, "▸ Add to calendar" under the favorite chips (closed by default) lists each favorite team with **Subscribe** (`webcal://…`, works on iPhone) and **Copy link** (for Google Calendar on the web: Other calendars → From URL; Google refreshes about once a day).

## Spoiler rules (most important)

- `src/publish.mjs` is the only way data reaches the site. It copies a fixed set of fields: id, sport, comp, compName, start, score, segments, advice, services, v, plus teams (+ lineups, stakes, and forecast on upcoming only) / players+draw+round / circuit.
- `test/spoilers.test.mjs` fails on any other field, on anything that looks like a score (`2-1`), or on words like winner, comeback, late, penalty or safety car.
- **Heat strip lengths are fixed:** football 6 blocks (extra time folds into the last one), F1 10 equal slices, tennis none (the number of sets would leak). This way a strip can't reveal extra time, a shortened race or how many sets were played.
- **Skip advice** is `{code: 'full' | 'highlights' | 'skip', unit: 'min' | 'lap' | 'set', ranges: [[from, to], …]}`, with up to 3 skip windows anywhere in the event. `quietRuns()` in `src/scoring/common.mjs` finds runs of quiet slots. Each window ends a slot before the action, so you get some build-up. Higher scores need longer quiet runs before a skip is suggested, and 9+ is always "Watch it all". The text comes from `adviceText()` in `docs/logic.js`, and on football cards the windows are also shaded on the strip (`skipShades`).
- **Where skips are never allowed:** football is never skipped after 75' (5-minute slots, with stoppage time kept inside its own half). F1 always keeps laps 1–3 and the last 15% of the race, and gives no skip windows at all after a red flag: a race cut short would otherwise show its real length through "the last 15%". Tennis only names sets 1 (best-of-3) or 1–2 (best-of-5), because those are always played and are never the final set. These limits mean a tip can't hint at how the event ended.
- **Names:** tennis players are sorted alphabetically, because ESPN lists the winner second. Tennis names are hidden on the page by default, since seeing who plays a later round reveals earlier results. Tap to reveal.
- The owner accepted that skip tips reveal a little ("quiet until 45'"). There's a toggle to turn them off.
- **"⚠ Why this score?"** is a deliberate spoiler button the owner asked for. Each scorer returns `reasons` as `[points, label]` pairs, built with `tally()` in `common.mjs`. The build writes them to the separate `docs/data/reasons.json`, **never** into `events.json`. The page only downloads that file after the user accepts the warning dialog (`#spoiler-dlg`), and it opens only the tapped card, for this visit only. The e2e test checks the file isn't requested before then. Reason labels may name results and winners; that's their job.
- **"⚠⚠ Show the result"** is a second level inside the breakdown. It shows a second warning, then loads `docs/data/results.json`, which has one line per event: "France 4–6 England (after extra time)", "Zverev beat Shelton 6-3 7-6(2) …" or an F1 podium with the winning margin. Scorers return it as `result`, and `store.mjs` writes it. Football results are an object instead, `{text, goals, subs}`. `subs` has one line per substitution, like `"58' · Martin Miller on for Mattias Käit (Estonia)"` (`HT`/`ET` for changes at the break, `, injury` when ESPN says so), from the `Substitution` entries in `keyEvents`, and the page lists them under the goals, behind a "▸ Substitutions (9)" button (`subsOpen`). `goals` has one line per goal, like `"36' · 0–1 · Jude Bellingham (England)"`, with the running score and "pen" or "own goal" (penalty shootout kicks are left out). It comes from `participants[0]` in ESPN's `keyEvents`. The page shows the pieces between the ` · ` separators as three columns, and still accepts plain strings. Like the reasons, it never goes into `events.json`.

## Scoring (`src/scoring/*.mjs`, pure functions, checked in `test/scoring.test.mjs`)

**All the points live in `src/scoring/weights.mjs`** (`FOOTBALL`, `TENNIS`, `F1`), with a plain-language comment on each. The owner can edit that file on github.com, and a push re-scores everything. Keep the scorers free of hard-coded points, and that includes the "at most this much" limits (the `…Max` entries), although thresholds like "75'" or "12 corners" stay in the code. `tally().add` leaves out (with a warning) any line whose points aren't a number, and `finalScore` refuses a score that isn't one, so a missing fact can't publish a blank score; `checkEvent` also checks every score is 0–10. Weights that are subtracted are stored as positive numbers. The tests reject any weight outside 0–5, and the known-match ordering tests stop a change that makes thrillers score below dull matches. `FOOTBALL.teamStrength` is a master dial for everything that comes from the odds (0 turns it off).

- **Football team strength:** `winChances()` in `espn-football.mjs` turns the pre-match odds into home/draw/away chances (`facts.odds`, or null). The raw odds are only used for scoring and never published (upcoming matches get just a 3-level forecast code; see "Pre-match hints"). The favorite's goals count for less the bigger the mismatch, and the underdog's for more. An underdog win or draw earns an upset bonus (full at a 50-point gap in win chance), and an evenly matched game earns up to +0.5. When the underdog wins big, there's no blowout penalty and no "already decided" discount on its goals: the owner wanted a shock like Brighton 3–0 Arsenal to score high (8.1). Whether or not there are odds, goals scored when a team was already 2+ up count for less, the "won by 3+" penalty grows with the margin (up to −3.5), and late goals only count while the result was within one goal. Before this, Viking 8–1 Kristiansund scored 10 and PSG 6–1 Slovan Bratislava 8.5; now both are about 4–5. The owner found an earlier, stronger version (6–1 at 2.8) too harsh.
- **Football upsets on penalties:** `shootoutWinner` from ESPN's `shootoutScore`. An underdog winning the shootout gets `upsetShootout`; one that loses it still gets `upsetDraw` for taking the favorite to penalties.
- **Football heat strip:** `heat(blocks, { floor: 4 })`, so a block needs about a goal's worth of action to be the hottest colour. Before, the busiest 15 minutes of a dull 0–0 were red-hot.
- **Football:** goals, the share of minutes within one goal, equalisers and lead changes, late goals, shots on target, red cards, penalties, goals ruled out by VAR ("Deleted After Review" in the commentary), shots off the woodwork, lots of corners (12+) or bookings (6+), extra time and shootouts. Segments are 15-minute blocks weighted by goals, disallowed goals, penalties, reds, VAR, woodwork and shots. Skip windows come from 5-minute slots with little action (quiet ≤ 0.45, about one shot on target).
- **Tennis:** number of sets compared with the maximum, how close each set was (a tiebreak or 7-5 counts as close), tiebreaks, comebacks and the round. Retirements score 1, and walkovers and qualifying are left out.
- **F1 qualifying** (`scoreQuali`, from `factsFromQuali`):
  - What scores: the pole margin, how close the top 10 was in Q3, provisional pole changes in Q3 (from all drivers' laps, counted as each lap finishes, with extra for the last 4 minutes), how close the Q1 and Q2 knockouts were (16 of 22 cars go through Q1, or 15 of 20; 10 go through Q2), red flags (messages within 3 minutes count as one), laps deleted in Q3, and rain.
  - Race-control messages don't all carry `qualifying_phase`, so the part is worked out from time: each part starts at its first tagged message.
  - OpenF1 answers 404 instead of an empty list, so `fetchQualiData` uses `maybe()`.
  - Qualifying events have `session: 'qualifying'` (races don't have the field), and the strip is always 3 blocks (Q1, Q2, Q3).
  - Advice uses unit `part`, and Q3 is never skipped ("Skip Q1", "Skip Q1 and Q2").
  - The F1 tab has a "Sessions" filter (`prefs.f1Session`). The live check waits `F1_QUALI_HOURS` (1.5) before asking OpenF1.
  - Hungary 2025 (pole by 0.026 s) is high and Japan 2026 is low.
- **F1 sprint weekends:** `SESSIONS` in `openf1.mjs` lists the four session types PrimeTime scores: `race`, `qualifying`, `sprint` and `sprint-qualifying`, where `session` is the published field (Grand Prix races have none).
  - Sprint qualifying uses `scoreQuali` unchanged.
  - Sprints use `scoreF1(facts, { sprint: true })`. A sprint is about a third of a race, so overtakes count three times and the winning-margin limits are divided by three. China 2026 (4 lead changes) scores 10, and Qatar 2025 (2 overtakes) scores 2.1.
  - The "Sessions" filter has Races, Qualifying, and Sprints (the sprint and sprint qualifying together).
  - The live check waits `F1_SHORT_HOURS` (1.5) for any non-race session.
  - OpenF1 answers 404 instead of an empty list (for example, pit stops in a sprint with none), so every data fetch goes through `maybe()`.
- **F1:** clean overtakes (not on lap 1, no car pitting within a lap, not reversed within 2 laps), lead changes (the same pit filter), SC/VSC/red flags, the P1–P2 gap, DNFs, rain and late action. The raw OpenF1 overtake counts are mostly pit shuffles and noise, so keep the filters in `factsFromRace`.
- Tests check the ordering against known matches: France 6–4 England (WC 2026) is high, Bournemouth 0–1 Liverpool is low, Britain 2025 is high, and Japan 2025 is low.

## Winter sports (the "Winter" tab)

Biathlon, alpine and cross-country are all `sport: 'winter'`. `comp` is `biathlon`, `alpine` or `cross-country`, and `compName` drives the chips.
- **Fields:** `race` ("Women's 10 km pursuit"), `place`, `series` (World Cup / Tour de Ski / World Championships / Olympics) and `gender` (women/men/mixed).
- **Coverage:** the World Cup (including Tour de Ski stages, FIS category `SWC`), World Championships and Olympics. Snowboard, freestyle, ski jumping and Nordic combined are left out (owner's choice).
- **Left out because FIS has no usable times:** cross-country sprints, heat mass starts, relays and team sprints. Alpine team events, parallel races and combineds are also left out.

**Code:**
- `src/sources/winter.mjs` puts all three sports behind `listRaces(now, state)` and `scoreRace(race)`.
- `ibu.mjs` handles biathlon. It rebuilds the order after each shooting from lap and range times, plus 25 s per penalty loop.
- In relays, an unknown leader at the last handover (missing `TeamRankAfterLeg`) counts as unknown, not as "the leader didn't win".
- `fis.mjs` reads the FIS pages. `texts()` splits HTML into text pieces. Olympic events at several venues have an extra venue column.
- **If FIS changes its site, `fis.mjs` is what breaks.** `test/fixtures/winter/*.json` hold trimmed copies of real pages.
- FIS races without official results two days after their start count as cancelled. `state.winterEventsDone` lists finished FIS events, so their pages aren't read again. It's reset when the winter version changes.

**Spoilers:**
- **No athlete names anywhere on the cards.** Pursuit start order, mass start fields and the alpine run-2 order all give earlier results away.
- **Favorites follow a sport and gender** (`favs.winter: ['biathlon:women']`). Mixed races count for anyone following that sport.
- **Strip length depends only on the race type** (`winterSegments` in `publish.mjs`). Biathlon: sprint 3 blocks, relays 4 (legs), other races 5 (four shootings plus the finish). Alpine slalom and giant slalom: 2 (runs). Downhill, super-G and cross-country: none.
- **Skip tips:** biathlon head-to-head races can say "Start after shooting 2" (never the last shooting or the finish), or "Start at leg 3" in relays (never the last leg). Alpine two-run races can say "Skip run 1", based only on run 1 (a spread of over 1 s in the top 5). It used to also require that the run-1 leader didn't win, which told anyone who'd seen run 1 how it ended; a test now checks the tip is the same whoever won. Everything else gets "Watch it all" or "Highlights".
- **Scoring:** `src/scoring/winter.mjs`, with weights `BIATHLON`, `ALPINE` and `CROSS_COUNTRY`. The tests use real 2025/26 races:
  - Annecy mass start (0.3 s): 10. Oberhof sprint: low.
  - Gurgl slalom won from 14th after run 1: high. Levi, won by 1.66 s: low. The run-1 order includes skiers who went out in run 2 (`page.out` in `fis.mjs`, from unranked rows that still have a run-1 time), so a run-1 leader who skis out is noticed.
  - Oslo 50 km (0.4 s): high. Lahti 10 km: low.
- The live check only sets the LIVE badge for winter races. The full build (every 3 hours) scores them.

## Streaming rights

`src/rights/norway.json` maps competitions to services, each with a `validTo` date and a source link. Winter entries have `rules`, and the first match wins (`servicesFor(key, { country, series, start })` in `publish.mjs`).
- Biathlon: NRK and TV 2 until 2030, and the Olympics on NRK and HBO Max.
- FIS races abroad: TV 2 and Viaplay from 2026/27, Viaplay before that.
- FIS races in Norway: NRK.
- World Championships 2027: alpine on NRK, Nordic on TV 2.
- Austrian alpine races in 2026/27: unconfirmed, so both TV 2 and Viaplay are shown. It's kept by hand, because no free feed exists. The build prints a GitHub warning when an entry expires within 60 days. The service names and links are repeated in `SERVICES` in `docs/app.js`, so keep both in sync.

## Files

| Path | Purpose |
|---|---|
| `scripts/build.mjs` | Fetch → score → publish, plus state and pruning |
| `src/sources/*.mjs` | One file per data source. Each turns raw API data into plain "facts" |
| `src/scoring/*.mjs` | Facts → `{score, segments, advice}` |
| `src/publish.mjs` | The spoiler guard, and adds the streaming services |
| `src/prematch.mjs` | Football forecast and stakes (pre-match hints) |
| `src/calendar.mjs` | The per-team calendar feeds in `docs/cal/` |
| `docs/index.html`, `style.css`, `app.js` | The page, in vanilla JS. Colours are CSS variables: light in `:root`, dark in the `prefers-color-scheme: dark` media query (change both) |
| `docs/logic.js` | Pure page logic (filters, tiers, advice text), unit-tested |
| `test/fixtures/` | Trimmed real API responses used by the tests |

**Installable app:** `docs/manifest.webmanifest` plus the `apple-*` tags in `index.html` make it installable to the home screen. There's deliberately **no service worker and no offline copy** (the owner's choice), so nothing is stored on the phone besides localStorage. `setupInstall()` in `app.js` shows an "Install app" button when Chrome fires `beforeinstallprompt`, and a "Share → Add to Home Screen" tip on iPhone; both are hidden inside the installed app. `env(safe-area-inset-*)` padding keeps content clear of the notch. Icons are in `docs/icons/`, made from `docs/icon.svg` (rounded) and `docs/icons/icon-square.svg` (full-bleed, for maskable and Apple) with `rsvg-convert -w 512 -h 512 in.svg -o out.png`. The e2e test uses Chrome's own installability check.

Settings, "watched" marks and chosen services live in the browser's localStorage (`pt-prefs`, `pt-watched`). `migratePrefs` turns older saved settings into the current shape.

**Favorites** (`prefs.favs = {teams, players, f1}` plus the `prefs.favsOnly` switch, saved in `pt-prefs`; "Reset filters" leaves them alone). You add one with the search box under "My favorites". Cards only show a ★ right after a name you follow (tap it to unfollow); names you don't follow get no star, which the owner preferred for cleaner cards. The star and the name's last word are kept on one line (`.keep`), and `.name` has `data-name` with the full name. The F1 star follows F1 as a whole. The search box suggests names from the data (`favNames`/`searchNames`; case, accents and ø/æ are ignored). `isFavorite()` in `logic.js` holds the rules the owner chose:
- Football: either team.
- Tennis players **only count under "Coming up"**. In replays, seeing a player's later-round match would tell you they won the earlier ones.
- F1: every driver is in every race, so there are no driver favorites. Instead you follow F1 as a whole, and when you don't, races are hidden in favorites mode.
Stars aren't shown while names are hidden. The section folds up with the `#favs-toggle` button; "Only favorites" (`#fav-only`) stays outside the fold. Whether it's open is remembered in `pt-favs-open`, and by default it's open only when there are no favorites yet.

**"Share my settings"** (footer) moves settings to another device with no accounts: `encodeSettings()` packs the prefs (not the current tab) and the "watched" marks for events from the last 30 days into a `#s=…` link. Browsers never send the part after `#` to the server. The button uses the phone's share sheet, or copies the link. Opening the link runs `importSettings()` in `app.js`, which asks first in `#import-dlg`, keeps only known settings of the right type (`decodeSettings()`), replaces the settings, adds the watched marks, and clears the `#` from the address bar.

**The filters adapt to the chosen sport and view.** `facets()` in `docs/logic.js` counts the events each option would give, ignoring that option's own filter:
- Competition chips appear only for football and tennis.
- Service chips show only services that carry the sport (no counts, to save space).
- The minimum-rating options show counts.
- `periodOptions()` offers "last year" everywhere except football, which is kept for 30 days.
- Elements marked `data-for="tennis football all"` only show on those tabs. Tennis rounds and draw only apply on the Tennis tab.
- "More filters" shows `activeFilters()` as "n on", with a Reset button.

## Adding a sport

Add `src/sources/<sport>.mjs` and `src/scoring/<sport>.mjs`, a `publish<Sport>` in `publish.mjs` with its extra fields, `ALLOWED` in `test/spoilers.test.mjs`, a builder in `scripts/build.mjs`, `KEEP_DAYS`, `SPORTS` / `titleOf` / `subtitleOf` in `docs/logic.js`, a tab in `index.html`, a rights entry, and the sport in `FORMULA_VERSIONS`/`SPORT_WEIGHTS` (`common.mjs`) with its weights in `weights.mjs`.
