-- SuccessPath Classes: student and teacher registers.
-- Applied with: npm run db:setup
--
--   * people holds one record per student and per teacher. Entries point to it with person_id,
--     so fees, marks and notes all hang off one record and nobody is stored twice.
--   * Like entries, people can never be deleted, and every change is copied into people_history.
--   * students and teachers are ready-made views of people, for looking at the data.

CREATE TABLE IF NOT EXISTS people (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                TEXT    NOT NULL CHECK (kind IN ('student', 'teacher')),
  seq                 INTEGER NOT NULL,
  code                TEXT    NOT NULL UNIQUE,
  name                TEXT    NOT NULL,
  name_key            TEXT    NOT NULL,
  class               TEXT,
  phone               TEXT,
  status              TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Left', 'Cancelled')),
  details             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  joined_on           TEXT,
  left_on             TEXT,
  created_from        TEXT,
  created_from_client TEXT    UNIQUE,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, seq)
);

CREATE INDEX IF NOT EXISTS idx_people_match ON people (kind, name_key);

ALTER TABLE entries ADD COLUMN person_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_entries_person ON entries (person_id, type, status);

CREATE TABLE IF NOT EXISTS people_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL,
  action     TEXT    NOT NULL,
  snapshot   TEXT    NOT NULL,
  changed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_people_history_person ON people_history (person_id);

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

CREATE TRIGGER IF NOT EXISTS people_history_no_update
BEFORE UPDATE ON people_history
BEGIN
  SELECT RAISE(ABORT, 'The history is read-only.');
END;

CREATE TRIGGER IF NOT EXISTS people_history_no_delete
BEFORE DELETE ON people_history
BEGIN
  SELECT RAISE(ABORT, 'The history is read-only.');
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

-- Build the registers from the entries saved so far (one record per name, and per class for students).
INSERT INTO people (kind, seq, code, name, name_key, class, phone, status, created_from)
SELECT 'student', ROW_NUMBER() OVER (ORDER BY g.first_id),
       printf('STU-%04d', ROW_NUMBER() OVER (ORDER BY g.first_id)),
       first.name, g.name_key, g.class,
       (SELECT x.phone FROM entries x
         WHERE x.type IN ('fee', 'admission', 'student_left') AND x.status = 'Active'
           AND lower(x.name) = g.name_key AND json_extract(x.data, '$.class') IS g.class
           AND x.phone IS NOT NULL
         ORDER BY x.id DESC LIMIT 1),
       'Active', first.code
FROM (
  SELECT MIN(id) AS first_id, lower(name) AS name_key, json_extract(data, '$.class') AS class
  FROM entries
  WHERE type IN ('fee', 'admission', 'student_left') AND status = 'Active' AND name IS NOT NULL
  GROUP BY lower(name), json_extract(data, '$.class')
) AS g
JOIN entries AS first ON first.id = g.first_id;

INSERT INTO people (kind, seq, code, name, name_key, phone, status, created_from)
SELECT 'teacher', ROW_NUMBER() OVER (ORDER BY g.first_id),
       printf('TR-%04d', ROW_NUMBER() OVER (ORDER BY g.first_id)),
       first.name, g.name_key,
       (SELECT x.phone FROM entries x
         WHERE x.type IN ('teacher', 'teacher_left') AND x.status = 'Active'
           AND lower(x.name) = g.name_key AND x.phone IS NOT NULL
         ORDER BY x.id DESC LIMIT 1),
       'Active', first.code
FROM (
  SELECT MIN(id) AS first_id, lower(name) AS name_key
  FROM entries
  WHERE type IN ('teacher', 'teacher_left') AND status = 'Active' AND name IS NOT NULL
  GROUP BY lower(name)
) AS g
JOIN entries AS first ON first.id = g.first_id;

UPDATE entries
SET person_id = (
  SELECT p.id FROM people p
  WHERE p.kind = 'student' AND p.name_key = lower(entries.name)
    AND p.class IS json_extract(entries.data, '$.class'))
WHERE type IN ('fee', 'admission', 'student_left') AND status = 'Active' AND person_id IS NULL AND name IS NOT NULL;

UPDATE entries
SET person_id = (SELECT p.id FROM people p WHERE p.kind = 'teacher' AND p.name_key = lower(entries.name))
WHERE type IN ('teacher', 'teacher_left') AND status = 'Active' AND person_id IS NULL AND name IS NOT NULL;

-- Details from the latest admission or joining form, and who has left.
UPDATE people
SET details = (
      SELECT json_patch('{}', json_object(
        'parent_name', json_extract(e.data, '$.parent_name'), 'phone_2', json_extract(e.data, '$.phone_2'),
        'school', json_extract(e.data, '$.school'), 'subjects', json_extract(e.data, '$.subjects'),
        'fee_amount', json_extract(e.data, '$.fee_amount'), 'fee_plan', json_extract(e.data, '$.fee_plan'),
        'address', json_extract(e.data, '$.address')))
      FROM entries e WHERE e.person_id = people.id AND e.type = 'admission' AND e.status = 'Active'
      ORDER BY e.id DESC LIMIT 1),
    joined_on = (
      SELECT MIN(e.entry_date) FROM entries e
      WHERE e.person_id = people.id AND e.type = 'admission' AND e.status = 'Active')
WHERE kind = 'student'
  AND EXISTS (SELECT 1 FROM entries e WHERE e.person_id = people.id AND e.type = 'admission' AND e.status = 'Active');

UPDATE people
SET details = (
      SELECT json_patch('{}', json_object(
        'subjects', json_extract(e.data, '$.subjects'), 'classes', json_extract(e.data, '$.classes'),
        'salary', json_extract(e.data, '$.salary'), 'qualification', json_extract(e.data, '$.qualification'),
        'address', json_extract(e.data, '$.address')))
      FROM entries e WHERE e.person_id = people.id AND e.type = 'teacher' AND e.status = 'Active'
      ORDER BY e.id DESC LIMIT 1),
    joined_on = (
      SELECT MIN(e.entry_date) FROM entries e
      WHERE e.person_id = people.id AND e.type = 'teacher' AND e.status = 'Active')
WHERE kind = 'teacher'
  AND EXISTS (SELECT 1 FROM entries e WHERE e.person_id = people.id AND e.type = 'teacher' AND e.status = 'Active');

UPDATE people
SET status = 'Left',
    left_on = (
      SELECT MAX(e.entry_date) FROM entries e
      WHERE e.person_id = people.id AND e.type IN ('student_left', 'teacher_left') AND e.status = 'Active')
WHERE EXISTS (
  SELECT 1 FROM entries e
  WHERE e.person_id = people.id AND e.type IN ('student_left', 'teacher_left') AND e.status = 'Active');
