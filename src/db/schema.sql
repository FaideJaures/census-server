CREATE TABLE IF NOT EXISTS users (
  login TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'supervisor', 'agent')),
  name TEXT NOT NULL,
  parent TEXT,
  province TEXT,
  province_name TEXT,
  regions TEXT DEFAULT '[]',
  children TEXT DEFAULT '[]',
  is_disabled INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignments (
  sd_code TEXT NOT NULL,
  operator_login TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (sd_code, operator_login),
  FOREIGN KEY (operator_login) REFERENCES users(login),
  FOREIGN KEY (assigned_by) REFERENCES users(login)
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (login) REFERENCES users(login)
);
CREATE INDEX IF NOT EXISTS idx_movements_login ON movements(login);
CREATE INDEX IF NOT EXISTS idx_movements_timestamp ON movements(timestamp);

CREATE TABLE IF NOT EXISTS habitations (
  id TEXT PRIMARY KEY,
  ilot_code TEXT,
  sd_code TEXT,
  building_number TEXT,
  local_number TEXT,
  form_data TEXT DEFAULT '{}',
  coordinates TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(login)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
  records_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'started',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_habitations_sd_code ON habitations(sd_code);
CREATE INDEX IF NOT EXISTS idx_habitations_created_by ON habitations(created_by);
CREATE INDEX IF NOT EXISTS idx_habitations_updated_at ON habitations(updated_at);
CREATE INDEX IF NOT EXISTS idx_assignments_operator ON assignments(operator_login);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  logged_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  FOREIGN KEY (login) REFERENCES users(login)
);

CREATE INDEX IF NOT EXISTS idx_activity_login ON activity_log(login);
CREATE INDEX IF NOT EXISTS idx_sync_log_login ON sync_log(login);
CREATE INDEX IF NOT EXISTS idx_sessions_login ON sessions(login);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  login TEXT NOT NULL,
  token TEXT NOT NULL PRIMARY KEY,
  expires_at TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  FOREIGN KEY (login) REFERENCES users(login)
);
CREATE TABLE IF NOT EXISTS sd_locks (
  sd_code TEXT PRIMARY KEY,
  locked_by TEXT,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (locked_by) REFERENCES users(login)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_login ON refresh_tokens(login);
