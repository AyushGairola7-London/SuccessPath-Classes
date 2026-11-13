-- SuccessPath Classes database tables.
-- Applied with: npm run db:setup
--
-- How the data is kept safe:
--   * Every saved form is one row in entries. The form fields are kept as JSON in the data
--     column, so adding a field to a form never needs a database change.
--   * Rows in entries can never be deleted. A wrong entry is marked Cancelled instead.
--   * Every new row and every change is copied into entry_history automatically.
--     entry_history can only be added to, never changed or deleted.

CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  seq           INTEGER NOT NULL,
  code          TEXT    NOT NULL UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled')),
  entry_date    TEXT,
  name          TEXT,
  phone         TEXT,
  amount        REAL,
  data          TEXT    NOT NULL CHECK (json_valid(data)),
  client_id     TEXT    NOT NULL UNIQUE,
  cancel_hash   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  cancelled_at  TEXT,
  cancel_reason TEXT,
  UNIQUE (type, seq)
);

CREATE INDEX IF NOT EXISTS idx_entries_type_date ON entries (type, entry_date);
CREATE INDEX IF NOT EXISTS idx_entries_name ON entries (name);
CREATE INDEX IF NOT EXISTS idx_entries_phone ON entries (phone);

CREATE TABLE IF NOT EXISTS entry_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL,
  action     TEXT    NOT NULL,
  snapshot   TEXT    NOT NULL,
  changed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_history_entry ON entry_history (entry_id);

-- Copy every new entry into the history.
CREATE TRIGGER IF NOT EXISTS entries_log_insert
AFTER INSERT ON entries
BEGIN
  INSERT INTO entry_history (entry_id, action, snapshot)
  VALUES (NEW.id, 'created', json_object(
    'id', NEW.id, 'type', NEW.type, 'seq', NEW.seq, 'code', NEW.code, 'status', NEW.status,
    'entry_date', NEW.entry_date, 'name', NEW.name, 'phone', NEW.phone, 'amount', NEW.amount,
    'data', json(NEW.data), 'client_id', NEW.client_id,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at,
    'cancelled_at', NEW.cancelled_at, 'cancel_reason', NEW.cancel_reason));
END;

-- Copy every change into the history. The version before the change is in the earlier history row.
CREATE TRIGGER IF NOT EXISTS entries_log_update
AFTER UPDATE ON entries
BEGIN
  INSERT INTO entry_history (entry_id, action, snapshot)
  VALUES (NEW.id, 'changed', json_object(
    'id', NEW.id, 'type', NEW.type, 'seq', NEW.seq, 'code', NEW.code, 'status', NEW.status,
    'entry_date', NEW.entry_date, 'name', NEW.name, 'phone', NEW.phone, 'amount', NEW.amount,
    'data', json(NEW.data), 'client_id', NEW.client_id,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at,
    'cancelled_at', NEW.cancelled_at, 'cancel_reason', NEW.cancel_reason));
END;

-- Entries can never be deleted.
CREATE TRIGGER IF NOT EXISTS entries_no_delete
BEFORE DELETE ON entries
BEGIN
  SELECT RAISE(ABORT, 'Entries cannot be deleted. Mark the entry as Cancelled instead.');
END;

-- The entry number, form type and creation time of an entry never change.
CREATE TRIGGER IF NOT EXISTS entries_fixed_identity
BEFORE UPDATE OF id, type, seq, code, client_id, created_at ON entries
WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.seq IS NOT OLD.seq
  OR NEW.code IS NOT OLD.code OR NEW.client_id IS NOT OLD.client_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'The entry number, form type and creation time cannot be changed.');
END;

-- The history can only be added to.
CREATE TRIGGER IF NOT EXISTS history_no_update
BEFORE UPDATE ON entry_history
BEGIN
  SELECT RAISE(ABORT, 'The history is read-only.');
END;

CREATE TRIGGER IF NOT EXISTS history_no_delete
BEFORE DELETE ON entry_history
BEGIN
  SELECT RAISE(ABORT, 'The history is read-only.');
END;
