package at.chronodav.sync.sync

import android.accounts.AbstractAccountAuthenticator
import android.accounts.Account
import android.accounts.AccountAuthenticatorResponse
import android.app.Service
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.os.Bundle
import android.os.IBinder

class ChronoAuthenticator(private val context: Context) : AbstractAccountAuthenticator(context) {
    override fun editProperties(response: AccountAuthenticatorResponse?, accountType: String?): Bundle = Bundle()
    override fun addAccount(
        response: AccountAuthenticatorResponse?,
        accountType: String?,
        authTokenType: String?,
        requiredFeatures: Array<out String>?,
        options: Bundle?
    ): Bundle {
        val intent = Intent(context, at.chronodav.sync.ui.MainActivity::class.java)
        intent.putExtra("accountAuthenticatorResponse", response)
        return Bundle().apply { putParcelable("intent", intent) }
    }

    override fun confirmCredentials(response: AccountAuthenticatorResponse?, account: Account?, options: Bundle?): Bundle? = null
    override fun getAuthToken(response: AccountAuthenticatorResponse?, account: Account?, authTokenType: String?, options: Bundle?): Bundle = Bundle()
    override fun getAuthTokenLabel(authTokenType: String?): String = "ChronoSync"
    override fun updateCredentials(response: AccountAuthenticatorResponse?, account: Account?, authTokenType: String?, options: Bundle?): Bundle? = null
    override fun hasFeatures(response: AccountAuthenticatorResponse?, account: Account?, features: Array<out String>?): Bundle =
        Bundle().apply { putBoolean("booleanResult", false) }
}

class ChronoAuthenticatorService : Service() {
    private lateinit var authenticator: ChronoAuthenticator
    override fun onCreate() {
        authenticator = ChronoAuthenticator(this)
    }

    override fun onBind(intent: Intent?): IBinder = authenticator.iBinder
}

class ChronoSyncAdapter(context: Context, autoInitialize: Boolean) :
    AbstractThreadedSyncAdapter(context, autoInitialize) {
    override fun onPerformSync(
        account: Account,
        extras: Bundle,
        authority: String,
        provider: ContentProviderClient,
        syncResult: SyncResult
    ) {
        val res = SyncEngine.runFullSync(context, "System-Sync ($authority)")
        if (res.isFailure) {
            syncResult.stats.numIoExceptions++
        }
    }
}

class CalendarSyncService : Service() {
    override fun onBind(intent: Intent?): IBinder = syncAdapter.syncAdapterBinder

    companion object {
        private var adapter: ChronoSyncAdapter? = null
        private val lock = Any()
    }

    private val syncAdapter: ChronoSyncAdapter
        get() = synchronized(lock) {
            adapter ?: ChronoSyncAdapter(applicationContext, true).also { adapter = it }
        }
}

class ContactsSyncService : Service() {
    override fun onBind(intent: Intent?): IBinder = syncAdapter.syncAdapterBinder

    companion object {
        private var adapter: ChronoSyncAdapter? = null
        private val lock = Any()
    }

    private val syncAdapter: ChronoSyncAdapter
        get() = synchronized(lock) {
            adapter ?: ChronoSyncAdapter(applicationContext, true).also { adapter = it }
        }
}
