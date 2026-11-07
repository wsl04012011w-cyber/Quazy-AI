package com.quazy.ai

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.util.concurrent.Executors

class QuazyNativeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var bridge: NativeBridge? = null
    private var pickerPromise: Promise? = null

    private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != REQUEST_MODEL) return
            val promise = pickerPromise ?: return
            pickerPromise = null
            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                promise.resolve("CANCELLED")
                return
            }
            val uri = data.data!!
            worker.execute {
                try { promise.resolve(copyAndLoad(uri)) }
                catch (error: Throwable) {
                    promise.resolve("ERROR:" + (error.message ?: error.javaClass.simpleName))
                }
            }
        }
    }

    init { context.addActivityEventListener(activityListener) }
    override fun getName(): String = "QuazyNative"

    @ReactMethod
    fun pickAndLoadModel(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "A tela do app não está disponível.")
            return
        }
        if (pickerPromise != null) {
            promise.reject("E_PICKER_BUSY", "O seletor de arquivos já está aberto.")
            return
        }
        pickerPromise = promise
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }
            activity.startActivityForResult(intent, REQUEST_MODEL)
        } catch (error: Throwable) {
            pickerPromise = null
            promise.reject("E_PICKER", error.message, error)
        }
    }

    private fun copyAndLoad(uri: Uri): String {
        val modelDir = File(context.cacheDir, "models").apply { mkdirs() }
        val name = queryDisplayName(uri) ?: "selected-model.gguf"
        val safeName = name.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
        val destination = File(modelDir, if (safeName.endsWith(".gguf", true)) safeName else "selected-model.gguf")
        context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Não foi possível abrir o arquivo selecionado." }
            destination.outputStream().buffered().use { output -> input.copyTo(output, 1024 * 1024) }
        }
        val memory = ActivityManager.MemoryInfo()
        (context.getSystemService(Activity.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
        return nativeBridge().nativeLoadModel(destination.absolutePath, 0, 2048, memory.availMem)
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    }.getOrNull()

    @ReactMethod
    fun generate(prompt: String, maxTokens: Int, promise: Promise) {
        worker.execute {
            try {
                val native = nativeBridge()
                val answer = native.nativeGenerate(prompt, maxTokens.coerceIn(1, 512))
                val result: WritableMap = Arguments.createMap().apply {
                    putString("answer", answer)
                    putString("stats", native.nativeTokenStats())
                }
                promise.resolve(result)
            } catch (error: Throwable) {
                promise.reject("E_GENERATE", error.message ?: error.javaClass.simpleName, error)
            }
        }
    }

    @ReactMethod
    fun releaseModel() {
        worker.execute { runCatching { bridge?.nativeReleaseModel() } }
    }

    @Synchronized
    private fun nativeBridge(): NativeBridge {
        bridge?.let { return it }
        return NativeBridge().also { bridge = it }
    }

    override fun invalidate() {
        context.removeActivityEventListener(activityListener)
        worker.execute { runCatching { bridge?.nativeReleaseModel() } }
        worker.shutdown()
        super.invalidate()
    }

    companion object { private const val REQUEST_MODEL = 4101 }
}
