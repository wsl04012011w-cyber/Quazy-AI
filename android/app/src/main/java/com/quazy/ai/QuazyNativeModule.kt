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
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.Executors

class QuazyNativeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var bridge: NativeBridge? = null
    @Volatile private var loadedModelName: String? = null
    private var importPromise: Promise? = null

    private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != REQUEST_MODEL) return
            val promise = importPromise ?: return
            importPromise = null
            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                promise.resolve("CANCELLED")
                return
            }
            val uri = data.data!!
            worker.execute {
                try {
                    promise.resolve(copyModelToLibrary(uri))
                } catch (error: Throwable) {
                    promise.reject("E_IMPORT_MODEL", error.message ?: "Não foi possível importar o GGUF.", error)
                }
            }
        }
    }

    init { context.addActivityEventListener(activityListener) }
    override fun getName(): String = "QuazyNative"

    private fun modelsDirectory(): File = File(context.filesDir, "models").apply { mkdirs() }

    @ReactMethod
    fun pickAndImportModel(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "A tela do app não está disponível.")
            return
        }
        if (importPromise != null) {
            promise.reject("E_PICKER_BUSY", "O seletor de arquivos já está aberto.")
            return
        }
        importPromise = promise
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/octet-stream"
            }
            activity.startActivityForResult(intent, REQUEST_MODEL)
        } catch (error: Throwable) {
            importPromise = null
            promise.reject("E_PICKER", error.message, error)
        }
    }

    private fun copyModelToLibrary(uri: Uri): String {
        val displayName = queryDisplayName(uri) ?: "modelo.gguf"
        val sanitized = displayName.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
        require(sanitized.endsWith(".gguf", ignoreCase = true)) {
            "Selecione um arquivo com extensão .gguf."
        }

        val directory = modelsDirectory()
        val base = sanitized.removeSuffix(".gguf").removeSuffix(".GGUF")
        var destination = File(directory, "$base.gguf")
        var suffix = 2
        while (destination.exists()) {
            destination = File(directory, "$base-$suffix.gguf")
            suffix++
        }

        val temporary = File(directory, ".import-${System.nanoTime()}.part")
        try {
            context.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "Não foi possível abrir o arquivo escolhido." }
                temporary.outputStream().buffered().use { output ->
                    input.copyTo(output, 1024 * 1024)
                }
            }
            require(temporary.length() >= 4L) { "O arquivo selecionado está vazio ou incompleto." }
            RandomAccessFile(temporary, "r").use { file ->
                val magic = ByteArray(4)
                file.readFully(magic)
                require(magic.contentEquals(byteArrayOf(0x47, 0x47, 0x55, 0x46))) {
                    "O arquivo não tem a assinatura GGUF. Escolha um modelo GGUF válido."
                }
            }
            check(temporary.renameTo(destination)) { "Não foi possível salvar o modelo na biblioteca do app." }
            return destination.name
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    }.getOrNull()

    private fun resolveModel(name: String): File {
        require(name.endsWith(".gguf", ignoreCase = true)) { "Nome de modelo inválido." }
        val directory = modelsDirectory().canonicalFile
        val file = File(directory, name).canonicalFile
        require(file.parentFile == directory && file.isFile && file.length() > 0L) {
            "Esse modelo não está na biblioteca local. Importe novamente o arquivo."
        }
        return file
    }

    @ReactMethod
    fun listModels(promise: Promise) {
        try {
            val models = modelsDirectory().listFiles()
                ?.filter { it.isFile && it.name.endsWith(".gguf", ignoreCase = true) }
                ?.sortedBy { it.name.lowercase() }
                ?: emptyList()
            val array = Arguments.createArray()
            models.forEach { file ->
                val item = Arguments.createMap().apply {
                    putString("name", file.name)
                    putDouble("sizeBytes", file.length().toDouble())
                    putDouble("lastModified", file.lastModified().toDouble())
                    putBoolean("loaded", file.name == loadedModelName)
                }
                array.pushMap(item)
            }
            promise.resolve(array)
        } catch (error: Throwable) {
            promise.reject("E_LIST_MODELS", error.message, error)
        }
    }

    @ReactMethod
    fun deleteModel(name: String, promise: Promise) {
        worker.execute {
            try {
                require(name != loadedModelName) {
                    "Descarregue o modelo antes de removê-lo da biblioteca."
                }
                val file = resolveModel(name)
                check(file.delete()) { "Não foi possível remover o arquivo." }
                promise.resolve(true)
            } catch (error: Throwable) {
                promise.reject("E_DELETE_MODEL", error.message ?: "Falha ao remover modelo.", error)
            }
        }
    }

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        worker.execute {
            try {
                val memory = ActivityManager.MemoryInfo()
                (context.getSystemService(Activity.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
                val cpuCores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
                val gpuAvailable = nativeBridge().nativeGpuBackendAvailable()
                val result: WritableMap = Arguments.createMap().apply {
                    putInt("cpuCores", cpuCores)
                    putDouble("availableMemoryBytes", memory.availMem.toDouble())
                    putDouble("totalMemoryBytes", memory.totalMem.toDouble())
                    putBoolean("gpuBackendAvailable", gpuAvailable)
                }
                promise.resolve(result)
            } catch (error: Throwable) {
                promise.reject("E_DEVICE_INFO", error.message, error)
            }
        }
    }

    @ReactMethod
    fun getEngineSettings(promise: Promise) {
        val prefs = context.getSharedPreferences(PREFS, 0)
        val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val defaults = Arguments.createMap().apply {
            putInt("threads", minOf(6, cores))
            putInt("threadsBatch", cores)
            putInt("contextSize", 2048)
            putInt("batchSize", 512)
            putInt("ubatchSize", 128)
            putInt("gpuLayers", 0)
            putBoolean("useMmap", true)
            putString("cacheType", "f16")
            putString("flashAttention", "auto")
            putInt("maxTokens", 128)
            putInt("topK", 40)
            putDouble("temperature", 0.7)
            putDouble("topP", 0.9)
            putDouble("repeatPenalty", 1.05)
        }
        val result = Arguments.createMap()
        for (key in ENGINE_KEYS) {
            when (key) {
                "threads", "threadsBatch", "contextSize", "batchSize", "ubatchSize", "gpuLayers", "maxTokens", "topK" ->
                    result.putInt(key, prefs.getInt(key, defaults.getInt(key)))
                "temperature", "topP", "repeatPenalty" ->
                    result.putDouble(key, prefs.getFloat(key, defaults.getDouble(key).toFloat()).toDouble())
                "useMmap" -> result.putBoolean(key, prefs.getBoolean(key, defaults.getBoolean(key)))
                "cacheType", "flashAttention" -> result.putString(key, prefs.getString(key, defaults.getString(key)) ?: defaults.getString(key))
            }
        }
        promise.resolve(result)
    }

    @ReactMethod
    fun saveEngineSettings(settings: ReadableMap, promise: Promise) {
        try {
            val editor = context.getSharedPreferences(PREFS, 0).edit()
            for (key in ENGINE_KEYS) {
                if (!settings.hasKey(key) || settings.isNull(key)) continue
                when (key) {
                    "threads", "threadsBatch", "contextSize", "batchSize", "ubatchSize", "gpuLayers", "maxTokens", "topK" ->
                        editor.putInt(key, settings.getInt(key))
                    "temperature", "topP", "repeatPenalty" ->
                        editor.putFloat(key, settings.getDouble(key).toFloat())
                    "useMmap" -> editor.putBoolean(key, settings.getBoolean(key))
                    "cacheType", "flashAttention" -> editor.putString(key, settings.getString(key))
                }
            }
            editor.apply()
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.reject("E_SAVE_SETTINGS", error.message, error)
        }
    }

    @ReactMethod
    fun loadModel(name: String, options: ReadableMap, promise: Promise) {
        worker.execute {
            try {
                val file = resolveModel(name)
                val memory = ActivityManager.MemoryInfo()
                (context.getSystemService(Activity.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
                val threads = intOption(options, "threads", minOf(6, Runtime.getRuntime().availableProcessors())).coerceIn(1, 32)
                val threadsBatch = intOption(options, "threadsBatch", Runtime.getRuntime().availableProcessors()).coerceIn(1, 32)
                val contextSize = intOption(options, "contextSize", 2048).coerceIn(512, 8192)
                val batchSize = intOption(options, "batchSize", 512).coerceIn(32, 2048)
                val ubatchSize = intOption(options, "ubatchSize", 128).coerceIn(16, batchSize)
                val gpuLayers = intOption(options, "gpuLayers", 0).coerceIn(0, 128)
                val useMmap = boolOption(options, "useMmap", true)
                val cacheType = when (stringOption(options, "cacheType", "f16")) {
                    "q8_0" -> 1
                    "q4_0" -> 2
                    else -> 0
                }
                val flashAttentionMode = if (stringOption(options, "flashAttention", "auto") == "off") 1 else 0

                val result = nativeBridge().nativeLoadModel(
                    file.absolutePath,
                    gpuLayers,
                    contextSize,
                    threads,
                    threadsBatch,
                    batchSize,
                    ubatchSize,
                    useMmap,
                    cacheType,
                    flashAttentionMode,
                    memory.availMem
                )
                if (result.startsWith("ERROR:")) {
                    throw IllegalStateException(result.removePrefix("ERROR:").trim())
                }
                loadedModelName = name
                context.getSharedPreferences(PREFS, 0).edit().putString("lastModel", name).apply()
                promise.resolve(result)
            } catch (error: Throwable) {
                loadedModelName = null
                promise.reject("E_LOAD_MODEL", error.message ?: error.javaClass.simpleName, error)
            }
        }
    }

    private fun intOption(options: ReadableMap, key: String, fallback: Int): Int =
        if (options.hasKey(key) && !options.isNull(key)) options.getInt(key) else fallback

    private fun boolOption(options: ReadableMap, key: String, fallback: Boolean): Boolean =
        if (options.hasKey(key) && !options.isNull(key)) options.getBoolean(key) else fallback

    private fun stringOption(options: ReadableMap, key: String, fallback: String): String =
        if (options.hasKey(key) && !options.isNull(key)) options.getString(key) ?: fallback else fallback

    private fun emitToken(requestId: String, text: String) {
        context.runOnJSQueueThread {
            val event: WritableMap = Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("text", text)
            }
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("QuazyToken", event)
        }
    }

    @ReactMethod
    fun generate(
        prompt: String,
        maxTokens: Int,
        topK: Int,
        temperature: Double,
        topP: Double,
        repeatPenalty: Double,
        requestId: String,
        promise: Promise
    ) {
        worker.execute {
            try {
                val native = nativeBridge()
                val answer = native.nativeGenerate(
                    prompt,
                    maxTokens.coerceIn(1, 512),
                    topK.coerceIn(0, 200),
                    temperature.toFloat().coerceIn(0.05f, 2.0f),
                    topP.toFloat().coerceIn(0.1f, 1.0f),
                    repeatPenalty.toFloat().coerceIn(1.0f, 1.5f),
                    object : NativeTokenCallback {
                        override fun onToken(text: String) { emitToken(requestId, text) }
                    }
                )
                if (answer.startsWith("ERROR:")) {
                    throw IllegalStateException(answer.removePrefix("ERROR:").trim())
                }
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
        worker.execute {
            runCatching { bridge?.nativeReleaseModel() }
            loadedModelName = null
        }
    }

    @Synchronized
    private fun nativeBridge(): NativeBridge {
        bridge?.let { return it }
        return NativeBridge().also { bridge = it }
    }

    override fun invalidate() {
        context.removeActivityEventListener(activityListener)
        worker.execute {
            runCatching { bridge?.nativeReleaseModel() }
            loadedModelName = null
        }
        worker.shutdown()
        super.invalidate()
    }

    companion object {
        private const val REQUEST_MODEL = 4101
        private const val PREFS = "quazy_engine_settings"
        private val ENGINE_KEYS = listOf(
            "threads", "threadsBatch", "contextSize", "batchSize", "ubatchSize",
            "gpuLayers", "useMmap", "cacheType", "flashAttention",
            "maxTokens", "topK", "temperature", "topP", "repeatPenalty"
        )
    }
}
