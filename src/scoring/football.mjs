// Football watchability score (0–10), heat strip and skip advice.
// The scorer itself lives in docs/scoring.js, so the page can run the same code ("Custom scoring").
// Input: the facts from factsFromSummary() in src/sources/espn-football.mjs.

import { scoreFootball as score, footballAdvice } from '../../docs/scoring.js';
import { FOOTBALL } from './weights.mjs';

export const scoreFootball = (f, W = FOOTBALL, opts) => score(f, W, opts);
export { footballAdvice };
