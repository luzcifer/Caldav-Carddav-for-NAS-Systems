export type UserRole = 'admin' | 'user';
export type ThemeMode = 'google' | 'apple' | 'batman';
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in_progress' | 'done';
export type SharePermission = 'view' | 'edit';
export type EntityType = 'event' | 'contact' | 'task';

export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  totp_secret: string | null;
  totp_enabled: number;
  preferred_theme: ThemeMode;
  preferred_dark: number;
  created_at: string;
  updated_at: string;
}

export interface SafeUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  totpEnabled: boolean;
  preferredTheme: ThemeMode;
  preferredDark: boolean;
  createdAt: string;
}

export interface CalendarRecord {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  description: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface EventShareInput {
  userId: string;
  permission: SharePermission;
  username?: string;
  displayName?: string;
}

export interface EventRecord {
  id: string;
  uid: string;
  calendar_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  all_day: number;
  location: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
  address_lat: number | null;
  address_lon: number | null;
  color: string | null;
  recurrence_rule: string | null;
  etag: string;
  created_at: string;
  updated_at: string;
}

export interface ContactRecord {
  id: string;
  uid: string;
  owner_id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  company: string | null;
  job_title: string | null;
  emails_json: string;
  phones_json: string;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
  address_lat: number | null;
  address_lon: number | null;
  birthday: string | null;
  notes: string | null;
  labels_json: string;
  is_favorite: number;
  etag: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  uid: string;
  owner_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  linked_contact_id: string | null;
  linked_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttachmentRecord {
  id: string;
  owner_id: string;
  entity_type: EntityType;
  entity_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface MariaDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  alertTo: string;
}

export interface DbStatus {
  mode: 'mariadb' | 'sqlite_failover';
  mariadbConfigured: boolean;
  mariadbReachable: boolean;
  simulatedOutage: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  pendingSyncCount: number;
  lastBackupAt: string | null;
  backupIntervalMinutes: number;
  failoverBanner: string | null;
}

export interface SyncLogEntry {
  id: string;
  event_type: string;
  message: string;
  synced_records: number;
  created_at: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}
