-- SuccessPath Classes, version 3.1: leave requests from the teacher portal, two-way messages between
-- teachers and students, and the notification bell.
-- Applied with: npm run db:setup
--
-- Messages stay ordinary entries (MSG-0001 ...), in both directions. portal_reads remembers, for each
-- reader, what they have already seen: the bell, and each conversation. It is the only table here
-- whose rows change freely, because it holds no records, only "seen up to here".
--
-- A request waits as Pending until the office approves or declines it (or the teacher withdraws it).
-- Approving it saves an ordinary Teacher leave entry (LVE-....), so the leave calendar, the teacher's
-- page and the Teacher Leave tab of the Google Sheet show it as before. Requests are never deleted,
-- and every change is kept in leave_request_history.

CREATE TABLE IF NOT EXISTS leave_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seq           INTEGER NOT NULL UNIQUE,
  code          TEXT    NOT NULL UNIQUE,                  -- LRQ-0001
  person_id     INTEGER NOT NULL REFERENCES people(id),   -- the teacher
  from_date     TEXT    NOT NULL,
  to_date       TEXT    NOT NULL,
  reason        TEXT,
  notes         TEXT,
  status        TEXT    NOT NULL DEFAULT 'Pending'
                CHECK (status IN ('Pending', 'Approved', 'Declined', 'Withdrawn')),
  decided_by    TEXT,
  decided_at    TEXT,
  decision_note TEXT,
  leave_code    TEXT,                                     -- the Teacher leave entry made when approved
  client_id     TEXT    NOT NULL UNIQUE,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (status, from_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_person ON leave_requests (person_id, from_date);

CREATE TABLE IF NOT EXISTS leave_request_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  action     TEXT    NOT NULL,
  snapshot   TEXT    NOT NULL,
  at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS leave_requests_log_insert
AFTER INSERT ON leave_requests
BEGIN
  INSERT INTO leave_request_history (request_id, action, snapshot)
  VALUES (NEW.id, 'asked', json_object(
    'code', NEW.code, 'person_id', NEW.person_id, 'from', NEW.from_date, 'to', NEW.to_date,
    'reason', NEW.reason, 'notes', NEW.notes, 'status', NEW.status, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS leave_requests_log_update
AFTER UPDATE ON leave_requests
BEGIN
  INSERT INTO leave_request_history (request_id, action, snapshot)
  VALUES (NEW.id, lower(NEW.status), json_object(
    'code', NEW.code, 'person_id', NEW.person_id, 'from', NEW.from_date, 'to', NEW.to_date,
    'reason', NEW.reason, 'notes', NEW.notes, 'status', NEW.status, 'decided_by', NEW.decided_by,
    'decided_at', NEW.decided_at, 'decision_note', NEW.decision_note, 'leave_code', NEW.leave_code,
    'updated_at', NEW.updated_at));
END;

CREATE TRIGGER IF NOT EXISTS leave_requests_no_delete
BEFORE DELETE ON leave_requests
BEGIN
  SELECT RAISE(ABORT, 'Leave requests cannot be deleted. Withdraw or decline them instead.');
END;

CREATE TRIGGER IF NOT EXISTS leave_requests_fixed
BEFORE UPDATE OF id, seq, code, person_id, from_date, to_date, client_id, created_at ON leave_requests
WHEN NEW.id IS NOT OLD.id OR NEW.seq IS NOT OLD.seq OR NEW.code IS NOT OLD.code OR NEW.person_id IS NOT OLD.person_id
  OR NEW.from_date IS NOT OLD.from_date OR NEW.to_date IS NOT OLD.to_date OR NEW.client_id IS NOT OLD.client_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'A leave request keeps its teacher and dates. Ask again instead.');
END;

CREATE TRIGGER IF NOT EXISTS leave_request_history_no_change
BEFORE UPDATE ON leave_request_history
BEGIN
  SELECT RAISE(ABORT, 'History cannot be changed.');
END;

CREATE TRIGGER IF NOT EXISTS leave_request_history_no_delete
BEFORE DELETE ON leave_request_history
BEGIN
  SELECT RAISE(ABORT, 'History cannot be deleted.');
END;

CREATE TABLE IF NOT EXISTS portal_reads (
  reader     TEXT    NOT NULL,          -- 'office', or a person code such as TR-0001 or STU-0003
  topic      TEXT    NOT NULL,          -- 'notices' (the bell), or 'chat:<code>' for a conversation
  last_id    INTEGER NOT NULL DEFAULT 0, -- the last message (entry id) read in a conversation
  last_at    TEXT,                       -- when the bell was last opened
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (reader, topic)
);

-- Conversations are found by student (person_id) and teacher (teacher_code), newest first.
CREATE INDEX IF NOT EXISTS idx_entries_portal_person ON entries (person_id, id) WHERE type = 'portal_message';
