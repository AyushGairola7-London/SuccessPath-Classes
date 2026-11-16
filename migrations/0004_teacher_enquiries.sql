-- SuccessPath Classes: teacher enquiries.
-- Applied with: npm run db:setup
--
-- Someone who asked to teach here but was not hired is kept in the teacher register with the
-- status Enquiry (not counted as a teacher). SQLite cannot change the CHECK rule of a column in
-- place, so the people table is copied into a new table with the wider rule and swapped in.
-- Every record keeps its id, so entries and the history still point to the same people.

-- 1. The views and the trigger that read the people table are put back at the end.
DROP VIEW IF EXISTS students;
DROP VIEW IF EXISTS teachers;
DROP TRIGGER IF EXISTS entries_cancel_updates_people;

-- 2. The same table, with Enquiry allowed as a status.
CREATE TABLE people_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                TEXT    NOT NULL CHECK (kind IN ('student', 'teacher')),
  seq                 INTEGER NOT NULL,
  code                TEXT    NOT NULL UNIQUE,
  name                TEXT    NOT NULL,
  name_key            TEXT    NOT NULL,
  class               TEXT,
  phone               TEXT,
  status              TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Left', 'Enquiry', 'Cancelled')),
  details             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  joined_on           TEXT,
  left_on             TEXT,
  created_from        TEXT,
  created_from_client TEXT    UNIQUE,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, seq)
);

INSERT INTO people_new (id, kind, seq, code, name, name_key, class, phone, status, details, joined_on, left_on,
  created_from, created_from_client, created_at, updated_at)
SELECT id, kind, seq, code, name, name_key, class, phone, status, details, joined_on, left_on,
  created_from, created_from_client, created_at, updated_at
FROM people;

DROP TABLE people;
ALTER TABLE people_new RENAME TO people;

-- 3. Indexes, triggers and views, exactly as before.
CREATE INDEX IF NOT EXISTS idx_people_match ON people (kind, name_key);

CREATE TRIGGER IF NOT EXISTS people_log_insert
AFTER INSERT ON people
BEGIN
  INSERT INTO people_history (person_id, action, snapshot)
  VALUES (NEW.id, 'created', json_object(
    'id', NEW.id, 'kind', NEW.kind, 'code', NEW.code, 'name', NEW.name, 'class', NEW.class,
    'phone', NEW.phone, 'status', NEW.status, 'details', json(NEW.details),
    'joined_on', NEW.joined_on, 'left_on', NEW.left_on, 'created_from', NEW.created_from,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS people_log_update
AFTER UPDATE ON people
BEGIN
  INSERT INTO people_history (person_id, action, snapshot)
  VALUES (NEW.id, 'changed', json_object(
    'id', NEW.id, 'kind', NEW.kind, 'code', NEW.code, 'name', NEW.name, 'class', NEW.class,
    'phone', NEW.phone, 'status', NEW.status, 'details', json(NEW.details),
    'joined_on', NEW.joined_on, 'left_on', NEW.left_on, 'created_from', NEW.created_from,
    'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS people_no_delete
BEFORE DELETE ON people
BEGIN
  SELECT RAISE(ABORT, 'Students and teachers cannot be deleted. Set their status to Left instead.');
END;

CREATE TRIGGER IF NOT EXISTS people_fixed_identity
BEFORE UPDATE OF id, kind, seq, code, created_at ON people
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.seq IS NOT OLD.seq
  OR NEW.code IS NOT OLD.code OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'The ID of a student or teacher cannot be changed.');
END;

-- When an entry is cancelled, undo what it did to the register.
CREATE TRIGGER IF NOT EXISTS entries_cancel_updates_people
AFTER UPDATE OF status ON entries
WHEN NEW.status = 'Cancelled' AND OLD.status = 'Active' AND NEW.person_id IS NOT NULL
BEGIN
  -- A cancelled "left" entry: the person is back to Active, unless another "left" entry still stands.
  UPDATE people
  SET status = 'Active', left_on = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.person_id AND status = 'Left'
    AND NEW.type IN ('student_left', 'teacher_left')
    AND NOT EXISTS (
      SELECT 1 FROM entries
      WHERE person_id = NEW.person_id AND type IN ('student_left', 'teacher_left')
        AND status = 'Active' AND id <> NEW.id);
  -- The entry that added this person was cancelled and nothing else points to them:
  -- hide the person, so a mistyped name does not stay in the register.
  UPDATE people
  SET status = 'Cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.person_id AND created_from = NEW.code
    AND NOT EXISTS (SELECT 1 FROM entries WHERE person_id = NEW.person_id AND status = 'Active' AND id <> NEW.id);
END;

CREATE VIEW IF NOT EXISTS students AS
  SELECT id, code, name, class, phone, status, joined_on, left_on, details, created_from, created_at, updated_at
  FROM people WHERE kind = 'student';

CREATE VIEW IF NOT EXISTS teachers AS
  SELECT id, code, name, phone, status, joined_on, left_on, details, created_from, created_at, updated_at
  FROM people WHERE kind = 'teacher';
