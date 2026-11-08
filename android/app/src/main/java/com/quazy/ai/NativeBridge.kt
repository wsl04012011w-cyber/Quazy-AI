package com.quazy.ai

interface NativeTokenCallback {
    fun onToken(text: String)
}

class NativeBridge {
    external fun nativeLoadModel(path: String, requestedGpuLayers: Int, contextSize: Int, availableMemoryBytes: Long): String
    external fun nativeGenerate(
        prompt: String,
        maxTokens: Int,
        temperature: Float,
        topP: Float,
        callback: NativeTokenCallback
    ): String
    external fun nativeTokenStats(): String
    external fun nativeReleaseModel()

    companion object {
        init { System.loadLibrary("quazy_jni") }
    }
}
