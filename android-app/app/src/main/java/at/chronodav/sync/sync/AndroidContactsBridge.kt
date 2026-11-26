package at.chronodav.sync.sync

import android.accounts.Account
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.ContactsContract
import at.chronodav.sync.dav.DavClient
import at.chronodav.sync.dav.DavContact
import java.util.UUID

class AndroidContactsBridge(private val context: Context) {
    private fun syncAdapterUri(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
        .build()

    private fun syncAdapterAccountUri(uri: Uri, account: Account): Uri = uri.buildUpon()
        .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_NAME, account.name)
        .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_TYPE, account.type)
        .build()

    fun ensureContactsAccountReady(account: Account): Long {
        val resolver = context.contentResolver

        // 1. Konto in ContactsContract.Settings sichtbar & schreibbar markieren
        val settingsValues = ContentValues().apply {
            put(ContactsContract.Settings.ACCOUNT_NAME, account.name)
            put(ContactsContract.Settings.ACCOUNT_TYPE, account.type)
            put(ContactsContract.Settings.UNGROUPED_VISIBLE, 1)
            put(ContactsContract.Settings.SHOULD_SYNC, 1)
        }
        val updatedSettings = resolver.update(
            syncAdapterAccountUri(ContactsContract.Settings.CONTENT_URI, account),
            settingsValues,
            "${ContactsContract.Settings.ACCOUNT_NAME}=? AND ${ContactsContract.Settings.ACCOUNT_TYPE}=?",
            arrayOf(account.name, account.type)
        )
        if (updatedSettings == 0) {
            runCatching {
                resolver.insert(syncAdapterAccountUri(ContactsContract.Settings.CONTENT_URI, account), settingsValues)
            }
        }

        // 2. Standard-Gruppe "Meine Kontakte" sicherstellen (damit Google Kontakte das Konto im Speichern-Dialog zeigt)
        var groupId = -1L
        resolver.query(
            ContactsContract.Groups.CONTENT_URI,
            arrayOf(ContactsContract.Groups._ID),
            "${ContactsContract.Groups.ACCOUNT_NAME}=? AND ${ContactsContract.Groups.ACCOUNT_TYPE}=? AND ${ContactsContract.Groups.DELETED}=0",
            arrayOf(account.name, account.type),
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                groupId = cursor.getLong(0)
            }
        }

        val groupValues = ContentValues().apply {
            put(ContactsContract.Groups.ACCOUNT_NAME, account.name)
            put(ContactsContract.Groups.ACCOUNT_TYPE, account.type)
            put(ContactsContract.Groups.TITLE, "Meine Kontakte")
            put(ContactsContract.Groups.GROUP_VISIBLE, 1)
            put(ContactsContract.Groups.AUTO_ADD, 1)
            put(ContactsContract.Groups.GROUP_IS_READ_ONLY, 0)
            put(ContactsContract.Groups.SYSTEM_ID, "Contacts")
            put(ContactsContract.Groups.SOURCE_ID, "chronodav-contacts")
            put(ContactsContract.Groups.DELETED, 0)
        }

        if (groupId > 0L) {
            resolver.update(
                syncAdapterAccountUri(ContentUris.withAppendedId(ContactsContract.Groups.CONTENT_URI, groupId), account),
                groupValues,
                null,
                null
            )
        } else {
            val inserted = runCatching {
                resolver.insert(syncAdapterAccountUri(ContactsContract.Groups.CONTENT_URI, account), groupValues)
            }.getOrNull()
            if (inserted != null) {
                groupId = ContentUris.parseId(inserted)
            }
        }

        return groupId
    }

    fun syncContacts(
        account: Account,
        remoteContacts: List<DavContact>,
        davClient: DavClient,
        serverUrl: String,
        username: String,
        password: String
    ): Int {
        val resolver = context.contentResolver
        val defaultGroupId = ensureContactsAccountReady(account)

        // 0. Lokal gelöschte Kontakte auch auf dem Server löschen
        resolver.query(
            ContactsContract.RawContacts.CONTENT_URI,
            arrayOf(ContactsContract.RawContacts._ID, ContactsContract.RawContacts.SYNC1),
            "${ContactsContract.RawContacts.ACCOUNT_NAME}=? AND ${ContactsContract.RawContacts.ACCOUNT_TYPE}=? AND ${ContactsContract.RawContacts.DELETED}=1",
            arrayOf(account.name, account.type),
            null
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val rawId = cursor.getLong(0)
                val uid = cursor.getString(1)
                if (!uid.isNullOrBlank()) {
                    runCatching {
                        davClient.deleteContact(serverUrl, username, password, uid)
                    }
                }
                resolver.delete(
                    syncAdapterAccountUri(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI, rawId), account),
                    null,
                    null
                )
            }
        }

        // 1. Lokal geänderte oder neu angelegte Kontakte dieses Kontos zum Server hochladen
        resolver.query(
            ContactsContract.RawContacts.CONTENT_URI,
            arrayOf(ContactsContract.RawContacts._ID, ContactsContract.RawContacts.SYNC1),
            "${ContactsContract.RawContacts.ACCOUNT_NAME}=? AND ${ContactsContract.RawContacts.ACCOUNT_TYPE}=? AND ${ContactsContract.RawContacts.DIRTY}=1 AND ${ContactsContract.RawContacts.DELETED}=0",
            arrayOf(account.name, account.type),
            null
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val rawId = cursor.getLong(0)
                val existingUid = cursor.getString(1)
                val uid = if (!existingUid.isNullOrBlank()) existingUid else "android-${UUID.randomUUID()}@chronosync"
                val localContact = readRawContact(rawId, uid)
                if (localContact != null) {
                    runCatching {
                        davClient.pushContact(serverUrl, username, password, localContact)
                        val clear = ContentValues().apply {
                            put(ContactsContract.RawContacts.DIRTY, 0)
                            put(ContactsContract.RawContacts.SYNC1, uid)
                        }
                        resolver.update(
                            syncAdapterAccountUri(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI, rawId), account),
                            clear,
                            null,
                            null
                        )
                    }
                }
            }
        }

        // 2. Vorhandene lokale Kontakte indizieren
        val existingByUid = mutableMapOf<String, Long>()
        resolver.query(
            ContactsContract.RawContacts.CONTENT_URI,
            arrayOf(ContactsContract.RawContacts._ID, ContactsContract.RawContacts.SYNC1),
            "${ContactsContract.RawContacts.ACCOUNT_NAME}=? AND ${ContactsContract.RawContacts.ACCOUNT_TYPE}=? AND ${ContactsContract.RawContacts.DELETED}=0",
            arrayOf(account.name, account.type),
            null
        )?.use { c ->
            while (c.moveToNext()) {
                val uid = c.getString(1)
                if (!uid.isNullOrBlank()) existingByUid[uid] = c.getLong(0)
            }
        }

        val remoteUids = remoteContacts.map { it.uid }.toSet()

        // 3. Kontakte vom Server einfügen / aktualisieren
        for (contact in remoteContacts) {
            val existingRawId = existingByUid[contact.uid]
            if (existingRawId != null) {
                resolver.delete(
                    syncAdapterAccountUri(ContactsContract.Data.CONTENT_URI, account),
                    "${ContactsContract.Data.RAW_CONTACT_ID}=?",
                    arrayOf(existingRawId.toString())
                )
                insertContactData(existingRawId, contact, defaultGroupId, account)
            } else {
                val rawValues = ContentValues().apply {
                    put(ContactsContract.RawContacts.ACCOUNT_NAME, account.name)
                    put(ContactsContract.RawContacts.ACCOUNT_TYPE, account.type)
                    put(ContactsContract.RawContacts.SYNC1, contact.uid)
                    put(ContactsContract.RawContacts.DIRTY, 0)
                }
                val inserted = resolver.insert(syncAdapterAccountUri(ContactsContract.RawContacts.CONTENT_URI, account), rawValues)
                val newRawId = inserted?.let { ContentUris.parseId(it) }
                if (newRawId != null) {
                    insertContactData(newRawId, contact, defaultGroupId, account)
                }
            }
        }

        // 4. Gelöschte Server-Kontakte lokal bereinigen
        for ((uid, rawId) in existingByUid) {
            if (uid !in remoteUids) {
                resolver.delete(
                    syncAdapterAccountUri(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI, rawId), account),
                    null,
                    null
                )
            }
        }

        return remoteContacts.size
    }

    private fun insertContactData(rawContactId: Long, c: DavContact, defaultGroupId: Long, account: Account) {
        val ops = ArrayList<ContentProviderOperation>()
        val dataUri = syncAdapterAccountUri(ContactsContract.Data.CONTENT_URI, account)

        if (defaultGroupId > 0L) {
            ops.add(
                ContentProviderOperation.newInsert(dataUri)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.GroupMembership.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.GroupMembership.GROUP_ROW_ID, defaultGroupId)
                    .build()
            )
        }

        // Name
        ops.add(
            ContentProviderOperation.newInsert(dataUri)
                .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME, c.firstName)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME, c.lastName)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, c.displayName)
                .build()
        )

        // Telefonnummern
        for ((lbl, phone) in c.phones) {
            val type = when {
                lbl.contains("Mobil", true) -> ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE
                lbl.contains("Arbeit", true) -> ContactsContract.CommonDataKinds.Phone.TYPE_WORK
                else -> ContactsContract.CommonDataKinds.Phone.TYPE_HOME
            }
            ops.add(
                ContentProviderOperation.newInsert(dataUri)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, phone)
                    .withValue(ContactsContract.CommonDataKinds.Phone.TYPE, type)
                    .build()
            )
        }

        // E-Mails
        for ((lbl, email) in c.emails) {
            val type = if (lbl.contains("Arbeit", true)) {
                ContactsContract.CommonDataKinds.Email.TYPE_WORK
            } else {
                ContactsContract.CommonDataKinds.Email.TYPE_HOME
            }
            ops.add(
                ContentProviderOperation.newInsert(dataUri)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Email.ADDRESS, email)
                    .withValue(ContactsContract.CommonDataKinds.Email.TYPE, type)
                    .build()
            )
        }

        // Firma / Position
        if (c.company.isNotBlank() || c.jobTitle.isNotBlank()) {
            ops.add(
                ContentProviderOperation.newInsert(dataUri)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Organization.COMPANY, c.company)
                    .withValue(ContactsContract.CommonDataKinds.Organization.TITLE, c.jobTitle)
                    .build()
            )
        }

        // Adresse
        if (c.street.isNotBlank() || c.city.isNotBlank() || c.zip.isNotBlank() || c.country.isNotBlank()) {
            ops.add(
                ContentProviderOperation.newInsert(dataUri)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.StructuredPostal.STREET, c.street)
                    .withValue(ContactsContract.CommonDataKinds.StructuredPostal.CITY, c.city)
                    .withValue(ContactsContract.CommonDataKinds.StructuredPostal.POSTCODE, c.zip)
                    .withValue(ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY, c.country)
                    .build()
            )
        }

        // Notiz
        if (c.notes.isNotBlank()) {
            ops.add(
                ContentProviderOperation.newInsert(dataUri)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Note.NOTE, c.notes)
                    .build()
            )
        }

        if (ops.isNotEmpty()) {
            context.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
        }
    }

    private fun Cursor.safeString(column: String): String {
        val idx = getColumnIndex(column)
        return if (idx >= 0) getString(idx) ?: "" else ""
    }

    private fun Cursor.safeInt(column: String, fallback: Int = 0): Int {
        val idx = getColumnIndex(column)
        return if (idx >= 0) getInt(idx) else fallback
    }

    private fun readRawContact(rawId: Long, uid: String): DavContact? {
        var first = ""
        var last = ""
        var display = ""
        var company = ""
        var jobTitle = ""
        var street = ""
        var city = ""
        var zip = ""
        var country = ""
        var notes = ""
        val emails = mutableListOf<Pair<String, String>>()
        val phones = mutableListOf<Pair<String, String>>()

        context.contentResolver.query(
            ContactsContract.Data.CONTENT_URI,
            null,
            "${ContactsContract.Data.RAW_CONTACT_ID}=?",
            arrayOf(rawId.toString()),
            null
        )?.use { d ->
            val mimeIdx = d.getColumnIndex(ContactsContract.Data.MIMETYPE)
            if (mimeIdx < 0) return@use
            while (d.moveToNext()) {
                val mime = d.getString(mimeIdx) ?: continue
                when (mime) {
                    ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE -> {
                        first = d.safeString(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME)
                        last = d.safeString(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME)
                        display = d.safeString(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME)
                    }
                    ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE -> {
                        val num = d.safeString(ContactsContract.CommonDataKinds.Phone.NUMBER)
                        val type = d.safeInt(ContactsContract.CommonDataKinds.Phone.TYPE)
                        val lbl = when (type) {
                            ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE -> "Mobil"
                            ContactsContract.CommonDataKinds.Phone.TYPE_WORK -> "Arbeit"
                            else -> "Privat"
                        }
                        if (num.isNotBlank()) phones.add(lbl to num)
                    }
                    ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE -> {
                        val addr = d.safeString(ContactsContract.CommonDataKinds.Email.ADDRESS)
                        val type = d.safeInt(ContactsContract.CommonDataKinds.Email.TYPE)
                        val lbl = if (type == ContactsContract.CommonDataKinds.Email.TYPE_WORK) "Arbeit" else "Privat"
                        if (addr.isNotBlank()) emails.add(lbl to addr)
                    }
                    ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE -> {
                        company = d.safeString(ContactsContract.CommonDataKinds.Organization.COMPANY)
                        jobTitle = d.safeString(ContactsContract.CommonDataKinds.Organization.TITLE)
                    }
                    ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE -> {
                        street = d.safeString(ContactsContract.CommonDataKinds.StructuredPostal.STREET)
                        city = d.safeString(ContactsContract.CommonDataKinds.StructuredPostal.CITY)
                        zip = d.safeString(ContactsContract.CommonDataKinds.StructuredPostal.POSTCODE)
                        country = d.safeString(ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY)
                    }
                    ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE -> {
                        notes = d.safeString(ContactsContract.CommonDataKinds.Note.NOTE)
                    }
                }
            }
        }

        val resolvedDisplay = display.ifBlank { "$first $last".trim() }.ifBlank { company }
            .ifBlank { emails.firstOrNull()?.second ?: phones.firstOrNull()?.second ?: "" }
        if (resolvedDisplay.isBlank()) return null
        val finalFirst = first.ifBlank { resolvedDisplay.substringBefore(' ') }
        val finalLast = last.ifBlank { resolvedDisplay.substringAfter(' ', "") }
        return DavContact(uid, finalFirst, finalLast, resolvedDisplay, company, jobTitle, emails, phones, street, city, zip, country, notes)
    }
}

