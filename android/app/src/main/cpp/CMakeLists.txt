cmake_minimum_required(VERSION 3.22.1)
project(quazy_native LANGUAGES C CXX)

# Gradle's assembleRelease selects the Release native configuration. Keep the
# CMake fallback explicit for CI/local builds so llama.cpp and every ggml
# backend are compiled with Release optimization, not just this JNI wrapper.
set(CMAKE_BUILD_TYPE Release CACHE STRING "Native build type" FORCE)
set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG" CACHE STRING "" FORCE)

include(FetchContent)

# Android NDK toolchains restrict package discovery to the sysroot, so the
# host-installed SPIRV-Headers package must be passed explicitly by CI.
if(DEFINED ENV{SPIRV_HEADERS_CMAKE_DIR})
    set("SPIRV-Headers_DIR" "$ENV{SPIRV_HEADERS_CMAKE_DIR}" CACHE PATH "SPIRV-Headers CMake package directory" FORCE)
endif()

# SPIRV-Headers is installed for the Vulkan backend, but its CMake package
# does not propagate the include root to ggml-vulkan in this Android build.
# Add it explicitly so <spirv/unified1/spirv.hpp> resolves for the NDK compiler.
if(DEFINED ENV{SPIRV_HEADERS_INCLUDE_DIR})
    include_directories("$ENV{SPIRV_HEADERS_INCLUDE_DIR}")
endif()

# Vulkan's ggml backend includes the header-only Vulkan-Hpp C++ bindings.
# Supply their host-side headers explicitly to the Android cross-compiler.
if(DEFINED ENV{VULKAN_HPP_INCLUDE_DIR})
    include_directories("$ENV{VULKAN_HPP_INCLUDE_DIR}")
endif()
if(DEFINED ENV{VULKAN_HEADERS_INCLUDE_DIR})
    include_directories("$ENV{VULKAN_HEADERS_INCLUDE_DIR}")
endif()

set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)

# Upstream's Android CPU strategy: dynamic backend libraries with all
# compatible ARM variants. llama.cpp selects the best variant supported by
# the device at runtime, avoiding a single generic armv8-a CPU binary and
# avoiding unsafe hard-coded -march flags on heterogeneous big.LITTLE CPUs.
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_ARM_ARCH "" CACHE STRING "" FORCE)

# ARM CPU acceleration.
set(GGML_CPU_KLEIDIAI ON CACHE BOOL "" FORCE)
set(GGML_CPU_REPACK ON CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

# Vulkan is the Android GPU backend. The Android system provides the
# Vulkan loader/driver (libvulkan.so); the APK packages ggml-vulkan as a
# dynamically loaded backend and keeps CPU as the universal fallback.
# OpenCL remains disabled because Adreno OpenCL runtimes are not consistently
# exposed to third-party apps across Android vendors/firmware.
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN ON CACHE BOOL "" FORCE)
set(GGML_VULKAN_CHECK_RESULTS OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN_DEBUG OFF CACHE BOOL "" FORCE)

# Use PrismML's maintained llama.cpp fork. It adds the Bonsai-specific
# low-bit formats (PQ2_0/PTQ1_0) and Hadamard/sign-flip transforms while
# preserving the llama C API used by QuazyNative. Pin the same tested release
# used by PrismML's Bonsai demo instead of tracking a moving branch.
#
# Android's NDK build does not bundle an OpenMP runtime; the fork's Android
# build guidance disables OpenMP and llamafile for arm64-v8a.
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/PrismML-Eng/llama.cpp.git
    GIT_TAG prism-b10828-a153697
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama_cpp)

add_library(quazy_jni SHARED native-lib.cpp)
target_compile_features(quazy_jni PRIVATE cxx_std_17)
target_compile_options(quazy_jni PRIVATE -O3 -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(quazy_jni PRIVATE llama android log)
