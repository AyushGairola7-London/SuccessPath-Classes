-- Version 3.2: the office's Activity log, and deleting a student or teacher added by mistake.
--
-- audit_log keeps what the office does to the registers that is not an entry: changing someone's
-- details (what changed, from and to), deleting a student or teacher (with the note saying why) and
-- restoring them. Its rows are never changed or deleted. Entries, tasks and leave requests already
-- keep their own history, which the Activity log reads as well.
--
-- Deleting removes nothing from the database. The person is hidden, the same way as a mistyped name
-- whose only entry was cancelled (status Cancelled); their entries are cancelled with the note; and
-- the delete row records what it changed, so Restore can put it all back.

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT    NOT NULL CHECK (action IN ('edit', 'delete', 'restore')),
  person_id  INTEGER NOT NULL REFERENCES people(id),
  by_name    TEXT    NOT NULL DEFAULT 'Office',
  note       TEXT,
  details    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  client_id  TEXT    UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_person ON audit_log (person_id, id);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'The activity log cannot be changed.');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'The activity log cannot be deleted.');
END;

-- The Activity log reads each source newest first.
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries (created_at);
CREATE INDEX IF NOT EXISTS idx_entries_cancelled ON entries (cancelled_at) WHERE cancelled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_history_time ON task_history (changed_at);
CREATE INDEX IF NOT EXISTS idx_leave_request_history_time ON leave_request_history (at);
