package com.quazy.ai

import android.app.Application
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Captures startup logs and persists uncaught crashes for export on next launch. */
class QuazyApplication : Application() {
    private lateinit var diagnosticsDir: File
    private lateinit var sessionLog: File

    override fun onCreate() {
        super.onCreate()
        diagnosticsDir = File(filesDir, "diagnostics").apply { mkdirs() }

        // This runs before MainActivity and before the lazy JNI bridge is loaded.
        val report = buildString {
            appendLine("QUAZY AI DIAGNOSTICS")
            appendLine("Captured: " + Date())
            appendLine("App: " + packageName)
            appendLine("Android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")")
            appendLine("Device: " + Build.MANUFACTURER + " " + Build.MODEL)
            appendLine("ABI: " + Build.SUPPORTED_ABIS.joinToString())
            appendLine()
            appendLine("========== PREVIOUS JAVA/KOTLIN CRASH ==========")
            val previousCrash = File(diagnosticsDir, "last_crash.txt")
            if (previousCrash.exists()) appendLine(previousCrash.readText())
            else appendLine("No saved Java/Kotlin crash from previous launch.")
            appendLine()
            appendLine("========== PREVIOUS CRASH LOGCAT ==========")
            val previousLogcat = File(diagnosticsDir, "crash_logcat.txt")
            if (previousLogcat.exists()) appendLine(previousLogcat.readText())
            appendLine()
            appendLine("========== CURRENT STARTUP LOGCAT (best effort) ==========")
            appendLine(readLogcat())
        }

        val reportFile = File(diagnosticsDir, "QuazyAI-diagnostics-" + timestamp() + ".txt")
        runCatching { reportFile.writeText(report) }
            .onFailure { Log.e(TAG, "Could not save diagnostics report", it) }

        // Export immediately, before any Activity/native initialization.
        val exported = runCatching { exportToDownloads(reportFile) }
            .onFailure { Log.e(TAG, "Could not export diagnostics to Downloads", it) }
            .getOrNull()

        sessionLog = File(diagnosticsDir, "current_session.log")
        runCatching {
            sessionLog.writeText("Session started: " + Date() + "\nDevice: " +
                Build.MANUFACTURER + " " + Build.MODEL + "\n")
        }
        installCrashHandler()

        Log.i(TAG, if (exported != null) "Diagnostics exported: " + exported
            else "Diagnostics saved internally: " + reportFile.absolutePath)
    }

    private fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val stack = StringWriter().also { writer ->
                    throwable.printStackTrace(PrintWriter(writer))
                }.toString()
                File(diagnosticsDir, "last_crash.txt").writeText(
                    "CRASH TIME: " + Date() + "\nTHREAD: " + thread.name + "\n" + stack
                )
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

    private fun readLogcat(): String {
        return try {
            val process = ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", "2500")
                .redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            process.waitFor(4, TimeUnit.SECONDS)
            output.ifBlank { "No readable logcat entries (Android may restrict access)." }
        } catch (error: Throwable) {
            "Unable to read logcat: " + error.javaClass.simpleName + ": " + error.message
        }
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
                val completed = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                contentResolver.update(uri, completed, null, null)
                return "Downloads/QuazyAI/" + name
            } catch (error: Throwable) {
                contentResolver.delete(uri, null, null)
                throw error
            }
        }

        // Android 9 fallback: app-specific Downloads, avoiding a permission prompt.
        val fallback = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: File(filesDir, "Downloads")
        fallback.mkdirs()
        val destination = File(fallback, name)
        source.copyTo(destination, overwrite = true)
        return destination.absolutePath
    }

    private fun timestamp(): String =
        SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

    companion object { private const val TAG = "QuazyDiagnostics" }
}
