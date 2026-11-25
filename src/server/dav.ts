import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { verifyPassword } from './crypto.ts';
import { db } from './db.ts';
import type { ContactRecord, EventRecord, UserRecord } from './types.ts';

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatIcsDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.replace(/[-:]/g, '').slice(0, allDay ? 8 : 15) + (allDay ? '' : 'Z');
  }
  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}

function escapeIcsText(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function unescapeIcsText(val: string): string {
  return val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export function eventToIcs(ev: EventRecord): string {
  const dtStartProp = ev.all_day ? `DTSTART;VALUE=DATE:${formatIcsDate(ev.start_time, true)}` : `DTSTART:${formatIcsDate(ev.start_time, false)}`;
  const dtEndProp = ev.all_day ? `DTEND;VALUE=DATE:${formatIcsDate(ev.end_time, true)}` : `DTEND:${formatIcsDate(ev.end_time, false)}`;
  const addressParts = [ev.address_street, ev.address_zip, ev.address_city, ev.address_country]
    .filter(Boolean)
    .join(', ');
  const fullLoc = ev.location || addressParts;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChronoDAV//CalDAV Server//DE',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${formatIcsDate(ev.updated_at, false)}`,
    dtStartProp,
    dtEndProp,
    `SUMMARY:${escapeIcsText(ev.title)}`,
  ];

  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (fullLoc) lines.push(`LOCATION:${escapeIcsText(fullLoc)}`);
  if (ev.address_lat !== null && ev.address_lon !== null) {
    lines.push(`GEO:${ev.address_lat};${ev.address_lon}`);
  }
  if (ev.recurrence_rule) lines.push(`RRULE:${ev.recurrence_rule}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function contactToVcf(c: ContactRecord): string {
  let emails: Array<{ label: string; value: string }> = [];
  let phones: Array<{ label: string; value: string }> = [];
  let labels: string[] = [];
  try {
    emails = JSON.parse(c.emails_json) as Array<{ label: string; value: string }>;
  } catch {
    emails = [];
  }
  try {
    phones = JSON.parse(c.phones_json) as Array<{ label: string; value: string }>;
  } catch {
    phones = [];
  }
  try {
    labels = JSON.parse(c.labels_json) as string[];
  } catch {
    labels = [];
  }

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${c.uid}`,
    `FN:${escapeIcsText(c.display_name)}`,
    `N:${escapeIcsText(c.last_name)};${escapeIcsText(c.first_name)};;;`,
  ];

  if (c.company) lines.push(`ORG:${escapeIcsText(c.company)}`);
  if (c.job_title) lines.push(`TITLE:${escapeIcsText(c.job_title)}`);
  for (const em of emails) {
    if (!em.value) continue;
    const type = em.label.toUpperCase().includes('ARBEIT') || em.label.toUpperCase().includes('WORK') ? 'WORK' : 'HOME';
    lines.push(`EMAIL;TYPE=INTERNET,${type}:${em.value}`);
  }
  for (const ph of phones) {
    if (!ph.value) continue;
    const lbl = ph.label.toUpperCase();
    const type = lbl.includes('MOBIL') || lbl.includes('CELL') ? 'CELL' : lbl.includes('ARBEIT') ? 'WORK' : 'HOME';
    lines.push(`TEL;TYPE=${type}:${ph.value}`);
  }
  if (c.address_street || c.address_city || c.address_zip || c.address_country) {
    lines.push(
      `ADR;TYPE=HOME:;;${escapeIcsText(c.address_street || '')};${escapeIcsText(c.address_city || '')};;${escapeIcsText(c.address_zip || '')};${escapeIcsText(c.address_country || '')}`,
    );
  }
  if (c.birthday) lines.push(`BDAY:${c.birthday}`);
  if (c.notes) lines.push(`NOTE:${escapeIcsText(c.notes)}`);
  if (labels.length > 0) lines.push(`CATEGORIES:${labels.map(escapeIcsText).join(',')}`);
  lines.push(`REV:${c.updated_at}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

export function parseSimpleIcs(raw: string): {
  uid?: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location?: string;
} | null {
  const unfolded = raw.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  let inEvent = false;
  let uid: string | undefined;
  let title = 'Termin';
  let description: string | undefined;
  let location: string | undefined;
  let startTime = new Date().toISOString();
  let endTime = new Date(Date.now() + 3_600_000).toISOString();
  let allDay = false;

  const parseDt = (val: string): { iso: string; isDate: boolean } => {
    const clean = val.trim();
    if (/^\d{8}$/.test(clean)) {
      const y = clean.slice(0, 4);
      const m = clean.slice(4, 6);
      const d = clean.slice(6, 8);
      return { iso: `${y}-${m}-${d}T00:00:00.000Z`, isDate: true };
    }
    const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${clean.endsWith('Z') ? 'Z' : ''}`;
      const d = new Date(iso);
      return { iso: Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(), isDate: false };
    }
    return { iso: new Date().toISOString(), isDate: false };
  };

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      continue;
    }
    if (line === 'END:VEVENT') break;
    if (!inEvent) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const keyPart = line.slice(0, idx).toUpperCase();
    const val = line.slice(idx + 1);
    const key = keyPart.split(';')[0];

    if (key === 'UID') uid = val.trim();
    else if (key === 'SUMMARY') title = unescapeIcsText(val);
    else if (key === 'DESCRIPTION') description = unescapeIcsText(val);
    else if (key === 'LOCATION') location = unescapeIcsText(val);
    else if (key === 'DTSTART') {
      const parsed = parseDt(val);
      startTime = parsed.iso;
      if (parsed.isDate || keyPart.includes('VALUE=DATE')) allDay = true;
    } else if (key === 'DTEND') {
      const parsed = parseDt(val);
      endTime = parsed.iso;
    }
  }

  return { uid, title, description, startTime, endTime, allDay, location };
}

