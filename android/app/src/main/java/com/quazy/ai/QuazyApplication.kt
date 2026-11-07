package com.quazy.ai

import android.app.Application
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

class QuazyApplication : Application(), ReactApplication {
    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages() = PackageList(this).packages.apply { add(QuazyPackage()) }
            override fun getJSMainModuleName(): String = "index"
            override fun getUseDeveloperSupport(): Boolean = false
            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }
    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)
    private lateinit var diagnosticsDir: File

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, OpenSourceMergedSoMapping)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) load()
        diagnosticsDir = File(filesDir, "diagnostics").apply { mkdirs() }
        val report = buildString {
            appendLine("QUAZY AI DIAGNOSTICS")
            appendLine("Captured: " + Date())
            appendLine("App: " + packageName)
            appendLine("Android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")")
            appendLine("Device: " + Build.MANUFACTURER + " " + Build.MODEL)
            appendLine("ABI: " + Build.SUPPORTED_ABIS.joinToString())
            appendLine()
            appendLine("========== PREVIOUS JAVA/KOTLIN CRASH ==========")
            val crash = File(diagnosticsDir, "last_crash.txt")
            if (crash.exists()) appendLine(crash.readText()) else appendLine("No saved Java/Kotlin crash from previous launch.")
            appendLine()
            appendLine("========== PREVIOUS CRASH LOGCAT ==========")
            val oldLog = File(diagnosticsDir, "crash_logcat.txt")
            if (oldLog.exists()) appendLine(oldLog.readText())
            appendLine()
            appendLine("========== CURRENT STARTUP LOGCAT (best effort) ==========")
            appendLine(readLogcat())
        }
        val reportFile = File(diagnosticsDir, "QuazyAI-diagnostics-" + timestamp() + ".txt")
        runCatching { reportFile.writeText(report) }.onFailure { Log.e(TAG, "Could not save diagnostics", it) }
        val exported = runCatching { exportToDownloads(reportFile) }
            .onFailure { Log.e(TAG, "Could not export diagnostics", it) }.getOrNull()
        installCrashHandler()
        Log.i(TAG, if (exported != null) "Diagnostics exported: " + exported else "Diagnostics saved internally.")
    }

    private fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val stack = StringWriter().also { throwable.printStackTrace(PrintWriter(it)) }.toString()
                File(diagnosticsDir, "last_crash.txt").writeText("CRASH TIME: " + Date() + "\nTHREAD: " + thread.name + "\n" + stack)
                File(diagnosticsDir, "crash_logcat.txt").writeText(readLogcat())
                Log.e(TAG, "Uncaught exception on " + thread.name, throwable)
            }
            if (previous != null) previous.uncaughtException(thread, throwable)
            else {
                android.os.Process.killProcess(android.os.Process.myPid())
                kotlin.system.exitProcess(10)
            }
        }
    }

    private fun readLogcat(): String = try {
        val process = ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", "2500").redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        process.waitFor(4, TimeUnit.SECONDS)
        output.ifBlank { "No readable logcat entries (Android may restrict access)." }
    } catch (error: Throwable) {
        "Unable to read logcat: " + error.javaClass.simpleName + ": " + error.message
    }

    private fun exportToDownloads(source: File): String {
        val name = source.name
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "text/plain")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/QuazyAI")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("MediaStore could not create Downloads entry")
            try {
                contentResolver.openOutputStream(uri)?.use { output ->
                    source.inputStream().use { input -> input.copyTo(output) }
                } ?: error("Could not open Downloads output stream")
                val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                contentResolver.update(uri, done, null, null)
                return "Downloads/QuazyAI/" + name
            } catch (error: Throwable) {
                contentResolver.delete(uri, null, null)
                throw error
            }
        }
        val fallback = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: File(filesDir, "Downloads")
        fallback.mkdirs()
        return source.copyTo(File(fallback, name), overwrite = true).absolutePath
    }

    private fun timestamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
    companion object { private const val TAG = "QuazyDiagnostics" }
}
