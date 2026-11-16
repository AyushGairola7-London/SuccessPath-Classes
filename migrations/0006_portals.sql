-- SuccessPath Classes, version 3: the teacher and student portals, and more on the Tasks board.
-- Applied with: npm run db:setup (after version 2.6's 0005).
--
--   * tasks get a start date, a budget, and who last changed them (the office or a teacher).
--     The end date is the old "due on" date.
--   * login_failures counts wrong passwords, so nobody can try thousands of them.
--     Only the last day is kept. Messages from students are ordinary entries (MSG-0001 ...).

ALTER TABLE tasks ADD COLUMN start_on TEXT;
ALTER TABLE tasks ADD COLUMN budget REAL CHECK (budget IS NULL OR budget >= 0);
ALTER TABLE tasks ADD COLUMN changed_by TEXT;

DROP TRIGGER IF EXISTS tasks_log_insert;
DROP TRIGGER IF EXISTS tasks_log_update;

CREATE TRIGGER tasks_log_insert
AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_history (task_id, action, snapshot)
  VALUES (NEW.id, 'created', json_object(
    'id', NEW.id, 'code', NEW.code, 'title', NEW.title, 'notes', NEW.notes, 'stage', NEW.stage,
    'start_on', NEW.start_on, 'due_on', NEW.due_on, 'budget', NEW.budget, 'owner', NEW.owner,
    'position', NEW.position, 'changed_by', NEW.changed_by,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'done_at', NEW.done_at));
END;

CREATE TRIGGER tasks_log_update
AFTER UPDATE ON tasks
BEGIN
  INSERT INTO task_history (task_id, action, snapshot)
  VALUES (NEW.id, 'changed', json_object(
    'id', NEW.id, 'code', NEW.code, 'title', NEW.title, 'notes', NEW.notes, 'stage', NEW.stage,
    'start_on', NEW.start_on, 'due_on', NEW.due_on, 'budget', NEW.budget, 'owner', NEW.owner,
    'position', NEW.position, 'changed_by', NEW.changed_by,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'done_at', NEW.done_at));
END;

CREATE TABLE IF NOT EXISTS login_failures (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ip       TEXT NOT NULL,
  role     TEXT NOT NULL,
  username TEXT,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures (ip, role, at);

-- Messages from the student portal are found by the teacher they were sent to.
CREATE INDEX IF NOT EXISTS idx_entries_portal_teacher
  ON entries (json_extract(data, '$.teacher_code'))
  WHERE type = 'portal_message';
