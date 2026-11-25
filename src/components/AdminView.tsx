import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  Download,
  HardDriveDownload,
  Mail,
  Plus,
  RefreshCw,
  Send,
  ShieldOff,
  Trash2,
  Users,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { BackupFileInfo, DbStatus, SafeUser, SyncLogEntry, UserRole } from '../types';

type AdminTab = 'users' | 'database' | 'backups' | 'smtp';

interface AdminViewProps {
  currentUser: SafeUser;
  onDbStatusChanged: (status: DbStatus) => void;
  onUsersChanged: () => Promise<void>;
}

export function AdminView({ currentUser, onDbStatusChanged, onUsersChanged }: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [mariaCfg, setMariaCfg] = useState({
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: 'chronodav',
  });
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [schemaSql, setSchemaSql] = useState('');
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [backupInterval, setBackupInterval] = useState(60);
  const [smtpCfg, setSmtpCfg] = useState({
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
    alertTo: '',
  });

  // New user form
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedSchema, setCopiedSchema] = useState(false);

  async function loadAll() {
    const [uRes, dRes, bRes, sRes] = await Promise.all([
      apiRequest<{ users: SafeUser[] }>('/admin/users'),
      apiRequest<{
        dbStatus: DbStatus;
        mariadbConfig: { host: string; port: number; user: string; password: string; database: string };
        syncLogs: SyncLogEntry[];
        schemaSql: string;
      }>('/admin/db'),
      apiRequest<{ backups: BackupFileInfo[]; intervalMinutes: number }>('/admin/backups'),
      apiRequest<{
        smtpConfig: {
          enabled: boolean;
          host: string;
          port: number;
          secure: boolean;
          user: string;
          pass: string;
          from: string;
          alertTo: string;
        };
      }>('/admin/smtp'),
    ]);

    setUsers(uRes.users);
    setDbStatus(dRes.dbStatus);
    onDbStatusChanged(dRes.dbStatus);
    setMariaCfg(dRes.mariadbConfig);
    setSyncLogs(dRes.syncLogs);
    setSchemaSql(dRes.schemaSql);
    setBackups(bRes.backups);
    setBackupInterval(bRes.intervalMinutes);
    setSmtpCfg(sRes.smtpConfig);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await apiRequest('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          displayName: newDisplayName,
          email: newEmail,
          password: newPassword,
          role: newRole,
        }),
      });
      setNewUsername('');
      setNewDisplayName('');
      setNewEmail('');
      setNewPassword('');
      setNotice('Benutzer wurde angelegt.');
      await loadAll();
      await onUsersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Anlegen');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleRole(u: SafeUser) {
    const nextRole: UserRole = u.role === 'admin' ? 'user' : 'admin';
    await apiRequest(`/admin/users/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ role: nextRole }),
    });
    await loadAll();
    await onUsersChanged();
  }

  async function handleReset2fa(u: SafeUser) {
    await apiRequest(`/admin/users/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ reset2fa: true }),
    });
    setNotice(`2FA für ${u.username} zurückgesetzt.`);
    await loadAll();
  }

  async function handleDeleteUser(u: SafeUser) {
    setError(null);
    try {
      await apiRequest(`/admin/users/${u.id}`, { method: 'DELETE' });
      await loadAll();
      await onUsersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  async function handleSaveMariaDb(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ dbStatus: DbStatus; syncLogs: SyncLogEntry[] }>('/admin/db/config', {
        method: 'PUT',
        body: JSON.stringify(mariaCfg),
      });
      setDbStatus(res.dbStatus);
      setSyncLogs(res.syncLogs);
      onDbStatusChanged(res.dbStatus);
      setNotice(
        res.dbStatus.mariadbReachable
          ? 'MariaDB-Master verbunden und Tabellenstruktur geprüft.'
          : 'Einstellungen gespeichert — MariaDB aktuell nicht erreichbar (SQLite-Backup aktiv).',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function handleTestDb() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiRequest<{ dbStatus: DbStatus; syncLogs: SyncLogEntry[] }>('/admin/db/test', {
        method: 'POST',
      });
      setDbStatus(res.dbStatus);
      setSyncLogs(res.syncLogs);
      onDbStatusChanged(res.dbStatus);
      setNotice(res.dbStatus.mariadbReachable ? 'MariaDB-Verbindung erfolgreich!' : `Verbindung fehlgeschlagen: ${res.dbStatus.lastError || ''}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleManualSync() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiRequest<{ synced: number; dbStatus: DbStatus; syncLogs: SyncLogEntry[] }>('/admin/db/sync', {
        method: 'POST',
      });
      setDbStatus(res.dbStatus);
      setSyncLogs(res.syncLogs);
      onDbStatusChanged(res.dbStatus);
      setNotice(`Master-Sync abgeschlossen: ${res.synced} Datensätze abgeglichen.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleOutage() {
    if (!dbStatus) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ dbStatus: DbStatus; syncLogs: SyncLogEntry[] }>('/admin/db/simulate-outage', {
        method: 'POST',
        body: JSON.stringify({ active: !dbStatus.simulatedOutage }),
      });
      setDbStatus(res.dbStatus);
      setSyncLogs(res.syncLogs);
      onDbStatusChanged(res.dbStatus);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunBackup() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiRequest<{ backup: BackupFileInfo; backups: BackupFileInfo[] }>('/admin/backups/run', {
        method: 'POST',
      });
      setBackups(res.backups);
      setNotice(`SQLite-Backup erstellt: ${res.backup.filename}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveBackupInterval() {
    await apiRequest('/admin/backups/interval', {
      method: 'PUT',
      body: JSON.stringify({ intervalMinutes: backupInterval }),
    });
    setNotice(`Backup-Intervall auf alle ${backupInterval} Minuten gesetzt.`);
  }

  async function handleSaveSmtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await apiRequest('/admin/smtp', {
        method: 'PUT',
        body: JSON.stringify(smtpCfg),
      });
      setNotice('SMTP-Konfiguration gespeichert.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTestSmtp() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ result: { sent: boolean; message: string } }>('/admin/smtp/test', {
        method: 'POST',
      });
      if (res.result.sent) setNotice(res.result.message);
      else setError(res.result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Administration, MariaDB &amp; Backups</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Benutzerverwaltung, MariaDB-Masterstruktur, automatisches SQLite-Failover und E-Mail-Benachrichtigungen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
          {(
            [
              ['users', 'Benutzer', Users],
              ['database', 'MariaDB & Sync', Database],
              ['backups', 'SQLite Backups', HardDriveDownload],
              ['smtp', 'E-Mail-Alerts', Mail],
            ] as Array<[AdminTab, string, typeof Users]>
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                tab === key
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
          {notice}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300 text-xs font-medium">
          {error}
        </div>
      )}

      {/* TAB 1: USERS */}
      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={(e) => void handleCreateUser(e)} className="theme-card p-5 space-y-3.5 h-fit">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-[var(--accent)]" />
              Neuen Benutzer anlegen
            </h3>
            <input
              type="text"
              required
              minLength={2}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Benutzername (für Login & CalDAV)"
              className="theme-input w-full px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="Anzeigename"
              className="theme-input w-full px-3 py-2 text-xs"
            />
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="E-Mail-Adresse"
              className="theme-input w-full px-3 py-2 text-xs"
            />
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Passwort (min. 6 Zeichen)"
              className="theme-input w-full px-3 py-2 text-xs"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="theme-input w-full px-3 py-2 text-xs"
            >
              <option value="user">Standard-Benutzer</option>
              <option value="admin">Administrator</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="theme-btn-primary w-full py-2 text-xs font-semibold"
            >
              Benutzer erstellen
            </button>
          </form>

          <div className="theme-card lg:col-span-2 overflow-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)] bg-[var(--bg-surface-2)]/40">
                  <th className="py-2.5 px-4">Benutzer</th>
                  <th className="py-2.5 px-4">Rolle</th>
                  <th className="py-2.5 px-4">2FA</th>
                  <th className="py-2.5 px-4 text-right">Verwaltung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--bg-hover)]/40">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--text-primary)]">{u.displayName}</div>
                      <div className="text-[var(--text-muted)] font-mono">
                        {u.username} · {u.email}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        disabled={u.id === currentUser.id}
                        onClick={() => void handleToggleRole(u)}
                        className="px-2 py-1 rounded border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                      >
                        {u.role === 'admin' ? 'Admin' : 'Benutzer'}
                      </button>
                    </td>
                    <td className="py-3 px-4">
                      {u.totpEnabled ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Aktiv</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">Inaktiv</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      {u.totpEnabled && (
                        <button
                          type="button"
                          onClick={() => void handleReset2fa(u)}
                          title="2FA zurücksetzen"
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-amber-600 dark:text-amber-400"
                        >
                          <ShieldOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {u.id !== currentUser.id && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteUser(u)}
                          title="Benutzer löschen"
                          className="p-1.5 rounded hover:bg-red-500/15 text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: MARIADB & FAILOVER SYNC */}
      {tab === 'database' && dbStatus && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form onSubmit={(e) => void handleSaveMariaDb(e)} className="theme-card p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">MariaDB-Master Verbindung</h3>
                <span
                  className={`text-xs font-semibold ${
                    dbStatus.mariadbReachable
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {dbStatus.mariadbReachable ? 'Verbunden (Master)' : 'Offline (SQLite Backup aktiv)'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={mariaCfg.host}
                  onChange={(e) => setMariaCfg({ ...mariaCfg, host: e.target.value })}
                  placeholder="Host (z.B. mariadb oder 192.168.1.10)"
                  className="theme-input col-span-2 px-3 py-2 text-xs"
                />
                <input
                  type="number"
                  value={mariaCfg.port}
                  onChange={(e) => setMariaCfg({ ...mariaCfg, port: Number(e.target.value) })}
                  placeholder="3306"
                  className="theme-input px-3 py-2 text-xs font-mono tabular-nums"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={mariaCfg.database}
                  onChange={(e) => setMariaCfg({ ...mariaCfg, database: e.target.value })}
                  placeholder="Datenbankname"
                  className="theme-input px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  value={mariaCfg.user}
                  onChange={(e) => setMariaCfg({ ...mariaCfg, user: e.target.value })}
                  placeholder="DB-Benutzer"
                  className="theme-input px-3 py-2 text-xs"
                />
                <input
                  type="password"
                  value={mariaCfg.password}
                  onChange={(e) => setMariaCfg({ ...mariaCfg, password: e.target.value })}
                  placeholder="DB-Passwort"
                  className="theme-input px-3 py-2 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="submit" disabled={busy} className="theme-btn-primary px-4 py-2 text-xs font-semibold">
                  Speichern &amp; Verbinden
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTestDb()}
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
                >
                  Verbindung testen
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleManualSync()}
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Master-Sync ({dbStatus.pendingSyncCount})
                </button>
              </div>
            </form>

            <div className="theme-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Failover &amp; Ausfall-Simulation</h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleOutage()}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                    dbStatus.simulatedOutage
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {dbStatus.simulatedOutage ? 'Ausfall beenden & Sync starten' : 'DB-Ausfall simulieren'}
                </button>
              </div>

              <div className="text-xs space-y-1.5 text-[var(--text-muted)] tabular-nums">
                <div>
                  Ausstehende Änderungen in SQLite-Queue: <strong className="text-[var(--text-primary)]">{dbStatus.pendingSyncCount}</strong>
                </div>
                <div>
                  Letzter Master-Sync: <strong className="text-[var(--text-primary)]">{dbStatus.lastSyncAt ? new Date(dbStatus.lastSyncAt).toLocaleString('de-DE') : 'Noch keiner'}</strong>
                </div>
                {dbStatus.lastError && (
                  <div className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {dbStatus.lastError}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold">Synchronisations-Protokoll</div>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--border-hairline)] divide-y divide-[var(--border-hairline)] text-xs">
                  {syncLogs.length === 0 ? (
                    <div className="p-3 text-[var(--text-muted)]">Keine Einträge.</div>
                  ) : (
                    syncLogs.map((l) => (
                      <div key={l.id} className="p-2 flex items-start justify-between gap-2">
                        <span className="text-[var(--text-primary)]">{l.message}</span>
                        <span className="text-[11px] font-mono tabular-nums text-[var(--text-muted)] shrink-0">
                          {new Date(l.created_at).toLocaleTimeString('de-DE')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* MariaDB Schema SQL */}
          <div className="theme-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">MariaDB Tabellenstruktur (db/mariadb_schema.sql)</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Für Ihre bereits vorhandene MariaDB-Datenbank. Fehlende Tabellen werden beim Verbinden automatisch angelegt.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(schemaSql);
                  setCopiedSchema(true);
                  setTimeout(() => setCopiedSchema(false), 1800);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5"
              >
                {copiedSchema ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedSchema ? 'SQL kopiert' : 'SQL kopieren'}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-[11px] font-mono overflow-x-auto max-h-60">
              {schemaSql}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 3: SQLITE BACKUPS */}
      {tab === 'backups' && (
        <div className="theme-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-[var(--text-muted)]">Automatisches Backup-Intervall (Minuten):</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={backupInterval}
                onChange={(e) => setBackupInterval(Number(e.target.value))}
                className="theme-input w-24 px-3 py-1.5 text-xs font-mono tabular-nums"
              />
              <button
                type="button"
                onClick={() => void handleSaveBackupInterval()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
              >
                Intervall speichern
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRunBackup()}
              className="theme-btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-1.5"
            >
              <HardDriveDownload className="w-4 h-4" />
              SQLite-Backup jetzt erstellen
            </button>
          </div>

          <div className="rounded-lg border border-[var(--border-hairline)] overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)] bg-[var(--bg-surface-2)]/40">
                  <th className="py-2.5 px-4">SQLite-Backup-Datei</th>
                  <th className="py-2.5 px-4">Erstellt am</th>
                  <th className="py-2.5 px-4">Größe</th>
                  <th className="py-2.5 px-4 text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {backups.map((b) => (
                  <tr key={b.filename} className="hover:bg-[var(--bg-hover)]/40">
                    <td className="py-2.5 px-4 font-mono">{b.filename}</td>
                    <td className="py-2.5 px-4 tabular-nums">{new Date(b.createdAt).toLocaleString('de-DE')}</td>
                    <td className="py-2.5 px-4 tabular-nums">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void downloadAuthenticatedFile(`/admin/backups/${b.filename}/download`, b.filename)}
                        className="px-2.5 py-1 rounded border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        .sqlite
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SMTP EMAIL ALERTS */}
      {tab === 'smtp' && (
        <form onSubmit={(e) => void handleSaveSmtp(e)} className="theme-card p-5 space-y-4 max-w-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">E-Mail-Benachrichtigung bei DB-Verbindungsabbruch</h3>
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={smtpCfg.enabled}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, enabled: e.target.checked })}
              />
              Alerts aktiv
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs text-[var(--text-muted)]">SMTP-Server</label>
              <input
                type="text"
                value={smtpCfg.host}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, host: e.target.value })}
                placeholder="smtp.beispiel.de"
                className="theme-input w-full px-3 py-2 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">Port</label>
              <input
                type="number"
                value={smtpCfg.port}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, port: Number(e.target.value) })}
                className="theme-input w-full px-3 py-2 text-xs font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">SMTP-Benutzer</label>
              <input
                type="text"
                value={smtpCfg.user}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, user: e.target.value })}
                className="theme-input w-full px-3 py-2 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">SMTP-Passwort</label>
              <input
                type="password"
                value={smtpCfg.pass}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, pass: e.target.value })}
                className="theme-input w-full px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">Absender-Adresse</label>
              <input
                type="email"
                value={smtpCfg.from}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, from: e.target.value })}
                placeholder="chronodav@domain.de"
                className="theme-input w-full px-3 py-2 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">Empfänger für Ausfall-Warnungen</label>
              <input
                type="email"
                value={smtpCfg.alertTo}
                onChange={(e) => setSmtpCfg({ ...smtpCfg, alertTo: e.target.value })}
                placeholder="admin@domain.de"
                className="theme-input w-full px-3 py-2 text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={smtpCfg.secure}
              onChange={(e) => setSmtpCfg({ ...smtpCfg, secure: e.target.checked })}
            />
            SSL/TLS direkt verwenden (Port 465)
          </label>

          <div className="flex items-center gap-2 pt-2">
            <button type="submit" disabled={busy} className="theme-btn-primary px-4 py-2 text-xs font-semibold">
              SMTP speichern
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTestSmtp()}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              Test-E-Mail senden
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
