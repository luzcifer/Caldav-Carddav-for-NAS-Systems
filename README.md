# ChronoDAV — Dei leiwander CalDAV & CardDAV Server (mit Netz und doppltem Boden)

Servas! Des is **ChronoDAV** — dei söbstgehosteter Kalender-, Kontakt- und Aufgaben-Server im Docker-Container, der ausschaut wia ma si's wünscht und a no weidarennt, waunn de MariaDB amoi kurz schiaf hängt.

---

## Wos des Werkel ois kau (Features)

- **3 Designs + Dark Mode (Pflicht!)**:
  - **Google-Look**: Vertraut wia Google Kalender & Google Kontakte.
  - **Apple-Look**: Saubere macOS/iOS-Optik mit feine Linien.
  - **Batman-Look**: Tiefschwarzes Gotham-Tactical-Design mit goldene Akzente — ned nur fia'd Fledermaus-Höhle.
  - **Dark Mode**: Mit oan Klick umschaltbar (auf Wunsch standardmäßig finster).
- **Kalender (CalDAV)**:
  - Monats-, Wochen-, Tages- und Agenda-Ansicht.
  - Termine eintragen, bearbeiten, `.ics` exportieren und **mit andere Benutzer teilen** (nur lesen oder mitbearbeiten).
- **Kontakte (CardDAV)**:
  - Übersichtliche Tabelle wia bei Google Kontakte mit Seitenleiste zum Bearbeiten.
  - Mehrere Telefonnummern, E-Mails, Geburtstag, Favoriten, Labels sowie **vCard (`.vcf`) Import & Export**.
- **Aufgabenverwaltung**:
  - Behalt Fristen, Prioritäten (*Hoch / Mittel / Niedrig*) und den Status (*Offen / In Bearbeitung / Erledigt*) im Aug, inklusive Verknüpfung zu Kontakte oder Termine.
- **Adresssuche & Dateianhänge**:
  - Echte Adresssuche (über OpenStreetMap/Nominatim) zum direkten Aussuchen und Abspeichern von Straße, PLZ, Ort, Land & Koordinaten.
  - Dateien (PDFs, Bilder, Dokumente) direkt an Termine, Kontakte oder Aufgaben dranhängen.
- **Mobile Endgeräte ganz easy synchronisieren**:
  - Echter **CalDAV & CardDAV Server** unter `/dav/` sowie `/.well-known/caldav` und `/.well-known/carddav`.
  - **QR-Code** für **Android (DAVx5)** und 1-Klick **Apple `.mobileconfig`-Profil** zum Runterladen fürs iPhone, iPad oder den Mac (funktioniert natürlich genauso mit Thunderbird & Linux).
- **Sicherheit & Benutzerverwaltung**:
  - Eigene **Admin-Oberfläche** zum Anlegen, Bearbeiten und Löschen von Benutzerkonten.
  - **2FA (Zwei-Faktor-Authentifizierung)** mit echtem TOTP-QR-Code (Google Authenticator, Apple Passwörter, Authy).
- **MariaDB Master + SQLite Backup & Ausfallschutz**:
  - Alle Daten liegen sauber in deiner **MariaDB** (fehlende Tabellen legt ChronoDAV beim ersten Verbinden automatisch an — oder du nimmst `db/mariadb_schema.sql`).
  - Regelmäßig wird zusätzlich a **SQLite-Backup-Datei** (`data/backups/*.sqlite`) g'schrieben.
  - **Wann's krachen geht**: Is de MariaDB ned erreichbar, steht schon beim Login groß da:
    > *„Achtung DB nicht erreichbar, es wird auf SQLITE ( Backup ) zugegriffen“*
  - Du kannst ganz normal weiterhackeln — sobald de MariaDB wieder do is, schaufelt ChronoDAV alle g'speicherten Änderungen automatisch zum **Master** z'ruck!
  - **E-Mail-Alarm (SMTP)**: Auf Wunsch kriagst a Warn-E-Mail, waunn de MariaDB ausfällt und wieder a Info-Mail, waunn alles wieder synchronisiert is.

---

## Wia's unter der Haubn rennt

```text
Browser / Handy (iOS, DAVx5, Thunderbird)
          │
          ▼  (REST API + CalDAV / CardDAV auf Port 3000)
   ChronoDAV Container (Node 22 + Express + React)
          │
          ├──► MariaDB (Master-Datenbank)
          │         ▲
          │         │ (Auto-Reconnect & Master-Sync)
          └──► SQLite (data/backup.sqlite + regelmäßige Snapshots in data/backups/)
```

---

## Einrichten — Schritt für Schritt

### Variante A: Mit Docker Compose (inkl. frischer MariaDB)

1. Projekt klonen oder entpacken und in den Ordner wechseln:
   ```bash
   cd chronodav
   ```
