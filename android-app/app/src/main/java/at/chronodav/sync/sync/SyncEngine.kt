package at.chronodav.sync.sync

import android.Manifest
import android.accounts.Account
import android.accounts.AccountManager
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.CalendarContract
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import at.chronodav.sync.data.SyncPreferences
import at.chronodav.sync.dav.DavClient

data class LocalDiagnostics(
    val accountRegistered: Boolean,
    val accountName: String,
    val calendarSyncEnabled: Boolean,
    val contactsSyncEnabled: Boolean,
    val localCalendarsCount: Int,
    val localCalendarNames: List<String>,
    val localEventsCount: Int,
    val localContactsCount: Int
)

object SyncEngine {
    const val ACCOUNT_TYPE = "at.chronodav.sync.account"

    fun ensureSystemAccount(context: Context, username: String, password: String): Account {
        val am = AccountManager.get(context)
        val cleanName = username.ifBlank { "chronodav" }
        val existing = am.getAccountsByType(ACCOUNT_TYPE).firstOrNull { it.name == cleanName }
            ?: am.getAccountsByType(ACCOUNT_TYPE).firstOrNull()

        val account = if (existing != null && existing.name == cleanName) {
            am.setPassword(existing, password)
            existing
        } else {
            val created = Account(cleanName, ACCOUNT_TYPE)
            am.addAccountExplicitly(created, password, null)
            created
        }

        // Immer erneut erzwingen (wichtig falls Berechtigungen erst nach Kontospeicherung erteilt wurden)
        ContentResolver.setIsSyncable(account, CalendarContract.AUTHORITY, 1)
        ContentResolver.setSyncAutomatically(account, CalendarContract.AUTHORITY, true)
        ContentResolver.setIsSyncable(account, ContactsContract.AUTHORITY, 1)
        ContentResolver.setSyncAutomatically(account, ContactsContract.AUTHORITY, true)

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            runCatching {
                AndroidContactsBridge(context).ensureContactsAccountReady(account)
            }
        }

