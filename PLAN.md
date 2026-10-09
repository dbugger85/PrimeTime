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
