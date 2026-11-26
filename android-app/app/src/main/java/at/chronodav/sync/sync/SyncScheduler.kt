package at.chronodav.sync.sync

import android.content.ContentResolver
import android.content.Context
import android.os.Bundle
import android.provider.CalendarContract
import android.provider.ContactsContract
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import at.chronodav.sync.data.SyncPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class SyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val reason = inputData.getString("reason") ?: "Geplanter Sync"
        val res = SyncEngine.runFullSync(applicationContext, reason)

        // Falls ein Intervall < 15 Min (5 oder 10 Min) gewählt ist, nächsten Lauf automatisch einplanen
        val interval = SyncPreferences(applicationContext).load().intervalMinutes
        if (interval in listOf(5, 10) && reason != "Sofort-Sync") {
            SyncScheduler.scheduleShortIntervalChain(applicationContext, interval)
        }

        if (res.isSuccess) Result.success() else Result.retry()
    }
}

object SyncScheduler {
    private const val PERIODIC_WORK_NAME = "chronosync_periodic"
    private const val SHORT_CHAIN_WORK_NAME = "chronosync_short_interval"
    private const val IMMEDIATE_WORK_NAME = "chronosync_immediate"

    val ALLOWED_INTERVALS = listOf(5, 10, 15, 30, 45, 60)

    fun applySchedule(context: Context) {
        val prefs = SyncPreferences(context).load()
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(PERIODIC_WORK_NAME)
        wm.cancelUniqueWork(SHORT_CHAIN_WORK_NAME)

        val interval = prefs.intervalMinutes
        if (interval <= 0) {
            return
        }

        // System SyncAdapter Periodik setzen
        if (prefs.username.isNotBlank()) {
            val account = SyncEngine.ensureSystemAccount(context, prefs.username, prefs.password)
            val seconds = interval.toLong() * 60L
            ContentResolver.addPeriodicSync(account, CalendarContract.AUTHORITY, Bundle.EMPTY, seconds)
            ContentResolver.addPeriodicSync(account, ContactsContract.AUTHORITY, Bundle.EMPTY, seconds)
        }

        if (interval >= 15) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val req = PeriodicWorkRequestBuilder<SyncWorker>(interval.toLong(), TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setInputData(workDataOf("reason" to "Auto-Sync (${interval}m)"))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            wm.enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, req)
        } else {
            // Für 5 und 10 Minuten WorkManager OneTime-Chain nutzen (da Android PeriodicWork min. 15 Min hat)
            scheduleShortIntervalChain(context, interval)
        }
    }

    fun scheduleShortIntervalChain(context: Context, minutes: Int) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInitialDelay(minutes.toLong(), TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setInputData(workDataOf("reason" to "Auto-Sync (${minutes}m)"))
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(SHORT_CHAIN_WORK_NAME, ExistingWorkPolicy.REPLACE, req)
    }

    fun triggerImmediateSync(context: Context, reason: String = "Sofort-Sync") {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(workDataOf("reason" to reason))
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(IMMEDIATE_WORK_NAME, ExistingWorkPolicy.REPLACE, req)
    }
}
