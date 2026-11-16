-- SuccessPath Classes, version 2.6: student enquiries and demo classes, and one record per full name.
-- Applied with: npm run db:setup
--
--   * A student goes from Enquiry to Demo (demo classes) to Active (admitted). SQLite cannot change
--     the CHECK rule of a column in place, so the people table is copied into a new table that also
--     allows Demo, and swapped in. Every record keeps its id, so entries and the history still point
--     to the same people (the same steps as version 2.5).
--   * A student (or teacher) has one record, found by their full name (capital letters and extra
--     spaces do not count). If two records still share a full name, the later one gets its ID added
--     to its name, for example "Rahul Sharma (STU-0012)", so both stay and can be told apart.
--     Nothing is deleted. From now on the database itself refuses a second record with the same name.
--   * Enquiries saved before this version are linked to the student already there with that name,
--     or added to Students as an Enquiry.

-- 1. The views and the trigger that read the people table are put back at the end.
DROP VIEW IF EXISTS students;
DROP VIEW IF EXISTS teachers;
DROP TRIGGER IF EXISTS entries_cancel_updates_people;

-- 2. The same table, with Demo allowed as a status (for students).
CREATE TABLE people_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                TEXT    NOT NULL CHECK (kind IN ('student', 'teacher')),
  seq                 INTEGER NOT NULL,
  code                TEXT    NOT NULL UNIQUE,
  name                TEXT    NOT NULL,
  name_key            TEXT    NOT NULL,
  class               TEXT,
  phone               TEXT,
  status              TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Left', 'Enquiry', 'Demo', 'Cancelled')),
  details             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  joined_on           TEXT,
  left_on             TEXT,
  created_from        TEXT,
  created_from_client TEXT    UNIQUE,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, seq),
  CHECK (status <> 'Demo' OR kind = 'student')
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

-- 4. One record per full name.
UPDATE people
SET name = name || ' (' || code || ')',
    name_key = name_key || ' (' || lower(code) || ')',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status <> 'Cancelled'
  AND EXISTS (SELECT 1 FROM people q
              WHERE q.kind = people.kind AND q.name_key = people.name_key
                AND q.status <> 'Cancelled' AND q.id < people.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_one_name ON people (kind, name_key) WHERE status <> 'Cancelled';

-- Old enquiries about someone already in Students: link them to that student.
UPDATE entries
SET person_id = (SELECT p.id FROM people p
                 WHERE p.kind = 'student' AND p.name_key = lower(trim(entries.name))
                 ORDER BY p.status = 'Cancelled', p.id LIMIT 1)
WHERE type = 'enquiry' AND status = 'Active' AND person_id IS NULL AND trim(COALESCE(name, '')) <> '';

-- The others: one new student record per name, listed as an Enquiry.
INSERT INTO people (kind, seq, code, name, name_key, class, phone, status, details, created_from, created_from_client)
SELECT 'student', base.n + ROW_NUMBER() OVER (ORDER BY g.first_id),
       printf('STU-%04d', base.n + ROW_NUMBER() OVER (ORDER BY g.first_id)),
       trim(first.name), g.name_key, json_extract(first.data, '$.class'), first.phone, 'Enquiry',
       json_patch('{}', json_object(
         'parent_name', json_extract(first.data, '$.parent_name'),
         'email', json_extract(first.data, '$.email'),
         'school', json_extract(first.data, '$.school'),
         'subjects', json_extract(first.data, '$.subjects'))),
       first.code, first.client_id
FROM (SELECT MIN(id) AS first_id, lower(trim(name)) AS name_key FROM entries
      WHERE type = 'enquiry' AND status = 'Active' AND person_id IS NULL AND trim(COALESCE(name, '')) <> ''
      GROUP BY lower(trim(name))) AS g
JOIN entries AS first ON first.id = g.first_id
CROSS JOIN (SELECT COALESCE(MAX(seq), 0) AS n FROM people WHERE kind = 'student') AS base;

UPDATE entries
SET person_id = (SELECT p.id FROM people p
                 WHERE p.kind = 'student' AND p.name_key = lower(trim(entries.name)) AND p.status <> 'Cancelled')
WHERE type = 'enquiry' AND status = 'Active' AND person_id IS NULL AND trim(COALESCE(name, '')) <> '';
