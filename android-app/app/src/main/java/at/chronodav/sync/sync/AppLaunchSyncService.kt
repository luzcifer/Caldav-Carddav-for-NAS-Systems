package at.chronodav.sync.sync

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import at.chronodav.sync.data.SyncPreferences

class AppLaunchSyncService : AccessibilityService() {
    private var lastTriggerMs = 0L

    private val targetPackages = setOf(
        // Kalender-Apps
        "com.google.android.calendar",
        "com.samsung.android.calendar",
        "com.android.calendar",
        "org.fossify.calendar",
        "com.simplemobiletools.calendar",
        "com.simplemobiletools.calendar.pro",
        "ws.xsoh.etar",
        // Kontakte-Apps
        "com.google.android.contacts",
        "com.samsung.android.app.contacts",
        "com.android.contacts",
        "org.fossify.contacts",
        "com.simplemobiletools.contacts",
        "com.simplemobiletools.contacts.pro"
    )

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString()?.lowercase() ?: return

        val isCalendarOrContacts = pkg in targetPackages ||
            pkg.contains("calendar") ||
            pkg.contains("contacts") ||
            pkg.contains("kalender") ||
            pkg.contains("kontakte")

        if (!isCalendarOrContacts) return

        val prefs = SyncPreferences(this).load()
        if (!prefs.syncOnAppOpen || prefs.serverUrl.isBlank()) return

        val now = System.currentTimeMillis()
        if (now - lastTriggerMs < 15_000L) return // 15s Cooldown gegen Mehrfach-Auslösung
        lastTriggerMs = now

        val label = if (pkg.contains("cal")) "Kalender-Start Sync" else "Kontakte-Start Sync"
        SyncScheduler.triggerImmediateSync(this, label)
    }

    override fun onInterrupt() {
        // Nichts zu bereinigen
    }
}
