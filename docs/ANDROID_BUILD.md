# Android build and device notes

## Build target

- Android application, package `com.quazy.ai`.
- Native ABI: `arm64-v8a`.
- Minimum Android API: 28.
- NDK: 27.2.12479018.
- llama.cpp source: tag `b12189`.
- GGML options: Vulkan enabled, KleidiAI CPU kernels enabled, OpenMP disabled, native-host tuning disabled.

The build runs `glslc` on the GitHub Actions host to compile Vulkan shaders. The Android NDK supplies the Android Vulkan headers and loader stub used for linking. The real Vulkan loader/driver is provided by Android at runtime.

## Snapdragon 6 Gen 3

Qualcomm specifies Vulkan 1.1 for Snapdragon 6 Gen 3. Quazy builds the Vulkan backend for Adreno-capable Android devices and requests 24 GPU layers initially. The runtime falls back through a lower GPU-layer count to CPU if model loading or context creation returns an error.

This confirms that the APK contains the Vulkan backend; it does not certify every Adreno driver/kernel combination. Runtime validation must be done on the actual phone. The app does not enable the llama.cpp OpenCL backend in this first version because the currently documented, verified Qualcomm OpenCL device matrix is narrower than all Snapdragon generations.

## Large and low-bit GGUF models

The app does not modify quantization kernels or rewrite GGUF tensors. It delegates model-format support to the pinned upstream llama.cpp version. For a one-bit model, use a GGUF quantization actually supported by that llama.cpp revision.

To lower memory pressure, the first version:
- uses memory mapping and does not request memory locking;
- pre-checks file size against currently available system memory;
- starts with context size 2048, batch 256 and micro-batch 128;
- caps requested GPU layers and retries with fewer layers and then CPU;
- performs loading/inference off the UI thread and reports returned errors.

Android or a GPU driver can still terminate a process under severe memory pressure or an internal native-driver fault. No C++ exception handler can guarantee recovery from SIGKILL, process aborts or a device-driver reset. The safeguards reduce risk; physical-device testing remains necessary.

## Token counters

After each response, the JNI bridge reads `llama_perf_context()` and displays `n_p_eval` (prompt tokens) and `n_eval` (generated tokens). Counts are from llama.cpp, not estimates based on characters.

## Manual build

Open this repository in Android Studio or run the Gradle task after installing JDK 17, Android SDK 35, NDK 27.2.12479018, CMake 3.31.6, `glslc` and SPIRV-Headers. Vulkan shader generation also requires the host-side shader compiler.

The GitHub Actions workflow publishes a debug APK artifact named `Quazy-AI-debug-apk`.
