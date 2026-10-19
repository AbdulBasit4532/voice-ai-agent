-- Patient registration schema (SQLite).
-- Timestamps are ISO-8601 UTC strings ("YYYY-MM-DDTHH:MM:SS.sssZ").
-- Dates (date_of_birth) are stored as ISO "YYYY-MM-DD" so they sort and compare correctly;
-- the API accepts and renders MM/DD/YYYY at the boundary.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  patient_id              TEXT PRIMARY KEY,                       -- UUID v4
  first_name              TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 50),
  last_name               TEXT NOT NULL CHECK (length(last_name)  BETWEEN 1 AND 50),
  date_of_birth           TEXT NOT NULL CHECK (date_of_birth GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sex                     TEXT NOT NULL CHECK (sex IN ('Male','Female','Other','Decline to Answer')),
  phone_number            TEXT NOT NULL CHECK (phone_number GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  email                   TEXT CHECK (email IS NULL OR email LIKE '%_@_%._%'),
  address_line_1          TEXT NOT NULL CHECK (length(address_line_1) BETWEEN 1 AND 200),
  address_line_2          TEXT CHECK (address_line_2 IS NULL OR length(address_line_2) <= 200),
  city                    TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 100),
  state                   TEXT NOT NULL CHECK (length(state) = 2 AND state = upper(state)),
  zip_code                TEXT NOT NULL CHECK (
                            zip_code GLOB '[0-9][0-9][0-9][0-9][0-9]'
                            OR zip_code GLOB '[0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'
                          ),
  insurance_provider      TEXT CHECK (insurance_provider IS NULL OR length(insurance_provider) <= 100),
  insurance_member_id     TEXT CHECK (insurance_member_id IS NULL OR insurance_member_id GLOB '*[A-Za-z0-9]*'),
  preferred_language      TEXT NOT NULL DEFAULT 'English',
  emergency_contact_name  TEXT CHECK (emergency_contact_name IS NULL OR length(emergency_contact_name) <= 100),
  emergency_contact_phone TEXT CHECK (
                            emergency_contact_phone IS NULL
                            OR emergency_contact_phone GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
                          ),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at              TEXT                                     -- soft delete marker
);

CREATE INDEX IF NOT EXISTS idx_patients_phone     ON patients (phone_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patients_last_name ON patients (lower(last_name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patients_dob       ON patients (date_of_birth) WHERE deleted_at IS NULL;

-- Keep updated_at honest regardless of which code path writes the row.
CREATE TRIGGER IF NOT EXISTS trg_patients_updated_at
AFTER UPDATE ON patients
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE patients
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE patient_id = NEW.patient_id;
END;

-- One row per phone call handled by the voice agent (bonus: transcript linked to patient).
CREATE TABLE IF NOT EXISTS call_logs (
  call_id        TEXT PRIMARY KEY,                                 -- provider call id (Vapi) or local uuid
  provider       TEXT NOT NULL DEFAULT 'vapi',
  patient_id     TEXT REFERENCES patients (patient_id) ON DELETE SET NULL,
  caller_number  TEXT,
  status         TEXT NOT NULL DEFAULT 'in-progress'
                   CHECK (status IN ('in-progress','completed','dropped','failed')),
  outcome        TEXT,                                             -- registered | updated | abandoned | error
  ended_reason   TEXT,
  summary        TEXT,
  transcript     TEXT,
  collected_data TEXT,                                             -- JSON of the final payload the agent attempted to save
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_call_logs_patient ON call_logs (patient_id);

-- Bonus: mock appointment scheduling offered after registration.
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL REFERENCES patients (patient_id) ON DELETE CASCADE,
  scheduled_for  TEXT NOT NULL,                                    -- ISO-8601 UTC
  provider_name  TEXT NOT NULL,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments (patient_id);
