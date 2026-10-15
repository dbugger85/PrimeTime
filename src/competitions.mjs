// The competitions PrimeTime follows. `key` matches src/rights/norway.json.
// `teams`: clubs are rated against their own league for the "big match" line, national teams on the world scale.

export const FOOTBALL = [
  { key: 'eng.1', teams: 'clubs', name: 'Premier League' },
  { key: 'uefa.champions', teams: 'clubs', name: 'Champions League' },
  { key: 'nor.1', teams: 'clubs', name: 'Eliteserien' },
  { key: 'esp.1', teams: 'clubs', name: 'La Liga' },
  { key: 'ger.1', teams: 'clubs', name: 'Bundesliga' },
  { key: 'ita.1', teams: 'clubs', name: 'Serie A' },
  { key: 'fra.1', teams: 'clubs', name: 'Ligue 1' },
  { key: 'eng.2', teams: 'clubs', name: 'Championship' },
  { key: 'uefa.europa', teams: 'clubs', name: 'Europa League' },
  { key: 'uefa.europa.conf', teams: 'clubs', name: 'Conference League' },
  { key: 'uefa.nations', teams: 'nations', name: 'Nations League' },
  { key: 'uefa.euroq', teams: 'nations', name: 'EURO qualifiers' },
  { key: 'fifa.worldq.uefa', teams: 'nations', name: 'World Cup qualifiers' },
  { key: 'uefa.euro', teams: 'nations', name: 'EURO' },
  { key: 'fifa.world', teams: 'nations', name: 'World Cup' },
];

// How far back each sport is kept on the site.
export const KEEP_DAYS = { football: 30, tennis: 400, f1: 400, winter: 400 };
