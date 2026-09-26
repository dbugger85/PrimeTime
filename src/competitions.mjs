// The competitions PrimeTime follows. `key` matches src/rights/norway.json.

export const FOOTBALL = [
  { key: 'eng.1', name: 'Premier League' },
  { key: 'uefa.champions', name: 'Champions League' },
  { key: 'nor.1', name: 'Eliteserien' },
  { key: 'uefa.nations', name: 'Nations League' },
  { key: 'uefa.euroq', name: 'EURO qualifiers' },
  { key: 'fifa.worldq.uefa', name: 'World Cup qualifiers' },
  { key: 'uefa.euro', name: 'EURO' },
  { key: 'fifa.world', name: 'World Cup' },
];

// How far back each sport is kept on the site.
export const KEEP_DAYS = { football: 30, tennis: 400, f1: 400 };