export function parseSimpleVcf(raw: string): Array<{
  uid?: string;
  firstName: string;
  lastName: string;
  company?: string;
  jobTitle?: string;
  emails: Array<{ label: string; value: string }>;
  phones: Array<{ label: string; value: string }>;
  addressStreet?: string;
  addressCity?: string;
  addressZip?: string;
  addressCountry?: string;
  birthday?: string;
  notes?: string;
  labels: string[];
}> {
  const unfolded = raw.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const results: Array<{
    uid?: string;
    firstName: string;
    lastName: string;
    company?: string;
    jobTitle?: string;
    emails: Array<{ label: string; value: string }>;
    phones: Array<{ label: string; value: string }>;
    addressStreet?: string;
    addressCity?: string;
    addressZip?: string;
    addressCountry?: string;
    birthday?: string;
    notes?: string;
    labels: string[];
  }> = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let uid: string | undefined;
    let firstName = '';
    let lastName = '';
    let fnFallback = '';
    let company: string | undefined;
    let jobTitle: string | undefined;
    const emails: Array<{ label: string; value: string }> = [];
    const phones: Array<{ label: string; value: string }> = [];
    let addressStreet: string | undefined;
    let addressCity: string | undefined;
    let addressZip: string | undefined;
    let addressCountry: string | undefined;
    let birthday: string | undefined;
    let notes: string | undefined;
    let labels: string[] = [];

    for (const line of lines) {
      if (line.toUpperCase().startsWith('END:VCARD')) break;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const keyPart = line.slice(0, idx).toUpperCase();
      const val = line.slice(idx + 1).trim();
      const key = keyPart.split(';')[0];

      if (key === 'UID') uid = val;
      else if (key === 'FN') fnFallback = unescapeIcsText(val);
      else if (key === 'N') {
        const parts = val.split(';');
        lastName = unescapeIcsText(parts[0] || '');
        firstName = unescapeIcsText(parts[1] || '');
      } else if (key === 'ORG') company = unescapeIcsText(val.split(';')[0] || '');
      else if (key === 'TITLE') jobTitle = unescapeIcsText(val);
      else if (key === 'EMAIL' && val) {
        const label = keyPart.includes('WORK') ? 'Arbeit' : 'Privat';
        emails.push({ label, value: val });
      } else if (key === 'TEL' && val) {
        const label = keyPart.includes('CELL') ? 'Mobil' : keyPart.includes('WORK') ? 'Arbeit' : 'Privat';
        phones.push({ label, value: val });
      } else if (key === 'ADR') {
        const parts = val.split(';');
        addressStreet = unescapeIcsText(parts[2] || '') || undefined;
        addressCity = unescapeIcsText(parts[3] || '') || undefined;
        addressZip = unescapeIcsText(parts[5] || '') || undefined;
        addressCountry = unescapeIcsText(parts[6] || '') || undefined;
      } else if (key === 'BDAY') birthday = val;
      else if (key === 'NOTE') notes = unescapeIcsText(val);
      else if (key === 'CATEGORIES') {
        labels = val
          .split(',')
          .map((s) => unescapeIcsText(s).trim())
          .filter(Boolean);
      }
    }

    if (!firstName && !lastName && fnFallback) {
      const sp = fnFallback.split(' ');
      firstName = sp[0] || 'Kontakt';
      lastName = sp.slice(1).join(' ');
    }
    if (!firstName && !lastName && !company) continue;

    results.push({
      uid,
      firstName: firstName || company || 'Kontakt',
      lastName,
      company,
      jobTitle,
      emails,
      phones,
      addressStreet,
      addressCity,
      addressZip,
      addressCountry,
      birthday,
      notes,
      labels,
    });
  }

  return results;
}

