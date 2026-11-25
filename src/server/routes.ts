import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import QRCode from 'qrcode';
import {
  buildOtpAuthUri,
  generateBase32Secret,
  newId,
  signToken,
  verifyPassword,
  verifyToken,
  verifyTotpCode,
} from './crypto.ts';
import { BACKUPS_DIR, UPLOADS_DIR, db } from './db.ts';
import { contactToVcf, eventToIcs, parseSimpleVcf } from './dav.ts';
import { getLastAlertResult, sendMailNotification } from './mailer.ts';
import type {
  EntityType,
  EventShareInput,
  MariaDbConfig,
  SmtpConfig,
  TaskPriority,
  TaskStatus,
  ThemeMode,
  UserRecord,
  UserRole,
} from './types.ts';

interface AuthRequest extends Request {
  currentUser?: UserRecord;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
      cb(null, `${newId('file')}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Nicht angemeldet' });
    return;
  }
  const payload = verifyToken(token, 'session');
  if (!payload) {
    res.status(401).json({ error: 'Sitzung abgelaufen oder ungültig' });
    return;
  }
  const user = db.findUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'Benutzer nicht gefunden' });
    return;
  }
  req.currentUser = user;
  next();
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    res.status(403).json({ error: 'Nur Administratoren erlaubt' });
    return;
  }
  next();
}

function canAccessEntity(userId: string, entityType: EntityType, entityId: string, needWrite = false): boolean {
  if (entityType === 'event') {
    const perm = db.canUserAccessEvent(userId, entityId);
    if (!perm) return false;
    return needWrite ? perm === 'owner' || perm === 'edit' : true;
  }
  if (entityType === 'contact') {
    const c = db.getContactById(entityId);
    return Boolean(c && c.owner_id === userId);
  }
  if (entityType === 'task') {
    const t = db.getTaskById(entityId);
    return Boolean(t && t.owner_id === userId);
  }
  return false;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createApiRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '4mb' }));

  // ==================== PUBLIC AUTH & DB STATUS ====================

  router.get('/auth/status', (_req: Request, res: Response) => {
    res.json({
      needsBootstrap: db.countUsers() === 0,
      dbStatus: db.getDbStatus(),
    });
  });

  router.post('/auth/bootstrap', async (req: Request, res: Response) => {
    if (db.countUsers() > 0) {
      res.status(409).json({ error: 'System wurde bereits eingerichtet' });
      return;
    }
    const { username, displayName, email, password } = req.body as {
      username?: string;
      displayName?: string;
      email?: string;
      password?: string;
    };
    if (!username || username.trim().length < 2 || !password || password.length < 6) {
      res.status(400).json({ error: 'Benutzername (min. 2 Zeichen) und Passwort (min. 6 Zeichen) erforderlich' });
      return;
    }
    const created = await db.createUser({
      username: username.trim(),
      displayName: (displayName || username).trim(),
      email: (email || `${username.trim()}@localhost`).trim(),
      password,
      role: 'admin',
    });
    const token = signToken({ userId: created.id, username: created.username, role: created.role, kind: 'session' });
    res.status(201).json({ token, user: created, dbStatus: db.getDbStatus() });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
      return;
    }
    const user = db.findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort' });
      return;
    }

    if (user.totp_enabled && user.totp_secret) {
      const challengeToken = signToken(
        { userId: user.id, username: user.username, role: user.role, kind: '2fa_challenge' },
        300,
      );
      res.json({
        requires2fa: true,
        challengeToken,
        dbStatus: db.getDbStatus(),
      });
      return;
    }

    const token = signToken({ userId: user.id, username: user.username, role: user.role, kind: 'session' });
    res.json({
      requires2fa: false,
      token,
      user: db.toSafeUser(user),
      dbStatus: db.getDbStatus(),
    });
  });

  router.post('/auth/verify-2fa', (req: Request, res: Response) => {
    const { challengeToken, code } = req.body as { challengeToken?: string; code?: string };
    if (!challengeToken || !code) {
      res.status(400).json({ error: '2FA-Token und 6-stelliger Code erforderlich' });
      return;
    }
    const payload = verifyToken(challengeToken, '2fa_challenge');
    if (!payload) {
      res.status(401).json({ error: '2FA-Anfrage abgelaufen. Bitte erneut anmelden.' });
      return;
    }
    const user = db.findUserById(payload.userId);
    if (!user || !user.totp_enabled || !user.totp_secret) {
      res.status(400).json({ error: '2FA für diesen Benutzer nicht aktiv' });
      return;
    }
    if (!verifyTotpCode(user.totp_secret, code)) {
      res.status(401).json({ error: 'Ungültiger 2FA-Code' });
      return;
    }
    const token = signToken({ userId: user.id, username: user.username, role: user.role, kind: 'session' });
    res.json({
      token,
      user: db.toSafeUser(user),
      dbStatus: db.getDbStatus(),
    });
  });

  // ==================== AUTHENTICATED USER & 2FA ====================

  router.get('/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({
      user: db.toSafeUser(req.currentUser!),
      dbStatus: db.getDbStatus(),
    });
  });

  router.patch('/auth/preferences', requireAuth, async (req: AuthRequest, res: Response) => {
    const { preferredTheme, preferredDark, displayName, email } = req.body as {
      preferredTheme?: ThemeMode;
      preferredDark?: boolean;
      displayName?: string;
      email?: string;
    };
    const validThemes: ThemeMode[] = ['google', 'apple', 'batman'];
    const updated = await db.updateUser(req.currentUser!.id, {
      preferredTheme: preferredTheme && validThemes.includes(preferredTheme) ? preferredTheme : undefined,
      preferredDark: typeof preferredDark === 'boolean' ? preferredDark : undefined,
      displayName: displayName?.trim() || undefined,
      email: email?.trim() || undefined,
    });
    res.json({ user: updated });
  });

  router.post('/auth/2fa/setup', requireAuth, async (req: AuthRequest, res: Response) => {
    const user = req.currentUser!;
    const secret = generateBase32Secret();
    await db.updateUser(user.id, { totpSecret: secret, totpEnabled: false });
    const otpauthUri = buildOtpAuthUri(user.username, secret, 'ChronoDAV');
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 });
    res.json({ secret, otpauthUri, qrDataUrl });
  });

  router.post('/auth/2fa/enable', requireAuth, async (req: AuthRequest, res: Response) => {
    const user = db.findUserById(req.currentUser!.id)!;
    const { code } = req.body as { code?: string };
    if (!user.totp_secret) {
      res.status(400).json({ error: 'Bitte zuerst 2FA-Setup starten' });
      return;
    }
    if (!code || !verifyTotpCode(user.totp_secret, code)) {
      res.status(400).json({ error: 'Der 6-stellige Code ist ungültig' });
      return;
    }
    const updated = await db.updateUser(user.id, { totpEnabled: true });
    res.json({ user: updated });
  });

  router.post('/auth/2fa/disable', requireAuth, async (req: AuthRequest, res: Response) => {
    const user = db.findUserById(req.currentUser!.id)!;
    const { password } = req.body as { password?: string };
    if (!password || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Aktuelles Passwort zur Bestätigung erforderlich' });
      return;
    }
    const updated = await db.updateUser(user.id, { totpEnabled: false, totpSecret: null });
    res.json({ user: updated });
  });

  // ==================== SHAREABLE USERS DIRECTORY ====================

  router.get('/users/directory', requireAuth, (_req: AuthRequest, res: Response) => {
    const users = db.listUsers().map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
    }));
    res.json({ users });
  });

  // ==================== CALENDARS & EVENTS ====================

  router.get('/calendars', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({ calendars: db.listCalendars(req.currentUser!.id) });
  });

  router.post('/calendars', requireAuth, async (req: AuthRequest, res: Response) => {
    const { name, color, description } = req.body as { name?: string; color?: string; description?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Kalendername erforderlich' });
      return;
    }
    const created = await db.createCalendar({
      ownerId: req.currentUser!.id,
      name: name.trim(),
      color: color || '#1A73E8',
      description,
    });
    res.status(201).json({ calendar: created });
  });

  router.get('/events', requireAuth, (req: AuthRequest, res: Response) => {
    const events = db.listEventsForUser(req.currentUser!.id).map((ev) => ({
      ...ev,
      attachments: db.listAttachments('event', ev.id),
    }));
    res.json({ events });
  });

  router.post('/events', requireAuth, async (req: AuthRequest, res: Response) => {
    const body = req.body as {
      calendarId?: string;
      title?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      location?: string;
      addressStreet?: string;
      addressZip?: string;
      addressCity?: string;
      addressCountry?: string;
      addressLat?: number | null;
      addressLon?: number | null;
      color?: string;
      recurrenceRule?: string;
      shares?: EventShareInput[];
    };

    if (!body.title || !body.title.trim() || !body.startTime || !body.endTime) {
      res.status(400).json({ error: 'Titel, Startzeit und Endzeit sind erforderlich' });
      return;
    }

    const userCals = db.listCalendars(req.currentUser!.id);
    const calId = body.calendarId && userCals.some((c) => c.id === body.calendarId) ? body.calendarId : userCals[0]?.id;
    if (!calId) {
      res.status(400).json({ error: 'Kein Kalender vorhanden' });
      return;
    }

    const created = await db.createEvent({
      calendarId: calId,
      ownerId: req.currentUser!.id,
      title: body.title,
      description: body.description || null,
      startTime: body.startTime,
      endTime: body.endTime,
      allDay: Boolean(body.allDay),
      location: body.location || null,
      addressStreet: body.addressStreet || null,
      addressZip: body.addressZip || null,
      addressCity: body.addressCity || null,
      addressCountry: body.addressCountry || null,
      addressLat: typeof body.addressLat === 'number' ? body.addressLat : null,
      addressLon: typeof body.addressLon === 'number' ? body.addressLon : null,
      color: body.color || null,
      recurrenceRule: body.recurrenceRule || null,
      shares: Array.isArray(body.shares) ? body.shares : [],
    });

    res.status(201).json({
      event: {
        ...created,
        sharedPermission: 'owner',
        ownerName: req.currentUser!.display_name,
        shares: db.getEventShares(created.id),
        attachments: [],
      },
    });
  });

  router.put('/events/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const eventId = req.params.id;
    const perm = db.canUserAccessEvent(req.currentUser!.id, eventId);
    if (!perm) {
      res.status(404).json({ error: 'Termin nicht gefunden' });
      return;
    }
    if (perm !== 'owner' && perm !== 'edit') {
      res.status(403).json({ error: 'Keine Bearbeitungsberechtigung für diesen geteilten Termin' });
      return;
    }

    const body = req.body as {
      calendarId?: string;
      title?: string;
      description?: string | null;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      location?: string | null;
      addressStreet?: string | null;
      addressZip?: string | null;
      addressCity?: string | null;
      addressCountry?: string | null;
      addressLat?: number | null;
      addressLon?: number | null;
      color?: string | null;
      recurrenceRule?: string | null;
      shares?: EventShareInput[];
    };

    const updated = await db.updateEvent(eventId, {
      ...body,
      shares: perm === 'owner' ? body.shares : undefined,
    });
    res.json({
      event: {
        ...updated,
        sharedPermission: perm,
        shares: db.getEventShares(eventId),
        attachments: db.listAttachments('event', eventId),
      },
    });
  });

  router.delete('/events/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const ev = db.getEventById(req.params.id);
    if (!ev) {
      res.status(404).json({ error: 'Termin nicht gefunden' });
      return;
    }
    if (ev.owner_id !== req.currentUser!.id) {
      res.status(403).json({ error: 'Nur der Ersteller kann den Termin löschen' });
      return;
    }
    await db.deleteEvent(ev.id);
    res.json({ deleted: true });
  });

  router.get('/events/:id/ics', requireAuth, (req: AuthRequest, res: Response) => {
    const perm = db.canUserAccessEvent(req.currentUser!.id, req.params.id);
    if (!perm) {
      res.status(404).json({ error: 'Termin nicht gefunden' });
      return;
    }
    const ev = db.getEventById(req.params.id)!;
    res.setHeader('Content-Disposition', `attachment; filename="${ev.id}.ics"`);
    res.type('text/calendar; charset=utf-8').send(eventToIcs(ev));
  });

  // ==================== CONTACTS ====================

  router.get('/contacts', requireAuth, (req: AuthRequest, res: Response) => {
    const contacts = db.listContacts(req.currentUser!.id).map((c) => ({
      ...c,
      attachments: db.listAttachments('contact', c.id),
    }));
    res.json({ contacts });
  });

  router.post('/contacts', requireAuth, async (req: AuthRequest, res: Response) => {
    const body = req.body as {
      firstName?: string;
      lastName?: string;
      company?: string;
      jobTitle?: string;
      emails?: Array<{ label: string; value: string }>;
      phones?: Array<{ label: string; value: string }>;
      addressStreet?: string;
      addressZip?: string;
      addressCity?: string;
      addressCountry?: string;
      addressLat?: number | null;
      addressLon?: number | null;
      birthday?: string;
      notes?: string;
      labels?: string[];
      isFavorite?: boolean;
    };

    if (!body.firstName?.trim() && !body.lastName?.trim() && !body.company?.trim()) {
      res.status(400).json({ error: 'Vorname, Nachname oder Firma erforderlich' });
      return;
    }

    const created = await db.createContact({
      ownerId: req.currentUser!.id,
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      company: body.company || null,
      jobTitle: body.jobTitle || null,
      emails: Array.isArray(body.emails) ? body.emails : [],
      phones: Array.isArray(body.phones) ? body.phones : [],
      addressStreet: body.addressStreet || null,
      addressZip: body.addressZip || null,
      addressCity: body.addressCity || null,
      addressCountry: body.addressCountry || null,
      addressLat: typeof body.addressLat === 'number' ? body.addressLat : null,
      addressLon: typeof body.addressLon === 'number' ? body.addressLon : null,
      birthday: body.birthday || null,
      notes: body.notes || null,
      labels: Array.isArray(body.labels) ? body.labels : [],
      isFavorite: Boolean(body.isFavorite),
    });

    res.status(201).json({ contact: { ...created, attachments: [] } });
  });

  router.put('/contacts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const existing = db.getContactById(req.params.id);
    if (!existing || existing.owner_id !== req.currentUser!.id) {
      res.status(404).json({ error: 'Kontakt nicht gefunden' });
      return;
    }
    const updated = await db.updateContact(existing.id, req.body);
    res.json({
      contact: {
        ...updated,
        attachments: db.listAttachments('contact', existing.id),
      },
    });
  });

  router.delete('/contacts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const existing = db.getContactById(req.params.id);
    if (!existing || existing.owner_id !== req.currentUser!.id) {
      res.status(404).json({ error: 'Kontakt nicht gefunden' });
      return;
    }
    await db.deleteContact(existing.id);
    res.json({ deleted: true });
  });

  router.get('/contacts/export/vcf', requireAuth, (req: AuthRequest, res: Response) => {
    const contacts = db.listContacts(req.currentUser!.id);
    res.setHeader('Content-Disposition', 'attachment; filename="chronodav-contacts.vcf"');
    res.type('text/vcard; charset=utf-8').send(contacts.map(contactToVcf).join('\r\n'));
  });

  router.post('/contacts/import/vcf', requireAuth, async (req: AuthRequest, res: Response) => {
    const { vcfContent } = req.body as { vcfContent?: string };
    if (!vcfContent) {
      res.status(400).json({ error: 'vCard-Inhalt fehlt' });
      return;
    }
    const parsed = parseSimpleVcf(vcfContent);
    const createdCount = parsed.length;
    for (const c of parsed) {
      await db.createContact({
        ownerId: req.currentUser!.id,
        ...c,
      });
    }
    res.json({ imported: createdCount });
  });

  // ==================== TASKS ====================

  router.get('/tasks', requireAuth, (req: AuthRequest, res: Response) => {
    const tasks = db.listTasks(req.currentUser!.id).map((t) => ({
      ...t,
      attachments: db.listAttachments('task', t.id),
    }));
    res.json({ tasks });
  });

  router.post('/tasks', requireAuth, async (req: AuthRequest, res: Response) => {
    const body = req.body as {
      title?: string;
      description?: string;
      dueDate?: string | null;
      priority?: TaskPriority;
      status?: TaskStatus;
      linkedContactId?: string | null;
      linkedEventId?: string | null;
    };
    if (!body.title || !body.title.trim()) {
      res.status(400).json({ error: 'Aufgabentitel erforderlich' });
      return;
    }
    const created = await db.createTask({
      ownerId: req.currentUser!.id,
      title: body.title,
      description: body.description || null,
      dueDate: body.dueDate || null,
      priority: body.priority || 'medium',
      status: body.status || 'open',
      linkedContactId: body.linkedContactId || null,
      linkedEventId: body.linkedEventId || null,
    });
    res.status(201).json({ task: { ...created, attachments: [] } });
  });

  router.put('/tasks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const existing = db.getTaskById(req.params.id);
    if (!existing || existing.owner_id !== req.currentUser!.id) {
      res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      return;
    }
    const updated = await db.updateTask(existing.id, req.body);
    res.json({
      task: {
        ...updated,
        attachments: db.listAttachments('task', existing.id),
      },
    });
  });

  router.delete('/tasks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const existing = db.getTaskById(req.params.id);
    if (!existing || existing.owner_id !== req.currentUser!.id) {
      res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      return;
    }
    await db.deleteTask(existing.id);
    res.json({ deleted: true });
  });

  // ==================== ATTACHMENTS ====================

  router.post('/attachments/:entityType/:entityId', requireAuth, upload.single('file'), async (req: AuthRequest, res: Response) => {
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId;
    if (!['event', 'contact', 'task'].includes(entityType)) {
      res.status(400).json({ error: 'Ungültiger Entitätstyp' });
      return;
    }
    if (!canAccessEntity(req.currentUser!.id, entityType, entityId, true)) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
      }
      res.status(403).json({ error: 'Keine Berechtigung für diesen Datensatz' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Keine Datei hochgeladen' });
      return;
    }

    const att = await db.createAttachment({
      ownerId: req.currentUser!.id,
      entityType,
      entityId,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype || 'application/octet-stream',
      sizeBytes: req.file.size,
    });
    res.status(201).json({ attachment: att });
  });

  router.get('/attachments/:id/download', requireAuth, (req: AuthRequest, res: Response) => {
    const att = db.getAttachmentById(req.params.id);
    if (!att) {
      res.status(404).json({ error: 'Datei nicht gefunden' });
      return;
    }
    if (!canAccessEntity(req.currentUser!.id, att.entity_type, att.entity_id, false)) {
      res.status(403).json({ error: 'Zugriff verweigert' });
      return;
    }
    const resolved = path.resolve(UPLOADS_DIR, att.stored_name);
    if (!resolved.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Datei nicht auf Datenträger gefunden' });
      return;
    }
    res.download(resolved, att.original_name);
  });

  router.delete('/attachments/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    const att = db.getAttachmentById(req.params.id);
    if (!att) {
      res.status(404).json({ error: 'Anhang nicht gefunden' });
      return;
    }
    if (!canAccessEntity(req.currentUser!.id, att.entity_type, att.entity_id, true)) {
      res.status(403).json({ error: 'Keine Berechtigung' });
      return;
    }
    await db.deleteAttachment(att.id);
    res.json({ deleted: true });
  });

  // ==================== ADDRESS LOOKUP (NOMINATIM) ====================

  router.get('/geocode', requireAuth, async (req: AuthRequest, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 3 || q.length > 200) {
      res.json({ results: [] });
      return;
    }
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '6');
      url.searchParams.set('accept-language', 'de');
      url.searchParams.set('q', q);

      const resp = await fetch(url.toString(), {
        headers: { 'User-Agent': 'ChronoDAV-CalDAV-Suite/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        res.json({ results: [] });
        return;
      }
      const raw = (await resp.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        address?: {
          road?: string;
          pedestrian?: string;
          house_number?: string;
          postcode?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          country?: string;
        };
      }>;

      const results = raw.map((item) => {
        const a = item.address || {};
        const road = a.road || a.pedestrian || '';
        const street = [road, a.house_number].filter(Boolean).join(' ');
        const city = a.city || a.town || a.village || a.municipality || '';
        return {
          displayName: item.display_name,
          street,
          zip: a.postcode || '',
          city,
          country: a.country || '',
          lat: Number(item.lat),
          lon: Number(item.lon),
        };
      });
      res.json({ results });
    } catch {
      res.json({ results: [] });
    }
  });

  // ==================== MOBILE SYNC & QR ====================

  router.get('/sync/info', requireAuth, async (req: AuthRequest, res: Response) => {
    const user = req.currentUser!;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
    const baseUrl = `${proto}://${host}`;
    const cals = db.listCalendars(user.id);
    const defaultCalId = cals[0]?.id || 'default';
    const encodedUser = encodeURIComponent(user.username);

    const davDiscoveryUrl = `${baseUrl}/dav/`;
    const caldavUrl = `${baseUrl}/dav/calendars/${encodedUser}/${encodeURIComponent(defaultCalId)}/`;
    const carddavUrl = `${baseUrl}/dav/addressbooks/${encodedUser}/contacts/`;
    const principalUrl = `${baseUrl}/dav/principals/${encodedUser}/`;

    const qrCodeDataUrl = await QRCode.toDataURL(davDiscoveryUrl, { width: 220, margin: 1 });
    const carddavQrDataUrl = await QRCode.toDataURL(carddavUrl, { width: 220, margin: 1 });

    res.json({
      username: user.username,
      baseUrl,
      davDiscoveryUrl,
      principalUrl,
      caldavUrl,
      carddavUrl,
      qrCodeDataUrl,
      carddavQrDataUrl,
    });
  });

  router.get('/sync/mobileconfig', requireAuth, (req: AuthRequest, res: Response) => {
    const user = req.currentUser!;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
    const isSsl = proto === 'https';
    const hostOnly = host.split(':')[0];
    const port = host.includes(':') ? Number(host.split(':')[1]) : isSsl ? 443 : 80;
    const encodedUser = encodeURIComponent(user.username);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>CalDAVAccountDescription</key>
      <string>ChronoDAV Kalender (${xmlEscape(user.username)})</string>
      <key>CalDAVHostName</key>
      <string>${xmlEscape(hostOnly)}</string>
      <key>CalDAVPort</key>
      <integer>${port}</integer>
      <key>CalDAVPrincipalURL</key>
      <string>/dav/principals/${encodedUser}/</string>
      <key>CalDAVUseSSL</key>
      <${isSsl ? 'true' : 'false'}/>
      <key>CalDAVUsername</key>
      <string>${xmlEscape(user.username)}</string>
      <key>PayloadDisplayName</key>
      <string>ChronoDAV CalDAV</string>
      <key>PayloadIdentifier</key>
      <string>local.chronodav.caldav.${xmlEscape(user.id)}</string>
      <key>PayloadType</key>
      <string>com.apple.caldav.account</string>
      <key>PayloadUUID</key>
      <string>${newId('caldav')}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
    <dict>
      <key>CardDAVAccountDescription</key>
      <string>ChronoDAV Kontakte (${xmlEscape(user.username)})</string>
      <key>CardDAVHostName</key>
      <string>${xmlEscape(hostOnly)}</string>
      <key>CardDAVPort</key>
      <integer>${port}</integer>
      <key>CardDAVPrincipalURL</key>
      <string>/dav/principals/${encodedUser}/</string>
      <key>CardDAVUseSSL</key>
      <${isSsl ? 'true' : 'false'}/>
      <key>CardDAVUsername</key>
      <string>${xmlEscape(user.username)}</string>
      <key>PayloadDisplayName</key>
      <string>ChronoDAV CardDAV</string>
      <key>PayloadIdentifier</key>
      <string>local.chronodav.carddav.${xmlEscape(user.id)}</string>
      <key>PayloadType</key>
      <string>com.apple.carddav.account</string>
      <key>PayloadUUID</key>
      <string>${newId('carddav')}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>ChronoDAV Sync (${xmlEscape(user.username)})</string>
  <key>PayloadIdentifier</key>
  <string>local.chronodav.profile.${xmlEscape(user.id)}</string>
  <key>PayloadOrganization</key>
  <string>ChronoDAV</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${newId('profile')}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;

    res.setHeader('Content-Disposition', `attachment; filename="chronodav-${user.username}.mobileconfig"`);
    res.type('application/x-apple-aspen-config; charset=utf-8').send(xml);
  });

  // ==================== ADMIN: USERS, DB, BACKUPS, SMTP ====================

  router.get('/admin/users', requireAuth, requireAdmin, (_req: AuthRequest, res: Response) => {
    res.json({ users: db.listUsers() });
  });

  router.post('/admin/users', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const { username, displayName, email, password, role } = req.body as {
      username?: string;
      displayName?: string;
      email?: string;
      password?: string;
      role?: UserRole;
    };
    if (!username || username.trim().length < 2 || !password || password.length < 6) {
      res.status(400).json({ error: 'Benutzername (min. 2 Zeichen) und Passwort (min. 6 Zeichen) erforderlich' });
      return;
    }
    if (db.findUserByUsername(username)) {
      res.status(409).json({ error: 'Benutzername existiert bereits' });
      return;
    }
    const created = await db.createUser({
      username: username.trim(),
      displayName: (displayName || username).trim(),
      email: (email || `${username.trim()}@localhost`).trim(),
      password,
      role: role === 'admin' ? 'admin' : 'user',
    });
    res.status(201).json({ user: created });
  });

  router.put('/admin/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const { displayName, email, role, password, reset2fa } = req.body as {
      displayName?: string;
      email?: string;
      role?: UserRole;
      password?: string;
      reset2fa?: boolean;
    };
    const updated = await db.updateUser(req.params.id, {
      displayName,
      email,
      role: role === 'admin' || role === 'user' ? role : undefined,
      password: password && password.length >= 6 ? password : undefined,
      totpEnabled: reset2fa ? false : undefined,
      totpSecret: reset2fa ? null : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    res.json({ user: updated });
  });

  router.delete('/admin/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    if (req.params.id === req.currentUser!.id) {
      res.status(400).json({ error: 'Sie können Ihr eigenes Admin-Konto nicht löschen' });
      return;
    }
    const deleted = await db.deleteUser(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    res.json({ deleted: true });
  });

  router.get('/admin/db', requireAuth, requireAdmin, (_req: AuthRequest, res: Response) => {
    const cfg = db.getMariaDbConfig();
    let schemaSql = '';
    try {
      schemaSql = fs.readFileSync(path.join(process.cwd(), 'db', 'mariadb_schema.sql'), 'utf8');
    } catch {
      schemaSql = '';
    }
    res.json({
      dbStatus: db.getDbStatus(),
      mariadbConfig: {
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password ? '••••••••' : '',
        hasPassword: Boolean(cfg.password),
        database: cfg.database,
      },
      syncLogs: db.getSyncLogs(30),
      schemaSql,
    });
  });

  router.put('/admin/db/config', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const body = req.body as Partial<MariaDbConfig>;
    const current = db.getMariaDbConfig();
    const nextCfg: MariaDbConfig = {
      host: body.host !== undefined ? body.host.trim() : current.host,
      port: Number(body.port || current.port || 3306),
      user: body.user !== undefined ? body.user.trim() : current.user,
      password:
        body.password !== undefined && body.password !== '••••••••' ? body.password : current.password,
      database: body.database !== undefined ? body.database.trim() : current.database,
    };
    const dbStatus = await db.saveMariaDbConfig(nextCfg);
    res.json({ dbStatus, syncLogs: db.getSyncLogs(30) });
  });

  router.post('/admin/db/test', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
    await db.connectMariaDb();
    res.json({ dbStatus: db.getDbStatus(), syncLogs: db.getSyncLogs(30) });
  });

  router.post('/admin/db/sync', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
    await db.checkMariaDbHealth();
    const synced = await db.syncPendingToMaster();
    if (synced > 0) {
      db.addSyncLog('manual_sync', `Manueller Master-Sync abgeschlossen (${synced} Datensätze).`, synced);
    }
    res.json({ synced, dbStatus: db.getDbStatus(), syncLogs: db.getSyncLogs(30) });
  });

  router.post('/admin/db/simulate-outage', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const { active } = req.body as { active?: boolean };
    const dbStatus = await db.setSimulatedOutage(Boolean(active));
    res.json({ dbStatus, syncLogs: db.getSyncLogs(30) });
  });

  router.get('/admin/backups', requireAuth, requireAdmin, (_req: AuthRequest, res: Response) => {
    res.json({
      backups: db.listBackupFiles(),
      intervalMinutes: db.getBackupIntervalMinutes(),
      lastBackupAt: db.getDbStatus().lastBackupAt,
    });
  });

  router.put('/admin/backups/interval', requireAuth, requireAdmin, (req: AuthRequest, res: Response) => {
    const { intervalMinutes } = req.body as { intervalMinutes?: number };
    db.setBackupIntervalMinutes(Number(intervalMinutes || 60));
    res.json({ intervalMinutes: db.getBackupIntervalMinutes() });
  });

  router.post('/admin/backups/run', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
    const info = await db.createBackupSnapshot('manual');
    res.status(201).json({ backup: info, backups: db.listBackupFiles() });
  });

  router.get('/admin/backups/:filename/download', requireAuth, requireAdmin, (req: AuthRequest, res: Response) => {
    const filename = path.basename(req.params.filename);
    if (!filename.endsWith('.sqlite')) {
      res.status(400).json({ error: 'Ungültiger Dateiname' });
      return;
    }
    const resolved = path.resolve(BACKUPS_DIR, filename);
    if (!resolved.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Backup-Datei nicht gefunden' });
      return;
    }
    res.download(resolved, filename);
  });

  router.get('/admin/smtp', requireAuth, requireAdmin, (_req: AuthRequest, res: Response) => {
    const cfg = db.getSmtpConfig();
    res.json({
      smtpConfig: {
        ...cfg,
        pass: cfg.pass ? '••••••••' : '',
        hasPass: Boolean(cfg.pass),
      },
      lastAlertResult: getLastAlertResult(),
    });
  });

  router.put('/admin/smtp', requireAuth, requireAdmin, (req: AuthRequest, res: Response) => {
    const body = req.body as Partial<SmtpConfig>;
    const cur = db.getSmtpConfig();
    const updated = db.saveSmtpConfig({
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : cur.enabled,
      host: body.host !== undefined ? body.host.trim() : cur.host,
      port: Number(body.port || cur.port || 587),
      secure: body.secure !== undefined ? Boolean(body.secure) : cur.secure,
      user: body.user !== undefined ? body.user.trim() : cur.user,
      pass: body.pass !== undefined && body.pass !== '••••••••' ? body.pass : cur.pass,
      from: body.from !== undefined ? body.from.trim() : cur.from,
      alertTo: body.alertTo !== undefined ? body.alertTo.trim() : cur.alertTo,
    });
    res.json({
      smtpConfig: {
        ...updated,
        pass: updated.pass ? '••••••••' : '',
        hasPass: Boolean(updated.pass),
      },
    });
  });

  router.post('/admin/smtp/test', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
    const cfg = db.getSmtpConfig();
    const result = await sendMailNotification(
      { ...cfg, enabled: true },
      '[ChronoDAV TEST] SMTP-Benachrichtigung funktioniert',
      'Dies ist eine Test-E-Mail von ChronoDAV für MariaDB-Verbindungsabbrüche.',
      '<p>Dies ist eine Test-E-Mail von <strong>ChronoDAV</strong> für MariaDB-Verbindungsabbrüche.</p>',
    );
    res.json({ result });
  });

  return router;
}
