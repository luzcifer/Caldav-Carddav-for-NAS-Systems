-- ChronoDAV MariaDB Schema (InnoDB, utf8mb4)
-- Verwenden Sie diese Struktur für Ihre bestehende MariaDB-Datenbank.
-- Hinweis: ChronoDAV erstellt fehlende Tabellen beim ersten Master-Connect automatisch.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  username VARCHAR(120) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  totp_secret VARCHAR(128) NULL,
  totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  preferred_theme VARCHAR(32) NOT NULL DEFAULT 'google',
  preferred_dark TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendars (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  color VARCHAR(32) NOT NULL DEFAULT '#1A73E8',
  description TEXT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_calendars_owner (owner_id),
  CONSTRAINT fk_calendars_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  uid VARCHAR(180) NOT NULL UNIQUE,
  calendar_id VARCHAR(64) NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  start_time VARCHAR(40) NOT NULL,
  end_time VARCHAR(40) NOT NULL,
  all_day TINYINT(1) NOT NULL DEFAULT 0,
  location VARCHAR(500) NULL,
  address_street VARCHAR(255) NULL,
  address_zip VARCHAR(40) NULL,
  address_city VARCHAR(160) NULL,
  address_country VARCHAR(120) NULL,
  address_lat DOUBLE NULL,
  address_lon DOUBLE NULL,
  color VARCHAR(32) NULL,
  recurrence_rule VARCHAR(255) NULL,
  etag VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_events_calendar (calendar_id),
  INDEX idx_events_owner (owner_id),
  INDEX idx_events_range (start_time, end_time),
  CONSTRAINT fk_events_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_shares (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  shared_with_user_id VARCHAR(64) NOT NULL,
  permission ENUM('view', 'edit') NOT NULL DEFAULT 'view',
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_event_share (event_id, shared_with_user_id),
  CONSTRAINT fk_shares_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_user FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contacts (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  uid VARCHAR(180) NOT NULL UNIQUE,
  owner_id VARCHAR(64) NOT NULL,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL DEFAULT '',
  display_name VARCHAR(240) NOT NULL,
  company VARCHAR(200) NULL,
  job_title VARCHAR(160) NULL,
  emails_json TEXT NOT NULL,
  phones_json TEXT NOT NULL,
  address_street VARCHAR(255) NULL,
  address_zip VARCHAR(40) NULL,
  address_city VARCHAR(160) NULL,
  address_country VARCHAR(120) NULL,
  address_lat DOUBLE NULL,
  address_lon DOUBLE NULL,
  birthday VARCHAR(32) NULL,
  notes TEXT NULL,
  labels_json TEXT NOT NULL,
  is_favorite TINYINT(1) NOT NULL DEFAULT 0,
  etag VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_contacts_owner (owner_id),
  INDEX idx_contacts_name (display_name),
  CONSTRAINT fk_contacts_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  uid VARCHAR(180) NOT NULL UNIQUE,
  owner_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  due_date VARCHAR(40) NULL,
  priority ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
  status ENUM('open', 'in_progress', 'done') NOT NULL DEFAULT 'open',
  linked_contact_id VARCHAR(64) NULL,
  linked_event_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_tasks_owner (owner_id),
  INDEX idx_tasks_status (status, due_date),
  CONSTRAINT fk_tasks_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attachments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  entity_type ENUM('event', 'contact', 'task') NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_attachments_entity (entity_type, entity_id),
  CONSTRAINT fk_attachments_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(120) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_log (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  synced_records INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
