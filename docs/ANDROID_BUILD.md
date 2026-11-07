# Android build and device notes

## Build target

- React Native: 0.81.5.
- Android application: \`com.quazy.ai\`.
- Native ABI: \`arm64-v8a\`.
- Minimum Android API: 28.
- Compile / target SDK: 36.
- NDK: 27.2.12479018.
- llama.cpp source: tag \`b12189\`.
- Backend: CPU with KleidiAI where supported.
- Gradle project: \`android/\`; React Native package and JavaScript entry point: repository root.

## OpenCL crash diagnosis

The supplied Android 16 log shows:

\`UnsatisfiedLinkError: dlopen failed: library "libOpenCL.so" not found\`

The error originates while Android loads \`libggml-opencl.so\` as a dependency of \`libquazy_jni.so\`. This is a runtime linker failure, not a malformed GGUF. The OpenCL ICD loader was available at build/link time, but the vendor implementation is not visible in the app's linker namespace. The build therefore disables OpenCL and Vulkan for now, leaving llama.cpp's CPU backend.

## React Native UI

The chat screen is implemented in \`App.js\`. It calls the Kotlin \`QuazyNative\` module for file selection, model loading, generation, token stats and model release. Model inference remains in C++ through JNI; no inference is moved into JavaScript.

The debug APK bundles the JS entry point and disables Metro DevSupport, so it can be installed and opened without a Metro development server.

## Model loading and memory

The app copies the selected document into its private cache before calling llama.cpp. The JNI loader checks available memory, starts with context size 2048 and attempts CPU model loading. Large GGUF models may still exceed the available RAM or be terminated by Android.

## Diagnostics

At startup, the app writes a report to internal app storage and tries to export it to \`Downloads/QuazyAI\`. Uncaught Java/Kotlin exceptions are saved and included on the next launch. Native process aborts and driver failures may not be captured by the Java exception handler.
