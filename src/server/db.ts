import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { newId, hashPassword } from './crypto.ts';
import {
  getEnvSmtpDefaults,
  sendDbFailoverAlert,
  sendDbRecoveryAlert,
} from './mailer.ts';
import type {
  AttachmentRecord,
  BackupFileInfo,
  CalendarRecord,
  ContactRecord,
  DbStatus,
  EntityType,
  EventRecord,
  EventShareInput,
  MariaDbConfig,
  SafeUser,
  SmtpConfig,
  SyncLogEntry,
  TaskRecord,
  ThemeMode,
  UserRecord,
  UserRole,
} from './types.ts';

export const FAILOVER_BANNER_TEXT =
  'Achtung DB nicht erreichbar, es wird auf SQLITE ( Backup ) zugegriffen';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const SQLITE_PATH = path.join(DATA_DIR, 'backup.sqlite');

function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function toMariaDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 23).replace('T', ' ');
  }
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

const SQLITE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  totp_secret TEXT NULL,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  preferred_theme TEXT NOT NULL DEFAULT 'google',
  preferred_dark INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1A73E8',
  description TEXT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  calendar_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT NULL,
  address_street TEXT NULL,
  address_zip TEXT NULL,
  address_city TEXT NULL,
  address_country TEXT NULL,
  address_lat REAL NULL,
  address_lon REAL NULL,
  color TEXT NULL,
  recurrence_rule TEXT NULL,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_shares (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  shared_with_user_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'view',
  created_at TEXT NOT NULL,
  UNIQUE(event_id, shared_with_user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  company TEXT NULL,
  job_title TEXT NULL,
  emails_json TEXT NOT NULL,
  phones_json TEXT NOT NULL,
  address_street TEXT NULL,
  address_zip TEXT NULL,
  address_city TEXT NULL,
  address_country TEXT NULL,
  address_lat REAL NULL,
  address_lon REAL NULL,
  birthday TEXT NULL,
  notes TEXT NULL,
  labels_json TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  due_date TEXT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  linked_contact_id TEXT NULL,
  linked_event_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  synced_records INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,
  queued_at TEXT NOT NULL
);
`;

const MARIADB_DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
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
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS calendars (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS events (
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
    CONSTRAINT fk_events_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
    CONSTRAINT fk_events_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS event_shares (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    shared_with_user_id VARCHAR(64) NOT NULL,
    permission ENUM('view', 'edit') NOT NULL DEFAULT 'view',
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_event_share (event_id, shared_with_user_id),
    CONSTRAINT fk_shares_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_shares_user FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS contacts (
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
    CONSTRAINT fk_contacts_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tasks (
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
    CONSTRAINT fk_tasks_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS attachments (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(120) NOT NULL PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sync_log (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    synced_records INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

class ChronoDatabase {
  public sqlite: Database.Database;
  private pool: mysql.Pool | null = null;
  private mariaReachable = false;
  private simulatedOutage = false;
  private lastError: string | null = null;
  private lastSyncAt: string | null = null;
  private lastBackupAt: string | null = null;
  private outageAlertSent = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private backupTimer: NodeJS.Timeout | null = null;

  constructor() {
    ensureDirs();
    this.sqlite = new Database(SQLITE_PATH);
    this.sqlite.exec(SQLITE_SCHEMA_SQL);
  }

  public async init(): Promise<void> {
    await this.autoProvisionEnvAdmin();
    await this.connectMariaDb();
    await this.createBackupSnapshot('startup');
    this.startTimers();
  }

  private startTimers(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.backupTimer) clearInterval(this.backupTimer);

    this.healthTimer = setInterval(() => {
      void this.checkMariaDbHealth();
    }, 15_000);

    const intervalMins = this.getBackupIntervalMinutes();
    this.backupTimer = setInterval(() => {
      void this.createBackupSnapshot('scheduled');
    }, Math.max(1, intervalMins) * 60_000);
  }

  public getBackupIntervalMinutes(): number {
    const saved = this.getSetting('backup_interval_minutes');
    const parsed = Number(saved || process.env.BACKUP_INTERVAL_MINUTES || 60);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 60;
  }

  public setBackupIntervalMinutes(minutes: number): void {
    const safe = Math.max(1, Math.min(1440, Math.round(minutes)));
    this.setSetting('backup_interval_minutes', String(safe));
    this.startTimers();
  }

  public getSetting(key: string): string | null {
    const row = this.sqlite
      .prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?')
      .get(key) as { setting_value: string } | undefined;
    return row ? row.setting_value : null;
  }

  public setSetting(key: string, value: string): void {
    const ts = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO app_settings (setting_key, setting_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
      )
      .run(key, value, ts);
  }

  public getMariaDbConfig(): MariaDbConfig {
    const savedJson = this.getSetting('mariadb_config');
    if (savedJson) {
      try {
        const parsed = JSON.parse(savedJson) as Partial<MariaDbConfig>;
        return {
          host: parsed.host || '',
          port: Number(parsed.port || 3306),
          user: parsed.user || '',
          password: parsed.password || '',
          database: parsed.database || 'chronodav',
        };
      } catch {
        // fallback to env
      }
    }
    return {
      host: process.env.MARIADB_HOST || '',
      port: Number(process.env.MARIADB_PORT || 3306),
      user: process.env.MARIADB_USER || '',
      password: process.env.MARIADB_PASSWORD || '',
      database: process.env.MARIADB_DATABASE || 'chronodav',
    };
  }

  public async saveMariaDbConfig(cfg: MariaDbConfig): Promise<DbStatus> {
    this.setSetting('mariadb_config', JSON.stringify(cfg));
    this.outageAlertSent = false;
    await this.connectMariaDb();
    return this.getDbStatus();
  }

  public getSmtpConfig(): SmtpConfig {
    const savedJson = this.getSetting('smtp_config');
    if (savedJson) {
      try {
        const parsed = JSON.parse(savedJson) as Partial<SmtpConfig>;
        return {
          ...getEnvSmtpDefaults(),
          ...parsed,
          port: Number(parsed.port || 587),
        };
      } catch {
        // ignore
      }
    }
    return getEnvSmtpDefaults();
  }

  public saveSmtpConfig(cfg: SmtpConfig): SmtpConfig {
    this.setSetting('smtp_config', JSON.stringify(cfg));
    return this.getSmtpConfig();
  }

  public isMariaConfigured(): boolean {
    const cfg = this.getMariaDbConfig();
    return Boolean(cfg.host.trim() && cfg.user.trim() && cfg.database.trim());
  }

  public async setSimulatedOutage(active: boolean): Promise<DbStatus> {
    this.simulatedOutage = active;
    if (active) {
      this.mariaReachable = false;
      this.lastError = 'Simulierter MariaDB-Verbindungsabbruch (Admin-Test)';
      this.addSyncLog('failover', `${FAILOVER_BANNER_TEXT} — Simulierter Ausfall aktiviert`, 0);
      if (!this.outageAlertSent) {
        this.outageAlertSent = true;
        void sendDbFailoverAlert(this.getSmtpConfig(), this.lastError);
      }
    } else {
      await this.checkMariaDbHealth();
    }
    return this.getDbStatus();
  }

  public async connectMariaDb(): Promise<boolean> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        // ignore
      }
      this.pool = null;
    }

    const cfg = this.getMariaDbConfig();
    if (!cfg.host.trim() || !cfg.user.trim() || !cfg.database.trim()) {
      this.mariaReachable = false;
      this.lastError = 'Keine MariaDB-Verbindungsdaten konfiguriert.';
      return false;
    }

    if (this.simulatedOutage) {
      this.mariaReachable = false;
      return false;
    }

    try {
      this.pool = mysql.createPool({
        host: cfg.host.trim(),
        port: Number(cfg.port) || 3306,
        user: cfg.user.trim(),
        password: cfg.password,
        database: cfg.database.trim(),
        waitForConnections: true,
        connectionLimit: 8,
        connectTimeout: 4000,
        charset: 'utf8mb4',
      });

      const conn = await this.pool.getConnection();
      try {
        for (const ddl of MARIADB_DDL_STATEMENTS) {
          await conn.query(ddl);
        }
      } finally {
        conn.release();
      }

      const wasDown = !this.mariaReachable;
      this.mariaReachable = true;
      this.lastError = null;
      this.outageAlertSent = false;

      if (wasDown) {
        const synced = await this.syncPendingToMaster();
        this.addSyncLog(
          'connected',
          `MariaDB-Master (${cfg.host}:${cfg.port}/${cfg.database}) verbunden. Struktur geprüft.`,
          synced,
        );
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.handleMariaFailure(msg);
      return false;
    }
  }

  public async checkMariaDbHealth(): Promise<boolean> {
    if (this.simulatedOutage) {
      this.mariaReachable = false;
      return false;
    }
    if (!this.isMariaConfigured()) {
      this.mariaReachable = false;
      return false;
    }
    if (!this.pool) {
      return this.connectMariaDb();
    }

    try {
      const conn = await this.pool.getConnection();
      try {
        await conn.ping();
      } finally {
        conn.release();
      }

      const recovering = !this.mariaReachable;
      this.mariaReachable = true;
      this.lastError = null;
      if (recovering || this.getPendingSyncCount() > 0) {
        const synced = await this.syncPendingToMaster();
        if (recovering) {
          this.outageAlertSent = false;
          this.addSyncLog('recovery', `MariaDB wieder erreichbar — Master-Sync abgeschlossen (${synced} Datensätze).`, synced);
          void sendDbRecoveryAlert(this.getSmtpConfig(), synced);
        }
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.handleMariaFailure(msg);
      return false;
    }
  }

  private handleMariaFailure(errMsg: string): void {
    const newlyDown = this.mariaReachable || !this.outageAlertSent;
    this.mariaReachable = false;
    this.lastError = errMsg;
    if (newlyDown) {
      this.addSyncLog('failover', `${FAILOVER_BANNER_TEXT} (${errMsg})`, 0);
      if (!this.outageAlertSent) {
        this.outageAlertSent = true;
        void sendDbFailoverAlert(this.getSmtpConfig(), errMsg);
      }
    }
  }

  public getPendingSyncCount(): number {
    const row = this.sqlite.prepare('SELECT COUNT(*) as cnt FROM sync_queue').get() as { cnt: number };
    return row.cnt;
  }

  public getDbStatus(): DbStatus {
    const online = this.mariaReachable && !this.simulatedOutage && this.pool !== null;
    return {
      mode: online ? 'mariadb' : 'sqlite_failover',
      mariadbConfigured: this.isMariaConfigured(),
      mariadbReachable: online,
      simulatedOutage: this.simulatedOutage,
      lastError: this.lastError,
      lastSyncAt: this.lastSyncAt,
      pendingSyncCount: this.getPendingSyncCount(),
      lastBackupAt: this.lastBackupAt,
      backupIntervalMinutes: this.getBackupIntervalMinutes(),
      failoverBanner: online ? null : FAILOVER_BANNER_TEXT,
    };
  }

  public addSyncLog(eventType: string, message: string, syncedRecords = 0): void {
    const entry: SyncLogEntry = {
      id: newId('log'),
      event_type: eventType,
      message,
      synced_records: syncedRecords,
      created_at: nowIso(),
    };
    this.sqlite
      .prepare('INSERT INTO sync_log (id, event_type, message, synced_records, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(entry.id, entry.event_type, entry.message, entry.synced_records, entry.created_at);
  }

  public getSyncLogs(limit = 30): SyncLogEntry[] {
    return this.sqlite
      .prepare('SELECT id, event_type, message, synced_records, created_at FROM sync_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as SyncLogEntry[];
  }

  private queueSync(tableName: string, recordId: string, action: 'upsert' | 'delete'): void {
    this.sqlite
      .prepare('INSERT INTO sync_queue (table_name, record_id, action, queued_at) VALUES (?, ?, ?, ?)')
      .run(tableName, recordId, action, nowIso());
  }

  public async syncPendingToMaster(): Promise<number> {
    if (!this.pool || !this.mariaReachable || this.simulatedOutage) {
      return 0;
    }

    let synced = 0;
    const queue = this.sqlite
      .prepare('SELECT seq, table_name, record_id, action FROM sync_queue ORDER BY seq ASC')
      .all() as Array<{ seq: number; table_name: string; record_id: string; action: 'upsert' | 'delete' }>;

    if (queue.length === 0) {
      // Initial baseline sync if MariaDB is empty (e.g. users created during offline bootstrap)
      const [rows] = await this.pool.query('SELECT COUNT(*) as cnt FROM users');
      const mariaUserCount = Number((rows as Array<{ cnt: number }>)[0]?.cnt || 0);
      const sqliteUserCount = (this.sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
      if (mariaUserCount === 0 && sqliteUserCount > 0) {
        synced += await this.pushAllSqliteToMaria();
      }
      this.lastSyncAt = nowIso();
      return synced;
    }

    for (const item of queue) {
      try {
        await this.syncSingleRecordToMaria(item.table_name, item.record_id, item.action);
        this.sqlite.prepare('DELETE FROM sync_queue WHERE seq = ?').run(item.seq);
        synced += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.handleMariaFailure(`Master-Sync fehlgeschlagen (${item.table_name}/${item.record_id}): ${msg}`);
        return synced;
      }
    }

    this.lastSyncAt = nowIso();
    return synced;
  }

  private async pushAllSqliteToMaria(): Promise<number> {
    if (!this.pool) return 0;
    let count = 0;
    const order = ['users', 'calendars', 'events', 'event_shares', 'contacts', 'tasks', 'attachments'];
    for (const table of order) {
      const rows = this.sqlite.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>;
      for (const row of rows) {
        await this.syncSingleRecordToMaria(table, row.id, 'upsert');
        count += 1;
      }
    }
    return count;
  }

  private async syncSingleRecordToMaria(
    tableName: string,
    recordId: string,
    action: 'upsert' | 'delete',
  ): Promise<void> {
    if (!this.pool) throw new Error('Kein MariaDB-Pool');

    if (action === 'delete') {
      const allowedTables = new Set([
        'users',
        'calendars',
        'events',
        'event_shares',
        'contacts',
        'tasks',
        'attachments',
      ]);
      if (!allowedTables.has(tableName)) return;
      await this.pool.execute(`DELETE FROM ${tableName} WHERE id = ?`, [recordId]);
      return;
    }

    switch (tableName) {
      case 'users': {
        const row = this.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(recordId) as UserRecord | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO users (id, username, display_name, email, password_hash, role, totp_secret, totp_enabled, preferred_theme, preferred_dark, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             username=VALUES(username), display_name=VALUES(display_name), email=VALUES(email),
             password_hash=VALUES(password_hash), role=VALUES(role), totp_secret=VALUES(totp_secret),
             totp_enabled=VALUES(totp_enabled), preferred_theme=VALUES(preferred_theme),
             preferred_dark=VALUES(preferred_dark), updated_at=VALUES(updated_at)`,
          [
            row.id,
            row.username,
            row.display_name,
            row.email,
            row.password_hash,
            row.role,
            row.totp_secret,
            row.totp_enabled,
            row.preferred_theme,
            row.preferred_dark,
            toMariaDateTime(row.created_at),
            toMariaDateTime(row.updated_at),
          ],
        );
        break;
      }
      case 'calendars': {
        const row = this.sqlite.prepare('SELECT * FROM calendars WHERE id = ?').get(recordId) as CalendarRecord | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO calendars (id, owner_id, name, color, description, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name=VALUES(name), color=VALUES(color), description=VALUES(description), is_default=VALUES(is_default), updated_at=VALUES(updated_at)`,
          [
            row.id,
            row.owner_id,
            row.name,
            row.color,
            row.description,
            row.is_default,
            toMariaDateTime(row.created_at),
            toMariaDateTime(row.updated_at),
          ],
        );
        break;
      }
      case 'events': {
        const row = this.sqlite.prepare('SELECT * FROM events WHERE id = ?').get(recordId) as EventRecord | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO events (id, uid, calendar_id, owner_id, title, description, start_time, end_time, all_day, location, address_street, address_zip, address_city, address_country, address_lat, address_lon, color, recurrence_rule, etag, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             calendar_id=VALUES(calendar_id), title=VALUES(title), description=VALUES(description),
             start_time=VALUES(start_time), end_time=VALUES(end_time), all_day=VALUES(all_day),
             location=VALUES(location), address_street=VALUES(address_street), address_zip=VALUES(address_zip),
             address_city=VALUES(address_city), address_country=VALUES(address_country),
             address_lat=VALUES(address_lat), address_lon=VALUES(address_lon),
             color=VALUES(color), recurrence_rule=VALUES(recurrence_rule), etag=VALUES(etag), updated_at=VALUES(updated_at)`,
          [
            row.id,
            row.uid,
            row.calendar_id,
            row.owner_id,
            row.title,
            row.description,
            row.start_time,
            row.end_time,
            row.all_day,
            row.location,
            row.address_street,
            row.address_zip,
            row.address_city,
            row.address_country,
            row.address_lat,
            row.address_lon,
            row.color,
            row.recurrence_rule,
            row.etag,
            toMariaDateTime(row.created_at),
            toMariaDateTime(row.updated_at),
          ],
        );
        break;
      }
      case 'event_shares': {
        const row = this.sqlite
          .prepare('SELECT * FROM event_shares WHERE id = ?')
          .get(recordId) as { id: string; event_id: string; shared_with_user_id: string; permission: string; created_at: string } | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO event_shares (id, event_id, shared_with_user_id, permission, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE permission=VALUES(permission)`,
          [row.id, row.event_id, row.shared_with_user_id, row.permission, toMariaDateTime(row.created_at)],
        );
        break;
      }
      case 'contacts': {
        const row = this.sqlite.prepare('SELECT * FROM contacts WHERE id = ?').get(recordId) as ContactRecord | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO contacts (id, uid, owner_id, first_name, last_name, display_name, company, job_title, emails_json, phones_json, address_street, address_zip, address_city, address_country, address_lat, address_lon, birthday, notes, labels_json, is_favorite, etag, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             first_name=VALUES(first_name), last_name=VALUES(last_name), display_name=VALUES(display_name),
             company=VALUES(company), job_title=VALUES(job_title), emails_json=VALUES(emails_json),
             phones_json=VALUES(phones_json), address_street=VALUES(address_street), address_zip=VALUES(address_zip),
             address_city=VALUES(address_city), address_country=VALUES(address_country),
             address_lat=VALUES(address_lat), address_lon=VALUES(address_lon),
             birthday=VALUES(birthday), notes=VALUES(notes), labels_json=VALUES(labels_json),
             is_favorite=VALUES(is_favorite), etag=VALUES(etag), updated_at=VALUES(updated_at)`,
          [
            row.id,
            row.uid,
            row.owner_id,
            row.first_name,
            row.last_name,
            row.display_name,
            row.company,
            row.job_title,
            row.emails_json,
            row.phones_json,
            row.address_street,
            row.address_zip,
            row.address_city,
            row.address_country,
            row.address_lat,
            row.address_lon,
            row.birthday,
            row.notes,
            row.labels_json,
            row.is_favorite,
            row.etag,
            toMariaDateTime(row.created_at),
            toMariaDateTime(row.updated_at),
          ],
        );
        break;
      }
      case 'tasks': {
        const row = this.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(recordId) as TaskRecord | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO tasks (id, uid, owner_id, title, description, due_date, priority, status, linked_contact_id, linked_event_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             title=VALUES(title), description=VALUES(description), due_date=VALUES(due_date),
             priority=VALUES(priority), status=VALUES(status), linked_contact_id=VALUES(linked_contact_id),
             linked_event_id=VALUES(linked_event_id), updated_at=VALUES(updated_at)`,
          [
            row.id,
            row.uid,
            row.owner_id,
            row.title,
            row.description,
            row.due_date,
            row.priority,
            row.status,
            row.linked_contact_id,
            row.linked_event_id,
            toMariaDateTime(row.created_at),
            toMariaDateTime(row.updated_at),
          ],
        );
        break;
      }
      case 'attachments': {
        const row = this.sqlite.prepare('SELECT * FROM attachments WHERE id = ?').get(recordId) as AttachmentRecord | undefined;
        if (!row) return;
        await this.pool.execute(
          `INSERT INTO attachments (id, owner_id, entity_type, entity_id, original_name, stored_name, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE original_name=VALUES(original_name)`,
          [
            row.id,
            row.owner_id,
            row.entity_type,
            row.entity_id,
            row.original_name,
            row.stored_name,
            row.mime_type,
            row.size_bytes,
            toMariaDateTime(row.created_at),
          ],
        );
        break;
      }
    }
  }

  private async replicateWrite(tableName: string, recordId: string, action: 'upsert' | 'delete'): Promise<void> {
    if (this.pool && this.mariaReachable && !this.simulatedOutage) {
      try {
        await this.syncSingleRecordToMaria(tableName, recordId, action);
        this.lastSyncAt = nowIso();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.handleMariaFailure(msg);
      }
    }
    this.queueSync(tableName, recordId, action);
  }

  public async createBackupSnapshot(reason: 'startup' | 'scheduled' | 'manual'): Promise<BackupFileInfo> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `chronodav_${reason}_${stamp}.sqlite`;
    const targetPath = path.join(BACKUPS_DIR, filename);
    await this.sqlite.backup(targetPath);
    this.lastBackupAt = nowIso();

    // Keep last 25 backup files to prevent unbounded disk growth
    const files = this.listBackupFiles();
    if (files.length > 25) {
      for (const old of files.slice(25)) {
        try {
          fs.unlinkSync(path.join(BACKUPS_DIR, old.filename));
        } catch {
          // ignore
        }
      }
    }
    const stat = fs.statSync(targetPath);
    return {
      filename,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  }

  public listBackupFiles(): BackupFileInfo[] {
    if (!fs.existsSync(BACKUPS_DIR)) return [];
    const entries = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.sqlite'));
    return entries
      .map((filename) => {
        const st = fs.statSync(path.join(BACKUPS_DIR, filename));
        return {
          filename,
          sizeBytes: st.size,
          createdAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async autoProvisionEnvAdmin(): Promise<void> {
    const envUser = process.env.ADMIN_USERNAME?.trim();
    const envPass = process.env.ADMIN_PASSWORD?.trim();
    if (!envUser || !envPass) return;

    const existing = this.sqlite.prepare('SELECT id FROM users WHERE username = ?').get(envUser);
    if (!existing) {
      await this.createUser({
        username: envUser,
        displayName: 'Administrator',
        email: process.env.ADMIN_EMAIL?.trim() || 'admin@localhost',
        password: envPass,
        role: 'admin',
      });
    }
  }

  // ==================== USER OPERATIONS ====================

  public countUsers(): number {
    const row = this.sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    return row.cnt;
  }

  public toSafeUser(u: UserRecord): SafeUser {
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      email: u.email,
      role: u.role,
      totpEnabled: Boolean(u.totp_enabled),
      preferredTheme: (u.preferred_theme || 'google') as ThemeMode,
      preferredDark: Boolean(u.preferred_dark),
      createdAt: u.created_at,
    };
  }

  public findUserByUsername(username: string): UserRecord | null {
    const row = this.sqlite
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username.trim()) as UserRecord | undefined;
    return row || null;
  }

  public findUserById(id: string): UserRecord | null {
    const row = this.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
    return row || null;
  }

  public listUsers(): SafeUser[] {
    const rows = this.sqlite.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRecord[];
    return rows.map((u) => this.toSafeUser(u));
  }

  public async createUser(input: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    role: UserRole;
  }): Promise<SafeUser> {
    const ts = nowIso();
    const id = newId('usr');
    const passwordHash = hashPassword(input.password);
    this.sqlite
      .prepare(
        `INSERT INTO users (id, username, display_name, email, password_hash, role, totp_secret, totp_enabled, preferred_theme, preferred_dark, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 'google', 1, ?, ?)`,
      )
      .run(id, input.username.trim(), input.displayName.trim(), input.email.trim(), passwordHash, input.role, ts, ts);

    await this.replicateWrite('users', id, 'upsert');

    // Create default calendar for user
    await this.createCalendar({
      ownerId: id,
      name: 'Mein Kalender',
      color: '#1A73E8',
      description: 'Persönlicher Hauptkalender',
      isDefault: true,
    });

    // Seed one helpful starter contact & task for newly bootstrapped first admin
    if (this.countUsers() === 1) {
      await this.seedStarterData(id);
    }

    const created = this.findUserById(id)!;
    return this.toSafeUser(created);
  }

  private async seedStarterData(ownerId: string): Promise<void> {
    const cal = this.sqlite
      .prepare('SELECT id FROM calendars WHERE owner_id = ? LIMIT 1')
      .get(ownerId) as { id: string } | undefined;

    if (cal) {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 0, 0);
      await this.createEvent({
        calendarId: cal.id,
        ownerId,
        title: 'CalDAV & CardDAV Sync einrichten',
        description: 'Mobile Endgeräte über QR-Code oder .mobileconfig verbinden.',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        allDay: false,
        location: 'Büro / Zentrale',
        color: '#1A73E8',
      });
    }

    await this.createContact({
      ownerId,
      firstName: 'Bruce',
      lastName: 'Wayne',
      company: 'Wayne Enterprises',
      jobTitle: 'Geschäftsführung',
      emails: [{ label: 'Arbeit', value: 'b.wayne@wayne-enterprises.example' }],
      phones: [{ label: 'Mobil', value: '+49 170 5550199' }],
      addressStreet: 'Wayne Tower Plaza 1',
      addressZip: '80331',
      addressCity: 'München',
      addressCountry: 'Deutschland',
      labels: ['VIP', 'Partner'],
      isFavorite: true,
    });

    await this.createTask({
      ownerId,
      title: 'MariaDB-Masterverbindung prüfen & Backup-Zeitplan testen',
      description: 'Sicherstellen, dass regelmäßige SQLite-Snapshots und E-Mail-Benachrichtigungen aktiv sind.',
      dueDate: new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10),
      priority: 'high',
      status: 'open',
    });
  }

  public async updateUser(
    id: string,
    patch: {
      displayName?: string;
      email?: string;
      role?: UserRole;
      password?: string;
      totpSecret?: string | null;
      totpEnabled?: boolean;
      preferredTheme?: ThemeMode;
      preferredDark?: boolean;
    },
  ): Promise<SafeUser | null> {
    const current = this.findUserById(id);
    if (!current) return null;

    const ts = nowIso();
    const displayName = patch.displayName ?? current.display_name;
    const email = patch.email ?? current.email;
    const role = patch.role ?? current.role;
    const passwordHash = patch.password ? hashPassword(patch.password) : current.password_hash;
    const totpSecret = patch.totpSecret !== undefined ? patch.totpSecret : current.totp_secret;
    const totpEnabled = patch.totpEnabled !== undefined ? (patch.totpEnabled ? 1 : 0) : current.totp_enabled;
    const preferredTheme = patch.preferredTheme ?? current.preferred_theme;
    const preferredDark = patch.preferredDark !== undefined ? (patch.preferredDark ? 1 : 0) : current.preferred_dark;

    this.sqlite
      .prepare(
        `UPDATE users SET display_name=?, email=?, role=?, password_hash=?, totp_secret=?, totp_enabled=?, preferred_theme=?, preferred_dark=?, updated_at=? WHERE id=?`,
      )
      .run(displayName, email, role, passwordHash, totpSecret, totpEnabled, preferredTheme, preferredDark, ts, id);

    await this.replicateWrite('users', id, 'upsert');
    return this.toSafeUser(this.findUserById(id)!);
  }

  public async deleteUser(id: string): Promise<boolean> {
    const res = this.sqlite.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (res.changes > 0) {
      await this.replicateWrite('users', id, 'delete');
      return true;
    }
    return false;
  }

  // ==================== CALENDARS & EVENTS ====================

  public listCalendars(userId: string): CalendarRecord[] {
    return this.sqlite
      .prepare('SELECT * FROM calendars WHERE owner_id = ? ORDER BY is_default DESC, name ASC')
      .all(userId) as CalendarRecord[];
  }

  public getCalendarById(id: string): CalendarRecord | null {
    return (this.sqlite.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as CalendarRecord | undefined) || null;
  }

  public async createCalendar(input: {
    ownerId: string;
    name: string;
    color?: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<CalendarRecord> {
    const id = newId('cal');
    const ts = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO calendars (id, owner_id, name, color, description, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.ownerId, input.name.trim(), input.color || '#1A73E8', input.description || null, input.isDefault ? 1 : 0, ts, ts);
    await this.replicateWrite('calendars', id, 'upsert');
    return this.getCalendarById(id)!;
  }

  public listEventsForUser(userId: string): Array<EventRecord & { sharedPermission: 'owner' | 'view' | 'edit'; ownerName: string; shares: EventShareInput[] }> {
    const rows = this.sqlite
      .prepare(
        `SELECT DISTINCT e.*,
          CASE WHEN e.owner_id = ? THEN 'owner' ELSE es.permission END AS sharedPermission,
          u.display_name AS ownerName
         FROM events e
         JOIN users u ON u.id = e.owner_id
         LEFT JOIN event_shares es ON es.event_id = e.id AND es.shared_with_user_id = ?
         WHERE e.owner_id = ? OR es.shared_with_user_id = ?
         ORDER BY e.start_time ASC`,
      )
      .all(userId, userId, userId, userId) as Array<EventRecord & { sharedPermission: 'owner' | 'view' | 'edit'; ownerName: string }>;

    return rows.map((ev) => ({
      ...ev,
      shares: this.getEventShares(ev.id),
    }));
  }

  public getEventShares(eventId: string): EventShareInput[] {
    return this.sqlite
      .prepare(
        `SELECT es.shared_with_user_id AS userId, es.permission, u.username, u.display_name AS displayName
         FROM event_shares es
         JOIN users u ON u.id = es.shared_with_user_id
         WHERE es.event_id = ?`,
      )
      .all(eventId) as EventShareInput[];
  }

  public getEventById(id: string): EventRecord | null {
    return (this.sqlite.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRecord | undefined) || null;
  }

  public getEventByUid(uid: string): EventRecord | null {
    return (this.sqlite.prepare('SELECT * FROM events WHERE uid = ?').get(uid) as EventRecord | undefined) || null;
  }

  public canUserAccessEvent(userId: string, eventId: string): 'owner' | 'edit' | 'view' | null {
    const ev = this.getEventById(eventId);
    if (!ev) return null;
    if (ev.owner_id === userId) return 'owner';
    const share = this.sqlite
      .prepare('SELECT permission FROM event_shares WHERE event_id = ? AND shared_with_user_id = ?')
      .get(eventId, userId) as { permission: 'view' | 'edit' } | undefined;
    return share ? share.permission : null;
  }

  public async createEvent(input: {
    calendarId: string;
    ownerId: string;
    uid?: string;
    title: string;
    description?: string | null;
    startTime: string;
    endTime: string;
    allDay?: boolean;
    location?: string | null;
    addressStreet?: string | null;
    addressZip?: string | null;
    addressCity?: string | null;
    addressCountry?: string | null;
    addressLat?: number | null;
    addressLon?: number | null;
    color?: string | null;
    recurrenceRule?: string | null;
    shares?: EventShareInput[];
  }): Promise<EventRecord> {
    const id = newId('evt');
    const uid = input.uid || `${id}@chronodav.local`;
    const ts = nowIso();
    const etag = `"${newId('etag')}"`;

    this.sqlite
      .prepare(
        `INSERT INTO events (id, uid, calendar_id, owner_id, title, description, start_time, end_time, all_day, location, address_street, address_zip, address_city, address_country, address_lat, address_lon, color, recurrence_rule, etag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        uid,
        input.calendarId,
        input.ownerId,
        input.title.trim(),
        input.description ?? null,
        input.startTime,
        input.endTime,
        input.allDay ? 1 : 0,
        input.location ?? null,
        input.addressStreet ?? null,
        input.addressZip ?? null,
        input.addressCity ?? null,
        input.addressCountry ?? null,
        input.addressLat ?? null,
        input.addressLon ?? null,
        input.color ?? null,
        input.recurrenceRule ?? null,
        etag,
        ts,
        ts,
      );

    await this.replicateWrite('events', id, 'upsert');

    if (input.shares && input.shares.length > 0) {
      await this.replaceEventShares(id, input.ownerId, input.shares);
    }

    return this.getEventById(id)!;
  }

  public async updateEvent(
    id: string,
    patch: {
      calendarId?: string;
      title?: string;
      description?: string | null;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      location?: string | null;
      addressStreet?: string | null;
      addressZip?: string | null;
      addressCity?: string | null;
      addressCountry?: string | null;
      addressLat?: number | null;
      addressLon?: number | null;
      color?: string | null;
      recurrenceRule?: string | null;
      shares?: EventShareInput[];
    },
  ): Promise<EventRecord | null> {
    const cur = this.getEventById(id);
    if (!cur) return null;
    const ts = nowIso();
    const etag = `"${newId('etag')}"`;

    this.sqlite
      .prepare(
        `UPDATE events SET
          calendar_id=?, title=?, description=?, start_time=?, end_time=?, all_day=?,
          location=?, address_street=?, address_zip=?, address_city=?, address_country=?,
          address_lat=?, address_lon=?, color=?, recurrence_rule=?, etag=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        patch.calendarId ?? cur.calendar_id,
        patch.title !== undefined ? patch.title.trim() : cur.title,
        patch.description !== undefined ? patch.description : cur.description,
        patch.startTime ?? cur.start_time,
        patch.endTime ?? cur.end_time,
        patch.allDay !== undefined ? (patch.allDay ? 1 : 0) : cur.all_day,
        patch.location !== undefined ? patch.location : cur.location,
        patch.addressStreet !== undefined ? patch.addressStreet : cur.address_street,
        patch.addressZip !== undefined ? patch.addressZip : cur.address_zip,
        patch.addressCity !== undefined ? patch.addressCity : cur.address_city,
        patch.addressCountry !== undefined ? patch.addressCountry : cur.address_country,
        patch.addressLat !== undefined ? patch.addressLat : cur.address_lat,
        patch.addressLon !== undefined ? patch.addressLon : cur.address_lon,
        patch.color !== undefined ? patch.color : cur.color,
        patch.recurrenceRule !== undefined ? patch.recurrenceRule : cur.recurrence_rule,
        etag,
        ts,
        id,
      );

    await this.replicateWrite('events', id, 'upsert');

    if (patch.shares !== undefined) {
      await this.replaceEventShares(id, cur.owner_id, patch.shares);
    }

    return this.getEventById(id);
  }

  public async replaceEventShares(eventId: string, ownerId: string, shares: EventShareInput[]): Promise<void> {
    const existing = this.sqlite
      .prepare('SELECT id FROM event_shares WHERE event_id = ?')
      .all(eventId) as Array<{ id: string }>;

    this.sqlite.prepare('DELETE FROM event_shares WHERE event_id = ?').run(eventId);
    for (const ex of existing) {
      await this.replicateWrite('event_shares', ex.id, 'delete');
    }

    const ts = nowIso();
    for (const s of shares) {
      if (!s.userId || s.userId === ownerId) continue;
      const targetUser = this.findUserById(s.userId);
      if (!targetUser) continue;
      const shareId = newId('shr');
      this.sqlite
        .prepare(
          'INSERT INTO event_shares (id, event_id, shared_with_user_id, permission, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(shareId, eventId, s.userId, s.permission === 'edit' ? 'edit' : 'view', ts);
      await this.replicateWrite('event_shares', shareId, 'upsert');
    }
  }

  public async deleteEvent(id: string): Promise<boolean> {
    const res = this.sqlite.prepare('DELETE FROM events WHERE id = ?').run(id);
    if (res.changes > 0) {
      await this.replicateWrite('events', id, 'delete');
      return true;
    }
    return false;
  }

  // ==================== CONTACTS ====================

  public listContacts(ownerId: string): ContactRecord[] {
    return this.sqlite
      .prepare('SELECT * FROM contacts WHERE owner_id = ? ORDER BY is_favorite DESC, display_name ASC')
      .all(ownerId) as ContactRecord[];
  }

  public getContactById(id: string): ContactRecord | null {
    return (this.sqlite.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRecord | undefined) || null;
  }

  public getContactByUid(uid: string): ContactRecord | null {
    return (this.sqlite.prepare('SELECT * FROM contacts WHERE uid = ?').get(uid) as ContactRecord | undefined) || null;
  }

  public async createContact(input: {
    ownerId: string;
    uid?: string;
    firstName: string;
    lastName?: string;
    company?: string | null;
    jobTitle?: string | null;
    emails?: Array<{ label: string; value: string }>;
    phones?: Array<{ label: string; value: string }>;
    addressStreet?: string | null;
    addressZip?: string | null;
    addressCity?: string | null;
    addressCountry?: string | null;
    addressLat?: number | null;
    addressLon?: number | null;
    birthday?: string | null;
    notes?: string | null;
    labels?: string[];
    isFavorite?: boolean;
  }): Promise<ContactRecord> {
    const id = newId('cnt');
    const uid = input.uid || `${id}@chronodav.local`;
    const first = input.firstName.trim();
    const last = (input.lastName || '').trim();
    const displayName = `${first} ${last}`.trim() || input.company?.trim() || 'Unbenannt';
    const ts = nowIso();
    const etag = `"${newId('etag')}"`;

    this.sqlite
      .prepare(
        `INSERT INTO contacts (id, uid, owner_id, first_name, last_name, display_name, company, job_title, emails_json, phones_json, address_street, address_zip, address_city, address_country, address_lat, address_lon, birthday, notes, labels_json, is_favorite, etag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        uid,
        input.ownerId,
        first,
        last,
        displayName,
        input.company ?? null,
        input.jobTitle ?? null,
        JSON.stringify(input.emails || []),
        JSON.stringify(input.phones || []),
        input.addressStreet ?? null,
        input.addressZip ?? null,
        input.addressCity ?? null,
        input.addressCountry ?? null,
        input.addressLat ?? null,
        input.addressLon ?? null,
        input.birthday ?? null,
        input.notes ?? null,
        JSON.stringify(input.labels || []),
        input.isFavorite ? 1 : 0,
        etag,
        ts,
        ts,
      );

    await this.replicateWrite('contacts', id, 'upsert');
    return this.getContactById(id)!;
  }

  public async updateContact(
    id: string,
    patch: {
      firstName?: string;
      lastName?: string;
      company?: string | null;
      jobTitle?: string | null;
      emails?: Array<{ label: string; value: string }>;
      phones?: Array<{ label: string; value: string }>;
      addressStreet?: string | null;
      addressZip?: string | null;
      addressCity?: string | null;
      addressCountry?: string | null;
      addressLat?: number | null;
      addressLon?: number | null;
      birthday?: string | null;
      notes?: string | null;
      labels?: string[];
      isFavorite?: boolean;
    },
  ): Promise<ContactRecord | null> {
    const cur = this.getContactById(id);
    if (!cur) return null;
    const first = patch.firstName !== undefined ? patch.firstName.trim() : cur.first_name;
    const last = patch.lastName !== undefined ? patch.lastName.trim() : cur.last_name;
    const company = patch.company !== undefined ? patch.company : cur.company;
    const displayName = `${first} ${last}`.trim() || company || 'Unbenannt';
    const ts = nowIso();
    const etag = `"${newId('etag')}"`;

    this.sqlite
      .prepare(
        `UPDATE contacts SET
          first_name=?, last_name=?, display_name=?, company=?, job_title=?,
          emails_json=?, phones_json=?, address_street=?, address_zip=?, address_city=?,
          address_country=?, address_lat=?, address_lon=?, birthday=?, notes=?,
          labels_json=?, is_favorite=?, etag=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        first,
        last,
        displayName,
        company,
        patch.jobTitle !== undefined ? patch.jobTitle : cur.job_title,
        patch.emails !== undefined ? JSON.stringify(patch.emails) : cur.emails_json,
        patch.phones !== undefined ? JSON.stringify(patch.phones) : cur.phones_json,
        patch.addressStreet !== undefined ? patch.addressStreet : cur.address_street,
        patch.addressZip !== undefined ? patch.addressZip : cur.address_zip,
        patch.addressCity !== undefined ? patch.addressCity : cur.address_city,
        patch.addressCountry !== undefined ? patch.addressCountry : cur.address_country,
        patch.addressLat !== undefined ? patch.addressLat : cur.address_lat,
        patch.addressLon !== undefined ? patch.addressLon : cur.address_lon,
        patch.birthday !== undefined ? patch.birthday : cur.birthday,
        patch.notes !== undefined ? patch.notes : cur.notes,
        patch.labels !== undefined ? JSON.stringify(patch.labels) : cur.labels_json,
        patch.isFavorite !== undefined ? (patch.isFavorite ? 1 : 0) : cur.is_favorite,
        etag,
        ts,
        id,
      );

    await this.replicateWrite('contacts', id, 'upsert');
    return this.getContactById(id);
  }

  public async deleteContact(id: string): Promise<boolean> {
    const res = this.sqlite.prepare('DELETE FROM contacts WHERE id = ?').run(id);
    if (res.changes > 0) {
      await this.replicateWrite('contacts', id, 'delete');
      return true;
    }
    return false;
  }

  // ==================== TASKS ====================

  public listTasks(ownerId: string): TaskRecord[] {
    return this.sqlite
      .prepare(
        `SELECT * FROM tasks WHERE owner_id = ?
         ORDER BY CASE status WHEN 'done' THEN 2 WHEN 'in_progress' THEN 0 ELSE 1 END,
                  CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                  due_date ASC`,
      )
      .all(ownerId) as TaskRecord[];
  }

  public getTaskById(id: string): TaskRecord | null {
    return (this.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRecord | undefined) || null;
  }

  public async createTask(input: {
    ownerId: string;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: 'high' | 'medium' | 'low';
    status?: 'open' | 'in_progress' | 'done';
    linkedContactId?: string | null;
    linkedEventId?: string | null;
  }): Promise<TaskRecord> {
    const id = newId('tsk');
    const uid = `${id}@chronodav.local`;
    const ts = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO tasks (id, uid, owner_id, title, description, due_date, priority, status, linked_contact_id, linked_event_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        uid,
        input.ownerId,
        input.title.trim(),
        input.description ?? null,
        input.dueDate ?? null,
        input.priority || 'medium',
        input.status || 'open',
        input.linkedContactId ?? null,
        input.linkedEventId ?? null,
        ts,
        ts,
      );

    await this.replicateWrite('tasks', id, 'upsert');
    return this.getTaskById(id)!;
  }

  public async updateTask(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      priority?: 'high' | 'medium' | 'low';
      status?: 'open' | 'in_progress' | 'done';
      linkedContactId?: string | null;
      linkedEventId?: string | null;
    },
  ): Promise<TaskRecord | null> {
    const cur = this.getTaskById(id);
    if (!cur) return null;
    const ts = nowIso();

    this.sqlite
      .prepare(
        `UPDATE tasks SET title=?, description=?, due_date=?, priority=?, status=?, linked_contact_id=?, linked_event_id=?, updated_at=? WHERE id=?`,
      )
      .run(
        patch.title !== undefined ? patch.title.trim() : cur.title,
        patch.description !== undefined ? patch.description : cur.description,
        patch.dueDate !== undefined ? patch.dueDate : cur.due_date,
        patch.priority ?? cur.priority,
        patch.status ?? cur.status,
        patch.linkedContactId !== undefined ? patch.linkedContactId : cur.linked_contact_id,
        patch.linkedEventId !== undefined ? patch.linkedEventId : cur.linked_event_id,
        ts,
        id,
      );

    await this.replicateWrite('tasks', id, 'upsert');
    return this.getTaskById(id);
  }

  public async deleteTask(id: string): Promise<boolean> {
    const res = this.sqlite.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (res.changes > 0) {
      await this.replicateWrite('tasks', id, 'delete');
      return true;
    }
    return false;
  }

  // ==================== ATTACHMENTS ====================

  public listAttachments(entityType: EntityType, entityId: string): AttachmentRecord[] {
    return this.sqlite
      .prepare('SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC')
      .all(entityType, entityId) as AttachmentRecord[];
  }

  public getAttachmentById(id: string): AttachmentRecord | null {
    return (this.sqlite.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRecord | undefined) || null;
  }

  public async createAttachment(input: {
    ownerId: string;
    entityType: EntityType;
    entityId: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<AttachmentRecord> {
    const id = newId('att');
    const ts = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO attachments (id, owner_id, entity_type, entity_id, original_name, stored_name, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.ownerId,
        input.entityType,
        input.entityId,
        input.originalName,
        input.storedName,
        input.mimeType,
        input.sizeBytes,
        ts,
      );
    await this.replicateWrite('attachments', id, 'upsert');
    return this.getAttachmentById(id)!;
  }

  public async deleteAttachment(id: string): Promise<boolean> {
    const att = this.getAttachmentById(id);
    if (!att) return false;
    const res = this.sqlite.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    if (res.changes > 0) {
      const filePath = path.resolve(UPLOADS_DIR, att.stored_name);
      if (filePath.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
      await this.replicateWrite('attachments', id, 'delete');
      return true;
    }
    return false;
  }
}

export const db = new ChronoDatabase();
