import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Database,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, setAuthToken } from './api';
import { AdminView } from './components/AdminView';
import { CalendarView } from './components/CalendarView';
import { ContactsView } from './components/ContactsView';
import { LoginView } from './components/LoginView';
import { MobileSyncView } from './components/MobileSyncView';
import { Security2FAView } from './components/Security2FAView';
import { TasksView } from './components/TasksView';
import type {
  CalendarItem,
  ContactItem,
  DbStatus,
  DirectoryUser,
  EventItem,
  SafeUser,
  TaskItem,
  ThemeMode,
} from './types';

type ActiveSection = 'calendar' | 'contacts' | 'tasks' | 'sync' | 'security' | 'admin';

const MINI_WEEKDAYS = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

export default function App() {
  const [loadingInit, setLoadingInit] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [user, setUser] = useState<SafeUser | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus>({
    mode: 'sqlite_failover',
    mariadbConfigured: false,
    mariadbReachable: false,
    simulatedOutage: false,
    lastError: null,
    lastSyncAt: null,
    pendingSyncCount: 0,
    lastBackupAt: null,
    backupIntervalMinutes: 60,
    failoverBanner: 'Achtung DB nciht erreeichbar, es wird auf SQLITE ( Backup ) zugegriffen',
  });

  // UI Theme & Dark Mode (mandatory Dark Mode default enabled, synced to <html class="dark" data-theme="...">)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('chronodav_theme');
    return saved === 'apple' || saved === 'batman' ? saved : 'google';
  });
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('chronodav_dark');
    return saved === null ? true : saved === 'true';
  });

  const [section, setSection] = useState<ActiveSection>('calendar');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Workspace Data
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);

  // New calendar inline state
  const [addingCal, setAddingCal] = useState(false);
  const [newCalName, setNewCalName] = useState('');

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (dark) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('chronodav_theme', theme);
    localStorage.setItem('chronodav_dark', String(dark));
  }, [theme, dark]);

  useEffect(() => {
    void apiRequest<{ needsBootstrap: boolean; dbStatus: DbStatus }>('/auth/status')
      .then((res) => {
        setNeedsBootstrap(res.needsBootstrap);
        setDbStatus(res.dbStatus);
      })
      .finally(() => setLoadingInit(false));
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    const [calRes, evtRes, cntRes, tskRes, dirRes] = await Promise.all([
      apiRequest<{ calendars: CalendarItem[] }>('/calendars'),
      apiRequest<{ events: EventItem[] }>('/events'),
      apiRequest<{ contacts: ContactItem[] }>('/contacts'),
      apiRequest<{ tasks: TaskItem[] }>('/tasks'),
      apiRequest<{ users: DirectoryUser[] }>('/users/directory'),
    ]);
    setCalendars(calRes.calendars);
    setVisibleCalendarIds((prev) =>
      prev.length > 0 ? prev : calRes.calendars.map((c) => c.id),
    );
    setEvents(evtRes.events);
    setContacts(cntRes.contacts);
    setTasks(tskRes.tasks);
    setDirectoryUsers(dirRes.users);
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadWorkspaceData();
    const timer = setInterval(() => {
      void apiRequest<{ user: SafeUser; dbStatus: DbStatus }>('/auth/me')
        .then((res) => setDbStatus(res.dbStatus))
        .catch(() => {
          // ignore transient error
        });
    }, 20_000);
    return () => clearInterval(timer);
  }, [user, loadWorkspaceData]);

  async function handleThemeChange(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    if (user) {
      await apiRequest('/auth/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ preferredTheme: nextTheme }),
      }).catch(() => {});
    }
  }

  async function handleToggleDark() {
    const next = !dark;
    setDark(next);
    if (user) {
      await apiRequest('/auth/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ preferredDark: next }),
      }).catch(() => {});
    }
  }

  function handleLogout() {
    setAuthToken(null);
    setUser(null);
    setSection('calendar');
    void apiRequest<{ needsBootstrap: boolean; dbStatus: DbStatus }>('/auth/status').then((res) => {
      setNeedsBootstrap(res.needsBootstrap);
      setDbStatus(res.dbStatus);
    });
  }

  async function handleCreateCalendar(e: React.FormEvent) {
    e.preventDefault();
    if (!newCalName.trim()) return;
    const res = await apiRequest<{ calendar: CalendarItem }>('/calendars', {
      method: 'POST',
      body: JSON.stringify({ name: newCalName.trim(), color: '#0B8043' }),
    });
    setCalendars((prev) => [...prev, res.calendar]);
    setVisibleCalendarIds((prev) => [...prev, res.calendar.id]);
    setNewCalName('');
    setAddingCal(false);
  }

  const miniCalDays = useMemo(() => {
    const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  if (loadingInit) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-muted)] text-sm">
        ChronoDAV wird initialisiert...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        needsBootstrap={needsBootstrap}
        dbStatus={dbStatus}
        theme={theme}
        dark={dark}
        onChangeTheme={(t) => void handleThemeChange(t)}
        onToggleDark={() => void handleToggleDark()}
        onAuthenticated={(authUser, status) => {
          setUser(authUser);
          setDbStatus(status);
          setNeedsBootstrap(false);
          setTheme(authUser.preferredTheme);
          setDark(authUser.preferredDark);
        }}
      />
    );
  }

  const navItems: Array<{ id: ActiveSection; label: string; icon: typeof Calendar; adminOnly?: boolean }> = [
    { id: 'calendar', label: 'Kalender', icon: Calendar },
    { id: 'contacts', label: 'Kontakte', icon: Users },
    { id: 'tasks', label: 'Aufgaben', icon: CheckSquare },
    { id: 'sync', label: 'Mobil-Sync', icon: Smartphone },
    { id: 'security', label: 'Sicherheit & 2FA', icon: ShieldCheck },
    { id: 'admin', label: 'Admin & DB', icon: Settings, adminOnly: true },
  ];

  const today = new Date();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Persistent DB Failover Banner */}
      {dbStatus.failoverBanner && (
        <div
          role="alert"
          className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 text-amber-800 dark:text-amber-200 text-xs font-semibold flex flex-wrap items-center justify-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{dbStatus.failoverBanner}</span>
          {dbStatus.pendingSyncCount > 0 && (
            <span className="tabular-nums opacity-85">
              ({dbStatus.pendingSyncCount} ausstehend für Master-Sync)
            </span>
          )}
        </div>
      )}

      {/* Top Header Bar */}
      <header className="h-16 px-4 sm:px-6 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Menü"
            className="lg:hidden p-2 rounded-lg hover:bg-[var(--bg-hover)]"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--accent)] text-[var(--accent-fg)]">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-base font-bold tracking-tight whitespace-nowrap">ChronoDAV</span>
          </div>

          <div className="relative hidden md:block w-72 lg:w-96 ml-4">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Termine, Kontakte, Aufgaben durchsuchen..."
              className="theme-input w-full pl-9 pr-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Theme Switcher: Google / Apple / Batman */}
          <div className="flex items-center p-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface-2)]/60">
            {(['google', 'apple', 'batman'] as ThemeMode[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => void handleThemeChange(t)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
            onClick={() => void handleToggleDark()}
            aria-label="Dark Mode umschalten"
            className="p-2 rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[var(--border-hairline)]">
            <div className="text-right leading-tight">
              <div className="text-xs font-semibold truncate max-w-[140px]">{user.displayName}</div>
              <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-end gap-1">
                <Database className="w-3 h-3" />
                {dbStatus.mariadbReachable ? 'MariaDB' : 'SQLite Backup'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Abmelden"
              className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'fixed inset-y-0 left-0 z-40 translate-x-0' : 'hidden lg:flex'
          } w-64 shrink-0 flex-col gap-5 p-4 border-r border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-y-auto`}
        >
          <div className="flex items-center justify-between lg:hidden">
            <span className="font-bold text-sm">Navigation</span>
            <button type="button" onClick={() => setSidebarOpen(false)} className="p-1.5 rounded hover:bg-[var(--bg-hover)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Search */}
          <div className="relative md:hidden">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Suchen..."
              className="theme-input w-full pl-9 pr-3 py-1.5 text-xs"
            />
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems
              .filter((item) => !item.adminOnly || user.role === 'admin')
              .map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-soft-fg)] font-semibold'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
          </nav>

          {/* Mini Calendar */}
          <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold tabular-nums">
                {selectedDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
              </span>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1))}
                  className="p-1 rounded hover:bg-[var(--bg-hover)]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1))}
                  className="p-1 rounded hover:bg-[var(--bg-hover)]"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
              {MINI_WEEKDAYS.map((wd, i) => (
                <div key={i} className="text-[var(--text-muted)] font-medium">
                  {wd}
                </div>
              ))}
              {miniCalDays.map((d, idx) => {
                const inMonth = d.getMonth() === selectedDate.getMonth();
                const isToday =
                  d.getFullYear() === today.getFullYear() &&
                  d.getMonth() === today.getMonth() &&
                  d.getDate() === today.getDate();
                const isSel =
                  d.getFullYear() === selectedDate.getFullYear() &&
                  d.getMonth() === selectedDate.getMonth() &&
                  d.getDate() === selectedDate.getDate();
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSelectedDate(d);
                      setSection('calendar');
                    }}
                    className={`w-6 h-6 mx-auto rounded-full tabular-nums flex items-center justify-center transition-colors ${
                      isToday
                        ? 'bg-[var(--accent)] text-[var(--accent-fg)] font-bold'
                        : isSel
                          ? 'bg-[var(--accent-soft)] text-[var(--accent-soft-fg)] font-semibold'
                          : inMonth
                            ? 'hover:bg-[var(--bg-hover)]'
                            : 'opacity-40'
                    }`}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calendars List */}
          <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Meine Kalender</span>
              <button
                type="button"
                onClick={() => setAddingCal(!addingCal)}
                title="Neuer Kalender"
                className="p-1 rounded hover:bg-[var(--bg-hover)]"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {addingCal && (
              <form onSubmit={(e) => void handleCreateCalendar(e)} className="flex gap-1.5">
                <input
                  type="text"
                  value={newCalName}
                  onChange={(e) => setNewCalName(e.target.value)}
                  placeholder="Kalendername"
                  className="theme-input flex-1 px-2 py-1 text-xs"
                />
                <button type="submit" className="theme-btn-primary px-2.5 py-1 text-xs font-semibold">
                  OK
                </button>
              </form>
            )}

            <div className="space-y-1">
              {calendars.map((c) => {
                const checked = visibleCalendarIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer rounded hover:bg-[var(--bg-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setVisibleCalendarIds((prev) =>
                          checked ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                        )
                      }
                    />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="truncate">{c.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-auto pt-3 border-t border-[var(--border-hairline)] sm:hidden">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)]"
            >
              <LogOut className="w-4 h-4" />
              Abmelden ({user.username})
            </button>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
          {section === 'calendar' && (
            <CalendarView
              selectedDate={selectedDate}
              onChangeDate={setSelectedDate}
              calendars={calendars}
              visibleCalendarIds={visibleCalendarIds}
              events={events}
              directoryUsers={directoryUsers}
              currentUserId={user.id}
              searchQuery={searchQuery}
              externalCreateTrigger={0}
              onEventsChanged={loadWorkspaceData}
            />
          )}

          {section === 'contacts' && (
            <ContactsView
              contacts={contacts}
              searchQuery={searchQuery}
              onContactsChanged={loadWorkspaceData}
            />
          )}

          {section === 'tasks' && (
            <TasksView
              tasks={tasks}
              contacts={contacts}
              events={events}
              searchQuery={searchQuery}
              onTasksChanged={loadWorkspaceData}
            />
          )}

          {section === 'sync' && <MobileSyncView />}

          {section === 'security' && (
            <Security2FAView user={user} onUserUpdated={(u) => setUser(u)} />
          )}

          {section === 'admin' && user.role === 'admin' && (
            <AdminView
              currentUser={user}
              onDbStatusChanged={(s) => setDbStatus(s)}
              onUsersChanged={loadWorkspaceData}
            />
          )}
        </main>
      </div>
    </div>
  );
}
