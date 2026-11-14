-- One row per phone and belled event. Deleted once the notification is sent (golf: once the tournament is over).
-- An existing database gets the golf columns from migrations/0001_golf.sql.
CREATE TABLE IF NOT EXISTS alerts (
  endpoint TEXT NOT NULL,  -- the phone's push address (from the browser)
  p256dh TEXT NOT NULL,    -- the browser's public key, to encrypt the message
  auth TEXT NOT NULL,      -- the browser's secret, to encrypt the message
  event TEXT NOT NULL,     -- the event id in events.json, like fb-401878758
  start INTEGER NOT NULL,  -- start time, ms since 1970 (from events.json)
  title TEXT NOT NULL,     -- the notification's title, as the page wrote it
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'start', -- 'start' (one push, then deleted) or 'golf' (a whole tournament)
  players TEXT NOT NULL DEFAULT '[]', -- golf: followed golfers (JSON, at most 5; only from phones at level 2+)
  level INTEGER NOT NULL DEFAULT 0,   -- golf: "how much to reveal" on that phone (0-3)
  sent TEXT NOT NULL DEFAULT '[]',    -- golf: the pushes already sent (JSON keys like "r3", "b4", "hot")
  PRIMARY KEY (endpoint, event)
);
CREATE INDEX IF NOT EXISTS alerts_start ON alerts (start);
