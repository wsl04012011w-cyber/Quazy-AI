# Android build and device notes

## Build target

- Android application: \`com.quazy.ai\`.
- Native ABI: \`arm64-v8a\`.
- Minimum Android API: 28.
- NDK: 27.2.12479018.
- llama.cpp source: tag \`b12189\`.
- Backends: OpenCL 2.0 with Adreno-optimized kernels; KleidiAI CPU kernels as fallback.

The GitHub Actions workflow builds Khronos OpenCL-Headers and the OpenCL ICD loader for Android, then places their headers and link library in the NDK sysroot before building the app. The loader is a link-time dependency; the actual OpenCL implementation is supplied by the device vendor.

## Snapdragon 6 Gen 3 / Adreno

Qualcomm's product brief lists OpenCL 2.0 and Vulkan 1.1 for Snapdragon 6 Gen 3. The Vulkan backend in the pinned llama.cpp revision checks for Vulkan 1.2, so this build selects OpenCL instead.

The upstream llama.cpp OpenCL backend is designed for Qualcomm Adreno and documents Android validation on selected Snapdragon devices, but not specifically the Snapdragon 6 Gen 3 / Adreno 710. Therefore the APK build proves that the backend compiles; it does not certify that this phone's OpenCL driver can run it. Device testing is required. If the vendor OpenCL library or a required kernel is unavailable, the app may fall back to CPU or report a model-load failure.

The app requests 24 GPU layers initially and retries with fewer layers, then CPU, if model/context creation reports an error. The displayed number is the requested offload value, not a hardware benchmark.

## Large and low-bit GGUF models

The app does not modify quantization kernels or rewrite GGUF tensors. It delegates model-format support to the pinned upstream llama.cpp version. The OpenCL backend documents support for selected low-bit types, but the exact quantization in a model such as a 4B one-bit variant must be checked against the backend's supported operations; unsupported operations may run on CPU or fail.

To lower memory pressure, the first version:
- uses memory mapping and does not request memory locking;
- pre-checks file size against currently available system memory;
- starts with context size 2048, batch 256 and micro-batch 128;
- caps requested GPU layers and retries with fewer layers and then CPU;
- performs loading/inference off the UI thread and reports returned errors.

Android or a GPU driver can still terminate a process under severe memory pressure or an internal native-driver fault. No C++ exception handler can guarantee recovery from SIGKILL, process aborts or a device-driver reset. These safeguards reduce risk; physical-device testing remains necessary.

## Token counters

After each response, the JNI bridge resets and reads \`llama_perf_context()\`, displaying \`n_p_eval\` (prompt tokens) and \`n_eval\` (generated tokens) for that request. Counts are supplied by llama.cpp, not estimated from characters.

## Manual build

Install JDK 17, Android SDK 35, NDK 27.2.12479018, CMake 3.31.6 and Ninja. The workflow additionally prepares OpenCL-Headers and OpenCL-ICD-Loader for the Android arm64 sysroot, then runs \`:app:assembleDebug\`.

The GitHub Actions workflow publishes a debug APK artifact named \`Quazy-AI-debug-apk\`.
