import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  MapPin,
  Plus,
  Share2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type {
  AttachmentItem,
  CalendarItem,
  DirectoryUser,
  EventItem,
  EventShareItem,
} from '../types';
import { AddressSearchField } from './AddressSearchField';
import { AttachmentsPanel } from './AttachmentsPanel';

type CalViewMode = 'month' | 'week' | 'day' | 'agenda';

interface CalendarViewProps {
  selectedDate: Date;
  onChangeDate: (d: Date) => void;
  calendars: CalendarItem[];
  visibleCalendarIds: string[];
  events: EventItem[];
  directoryUsers: DirectoryUser[];
  currentUserId: string;
  searchQuery: string;
  externalCreateTrigger: number;
  onEventsChanged: () => Promise<void>;
}

const EVENT_COLORS = [
  '#1A73E8',
  '#0B8043',
  '#D50000',
  '#F4511E',
  '#E67C73',
  '#8E24AA',
  '#039BE5',
  '#EAB308',
];

const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CalendarView({
  selectedDate,
  onChangeDate,
  calendars,
  visibleCalendarIds,
  events,
  directoryUsers,
  currentUserId,
  searchQuery,
  onEventsChanged,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<CalViewMode>('month');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal Form State
  const [title, setTitle] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [color, setColor] = useState('#1A73E8');
  const [address, setAddress] = useState({
    street: '',
    zip: '',
    city: '',
    country: '',
    lat: null as number | null,
    lon: null as number | null,
  });
  const [shares, setShares] = useState<EventShareItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((ev) => {
      if (ev.sharedPermission === 'owner' && !visibleCalendarIds.includes(ev.calendar_id)) {
        return false;
      }
      if (!q) return true;
      return (
        ev.title.toLowerCase().includes(q) ||
        (ev.description || '').toLowerCase().includes(q) ||
        (ev.location || '').toLowerCase().includes(q) ||
        (ev.address_city || '').toLowerCase().includes(q)
      );
    });
  }, [events, visibleCalendarIds, searchQuery]);

  const calendarColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of calendars) map.set(c.id, c.color || '#1A73E8');
    return map;
  }, [calendars]);

  function resolveEventColor(ev: EventItem): string {
    return ev.color || calendarColorMap.get(ev.calendar_id) || '#1A73E8';
  }

  function openNewEvent(dayDate: Date, hour = 9) {
    const s = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, 0, 0);
    const e = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour + 1, 0, 0);
    const defaultCal = calendars.find((c) => visibleCalendarIds.includes(c.id)) || calendars[0];
    setEditingEvent(null);
    setTitle('');
    setCalendarId(defaultCal?.id || '');
    setAllDay(false);
    setStartInput(toLocalDateTimeInput(s.toISOString()));
    setEndInput(toLocalDateTimeInput(e.toISOString()));
    setDescription('');
    setLocation('');
    setColor(defaultCal?.color || '#1A73E8');
    setAddress({ street: '', zip: '', city: '', country: '', lat: null, lon: null });
    setShares([]);
    setAttachments([]);
    setError(null);
    setModalOpen(true);
  }

  function openEditEvent(ev: EventItem) {
    setEditingEvent(ev);
    setTitle(ev.title);
    setCalendarId(ev.calendar_id);
    setAllDay(Boolean(ev.all_day));
    setStartInput(ev.all_day ? toLocalDateInput(ev.start_time) : toLocalDateTimeInput(ev.start_time));
    setEndInput(ev.all_day ? toLocalDateInput(ev.end_time) : toLocalDateTimeInput(ev.end_time));
    setDescription(ev.description || '');
    setLocation(ev.location || '');
    setColor(ev.color || calendarColorMap.get(ev.calendar_id) || '#1A73E8');
    setAddress({
      street: ev.address_street || '',
      zip: ev.address_zip || '',
      city: ev.address_city || '',
      country: ev.address_country || '',
      lat: ev.address_lat,
      lon: ev.address_lon,
    });
    setShares(ev.shares || []);
    setAttachments(ev.attachments || []);
    setError(null);
    setModalOpen(true);
  }

  const readOnly = editingEvent ? editingEvent.sharedPermission === 'view' : false;
  const isOwner = editingEvent ? editingEvent.sharedPermission === 'owner' : true;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const startIso = allDay ? new Date(`${startInput.slice(0, 10)}T00:00:00`).toISOString() : new Date(startInput).toISOString();
      const endIso = allDay ? new Date(`${endInput.slice(0, 10)}T23:59:00`).toISOString() : new Date(endInput).toISOString();
      const calDefaultColor = (calendarColorMap.get(calendarId) || '#1A73E8').toLowerCase();
      const effectiveColor = color.toLowerCase() === calDefaultColor ? null : color;
      const payload = {
        calendarId,
        title: title.trim(),
        description: description || null,
        startTime: startIso,
        endTime: endIso,
        allDay,
        location: location || [address.street, address.zip, address.city].filter(Boolean).join(', ') || null,
        addressStreet: address.street || null,
        addressZip: address.zip || null,
        addressCity: address.city || null,
        addressCountry: address.country || null,
        addressLat: address.lat,
        addressLon: address.lon,
        color: effectiveColor,
        shares,
      };

      if (editingEvent) {
        const res = await apiRequest<{ event: EventItem }>(`/events/${editingEvent.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setEditingEvent(res.event);
      } else {
        const res = await apiRequest<{ event: EventItem }>('/events', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setEditingEvent(res.event);
      }
      await onEventsChanged();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingEvent) return;
    setSaving(true);
    try {
      await apiRequest(`/events/${editingEvent.id}`, { method: 'DELETE' });
      await onEventsChanged();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  function navigatePeriod(delta: number) {
    const next = new Date(selectedDate);
    if (viewMode === 'month') next.setMonth(next.getMonth() + delta);
    else if (viewMode === 'week') next.setDate(next.getDate() + delta * 7);
    else next.setDate(next.getDate() + delta);
    onChangeDate(next);
  }

  function toggleShareUser(userId: string) {
    const exists = shares.find((s) => s.userId === userId);
    if (exists) {
      setShares(shares.filter((s) => s.userId !== userId));
    } else {
      setShares([...shares, { userId, permission: 'view' }]);
    }
  }

  function setSharePermission(userId: string, permission: 'view' | 'edit') {
    setShares(shares.map((s) => (s.userId === userId ? { ...s, permission } : s)));
  }

  const monthCells = useMemo(() => {
    const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const gridStart = startOfWeekMonday(first);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [selectedDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  const today = new Date();
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 06:00 - 21:00

  function eventsForDay(day: Date): EventItem[] {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59).getTime();
    return filteredEvents.filter((ev) => {
      const s = new Date(ev.start_time).getTime();
      const e = new Date(ev.end_time).getTime();
      return s <= dayEnd && e >= dayStart;
    });
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Calendar Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChangeDate(new Date())}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] whitespace-nowrap shrink-0"
          >
            Heute
          </button>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => navigatePeriod(-1)}
              aria-label="Vorheriger Zeitraum"
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigatePeriod(1)}
              aria-label="Nächster Zeitraum"
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight tabular-nums">
            {MONTHS_DE[selectedDate.getMonth()]} {selectedDate.getFullYear()}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
            {(
              [
                ['month', 'Monat'],
                ['week', 'Woche'],
                ['day', 'Tag'],
                ['agenda', 'Agenda'],
              ] as Array<[CalViewMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === mode
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => openNewEvent(selectedDate)}
            className="theme-btn-primary px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Termin
          </button>
        </div>
      </div>

      {/* MONTH VIEW */}
      {viewMode === 'month' && (
        <div className="theme-card flex-1 flex flex-col overflow-hidden min-h-[540px]">
          <div className="grid grid-cols-7 border-b border-[var(--border-hairline)] bg-[var(--bg-surface-2)]/40">
            {WEEKDAYS_DE.map((wd) => (
              <div
                key={wd}
                className="py-2 text-center text-xs font-semibold text-[var(--text-muted)] border-r last:border-r-0 border-[var(--border-hairline)]"
              >
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 grid-rows-6 flex-1">
            {monthCells.map((cellDate, idx) => {
              const isCurrentMonth = cellDate.getMonth() === selectedDate.getMonth();
              const isToday = sameDay(cellDate, today);
              const dayEvents = eventsForDay(cellDate);
              return (
                <div
                  key={idx}
                  onClick={() => openNewEvent(cellDate)}
                  className={`min-h-[90px] p-1.5 border-b border-r border-[var(--border-hairline)] cursor-pointer hover:bg-[var(--bg-hover)]/40 transition-colors flex flex-col gap-1 ${
                    !isCurrentMonth ? 'opacity-45 bg-[var(--bg-surface-2)]/20' : ''
                  }`}
                >
                  <div className="flex items-center justify-between px-1">
                    <span
                      className={`text-xs font-semibold tabular-nums w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {cellDate.getDate()}
                    </span>
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-[var(--text-muted)] tabular-nums">+{dayEvents.length - 3}</span>
                    )}
                  </div>
                  <div className="space-y-1 overflow-hidden">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditEvent(ev);
                        }}
                        style={{ backgroundColor: resolveEventColor(ev) }}
                        className="w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium text-white truncate flex items-center gap-1 hover:opacity-90"
                      >
                        {!ev.all_day && (
                          <span className="opacity-85 tabular-nums shrink-0">
                            {new Date(ev.start_time).toLocaleTimeString('de-DE', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        <span className="truncate">{ev.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEEK / DAY VIEW */}
      {(viewMode === 'week' || viewMode === 'day') && (
        <div className="theme-card flex-1 overflow-auto min-h-[540px]">
          <div
            className="grid border-b border-[var(--border-hairline)] sticky top-0 z-10 bg-[var(--bg-surface)]"
            style={{ gridTemplateColumns: `64px repeat(${viewMode === 'week' ? 7 : 1}, minmax(0, 1fr))` }}
          >
            <div className="p-2 border-r border-[var(--border-hairline)] text-[11px] text-[var(--text-muted)]">Zeit</div>
            {(viewMode === 'week' ? weekDays : [selectedDate]).map((d, i) => {
              const isT = sameDay(d, today);
              return (
                <div
                  key={i}
                  className="p-2 text-center border-r last:border-r-0 border-[var(--border-hairline)]"
                >
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {WEEKDAYS_DE[(d.getDay() + 6) % 7]}
                  </div>
                  <div
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold tabular-nums mt-0.5 ${
                      isT ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : ''
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            {hours.map((hr) => (
              <div
                key={hr}
                className="grid border-b border-[var(--border-hairline)] min-h-[52px]"
                style={{ gridTemplateColumns: `64px repeat(${viewMode === 'week' ? 7 : 1}, minmax(0, 1fr))` }}
              >
                <div className="p-1.5 text-[11px] font-mono tabular-nums text-[var(--text-muted)] border-r border-[var(--border-hairline)] text-right">
                  {String(hr).padStart(2, '0')}:00
                </div>
                {(viewMode === 'week' ? weekDays : [selectedDate]).map((d, i) => {
                  const slotEvents = eventsForDay(d).filter((ev) => {
                    if (ev.all_day) return hr === 6;
                    return new Date(ev.start_time).getHours() === hr;
                  });
                  return (
                    <div
                      key={i}
                      onClick={() => openNewEvent(d, hr)}
                      className="p-1 border-r last:border-r-0 border-[var(--border-hairline)] cursor-pointer hover:bg-[var(--bg-hover)]/40 space-y-1"
                    >
                      {slotEvents.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditEvent(ev);
                          }}
                          style={{ backgroundColor: resolveEventColor(ev) }}
                          className="w-full text-left px-2 py-1 rounded text-xs font-medium text-white truncate block"
                        >
                          {ev.all_day ? 'Ganztägig: ' : ''}
                          {ev.title}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AGENDA VIEW */}
      {viewMode === 'agenda' && (
        <div className="theme-card flex-1 p-4 overflow-auto space-y-3">
          {filteredEvents.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-[var(--text-muted)]">Keine Termine gefunden.</p>
              <button
                type="button"
                onClick={() => openNewEvent(selectedDate)}
                className="theme-btn-primary px-4 py-2 text-xs font-semibold"
              >
                Ersten Termin erstellen
              </button>
            </div>
          ) : (
            filteredEvents.map((ev) => (
              <div
                key={ev.id}
                onClick={() => openEditEvent(ev)}
                className="p-3.5 rounded-xl border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]/50 cursor-pointer flex flex-wrap items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: resolveEventColor(ev) }}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold text-sm text-[var(--text-primary)] truncate">{ev.title}</div>
                    <div className="text-xs text-[var(--text-muted)] flex flex-wrap items-center gap-2 tabular-nums">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(ev.start_time).toLocaleString('de-DE', {
                          dateStyle: 'medium',
                          timeStyle: ev.all_day ? undefined : 'short',
                        })}
                      </span>
                      {ev.location && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {ev.location}
                          </span>
                        </>
                      )}
                      {ev.sharedPermission !== 'owner' && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1 text-[var(--accent)]">
                            <Share2 className="w-3.5 h-3.5" />
                            Geteilt von {ev.ownerName}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {ev.shares.length > 0 && (
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {ev.shares.length} geteilt
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* EVENT EDITOR MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="theme-card w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold">
                {editingEvent ? (readOnly ? 'Termin ansehen (Geteilt)' : 'Termin bearbeiten') : 'Neuer Termin'}
              </h3>
              <div className="flex items-center gap-2">
                {editingEvent && (
                  <button
                    type="button"
                    onClick={() => void downloadAuthenticatedFile(`/events/${editingEvent.id}/ics`, `${editingEvent.id}.ics`)}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .ics
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
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

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Titel</label>
                <input
                  type="text"
                  required
                  disabled={readOnly}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Termin-Titel hinzufügen..."
                  className="theme-input w-full px-3 py-2 text-sm font-medium disabled:opacity-60"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={allDay}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setAllDay(next);
                      if (next) {
                        setStartInput(startInput.slice(0, 10));
                        setEndInput(endInput.slice(0, 10));
                      } else {
                        setStartInput(`${startInput.slice(0, 10)}T09:00`);
                        setEndInput(`${endInput.slice(0, 10)}T10:00`);
                      }
                    }}
                  />
                  Ganztägig
                </label>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {EVENT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={readOnly}
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-5 h-5 rounded-full transition-transform ${
                        color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-offset-2 ring-[var(--text-primary)] scale-110' : ''
                      }`}
                    />
                  ))}
                  <input
                    type="color"
                    disabled={readOnly}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    title="Eigene Farbe wählen"
                    className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Beginn</label>
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    required
                    disabled={readOnly}
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm tabular-nums disabled:opacity-60"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Ende</label>
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    required
                    disabled={readOnly}
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm tabular-nums disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Kalender</label>
                  <select
                    disabled={readOnly || !isOwner}
                    value={calendarId}
                    onChange={(e) => {
                      const nextCalId = e.target.value;
                      const prevDefault = (calendarColorMap.get(calendarId) || '#1A73E8').toLowerCase();
                      setCalendarId(nextCalId);
                      if (!editingEvent || color.toLowerCase() === prevDefault) {
                        setColor(calendarColorMap.get(nextCalId) || '#1A73E8');
                      }
                    }}
                    className="theme-input w-full px-3 py-2 text-sm disabled:opacity-60"
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Ort / Raum</label>
                  <input
                    type="text"
                    disabled={readOnly}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="z.B. Konferenzraum A oder Videolink"
                    className="theme-input w-full px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
              </div>

              <AddressSearchField value={address} onChange={setAddress} disabled={readOnly} />

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Beschreibung / Notizen</label>
                <textarea
                  rows={3}
                  disabled={readOnly}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm disabled:opacity-60"
                />
              </div>

              {/* Share Event with other users */}
              {isOwner && directoryUsers.filter((u) => u.id !== currentUserId).length > 0 && (
                <div className="space-y-2 p-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface-2)]/40">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                    Termin mit Benutzern teilen
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {directoryUsers
                      .filter((u) => u.id !== currentUserId)
                      .map((u) => {
                        const shared = shares.find((s) => s.userId === u.id);
                        return (
                          <div key={u.id} className="flex items-center justify-between gap-2 text-xs py-1">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(shared)}
                                onChange={() => toggleShareUser(u.id)}
                              />
                              <span className="font-medium">{u.displayName}</span>
                              <span className="text-[var(--text-muted)]">({u.username})</span>
                            </label>
                            {shared && (
                              <select
                                value={shared.permission}
                                onChange={(e) => setSharePermission(u.id, e.target.value as 'view' | 'edit')}
                                className="theme-input px-2 py-1 text-xs"
                              >
                                <option value="view">Nur lesen</option>
                                <option value="edit">Bearbeiten</option>
                              </select>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              <AttachmentsPanel
                entityType="event"
                entityId={editingEvent?.id || null}
                attachments={attachments}
                onChange={setAttachments}
                readOnly={readOnly}
              />

              <div className="pt-2 border-t border-[var(--border-hairline)] flex items-center justify-between gap-2">
                <div>
                  {editingEvent && isOwner && (
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
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
                  >
                    Abbrechen
                  </button>
                  {!readOnly && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="theme-btn-primary px-5 py-2 text-xs font-semibold disabled:opacity-60"
                    >
                      {saving ? 'Speichern...' : 'Speichern'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
