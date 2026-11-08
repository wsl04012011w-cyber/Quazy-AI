# Android build and device notes

## Build target

- React Native: 0.81.5.
- Android application: `com.quazy.ai`.
- Native ABI: `arm64-v8a`.
- Minimum Android API: 28.
- Compile / target SDK: 36.
- NDK: 27.2.12479018.
- CMake: 3.31.6.
- llama.cpp: `v0.9.0`.
- Build variant: Gradle `release`, native CMake `Release`.
- CPU: KleidiAI + CPU repacking + dynamic CPU backend variants.

## Why the old build was slow

The old build pinned llama.cpp at `b12189`, disabled `GGML_BACKEND_DL` and left `GGML_CPU_ALL_VARIANTS` at its default OFF. At the same time, it set `GGML_NATIVE=OFF` for NDK cross-compilation and left `GGML_CPU_ARM_ARCH` empty. In that combination, the ARM CPU CMake path did not add an ARM-specific `-march` backend variant. KleidiAI being ON did not by itself guarantee that all quantized operations in the selected GGUF would use optimized ARM kernels.

The new build follows the current upstream Android library configuration: `BUILD_SHARED_LIBS=ON`, `GGML_BACKEND_DL=ON`, `GGML_CPU_ALL_VARIANTS=ON`, `GGML_NATIVE=OFF`, and `GGML_CPU_KLEIDIAI=ON`. The dynamic CPU backend variants are packaged inside the APK and selected at runtime. No one-size-fits-all `-march` flag is forced on a heterogeneous big.LITTLE device.

The workflow also builds Gradle `release` instead of `debug`, so the whole llama.cpp/ggml dependency graph receives native Release optimization.

## Signing

The workflow uses a persistent JKS key when the following repository secrets are present:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Without those secrets, it falls back to the runner's debug signing key. This produces an installable test Release APK, but the key is ephemeral: later builds will have a different signature and Android will require uninstalling the old app before installing the new one. Use a persistent private keystore for updates. Never commit that file or its passwords.

## GPU status

OpenCL remains disabled because previous device logs showed that `libOpenCL.so` was not available in the app linker namespace. Vulkan remains disabled until an Android driver path is verified. GPU layer offload remains 0 in this build.

## Model library and memory

GGUF files are copied into the private `files/models` directory. They remain between app launches but are removed if the app is uninstalled or its app data is cleared. The native loader checks available memory before model loading.

## Diagnostics

At startup, the app writes a report to internal app storage and tries to export it to `Downloads/QuazyAI`. Uncaught Java/Kotlin exceptions are saved and included on the next launch. Native process aborts and driver failures may not be captured by the Java exception handler.
