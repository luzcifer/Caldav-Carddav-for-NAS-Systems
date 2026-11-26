import { useEffect, useState } from 'react';
import { Check, Copy, Download, Laptop, QrCode, Smartphone } from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { SyncInfo } from '../types';

export function MobileSyncView() {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<SyncInfo>('/sync/info').then(setInfo);
  }, []);

  function copyValue(key: string, val: string) {
    void navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  if (!info) {
    return (
      <div className="theme-card p-8 text-sm text-[var(--text-muted)]">
        Lade Synchronisationsdaten...
      </div>
    );
  }

  const endpoints = [
    { key: 'discovery', label: 'Zentrale DAV-Discovery-URL (iOS / macOS / DAVx5)', value: info.davDiscoveryUrl },
    { key: 'caldav', label: 'Direkte CalDAV-Kalender-URL', value: info.caldavUrl },
    { key: 'carddav', label: 'Direkte CardDAV-Adressbuch-URL', value: info.carddavUrl },
    { key: 'principal', label: 'Principal-URL', value: info.principalUrl },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Mobile Endgeräte &amp; Desktop Sync</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Synchronisieren Sie Kalender (CalDAV) und Kontakte (CardDAV) direkt auf iOS, Android, macOS, Windows und Linux.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void downloadAuthenticatedFile('/sync/mobileconfig', `chronodav-${info.username}.mobileconfig`)}
          className="theme-btn-primary px-4 py-2.5 text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          Apple .mobileconfig Profil herunterladen
        </button>
      </div>

      {/* QR Codes & Endpoints */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="theme-card p-5 flex flex-col items-center text-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <QrCode className="w-4 h-4 text-[var(--accent)]" />
            QR-Code für DAVx5 / Mobilgerät
          </div>
          <div className="p-3 bg-white rounded-xl border border-[var(--border-hairline)]">
            <img src={info.qrCodeDataUrl} alt="CalDAV & CardDAV QR-Code" className="w-44 h-44" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Mit der Android-Kamera oder DAVx5 scannen. Benutzername: <span className="font-mono font-semibold text-[var(--text-primary)]">{info.username}</span>
          </p>
        </div>

        <div className="theme-card p-5 lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold">Server-Endpunkte</h3>
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div key={ep.key} className="space-y-1">
                <div className="text-xs text-[var(--text-muted)]">{ep.label}</div>
                <div className="flex items-center gap-2">
                  <code className="theme-input flex-1 px-3 py-2 text-xs font-mono truncate">{ep.value}</code>
                  <button
                    type="button"
                    onClick={() => copyValue(ep.key, ep.value)}
                    className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {copiedKey === ep.key ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === ep.key ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Platform Guides */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="theme-card p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="w-4 h-4 text-[var(--accent)]" />
            iPhone / iPad (iOS)
          </div>
          <ol className="text-xs text-[var(--text-muted)] space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>Oben auf <strong>Apple .mobileconfig Profil herunterladen</strong> tippen und installieren.</li>
            <li>Alternativ unter <em>Einstellungen → Kalender / Kontakte → Accounts → Account hinzufügen → Andere</em> wählen.</li>
            <li>CalDAV- &amp; CardDAV-Account mit der DAV-Discovery-URL und Ihrem Benutzernamen anlegen.</li>
          </ol>
        </div>

        <div className="theme-card p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="w-4 h-4 text-[var(--accent)]" />
            ChronoSync Android-App (Nativ)
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Eigene Android-App für CalDAV &amp; CardDAV mit direkter Integration in die Android Kalender- &amp; Kontakte-App, wählbarem Intervall (<strong>5, 10, 15, 30, 45, 60 Min</strong>), <strong>„Jetzt syncen“</strong> und <strong>Sofort-Sync beim Öffnen von Kalender/Kontakte</strong>.
          </p>
          <div className="pt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void downloadAuthenticatedFile('/sync/android-zip', 'chronosync-android.zip')}
              className="theme-btn-primary px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Android-App (.zip) laden
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Alternativ: <strong>DAVx5</strong> installieren und oben den QR-Code scannen.
          </p>
        </div>

        <div className="theme-card p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Laptop className="w-4 h-4 text-[var(--accent)]" />
            macOS, Linux &amp; Windows
          </div>
          <ol className="text-xs text-[var(--text-muted)] space-y-1.5 list-decimal list-inside leading-relaxed">
            <li><strong>macOS:</strong> Systemeinstellungen → Internetaccounts → Anderen Account hinzufügen (CalDAV/CardDAV).</li>
            <li><strong>Thunderbird:</strong> Kalender / Adressbuch → Neu → Im Netzwerk → CalDAV- bzw. CardDAV-URL eintragen.</li>
            <li><strong>GNOME / KDE:</strong> Online-Konten bzw. KOrganizer/Kontact mit DAV-Discovery-URL verbinden.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
