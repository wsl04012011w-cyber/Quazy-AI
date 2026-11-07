cmake_minimum_required(VERSION 3.22.1)
project(quazy_native LANGUAGES C CXX)

include(FetchContent)

# Build a reproducible snapshot of llama.cpp. Vulkan is compiled into this
# arm64-v8a Android library; runtime driver availability is checked by llama.cpp.
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
set(GGML_VULKAN ON CACHE BOOL "" FORCE)
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)
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
target_compile_options(quazy_jni PRIVATE -Wall -Wextra -Wno-unused-parameter)

find_library(android-lib android REQUIRED)
find_library(log-lib log REQUIRED)

target_link_libraries(quazy_jni PRIVATE llama ${android-lib} ${log-lib})
