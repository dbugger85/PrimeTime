# PrimeTime data export

PrimeTime (https://primetime.re) rates finished sports events 0–10 for how entertaining they are to watch, without spoiling the result. This export holds every event PrimeTime knows about, with all its data points and where each came from. **It contains results (spoilers).**

- Generated: {{generated}}
- Contents: {{counts}}

## Files

| File | What it is |
|---|---|
| `primetime-events.jsonl` | One event per line (JSON Lines), all sports, newest first. Nested, self-describing field names. Each record carries a `sources` map: field path → where it came from. Best for LLMs and code. |
| `football.csv` | One football match per row, flat columns (lists joined with `;`). Best for spreadsheets and regression. |
| `README.md` | This file. |

## How to read a record (`primetime-events.jsonl`)

Fields common to every sport:

| Field | Meaning |
|---|---|
| `id` | PrimeTime id: `fb-` football (ESPN event id), `tn-` tennis (ESPN), `f1-` F1 (OpenF1 session key), `bt-`/`al-`/`cc-` winter (IBU/FIS race id) |
| `sport` | `football`, `tennis`, `f1`, `winter` |
| `competition` | `{ code, name }`, e.g. `eng.1` Premier League; for winter `biathlon`/`alpine`/`cross-country` |
| `start` | Start time, ISO 8601 UTC |
| `result` | The outcome. Football: `text` ("A 0–3 B"), `score` `{home, away}`, `goals` ("minute · running score · scorer (team)"), `substitutions`. Tennis: `text` and `sets` (games per set, winner first, tiebreak points dropped). F1 and winter: `text` (podium and margins) |
| `primetime.score` | PrimeTime's 0–10 watchability score (the thing to explain or predict). Null for unrated F1 qualifying |
| `primetime.scoringVersion` | Formula version and weight fingerprint, e.g. `18.c0368165` (football formula 18). Scores from different versions aren't directly comparable |
| `primetime.timeline` | The heat strip: one value per part of the event, 0 (nothing) to 3 (hottest part of *this* event, relative). Football: 6 blocks of 15 minutes; F1: 10 equal lap chunks; tennis: none; winter: per run/leg/shooting |
| `primetime.skip` | Skip advice `{ code, unit, ranges }`. `code`: `full` (watch it all), `highlights`, `skip` (skip the `ranges`). `unit`: `min`, `lap`, `set`, `run`, `leg`… Ranges are `[from, to)` |
| `primetime.breakdown` | The score explained: each line's points and a plain-English label, in calculation order. The last lines (big-match factor, "Higher scores are harder to reach") scale the total |
| `services` | Norwegian streaming services carrying the event |
| `recoveredFromGitHistory` | `false`, or the commit it was recovered from when the event had dropped out of the live files (football is kept 30 days). Those were scored with the formula of that time |
| `sources` | Field path → source (see the list at the end). `x.*` covers every field under `x` |

### Football extras

| Field | Meaning |
|---|---|
| `teams` | `{ home, away }` (ESPN names) |
| `elo` | Latest Elo rating of each team **at export time**, not at kick-off (clubs: Club Elo; national teams: World Football Elo) |
| `stakes` | What was at stake before kick-off, from the league table: `title`, `relegation`, `top4`, `top8`, `europe`, `playoff`, `group`, `qualify` |
| `lineups` | `[home, away]`, each `{ formation, players: [[shirt, name, position]], bench: [[shirt, name]] }` |
| `limitedInfo` | Present when FotMob had no xG for the match |
| `facts` | The raw numbers the score is calculated from (only for matches from the last 30 days; older ones have only `result` and `breakdown`). Details below |

`facts`:

| Field | Meaning | Source |
|---|---|---|
| `goals` | `[{ min, side, clock, pen?, own? }]`: exact minute (decimal), `home`/`away` = team credited, the clock as shown ("90+2'") | ESPN keyEvents |
| `odds` | Pre-match win chances `{ home, draw, away }` (0–1, bookmaker margin removed) | ESPN pickcenter (DraftKings) |
| `reds`, `pens`, `disallowed`, `woodwork` | Minutes of red cards, penalties awarded, goals ruled out by VAR, shots off the post/bar | ESPN keyEvents / commentary |
| `corners`, `yellows`, `shotsOnTarget`, `totalShots` | Match totals, both teams | ESPN boxscore |
| `shotsBy` | Shots per team `{ home, away }` | ESPN commentary |
| `extraTime`, `shootout`, `shootoutWinner` | Knockout details | ESPN summary |
| `xg` | Expected goals per team | FotMob shot map |
| `stats.bigChances`, `stats.xgot`, `stats.touchesInBox` | Big chances (scored or missed), xG on target, touches in the opposition box, per team | FotMob team stats |
| `strength` | Team strength 0–1 used for the "big match" factor: half the team's rank within its league's field, half the worldwide Elo scale (national teams: world Elo, 1400 = 0, 2100 = 1) | PrimeTime, from Elo + league table |
| `stakes` | As above | ESPN standings |

### Tennis extras

`players` (alphabetical, not home/away), `draw` (e.g. "Men's Singles"), `round`. Grand Slam singles only. ESPN gives set scores and tiebreaks only: no rankings, seeds or point-by-point data.

### F1 extras

`circuit`, `session` (`race`, `sprint`, `qualifying`, `sprint-qualifying`; qualifying is unrated). The underlying OpenF1 facts (overtakes, safety cars, gaps) aren't stored per race; the `breakdown` labels show the counts used.

### Winter extras

`race` ("Women's 10 km pursuit"), `place`, `series` (World Cup, Tour de Ski, World Championships, Olympics), `gender`.

## Caveats

- Only football has raw `facts`, and only for the last 30 days. For older football and for the other sports, the numbers used are inside the `primetime.breakdown` labels ("3 goals", "Chances worth 2.2 xG").
- The score is a hand-tuned formula, not a measured truth. There are no independent "how entertaining was it" labels in this data.
- ESPN, FotMob and OpenF1 are free, unofficial APIs; fields are sometimes missing (null).
- Team names follow ESPN; Elo sites spell some differently.

## Sources

{{sources}}