2. In der `docker-compose.yml` deine Wunsch-Passwörter (und optional SMTP-Daten) anpassen.
3. Container bauen und starten:
   ```bash
   docker compose up -d --build
   ```
4. Browser aufmachen unter `http://<DEINE-SERVER-IP>:3000` und bei der Ersteinrichtung den ersten **Administrator** anlegen. Fertig!

---

### Variante B: Aufm UGREEN NAS (UGOS Pro) mit vorhandener MariaDB

Waunn auf deinem UGREEN NAS scho a MariaDB rennt (und nur de Tabellenstruktur fehlt):

1. Den gesamten Projektordner am NAS z. B. nach `/volume1/docker/chronodav` kopieren.
2. Im Ordner die Datei **`docker-compose.ugreen.yml`** aufmachen (oder direkt in `docker-compose.yml` umbenennen) und deine bestehenden MariaDB-Daten eintragen:
   - `MARIADB_HOST`: IP-Adresse vom NAS oder Containername deiner MariaDB
   - `MARIADB_PORT`: `3306`
   - `MARIADB_DATABASE`: Name deiner vorhandenen Datenbank (z. B. `chronodav`)
   - `MARIADB_USER` & `MARIADB_PASSWORD`: Zugangsdaten für de Datenbank
3. In UGOS Pro die **Docker-App** aufmachen → **Projekt → Erstellen**, den Ordner `/volume1/docker/chronodav` auswählen und starten.
   - **Falls `open Dockerfile: no such file or directory` kommt**: Entweder wurde beim Entpacken ein extra Unterordner erstellt (sodass `Dockerfile` eine Ebene tiefer liegt), oder UGOS Pro legt das Projekt-YAML woanders ab. Lösung: Im Compose unter `build: context:` statt `.` den direkten NAS-Pfad eintragen (z. B. `context: /volume1/docker/dav`).
4. Standardmäßig lauscht der Container dann auf Port **`3080`** (`http://<NAS-IP>:3080`). Die SQLite-Backups und Dateianhänge landen direkt sichtbar im Ordner `./data` am NAS.

> **Tipp fürs Handy:** Für CalDAV/CardDAV auf iOS und Android am besten im UGREEN NAS einen Reverse Proxy mit HTTPS (z. B. über deine Domain/Subdomain) auf Port `3080` legen — Handys mögen HTTPS am liebsten.

---

### Variante C: Lokal zum Ausprobieren / Entwickeln

```bash
npm install
cp .env.example .env
npm run dev
```

Danach im Browser `http://localhost:3000` aufrufen.

---

## Wichtige Umgebungsvariablen (`.env` / Docker)

| Variable | Beschreibung | Beispiel |
| :--- | :--- | :--- |
| `PORT` | Interner Server-Port | `3000` |
| `DATA_DIR` | Speicherort für SQLite-Backups & Anhänge | `/app/data` |
| `MARIADB_HOST` | Hostname oder IP vom MariaDB-Master | `mariadb` |
| `MARIADB_PORT` | MariaDB-Port | `3306` |
| `MARIADB_DATABASE` | Name der Datenbank | `chronodav` |
| `MARIADB_USER` | Datenbank-Benutzer | `chronodav` |
| `MARIADB_PASSWORD` | Datenbank-Passwort | `geheimes_passwort` |
| `BACKUP_INTERVAL_MINUTES` | Intervall für SQLite-Backup-Snapshots | `60` |
| `ADMIN_USERNAME` | Optional: Admin beim Start automatisch anlegen | `admin` |
| `ADMIN_PASSWORD` | Optional: Passwort für den Start-Admin | `sicheres_passwort` |
| `SMTP_HOST` / `SMTP_PORT` | SMTP-Server für Ausfall-Warnungen | `smtp.domain.at` / `587` |
| `SMTP_USER` / `SMTP_PASS` | SMTP-Login | `alert@domain.at` |
| `ALERT_EMAIL_TO` | Empfänger für DB-Ausfall-E-Mails | `ich@domain.at` |

*(Alle DB-, Backup- und SMTP-Einstellungen kannst später a ganz gemütlich direkt in der WebGUI unter **Admin & DB** ändern und mit am Knopfdruck testen!)*

---

## Mobile Endgeräte einbinden (Kurzfassung)

1. In ChronoDAV links auf **Mobil-Sync** klicken.
2. **iPhone / iPad / Mac**: Einfach auf **„Apple .mobileconfig Profil herunterladen“** tippen, Profil am Gerät installieren und Passwort eingeben.
3. **Android (DAVx5)**: In DAVx5 *„Mit URL und Benutzername anmelden“* wählen, den **QR-Code** scannen (oder `https://deine-domain/dav/` eintippen) und Kalender + Adressbuch anhakerln.

---

Pfiati & vü Spaß mit ChronoDAV!
