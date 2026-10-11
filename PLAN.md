# PrimeTime plan and decisions (2026-09-26)

Planned with Fable, then built with Opus.

## Why the first attempt (branch `old-nextjs`) never worked
- It ran on mock data unless a football-data.org key was set, and the free tier of that API has no minute-by-minute events.
- It scored matches live when you clicked, calling rate-limited APIs through a Next.js server that was never deployed. The repo was private, so free GitHub Pages wasn't possible.
- Results were sent to the browser, and texts like "late goals" leaked outcomes.
- Some rights data was wrong, and there were no tests.

## Approach
A static site on GitHub Pages, fed by a scheduled GitHub Action that fetches free data (ESPN, OpenF1), scores it with fixed formulas (no AI), and publishes one spoiler-free `events.json`.

## Owner's decisions
1. The repo is **public**, so free Pages hosting works.
2. Relying on ESPN's unofficial API is **OK**.
3. Skip tips may hint "quiet until X". **OK**, with a toggle to hide them.
4. Where rights are unclear (La Liga), **show both services**.
5. Tennis scored from set scores only is **good enough**.
6. **Competitions:** the Premier League, Champions League, Nations League, European (EURO and World Cup) qualifiers, EURO, World Cup, Eliteserien, the tennis Grand Slams and F1.
7. **Country:** Norway.

