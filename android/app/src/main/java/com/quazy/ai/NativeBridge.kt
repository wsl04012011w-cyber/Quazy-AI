package com.quazy.ai

class NativeBridge {
    external fun nativeLoadModel(path: String, requestedGpuLayers: Int, contextSize: Int, availableMemoryBytes: Long): String
    external fun nativeGenerate(prompt: String, maxTokens: Int): String
    external fun nativeTokenStats(): String
    external fun nativeReleaseModel()

    companion object {
        init { System.loadLibrary("quazy_jni") }
    }
}
