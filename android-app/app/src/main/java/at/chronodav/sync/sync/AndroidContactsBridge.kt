package at.chronodav.sync.sync

import android.accounts.Account
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import at.chronodav.sync.dav.DavClient
import at.chronodav.sync.dav.DavContact
import java.util.UUID

class AndroidContactsBridge(private val context: Context) {
    private fun syncAdapterUri(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
        .build()

    fun syncContacts(
        account: Account,
        remoteContacts: List<DavContact>,
        davClient: DavClient,
        serverUrl: String,
        username: String,
        password: String
    ): Int {
        val resolver = context.contentResolver

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
                            syncAdapterUri(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI, rawId)),
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
                // Bestehende Datenzeilen ersetzen
                resolver.delete(
                    syncAdapterUri(ContactsContract.Data.CONTENT_URI),
                    "${ContactsContract.Data.RAW_CONTACT_ID}=?",
                    arrayOf(existingRawId.toString())
                )
                insertContactData(existingRawId, contact)
            } else {
                val rawValues = ContentValues().apply {
                    put(ContactsContract.RawContacts.ACCOUNT_NAME, account.name)
                    put(ContactsContract.RawContacts.ACCOUNT_TYPE, account.type)
                    put(ContactsContract.RawContacts.SYNC1, contact.uid)
                    put(ContactsContract.RawContacts.DIRTY, 0)
                }
                val inserted = resolver.insert(syncAdapterUri(ContactsContract.RawContacts.CONTENT_URI), rawValues)
                val newRawId = inserted?.let { ContentUris.parseId(it) }
                if (newRawId != null) {
                    insertContactData(newRawId, contact)
                }
            }
        }

        // 4. Gelöschte Server-Kontakte lokal bereinigen
        for ((uid, rawId) in existingByUid) {
            if (uid !in remoteUids) {
                resolver.delete(
                    syncAdapterUri(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI, rawId)),
                    null,
                    null
                )
            }
        }

        return remoteContacts.size
    }

    private fun insertContactData(rawContactId: Long, c: DavContact) {
        val ops = ArrayList<ContentProviderOperation>()

        // Name
        ops.add(
            ContentProviderOperation.newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI))
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
                ContentProviderOperation.newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI))
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
                ContentProviderOperation.newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI))
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
                ContentProviderOperation.newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI))
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
                ContentProviderOperation.newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI))
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
                ContentProviderOperation.newInsert(syncAdapterUri(ContactsContract.Data.CONTENT_URI))
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
            while (d.moveToNext()) {
                val mime = d.getString(mimeIdx) ?: continue
                when (mime) {
                    ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE -> {
                        first = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME)) ?: ""
                        last = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME)) ?: ""
                        display = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME)) ?: ""
                    }
                    ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE -> {
                        val num = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)) ?: ""
                        val type = d.getInt(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.TYPE))
                        val lbl = if (type == ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE) "Mobil" else if (type == ContactsContract.CommonDataKinds.Phone.TYPE_WORK) "Arbeit" else "Privat"
                        if (num.isNotBlank()) phones.add(lbl to num)
                    }
                    ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE -> {
                        val addr = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.ADDRESS)) ?: ""
                        val type = d.getInt(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.TYPE))
                        val lbl = if (type == ContactsContract.CommonDataKinds.Email.TYPE_WORK) "Arbeit" else "Privat"
                        if (addr.isNotBlank()) emails.add(lbl to addr)
                    }
                    ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE -> {
                        company = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Organization.COMPANY)) ?: ""
                        jobTitle = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Organization.TITLE)) ?: ""
                    }
                    ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE -> {
                        street = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredPostal.STREET)) ?: ""
                        city = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredPostal.CITY)) ?: ""
                        zip = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredPostal.POSTCODE)) ?: ""
                        country = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY)) ?: ""
                    }
                    ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE -> {
                        notes = d.getString(d.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Note.NOTE)) ?: ""
                    }
                }
            }
        }

        val resolvedDisplay = display.ifBlank { "$first $last".trim() }.ifBlank { company }
        if (resolvedDisplay.isBlank()) return null
        return DavContact(uid, first, last, resolvedDisplay, company, jobTitle, emails, phones, street, city, zip, country, notes)
    }
}
