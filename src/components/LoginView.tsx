import { useState } from 'react';
import { AlertTriangle, Calendar, Lock, Moon, ShieldCheck, Sun, UserPlus } from 'lucide-react';
import { apiRequest, setAuthToken } from '../api';
import type { DbStatus, SafeUser, ThemeMode } from '../types';

interface LoginViewProps {
  needsBootstrap: boolean;
  dbStatus: DbStatus;
  theme: ThemeMode;
  dark: boolean;
  onChangeTheme: (t: ThemeMode) => void;
  onToggleDark: () => void;
  onAuthenticated: (user: SafeUser, dbStatus: DbStatus) => void;
}

export function LoginView({
  needsBootstrap,
  dbStatus,
  theme,
  dark,
  onChangeTheme,
  onToggleDark,
  onAuthenticated,
}: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: SafeUser; dbStatus: DbStatus }>('/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, email, password }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.dbStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Einrichtung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        requires2fa: boolean;
        challengeToken?: string;
        token?: string;
        user?: SafeUser;
        dbStatus: DbStatus;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (res.requires2fa && res.challengeToken) {
        setChallengeToken(res.challengeToken);
      } else if (res.token && res.user) {
        setAuthToken(res.token);
        onAuthenticated(res.user, res.dbStatus);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify2fa(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: SafeUser; dbStatus: DbStatus }>('/auth/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, code: totpCode }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.dbStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : '2FA-Prüfung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-8 bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Top Controls */}
      <div className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--accent)] text-[var(--accent-fg)]">
            <Calendar className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight whitespace-nowrap">ChronoDAV</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
            {(['google', 'apple', 'batman'] as ThemeMode[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChangeTheme(t)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                  theme === t
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t === 'batman' ? 'Batman' : t === 'apple' ? 'Apple' : 'Google'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleDark}
            aria-label="Dark Mode umschalten"
            className="p-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Auth Card */}
      <div className="max-w-md w-full mx-auto my-8 space-y-4">
        {dbStatus.failoverBanner && (
          <div
            role="alert"
            className="p-4 rounded-xl border border-amber-500/50 bg-amber-500/12 text-amber-800 dark:text-amber-200 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="text-sm space-y-1">
              <p className="font-semibold">{dbStatus.failoverBanner}</p>
              <p className="text-xs opacity-90">
                Änderungen werden lokal gesichert und automatisch auf den MariaDB-Master synchronisiert, sobald die
                Verbindung wiederhergestellt ist.
              </p>
            </div>
          </div>
        )}

        <div className="theme-card p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {needsBootstrap
                ? 'Ersteinrichtung: Admin-Konto'
                : challengeToken
                  ? 'Zwei-Faktor-Bestätigung'
                  : 'Anmelden'}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              {needsBootstrap
                ? 'Legen Sie den ersten Administrator für Ihre CalDAV/CardDAV-Instanz an.'
                : challengeToken
                  ? 'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.'
                  : 'CalDAV, CardDAV, Kontakte, Aufgaben und Mobil-Sync'}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 text-xs font-medium">
              {error}
            </div>
          )}

          {needsBootstrap ? (
            <form onSubmit={(e) => void handleBootstrap(e)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Benutzername</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="z.B. admin"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Anzeigename</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="z.B. Christian Lehner"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">E-Mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@domain.de"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Passwort (min. 6 Zeichen)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="theme-btn-primary w-full py-2.5 px-4 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <UserPlus className="w-4 h-4" />
                {submitting ? 'Wird eingerichtet...' : 'Administrator anlegen & starten'}
              </button>
            </form>
          ) : challengeToken ? (
            <form onSubmit={(e) => void handleVerify2fa(e)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">6-stelliger 2FA-Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="theme-input w-full px-3 py-2.5 text-center font-mono text-lg tracking-widest tabular-nums"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setChallengeToken(null);
                    setTotpCode('');
                    setError(null);
                  }}
                  className="px-4 py-2.5 text-sm rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
                >
                  Zurück
                </button>
                <button
                  type="submit"
                  disabled={submitting || totpCode.length !== 6}
                  className="theme-btn-primary flex-1 py-2.5 px-4 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {submitting ? 'Prüfe...' : 'Code bestätigen'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Benutzername</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Passwort</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="theme-btn-primary w-full py-2.5 px-4 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Lock className="w-4 h-4" />
                {submitting ? 'Anmeldung...' : 'Anmelden'}
              </button>
            </form>
          )}
        </div>
      </div>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-[var(--text-muted)]">
        ChronoDAV · CalDAV &amp; CardDAV · MariaDB Master + SQLite Failover
      </footer>
    </div>
  );
}
