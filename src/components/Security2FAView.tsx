import { useState } from 'react';
import { ShieldCheck, ShieldOff, KeyRound, Copy, Check } from 'lucide-react';
import { apiRequest } from '../api';
import type { SafeUser } from '../types';

interface Security2FAViewProps {
  user: SafeUser;
  onUserUpdated: (u: SafeUser) => void;
}

export function Security2FAView({ user, onUserUpdated }: Security2FAViewProps) {
  const [setupData, setSetupData] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function startSetup() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ secret: string; qrDataUrl: string }>('/auth/2fa/setup', {
        method: 'POST',
      });
      setSetupData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '2FA-Setup fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ user: SafeUser }>('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      onUserUpdated(res.user);
      setSetupData(null);
      setCode('');
      setSuccess('Zwei-Faktor-Authentifizierung wurde erfolgreich aktiviert.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code ungültig');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ user: SafeUser }>('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword }),
      });
      onUserUpdated(res.user);
      setDisablePassword('');
      setSuccess('Zwei-Faktor-Authentifizierung wurde deaktiviert.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deaktivierung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Sicherheit &amp; Zwei-Faktor-Authentifizierung (2FA)</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Schützen Sie Ihren Zugang mit einem zeitbasierten Einmalpasswort (TOTP) via Google Authenticator, Apple Passwörter oder Authy.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300 text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs">
          {success}
        </div>
      )}

      <div className="theme-card p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {user.totpEnabled ? (
              <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldOff className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            )}
            <div>
              <div className="font-semibold text-sm">
                Status: {user.totpEnabled ? '2FA ist aktiv' : '2FA ist nicht aktiviert'}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Benutzerkonto: {user.username} ({user.email})
              </div>
            </div>
          </div>

          {!user.totpEnabled && !setupData && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startSetup()}
              className="theme-btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-4 h-4" />
              2FA einrichten
            </button>
          )}
        </div>

        {!user.totpEnabled && setupData && (
          <div className="pt-4 border-t border-[var(--border-hairline)] space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="p-3 bg-white rounded-xl border border-[var(--border-hairline)] shrink-0">
                <img src={setupData.qrDataUrl} alt="2FA QR-Code" className="w-40 h-40" />
              </div>
              <div className="space-y-3 flex-1">
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Scannen Sie diesen QR-Code mit Ihrer Authenticator-App oder geben Sie den geheimen Schlüssel manuell ein:
                </p>
                <div className="flex items-center gap-2">
                  <code className="theme-input px-3 py-1.5 text-xs font-mono flex-1 truncate">{setupData.secret}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(setupData.secret);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <form onSubmit={(e) => void confirmEnable(e)} className="flex items-center gap-2 pt-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-stelliger Code"
                    className="theme-input px-3 py-2 text-sm font-mono tracking-widest w-40 tabular-nums"
                  />
                  <button
                    type="submit"
                    disabled={busy || code.length !== 6}
                    className="theme-btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-60"
                  >
                    Aktivieren
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {user.totpEnabled && (
          <form onSubmit={(e) => void handleDisable(e)} className="pt-4 border-t border-[var(--border-hairline)] space-y-3">
            <div className="text-xs font-medium text-[var(--text-muted)]">
              2FA deaktivieren (aktuelles Passwort zur Bestätigung eingeben):
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                required
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Aktuelles Passwort"
                className="theme-input px-3 py-2 text-sm flex-1 min-w-[200px]"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                2FA deaktivieren
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
