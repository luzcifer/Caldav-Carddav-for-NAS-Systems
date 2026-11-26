package at.chronodav.sync.ui

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import at.chronodav.sync.data.SyncPreferences
import at.chronodav.sync.dav.DavClient
import at.chronodav.sync.sync.AppLaunchSyncService
import at.chronodav.sync.sync.SyncEngine
import at.chronodav.sync.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF8AB4F8),
                    onPrimary = Color(0xFF041E49),
                    background = Color(0xFF111318),
                    surface = Color(0xFF1B1E26)
                )
            ) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ChronoSyncScreen()
                }
            }
        }
    }
}

fun isAccessibilityEnabled(context: Context): Boolean {
    val expected = ComponentName(context, AppLaunchSyncService::class.java).flattenToString()
    val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabled)
    while (splitter.hasNext()) {
        if (splitter.next().equals(expected, ignoreCase = true)) return true
    }
    return false
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ChronoSyncScreen() {
    val context = LocalContext.current
    val prefs = remember { SyncPreferences(context) }
    var settings by remember { mutableStateOf(prefs.load()) }
    var logs by remember { mutableStateOf(prefs.getLogs()) }

    var serverUrl by remember { mutableStateOf(settings.serverUrl) }
    var username by remember { mutableStateOf(settings.username) }
    var password by remember { mutableStateOf(settings.password) }
    var intervalMinutes by remember { mutableIntStateOf(settings.intervalMinutes) }
    var syncOnAppOpen by remember { mutableStateOf(settings.syncOnAppOpen) }
    var syncCalendar by remember { mutableStateOf(settings.syncCalendar) }
    var syncContacts by remember { mutableStateOf(settings.syncContacts) }

    var testing by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }
    var bannerMsg by remember { mutableStateOf<String?>(null) }
    var accessibilityActive by remember { mutableStateOf(isAccessibilityEnabled(context)) }

    var hasPermissions by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CONTACTS) == PackageManager.PERMISSION_GRANTED
        )
    }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        hasPermissions = result.values.all { it }
    }

    val scope = rememberCoroutineScope()

    fun refreshState() {
        settings = prefs.load()
        logs = prefs.getLogs()
        accessibilityActive = isAccessibilityEnabled(context)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "ChronoSync",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "CalDAV & CardDAV Sync für Android Kalender & Kontakte",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Icon(Icons.Default.Sync, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        }

        // Berechtigungen
        if (!hasPermissions) {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF3B2A12))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFFBBF24))
                        Text("Kalender- & Kontakte-Zugriff erforderlich", fontWeight = FontWeight.SemiBold)
                    }
                    Text(
                        "Damit Termine und Kontakte direkt in der Handy-App erscheinen, bitte Berechtigungen freigeben.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Button(onClick = {
                        permLauncher.launch(
                            arrayOf(
                                Manifest.permission.READ_CALENDAR,
                                Manifest.permission.WRITE_CALENDAR,
                                Manifest.permission.READ_CONTACTS,
                                Manifest.permission.WRITE_CONTACTS
                            )
                        )
                    }) {
                        Text("Berechtigungen erteilen")
                    }
                }
            }
        }

        // Status & Sofort-Sync Karte
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Sync-Status", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(settings.lastSyncStatus, style = MaterialTheme.typography.bodyMedium)

                val timeStr = if (settings.lastSyncTime > 0L) {
                    SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.GERMANY).format(Date(settings.lastSyncTime))
                } else {
                    "Noch nie"
                }
                Text(
                    "Letzter Sync: $timeStr · ${settings.lastEventCount} Termine · ${settings.lastContactCount} Kontakte",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Button(
                    onClick = {
                        syncing = true
                        bannerMsg = null
                        scope.launch {
                            prefs.saveConnection(serverUrl, username, password)
                            val res = withContext(Dispatchers.IO) {
                                SyncEngine.runFullSync(context, "Jetzt-Sync")
                            }
                            syncing = false
                            refreshState()
                            bannerMsg = res.fold(
                                onSuccess = { it },
                                onFailure = { "Fehler: ${it.message}" }
                            )
                        }
                    },
                    enabled = !syncing,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (syncing) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Synchronisiere...")
                    } else {
                        Icon(Icons.Default.Refresh, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Jetzt syncen")
                    }
                }

                bannerMsg?.let { msg ->
                    Text(msg, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        // Sync-Intervall & App-Start Auto-Sync
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Sync-Intervall & App-Start", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val options = listOf(0 to "Nur Jetzt") + SyncScheduler.ALLOWED_INTERVALS.map { it to "$it Min" }
                    options.forEach { (mins, label) ->
                        FilterChip(
                            selected = intervalMinutes == mins,
                            onClick = {
                                intervalMinutes = mins
                                prefs.saveSchedule(mins, syncOnAppOpen, syncCalendar, syncContacts)
                                SyncScheduler.applySchedule(context)
                                refreshState()
                            },
                            label = { Text(label) }
                        )
                    }
                }

                HorizontalDivider()

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Sync beim Öffnen von Kalender / Kontakte", fontWeight = FontWeight.Medium)
                        Text(
                            if (accessibilityActive) "Dienst aktiv — synct automatisch beim App-Start"
                            else "Bedienungshilfe einmalig aktivieren für Sofort-Sync beim App-Start",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = syncOnAppOpen,
                        onCheckedChange = { checked ->
                            syncOnAppOpen = checked
                            prefs.saveSchedule(intervalMinutes, checked, syncCalendar, syncContacts)
                        }
                    )
                }

                if (syncOnAppOpen && !accessibilityActive) {
                    OutlinedButton(
                        onClick = {
                            context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("App-Start Auto-Sync in Android-Einstellungen aktivieren")
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = syncCalendar,
                            onCheckedChange = {
                                syncCalendar = it
                                prefs.saveSchedule(intervalMinutes, syncOnAppOpen, it, syncContacts)
                            }
                        )
                        Icon(Icons.Default.CalendarMonth, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Kalender")
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = syncContacts,
                            onCheckedChange = {
                                syncContacts = it
                                prefs.saveSchedule(intervalMinutes, syncOnAppOpen, syncCalendar, it)
                            }
                        )
                        Icon(Icons.Default.Contacts, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Kontakte")
                    }
                }
            }
        }

        // Server-Verbindung
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("ChronoDAV Server-Verbindung", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Server-URL (z.B. https://nas.domain.de oder http://192.168.1.10:3080)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("Benutzername") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Passwort") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = {
                            testing = true
                            bannerMsg = null
                            scope.launch {
                                val res = withContext(Dispatchers.IO) {
                                    DavClient().testConnection(serverUrl, username, password)
                                }
                                testing = false
                                bannerMsg = res.fold(
                                    onSuccess = { "Verbindung erfolgreich: $it" },
                                    onFailure = { "Verbindung fehlgeschlagen: ${it.message}" }
                                )
                            }
                        },
                        enabled = !testing,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(if (testing) "Teste..." else "Testen")
                    }

                    Button(
                        onClick = {
                            prefs.saveConnection(serverUrl, username, password)
                            prefs.saveSchedule(intervalMinutes, syncOnAppOpen, syncCalendar, syncContacts)
                            SyncEngine.ensureSystemAccount(context, username, password)
                            SyncScheduler.applySchedule(context)
                            bannerMsg = "Konto gespeichert & Sync-Plan aktiviert."
                            refreshState()
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Speichern")
                    }
                }
            }
        }

        // Sync-Protokoll
        if (logs.isNotEmpty()) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Sync-Protokoll", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    logs.take(15).forEach { line ->
                        Text(
                            text = line,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 2.dp)
                        )
                    }
                }
            }
        }
    }
}
