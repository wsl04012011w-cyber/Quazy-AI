cmake_minimum_required(VERSION 3.22.1)
project(quazy_native LANGUAGES C CXX)

include(FetchContent)

# Keep the llama.cpp revision fixed so APK builds are reproducible.
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_UI OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)

set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI ON CACHE BOOL "" FORCE)

# Snapdragon 6 Gen 3 exposes OpenCL 2.0 and Vulkan 1.1.
# The pinned llama.cpp Vulkan backend requires Vulkan 1.2, so use its
# Adreno-optimized OpenCL backend on this target instead.
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_OPENCL ON CACHE BOOL "" FORCE)
set(GGML_OPENCL_TARGET_VERSION "200" CACHE STRING "" FORCE)
set(GGML_OPENCL_EMBED_KERNELS ON CACHE BOOL "" FORCE)
set(GGML_OPENCL_USE_ADRENO_KERNELS ON CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)

# The workflow builds Khronos OpenCL headers and the Android loader into
# the NDK sysroot. Point FindOpenCL at those arm64 Android files explicitly.
if(DEFINED ENV{OPENCL_INCLUDE_DIR} AND NOT "$ENV{OPENCL_INCLUDE_DIR}" STREQUAL "")
    set(OpenCL_INCLUDE_DIR "$ENV{OPENCL_INCLUDE_DIR}" CACHE PATH "" FORCE)
endif()
if(DEFINED ENV{OPENCL_LIBRARY} AND NOT "$ENV{OPENCL_LIBRARY}" STREQUAL "")
    set(OpenCL_LIBRARY "$ENV{OPENCL_LIBRARY}" CACHE FILEPATH "" FORCE)
endif()

FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG b12189
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama_cpp)

add_library(quazy_jni SHARED native-lib.cpp)
target_compile_features(quazy_jni PRIVATE cxx_std_17)
target_compile_options(quazy_jni PRIVATE -Wall -Wextra -Wno-unused-parameter)

target_link_libraries(quazy_jni PRIVATE llama android log)
