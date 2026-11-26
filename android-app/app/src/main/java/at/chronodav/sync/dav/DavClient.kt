package at.chronodav.sync.dav

import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

data class DavCalendarInfo(
    val id: String,
    val href: String,
    val displayName: String
)

data class DavEvent(
    val uid: String,
    val title: String,
    val description: String,
    val location: String,
    val startMillis: Long,
    val endMillis: Long,
    val allDay: Boolean
)

data class DavContact(
    val uid: String,
    val firstName: String,
    val lastName: String,
    val displayName: String,
    val company: String,
    val jobTitle: String,
    val emails: List<Pair<String, String>>,
    val phones: List<Pair<String, String>>,
    val street: String,
    val city: String,
    val zip: String,
    val country: String,
    val notes: String
)

class DavClient {
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun normalizeDavBase(serverUrl: String): String {
        val clean = serverUrl.trim().trimEnd('/')
        return if (clean.endsWith("/dav")) clean else "$clean/dav"
    }

    fun testConnection(serverUrl: String, username: String, password: String): Result<String> {
        return try {
            val base = normalizeDavBase(serverUrl)
            val req = Request.Builder()
                .url("$base/")
                .header("Authorization", Credentials.basic(username, password))
                .header("Depth", "0")
                .method(
                    "PROPFIND",
                    """<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>"""
                        .toRequestBody("application/xml; charset=utf-8".toMediaType())
                )
                .build()

            http.newCall(req).execute().use { resp ->
                if (resp.code in 200..299) {
                    Result.success("Verbunden (HTTP ${resp.code})")
                } else if (resp.code == 401) {
                    Result.failure(Exception("Benutzername oder Passwort falsch (401)"))
                } else {
                    Result.failure(Exception("Server-Antwort: HTTP ${resp.code}"))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun listCalendars(serverUrl: String, username: String, password: String): List<DavCalendarInfo> {
        val base = normalizeDavBase(serverUrl)
        val encUser = URLEncoder.encode(username, "UTF-8")
        val url = "$base/calendars/$encUser/"
        val req = Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(username, password))
            .header("Depth", "1")
            .method(
                "PROPFIND",
                """<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>"""
                    .toRequestBody("application/xml; charset=utf-8".toMediaType())
            )
            .build()

        http.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                throw IllegalStateException("CalDAV PROPFIND fehlgeschlagen: HTTP ${resp.code}")
            }
            val results = mutableListOf<DavCalendarInfo>()
            val regex = Regex("<D:response>(.*?)</D:response>", RegexOption.DOT_MATCHES_ALL)
            for (match in regex.findAll(body)) {
                val block = match.groupValues[1]
                if (!block.contains("calendar", ignoreCase = true)) continue
                val href = Regex("<D:href>(.*?)</D:href>").find(block)?.groupValues?.get(1)?.trim() ?: continue
                if (href.trimEnd('/') == "/dav/calendars/$encUser") continue
                val name = Regex("<D:displayname>(.*?)</D:displayname>").find(block)?.groupValues?.get(1)?.trim()
                    ?: "ChronoDAV Kalender"
                val id = href.trimEnd('/').substringAfterLast('/')
                results.add(DavCalendarInfo(id = id, href = href, displayName = unescapeXml(name)))
            }
            return results
        }
    }

    fun fetchEvents(serverUrl: String, username: String, password: String, calendar: DavCalendarInfo): List<DavEvent> {
        val origin = serverUrl.trim().trimEnd('/').removeSuffix("/dav")
        val url = if (calendar.href.startsWith("http")) calendar.href else "$origin${calendar.href}"
        val req = Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(username, password))
            .get()
            .build()

        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("CalDAV GET fehlgeschlagen: HTTP ${resp.code}")
            }
            val icsBody = resp.body?.string() ?: ""
            return parseIcsEvents(icsBody)
        }
    }

    fun pushEvent(serverUrl: String, username: String, password: String, calendarId: String, ev: DavEvent) {
        val base = normalizeDavBase(serverUrl)
        val encUser = URLEncoder.encode(username, "UTF-8")
        val encUid = URLEncoder.encode(ev.uid, "UTF-8")
        val url = "$base/calendars/$encUser/$calendarId/$encUid.ics"
        val ics = buildIcs(ev)
        val req = Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(username, password))
            .put(ics.toRequestBody("text/calendar; charset=utf-8".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful && resp.code != 201 && resp.code != 204) {
                throw IllegalStateException("CalDAV PUT fehlgeschlagen: HTTP ${resp.code}")
            }
        }
    }

    fun fetchContacts(serverUrl: String, username: String, password: String): List<DavContact> {
        val base = normalizeDavBase(serverUrl)
        val encUser = URLEncoder.encode(username, "UTF-8")
        val url = "$base/addressbooks/$encUser/contacts/"
        val req = Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(username, password))
            .get()
            .build()

        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("CardDAV GET fehlgeschlagen: HTTP ${resp.code}")
            }
            val vcfBody = resp.body?.string() ?: ""
            return parseVcards(vcfBody)
        }
    }

    fun pushContact(serverUrl: String, username: String, password: String, c: DavContact) {
        val base = normalizeDavBase(serverUrl)
        val encUser = URLEncoder.encode(username, "UTF-8")
        val encUid = URLEncoder.encode(c.uid, "UTF-8")
        val url = "$base/addressbooks/$encUser/contacts/$encUid.vcf"
        val vcf = buildVcard(c)
        val req = Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(username, password))
            .put(vcf.toRequestBody("text/vcard; charset=utf-8".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful && resp.code != 201 && resp.code != 204) {
                throw IllegalStateException("CardDAV PUT fehlgeschlagen: HTTP ${resp.code}")
            }
        }
    }

    private fun parseIcsEvents(raw: String): List<DavEvent> {
        val unfolded = raw.replace(Regex("\r?\n[ \t]"), "")
        val blocks = unfolded.split("BEGIN:VEVENT").drop(1)
        val list = mutableListOf<DavEvent>()

        for (block in blocks) {
            val endIdx = block.indexOf("END:VEVENT")
            val content = if (endIdx >= 0) block.substring(0, endIdx) else block
            var uid = ""
            var title = "Termin"
            var desc = ""
            var loc = ""
            var startMs = System.currentTimeMillis()
            var endMs = startMs + 3_600_000L
            var allDay = false

            for (line in content.split(Regex("\r?\n"))) {
                val sep = line.indexOf(':')
                if (sep <= 0) continue
                val keyPart = line.substring(0, sep).uppercase(Locale.US)
                val value = line.substring(sep + 1).trim()
                val key = keyPart.substringBefore(';')

                when (key) {
                    "UID" -> uid = value
                    "SUMMARY" -> title = unescapeIcs(value)
                    "DESCRIPTION" -> desc = unescapeIcs(value)
                    "LOCATION" -> loc = unescapeIcs(value)
                    "DTSTART" -> {
                        val (ms, isDate) = parseIcsDate(value)
                        startMs = ms
                        if (isDate || keyPart.contains("VALUE=DATE")) allDay = true
                    }
                    "DTEND" -> {
                        val (ms, _) = parseIcsDate(value)
                        endMs = ms
                    }
                }
            }
            if (uid.isNotBlank()) {
                if (endMs <= startMs) endMs = startMs + if (allDay) 86_400_000L else 3_600_000L
                list.add(DavEvent(uid, title, desc, loc, startMs, endMs, allDay))
            }
        }
        return list
    }

    private fun parseVcards(raw: String): List<DavContact> {
        val unfolded = raw.replace(Regex("\r?\n[ \t]"), "")
        val blocks = unfolded.split(Regex("BEGIN:VCARD", RegexOption.IGNORE_CASE)).drop(1)
        val list = mutableListOf<DavContact>()

        for (block in blocks) {
            val endIdx = block.indexOf("END:VCARD", ignoreCase = true)
            val content = if (endIdx >= 0) block.substring(0, endIdx) else block
            var uid = ""
            var fn = ""
            var first = ""
            var last = ""
            var company = ""
            var jobTitle = ""
            var notes = ""
            var street = ""
            var city = ""
            var zip = ""
            var country = ""
            val emails = mutableListOf<Pair<String, String>>()
            val phones = mutableListOf<Pair<String, String>>()

            for (line in content.split(Regex("\r?\n"))) {
                val sep = line.indexOf(':')
                if (sep <= 0) continue
                val keyPart = line.substring(0, sep).uppercase(Locale.US)
                val value = line.substring(sep + 1).trim()
                val key = keyPart.substringBefore(';')

                when (key) {
                    "UID" -> uid = value
                    "FN" -> fn = unescapeIcs(value)
                    "N" -> {
                        val parts = value.split(';')
                        last = unescapeIcs(parts.getOrElse(0) { "" })
                        first = unescapeIcs(parts.getOrElse(1) { "" })
                    }
                    "ORG" -> company = unescapeIcs(value.substringBefore(';'))
                    "TITLE" -> jobTitle = unescapeIcs(value)
                    "NOTE" -> notes = unescapeIcs(value)
                    "EMAIL" -> if (value.isNotBlank()) {
                        val lbl = if (keyPart.contains("WORK")) "Arbeit" else "Privat"
                        emails.add(lbl to value)
                    }
                    "TEL" -> if (value.isNotBlank()) {
                        val lbl = when {
                            keyPart.contains("CELL") -> "Mobil"
                            keyPart.contains("WORK") -> "Arbeit"
                            else -> "Privat"
                        }
                        phones.add(lbl to value)
                    }
                    "ADR" -> {
                        val p = value.split(';')
                        street = unescapeIcs(p.getOrElse(2) { "" })
                        city = unescapeIcs(p.getOrElse(3) { "" })
                        zip = unescapeIcs(p.getOrElse(5) { "" })
                        country = unescapeIcs(p.getOrElse(6) { "" })
                    }
                }
            }

            if (first.isBlank() && last.isBlank() && fn.isNotBlank()) {
                val sp = fn.split(' ')
                first = sp.firstOrNull() ?: "Kontakt"
                last = sp.drop(1).joinToString(" ")
            }
            val display = fn.ifBlank { "$first $last".trim() }.ifBlank { company }
            if (uid.isNotBlank() && display.isNotBlank()) {
                list.add(
                    DavContact(
                        uid = uid,
                        firstName = first,
                        lastName = last,
                        displayName = display,
                        company = company,
                        jobTitle = jobTitle,
                        emails = emails,
                        phones = phones,
                        street = street,
                        city = city,
                        zip = zip,
                        country = country,
                        notes = notes
                    )
                )
            }
        }
        return list
    }

    private fun buildIcs(ev: DavEvent): String {
        val fmtUtc = SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val fmtDate = SimpleDateFormat("yyyyMMdd", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val dtStart = if (ev.allDay) {
            "DTSTART;VALUE=DATE:${fmtDate.format(ev.startMillis)}"
        } else {
            "DTSTART:${fmtUtc.format(ev.startMillis)}"
        }
        val dtEnd = if (ev.allDay) {
            "DTEND;VALUE=DATE:${fmtDate.format(ev.endMillis)}"
        } else {
            "DTEND:${fmtUtc.format(ev.endMillis)}"
        }
        return buildString {
            appendLine("BEGIN:VCALENDAR")
            appendLine("VERSION:2.0")
            appendLine("PRODID:-//ChronoSync Android//DE")
            appendLine("BEGIN:VEVENT")
            appendLine("UID:${ev.uid}")
            appendLine(dtStart)
            appendLine(dtEnd)
            appendLine("SUMMARY:${escapeIcs(ev.title)}")
            if (ev.description.isNotBlank()) appendLine("DESCRIPTION:${escapeIcs(ev.description)}")
            if (ev.location.isNotBlank()) appendLine("LOCATION:${escapeIcs(ev.location)}")
            appendLine("END:VEVENT")
            appendLine("END:VCALENDAR")
        }
    }

    private fun buildVcard(c: DavContact): String = buildString {
        appendLine("BEGIN:VCARD")
        appendLine("VERSION:3.0")
        appendLine("UID:${c.uid}")
        appendLine("FN:${escapeIcs(c.displayName)}")
        appendLine("N:${escapeIcs(c.lastName)};${escapeIcs(c.firstName)};;;")
        if (c.company.isNotBlank()) appendLine("ORG:${escapeIcs(c.company)}")
        if (c.jobTitle.isNotBlank()) appendLine("TITLE:${escapeIcs(c.jobTitle)}")
        for ((lbl, valStr) in c.emails) {
            val type = if (lbl.contains("Arbeit", true)) "WORK" else "HOME"
            appendLine("EMAIL;TYPE=INTERNET,$type:$valStr")
        }
        for ((lbl, valStr) in c.phones) {
            val type = when {
                lbl.contains("Mobil", true) -> "CELL"
                lbl.contains("Arbeit", true) -> "WORK"
                else -> "HOME"
            }
            appendLine("TEL;TYPE=$type:$valStr")
        }
        if (c.street.isNotBlank() || c.city.isNotBlank() || c.zip.isNotBlank() || c.country.isNotBlank()) {
            appendLine("ADR;TYPE=HOME:;;${escapeIcs(c.street)};${escapeIcs(c.city)};;${escapeIcs(c.zip)};${escapeIcs(c.country)}")
        }
        if (c.notes.isNotBlank()) appendLine("NOTE:${escapeIcs(c.notes)}")
        appendLine("END:VCARD")
    }

    private fun parseIcsDate(raw: String): Pair<Long, Boolean> {
        val clean = raw.trim()
        return try {
            if (clean.length == 8 && clean.all { it.isDigit() }) {
                val fmt = SimpleDateFormat("yyyyMMdd", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }
                (fmt.parse(clean)?.time ?: System.currentTimeMillis()) to true
            } else if (clean.endsWith("Z")) {
                val fmt = SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }
                (fmt.parse(clean)?.time ?: System.currentTimeMillis()) to false
            } else {
                val trimmed = clean.take(15)
                val fmt = SimpleDateFormat("yyyyMMdd'T'HHmmss", Locale.US)
                (fmt.parse(trimmed)?.time ?: System.currentTimeMillis()) to false
            }
        } catch (_: Exception) {
            System.currentTimeMillis() to false
        }
    }

    private fun escapeIcs(s: String): String =
        s.replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")

    private fun unescapeIcs(s: String): String =
        s.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")

    private fun unescapeXml(s: String): String =
        s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
}
