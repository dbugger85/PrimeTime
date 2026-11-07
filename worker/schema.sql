-- One row per phone and belled event. Deleted once the notification is sent.
CREATE TABLE IF NOT EXISTS alerts (
  endpoint TEXT NOT NULL,  -- the phone's push address (from the browser)
  p256dh TEXT NOT NULL,    -- the browser's public key, to encrypt the message
  auth TEXT NOT NULL,      -- the browser's secret, to encrypt the message
  event TEXT NOT NULL,     -- the event id in events.json, like fb-401878758
  start INTEGER NOT NULL,  -- start time, ms since 1970 (from events.json)
  title TEXT NOT NULL,     -- the notification's title, as the page wrote it
  body TEXT NOT NULL,
  PRIMARY KEY (endpoint, event)
);
CREATE INDEX IF NOT EXISTS alerts_start ON alerts (start);
