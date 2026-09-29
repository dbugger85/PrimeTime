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
7. Later ideas: Norwegian UI text, more leagues (La Liga etc.), upcoming fixtures, per-event rights overrides.
