-- SuccessPath Classes: the Tasks board (what to do next).
-- Applied with: npm run db:setup
--
--   * tasks holds one card per job, for example "Hire a maths teacher". stage is the column it is in.
--   * Like entries, tasks are never deleted. "Remove from board" sets the stage to Removed, and
--     every change is copied into task_history.
--   * position orders the cards inside a column: smaller numbers are higher up.

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seq        INTEGER NOT NULL UNIQUE,
  code       TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  notes      TEXT,
  stage      TEXT    NOT NULL DEFAULT 'To do' CHECK (stage IN ('To do', 'Doing', 'Done', 'Removed')),
  due_on     TEXT,
  owner      TEXT,
  position   REAL    NOT NULL DEFAULT 0,
  client_id  TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks (stage, position);

CREATE TABLE IF NOT EXISTS task_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL,
  action     TEXT    NOT NULL,
  snapshot   TEXT    NOT NULL,
  changed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history (task_id);

CREATE TRIGGER IF NOT EXISTS tasks_log_insert
AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_history (task_id, action, snapshot)
  VALUES (NEW.id, 'created', json_object(
    'id', NEW.id, 'code', NEW.code, 'title', NEW.title, 'notes', NEW.notes, 'stage', NEW.stage,
    'due_on', NEW.due_on, 'owner', NEW.owner, 'position', NEW.position,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'done_at', NEW.done_at));
END;

CREATE TRIGGER IF NOT EXISTS tasks_log_update
AFTER UPDATE ON tasks
BEGIN
  INSERT INTO task_history (task_id, action, snapshot)
  VALUES (NEW.id, 'changed', json_object(
    'id', NEW.id, 'code', NEW.code, 'title', NEW.title, 'notes', NEW.notes, 'stage', NEW.stage,
    'due_on', NEW.due_on, 'owner', NEW.owner, 'position', NEW.position,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'done_at', NEW.done_at));
END;

CREATE TRIGGER IF NOT EXISTS tasks_no_delete
BEFORE DELETE ON tasks
BEGIN
  SELECT RAISE(ABORT, 'Tasks cannot be deleted. Remove them from the board instead.');
END;

CREATE TRIGGER IF NOT EXISTS tasks_fixed_identity
BEFORE UPDATE OF id, seq, code, client_id, created_at ON tasks
WHEN NEW.id IS NOT OLD.id OR NEW.seq IS NOT OLD.seq OR NEW.code IS NOT OLD.code
  OR NEW.client_id IS NOT OLD.client_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'The ID of a task cannot be changed.');
END;

CREATE TRIGGER IF NOT EXISTS task_history_no_update
BEFORE UPDATE ON task_history
BEGIN
  SELECT RAISE(ABORT, 'The history is read-only.');
END;

CREATE TRIGGER IF NOT EXISTS task_history_no_delete
BEFORE DELETE ON task_history
BEGIN
  SELECT RAISE(ABORT, 'The history is read-only.');
END;
