package at.chronodav.sync.data

import android.content.Context
import android.content.SharedPreferences

data class SyncSettings(
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val intervalMinutes: Int = 15, // 5, 10, 15, 30, 45, 60 oder 0 = nur manuell / beim App-Start
    val syncOnAppOpen: Boolean = true,
    val syncCalendar: Boolean = true,
    val syncContacts: Boolean = true,
    val lastSyncTime: Long = 0L,
    val lastSyncStatus: String = "Noch nicht synchronisiert",
    val lastEventCount: Int = 0,
    val lastContactCount: Int = 0
)

class SyncPreferences(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("chronosync_prefs", Context.MODE_PRIVATE)

    fun load(): SyncSettings = SyncSettings(
        serverUrl = prefs.getString("server_url", "") ?: "",
        username = prefs.getString("username", "") ?: "",
        password = prefs.getString("password", "") ?: "",
        intervalMinutes = prefs.getInt("interval_minutes", 15),
        syncOnAppOpen = prefs.getBoolean("sync_on_app_open", true),
        syncCalendar = prefs.getBoolean("sync_calendar", true),
        syncContacts = prefs.getBoolean("sync_contacts", true),
        lastSyncTime = prefs.getLong("last_sync_time", 0L),
        lastSyncStatus = prefs.getString("last_sync_status", "Noch nicht synchronisiert")
            ?: "Noch nicht synchronisiert",
        lastEventCount = prefs.getInt("last_event_count", 0),
        lastContactCount = prefs.getInt("last_contact_count", 0)
    )

    fun saveConnection(serverUrl: String, username: String, password: String) {
        prefs.edit()
            .putString("server_url", serverUrl.trim().trimEnd('/'))
            .putString("username", username.trim())
            .putString("password", password)
            .apply()
    }

    fun saveSchedule(intervalMinutes: Int, syncOnAppOpen: Boolean, syncCalendar: Boolean, syncContacts: Boolean) {
        prefs.edit()
            .putInt("interval_minutes", intervalMinutes)
            .putBoolean("sync_on_app_open", syncOnAppOpen)
            .putBoolean("sync_calendar", syncCalendar)
            .putBoolean("sync_contacts", syncContacts)
            .apply()
    }

    fun recordSyncResult(status: String, eventCount: Int, contactCount: Int) {
        prefs.edit()
            .putLong("last_sync_time", System.currentTimeMillis())
            .putString("last_sync_status", status)
            .putInt("last_event_count", eventCount)
            .putInt("last_contact_count", contactCount)
            .apply()
        appendLog(status)
    }

    fun appendLog(entry: String) {
        val stamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.GERMANY)
            .format(java.util.Date())
        val existing = getLogs().toMutableList()
        existing.add(0, "[$stamp] $entry")
        val trimmed = existing.take(25)
        prefs.edit().putString("sync_logs", trimmed.joinToString("\n")).apply()
    }

    fun getLogs(): List<String> {
        val raw = prefs.getString("sync_logs", "") ?: ""
        return if (raw.isBlank()) emptyList() else raw.split("\n")
    }
}
