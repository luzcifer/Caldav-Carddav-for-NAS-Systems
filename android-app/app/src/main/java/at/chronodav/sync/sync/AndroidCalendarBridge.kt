package at.chronodav.sync.sync

import android.accounts.Account
import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.provider.CalendarContract
import at.chronodav.sync.dav.DavCalendarInfo
import at.chronodav.sync.dav.DavClient
import at.chronodav.sync.dav.DavEvent
import java.util.TimeZone
import java.util.UUID

class AndroidCalendarBridge(private val context: Context) {
    private fun syncAdapterUri(uri: Uri, account: Account): Uri = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, account.name)
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, account.type)
        .build()

    private fun parseCalendarColor(colorHex: String): Int = try {
        Color.parseColor(colorHex)
    } catch (_: Exception) {
        0xFF1A73E8.toInt()
    }

    fun ensureLocalCalendar(account: Account, calInfo: DavCalendarInfo, isPrimaryCalendar: Boolean = false): Long {
        val resolver = context.contentResolver
        val colorInt = parseCalendarColor(calInfo.colorHex)

        val values = ContentValues().apply {
            put(CalendarContract.Calendars.ACCOUNT_NAME, account.name)
            put(CalendarContract.Calendars.ACCOUNT_TYPE, account.type)
            put(CalendarContract.Calendars.NAME, calInfo.id)
            put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, calInfo.displayName)
            put(CalendarContract.Calendars.CALENDAR_COLOR, colorInt)
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, account.name)
            put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().id)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1)
            put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.ALLOWED_REMINDERS, "0,1")
            put(CalendarContract.Calendars.ALLOWED_AVAILABILITY, "0,1,2")
            put(CalendarContract.Calendars.ALLOWED_ATTENDEE_TYPES, "0,1,2")
            put(CalendarContract.Calendars.IS_PRIMARY, if (isPrimaryCalendar) 1 else 0)
        }

        val projection = arrayOf(CalendarContract.Calendars._ID)
        val selection = "${CalendarContract.Calendars.ACCOUNT_NAME}=? AND ${CalendarContract.Calendars.ACCOUNT_TYPE}=? AND ${CalendarContract.Calendars.NAME}=?"
        resolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            selection,
            arrayOf(account.name, account.type, calInfo.id),
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val existingId = cursor.getLong(0)
                resolver.update(
                    syncAdapterUri(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, existingId), account),
                    values,
                    null,
                    null
                )
                return existingId
            }
        }

        val inserted = resolver.insert(syncAdapterUri(CalendarContract.Calendars.CONTENT_URI, account), values)
        return inserted?.let { ContentUris.parseId(it) } ?: -1L
    }

    fun syncCalendar(
        account: Account,
        calInfo: DavCalendarInfo,
        remoteEvents: List<DavEvent>,
        davClient: DavClient,
        serverUrl: String,
        username: String,
        password: String,
        isPrimaryCalendar: Boolean = false
    ): Int {
        val localCalId = ensureLocalCalendar(account, calInfo, isPrimaryCalendar)
        if (localCalId < 0) return 0
        val resolver: ContentResolver = context.contentResolver

        // 0. Lokal gelöschte Termine auf Server löschen und lokal final entfernen
        resolver.query(
            CalendarContract.Events.CONTENT_URI,
            arrayOf(CalendarContract.Events._ID, CalendarContract.Events.SYNC_DATA1),
            "${CalendarContract.Events.CALENDAR_ID}=? AND ${CalendarContract.Events.DELETED}=1",
            arrayOf(localCalId.toString()),
            null
        )?.use { c ->
            while (c.moveToNext()) {
                val localId = c.getLong(0)
                val uid = c.getString(1)
                if (!uid.isNullOrBlank()) {
                    runCatching {
                        davClient.deleteEvent(serverUrl, username, password, calInfo.id, uid)
                    }
                }
                resolver.delete(
                    syncAdapterUri(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, localId), account),
                    null,
                    null
                )
            }
        }

        // 1. Lokale geänderte oder neu angelegte Termine zuerst zum Server hochladen
        val dirtyProj = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.SYNC_DATA1,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.ALL_DAY
        )
        resolver.query(
            CalendarContract.Events.CONTENT_URI,
            dirtyProj,
            "${CalendarContract.Events.CALENDAR_ID}=? AND ${CalendarContract.Events.DIRTY}=1 AND ${CalendarContract.Events.DELETED}=0",
            arrayOf(localCalId.toString()),
            null
        )?.use { c ->
            while (c.moveToNext()) {
                val localId = c.getLong(0)
                val existingUid = c.getString(1)
                val uid = if (!existingUid.isNullOrBlank()) existingUid else "android-${UUID.randomUUID()}@chronosync"
                val ev = DavEvent(
                    uid = uid,
                    title = c.getString(2) ?: "Termin",
                    description = c.getString(3) ?: "",
                    location = c.getString(4) ?: "",
                    startMillis = c.getLong(5),
                    endMillis = c.getLong(6),
                    allDay = c.getInt(7) == 1
                )
                runCatching {
                    davClient.pushEvent(serverUrl, username, password, calInfo.id, ev)
                    val clearValues = ContentValues().apply {
                        put(CalendarContract.Events.DIRTY, 0)
                        put(CalendarContract.Events.SYNC_DATA1, uid)
                    }
                    resolver.update(
                        syncAdapterUri(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, localId), account),
                        clearValues,
                        null,
                        null
                    )
                }
            }
        }

        // 2. Vorhandene lokale Events nach UID indizieren
        val existingByUid = mutableMapOf<String, Long>()
        resolver.query(
            CalendarContract.Events.CONTENT_URI,
            arrayOf(CalendarContract.Events._ID, CalendarContract.Events.SYNC_DATA1),
            "${CalendarContract.Events.CALENDAR_ID}=? AND ${CalendarContract.Events.DELETED}=0",
            arrayOf(localCalId.toString()),
            null
        )?.use { c ->
            while (c.moveToNext()) {
                val uid = c.getString(1)
                if (!uid.isNullOrBlank()) {
                    existingByUid[uid] = c.getLong(0)
                }
            }
        }

        val remoteUids = remoteEvents.map { it.uid }.toSet()
        val tzId = TimeZone.getDefault().id

        for (ev in remoteEvents) {
            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, localCalId)
                put(CalendarContract.Events.SYNC_DATA1, ev.uid)
                put(CalendarContract.Events.TITLE, ev.title)
                put(CalendarContract.Events.DESCRIPTION, ev.description)
                put(CalendarContract.Events.EVENT_LOCATION, ev.location)
                put(CalendarContract.Events.DTSTART, ev.startMillis)
                put(CalendarContract.Events.DTEND, ev.endMillis)
                put(CalendarContract.Events.ALL_DAY, if (ev.allDay) 1 else 0)
                put(CalendarContract.Events.EVENT_TIMEZONE, tzId)
                put(CalendarContract.Events.STATUS, CalendarContract.Events.STATUS_CONFIRMED)
                put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_BUSY)
                put(CalendarContract.Events.DIRTY, 0)
            }
            val existingId = existingByUid[ev.uid]
            if (existingId != null) {
                resolver.update(
                    syncAdapterUri(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existingId), account),
                    values,
                    null,
                    null
                )
            } else {
                resolver.insert(syncAdapterUri(CalendarContract.Events.CONTENT_URI, account), values)
            }
        }

        // 3. Auf dem Server gelöschte Termine lokal entfernen
        for ((uid, localId) in existingByUid) {
            if (uid !in remoteUids) {
                resolver.delete(
                    syncAdapterUri(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, localId), account),
                    null,
                    null
                )
            }
        }

        return remoteEvents.size
    }
}