        return account
    }

    @Synchronized
    fun runFullSync(context: Context, triggerLabel: String): Result<String> {
        val prefs = SyncPreferences(context)
        val cfg = prefs.load()
        if (cfg.serverUrl.isBlank() || cfg.username.isBlank() || cfg.password.isBlank()) {
            return Result.failure(IllegalStateException("Bitte zuerst Server-URL, Benutzername und Passwort speichern."))
        }

        return try {
            val account = ensureSystemAccount(context, cfg.username, cfg.password)
            val dav = DavClient()
            var eventCount = 0
            var contactCount = 0

            val hasCalPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
            val hasContactPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CONTACTS) == PackageManager.PERMISSION_GRANTED

            if (cfg.syncCalendar && hasCalPerm) {
                val cals = dav.listCalendars(cfg.serverUrl, cfg.username, cfg.password)
                val bridge = AndroidCalendarBridge(context)
                cals.forEachIndexed { idx, cal ->
                    val events = dav.fetchEvents(cfg.serverUrl, cfg.username, cfg.password, cal)
                    eventCount += bridge.syncCalendar(
                        account = account,
                        calInfo = cal,
                        remoteEvents = events,
                        davClient = dav,
                        serverUrl = cfg.serverUrl,
                        username = cfg.username,
                        password = cfg.password,
                        isPrimaryCalendar = (idx == 0)
                    )
                }
            }

            if (cfg.syncContacts && hasContactPerm) {
                val contacts = dav.fetchContacts(cfg.serverUrl, cfg.username, cfg.password)
                val bridge = AndroidContactsBridge(context)
                contactCount = bridge.syncContacts(account, contacts, dav, cfg.serverUrl, cfg.username, cfg.password)
            }

            val permWarn = buildList {
                if (cfg.syncCalendar && !hasCalPerm) add("Kalender-Berechtigung fehlt")
                if (cfg.syncContacts && !hasContactPerm) add("Kontakte-Berechtigung fehlt")
            }
            val msg = if (permWarn.isNotEmpty()) {
                "$triggerLabel: ${permWarn.joinToString(", ")}"
            } else {
                "$triggerLabel: $eventCount Termine & $contactCount Kontakte synchronisiert"
            }
            prefs.recordSyncResult(msg, eventCount, contactCount)
            Result.success(msg)
        } catch (e: Exception) {
            val errMsg = "$triggerLabel fehlgeschlagen: ${e.message ?: "Unbekannter Fehler"}"
            prefs.recordSyncResult(errMsg, cfg.lastEventCount, cfg.lastContactCount)
            Result.failure(e)
        }
    }

    fun getLocalDiagnostics(context: Context, username: String): LocalDiagnostics {
        val am = AccountManager.get(context)
        val accounts = am.getAccountsByType(ACCOUNT_TYPE)
        val account = accounts.firstOrNull { it.name == username } ?: accounts.firstOrNull()

        if (account == null) {
            return LocalDiagnostics(
                accountRegistered = false,
                accountName = "",
                calendarSyncEnabled = false,
                contactsSyncEnabled = false,
                localCalendarsCount = 0,
                localCalendarNames = emptyList(),
                localEventsCount = 0,
                localContactsCount = 0
            )
        }

        val calSync = ContentResolver.getIsSyncable(account, CalendarContract.AUTHORITY) > 0 &&
            ContentResolver.getSyncAutomatically(account, CalendarContract.AUTHORITY)
        val contactSync = ContentResolver.getIsSyncable(account, ContactsContract.AUTHORITY) > 0 &&
            ContentResolver.getSyncAutomatically(account, ContactsContract.AUTHORITY)

        val calNames = mutableListOf<String>()
        var eventsCount = 0
        var contactsCount = 0

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) {
            runCatching {
                context.contentResolver.query(
                    CalendarContract.Calendars.CONTENT_URI,
                    arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME),
                    "${CalendarContract.Calendars.ACCOUNT_NAME}=? AND ${CalendarContract.Calendars.ACCOUNT_TYPE}=?",
                    arrayOf(account.name, account.type),
                    null
                )?.use { cur ->
                    val calIds = mutableListOf<String>()
                    while (cur.moveToNext()) {
                        calIds.add(cur.getLong(0).toString())
                        calNames.add(cur.getString(1) ?: "Kalender")
                    }
                    if (calIds.isNotEmpty()) {
                        val placeholders = calIds.joinToString(",") { "?" }
                        context.contentResolver.query(
                            CalendarContract.Events.CONTENT_URI,
                            arrayOf(CalendarContract.Events._ID),
                            "${CalendarContract.Events.CALENDAR_ID} IN ($placeholders) AND ${CalendarContract.Events.DELETED}=0",
                            calIds.toTypedArray(),
                            null
                        )?.use { evCur ->
                            eventsCount = evCur.count
                        }
                    }
                }
            }
        }

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            runCatching {
                context.contentResolver.query(
                    ContactsContract.RawContacts.CONTENT_URI,
                    arrayOf(ContactsContract.RawContacts._ID),
                    "${ContactsContract.RawContacts.ACCOUNT_NAME}=? AND ${ContactsContract.RawContacts.ACCOUNT_TYPE}=? AND ${ContactsContract.RawContacts.DELETED}=0",
                    arrayOf(account.name, account.type),
                    null
                )?.use { cCur ->
                    contactsCount = cCur.count
                }
            }
        }

        return LocalDiagnostics(
            accountRegistered = true,
            accountName = account.name,
            calendarSyncEnabled = calSync,
            contactsSyncEnabled = contactSync,
            localCalendarsCount = calNames.size,
            localCalendarNames = calNames,
            localEventsCount = eventsCount,
            localContactsCount = contactsCount
        )
    }

    fun requestSystemAdapterSync(context: Context, username: String) {
        val account = Account(username.ifBlank { "chronodav" }, ACCOUNT_TYPE)
        val extras = Bundle().apply {
            putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true)
            putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true)
        }
        ContentResolver.requestSync(account, CalendarContract.AUTHORITY, extras)
        ContentResolver.requestSync(account, ContactsContract.AUTHORITY, extras)
    }
}

