export type ThemeMode = 'google' | 'apple' | 'batman';
export type UserRole = 'admin' | 'user';
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in_progress' | 'done';
export type EntityType = 'event' | 'contact' | 'task';

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

export interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
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

export interface AttachmentItem {
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

export interface CalendarItem {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  description: string | null;
  is_default: number;
}

export interface EventShareItem {
  userId: string;
  permission: 'view' | 'edit';
  username?: string;
  displayName?: string;
}

export interface EventItem {
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
  sharedPermission: 'owner' | 'view' | 'edit';
  ownerName?: string;
  shares: EventShareItem[];
  attachments: AttachmentItem[];
}

export interface ContactLabeledValue {
  label: string;
  value: string;
}

export interface ContactItem {
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
  attachments: AttachmentItem[];
}

export interface TaskItem {
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
  attachments: AttachmentItem[];
}

export interface GeocodeResult {
  displayName: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface SyncInfo {
  username: string;
  baseUrl: string;
  davDiscoveryUrl: string;
  principalUrl: string;
  caldavUrl: string;
  carddavUrl: string;
  qrCodeDataUrl: string;
  carddavQrDataUrl: string;
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
