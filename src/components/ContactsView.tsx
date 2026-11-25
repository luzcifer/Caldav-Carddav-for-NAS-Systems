import { useMemo, useRef, useState } from 'react';
import {
  Building2,
  Download,
  Mail,
  MapPin,
  Phone,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { AttachmentItem, ContactItem, ContactLabeledValue } from '../types';
import { AddressSearchField } from './AddressSearchField';
import { AttachmentsPanel } from './AttachmentsPanel';

interface ContactsViewProps {
  contacts: ContactItem[];
  searchQuery: string;
  onContactsChanged: () => Promise<void>;
}

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function initialsOf(c: ContactItem): string {
  const f = c.first_name?.charAt(0) || '';
  const l = c.last_name?.charAt(0) || '';
  return (f + l || c.display_name.slice(0, 2)).toUpperCase();
}

export function ContactsView({ contacts, searchQuery, onContactsChanged }: ContactsViewProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'favorites' | string>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ContactItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vcfInputRef = useRef<HTMLInputElement | null>(null);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [emails, setEmails] = useState<ContactLabeledValue[]>([{ label: 'Arbeit', value: '' }]);
  const [phones, setPhones] = useState<ContactLabeledValue[]>([{ label: 'Mobil', value: '' }]);
  const [birthday, setBirthday] = useState('');
  const [notes, setNotes] = useState('');
  const [labelsInput, setLabelsInput] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [address, setAddress] = useState({
    street: '',
    zip: '',
    city: '',
    country: '',
    lat: null as number | null,
    lon: null as number | null,
  });
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) {
      for (const lbl of parseJsonArray<string>(c.labels_json, [])) {
        if (lbl.trim()) set.add(lbl.trim());
      }
    }
    return Array.from(set).sort();
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter((c) => {
      const cLabels = parseJsonArray<string>(c.labels_json, []);
      if (filterMode === 'favorites' && !c.is_favorite) return false;
      if (filterMode !== 'all' && filterMode !== 'favorites' && !cLabels.includes(filterMode)) return false;

      if (!q) return true;
      const cEmails = parseJsonArray<ContactLabeledValue>(c.emails_json, []);
      const cPhones = parseJsonArray<ContactLabeledValue>(c.phones_json, []);
      return (
        c.display_name.toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.address_city || '').toLowerCase().includes(q) ||
        cEmails.some((e) => e.value.toLowerCase().includes(q)) ||
        cPhones.some((p) => p.value.toLowerCase().includes(q))
      );
    });
  }, [contacts, filterMode, searchQuery]);

  function openNewContact() {
    setEditing(null);
    setFirstName('');
    setLastName('');
    setCompany('');
    setJobTitle('');
    setEmails([{ label: 'Arbeit', value: '' }]);
    setPhones([{ label: 'Mobil', value: '' }]);
    setBirthday('');
    setNotes('');
    setLabelsInput('');
    setIsFavorite(false);
    setAddress({ street: '', zip: '', city: '', country: '', lat: null, lon: null });
    setAttachments([]);
    setError(null);
    setDrawerOpen(true);
  }

  function openEditContact(c: ContactItem) {
    setEditing(c);
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setCompany(c.company || '');
    setJobTitle(c.job_title || '');
    const em = parseJsonArray<ContactLabeledValue>(c.emails_json, []);
    const ph = parseJsonArray<ContactLabeledValue>(c.phones_json, []);
    setEmails(em.length ? em : [{ label: 'Arbeit', value: '' }]);
    setPhones(ph.length ? ph : [{ label: 'Mobil', value: '' }]);
    setBirthday(c.birthday || '');
    setNotes(c.notes || '');
    setLabelsInput(parseJsonArray<string>(c.labels_json, []).join(', '));
    setIsFavorite(Boolean(c.is_favorite));
    setAddress({
      street: c.address_street || '',
      zip: c.address_zip || '',
      city: c.address_city || '',
      country: c.address_country || '',
      lat: c.address_lat,
      lon: c.address_lon,
    });
    setAttachments(c.attachments || []);
    setError(null);
    setDrawerOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        company: company.trim() || null,
        jobTitle: jobTitle.trim() || null,
        emails: emails.filter((x) => x.value.trim()),
        phones: phones.filter((x) => x.value.trim()),
        addressStreet: address.street || null,
        addressZip: address.zip || null,
        addressCity: address.city || null,
        addressCountry: address.country || null,
        addressLat: address.lat,
        addressLon: address.lon,
        birthday: birthday || null,
        notes: notes || null,
        labels: labelsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        isFavorite,
      };
      if (editing) {
        await apiRequest(`/contacts/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/contacts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      await onContactsChanged();
      setDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite(c: ContactItem, e: React.MouseEvent) {
    e.stopPropagation();
    await apiRequest(`/contacts/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isFavorite: !c.is_favorite }),
    });
    await onContactsChanged();
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiRequest(`/contacts/${editing.id}`, { method: 'DELETE' });
      await onContactsChanged();
      setDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleVcfImport(file: File | null) {
    if (!file) return;
    const text = await file.text();
    await apiRequest('/contacts/import/vcf', {
      method: 'POST',
      body: JSON.stringify({ vcfContent: text }),
    });
    await onContactsChanged();
    if (vcfInputRef.current) vcfInputRef.current.value = '';
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Contacts Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Kontakte</h2>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">({filteredContacts.length})</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={vcfInputRef}
            type="file"
            accept=".vcf,text/vcard"
            className="hidden"
            onChange={(e) => void handleVcfImport(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => vcfInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            vCard Import
          </button>
          <button
            type="button"
            onClick={() => void downloadAuthenticatedFile('/contacts/export/vcf', 'chronodav-contacts.vcf')}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            vCard Export
          </button>
          <button
            type="button"
            onClick={openNewContact}
            className="theme-btn-primary px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Kontakt erstellen
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilterMode('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            filterMode === 'all'
              ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
              : 'bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          Alle Kontakte
        </button>
        <button
          type="button"
          onClick={() => setFilterMode('favorites')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
            filterMode === 'favorites'
              ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
              : 'bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Star className="w-3.5 h-3.5" />
          Favoriten
        </button>
        {allLabels.map((lbl) => (
          <button
            key={lbl}
            type="button"
            onClick={() => setFilterMode(lbl)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filterMode === lbl
                ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                : 'bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Google Contacts Table */}
      <div className="theme-card flex-1 overflow-auto">
        {filteredContacts.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-sm text-[var(--text-muted)]">Keine Kontakte in dieser Ansicht vorhanden.</p>
            <button
              type="button"
              onClick={openNewContact}
              className="theme-btn-primary px-4 py-2 text-xs font-semibold"
            >
              Ersten Kontakt anlegen
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-surface-2)]/40">
                <th className="py-2.5 px-4">Name</th>
                <th className="py-2.5 px-4 hidden md:table-cell">E-Mail</th>
                <th className="py-2.5 px-4 hidden sm:table-cell">Telefon</th>
                <th className="py-2.5 px-4 hidden lg:table-cell">Firma &amp; Position</th>
                <th className="py-2.5 px-4 hidden xl:table-cell">Adresse</th>
                <th className="py-2.5 px-4 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)]">
              {filteredContacts.map((c) => {
                const em = parseJsonArray<ContactLabeledValue>(c.emails_json, []);
                const ph = parseJsonArray<ContactLabeledValue>(c.phones_json, []);
                const addrSummary = [c.address_street, c.address_city].filter(Boolean).join(', ');
                return (
                  <tr
                    key={c.id}
                    onClick={() => openEditContact(c)}
                    className="hover:bg-[var(--bg-hover)]/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent-soft-fg)] text-xs font-bold flex items-center justify-center shrink-0">
                          {initialsOf(c)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--text-primary)] truncate">{c.display_name}</div>
                          <div className="text-xs text-[var(--text-muted)] md:hidden truncate">
                            {em[0]?.value || ph[0]?.value || c.company || ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 hidden md:table-cell text-xs text-[var(--text-muted)]">
                      {em[0]?.value || '—'}
                    </td>
                    <td className="py-2.5 px-4 hidden sm:table-cell text-xs font-mono tabular-nums text-[var(--text-muted)]">
                      {ph[0]?.value || '—'}
                    </td>
                    <td className="py-2.5 px-4 hidden lg:table-cell text-xs text-[var(--text-muted)]">
                      {[c.job_title, c.company].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="py-2.5 px-4 hidden xl:table-cell text-xs text-[var(--text-muted)]">
                      {addrSummary || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => void toggleFavorite(c, e)}
                        aria-label="Favorit umschalten"
                        className="p-1.5 rounded hover:bg-[var(--bg-hover)]"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            c.is_favorite ? 'fill-amber-400 text-amber-400' : 'text-[var(--text-muted)]'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Contact Detail / Edit Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex justify-end">
          <div className="theme-card w-full max-w-xl h-full rounded-none sm:rounded-l-2xl flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold">
                {editing ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFavorite(!isFavorite)}
                  className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
                  title="Favorit"
                >
                  <Star className={`w-4 h-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-[var(--text-muted)]'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300 text-xs">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Vorname</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Nachname</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" /> Unternehmen
                  </label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Position</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Emails */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5" /> E-Mail-Adressen
                  </label>
                  <button
                    type="button"
                    onClick={() => setEmails([...emails, { label: 'Privat', value: '' }])}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    + Hinzufügen
                  </button>
                </div>
                {emails.map((em, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select
                      value={em.label}
                      onChange={(e) =>
                        setEmails(emails.map((item, i) => (i === idx ? { ...item, label: e.target.value } : item)))
                      }
                      className="theme-input px-2.5 py-1.5 text-xs w-28"
                    >
                      <option value="Arbeit">Arbeit</option>
                      <option value="Privat">Privat</option>
                      <option value="Sonstiges">Sonstiges</option>
                    </select>
                    <input
                      type="email"
                      value={em.value}
                      onChange={(e) =>
                        setEmails(emails.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))
                      }
                      placeholder="name@beispiel.de"
                      className="theme-input flex-1 px-3 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>

              {/* Phones */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> Telefonnummern
                  </label>
                  <button
                    type="button"
                    onClick={() => setPhones([...phones, { label: 'Arbeit', value: '' }])}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    + Hinzufügen
                  </button>
                </div>
                {phones.map((ph, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select
                      value={ph.label}
                      onChange={(e) =>
                        setPhones(phones.map((item, i) => (i === idx ? { ...item, label: e.target.value } : item)))
                      }
                      className="theme-input px-2.5 py-1.5 text-xs w-28"
                    >
                      <option value="Mobil">Mobil</option>
                      <option value="Arbeit">Arbeit</option>
                      <option value="Privat">Privat</option>
                    </select>
                    <input
                      type="tel"
                      value={ph.value}
                      onChange={(e) =>
                        setPhones(phones.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))
                      }
                      placeholder="+49 170 000000"
                      className="theme-input flex-1 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>

              {/* Address Search & Save */}
              <AddressSearchField value={address} onChange={setAddress} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Geburtstag</label>
                  <input
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Labels (kommagetrennt)</label>
                  <input
                    type="text"
                    value={labelsInput}
                    onChange={(e) => setLabelsInput(e.target.value)}
                    placeholder="VIP, Familie, Kunde"
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Notizen</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <AttachmentsPanel
                entityType="contact"
                entityId={editing?.id || null}
                attachments={attachments}
                onChange={setAttachments}
              />

              <div className="pt-3 border-t border-[var(--border-hairline)] flex items-center justify-between gap-2">
                <div>
                  {editing && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDelete()}
                      className="px-3 py-2 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Löschen
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="theme-btn-primary px-5 py-2 text-xs font-semibold disabled:opacity-60"
                  >
                    {saving ? 'Speichern...' : 'Speichern'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