interface DavRequest extends Request {
  davUser?: UserRecord;
}

function basicAuthMiddleware(req: DavRequest, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    res.setHeader('DAV', '1, 2, 3, calendar-access, addressbook');
    res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT');
    res.status(200).end();
    return;
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ChronoDAV CalDAV/CardDAV"');
    res.status(401).send('Authentifizierung erforderlich');
    return;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ChronoDAV CalDAV/CardDAV"');
    res.status(401).send('Ungültige Zugangsdaten');
    return;
  }

  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  const user = db.findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ChronoDAV CalDAV/CardDAV"');
    res.status(401).send('Ungültiger Benutzername oder Passwort');
    return;
  }

  req.davUser = user;
  next();
}

export function createDavRouter(): express.Router {
  const router = express.Router();

  // Accept raw XML/iCalendar/vCard bodies for WebDAV methods
  router.use(express.text({ type: ['application/xml', 'text/xml', 'text/calendar', 'text/vcard', 'text/plain', '*/*'], limit: '5mb' }));
  router.use(basicAuthMiddleware);

  router.all(/.*/, async (req: DavRequest, res: Response) => {
    const user = req.davUser!;
    const reqPath = req.path.replace(/\/+$/, '') || '/';
    const username = encodeURIComponent(user.username);
    const method = req.method.toUpperCase();

    res.setHeader('DAV', '1, 2, 3, calendar-access, addressbook');

    // 1. Root /dav/ -> Principal discovery
    if (reqPath === '/' || reqPath === '') {
      if (method === 'PROPFIND') {
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/dav/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:current-user-principal><D:href>/dav/principals/${username}/</D:href></D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        res.status(207).type('application/xml; charset=utf-8').send(xml);
        return;
      }
    }

    // 2. Principal URL /dav/principals/:user
    if (reqPath === `/principals/${user.username}` || reqPath === `/principals/${username}`) {
      if (method === 'PROPFIND') {
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/dav/principals/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <D:displayname>${xmlEscape(user.display_name)}</D:displayname>
        <C:calendar-home-set><D:href>/dav/calendars/${username}/</D:href></C:calendar-home-set>
        <CR:addressbook-home-set><D:href>/dav/addressbooks/${username}/</D:href></CR:addressbook-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        res.status(207).type('application/xml; charset=utf-8').send(xml);
        return;
      }
    }

    // 3. Calendar Home Set /dav/calendars/:user
    if (reqPath === `/calendars/${user.username}` || reqPath === `/calendars/${username}`) {
      if (method === 'PROPFIND') {
        const cals = db.listCalendars(user.id);
        const depth = req.headers.depth || '1';
        let itemsXml = `
  <D:response>
    <D:href>/dav/calendars/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;

        if (depth !== '0') {
          for (const cal of cals) {
            itemsXml += `
  <D:response>
    <D:href>/dav/calendars/${username}/${encodeURIComponent(cal.id)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${xmlEscape(cal.name)}</D:displayname>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
          }
        }

        res.status(207).type('application/xml; charset=utf-8').send(
          `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${itemsXml}</D:multistatus>`,
        );
        return;
      }
    }

    // 4. Specific Calendar /dav/calendars/:user/:calId
    const calMatch = reqPath.match(/^\/calendars\/([^/]+)\/([^/]+)$/);
    if (calMatch) {
      const calId = decodeURIComponent(calMatch[2]);
      const cal = db.getCalendarById(calId);
      if (!cal || cal.owner_id !== user.id) {
        res.status(404).send('Kalender nicht gefunden');
        return;
      }
      const events = db.listEventsForUser(user.id).filter((e) => e.calendar_id === cal.id || e.sharedPermission !== 'owner');

      if (method === 'GET') {
        const combined = events.map((e) => eventToIcs(e)).join('\r\n');
        res.status(200).type('text/calendar; charset=utf-8').send(combined);
        return;
      }

      if (method === 'PROPFIND' || method === 'REPORT') {
        const depth = req.headers.depth || '1';
        const includeData = method === 'REPORT' || String(req.body || '').includes('calendar-data');
        let itemsXml = `
  <D:response>
    <D:href>/dav/calendars/${username}/${encodeURIComponent(cal.id)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${xmlEscape(cal.name)}</D:displayname>
        <D:getctag>${xmlEscape(cal.updated_at)}</D:getctag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;

        if (depth !== '0' || method === 'REPORT') {
          for (const ev of events) {
            itemsXml += `
  <D:response>
    <D:href>/dav/calendars/${username}/${encodeURIComponent(cal.id)}/${encodeURIComponent(ev.uid)}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${xmlEscape(ev.etag)}</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
        ${includeData ? `<C:calendar-data>${xmlEscape(eventToIcs(ev))}</C:calendar-data>` : ''}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
          }
        }

        res.status(207).type('application/xml; charset=utf-8').send(
          `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${itemsXml}</D:multistatus>`,
        );
        return;
      }
    }

    // 5. Individual Event .ics /dav/calendars/:user/:calId/:uid.ics
    const evtMatch = reqPath.match(/^\/calendars\/([^/]+)\/([^/]+)\/([^/]+)\.ics$/);
    if (evtMatch) {
      const calId = decodeURIComponent(evtMatch[2]);
      const uid = decodeURIComponent(evtMatch[3]);
      const cal = db.getCalendarById(calId);
      if (!cal || cal.owner_id !== user.id) {
        res.status(404).send('Kalender nicht gefunden');
        return;
      }

      const existing = db.getEventByUid(uid);

      if (method === 'GET') {
        if (!existing || !db.canUserAccessEvent(user.id, existing.id)) {
          res.status(404).send('Termin nicht gefunden');
          return;
        }
        res.setHeader('ETag', existing.etag);
        res.status(200).type('text/calendar; charset=utf-8').send(eventToIcs(existing));
        return;
      }

      if (method === 'PUT') {
        const parsed = parseSimpleIcs(String(req.body || ''));
        if (!parsed) {
          res.status(400).send('Ungültiges iCalendar-Format');
          return;
        }
        if (existing) {
          const perm = db.canUserAccessEvent(user.id, existing.id);
          if (perm !== 'owner' && perm !== 'edit') {
            res.status(403).send('Keine Schreibberechtigung');
            return;
          }
          const updated = await db.updateEvent(existing.id, {
            title: parsed.title,
            description: parsed.description ?? null,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            allDay: parsed.allDay,
            location: parsed.location ?? null,
          });
          res.setHeader('ETag', updated?.etag || '');
          res.status(204).end();
        } else {
          const created = await db.createEvent({
            calendarId: cal.id,
            ownerId: user.id,
            uid: parsed.uid || uid,
            title: parsed.title,
            description: parsed.description ?? null,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            allDay: parsed.allDay,
            location: parsed.location ?? null,
          });
          res.setHeader('ETag', created.etag);
          res.status(201).end();
        }
        return;
      }

      if (method === 'DELETE') {
        if (!existing || existing.owner_id !== user.id) {
          res.status(404).send('Termin nicht gefunden');
          return;
        }
        await db.deleteEvent(existing.id);
        res.status(204).end();
        return;
      }
    }

    // 6. Addressbook Home Set /dav/addressbooks/:user
    if (reqPath === `/addressbooks/${user.username}` || reqPath === `/addressbooks/${username}`) {
      if (method === 'PROPFIND') {
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/dav/addressbooks/${username}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/addressbooks/${username}/contacts/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><CR:addressbook/></D:resourcetype>
        <D:displayname>Kontakte (${xmlEscape(user.display_name)})</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        res.status(207).type('application/xml; charset=utf-8').send(xml);
        return;
      }
    }

    // 7. Addressbook Collection /dav/addressbooks/:user/contacts
    if (reqPath === `/addressbooks/${user.username}/contacts` || reqPath === `/addressbooks/${username}/contacts`) {
      const contacts = db.listContacts(user.id);

      if (method === 'GET') {
        res.status(200).type('text/vcard; charset=utf-8').send(contacts.map(contactToVcf).join('\r\n'));
        return;
      }

      if (method === 'PROPFIND' || method === 'REPORT') {
        const depth = req.headers.depth || '1';
        const includeData = method === 'REPORT' || String(req.body || '').includes('address-data');
        let itemsXml = `
  <D:response>
    <D:href>/dav/addressbooks/${username}/contacts/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><CR:addressbook/></D:resourcetype>
        <D:displayname>Kontakte</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;

        if (depth !== '0' || method === 'REPORT') {
          for (const c of contacts) {
            itemsXml += `
  <D:response>
    <D:href>/dav/addressbooks/${username}/contacts/${encodeURIComponent(c.uid)}.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${xmlEscape(c.etag)}</D:getetag>
        <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
        ${includeData ? `<CR:address-data>${xmlEscape(contactToVcf(c))}</CR:address-data>` : ''}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
          }
        }

        res.status(207).type('application/xml; charset=utf-8').send(
          `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">${itemsXml}</D:multistatus>`,
        );
        return;
      }
    }

    // 8. Individual vCard /dav/addressbooks/:user/contacts/:uid.vcf
    const vcfMatch = reqPath.match(/^\/addressbooks\/([^/]+)\/contacts\/([^/]+)\.vcf$/);
    if (vcfMatch) {
      const uid = decodeURIComponent(vcfMatch[2]);
      const existing = db.getContactByUid(uid);

      if (method === 'GET') {
        if (!existing || existing.owner_id !== user.id) {
          res.status(404).send('Kontakt nicht gefunden');
          return;
        }
        res.setHeader('ETag', existing.etag);
        res.status(200).type('text/vcard; charset=utf-8').send(contactToVcf(existing));
        return;
      }

      if (method === 'PUT') {
        const parsedList = parseSimpleVcf(String(req.body || ''));
        if (parsedList.length === 0) {
          res.status(400).send('Ungültiges vCard-Format');
          return;
        }
        const p = parsedList[0];
        if (existing) {
          if (existing.owner_id !== user.id) {
            res.status(403).send('Keine Berechtigung');
            return;
          }
          const updated = await db.updateContact(existing.id, p);
          res.setHeader('ETag', updated?.etag || '');
          res.status(204).end();
        } else {
          const created = await db.createContact({
            ownerId: user.id,
            uid: p.uid || uid,
            ...p,
          });
          res.setHeader('ETag', created.etag);
          res.status(201).end();
        }
        return;
      }

      if (method === 'DELETE') {
        if (!existing || existing.owner_id !== user.id) {
          res.status(404).send('Kontakt nicht gefunden');
          return;
        }
        await db.deleteContact(existing.id);
        res.status(204).end();
        return;
      }
    }

    res.status(404).send('DAV-Ressource nicht gefunden');
  });

  return router;
}
