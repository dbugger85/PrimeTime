-- A short send log (2026-11-16), so a missed notification can be explained afterwards.
-- No push address: only when, which event, what happened, the push service's answer and its host.
-- Rows older than 14 days are deleted every hour. Run once before deploying:
--   npx wrangler d1 execute primetime-push --remote --file migrations/0002_log.sql
CREATE TABLE IF NOT EXISTS log (at INTEGER NOT NULL, event TEXT NOT NULL, what TEXT NOT NULL, status INTEGER, host TEXT);
CREATE INDEX IF NOT EXISTS log_at ON log (at);
