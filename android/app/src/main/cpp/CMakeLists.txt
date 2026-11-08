cmake_minimum_required(VERSION 3.22.1)
project(quazy_native LANGUAGES C CXX)

# The APK is debuggable for installation/testing, but llama.cpp must still be
# compiled with optimized native code. The previous Debug CMake flags left the
# inference engine without optimization, which can severely reduce tokens/s.
if(ANDROID)
    set(CMAKE_C_FLAGS_DEBUG "${CMAKE_C_FLAGS_DEBUG} -O3 -DNDEBUG" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -O3 -DNDEBUG" CACHE STRING "" FORCE)
endif()

include(FetchContent)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_UI OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)

# Android arm64 CPU configuration recommended by upstream llama.cpp:
# portable NDK build, KleidiAI kernels, no OpenMP or llamafile runtime.
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI ON CACHE BOOL "" FORCE)
set(GGML_CPU_REPACK ON CACHE BOOL "" FORCE)

# CPU-only remains deliberate for this APK. The phone's OpenCL loader was not
# available from the app linker namespace; Vulkan has not been validated yet.
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG b12189
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama_cpp)

add_library(quazy_jni SHARED native-lib.cpp)
target_compile_features(quazy_jni PRIVATE cxx_std_17)
target_compile_options(quazy_jni PRIVATE -O3 -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(quazy_jni PRIVATE llama android log)
