import { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Circle, Clock, Plus, Trash2, User, X } from 'lucide-react';
import { apiRequest } from '../api';
import type {
  AttachmentItem,
  ContactItem,
  EventItem,
  TaskItem,
  TaskPriority,
  TaskStatus,
} from '../types';
import { AttachmentsPanel } from './AttachmentsPanel';

interface TasksViewProps {
  tasks: TaskItem[];
  contacts: ContactItem[];
  events: EventItem[];
  searchQuery: string;
  onTasksChanged: () => Promise<void>;
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: 'Hoch',
  medium: 'Mittel',
  low: 'Niedrig',
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-emerald-600 dark:text-emerald-400',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  done: 'Erledigt',
};

export function TasksView({ tasks, contacts, events, searchQuery, onTasksChanged }: TasksViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [linkedContactId, setLinkedContactId] = useState('');
  const [linkedEventId, setLinkedEventId] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    });
  }, [tasks, statusFilter, searchQuery]);

  const todayIso = new Date().toISOString().slice(0, 10);

  function openNewTask() {
    setEditing(null);
    setTitle('');
    setDescription('');
    setDueDate(todayIso);
    setPriority('medium');
    setStatus('open');
    setLinkedContactId('');
    setLinkedEventId('');
    setAttachments([]);
    setError(null);
    setModalOpen(true);
  }

  function openEditTask(t: TaskItem) {
    setEditing(t);
    setTitle(t.title);
    setDescription(t.description || '');
    setDueDate(t.due_date || '');
    setPriority(t.priority);
    setStatus(t.status);
    setLinkedContactId(t.linked_contact_id || '');
    setLinkedEventId(t.linked_event_id || '');
    setAttachments(t.attachments || []);
    setError(null);
    setModalOpen(true);
  }

  async function toggleDone(t: TaskItem, e: React.MouseEvent) {
    e.stopPropagation();
    const nextStatus: TaskStatus = t.status === 'done' ? 'open' : 'done';
    await apiRequest(`/tasks/${t.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    await onTasksChanged();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description || null,
        dueDate: dueDate || null,
        priority,
        status,
        linkedContactId: linkedContactId || null,
        linkedEventId: linkedEventId || null,
      };
      if (editing) {
        await apiRequest(`/tasks/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/tasks', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      await onTasksChanged();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiRequest(`/tasks/${editing.id}`, { method: 'DELETE' });
      await onTasksChanged();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  const openCount = tasks.filter((t) => t.status === 'open').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Aufgabenverwaltung</h2>
          <p className="text-xs text-[var(--text-muted)] tabular-nums">
            {openCount} Offen · {inProgressCount} In Bearbeitung · {doneCount} Erledigt
          </p>
        </div>

        <button
          type="button"
          onClick={openNewTask}
          className="theme-btn-primary px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Aufgabe hinzufügen
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', 'Alle'],
            ['open', 'Offen'],
            ['in_progress', 'In Bearbeitung'],
            ['done', 'Erledigt'],
          ] as Array<['all' | TaskStatus, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === key
                ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                : 'bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="theme-card flex-1 overflow-auto divide-y divide-[var(--border-hairline)]">
        {filteredTasks.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-sm text-[var(--text-muted)]">Keine Aufgaben in dieser Kategorie.</p>
            <button
              type="button"
              onClick={openNewTask}
              className="theme-btn-primary px-4 py-2 text-xs font-semibold"
            >
              Erste Aufgabe anlegen
            </button>
          </div>
        ) : (
          filteredTasks.map((t) => {
            const isOverdue = Boolean(t.due_date && t.due_date < todayIso && t.status !== 'done');
            const contact = contacts.find((c) => c.id === t.linked_contact_id);
            const event = events.find((ev) => ev.id === t.linked_event_id);

            return (
              <div
                key={t.id}
                onClick={() => openEditTask(t)}
                className="p-4 hover:bg-[var(--bg-hover)]/50 cursor-pointer transition-colors flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => void toggleDone(t, e)}
                    aria-label="Status umschalten"
                    className="mt-0.5 shrink-0 text-[var(--accent)] hover:opacity-80"
                  >
                    {t.status === 'done' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle className="w-5 h-5 text-[var(--text-muted)]" />
                    )}
                  </button>
                  <div className="min-w-0 space-y-1">
                    <div
                      className={`text-sm font-semibold ${
                        t.status === 'done' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {t.title}
                    </div>
                    {t.description && (
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2">{t.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] tabular-nums">
                      <span className={`font-semibold ${PRIORITY_CLASS[t.priority]}`}>
                        Priorität: {PRIORITY_LABEL[t.priority]}
                      </span>
                      <span>·</span>
                      <span>{STATUS_LABEL[t.status]}</span>
                      {t.due_date && (
                        <>
                          <span>·</span>
                          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                            <Clock className="w-3.5 h-3.5" />
                            Frist: {new Date(t.due_date).toLocaleDateString('de-DE')}
                            {isOverdue ? ' (Überfällig)' : ''}
                          </span>
                        </>
                      )}
                      {contact && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            {contact.display_name}
                          </span>
                        </>
                      )}
                      {event && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {event.title}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {t.attachments.length > 0 && (
                  <span className="text-xs text-[var(--text-muted)] shrink-0 tabular-nums">
                    {t.attachments.length} Datei(en)
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Task Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="theme-card w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {editing ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300 text-xs">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Aufgabe</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Was ist zu erledigen?"
                  className="theme-input w-full px-3 py-2 text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Frist</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Priorität</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="high">Hoch</option>
                    <option value="medium">Mittel</option>
                    <option value="low">Niedrig</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="open">Offen</option>
                    <option value="in_progress">In Bearbeitung</option>
                    <option value="done">Erledigt</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Verknüpfter Kontakt</label>
                  <select
                    value={linkedContactId}
                    onChange={(e) => setLinkedContactId(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="">Keiner</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Verknüpfter Termin</label>
                  <select
                    value={linkedEventId}
                    onChange={(e) => setLinkedEventId(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="">Keiner</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Beschreibung</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <AttachmentsPanel
                entityType="task"
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
                    onClick={() => setModalOpen(false)}
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
