-- Golf notifications (2026-11-14): one row follows a whole tournament.
-- Run once on the existing database before deploying the new worker:
--   npx wrangler d1 execute primetime-push --remote --file migrations/0001_golf.sql
ALTER TABLE alerts ADD COLUMN kind TEXT NOT NULL DEFAULT 'start';
ALTER TABLE alerts ADD COLUMN players TEXT NOT NULL DEFAULT '[]';
ALTER TABLE alerts ADD COLUMN level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alerts ADD COLUMN sent TEXT NOT NULL DEFAULT '[]';