## Build phases
0. Repo reset, Pages and the scheduled workflow. ✅
1. Football end to end. ✅
2. F1. ✅
3. Tennis. ✅
4. Installable app (home-screen icon; no offline mode, by the owner's choice). ✅
5. Favorites (2026-09-29): follow teams and tennis players, or F1 as a whole, and filter to them. Tennis favorites only filter "Coming up" (spoilers). ✅
6. "Share my settings" link to move settings to another device, with no accounts (2026-09-29). ✅
7. Team strength from betting odds in football scores; all weights in `src/scoring/weights.mjs`, editable on GitHub (2026-09-29). ✅
8. F1 qualifying, and underdog shocks score higher (2026-09-29). ✅
9. F1 sprints and sprint qualifying (2026-09-29). ✅
10. Later ideas: a few preset "scoring styles" users can pick (worked out at build time, so no spoilers); Norwegian UI text, more leagues (La Liga etc.), upcoming fixtures, per-event rights overrides.

## Winter sports plan (2026-09-29)

**Scope:** biathlon, cross-country and alpine skiing, men and women. The competitions are the World Cup (including the Tour de Ski), the World Championships and the Olympics. Snowboard, freestyle, ski jumping and Nordic combined are left out for now (owner's choice).

**Data:**
- Biathlon: the IBU results API (biathlonresults.com/modules/sportapi/api). It has times, gaps, misses per shooting and split times, and it works.
- Cross-country and alpine: the fis-ski.com results pages (HTML, unofficial). Final times work. Split times from FIS live timing still have to be checked.

**Owner's decisions:**
1. The competitions: World Cup, Tour de Ski, World Championships and Olympics.
2. One "Winter" tab, with chips for Biathlon, Cross-country and Alpine, plus a Men/Women/Mixed filter.
3. Favorites follow a sport or discipline (★ Biathlon, ★ Alpine women), not athletes. Start lists and qualifying would spoil earlier results.

**Spoiler rules to keep:**
- No athlete names on cards. Pursuit start order, mass start fields and the alpine run-2 order all give away earlier results.
- Strips have a fixed length per race type.
- Tips never skip the last shooting or the finish.
- Alpine speed events only get "Watch it all" or "Highlights".

**Phases:**
0. Check FIS split times and the Norwegian rights (NRK, TV 2, Viaplay, HBO Max/Eurosport). ✅ FIS has no split times; rights are in norway.json.
1. Biathlon. ✅
2. Alpine. ✅
3. Cross-country. ✅ No sprints: FIS gives no times for sprint finals.

The alpine season starts in Sölden in late October. Each sport keeps about a year of races. The owner will name some remembered thrillers and duds to check the scores against.

## Later decisions (2026-10-01)
- **Line-ups:** from ESPN, not X. Shown on upcoming, live and replay cards behind a button, each bench behind its own button. Substitutions only behind the "Show the result" warning.
- **Pre-match hints:** a forecast from the odds ("looks even on paper", "could be lively", "looks one-sided", no question mark) on upcoming matches only, and what's at stake from the table before kick-off, also kept on replays. Publishing the 3-level forecast code is OK; raw odds stay private.
- **Stakes score bonus:** yes, small (title 0.5, relegation 0.4, other races 0.2).
- **Calendar:** per-team subscription feeds linked from My favorites, no per-card button.

## Later decisions (2026-10-09): big matches, a non-linear score, Elo and win chances
- **Big matches score higher** (football 16): all points are multiplied by ×0.8 (two of the weakest teams) to ×1.2 (two of the strongest), from Elo ratings. **Clubs are rated against their own league** (the best of Eliteserien counts like the best of the PL); **national teams on the world scale**. Research (TV-audience studies of the PL and CL) found team quality draws viewers more than an even match, so the mean of the two teams' strengths is used.
- **Non-linear top:** a smooth curve above 5 replaces "points above 7 count less". **A 10 is practically never given**; the best thrillers land around 9.3–9.6.
- **Ratings:** Club Elo for clubs, eloratings.net for national teams, **refreshed once a week** (not every build). Club Elo was down on 2026-10-09, so a saved copy from January 2025 is used until it answers; the bot switches by itself.
- **"Show Elo ratings"** setting, **off by default**: the latest number in brackets after each team name, the same on every card (so two cards can't reveal a result).
- **"Show win chances"** setting, **off by default**: "Win chance: Arsenal 69% · draw 19% · Leeds United 12%" from the odds, Coming up only, frozen at kick-off. This replaces "raw odds stay private" for the percentages only; the odds themselves stay private.
- Fable reviewed the plan before the build and the code after it.

## Later decisions (2026-10-10): live clock and excitement so far
- **Live cards** show when the event started and how far in it is: the match minute for football, the time since the start for F1 and winter, and only "listed 14:00" for tennis (the owner agreed: ESPN's tennis times are the court's slot, and a set number would spoil).
- **"Excitement so far"** on live football: **tap to reveal**, and a **pace** (how much has happened per minute, scaled up to a full match), not "as if it ended now". Nothing before 15', "early and rough" before 30'. Fable tuned the starting weights against the test matches (the owner's choice).
- **Fresher updates:** the page asks ESPN itself while a live match is on screen: the minute once a minute, and the match details when "Excitement so far" is open, worked out on the phone (the owner chose this, "version 2"). The bot's number every 5 minutes is the fallback ("version 1"). The bot's own rhythm stays at 5 minutes (Fable advised against more Pages deploys).
- **Extra time:** fine that a live "105'" or "Pens" shows a knockout match was level after 90.
- The "Coming up" tab is now **"Coming up/ongoing"**.

## Later decisions (2026-10-10): football 17
- **FotMob's match stats join the score:** touches in the opposition box, big chances and xG on target (xGOT), as team totals, so they change the score but not the strip or the skip tips. Optional like xG. **Big chances missed get nothing extra** (keep it simple; FotMob's "Big chances" already includes them).
- **One-sided matches are punished about half as much:** `blowout` 1.5 → 0.75, the "already 2+ up" cuts 0.35/0.14 → 0.25/0.1 (Chelsea 5–1 Bournemouth 5.0 → 6.1). Routs like Croatia 0–7 England rising to about 7.6 is fine.
- **Two weak teams lose more than two strong ones gain:** ×0.6 for the weakest pair (`smallMatch` 0.4), ×1.25 for the strongest (`bigMatch` 0.25). Kazakhstan 2–2 Faroe Islands 8.0 → 6.9.
- **The league's level counts half** (`leagueLevel` 0.5): a club's strength is half its rank in its own league and half the worldwide Club Elo scale. This replaces the 2026-10-09 "clubs against their own league" rule, because on current Elo Manchester United–Tottenham was a below-average PL pair and could not beat that day's Eliteserien matches otherwise (7.5 → 7.8; Rosenborg–Sandefjord 8.0 → 7.3). National teams stay on the world scale.
- **Club Elo seed:** the API is still down; the ranking page saved by web.archive.org on 2026-09-27 replaces the January 2025 copy. Clubs under its 1500 cutoff are ordered by points per game from the table.
- Fable back-tested on the 149 matches of the last 30 days (mean 5.96 → 5.91, 9+ share 2% → 3%, no 10s) and the tests were updated on purpose where the owner's choices moved known matches.
- **Same evening, after seeing the numbers:** scores felt too high overall, and Man Utd 1–1 Tottenham (great: end to end, a 90th-minute equaliser) too low. Added "end to end" (both teams attacking about equally, by shots) and "a goal from 85' that changed the result"; the owner then asked for chances (xG, big chances, xG on target, box touches) to weigh more and the late equaliser less, and chose "in between" (lateDecider 0.6). Overall level "clearly lower" (curveFrom 2.5): about 1 in 10 matches gets 8+.

## Later decisions (2026-10-10): look and small changes
- **Glass look** like ProQuiz, **on by default**, with a "Glass look" switch under More filters/settings for people who don't like it. The original, smaller corner rounding stays. No em dashes in the page's text.
- **Labels:** "More filters/settings" and "Add favorites to calendar".
- **"Why this score?"** has no underline, and a ✕ in the panel's top-right corner hides the spoilers again.
- **Install card** made like the Substitutor app's: icon, "Install the app", an Install button and a ✕ that hides it for good.
