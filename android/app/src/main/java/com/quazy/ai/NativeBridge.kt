package com.quazy.ai

interface NativeTokenCallback {
    fun onToken(text: String)
}

class NativeBridge {
    external fun nativeLoadModel(
        path: String,
        backendDirectory: String,
        requestedGpuLayers: Int,
        contextSize: Int,
        threads: Int,
        threadsBatch: Int,
        batchSize: Int,
        ubatchSize: Int,
        useMmap: Boolean,
        cacheType: Int,
        flashAttentionMode: Int,
        availableMemoryBytes: Long
    ): String

    external fun nativeGenerate(
        prompt: String,
        maxTokens: Int,
        topK: Int,
        temperature: Float,
        topP: Float,
        repeatPenalty: Float,
        callback: NativeTokenCallback
    ): String

    external fun nativeTokenStats(): String
    external fun nativeGpuBackendAvailable(): Boolean
    external fun nativeReleaseModel()

    companion object {
        init { System.loadLibrary("quazy_jni") }
    }
}
