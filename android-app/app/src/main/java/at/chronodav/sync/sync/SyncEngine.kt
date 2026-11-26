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

object SyncEngine {
    const val ACCOUNT_TYPE = "at.chronodav.sync.account"

    fun ensureSystemAccount(context: Context, username: String, password: String): Account {
        val am = AccountManager.get(context)
        val existing = am.getAccountsByType(ACCOUNT_TYPE).firstOrNull()
        if (existing != null && existing.name == username) {
            am.setPassword(existing, password)
            return existing
        }
        val account = Account(username.ifBlank { "chronodav" }, ACCOUNT_TYPE)
        am.addAccountExplicitly(account, password, null)
        ContentResolver.setIsSyncable(account, CalendarContract.AUTHORITY, 1)
        ContentResolver.setSyncAutomatically(account, CalendarContract.AUTHORITY, true)
        ContentResolver.setIsSyncable(account, ContactsContract.AUTHORITY, 1)
        ContentResolver.setSyncAutomatically(account, ContactsContract.AUTHORITY, true)
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
                for (cal in cals) {
                    val events = dav.fetchEvents(cfg.serverUrl, cfg.username, cfg.password, cal)
                    eventCount += bridge.syncCalendar(account, cal, events, dav, cfg.serverUrl, cfg.username, cfg.password)
                }
            }

            if (cfg.syncContacts && hasContactPerm) {
                val contacts = dav.fetchContacts(cfg.serverUrl, cfg.username, cfg.password)
                val bridge = AndroidContactsBridge(context)
                contactCount = bridge.syncContacts(account, contacts, dav, cfg.serverUrl, cfg.username, cfg.password)
            }

            val msg = "$triggerLabel: $eventCount Termine & $contactCount Kontakte synchronisiert"
            prefs.recordSyncResult(msg, eventCount, contactCount)
            Result.success(msg)
        } catch (e: Exception) {
            val errMsg = "$triggerLabel fehlgeschlagen: ${e.message ?: "Unbekannter Fehler"}"
            prefs.recordSyncResult(errMsg, cfg.lastEventCount, cfg.lastContactCount)
            Result.failure(e)
        }
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
